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
    // Auto-fill state rate from the lookup table when the user has
    // not manually entered one (or has cleared it). User-entered
    // values still win — only an empty / 0 stateRate triggers the
    // table fallback.
    var rate = Math.max(0, _num(st.stateRate)) / 100;
    if (rate <= 0 && cfg.state && PTET_RATES_2026[cfg.state] != null) {
      rate = PTET_RATES_2026[cfg.state] / 100;
    }
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
  function _calcCharitableGifts() {
    var cfg = _cfg(); if (!cfg) return _writeResult('charitableGifts', null);
    var st = _state('charitableGifts');
    var amount = Math.max(0, _num(st.giftAmount));
    if (amount <= 0) return _writeResult('charitableGifts', null);

    var giftType = st.giftType || 'cash';
    var apprec   = Math.max(0, _num(st.appreciation));
    var agi      = Math.max(0, _num(st.agi));

    var fed = _fedMarginal(cfg);
    var stRate = _stateMarginal(cfg);
    var marginal = fed + stRate;

    // §170 percentage cap by gift type. When agi is provided, cap
    // the deductible amount; otherwise honor the user-entered amount
    // (5-yr carryover is automatic for excess so the long-run
    // benefit is not lost — flag in detail when capped).
    var pctCap = (giftType === 'appreciated') ? 0.30 : 0.60;
    var hardCap = (agi > 0) ? agi * pctCap : Infinity;
    var deductibleAmount = Math.min(amount, hardCap);

    // Federal + state deduction value.
    var deductionValue = deductibleAmount * marginal;

    // Appreciated-asset bonus: avoids capital-gains tax on the
    // unrealized gain portion. Use 23.8% blended rate (top LT cap
    // gain 20% + NIIT 3.8%) for HNW. Capped at the appreciation
    // amount that's actually deductible (the same 30% AGI ceiling
    // applies — appreciation > deductibleAmount × (apprec/amount)
    // can't be claimed and would carry over).
    var capGainAvoided = 0;
    if (giftType === 'appreciated' && apprec > 0 && amount > 0) {
      var apprecDeductible = deductibleAmount * (apprec / amount);
      capGainAvoided = apprecDeductible * 0.238;
    }

    var netBenefit = deductionValue + capGainAvoided;
    _writeResult('charitableGifts', {
      netBenefit: Math.round(netBenefit),
      investment: 0,            // gift, not investment — no rivalry
      marginalRate: marginal,
      detail: {
        giftAmount:       Math.round(amount),
        giftType:         giftType,
        deductibleAmount: Math.round(deductibleAmount),
        deductionValue:   Math.round(deductionValue),
        capGainAvoided:   Math.round(capGainAvoided),
        agiCapApplied:    deductibleAmount < amount,
        pctCap:           pctCap
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
  var _CALCS = {
    ptet:            _calcPtet,
    charitableGifts: _calcCharitableGifts
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

  // Driver — runs every registered calc, idempotent. Called on input
  // events (cfg or detail-panel changes) AND from the See Value
  // button so results are guaranteed fresh at click time.
  function recomputeAll() {
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
      // visible to avoid wasted work.
      var active = document.querySelector('.page.active');
      if (active && active.id === 'page-allocator' &&
          typeof root.renderStrategySummary === 'function') {
        try { root.renderStrategySummary(); } catch (e) { /* */ }
      }
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
