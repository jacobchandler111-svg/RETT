// FILE: js/04-ui/strategy-summary-render.js
// Strategy Summary page renderer. Ported from the original Brookhaven
// Strategy Summary page and adapted to RETT's Brooklyn-only multi-year
// model. Custodian context intentionally removed (handled on Page 1).
//
// Sections rendered (top to bottom):
//   0. Header
//   1. Baseline (Without Tax Planning) - Year 1
//   2. With Tax Planning - Year 1
//   3. Multi-Year Tax Savings (year-by-year)
//   4. Return on Planning (Year 1, with fees)
//   5. Strategy Breakdown card
//   6. Tax Savings Comparison (existing renderer)
//   7. Allocator Detail (existing renderer)
//   8. Recalculate / Export buttons
//
// All sections use the .section-title pattern (blue left-bar) to match
// Pages 1 and 2.
//
// Public entry point: renderStrategySummary() - reads window.__lastResult /
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
    var m = {
      single:'Single', mfj:'Married Filing Jointly',
      mfs:'Married Filing Separately', hoh:'Head of Household'
    };
    return m[f] || f || '—';
  }

  // Wrap a table block in the standard RETT section pattern.
  function _section(titleText, innerHtml) {
    return '<div class="section-title">' + titleText + '</div>' +
           '<div class="rett-table-wrap">' + innerHtml + '</div>';
  }

  function _kvTable(rows) {
    return '<table class="rett-kv-table"><tbody>' + rows + '</tbody></table>';
  }

  // Build Table 1: Baseline (Without Tax Planning) for Year 1.
  function _buildBaselineTable(cfg, y1) {
    var grossSale = Number(cfg.salePrice) || 0;
    var fed = y1.fedTaxNoBrooklyn || 0;
    var st = y1.stateTaxNoBrooklyn || 0;
    var total = (y1.taxNoBrooklyn != null) ? y1.taxNoBrooklyn : (fed + st);
    var agi = (y1.ordinary || 0) + (y1.shortGain || 0) + (y1.longGain || 0);
    var taxPctSale = grossSale > 0 ? (total / grossSale * 100) : null;
    var afterTax = agi - total;
    var effRate = agi > 0 ? (total / agi * 100) : null;
    var rows = '' +
      '<tr><td>Tax Year</td><td>' + y1.year + '</td></tr>' +
      '<tr><td>Filing Status</td><td>' + _filingLabel(cfg.filingStatus) + '</td></tr>' +
      '<tr><td>State</td><td>' + (cfg.state || '—') + '</td></tr>' +
      '<tr><td>Gross Sales Proceeds</td><td>' + _fmt(grossSale) + '</td></tr>' +
      '<tr><td>Federal Tax Due</td><td>' + _fmt(fed) + '</td></tr>' +
      '<tr><td>State Tax Due</td><td>' + _fmt(st) + '</td></tr>' +
      '<tr class="rett-total-row"><td>Total Tax Due</td><td>' + _fmt(total) + '</td></tr>' +
      '<tr><td>Tax as % of Sale</td><td>' + _pct(taxPctSale) + '</td></tr>' +
      '<tr><td>After-Tax Income</td><td>' + _fmt(afterTax) + '</td></tr>' +
      '<tr class="rett-total-row"><td>Effective Tax Rate</td><td>' + _pct(effRate) + '</td></tr>';
    return _section('Baseline — Without Tax Planning', _kvTable(rows));
  }

  // Build Table 2: With Tax Planning (Year 1).
  function _buildPlanningTable(cfg, y1, recommendation) {
    var fedW = y1.fedTaxWithBrooklyn;
    var stW = y1.stateTaxWithBrooklyn;
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
    var rows = '' +
      '<tr><td>Strategy</td><td>' + _strategyLabel(cfg.tierKey || cfg.strategyKey) + '</td></tr>' +
      '<tr><td>Solver Source</td><td>' + srcLabel + '</td></tr>' +
      '<tr><td>Leverage Applied</td><td>' + (lev != null ? lev.toFixed(2)+'x' : '—') + '</td></tr>' +
      '<tr><td>Loss Rate (interpolated)</td><td>' + lossRate + '</td></tr>' +
      '<tr><td>Investment</td><td>' + _fmt(y1.investmentThisYear) + '</td></tr>' +
      '<tr><td>Short-Term Losses Generated</td><td>' + _fmt(y1.grossLoss) + '</td></tr>' +
      '<tr><td>Brooklyn Fee (Year 1)</td><td>' + _fmt(y1.fee) + '</td></tr>' +
      '<tr><td>Federal Tax (with strategy)</td><td>' + _fmt(fedW) + '</td></tr>' +
      '<tr><td>State Tax (with strategy)</td><td>' + _fmt(stW) + '</td></tr>' +
      '<tr class="rett-total-row"><td>Total Tax (with strategy)</td><td>' + _fmt(totalWith) + '</td></tr>' +
      '<tr><td>New Effective Rate</td><td>' + _pct(newRate) + '</td></tr>' +
      '<tr class="rett-savings-row"><td>Year-1 Tax Savings</td><td>' + _fmt(totalNo - totalWith) + '</td></tr>';
    return _section('With Tax Planning', _kvTable(rows));
  }

  // Build the Multi-Year Savings table (RETT-specific extension).
  function _buildMultiYearTable(years) {
    if (!years || !years.length) return '';
    var head = '<tr>' +
      '<th>Year</th><th>Tax Without</th><th>Tax With</th><th>Savings</th><th>Investment</th><th>Loss Generated</th>' +
      '</tr>';
    var body = '';
    var cumNo = 0, cumWith = 0, cumSave = 0, cumInv = 0, cumLoss = 0;
    years.forEach(function (y) {
      var no = y.taxNoBrooklyn || 0;
      var w = (y.taxWithBrooklyn != null) ? y.taxWithBrooklyn : no;
      var save = no - w;
      cumNo += no; cumWith += w; cumSave += save;
      cumInv += (y.investmentThisYear || 0);
      cumLoss += (y.grossLoss || 0);
      body += '<tr>' +
        '<td>' + y.year + '</td>' +
        '<td>' + _fmt(no) + '</td>' +
        '<td>' + _fmt(w) + '</td>' +
        '<td class="rett-savings-cell">' + _fmt(save) + '</td>' +
        '<td>' + _fmt(y.investmentThisYear) + '</td>' +
        '<td>' + _fmt(y.grossLoss) + '</td>' +
        '</tr>';
    });
    body += '<tr class="rett-total-row">' +
      '<td>Total</td>' +
      '<td>' + _fmt(cumNo) + '</td>' +
      '<td>' + _fmt(cumWith) + '</td>' +
      '<td class="rett-savings-cell">' + _fmt(cumSave) + '</td>' +
      '<td>' + _fmt(cumInv) + '</td>' +
      '<td>' + _fmt(cumLoss) + '</td>' +
      '</tr>';
    var tableHtml = '<table class="rett-data-table"><thead>' + head + '</thead><tbody>' + body + '</tbody></table>';
    return _section('Multi-Year Tax Savings', tableHtml);
  }

  // Build Table 3: Return on Planning (Year 1, with fees).
  function _buildROITable(cfg, y1, totals) {
    var no = y1.taxNoBrooklyn || 0;
    var w = (y1.taxWithBrooklyn != null) ? y1.taxWithBrooklyn : no;
    var savings = no - w;
    var brooklynFeeY1 = y1.fee || 0;
    var totalFees = totals && totals.cumulativeFees != null ? totals.cumulativeFees : brooklynFeeY1;
    var net = savings - brooklynFeeY1;
    var roi = brooklynFeeY1 > 0 ? (net / brooklynFeeY1 * 100) : (savings > 0 ? Infinity : 0);
    var roiTxt = isFinite(roi) ? roi.toFixed(1) + '%' : '∞';
    var rows = '' +
      '<tr><td>Tax Without Planning (Year 1)</td><td>' + _fmt(no) + '</td></tr>' +
      '<tr><td>Tax With Planning (Year 1)</td><td>' + _fmt(w) + '</td></tr>' +
      '<tr class="rett-savings-row"><td>Year-1 Tax Savings</td><td>' + _fmt(savings) + '</td></tr>' +
      '<tr><td>Brooklyn Strategy Fee (Year 1)</td><td>' + _fmt(brooklynFeeY1) + '</td></tr>' +
      '<tr><td>Cumulative Fees (horizon)</td><td>' + _fmt(totalFees) + '</td></tr>' +
      '<tr class="rett-savings-row"><td>Net Savings After Year-1 Fees</td><td>' + _fmt(net) + '</td></tr>' +
      '<tr class="rett-total-row"><td>Return on Year-1 Planning (Net Savings / Fees)</td><td>' + roiTxt + '</td></tr>';
    return _section('Return on Planning', _kvTable(rows));
  }

  // Build Strategy Breakdown card (single-card RETT version).
  function _buildBreakdownCard(cfg, y1, recommendation) {
    var no = y1.taxNoBrooklyn || 0;
    var w = (y1.taxWithBrooklyn != null) ? y1.taxWithBrooklyn : no;
    var savings = no - w;
    var lev = recommendation && recommendation.summary ? recommendation.summary.leverage : null;
    var detail = _strategyLabel(cfg.tierKey || cfg.strategyKey) +
                 (lev != null ? ' • Leverage ' + lev.toFixed(2) + 'x' : '') +
                 ' • Investment ' + _fmt(y1.investmentThisYear);
    var inner =
      '<div class="rett-strategy-card">' +
        '<div class="rett-strategy-card-title">Brooklyn Tax Loss Harvesting</div>' +
        '<div class="rett-strategy-card-detail">' + detail + '</div>' +
        '<div class="rett-strategy-card-savings">' + _fmt(savings) + ' saved (Year 1)</div>' +
      '</div>';
    return _section('Strategy Breakdown', inner);
  }

  // Build the hero savings tile shown at the top of the Strategy Summary
  // page. Single dominant number — total cumulative tax savings — with a
  // smaller sub-line showing fees and net benefit. Pattern borrowed from
  // Holistiplan / Instead (formerly Corvee): one big "savings result"
  // callout that anchors the page.
  function _buildHeroSavingsTile(years, totals) {
    // Source-of-truth resolution mirrors the savings ribbon and KPI
    // tiles: prefer the comparison rows (which apply the structured-
    // sale recommendation) over the projection engine's raw deltas.
    // Without this, the hero on Page 3 disagreed with the ribbon on
    // Page 2 for the same scenario.
    var totalSave = 0, cumFees = 0;
    var comp = window.__lastComparison;
    if (comp && Array.isArray(comp.rows) && comp.rows.length) {
      if (comp.totalSavings != null) {
        totalSave = comp.totalSavings;
      } else {
        comp.rows.forEach(function (r) { totalSave += (r.savings || 0); });
      }
      // Deferred comparisons own their per-year fees (reinvested gain
      // tranche). Trust comp.totalFees when present; otherwise fall back
      // to the projection-engine years array.
      if (comp.deferred && comp.totalFees != null) {
        cumFees = comp.totalFees;
      } else {
        (years || []).forEach(function (y) { cumFees += (y.fee || 0); });
      }
    } else {
      (years || []).forEach(function (y) {
        var no = y.taxNoBrooklyn || 0;
        var w = (y.taxWithBrooklyn != null) ? y.taxWithBrooklyn : no;
        totalSave += (no - w);
        cumFees += (y.fee || 0);
      });
    }
    if (!(comp && comp.deferred) && totals && totals.cumulativeFees != null) cumFees = totals.cumulativeFees;
    var brookhavenFees = (comp && comp.totalBrookhavenFees) || 0;
    var net = totalSave - cumFees - brookhavenFees;
    var horizon = (years && years.length) ? years.length : 0;

    var heroKind = totalSave > 0 ? 'hero-positive' : (totalSave < 0 ? 'hero-negative' : '');
    var sign = totalSave > 0 ? '+' : (totalSave < 0 ? '\u2212' : '');
    var displayAmount = sign + _fmt(Math.abs(totalSave)).replace('-', '');

    var brookhavenLine = brookhavenFees > 0
      ? ' \u2022 Brookhaven fees: ' + _fmt(brookhavenFees)
      : '';
    return '<div class="rett-hero-tile ' + heroKind + '" role="status" aria-live="polite">' +
      '<div class="rett-hero-label">Estimated Tax Savings</div>' +
      '<div class="rett-hero-value">' + displayAmount + '</div>' +
      '<div class="rett-hero-sub">' +
        'Cumulative over ' + horizon + ' year' + (horizon === 1 ? '' : 's') +
        ' \u2022 Net of fees: <strong>' + _fmt(net) + '</strong>' +
        ' \u2022 Brooklyn fees: ' + _fmt(cumFees) +
        brookhavenLine +
      '</div>' +
    '</div>';
  }

  // Public entry point. Reads result + comparison from globals stored by controls.js.
  function renderStrategySummary() {
    var page = document.getElementById('page-allocator');
    if (!page) return;

    var result = window.__lastResult;
    var recommendation = window.__lastRecommendation;
    var comparison = window.__lastComparison;

    var existingTaxHost = page.querySelector('#tax-comparison-host');
    var existingAllocator = page.querySelector('#allocator-output');
    var taxHostHtml = existingTaxHost ? existingTaxHost.outerHTML : '<div id="tax-comparison-host"></div>';
    var allocHtml = existingAllocator ? existingAllocator.outerHTML : '<div id="allocator-output"></div>';

    if ((!result || !result.years || !result.years.length) &&
        typeof collectInputs === 'function' &&
        typeof ProjectionEngine !== 'undefined' && ProjectionEngine.run) {
      try {
        var cfgOnDemand = collectInputs();
        var sp = Number((document.getElementById('sale-price') || {}).value) || 0;
        var cb = Number((document.getElementById('cost-basis') || {}).value) || 0;
        var ad = Number((document.getElementById('accelerated-depreciation') || {}).value) || 0;
        if (sp) cfgOnDemand.salePrice = sp;
        if (cb) cfgOnDemand.costBasis = cb;
        if (ad) cfgOnDemand.acceleratedDepreciation = ad;
        cfgOnDemand.strategyKey = cfgOnDemand.tierKey;
        cfgOnDemand.investedCapital = cfgOnDemand.investment;
        cfgOnDemand.years = cfgOnDemand.horizonYears;
        result = ProjectionEngine.run(cfgOnDemand);
        window.__lastResult = result;
        if (!recommendation && typeof recommendSale === 'function') {
          recommendation = recommendSale(cfgOnDemand);
          window.__lastRecommendation = recommendation;
        }
      } catch (e) {
        console.warn('Strategy summary on-demand run failed:', e && e.message);
      }
    }

    if (!result || !result.years || !result.years.length) {
      page.innerHTML =
        '<h2 class="page-title">Strategy Summary &amp; Optimization</h2>' +
        '<p class="subtitle">Run the Decision Engine on the Projection page to populate the strategy summary.</p>' +
        '<div class="section-title">Tax Savings Comparison</div>' + taxHostHtml +
        '<div class="section-title">Allocator Detail</div>' + allocHtml;
      return;
    }

    var cfg = result.config || {};
    var y1 = result.years[0] || {};
    var totals = result.totals || {};

    var html = '';
    html += '<h2 class="page-title">Strategy Summary &amp; Optimization</h2>' +
            '<p class="subtitle">Optimized tax strategy allocation based on your inputs.</p>';

    html += _buildHeroSavingsTile(result.years, totals);

    html += _buildBaselineTable(cfg, y1);
    html += _buildPlanningTable(cfg, y1, recommendation);
    html += _buildMultiYearTable(result.years);
    html += _buildROITable(cfg, y1, totals);
    html += _buildBreakdownCard(cfg, y1, recommendation);

    html += '<div class="section-title">Tax Savings Comparison</div>' + taxHostHtml;
    html += '<div class="section-title">Allocator Detail</div>' + allocHtml;

    html += '<div class="rett-action-row">' +
            '<button type="button" class="btn btn-primary" id="ss-print" title="Open the browser print dialog. Choose &ldquo;Save as PDF&rdquo; to download a client-ready report.">Print / Save as PDF</button>' +
            '<button type="button" class="btn btn-secondary" id="ss-recalc">Recalculate</button>' +
            '</div>';

    page.innerHTML = html;

    // Animate the hero savings tile + any other numeric values on this page.
    if (typeof window.animateRettNumbers === 'function') {
      try { window.animateRettNumbers(page); } catch (e) { if (typeof window !== "undefined" && typeof window.reportFailure === "function") window.reportFailure("non-fatal in strategy-summary-render.js", e); else if (typeof console !== "undefined") console.warn(e); }
    }

    try {
      var host = document.getElementById('tax-comparison-host');
      if (host && typeof renderTaxComparison === 'function' && comparison) {
        renderTaxComparison(host, comparison);
      }
    } catch (e) { /* noop */ }

    try {
      var allocOut = document.getElementById('allocator-output');
      if (allocOut && typeof renderAllocator === 'function' && window.__lastAllocation) {
        renderAllocator(window.__lastAllocation);
      }
    } catch (e) { /* noop */ }

    var recalc = document.getElementById('ss-recalc');
    if (recalc) recalc.addEventListener('click', function () {
      // Run the full pipeline synchronously (it has no real async work
      // — pill-toggles.runAutoPick is blocking) and immediately
      // re-render the Strategy Summary. The previous setTimeout(100)
      // was a guess that would become a flaky race if the pipeline
      // ever moves to a Web Worker.
      if (typeof window.runFullPipeline === 'function') {
        try { window.runFullPipeline(); } catch (e) {
          if (typeof window.reportFailure === 'function') window.reportFailure('non-fatal in strategy-summary-render.js', e);
          else if (typeof console !== 'undefined') console.warn(e);
        }
      }
      renderStrategySummary();
    });
    var printBtn = document.getElementById('ss-print');
    if (printBtn) printBtn.addEventListener('click', function () {
      // Mark the body so the print stylesheet can render a branded header,
      // hide navigation chrome, and ensure only the Strategy Summary prints.
      document.body.classList.add('printing-report');
      // Surface the loaded case name (if any) into a data attribute the
      // print CSS can pick up via attr() — produces a "Prepared for: <name>"
      // line at the top of the printed report.
      var caseName = '';
      if (window.RETTCaseStorage && typeof window.RETTCaseStorage.getCurrentCaseName === 'function') {
        caseName = window.RETTCaseStorage.getCurrentCaseName() || '';
      }
      if (caseName) {
        document.body.setAttribute('data-case-name', caseName);
      } else {
        document.body.removeAttribute('data-case-name');
      }
      // Temporarily set the print title (becomes the PDF filename suggestion).
      var prevTitle = document.title;
      var todayIso = (new Date()).toISOString().split('T')[0];
      document.title = caseName
        ? ('RETT - ' + caseName + ' - ' + todayIso)
        : ('RETT Strategy Summary - ' + todayIso);
      var cleanup = function () {
        document.body.classList.remove('printing-report');
        document.body.removeAttribute('data-case-name');
        document.title = prevTitle;
        window.removeEventListener('afterprint', cleanup);
      };
      window.addEventListener('afterprint', cleanup);
      try {
        window.print();
      } catch (e) {
        cleanup();
        alert('Print failed: ' + (e && e.message));
      }
    });
  }

  root.renderStrategySummary = renderStrategySummary;
})(window);
