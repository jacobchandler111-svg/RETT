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
    var totals = (result && result.totals) || {};
    if (totals.cumulativeFees != null) cumFees = totals.cumulativeFees;
    var net = totalSave - cumFees;

    var saveKind = totalSave > 0 ? 'positive' : (totalSave < 0 ? 'negative' : '');
    var netKind  = net > 0 ? 'positive' : (net < 0 ? 'negative' : '');

    ribbon.innerHTML =
      _tile('Total Tax Savings', _fmt(totalSave), saveKind) +
      _tile('Cumulative Fees', _fmt(cumFees), '') +
      _tile('Net Benefit', _fmt(net), netKind);
    ribbon.hidden = false;
  }

  root.renderSavingsRibbon = renderSavingsRibbon;
})(window);
