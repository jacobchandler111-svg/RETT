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

    // Multi-property aggregation (Q1): sum across all active property blocks.
    var sumProp = (typeof window.__rettSumPropertyField === 'function')
      ? window.__rettSumPropertyField
      : function (id) { return Math.max(0, _num(id)); };
    var sale  = Math.max(0, sumProp('sale-price'));
    var basis = Math.max(0, sumProp('cost-basis'));
    var depr  = Math.max(0, sumProp('accelerated-depreciation'));
    // Q2: ST-held property gain is taxed as ordinary (added to STG bucket
    // below) and removed from the LT bucket via the formula below.
    // Separate stGainSec02 (Section 02 non-property STG) from stPropGain
    // (sale-derived ST) so the "without sale" counterfactual can correctly
    // exclude the property portion.
    var stPropGain = (typeof window.__rettShortTermPropertyGain === 'function')
      ? window.__rettShortTermPropertyGain()
      : 0;
    var stGainSec02 = Math.max(0, _num('short-term-gain'));
    var stGain = stGainSec02 + stPropGain;
    // Q7: non-property Long-Term Capital Gain (stocks, crypto, etc.).
    // Adds to the LT bucket alongside any property LT gain. Persists
    // even in the "without sale" counterfactual (it's annual income,
    // not sale-derived).
    var ltGainIncome = Math.max(0, _num('long-term-gain'));
    // Long-term gain is SIGNED — a property sale at a loss (sale < basis)
    // yields a negative number, which IRC §1211(b) lets us offset against
    // ordinary income up to $3,000 ($1,500 MFS). Previously the UI
    // clamped to 0 and silently dropped the loss. (P0-4.)
    // STG is NO LONGER subtracted from the property LT gain — it's now
    // an independent income item under "Income Sources" representing
    // ANY short-term capital gain the client recognized this year
    // (stock sales, crypto, etc.), not a slice of the property sale.
    // Q2: subtract ST-held property gain — it lives in stGain bucket.
    // Q7: add non-property LT-gain income (stocks/crypto >1yr).
    var ltGainSigned = (sale - basis - depr - stPropGain) + ltGainIncome;
    // For the displayed "Long-Term Capital Gain" row, show the signed
    // value so users see the loss explicitly. The bracket math will
    // clamp at 0 internally and surface the offset on a separate row.
    var ltGain = ltGainSigned;
    var recap  = depr;  // recapture treated as ordinary

    // Wage base for Additional Medicare = W-2 + SE × 0.9235.
    var wages = Math.max(0, _num('w2-wages'));
    var seInc = Math.max(0, _num('se-income'));
    // NIIT base = LT (clamped to 0 — losses don't add to investment
    // income) + ST + §1250 unrecaptured gain + investment-flavored
    // ordinary (rental + dividend). Per §1411, depreciation recapture
    // from a property sale IS net investment income (gain from
    // disposition of property held in a passive activity / investment),
    // so it belongs in the NIIT base. Previously omitted, which under-
    // reported NIIT on recapture-heavy scenarios — and made the Page-1
    // "did nothing" baseline disagree with the Tab-7 (engine) baseline
    // by $20K+ for a typical $500K-recap client.
    var nIIT_base = Math.max(0, ltGain) + stGain + recap
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

    // Federal tax is now SPLIT into its components for the Page-1
    // display: ordinary, §1250 recap (capped at 25%), long-term cap
    // gains, and AMT top-up — each on its own row so the CPA can audit
    // each piece independently. Total stays the same; only presentation
    // changed.
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

    _set('bt-taxable', _fmt(Math.max(0, ord + recap + Math.max(0, ltGain) + stGain - lossOff)));
    _set('bt-fed',     _fmt(fedTotal));
    // Split federal into its components. Each row is hidden when the
    // amount is zero (e.g., no recap, no LT gain, no AMT) so the table
    // stays tight for simple scenarios.
    _set('bt-fed-ord', _fmt(fedOrd));
    _showRow('bt-fed-ord', fedOrd > 0);
    _set('bt-fed-recap', _fmt(fedRcap));
    _showRow('bt-fed-recap', fedRcap > 0);
    _set('bt-fed-lt', _fmt(fedLt));
    _showRow('bt-fed-lt', fedLt > 0);
    _set('bt-amt',     _fmt(amt));
    _showRow('bt-amt',  amt > 0);
    _set('bt-state',   _fmt(stateTax));
    _set('bt-niit',    _fmt(niit));
    _set('bt-addmed',  _fmt(addmed));
    _set('bt-setax',   _fmt(seTax));
    _showRow('bt-setax', seTax > 0);
    _set('bt-tot',     _fmt(total));

    // -----------------------------------------------------------------
    // Three-block delta display (Blake spec): compute the "without sale"
    // counterfactual by zeroing sale-derived components (LT gain from
    // property sale + §1250 recapture from accelerated depreciation).
    // STG stays intact — per the form's design, #short-term-gain is
    // independent of the property sale (stock sales, crypto, etc.), so
    // removing the sale does NOT remove STG.
    // -----------------------------------------------------------------
    // "Without sale" uses only Section 02's STG (stGainSec02) — the
    // property-derived ST gain (stPropGain) doesn't exist without the sale.
    // Q7: non-property LT income (ltGainIncome) persists in the without-
    // sale scenario since it's recurring income, not sale-derived.
    var niitBase_nosale = stGainSec02 + ltGainIncome
                                      + Math.max(0, _num('rental-income'))
                                      + Math.max(0, _num('dividend-income'));
    var fedB_nosale = (typeof computeFederalTaxBreakdown === 'function')
      ? computeFederalTaxBreakdown(ord, year, status, {
          longTermGain: ltGainIncome,
          shortTermGain: stGainSec02,
          depreciationRecapture: 0,
          investmentIncome: niitBase_nosale,
          wages: wages,
          seIncome: seInc
        })
      : null;
    var fedOrd_nosale  = fedB_nosale ? Number(fedB_nosale.ordinaryTax) || 0 : 0;
    var fedLt_nosale   = fedB_nosale ? Number(fedB_nosale.ltTax)       || 0 : 0;
    var amt_nosale     = fedB_nosale ? Number(fedB_nosale.amtTopUp)    || 0 : 0;
    var seTax_nosale   = fedB_nosale ? Number(fedB_nosale.seTax)       || 0 : 0;
    var niit_nosale    = fedB_nosale ? Number(fedB_nosale.niit)        || 0 : 0;
    var addmed_nosale  = fedB_nosale ? Number(fedB_nosale.addlMedicare)|| 0 : 0;
    var fedTotal_nosale = fedOrd_nosale + fedLt_nosale + amt_nosale; // no recap without sale
    var stateTax_nosale = (typeof computeStateTax === 'function')
      ? (computeStateTax(ord + stGainSec02 + ltGainIncome, year, state, status,
            { longTermGain: ltGainIncome, shortTermGain: stGainSec02 }) || 0)
      : 0;
    var total_nosale = fedTotal_nosale + niit_nosale + addmed_nosale + seTax_nosale + stateTax_nosale;

    // Delta components (with-sale minus without-sale).
    var delta_total    = total - total_nosale;
    var delta_fedRecap = fedRcap;                       // recap is 100% sale-driven
    var delta_fedLt    = fedLt - fedLt_nosale;
    var delta_niit     = niit - niit_nosale;
    var delta_state    = stateTax - stateTax_nosale;
    var delta_amt      = amt - amt_nosale;
    var delta_fedOrd   = fedOrd - fedOrd_nosale;        // §1211 offset can shift this

    // Three-tile display.
    _set('bt-without',  _fmt(total_nosale));
    _set('bt-delta',    _fmt(delta_total));
    _set('bt-total',    _fmt(total));
    _set('baseline-year-sub', 'Year ' + year);

    // Without-sale subline: federal + state.
    _set('bt-without-sub',
         'Federal ' + _fmt(fedTotal_nosale + niit_nosale + addmed_nosale + seTax_nosale)
         + ' · State ' + _fmt(stateTax_nosale));

    // Delta subline: only show components that materially shift. Order:
    // recap → LT → NIIT → state. Each rendered as "label $amount".
    var deltaParts = [];
    if (Math.abs(delta_fedRecap) > 0.5) deltaParts.push('Recap ' + _fmt(delta_fedRecap));
    if (Math.abs(delta_fedLt)    > 0.5) deltaParts.push('LT ' + _fmt(delta_fedLt));
    if (Math.abs(delta_niit)     > 0.5) deltaParts.push('NIIT ' + _fmt(delta_niit));
    if (Math.abs(delta_state)    > 0.5) deltaParts.push('State ' + _fmt(delta_state));
    if (Math.abs(delta_amt)      > 0.5) deltaParts.push('AMT ' + _fmt(delta_amt));
    if (Math.abs(delta_fedOrd)   > 0.5) deltaParts.push('Ord ' + _fmt(delta_fedOrd));
    _set('bt-delta-sub', deltaParts.length ? deltaParts.join(' · ') : 'No sale entered');

    // Pie chart: share of sale price kept (blue) vs paid in tax (red).
    // Per advisor 2026-05-26 - denominator is salePrice so the chart
    // tells the client "you keep X% of your sale; Y% goes to tax."
    _renderPieChart(sale, delta_total);

    // -----------------------------------------------------------------
    // Q3: Per-property tax breakdown (double-click middle tile reveals).
    // For each active property, compute its marginal tax contribution =
    // total_with_all - total_with_all_except_this_one. Sum of marginals
    // is approximate due to bracket-stack effects but close enough for
    // the advisor's "where is the tax coming from" question.
    // -----------------------------------------------------------------
    var hostEl = document.getElementById('baseline-breakdown-list');
    if (hostEl) {
      var activeProps = [];
      if (typeof window.__rettPropertyIsActive === 'function') {
        for (var pn = 1; pn <= 5; pn++) {
          if (window.__rettPropertyIsActive(pn)) activeProps.push(pn);
        }
      }
      // Hide the breakdown panel entirely when there's only one property
      // — single-sale users don't need a per-property split.
      var panel = document.getElementById('baseline-breakdown-panel');
      var middleTile = document.querySelector('.baseline-tile--delta');
      if (activeProps.length >= 2) {
        if (middleTile) middleTile.classList.add('baseline-tile--has-breakdown');
        // Compute per-property contribution.
        var perProperty = activeProps.map(function (pn) {
          function _propVal(base) {
            var id = (pn === 1) ? base : (base + '-' + pn);
            var el = document.getElementById(id);
            return el ? (parseUSD(el.value) || 0) : 0;
          }
          var pSale  = _propVal('sale-price');
          var pBasis = _propVal('cost-basis');
          var pDepr  = _propVal('accelerated-depreciation');
          var hpEl   = document.getElementById('holding-period-' + pn);
          var pIsST  = (hpEl && hpEl.value === 'no');
          var pGain  = Math.max(0, pSale - pBasis - pDepr);

          // Aggregates with this property REMOVED.
          var saleX  = Math.max(0, sale  - pSale);
          var basisX = Math.max(0, basis - pBasis);
          var deprX  = Math.max(0, depr  - pDepr);
          var stPropX = Math.max(0, stPropGain - (pIsST ? pGain : 0));
          var stGainX = Math.max(0, _num('short-term-gain')) + stPropX;
          // Q7: ltGainIncome (non-property LT income) is recurring annual
          // income — it persists whether or not THIS property exists, so
          // add it to the LT bucket in the "without property N" scenario.
          var ltGainX = Math.max(0, saleX - basisX - deprX - stPropX) + ltGainIncome;
          var niitBaseX = ltGainX + stGainX + deprX
                        + Math.max(0, _num('rental-income'))
                        + Math.max(0, _num('dividend-income'));
          var fedX = (typeof computeFederalTaxBreakdown === 'function')
            ? computeFederalTaxBreakdown(ord, year, status, {
                longTermGain: ltGainX,
                shortTermGain: stGainX,
                depreciationRecapture: deprX,
                investmentIncome: niitBaseX,
                wages: wages,
                seIncome: seInc
              })
            : null;
          var fedTotX = fedX
            ? (Number(fedX.ordinaryTax) || 0) + (Number(fedX.recapTax) || 0)
              + (Number(fedX.ltTax) || 0) + (Number(fedX.amtTopUp) || 0)
            : 0;
          var stateX = (typeof computeStateTax === 'function')
            ? (computeStateTax(ord + deprX + ltGainX + stGainX, year, state, status,
                  { longTermGain: ltGainX, shortTermGain: stGainX }) || 0)
            : 0;
          var niitX = fedX ? Number(fedX.niit) || 0 : 0;
          var addmedX = fedX ? Number(fedX.addlMedicare) || 0 : 0;
          var seTaxX = fedX ? Number(fedX.seTax) || 0 : 0;
          var totalX = fedTotX + niitX + addmedX + seTaxX + stateX;
          var contribution = Math.max(0, total - totalX);
          return { n: pn, contribution: contribution, isST: pIsST };
        });
        // Render the breakdown rows.
        var rowsHtml = perProperty.map(function (p) {
          var label = 'Property ' + p.n + (p.isST ? ' (short-term)' : '');
          return '<div class="baseline-breakdown-row">' +
                   '<span class="baseline-breakdown-label">' + label + '</span>' +
                   '<span class="baseline-breakdown-amt">' + _fmt(p.contribution) + '</span>' +
                 '</div>';
        }).join('');
        hostEl.innerHTML = rowsHtml;
      } else {
        if (middleTile) middleTile.classList.remove('baseline-tile--has-breakdown');
        if (panel) panel.hidden = true;
        hostEl.innerHTML = '';
      }
    }
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

  // Pie chart renderer (advisor 2026-05-26). Two-slice pie:
  //   blue (keep) = (salePrice − taxDueFromSale) / salePrice
  //   red  (tax)  = taxDueFromSale / salePrice
  // Drawn as SVG arcs into #bt-pie-slices. Center text shows the
  // keep percent (the optimistic number). Legend amounts + percents
  // populated alongside.
  function _renderPieChart(salePrice, taxDueFromSale) {
    var slicesEl = document.getElementById('bt-pie-slices');
    if (!slicesEl) return;
    var sp = Math.max(0, Number(salePrice) || 0);
    var tax = Math.max(0, Number(taxDueFromSale) || 0);
    // Clip tax at sale so the pie can't exceed 100%.
    var taxBounded = Math.min(tax, sp);
    var keep = Math.max(0, sp - taxBounded);
    var keepPct = sp > 0 ? (keep / sp) : 0;
    var taxPct  = sp > 0 ? (taxBounded / sp) : 0;

    // SVG geometry: 200x200 viewBox, donut centered at (100, 100),
    // outer radius 88, inner radius 56 (matches the existing ribbon
    // donut style). Slices drawn clockwise starting at 12 o'clock.
    var cx = 100, cy = 100, R = 88, r = 56;
    function _arc(startA, sweepA, fillCss) {
      if (sweepA <= 0.0001) return '';
      // Full-circle short-circuit (single slice covering 100%): draw
      // two half-arcs to avoid the degenerate "zero-length arc" SVG
      // rendering issue.
      if (sweepA >= Math.PI * 2 - 0.0001) {
        return '<circle cx="' + cx + '" cy="' + cy + '" r="' + R + '" fill="' + fillCss + '"/>' +
               '<circle cx="' + cx + '" cy="' + cy + '" r="' + r + '" fill="#fff"/>';
      }
      var endA = startA + sweepA;
      var x1 = cx + R * Math.cos(startA);
      var y1 = cy + R * Math.sin(startA);
      var x2 = cx + R * Math.cos(endA);
      var y2 = cy + R * Math.sin(endA);
      var xi1 = cx + r * Math.cos(endA);
      var yi1 = cy + r * Math.sin(endA);
      var xi2 = cx + r * Math.cos(startA);
      var yi2 = cy + r * Math.sin(startA);
      var large = sweepA > Math.PI ? 1 : 0;
      var d = 'M ' + x1 + ' ' + y1 +
              ' A ' + R + ' ' + R + ' 0 ' + large + ' 1 ' + x2 + ' ' + y2 +
              ' L ' + xi1 + ' ' + yi1 +
              ' A ' + r + ' ' + r + ' 0 ' + large + ' 0 ' + xi2 + ' ' + yi2 +
              ' Z';
      return '<path d="' + d + '" fill="' + fillCss + '"/>';
    }

    // Start at 12 o'clock = -90 deg = -π/2 radians.
    var start = -Math.PI / 2;
    var keepSweep = keepPct * Math.PI * 2;
    var taxSweep  = taxPct * Math.PI * 2;
    var svg = '';
    svg += _arc(start, keepSweep, '#2563eb');                  // blue (keep)
    svg += _arc(start + keepSweep, taxSweep, '#dc2626');       // red (tax)
    slicesEl.innerHTML = svg;

    var centerEl = document.getElementById('bt-pie-center');
    if (centerEl) {
      centerEl.textContent = sp > 0 ? (keepPct * 100).toFixed(1) + '%' : '—';
    }
    _set('bt-pie-keep-amt', _fmt(keep));
    _set('bt-pie-keep-pct', (keepPct * 100).toFixed(1) + '%');
    _set('bt-pie-tax-amt', _fmt(taxBounded));
    _set('bt-pie-tax-pct', (taxPct * 100).toFixed(1) + '%');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _attach);
  } else {
    _attach();
  }

  root.renderBaselineTable = render;
})(window);
