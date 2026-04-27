// js/03-solver/structured-sale.js
//
// Structured-Sale Optimizer
// =========================
// When a single-year strategy cannot fully offset the long-term gain on a
// property sale, the seller may park the gain inside an insurance-product
// structured sale.  The product holds the gain, pays the seller principal
// (cost-basis cash) up front, and releases the gain in installments on
// January 1st of subsequent tax years.  Gain is recognized only when paid
// out of the product.
//
// This module decides how much gain to recognize in each year of the
// projection horizon so that cumulative federal + state tax is minimized.
// The Brooklyn loss capacity per year (already sized by solveMultiYear from
// the client's invested capital and chosen leverage) defines an upper
// bound on how much gain can be efficiently absorbed in that year.
//
// Inputs to optimizeStructuredSale:
//   - cfg            : same client/projection cfg used by recommendSale
//   - stage2         : the multi-year solver result we are refining
//   - opts.candidates: optional override of the candidate strategies to score
//
// Output: a refined stage2-shaped object with the winning gainByYear and
// lossByYear, plus a 'structured' block describing the schedule and the
// candidate scoreboard for transparency.
//
// All Brooklyn losses remain SHORT-TERM (per project-wide rule).
// IRS netting (ST-vs-ST first, then ST-vs-LT, then up to $3K ordinary) is
// performed inside the tax engine via _applyLossesToScenario.
//
(function (root) {
  'use strict';

  // ---------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------

  function _num(v, d) {
    var n = Number(v);
    return isFinite(n) ? n : (d || 0);
  }

  function _zeros(n) {
    var a = new Array(n);
    for (var i = 0; i < n; i++) a[i] = 0;
    return a;
  }

  // Distribute totalGain across years where capByYear[i] is the maximum
  // gain that year's Brooklyn loss capacity can absorb dollar-for-dollar.
  // Greedy front-load: take min(remaining, cap) each year in order.
  function _scheduleGreedy(totalGain, capByYear) {
    var out = _zeros(capByYear.length);
    var remaining = totalGain;
    for (var i = 0; i < capByYear.length && remaining > 0; i++) {
      var take = Math.min(remaining, _num(capByYear[i], 0));
      out[i] = take;
      remaining -= take;
    }
    return { gainByYear: out, leftover: remaining };
  }

  // Proportional fill: gainByYear[i] = capByYear[i] * (totalGain / totalCapacity)
  // (matches the legacy solveMultiYear behavior, used as a comparison candidate)
  function _scheduleProportional(totalGain, capByYear) {
    var totalCap = 0;
    for (var i = 0; i < capByYear.length; i++) totalCap += _num(capByYear[i], 0);
    var out = _zeros(capByYear.length);
    if (totalCap <= 0) return { gainByYear: out, leftover: totalGain };
    var fillable = Math.min(totalGain, totalCap);
    for (var j = 0; j < capByYear.length; j++) {
      out[j] = _num(capByYear[j], 0) * (fillable / totalCap);
    }
    return { gainByYear: out, leftover: Math.max(0, totalGain - fillable) };
  }

  // Defer year-1 entirely: park all of the year-1 gain in the product.
  // Year-1 Brooklyn losses are then unused for LTG offset (they would only
  // offset other ST/LT gains and up to $3K of ordinary).  This candidate
  // is included so the optimizer can detect cases where deferring is
  // actually better (e.g., year-1 ordinary income is unusually high so
  // the marginal LTCG rate is at 20%+NIIT and a future year drops it).
  function _scheduleDeferYear1(totalGain, capByYear) {
    var out = _zeros(capByYear.length);
    if (capByYear.length < 2) return { gainByYear: out, leftover: totalGain };
    var remaining = totalGain;
    for (var i = 1; i < capByYear.length && remaining > 0; i++) {
      var take = Math.min(remaining, _num(capByYear[i], 0));
      out[i] = take;
      remaining -= take;
    }
    return { gainByYear: out, leftover: remaining };
  }

  // Back-load: recognize as little as possible early, push gain to later
  // years.  Useful when the client expects a drop in ordinary income
  // (e.g., retirement) in the out-years.
  function _scheduleBackload(totalGain, capByYear) {
    var out = _zeros(capByYear.length);
    var remaining = totalGain;
    for (var i = capByYear.length - 1; i >= 0 && remaining > 0; i--) {
      var take = Math.min(remaining, _num(capByYear[i], 0));
      out[i] = take;
      remaining -= take;
    }
    return { gainByYear: out, leftover: remaining };
  }

  // ---------------------------------------------------------------------
  // Scoring
  // ---------------------------------------------------------------------
  // Use the existing tax-comparison engine to evaluate a candidate
  // schedule.  This honors per-year ordinary-income overrides, Additional
  // Medicare, NIIT, AMT (with the Form 6251 Part III LTCG fix), state
  // brackets, and CA Mental Health Services Tax.
  //
  // Returns { totalWithStrategy, totalBaseline, totalSavings, rows }.
  function _scoreSchedule(cfg, gainByYear, lossByYear, leverageByYear) {
    if (typeof root.computeTaxComparison !== 'function') {
      return { totalWithStrategy: Infinity, totalBaseline: 0, totalSavings: 0, rows: [] };
    }
    var horizon = gainByYear.length;
    var schedule = [];
    for (var i = 0; i < horizon; i++) {
      schedule.push({
        year: i,
        gainTaken: gainByYear[i] || 0,
        gain: gainByYear[i] || 0,
        lossGenerated: lossByYear[i] || 0,
        loss: lossByYear[i] || 0,
        leverage: (leverageByYear && leverageByYear[i] != null) ? leverageByYear[i] : null
      });
    }
    var rec = { recommendation: 'multi-year', schedule: schedule, years: horizon };
    // Ensure cfg has the keys that computeTaxComparison requires.
    // year1 defaults to the implementation-date year if available, else
    // the current calendar year.
    var defaultYear1 = (function () {
      if (cfg && cfg.year1) return Number(cfg.year1);
      if (cfg && cfg.implementationDate) {
        var m = String(cfg.implementationDate).match(/^(\d{4})/);
        if (m) return Number(m[1]);
      }
      return new Date().getFullYear();
    })();
    var scoreCfg = Object.assign({}, cfg, {
      horizonYears: horizon,
      year1: defaultYear1
    });
    var cmp = root.computeTaxComparison(scoreCfg, rec);
    return {
      totalWithStrategy: cmp.totalWithStrategy,
      totalBaseline: cmp.totalBaseline,
      totalSavings: cmp.totalSavings,
      rows: cmp.rows
    };
  }

  // ---------------------------------------------------------------------
  // Main entry point
  // ---------------------------------------------------------------------
  //
  // Refines a multi-year solver result by exploring several payout
  // schedules from the structured-sale insurance product and picking the
  // schedule that minimizes cumulative federal + state tax.
  //
  function optimizeStructuredSale(opts) {
    opts = opts || {};
    var cfg     = opts.cfg     || {};
    var stage2  = opts.stage2  || {};
    var capByYear = (stage2.capByYear || []).map(function (v) { return _num(v, 0); });
    var totalGain = _num(stage2.totalLossNeeded, 0);
    var horizon   = capByYear.length;

    if (horizon === 0 || totalGain <= 0) {
      return Object.assign({}, stage2, {
        structured: {
          enabled: false,
          reason: 'no gain to schedule',
          candidates: [],
          chosen: null
        }
      });
    }

    // Loss-to-gain mapping is 1:1 (Brooklyn losses are short-term and we
    // assume they offset gain dollar-for-dollar at the cap leverage that
    // produced capByYear).  If a candidate cannot be scored (no tax
    // engine), we fall back to the greedy schedule.
    var leverageByYear = stage2.leverageByYear || _zeros(horizon).map(function () {
      return stage2.leverageUsed != null ? stage2.leverageUsed : null;
    });

    // Build candidate schedules.
    var candidates = [
      Object.assign({ name: 'greedy-frontload' }, _scheduleGreedy(totalGain, capByYear)),
      Object.assign({ name: 'proportional'    }, _scheduleProportional(totalGain, capByYear)),
      Object.assign({ name: 'defer-year1'     }, _scheduleDeferYear1(totalGain, capByYear)),
      Object.assign({ name: 'backload'        }, _scheduleBackload(totalGain, capByYear))
    ];

    // For each candidate, mirror gain into loss (1:1, since cap was sized
    // from invested capital * lossRate) and score with the tax engine.
    var scored = [];
    for (var i = 0; i < candidates.length; i++) {
      var c = candidates[i];
      var lossByYear = c.gainByYear.map(function (g, idx) {
        // Cannot generate more loss than the year's Brooklyn capacity.
        return Math.min(g, capByYear[idx]);
      });
      var s = _scoreSchedule(cfg, c.gainByYear, lossByYear, leverageByYear);
      scored.push({
        name: c.name,
        gainByYear: c.gainByYear.slice(),
        lossByYear: lossByYear,
        leftoverGain: c.leftover,
        totalWithStrategy: s.totalWithStrategy,
        totalBaseline: s.totalBaseline,
        totalSavings: s.totalSavings
      });
    }

    // Choose lowest tax (ignore candidates with leftover gain unless ALL
    // candidates leave leftover, in which case pick the one with the
    // smallest leftover then smallest tax).
    var fullyAbsorbed = scored.filter(function (s) { return s.leftoverGain <= 0.01; });
    var pool = fullyAbsorbed.length ? fullyAbsorbed : scored;
    pool.sort(function (a, b) {
      if (Math.abs(a.leftoverGain - b.leftoverGain) > 0.01) {
        return a.leftoverGain - b.leftoverGain;
      }
      return a.totalWithStrategy - b.totalWithStrategy;
    });
    var chosen = pool[0];

    return Object.assign({}, stage2, {
      // Replace the per-year arrays with the optimizer's choice.
      gainByYear: chosen.gainByYear,
      lossByYear: chosen.lossByYear,
      // Mark the schedule type.
      recommendation: stage2.feasible ? 'multi-year' : 'multi-year-shortfall',
      structured: {
        enabled: true,
        chosen: chosen.name,
        chosenTax: chosen.totalWithStrategy,
        chosenSavings: chosen.totalSavings,
        candidates: scored,
        // The structured-sale product holds whatever was not recognized
        // in year 1 -- payouts on Jan 1 of years 2..N for amounts equal
        // to gainByYear[1..N-1].
        productPayouts: chosen.gainByYear.map(function (g, idx) {
          return { year: idx, payoutDate: idx === 0 ? 'sale-date' : 'jan-1', amount: g };
        }),
        // Initial deposit into the product = total gain minus year-1
        // recognition.
        initialDeposit: Math.max(0, totalGain - (chosen.gainByYear[0] || 0))
      }
    });
  }

  root.optimizeStructuredSale = optimizeStructuredSale;
})(window);
