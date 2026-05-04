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
  // The fee-split module loads BEFORE fees.js per index.html load
  // order, so this branch is effectively unreachable in production.
  // We surface a clear error if it ever fires (instead of silently
  // diverging from the rest of the engine via brooklyn-data's
  // legacy feeRate) so the misconfiguration is caught at runtime.
  if (typeof console !== 'undefined' && console.error) {
    console.error('[fees.js] fee-split.js not loaded — brooklynFee returning 0. Check index.html script load order.');
  }
  return 0;
}
           
