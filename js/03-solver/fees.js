// FILE: js/03-solver/fees.js
// Brooklyn fee model.
//
// Returns the total annual fee in dollars for a given Brooklyn fund
// tier, leverage selection, and dollar investment.
//
// Fee model (since the fee-split refactor):
//   fee = investment * feeRateFor(longPct, shortPct)
//
// where feeRateFor() lives in fee-split.js and applies a Cache-calibrated
// regression that decomposes management vs. financing. This replaces the
// previous lookup of interp.feeRate / combo.feeRate from data files —
// per user direction the regression is the single source of truth for
// forward-looking modeling, including the preset combos, even though the
// custodian's published rate card may quote slightly different headline
// numbers.

/**
 * @param {string} tierKey - 'beta1' | 'beta05' | 'beta0' | 'advisorManaged'
 * @param {number} leverage - Selected leverage tier.
 * @param {number} investment - Dollars invested in the strategy.
 * @returns {number} Fee in dollars for one year.
 */
function brooklynFee(tierKey, leverage, investment) {
  if (!investment || investment <= 0) return 0;
  if (typeof window.brooklynFeeSplitForLeverage === 'function') {
    var split = window.brooklynFeeSplitForLeverage(tierKey, leverage);
    return investment * (split.totalRate || 0);
  }
  // Defensive fallback (fee-split module hasn't loaded): use the
  // legacy interpolated feeRate from brooklyn-data.
  const interp = brooklynInterpolate(tierKey, leverage);
  return investment * (interp ? (interp.feeRate || 0) : 0);
}
           
