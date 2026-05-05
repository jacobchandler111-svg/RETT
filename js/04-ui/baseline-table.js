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
  function _showRow(id, show) {
    // Cells live inside <tr> rows; toggle the closest TR display so
    // optional rows (loss offset, SE tax, AMT) are hidden when the
    // amount is zero — keeps the baseline table tight on common cases.
    var el = document.getElementById(id);
    if (!el) return;
    var tr = el.closest && el.closest('tr');
    if (tr) tr.style.display = show ? '' : 'none';
  }

  function render() {
    var year = parseInt(_val('year1'), 10) || (new Date()).getFullYear();
    var status = _val('filing-status') || 'mfj';
    var state = _val('state-code') || 'NONE';

    // Year tag in the section heading
    _set('baseline-year-tag', year + ' PROJECTION');

    // Sum ordinary income sources. Positive-only fields (W-2, SE,
    // dividend, retirement) clamp at $0; biz-revenue and rental-income
    // pass through SIGNED so Schedule C / Schedule E losses can offset
    // other ordinary income. (Bug #14.)
    var ordSourcesPos    = ['w2-wages', 'se-income', 'dividend-income',
                            'retirement-distributions'];
    var ordSourcesSigned = ['biz-revenue', 'rental-income'];
    var ordTotal = 0;
    ordSourcesPos.forEach(function (id)    { ordTotal += Math.max(0, _num(id)); });
    ordSourcesSigned.forEach(function (id) { ordTotal += _num(id); });

    var stGain = Math.max(0, _num('short-term-gain'));
    var sale  = Math.max(0, _num('sale-price'));
    var basis = Math.max(0, _num('cost-basis'));
    var depr  = Math.max(0, _num('accelerated-depreciation'));
    // Long-term gain is SIGNED — a property sale at a loss (sale < basis)
    // yields a negative number, which IRC §1211(b) lets us offset against
    // ordinary income up to $3,000 ($1,500 MFS). Previously the UI
    // clamped to 0 and silently dropped the loss. (P0-4.)
    // STG is NO LONGER subtracted from the property LT gain — it's now
    // an independent income item under "Income Sources" representing
    // ANY short-term capital gain the client recognized this year
    // (stock sales, crypto, etc.), not a slice of the property sale.
    var ltGainSigned = sale - basis - depr;
    // For the displayed "Long-Term Capital Gain" row, show the signed
    // value so users see the loss explicitly. The bracket math will
    // clamp at 0 internally and surface the offset on a separate row.
    var ltGain = ltGainSigned;
    var recap  = depr;  // recapture treated as ordinary

    // Wage base for Additional Medicare = W-2 + SE × 0.9235.
    var wages = Math.max(0, _num('w2-wages'));
    var seInc = Math.max(0, _num('se-income'));
    // NIIT base = LT (clamped to 0 — losses don't add to investment
    // income) + ST + investment-flavored ordinary (rental + dividend).
    var nIIT_base = Math.max(0, ltGain) + stGain
                  + Math.max(0, _num('rental-income'))
                  + Math.max(0, _num('dividend-income'));

    // Federal tax via the engine's breakdown. STG and depreciation
    // recapture both go through opts so the engine can apply special
    // treatment (recap caps at §1250 25%; STG folds into the ordinary
    // stack). Earlier this fn pre-stacked recap into 'ord', which
    // silently bypassed the §1250 cap — high-bracket clients were
    // taxed on recapture at full marginal rates up to 37%.
    var ord = ordTotal;
    var fedB = (typeof computeFederalTaxBreakdown === 'function')
      ? computeFederalTaxBreakdown(ord, year, status, {
          longTermGain: ltGain,        // signed — loss flows through to §1211(b) offset
          shortTermGain: stGain,
          depreciationRecapture: recap,
          investmentIncome: nIIT_base,
          wages: wages,
          seIncome: seInc
        })
      : null;

    var fedOrd  = fedB ? Number(fedB.ordinaryTax) || 0 : 0;
    var fedRcap = fedB ? Number(fedB.recapTax)    || 0 : 0;
    var fedLt   = fedB ? Number(fedB.ltTax)       || 0 : 0;
    var amt     = fedB ? Number(fedB.amtTopUp)    || 0 : 0;
    var seTax   = fedB ? Number(fedB.seTax)       || 0 : 0;
    var niit    = fedB ? Number(fedB.niit)        || 0 : 0;
    var addmed  = fedB ? Number(fedB.addlMedicare)|| 0 : 0;
    var lossOff = fedB ? Number(fedB.lossOrdOffsetApplied) || 0 : 0;
    var lossCFY = fedB ? Number(fedB.lossCarryforward)     || 0 : 0;

    // Federal tax for display = ordinary + recapture (capped at 25%)
    // + LT + AMT. NIIT, Additional Medicare, and SE tax are surfaced
    // on their OWN rows so "Federal Income Tax" stays a clean single
    // concept everywhere it appears. (P0-3.)
    var fedTotal = fedOrd + fedRcap + fedLt + amt;

    // State tax (passes total income; state engine handles LTCG-vs-ordinary
    // per state-specific rules). Recapture is included in the ordinary
    // base because most states do NOT honor the federal §1250 25%
    // cap — they tax recapture at full state rates. The federal split
    // happens inside computeFederalTaxBreakdown.
    var stateTax = (typeof computeStateTax === 'function')
      ? (computeStateTax(ord + recap + Math.max(0, ltGain) + stGain, year, state, status,
            { longTermGain: Math.max(0, ltGain), shortTermGain: stGain }) || 0)
      : 0;

    var total = fedTotal + niit + addmed + seTax + stateTax;

    _set('bt-ord',     _fmt(ordTotal + recap + stGain));
    _set('bt-ord-sub', _fmt(ordTotal));
    _set('bt-stg',     _fmt(stGain));
    _set('bt-ltg',     _fmt(ltGain));         // signed
    _set('bt-ltg-sub', _fmt(ltGain));
    _set('bt-recap',   _fmt(recap));
    _set('bt-loss-off', '-' + _fmt(lossOff)); // shown as negative
    _set('bt-loss-cfy', _fmt(lossCFY));
    _showRow('bt-loss-off', lossOff > 0);
    _showRow('bt-loss-cfy', lossCFY > 0);

    _set('bt-taxable', _fmt(Math.max(0, ord + Math.max(0, ltGain) + stGain - lossOff)));
    _set('bt-fed',     _fmt(fedTotal));
    _set('bt-amt',     _fmt(amt));
    _showRow('bt-amt',  amt > 0);
    _set('bt-state',   _fmt(stateTax));
    _set('bt-niit',    _fmt(niit));
    _set('bt-addmed',  _fmt(addmed));
    _set('bt-setax',   _fmt(seTax));
    _showRow('bt-setax', seTax > 0);
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
