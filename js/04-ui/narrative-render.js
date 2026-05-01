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

    // Compute the savings story. Pull from the comparison rows when
    // available so the narrative agrees with the ribbon and hero (the
    // raw projection-engine deltas can disagree because they don't
    // reflect the structured-sale recommendation).
    var totalSave = 0, cumFees = 0;
    var comp = window.__lastComparison;
    if (comp && Array.isArray(comp.rows) && comp.rows.length) {
      if (comp.totalSavings != null) {
        totalSave = comp.totalSavings;
      } else {
        comp.rows.forEach(function (r) { totalSave += (r.savings || 0); });
      }
      if (comp.deferred && comp.totalFees != null) {
        cumFees = comp.totalFees;
      } else {
        years.forEach(function (y) { cumFees += (y.fee || 0); });
      }
    } else {
      years.forEach(function (y) {
        var no = y.taxNoBrooklyn || 0;
        var w  = (y.taxWithBrooklyn != null) ? y.taxWithBrooklyn : no;
        totalSave += (no - w);
        cumFees += (y.fee || 0);
      });
    }
    if (!(comp && comp.deferred) && totals.cumulativeFees != null) cumFees = totals.cumulativeFees;
    var net = totalSave - cumFees;

    // Invested capital: prefer the cfg.investment that the projection
    // actually ran with (which inputs-collector resolves as Available
    // Capital when the dedicated invested-capital field is hidden /
    // zero). Fall back to the available-capital field, then to the
    // legacy invested-capital field.
    var sale = Number((document.getElementById('sale-price') || {}).value) || 0;
    var cost = Number((document.getElementById('cost-basis') || {}).value) || 0;
    var invested = (cfg && Number(cfg.investment)) ||
                   Number((document.getElementById('available-capital') || {}).value) ||
                   Number((document.getElementById('invested-capital') || {}).value) ||
                   0;
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
    } else if (invested > 0 && totalSave === 0) {
      s2 = 'Investing ' + _fmt(invested) + ' in ' + strategy +
        ' generates losses, but they produce no tax offset for these inputs. ' +
        'Try a different leverage, horizon, or recognition timing.';
    } else if (totalSave === 0) {
      s2 = 'No Brooklyn investment is recommended for these inputs.';
    } else {
      s2 = 'Investing ' + _fmt(invested) + ' in ' + strategy +
        ' costs more in fees than it saves in tax for these inputs. ' +
        'Try a different leverage or horizon.';
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
