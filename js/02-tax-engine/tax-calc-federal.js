// FILE: js/02-tax-engine/tax-calc-federal.js
// Federal tax computation including:
//   - Ordinary-income brackets
//   - Long-term capital gains / qualified dividends preferential brackets
//   - Alternative Minimum Tax (AMT) with exemption phaseout
//   - Net Investment Income Tax (NIIT) at 3.8% over MAGI thresholds
//   - Additional Medicare tax at 0.9% over wage thresholds
//
// Inputs are independent of the Brooklyn machinery so this module is
// reusable for baseline-vs-strategy comparisons.

function _bracketTax(amount, brackets) {
      if (amount <= 0 || !brackets || !brackets.length) return 0;
      let tax = 0;
      for (const b of brackets) {
                if (amount <= b.min) break;
                const slabMax = Math.min(amount, b.max);
                tax += (slabMax - b.min) * b.rate;
      }
      return tax;
}

function _computeAmt(amti, addOns) {
      if (!addOns || !addOns.amt) return 0;
      const a = addOns.amt;
      let exemption = a.exemption;
      const excess = Math.max(0, amti - a.phaseoutStart);
      exemption = Math.max(0, exemption - excess * 0.25);
      const taxable = Math.max(0, amti - exemption);
      if (taxable <= 0) return 0;
      if (taxable <= a.rate26Threshold) return taxable * a.rate26;
      return a.rate26Threshold * a.rate26 + (taxable - a.rate26Threshold) * a.rate28;
}

function _computeNiit(investmentIncome, magi, addOns) {
      if (!addOns || !addOns.niit) return 0;
      const over = Math.max(0, magi - addOns.niit.threshold);
      const base = Math.min(investmentIncome, over);
      return Math.max(0, base) * addOns.niit.rate;
}

function _computeAddlMedicare(wages, addOns) {
      if (!addOns || !addOns.addlMedicare) return 0;
      const over = Math.max(0, wages - addOns.addlMedicare.threshold);
      return over * addOns.addlMedicare.rate;
}

function computeFederalTax(ordinaryIncome, year, status, opts) {
      opts = opts || {};
      const longTermGain      = Math.max(0, opts.longTermGain || 0);
      const qualifiedDividend = Math.max(0, opts.qualifiedDividend || 0);
      const investmentIncome  = Math.max(0, opts.investmentIncome || (longTermGain + qualifiedDividend));
      const wages             = Math.max(0, opts.wages != null ? opts.wages : ordinaryIncome);
      const itemized          = Math.max(0, opts.itemized || 0);

    const fed = getFederalBrackets(year, status);
      const addOns = getFederalAddOns(year, status);
      if (!fed) return 0;

    const deduction = Math.max(fed.standardDeduction, itemized);
      const taxableOrdinary = Math.max(0, ordinaryIncome - deduction);

    const ordinaryTax = _bracketTax(taxableOrdinary, fed.ordinary);

    // Long-term capital gains: stacked on top of ordinary taxable income.
    let ltTax = 0;
      if (longTermGain + qualifiedDividend > 0 && fed.longTermCapitalGains) {
                const ltAmount = longTermGain + qualifiedDividend;
                let remaining  = ltAmount;
                let stackBase  = taxableOrdinary;
                for (const b of fed.longTermCapitalGains) {
                              if (remaining <= 0) break;
                              const slabRoom = Math.max(0, b.max - Math.max(stackBase, b.min));
                              if (slabRoom <= 0) { stackBase = Math.max(stackBase, b.max); continue; }
                              const slabUse  = Math.min(slabRoom, remaining);
                              ltTax    += slabUse * b.rate;
                              remaining -= slabUse;
                              stackBase += slabUse;
                }
      }

    // AMT (rough but standard): AMTI starts from taxable ordinary + preferences.
    const amti  = taxableOrdinary + longTermGain + qualifiedDividend;
      const amt   = _computeAmt(amti, addOns);
      const tentative = ordinaryTax + ltTax;
      const amtTopUp  = Math.max(0, amt - tentative);

    // NIIT applies to investment income over threshold.
    const magi = ordinaryIncome + longTermGain + qualifiedDividend;
      const niit = _computeNiit(investmentIncome, magi, addOns);

    // Additional Medicare applies to wages over threshold.
    const addlMed = _computeAddlMedicare(wages, addOns);

    return ordinaryTax + ltTax + amtTopUp + niit + addlMed;
}
