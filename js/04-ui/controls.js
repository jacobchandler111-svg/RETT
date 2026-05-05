// FILE: js/04-ui/controls.js
// Page navigation and main run/reset wiring. The app has three pages
// shown one at a time:
//   - 'inputs'     : data entry form
//   - 'projection' : multi-year results table
//   - 'allocator'  : year-1 allocator suggestions

const PAGE_IDS = ['page-pmq', 'page-inputs', 'page-strategies', 'page-projection', 'page-supplemental', 'page-allocator'];
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
    _setCaseStatus('Saved as ' + current, 'loaded');
  } else {
    _setCaseStatus('Untitled \u2014 enter a name to start saving', '');
  }
}

// Briefly flash a "Saved" indicator after each auto-save so the user
// knows their edits were captured.
var _flashTimer = null;
function _flashSaved(name) {
  if (_flashTimer) clearTimeout(_flashTimer);
  if (name) _setCaseStatus('Saved \u2713 \u2014 ' + name, 'loaded');
  else      _setCaseStatus('Draft saved \u2713', '');
  _flashTimer = setTimeout(_refreshCaseStatus, 1100);
}

function _bindCaseControls() {
  var store = _caseStore();
  if (!store) return;

  // While we're applying values programmatically (initial restore or
  // user-driven Load), suppress the auto-save fired by the resulting
  // input/change events — otherwise loading Jane would trample
  // Jane's saved state with whatever was on screen first.
  window.__rettSuppressAutoSave = true;

  // Page-load restore: prefer the active named case over the un-named
  // draft. Returns 'case' / 'draft' / null.
  try { store.restoreOnPageLoad(); } catch (e) { if (typeof window !== "undefined" && typeof window.reportFailure === "function") window.reportFailure("non-fatal in controls.js", e); else if (typeof console !== "undefined") console.warn(e); }
  // The Page-1 baseline-table renderer attaches its input/change
  // listeners on DOMContentLoaded but THIS path (restoreOnPageLoad)
  // dispatches the form-restore events as part of bindControls — and
  // bindControls runs in the same DOMContentLoaded tick, so depending
  // on script load order the listener can attach AFTER the events
  // fire, leaving the baseline cells at $0 until the user touches
  // the form. Force a render here so the baseline always reflects the
  // restored state immediately. Idempotent and cheap.
  if (typeof window.renderBaselineTable === 'function') {
    try { window.renderBaselineTable(); } catch (e) { /* */ }
  }
  _refreshCaseDropdown(store.getCurrentCaseName());
  _refreshCaseStatus();

  // Auto-save on any input/change anywhere in the form. Debounced so
  // we don't hammer localStorage on fast typing. Routes to the right
  // slot (named case OR un-named draft) based on the current state.
  var debouncedAutoSave = _debounce(function () {
    // Belt-and-suspenders: __rettApplyingState flips synchronously
    // around the form-restore dispatch loop. Even if the time-based
    // __rettSuppressAutoSave window has expired, the apply-loop's
    // events should never trigger an auto-save.
    if (window.__rettSuppressAutoSave || window.__rettApplyingState) return;
    try {
      var result = store.autoSaveCurrent();
      // Refresh dropdown if a brand-new client was just created.
      var listed = store.listCases();
      if (result.mode === 'case' && listed.indexOf(result.name) !== -1) {
        var sel = document.getElementById('case-load-select');
        if (sel) {
          var optionExists = Array.from(sel.options).some(function (o) { return o.value === result.name; });
          if (!optionExists) _refreshCaseDropdown(result.name);
        }
      }
      _flashSaved(result.mode === 'case' ? result.name : '');
    } catch (e) { (window.reportFailure || console.warn)('Auto-save failed', e); }
  }, 300);
  document.addEventListener('input',  debouncedAutoSave, true);
  document.addEventListener('change', debouncedAutoSave, true);

  setTimeout(function () { window.__rettSuppressAutoSave = false; }, 800);

  // ---- Client Name input ------------------------------------------------
  // Typing a name turns the un-named draft into a named case. If the user
  // edits an already-active name, the case is renamed in place.
  //
  // Phantom-save guard: every keystroke USED to fire activateCaseName,
  // so partial typing ("S", "Sm", "Smi", "Smit", "Smith") created up to
  // five ghost cases polluting the dropdown. Two behavior changes here
  // keep the dropdown clean:
  //   - During typing (input event): require >= 2 chars before promoting
  //     a draft to a named case. Renames-in-place still fire so an
  //     already-named case can be edited.
  //   - On blur (commit): promote whatever non-empty name is in the box.
  //     If the user types one character and tabs away, that's an
  //     intentional 1-char name and we honor it. If they type one
  //     character and keep typing, we wait for blur or 2+ chars.
  var nameInput = document.getElementById('case-name-input');
  if (nameInput) {
    // P3-1: client-name sanitization. Strip anything outside the
    // allowed character set before the value flows into localStorage
    // keys, dropdown <option> labels, and the "Saved as ..." status
    // line. Whitelist: letters, digits, spaces, comma/period/apostrophe/
    // hyphen, capped at 80 chars. The HTML maxlength=80 is a hint;
    // this is the enforcement layer that runs on every keystroke and
    // again on blur. Renders via textContent everywhere so even if
    // a cleverly-encoded value slipped through, it would not execute.
    function _sanitizeClientName(raw) {
      if (raw == null) return '';
      var s = String(raw);
      try { s = s.normalize('NFKC'); } catch (e) { /* */ }
      s = s.replace(/[^A-Za-z0-9 ,.'\-]/g, '');
      // Collapse runs of spaces and trim — names like "  John   Smith  "
      // normalize cleanly.
      s = s.replace(/\s+/g, ' ').trim();
      if (s.length > 80) s = s.slice(0, 80);
      return s;
    }
    function _processName(committed) {
      // Sanitize FIRST so the saved key matches the visible value.
      var clean = _sanitizeClientName(nameInput.value);
      if (clean !== nameInput.value) nameInput.value = clean;
      var typed = clean;
      var current = store.getCurrentCaseName();
      if (!typed) {
        if (current) {
          store.setCurrentCaseName('');
          _refreshCaseDropdown('');
          _refreshCaseStatus();
        }
        return;
      }
      if (current && current !== typed) {
        // Rename in place. renameCase returns false if the new name
        // collides with an existing case — in that case revert.
        var ok = store.renameCase(current, typed);
        if (ok === false) { nameInput.value = current; return; }
        _refreshCaseDropdown(typed);
        _refreshCaseStatus();
        return;
      }
      if (!current) {
        // Promote the draft to a named case only when the typed name
        // is meaningfully long (>= 2 chars). Previously a single
        // character on blur committed the name, so a stray click after
        // typing "t" silently created a ghost case "t". The mid-keystroke
        // guard wasn't enough on its own — a 1-char blur slipped through.
        // (Bug #10.)
        if (typed.length < 2) return;
        store.activateCaseName(typed);
        _refreshCaseDropdown(typed);
        _refreshCaseStatus();
        _flashSaved(typed);
      }
    }
    var debouncedName = _debounce(function () { _processName(false); }, 600);
    nameInput.addEventListener('input', debouncedName);
    nameInput.addEventListener('blur', function () { _processName(true); });
  }

  // ---- Load dropdown ---------------------------------------------------
  // Auto-load on selection change; no separate Load button needed.
  var loadSel = document.getElementById('case-load-select');
  if (loadSel) loadSel.addEventListener('change', function () {
    var name = loadSel.value;
    if (!name) return;
    window.__rettSuppressAutoSave = true;
    var ok = store.loadCase(name);
    if (!ok) {
      window.__rettSuppressAutoSave = false;
      (window.reportFailure || console.warn)('Could not load client "' + name + '"');
      return;
    }
    if (nameInput) nameInput.value = name;
    _refreshCaseStatus();
    if (typeof _onCustodianChange === 'function') {
      try { _onCustodianChange(); } catch (e) {}
    }
    setTimeout(function () { window.__rettSuppressAutoSave = false; }, 800);
    if (typeof showBanner === 'function') {
      showBanner('info', 'Loaded client "' + name + '"');
      setTimeout(function () { if (typeof hideBanner === 'function') hideBanner(); }, 1800);
    }
  });

  // ---- Delete ----------------------------------------------------------
  // Removes the currently-selected dropdown entry (or the active client
  // if the dropdown is unset).
  var delBtn = document.getElementById('case-delete-btn');
  if (delBtn) delBtn.addEventListener('click', function () {
    var sel = document.getElementById('case-load-select');
    var name = (sel && sel.value) || store.getCurrentCaseName();
    if (!name) {
      if (typeof showBanner === 'function') showBanner('warning', 'No client selected to delete.');
      return;
    }
    if (!window.confirm('Delete client "' + name + '"? This cannot be undone.')) return;
    store.deleteCase(name);
    _refreshCaseDropdown('');
    if (nameInput) nameInput.value = '';
    _refreshCaseStatus();
    if (typeof showBanner === 'function') {
      showBanner('info', 'Deleted client "' + name + '"');
      setTimeout(function () { if (typeof hideBanner === 'function') hideBanner(); }, 1800);
    }
  });

  // ---- New Client ------------------------------------------------------
  // Clears form + current-case pointer. The next time the user types
  // a name, a fresh case is created.
  var newBtn = document.getElementById('case-new-btn');
  if (newBtn) newBtn.addEventListener('click', function () {
    if (!window.confirm('Start a new client? The form will be cleared.')) return;
    window.__rettSuppressAutoSave = true;
    store.startNewCase();
    resetAllInputs(true);
    _refreshCaseDropdown('');
    if (nameInput) {
      nameInput.value = '';
      nameInput.focus();
    }
    _refreshCaseStatus();
    setTimeout(function () { window.__rettSuppressAutoSave = false; }, 600);
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
    // Page 1: Withholding from sale
    'withhold-yes-no', 'withhold-amount',
    // Page 1: Implementation timing
    'implementation-date', 'strategy-implementation-date',
    // Page 1: Custodian
    'custodian-select', 'leverage-cap-select',
    // Page 2: Brooklyn config
    'available-capital', 'invested-capital', 'strategy-select'
    // Note: legacy IDs that don't exist in the current HTML
    // ('beta1', 'computed-total-taxable') were removed from this list
    // — forEach silently skipped them but they were drift indicators.
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
    try { _onCustodianChange(); } catch (e) { if (typeof window !== "undefined" && typeof window.reportFailure === "function") window.reportFailure("non-fatal in controls.js", e); else if (typeof console !== "undefined") console.warn(e); }
  }

  // Clear any rendered output panels.
  ['recommendation-panel', 'projection-summary-host',
   'projection-details-host', 'narrative-host',
   'tax-comparison-host', 'allocator-output',
   'cashflow-schedule-host', 'interested-cards-host'].forEach(function (id) {
    const el = document.getElementById(id);
    if (el) el.innerHTML = '';
  });
  var narrative = document.getElementById('narrative-host');
  if (narrative) narrative.hidden = true;
  // Strategy-Selection earmarks clear so the next client's Projection
  // page doesn't inherit the prior filter. The Page-3 "Use This
  // Strategy" pick also clears so Page 4 doesn't render stale state.
  window.__rettStrategyInterest = { A: null, B: null, C: null };
  window.__rettChosenStrategy = null;
  // Page-5 supplemental toggle overrides clear too, so a new client
  // starts with default-on for any strategy they later mark Interested
  // — no carry-over from the prior client's session toggles.
  if (typeof window.resetSupplementalEnabledOverride === 'function') {
    try { window.resetSupplementalEnabledOverride(); } catch (e) { /* */ }
  }
  // Clear the Brooklyn investment slider override as well so the new
  // client's Strategy Summary starts at the optimizer's recommendation,
  // not whatever the prior client had dialed.
  window.__rettBrooklynInvestmentOverride = null;
  if (typeof _refreshStrategyPickCards === 'function') {
    try { _refreshStrategyPickCards(); } catch (e) { /* */ }
  }
  window.__lastResult = null;
  window.__lastAllocation = null;
  window.__lastComparison = null;
  window.__lastRecommendation = null;
  if (typeof renderSavingsRibbon === 'function') {
    try { renderSavingsRibbon(); } catch (e) { if (typeof window !== "undefined" && typeof window.reportFailure === "function") window.reportFailure("non-fatal in controls.js", e); else if (typeof console !== "undefined") console.warn(e); }
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

// Refresh the visual state of the three Strategy-Selection cards
// (Sell Now / Seller Finance / Structured). Reads:
//   - window.__rettStrategyInterest     ({ A, B, C: true|false|null }) —
//     the user's per-card Interested / Not Interested earmarks.
// Pure DOM update; safe to call any time, idempotent. The
// engine-recommended badge was intentionally removed from Page 2 —
// the user surfaces the recommendation in conversation, not via UI.
function _refreshStrategyPickCards() {
  var interest = (typeof window !== 'undefined') ? (window.__rettStrategyInterest || {}) : {};
  ['A', 'B', 'C'].forEach(function (key) {
    var card = document.getElementById('strategy-pick-' + key);
    if (!card) return;
    card.classList.toggle('is-interested', interest[key] === true);
    card.classList.toggle('is-not-interested', interest[key] === false);
    // Mark the active button.
    card.querySelectorAll('.strategy-pick-btn').forEach(function (btn) {
      var action = btn.getAttribute('data-pick-action');
      var isOn = (action === 'interested' && interest[key] === true)
              || (action === 'not-interested' && interest[key] === false);
      btn.classList.toggle('is-' + action, isOn);
    });
  });
  _refreshStrategyLockupDisplays();
}

// Populate the per-card lockup graphic value for B (months between
// the configured sale date and Jan 1 of the next year) and C (the
// engine-picked structured-sale duration). A is static "No Lockup".
function _refreshStrategyLockupDisplays() {
  var cfg = null;
  try { cfg = (typeof collectInputs === 'function') ? collectInputs() : null; } catch (e) { cfg = null; }

  var bEl = document.querySelector('[data-lockup-display="B"]');
  if (bEl) {
    var months = _monthsUntilNextJan1(cfg && cfg.implementationDate);
    bEl.textContent = (months != null) ? (months + ' Month Window') : 'Closing Window';
  }

  var cEl = document.querySelector('[data-lockup-display="C"]');
  if (cEl) {
    var pickedMonths = null;
    try {
      if (typeof buildInterestedSummary === 'function') {
        var summary = buildInterestedSummary();
        if (summary && summary.entries) {
          var entryC = summary.entries.filter(function (e) { return e.type === 'C'; })[0];
          if (entryC && entryC.picked && entryC.picked.durationMonths) {
            pickedMonths = entryC.picked.durationMonths;
          }
        }
      }
    } catch (e) { pickedMonths = null; }
    if (!pickedMonths && cfg && cfg.structuredSaleDurationMonths) {
      pickedMonths = cfg.structuredSaleDurationMonths;
    }
    cEl.textContent = (pickedMonths ? pickedMonths : 18) + ' Month Lockup';
  }
}

function _monthsUntilNextJan1(isoDate) {
  if (!isoDate) return null;
  var d = (typeof window !== 'undefined' && typeof window.parseLocalDate === 'function')
    ? window.parseLocalDate(isoDate)
    : new Date(isoDate);
  if (!d || isNaN(d.getTime())) return null;
  var target = new Date(d.getFullYear() + 1, 0, 1);
  var ms = target - d;
  return Math.max(1, Math.min(12, Math.ceil(ms / (1000 * 60 * 60 * 24 * 30.4375))));
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

  if (id === 'page-strategies') {
    // Run the recommendation pipeline silently so the recommended-card
    // border and any future per-card preview numbers are populated by
    // the time the page paints. Same engine that drives Page-Projection;
    // it just renders into the already-existing __rettRecommendedData
    // global. The Strategy-Selection page reads that to mark the winner.
    try {
      if (typeof runFullPipeline === 'function') runFullPipeline();
    } catch (e) { (window.reportFailure || console.warn)('Strategy preview render failed', e); }
    if (typeof _refreshStrategyPickCards === 'function') {
      try { _refreshStrategyPickCards(); } catch (e) { /* */ }
    }
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
      if (typeof renderInterestedSnapshot === 'function') {
        try { renderInterestedSnapshot(); }
        catch (e) { (window.reportFailure || console.warn)('Interested-snapshot render failed', e); }
      }
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
  if (stratSel) {
    Array.from(stratSel.options).forEach(o => { o.disabled = false; });
    // No custodian = no lock; restore the dropdown and hide the
    // locked-label twin used for single-strategy custodians (Schwab).
    stratSel.hidden = false;
    const lockedLabel = document.getElementById('strategy-locked-label');
    if (lockedLabel) lockedLabel.hidden = true;
  }
}

// Populate the leverage-cap select with the custodian's allowedLeverageCaps.
// Note: the dropdown is overloaded — for Schwab it's populated with combo
// LABEL strings ('145/45', '200/100') by _populateSchwabComboOptions; for
// Goldman / no-custodian it's populated here with numeric short ratios.
// Callers reading the value should know which mode is active. (Issue #60.)
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
  // When the custodian only permits one strategy (Schwab → Beta 1),
  // hide the dropdown entirely and show the locked-label twin so it's
  // clear there's no choice to make.
  const lockedLabel = document.getElementById('strategy-locked-label');
  const onlyOne = custodian.allowedStrategies.length === 1;
  if (onlyOne) {
    stratSel.value = custodian.allowedStrategies[0];
    stratSel.hidden = true;
    if (lockedLabel) lockedLabel.hidden = false;
  } else {
    stratSel.hidden = false;
    if (lockedLabel) lockedLabel.hidden = true;
  }
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
    try { buildPillToggles(); } catch (e) { if (typeof window !== "undefined" && typeof window.reportFailure === "function") window.reportFailure("non-fatal in controls.js", e); else if (typeof console !== "undefined") console.warn(e); }
  }
}

// Build a normalized engine cfg from the form, augmented with the raw
// property-sale fields the recommendation engine expects. Used by the
// auto-run pipeline and the auto-recalc handler so the cfg shape stays
// consistent in both code paths.
function _buildEngineCfg() {
  if (typeof collectInputs !== 'function') return null;
  var cfg = collectInputs();
  var sp = parseUSD((document.getElementById('sale-price') || {}).value) || 0;
  var cb = parseUSD((document.getElementById('cost-basis') || {}).value) || 0;
  var ad = parseUSD((document.getElementById('accelerated-depreciation') || {}).value) || 0;
  if (sp) cfg.salePrice = sp;
  if (cb) cfg.costBasis = cb;
  if (ad) cfg.acceleratedDepreciation = ad;
  return rettFlavorEngineCfg(cfg);
}

// Run the full Page-2 pipeline: recommendation engine, then projection
// engine, then dashboard render. Replaces the legacy approach of
// dispatching a click on the (now-removed) #run-recommendation button.
function runFullPipeline() {
  // Recognition is no longer a user-facing pill — the engine always
  // picks the recognition year that maximizes net savings for the
  // current leverage + horizon. Run that scoped optimizer FIRST so
  // the downstream recommendation + projection see the optimal
  // recognition value.
  if (typeof window.searchBestRecognitionForCurrent === 'function') {
    try { window.searchBestRecognitionForCurrent(); } catch (e) { if (typeof window !== "undefined" && typeof window.reportFailure === "function") window.reportFailure("non-fatal in controls.js", e); else if (typeof console !== "undefined") console.warn(e); }
  }
  if (typeof runRecommendation === 'function') {
    try { runRecommendation(); }
    catch (e) { (window.reportFailure || console.warn)('Recommendation engine failed', e); }
  }
  if (typeof ProjectionEngine !== 'undefined' && ProjectionEngine.run) {
    try {
      var cfg = _buildEngineCfg();
      if (cfg) {
        // Two-pass optimizer wiring: run the engine once at the user's
        // requested investment to learn cumulative Brooklyn loss, then
        // ask runBrooklynOptimizer whether to dial back. If yes, re-run
        // at the recommended investment so cumulativeNetSavings,
        // cumulativeFees, and the Details table all reflect the
        // dialed-back position. Without this, the projection engine's
        // totals could disagree with Page-5 hero numbers (which apply
        // the optimizer at buildInterestedSummary time).
        //
        // Skipped when the optimizer module isn't loaded (older saved
        // flows) or when there's no absorbable gain (no sale data) —
        // in both cases the user's requested investment wins.
        var firstPass = ProjectionEngine.run(cfg);
        var firstLoss = (firstPass && firstPass.years)
          ? firstPass.years.reduce(function (s, y) { return s + (y.grossLoss || 0); }, 0)
          : 0;
        if (typeof window.runBrooklynOptimizer === 'function' && firstLoss > 0) {
          var opt = window.runBrooklynOptimizer(cfg, firstLoss);
          if (opt && opt.dialBack && opt.recommendedInvestment >= 0
              && opt.recommendedInvestment < cfg.investment) {
            cfg = Object.assign({}, cfg, { investment: opt.recommendedInvestment });
            window.__lastResult = ProjectionEngine.run(cfg);
            window.__lastResult._optimizerApplied = opt;
          } else {
            window.__lastResult = firstPass;
            window.__lastResult._optimizerApplied = opt || null;
          }
        } else {
          window.__lastResult = firstPass;
        }
        if (typeof renderProjectionDashboard === 'function') renderProjectionDashboard();
      }
    } catch (e) { (window.reportFailure || console.warn)('Projection render failed', e); }
  }
}

function bindControls() {
  // Page-1 scenario fields. Editing any of these means the *fundamentals*
  // of the client's situation changed — the prior (leverage, horizon,
  // recognition) optimum the auto-pick chose is now stale. Re-enable
  // auto-pick so the next pipeline run re-optimizes from scratch instead
  // of carrying over a Page-2 pill override the user clicked under the
  // old scenario. Without this, loading a saved client and editing
  // their sale price keeps the prior selection locked in.
  // When the user types a sale/closing date, auto-mirror it into the
  // strategy implementation date if that field is still blank. The user
  // can then bump the strategy date later without losing the sale-date
  // anchor. Once the strategy date has its own value, sale-date edits
  // do NOT clobber it — that decoupling is the whole point of the field.
  var saleDateInput = document.getElementById('implementation-date');
  var strategyDateInput = document.getElementById('strategy-implementation-date');
  if (saleDateInput && strategyDateInput) {
    saleDateInput.addEventListener('change', function () {
      if (window.__rettApplyingState) return;
      if (!strategyDateInput.value && saleDateInput.value) {
        strategyDateInput.value = saleDateInput.value;
        strategyDateInput.dispatchEvent(new Event('change', { bubbles: true }));
      }
    });
  }

  ['custodian-select', 'year1', 'filing-status', 'state-code',
   'w2-wages', 'se-income', 'biz-revenue', 'rental-income',
   'dividend-income', 'retirement-distributions',
   'sale-price', 'cost-basis', 'accelerated-depreciation', 'short-term-gain',
   'withhold-yes-no', 'withhold-amount', 'implementation-date',
   'strategy-implementation-date'
  ].forEach(function (fid) {
    var el = document.getElementById(fid);
    if (!el) return;
    var evt = (el.tagName === 'SELECT' || el.type === 'date') ? 'change' : 'input';
    el.addEventListener(evt, function () {
      // Skip while case-storage is programmatically restoring state —
      // applyFormState fires synthetic input/change events on every
      // saved field, which would otherwise re-enable auto-pick mid-load
      // (harmless) but also flag every field as "user touched" (it
      // wasn't). Honoring the flag keeps the signal clean.
      if (window.__rettApplyingState) return;
      window.__rettAutoPickEnabled = true;
      // Scenario-comparison overrides are scoped to a specific scenario;
      // editing the scenario's inputs invalidates them so auto-pick
      // can pick fresh against the new fundamentals.
      delete window.__rettScenarioMaxRec;
      delete window.__rettScenarioPinnedRec;
      // Per-section state (horizon / leverage / revert per scenario
      // section) is also scoped to the active scenario fundamentals —
      // a sale-price or income change invalidates the previously
      // auto-picked tuple so each section re-optimizes on the next
      // render.
      delete window.__rettSectionState;
    });
  });

  // Auto-recalc when Brooklyn Configuration inputs change. The pipeline
  // fires automatically on Page 2 entry and on any of these field changes.
  ['available-capital', 'invested-capital', 'strategy-select',
   // Issue #40: leverage-cap-select drives non-Schwab leverage in
   // some flows; auto-recalc needs to fire when it changes.
   // recognition-start-select + custom-short-pct included for the
   // same reason — the slider/pill click handlers normally trigger
   // recompute, but programmatic changes (case-storage applyFormState)
   // bypass them.
   'leverage-cap-select', 'recognition-start-select', 'custom-short-pct',
   // Structured-sale duration caps the deferred recognition window —
   // changing it must re-run the pipeline so chart / pies / KPIs
   // reflect the new maturity year.
   'structured-sale-duration-months'].forEach(function (fid) {
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
            try { maybeAutoPick(); } catch (e) { if (typeof window !== "undefined" && typeof window.reportFailure === "function") window.reportFailure("non-fatal in controls.js", e); else if (typeof console !== "undefined") console.warn(e); }
          }
          runFullPipeline();
          if (typeof syncPillSelection === 'function') syncPillSelection();
        } catch (e) { (window.reportFailure || console.warn)('Auto-recalculate failed', e); }
      }, 250);
    });
  });

  const navPmq = document.getElementById('nav-pmq');
  const navInputs = document.getElementById('nav-inputs');
  const navStrategies = document.getElementById('nav-strategies');
  const navProjection = document.getElementById('nav-projection');
  const navAllocator = document.getElementById('nav-allocator');
  const navSupplemental = document.getElementById('nav-supplemental');
  if (navPmq)          navPmq.addEventListener('click', () => showPage('page-pmq'));
  if (navInputs)       navInputs.addEventListener('click', () => showPage('page-inputs'));
  if (navStrategies)   navStrategies.addEventListener('click', () => showPage('page-strategies'));
  if (navProjection)   navProjection.addEventListener('click', () => showPage('page-projection'));
  if (navAllocator)    navAllocator.addEventListener('click', () => showPage('page-allocator'));

  // Native browser print (Cmd/Ctrl-P) — flip body.print-mode on
  // for the duration of the print so the print-mode CSS rules
  // apply, then remove afterward. Without this, the browser print
  // dialog would render the screen UI verbatim.
  window.addEventListener('beforeprint', function () {
    document.body.classList.add('print-mode');
    if (typeof window.renderStrategySummary === 'function') {
      try { window.renderStrategySummary(); } catch (e) { /* */ }
    }
  });
  window.addEventListener('afterprint', function () {
    document.body.classList.remove('print-mode');
  });

  // Download PDF button. Uses html2pdf.js (loaded via CDN in
  // index.html) to render #page-allocator into a single-page PDF
  // and push it to the browser's downloads folder. The body
  // print-mode class is toggled around the snapshot so the same
  // CSS rules that govern native print also govern the PDF.
  // Filename pattern: "<Client Name> - Strategy Summary.pdf",
  // falling back to "RETT Strategy Summary.pdf" when no client
  // name is set.
  var printBtn = document.getElementById('print-summary-btn');
  if (printBtn) {
    printBtn.addEventListener('click', function () {
      // Make sure we're on the allocator page so the target
      // exists in the layout — otherwise its bounding box is 0.
      if (typeof showPage === 'function') showPage('page-allocator');
      // Re-render so the print-header text is fresh.
      if (typeof window.renderStrategySummary === 'function') {
        try { window.renderStrategySummary(); } catch (e) { /* */ }
      }
      var target = document.getElementById('page-allocator');
      if (!target) return;

      // Build filename from client name (sanitized) — fallback to
      // a generic name if blank.
      var rawName = (document.getElementById('case-name-input') || {}).value || '';
      var safeName = rawName.replace(/[^A-Za-z0-9 ,.'\-]/g, '').trim();
      var filename = (safeName ? (safeName + ' - ') : '')
        + 'Strategy Summary.pdf';

      // No html2pdf? Fall back to native print so the user still
      // gets a usable export path.
      if (typeof window.html2pdf !== 'function') {
        if (typeof window !== 'undefined' && typeof console !== 'undefined') {
          console.warn('html2pdf.js not loaded — falling back to window.print()');
        }
        document.body.classList.add('print-mode');
        try { window.print(); }
        finally { setTimeout(function () { document.body.classList.remove('print-mode'); }, 100); }
        return;
      }

      // Apply print-mode for the snapshot, then flip it off when
      // html2pdf finishes (or errors out — the .finally is paranoid
      // because html2canvas occasionally throws on cross-origin
      // resources we may have included).
      document.body.classList.add('print-mode');
      var opts = {
        margin: [0.4, 0.45, 0.4, 0.45], // inches: top, left, bottom, right
        filename: filename,
        image: { type: 'jpeg', quality: 0.98 },
        html2canvas: {
          scale: 2,
          useCORS: true,
          // Background color rather than transparent so the white
          // card surfaces don't render as gray.
          backgroundColor: '#ffffff'
        },
        jsPDF: { unit: 'in', format: 'letter', orientation: 'portrait' },
        pagebreak: { mode: ['avoid-all', 'css'] }
      };

      window.html2pdf()
        .set(opts)
        .from(target)
        .save()
        .then(function () {
          document.body.classList.remove('print-mode');
        })
        .catch(function (err) {
          (window.reportFailure || console.warn)('PDF export failed', err);
          document.body.classList.remove('print-mode');
        });
    });
  }
  if (navSupplemental) navSupplemental.addEventListener('click', () => showPage('page-supplemental'));

  // Page-4 "Continue to Summary" button. The per-strategy math already
  // runs continuously on every input change (supplemental-render.js
  // listens to the Page-1 baseline + its own Details inputs), so the
  // explicit re-run here is defensive belt-and-suspenders. showPage
  // ('page-allocator') then triggers renderStrategySummary which reads
  // the freshest lastResult off each registered supplemental.
  var navContinueSupp = document.getElementById('supplemental-continue');
  if (navContinueSupp) navContinueSupp.addEventListener('click', function () {
    if (typeof window.renderSupplementalPage === 'function') {
      try { window.renderSupplementalPage(); } catch (e) { /* */ }
    }
    showPage('page-allocator');
  });

  // Strategy Implementation Date can't legally precede the Sale /
  // Closing Date — proceeds don't exist to deploy yet. Mirror the sale
  // date into the strategy-date input's `min` attribute so the
  // browser's native date picker rejects earlier values inline. Also
  // clamp existing strategy-date values forward when the sale date
  // moves later, so the saved-state restore path doesn't leave an
  // invalid pair sitting in the form. (Bug #9.)
  var saleDateEl = document.getElementById('implementation-date');
  var stratDateEl = document.getElementById('strategy-implementation-date');
  if (saleDateEl && stratDateEl) {
    var syncStrategyMin = function () {
      var v = saleDateEl.value || '';
      if (v) {
        stratDateEl.min = v;
        if (stratDateEl.value && stratDateEl.value < v) {
          stratDateEl.value = v;
          stratDateEl.dispatchEvent(new Event('change', { bubbles: true }));
        }
      } else {
        stratDateEl.removeAttribute('min');
      }
    };
    saleDateEl.addEventListener('input', syncStrategyMin);
    saleDateEl.addEventListener('change', syncStrategyMin);
    syncStrategyMin();
  }

  // Pre-Meeting Questionnaire is now a pair of compact <details>
  // squares pinned to the top-right of the Client Inputs page —
  // each opens inline to reveal its dropzone. The native <details>
  // toggle handles the show/hide so no custom wiring is needed
  // here.

  // Sale Proceeds: cosmetic "Payment on sale date" row that surfaces
  // when Accelerated Depreciation > 0. Defaults to whatever the user
  // typed for accel depr and stays in sync until the user manually
  // edits the field. Not yet read by the engine — the advisor will
  // wire the rules in once finalized.
  //
  // Same auto-default extends to the "Amount to keep" field: when
  // accelerated depreciation > 0, default the keep-amount to the full
  // recapture amount and flip "investing everything?" to No. Reason:
  // §1250 recapture is recognized in the year of sale (§453(i)) and
  // must be paid in cash regardless of any structured-sale deferral —
  // keeping the recapture amount back from proceeds gives the client
  // a guaranteed cash buffer for that bill. The advisor can override
  // for Strategy B/C scenarios where the buyer pushes back on the
  // payment-on-sale-date arrangement.
  var accelDeprEl = document.getElementById('accelerated-depreciation');
  var paymentGroup = document.getElementById('payment-on-sale-date-group');
  var paymentInput = document.getElementById('payment-on-sale-date');
  var withholdYesNoEl  = document.getElementById('withhold-yes-no');
  var withholdAmountEl = document.getElementById('withhold-amount');
  if (accelDeprEl && paymentGroup && paymentInput) {
    // Guard so our own programmatic dispatch (input/change events fired
    // from inside syncPayment to keep _recomputeAvailableCapital in sync)
    // does not flip userEdited and freeze the auto-default.
    var _autoSyncing = false;
    paymentInput.addEventListener('input', function () {
      if (_autoSyncing) return;
      paymentInput.dataset.userEdited = 'true';
    });
    if (withholdYesNoEl) {
      withholdYesNoEl.addEventListener('change', function () {
        if (_autoSyncing) return;
        withholdYesNoEl.dataset.userEdited = 'true';
      });
    }
    if (withholdAmountEl) {
      withholdAmountEl.addEventListener('input', function () {
        if (_autoSyncing) return;
        withholdAmountEl.dataset.userEdited = 'true';
      });
    }
    var syncPayment = function () {
      var raw = (typeof parseUSD === 'function') ? parseUSD(accelDeprEl.value) : Number(accelDeprEl.value);
      var amount = Number(raw) || 0;
      var fmt = (typeof fmtUSD === 'function')
        ? fmtUSD
        : function (n) { return '$' + Math.round(n).toLocaleString('en-US'); };
      _autoSyncing = true;
      try {
        if (amount > 0) {
          paymentGroup.hidden = false;
          if (paymentInput.dataset.userEdited !== 'true') {
            paymentInput.value = fmt(amount);
          }
          // Default "investing everything?" to No (value="yes" =
          // keep some) and pre-fill the keep amount with the recapture
          // value, unless the advisor has already touched either field.
          if (withholdYesNoEl && withholdYesNoEl.dataset.userEdited !== 'true' && withholdYesNoEl.value !== 'yes') {
            withholdYesNoEl.value = 'yes';
            withholdYesNoEl.dispatchEvent(new Event('change', { bubbles: true }));
          }
          if (withholdAmountEl && withholdAmountEl.dataset.userEdited !== 'true') {
            withholdAmountEl.value = fmt(amount);
            withholdAmountEl.dispatchEvent(new Event('input', { bubbles: true }));
          }
        } else {
          paymentGroup.hidden = true;
          if (paymentInput.dataset.userEdited !== 'true') paymentInput.value = '';
          if (withholdAmountEl && withholdAmountEl.dataset.userEdited !== 'true') {
            withholdAmountEl.value = '';
            withholdAmountEl.dispatchEvent(new Event('input', { bubbles: true }));
          }
          if (withholdYesNoEl && withholdYesNoEl.dataset.userEdited !== 'true' && withholdYesNoEl.value === 'yes') {
            withholdYesNoEl.value = 'no';
            withholdYesNoEl.dispatchEvent(new Event('change', { bubbles: true }));
          }
        }
      } finally {
        _autoSyncing = false;
      }
    };
    accelDeprEl.addEventListener('input', syncPayment);
    accelDeprEl.addEventListener('change', syncPayment);
    syncPayment();
  }

  // Future Appreciated Asset Sale (Section 07): the Yes/No question
  // toggles the conditional fields group, and the LT-gain readout
  // mirrors the existing computed-gain pattern (sale - basis - depr,
  // floored at 0). The optimizer reads cfg.futureSale to decide how
  // much of the current Brooklyn position should generate carryforward
  // for that future gain — when "no", excess loss is wasted, so the
  // solver should pull Brooklyn back. Wiring is purely UI here; the
  // engine consumes the data via inputs-collector.
  var futureYesNoEl   = document.getElementById('future-sale-yes-no');
  var futureGroupEl   = document.getElementById('future-sale-fields-group');
  var futureSaleEl    = document.getElementById('future-sale-price');
  var futureBasisEl   = document.getElementById('future-cost-basis');
  var futureDeprEl    = document.getElementById('future-accelerated-depreciation');
  var futureGainEl    = document.getElementById('future-long-term-gain');
  if (futureYesNoEl && futureGroupEl) {
    var syncFutureGroup = function () {
      futureGroupEl.hidden = (futureYesNoEl.value !== 'yes');
    };
    futureYesNoEl.addEventListener('change', syncFutureGroup);
    futureYesNoEl.addEventListener('input',  syncFutureGroup);
    syncFutureGroup();
  }
  if (futureSaleEl && futureBasisEl && futureDeprEl && futureGainEl) {
    var recomputeFutureGain = function () {
      var sp = parseUSD(futureSaleEl.value)  || 0;
      var cb = parseUSD(futureBasisEl.value) || 0;
      var ad = parseUSD(futureDeprEl.value)  || 0;
      var lt = Math.max(0, sp - cb - ad);
      futureGainEl.value = (typeof fmtUSD === 'function')
        ? fmtUSD(lt)
        : '$' + Math.round(lt).toLocaleString('en-US');
    };
    [futureSaleEl, futureBasisEl, futureDeprEl].forEach(function (el) {
      el.addEventListener('input',  recomputeFutureGain);
      el.addEventListener('change', recomputeFutureGain);
    });
    recomputeFutureGain();
  }

  // Strategy-selection page (between Inputs and Projection): three
  // cards, each with Interested / Not Interested. Currently NOT wired
  // to the engine — purely a presenter aid. The Continue button
  // advances to the existing Projection pipeline; Back returns to
  // Inputs. Interested/Not Interested toggle visual state on the
  // card and write to window.__rettStrategyInterest for future
  // engine integration.
  window.__rettStrategyInterest = window.__rettStrategyInterest || { A: null, B: null, C: null };
  document.querySelectorAll('.strategy-pick-btn').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var target = btn.getAttribute('data-pick-target');
      var action = btn.getAttribute('data-pick-action');
      var newVal = action === 'interested' ? true : false;
      var current = window.__rettStrategyInterest[target];
      window.__rettStrategyInterest[target] = (current === newVal) ? null : newVal;
      _refreshStrategyPickCards();
      // Defensive: keep the Page-3 Interested-cards view in sync the
      // instant interest changes, so navigating to Projection always
      // shows the latest filter even if the navigation handler somehow
      // skips renderInterestedSnapshot. Idempotent.
      if (typeof window.renderInterestedSnapshot === 'function') {
        try { window.renderInterestedSnapshot(); } catch (e) { /* */ }
      }
      // Page 4 supplementals derive their year-count from the resolved
      // sale strategy (A=1y, B=2y, C=duration). Re-running the math on
      // an interest change lets supplemental contributions update before
      // the user navigates. Page 5 then re-renders off the fresh data.
      if (typeof window.renderSupplementalPage === 'function') {
        try { window.renderSupplementalPage(); } catch (e) { /* */ }
      }
      if (typeof window.renderStrategySummary === 'function') {
        try { window.renderStrategySummary(); } catch (e) { /* */ }
      }
      // Persist to localStorage so the strategy-pick visual state
      // survives a page refresh / browser tab switch / saved-client
      // round-trip. (P1-3.) Skip while applying restored state.
      if (!window.__rettApplyingState && window.RETTCaseStorage &&
          typeof window.RETTCaseStorage.saveWorkingState === 'function') {
        try { window.RETTCaseStorage.saveWorkingState(); } catch (e) { /* */ }
      }
    });
  });

  // Page 3 "Use This Strategy" button — sets window.__rettChosenStrategy
  // and navigates to the Strategy Summary page, which renders ONLY the
  // chosen strategy in the BrookHaven Moving-Forward layout. Wired via
  // delegation on #interested-cards-host so it survives every
  // renderInterestedSnapshot() rebuild.
  var iHost = document.getElementById('interested-cards-host');
  if (iHost) iHost.addEventListener('click', function (ev) {
    var btn = ev.target && ev.target.closest && ev.target.closest('.rett-use-strategy-btn');
    if (!btn) return;
    var type = btn.getAttribute('data-use-strategy');
    if (!type) return;
    window.__rettChosenStrategy = type;
    if (!window.__rettApplyingState && window.RETTCaseStorage &&
        typeof window.RETTCaseStorage.saveWorkingState === 'function') {
      try { window.RETTCaseStorage.saveWorkingState(); } catch (e) { /* */ }
    }
    showPage('page-supplemental');
  });
  var strategiesBack = document.getElementById('strategies-back');
  if (strategiesBack) strategiesBack.addEventListener('click', function () { showPage('page-inputs'); });
  var strategiesContinue = document.getElementById('strategies-continue');
  if (strategiesContinue) strategiesContinue.addEventListener('click', function () { showPage('page-projection'); });

  // Sub-tabs on Page 2 (Summary | Details).
  const subnavSummary = document.getElementById('subnav-summary');
  const subnavDetails = document.getElementById('subnav-details');
  if (subnavSummary) subnavSummary.addEventListener('click', () => showProjectionSubpage('subpage-summary'));
  if (subnavDetails) subnavDetails.addEventListener('click', () => showProjectionSubpage('subpage-details'));

  // Sale-Proceeds wiring: two yes/no questions on Page 1 drive how much
  // of the sale flows into Brooklyn. Available Capital on Page 2 auto-
  // populates from sale - keep-amount - estimated-tax.
  //
  // Tax estimate (when "cover taxes from sale" = yes): treat the full
  // long-term gain as a Y1 lump-sum recognition and run the federal
  // and state engines on it. That's the conservative-high floor — for
  // structured-sale paths the actual tax is less, but front-loading
  // the carve-out keeps the client liquid for the April due date.
  function _estimatedSaleTax() {
    var saleVal  = parseUSD((document.getElementById('sale-price') || {}).value) || 0;
    var basisVal = parseUSD((document.getElementById('cost-basis') || {}).value) || 0;
    var deprVal  = parseUSD((document.getElementById('accelerated-depreciation') || {}).value) || 0;
    // STG is independent income now; not subtracted from property LT gain.
    var stShort  = parseUSD((document.getElementById('short-term-gain') || {}).value) || 0;
    var ltGain   = Math.max(0, saleVal - basisVal - deprVal);
    if (ltGain <= 0) return 0;
    var year   = parseInt((document.getElementById('year1') || {}).value, 10) || (new Date()).getFullYear();
    var status = (document.getElementById('filing-status') || {}).value || 'mfj';
    var state  = (document.getElementById('state-code') || {}).value || 'NONE';
    var ord    = (parseUSD((document.getElementById('w2-wages') || {}).value) || 0) +
                 (parseUSD((document.getElementById('se-income') || {}).value) || 0) +
                 (parseUSD((document.getElementById('biz-revenue') || {}).value) || 0) +
                 (parseUSD((document.getElementById('rental-income') || {}).value) || 0) +
                 (parseUSD((document.getElementById('dividend-income') || {}).value) || 0) +
                 (parseUSD((document.getElementById('retirement-distributions') || {}).value) || 0);
    var wages  = (parseUSD((document.getElementById('w2-wages') || {}).value) || 0) +
                 (parseUSD((document.getElementById('se-income') || {}).value) || 0);
    var fed = 0, st = 0;
    try {
      if (typeof computeFederalTax === 'function') {
        fed = computeFederalTax(ord + Math.max(0, stShort), year, status, {
          longTermGain: ltGain,
          depreciationRecapture: deprVal,
          investmentIncome: ltGain + Math.max(0, stShort),
          wages: wages
        }) || 0;
      }
      if (typeof computeStateTax === 'function') {
        st = computeStateTax(ord + Math.max(0, stShort) + ltGain + deprVal, year, state, status, {
          longTermGain: ltGain
        }) || 0;
      }
    } catch (e) { /* fall through to 0 */ }
    return Math.round(Math.max(0, fed + st));
  }

  function _recomputeAvailableCapital() {
    const saleEl     = document.getElementById('sale-price');
    const yesNoEl    = document.getElementById('withhold-yes-no');
    const amtEl      = document.getElementById('withhold-amount');
    const amtGroup   = document.getElementById('withhold-amount-group');
    const errEl      = document.getElementById('withhold-error');
    const availEl    = document.getElementById('available-capital');
    const coverEl    = document.getElementById('cover-taxes-yes-no');
    if (!saleEl || !yesNoEl || !availEl) return;

    const saleVal = parseUSD(saleEl.value) || 0;
    const wantsKeep = (yesNoEl.value === 'yes');
    const amtRaw  = amtEl ? (parseUSD(amtEl.value) || 0) : 0;
    const wantsCoverTaxes = !!(coverEl && coverEl.value === 'yes');

    // Show / hide the amount input based on yes/no.
    if (amtGroup) amtGroup.hidden = !wantsKeep;

    // Validation: keep-amount must not exceed the sale.
    let keep = 0;
    let hasError = false;
    if (wantsKeep) {
      if (saleVal > 0 && amtRaw > saleVal) {
        if (errEl) {
          errEl.textContent = 'Amount to keep ($' + amtRaw.toLocaleString() +
            ') is greater than the sale price ($' + saleVal.toLocaleString() +
            '). Please re-enter.';
          errEl.hidden = false;
        }
        hasError = true;
      } else {
        if (errEl) errEl.hidden = true;
        keep = Math.max(0, amtRaw);
      }
    } else {
      if (errEl) errEl.hidden = true;
    }

    const taxCarveOut = wantsCoverTaxes ? _estimatedSaleTax() : 0;

    // Drive available-capital from sale - keep - tax (if covering)
    // whenever there's a sale price and no validation error. The user
    // can still override on Page 2.
    if (!hasError && saleVal > 0) {
      const newAvailNum = Math.max(0, saleVal - keep - taxCarveOut);
      const newAvail = (typeof fmtUSD === 'function')
        ? fmtUSD(newAvailNum)
        : String(newAvailNum);
      if (parseUSD(availEl.value) !== newAvailNum) {
        availEl.value = newAvail;
        availEl.dispatchEvent(new Event('input',  { bubbles: true }));
        availEl.dispatchEvent(new Event('change', { bubbles: true }));
      }
    }

    // Also: disable the Continue button while there's a validation error.
    const cont = document.getElementById('continue-to-projection');
    if (cont) cont.disabled = hasError;
  }

  // Wire up the listeners. Sale-price already has other input listeners
  // elsewhere; we add ours alongside. cost-basis and accelerated-
  // depreciation also drive the tax estimate when "cover taxes" is on,
  // so changes to those fields must re-trigger Available Capital.
  ['sale-price', 'cost-basis', 'accelerated-depreciation', 'short-term-gain',
   'withhold-yes-no', 'withhold-amount', 'cover-taxes-yes-no',
   'filing-status', 'state-code', 'year1',
   'w2-wages', 'se-income', 'biz-revenue', 'rental-income',
   'dividend-income', 'retirement-distributions'].forEach(function (id) {
    const el = document.getElementById(id);
    if (!el) return;
    const evt = (el.tagName === 'SELECT') ? 'change' : 'input';
    el.addEventListener(evt, _recomputeAvailableCapital);
  });
  // Initial call so the available-capital is set on first paint when a
  // case-load restored sale-price.
  _recomputeAvailableCapital();

  const contBtn = document.getElementById('continue-to-projection');
  if (contBtn) contBtn.addEventListener('click', () => {
    if (typeof validateAndReport === 'function' && !validateAndReport('client')) {
      return;
    }
    // Final sync — make sure available-capital reflects sale-withhold
    // before the projection runs.
    _recomputeAvailableCapital();
    // Always re-optimize when launching the projection from the Continue
    // button. If the user previously overrode a Page-2 pill (which set
    // __rettAutoPickEnabled = false), then came back here and edited a
    // Page-1 scenario field, the prior selection is stale — the new
    // sale price / basis / income mix likely has a different optimal
    // (leverage, horizon, recognition) combo. Forcing the flag back on
    // means showPage('page-projection') → maybeAutoPick will run a
    // fresh search before runFullPipeline.
    window.__rettAutoPickEnabled = true;
    // Route through the new Strategy Selection page so the user can
    // mark each option Interested / Not Interested before the engine
    // runs. The Projection engine still runs silently in the
    // background when they continue from Strategies, so the
    // recommended-card border can appear immediately on arrival.
    showPage('page-strategies');
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
  // dropdown changes.
  const _lcSel = document.getElementById('leverage-cap-select');
  if (_lcSel) _lcSel.addEventListener('change', _onCustodianChange);
  // For invested-capital input, ONLY refresh the Schwab below-min
  // warning — don't run the full custodian-change flow. The previous
  // wiring rebuilt leverage-cap-select on every keystroke, which
  // snapped the user's prior selection back to "highest cap" each
  // time (Issue #47).
  const _invInp = document.getElementById('invested-capital');
  if (_invInp) _invInp.addEventListener('input', _debounce(function () {
    var cust = document.getElementById('custodian-select');
    var strat = document.getElementById('strategy-select');
    var lc   = document.getElementById('leverage-cap-select');
    if (typeof _renderSchwabBelowMinWarning === 'function') {
      _renderSchwabBelowMinWarning(strat, lc, cust && cust.value === 'schwab');
    }
  }, 150));
  _onCustodianChange();

  // Wire case-management controls + restore any auto-saved working state.
  // This must run AFTER _onCustodianChange so the leverage-cap dropdown
  // already has its options populated when we re-apply persisted values.
  try { _bindCaseControls(); } catch (e) { (window.reportFailure || console.warn)('Case management UI failed to wire', e, { level: 'error' }); }

  showPage('page-inputs');
}

document.addEventListener('DOMContentLoaded', bindControls);

// Cache-buster mismatch guard. Every <script src=".../?v=NNN"> is
// expected to share the same v= value (we bump them together on every
// push). If a partial deploy ships some files and not others, the
// browser will load a mix of fresh and cached scripts — the engine
// might be the new shape while the renderer still expects the old one,
// producing subtle wrong numbers instead of a clean error. Surface the
// mismatch in the console at boot so it's debuggable from the start.
(function _checkCacheBusterSync() {
  try {
    var scripts = document.querySelectorAll('script[src]');
    var versions = {};
    scripts.forEach(function (s) {
      var m = /[?&]v=([^&]+)/.exec(s.src || '');
      if (m) {
        var v = m[1];
        if (!versions[v]) versions[v] = [];
        versions[v].push(s.src.split('/').pop());
      }
    });
    var keys = Object.keys(versions);
    if (keys.length > 1) {
      console.warn('[RETT cache-buster] Mixed script versions loaded — ' +
        'partial deploy or stale cache. Versions:', versions);
    }
  } catch (e) { /* never block boot on a guard */ }
})();
