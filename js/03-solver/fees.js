// FILE: js/03-solver/fees.js
// Brooklyn fee model.
//
// Returns the total fee paid in dollars for a given Brooklyn fund tier,
// leverage selection, and dollar investment.
//
// Fee = investment * interpolated_feeRate
//
// The interpolated feeRate is provided by brooklynInterpolate() in
// js/01-brooklyn/brooklyn-interpolation.js, which performs linear
// interpolation between the documented preset tiers. The original
// regression analysis showed fees are highly linear with respect to
// gross notional, so a linear interpolation is accurate.
//
// This module is intentionally thin so that future fee-curve refinements
// (caps, tiering, breakpoints) can be added in one place.

/**
 * @param {string} tierKey - 'beta1' | 'beta05' | 'beta0' | 'advisorManaged'
  * @param {number} leverage - Selected leverage tier.
   * @param {number} investment - Dollars invested in the strategy.
    * @returns {number} Fee in dollars for one year.
     */
     function brooklynFee(tierKey, leverage, investment) {
       if (!investment || investment <= 0) return 0;
         const interp = brooklynInterpolate(tierKey, leverage);
           return investment * interp.feeRate;
           }
           
