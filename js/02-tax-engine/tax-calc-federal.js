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
// 2026 OBBB-amended AMT exemptions per IRS notice (single $90,100 /
// MFJ $140,200; phaseout starts $500,000 / $1,000,000). Issue #54.
const FED_AMT_2026 = {
          single:           { exemption: 90100,  phaseoutStart: 500000,   rate26Threshold: 244000, rate26: 0.26, rate28: 0.28 },
          married_joint:    { exemption: 140200, phaseoutStart: 1000000,  rate26Threshold: 244000, rate26: 0.26, rate28: 0.28 },
          married_separate: { exemption: 70100,  phaseoutStart: 500000,   rate26Threshold: 122000, rate26: 0.26, rate28: 0.28 },
          head_household:   { exemption: 90100,  phaseoutStart: 500000,   rate26Threshold: 244000, rate26: 0.26, rate28: 0.28 }
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

// computeFederalTax returns just the all-in dollar number; it is a thin
// wrapper over computeFederalTaxBreakdown so the math lives in exactly
// one place. Previously the two functions were a verbatim 55-line copy
// of each other.
function computeFederalTax(ordinaryIncome, year, status, opts) {
          return computeFederalTaxBreakdown(ordinaryIncome, year, status, opts).total;
}


// Supported opts keys for computeFederalTaxBreakdown:
//   longTermGain        — numeric, taxed via the LTCG bracket stack
//   qualifiedDividend   — numeric, taxed at LTCG rates (treated like LT gain)
//   investmentIncome    — numeric, NIIT base (defaults to LT + QD)
//   wages               — numeric, Additional Medicare base (W-2 + SE only)
//   seIncome            — numeric, added to wages for the Add'l Medicare base
//   itemized            — numeric, replaces the standard deduction if larger
// Aliased synonyms (mapped to the canonical keys above):
//   ltcg, lt              -> longTermGain
//   qualifiedDiv          -> qualifiedDividend
//   niitable, niitIncome  -> investmentIncome
//   wagesIncome,
//   earnedIncome          -> wages
//   selfEmployment        -> seIncome
function computeFederalTaxBreakdown(ordinaryIncome, year, status, opts) {
      opts = opts || {};
      // Issue #56: alias common synonyms so a downstream rename (e.g.
      // ltcg vs longTermGain) doesn't silently zero out tens of
      // thousands of dollars of tax.
      var _lt = opts.longTermGain != null ? opts.longTermGain
              : (opts.ltcg != null ? opts.ltcg : opts.lt);
      // Issue #67: a negative LT gain (capital loss) qualifies for a
      // §1211(b) ordinary-income offset of up to $3,000/yr ($1,500
      // MFS). Surface that as an ordinaryIncome reduction here so
      // the bracket math sees the lower taxable amount. The remainder
      // carries forward (carryforward-tracker handles multi-year
      // accounting in projection-engine; this is the single-year
      // offset only). Previously the engine clamped LT to 0 silently.
      var _carriedLossOrdOffset = 0;
      if (_lt != null && Number(_lt) < 0) {
            var _cap = (status === 'mfs' || status === 'married_separate') ? 1500 : 3000;
            _carriedLossOrdOffset = Math.min(_cap, Math.abs(Number(_lt)));
            _lt = 0; // cap LT at 0 for the LTCG bracket loop
      }
      var _qd = opts.qualifiedDividend != null ? opts.qualifiedDividend : opts.qualifiedDiv;
      var _inv = opts.investmentIncome != null ? opts.investmentIncome
              : (opts.niitable != null ? opts.niitable : opts.niitIncome);
      var _w = opts.wages != null ? opts.wages
              : (opts.wagesIncome != null ? opts.wagesIncome : opts.earnedIncome);
      var _se = opts.seIncome != null ? opts.seIncome : opts.selfEmployment;
      const longTermGain      = Math.max(0, _lt || 0);
      const qualifiedDividend = Math.max(0, _qd || 0);
      const investmentIncome  = Math.max(0, _inv != null
                                          ? _inv : (longTermGain + qualifiedDividend));
      // Wage base for Additional Medicare. Defaults to 0 — NOT
      // ordinaryIncome — because the surcharge applies only to W-2
      // wages and SE earnings (IRC §3101(b)(2)). Real-estate clients
      // with rental/dividend ordinary income but $0 wages should pay
      // $0 Additional Medicare. Callers (inputs-collector, the test
      // harness) pass cfg.wages explicitly. (Issue #55.)
      const wages             = Math.max(0, (_w != null ? _w : 0) + (_se || 0));
      const itemized          = Math.max(0, opts.itemized || 0);

      const stdDed   = getFederalStandardDeduction(year, status);
      const ordBrk   = getFederalBrackets(year, status);
      const ltBrk    = getFederalLTCGBrackets(year, status);

      const deduction = Math.max(stdDed, itemized);
      // §1211(b) loss offset reduces taxable ordinary income before
      // brackets are applied. (Issue #67.)
      const taxableOrdinary = Math.max(0, ordinaryIncome - deduction - _carriedLossOrdOffset);

      const ordinaryTax = _flatBracketTax(taxableOrdinary, ordBrk);

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

      // AMTI for exemption-phaseout purposes includes BOTH the
      // ordinary taxable amount AND the LTCG amount (per Form 6251
      // line 7). Without the LTCG add-on the phaseout is too small
      // for high-LTCG years and AMT is understated. The 26%/28%
      // rate application is still on the ordinary slice — LTCG keeps
      // its preferential rate via the + ltTax line.
      const amtAmti     = taxableOrdinary + ltAmount;
      const amtOrdOnly  = _computeAmt(amtAmti, year, status);
      const amtTotal    = amtOrdOnly + ltTax;
      const amtTopUp    = Math.max(0, amtTotal - (ordinaryTax + ltTax));

      const magi = ordinaryIncome + ltAmount;
      const niit = _computeNiit(investmentIncome, magi, year, status);

      const addlMed = _computeAddlMedicare(wages, status);

      const total = ordinaryTax + ltTax + amtTopUp + niit + addlMed;
      return {
            ordinaryTax: ordinaryTax,
            ltTax: ltTax,
            amtTopUp: amtTopUp,
            niit: niit,
            addlMedicare: addlMed,
            total: total
      };
}
