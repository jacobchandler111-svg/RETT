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

  function _state() {
    if (!root[STATE_KEY]) {
      root[STATE_KEY] = {
        oilGas: { interest: null, maxInvestment: DEFAULTS.oilGas.maxInvestment,
                  depreciationPct: DEFAULTS.oilGas.depreciationPct,
                  detailsOpen: false, lastResult: null },
        delphi: { interest: null, classKey: DEFAULTS.delphi.classKey,
                  investment: DEFAULTS.delphi.investment,
                  detailsOpen: false, lastResult: null }
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

    // ---- Delphi defaults ----
    if (!s.delphi) s.delphi = {};
    if (typeof s.delphi.interest === 'undefined') s.delphi.interest = null;
    if (s.delphi.classKey !== 'classA' && s.delphi.classKey !== 'classB') s.delphi.classKey = DEFAULTS.delphi.classKey;
    if (!Number.isFinite(s.delphi.investment))    s.delphi.investment    = DEFAULTS.delphi.investment;
    if (typeof s.delphi.detailsOpen === 'undefined') s.delphi.detailsOpen = false;

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
    var monthsRaw = parseInt(_val('structured-sale-duration-months'), 10);
    var months = (Number.isFinite(monthsRaw) && monthsRaw > 0) ? monthsRaw : 18;
    var years = Math.max(1, Math.ceil((months + 6) / 12));
    if (years > YEAR_HARD_CAP) years = YEAR_HARD_CAP;
    return years;
  }
  function _saleStrategyLabel(key, n) {
    if (key === 'A') return 'Sell Now &middot; 1 investment year';
    if (key === 'B') return 'Seller Finance &middot; 2 investment years';
    if (key === 'C') return 'Structured Sale &middot; ' + n + ' investment years';
    return n + ' investment year' + (n === 1 ? '' : 's');
  }
  function _oilGasResolvedYears() {
    var st = _state().oilGas;
    var key = _resolvedSaleStrategyKey();
    var count = _yearCountForSaleStrategy(key);
    var per = (st.maxInvestment || 0) / count;
    var years = [];
    for (var i = 0; i < count; i++) {
      years.push({ investment: per, idcPct: st.depreciationPct });
    }
    return years;
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
            '<span class="strategy-lockup-sub">' + _saleStrategyLabel(key, count) + '</span>' +
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
  function _delphiSubLabel(st) {
    var meta = _delphiClassMeta(st.classKey);
    var minDisplay = '$' + (meta.minInvestment / 1e6) + 'M minimum';
    return meta.name + ' &middot; ' + minDisplay;
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

    var classOptions =
      '<option value="classA"' + (st.classKey === 'classA' ? ' selected' : '') + '>Class A &mdash; $5M min, 1.75% fee</option>' +
      '<option value="classB"' + (st.classKey === 'classB' ? ' selected' : '') + '>Class B &mdash; $1M min, 2% fee</option>';

    var minWarning = minNotMet
      ? '<p class="supp-min-warning">Below the ' + _fmtUSD(meta.minInvestment) + ' minimum for ' + meta.name + '. Math runs proportionally; fund won&rsquo;t accept the subscription as-is.</p>'
      : '';

    return '' +
      '<div class="strategy-pick-card supp-strategy-card ' + interestCls + '" data-supp-strategy="delphi">' +
        '<div class="strategy-pick-card-header">' +
          '<div class="strategy-pick-num">SUPPLEMENTAL <span class="num-big">02</span></div>' +
        '</div>' +
        '<h3 class="strategy-pick-name">Delphi Fund</h3>' +
        '<div class="strategy-keyaspect">' +
          '<div class="strategy-keyaspect-label">Character Conversion</div>' +
          '<p class="strategy-keyaspect-body">A hedge-fund strategy that offsets ordinary income.</p>' +
        '</div>' +
        '<div class="strategy-lockup-graphic" data-lockup-style="exchange">' +
          '<span class="strategy-lockup-icon" aria-hidden="true">' + _delphiIconSVG() + '</span>' +
          '<div class="strategy-lockup-text">' +
            '<span class="strategy-lockup-value">Rate Arbitrage</span>' +
            '<span class="strategy-lockup-sub">' + _delphiSubLabel(st) + '</span>' +
          '</div>' +
        '</div>' +
        '<div class="strategy-pick-buttons">' +
          '<button type="button" class="strategy-pick-btn supp-pick-btn" data-supp-pick-action="interested" data-supp-pick-target="delphi">&#10003; Interested</button>' +
          '<button type="button" class="strategy-pick-btn supp-pick-btn" data-supp-pick-action="not-interested" data-supp-pick-target="delphi">Not Interested</button>' +
        '</div>' +
        '<button type="button" class="supp-details-arrow' + detailsOpenCls + '" data-supp-details-target="delphi" aria-expanded="' + (st.detailsOpen ? 'true' : 'false') + '" aria-controls="supp-details-delphi" title="' + (st.detailsOpen ? 'Hide details' : 'Show details') + '">' +
          '<span class="supp-details-arrow-chev" aria-hidden="true">&#9662;</span>' +
          '<span class="supp-details-arrow-label">Details</span>' +
        '</button>' +
        '<div class="supp-details-panel" id="supp-details-delphi"' + (st.detailsOpen ? '' : ' hidden') + '>' +
          '<div class="supp-details-row">' +
            '<div class="supp-details-rowlabel">Class</div>' +
            '<div class="supp-details-cell"><select id="supp-delphi-class" class="supp-select">' + classOptions + '</select></div>' +
          '</div>' +
          '<div class="supp-details-row">' +
            '<div class="supp-details-rowlabel">Investment <span class="supp-details-rowsub">overall</span></div>' +
            '<div class="supp-details-cell"><div class="currency-input"><input type="text" id="supp-delphi-inv" inputmode="numeric" autocomplete="off" value="' + invDisplay + '"></div></div>' +
          '</div>' +
          minWarning +
        '</div>' +
      '</div>';
  }
  function _runDelphiMath() {
    if (typeof root.computeDelphiYear1 !== 'function') return;
    var st = _state().delphi;
    try {
      st.lastResult = root.computeDelphiYear1({
        classKey:   st.classKey,
        investment: st.investment
      });
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
  function _renderHost() {
    var host = document.getElementById('supplemental-strategies-host');
    if (!host) return;
    host.innerHTML =
      '<div class="supp-strategies-grid">' +
        _renderOilGasCard() +
        _renderDelphiCard() +
      '</div>';
    _bindEvents();
  }

  // Persist current state to localStorage via case-storage. Skipped
  // when the harness is mid-restore (a save during restore would
  // overwrite freshly-restored state with whatever the form was
  // showing one tick earlier).
  function _persist() {
    if (root.__rettApplyingState) return;
    if (root.RETTCaseStorage && typeof root.RETTCaseStorage.saveWorkingState === 'function') {
      try { root.RETTCaseStorage.saveWorkingState(); } catch (e) { /* */ }
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
      _runOilGasMath();
      _persist();
    } else if (t.id === 'supp-oilgas-pct') {
      var raw = parseFloat(t.value);
      if (!Number.isFinite(raw)) raw = DEFAULTS.oilGas.depreciationPct * 100;
      if (raw < 0) raw = 0;
      if (raw > 100) raw = 100;
      s.oilGas.depreciationPct = raw / 100;
      _runOilGasMath();
      _persist();
    } else if (t.id === 'supp-delphi-inv') {
      var dv = (typeof parseUSD === 'function') ? parseUSD(t.value) : Number(t.value);
      s.delphi.investment = Math.max(0, Number.isFinite(dv) ? dv : 0);
      _runDelphiMath();
      // Re-render only the Delphi card body to reflect the min-warning
      // and the lockup sub label without losing input focus. Easiest:
      // re-render whole host but restore focus to the input afterwards.
      _renderHostKeepFocus(t.id);
      _persist();
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
  }

  function renderSupplementalPage() {
    if (!document.getElementById('supplemental-strategies-host')) return;
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

  root.renderSupplementalPage   = renderSupplementalPage;
  root.getOilGasConfiguredYears = getOilGasConfiguredYears;
  root.getDelphiConfiguration   = getDelphiConfiguration;
})(window);
