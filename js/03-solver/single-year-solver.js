// js/03-solver/single-year-solver.js
// Stage 1: Can we wipe out the entire taxable amount in a single year using
// a given Brooklyn strategy, and if so, what is the minimum leverage tier
// that does the job?
//
// Inputs:
//   strategyKey   - "beta1" | "beta0" | "beta05" | "advisorManaged"
//   gainToOffset  - dollars of taxable income that need short-term loss
//                   (long-term gain + accelerated-depreciation recapture +
//                    any other ordinary income the user wants offset)
//   investedCapital - dollars allocated to the strategy
//   yearFraction  - fraction (0-1] of the year remaining after the
//                   implementation date. Year-1 loss generation is
//                   time-weighted by this fraction. Defaults to 1.
//
// Output:
//   {
//     ok: boolean,
//     tier: { ... } | null,
//     loss: number,
//     leverage: number,
//     timeWeighted: boolean,
//     yearFraction: number,
//     tested: [ {leverage, loss, ok, tier}, ... ]
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

  function solveSingleYear(opts) {
    opts = opts || {};
    var strategyKey     = opts.strategyKey || 'beta1';
    var gainToOffset    = Number(opts.gainToOffset) || 0;
    var investedCapital = Number(opts.investedCapital) || 0;
    var yearFraction    = clampFraction(opts.yearFraction != null ? opts.yearFraction : 1);

    var ladder = PRESET_LEVERAGES_BY_STRATEGY[strategyKey] || PRESET_LEVERAGES_BY_STRATEGY.beta1;

    var tested = [];
    var chosen = null;

    for (var i = 0; i < ladder.length; i++) {
      var lev = ladder[i];
      var tier = (typeof window.brooklynInterpolate === 'function')
        ? window.brooklynInterpolate(strategyKey, lev)
        : null;
      if (!tier) continue;

      var weightedRate = tier.lossRate * yearFraction;
      var loss = investedCapital * weightedRate;
      var ok = loss >= gainToOffset && gainToOffset > 0;

      tested.push({ leverage: lev, loss: loss, ok: ok, tier: tier });

      if (!chosen && ok) {
        chosen = { tier: tier, loss: loss, leverage: lev };
      }
    }

    return {
      ok: !!chosen,
      tier: chosen ? chosen.tier : null,
      loss: chosen ? chosen.loss : 0,
      leverage: chosen ? chosen.leverage : null,
      timeWeighted: yearFraction < 1,
      yearFraction: yearFraction,
      tested: tested
    };
  }

  root.solveSingleYear = solveSingleYear;
  root.PRESET_LEVERAGES_BY_STRATEGY = PRESET_LEVERAGES_BY_STRATEGY;
})(window);
