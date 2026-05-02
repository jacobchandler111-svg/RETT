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

  function renderSavingsRibbon() {
    var ribbon = document.getElementById('savings-ribbon');
    if (!ribbon) return;
    var result = window.__lastResult;
    var comp = window.__lastComparison;

    var years = null;
    if (comp && Array.isArray(comp.rows) && comp.rows.length) {
      years = comp.rows.map(function (r, idx) {
        var resYr = (result && result.years && result.years[idx]) || {};
        return {
          taxNoBrooklyn: r.baseline ? r.baseline.total : (resYr.taxNoBrooklyn || 0),
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
    // No-engagement detection: when the engine deployed no capital
    // and produced no recognized gain or applied loss anywhere, we
    // suppress the Brookhaven setup fee too (those fees only accrue
    // if the client actually engages). Without this guard the ribbon
    // showed Net Benefit = -$61K for clients with no Brooklyn need
    // (no property gain, no offsetable activity).
    var engineEngaged = false;
    if (comp && Array.isArray(comp.rows) && comp.rows.length) {
      engineEngaged = comp.rows.some(function (r) {
        return (r.investmentThisYear || 0) > 0 ||
               (r.gainRecognized || 0) > 0 ||
               (r.lossApplied || 0) > 0;
      });
    } else {
      engineEngaged = totalSave !== 0 || cumFees > 0;
    }
    if (!engineEngaged) {
      cumFees = 0;
      brookhavenFees = 0;
    }
    var net = totalSave - cumFees - brookhavenFees;

    var saveKind = totalSave > 0 ? 'positive' : (totalSave < 0 ? 'negative' : '');
    var netKind  = net > 0 ? 'positive' : (net < 0 ? 'negative' : '');

    // When Brookhaven fees are zero (e.g. fee data not loaded yet),
    // collapse to the legacy 3-tile layout. Otherwise show the
    // 4-tile breakdown so the advisor sees both fee lines.
    var tiles =
      _tile('Total Tax Savings', _fmt(totalSave), saveKind) +
      _tile('Brooklyn Fees', _fmt(cumFees), '') +
      (brookhavenFees > 0 ? _tile('Brookhaven Fees', _fmt(brookhavenFees), '') : '') +
      _tile('Net Benefit', _fmt(net), netKind);

    ribbon.innerHTML = tiles;
    ribbon.classList.toggle('ribbon-4col', brookhavenFees > 0);
    ribbon.hidden = false;
  }

  root.renderSavingsRibbon = renderSavingsRibbon;
})(window);
