// js/01-brooklyn/variable-leverage.js
// Variable-leverage solver / lookup.
//
// Each named Brooklyn tier has a long% and short% pair where
//   longPct = 100 + shortPct  (you must hold a base 100% long, and any
//                              short dollar must be matched by an extra
//                              long dollar to keep gross exposure paired)
//   leverage = shortPct / 100
//
// The original Brookhaven UI exposed two sliders that step in 1% increments
// on each side, letting the user pick any integer (long, short) point along
// the curve instead of being limited to the named tiers. The loss-rate and
// fee-rate at any point are obtained by linear interpolation across the
// regression-fit data points already stored in BROOKLYN_STRATEGIES, which
// is exactly what brooklynInterpolate(strategyKey, leverage) does.
//
// This module exposes:
//   - getStrategyBounds(strategyKey)     -> { minShort, maxShort, minLong, maxLong, maxLeverage }
//   - lookupVariable(strategyKey, shortPct)    -> { longPct, shortPct, leverage, lossRate, feeRate, label, minInvestment }
//   - solveVariableSingleYear(opts)            -> { ok, point, loss, fees, ... }

(function (root) {
  'use strict';

  function getStrategyTiers(strategyKey) {
    var strats = root.BROOKLYN_STRATEGIES || {};
    var s = strats[strategyKey];
    if (!s || !s.dataPoints || !s.dataPoints.length) return null;
    return s.dataPoints;
  }

  function getStrategyBounds(strategyKey) {
    var pts = getStrategyTiers(strategyKey);
    if (!pts) return null;
    var minShort = Infinity, maxShort = -Infinity, minLong = Infinity, maxLong = -Infinity;
    var minLev = Infinity, maxLev = -Infinity;
    for (var i = 0; i < pts.length; i++) {
      var p = pts[i];
      if (p.shortPct < minShort) minShort = p.shortPct;
      if (p.shortPct > maxShort) maxShort = p.shortPct;
      if (p.longPct  < minLong)  minLong  = p.longPct;
      if (p.longPct  > maxLong)  maxLong  = p.longPct;
      if (p.leverage < minLev)   minLev   = p.leverage;
      if (p.leverage > maxLev)   maxLev   = p.leverage;
    }
    return {
      minShort: minShort,
      maxShort: maxShort,
      minLong:  minLong,
      maxLong:  maxLong,
      minLeverage: minLev,
      maxLeverage: maxLev
    };
  }

  // For a given short% (in integer 1% steps), return the full point.
  // longPct is fixed at 100 + shortPct because that is the structural
  // relationship in every named tier.
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

  // Walk every 1% short increment and pick the lowest one that wipes
  // out gainToOffset given investedCapital and (optional) yearFraction
  // time-weighting.
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
      var fees = investedCapital * pt.feeRate;
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
})(window);
