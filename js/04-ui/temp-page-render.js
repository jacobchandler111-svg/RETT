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
    // Apply the same 2%/yr inflation factor the engine uses in
    // _baseScenarioForYear so synthetic trailing rows don't silently drift
    // into a lower effective rate as brackets inflate but income stays flat.
    var _year1 = parseInt(_readVal('year1', String(new Date().getFullYear())), 10) || new Date().getFullYear();
    var _idx   = Math.max(0, year - _year1);
    var _infl  = (typeof root.TAX_DATA !== 'undefined' && root.TAX_DATA && typeof root.TAX_DATA.inflationRate === 'number')
                   ? root.TAX_DATA.inflationRate : 0.02;
    var _inflF = Math.pow(1 + _infl, _idx);
    var ord    = _recurringOrdinary() * _inflF;
    var stGain = Math.max(0, _readNum('short-term-gain'));
    var wages  = Math.max(0, _readNum('w2-wages')) * _inflF;
    var seInc  = Math.max(0, _readNum('se-income')) * _inflF;
    // Passive investment income (rental + dividend) inflated alongside ord.
    // stGain is asset-specific, not inflated (no recurring annual gain to grow).
    var nIIT_base = stGain
                  + Math.max(0, _readNum('rental-income'))  * _inflF
                  + Math.max(0, _readNum('dividend-income')) * _inflF
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
      ['Short-term capital gain',  incomes.shortTermGain, false],
      ['Depreciation recapture',   incomes.recapture,    false]
    ];
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
  function _renderActivityCell(row, displayedI, chosen, cfg, fundedSupps, feeScale) {
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
    if (Array.isArray(fundedSupps)) {
      fundedSupps.forEach(function (s) {
        var extraSpec = (root.__rettSupplementalExtra && root.__rettSupplementalExtra[s.id]) || null;
        var coreSpec  = (root.__rettSupplemental      && root.__rettSupplemental[s.id])      || null;
        var last      = (extraSpec && extraSpec.lastResult)
                     || (coreSpec  && coreSpec.lastResult) || null;
        if (!last) return;
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
          if (ordContribution > 0) { ordOffsetSupp += ordContribution; contributedThisYear = true; }
          var ltAdd = Number(py.longTermGainAdded || 0) || 0;
          if (ltAdd > 0) { ltGainAddedSupp += ltAdd; contributedThisYear = true; }
          var stAdd = Number(py.shortTermLoss || 0) || 0;
          if (stAdd > 0) { stLossSupp += stAdd; contributedThisYear = true; }
          // Per-year netBenefit / taxSaved that didn't come through
          // an ord/LT/ST contribution (e.g. PTET when engine ships
          // multi-year). Falls into "Other tax savings" line.
          if (!contributedThisYear) {
            var pyTax = Number(py.netBenefit || py.taxSaved || 0) || 0;
            if (pyTax > 0) { otherTaxSaved += pyTax; contributedThisYear = true; }
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
            if (offsetThisYear > 0) { ordOffsetSupp += offsetThisYear; contributedThisYear = true; }
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
            if (netThisYear > 0) { otherTaxSaved += netThisYear; contributedThisYear = true; }
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
        if (ordKeyValue > 0) { ordOffsetSupp += ordKeyValue; contributedThisYear = true; }
        var ltAdd2 = Number(allocations.longTermGainAdded || detail.longTermGainAdded || 0) || 0;
        if (ltAdd2 > 0) { ltGainAddedSupp += ltAdd2; contributedThisYear = true; }
        var stAdd2 = Number(allocations.shortTermLoss || detail.shortTermLoss || 0) || 0;
        if (stAdd2 > 0) { stLossSupp += stAdd2; contributedThisYear = true; }
        // Indirect-effect supps (PTET shifts state→fed, no direct ord
        // offset) — when nothing in ord/LT/ST captured the supp's
        // impact this year, surface its full netBenefit under "Other
        // tax savings" so the CPA sees what each strategy is doing.
        if (!contributedThisYear) {
          var net = Number(s.netBenefit || last.netBenefit || last.totalSaved || 0) || 0;
          if (net > 0) otherTaxSaved += net;
        }
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
    if (row && row.withStrategy && (row.doNothingBaseline || row.baseline)) {
      // Use doNothingBaseline (full-lump scenario) when available so the
      // per-year savings ledger matches the Page-3 net-benefit KPI, which
      // also uses doNothingBaseline.  For Strategy A and synthetic trailing
      // rows the two are identical, so this change is no-op for those paths.
      var _bnForSavings = row.doNothingBaseline || row.baseline;
      brooklynSavings = Number((_bnForSavings && _bnForSavings.total) || 0) - Number(row.withStrategy.total || 0);
    }
    // Supp savings for the year — already NET of per-year supp mgmt fee
    // (see _computeSuppSavingsForYear's perYear branch). The mgmt fee
    // line above is informational, surfacing what was deducted.
    var suppSavings = _computeSuppSavingsForYear(displayedI, fundedSupps);
    var grossBenefit = brooklynSavings + suppSavings;

    if (stLoss === 0 && ordOffset === 0 && ltGainAdded === 0 && other === 0 && grossBenefit === 0 && suppMgmtFee === 0) {
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
    var netForYear = grossBenefit - amFeeYear - bhFeeYear;

    // Surface what Brooklyn losses were APPLIED against this year. The
    // CPA otherwise sees "ST loss generated $1.8M" but doesn't know
    // where the $1.8M went (esp. when no LT gain is shown for the
    // year). The bucket label is inferred from row context:
    //   gainRecognized > 0     → applied to LT capital gain
    //   Y0 + recap > 0         → applied to §1250 depreciation recapture
    //                           (Brooklyn ST losses absorb recap via
    //                           §1212(b) netting before §1211(b) ord cap)
    //   else lossApp ≤ $3K     → applied to ordinary income (§1211(b) cap)
    //   else                   → generic "gain / recap"
    var lossApp = Math.max(0, Number(row && row.lossApplied) || 0);
    var lossAppLabel = '';
    if (lossApp > 0) {
      var rowGain = Math.max(0, Number(row && row.gainRecognized) || 0);
      var cfgRecap = Math.max(0, Number(cfg && cfg.acceleratedDepreciation) || 0);
      if (rowGain > 0) lossAppLabel = 'Loss applied to LT capital gain';
      else if (displayedI === 0 && cfgRecap > 0) lossAppLabel = 'Loss applied to §1250 recapture';
      else if (lossApp <= 3001) lossAppLabel = 'Loss applied to ordinary income (§1211(b) cap)';
      else lossAppLabel = 'Loss applied (gain / recap)';
    }

    var rows = [];
    if (stLoss > 0)      rows.push(['ST loss generated',     _fmt(stLoss)]);
    if (lossApp > 0)     rows.push([lossAppLabel,             _fmt(lossApp)]);
    if (ordOffset > 0)   rows.push(['Ordinary income offset', _fmt(ordOffset)]);
    if (ltGainAdded > 0) rows.push(['LT gain added',          _fmt(ltGainAdded)]);
    if (other > 0)       rows.push(['Other tax savings (PTET, etc.)', _fmt(other)]);

    var grossRow = (grossBenefit !== 0)
      ? '<tr class="temp-gross-row"><td>Gross benefit (tax saved)</td><td class="temp-amt">' + _fmt(grossBenefit) + '</td></tr>'
      : '';

    // Fee lines AFTER the gross row. Order: supp mgmt fee → Asset
    // Manager fee → Brookhaven fee → net-this-year. Supp mgmt fee
    // moved here per advisor: gross is gross before any fees.
    var feeRows = '';
    if (suppMgmtFee > 0) {
      feeRows += '<tr class="temp-feeline-row"><td>Less: Supplemental management fee</td><td class="temp-amt">&minus;' + _fmt(suppMgmtFee) + '</td></tr>';
    }
    if (amFeeYear > 0) {
      feeRows += '<tr class="temp-feeline-row"><td>Less: Asset Manager fee</td><td class="temp-amt">&minus;' + _fmt(amFeeYear) + '</td></tr>';
    }
    if (bhFeeYear > 0) {
      feeRows += '<tr class="temp-feeline-row"><td>Less: Brookhaven fee</td><td class="temp-amt">&minus;' + _fmt(bhFeeYear) + '</td></tr>';
    }
    var netForYearRow = (suppMgmtFee > 0 || amFeeYear > 0 || bhFeeYear > 0)
      ? '<tr class="temp-netyear-row"><td><strong>Net benefit this year</strong></td><td class="temp-amt"><strong>' + _fmt(netForYear - suppMgmtFee) + '</strong></td></tr>'
      : '';

    return '<table class="temp-activity-table"><tbody>' +
      rows.map(function (r) {
        var cls = r[2] ? (' class="' + r[2] + '"') : '';
        return '<tr' + cls + '><td>' + r[0] + '</td><td class="temp-amt">' + r[1] + '</td></tr>';
      }).join('') +
      grossRow +
      feeRows +
      netForYearRow +
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
      var detail = last.detail || {};
      var perYear = Array.isArray(last.perYear) ? last.perYear : null;
      // Multi-year (Oil & Gas style): perYear[i].totalSaved already
      // includes federal + state + NIIT delta for that year. Subtract
      // perYear[i].mgmtFeeDollars when the supp carries a per-year
      // management fee (Delphi). O&G's perYear has no mgmtFeeDollars
      // field, so the subtraction is a no-op there. This makes the
      // per-year sum reconcile to the master-solver's funded-supps net
      // total (the same source the Strategy Summary hero uses).
      if (perYear && perYear[displayedI] != null) {
        var py = perYear[displayedI];
        var pyGross = Number(py.totalSaved || 0) || 0;
        var pyFee   = Number(py.mgmtFeeDollars || 0) || 0;
        sum += Math.max(0, pyGross - pyFee);
        return;
      }
      // Unified multi-year shape (post-rename 2026-05-09): every
      // annual-recurring supp ships taxSavingsY0 + taxSavingsRestPerYear
      // already in tax dollars. Charitable, PTET, Augusta, 401(k).
      // Earlier code multiplied charitable's deductionY0 (which was
      // actually tax-savings, badly named) by marginal — under-counting
      // by a factor of marginal. The rename + this read fixes it.
      if (detail.taxSavingsY0 != null || detail.taxSavingsRestPerYear != null) {
        var yc = Number(detail.yearCount || 1);
        if (displayedI < yc) {
          sum += (displayedI === 0)
            ? Number(detail.taxSavingsY0 || 0)
            : Number(detail.taxSavingsRestPerYear || 0);
        }
        return;
      }
      // Single-year fallback: full netBenefit on Y0.
      if (displayedI === 0) {
        sum += Number(s.netBenefit || last.netBenefit || last.totalSaved || 0) || 0;
      }
    });
    return sum;
  }

  // Bottom-of-page fees panel. Uses the engine's AUTHORITATIVE
  // aggregates (comp.totalSavings + solverOut.totalSupplementalBenefit
  // − comp.totalAllFees) so the displayed net equals Strategy Summary
  // exactly. Per-year breakdown above is informational; the bottom
  // panel is the canonical reconciliation.
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
    // Supplemental side: pull from the master solver's vetted
    // aggregate — that's what Strategy Summary uses for net = primaryNet
    // + supplementalBenefit. Summing individual s.netBenefit values
    // double-counts when supps have rivalry-capping or interlocking
    // effects (Delphi LT-add absorbed by Brooklyn, etc.).
    var suppBenefit = 0;
    if (typeof root.runMasterSolver === 'function') {
      try {
        var sOut = root.runMasterSolver(Number(m.net) || 0);
        if (sOut && Number.isFinite(Number(sOut.totalSupplementalBenefit))) {
          suppBenefit = Math.round(Number(sOut.totalSupplementalBenefit));
        }
      } catch (e) { /* */ }
    }
    var totalGross = brooklynGross + suppBenefit;
    var brooklynFees   = Math.round(Number(m.brooklynFees   || 0) || 0);
    var brookhavenFees = Math.round(Number(m.brookhavenFees || 0) || 0);
    var totalFees      = brooklynFees + brookhavenFees;
    var net = totalGross - totalFees;
    // Strategy Summary's displayed net = primary net (Brooklyn savings
    // − fees) + supplementalBenefit. entry.metrics.net is the primary
    // piece only; adding suppBenefit gives the user-facing total.
    var primaryNet = Math.round(Number(m.net || 0) || 0);
    var ssDisplayedNet = primaryNet + suppBenefit;
    var checkOk = Math.abs(net - ssDisplayedNet) <= 5;

    return '' +
      '<div class="temp-fees-panel">' +
        '<div class="temp-fees-head">Fees &amp; Net Benefit Reconciliation</div>' +
        '<table class="temp-fees-table"><tbody>' +
          '<tr><td>Brooklyn gross savings (across all years)</td><td class="temp-amt">' + _fmt(brooklynGross) + '</td></tr>' +
          '<tr><td>Supplemental tax savings (vetted total)</td><td class="temp-amt">' + _fmt(suppBenefit) + '</td></tr>' +
          '<tr class="temp-fees-subtotal"><td><strong>Total gross benefit</strong></td><td class="temp-amt temp-fees-gross"><strong>' + _fmt(totalGross) + '</strong></td></tr>' +
          '<tr><td>Asset Manager fees (across all years)</td><td class="temp-amt">&minus;' + _fmt(brooklynFees) + '</td></tr>' +
          '<tr><td>Brookhaven fees (across all years)</td><td class="temp-amt">&minus;' + _fmt(brookhavenFees) + '</td></tr>' +
          '<tr class="temp-fees-total"><td><strong>Net benefit (gross − fees)</strong></td><td class="temp-amt"><strong>' + _fmt(net) + '</strong></td></tr>' +
          '<tr class="temp-fees-check' + (checkOk ? ' is-ok' : ' is-mismatch') + '"><td>Strategy Summary net benefit ' + (checkOk ? '✓ matches' : '⚠ mismatch') + '</td><td class="temp-amt">' + _fmt(ssDisplayedNet) + '</td></tr>' +
        '</tbody></table>' +
      '</div>';
  }

  function _renderYearCard(row, i, chosen, cfg, fundedSupps, stateCode, carryIn, carryOut, feeScale) {
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
          _renderBaselineCell(row.doNothingBaseline || row.baseline, carryIn, carryOut) +
        '</div>' +
        '<div class="temp-year-activity">' +
          '<div class="temp-year-head temp-year-head-muted">Strategy activity</div>' +
          _renderActivityCell(row, i, chosen, cfg, fundedSupps, feeScale) +
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
      html += _renderYearCard(row, i, ctx.chosen, ctx.entry.cfg, ctx.fundedSupps, stateCode, carryIn, carryOut, feeScale);
    }
    host.innerHTML = html + _renderFeesPanel(ctx);
  }

  root.renderTempPage = render;
})(window);
