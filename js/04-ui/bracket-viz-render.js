// FILE: js/04-ui/bracket-viz-render.js
// Per-year federal-bracket visualization for Page 2.
//
// Pattern source: Holistiplan, RightCapital, ProjectionLab — all three
// use a "where does the client land in the marginal bracket" chart as
// their signature visualization. Implementation here is pure inline SVG
// so we stay vanilla and ship-ready.
//
// Layout: one horizontal bar per year. Each bar's background is the
// stack of marginal-bracket bands (light yellow → red), capped at a
// reasonable max so the bar isn't dominated by the highest open-ended
// bracket. A small triangle tick marks where the client's federal
// taxable ordinary income lands. Numeric callouts show income $ and
// the marginal rate.
//
// Reads from window.__lastResult (years[]). Federal brackets come from
// getFederalBrackets() / getFederalStandardDeduction() exposed by the
// 02-tax-engine subsystem (read-only consumer; we never mutate them).
//
// Public entry point: renderBracketViz(host)

(function (root) {
  'use strict';

  // Accounting format with $ and commas. Used for the per-row income
  // readout. (Chart axes elsewhere use a compact $X.XM form because long
  // labels would overlap; this row readout has its own column so we
  // can show the full number.)
  function _fmtAccounting(n) {
    if (n == null || !isFinite(n)) return '\u2014';
    if (typeof fmtUSD === 'function') return fmtUSD(n);
    var sign = n < 0 ? '-' : '';
    var v = Math.round(Math.abs(n));
    return sign + '$' + v.toLocaleString('en-US');
  }

  // Color band per marginal rate. Yellow → orange → red, matching the
  // standard "bracket creep" visual language. Rate values are in decimal
  // form (e.g. 0.32). We bucket on rate, not bracket index, so a state's
  // top bracket and federal's match get visually consistent colors when
  // the same rate appears.
  function _bandColorForRate(rate) {
    if (rate >= 0.37) return 'rgba(248, 113, 113, 0.55)';
    if (rate >= 0.35) return 'rgba(248, 145, 113, 0.5)';
    if (rate >= 0.32) return 'rgba(251, 191, 36, 0.45)';
    if (rate >= 0.24) return 'rgba(251, 217, 100, 0.4)';
    if (rate >= 0.22) return 'rgba(190, 220, 130, 0.35)';
    if (rate >= 0.12) return 'rgba(132, 204, 152, 0.3)';
    return 'rgba(95, 168, 255, 0.25)';
  }

  // Find the marginal rate (and its top boundary) the client's taxable
  // income falls into.
  function _marginalAt(brackets, income) {
    if (!brackets || !brackets.length) return { rate: 0, max: Infinity };
    for (var i = 0; i < brackets.length; i++) {
      if (income <= brackets[i][0]) {
        return { rate: brackets[i][1], max: brackets[i][0] };
      }
    }
    var last = brackets[brackets.length - 1];
    return { rate: last[1], max: last[0] };
  }

  // Build one row's SVG. width is the inner-svg width.
  function _buildRow(year, taxableIncome, brackets, width) {
    var H = 38;
    var barH = 16;
    var barY = (H - barH) / 2;

    // Cap the visual max at 1.25× the client's income or the bracket
    // immediately above the marginal one — whichever is larger. This
    // prevents the open-ended top bracket (Infinity) from dominating.
    var marginal = _marginalAt(brackets, taxableIncome);
    var visualMax = Math.max(taxableIncome * 1.4, marginal.max * 1.05);
    if (!isFinite(visualMax)) visualMax = Math.max(taxableIncome * 1.4, 1e6);
    // Walk brackets to find a sensible upper bound that's not Infinity.
    var lastFinite = brackets.reduce(function (acc, b) {
      return isFinite(b[0]) ? b[0] : acc;
    }, taxableIncome * 1.4);
    if (visualMax === Infinity) visualMax = lastFinite * 1.1;

    // Build the bracket bands left-to-right.
    var bands = '';
    var prev = 0;
    for (var i = 0; i < brackets.length; i++) {
      var top = brackets[i][0];
      var rate = brackets[i][1];
      var clipped = Math.min(top, visualMax);
      if (clipped <= prev) { prev = clipped; continue; }
      var x1 = (prev / visualMax) * width;
      var x2 = (clipped / visualMax) * width;
      var w = Math.max(0, x2 - x1);
      bands += '<rect x="' + x1.toFixed(2) + '" y="' + barY +
        '" width="' + w.toFixed(2) + '" height="' + barH +
        '" fill="' + _bandColorForRate(rate) + '"/>';
      prev = clipped;
      if (clipped >= visualMax) break;
    }

    // Tick mark — vertical line + triangle pointer for client income.
    var tickX = Math.min(width, (taxableIncome / visualMax) * width);
    var tick =
      '<line x1="' + tickX.toFixed(2) + '" x2="' + tickX.toFixed(2) +
      '" y1="' + (barY - 4) + '" y2="' + (barY + barH + 4) +
      '" stroke="#ffffff" stroke-width="2"/>' +
      '<polygon points="' + (tickX - 4) + ',' + (barY + barH + 4) + ' ' +
      (tickX + 4) + ',' + (barY + barH + 4) + ' ' +
      tickX + ',' + (barY + barH + 10) +
      '" fill="#ffffff"/>';

    var rateLabel = (marginal.rate * 100).toFixed(0) + '%';
    var incomeLabel = _fmtAccounting(taxableIncome);

    return '<div class="bv-row">' +
      '<div class="bv-year">' + year + '</div>' +
      '<svg class="bv-bar" viewBox="0 0 ' + width + ' ' + H +
      '" preserveAspectRatio="none" aria-label="Federal bracket bar for year ' + year + '">' +
      '<rect x="0" y="' + barY + '" width="' + width + '" height="' + barH +
      '" fill="rgba(15,76,129,0.25)" stroke="rgba(95,168,255,0.2)" stroke-width="1"/>' +
      bands + tick + '</svg>' +
      '<div class="bv-readouts">' +
        '<span class="bv-income">' + incomeLabel + '</span>' +
        '<span class="bv-rate">' + rateLabel + ' marginal</span>' +
      '</div>' +
    '</div>';
  }

  // Compute federal taxable ordinary income for a year row from the
  // projection engine. Note: this matches the simplified ordinary base
  // used by the engine (ordinary + max(0, shortGain) - federal standard
  // deduction). It is a planning-grade approximation, not a return prep.
  function _taxableOrdinary(yr, status) {
    var ord = (yr.ordinary || 0) + Math.max(0, yr.shortGain || 0);
    var stdDed = 0;
    if (typeof getFederalStandardDeduction === 'function') {
      try { stdDed = getFederalStandardDeduction(yr.year, status) || 0; } catch (e) {}
    }
    return Math.max(0, ord - stdDed);
  }

  function renderBracketViz(host) {
    host = host || document.getElementById('bracket-viz-host');
    if (!host) return;
    var result = window.__lastResult;
    if (!result || !result.years || !result.years.length) {
      host.innerHTML = '';
      return;
    }
    if (typeof getFederalBrackets !== 'function') {
      host.innerHTML = '';
      return;
    }

    var cfg = result.config || {};
    var status = cfg.filingStatus || 'single';
    var width = 600;

    var rows = '';
    result.years.forEach(function (yr) {
      var brackets = getFederalBrackets(yr.year, status);
      if (!brackets || !brackets.length) return;
      var taxable = _taxableOrdinary(yr, status);
      rows += _buildRow(yr.year, taxable, brackets, width);
    });

    if (!rows) {
      host.innerHTML = '';
      return;
    }

    // Legend uses 4 representative bands so we don't overwhelm.
    var legend = '<div class="bv-legend">' +
      '<span class="bv-legend-title">Marginal bracket bands</span>' +
      '<span><span class="bv-swatch" style="background:' + _bandColorForRate(0.10) + '"></span>10–22%</span>' +
      '<span><span class="bv-swatch" style="background:' + _bandColorForRate(0.24) + '"></span>24%</span>' +
      '<span><span class="bv-swatch" style="background:' + _bandColorForRate(0.32) + '"></span>32%</span>' +
      '<span><span class="bv-swatch" style="background:' + _bandColorForRate(0.37) + '"></span>35–37%</span>' +
      '<span><span class="bv-tick"></span>Client income</span>' +
    '</div>';

    host.innerHTML = '<div class="rett-chart-wrap">' +
      '<div class="rett-chart-title"><span>Federal Bracket Position by Year</span></div>' +
      legend +
      '<div class="bv-rows">' + rows + '</div>' +
      '<p class="bv-footnote">Approximates federal taxable ordinary income (income + ST gain − standard deduction). Capital-gain brackets are tracked separately in the projection engine.</p>' +
      '</div>';
  }

  root.renderBracketViz = renderBracketViz;
})(window);
