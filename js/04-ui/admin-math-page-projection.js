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

  // Same approach as Tab 3: read post-optimizer entries from
  // buildInterestedSummary so the headline net matches the card.
  // We ALSO call unifiedTaxComparison(entry.cfg) to get the per-year
  // engine row breakdown - those are pre-optimizer rows but they
  // represent the raw engine output the CPA wants to see. The
  // headline net + savings + fees reflect the post-optimizer values.
  function _strategyAnalysis(type) {
    if (typeof root.buildInterestedSummary !== 'function') {
      return { error: 'buildInterestedSummary unavailable' };
    }
    if (typeof root.unifiedTaxComparison !== 'function') {
      return { error: 'unifiedTaxComparison unavailable' };
    }
    var summary;
    try { summary = root.buildInterestedSummary(); }
    catch (e) { return { error: 'buildInterestedSummary threw: ' + (e.message || e) }; }
    if (!summary) return { error: 'no summary (no inputs?)' };
    var entry = (summary.entries || []).find(function (e) { return e.type === type; });
    if (!entry) return { error: 'no entry for ' + type };

    var cmp;
    try { cmp = root.unifiedTaxComparison(entry.cfg); }
    catch (e) { return { error: 'engine threw: ' + (e.message || e) }; }
    var m = entry.metrics || {};
    return {
      picked: entry.picked || {},
      cfg: entry.cfg || {},
      cmp: cmp,
      optScale: entry._optScale != null ? entry._optScale : 1,
      // Post-optimizer headline values (match Page 3 cards):
      cardSavings: _num(m.savings != null ? m.savings : m._savingsAtFull),
      cardBrooklynFees: _num(m.brooklynFees),
      cardBrookhavenFees: _num(m.brookhavenFees),
      cardNet: _num(m.net)
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
    var totS = 0, totF = 0, totFH = 0, totL = 0, totG = 0, totR = 0, totWd = 0;
    var cumL = 0, cumS = 0, cumFAll = 0;
    var prevCumInv = 0;
    var html =
      '<div class="admin-math-scroll">' +
      '<table class="admin-math-table admin-math-table-wide">' +
        '<thead><tr>' +
          '<th>Year</th>' +
          '<th class="admin-math-num">Gain Recog.</th>' +
          '<th class="admin-math-num">Brk New Deposit</th>' +
          '<th class="admin-math-num">Brk Withdrawn</th>' +
          '<th class="admin-math-num">Brk Invested (Cum.)</th>' +
          '<th class="admin-math-num">Brk ST Loss</th>' +
          '<th class="admin-math-num">Cum. Loss</th>' +
          '<th class="admin-math-num">Baseline Tax</th>' +
          '<th class="admin-math-num">With-Strat Tax</th>' +
          '<th class="admin-math-num">Savings</th>' +
          '<th class="admin-math-num">Cum. Savings</th>' +
          '<th class="admin-math-num">Brk Fee</th>' +
          '<th class="admin-math-num">BH Fee</th>' +
          '<th class="admin-math-num">Cum. Net</th>' +
        '</tr></thead><tbody>';
    rows.forEach(function (r) {
      var g = _num(r.gainRecognized);
      var newDep = _num(r.reinvestedThisYear);
      var cumInv = _num(r.investmentThisYear);
      // Implicit withdrawals: when a tranche hits its maxAgeInclusive
      // (cover-taxes Y0-only tax-reserve tranche on Apr 1 of Y1, or
      // basis tranche under _y0OnlyDegeneracy), engine drops its capital
      // from investmentThisYear. Surface explicitly: withdrawn =
      // max(0, prev + newDep - cur).
      var withdrawn = Math.max(0, prevCumInv + newDep - cumInv);
      prevCumInv = cumInv;
      var l = _num(r.lossGenerated);
      var b = _num(r.doNothingBaseline && r.doNothingBaseline.total);
      var w = _num(r.withStrategy && r.withStrategy.total);
      var s = b - w;
      var f = _num(r.fee);
      var fh = _num(r.brookhavenFee);
      totG += g; totL += l; totS += s; totF += f; totFH += fh; totR += newDep; totWd += withdrawn;
      cumL += l; cumS += s; cumFAll += (f + fh);
      var cumNet = cumS - cumFAll;
      var wdCellClass = 'admin-math-num' + (withdrawn > 0 ? ' admin-math-withdrawn' : '');
      var wdCellDisplay = withdrawn > 0 ? ('&minus;' + _fmtUSD(withdrawn)) : _fmtUSD(0);
      html +=
        '<tr>' +
          '<td>' + _esc(r.year) + '</td>' +
          '<td class="admin-math-num">' + _fmtUSD(g) + '</td>' +
          '<td class="admin-math-num">' + _fmtUSD(newDep) + '</td>' +
          '<td class="' + wdCellClass + '">' + wdCellDisplay + '</td>' +
          '<td class="admin-math-num"><strong>' + _fmtUSD(cumInv) + '</strong></td>' +
          '<td class="admin-math-num">' + _fmtUSD(l) + '</td>' +
          '<td class="admin-math-num">' + _fmtUSD(cumL) + '</td>' +
          '<td class="admin-math-num">' + _fmtUSD(b) + '</td>' +
          '<td class="admin-math-num">' + _fmtUSD(w) + '</td>' +
          '<td class="admin-math-num">' + _fmtUSD(s) + '</td>' +
          '<td class="admin-math-num">' + _fmtUSD(cumS) + '</td>' +
          '<td class="admin-math-num">' + _fmtUSD(f) + '</td>' +
          '<td class="admin-math-num">' + _fmtUSD(fh) + '</td>' +
          '<td class="admin-math-num"><strong>' + _fmtUSD(cumNet) + '</strong></td>' +
        '</tr>';
    });
    var net = totS - totF - totFH;
    html +=
      '<tr class="admin-math-subtotal">' +
        '<td><strong>Totals</strong></td>' +
        '<td class="admin-math-num"><strong>' + _fmtUSD(totG) + '</strong></td>' +
        '<td class="admin-math-num"><strong>' + _fmtUSD(totR) + '</strong></td>' +
        '<td class="admin-math-num">' + (totWd > 0 ? '<strong>&minus;' + _fmtUSD(totWd) + '</strong>' : _fmtUSD(0)) + '</td>' +
        '<td class="admin-math-num">—</td>' +
        '<td class="admin-math-num"><strong>' + _fmtUSD(totL) + '</strong></td>' +
        '<td class="admin-math-num">—</td>' +
        '<td class="admin-math-num">—</td>' +
        '<td class="admin-math-num">—</td>' +
        '<td class="admin-math-num"><strong>' + _fmtUSD(totS) + '</strong></td>' +
        '<td class="admin-math-num">—</td>' +
        '<td class="admin-math-num"><strong>' + _fmtUSD(totF) + '</strong></td>' +
        '<td class="admin-math-num"><strong>' + _fmtUSD(totFH) + '</strong></td>' +
        '<td class="admin-math-num"><strong>' + _fmtUSD(net) + '</strong></td>' +
      '</tr>' +
      '<tr class="admin-math-total">' +
        '<td colspan="13"><strong>NET BENEFIT</strong> (savings − Brk fees − BH fees)</td>' +
        '<td class="admin-math-num"><strong>' + _fmtUSD(net) + '</strong></td>' +
      '</tr>' +
      '</tbody></table>' +
      '</div>';
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
    var scalePct = (analysis.optScale * 100).toFixed(0) + '%';
    var scaleNote = analysis.optScale < 1
      ? 'Optimizer dialed back to ' + scalePct + ' of available - reduces fees'
      : 'Full deployment (no dial-back)';
    var combo = (p.comboId && typeof root.getSchwabCombo === 'function')
      ? root.getSchwabCombo(p.comboId) : null;
    var comboLabel = combo ? (combo.leverageLabel + ' (' + combo.strategyLabel + ')') : (p.comboId || '—');
    var y0LossRate = combo && combo.lossByYear ? combo.lossByYear[0] : null;
    var lossRateRow = y0LossRate != null
      ? _autoPickRow('Loss rate (Y0)', (y0LossRate * 100).toFixed(1) + '%',
                     'First-year loss/$ ratio under ' + comboLabel + ' - decays each subsequent year (see per-year table for actuals)')
      : _autoPickRow('Loss rate (Y0)', '—', null);
    var feeRateRow = combo
      ? _autoPickRow('Brooklyn fee rate', (combo.feeRate * 100).toFixed(2) + '%',
                     'Per-year fee on deployed capital under ' + comboLabel)
      : _autoPickRow('Brooklyn fee rate', '—', null);
    var pickRows = [
      _autoPickRow('Brooklyn combo',     comboLabel,
                                         'Best-net combo from the auto-pick sweep across leverage tiers'),
      _autoPickRow('Horizon',            p.horizon + ' year' + (p.horizon === 1 ? '' : 's'), null),
      _autoPickRow('Recognition shape',  lockupHint, null),
      _autoPickRow('Optimizer scale',    scalePct, scaleNote),
      lossRateRow,
      feeRateRow,
      _autoPickRow('Cover taxes',        cfg.coverTaxesFromSale ? 'Yes' : 'No',
                                         cfg.coverTaxesFromSale ? 'Y0-only tax-reserve tranche added (withdraws Apr 1 Y1)' : null),
      _autoPickRow('Available capital',  _fmtUSD(_num(cfg.availableCapital)),
                                         'Total Brooklyn investment commitment')
    ];
    var cardSummary =
      '<p class="admin-math-subtitle" style="margin-top:10px;">Page 3 card values (post-optimizer):</p>' +
      '<table class="admin-math-table">' +
        '<tbody>' +
          '<tr><td>Gross tax savings</td><td class="admin-math-num">' + _fmtUSD(analysis.cardSavings) + '</td><td class="admin-math-note-cell">post-optimizer</td></tr>' +
          '<tr><td>Brooklyn fees</td><td class="admin-math-num">' + _fmtUSD(analysis.cardBrooklynFees) + '</td><td class="admin-math-note-cell">post-optimizer</td></tr>' +
          '<tr><td>Brookhaven fees</td><td class="admin-math-num">' + _fmtUSD(analysis.cardBrookhavenFees) + '</td><td></td></tr>' +
          '<tr class="admin-math-total"><td><strong>NET BENEFIT (on card)</strong></td><td class="admin-math-num"><strong>' + _fmtUSD(analysis.cardNet) + '</strong></td><td class="admin-math-note-cell">savings − fees</td></tr>' +
        '</tbody>' +
      '</table>';
    return '<div class="admin-math-section">' +
      '<h4>Strategy ' + letter + ' &mdash; ' + _esc(name) + ' &mdash; ' + _esc(comboLabel) + '</h4>' +
      '<table class="admin-math-table">' +
        '<thead><tr><th>Auto-pick</th><th class="admin-math-num">Value</th><th>Note</th></tr></thead>' +
        '<tbody>' + pickRows.join('') + '</tbody>' +
      '</table>' +
      cardSummary +
      '<p class="admin-math-subtitle" style="margin-top:10px;">Per-year engine output (pre-optimizer, full-deployment):</p>' +
      _perYearTable(cmp) +
    '</div>';
  }

  function _renderProjection() {
    return _strategySection('A', 'Traditional Sale',             _strategyAnalysis('A'))
         + _strategySection('B', 'Installment Sale (§453)',       _strategyAnalysis('B'))
         + _strategySection('C', 'Structured Installment Sale',   _strategyAnalysis('C'));
  }

  root._registerPageMath('page-projection', _renderProjection);
})(window);
