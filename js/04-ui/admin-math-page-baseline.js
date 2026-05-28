// js/04-ui/admin-math-page-baseline.js
//
// Admin math reveal panel - Tab 2 (Tax Implications / Baseline).
//
// Surfaces the side-by-side baseline computation behind the three
// tiles "Without the Sale" / "Tax Due from the Sale" / "Total Tax".
// For each side (without-sale, with-sale) we call the same engine
// functions the tax-comparison module uses (computeFederalTaxBreakdown
// + computeStateTax) so what's shown is identical to what the rest
// of the engine reads, then list each bucket (ordinary, LT, NIIT,
// Add'l Medicare, AMT top-up, state) with its contribution.
(function (root) {
  'use strict';
  if (typeof root._registerPageMath !== 'function') return;

  function _esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  function _fmtUSD(n) {
    if (typeof root._fmt === 'function') return root._fmt(n);
    var v = Number(n);
    if (!isFinite(v)) return String(n);
    var sign = v < 0 ? '-' : '';
    return sign + '$' + Math.round(Math.abs(v)).toLocaleString('en-US');
  }
  function _num(v) { var n = Number(v); return isFinite(n) ? n : 0; }
  function _domNum(id) {
    var el = document.getElementById(id);
    if (!el) return 0;
    var raw = el.value;
    if (raw == null || raw === '') return 0;
    if (typeof root.parseUSD === 'function') return _num(root.parseUSD(raw));
    return _num(String(raw).replace(/[$,\s]/g, ''));
  }

  // Build a tax-engine call for a given LT/recap pair. Mirrors
  // baseline-table.js render() exactly so the panel numbers match
  // the tile values to the dollar. Diverges from the simpler
  // tax-comparison _yearTaxes path because the Page-2 tile uses
  // the richer Page-1 DOM (rental + dividend in NIIT base, wages
  // + seIncome split, fedRecap as its own column).
  function _runScenario(cfg, longTermGain, recapture, opts) {
    opts = opts || {};
    var year = cfg.year1 || (new Date()).getFullYear();
    var status = cfg.filingStatus || 'mfj';
    var state = cfg.state || 'NONE';
    var ord = _num(cfg.baseOrdinaryIncome);
    var stGainSec02 = _num(cfg.baseShortTermGain);
    var stPropGain = _num(cfg.shortTermPropertyGain);
    // With-sale: include the property ST gain (sale-derived).
    // Without-sale: exclude it (only Section 02 STG persists).
    var stGain = opts.withSale ? (stGainSec02 + stPropGain) : stGainSec02;
    var ltAnnual = _num(cfg.baseLongTermGain);
    // Property LT for THIS scenario plus the recurring annual LT income.
    var ltSigned = _num(longTermGain) + ltAnnual;
    var recap = _num(recapture);
    var wages = _num(cfg.wages);
    var seInc = _domNum('se-income');
    // §86 taxable Social Security. cfg.baseOrdinaryIncome does NOT
    // include SS — the engine derives the taxable portion inside
    // _baseScenarioForYear and folds it into scenario.ordinaryIncome.
    // Mirror that here so the admin panel matches the client tile to the
    // dollar. Provisional income includes capital gains, so high earners
    // pin at the 85% cap. Taxed at ordinary rates only (excluded from
    // NIIT and Add'l Medicare); flows into the state base via ord, same
    // as the engine. Computed per-scenario: without-sale passes 0 LT/
    // recap, so its provisional (and thus taxable portion) can differ.
    var grossSS = _num(cfg.socialSecurityBenefits);
    var ssFn = root._computeTaxableSocialSecurity ||
               (typeof _computeTaxableSocialSecurity === 'function' ? _computeTaxableSocialSecurity : null);
    var taxableSS = 0;
    if (grossSS > 0 && ssFn) {
      var provOther = ord + _num(cfg.qualifiedDividend) + stGain
                    + Math.max(0, ltSigned) + recap;
      taxableSS = ssFn(grossSS, provOther, 0, status);
    }
    ord += taxableSS;
    // NIIT base = LT (clamped to 0) + STG + recap + rental + dividend +
    // interest. Recap belongs because §1411 treats §1250 gain as net
    // investment income from disposition of property. Interest
    // (§1411(c)(1)(A)(i)) was previously OMITTED here, so the admin
    // baseline NIIT row didn't move when interest income changed —
    // mismatching the engine, which has always counted it. (Fixed
    // 2026-05-28; matches inputs-collector _ordinaryInvestmentIncome.)
    var nIIT_base = Math.max(0, ltSigned) + stGain + recap
                  + _domNum('rental-income') + _domNum('dividend-income')
                  + _domNum('interest-income');
    var fed = root.computeFederalTaxBreakdown(ord, year, status, {
      longTermGain: ltSigned,
      shortTermGain: stGain,
      depreciationRecapture: recap,
      investmentIncome: nIIT_base,
      wages: wages,
      seIncome: seInc
    });
    // State base mirrors federal AGI. With-sale: ord + recap + max(0,LT)
    // + STG (a capital loss is absorbed by the sale gain). Without-sale:
    // a net capital loss must be §1211-capped at $3K/$1.5K before it
    // reduces ordinary income — GA and most states start from federal
    // AGI, which is already capped. Use the breakdown's POST-netting
    // gains and capped loss offset, NOT the raw signed loss (which would
    // deduct the full loss against state ordinary income). Mirrors
    // baseline-table.js render().
    var nsNetLt = _num(fed.netLongTermGain);
    var nsNetSt = _num(fed.netShortTermGain);
    var nsLossOff = _num(fed.lossOrdOffsetApplied);
    var stateBase = opts.withSale
      ? (ord + recap + Math.max(0, ltSigned) + stGain)
      : (ord + nsNetSt + nsNetLt - nsLossOff);
    var stateTax = root.computeStateTax(stateBase, year, state, status, {
      longTermGain: opts.withSale ? Math.max(0, ltSigned) : nsNetLt,
      shortTermGain: opts.withSale ? stGain : nsNetSt
    }) || 0;
    // fedTotal mirrors baseline-table.js: ordinaryTax + recapTax +
    // ltTax + amtTopUp. NIIT, Add'l Medicare, SE tax stack on top.
    var fedOrd  = _num(fed.ordinaryTax);
    var fedRcap = _num(fed.recapTax);
    var fedLt   = _num(fed.ltTax);
    var amt     = _num(fed.amtTopUp);
    var tmt     = _num(fed.tentativeMinimumTax);
    var regFed  = _num(fed.regularFederalTax);
    var niit    = _num(fed.niit);
    var addmed  = _num(fed.addlMedicare);
    var seTax   = _num(fed.seTax);
    var fedTotal = fedOrd + fedRcap + fedLt + amt;
    var sum = fedTotal + niit + addmed + seTax + stateTax;
    return {
      fed: fed, state: stateTax, sum: sum,
      buckets: { fedOrd: fedOrd, fedRcap: fedRcap, fedLt: fedLt,
                 amt: amt, tmt: tmt, regFed: regFed,
                 niit: niit, addmed: addmed, seTax: seTax }
    };
  }

  function _bucketRow(label, value, formula) {
    return '<tr>' +
      '<td>' + _esc(label) + '</td>' +
      '<td class="admin-math-num">' + _fmtUSD(value) + '</td>' +
      '<td class="admin-math-note-cell">' + (formula || '') + '</td>' +
    '</tr>';
  }

  function _scenarioTable(title, scen) {
    var b = scen.buckets || {};
    var fedTotal = b.fedOrd + b.fedRcap + b.fedLt + b.amt;
    var total = scen.sum;
    return '<div class="admin-math-section">' +
      '<h4>' + _esc(title) + '</h4>' +
      '<table class="admin-math-table">' +
        '<thead><tr><th>Bucket</th><th class="admin-math-num">Amount</th><th>Source</th></tr></thead>' +
        '<tbody>' +
          _bucketRow('Federal ordinary tax',       b.fedOrd,  '2026 bracket stack on baseOrdinaryIncome + §86 taxable SS + STG (after §1211(b) loss offset)') +
          _bucketRow('Federal §1250 recap tax',    b.fedRcap, 'Capped at 25% per §1(h)(1)(E); 0 in without-sale') +
          _bucketRow('Federal LT cap gain tax',    b.fedLt,   '0% / 15% / 20% stack on max(0, longTermGain)') +
          '<tr class="admin-math-amt-detail"><td><em>&nbsp;&nbsp;Regular federal tax</em></td><td class="admin-math-num"><em>' + _fmtUSD(b.regFed) + '</em></td><td>= ordinary + recap + LT (used as the AMT comparison base)</td></tr>' +
          '<tr class="admin-math-amt-detail"><td><em>&nbsp;&nbsp;Tentative Minimum Tax (TMT)</em></td><td class="admin-math-num"><em>' + _fmtUSD(b.tmt) + '</em></td><td>§55(b) AMT on (ordinary + std-ded add-back) at 26/28% + LT layered at preferential rate</td></tr>' +
          _bucketRow('AMT top-up',                 b.amt,     '= max(0, TMT &minus; Regular federal) = max(0, ' + _fmtUSD(b.tmt) + ' &minus; ' + _fmtUSD(b.regFed) + ')') +
          '<tr class="admin-math-subtotal"><td><strong>Federal subtotal</strong></td><td class="admin-math-num"><strong>' + _fmtUSD(fedTotal) + '</strong></td><td>fedOrd + fedRcap + fedLt + amt</td></tr>' +
          _bucketRow('NIIT (3.8%)',                b.niit,    '§1411 on LT + STG + recap + rental + dividend + interest above MAGI threshold') +
          _bucketRow('Add\'l Medicare (0.9%)',     b.addmed,  '§3101(b)(2) on wages + SE&times;0.9235 above threshold') +
          _bucketRow('SE tax',                     b.seTax,   'Self-employment FICA portion (Form SE)') +
          _bucketRow('State tax',                  scen.state, 'computeStateTax(' + _esc(scen._stateCode || '') + ', ' + _esc(scen._year || '') + ')') +
          '<tr class="admin-math-total"><td><strong>TOTAL</strong></td><td class="admin-math-num"><strong>' + _fmtUSD(total) + '</strong></td><td></td></tr>' +
        '</tbody>' +
      '</table>' +
    '</div>';
  }

  function _renderBaseline() {
    if (typeof root.collectInputs !== 'function' ||
        typeof root.computeFederalTaxBreakdown !== 'function' ||
        typeof root.computeStateTax !== 'function') {
      return '<p class="admin-math-error">Tax engine functions not yet loaded (collectInputs / computeFederalTaxBreakdown / computeStateTax).</p>';
    }
    var cfg;
    try { cfg = root.collectInputs(); }
    catch (e) {
      return '<p class="admin-math-error">collectInputs() threw: ' + _esc(e.message || e) + '</p>';
    }

    var sp = _num(cfg.salePrice), cb = _num(cfg.costBasis), ad = _num(cfg.acceleratedDepreciation);
    var stpg = _num(cfg.shortTermPropertyGain);
    var ltGain = Math.max(0, sp - cb - ad - stpg);
    var recap = Math.max(0, ad);

    var without = _runScenario(cfg, 0, 0, { withSale: false });
    var withSale = _runScenario(cfg, ltGain, recap, { withSale: true });
    without._stateCode = withSale._stateCode = cfg.state || 'NONE';
    without._year = withSale._year = cfg.year1;
    var delta = withSale.sum - without.sum;

    // Per-source income breakdown so the advisor can see exactly which
    // form fields rolled into baseOrdinaryIncome / wages /
    // investmentIncomeOrdinary. Tab 1's admin had this; Tab 2 was just
    // showing the aggregate which made it look like individual fields
    // weren't being taxed (they were — just lumped into the totals).
    function _dom(id){ return _domNum(id); }
    var rW2     = _dom('w2-wages');
    var rInt    = _dom('interest-income');
    var rDiv    = _dom('dividend-income');
    var rRet    = _dom('retirement-distributions');
    var rSSGr   = _dom('social-security');
    var rRent   = _dom('rental-income');
    var rBiz    = _dom('business-income-amount');
    var niitBase = _num(cfg.investmentIncomeOrdinary);

    var incomeBreakdown =
      '<div class="admin-math-section">' +
        '<h4>Income Sources (each field → cfg routing)</h4>' +
        '<table class="admin-math-table">' +
          '<thead><tr><th>Field</th><th class="admin-math-num">Amount</th><th>Routes to</th></tr></thead>' +
          '<tbody>' +
            '<tr><td>W-2 Wages</td><td class="admin-math-num">' + _fmtUSD(rW2) + '</td><td>baseOrdinaryIncome + wages (Add\'l Medicare)</td></tr>' +
            '<tr><td>Interest Income</td><td class="admin-math-num">' + _fmtUSD(rInt) + '</td><td>baseOrdinaryIncome + investmentIncomeOrdinary (NIIT)</td></tr>' +
            '<tr><td>Dividends</td><td class="admin-math-num">' + _fmtUSD(rDiv) + '</td><td>baseOrdinaryIncome + investmentIncomeOrdinary (NIIT)</td></tr>' +
            '<tr><td>Retirement Distributions</td><td class="admin-math-num">' + _fmtUSD(rRet) + '</td><td>baseOrdinaryIncome only (§1411(c)(5) excludes from NIIT)</td></tr>' +
            '<tr><td>Social Security (gross)</td><td class="admin-math-num">' + _fmtUSD(rSSGr) + '</td><td>§86 worksheet → taxable portion into ordinary income (not NIIT, not Add\'l Medicare)</td></tr>' +
            '<tr><td>Rental Income</td><td class="admin-math-num">' + _fmtUSD(rRent) + '</td><td>baseOrdinaryIncome + investmentIncomeOrdinary (NIIT)</td></tr>' +
            '<tr><td>Business Income</td><td class="admin-math-num">' + _fmtUSD(rBiz) + '</td><td>baseOrdinaryIncome only</td></tr>' +
          '</tbody>' +
        '</table>' +
      '</div>';

    var preface =
      '<div class="admin-math-section">' +
        '<h4>Inputs to Tax Engine (aggregated)</h4>' +
        '<table class="admin-math-table">' +
          '<tbody>' +
            '<tr><td>Year</td><td class="admin-math-num">' + _esc(cfg.year1) + '</td><td>cfg.year1</td></tr>' +
            '<tr><td>Filing status</td><td class="admin-math-num">' + _esc(cfg.filingStatus) + '</td><td>cfg.filingStatus</td></tr>' +
            '<tr><td>State</td><td class="admin-math-num">' + _esc(cfg.state) + '</td><td>cfg.state</td></tr>' +
            '<tr><td>Base ordinary income</td><td class="admin-math-num">' + _fmtUSD(cfg.baseOrdinaryIncome) + '</td><td>cfg.baseOrdinaryIncome &mdash; sum of W-2 + interest + div + retirement + rental + biz (excludes SS; §86 taxable portion added in the scenario tables below)</td></tr>' +
            '<tr><td>Wages (Add\'l Medicare base)</td><td class="admin-math-num">' + _fmtUSD(cfg.wages) + '</td><td>cfg.wages &mdash; W-2 only</td></tr>' +
            '<tr><td>Investment income (NIIT base)</td><td class="admin-math-num">' + _fmtUSD(niitBase) + '</td><td>cfg.investmentIncomeOrdinary &mdash; interest + div + rental</td></tr>' +
            '<tr><td>Annual ST gain</td><td class="admin-math-num">' + _fmtUSD(cfg.baseShortTermGain) + '</td><td>cfg.baseShortTermGain</td></tr>' +
            '<tr><td>Annual LT gain (non-property)</td><td class="admin-math-num">' + _fmtUSD(cfg.baseLongTermGain) + '</td><td>cfg.baseLongTermGain</td></tr>' +
            '<tr><td>Property LT gain (from sale)</td><td class="admin-math-num">' + _fmtUSD(ltGain) + '</td><td>salePrice &minus; costBasis &minus; acceleratedDepreciation &minus; shortTermPropertyGain</td></tr>' +
            '<tr><td>Property recapture (§1250)</td><td class="admin-math-num">' + _fmtUSD(recap) + '</td><td>= acceleratedDepreciation</td></tr>' +
            '<tr><td>ST gain (property, ordinary)</td><td class="admin-math-num">' + _fmtUSD(stpg) + '</td><td>cfg.shortTermPropertyGain</td></tr>' +
          '</tbody>' +
        '</table>' +
      '</div>';
    preface = incomeBreakdown + preface;

    var deltaSection =
      '<div class="admin-math-section">' +
        '<h4>Delta &mdash; Tax Due from the Sale</h4>' +
        '<table class="admin-math-table">' +
          '<thead><tr><th>Computation</th><th class="admin-math-num">Amount</th><th>Notes</th></tr></thead>' +
          '<tbody>' +
            '<tr><td>Total WITH sale</td><td class="admin-math-num">' + _fmtUSD(withSale.sum) + '</td><td>federal subtotal + state, LT gain + recap added</td></tr>' +
            '<tr><td>Total WITHOUT sale</td><td class="admin-math-num">' + _fmtUSD(without.sum) + '</td><td>federal subtotal + state, baseline income only</td></tr>' +
            '<tr class="admin-math-total"><td><strong>Tax Due from the Sale (delta)</strong></td><td class="admin-math-num"><strong>' + _fmtUSD(delta) + '</strong></td><td>shown on middle baseline tile</td></tr>' +
          '</tbody>' +
        '</table>' +
      '</div>';

    return preface +
      _scenarioTable('Scenario A &mdash; Without the Sale', without) +
      _scenarioTable('Scenario B &mdash; With the Sale (do-nothing)', withSale) +
      deltaSection;
  }

  root._registerPageMath('page-baseline', _renderBaseline);
})(window);
