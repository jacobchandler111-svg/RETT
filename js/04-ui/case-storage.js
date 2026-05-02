// FILE: js/04-ui/case-storage.js
// Local persistence for RETT scenarios. Two storage layers:
//
//   1. WORKING STATE — auto-saved on every input change so a page
//      refresh restores exactly what the user had. Survives until the
//      user clicks "New" or loads a different case.
//
//   2. NAMED CASES — explicit snapshots saved by name (e.g. "John
//      Smith"). Listed in a dropdown on Page 1, can be loaded back
//      into the working state, deleted, or overwritten with a re-save.
//
// All persistence lives in localStorage under three keys:
//
//   rett_workingState   - JSON object of current form field values
//   rett_cases          - JSON map { caseName: { ...values... } }
//   rett_currentCase    - name of the currently-loaded case (or "")
//
// No login / cloud sync yet — everything is local to the browser.
// When the user is ready to add auth, this layer becomes the local
// cache and a sync function pushes/pulls cases to a backend.

(function (root) {
  'use strict';

  var WORKING_KEY = 'rett_workingState';
  var CASES_KEY   = 'rett_cases';
  var CURRENT_KEY = 'rett_currentCase';

  // Field IDs whose values participate in a "case." Order matters at
  // restore time: custodian -> projection-years (drives leverage option
  // list) -> leverage-cap-select (Schwab combos depend on strategy +
  // leverage label) -> strategy-select. Other fields are independent.
  var FIELD_IDS = [
    // Page 1: Custodian (must be first so leverage options populate)
    'custodian-select',
    // Page 1: Filing
    'year1', 'filing-status', 'state-code',
    // Page 1: Income
    'w2-wages', 'se-income', 'biz-revenue', 'rental-income',
    'dividend-income', 'retirement-distributions',
    // Page 1: Appreciated Assets
    'sale-price', 'cost-basis', 'accelerated-depreciation', 'short-term-gain',
    // Page 1: Implementation
    'implementation-date',
    // Hidden / Page 2 controls (legacy + horizon + recognition)
    'projection-years', 'leverage-cap-select', 'long-term-gain',
    'available-capital', 'invested-capital',
    'strategy-select', 'beta1',
    'recognition-start-select'
  ];

  // ---- Low-level localStorage helpers ----------------------------------
  function _safeGetJson(key, fallback) {
    try {
      var raw = root.localStorage && root.localStorage.getItem(key);
      if (!raw) return fallback;
      return JSON.parse(raw);
    } catch (e) { return fallback; }
  }
  function _safeSetJson(key, value) {
    try {
      if (root.localStorage) root.localStorage.setItem(key, JSON.stringify(value));
    } catch (e) { /* private mode / quota */ }
  }
  function _safeGetString(key) {
    try { return (root.localStorage && root.localStorage.getItem(key)) || ''; }
    catch (e) { return ''; }
  }
  function _safeSetString(key, value) {
    try { if (root.localStorage) root.localStorage.setItem(key, value || ''); }
    catch (e) { /* */ }
  }
  function _safeRemove(key) {
    try { if (root.localStorage) root.localStorage.removeItem(key); }
    catch (e) { /* */ }
  }

  // ---- Form serialize / restore ----------------------------------------
  function captureFormState() {
    var state = {};
    FIELD_IDS.forEach(function (id) {
      var el = document.getElementById(id);
      if (!el) return;
      if (el.type === 'checkbox' || el.type === 'radio') state[id] = !!el.checked;
      else state[id] = el.value;
    });
    return state;
  }

  // Restore a previously-captured state object onto the form. Order
  // matters: we apply custodian + projection-years FIRST, dispatching
  // change events so the custodian-driven UI (leverage options, Schwab
  // combo info, etc.) repopulates BEFORE we set leverage-cap-select.
  function applyFormState(state) {
    if (!state || typeof state !== 'object') return;
    var ordered = ['custodian-select', 'projection-years'];
    var rest    = FIELD_IDS.filter(function (id) { return ordered.indexOf(id) === -1; });
    var apply = function (id) {
      if (!(id in state)) return;
      var el = document.getElementById(id);
      if (!el) return;
      var v = state[id];
      if (el.type === 'checkbox' || el.type === 'radio') {
        el.checked = !!v;
      } else if (el.value !== String(v == null ? '' : v)) {
        el.value = (v == null) ? '' : String(v);
      }
      el.dispatchEvent(new Event('change', { bubbles: true }));
      el.dispatchEvent(new Event('input',  { bubbles: true }));
    };
    ordered.forEach(apply);
    rest.forEach(apply);
  }

  // ---- Working-state API -----------------------------------------------
  function getWorkingState()   { return _safeGetJson(WORKING_KEY, null); }
  function saveWorkingState()  { _safeSetJson(WORKING_KEY, captureFormState()); }
  function clearWorkingState() { _safeRemove(WORKING_KEY); }

  function restoreWorkingState() {
    var s = getWorkingState();
    if (!s) return false;
    applyFormState(s);
    return true;
  }

  // ---- Named-case API --------------------------------------------------
  function listCases() {
    var cases = _safeGetJson(CASES_KEY, {}) || {};
    return Object.keys(cases).sort(function (a, b) {
      return a.localeCompare(b, 'en', { sensitivity: 'base' });
    });
  }
  function getCase(name) {
    if (!name) return null;
    var cases = _safeGetJson(CASES_KEY, {}) || {};
    return cases[name] || null;
  }
  function saveCase(name, state) {
    if (!name || typeof name !== 'string') return false;
    var trimmed = name.trim();
    if (!trimmed) return false;
    var cases = _safeGetJson(CASES_KEY, {}) || {};
    cases[trimmed] = state || captureFormState();
    cases[trimmed]._savedAt = new Date().toISOString();
    _safeSetJson(CASES_KEY, cases);
    setCurrentCaseName(trimmed);
    return true;
  }
  function deleteCase(name) {
    if (!name) return false;
    var cases = _safeGetJson(CASES_KEY, {}) || {};
    if (!(name in cases)) return false;
    delete cases[name];
    _safeSetJson(CASES_KEY, cases);
    if (getCurrentCaseName() === name) setCurrentCaseName('');
    return true;
  }
  function loadCase(name) {
    var c = getCase(name);
    if (!c) return false;
    applyFormState(c);
    setCurrentCaseName(name);
    saveWorkingState();
    return true;
  }

  // ---- Current-case bookkeeping ----------------------------------------
  function getCurrentCaseName() { return _safeGetString(CURRENT_KEY); }
  function setCurrentCaseName(n) { _safeSetString(CURRENT_KEY, n || ''); }

  // ---- Reset helper ----------------------------------------------------
  // "New Case": clear working state and current-case pointer. Does NOT
  // touch saved cases. Caller is responsible for repainting the form.
  function startNewCase() {
    clearWorkingState();
    setCurrentCaseName('');
  }

  root.RETTCaseStorage = {
    FIELD_IDS:           FIELD_IDS,
    captureFormState:    captureFormState,
    applyFormState:      applyFormState,
    getWorkingState:     getWorkingState,
    saveWorkingState:    saveWorkingState,
    clearWorkingState:   clearWorkingState,
    restoreWorkingState: restoreWorkingState,
    listCases:           listCases,
    getCase:             getCase,
    saveCase:            saveCase,
    deleteCase:          deleteCase,
    loadCase:            loadCase,
    getCurrentCaseName:  getCurrentCaseName,
    setCurrentCaseName:  setCurrentCaseName,
    startNewCase:        startNewCase
  };
})(window);
