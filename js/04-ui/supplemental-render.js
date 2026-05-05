// FILE: js/04-ui/supplemental-render.js
// Renders Page 4 (Supplemental Strategies). Each card mirrors the
// Page-2 strategy-pick-card identity exactly so Pages 2 and 4 read
// as one workflow: pick a sale structure on Page 2, pick supplemental
// strategies on Page 4, see the combined math on Page 5.
//
// Lego-piece architecture (advisor convo 2026-05-05):
//   - The card's job is to capture INTEREST, not to display savings.
//     A "Configure details" disclosure below the buttons lets the
//     advisor override defaults (per-year investment, IDC %) when
//     needed — most of the time it stays closed.
//   - Math runs silently on every relevant input change. The latest
//     multi-year result is parked at
//       window.__rettSupplemental.oilGas.lastResult
//     so the future unified solver / Page-5 renderer can read it
//     without re-computing.
//   - The interest state is the lego pin:
//       window.__rettSupplementalInterest = { oilGas: true|false|null }
//     The solver legs this strategy in iff interest === true.
//
// Year count adapts to the picked sale structure on Page 2/3:
//   A (Sell Now)        → 1 year
//   B (Seller Finance)  → 2 years (sale year + Jan-1 payout)
//   C (Structured Sale) → derived from #structured-sale-duration-months
//                          (default 18 mo → 2 yrs; cap 7)
// All years run against the SAME Y1 ordinary-income baseline (held
// flat by advisor instruction; per-year forecast is a future hook).
//
// State at window.__rettSupplemental:
//   { oilGas: { interest, years[], detailsOpen, lastResult } }

(function (root) {
  'use strict';

  var STATE_KEY            = '__rettSupplemental';
  var INTEREST_KEY         = '__rettSupplementalInterest';
  var DEFAULT_INVESTMENT   = 250000;
  var DEFAULT_IDC_PCT      = 0.95;
  var YEAR_HARD_CAP        = 7;

  function _state() {
    if (!root[STATE_KEY]) {
      root[STATE_KEY] = {
        oilGas: {
          interest: null,
          years: [{ investment: DEFAULT_INVESTMENT, idcPct: DEFAULT_IDC_PCT }],
          detailsOpen: false,
          lastResult: null
        }
      };
    }
    var st = root[STATE_KEY].oilGas;
    // Migrate older shapes if present (fields may be absent if state
    // was hydrated from an earlier saved case).
    if (typeof st.interest === 'undefined') st.interest = null;
    if (!Array.isArray(st.years)) {
      st.years = [{
        investment: Number(st.investment) || DEFAULT_INVESTMENT,
        idcPct:     Number(st.idcPct)     || DEFAULT_IDC_PCT
      }];
    }
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

  function _syncYearsToCount(count) {
    var st = _state().oilGas;
    if (!Array.isArray(st.years)) st.years = [];
    while (st.years.length < count) {
      st.years.push({
        investment: st.years.length === 0 ? DEFAULT_INVESTMENT : 0,
        idcPct:     DEFAULT_IDC_PCT
      });
    }
    if (st.years.length > count) st.years.length = count;
  }

  // -----------------------------------------------------------------
  // Card rendering — mirrors .strategy-pick-card from Page 2 1:1.
  // The Details disclosure is supp-specific; everything else reuses
  // the existing class set so Page 4 inherits all visual states
  // (.is-interested, .is-not-interested) without new CSS.
  // -----------------------------------------------------------------

  function _interestClassFor(target) {
    var s = _interestState()[target];
    if (s === true)  return 'is-interested';
    if (s === false) return 'is-not-interested';
    return '';
  }

  function _oilGasIconSVG() {
    // Pump-jack — line art, currentColor, matches stroke-width and
    // styling of the existing Page-2 lockup icons.
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
    _syncYearsToCount(count);

    var interestCls = _interestClassFor('oilGas');
    var detailsCls = st.detailsOpen ? ' is-open' : '';

    return '' +
      '<div class="strategy-pick-card supp-strategy-card ' + interestCls + '" data-supp-strategy="oilGas">' +
        '<div class="strategy-pick-card-header">' +
          '<div class="strategy-pick-num">SUPPLEMENTAL <span class="num-big">01</span></div>' +
        '</div>' +
        '<h3 class="strategy-pick-name">Oil &amp; Gas Working Interest</h3>' +

        '<div class="strategy-keyaspect">' +
          '<div class="strategy-keyaspect-label">Ordinary Income Offset</div>' +
          '<p class="strategy-keyaspect-body">IRC &sect;469(c)(3) &mdash; IDC + bonus depreciation deduct ~95% of capital above the line, against W-2, K-1, and other ordinary income.</p>' +
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

        '<button type="button" class="supp-details-toggle' + detailsCls + '" data-supp-details-target="oilGas" aria-expanded="' + (st.detailsOpen ? 'true' : 'false') + '">' +
          '<span class="supp-details-toggle-text">' + (st.detailsOpen ? 'Hide details' : 'Configure details') + '</span>' +
          '<span class="supp-details-toggle-chev" aria-hidden="true">&#9662;</span>' +
        '</button>' +

        '<div class="supp-details-panel"' + (st.detailsOpen ? '' : ' hidden') + ' id="supp-details-oilGas">' +
          _renderDetailsBody(key, count) +
        '</div>' +
      '</div>';
  }

  function _renderDetailsBody(key, count) {
    var st = _state().oilGas;
    var year1 = parseInt(_val('year1'), 10) || (new Date()).getFullYear();
    var rowsHTML = '';
    for (var i = 0; i < st.years.length; i++) {
      var y = st.years[i];
      var pctDisplay = Math.round((Number(y.idcPct) || DEFAULT_IDC_PCT) * 100);
      var invDisplay = (typeof fmtUSD === 'function')
        ? fmtUSD(Number(y.investment) || 0)
        : ('$' + Math.round(Number(y.investment) || 0).toLocaleString('en-US'));
      rowsHTML += '' +
        '<div class="supp-details-row" data-year-idx="' + i + '">' +
          '<div class="supp-details-rowlabel">Year ' + (i + 1) + ' <span class="supp-details-rowsub">(' + (year1 + i) + ')</span></div>' +
          '<div class="supp-details-cell"><div class="currency-input"><input type="text" data-supp-year-inv="' + i + '" inputmode="numeric" autocomplete="off" value="' + invDisplay + '"></div></div>' +
          '<div class="supp-details-cell"><div class="currency-input percent"><input type="number" data-supp-year-pct="' + i + '" min="0" max="100" step="1" value="' + pctDisplay + '"><span class="pct-suffix" aria-hidden="true">%</span></div></div>' +
        '</div>';
    }

    var resultHTML = '';
    if (st.lastResult) {
      resultHTML = '' +
        '<div class="supp-details-savings">' +
          '<span class="lbl">Estimated savings</span>' +
          '<span class="amt">' + _fmtMoney(st.lastResult.totalSaved) + '</span>' +
          '<span class="sub">across ' + st.years.length + ' year' + (st.years.length === 1 ? '' : 's') + '</span>' +
        '</div>';
    }

    return '' +
      '<div class="supp-details-grid-head">' +
        '<div>Year</div>' +
        '<div>Investment</div>' +
        '<div>IDC %</div>' +
      '</div>' +
      rowsHTML +
      resultHTML;
  }

  function _renderHost() {
    var host = document.getElementById('supplemental-strategies-host');
    if (!host) return;
    host.innerHTML =
      '<div class="supp-strategies-grid count-1">' +
        _renderCard() +
      '</div>';
    _bindEvents();
  }

  // -----------------------------------------------------------------
  // Events — Interested/Not Interested toggle, Details disclosure,
  // and per-year input changes (delegated on the host).
  // -----------------------------------------------------------------
  function _bindEvents() {
    var host = document.getElementById('supplemental-strategies-host');
    if (!host) return;
    if (host.dataset.bound) return;
    host.dataset.bound = '1';

    host.addEventListener('click', function (ev) {
      var t = ev.target;
      if (!t) return;

      // Interested / Not Interested
      var pickBtn = t.closest && t.closest('[data-supp-pick-action]');
      if (pickBtn) {
        var target = pickBtn.getAttribute('data-supp-pick-target');
        var action = pickBtn.getAttribute('data-supp-pick-action');
        var newVal = (action === 'interested') ? true : false;
        var iState = _interestState();
        // Tri-state toggle: clicking the same value clears it.
        iState[target] = (iState[target] === newVal) ? null : newVal;
        _renderHost();
        _runMath();
        return;
      }

      // Configure details ▾
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
    var invIdx = t.getAttribute('data-supp-year-inv');
    var pctIdx = t.getAttribute('data-supp-year-pct');
    if (invIdx != null) {
      var i = parseInt(invIdx, 10);
      if (st.years[i]) {
        var v = (typeof parseUSD === 'function') ? parseUSD(t.value) : Number(t.value);
        st.years[i].investment = Math.max(0, Number.isFinite(v) ? v : 0);
        _runMath();
        _refreshDetailsResult();
      }
    } else if (pctIdx != null) {
      var j = parseInt(pctIdx, 10);
      if (st.years[j]) {
        var raw = parseFloat(t.value);
        if (!Number.isFinite(raw)) raw = DEFAULT_IDC_PCT * 100;
        if (raw < 0) raw = 0;
        if (raw > 100) raw = 100;
        st.years[j].idcPct = raw / 100;
        _runMath();
        _refreshDetailsResult();
      }
    }
  }

  function _onBlurDelegate(ev) {
    var t = ev.target;
    if (!t) return;
    var invIdx = t.getAttribute('data-supp-year-inv');
    if (invIdx == null) return;
    var i = parseInt(invIdx, 10);
    var st = _state().oilGas;
    if (!st.years[i]) return;
    var v = st.years[i].investment;
    t.value = (typeof fmtUSD === 'function') ? fmtUSD(v) : ('$' + Math.round(v).toLocaleString('en-US'));
  }

  // Light-touch refresh for the inline savings line in Details. Avoids
  // a full host re-render so input focus survives typing.
  function _refreshDetailsResult() {
    var st = _state().oilGas;
    var panel = document.getElementById('supp-details-oilGas');
    if (!panel) return;
    var savingsEl = panel.querySelector('.supp-details-savings .amt');
    if (savingsEl && st.lastResult) {
      savingsEl.textContent = _fmtMoney(st.lastResult.totalSaved);
    }
  }

  // -----------------------------------------------------------------
  // Math — runs silently, parks the latest result on state for the
  // solver / Strategy Summary to consume.
  // -----------------------------------------------------------------
  function _runMath() {
    if (typeof root.computeOilGasMultiYear !== 'function') return;
    var st = _state().oilGas;
    var inputYears = st.years.map(function (y) {
      return { investment: y.investment, idcPct: y.idcPct };
    });
    try { st.lastResult = root.computeOilGasMultiYear(inputYears); }
    catch (e) { st.lastResult = null; }
  }

  // Public lego-pin helper: returns the per-year config the solver
  // should consume for Oil & Gas, given current Page-1/2/3 state.
  // Solver call: const years = window.getOilGasConfiguredYears();
  function getOilGasConfiguredYears() {
    var st = _state().oilGas;
    var key = _resolvedStrategyKey();
    var count = _yearCountForStrategy(key);
    _syncYearsToCount(count);
    return st.years.map(function (y) {
      return { investment: y.investment, idcPct: y.idcPct };
    });
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
    // Same id list as baseline-table.js — the silent math depends on
    // these. Plus structured-sale-duration-months because changing it
    // can shift the Strategy-C year count.
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
        // Year count may have shifted — full host re-render. Page 4
        // is rarely the active page during typing, so a re-render
        // here doesn't fight any input focus.
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
    // lazily — only when Page 4 is on screen.
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

  root.renderSupplementalPage      = renderSupplementalPage;
  root.getOilGasConfiguredYears    = getOilGasConfiguredYears;
})(window);
