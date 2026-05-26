// js/04-ui/admin-math-page-projection.js
//
// Admin math reveal panel - Tab 4 (Projection / page-projection).
//
// For each strategy, surfaces the auto-pick decision + per-year
// breakdown table the engine produced. Each row of the per-year
// table shows: gain recognized, Brooklyn loss generated, baseline tax,
// with-strategy tax, savings (delta), Brooklyn fee, Brookhaven fee.
// Totals row sums to the headline Net Benefit on the Page-3 cards.
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

  function _strategyAnalysis(type, baseCfg) {
    if (typeof root._autoPickSection !== 'function') return { error: '_autoPickSection unavailable' };
    if (typeof root.unifiedTaxComparison !== 'function') return { error: 'unifiedTaxComparison unavailable' };
    if (typeof root._scenarioCfgFor !== 'function') return { error: '_scenarioCfgFor unavailable' };
    var picked;
    try { picked = root._autoPickSection(type, baseCfg); }
    catch (e) { return { error: 'auto-pick threw: ' + (e.message || e) }; }
    if (!picked) return { error: 'no auto-pick result' };
    var sectionCfg = Object.assign({}, baseCfg, {
      horizonYears: picked.horizon,
      leverage:     picked.shortPct / 100,
      leverageCap:  picked.shortPct / 100,
      comboId:      picked.comboId
    });
    var typedCfg = root._scenarioCfgFor(type, sectionCfg, picked.bestRecC, picked.durationMonths);
    var cmp;
    try { cmp = root.unifiedTaxComparison(typedCfg); }
    catch (e) { return { error: 'engine threw: ' + (e.message || e) }; }
    return {
      picked: picked,
      cfg: typedCfg,
      cmp: cmp,
      net: _num(cmp.totalSavings) - _num(cmp.totalAllFees)
    };
  }

  function _autoPickRow(label, value, note) {
    return '<tr><td>' + _esc(label) + '</td>' +
      '<td class="admin-math-num">' + (value == null ? '—' : value) + '</td>' +
      (note ? '<td class="admin-math-note-cell">' + note + '</td>' : '<td></td>') + '</tr>';
  }

  function _perYearTable(cmp) {
    var rows = cmp.rows || [];
    if (!rows.length) return '<p class="admin-math-empty">No per-year rows from engine.</p>';
    var totS = 0, totF = 0, totFH = 0, totL = 0, totG = 0;
    var html =
      '<table class="admin-math-table">' +
        '<thead><tr>' +
          '<th>Year</th>' +
          '<th class="admin-math-num">Gain Recog.</th>' +
          '<th class="admin-math-num">Brooklyn Loss</th>' +
          '<th class="admin-math-num">Baseline Tax</th>' +
          '<th class="admin-math-num">With-Strat Tax</th>' +
          '<th class="admin-math-num">Savings</th>' +
          '<th class="admin-math-num">Brk Fee</th>' +
          '<th class="admin-math-num">BH Fee</th>' +
        '</tr></thead><tbody>';
    rows.forEach(function (r) {
      var g = _num(r.gainRecognized);
      var l = _num(r.lossGenerated);
      var b = _num(r.doNothingBaseline && r.doNothingBaseline.total);
      var w = _num(r.withStrategy && r.withStrategy.total);
      var s = b - w;
      var f = _num(r.fee);
      var fh = _num(r.brookhavenFee);
      totG += g; totL += l; totS += s; totF += f; totFH += fh;
      html +=
        '<tr>' +
          '<td>' + _esc(r.year) + '</td>' +
          '<td class="admin-math-num">' + _fmtUSD(g) + '</td>' +
          '<td class="admin-math-num">' + _fmtUSD(l) + '</td>' +
          '<td class="admin-math-num">' + _fmtUSD(b) + '</td>' +
          '<td class="admin-math-num">' + _fmtUSD(w) + '</td>' +
          '<td class="admin-math-num">' + _fmtUSD(s) + '</td>' +
          '<td class="admin-math-num">' + _fmtUSD(f) + '</td>' +
          '<td class="admin-math-num">' + _fmtUSD(fh) + '</td>' +
        '</tr>';
    });
    var net = totS - totF - totFH;
    html +=
      '<tr class="admin-math-subtotal">' +
        '<td><strong>Totals</strong></td>' +
        '<td class="admin-math-num"><strong>' + _fmtUSD(totG) + '</strong></td>' +
        '<td class="admin-math-num"><strong>' + _fmtUSD(totL) + '</strong></td>' +
        '<td class="admin-math-num">—</td>' +
        '<td class="admin-math-num">—</td>' +
        '<td class="admin-math-num"><strong>' + _fmtUSD(totS) + '</strong></td>' +
        '<td class="admin-math-num"><strong>' + _fmtUSD(totF) + '</strong></td>' +
        '<td class="admin-math-num"><strong>' + _fmtUSD(totFH) + '</strong></td>' +
      '</tr>' +
      '<tr class="admin-math-total">' +
        '<td colspan="5"><strong>NET BENEFIT</strong> (savings − Brk fees − BH fees)</td>' +
        '<td class="admin-math-num"><strong>' + _fmtUSD(net) + '</strong></td>' +
        '<td colspan="2"></td>' +
      '</tr>' +
      '</tbody></table>';
    return html;
  }

  function _strategySection(letter, name, analysis) {
    if (analysis.error) {
      return '<div class="admin-math-section">' +
        '<h4>Strategy ' + letter + ' &mdash; ' + _esc(name) + '</h4>' +
        '<p class="admin-math-error">' + _esc(analysis.error) + '</p>' +
      '</div>';
    }
    var p = analysis.picked, cfg = analysis.cfg, cmp = analysis.cmp;
    var lockupHint;
    if (letter === 'A') lockupHint = 'Y0 lump-sum';
    else if (letter === 'B') lockupHint = (p.bestRecC | 0) + ' yearly Jan-1 payment' + (p.bestRecC === 1 ? '' : 's');
    else lockupHint = (p.durationMonths || 36) + 'mo structured-sale (40/40/20 over 3 yrs)';
    var pickRows = [
      _autoPickRow('Brooklyn combo',     p.comboId || (p.shortPct + '/' + (100 - p.shortPct)),
                                         'Best-net combo from the auto-pick sweep across leverage tiers'),
      _autoPickRow('Horizon',            p.horizon + ' year' + (p.horizon === 1 ? '' : 's'), null),
      _autoPickRow('Recognition shape',  lockupHint, null),
      _autoPickRow('Cover taxes',        cfg.coverTaxesFromSale ? 'Yes' : 'No',
                                         cfg.coverTaxesFromSale ? 'Y0-only tax-reserve tranche added (withdraws Apr 1 Y1)' : null),
      _autoPickRow('Available capital',  _fmtUSD(_num(cfg.availableCapital)),
                                         'Total Brooklyn investment commitment')
    ];
    return '<div class="admin-math-section">' +
      '<h4>Strategy ' + letter + ' &mdash; ' + _esc(name) + '</h4>' +
      '<table class="admin-math-table">' +
        '<thead><tr><th>Auto-pick</th><th class="admin-math-num">Value</th><th>Note</th></tr></thead>' +
        '<tbody>' + pickRows.join('') + '</tbody>' +
      '</table>' +
      '<p class="admin-math-subtitle" style="margin-top:10px;">Per-year engine output:</p>' +
      _perYearTable(cmp) +
    '</div>';
  }

  function _renderProjection() {
    if (typeof root.collectInputs !== 'function') {
      return '<p class="admin-math-error">collectInputs() unavailable.</p>';
    }
    var baseCfg;
    try { baseCfg = root.collectInputs(); }
    catch (e) { return '<p class="admin-math-error">collectInputs() threw: ' + _esc(e.message || e) + '</p>'; }

    return _strategySection('A', 'Normal Sale',                  _strategyAnalysis('A', baseCfg))
         + _strategySection('B', 'Installment Sale (§453)',       _strategyAnalysis('B', baseCfg))
         + _strategySection('C', 'Structured Installment Sale',   _strategyAnalysis('C', baseCfg));
  }

  root._registerPageMath('page-projection', _renderProjection);
})(window);
