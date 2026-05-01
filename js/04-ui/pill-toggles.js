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

  function _showAutoHint(group) {
    var hint = document.getElementById(group + '-auto-hint');
    if (hint) hint.hidden = false;
  }

  function buildPillToggles() {
    var levSel  = document.getElementById('leverage-cap-select');
    var horSel  = document.getElementById('projection-years');
    _renderTrack('leverage-pill-track', _readLeverageOptions(),
      levSel ? levSel.value : '');
    _renderTrack('horizon-pill-track',  _readHorizonOptions(),
      horSel ? horSel.value : '');
  }

  function syncPillSelection() {
    var levSel = document.getElementById('leverage-cap-select');
    var horSel = document.getElementById('projection-years');
    var levVal = levSel ? levSel.value : '';
    var horVal = horSel ? horSel.value : '';
    document.querySelectorAll('#leverage-pill-track .pill').forEach(function (b) {
      var on = (b.getAttribute('data-value') === levVal);
      b.classList.toggle('active', on);
      b.setAttribute('aria-checked', on ? 'true' : 'false');
    });
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

  // Build the normalized recommendation shape that computeTaxComparison
  // expects. Mirrors the logic in recommendation-render.js so the
  // auto-pick optimizes on the same model the user actually sees in the
  // savings ribbon and KPI tiles.
  function _normalizeRec(rec, cfg) {
    if (!rec) return null;
    var lossGen = (rec.summary && rec.summary.loss) ||
                  (rec.stage1 && rec.stage1.loss) || 0;
    var schedule = null;
    if (rec.summary && Array.isArray(rec.summary.schedule)) {
      schedule = rec.summary.schedule;
    } else if (rec.summary && Array.isArray(rec.summary.gainByYear)) {
      schedule = rec.summary.gainByYear.map(function (g, i) {
        var loss = (rec.summary.lossByYear && rec.summary.lossByYear[i]) || 0;
        return { gainTaken: g, lossGenerated: loss };
      });
    }
    return {
      recommendation: rec.recommendation,
      longTermGain: rec.longTermGain || cfg.salePrice
        ? Math.max(0, (cfg.salePrice || 0) - (cfg.costBasis || 0) - (cfg.acceleratedDepreciation || 0))
        : 0,
      lossGenerated: lossGen,
      schedule: schedule
    };
  }

  // Run the recommendation + comparison + projection pipeline for every
  // (leverage, horizon) combination available to the current custodian.
  // Pick the combo with the highest NET savings (comparison-based tax
  // savings minus projection-engine cumulative fees). The comparison is
  // the same model the savings ribbon and KPI tiles display, so the
  // auto-pick aligns with what the user sees post-pick.
  function runAutoPick() {
    if (typeof collectInputs !== 'function') return null;
    if (typeof ProjectionEngine === 'undefined' || !ProjectionEngine.run) return null;
    var levOpts = _readLeverageOptions();
    var horOpts = _readHorizonOptions();
    if (!levOpts.length || !horOpts.length) return null;

    // Snapshot the user's currently entered selects — we override them
    // across iterations and restore if no improvement is found.
    var levSel = document.getElementById('leverage-cap-select');
    var horSel = document.getElementById('projection-years');
    var prevLev = levSel ? levSel.value : '';
    var prevHor = horSel ? horSel.value : '';

    var best = null;
    levOpts.forEach(function (lev) {
      horOpts.forEach(function (hor) {
        if (levSel) levSel.value = lev.value;
        if (horSel) horSel.value = hor.value;
        var cfg;
        try { cfg = collectInputs(); }
        catch (e) { return; }
        var sp = Number((document.getElementById('sale-price') || {}).value) || 0;
        var cb = Number((document.getElementById('cost-basis') || {}).value) || 0;
        var ad = Number((document.getElementById('accelerated-depreciation') || {}).value) || 0;
        if (sp) cfg.salePrice = sp;
        if (cb) cfg.costBasis = cb;
        if (ad) cfg.acceleratedDepreciation = ad;
        cfg.strategyKey = cfg.tierKey;
        cfg.investedCapital = cfg.investment;
        cfg.years = cfg.horizonYears;

        // Cumulative fees come from the projection engine.
        var projResult;
        try { projResult = ProjectionEngine.run(cfg); }
        catch (e) { return; }
        if (!projResult || !projResult.years || !projResult.years.length) return;
        var cumFees = 0;
        projResult.years.forEach(function (y) { cumFees += (y.fee || 0); });
        if (projResult.totals && projResult.totals.cumulativeFees != null) {
          cumFees = projResult.totals.cumulativeFees;
        }

        // Tax savings come from the same comparison model the ribbon /
        // KPI tiles display. We strip cfg.custodian for the recommend
        // call because the normal recommendation flow uses a custodian-
        // less readInputs shape — passing custodian here trips a
        // validation gate when Schwab combo leverage strings (like
        // "200/100") parse to junk numerics. Falls back to projection-
        // engine raw deltas if the recommendation helpers aren't loaded.
        var totalSave = 0;
        if (typeof root.recommendSale === 'function' &&
            typeof root.computeTaxComparison === 'function') {
          try {
            var recCfg = Object.assign({}, cfg);
            delete recCfg.custodian;
            // For Schwab combos the parsed leverageCap is a junk number
            // (e.g. 200 from "200/100"); use 2.25 as the recommendation
            // engine's default — same fallback readInputs uses.
            if (typeof recCfg.leverageCap === 'number' && recCfg.leverageCap > 3) {
              recCfg.leverageCap = 2.25;
            }
            var rec = root.recommendSale(recCfg);
            var normRec = _normalizeRec(rec, cfg);
            var comp = root.computeTaxComparison(cfg, normRec);
            if (comp && Array.isArray(comp.rows)) {
              if (comp.totalSavings != null) {
                totalSave = comp.totalSavings;
              } else {
                comp.rows.forEach(function (r) { totalSave += (r.savings || 0); });
              }
            }
          } catch (e) { /* fall back to projection engine */ }
        }
        if (!totalSave) {
          projResult.years.forEach(function (y) {
            var no = y.taxNoBrooklyn || 0;
            var w  = (y.taxWithBrooklyn != null) ? y.taxWithBrooklyn : no;
            totalSave += (no - w);
          });
        }

        var net = totalSave - cumFees;
        if (!best || net > best.net) {
          best = { lev: lev.value, hor: hor.value, net: net, save: totalSave, fees: cumFees };
        }
      });
    });

    // Restore previous selection or pick the best one.
    if (best) {
      _setSelect('leverage-cap-select', best.lev);
      _setSelect('projection-years', best.hor);
      _showAutoHint('leverage');
      _showAutoHint('horizon');
      root.__lastAutoPick = best;
    } else {
      // Restore (no improvement found).
      if (levSel) levSel.value = prevLev;
      if (horSel) horSel.value = prevHor;
    }
    return best;
  }

  // Run auto-pick only when the user hasn't manually overridden a pill.
  // Set true on form reset, flips to false on the first pill click.
  root.__rettAutoPickEnabled = true;

  function maybeAutoPick() {
    if (!root.__rettAutoPickEnabled) return null;
    return runAutoPick();
  }

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
    if (trackId === 'leverage-pill-track') {
      _setSelect('leverage-cap-select', value);
      _hideAutoHint('leverage');
    } else if (trackId === 'horizon-pill-track') {
      _setSelect('projection-years', value);
      _hideAutoHint('horizon');
    } else {
      return;
    }
    // First manual click disables further auto-picking until reset.
    root.__rettAutoPickEnabled = false;
    syncPillSelection();
    // Re-run the decision engine + projection with the new selection.
    if (typeof runRecommendation === 'function') {
      try { runRecommendation(); } catch (e) { /* non-fatal */ }
    }
    // The recommendation pipeline kicks off a delayed projection in
    // controls.js; explicitly run the projection once now too so the
    // dashboard updates immediately.
    if (typeof collectInputs === 'function' && typeof ProjectionEngine !== 'undefined' && ProjectionEngine.run) {
      try {
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
      } catch (err) { /* non-fatal */ }
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
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _attach);
  } else {
    _attach();
  }

  root.buildPillToggles    = buildPillToggles;
  root.syncPillSelection   = syncPillSelection;
  root.runAutoPick         = runAutoPick;
  root.maybeAutoPick       = maybeAutoPick;
  root.__lastAutoPick      = null;
})(window);
