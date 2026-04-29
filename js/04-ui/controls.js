// FILE: js/04-ui/controls.js
// Page navigation and main run/reset wiring. The app has three pages
// shown one at a time:
//   - 'inputs'     : data entry form
//   - 'projection' : multi-year results table
//   - 'allocator'  : year-1 allocator suggestions

const PAGE_IDS = ['page-inputs', 'page-projection', 'page-allocator'];

function showPage(id) {
  PAGE_IDS.forEach(p => {
    const el = document.getElementById(p);
    if (el) {
      const isActive = (p === id);
      el.classList.toggle('active', isActive);
      el.style.display = isActive ? '' : 'none';
    }
    const tabId = p.replace('page-', 'nav-');
    const tab = document.getElementById(tabId);
    if (tab) tab.classList.toggle('active', p === id);
  });
  if (id === 'page-allocator') {
    try {
      if (typeof renderStrategySummary === 'function') renderStrategySummary();
    } catch(e) { console.warn('renderStrategySummary failed:', e && e.message); }
  }

    if (id === 'page-projection') {
    try {
      // Auto-run the full decision-engine + tax-comparison + dashboard pipeline.
      // The engine itself decides single-year (max Year-1 deduction) vs multi-year
      // structured-sale based on whether the gain can be fully offset in one year.
      if (typeof runRecommendation === 'function') {
        try { runRecommendation(); } catch(e) { console.warn('runRecommendation failed:', e && e.message); }
      }
      if (typeof renderProjectionDashboard === 'function') {
        if (window.__lastResult && window.__lastResult.years && window.__lastResult.years.length) {
          renderProjectionDashboard();
        } else if (typeof collectInputs === 'function' && typeof ProjectionEngine !== 'undefined' && ProjectionEngine.run) {
          try {
            const _cfg = collectInputs();
            const _sp = Number((document.getElementById('sale-price') || {}).value) || 0;
            const _cb = Number((document.getElementById('cost-basis') || {}).value) || 0;
            const _ad = Number((document.getElementById('accelerated-depreciation') || {}).value) || 0;
            if (_sp) _cfg.salePrice = _sp;
            if (_cb) _cfg.costBasis = _cb;
            if (_ad) _cfg.acceleratedDepreciation = _ad;
            _cfg.strategyKey = _cfg.tierKey;
            _cfg.investedCapital = _cfg.investment;
            _cfg.years = _cfg.horizonYears;
            window.__lastResult = ProjectionEngine.run(_cfg);
            renderProjectionDashboard();
          } catch (e) { console.warn('on-demand projection failed:', e && e.message); }
        }
      }
    } catch(e) { console.warn('page-projection auto-run failed:', e && e.message); }
  }
  if (id === 'page-allocator-legacy-tax') {
    try {
      const host = document.getElementById('tax-comparison-host');
      if (host && typeof renderTaxComparison === 'function') {
        renderTaxComparison(host, window.__lastComparison);
      }
    } catch(e) {
      console.warn('renderTaxComparison failed:', e && e.message);
    }
  }
}

function _yearSchedule(cfg) {
  const host = document.getElementById('year-schedule');
  if (!host) return;
  host.innerHTML = '';
  for (let i = 0; i < cfg.horizonYears; i++) {
    const yr = cfg.year1 + i;
    const row = document.createElement('div');
    row.className = 'year-row';
    row.innerHTML = '<span class="yr-label">' + yr + '</span>'
                  + '<input data-field="ordinary"   type="text" placeholder="Ordinary income" />'
                  + '<input data-field="short-gain" type="text" placeholder="Short-term gain" />'
                  + '<input data-field="long-gain"  type="text" placeholder="Long-term gain" />'
                  + '<input data-field="loss-rate"  type="text" placeholder="Loss rate %" />';
    host.appendChild(row);
  }
}

function _buildFutureYearsUI() {
  const host = document.getElementById('future-years-host');
  if (!host) return;
  const horizon = parseInt((document.getElementById('projection-years') || {}).value, 10) || 5;
  const year1 = parseInt((document.getElementById('year1') || {}).value, 10) || (new Date()).getFullYear();
  const existing = {};
  host.querySelectorAll('.year-row').forEach(r => {
    const y = parseInt(r.getAttribute('data-year'), 10);
    if (!Number.isFinite(y)) return;
    existing[y] = {};
    r.querySelectorAll('input[data-field]').forEach(inp => {
      existing[y][inp.getAttribute('data-field')] = inp.value;
    });
  });
  host.innerHTML = '';
  for (let i = 1; i < horizon; i++) {
    const yr = year1 + i;
    const prev = existing[yr] || {};
    const row = document.createElement('div');
    row.className = 'year-row';
    row.setAttribute('data-year', yr);
    row.innerHTML = '<span class="yr-label">Year ' + (i + 1) + ' (' + yr + ')</span>'
                  + '<input data-field="ordinary"   type="text" placeholder="Ordinary income" value="' + (prev.ordinary || '') + '" />'
                  + '<input data-field="short-gain" type="text" placeholder="Short-term gain" value="' + (prev['short-gain'] || '') + '" />'
                  + '<input data-field="long-gain"  type="text" placeholder="Long-term gain"  value="' + (prev['long-gain'] || '') + '" />';
    host.appendChild(row);
  }
}

// --- Custodian wiring ---------------------------------------------------
function _populateCustodian() {
  const sel = document.getElementById('custodian-select');
  if (!sel) return;
  if (typeof listCustodians !== 'function') return;
  const items = listCustodians();
  while (sel.options.length > 1) sel.remove(1);
  items.forEach(it => {
    const opt = document.createElement('option');
    opt.value = it.id;
    opt.textContent = it.label;
    sel.appendChild(opt);
  });
}

function _onCustodianChange() {
  const custSel = document.getElementById('custodian-select');
  const lcSel = document.getElementById('leverage-cap-select');
  const stratSel = document.getElementById('strategy-select');
  const info = document.getElementById('custodian-info');
  if (!custSel || !lcSel) return;
  // Capture leverage-cap value BEFORE the default block clears options,
  // so the Schwab-override block can preserve the user's previous selection.
  var __prevLcVal = lcSel.value;
  const id = custSel.value;
  const c = (typeof getCustodian === 'function') ? getCustodian(id) : null;

  while (lcSel.options.length > 0) lcSel.remove(0);

  if (!c) {
    const opt = document.createElement('option');
    opt.value = '';
    opt.textContent = '-- choose custodian first --';
    lcSel.appendChild(opt);
    lcSel.disabled = true;
    if (info) info.textContent = 'No custodian selected. Pick a custodian above to unlock strategies and leverage caps.';
    if (stratSel) Array.from(stratSel.options).forEach(o => { o.disabled = false; });
    return;
  }

  // Default (non-Schwab): populate numeric leverage caps from custodian record.
  c.allowedLeverageCaps.forEach((lev, idx) => {
    const opt = document.createElement('option');
    opt.value = String(lev);
    opt.textContent = lev.toFixed(2) + 'x';
    if (idx === c.allowedLeverageCaps.length - 1) opt.selected = true;
    lcSel.appendChild(opt);
  });
  lcSel.disabled = false;

  // Schwab combo override: populate the leverage-cap dropdown with the
  // Schwab table's leverage labels (e.g. "145/45", "200/100"), filtered to
  // the leverages available for the currently-selected strategy. The cfg
  // layer resolves (strategy, leverageLabel) to a Schwab combo via
  // findSchwabCombo. Leverage is already baked into the combo's loss curve.
  var isSchwab = (c.id === 'schwab' && typeof listSchwabCombos === 'function');
  if (isSchwab) {
    var currentStrat = stratSel ? stratSel.value : null;
    var schwabCombosForStrat = listSchwabCombos().filter(function (sc) {
      return !currentStrat || sc.strategyKey === currentStrat;
    });
    if (schwabCombosForStrat.length) {
      var prevLev = __prevLcVal;
      var validLevels = schwabCombosForStrat.map(function(sc){ return sc.leverageLabel; });
      var preserveIdx = validLevels.indexOf(prevLev);
      while (lcSel.options.length > 0) lcSel.remove(0);
      schwabCombosForStrat.forEach(function (sc) {
        var opt = document.createElement('option');
        opt.value = sc.leverageLabel;
        opt.textContent = sc.leverageLabel + ' (' + sc.longPct + '/' + sc.shortPct + ')';
        lcSel.appendChild(opt);
      });
      // Restore previous leverage selection if still valid; otherwise the
      // browser's default (first option) takes effect. Setting select.value
      // AFTER appending options is the reliable way to programmatically
      // pick a specific option.
      if (preserveIdx >= 0) {
        lcSel.value = prevLev;
      }
      lcSel.disabled = false;
    }
  }

  if (stratSel) {
    Array.from(stratSel.options).forEach(o => {
      const allowed = c.allowedStrategies.indexOf(o.value) !== -1;
      o.disabled = !allowed;
      if (!allowed && stratSel.value === o.value) {
        stratSel.value = c.allowedStrategies[0];
      }
    });
  }

  if (info) {
    const dollarSign = String.fromCharCode(36);
    if (isSchwab) {
      // Combo-aware Schwab info line. Surface the real Brooklyn-notation
      // pairs from the schwab-strategies catalog, plus the per-combo
      // minimum investment for the currently-selected combo.
      var allCombos = listSchwabCombos();
      var currentStrat2 = stratSel ? stratSel.value : null;
      var currentLev = lcSel ? lcSel.value : null;
      var leveragePairs = allCombos
        .filter(function (sc) { return !currentStrat2 || sc.strategyKey === currentStrat2; })
        .map(function (sc) { return sc.leverageLabel; });
      var pickedCombo = (typeof findSchwabCombo === 'function')
        ? findSchwabCombo(currentStrat2, currentLev)
        : null;
      var minTxt = '';
      if (pickedCombo && pickedCombo.minInvestment) {
        minTxt = ' • minimum investment for ' + pickedCombo.strategyLabel
              + ' ' + pickedCombo.leverageLabel
              + ': ' + dollarSign + pickedCombo.minInvestment.toLocaleString();
      }
      info.textContent = c.label
        + ' • ' + allCombos.length + ' combos available'
        + ' • leverage pairs for selected strategy: '
        + (leveragePairs.length ? leveragePairs.join(', ') : 'none')
        + minTxt;
    } else {
      const minStrat = stratSel ? stratSel.value : c.allowedStrategies[0];
      const minInv = (typeof getMinInvestment === 'function') ? getMinInvestment(id, minStrat) : 0;
      info.textContent = c.label + ' • '
        + c.allowedStrategies.length + ' strategies offered • '
        + 'leverage caps: ' + c.allowedLeverageCaps.map(v => v.toFixed(2) + 'x').join(', ')
        + (minInv ? ' • minimum investment for ' + minStrat + ': ' + dollarSign + minInv.toLocaleString() : '');
    }
  }

  // When custodian is not Schwab, clear any leftover Schwab warning.
  if (!isSchwab) {
    var leftover = document.getElementById('schwab-below-min-warning');
    if (leftover) leftover.textContent = '';
  }

  // Below-minimum warning for Schwab combos: shows when the user has entered
  // an invested capital amount that's less than the selected combo's minimum.
  // Looks for #invested-capital on Page 2 (Brooklyn Configuration) and writes
  // a soft warning into a sibling element if the value is below the threshold.
  if (isSchwab) {
    try {
      var invInp = document.getElementById('invested-capital');
      var currentStrat3 = stratSel ? stratSel.value : null;
      var currentLev3 = lcSel ? lcSel.value : null;
      var picked3 = (typeof findSchwabCombo === 'function')
        ? findSchwabCombo(currentStrat3, currentLev3)
        : null;
      if (invInp && picked3 && picked3.minInvestment) {
        var invVal = Number(invInp.value) || 0;
        var warnId = 'schwab-below-min-warning';
        var warnEl = document.getElementById(warnId);
        if (invVal > 0 && invVal < picked3.minInvestment) {
          if (!warnEl) {
            warnEl = document.createElement('p');
            warnEl.id = warnId;
            warnEl.className = 'subtitle';
            warnEl.style.color = '#c53030';
            warnEl.style.marginTop = '6px';
            invInp.parentNode.appendChild(warnEl);
          }
          var dollarSign2 = String.fromCharCode(36);
          warnEl.textContent = 'Warning: Schwab requires a minimum of '
            + dollarSign2 + picked3.minInvestment.toLocaleString()
            + ' for ' + picked3.strategyLabel + ' ' + picked3.leverageLabel
            + '. You entered ' + dollarSign2 + invVal.toLocaleString() + '.';
        } else if (warnEl) {
          warnEl.textContent = '';
        }
      }
    } catch (e) { /* non-fatal */ }
  }
}

async function runProjection() {
  const _custSel0 = document.getElementById('custodian-select');
  if (_custSel0 && !_custSel0.value) {
    alert('Please select a custodian first (Page 1 → Custodian).');
    showPage('page-inputs');
    return;
  }
  if (!isTaxDataLoaded()) {
    try { await loadTaxData(); }
    catch (e) {
      alert('Failed to load tax brackets: ' + e.message);
      return;
    }
  }
  const cfg = collectInputs();
  const allocation = allocateBrooklyn({
    availableCapital: cfg.availableCapital || cfg.investment,
    year: cfg.year1,
    filingStatus: cfg.filingStatus,
    state: cfg.state,
    ordinaryIncome: cfg.baseOrdinaryIncome,
    shortTermGain: cfg.baseShortTermGain,
    longTermGain: cfg.baseLongTermGain
  });
  renderAllocator(allocation);
  const result = ProjectionEngine.run(cfg);
  window.__lastResult = result;
  window.__lastAllocation = allocation;
  renderProjection(result);
  showPage('page-projection');
}

function bindControls() {
    // Hook: when "Run Decision Engine" fires, also run the multi-year projection
    // engine and render the new dashboard into #projection-table so the
    // Year-by-Year Tax Projection section is populated.
    const recBtn0 = document.getElementById('run-recommendation');
    if (recBtn0) {
      recBtn0.addEventListener('click', function () {
        // Defer slightly so the recommendation handler runs first and
        // window.__lastRecommendation is populated.
        setTimeout(function () {
          try {
            if (typeof collectInputs !== 'function' || typeof ProjectionEngine === 'undefined') return;
            var cfg = collectInputs();
            var sp = Number((document.getElementById('sale-price') || {}).value) || 0;
            var cb = Number((document.getElementById('cost-basis') || {}).value) || 0;
            var ad = Number((document.getElementById('accelerated-depreciation') || {}).value) || 0;
            if (sp) cfg.salePrice = sp;
            if (cb) cfg.costBasis = cb;
            if (ad) cfg.acceleratedDepreciation = ad;
            cfg.strategyKey = cfg.tierKey;
            cfg.investedCapital = cfg.investment;
            cfg.years = cfg.horizonYears;
            window.__lastResult = ProjectionEngine.run(cfg);
            if (typeof renderProjectionDashboard === 'function') renderProjectionDashboard();
          } catch (e) { console.warn('post-recommendation projection failed:', e && e.message); }
        }, 60);
      });
    }

  // Auto-recalc when Brooklyn Configuration inputs change. The Run Decision
  // Engine button is now hidden; the engine fires automatically on Page 2 entry
  // and on any of these field changes.
  ['available-capital', 'invested-capital', 'strategy-select', 'beta1'].forEach(function (fid) {
    const el = document.getElementById(fid);
    if (!el) return;
    const evt = (el.tagName === 'SELECT') ? 'change' : 'input';
    let _t;
    el.addEventListener(evt, function () {
      clearTimeout(_t);
      _t = setTimeout(function () {
        try {
          if (typeof runRecommendation === 'function') runRecommendation();
          if (typeof collectInputs === 'function' && typeof ProjectionEngine !== 'undefined' && ProjectionEngine.run) {
            const _cfg = collectInputs();
            const _sp = Number((document.getElementById('sale-price') || {}).value) || 0;
            const _cb = Number((document.getElementById('cost-basis') || {}).value) || 0;
            const _ad = Number((document.getElementById('accelerated-depreciation') || {}).value) || 0;
            if (_sp) _cfg.salePrice = _sp;
            if (_cb) _cfg.costBasis = _cb;
            if (_ad) _cfg.acceleratedDepreciation = _ad;
            _cfg.strategyKey = _cfg.tierKey;
            _cfg.investedCapital = _cfg.investment;
            _cfg.years = _cfg.horizonYears;
            window.__lastResult = ProjectionEngine.run(_cfg);
          }
          if (typeof renderProjectionDashboard === 'function') renderProjectionDashboard();
        } catch (e) { console.warn('auto-recalc failed:', e && e.message); }
      }, 250);
    });
  });

  const runBtn = document.getElementById('run-projection');
  if (runBtn) runBtn.addEventListener('click', runProjection);

  const buildSchedBtn = document.getElementById('build-year-schedule');
  if (buildSchedBtn) {
    buildSchedBtn.addEventListener('click', () => {
      const cfg = collectInputs();
      _yearSchedule(cfg);
    });
  }

  const navInputs = document.getElementById('nav-inputs');
  const navProjection = document.getElementById('nav-projection');
  const navAllocator = document.getElementById('nav-allocator');
  if (navInputs)     navInputs.addEventListener('click', () => showPage('page-inputs'));
  if (navProjection) navProjection.addEventListener('click', () => showPage('page-projection'));
  if (navAllocator)  navAllocator.addEventListener('click', () => showPage('page-allocator'));

  const contBtn = document.getElementById('continue-to-projection');
  if (contBtn) contBtn.addEventListener('click', () => {
    const _cs = document.getElementById('custodian-select');
    if (_cs && !_cs.value) { alert('Please select a custodian first.'); return; }
    showPage('page-projection');
    const recBtn = document.getElementById('run-recommendation');
    if (recBtn) recBtn.click();
  });

  const projYrsSel = document.getElementById('projection-years');
  if (projYrsSel) projYrsSel.addEventListener('change', _buildFutureYearsUI);
  const year1Inp = document.getElementById('year1');
  if (year1Inp) year1Inp.addEventListener('change', _buildFutureYearsUI);
  const futureDetails = document.getElementById('future-years-details');
  if (futureDetails) futureDetails.addEventListener('toggle', () => {
    if (futureDetails.open) _buildFutureYearsUI();
  });
  _buildFutureYearsUI();

  // Custodian wiring
  _populateCustodian();
  const _custSel = document.getElementById('custodian-select');
  if (_custSel) _custSel.addEventListener('change', _onCustodianChange);
  const _stratSel = document.getElementById('strategy-select');
  if (_stratSel) _stratSel.addEventListener('change', _onCustodianChange);

  // Refresh custodian info / Schwab combo warnings when the leverage-cap
  // dropdown or invested-capital change too.
  const _lcSel = document.getElementById('leverage-cap-select');
  if (_lcSel) _lcSel.addEventListener('change', _onCustodianChange);
  const _invInp = document.getElementById('invested-capital');
  if (_invInp) _invInp.addEventListener('input', _onCustodianChange);
  _onCustodianChange();

  showPage('page-inputs');
}

document.addEventListener('DOMContentLoaded', bindControls);
