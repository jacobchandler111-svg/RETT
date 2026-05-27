// FILE: js/02-tax-engine/tax-comparison.js
// Side-by-side baseline vs. post-strategy tax. Per-year, multi-year aware.

// =============================================================================
// TEMPORARY — MetLife structured-sale payment-schedule rules (2026-05-07,
// updated 2026-05-08 for new 3-year approval)
// =============================================================================
// MetLife's contractual requirements for the Brooklyn structured-sale
// product. These are CONTRACT terms (not tax rules) imposed by the
// insurance carrier; they will change as MetLife updates the product
// spec. When that happens, edit the constants below and search for
// "METLIFE_RULES" or "_metlifeRulesForTerm" to find every dependent
// code path.
//
// Term-specific rules (yearly Jan-1 payments):
//   • 3-year (36mo): first ≤ 40%, last ≥ 20%
//                    canonical: 40/40/20 split.
//   • 4-year+ (48mo, 60mo, 72mo): first ≤ 50%, last ≥ 10%
//                    canonical: 50/30/10/10 split.
//
// Universal rule (applies to BOTH terms):
//   • First two payments combined ≤ 80% of total gain.
// Both canonical examples respect this naturally (40+40=80, 50+30=80) —
// the carrier added it as the third-rail constraint to ensure the back
// half of the contract still carries meaningful gain.
//
// 36mo is the floor (per MetLife's 2026-05-08 approval, was 48mo prior).
// 72mo is the practical ceiling.
//
// The engine enforces these inside the deferred-path recognition loop:
//   - Caps year 1 at firstPaymentMaxPct × totalGain
//   - Caps year 2 such that Y1+Y2 ≤ firstTwoPaymentsMaxPct × totalGain
//   - Reserves ≥ lastPaymentMinPct × totalGain for the maturity year
//
// Applies only when cfg.structuredSaleDurationMonths is set AND
// cfg.maxRecognitionYearIndex is absent. Strategy A (immediate) and
// Strategy B (Seller Finance §453, sets maxRecognitionYearIndex) bypass
// because they don't route through the MetLife product.
// =============================================================================
// Per advisor 2026-05-26: structured sale is locked to a single 3-year
// 40/40/20 schedule. The prior 4-year+ branch (50/30/10/10) was
// removed since the advisor confirmed the product offering is 3-year
// only. Code paths still accept durationMonths so saved cases with
// e.g. 48mo aren't rejected outright - they're coerced to 36mo math.
var METLIFE_RULES = {
      firstPaymentMaxPct:        0.40,
      firstTwoPaymentsMaxPct:    0.80,
      lastPaymentMinPct:         0.20
};

function _metlifeRulesForTerm(durationMonths) {
      // Always return the canonical 3-year rule. durationMonths is
      // accepted for backwards compatibility but ignored - all
      // structured sales are 3-year.
      return {
            firstPaymentMaxPct:     0.40,
            firstTwoPaymentsMaxPct: 0.80,
            lastPaymentMinPct:      0.20
      };
}

// --- Module-local helpers -----------------------------------------------
// Default leverage when cfg supplies neither leverage nor leverageCap
// as a finite number. Honors EXPLICIT zero — leverage=0 in Brooklyn
// data maps to the "Long-Only" tier (100/0, lossRate ~0.104, fee
// 0.17%), not "no engagement". Falls through to leverageCap, then to
// the published max 2.25 only when neither field is finite.
function _defaultLeverage(cfg) {
      var lev = cfg && cfg.leverage;
      if (Number.isFinite(Number(lev))) return Number(lev);
      var cap = cfg && cfg.leverageCap;
      if (Number.isFinite(Number(cap))) return Number(cap);
      return 2.25;
}

// Schwab Beta 1 200/100 lossByYear curve. Used as the canonical decay
// shape proxy for non-Schwab paths (Brooklyn doesn't publish per-year
// rate cards for non-Schwab custodians, so we taper Y2+ using this
// known curve scaled to the per-tier Y1 rate). Was duplicated inline
// in two engine paths — centralized here so any future refresh touches
// one place.
var _SCHWAB_BETA1_200_100_LOSS_BY_YEAR =
      [0.590, 0.492, 0.427, 0.393, 0.389, 0.376, 0.363, 0.351, 0.342, 0.334];
function _proxyDecayCurve() {
      if (typeof window !== 'undefined' && window.SCHWAB_COMBOS &&
          window.SCHWAB_COMBOS.beta1_200_100 &&
          Array.isArray(window.SCHWAB_COMBOS.beta1_200_100.lossByYear)) {
            return window.SCHWAB_COMBOS.beta1_200_100.lossByYear;
      }
      return _SCHWAB_BETA1_200_100_LOSS_BY_YEAR;
}

// Builds a year-indexed loss-rate function for a Brooklyn position.
// Used by both the immediate path (single Y1 tranche) and the deferred
// path (each tranche calls it with its own age). Same blending math
// either way:
//   Schwab combo:    j=0 → lossByYear[0]*yf
//                    j≥1 → (1−yf)*lossByYear[j−1] + yf*lossByYear[j]
//   Non-Schwab:      year1Rate × proxyShape(j) with the same blend
// yf is year-fraction-remaining of the strategy implementation date.
// Returns a (j) → number function, or null if cfg can't produce a rate.
function _buildLossRateByAge(cfg, yf) {
      var combo = (cfg && cfg.comboId && typeof getSchwabCombo === 'function')
            ? getSchwabCombo(cfg.comboId) : null;
      if (combo && Array.isArray(combo.lossByYear)) {
            var arr = combo.lossByYear;
            return function (j) {
                  if (j <= 0) return (arr[0] || 0) * yf;
                  var prev = arr[j - 1] || 0;
                  var curr = arr[j] || 0;
                  return (1 - yf) * prev + yf * curr;
            };
      }
      var lev = _defaultLeverage(cfg);
      var year1Rate = 0;
      if (typeof window !== 'undefined' && typeof window.brooklynLossRateForLeverage === 'function') {
            year1Rate = window.brooklynLossRateForLeverage(cfg.tierKey || 'beta1', lev);
      } else if (typeof brooklynInterpolate === 'function') {
            var snap = brooklynInterpolate(cfg.tierKey || 'beta1', lev);
            year1Rate = snap ? (snap.lossRate || 0) : 0;
      }
      if (year1Rate <= 0) return null;
      var ref = _proxyDecayCurve();
      var refY1 = ref[0] || 1;
      function shape(idx) {
            var k = Math.min(ref.length - 1, Math.max(0, idx | 0));
            return ref[k] / refY1;
      }
      return function (j) {
            if (j <= 0) return year1Rate * shape(0) * yf;
            var prev = year1Rate * shape(j - 1);
            var curr = year1Rate * shape(j);
            return (1 - yf) * prev + yf * curr;
      };
}
//
// Per-year scenario shape used by computeFederalTaxBreakdown / computeStateTax:
//   { year, status, state, ordinaryIncome, shortTermGain, longTermGain,
//     qualifiedDividend, investmentIncome, wages, itemized }
//
// Brooklyn-generated losses are SHORT-TERM. They offset short-term gain first,
// then ordinary income up to a yearly cap (default $3,000 if unused capital
// loss carryforward applies; for our use-case the loss is structured against
// the full ordinary income from the property gain in the year it is realized,
// so we apply the loss to ordinary first, then short-term gain).

function _baseScenarioForYear(cfg, yr, gainTakenThisYear, recaptureThisYear) {
      // gainTakenThisYear is the long-term gain recognized in this year of
      // the structured sale. For single-year recommendations, year-1 gets
      // the full longTermGain. For multi-year, the engine spreads it.
      //
      // recaptureThisYear is unrecaptured §1250 depreciation recognized
      // in this year. Recapture is taxed at ORDINARY rates (the §1250
      // 25% cap is applied in tax-calc-federal — not part of this fn),
      // so it's added to ordinaryIncome here, not to ltAmt. Y1 of the
      // immediate path and Y1 of the deferred do-nothing baseline both
      // need this so they match the Page-1 panel's "Total Tax If You
      // Did Nothing" — which has always summed recapture into the
      // ordinary stack.
      const idx = yr - cfg.year1;
      // When no per-year override is supplied, scale ordinary income by
      // the same inflation factor the engine uses for bracket projection
      // (2% per year past base). Without this, brackets inflate but
      // income stays flat — clients silently drift into a lower
      // effective marginal rate, understating baseline tax (and thus
      // overstating savings) by ~10% over a 5-year horizon.
      // Read inflation rate from TAX_DATA directly — keeping a literal
      // 0.02 fallback silently drifts from the data file if it's ever
      // tuned. If TAX_DATA isn't loaded, fall through to 0 so the math
      // breaks loudly rather than silently using a stale rate.
      const _infl = (typeof TAX_DATA !== 'undefined' && TAX_DATA && typeof TAX_DATA.inflationRate === 'number')
            ? TAX_DATA.inflationRate
            : ((typeof window !== 'undefined' && window.TAX_DATA && typeof window.TAX_DATA.inflationRate === 'number')
                  ? window.TAX_DATA.inflationRate : 0);
      const _scaledBaseOrd = (cfg.baseOrdinaryIncome || 0) * Math.pow(1 + _infl, Math.max(0, idx));
      const _scaledBaseWages = (cfg.wages || 0) * Math.pow(1 + _infl, Math.max(0, idx));
      const ordOverride = (cfg.ordinaryByYear   && cfg.ordinaryByYear[idx]   != null) ? cfg.ordinaryByYear[idx]   : _scaledBaseOrd;
      // Q2 multi-property holding-period: shortTermPropertyGain captures
      // any property the user marked as held < 1 year. ST property gain
      // is recognized in the sale year only (idx === 0); LT-flavored
      // strategy deferrals don't apply to ST gain.
      const _stOverride = (cfg.shortGainByYear && cfg.shortGainByYear[idx] != null) ? cfg.shortGainByYear[idx] : (cfg.baseShortTermGain || 0);
      const shortOverride = _stOverride + ((idx === 0) ? (cfg.shortTermPropertyGain || 0) : 0);
      // Q7: baseLongTermGain mirrors baseShortTermGain — non-property LT
      // income (stocks held >1yr, crypto, etc.) recurs each year. Engine
      // falls back to it when longGainByYear[idx] is not set.
      const longOverride  = (cfg.longGainByYear  && cfg.longGainByYear[idx]  != null) ? cfg.longGainByYear[idx]  : (cfg.baseLongTermGain || 0);
      const ltAmt = (gainTakenThisYear != null ? gainTakenThisYear : 0) + longOverride;
      // Passive / portfolio income inside ordinary (rental + non-qualified
      // div / interest) is also part of the §1411 NIIT base. Inflated
      // alongside baseOrdinaryIncome so high-income clients with heavy
      // rental income pay the right NIIT every year.
      const _scaledInvOrd = (cfg.investmentIncomeOrdinary || 0) * Math.pow(1 + _infl, Math.max(0, idx));
      const _recap = Math.max(0, Number(recaptureThisYear) || 0);
      // Qualified dividends — recurring annual income, inflation-scaled
      // alongside other recurring streams. IRC §1(h)(11): preferential
      // LTCG rates, stacks on ordinary for bracket placement, in NIIT
      // base. Engine path: scenario.qualifiedDividend → opts.qualified-
      // Dividend → computeFederalTaxBreakdown ltAmount + investment-
      // Income. Wired 2026-05-27.
      const _scaledQualDiv = (cfg.qualifiedDividend || 0) * Math.pow(1 + _infl, Math.max(0, idx));
      // Social Security (gross). IRC §86 — taxable portion derived via
      // the provisional-income worksheet. The taxable portion taxes at
      // ordinary brackets but does NOT enter the NIIT base (Form 8960
      // line 1 excludes SS) and does NOT enter the Additional Medicare
      // wage base (SS is not earned income). Provisional includes the
      // year's other ordinary income + capital gains + 50% of gross SS.
      // SS itself is COLA-indexed, scale gross by the same inflation
      // factor as wages so multi-year projections are coherent.
      const _scaledGrossSS = (cfg.socialSecurityBenefits || 0) * Math.pow(1 + _infl, Math.max(0, idx));
      var _taxableSS = 0;
      if (_scaledGrossSS > 0 && typeof _computeTaxableSocialSecurity === 'function') {
            var _ssRecapForProv = Math.max(0, Number(recaptureThisYear) || 0);
            var _otherAgi = ordOverride + _scaledQualDiv + _scaledInvOrd
                  + Math.max(0, shortOverride) + ltAmt + _ssRecapForProv;
            _taxableSS = _computeTaxableSocialSecurity(_scaledGrossSS, _otherAgi, 0, cfg.filingStatus);
      }
      return {
            year: yr,
            status: cfg.filingStatus,
            state: cfg.state,
            // Recapture flows through depreciationRecapture (separate
            // field) so the engine can apply the §1250 25% cap. Adding
            // it to ordinaryIncome would silently route it through
            // full marginal rates.
            // Taxable SS (§86) folds into ordinary income for bracket
            // placement. Not added to investmentIncome (excluded from
            // NIIT). State base inherits this via _ord pass-through in
            // _yearTaxes - acceptable for GA-first audience, P1 to
            // refine per-state SS exemption.
            ordinaryIncome: ordOverride + _taxableSS,
            depreciationRecapture: _recap,
            shortTermGain: shortOverride,
            longTermGain: ltAmt,
            qualifiedDividend: _scaledQualDiv,
            _taxableSocialSecurity: _taxableSS,
            _grossSocialSecurity:   _scaledGrossSS,
            // NIIT base = LT gain + ST gain + §1250 unrecaptured gain +
            // passive ordinary (rental / non-qualified div / interest).
            // Per §1411, depreciation recapture from a property sale IS
            // net investment income (it's gain from disposition of
            // property held in a passive activity / investment), so it
            // belongs in the NIIT base. Previously omitted, which
            // under-reported NIIT on recapture-heavy scenarios. Loss
            // netting in _applyLossesToScenario / _applyLossesWithSTCfCap
            // now subtracts offset amounts from this same base, keeping
            // ledger consistent.
            investmentIncome: ltAmt + Math.max(0, shortOverride) + _recap + _scaledInvOrd + _scaledQualDiv,
            // Additional-Medicare wage base. cfg.wages (W-2 + SE only)
            // when supplied — scaled by the same inflation factor as
            // baseOrdinaryIncome so wages grow alongside brackets.
            // Falls back to ordOverride for backward-compat with cfg
            // objects that predate the wages split.
            wages: (cfg.wages != null ? _scaledBaseWages : ordOverride),
            itemized: cfg.itemized || 0
      };
}

function _yearTaxes(scenario) {
      // Guard: defensive defaults so a partially-built scenario can't
      // produce NaN or null for the federal/state/total numbers
      // (Issues #57/#58). Every numeric input is normalized to 0 if
      // missing, and `year` falls back to the current year.
      const _s = scenario || {};
      const _ord = Number(_s.ordinaryIncome) || 0;
      const _st  = Number(_s.shortTermGain)  || 0;
      const _lt  = Number(_s.longTermGain)   || 0;
      const _qd  = Number(_s.qualifiedDividend) || 0;
      const _rcp = Number(_s.depreciationRecapture) || 0;
      const _inv = (_s.investmentIncome != null) ? Number(_s.investmentIncome) : (_lt + _qd);
      const _w   = (_s.wages != null) ? Number(_s.wages) : 0;
      const _itm = Number(_s.itemized) || 0;
      const _yr  = _s.year != null ? _s.year : (new Date()).getFullYear();
      const _stat = _s.status || 'single';
      const _state = _s.state || 'NONE';
      const fed   = computeFederalTaxBreakdown(
            _ord + _st,
            _yr, _stat,
            { longTermGain: _lt, qualifiedDividend: _qd,
              depreciationRecapture: _rcp,
              investmentIncome: _inv, wages: _w,
              itemized: _itm });
      // State tax sees recapture as ordinary income — most states do
      // NOT honor the federal §1250 25% cap. Pass recapture into the
      // ordinary base for state calc so state revenue is right.
      // Pass _ordOffsetApplied so disconforming states (NJ) can add
      // back the federal §1211 ordinary offset that was already baked
      // into _ord — they don't conform to the federal $3K offset rule
      // (NJSA 54A:5-2 categorizes income; capital losses can't offset
      // ordinary in NJ).
      const _ordOffApplied = Number(_s._ordOffsetApplied) || 0;
      const stateTax = computeStateTax(
            _ord + _st + _rcp + _lt + _qd,
            _yr, _state, _stat,
            { itemized: _itm, longTermGain: _lt, lossOrdOffsetApplied: _ordOffApplied });
      // Schema convention (don't drift):
      //   ordinaryTax / recapTax / ltTax / amt — components of the
      //     income-tax calculation (Form 1040 line 16-equivalent).
      //     recapTax is the §1(h)(1)(E) unrecaptured §1250 gain
      //     bucket — capped at 25%, separate from ordinaryTax.
      //   niit / addlMedicare / seTax — separate federal surcharges.
      //   federal — GRAND federal total (income tax + all surcharges).
      //   federalIncomeTax — NARROW: ord + recap + lt + amt only,
      //     matches the "Federal Income Tax" label on the Page-1 panel
      //     and the Strategy Summary. Use this when comparing rendered
      //     values to the panel; use `federal` when summing to a
      //     grand-total tax owed.
      //   total = federal + state.
      var _ord1 = Number(fed && fed.ordinaryTax) || 0;
      var _rcp1 = Number(fed && fed.recapTax)    || 0;
      var _lt1  = Number(fed && fed.ltTax)       || 0;
      var _amt1 = Number(fed && fed.amtTopUp)    || 0;
      return {
            federal: Number(fed && fed.total) || 0,
            federalIncomeTax: _ord1 + _rcp1 + _lt1 + _amt1,
            ordinaryTax: _ord1,
            recapTax: _rcp1,
            ltTax: _lt1,
            amt: _amt1,
            niit: Number(fed && fed.niit) || 0,
            addlMedicare: Number(fed && fed.addlMedicare) || 0,
            seTax: Number(fed && fed.seTax) || 0,
            state: Number(stateTax) || 0,
            total: (Number(fed && fed.total) || 0) + (Number(stateTax) || 0)
      };
}


// ============================================================
// Deferred-path helpers.
//
// _applyLossesWithSTCfCap, _belowMinForLifecycle, _zeroDeferredComparison,
// _structuredSaleMaturityYearIdx, and _estimateGainTaxRate are shared
// between the unified engine (deferred mode) and the legacy immediate
// engine. The original computeDeferredTaxComparison function was deleted
// in Session A of the engine collapse — unified handles the deferred
// path directly. See unifiedTaxComparison below for the deferred-mode
// loop logic (gain recognition window, tranche reinvestment, structured-
// sale maturity clamping, gain conservation invariant, etc.).

function _applyLossesWithSTCfCap(scenario, lossAvailable, capOrdinary) {
      capOrdinary = capOrdinary != null ? capOrdinary : 3000;
      const out = Object.assign({}, scenario);
      let loss = lossAvailable;

      // IRC §1(h) loss ordering — capital losses absorb gain buckets
      // highest-rate first (taxpayer-favorable):
      //   1) ST gain (ordinary rates, up to 37%)
      //   2) §1250 unrecaptured gain (capped at 25%)
      //   3) Regular LT gain (0/15/20%)
      //   4) Ordinary income (capped at $3K / $1.5K MFS)

      // Step 1: ST gain. ST cap gain is investment income for §1411 NIIT
      // purposes (per the same logic as recap and LT below), so the NIIT
      // base must shrink by the absorbed amount alongside shortTermGain.
      // Bug fix 2026-05-06 (verified by targeted-loss-application tests):
      // omitting this caused the 3.8% NIIT savings on Brooklyn-absorbed
      // ST gain to silently drop. Symptom was T3_ST_first_h1 ratio
      // landing at 0.370 (federal 37% only) instead of expected 0.408
      // (37% + 3.8% NIIT). Steps 2 (recap) and 3 (LT) already shrink
      // investmentIncome correctly.
      const offsetShort = Math.min(out.shortTermGain || 0, loss);
      out.shortTermGain = (out.shortTermGain || 0) - offsetShort;
      out.investmentIncome = Math.max(0, (out.investmentIncome || 0) - offsetShort);
      loss -= offsetShort;

      // Step 2: §1250 unrecaptured gain (recapture). Still a capital gain
      // for §1211 netting purposes, just rate-capped at 25% downstream.
      // NIIT base also shrinks since recapture is investment income.
      if (loss > 0) {
            const offsetRecap = Math.min(out.depreciationRecapture || 0, loss);
            out.depreciationRecapture = (out.depreciationRecapture || 0) - offsetRecap;
            out.investmentIncome = Math.max(0, (out.investmentIncome || 0) - offsetRecap);
            loss -= offsetRecap;
      }

      // Step 3: LT gain (the recognized property gain in year R).
      if (loss > 0) {
            const offsetLong = Math.min(out.longTermGain || 0, loss);
            out.longTermGain = (out.longTermGain || 0) - offsetLong;
            out.investmentIncome = Math.max(0, (out.investmentIncome || 0) - offsetLong);
            loss -= offsetLong;
      }

      // Step 4: ordinary income, capped at $3,000 (or $1,500 for MFS).
      // Track the actual amount applied to ordinary so the state tax
      // engine can add it back for disconforming states (NJ): NJSA
      // 54A:5-2 categorizes income, and capital losses can't offset
      // ordinary in NJ. Without _ordOffsetApplied, the federal-baked-in
      // reduction silently propagates to NJ state tax (audit F13).
      let _ordOffsetApplied = 0;
      if (loss > 0) {
            const cap = Math.min(out.ordinaryIncome || 0, capOrdinary);
            const offsetOrd = Math.min(cap, loss);
            out.ordinaryIncome = (out.ordinaryIncome || 0) - offsetOrd;
            // Wages are unchanged — see note in _applyLossesToScenario.
            loss -= offsetOrd;
            _ordOffsetApplied = offsetOrd;
      }

      out._lossUsed = lossAvailable - loss;
      out._lossUnused = loss;
      out._ordOffsetApplied = _ordOffsetApplied;
      return out;
}

// Returns true when the cumulative deposit possible across the horizon
// (basis cash + all gain proceeds, or just cfg.investment if no sale)
// can never reach the custodian's strategy minimum. In that case the
// position can't legally open, so the entire Brooklyn projection
// should return zero results — the dashboard will then surface a
// "no-engagement" experience.
function _belowMinForLifecycle(cfg) {
      if (typeof window === 'undefined' || typeof window.getMinInvestment !== 'function') return false;
      const custodianId = cfg.custodian;
      if (!custodianId) return false;
      // G6: when tierKey/strategyKey are absent, derive the strategy from
      // the comboId prefix (e.g. 'beta1_200_100' → 'beta1'). Production
      // dashboard always sets tierKey, so this only matters for
      // programmatic callers that pass comboId alone.
      const stratKey = cfg.tierKey || cfg.strategyKey
            || (cfg.comboId ? String(cfg.comboId).split('_')[0] : null);
      if (!stratKey) return false;
      // Pass cfg.comboId so Schwab returns the combo-specific minimum
      // (145/45 = $1M, 200/100 = $3M) instead of the strategy-wide floor.
      const min = window.getMinInvestment(custodianId, stratKey, cfg.comboId);
      if (!min) return false;
      const basis = Math.max(0, cfg.costBasis || 0);
      // STG is now an independent income item (not carved from sale).
      // Q2 multi-property holding-period split: shortTermPropertyGain is
      // the portion of the aggregate property gain the user marked as
      // short-term-held. Subtract it from the LT formula since that gain
      // is taxed at ordinary (ST) rates, not LT cap-gain rates.
      const ltGain = Math.max(0, (cfg.salePrice || 0) - (cfg.costBasis || 0) - (cfg.acceleratedDepreciation || 0) - (cfg.shortTermPropertyGain || 0));
      const recapture = Math.max(0, cfg.acceleratedDepreciation || 0);
      // G6: a $0-basis sale (gift, fully-depreciated property) still
      // produces deposit-able cash equal to the gain plus recapture, so
      // basis=0 should not zero out fromSale.
      const fromSale = (cfg.salePrice || 0) > 0
            ? (basis + ltGain + recapture)
            : 0;
      const fromIntent = Number(cfg.investment || 0);
      const maxCum = Math.max(fromSale, fromIntent);
      return maxCum < min;
}

// Build a zeroed-out deferred-comparison result for cases where the
// position can never legitimately open (below custodian min for the
// full horizon). Shape matches what computeDeferredTaxComparison
// normally returns so downstream renderers don't need a special path.
function _zeroDeferredComparison(cfg) {
      const horizon = Math.max(1, cfg.horizonYears || cfg.years || 5);
      const year1 = cfg.year1 || (new Date()).getFullYear();
      // Compute totalGainBucket so we can surface it as unrecognizedGain
      // — the gain conservation invariant (sumRecognized + unrecognized
      // === totalGainBucket) holds even on the no-engagement path.
      // Without this, downstream sanity checks see a $0 = $X mismatch.
      const _ltGain = Math.max(0,
            (cfg && cfg.salePrice || 0) - (cfg && cfg.costBasis || 0)
            - (cfg && cfg.acceleratedDepreciation || 0));
      const _recap = Math.max(0, cfg && cfg.acceleratedDepreciation || 0);
      // Conservation invariant: sumRecognized + unrecognizedGain === totalLT.
      // Recapture is recognized in Y1 separately (§453(i)) and is NOT in
      // the LT bucket — keep it out of unrecognizedGain so the invariant
      // matches the main engine's convention. F14 fix.
      const _totalGainBucket = _ltGain;
      const rows = [];
      for (let i = 0; i < horizon; i++) {
            const year = year1 + i;
            // Y1 baseline still includes the sale's LT gain and recapture
            // (no-engagement means no Brooklyn, NOT no sale). Subsequent
            // years are quiet — no further sale-side activity.
            const baseline = _baseScenarioForYear(
                  cfg, year,
                  i === 0 ? _ltGain : 0,
                  i === 0 ? _recap : 0
            );
            const baselineTax = _yearTaxes(baseline);
            rows.push({
                  year: year,
                  gainRecognized: 0,
                  lossGenerated: 0,
                  lossApplied: 0,
                  stCarryForward: 0,
                  investmentThisYear: 0,
                  fee: 0,
                  brookhavenFee: 0,
                  brookhavenSetupFee: 0,
                  brookhavenQuarterlyFee: 0,
                  baseline: baselineTax,
                  withStrategy: baselineTax,
                  savings: 0
            });
      }
      // Build totals from rows. Without these, the engine returned
      // undefined for totalBaseline / totalWithStrategy and downstream
      // consumers got NaN propagation — F14 surfaced this in 0.09% of
      // 10K Monte Carlo trials.
      let _totalBaseline = 0, _totalWith = 0;
      rows.forEach(function (r) {
            _totalBaseline += (r.baseline && r.baseline.total) || 0;
            _totalWith     += (r.withStrategy && r.withStrategy.total) || 0;
      });
      return {
            deferred: true,
            rows: rows,
            recognitionSchedule: rows.map(function (r) { return { year: r.year, gainRecognized: 0 }; }),
            unrecognizedGain: _totalGainBucket,
            totalBaseline: _totalBaseline,
            totalWithStrategy: _totalWith,
            totalSavings: 0,
            totalFees: 0,
            totalBrookhavenFees: 0,
            totalAllFees: 0,
            durationYears: 0
      };
}

// Maturity-year index for the structured-sale product. The product term
// (cfg.structuredSaleDurationMonths) starts ticking on the sale date.
//
// Behavior:
//   1. If cfg.maxRecognitionYearIndex is set (used by the "delay close
//      to Jan 1 next year" scenario), use it directly — that scenario
//      has no insurance-product term to honor.
//   2. Otherwise apply a hard 36-month floor (regulatory minimum for
//      structured-sale products as of 2026-05-08 per MetLife's 3-year
//      approval — was 48mo since 2026-05-07, was 18 historically),
//      then auto-extend the maturity to land on the next Jan 1: payouts
//      happen on Jan 1, so a mid-year maturity wastes the months
//      between the natural maturity and the next Jan 1. E.g. May 2026
//      sale with 36-month duration → natural maturity May 2029 → bump
//      to Jan 1 2030 (effectively a 44-month term) so the last legal
//      Jan 1 payout is reachable inside the product term.
//   3. Falls back to horizon-1 when duration isn't supplied or the
//      implementation date is missing.
function _structuredSaleMaturityYearIdx(cfg, horizon) {
      // Explicit override — the "delay close to Jan 1 next year"
      // scenario passes this to bypass the structured-sale product
      // math entirely (no insurance product, just a contractual
      // close on Jan 1).
      if (cfg && cfg.maxRecognitionYearIndex != null) {
            return Math.max(0, Math.min(horizon - 1, Number(cfg.maxRecognitionYearIndex) | 0));
      }
      const monthsRaw = Number(cfg && cfg.structuredSaleDurationMonths);
      if (!Number.isFinite(monthsRaw) || monthsRaw <= 0) return horizon - 1;
      // 36-month minimum is the regulatory floor for a Brooklyn
      // structured-sale product per MetLife's 2026-05-08 approval
      // (3 years of yearly Jan-1 payments). Anything shorter is
      // clamped up.
      const months = Math.max(36, monthsRaw);
      let saleYear, saleMonth0;
      const implDate = cfg && cfg.implementationDate;
      if (implDate && typeof window !== 'undefined' && typeof window.parseLocalDate === 'function') {
            const d = window.parseLocalDate(implDate);
            if (d && !isNaN(d.getTime())) {
                  saleYear = d.getFullYear();
                  saleMonth0 = d.getMonth();
            }
      }
      if (saleYear == null) {
            saleYear = (cfg && cfg.year1) || (new Date()).getFullYear();
            saleMonth0 = 0;
      }
      const totalMonths = saleMonth0 + months;
      const matMonth0 = totalMonths % 12;
      let matYear = saleYear + Math.floor(totalMonths / 12);
      // Auto-extend to next Jan 1 if natural maturity falls mid-year:
      // the last legal payout is the Jan 1 of the *following* year.
      if (matMonth0 > 0) matYear += 1;
      const year1 = (cfg && cfg.year1) || saleYear;
      const idx = matYear - year1;
      return Math.max(0, Math.min(horizon - 1, idx));
}

// Marginal tax rate the recognized LT gain attracts, used by the
// "cover taxes from sale" carve-out. Rate = (tax with full LT lump-sum
// in Y1 minus tax without it) / LT gain. Computed once at engine entry
// — using the lump-sum rate gives a slight conservative over-reserve
// per chunk (vs. computing the marginal rate on each smaller annual
// slice), which matches the user's intent: ensure the client never
// ends up cash-short for an April due date.
function _estimateGainTaxRate(cfg) {
      if (!cfg) return 0;
      const totalLT = Math.max(0,
            (cfg.salePrice || 0) - (cfg.costBasis || 0)
            - (cfg.acceleratedDepreciation || 0));
      if (totalLT <= 0) return 0;
      const yr = (cfg.year1 != null) ? Number(cfg.year1) : (new Date()).getFullYear();
      const sWith    = _baseScenarioForYear(cfg, yr, totalLT);
      const sWithout = _baseScenarioForYear(cfg, yr, 0);
      const taxWith    = _yearTaxes(sWith).total;
      const taxWithout = _yearTaxes(sWithout).total;
      const rate = (taxWith - taxWithout) / totalLT;
      return Math.max(0, Math.min(0.5, rate));
}


// ============================================================
// UNIFIED ENGINE — supersedes computeTaxComparison + computeDeferredTaxComparison
// ============================================================
//
// Both legacy engines walk the same per-year structure:
//   1. Compute existing-tranche loss + fee at this year's age.
//   2. Decide how much LT gain to recognize this year.
//   3. (Deferred only) Carve estimated tax + push reinvest tranche.
//   4. Apply losses against (this year's gain + recapture-Y1) per §1(h).
//   5. Carry residual loss forward.
//   6. Emit row.
//
// The differences collapse to three mode-dependent inputs:
//
//   • Initial tranches.
//       immediate: one tranche of cfg.investedCapital at Y1 (the user
//                  has already deposited the full Available Capital;
//                  basis vs. proceeds aren't separated because the sale
//                  closes Y1 and proceeds arrive together).
//       deferred:  one tranche of basisCash at Y1; gain proceeds arrive
//                  in recognition years and get reinvested as new
//                  tranches up to a budget cap.
//
//   • Reinvestment budget.
//       immediate: 0 (no further deposits).
//       deferred:  availableCapital − basisCash (the "keep proceeds"
//                  cap, honored across the full horizon).
//
//   • Recognition window.
//       immediate: startIdx=0, maturityIdx=0 (force ALL gain Y1; any
//                  un-absorbed remainder is just taxed at LTCG rates).
//       deferred:  startIdx≥1, maturityIdx from structured-sale product
//                  term (15-month minimum, auto-extend to next Jan 1).
//
// Output shape matches computeDeferredTaxComparison verbatim. In
// immediate mode, doNothingBaseline === baseline (gain timing matches
// the lump-sum), and the deferred-only fields (taxCarveOut,
// reinvestedThisYear, investmentThisYear) are present but typically 0.
//
// Y1 loss capacity used to come from the recommendation argument
// (recommendation.lossGenerated) in the legacy immediate path. The
// unified engine doesn't need it — Y1 loss is just
// tranches[0].capital × lossRateForTrancheYear(0), which derives from
// the same data via _buildLossRateByAge.
//
// Optional second arg:
//   opts.y1LossOverride — replaces the Y1 Brooklyn loss derived from
//     tranches with a caller-supplied value. Only honored in immediate
//     mode (recognitionStartYearIndex === 0) and only when not below-
//     min. Used by optimizeStructuredSale's _scoreSchedule to inject
//     each candidate's per-schedule Y1 loss capacity for scoring —
//     mirrors the legacy engine's behavior of reading
//     recommendation.schedule[0].lossGenerated when called with a
//     multi-year recommendation. (The legacy used Y2+ losses derived
//     from cfg, not the candidate's lossByYear[1+], so the override
//     surface is intentionally Y1-only — same scoring fidelity, no
//     extra API surface.)
function unifiedTaxComparison(cfg, opts) {
      cfg = cfg || {};
      opts = opts || {};
      const isDeferred = ((cfg.recognitionStartYearIndex || 0) >= 1);
      const _y1LossOverride = (!isDeferred && typeof opts.y1LossOverride === 'number')
            ? Math.max(0, opts.y1LossOverride)
            : null;

      // Below-min lifecycle check — shared with both legacy engines.
      // Immediate mode: dashboard renders "no engagement" via the
      // _noEngagement zero-out at the bottom; deferred returns the
      // pre-built zero shape. Pick the right one for output parity.
      const _belowMin = _belowMinForLifecycle(cfg);
      if (_belowMin && isDeferred) return _zeroDeferredComparison(cfg);

      const horizon = Math.max(1, cfg.horizonYears || cfg.years || 5);
      const _y0 = (cfg.year1 != null) ? Number(cfg.year1) : (new Date()).getFullYear();
      const yfImpl = (typeof yearFractionRemaining === 'function')
            ? yearFractionRemaining((typeof cfgStrategyDate === 'function' ? cfgStrategyDate(cfg) : (cfg.strategyImplementationDate || cfg.implementationDate)))
            : 1;
      const ordCap = (cfg.filingStatus === 'mfs' || cfg.filingStatus === 'married_separate') ? 1500 : 3000;

      // Property-side gain split. STG is now an independent income
      // source (not carved from the sale), so totalLT is just the
      // long-term portion of the property sale. Q2: subtract
      // shortTermPropertyGain so properties the user flagged as
      // short-term-held don't fall into the LT bucket.
      const totalLT   = Math.max(0,
            (cfg.salePrice || 0) - (cfg.costBasis || 0) - (cfg.acceleratedDepreciation || 0) - (cfg.shortTermPropertyGain || 0));
      const recapture = Math.max(0, cfg.acceleratedDepreciation || 0);
      const totalGainBucket = totalLT;

      // No-action short-circuit (deferred only). Immediate mode has no
      // analog — even with totalLT=0 and investment=0, the immediate
      // engine emits horizon rows of zero baseline tax, which the
      // dashboard renders as "no engagement." Match that behavior.
      if (isDeferred) {
            const _hasInvestment = Number(cfg.investment || cfg.investedCapital || 0) > 0;
            if (totalGainBucket <= 0 && !_hasInvestment) return _zeroDeferredComparison(cfg);
      }

      // Tranche setup + reinvest budget. The user-visible "Available
      // Capital" field on Page 1 is cfg.investment; investedCapital
      // is its rettFlavorEngineCfg-aliased twin.
      const _availTotal = (cfg.investment != null) ? Math.max(0, Number(cfg.investment))
                       : (cfg.investedCapital != null ? Math.max(0, Number(cfg.investedCapital)) : 0);
      const _basisFull  = Math.max(0, cfg.costBasis || 0);
      // Strategy C model (advisor 2026-05-26):
      //   The seller can park UP TO totalLT inside the MetLife product
      //   - cost basis and depreciation recapture CANNOT be parked
      //   (basis is principal recovery; recap is §1250 ordinary at Y1).
      //   The seller can choose to park LESS than totalLT, taking the
      //   remainder as Y1 LT closing cash. Example: $900K basis + $3M
      //   gain + $1M availableCapital -> park $2.9M in product, $100K
      //   of gain comes out as closing cash + $900K basis = $1M Y1
      //   Brooklyn deployment.
      //
      //   Optimal strategy: minimize parkedGain so Y1 Brooklyn deploys
      //   as much availableCapital as possible, since Y1 has the
      //   highest loss rate (year-0 tranches) and absorbs both the
      //   recapture (ordinary) and the unparked gain (LT) immediately.
      //
      //   Prior model: basisCash = min(basis, avail), gain auto-parked
      //   100% - which left Y1 Brooklyn at $0 for low-basis sales and
      //   force-recognized everything at maturity with no offset.
      // Tier-jumping combo list MUST be set up before the tranche
      // creation below, because the Y1 tranche tags itself with the
      // combo its cumulative deposit qualifies for. Schwab-combo cfgs
      // only - non-Schwab cfgs leave _tieringCombos empty and the
      // tranche-tag falls back to null (engine uses the legacy curve).
      const combo = (cfg.comboId && typeof getSchwabCombo === 'function')
            ? getSchwabCombo(cfg.comboId) : null;
      var _tieringCombos = (function () {
            if (!combo || typeof listSchwabCombosForStrategy !== 'function') return [];
            var stratKey = combo.strategyKey;
            var userCap = combo.leverage;
            var all = listSchwabCombosForStrategy(stratKey) || [];
            return all
                  .filter(function (c) { return c && c.leverage <= userCap + 1e-6; })
                  .sort(function (a, b) { return a.minInvestment - b.minInvestment; });
      })();
      function _pickComboForCumulative(cumulative) {
            if (!_tieringCombos.length) return combo;
            var picked = _tieringCombos[0];
            for (var k = 0; k < _tieringCombos.length; k++) {
                  if (cumulative + 0.01 >= _tieringCombos[k].minInvestment) picked = _tieringCombos[k];
            }
            return picked;
      }

      // Installment-sale mode (Strategy B, §453). Set via
      // cfg.installmentPayments = N (1, 2, or 3). When active, the
      // engine:
      //   - Does NOT deploy a Y0 Brooklyn tranche (no closing-day cash;
      //     buyer pays in installments starting Y1 Jan 1).
      //   - Recognizes totalLT / N as LT gain each year for N years
      //     starting at Y1. Equivalent to applying the §453 gross-profit
      //     ratio to N equal payments of (salePrice - acceleratedDepr) / N.
      //   - Creates a Brooklyn tranche each payment year sized to the
      //     installment payment (basis + gain combined), capped by
      //     remaining availableCapital.
      //   - Recapture stays as Y0 ordinary income per §453(i).
      //   - Bypasses unparked-Y1-gain logic and MetLife schedule caps;
      //     those are Strategy C concerns.
      const _installmentPayments = (cfg.installmentPayments | 0) || 0;
      const _isInstallment = isDeferred && _installmentPayments >= 1;

      let basisCash, _unparkedY1Gain, _parkedGain;
      if (_isInstallment) {
            basisCash = 0;
            _unparkedY1Gain = 0;
            _parkedGain = 0;
      } else if (isDeferred) {
            const _basisAndRecap = _basisFull + Math.max(0, recapture);
            const _maxUnparkable = Math.max(0, _availTotal - _basisAndRecap);
            // parkRatio (0..1) controls how much of totalLT to leave inside
            // the MetLife product vs unpark as Y0 closing cash. The auto-
            // picker (_autoPickSection in projection-dashboard-render.js)
            // sweeps parkRatio for Strategy C and picks the value that
            // maximizes net benefit. When unset, fall back to legacy greedy
            // behavior (unpark as much as availableCapital allows) so any
            // direct caller of the engine that doesn't set parkRatio gets
            // the previous semantics.
            //
            // Why this exists: hardcoded greedy was optimal for early-year
            // sales (Y0 tranches absorb at near-full year-1 loss rate), but
            // wrong for late-year sales (Y0 yfImpl multiplier collapses the
            // loss rate to ~5% of full in December). Engine-time math is
            // identical to before when parkRatio=0; the difference is that
            // parkRatio=1.0 now correctly parks all gain so Y1+ tranches
            // (full-year rates) absorb the recognition stream.
            var _parkRatio = (cfg.parkRatio != null && Number.isFinite(Number(cfg.parkRatio)))
                  ? Math.max(0, Math.min(1, Number(cfg.parkRatio)))
                  : null;
            if (_parkRatio === null) {
                  _unparkedY1Gain = Math.min(totalLT, _maxUnparkable);
            } else {
                  var _desiredUnparked = totalLT * (1 - _parkRatio);
                  _unparkedY1Gain = Math.min(_desiredUnparked, _maxUnparkable, totalLT);
            }
            _parkedGain = Math.max(0, totalLT - _unparkedY1Gain);
            basisCash = Math.min(_availTotal, _basisAndRecap + _unparkedY1Gain);
      } else {
            basisCash = _availTotal;
            _unparkedY1Gain = 0;
            _parkedGain = 0;
      }

      // Installment-mode per-payment amount = (salePrice - accelDepr) / N.
      // The recap portion (accelDepr) is excluded from the contract price
      // for LT-gain GP-ratio purposes because §453(i) fully recognizes it
      // at Y0 separately.
      const _installmentPayment = _isInstallment
            ? Math.max(0, ((cfg.salePrice || 0) - Math.max(0, recapture)) / _installmentPayments)
            : 0;
      // Cover-taxes-from-sale Y0-only tranche (advisor 2026-05-26):
      // when the user toggles "cover taxes from sale", the tax-reserve
      // money deploys to Brooklyn at Y0 alongside the rest of the sale
      // proceeds. April 1 of Y1 (right before April 15 taxes are due)
      // the reserve gets pulled out to pay taxes - modeled here as a
      // Y0-only tranche (maxAgeInclusive: 0) so it generates Y0 loss +
      // fees but contributes nothing in Y1+.
      //
      // Tax-reserve estimate: Y0-recognized LT gain + recapture, taxed
      // at the engine's LT marginal estimate. Slight underestimate of
      // recap (taxed at ordinary, not LT) but acceptable approximation -
      // the alternative would be a circular dependency (tax depends on
      // tranches, tranches depend on tax).
      //
      // Skipped in installment mode (Strategy B has no Y0 Brooklyn
      // tranche to split).
      var _taxReserveY0 = 0;
      if (cfg.coverTaxesFromSale && !_isInstallment && basisCash > 0) {
            var _y0RecognizedLT = isDeferred ? _unparkedY1Gain : totalLT;
            var _y0TaxableEstimate = _y0RecognizedLT + Math.max(0, recapture);
            var _y0EstimatedRate = (typeof _estimateGainTaxRate === 'function')
                  ? _estimateGainTaxRate(cfg) : 0.25;
            _taxReserveY0 = Math.min(basisCash, _y0TaxableEstimate * _y0EstimatedRate);
      }
      var _permanentBasis = Math.max(0, basisCash - _taxReserveY0);

      const tranches = [];
      // Tier-jumping decision is made on TOTAL Y0 deployment (basisCash)
      // since both tranches are physically deployed at the same time -
      // cumulative deposit for tier purposes is the sum.
      // Strategy C degeneracy detection (advisor 2026-05-26): when the
      // deferred path's parkedGain is 0 (because availableCapital fully
      // covers basis + recap + totalLT), Strategy C effectively becomes
      // Strategy A - all gain recognized at Y0 via the unparkedY1 path,
      // structured product holds nothing. Brooklyn's position serves no
      // purpose after Y0. Cap the basis tranche at maxAgeInclusive=0 so
      // Brooklyn fees stop after Y0 (matches reality - the seller would
      // close the position). Brookhaven schedule is also truncated below.
      var _y0OnlyDegeneracy = isDeferred && !_isInstallment && _parkedGain <= 0.01 && _unparkedY1Gain > 0;
      // Brookhaven smoothing (advisor 2026-05-27): the strict
      // degeneracy gate above created a fee cliff - at parkRatio
      // exactly 0, Brookhaven = Y0 only; at parkRatio 0.001, Brookhaven
      // jumped to 4 years of fees against a token parked balance. That
      // produced a non-monotonic auto-pick across sale dates (40% gain
      // row flipped A->B->C->B as the parkRatio optimum crossed 0/>0).
      // Smooth it: when parkedGain is small relative to totalLT, scale
      // Brookhaven Y1+ proportionally - full fees only when at least
      // 5% of the gain is actually parked. Eliminates the cliff while
      // preserving the original "no park = no Y1+ fees" intent.
      var _parkedShare = (totalLT > 0) ? Math.max(0, Math.min(1, _parkedGain / totalLT)) : 0;
      var _brookhavenY1PlusScale = Math.max(0, Math.min(1, _parkedShare / 0.05));
      var _y0Combo = (basisCash > 0) ? _pickComboForCumulative(basisCash) : null;
      function _y0TrancheTemplate(cap, isTaxReserve) {
            var t = {
                  capital: cap,
                  startIdx: 0,
                  comboId: _y0Combo ? _y0Combo.id : null,
                  comboLossByYear: _y0Combo && _y0Combo.lossByYear ? _y0Combo.lossByYear.slice() : null,
                  comboFeeRate: _y0Combo ? _y0Combo.feeRate : null
            };
            // Tax-reserve tranche is always Y0-only. The permanent basis
            // tranche also closes after Y0 when the no-park degeneracy
            // fires (no future recognition activity to support).
            if (isTaxReserve || (!isTaxReserve && _y0OnlyDegeneracy)) {
                  t.maxAgeInclusive = 0;
            }
            return t;
      }
      if (_permanentBasis > 0) tranches.push(_y0TrancheTemplate(_permanentBasis, false));
      if (_taxReserveY0  > 0) tranches.push(_y0TrancheTemplate(_taxReserveY0,  true));
      // Reinvest budget = remaining "keep proceeds" room for redeploying
      // installment payouts as they arrive. Immediate mode always 0
      // (availableCapital is fully deployed at Y1). Deferred mode: any
      // availableCapital not consumed by the Y1 tranche.
      let _remainingReinvestCap = isDeferred
            ? Math.max(0, _availTotal - basisCash)
            : 0;

      // Recognition window. Immediate forces Y1-only; deferred starts
      // recognition at the next Jan 1 after the sale (year1+1) and
      // takes exactly (durationMonths / 12) yearly Jan-1 payments.
      // Per advisor 2026-05-18: the prior "15-month hold + sale-date
      // anchored auto-extend" was not a MetLife product rule. Removed
      // entirely — first installment is always the Jan 1 immediately
      // following close, regardless of sale month.
      let startIdx, maturityIdx;
      if (_isInstallment) {
            // Installment-sale spans exactly N years starting Y1. Engine
            // recognizes totalLT/N at each year - see recognition loop.
            const startIdxRaw = Math.max(1, Math.min(horizon - 1,
                  (cfg.recognitionStartYearIndex != null ? cfg.recognitionStartYearIndex : 1)));
            startIdx    = startIdxRaw;
            maturityIdx = Math.min(horizon - 1, startIdxRaw + _installmentPayments - 1);
      } else if (isDeferred) {
            const startIdxRaw = Math.max(1, Math.min(horizon - 1,
                  (cfg.recognitionStartYearIndex != null ? cfg.recognitionStartYearIndex : 1)));
            const durationMonths = Number(cfg.structuredSaleDurationMonths) || 0;
            const hasMaxOverride = (cfg.maxRecognitionYearIndex != null);
            if (!hasMaxOverride && durationMonths > 0) {
                  // Strategy C: exactly N yearly Jan-1 payments starting at
                  // year1 + startIdx. 36mo → 3 payments, 48mo → 4, etc.
                  const durYears = Math.max(1, Math.round(durationMonths / 12));
                  startIdx    = startIdxRaw;
                  maturityIdx = Math.min(horizon - 1, startIdxRaw + durYears - 1);
            } else {
                  // Strategy B (maxRecognitionYearIndex pinned) or other
                  // legacy callers: honor the explicit maturity index.
                  const matIdxRaw = _structuredSaleMaturityYearIdx(cfg, horizon);
                  startIdx    = Math.min(startIdxRaw, Math.max(1, matIdxRaw));
                  maturityIdx = Math.max(startIdx, matIdxRaw);
            }
      } else {
            startIdx = 0;
            maturityIdx = 0;
      }

      // Loss-rate function — shared baseline used when tier-jumping
      // is unavailable (non-Schwab cfgs or saved cases without comboId).
      // Schwab-combo cfgs override per-tranche below via _trancheLossRate.
      const lossRateForTrancheYear = _buildLossRateByAge(cfg, yfImpl) || function () { return 0; };

      // Fee rate — unified regression first, then combo-direct, then
      // tier interpolation, then 0. Mirrors the deferred-path's
      // fallback chain (already established as the source of truth).
      // Note: `combo` was hoisted above the tranche-setup block to
      // support tier-jumping (which tags each tranche with its combo
      // at creation time).
      const feeRate = (function () {
            var lp, sp;
            if (combo) { lp = combo.longPct; sp = combo.shortPct; }
            else if (typeof window.brooklynPctsForLeverage === 'function') {
                  var p = window.brooklynPctsForLeverage(cfg.tierKey || 'beta1', _defaultLeverage(cfg));
                  if (p) { lp = p.longPct; sp = p.shortPct; }
            }
            if (typeof window.brooklynFeeRateFor === 'function' && lp != null && sp != null) {
                  return window.brooklynFeeRateFor(lp, sp);
            }
            if (combo) return combo.feeRate || 0;
            if (typeof brooklynInterpolate === 'function') {
                  var snap = brooklynInterpolate(cfg.tierKey || 'beta1', _defaultLeverage(cfg));
                  return snap ? (snap.feeRate || 0) : 0;
            }
            return 0;
      })();

      // Per-tranche loss rate. When tier-jumping is active (Schwab combo
      // cfg) we read the tranche's combo.lossByYear; otherwise we fall
      // back to the cfg-wide curve (unchanged legacy behavior).
      //
      // Tier-jumping rationale (advisor 2026-05-26): each tranche uses
      // the highest-leverage Schwab combo whose minInvestment <=
      // cumulative deposit AT THE TIME the tranche opens, capped at the
      // user-selected combo's leverage. So a $1.5M Y1 deposit -> 145/45
      // (min $1M, 200/100's $3M not yet met). A $1.5M reinvest tranche
      // at Y2 -> cumulative now $3M -> 200/100 (its 0.59 Y1 loss rate
      // applies to THIS tranche at trancheAge=0). Capped-at-user-
      // selection means: if the user picked 145/45, engine never jumps
      // to 200/100. Setup for _tieringCombos / _pickComboForCumulative
      // is at the top of unifiedTaxComparison (hoisted to be ready by
      // the time the Y1 tranche is created).
      function _trancheLossRate(t, age) {
            if (_tieringCombos.length && t && t.comboLossByYear && t.comboLossByYear.length) {
                  var arr = t.comboLossByYear;
                  var safeAge = Math.max(0, age | 0);
                  var lastIdx = arr.length - 1;
                  var yfForThis = (t.startIdx === 0 && safeAge === 0) ? yfImpl : 1;
                  if (safeAge === 0) return (arr[0] || 0) * yfForThis;
                  var prev = arr[Math.min(safeAge - 1, lastIdx)] || 0;
                  var curr = arr[Math.min(safeAge, lastIdx)] || 0;
                  return (1 - yfForThis) * prev + yfForThis * curr;
            }
            return lossRateForTrancheYear(age);
      }

      // Per-tranche fee rate. With tier-jumping, each tranche pays its
      // own combo's feeRate; without, all tranches share the cfg-wide
      // feeRate computed above.
      function _trancheFeeRate(t) {
            if (_tieringCombos.length && t && typeof t.comboFeeRate === 'number') {
                  return t.comboFeeRate;
            }
            return feeRate;
      }

      // Per-tranche tax carve-out for "cover taxes from sale" toggle
      // (deferred only). Rate held constant across the recognition
      // window — see _estimateGainTaxRate.
      const _gainTaxRate = (isDeferred && cfg.coverTaxesFromSale) ? _estimateGainTaxRate(cfg) : 0;
      const _reinvestFrac = 1 - _gainTaxRate;

      // Brookhaven advisory wrap — same schedule for both modes
      // (anchors on yfImpl). Skipped on the immediate-mode below-min
      // soft-fail (the legacy immediate path does this via _noEngagement
      // zero-out below; we add the same gate at output time so we don't
      // emit fees we'll just zero anyway).
      // Brookhaven fee schedule. When the Y0-only degeneracy fires
      // (Strategy C w/ parkedGain=0 - all gain absorbed at Y0), the
      // Brookhaven planning fee should also stop after Y0; otherwise
      // the advisor charges for a multi-year wrap that never happens.
      // Match the engine's basis-tranche maxAgeInclusive=0 behavior by
      // zeroing the schedule past index 0.
      const brookhavenSchedule = (typeof brookhavenFeeSchedule === 'function' && !_belowMin)
            ? (function () {
                  var sched = brookhavenFeeSchedule(horizon, yfImpl);
                  // Schedule shape: { perYear: [{setup, quarterly, total}], total }.
                  // For the Y0-only degeneracy, zero perYear[i].total for i>=1
                  // so downstream row reads (line 1210: bh.total) see 0.
                  if (_y0OnlyDegeneracy && sched && sched.perYear && sched.perYear.length > 1) {
                        var trimmedTotal = 0;
                        for (var bi = 0; bi < sched.perYear.length; bi++) {
                              if (bi >= 1) {
                                    sched.perYear[bi] = { setup: 0, quarterly: 0, total: 0 };
                              }
                              trimmedTotal += sched.perYear[bi].total;
                        }
                        sched.total = trimmedTotal;
                  } else if (isDeferred && !_isInstallment && !_y0OnlyDegeneracy &&
                             _brookhavenY1PlusScale < 1 && sched && sched.perYear && sched.perYear.length > 1) {
                        // Smoothing path: parkedGain > 0 but small. Scale
                        // Brookhaven Y1+ by parkedShare/0.05. Setup fee
                        // (engagement open) and Y0 quarterly stay full;
                        // Y1+ quarterly+setup scaled.
                        var scaledTotal = 0;
                        for (var bj = 0; bj < sched.perYear.length; bj++) {
                              if (bj >= 1) {
                                    sched.perYear[bj] = {
                                          setup: sched.perYear[bj].setup * _brookhavenY1PlusScale,
                                          quarterly: sched.perYear[bj].quarterly * _brookhavenY1PlusScale,
                                          total: sched.perYear[bj].total * _brookhavenY1PlusScale
                                    };
                              }
                              scaledTotal += sched.perYear[bj].total;
                        }
                        sched.total = scaledTotal;
                  }
                  return sched;
            })()
            : null;

      let stCF = 0;
      let gainRemaining = totalGainBucket;
      const rows = [];
      const recognitionSchedule = [];

      for (let i = 0; i < horizon; i++) {
            const year = _y0 + i;

            // Step 1 — existing tranches' loss + fee at this year's age.
            // Basis tranche (startIdx=0) gets partial-year fee in Y1.
            // Gain-reinvest tranches always open Jan 1 of their start
            // year, so they get full-year fees from that year on.
            //
            // Below-min lifecycle: when the position can't legally open
            // (cumulative deposit < custodian min over the horizon),
            // Brooklyn doesn't operate at all. Zero out per-tranche loss
            // and fee. The legacy immediate engine does this via
            // `if (_belowMin) lossThisYear = 0`; legacy deferred returns
            // _zeroDeferredComparison wholesale (handled at function
            // entry above for isDeferred). Without this gate, immediate-
            // mode below-min cfgs (e.g., $1.5M sale into a Schwab combo
            // with $3M min) would emit non-zero Brooklyn loss the user-
            // facing dashboard correctly zeroes via ProjectionEngine —
            // a real engine/UI inconsistency exposed during live UI
            // soak testing.
            let existingLoss = 0;
            let existingFee = 0;
            let existingInvested = 0;
            // Per-tranche breakdown (opt-in via opts.includeTrancheBreakdown).
            // CPA-facing admin reveal needs to see each tranche's per-year
            // contribution to loss + fees - reconstructing externally would
            // duplicate engine logic and drift. Push records into trancheRows
            // when the flag is set; otherwise leave undefined (no perf hit
            // on the normal path).
            const _includeTrancheBreakdown = !!opts.includeTrancheBreakdown;
            const trancheRows = _includeTrancheBreakdown ? [] : null;
            if (!_belowMin) {
                  tranches.forEach(function (t, tIdx) {
                        const trancheAge = i - t.startIdx;
                        if (trancheAge < 0) return;
                        // Tax-reserve Y0-only tranche (cover-taxes-from-sale):
                        // capital withdrew April 1 of Y1 to pay taxes, so it
                        // contributes nothing once trancheAge exceeds the
                        // maxAgeInclusive cap. Other tranches don't set
                        // this field and contribute their full lifecycle.
                        if (typeof t.maxAgeInclusive === 'number' && trancheAge > t.maxAgeInclusive) return;
                        // Per-tranche loss rate honors tier-jumping when a
                        // Schwab combo cfg is present; falls back to the
                        // single legacy curve otherwise.
                        const _trancheLossRateV = _trancheLossRate(t, trancheAge);
                        const _trancheFeeRateV = _trancheFeeRate(t);
                        const _trancheYf = (t.startIdx === 0 && trancheAge === 0) ? yfImpl : 1;
                        const _tLoss = t.capital * _trancheLossRateV;
                        const _tFee = t.capital * _trancheFeeRateV * _trancheYf;
                        existingLoss += _tLoss;
                        existingFee += _tFee;
                        existingInvested += t.capital;
                        if (trancheRows) {
                              trancheRows.push({
                                    trancheIdx: tIdx,
                                    openYear: _y0 + t.startIdx,
                                    capital: t.capital,
                                    age: trancheAge,
                                    comboId: t.comboId || null,
                                    lossRate: _trancheLossRateV,
                                    feeRate: _trancheFeeRateV,
                                    yf: _trancheYf,
                                    loss: _tLoss,
                                    fee: _tFee,
                                    isTaxReserve: typeof t.maxAgeInclusive === 'number' && t.maxAgeInclusive === 0 && t.startIdx === 0 && tIdx > 0
                              });
                        }
                  });
                  // Y1 loss override (immediate mode, not below-min): replace
                  // the tranche-derived Y1 loss with the caller-supplied
                  // value. See doc on opts.y1LossOverride above. Fees and
                  // existingInvested keep their tranche-derived values
                  // because the optimizer computes its own per-candidate
                  // fees externally — only the tax-impact of the loss
                  // amount is what _scoreSchedule needs from the engine.
                  if (i === 0 && _y1LossOverride !== null) {
                        existingLoss = _y1LossOverride;
                  }
            }

            // Step 2 — decide gain to recognize this year.
            // Immediate mode (startIdx=0, maturityIdx=0): force ALL
            // remaining gain at i=0, then nothing thereafter. Even if
            // existingLoss < gainRemaining, the unabsorbed portion is
            // recognized — the immediate path's whole point is "lump
            // sum at sale; whatever Brooklyn doesn't absorb is taxed."
            // Deferred mode: greedy up to maxAbsorbable, force remainder
            // at maturity year.
            //
            // METLIFE_RULES (see top of file): when this is a true
            // structured-sale path (duration set + no max-rec override),
            // also enforce the carrier's payment-schedule caps:
            //   • first recognition year ≤ 50% of total gain
            //   • reserve ≥ 20% for the last (maturity) year
            // Inside the absorption math: greedy still tries to take
            // maxAbsorbable, but is clamped down by these caps.
            const year1Rate = lossRateForTrancheYear(0);
            const effYear1Rate = year1Rate * _reinvestFrac;
            const denom = Math.max(0.001, 1 - effYear1Rate);
            const _recapDrag = (i === 0) ? recapture : 0;
            const _isMetLifeConstrained = isDeferred
                  && Number(cfg && cfg.structuredSaleDurationMonths) > 0
                  && (cfg && cfg.maxRecognitionYearIndex == null);
            // Term-specific rules: 36mo (3-yr) → 40/20, 48mo+ (4-yr+) → 50/10.
            const _metlifeRules = _isMetLifeConstrained
                  ? _metlifeRulesForTerm(cfg.structuredSaleDurationMonths)
                  : null;
            let gainRecThisYear = 0;
            // Installment-sale recognition (Strategy B, §453). Each year
            // in [startIdx, maturityIdx] recognizes totalLT/N as LT
            // gain - equivalent to applying the gross-profit ratio
            // (totalLT / (salePrice - accelDepr)) to N equal payments of
            // (salePrice - accelDepr) / N. Brooklyn's loss capacity
            // doesn't gate recognition here (unlike Strategy C, where
            // recognition is capped by absorbable); whatever Brooklyn
            // doesn't absorb is just taxed at LT rates.
            if (_isInstallment && i >= startIdx && i <= maturityIdx) {
                  var _installmentGainThisYear = totalLT / _installmentPayments;
                  gainRecThisYear += _installmentGainThisYear;
                  gainRemaining   -= _installmentGainThisYear;
            }
            // Unparked-gain Y1 recognition (Strategy C only). The
            // portion of total LT gain the seller chose NOT to park in
            // the MetLife product comes out as Y1 closing cash and is
            // taxed as Y1 LT. The structured-sale schedule below only
            // covers the parked portion.
            if (i === 0 && isDeferred && !_isInstallment && _unparkedY1Gain > 0) {
                  gainRecThisYear += _unparkedY1Gain;
                  gainRemaining   -= _unparkedY1Gain;
            }
            if (!_isInstallment && i >= startIdx && i <= maturityIdx && gainRemaining > 0) {
                  const maxAbsorbable = Math.max(0, (stCF + existingLoss - _recapDrag) / denom);
                  let cap = Math.min(gainRemaining, maxAbsorbable);
                  if (_metlifeRules) {
                        // METLIFE caps apply to the PARKED portion only -
                        // the unparked Y1 gain is closing cash, not part
                        // of the insurance product's payment schedule.
                        // For immediate-mode safety, _parkedGain defaults
                        // to 0 there and these branches are bypassed
                        // (deferred-only via _isMetLifeConstrained gate).
                        const _metlifeBase = _parkedGain;
                        // First-payment cap (term-specific):
                        //   3-yr: 40%, 4-yr+: 50%
                        if (i === startIdx) {
                              const firstCap = _metlifeBase * _metlifeRules.firstPaymentMaxPct;
                              cap = Math.min(cap, firstCap);
                        }
                        // First-two-payments combined cap (universal: 80%).
                        // gainRemaining at this point reflects parked-only
                        // (unparked Y1 was already subtracted above), so
                        // cumulative-parked-recognized = _parkedGain -
                        // gainRemaining. Y2 can take at most
                        // (80% × _parkedGain) - cumulativeRecognized.
                        if (i === startIdx + 1) {
                              const combinedCap = _metlifeBase * _metlifeRules.firstTwoPaymentsMaxPct;
                              const cumulativeRecognized = _parkedGain - gainRemaining;
                              const maxY2 = Math.max(0, combinedCap - cumulativeRecognized);
                              cap = Math.min(cap, maxY2);
                        }
                        // Last-payment floor (term-specific):
                        //   3-yr: 20%, 4-yr+: 10%
                        // Don't apply on the maturity year itself — it
                        // takes the residual anyway.
                        if (i < maturityIdx) {
                              const lastReserve = _metlifeBase * _metlifeRules.lastPaymentMinPct;
                              const maxAllowed  = Math.max(0, gainRemaining - lastReserve);
                              cap = Math.min(cap, maxAllowed);
                        }
                  }
                  gainRecThisYear = cap;
                  if (i === maturityIdx && gainRemaining > gainRecThisYear) {
                        gainRecThisYear = gainRemaining;
                  }
                  gainRemaining -= gainRecThisYear;
            }

            // Step 3 — carve estimated tax + push reinvest tranche
            // (deferred only). Immediate mode skips: _gainTaxRate=0
            // and _remainingReinvestCap=0, so trancheTaxCarve=0 and
            // reinvested clamps to 0 even before the cap check.
            //
            // Installment mode (Strategy B): the buyer's payment this
            // year is the FULL _installmentPayment (basis + gain), not
            // just the gain. The seller deploys the whole payment to
            // Brooklyn (minus the gain-portion tax carve when "cover
            // taxes" is on). This is bigger than Strategy C's reinvest
            // because basis recovery is also cash, not just principal
            // returned silently.
            const trancheTaxCarve = gainRecThisYear * _gainTaxRate;
            let reinvested;
            if (_isInstallment && i >= startIdx && i <= maturityIdx) {
                  reinvested = Math.max(0, _installmentPayment - trancheTaxCarve);
            } else {
                  reinvested = Math.max(0, gainRecThisYear - trancheTaxCarve);
            }
            if (_remainingReinvestCap !== null) {
                  reinvested = Math.min(reinvested, _remainingReinvestCap);
                  _remainingReinvestCap = Math.max(0, _remainingReinvestCap - reinvested);
            }
            // Tier-jumping: pick the new reinvest tranche's combo based on
            // cumulative deposit INCLUDING this reinvest. So a Y2 reinvest
            // that pushes cumulative across the $3M threshold lands the new
            // tranche on 200/100 with its 0.59 Y1 loss rate, while the
            // existing Y1 tranche stays on its original 145/45 curve.
            var _reinvestCombo = null;
            var _newTrancheLossRate = year1Rate;
            var _newTrancheFeeRate  = feeRate;
            if (reinvested > 0) {
                  var _existingCumulative = tranches.reduce(function (s, t) { return s + (t.capital || 0); }, 0);
                  var _cumulativeWithThis = _existingCumulative + reinvested;
                  _reinvestCombo = _pickComboForCumulative(_cumulativeWithThis);
                  if (_tieringCombos.length && _reinvestCombo && _reinvestCombo.lossByYear) {
                        _newTrancheLossRate = _reinvestCombo.lossByYear[0] || 0;
                        _newTrancheFeeRate  = _reinvestCombo.feeRate || feeRate;
                  }
                  tranches.push({
                        capital: reinvested,
                        startIdx: i,
                        comboId: _reinvestCombo ? _reinvestCombo.id : null,
                        comboLossByYear: _reinvestCombo && _reinvestCombo.lossByYear ? _reinvestCombo.lossByYear.slice() : null,
                        comboFeeRate: _reinvestCombo ? _reinvestCombo.feeRate : null
                  });
            }

            // Step 4 — recompute year totals INCLUDING the new tranche.
            // The new tranche operates at age=0 with its own combo's Y1
            // loss rate (which may differ from existing tranches' rates
            // under tier-jumping).
            const newTrancheLoss = reinvested * _newTrancheLossRate;
            const newTrancheFee  = reinvested * _newTrancheFeeRate;
            const yearLoss     = existingLoss + newTrancheLoss;
            const yearFee      = existingFee + newTrancheFee;
            const yearInvested = existingInvested + reinvested;

            recognitionSchedule.push({ year: year, gainRecognized: gainRecThisYear });

            const _recapThisYear = (i === 0) ? recapture : 0;
            const baseline   = _baseScenarioForYear(cfg, year, gainRecThisYear, _recapThisYear);
            const baselineTax = _yearTaxes(baseline);

            // Do-nothing baseline: lump-Y1 LT + recapture, regardless
            // of recognition timing. In immediate mode this equals
            // baseline (same gain timing). In deferred mode it differs:
            // matched-timing baseline taxes the gain as it's recognized
            // year by year, while do-nothing taxes the full lump in Y1.
            //
            // Short-term gain stays as the annual income source from
            // _baseScenarioForYear (cfg.baseShortTermGain) — per the
            // recent semantics shift, STG is an Income-Source line
            // item, NOT a sale carve-out. Earlier code zeroed
            // shortTermGain for i!=0 here; that under-reported the do-
            // nothing tax in scenarios with non-zero baseShortTermGain
            // and produced false-positive `withStrategy > totalBaseline`
            // results in ~2.3% of Monte Carlo trials (audit finding F12).
            const dnBaseline = _baseScenarioForYear(
                  cfg, year,
                  i === 0 ? totalLT : 0,
                  i === 0 ? recapture : 0
            );
            // Recompute investmentIncome to match the do-nothing LT/ST/recap
            // — the LT slice differs from the matched-timing baseline so
            // NIIT base must be recomputed; ST stays as set by
            // _baseScenarioForYear. Passive ordinary (interest + rental +
            // non-qualified div via cfg.investmentIncomeOrdinary) is also
            // in the NIIT base per §1411(c)(1)(A)(i) - include the same
            // inflation-scaled value _baseScenarioForYear used. Without
            // this term, do-nothing NIIT silently zeroed out the surtax
            // on passive ordinary income, understating totalBaseline and
            // therefore Brooklyn savings on rental/interest-heavy clients.
            var _dnInflRate = (typeof TAX_DATA !== 'undefined' && TAX_DATA && typeof TAX_DATA.inflationRate === 'number')
                  ? TAX_DATA.inflationRate
                  : ((typeof window !== 'undefined' && window.TAX_DATA && typeof window.TAX_DATA.inflationRate === 'number')
                        ? window.TAX_DATA.inflationRate : 0);
            var _dnScaledInvOrd = (cfg.investmentIncomeOrdinary || 0) * Math.pow(1 + _dnInflRate, Math.max(0, i));
            var _dnScaledQualDiv = (cfg.qualifiedDividend || 0) * Math.pow(1 + _dnInflRate, Math.max(0, i));
            dnBaseline.investmentIncome = (dnBaseline.longTermGain || 0)
                  + Math.max(0, dnBaseline.shortTermGain || 0)
                  + (dnBaseline.depreciationRecapture || 0)
                  + _dnScaledInvOrd
                  + _dnScaledQualDiv;
            const dnBaselineTax = _yearTaxes(dnBaseline);

            // Apply Brooklyn losses to the matched-timing baseline.
            // Carryforward + this year's loss flow into one call so
            // §1211(b)'s $3K ordinary cap applies once per year.
            const totalLossAvail = stCF + yearLoss;
            const withStrat   = _applyLossesWithSTCfCap(baseline, totalLossAvail, ordCap);
            const withStratTax = _yearTaxes(withStrat);

            stCF = Math.max(0, withStrat._lossUnused || 0);

            const bh = brookhavenSchedule ? brookhavenSchedule.perYear[i] : { setup: 0, quarterly: 0, total: 0 };

            // Append the new reinvest tranche to the per-year breakdown
            // (it opened THIS year so its trancheAge=0 and gets the new-
            // tranche loss rate / fee rate calculated above).
            if (trancheRows && reinvested > 0) {
                  trancheRows.push({
                        trancheIdx: tranches.length - 1,
                        openYear: year,
                        capital: reinvested,
                        age: 0,
                        comboId: _reinvestCombo ? _reinvestCombo.id : null,
                        lossRate: _newTrancheLossRate,
                        feeRate: _newTrancheFeeRate,
                        yf: 1,
                        loss: newTrancheLoss,
                        fee: newTrancheFee,
                        isTaxReserve: false,
                        isNew: true
                  });
            }

            rows.push({
                  year: year,
                  gainRecognized: gainRecThisYear,
                  taxCarveOut: trancheTaxCarve,
                  reinvestedThisYear: reinvested,
                  lossGenerated: yearLoss,
                  lossApplied: withStrat._lossUsed || 0,
                  stCarryForward: stCF,
                  investmentThisYear: yearInvested,
                  trancheBreakdown: trancheRows,
                  fee: yearFee,
                  brookhavenFee: bh.total,
                  brookhavenSetupFee: bh.setup,
                  brookhavenQuarterlyFee: bh.quarterly,
                  baseline: baselineTax,
                  doNothingBaseline: dnBaselineTax,
                  withStrategy: withStratTax,
                  savings: dnBaselineTax.total - withStratTax.total
            });
      }

      // Immediate-mode no-engagement detection (parity with legacy
      // computeTaxComparison): if no row recognized any gain or applied
      // any loss, zero out per-row brookhaven so the dashboard renders
      // "no engagement" cleanly. Doesn't apply to deferred — its no-
      // engagement case is handled by the early return above.
      if (!isDeferred) {
            const _noEngagement = rows.every(function (r) {
                  return (r.gainRecognized || 0) === 0 && (r.lossApplied || 0) === 0;
            });
            if (_noEngagement) {
                  rows.forEach(function (r) {
                        r.brookhavenFee = 0;
                        r.brookhavenSetupFee = 0;
                        r.brookhavenQuarterlyFee = 0;
                  });
            }
      }

      // Aggregate. totalBaseline uses doNothingBaseline (the honest
      // "did nothing" comparison); legacy computeTaxComparison
      // happened to aggregate r.baseline.total but in immediate mode
      // that's the same value (gain timing = lump-Y1 = do-nothing).
      let totalBaseline = 0, totalWith = 0, totalFees = 0, totalBrookhaven = 0;
      rows.forEach(function (r) {
            const _matched = (r.baseline ? r.baseline.total : 0);
            const _dn = (r.doNothingBaseline && r.doNothingBaseline.total != null)
                  ? r.doNothingBaseline.total
                  : _matched;
            totalBaseline += _dn;
            totalWith += r.withStrategy.total;
            totalFees += (r.fee || 0);
            totalBrookhaven += (r.brookhavenFee || 0);
      });

      // G2 invariant guard. Three checks, fire loudly if violated —
      // they catch the regression patterns that surfaced F12/F14 in the
      // post-collapse audit. Cheap to compute, dev-only signal.
      //
      //   (a) Gain conservation: sumRecognized + unrecognizedGain ===
      //       totalGainBucket. Already required for deferred; immediate
      //       holds trivially (forced lump at maturityIdx=0) but we
      //       still verify so a future regression can't silently violate.
      //   (b) Savings sign: totalWithStrategy must not exceed
      //       totalBaseline (Brooklyn never makes things worse). F12
      //       had this firing on ~2.3% of MC scenarios.
      //   (c) Finite outputs: totals + per-row totals must be finite
      //       numbers. F14 had _zeroDeferredComparison emit undefined
      //       totals that NaN-propagated.
      if (typeof console !== 'undefined' && typeof console.warn === 'function') {
            var _sumRec = recognitionSchedule.reduce(function (s, r) {
                  return s + (r.gainRecognized || 0);
            }, 0);
            var _accountedGain = _sumRec + Math.max(0, gainRemaining);
            if (Math.abs(_accountedGain - totalGainBucket) > 1) {
                  console.warn('[RETT engine] gain conservation broken: ' +
                        'mode=' + (isDeferred ? 'deferred' : 'immediate') +
                        ' totalGainBucket=' + totalGainBucket +
                        ' sumRecognized=' + _sumRec +
                        ' unrecognized=' + gainRemaining +
                        ' delta=' + (_accountedGain - totalGainBucket));
            }
            if (totalWith > totalBaseline + 1) {
                  console.warn('[RETT engine] withStrategy > totalBaseline: ' +
                        'mode=' + (isDeferred ? 'deferred' : 'immediate') +
                        ' totalBaseline=' + totalBaseline +
                        ' totalWithStrategy=' + totalWith +
                        ' delta=' + (totalWith - totalBaseline));
            }
            if (!isFinite(totalBaseline) || !isFinite(totalWith) ||
                !isFinite(totalFees) || !isFinite(totalBrookhaven)) {
                  console.warn('[RETT engine] non-finite total: ' +
                        'mode=' + (isDeferred ? 'deferred' : 'immediate') +
                        ' totalBaseline=' + totalBaseline +
                        ' totalWithStrategy=' + totalWith +
                        ' totalFees=' + totalFees +
                        ' totalBrookhavenFees=' + totalBrookhaven);
            }
      }

      const recognitionYears = recognitionSchedule.filter(function (r) {
            return r.gainRecognized > 0;
      }).map(function (r) { return r.year; });
      const durationYears = recognitionYears.length
            ? (recognitionYears[recognitionYears.length - 1] - recognitionYears[0] + 1)
            : 0;

      return {
            rows: rows,
            totalBaseline: totalBaseline,
            totalWithStrategy: totalWith,
            totalSavings: totalBaseline - totalWith,
            totalFees: totalFees,
            totalBrookhavenFees: totalBrookhaven,
            totalAllFees: totalFees + totalBrookhaven,
            recognitionSchedule: recognitionSchedule,
            durationYears: durationYears,
            unrecognizedGain: gainRemaining,
            deferred: isDeferred
      };
}

// Expose to global scope for parallel-run validation harness.
if (typeof window !== 'undefined') {
      window.unifiedTaxComparison = unifiedTaxComparison;
}


function _fmtUSD(n) {
      if (typeof n !== 'number' || !isFinite(n)) return '-';
      const sign = n < 0 ? '-' : '';
      return sign + '$' + Math.abs(Math.round(n)).toLocaleString();
}

function renderTaxComparison(host, comparison) {
      if (!host) return;
      if (!comparison || !comparison.rows || !comparison.rows.length) {
            host.innerHTML = '<p class="subtitle">Run the Decision Engine on the Projection page to populate the tax comparison.</p>';
            return;
      }
      const yrs = comparison.rows.map(r => '<th>Y' + (r.year - comparison.rows[0].year + 1) + ' (' + r.year + ')</th>').join('');
      const cellsBaseline = comparison.rows.map(r => '<td>' + _fmtUSD(r.baseline.total) + '</td>').join('');
      const cellsWith     = comparison.rows.map(r => '<td>' + _fmtUSD(r.withStrategy.total) + '</td>').join('');
      const cellsSavings  = comparison.rows.map(r => '<td>' + _fmtUSD(r.savings) + '</td>').join('');
      const cellsLoss     = comparison.rows.map(r => '<td>' + _fmtUSD(r.lossApplied) + '</td>').join('');
      const cellsGain     = comparison.rows.map(r => '<td>' + _fmtUSD(r.gainRecognized) + '</td>').join('');

      // Federal tax row uses the NARROW definition (ord + recap + lt
      // + amt) so NIIT, Additional Medicare, and SE tax — broken out
      // below — don't visually double-count. This matches the Page-1
      // panel and the Strategy Summary, which both label their
      // "Federal Income Tax" line the narrow way.
      const fedRows = comparison.rows.map(r => '<td>' + _fmtUSD(r.baseline.federalIncomeTax || (r.baseline.ordinaryTax + (r.baseline.recapTax || 0) + r.baseline.ltTax + r.baseline.amt)) + '</td>').join('');
      const stRows  = comparison.rows.map(r => '<td>' + _fmtUSD(r.baseline.state) + '</td>').join('');
      const niitRow = comparison.rows.map(r => '<td>' + _fmtUSD(r.baseline.niit) + '</td>').join('');
      const medRow  = comparison.rows.map(r => '<td>' + _fmtUSD(r.baseline.addlMedicare) + '</td>').join('');

      host.innerHTML =
            '<table class="tax-comparison-table">' +
            '<thead><tr><th>Line Item</th>' + yrs + '<th>Total</th></tr></thead>' +
            '<tbody>' +
            '<tr class="grp-head"><td colspan="' + (comparison.rows.length + 2) + '">Sale Activity</td></tr>' +
            '<tr><td>Long-term gain recognized</td>' + cellsGain + '<td>' + _fmtUSD(comparison.rows.reduce((a,r)=>a+r.gainRecognized,0)) + '</td></tr>' +
            '<tr><td>Brooklyn loss applied</td>' + cellsLoss + '<td>' + _fmtUSD(comparison.rows.reduce((a,r)=>a+r.lossApplied,0)) + '</td></tr>' +
            '<tr class="grp-head"><td colspan="' + (comparison.rows.length + 2) + '">Without Strategy (Baseline)</td></tr>' +
            '<tr><td>Federal income tax</td>' + fedRows + '<td>' + _fmtUSD(comparison.rows.reduce((a,r)=>a+(r.baseline.federalIncomeTax || (r.baseline.ordinaryTax + (r.baseline.recapTax || 0) + r.baseline.ltTax + r.baseline.amt)),0)) + '</td></tr>' +
            '<tr><td>State tax</td>' + stRows + '<td>' + _fmtUSD(comparison.rows.reduce((a,r)=>a+r.baseline.state,0)) + '</td></tr>' +
            '<tr><td>NIIT (3.8%)</td>' + niitRow + '<td>' + _fmtUSD(comparison.rows.reduce((a,r)=>a+r.baseline.niit,0)) + '</td></tr>' +
            '<tr><td>Additional Medicare (0.9%)</td>' + medRow + '<td>' + _fmtUSD(comparison.rows.reduce((a,r)=>a+r.baseline.addlMedicare,0)) + '</td></tr>' +
            '<tr class="row-total"><td><strong>Total tax (baseline)</strong></td>' + cellsBaseline + '<td><strong>' + _fmtUSD(comparison.totalBaseline) + '</strong></td></tr>' +
            '<tr class="grp-head"><td colspan="' + (comparison.rows.length + 2) + '">With Brooklyn Strategy</td></tr>' +
            '<tr class="row-total"><td><strong>Total tax (with strategy)</strong></td>' + cellsWith + '<td><strong>' + _fmtUSD(comparison.totalWithStrategy) + '</strong></td></tr>' +
            '<tr class="row-savings"><td><strong>Tax savings</strong></td>' + cellsSavings + '<td><strong>' + _fmtUSD(comparison.totalSavings) + '</strong></td></tr>' +
            '</tbody></table>';
}
