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
    if (chosen === 'A' && displayedI === 0) {
      recap = Math.max(0, Number(cfg && cfg.acceleratedDepreciation) || 0);
    } else if (chosen === 'C' && displayedI === 0) {
      recap = Math.max(0, Number(cfg && cfg.acceleratedDepreciation) || 0);
    } else if (chosen === 'B' && displayedI === 1) {
      // Engine bundles recap + gain into row[0] for B (= displayed Y1
      // here). Tab-7 also surfaces recap on Y0 synthesized as a CPA
      // §453(i) check; flag pending engine fix in the prompt.
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
    var stackedRecap = Number(row && row.baseline && row.baseline._recapStacked) || 0;
    if (gain > 0 || loss > 0 || stackedRecap > 0) return true;
    if (i === 0) {
      var recap = Number(cfg && (cfg.depreciationRecapture || cfg.acceleratedDepreciation)) || 0;
      if (recap > 0 && chosen === 'C') return true;
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

  // ACTIVITY column — what was done in this year. Brooklyn rows come
  // from the engine row; supplemental rows surface in Y0 only since
  // most supps fire in the deployment year. If the year has no
  // activity (Not Relevant), show a muted placeholder so the column
  // still occupies its grid cell visually.
  function _renderActivityCell(row, displayedI, chosen, cfg, fundedSupps) {
    var lossGen = Number(row && row.lossGenerated) || 0;
    var lossApp = Number(row && row.lossApplied)   || 0;
    var gain    = Number(row && row.gainRecognized)|| 0;
    var inv     = Number(row && row.investmentThisYear) || 0;
    var bhFee   = Number(row && row.brookhavenFee) || 0;
    var bkFee   = Number(row && row.fee)           || 0;

    var dateLabel = '';
    if (cfg && (cfg.implementationDate || cfg.strategyImplementationDate)) {
      dateLabel = String(cfg.strategyImplementationDate || cfg.implementationDate);
    }

    var rows = [];
    if (inv > 0) {
      rows.push(['Brooklyn investment', _fmt(inv) + (dateLabel && displayedI === 0 ? ' &nbsp;<span class="temp-act-meta">(' + dateLabel + ')</span>' : '')]);
    }
    if (lossGen > 0) rows.push(['Brooklyn ST loss generated', _fmt(lossGen)]);
    if (lossApp > 0) rows.push(['Brooklyn loss applied (offset)', '&minus;' + _fmt(lossApp)]);
    if (gain    > 0) rows.push(['LT gain recognized', _fmt(gain)]);
    if (bkFee   > 0) rows.push(['Brooklyn AM fee', _fmt(bkFee)]);
    if (bhFee   > 0) rows.push(['Brookhaven fee', _fmt(bhFee)]);

    // Supplemental activity — fire in Y0 only (deployment year). Use
    // each supp's lastResult to pull headline effects; show ordinary
    // offset / LT gain added / investment / net benefit lines that
    // are actually populated.
    var suppHtml = '';
    if (displayedI === 0 && Array.isArray(fundedSupps) && fundedSupps.length) {
      var suppRows = fundedSupps.map(function (s) {
        var name = s.name || s.id;
        // Two stores: core supps (oilGas, delphi) live under
        // __rettSupplemental, extra supps under __rettSupplementalExtra.
        var extraSpec = (root.__rettSupplementalExtra && root.__rettSupplementalExtra[s.id]) || null;
        var coreSpec  = (root.__rettSupplemental      && root.__rettSupplemental[s.id])      || null;
        var last      = (extraSpec && extraSpec.lastResult)
                     || (coreSpec  && coreSpec.lastResult)
                     || null;
        var detail      = (last && last.detail)      || {};
        var allocations = (last && last.allocations) || {};
        // Oil & Gas keeps Y1 numbers under perYear[0]; pull from there
        // when the top-level 'investment'/'deduction' aren't on `last`.
        var perY0 = (last && Array.isArray(last.perYear) && last.perYear[0]) ? last.perYear[0] : {};

        var detailHtml = '';
        // Investment (capital deployed)
        var invAmt = Number(
          (last && last.investment)
          || perY0.investment
          || s.investment
          || 0
        );
        if (invAmt > 0) detailHtml += '<div class="temp-supp-line"><span>Capital invested</span><span class="temp-amt">' + _fmt(invAmt) + '</span></div>';
        // Ordinary offset / deduction
        var ordOff = Number(
          allocations.ordinaryExpense
          || perY0.deduction
          || detail.deductibleAmount
          || detail.yr1Deduction
          || detail.deduction
          || detail.expense
          || 0
        );
        if (ordOff > 0) detailHtml += '<div class="temp-supp-line"><span>Ordinary income offset</span><span class="temp-amt">&minus;' + _fmt(ordOff) + '</span></div>';
        // LT gain added (Delphi)
        var ltAdd = Number(allocations.longTermGainAdded || detail.longTermGainAdded || 0);
        if (ltAdd > 0) detailHtml += '<div class="temp-supp-line"><span>LT gain added</span><span class="temp-amt">+' + _fmt(ltAdd) + '</span></div>';
        // ST loss (Delphi)
        var stLoss = Number(allocations.shortTermLoss || detail.shortTermLoss || 0);
        if (stLoss > 0) detailHtml += '<div class="temp-supp-line"><span>ST loss generated</span><span class="temp-amt">+' + _fmt(stLoss) + '</span></div>';
        // Cap-gain avoided (Charitable, appreciated-asset path)
        var cgAvoid = Number(detail.capGainAvoided || 0);
        if (cgAvoid > 0) detailHtml += '<div class="temp-supp-line"><span>Cap-gain avoided</span><span class="temp-amt">' + _fmt(cgAvoid) + '</span></div>';
        // Net benefit
        var net = Number(s.netBenefit || (last && last.netBenefit) || (last && last.totalSaved) || 0);
        if (net > 0) detailHtml += '<div class="temp-supp-line temp-supp-net"><span>Net tax benefit</span><span class="temp-amt">' + _fmt(net) + '</span></div>';
        if (!detailHtml) return '';
        return '<div class="temp-supp-block"><div class="temp-supp-name">' + name + '</div>' + detailHtml + '</div>';
      }).filter(Boolean).join('');
      if (suppRows) {
        suppHtml = '<div class="temp-supp-section"><div class="temp-act-subhead">Supplemental strategies</div>' + suppRows + '</div>';
      }
    }

    if (!rows.length && !suppHtml) {
      return '<div class="temp-activity-empty">No strategy activity this year.</div>';
    }

    var brooklynHtml = rows.length
      ? '<div class="temp-act-subhead">Brooklyn (sale-side)</div>' +
        '<table class="temp-activity-table"><tbody>' +
        rows.map(function (r) {
          return '<tr><td>' + r[0] + '</td><td class="temp-amt">' + r[1] + '</td></tr>';
        }).join('') +
        '</tbody></table>'
      : '';

    return brooklynHtml + suppHtml;
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

  function render() {
    var host = document.getElementById('temp-baselines');
    var badge = document.getElementById('temp-strategy-badge');
    if (!host) return;
    var ctx = _resolveChosen();
    _renderBadge(badge, ctx);
    if (!ctx) {
      host.innerHTML = '<div class="temp-empty">Choose a strategy on Tab 4 (Projection) and load supplemental selections on Tab 5 to populate this view.</div>';
      return;
    }
    var engineRows = ctx.comp.rows || [];
    var inputYear1 = parseInt(_readVal('year1','2026'), 10) || 2026;
    var saleRecap = Math.max(0, _readNum('accelerated-depreciation'));
    var stateCode = _readVal('state-code', '');
    var year0;
    var engineRowOffset;
    if (ctx.chosen === 'B') {
      // B reframe: synthesize Y0 with recap-as-ordinary so the CPA
      // sees the §453(i) view. Engine row[0] = displayed Y1.
      // (Engine fix pending — see prompt.)
      year0 = inputYear1;
      engineRowOffset = 1;
    } else {
      year0 = engineRows.length ? Number(engineRows[0].year) : inputYear1;
      engineRowOffset = 0;
    }

    var html = '';
    for (var i = 0; i < TOTAL_YEARS; i++) {
      var yr = year0 + i;
      var row;
      if (ctx.chosen === 'B' && i === 0) {
        row = {
          year: yr,
          baseline: _recurringBaselineForYear(yr, { recap: saleRecap }),
          gainRecognized: 0, lossApplied: 0, lossGenerated: 0, investmentThisYear: 0
        };
      } else {
        var src = engineRows[i - engineRowOffset] || null;
        if (src) {
          // Engine row — decorate baseline with derived income side.
          row = src;
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
      }
      html += _renderYearCard(row, i, ctx.chosen, ctx.entry.cfg, ctx.fundedSupps, stateCode);
    }
    host.innerHTML = html;
  }

  root.renderTempPage = render;
})(window);
