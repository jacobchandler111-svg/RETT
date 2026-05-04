// js/00-data/schwab-strategies.js
// Charles Schwab-only strategy / leverage / loss-curve catalog.
//
// Per Schwab restriction (2026-05-04): Schwab will only run Beta 1
// at two specific leverage combos — 145/45 and 200/100. The other
// strategies (Beta 0, Beta 0.5, Advisor Managed) and any continuous /
// variable leverage are NOT permitted on the Schwab side. The two
// combos below are the only Schwab paths the projection engine
// considers; the optimizer's auto-pick on Schwab evaluates only
// these two short percentages (45% and 100%).
//
// Each combo carries:
//   - strategyKey       : 'beta1' (Schwab is beta1-only)
//   - leverageLabel     : human-readable Brooklyn notation: '145/45' or '200/100'
//   - leverage          : numeric short-pct fraction (45% short -> 0.45)
//                         used for legacy plumbing only; the loss math here
//                         already has leverage BAKED INTO the tranche values.
//   - longPct, shortPct : long/short percentages for display
//   - lossByYear        : 10-element array. Each value is the
//                         per-year loss-as-fraction-of-invested-capital that
//                         a dollar generates while it sits in tranche N
//                         (where tranche N runs from day 365*(N-1) to
//                         day 365*N from the implementation date).
//                         **Leverage is already baked into these factors.**
//   - feeRate           : annual fee as fraction of invested capital
//   - minInvestment     : Schwab-required minimum investment for this combo
//
// The 365-day tranche model: when a client deposits on date D, days
// 0..364 from D are taxed at lossByYear[0]; days 365..729 use lossByYear[1];
// and so on. A tax-year cuts across one or two tranches; the realized loss
// for that year is the day-weighted blend.
//
// Leverage-baked rule (CRITICAL):
//   When a Schwab combo is selected, the projection engine must NOT
//   multiply the lossRate by cfg.leverage again. The combo's loss factor
//   IS the final loss / invested-capital. Consumers gate the extra
//   multiplier on whether _schwabCombo is truthy. (The earlier
//   leverageBaked: true property was unused metadata and was removed
//   to avoid the appearance of a feature flag — see Issue #41.)
//
// Source: Charles Schwab strategy schedule (provided 2026-04-29).
// Numbers are exact — do not interpolate or round.
(function (root) {
  'use strict';

  var SCHWAB_COMBOS = {
    beta1_145_45: {
      id: 'beta1_145_45',
      strategyKey: 'beta1',
      strategyLabel: 'Beta 1 (S&P 500)',
      leverageLabel: '145/45',
      leverage: 0.45,
      longPct: 145,
      shortPct: 45,
      lossByYear: [0.322, 0.268, 0.233, 0.214, 0.212, 0.205, 0.197, 0.191, 0.186, 0.181],
      feeRate: 0.0094,
      minInvestment: 1000000,
    },
    beta1_200_100: {
      id: 'beta1_200_100',
      strategyKey: 'beta1',
      strategyLabel: 'Beta 1 (S&P 500)',
      leverageLabel: '200/100',
      leverage: 1.00,
      longPct: 200,
      shortPct: 100,
      lossByYear: [0.590, 0.492, 0.427, 0.393, 0.389, 0.376, 0.363, 0.351, 0.342, 0.334],
      feeRate: 0.0203,
      minInvestment: 3000000
    }
  };

  // Ordered list for dropdown population.
  var SCHWAB_COMBO_ORDER = [
    'beta1_145_45',
    'beta1_200_100'
  ];

  function listSchwabCombos() {
    return SCHWAB_COMBO_ORDER.map(function (k) { return SCHWAB_COMBOS[k]; });
  }

  function getSchwabCombo(comboId) {
    if (!comboId) return null;
    return SCHWAB_COMBOS[comboId] || null;
  }

  function listSchwabCombosForStrategy(strategyKey) {
    return listSchwabCombos().filter(function (c) { return c.strategyKey === strategyKey; });
  }

  // Resolve a (strategyKey, leverageLabel) pair to a combo, if Schwab allows it.
  function findSchwabCombo(strategyKey, leverageLabel) {
    var matches = listSchwabCombos().filter(function (c) {
      return c.strategyKey === strategyKey && c.leverageLabel === leverageLabel;
    });
    return matches[0] || null;
  }

  // Parse a YYYY-MM-DD string or pass through a Date. Delegates to the
  // shared parseLocalDate (loaded from date-utils.js ahead of this file
  // in index.html). The fallback inline parser stays as a safety net.
  function _toDate(d) {
    if (!d) return new Date();
    if (d instanceof Date) return d;
    if (typeof window.parseLocalDate === 'function') return window.parseLocalDate(d);
    var parts = String(d).split(/[-/T]/);
    return new Date(
      parseInt(parts[0], 10),
      parseInt(parts[1], 10) - 1,
      parseInt(parts[2], 10) || 1
    );
  }

  // Days between two Date objects (a < b expected; returns >= 0).
  function _daysBetween(a, b) {
    var ms = b.getTime() - a.getTime();
    return Math.max(0, ms / 86400000);
  }

  // Compute per-tax-year effective loss rate for a Schwab combo.
  //
  // Inputs:
  //   comboId           - Schwab combo id
  //   implementationDate - YYYY-MM-DD or Date when Brooklyn was funded
  //   horizonYears      - number of tax years to project (e.g. 5)
  //
  // Output:
  //   number[] of length horizonYears. Each element is the loss as a
  //   fraction of invested capital realized in that tax year, blending
  //   the appropriate 365-day tranches based on day count.
  //
  // Algorithm:
  //   For each tax year y, determine days [startOfYear, endOfYear).
  //   For each day in that range, find which tranche it falls into:
  //     tranche index = floor((day - implementationDate) / 365)
  //   Sum (1/365) * lossByYear[trancheIndex] across all days; that's
  //   the year's effective loss rate. Days before implementationDate
  //   contribute 0. Days past tranche 9 (year 10) reuse the last
  //   value in lossByYear (graceful long-hold extension).
  function schwabLossRateByYear(comboId, implementationDate, horizonYears) {
    var combo = getSchwabCombo(comboId);
    if (!combo) return null;
    var impl = _toDate(implementationDate);
    var implYear = impl.getFullYear();
    var horizon = Math.max(1, horizonYears | 0);
    var lbY = combo.lossByYear;
    var lastIdx = lbY.length - 1;

    var rates = [];
    for (var y = 0; y < horizon; y++) {
      var taxYear = implYear + y;
      var yearStart = new Date(taxYear, 0, 1);
      var yearEnd = new Date(taxYear + 1, 0, 1); // exclusive
      var dayStart = (yearStart < impl) ? impl : yearStart;
      var totalDays = _daysBetween(dayStart, yearEnd);
      if (totalDays <= 0) { rates.push(0); continue; }

      // Walk day by day at month-resolution boundaries: actually walk by
      // tranche boundary. Find current tranche start day-from-impl, then
      // step by min(remaining-days-in-tranche, remaining-days-in-year).
      var sumWeighted = 0;
      var cursor = new Date(dayStart);
      while (cursor < yearEnd) {
        var daysFromImpl = _daysBetween(impl, cursor);
        var trancheIdx = Math.floor(daysFromImpl / 365);
        // Past the 10-year curve: no more losses generated for this combo.
        if (trancheIdx > lastIdx) { cursor = yearEnd; continue; }
        var trancheStartDay = trancheIdx * 365;
        var trancheEndDay = (trancheIdx + 1) * 365;
        var daysLeftInTranche = trancheEndDay - daysFromImpl;
        // If the cursor sits exactly on a tranche boundary
        // (daysLeftInTranche === 0), Math.max(1, 0) would step
        // forward 1ms still inside the previous tranche before
        // flipping. Force a full-tranche step so the math advances
        // cleanly into the next tranche. Negligible numerically but
        // it keeps the year-on-year-Jan-1 case land exactly on the
        // published lossByYear curve.
        if (daysLeftInTranche <= 0) daysLeftInTranche = 365;
        var msStep = daysLeftInTranche * 86400000;
        var stepEnd = new Date(cursor.getTime() + msStep);
        if (stepEnd > yearEnd) stepEnd = yearEnd;
        var daysInStep = _daysBetween(cursor, stepEnd);
        sumWeighted += (daysInStep / 365) * lbY[trancheIdx];
        cursor = stepEnd;
      }
      rates.push(sumWeighted);
    }
    return rates;
  }

  root.SCHWAB_COMBOS = SCHWAB_COMBOS;
  root.SCHWAB_COMBO_ORDER = SCHWAB_COMBO_ORDER;
  root.listSchwabCombos = listSchwabCombos;
  root.getSchwabCombo = getSchwabCombo;
  root.listSchwabCombosForStrategy = listSchwabCombosForStrategy;
  root.findSchwabCombo = findSchwabCombo;
  root.schwabLossRateByYear = schwabLossRateByYear;
})(window);
