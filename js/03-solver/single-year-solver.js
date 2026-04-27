// js/03-solver/single-year-solver.js
// Stage 1: Can we wipe out the entire taxable amount in a single year using
// a given Brooklyn strategy?
//
// Two modes are supported:
//   "preset"   - try only the named tier ladder (Long-Only, 130/30, ...)
//                and pick the lowest-leverage tier that wipes the gain.
//   "variable" - walk every 1% short increment from minShort..maxShort
//                using solveVariableSingleYear, picking the lowest-leverage
//                point that wipes the gain. This is the "tailor-made"
//                slider behaviour.
//
// Output (preset mode):
//   {
//     mode: "preset",
//     ok, tier, loss, leverage, timeWeighted, yearFraction, tested[]
//   }
// Output (variable mode):
//   {
//     mode: "variable",
//     ok, point, loss, fees, leverage, timeWeighted, yearFraction, tested[]
//   }

(function (root) {
  'use strict';

  var PRESET_LEVERAGES_BY_STRATEGY = {
    beta1:           [0, 0.30, 0.45, 1.00, 1.50, 2.25],
    beta0:           [1.00, 1.50, 2.00, 2.75],
    beta05:          [1.00, 1.50, 2.25],
    advisorManaged:  [0, 0.30, 0.45, 1.00, 1.50, 2.25]
  };

  function clampFraction(f) {
    if (typeof f !== 'number' || !isFinite(f)) return 1;
    if (f <= 0) return 0;
    if (f > 1) return 1;
    return f;
  }

  function solvePreset(opts) {
    var strategyKey     = opts.strategyKey || 'beta1';
    var gainToOffset    = Number(opts.gainToOffset) || 0;
    var investedCapital = Number(opts.investedCapital) || 0;
    var yearFraction    = clampFraction(opts.yearFraction != null ? opts.yearFraction : 1);

    var ladder = PRESET_LEVERAGES_BY_STRATEGY[strategyKey] || PRESET_LEVERAGES_BY_STRATEGY.beta1;

    var tested = [];
    var chosen = null;

    for (var i = 0; i < ladder.length; i++) {
      var lev = ladder[i];
      var tier = (typeof root.brooklynInterpolate === 'function')
        ? root.brooklynInterpolate(strategyKey, lev)
        : null;
      if (!tier) continue;

      var weightedRate = tier.lossRate * yearFraction;
      var loss = investedCapital * weightedRate;
      var fees = investedCapital * tier.feeRate;
      var ok = loss >= gainToOffset && gainToOffset > 0;

      tested.push({ leverage: lev, loss: loss, fees: fees, ok: ok, tier: tier });

      if (!chosen && ok) {
        chosen = { tier: tier, loss: loss, fees: fees, leverage: lev };
      }
    }

    return {
      mode: 'preset',
      ok: !!chosen,
      tier: chosen ? chosen.tier : null,
      loss: chosen ? chosen.loss : 0,
      fees: chosen ? chosen.fees : 0,
      leverage: chosen ? chosen.leverage : null,
      timeWeighted: yearFraction < 1,
      yearFraction: yearFraction,
      tested: tested
    };
  }

  function solveVariable(opts) {
    if (typeof root.solveVariableSingleYear !== 'function') {
      return { mode: 'variable', ok: false, reason: 'variable-leverage module not loaded' };
    }
    var r = root.solveVariableSingleYear(opts);
    r.mode = 'variable';
    if (r.point) {
      r.tier = r.point;
      r.leverage = r.point.leverage;
    }
    return r;
  }

  function solveSingleYear(opts) {
    opts = opts || {};
    if (opts.mode === 'variable') return solveVariable(opts);
    return solvePreset(opts);
  }

  root.solveSingleYear              = solveSingleYear;
  root.solveSingleYearPreset        = solvePreset;
  root.solveSingleYearVariable      = solveVariable;
  root.PRESET_LEVERAGES_BY_STRATEGY = PRESET_LEVERAGES_BY_STRATEGY;
})(window);
