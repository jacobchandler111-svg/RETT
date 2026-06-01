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
    if (typeof root.buildInterestedSummary !== 'function') {
      return { error: 'buildInterestedSummary unavailable' };
    }
    var summary;
    try { summary = root.buildInterestedSummary(); }
    catch (e) { return { error: 'buildInterestedSummary threw: ' + (e.message || e) }; }
    if (!summary) return { error: 'no summary (no inputs?)' };
    var entry = (summary.entries || []).find(function (e) { return e.type === chosen; });
    if (!entry) return { error: 'no entry for chosen strategy ' + chosen };
    var m = entry.metrics || {};
    // Read post-optimizer values so the hero reconciliation matches
    // what the Page 5 hero actually displays.
    var savings = _num(m.savings != null ? m.savings : m._savingsAtFull);
    var brooklynFees = _num(m.brooklynFees);
    var brookhavenFees = _num(m.brookhavenFees);
    var allFees = _num(m.fees);
    var net = _num(m.net);
    // Excess-loss fee credit (Strategy C only) — already baked into
    // m.brooklynFees and m.net; surface it so the hero reconciliation
    // is honest (raw engine fees → credit → net fees → net).
    var excessLossFeeCredit = _num(m._excessLossFeeCredit || 0);
    // doNothing on metrics is the baseline tax; with-strategy tax is
    // doNothing - savings.
    var baselineTax = _num(m.doNothing);
    var withStrategyTax = baselineTax - savings;
    // Pull the raw engine cmp on the DIALED-BACK cfg so the per-year
    // rows below the hero reconcile to the card. Previously called
    // with entry.cfg (FULL availableCapital), which made fee
    // structure non-comparable to the post-optimizer numbers in the
    // hero above. Mirrors admin-math-page-projection.js's pattern
    // (the canonical fix from commit f503d9f).
    var cmp = null;
    if (entry.cfg && typeof root.unifiedTaxComparison === 'function') {
      try {
        var _ecfgAlloc = entry.cfg;
        var _pdAlloc = entry._partialDeploy;
        if (_pdAlloc && Number.isFinite(Number(_pdAlloc.deployed))) {
          var _depAlloc = Math.max(0, Math.round(Number(_pdAlloc.deployed)));
          if (_depAlloc !== Math.round(Number(_ecfgAlloc.availableCapital) || 0)) {
            _ecfgAlloc = Object.assign({}, _ecfgAlloc, {
              availableCapital: _depAlloc, investment: _depAlloc, investedCapital: _depAlloc
            });
          }
        }
        if (typeof root.rettFlavorEngineCfg === 'function') {
          try { _ecfgAlloc = root.rettFlavorEngineCfg(_ecfgAlloc); } catch (e) { /* */ }
        }
        cmp = root.unifiedTaxComparison(_ecfgAlloc);
      }
      catch (e) { cmp = null; }
    }
    // Strategy A immediate path: card's brooklynFees come from
    // ProjectionEngine.run (actual-hold-period close), not from
    // unifiedTaxComparison.totalFees. Pull the ProjectionEngine
    // per-year fees so the Brooklyn breakdown table reconciles to the
    // hero row above it. Without this the hero shows $54K and the
    // breakdown 4 rows below shows $85K — same panel, two numbers.
    var projFees = null;
    if (chosen === 'A' && typeof ProjectionEngine !== 'undefined' && ProjectionEngine.run) {
      try {
        var flavoredCfg = (typeof root.rettFlavorEngineCfg === 'function')
          ? root.rettFlavorEngineCfg(entry.cfg) : entry.cfg;
        var proj = ProjectionEngine.run(flavoredCfg);
        if (proj && Array.isArray(proj.years)) {
          projFees = { byYear: {}, total: (proj.totals && proj.totals.cumulativeFees) || 0 };
          proj.years.forEach(function (y) { projFees.byYear[y.year] = _num(y.fee); });
        }
      } catch (e) { projFees = null; }
    }
    return {
      chosen: chosen,
      picked: entry.picked || {},
      cfg: entry.cfg || {},
      cmp: cmp,
      projFees: projFees,
      baselineTax: baselineTax,
      withStrategyTax: withStrategyTax,
      savings: savings,
      brooklynFees: brooklynFees,
      brookhavenFees: brookhavenFees,
      allFees: allFees,
      primaryNet: net,
      excessLossFeeCredit: excessLossFeeCredit,
      optScale: entry._optScale != null ? entry._optScale : 1
    };
  }

  function _heroSection(a) {
    if (a.error) {
      return '<div class="admin-math-section">' +
        '<h4>Hero Reconciliation</h4>' +
        '<p class="admin-math-error">' + _esc(a.error) + '</p>' +
      '</div>';
    }
    var nameMap = { A: 'Traditional Sale', B: 'Installment Sale', C: 'Structured Installment Sale' };
    var scalePct = (a.optScale * 100).toFixed(0) + '%';
    var scaleNote = a.optScale < 1
      ? 'Optimizer dialed back to ' + scalePct + ' of available - reduces fees while still absorbing gain'
      : 'Full deployment';
    return '<div class="admin-math-section">' +
      '<h4>Hero Reconciliation &mdash; Chosen Strategy ' + a.chosen + ' (' + nameMap[a.chosen] + ')</h4>' +
      '<table class="admin-math-table">' +
        '<thead><tr><th>Component</th><th class="admin-math-num">Value</th><th>Notes</th></tr></thead>' +
        '<tbody>' +
          _row('Optimizer scale',             scalePct, scaleNote) +
          _row('Baseline tax (do nothing)',   _fmtUSD(a.baselineTax),
                                              'What the client owes WITHOUT any strategy') +
          _row('With-strategy tax',           _fmtUSD(a.withStrategyTax),
                                              'What they owe WITH the chosen strategy (post-optimizer)') +
          _row('Gross tax savings',           _fmtUSD(a.savings),
                                              'baseline − with-strategy') +
          (a.excessLossFeeCredit > 0
            ? (_row('Brooklyn fees (gross)',    _fmtUSD(a.brooklynFees + a.excessLossFeeCredit),
                                                'Pre-credit raw engine fees at deployed capital') +
               _row('&nbsp;&nbsp;Excess-loss fee credit', '&minus;' + _fmtUSD(a.excessLossFeeCredit),
                                                'Strategy C: AM fee refunded on residual unused short-term loss (&gt; $10K)') +
               _row('Brooklyn fees (net of credit)', _fmtUSD(a.brooklynFees),
                                                'Used in NET BENEFIT below'))
            : _row('Brooklyn fees',             _fmtUSD(a.brooklynFees), 'Post-optimizer')
          ) +
          _row('Brookhaven fees',             _fmtUSD(a.brookhavenFees), null) +
          _row('Total fees',                  _fmtUSD(a.allFees),
                                              'Brooklyn (net of credit, if any) + Brookhaven') +
          '<tr class="admin-math-total"><td><strong>NET BENEFIT (hero)</strong></td>' +
            '<td class="admin-math-num"><strong>' + _fmtUSD(a.primaryNet) + '</strong></td>' +
            '<td class="admin-math-note-cell">savings &minus; total fees (matches Page 5 hero)</td></tr>' +
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

  // Brookhaven fee breakdown (advisor 2026-05-27): show the setup +
  // quarterly schedule + how it was prorated. Lets the CPA verify the
  // $45K setup + $2K/quarter × 8-quarter cap math.
  function _brookhavenSection(a) {
    if (a.error) return '';
    var defaults = root.BROOKHAVEN_FEE_DEFAULTS || { setupFeeUSD: 45000, quarterlyFeeUSD: 2000, quarterlyFeeQtrs: 8 };
    var horizon = (a.picked && a.picked.horizon) || (a.cmp && (a.cmp.rows || []).length) || 4;
    var year1 = (a.cfg && a.cfg.year1) || (new Date()).getFullYear();
    // yfImpl: derive from cfg.implementationDate (Strategy B uses
    // year+1 Jan 1 = yf 1.0; others vary). Reuse the engine's
    // year-fraction helper when available.
    var yf = 1;
    try {
      var dateStr = a.cfg && (a.cfg.strategyImplementationDate || a.cfg.implementationDate);
      if (dateStr && typeof root.yearFractionRemaining === 'function') {
        yf = root.yearFractionRemaining(dateStr);
      }
    } catch (e) { yf = 1; }

    var rows = '';
    var schedule = (typeof root.brookhavenFeeSchedule === 'function')
      ? root.brookhavenFeeSchedule(horizon, yf) : null;
    if (schedule && schedule.perYear) {
      schedule.perYear.forEach(function (y, i) {
        var yearLabel = year1 + i;
        var setupLbl = y.setup > 0 ? _fmtUSD(y.setup) : '—';
        var qtrLbl   = y.quarterly > 0 ? _fmtUSD(y.quarterly) : '—';
        var note;
        if (i === 0) note = 'Setup ' + _fmtUSD(defaults.setupFeeUSD) + ' (one-time) + Q' + (yf === 1 ? '1-Q4' : 'prorated by yf=' + yf.toFixed(2));
        else if (i === 1) note = 'Full 4 quarters × ' + _fmtUSD(defaults.quarterlyFeeUSD);
        else if (i === 2) note = 'Remaining quarters (8-quarter cap)';
        else note = 'Past 8-quarter cap';
        rows += '<tr><td>' + yearLabel + '</td>' +
          '<td class="admin-math-num">' + setupLbl + '</td>' +
          '<td class="admin-math-num">' + qtrLbl + '</td>' +
          '<td class="admin-math-num"><strong>' + _fmtUSD(y.total) + '</strong></td>' +
          '<td class="admin-math-note-cell">' + note + '</td></tr>';
      });
      rows += '<tr class="admin-math-total"><td colspan="3"><strong>Total Brookhaven fee</strong></td>' +
        '<td class="admin-math-num"><strong>' + _fmtUSD(schedule.total) + '</strong></td>' +
        '<td class="admin-math-note-cell">capped at ' + defaults.quarterlyFeeQtrs + ' quarters of recurring</td></tr>';
    }

    var constants =
      '<table class="admin-math-table" style="margin-bottom: 12px;">' +
        '<tbody>' +
          '<tr><td>Setup fee (one-time)</td><td class="admin-math-num"><strong>' + _fmtUSD(defaults.setupFeeUSD) + '</strong></td><td class="admin-math-note-cell">Charged Y0 at engagement, not prorated</td></tr>' +
          '<tr><td>Quarterly fee</td><td class="admin-math-num"><strong>' + _fmtUSD(defaults.quarterlyFeeUSD) + '/qtr</strong></td><td class="admin-math-note-cell">' + _fmtUSD(defaults.quarterlyFeeUSD * 4) + '/yr full-year</td></tr>' +
          '<tr><td>Cap</td><td class="admin-math-num"><strong>' + defaults.quarterlyFeeQtrs + ' qtrs</strong></td><td class="admin-math-note-cell">~' + _fmtUSD(defaults.quarterlyFeeUSD * defaults.quarterlyFeeQtrs) + ' total quarterly (excludes setup)</td></tr>' +
          '<tr><td>Year-1 proration (yfImpl)</td><td class="admin-math-num"><strong>' + (yf * 100).toFixed(1) + '%</strong></td><td class="admin-math-note-cell">Sale closes mid-year → Q1 prorated; remainder rolls to Y3</td></tr>' +
        '</tbody>' +
      '</table>';

    return '<div class="admin-math-section">' +
      '<h4>Brookhaven Fee Breakdown</h4>' +
      constants +
      '<table class="admin-math-table">' +
        '<thead><tr><th>Year</th><th class="admin-math-num">Setup</th><th class="admin-math-num">Quarterly</th><th class="admin-math-num">Year total</th><th>Notes</th></tr></thead>' +
        '<tbody>' + rows + '</tbody>' +
      '</table>' +
    '</div>';
  }

  // Brooklyn fee breakdown (advisor 2026-05-27): per-year per-tranche
  // accounting. Shows the combo's fee rate + capital deployed each
  // year so the CPA can verify capital × rate × yf = fee.
  function _brooklynSection(a) {
    if (a.error) return '';
    var combo = (a.picked && a.picked.comboId && typeof root.getSchwabCombo === 'function')
      ? root.getSchwabCombo(a.picked.comboId) : null;
    var feeRate = (combo && typeof root.brooklynFeeRateFor === 'function')
      ? (root.brooklynFeeRateFor(combo.longPct, combo.shortPct) || 0)
      : 0;
    var comboLabel = combo ? (combo.leverageLabel + ' (' + combo.strategyLabel + ')') : 'unknown';
    var rows = (a.cmp && a.cmp.rows) || [];
    if (!rows.length) {
      return '<div class="admin-math-section">' +
        '<h4>Brooklyn Fee Breakdown</h4>' +
        '<p class="admin-math-empty">No per-year rows from engine.</p>' +
      '</div>';
    }
    var tableRows = '';
    var sumFee = 0;
    var projFees = a.projFees;
    // Reconcile to the hero row above.
    //   A: cmp.rows[].fee comes from unifiedTaxComparison (annualized),
    //      but the card reads ProjectionEngine.cumulativeFees (actual
    //      hold-period). projFees.byYear holds the engine values.
    //   B/C: cmp was now run at the DIALED-BACK cfg (see _analyze),
    //      so r.fee is already at the optimizer's chosen scale — no
    //      post-scaling needed. The old `* optScale` was a workaround
    //      for the old "engine at full cfg" pattern that's been
    //      retired (commit f503d9f for projection, this commit for
    //      allocator).
    rows.forEach(function (r) {
      var fee = (projFees && projFees.byYear && projFees.byYear[r.year] != null)
        ? _num(projFees.byYear[r.year])
        : _num(r.fee);
      // F6 fix (Round 5): engine row field is `investmentThisYear`
      // (cumulative deployed capital), not `invested`. The old typo
      // showed $0 for every year and an empty Calc column despite
      // non-zero fees — looked like a broken admin panel even though
      // the engine math was correct. Now reads the right field and
      // the implied yfActive reconciles to a meaningful number.
      var invested = _num(r.investmentThisYear);
      sumFee += fee;
      var yfImpliedNote = '';
      if (invested > 0 && feeRate > 0) {
        var yfImplied = fee / (invested * feeRate);
        yfImpliedNote = _fmtUSD(invested) + ' × ' + (feeRate * 100).toFixed(2) + '% × ' + yfImplied.toFixed(2);
      } else if (fee === 0) {
        yfImpliedNote = 'No deployment / position closed';
      } else {
        yfImpliedNote = 'Per-tranche; see Projection admin for breakdown';
      }
      tableRows += '<tr>' +
        '<td>' + _esc(r.year) + '</td>' +
        '<td class="admin-math-num">' + _fmtUSD(invested) + '</td>' +
        '<td class="admin-math-num">' + (feeRate * 100).toFixed(2) + '%</td>' +
        '<td class="admin-math-num"><strong>' + _fmtUSD(fee) + '</strong></td>' +
        '<td class="admin-math-note-cell">' + yfImpliedNote + '</td>' +
      '</tr>';
    });
    tableRows += '<tr class="admin-math-total"><td colspan="3"><strong>Total Brooklyn fee (gross)</strong></td>' +
      '<td class="admin-math-num"><strong>' + _fmtUSD(sumFee) + '</strong></td>' +
      '<td class="admin-math-note-cell">Sum of per-year fees</td></tr>';
    // If Strategy C earned an excess-loss fee credit, surface it so the
    // table reconciles to the hero's net-of-credit Brooklyn fees value.
    // Without this the table summed to a different number than the hero
    // ($37,728 sum vs $18,407 hero on a representative C scenario), a
    // real-feel discrepancy on the same admin panel.
    var _credit = a.excessLossFeeCredit || 0;
    if (_credit > 0) {
      tableRows += '<tr class="admin-math-total"><td colspan="3">&minus; Excess-loss fee credit</td>' +
        '<td class="admin-math-num"><strong>&minus;' + _fmtUSD(_credit) + '</strong></td>' +
        '<td class="admin-math-note-cell">Strategy C: AM fee refunded on residual unused short-term loss (&gt; $10K)</td></tr>';
      tableRows += '<tr class="admin-math-total"><td colspan="3"><strong>Net Brooklyn fee</strong></td>' +
        '<td class="admin-math-num"><strong>' + _fmtUSD(sumFee - _credit) + '</strong></td>' +
        '<td class="admin-math-note-cell">Matches Brooklyn fees row in the hero above</td></tr>';
    }

    return '<div class="admin-math-section">' +
      '<h4>Brooklyn Fee Breakdown &mdash; ' + _esc(comboLabel) + '</h4>' +
      '<table class="admin-math-table" style="margin-bottom: 12px;">' +
        '<tbody>' +
          '<tr><td>Annual fee rate</td><td class="admin-math-num"><strong>' + (feeRate * 100).toFixed(2) + '%</strong></td><td class="admin-math-note-cell">Per-year on deployed capital</td></tr>' +
        '</tbody>' +
      '</table>' +
      '<table class="admin-math-table">' +
        '<thead><tr><th>Year</th><th class="admin-math-num">Invested</th><th class="admin-math-num">Fee rate</th><th class="admin-math-num">Fee</th><th>Calc (invested × rate × yfActive)</th></tr></thead>' +
        '<tbody>' + tableRows + '</tbody>' +
      '</table>' +
    '</div>';
  }

  function _renderAllocator() {
    var a = _chosenAnalysis();
    return _heroSection(a)
         + _ropSection(a)
         + _brookhavenSection(a)
         + _brooklynSection(a)
         + _combinedSection(a)
         + _futureSaleSection();
  }

  root._registerPageMath('page-allocator', _renderAllocator);
})(window);
