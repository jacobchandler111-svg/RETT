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

  root.brooklynFeeSplit       = feeSplit;
  root.brooklynVariableFeeSplit = variableFeeSplit;
  root.BROOKLYN_FEE_SPLIT_CALIBRATION = {
    mgmtIntercept: MGMT_INTERCEPT,
    mgmtSlope:     MGMT_SLOPE,
    finSlope:      FIN_SLOPE,
    source: 'Cache Long/Short published Beta-1 schedule (Q1 2025)'
  };
})(window);
