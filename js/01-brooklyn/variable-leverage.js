// js/01-brooklyn/variable-leverage.js
// Variable-leverage solver / lookup.
//
// Each named Brooklyn tier has a long% and short% pair where
//   longPct = 100 + shortPct
//   leverage = shortPct / 100
//
// The original Brookhaven UI exposed sliders that step in 1% increments,
// letting the user pick any (long, short) point along the curve instead
// of being limited to the named tiers. The loss-rate and fee-rate at any
// integer point come from linear interpolation across the regression-fit
// data points, which is what brooklynInterpolate(strategyKey, leverage)
// already does.
//
// This module exposes:
//   getStrategyBounds(strategyKey)  -> { minShort, maxShort, minLong, maxLong, minLeverage, maxLeverage }
//   lookupVariable(strategyKey, shortPct) -> { longPct, shortPct, leverage, lossRate, feeRate, label, minInvestment }
//   solveVariableSingleYear(opts)         -> { ok, point, loss, fees, ... }

(function (root) {
  'use strict';

  // Hardcoded ladder bounds extracted from the regression data points:
  //   beta1, advisorManaged: long-only -> 325/225  (max short = 225)
  //   beta0:                100/100   -> 275/275  (max short = 275)
  //   beta05:               200/100   -> 325/225  (max short = 225, min short = 100)
  var STRATEGY_BOUNDS = {
    beta1:           { minShort: 0,   maxShort: 225 },
    beta0:           { minShort: 100, maxShort: 275 },
    beta05:          { minShort: 100, maxShort: 225 },
    advisorManaged:  { minShort: 0,   maxShort: 225 }
  };

  function getStrategyBounds(strategyKey) {
    var b = STRATEGY_BOUNDS[strategyKey];
    if (!b) return null;
    return {
      minShort: b.minShort,
      maxShort: b.maxShort,
      minLong: 100 + b.minShort,
      maxLong: 100 + b.maxShort,
      minLeverage: b.minShort / 100,
      maxLeverage: b.maxShort / 100
    };
  }

  function lookupVariable(strategyKey, shortPct) {
    var bounds = getStrategyBounds(strategyKey);
    if (!bounds) return null;
    var s = Math.max(bounds.minShort, Math.min(bounds.maxShort, Math.round(shortPct)));
    var leverage = s / 100;
    var interp = (typeof root.brooklynInterpolate === 'function')
      ? root.brooklynInterpolate(strategyKey, leverage)
      : null;
    if (!interp) return null;
    return {
      longPct: 100 + s,
      shortPct: s,
      leverage: leverage,
      lossRate: interp.lossRate,
      feeRate: interp.feeRate,
      label: (100 + s) + '/' + s,
      minInvestment: interp.minInvestment
    };
  }

  function solveVariableSingleYear(opts) {
    opts = opts || {};
    var strategyKey     = opts.strategyKey || 'beta1';
    var gainToOffset    = Number(opts.gainToOffset) || 0;
    var investedCapital = Number(opts.investedCapital) || 0;
    var yf              = (typeof opts.yearFraction === 'number' && isFinite(opts.yearFraction))
                            ? Math.max(0, Math.min(1, opts.yearFraction)) : 1;

    var bounds = getStrategyBounds(strategyKey);
    if (!bounds) return { ok: false, reason: 'no-bounds' };

    var tested = [];
    var chosen = null;

    for (var s = bounds.minShort; s <= bounds.maxShort; s++) {
      var pt = lookupVariable(strategyKey, s);
      if (!pt) continue;
      var weightedRate = pt.lossRate * yf;
      var loss = investedCapital * weightedRate;
      // Use the unified fee-split regression (single source of truth)
      // so this solver agrees with the dashboard ribbon.
      var feeRate = (typeof root.brooklynFeeRateFor === 'function')
        ? root.brooklynFeeRateFor(pt.longPct, pt.shortPct)
        : pt.feeRate;
      var fees = investedCapital * feeRate;
      var ok = loss >= gainToOffset && gainToOffset > 0;
      tested.push({ shortPct: s, longPct: pt.longPct, leverage: pt.leverage, loss: loss, fees: fees, ok: ok });
      if (!chosen && ok) {
        chosen = { point: pt, loss: loss, fees: fees };
      }
    }

    return {
      ok: !!chosen,
      point: chosen ? chosen.point : null,
      loss: chosen ? chosen.loss : 0,
      fees: chosen ? chosen.fees : 0,
      yearFraction: yf,
      timeWeighted: yf < 1,
      bounds: bounds,
      tested: tested
    };
  }

  root.getStrategyBounds       = getStrategyBounds;
  root.lookupVariable          = lookupVariable;
  root.solveVariableSingleYear = solveVariableSingleYear;
  root.STRATEGY_BOUNDS         = STRATEGY_BOUNDS;
})(window);
