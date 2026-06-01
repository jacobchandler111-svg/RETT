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
    'w2-wages', 'rental-income',
    'dividend-income', 'retirement-distributions',
    // 2026-05-27 income-section restructure. Legacy se-income and
    // biz-revenue removed from persistence — they remain in the DOM as
    // hidden inputs reading 0 until the engine bot reroutes through the
    // new business-income block. See INCOME_SOURCES_RESEARCH.md.
    'interest-income', 'qualified-dividends', 'social-security',
    'business-income-amount',
    // Page 1: Real Estate Sale Details — Property 1 (always visible)
    'sale-price', 'cost-basis', 'accelerated-depreciation', 'short-term-gain',
    // Page 1: Real Estate Sale Details — Properties 2..5 (multi-property Q1).
    // Per-property holding-period toggle (Q2) is persisted alongside each
    // property's currency fields. Per-property visibility is restored
    // post-load by checking if any of the block's fields have data.
    'holding-period-1', 'amount-owed-yes-no-1', 'amount-owed-amount-1', 'personal-use-yes-no-1', 'personal-use-amount-1',
    'sale-price-2', 'cost-basis-2', 'accelerated-depreciation-2', 'holding-period-2', 'implementation-date-2', 'strategy-implementation-date-2', 'amount-owed-yes-no-2', 'amount-owed-amount-2', 'personal-use-yes-no-2', 'personal-use-amount-2',
    'sale-price-3', 'cost-basis-3', 'accelerated-depreciation-3', 'holding-period-3', 'implementation-date-3', 'strategy-implementation-date-3', 'amount-owed-yes-no-3', 'amount-owed-amount-3', 'personal-use-yes-no-3', 'personal-use-amount-3',
    'sale-price-4', 'cost-basis-4', 'accelerated-depreciation-4', 'holding-period-4', 'implementation-date-4', 'strategy-implementation-date-4', 'amount-owed-yes-no-4', 'amount-owed-amount-4', 'personal-use-yes-no-4', 'personal-use-amount-4',
    'sale-price-5', 'cost-basis-5', 'accelerated-depreciation-5', 'holding-period-5', 'implementation-date-5', 'strategy-implementation-date-5', 'amount-owed-yes-no-5', 'amount-owed-amount-5', 'personal-use-yes-no-5', 'personal-use-amount-5',
    // Page 1: Sale Proceeds questions (drive Available Capital)
    'withhold-yes-no', 'withhold-amount', 'cover-taxes-yes-no',
    // Page 1: Future Sale Loss Target (drives the optimizer's decision
    // on whether to let loss carryforward roll forward to absorb a
    // planned future gain). Simplified shape (2026-05-15): single
    // estimated-gain field replaces prior 4-field breakdown.
    'future-sale-yes-no', 'future-sale-date', 'future-estimated-gain',
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
  // v3 adds Page-4 supplemental interest + per-strategy config so the
  // advisor's "Interested" picks (Oil & Gas, Delphi) and any details
  // overrides (max investment, IDC%, Delphi class, etc.) survive a
  // hard refresh / saved-case round-trip.
  // v4 extends the same survival to the 10 placeholder-rail strategies
  // (PTET, Charitable Gifts, slot05..slot12) AND the Pre-Meeting
  // questionnaire answers. Without this, a refresh wipes every
  // Interested click on the new strategies and the PMQ resets to
  // empty — the advisor's setup work disappears.
  var SCHEMA_VERSION = 4;

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

    // Page-4 supplemental state (v3+). Captured in two halves:
    //   _supplementalInterest = { oilGas, delphi, ... }   — the lego pin
    //   _supplementalConfig   = { oilGas: {...}, delphi: {...} }
    //                                                      — Details panel overrides
    state._supplementalInterest =
      (root.__rettSupplementalInterest && typeof root.__rettSupplementalInterest === 'object')
        ? Object.assign({}, root.__rettSupplementalInterest)
        : { oilGas: null, delphi: null };
    var sup = root.__rettSupplemental;
    state._supplementalConfig = (sup && typeof sup === 'object')
      ? {
          oilGas: sup.oilGas ? {
            maxInvestment:   sup.oilGas.maxInvestment,
            depreciationPct: sup.oilGas.depreciationPct,
            detailsOpen:     !!sup.oilGas.detailsOpen
          } : null,
          delphi: sup.delphi ? {
            classKey:    sup.delphi.classKey,
            investment:  sup.delphi.investment,
            detailsOpen: !!sup.delphi.detailsOpen
          } : null
        }
      : null;

    // v4: Page-4 placeholder-rail (PTET, Charitable Gifts, slot05..slot12)
    // interest map + per-card detail state. lastResult is excluded —
    // it's recomputed on load from the inputs. detailsOpen / valueOpen
    // travel so the advisor's expanded panels stay open across refresh.
    state._supplementalExtraInterest =
      (root.__rettSupplementalExtraInterest && typeof root.__rettSupplementalExtraInterest === 'object')
        ? Object.assign({}, root.__rettSupplementalExtraInterest)
        : {};
    var supExtra = root.__rettSupplementalExtra;
    if (supExtra && typeof supExtra === 'object') {
      var cfg = {};
      Object.keys(supExtra).forEach(function (id) {
        var s = supExtra[id]; if (!s || typeof s !== 'object') return;
        var copy = {};
        Object.keys(s).forEach(function (k) {
          if (k === 'lastResult') return;
          copy[k] = s[k];
        });
        cfg[id] = copy;
      });
      state._supplementalExtraConfig = cfg;
    }

    // v4: Pre-Meeting questionnaire answers — { businessOwner, passThrough,
    // realEstate, charitable, altInvestments } : true | false | null.
    state._pmqAnswers = (root.__rettPMQAnswers && typeof root.__rettPMQAnswers === 'object')
      ? Object.assign({}, root.__rettPMQAnswers)
      : {};

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
    // Migration (2026-05-15): legacy cases carry the 4-field future-sale
    // breakdown (future-sale-price / future-cost-basis /
    // future-accelerated-depreciation / future-long-term-gain). The new
    // shape uses a single future-estimated-gain. If the legacy fields
    // exist and the new field doesn't, compute the gain on the fly so
    // the user doesn't lose their data on first load post-update.
    if (state['future-estimated-gain'] == null &&
        (state['future-sale-price'] != null ||
         state['future-cost-basis'] != null ||
         state['future-accelerated-depreciation'] != null)) {
      var _parse = function (v) {
        if (v == null) return 0;
        if (typeof v === 'number') return v;
        // Reuse parseUSD if available, else strip non-numeric.
        if (typeof parseUSD === 'function') return parseUSD(String(v)) || 0;
        var n = parseFloat(String(v).replace(/[^0-9.\-]/g, ''));
        return isFinite(n) ? n : 0;
      };
      var _sp = _parse(state['future-sale-price']);
      var _cb = _parse(state['future-cost-basis']);
      var _ad = _parse(state['future-accelerated-depreciation']);
      var _eg = Math.max(0, _sp - _cb - _ad);
      state['future-estimated-gain'] = (_eg > 0)
        ? '$' + Math.round(_eg).toLocaleString('en-US')
        : '';
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
      // Custodian special-case (2026-05-16): legacy cases saved before
      // Schwab became the default have custodian-select: "". Applying
      // that empty value blows away the auto-selected Schwab and lands
      // the user in the no-custodian "variable" leverage path. Skip the
      // restore when the saved value is empty AND the dropdown already
      // has a non-empty selection — keeps the auto-default in place.
      if (id === 'custodian-select' && strV === '' && el.value) return;
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

    // Multi-property visibility restore (Q1): if a saved case has any
    // P2-P5 fields populated, reveal that block. Each block is hidden
    // by default in HTML; we un-hide based on saved data presence.
    for (var pn = 2; pn <= 5; pn++) {
      var spVal = state['sale-price-' + pn];
      var cbVal = state['cost-basis-' + pn];
      var adVal = state['accelerated-depreciation-' + pn];
      var idVal = state['implementation-date-' + pn];
      var sdVal = state['strategy-implementation-date-' + pn];
      var puVal = state['personal-use-amount-' + pn];
      var aoVal = state['amount-owed-amount-' + pn];
      var hasData = (spVal && String(spVal).trim()) ||
                    (cbVal && String(cbVal).trim()) ||
                    (adVal && String(adVal).trim()) ||
                    (idVal && String(idVal).trim()) ||
                    (sdVal && String(sdVal).trim()) ||
                    (puVal && String(puVal).trim()) ||
                    (aoVal && String(aoVal).trim());
      if (hasData) {
        var block = document.getElementById('property-' + pn);
        if (block) block.hidden = false;
      }
    }
    // Update the "+ Additional Real Estate Sale" button visibility
    // based on how many blocks are now revealed (hide when 5 reached).
    var addBtn = document.getElementById('property-add-btn');
    if (addBtn) {
      var visible = 1;
      for (var pn2 = 2; pn2 <= 5; pn2++) {
        var blk = document.getElementById('property-' + pn2);
        if (blk && !blk.hidden) visible++;
      }
      addBtn.hidden = (visible >= 5);
    }
    // Q4: also sync the body class + Property 1 header now that
    // visibility is correct (case-load may have revealed P2-P5).
    if (typeof root.__rettRefreshMultiPropertyMode === 'function') {
      root.__rettRefreshMultiPropertyMode();
    }

    // Page-4 supplemental restore (v3+). Old saved cases without these
    // keys silently keep the in-memory defaults (all null / module
    // defaults). Coerce to canonical shapes so a malformed payload
    // can't trip downstream `=== true` checks.
    if (state._supplementalInterest && typeof state._supplementalInterest === 'object') {
      if (!root.__rettSupplementalInterest) root.__rettSupplementalInterest = {};
      var si = state._supplementalInterest;
      var supKeys = ['oilGas', 'delphi'];
      supKeys.forEach(function (k) {
        var v = si[k];
        root.__rettSupplementalInterest[k] = (v === true || v === false) ? v : null;
      });
    }
    if (state._supplementalConfig && typeof state._supplementalConfig === 'object') {
      if (!root.__rettSupplemental) root.__rettSupplemental = {};
      var sc = state._supplementalConfig;
      if (sc.oilGas && typeof sc.oilGas === 'object') {
        if (!root.__rettSupplemental.oilGas) root.__rettSupplemental.oilGas = {};
        var og = sc.oilGas;
        if (Number.isFinite(og.maxInvestment))   root.__rettSupplemental.oilGas.maxInvestment   = og.maxInvestment;
        if (Number.isFinite(og.depreciationPct)) root.__rettSupplemental.oilGas.depreciationPct = og.depreciationPct;
        if (typeof og.detailsOpen === 'boolean') root.__rettSupplemental.oilGas.detailsOpen     = og.detailsOpen;
      }
      if (sc.delphi && typeof sc.delphi === 'object') {
        if (!root.__rettSupplemental.delphi) root.__rettSupplemental.delphi = {};
        var dl = sc.delphi;
        if (dl.classKey === 'classA' || dl.classKey === 'classB') root.__rettSupplemental.delphi.classKey = dl.classKey;
        if (Number.isFinite(dl.investment))      root.__rettSupplemental.delphi.investment   = dl.investment;
        if (typeof dl.detailsOpen === 'boolean') root.__rettSupplemental.delphi.detailsOpen  = dl.detailsOpen;
      }
    }
    // v4: placeholder-rail interest + detail state.
    if (state._supplementalExtraInterest && typeof state._supplementalExtraInterest === 'object') {
      if (!root.__rettSupplementalExtraInterest) root.__rettSupplementalExtraInterest = {};
      var sxi = state._supplementalExtraInterest;
      Object.keys(sxi).forEach(function (k) {
        var v = sxi[k];
        root.__rettSupplementalExtraInterest[k] = (v === true || v === false) ? v : null;
      });
    }
    if (state._supplementalExtraConfig && typeof state._supplementalExtraConfig === 'object') {
      if (!root.__rettSupplementalExtra) root.__rettSupplementalExtra = {};
      var sxc = state._supplementalExtraConfig;
      Object.keys(sxc).forEach(function (id) {
        var saved = sxc[id]; if (!saved || typeof saved !== 'object') return;
        if (!root.__rettSupplementalExtra[id]) root.__rettSupplementalExtra[id] = {};
        Object.keys(saved).forEach(function (k) {
          root.__rettSupplementalExtra[id][k] = saved[k];
        });
      });
    }

    // v4: Pre-Meeting questionnaire answers.
    if (state._pmqAnswers && typeof state._pmqAnswers === 'object') {
      root.__rettPMQAnswers = Object.assign({}, state._pmqAnswers);
    }

    // Repaint Page 4 so the restored interest + config show up
    // immediately. Safe no-op if the supp module hasn't loaded yet.
    if (typeof root.renderSupplementalPage === 'function') {
      try { root.renderSupplementalPage(); } catch (e) { /* */ }
    }
    if (typeof root.renderSupplementalExtra === 'function') {
      try { root.renderSupplementalExtra(); } catch (e) { /* */ }
    }
    if (typeof root.renderPMQQuestions === 'function') {
      try { root.renderPMQQuestions(); } catch (e) { /* */ }
    }
    // Recompute calc results so the See Value rows (and Page 5) show
    // populated numbers immediately after restore — without this the
    // user has to click into a detail field to trigger the calc tick.
    if (typeof root.recomputeSupplementalExtra === 'function') {
      try { root.recomputeSupplementalExtra(); } catch (e) { /* */ }
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
