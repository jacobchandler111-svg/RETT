// FILE: js/04-ui/variable-leverage-ui.js
// Leverage UI on Page 2. Two modes:
//
//   1) Continuous slider (Goldman or no custodian)
//      A continuous control over the short-percentage axis, clamped
//      to whatever the active custodian + strategy permits. The
//      auto-pick optimizer sets the position; users can drag to
//      override.
//
//   2) Schwab preset pills (beta1 only)
//      Schwab does not permit variable leverage on Beta 1. When
//      custodian = Schwab, the slider is hidden and a two-pill
//      picker (145/45 / 200/100) takes its place. Auto-pick on
//      Schwab evaluates only those two short percentages.
//
// The hidden legacy field #custom-short-pct is the canonical
// source of truth that inputs-collector reads, regardless of mode.
//
// Long% derives from the strategy:
//   - Beta 0 (market neutral): long = short
//   - All others: long = 100 + short

(function (root) {
  'use strict';

  function _byId(id) { return document.getElementById(id); }

  function _longPctFor(strategyKey, shortPct) {
    if (strategyKey === 'beta0') return shortPct;
    return 100 + shortPct;
  }

  // Custodian + strategy max short%. Schwab tops out at 100 for Beta 1
  // (their published 200/100 combo) and 100 for Beta 0 (100/100). For
  // Goldman or no custodian we use the brooklyn-data top-tier point.
  function _maxShortFor(custodianId, strategyKey) {
    if (custodianId === 'schwab' && typeof root.listSchwabCombos === 'function') {
      var combos = root.listSchwabCombos().filter(function (c) {
        return c.strategyKey === strategyKey;
      });
      if (combos.length) {
        return Math.max.apply(null, combos.map(function (c) { return c.shortPct || 0; }));
      }
    }
    var tier = (root.BROOKLYN_STRATEGIES || {})[strategyKey];
    if (tier && Array.isArray(tier.dataPoints) && tier.dataPoints.length) {
      return Math.max.apply(null, tier.dataPoints.map(function (p) { return p.shortPct || 0; }));
    }
    return 225;
  }

  // Build / refresh the datalist tick marks for the slider so users
  // can see where the published preset combos sit on the continuum.
  function _refreshTicks() {
    var datalist = _byId('leverage-slider-ticks');
    if (!datalist) return;
    var stratKey = (_byId('strategy-select') || {}).value || 'beta1';
    var custId   = (_byId('custodian-select') || {}).value || '';
    var maxShort = _maxShortFor(custId, stratKey);
    var ticks = [];
    if (custId === 'schwab' && typeof root.listSchwabCombos === 'function') {
      ticks = root.listSchwabCombos()
        .filter(function (c) { return c.strategyKey === stratKey; })
        .map(function (c) { return c.shortPct; });
    } else {
      var tier = (root.BROOKLYN_STRATEGIES || {})[stratKey];
      if (tier && Array.isArray(tier.dataPoints)) {
        ticks = tier.dataPoints.map(function (p) { return p.shortPct; });
      }
    }
    datalist.innerHTML = ticks.map(function (t) {
      return '<option value="' + t + '"></option>';
    }).join('');
    var slider = _byId('leverage-slider');
    if (slider && Number(slider.max) !== maxShort) slider.max = String(maxShort);
  }

  // Show / hide the slider vs. the Schwab preset picker depending on
  // the active custodian. Schwab doesn't allow variable leverage on
  // Beta 1, so we swap the slider for a two-button picker.
  function _refreshMode() {
    var custId = (_byId('custodian-select') || {}).value || '';
    var sliderGroup = _byId('leverage-slider-group');
    var schwabGroup = _byId('leverage-schwab-group');
    var isSchwab = (custId === 'schwab');
    if (sliderGroup) sliderGroup.hidden = isSchwab;
    if (schwabGroup) schwabGroup.hidden = !isSchwab;
    if (isSchwab) {
      // Sync the Schwab pills to the current short% (snap to 45 if
      // <= 70, otherwise 100). Engine still reads from
      // #custom-short-pct so we update that too.
      var hidden = _byId('custom-short-pct');
      var rawSp = Number((hidden && hidden.value) || 100);
      var snapped = (rawSp <= 70) ? 45 : 100;
      if (hidden) hidden.value = String(snapped);
      _syncSchwabPills(snapped);
    }
  }

  function _syncSchwabPills(sp) {
    var track = _byId('leverage-schwab-track');
    if (!track) return;
    Array.prototype.forEach.call(track.querySelectorAll('.pill'), function (b) {
      var v = Number(b.getAttribute('data-short'));
      var on = (v === sp);
      b.classList.toggle('active', on);
      b.setAttribute('aria-checked', on ? 'true' : 'false');
    });
  }

  function refreshReadouts() {
    _refreshMode();
    var slider = _byId('leverage-slider');
    var hidden = _byId('custom-short-pct');
    var tierEl = _byId('leverage-slider-tier');
    var detailEl = _byId('leverage-slider-detail');
    if (!slider) return;

    _refreshTicks();
    var stratKey = (_byId('strategy-select') || {}).value || 'beta1';
    var maxShort = Number(slider.max) || 225;
    var sp = Math.max(0, Math.min(maxShort, Number(slider.value) || 0));
    // Schwab mode: source-of-truth is the hidden field, not the slider
    // (slider is hidden in this mode).
    var custId = (_byId('custodian-select') || {}).value || '';
    if (custId === 'schwab' && hidden) {
      sp = Number(hidden.value) || 100;
    }
    if (Number(slider.value) !== sp) slider.value = String(sp);
    if (hidden && hidden.value !== String(sp)) hidden.value = String(sp);
    _syncSchwabPills(sp);
    var lp = _longPctFor(stratKey, sp);

    var lossRate = (typeof root.brooklynLossRateFor === 'function')
      ? root.brooklynLossRateFor(stratKey, lp, sp)
      : 0;
    var feeRate = (typeof root.brooklynFeeRateFor === 'function')
      ? root.brooklynFeeRateFor(lp, sp)
      : 0;

    if (tierEl) tierEl.textContent = lp + '/' + sp;
    if (detailEl) {
      detailEl.textContent = 'loss ' + (lossRate * 100).toFixed(1) + '% \u00b7 fee ' +
        (feeRate * 100).toFixed(2) + '%';
    }

    // Mirror to legacy outputs (used by other modules).
    var lOut  = _byId('custom-long-readout');
    var tOut  = _byId('custom-tier-readout');
    var fOut  = _byId('custom-fee-readout');
    var hint  = _byId('custom-leverage-hint');
    if (lOut) lOut.textContent  = lp + '%';
    if (tOut) tOut.textContent  = lp + '/' + sp;
    if (fOut) fOut.textContent  = (lossRate * 100).toFixed(2) + '% / ' + (feeRate * 100).toFixed(2) + '%';
    if (hint) hint.textContent  = '';
  }

  // Programmatically position the slider (called by the auto-pick
  // optimizer after it finds the best short%). Suppresses the
  // input-driven projection rerun so the optimizer's own rerun wins.
  function setSliderShort(sp) {
    var slider = _byId('leverage-slider');
    var hidden = _byId('custom-short-pct');
    if (!slider) return;
    var maxShort = Number(slider.max) || 225;
    var clamped = Math.max(0, Math.min(maxShort, Number(sp) || 0));
    slider.value = String(clamped);
    if (hidden) hidden.value = String(clamped);
    refreshReadouts();
  }

  function _onSliderInput() {
    refreshReadouts();
    if (typeof root.runFullPipeline === 'function') {
      try { root.runFullPipeline(); } catch (e) { /* */ }
    }
    // Hide the auto-selected hint after a manual drag.
    var hint = _byId('leverage-auto-hint');
    if (hint) hint.hidden = true;
    root.__rettAutoPickEnabled = false;
    // Show the "Revert to optimized" button now that the user has
    // overridden the engine's pick.
    if (typeof root.refreshRevertVisibility === 'function') {
      try { root.refreshRevertVisibility(); } catch (e) { /* */ }
    }
  }

  function _onSchwabPillClick(e) {
    var btn = e.target.closest('.pill');
    if (!btn) return;
    var track = btn.closest('#leverage-schwab-track');
    if (!track) return;
    var sp = Number(btn.getAttribute('data-short'));
    if (!isFinite(sp)) return;
    var hidden = _byId('custom-short-pct');
    if (hidden) hidden.value = String(sp);
    _syncSchwabPills(sp);
    refreshReadouts();
    // First manual click disables auto-pick (same behavior as the slider).
    root.__rettAutoPickEnabled = false;
    var hint = _byId('leverage-schwab-auto-hint');
    if (hint) hint.hidden = true;
    if (typeof root.refreshRevertVisibility === 'function') {
      try { root.refreshRevertVisibility(); } catch (e) { /* */ }
    }
    if (typeof root.runFullPipeline === 'function') {
      try { root.runFullPipeline(); } catch (e) { /* */ }
    }
  }

  function _attach() {
    var slider = _byId('leverage-slider');
    if (slider) {
      // Live drag: update the slider readout text on every input tick
      // (cheap), and coalesce the expensive recompute (recognition
      // optimizer + recommendation + projection + dashboard render)
      // to one requestAnimationFrame per paint frame so the chart and
      // KPIs animate as the user drags rather than only on release.
      var rafPending = false;
      slider.addEventListener('input', function () {
        // Cheap part — keep the slider readout in sync immediately
        // even if a frame's pipeline run hasn't landed yet.
        refreshReadouts();
        if (rafPending) return;
        rafPending = true;
        (root.requestAnimationFrame || function (cb) { return setTimeout(cb, 16); })(function () {
          rafPending = false;
          _onSliderInput();
        });
      });
    }
    var schwabTrack = _byId('leverage-schwab-track');
    if (schwabTrack) schwabTrack.addEventListener('click', _onSchwabPillClick);
    var stratSel = _byId('strategy-select');
    if (stratSel) stratSel.addEventListener('change', refreshReadouts);
    var custSel = _byId('custodian-select');
    if (custSel) custSel.addEventListener('change', refreshReadouts);
    refreshReadouts();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _attach);
  } else {
    _attach();
  }

  root.refreshVariableLeverageReadouts = refreshReadouts;
  root.setLeverageSliderShort          = setSliderShort;
})(window);
