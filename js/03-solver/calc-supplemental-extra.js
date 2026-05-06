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
  // Net benefit = annual premium contribution × (federal + state +
  // Add'l Medicare marginal rate) × (1 − QBI haircut). Premium is
  // capped server-side to the §415(b) 2026 benefit ($290K) actuarial
  // equivalent — the user's contribution input is treated as their
  // intended annual premium and we don't re-compute the actuarial
  // ceiling (refinement opportunity).
  // ----------------------------------------------------------------
  function _calcPlan412e3() {
    var cfg = _cfg(); if (!cfg) return _writeResult('plan412e3', null);
    var st = _state('plan412e3');
    var contribution = Math.max(0, _num(st.contribution));
    if (contribution <= 0) return _writeResult('plan412e3', null);
    // Hard cap at a defensible upper-bound annual premium (insurance
    // funding for the 2026 §415(b) $290K benefit at age 55+ commonly
    // runs $300-450K; cap conservatively at $1M to flag inputs).
    var capped = Math.min(contribution, 1000000);
    var fed   = _fedMarginal(cfg);
    var st_   = _stateMarginal(cfg);
    var addl  = _addlMedicare(cfg);
    var qbi   = _qbiHaircut(cfg);
    var marginal = fed + st_ + addl;
    // Net = contribution × blended marginal × (1 − 0.20 × qbi share).
    // The (1 − 0.20 × qbi) factor models the QBI deduction lost
    // because the contribution reduces pass-through QBI.
    var netBenefit = capped * marginal * (1 - 0.20 * qbi);
    _writeResult('plan412e3', {
      netBenefit: Math.round(netBenefit),
      investment: Math.round(capped),
      marginalRate: marginal,
      detail: { contribution: capped }
    });
  }

  // ----------------------------------------------------------------
  // Strategy 2 — Pass-Through Entity Tax (PTET)
  //
  // PTET payment = pass-through income × state PTET rate. Federal
  // benefit ≈ federal marginal × PTET × (1 − 0.20 × QBI applies).
  // The "loss-of-individual-SALT" subtraction (when the owner could
  // have used the $40,400 federal SALT cap individually) is non-
  // trivial; current model treats SALT cap as already maxed out by
  // property tax + non-PTET state, which is the common HNW case.
  // Refinement: subtract min(ptet, capRemaining × fedMarginal) when
  // individual SALT capacity exists.
  // ----------------------------------------------------------------
  function _calcPtet() {
    var cfg = _cfg(); if (!cfg) return _writeResult('ptet', null);
    var st = _state('ptet');
    var income = Math.max(0, _num(st.taxableIncome));
    var rate   = Math.max(0, _num(st.stateRate)) / 100;
    if (income <= 0 || rate <= 0) return _writeResult('ptet', null);
    var ptet = income * rate;
    var fed = _fedMarginal(cfg);
    var qbi = _qbiHaircut(cfg);
    // Federal benefit only — state side is a wash (the owner takes
    // a state credit for the PTET paid).
    var netBenefit = fed * ptet * (1 - 0.20 * qbi);
    _writeResult('ptet', {
      netBenefit: Math.round(netBenefit),
      investment: 0,             // not invested capital — tax payment
      marginalRate: fed,
      detail: { ptetPaid: Math.round(ptet), ptetRate: rate }
    });
  }

  // ----------------------------------------------------------------
  // Strategy 3 — QBI Deduction (§199A)
  //
  // For supplemental QBI input: assume below-threshold non-SSTB
  // (most HNW small-business owners are above and need W-2/UBIA
  // testing — refinement opportunity). Below threshold the deduction
  // = 20% × QBI; tax saved ≈ 20% × QBI × federal marginal. SSTB +
  // above threshold falls back to the OBBBA $400 minimum if active
  // QBI ≥ $1,000.
  // ----------------------------------------------------------------
  function _calcQbi() {
    var cfg = _cfg(); if (!cfg) return _writeResult('qbi', null);
    var st = _state('qbi');
    var qbiIncome = Math.max(0, _num(st.qbiIncome));
    var isSSTB = !!st.isSSTB;
    if (qbiIncome <= 0) return _writeResult('qbi', null);
    var fed = _fedMarginal(cfg);
    // 2026 phase-in upper bounds from the spec doc:
    //   single $276,775   joint $553,550
    var status = cfg.filingStatus || 'mfj';
    var upper  = (status === 'mfj') ? 553550 : 276775;
    var taxable = _num(cfg.baseOrdinaryIncome);
    var aboveUpper = taxable > upper;

    var deduction;
    if (isSSTB && aboveUpper) {
      // §199A(i) post-OBBBA $400 minimum if active and aggregate
      // QBI ≥ $1,000. Treats the user's input as active.
      deduction = (qbiIncome >= 1000) ? 400 : 0;
    } else {
      // Below threshold OR non-SSTB: 20% × QBI (W-2/UBIA wage
      // limit phase-in skipped at this fidelity).
      deduction = qbiIncome * 0.20;
    }
    var netBenefit = deduction * fed;
    _writeResult('qbi', {
      netBenefit: Math.round(netBenefit),
      investment: 0,
      marginalRate: fed,
      detail: { deduction: Math.round(deduction), aboveUpper: aboveUpper, isSSTB: isSSTB }
    });
  }

  // ----------------------------------------------------------------
  // Strategy 4 — R&D Credit (§41) + §174A Expensing
  //
  // Default to ASC at 6% (no prior-3-yr QREs known). With §280C(c)(2)
  // reduced-credit election (the common choice when the deduction
  // matters for state purposes), credit × 0.79. §174A deduction
  // saves federal marginal × spend (post-OBBBA permanent immediate
  // expensing).
  // ----------------------------------------------------------------
  function _calcRdCredit() {
    var cfg = _cfg(); if (!cfg) return _writeResult('rdCredit', null);
    var st = _state('rdCredit');
    var spend = Math.max(0, _num(st.rdSpend));
    if (spend <= 0) return _writeResult('rdCredit', null);
    var fed = _fedMarginal(cfg);
    // ASC start-up rate when no prior-3-yr base: 6% × QRE.
    var creditNominal = spend * 0.06;
    // §280C(c)(2) reduced-credit election: × (1 − 21%) = × 0.79.
    // Preserves full §174A deduction; usually the better answer at
    // top brackets.
    var credit = creditNominal * 0.79;
    // §174A deduction value (immediate expensing, post-OBBBA).
    var deductionValue = spend * fed;
    var netBenefit = credit + deductionValue;
    _writeResult('rdCredit', {
      netBenefit: Math.round(netBenefit),
      investment: Math.round(spend),
      marginalRate: fed,
      detail: { credit: Math.round(credit), deductionValue: Math.round(deductionValue) }
    });
  }

  // ----------------------------------------------------------------
  // Strategy 5 — 401(h) Retiree Medical Sub-Account
  //
  // Same shape as §412(e)(3) but smaller amounts. 25% subordination
  // limit is the user's responsibility — the input is the year's
  // contribution, capped at $72K (2026 §415(c) annual-additions
  // ceiling for the key-employee separate-account scenario).
  // ----------------------------------------------------------------
  function _calcPlan401h() {
    var cfg = _cfg(); if (!cfg) return _writeResult('plan401h', null);
    var st = _state('plan401h');
    var contrib = Math.max(0, _num(st.medContribution));
    if (contrib <= 0) return _writeResult('plan401h', null);
    var capped = Math.min(contrib, 72000);
    var fed   = _fedMarginal(cfg);
    var st_   = _stateMarginal(cfg);
    var addl  = _addlMedicare(cfg);
    var qbi   = _qbiHaircut(cfg);
    var marginal = fed + st_ + addl;
    var netBenefit = capped * marginal * (1 - 0.20 * qbi);
    _writeResult('plan401h', {
      netBenefit: Math.round(netBenefit),
      investment: Math.round(capped),
      marginalRate: marginal,
      detail: { contribution: capped }
    });
  }

  // ----------------------------------------------------------------
  // Strategy 6 — Qualified Charitable Distribution (QCD)
  //
  // Annual cap $111,000 / person (2026, Rev. Proc. 2025-32). Excluded
  // from gross income → net benefit = QCD × (federal + state)
  // marginal rate. Second-order IRMAA / NIIT / SS-taxation benefits
  // are real but skipped at this fidelity.
  // ----------------------------------------------------------------
  function _calcQcd() {
    var cfg = _cfg(); if (!cfg) return _writeResult('qcd', null);
    var st = _state('qcd');
    var raw = Math.max(0, _num(st.qcdAmount));
    if (raw <= 0) return _writeResult('qcd', null);
    var capped = Math.min(raw, 111000);
    var fed = _fedMarginal(cfg);
    var st_ = _stateMarginal(cfg);
    var marginal = fed + st_;
    var netBenefit = capped * marginal;
    _writeResult('qcd', {
      netBenefit: Math.round(netBenefit),
      investment: 0,                 // charitable distribution — not invested
      marginalRate: marginal,
      detail: { qcdAmount: capped }
    });
  }

  // ----------------------------------------------------------------
  // Strategy 7 — Solar ITC (§48E) + 100% Bonus Depreciation
  //
  // Assumes PWA-met or <1MW (30% base ITC). Adders skipped at this
  // fidelity — refinement: read energy-community / domestic-content
  // / low-income-community flags from the detail panel when those
  // toggles ship.
  //
  // §50(c) basis reduction = 50% × ITC%; depreciable basis = invest
  // × (1 − 0.5 × 0.30) = 85% × investment. With 100% bonus (post-
  // OBBBA permanent), full 85% deducts in Year 1.
  //
  // §469 passive-activity trap is real but not modeled here — the
  // calc returns the gross benefit; advisor applies the §469 filter
  // at engagement time. Refinement: gate netBenefit on a passive
  // toggle.
  // ----------------------------------------------------------------
  function _calcSolarItc() {
    var cfg = _cfg(); if (!cfg) return _writeResult('solarITC', null);
    var st = _state('solarITC');
    var inv = Math.max(0, _num(st.solarInvestment));
    if (inv <= 0) return _writeResult('solarITC', null);
    var fed = _fedMarginal(cfg);
    var st_ = _stateMarginal(cfg);
    var marginal = fed + st_;
    var itcRate = 0.30;                      // PWA / <1MW assumed
    var itcDollars = inv * itcRate;          // dollar-for-dollar credit
    var depreciableBasis = inv * (1 - 0.5 * itcRate); // 85% of inv
    var bonusValue = depreciableBasis * marginal;     // 100% bonus Year 1
    var netBenefit = itcDollars + bonusValue;
    _writeResult('solarITC', {
      netBenefit: Math.round(netBenefit),
      investment: Math.round(inv),
      marginalRate: marginal,
      detail: {
        itc:           Math.round(itcDollars),
        bonusValue:    Math.round(bonusValue),
        depreciableBasis: Math.round(depreciableBasis)
      }
    });
  }

  // ----------------------------------------------------------------
  // Strategy 8 — §181 Film / TV / Live Theatrical / Sound Recording
  //
  // §181 itself sunsets 12/31/2025 — productions commencing 1/1/2026
  // or later cannot elect §181. For 2026, the effective lever is
  // §168(k) 100% bonus depreciation at PIS (OBBBA permanent for
  // property acquired after 1/19/2025). Functionally equivalent NPV
  // to §181 for film property (5-yr or shorter recovery offset by
  // immediate expensing).
  //
  // Net benefit = investment × (federal + state) marginal — assuming
  // active material participation. §469 / §465 / basis filters are
  // an advisor-side check.
  // ----------------------------------------------------------------
  function _calcFilm181() {
    var cfg = _cfg(); if (!cfg) return _writeResult('film181', null);
    var st = _state('film181');
    var inv = Math.max(0, _num(st.filmInvestment));
    if (inv <= 0) return _writeResult('film181', null);
    // Per-production cap: $15M (or $20M if low-income area). Cap at
    // $15M conservatively; user can override in detail later.
    var capped = Math.min(inv, 15000000);
    var fed = _fedMarginal(cfg);
    var st_ = _stateMarginal(cfg);
    var marginal = fed + st_;
    var netBenefit = capped * marginal;
    _writeResult('film181', {
      netBenefit: Math.round(netBenefit),
      investment: Math.round(capped),
      marginalRate: marginal,
      detail: { deduction: Math.round(capped) }
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
