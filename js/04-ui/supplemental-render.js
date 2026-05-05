// FILE: js/04-ui/supplemental-render.js
// Renders Page 4 (Supplemental Strategies). Each strategy is a card
// in #supplemental-strategies-host. v1 ships ONE card — Oil & Gas
// Working Interest — wired through the federal + state engine via
// calc-oil-gas.js.
//
// Multi-year shape (advisor convo 2026-05-05):
//   - Year count comes from the picked sale structure on Page 2/3:
//       Strategy A (Sell Now)        → 1 year
//       Strategy B (Seller Finance)  → 2 years (sale year + Jan-1 payout)
//       Strategy C (Structured Sale) → derived from
//         #structured-sale-duration-months (default 18 mo → 2 yrs;
//         each additional 12 mo adds a year). Hard cap at 7 yrs.
//   - Each year has its OWN (investment, idcPct) so the advisor can
//     stagger O&G across years where cash actually arrives.
//   - All years run against the SAME Y1 ordinary-income baseline (per
//     advisor: "keep year-one ordinary consistent across the years").
//     A real per-year ordinary forecast is a future extension.
//   - No max-investment cap yet (advisor will set 5%-of-portfolio or
//     a $ floor later once risk gating is defined).
//
// Design intent:
//   - Capital invested in Oil & Gas is conceptually DIVERTED from
//     Brooklyn (a dollar can only sit in one strategy). The unified
//     solver that enforces that is NOT yet built; the card surfaces
//     the diversion as a hint so the advisor reads the savings number
//     in context.
//   - Pre-meeting questionnaire flags will eventually gate which
//     supplemental cards appear. v1 always shows Oil & Gas so the
//     math can be reviewed end-to-end.
//
// State at window.__rettSupplemental:
//   { oilGas: { enabled, years: [{ investment, idcPct }, ...] } }

(function (root) {
  'use strict';

  var STATE_KEY = '__rettSupplemental';
  var DEFAULT_INVESTMENT = 250000;
  var DEFAULT_IDC_PCT    = 0.95;
  var YEAR_HARD_CAP      = 7;

  function _state() {
    if (!root[STATE_KEY]) {
      root[STATE_KEY] = {
        oilGas: {
          enabled: false,
          years: [{ investment: DEFAULT_INVESTMENT, idcPct: DEFAULT_IDC_PCT }]
        }
      };
    }
    // Migrate legacy single-year shape if present.
    var st = root[STATE_KEY].oilGas;
    if (st && !Array.isArray(st.years)) {
      st.years = [{
        investment: Number(st.investment) || DEFAULT_INVESTMENT,
        idcPct:     Number(st.idcPct)     || DEFAULT_IDC_PCT
      }];
    }
    return root[STATE_KEY];
  }

  function _fmtMoney(n) {
    if (!Number.isFinite(n)) return '$0';
    var sign = n < 0 ? '-' : '';
    return sign + '$' + Math.round(Math.abs(n)).toLocaleString('en-US');
  }

  function _val(id) { var el = document.getElementById(id); return el ? el.value : ''; }

  // -----------------------------------------------------------------
  // Year-count detection from the picked sale structure.
  // Source-of-truth precedence:
  //   1. window.__rettChosenStrategy (set when user clicks "Use This
  //      Strategy" on Page 3).
  //   2. window.__rettStrategyInterest — pick the most-multi-year of
  //      the Interested cards (C > B > A).
  //   3. Fallback: A.
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
    // Strategy C: derive from structured-sale duration.
    // 0-6 mo  → 1 yr; 7-18 mo → 2 yrs; 19-30 → 3 yrs; ...
    var monthsRaw = parseInt(_val('structured-sale-duration-months'), 10);
    var months = (Number.isFinite(monthsRaw) && monthsRaw > 0) ? monthsRaw : 18;
    var years = Math.max(1, Math.ceil((months + 6) / 12));
    if (years > YEAR_HARD_CAP) years = YEAR_HARD_CAP;
    return years;
  }

  function _strategyLabel(key, n) {
    if (key === 'A') return 'Sell Now &mdash; 1 investment year';
    if (key === 'B') return 'Seller Finance &mdash; 2 investment years (sale year + Jan-1 payout)';
    if (key === 'C') return 'Structured Sale &mdash; ' + n + ' investment years (cash inflow schedule)';
    return n + ' investment year' + (n === 1 ? '' : 's');
  }

  function _syncYearsToCount(count) {
    var st = _state().oilGas;
    if (!Array.isArray(st.years)) st.years = [];
    while (st.years.length < count) {
      st.years.push({
        // Default new years to $0 — only Year 1 starts populated, so
        // adding a strategy mid-flow doesn't accidentally double the
        // implied investment.
        investment: st.years.length === 0 ? DEFAULT_INVESTMENT : 0,
        idcPct:     DEFAULT_IDC_PCT
      });
    }
    if (st.years.length > count) st.years.length = count;
  }

  // -----------------------------------------------------------------
  // Rendering
  // -----------------------------------------------------------------

  function _yearLabel(idx, key) {
    var year1 = parseInt(_val('year1'), 10) || (new Date()).getFullYear();
    var calYear = year1 + idx;
    var caption = '';
    if (idx === 0) caption = 'Sale year';
    else if (key === 'B' && idx === 1) caption = 'Jan-1 payout year';
    else if (key === 'C') caption = (idx === 0) ? 'Sale year (recapture)' : 'Installment year';
    return 'Year ' + (idx + 1) + ' (' + calYear + ')' +
           (caption ? ' <span class="supp-year-caption">&middot; ' + caption + '</span>' : '');
  }

  function _renderYearRows(host) {
    var st = _state().oilGas;
    var key = _resolvedStrategyKey();
    var count = _yearCountForStrategy(key);
    _syncYearsToCount(count);

    var rowsHTML = '';
    for (var i = 0; i < st.years.length; i++) {
      var y = st.years[i];
      var pctDisplay = Math.round((Number(y.idcPct) || DEFAULT_IDC_PCT) * 100);
      var invDisplay = (typeof fmtUSD === 'function')
        ? fmtUSD(Number(y.investment) || 0)
        : ('$' + Math.round(Number(y.investment) || 0).toLocaleString('en-US'));
      rowsHTML += '' +
        '<div class="supp-year-row" data-year-idx="' + i + '">' +
          '<div class="supp-year-label">' + _yearLabel(i, key) + '</div>' +
          '<div class="supp-year-input">' +
            '<div class="currency-input"><input type="text" data-supp-year-inv="' + i + '" inputmode="numeric" autocomplete="off" value="' + invDisplay + '"></div>' +
          '</div>' +
          '<div class="supp-year-pct">' +
            '<div class="currency-input percent"><input type="number" data-supp-year-pct="' + i + '" min="0" max="100" step="1" value="' + pctDisplay + '"><span class="pct-suffix" aria-hidden="true">%</span></div>' +
          '</div>' +
        '</div>';
    }

    var labelHTML = _strategyLabel(key, count);
    host.innerHTML = '' +
      '<div class="supp-year-header">' +
        '<div>' +
          '<div class="supp-year-header-label">Configured for</div>' +
          '<div class="supp-year-header-value">' + labelHTML + '</div>' +
        '</div>' +
      '</div>' +
      '<div class="supp-year-grid-head">' +
        '<div>Year</div>' +
        '<div>Investment</div>' +
        '<div>IDC %</div>' +
      '</div>' +
      rowsHTML;
  }

  // The shell carries everything that doesn't change on every tick:
  // headings, "How it works" panel, the dark results card. The two
  // dynamic regions (year-rows, results-body) are re-rendered on
  // each input/strategy change.
  function _renderShell(host) {
    var st = _state().oilGas;
    host.innerHTML = '' +
      '<div class="supp-card" data-supp-key="oil-gas">' +
        '<div class="section-heading supp-card-heading">' +
          '<h2>Oil &amp; Gas Working Interest</h2>' +
          '<span class="num">SUPPLEMENTAL &middot; 01</span>' +
        '</div>' +
        '<div class="section-body supp-card-body">' +
          '<div class="supp-toggle-row">' +
            '<label class="supp-toggle">' +
              '<input type="checkbox" id="supp-oilgas-on"' + (st.enabled ? ' checked' : '') + '>' +
              '<span>Include this strategy in projection</span>' +
            '</label>' +
          '</div>' +
          '<div class="supp-card-grid">' +
            '<div class="supp-card-inputs">' +
              '<div id="supp-oilgas-years"></div>' +
              '<p class="supp-divert-hint">Capital deployed here is conceptually diverted from the Brooklyn allocation on Page&nbsp;3. The unified solver that enforces that constraint is not yet wired &mdash; treat the savings figures as the standalone per-year impact.</p>' +
              '<div class="supp-detail">' +
                '<h4>How it works</h4>' +
                '<p>Direct investment in oil &amp; gas working interests is statutorily exempt from the passive-activity loss rules under <span class="citation">IRC &sect;469(c)(3)</span>. Year-1 deductions typically run 75&ndash;95% of the invested capital via Intangible Drilling Costs (IDCs) under <span class="citation">IRC &sect;263(c)</span> and bonus depreciation on tangible equipment &mdash; an above-the-line ordinary deduction that offsets W-2, K-1 ordinary, rental, and other ordinary income.</p>' +
                '<p><strong>Risk profile:</strong> illiquid; subject to commodity-price and dry-hole risk. Working interest carries unlimited liability and is typically held through an LLC.</p>' +
                '<p class="supp-caveat"><strong>Modeling caveat:</strong> AMT preference on excess IDC over 10-year amortization is not yet modeled, and per-year ordinary income is held flat at the Year-1 figure. Multi-year tail (TDC depreciation, depletion, recapture) is also not yet modeled. For AMT-bound clients the figure may overstate true after-tax savings.</p>' +
              '</div>' +
            '</div>' +
            '<div class="supp-card-results" id="supp-oilgas-results" aria-live="polite"></div>' +
          '</div>' +
        '</div>' +
      '</div>';

    _renderYearRows(document.getElementById('supp-oilgas-years'));
    _bindEvents();
    _runAndRender();
  }

  // -----------------------------------------------------------------
  // Events
  // -----------------------------------------------------------------

  function _bindEvents() {
    var on = document.getElementById('supp-oilgas-on');
    if (on) on.addEventListener('change', function () {
      _state().oilGas.enabled = !!on.checked;
      _runAndRender();
    });

    // Per-year inputs are delegated on the years container so we don't
    // have to re-bind every time _renderYearRows rebuilds the rows.
    var yearsHost = document.getElementById('supp-oilgas-years');
    if (yearsHost && !yearsHost.dataset.bound) {
      yearsHost.dataset.bound = '1';
      yearsHost.addEventListener('input', _onYearInput);
      yearsHost.addEventListener('blur', _onYearBlur, true);
    }
  }

  function _onYearInput(ev) {
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
        _runAndRender();
      }
    } else if (pctIdx != null) {
      var j = parseInt(pctIdx, 10);
      if (st.years[j]) {
        var raw = parseFloat(t.value);
        if (!Number.isFinite(raw)) raw = DEFAULT_IDC_PCT * 100;
        if (raw < 0) raw = 0;
        if (raw > 100) raw = 100;
        st.years[j].idcPct = raw / 100;
        _runAndRender();
      }
    }
  }

  function _onYearBlur(ev) {
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

  // -----------------------------------------------------------------
  // Compute + render results
  // -----------------------------------------------------------------

  function _renderResultsPanel(result) {
    var host = document.getElementById('supp-oilgas-results');
    if (!host) return;
    var st = _state().oilGas;
    var dimmed = !st.enabled;
    var showMulti = result.perYear.length > 1;

    var perYearRowsHTML = '';
    if (showMulti) {
      for (var i = 0; i < result.perYear.length; i++) {
        var r = result.perYear[i];
        perYearRowsHTML += '' +
          '<div class="supp-results-yearrow">' +
            '<span class="ylbl">Year ' + (i + 1) + '</span>' +
            '<span class="ydeduct">-' + _fmtMoney(r.deduction) + '</span>' +
            '<span class="ysaved">' + _fmtMoney(r.totalSaved) + '</span>' +
          '</div>';
      }
    }

    var nolBanner = '';
    if (st.enabled && result.totalNolGenerated > 0) {
      nolBanner = '<div class="supp-nol-banner">IDC deduction exceeds Year-1 ordinary income by <strong>' +
        _fmtMoney(result.totalNolGenerated) +
        '</strong> (across the schedule). Excess is a Net Operating Loss carryforward; it does not produce additional cash savings in those years.</div>';
    }

    if (showMulti) {
      host.innerHTML = '' +
        '<div class="supp-results-card' + (dimmed ? ' is-dimmed' : '') + '">' +
          '<div class="supp-results-heading">Multi-Year Impact</div>' +
          '<div class="supp-results-yeartable">' +
            '<div class="supp-results-yearrow head"><span class="ylbl">Year</span><span class="ydeduct">Deduction</span><span class="ysaved">Tax Saved</span></div>' +
            perYearRowsHTML +
          '</div>' +
          '<div class="supp-results-grid">' +
            '<div class="supp-results-row">' +
              '<span class="lbl">Total IDC Deduction</span>' +
              '<span class="amt neg">-' + _fmtMoney(result.totalDeduction) + '</span>' +
            '</div>' +
            '<div class="supp-results-row sub">' +
              '<span class="lbl">Federal Tax Saved (sum)</span>' +
              '<span class="amt pos">' + _fmtMoney(Math.max(0, result.totalFedSaved)) + '</span>' +
            '</div>' +
            '<div class="supp-results-row sub">' +
              '<span class="lbl">State Tax Saved (sum)</span>' +
              '<span class="amt pos">' + _fmtMoney(Math.max(0, result.totalStateSaved)) + '</span>' +
            '</div>' +
          '</div>' +
          nolBanner +
          '<div class="supp-results-total">' +
            '<span class="lbl">Total Multi-Year Savings</span>' +
            '<span class="amt pos big">' + _fmtMoney(result.totalSaved) + '</span>' +
          '</div>' +
          '<div class="supp-results-baselines">' +
            '<div><span>Y1 baseline tax:</span> <strong>' + _fmtMoney(result.baselineTotalY1) + '</strong></div>' +
            '<div><span>Total deployed:</span> <strong>' + _fmtMoney(result.totalInvestment) + '</strong></div>' +
          '</div>' +
        '</div>';
    } else {
      // Single-year view (Strategy A or empty schedule)
      var r = result.perYear[0] || {
        deduction: 0, absorbed: 0, fedSaved: 0, stateSaved: 0,
        totalSaved: 0, baselineTotal: result.baselineTotalY1, optimizedTotal: 0
      };
      host.innerHTML = '' +
        '<div class="supp-results-card' + (dimmed ? ' is-dimmed' : '') + '">' +
          '<div class="supp-results-heading">Year-1 Impact</div>' +
          '<div class="supp-results-grid">' +
            '<div class="supp-results-row">' +
              '<span class="lbl">IDC Ordinary Deduction</span>' +
              '<span class="amt neg">-' + _fmtMoney(r.deduction) + '</span>' +
            '</div>' +
            '<div class="supp-results-row">' +
              '<span class="lbl">Ordinary Income Absorbed</span>' +
              '<span class="amt">' + _fmtMoney(r.absorbed) + '</span>' +
            '</div>' +
            '<div class="supp-results-row sub">' +
              '<span class="lbl">Federal Tax Saved</span>' +
              '<span class="amt pos">' + _fmtMoney(Math.max(0, r.fedSaved)) + '</span>' +
            '</div>' +
            '<div class="supp-results-row sub">' +
              '<span class="lbl">State Tax Saved</span>' +
              '<span class="amt pos">' + _fmtMoney(Math.max(0, r.stateSaved)) + '</span>' +
            '</div>' +
          '</div>' +
          nolBanner +
          '<div class="supp-results-total">' +
            '<span class="lbl">Total Year-1 Savings</span>' +
            '<span class="amt pos big">' + _fmtMoney(r.totalSaved) + '</span>' +
          '</div>' +
          '<div class="supp-results-baselines">' +
            '<div><span>Baseline tax:</span> <strong>' + _fmtMoney(r.baselineTotal || result.baselineTotalY1) + '</strong></div>' +
            '<div><span>With strategy:</span> <strong>' + _fmtMoney(r.optimizedTotal || 0) + '</strong></div>' +
          '</div>' +
        '</div>';
    }
  }

  function _runAndRender() {
    if (typeof root.computeOilGasMultiYear !== 'function') return;
    var st = _state().oilGas;
    var inputYears = st.enabled
      ? st.years.map(function (y) { return { investment: y.investment, idcPct: y.idcPct }; })
      : st.years.map(function (y) { return { investment: 0, idcPct: y.idcPct }; });
    var result;
    try { result = root.computeOilGasMultiYear(inputYears); }
    catch (e) {
      result = { perYear: [], totalInvestment: 0, totalDeduction: 0,
                 totalSaved: 0, totalAbsorbed: 0, totalNolGenerated: 0,
                 totalFedSaved: 0, totalStateSaved: 0, baselineTotalY1: 0 };
    }
    _renderResultsPanel(result);
  }

  function renderSupplementalPage() {
    var host = document.getElementById('supplemental-strategies-host');
    if (!host) return;
    if (!host.dataset.suppRendered) {
      _renderShell(host);
      host.dataset.suppRendered = '1';
    } else {
      // Re-detect strategy + year count and re-paint year rows;
      // the shell stays put so focus on inputs survives a re-tick.
      var yearsHost = document.getElementById('supp-oilgas-years');
      if (yearsHost) _renderYearRows(yearsHost);
      _runAndRender();
    }
  }

  // Page-1 inputs change → re-run. Same id list as baseline-table.js
  // so the two panels stay in lockstep. Also covers the structured-
  // sale duration field, since changing that can shift Strategy-C
  // year count.
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
        if (document.getElementById('supplemental-strategies-host')) {
          // Year count may have shifted — rebuild rows.
          var yh = document.getElementById('supp-oilgas-years');
          if (yh) _renderYearRows(yh);
          _runAndRender();
        }
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

    // Re-render on Page-4 nav click (catches strategy-pick changes
    // made on Page 2/3 since the last visit).
    var navSupp = document.getElementById('nav-supplemental');
    if (navSupp) navSupp.addEventListener('click', function () {
      setTimeout(renderSupplementalPage, 0);
    });

    // Strategy-pick clicks on Page 2 don't fire any global event, so
    // poll for changes lazily — only when Page 4 is on screen.
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

  root.renderSupplementalPage = renderSupplementalPage;
})(window);
