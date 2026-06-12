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

  // Oil & Gas IDC AMT preference fraction — only the "excess IDC" (~90%, the
  // IDC net of first-year 120-month amortization) is an AMT add-back, not 100%
  // (IRC §57(a)(2); advisor option C, 2026-06-12). Single source of truth lives
  // in master-solver (root.__rettIdcAmtPrefFraction); fall back to 0.90 if the
  // solver hasn't initialized it yet.
  function _idcAmtPrefFraction() {
    var f = Number(root.__rettIdcAmtPrefFraction);
    return (isNaN(f) || f < 0) ? 0.90 : Math.min(1, f);
  }

  // Default number of year cards (Y0..Y_TOTAL_YEARS-1). The actual
  // count is max(TOTAL_YEARS, engineRows.length) — see render() — so a
  // C scenario whose recognition extends past the default still gets
  // every recognition year displayed.
  //
  // Default is 7 (Y0..Y6). Most strategies' tax-relevant years end
  // before Y6, but a few supps could push there (especially with
  // future multi-year deployment of charitable / 401k / etc.).
  var TOTAL_YEARS = 7;

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
    // Mirrors inputs-collector.js _sumIncomeSources for the new income
    // shape: W-2 + ord-div + retirement + interest + business-income,
    // plus signed rental. Legacy se-income / biz-revenue removed
    // (always 0; replaced by #business-income-amount).
    var ord = 0;
    ['w2-wages','dividend-income','retirement-distributions',
     'interest-income','business-income-amount'].forEach(function (id) {
      ord += Math.max(0, _readNum(id));
    });
    ['rental-income'].forEach(function (id) { ord += _readNum(id); });
    return ord;
  }
  function _recurringSeIncome() {
    var biRad = document.querySelector('input[name="business-income-type"]:checked');
    var biType = biRad ? biRad.value : null;
    return (biType === 'se' || biType === 'k1-partnership-gp')
      ? Math.max(0, _readNum('business-income-amount')) : 0;
  }
  function _recurringQualDiv() {
    return Math.max(0, _readNum('qualified-dividends'));
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
    // Income is held FLAT across the projection — only the brackets inflate
    // 2%/yr (passed via `year` to the tax functions). We do NOT project the
    // client's income upward: the engine's own rows keep income constant
    // (so the effective rate drifts DOWN slightly as brackets widen), and
    // the synthetic trailing rows must match. Inflating income here used to
    // grow ordinary income, wages, SE income, and therefore Additional
    // Medicare year-over-year — which is wrong, the threshold is statutory
    // and income is frozen (advisor 2026-06-10).
    var ord    = _recurringOrdinary();
    var stGain = Math.max(0, _readNum('short-term-gain'));
    var wages  = Math.max(0, _readNum('w2-wages'));
    var seInc  = _recurringSeIncome();
    var qualDiv = _recurringQualDiv();
    // NIIT base = recurring passive investment income (rental + dividend +
    // interest) + ST gain + qualified dividends + any recapture. All flat.
    var nIIT_base = stGain + qualDiv
                  + Math.max(0, _readNum('rental-income'))
                  + Math.max(0, _readNum('dividend-income'))
                  + Math.max(0, _readNum('interest-income'))
                  + recap;
    var fedB = (typeof root.computeFederalTaxBreakdown === 'function')
      ? root.computeFederalTaxBreakdown(ord, year, status, {
          longTermGain: 0, shortTermGain: stGain, depreciationRecapture: recap,
          qualifiedDividend: qualDiv,
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
    var recap1245 = 0;
    var recap1250 = 0;
    // Recapture lands in the year-of-sale for all three strategies:
    //   A — row[0] (sale year, immediate)
    //   B — row[0] (sale year, ordinary §453(i); LT gain comes in row[1])
    //   C — row[0] (sale year; LT gain spreads across later rows)
    // displayedY === 0 maps to engine row[0] for all three under the
    // new (post-§453-update) rendering path.
    if (displayedI === 0 && (chosen === 'A' || chosen === 'B' || chosen === 'C')) {
      recap = Math.max(0, Number(cfg && cfg.acceleratedDepreciation) || 0);
      // §1245/§1250 split (advisor 2026-06-04). When the user filled
      // both sub-amounts on Section 02, surface each separately so the
      // CPA-facing card shows the tax-character breakdown. When blank,
      // default the whole recap to §1250 (legacy behavior).
      var _ad1245 = Math.max(0, Number(cfg && cfg.acceleratedDepreciation1245) || 0);
      var _ad1250 = Math.max(0, Number(cfg && cfg.acceleratedDepreciation1250) || 0);
      if (_ad1245 + _ad1250 > 0) {
        recap1245 = _ad1245;
        recap1250 = _ad1250;
      } else {
        recap1245 = 0;
        recap1250 = recap;
      }
    }
    return {
      ordinary: ord,
      longTermGain: lt,
      shortTermGain: stGain,
      recapture: recap,
      recapture1245: recap1245,
      recapture1250: recap1250
    };
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
    // Reflect the optimizer's partial-investment dial-back: run the engine
    // at the DEPLOYED capital, not full available, so the carryover-loss and
    // per-year numbers match the chosen (dialed-back) strategy shown
    // everywhere else. Without this Tab 7 showed the full-deployment
    // carryforward (e.g. $644,676) instead of the actual dialed-back one
    // ($387,616) — the optimizer holds capital back precisely to shed that
    // unused loss (2026-05-28).
    var _pd = entry._partialDeploy;
    if (_pd && Number.isFinite(Number(_pd.deployed)) &&
        Math.round(Number(_pd.deployed)) !== Math.round(Number(ecfg.availableCapital) || 0)) {
      var _dep = Math.max(0, Math.round(Number(_pd.deployed)));
      ecfg = Object.assign({}, ecfg, { availableCapital: _dep, investment: _dep, investedCapital: _dep });
    }
    if (typeof root.rettFlavorEngineCfg === 'function') {
      try { ecfg = root.rettFlavorEngineCfg(ecfg); } catch (e) { /* */ }
    }
    if (typeof root.unifiedTaxComparison !== 'function') return null;
    var comp;
    try { comp = root.unifiedTaxComparison(ecfg); } catch (e) { return null; }
    if (!comp || !comp.rows) return null;

    // Funded supplementals — only those the master solver ranked as
    // funded after rivalry / availability checks. Same filter the
    // Strategy Summary REVIEW panel uses. This keeps the per-year supp
    // contributions exactly equal to runMasterSolver's vetted total —
    // critical for the bottom panel reconciliation to hold. Unfunded
    // supps (rivalry-capped) carry stale lastResult numbers from
    // upstream calc modules that would inflate the per-year sum without
    // a corresponding increase in the aggregate, creating phantom gaps.
    var fundedSupps = [];
    var solverOut = null;
    if (typeof root.runMasterSolver === 'function') {
      var primaryNet = (entry.metrics && Number.isFinite(entry.metrics.net)) ? entry.metrics.net : 0;
      // Post-primary residual cap = Σ withStrategy.total across THIS comp's
      // rows (tax remaining after Brooklyn). Funded supps can't save more
      // than that; passing it keeps the bottom-panel/hero supp total from
      // over-claiming the Brooklyn overlap (advisor 2026-06-09).
      var _ppCap = (comp && Array.isArray(comp.rows))
        ? comp.rows.reduce(function (a, r) { return a + ((r.withStrategy && Number(r.withStrategy.total)) || 0); }, 0)
        : null;
      try { solverOut = root.runMasterSolver(primaryNet, (_ppCap != null ? { postPrimaryTaxRemaining: _ppCap } : undefined)); } catch (e) { /* */ }
      if (solverOut && Array.isArray(solverOut.supplementals)) {
        fundedSupps = solverOut.supplementals.filter(function (s) {
          return s && s.enabled && s.available && s.rivalry && s.rivalry.funded;
        });
      }
    }
    return { entry: entry, comp: comp, chosen: chosen, fundedSupps: fundedSupps, solverOut: solverOut };
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
    if (t === 'A') return 'Traditional Sale';
    if (t === 'B') return 'Installment Sale';
    if (t === 'C') return 'Structured Installment Sale';
    return null;
  }

  function _renderBadge(host, ctx) {
    if (!host) return;
    if (!ctx) {
      host.innerHTML = '<span class="temp-strategy-pill temp-pill-empty">No strategy chosen yet &mdash; pick one on Tab 4 (Projection) to populate.</span>';
      return;
    }
    var label = _stratLabel(ctx.chosen);
    var html = '<span class="temp-strategy-pill">Chosen strategy: <strong>' + label + '</strong></span>';
    // Recommended payment terms for the deferred installment strategies
    // (B / C), rendered from the SAME helper the Tab-4 comparison table
    // uses (projection-dashboard-render.js) and from THIS strategy's
    // chosen cfg (ctx.entry.cfg already reflects its additional-funds
    // amount), so the two pages can never disagree on the schedule.
    var _sched = '';
    if (ctx.entry && ctx.entry.cfg && typeof root.__rettScheduleSummaryLine === 'function') {
      try { _sched = root.__rettScheduleSummaryLine(ctx.entry.cfg) || ''; } catch (e) { _sched = ''; }
    }
    if (_sched) html += '<div class="temp-strategy-schedule">' + _sched + '</div>';
    host.innerHTML = html;
  }

  // INCOME side — reducible buckets the strategy can touch. Hide
  // ST/LT/recap when 0 to keep cards tight; ordinary is always shown.
  // If a carryover loss arrives from the prior year, it lands at the
  // top of this section so the CPA sees the working pool of losses
  // available before any income is even read.
  function _renderIncomeRows(incomes, carryIn) {
    if (!incomes) return '';
    var html = '';
    if (carryIn && carryIn > 0) {
      html += '<tr class="temp-carryin-row"><td>Carryover loss from prior year</td><td class="temp-amt">' + _fmt(carryIn) + '</td></tr>';
    }
    var rows = [
      ['Ordinary income',          incomes.ordinary,    true],
      ['Long-term capital gain',   incomes.longTermGain, false],
      ['Short-term capital gain',  incomes.shortTermGain, false]
    ];
    // §1245 / §1250 recap split (advisor 2026-06-04). Show both rows
    // when EITHER has a non-zero value; collapse to a single "Depreciation
    // recapture" line for legacy / pre-split cases where the split sub-
    // amounts aren't set. §1245 is ordinary-flavored (full marginal,
    // not in NIIT); §1250 is the §1(h)(1)(E) per-slice 25% cap.
    var _r1245 = Number(incomes.recapture1245) || 0;
    var _r1250 = Number(incomes.recapture1250) || 0;
    var _rTotal = Number(incomes.recapture)    || 0;
    if (_r1245 > 0 || _r1250 > 0) {
      rows.push(['Depreciation recapture (§1245)', _r1245, false]);
      rows.push(['Depreciation recapture (§1250)', _r1250, false]);
    } else {
      rows.push(['Depreciation recapture',         _rTotal, false]);
    }
    html += rows.map(function (r) {
      var amt = Number(r[1]) || 0;
      if (!r[2] && amt === 0) return '';
      return '<tr><td>' + r[0] + '</td><td class="temp-amt">' + _fmt(amt) + '</td></tr>';
    }).join('');
    return html;
  }

  // TAX side — split federal into ordinary / LT cap gains / recap /
  // AMT / NIIT / addl Medicare / SE, plus state, plus total. Hide
  // zero rows except the canonical four (ord, LT, state, total).
  function _renderTaxRows(b, opts) {
    opts = opts || {};
    var fedOrd = Number(b.ordinaryTax) || 0;
    var fedLt  = Number(b.ltTax)       || 0;
    var fedRcp = Number(b.recapTax)    || 0;
    var fedRcp1245 = Number(b.recapTax1245) || 0;
    var fedRcp1250 = Number(b.recapTax1250) || 0;
    var amt    = Number(b.amt)         || 0;
    var niit   = Number(b.niit)        || 0;
    var addmed = Number(b.addlMedicare)|| 0;
    var setax  = Number(b.seTax)       || 0;
    var state  = Number(b.state)       || 0;
    var fedTotal = (b.federalIncomeTax != null) ? Number(b.federalIncomeTax) : (fedOrd + fedRcp + fedLt + amt);
    // Sum of the component tax lines this function will render. The displayed
    // recap contribution depends on whether the §1245/§1250 split is shown.
    var _recapShown = (fedRcp1245 > 0 || fedRcp1250 > 0) ? (fedRcp1245 + fedRcp1250) : fedRcp;
    var _componentSum = fedOrd + fedLt + _recapShown + amt + niit + addmed + setax + state;
    // Bridge mode (Results column): the caller passes the CANONICAL post-
    // strategy total (engine total net of all supplemental savings). Render a
    // visible "Less: supplemental tax savings" row equal to the gap between
    // the component lines and that total, so the column literally adds up —
    // components − supplemental savings = Total tax — instead of a Total that
    // silently disagrees with the lines above it (advisor 2026-06-10).
    var _bridgeRow = '';
    var total;
    if (opts.bridgeTotal != null) {
      total = Math.max(0, Number(opts.bridgeTotal) || 0);
      var _less = Math.max(0, _componentSum - total);
      if (_less > 0.5) {
        _bridgeRow = '<tr class="temp-feeline-row"><td>Less: supplemental tax savings</td>' +
          '<td class="temp-amt">&minus;' + _fmt(_less) + '</td></tr>';
      }
    } else {
      total = (b.total != null) ? Number(b.total) : (fedTotal + niit + addmed + setax + state);
    }

    // opts.forceRecap — show the recap lines even when $0 (Results column
    // uses this so the CPA sees the strategy drove recapture tax from $X
    // down via Brooklyn absorption).
    var rows = [
      ['Ordinary income tax',     fedOrd, true],
      ['LT capital gains tax',    fedLt,  true]
    ];
    // §1245 / §1250 recap-tax split (advisor 2026-06-04). Mirrors the
    // income-side split. When the user split the recap on Section 02,
    // show both tax rows. Otherwise collapse to a single "Depreciation
    // recap tax" line (legacy display).
    if (fedRcp1245 > 0 || fedRcp1250 > 0) {
      rows.push(['Depreciation recap tax (§1245)', fedRcp1245, !!opts.forceRecap]);
      rows.push(['Depreciation recap tax (§1250)', fedRcp1250, !!opts.forceRecap]);
    } else {
      rows.push(['Depreciation recap tax',         fedRcp,     !!opts.forceRecap]);
    }
    // When the with-strategy AMT includes an Oil & Gas IDC add-back, label the
    // line so the CPA sees the AMT is IDC-driven and how much was added back
    // (IDC is deducted for regular tax but not AMT — advisor 2026-06-12).
    var _idcAddback = Math.max(0, Number(b.amtIdcAddback) || 0);
    var _amtLabel = _idcAddback > 0
      ? 'AMT top-up — incl. Oil & Gas IDC (' + _fmt(_idcAddback) + ' added back)'
      : 'AMT top-up';
    rows.push([_amtLabel,                 amt,    false]);
    rows.push(['NIIT (3.8%)',             niit,   false]);
    // Additional Medicare = 0.9% × (W-2 wages − threshold). Threshold is
    // statutory (not indexed) and varies by filing status: $250K MFJ /
    // $200K single / $125K MFS / $200K HoH. Show the ACTUAL threshold for
    // THIS return's filing status — the label previously hardcoded "$250K
    // MFJ" for every filer, which mis-stated the trigger for MFS ($125K),
    // single ($200K) and HoH ($200K). (audit 2026-06-12)
    var _amThresh = ({ single: 200000, mfj: 250000, mfs: 125000, hoh: 200000 })[_readVal('filing-status', 'mfj')] || 250000;
    rows.push(["Add'l Medicare (0.9% on W-2 over $" + Math.round(_amThresh / 1000) + "K)", addmed, false]);
    rows.push(['SE / FICA tax',           setax,  false]);
    rows.push(['State income tax',        state,  true]);
    return rows.map(function (r) {
      var amt2 = Number(r[1]) || 0;
      if (!r[2] && amt2 === 0) return '';
      return '<tr><td>' + r[0] + '</td><td class="temp-amt">' + _fmt(amt2) + '</td></tr>';
    }).join('') +
      _bridgeRow +
      '<tr class="temp-total-row"><td><strong>Total tax</strong></td><td class="temp-amt"><strong>' + _fmt(total) + '</strong></td></tr>';
  }

  // RESULTS side — the post-strategy tax breakdown (row.withStrategy).
  // Same line-by-line shape as the baseline tax breakdown (federal
  // ordinary / LT cap gains / §1250 recap / AMT / NIIT / Add'l Medicare
  // / SE / state / total) but reflecting the strategy's effect. Adds a
  // "Tax saved vs baseline" line comparing to the baseline total so the
  // CPA sees the year's net tax movement. withStrategy carries the same
  // keys baseline does (verified) so _renderTaxRows works directly.
  // Pull per-line tax-savings deltas from each funded supp's perYear slice
  // (OG ships fedOrdSaved / fed1245Saved / fed1250Saved / niitDelta / stateSaved
  // / amtDelta). Tab 7 right column uses these to compute the TRUE post-supp
  // tax on each bucket — replaces the prior proportional-by-absorbed-$
  // allocation, which over-attributed savings to ordinary tax when supp
  // total exceeded the engine's pre-supp ord tax line (zeroing it out
  // even when meaningful ordinary income remained).
  // Per-year saturation scale for a funded supp — the SINGLE source of
  // truth shared by every per-supp reconstruction on this page (activity
  // column, results-column ord offset, results-column per-line tax savings,
  // and the gross/net path). When the funded supps' combined Y0 ordinary
  // deduction exceeds the available Y0 ordinary pool, the master-solver
  // clips each supp's realized benefit; Y0 may be scaled down while Y1+
  // passes through unchanged (each future year has its own pool). Every
  // column MUST apply the same scale or the year card contradicts itself —
  // e.g. the activity column showing a clipped offset while the results
  // column reduces income by the unclipped amount (advisor 2026-06-10).
  function _suppSatScale(s, displayedI) {
    var y0 = Number.isFinite(Number(s.y0SaturationScale))
      ? Number(s.y0SaturationScale)
      : (Number.isFinite(Number(s.saturationScale)) ? Number(s.saturationScale) : 1);
    var y1 = Number.isFinite(Number(s.y1PlusSaturationScale))
      ? Number(s.y1PlusSaturationScale) : 1;
    return (displayedI === 0) ? y0 : y1;
  }

  function _computeSuppLineSavings(displayedI, fundedSupps) {
    var acc = { fedOrd: 0, fed1245: 0, fed1250: 0, fedLt: 0, amt: 0, niit: 0, addmed: 0, state: 0 };
    if (!Array.isArray(fundedSupps)) return acc;
    fundedSupps.forEach(function (s) {
      var coreSpec  = (root.__rettSupplemental      && root.__rettSupplemental[s.id])      || null;
      var extraSpec = (root.__rettSupplementalExtra && root.__rettSupplementalExtra[s.id]) || null;
      var last = (coreSpec && coreSpec.lastResult) || (extraSpec && extraSpec.lastResult) || null;
      if (!last) return;
      var perYear = Array.isArray(last.perYear) ? last.perYear : null;
      var py = (perYear && perYear[displayedI]) ? perYear[displayedI] : null;
      if (!py) return;
      var sc = _suppSatScale(s, displayedI);
      acc.fedOrd  += Math.max(0, Number(py.fedOrdSaved)  || 0) * sc;
      acc.fed1245 += Math.max(0, Number(py.fed1245Saved) || 0) * sc;
      acc.fed1250 += Math.max(0, Number(py.fed1250Saved) || 0) * sc;
      acc.niit    += Math.max(0, Number(py.niitDelta)    || 0) * sc;
      acc.addmed  += Math.max(0, Number(py.addmedDelta)  || 0) * sc;
      acc.state   += Math.max(0, Number(py.stateSaved)   || 0) * sc;
      acc.amt     += Math.max(0, Number(py.amtDelta)     || 0) * sc;
    });
    return acc;
  }

  // Recompute the post-strategy tax on the ACTUAL post-strategy income,
  // exactly the way the engine computes every other row (same federal
  // breakdown + state fold-in). The old Results column hand-synthesized the
  // tax by subtracting per-supp savings line-by-line, which (a) never
  // restacked the LT-gain brackets after the supps lowered ordinary income —
  // so LT tax stayed at its full-income value — and (b) drove Total tax to a
  // value that didn't match its own line items (advisor 2026-06-10: "Total
  // tax 0 while ordinary + state ~ $32K"). Recomputing on the reduced income
  // makes every line correct AND the total the sum of those lines by
  // construction. Mirrors tax-comparison.js's fed/state call verbatim.
  function _recomputePostStrategyTax(incomes, year, status, stateCode, struct) {
    if (typeof root.computeFederalTaxBreakdown !== 'function') return null;
    incomes = incomes || {}; struct = struct || {};
    var ord    = Math.max(0, Number(incomes.ordinary)      || 0);
    var lt     = Math.max(0, Number(incomes.longTermGain)  || 0);
    var st     = Math.max(0, Number(incomes.shortTermGain) || 0);
    var r1245  = Math.max(0, Number(incomes.recapture1245) || 0);
    var r1250  = Math.max(0, Number(incomes.recapture1250) || 0);
    var rcp    = (r1245 + r1250) > 0 ? (r1245 + r1250)
                                     : Math.max(0, Number(incomes.recapture) || 0);
    var qd  = Math.max(0, Number(struct.qualifiedDividend) || 0);
    // Earned-income bases for SE/FICA tax + Additional Medicare. The caller
    // passes seReduction = the SUPPLEMENTAL ordinary offset for the year (NOT
    // the Brooklyn §1211(b) capital-loss offset, which doesn't touch earned
    // income). It reduces SE earnings first (active business deductions —
    // working-interest IDC, §179+bonus, materially-participated K-1 loss — do
    // lower SE net earnings, dropping SE/FICA tax and the SE side of Add'l
    // Medicare). Any remainder is then applied to the W-2 wage base.
    //
    // ADVISOR OVERRIDE (2026-06-10): reducing the W-2 wage base makes Add'l
    // Medicare fall with taxable income even for a pure W-2 earner. This is NOT
    // strictly correct — employer-reported Medicare wages (Box 5) aren't
    // reduced by these deductions — so it OVERSTATES the benefit for a W-2
    // client by the Add'l Medicare delta. Deliberate model choice per advisor.
    var earnedRed = Math.max(0, Number(struct.seReduction) || 0);
    var seRaw = Math.max(0, Number(struct.seIncome) || 0);
    var seCut = Math.min(earnedRed, seRaw);
    var se  = seRaw - seCut;
    var w   = Math.max(0, (Number(struct.wages) || 0) - Math.max(0, earnedRed - seCut));
    var itm = Math.max(0, Number(struct.itemized) || 0);
    // NIIT base = net investment income. §1250 unrecaptured gain IS net
    // investment income (gain on disposition of property) and must be in the
    // base — the baseline path (_recurringBaselineForYear + the engine row)
    // already includes recapture, so excluding it here understated the Results
    // NIIT and overstated the tax saved (audit 2026-06-10). §1245 is ORDINARY
    // income, not capital gain, so it stays OUT of the NIIT base.
    var inv = lt + qd + st + r1250;
    var fed;
    try {
      fed = root.computeFederalTaxBreakdown(ord, year, status, {
        longTermGain: lt, shortTermGain: st, qualifiedDividend: qd,
        depreciationRecapture: rcp,
        depreciationRecapture1245: r1245,
        depreciationRecapture1250: r1250,
        investmentIncome: inv, wages: w, seIncome: se, itemized: itm,
        // Oil & Gas IDC AMT preference: the O&G IDC ordinary offset is deducted
        // for regular tax (already removed from `ord`) but added BACK to AMTI —
        // IDC isn't deductible for AMT (advisor 2026-06-12).
        amtIdcPreference: Math.max(0, Number(struct.amtIdcPreference) || 0)
      }) || {};
    } catch (e) { return null; }
    var capLossOff = Math.max(0, Number(fed.lossOrdOffsetApplied) || 0);
    var stateLT = Number.isFinite(Number(fed.netLongTermGain))  ? Number(fed.netLongTermGain)  : lt;
    var stateST = Number.isFinite(Number(fed.netShortTermGain)) ? Number(fed.netShortTermGain) : st;
    var stateTax = 0;
    if (typeof root.computeStateTax === 'function') {
      try {
        stateTax = Number(root.computeStateTax(
          (ord - capLossOff) + rcp + qd + stateLT + stateST,
          year, stateCode, status,
          { itemized: itm, longTermGain: stateLT, lossOrdOffsetApplied: capLossOff }
        )) || 0;
      } catch (e) { stateTax = 0; }
    }
    var _o = Number(fed.ordinaryTax) || 0;
    var _r = Number(fed.recapTax)    || 0;
    var _l = Number(fed.ltTax)       || 0;
    var _a = Number(fed.amtTopUp)    || 0;
    return {
      ordinaryTax:  _o,
      recapTax:     _r,
      recapTax1245: Number(fed.recapTax1245) || 0,
      recapTax1250: Number(fed.recapTax1250) || 0,
      ltTax:        _l,
      amt:          _a,
      niit:         Number(fed.niit) || 0,
      addlMedicare: Number(fed.addlMedicare) || 0,
      seTax:        Number(fed.seTax) || 0,
      state:        stateTax,
      amtIdcAddback: Math.max(0, Number(struct.amtIdcPreference) || 0),
      federalIncomeTax: _o + _r + _l + _a,
      total:        (Number(fed.total) || 0) + stateTax
    };
  }

  function _renderResultsCell(withStrategy, baseline, suppTaxSaved, suppOffsetSplit, suppLineSavings, row, lowerBracketBenefit) {
    if (!withStrategy) return '<div class="temp-baseline-empty">No result data.</div>';
    var _suppTaxSaved = Math.max(0, Math.round(Number(suppTaxSaved) || 0));
    // suppOffsetSplit shape: { ord, r1245, r1250, total } (post-2026-06-08).
    // Legacy numeric fallback supported (treat as all-ord) so older callers
    // still render correctly.
    var _split = suppOffsetSplit;
    if (typeof _split === 'number') _split = { ord: _split, r1245: 0, r1250: 0, total: _split };
    if (!_split) _split = { ord: 0, r1245: 0, r1250: 0, total: 0 };
    var _offOrd   = Math.max(0, Math.round(Number(_split.ord)   || 0));
    var _off1245  = Math.max(0, Math.round(Number(_split.r1245) || 0));
    var _off1250  = Math.max(0, Math.round(Number(_split.r1250) || 0));
    var _offTotal = _offOrd + _off1245 + _off1250;
    // Income RECOGNIZED under the strategy this year — show the income
    // that ACTUALLY hits the tax engine after EVERY activity item this
    // year has been applied. Two sources of reduction stack:
    //
    //   1. Supplemental ord/§1245/§1250 absorption (OG IDC, Delphi ord
    //      expense, etc.). Tracked in suppOffsetSplit{ ord, r1245, r1250 }.
    //
    //   2. Brooklyn ST-loss application — split across buckets:
    //        row.ltOffsetApplied         → reduces LT capital gain
    //        row.ordOffsetApplied        → reduces ordinary income
    //                                      (§1211(b) cap, typically $3K MFJ)
    //        row.recap1250OffsetApplied  → reduces §1250 unrecap gain
    //        row.shortOffsetApplied      → reduces short-term gain
    //
    // Without subtracting #2, the income lines showed the full pre-Brooklyn
    // gain even though the tax lines below reflected Brooklyn's full
    // absorption — internally inconsistent (e.g., "LT gain $7.6M / LT
    // tax $0" reads as "$0 tax on $7.6M of gain"). User feedback
    // 2026-06-09: shown income = what's being taxed. Apply both stacks.
    var _btLt   = Math.max(0, Number(row && row.ltOffsetApplied)        || 0);
    var _btOrd  = Math.max(0, Number(row && row.ordOffsetApplied)       || 0);
    var _bt1250 = Math.max(0, Number(row && row.recap1250OffsetApplied) || 0);
    var _btSt   = Math.max(0, Number(row && row.shortOffsetApplied)     || 0);
    var incomeRows = '';
    var _incomes = null;
    if (baseline && baseline._incomes) {
      _incomes = baseline._incomes;
      if (_offTotal > 0 || _btLt > 0 || _btOrd > 0 || _bt1250 > 0 || _btSt > 0) {
        _incomes = Object.assign({}, _incomes, {
          ordinary:       Math.max(0, Number(_incomes.ordinary       || 0) - _offOrd  - _btOrd),
          longTermGain:   Math.max(0, Number(_incomes.longTermGain   || 0) - _btLt),
          shortTermGain:  Math.max(0, Number(_incomes.shortTermGain  || 0) - _btSt),
          recapture1245:  Math.max(0, Number(_incomes.recapture1245  || 0) - _off1245),
          recapture1250:  Math.max(0, Number(_incomes.recapture1250  || 0) - _off1250 - _bt1250),
          recapture:      Math.max(0, Number(_incomes.recapture      || 0) - _off1245 - _off1250 - _bt1250)
        });
      }
      incomeRows = _renderIncomeRows(_incomes, 0);
    }
    // Recompute the post-strategy tax on the post-strategy income (_incomes)
    // the SAME way the engine computes every other row, so the tax lines
    // actually correspond to the income shown and the Total is their honest
    // sum. The structural (strategy-invariant) inputs — wages, SE income,
    // qualified dividends, itemized — come from the live inputs; the
    // reducible income comes from _incomes. Falls back to the raw engine
    // row only if the calc functions or income aren't available.
    var _struct = {};
    var _status = 'mfj', _stateCode = (typeof row !== 'undefined' && row && row.stateCode) || 'NONE';
    if (typeof root.collectInputs === 'function') {
      try {
        var _ci = root.collectInputs() || {};
        _status    = _ci.filingStatus || 'mfj';
        _stateCode = _ci.state || _ci.stateCode || _stateCode;
        _struct = {
          qualifiedDividend: _ci.qualifiedDividend,
          wages:             _ci.wages,
          seIncome:          _ci.seIncome,
          itemized:          _ci.itemizedDeductions || _ci.itemized,
          // Supps reduce SE earnings (and thus SE tax + the SE side of Add'l
          // Medicare). Use ONLY the supplemental ord offset (_offOrd), never
          // the Brooklyn §1211(b) offset (_btOrd) — capital losses don't
          // reduce earned income. W-2 wages stay fixed in `wages` above.
          seReduction:       _offOrd,
          // Oil & Gas IDC is added back to AMTI (deducted for regular tax only).
          // Only the excess IDC (~90%) is the preference — see _idcAmtPrefFraction.
          amtIdcPreference:  Math.max(0, Math.round((Number(_split.oilGasOrd) || 0) * _idcAmtPrefFraction()))
        };
      } catch (e) { /* keep defaults */ }
    }
    var _year = Number(row && row.year) || 0;
    if (!_year && typeof root.collectInputs === 'function') {
      try { _year = Number((root.collectInputs() || {}).year1) || 0; } catch (e) {}
    }
    var _recomp = _incomes ? _recomputePostStrategyTax(_incomes, _year, _status, _stateCode, _struct) : null;
    var _wsDisplay = _recomp || Object.assign({}, withStrategy);
    // Force the recap line to show when the baseline had recapture tax,
    // so the CPA sees it drop to $0 (or whatever residual) under the
    // strategy rather than the row silently disappearing.
    var baselineHadRecap = baseline && Number(baseline.recapTax) > 0;
    var taxRows = _renderTaxRows(_wsDisplay, { forceRecap: baselineHadRecap });
    var suppSavedRow = '';
    // No "Net tax after supplementals" row needed — the synthesized
    // _wsDisplay.total in the Total row above already reflects post-supp
    // tax (per-line reductions handled the bulk; residual row above
    // explains any remainder).
    var netTaxRow = '';
    var savedRow = '';
    if (baseline && baseline.total != null && _wsDisplay && _wsDisplay.total != null) {
      // Saved = baseline total − recomputed post-strategy total. Both sides
      // are computed the same way (engine federal breakdown + state fold-in)
      // so this is an apples-to-apples year tax delta that ties to the lines
      // shown above it (baseline − results = saved). PLUS the deferral /
      // lower-tax-bracket benefit (allocated to Y0 by the render loop): the
      // value of recognizing the gain in a later year is a real saving that
      // the matched-timing baseline can't see on any single year, so it's
      // folded into Y0's tax-saved here. This makes Σ (per-year tax saved)
      // across the cards equal the bottom panel's "total tax saved" — the
      // advisor's reconciliation model (advisor 2026-06-10).
      var saved = Number(baseline.total) - Number(_wsDisplay.total) + (Number(lowerBracketBenefit) || 0);
      if (Math.abs(saved) > 0.5) {
        var cls = saved >= 0 ? 'temp-result-saved-row' : 'temp-result-saved-row temp-result-saved-neg';
        var label = saved >= 0 ? 'Tax saved vs baseline' : 'Tax increase vs baseline';
        savedRow = '<tr class="' + cls + '"><td><strong>' + label + '</strong></td>' +
          '<td class="temp-amt"><strong>' + _fmt(Math.abs(saved)) + '</strong></td></tr>';
      }
    }
    return '' +
      '<table class="temp-baseline-table">' +
        '<tbody>' +
          (incomeRows
            ? '<tr class="temp-section-head"><td colspan="2">Income recognized (with strategy)</td></tr>' + incomeRows
            : '') +
          '<tr class="temp-section-head"><td colspan="2">Tax with strategy applied</td></tr>' +
          taxRows +
          suppSavedRow +
          netTaxRow +
          savedRow +
        '</tbody>' +
      '</table>';
  }

  function _renderBaselineCell(b, carryIn, carryOut) {
    if (!b) return '<div class="temp-baseline-empty">No baseline data.</div>';
    var incomeRows = _renderIncomeRows(b._incomes || {}, carryIn);
    var taxRows    = _renderTaxRows(b);
    var carryOutRow = (carryOut && carryOut > 0)
      ? '<tr class="temp-carryout-row"><td>Carryover loss to next year</td><td class="temp-amt">' + _fmt(carryOut) + '</td></tr>'
      : '';
    return '' +
      '<table class="temp-baseline-table">' +
        '<tbody>' +
          (incomeRows
            ? '<tr class="temp-section-head"><td colspan="2">Income (subject to tax)</td></tr>' + incomeRows
            : '') +
          '<tr class="temp-section-head"><td colspan="2">Tax breakdown</td></tr>' +
          taxRows +
          carryOutRow +
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
  //                            every funded supp's ordinary deduction
  //                            FOR THIS YEAR (Oil & Gas spreads IDC
  //                            across multiple years; other supps
  //                            fire only in their deployment year)
  //   LT gain added         — supp LT gain added (Delphi mainly)
  //
  // Per-year supp resolution:
  //   - If supp.lastResult.perYear[displayedI] exists, use that year's
  //     deduction/investment/etc. (Oil & Gas now spreads 4 years).
  //   - Else if displayedI === 0, fall back to the legacy single-year
  //     shape (allocations.ordinaryExpense, detail.deductibleAmount,
  //     etc. — Delphi, Charitable, PTET, Cost Seg, Heavy Vehicle,
  //     Aircraft, STR, Farm Equip, 401k, Augusta, Equipment Leasing).
  //     These are still single-year until the engine ships per-year
  //     shape for them too — see prompt drafted earlier.
  function _renderActivityCell(row, displayedI, chosen, cfg, fundedSupps, feeScale, lowerBracketBenefit) {
    var stLossBrooklyn = Math.max(0, Number(row && row.lossGenerated) || 0);
    var ordOffsetBrooklyn = 0;
    var withStrat = row && row.withStrategy;
    if (withStrat && Number.isFinite(Number(withStrat._ordOffsetApplied))) {
      ordOffsetBrooklyn = Math.max(0, Number(withStrat._ordOffsetApplied) || 0);
    } else if (row && Number.isFinite(Number(row.ordOffsetApplied))) {
      ordOffsetBrooklyn = Math.max(0, Number(row.ordOffsetApplied) || 0);
    }

    var stLossSupp = 0;
    var ordOffsetSupp = 0;
    var ltGainAddedSupp = 0;
    var otherTaxSaved = 0;
    // Per-supp itemization: capture each funded supp's contribution to the
    // four accumulators as a DELTA (snapshot the globals before/after the
    // accumulation body) so the activity column can list each strategy on
    // its own line — e.g. "Oil & Gas — ordinary income offset $X" and
    // "Equipment Leasing — ordinary income offset $Y" as two distinct rows
    // even though both are ordinary offsets. Display-only; gross/net math
    // is unaffected (that path runs through _computeSuppSavingsForYear).
    var suppEntries = [];
    if (Array.isArray(fundedSupps)) {
      var _accumulateSupp = function (s) {
        var extraSpec = (root.__rettSupplementalExtra && root.__rettSupplementalExtra[s.id]) || null;
        var coreSpec  = (root.__rettSupplemental      && root.__rettSupplemental[s.id])      || null;
        var last      = (extraSpec && extraSpec.lastResult)
                     || (coreSpec  && coreSpec.lastResult) || null;
        if (!last) return;
        // Per-year saturation scale — shared with _computeSuppSavingsForYear,
        // _computeSuppOrdOffsetForYear and _computeSuppLineSavings via the
        // _suppSatScale helper so every column of the year card reflects the
        // SAME post-competition allocation. Without it, a supp's ordinary
        // offset / "other tax savings" stayed frozen at its STANDALONE demand
        // when a rival supp was added to the same Y0 ordinary pool — e.g. Oil
        // & Gas offset didn't shrink and PTET printed its uncompeted net
        // (advisor 2026-06-10).
        var _satScale = _suppSatScale(s, displayedI);
        // Track whether THIS supp contributed to ord/LT/ST in this
        // year. If it didn't but it has netBenefit > 0 (e.g. PTET, which
        // shifts state tax to federal deduction without offsetting
        // ordinary income directly), surface its tax saved separately
        // under "Other tax savings". Single-year supps fire in Y0;
        // multi-year supps that emit per-year netBenefit / taxSaved
        // pick up the right slice. PTET is currently single-year but
        // the engine plans to ship multi-year for it — when it does,
        // perYear[i].netBenefit / taxSaved on this supp will land here.
        var contributedThisYear = false;
        var perYear     = Array.isArray(last.perYear) ? last.perYear : null;
        // Multi-year shape: pull THIS displayed year's slice if it
        // exists in perYear[]. Oil & Gas (perYearLength=4 typical for
        // C / B-with-multi-year-IDC) lights up Y0..Y3 each.
        //
        // Use `absorbed` when present (Oil & Gas) — that's the portion
        // of the gross deduction that actually offset ordinary income.
        // Anything in `deduction` that exceeds `absorbed` is NOL
        // (currently dropped by the engine — flagged separately).
        // CPAs read this line as "what reduced my ordinary income,"
        // not "what we tried to deduct."
        if (perYear && perYear[displayedI]) {
          var py = perYear[displayedI];
          var ordContribution = (py.absorbed != null)
            ? Number(py.absorbed)
            : Number(py.deduction || 0);
          if (ordContribution > 0) { ordOffsetSupp += ordContribution * _satScale; contributedThisYear = true; }
          var ltAdd = Number(py.longTermGainAdded || 0) || 0;
          if (ltAdd > 0) { ltGainAddedSupp += ltAdd * _satScale; contributedThisYear = true; }
          var stAdd = Number(py.shortTermLoss || 0) || 0;
          if (stAdd > 0) { stLossSupp += stAdd * _satScale; contributedThisYear = true; }
          // Per-year netBenefit / taxSaved that didn't come through
          // an ord/LT/ST contribution (e.g. PTET when engine ships
          // multi-year). Falls into "Other tax savings" line.
          if (!contributedThisYear) {
            var pyTax = Number(py.netBenefit || py.taxSaved || 0) || 0;
            if (pyTax > 0) { otherTaxSaved += pyTax * _satScale; contributedThisYear = true; }
          }
          return;
        }
        // Legacy single-year shape. Most supps fire their ord deduction
        // in Y0 only and stash it under a per-supp-named key in
        // `detail` or `allocations`. Some now ship a tiny multi-year
        // shape (charitable's deductionY0 / deductionPerYearAfterY0)
        // so contribute on later years too if those keys are present.
        var detail      = last.detail      || {};
        var allocations = last.allocations || {};

        // Unified multi-year shape (post-rename 2026-05-09): every
        // annual-recurring supp now exposes per-year
        //   ordOffsetY0 / ordOffsetRestPerYear  — the action $
        //   taxSavingsY0 / taxSavingsRestPerYear — the resulting tax $
        // plus yearCount. Charitable, PTET, Augusta, and 401(k) all
        // ship this shape. Ord offset goes to the "Ordinary income
        // offset" line; tax savings flow into the gross-benefit total
        // via _computeSuppSavingsForYear.
        if (detail.ordOffsetY0 != null || detail.ordOffsetRestPerYear != null) {
          var yearCount = Number(detail.yearCount || 1);
          if (displayedI < yearCount) {
            var offsetThisYear = (displayedI === 0)
              ? Number(detail.ordOffsetY0 || 0)
              : Number(detail.ordOffsetRestPerYear || 0);
            if (offsetThisYear > 0) { ordOffsetSupp += offsetThisYear * _satScale; contributedThisYear = true; }
          }
          return;
        }
        // Indirect-effect supp without an ord offset (none today; here
        // for forward-compat). Surfaces the year's tax savings under
        // "Other tax savings".
        if (detail.taxSavingsY0 != null || detail.taxSavingsRestPerYear != null) {
          var ycB = Number(detail.yearCount || 1);
          if (displayedI < ycB) {
            var netThisYear = (displayedI === 0)
              ? Number(detail.taxSavingsY0 || 0)
              : Number(detail.taxSavingsRestPerYear || 0);
            if (netThisYear > 0) { otherTaxSaved += netThisYear * _satScale; contributedThisYear = true; }
          }
          return;
        }

        // True single-year supps — only contribute to Y0.
        if (displayedI !== 0) return;

        // Ord deduction key varies by supp:
        //   Delphi          — allocations.ordinaryExpense
        //   Charitable      — detail.deductibleAmount (legacy single-year)
        //   PTET            — no direct ord deduction (shifts state↔federal); skip
        //   Cost Seg slot05 — detail.year1Deduction (note casing)
        //   Heavy Veh slot06— detail.yr1Deduction
        //   Eq Leasing 07   — detail.yr1Loss (passive activity loss)
        //   Augusta 08      — detail.businessRent (rental expense to owner)
        //   401(k)+PS 09    — detail.totalContribution (employer + elective)
        //   Aircraft 10     — detail.yr1Deduction
        //   STR Loop 11     — detail.year1Deduction
        //   Farm Equip 12   — detail.total (§179 + bonus)
        var ordKeyValue = Number(
          allocations.ordinaryExpense
          || detail.deductibleAmount
          || detail.year1Deduction
          || detail.yr1Deduction
          || detail.yr1Loss
          || detail.businessRent
          || detail.totalContribution
          || detail.total
          || detail.deduction
          || detail.expense
          || 0
        ) || 0;
        if (ordKeyValue > 0) { ordOffsetSupp += ordKeyValue * _satScale; contributedThisYear = true; }
        var ltAdd2 = Number(allocations.longTermGainAdded || detail.longTermGainAdded || 0) || 0;
        if (ltAdd2 > 0) { ltGainAddedSupp += ltAdd2 * _satScale; contributedThisYear = true; }
        var stAdd2 = Number(allocations.shortTermLoss || detail.shortTermLoss || 0) || 0;
        if (stAdd2 > 0) { stLossSupp += stAdd2 * _satScale; contributedThisYear = true; }
        // Indirect-effect supps (PTET shifts state→fed, no direct ord
        // offset) — when nothing in ord/LT/ST captured the supp's
        // impact this year, surface its competed net under "Other
        // tax savings" so the CPA sees what each strategy is doing.
        // Prefer realizedNetBenefit (saturation + residual-cap clipped,
        // the SAME figure the Strategy Summary prints per supp) so the two
        // surfaces agree; fall back to scaled raw net only when realized
        // isn't present.
        if (!contributedThisYear) {
          var net = Number.isFinite(Number(s.realizedNetBenefit))
            ? Number(s.realizedNetBenefit)
            : (Number(s.netBenefit || last.netBenefit || last.totalSaved || 0) || 0) * _satScale;
          if (net > 0) otherTaxSaved += net;
        }
      };
      fundedSupps.forEach(function (s) {
        var _o0 = ordOffsetSupp, _l0 = ltGainAddedSupp, _s0 = stLossSupp, _t0 = otherTaxSaved;
        _accumulateSupp(s);
        suppEntries.push({
          id:    s.id,
          name:  (s.name || s.id),
          ord:   ordOffsetSupp   - _o0,
          lt:    ltGainAddedSupp - _l0,
          st:    stLossSupp      - _s0,
          other: otherTaxSaved   - _t0
        });
      });
    }

    var stLoss      = stLossBrooklyn + stLossSupp;
    var ordOffset   = ordOffsetBrooklyn + ordOffsetSupp;
    var ltGainAdded = ltGainAddedSupp;
    var other       = otherTaxSaved;

    // Per-year supp management fees (Delphi). Surface as an explicit
    // line so the CPA sees how the fee allocates each year, and so the
    // sum of "Gross benefit" rows across years reconciles to the bottom
    // Fees panel's "Supplemental tax savings (vetted total)" — which is
    // already net of mgmt fees via runMasterSolver. Without this row the
    // per-year sum drifts by Delphi's mgmt fee.
    var suppMgmtFee = _computeSuppMgmtFeeForYear(displayedI, fundedSupps);

    // Brooklyn per-year tax delta. Use row.doNothingBaseline.total
    // (the honest "did nothing — gain at Y0 lump" baseline) when
    // available — that's what the engine sums into comp.totalSavings.
    // For deferred strategies (B/C), r.baseline.total is the MATCHED
    // baseline (year-of-recognition timing), which differs from the
    // do-nothing baseline; using r.baseline here drifted Tab 7's
    // per-year sum away from the bottom panel by the gain-timing
    // difference. Signed — when fees exceed savings in a year, delta
    // is negative; that lands in the per-year row and the sum still
    // reconciles to comp.totalSavings.
    // Per-year delta uses the MATCHED-TIMING baseline (r.baseline.total),
    // not the do-nothing lump-in-Y0 baseline (r.doNothingBaseline.total).
    // For Structured Sale C, the do-nothing baseline assumes the full
    // gain would have been realized in Y0 — so Y0's doNothing − with
    // includes "savings from deferring the gain itself," which the CPA
    // can't attribute to any specific year's actions. The matched-timing
    // baseline assumes the gain is recognized when the engine schedules
    // it (e.g. Y3-Y4 for C); Y0's matched-timing delta then reflects
    // only the Y0-specific actions (Brooklyn absorbing recap, supps
    // doing their thing). The bottom-panel total still uses engine's
    // authoritative aggregate (which includes deferral savings) —
    // sum-of-per-year may be smaller than bottom-panel total by the
    // timing-shift portion. That gap is footnoted on the panel.
    var brooklynSavings = 0;
    if (row && row.withStrategy && row.baseline) {
      // Per-year savings use the MATCHED-TIMING baseline so each year's
      // savings line is an apples-to-apples comparison for actions
      // happening THAT year. The one-time "lower tax bracket" benefit
      // (the gap between matched-timing and do-nothing aggregates) is
      // allocated by render() to Y0 only via lowerBracketBenefit; that
      // makes Σ year-card net benefits = Tab 6 hero net.
      brooklynSavings = Number(row.baseline.total || 0) - Number(row.withStrategy.total || 0);
    }
    var lbb = (displayedI === 0 && Number.isFinite(Number(lowerBracketBenefit)))
      ? Math.round(Number(lowerBracketBenefit))
      : 0;
    // Supp savings for the year — TRUE gross (no fees subtracted).
    // The supp mgmt fee is displayed as its own "Less:" row below and
    // subtracted once in netForYear. (Pre-fix this was pre-netted at
    // line 866 AND subtracted again at the netForYear render — caught
    // by the audit 2026-06-08 as ~$87K/yr Delphi double-sub.)
    var suppSavings = _computeSuppSavingsForYear(displayedI, fundedSupps);
    // Invariant: gross benefit (Brooklyn + supp savings, BEFORE the LBB
    // timing benefit) cannot exceed baseline.total — you can't save more
    // tax than was owed. The supp's lastResult.totalSaved is computed
    // against the supp's OWN baseline (pre-Brooklyn), so when Brooklyn
    // already absorbed most of the year's tax, the supp's marginal
    // contribution is smaller than its lastResult claims. Cap the supp
    // share at (baseline.total − brooklynSavings) so the displayed gross
    // matches what's actually attainable. LBB (deferral-timing benefit)
    // is a SEPARATE concept — it represents savings shifted to Y0 from
    // do-nothing-Y0-lump vs matched-timing — and is allowed to push
    // gross above this year's matched-timing baseline.
    // User feedback 2026-06-09: gross $481K > baseline $442K is impossible.
    var _baseTotal = Number(row && row.baseline && row.baseline.total) || 0;
    var _maxSuppMarginal = Math.max(0, _baseTotal - brooklynSavings);
    var _suppDisplayCapped = Math.min(suppSavings, _maxSuppMarginal);
    var grossBenefit = brooklynSavings + lbb + _suppDisplayCapped;

    if (stLoss === 0 && ordOffset === 0 && ltGainAdded === 0 && other === 0 && grossBenefit === 0 && suppMgmtFee === 0 && lbb === 0) {
      return '<div class="temp-activity-empty">No strategy activity this year.</div>';
    }

    // Per-year fees (Brooklyn AM + Brookhaven). The engine puts them
    // on each row as r.fee / r.brookhavenFee. We then scale by
    // entry.metrics.brooklynFees / comp.totalFees (and same for
    // Brookhaven) so the per-year sum equals the bottom panel's
    // authoritative aggregate — without that scale, the optimizer's
    // dialback can leave row-fee sums slightly above metrics-fee
    // totals (~3% in canonical scenarios) and the per-year display
    // wouldn't reconcile to hero.
    var amScale = (feeScale && Number.isFinite(feeScale.am)) ? feeScale.am : 1;
    var bhScale = (feeScale && Number.isFinite(feeScale.bh)) ? feeScale.bh : 1;
    var amFeeYear = Math.round((Number(row && row.fee) || 0) * amScale);
    var bhFeeYear = Math.round((Number(row && row.brookhavenFee) || 0) * bhScale);
    var netForYear = grossBenefit - suppMgmtFee - amFeeYear - bhFeeYear;

    // Surface what Brooklyn losses were APPLIED against this year as
    // SEPARATE rows per bucket — the engine now exposes the per-bucket
    // breakdown so we can render:
    //   • Loss applied to ST capital gain     (rarely populated)
    //   • Loss applied to LT capital gain     (most common)
    //   • Loss applied to §1250 unrecap gain  (after LT is exhausted)
    //   • Loss applied to ordinary income     (§1211(b) $3K/$1.5K cap)
    // Previously the temp page lumped everything into a single
    // "Loss applied to ..." line whose label was inferred from row
    // context — misleading when (e.g.) LT $1.5M + Brooklyn loss
    // $1.502M absorbed $1.5M into LT and $2,130 into ordinary but
    // the single line read "Loss applied to LT capital gain $1,502,130".
    var lossApp = Math.max(0, Number(row && row.lossApplied) || 0);
    var ltOffset      = Math.max(0, Number(row && row.ltOffsetApplied)        || 0);
    var stOffset      = Math.max(0, Number(row && row.shortOffsetApplied)     || 0);
    var recap1250Off  = Math.max(0, Number(row && row.recap1250OffsetApplied) || 0);
    // ordOffsetBrooklyn already computed upstream (line 476-479) from
    // row.ordOffsetApplied / withStrategy._ordOffsetApplied.
    // Sanity floor: when the engine row predates the breakdown fields
    // (legacy code path), fall back to lumping the total under whichever
    // single bucket label fits — preserves pre-fix display behavior.
    var hasBreakdown = (stOffset + ltOffset + recap1250Off + ordOffsetBrooklyn) > 0;

    var rows = [];
    if (stLossBrooklyn > 0) rows.push(['ST loss generated (Brooklyn)',         _fmt(stLossBrooklyn)]);
    if (hasBreakdown) {
      if (stOffset > 0)     rows.push(['Loss applied to ST capital gain',     _fmt(stOffset)]);
      if (ltOffset > 0)     rows.push(['Loss applied to LT capital gain',     _fmt(ltOffset)]);
      if (recap1250Off > 0) rows.push(['Loss applied to §1250 unrecap gain',  _fmt(recap1250Off)]);
      // §1245 deliberately omitted — capital losses can't reach §1245
      // (it's ordinary, only the $3K cap below applies).
      if (ordOffsetBrooklyn > 0) {
        rows.push(['Loss applied to ordinary income (§1211(b) cap)', _fmt(ordOffsetBrooklyn)]);
      }
    } else if (lossApp > 0) {
      // Legacy fallback (engine row missing breakdown fields).
      var rowGain = Math.max(0, Number(row && row.gainRecognized) || 0);
      var cfgRecap = Math.max(0, Number(cfg && cfg.acceleratedDepreciation) || 0);
      var legacyLabel = '';
      if (rowGain > 0) legacyLabel = 'Loss applied to LT capital gain';
      else if (displayedI === 0 && cfgRecap > 0) legacyLabel = 'Loss applied to §1250 recapture';
      else if (lossApp <= 3001) legacyLabel = 'Loss applied to ordinary income (§1211(b) cap)';
      else legacyLabel = 'Loss applied (gain / recap)';
      rows.push([legacyLabel, _fmt(lossApp)]);
    }
    // Per-supp itemized activity — one row per strategy per effect, so a
    // CPA testing the page sees each strategy's contribution separately
    // (two ordinary-offset strategies render as two rows, not one summed
    // line). Delphi typically shows two rows: ordinary offset + LT gain.
    suppEntries.forEach(function (e) {
      if (e.ord   > 0) rows.push([e.name + ' — ordinary income offset', _fmt(e.ord)]);
      if (e.lt    > 0) rows.push([e.name + ' — long-term gain added',    _fmt(e.lt)]);
      if (e.st    > 0) rows.push([e.name + ' — ST loss generated',       _fmt(e.st)]);
      if (e.other > 0) rows.push([e.name + ' — tax saved',               _fmt(e.other)]);
    });
    // "Gain from lower tax bracket" — deferred-strategy timing benefit,
    // allocated entirely to Y0. Shows what the client gains by recognizing
    // gain in inflation-bumped later-year brackets (and, for Strategy C,
    // splitting it across years for LTCG-bracket arbitrage).
    if (lbb !== 0) rows.push(['Gain from lower tax bracket (deferred recognition)', _fmt(lbb)]);

    // Per-year GROSS BENEFIT / fee / net-this-year rows intentionally
    // removed (advisor 2026-06-10). The activity column now shows only WHAT
    // HAPPENED that year (Brooklyn loss, supplemental offsets, deferral gain);
    // the dollar the CPA cares about per year is "Tax saved vs baseline" in
    // the Results column, and ALL fees + the net reconciliation live once at
    // the bottom (Σ yearly tax saved − Asset Manager fee − Brookhaven fee =
    // net). Showing a per-year "gross benefit" that didn't match the Results
    // tax-saved (it carried the deferral benefit, fees, etc.) was the source
    // of the "that math doesn't make sense" confusion. _suppDisplayCapped /
    // grossBenefit / netForYear are still computed above for the year-card
    // relevance gate but no longer rendered here.

    return '<table class="temp-activity-table"><tbody>' +
      rows.map(function (r) {
        var cls = r[2] ? (' class="' + r[2] + '"') : '';
        return '<tr' + cls + '><td>' + r[0] + '</td><td class="temp-amt">' + r[1] + '</td></tr>';
      }).join('') +
      '</tbody></table>';
  }

  // Sum the per-year supplemental management fee across all funded
  // supps for a given displayed year. Today only Delphi carries a fee.
  //   - Multi-year shape (Strategy B/C): each perYear[i] exposes
  //     mgmtFeeDollars (= invest_for_year × managementFee).
  //   - Single-year shape (Strategy A via computeDelphiYear1): the fee
  //     lives at the top level of lastResult; allocate the entire fee
  //     to Y0 since the position is opened that year.
  // Other supps (O&G, charitable, PTET, Augusta, 401k) have no fee →
  // both branches return 0 for them.
  function _computeSuppMgmtFeeForYear(displayedI, fundedSupps) {
    if (!Array.isArray(fundedSupps)) return 0;
    var sum = 0;
    fundedSupps.forEach(function (s) {
      var coreSpec  = (root.__rettSupplemental      && root.__rettSupplemental[s.id])      || null;
      var extraSpec = (root.__rettSupplementalExtra && root.__rettSupplementalExtra[s.id]) || null;
      var last = (coreSpec && coreSpec.lastResult) || (extraSpec && extraSpec.lastResult) || null;
      if (!last) return;
      if (Array.isArray(last.perYear)) {
        var py = last.perYear[displayedI];
        if (py) sum += Number(py.mgmtFeeDollars || 0) || 0;
        return;
      }
      // Single-year shape: top-level mgmtFeeDollars hits Y0 only.
      if (displayedI === 0) {
        sum += Number(last.mgmtFeeDollars || 0) || 0;
      }
    });
    return sum;
  }

  // Sum supp tax savings allocated to a given displayed year. Mirrors
  // the multi-year shapes the activity column reads but pulls the
  // dollar tax-saved value (not the underlying ord/LT/ST contribution).
  // Used both by per-year card rendering and the bottom fees panel
  // reconciliation totals.
  function _computeSuppSavingsForYear(displayedI, fundedSupps) {
    if (!Array.isArray(fundedSupps)) return 0;
    var sum = 0;
    fundedSupps.forEach(function (s) {
      var extraSpec = (root.__rettSupplementalExtra && root.__rettSupplementalExtra[s.id]) || null;
      var coreSpec  = (root.__rettSupplemental      && root.__rettSupplemental[s.id])      || null;
      var last      = (extraSpec && extraSpec.lastResult)
                   || (coreSpec  && coreSpec.lastResult) || null;
      if (!last) return;
      // Per-year saturation scale (audit R2 #5): Y0 may be clipped by the
      // shared ord pool; Y1+ passes through unchanged because each future
      // year has its own pool. Shared with the other per-supp reconstructions
      // via _suppSatScale so the columns can't disagree.
      var satScale = _suppSatScale(s, displayedI);
      var detail = last.detail || {};
      var perYear = Array.isArray(last.perYear) ? last.perYear : null;
      // Multi-year (Oil & Gas style): perYear[i].totalSaved already
      // includes federal + state + NIIT delta for that year. Pre-fix
      // also subtracted perYear[i].mgmtFeeDollars (double-sub with the
      // netForYear render — fixed earlier). Return TRUE gross; the mgmt
      // fee is displayed as its own "Less:" row and subtracted once in
      // netForYear.
      if (perYear && perYear[displayedI] != null) {
        var py = perYear[displayedI];
        var pyGross = Number(py.totalSaved || 0) || 0;
        sum += Math.max(0, pyGross) * satScale;
        return;
      }
      // Unified multi-year shape (post-rename 2026-05-09): every
      // annual-recurring supp ships taxSavingsY0 + taxSavingsRestPerYear
      // already in tax dollars. Charitable, PTET, Augusta, 401(k).
      if (detail.taxSavingsY0 != null || detail.taxSavingsRestPerYear != null) {
        var yc = Number(detail.yearCount || 1);
        if (displayedI < yc) {
          sum += ((displayedI === 0)
            ? Number(detail.taxSavingsY0 || 0)
            : Number(detail.taxSavingsRestPerYear || 0)) * satScale;
        }
        return;
      }
      // Single-year fallback: full netBenefit on Y0.
      if (displayedI === 0) {
        sum += (Number(s.netBenefit || last.netBenefit || last.totalSaved || 0) || 0) * satScale;
      }
    });
    return sum;
  }

  // Bottom-of-page fees panel. Uses the engine's AUTHORITATIVE
  // aggregates (comp.totalSavings + solverOut.totalSupplementalBenefit
  // − comp.totalAllFees) so the displayed net equals Strategy Summary
  // exactly. Per-year breakdown above is informational; the bottom
  // panel is the canonical reconciliation.
  // Strategy C frequently over-generates Brooklyn short-term loss: more
  // loss is harvested than there is gain to absorb, so a chunk exits the
  // last engine row unused. That unused loss has real but unquantifiable
  // value (≈30¢/$ is too hand-wavy to claim), so instead of claiming it
  // we REFUND the AM fee spent generating the excess — added back to net
  // benefit upstream in buildInterestedSummary. This panel surfaces the
  // raw unused loss plus the fee that was credited back. The authoritative
  // credit is metrics._excessLossFeeCredit (gated to excess > $10k there);
  // panel shows only when that credit was actually applied.
  function _renderExcessLossPanel(ctx) {
    if (!ctx || !ctx.entry || ctx.chosen !== 'C') return '';
    var m = ctx.entry.metrics || {};
    var credit = Math.max(0, Math.round(Number(m._excessLossFeeCredit) || 0));
    if (credit <= 0) return '';
    var rows = (ctx.comp && ctx.comp.rows) || [];
    var excess = rows.length
      ? Math.max(0, Number(rows[rows.length - 1].stCarryForward) || 0)
      : 0;
    var lastYr = rows.length ? (Number(rows[rows.length - 1].year) || null) : null;
    var yrTag = lastYr ? (' (through ' + lastYr + ')') : '';
    return '' +
      '<div class="temp-excess-loss-panel">' +
        '<div class="temp-excess-loss-head">Excess carryover loss' + yrTag + '</div>' +
        '<div class="temp-excess-loss-body">' +
          '<div class="temp-excess-loss-line">' +
            '<span class="temp-excess-loss-amt">' + _fmt(excess) + '</span>' +
            '<span class="temp-excess-loss-label">unused short-term loss carried forward</span>' +
          '</div>' +
          '<div class="temp-excess-loss-line">' +
            '<span class="temp-excess-loss-amt temp-excess-loss-credit">+' + _fmt(credit) + '</span>' +
            '<span class="temp-excess-loss-label">Asset Manager fee credited back to net benefit</span>' +
          '</div>' +
          '<div class="temp-excess-loss-note"><em>We don’t claim an economic value for the unused loss. ' +
            'Instead we refund the fee it cost to generate &mdash; already reflected in the reduced Asset Manager fees and net benefit above.</em></div>' +
        '</div>' +
      '</div>';
  }

  function _renderFeesPanel(ctx) {
    if (!ctx || !ctx.entry) return '';
    var m = ctx.entry.metrics || {};
    var comp = ctx.comp || {};
    // Brooklyn-side: prefer entry.metrics.savings (post-optimizer
    // adjustment — when optimizer scales Brooklyn to 0, engine zeroes
    // savings/fees/net so Strategy Summary displays "no engagement").
    // Fall back to comp.totalSavings only when entry.metrics.savings
    // is undefined (defensive).
    var brooklynGross = Math.round(
      (m.savings != null ? Number(m.savings) : Number(comp.totalSavings || 0)) || 0
    );
    // Bridge the per-year cards (matched-timing baseline) to the engine's
    // do-nothing aggregate. For deferred strategies B/C the per-year
    // matched-timing sum will be SMALLER than brooklynGross by the
    // tax-deferral / gain-timing benefit — the engine catches it in
    // comp.totalSavings (via doNothingBaseline) but the per-year cards
    // can't show it on any individual year. We split it out as its own
    // line so the per-year cards + this row + supps + fees reconcile
    // cleanly to the bottom-panel net.
    var perYearBrooklynSum = 0;
    (comp.rows || []).forEach(function (r) {
      var b = (r && r.baseline) ? Number(r.baseline.total) || 0 : 0;
      var w = (r && r.withStrategy) ? Number(r.withStrategy.total) || 0 : 0;
      perYearBrooklynSum += (b - w);
    });
    perYearBrooklynSum = Math.round(perYearBrooklynSum);
    var deferralBenefit = brooklynGross - perYearBrooklynSum;
    // Supplemental side: pull from the master solver's vetted
    // aggregate — that's what Strategy Summary uses for net = primaryNet
    // + supplementalBenefit. Summing individual s.netBenefit values
    // double-counts when supps have rivalry-capping or interlocking
    // effects (Delphi LT-add absorbed by Brooklyn, etc.).
    var suppBenefit = 0;
    if (typeof root.runMasterSolver === 'function') {
      try {
        // Same post-primary residual cap as _resolveChosen / the hero —
        // supps can't save more than the tax remaining after Brooklyn
        // (advisor 2026-06-09), so the bottom panel matches Strategy Summary.
        var _ppCapFP = (comp && Array.isArray(comp.rows))
          ? comp.rows.reduce(function (a, r) { return a + ((r.withStrategy && Number(r.withStrategy.total)) || 0); }, 0)
          : null;
        var sOut = root.runMasterSolver(Number(m.net) || 0, (_ppCapFP != null ? { postPrimaryTaxRemaining: _ppCapFP } : undefined));
        if (sOut && Number.isFinite(Number(sOut.totalSupplementalBenefit))) {
          suppBenefit = Math.round(Number(sOut.totalSupplementalBenefit));
        }
      } catch (e) { /* */ }
    }
    // Override with the HONEST recompute-based benefit (the actual stacked
    // tax saved) so the bottom total = Σ per-year card "tax saved" and the
    // net ties to the Strategy Summary, which now also uses the honest value
    // (advisor 2026-06-10). Falls back to the solver total above if anything
    // is missing.
    if (typeof root.__rettHonestSuppBenefit === 'function' &&
        comp && Array.isArray(ctx.fundedSupps) && ctx.fundedSupps.length) {
      try {
        var _hsb = root.__rettHonestSuppBenefit(comp, ctx.fundedSupps,
          { chosen: ctx.chosen, cfg: ctx.entry && ctx.entry.cfg });
        if (Number.isFinite(_hsb)) suppBenefit = Math.round(_hsb);
      } catch (e) { /* keep solver value */ }
    }
    // Carryover-loss offset credit (A/B/C) — the value of the free
    // §1211(b) $3,000/$1,500 ordinary offset the residual carryforward
    // buys in the first idle year after deployment. buildInterestedSummary
    // adds it straight to metrics.net (projection-dashboard-render.js), but
    // it never touches savings or fees — so the panel must surface it as
    // its own benefit line, or the "gross − fees" net would sit BELOW the
    // card / Strategy-Summary net by exactly this credit and trip the
    // reconciliation check (the Strategy-C "⚠ mismatch" bug). Same applies
    // to the additional-funds liquidation tax, which metrics.net subtracts
    // but the panel otherwise wouldn't see.
    var carryoverCredit = Math.round(Number(m._carryoverOffsetCredit || 0) || 0);
    var addlFundsTax    = Math.round(Number(m._additionalFundsTriggeredTax || 0) || 0);
    var totalGross = brooklynGross + suppBenefit + carryoverCredit;
    var brooklynFees   = Math.round(Number(m.brooklynFees   || 0) || 0);
    var brookhavenFees = Math.round(Number(m.brookhavenFees || 0) || 0);
    var totalFees      = brooklynFees + brookhavenFees;
    var net = totalGross - totalFees - addlFundsTax;
    // Strategy Summary's displayed net = primary net (Brooklyn savings
    // − fees + carryover credit − additional-funds tax) + supplementalBenefit.
    // entry.metrics.net is the primary piece only; adding suppBenefit gives
    // the user-facing total. With the credit + tax now folded into `net`
    // above, the two sides reconcile to the dollar.
    var primaryNet = Math.round(Number(m.net || 0) || 0);
    var ssDisplayedNet = primaryNet + suppBenefit;
    var checkOk = Math.abs(net - ssDisplayedNet) <= 5;

    // The lower-bracket benefit is now baked INTO Y0's per-year card
    // (via the render() loop's lbbThisYear param), so Σ year cards already
    // equals brooklynGross. The bottom panel just shows the rolled-up
    // aggregate. A faint footnote calls out the deferred-strategy timing
    // benefit so the CPA knows it's embedded in Y0.
    var lbbFootnote = (Math.abs(deferralBenefit) > 5)
      ? '<tr class="temp-fees-footnote"><td colspan="2" class="temp-fees-foot">&nbsp;&nbsp;&nbsp;&nbsp;<em>(includes ' + _fmt(deferralBenefit) + ' lower tax bracket benefit allocated to Year 0)</em></td></tr>'
      : '';
    var brooklynRows =
      '<tr><td>Brooklyn gross savings (across all years)</td><td class="temp-amt">' + _fmt(brooklynGross) + '</td></tr>' +
      lbbFootnote;
    // Surfaced only when nonzero so the simple lump-sum cases stay clean.
    var carryoverRow = (carryoverCredit > 5)
      ? '<tr><td>Carryover-loss offset credit (§1211(b) annual offset)</td><td class="temp-amt">' + _fmt(carryoverCredit) + '</td></tr>'
      : '';
    var addlFundsTaxRow = (addlFundsTax > 5)
      ? '<tr><td>Additional-funds liquidation tax (one-time)</td><td class="temp-amt">&minus;' + _fmt(addlFundsTax) + '</td></tr>'
      : '';

    return '' +
      '<div class="temp-fees-panel">' +
        '<div class="temp-fees-head">Total Tax Saved &rarr; Net Benefit</div>' +
        '<table class="temp-fees-table"><tbody>' +
          '<tr class="temp-fees-foot"><td colspan="2" class="temp-fees-foot"><em>Sum of each year’s &ldquo;tax saved vs baseline&rdquo; above:</em></td></tr>' +
          brooklynRows +
          '<tr><td>Supplemental tax savings (vetted total)</td><td class="temp-amt">' + _fmt(suppBenefit) + '</td></tr>' +
          carryoverRow +
          '<tr class="temp-fees-subtotal"><td><strong>Total tax saved (vs doing nothing)</strong></td><td class="temp-amt temp-fees-gross"><strong>' + _fmt(totalGross) + '</strong></td></tr>' +
          '<tr><td>Less: Asset Manager fee (across all years)</td><td class="temp-amt">&minus;' + _fmt(brooklynFees) + '</td></tr>' +
          '<tr><td>Less: Brookhaven fee (across all years)</td><td class="temp-amt">&minus;' + _fmt(brookhavenFees) + '</td></tr>' +
          addlFundsTaxRow +
          '<tr class="temp-fees-total"><td><strong>Net benefit (tax saved − fees)</strong></td><td class="temp-amt"><strong>' + _fmt(net) + '</strong></td></tr>' +
          '<tr class="temp-fees-check' + (checkOk ? ' is-ok' : ' is-mismatch') + '"><td>Strategy Summary net benefit ' + (checkOk ? '✓ matches' : '⚠ mismatch') + '</td><td class="temp-amt">' + _fmt(ssDisplayedNet) + '</td></tr>' +
        '</tbody></table>' +
      '</div>';
  }

  // Total supp deduction this year, split by what bucket it absorbed
  // against: ordinary income / §1245 recapture / §1250 unrecap. Display-
  // only — feeds the results column so each income line AND the matching
  // tax line shows post-supp reduction. Audit 2026-06-08: a §162-style
  // ordinary deduction (Oil & Gas IDC, Delphi ord expense, equipment
  // leasing PAL) waterfalls ord → §1245 (ordinary-flavored) → §1250
  // (unrecap, 25% capped). OG's calc-oil-gas now ships absorbedOrd /
  // absorbed1245 / absorbed1250 per year so we can mirror the split here.
  // Supps that only generate standard / itemized deductions (charitable,
  // 401k unified shape, augusta, PTET) only absorb against ordinary
  // income — they don't reach recap. We default those to ord-only.
  function _computeSuppOrdOffsetForYear(displayedI, fundedSupps) {
    var ZERO = { ord: 0, r1245: 0, r1250: 0, total: 0, oilGasOrd: 0 };
    if (!Array.isArray(fundedSupps)) return ZERO;
    // oilGasOrd = the Oil & Gas portion of the ordinary offset — IDC, which is
    // deducted for regular tax but added back for AMT (see amtIdcPreference).
    var acc = { ord: 0, r1245: 0, r1250: 0, oilGasOrd: 0 };
    fundedSupps.forEach(function (s) {
      var extraSpec = (root.__rettSupplementalExtra && root.__rettSupplementalExtra[s.id]) || null;
      var coreSpec  = (root.__rettSupplemental      && root.__rettSupplemental[s.id])      || null;
      var last      = (extraSpec && extraSpec.lastResult)
                   || (coreSpec  && coreSpec.lastResult) || null;
      if (!last) return;
      // Same per-year saturation scale the activity column and gross/net
      // path apply — without it the results column reduces ordinary income
      // by the UNCLIPPED offset while the activity column shows the clipped
      // one, so the two halves of the year card disagree (advisor 2026-06-10).
      var sc = _suppSatScale(s, displayedI);
      var perYear = Array.isArray(last.perYear) ? last.perYear : null;
      if (perYear && perYear[displayedI]) {
        var py = perYear[displayedI];
        // OG ships absorbedOrd / absorbed1245 / absorbed1250 (post-fix).
        // Other multi-year supps may only ship `absorbed` (single number);
        // attribute that fully to ordinary (they don't reach recap today).
        var hasSplit = (py.absorbedOrd != null) || (py.absorbed1245 != null) || (py.absorbed1250 != null);
        if (hasSplit) {
          var _ordAdd = Math.max(0, Number(py.absorbedOrd) || 0) * sc;
          acc.ord   += _ordAdd;
          acc.r1245 += Math.max(0, Number(py.absorbed1245)  || 0) * sc;
          acc.r1250 += Math.max(0, Number(py.absorbed1250)  || 0) * sc;
          if (s.id === 'oilGas') acc.oilGasOrd += _ordAdd;
        } else {
          var c = (py.absorbed != null) ? Number(py.absorbed) : Number(py.deduction || 0);
          if (c > 0) { acc.ord += c * sc; if (s.id === 'oilGas') acc.oilGasOrd += c * sc; }
        }
        return;
      }
      var detail = last.detail || {};
      if (detail.ordOffsetY0 != null || detail.ordOffsetRestPerYear != null) {
        var yc = Number(detail.yearCount || 1);
        if (displayedI < yc) {
          acc.ord += ((displayedI === 0)
            ? Math.max(0, Number(detail.ordOffsetY0 || 0))
            : Math.max(0, Number(detail.ordOffsetRestPerYear || 0))) * sc;
        }
        return;
      }
      if (displayedI !== 0) return;
      var allocations = last.allocations || {};
      var ordKey = Number(
        allocations.ordinaryExpense
        || detail.deductibleAmount
        || detail.year1Deduction
        || detail.yr1Deduction
        || detail.yr1Loss
        || detail.businessRent
        || detail.totalContribution
        || detail.total
        || detail.deduction
        || detail.expense
        || 0
      ) || 0;
      if (ordKey > 0) acc.ord += ordKey * sc;
    });
    acc.total = acc.ord + acc.r1245 + acc.r1250;
    return acc;
  }

  function _renderYearCard(row, i, chosen, cfg, fundedSupps, stateCode, carryIn, carryOut, feeScale, lowerBracketBenefit) {
    var year  = Number(row.year) || (i + 1);
    var label = 'Year ' + i + ' (' + year + ')';
    var rel   = _isRelevant(row, i, chosen, cfg);
    // If lower-bracket benefit lands on Y0, the year is relevant even if
    // there's no other Brooklyn/supp activity that year.
    if (i === 0 && lowerBracketBenefit && Math.abs(lowerBracketBenefit) > 5) rel = true;
    // Cap supp tax saved so it can't exceed (baseline.total − Brooklyn
    // savings). Same invariant the activity column enforces — keeps the
    // right-column "Tax saved vs baseline" line consistent with the
    // activity column's "Gross benefit (tax saved)" and the underlying
    // mathematical bound (savings ≤ tax owed). Audit 2026-06-09.
    var _rawSuppSaved = _computeSuppSavingsForYear(i, fundedSupps);
    var _ycBaseTotal = Number(row && row.baseline && row.baseline.total) || 0;
    var _ycBrooklynSavings = (row && row.withStrategy)
      ? Math.max(0, _ycBaseTotal - (Number(row.withStrategy.total) || 0))
      : 0;
    var _suppSavedCapped = Math.min(_rawSuppSaved, Math.max(0, _ycBaseTotal - _ycBrooklynSavings));
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
          _renderBaselineCell(row.baseline, carryIn, carryOut) +
        '</div>' +
        '<div class="temp-year-activity">' +
          '<div class="temp-year-head temp-year-head-muted">Strategy activity</div>' +
          _renderActivityCell(row, i, chosen, cfg, fundedSupps, feeScale, lowerBracketBenefit) +
        '</div>' +
        '<div class="temp-year-results">' +
          '<div class="temp-year-head temp-year-head-result">Results &mdash; with strategy</div>' +
          _renderResultsCell(
            row.withStrategy || row.baseline,
            row.baseline,
            _suppSavedCapped,
            _computeSuppOrdOffsetForYear(i, fundedSupps),
            _computeSuppLineSavings(i, fundedSupps),
            row,
            lowerBracketBenefit
          ) +
        '</div>' +
        _renderWithdrawalCell(row, year, cfg) +
      '</div>';
  }

  // Tax-withdrawal callout (right side of each year card). Shows what
  // comes out of the trust on April 1 of the year AFTER `year` to pay
  // the SALE-ATTRIBUTABLE tax — when the client elected "Cover any
  // tax bill from sale" on Page 1.
  //
  // Per advisor 2026-05-17: that question is scoped to the SALE,
  // not the client's full tax bill. W-2 / SE / biz-revenue tax is
  // already paid out of the client's regular income. The trust only
  // funds the marginal sale-driven tax. Formula:
  //
  //     withdrawal = withStrategy.total − withoutSale.total
  //
  // where withoutSale = the baseline that year with no recap, no
  // sale LT gain, no ST property gain. We compute it via
  // _recurringBaselineForYear(year, { recap: 0 }) — same helper
  // used for the synthetic out-of-horizon rows, with the recap
  // option zeroed.
  //
  // Years where the sale contributes nothing (e.g. quiet Y2 in a
  // Strategy A scenario where all gain hit Y0) yield a $0 withdrawal
  // and the cell self-suppresses — keeps the card layout clean.
  function _renderWithdrawalCell(row, year, cfg) {
    var covers = cfg && (cfg.coverTaxesFromSale === true || cfg.coverTaxesFromSale === 'yes');
    if (!covers) return '';
    // Tax WITH strategy for this year (engine row when present; for
    // synthetic out-of-horizon years there's no sale-side activity,
    // so the marginal sale tax is by definition $0 and the cell
    // suppresses).
    var taxWithStrat = (row && row.withStrategy) ? (Number(row.withStrategy.total) || 0) : 0;
    if (!(taxWithStrat > 0)) return '';
    // Without-sale tax for this year (W-2 / SE / biz / rental / div
    // only — no recap, no LT, no ST property gain). The recurring
    // helper inflates wages + ord at the same 2%/yr the engine uses,
    // so subtraction stays apples-to-apples.
    var noSaleBaseline = _recurringBaselineForYear(year, { recap: 0 });
    var taxWithoutSale = noSaleBaseline ? (Number(noSaleBaseline.total) || 0) : 0;
    // Sale-attributable tax. Clamp at 0 — in rare years (e.g. Strategy
    // B Y0 baseline equals W-2 only because LT + recap moved out)
    // withStrategy can dip slightly below withoutSale due to bracket-
    // rounding, and a negative withdrawal would be misleading.
    // Round to nearest dollar before the threshold check — bracket /
    // proration math can leave a saleTax like $0.34 that passes a raw
    // `> 0` test but formats as "$0" in the cell. The user sees a
    // wasted withdrawal cell with $0 in it. Demand at least $1 of
    // actual tax to render.
    var saleTax = Math.round(Math.max(0, taxWithStrat - taxWithoutSale));
    if (saleTax < 1) return '';
    var dueYear = Number(year) + 1;
    return '' +
      '<div class="temp-year-withdrawal">' +
        '<div class="temp-year-head temp-year-head-withdraw">Trust Withdrawal</div>' +
        '<div class="temp-withdraw-amt">' + _fmt(saleTax) + '</div>' +
        '<div class="temp-withdraw-date">April 1, ' + dueYear + '</div>' +
        '<div class="temp-withdraw-note">sale-attributable tax for ' + year + '</div>' +
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
    // Carryover-loss tracking: row.stCarryForward is the unused
    // Brooklyn loss EXITING that engine row. So Y_i's "carry IN"
    // equals row[i-1].stCarryForward, and Y_i's "carry OUT" equals
    // row[i].stCarryForward. Years past the engine horizon carry the
    // last engine row's exit value forward unchanged (no further loss
    // generation, no further absorption).
    var lastEngineCarry = 0;
    if (engineRows.length) {
      var le = engineRows[engineRows.length - 1];
      lastEngineCarry = Math.max(0, Number(le && le.stCarryForward) || 0);
    }
    // Compute fee-scale once so per-year AM/Brookhaven lines sum to
    // exactly the entry.metrics totals shown on the bottom panel +
    // Strategy Summary. Optimizer dialback can leave row.fee sums a
    // few % above metrics.brooklynFees; scaling closes the gap.
    var _mFees = (ctx.entry && ctx.entry.metrics) || {};
    var _ctotalFees = Number(ctx.comp.totalFees || 0);
    var _ctotalBh   = Number(ctx.comp.totalBrookhaven || 0);
    var _mAM = Number(_mFees.brooklynFees || 0);
    var _mBH = Number(_mFees.brookhavenFees || 0);
    var feeScale = {
      am: _ctotalFees > 0 ? _mAM / _ctotalFees : 1,
      bh: _ctotalBh   > 0 ? _mBH / _ctotalBh   : 1
    };

    // One-time "Gain from lower tax bracket" benefit — the gap between
    // the engine's authoritative comp.totalSavings (which uses the
    // do-nothing baseline) and the sum of per-year matched-timing deltas.
    // Allocate the entire amount to Y0 so summing per-year card net
    // benefits across all displayed years reconciles to Tab 6's hero
    // net benefit exactly. For Strategy A and supplemental-only paths
    // this is $0 (matched-timing = do-nothing).
    var _perYearMatchedSum = 0;
    engineRows.forEach(function (r) {
      var b = r && r.baseline ? Number(r.baseline.total)||0 : 0;
      var w = r && r.withStrategy ? Number(r.withStrategy.total)||0 : 0;
      _perYearMatchedSum += (b - w);
    });
    var _lowerBracketBenefit = Math.round(Number(ctx.comp.totalSavings || 0) - _perYearMatchedSum);

    var totalCards = Math.max(TOTAL_YEARS, engineRows.length);
    for (var i = 0; i < totalCards; i++) {
      var yr = year0 + i;
      var row = engineRows[i] || null;
      var carryIn  = 0;
      var carryOut = 0;
      if (row) {
        if (row.baseline && !row.baseline._incomes) {
          row.baseline._incomes = _deriveIncomesForEngineRow(row, i, ctx.chosen, ctx.entry.cfg);
        }
        carryIn  = (i > 0)
          ? Math.max(0, Number(engineRows[i - 1] && engineRows[i - 1].stCarryForward) || 0)
          : 0;
        carryOut = Math.max(0, Number(row.stCarryForward) || 0);
      } else {
        row = {
          year: yr,
          baseline: _recurringBaselineForYear(yr),
          gainRecognized: 0, lossApplied: 0, lossGenerated: 0, investmentThisYear: 0
        };
        // Synthetic recurring years inherit the last-engine-row carry
        // (loss is preserved but not used because there's no gain to
        // absorb in a recurring year). Same value flows in and out so
        // the CPA sees the pool isn't shrinking.
        carryIn  = lastEngineCarry;
        carryOut = lastEngineCarry;
      }
      // Allocate the lower-bracket benefit to Y0 only; pass 0 for Y1+
      // so it lands in exactly one card and the sum reconciles.
      var lbbThisYear = (i === 0) ? _lowerBracketBenefit : 0;
      html += _renderYearCard(row, i, ctx.chosen, ctx.entry.cfg, ctx.fundedSupps, stateCode, carryIn, carryOut, feeScale, lbbThisYear);
    }
    // Container variant when the client covers tax from sale proceeds
    // — opens a 4th column on every year card for the Trust Withdrawal
    // callout. Without this class the cards stay 3-column.
    var coversTax = ctx.entry && ctx.entry.cfg &&
      (ctx.entry.cfg.coverTaxesFromSale === true || ctx.entry.cfg.coverTaxesFromSale === 'yes');
    host.classList.toggle('temp-baselines--withdrawals', !!coversTax);
    host.innerHTML = html + _renderExcessLossPanel(ctx) + _renderFeesPanel(ctx);
  }

  // ── Honest supplemental benefit ───────────────────────────────────────
  // The master solver estimates each supp's benefit at its OWN standalone
  // marginal rate, so stacking several overstates the combined supplemental
  // contribution (the real saved tax is lower once income drops into lower
  // brackets). This helper measures the TRUE supplemental benefit for a
  // given strategy's engine output: for each year, recompute the tax with
  // only Brooklyn's offsets, then again with Brooklyn + the (saturated)
  // supplemental offsets, and sum the difference. Both sides use the SAME
  // recompute path so any recompute-vs-engine drift cancels and we isolate
  // the pure supplemental delta. Returns a whole-dollar number (advisor
  // 2026-06-10 — make the honest, recomputed number authoritative).
  function _honestSuppBenefitForComp(comp, fundedSupps, opts) {
    if (!comp || !Array.isArray(comp.rows)) return 0;
    if (!Array.isArray(fundedSupps) || !fundedSupps.length) return 0;
    if (typeof _recomputePostStrategyTax !== 'function') return 0;
    opts = opts || {};
    var status = 'mfj', stateCode = 'NONE', year1 = 0, struct = {};
    if (typeof root.collectInputs === 'function') {
      try {
        var ci = root.collectInputs() || {};
        status    = ci.filingStatus || 'mfj';
        stateCode = ci.state || ci.stateCode || 'NONE';
        year1     = Number(ci.year1) || 0;
        struct = { qualifiedDividend: ci.qualifiedDividend, wages: ci.wages,
                   seIncome: ci.seIncome, itemized: ci.itemizedDeductions || ci.itemized };
      } catch (e) { /* defaults */ }
    }
    var total = 0;
    comp.rows.forEach(function (row, i) {
      if (!row) return;
      if (row.baseline && !row.baseline._incomes && typeof _deriveIncomesForEngineRow === 'function') {
        try { row.baseline._incomes = _deriveIncomesForEngineRow(row, i, opts.chosen, opts.cfg); } catch (e) {}
      }
      var baseInc = row.baseline && row.baseline._incomes;
      if (!baseInc) return;
      // Brooklyn loss offsets already applied by the engine this year.
      var btLt   = Math.max(0, Number(row.ltOffsetApplied)        || 0);
      var btOrd  = Math.max(0, Number(row.ordOffsetApplied)       || 0);
      var bt1250 = Math.max(0, Number(row.recap1250OffsetApplied) || 0);
      var btSt   = Math.max(0, Number(row.shortOffsetApplied)     || 0);
      // Saturated supplemental offsets for this year.
      var split  = (typeof _computeSuppOrdOffsetForYear === 'function')
        ? (_computeSuppOrdOffsetForYear(i, fundedSupps) || { ord: 0, r1245: 0, r1250: 0 })
        : { ord: 0, r1245: 0, r1250: 0 };
      var offOrd  = Math.max(0, Math.round(Number(split.ord)   || 0));
      var off1245 = Math.max(0, Math.round(Number(split.r1245) || 0));
      var off1250 = Math.max(0, Math.round(Number(split.r1250) || 0));
      if (offOrd + off1245 + off1250 <= 0) return;  // no supp activity this year
      var year = Number(row.year) || (year1 + i);
      // Brooklyn-only income (baseline less Brooklyn offsets).
      var brkInc = Object.assign({}, baseInc, {
        ordinary:      Math.max(0, Number(baseInc.ordinary      || 0) - btOrd),
        longTermGain:  Math.max(0, Number(baseInc.longTermGain  || 0) - btLt),
        shortTermGain: Math.max(0, Number(baseInc.shortTermGain || 0) - btSt),
        recapture1250: Math.max(0, Number(baseInc.recapture1250 || 0) - bt1250),
        recapture:     Math.max(0, Number(baseInc.recapture     || 0) - bt1250)
      });
      // Brooklyn + supplemental income (also less the supp offsets).
      var suppInc = Object.assign({}, brkInc, {
        ordinary:      Math.max(0, Number(brkInc.ordinary      || 0) - offOrd),
        recapture1245: Math.max(0, Number(brkInc.recapture1245 || 0) - off1245),
        recapture1250: Math.max(0, Number(brkInc.recapture1250 || 0) - off1250),
        recapture:     Math.max(0, Number(brkInc.recapture     || 0) - off1245 - off1250)
      });
      var brkTax  = _recomputePostStrategyTax(brkInc,  year, status, stateCode, struct);
      // The supp side also reduces the SE earnings base by the supplemental
      // ordinary offset (offOrd) — so SE/FICA tax + the SE part of Additional
      // Medicare fall as ordinary/SE income is offset. Brooklyn's recompute
      // (brkTax) keeps the full SE base — capital losses don't reduce earned
      // income. (advisor 2026-06-10.)
      var suppStruct = Object.assign({}, struct, { seReduction: offOrd,
        // O&G IDC added back to AMTI on the supp side (brkTax has no supp offset,
        // so its IDC preference is 0) — this is what trims the O&G supp's
        // incremental benefit when the IDC add-back triggers AMT.
        amtIdcPreference: Math.max(0, Math.round((Number(split.oilGasOrd) || 0) * _idcAmtPrefFraction())) });
      var suppTax = _recomputePostStrategyTax(suppInc, year, status, stateCode, suppStruct);
      if (!brkTax || !suppTax) return;
      total += (Number(brkTax.total) || 0) - (Number(suppTax.total) || 0);
    });
    return Math.round(total);
  }
  root.__rettHonestSuppBenefit = _honestSuppBenefitForComp;

  root.renderTempPage = render;
})(window);
