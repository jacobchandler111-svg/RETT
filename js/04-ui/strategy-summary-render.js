// FILE: js/04-ui/strategy-summary-render.js
// Strategy Summary page renderer. Ported from the original Brookhaven
// Strategy Summary page and adapted to RETT's Brooklyn-only multi-year
// model. Adds custodian context and a multi-year savings table.
//
// Sections rendered (top to bottom):
//   0. Header
//   1. Custodian Context (RETT-specific, shows allowed caps + minimums)
//   2. Baseline — Without Tax Planning (Year 1)
//   3. With Tax Planning (Year 1)
//   4. Multi-Year Tax Savings (year-by-year, RETT-specific)
//   5. Return on Planning (Year 1, with fees)
//   6. Strategy Breakdown card (Brooklyn only — Brooklyn is the sole strategy)
//   7. Tax Savings Comparison (existing renderer, kept intact)
//   8. Allocator Detail (existing renderer, kept intact)
//   9. Recalculate / Export buttons
//
// Public entry point: renderStrategySummary() — reads window.__lastResult /
// window.__lastComparison populated by controls.js.

(function (root) {
  'use strict';

  function _fmt(n) {
    if (n == null || !isFinite(n)) return '—';
    if (typeof fmtUSD === 'function') return fmtUSD(n);
    var sign = n < 0 ? '-' : '';
    var v = Math.round(Math.abs(n));
    return sign + '$' + v.toLocaleString('en-US');
  }

  function _pct(n, digits) {
    if (n == null || !isFinite(n)) return '—';
    return n.toFixed(digits == null ? 1 : digits) + '%';
  }

  function _strategyLabel(key) {
    var map = {
      beta1: 'Brooklyn Beta 1 (RIA, S&P 500)',
      beta0: 'Brooklyn Beta 0 (CASH, Zero Beta)',
      beta05: 'Brooklyn Beta 0.5',
      advisorManaged: 'Brooklyn Advisor-Managed'
    };
    return map[key] || key || '—';
  }

  function _filingLabel(f) {
    var m = { single:'Single', mfj:'Married Filing Jointly', mfs:'Married Filing Separately', hoh:'Head of Household' };
    return m[f] || f || '—';
  }

  // Build the Custodian Context table (RETT-specific). Surfaces the
  // allowed caps + minimums + currently-applied cap so the planner can
  // see, at a glance, that the strategy fits the custodian's rules.
  function _buildCustodianContext(cfg) {
    if (!cfg || !cfg.custodian || typeof getCustodian !== 'function') return null;
    var c = getCustodian(cfg.custodian);
    if (!c) return null;
    var minInv = (typeof getMinInvestment === 'function')
      ? getMinInvestment(cfg.custodian, cfg.tierKey || cfg.strategyKey || 'beta1') : 0;
    var rows = '';
    rows += '<tr><td>Custodian</td><td>' + c.label + '</td></tr>';
    rows += '<tr><td>Strategy</td><td>' + _strategyLabel(cfg.tierKey || cfg.strategyKey) + '</td></tr>';
    rows += '<tr><td>Allowed Leverage Caps</td><td>' +
      c.allowedLeverageCaps.map(function(v){ return v.toFixed(2)+'x'; }).join(', ') + '</td></tr>';
    rows += '<tr><td>Applied Cap</td><td>' + (cfg.leverageCap != null ? Number(cfg.leverageCap).toFixed(2)+'x' : '—') + '</td></tr>';
    rows += '<tr><td>Minimum Investment</td><td>' + _fmt(minInv) + '</td></tr>';
    rows += '<tr class="total-row"><td>Brooklyn Investment</td><td>' + _fmt(cfg.investedCapital || cfg.investment) + '</td></tr>';
    return '<div class="results-table-section">'
      + '<h3 class="table-title">Custodian Context</h3>'
      + '<table class="results-table"><tbody>' + rows + '</tbody></table>'
      + '</div>';
  }

  // Build Table 1: Baseline (Without Tax Planning) for Year 1.
  function _buildBaselineTable(cfg, y1) {
    var grossSale = Number(cfg.salePrice) || 0;
    var fed = y1.fedTaxNoBrooklyn || 0;
    var st  = y1.stateTaxNoBrooklyn || 0;
    var total = (y1.taxNoBrooklyn != null) ? y1.taxNoBrooklyn : (fed + st);
    var agi = (y1.ordinary || 0) + (y1.shortGain || 0) + (y1.longGain || 0);
    var taxPctSale = grossSale > 0 ? (total / grossSale * 100) : null;
    var afterTax = agi - total;
    var effRate = agi > 0 ? (total / agi * 100) : null;
    var rows = ''
      + '<tr><td>Tax Year</td><td>' + y1.year + '</td></tr>'
      + '<tr><td>Filing Status</td><td>' + _filingLabel(cfg.filingStatus) + '</td></tr>'
      + '<tr><td>State</td><td>' + (cfg.state || '—') + '</td></tr>'
      + '<tr class="spacer-row"><td colspan="2"></td></tr>'
      + '<tr><td>Gross Sales Proceeds</td><td>' + _fmt(grossSale) + '</td></tr>'
      + '<tr><td>Federal Tax Due</td><td>' + _fmt(fed) + '</td></tr>'
      + '<tr><td>State Tax Due</td><td>' + _fmt(st) + '</td></tr>'
      + '<tr class="total-row"><td>Total Tax Due</td><td>' + _fmt(total) + '</td></tr>'
      + '<tr><td>Tax as % of Sale</td><td>' + _pct(taxPctSale) + '</td></tr>'
      + '<tr><td>After-Tax Income</td><td>' + _fmt(afterTax) + '</td></tr>'
      + '<tr class="total-row"><td>Effective Tax Rate</td><td>' + _pct(effRate) + '</td></tr>';
    return '<div class="results-table-section">'
      + '<h3 class="table-title">Baseline — Without Tax Planning</h3>'
      + '<table class="results-table"><tbody>' + rows + '</tbody></table></div>';
  }

  // Build Table 2: With Tax Planning (Year 1).
  function _buildPlanningTable(cfg, y1, recommendation) {
    var fedW = y1.fedTaxWithBrooklyn;
    var stW  = y1.stateTaxWithBrooklyn;
    var totalWith = (y1.taxWithBrooklyn != null) ? y1.taxWithBrooklyn : ((fedW||0)+(stW||0));
    var totalNo = (y1.taxNoBrooklyn != null) ? y1.taxNoBrooklyn : 0;
    var agi = (y1.ordinary || 0) + (y1.shortGain || 0) + (y1.longGain || 0);
    var newRate = agi > 0 && totalWith != null ? (totalWith / agi * 100) : null;
    var lev = recommendation && recommendation.summary ? recommendation.summary.leverage : null;
    var lossRate = y1.lossRate != null ? (y1.lossRate * 100).toFixed(2)+'%' : '—';
    var src = recommendation && recommendation.summary ? recommendation.summary.source : null;
    var srcLabel = src === 'preset' ? 'Preset ladder'
                 : src === 'variable' ? 'Variable solver'
                 : src === 'manual-variable' ? 'Manual override'
                 : src === 'no-action' ? 'No action needed'
                 : src || '—';
    var rows = ''
      + '<tr class="strategy-header"><td colspan="2">Brooklyn Allocation (Year ' + y1.year + ')</td></tr>'
      + '<tr><td>Strategy</td><td>' + _strategyLabel(cfg.tierKey || cfg.strategyKey) + '</td></tr>'
      + '<tr><td>Solver Source</td><td>' + srcLabel + '</td></tr>'
      + '<tr><td>Leverage Applied</td><td>' + (lev != null ? lev.toFixed(2)+'x' : '—') + '</td></tr>'
      + '<tr><td>Loss Rate (interpolated)</td><td>' + lossRate + '</td></tr>'
      + '<tr><td>Investment</td><td>' + _fmt(y1.investmentThisYear) + '</td></tr>'
      + '<tr><td>Short-Term Losses Generated</td><td>' + _fmt(y1.grossLoss) + '</td></tr>'
      + '<tr><td>Brooklyn Fee (Year 1)</td><td>' + _fmt(y1.fee) + '</td></tr>'
      + '<tr class="spacer-row"><td colspan="2"></td></tr>'
      + '<tr><td>Federal Tax (with strategy)</td><td>' + _fmt(fedW) + '</td></tr>'
      + '<tr><td>State Tax (with strategy)</td><td>' + _fmt(stW) + '</td></tr>'
      + '<tr class="total-row"><td>Total Tax (with strategy)</td><td>' + _fmt(totalWith) + '</td></tr>'
      + '<tr><td>New Effective Rate</td><td>' + _pct(newRate) + '</td></tr>'
      + '<tr class="savings-row"><td>Year-1 Tax Savings</td><td>' + _fmt(totalNo - totalWith) + '</td></tr>';
    return '<div class="results-table-section">'
      + '<h3 class="table-title">With Tax Planning</h3>'
      + '<table class="results-table"><tbody>' + rows + '</tbody></table></div>';
  }

  // Build the Multi-Year Savings table (RETT-specific extension).
  function _buildMultiYearTable(years) {
    if (!years || !years.length) return '';
    var head = '<tr class="strategy-header">'
      + '<td>Year</td><td>Tax Without</td><td>Tax With</td><td>Savings</td><td>Investment</td><td>Loss Generated</td>'
      + '</tr>';
    var body = '';
    var cumNo = 0, cumWith = 0, cumSave = 0, cumInv = 0, cumLoss = 0;
    years.forEach(function (y) {
      var no = y.taxNoBrooklyn || 0;
      var w  = (y.taxWithBrooklyn != null) ? y.taxWithBrooklyn : no;
      var save = no - w;
      cumNo += no; cumWith += w; cumSave += save;
      cumInv += (y.investmentThisYear || 0);
      cumLoss += (y.grossLoss || 0);
      body += '<tr>'
        + '<td>' + y.year + '</td>'
        + '<td>' + _fmt(no) + '</td>'
        + '<td>' + _fmt(w) + '</td>'
        + '<td>' + _fmt(save) + '</td>'
        + '<td>' + _fmt(y.investmentThisYear) + '</td>'
        + '<td>' + _fmt(y.grossLoss) + '</td>'
        + '</tr>';
    });
    body += '<tr class="total-row">'
      + '<td>Total</td>'
      + '<td>' + _fmt(cumNo) + '</td>'
      + '<td>' + _fmt(cumWith) + '</td>'
      + '<td>' + _fmt(cumSave) + '</td>'
      + '<td>' + _fmt(cumInv) + '</td>'
      + '<td>' + _fmt(cumLoss) + '</td>'
      + '</tr>';
    // Make the table 6-column (results-table is normally 2-col); inject inline col widths.
    var tableHtml = '<table class="results-table" style="width:100%"><thead>' + head + '</thead><tbody>' + body + '</tbody></table>';
    return '<div class="results-table-section">'
      + '<h3 class="table-title">Multi-Year Tax Savings</h3>'
      + tableHtml + '</div>';
  }

  // Build Table 3: Return on Planning (Year 1, with fees).
  function _buildROITable(cfg, y1, totals) {
    var no = y1.taxNoBrooklyn || 0;
    var w  = (y1.taxWithBrooklyn != null) ? y1.taxWithBrooklyn : no;
    var savings = no - w;
    var brooklynFeeY1 = y1.fee || 0;
    var totalFees = totals && totals.cumulativeFees != null ? totals.cumulativeFees : brooklynFeeY1;
    var net = savings - brooklynFeeY1;
    var roi = brooklynFeeY1 > 0 ? (net / brooklynFeeY1 * 100) : (savings > 0 ? Infinity : 0);
    var roiTxt = isFinite(roi) ? roi.toFixed(1) + '%' : '∞';
    var rows = ''
      + '<tr><td>Tax Without Planning (Year 1)</td><td>' + _fmt(no) + '</td></tr>'
      + '<tr><td>Tax With Planning (Year 1)</td><td>' + _fmt(w) + '</td></tr>'
      + '<tr class="savings-row"><td>Year-1 Tax Savings</td><td>' + _fmt(savings) + '</td></tr>'
      + '<tr class="spacer-row"><td colspan="2"></td></tr>'
      + '<tr class="strategy-header"><td colspan="2">Fees</td></tr>'
      + '<tr><td>Brooklyn Strategy Fee (Year 1)</td><td>' + _fmt(brooklynFeeY1) + '</td></tr>'
      + '<tr><td>Cumulative Fees (horizon)</td><td>' + _fmt(totalFees) + '</td></tr>'
      + '<tr class="spacer-row"><td colspan="2"></td></tr>'
      + '<tr class="savings-row"><td>Net Savings After Year-1 Fees</td><td>' + _fmt(net) + '</td></tr>'
      + '<tr class="total-row"><td>Return on Year-1 Planning (Net Savings / Fees)</td><td>' + roiTxt + '</td></tr>';
    return '<div class="results-table-section summary-section">'
      + '<h3 class="table-title summary-title">Return on Planning</h3>'
      + '<table class="results-table summary-table"><tbody>' + rows + '</tbody></table></div>';
  }

  // Build Strategy Breakdown card (single-card RETT version).
  function _buildBreakdownCard(cfg, y1, recommendation) {
    var no = y1.taxNoBrooklyn || 0;
    var w  = (y1.taxWithBrooklyn != null) ? y1.taxWithBrooklyn : no;
    var savings = no - w;
    var lev = recommendation && recommendation.summary ? recommendation.summary.leverage : null;
    var detail = _strategyLabel(cfg.tierKey || cfg.strategyKey) +
                 (lev != null ? ' • Leverage ' + lev.toFixed(2) + 'x' : '') +
                 ' • Investment ' + _fmt(y1.investmentThisYear);
    var html = '<h3 class="table-title" style="margin-bottom:12px;">Strategy Breakdown</h3>' +
      '<div style="display:flex;flex-wrap:wrap;gap:16px;justify-content:center;">' +
      '<div class="strategy-toggle-card" data-strategy-id="brooklyn" style="flex:1;min-width:220px;max-width:340px;' +
      'background:rgba(21,101,192,0.15);border:1px solid rgba(66,165,245,0.3);border-radius:10px;padding:16px;text-align:center;">' +
      '<div style="font-weight:700;font-size:1.05em;color:#90caf9;margin-bottom:6px;">Brooklyn Tax Loss Harvesting</div>' +
      '<div style="font-size:0.85em;color:#b0bec5;margin-bottom:10px;">' + detail + '</div>' +
      '<div style="font-size:1.3em;font-weight:700;color:#4fc3f7;">' + _fmt(savings) + ' saved (Year 1)</div>' +
      '</div></div>';
    return '<div class="results-table-section summary-section" id="strategy-breakdown">' + html + '</div>';
  }

  // Public entry point. Reads result + comparison from globals stored by controls.js.
  function renderStrategySummary() {
    var page = document.getElementById('page-allocator');
    if (!page) return;
    var result = window.__lastResult;
    var recommendation = window.__lastRecommendation;
    var comparison = window.__lastComparison;

    // Preserve the existing tax-comparison and allocator hosts so we don't
    // regress what was already on page 3.
    var existingTaxHost = page.querySelector('#tax-comparison-host');
    var existingAllocator = page.querySelector('#allocator-output');
    var taxHostHtml = existingTaxHost ? existingTaxHost.outerHTML : '<div id="tax-comparison-host"></div>';
    var allocHtml = existingAllocator ? existingAllocator.outerHTML : '<div id="allocator-output"></div>';

    // If we have no projection result yet, render an empty-state.
    if (!result || !result.years || !result.years.length) {
      page.innerHTML = '<h2 style="font-size:1.4em;font-weight:700;margin-bottom:4px;">Strategy Summary &amp; Optimization</h2>' +
        '<p class="subtitle">Run the Decision Engine on the Projection page to populate the strategy summary.</p>' +
        '<div class="section-title" style="margin-top:24px;">Tax Savings Comparison</div>' + taxHostHtml +
        '<div class="section-title" style="margin-top:24px;">Allocator Detail</div>' + allocHtml;
      return;
    }

    var cfg = result.config || {};
    var y1 = result.years[0] || {};
    var totals = result.totals || {};

    var html = '';
    html += '<h2 style="font-size:1.4em;font-weight:700;margin-bottom:4px;">Strategy Summary &amp; Optimization</h2>' +
            '<p class="subtitle" style="margin-bottom:20px;">Optimized tax strategy allocation based on your inputs.</p>';

    var custCtx = _buildCustodianContext(cfg);
    if (custCtx) html += custCtx;
    html += _buildBaselineTable(cfg, y1);
    html += _buildPlanningTable(cfg, y1, recommendation);
    html += _buildMultiYearTable(result.years);
    html += _buildROITable(cfg, y1, totals);
    html += _buildBreakdownCard(cfg, y1, recommendation);

    // Existing renderers preserved
    html += '<div class="section-title" style="margin-top:24px;">Tax Savings Comparison</div>' + taxHostHtml;
    html += '<div class="section-title" style="margin-top:24px;">Allocator Detail</div>' + allocHtml;

    // Action buttons
    html += '<div style="margin-top:30px;display:flex;gap:15px;">' +
      '<button class="btn btn-primary" id="ss-recalc">Recalculate</button>' +
      '<button class="btn btn-secondary" id="ss-export">Export Report</button>' +
      '</div>';

    page.innerHTML = html;

    // Re-render the tax-comparison renderer if present.
    try {
      var host = document.getElementById('tax-comparison-host');
      if (host && typeof renderTaxComparison === 'function' && comparison) {
        renderTaxComparison(host, comparison);
      }
    } catch (e) { /* noop */ }
    // Re-render the allocator if available.
    try {
      var allocOut = document.getElementById('allocator-output');
      if (allocOut && typeof renderAllocator === 'function' && window.__lastAllocation) {
        renderAllocator(window.__lastAllocation);
      }
    } catch (e) { /* noop */ }

    // Wire buttons
    var recalc = document.getElementById('ss-recalc');
    if (recalc) recalc.addEventListener('click', function () {
      var recBtn = document.getElementById('run-recommendation');
      if (recBtn) recBtn.click();
      setTimeout(renderStrategySummary, 100);
    });
    var exp = document.getElementById('ss-export');
    if (exp) exp.addEventListener('click', function () {
      try {
        var blob = new Blob([page.innerText], { type: 'text/plain' });
        var url = URL.createObjectURL(blob);
        var a = document.createElement('a');
        a.href = url;
        a.download = 'rett-strategy-summary-' + (new Date()).toISOString().split('T')[0] + '.txt';
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
      } catch (e) { alert('Export failed: ' + (e && e.message)); }
    });
  }

  root.renderStrategySummary = renderStrategySummary;
})(window);
