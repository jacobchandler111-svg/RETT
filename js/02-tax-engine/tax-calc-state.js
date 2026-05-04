// FILE: js/02-tax-engine/tax-calc-state.js
// State income tax computation. Reads the per-state record via tax-lookups
// helpers and handles the special-cases that appear in the source data:
//
//   - noIncomeTax: true                  -> returns 0
//   - flatRate: true                     -> single-rate progressive shape
//   - mentalHealthSurcharge (CA)         -> 1% over $1M
//   - millionaireSurcharge (MA)          -> 4% over $1M
//   - capitalGainsTax (WA)               -> 7% on LT gains over $270k
//
// Capital gains in most states are taxed as ordinary income; the engine
// passes the combined (ordinary + ST gain + LT gain) figure as 'income'
// unless the caller pre-splits.

function _flatBracketTaxState(amount, brackets) {
          if (amount <= 0 || !brackets || !brackets.length) return 0;
          let tax = 0, prevMax = 0;
          for (const b of brackets) {
                        const cap = b[0], rate = b[1];
                        if (amount <= prevMax) break;
                        const slabMax = Math.min(amount, cap);
                        tax += (slabMax - prevMax) * rate;
                        prevMax = cap;
                        if (amount <= cap) break;
          }
          return tax;
}

function computeStateTax(income, year, stateCode, status, opts) {
          if (!stateCode || stateCode === 'NONE') return 0;
          if (isStateNoIncomeTax(year, stateCode)) {
                        // WA has a stand-alone capital gains tax even though there's no
              // income tax. Caller can opt-in via opts.longTermGain.
              const sur = getStateSurcharges(year, stateCode);
                        if (sur.capitalGainsTax && opts && opts.longTermGain) {
                                          // B13: project the threshold by inflation for years
                                          // past the published baseYear so a 2030 sale doesn't
                                          // pay WA cap-gains tax on the same nominal $270K
                                          // threshold the data file lists for 2026.
                                          const projFactor = (TAX_DATA.states && TAX_DATA.states[String(year)]
                                                  && TAX_DATA.states[String(year)][stateCode])
                                                  ? 1 : _yearProjectionFactor(year);
                                          const t   = sur.capitalGainsTax.threshold * projFactor;
                                          const r   = sur.capitalGainsTax.rate;
                                          const lt  = Math.max(0, opts.longTermGain);
                                          return Math.max(0, lt - t) * r;
                        }
                        return 0;
          }

    opts = opts || {};
          const itemized = Math.max(0, opts.itemized || 0);
          const stdDed   = getStateStandardDeduction(year, stateCode, status);
          const deduction = Math.max(stdDed, itemized);
          const taxable   = Math.max(0, income - deduction);

    const brackets = getStateBrackets(year, stateCode, status);
          let tax = _flatBracketTaxState(taxable, brackets);

    // Surcharges.
    const sur = getStateSurcharges(year, stateCode);
          if (sur.mentalHealthSurcharge) {
                        const t = sur.mentalHealthSurcharge.threshold;
                        const r = sur.mentalHealthSurcharge.rate;
                        tax += Math.max(0, taxable - t) * r;
          }
          if (sur.millionaireSurcharge) {
                        const t = sur.millionaireSurcharge.threshold;
                        const r = sur.millionaireSurcharge.rate;
                        tax += Math.max(0, taxable - t) * r;
          }

    return tax;
}
