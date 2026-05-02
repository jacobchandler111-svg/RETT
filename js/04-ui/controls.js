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
    } catch(e) { console.warn('renderStrategySummary failed:', e && e.message); }
  }

    if (id === 'page-projection') {
    try {
      // Auto-pick the (leverage, horizon) combination that maximizes net
      // savings on first entry. Then build the visual pill toggles so the
      // user can override. The auto-pick uses the projection engine
      // directly, no engine modification.
      if (typeof maybeAutoPick === 'function') {
        try { maybeAutoPick(); } catch (e) { console.warn('maybeAutoPick failed:', e && e.message); }
      }
      if (typeof buildPillToggles === 'function') {
        try { buildPillToggles(); } catch (e) { console.warn('buildPillToggles failed:', e && e.message); }
      }
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
  const __prevLcVal = lcSel.value;
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
  // Restore previous leverage selection if still valid; otherwise the
  // highest cap (selected above) remains chosen.
  if (__prevLcVal && Array.from(lcSel.options).some(function (o) { return o.value === String(__prevLcVal); })) {
    lcSel.value = String(__prevLcVal);
  }
  lcSel.disabled = false;

  // Schwab combo override: populate the leverage-cap dropdown with the
  // Schwab table's leverage labels (e.g. "145/45", "200/100"), filtered to
  // the leverages available for the currently-selected strategy. The cfg
  // layer resolves (strategy, leverageLabel) to a Schwab combo via
  // findSchwabCombo. Leverage is already baked into the combo's loss curve.
  var isSchwab = (c.id === 'schwab' && typeof listSchwabCombos === 'function');
  if (isSchwab) {
    const currentStrat = stratSel ? stratSel.value : null;
    var schwabCombosForStrat = listSchwabCombos().filter(function (sc) {
      return !currentStrat || sc.strategyKey === currentStrat;
    });
    if (schwabCombosForStrat.length) {
      const prevLev = __prevLcVal;
      var validLevels = schwabCombosForStrat.map(function(sc){ return sc.leverageLabel; });
      var preserveIdx = validLevels.indexOf(prevLev);
      while (lcSel.options.length > 0) lcSel.remove(0);
      schwabCombosForStrat.forEach(function (sc) {
        var opt = document.createElement('option');
        opt.value = sc.leverageLabel;
        opt.textContent = (sc.leverageLabel === sc.longPct + '/' + sc.shortPct) ? sc.leverageLabel : (sc.leverageLabel + ' (' + sc.longPct + '/' + sc.shortPct + ')');
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
      const currentStrat = stratSel ? stratSel.value : null;
      const currentLev = lcSel ? lcSel.value : null;
      var leveragePairs = allCombos
        .filter(function (sc) { return !currentStrat || sc.strategyKey === currentStrat; })
        .map(function (sc) { return sc.leverageLabel; });
      var pickedCombo = (typeof findSchwabCombo === 'function')
        ? findSchwabCombo(currentStrat, currentLev)
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
    const leftover = document.getElementById('schwab-below-min-warning');
    if (leftover) leftover.textContent = '';
  }

  // Rebuild Page-2 pill toggles since the leverage-cap-select options just
  // changed (custodians have different cap lists / Schwab combo labels).
  if (typeof buildPillToggles === 'function') {
    try { buildPillToggles(); } catch (e) { /* non-fatal */ }
  }

  // Below-minimum warning for Schwab combos: shows when the user has entered
  // an invested capital amount that's less than the selected combo's minimum.
  // Looks for #invested-capital on Page 2 (Brooklyn Configuration) and writes
  // a soft warning into a sibling element if the value is below the threshold.
  if (isSchwab) {
    try {
      const invInp = document.getElementById('invested-capital');
      const currentStrat = stratSel ? stratSel.value : null;
      const currentLev = lcSel ? lcSel.value : null;
      const picked3 = (typeof findSchwabCombo === 'function')
        ? findSchwabCombo(currentStrat, currentLev)
        : null;
      if (invInp && picked3 && picked3.minInvestment) {
        const invVal = Number(invInp.value) || 0;
        const warnId = 'schwab-below-min-warning';
        let warnEl = document.getElementById(warnId);
        if (invVal > 0 && invVal < picked3.minInvestment) {
          if (!warnEl) {
            warnEl = document.createElement('p');
            warnEl.id = warnId;
            warnEl.className = 'subtitle';
            warnEl.style.color = '#c53030';
            warnEl.style.marginTop = '6px';
            invInp.parentNode.appendChild(warnEl);
          }
          const dollarSign2 = String.fromCharCode(36);
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
          // Re-run the auto-pick optimizer if the user hasn't overridden a
          // pill yet. Brooklyn config changes (invested capital, strategy)
          // can shift the optimal (leverage, horizon) combo.
          if (typeof maybeAutoPick === 'function') {
            try { maybeAutoPick(); } catch (e) { /* non-fatal */ }
          }
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
          if (typeof syncPillSelection === 'function') syncPillSelection();
        } catch (e) { console.warn('auto-recalc failed:', e && e.message); }
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
    showPage('page-projection');
    const recBtn = document.getElementById('run-recommendation');
    if (recBtn) recBtn.click();
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
  try { _bindCaseControls(); } catch (e) { console.warn('case controls failed:', e && e.message); }

  showPage('page-inputs');
}

document.addEventListener('DOMContentLoaded', bindControls);
