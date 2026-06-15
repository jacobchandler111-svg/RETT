// FILE: js/04-ui/supplemental-render.js
// Renders Page 4 (Supplemental Strategies). Each card mirrors the
// Page-2 strategy-pick-card identity exactly so Pages 2 and 4 read
// as one workflow: pick a sale structure on Page 2, pick supplemental
// strategies on Page 4, see the combined math on Page 5.
//
// Currently shipping: Oil & Gas Working Interest, Delphi Fund.
//
// Lego-piece architecture:
//   - Each card has Interested / Not Interested + a small chevron
//     under the Interested button that opens a Details panel with
//     just the knobs the advisor needs (per-strategy).
//   - Math runs silently on every relevant input change. The latest
//     result is parked at
//       window.__rettSupplemental[strategyKey].lastResult
//     so the future unified solver / Page-5 renderer can read it
//     without re-computing.
//   - Interest state is the lego pin:
//       window.__rettSupplementalInterest = { oilGas, delphi, ... }
//     The solver legs each strategy in iff interest === true.
//
// Adding a new strategy = (a) write a calc-<name>.js with a pure
// computeXYearN() function, (b) add an entry to STRATEGIES below
// with its key + render functions, (c) add a state subtree.

(function (root) {
  'use strict';

  var STATE_KEY    = '__rettSupplemental';
  var INTEREST_KEY = '__rettSupplementalInterest';
  var YEAR_HARD_CAP = 7;

  var DEFAULTS = {
    oilGas: { maxInvestment: 250000, depreciationPct: 0.95 },
    delphi: { classKey: 'classB', investment: 1000000 }
  };

  var _p5Timer;
  function _scheduleP5Refresh() {
    clearTimeout(_p5Timer);
    _p5Timer = setTimeout(function () {
      // Conservation (advisor 2026-05-06): toggling Interested or
      // changing a max-investment input changes the rivalry-funded
      // supplemental total, which changes Brooklyn's effective pool.
      // Run the full pipeline first so __lastResult / cfg.investment
      // reflect the new allocation BEFORE Page 5 reads from it.
      // Without this, the displayed Brooklyn deployment lags behind
      // the supp toggle until another input change kicks the pipeline.
      if (typeof root.runFullPipeline === 'function') {
        try { root.runFullPipeline(); } catch (e) { /* */ }
      }
      if (typeof root.renderStrategySummary === 'function') {
        try { root.renderStrategySummary(); } catch (e) { /* */ }
      }
    }, 120);
  }

  function _state() {
    if (!root[STATE_KEY]) {
      root[STATE_KEY] = {
        oilGas: { interest: null, maxInvestment: DEFAULTS.oilGas.maxInvestment,
                  depreciationPct: DEFAULTS.oilGas.depreciationPct,
                  detailsOpen: false, valueOpen: false, lastResult: null },
        delphi: { interest: null, classKey: DEFAULTS.delphi.classKey,
                  investment: DEFAULTS.delphi.investment,
                  detailsOpen: false, valueOpen: false, lastResult: null }
      };
    }
    var s = root[STATE_KEY];

    // ---- Oil & Gas migration / defaults ----
    if (!s.oilGas) s.oilGas = {};
    if (typeof s.oilGas.interest === 'undefined') s.oilGas.interest = null;
    if (Array.isArray(s.oilGas.years)) {
      var totalInv = 0, firstPct = DEFAULTS.oilGas.depreciationPct;
      for (var i = 0; i < s.oilGas.years.length; i++) {
        totalInv += Number(s.oilGas.years[i] && s.oilGas.years[i].investment) || 0;
        if (i === 0 && Number.isFinite(s.oilGas.years[0].idcPct)) firstPct = s.oilGas.years[0].idcPct;
      }
      s.oilGas.maxInvestment   = totalInv > 0 ? totalInv : DEFAULTS.oilGas.maxInvestment;
      s.oilGas.depreciationPct = firstPct;
      delete s.oilGas.years;
    }
    if (!Number.isFinite(s.oilGas.maxInvestment))   s.oilGas.maxInvestment   = DEFAULTS.oilGas.maxInvestment;
    if (!Number.isFinite(s.oilGas.depreciationPct)) s.oilGas.depreciationPct = DEFAULTS.oilGas.depreciationPct;
    if (typeof s.oilGas.detailsOpen === 'undefined') s.oilGas.detailsOpen = false;
    if (typeof s.oilGas.valueOpen === 'undefined')   s.oilGas.valueOpen   = false;

    // ---- Delphi defaults ----
    if (!s.delphi) s.delphi = {};
    if (typeof s.delphi.interest === 'undefined') s.delphi.interest = null;
    if (s.delphi.classKey !== 'classA' && s.delphi.classKey !== 'classB') s.delphi.classKey = DEFAULTS.delphi.classKey;
    if (!Number.isFinite(s.delphi.investment))    s.delphi.investment    = DEFAULTS.delphi.investment;
    if (typeof s.delphi.detailsOpen === 'undefined') s.delphi.detailsOpen = false;
    if (typeof s.delphi.valueOpen === 'undefined')   s.delphi.valueOpen   = false;

    return s;
  }

  function _interestState() {
    if (!root[INTEREST_KEY]) root[INTEREST_KEY] = { oilGas: null, delphi: null };
    if (typeof root[INTEREST_KEY].oilGas === 'undefined') root[INTEREST_KEY].oilGas = null;
    if (typeof root[INTEREST_KEY].delphi === 'undefined') root[INTEREST_KEY].delphi = null;
    return root[INTEREST_KEY];
  }

  function _val(id) { var el = document.getElementById(id); return el ? el.value : ''; }
  function _fmtMoney(n) {
    if (!Number.isFinite(n)) return '$0';
    var sign = n < 0 ? '-' : '';
    return sign + '$' + Math.round(Math.abs(n)).toLocaleString('en-US');
  }
  function _fmtUSD(n) {
    return (typeof fmtUSD === 'function') ? fmtUSD(n) : _fmtMoney(n);
  }
  function _interestClassFor(target) {
    var s = _interestState()[target];
    if (s === true)  return 'is-interested';
    if (s === false) return 'is-not-interested';
    return '';
  }

  // Per-button "active" class so the button itself visually darkens
  // when its action matches the current interest state. Mirrors the
  // Page-2 _refreshStrategyPickCards behavior.
  function _btnActiveClass(target, action) {
    var s = _interestState()[target];
    var on = (action === 'interested' && s === true) ||
             (action === 'not-interested' && s === false);
    return on ? ' is-' + action : '';
  }

  function _netBenefitForKey(key) {
    if (typeof root.getSupplemental !== 'function') return null;
    var spec = root.getSupplemental(key);
    if (!spec || typeof spec.getResult !== 'function' || typeof spec.getNetBenefit !== 'function') return null;
    var result = spec.getResult();
    if (!result) return null;
    var v = Number(spec.getNetBenefit(result));
    return Number.isFinite(v) ? v : null;
  }

  function _renderValueArrow(key, st) {
    // Value Added is hidden on the Tab-5 supp cards (advisor 2026-06-12);
    // value is shown only on the Strategy Summary. Returning '' removes the
    // arrow without touching the card template or the (now-inert) toggle handler.
    return '';
    var openCls = st.valueOpen ? ' is-open' : '';
    return '' +
      '<button type="button" class="supp-details-arrow supp-value-arrow' + openCls + '" ' +
          'data-supp-value-target="' + key + '" ' +
          'aria-expanded="' + (st.valueOpen ? 'true' : 'false') + '" ' +
          'title="' + (st.valueOpen ? 'Hide value' : 'Show value added') + '">' +
        '<span class="supp-details-arrow-chev" aria-hidden="true">&#9662;</span>' +
        '<span class="supp-details-arrow-label">Value Added</span>' +
      '</button>';
  }

  function _renderValuePanel(key, st) {
    return '';   // Value Added hidden on supp cards (advisor 2026-06-12) — see _renderValueArrow
    var benefit = _netBenefitForKey(key);
    var display = (benefit !== null) ? _fmtUSD(benefit) : '—';
    var label   = (benefit !== null && benefit >= 0) ? 'Tax Savings Added' : 'Net Impact';
    return '' +
      '<div class="supp-value-panel"' + (st.valueOpen ? '' : ' hidden') + '>' +
        '<div class="supp-value-row">' +
          '<span class="supp-value-label">' + label + '</span>' +
          '<span class="supp-value-amt">' + display + '</span>' +
        '</div>' +
      '</div>';
  }

  // -----------------------------------------------------------------
  // Strategy: OIL & GAS
  // -----------------------------------------------------------------

  function _resolvedSaleStrategyKey() {
    var chosen = root.__rettChosenStrategy;
    if (chosen === 'A' || chosen === 'B' || chosen === 'C') return chosen;
    var interest = root.__rettStrategyInterest || {};
    if (interest.C === true) return 'C';
    if (interest.B === true) return 'B';
    if (interest.A === true) return 'A';
    return 'A';
  }
  function _yearCountForSaleStrategy(key) {
    if (key === 'A') return 1;
    if (key === 'B') return 2;
    // Strategy C: derive year count from the structured-sale duration.
    // Source priority:
    //   1. When auto-pick is enabled (default): __lastResult.config —
    //      whatever duration the auto-picker chose, so the supplemental
    //      year count matches what Page 3 / Page 5 actually run.
    //   2. When auto-pick is disabled: form input (advisor manually
    //      typed a duration and we must honor it without overlay).
    //   3. Form input even when auto-pick is on if __lastResult is
    //      missing (first render before pipeline has populated it).
    //   4. 36-month MetLife minimum as last-resort fallback.
    // Without rule (1), supps were sizing for the form value (e.g.
    // 60mo → 6 years) while the actual engine ran the auto-picked
    // value (e.g. 72mo → 7 years), so charitable annual giving and
    // O&G/Delphi multi-year disagreed on the horizon.
    var autoPickOn = (typeof root.__rettAutoPickEnabled === 'undefined') ||
                     root.__rettAutoPickEnabled !== false;
    var lastDur = (root.__lastResult && root.__lastResult.config &&
                   Number(root.__lastResult.config.structuredSaleDurationMonths)) || 0;
    var formDur = parseInt(_val('structured-sale-duration-months'), 10);
    var months;
    if (autoPickOn && lastDur > 0) {
      months = lastDur;
    } else if (Number.isFinite(formDur) && formDur > 0) {
      months = formDur;
    } else if (lastDur > 0) {
      months = lastDur;
    } else {
      months = 36;  // MetLife minimum
    }
    var years = Math.max(1, Math.ceil((months + 6) / 12));
    if (years > YEAR_HARD_CAP) years = YEAR_HARD_CAP;
    return years;
  }
  function _oilGasResolvedYears() {
    var st = _state().oilGas;
    var key = _resolvedSaleStrategyKey();
    var count = _yearCountForSaleStrategy(key);
    var maxInv = st.maxInvestment || 0;
    var pct = st.depreciationPct;
    // Y0 includes §1250 recap; Y1+ doesn't (§453(i) — recap is sale-year-only).
    var meta = [];
    for (var i = 0; i < count; i++) meta.push({ includeRecap: (i === 0) });
    // For B/C (count > 1) the per-year yield optimizer decides how much
    // of maxInvestment to deploy in each recognition year. Y0 absorbs at
    // the higher marginal ordinary rate (recap-driven), so the optimizer
    // typically front-loads. For A (count === 1) there's only one year
    // — the optimizer trivially returns [{investment: maxInv}].
    if (typeof root.optimizeOilGasMultiYear === 'function') {
      return root.optimizeOilGasMultiYear(maxInv, pct, meta);
    }
    // Fallback: even split (legacy behavior pre-2026-05-09).
    var per = maxInv / count;
    return meta.map(function (m) {
      return { investment: per, idcPct: pct, includeRecap: m.includeRecap };
    });
  }
  function _oilGasIconSVG() {
    return '' +
      '<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' +
        '<path d="M6 42 L42 42"/>' +
        '<path d="M14 42 L14 28 L26 28 L26 42"/>' +
        '<circle cx="20" cy="28" r="2"/>' +
        '<path d="M20 28 L34 16"/>' +
        '<path d="M30 14 L38 18 L34 22 Z"/>' +
        '<path d="M14 28 L8 30"/>' +
      '</svg>';
  }
  function _renderOilGasCard() {
    var st = _state().oilGas;
    var key = _resolvedSaleStrategyKey();
    var count = _yearCountForSaleStrategy(key);
    var interestCls = _interestClassFor('oilGas');
    var detailsOpenCls = st.detailsOpen ? ' is-open' : '';
    var maxInvDisplay = _fmtUSD(st.maxInvestment);
    var deprPctDisplay = Math.round(st.depreciationPct * 100);

    var hiddenCls = (root.__rettSuppHidden && root.__rettSuppHidden.oilGas) ? ' is-supp-hidden' : '';
    return '' +
      '<div class="strategy-pick-card supp-strategy-card ' + interestCls + hiddenCls + '" data-supp-strategy="oilGas">' +
        '<div class="strategy-pick-card-header">' +
          '<div class="strategy-pick-num supp-num-clickable" role="button" tabindex="0" title="Click to hide this card" data-supp-hide-target="oilGas">SUPPLEMENTAL <span class="num-big"></span></div>' +
        '</div>' +
        '<h3 class="strategy-pick-name">Oil &amp; Gas Working Interest</h3>' +
        '<div class="strategy-keyaspect">' +
          '<div class="strategy-keyaspect-label">Ordinary Income Offset</div>' +
          '<p class="strategy-keyaspect-body">Investments into oil and gas generate ordinary income deductions.</p>' +
        '</div>' +
        '<div class="strategy-lockup-graphic" data-lockup-style="ordinary">' +
          '<span class="strategy-lockup-icon" aria-hidden="true">' + _oilGasIconSVG() + '</span>' +
          '<div class="strategy-lockup-text">' +
            '<span class="strategy-lockup-value">Ordinary Income Deduction</span>' +
          '</div>' +
        '</div>' +
        '<div class="strategy-pick-buttons">' +
          '<button type="button" class="strategy-pick-btn supp-pick-btn' + _btnActiveClass('oilGas', 'interested') + '" data-supp-pick-action="interested" data-supp-pick-target="oilGas">&#10003; Interested</button>' +
          '<button type="button" class="strategy-pick-btn supp-pick-btn' + _btnActiveClass('oilGas', 'not-interested') + '" data-supp-pick-action="not-interested" data-supp-pick-target="oilGas">Not Interested</button>' +
        '</div>' +
        '<button type="button" class="supp-details-arrow' + detailsOpenCls + '" data-supp-details-target="oilGas" aria-expanded="' + (st.detailsOpen ? 'true' : 'false') + '" aria-controls="supp-details-oilGas" title="' + (st.detailsOpen ? 'Hide details' : 'Show details') + '">' +
          '<span class="supp-details-arrow-chev" aria-hidden="true">&#9662;</span>' +
          '<span class="supp-details-arrow-label">Details</span>' +
        '</button>' +
        '<div class="supp-details-panel" id="supp-details-oilGas"' + (st.detailsOpen ? '' : ' hidden') + '>' +
          '<div class="supp-details-row">' +
            '<div class="supp-details-rowlabel">Max Investment</div>' +
            '<div class="supp-details-cell"><div class="currency-input"><input type="text" id="supp-oilgas-max" inputmode="numeric" autocomplete="off" value="' + maxInvDisplay + '"></div></div>' +
          '</div>' +
          '<div class="supp-details-row">' +
            '<div class="supp-details-rowlabel">Depreciation %</div>' +
            '<div class="supp-details-cell"><div class="currency-input percent"><input type="number" id="supp-oilgas-pct" min="0" max="100" step="1" value="' + deprPctDisplay + '"><span class="pct-suffix" aria-hidden="true">%</span></div></div>' +
          '</div>' +
        '</div>' +
        _renderValueArrow('oilGas', st) +
        _renderValuePanel('oilGas', st) +
      '</div>';
  }
  function _runOilGasMath() {
    if (typeof root.computeOilGasMultiYear !== 'function') return;
    var st = _state().oilGas;
    try { st.lastResult = root.computeOilGasMultiYear(_oilGasResolvedYears()); }
    catch (e) { st.lastResult = null; }
  }

  // -----------------------------------------------------------------
  // Strategy: DELPHI
  // -----------------------------------------------------------------

  function _delphiClassMeta(key) {
    var DS = root.DELPHI_STRATEGIES || {};
    return DS[key] || DS.classB || { name: 'Class B', minInvestment: 1000000, managementFee: 0.02, liquidity: 'Quarterly' };
  }
  function _delphiIconSVG() {
    // Two arrows in opposite directions — visualizes character
    // conversion (ordinary → preferential-rate capital gain).
    return '' +
      '<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' +
        '<path d="M10 17 L36 17"/>' +
        '<path d="M30 11 L36 17 L30 23"/>' +
        '<path d="M38 31 L12 31"/>' +
        '<path d="M18 25 L12 31 L18 37"/>' +
      '</svg>';
  }
  function _renderDelphiCard() {
    var st = _state().delphi;
    var meta = _delphiClassMeta(st.classKey);
    var interestCls = _interestClassFor('delphi');
    var detailsOpenCls = st.detailsOpen ? ' is-open' : '';
    var invDisplay = _fmtUSD(st.investment);
    var minNotMet = st.investment > 0 && st.investment < meta.minInvestment;

    // Class picker hidden per advisor 2026-05-06 — class is auto-picked
    // from investment (Class A at $5M+, Class B otherwise; A wins on
    // lower fee). Kept the change handler in place for back-compat with
    // any saved state the user may load with a class explicitly set.
    var minWarning = minNotMet
      ? '<p class="supp-min-warning">Below the ' + _fmtUSD(meta.minInvestment) + ' minimum for ' + meta.name + '. Math runs proportionally; fund won&rsquo;t accept the subscription as-is.</p>'
      : '';

    var hiddenCls = (root.__rettSuppHidden && root.__rettSuppHidden.delphi) ? ' is-supp-hidden' : '';
    return '' +
      '<div class="strategy-pick-card supp-strategy-card ' + interestCls + hiddenCls + '" data-supp-strategy="delphi">' +
        '<div class="strategy-pick-card-header">' +
          '<div class="strategy-pick-num supp-num-clickable" role="button" tabindex="0" title="Click to hide this card" data-supp-hide-target="delphi">SUPPLEMENTAL <span class="num-big"></span></div>' +
        '</div>' +
        '<h3 class="strategy-pick-name">Delphi Fund</h3>' +
        '<div class="strategy-keyaspect">' +
          '<div class="strategy-keyaspect-label">Character Conversion</div>' +
          '<p class="strategy-keyaspect-body">Hedge fund strategy that offers tax benefits.</p>' +
        '</div>' +
        '<div class="strategy-lockup-graphic" data-lockup-style="exchange">' +
          '<span class="strategy-lockup-icon" aria-hidden="true">' + _delphiIconSVG() + '</span>' +
          '<div class="strategy-lockup-text">' +
            '<span class="strategy-lockup-value">Rate Arbitrage</span>' +
          '</div>' +
        '</div>' +
        '<div class="strategy-pick-buttons">' +
          '<button type="button" class="strategy-pick-btn supp-pick-btn' + _btnActiveClass('delphi', 'interested') + '" data-supp-pick-action="interested" data-supp-pick-target="delphi">&#10003; Interested</button>' +
          '<button type="button" class="strategy-pick-btn supp-pick-btn' + _btnActiveClass('delphi', 'not-interested') + '" data-supp-pick-action="not-interested" data-supp-pick-target="delphi">Not Interested</button>' +
        '</div>' +
        '<button type="button" class="supp-details-arrow' + detailsOpenCls + '" data-supp-details-target="delphi" aria-expanded="' + (st.detailsOpen ? 'true' : 'false') + '" aria-controls="supp-details-delphi" title="' + (st.detailsOpen ? 'Hide details' : 'Show details') + '">' +
          '<span class="supp-details-arrow-chev" aria-hidden="true">&#9662;</span>' +
          '<span class="supp-details-arrow-label">Details</span>' +
        '</button>' +
        '<div class="supp-details-panel" id="supp-details-delphi"' + (st.detailsOpen ? '' : ' hidden') + '>' +
          '<div class="supp-details-row">' +
            '<div class="supp-details-rowlabel">Max Investment</div>' +
            '<div class="supp-details-cell"><div class="currency-input"><input type="text" id="supp-delphi-inv" inputmode="numeric" autocomplete="off" value="' + invDisplay + '"></div></div>' +
          '</div>' +
          minWarning +
        '</div>' +
        _renderValueArrow('delphi', st) +
        _renderValuePanel('delphi', st) +
      '</div>';
  }
  function _runDelphiMath() {
    var st = _state().delphi;
    var key = _resolvedSaleStrategyKey();
    var count = _yearCountForSaleStrategy(key);
    try {
      // Strategy A (count === 1) — single-year shape, preserve back-compat.
      if (count <= 1) {
        if (typeof root.computeDelphiYear1 !== 'function') { st.lastResult = null; return; }
        st.lastResult = root.computeDelphiYear1({
          classKey:   st.classKey,
          investment: st.investment
        });
        return;
      }
      // Strategy B/C — per-year yield optimizer decides Y0/Y1+ split of
      // the user's dialed maxInvestment (st.investment is the budget
      // ceiling; optimizer may deploy less if extra dollars become NOL).
      if (typeof root.optimizeDelphiMultiYear !== 'function' ||
          typeof root.computeDelphiMultiYear !== 'function') {
        st.lastResult = null; return;
      }
      var meta = [];
      for (var i = 0; i < count; i++) meta.push({ includeRecap: (i === 0) });
      var years = root.optimizeDelphiMultiYear(st.investment || 0, st.classKey, meta);
      st.lastResult = root.computeDelphiMultiYear(years, st.classKey);
    } catch (e) { st.lastResult = null; }
  }

  // -----------------------------------------------------------------
  // Public lego pins for the future solver
  // -----------------------------------------------------------------
  function getOilGasConfiguredYears() { return _oilGasResolvedYears(); }
  function getDelphiConfiguration() {
    var st = _state().delphi;
    return { classKey: st.classKey, investment: st.investment };
  }

  // -----------------------------------------------------------------
  // Host render + event delegation
  // -----------------------------------------------------------------
  var _CARD_RENDERERS = {
    oilGas: _renderOilGasCard,
    delphi:  _renderDelphiCard
  };
  var _CARD_ORDER = ['oilGas', 'delphi'];

  function _renderHost() {
    var host = document.getElementById('supplemental-strategies-host');
    if (!host) return;
    var iState = _interestState();
    var sorted = _CARD_ORDER.slice().sort(function (a, b) {
      var an = iState[a] === false ? 1 : 0;
      var bn = iState[b] === false ? 1 : 0;
      return an - bn;
    });
    var cards = sorted.map(function (k) { return _CARD_RENDERERS[k](); }).join('');
    host.innerHTML = '<div class="supp-strategies-grid">' + cards + '</div>';
    _bindEvents();
  }

  // Persist current state to localStorage via case-storage. Skipped
  // when the harness is mid-restore (a save during restore would
  // overwrite freshly-restored state with whatever the form was
  // showing one tick earlier).
  function _persist() {
    if (root.__rettApplyingState) return;
    var s = root.RETTCaseStorage;
    if (!s) return;
    // autoSaveCurrent routes to the active named case (if any) or the
    // un-named draft. Falls back to saveWorkingState when called from
    // a build that pre-dates the autoSaveCurrent API.
    if (typeof s.autoSaveCurrent === 'function') {
      try { s.autoSaveCurrent(); } catch (e) { /* */ }
    } else if (typeof s.saveWorkingState === 'function') {
      try { s.saveWorkingState(); } catch (e) { /* */ }
    }
  }

  function _bindEvents() {
    var host = document.getElementById('supplemental-strategies-host');
    if (!host) return;
    if (host.dataset.bound) return;
    host.dataset.bound = '1';

    host.addEventListener('click', function (ev) {
      var t = ev.target;
      if (!t) return;

      // Click the SUPPLEMENTAL number badge to hide the card.
      // Independent of Interested/Not Interested state - just a visual
      // hide so the advisor can quickly cull cards during a meeting.
      // The "Reset supplemental selections" button at the top brings
      // hidden cards back along with clearing all other supp state.
      var hideBtn = t.closest && t.closest('[data-supp-hide-target]');
      if (hideBtn) {
        var hideId = hideBtn.getAttribute('data-supp-hide-target');
        if (!root.__rettSuppHidden) root.__rettSuppHidden = {};
        root.__rettSuppHidden[hideId] = true;
        // Re-render both hosts so the CSS counter renumbers the
        // remaining visible cards across the unified grid.
        if (typeof root.renderSupplementalPage === 'function') {
          try { root.renderSupplementalPage(); } catch (e) { _renderHost(); }
        } else {
          _renderHost();
          if (typeof root.renderSupplementalExtra === 'function') {
            try { root.renderSupplementalExtra(); } catch (e) { /* */ }
          }
        }
        _persist();
        return;
      }

      // Interested / Not Interested
      var pickBtn = t.closest && t.closest('[data-supp-pick-action]');
      if (pickBtn) {
        var target = pickBtn.getAttribute('data-supp-pick-target');
        var action = pickBtn.getAttribute('data-supp-pick-action');
        var newVal = (action === 'interested') ? true : false;
        var iState = _interestState();
        iState[target] = (iState[target] === newVal) ? null : newVal;
        _renderHost();
        _runAllMath();
        _persist();
        return;
      }

      // Details disclosure
      var detailsBtn = t.closest && t.closest('[data-supp-details-target]');
      if (detailsBtn) {
        var dTarget = detailsBtn.getAttribute('data-supp-details-target');
        var s = _state()[dTarget];
        if (s) {
          s.detailsOpen = !s.detailsOpen;
          _renderHost();
          _persist();
        }
        return;
      }

      // Value disclosure
      var valueBtn = t.closest && t.closest('[data-supp-value-target]');
      if (valueBtn) {
        var vTarget = valueBtn.getAttribute('data-supp-value-target');
        var vs = _state()[vTarget];
        if (vs) {
          vs.valueOpen = !vs.valueOpen;
          _renderHost();
          _persist();
        }
        return;
      }
    });

    host.addEventListener('input',  _onInputDelegate);
    host.addEventListener('change', _onChangeDelegate);
    host.addEventListener('blur',   _onBlurDelegate, true);
  }

  function _onInputDelegate(ev) {
    var t = ev.target;
    if (!t) return;
    var s = _state();

    if (t.id === 'supp-oilgas-max') {
      var v = (typeof parseUSD === 'function') ? parseUSD(t.value) : Number(t.value);
      s.oilGas.maxInvestment = Math.max(0, Number.isFinite(v) ? v : 0);
      if (!s.oilGas._userTouched) s.oilGas._userTouched = {};
      s.oilGas._userTouched.maxInvestment = true;
      // User-OVERRIDE: an explicitly typed amount is respected by the
      // auto-sizer (clamped at the per-supp cap) instead of being
      // overwritten. Distinct from _userTouched, which the sweep also sets.
      if (!s.oilGas._userOverride) s.oilGas._userOverride = {};
      s.oilGas._userOverride.maxInvestment = true;
      _runOilGasMath();
      _persist();
      // Page-5 Strategy Summary depends on the supplemental allocator
      // output (it shows the combined net benefit and the future-sale
      // option block). Without this refresh, dropping oil & gas
      // investment to $0 leaves Page 5 still showing the old combined
      // numbers — the user has to manually navigate away and back.
      _scheduleP5Refresh();
    } else if (t.id === 'supp-oilgas-pct') {
      var raw = parseFloat(t.value);
      if (!Number.isFinite(raw)) raw = DEFAULTS.oilGas.depreciationPct * 100;
      if (raw < 0) raw = 0;
      if (raw > 100) raw = 100;
      s.oilGas.depreciationPct = raw / 100;
      _runOilGasMath();
      _persist();
      _scheduleP5Refresh();
    } else if (t.id === 'supp-delphi-inv') {
      var dv = (typeof parseUSD === 'function') ? parseUSD(t.value) : Number(t.value);
      s.delphi.investment = Math.max(0, Number.isFinite(dv) ? dv : 0);
      if (!s.delphi._userTouched) s.delphi._userTouched = {};
      s.delphi._userTouched.investment = true;
      // User-OVERRIDE: respected by the auto-sizer (clamped at cap).
      if (!s.delphi._userOverride) s.delphi._userOverride = {};
      s.delphi._userOverride.investment = true;
      // Auto-pick class from amount (advisor 2026-05-06): Class A at the
      // $5M minimum and above (1.75% fee), Class B otherwise (2% fee).
      // The picker UI is hidden — investment is the only knob the
      // advisor turns and the lower-fee class wins whenever the
      // minimum is met.
      s.delphi.classKey = s.delphi.investment >= 5000000 ? 'classA' : 'classB';
      _runDelphiMath();
      // Re-render only the Delphi card body to reflect the min-warning
      // and the lockup sub label without losing input focus. Easiest:
      // re-render whole host but restore focus to the input afterwards.
      _renderHostKeepFocus(t.id);
      _persist();
      _scheduleP5Refresh();
    }
  }

  function _onChangeDelegate(ev) {
    var t = ev.target;
    if (!t) return;
    if (t.id === 'supp-delphi-class') {
      var val = t.value;
      if (val !== 'classA' && val !== 'classB') return;
      _state().delphi.classKey = val;
      _runDelphiMath();
      _renderHostKeepFocus(t.id);
      _persist();
      _scheduleP5Refresh();
    }
  }

  function _onBlurDelegate(ev) {
    var t = ev.target;
    if (!t) return;
    var s = _state();
    if (t.id === 'supp-oilgas-max') {
      t.value = _fmtUSD(s.oilGas.maxInvestment);
    } else if (t.id === 'supp-delphi-inv') {
      t.value = _fmtUSD(s.delphi.investment);
    }
  }

  function _renderHostKeepFocus(id) {
    _renderHost();
    if (!id) return;
    var el = document.getElementById(id);
    if (el && typeof el.focus === 'function') {
      try {
        el.focus();
        if (typeof el.setSelectionRange === 'function' && el.value != null) {
          var len = el.value.length;
          el.setSelectionRange(len, len);
        }
      } catch (e) { /* */ }
    }
  }

  function _runAllMath() {
    _runOilGasMath();
    _runDelphiMath();
    // Also recompute the EXTRA supplementals (Equipment Leasing, Augusta,
    // Farm, PTET, …). Without this, the auto-sizer — which calls this after
    // setting each candidate investment size — would size the extra supps
    // against a STALE result, leaving Equipment Leasing / Farm unavailable
    // and always sized to $0 (advisor 2026-06-10). The core O&G/Delphi math
    // ran here already; the extra-supp calc lives in calc-supplemental-extra.
    if (typeof root.recomputeSupplementalExtra === 'function') {
      try { root.recomputeSupplementalExtra(); } catch (e) { /* */ }
    }
    _scheduleP5Refresh();
  }

  // Seed sale-derived defaults into oilGas / delphi state when the
  // user hasn't manually entered a value. Runs each renderSupplementalPage
  // tick — every change to sale-price / cost-basis re-fires this and
  // updates the displayed defaults. Once the user types a value the
  // _userTouched flag locks it in. (Per advisor: O&G ≈ 5% of sale,
  // Delphi ≈ 25% of sale, but Delphi sits at $0 if 25% × sale doesn't
  // clear the class B $1M minimum.)
  function _seedFromSale() {
    var s = _state();
    var salePrice = 0;
    if (typeof window.collectInputs === 'function') {
      try {
        var cfg = window.collectInputs();
        salePrice = Math.max(0, Number(cfg && cfg.salePrice) || 0);
      } catch (e) { return; }
    }
    if (salePrice <= 0) return;
    if (!(s.oilGas._userTouched && s.oilGas._userTouched.maxInvestment)) {
      // 5% of sale price — matches the per-supp auto-size cap (advisor
      // 2026-06-11, tightened from 10%; the engine sweeps [0..5% of sale]).
      s.oilGas.maxInvestment = Math.round(salePrice * 0.05);
    }
    if (!(s.delphi._userTouched && s.delphi._userTouched.investment)) {
      var pct25 = salePrice * 0.25;
      // Auto-pick: Class A min $5M; Class B min $1M. Set the class
      // first so renderDelphiCard shows the matching min-warning.
      if (pct25 >= 5000000) {
        s.delphi.investment = Math.round(pct25);
        s.delphi.classKey = 'classA';
      } else if (pct25 >= 1000000) {
        s.delphi.investment = Math.round(pct25);
        s.delphi.classKey = 'classB';
      } else {
        s.delphi.investment = 0;
      }
    }
  }

  function renderSupplementalPage() {
    if (!document.getElementById('supplemental-strategies-host')) return;
    _seedFromSale();
    _renderHost();
    _runAllMath();
  }

  function _attachBaselineListeners() {
    var ids = [
      'year1', 'filing-status', 'state-code',
      'w2-wages', 'se-income', 'biz-revenue',
      'rental-income', 'dividend-income', 'retirement-distributions',
      'sale-price', 'cost-basis', 'accelerated-depreciation',
      'short-term-gain', 'structured-sale-duration-months'
    ];
    var debTimer;
    var rerun = function () {
      clearTimeout(debTimer);
      debTimer = setTimeout(function () {
        if (!document.getElementById('supplemental-strategies-host')) return;
        renderSupplementalPage();
      }, 150);
    };
    ids.forEach(function (id) {
      var el = document.getElementById(id);
      if (!el) return;
      el.addEventListener('input',  rerun);
      el.addEventListener('change', rerun);
    });
  }

  function _attach() {
    renderSupplementalPage();
    _attachBaselineListeners();

    var navSupp = document.getElementById('nav-supplemental');
    if (navSupp) navSupp.addEventListener('click', function () {
      setTimeout(renderSupplementalPage, 0);
    });

    // Strategy-pick clicks on Page 2 don't fire a global event; poll
    // lazily — only when Page 4 is on screen. Affects Oil & Gas's
    // year-count detection.
    var lastKey = _resolvedSaleStrategyKey();
    setInterval(function () {
      var page4 = document.getElementById('page-supplemental');
      if (!page4 || !page4.classList.contains('active')) return;
      var k = _resolvedSaleStrategyKey();
      if (k !== lastKey) {
        lastKey = k;
        renderSupplementalPage();
      }
    }, 500);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _attach);
  } else {
    _attach();
  }

  // New Client reset: clear interest, zero max-investment (and
  // delphi.investment), but KEEP rate defaults — oil & gas
  // depreciationPct stays at 0.95, delphi classKey stays at the
  // default class. Mirrors the advisor's instruction that dollar
  // inputs blank but the depreciation percent (95% O&G, etc.)
  // survives.
  function _resetState() {
    root[STATE_KEY] = {
      oilGas: { interest: null, maxInvestment: 0, depreciationPct: DEFAULTS.oilGas.depreciationPct,
                detailsOpen: false, valueOpen: false, lastResult: null },
      delphi: { interest: null, classKey: DEFAULTS.delphi.classKey, investment: 0,
                detailsOpen: false, valueOpen: false, lastResult: null }
    };
    root[INTEREST_KEY] = { oilGas: null, delphi: null };
    if (typeof renderSupplementalPage === 'function') {
      try { renderSupplementalPage(); } catch (e) { /* */ }
    }
  }

  root.renderSupplementalPage   = renderSupplementalPage;
  root.getOilGasConfiguredYears = getOilGasConfiguredYears;
  root.getDelphiConfiguration   = getDelphiConfiguration;
  root.resetSupplementalCore    = _resetState;
  // Exposed so other surfaces (strategy-summary-render, admin panel) can
  // force-recompute the supp math when the chosen strategy changes.
  // _runAllMath internally re-derives oilGas + delphi lastResult using
  // _resolvedSaleStrategyKey(), so calling it here picks up the new
  // year-count and per-year split. Without this, supp values stay frozen
  // at whatever strategy was active when the user last touched a supp
  // input field — the issue surfaced when Strategy A/B/C switches left
  // OG's perYearCount stuck at 1.
  root.__rettRunAllSuppMath     = _runAllMath;
})(window);
