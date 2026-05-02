// js/04-ui/recommendation-render.js
// Wires the Property Sale UI (sale price, basis, accelerated depreciation,
// implementation date, strategy, leverage cap, variable-leverage toggle and
// sliders) to the decision engine, and renders the recommendation panel.

(function (root) {
  'use strict';

  function $(id) { return document.getElementById(id); }

  function fmt(n, digits) {
    if (n == null || !isFinite(n)) return '—';
    digits = digits != null ? digits : 0;
    return '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
  }

  function pct(n, digits) {
    if (n == null || !isFinite(n)) return '—';
    digits = digits != null ? digits : 2;
    return (n * 100).toFixed(digits) + '%';
  }

  function readInputs() {
    var salePrice               = Number(($('sale-price') || {}).value) || 0;
    var costBasis               = Number(($('cost-basis') || {}).value) || 0;
    var acceleratedDepreciation = Number(($('accelerated-depreciation') || {}).value) || 0;
    var implementationDate      = ($('implementation-date') || {}).value || '';
    var strategyKey             = ($('strategy-select') || {}).value || 'beta1';
    // The Brooklyn Investment input was removed; available-capital is the
    // single source of truth, defaulted from sale price on Page 1 -> Page 2
    // continue. The hidden #invested-capital field stays for legacy
    // overrides.
    var availableCapital        = Number(($('available-capital') || {}).value) || 0;
    var investedCapital         = Number(($('invested-capital') || {}).value) || availableCapital;

    // Leverage source. The Page-2 leverage UI is now a slider that writes
    // to #custom-short-pct (along with the always-checked
    // #use-variable-leverage). When that's the case, leverage =
    // shortPct / 100 and we drop comboId/leverageLabel so the engine
    // takes the brooklyn-data interpolation path. Falls back to the
    // legacy #leverage-cap-select reading for any older flow that
    // hasn't migrated to the slider.
    var useVariableLeverage = !!($('use-variable-leverage') || {}).checked;
    var leverageCap = NaN;
    var comboId = null;
    var comboLeverageLabel = null;
    if (useVariableLeverage) {
      var spRaw = parseFloat(($('custom-short-pct') || {}).value);
      if (Number.isFinite(spRaw) && spRaw >= 0) {
        leverageCap = spRaw / 100;
      }
    }
    if (!Number.isFinite(leverageCap)) {
      var levRaw = ($('leverage-cap-select') || {}).value || '';
      leverageCap = parseFloat(levRaw);
      var custodianId = ($('custodian-select') || {}).value || '';
      if (custodianId === 'schwab' && typeof window.findSchwabCombo === 'function') {
        var combo = window.findSchwabCombo(strategyKey, levRaw);
        if (combo) {
          leverageCap = combo.leverage;
          comboId = combo.id;
          comboLeverageLabel = combo.leverageLabel;
        }
      }
    }
    if (!Number.isFinite(leverageCap) || leverageCap < 0) leverageCap = 2.25;

    var years                   = Number(($('projection-years') || {}).value) || 5;
    return {
      salePrice: salePrice,
      costBasis: costBasis,
      acceleratedDepreciation: acceleratedDepreciation,
      implementationDate: implementationDate,
      strategyKey: strategyKey,
      investedCapital: investedCapital,
      availableCapital: availableCapital,
      leverageCap: leverageCap,
      comboId: comboId,
      comboLeverageLabel: comboLeverageLabel,
      years: years,
      useVariableLeverage: useVariableLeverage
    };
  }

  function updateComputedReadouts(inputs) {
    var lt = Math.max(0, inputs.salePrice - inputs.costBasis - inputs.acceleratedDepreciation);
    var rec = Math.max(0, inputs.acceleratedDepreciation);
    var total = lt + rec;
    var gainEl  = $('computed-gain');
    var totalEl = $('computed-total-taxable');
    var fmt = (typeof fmtUSD === 'function') ? fmtUSD : function (n) { return '$' + Math.round(n).toLocaleString('en-US'); };
    if (gainEl)  gainEl.value  = fmt(lt);
    if (totalEl) totalEl.value = fmt(total);

    // Note: an old #year-fraction-remaining read-out and the manual
    // variable-short slider (#variable-short-slider, #variable-readout-*)
    // used to live on Page 1. They were removed when the leverage UI
    // moved to the Page-2 slider (variable-leverage-ui.js); the JS here
    // was pruned alongside them.
  }

  function renderRecommendation(result) {
    var panel = $('recommendation-panel');
    if (!panel) return;
    var html = [];

    html.push('<h3>Recommendation: ' + result.recommendation + '</h3>');
    html.push('<div class="rec-grid">');
    html.push('<div><strong>Long-term gain:</strong> ' + fmt(result.longTermGain) + '</div>');
    html.push('<div><strong>Recapture (ord):</strong> ' + fmt(result.recapture) + '</div>');
    html.push('<div><strong>Total taxable:</strong> ' + fmt(result.gain) + '</div>');
    html.push('<div><strong>Year fraction:</strong> ' + (result.yearFraction != null ? result.yearFraction.toFixed(4) : '—') + '</div>');
    html.push('</div>');

    if (result.stage1RecommendsSingleYear) {
      var s = result.summary;
      html.push('<h4>Stage 1: single-year solve via <em>' + (s.source || '—') + '</em></h4>');
      html.push('<ul>');
      if (s.label)    html.push('<li><strong>Tier/Point:</strong> ' + s.label + '</li>');
      if (s.longPct != null)  html.push('<li><strong>Long %:</strong> ' + s.longPct + '%</li>');
      if (s.shortPct != null) html.push('<li><strong>Short %:</strong> ' + s.shortPct + '%</li>');
      if (s.leverage != null) html.push('<li><strong>Leverage:</strong> ' + s.leverage.toFixed(2) + 'x</li>');
      if (s.loss != null)     html.push('<li><strong>Loss generated:</strong> ' + fmt(s.loss) + '</li>');
      if (s.fees != null)     html.push('<li><strong>Fees:</strong> ' + fmt(s.fees) + '</li>');
      html.push('</ul>');

      // If both preset and variable found a solution, show the comparison.
      if (result.stage1 && result.stage1.ok && result.stage1Variable && result.stage1Variable.ok) {
        var p = result.stage1;
        var v = result.stage1Variable;
        html.push('<details><summary>Compare preset vs variable</summary>');
        html.push('<table class="rec-compare"><thead><tr><th></th><th>Preset</th><th>Variable</th></tr></thead><tbody>');
        html.push('<tr><td>Label</td><td>' + (p.tier ? p.tier.label : '—') + '</td><td>' + (v.point ? v.point.label : '—') + '</td></tr>');
        html.push('<tr><td>Leverage</td><td>' + p.leverage.toFixed(2) + 'x</td><td>' + v.leverage.toFixed(2) + 'x</td></tr>');
        html.push('<tr><td>Loss</td><td>' + fmt(p.loss) + '</td><td>' + fmt(v.loss) + '</td></tr>');
        html.push('<tr><td>Fees</td><td>' + fmt(p.fees) + '</td><td>' + fmt(v.fees) + '</td></tr>');
        html.push('</tbody></table></details>');
      }
    } else {
      var summary = result.summary || {};
      html.push('<h4>Stage 2: structured multi-year sale</h4>');
      html.push('<ul>');
      html.push('<li><strong>Years:</strong> ' + (summary.years != null ? summary.years : '—') + '</li>');
      html.push('<li><strong>Leverage at cap:</strong> ' + (summary.leverageUsed != null ? summary.leverageUsed.toFixed(2) + 'x' : '—') + (summary.leverageLabel ? ' (' + summary.leverageLabel + ')' : '') + '</li>');
      html.push('<li><strong>Total loss needed:</strong> ' + fmt(summary.totalLossNeeded) + '</li>');
      html.push('<li><strong>Total fees:</strong> ' + fmt(summary.totalFees) + '</li>');
      html.push('</ul>');
      if (summary.gainByYear) {
        html.push('<table class="rec-grid-y"><thead><tr><th>Year</th>');
        for (var i = 0; i < summary.gainByYear.length; i++) html.push('<th>Y' + (i + 1) + '</th>');
        html.push('</tr></thead><tbody>');
        html.push('<tr><td>Gain to take</td>');
        for (var j = 0; j < summary.gainByYear.length; j++) html.push('<td>' + fmt(summary.gainByYear[j]) + '</td>');
        html.push('</tr><tr><td>Year-1 capacity</td>');
        for (var k = 0; k < summary.capByYear.length; k++) html.push('<td>' + fmt(summary.capByYear[k]) + '</td>');
        html.push('</tr></tbody></table>');
      }
    }

    panel.innerHTML = html.join('');

    // Push gain-by-year into the year-schedule rows if present
    if (result.summary && result.summary.gainByYear) {
      var rows = document.querySelectorAll('[data-year-row]');
      for (var r = 0; r < rows.length && r < result.summary.gainByYear.length; r++) {
        var input = rows[r].querySelector('[data-long-gain]');
        if (input) input.value = result.summary.gainByYear[r].toFixed(2);
      }
    }
  }

  function runRecommendation() {
    var inputs = readInputs();
    updateComputedReadouts(inputs);
    var result = root.recommendSale(inputs); window.__lastRecommendation = result;
    renderRecommendation(result);

    // Compute tax comparison: needs the multi-year cfg shape (year1/horizon/
    // filingStatus/state/baseOrdinaryIncome) plus the loss/gain from result.
    // When the user has chosen deferred gain recognition (recognition year
    // > 1) we dispatch to the dedicated deferred comparison function which
    // tracks loss carryforward across years and adds reinvestment tranches
    // as gain is recognized.
    try {
      var multiCfg = (typeof collectInputs === 'function') ? collectInputs() : null;
      if (multiCfg) {
        // Make sure the recommendation engine's choice carries over (so the
        // recommendation panel + summary aren't blank in deferred mode).
        if (multiCfg.salePrice == null) multiCfg.salePrice = inputs.salePrice;
        if (multiCfg.costBasis == null) multiCfg.costBasis = inputs.costBasis;
        if (multiCfg.acceleratedDepreciation == null) multiCfg.acceleratedDepreciation = inputs.acceleratedDepreciation;

        var comparison;
        var deferred = (multiCfg.recognitionStartYearIndex || 0) >= 1;
        if (deferred && typeof computeDeferredTaxComparison === 'function') {
          comparison = computeDeferredTaxComparison(multiCfg);
        } else {
          // Synthesize a normalized recommendation shape the comparison expects.
          var lossGen = (result.summary && result.summary.loss) || (result.stage1 && result.stage1.loss) || 0;
          var normRec = {
                recommendation: result.recommendation,
                longTermGain: result.longTermGain || 0,
                lossGenerated: lossGen,
                schedule: (function () {
          if (result.stage2 && Array.isArray(result.stage2.schedule)) return result.stage2.schedule;
          if (result.stage2 && Array.isArray(result.stage2.gainByYear)) {
            return result.stage2.gainByYear.map(function (g, i) {
              return {
                year: i,
                gainTaken: g || 0,
                lossGenerated: (result.stage2.lossByYear && result.stage2.lossByYear[i]) || 0
              };
            });
          }
          return null;
        })()
          };
          comparison = computeTaxComparison(multiCfg, normRec);
        }
        window.__lastComparison = comparison;
        var panel = document.getElementById('recommendation-panel');
        if (panel && comparison) {
          var summary = document.createElement('div');
          summary.className = 'tax-savings-summary';
          summary.style.marginTop = '16px';
          summary.style.padding = '12px';
          summary.style.background = '#0f4c81';
          summary.style.borderRadius = '6px';
          summary.innerHTML = '<strong>Estimated Tax Savings:</strong> $' +
                Math.round(comparison.totalSavings).toLocaleString() +
                ' over ' + comparison.rows.length + ' year(s).' +
                ' &nbsp;<span style="opacity:0.85">See full breakdown on the Brooklyn Allocator tab.</span>';
          panel.appendChild(summary);
        }
        var allocHost = document.getElementById('tax-comparison-host');
        if (allocHost) renderTaxComparison(allocHost, comparison);
      }
    } catch(e) { console.warn('Tax comparison failed:', e && e.message, e && e.stack); }

    return result;
  }

  function attach() {
    // The hidden #run-recommendation button has been removed; controls.js
    // now calls runRecommendation() directly via runFullPipeline().

    // Live readouts as the user types
    ['sale-price', 'cost-basis', 'accelerated-depreciation', 'implementation-date'].forEach(function (id) {
      var el = $(id);
      if (el) el.addEventListener('input', function () { updateComputedReadouts(readInputs()); });
    });

    updateComputedReadouts(readInputs());
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', attach);
  } else {
    attach();
  }

  root.runRecommendation = runRecommendation;
})(window);
