// FILE: js/04-ui/baseline-table.js
// Live "Tax Liability if you did nothing" table on the Page-1 inputs
// page. Mirrors the do-nothing baseline the engine computes for the
// dashboard so the user sees the same starting point on Page 1 that
// the strategy comparison is trying to beat.
//
// Reads form fields directly (no engine cfg dependency) and calls
// computeFederalTaxBreakdown + computeStateTax from the loaded tax
// engine. Re-renders on every form input/change event, debounced.

(function (root) {
  'use strict';

  function _val(id) {
    var el = document.getElementById(id);
    return el ? el.value : '';
  }
  function _num(id) {
    return (typeof parseUSD === 'function') ? (parseUSD(_val(id)) || 0)
                                            : (Number(_val(id)) || 0);
  }
  function _fmt(n) {
    if (n == null || !isFinite(n)) return '$0';
    var sign = n < 0 ? '-' : '';
    return sign + '$' + Math.round(Math.abs(n)).toLocaleString('en-US');
  }
  function _set(id, txt) {
    var el = document.getElementById(id);
    if (el) el.textContent = txt;
  }

  function render() {
    var year = parseInt(_val('year1'), 10) || (new Date()).getFullYear();
    var status = _val('filing-status') || 'mfj';
    var state = _val('state-code') || 'NONE';

    // Year tag in the section heading
    _set('baseline-year-tag', year + ' PROJECTION');

    // Sum ordinary income sources
    var ordSources = ['w2-wages', 'se-income', 'biz-revenue',
                      'rental-income', 'dividend-income',
                      'retirement-distributions'];
    var ordTotal = 0;
    ordSources.forEach(function (id) { ordTotal += Math.max(0, _num(id)); });

    var stGain = Math.max(0, _num('short-term-gain'));
    var sale  = Math.max(0, _num('sale-price'));
    var basis = Math.max(0, _num('cost-basis'));
    var depr  = Math.max(0, _num('accelerated-depreciation'));
    var ltGain = Math.max(0, sale - basis - depr - stGain);
    var recap  = depr;  // recapture treated as ordinary

    // Wage base for Additional Medicare = W-2 + SE only
    var wages = Math.max(0, _num('w2-wages')) + Math.max(0, _num('se-income'));
    // NIIT base = LT + ST + investment-flavored ordinary (rental + dividend)
    var nIIT_base = ltGain + stGain
                  + Math.max(0, _num('rental-income'))
                  + Math.max(0, _num('dividend-income'));

    // Federal tax via the engine's breakdown
    var ord = ordTotal + recap + stGain;   // recapture and ST hit ordinary brackets
    var fedB = (typeof computeFederalTaxBreakdown === 'function')
      ? computeFederalTaxBreakdown(ord, year, status, {
          longTermGain: ltGain,
          investmentIncome: nIIT_base,
          wages: wages
        })
      : null;

    var fedTotal = fedB ? (Number(fedB.ordinaryTax) || 0) + (Number(fedB.ltTax) || 0)
                                  + (Number(fedB.amtTopUp) || 0) : 0;
    var niit  = fedB ? Number(fedB.niit)  || 0 : 0;
    var addmed = fedB ? Number(fedB.addlMedicare) || 0 : 0;

    // State tax (passes total income; state engine handles LTCG-vs-ordinary
    // per state-specific rules)
    var stateTax = (typeof computeStateTax === 'function')
      ? (computeStateTax(ord + ltGain, year, state, status, { longTermGain: ltGain }) || 0)
      : 0;

    var total = fedTotal + niit + addmed + stateTax;

    _set('bt-ord',     _fmt(ordTotal + recap));
    _set('bt-ord-sub', _fmt(ordTotal));
    _set('bt-stg',     _fmt(stGain));
    _set('bt-ltg',     _fmt(ltGain));
    _set('bt-ltg-sub', _fmt(ltGain));
    _set('bt-recap',   _fmt(recap));
    _set('bt-taxable', _fmt(ord + ltGain));
    _set('bt-fed',     _fmt(fedTotal));
    _set('bt-state',   _fmt(stateTax));
    _set('bt-niit',    _fmt(niit));
    _set('bt-addmed',  _fmt(addmed));
    _set('bt-tot',     _fmt(total));
  }

  function _debounce(fn, ms) {
    var t;
    return function () {
      clearTimeout(t);
      t = setTimeout(fn, ms);
    };
  }
  var debounced = _debounce(render, 150);

  function _attach() {
    // Listen on the input fields the table depends on. Anything that
    // changes ordinary income, gains, depreciation, filing, or state
    // re-renders the baseline. The form's existing money-format
    // listeners reformat values on blur first; we then read.
    var ids = [
      'year1', 'filing-status', 'state-code',
      'w2-wages', 'se-income', 'biz-revenue',
      'rental-income', 'dividend-income', 'retirement-distributions',
      'sale-price', 'cost-basis', 'accelerated-depreciation',
      'short-term-gain'
    ];
    ids.forEach(function (id) {
      var el = document.getElementById(id);
      if (!el) return;
      el.addEventListener('input',  debounced);
      el.addEventListener('change', debounced);
    });
    // Initial paint.
    render();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _attach);
  } else {
    _attach();
  }

  root.renderBaselineTable = render;
})(window);
