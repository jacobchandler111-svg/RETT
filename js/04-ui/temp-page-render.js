// FILE: js/04-ui/temp-page-render.js
// Tab 7 — "Temporary" CPA verification view.
//
// Per-year baseline cards laid top-to-bottom for the chosen strategy
// (window.__rettChosenStrategy = 'A' | 'B' | 'C'). Each card has
// three columns:
//
//   LEFT   — Relevance pill (Relevant / Not relevant)
//   CENTER — Tax baseline: source incomes (3 reducible types) + a
//            split federal tax breakdown + state + total
//   RIGHT  — Strategy activity for that year: Brooklyn loss /
//            investment / gain recognized + funded supplementals
//            (Y0 only; supps fire in the deployment year)
//
// Read-only consumer of the engine — re-runs unifiedTaxComparison on
// the chosen strategy's cfg + reads runMasterSolver for funded supps.
// No engine writes.
//
// Relevance per chosen strategy:
//   A (Sell Now)        — Y0 only Relevant
//   B (Seller Finance)  — Y0 (recap) + Y1 (gain) Relevant — see B
//                         reframe note in render(); the engine is
//                         pending an update to model §453(i) split
//   C (Structured Sale) — every row with gain or recap Relevant

(function (root) {
  'use strict';

  // Number of year cards to render (Y0..Y_TOTAL_YEARS-1).
  var TOTAL_YEARS = 6;

  function _fmt(n) {
    if (n == null || !isFinite(n)) return '$0';
    var sign = n < 0 ? '-' : '';
    return sign + '$' + Math.round(Math.abs(n)).toLocaleString('en-US');
  }

  function _readNum(id) {
    var el = document.getElementById(id);
    if (!el) return 0;
    var v = el.value;
    if (typeof root.parseUSD === 'function') return root.parseUSD(v) || 0;
    return Number(v) || 0;
  }
  function _readVal(id, fallback) {
    var el = document.getElementById(id);
    return el && el.value ? el.value : (fallback || '');
  }

  function _recurringOrdinary() {
    var ord = 0;
    ['w2-wages','se-income','dividend-income','retirement-distributions'].forEach(function (id) {
      ord += Math.max(0, _readNum(id));
    });
    ['biz-revenue','rental-income'].forEach(function (id) { ord += _readNum(id); });
    return ord;
  }

  // Compute a baseline for a given absolute year using the form's
  // recurring income, with optional recapture stacked on top.
  // `recap` > 0 surfaces the §453(i) recap-in-year-of-sale view for
  // B's Y0 (the engine doesn't currently produce that row).
  function _recurringBaselineForYear(year, opts) {
    opts = opts || {};
    var recap  = Math.max(0, Number(opts.recap) || 0);
    var status = _readVal('filing-status', 'mfj');
    var state  = _readVal('state-code', 'NONE');
    var ord    = _recurringOrdinary();
    var stGain = Math.max(0, _readNum('short-term-gain'));
    var wages  = Math.max(0, _readNum('w2-wages'));
    var seInc  = Math.max(0, _readNum('se-income'));
    var nIIT_base = stGain
                  + Math.max(0, _readNum('rental-income'))
                  + Math.max(0, _readNum('dividend-income'))
                  + recap;
    var fedB = (typeof root.computeFederalTaxBreakdown === 'function')
      ? root.computeFederalTaxBreakdown(ord, year, status, {
          longTermGain: 0, shortTermGain: stGain, depreciationRecapture: recap,
          investmentIncome: nIIT_base, wages: wages, seIncome: seInc
        })
      : null;
    var fedOrd  = fedB ? Number(fedB.ordinaryTax) || 0 : 0;
    var fedRcap = fedB ? Number(fedB.recapTax)    || 0 : 0;
    var fedLt   = fedB ? Number(fedB.ltTax)       || 0 : 0;
    var amt     = fedB ? Number(fedB.amtTopUp)    || 0 : 0;
    var seTax   = fedB ? Number(fedB.seTax)       || 0 : 0;
    var niit    = fedB ? Number(fedB.niit)        || 0 : 0;
    var addmed  = fedB ? Number(fedB.addlMedicare)|| 0 : 0;
    var fedTotal = fedOrd + fedRcap + fedLt + amt;
    var stateTax = (typeof root.computeStateTax === 'function')
      ? (root.computeStateTax(ord + recap + stGain, year, state, status,
            { longTermGain: 0, shortTermGain: stGain }) || 0)
      : 0;
    var total = fedTotal + niit + addmed + seTax + stateTax;
    return {
      federalIncomeTax: fedTotal,
      ordinaryTax: fedOrd, recapTax: fedRcap, ltTax: fedLt, amt: amt,
      niit: niit, addlMedicare: addmed, seTax: seTax,
      state: stateTax, total: total,
      _recapStacked: recap,
      // Source incomes for the income side of the card. Synthesized
      // years carry these directly; engine rows are filled in by
      // _decorateEngineRow().
      _incomes: { ordinary: ord, longTermGain: 0, shortTermGain: stGain, recapture: recap }
    };
  }

  // For an engine row, the row's `baseline` doesn't preserve the source
  // incomes (only the resulting tax breakdown). Reconstruct what the
  // engine fed into _baseScenarioForYear so the card can show the
  // ordinary / LT / ST / recap lines.
  //
  // Notes:
  //   - Ordinary recurring is read from form inputs (display
  //     approximation; engine inflates by ~2.5%/yr internally — the
  //     small drift is acceptable for CPA verification).
  //   - LT gain comes straight from row.gainRecognized.
  //   - Recapture lands in Y0 for A and C; for B it's already
  //     synthesized in Y0 and the engine row[0] (which becomes Y1
  //     in the B reframe) still includes recap, so we surface it
  //     where the engine put it.
  function _deriveIncomesForEngineRow(row, displayedI, chosen, cfg) {
    var ord = _recurringOrdinary();
    var stGain = Math.max(0, _readNum('short-term-gain'));
    var lt = Math.max(0, Number(row && row.gainRecognized) || 0);
    var recap = 0;
    // Recapture lands in the year-of-sale for all three strategies:
    //   A — row[0] (sale year, immediate)
    //   B — row[0] (sale year, ordinary §453(i); LT gain comes in row[1])
    //   C — row[0] (sale year; LT gain spreads across later rows)
    // displayedI === 0 maps to engine row[0] for all three under the
    // new (post-§453-update) rendering path.
    if (displayedI === 0 && (chosen === 'A' || chosen === 'B' || chosen === 'C')) {
      recap = Math.max(0, Number(cfg && cfg.acceleratedDepreciation) || 0);
    }
    return { ordinary: ord, longTermGain: lt, shortTermGain: stGain, recapture: recap };
  }

  // Resolve the chosen strategy's engine output + funded supplementals.
  // Returns { entry, comp, chosen, fundedSupps } or null.
  function _resolveChosen() {
    var chosen = root.__rettChosenStrategy;
    if (!chosen || (chosen !== 'A' && chosen !== 'B' && chosen !== 'C')) return null;
    if (typeof root.buildInterestedSummary !== 'function') return null;
    var summary = null;
    try { summary = root.buildInterestedSummary(); } catch (e) { return null; }
    if (!summary || !summary.entries) return null;
    var entry = summary.entries.find(function (e) { return e.type === chosen; });
    if (!entry || !entry.cfg) return null;
    var ecfg = entry.cfg;
    if (typeof root.rettFlavorEngineCfg === 'function') {
      try { ecfg = root.rettFlavorEngineCfg(ecfg); } catch (e) { /* */ }
    }
    if (typeof root.unifiedTaxComparison !== 'function') return null;
    var comp;
    try { comp = root.unifiedTaxComparison(ecfg); } catch (e) { return null; }
    if (!comp || !comp.rows) return null;

    // Funded supplementals — only those the master solver ranked as
    // funded after rivalry / availability checks. Same filter the
    // Strategy Summary REVIEW panel uses.
    var fundedSupps = [];
    if (typeof root.runMasterSolver === 'function') {
      var primaryNet = (entry.metrics && Number.isFinite(entry.metrics.net)) ? entry.metrics.net : 0;
      var solverOut = null;
      try { solverOut = root.runMasterSolver(primaryNet); } catch (e) { /* */ }
      if (solverOut && Array.isArray(solverOut.supplementals)) {
        fundedSupps = solverOut.supplementals.filter(function (s) {
          return s && s.enabled && s.available && s.rivalry && s.rivalry.funded;
        });
      }
    }
    return { entry: entry, comp: comp, chosen: chosen, fundedSupps: fundedSupps };
  }

  function _isRelevant(row, i, chosen, cfg) {
    var gain = Number(row && row.gainRecognized) || 0;
    var loss = Number(row && row.lossApplied) || 0;
    if (gain > 0 || loss > 0) return true;
    // Y0 always relevant when the strategy has recapture, regardless
    // of whether the engine row picked it up — recap is recognized in
    // year of sale for every strategy (A/B/C immediate, B/C deferred
    // pay through §453(i)).
    if (i === 0) {
      var recap = Number(cfg && (cfg.depreciationRecapture || cfg.acceleratedDepreciation)) || 0;
      if (recap > 0) return true;
    }
    return false;
  }

  function _stratLabel(t) {
    if (t === 'A') return 'Sell Now';
    if (t === 'B') return 'Seller Finance';
    if (t === 'C') return 'Structured Sale';
    return null;
  }

  function _renderBadge(host, ctx) {
    if (!host) return;
    if (!ctx) {
      host.innerHTML = '<span class="temp-strategy-pill temp-pill-empty">No strategy chosen yet &mdash; pick one on Tab 4 (Projection) to populate.</span>';
      return;
    }
    var label = _stratLabel(ctx.chosen);
    host.innerHTML = '<span class="temp-strategy-pill">Chosen strategy: <strong>' + label + '</strong></span>';
  }

  // INCOME side — three rows the strategy could reduce. Hide ST/LT/recap
  // when 0 to keep cards tight; ordinary is always shown.
  function _renderIncomeRows(incomes) {
    if (!incomes) return '';
    var rows = [
      ['Ordinary income',          incomes.ordinary,    true],
      ['Long-term capital gain',   incomes.longTermGain, false],
      ['Short-term capital gain',  incomes.shortTermGain, false],
      ['Depreciation recapture',   incomes.recapture,    false]
    ];
    return rows.map(function (r) {
      var amt = Number(r[1]) || 0;
      if (!r[2] && amt === 0) return '';
      return '<tr><td>' + r[0] + '</td><td class="temp-amt">' + _fmt(amt) + '</td></tr>';
    }).join('');
  }

  // TAX side — split federal into ordinary / LT cap gains / recap /
  // AMT / NIIT / addl Medicare / SE, plus state, plus total. Hide
  // zero rows except the canonical four (ord, LT, state, total).
  function _renderTaxRows(b) {
    var fedOrd = Number(b.ordinaryTax) || 0;
    var fedLt  = Number(b.ltTax)       || 0;
    var fedRcp = Number(b.recapTax)    || 0;
    var amt    = Number(b.amt)         || 0;
    var niit   = Number(b.niit)        || 0;
    var addmed = Number(b.addlMedicare)|| 0;
    var setax  = Number(b.seTax)       || 0;
    var state  = Number(b.state)       || 0;
    var fedTotal = (b.federalIncomeTax != null) ? Number(b.federalIncomeTax) : (fedOrd + fedRcp + fedLt + amt);
    var total = (b.total != null) ? Number(b.total) : (fedTotal + niit + addmed + setax + state);

    var rows = [
      ['Ordinary income tax',     fedOrd, true],
      ['LT capital gains tax',    fedLt,  true],
      ['Depreciation recap tax',  fedRcp, false],
      ['AMT top-up',              amt,    false],
      ['NIIT (3.8%)',             niit,   false],
      ['Additional Medicare',     addmed, false],
      ['SE / FICA tax',           setax,  false],
      ['State income tax',        state,  true]
    ];
    return rows.map(function (r) {
      var amt2 = Number(r[1]) || 0;
      if (!r[2] && amt2 === 0) return '';
      return '<tr><td>' + r[0] + '</td><td class="temp-amt">' + _fmt(amt2) + '</td></tr>';
    }).join('') +
      '<tr class="temp-total-row"><td><strong>Total tax</strong></td><td class="temp-amt"><strong>' + _fmt(total) + '</strong></td></tr>';
  }

  function _renderBaselineCell(b) {
    if (!b) return '<div class="temp-baseline-empty">No baseline data.</div>';
    var incomeRows = _renderIncomeRows(b._incomes || {});
    var taxRows    = _renderTaxRows(b);
    return '' +
      '<table class="temp-baseline-table">' +
        '<tbody>' +
          (incomeRows
            ? '<tr class="temp-section-head"><td colspan="2">Income (subject to tax)</td></tr>' + incomeRows
            : '') +
          '<tr class="temp-section-head"><td colspan="2">Tax breakdown</td></tr>' +
          taxRows +
        '</tbody>' +
      '</table>';
  }

  // ACTIVITY column — three summed concepts the CPA can verify against
  // the income side. No per-supp breakdown; sums roll up Brooklyn +
  // every funded supp.
  //
  //   ST loss generated     — Brooklyn lossGenerated + supp ST loss
  //                           (Delphi's shortTermLoss allocation)
  //   Ordinary income offset — Brooklyn loss applied to ordinary
  //                            (capped at $3K/yr per §1211(b)) +
  //                            every supp's ordinary deduction
  //                            (Oil & Gas IDC, Charitable §170,
  //                             PTET, Cost Seg, Heavy Vehicle, etc.)
  //   LT gain added         — supp LT gain added (Delphi mainly)
  //
  // Supplementals fire in Y0 only (deployment year). Brooklyn loss
  // generation can land in any year per the engine row.
  function _renderActivityCell(row, displayedI, chosen, cfg, fundedSupps) {
    var stLossBrooklyn = Math.max(0, Number(row && row.lossGenerated) || 0);
    var ordOffsetBrooklyn = 0;
    // Brooklyn applies losses across LT/recap/ord buckets; only the
    // ordinary slice is §1211(b)-capped at $3K. The engine surfaces
    // it on the row's withStrategy as `lossOrdOffsetApplied` when set;
    // if not present, treat Brooklyn ordinary contribution as 0
    // (Brooklyn's loss is overwhelmingly used to offset LT gain, not
    // ordinary, so this is the right default).
    var withStrat = row && row.withStrategy;
    if (withStrat && Number.isFinite(Number(withStrat._ordOffsetApplied))) {
      ordOffsetBrooklyn = Math.max(0, Number(withStrat._ordOffsetApplied) || 0);
    } else if (row && Number.isFinite(Number(row.ordOffsetApplied))) {
      ordOffsetBrooklyn = Math.max(0, Number(row.ordOffsetApplied) || 0);
    }

    // Sum supp activity (Y0 only).
    var stLossSupp = 0;
    var ordOffsetSupp = 0;
    var ltGainAddedSupp = 0;
    if (displayedI === 0 && Array.isArray(fundedSupps)) {
      fundedSupps.forEach(function (s) {
        var extraSpec = (root.__rettSupplementalExtra && root.__rettSupplementalExtra[s.id]) || null;
        var coreSpec  = (root.__rettSupplemental      && root.__rettSupplemental[s.id])      || null;
        var last      = (extraSpec && extraSpec.lastResult)
                     || (coreSpec  && coreSpec.lastResult) || null;
        if (!last) return;
        var detail      = last.detail      || {};
        var allocations = last.allocations || {};
        var perY0       = (Array.isArray(last.perYear) && last.perYear[0]) || {};
        // Ordinary income offset (Oil & Gas IDC deduction, Delphi
        // ordinaryExpense, Charitable deductibleAmount, etc.)
        ordOffsetSupp += Number(
          allocations.ordinaryExpense
          || perY0.deduction
          || detail.deductibleAmount
          || detail.yr1Deduction
          || detail.deduction
          || detail.expense
          || 0
        ) || 0;
        // LT gain added (Delphi alpha layer)
        ltGainAddedSupp += Number(allocations.longTermGainAdded || detail.longTermGainAdded || 0) || 0;
        // ST loss added (Delphi short leg)
        stLossSupp += Number(allocations.shortTermLoss || detail.shortTermLoss || 0) || 0;
      });
    }

    var stLoss      = stLossBrooklyn + stLossSupp;
    var ordOffset   = ordOffsetBrooklyn + ordOffsetSupp;
    var ltGainAdded = ltGainAddedSupp;

    if (stLoss === 0 && ordOffset === 0 && ltGainAdded === 0) {
      return '<div class="temp-activity-empty">No strategy activity this year.</div>';
    }

    var rows = [];
    if (stLoss > 0)      rows.push(['ST loss generated',     _fmt(stLoss)]);
    if (ordOffset > 0)   rows.push(['Ordinary income offset', '&minus;' + _fmt(ordOffset)]);
    if (ltGainAdded > 0) rows.push(['LT gain added',          '+' + _fmt(ltGainAdded)]);

    return '<table class="temp-activity-table"><tbody>' +
      rows.map(function (r) {
        return '<tr><td>' + r[0] + '</td><td class="temp-amt">' + r[1] + '</td></tr>';
      }).join('') +
      '</tbody></table>';
  }

  function _renderYearCard(row, i, chosen, cfg, fundedSupps, stateCode) {
    var year  = Number(row.year) || (i + 1);
    var label = 'Year ' + i + ' (' + year + ')';
    var rel   = _isRelevant(row, i, chosen, cfg);
    var relClass = rel ? 'temp-rel-yes' : 'temp-rel-no';
    var relText  = rel ? 'Relevant' : 'Not relevant';
    var stateTag = stateCode ? ' &mdash; <span class="temp-state-tag">' + stateCode + '</span>' : '';
    return '' +
      '<div class="temp-year-card ' + (rel ? 'is-relevant' : 'is-not-relevant') + '">' +
        '<div class="temp-year-rel ' + relClass + '" aria-label="' + relText + '">' +
          '<div class="temp-rel-eyebrow">' + label + '</div>' +
          '<div class="temp-rel-tag">' + relText + '</div>' +
        '</div>' +
        '<div class="temp-year-baseline">' +
          '<div class="temp-year-head">Tax Baseline &mdash; ' + label + stateTag + '</div>' +
          _renderBaselineCell(row.baseline) +
        '</div>' +
        '<div class="temp-year-activity">' +
          '<div class="temp-year-head temp-year-head-muted">Strategy activity</div>' +
          _renderActivityCell(row, i, chosen, cfg, fundedSupps) +
        '</div>' +
      '</div>';
  }

  // True when the bracket data the engine needs is loaded. tax-data.js
  // declares TAX_DATA as a top-level `const` in a classic script, so
  // it lives on the global lexical scope but does NOT attach to window.
  // Read it through the exported isTaxDataLoaded() probe instead of
  // root.TAX_DATA (which is always undefined).
  function _taxDataReady() {
    if (typeof root.isTaxDataLoaded === 'function') {
      try { return !!root.isTaxDataLoaded(); } catch (e) { /* */ }
    }
    // Fallback: the engine functions hang on the global scope, so if
    // computeFederalTaxBreakdown produces a non-zero ord-tax for a
    // probe income, brackets are loaded. Used only when isTaxDataLoaded
    // isn't exported (older builds).
    if (typeof root.computeFederalTaxBreakdown === 'function') {
      try {
        var probe = root.computeFederalTaxBreakdown(500000, 2026, 'mfj', {});
        return !!(probe && Number(probe.ordinaryTax) > 0);
      } catch (e) { /* */ }
    }
    return false;
  }

  // One-shot promise chain so a hard refresh on Tab 7 paints once
  // brackets are live. Set ONCE on first render() that finds data
  // missing — never re-armed, so we can't loop even if the promise
  // resolves with TAX_DATA still incomplete.
  var _taxWaitArmed = false;

  function _armTaxDataWait() {
    if (_taxWaitArmed) return;
    _taxWaitArmed = true;
    if (typeof root.loadTaxData !== 'function') return;
    try {
      root.loadTaxData().then(function () {
        // Defer the pipeline + paint to the next tick so any sibling
        // listeners (defaults.js's then-handler that repopulates the
        // year dropdown) finish first. Avoids a partial-state read.
        setTimeout(function () {
          if (typeof root.runFullPipeline === 'function') {
            try { root.runFullPipeline(); } catch (e) { /* */ }
          }
          render();
        }, 0);
      }, function () { /* swallow rejection */ });
    } catch (e) { /* */ }
  }

  function render() {
    var host = document.getElementById('temp-baselines');
    var badge = document.getElementById('temp-strategy-badge');
    if (!host) return;

    // Tab 7 isn't currently visible — skip the pipeline run + DOM
    // build entirely. Avoids the post-refresh path where the
    // showPage-temp hook fires while the page is hidden behind a
    // modal/panel and rebuilding while invisible just churns CPU.
    var pageEl = document.getElementById('page-temp');
    var pageVisible = pageEl && pageEl.classList.contains('active');
    if (!pageVisible) return;

    if (!_taxDataReady()) {
      _renderBadge(badge, null);
      host.innerHTML = '<div class="temp-empty">Loading tax brackets&hellip;</div>';
      _armTaxDataWait();
      return;
    }

    if (typeof root.runFullPipeline === 'function') {
      try { root.runFullPipeline(); } catch (e) { /* */ }
    }
    var ctx = _resolveChosen();
    _renderBadge(badge, ctx);
    if (!ctx) {
      host.innerHTML = '<div class="temp-empty">Choose a strategy on Tab 4 (Projection) and load supplemental selections on Tab 5 to populate this view.</div>';
      return;
    }
    // Engine routes A / B / C correctly now. As of the §453 update:
    //   A — single-row immediate sale at year1
    //   B — TWO rows: row[0]=year1 (recap year, ordinary rates per
    //       §453(i)), row[1]=year1+1 (LT gain when buyer pays)
    //   C — multi-row deferred (recap row[0], gain spread over rows)
    // Use engine rows[0..] directly; fill any horizon-trailing slots
    // with recurring-income baselines so the card grid stays at 6 rows.
    var engineRows = ctx.comp.rows || [];
    var inputYear1 = parseInt(_readVal('year1','2026'), 10) || 2026;
    var stateCode = _readVal('state-code', '');
    var year0 = engineRows.length ? Number(engineRows[0].year) : inputYear1;

    var html = '';
    for (var i = 0; i < TOTAL_YEARS; i++) {
      var yr = year0 + i;
      var row = engineRows[i] || null;
      if (row) {
        if (row.baseline && !row.baseline._incomes) {
          row.baseline._incomes = _deriveIncomesForEngineRow(row, i, ctx.chosen, ctx.entry.cfg);
        }
      } else {
        row = {
          year: yr,
          baseline: _recurringBaselineForYear(yr),
          gainRecognized: 0, lossApplied: 0, lossGenerated: 0, investmentThisYear: 0
        };
      }
      html += _renderYearCard(row, i, ctx.chosen, ctx.entry.cfg, ctx.fundedSupps, stateCode);
    }
    host.innerHTML = html;
  }

  root.renderTempPage = render;
})(window);
