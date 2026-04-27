// js/03-solver/multi-year-solver.js
// Stage-2 solver for the two-stage decision tree, with partial-year
// time-weighting in year 1.
//
// Year-1 capacity = invested * lossRate(cap) * yearFraction
// Years 2..N capacity = invested * lossRate(cap)              (full year)
//
// Accepts `totalGain` (preferred) or `gain` (alias) as the dollars to
// distribute. Outputs both raw fields and aliases consumed by the
// decision-engine / UI layer (`years`, `leverageUsed`, `leverageLabel`,
// `totalLossNeeded`, `totalFees`).

(function (root) {
  'use strict';

  function invertLossRate(strategyKey, requiredRate) {
    // Walk fine 1% increments and find the lowest leverage tier whose
    // lossRate >= requiredRate. Falls back to max if none satisfy.
    var bounds = (typeof root.getStrategyBounds === 'function')
      ? root.getStrategyBounds(strategyKey)
      : { minShort: 0, maxShort: 225 };
    if (!bounds) return null;
    for (var s = bounds.minShort; s <= bounds.maxShort; s++) {
      var info = root.brooklynInterpolate(strategyKey, s / 100);
      if (info && info.lossRate >= requiredRate) {
        return { leverage: s / 100, info: info };
      }
    }
    var maxLev = bounds.maxShort / 100;
    return { leverage: maxLev, info: root.brooklynInterpolate(strategyKey, maxLev) };
  }

  function solveMultiYear(opts) {
    opts = opts || {};
    var strategyKey      = opts.strategyKey || 'beta1';
    var totalGain        = (opts.totalGain != null) ? Number(opts.totalGain)
                          : (opts.gain != null)     ? Number(opts.gain)
                          : 0;
    var investedCapital  = Number(opts.investedCapital) || 0;
    var leverageCap      = (opts.leverageCap != null) ? Number(opts.leverageCap) : 2.25;
    var horizon          = Number(opts.years) || 5;
    var yfYear1          = (opts.yearFractionYear1 != null) ? Number(opts.yearFractionYear1)
                          : (opts.yearFraction != null)     ? Number(opts.yearFraction)
                          : 1;
    if (yfYear1 < 0) yfYear1 = 0;
    if (yfYear1 > 1) yfYear1 = 1;
    var distribution     = opts.distribution || 'capacity';

    if (totalGain <= 0) {
      return {
        feasible: true,
        years: 0, yearsUsed: 0, yearsNeeded: 0,
        gainByYear: new Array(horizon).fill(0),
        lossByYear: new Array(horizon).fill(0),
        capByYear:  new Array(horizon).fill(0),
        leverageByYear: new Array(horizon).fill(null),
        capLossRate: 0,
        leverageUsed: 0,
        leverageLabel: null,
        annualCap: 0,
        totalLossNeeded: 0,
        totalFees: 0,
        yearFraction: yfYear1,
        note: 'no gain to spread'
      };
    }

    var info = root.brooklynInterpolate(strategyKey, leverageCap);
    if (!info) {
      return { feasible: false, error: 'cannot interpolate at cap leverage ' + leverageCap };
    }

    var annualCap = investedCapital * info.lossRate;
    if (annualCap <= 0) {
      return { feasible: false, error: 'cap leverage produces zero loss' };
    }

    // Per-year loss capacity. Year 1 is partial; years 2..N full.
    var capByYear = [];
    for (var i = 0; i < horizon; i++) {
      capByYear.push(i === 0 ? annualCap * yfYear1 : annualCap);
    }
    var totalCapacity = capByYear.reduce(function (a, b) { return a + b; }, 0);

    var gainByYear = new Array(horizon).fill(0);
    var lossByYear = new Array(horizon).fill(0);
    var leverageByYear = new Array(horizon).fill(null);

    var feasibleWithinHorizon = totalCapacity >= totalGain;
    var yearsUsed = 0;

    if (distribution === 'front') {
      // fill year 1 to capacity, then year 2, etc., until gain is absorbed
      var remaining = totalGain;
      for (var i2 = 0; i2 < horizon && remaining > 0; i2++) {
        var take = Math.min(capByYear[i2], remaining);
        gainByYear[i2] = take;
        lossByYear[i2] = take;
        remaining -= take;
        yearsUsed = i2 + 1;
      }
    } else if (distribution === 'back') {
      var remaining2 = totalGain;
      for (var i3 = horizon - 1; i3 >= 0 && remaining2 > 0; i3--) {
        var take2 = Math.min(capByYear[i3], remaining2);
        gainByYear[i3] = take2;
        lossByYear[i3] = take2;
        remaining2 -= take2;
        yearsUsed = horizon - i3;
      }
    } else {
      // 'capacity' (default): pro-rata by per-year capacity. If capacity
      // covers the gain, each year gets gainByYear = capByYear * (gain /
      // totalCapacity). Otherwise we distribute first by capacity, then
      // overflow goes nowhere (shortfall flagged).
      var fillable = Math.min(totalGain, totalCapacity);
      for (var i4 = 0; i4 < horizon; i4++) {
        gainByYear[i4] = capByYear[i4] * (fillable / totalCapacity);
        lossByYear[i4] = gainByYear[i4];
      }
      yearsUsed = horizon;
    }

    // Per-year required loss rate (loss / invested); look up the variable
    // leverage point that delivers it and record its leverage.
    for (var i5 = 0; i5 < horizon; i5++) {
      var reqRate = lossByYear[i5] / Math.max(1, investedCapital);
      // for year 1 we have to back out the partial-year scaling
      if (i5 === 0 && yfYear1 > 0) reqRate = reqRate / yfYear1;
      var hit = invertLossRate(strategyKey, reqRate);
      leverageByYear[i5] = hit ? hit.leverage : null;
    }

    var totalLossNeeded = lossByYear.reduce(function (a, b) { return a + b; }, 0);
    var totalFees = investedCapital * (info.feeRate || 0) * yearsUsed;

    return {
      feasible: feasibleWithinHorizon,
      years: yearsUsed,
      yearsUsed: yearsUsed,
      yearsNeeded: feasibleWithinHorizon ? yearsUsed : horizon,
      gainByYear: gainByYear,
      lossByYear: lossByYear,
      capByYear: capByYear,
      leverageByYear: leverageByYear,
      capLossRate: info.lossRate,
      leverageUsed: leverageCap,
      leverageLabel: info.label || null,
      annualCap: annualCap,
      totalLossNeeded: totalLossNeeded,
      totalFees: totalFees,
      yearFraction: yfYear1,
      shortfall: Math.max(0, totalGain - totalCapacity),
      note: feasibleWithinHorizon
        ? 'gain fully absorbed within horizon at or below cap leverage'
        : 'gain exceeds capacity within horizon at cap leverage'
    };
  }

  root.solveMultiYear   = solveMultiYear;
  root.invertLossRate   = invertLossRate;
})(window);
