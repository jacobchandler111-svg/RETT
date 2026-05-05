// FILE: js/04-ui/strategy-summary-render.js
// Page 4 (Strategy Summary). Layout inspired by the BrookHaven Moving
// Forward tab: a hero ROI multiplier on top, fee-vs-savings compare
// row, Brooklyn / Brookhaven fee breakdown, proportional bar viz, and
// a plain-English bottom-line callout. Renders one block per strategy
// the user marked Interested on Page 2 (or all three if none marked).
//
// Public entry point: renderStrategySummary(). Reads the per-scenario
// data from window.buildInterestedSummary() (defined in
// projection-dashboard-render.js) so Page 4 stays in sync with Page 3.

(function (root) {
  'use strict';

  function _fmt(n) {
    if (n == null || !isFinite(n)) return '—';
    if (typeof fmtUSD === 'function') return fmtUSD(n);
    var sign = n < 0 ? '-' : '';
    var v = Math.round(Math.abs(n));
    return sign + '$' + v.toLocaleString('en-US');
  }

  function _fmtMultiplier(ratio) {
    if (!isFinite(ratio) || ratio <= 0) return '—';
    if (ratio >= 100) return Math.round(ratio).toLocaleString('en-US');
    if (ratio >= 10)  return ratio.toFixed(0);
    return ratio.toFixed(1);
  }

  // Each strategy block: hero ROI, compare row + net benefit, fee
  // breakdown (Brooklyn / Brookhaven), proportional bar viz, callout.
  function _strategyBlock(entry, isRecommended) {
    var m = entry.metrics;
    var fees = (m.fees || 0);
    var savings = Math.max(0, (m.doNothing || 0) - (m.tax || 0));
    var net = m.net || 0;
    var roi = fees > 0 ? (savings / fees) : 0;
    // Bar widths: scale relative to the larger of fees/savings so the
    // visual stays proportional even when one dwarfs the other.
    var maxBar = Math.max(fees, savings, 1);
    var feePct = Math.max(1, (fees / maxBar) * 100);
    var savePct = Math.max(1, (savings / maxBar) * 100);

    var brooklynFees = m.brooklynFees || 0;
    var brookhavenFees = m.brookhavenFees || 0;

    var narrative;
    if (roi >= 5) {
      narrative = 'A strong return: every dollar in fees returns roughly $' +
        _fmtMultiplier(roi) + ' in tax savings. Brooklyn handles the position, Brookhaven handles the planning, and what is left over for you is shown as net benefit.';
    } else if (roi >= 2) {
      narrative = 'A solid return: every dollar in fees returns roughly $' +
        _fmtMultiplier(roi) + ' in tax savings. The fee load is meaningful here — review the Brooklyn vs Brookhaven split below to see exactly where the money goes.';
    } else if (roi > 1) {
      narrative = 'This strategy still nets positive after fees, but the margin is thin. The fee load is eating most of the savings — worth comparing against the other Interested strategies.';
    } else if (net >= 0) {
      narrative = 'Fees roughly offset the projected savings here. The strategy is not actively destroying value, but it is not generating much either.';
    } else {
      narrative = 'Fees exceed projected tax savings on this strategy. Net benefit is negative — this option is not recommended given the current inputs.';
    }

    var recBadge = isRecommended
      ? '<span class="rett-summary-rec-tag">Recommended</span>'
      : '';

    var blockCls = 'rett-summary-block' + (isRecommended ? ' is-recommended' : '');

    return '<div class="' + blockCls + '" data-type="' + entry.type + '">' +

      // Header
      '<div class="rett-summary-header">' +
        '<span class="rett-summary-num">STRATEGY ' + entry.num + '</span>' +
        '<span class="rett-summary-name">' + entry.name + '</span>' +
        recBadge +
      '</div>' +

      // ROI Hero (gradient navy panel + big multiplier)
      '<div class="roi-hero">' +
        '<div class="roi-label">Return on Fees</div>' +
        '<div class="roi-multiple">' + _fmtMultiplier(roi) + '<span class="x">×</span></div>' +
        '<div class="roi-sub">For every $1 in fees, $' + _fmtMultiplier(roi) +
          ' returned in projected tax savings</div>' +
      '</div>' +

      // Compare row + net benefit footer
      '<div class="forward-compare">' +
        '<div class="compare-row">' +
          '<div class="compare-side cost">' +
            '<div class="compare-label">Total Fees</div>' +
            '<div class="compare-amt"><span class="currency">$</span>' +
              Math.round(fees).toLocaleString('en-US') + '</div>' +
            '<div class="compare-detail">Brooklyn position + Brookhaven planning</div>' +
          '</div>' +
          '<div class="compare-divider">vs.</div>' +
          '<div class="compare-side savings">' +
            '<div class="compare-label">Tax Savings</div>' +
            '<div class="compare-amt"><span class="currency">$</span>' +
              Math.round(savings).toLocaleString('en-US') + '</div>' +
            '<div class="compare-detail">vs. doing nothing</div>' +
          '</div>' +
        '</div>' +
        '<div class="compare-net">' +
          '<div class="net-label">Net Benefit (after all fees)</div>' +
          '<div class="net-amt"><span class="currency">$</span>' +
            Math.round(net).toLocaleString('en-US') + '</div>' +
        '</div>' +
      '</div>' +

      // Fee breakdown panel (Brooklyn vs Brookhaven)
      '<div class="rett-fee-breakdown">' +
        '<div class="rett-fee-row">' +
          '<div class="rett-fee-info">' +
            '<div class="rett-fee-name">Brooklyn fees</div>' +
            '<div class="rett-fee-desc">Cumulative cost of running the loss-generating position over the projection horizon — borrow costs, fund-level fees, and short-side carry.</div>' +
          '</div>' +
          '<div class="rett-fee-amt">' + _fmt(brooklynFees) + '</div>' +
        '</div>' +
        '<div class="rett-fee-row">' +
          '<div class="rett-fee-info">' +
            '<div class="rett-fee-name">Brookhaven fees</div>' +
            '<div class="rett-fee-desc">Planning engagement (one-time) plus ongoing service — annual return prep and strategy review calls. Flat schedule independent of transaction size.</div>' +
          '</div>' +
          '<div class="rett-fee-amt">' + _fmt(brookhavenFees) + '</div>' +
        '</div>' +
        '<div class="rett-fee-total">' +
          '<div class="rett-fee-name">Total Fees</div>' +
          '<div class="rett-fee-amt">' + _fmt(fees) + '</div>' +
        '</div>' +
      '</div>' +

      // Bar viz: fees vs savings, scaled to the larger
      '<div class="forward-viz">' +
        '<div class="viz-row">' +
          '<div class="viz-label">Fees</div>' +
          '<div class="viz-bar-wrap">' +
            '<div class="viz-bar fee" style="width:' + feePct.toFixed(2) + '%"></div>' +
            '<span class="viz-amt">' + _fmt(fees) + '</span>' +
          '</div>' +
        '</div>' +
        '<div class="viz-row">' +
          '<div class="viz-label">Tax Savings</div>' +
          '<div class="viz-bar-wrap">' +
            '<div class="viz-bar savings" style="width:' + savePct.toFixed(2) + '%"></div>' +
            '<span class="viz-amt">' + _fmt(savings) + '</span>' +
          '</div>' +
        '</div>' +
      '</div>' +

      // Bottom-line callout
      '<div class="forward-callout">' +
        '<div class="callout-label">Bottom Line</div>' +
        '<p>' + narrative + '</p>' +
      '</div>' +

    '</div>';
  }

  function renderStrategySummary() {
    var host = document.getElementById('strategy-fee-summary-host');
    if (!host) return;
    if (typeof root.buildInterestedSummary !== 'function') {
      host.innerHTML = '<div class="muted" style="padding:18px 0;">Run the projection on Page 3 first.</div>';
      return;
    }
    var summary = root.buildInterestedSummary();
    if (!summary) {
      host.innerHTML = '<div class="muted" style="padding:18px 0;">Fill in the client inputs on Page 1 to see strategy fees.</div>';
      return;
    }
    var entries = summary.entries;
    var recIdx = summary.recIdx;

    var interest = (typeof window !== 'undefined' && window.__rettStrategyInterest) || {};
    var anyTrue = ['A','B','C'].some(function (k) { return interest[k] === true; });

    var filtered = anyTrue
      ? entries.filter(function (e) { return interest[e.type] === true; })
      : entries.slice();

    var hint = anyTrue
      ? ''
      : '<div class="rett-interested-hint" style="margin-bottom:24px;">Mark <strong>Interested</strong> on the Strategies page to filter this view to the options you actually plan to pursue.</div>';

    if (!filtered.length) {
      host.innerHTML = hint + '<div class="muted" style="padding:18px 0;">No strategies to summarize.</div>';
      return;
    }

    // On the Strategy Summary page we mark the best-of-SHOWN as
    // Recommended rather than the global winner. The user is here to
    // compare fees among strategies they actually plan to pursue —
    // pointing at a global winner that's been filtered out adds noise.
    // Page 3's Interested cards keep the global behavior so the
    // recommended badge there means "what the engine picked overall".
    var bestNet = -Infinity, bestIdx = -1;
    filtered.forEach(function (e, i) {
      if (e.metrics.net > bestNet) { bestNet = e.metrics.net; bestIdx = i; }
    });

    var html = hint;
    filtered.forEach(function (e, i) {
      html += _strategyBlock(e, i === bestIdx);
    });

    host.innerHTML = html;
  }

  root.renderStrategySummary = renderStrategySummary;
})(window);
