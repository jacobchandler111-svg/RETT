// FILE: js/02-tax-engine/tax-comparison.js
// Side-by-side baseline vs. post-strategy tax. Per-year, multi-year aware.

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
      const shortOverride = (cfg.shortGainByYear && cfg.shortGainByYear[idx] != null) ? cfg.shortGainByYear[idx] : (cfg.baseShortTermGain || 0);
      const longOverride  = (cfg.longGainByYear  && cfg.longGainByYear[idx]  != null) ? cfg.longGainByYear[idx]  : 0;
      const ltAmt = (gainTakenThisYear != null ? gainTakenThisYear : 0) + longOverride;
      // Passive / portfolio income inside ordinary (rental + non-qualified
      // div / interest) is also part of the §1411 NIIT base. Inflated
      // alongside baseOrdinaryIncome so high-income clients with heavy
      // rental income pay the right NIIT every year.
      const _scaledInvOrd = (cfg.investmentIncomeOrdinary || 0) * Math.pow(1 + _infl, Math.max(0, idx));
      const _recap = Math.max(0, Number(recaptureThisYear) || 0);
      return {
            year: yr,
            status: cfg.filingStatus,
            state: cfg.state,
            // Recapture flows through depreciationRecapture (separate
            // field) so the engine can apply the §1250 25% cap. Adding
            // it to ordinaryIncome would silently route it through
            // full marginal rates.
            ordinaryIncome: ordOverride,
            depreciationRecapture: _recap,
            shortTermGain: shortOverride,
            longTermGain: ltAmt,
            qualifiedDividend: 0,
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
            investmentIncome: ltAmt + Math.max(0, shortOverride) + _recap + _scaledInvOrd,
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
      const stateTax = computeStateTax(
            _ord + _st + _rcp + _lt + _qd,
            _yr, _state, _stat,
            { itemized: _itm, longTermGain: _lt });
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

function _applyLossesToScenario(scenario, lossAvailable) {
      // IRC §1(h) loss ordering — capital losses absorb gain buckets
      // highest-rate first (taxpayer-favorable):
      //   1) ST gain (ordinary rates, up to 37%)
      //   2) §1250 unrecaptured gain (capped at 25%)
      //   3) Regular LT gain (0/15/20%)
      //   4) Ordinary income (capped at $3K / $1.5K MFS per §1211(b))
      // Mirrors _applyLossesWithSTCfCap (deferred path); without step 2,
      // a sale with significant accelerated depreciation in the immediate
      // path saturated only the LT bucket and wasted the rest of the
      // loss at the $3K ordinary cap — leaving recapture fully taxed and
      // making Sell-Now (partial-year fees) beat Seller-Finance (full-year
      // fees) on net since both ended up with identical savings.
      const out = Object.assign({}, scenario);
      let loss = lossAvailable;

      // Step 1: ST gain
      const offsetShort = Math.min(out.shortTermGain || 0, loss);
      out.shortTermGain = (out.shortTermGain || 0) - offsetShort;
      loss -= offsetShort;

      // Step 2: §1250 unrecaptured gain (recapture, 25% bucket).
      // Still a capital gain for §1211 netting purposes, just rate-capped
      // at 25% downstream. NIIT base also shrinks since recapture is
      // investment income.
      if (loss > 0) {
            const offsetRecap = Math.min(out.depreciationRecapture || 0, loss);
            out.depreciationRecapture = (out.depreciationRecapture || 0) - offsetRecap;
            out.investmentIncome = Math.max(0, (out.investmentIncome || 0) - offsetRecap);
            loss -= offsetRecap;
      }

      // Step 3: LT gain (qualified div NOT a capital gain;
      // it's taxed at LTCG rates but loss netting only applies to actual gains)
      if (loss > 0) {
            const offsetLong = Math.min(out.longTermGain || 0, loss);
            out.longTermGain = (out.longTermGain || 0) - offsetLong;
            // investmentIncome should track LTG since NIIT applies to net inv income
            out.investmentIncome = Math.max(0, (out.investmentIncome || 0) - offsetLong);
            loss -= offsetLong;
      }

      // Step 4: ordinary income, capped at §1211(b).
      // Without this cap the immediate path silently erased uncapped
      // amounts of ordinary income, inflating savings by ≈ amount × ~37%.
      if (loss > 0) {
            const ordCap = (out.status === 'mfs' || out.status === 'married_separate')
                  ? 1500 : 3000;
            const ordRoom = Math.min(out.ordinaryIncome || 0, ordCap);
            const offsetOrd = Math.min(ordRoom, loss);
            out.ordinaryIncome = (out.ordinaryIncome || 0) - offsetOrd;
            // Wages are unchanged: capital losses reduce taxable ordinary
            // income, but the Additional Medicare base is W-2 wages
            // (or SE earnings), not taxable income. A loss can never
            // reduce the wages a taxpayer was paid.
            loss -= offsetOrd;
      }

      out._lossUsed = lossAvailable - loss;
      out._lossUnused = loss;
      return out;
}

function computeTaxComparison(cfg, recommendation) {
      const horizon = cfg.horizonYears || 5;

      // Below-min lifecycle check — if the position can never legally
      // open over the horizon, return zero results (no Brooklyn loss
      // applied, no Brookhaven fees). The dashboard renders this as
      // "no engagement". See _belowMinForLifecycle for the condition.
      const _belowMin = _belowMinForLifecycle(cfg);

      // Brookhaven advisory wrap fees attach to every comparison row.
      // The proration anchors on the STRATEGY implementation date, not
      // the sale closing date — engagement fees start running when the
      // Brooklyn position actually opens. Falls back to the sale date
      // for older saved cases that don't carry strategyImplementationDate.
      const yfImpl = (typeof yearFractionRemaining === 'function')
            ? yearFractionRemaining((typeof cfgStrategyDate === 'function' ? cfgStrategyDate(cfg) : (cfg.strategyImplementationDate || cfg.implementationDate)))
            : 1;
      const brookhavenSchedule = (typeof brookhavenFeeSchedule === 'function' && !_belowMin)
            ? brookhavenFeeSchedule(horizon, yfImpl)
            : null;

      const rows = [];
      // Defensive year1 default so row.year is never null even when
      // the caller forgot to set cfg.year1. (Issue #58.)
      const _y0 = (cfg.year1 != null) ? Number(cfg.year1) : (new Date()).getFullYear();
      // Immediate path = NO structured sale = ALL gain recognized in
      // Y1. Spreading gain across years requires a structured-sale
      // wrapper (the deferred-comparison engine handles that). When
      // the recommendation engine returned a multi-year-shortfall
      // schedule on the immediate path, it was attempting to spread
      // gain to fit Brooklyn's annual loss capacity — but presenting
      // that as "no structured sale needed" is incorrect. Flatten the
      // schedule to Y1-only here so the dashboard shows the honest
      // lump-sum picture: full gain Y1, Brooklyn losses up to
      // capacity, leftover gain just taxed at LTCG.
      const _isImmediate = (cfg.recognitionStartYearIndex || 0) === 0;
      let _flatRec = recommendation;
      if (_isImmediate && recommendation &&
          (recommendation.recommendation === 'multi-year' ||
           recommendation.recommendation === 'multi-year-shortfall')) {
            const _sched = recommendation.schedule || recommendation.years || [];
            // B4: derive total LT gain from cfg directly. The multi-year
            // solver returns gainByYear summing to whatever Brooklyn could
            // ABSORB — for multi-year-shortfall that's less than the
            // actual property gain. Using the solver's number flattened
            // to Y1 silently drops the unabsorbable residual from the
            // tax calc, overstating savings. Pull from cfg so the full
            // property gain hits Y1 and any excess over Brooklyn capacity
            // is taxed at LTCG rates.
            // STG no longer subtracted from LT — see top-of-file note
            // about STG semantics shift to "income source" not "carve-out
            // from sale." Property LT gain = sale - basis - depr only.
            const _totalLTFromCfg = Math.max(0,
                  (cfg.salePrice || 0) - (cfg.costBasis || 0)
                  - (cfg.acceleratedDepreciation || 0));
            const _totalLTFromRec = (recommendation.longTermGain != null)
                  ? recommendation.longTermGain
                  : _sched.reduce(function (s, slot) {
                        return s + (slot && (slot.gainTaken || slot.gain) || 0);
                      }, 0);
            // Use whichever is larger — cfg-derived is the authoritative
            // total when sale-price/basis/depr are populated, but fall
            // back to the rec sum for cfg-less callers (test harnesses,
            // direct API users).
            const _totalLT = Math.max(_totalLTFromCfg, _totalLTFromRec || 0);
            // Y1 loss = the recommendation's Y1-capacity. For
            // multi-year-shortfall this is the Y1 slot's lossGenerated;
            // for plain multi-year it's the same since the schedule
            // is the engine's own output.
            const _y1Slot = _sched[0] || {};
            const _y1Loss = (_y1Slot.lossGenerated != null
                                  ? _y1Slot.lossGenerated
                                  : (_y1Slot.loss != null ? _y1Slot.loss
                                        : (recommendation.lossGenerated || 0)));
            _flatRec = {
                  recommendation: 'single-year',
                  longTermGain: _totalLT,
                  lossGenerated: _y1Loss,
                  schedule: null
            };
      }
      // B5: keep the Brooklyn position open through the full horizon
      // for the immediate path. Each year past Y1 the basis tranche
      // generates losses at its age-appropriate rate; with the
      // §1211(b) $3K cap on ordinary offset (and STCL carryforward),
      // these Y2+ losses are economically small but real. Without
      // this, the lump-sum scenario looked artificially worse than
      // the structured-sale path in the auto-pick optimizer because
      // it forfeited every dollar of Y2+ Brooklyn loss.
      const _isImmediateLoop = _isImmediate &&
            _flatRec && _flatRec.recommendation === 'single-year';
      const _immediateCapital = _isImmediateLoop
            ? Math.max(0, cfg.investedCapital || cfg.investment || 0) : 0;
      const _immediateLossRate = (!_isImmediateLoop || _immediateCapital <= 0)
            ? null
            : _buildLossRateByAge(cfg, yfImpl);
      // STCL carryforward across years for the immediate path. Y1's
      // unused loss past the recommendation's lossGenerated rolls into
      // Y2's available offset, which then offsets up to $3K of ordinary
      // income before further carryforward.
      let _stCfImmediate = 0;

      // Per-year Brooklyn fee for the immediate path. Mirrors the same
      // single-source-of-truth math ProjectionEngine.run uses (capital
      // × annual feeRate, with Y1 partial-year-weighted by yfImpl).
      // Without this, the year-by-year Details table read r.fee as
      // undefined → showed $0 for every year, contradicting the summary
      // tile that pulls fees from ProjectionEngine.run.
      const _immediateFeeFn = (function () {
            if (!_isImmediateLoop || _immediateCapital <= 0) return null;
            const _yfImm = yfImpl;
            const _comboImm = (cfg.comboId && typeof getSchwabCombo === 'function')
                  ? getSchwabCombo(cfg.comboId) : null;
            let feeRate = 0;
            if (_comboImm && typeof window.brooklynFeeRateFor === 'function') {
                  feeRate = window.brooklynFeeRateFor(_comboImm.longPct, _comboImm.shortPct);
            } else if (_comboImm) {
                  feeRate = _comboImm.feeRate || 0;
            } else if (typeof brooklynFee === 'function') {
                  feeRate = brooklynFee(cfg.tierKey || 'beta1', _defaultLeverage(cfg), 1);
            }
            return function (j) {
                  return _immediateCapital * feeRate * (j === 0 ? _yfImm : 1);
            };
      })();

      for (let i = 0; i < horizon; i++) {
            const yr = _y0 + i;
            let gainThisYear = 0;
            let lossThisYear = 0;

            if (_flatRec && _flatRec.recommendation === 'single-year') {
                  if (i === 0) {
                        gainThisYear = _flatRec.longTermGain || 0;
                        // Y1 loss uses the same formula as Y2+ (capital ×
                        // lossRateForTrancheYear(0) at cfg.leverage). Reading
                        // from _flatRec.lossGenerated is the legacy path —
                        // for variable-solver picks (Goldman/non-Schwab), the
                        // recommendation.lossGenerated comes from the LOWEST
                        // leverage that wipes Y1 gain, which is below
                        // cfg.leverage. That under-reports Y1 capacity by
                        // ~$72K on a $5M Goldman scenario (verified via
                        // engine-parity-sweep). Schwab combos and multi-year-
                        // derived rec already match this formula, so only
                        // the variable-solver case changes; result is a small
                        // savings increase on Goldman flows reflecting the
                        // user's actual chosen leverage.
                        lossThisYear = (_immediateLossRate && _immediateCapital > 0)
                              ? _immediateCapital * _immediateLossRate(0)
                              : (_flatRec.lossGenerated || 0);
                  } else if (_immediateLossRate && _immediateCapital > 0) {
                        // B5: position open Y2+, age-appropriate loss rate.
                        lossThisYear = _immediateCapital * _immediateLossRate(i);
                  }
            } else if (_flatRec && (_flatRec.recommendation === 'multi-year' || _flatRec.recommendation === 'multi-year-shortfall')) {
                  const sched = _flatRec.schedule || _flatRec.years || [];
                  const slot = sched[i];
                  if (slot) {
                        gainThisYear = slot.gainTaken || slot.gain || 0;
                        lossThisYear = slot.lossGenerated || slot.loss || 0;
                  }
            }
            // Strip Brooklyn losses entirely when below-min — the
            // baseline tax (no Brooklyn) becomes the with-strategy tax.
            if (_belowMin) lossThisYear = 0;

            // Recapture is recognized once, in the sale year (Y1 of the
            // immediate path). Years 2..N have no sale ⇒ no recapture.
            // Without this, the projection's Y1 baseline silently dropped
            // the recapture line that the Page-1 panel includes,
            // producing two different "do-nothing" totals (Bug #5).
            const _recapY = (i === 0) ? Math.max(0, cfg.acceleratedDepreciation || 0) : 0;
            const baseline = _baseScenarioForYear(cfg, yr, gainThisYear, _recapY);
            const baselineTax = _yearTaxes(baseline);
            // Carryforward + this year's generated loss flow into the
            // single application call so step-3's $3K ordinary cap
            // applies once per year (§1211(b)).
            const _availLoss = (_isImmediateLoop ? _stCfImmediate : 0) + lossThisYear;
            const withStrat = _applyLossesToScenario(baseline, _availLoss);
            const withStratTax = _yearTaxes(withStrat);
            // Anything not absorbed becomes next year's STCL CF.
            if (_isImmediateLoop) {
                  _stCfImmediate = Math.max(0, withStrat._lossUnused || 0);
            }

            const bh = brookhavenSchedule ? brookhavenSchedule.perYear[i] : { setup: 0, quarterly: 0, total: 0 };
            const _yearFee = _immediateFeeFn ? _immediateFeeFn(i) : 0;
            rows.push({
                  year: yr,
                  gainRecognized: gainThisYear,
                  lossApplied: withStrat._lossUsed || 0,
                  lossGenerated: lossThisYear,
                  stCarryForward: _isImmediateLoop ? _stCfImmediate : 0,
                  fee: _yearFee,
                  brookhavenFee: bh.total,
                  brookhavenSetupFee: bh.setup,
                  brookhavenQuarterlyFee: bh.quarterly,
                  baseline: baselineTax,
                  withStrategy: withStratTax,
                  savings: baselineTax.total - withStratTax.total
            });
      }

      // No-engagement detection at the engine level (Issue #48): when
      // no row recognized any gain or applied any loss, this is the
      // "client engaged a custodian but no taxable activity" case.
      // Zero out the per-row brookhavenFee + setup so every consumer
      // (ribbon, dashboard, narrative, table) gets identical numbers
      // without each having to detect this independently.
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
      let totalBaseline = 0, totalWith = 0, totalFees = 0, totalBrookhaven = 0;
      rows.forEach(r => {
            totalBaseline += r.baseline.total;
            totalWith += r.withStrategy.total;
            totalFees += (r.fee || 0);
            totalBrookhaven += (r.brookhavenFee || 0);
      });
      return {
            rows: rows,
            totalBaseline: totalBaseline,
            totalWithStrategy: totalWith,
            totalSavings: totalBaseline - totalWith,
            totalFees: totalFees,
            totalBrookhavenFees: totalBrookhaven,
            totalAllFees: totalFees + totalBrookhaven
      };
}

// ============================================================
// Deferred-recognition comparison.
// Models a structured-sale scenario where:
//   - Year 1: cost-basis cash is invested in Brooklyn (gain locked up
//     in a structured-sale agreement with an insurance company).
//   - Years 1..(R-1): Brooklyn generates short-term losses with no
//     gain to absorb them. Per IRS rules, only $3,000 of those losses
//     can offset ordinary income each year; the rest carries forward
//     as short-term capital loss.
//   - Year R onwards: a portion of the gain is paid out (Jan 1 so it
//     gets a full year of fresh STL). The accumulated CF + same-year
//     Brooklyn loss offsets the recognized gain. Recognized gain cash
//     is reinvested in Brooklyn as a NEW tranche.
//   - Greedy schedule: each eligible year, recognize as much gain as
//     accumulated capacity will absorb. If gain still remains in the
//     final horizon year, force-recognize the remainder (it gets taxed).
//
// Tranche math: each tranche tracks (capital, startYearIdx). The Year-i
// loss for tranche t = t.capital * lossRate(i - t.startYearIdx). For
// non-Schwab strategies the rate is year-independent (brooklynInterpolate
// returns one number); for Schwab combos the rate comes from the
// combo's lossByYear array indexed by the tranche's age in years.
//
// Returns the same shape as computeTaxComparison plus a deferred:true
// flag and a recognitionSchedule[] for display.

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

      // Step 1: ST gain
      const offsetShort = Math.min(out.shortTermGain || 0, loss);
      out.shortTermGain = (out.shortTermGain || 0) - offsetShort;
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
      if (loss > 0) {
            const cap = Math.min(out.ordinaryIncome || 0, capOrdinary);
            const offsetOrd = Math.min(cap, loss);
            out.ordinaryIncome = (out.ordinaryIncome || 0) - offsetOrd;
            // Wages are unchanged — see note in _applyLossesToScenario.
            loss -= offsetOrd;
      }

      out._lossUsed = lossAvailable - loss;
      out._lossUnused = loss;
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
      const stratKey = cfg.tierKey || cfg.strategyKey;
      if (!stratKey) return false;
      // Pass cfg.comboId so Schwab returns the combo-specific minimum
      // (145/45 = $1M, 200/100 = $3M) instead of the strategy-wide floor.
      const min = window.getMinInvestment(custodianId, stratKey, cfg.comboId);
      if (!min) return false;
      const basis = Math.max(0, cfg.costBasis || 0);
      // STG is now an independent income item (not carved from sale).
      const ltGain = Math.max(0, (cfg.salePrice || 0) - (cfg.costBasis || 0) - (cfg.acceleratedDepreciation || 0));
      const recapture = Math.max(0, cfg.acceleratedDepreciation || 0);
      const fromSale = (cfg.salePrice || 0) > 0 && basis > 0
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
      const _totalGainBucket = _ltGain + _recap;
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
      return {
            deferred: true,
            rows: rows,
            recognitionSchedule: rows.map(function (r) { return { year: r.year, gainRecognized: 0 }; }),
            unrecognizedGain: _totalGainBucket,
            totalSavings: 0,
            totalFees: 0,
            totalBrookhavenFees: 0,
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
//   2. Otherwise apply a hard 18-month floor (regulatory minimum for
//      structured-sale products), then auto-extend the maturity to
//      land on the next Jan 1: structured-sale payouts happen on
//      Jan 1, so a mid-year maturity wastes the months between the
//      natural maturity and the next Jan 1. E.g. May 2026 sale with
//      18-month duration → natural maturity Nov 2027 → bump to
//      Jan 1 2028 (effectively a 20-month term) so the last legal
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
      // 18-month minimum is the regulatory floor for a Brooklyn
      // structured-sale product. Anything shorter the user enters is
      // ignored.
      const months = Math.max(18, monthsRaw);
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

function computeDeferredTaxComparison(cfg) {
      // Below-min lifecycle check: if the position can never legally
      // open over the horizon (basis + total gain proceeds < custodian
      // min, OR cfg.investment alone < min and no sale), return a
      // zeroed result so the dashboard / ribbon / narrative all show
      // "no engagement" rather than fabricated Brooklyn math.
      if (_belowMinForLifecycle(cfg)) return _zeroDeferredComparison(cfg);
      // No-deferral-possible short-circuit: with no LT gain AND no
      // standalone Brooklyn investment, there is literally nothing for
      // the deferred path to do. (Note: a Brooklyn-only client with
      // cfg.investment > 0 and no sale should NOT be suppressed — the
      // engine still generates small §1211 ordinary offsets that
      // legitimately appear in the ribbon.)
      const _ltGainNG  = Math.max(0,
            (cfg && cfg.salePrice || 0) - (cfg && cfg.costBasis || 0)
            - (cfg && cfg.acceleratedDepreciation || 0));
      const _recapNG   = Math.max(0, cfg && cfg.acceleratedDepreciation || 0);
      const _hasInvestment = Number(cfg && cfg.investment || cfg && cfg.investedCapital || 0) > 0;
      if ((_ltGainNG + _recapNG) <= 0 && !_hasInvestment) return _zeroDeferredComparison(cfg);
      const horizon = Math.max(1, cfg.horizonYears || cfg.years || 5);
      // Year-fraction-remaining for the strategy implementation date.
      // Computed once and reused for tranche loss interpolation, fee
      // proration, and the Brookhaven schedule below — three call sites
      // that all read the same date and would otherwise re-derive
      // independently.
      const yfImpl = (typeof yearFractionRemaining === 'function')
            ? yearFractionRemaining((typeof cfgStrategyDate === 'function' ? cfgStrategyDate(cfg) : (cfg.strategyImplementationDate || cfg.implementationDate)))
            : 1;
      const startIdxRaw = Math.max(1, Math.min(horizon - 1,
            (cfg.recognitionStartYearIndex != null ? cfg.recognitionStartYearIndex : 1)));
      // Structured-sale maturity caps the recognition window. After this
      // year index, no further gain can be deferred — the product has
      // matured and any remainder must be recognized.
      //
      // If the user (or auto-pick) requested a startIdx LATER than the
      // maturity year, that's infeasible: gain literally cannot be
      // deferred past the product term. Clamp startIdx DOWN to maturity
      // so the engine produces a legal schedule (gain forced into the
      // last legal year). Without this, picking rec=4 with an 18-month
      // duration silently extended the recognition into illegal years
      // and produced fake savings that beat the legal rec=1 / rec=2
      // options in the auto-pick optimizer — making the calculator
      // refuse to choose "no structured sale" even when it should.
      const matIdxRaw = _structuredSaleMaturityYearIdx(cfg, horizon);
      const startIdx = Math.min(startIdxRaw, Math.max(1, matIdxRaw));
      const maturityIdx = Math.max(startIdx, matIdxRaw);
      const ordCap = (cfg.filingStatus === 'mfs') ? 1500 : 3000;

      // Long-term gain bucket: salePrice net of basis, depreciation
      // recapture, AND any short-term gain the user carved out (ST is
      // taxed at ordinary rates and is tracked separately by the
      // ordinary-income path).
      const totalLT = Math.max(0,
            (cfg.salePrice || 0) - (cfg.costBasis || 0) - (cfg.acceleratedDepreciation || 0));
      const recapture = Math.max(0, cfg.acceleratedDepreciation || 0);
      // §453(i): unrecaptured §1250 depreciation recapture is recognized
      // in the YEAR OF SALE, not deferred over the installment period.
      // Only the long-term gain bucket is deferrable; recapture hits Y1
      // alongside the first tranche of LT gain. See line 992 below where
      // recapture is passed into _baseScenarioForYear for i===0 only.
      const totalGainBucket = totalLT;
      // basisCash is the cash actually deployed into Brooklyn at sale —
      // capped by Available Capital (cfg.investment) when the user has
      // chosen to "keep" some of the proceeds. Without this cap, the
      // engine ignored the keep-proceeds toggle entirely on the deferred
      // path because basisCash was hard-wired to cfg.costBasis. Now a
      // user keeping $5M of a $12M sale (Available = $7M, basis = $4M)
      // sees the deferred path correctly use $4M (keep didn't dig into
      // basis), but a user keeping $9M (Available = $3M, basis = $4M)
      // sees only $3M reach Brooklyn — basis got partially withheld.
      const _basisFull = Math.max(0, cfg.costBasis || 0);
      const _availCap = (cfg.investment != null && Number(cfg.investment) >= 0)
            ? Number(cfg.investment) : _basisFull;
      const basisCash = Math.min(_basisFull, _availCap);

      const combo = (cfg.comboId && typeof getSchwabCombo === 'function')
            ? getSchwabCombo(cfg.comboId) : null;
      // Fee rate now comes from the regression in fee-split.js, applied
      // uniformly across presets, Schwab combos, and variable leverage.
      // The published Schwab combo feeRate (e.g. 2.03% for 200/100) is
      // intentionally bypassed because the regression is more
      // forward-accurate and consistent across all strategies.
      const feeRate = (function () {
            var lp, sp;
            if (combo) { lp = combo.longPct; sp = combo.shortPct; }
            else {
                  var lev = _defaultLeverage(cfg);
                  if (typeof window.brooklynPctsForLeverage === 'function') {
                        var p = window.brooklynPctsForLeverage(cfg.tierKey || 'beta1', lev);
                        lp = p.longPct; sp = p.shortPct;
                  }
            }
            if (typeof window.brooklynFeeRateFor === 'function' && lp != null && sp != null) {
                  return window.brooklynFeeRateFor(lp, sp);
            }
            // Fallback if the splitter isn't loaded.
            if (combo) return combo.feeRate || 0;
            if (typeof brooklynInterpolate === 'function') {
                  var snap = brooklynInterpolate(cfg.tierKey || 'beta1', _defaultLeverage(cfg));
                  return snap ? (snap.feeRate || 0) : 0;
            }
            return 0;
      })();
      // B8: a tranche opening mid-year ages fractionally — at year-end
      // it's only `yf` years old, not 1.0 years. The published lossByYear
      // curve is per-full-year-of-operation, so a calendar-year-2 loss
      // for a July tranche straddles the year-1 and year-2 rates roughly
      // 50/50. Linear-interpolate between adjacent buckets:
      //   Y1 (j=0):     yf  * lossByYear[0]                           (partial first year)
      //   Y2+  (j>=1):  (1-yf) * lossByYear[j-1] + yf * lossByYear[j]   (straddles two buckets)
      // For yf=1 (Jan-1 sale) the formula collapses to lossByYear[j] —
      // matches the prior behavior. For yf=0.5 (mid-year sale) Y2 is
      // 50% year-1-rate + 50% year-2-rate; without this fix Y2 used the
      // raw year-2 rate even though the position had only aged 1.5 years.
      // Tranche loss rate by age. Schwab combos carry a year-by-year
      // curve; non-Schwab uses the per-tier Y1 regression with a Schwab
      // Beta 1 200/100 decay shape proxy. Both paths use the same
      // mid-year-start interpolation. See _buildLossRateByAge at the
      // top of this module — the immediate path uses the same helper.
      const lossRateForTrancheYear = _buildLossRateByAge(cfg, yfImpl) || function () { return 0; };

      // Per-tranche tax carve-out for "cover taxes from sale" toggle.
      // Each year's recognized gain spawns a new Brooklyn tranche; when
      // the user wants to cover taxes from the sale itself, the
      // estimated tax on the recognized chunk is reserved (carved out)
      // before the proceeds get reinvested. "A dollar paid for tax is
      // a dollar that can't be in Brooklyn." Rate is held constant
      // across the recognition window so the client can plan a stable
      // cash reserve.
      const _gainTaxRate = cfg.coverTaxesFromSale ? _estimateGainTaxRate(cfg) : 0;
      const _reinvestFrac = 1 - _gainTaxRate;

      // Tranche state. tranches[k] = { capital, startIdx } where startIdx is
      // the cfg-relative year (0 = year1).
      const tranches = [];
      if (basisCash > 0) tranches.push({ capital: basisCash, startIdx: 0 });

      // "Keep proceeds" cap on TOTAL Brooklyn deployment (basis + gain
      // reinvest). cfg.investment is Available Capital = sale - keep -
      // taxCover. If user keeps $5M of a $12M sale (basis $4M, gain
      // $8M), Available = $7M — basisCash uses $4M, leaving $3M for
      // gain reinvest across all years instead of the full $8M.
      // Without this cap, the keep-proceeds toggle had ZERO effect on
      // the deferred path because gain reinvest re-deployed the full
      // gain regardless of what the user said they wanted to keep.
      // remainingReinvestCap is the cap on FUTURE gain reinvestments
      // (after basisCash already deployed). Negative when no cfg.
      // investment provided → falls through to unlimited reinvest
      // (legacy behavior preserved for non-Page-1 callers).
      const _availTotal = (cfg.investment != null && Number(cfg.investment) >= 0)
            ? Number(cfg.investment) : null;
      let _remainingReinvestCap = (_availTotal != null)
            ? Math.max(0, _availTotal - basisCash) : null;

      let stCF = 0;
      let gainRemaining = totalGainBucket;
      const rows = [];
      const recognitionSchedule = [];

      // Brookhaven advisory wrap fees: $45K setup (Year 1) + $2K/qtr
      // for 8 quarters, with Year-1 quarterly fees pro-rated by entry
      // date (anchors on STRATEGY implementation date — engagement starts
      // when the position opens, not when the sale closes). Reuses outer
      // yfImpl computed at function entry.
      const brookhavenSchedule = (typeof brookhavenFeeSchedule === 'function')
            ? brookhavenFeeSchedule(horizon, yfImpl)
            : null;

      for (let i = 0; i < horizon; i++) {
            const year = (cfg.year1 || (new Date()).getFullYear()) + i;

            // Step 1 — compute Brooklyn loss + fees from EXISTING tranches.
            // Each tranche uses lossRateForTrancheYear(age-of-tranche), so
            // the basis position keeps generating losses every year using
            // the year-2, year-3, ... rates of the lossByYear curve while
            // newer tranches start at the year-1 rate.
            //
            // FEE TIME-WEIGHTING: the basis tranche opens at the user's
            // implementation date (mid-year for most clients) and only
            // operates `yfImpl` of Y1. Brooklyn's fee is QUOTED ANNUAL,
            // so charging the full annual rate for ~2 months of operation
            // overstates Y1 fees by 1/yfImpl (a 6× overcharge on a Nov 1
            // sale). The basis tranche gets the partial-year fee in Y1
            // and full-year fees thereafter; gain-reinvest tranches that
            // open Jan 1 of year R always get full-year fees from R on.
            let existingLoss = 0;
            let existingFee = 0;
            let existingInvested = 0;
            tranches.forEach(function (t) {
                  const trancheAge = i - t.startIdx;
                  if (trancheAge < 0) return;
                  existingLoss += t.capital * lossRateForTrancheYear(trancheAge);
                  // Partial-year fee only for the basis tranche's first
                  // year (startIdx=0, trancheAge=0). Everything else is
                  // a full year of operation.
                  const _trancheYf = (t.startIdx === 0 && trancheAge === 0) ? yfImpl : 1;
                  existingFee += t.capital * feeRate * _trancheYf;
                  existingInvested += t.capital;
            });

            // Step 2 — decide gain to recognize this year. Gain proceeds
            // are received Jan 1 of year R and reinvested same year, so
            // the new tranche generates fresh year-1 losses in year R
            // alongside the existing tranches' year-N losses. With the
            // "cover taxes from sale" toggle, only (1-taxRate)·G is
            // reinvested — so the absorption inequality becomes:
            //     G ≤ stCF + existingLoss + (G · reinvestFrac) · year1Rate
            // i.e. G ≤ (stCF + existingLoss) / (1 - reinvestFrac · year1Rate).
            // Final-year fallback: recognize any remaining gain even if
            // it can't be fully offset.
            const year1Rate = lossRateForTrancheYear(0);
            const effYear1Rate = year1Rate * _reinvestFrac;
            const denom = Math.max(0.001, 1 - effYear1Rate);
            // §453(i): recapture is recognized in Y1 only and consumes
            // Brooklyn loss FIRST (per IRC §1(h) — 25% bucket absorbs
            // before the 20% LT bucket). So the LT-gain absorption
            // ceiling for Y1 is reduced by the recapture amount.
            // Y2..N have no recapture flow.
            const _recapDrag = (i === 0) ? recapture : 0;
            let gainRecThisYear = 0;
            if (i >= startIdx && i <= maturityIdx && gainRemaining > 0) {
                  const maxAbsorbable = Math.max(0, (stCF + existingLoss - _recapDrag) / denom);
                  gainRecThisYear = Math.min(gainRemaining, maxAbsorbable);
                  // Force-recognize remainder at maturity: the product has
                  // matured, no more deferral is legally possible. (Used
                  // to be `i === horizon - 1`; the maturity year is now
                  // capped by cfg.structuredSaleDurationMonths.)
                  if (i === maturityIdx && gainRemaining > gainRecThisYear) {
                        gainRecThisYear = gainRemaining;
                  }
                  gainRemaining -= gainRecThisYear;
            }

            // Step 3 — carve estimated tax out of the proceeds (when the
            // toggle is on) before pushing the new tranche. The full
            // gainRecThisYear is still TAXED — the carve only changes
            // how much of the after-tax proceeds get redeployed into
            // Brooklyn. Then cap the reinvested amount by any remaining
            // "keep proceeds" budget so the user-controlled Available
            // Capital total is honored across the full horizon.
            const trancheTaxCarve = gainRecThisYear * _gainTaxRate;
            let reinvested = Math.max(0, gainRecThisYear - trancheTaxCarve);
            if (_remainingReinvestCap != null) {
                  reinvested = Math.min(reinvested, _remainingReinvestCap);
                  _remainingReinvestCap = Math.max(0, _remainingReinvestCap - reinvested);
            }
            if (reinvested > 0) {
                  tranches.push({ capital: reinvested, startIdx: i });
            }

            // Step 4 — recompute year totals INCLUDING the new tranche.
            // Loss / fee / invested capital all scale with the
            // reinvested portion, not the gross gain.
            const newTrancheLoss = reinvested * year1Rate;
            const newTrancheFee = reinvested * feeRate;
            const yearLoss = existingLoss + newTrancheLoss;
            const yearFee = existingFee + newTrancheFee;
            const yearInvested = existingInvested + reinvested;

            recognitionSchedule.push({ year: year, gainRecognized: gainRecThisYear });

            // §453(i): recapture is recognized in the year of sale (i===0)
            // alongside the first LT-gain tranche. The strategy-matched
            // baseline must include recapture so the with-strategy
            // comparison correctly reflects ordinary-rate tax on the
            // recapture slice (capped at 25% via §1250 inside the
            // federal calc). Years 2..N have no recapture flow.
            const _recapThisYear = (i === 0) ? recapture : 0;
            const baseline = _baseScenarioForYear(cfg, year, gainRecThisYear, _recapThisYear);
            const baselineTax = _yearTaxes(baseline);

            // "Do nothing" baseline for the bar chart: if the client took
            // no action at all, the LT gain + recapture + any ST gain
            // hits Year 1 as a lump sum. Recapture is split out and
            // routed through ordinary income (not the LT bucket) so
            // Y1 dnBaseline matches the Page-1 panel exactly — the
            // panel sums recapture into ordinary at full marginal rate,
            // and any UI that compares panel to dnBaseline must agree.
            // The §1250 25% cap is enforced inside the federal calc.
            // Year 2+ baseline is just ordinary income, no property
            // gain or recapture.
            const dnBaseline = _baseScenarioForYear(
                  cfg, year,
                  i === 0 ? totalLT : 0,
                  i === 0 ? recapture : 0
            );
            if (i !== 0) dnBaseline.shortTermGain = 0;
            // Recompute investmentIncome to match the do-nothing LT/ST/recap
            // (otherwise NIIT base in Y2+ would still reflect the matched-
            // timing gain, double-counting). Include recapture per §1411 —
            // batch 1's fix to _baseScenarioForYear adds it to investment-
            // income; this override needs to match or it silently drops
            // recapture from the do-nothing NIIT base by ~$114K on a $3M
            // recapture (cause of the unifiedTaxComparison parallel-run
            // diff before this line was fixed).
            dnBaseline.investmentIncome =
                  (dnBaseline.longTermGain || 0)
                  + Math.max(0, dnBaseline.shortTermGain || 0)
                  + (dnBaseline.depreciationRecapture || 0);
            const dnBaselineTax = _yearTaxes(dnBaseline);

            const totalLossAvail = stCF + yearLoss;
            const withStrat = _applyLossesWithSTCfCap(baseline, totalLossAvail, ordCap);
            const withStratTax = _yearTaxes(withStrat);

            stCF = Math.max(0, withStrat._lossUnused || 0);

            // Brookhaven flat fees for this year (setup is Year-1 only).
            const bh = brookhavenSchedule ? brookhavenSchedule.perYear[i] : { setup: 0, quarterly: 0, total: 0 };

            rows.push({
                  year: year,
                  gainRecognized: gainRecThisYear,
                  taxCarveOut: trancheTaxCarve,
                  reinvestedThisYear: reinvested,
                  lossGenerated: yearLoss,
                  lossApplied: withStrat._lossUsed || 0,
                  stCarryForward: stCF,
                  investmentThisYear: yearInvested,
                  fee: yearFee,
                  brookhavenFee: bh.total,
                  brookhavenSetupFee: bh.setup,
                  brookhavenQuarterlyFee: bh.quarterly,
                  baseline: baselineTax,
                  doNothingBaseline: dnBaselineTax,
                  withStrategy: withStratTax,
                  savings: baselineTax.total - withStratTax.total
            });
      }

      // totalBaseline aggregates the do-nothing baseline (lump-Y1, the
      // honest "what would the client owe if they sold today and did
      // nothing" comparison) when each row exposes it. Falls back to the
      // matched-timing baseline if doNothingBaseline isn't populated on
      // a row (defensive). The matched-timing total used to be returned
      // separately as totalBaselineMatched but no consumer reads it —
      // the dashboard KPI / strategy row / savings ribbon all agree on
      // doNothingBaseline now.
      let totalBaseline = 0, totalWith = 0, totalFees = 0, totalBrookhaven = 0;
      rows.forEach(function (r) {
            const _matched = (r.baseline ? r.baseline.total : 0);
            const _dn = (r.doNothingBaseline && r.doNothingBaseline.total != null)
                  ? r.doNothingBaseline.total
                  : _matched;
            totalBaseline += _dn;
            totalWith += r.withStrategy.total;
            totalFees += r.fee;
            totalBrookhaven += (r.brookhavenFee || 0);
      });

      // Conservation guard: every dollar of LT gain must EITHER be
      // recognized in some year's tranche OR sit in unrecognizedGain at
      // maturity. If sum(recognized) + unrecognized != totalGainBucket
      // the engine silently created or destroyed gain — usually a
      // forced-recognition off-by-one or a tranche-push skip. Warn so
      // it surfaces in dev; the calculator keeps rendering since the
      // user-visible numbers are still self-consistent (savings = base
      // - with regardless of where the gain went).
      if (typeof console !== 'undefined' && typeof console.warn === 'function') {
            const _sumRec = recognitionSchedule.reduce(function (s, r) {
                  return s + (r.gainRecognized || 0);
            }, 0);
            const _accountedGain = _sumRec + Math.max(0, gainRemaining);
            if (Math.abs(_accountedGain - totalGainBucket) > 1) {
                  console.warn('[RETT engine] computeDeferredTaxComparison gain conservation broken: ' +
                        'totalGainBucket=' + totalGainBucket +
                        ' sumRecognized=' + _sumRec +
                        ' unrecognized=' + gainRemaining +
                        ' delta=' + (_accountedGain - totalGainBucket));
            }
      }

      // Effective duration = number of years over which gain was recognized
      // (used by the optimizer's tie-breaker to prefer shorter lockups).
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
            deferred: true
      };
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
function unifiedTaxComparison(cfg) {
      const isDeferred = (cfg && (cfg.recognitionStartYearIndex || 0) >= 1);

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
      // long-term portion of the property sale.
      const totalLT   = Math.max(0,
            (cfg.salePrice || 0) - (cfg.costBasis || 0) - (cfg.acceleratedDepreciation || 0));
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
      const basisCash   = isDeferred ? Math.min(_basisFull, _availTotal) : _availTotal;
      const tranches = [];
      if (basisCash > 0) tranches.push({ capital: basisCash, startIdx: 0 });
      // Reinvest budget = remaining "keep proceeds" room. Immediate
      // mode always 0 because availableCapital is the sale-day deposit
      // total — there's no separate proceeds stream to redeploy.
      let _remainingReinvestCap = isDeferred
            ? Math.max(0, _availTotal - basisCash)
            : 0;

      // Recognition window. Immediate forces Y1-only; deferred uses
      // the structured-sale maturity logic (15-month floor + Jan-1
      // auto-extend).
      let startIdx, maturityIdx;
      if (isDeferred) {
            const startIdxRaw = Math.max(1, Math.min(horizon - 1,
                  (cfg.recognitionStartYearIndex != null ? cfg.recognitionStartYearIndex : 1)));
            const matIdxRaw = _structuredSaleMaturityYearIdx(cfg, horizon);
            startIdx    = Math.min(startIdxRaw, Math.max(1, matIdxRaw));
            maturityIdx = Math.max(startIdx, matIdxRaw);
      } else {
            startIdx = 0;
            maturityIdx = 0;
      }

      // Loss-rate function — shared. Same Schwab combo / proxy decay
      // helper both engines call.
      const lossRateForTrancheYear = _buildLossRateByAge(cfg, yfImpl) || function () { return 0; };

      // Fee rate — unified regression first, then combo-direct, then
      // tier interpolation, then 0. Mirrors the deferred-path's
      // fallback chain (already established as the source of truth).
      const combo = (cfg.comboId && typeof getSchwabCombo === 'function')
            ? getSchwabCombo(cfg.comboId) : null;
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
      const brookhavenSchedule = (typeof brookhavenFeeSchedule === 'function' && !_belowMin)
            ? brookhavenFeeSchedule(horizon, yfImpl)
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
            let existingLoss = 0;
            let existingFee = 0;
            let existingInvested = 0;
            tranches.forEach(function (t) {
                  const trancheAge = i - t.startIdx;
                  if (trancheAge < 0) return;
                  existingLoss += t.capital * lossRateForTrancheYear(trancheAge);
                  const _trancheYf = (t.startIdx === 0 && trancheAge === 0) ? yfImpl : 1;
                  existingFee += t.capital * feeRate * _trancheYf;
                  existingInvested += t.capital;
            });

            // Step 2 — decide gain to recognize this year.
            // Immediate mode (startIdx=0, maturityIdx=0): force ALL
            // remaining gain at i=0, then nothing thereafter. Even if
            // existingLoss < gainRemaining, the unabsorbed portion is
            // recognized — the immediate path's whole point is "lump
            // sum at sale; whatever Brooklyn doesn't absorb is taxed."
            // Deferred mode: greedy up to maxAbsorbable, force remainder
            // at maturity year.
            const year1Rate = lossRateForTrancheYear(0);
            const effYear1Rate = year1Rate * _reinvestFrac;
            const denom = Math.max(0.001, 1 - effYear1Rate);
            const _recapDrag = (i === 0) ? recapture : 0;
            let gainRecThisYear = 0;
            if (i >= startIdx && i <= maturityIdx && gainRemaining > 0) {
                  const maxAbsorbable = Math.max(0, (stCF + existingLoss - _recapDrag) / denom);
                  gainRecThisYear = Math.min(gainRemaining, maxAbsorbable);
                  if (i === maturityIdx && gainRemaining > gainRecThisYear) {
                        gainRecThisYear = gainRemaining;
                  }
                  gainRemaining -= gainRecThisYear;
            }

            // Step 3 — carve estimated tax + push reinvest tranche
            // (deferred only). Immediate mode skips: _gainTaxRate=0
            // and _remainingReinvestCap=0, so trancheTaxCarve=0 and
            // reinvested clamps to 0 even before the cap check.
            const trancheTaxCarve = gainRecThisYear * _gainTaxRate;
            let reinvested = Math.max(0, gainRecThisYear - trancheTaxCarve);
            if (_remainingReinvestCap !== null) {
                  reinvested = Math.min(reinvested, _remainingReinvestCap);
                  _remainingReinvestCap = Math.max(0, _remainingReinvestCap - reinvested);
            }
            if (reinvested > 0) {
                  tranches.push({ capital: reinvested, startIdx: i });
            }

            // Step 4 — recompute year totals INCLUDING the new tranche.
            const newTrancheLoss = reinvested * year1Rate;
            const newTrancheFee  = reinvested * feeRate;
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
            const dnBaseline = _baseScenarioForYear(
                  cfg, year,
                  i === 0 ? totalLT : 0,
                  i === 0 ? recapture : 0
            );
            if (i !== 0) dnBaseline.shortTermGain = 0;
            // Recompute investmentIncome to match the do-nothing LT/ST
            // (otherwise NIIT base in Y2+ would still reflect the
            // matched-timing gain, double-counting). Note: recapture
            // is in investmentIncome per §1411 (see _baseScenarioForYear).
            dnBaseline.investmentIncome = (dnBaseline.longTermGain || 0)
                  + Math.max(0, dnBaseline.shortTermGain || 0)
                  + (dnBaseline.depreciationRecapture || 0);
            const dnBaselineTax = _yearTaxes(dnBaseline);

            // Apply Brooklyn losses to the matched-timing baseline.
            // Carryforward + this year's loss flow into one call so
            // §1211(b)'s $3K ordinary cap applies once per year.
            const totalLossAvail = stCF + yearLoss;
            const withStrat   = _applyLossesWithSTCfCap(baseline, totalLossAvail, ordCap);
            const withStratTax = _yearTaxes(withStrat);

            stCF = Math.max(0, withStrat._lossUnused || 0);

            const bh = brookhavenSchedule ? brookhavenSchedule.perYear[i] : { setup: 0, quarterly: 0, total: 0 };

            rows.push({
                  year: year,
                  gainRecognized: gainRecThisYear,
                  taxCarveOut: trancheTaxCarve,
                  reinvestedThisYear: reinvested,
                  lossGenerated: yearLoss,
                  lossApplied: withStrat._lossUsed || 0,
                  stCarryForward: stCF,
                  investmentThisYear: yearInvested,
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

      // Conservation guard (deferred-mode invariant). Immediate mode
      // forces all gain in Y1 so the invariant always holds trivially.
      if (isDeferred && typeof console !== 'undefined' && typeof console.warn === 'function') {
            const _sumRec = recognitionSchedule.reduce(function (s, r) {
                  return s + (r.gainRecognized || 0);
            }, 0);
            const _accountedGain = _sumRec + Math.max(0, gainRemaining);
            if (Math.abs(_accountedGain - totalGainBucket) > 1) {
                  console.warn('[RETT engine] unifiedTaxComparison gain conservation broken: ' +
                        'totalGainBucket=' + totalGainBucket +
                        ' sumRecognized=' + _sumRec +
                        ' unrecognized=' + gainRemaining +
                        ' delta=' + (_accountedGain - totalGainBucket));
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

// ============================================================
// PARALLEL-RUN SWEEP HARNESS
// ============================================================
//
// Validates that unifiedTaxComparison reproduces the legacy engines'
// output across a wide variety of scenarios. Run from the dev console:
//
//     window.runEngineParitySweep()                      // default sweep
//     window.runEngineParitySweep({ tolerance: 0.5 })    // tighter tolerance
//     window.runEngineParitySweep({ verbose: true })     // log each delta
//
// Returns:
//     {
//       scenariosRun: N,
//       perfectMatches: N,
//       deltasOverTolerance: N,
//       maxDelta: { field, value, scenario },
//       failingScenarios: [...]   // scenarios with any field > tolerance
//     }
//
// Coverage strategy: combinatorial sweep over the dimensions that
// historically caused engine drift — sale date (yfImpl), depreciation
// (recapture-Y1 path), recognition mode (immediate vs deferred), filing
// status, custodian/combo (Schwab tranche curves vs proxy decay), and
// horizon length. Plus a few hand-picked edge cases at the end.
//
function runEngineParitySweep(opts) {
      opts = opts || {};
      const tolerance = (opts.tolerance != null) ? opts.tolerance : 1.0;
      const verbose = !!opts.verbose;

      // Sweep dimensions. Keep totals modest — we want comprehensive
      // coverage without burning seconds-per-run.
      const SALE_DATES   = ['2026-01-15','2026-04-15','2026-07-15','2026-10-15','2026-12-15'];
      const DEPR_AMTS    = [0, 500000, 1500000, 3000000];
      const SALES        = [
            { salePrice: 5000000,  costBasis: 1000000  },
            { salePrice: 12000000, costBasis: 4000000  },
            { salePrice: 48000000, costBasis: 5000000  }
      ];
      const CUSTODIANS   = [
            { custodian: 'schwab',       comboId: 'beta1_145_45',  leverage: 0.45, leverageCap: 0.45 },
            { custodian: 'schwab',       comboId: 'beta1_200_100', leverage: 1.0,  leverageCap: 1.0  },
            { custodian: 'goldmanSachs', comboId: null,            leverage: 1.5,  leverageCap: 1.5  }
      ];
      const FILING_STATES = [
            { filingStatus: 'mfj',    state: 'GA' },
            { filingStatus: 'single', state: 'CA' },
            { filingStatus: 'mfj',    state: 'NY' },
            { filingStatus: 'mfj',    state: 'FL' }
      ];
      // Recognition modes: 0 = immediate (test legacy computeTaxComparison
      // path), >=1 = deferred (test legacy computeDeferredTaxComparison).
      // Horizons paired with sensible recognition windows.
      const RECOG_HORIZON = [
            { rec: 0, horizon: 1, dur: 18 },   // immediate, 1y
            { rec: 0, horizon: 5, dur: 18 },   // immediate, 5y
            { rec: 2, horizon: 5, dur: 18 },   // deferred, rec at i=2
            { rec: 3, horizon: 5, dur: 36 },   // deferred, rec at i=3
            { rec: 2, horizon: 7, dur: 24 }    // deferred, longer horizon
      ];

      const failingScenarios = [];
      let scenariosRun = 0;
      let perfectMatches = 0;
      let deltasOverTolerance = 0;
      let maxDelta = { value: 0, field: null, scenario: null };

      // Helper: deep-numerical-diff between two engine outputs.
      function compareOutputs(legacy, unified, label) {
            const diffs = [];
            // Top-level totals.
            const topFields = ['totalBaseline','totalWithStrategy','totalSavings','totalFees','totalBrookhavenFees','totalAllFees'];
            topFields.forEach(function (f) {
                  const lv = Number(legacy[f] || 0);
                  const uv = Number(unified[f] || 0);
                  const d = Math.abs(lv - uv);
                  if (d > tolerance) diffs.push({ kind: 'total', field: f, legacy: lv, unified: uv, delta: d });
            });
            // Per-row fields.
            const rowFields = ['gainRecognized','lossGenerated','lossApplied','fee','brookhavenFee','stCarryForward'];
            const baselineFields = ['total','federalIncomeTax','ordinaryTax','recapTax','ltTax','niit','addlMedicare','state'];
            const minRows = Math.min((legacy.rows || []).length, (unified.rows || []).length);
            for (let i = 0; i < minRows; i++) {
                  const lr = legacy.rows[i] || {};
                  const ur = unified.rows[i] || {};
                  rowFields.forEach(function (f) {
                        const lv = Number(lr[f] || 0);
                        const uv = Number(ur[f] || 0);
                        const d = Math.abs(lv - uv);
                        if (d > tolerance) diffs.push({ kind: 'row', rowIdx: i, field: f, legacy: lv, unified: uv, delta: d });
                  });
                  baselineFields.forEach(function (f) {
                        const lv = Number((lr.baseline || {})[f] || 0);
                        const uv = Number((ur.baseline || {})[f] || 0);
                        const d = Math.abs(lv - uv);
                        if (d > tolerance) diffs.push({ kind: 'baseline', rowIdx: i, field: f, legacy: lv, unified: uv, delta: d });
                  });
                  baselineFields.forEach(function (f) {
                        const lv = Number((lr.withStrategy || {})[f] || 0);
                        const uv = Number((ur.withStrategy || {})[f] || 0);
                        const d = Math.abs(lv - uv);
                        if (d > tolerance) diffs.push({ kind: 'withStrategy', rowIdx: i, field: f, legacy: lv, unified: uv, delta: d });
                  });
            }
            return diffs;
      }

      // Build cfg from sweep dimensions + run both engines + diff.
      function runOne(saleDate, depr, sale, cust, fs, rh) {
            const cfg = {
                  salePrice: sale.salePrice,
                  costBasis: sale.costBasis,
                  acceleratedDepreciation: depr,
                  filingStatus: fs.filingStatus,
                  state: fs.state,
                  baseOrdinaryIncome: 500000,
                  wages: 500000,
                  baseShortTermGain: 0,
                  horizonYears: rh.horizon,
                  year1: 2026,
                  implementationDate: saleDate,
                  strategyImplementationDate: saleDate,
                  strategyKey: 'beta1',
                  tierKey: 'beta1',
                  investedCapital: sale.salePrice,
                  investment: sale.salePrice,
                  leverage: cust.leverage,
                  leverageCap: cust.leverageCap,
                  comboId: cust.comboId,
                  custodian: cust.custodian,
                  recognitionStartYearIndex: rh.rec,
                  structuredSaleDurationMonths: rh.dur
            };
            const label = JSON.stringify({
                  date: saleDate, depr: depr, sale: sale.salePrice,
                  cust: cust.comboId || cust.custodian, fs: fs.filingStatus + '/' + fs.state,
                  rec: rh.rec, hor: rh.horizon, dur: rh.dur
            });

            let legacy, unified;
            try {
                  if (rh.rec === 0) {
                        const rec = recommendSale(cfg);
                        const lossGen = (rec && rec.summary && Array.isArray(rec.summary.lossByYear) && rec.summary.lossByYear[0])
                              || (rec && rec.summary && rec.summary.loss) || 0;
                        const normRec = {
                              recommendation: rec ? rec.recommendation : 'no-action',
                              longTermGain: (rec && rec.longTermGain) || 0,
                              lossGenerated: lossGen,
                              schedule: null
                        };
                        legacy = computeTaxComparison(cfg, normRec);
                  } else {
                        legacy = computeDeferredTaxComparison(cfg);
                  }
                  unified = window.unifiedTaxComparison(cfg);
            } catch (e) {
                  failingScenarios.push({ label: label, error: String(e) });
                  return;
            }
            scenariosRun++;
            const diffs = compareOutputs(legacy, unified, label);
            if (diffs.length === 0) {
                  perfectMatches++;
            } else {
                  deltasOverTolerance++;
                  // Track max delta
                  diffs.forEach(function (d) {
                        if (d.delta > maxDelta.value) {
                              maxDelta = { value: d.delta, field: d.kind + '.' + (d.rowIdx != null ? 'row' + d.rowIdx + '.' : '') + d.field, scenario: label };
                        }
                  });
                  failingScenarios.push({ label: label, diffs: diffs });
                  if (verbose) {
                        try { console.warn('[parity-sweep] ' + label + ':', diffs); } catch (e) {}
                  }
            }
      }

      SALE_DATES.forEach(function (sd) {
            DEPR_AMTS.forEach(function (depr) {
                  SALES.forEach(function (sale) {
                        CUSTODIANS.forEach(function (cust) {
                              FILING_STATES.forEach(function (fs) {
                                    RECOG_HORIZON.forEach(function (rh) {
                                          // Skip rec >= horizon (illegal)
                                          if (rh.rec >= rh.horizon) return;
                                          runOne(sd, depr, sale, cust, fs, rh);
                                    });
                              });
                        });
                  });
            });
      });

      return {
            scenariosRun: scenariosRun,
            perfectMatches: perfectMatches,
            deltasOverTolerance: deltasOverTolerance,
            tolerance: tolerance,
            maxDelta: maxDelta,
            failingCount: failingScenarios.length,
            failingScenarios: failingScenarios.slice(0, 20)   // first 20 for inspection
      };
}

if (typeof window !== 'undefined') {
      window.runEngineParitySweep = runEngineParitySweep;
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
