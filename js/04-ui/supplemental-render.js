// FILE: js/04-ui/supplemental-render.js
// Renders Page 4 (Supplemental Strategies). Each card mirrors the
// Page-2 strategy-pick-card identity exactly so Pages 2 and 4 read
// as one workflow: pick a sale structure on Page 2, pick supplemental
// strategies on Page 4, see the combined math on Page 5.
//
// Card UX (advisor convo 2026-05-05):
//   - The card's job is to capture INTEREST, not to display savings.
//   - A small chevron under the Interested button toggles a Details
//     drop-down with two knobs only:
//       * Max Investment (overall cap, NOT per-year)
//       * Depreciation %  (default 95)
//   - Math runs silently. The latest multi-year result is parked at
//       window.__rettSupplemental.oilGas.lastResult
//     so the future unified solver / Page-5 renderer can read it
//     without re-computing.
//   - The interest state is the lego pin:
//       window.__rettSupplementalInterest = { oilGas: true|false|null }
//     The solver legs this strategy in iff interest === true.
//
// Year-count detection comes from the picked sale structure on Page 2/3:
//   A (Sell Now)        → 1 year
//   B (Seller Finance)  → 2 years (sale year + Jan-1 payout)
//   C (Structured Sale) → derived from #structured-sale-duration-months
//                         (default 18 mo → 2 yrs; cap 7).
//
// Capital-allocation rule for now: Max Investment is split EVENLY
// across the detected investment years. The future unified solver
// will replace this with an optimal allocator (highest-marginal-rate
// year first, etc.). All years run against the SAME Y1 ordinary
// baseline (advisor's instruction: "keep year-one ordinary consistent
// across the years").

(function (root) {
  'use strict';

  var STATE_KEY            = '__rettSupplemental';
  var INTEREST_KEY         = '__rettSupplementalInterest';
  var DEFAULT_MAX_INV      = 250000;
  var DEFAULT_DEPR_PCT     = 0.95;
  var YEAR_HARD_CAP        = 7;

  function _state() {
    if (!root[STATE_KEY]) {
      root[STATE_KEY] = {
        oilGas: {
          interest: null,
          maxInvestment: DEFAULT_MAX_INV,
          depreciationPct: DEFAULT_DEPR_PCT,
          detailsOpen: false,
          lastResult: null
        }
      };
    }
    var st = root[STATE_KEY].oilGas;
    if (typeof st.interest === 'undefined') st.interest = null;
    // Migrate any old per-year shape into the simplified scalar form.
    if (Array.isArray(st.years)) {
      var totalInv = 0, firstPct = DEFAULT_DEPR_PCT;
      for (var i = 0; i < st.years.length; i++) {
        totalInv += Number(st.years[i] && st.years[i].investment) || 0;
        if (i === 0 && Number.isFinite(st.years[0].idcPct)) firstPct = st.years[0].idcPct;
      }
      st.maxInvestment   = totalInv > 0 ? totalInv : DEFAULT_MAX_INV;
      st.depreciationPct = firstPct;
      delete st.years;
    }
    if (!Number.isFinite(st.maxInvestment))   st.maxInvestment   = DEFAULT_MAX_INV;
    if (!Number.isFinite(st.depreciationPct)) st.depreciationPct = DEFAULT_DEPR_PCT;
    if (typeof st.detailsOpen === 'undefined') st.detailsOpen = false;
    return root[STATE_KEY];
  }

  function _interestState() {
    if (!root[INTEREST_KEY]) root[INTEREST_KEY] = { oilGas: null };
    return root[INTEREST_KEY];
  }

  function _val(id) { var el = document.getElementById(id); return el ? el.value : ''; }

  function _fmtMoney(n) {
    if (!Number.isFinite(n)) return '$0';
    var sign = n < 0 ? '-' : '';
    return sign + '$' + Math.round(Math.abs(n)).toLocaleString('en-US');
  }

  // -----------------------------------------------------------------
  // Year-count detection from the picked sale structure
  // -----------------------------------------------------------------
  function _resolvedStrategyKey() {
    var chosen = root.__rettChosenStrategy;
    if (chosen === 'A' || chosen === 'B' || chosen === 'C') return chosen;
    var interest = root.__rettStrategyInterest || {};
    if (interest.C === true) return 'C';
    if (interest.B === true) return 'B';
    if (interest.A === true) return 'A';
    return 'A';
  }

  function _yearCountForStrategy(key) {
    if (key === 'A') return 1;
    if (key === 'B') return 2;
    var monthsRaw = parseInt(_val('structured-sale-duration-months'), 10);
    var months = (Number.isFinite(monthsRaw) && monthsRaw > 0) ? monthsRaw : 18;
    var years = Math.max(1, Math.ceil((months + 6) / 12));
    if (years > YEAR_HARD_CAP) years = YEAR_HARD_CAP;
    return years;
  }

  function _strategySummaryLabel(key, n) {
    if (key === 'A') return 'Sell Now &middot; 1 investment year';
    if (key === 'B') return 'Seller Finance &middot; 2 investment years';
    if (key === 'C') return 'Structured Sale &middot; ' + n + ' investment years';
    return n + ' investment year' + (n === 1 ? '' : 's');
  }

  // Build the per-year array the math (and eventually the solver)
  // consumes. Even split for now; replaceable when the solver lands.
  function _resolvedYears() {
    var st = _state().oilGas;
    var key = _resolvedStrategyKey();
    var count = _yearCountForStrategy(key);
    var per = (st.maxInvestment || 0) / count;
    var years = [];
    for (var i = 0; i < count; i++) {
      years.push({ investment: per, idcPct: st.depreciationPct });
    }
    return years;
  }

  // -----------------------------------------------------------------
  // Card markup — reuses .strategy-pick-card / .strategy-keyaspect /
  // .strategy-lockup-graphic / .strategy-pick-buttons from Page 2.
  // -----------------------------------------------------------------

  function _interestClassFor(target) {
    var s = _interestState()[target];
    if (s === true)  return 'is-interested';
    if (s === false) return 'is-not-interested';
    return '';
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

  function _renderCard() {
    var st = _state().oilGas;
    var key = _resolvedStrategyKey();
    var count = _yearCountForStrategy(key);
    var interestCls = _interestClassFor('oilGas');
    var detailsOpenCls = st.detailsOpen ? ' is-open' : '';

    var maxInvDisplay = (typeof fmtUSD === 'function')
      ? fmtUSD(st.maxInvestment)
      : ('$' + Math.round(st.maxInvestment).toLocaleString('en-US'));
    var deprPctDisplay = Math.round(st.depreciationPct * 100);

    return '' +
      '<div class="strategy-pick-card supp-strategy-card ' + interestCls + '" data-supp-strategy="oilGas">' +
        '<div class="strategy-pick-card-header">' +
          '<div class="strategy-pick-num">SUPPLEMENTAL <span class="num-big">01</span></div>' +
        '</div>' +
        '<h3 class="strategy-pick-name">Oil &amp; Gas Working Interest</h3>' +

        '<div class="strategy-keyaspect">' +
          '<div class="strategy-keyaspect-label">Ordinary Income Offset</div>' +
          '<p class="strategy-keyaspect-body">An investment in oil &amp; gas allows for early depreciation that offsets ordinary income under IRC &sect;469(c)(3).</p>' +
        '</div>' +

        '<div class="strategy-lockup-graphic" data-lockup-style="ordinary">' +
          '<span class="strategy-lockup-icon" aria-hidden="true">' + _oilGasIconSVG() + '</span>' +
          '<div class="strategy-lockup-text">' +
            '<span class="strategy-lockup-value">95% Y1 Deduction</span>' +
            '<span class="strategy-lockup-sub">' + _strategySummaryLabel(key, count) + '</span>' +
          '</div>' +
        '</div>' +

        '<div class="strategy-pick-buttons">' +
          '<button type="button" class="strategy-pick-btn supp-pick-btn" data-supp-pick-action="interested" data-supp-pick-target="oilGas">&#10003; Interested</button>' +
          '<button type="button" class="strategy-pick-btn supp-pick-btn" data-supp-pick-action="not-interested" data-supp-pick-target="oilGas">Not Interested</button>' +
        '</div>' +

        '<button type="button" class="supp-details-arrow' + detailsOpenCls + '" data-supp-details-target="oilGas" aria-expanded="' + (st.detailsOpen ? 'true' : 'false') + '" aria-controls="supp-details-oilGas" title="' + (st.detailsOpen ? 'Hide details' : 'Show details') + '">' +
          '<span class="supp-details-arrow-chev" aria-hidden="true">&#9662;</span>' +
          '<span class="supp-details-arrow-label">Details</span>' +
        '</button>' +

        '<div class="supp-details-panel" id="supp-details-oilGas"' + (st.detailsOpen ? '' : ' hidden') + '>' +
          '<div class="supp-details-row">' +
            '<div class="supp-details-rowlabel">Max Investment <span class="supp-details-rowsub">overall</span></div>' +
            '<div class="supp-details-cell"><div class="currency-input"><input type="text" id="supp-oilgas-max" inputmode="numeric" autocomplete="off" value="' + maxInvDisplay + '"></div></div>' +
          '</div>' +
          '<div class="supp-details-row">' +
            '<div class="supp-details-rowlabel">Depreciation %</div>' +
            '<div class="supp-details-cell"><div class="currency-input percent"><input type="number" id="supp-oilgas-pct" min="0" max="100" step="1" value="' + deprPctDisplay + '"><span class="pct-suffix" aria-hidden="true">%</span></div></div>' +
          '</div>' +
        '</div>' +
      '</div>';
  }

  function _renderHost() {
    var host = document.getElementById('supplemental-strategies-host');
    if (!host) return;
    host.innerHTML =
      '<div class="supp-strategies-grid">' +
        _renderCard() +
      '</div>';
    _bindEvents();
  }

  // -----------------------------------------------------------------
  // Events
  // -----------------------------------------------------------------
  function _bindEvents() {
    var host = document.getElementById('supplemental-strategies-host');
    if (!host) return;
    if (host.dataset.bound) return;
    host.dataset.bound = '1';

    host.addEventListener('click', function (ev) {
      var t = ev.target;
      if (!t) return;

      var pickBtn = t.closest && t.closest('[data-supp-pick-action]');
      if (pickBtn) {
        var target = pickBtn.getAttribute('data-supp-pick-target');
        var action = pickBtn.getAttribute('data-supp-pick-action');
        var newVal = (action === 'interested') ? true : false;
        var iState = _interestState();
        iState[target] = (iState[target] === newVal) ? null : newVal;
        _renderHost();
        _runMath();
        return;
      }

      var detailsBtn = t.closest && t.closest('[data-supp-details-target]');
      if (detailsBtn) {
        var dTarget = detailsBtn.getAttribute('data-supp-details-target');
        if (dTarget === 'oilGas') {
          _state().oilGas.detailsOpen = !_state().oilGas.detailsOpen;
          _renderHost();
        }
        return;
      }
    });

    host.addEventListener('input', _onInputDelegate);
    host.addEventListener('blur', _onBlurDelegate, true);
  }

  function _onInputDelegate(ev) {
    var t = ev.target;
    if (!t) return;
    var st = _state().oilGas;
    if (t.id === 'supp-oilgas-max') {
      var v = (typeof parseUSD === 'function') ? parseUSD(t.value) : Number(t.value);
      st.maxInvestment = Math.max(0, Number.isFinite(v) ? v : 0);
      _runMath();
    } else if (t.id === 'supp-oilgas-pct') {
      var raw = parseFloat(t.value);
      if (!Number.isFinite(raw)) raw = DEFAULT_DEPR_PCT * 100;
      if (raw < 0) raw = 0;
      if (raw > 100) raw = 100;
      st.depreciationPct = raw / 100;
      _runMath();
    }
  }

  function _onBlurDelegate(ev) {
    var t = ev.target;
    if (!t) return;
    if (t.id === 'supp-oilgas-max') {
      var v = _state().oilGas.maxInvestment;
      t.value = (typeof fmtUSD === 'function') ? fmtUSD(v) : ('$' + Math.round(v).toLocaleString('en-US'));
    }
  }

  // -----------------------------------------------------------------
  // Math — runs silently, parks the latest result on state for the
  // solver / Strategy Summary to consume.
  // -----------------------------------------------------------------
  function _runMath() {
    if (typeof root.computeOilGasMultiYear !== 'function') return;
    var st = _state().oilGas;
    try { st.lastResult = root.computeOilGasMultiYear(_resolvedYears()); }
    catch (e) { st.lastResult = null; }
  }

  // Public lego-pin helper for the solver.
  function getOilGasConfiguredYears() {
    return _resolvedYears();
  }

  // -----------------------------------------------------------------
  // Top-level render + listeners
  // -----------------------------------------------------------------
  function renderSupplementalPage() {
    if (!document.getElementById('supplemental-strategies-host')) return;
    _renderHost();
    _runMath();
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

    var lastKey = _resolvedStrategyKey();
    setInterval(function () {
      var page4 = document.getElementById('page-supplemental');
      if (!page4 || !page4.classList.contains('active')) return;
      var k = _resolvedStrategyKey();
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

  root.renderSupplementalPage   = renderSupplementalPage;
  root.getOilGasConfiguredYears = getOilGasConfiguredYears;
})(window);
