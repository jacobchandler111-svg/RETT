// js/03-solver/decision-engine.js
// Two-stage decision tree with partial-year time-weighting and accelerated
// depreciation recapture, plus variable-leverage refinement.
//
// Priority within Stage 1:
//   1. manual override (user pinned a specific shortPct on the slider)
//   2. variable solver result if useVariableLeverage is on (preferred:
//      always uses leverage <= the matching preset)
//   3. preset solver result
//
// If gainToOffset === 0 the engine short-circuits to recommendation
// "no-action" without invoking either solver.

(function (root) {
  'use strict';

  function recommendSale(cfg) {
    cfg = cfg || {};

    // Custodian gate: if a custodian is selected, validate before any solver runs.
    if (cfg.custodian && typeof root.validateAgainstCustodian === 'function') {
      var custVal = root.validateAgainstCustodian({
        custodian: cfg.custodian,
        strategyKey: cfg.strategyKey,
        leverageCap: cfg.leverageCap,
        investedCapital: cfg.investedCapital
      });
      if (custVal && custVal.ok === false) {
        return {
          longTermGain: 0, recapture: 0, gain: 0, yearFraction: 1,
          stage1: null, stage1Variable: null, stage1Manual: null,
          stage1RecommendsSingleYear: false, stage1Source: null,
          stage2: null,
          recommendation: 'custodian-violation',
          custodianViolation: custVal,
          summary: { source: 'custodian-violation', note: custVal.message }
        };
      }
    }
    var salePrice              = Number(cfg.salePrice) || 0;
    var costBasis              = Number(cfg.costBasis) || 0;
    var acceleratedDepreciation = Number(cfg.acceleratedDepreciation) || 0;
    var strategyKey = (function () {
      var k = cfg.strategyKey;
      var valid = (typeof root.STRATEGY_BOUNDS === 'object' && root.STRATEGY_BOUNDS) ? Object.keys(root.STRATEGY_BOUNDS) : ['beta1','beta0','beta05','advisorManaged'];
      if (k && valid.indexOf(k) !== -1) return k;
      return 'beta1';
    })();
    var investedCapital        = Number(cfg.investedCapital) || 0;
    var leverageCap = (function () {
      if (cfg.leverageCap == null) return 2.25;
      var n = Number(cfg.leverageCap);
      if (!Number.isFinite(n) || n < 0) return 2.25;
      return n;
    })();
    var years = (function () {
      var n = Number(cfg.years);
      if (!Number.isFinite(n)) return 5;
      n = Math.floor(n);
      if (n < 1) return 1;
      if (n > 50) return 50;
      return n;
    })();
    var useVariableLeverage    = (cfg.useVariableLeverage !== false);
    var manualShort            = (cfg.manualVariableShortPct != null) ? Number(cfg.manualVariableShortPct) : null;

    var longTermGain = Math.max(0, salePrice - costBasis - acceleratedDepreciation);
    var recapture    = Math.max(0, acceleratedDepreciation);
    var gainToOffset = longTermGain + recapture;

    var yf = (typeof root.yearFractionRemaining === 'function' && cfg.implementationDate)
      ? root.yearFractionRemaining(cfg.implementationDate)
      : 1;
    // Guard: if implementationDate is malformed, yearFractionRemaining may
    // return null. Treat as full year remaining (yf=1) so downstream math
    // never sees NaN.
    if (yf == null || !Number.isFinite(Number(yf))) yf = 1;

    // Short-circuit on no-gain
    if (gainToOffset === 0) {
      return {
        longTermGain: 0,
        recapture: 0,
        gain: 0,
        yearFraction: yf,
        stage1: null,
        stage1Variable: null,
        stage1Manual: null,
        stage1RecommendsSingleYear: false,
        stage1Source: null,
        stage2: null,
        recommendation: 'no-action',
        summary: { source: 'no-action', note: 'no taxable gain to offset' }
      };
    }

    // Stage 1a: preset ladder
    var stage1 = root.solveSingleYearPreset({
      strategyKey: strategyKey,
      gainToOffset: gainToOffset,
      investedCapital: investedCapital,
      yearFraction: yf
    });
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
      if (stage1Variable.ok && stage1Variable.leverage > leverageCap) {
        stage1Variable = Object.assign({}, stage1Variable, { ok: false, capped: true });
      }
    }

    // Manual override
    var manualPoint = null;
    if (manualShort != null && typeof root.lookupVariable === 'function') {
      var pt = root.lookupVariable(strategyKey, manualShort);
      if (pt) {
        var weightedRate = pt.lossRate * yf;
        var loss = investedCapital * weightedRate;
        manualPoint = {
          mode: 'manual-variable',
          ok: loss >= gainToOffset && gainToOffset > 0 && pt.leverage <= leverageCap,
          point: pt,
          loss: loss,
          fees: investedCapital * pt.feeRate,
          leverage: pt.leverage,
          yearFraction: yf,
          timeWeighted: yf < 1
        };
      }
    }

    var stage1Source = null;
    var stage1RecommendsSingleYear = false;
    if (manualShort != null && manualPoint && manualPoint.ok) {
      stage1Source = 'manual-variable';
      stage1RecommendsSingleYear = true;
    } else if (stage1Variable && stage1Variable.ok) {
      stage1Source = 'variable';
      stage1RecommendsSingleYear = true;
    } else if (stage1 && stage1.ok) {
      stage1Source = 'preset';
      stage1RecommendsSingleYear = true;
    }

    var stage2 = null;
    if (!stage1RecommendsSingleYear) {
      stage2 = root.solveMultiYear({
        strategyKey: strategyKey,
        totalGain: gainToOffset,
        gain: gainToOffset,
        investedCapital: investedCapital,
        leverageCap: leverageCap,
        years: years,
        yearFractionYear1: yf
      });

      // Refine the multi-year schedule via the structured-sale optimizer:
      // explore greedy/proportional/defer/backload payout schedules and
      // pick the one that minimizes cumulative federal+state tax.  The
      // refined result preserves all stage2 fields and adds a 'structured'
      // metadata block describing the chosen schedule.
      if (typeof root.optimizeStructuredSale === 'function' && stage2 && stage2.totalLossNeeded > 0) {
        try {
          stage2 = root.optimizeStructuredSale({ cfg: cfg, stage2: stage2 });
        } catch (e) {
          // If the optimizer fails for any reason, fall back to the raw
          // proportional schedule produced by solveMultiYear.
          stage2 = Object.assign({}, stage2, { structured: { enabled: false, error: String(e) } });
        }
      }

    }

    // Determine top-level recommendation. If the structured-sale
    // optimizer marked the schedule as a shortfall, propagate that to
    // the top-level value so callers see a consistent label.
    var recommendation;
    if (stage1RecommendsSingleYear) {
      recommendation = 'single-year';
    } else if (stage2 && stage2.recommendation === 'multi-year-shortfall') {
      recommendation = 'multi-year-shortfall';
    } else {
      recommendation = 'multi-year';
    }
    var summary;
    if (stage1RecommendsSingleYear) {
      var chosen = (stage1Source === 'preset')           ? stage1
                  : (stage1Source === 'variable')        ? stage1Variable
                  :                                        manualPoint;
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
      summary = stage2 || {};
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
