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
    // Canonical Y0 snapshot from the engine (handles all the new
    // income fields: interest, qualified-div, §86 SS, business +
    // SE-tax routing). Falls back to direct DOM reads when the
    // engine helper isn't loaded yet (boot timing race).
    var snap = (typeof window.rettY0BaselineSnapshot === 'function')
      ? window.rettY0BaselineSnapshot() : null;
    var year   = snap ? snap.year   : (parseInt(_val('year1'), 10) || (new Date()).getFullYear());
    var status = snap ? snap.status : (_val('filing-status') || 'mfj');
    var state  = snap ? snap.state  : (_val('state-code') || 'NONE');

    // Year tag in the section heading
    _set('baseline-year-tag', year + ' PROJECTION');

    // Property-sale-derived gains (kept separate for the visible
    // breakdown rows). Multi-property aggregation honored.
    var sumProp = (typeof window.__rettSumPropertyField === 'function')
      ? window.__rettSumPropertyField
      : function (id) { return Math.max(0, _num(id)); };
    var sale  = Math.max(0, sumProp('sale-price'));
    var basis = Math.max(0, sumProp('cost-basis'));
    var depr  = Math.max(0, sumProp('accelerated-depreciation'));
    var stPropGain = (typeof window.__rettShortTermPropertyGain === 'function')
      ? window.__rettShortTermPropertyGain()
      : 0;

    var ordTotal, stGain, ltGain, qualDiv, wages, seInc, nIIT_base, recap;
    if (snap) {
      // Use the engine snapshot. Pulls in §86 taxable SS (already in
      // scenario.ordinaryIncome), business-income (in baseOrdinaryIncome
      // upstream), interest (in baseOrdinaryIncome + investmentIncome),
      // qualified-div (separate field for LTCG bracket routing), SE
      // (wages stays W-2 only; engine folds SE × 0.9235 internally).
      ordTotal = snap.ordTotal;
      stGain   = snap.stGain;
      ltGain   = snap.ltGain;
      qualDiv  = snap.qualifiedDividend;
      wages    = snap.wages;
      seInc    = snap.seInc;
      nIIT_base = snap.niitBase;
      recap    = snap.recap;
    } else {
      // Legacy direct-DOM fallback. Mirrors the prior behavior for
      // safety - missing the new income fields but never crashes.
      var ordSourcesPos    = ['w2-wages', 'dividend-income',
                              'retirement-distributions', 'interest-income',
                              'business-income-amount'];
      var ordSourcesSigned = ['rental-income'];
      ordTotal = 0;
      ordSourcesPos.forEach(function (id)    { ordTotal += Math.max(0, _num(id)); });
      ordSourcesSigned.forEach(function (id) { ordTotal += _num(id); });
      stGain = Math.max(0, _num('short-term-gain')) + stPropGain;
      var ltGainIncome = Math.max(0, _num('long-term-gain'));
      ltGain = (sale - basis - depr - stPropGain) + ltGainIncome;
      qualDiv = Math.max(0, _num('qualified-dividends'));
      wages = Math.max(0, _num('w2-wages'));
      // Fallback derives SE from business-income radio if available.
      var biRad = document.querySelector('input[name="business-income-type"]:checked');
      var biType = biRad ? biRad.value : null;
      seInc = (biType === 'se' || biType === 'k1-partnership-gp')
        ? Math.max(0, _num('business-income-amount')) : 0;
      recap = depr;
      nIIT_base = Math.max(0, ltGain) + stGain + recap + qualDiv
                + Math.max(0, _num('rental-income'))
                + Math.max(0, _num('dividend-income'))
                + Math.max(0, _num('interest-income'));
    }

    // Federal tax via the engine's breakdown. STG and depreciation
    // recapture both go through opts so the engine can apply special
    // treatment (recap caps at §1250 25%; STG folds into the ordinary
    // stack).
    var ord = ordTotal;
    var fedB = (typeof computeFederalTaxBreakdown === 'function')
      ? computeFederalTaxBreakdown(ord, year, status, {
          longTermGain: ltGain,
          shortTermGain: stGain,
          depreciationRecapture: recap,
          qualifiedDividend: qualDiv,
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
    // Re-derived from form (snapshot only carries the with-sale totals).
    // NOT clamped to >=0: a Section 02 short-term capital LOSS is
    // independent of the property sale, so the no-sale baseline must
    // still honor it — net it against any LT income, then take the
    // §1211(b) $3K ordinary offset on the remainder. Mirrors the
    // with-sale path, which passes the signed STG through unclamped.
    var stGainSec02 = _num('short-term-gain');
    // Not clamped to >=0: a non-property long-term capital LOSS is also
    // independent of the sale and must flow through the no-sale baseline
    // (nets against any LT income, then §1211(b) $3K ordinary offset),
    // same as the short-term field. The federal breakdown + the capped
    // state base below handle the netting.
    var ltGainIncome = _num('long-term-gain');
    // NIIT base sans-sale = recurring portfolio income only (interest +
    // ord div + qualified div + rental + recurring LT/ST). No property
    // gain, no recapture. Mirrors what the engine would set if cfg had
    // sale=basis (zero gain).
    var niitBase_nosale = stGainSec02 + ltGainIncome + qualDiv
                        + Math.max(0, _num('rental-income'))
                        + Math.max(0, _num('dividend-income'))
                        + Math.max(0, _num('interest-income'));
    var fedB_nosale = (typeof computeFederalTaxBreakdown === 'function')
      ? computeFederalTaxBreakdown(ord, year, status, {
          longTermGain: ltGainIncome,
          shortTermGain: stGainSec02,
          depreciationRecapture: 0,
          qualifiedDividend: qualDiv,
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
    // State base must mirror federal AGI. GA and most states start from
    // federal AGI, which already §1211-caps a net capital loss at
    // $3K/$1.5K before it reduces ordinary income. So the state base
    // uses the breakdown's POST-netting gains (>=0) and subtracts only
    // the CAPPED loss offset — NOT the raw signed loss. Folding the raw
    // -$100K loss here would deduct the full $100K from state income
    // instead of $3K. Post-netting values come straight from
    // computeFederalTaxBreakdown (exposed for exactly this purpose).
    var _ns_netLt   = fedB_nosale ? (Number(fedB_nosale.netLongTermGain)  || 0) : Math.max(0, ltGainIncome);
    var _ns_netSt   = fedB_nosale ? (Number(fedB_nosale.netShortTermGain) || 0) : Math.max(0, stGainSec02);
    var _ns_lossOff = fedB_nosale ? (Number(fedB_nosale.lossOrdOffsetApplied) || 0) : 0;
    var _ns_stateBase = ord + _ns_netSt + _ns_netLt - _ns_lossOff;
    var stateTax_nosale = (typeof computeStateTax === 'function')
      ? (computeStateTax(_ns_stateBase, year, state, status,
            { longTermGain: _ns_netLt, shortTermGain: _ns_netSt }) || 0)
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

    // 2026-05-27: middle "Cash Kept from Sale" tile = salePrice − tax.
    // Donut denominator switched from salePrice to GAIN (sale − basis)
    // so the % LOST in the donut center answers "how much of your
    // economic gain is going to tax?"
    var cashKept = Math.max(0, sale - delta_total);
    _set('bt-cash-kept', _fmt(cashKept));
    var gainEconomic = Math.max(0, sale - basis);
    _renderPieChart(gainEconomic, delta_total);

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
          var niitBaseX = ltGainX + stGainX + deprX + qualDiv
                        + Math.max(0, _num('rental-income'))
                        + Math.max(0, _num('dividend-income'))
                        + Math.max(0, _num('interest-income'));
          var fedX = (typeof computeFederalTaxBreakdown === 'function')
            ? computeFederalTaxBreakdown(ord, year, status, {
                longTermGain: ltGainX,
                shortTermGain: stGainX,
                depreciationRecapture: deprX,
                qualifiedDividend: qualDiv,
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
    // Re-render whenever ANY form input changes. A delegated,
    // document-level listener (rather than a hand-maintained field
    // list) guarantees newly-added income/gain fields can never go
    // stale — every value flows through collectInputs() on the next
    // render. Debounced; the render reads the live form and is cheap +
    // idempotent.
    //
    // (Fixed 2026-05-28: the old explicit `ids` list omitted
    // interest-income, social-security, business-income-amount, and
    // long-term-gain, so typing into them left the "Total Tax If You
    // Did Nothing" panel — including the NIIT row — showing stale
    // numbers even though the engine had them wired correctly.)
    document.addEventListener('input',  debounced, true);
    document.addEventListener('change', debounced, true);
    // Initial paint.
    render();
  }

  // Donut renderer (advisor 2026-05-27). Denominator = GAIN
  // (sale − basis). Two slices: blue Gain Kept, red Gain Lost.
  // Leader lines attach to each slice and carry "Title · $amount ·
  // pct%" on the outside (pattern mirrors projection-dashboard donut).
  // Center text = % LOST in red. When tax > gain (recap-heavy
  // scenarios) the slice clips at 100% red and the leader carries the
  // true uncapped dollar + percent.
  function _renderPieChart(gain, taxDueFromSale) {
    var slicesEl = document.getElementById('bt-pie-slices');
    var leadersEl = document.getElementById('bt-pie-leaders');
    if (!slicesEl) return;
    var g = Math.max(0, Number(gain) || 0);
    var tax = Math.max(0, Number(taxDueFromSale) || 0);
    var taxBounded = Math.min(tax, g);
    var keep = Math.max(0, g - taxBounded);
    var keepPct = g > 0 ? (keep / g) : 0;
    var taxPct  = g > 0 ? (taxBounded / g) : 0;
    // Real (uncapped) percents for the labels — what the advisor wants
    // to see even when tax > gain.
    var keepPctReal = g > 0 ? (keep / g) : 0;
    var lostPctReal = g > 0 ? (tax / g) : 0;

    // viewBox: -160 -10 520 240. Donut center (110, 110).
    // Thicker ring per advisor 2026-05-27: R 92, r 50 (was 80 / 55).
    var cx = 110, cy = 110, R = 92, r = 50;
    function _arc(startA, sweepA, fillCss) {
      if (sweepA <= 0.0001) return '';
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

    var start = -Math.PI / 2;
    var keepSweep = keepPct * Math.PI * 2;
    var taxSweep  = taxPct * Math.PI * 2;
    var svg = '';
    svg += _arc(start, keepSweep, '#2563eb');             // blue (kept)
    svg += _arc(start + keepSweep, taxSweep, '#dc2626');  // red (lost)
    slicesEl.innerHTML = svg;

    // Leader lines + labels (SVG). Title on top line, dollar amount
    // on the line below. No percent on the outside — the center number
    // is the only percent shown. Skip sliver slices (<6°).
    function _leader(midA, fillCss, title, dollarStr) {
      var p1x = cx + R * Math.cos(midA);
      var p1y = cy + R * Math.sin(midA);
      var p2x = cx + (R + 18) * Math.cos(midA);
      var p2y = cy + (R + 18) * Math.sin(midA);
      var rightSide = Math.cos(midA) >= 0;
      var p3x = rightSide ? (p2x + 28) : (p2x - 28);
      var p3y = p2y;
      var anchor = rightSide ? 'start' : 'end';
      var tx = rightSide ? (p3x + 6) : (p3x - 6);
      return '<polyline class="bt-pie-leader" points="' +
               p1x.toFixed(2) + ',' + p1y.toFixed(2) + ' ' +
               p2x.toFixed(2) + ',' + p2y.toFixed(2) + ' ' +
               p3x.toFixed(2) + ',' + p3y.toFixed(2) +
             '" stroke="' + fillCss + '"/>' +
             '<text class="bt-pie-leader-title" x="' + tx.toFixed(2) +
               '" y="' + (p3y - 6).toFixed(2) + '" text-anchor="' + anchor +
               '" fill="' + fillCss + '">' + title + '</text>' +
             '<text class="bt-pie-leader-amt" x="' + tx.toFixed(2) +
               '" y="' + (p3y + 13).toFixed(2) + '" text-anchor="' + anchor + '">' +
               dollarStr + '</text>';
    }
    var leaders = '';
    if (g > 0) {
      if (keepSweep > 0.10) {
        var keepMid = start + keepSweep / 2;
        leaders += _leader(keepMid, '#2563eb', 'Gain Kept', _fmt(keep));
      }
      if (taxSweep > 0.10) {
        var lostMid = start + keepSweep + taxSweep / 2;
        leaders += _leader(lostMid, '#b91c1c', 'Gain Lost', _fmt(tax));
      }
    }
    if (leadersEl) leadersEl.innerHTML = leaders;

    var centerEl = document.getElementById('bt-pie-center');
    if (centerEl) {
      centerEl.textContent = g > 0 ? (lostPctReal * 100).toFixed(1) + '%' : '—';
    }
    // Legacy hidden-span writes (back-compat).
    _set('bt-pie-keep-amt', _fmt(keep));
    _set('bt-pie-keep-pct', (keepPct * 100).toFixed(1) + '%');
    _set('bt-pie-tax-amt', _fmt(tax));
    _set('bt-pie-tax-pct', (taxPct * 100).toFixed(1) + '%');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _attach);
  } else {
    _attach();
  }

  root.renderBaselineTable = render;
})(window);
