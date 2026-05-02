// FILE: js/04-ui/variable-leverage-ui.js
// Leverage slider on Page 2. Replaces the legacy leverage pill row.
//
// The slider is a continuous control over the short-percentage axis,
// clamped to whatever the active custodian + strategy permits. The
// auto-pick optimizer (pill-toggles.js runAutoPick) sets the slider's
// position to the short% that maximizes net savings; users can drag
// to override. The slider is the canonical input for variable
// leverage — there is no "use variable" checkbox anymore. Hidden
// legacy fields (#use-variable-leverage, #custom-short-pct) stay in
// the DOM as the source of truth that inputs-collector reads.
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

  function refreshReadouts() {
    var slider = _byId('leverage-slider');
    var hidden = _byId('custom-short-pct');
    var tierEl = _byId('leverage-slider-tier');
    var detailEl = _byId('leverage-slider-detail');
    if (!slider) return;

    _refreshTicks();
    var stratKey = (_byId('strategy-select') || {}).value || 'beta1';
    var maxShort = Number(slider.max) || 225;
    var sp = Math.max(0, Math.min(maxShort, Number(slider.value) || 0));
    if (Number(slider.value) !== sp) slider.value = String(sp);
    if (hidden && hidden.value !== String(sp)) hidden.value = String(sp);
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
  }

  function _attach() {
    var slider = _byId('leverage-slider');
    if (slider) {
      // Throttle: only re-run after the user pauses dragging by ~150ms.
      var t;
      slider.addEventListener('input', function () {
        clearTimeout(t);
        t = setTimeout(_onSliderInput, 150);
      });
    }
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
