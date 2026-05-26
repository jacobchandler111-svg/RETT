// js/04-ui/admin-math-page-allocator.js
//
// Admin math reveal panel - Tab 6 (Strategy Summary / page-allocator).
//
// Surfaces the reconciliation behind the Net Benefit hero, ROP
// (Return on Planning), fees baked in, and future-sale absorbing
// toggle. Pulls from the chosen strategy's engine output + runMaster
// Solver for supplementals.
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
  function _fmtPct(x, dp) {
    var v = Number(x);
    if (!isFinite(v)) return '—';
    return (v * 100).toFixed(dp == null ? 1 : dp) + '%';
  }
  function _num(v) { var n = Number(v); return isFinite(n) ? n : 0; }
  function _row(label, value, note) {
    return '<tr><td>' + _esc(label) + '</td>' +
      '<td class="admin-math-num">' + (value == null ? '—' : value) + '</td>' +
      '<td class="admin-math-note-cell">' + (note || '') + '</td></tr>';
  }

  function _chosenAnalysis() {
    var chosen = root.__rettChosenStrategy;
    if (!chosen) return { error: 'No strategy chosen yet (click "Use This Strategy" on Tab 4)' };
    if (typeof root.collectInputs !== 'function' ||
        typeof root._autoPickSection !== 'function' ||
        typeof root._scenarioCfgFor !== 'function' ||
        typeof root.unifiedTaxComparison !== 'function') {
      return { error: 'engine helpers unavailable' };
    }
    var baseCfg;
    try { baseCfg = root.collectInputs(); } catch (e) { return { error: 'collectInputs threw: ' + (e.message || e) }; }
    var picked;
    try { picked = root._autoPickSection(chosen, baseCfg); }
    catch (e) { return { error: 'auto-pick threw: ' + (e.message || e) }; }
    var sectionCfg = Object.assign({}, baseCfg, {
      horizonYears: picked.horizon,
      leverage:     picked.shortPct / 100,
      leverageCap:  picked.shortPct / 100,
      comboId:      picked.comboId
    });
    var typedCfg = root._scenarioCfgFor(chosen, sectionCfg, picked.bestRecC, picked.durationMonths);
    var cmp;
    try { cmp = root.unifiedTaxComparison(typedCfg); }
    catch (e) { return { error: 'engine threw: ' + (e.message || e) }; }
    return {
      chosen: chosen,
      picked: picked,
      cfg: typedCfg,
      cmp: cmp,
      savings:        _num(cmp.totalSavings),
      brooklynFees:   _num(cmp.totalFees),
      brookhavenFees: _num(cmp.totalBrookhavenFees),
      allFees:        _num(cmp.totalAllFees),
      primaryNet:     _num(cmp.totalSavings) - _num(cmp.totalAllFees)
    };
  }

  function _heroSection(a) {
    if (a.error) {
      return '<div class="admin-math-section">' +
        '<h4>Hero Reconciliation</h4>' +
        '<p class="admin-math-error">' + _esc(a.error) + '</p>' +
      '</div>';
    }
    var nameMap = { A: 'Normal Sale', B: 'Installment Sale', C: 'Structured Installment Sale' };
    return '<div class="admin-math-section">' +
      '<h4>Hero Reconciliation &mdash; Chosen Strategy ' + a.chosen + ' (' + nameMap[a.chosen] + ')</h4>' +
      '<table class="admin-math-table">' +
        '<thead><tr><th>Component</th><th class="admin-math-num">Value</th><th>Notes</th></tr></thead>' +
        '<tbody>' +
          _row('Baseline tax (do nothing)',   _fmtUSD(_num(a.cmp.totalBaseline)),
                                              'What the client owes WITHOUT any strategy') +
          _row('With-strategy tax',           _fmtUSD(_num(a.cmp.totalWithStrategy)),
                                              'What they owe WITH the chosen strategy') +
          _row('Gross tax savings',           _fmtUSD(a.savings),
                                              'baseline − with-strategy') +
          _row('Brooklyn fees',               _fmtUSD(a.brooklynFees), null) +
          _row('Brookhaven fees',             _fmtUSD(a.brookhavenFees), null) +
          _row('Total fees',                  _fmtUSD(a.allFees),
                                              'Brooklyn + Brookhaven') +
          '<tr class="admin-math-total"><td><strong>NET BENEFIT (hero)</strong></td>' +
            '<td class="admin-math-num"><strong>' + _fmtUSD(a.primaryNet) + '</strong></td>' +
            '<td class="admin-math-note-cell">savings &minus; total fees</td></tr>' +
        '</tbody>' +
      '</table>' +
    '</div>';
  }

  function _ropSection(a) {
    if (a.error) return '';
    var rop = a.allFees > 0 ? a.primaryNet / a.allFees : 0;
    return '<div class="admin-math-section">' +
      '<h4>Return on Planning (ROP)</h4>' +
      '<table class="admin-math-table">' +
        '<thead><tr><th>Component</th><th class="admin-math-num">Value</th><th>Notes</th></tr></thead>' +
        '<tbody>' +
          _row('Net benefit (numerator)', _fmtUSD(a.primaryNet), null) +
          _row('Total fees (denominator)', _fmtUSD(a.allFees), null) +
          '<tr class="admin-math-total"><td><strong>ROP</strong></td>' +
            '<td class="admin-math-num"><strong>' + _fmtPct(rop, 0) + '</strong></td>' +
            '<td class="admin-math-note-cell">net / fees - shown on Page 5 as "every $1 of fees returns $N net"</td></tr>' +
        '</tbody>' +
      '</table>' +
    '</div>';
  }

  function _futureSaleSection() {
    var futureAbsorbing = !!root.__rettAbsorbFutureSale;
    var futureSale = null;
    try {
      var cfg = root.collectInputs();
      futureSale = cfg && cfg.futureSale;
    } catch (e) { /* */ }
    var rows = [
      _row('Future-sale absorbing toggle', futureAbsorbing ? 'Apply (Yes)' : 'Off (default)',
                                           'Page 5 "Apply additional future-sale absorption" button')
    ];
    if (futureSale && futureSale.enabled) {
      rows.push(_row('Future sale date', _esc(futureSale.saleDate || '—'), null));
      rows.push(_row('Future estimated gain', _fmtUSD(_num(futureSale.estimatedGain)), 'For optimizer loss-carryforward retention'));
    } else {
      rows.push(_row('Future sale configured', 'No', 'Loss carryforward capped at $3K/yr per §1211(b)'));
    }
    return '<div class="admin-math-section">' +
      '<h4>Future-Sale Toggle</h4>' +
      '<table class="admin-math-table">' +
        '<thead><tr><th>Field</th><th class="admin-math-num">Value</th><th>Notes</th></tr></thead>' +
        '<tbody>' + rows.join('') + '</tbody>' +
      '</table>' +
    '</div>';
  }

  function _combinedSection(a) {
    if (a.error) return '';
    var primary = a.primaryNet;
    var solver = null;
    if (typeof root.runMasterSolver === 'function') {
      try { solver = root.runMasterSolver(primary); } catch (e) { solver = null; }
    }
    if (!solver) return '';
    var totalSupp = _num(solver.totalSupplementalBenefit);
    var combined = _num(solver.totalCombinedNetBenefit);
    var rows = [
      _row('Primary net (Brooklyn-only)',   _fmtUSD(primary), 'From hero reconciliation above'),
      _row('Total supplemental benefit',     _fmtUSD(totalSupp),
                                             'Sum of funded supplementals (rivalry-respected)'),
      '<tr class="admin-math-total"><td><strong>Combined net (primary + supplementals)</strong></td>' +
        '<td class="admin-math-num"><strong>' + _fmtUSD(combined) + '</strong></td>' +
        '<td class="admin-math-note-cell">What the advisor markets to the client</td></tr>'
    ];
    return '<div class="admin-math-section">' +
      '<h4>Combined Net (Primary + Supplementals)</h4>' +
      '<table class="admin-math-table">' +
        '<thead><tr><th>Component</th><th class="admin-math-num">Value</th><th>Notes</th></tr></thead>' +
        '<tbody>' + rows.join('') + '</tbody>' +
      '</table>' +
    '</div>';
  }

  function _renderAllocator() {
    var a = _chosenAnalysis();
    return _heroSection(a) + _ropSection(a) + _combinedSection(a) + _futureSaleSection();
  }

  root._registerPageMath('page-allocator', _renderAllocator);
})(window);
