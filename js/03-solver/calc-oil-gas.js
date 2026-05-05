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

  // Multi-year entry point. years = [{ investment, idcPct }, ...].
  // Each year's math runs against the SAME Y1 ordinary-income baseline
  // (advisor's instruction 2026-05-05: "keep it as the year-one ordinary
  // income consistent across the years"). When a real per-year ordinary
  // forecast lands, this is the function to extend — pass an array of
  // per-year snapshots instead of one shared snap.
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
    var perYear = years.map(function (y) {
      var inv = Math.max(0, Number(y && y.investment) || 0);
      var pct = _normIdcPct(y && y.idcPct);
      return _computeYearImpact(snap, inv, pct);
    });
    var sum = function (key) {
      return perYear.reduce(function (s, r) { return s + (Number(r[key]) || 0); }, 0);
    };
    return {
      perYear:           perYear,
      totalInvestment:   sum('investment'),
      totalDeduction:    sum('deduction'),
      totalAbsorbed:     sum('absorbed'),
      totalNolGenerated: sum('nolGenerated'),
      totalSaved:        sum('totalSaved'),
      totalFedSaved:     sum('fedSaved'),
      totalStateSaved:   sum('stateSaved'),
      baselineTotalY1:   baselineY1
    };
  }

  root.computeOilGasYear1     = computeOilGasYear1;
  root.computeOilGasMultiYear = computeOilGasMultiYear;
  root.readSupplementalBaselineSnapshot = readBaselineSnapshot;
})(window);
