// FILE: js/04-ui/narrative-render.js
// Auto-generated plain-English narrative shown at the top of Page 2.
//
// Pattern source: Holistiplan's "Custom Client Observations" and the
// narrative cards used by FP Alpha and RightCapital. Advisors lean on
// these when explaining the strategy in client meetings — a one-line
// summary anchors the rest of the dashboard.
//
// Reads window.__lastResult, __lastRecommendation, and the form so we
// can name the strategy, the gain, and the savings dollar amount.
//
// Public entry point: renderNarrative()

(function (root) {
  'use strict';

  function _fmt(n) {
    if (n == null || !isFinite(n)) return '—';
    if (typeof fmtUSD === 'function') return fmtUSD(n);
    var sign = n < 0 ? '-' : '';
    var v = Math.round(Math.abs(n));
    return sign + '$' + v.toLocaleString('en-US');
  }

  function _strategyLabel(key) {
    var map = {
      beta1: 'Brooklyn Beta 1',
      beta0: 'Brooklyn Beta 0',
      beta05: 'Brooklyn Beta 0.5',
      advisorManaged: 'Brooklyn Advisor-Managed'
    };
    return map[key] || 'Brooklyn';
  }

  function _stateLabel(code) {
    if (!code || code === 'NONE') return null;
    var m = {
      NY:'New York', CA:'California', TX:'Texas', FL:'Florida',
      WA:'Washington', MA:'Massachusetts', NJ:'New Jersey',
      CT:'Connecticut', IL:'Illinois', PA:'Pennsylvania'
    };
    return m[code] || code;
  }

  function renderNarrative() {
    var host = document.getElementById('narrative-host');
    if (!host) return;
    var result = window.__lastResult;
    if (!result || !result.years || !result.years.length) {
      host.innerHTML = '';
      host.hidden = true;
      return;
    }

    var cfg = result.config || {};
    var years = result.years;
    var horizon = years.length;
    var totals = result.totals || {};

    // Compute the savings story.
    var totalSave = 0, cumFees = 0;
    years.forEach(function (y) {
      var no = y.taxNoBrooklyn || 0;
      var w  = (y.taxWithBrooklyn != null) ? y.taxWithBrooklyn : no;
      totalSave += (no - w);
      cumFees += (y.fee || 0);
    });
    if (totals.cumulativeFees != null) cumFees = totals.cumulativeFees;
    var net = totalSave - cumFees;

    // Property sale + invested capital read directly from DOM (these don't
    // always survive into the projection result).
    var saleEl = document.getElementById('sale-price');
    var costEl = document.getElementById('cost-basis');
    var invEl  = document.getElementById('invested-capital');
    var sale = saleEl ? Number(saleEl.value) || 0 : 0;
    var cost = costEl ? Number(costEl.value) || 0 : 0;
    var invested = invEl ? Number(invEl.value) || 0 : 0;
    var ltGain = Math.max(0, sale - cost);

    var strategy = _strategyLabel(cfg.tierKey || (window.__lastRecommendation && window.__lastRecommendation.tierKey));
    var state = _stateLabel(cfg.state);
    var year1 = years[0].year;

    // Build the narrative sentence(s). Always two short sentences max so
    // it reads as a memo, not a paragraph.
    var s1Parts = [];
    if (sale > 0 && cost > 0 && ltGain > 0) {
      s1Parts.push('A property sale in ' + year1 +
        ' creates an estimated ' + _fmt(ltGain) + ' long-term capital gain' +
        (state ? ' for a ' + state + ' filer' : '') + '.');
    } else {
      s1Parts.push('Projected ' + horizon + '-year baseline tax for ' + year1 +
        '\u2013' + (year1 + horizon - 1) +
        (state ? ' (' + state + ')' : '') + '.');
    }

    var s2;
    if (totalSave > 0) {
      var savingsTone = (net > 0 ? 'a net' : 'a gross');
      s2 = 'Investing ' + _fmt(invested) + ' in ' + strategy +
        ' generates short-term losses that reduce ' + horizon + '-year tax by ' +
        _fmt(totalSave) + ' \u2014 ' + savingsTone + ' benefit of ' +
        _fmt(net) + ' after ' + _fmt(cumFees) + ' in strategy fees.';
    } else if (totalSave === 0) {
      s2 = 'The decision engine recommends no Brooklyn investment given the current inputs.';
    } else {
      s2 = 'The current Brooklyn configuration costs more in fees than it saves in tax. Try increasing leverage or invested capital.';
    }

    // Tone follows NET benefit — what the advisor actually defends. A
    // strategy that reduces tax by $X but costs $X+1 in fees is not
    // "positive" even if gross savings are positive.
    var tone;
    if (totalSave === 0) tone = 'narrative-neutral';
    else if (net > 0)    tone = 'narrative-positive';
    else if (net < 0)    tone = 'narrative-negative';
    else                 tone = 'narrative-neutral';

    host.innerHTML =
      '<div class="rett-narrative ' + tone + '" role="status">' +
        '<div class="narrative-icon" aria-hidden="true">\u00A7</div>' +
        '<div class="narrative-body">' +
          '<p>' + s1Parts.join(' ') + '</p>' +
          '<p>' + s2 + '</p>' +
        '</div>' +
      '</div>';
    host.hidden = false;
  }

  root.renderNarrative = renderNarrative;
})(window);
