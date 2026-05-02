// FILE: js/04-ui/variable-leverage-ui.js
// "Custom leverage" controls on Page 2. The user can pick any short%
// within their custodian's allowed range; loss rate and fee are linearly
// interpolated from the strategy's preset data points. Long% is derived
// from the strategy:
//   - Beta 1 / Beta 0.5 / Advisor Managed: long = 100 + short
//   - Beta 0 (market neutral): long = short
//
// The active selection writes onto two hidden globals that
// inputs-collector.js picks up:
//   - cfg.useVariableLeverage  (boolean)
//   - cfg.customShortPct       (number, 0-225 typically)
// brooklynInterpolate(strategyKey, customShortPct/100) gives the loss
// and fee data points to use, calibrated to the existing dataPoints in
// brooklyn-data.js. The fee-split module surfaces the management vs.
// financing decomposition for display.

(function (root) {
  'use strict';

  function _byId(id) { return document.getElementById(id); }

  // Long% from strategy + short%.
  function _longPctFor(strategyKey, shortPct) {
    if (strategyKey === 'beta0') return shortPct;             // 100/100, 200/200
    return 100 + shortPct;                                     // 145/45, 200/100, etc.
  }

  // Custodian-allowed max short% based on the active custodian + strategy.
  // Schwab's published combos top out at 200/100 (short=100) for Beta 1
  // but only 100/100 for Beta 0. Goldman allows up to 325/225 (Beta 1)
  // and 275/275 (Beta 0). For the variable path we use the highest
  // matching short% from the data points.
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

  // Refresh the readouts (long/short/effective tier/loss/fee) from the
  // current short% input. Also rebuilds the hint line with the
  // custodian-allowed max.
  function refreshReadouts() {
    var input  = _byId('custom-short-pct');
    var lOut   = _byId('custom-long-readout');
    var tOut   = _byId('custom-tier-readout');
    var fOut   = _byId('custom-fee-readout');
    var hint   = _byId('custom-leverage-hint');
    if (!input) return;
    var stratKey = (_byId('strategy-select') || {}).value || 'beta1';
    var custId   = (_byId('custodian-select') || {}).value || '';
    var maxShort = _maxShortFor(custId, stratKey);
    if (Number(input.max) !== maxShort) input.max = String(maxShort);

    var sp = Math.max(0, Math.min(maxShort, Number(input.value) || 0));
    if (Number(input.value) !== sp) input.value = String(sp);
    var lp = _longPctFor(stratKey, sp);

    if (lOut) lOut.textContent = lp + '%';
    if (tOut) tOut.textContent = lp + '/' + sp;

    var lossRate = 0;
    var feeRate  = 0;
    if (typeof root.brooklynInterpolate === 'function') {
      var snap = root.brooklynInterpolate(stratKey, sp / 100);
      if (snap) {
        lossRate = snap.lossRate || 0;
        feeRate  = snap.feeRate  || 0;
      }
    }
    if (fOut) {
      var lossPct = (lossRate * 100).toFixed(2) + '%';
      var feePct  = (feeRate  * 100).toFixed(2) + '%';
      fOut.textContent = lossPct + ' / ' + feePct;
    }
    if (hint) {
      hint.hidden = false;
      var custLabel = custId === 'schwab' ? 'Charles Schwab'
                    : custId === 'goldmanSachs' ? 'Goldman Sachs'
                    : 'your custodian';
      hint.textContent = 'Capped at ' + custLabel + '\u2019s max short% for ' + stratKey + ': ' + maxShort + '. ' +
        'Loss rate and fee interpolated linearly from the published ' + stratKey + ' presets.';
    }
  }

  function _onToggleChange() {
    var toggle  = _byId('use-variable-leverage');
    var grid    = _byId('variable-leverage-controls');
    var hint    = _byId('custom-leverage-hint');
    if (!toggle) return;
    var on = !!toggle.checked;
    if (grid) grid.hidden = !on;
    if (hint) hint.hidden = !on;
    if (on) refreshReadouts();
    if (typeof root.runFullPipeline === 'function') {
      try { root.runFullPipeline(); } catch (e) { /* */ }
    }
  }

  function _onShortChange() {
    refreshReadouts();
    if (typeof root.runFullPipeline === 'function') {
      try { root.runFullPipeline(); } catch (e) { /* */ }
    }
  }

  function _attach() {
    var toggle = _byId('use-variable-leverage');
    var input  = _byId('custom-short-pct');
    if (toggle) toggle.addEventListener('change', _onToggleChange);
    if (input)  input.addEventListener('input', _onShortChange);
    var stratSel = _byId('strategy-select');
    if (stratSel) stratSel.addEventListener('change', refreshReadouts);
    var custSel = _byId('custodian-select');
    if (custSel) custSel.addEventListener('change', refreshReadouts);
    refreshReadouts();
    _onToggleChange();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _attach);
  } else {
    _attach();
  }

  root.refreshVariableLeverageReadouts = refreshReadouts;
})(window);
