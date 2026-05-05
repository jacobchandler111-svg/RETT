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

// Compute the AMT *on the ordinary slice only*. AMTI (full ordinary +
// LTCG) drives the exemption phaseout — high-LTCG years correctly
// shrink the AMT exemption — but the 26%/28% AMT rates apply only to
// the ordinary portion. LTCG keeps its preferential rate via the
// `+ ltTax` line at the call site (Form 6251 Part III).
//
// Previously this function returned the AMT rate applied to the FULL
// taxable AMTI (ordinary + LTCG), and the call site then ADDED ltTax
// on top — double-taxing the LTCG portion at 26/28% AND the LTCG rate.
// On a $48M LTCG / $0 ordinary case that fabricated ~$13M of AMT
// liability that doesn't exist on a real return.
function _computeAmt(amti, year, status, ltAmount) {
          const a = _amtForYearStatus(year, status);
          let exemption = a.exemption;
          const excess = Math.max(0, amti - a.phaseoutStart);
          exemption = Math.max(0, exemption - excess * 0.25);
          const taxable = Math.max(0, amti - exemption);
          if (taxable <= 0) return 0;
          // Strip out LTCG — taxed separately at preferential rates.
          const lt = Math.max(0, Number(ltAmount) || 0);
          const ordinarySlice = Math.max(0, taxable - lt);
          if (ordinarySlice <= 0) return 0;
          if (ordinarySlice <= a.rate26Threshold) return ordinarySlice * a.rate26;
          return a.rate26Threshold * a.rate26 + (ordinarySlice - a.rate26Threshold) * a.rate28;
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
//   longTermGain        — numeric, taxed via the LTCG bracket stack.
//                         A NEGATIVE value is a capital loss: up to
//                         $3,000/yr ($1,500 MFS) offsets ordinary income
//                         (§1211(b)); the remainder carries forward via
//                         carryforward-tracker.
//   shortTermGain       — numeric, taxed at ordinary rates. Folded into
//                         the ordinary stack inside this function so
//                         callers don't all have to pre-stack it. (P0-5.)
//   qualifiedDividend   — numeric, taxed at LTCG rates (treated like LT gain)
//   investmentIncome    — numeric, NIIT base (defaults to LT + QD + ST + rental + non-qual divs)
//   wages               — numeric, Additional Medicare base (W-2 only)
//   seIncome            — numeric, added to wages × 0.9235 for the
//                         Add'l Medicare base (Form 8959). The 0.9235
//                         multiplier is the SE-earnings adjustment;
//                         applying it AFTER summing was double-counting
//                         (P0-7).
//   itemized            — numeric, replaces the standard deduction if larger
//   carriedLossPriorYear — numeric, prior-year carried capital loss
//                         that ALSO qualifies for the $3,000 ordinary
//                         offset (separate from this year's LT loss).
// Aliased synonyms (mapped to the canonical keys above):
//   ltcg, lt              -> longTermGain
//   stcg, st              -> shortTermGain
//   qualifiedDiv          -> qualifiedDividend
//   niitable, niitIncome  -> investmentIncome
//   wagesIncome,
//   earnedIncome          -> wages
//   selfEmployment        -> seIncome
//
// Returns { ordinaryTax, ltTax, seTax, amtTopUp, niit, addlMedicare,
//           lossOrdOffsetApplied, lossCarryforward, total }.
function computeFederalTaxBreakdown(ordinaryIncome, year, status, opts) {
      opts = opts || {};
      // P2-7: surface unsupported year / filing status instead of
      // silently falling through to baseYear or 'single'. Logs once
      // per session per (year, status) combo so a typo in a saved
      // case doesn't spam the console while the user is editing.
      if (!isFilingStatusValid(status) && fsKey(status) === status) {
            // fsKey returns the raw input when no canonical mapping
            // exists. Treating that as "single" is what the prior
            // engine did — call it out so we can fix saved data.
            try {
                  if (typeof window !== 'undefined' &&
                      !(window.__rettBadStatusWarned = window.__rettBadStatusWarned || {})[String(status)]) {
                          window.__rettBadStatusWarned[String(status)] = true;
                          if (typeof console !== 'undefined' && console.warn) {
                                console.warn('[tax-calc-federal] Unsupported filing status "' + status + '" — falling back to single. Valid: ' + TAX_FILING_STATUSES.join(', '));
                          }
                  }
            } catch (e) { /* */ }
      }
      if (typeof TAX_DATA !== 'undefined' && TAX_DATA && TAX_DATA.years && TAX_DATA.years.length &&
          TAX_DATA.years.indexOf(Number(year)) === -1) {
            try {
                  var yKey = '__rettBadYearWarned';
                  if (typeof window !== 'undefined') {
                        window[yKey] = window[yKey] || {};
                        if (!window[yKey][String(year)]) {
                              window[yKey][String(year)] = true;
                              if (typeof console !== 'undefined' && console.warn) {
                                    console.warn('[tax-calc-federal] Year ' + year +
                                        ' is outside the published bracket data ' +
                                        '(' + TAX_DATA.years.join(', ') +
                                        '). Projecting from baseYear ' + TAX_DATA.baseYear +
                                        ' at ' + (TAX_DATA.inflationRate * 100).toFixed(1) +
                                        '%/yr — the further out, the more speculative.');
                              }
                        }
                  }
            } catch (e) { /* */ }
      }
      // Issue #56: alias common synonyms so a downstream rename (e.g.
      // ltcg vs longTermGain) doesn't silently zero out tens of
      // thousands of dollars of tax.
      var _lt = opts.longTermGain != null ? opts.longTermGain
              : (opts.ltcg != null ? opts.ltcg : opts.lt);
      var _st = opts.shortTermGain != null ? opts.shortTermGain
              : (opts.stcg != null ? opts.stcg : opts.st);
      // §1(h)(1)(E) unrecaptured §1250 gain — depreciation recapture
      // on real estate. Caller passes it separately from
      // ordinaryIncome so the engine can apply the 25% cap; if it
      // were bundled into ordinaryIncome it would silently pay full
      // marginal rates (up to 37%), over-taxing high-bracket clients
      // by 12+ percentage points on the recapture slice.
      var _recap = Math.max(0, Number(
            opts.depreciationRecapture != null
                  ? opts.depreciationRecapture
                  : (opts.depRecapture != null ? opts.depRecapture : 0)
      ) || 0);
      // §1211(b) loss offset: up to $3,000/yr ($1,500 MFS) of net
      // capital loss reduces ordinary income; the remainder carries
      // forward. Both this-year LT loss AND a prior-year carried loss
      // contribute, capped at the same single annual ceiling. Previously
      // the engine clamped LT to 0 silently and ignored carryforwards.
      var _capLoss = (status === 'mfs' || status === 'married_separate') ? 1500 : 3000;
      var _ltLossThisYear = (_lt != null && Number(_lt) < 0) ? Math.abs(Number(_lt)) : 0;
      var _carriedLossPrior = Math.max(0, Number(opts.carriedLossPriorYear) || 0);
      var _totalNetLoss = _ltLossThisYear + _carriedLossPrior;
      var _carriedLossOrdOffset = Math.min(_capLoss, _totalNetLoss);
      var _lossCarryforward = Math.max(0, _totalNetLoss - _carriedLossOrdOffset);
      if (_ltLossThisYear > 0) _lt = 0; // cap LT at 0 for the LTCG bracket loop
      var _qd = opts.qualifiedDividend != null ? opts.qualifiedDividend : opts.qualifiedDiv;
      var _inv = opts.investmentIncome != null ? opts.investmentIncome
              : (opts.niitable != null ? opts.niitable : opts.niitIncome);
      var _w = opts.wages != null ? opts.wages
              : (opts.wagesIncome != null ? opts.wagesIncome : opts.earnedIncome);
      var _se = opts.seIncome != null ? opts.seIncome : opts.selfEmployment;
      const longTermGain      = Math.max(0, _lt || 0);
      const shortTermGain     = Math.max(0, _st || 0);
      const qualifiedDividend = Math.max(0, _qd || 0);
      const seIncomeRaw       = Math.max(0, Number(_se) || 0);
      const investmentIncome  = Math.max(0, _inv != null
                                          ? _inv : (longTermGain + qualifiedDividend + shortTermGain));
      // Wage base for Additional Medicare per Form 8959. W-2 wages are
      // counted dollar-for-dollar; SE income is multiplied by 0.9235
      // (the SE-earnings adjustment that excludes the half-of-SE-tax
      // employer-equivalent deduction). Real-estate clients with $0
      // wages and $0 SE pay $0 Additional Medicare regardless of
      // ordinary rental/dividend income (IRC §3101(b)(2)). (P0-7.)
      const seTaxMult = (typeof TAX_DATA !== 'undefined' && TAX_DATA && TAX_DATA.seTaxMultiplier) || 0.9235;
      const wages             = Math.max(0, (_w != null ? _w : 0) + (seIncomeRaw * seTaxMult));
      const itemized          = Math.max(0, opts.itemized || 0);

      const stdDed   = getFederalStandardDeduction(year, status);
      const ordBrk   = getFederalBrackets(year, status);
      const ltBrk    = getFederalLTCGBrackets(year, status);

      const deduction = Math.max(stdDed, itemized);
      // §1211(b) loss offset + short-term gain both run through the
      // ordinary-income bracket stack. STG is taxed at ordinary rates
      // (no preferential bucket), and the loss offset reduces the base
      // before brackets apply. (P0-4, P0-5.) Depreciation recapture
      // (§1250) is included in the ordinary stack base so its bracket
      // position is correct; the special 25% cap is applied below
      // by splitting it back out of ordinaryTax.
      const ordinaryGross   = ordinaryIncome + shortTermGain + _recap;
      const taxableOrdinary = Math.max(0, ordinaryGross - deduction - _carriedLossOrdOffset);
      // Leftover deduction (when ordinary income alone wasn't enough to
      // absorb it) bleeds through to the LTCG bracket stack — on a
      // real return, the standard deduction shifts the LTCG bracket
      // floors up by the unused amount. Without this, a pure-LTCG year
      // with $0 ordinary income wastes the entire deduction × 20% in
      // overstated baseline tax.
      const _deductionConsumedOnOrd = Math.max(0, ordinaryGross - taxableOrdinary - _carriedLossOrdOffset);
      const _leftoverDeduction = Math.max(0, deduction - _deductionConsumedOnOrd);

      // §1(h)(1)(E) — unrecaptured §1250 gain caps at 25%. Compute
      // the bracket tax on taxableOrdinary BOTH including and
      // excluding the recapture slice, then attribute the difference
      // to recapTaxAtOrdinary. The §1250 cap floors that slice at
      // 25% × recapture; ordinary income outside the recapture slice
      // pays normal marginal rates.
      const _recapInTaxable = Math.min(_recap, taxableOrdinary);
      const _taxableOrdExRecap = Math.max(0, taxableOrdinary - _recapInTaxable);
      const ordinaryTaxExRecap = _flatBracketTax(_taxableOrdExRecap, ordBrk);
      const ordinaryTaxIncRecap = _flatBracketTax(taxableOrdinary, ordBrk);
      const _recapTaxAtOrdinary = Math.max(0, ordinaryTaxIncRecap - ordinaryTaxExRecap);
      const _recapTaxCapped = _recapInTaxable * 0.25;
      const recapTax = (_recapInTaxable > 0)
            ? Math.min(_recapTaxAtOrdinary, _recapTaxCapped)
            : 0;
      const ordinaryTax = ordinaryTaxExRecap;

      let ltTax = 0;
      const ltAmount = longTermGain + qualifiedDividend;
      if (ltAmount > 0 && ltBrk && ltBrk.length) {
            // Apply leftover standard deduction to the LTCG slab — the
            // first _leftoverDeduction dollars of LT gain are taxed at $0
            // (the deduction effectively shifts the LTCG bracket floors).
            const taxableLt = Math.max(0, ltAmount - _leftoverDeduction);
            let remaining = taxableLt;
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
      const amtOrdOnly  = _computeAmt(amtAmti, year, status, ltAmount);
      const amtTotal    = amtOrdOnly + ltTax;
      // Regular tax for AMT comparison includes recapTax — without
      // it the AMT top-up double-counts the recapture portion.
      const amtTopUp    = Math.max(0, amtTotal - (ordinaryTax + recapTax + ltTax));

      // MAGI for NIIT phase-in includes ordinary, ST gain, and LT gain.
      // Note: NIIT threshold is intentionally NOT inflation-indexed —
      // §1411 thresholds are set by statute at $200K single / $250K MFJ
      // / $125K MFS / $200K HoH and have stayed there since 2013. If a
      // future contributor "fixes" this by indexing it, they're wrong:
      // the IRS has not adjusted them and the JOBS Act / TCJA / OBBBA
      // explicitly left them flat. (P0-10.)
      const magi = ordinaryGross + ltAmount;
      const niit = _computeNiit(investmentIncome, magi, year, status);

      const addlMed = _computeAddlMedicare(wages, status);

      // Self-employment tax: SECA. 12.4% Social Security on the first
      // ssWageBase of (SE × 0.9235), plus 2.9% Medicare on all of
      // (SE × 0.9235). The half-of-SE-tax employer-equivalent deduction
      // is NOT applied here — that's an above-the-line deduction that
      // belongs on the AGI side (handled by callers via itemized/std
      // calc). Wages already paid into SS reduce the SS base. (P0-6.)
      let seTax = 0;
      if (seIncomeRaw > 0 && typeof TAX_DATA !== 'undefined' && TAX_DATA) {
            const seBase = seIncomeRaw * seTaxMult;
            const ssWageBase = Number(TAX_DATA.ssWageBase) || 176100; // 2025 SSA cap, 2026 TBD
            const w2Wages = Math.max(0, _w != null ? Number(_w) : 0);
            const ssRoom = Math.max(0, ssWageBase - w2Wages);
            const ssBase = Math.min(seBase, ssRoom);
            const ssTax = ssBase * 0.124;        // 12.4% Social Security
            const medTax = seBase * 0.029;       // 2.9% Medicare (no cap)
            seTax = ssTax + medTax;
      }

      const total = ordinaryTax + recapTax + ltTax + amtTopUp + niit + addlMed + seTax;
      return {
            ordinaryTax: ordinaryTax,
            recapTax: recapTax,
            ltTax: ltTax,
            seTax: seTax,
            amtTopUp: amtTopUp,
            niit: niit,
            addlMedicare: addlMed,
            // Surface the §1211(b) accounting so callers can render a
            // "$3K loss offset applied" line + a carryforward note.
            lossOrdOffsetApplied: _carriedLossOrdOffset,
            lossCarryforward: _lossCarryforward,
            total: total
      };
}
