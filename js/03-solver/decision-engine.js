// js/03-solver/decision-engine.js
// Two-stage decision tree with partial-year time-weighting and accelerated
// depreciation recapture, plus optional variable-leverage refinement.
//
// Inputs:
//   {
//     salePrice, costBasis,                    // basis-only gain
//     acceleratedDepreciation,                 // recaptured at ordinary
//     implementationDate,                      // YYYY-MM-DD
//     strategyKey,                             // beta1 | beta0 | beta05 | advisorManaged
//     investedCapital,                         // dollars allocated
//     leverageCap,                             // max preset leverage to try
//     years,                                   // multi-year horizon if needed
//     useVariableLeverage,                     // boolean (default true)
//     manualVariableShortPct                   // optional integer override
//   }
//
// Output:
//   {
//     longTermGain, recapture, gain,
//     yearFraction,
//     stage1:        {...}    // preset solve result
//     stage1Variable:{...}    // variable solve result (if enabled)
//     stage1RecommendsSingleYear,
//     stage1Source,           // "preset" | "variable" | null
//     stage2:        {...}    // multi-year solve (only if stage1 fails both)
//     recommendation,
//     summary
//   }

(function (root) {
  'use strict';

  function recommendSale(cfg) {
    cfg = cfg || {};

    var salePrice              = Number(cfg.salePrice) || 0;
    var costBasis              = Number(cfg.costBasis) || 0;
    var acceleratedDepreciation = Number(cfg.acceleratedDepreciation) || 0;
    var strategyKey            = cfg.strategyKey || 'beta1';
    var investedCapital        = Number(cfg.investedCapital) || 0;
    var leverageCap            = (cfg.leverageCap != null) ? Number(cfg.leverageCap) : 2.25;
    var years                  = Number(cfg.years) || 5;
    var useVariableLeverage    = (cfg.useVariableLeverage !== false);
    var manualShort            = (cfg.manualVariableShortPct != null) ? Number(cfg.manualVariableShortPct) : null;

    var longTermGain = Math.max(0, salePrice - costBasis - acceleratedDepreciation);
    var recapture    = Math.max(0, acceleratedDepreciation);
    var gainToOffset = longTermGain + recapture;

    var yf = (typeof root.yearFractionRemaining === 'function' && cfg.implementationDate)
      ? root.yearFractionRemaining(cfg.implementationDate)
      : 1;

    // Stage 1a: preset ladder
    var stage1 = root.solveSingleYearPreset({
      strategyKey: strategyKey,
      gainToOffset: gainToOffset,
      investedCapital: investedCapital,
      yearFraction: yf
    });
    // honour leverageCap for the preset stage
    if (stage1.ok && stage1.leverage > leverageCap) {
      stage1 = Object.assign({}, stage1, { ok: false, capped: true });
    }

    // Stage 1b: variable-leverage refinement
    var stage1Variable = null;
    if (useVariableLeverage && typeof root.solveSingleYearVariable === 'function') {
      stage1Variable = root.solveSingleYearVariable({
        strategyKey: strategyKey,
        gainToOffset: gainToOffset,
        investedCapital: investedCapital,
        yearFraction: yf
      });
      // honour leverageCap on the variable point too
      if (stage1Variable.ok && stage1Variable.leverage > leverageCap) {
        stage1Variable = Object.assign({}, stage1Variable, { ok: false, capped: true });
      }
    }

    // Manual override: if the caller pinned a specific shortPct, look it
    // up and treat that as the chosen variable point regardless of
    // automatic selection.
    var manualPoint = null;
    if (manualShort != null && typeof root.lookupVariable === 'function') {
      var pt = root.lookupVariable(strategyKey, manualShort);
      if (pt) {
        var weightedRate = pt.lossRate * yf;
        var loss = investedCapital * weightedRate;
        manualPoint = {
          mode: 'manual-variable',
          ok: loss >= gainToOffset && gainToOffset > 0,
          point: pt,
          loss: loss,
          fees: investedCapital * pt.feeRate,
          leverage: pt.leverage,
          yearFraction: yf,
          timeWeighted: yf < 1
        };
      }
    }

    // Choose source: preset takes precedence (cheaper labelled tier),
    // then variable, then manual override (only if user pinned it).
    var stage1Source = null;
    var stage1RecommendsSingleYear = false;
    if (manualShort != null && manualPoint && manualPoint.ok) {
      stage1Source = 'manual-variable';
      stage1RecommendsSingleYear = true;
    } else if (stage1 && stage1.ok) {
      stage1Source = 'preset';
      stage1RecommendsSingleYear = true;
    } else if (stage1Variable && stage1Variable.ok) {
      stage1Source = 'variable';
      stage1RecommendsSingleYear = true;
    }

    var stage2 = null;
    if (!stage1RecommendsSingleYear) {
      stage2 = root.solveMultiYear({
        strategyKey: strategyKey,
        gain: gainToOffset,
        investedCapital: investedCapital,
        leverageCap: leverageCap,
        years: years,
        yearFractionYear1: yf
      });
    }

    var recommendation = stage1RecommendsSingleYear ? 'single-year' : 'multi-year';
    var summary;
    if (stage1RecommendsSingleYear) {
      var chosen = (stage1Source === 'preset') ? stage1
                 : (stage1Source === 'variable') ? stage1Variable
                 : manualPoint;
      summary = {
        source: stage1Source,
        leverage: chosen.leverage,
        loss: chosen.loss,
        fees: chosen.fees,
        label: chosen.tier ? chosen.tier.label
              : chosen.point ? chosen.point.label
              : null,
        longPct: chosen.tier ? chosen.tier.longPct
              : chosen.point ? chosen.point.longPct
              : null,
        shortPct: chosen.tier ? chosen.tier.shortPct
              : chosen.point ? chosen.point.shortPct
              : null,
        yearFraction: yf
      };
    } else {
      summary = stage2 && stage2.summary ? stage2.summary : (stage2 || {});
    }

    return {
      longTermGain: longTermGain,
      recapture: recapture,
      gain: gainToOffset,
      yearFraction: yf,
      stage1: stage1,
      stage1Variable: stage1Variable,
      stage1Manual: manualPoint,
      stage1RecommendsSingleYear: stage1RecommendsSingleYear,
      stage1Source: stage1Source,
      stage2: stage2,
      recommendation: recommendation,
      summary: summary
    };
  }

  root.recommendSale = recommendSale;
})(window);
