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
          longTermGain: 0,
          recapture: 0,
          gain: 0,
          yearFraction: 1,
          stage1: null,
          stage1Variable: null,
          stage1Manual: null,
          stage1RecommendsSingleYear: false,
          stage1Source: null,
          stage2: null,
          recommendation: 'custodian-violation',
          custodianViolation: custVal,
          summary: { source: 'custodian-violation', note: custVal.message }
        };
      }
    }

    var salePrice = Number(cfg.salePrice) || 0;
    var costBasis = Number(cfg.costBasis) || 0;
    var acceleratedDepreciation = Number(cfg.acceleratedDepreciation) || 0;
    // Short-term gain (if entered) is carved out of the property gain
    // and taxed at ordinary rates instead of LTCG rates. It reduces
    // the long-term gain bucket the solver works against.
    var shortTermGain = Number(cfg.baseShortTermGain || cfg.shortTermGain) || 0;

    var strategyKey = (function () {
      var k = cfg.strategyKey;
      var valid = (typeof root.STRATEGY_BOUNDS === 'object' && root.STRATEGY_BOUNDS)
        ? Object.keys(root.STRATEGY_BOUNDS)
        : ['beta1','beta0','beta05','advisorManaged'];
      if (k && valid.indexOf(k) !== -1) return k;
      return 'beta1';
    })();

    var investedCapital = Number(cfg.investedCapital) || 0;
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

    var useVariableLeverage = (cfg.useVariableLeverage !== false);
    var manualShort = (cfg.manualVariableShortPct != null) ? Number(cfg.manualVariableShortPct) : null;

    var longTermGain = Math.max(0, salePrice - costBasis - acceleratedDepreciation - shortTermGain);
    var recapture = Math.max(0, acceleratedDepreciation);
    var gainToOffset = longTermGain + recapture;

    var yf = (typeof root.yearFractionRemaining === 'function' && cfg.implementationDate)
      ? root.yearFractionRemaining(cfg.implementationDate)
      : 1;
    if (yf == null || !Number.isFinite(Number(yf))) yf = 1;

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

    // Stage 1c: Schwab-combo path. When the user's selection resolves to
    // a Schwab combo, the authoritative loss curve lives in the combo's
    // lossByYear array (year-indexed), not in brooklyn-data. Build a
    // single-year result from combo.lossByYear[0] (time-weighted) so the
    // recommendation actually changes when the user toggles between
    // Schwab leverage pills. Falls through to the preset/variable
    // solvers above when no combo is set.
    var stage1Combo = null;
    if (cfg.comboId && typeof root.getSchwabCombo === 'function') {
      var combo = root.getSchwabCombo(cfg.comboId);
      if (combo && Array.isArray(combo.lossByYear) && combo.lossByYear.length > 0) {
        var comboLossRate = (combo.lossByYear[0] || 0) * yf;
        var comboLoss = investedCapital * comboLossRate;
        // Fee uses the unified regression rather than the combo's
        // published rate. See fees.js docstring.
        var comboFeeRate = (typeof root.brooklynFeeRateFor === 'function')
          ? root.brooklynFeeRateFor(combo.longPct, combo.shortPct)
          : (combo.feeRate || 0);
        var comboFees = investedCapital * comboFeeRate;
        stage1Combo = {
          mode: 'schwab-combo',
          ok: comboLoss >= gainToOffset && gainToOffset > 0 && combo.leverage <= leverageCap,
          combo: combo,
          comboId: combo.id,
          leverage: combo.leverage,
          longPct: combo.longPct,
          shortPct: combo.shortPct,
          lossRate: comboLossRate,
          loss: comboLoss,
          fees: comboFees,
          feeRate: comboFeeRate,
          yearFraction: yf,
          timeWeighted: yf < 1,
          label: combo.strategyLabel + ' ' + combo.leverageLabel
        };
      }
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
        // Unified fee-split regression for the manual override too.
        var manualFeeRate = (typeof root.brooklynFeeRateFor === 'function')
          ? root.brooklynFeeRateFor(pt.longPct, pt.shortPct)
          : pt.feeRate;
        manualPoint = {
          mode: 'manual-variable',
          ok: loss >= gainToOffset && gainToOffset > 0 && pt.leverage <= leverageCap,
          point: pt,
          loss: loss,
          fees: investedCapital * manualFeeRate,
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
    } else if (stage1Combo && stage1Combo.ok) {
      // Schwab combos take priority over the generic brooklyn-data ladder
      // because the combo's lossByYear is the authoritative source of
      // truth for Schwab products.
      stage1Source = 'schwab-combo';
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

      // Annotate stage2 with the fee rate so the structured-sale optimizer
      // can compute per-year fees from the staggered investment vector.
      // Uses the unified regression (fee-split.js) instead of the
      // brooklyn-data feeRate field.
      if (stage2 && stage2.leverageUsed != null) {
        var stage2FeeRate = null;
        if (typeof root.brooklynFeeSplitForLeverage === 'function') {
          var s2split = root.brooklynFeeSplitForLeverage(strategyKey, stage2.leverageUsed);
          stage2FeeRate = s2split ? s2split.totalRate : null;
        } else if (typeof root.brooklynInterpolate === 'function') {
          var info = root.brooklynInterpolate(strategyKey, stage2.leverageUsed);
          stage2FeeRate = info ? info.feeRate : null;
        }
        if (stage2FeeRate != null) {
          stage2 = Object.assign({}, stage2, { feeRate: stage2FeeRate });
        }
      }

      // Refine the multi-year schedule via the structured-sale optimizer.
      // Inject the LTCG / recapture split, the strategyKey, and a year1
      // hint so the optimizer can enforce the 15-month hold.
      if (typeof root.optimizeStructuredSale === 'function' && stage2 && stage2.totalLossNeeded > 0) {
        try {
          var optCfg = Object.assign({}, cfg, {
            longTermGain: longTermGain,
            recapture: recapture,
            strategyKey: strategyKey,
            investedCapital: investedCapital,
            year1: cfg.year1 || (function () {
              if (cfg.implementationDate) {
                var m = String(cfg.implementationDate).match(/^(\d{4})/);
                if (m) return Number(m[1]);
              }
              return new Date().getFullYear();
            })()
          });
          stage2 = root.optimizeStructuredSale({ cfg: optCfg, stage2: stage2 });
        } catch (e) {
          stage2 = Object.assign({}, stage2, { structured: { enabled: false, error: String(e) } });
        }
      }
    }

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
      var chosen = (stage1Source === 'preset') ? stage1
                  : (stage1Source === 'variable') ? stage1Variable
                  : (stage1Source === 'schwab-combo') ? stage1Combo
                  : manualPoint;
      summary = {
        source: stage1Source,
        leverage: chosen.leverage,
        loss: chosen.loss,
        fees: chosen.fees,
        label: chosen.label || (chosen.tier ? chosen.tier.label : chosen.point ? chosen.point.label : null),
        longPct: chosen.longPct != null ? chosen.longPct : (chosen.tier ? chosen.tier.longPct : chosen.point ? chosen.point.longPct : null),
        shortPct: chosen.shortPct != null ? chosen.shortPct : (chosen.tier ? chosen.tier.shortPct : chosen.point ? chosen.point.shortPct : null),
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
      stage1Combo: stage1Combo,
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
