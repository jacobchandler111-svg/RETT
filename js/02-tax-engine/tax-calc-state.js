// FILE: js/02-tax-engine/tax-calc-state.js
// State income tax computation. Supports three table shapes:
//   - 'progressive' : list of bracket {min, max, rate} objects
//   - 'flat'        : single flatRate applied above standardDeduction
//   - 'none'        : no state income tax (returns 0)
//
// State capital-gains treatment is driven by the 'capitalGainsTreatment'
// field on the state record. Currently supported values:
//   - 'ordinary'  : capital gains taxed at the same rates as ordinary income
//   - 'exempt'    : capital gains excluded from state taxable income
//   - 'partial'   : a partial-exclusion percentage (state.partialExclusionRate)
//
// The function expects the caller to pass a single combined "income" value
// representing the state-taxable income. Callers that need to split capital
// gains differently should pre-process and call multiple times.

function _stateBracketTax(amount, brackets) {
      if (amount <= 0 || !brackets || !brackets.length) return 0;
      let tax = 0;
      for (const b of brackets) {
                if (amount <= b.min) break;
                const slabMax = Math.min(amount, b.max);
                tax += (slabMax - b.min) * b.rate;
      }
      return tax;
}

function computeStateTax(income, year, stateCode, status, opts) {
      if (!stateCode || stateCode === 'NONE') return 0;
      opts = opts || {};
      const itemized = Math.max(0, opts.itemized || 0);
      const cfg = getStateBrackets(year, stateCode, status);
      if (!cfg || cfg.type === 'none') return 0;

    const deduction = Math.max(cfg.standardDeduction || 0, itemized);
      const taxable = Math.max(0, income - deduction);

    if (cfg.type === 'flat') {
              return taxable * (cfg.flatRate || 0);
    }
      return _stateBracketTax(taxable, cfg.ordinary);
}
