// FILE: js/04-ui/savings-ribbon.js
// Sticky 3-number savings ribbon on Page 2. Pattern borrowed from Instead
// (formerly Corvee) and Holistiplan: an always-visible bar that anchors
// the user's attention on the bottom-line numbers while they tweak
// Brooklyn config, browse the year-by-year table, etc.
//
// Tiles: Total Tax Savings | Cumulative Fees | Net Benefit
// Reads from window.__lastResult populated by controls.js. Hides when no
// result is available.
//
// Public entry point: renderSavingsRibbon()

(function (root) {
  'use strict';

  function _fmt(n) {
    if (n == null || !isFinite(n)) return '—';
    if (typeof fmtUSD === 'function') return fmtUSD(n);
    var sign = n < 0 ? '-' : '';
    var v = Math.round(Math.abs(n));
    return sign + '$' + v.toLocaleString('en-US');
  }

  function _tile(label, value, kind) {
    var cls = 'ribbon-tile';
    if (kind === 'positive') cls += ' tile-positive';
    else if (kind === 'negative') cls += ' tile-negative';
    return '<div class="' + cls + '">' +
      '<span class="ribbon-label">' + label + '</span>' +
      '<span class="ribbon-value">' + value + '</span>' +
    '</div>';
  }

  // Optional sectionType + label drive a per-section render: when the
  // dashboard's IntersectionObserver detects a stacked scenario section
  // in view, it calls this with that section's comp/result so the ribbon
  // reflects the user's current vertical position. Without args, falls
  // back to the global __lastComparison / __lastResult.
  function renderSavingsRibbon(sectionType, sectionLabel) {
    var ribbon = document.getElementById('savings-ribbon');
    if (!ribbon) return;
    var sectionMap = window.__rettSectionData || {};
    var sectionData = sectionType ? sectionMap[sectionType] : null;
    var result = (sectionData && sectionData.result) || window.__lastResult;
    var comp   = (sectionData && sectionData.comp)   || window.__lastComparison;

    var years = null;
    if (comp && Array.isArray(comp.rows) && comp.rows.length) {
      years = comp.rows.map(function (r, idx) {
        var resYr = (result && result.years && result.years[idx]) || {};
        // Prefer doNothingBaseline (lump-Y1, "what would happen if you
        // sold today and did nothing") over baseline (matched-timing,
        // "same recognition schedule but no Brooklyn"). The strategy
        // comparison row uses doNothingBaseline; aligning the ribbon
        // here so all three views (row, ribbon, dashboard KPI) report
        // the SAME savings number for the same scenario. Falls back
        // to baseline for the immediate path (where both are equal
        // by construction).
        var noBrookTax = (r.doNothingBaseline && r.doNothingBaseline.total != null)
          ? r.doNothingBaseline.total
          : (r.baseline ? r.baseline.total : (resYr.taxNoBrooklyn || 0));
        return {
          taxNoBrooklyn: noBrookTax,
          taxWithBrooklyn: r.withStrategy ? r.withStrategy.total : (resYr.taxWithBrooklyn || resYr.taxNoBrooklyn || 0),
          fee: resYr.fee || 0
        };
      });
    } else if (result && result.years && result.years.length) {
      years = result.years;
    }

    if (!years || !years.length) {
      ribbon.hidden = true;
      ribbon.innerHTML = '';
      return;
    }

    var totalSave = 0, cumFees = 0;
    years.forEach(function (y) {
      var no = y.taxNoBrooklyn || 0;
      var w = (y.taxWithBrooklyn != null) ? y.taxWithBrooklyn : no;
      totalSave += (no - w);
      cumFees += (y.fee || 0);
    });
    // For deferred-recognition comparisons, the comparison's per-year
    // fees are the source of truth (the projection engine doesn't know
    // about the deferred schedule's reinvested-gain tranche). Prefer
    // comp.totalFees when present.
    if (comp && comp.deferred && comp.totalFees != null) {
      cumFees = comp.totalFees;
    } else {
      var totals = (result && result.totals) || {};
      if (totals.cumulativeFees != null) cumFees = totals.cumulativeFees;
    }
    // Brookhaven advisory wrap fees ($45K setup + $2K/qtr × 8 qtrs).
    // Show as a separate tile and subtract from the net benefit.
    var brookhavenFees = (comp && comp.totalBrookhavenFees) || 0;
    // Shared engagement detector lives in format-helpers.js so the
    // ribbon, dashboard, and narrative can never disagree on the
    // no-engagement state.
    var engineEngaged = (typeof root.rettEngineEngaged === 'function')
      ? root.rettEngineEngaged(comp, result)
      : (totalSave !== 0 || cumFees > 0);
    if (!engineEngaged) {
      cumFees = 0;
      brookhavenFees = 0;
    }
    var net = totalSave - cumFees - brookhavenFees;

    var saveKind = totalSave > 0 ? 'positive' : (totalSave < 0 ? 'negative' : '');
    var netKind  = net > 0 ? 'positive' : (net < 0 ? 'negative' : '');

    // Section-label header so the user knows which scenario the
    // ribbon is reflecting as they scroll past stacked dashboards.
    var labelHtml = sectionLabel
      ? '<div class="ribbon-section-label">' + sectionLabel + '</div>'
      : '';

    // When Brookhaven fees are zero (e.g. fee data not loaded yet),
    // collapse to the legacy 3-tile layout. Otherwise show the
    // 4-tile breakdown so the advisor sees both fee lines.
    var tiles =
      _tile('Total Tax Savings', _fmt(totalSave), saveKind) +
      _tile('Brooklyn Fees', _fmt(cumFees), '') +
      (brookhavenFees > 0 ? _tile('Brookhaven Fees', _fmt(brookhavenFees), '') : '') +
      _tile('Net Benefit', _fmt(net), netKind);

    ribbon.innerHTML = labelHtml + tiles;
    ribbon.classList.toggle('ribbon-4col', brookhavenFees > 0);
    ribbon.classList.toggle('ribbon-with-label', !!sectionLabel);
    ribbon.hidden = false;
  }

  root.renderSavingsRibbon = renderSavingsRibbon;
})(window);
