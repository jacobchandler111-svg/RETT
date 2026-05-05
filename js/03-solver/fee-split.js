// FILE: js/03-solver/fee-split.js
// Brooklyn fee rates for the two active Schwab Beta-1 combos come
// directly from Brooklyn's published advisor rate card (PDF: "Loss
// Projections - 10 year beta 1"). The three components are:
//
//   Brooklyn Management Fee  — charged by Brooklyn directly
//   Custodian Margin Spread  — Schwab stock-borrow/financing cost;
//                              modeled at the LOW end of the published
//                              range (Charles Schwab)
//   Custodian Commissions    — $0 for Schwab (removed per advisor spec)
//
//   Combo    Mgmt    Spread   Commissions  Total
//   145/45   0.32%   0.36%    0%           0.68%
//   200/100  0.51%   0.80%    0%           1.31%
//
// Source: Brooklyn "Loss Projections - 10 year beta 1" rate card.
//
// For non-Schwab paths (variable leverage, other tiers) we fall back to
// a linear regression fit to Cache's published Beta-1 schedule. Cache is
// a sub-advised product that layers additional fees on top of Brooklyn's
// direct rate, so the regression MUST NOT be used for Schwab combos.
//
//   management(GN)      ≈ -0.071% + 0.00357% × GN   (R² ≈ 0.998)
//   financing(shortPct) ≈  0.000% + 0.00957% × shortPct  (R² ≈ 0.999)

(function (root) {
  'use strict';

  // Direct Brooklyn advisor rates for the two active Schwab combos.
  // Keyed by "longPct_shortPct" (integer strings).
  var SCHWAB_BETA1_FEES = {
    '145_45':  { managementRate: 0.0032, spreadRate: 0.0036, totalRate: 0.0068 },
    '200_100': { managementRate: 0.0051, spreadRate: 0.0080, totalRate: 0.0131 }
  };

  function _schwabKey(longPct, shortPct) {
    return Math.round(Number(longPct) || 0) + '_' + Math.round(Number(shortPct) || 0);
  }

  // Beta-1 regression constants (Cache published schedule — fallback only).
  var MGMT_INTERCEPT = -0.00071;
  var MGMT_SLOPE     =  0.0000357;
  var FIN_SLOPE      =  0.0000957;

  function feeSplit(longPct, shortPct, totalRate) {
    var lp = Number(longPct) || 0;
    var sp = Number(shortPct) || 0;
    var gn = lp + sp;

    var beta1Mgmt = Math.max(0, MGMT_INTERCEPT + MGMT_SLOPE * gn);
    var beta1Fin  = Math.max(0, FIN_SLOPE * sp);
    var beta1Sum  = beta1Mgmt + beta1Fin;

    // If the caller supplied a tier-specific total, preserve it and
    // split using the Beta-1 ratio. If not, the Beta-1 sum IS the
    // returned total — pure Cache-calibrated path used for variable
    // strategies.
    if (totalRate == null || !isFinite(totalRate)) {
      return {
        managementRate: beta1Mgmt,
        financingRate:  beta1Fin,
        totalRate:      beta1Sum
      };
    }

    if (beta1Sum <= 0) {
      // Long-only or invalid — everything is management.
      return {
        managementRate: totalRate,
        financingRate:  0,
        totalRate:      totalRate
      };
    }

    var mgmtShare = beta1Mgmt / beta1Sum;
    return {
      managementRate: totalRate * mgmtShare,
      financingRate:  totalRate * (1 - mgmtShare),
      totalRate:      totalRate
    };
  }

  // Returns the management + spread split for a given long/short pair.
  // Schwab Beta-1 combos use the direct Brooklyn advisor rate card.
  // All other paths fall back to the Cache regression.
  function variableFeeSplit(longPct, shortPct) {
    var key = _schwabKey(longPct, shortPct);
    if (SCHWAB_BETA1_FEES[key]) {
      var tbl = SCHWAB_BETA1_FEES[key];
      return {
        managementRate: tbl.managementRate,
        financingRate:  tbl.spreadRate,
        totalRate:      tbl.totalRate
      };
    }
    return feeSplit(longPct, shortPct, null);
  }

  // Total annual fee rate as a decimal. Schwab combo lookup takes
  // priority over the Cache regression fallback.
  function feeRateFor(longPct, shortPct) {
    return variableFeeSplit(longPct, shortPct).totalRate;
  }

  // Derive (longPct, shortPct) from a strategy + leverage value. Same
  // mapping the variable-leverage UI uses:
  //   - Beta 0 (market neutral): long = short = leverage * 100
  //   - Otherwise: short = leverage * 100, long = 100 + short
  // tierKey is the Brooklyn strategy key (beta1 / beta0 / beta05 /
  // advisorManaged). leverage is the dataPoint leverage value.
  function pctsForLeverage(tierKey, leverage) {
    var sp = Math.max(0, (Number(leverage) || 0) * 100);
    var lp = (tierKey === 'beta0') ? sp : (100 + sp);
    return { longPct: lp, shortPct: sp };
  }

  // Convenience for callers that have a tierKey + leverage but not the
  // long/short pair handy. Returns the same shape as variableFeeSplit().
  function feeSplitForLeverage(tierKey, leverage) {
    var p = pctsForLeverage(tierKey, leverage);
    return variableFeeSplit(p.longPct, p.shortPct);
  }

  // -------------------------------------------------------------------
  // Year-1 short-term loss-rate regression.
  // -------------------------------------------------------------------
  // Beta 1, Beta 0, and Beta 0.5 each have their own per-tier
  // least-squares fit (intercept + slope on Gross Notional). All three
  // fit linearly with R² ~ 0.998+.
  //
  // Advisor Managed is computed as `beta1_loss - 0.104` instead of an
  // independent regression. The 0.104 is the long-only baseline (the
  // 100/0 lossRate, identical for both Beta 1 and Advisor Managed).
  // This relationship matches every Advisor Managed data point exactly:
  //
  //   AM_130_30  = 0.248 - 0.104 = 0.144  (data: 0.144) ✓
  //   AM_145_45  = 0.322 - 0.104 = 0.218  (data: 0.218) ✓
  //   AM_200_100 = 0.590 - 0.104 = 0.486  (data: 0.486) ✓
  //   AM_250_150 = 0.855 - 0.104 = 0.751  (data: 0.751) ✓
  //   AM_325_225 = 1.224 - 0.104 = 1.120  (data: 1.120) ✓
  //
  // Economic interpretation: Advisor Managed only reports the
  // shorting-contribution to TLH. Long-only positions don't go through
  // the advisor overlay, so subtract the long-only baseline. At 100/0
  // (no shorts) we floor at 0.104 since there's no shorting overlay
  // to apply.
  var LONG_ONLY_BASELINE = 0.104;
  var LOSS_REGRESSION = {
    beta1:           { intercept: -0.1511, slope: 0.00250, rsq: 0.998, note: 'linear' },
    beta0:           { intercept: -0.0414, slope: 0.00266, rsq: 0.999, note: 'linear' },
    beta05:          { intercept: -0.1100, slope: 0.00261, rsq: 0.999, note: 'linear' },
    advisorManaged:  { intercept: null, slope: null, rsq: 1.000, note: 'derived: beta1 - 0.104 long-only baseline' }
  };

  function _beta1LossAt(gn) {
    var b = LOSS_REGRESSION.beta1;
    return Math.max(0, b.intercept + b.slope * gn);
  }

  function lossRateFor(tierKey, longPct, shortPct) {
    var lp = Number(longPct) || 0;
    var sp = Number(shortPct) || 0;
    var gn = lp + sp;
    if (tierKey === 'advisorManaged') {
      // Long-only baseline at 100/0 — no shorting overlay to apply.
      if (sp === 0) return LONG_ONLY_BASELINE;
      // Otherwise: shorting-contribution only.
      return Math.max(0, _beta1LossAt(gn) - LONG_ONLY_BASELINE);
    }
    // Beta 1 long-only (100/0) point: published data is 0.104 but the
    // linear regression evaluates to ~0.099 at gn=100. Pin the
    // long-only point exactly so beta1 100/0 matches advisorManaged
    // 100/0 (they're the same data point per the underlying model).
    if (tierKey === 'beta1' && sp === 0) {
      return LONG_ONLY_BASELINE;
    }
    var coef = LOSS_REGRESSION[tierKey] || LOSS_REGRESSION.beta1;
    return Math.max(0, coef.intercept + coef.slope * gn);
  }

  function lossRateForLeverage(tierKey, leverage) {
    var p = pctsForLeverage(tierKey, leverage);
    return lossRateFor(tierKey, p.longPct, p.shortPct);
  }

  root.brooklynFeeSplit            = feeSplit;
  root.brooklynVariableFeeSplit    = variableFeeSplit;
  root.brooklynFeeRateFor          = feeRateFor;
  root.brooklynPctsForLeverage     = pctsForLeverage;
  root.brooklynFeeSplitForLeverage = feeSplitForLeverage;
  root.brooklynLossRateFor         = lossRateFor;
  root.brooklynLossRateForLeverage = lossRateForLeverage;
  root.BROOKLYN_LOSS_REGRESSION    = LOSS_REGRESSION;
  root.BROOKLYN_SCHWAB_BETA1_FEES     = SCHWAB_BETA1_FEES;
  root.BROOKLYN_FEE_SPLIT_CALIBRATION = {
    mgmtIntercept: MGMT_INTERCEPT,
    mgmtSlope:     MGMT_SLOPE,
    finSlope:      FIN_SLOPE,
    source: 'Cache Long/Short published Beta-1 schedule (Q1 2025) — fallback only; Schwab combos use BROOKLYN_SCHWAB_BETA1_FEES'
  };
})(window);
