// FILE: js/04-ui/pill-toggles.js
// Renders the Leverage and Horizon visual pill toggles on Page 2.
// These replace the Page-1 "Allowed Leverage Caps" select and the
// "Projection Horizon" select. The original <select> elements stay in
// the DOM (hidden) so existing inputs-collector / auto-run wiring keeps
// reading from them as the source of truth — the pills are a visual
// layer that syncs the selects when clicked.
//
// The first projection on a page-load runs an optimizer (see
// runAutoPick) that picks the (leverage, horizon) combination yielding
// the highest NET savings (tax savings minus Brooklyn fees). The
// selected pills get an .auto-selected hint until the user overrides.
//
// Public:
//   buildPillToggles()    — rebuild pill rows from the underlying selects.
//   syncPillSelection()   — repaint .active state to match the selects.
//   runAutoPick()         — find the best (leverage, horizon) by net
//                            savings and apply it via the selects.

(function (root) {
  'use strict';

  function _fmt(n) {
    if (n == null || !isFinite(n)) return '\u2014';
    if (typeof fmtUSD === 'function') return fmtUSD(n);
    return '$' + Math.round(n).toLocaleString('en-US');
  }

  function _readLeverageOptions() {
    var sel = document.getElementById('leverage-cap-select');
    if (!sel) return [];
    var opts = [];
    for (var i = 0; i < sel.options.length; i++) {
      var o = sel.options[i];
      if (!o.value) continue;
      opts.push({ value: o.value, label: o.textContent.trim() });
    }
    return opts;
  }

  function _readHorizonOptions() {
    var sel = document.getElementById('projection-years');
    if (!sel) return [{ value: '5', label: '5 yrs' }];
    var opts = [];
    for (var i = 0; i < sel.options.length; i++) {
      var o = sel.options[i];
      if (!o.value) continue;
      opts.push({ value: o.value, label: o.textContent.replace('years', 'yrs').trim() });
    }
    return opts;
  }

  // Note: an old recognition pill-row used to render here. The
  // recognition year is now silently optimized by
  // searchBestRecognitionForCurrent — there's no visible UI for it.
  // The hidden #recognition-start-select stays as the engine's
  // source-of-truth.

  function _renderTrack(trackId, opts, currentValue) {
    var track = document.getElementById(trackId);
    if (!track) return;
    if (!opts.length) { track.innerHTML = '<span class="pill-empty">—</span>'; return; }
    track.innerHTML = opts.map(function (o) {
      var active = (String(o.value) === String(currentValue));
      return '<button type="button" class="pill' + (active ? ' active' : '') + '"' +
        ' role="radio"' +
        ' aria-checked="' + (active ? 'true' : 'false') + '"' +
        ' data-value="' + o.value.replace(/"/g, '&quot;') + '">' +
        o.label + '</button>';
    }).join('');
  }

  function _hideAutoHint(group) {
    var hint = document.getElementById(group + '-auto-hint');
    if (hint) hint.hidden = true;
  }

  // _refreshRevertVisibility is a no-op since #revert-to-optimized
  // doesn't exist in the current HTML — kept as the export so callers
  // (variable-leverage-ui) don't blow up. Cheap, safe.
  function _refreshRevertVisibility() {
    var btn = document.getElementById('revert-to-optimized');
    if (!btn) return;
    btn.hidden = !!root.__rettAutoPickEnabled;
  }

  function buildPillToggles() {
    var horSel  = document.getElementById('projection-years');
    // Only the Horizon pill row is visible. Leverage is the slider
    // (or the Schwab pills via variable-leverage-ui.js). Recognition
    // is engine-driven and headless — searchBestRecognitionForCurrent
    // picks the optimal recognition year silently, no pill row.
    _renderTrack('horizon-pill-track',  _readHorizonOptions(),
      horSel ? horSel.value : '');
    if (typeof root.refreshVariableLeverageReadouts === 'function') {
      try { root.refreshVariableLeverageReadouts(); } catch (e) { /* */ }
    }
  }

  function syncPillSelection() {
    var horSel = document.getElementById('projection-years');
    var horVal = horSel ? horSel.value : '';
    document.querySelectorAll('#horizon-pill-track .pill').forEach(function (b) {
      var on = (b.getAttribute('data-value') === horVal);
      b.classList.toggle('active', on);
      b.setAttribute('aria-checked', on ? 'true' : 'false');
    });
  }

  function _setSelect(id, value) {
    var sel = document.getElementById(id);
    if (!sel) return;
    if (sel.value === String(value)) return;
    sel.value = String(value);
    sel.dispatchEvent(new Event('change', { bubbles: true }));
  }


  // Recognition-only optimizer. Holds the user's chosen leverage and
  // horizon fixed and finds the recognition year that maximizes net
  // savings. Sets #recognition-start-select and updates the status
  // line. Returns the chosen 1-indexed year.
  //
  // Called from runFullPipeline so EVERY recompute (slider drag,
  // horizon click, Brooklyn-config edit) re-finds the optimal
  // recognition year for the current scenario.
  // searchBestRecognitionForCurrent and runAutoPick used to drive the
  // (now-removed) global Page-2 horizon / leverage toolbar. After the
  // per-section auto-pick (_autoPickSection in projection-dashboard-
  // render.js) became the source of truth — each scenario row's
  // dashboard searches its own optimal (horizon × leverage × rec) —
  // these globals were doing redundant work that updated hidden
  // form fields nobody reads load-bearingly. Gutted to no-ops to
  // skip ~2,700 unnecessary engine evaluations on every Page-2 entry.
  // The scenario-click pin handling moved to the dashboard's row
  // wiring; nothing else needs the legacy behavior.
  function searchBestRecognitionForCurrent() {
    // Scenario-click pin still respected for backwards compat — the
    // active scenario-row click writes __rettScenarioPinnedRec and
    // expects this function to honor it. Cheap to keep.
    if (root.__rettScenarioPinnedRec != null) {
      var recSel = document.getElementById('recognition-start-select');
      var pinned = String(root.__rettScenarioPinnedRec);
      if (recSel && recSel.value !== pinned) recSel.value = pinned;
      return pinned;
    }
    return null;
  }

  // Run auto-pick only when the user hasn't manually overridden a pill.
  // Set true on form reset, flips to false on the first pill click.
  root.__rettAutoPickEnabled = true;

  // No-op kept for any external caller that still invokes it; per-section
  // auto-pick (projection-dashboard-render._autoPickSection) does the
  // real work now.
  function maybeAutoPick() { return null; }

  // Click delegation — a single listener handles both pill rows. Marks
  // the user's choice so the auto-pick hint disappears, then triggers a
  // full projection rebuild via runRecommendation().
  function _onPillClick(e) {
    var btn = e.target.closest('.pill');
    if (!btn) return;
    var track = btn.closest('.pill-track');
    if (!track) return;
    var trackId = track.id;
    var value = btn.getAttribute('data-value');
    if (trackId === 'horizon-pill-track') {
      _setSelect('projection-years', value);
      _hideAutoHint('horizon');
    } else {
      return;
    }
    // First manual click disables further auto-picking until reset.
    root.__rettAutoPickEnabled = false;
    _refreshRevertVisibility();
    syncPillSelection();
    // Re-run the full pipeline (recommendation + projection + dashboard
    // render) with the new selection. controls.js exposes runFullPipeline
    // as a global so we don't have to duplicate cfg-building logic here.
    if (typeof root.runFullPipeline === 'function') {
      try { root.runFullPipeline(); } catch (err) { if (typeof window !== "undefined" && typeof window.reportFailure === "function") window.reportFailure("non-fatal in pill-toggles.js", err); else if (typeof console !== "undefined") console.warn(err); }
    }
  }

  function _attach() {
    document.addEventListener('click', _onPillClick);
    var levSel = document.getElementById('leverage-cap-select');
    var horSel = document.getElementById('projection-years');
    if (levSel) levSel.addEventListener('change', function () {
      buildPillToggles();
    });
    if (horSel) horSel.addEventListener('change', function () {
      syncPillSelection();
    });
    _refreshRevertVisibility();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _attach);
  } else {
    _attach();
  }

  root.buildPillToggles    = buildPillToggles;
  root.syncPillSelection   = syncPillSelection;
  root.maybeAutoPick       = maybeAutoPick;
  root.searchBestRecognitionForCurrent = searchBestRecognitionForCurrent;
  root.refreshRevertVisibility = _refreshRevertVisibility;
})(window);
