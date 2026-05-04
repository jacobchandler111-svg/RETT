// js/03-solver/multi-year-solver.js
// Stage-2 solver for the two-stage decision tree, with partial-year
// time-weighting in year 1.
//
// Year-1 capacity = invested * lossRate(cap) * yearFraction
// Years 2..N capacity = invested * lossRate(cap)              (full year)
//
// Accepts `totalGain` (preferred) or `gain` (alias) as the dollars to
// distribute. Reports leverageUsed as the EFFECTIVE leverage (clamped
// to the strategy's max tier), not the raw cap value.

(function (root) {
  'use strict';

  function invertLossRate(strategyKey, requiredRate) {
    // Guard: NaN / negative input. A negative or NaN required rate
    // is meaningless here (the solver wants a positive loss target).
    // Return the lowest-leverage point so callers don't iterate the
    // full ladder for nothing.
    if (!Number.isFinite(requiredRate) || requiredRate < 0) {
      return null;
    }
    var bounds = (typeof root.getStrategyBounds === 'function')
      ? root.getStrategyBounds(strategyKey)
      : { minShort: 0, maxShort: 225 };
    if (!bounds) return null;
    // Special-case requiredRate <= 0: the minLeverage point already
    // satisfies it, no need to walk.
    if (requiredRate === 0) {
      var minLev = (bounds.minLeverage != null ? bounds.minLeverage : bounds.minShort / 100);
      return { leverage: minLev, info: root.brooklynInterpolate(strategyKey, minLev) };
    }
    for (var s = bounds.minShort; s <= bounds.maxShort; s++) {
      var info = root.brooklynInterpolate(strategyKey, s / 100);
      if (info && info.lossRate >= requiredRate) {
        return { leverage: s / 100, info: info };
      }
    }
    var maxLev = bounds.maxShort / 100;
    return { leverage: maxLev, info: root.brooklynInterpolate(strategyKey, maxLev) };
  }

  function effectiveLeverage(strategyKey, requestedCap) {
    // Clamp the requested cap to the strategy's actual max leverage.
    var bounds = (typeof root.getStrategyBounds === 'function')
      ? root.getStrategyBounds(strategyKey)
      : { minLeverage: 0, maxLeverage: 2.25 };
    if (!bounds) return requestedCap;
    if (requestedCap > bounds.maxLeverage) return bounds.maxLeverage;
    if (requestedCap < bounds.minLeverage) return bounds.minLeverage;
    return requestedCap;
  }

  function solveMultiYear(opts) {
    opts = opts || {};
    var strategyKey      = opts.strategyKey || 'beta1';
    var totalGain        = (opts.totalGain != null) ? Number(opts.totalGain)
                          : (opts.gain != null)     ? Number(opts.gain)
                          : 0;
    var investedCapital  = Number(opts.investedCapital) || 0;
    var requestedCap     = (opts.leverageCap != null) ? Number(opts.leverageCap) : 2.25;
    var horizon          = Number(opts.years) || 5;
    var yfYear1          = (opts.yearFractionYear1 != null) ? Number(opts.yearFractionYear1)
                          : (opts.yearFraction != null)     ? Number(opts.yearFraction)
                          : 1;
    if (yfYear1 < 0) yfYear1 = 0;
    if (yfYear1 > 1) yfYear1 = 1;
    var distribution     = opts.distribution || 'capacity';

    var leverageCap = effectiveLeverage(strategyKey, requestedCap);

    if (totalGain <= 0) {
      return {
        feasible: true,
        recommendation: 'no-action',
        years: 0, yearsUsed: 0, yearsNeeded: 0,
        gainByYear: new Array(horizon).fill(0),
        lossByYear: new Array(horizon).fill(0),
        capByYear:  new Array(horizon).fill(0),
        leverageByYear: new Array(horizon).fill(null),
        capLossRate: 0,
        leverageUsed: 0,
        leverageRequested: requestedCap,
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
      var fillable = Math.min(totalGain, totalCapacity);
      for (var i4 = 0; i4 < horizon; i4++) {
        gainByYear[i4] = capByYear[i4] * (fillable / totalCapacity);
        lossByYear[i4] = gainByYear[i4];
      }
      yearsUsed = horizon;
    }

    for (var i5 = 0; i5 < horizon; i5++) {
      var reqRate = lossByYear[i5] / Math.max(1, investedCapital);
      if (i5 === 0 && yfYear1 > 0) reqRate = reqRate / yfYear1;
      var hit = invertLossRate(strategyKey, reqRate);
      leverageByYear[i5] = hit ? hit.leverage : null;
    }

    var totalLossNeeded = lossByYear.reduce(function (a, b) { return a + b; }, 0);
    // Use the unified fee-split regression so multi-year fees match the
    // dashboard / KPI ribbon. Falls back to info.feeRate if regression
    // isn't loaded (defensive — index.html guarantees it loads first).
    var _feeRate = (typeof root.brooklynFeeRateFor === 'function' && info && info.longPct != null && info.shortPct != null)
      ? root.brooklynFeeRateFor(info.longPct, info.shortPct)
      : (info && info.feeRate ? info.feeRate : 0);
    var totalFees = investedCapital * _feeRate * yearsUsed;

    return {
      feasible: feasibleWithinHorizon,
      recommendation: feasibleWithinHorizon ? 'multi-year' : 'multi-year-shortfall',
      years: yearsUsed,
      yearsUsed: yearsUsed,
      yearsNeeded: feasibleWithinHorizon ? yearsUsed : horizon,
      gainByYear: gainByYear,
      lossByYear: lossByYear,
      capByYear: capByYear,
      leverageByYear: leverageByYear,
      capLossRate: info.lossRate,
      leverageUsed: leverageCap,
      leverageRequested: requestedCap,
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
