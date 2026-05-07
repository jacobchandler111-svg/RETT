// FILE: js/04-ui/temp-page-render.js
// Tab 7 — "Temporary" CPA verification view.
//
// Phase 1: per-year tax-baseline cards laid out top-to-bottom for the
// chosen strategy (window.__rettChosenStrategy = 'A' | 'B' | 'C'). Each
// card shows a Relevant / Not Relevant tag on the left + a baseline
// mini-table on the right. The relevance tag answers "does the math in
// this year actually contribute to the Strategy Summary numbers?"
//
//   A (Sell Now)        — only Y0 is Relevant (full sale lands in year 1)
//   B (Seller Finance)  — Y0 (recapture only) + Y1 (gain) are Relevant
//   C (Structured Sale) — Y0 + every year with recognized gain are Relevant
//
// Phase 2 will add a right-side activity table per Relevant year showing
// the Brooklyn / supplemental movements that produced the Strategy
// Summary numbers (loss generated, ordinary offsets, LT gain added).
//
// Read-only consumer of the engine — re-runs unifiedTaxComparison on
// the chosen strategy's cfg to get rows[].baseline. No engine writes.

(function (root) {
  'use strict';

  // Number of year cards to render (Y0..Y_TOTAL_YEARS-1). User asked
  // for "year zero through year five" = 6 cards.
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

  // Compute a "no sale activity" baseline for a given absolute year.
  // Used to fill Y1..Y5 cards when the engine doesn't produce a row
  // (e.g. Sell Now mode produces only one row). Mirrors baseline-table.js
  // exactly minus the sale-side terms.
  function _recurringBaselineForYear(year) {
    var status = _readVal('filing-status', 'mfj');
    var state  = _readVal('state-code', 'NONE');
    var ord = 0;
    ['w2-wages','se-income','dividend-income','retirement-distributions'].forEach(function (id) {
      ord += Math.max(0, _readNum(id));
    });
    ['biz-revenue','rental-income'].forEach(function (id) { ord += _readNum(id); });
    var stGain = Math.max(0, _readNum('short-term-gain'));
    var wages  = Math.max(0, _readNum('w2-wages'));
    var seInc  = Math.max(0, _readNum('se-income'));
    var nIIT_base = stGain
                  + Math.max(0, _readNum('rental-income'))
                  + Math.max(0, _readNum('dividend-income'));
    var fedB = (typeof root.computeFederalTaxBreakdown === 'function')
      ? root.computeFederalTaxBreakdown(ord, year, status, {
          longTermGain: 0, shortTermGain: stGain, depreciationRecapture: 0,
          investmentIncome: nIIT_base, wages: wages, seIncome: seInc
        })
      : null;
    var fedOrd  = fedB ? Number(fedB.ordinaryTax) || 0 : 0;
    var fedLt   = fedB ? Number(fedB.ltTax)       || 0 : 0;
    var amt     = fedB ? Number(fedB.amtTopUp)    || 0 : 0;
    var seTax   = fedB ? Number(fedB.seTax)       || 0 : 0;
    var niit    = fedB ? Number(fedB.niit)        || 0 : 0;
    var addmed  = fedB ? Number(fedB.addlMedicare)|| 0 : 0;
    var fedTotal = fedOrd + fedLt + amt;
    var stateTax = (typeof root.computeStateTax === 'function')
      ? (root.computeStateTax(ord + stGain, year, state, status,
            { longTermGain: 0, shortTermGain: stGain }) || 0)
      : 0;
    var total = fedTotal + niit + addmed + seTax + stateTax;
    return {
      federalIncomeTax: fedTotal,
      ordinaryTax: fedOrd, recapTax: 0, ltTax: fedLt, amt: amt,
      niit: niit, addlMedicare: addmed, seTax: seTax,
      state: stateTax, total: total
    };
  }

  function _stratLabel(t) {
    if (t === 'A') return 'Sell Now';
    if (t === 'B') return 'Seller Finance';
    if (t === 'C') return 'Structured Sale';
    return null;
  }

  // Pull the chosen strategy's engine output. Re-runs the engine using
  // the entry's cfg (same path the Strategy Summary uses for its REVIEW
  // panel) so per-year baselines reflect whatever the user last saved.
  // Returns { entry, comp } or null if no chosen strategy / no entry.
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
      try { ecfg = root.rettFlavorEngineCfg(ecfg); } catch (e) { /* fall through with raw cfg */ }
    }
    if (typeof root.unifiedTaxComparison !== 'function') return null;
    var comp;
    try { comp = root.unifiedTaxComparison(ecfg); } catch (e) { return null; }
    if (!comp || !comp.rows) return null;
    return { entry: entry, comp: comp, chosen: chosen };
  }

  // For a given row index `i`, decide whether this year is Relevant
  // under the chosen strategy. Logic mirrors what the user wants the
  // CPA to verify:
  //   - Any year with gain recognized → Relevant
  //   - Any year with Brooklyn loss applied → Relevant
  //   - Y0 specifically when recapture lands there → Relevant
  //     (true for B and C — recap is taken in the sale year even when
  //      the gain itself is pushed forward)
  function _isRelevant(row, i, chosen, cfg) {
    var gain = Number(row && row.gainRecognized) || 0;
    var loss = Number(row && row.lossApplied) || 0;
    if (gain > 0 || loss > 0) return true;
    if (i === 0) {
      var recap = Number(cfg && (cfg.depreciationRecapture || cfg.acceleratedDepreciation)) || 0;
      if (recap > 0 && (chosen === 'B' || chosen === 'C')) return true;
      // Sell Now (A): if the engine produced no gain in row 0, the user
      // hasn't actually wired a sale — fall through to Not Relevant.
    }
    return false;
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

  function _renderBaselineCell(b) {
    // Mirror the Page-2 baseline table's labels, but compact — six
    // canonical lines plus the total, so the CPA can tie out by eye.
    if (!b) return '<div class="temp-baseline-empty">No baseline data.</div>';
    var fed = (b.federalIncomeTax != null)
      ? Number(b.federalIncomeTax)
      : ((Number(b.ordinaryTax) || 0) + (Number(b.recapTax) || 0) + (Number(b.ltTax) || 0) + (Number(b.amt) || 0));
    var amt    = Number(b.amt) || 0;
    var niit   = Number(b.niit) || 0;
    var addmed = Number(b.addlMedicare) || 0;
    var setax  = Number(b.seTax) || 0;
    var state  = Number(b.state) || 0;
    var total  = Number(b.total) || (fed + niit + addmed + setax + state);
    var rows = [
      ['Federal income tax',      fed],
      ['AMT top-up',              amt],
      ['NIIT (3.8%)',             niit],
      ['Additional Medicare',     addmed],
      ['SE tax',                  setax],
      ['State income tax',        state]
    ];
    var rowHtml = rows.map(function (r) {
      // Hide zero-value optional rows (AMT, NIIT, addl Medicare, SE) —
      // keeps the per-year card visually tight when the line is N/A.
      if (r[1] === 0 && (r[0] === 'AMT top-up' || r[0] === 'Additional Medicare' || r[0] === 'SE tax')) return '';
      return '<tr><td>' + r[0] + '</td><td class="temp-amt">' + _fmt(r[1]) + '</td></tr>';
    }).join('');
    return '' +
      '<table class="temp-baseline-table">' +
        '<tbody>' + rowHtml +
          '<tr class="temp-total-row"><td><strong>Total tax</strong></td><td class="temp-amt"><strong>' + _fmt(total) + '</strong></td></tr>' +
        '</tbody>' +
      '</table>';
  }

  function _renderYearCard(row, i, chosen, cfg) {
    var year  = Number(row.year) || (i + 1);
    var label = 'Year ' + i + ' (' + year + ')';
    var rel   = _isRelevant(row, i, chosen, cfg);
    var relClass = rel ? 'temp-rel-yes' : 'temp-rel-no';
    var relText  = rel ? 'Relevant' : 'Not relevant';
    return '' +
      '<div class="temp-year-card ' + (rel ? 'is-relevant' : 'is-not-relevant') + '">' +
        '<div class="temp-year-rel ' + relClass + '" aria-label="' + relText + '">' +
          '<div class="temp-rel-eyebrow">' + label + '</div>' +
          '<div class="temp-rel-tag">' + relText + '</div>' +
        '</div>' +
        '<div class="temp-year-baseline">' +
          '<div class="temp-year-head">Tax Baseline &mdash; ' + label + '</div>' +
          _renderBaselineCell(row.baseline) +
        '</div>' +
        '<div class="temp-year-activity">' +
          '<div class="temp-year-head temp-year-head-muted">Strategy activity</div>' +
          '<div class="temp-activity-placeholder">Phase 2 &mdash; activity table goes here.</div>' +
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
    // Always render TOTAL_YEARS cards (Y0..Y_TOTAL_YEARS-1). For
    // years the engine produced rows for, use the engine's baseline.
    // For years it didn't (typical in Sell Now mode), synthesize a
    // recurring-income baseline so the CPA can still see the
    // "this year had no sale activity" tax bill.
    var engineRows = ctx.comp.rows || [];
    var year0 = engineRows.length ? Number(engineRows[0].year) : (parseInt(_readVal('year1','2026'), 10) || 2026);
    var html = '';
    for (var i = 0; i < TOTAL_YEARS; i++) {
      var yr = year0 + i;
      var row = engineRows[i] || null;
      if (!row) {
        row = { year: yr, baseline: _recurringBaselineForYear(yr), gainRecognized: 0, lossApplied: 0 };
      }
      html += _renderYearCard(row, i, ctx.chosen, ctx.entry.cfg);
    }
    host.innerHTML = html;
  }

  root.renderTempPage = render;
})(window);
