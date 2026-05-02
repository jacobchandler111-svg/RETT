// FILE: js/04-ui/controls.js
// Page navigation and main run/reset wiring. The app has three pages
// shown one at a time:
//   - 'inputs'     : data entry form
//   - 'projection' : multi-year results table
//   - 'allocator'  : year-1 allocator suggestions

const PAGE_IDS = ['page-inputs', 'page-projection', 'page-allocator'];
const PROJECTION_SUBPAGE_IDS = ['subpage-summary', 'subpage-details'];

function showProjectionSubpage(id) {
  PROJECTION_SUBPAGE_IDS.forEach(function (sid) {
    var panel = document.getElementById(sid);
    if (panel) {
      var isActive = (sid === id);
      panel.classList.toggle('active', isActive);
      if (isActive) panel.removeAttribute('hidden');
      else panel.setAttribute('hidden', '');
    }
    var tabId = sid.replace('subpage-', 'subnav-');
    var tab = document.getElementById(tabId);
    if (tab) {
      tab.classList.toggle('active', sid === id);
      tab.setAttribute('aria-selected', sid === id ? 'true' : 'false');
    }
  });
}

// ---- Case management wiring ---------------------------------------------
// Persists the form to localStorage and exposes a small UI for named
// cases. See js/04-ui/case-storage.js for the storage layer.

function _caseStore() { return window.RETTCaseStorage; }

function _setCaseStatus(text, kind) {
  var el = document.getElementById('case-status');
  if (!el) return;
  el.textContent = text;
  el.classList.remove('case-loaded', 'case-dirty');
  if (kind === 'loaded') el.classList.add('case-loaded');
  else if (kind === 'dirty') el.classList.add('case-dirty');
}

function _refreshCaseDropdown(selectName) {
  var sel = document.getElementById('case-load-select');
  var store = _caseStore();
  if (!sel || !store) return;
  var names = store.listCases();
  while (sel.options.length > 1) sel.remove(1);
  names.forEach(function (n) {
    var opt = document.createElement('option');
    opt.value = n;
    opt.textContent = n;
    sel.appendChild(opt);
  });
  if (selectName != null) sel.value = selectName;
}

function _refreshCaseStatus() {
  var store = _caseStore();
  if (!store) return;
  var current = store.getCurrentCaseName();
  var nameInput = document.getElementById('case-name-input');
  if (current) {
    if (nameInput && !nameInput.value) nameInput.value = current;
    _setCaseStatus('Working on: ' + current, 'loaded');
  } else {
    _setCaseStatus('Untitled (auto-saving)', '');
  }
}

function _persistWorkingState() {
  var store = _caseStore();
  if (!store) return;
  store.saveWorkingState();
}

function _bindCaseControls() {
  var store = _caseStore();
  if (!store) return;

  // While we're applying values programmatically (initial restore or
  // explicit Load Case), suppress dirty-marking so the user doesn't
  // see "unsaved edits" the instant the page paints. Cleared after
  // the debounce window flushes.
  window.__rettSuppressDirty = true;

  // Restore the working state on load — if the user had values from a
  // previous session, the form picks back up where they left off.
  try { store.restoreWorkingState(); } catch (e) { /* non-fatal */ }
  _refreshCaseDropdown(store.getCurrentCaseName());
  _refreshCaseStatus();

  // Auto-save the working state on any input/change anywhere in the form.
  // Debounced to avoid hammering localStorage on fast typing.
  var debounced = _debounce(function () {
    try { _persistWorkingState(); } catch (e) { /* non-fatal */ }
    if (window.__rettSuppressDirty) return;
    // If the user is editing while a named case is loaded, mark dirty so
    // they know clicking Save will overwrite it.
    var currentName = store.getCurrentCaseName();
    if (currentName) _setCaseStatus('Working on: ' + currentName + ' \u2022 unsaved edits', 'dirty');
  }, 300);
  document.addEventListener('input',  debounced, true);
  document.addEventListener('change', debounced, true);

  // Release the suppress flag well after the debounce + any cascading
  // restore-driven events have settled.
  setTimeout(function () { window.__rettSuppressDirty = false; }, 800);

  // Save button: snapshot current form into the named slot.
  var saveBtn = document.getElementById('case-save-btn');
  if (saveBtn) saveBtn.addEventListener('click', function () {
    var nameInput = document.getElementById('case-name-input');
    var name = nameInput ? (nameInput.value || '').trim() : '';
    if (!name) {
      if (typeof showBanner === 'function') {
        showBanner('warning', 'Enter a case name before saving.');
      } else {
        alert('Enter a case name before saving.');
      }
      if (nameInput) nameInput.focus();
      return;
    }
    var existed = !!store.getCase(name);
    if (existed && !window.confirm('Overwrite existing case "' + name + '"?')) {
      return;
    }
    store.saveCase(name);
    _refreshCaseDropdown(name);
    _setCaseStatus(existed ? 'Updated: ' + name : 'Saved: ' + name, 'loaded');
    if (typeof showBanner === 'function') {
      showBanner('info', (existed ? 'Updated case "' : 'Saved case "') + name + '"');
      setTimeout(function () { if (typeof hideBanner === 'function') hideBanner(); }, 2500);
    }
  });

  // Load button: pull the dropdown's selection into the form.
  var loadBtn = document.getElementById('case-load-btn');
  if (loadBtn) loadBtn.addEventListener('click', function () {
    var sel = document.getElementById('case-load-select');
    var name = sel ? sel.value : '';
    if (!name) {
      if (typeof showBanner === 'function') showBanner('warning', 'Pick a case from the dropdown first.');
      return;
    }
    window.__rettSuppressDirty = true;
    var ok = store.loadCase(name);
    if (!ok) {
      window.__rettSuppressDirty = false;
      if (typeof showBanner === 'function') showBanner('error', 'Could not load case "' + name + '".');
      return;
    }
    var nameInput = document.getElementById('case-name-input');
    if (nameInput) nameInput.value = name;
    _refreshCaseStatus();
    // After applying values, re-run derived UI so leverage caps,
    // computed gain, and the Schwab combo info reflect the loaded case.
    if (typeof _onCustodianChange === 'function') {
      try { _onCustodianChange(); } catch (e) {}
    }
    setTimeout(function () { window.__rettSuppressDirty = false; }, 800);
    if (typeof showBanner === 'function') {
      showBanner('info', 'Loaded case "' + name + '"');
      setTimeout(function () { if (typeof hideBanner === 'function') hideBanner(); }, 2500);
    }
  });

  // Delete button: remove the dropdown's selection.
  var delBtn = document.getElementById('case-delete-btn');
  if (delBtn) delBtn.addEventListener('click', function () {
    var sel = document.getElementById('case-load-select');
    var name = sel ? sel.value : '';
    if (!name) {
      if (typeof showBanner === 'function') showBanner('warning', 'Pick a case from the dropdown to delete.');
      return;
    }
    if (!window.confirm('Delete case "' + name + '"? This cannot be undone.')) return;
    store.deleteCase(name);
    _refreshCaseDropdown('');
    if (store.getCurrentCaseName() === '') {
      var nameInput = document.getElementById('case-name-input');
      if (nameInput) nameInput.value = '';
    }
    _refreshCaseStatus();
    if (typeof showBanner === 'function') {
      showBanner('info', 'Deleted case "' + name + '"');
      setTimeout(function () { if (typeof hideBanner === 'function') hideBanner(); }, 2500);
    }
  });

  // New button: start fresh. Clears working state, current-case pointer,
  // and the form (via resetAllInputs without the confirm prompt).
  var newBtn = document.getElementById('case-new-btn');
  if (newBtn) newBtn.addEventListener('click', function () {
    if (!window.confirm('Start a new case? Unsaved changes will be discarded.')) return;
    store.startNewCase();
    resetAllInputs(true);
    _refreshCaseDropdown('');
    var nameInput = document.getElementById('case-name-input');
    if (nameInput) nameInput.value = '';
    _refreshCaseStatus();
  });

  // Auto-set the case name input when the load dropdown changes (so the
  // user can hit Save to overwrite without retyping the name).
  var loadSel = document.getElementById('case-load-select');
  if (loadSel) loadSel.addEventListener('change', function () {
    var nameInput = document.getElementById('case-name-input');
    if (nameInput && loadSel.value) nameInput.value = loadSel.value;
  });
}

function resetAllInputs(skipConfirm) {
  // Reset all editable form fields on Page 1 and Page 2 to their initial state.
  // Resets the underlying defaults selected in HTML — does NOT clear localStorage
  // (the app does not persist anything yet).
  const resetIds = [
    // Page 1: Filing
    'year1', 'filing-status', 'state-code', 'projection-years',
    // Page 1: Income
    'w2-wages', 'se-income', 'biz-revenue', 'rental-income',
    'dividend-income', 'retirement-distributions',
    // Page 1: Appreciated Assets
    'sale-price', 'cost-basis', 'accelerated-depreciation',
    'computed-gain', 'short-term-gain', 'long-term-gain',
    // Page 1: Implementation timing
    'implementation-date',
    // Page 1: Custodian
    'custodian-select', 'leverage-cap-select',
    // Page 2: Brooklyn config
    'available-capital', 'invested-capital', 'strategy-select', 'beta1'
  ];
  resetIds.forEach(function (id) {
    const el = document.getElementById(id);
    if (!el) return;
    if (el.tagName === 'SELECT') {
      // Restore the option marked `selected` in HTML, or fall back to first option.
      let restored = false;
      for (let i = 0; i < el.options.length; i++) {
        if (el.options[i].defaultSelected) {
          el.selectedIndex = i;
          restored = true;
          break;
        }
      }
      if (!restored && el.options.length) el.selectedIndex = 0;
    } else if (el.type === 'checkbox' || el.type === 'radio') {
      el.checked = el.defaultChecked;
    } else {
      el.value = el.defaultValue || '';
    }
    el.classList.remove('input-error');
  });

  // Cleared computed-gain/computed-total-taxable above; trigger re-derivation
  // by dispatching input events on the source fields.
  ['sale-price', 'cost-basis', 'accelerated-depreciation'].forEach(function (id) {
    const el = document.getElementById(id);
    if (el) el.dispatchEvent(new Event('input', { bubbles: true }));
  });

  // Repopulate custodian-driven UI (leverage caps, strategy availability).
  if (typeof _onCustodianChange === 'function') {
    try { _onCustodianChange(); } catch (e) { /* non-fatal */ }
  }

  // Clear any rendered output panels.
  ['recommendation-panel', 'projection-table', 'projection-summary-host',
   'projection-details-host', 'bracket-viz-host', 'narrative-host',
   'tax-comparison-host', 'allocator-output'].forEach(function (id) {
    const el = document.getElementById(id);
    if (el) el.innerHTML = '';
  });
  var narrative = document.getElementById('narrative-host');
  if (narrative) narrative.hidden = true;
  window.__lastResult = null;
  window.__lastAllocation = null;
  window.__lastComparison = null;
  window.__lastRecommendation = null;
  if (typeof renderSavingsRibbon === 'function') {
    try { renderSavingsRibbon(); } catch (e) { /* non-fatal */ }
  }
  // Re-enable auto-pick so the next projection picks the best combo again.
  window.__rettAutoPickEnabled = true;

  // Sync the auto-saved working state to the cleared form so a refresh
  // doesn't bring the old values back.
  if (window.RETTCaseStorage && typeof window.RETTCaseStorage.saveWorkingState === 'function') {
    try { window.RETTCaseStorage.saveWorkingState(); } catch (e) { /* */ }
  }

  if (typeof hideBanner === 'function') hideBanner();
  if (!skipConfirm) {
    if (typeof showBanner === 'function') showBanner('info', 'Form reset.');
    setTimeout(function () { if (typeof hideBanner === 'function') hideBanner(); }, 2000);
  }

  showPage('page-inputs');
}

function _debounce(fn, ms) {
  let t;
  return function () {
    const args = arguments, ctx = this;
    clearTimeout(t);
    t = setTimeout(function () { fn.apply(ctx, args); }, ms);
  };
}

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
    if (tab) {
      tab.classList.toggle('active', p === id);
      tab.setAttribute('aria-selected', p === id ? 'true' : 'false');
    }
  });
  if (id === 'page-allocator') {
    try {
      if (typeof renderStrategySummary === 'function') renderStrategySummary();
    } catch(e) { (window.reportFailure || console.warn)('Strategy Summary render failed', e); }
  }

  if (id === 'page-projection') {
    try {
      // Auto-pick the (leverage, horizon, recognition) combination that
      // maximizes net savings on first entry, then build the visual pill
      // toggles so the user can override.
      if (typeof maybeAutoPick === 'function') {
        try { maybeAutoPick(); }
        catch (e) { (window.reportFailure || console.warn)('Auto-pick optimizer failed', e); }
      }
      if (typeof buildPillToggles === 'function') {
        try { buildPillToggles(); }
        catch (e) { (window.reportFailure || console.warn)('Could not build pill toggles', e); }
      }
      // Run the full pipeline: recommendation engine -> projection engine ->
      // dashboard render. Replaces the legacy click-the-hidden-button trick.
      runFullPipeline();
    } catch (e) {
      (window.reportFailure || console.warn)('Could not run the projection pipeline', e, { level: 'error' });
    }
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

// --- _onCustodianChange helpers ----------------------------------------
// Each helper does one focused job. The orchestrator at the bottom calls
// them in order. Splitting these out makes it easier to test individual
// pieces and to reason about which DOM nodes get touched.

function _resetLeverageSelectToEmpty(lcSel, stratSel, info) {
  while (lcSel.options.length > 0) lcSel.remove(0);
  const opt = document.createElement('option');
  opt.value = '';
  opt.textContent = '-- choose custodian first --';
  lcSel.appendChild(opt);
  lcSel.disabled = true;
  if (info) info.textContent = 'No custodian selected. Pick a custodian above to unlock strategies and leverage caps.';
  if (stratSel) Array.from(stratSel.options).forEach(o => { o.disabled = false; });
}

function _populateLeverageOptions(lcSel, custodian, prevLcVal) {
  while (lcSel.options.length > 0) lcSel.remove(0);
  custodian.allowedLeverageCaps.forEach((lev, idx) => {
    const opt = document.createElement('option');
    opt.value = String(lev);
    opt.textContent = lev.toFixed(2) + 'x';
    if (idx === custodian.allowedLeverageCaps.length - 1) opt.selected = true;
    lcSel.appendChild(opt);
  });
  // Restore prior selection when still valid; otherwise the highest cap
  // (last one, marked selected above) remains chosen.
  if (prevLcVal && Array.from(lcSel.options).some(o => o.value === String(prevLcVal))) {
    lcSel.value = String(prevLcVal);
  }
  lcSel.disabled = false;
}

function _populateSchwabComboOptions(lcSel, stratSel, prevLcVal) {
  if (typeof listSchwabCombos !== 'function') return;
  const currentStrat = stratSel ? stratSel.value : null;
  const combosForStrat = listSchwabCombos().filter(sc =>
    !currentStrat || sc.strategyKey === currentStrat
  );
  if (!combosForStrat.length) return;
  const validLabels = combosForStrat.map(sc => sc.leverageLabel);
  const preserveIdx = validLabels.indexOf(prevLcVal);
  while (lcSel.options.length > 0) lcSel.remove(0);
  combosForStrat.forEach(sc => {
    const opt = document.createElement('option');
    opt.value = sc.leverageLabel;
    opt.textContent = (sc.leverageLabel === sc.longPct + '/' + sc.shortPct)
      ? sc.leverageLabel
      : (sc.leverageLabel + ' (' + sc.longPct + '/' + sc.shortPct + ')');
    lcSel.appendChild(opt);
  });
  if (preserveIdx >= 0) lcSel.value = prevLcVal;
  lcSel.disabled = false;
}

function _applyStrategyAvailability(stratSel, custodian) {
  if (!stratSel) return;
  Array.from(stratSel.options).forEach(o => {
    const allowed = custodian.allowedStrategies.indexOf(o.value) !== -1;
    o.disabled = !allowed;
    if (!allowed && stratSel.value === o.value) {
      stratSel.value = custodian.allowedStrategies[0];
    }
  });
}

function _renderCustodianInfo(info, custodian, stratSel, lcSel, isSchwab) {
  if (!info) return;
  const $ = String.fromCharCode(36);
  if (isSchwab) {
    const allCombos = (typeof listSchwabCombos === 'function') ? listSchwabCombos() : [];
    const currentStrat = stratSel ? stratSel.value : null;
    const currentLev = lcSel ? lcSel.value : null;
    const leveragePairs = allCombos
      .filter(sc => !currentStrat || sc.strategyKey === currentStrat)
      .map(sc => sc.leverageLabel);
    const pickedCombo = (typeof findSchwabCombo === 'function')
      ? findSchwabCombo(currentStrat, currentLev) : null;
    const minTxt = (pickedCombo && pickedCombo.minInvestment)
      ? ' • minimum investment for ' + pickedCombo.strategyLabel + ' ' + pickedCombo.leverageLabel +
        ': ' + $ + pickedCombo.minInvestment.toLocaleString()
      : '';
    info.textContent = custodian.label +
      ' • ' + allCombos.length + ' combos available' +
      ' • leverage pairs for selected strategy: ' +
      (leveragePairs.length ? leveragePairs.join(', ') : 'none') +
      minTxt;
  } else {
    const minStrat = stratSel ? stratSel.value : custodian.allowedStrategies[0];
    const minInv = (typeof getMinInvestment === 'function') ? getMinInvestment(custodian.id, minStrat) : 0;
    info.textContent = custodian.label + ' • ' +
      custodian.allowedStrategies.length + ' strategies offered • ' +
      'leverage caps: ' + custodian.allowedLeverageCaps.map(v => v.toFixed(2) + 'x').join(', ') +
      (minInv ? ' • minimum investment for ' + minStrat + ': ' + $ + minInv.toLocaleString() : '');
  }
}

function _renderSchwabBelowMinWarning(stratSel, lcSel, isSchwab) {
  const warnId = 'schwab-below-min-warning';
  const existing = document.getElementById(warnId);
  if (!isSchwab) {
    if (existing) existing.textContent = '';
    return;
  }
  const invInp = document.getElementById('invested-capital');
  const currentStrat = stratSel ? stratSel.value : null;
  const currentLev = lcSel ? lcSel.value : null;
  const combo = (typeof findSchwabCombo === 'function')
    ? findSchwabCombo(currentStrat, currentLev) : null;
  if (!invInp || !combo || !combo.minInvestment) return;
  const invVal = Number(invInp.value) || 0;
  let warnEl = existing;
  if (invVal > 0 && invVal < combo.minInvestment) {
    if (!warnEl) {
      warnEl = document.createElement('p');
      warnEl.id = warnId;
      warnEl.className = 'subtitle';
      warnEl.style.color = '#c53030';
      warnEl.style.marginTop = '6px';
      invInp.parentNode.appendChild(warnEl);
    }
    const $ = String.fromCharCode(36);
    warnEl.textContent = 'Warning: Schwab requires a minimum of ' +
      $ + combo.minInvestment.toLocaleString() +
      ' for ' + combo.strategyLabel + ' ' + combo.leverageLabel +
      '. You entered ' + $ + invVal.toLocaleString() + '.';
  } else if (warnEl) {
    warnEl.textContent = '';
  }
}

function _onCustodianChange() {
  const custSel = document.getElementById('custodian-select');
  const lcSel = document.getElementById('leverage-cap-select');
  const stratSel = document.getElementById('strategy-select');
  const info = document.getElementById('custodian-info');
  if (!custSel || !lcSel) return;

  const prevLcVal = lcSel.value;
  const custodianId = custSel.value;
  const custodian = (typeof getCustodian === 'function') ? getCustodian(custodianId) : null;

  if (!custodian) {
    _resetLeverageSelectToEmpty(lcSel, stratSel, info);
    return;
  }

  // Default (non-Schwab): numeric leverage caps from the custodian record.
  // Schwab override (when applicable): replace with combo labels filtered
  // by the currently-selected strategy. The cfg layer resolves
  // (strategy, leverageLabel) to a combo via findSchwabCombo.
  _populateLeverageOptions(lcSel, custodian, prevLcVal);
  const isSchwab = (custodian.id === 'schwab' && typeof listSchwabCombos === 'function');
  if (isSchwab) _populateSchwabComboOptions(lcSel, stratSel, prevLcVal);

  _applyStrategyAvailability(stratSel, custodian);
  _renderCustodianInfo(info, custodian, stratSel, lcSel, isSchwab);
  _renderSchwabBelowMinWarning(stratSel, lcSel, isSchwab);

  // Rebuild Page-2 pill toggles since leverage options just changed.
  if (typeof buildPillToggles === 'function') {
    try { buildPillToggles(); } catch (e) { /* non-fatal */ }
  }
}

// Build a normalized engine cfg from the form, augmented with the raw
// property-sale fields the recommendation engine expects. Used by the
// auto-run pipeline and the auto-recalc handler so the cfg shape stays
// consistent in both code paths.
function _buildEngineCfg() {
  if (typeof collectInputs !== 'function') return null;
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
  return cfg;
}

// Run the full Page-2 pipeline: recommendation engine, then projection
// engine, then dashboard render. Replaces the legacy approach of
// dispatching a click on the (now-removed) #run-recommendation button.
function runFullPipeline() {
  if (typeof runRecommendation === 'function') {
    try { runRecommendation(); }
    catch (e) { (window.reportFailure || console.warn)('Recommendation engine failed', e); }
  }
  if (typeof ProjectionEngine !== 'undefined' && ProjectionEngine.run) {
    try {
      var cfg = _buildEngineCfg();
      if (cfg) {
        window.__lastResult = ProjectionEngine.run(cfg);
        if (typeof renderProjectionDashboard === 'function') renderProjectionDashboard();
      }
    } catch (e) { (window.reportFailure || console.warn)('Projection render failed', e); }
  }
}

function bindControls() {
  // Auto-recalc when Brooklyn Configuration inputs change. The pipeline
  // fires automatically on Page 2 entry and on any of these field changes.
  ['available-capital', 'invested-capital', 'strategy-select', 'beta1'].forEach(function (fid) {
    const el = document.getElementById(fid);
    if (!el) return;
    const evt = (el.tagName === 'SELECT') ? 'change' : 'input';
    let _t;
    el.addEventListener(evt, function () {
      clearTimeout(_t);
      _t = setTimeout(function () {
        try {
          // Re-run the auto-pick optimizer if the user hasn't overridden a
          // pill yet. Brooklyn config changes (invested capital, strategy)
          // can shift the optimal (leverage, horizon, recognition) combo.
          if (typeof maybeAutoPick === 'function') {
            try { maybeAutoPick(); } catch (e) { /* non-fatal */ }
          }
          runFullPipeline();
          if (typeof syncPillSelection === 'function') syncPillSelection();
        } catch (e) { (window.reportFailure || console.warn)('Auto-recalculate failed', e); }
      }, 250);
    });
  });

  const navInputs = document.getElementById('nav-inputs');
  const navProjection = document.getElementById('nav-projection');
  const navAllocator = document.getElementById('nav-allocator');
  if (navInputs)     navInputs.addEventListener('click', () => showPage('page-inputs'));
  if (navProjection) navProjection.addEventListener('click', () => showPage('page-projection'));
  if (navAllocator)  navAllocator.addEventListener('click', () => showPage('page-allocator'));

  // Sub-tabs on Page 2 (Summary | Details).
  const subnavSummary = document.getElementById('subnav-summary');
  const subnavDetails = document.getElementById('subnav-details');
  if (subnavSummary) subnavSummary.addEventListener('click', () => showProjectionSubpage('subpage-summary'));
  if (subnavDetails) subnavDetails.addEventListener('click', () => showProjectionSubpage('subpage-details'));

  const contBtn = document.getElementById('continue-to-projection');
  if (contBtn) contBtn.addEventListener('click', () => {
    if (typeof validateAndReport === 'function' && !validateAndReport('client')) {
      return;
    }
    // Carry the Sale Price over to Available Capital on Page 2 the first
    // time the user advances. They can override on Page 2 if they don't
    // want to invest the full sale proceeds. We don't overwrite an
    // already-entered Available Capital.
    const saleEl   = document.getElementById('sale-price');
    const availEl  = document.getElementById('available-capital');
    if (saleEl && availEl) {
      const saleVal  = Number(saleEl.value) || 0;
      const availVal = Number(availEl.value) || 0;
      if (saleVal > 0 && availVal === 0) {
        availEl.value = String(saleVal);
        availEl.dispatchEvent(new Event('input', { bubbles: true }));
      }
    }
    // showPage('page-projection') triggers runFullPipeline() internally,
    // so the recommendation engine + dashboard render run automatically
    // on arrival.
    showPage('page-projection');
  });

  const resetBtn = document.getElementById('reset-form');
  if (resetBtn) resetBtn.addEventListener('click', () => {
    if (!window.confirm('Reset all inputs to defaults? Any unsaved values will be lost.')) return;
    resetAllInputs();
  });

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
  if (_invInp) _invInp.addEventListener('input', _debounce(_onCustodianChange, 150));
  _onCustodianChange();

  // Wire case-management controls + restore any auto-saved working state.
  // This must run AFTER _onCustodianChange so the leverage-cap dropdown
  // already has its options populated when we re-apply persisted values.
  try { _bindCaseControls(); } catch (e) { (window.reportFailure || console.warn)('Case management UI failed to wire', e, { level: 'error' }); }

  showPage('page-inputs');
}

document.addEventListener('DOMContentLoaded', bindControls);
