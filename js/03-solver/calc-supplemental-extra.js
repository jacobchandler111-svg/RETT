// FILE: js/03-solver/calc-supplemental-extra.js
// Calc modules for the placeholder-rail supplemental strategies.
// One function per registered id; each computes
//   { netBenefit, investment, marginalRate, detail }
// and writes to window.__rettSupplementalExtra[id].lastResult so
// the registry accessors and the Page-4 "See Value" button pick it
// up automatically (no other plumbing edits needed).
//
// Active strategies (post-trim 2026-05-06): ptet, charitableGifts.
// The other six (412(e)(3), QBI, R&D, 401(h), Solar ITC, Film §181)
// were removed because they either happen automatically (QBI) or
// come up too rarely in typical sale-and-transition advisory work.
// QCD was repurposed into Charitable Gifts (broader §170 model).

(function (root) {
  'use strict';

  // ----------------------------------------------------------------
  // Helpers
  // ----------------------------------------------------------------

  function _num(v) { var n = Number(v); return Number.isFinite(n) ? n : 0; }

  // Read the latest cfg from the existing inputs collector. Returns
  // null when the form isn't ready yet (engine self-test phase, etc.)
  // — calc functions early-out on null so a load-time race never
  // poisons lastResult with a fake value.
  function _cfg() {
    if (typeof root.collectInputs !== 'function') return null;
    try { return root.collectInputs(); } catch (e) { return null; }
  }

  // Federal marginal rate via a $1,000 delta against the live tax
  // engine. Falls back to 37% (top bracket — the target client
  // segment). Caller decides whether to add state / NIIT.
  // baseOverride lets the caller probe the marginal at a specific
  // ordinary-income level (e.g., Y0-with-recap vs Y1+-without-recap).
  function _fedMarginalAt(cfg, baseOverride) {
    if (!cfg) return 0.37;
    if (typeof root.computeFederalTax !== 'function') return 0.37;
    var year   = cfg.year1 || (new Date()).getFullYear();
    var status = cfg.filingStatus || 'mfj';
    var base   = (baseOverride != null) ? Math.max(0, _num(baseOverride))
                                        : _num(cfg.baseOrdinaryIncome);
    var delta  = 1000;
    try {
      var t0 = root.computeFederalTax(base, year, status) || 0;
      var t1 = root.computeFederalTax(base + delta, year, status) || 0;
      var rate = (t1 - t0) / delta;
      if (rate < 0.10 || rate > 0.50) return 0.37;
      return rate;
    } catch (e) { return 0.37; }
  }
  function _fedMarginal(cfg) { return _fedMarginalAt(cfg, null); }

  // State marginal rate via the engine's computeStateTax. Defaults
  // to 5% when state == NONE / engine missing — reasonable HNW
  // assumption.
  function _stateMarginalAt(cfg, baseOverride) {
    if (!cfg) return 0.05;
    var state = cfg.state;
    if (!state || state === 'NONE') return 0;
    if (typeof root.computeStateTax !== 'function') return 0.05;
    var year   = cfg.year1 || (new Date()).getFullYear();
    var status = cfg.filingStatus || 'mfj';
    var base   = (baseOverride != null) ? Math.max(0, _num(baseOverride))
                                        : _num(cfg.baseOrdinaryIncome);
    var delta  = 1000;
    try {
      var t0 = root.computeStateTax(base,         year, state, status) || 0;
      var t1 = root.computeStateTax(base + delta, year, state, status) || 0;
      var rate = (t1 - t0) / delta;
      if (rate < 0 || rate > 0.20) return 0.05;
      return rate;
    } catch (e) { return 0.05; }
  }
  function _stateMarginal(cfg) { return _stateMarginalAt(cfg, null); }

  // Y0 ordinary-income pool available to absorb a one-time deduction.
  // base W-2/SE/biz income + §1250 recapture (taxed at ordinary rates
  // in the year of sale). Deductions beyond this pool create an NOL
  // that has no immediate tax benefit, and NOL carry-forward isn't
  // modeled in the supplemental engine. Returning 0 means "no cap" —
  // callers should fall back to the raw deduction in that case.
  function _ordIncomePoolY0(cfg) {
    if (!cfg) return 0;
    return Math.max(0,
      _num(cfg.baseOrdinaryIncome) +
      _num(cfg.acceleratedDepreciation)
    );
  }
  function _capDeductionAtOrdPool(cfg, deductionRaw) {
    var pool = _ordIncomePoolY0(cfg);
    if (pool > 0 && deductionRaw > pool) return pool;
    return deductionRaw;
  }

  // QBI applicability shorthand: if the deduction reduces flow-
  // through ordinary income that would otherwise generate a §199A
  // deduction, the net benefit shrinks by ~20% × marginal rate.
  // Conservative default is "applies" since the audit clients are
  // primarily pass-through owners; toggle off via cfg.noQbi if a
  // future flag is added.
  function _qbiHaircut(cfg) {
    if (cfg && cfg.noQbi) return 0;
    return 0.20;
  }

  // Read the per-strategy state object owned by
  // supplemental-extra-render.js. Always returns an object; never
  // throws — calc fns guard their own field reads.
  function _state(id) {
    var s = root.__rettSupplementalExtra;
    return (s && s[id]) || {};
  }

  function _writeResult(id, result) {
    if (!root.__rettSupplementalExtra) root.__rettSupplementalExtra = {};
    if (!root.__rettSupplementalExtra[id]) root.__rettSupplementalExtra[id] = {};
    root.__rettSupplementalExtra[id].lastResult = result;
  }

  // PTET top rates by state (2026, from spec table). Used to auto-
  // populate the user's stateRate default when their cfg.state has
  // a PTET regime — they can still override. States not in this map
  // either have no PTET regime (TX, FL, WY, NV, WA, AK, SD, TN, NH)
  // or weren't promulgated; user must enter manually.
  var PTET_RATES_2026 = {
    AL: 5.0, AZ: 2.5, AR: 4.4, CA: 9.3, CO: 4.4, CT: 6.99, GA: 5.19,
    HI: 11.0, ID: 5.695, IL: 4.95, IN: 3.05, IA: 5.7, KS: 5.7,
    KY: 4.0, LA: 4.25, ME: 7.15, MD: 8.95, MA: 5.0, MI: 4.25,
    MS: 4.7, MO: 4.7, MT: 5.9, NE: 5.84, NJ: 10.9, NM: 5.9,
    NY: 10.9, NC: 4.5, OH: 3.0, OK: 4.75, OR: 9.9, RI: 5.99,
    SC: 6.4, UT: 4.5, VA: 5.75, WV: 5.12, WI: 7.65
  };

  // ----------------------------------------------------------------
  // Strategy 1 — Pass-Through Entity Tax (PTET)
  //
  // Federal benefit ≈ federal marginal × PTET × (1 − 0.20 × QBI),
  // minus the value of the SALT cap headroom forfeited (when the
  // owner had unused individual SALT capacity that could have
  // covered the same state liability).
  //
  // State side: typically a wash because the owner gets a state-
  // level credit for the PTET paid. MA is the notable exception
  // (90% credit per spec) — modeled via creditPct < 100, in which
  // case the owner forfeits (1 − creditPct) × PTET on the state
  // side, valued at the state marginal.
  //
  // Future refinements: MAGI-based SALT cap phase-down ($505K joint
  // MAGI threshold, 30% reduction, $10K floor), residency credit
  // nuance.
  //
  // RIVALRY: investment = 0 (PTET is a tax payment from existing
  // pass-through income, not a discretionary dollar competing with
  // sale-proceed capital).
  // ----------------------------------------------------------------
  function _calcPtet() {
    var cfg = _cfg(); if (!cfg) return _writeResult('ptet', null);
    var st = _state('ptet');
    var income = Math.max(0, _num(st.taxableIncome));
    var rate = Math.max(0, _num(st.stateRate)) / 100;
    if (rate <= 0 && cfg.state && PTET_RATES_2026[cfg.state] != null) {
      rate = PTET_RATES_2026[cfg.state] / 100;
    }
    if (income <= 0 || rate <= 0) return _writeResult('ptet', null);

    var ptet = income * rate;
    var qbi     = _qbiHaircut(cfg);
    var saltCap = Math.max(0, _num(st.saltCapacityRemaining));
    var creditPct = Math.max(0, Math.min(100, _num(st.creditPct) || 100)) / 100;
    var annualRecurring = !!st.annualRecurring;

    // Per-year marginal rates. Y0 has the §1250 recap added to the
    // ordinary baseline (sale year), pushing the federal bracket up.
    // Y1+ revert to the W-2 / pass-through baseline alone.
    var baseOrd = _num(cfg.baseOrdinaryIncome);
    var recap = _num(cfg.depreciationRecapture || cfg.acceleratedDepreciation || cfg.recap || 0);
    var fedY0   = _fedMarginalAt(cfg, baseOrd + recap);
    var stY0    = _stateMarginalAt(cfg, baseOrd + recap);
    var fedRest = _fedMarginalAt(cfg, baseOrd);
    var stRest  = _stateMarginalAt(cfg, baseOrd);

    // Per-year net benefit composition (federal — QBI haircut — SALT
    // opportunity cost — state-credit slippage). The QBI / SALT /
    // credit-slippage factors are rate-dependent so we compute them
    // separately for Y0 and rest.
    function _ptetNet(fed, stR) {
      var fedBenefit     = fed * ptet * (1 - qbi);
      var saltForfeit    = Math.min(saltCap, ptet) * fed;
      var creditSlippage = ptet * (1 - creditPct) * stR;
      return { fedBenefit: fedBenefit, saltForfeit: saltForfeit,
               creditSlippage: creditSlippage,
               net: fedBenefit - saltForfeit - creditSlippage };
    }
    var y0  = _ptetNet(fedY0,  stY0);
    var rest= _ptetNet(fedRest,stRest);

    // Annual-recurring multiplier: when toggled on AND strategy is
    // multi-year (B/C), PTET continues each recognition year. Y0 uses
    // the recap-pushed marginal; Y1+ use the no-recap marginal.
    var yearCount = annualRecurring ? _strategyYearCount(cfg) : 1;
    var netBenefit = y0.net + rest.net * Math.max(0, yearCount - 1);

    _writeResult('ptet', {
      netBenefit: Math.max(0, Math.round(netBenefit)),
      investment: 0,             // not invested capital — tax payment
      marginalRate: fedY0,
      detail: {
        ptetPaid:        Math.round(ptet),
        ptetRate:        rate,
        annualRecurring: annualRecurring,
        yearCount:       yearCount,
        // ACTION: PTET deducts the entity-level state-tax payment from
        // K-1 ordinary income. The mechanism IS an ord offset, just
        // routed through the entity. Same $ value Y0 vs Y1+ since PTET
        // amount doesn't change with the sale.
        ordOffsetY0:           Math.round(ptet),
        ordOffsetRestPerYear:  Math.round(ptet),
        // RESULT: tax dollars saved per year (federal benefit minus SALT
        // forfeiture minus credit slippage; QBI haircut applied).
        taxSavingsY0:          Math.round(y0.net),
        taxSavingsRestPerYear: Math.round(rest.net),
        // Detail breakdown for the Y0 calculation.
        fedBenefit:      Math.round(y0.fedBenefit),
        saltForfeit:     Math.round(y0.saltForfeit),
        creditSlippage:  Math.round(y0.creditSlippage),
        marginalY0:      fedY0 + stY0,
        marginalRest:    fedRest + stRest
      }
    });
  }

  // ----------------------------------------------------------------
  // Strategy 2 — Charitable Gifts (§170)
  //
  // Three pathways:
  //   cash         — deductible up to 60% of AGI; benefit = gift × fed
  //   appreciated  — deductible at FMV up to 30% of AGI; AND avoids
  //                  capital-gains tax on the appreciation portion
  //                  (LT cap-gain rate ~ 23.8% incl. NIIT for HNW)
  //   daf          — same percentage cap as cash (60% AGI), same
  //                  federal deduction value
  //
  // OBBBA 2026 caveats noted but not yet modeled:
  //   - 0.5%-of-AGI floor on itemized charitable contributions
  //   - 35% effective benefit cap for top-bracket itemizers (§68)
  //   - Non-itemizer above-the-line $1K/$2K MFJ cash-charity deduction
  // These shave ~5-10% off the headline benefit; the calc returns
  // the gross value and surfaces the AGI cap status in result.detail
  // so the advisor can apply the floor manually when relevant.
  //
  // RIVALRY: investment = 0 (charitable gift leaves the estate but
  // doesn't compete with Brooklyn for sale-proceed capital — it's
  // tax-side, not an investment).
  // ----------------------------------------------------------------
  // Year count for a multi-year deduction. Returns 1 when the strategy
  // is single-year (A) or no strategy is chosen. For B/C, mirrors the
  // _yearCountForSaleStrategy priority in supplemental-render.js so the
  // charitable annual-giving multiplier matches the O&G/Delphi
  // recognition window: auto-pick result first (when enabled), then
  // form/cfg, then 36-month minimum.
  function _strategyYearCount(cfg) {
    var chosen = root.__rettChosenStrategy;
    if (chosen === 'A') return 1;
    if (chosen === 'B') return 2;
    if (chosen === 'C') {
      var autoPickOn = (typeof root.__rettAutoPickEnabled === 'undefined') ||
                       root.__rettAutoPickEnabled !== false;
      var lastDur = (root.__lastResult && root.__lastResult.config &&
                     Number(root.__lastResult.config.structuredSaleDurationMonths)) || 0;
      var cfgDur  = (cfg && Number(cfg.structuredSaleDurationMonths)) || 0;
      var months;
      if (autoPickOn && lastDur > 0)      months = lastDur;
      else if (cfgDur > 0)                months = cfgDur;
      else if (lastDur > 0)               months = lastDur;
      else                                months = 36;
      var yrs = Math.max(1, Math.ceil((months + 6) / 12));
      return Math.min(yrs, 7);  // match YEAR_HARD_CAP in supplemental-render
    }
    return 1;
  }

  function _calcCharitableGifts() {
    var cfg = _cfg(); if (!cfg) return _writeResult('charitableGifts', null);
    var st = _state('charitableGifts');
    var amount = Math.max(0, _num(st.giftAmount));
    if (amount <= 0) return _writeResult('charitableGifts', null);

    var giftType = st.giftType || 'cash';
    var apprec   = Math.max(0, _num(st.appreciation));
    var agi      = Math.max(0, _num(st.agi));
    var annual   = !!st.annualGiving;

    // Per-year marginal rates. Y0 (the sale year) has §1250 recap
    // pushing the client into a higher ordinary bracket — a $1 charitable
    // deduction in Y0 is worth more than the same $1 deduction in Y1+
    // (where the baseline reverts to W-2 / SE / pass-through only).
    // baseOrd is what _fedMarginal/_stateMarginal probe by default.
    var baseOrd = _num(cfg.baseOrdinaryIncome);
    var recap = _num(cfg.depreciationRecapture || cfg.acceleratedDepreciation || cfg.recap || 0);
    var marginalY0   = _fedMarginalAt(cfg, baseOrd + recap) +
                       _stateMarginalAt(cfg, baseOrd + recap);
    var marginalRest = _fedMarginalAt(cfg, baseOrd) +
                       _stateMarginalAt(cfg, baseOrd);

    // §170 percentage cap by gift type. When agi is provided, cap
    // the deductible amount; otherwise honor the user-entered amount
    // (5-yr carryover is automatic for excess so the long-run
    // benefit is not lost — flag in detail when capped).
    var pctCap = (giftType === 'appreciated') ? 0.30 : 0.60;
    var hardCap = (agi > 0) ? agi * pctCap : Infinity;
    var deductibleAmount = Math.min(amount, hardCap);

    // Appreciated-asset bonus is rate-independent (LT cap-gain rate is
    // ~23.8% blended regardless of the year's ordinary bracket).
    var apprecDeductible = (giftType === 'appreciated' && apprec > 0 && amount > 0)
      ? deductibleAmount * (apprec / amount) : 0;
    var capGainPerYear = apprecDeductible * 0.238;

    // Annual giving: when the toggle is on AND the chosen sale strategy
    // is multi-year (B/C), the deduction repeats each recognition year.
    // Y0 uses marginalY0 (ord + recap baseline); Y1+ use marginalRest.
    var yearCount = annual ? _strategyYearCount(cfg) : 1;
    var deductionY0 = deductibleAmount * marginalY0;
    var deductionRest = deductibleAmount * marginalRest;
    // Y0 is always one of the years (gift starts in sale year). Years
    // 2..yearCount use the no-recap marginal.
    var deductionValue = deductionY0 + deductionRest * Math.max(0, yearCount - 1);
    var capGainAvoided = capGainPerYear * yearCount;

    var netBenefit = deductionValue + capGainAvoided;
    _writeResult('charitableGifts', {
      netBenefit: Math.round(netBenefit),
      investment: 0,            // gift, not investment — no rivalry
      marginalRate: marginalY0,  // headline rate is the Y0 rate (sale year)
      detail: {
        giftAmount:       Math.round(amount),
        giftType:         giftType,
        deductibleAmount: Math.round(deductibleAmount),
        deductionValue:   Math.round(deductionValue),  // total tax savings (legacy name; kept)
        capGainAvoided:   Math.round(capGainAvoided),
        agiCapApplied:    deductibleAmount < amount,
        pctCap:           pctCap,
        annualGiving:     annual,
        yearCount:        yearCount,
        // ACTION: ordinary income offset — the actual deductible $
        // applied each year. Constant across years (gift is the same
        // each year on annual giving). Tab 7 reads these for the
        // "Ordinary income offset" line.
        ordOffsetY0:           Math.round(deductibleAmount),
        ordOffsetRestPerYear:  Math.round(deductibleAmount),
        // RESULT: tax dollars saved per year. Y0 uses the recap-pushed
        // marginal (top bracket in the sale year); Y1+ uses the no-recap
        // marginal (W-2-only baseline).
        taxSavingsY0:          Math.round(deductionY0),
        taxSavingsRestPerYear: Math.round(deductionRest),
        marginalY0:       marginalY0,
        marginalRest:     marginalRest
      }
    });
  }

  // ----------------------------------------------------------------
  // CALC REGISTRY — one entry per supplemental strategy id. Adding a
  // new strategy is a single-line addition here once its math is
  // written (see "Activation contract" in supplemental-extra-
  // registry.js for the full 2-file workflow).
  //
  // Each calc fn:
  //   - reads cfg via _cfg() and per-strategy state via _state(id)
  //   - computes { netBenefit, investment, marginalRate, detail }
  //   - writes via _writeResult(id, result) — null for ineligible
  //
  // Placeholder slots (slot05 .. slot11) intentionally have NO calc
  // entry. That keeps lastResult = null → registry returns null
  // result → UI shows "Math pending". When a slot activates, just
  // append `_CALCS.slotNN = function () { ... };` and the strategy
  // is fully wired into the rivalry / hero / See Value pipeline.
  // ----------------------------------------------------------------
  // ----------------------------------------------------------------
  // Strategy slot05 — Cost Segregation Study
  // Year-1 deduction = (cost - land) × accelPct × 100% bonus
  //   + shell × MACRS yr1 factor (~2.56% mid-month avg for 39-yr)
  // netBenefit = total deduction × (fed + state)
  // investment = purchasePrice IF newlyAcquired, else 0
  // ----------------------------------------------------------------
  var COST_SEG_PCT = {
    apartment: 0.25, hotel: 0.30, office: 0.22, retail: 0.26,
    industrial: 0.35, restaurant: 0.35, medical: 0.30,
    selfStorage: 0.35, shortTerm: 0.30
  };
  function _calcCostSeg() {
    var cfg = _cfg(); if (!cfg) return _writeResult('slot05', null);
    var st = _state('slot05');
    var cost = Math.max(0, _num(st.purchasePrice));
    if (cost <= 0) return _writeResult('slot05', null);
    var landPct = Math.min(0.5, Math.max(0, _num(st.landPct) / 100));
    var depreciableBasis = cost * (1 - landPct);
    var accelPct = COST_SEG_PCT[st.propertyType] || 0.25;
    var year1Accel = depreciableBasis * accelPct;
    var shellBasis = depreciableBasis * (1 - accelPct);
    var shellYr1 = shellBasis * 0.0256;
    var totalDeduction = year1Accel + shellYr1;
    var marginal = _fedMarginal(cfg) + _stateMarginal(cfg);
    var netBenefit = totalDeduction * marginal;
    _writeResult('slot05', {
      netBenefit: Math.max(0, Math.round(netBenefit)),
      investment: st.newlyAcquired ? Math.round(cost) : 0,
      marginalRate: marginal,
      detail: {
        depreciableBasis: Math.round(depreciableBasis),
        accelPct: accelPct,
        year1Deduction: Math.round(totalDeduction)
      }
    });
  }

  // ----------------------------------------------------------------
  // Strategy slot06 — Heavy Vehicle (G-Wagon)
  // SUV-heavy: §179 capped at $32,000; residual at 100% bonus
  // Heavy pickup / cargo van / >14,000 lb: full §179 + bonus residual
  // Light passenger: §280F luxury cap $20,300 yr1 (with bonus)
  // ----------------------------------------------------------------
  function _calcHeavyVehicle() {
    var cfg = _cfg(); if (!cfg) return _writeResult('slot06', null);
    var st = _state('slot06');
    var cost = Math.max(0, _num(st.vehicleCost));
    if (cost <= 0) return _writeResult('slot06', null);
    var bizUse = Math.min(1, Math.max(0, _num(st.bizUsePct) / 100));
    var bizBasis = cost * bizUse;
    var cls = st.vehicleClass || 'suvHeavy';
    var yr1Deduction = 0;
    var method;
    if (bizUse > 0.50) {
      // Predominant-use path: §179 + 100% bonus on residual.
      if (cls === 'lightAuto') {
        yr1Deduction = Math.min(bizBasis, 20300);
        method = '§280F luxury cap (with bonus)';
      } else if (cls === 'suvHeavy') {
        var sec179 = Math.min(bizBasis, 32000);
        yr1Deduction = sec179 + (bizBasis - sec179);
        method = '§179 cap $32K + 100% bonus on residual';
      } else {
        var sec179f = Math.min(bizBasis, 2560000);
        yr1Deduction = sec179f + (bizBasis - sec179f);
        method = '§179 + 100% bonus';
      }
    } else {
      // §280F(b)(1): predominant-use failed → ADS straight-line over
      // the recovery period for the asset class. 5 years is the §168(g)
      // recovery period for autos and light trucks; we use 5 years for
      // all sub-50%-biz vehicle classes since they're all 5-year MACRS
      // assets defaulting to ADS at the same recovery period when biz
      // use fails predominant. Statute does NOT permit zeroing — IRC
      // §280F(b)(1) "the deduction allowable shall be determined under
      // section 168(g)". Light passenger autos still subject to §280F(a)
      // luxury cap, which uses the no-bonus Yr1 number ($12,300 in 2026
      // per Rev Proc) at the smaller no-bonus rate.
      yr1Deduction = bizBasis / 5;
      method = 'ADS straight-line (§280F(b)(1) — predominant-use failed)';
      if (cls === 'lightAuto') {
        yr1Deduction = Math.min(yr1Deduction, 12300);
      }
    }
    var marginal = _fedMarginal(cfg) + _stateMarginal(cfg);
    var yr1DeductionRaw = yr1Deduction;
    yr1Deduction = _capDeductionAtOrdPool(cfg, yr1Deduction);
    _writeResult('slot06', {
      netBenefit: Math.max(0, Math.round(yr1Deduction * marginal)),
      investment: 0,
      assetCost: Math.round(cost),
      marginalRate: marginal,
      detail: {
        yr1Deduction: Math.round(yr1Deduction),
        yr1DeductionUncapped: Math.round(yr1DeductionRaw),
        deductionCappedByOrdPool: yr1DeductionRaw > yr1Deduction,
        ordIncomePool: Math.round(_ordIncomePoolY0(cfg)),
        bizUse: bizUse,
        vehicleClass: cls,
        assetCost: Math.round(cost),
        method: method
      }
    });
  }

  // ----------------------------------------------------------------
  // Strategy slot07 — Equipment Leasing Fund
  // Year-1 K-1 loss = investment × depreciablePct × 100% bonus
  // Non-passive only if material participation (Reg. §1.469-5T(a)).
  // §461(l) excess-business-loss cap not modeled (advisory layer).
  // ----------------------------------------------------------------
  function _calcEquipmentLeasing() {
    var cfg = _cfg(); if (!cfg) return _writeResult('slot07', null);
    var st = _state('slot07');
    var amount = Math.max(0, _num(st.investmentAmount));
    if (amount <= 0) return _writeResult('slot07', null);
    var deprPct = Math.min(1, Math.max(0, _num(st.depreciablePct) / 100));
    var yr1Loss = amount * deprPct;
    // Active-investor gate: 100 hours/year is the §469-5T(a)(3) test
    // ("the individual's participation constitutes substantially all
    // of the participation by all individuals"). The yes/no toggle
    // captures whether the client is willing to commit those hours;
    // without it the K-1 loss is passive and suspended (no net benefit).
    // (Field renamed from materialPart → commitHours per advisor
    // 2026-05-06; old saved cases with materialPart=true still pass
    // through via the back-compat read below.)
    var active = !!(st.commitHours || st.materialPart);
    var nonPassive = active ? yr1Loss : 0;
    var marginal = _fedMarginal(cfg) + _stateMarginal(cfg);
    _writeResult('slot07', {
      netBenefit: Math.max(0, Math.round(nonPassive * marginal)),
      investment: Math.round(amount),
      marginalRate: marginal,
      detail: {
        yr1Loss: Math.round(yr1Loss),
        nonPassive: Math.round(nonPassive),
        suspended: active ? 0 : Math.round(yr1Loss)
      }
    });
  }

  // ----------------------------------------------------------------
  // Strategy slot08 — Augusta Rule §280A(g)
  // businessRent = min(days, 14) × fmvPerDay
  // netBenefit = businessRent × marginal (deduct at entity, exclude at owner)
  // ----------------------------------------------------------------
  function _calcAugusta() {
    var cfg = _cfg(); if (!cfg) return _writeResult('slot08', null);
    var st = _state('slot08');
    var days = Math.min(14, Math.max(0, _num(st.daysRented)));
    var fmv = Math.max(0, _num(st.fmvPerDay));
    if (days <= 0 || fmv <= 0) return _writeResult('slot08', null);
    var businessRent = days * fmv;
    var annualRecurring = !!st.annualRecurring;

    // Per-year marginals (recap-pushed Y0 vs no-recap Y1+).
    var baseOrd = _num(cfg.baseOrdinaryIncome);
    var recap = _num(cfg.depreciationRecapture || cfg.acceleratedDepreciation || cfg.recap || 0);
    var marginalY0   = _fedMarginalAt(cfg, baseOrd + recap) + _stateMarginalAt(cfg, baseOrd + recap);
    var marginalRest = _fedMarginalAt(cfg, baseOrd)         + _stateMarginalAt(cfg, baseOrd);

    var yearCount = annualRecurring ? _strategyYearCount(cfg) : 1;
    var benY0   = businessRent * marginalY0;
    var benRest = businessRent * marginalRest;
    var netBenefit = benY0 + benRest * Math.max(0, yearCount - 1);

    _writeResult('slot08', {
      netBenefit: Math.max(0, Math.round(netBenefit)),
      investment: 0,
      marginalRate: marginalY0,
      detail: {
        days: days, fmv: fmv,
        businessRent: Math.round(businessRent),
        annualRecurring: annualRecurring,
        yearCount: yearCount,
        // ACTION: Augusta shifts businessRent from the entity to the
        // owner — the entity deducts it (ord offset to biz income), the
        // owner excludes it (§280A(g)). Net to the owner = rent ×
        // marginal. Constant amount per year (capped at 14 days × FMV).
        ordOffsetY0:           Math.round(businessRent),
        ordOffsetRestPerYear:  Math.round(businessRent),
        // RESULT: tax dollars saved per year.
        taxSavingsY0:          Math.round(benY0),
        taxSavingsRestPerYear: Math.round(benRest),
        marginalY0: marginalY0,
        marginalRest: marginalRest
      }
    });
  }

  // ----------------------------------------------------------------
  // Strategy slot09 — 401(k) + Profit-Sharing (2026 limits)
  // 415(c) cap $72,000; +$8,000 catch-up (50+); +$11,250 super (60-63)
  // Employer share ≤ 25% × eligible comp (cap $360,000)
  // ----------------------------------------------------------------
  function _calc401k() {
    var cfg = _cfg(); if (!cfg) return _writeResult('slot09', null);
    var st = _state('slot09');
    var comp = Math.max(0, _num(st.compensation));
    if (comp <= 0) return _writeResult('slot09', null);
    var age = _num(st.ownerAge);
    var compCapped = Math.min(comp, 360000);
    var elective = Math.min(compCapped, 24500);
    var catchup = (age >= 60 && age <= 63) ? 11250 : (age >= 50 ? 8000 : 0);
    var employer = Math.min(0.25 * compCapped, 25 * 360000 / 100);
    var cap415c = 72000 + catchup;
    var total = Math.min(elective + catchup + employer, cap415c);
    var annualRecurring = !!st.annualRecurring;

    // Per-year marginals (recap-pushed Y0 vs no-recap Y1+).
    var baseOrd = _num(cfg.baseOrdinaryIncome);
    var recap = _num(cfg.depreciationRecapture || cfg.acceleratedDepreciation || cfg.recap || 0);
    var marginalY0   = _fedMarginalAt(cfg, baseOrd + recap) + _stateMarginalAt(cfg, baseOrd + recap);
    var marginalRest = _fedMarginalAt(cfg, baseOrd)         + _stateMarginalAt(cfg, baseOrd);

    var yearCount = annualRecurring ? _strategyYearCount(cfg) : 1;
    var benY0   = total * marginalY0;
    var benRest = total * marginalRest;
    var netBenefit = benY0 + benRest * Math.max(0, yearCount - 1);

    _writeResult('slot09', {
      netBenefit: Math.max(0, Math.round(netBenefit)),
      investment: 0,
      marginalRate: marginalY0,
      detail: {
        elective: elective, catchup: catchup,
        employer: Math.round(employer), totalContribution: Math.round(total),
        annualRecurring: annualRecurring,
        yearCount: yearCount,
        // ACTION: 401(k) + profit-sharing reduces W-2 / SE income by
        // the total contribution each year (capped at §415(c)).
        ordOffsetY0:           Math.round(total),
        ordOffsetRestPerYear:  Math.round(total),
        // RESULT: tax dollars saved per year.
        taxSavingsY0:          Math.round(benY0),
        taxSavingsRestPerYear: Math.round(benRest),
        marginalY0: marginalY0,
        marginalRest: marginalRest
      }
    });
  }

  // ----------------------------------------------------------------
  // Strategy slot10 — Aircraft Purchase
  // QBU > 50% required; bonus = cost × bizUse × 100%.
  // QBU ≤ 50% → ADS straight-line, no bonus, no §179.
  // §274 entertainment / commuting disallowance not modeled here.
  //
  // Rivalry: investment = 0 per advisor 2026-05-06. The aircraft is a
  // physical-asset purchase the client wants anyway — it doesn't
  // compete with Brooklyn for sale-proceed capital. The depreciation
  // deduction's tax savings flow into net benefit; the asset itself
  // is tracked separately in the Page-5 "physical-asset" bucket.
  // ----------------------------------------------------------------
  function _calcAircraft() {
    var cfg = _cfg(); if (!cfg) return _writeResult('slot10', null);
    var st = _state('slot10');
    var cost = Math.max(0, _num(st.aircraftCost));
    if (cost <= 0) return _writeResult('slot10', null);
    var qbu = Math.min(1, Math.max(0, _num(st.qbuPct) / 100));
    var yr1DeductionRaw;
    if (qbu > 0.50) {
      yr1DeductionRaw = cost * qbu;
    } else {
      yr1DeductionRaw = (cost * qbu) / 6;
    }
    // Cap the deduction at Y0 ordinary income pool (W2/SE/biz +
    // §1250 recapture). Beyond that creates an unmodeled NOL — see
    // _capDeductionAtOrdPool above for the full rationale. Advisor
    // PDF flagged this specifically on the Aircraft slot ("plane was
    // showing a net benefit greater than the original tax in Year 0").
    var yr1Deduction = _capDeductionAtOrdPool(cfg, yr1DeductionRaw);
    var marginal = _fedMarginal(cfg) + _stateMarginal(cfg);
    _writeResult('slot10', {
      netBenefit: Math.max(0, Math.round(yr1Deduction * marginal)),
      investment: 0,
      assetCost: Math.round(cost),
      marginalRate: marginal,
      detail: {
        qbu: qbu,
        yr1Deduction: Math.round(yr1Deduction),
        yr1DeductionUncapped: Math.round(yr1DeductionRaw),
        deductionCappedByOrdPool: yr1DeductionRaw > yr1Deduction,
        ordIncomePool: Math.round(_ordIncomePoolY0(cfg)),
        method: qbu > 0.50 ? 'MACRS + 100% bonus' : 'ADS (no bonus)',
        assetCost: Math.round(cost)
      }
    });
  }

  // ----------------------------------------------------------------
  // Strategy slot11 — STR Loophole + Cost Seg
  // Qualifies if avgUse ≤ 7 days AND material participation.
  // year1 = (cost - land) × 30% × 100% bonus + shell × MACRS yr1.
  // Non-passive when qualified → offsets W-2/active income.
  // ----------------------------------------------------------------
  function _calcStrLoophole() {
    var cfg = _cfg(); if (!cfg) return _writeResult('slot11', null);
    var st = _state('slot11');
    var cost = Math.max(0, _num(st.propertyCost));
    if (cost <= 0) return _writeResult('slot11', null);
    var qualifies = (_num(st.avgUseDays) <= 7) && !!st.materialPart;
    if (!qualifies) {
      return _writeResult('slot11', { netBenefit: 0, investment: Math.round(cost),
        detail: { reason: 'Requires avg stay ≤7 days AND material participation' } });
    }
    var landPct = Math.min(0.5, Math.max(0, _num(st.landPct) / 100));
    var depreciable = cost * (1 - landPct);
    var year1Accel = depreciable * 0.30;
    var shellYr1 = depreciable * 0.70 * 0.0256;
    var totalRaw = year1Accel + shellYr1;
    var total = _capDeductionAtOrdPool(cfg, totalRaw);
    var marginal = _fedMarginal(cfg) + _stateMarginal(cfg);
    _writeResult('slot11', {
      netBenefit: Math.max(0, Math.round(total * marginal)),
      investment: Math.round(cost),
      marginalRate: marginal,
      detail: {
        qualifies: true,
        year1Deduction: Math.round(total),
        year1DeductionUncapped: Math.round(totalRaw),
        deductionCappedByOrdPool: totalRaw > total,
        ordIncomePool: Math.round(_ordIncomePoolY0(cfg))
      }
    });
  }

  // ----------------------------------------------------------------
  // Strategy slot12 — Farm / Business Equipment (§179 + 100% bonus)
  // §179 cap $2,560,000; phase-out begins $4,090,000 (dollar-for-dollar)
  // §179 capped by business taxable income; carryforward unlimited
  // 100% bonus on residual (cost - §179 used)
  // ----------------------------------------------------------------
  function _calcFarmEquipment() {
    var cfg = _cfg(); if (!cfg) return _writeResult('slot12', null);
    var st = _state('slot12');
    var cost = Math.max(0, _num(st.equipmentCost));
    if (cost <= 0) return _writeResult('slot12', null);
    // Business taxable income: pulled from Page-1 biz revenue when the
    // user hasn't manually overridden the strategy-card value (advisor
    // 2026-05-06 — single source of truth, no double-entry). The user
    // can still override on the card to model a forecast; a non-zero
    // st.bizTaxableIncome wins. This mirrors the behavior the advisor
    // wants: the card defaults from the form but lets them dial it.
    var stBiz = _num(st.bizTaxableIncome);
    var cfgBiz = _num(cfg.bizRevenue) || _num(cfg.baseOrdinaryIncome);
    var bizIncome = Math.max(0, stBiz > 0 ? stBiz : cfgBiz);
    var sec179Cap = 2560000;
    var phaseOut = Math.max(0, cost - 4090000);
    sec179Cap = Math.max(0, sec179Cap - phaseOut);
    var sec179 = Math.min(cost, sec179Cap, bizIncome);
    var residual = cost - sec179;
    var bonus = residual;
    var totalRaw = sec179 + bonus;
    var total = _capDeductionAtOrdPool(cfg, totalRaw);
    var marginal = _fedMarginal(cfg) + _stateMarginal(cfg);
    _writeResult('slot12', {
      netBenefit: Math.max(0, Math.round(total * marginal)),
      investment: 0,
      assetCost: Math.round(cost),
      marginalRate: marginal,
      detail: {
        sec179:    Math.round(sec179),
        bonus:     Math.round(bonus),
        total:     Math.round(total),
        totalUncapped: Math.round(totalRaw),
        deductionCappedByOrdPool: totalRaw > total,
        ordIncomePool: Math.round(_ordIncomePoolY0(cfg)),
        bizIncome: Math.round(bizIncome),
        bizSource: stBiz > 0 ? 'card override' : 'Page-1 business revenue',
        assetCost: Math.round(cost)
      }
    });
  }

  var _CALCS = {
    ptet:            _calcPtet,
    charitableGifts: _calcCharitableGifts,
    slot05:          _calcCostSeg,
    slot06:          _calcHeavyVehicle,
    slot07:          _calcEquipmentLeasing,
    slot08:          _calcAugusta,
    slot09:          _calc401k,
    slot10:          _calcAircraft,
    slot11:          _calcStrLoophole,
    slot12:          _calcFarmEquipment
  };

  // Public registration API for late-arriving calc modules. Pattern:
  //   window.registerSupplementalExtraCalc('slot05', function () { ... });
  // After registration, recomputeAll picks up the new entry on its
  // next tick.
  function registerCalc(id, fn) {
    if (typeof id !== 'string' || !id) return false;
    if (typeof fn !== 'function')      return false;
    _CALCS[id] = fn;
    return true;
  }

  // Auto-seed sale-derived defaults into per-card detail state so the
  // advisor doesn't have to retype values that are already known from
  // Sections 03 (income) + 05 (appreciated assets). User edits stick:
  // _seedField only writes when state[fieldId] is still at the spec
  // default AND the user hasn't touched it.
  function _seedField(id, fieldId, value) {
    if (!root.__rettSupplementalExtra || !root.__rettSupplementalExtra[id]) return;
    var actual = root.__rettSupplementalExtra[id];
    if (actual._userTouched && actual._userTouched[fieldId]) return;
    if (Number(actual[fieldId]) === Number(value)) return;
    actual[fieldId] = value;
    // Update the matching DOM input in place — preserves caret /
    // focus on neighboring fields. Skip if the input is currently
    // focused (the user is actively typing into THIS field).
    if (typeof document === 'undefined') return;
    var sel = '[data-supx-input="' + id + ':' + fieldId + '"]';
    var inp = document.querySelector(sel);
    if (!inp || inp === document.activeElement) return;
    if (inp.type === 'number') {
      inp.value = String(value);
    } else {
      inp.value = (typeof root.fmtUSD === 'function') ? root.fmtUSD(value) : ('$' + Math.round(value).toLocaleString('en-US'));
    }
  }

  function _seedFromSale() {
    var cfg = _cfg(); if (!cfg) return;
    var salePrice = Math.max(0, _num(cfg.salePrice));
    var costBasis = Math.max(0, _num(cfg.costBasis));
    var saleGain  = Math.max(0, salePrice - costBasis);
    // collectInputs returns: wages (W-2), baseOrdinaryIncome (sum of
    // W-2 + biz + SE + rentals + retirement + dividends). No direct
    // bizRevenue / seIncome fields — derive a pass-through proxy as
    // (ordinary - wages), which captures biz revenue + SE + rental.
    var ordIncome = Math.max(0, _num(cfg.baseOrdinaryIncome));
    var w2        = Math.max(0, _num(cfg.wages));
    var passThru  = Math.max(0, ordIncome - w2);

    // charitableGifts: derive unrealized gain on the appreciated path
    // proportionally from the sale (gain ratio = saleGain / salePrice).
    // AGI proxy = ordinary + sale gain.
    var cg = root.__rettSupplementalExtra && root.__rettSupplementalExtra.charitableGifts;
    if (cg) {
      var gift = Math.max(0, _num(cg.giftAmount));
      if (cg.giftType === 'appreciated' && salePrice > 0 && gift > 0) {
        _seedField('charitableGifts', 'appreciation', Math.round(gift * (saleGain / salePrice)));
      }
      if (ordIncome > 0 || saleGain > 0) {
        _seedField('charitableGifts', 'agi', Math.round(ordIncome + saleGain));
      }
    }
    // PTET: pass-through income proxy = ordinary - wages (biz + SE + rental).
    if (passThru > 0) _seedField('ptet', 'taxableIncome', Math.round(passThru));
    // 401(k) + Profit-Sharing: comp + prior-year wages from W-2 (or
    // pass-through if no W-2, e.g. an S-corp owner-only plan).
    var compProxy = w2 > 0 ? w2 : passThru;
    if (compProxy > 0) {
      _seedField('slot09', 'compensation',   Math.round(compProxy));
      _seedField('slot09', 'priorYearWages', Math.round(w2 > 0 ? w2 : compProxy));
    }
    // Farm/business equipment: business taxable income proxy = pass-
    // through × 50% margin (rough). User overrides if they have actuals.
    if (passThru > 0) _seedField('slot12', 'bizTaxableIncome', Math.round(passThru * 0.5));
  }

  // Driver — runs every registered calc, idempotent. Called on input
  // events (cfg or detail-panel changes) AND from the See Value
  // button so results are guaranteed fresh at click time.
  function recomputeAll() {
    _seedFromSale();
    Object.keys(_CALCS).forEach(function (id) {
      try { _CALCS[id](); }
      catch (e) { (root.reportFailure || console.warn)('calc ' + id + ' failed', e); }
    });
  }

  // Expose for See Value button + external callers.
  root.recomputeSupplementalExtra      = recomputeAll;
  root.registerSupplementalExtraCalc   = registerCalc;

  // Wire to input events: the supplemental-extra-render.js panel
  // dispatches plain "input" events on its currency / pct / yes-no
  // controls, and the rest of the form (cfg side) does too. We
  // listen broadly, recompute on any input / change, then refresh
  // any UI surface that's currently displaying derived numbers so
  // the user doesn't see stale figures.
  //
  // Debounced 120ms so rapid keystrokes don't thrash the engine.
  // Re-renders only the .supx-result-row blocks on Page 4 (preserves
  // the user's caret in whatever field they're typing in) and the
  // full Page 5 summary when it's the active page.
  if (typeof document !== 'undefined' && !root.__rettSupplementalExtraListenerWired) {
    root.__rettSupplementalExtraListenerWired = true;
    var t = null;
    function _afterRecompute() {
      // Page 4 — refresh open result rows in place (no input
      // re-render → no focus loss).
      if (typeof root.refreshSupplementalExtraValueRows === 'function') {
        try { root.refreshSupplementalExtraValueRows(); } catch (e) { /* */ }
      }
      // Page 5 — if it's the active page, re-render so the hero
      // numbers reflect the new input. Skipped when Page 5 isn't
      // visible to avoid wasted work AND when the user is currently
      // focused inside one of Page 5's own inputs (e.g.
      // #growth-end-date) — re-rendering mid-keystroke would
      // destroy and rebuild the input, eating the user's caret +
      // typed digits. (Bug 2026-05-06: typing the year portion of
      // the End Date wiped the date.)
      var active = document.querySelector('.page.active');
      if (!active || active.id !== 'page-allocator') return;
      if (typeof root.renderStrategySummary !== 'function') return;
      var focused = document.activeElement;
      var typingInPage5 = focused && active.contains(focused) &&
        (focused.tagName === 'INPUT' || focused.tagName === 'SELECT' || focused.tagName === 'TEXTAREA');
      if (typingInPage5) return;
      try { root.renderStrategySummary(); } catch (e) { /* */ }
    }
    function _scheduleRecompute() {
      if (t) clearTimeout(t);
      t = setTimeout(function () {
        t = null;
        recomputeAll();
        _afterRecompute();
      }, 120);
    }
    document.addEventListener('input',  _scheduleRecompute, true);
    document.addEventListener('change', _scheduleRecompute, true);
    // Initial pass once collectInputs is available.
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', function () {
        recomputeAll();
        _afterRecompute();
      });
    } else {
      setTimeout(function () { recomputeAll(); _afterRecompute(); }, 0);
    }
  }
})(window);
