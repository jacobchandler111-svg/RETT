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
    var investedCapital         = Number(($('invested-capital') || {}).value) || 0;
    var leverageCap             = Number(($('leverage-cap') || {}).value) || 2.25;
    var years                   = Number(($('projection-years') || {}).value) || 5;
    var useVariableLeverage     = !!($('use-variable-leverage') || {}).checked;
    var manualVariableShortPct  = null;
    var manualToggle            = $('use-manual-variable');
    var manualSlider            = $('variable-short-slider');
    if (manualToggle && manualToggle.checked && manualSlider) {
      manualVariableShortPct = Number(manualSlider.value) || 0;
    }
    return {
      salePrice: salePrice,
      costBasis: costBasis,
      acceleratedDepreciation: acceleratedDepreciation,
      implementationDate: implementationDate,
      strategyKey: strategyKey,
      investedCapital: investedCapital,
      leverageCap: leverageCap,
      years: years,
      useVariableLeverage: useVariableLeverage,
      manualVariableShortPct: manualVariableShortPct
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

    var yfEl = $('year-fraction-remaining');
    if (yfEl && typeof root.yearFractionRemaining === 'function' && inputs.implementationDate) {
      var yf = root.yearFractionRemaining(inputs.implementationDate);
      yfEl.value = yf.toFixed(4) + '  (' + (yf * 100).toFixed(1) + '% of year remaining)';
    }
  }

  // Update the slider readouts (long%, short%, leverage, lossRate, feeRate)
  // whenever the slider moves. Also constrain the slider's min/max to the
  // currently selected strategy's bounds.
  function updateVariableSliderReadout() {
    var slider = $('variable-short-slider');
    if (!slider) return;
    var strategyKey = ($('strategy-select') || {}).value || 'beta1';
    var bounds = (typeof root.getStrategyBounds === 'function') ? root.getStrategyBounds(strategyKey) : null;
    if (bounds) {
      slider.min = bounds.minShort;
      slider.max = bounds.maxShort;
      if (Number(slider.value) > bounds.maxShort) slider.value = bounds.maxShort;
      if (Number(slider.value) < bounds.minShort) slider.value = bounds.minShort;
    }
    var s = Number(slider.value) || 0;
    var pt = (typeof root.lookupVariable === 'function') ? root.lookupVariable(strategyKey, s) : null;
    if (!pt) return;
    if ($('variable-readout-long'))    $('variable-readout-long').textContent    = pt.longPct + '%';
    if ($('variable-readout-short'))   $('variable-readout-short').textContent   = pt.shortPct + '%';
    if ($('variable-readout-label'))   $('variable-readout-label').textContent   = pt.label;
    if ($('variable-readout-lev'))     $('variable-readout-lev').textContent     = pt.leverage.toFixed(2) + 'x';
    if ($('variable-readout-loss'))    $('variable-readout-loss').textContent    = pct(pt.lossRate, 2);
    if ($('variable-readout-fee'))     $('variable-readout-fee').textContent     = pct(pt.feeRate, 3);
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
    try {
      var multiCfg = (typeof collectInputs === 'function') ? collectInputs() : null;
      if (multiCfg) {
        // Synthesize a normalized recommendation shape the comparison expects:
        //   { recommendation, longTermGain, lossGenerated, schedule? }
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
        var comparison = computeTaxComparison(multiCfg, normRec);
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
    var runBtn = $('run-recommendation');
    if (runBtn) runBtn.addEventListener('click', function (e) {
      e.preventDefault();
      runRecommendation();
    });

    // Live readouts as the user types
    ['sale-price', 'cost-basis', 'accelerated-depreciation', 'implementation-date'].forEach(function (id) {
      var el = $(id);
      if (el) el.addEventListener('input', function () { updateComputedReadouts(readInputs()); });
    });

    // Variable-leverage UI wiring
    var slider = $('variable-short-slider');
    if (slider) slider.addEventListener('input', updateVariableSliderReadout);
    var stratSel = $('strategy-select');
    if (stratSel) stratSel.addEventListener('change', updateVariableSliderReadout);

    updateComputedReadouts(readInputs());
    updateVariableSliderReadout();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', attach);
  } else {
    attach();
  }

  root.runRecommendation = runRecommendation;
  root.updateVariableSliderReadout = updateVariableSliderReadout;
})(window);
