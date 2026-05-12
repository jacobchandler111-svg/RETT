// FILE: js/04-ui/controls.js
// Page navigation and main run/reset wiring. The app has three pages
// shown one at a time:
//   - 'inputs'     : data entry form
//   - 'projection' : multi-year results table
//   - 'allocator'  : year-1 allocator suggestions

const PAGE_IDS = ['page-pmq', 'page-inputs', 'page-baseline', 'page-strategies', 'page-projection', 'page-supplemental', 'page-allocator', 'page-temp'];
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
  // Also clear the Page-3 KPI-ribbon checked-scenarios set so a New
  // Client doesn't inherit the prior client's "checked" strategy and
  // render stale or zeroed data when buildInterestedSummary's row
  // pipeline lands a different best strategy for the new client.
  window.__rettCheckedScenarios = null;
  // Page-5 supplemental toggle overrides clear too, so a new client
  // starts with default-on for any strategy they later mark Interested
  // — no carry-over from the prior client's session toggles.
  if (typeof window.resetSupplementalEnabledOverride === 'function') {
    try { window.resetSupplementalEnabledOverride(); } catch (e) { /* */ }
  }
  // Supplemental cards: clear Interested/Not-Interested picks AND zero
  // dollar inputs (max investment, gift amount, vehicle cost, etc.).
  // Rate defaults (depreciation %, AGI cap %) survive.
  if (typeof window.resetSupplementalExtra === 'function') {
    try { window.resetSupplementalExtra(); } catch (e) { /* */ }
  }
  if (typeof window.resetSupplementalCore === 'function') {
    try { window.resetSupplementalCore(); } catch (e) { /* */ }
  }
  // Pre-Meeting questionnaire: clear all answers so the next client
  // starts with no auto-gated supplementals.
  window.__rettPMQAnswers = {};
  if (typeof window.renderPMQQuestions === 'function') {
    try { window.renderPMQQuestions(); } catch (e) { /* */ }
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
    var months = _monthsUntilNextJan1(cfg && (cfg.strategyImplementationDate || cfg.implementationDate));
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
  var months = 12 - d.getMonth();
  var day = d.getDate();
  if (day > 1) {
    var dim = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
    months -= (day - 1) / dim;
  }
  return Math.max(1, Math.min(12, Math.round(months)));
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
  // Persist the active page id so a refresh lands the user back
  // where they were instead of bouncing to PMQ. Only writes for
  // valid page ids; failures (private mode, quota) are silent.
  try {
    if (id && typeof localStorage !== 'undefined') {
      localStorage.setItem('rett_lastPage', id);
    }
  } catch (e) { /* */ }
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
      // Run the full engine pipeline FIRST so renderStrategySummary
      // reads fresh entry.metrics / sout.totalSupplementalBenefit.
      // Without this, a hard-refresh landing directly on page-allocator
      // would paint the hero / supp tiles / Return-on-Planning square
      // with default seed values (e.g. ~$20K from default supp tiles)
      // before the pipeline catches up. Nav away + back used to mask
      // this because the next showPage('page-allocator') re-fired the
      // render after pipeline was warm. Tab 7's render() does this
      // same belt-and-suspenders runFullPipeline() before _resolveChosen.
      if (typeof runFullPipeline === 'function') runFullPipeline();
      if (typeof renderStrategySummary === 'function') renderStrategySummary();
    } catch(e) { (window.reportFailure || console.warn)('Strategy Summary render failed', e); }
  }
  if (id === 'page-temp') {
    try {
      if (typeof window.renderTempPage === 'function') window.renderTempPage();
    } catch(e) { (window.reportFailure || console.warn)('Temporary page render failed', e); }
  }
  if (id === 'page-baseline') {
    // Fresh render on entry so the table reflects the latest inputs.
    // Otherwise an edit on Client Inputs followed by an immediate jump
    // here can show stale numbers if the debounce hasn't fired yet.
    try {
      if (typeof window.renderBaselineTable === 'function') window.renderBaselineTable();
    } catch (e) { (window.reportFailure || console.warn)('Baseline render failed', e); }
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
        // F20 fix: honor the per-strategy auto-picked combo for the
        // chosen strategy. Without this, the pipeline runs the
        // optimizer at cfg's nominal (leverage, horizon, rec) which
        // can be strictly worse than the auto-picked combo — when the
        // nominal combo's net is negative but the auto-pick is
        // positive, the pipeline silently dials Brooklyn to $0 while
        // Page-5 continues to render the auto-pick's $X net + an
        // Implementation panel claiming "$X full deployment fine."
        // Patching cfg here keeps the pipeline-level optimizer + per-
        // entry optimizer in agreement.
        //
        // GATE: only apply when auto-pick is enabled. When the user
        // has manually overridden leverage (commit 90fa7c6's leverage
        // dropdown fix) or any pill toggle, __rettAutoPickEnabled is
        // set to false and we must respect their choice — not silently
        // re-overlay an auto-picked combo. Same convention used by
        // _autoPickSection's callers in projection-dashboard-render.js.
        var chosenStrat = (typeof root !== 'undefined' && root.__rettChosenStrategy)
          || (typeof window !== 'undefined' && window.__rettChosenStrategy);
        var autoPickAllowed = (typeof window !== 'undefined')
          ? (window.__rettAutoPickEnabled !== false) : true;
        if (chosenStrat && autoPickAllowed && typeof window._autoPickSection === 'function') {
          try {
            var apk = window._autoPickSection(chosenStrat, cfg);
            if (apk && Number.isFinite(apk.shortPct) && Number.isFinite(apk.horizon)) {
              // Patch leverage / horizon / comboId / recognition / duration
              // from the auto-picked combo. cfg.investment + cfg.availableCapital
              // remain untouched — those reflect the user's stated capital.
              cfg = Object.assign({}, cfg, {
                horizonYears:  apk.horizon,
                leverage:      apk.shortPct / 100,
                leverageCap:   apk.shortPct / 100,
                comboId:       apk.comboId
              });
              if (chosenStrat === 'C' && Number.isFinite(apk.bestRecC)) {
                cfg.recognitionStartYearIndex = apk.bestRecC - 1;
              }
              if (chosenStrat === 'C' && Number.isFinite(apk.durationMonths)) {
                cfg.structuredSaleDurationMonths = apk.durationMonths;
              }
            }
          } catch (apErr) { /* leave cfg unchanged on auto-pick failure */ }
        }

        // Dollar conservation (advisor 2026-05-06): a single dollar
        // can't simultaneously fund Brooklyn AND a supplemental — the
        // pool is finite. Ask the rivalry allocator how much of
        // availableCapital was claimed by funded supps and reduce
        // Brooklyn's effective investment by that amount BEFORE
        // running the engine. Without this, the page would show
        // Brooklyn deployed at full availCap plus supps deploying
        // their own slice, double-counting the same dollars.
        var fundedSuppTotal = 0;
        if (typeof window.runAllocator === 'function') {
          try {
            var alloc = window.runAllocator(cfg.availableCapital);
            if (alloc && Number.isFinite(alloc.allocatedToSupplementals)) {
              fundedSuppTotal = alloc.allocatedToSupplementals;
            }
          } catch (allocErr) { /* leave fundedSuppTotal = 0 */ }
        }
        var brooklynPool = Math.max(0,
          (Number(cfg.availableCapital) || 0) - fundedSuppTotal);
        if (brooklynPool < (Number(cfg.investment) || 0)) {
          cfg = Object.assign({}, cfg, { investment: brooklynPool });
        }

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
        // Run the optimizer whenever there's any deployment to evaluate.
        // The positive-net gate (master-solver.js) needs to fire even when
        // firstLoss=0, because that case has fees with no offsetting
        // savings — a guaranteed negative net the gate must catch.
        // Don't pass firstPass.totals.cumulativeNetSavings as a shortcut:
        // ProjectionEngine excludes Brookhaven from cumulativeFees, so
        // its net would over-state vs. the optimizer's full-fee model.
        // Let the optimizer probe via unifiedTaxComparison.
        if (typeof window.runBrooklynOptimizer === 'function' && Number(cfg.investment) > 0) {
          var opt = window.runBrooklynOptimizer(cfg, firstLoss);
          // The optimizer doesn't see the rivalry's allocation — it
          // sizes a recommendation against availableCapital. Cap the
          // recommendation at brooklynPool so the dial-back path can't
          // recommend more dollars than Brooklyn actually has after
          // supps took their share.
          if (opt && Number.isFinite(opt.recommendedInvestment)) {
            opt.recommendedInvestment = Math.min(opt.recommendedInvestment, brooklynPool);
          }
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

  // Pre-Meeting collapse / restore. Click "Collapse —" on the
  // Pre-Meeting page hides #nav-pmq from the workflow nav and
  // reveals a tiny "—" button (#nav-pmq-restore) in its place.
  // Clicking that dash reopens Pre-Meeting and restores the tab.
  // Persists across reloads via localStorage so a "filled out
  // already" client doesn't see Pre-Meeting on their next session.
  const PMQ_COLLAPSED_KEY = 'rett_pmq_collapsed';
  function _setPmqCollapsed(collapsed) {
    document.body.classList.toggle('pmq-collapsed', !!collapsed);
    var navTab     = document.getElementById('nav-pmq');
    var restoreBtn = document.getElementById('nav-pmq-restore');
    if (navTab)     navTab.hidden     = !!collapsed;
    if (restoreBtn) restoreBtn.hidden = !collapsed;
    try { localStorage.setItem(PMQ_COLLAPSED_KEY, collapsed ? '1' : '0'); } catch (e) { /* */ }
  }
  // Restore prior state on load.
  try {
    if (localStorage.getItem(PMQ_COLLAPSED_KEY) === '1') _setPmqCollapsed(true);
  } catch (e) { /* */ }
  var pmqCollapseBtn = document.getElementById('pmq-collapse-btn');
  if (pmqCollapseBtn) {
    pmqCollapseBtn.addEventListener('click', function () {
      _setPmqCollapsed(true);
      // Drop the user on Client Inputs after collapsing — staying
      // on a hidden tab would be confusing. The page itself stays
      // intact behind the scenes; restore brings it right back.
      showPage('page-inputs');
    });
  }
  var pmqRestoreBtn = document.getElementById('nav-pmq-restore');
  if (pmqRestoreBtn) {
    pmqRestoreBtn.addEventListener('click', function () {
      _setPmqCollapsed(false);
      showPage('page-pmq');
    });
  }

  // Pre-Meeting "Reset Form" button — clears the four PMQ fields
  // and the status line. Does NOT touch saved cases.
  var pmqResetBtn = document.getElementById('pmq-reset-btn');
  if (pmqResetBtn) {
    pmqResetBtn.addEventListener('click', function () {
      ['pmq-first-name','pmq-last-name','pmq-email','pmq-phone'].forEach(function (id) {
        var el = document.getElementById(id);
        if (el) el.value = '';
      });
      var s = document.getElementById('pmq-client-status');
      if (s) { s.textContent = ''; s.className = 'pmq-client-status'; }
      window.__rettCaseEmail = '';
      window.__rettCasePhone = '';
    });
  }

  // Pre-Meeting "Continue" button — combines first/last name into a
  // case key, then either loads an existing case with that name or
  // creates a new one. Email + phone are stashed on window for the
  // print-view to pick up; persistence will follow once those fields
  // exist in case-storage's FIELD_IDS.
  var pmqContinueBtn = document.getElementById('pmq-continue-btn');
  if (pmqContinueBtn) {
    pmqContinueBtn.addEventListener('click', function () {
      var first = ((document.getElementById('pmq-first-name') || {}).value || '').trim();
      var last  = ((document.getElementById('pmq-last-name')  || {}).value || '').trim();
      var email = ((document.getElementById('pmq-email')      || {}).value || '').trim();
      var phone = ((document.getElementById('pmq-phone')      || {}).value || '').trim();
      var fullName = (first + ' ' + last).replace(/\s+/g, ' ').trim();
      // Apply the same sanitization the case-name input uses so the
      // key we look up matches what would be saved by the input.
      fullName = fullName.replace(/[^A-Za-z0-9 ,.'\-]/g, '').slice(0, 80);

      window.__rettCaseEmail = email;
      window.__rettCasePhone = phone;

      var status = document.getElementById('pmq-client-status');
      var store = (window.RETTCaseStorage) ? window.RETTCaseStorage : null;

      if (fullName && store) {
        var existing = store.getCase(fullName);
        if (existing) {
          store.loadCase(fullName);
          // case-name-input is not in FIELD_IDS, so applyFormState
          // doesn't touch it — sync it manually so the Client Inputs
          // page reflects which case is active.
          var nameInputEl = document.getElementById('case-name-input');
          if (nameInputEl) nameInputEl.value = fullName;
          if (typeof _refreshCaseDropdown === 'function') _refreshCaseDropdown(fullName);
          if (typeof _refreshCaseStatus === 'function') _refreshCaseStatus();
          if (status) {
            status.textContent = 'Loaded existing client: ' + fullName;
            status.className = 'pmq-client-status is-loaded';
          }
        } else {
          // No existing case with this name. Implicit "New Client"
          // FIRST — detach from whatever case was active and clear
          // the form so the new name doesn't rename or leak data
          // into the prior case. Without this, dispatching the
          // input event below would trigger the case-name input's
          // rename-in-place handler and silently overwrite the
          // previously-loaded client. (Bug reported 2026-05-06.)
          window.__rettSuppressAutoSave = true;
          if (typeof store.startNewCase === 'function') {
            store.startNewCase();
          }
          if (typeof resetAllInputs === 'function') {
            try { resetAllInputs(true); } catch (e) { /* */ }
          }

          // Now set the canonical name + dispatch events so the
          // existing input/blur handlers promote the fresh draft
          // to a new saved case.
          var nameInput = document.getElementById('case-name-input');
          if (nameInput) {
            nameInput.value = fullName;
            nameInput.dispatchEvent(new Event('input',  { bubbles: true }));
            nameInput.dispatchEvent(new Event('change', { bubbles: true }));
            nameInput.dispatchEvent(new Event('blur',   { bubbles: true }));
          } else if (typeof store.activateCaseName === 'function') {
            store.activateCaseName(fullName);
          }
          // Release the autosave suppressor on the next tick — long
          // enough that the input/blur handlers finish their work
          // (matches the New Client button's 600ms window).
          setTimeout(function () { window.__rettSuppressAutoSave = false; }, 600);

          if (status) {
            status.textContent = 'New client created: ' + fullName;
            status.className = 'pmq-client-status is-new';
          }
        }
      }
      showPage('page-inputs');
    });
  }

  // When the user revisits an existing case from Client Inputs, mirror
  // the name back into the PMQ first/last fields so the top-left card
  // reflects the active client. Best-effort: split on the first space.
  function _syncPmqNameFromCase() {
    var nameInput = document.getElementById('case-name-input');
    var first = document.getElementById('pmq-first-name');
    var last  = document.getElementById('pmq-last-name');
    if (!nameInput || !first || !last) return;
    var v = (nameInput.value || '').trim();
    if (!v) return;
    if (first.value || last.value) return; // don't clobber user input
    var sp = v.indexOf(' ');
    if (sp > 0) { first.value = v.slice(0, sp); last.value = v.slice(sp + 1); }
    else { first.value = v; }
  }
  document.addEventListener('DOMContentLoaded', _syncPmqNameFromCase);
  if (navInputs)       navInputs.addEventListener('click', () => showPage('page-inputs'));
  var navBaseline = document.getElementById('nav-baseline');
  if (navBaseline)     navBaseline.addEventListener('click', () => showPage('page-baseline'));
  if (navStrategies)   navStrategies.addEventListener('click', () => showPage('page-strategies'));
  if (navProjection)   navProjection.addEventListener('click', () => showPage('page-projection'));
  if (navAllocator)    navAllocator.addEventListener('click', () => showPage('page-allocator'));
  const navTemp = document.getElementById('nav-temp');
  if (navTemp)         navTemp.addEventListener('click', () => showPage('page-temp'));

  var baselineBackBtn = document.getElementById('baseline-back-btn');
  if (baselineBackBtn) baselineBackBtn.addEventListener('click', () => showPage('page-inputs'));
  var baselineContBtn = document.getElementById('baseline-continue-btn');
  if (baselineContBtn) baselineContBtn.addEventListener('click', () => {
    // Same pre-projection prep the Client-Inputs continue button runs
    // — re-optimize so a return to the baseline + edits get a fresh
    // recommendation when the user advances to Strategies.
    if (typeof _recomputeAvailableCapital === 'function') _recomputeAvailableCapital();
    window.__rettAutoPickEnabled = true;
    showPage('page-strategies');
  });

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
  // Print / Save as PDF — opens the browser's native print dialog,
  // where the destination dropdown lets the user pick "Save as PDF"
  // or any installed printer. This replaced the html2pdf path so
  // the user gets one well-known UI rather than two competing flows.
  // beforeprint/afterprint listeners (above) handle print-mode and
  // re-render so the .print-view block is fresh at print time.
  var printBtn = document.getElementById('print-summary-btn');
  if (printBtn) {
    printBtn.addEventListener('click', function () {
      if (typeof showPage === 'function') showPage('page-allocator');
      if (typeof window.renderStrategySummary === 'function') {
        try { window.renderStrategySummary(); } catch (e) { /* */ }
      }
      window.print();
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

  // Page-4 Reset Selections button — clears every Interested /
  // Not Interested pick on the supplemental rail (oilGas + delphi
  // via resetSupplementalCore, slot05..slot12 + ptet/charitable via
  // resetSupplementalExtra) and zeroes the dollar inputs. Rate-style
  // factory defaults (depreciation %, AGI cap %) survive because the
  // reset functions seed from spec.defaults but only zero kind:'usd'
  // fields. Persists immediately so refresh reflects the cleared
  // state.
  var suppResetBtn = document.getElementById('supp-reset-selections-btn');
  if (suppResetBtn) suppResetBtn.addEventListener('click', function () {
    if (!window.confirm('Reset all supplemental strategy selections on this page? Dollar inputs will be cleared (rate defaults preserved).')) return;
    if (typeof window.resetSupplementalExtra === 'function') {
      try { window.resetSupplementalExtra(); } catch (e) { /* */ }
    }
    if (typeof window.resetSupplementalCore === 'function') {
      try { window.resetSupplementalCore(); } catch (e) { /* */ }
    }
    if (typeof window.resetSupplementalEnabledOverride === 'function') {
      try { window.resetSupplementalEnabledOverride(); } catch (e) { /* */ }
    }
    if (typeof window.runFullPipeline === 'function') {
      try { window.runFullPipeline(); } catch (e) { /* */ }
    }
    if (window.RETTCaseStorage) {
      var s = window.RETTCaseStorage;
      if (typeof s.autoSaveCurrent === 'function') {
        try { s.autoSaveCurrent(); } catch (e) { /* */ }
      } else if (typeof s.saveWorkingState === 'function') {
        try { s.saveWorkingState(); } catch (e) { /* */ }
      }
    }
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
      // autoSaveCurrent routes to the active named case (or draft);
      // saveWorkingState would only update the un-named draft and the
      // named case would load stale on refresh.
      if (!window.__rettApplyingState && window.RETTCaseStorage) {
        var s = window.RETTCaseStorage;
        if (typeof s.autoSaveCurrent === 'function') {
          try { s.autoSaveCurrent(); } catch (e) { /* */ }
        } else if (typeof s.saveWorkingState === 'function') {
          try { s.saveWorkingState(); } catch (e) { /* */ }
        }
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
    // F19b fix: reset Page-3 KPI-ribbon checked-scenarios so the ribbon
    // + KPI tiles follow the user's new pick. Without this, the ribbon
    // remains stuck on whatever strategy was the prior winner — showing
    // a different "Net Benefit" than Page-5's hero for the same case.
    window.__rettCheckedScenarios = {};
    window.__rettCheckedScenarios[type] = true;
    if (!window.__rettApplyingState && window.RETTCaseStorage) {
      var s = window.RETTCaseStorage;
      if (typeof s.autoSaveCurrent === 'function') {
        try { s.autoSaveCurrent(); } catch (e) { /* */ }
      } else if (typeof s.saveWorkingState === 'function') {
        try { s.saveWorkingState(); } catch (e) { /* */ }
      }
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

    // Drive available-capital from sale - keep - tax-carve-out always.
    // Available Capital is a fully-derived field — no UI for the user to
    // edit it directly (the input lives hidden inside
    // #full-projection-region as an engine-only field). The model is:
    //   • "Investing everything?" = Yes  →  avail = sale (keep=0)
    //   • "Investing everything?" = No   →  avail = sale − amount-to-keep
    //   • "Cover taxes from sale?" = Yes →  additionally subtract est. tax
    // Re-derive on every watched-field change so the value tracks the
    // toggles without going stale. Earlier code gated this on (empty OR
    // hasSubtraction) to "protect a manual override," but the field has
    // no edit UI now — the gate just trapped saved cases at stale or
    // glitched values (e.g. "jared smith" stuck at $1 → Page 3 showed $0
    // across all strategies with no recovery).
    if (!hasError && saleVal > 0) {
      const newAvailNum = Math.max(0, saleVal - keep - taxCarveOut);
      const newAvail = (typeof fmtUSD === 'function')
        ? fmtUSD(newAvailNum)
        : String(newAvailNum);
      const currentNum = parseUSD(availEl.value) || 0;
      if (currentNum !== newAvailNum) {
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
    // Route through the Tax Baseline page (between Client Inputs and
    // Strategies) so the advisor can walk the client through the
    // "Total Tax If You Did Nothing" breakdown on its own screen
    // before picking a strategy. The continue button on baseline
    // takes them to page-strategies.
    showPage('page-baseline');
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
  // Bug fix 2026-05-06 (verified by parallel-Claude scenario sweep):
  // the dropdown was being silently ignored because #custom-short-pct
  // defaults to "100" in HTML, and inputs-collector.js's Schwab-combo
  // resolver tries custom-short-pct FIRST (it's where the Page-2 pill
  // picker writes). Result: dropdown set to "145/45" produced
  // byte-identical engine output to "200/100" because the engine
  // always resolved comboId=beta1_200_100 from the unchanged csp=100.
  //
  // Fix: when the user explicitly changes the leverage dropdown, parse
  // the trailing short% from the value (e.g. "145/45" → 45, "200/100"
  // → 100) and write it to #custom-short-pct so inputs-collector picks
  // the matching combo. Also disable auto-pick — an explicit user choice
  // shouldn't be reverted on the next pipeline run.
  if (_lcSel) _lcSel.addEventListener('change', function () {
    var v = _lcSel.value || '';
    var m = v.match(/\/(\d+(?:\.\d+)?)\s*$/);
    if (m) {
      var csp = document.getElementById('custom-short-pct');
      if (csp) {
        csp.value = m[1];
        csp.dispatchEvent(new Event('input', { bubbles: true }));
        csp.dispatchEvent(new Event('change', { bubbles: true }));
      }
    }
    if (typeof window !== 'undefined') {
      window.__rettAutoPickEnabled = false;
    }
  });
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

  // Restore the last page the user was on across reloads. Falls back
  // to Client Inputs when nothing is saved (or the saved id isn't a
  // valid page — guards against stale localStorage from an older app
  // version that named pages differently).
  var startPage = 'page-inputs';
  try {
    var saved = (typeof localStorage !== 'undefined') ? localStorage.getItem('rett_lastPage') : null;
    if (saved && PAGE_IDS.indexOf(saved) !== -1) startPage = saved;
  } catch (e) { /* */ }
  showPage(startPage);
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
