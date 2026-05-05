// FILE: js/04-ui/case-storage.js
// Local persistence for RETT scenarios. Name-anchored auto-save model:
//
//   1. NAMED CASES — once the user has typed a Client Name, every
//      change to the form auto-saves to cases[<name>]. There is no
//      explicit "Save" button; the act of editing IS the save.
//
//   2. WORKING STATE — used only when the user has not yet entered
//      a name. Acts as a transient draft slot so a page refresh
//      doesn't lose un-named edits. The moment the user types a
//      name, the draft is migrated into cases[<name>] and the draft
//      slot is cleared.
//
// All persistence lives in localStorage under three keys:
//
//   rett_workingState   - JSON object (only used for un-named drafts)
//   rett_cases          - JSON map { caseName: { ...values... } }
//   rett_currentCase    - name of the currently-active case (or "")
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
    // Page 1: Sale Proceeds questions (drive Available Capital)
    'withhold-yes-no', 'withhold-amount', 'cover-taxes-yes-no',
    // Page 1: Implementation
    'implementation-date', 'strategy-implementation-date',
    'structured-sale-duration-months',
    // Hidden / Page 2 controls (legacy + horizon + recognition).
    // 'beta1' was a placeholder hidden field that no consumer actually
    // reads; removed to stop saved-state drift from re-introducing it.
    'projection-years', 'leverage-cap-select', 'long-term-gain',
    'available-capital', 'invested-capital',
    'strategy-select',
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
  // Schema versioning. Bump SCHEMA_VERSION whenever the captureFormState
  // shape changes in a way old saved cases can't be naively restored
  // from. The migrate-on-load step in applyFormState reads the
  // _schemaVersion field and runs the appropriate transforms before
  // dispatching events. (P3-2.)
  var SCHEMA_VERSION = 2;

  function captureFormState() {
    var state = { _schemaVersion: SCHEMA_VERSION };
    FIELD_IDS.forEach(function (id) {
      var el = document.getElementById(id);
      if (!el) return;
      if (el.type === 'checkbox' || el.type === 'radio') state[id] = !!el.checked;
      else state[id] = el.value;
    });
    // Page-2 strategy-pick state and Page-3 chosen-strategy pointer
    // travel with the form so a page refresh, "Load saved client" or
    // browser tab switch doesn't lose the user's narrowed-down picks.
    // (P1-3.) Stored under namespaced keys so they don't collide with
    // future field IDs.
    state._strategyInterest = (root.__rettStrategyInterest && typeof root.__rettStrategyInterest === 'object')
      ? Object.assign({}, root.__rettStrategyInterest)
      : { A: null, B: null, C: null };
    state._chosenStrategy = root.__rettChosenStrategy || null;
    return state;
  }

  // Restore a previously-captured state object onto the form. Order
  // matters: we apply custodian + projection-years FIRST, dispatching
  // change events so the custodian-driven UI (leverage options, Schwab
  // combo info, etc.) repopulates BEFORE we set leverage-cap-select.
  function applyFormState(state) {
    if (!state || typeof state !== 'object') return;
    // Migration: v1 (no _schemaVersion field) had no Page-2/Page-3
    // strategy state. v2 adds _strategyInterest and _chosenStrategy.
    // Older saved cases load fine — the strategy-pick state just
    // stays at its default (all null) until the user clicks something.
    var loadedVersion = (typeof state._schemaVersion === 'number') ? state._schemaVersion : 1;
    if (loadedVersion < 1 || loadedVersion > SCHEMA_VERSION) {
      // Out-of-range — surface a warning but proceed best-effort with
      // what we can recognize.
      if (typeof console !== 'undefined' && console.warn) {
        console.warn('[case-storage] Unknown _schemaVersion ' + loadedVersion +
          ' (current: ' + SCHEMA_VERSION + '). Proceeding with field-only restore.');
      }
    }
    var ordered = ['custodian-select', 'projection-years'];
    var rest    = FIELD_IDS.filter(function (id) { return ordered.indexOf(id) === -1; });
    // Belt-and-suspenders flag for the auto-save listener. The
    // existing __rettSuppressAutoSave is cleared by a setTimeout
    // 800ms after restore, but the events we dispatch here can land
    // after that timeout closes if the page is slow. The auto-save
    // listener also checks this flag (see controls.js debouncedAutoSave).
    root.__rettApplyingState = true;
    var apply = function (id) {
      if (!(id in state)) return;
      var el = document.getElementById(id);
      if (!el) return;
      var v = state[id];
      var strV = (v == null) ? '' : String(v);
      if (el.type === 'checkbox' || el.type === 'radio') {
        el.checked = !!v;
      } else if (el.tagName === 'SELECT') {
        // <select> needs a selectedIndex sync — setting el.value alone
        // can leave the visible <option selected> attribute pointing
        // to the static HTML default (e.g. New York for state-code) so
        // the displayed label drifts from the underlying value
        // (Bug #8). Walk the options to find a matching one and pin
        // selectedIndex explicitly. Fall back to el.value if no match
        // (e.g. saved value isn't in the dropdown anymore).
        var matched = false;
        for (var i = 0; i < el.options.length; i++) {
          if (el.options[i].value === strV) {
            el.selectedIndex = i;
            matched = true;
            break;
          }
        }
        if (!matched) el.value = strV;
      } else if (el.value !== strV) {
        el.value = strV;
      }
      el.dispatchEvent(new Event('change', { bubbles: true }));
      el.dispatchEvent(new Event('input',  { bubbles: true }));
    };
    ordered.forEach(apply);
    rest.forEach(apply);
    // Restore Page-2 / Page-3 strategy state AFTER form fields land,
    // so the next runFullPipeline (triggered by the form-restore events)
    // sees the correct interest map and chosen strategy. Defensive:
    // accept any saved-state shape but coerce to the canonical
    // {A,B,C: true|false|null} object so downstream code that does
    // `interest[k] === true` doesn't break on legacy payloads.
    if (state._strategyInterest && typeof state._strategyInterest === 'object') {
      var saved = state._strategyInterest;
      root.__rettStrategyInterest = {
        A: (saved.A === true || saved.A === false) ? saved.A : null,
        B: (saved.B === true || saved.B === false) ? saved.B : null,
        C: (saved.C === true || saved.C === false) ? saved.C : null
      };
    }
    if (typeof state._chosenStrategy === 'string' &&
        ['A','B','C'].indexOf(state._chosenStrategy) !== -1) {
      root.__rettChosenStrategy = state._chosenStrategy;
    } else if (state._chosenStrategy === null) {
      root.__rettChosenStrategy = null;
    }
    root.__rettApplyingState = false;
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

  // Page-load restore: prefer the currently-active named case over the
  // un-named draft. Returns 'case' / 'draft' / null so the UI can show
  // an appropriate status string.
  function restoreOnPageLoad() {
    var name = getCurrentCaseName();
    if (name) {
      var c = getCase(name);
      if (c) {
        applyFormState(c);
        return 'case';
      }
      // Stale current pointer; clear and fall through to draft.
      setCurrentCaseName('');
    }
    if (restoreWorkingState()) return 'draft';
    return null;
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

  // Rename a case in place. Used when the user retitles an active case
  // by editing the Client Name input. Carries the saved state across,
  // removes the old slot, and re-points currentCaseName.
  function renameCase(oldName, newName) {
    if (!oldName || !newName) return false;
    if (oldName === newName) return true;
    var cases = _safeGetJson(CASES_KEY, {}) || {};
    if (!(oldName in cases)) return false;
    // Refuse to overwrite an existing case. The caller (controls.js
    // _bindCaseControls debouncedName handler) reads the false return
    // and surfaces a banner so the user knows their rename was
    // rejected; the input value is reverted to the prior name.
    if (newName in cases) {
      if (typeof root.reportFailure === 'function') {
        root.reportFailure('Client "' + newName + '" already exists. Rename canceled — pick a different name.');
      }
      return false;
    }
    cases[newName] = cases[oldName];
    delete cases[oldName];
    _safeSetJson(CASES_KEY, cases);
    if (getCurrentCaseName() === oldName) setCurrentCaseName(newName);
    return true;
  }

  // Auto-save the current form state to the right slot. Called after every
  // (debounced) input/change event in controls.js. When a client name is
  // active, edits flow into cases[name]; otherwise they go to the
  // un-named draft (rett_workingState) so a refresh doesn't lose typing
  // before the user has named the client.
  function autoSaveCurrent() {
    var name = getCurrentCaseName();
    var snapshot = captureFormState();
    // Defense-in-depth against phantom saves: a 1-char client name is
    // almost always an accident (mid-typing blur, stray paste). Treat
    // anything shorter than 2 chars as the draft slot so the named
    // dropdown doesn't fill with single-letter ghosts. (Bug #10.)
    if (name && name.trim().length >= 2) {
      var cases = _safeGetJson(CASES_KEY, {}) || {};
      snapshot._savedAt = new Date().toISOString();
      cases[name] = snapshot;
      _safeSetJson(CASES_KEY, cases);
      _safeRemove(WORKING_KEY);
      return { mode: 'case', name: name };
    }
    _safeSetJson(WORKING_KEY, snapshot);
    return { mode: 'draft', name: '' };
  }

  // Make the named case the active one. If the user had un-named draft
  // edits, migrate them into cases[name] so nothing is lost as they
  // start naming the client.
  function activateCaseName(name) {
    if (!name) return false;
    var trimmed = name.trim();
    if (!trimmed) return false;
    var cases = _safeGetJson(CASES_KEY, {}) || {};
    if (!(trimmed in cases)) {
      // Migrate un-named draft into the new named slot if present;
      // otherwise capture the current form state.
      var draft = _safeGetJson(WORKING_KEY, null);
      cases[trimmed] = draft || captureFormState();
      cases[trimmed]._savedAt = new Date().toISOString();
      _safeSetJson(CASES_KEY, cases);
    }
    _safeRemove(WORKING_KEY);
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
    restoreOnPageLoad:   restoreOnPageLoad,
    listCases:           listCases,
    getCase:             getCase,
    saveCase:            saveCase,
    renameCase:          renameCase,
    deleteCase:          deleteCase,
    loadCase:            loadCase,
    getCurrentCaseName:  getCurrentCaseName,
    setCurrentCaseName:  setCurrentCaseName,
    startNewCase:        startNewCase,
    activateCaseName:    activateCaseName,
    autoSaveCurrent:     autoSaveCurrent
  };
})(window);
