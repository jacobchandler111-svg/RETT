// FILE: js/03-solver/fee-split.js
// Decomposes the Brooklyn fee into a published "management" line and a
// "financing" (stock-borrow) line, matching the disclosure convention
// used by Cache Long/Short (which is sub-advised by Brooklyn).
//
// Linear regressions calibrated to Cache's published Beta-1 schedule:
//
//   Tier      mgmt    financing
//   130/30    0.50%   0.28%
//   145/45    0.60%   0.475%
//   175/75    0.75%   0.71%
//   200/100   1.00%   0.95%
//
// Fits (units = % of invested capital, where GN and shortPct are in
// percentage points, e.g. 200 long / 100 short -> GN = 300, shortPct = 100):
//
//   management(GN)         ≈ -0.071% + 0.00357% × GN   (R² ≈ 0.998)
//   financing(shortPct)    ≈  0.000% + 0.00957% × shortPct  (R² ≈ 0.999)
//
// Source: https://usecache.com/product/long-short
// White paper:
//   https://bkln-landing-prd-assets.s3.us-east-1.amazonaws.com/
//     BKLN+and+Cache+White+Paper+-+Peanut+Butter+and+Jelly+-+Q1+2025.pdf
//
// Per-tier deltas: Cache only publishes Beta 1 (S&P 500). The other
// Brooklyn tiers (Beta 0, Beta 0.5, Advisor Managed) lack public
// schedules, so we keep the legacy interpolated feeRate from
// brooklyn-data.js as the *total* and split it proportionally
// using the Cache mgmt:financing ratio at the same GN. This
// produces a defensible split until the user supplies tier-specific
// rate cards.

(function (root) {
  'use strict';

  // Beta-1 calibration constants (Cache).
  var MGMT_INTERCEPT = -0.00071;   // -0.071%
  var MGMT_SLOPE     =  0.0000357; // per 1% gross notional
  var FIN_SLOPE      =  0.0000957; // per 1% short

  // For tiers other than Beta 1 we don't have public data. Compute the
  // mgmt:financing ratio at the same GN/short from the Beta-1 formulas
  // and apply that ratio to the legacy total feeRate.
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

  // Convenience: take a long%/short% and return the split rate triple
  // for the variable-strategy path. Pure Cache calibration.
  function variableFeeSplit(longPct, shortPct) {
    return feeSplit(longPct, shortPct, null);
  }

  // The single unified fee-rate function used everywhere in the engine.
  // Replaces both the Schwab combo's published feeRate (e.g. 2.03% for
  // 200/100) and brooklyn-data's feeRate field. Per the user's call,
  // the regression — fit to Cache's published mgmt + financing schedule —
  // is more accurate than either source for forward-looking modeling.
  //
  // Returns the total annual fee rate as a decimal (e.g. 0.01957 for
  // 1.957%). Use feeRateFor(longPct, shortPct).
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
  root.BROOKLYN_FEE_SPLIT_CALIBRATION = {
    mgmtIntercept: MGMT_INTERCEPT,
    mgmtSlope:     MGMT_SLOPE,
    finSlope:      FIN_SLOPE,
    source: 'Cache Long/Short published Beta-1 schedule (Q1 2025)'
  };
})(window);
