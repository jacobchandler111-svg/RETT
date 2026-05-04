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

  function _showAutoHint(group) {
    var hint = document.getElementById(group + '-auto-hint');
    if (hint) hint.hidden = false;
  }

  // Show the "Revert to optimized" button only when the user has
  // overridden the auto-pick. Hide it when the engine's pick is in
  // place. Other modules (variable-leverage-ui) flip the flag and
  // call this so the button reflects current state.
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

  // Evaluate one cfg through the same comparison path the dashboard uses
  // and return the all-in net (savings - Brooklyn fees - Brookhaven fees).
  // Used by both runAutoPick (full search) and the recognition-only
  // optimizer below.
  function _netForCfg(cfg) {
    var totalSave = 0, cumFees = 0, brookhavenFees = 0;
    if ((cfg.recognitionStartYearIndex || 0) >= 1 &&
        typeof root.computeDeferredTaxComparison === 'function') {
      try {
        var defComp = root.computeDeferredTaxComparison(cfg);
        if (defComp && defComp.rows && defComp.rows.length) {
          totalSave = defComp.totalSavings || 0;
          cumFees = defComp.totalFees || 0;
          brookhavenFees = defComp.totalBrookhavenFees || 0;
        }
      } catch (e) { return null; }
    } else {
      // Immediate-recognition path: projection-engine fees + comparison savings.
      if (typeof ProjectionEngine === 'undefined' || !ProjectionEngine.run) return null;
      var projResult;
      try { projResult = ProjectionEngine.run(cfg); } catch (e) { return null; }
      if (!projResult || !projResult.years) return null;
      projResult.years.forEach(function (y) { cumFees += (y.fee || 0); });
      if (projResult.totals && projResult.totals.cumulativeFees != null) {
        cumFees = projResult.totals.cumulativeFees;
      }
      if (typeof root.recommendSale === 'function' && typeof root.computeTaxComparison === 'function') {
        try {
          var recCfg = Object.assign({}, cfg);
          delete recCfg.custodian;
          if (typeof recCfg.leverageCap === 'number' && recCfg.leverageCap > 3) {
            recCfg.leverageCap = 2.25;
          }
          var rec = root.recommendSale(recCfg);
          var normRec = _normalizeRec(rec, cfg);
          var comp = root.computeTaxComparison(cfg, normRec);
          if (comp && Array.isArray(comp.rows)) {
            if (comp.totalSavings != null) totalSave = comp.totalSavings;
            else comp.rows.forEach(function (r) { totalSave += (r.savings || 0); });
            brookhavenFees = comp.totalBrookhavenFees || 0;
          }
        } catch (e) { /* fall back below */ }
      }
      if (!totalSave) {
        projResult.years.forEach(function (y) {
          var no = y.taxNoBrooklyn || 0;
          var w  = (y.taxWithBrooklyn != null) ? y.taxWithBrooklyn : no;
          totalSave += (no - w);
        });
      }
      if (!brookhavenFees && typeof brookhavenFeeSchedule === 'function') {
        var horSched = brookhavenFeeSchedule(cfg.horizonYears || 5, 1);
        brookhavenFees = horSched.total;
      }
    }
    return totalSave - cumFees - brookhavenFees;
  }

  // Recognition-only optimizer. Holds the user's chosen leverage and
  // horizon fixed and finds the recognition year that maximizes net
  // savings. Sets #recognition-start-select and updates the status
  // line. Returns the chosen 1-indexed year.
  //
  // Called from runFullPipeline so EVERY recompute (slider drag,
  // horizon click, Brooklyn-config edit) re-finds the optimal
  // recognition year for the current scenario.
  function searchBestRecognitionForCurrent() {
    if (typeof collectInputs !== 'function') return null;
    var horSel = document.getElementById('projection-years');
    var recSel = document.getElementById('recognition-start-select');
    if (!recSel) return null;
    var horizon = parseInt(horSel ? horSel.value : '5', 10) || 5;
    var maxRec = Math.min(horizon, 4);
    var prevRec = recSel.value;

    var bestNet = -Infinity;
    var bestRec = '1';
    for (var r = 1; r <= maxRec; r++) {
      recSel.value = String(r);
      var cfg;
      try { cfg = collectInputs(); } catch (e) { continue; }
      var spSale = Number((document.getElementById('sale-price') || {}).value) || 0;
      var cb = Number((document.getElementById('cost-basis') || {}).value) || 0;
      var ad = Number((document.getElementById('accelerated-depreciation') || {}).value) || 0;
      if (spSale) cfg.salePrice = spSale;
      if (cb) cfg.costBasis = cb;
      if (ad) cfg.acceleratedDepreciation = ad;
      cfg.strategyKey = cfg.tierKey;
      cfg.investedCapital = cfg.investment;
      cfg.years = cfg.horizonYears;
      cfg.recognitionStartYearIndex = r - 1;

      var net = _netForCfg(cfg);
      if (net != null && net > bestNet) {
        bestNet = net;
        bestRec = String(r);
      }
    }

    // Apply the winning recognition year (no UI dispatch — we don't
    // want a change event firing the auto-recalc loop again).
    recSel.value = bestRec;
    // Recognition status line is intentionally NOT shown to the user —
    // the engine picks the optimal year silently. The hidden <p> stays
    // in the DOM as a no-op sink only.
    return bestRec;
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
    // longTermGain: prefer the engine's recommendation field; if not
    // present, derive from cfg property-sale fields. The previous form
    // `rec.longTermGain || cfg.salePrice ? Math.max(...) : 0` had a
    // precedence bug — the OR resolved before the ternary, so the
    // engine-provided rec.longTermGain was always overwritten when
    // cfg.salePrice was truthy.
    var derivedLT = (cfg.salePrice || 0) > 0
      ? Math.max(0, (cfg.salePrice || 0) - (cfg.costBasis || 0) - (cfg.acceleratedDepreciation || 0))
      : 0;
    return {
      recommendation: rec.recommendation,
      longTermGain: rec.longTermGain || derivedLT,
      lossGenerated: lossGen,
      schedule: schedule
    };
  }

  // Run the recommendation + comparison + projection pipeline for every
  // (leverage, horizon, recognition) combination. Pick the combo with the
  // highest NET benefit (comparison savings minus Brooklyn fees). For
  // deferred recognition (recognition year > 1) we use the deferred
  // comparison function which respects loss carryforward across years
  // and tranches.
  //
  // Tie-breaker: when two combos produce the same net (within $1k), prefer
  // the one with the SHORTEST gain-recognition duration. Matches the
  // user's stated preference for shorter structured-sale lockups.
  // Generate the candidate short% values to test.
  //
  // Schwab: variable leverage isn't permitted on Beta 1, so we
  //   evaluate ONLY the published combo short percentages (currently
  //   {45, 100}). This makes the auto-pick respect Schwab's product
  //   rules instead of fabricating mid-range positions.
  //
  // Goldman / no custodian: we sweep every 1% across [0, custodian-max]
  //   so the auto-pick lands on the EXACT global max rather than a
  //   5%-step approximation. Iteration cost: ~225 short × 3 horizons
  //   × up-to-4 recognition = ~2700 evaluations on Page-2 entry; the
  //   recognition-only search that fires on every subsequent recompute
  //   stays cheap (≤ 4 evaluations).
  function _candidateShortPcts(stratKey, custodianId) {
    if (custodianId === 'schwab' && typeof root.listSchwabCombos === 'function') {
      var combos = root.listSchwabCombos().filter(function (c) { return c.strategyKey === stratKey; });
      if (combos.length) {
        // Just the discrete combo points — no continuous sweep.
        return combos.map(function (c) { return c.shortPct || 0; });
      }
      return [];
    }
    var maxShort = 225;
    var tier = (root.BROOKLYN_STRATEGIES || {})[stratKey];
    if (tier && Array.isArray(tier.dataPoints)) {
      maxShort = Math.max.apply(null, tier.dataPoints.map(function (p) { return p.shortPct || 0; }));
    }
    var step = 1;
    var out = [];
    for (var s = 0; s <= maxShort; s += step) out.push(s);
    return out;
  }

  function runAutoPick() {
    if (typeof collectInputs !== 'function') return null;
    if (typeof ProjectionEngine === 'undefined' || !ProjectionEngine.run) return null;
    var horOpts = _readHorizonOptions();
    if (!horOpts.length) return null;

    // Snapshot the user's currently entered state — we override across
    // iterations and restore if no improvement is found.
    var horSel = document.getElementById('projection-years');
    var recSel = document.getElementById('recognition-start-select');
    var customSp = document.getElementById('custom-short-pct');
    var useVar = document.getElementById('use-variable-leverage');
    var prevHor = horSel ? horSel.value : '';
    var prevRec = recSel ? recSel.value : '1';
    var prevSp  = customSp ? customSp.value : '';
    var prevVar = useVar ? useVar.checked : false;

    // Make sure variable leverage is on for the search; we revert at
    // the end if no improvement.
    if (useVar) useVar.checked = true;

    var stratKey = (document.getElementById('strategy-select') || {}).value || 'beta1';
    var custId   = (document.getElementById('custodian-select') || {}).value || '';
    var shortPcts = _candidateShortPcts(stratKey, custId);

    var best = null;
    shortPcts.forEach(function (sp) {
      horOpts.forEach(function (hor) {
        var horizonNum = parseInt(hor.value, 10) || 5;
        var maxRec = Math.min(horizonNum, 4);
        for (var rStart = 1; rStart <= maxRec; rStart++) {
          if (customSp) customSp.value = String(sp);
          if (horSel) horSel.value = hor.value;
          if (recSel) recSel.value = String(rStart);
          var cfg;
          try { cfg = collectInputs(); }
          catch (e) { continue; }
          // Note: avoid `sp` here — that's the outer loop's short%
          // candidate and `var` would shadow it via hoisting.
          var spSale = Number((document.getElementById('sale-price') || {}).value) || 0;
          var cb = Number((document.getElementById('cost-basis') || {}).value) || 0;
          var ad = Number((document.getElementById('accelerated-depreciation') || {}).value) || 0;
          if (spSale) cfg.salePrice = spSale;
          if (cb) cfg.costBasis = cb;
          if (ad) cfg.acceleratedDepreciation = ad;
          cfg.strategyKey = cfg.tierKey;
          cfg.investedCapital = cfg.investment;
          cfg.years = cfg.horizonYears;
          cfg.recognitionStartYearIndex = rStart - 1;

          var totalSave = 0;
          var cumFees = 0;
          var brookhavenFees = 0;
          var duration = 0;

          if (rStart > 1 && typeof root.computeDeferredTaxComparison === 'function') {
            // Deferred path: comparison + fees come from the same engine
            // since it tracks tranches and per-year fees.
            try {
              var defComp = root.computeDeferredTaxComparison(cfg);
              if (defComp && defComp.rows && defComp.rows.length) {
                totalSave = defComp.totalSavings || 0;
                cumFees = defComp.totalFees || 0;
                brookhavenFees = defComp.totalBrookhavenFees || 0;
                duration = defComp.durationYears || 0;
              }
            } catch (e) { continue; }
          } else {
            // Immediate-recognition path: use the existing recommendation +
            // comparison pipeline, plus projection-engine fees.
            var projResult;
            try { projResult = ProjectionEngine.run(cfg); }
            catch (e) { continue; }
            if (!projResult || !projResult.years || !projResult.years.length) continue;
            projResult.years.forEach(function (y) { cumFees += (y.fee || 0); });
            if (projResult.totals && projResult.totals.cumulativeFees != null) {
              cumFees = projResult.totals.cumulativeFees;
            }
            if (typeof root.recommendSale === 'function' &&
                typeof root.computeTaxComparison === 'function') {
              try {
                var recCfg = Object.assign({}, cfg);
                delete recCfg.custodian;
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
                  brookhavenFees = comp.totalBrookhavenFees || 0;
                }
              } catch (e) { /* fall back below */ }
            }
            if (!totalSave) {
              projResult.years.forEach(function (y) {
                var no = y.taxNoBrooklyn || 0;
                var w  = (y.taxWithBrooklyn != null) ? y.taxWithBrooklyn : no;
                totalSave += (no - w);
              });
            }
            // For immediate path without comparison, derive Brookhaven from horizon.
            if (!brookhavenFees && typeof brookhavenFeeSchedule === 'function') {
              var horSched = brookhavenFeeSchedule(cfg.horizonYears || 5, 1);
              brookhavenFees = horSched.total;
            }
            duration = 1;
          }

          var net = totalSave - cumFees - brookhavenFees;
          var levNumeric = sp / 100;

          // Pure max-net optimization (per user direction): the engine
          // picks whichever (leverage, horizon, recognition) combo
          // produces the absolute highest net savings. The previous
          // $5K bucket was leaving small amounts of net on the table
          // for the sake of "lower leverage feels safer" — the user
          // has now explicitly asked for the highest net, period.
          //
          // Tiebreak only on EXACT-cent ties: prefer shorter horizon,
          // then lower leverage. Real-money ties at this granularity
          // are vanishingly rare; the tiebreak is just for determinism.
          var better = false;
          if (!best) better = true;
          else if (net > best.net) better = true;
          else if (net === best.net) {
            if (duration < best.duration) better = true;
            else if (duration === best.duration && levNumeric < best.leverage) better = true;
          }
          if (better) {
            best = {
              shortPct: sp, hor: hor.value, rec: String(rStart),
              net: net, save: totalSave, fees: cumFees,
              duration: duration, leverage: levNumeric
            };
          }
        }
      });
    });

    // Restore previous selection or apply the best one.
    if (best) {
      if (customSp) customSp.value = String(best.shortPct);
      _setSelect('projection-years', best.hor);
      _setSelect('recognition-start-select', best.rec);
      // Position the visible slider on the best short% so the user
      // sees where the auto-pick landed.
      if (typeof root.setLeverageSliderShort === 'function') {
        try { root.setLeverageSliderShort(best.shortPct); } catch (e) { /* */ }
      }
      _showAutoHint('leverage');
      _showAutoHint('horizon');
      _showAutoHint('recognition');
      root.__lastAutoPick = best;
    } else {
      // Restore (no improvement found).
      if (customSp) customSp.value = prevSp;
      if (horSel) horSel.value = prevHor;
      if (recSel) recSel.value = prevRec;
      if (useVar) useVar.checked = prevVar;
    }
    _refreshRevertVisibility();
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
      try { root.runFullPipeline(); } catch (err) { /* non-fatal */ }
    }
  }

  // Wire the "Revert to optimized" button: re-enable auto-pick, run
  // the full leverage/horizon/recognition search, then re-render.
  function _onRevertClick() {
    root.__rettAutoPickEnabled = true;
    try { runAutoPick(); } catch (e) { /* non-fatal */ }
    if (typeof root.runFullPipeline === 'function') {
      try { root.runFullPipeline(); } catch (err) { /* */ }
    }
    _refreshRevertVisibility();
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
    var revertBtn = document.getElementById('revert-to-optimized');
    if (revertBtn) revertBtn.addEventListener('click', _onRevertClick);
    _refreshRevertVisibility();
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
  root.searchBestRecognitionForCurrent = searchBestRecognitionForCurrent;
  root.refreshRevertVisibility = _refreshRevertVisibility;
  root.__lastAutoPick      = null;
})(window);
