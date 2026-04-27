// FILE: js/02-tax-engine/tax-calc-federal.js
// Federal tax computation. Data shape comes from data/taxBrackets.json:
//
//   brackets:    [[max, rate], ...]   (ordinary)
//   ltcgRates:   [[max, rate], ...]   (long-term capital gains, qualified div)
//   standardDeduction: number
//   niitThreshold:     number          (Net Investment Income Tax)
//
// AMT and Additional Medicare are carried at IRS-published 2025/2026
// values defined below (the source JSON does not include them). They are
// inflated past 2026 using TAX_DATA.inflationRate to keep them coherent
// with the bracket projection.

// ---- Hard-coded AMT + Additional Medicare tables (per IRS) ----
// Filing-status keys here use snake_case to match the JSON.
const FED_AMT_2026 = {
          single:           { exemption: 90400,  phaseoutStart: 642850,  rate26Threshold: 244000, rate26: 0.26, rate28: 0.28 },
          married_joint:    { exemption: 140565, phaseoutStart: 1285650, rate26Threshold: 244000, rate26: 0.26, rate28: 0.28 },
          married_separate: { exemption: 70283,  phaseoutStart: 642825,  rate26Threshold: 122000, rate26: 0.26, rate28: 0.28 },
          head_household:   { exemption: 90400,  phaseoutStart: 642850,  rate26Threshold: 244000, rate26: 0.26, rate28: 0.28 }
};
const FED_AMT_2025 = {
          single:           { exemption: 88100,  phaseoutStart: 626350,  rate26Threshold: 239100, rate26: 0.26, rate28: 0.28 },
          married_joint:    { exemption: 137000, phaseoutStart: 1252700, rate26Threshold: 239100, rate26: 0.26, rate28: 0.28 },
          married_separate: { exemption: 68500,  phaseoutStart: 626350,  rate26Threshold: 119550, rate26: 0.26, rate28: 0.28 },
          head_household:   { exemption: 88100,  phaseoutStart: 626350,  rate26Threshold: 239100, rate26: 0.26, rate28: 0.28 }
};
const FED_ADDL_MEDICARE = {
          // Threshold is fixed by statute and not indexed for inflation.
          rate: 0.009,
          threshold: {
                        single:           200000,
                        married_joint:    250000,
                        married_separate: 125000,
                        head_household:   200000
          }
};

function _flatBracketTax(amount, brackets) {
          // Source format is [[max, rate], [max, rate], ...] - cumulative thresholds.
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

function _amtForYearStatus(year, status) {
          const k = fsKey(status);
          const factor = _yearProjectionFactor(year);
          const tbl = (year >= TAX_DATA.baseYear) ? FED_AMT_2026 : FED_AMT_2025;
          const a = tbl[k] || tbl.single;
          return {
                        exemption:       a.exemption       * factor,
                        phaseoutStart:   a.phaseoutStart   * factor,
                        rate26Threshold: a.rate26Threshold * factor,
                        rate26: a.rate26,
                        rate28: a.rate28
          };
}

function _computeAmt(amti, year, status) {
          const a = _amtForYearStatus(year, status);
          let exemption = a.exemption;
          const excess = Math.max(0, amti - a.phaseoutStart);
          exemption = Math.max(0, exemption - excess * 0.25);
          const taxable = Math.max(0, amti - exemption);
          if (taxable <= 0) return 0;
          if (taxable <= a.rate26Threshold) return taxable * a.rate26;
          return a.rate26Threshold * a.rate26 + (taxable - a.rate26Threshold) * a.rate28;
}

function _computeNiit(investmentIncome, magi, year, status) {
          const threshold = getFederalNiitThreshold(year, status);
          const over = Math.max(0, magi - threshold);
          const base = Math.min(Math.max(0, investmentIncome), over);
          return base * 0.038;
}

function _computeAddlMedicare(wages, status) {
          const k = fsKey(status);
          const t = FED_ADDL_MEDICARE.threshold[k] != null
              ? FED_ADDL_MEDICARE.threshold[k] : 200000;
          return Math.max(0, wages - t) * FED_ADDL_MEDICARE.rate;
}

function computeFederalTax(ordinaryIncome, year, status, opts) {
          opts = opts || {};
          const longTermGain      = Math.max(0, opts.longTermGain || 0);
          const qualifiedDividend = Math.max(0, opts.qualifiedDividend || 0);
          const investmentIncome  = Math.max(0, opts.investmentIncome != null
                                                     ? opts.investmentIncome : (longTermGain + qualifiedDividend));
          const wages             = Math.max(0, opts.wages != null ? opts.wages : ordinaryIncome);
          const itemized          = Math.max(0, opts.itemized || 0);

    const stdDed   = getFederalStandardDeduction(year, status);
          const ordBrk   = getFederalBrackets(year, status);
          const ltBrk    = getFederalLTCGBrackets(year, status);

    const deduction = Math.max(stdDed, itemized);
          const taxableOrdinary = Math.max(0, ordinaryIncome - deduction);

    const ordinaryTax = _flatBracketTax(taxableOrdinary, ordBrk);

    // LTCG stacking on top of ordinary taxable income.
    let ltTax = 0;
          const ltAmount = longTermGain + qualifiedDividend;
          if (ltAmount > 0 && ltBrk && ltBrk.length) {
                        let remaining = ltAmount;
                        let stackBase = taxableOrdinary;
                        let prevMax = 0;
                        for (const b of ltBrk) {
                                          const cap = b[0], rate = b[1];
                                          if (remaining <= 0) break;
                                          const slabRoom = Math.max(0, cap - Math.max(stackBase, prevMax));
                                          if (slabRoom <= 0) { prevMax = cap; continue; }
                                          const slabUse = Math.min(slabRoom, remaining);
                                          ltTax    += slabUse * rate;
                                          remaining -= slabUse;
                                          stackBase += slabUse;
                                          prevMax = cap;
                        }
          }

    // AMT (top-up only).
    const amti     = taxableOrdinary + ltAmount;
          const amt      = _computeAmt(amti, year, status);
          const amtTopUp = Math.max(0, amt - (ordinaryTax + ltTax));

    // NIIT.
    const magi = ordinaryIncome + ltAmount;
          const niit = _computeNiit(investmentIncome, magi, year, status);

    // Additional Medicare on wages.
    const addlMed = _computeAddlMedicare(wages, status);

    return ordinaryTax + ltTax + amtTopUp + niit + addlMed;
}
