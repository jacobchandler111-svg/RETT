// js/04-ui/admin-math-page-temp.js
//
// Admin math reveal panel — Tab 7 (Temporary).
//
// Tranche x Year loss-generation matrix (advisor 2026-05-27). For each
// installment-style strategy (B = §453 installment, C = structured
// installment) this lays the Brooklyn loss math out the way the advisor
// reasons about it:
//
//   ROWS    = tax years (Year 0 .. Year 5)
//   COLUMNS = tranches (each a separate deposit into Brooklyn)
//   CELL    = the short-term loss that tranche generated in that year
//
// Each tranche column shows the capital deposited and the combo it
// operates under. A cell's loss = capital x age-rate x year-fraction,
// where:
//   • the Y0 (sale-close) tranche opens mid-year, so EVERY year it
//     day-weights two adjacent age-rates by the 365-day model
//     (e.g. Jul 1 open → Y1 = 0.50·r0 + 0.50·r1);
//   • Jan-1 installment tranches run full integer-age rates;
//   • when cumulative deposits cross a combo minimum ($1M → 145/45,
//     $3M → 200/100) ALL active tranches migrate to the higher combo
//     at their current age.
(function (root) {
  'use strict';
  if (typeof root._registerPageMath !== 'function') return;

  function _esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  function _fmtUSD(n) {
    if (typeof root._fmt === 'function') return root._fmt(n);
    var v = Number(n);
    if (!isFinite(v)) return String(n);
    return (v < 0 ? '-' : '') + '$' + Math.round(Math.abs(v)).toLocaleString('en-US');
  }
  function _num(v) { var n = Number(v); return isFinite(n) ? n : 0; }
  function _comboLabel(comboId) {
    if (!comboId) return '—';
    if (comboId.indexOf('200_100') !== -1) return '200/100';
    if (comboId.indexOf('145_45') !== -1) return '145/45';
    if (typeof root.getSchwabCombo === 'function') {
      var c = root.getSchwabCombo(comboId);
      if (c) return c.leverageLabel;
    }
    return comboId;
  }

  // The 365-day staggering math behind a cell's blended loss rate. The Y0
  // sale-close tranche opens mid-year, so it keeps a mid-year anniversary
  // every year and each tax year day-weights two adjacent age-rates
  // (advisor 2026-05-28). Renders the components, e.g.:
  //   • Jan-1 tranche / full year → "32.2%"  (single integer-age rate)
  //   • mid-year open, first year → "32.2%×0.84"  (age-0 rate × days open)
  //   • straddle year            → "32.2%×0.16 + 26.8%×0.84"
  //     (prior age-rate for the pre-anniversary days + current for the rest)
  function _lossComposition(rec) {
    var yf   = (rec.lossYf != null) ? Number(rec.lossYf) : 1;
    var curr = (Number(rec.lossCurrRate) || 0) * 100;
    var prev = (Number(rec.lossPrevRate) || 0) * 100;
    var age  = rec.age | 0;
    if (rec.lossCurrRate == null) {                 // older engine row → no parts
      return (rec.lossRate != null) ? (rec.lossRate * 100).toFixed(2) + '%' : '';
    }
    if (yf >= 0.9999) return curr.toFixed(1) + '%';                       // Jan-1 / full-year rate
    if (age === 0)    return curr.toFixed(1) + '%&times;' + yf.toFixed(3); // mid-year first partial year
    return prev.toFixed(1) + '%&times;' + (1 - yf).toFixed(3) +
           ' + ' + curr.toFixed(1) + '%&times;' + yf.toFixed(3);          // straddle year
  }

  // Pivot the engine's per-row trancheBreakdown into a tranche x year
  // grid. Returns { years[], tranches[], cell(trancheKey, year) }.
  function _pivot(cmp) {
    var rows = cmp.rows || [];
    var years = rows.map(function (r) { return r.year; });
    var trancheMap = {};      // key -> { key, idx, openYear, capital, perYear:{year->record} }
    var order = [];
    rows.forEach(function (r) {
      (r.trancheBreakdown || []).forEach(function (tr) {
        var key = tr.trancheIdx + '|' + tr.openYear;
        if (!(key in trancheMap)) {
          trancheMap[key] = {
            key: key, idx: tr.trancheIdx, openYear: tr.openYear,
            capital: tr.capital, perYear: {}
          };
          order.push(key);
        }
        trancheMap[key].perYear[r.year] = tr;
      });
    });
    return { years: years, order: order, map: trancheMap };
  }

  function _matrixTable(cmp) {
    var piv = _pivot(cmp);
    if (!piv.order.length) {
      return '<p class="admin-math-empty">No Brooklyn tranches deployed for this strategy ' +
        '(below custodian min, or no engagement).</p>';
    }

    var years = piv.years;
    var nCols = piv.order.length;

    // ----- Header row: Year | Tranche 0 | Tranche 1 | ... | Year total -----
    var html =
      '<div class="admin-math-scroll">' +
      '<table class="admin-math-table admin-math-table-wide">' +
      '<thead><tr>' +
        '<th>Year</th>';
    piv.order.forEach(function (key, i) {
      html += '<th class="admin-math-num">Tranche ' + i + '</th>';
    });
    html += '<th class="admin-math-num">Year total</th></tr></thead><tbody>';

    // ----- Capital row -----
    html += '<tr class="admin-math-subtotal"><td><strong>Capital deposited</strong></td>';
    var grandCapital = 0;
    piv.order.forEach(function (key) {
      var t = piv.map[key];
      grandCapital += _num(t.capital);
      html += '<td class="admin-math-num"><strong>' + _fmtUSD(t.capital) + '</strong></td>';
    });
    html += '<td class="admin-math-num"><strong>' + _fmtUSD(grandCapital) + '</strong></td></tr>';

    // ----- Opened-year row -----
    html += '<tr><td>Opened</td>';
    piv.order.forEach(function (key) {
      html += '<td class="admin-math-num">' + _esc(piv.map[key].openYear) + '</td>';
    });
    html += '<td></td></tr>';

    // ----- Per-year loss rows -----
    var colTotals = {};
    piv.order.forEach(function (key) { colTotals[key] = 0; });
    var grandLoss = 0;

    years.forEach(function (yr, yIdx) {
      html += '<tr><td><strong>Year ' + yIdx + '</strong> (' + _esc(yr) + ')</td>';
      var rowTotal = 0;
      piv.order.forEach(function (key) {
        var rec = piv.map[key].perYear[yr];
        if (rec && rec.loss > 0.5) {
          var loss = _num(rec.loss);
          rowTotal += loss;
          colTotals[key] += loss;
          var blended = (rec.lossRate != null) ? (rec.lossRate * 100).toFixed(2) + '%' : '';
          var comp = _lossComposition(rec);            // day-weighted breakdown (365-day)
          var combo = _comboLabel(rec.comboId);
          var ann = comp.replace(/&times;/g, '×') + ' = ' + blended + ' · ' + combo + ' · age ' + rec.age;
          html += '<td class="admin-math-num" title="' + _esc(ann) + '">' +
            _fmtUSD(loss) +
            '<br><span style="font-size:0.74em;color:var(--ink-soft,#888);">' + comp + '</span>' +
            '<br><span style="font-size:0.72em;color:var(--ink-soft,#aaa);">= ' + blended + ' · ' + combo + '</span>' +
            '</td>';
        } else {
          html += '<td class="admin-math-num" style="color:#bbb;">—</td>';
        }
      });
      grandLoss += rowTotal;
      html += '<td class="admin-math-num"><strong>' + _fmtUSD(rowTotal) + '</strong></td></tr>';
    });

    // ----- Tranche total row -----
    html += '<tr class="admin-math-total"><td><strong>Tranche total loss</strong></td>';
    piv.order.forEach(function (key) {
      html += '<td class="admin-math-num"><strong>' + _fmtUSD(colTotals[key]) + '</strong></td>';
    });
    html += '<td class="admin-math-num"><strong>' + _fmtUSD(grandLoss) + '</strong></td></tr>';

    html += '</tbody></table></div>';
    return html;
  }

  function _strategyBlock(letter, name, summary) {
    var entry = (summary.entries || []).find(function (e) { return e.type === letter; });
    if (!entry) {
      return '<div class="admin-math-section"><h4>Strategy ' + letter + ' &mdash; ' + _esc(name) + '</h4>' +
        '<p class="admin-math-empty">Strategy not available for these inputs.</p></div>';
    }
    // Reflect the optimizer's partial-investment dial-back: build the
    // tranche matrix at the DEPLOYED capital, not full available. Without
    // this the matrix showed every tranche at full deployment (e.g. the
    // whole $5M) even when the strategy only deploys the dialed-back amount
    // — inconsistent with the client temp page + comparison cards (2026-05-28).
    var ecfg = entry.cfg;
    var pd = entry._partialDeploy;
    if (pd && Number.isFinite(Number(pd.deployed)) &&
        Math.round(Number(pd.deployed)) !== Math.round(Number(ecfg.availableCapital) || 0)) {
      var _dep = Math.max(0, Math.round(Number(pd.deployed)));
      ecfg = Object.assign({}, ecfg, { availableCapital: _dep, investment: _dep, investedCapital: _dep });
    }
    var cmp = null;
    if (ecfg && typeof root.unifiedTaxComparison === 'function') {
      try { cmp = root.unifiedTaxComparison(ecfg, { includeTrancheBreakdown: true }); }
      catch (e) { cmp = null; }
    }
    if (!cmp) {
      return '<div class="admin-math-section"><h4>Strategy ' + letter + ' &mdash; ' + _esc(name) + '</h4>' +
        '<p class="admin-math-error">Engine did not return a comparison.</p></div>';
    }
    var y0Down = _num(entry.cfg.y0DownPayment);
    var recap  = _num(entry.cfg.acceleratedDepreciation);
    var weights = Array.isArray(entry.cfg.installmentScheduleWeights)
      ? entry.cfg.installmentScheduleWeights.map(function (w) { return Math.round(w * 100) + '%'; }).join(' / ')
      : '(equal)';
    var meta =
      '<p class="admin-math-subtitle" style="margin:6px 0 10px;">' +
        'Installment weights: <strong>' + weights + '</strong>' +
        ' &nbsp;·&nbsp; Y0 down: <strong>' + _fmtUSD(y0Down) + '</strong>' +
        ' &nbsp;·&nbsp; Recapture cash deployed Y0: <strong>' + _fmtUSD(recap) + '</strong>' +
      '</p>';

    return '<div class="admin-math-section">' +
      '<h4>Strategy ' + letter + ' &mdash; ' + _esc(name) + ' &mdash; Loss Generation Matrix</h4>' +
      meta +
      _matrixTable(cmp) +
    '</div>';
  }

  function _renderTemp() {
    if (typeof root.buildInterestedSummary !== 'function') {
      return '<p class="admin-math-error">buildInterestedSummary unavailable.</p>';
    }
    var summary;
    try { summary = root.buildInterestedSummary(); }
    catch (e) { return '<p class="admin-math-error">buildInterestedSummary threw: ' + _esc(e.message || e) + '</p>'; }
    if (!summary) return '<p class="admin-math-empty">Fill in client inputs to see the loss matrix.</p>';

    var intro =
      '<div class="admin-math-section">' +
        '<h4>How Brooklyn Losses Are Generated</h4>' +
        '<p class="admin-math-note" style="margin:0;">' +
          'Each <strong>tranche</strong> is one deposit into Brooklyn. A tranche generates ' +
          'short-term loss every year it stays open, at a rate that decays with its age ' +
          '(Y0 highest). Cell loss = capital &times; age-rate &times; year-fraction. ' +
          'The Y0 sale-close tranche opens mid-year, so it day-weights two adjacent ' +
          'age-rates each year (365-day model). Installment tranches open Jan 1 and run ' +
          'full-year rates. When cumulative deposits cross a combo minimum ' +
          '($1M&nbsp;→&nbsp;145/45, $3M&nbsp;→&nbsp;200/100) every active tranche migrates ' +
          'to the higher combo at its current age.' +
        '</p>' +
      '</div>';

    // Render all three strategies side-by-side so the admin can compare
    // what each path would have generated. Strategy A is a single-tranche
    // immediate sale (one column in the matrix) — still useful for the
    // CPA to see baseline loss generation vs. the deferred-recognition
    // alternatives (B/C). User request 2026-06-09.
    return intro +
      _strategyBlock('A', 'Traditional Sale (sell now)', summary) +
      _strategyBlock('B', 'Installment Sale (§453)', summary) +
      _strategyBlock('C', 'Structured Installment Sale', summary);
  }

  root._registerPageMath('page-temp', _renderTemp);
})(window);
