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
// 2026 AMT figures per IRS Rev. Proc. 2025-32 (OBBB-amended inflation
// adjustments). Exemption (single $90,100 / MFJ $140,200; phaseout
// starts $500,000 / $1,000,000); 26%/28% rate breakpoint at $244,500
// for single/MFJ/HoH and $122,250 for MFS. Issue #54.
const FED_AMT_2026 = {
          single:           { exemption: 90100,  phaseoutStart: 500000,   rate26Threshold: 244500, rate26: 0.26, rate28: 0.28 },
          married_joint:    { exemption: 140200, phaseoutStart: 1000000,  rate26Threshold: 244500, rate26: 0.26, rate28: 0.28 },
          married_separate: { exemption: 70100,  phaseoutStart: 500000,   rate26Threshold: 122250, rate26: 0.26, rate28: 0.28 },
          head_household:   { exemption: 90100,  phaseoutStart: 500000,   rate26Threshold: 244500, rate26: 0.26, rate28: 0.28 }
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

// Per-slice bracket tax with a per-slice rate ceiling. Used for §1250
// unrecaptured gain (advisor-confirmed methodology 2026-05-27): the
// recap slice stacks on top of ordinary income (W-2 etc.), each
// bracket slot it touches is taxed at min(slot rate, rateCap). Where
// the bracket rate is below the cap, that slice pays the bracket rate;
// once the recap slice crosses into a bracket above the cap, the cap
// kicks in for the remainder. This is taxpayer-favorable vs the IRS
// Schedule D Tax Worksheet's "min(stacked-at-ordinary, cap × recap)"
// total-comparison approach. Advisor chose this method to match how
// the strategy is presented to clients.
//   amount           — width of the slice to tax
//   baseAlreadyTaxed — top of the ordinary stack the slice sits on top of
//   brackets         — same [[cap, rate], ...] shape as _flatBracketTax
//   rateCap          — per-slice ceiling (0.25 for §1250)
function _flatBracketTaxCapped(amount, baseAlreadyTaxed, brackets, rateCap) {
          if (amount <= 0 || !brackets || !brackets.length) return 0;
          let tax = 0;
          let remaining = amount;
          let cursor = Math.max(0, baseAlreadyTaxed);
          let prevMax = 0;
          for (const b of brackets) {
                        const cap = b[0], rate = b[1];
                        if (remaining <= 0.005) break;
                        if (cap <= cursor) { prevMax = cap; continue; }
                        const sliceFloor = Math.max(prevMax, cursor);
                        const sliceTop   = Math.min(cap, cursor + remaining);
                        const width      = sliceTop - sliceFloor;
                        if (width > 0) {
                                    tax += width * Math.min(rate, rateCap);
                                    remaining -= width;
                                    cursor = sliceTop;
                        }
                        prevMax = cap;
          }
          // If recap extends past the top declared bracket, anything left
          // pays at the top bracket's rate capped at rateCap.
          if (remaining > 0.005 && brackets.length) {
                        const topRate = brackets[brackets.length - 1][1];
                        tax += remaining * Math.min(topRate, rateCap);
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
function _computeAmt(amti, year, status, ltAmount, recapAmount) {
          const a = _amtForYearStatus(year, status);
          let exemption = a.exemption;
          const excess = Math.max(0, amti - a.phaseoutStart);
          exemption = Math.max(0, exemption - excess * 0.25);
          const taxable = Math.max(0, amti - exemption);
          if (taxable <= 0) return 0;
          // Form 6251 Part III preserves §1(h) preferential rates inside
          // AMT for both LTCG (0/15/20%) AND §1250 unrecaptured gain
          // (25% cap per §1(h)(1)(E)). Both buckets get carved out of
          // the 26/28% AMT ordinary band so the AMT top-up reflects only
          // the rate delta on TRUE ordinary income (W-2 + STG + non-recap
          // ordinary, post-stdDed). The recap slice is held to 25% inside
          // AMT just like it is in regular tax — Schedule D Tax Worksheet
          // line 33 (25% × unrecap) is preserved through the AMT computation.
          // Without the carve-out, recap rides 26-28% in AMT and falsely
          // inflates the top-up by 1-3 cents per dollar of recap.
          const lt   = Math.max(0, Number(ltAmount) || 0);
          const rcap = Math.max(0, Number(recapAmount) || 0);
          const recapInSlice = Math.min(rcap, Math.max(0, taxable - lt));
          const ordinarySlice = Math.max(0, taxable - lt - recapInSlice);
          const recapAmt = recapInSlice * 0.25;
          if (ordinarySlice <= 0) return recapAmt;
          const ordAmt = ordinarySlice <= a.rate26Threshold
              ? ordinarySlice * a.rate26
              : a.rate26Threshold * a.rate26 + (ordinarySlice - a.rate26Threshold) * a.rate28;
          return ordAmt + recapAmt;
}

function _computeNiit(investmentIncome, magi, year, status) {
          const threshold = getFederalNiitThreshold(year, status);
          const over = Math.max(0, magi - threshold);
          const base = Math.min(Math.max(0, investmentIncome), over);
          return base * 0.038;
}

// §86 Social Security taxability worksheet. Returns the taxable
// portion (0% / up to 50% / up to 85%) of gross SS benefits, which
// is added to ordinary income on Form 1040 Line 6b.
//
// provisional = otherAGI + taxExemptInterest + 0.5 × grossSS
//
// Thresholds are STATUTORY and NOT inflation-indexed (IRC §86(c)):
//   MFJ:           Tier 1 ≤ $32,000;  Tier 2 ≤ $44,000;  Tier 3 > $44,000
//   Single / HoH:  Tier 1 ≤ $25,000;  Tier 2 ≤ $34,000;  Tier 3 > $34,000
//   MFS lived-with-spouse: treated as Tier 3 from $0 (full 85%).
//
// Source: IRC §86; IRS Publication 915 Worksheet 1.
//
// State treatment is NOT modeled here - most states (incl. GA per
// O.C.G.A. §48-7-27(a)(4)) exempt SS entirely. CO/CT/MN/RI/UT/VT/WV
// have partial state-level SS taxation. Per advisor (GA-first), the
// engine adds the taxable SS portion to the state base alongside
// federal ordinary income, which over-states state tax for clients
// in SS-exempt states. P1 follow-up to add a per-state SS-inclusion
// flag to computeStateTax.
function _computeTaxableSocialSecurity(grossSS, otherAGI, taxExemptInterest, status) {
          var gss = Math.max(0, Number(grossSS) || 0);
          if (gss <= 0) return 0;
          var oth = Math.max(0, Number(otherAGI) || 0);
          var txi = Math.max(0, Number(taxExemptInterest) || 0);
          var provisional = oth + txi + 0.5 * gss;
          var key = fsKey(status);
          // MFS-lived-with-spouse: §86(c)(1)(C)(ii) sets thresholds to
          // zero, effectively making 85% of SS taxable from dollar one.
          if (key === 'married_separate') {
                        return Math.min(0.85 * gss, 0.85 * provisional);
          }
          var t1 = (key === 'married_joint') ? 32000 : 25000;
          var t2 = (key === 'married_joint') ? 44000 : 34000;
          if (provisional <= t1) return 0;
          if (provisional <= t2) {
                        return Math.min(0.5 * (provisional - t1), 0.5 * gss);
          }
          var tier2Cap = 0.5 * (t2 - t1);
          var tier3Add = 0.85 * (provisional - t2);
          return Math.min(tier2Cap + tier3Add, 0.85 * gss);
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
//   investmentIncome    — numeric, NIIT base. DEFAULT IS NARROW:
//                         longTermGain + qualifiedDividend + shortTermGain.
//                         Real §1411 NIIT base also includes interest,
//                         rental + royalty income, annuity income, and
//                         passive-activity income — which this engine
//                         doesn't see as separate buckets. Callers with
//                         those items MUST pass an explicit
//                         opts.investmentIncome that includes them, or
//                         NIIT will be understated.
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
      // contribute, capped at the same single annual ceiling.
      //
      // Cross-bucket netting per Schedule D (Form 1040): a net ST loss
      // first reduces net LT gain (and vice versa) BEFORE either bucket
      // hits the ordinary brackets / LTCG brackets. Whatever remains
      // negative after netting feeds §1211(b). The earlier code
      // captured only LT loss → §1211(b) and silently dropped any ST
      // loss, which understated the carryforward and could miss the
      // $3K ordinary offset for clients with a loss-only ST position.
      var _capLoss = (status === 'mfs' || status === 'married_separate') ? 1500 : 3000;
      var _ltSigned = (_lt != null) ? Number(_lt) : 0;
      var _stSigned = (_st != null) ? Number(_st) : 0;
      // Schedule D Part III netting between ST and LT buckets when one
      // is negative and the other positive.
      if (_ltSigned > 0 && _stSigned < 0) {
            var _stLossAbs = -_stSigned;
            if (_stLossAbs <= _ltSigned) {
                  _ltSigned -= _stLossAbs;
                  _stSigned = 0;
            } else {
                  _stSigned = -(_stLossAbs - _ltSigned);
                  _ltSigned = 0;
            }
      } else if (_ltSigned < 0 && _stSigned > 0) {
            var _ltLossAbs = -_ltSigned;
            if (_ltLossAbs <= _stSigned) {
                  _stSigned -= _ltLossAbs;
                  _ltSigned = 0;
            } else {
                  _ltSigned = -(_ltLossAbs - _stSigned);
                  _stSigned = 0;
            }
      }
      var _ltLossThisYear = _ltSigned < 0 ? -_ltSigned : 0;
      var _stLossThisYear = _stSigned < 0 ? -_stSigned : 0;
      var _carriedLossPrior = Math.max(0, Number(opts.carriedLossPriorYear) || 0);
      var _totalNetLoss = _ltLossThisYear + _stLossThisYear + _carriedLossPrior;
      var _carriedLossOrdOffset = Math.min(_capLoss, _totalNetLoss);
      var _lossCarryforward = Math.max(0, _totalNetLoss - _carriedLossOrdOffset);
      // Push post-netting residuals back into the variables the rest of
      // this function uses for the bracket walks. Either remaining
      // signed value is non-negative now (negatives went into the
      // §1211(b) bucket above), so the Math.max(0, ...) clamps below
      // are no-ops in the normal case.
      _lt = Math.max(0, _ltSigned);
      _st = Math.max(0, _stSigned);
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

      // §1212(b) carryforward accounting: the §1211(b) ordinary offset
      // is BOUNDED by available taxable ordinary AFTER std deduction.
      // If ord = $5K and stdDed = $32K, taxable ord clamps to 0 with
      // stdDed alone — the cap loss offset can't reduce a 0 base any
      // further, and the unused portion must carry forward. Without
      // this correction the carryforward was understated by up to the
      // full ($3K / $1.5K MFS) cap for low-income years.
      const _ordGrossForOffsetCap = (ordinaryIncome + shortTermGain + _recap);
      const _ordPostStdDed = Math.max(0, _ordGrossForOffsetCap - deduction);
      const _effectiveLossOrdOffset = Math.min(_carriedLossOrdOffset, _ordPostStdDed);
      // The carryforward is "everything that didn't actually reduce
      // taxable ord this year." Effective offset replaces the nominal
      // for both the carryforward calc and the value returned to the
      // caller via lossOrdOffsetApplied.
      _lossCarryforward = Math.max(0, _totalNetLoss - _effectiveLossOrdOffset);
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

      // §1(h)(1)(E) unrecaptured §1250 gain — PER-SLICE 25% cap
      // (advisor methodology, confirmed 2026-05-27). Recap stacks on
      // top of taxableOrdinary minus recap (= W-2/STG/etc. after std
      // deduction). For each ordinary bracket the recap slice touches,
      // that piece is taxed at min(bracket rate, 25%). Differs from
      // the IRS Schedule D Tax Worksheet, which uses a total-comparison
      // cap (min(stacked-at-ordinary, 25% × recap)); the per-slice
      // method is taxpayer-favorable for scenarios where part of recap
      // falls into a bracket above 25% (the over-25% portion gets
      // capped; the below-25% portion does NOT get pulled up to 25%
      // by the worksheet's all-or-nothing comparison).
      const _recapInTaxable = Math.min(_recap, taxableOrdinary);
      const _taxableOrdExRecap = Math.max(0, taxableOrdinary - _recapInTaxable);
      const ordinaryTaxExRecap = _flatBracketTax(_taxableOrdExRecap, ordBrk);
      const ordinaryTaxIncRecap = _flatBracketTax(taxableOrdinary, ordBrk);
      const recapTax = (_recapInTaxable > 0)
            ? _flatBracketTaxCapped(_recapInTaxable, _taxableOrdExRecap, ordBrk, 0.25)
            : 0;
      // Keep these for AMT-comparison and other call sites that read them.
      const _recapTaxAtOrdinary = Math.max(0, ordinaryTaxIncRecap - ordinaryTaxExRecap);
      const _recapTaxCapped = _recapInTaxable * 0.25;
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
      //
      // §55(b)(1)(A) / Form 6251 line 2a: the STANDARD DEDUCTION is
      // disallowed for AMT — it gets added back to AMTI. Itemized
      // deductions stay in (they may have their own AMT preference
      // items like state taxes, but we don't model those today).
      // Without this add-back the engine was under-counting AMTI by
      // the standard deduction ($29,200 MFJ 2026), which let some
      // high-LTCG / low-ord scenarios escape AMT that would actually
      // owe top-up on a real return.
      const _stdDedAddback = (deduction === stdDed && stdDed > 0) ? stdDed : 0;
      const amtAmti     = taxableOrdinary + _stdDedAddback + ltAmount;
      const amtOrdOnly  = _computeAmt(amtAmti, year, status, ltAmount, _recapInTaxable);
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
            const ssWageBase = Number(TAX_DATA.ssWageBase) || 184500; // 2026 SSA wage base (Oct 2025 release)
            const w2Wages = Math.max(0, _w != null ? Number(_w) : 0);
            const ssRoom = Math.max(0, ssWageBase - w2Wages);
            const ssBase = Math.min(seBase, ssRoom);
            const ssTax = ssBase * 0.124;        // 12.4% Social Security
            const medTax = seBase * 0.029;       // 2.9% Medicare (no cap)
            seTax = ssTax + medTax;
      }

      const total = ordinaryTax + recapTax + ltTax + amtTopUp + niit + addlMed + seTax;
      // Expose AMT internals so the admin panel can show how the top-up
      // was derived (advisor wants to see TMT vs regular side-by-side).
      // tentativeMinimumTax = §55(b) total under the alt-min regime
      // (AMT applied to ordinary slice + preferential LTCG layered on
      // top). regularFederalTax = the §1 stack that AMT is compared to.
      // amtTopUp = max(0, tentativeMinimumTax - regularFederalTax).
      const regularFederalTax = ordinaryTax + recapTax + ltTax;
      const tentativeMinimumTax = amtTotal;
      return {
            ordinaryTax: ordinaryTax,
            recapTax: recapTax,
            ltTax: ltTax,
            seTax: seTax,
            amtTopUp: amtTopUp,
            tentativeMinimumTax: tentativeMinimumTax,
            regularFederalTax: regularFederalTax,
            niit: niit,
            addlMedicare: addlMed,
            // Surface the §1211(b) accounting so callers can render a
            // "$3K loss offset applied" line + a carryforward note.
            // Return the EFFECTIVE offset (bounded by available taxable
            // ord) rather than the nominal min($3K, totalLoss) so the
            // displayed offset matches what actually reduced the tax
            // bill, and the carryforward correctly captures everything
            // that didn't apply this year.
            lossOrdOffsetApplied: _effectiveLossOrdOffset,
            lossCarryforward: _lossCarryforward,
            total: total
      };
}
