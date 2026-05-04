// js/03-solver/structured-sale.js
//
// Structured-Sale Optimizer (with investment staggering + 15-month hold).
// =======================================================================
// When a single-year strategy cannot fully offset the long-term gain on a
// property sale, the seller may park the *gain* portion inside an
// insurance-product structured sale.  Cost-basis and any accelerated
// depreciation recapture stay in the year of sale (Y1) -- only LTCG can
// be deferred.  The product holds the gain, pays the seller principal
// (cost-basis cash) up front, and releases the gain in installments on
// January 1st of subsequent tax years.  Gain is recognized only when paid
// out of the product, and at least 15 months from the sale date must
// elapse before the first payout.
//
// This module decides:
//   1. how much LTCG to recognize in each year of the projection horizon,
//   2. how much Brooklyn capital to deploy in each year (staggered to
//      match recognized gain), and
//   3. whether deferral beats taking the full gain in Y1 at all,
// so that cumulative federal + state tax (plus Brooklyn fees) is minimized.
//
// All Brooklyn losses remain SHORT-TERM (per project-wide rule).  IRS
// netting is performed inside the tax engine.
//
(function (root) {
  'use strict';

  // -------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------

  function _num(v, d) {
    var n = Number(v);
    return isFinite(n) ? n : (d || 0);
  }

  function _zeros(n) {
    var a = new Array(n);
    for (var i = 0; i < n; i++) a[i] = 0;
    return a;
  }

  // Earliest Jan-1 payout slot (0-based year index relative to Y1) that
  // falls at least 15 months after the sale date.  A sale on 4/15/Y1
  // can pay out on Jan 1 of Y2 (~21 months ahead = OK).  A sale on
  // 11/1/Y1 cannot reach 15 months until Feb 1 of Y3, so the earliest
  // legal Jan-1 payout slips to year index 2.
  function _earliestPayoutIndex(implementationDate, year1) {
    if (!implementationDate) return 1;            // assume Jan-1 of Y1, payout in Y2 OK
    var sale = new Date(implementationDate);
    if (isNaN(sale.getTime())) return 1;
    var fifteen = new Date(sale.getFullYear(), sale.getMonth() + 15, sale.getDate());
    // We need the smallest yearOffset such that Jan 1 of (year1 + yearOffset) >= sale + 15mo.
    var y0 = Number(year1) || sale.getFullYear();
    for (var off = 1; off < 20; off++) {
      var jan1 = new Date(y0 + off, 0, 1);
      if (jan1.getTime() >= fifteen.getTime()) return off;
    }
    return 1;
  }

  // Distribute totalLTCG across years where capByYear[i] is the maximum
  // gain that year's Brooklyn loss capacity can absorb dollar-for-dollar.
  // legalSlots[i] === true means the year is a legal payout slot for the
  // structured product (i.e. >=15 months after sale, or i===0 which is
  // the un-deferred Y1 recognition).  Greedy front-load.
  function _scheduleGreedy(totalLTCG, capByYear, legalSlots) {
    var out = _zeros(capByYear.length);
    var remaining = totalLTCG;
    for (var i = 0; i < capByYear.length && remaining > 0; i++) {
      if (!legalSlots[i]) continue;
      var take = Math.min(remaining, _num(capByYear[i], 0));
      out[i] = take;
      remaining -= take;
    }
    return { gainByYear: out, leftover: remaining };
  }

  // Proportional fill across legal slots only.
  function _scheduleProportional(totalLTCG, capByYear, legalSlots) {
    var totalCap = 0;
    for (var i = 0; i < capByYear.length; i++) {
      if (legalSlots[i]) totalCap += _num(capByYear[i], 0);
    }
    var out = _zeros(capByYear.length);
    if (totalCap <= 0) return { gainByYear: out, leftover: totalLTCG };
    var fillable = Math.min(totalLTCG, totalCap);
    for (var j = 0; j < capByYear.length; j++) {
      if (legalSlots[j]) {
        out[j] = _num(capByYear[j], 0) * (fillable / totalCap);
      }
    }
    return { gainByYear: out, leftover: Math.max(0, totalLTCG - fillable) };
  }

  // Defer all Y1 LTCG into the structured product.  Y1 gets zero LTCG;
  // remaining recognition starts in the earliest legal payout slot.
  function _scheduleDeferAll(totalLTCG, capByYear, legalSlots, earliestSlot) {
    var out = _zeros(capByYear.length);
    var remaining = totalLTCG;
    for (var i = earliestSlot; i < capByYear.length && remaining > 0; i++) {
      if (!legalSlots[i]) continue;
      var take = Math.min(remaining, _num(capByYear[i], 0));
      out[i] = take;
      remaining -= take;
    }
    return { gainByYear: out, leftover: remaining };
  }

  // Back-load: push as much as possible into the latest legal slot first.
  function _scheduleBackload(totalLTCG, capByYear, legalSlots) {
    var out = _zeros(capByYear.length);
    var remaining = totalLTCG;
    for (var i = capByYear.length - 1; i >= 0 && remaining > 0; i--) {
      if (!legalSlots[i]) continue;
      var take = Math.min(remaining, _num(capByYear[i], 0));
      out[i] = take;
      remaining -= take;
    }
    return { gainByYear: out, leftover: remaining };
  }

  // Two-year balanced split: half in earliest legal slot, half in slot+1
  // (if legal, otherwise next legal).  Useful when the user wants the
  // simplest "split it across two Jan-1 payouts" pattern.
  function _scheduleBalancedTwo(totalLTCG, capByYear, legalSlots, earliestSlot) {
    var out = _zeros(capByYear.length);
    var slots = [];
    for (var i = earliestSlot; i < capByYear.length && slots.length < 2; i++) {
      if (legalSlots[i]) slots.push(i);
    }
    if (slots.length === 0) return { gainByYear: out, leftover: totalLTCG };
    var perSlot = totalLTCG / slots.length;
    var leftover = 0;
    for (var s = 0; s < slots.length; s++) {
      var idx = slots[s];
      var take = Math.min(perSlot, _num(capByYear[idx], 0));
      out[idx] = take;
      leftover += (perSlot - take);
    }
    // Spill any leftover into other legal slots.
    if (leftover > 0.01) {
      for (var k = 0; k < capByYear.length && leftover > 0; k++) {
        if (!legalSlots[k]) continue;
        if (slots.indexOf(k) !== -1) continue;
        var room = Math.max(0, _num(capByYear[k], 0) - out[k]);
        var t2 = Math.min(leftover, room);
        out[k] += t2;
        leftover -= t2;
      }
    }
    return { gainByYear: out, leftover: leftover };
  }

  // -------------------------------------------------------------------
  // Investment policy: how much capital to deploy each year.
  // -------------------------------------------------------------------
  // `match`: deploy only enough Brooklyn capital each year to generate
  //          a loss equal to that year's recognized gain.  Capital not
  //          deployed in Y1 is held in cash (no fee) and rolled into the
  //          year it's needed.  This is the "stagger" behavior.
  // `front`: deploy 100% of available capital in Y1 (legacy behavior).
  function _investmentByYear(policy, gainByYear, capByYear, totalCapital, lossRate) {
    var n = gainByYear.length;
    var inv = _zeros(n);
    if (totalCapital <= 0 || lossRate <= 0) return inv;
    if (policy === 'front') {
      inv[0] = totalCapital;
      return inv;
    }
    // policy === 'match'
    var deployed = 0;
    for (var i = 0; i < n; i++) {
      var needed = (gainByYear[i] || 0) / lossRate;
      // Cap at remaining capital.
      var remaining = Math.max(0, totalCapital - deployed);
      var take = Math.min(needed, remaining);
      inv[i] = take;
      deployed += take;
    }
    return inv;
  }

  // -------------------------------------------------------------------
  // Scoring -- delegate to the multi-year tax-comparison engine.
  // -------------------------------------------------------------------
  function _scoreSchedule(cfg, gainByYear, lossByYear, leverageByYear, recaptureY1) {
    if (typeof root.computeTaxComparison !== 'function') {
      return { totalWithStrategy: Infinity, totalBaseline: 0, totalSavings: 0, rows: [] };
    }
    var horizon = gainByYear.length;
    var schedule = [];
    for (var i = 0; i < horizon; i++) {
      // Recapture (ordinary) is forced into Y1 only.  We model it by
      // bumping ordinary income in Y1 by the recapture amount.
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

    var defaultYear1 = (function () {
      if (cfg && cfg.year1) return Number(cfg.year1);
      if (cfg && cfg.implementationDate) {
        var m = String(cfg.implementationDate).match(/^(\d{4})/);
        if (m) return Number(m[1]);
      }
      return new Date().getFullYear();
    })();

    // Build a per-year ordinary-income override that bumps Y1 by recapture.
    var ordByYear = [];
    for (var oy = 0; oy < horizon; oy++) {
      var base = (cfg && cfg.ordinaryByYear && cfg.ordinaryByYear[oy] != null)
        ? _num(cfg.ordinaryByYear[oy], 0)
        : _num(cfg && cfg.baseOrdinaryIncome, 0);
      if (oy === 0) base += _num(recaptureY1, 0);
      ordByYear.push(base);
    }
    var scoreCfg = Object.assign({}, cfg, {
      horizonYears: horizon,
      year1: defaultYear1,
      ordinaryByYear: ordByYear
    });

    var cmp = root.computeTaxComparison(scoreCfg, rec);
    return {
      totalWithStrategy: cmp.totalWithStrategy,
      totalBaseline: cmp.totalBaseline,
      totalSavings: cmp.totalSavings,
      rows: cmp.rows
    };
  }

  // -------------------------------------------------------------------
  // Main entry point
  // -------------------------------------------------------------------
  function optimizeStructuredSale(opts) {
    opts = opts || {};
    var cfg = opts.cfg || {};
    var stage2 = opts.stage2 || {};

    var capByYear = (stage2.capByYear || []).map(function (v) { return _num(v, 0); });
    var horizon = capByYear.length;
    var lossRate = _num(stage2.capLossRate, 0);

    // Split LTCG (deferrable) from recapture (forced Y1, ordinary).
    var ltcg = _num(cfg && cfg.longTermGain, NaN);
    var recapture = _num(cfg && cfg.recapture, NaN);
    if (!Number.isFinite(ltcg) || !Number.isFinite(recapture)) {
      // Fall back: derive from sale price / basis / accelerated dep.
      var sp = _num(cfg && cfg.salePrice, 0);
      var cb = _num(cfg && cfg.costBasis, 0);
      var ad = _num(cfg && cfg.acceleratedDepreciation, 0);
      ltcg = Math.max(0, sp - cb - ad);
      recapture = Math.max(0, ad);
    }
    var totalGain = ltcg + recapture;
    var totalCapital = _num(cfg && cfg.investedCapital, 0);

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

    // 15-month hold: which year-indices are legal payout slots?
    var year1 = _num(cfg && cfg.year1, 0) || (function () {
      if (cfg && cfg.implementationDate) {
        var m = String(cfg.implementationDate).match(/^(\d{4})/);
        if (m) return Number(m[1]);
      }
      return new Date().getFullYear();
    })();
    var earliestSlot = _earliestPayoutIndex(cfg && cfg.implementationDate, year1);
    // Optional max-deferral cap (default 5 years total horizon).
    var maxDeferIdx = _num(cfg && cfg.maxStructuredYearIndex, horizon - 1);
    if (maxDeferIdx >= horizon) maxDeferIdx = horizon - 1;
    var legalSlots = new Array(horizon);
    for (var ls = 0; ls < horizon; ls++) {
      legalSlots[ls] = (ls === 0) || (ls >= earliestSlot && ls <= maxDeferIdx);
    }

    // Recapture is *not* deferrable -- recognize all of it in Y1.
    // The optimizer schedules only the LTCG portion across the legal
    // payout slots.
    var leverageByYear = stage2.leverageByYear ||
      _zeros(horizon).map(function () {
        return stage2.leverageUsed != null ? stage2.leverageUsed : null;
      });

    // Build candidate gain schedules (LTCG only).
    var rawCandidates = [
      Object.assign({ name: 'greedy-frontload' }, _scheduleGreedy(ltcg, capByYear, legalSlots)),
      Object.assign({ name: 'proportional' },    _scheduleProportional(ltcg, capByYear, legalSlots)),
      Object.assign({ name: 'defer-all' },       _scheduleDeferAll(ltcg, capByYear, legalSlots, earliestSlot)),
      Object.assign({ name: 'backload' },        _scheduleBackload(ltcg, capByYear, legalSlots)),
      Object.assign({ name: 'balanced-2yr' },    _scheduleBalancedTwo(ltcg, capByYear, legalSlots, earliestSlot))
    ];

    // For each gain schedule, score under both investment policies.
    var investmentPolicies = ['match', 'front'];
    var scored = [];

    for (var i = 0; i < rawCandidates.length; i++) {
      var c = rawCandidates[i];
      // Loss is 1:1 with gain (Brooklyn losses are short-term and we
      // sized capacity from the chosen leverage's loss rate).  Recapture
      // is also offset dollar-for-dollar by Y1 Brooklyn losses.
      var lossPerYear = c.gainByYear.slice();
      // Y1 also needs to absorb recapture (ordinary income) -- raise Y1
      // loss to cover recapture too, capped at Y1 capacity.
      lossPerYear[0] = Math.min(_num(capByYear[0], 0), (lossPerYear[0] || 0) + recapture);

      for (var p = 0; p < investmentPolicies.length; p++) {
        var policy = investmentPolicies[p];
        var invByYear = _investmentByYear(policy, lossPerYear, capByYear, totalCapital, lossRate);

        // Per-year fee = invested-this-year * feeRate using the unified
        // fee-split regression (single source of truth across solvers).
        // Stage2 feeRate is honored when supplied (it's already from
        // the regression); otherwise compute from leverageUsed.
        var feeRate = _num(stage2.feeRate, 0);
        if (!feeRate && stage2.leverageUsed != null && typeof root.brooklynPctsForLeverage === 'function' && typeof root.brooklynFeeRateFor === 'function') {
          var pcts = root.brooklynPctsForLeverage(cfg.strategyKey || 'beta1', stage2.leverageUsed);
          if (pcts && pcts.longPct != null && pcts.shortPct != null) {
            feeRate = root.brooklynFeeRateFor(pcts.longPct, pcts.shortPct);
          }
        }
        var feeByYear = invByYear.map(function (v) { return v * feeRate; });
        var totalFees = feeByYear.reduce(function (a, b) { return a + b; }, 0);

        var s = _scoreSchedule(cfg, c.gainByYear, lossPerYear, leverageByYear, recapture);

        scored.push({
          name: c.name + '/' + policy,
          schedule: c.name,
          policy: policy,
          gainByYear: c.gainByYear.slice(),
          lossByYear: lossPerYear,
          investmentByYear: invByYear,
          feeByYear: feeByYear,
          totalFees: totalFees,
          leftoverGain: c.leftover,
          totalWithStrategy: s.totalWithStrategy,
          totalBaseline: s.totalBaseline,
          totalSavings: s.totalSavings,
          // Combined cost = post-strategy tax + fees.  This is what we
          // truly want to minimize for the client.
          combinedCost: (s.totalWithStrategy || 0) + totalFees
        });
      }
    }

    // Filter out illegal schedules (ones that recognize more than 0 in
    // an illegal slot, which shouldn't happen if scheduling is correct).
    // Then prefer fully-absorbed schedules; among those, pick lowest
    // combinedCost.
    var fullyAbsorbed = scored.filter(function (s) { return s.leftoverGain <= 0.01; });
    var pool = fullyAbsorbed.length ? fullyAbsorbed : scored;
    pool.sort(function (a, b) {
      if (Math.abs(a.leftoverGain - b.leftoverGain) > 0.01) {
        return a.leftoverGain - b.leftoverGain;
      }
      return a.combinedCost - b.combinedCost;
    });
    var chosen = pool[0];

    // Shortfall handling: any LTCG that couldn't be scheduled within
    // the horizon will eventually need to be recognized.  Project a
    // balloon recognition the year after horizon for transparency.
    var shortfallGain = Math.max(0, chosen.leftoverGain);
    var shortfallTax = 0;
    if (shortfallGain > 0 && typeof root.computeTaxComparison === 'function') {
      try {
        var balloonY = year1 + horizon;
        var balloonOrd = _num(cfg && cfg.baseOrdinaryIncome, 0);
        var ts = root.computeTaxComparison(
          { year1: balloonY, horizonYears: 1, filingStatus: (cfg && cfg.filingStatus) || 'mfj', state: (cfg && cfg.state) || 'NY', baseOrdinaryIncome: balloonOrd },
          { recommendation: 'single-year', longTermGain: shortfallGain, lossGenerated: 0 }
        );
        var bts = root.computeTaxComparison(
          { year1: balloonY, horizonYears: 1, filingStatus: (cfg && cfg.filingStatus) || 'mfj', state: (cfg && cfg.state) || 'NY', baseOrdinaryIncome: balloonOrd },
          { recommendation: 'single-year', longTermGain: 0, lossGenerated: 0 }
        );
        var w = (ts && ts.rows && ts.rows[0] && ts.rows[0].withStrategy) ? _num(ts.rows[0].withStrategy.total, 0) : 0;
        var n = (bts && bts.rows && bts.rows[0] && bts.rows[0].withStrategy) ? _num(bts.rows[0].withStrategy.total, 0) : 0;
        shortfallTax = Math.max(0, w - n);
      } catch (e) {
        shortfallTax = shortfallGain * 0.288; // conservative LTCG+NIIT+state fallback
      }
    }

    // Compute a no-deferral baseline for comparison: recognize the
    // entire LTCG in Y1, full Brooklyn capital in Y1, score it.
    var noDeferGain = _zeros(horizon); noDeferGain[0] = ltcg;
    var noDeferLoss = _zeros(horizon); noDeferLoss[0] = Math.min(_num(capByYear[0], 0), ltcg + recapture);
    var noDeferInv = _zeros(horizon); noDeferInv[0] = totalCapital;
    var noDeferFeeRate = _num(stage2.feeRate, 0);
    if (!noDeferFeeRate && typeof root.brooklynInterpolate === 'function' && stage2.leverageUsed != null) {
      var info2 = root.brooklynInterpolate(cfg.strategyKey || 'beta1', stage2.leverageUsed);
      if (info2 && info2.feeRate) noDeferFeeRate = info2.feeRate;
    }
    var noDeferFees = totalCapital * noDeferFeeRate;
    var noDeferScore = _scoreSchedule(cfg, noDeferGain, noDeferLoss, leverageByYear, recapture);
    var noDeferCombined = (noDeferScore.totalWithStrategy || 0) + noDeferFees;

    // If no deferral is actually cheaper, use it.
    if (noDeferCombined + 0.01 < chosen.combinedCost) {
      chosen = {
        name: 'no-deferral/front',
        schedule: 'no-deferral',
        policy: 'front',
        gainByYear: noDeferGain.slice(),
        lossByYear: noDeferLoss.slice(),
        investmentByYear: noDeferInv.slice(),
        feeByYear: noDeferInv.map(function (v) { return v * noDeferFeeRate; }),
        totalFees: noDeferFees,
        leftoverGain: 0,
        totalWithStrategy: noDeferScore.totalWithStrategy,
        totalBaseline: noDeferScore.totalBaseline,
        totalSavings: noDeferScore.totalSavings,
        combinedCost: noDeferCombined
      };
      shortfallGain = 0;
      shortfallTax = 0;
    } else {
      // Add the no-deferral row into `scored` so the UI scoreboard shows
      // it as a comparison.
      scored.push({
        name: 'no-deferral/front',
        schedule: 'no-deferral',
        policy: 'front',
        gainByYear: noDeferGain.slice(),
        lossByYear: noDeferLoss.slice(),
        investmentByYear: noDeferInv.slice(),
        feeByYear: noDeferInv.map(function (v) { return v * noDeferFeeRate; }),
        totalFees: noDeferFees,
        leftoverGain: 0,
        totalWithStrategy: noDeferScore.totalWithStrategy,
        totalBaseline: noDeferScore.totalBaseline,
        totalSavings: noDeferScore.totalSavings,
        combinedCost: noDeferCombined
      });
    }

    // Build the structured-product payout schedule (Y1 amounts are
    // recognized at sale; Y2..N are Jan-1 payouts from the product).
    var productPayouts = chosen.gainByYear.map(function (g, idx) {
      return {
        year: idx,
        yearAbsolute: year1 + idx,
        payoutDate: idx === 0 ? 'sale-date' : ('jan-1-' + (year1 + idx)),
        amount: g,
        legal: legalSlots[idx]
      };
    });
    var initialDeposit = Math.max(0, ltcg - (chosen.gainByYear[0] || 0));

    return Object.assign({}, stage2, {
      gainByYear: chosen.gainByYear,
      lossByYear: chosen.lossByYear,
      investmentByYear: chosen.investmentByYear,
      feeByYear: chosen.feeByYear,
      totalFees: chosen.totalFees,
      recommendation: stage2.feasible === false ? 'multi-year-shortfall' : 'multi-year',
      structured: {
        enabled: true,
        chosen: chosen.name,
        chosenSchedule: chosen.schedule,
        chosenPolicy: chosen.policy,
        chosenTax: chosen.totalWithStrategy + shortfallTax,
        chosenSavings: chosen.totalSavings - shortfallTax,
        combinedCost: chosen.combinedCost + shortfallTax,
        ltcgScheduled: ltcg,
        recaptureY1: recapture,
        shortfallGain: shortfallGain,
        shortfallTax: shortfallTax,
        earliestPayoutYearIndex: earliestSlot,
        earliestPayoutYear: year1 + earliestSlot,
        legalSlots: legalSlots,
        candidates: scored,
        productPayouts: productPayouts,
        initialDeposit: initialDeposit,
        notes: 'Recapture recognized in Y1 as ordinary income; LTCG scheduled across legal Jan-1 payout slots.  15-month minimum hold from sale date enforced.'
      }
    });
  }

  root.optimizeStructuredSale = optimizeStructuredSale;
})(window);
