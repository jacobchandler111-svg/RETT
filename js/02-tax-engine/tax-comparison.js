// FILE: js/02-tax-engine/tax-comparison.js
// Side-by-side baseline vs. post-strategy tax. Per-year, multi-year aware.
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

function _baseScenarioForYear(cfg, yr, gainTakenThisYear) {
      // gainTakenThisYear is the long-term gain recognized in this year of
      // the structured sale. For single-year recommendations, year-1 gets
      // the full longTermGain. For multi-year, the engine spreads it.
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
      return {
            year: yr,
            status: cfg.filingStatus,
            state: cfg.state,
            ordinaryIncome: ordOverride,
            shortTermGain: shortOverride,
            longTermGain: ltAmt,
            qualifiedDividend: 0,
            // NIIT base = LT gain + ST gain + passive ordinary
            // (rental / non-qualified div / interest). Previously
            // ordinary investment income was missing here, understating
            // NIIT for real-estate-heavy clients.
            investmentIncome: ltAmt + Math.max(0, shortOverride) + _scaledInvOrd,
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
              investmentIncome: _inv, wages: _w,
              itemized: _itm });
      const stateTax = computeStateTax(
            _ord + _st + _lt + _qd,
            _yr, _state, _stat,
            { itemized: _itm, longTermGain: _lt });
      return {
            federal: Number(fed && fed.total) || 0,
            ordinaryTax: Number(fed && fed.ordinaryTax) || 0,
            ltTax: Number(fed && fed.ltTax) || 0,
            amt: Number(fed && fed.amtTopUp) || 0,
            niit: Number(fed && fed.niit) || 0,
            addlMedicare: Number(fed && fed.addlMedicare) || 0,
            state: Number(stateTax) || 0,
            total: (Number(fed && fed.total) || 0) + (Number(stateTax) || 0)
      };
}

function _applyLossesToScenario(scenario, lossAvailable) {
      // Brooklyn-generated losses are SHORT-TERM. IRS netting rules:
      //   1) Short-term loss first offsets short-term gain (netted at ST level).
      //   2) Net ST loss then offsets long-term gain dollar-for-dollar.
      //   3) Any remaining net loss offsets ordinary income, CAPPED at the
      //      §1211(b) annual limit ($3,000 / $1,500 MFS). Excess carries
      //      forward as STCL — modeled by setting _lossUnused so the
      //      caller can route it.
      const out = Object.assign({}, scenario);
      let loss = lossAvailable;

      // Step 1: against short-term gain
      const offsetShort = Math.min(out.shortTermGain || 0, loss);
      out.shortTermGain = (out.shortTermGain || 0) - offsetShort;
      loss -= offsetShort;

      // Step 2: against long-term gain (qualified div NOT a capital gain;
      // it's taxed at LTCG rates but loss netting only applies to actual gains)
      if (loss > 0) {
            const offsetLong = Math.min(out.longTermGain || 0, loss);
            out.longTermGain = (out.longTermGain || 0) - offsetLong;
            // investmentIncome should track LTG since NIIT applies to net inv income
            out.investmentIncome = Math.max(0, (out.investmentIncome || 0) - offsetLong);
            loss -= offsetLong;
      }

      // Step 3: against ordinary income, capped at §1211(b).
      // Without this cap the immediate path silently erased uncapped
      // amounts of ordinary income (including depreciation recapture
      // bumped in by structured-sale.js _scoreSchedule), inflating
      // savings by ≈ recapture × ~37%. The deferred-path equivalent
      // (_applyLossesWithSTCfCap) already applies this cap.
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
      const yfImpl = (typeof yearFractionRemaining === 'function' && cfg.implementationDate)
            ? yearFractionRemaining(cfg.implementationDate)
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
            const _stShortFlat = Math.max(0, cfg.baseShortTermGain || 0);
            const _totalLTFromCfg = Math.max(0,
                  (cfg.salePrice || 0) - (cfg.costBasis || 0)
                  - (cfg.acceleratedDepreciation || 0) - _stShortFlat);
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
      const _immediateLossRate = (function () {
            if (!_isImmediateLoop || _immediateCapital <= 0) return null;
            // Reuse the same Schwab combo / non-Schwab proxy curve the
            // deferred path uses (with B8's mid-year-start interpolation).
            const _yfImm = (typeof yearFractionRemaining === 'function' && cfg.implementationDate)
                  ? yearFractionRemaining(cfg.implementationDate) : 1;
            const _comboImm = (cfg.comboId && typeof getSchwabCombo === 'function')
                  ? getSchwabCombo(cfg.comboId) : null;
            if (_comboImm && Array.isArray(_comboImm.lossByYear)) {
                  var arrI = _comboImm.lossByYear;
                  return function (j) {
                        if (j <= 0) return (arrI[0] || 0) * _yfImm;
                        var prev = arrI[j - 1] || 0;
                        var curr = arrI[j] || 0;
                        return (1 - _yfImm) * prev + _yfImm * curr;
                  };
            }
            var lev = cfg.leverage || cfg.leverageCap || 2.25;
            var year1Rate = 0;
            if (typeof window.brooklynLossRateForLeverage === 'function') {
                  year1Rate = window.brooklynLossRateForLeverage(cfg.tierKey || 'beta1', lev);
            } else if (typeof brooklynInterpolate === 'function') {
                  var snap = brooklynInterpolate(cfg.tierKey || 'beta1', lev);
                  year1Rate = snap ? (snap.lossRate || 0) : 0;
            }
            var _refImm = (typeof window.SCHWAB_COMBOS === 'object' && window.SCHWAB_COMBOS.beta1_200_100)
                  ? window.SCHWAB_COMBOS.beta1_200_100.lossByYear
                  : [0.590, 0.492, 0.427, 0.393, 0.389, 0.376, 0.363, 0.351, 0.342, 0.334];
            var _refY1Imm = _refImm[0] || 1;
            return function (j) {
                  function shape(idx) {
                        var k = Math.min(_refImm.length - 1, Math.max(0, idx | 0));
                        return _refImm[k] / _refY1Imm;
                  }
                  if (j <= 0) return year1Rate * shape(0) * _yfImm;
                  var prev = year1Rate * shape(j - 1);
                  var curr = year1Rate * shape(j);
                  return (1 - _yfImm) * prev + _yfImm * curr;
            };
      })();
      // STCL carryforward across years for the immediate path. Y1's
      // unused loss past the recommendation's lossGenerated rolls into
      // Y2's available offset, which then offsets up to $3K of ordinary
      // income before further carryforward.
      let _stCfImmediate = 0;

      for (let i = 0; i < horizon; i++) {
            const yr = _y0 + i;
            let gainThisYear = 0;
            let lossThisYear = 0;

            if (_flatRec && _flatRec.recommendation === 'single-year') {
                  if (i === 0) {
                        gainThisYear = _flatRec.longTermGain || 0;
                        lossThisYear = _flatRec.lossGenerated || 0;
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

            const baseline = _baseScenarioForYear(cfg, yr, gainThisYear);
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
            rows.push({
                  year: yr,
                  gainRecognized: gainThisYear,
                  lossApplied: withStrat._lossUsed || 0,
                  lossGenerated: lossThisYear,
                  stCarryForward: _isImmediateLoop ? _stCfImmediate : 0,
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
      let totalBaseline = 0, totalWith = 0, totalBrookhaven = 0;
      rows.forEach(r => {
            totalBaseline += r.baseline.total;
            totalWith += r.withStrategy.total;
            totalBrookhaven += (r.brookhavenFee || 0);
      });
      return {
            rows: rows,
            totalBaseline: totalBaseline,
            totalWithStrategy: totalWith,
            totalSavings: totalBaseline - totalWith,
            totalBrookhavenFees: totalBrookhaven
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

      // Step 1: ST gain (none expected in deferred scenarios but kept for safety).
      const offsetShort = Math.min(out.shortTermGain || 0, loss);
      out.shortTermGain = (out.shortTermGain || 0) - offsetShort;
      loss -= offsetShort;

      // Step 2: LT gain (the recognized property gain in year R).
      if (loss > 0) {
            const offsetLong = Math.min(out.longTermGain || 0, loss);
            out.longTermGain = (out.longTermGain || 0) - offsetLong;
            out.investmentIncome = Math.max(0, (out.investmentIncome || 0) - offsetLong);
            loss -= offsetLong;
      }

      // Step 3: ordinary income, capped at $3,000 (or $1,500 for MFS).
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
      // Short-term gain (carved from the property sale) reduces the LT
      // bucket — it's taxed at ordinary rates and tracked separately.
      const stShort = Math.max(0, cfg.baseShortTermGain || 0);
      const ltGain = Math.max(0, (cfg.salePrice || 0) - (cfg.costBasis || 0) - (cfg.acceleratedDepreciation || 0) - stShort);
      const recapture = Math.max(0, cfg.acceleratedDepreciation || 0);
      const fromSale = (cfg.salePrice || 0) > 0 && basis > 0
            ? (basis + ltGain + recapture + stShort)
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
      const rows = [];
      for (let i = 0; i < horizon; i++) {
            const year = year1 + i;
            const baseline = _baseScenarioForYear(cfg, year, 0);
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

function computeDeferredTaxComparison(cfg) {
      // Below-min lifecycle check: if the position can never legally
      // open over the horizon (basis + total gain proceeds < custodian
      // min, OR cfg.investment alone < min and no sale), return a
      // zeroed result so the dashboard / ribbon / narrative all show
      // "no engagement" rather than fabricated Brooklyn math.
      if (_belowMinForLifecycle(cfg)) return _zeroDeferredComparison(cfg);
      const horizon = Math.max(1, cfg.horizonYears || cfg.years || 5);
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
      const stShortDef = Math.max(0, cfg.baseShortTermGain || 0);
      const totalLT = Math.max(0,
            (cfg.salePrice || 0) - (cfg.costBasis || 0) - (cfg.acceleratedDepreciation || 0) - stShortDef);
      const recapture = Math.max(0, cfg.acceleratedDepreciation || 0);
      // For MVP we treat the recapture as part of the deferred LT bucket so
      // the math reflects a structured sale that defers the entire gain
      // recognition. (Recapture is technically ordinary-rate income; this
      // is a known approximation flagged in the UI.)
      const totalGainBucket = totalLT + recapture;
      const basisCash = Math.max(0, cfg.costBasis || 0);

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
                  var lev = cfg.leverage || cfg.leverageCap || 2.25;
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
                  var snap = brooklynInterpolate(cfg.tierKey || 'beta1', cfg.leverage || cfg.leverageCap || 2.25);
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
      const _yfTranche = (typeof yearFractionRemaining === 'function' && cfg.implementationDate)
            ? yearFractionRemaining(cfg.implementationDate)
            : 1;
      const lossRateForTrancheYear = (function () {
            // Schwab combos carry a year-by-year tranche curve — keep it.
            if (combo && Array.isArray(combo.lossByYear)) {
                  var arrS = combo.lossByYear;
                  return function (j) {
                        if (j <= 0) return (arrS[0] || 0) * _yfTranche;
                        var prev = arrS[j - 1] || 0;
                        var curr = arrS[j] || 0;
                        return (1 - _yfTranche) * prev + _yfTranche * curr;
                  };
            }
            // Non-Schwab path: start from the per-tier regression (Y1
            // rate) then taper Y2+ using the Schwab Beta 1 200/100
            // decay shape as a proxy. Brooklyn's published rate cards
            // don't break out year-by-year for non-Schwab custodians;
            // assuming a flat rate forever overstates losses past Y1
            // because real positions taper as gains crystallize and
            // the position rebalances.
            var lev = cfg.leverage || cfg.leverageCap || 2.25;
            var year1Rate = 0;
            if (typeof window.brooklynLossRateForLeverage === 'function') {
                  year1Rate = window.brooklynLossRateForLeverage(cfg.tierKey || 'beta1', lev);
            } else if (typeof brooklynInterpolate === 'function') {
                  var snap = brooklynInterpolate(cfg.tierKey || 'beta1', lev);
                  year1Rate = snap ? (snap.lossRate || 0) : 0;
            }
            // Schwab Beta 1 200/100 lossByYear (canonical decay shape).
            var _schwabRef = (typeof window.SCHWAB_COMBOS === 'object' && window.SCHWAB_COMBOS.beta1_200_100)
                  ? window.SCHWAB_COMBOS.beta1_200_100.lossByYear
                  : [0.590, 0.492, 0.427, 0.393, 0.389, 0.376, 0.363, 0.351, 0.342, 0.334];
            var _refY1 = _schwabRef[0] || 1;
            return function (j) {
                  // Decay shape derived from Schwab Beta 1 200/100 ratios,
                  // applied to this tier's year-1 regression rate. Same
                  // mid-year-start interpolation as the Schwab branch.
                  function _shape(idx) {
                        var k = Math.min(_schwabRef.length - 1, Math.max(0, idx | 0));
                        return _schwabRef[k] / _refY1;
                  }
                  if (j <= 0) return year1Rate * _shape(0) * _yfTranche;
                  var prev = year1Rate * _shape(j - 1);
                  var curr = year1Rate * _shape(j);
                  return (1 - _yfTranche) * prev + _yfTranche * curr;
            };
      })();

      // Tranche state. tranches[k] = { capital, startIdx } where startIdx is
      // the cfg-relative year (0 = year1).
      const tranches = [];
      if (basisCash > 0) tranches.push({ capital: basisCash, startIdx: 0 });

      let stCF = 0;
      let gainRemaining = totalGainBucket;
      const rows = [];
      const recognitionSchedule = [];

      // Brookhaven advisory wrap fees: $45K setup (Year 1) + $2K/qtr
      // for 8 quarters, with Year-1 quarterly fees pro-rated by entry
      // date. Surfaced as a separate fee line so the advisor can show
      // the all-in cost transparently.
      const yfImpl = (typeof yearFractionRemaining === 'function' && cfg.implementationDate)
            ? yearFractionRemaining(cfg.implementationDate)
            : 1;
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
            let existingLoss = 0;
            let existingFee = 0;
            let existingInvested = 0;
            tranches.forEach(function (t) {
                  const trancheAge = i - t.startIdx;
                  if (trancheAge < 0) return;
                  existingLoss += t.capital * lossRateForTrancheYear(trancheAge);
                  existingFee += t.capital * feeRate;
                  existingInvested += t.capital;
            });

            // Step 2 — decide gain to recognize this year. Gain proceeds
            // are received Jan 1 of year R and reinvested same year, so
            // the new tranche generates fresh year-1 losses in year R
            // alongside the existing tranches' year-N losses. The max
            // recognizable gain therefore solves:
            //     G ≤ stCF + existingLoss + G * year1Rate
            // i.e. G ≤ (stCF + existingLoss) / (1 - year1Rate).
            // Final-year fallback: recognize any remaining gain even if
            // it can't be fully offset.
            const year1Rate = lossRateForTrancheYear(0);
            const denom = Math.max(0.001, 1 - year1Rate);
            let gainRecThisYear = 0;
            if (i >= startIdx && i <= maturityIdx && gainRemaining > 0) {
                  const maxAbsorbable = (stCF + existingLoss) / denom;
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

            // Step 3 — push the new tranche (immediate same-year reinvestment).
            if (gainRecThisYear > 0) {
                  tranches.push({ capital: gainRecThisYear, startIdx: i });
            }

            // Step 4 — recompute year totals INCLUDING the new tranche.
            const newTrancheLoss = gainRecThisYear * year1Rate;
            const newTrancheFee = gainRecThisYear * feeRate;
            const yearLoss = existingLoss + newTrancheLoss;
            const yearFee = existingFee + newTrancheFee;
            const yearInvested = existingInvested + gainRecThisYear;

            recognitionSchedule.push({ year: year, gainRecognized: gainRecThisYear });

            const baseline = _baseScenarioForYear(cfg, year, gainRecThisYear);
            const baselineTax = _yearTaxes(baseline);

            // "Do nothing" baseline for the bar chart: if the client took
            // no action at all, the entire property gain (LT bucket + ST
            // gain) hits Year 1 as a lump sum. Year 2+ baseline is just
            // ordinary income, no property gain. This is what the chart
            // visualizes against the planned with-strategy bars so the
            // visceral story — "without planning you owe $X in Y1" — is
            // honest. KPI / details / ribbon still use `baseline` (the
            // matched-timing apples-to-apples comparison).
            const dnBaseline = _baseScenarioForYear(cfg, year, i === 0 ? totalGainBucket : 0);
            if (i !== 0) dnBaseline.shortTermGain = 0;
            // Recompute investmentIncome to match the do-nothing LT/ST.
            dnBaseline.investmentIncome =
                  (dnBaseline.longTermGain || 0) + Math.max(0, dnBaseline.shortTermGain || 0);
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

      let totalBaseline = 0, totalWith = 0, totalFees = 0, totalBrookhaven = 0;
      rows.forEach(function (r) {
            totalBaseline += r.baseline.total;
            totalWith += r.withStrategy.total;
            totalFees += r.fee;
            totalBrookhaven += (r.brookhavenFee || 0);
      });

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

      const fedRows = comparison.rows.map(r => '<td>' + _fmtUSD(r.baseline.federal) + '</td>').join('');
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
            '<tr><td>Federal tax</td>' + fedRows + '<td>' + _fmtUSD(comparison.rows.reduce((a,r)=>a+r.baseline.federal,0)) + '</td></tr>' +
            '<tr><td>State tax</td>' + stRows + '<td>' + _fmtUSD(comparison.rows.reduce((a,r)=>a+r.baseline.state,0)) + '</td></tr>' +
            '<tr><td>NIIT (3.8%)</td>' + niitRow + '<td>' + _fmtUSD(comparison.rows.reduce((a,r)=>a+r.baseline.niit,0)) + '</td></tr>' +
            '<tr><td>Additional Medicare (0.9%)</td>' + medRow + '<td>' + _fmtUSD(comparison.rows.reduce((a,r)=>a+r.baseline.addlMedicare,0)) + '</td></tr>' +
            '<tr class="row-total"><td><strong>Total tax (baseline)</strong></td>' + cellsBaseline + '<td><strong>' + _fmtUSD(comparison.totalBaseline) + '</strong></td></tr>' +
            '<tr class="grp-head"><td colspan="' + (comparison.rows.length + 2) + '">With Brooklyn Strategy</td></tr>' +
            '<tr class="row-total"><td><strong>Total tax (with strategy)</strong></td>' + cellsWith + '<td><strong>' + _fmtUSD(comparison.totalWithStrategy) + '</strong></td></tr>' +
            '<tr class="row-savings"><td><strong>Tax savings</strong></td>' + cellsSavings + '<td><strong>' + _fmtUSD(comparison.totalSavings) + '</strong></td></tr>' +
            '</tbody></table>';
}
