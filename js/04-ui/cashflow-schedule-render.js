// FILE: js/04-ui/cashflow-schedule-render.js
// Below the Multi-Year Snapshot on Page 2, render two coordinated
// year-by-year tables that tell the cash-flow story:
//
//   1) Brooklyn Investment Schedule
//      How much capital sits in Brooklyn each year. Starts at the
//      cost basis on engagement and steps up when recognized gain
//      proceeds are released from the structured sale and reinvested.
//
//   2) Structured-Sale Schedule
//      How much of the original gain remains locked in the
//      structured-sale agreement, and the dollar amount + date of
//      each scheduled release. Lets the advisor walk a client
//      through the timing: "$5M held in the structured sale until
//      Jan 1, 2028, then released and immediately reinvested into
//      Brooklyn."
//
// Reads from window.__lastComparison (built by tax-comparison.js's
// computeDeferredTaxComparison or computeTaxComparison) and the
// projection cfg. Public entry point: renderCashflowSchedule().

(function (root) {
  'use strict';

  function _fmt(n) {
    if (n == null || !isFinite(n)) return '\u2014';
    if (typeof fmtUSD === 'function') return fmtUSD(n);
    var sign = n < 0 ? '-' : '';
    var v = Math.round(Math.abs(n));
    return sign + '$' + v.toLocaleString('en-US');
  }

  function _section(title, body, sub) {
    var subHtml = sub ? '<p class="subtitle muted" style="margin-bottom:6px;">' + sub + '</p>' : '';
    return '<h3 class="section-title" style="margin-top:24px;">' + title + '</h3>' +
           subHtml +
           '<div class="rett-table-wrap rett-table-scroll">' +
             '<table class="rett-data-table rett-data-table-frozen">' + body + '</table>' +
           '</div>';
  }

  // Build the year-by-year cashflow rows from a comparison's
  // recognitionSchedule + investmentThisYear. For the immediate path
  // (no recognitionSchedule), we synthesize a single Year-1 recognition.
  function _buildScheduleRows(cfg, comp, years) {
    if (!comp || !Array.isArray(comp.rows)) return [];
    var year1 = (cfg && cfg.year1) || (years[0] && years[0].year) || (new Date()).getFullYear();
    var totalLT = Math.max(0,
      (cfg.salePrice || 0) - (cfg.costBasis || 0) - (cfg.acceleratedDepreciation || 0));
    var recapture = Math.max(0, cfg.acceleratedDepreciation || 0);
    var totalGain = totalLT + recapture;
    var basis = Math.max(0, cfg.costBasis || 0);

    // recognitionSchedule (deferred path): array of {year, gainRecognized}.
    // For immediate path we synthesize: full gain in Year 1.
    var recSched = (comp.recognitionSchedule && comp.recognitionSchedule.length)
      ? comp.recognitionSchedule
      : comp.rows.map(function (r, idx) {
          return {
            year: r.year,
            gainRecognized: idx === 0 ? totalGain : 0
          };
        });

    var rows = [];
    var cumulativeRecognized = 0;
    var ssBalanceStart = totalGain;
    for (var i = 0; i < recSched.length; i++) {
      var rec = recSched[i];
      var year = rec.year || (year1 + i);
      var recThisYear = rec.gainRecognized || 0;
      var ssBalanceEnd = Math.max(0, ssBalanceStart - recThisYear);
      // Brooklyn invested this year — pull from comp.rows when
      // available (tracks tranche reinvestment); otherwise derive.
      var compRow = comp.rows[i] || {};
      var brookInvested = compRow.investmentThisYear != null
        ? compRow.investmentThisYear
        : (i === 0 ? basis : basis + cumulativeRecognized);
      rows.push({
        year: year,
        brookInvested: brookInvested,
        ssBalanceStart: ssBalanceStart,
        ssBalanceEnd: ssBalanceEnd,
        gainRecognized: recThisYear,
        recognizedDate: recThisYear > 0 ? ('Jan 1, ' + year) : ''
      });
      cumulativeRecognized += recThisYear;
      ssBalanceStart = ssBalanceEnd;
    }
    return rows;
  }

  function _buildBrooklynTable(rows) {
    if (!rows.length) return '';
    var head = '<thead><tr>' +
      '<th>Year</th>' +
      '<th>Brooklyn Investment</th>' +
      '<th>Change vs Prior Year</th>' +
    '</tr></thead>';
    var body = '<tbody>';
    var prev = 0;
    rows.forEach(function (r) {
      var delta = r.brookInvested - prev;
      var deltaCell = delta > 0
        ? '<span class="rett-delta-positive">+' + _fmt(delta) + '</span>'
        : (delta < 0 ? '<span class="rett-delta-negative">' + _fmt(delta) + '</span>' : '\u2014');
      body += '<tr>' +
        '<td>' + r.year + '</td>' +
        '<td>' + _fmt(r.brookInvested) + '</td>' +
        '<td>' + deltaCell + '</td>' +
      '</tr>';
      prev = r.brookInvested;
    });
    body += '</tbody>';
    return head + body;
  }

  function _buildStructuredSaleTable(rows) {
    if (!rows.length) return '';
    var head = '<thead><tr>' +
      '<th>Year</th>' +
      '<th>Locked at Year Start</th>' +
      '<th>Released Jan 1</th>' +
      '<th>Locked at Year End</th>' +
    '</tr></thead>';
    var body = '<tbody>';
    rows.forEach(function (r) {
      var releasedCell = r.gainRecognized > 0
        ? _fmt(r.gainRecognized) + ' <span class="muted">(' + r.recognizedDate + ')</span>'
        : '\u2014';
      body += '<tr>' +
        '<td>' + r.year + '</td>' +
        '<td>' + _fmt(r.ssBalanceStart) + '</td>' +
        '<td>' + releasedCell + '</td>' +
        '<td>' + _fmt(r.ssBalanceEnd) + '</td>' +
      '</tr>';
    });
    body += '</tbody>';
    return head + body;
  }

  function renderCashflowSchedule(host) {
    host = host || document.getElementById('cashflow-schedule-host');
    if (!host) return;
    var result = window.__lastResult;
    var comp = window.__lastComparison;
    if (!result || !result.years || !result.years.length || !comp) {
      host.innerHTML = '';
      return;
    }
    var cfg = result.config || {};
    // Patch in the property-sale fields (the projection-engine result
    // doesn't always carry them on cfg).
    cfg.salePrice = cfg.salePrice
      || Number((document.getElementById('sale-price') || {}).value) || 0;
    cfg.costBasis = cfg.costBasis
      || Number((document.getElementById('cost-basis') || {}).value) || 0;
    cfg.acceleratedDepreciation = cfg.acceleratedDepreciation
      || Number((document.getElementById('accelerated-depreciation') || {}).value) || 0;

    var rows = _buildScheduleRows(cfg, comp, result.years);
    if (!rows.length) {
      host.innerHTML = '';
      return;
    }

    // Total locked in the structured sale = LT capital gain + recapture.
    // Must match _buildScheduleRows so the subtitle reconciles with the
    // Locked-at-Year-Start column. Previously this subtitle used
    // (salePrice - costBasis) which double-counted the depreciation
    // recapture portion when accelerated-depreciation > 0.
    var _totalLT = Math.max(0,
      (cfg.salePrice || 0) - (cfg.costBasis || 0) - (cfg.acceleratedDepreciation || 0));
    var totalGain = _totalLT + Math.max(0, cfg.acceleratedDepreciation || 0);
    var brookSub = 'Capital sitting in Brooklyn each year. Starts at the cost basis (' +
      _fmt(cfg.costBasis || 0) +
      ') and steps up when recognized gain is released from the structured sale and reinvested.';
    var ssSub = 'Total gain held in the structured-sale agreement (' + _fmt(totalGain) + '). ' +
      'Releases happen on Jan 1 of each scheduled year so the cash works in Brooklyn for the full following year.';

    host.innerHTML =
      _section('Brooklyn Investment Schedule', _buildBrooklynTable(rows), brookSub) +
      _section('Structured-Sale Schedule',     _buildStructuredSaleTable(rows), ssSub);
  }

  root.renderCashflowSchedule = renderCashflowSchedule;
})(window);
