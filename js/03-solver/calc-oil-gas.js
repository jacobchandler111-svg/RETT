// FILE: js/03-solver/calc-oil-gas.js
// Year-1 Oil & Gas Working Interest math.
//
// Mechanism: a direct working-interest investment lets the IRS expense
// 75–95% of the first-year capital as Intangible Drilling Costs (IDC)
// per IRC §263(c) / §469(c)(3). IDC creates an ABOVE-THE-LINE ordinary
// deduction (not a capital loss), so it offsets W-2, K-1 ordinary,
// rental, and other ordinary income — exactly the bucket Brooklyn
// CANNOT touch (Brooklyn produces capital losses, capped at $3K/yr
// against ordinary).
//
// Year-1 contract (this file): take an investment amount + IDC%, lower
// ordinary income by deduction = investment * idcPct, re-run the
// existing federal + state engine, return delta vs baseline.
//
// NOT modeled in v1 (intentional, see Brookhaven multi-year plan):
//   - TDC depreciation (7-year MACRS) in year 2..N
//   - Production income + 15% percentage depletion in year 2..N
//   - AMT preference on excess IDC over 10-year amortization
//   - Recapture on sale / abandonment (1231 / IDC recapture)
//   - Decline curve (Arps hyperbolic)
// These layer on once we have a multi-year lot tracker. The Year-1
// figure produced here may OVERSTATE savings for AMT-bound clients
// (AMT preference is the most common omission). Surface the caveat
// in the UI so the advisor knows the figure is a Year-1 best case.

(function (root) {
  'use strict';

  function _val(id) {
    var el = document.getElementById(id);
    return el ? el.value : '';
  }
  function _num(id) {
    var raw = _val(id);
    var v = (typeof parseUSD === 'function') ? parseUSD(raw) : Number(raw);
    return Number.isFinite(v) ? v : 0;
  }
  function _safe(id) { return Math.max(0, _num(id)); }

  // Read the same baseline the live "Tax If You Did Nothing" panel
  // reads on Page 1. Single source of truth: the form fields. Keeping
  // the read-shape in sync with baseline-table.js means a change to
  // either flows through both panels identically.
  function readBaselineSnapshot() {
    var year   = parseInt(_val('year1'), 10) || (new Date()).getFullYear();
    var status = _val('filing-status') || 'mfj';
    var state  = _val('state-code') || 'NONE';

    var ordIds = ['w2-wages', 'se-income', 'biz-revenue',
                  'rental-income', 'dividend-income',
                  'retirement-distributions'];
    var ordTotal = 0;
    for (var i = 0; i < ordIds.length; i++) ordTotal += _safe(ordIds[i]);

    var stGain = _safe('short-term-gain');
    var sale   = _safe('sale-price');
    var basis  = _safe('cost-basis');
    var depr   = _safe('accelerated-depreciation');
    // Long-term gain is signed — sale at a loss is a real §1211(b) item.
    var ltGain = sale - basis - depr;
    var recap  = depr;          // depreciation recapture is ordinary

    var wages  = _safe('w2-wages');
    var seInc  = _safe('se-income');
    var niitBase = Math.max(0, ltGain) + stGain
                 + _safe('rental-income') + _safe('dividend-income');

    return {
      year: year, status: status, state: state,
      ordTotal: ordTotal, recap: recap,
      stGain: stGain, ltGain: ltGain,
      wages: wages, seInc: seInc, niitBase: niitBase
    };
  }

  // Run the federal + state pipeline at a given ordinary-income level.
  // Mirrors baseline-table.js exactly so the "do nothing" total here
  // ties out byte-equal to what the user sees on Page 1.
  function _totalTaxAt(snap, ordOverride) {
    if (typeof computeFederalTaxBreakdown !== 'function' ||
        typeof computeStateTax !== 'function') {
      return { fed: 0, state: 0, niit: 0, addmed: 0, seTax: 0, total: 0 };
    }
    var ord = (ordOverride == null) ? (snap.ordTotal + snap.recap) : ordOverride;
    var fedB = computeFederalTaxBreakdown(ord, snap.year, snap.status, {
      longTermGain:    snap.ltGain,
      shortTermGain:   snap.stGain,
      investmentIncome: snap.niitBase,
      wages:           snap.wages,
      seIncome:        snap.seInc
    }) || {};
    var fedOrd = Number(fedB.ordinaryTax) || 0;
    var fedLt  = Number(fedB.ltTax)       || 0;
    var amt    = Number(fedB.amtTopUp)    || 0;
    var niit   = Number(fedB.niit)        || 0;
    var addmed = Number(fedB.addlMedicare)|| 0;
    var seTax  = Number(fedB.seTax)       || 0;
    var fedTotal = fedOrd + fedLt + amt;
    var stateTax = computeStateTax(
      ord + Math.max(0, snap.ltGain) + snap.stGain,
      snap.year, snap.state, snap.status,
      { longTermGain: Math.max(0, snap.ltGain), shortTermGain: snap.stGain }
    ) || 0;
    return {
      fed: fedTotal, state: stateTax,
      niit: niit, addmed: addmed, seTax: seTax,
      total: fedTotal + niit + addmed + seTax + stateTax
    };
  }

  // Normalize a raw IDC % (passed as 0-1 fraction or 0-100 integer)
  // into a clamped 0-1 fraction. Centralized so the year-1 and multi-
  // year entry points agree on the input shape.
  function _normIdcPct(raw) {
    var v = Number(raw);
    if (!Number.isFinite(v)) v = 0.95;
    var f = v > 1 ? v / 100 : v;
    if (f < 0) f = 0;
    if (f > 1) f = 1;
    return f;
  }

  // Compute Year-1 IDC impact for a single (investment, idcPct) row.
  // Helper used by both single-year and multi-year entry points.
  // snap is the baseline snapshot (so callers can share one read of
  // the form across N rows and keep the math self-consistent).
  function _computeYearImpact(snap, investment, idcPct) {
    var ordBaseline = snap.ordTotal + snap.recap;
    var deduction = Math.max(0, investment) * idcPct;
    var absorbed = Math.min(deduction, Math.max(0, ordBaseline));
    var nolGenerated = Math.max(0, deduction - Math.max(0, ordBaseline));
    var newOrd = Math.max(0, ordBaseline - deduction);
    var baseline  = _totalTaxAt(snap, null);
    var optimized = _totalTaxAt(snap, newOrd);
    return {
      investment:     investment,
      idcPct:         idcPct,
      deduction:      deduction,
      absorbed:       absorbed,
      nolGenerated:   nolGenerated,
      ordBaseline:    ordBaseline,
      ordOptimized:   newOrd,
      baselineTotal:  baseline.total,
      optimizedTotal: optimized.total,
      totalSaved:     Math.max(0, baseline.total - optimized.total),
      fedSaved:       baseline.fed   - optimized.fed,
      stateSaved:     baseline.state - optimized.state,
      niitDelta:      baseline.niit  - optimized.niit,
      addmedDelta:    baseline.addmed - optimized.addmed
    };
  }

  // Single-year entry point. params = { investment, idcPct }.
  function computeOilGasYear1(params) {
    params = params || {};
    var investment = Math.max(0, Number(params.investment) || 0);
    var idcPct = _normIdcPct(params.idcPct);
    var snap = readBaselineSnapshot();
    return _computeYearImpact(snap, investment, idcPct);
  }

  // Multi-year entry point. years = [{ investment, idcPct, includeRecap }, ...]
  // Each row carries its own per-year snapshot signal:
  //   • includeRecap (default true for back-compat) — when false, the
  //     §1250 recapture is removed from the year's ordinary-income
  //     baseline. Per §453(i) recapture is recognized in Y0 only, so
  //     Y1+ rows of a multi-year deployment (Strategy B/C) should pass
  //     includeRecap: false. Without this, recap was double-counted
  //     across every recognition year.
  //
  // NOL carryforward: when a year's deduction exceeds that year's
  // ordinary baseline, the excess (nolGenerated) used to be reported
  // as "wasted." Per §172, that NOL carries forward to reduce the
  // following year's ordinary income. Apply that reduction here so
  // a 2-yr B or 4-yr C deployment doesn't lose the trailing
  // deduction value.
  //
  // Updated 2026-05-08: the prior behavior held all years to the SAME
  // Y0 baseline (frozen pre-NOL, recap-included) per a 2026-05-05
  // advisor decision. That decision was reversed when multi-year supp
  // deployment for B/C became a priority — see the "supplemental
  // multi-year" engine prompt of 2026-05-08.
  function computeOilGasMultiYear(years) {
    if (!Array.isArray(years) || years.length === 0) {
      return {
        perYear: [], totalInvestment: 0, totalDeduction: 0,
        totalSaved: 0, totalAbsorbed: 0, totalNolGenerated: 0,
        baselineTotalY1: 0
      };
    }
    var snap = readBaselineSnapshot();
    var baselineY1 = _totalTaxAt(snap, null).total;
    var carryNol = 0;
    var perYear = years.map(function (y) {
      var inv = Math.max(0, Number(y && y.investment) || 0);
      var pct = _normIdcPct(y && y.idcPct);
      // Y0 keeps recap unless explicitly excluded; Y1+ defaults to
      // exclude. Callers that don't pass the flag (legacy single-
      // year shape) get recap-included behavior.
      var includeRecap = (y && y.includeRecap === false) ? false : true;
      var yearSnap = Object.assign({}, snap, {
        recap:    includeRecap ? snap.recap : 0,
        // §172 NOL carry: prior year's residual deduction reduces this
        // year's ordinary income before computing absorption.
        ordTotal: Math.max(0, snap.ordTotal - carryNol)
      });
      var impact = _computeYearImpact(yearSnap, inv, pct);
      // Echo the flag in the output so downstream consumers (Tab 7,
      // stress-test invariants, future per-year UI) can read it without
      // re-deriving from the input years[] array.
      impact.includeRecap = includeRecap;
      // Track NOL: only the portion that exceeds the (already-NOL-
      // reduced) baseline becomes the next year's carry.
      carryNol = Math.max(0, Number(impact.nolGenerated) || 0);
      return impact;
    });
    var sum = function (key) {
      return perYear.reduce(function (s, r) { return s + (Number(r[key]) || 0); }, 0);
    };
    return {
      perYear:           perYear,
      totalInvestment:   sum('investment'),
      totalDeduction:    sum('deduction'),
      totalAbsorbed:     sum('absorbed'),
      // Residual NOL after the last year — the truly unused
      // deduction. Earlier years' NOL was carried forward and absorbed
      // (or partially absorbed) in subsequent years; only what's left
      // at the tail is wasted.
      totalNolGenerated: carryNol,
      totalSaved:        sum('totalSaved'),
      totalFedSaved:     sum('fedSaved'),
      totalStateSaved:   sum('stateSaved'),
      baselineTotalY1:   baselineY1
    };
  }

  // Per-year yield-sorted allocator. Splits a single maxInvestment budget
  // across N recognition years to maximize total tax savings, instead of
  // even-splitting (the prior behavior, which underweighted Y0 — where
  // §1250 recap drives a higher marginal ordinary rate — and overweighted
  // Y1+ — where extra deduction becomes wasted NOL).
  //
  // Algorithm: chunked greedy. Discretize the budget into CHUNK_COUNT
  // chunks; for each chunk, place it in the year that gives the biggest
  // incremental totalSaved bump (running computeOilGasMultiYear with the
  // tentative allocation). Stop early once no year yields positive gain
  // — that's the user's "positive-net-only gate" applied on the time
  // dimension.
  //
  // yearMeta: array of N { includeRecap: bool } describing per-year
  // baseline shape (Y0 includes §1250 recap, Y1+ doesn't). Returns a
  // `years` array suitable for passing to computeOilGasMultiYear.
  function optimizeOilGasMultiYear(maxInvestment, idcPct, yearMeta) {
    var N = (yearMeta && yearMeta.length) || 0;
    if (N === 0) return [];
    var pct = _normIdcPct(idcPct);
    var years = yearMeta.map(function (m) {
      return { investment: 0, idcPct: pct, includeRecap: !!(m && m.includeRecap) };
    });
    if (!(maxInvestment > 0)) return years;
    if (N === 1) { years[0].investment = maxInvestment; return years; }

    var CHUNK_COUNT = 25;          // 4% allocation granularity
    var chunkSize = maxInvestment / CHUNK_COUNT;
    if (!(chunkSize > 0)) return years;

    var prev = computeOilGasMultiYear(years).totalSaved || 0;
    for (var c = 0; c < CHUNK_COUNT; c++) {
      var bestIdx = -1, bestGain = 0;
      for (var i = 0; i < N; i++) {
        // Save/restore avoids the FP drift that += / -= on irrational
        // chunkSize accumulates across many iterations.
        var origI = years[i].investment;
        years[i].investment = origI + chunkSize;
        var trial = computeOilGasMultiYear(years).totalSaved || 0;
        var gain = trial - prev;
        years[i].investment = origI;
        if (gain > bestGain) { bestGain = gain; bestIdx = i; }
      }
      if (bestIdx < 0) break;       // no positive gain anywhere — stop
      years[bestIdx].investment = years[bestIdx].investment + chunkSize;
      prev += bestGain;
    }
    return years;
  }

  root.computeOilGasYear1       = computeOilGasYear1;
  root.computeOilGasMultiYear   = computeOilGasMultiYear;
  root.optimizeOilGasMultiYear  = optimizeOilGasMultiYear;
  root.readSupplementalBaselineSnapshot = readBaselineSnapshot;
})(window);
