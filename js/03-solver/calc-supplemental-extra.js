// FILE: js/03-solver/calc-supplemental-extra.js
// Calc modules for the 8 supplemental strategies whose plumbing was
// registered in supplemental-extra-registry.js. One function per
// strategy id; each computes { netBenefit, investment } and writes
// to window.__rettSupplementalExtra[id].lastResult so the registry
// accessors and the Page-4 "See Value" button pick it up
// automatically (no other plumbing edits needed).
//
// Math is intentionally compact and approximate — these are HNW
// clients in or near the top bracket, so a delta-based marginal
// rate from the existing tax engine is the primary driver. Each
// section flags its simplifying assumptions inline so the math can
// be refined in place (per-bracket QBI thresholds, AMT/NIIT add-
// backs, state PTET nuance, R&D ASC base, ITC adders, etc.) without
// changing the registry contract.
//
// Spec source: 2026 deterministic specification document supplied
// by the advisor (post-OBBBA), 5/6/2026.

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
  function _fedMarginal(cfg) {
    if (!cfg) return 0.37;
    if (typeof root.computeFederalTax !== 'function') return 0.37;
    var year   = cfg.year1 || (new Date()).getFullYear();
    var status = cfg.filingStatus || 'mfj';
    var base   = _num(cfg.baseOrdinaryIncome);
    var delta  = 1000;
    try {
      var t0 = root.computeFederalTax(base, year, status) || 0;
      var t1 = root.computeFederalTax(base + delta, year, status) || 0;
      var rate = (t1 - t0) / delta;
      if (rate < 0.10 || rate > 0.50) return 0.37;
      return rate;
    } catch (e) { return 0.37; }
  }

  // State marginal rate via the engine's computeStateTax. Defaults
  // to 5% when state == NONE / engine missing — reasonable HNW
  // assumption.
  function _stateMarginal(cfg) {
    if (!cfg) return 0.05;
    var state = cfg.state;
    if (!state || state === 'NONE') return 0;
    if (typeof root.computeStateTax !== 'function') return 0.05;
    var year   = cfg.year1 || (new Date()).getFullYear();
    var status = cfg.filingStatus || 'mfj';
    var base   = _num(cfg.baseOrdinaryIncome);
    var delta  = 1000;
    try {
      var t0 = root.computeStateTax(base,         year, state, status) || 0;
      var t1 = root.computeStateTax(base + delta, year, state, status) || 0;
      var rate = (t1 - t0) / delta;
      if (rate < 0 || rate > 0.20) return 0.05;
      return rate;
    } catch (e) { return 0.05; }
  }

  // Add'l-Medicare + NIIT on investment-income side. We don't always
  // apply both — only where the deduction reduces an income type
  // they touch. Most ordinary-income deductions (412(e)(3), 401(h),
  // PTET, QCD) save fed + state + Add'l Medicare on wages > $250K
  // (joint). NIIT applies to investment income; for the supplemental
  // strategies modeled here, only QCD touches IRA distributions
  // which aren't NIIT-coded but reducing AGI helps NIIT for OTHER
  // investment income — second-order benefit, conservatively skipped.
  function _addlMedicare(cfg) {
    var status = (cfg && cfg.filingStatus) || 'mfj';
    var thresh = (status === 'mfj') ? 250000 : 200000;
    var inc = _num(cfg && cfg.baseOrdinaryIncome);
    return inc > thresh ? 0.009 : 0;
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

  // ----------------------------------------------------------------
  // Strategy 1 — IRC §412(e)(3) Fully Insured DB Plan
  //
  // Two-stage calc:
  //   (a) Compute the actuarial maximum annual premium under
  //       §415(b)/§401(a)(17). Per spec:
  //         B = min($290K [2026 §415(b)], min(ownerComp, $360K))
  //         B reduced for years-of-participation < 10 (§415(b)(5)):
  //           B *= yearsParticipation / 10
  //         lumpSumNeeded = B × life-annuity factor (~15 at NRA 65)
  //         maxPremium = lumpSumNeeded × r / ((1+r)^n − 1)
  //         × 1.4 uplift (412(e)(3) typically funds 30–60% higher
  //         than traditional actuarial DB due to insurer guaranteed
  //         rates).
  //   (b) Apply tax: contribution (capped at maxPremium) × blended
  //       (federal + state + Add'l Medicare) marginal × (1 − 0.20×QBI).
  //
  // Premium is treated as ordinary-income-reducing — flows through
  // the entity, lands on the owner's Schedule K-1 / Schedule C as
  // a deduction.
  // ----------------------------------------------------------------
  var BENEFIT_415B_2026   = 290000;    // §415(b)(1)(A) DB annual benefit limit
  var COMP_401a17_2026    = 360000;    // §401(a)(17) compensation cap
  var DE_MINIMIS_415B4    = 10000;     // §415(b)(4) floor

  function _maxPremium412e3(st) {
    var ownerComp = Math.max(0, _num(st.ownerComp)) || COMP_401a17_2026;
    var ageOwner  = Math.max(20, _num(st.ageOwner) || 55);
    var nra       = Math.max(ageOwner + 1, _num(st.nra) || 65);
    var yrsPart   = Math.max(1,  _num(st.yearsParticipation) || 10);
    var rate      = Math.max(0.005, (_num(st.creditingRate) || 3.5) / 100);

    // §415(b) cap, age-adjusted (assume NRA = 65 for simplicity;
    // pre-62 / post-65 actuarial adjustments deferred to Phase 2).
    var benefit = Math.min(BENEFIT_415B_2026, Math.min(ownerComp, COMP_401a17_2026));
    if (yrsPart < 10) benefit *= (yrsPart / 10);
    benefit = Math.max(benefit, DE_MINIMIS_415B4);

    var yearsToNRA = nra - ageOwner;
    if (yearsToNRA <= 0) return DE_MINIMIS_415B4;

    // Life-annuity factor at NRA — straight-life, 3.5%, age 65 ≈
    // 15. Holds reasonably across 60-70 NRA range.
    var lumpSumAtNRA = benefit * 15;
    // Future-value of $1 paid annually for n years at rate r:
    var fvFactor = (Math.pow(1 + rate, yearsToNRA) - 1) / rate;
    if (fvFactor <= 0) return DE_MINIMIS_415B4;
    var traditionalDB = lumpSumAtNRA / fvFactor;
    // 412(e)(3) insurance-funded uplift (30-60% higher per spec).
    return traditionalDB * 1.4;
  }

  function _calcPlan412e3() {
    var cfg = _cfg(); if (!cfg) return _writeResult('plan412e3', null);
    var st = _state('plan412e3');
    var contribution = Math.max(0, _num(st.contribution));
    if (contribution <= 0) return _writeResult('plan412e3', null);

    var maxPremium = _maxPremium412e3(st);
    var actual     = Math.min(contribution, maxPremium);

    var fed   = _fedMarginal(cfg);
    var st_   = _stateMarginal(cfg);
    var addl  = _addlMedicare(cfg);
    var qbi   = _qbiHaircut(cfg);
    var marginal = fed + st_ + addl;
    var netBenefit = actual * marginal * (1 - 0.20 * qbi);
    _writeResult('plan412e3', {
      netBenefit: Math.round(netBenefit),
      investment: Math.round(actual),
      marginalRate: marginal,
      detail: {
        contribution: Math.round(actual),
        maxAllowed:   Math.round(maxPremium),
        capped:       contribution > maxPremium
      }
    });
  }

  // ----------------------------------------------------------------
  // Strategy 2 — Pass-Through Entity Tax (PTET)
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
  // Future refinements: 36-state PTET rate lookup table, MAGI-
  // based SALT cap phase-down ($505K joint MAGI threshold, 30%
  // reduction, $10K floor), residency credit nuance.
  // ----------------------------------------------------------------
  function _calcPtet() {
    var cfg = _cfg(); if (!cfg) return _writeResult('ptet', null);
    var st = _state('ptet');
    var income = Math.max(0, _num(st.taxableIncome));
    var rate   = Math.max(0, _num(st.stateRate)) / 100;
    if (income <= 0 || rate <= 0) return _writeResult('ptet', null);

    var ptet = income * rate;
    var fed     = _fedMarginal(cfg);
    var stRate  = _stateMarginal(cfg);
    var qbi     = _qbiHaircut(cfg);
    var saltCap = Math.max(0, _num(st.saltCapacityRemaining));
    var creditPct = Math.max(0, Math.min(100, _num(st.creditPct) || 100)) / 100;

    // Gross federal benefit: PTET deductible at entity → reduces
    // K-1 income → fed × PTET. QBI haircut applies.
    var fedBenefit = fed * ptet * (1 - 0.20 * qbi);

    // SALT-capacity opportunity cost: any unused individual SALT
    // headroom that the owner could have used for the SAME state
    // tax (had they paid individually rather than via PTET) is
    // forfeited — value at fed marginal.
    var saltForfeit = Math.min(saltCap, ptet) * fed;

    // State-credit slippage (MA-style 90% credit): owner pays
    // state-level tax on the missing 10% — valued at state marginal.
    var creditSlippage = ptet * (1 - creditPct) * stRate;

    var netBenefit = fedBenefit - saltForfeit - creditSlippage;
    _writeResult('ptet', {
      netBenefit: Math.max(0, Math.round(netBenefit)),
      investment: 0,             // not invested capital — tax payment
      marginalRate: fed,
      detail: {
        ptetPaid:       Math.round(ptet),
        ptetRate:       rate,
        fedBenefit:     Math.round(fedBenefit),
        saltForfeit:    Math.round(saltForfeit),
        creditSlippage: Math.round(creditSlippage)
      }
    });
  }

  // ----------------------------------------------------------------
  // Strategy 3 — QBI Deduction (§199A) — full phase-in mechanics
  //
  // Three regimes per the 2026 spec:
  //   Below threshold  — full 20% QBI, no SSTB / W-2 / UBIA limits.
  //   In phase-in band — SSTB applicable percentage = 1 − (excess /
  //                      range); W-2/UBIA limit phased in pro-rata.
  //   Above upper      — SSTB → $400 §199A(i) minimum (post-OBBBA)
  //                      if active QBI ≥ $1,000;
  //                      non-SSTB → 20% × QBI capped by greater of
  //                      (50% × W-2 wages, 25% × W-2 + 2.5% × UBIA).
  //
  // 2026 thresholds (Rev. Proc. 2025-32):
  //   Single: $201,775 (start) → $276,775 (upper, +$75K range)
  //   MFJ:    $403,550 (start) → $553,550 (upper, +$150K range)
  //
  // Net benefit = deduction × federal marginal. State conformity
  // varies — most states piggyback on federal AGI but a handful
  // require add-back. Skipped at this fidelity.
  // ----------------------------------------------------------------
  var QBI_THRESHOLDS_2026 = {
    mfj:    { start: 403550, upper: 553550, range: 150000 },
    single: { start: 201775, upper: 276775, range: 75000  },
    mfs:    { start: 201775, upper: 276775, range: 75000  },
    hoh:    { start: 201775, upper: 276775, range: 75000  }
  };

  function _calcQbi() {
    var cfg = _cfg(); if (!cfg) return _writeResult('qbi', null);
    var st = _state('qbi');
    var qbiIncome = Math.max(0, _num(st.qbiIncome));
    if (qbiIncome <= 0) return _writeResult('qbi', null);
    var isSSTB = !!st.isSSTB;
    var w2     = Math.max(0, _num(st.w2Wages));
    var ubia   = Math.max(0, _num(st.ubia));

    var fed = _fedMarginal(cfg);
    var status = cfg.filingStatus || 'mfj';
    var thr = QBI_THRESHOLDS_2026[status] || QBI_THRESHOLDS_2026.mfj;
    var taxable = _num(cfg.baseOrdinaryIncome);

    // W-2 / UBIA wage limit (above-threshold cap)
    var wageLimit = Math.max(0.5 * w2, 0.25 * w2 + 0.025 * ubia);

    var deduction;
    if (taxable <= thr.start) {
      // Full 20% QBI, no SSTB / wage filter.
      deduction = 0.20 * qbiIncome;
    } else if (taxable >= thr.upper) {
      // Above upper bound — full filter.
      if (isSSTB) {
        deduction = (qbiIncome >= 1000) ? 400 : 0;   // §199A(i) min
      } else {
        deduction = Math.min(0.20 * qbiIncome, wageLimit);
      }
    } else {
      // Phase-in band.
      var excess = taxable - thr.start;
      var pct    = excess / thr.range;          // 0..1
      var sstbPct = isSSTB ? (1 - pct) : 1;     // SSTB phase-out
      var fullDeduction  = 0.20 * qbiIncome * sstbPct;
      // W-2/UBIA limit phases in pro-rata.
      var phasedWageLim  = (1 - pct) * fullDeduction + pct * Math.min(fullDeduction, wageLimit);
      deduction = Math.min(fullDeduction, phasedWageLim);
    }

    var netBenefit = deduction * fed;
    _writeResult('qbi', {
      netBenefit: Math.round(netBenefit),
      investment: 0,
      marginalRate: fed,
      detail: {
        deduction: Math.round(deduction),
        regime:    taxable <= thr.start ? 'below' : (taxable >= thr.upper ? 'above' : 'phase-in'),
        wageLimit: Math.round(wageLimit),
        isSSTB:    isSSTB
      }
    });
  }

  // ----------------------------------------------------------------
  // Strategy 4 — R&D Credit (§41) + §174A Expensing
  //
  // ASC formulas (§41(c)(4)):
  //   With prior-3-yr QRE base:    credit = 14% × (current − 0.5×prior_avg)
  //   No prior base (start-up):    credit = 6% × current
  //
  // §280C(c)(2) reduced-credit election: credit × (1 − 21%) = ×0.79;
  // preserves full §174A deduction. Default election in most HNW
  // settings.
  //
  // §174A: post-OBBBA permanent immediate expensing of domestic
  // R&E → deduction value = spend × federal marginal.
  //
  // QSB payroll-tax offset (§41(h), 2026):
  //   Cap $500K/yr — first $250K against employer SS (6.2%), next
  //   $250K against employer Medicare (1.45%). Cash-equivalent for
  //   pre-revenue startups but valued at face for the calculator
  //   (the offset is a $-for-$ reduction of payroll tax owed).
  //
  // Net benefit = credit (post §280C) + §174A deduction value, then
  // capped at the practical ceiling for QSB payroll path.
  // ----------------------------------------------------------------
  function _calcRdCredit() {
    var cfg = _cfg(); if (!cfg) return _writeResult('rdCredit', null);
    var st = _state('rdCredit');
    var spend = Math.max(0, _num(st.rdSpend));
    if (spend <= 0) return _writeResult('rdCredit', null);
    var priorAvg = Math.max(0, _num(st.priorYrAvgQRE));
    var isQSB    = !!st.isQSB;
    var ssWages  = Math.max(0, _num(st.ssWages));
    var elect280C = (st.elect280C !== false);    // default true

    var fed = _fedMarginal(cfg);

    // ASC credit (start-up vs. continuing).
    var creditNominal;
    if (priorAvg > 0) {
      var asc = spend - 0.5 * priorAvg;
      creditNominal = Math.max(0, 0.14 * asc);
    } else {
      creditNominal = 0.06 * spend;             // start-up rate
    }

    var credit;
    if (elect280C) {
      // §280C(c)(2) — reduced credit, full §174A deduction preserved.
      credit = creditNominal * 0.79;
    } else {
      // Default: full credit, but reduce §174A deduction by credit
      // amount → effectively credit × (1 − fed). Net is similar at
      // top brackets but shifts more value to credit (state-tax
      // friendly when state piggybacks on §174A).
      credit = creditNominal;
    }

    // §174A immediate-expense value.
    var deductionBase = elect280C ? spend : Math.max(0, spend - creditNominal);
    var deductionValue = deductionBase * fed;

    // QSB payroll-tax offset cap. The credit may be applied against
    // OASDI ($250K) and Medicare ($250K) on Form 8974 — limited by
    // SS wages (offset can't exceed actual employer-tax owed).
    if (isQSB) {
      var maxOasdi   = Math.min(250000, ssWages * 0.062);
      var maxMedicare = 250000;                 // no SS-wage cap
      var qsbCeiling = maxOasdi + maxMedicare;
      credit = Math.min(credit, qsbCeiling);
    }

    var netBenefit = credit + deductionValue;
    _writeResult('rdCredit', {
      netBenefit: Math.round(netBenefit),
      investment: Math.round(spend),
      marginalRate: fed,
      detail: {
        credit:         Math.round(credit),
        creditNominal:  Math.round(creditNominal),
        deductionValue: Math.round(deductionValue),
        elect280C:      elect280C,
        ascMode:        priorAvg > 0 ? 'continuing' : 'start-up',
        qsbCapped:      isQSB
      }
    });
  }

  // ----------------------------------------------------------------
  // Strategy 5 — 401(h) Retiree Medical Sub-Account
  //
  // Two binding caps per spec:
  //   (a) §401(h) subordination: aggregate (401(h) + life-insurance)
  //       contributions ≤ 25% of cumulative employer contributions
  //       to the underlying DB plan since 401(h) adoption (excluding
  //       past-service amortization). Headroom is cumulative, so the
  //       year-t allowed contribution = 0.25 × cumulativeDBContrib −
  //       cumulative401hPrior.
  //   (b) Key-employee separate-account → §415(c) annual additions
  //       cap = $72,000 (2026, Notice 2025-67).
  //
  // Tax math is identical to §412(e)(3): contribution flows through
  // the entity as deductible, reducing ordinary income. Net benefit
  // = contribution × (federal + state + Add'l Medicare) marginal ×
  // (1 − 0.20 × QBI haircut).
  // ----------------------------------------------------------------
  var SECTION_415C_2026 = 72000;   // §415(c) annual additions, 2026

  function _calcPlan401h() {
    var cfg = _cfg(); if (!cfg) return _writeResult('plan401h', null);
    var st = _state('plan401h');
    var contrib = Math.max(0, _num(st.medContribution));
    if (contrib <= 0) return _writeResult('plan401h', null);

    // Subordination headroom (always required).
    var cumDB    = Math.max(0, _num(st.cumulativeDBContrib));
    var cumPrior = Math.max(0, _num(st.cumulative401hPrior));
    var subordinationCap = Math.max(0, 0.25 * cumDB - cumPrior);

    // Key-employee §415(c) cap (only when KE flag is on — otherwise
    // 401(h) sits on the DB-plan side and is not constrained by the
    // DC annual-additions limit).
    var keCap = st.isKeyEmployee ? SECTION_415C_2026 : Infinity;

    var maxAllowed = Math.min(subordinationCap, keCap);
    var actual = Math.min(contrib, maxAllowed);

    var fed   = _fedMarginal(cfg);
    var st_   = _stateMarginal(cfg);
    var addl  = _addlMedicare(cfg);
    var qbi   = _qbiHaircut(cfg);
    var marginal = fed + st_ + addl;
    var netBenefit = actual * marginal * (1 - 0.20 * qbi);
    _writeResult('plan401h', {
      netBenefit: Math.round(netBenefit),
      investment: Math.round(actual),
      marginalRate: marginal,
      detail: {
        contribution:     Math.round(actual),
        maxAllowed:       Math.round(maxAllowed),
        subordinationCap: Math.round(subordinationCap),
        keCapApplied:     !!st.isKeyEmployee,
        capped:           contrib > maxAllowed
      }
    });
  }

  // ----------------------------------------------------------------
  // Strategy 6 — Qualified Charitable Distribution (QCD)
  //
  // 2026 limits (§408(d)(8)(G), Rev. Proc. 2025-32):
  //   Annual cap:                         $111,000 / person
  //   One-time split-interest (CGA/CRT):  $55,000 (subset of $111K)
  //
  // Eligibility:
  //   donorAge ≥ 70.5 (hard gate; the strategy is unavailable below).
  //   post-70.5 deductible IRA contribs reduce the eligible QCD
  //   amount $-for-$ (anti-abuse rule, §408(d)(8)(A)).
  //
  // Tax math: QCD is excluded from gross income → savings =
  // capped × (federal + state) marginal. Counts toward RMD without
  // entering AGI; second-order IRMAA / NIIT / SS-taxation benefits
  // are real but skipped at this fidelity (refinement opportunity).
  // ----------------------------------------------------------------
  function _calcQcd() {
    var cfg = _cfg(); if (!cfg) return _writeResult('qcd', null);
    var st = _state('qcd');
    var raw = Math.max(0, _num(st.qcdAmount));
    if (raw <= 0) return _writeResult('qcd', null);
    var donorAge = _num(st.donorAge) || 0;
    var splitInt = !!st.isSplitInterest;
    var iraOffset = Math.max(0, _num(st.post705IraContrib));

    // Hard age gate.
    if (donorAge > 0 && donorAge < 70.5) {
      return _writeResult('qcd', {
        netBenefit: 0, investment: 0, marginalRate: 0,
        detail: { ineligible: 'Donor under age 70.5' }
      });
    }

    // Per-pathway cap.
    var statutoryCap = splitInt ? 55000 : 111000;
    // Anti-abuse: post-70.5 deductible IRA contribs reduce eligible
    // amount.
    var eligibleCap = Math.max(0, statutoryCap - iraOffset);
    var capped = Math.min(raw, eligibleCap);

    var fed = _fedMarginal(cfg);
    var st_ = _stateMarginal(cfg);
    var marginal = fed + st_;
    var netBenefit = capped * marginal;
    _writeResult('qcd', {
      netBenefit: Math.round(netBenefit),
      investment: 0,
      marginalRate: marginal,
      detail: {
        qcdAmount:    Math.round(capped),
        statutoryCap: statutoryCap,
        eligibleCap:  Math.round(eligibleCap),
        splitInt:     splitInt
      }
    });
  }

  // ----------------------------------------------------------------
  // Strategy 7 — Solar ITC (§48E) + 100% Bonus Depreciation
  //
  // ITC rate stack (post-OBBBA, 2026 BOC):
  //   Base:                30% if PWA-compliant OR < 1 MW AC; else 6%.
  //   Domestic content:    +10% (threshold 50% in 2026 BOC; assume met).
  //   Energy community:    +10%.
  //   Low-income community: +10% (LIC / Indian land) or +20% (LIC
  //                              residential / economic-benefit).
  //   Max stacked: 70% (30 + 10 + 10 + 20).
  //
  // §50(c) basis reduction: depreciable basis = inv × (1 − 0.5 × ITC%).
  // 100% bonus depreciation at PIS (OBBBA permanent for property
  // acquired after 1/19/2025) → full depreciable basis deducts Y1.
  //
  // §469 passive-activity trap (individuals + closely-held C-corps
  // + PSCs + trusts not materially participating): credit + losses
  // limited to passive income/tax. Conservative model when
  // isPassive=true: zero out netBenefit. Closely-held C-corp using
  // §469(e)(2)(A) net-active-income exception would set false.
  //
  // Future refinement: §50(a) 5-yr recapture vesting (20%/yr),
  // §6418 transferability with cash discount, §49/§465 at-risk
  // basis caps, FEOC / material-assistance disqualifier (2026+).
  // ----------------------------------------------------------------
  function _calcSolarItc() {
    var cfg = _cfg(); if (!cfg) return _writeResult('solarITC', null);
    var st = _state('solarITC');
    var inv = Math.max(0, _num(st.solarInvestment));
    if (inv <= 0) return _writeResult('solarITC', null);

    var mwSize = _num(st.mwSize) || 1;
    var pwa    = (st.pwaCompliant !== false);
    var dc     = !!st.domesticContent;
    var ec     = !!st.energyCommunity;
    var lic    = st.lowIncomeAdder || 'none';
    var passive = !!st.isPassive;

    // Base rate.
    var pwaQualifies = pwa || mwSize < 1;
    var itcRate = pwaQualifies ? 0.30 : 0.06;
    if (dc) itcRate += 0.10;
    if (ec) itcRate += 0.10;
    if (lic === 'lic-10') itcRate += 0.10;
    else if (lic === 'lic-20') itcRate += 0.20;
    itcRate = Math.min(itcRate, 0.70);          // statutory ceiling

    var fed = _fedMarginal(cfg);
    var stRate = _stateMarginal(cfg);
    var marginal = fed + stRate;

    var itcDollars = inv * itcRate;             // $-for-$ credit
    var depreciableBasis = inv * (1 - 0.5 * itcRate);
    var bonusValue = depreciableBasis * marginal;  // 100% Y1 bonus

    var grossBenefit = itcDollars + bonusValue;
    var netBenefit = passive ? 0 : grossBenefit;

    _writeResult('solarITC', {
      netBenefit: Math.round(netBenefit),
      investment: Math.round(inv),
      marginalRate: marginal,
      detail: {
        itcRate:          itcRate,
        itc:              Math.round(itcDollars),
        bonusValue:       Math.round(bonusValue),
        depreciableBasis: Math.round(depreciableBasis),
        passiveFiltered:  passive,
        adders:           { dc: dc, ec: ec, lic: lic, pwa: pwa, mwSize: mwSize }
      }
    });
  }

  // ----------------------------------------------------------------
  // Strategy 8 — §181 Film / TV / Live Theatrical / Sound Recording
  //
  // Per-production caps (§181(a)(2)):
  //   Film / TV / live theatrical:  $15M (default) or $20M when
  //                                 production costs significantly
  //                                 incurred in low-income areas.
  //   Sound recording (OBBBA-new):  $150K per production AND $150K
  //                                 cumulative annual.
  //
  // Eligibility gates:
  //   commencedBy2025 = false → §181 unavailable; falls back to
  //                              §168(k) 100% bonus at PIS (OBBBA
  //                              permanent post 1/19/2025) — same
  //                              year-1 deduction value, just
  //                              different statutory anchor.
  //   usServicesPct < 75 → not "qualified" (§181(d)(3)) for §181;
  //                        bonus path still works for tangible
  //                        property components.
  //
  // §469 passive trap: if isPassive=true and the taxpayer isn't a
  // closely-held C-corp / material participant, deductions are
  // suspended against passive income. Conservative model: zero out
  // netBenefit when isPassive.
  // ----------------------------------------------------------------
  function _calcFilm181() {
    var cfg = _cfg(); if (!cfg) return _writeResult('film181', null);
    var st = _state('film181');
    var inv = Math.max(0, _num(st.filmInvestment));
    if (inv <= 0) return _writeResult('film181', null);

    var commenced = (st.commencedBy2025 !== false);
    var lowIncome = !!st.lowIncomeArea;
    var usPct = Math.max(0, Math.min(100, _num(st.usServicesPct) || 0));
    var prodType = st.productionType || 'film';
    var passive  = !!st.isPassive;

    // Per-production cap by type.
    var cap;
    if (prodType === 'sound') {
      cap = 150000;   // sound recording
    } else {
      cap = lowIncome ? 20000000 : 15000000;
    }
    var capped = Math.min(inv, cap);

    // U.S.-services 75% test for §181. If we're falling through to
    // §168(k) bonus (post-2025 commencement OR <75% U.S. services),
    // the deduction still works at the property level — but the
    // gate is a real engagement filter the advisor needs to see.
    var usingS181 = commenced && usPct >= 75;

    var fed = _fedMarginal(cfg);
    var stRate = _stateMarginal(cfg);
    var marginal = fed + stRate;

    // Year-1 deduction value: capped × marginal, in either path.
    var grossBenefit = capped * marginal;

    // §469 passive-activity filter — full zero-out for passive
    // individual investors. Closely-held C-corps using §469(e)(2)(A)
    // would set isPassive=false manually.
    var netBenefit = passive ? 0 : grossBenefit;

    _writeResult('film181', {
      netBenefit: Math.round(netBenefit),
      investment: Math.round(capped),
      marginalRate: marginal,
      detail: {
        deduction:   Math.round(capped),
        cap:         cap,
        statute:     usingS181 ? '§181' : '§168(k) bonus',
        passiveFiltered: passive
      }
    });
  }

  // ----------------------------------------------------------------
  // Driver — runs every calc, idempotent. Called on input events
  // (cfg or detail-panel changes) AND from the See Value button so
  // results are guaranteed fresh at click time.
  // ----------------------------------------------------------------
  function recomputeAll() {
    try { _calcPlan412e3(); } catch (e) { (root.reportFailure || console.warn)('calc plan412e3 failed', e); }
    try { _calcPtet();      } catch (e) { (root.reportFailure || console.warn)('calc ptet failed', e); }
    try { _calcQbi();       } catch (e) { (root.reportFailure || console.warn)('calc qbi failed', e); }
    try { _calcRdCredit();  } catch (e) { (root.reportFailure || console.warn)('calc rdCredit failed', e); }
    try { _calcPlan401h();  } catch (e) { (root.reportFailure || console.warn)('calc plan401h failed', e); }
    try { _calcQcd();       } catch (e) { (root.reportFailure || console.warn)('calc qcd failed', e); }
    try { _calcSolarItc();  } catch (e) { (root.reportFailure || console.warn)('calc solarITC failed', e); }
    try { _calcFilm181();   } catch (e) { (root.reportFailure || console.warn)('calc film181 failed', e); }
  }

  // Expose for See Value button + external callers.
  root.recomputeSupplementalExtra = recomputeAll;

  // Wire to input events: the supplemental-extra-render.js panel
  // dispatches plain "input" events on its currency / pct / yes-no
  // controls, and the rest of the form (cfg side) does too. We
  // listen broadly and recompute on any input / change. Debounced
  // so rapid keystrokes don't thrash the engine.
  if (typeof document !== 'undefined' && !root.__rettSupplementalExtraListenerWired) {
    root.__rettSupplementalExtraListenerWired = true;
    var t = null;
    function _scheduleRecompute() {
      if (t) clearTimeout(t);
      t = setTimeout(function () { t = null; recomputeAll(); }, 120);
    }
    document.addEventListener('input',  _scheduleRecompute, true);
    document.addEventListener('change', _scheduleRecompute, true);
    // Initial pass once collectInputs is available.
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', recomputeAll);
    } else {
      setTimeout(recomputeAll, 0);
    }
  }
})(window);
