// js/04-ui/admin-math-page-inputs.js
//
// Admin math reveal panel - Tab 1 (Client Inputs).
//
// Surfaces the full collectInputs() result the rest of the engine
// reads, grouped into sections that mirror the visible form, plus
// derived values (longTermGain, recapture) with the formulas that
// produce them so a CPA can verify what's being fed downstream.
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
    return '$' + Math.round(v).toLocaleString('en-US');
  }
  function _fmtVal(v) {
    if (v == null || v === '') return '<span class="admin-math-empty">&mdash;</span>';
    if (typeof v === 'boolean') return v ? 'true' : 'false';
    if (typeof v === 'number') {
      if (Number.isInteger(v) && Math.abs(v) < 10000) return String(v);
      return _fmtUSD(v);
    }
    if (typeof v === 'object') return '<code>' + _esc(JSON.stringify(v)) + '</code>';
    return _esc(String(v));
  }
  function _row(label, value, note) {
    return '<tr><td>' + _esc(label) + '</td><td>' + _fmtVal(value) + '</td>' +
           (note ? '<td class="admin-math-note-cell">' + note + '</td>' : '<td></td>') + '</tr>';
  }
  function _section(title, rows) {
    return '<div class="admin-math-section">' +
      '<h4>' + _esc(title) + '</h4>' +
      '<table class="admin-math-table">' +
        '<thead><tr><th>Field</th><th>Value</th><th>Notes / Source</th></tr></thead>' +
        '<tbody>' + rows.join('') + '</tbody>' +
      '</table>' +
    '</div>';
  }

  function _renderInputs() {
    if (typeof root.collectInputs !== 'function') {
      return '<p class="admin-math-error">collectInputs() not available - inputs-collector.js not loaded?</p>';
    }
    var cfg;
    try { cfg = root.collectInputs(); }
    catch (e) {
      return '<p class="admin-math-error">collectInputs() threw: ' + _esc(e.message || e) + '</p>';
    }

    // Pull client identity from the PMQ section since collectInputs
    // doesn't carry the name/email/phone fields.
    var clientName = ((document.getElementById('case-name-input') || {}).value) || '';
    var clientEmail = ((document.getElementById('pmq-email') || {}).value) || '';
    var clientPhone = ((document.getElementById('pmq-phone') || {}).value) || '';

    var sections = [];

    sections.push(_section('Client Identity', [
      _row('clientName', clientName, '#case-name-input'),
      _row('email', clientEmail, '#pmq-email'),
      _row('phone', clientPhone, '#pmq-phone')
    ]));

    sections.push(_section('Custodian / Strategy', [
      _row('custodian', cfg.custodian, '#custodian-select'),
      _row('tierKey', cfg.tierKey, '#strategy-select - Brooklyn strategy tier'),
      _row('leverage', cfg.leverage, 'Default 1.0; pill toggles or Schwab combo override this'),
      _row('leverageCap', cfg.leverageCap, '#leverage-cap-select - upper bound when auto-picking')
    ]));

    sections.push(_section('Filing', [
      _row('filingStatus', cfg.filingStatus, '#filing-status'),
      _row('state', cfg.state, '#state-code'),
      _row('year1', cfg.year1, '#year1 - first projection year'),
      _row('horizonYears', cfg.horizonYears, '#projection-years - total years of projection')
    ]));

    // Raw per-field reads so the CPA can see each input value
    // independently of the rolled-up baseOrdinaryIncome / wages /
    // investmentIncomeOrdinary derived fields below.
    function _raw(id) {
      var el = document.getElementById(id);
      var v = el ? (root.parseUSD ? root.parseUSD(el.value) : Number(el.value)) : 0;
      return Number.isFinite(v) ? Math.max(0, v) : 0;
    }
    var w2          = _raw('w2-wages');
    var interest    = _raw('interest-income');
    var ordDiv      = _raw('dividend-income');
    var qualDiv     = _raw('qualified-dividends');
    var retDist     = _raw('retirement-distributions');
    var socSec      = _raw('social-security');
    var rental      = _raw('rental-income');
    var bizAmt      = _raw('business-income-amount');
    var bizTypeEl   = document.querySelector('input[name="business-income-type"]:checked');
    var bizType     = bizTypeEl ? bizTypeEl.value : null;

    sections.push(_section('Annual Income Sources (per field, raw reads)', [
      _row('W-2 Wages',                w2,      '#w2-wages — IRC §61(a)(1); ordinary brackets + Additional Medicare base'),
      _row('Interest Income',          interest,'#interest-income — IRC §61(a)(4); ordinary brackets + NIIT base per §1411(c)(1)(A)(i)'),
      _row('Ordinary Dividends',       ordDiv,  '#dividend-income — non-qualified, ordinary brackets + NIIT base'),
      _row('Qualified Dividends',      qualDiv, '#qualified-dividends — IRC §1(h)(11); LTCG preferential rates + NIIT base; stacks on ordinary for bracket placement'),
      _row('Retirement Distributions', retDist, '#retirement-distributions — ordinary brackets; §1411(c)(5) excludes from NIIT base'),
      _row('Social Security (gross)',  socSec,  '#social-security — IRC §86 provisional-income worksheet derives taxable portion (see derived section); ordinary brackets, NOT in NIIT or Add’l Medicare base'),
      _row('Rental Income',            rental,  '#rental-income — Schedule E; ordinary brackets + NIIT base (passive default)'),
      _row('Business Income',          bizAmt,  '#business-income-amount — INERT (engine wiring pending) — type below drives SE-tax routing'),
      _row('Business Income Type',     bizType, 'INERT — radio group; gates §1401 SE tax application')
    ]));

    sections.push(_section('Derived Income Bases (engine reads these)', [
      _row('baseOrdinaryIncome',       cfg.baseOrdinaryIncome,       'W-2 + SE + dividend + retirement + interest + rental + biz — fed into ordinary brackets'),
      _row('wages',                    cfg.wages,                    'W-2 + SE only — Additional Medicare 0.9% surtax base per IRC §3101(b)(2)'),
      _row('investmentIncomeOrdinary', cfg.investmentIncomeOrdinary, 'Rental + dividend + interest — §1411 NIIT 3.8% surtax base'),
      _row('baseShortTermGain',        cfg.baseShortTermGain,        'Annual ST cap gain (not the property sale) — taxed at ordinary rates'),
      _row('baseLongTermGain',         cfg.baseLongTermGain,         'Annual LT cap gain (non-property) — stocks, crypto, etc.')
    ]));

    sections.push(_section('Property Sale', [
      _row('salePrice', cfg.salePrice, 'Sum across all active properties'),
      _row('costBasis', cfg.costBasis, 'Sum across all active properties'),
      _row('acceleratedDepreciation', cfg.acceleratedDepreciation, '§1250 recapture base - Y1 ordinary income'),
      _row('shortTermPropertyGain', cfg.shortTermPropertyGain, 'Property held <12mo - taxed at ordinary rates'),
      _row('implementationDate', cfg.implementationDate, 'Sale / closing date - drives recognition timing'),
      _row('strategyImplementationDate', cfg.strategyImplementationDate, 'When Brooklyn opens position - partial-year fee proration')
    ]));

    sections.push(_section('Sale Proceeds Handling', [
      _row('availableCapital', cfg.availableCapital, '#available-capital - cash deployable to Brooklyn'),
      _row('investment', cfg.investment, 'Aliased: same as availableCapital unless legacy override'),
      _row('coverTaxesFromSale', cfg.coverTaxesFromSale, 'When yes, carves tax estimate out of proceeds before Brooklyn'),
      _row('structuredSaleDurationMonths', cfg.structuredSaleDurationMonths, 'Strategy C term - 36/48/60/72mo'),
      _row('recognitionStartYearIndex', cfg.recognitionStartYearIndex, '0=immediate (A), 1=year+1 (B/C)'),
      _row('maxRecognitionYearIndex', cfg.maxRecognitionYearIndex, 'Strategy B caps recognition at index 1; null for A/C')
    ]));

    if (cfg.futureSale && cfg.futureSale.enabled) {
      sections.push(_section('Future Sale Loss Target', [
        _row('futureSale.enabled', cfg.futureSale.enabled),
        _row('futureSale.saleDate', cfg.futureSale.saleDate, 'Projected closing date for the future sale'),
        _row('futureSale.estimatedGain', cfg.futureSale.estimatedGain, 'Estimated taxable gain - drives loss carryforward retention')
      ]));
    } else {
      sections.push(_section('Future Sale Loss Target', [
        _row('futureSale.enabled', false, 'No future sale configured - loss carryforward capped at $3K/yr per §1211(b)')
      ]));
    }

    // Derived values - the engine recomputes these from raw inputs,
    // surfaced here so the CPA can see what the tax engine actually
    // receives in opts.longTermGain, opts.depreciationRecapture, etc.
    var sp = Number(cfg.salePrice) || 0;
    var cb = Number(cfg.costBasis) || 0;
    var ad = Number(cfg.acceleratedDepreciation) || 0;
    var stpg = Number(cfg.shortTermPropertyGain) || 0;
    var ltDerived = Math.max(0, sp - cb - ad - stpg);
    var recapDerived = Math.max(0, ad);
    var totalGain = sp - cb;

    // §86 SS taxable-portion derivation. Mirrors the engine's Y0 calc
    // in _baseScenarioForYear so a CPA can verify the worksheet output.
    // otherAGI excludes SS itself (provisional = otherAGI + 50% × SS).
    var ssTaxable = 0, ssProv = 0, ssTier = '—';
    if (socSec > 0 && typeof root._computeTaxableSocialSecurity === 'function') {
      // baseOrdinaryIncome does NOT include SS (gross SS is captured
      // separately on cfg.socialSecurityBenefits, not summed into the
      // bracket-stack base). otherAGI = base ordinary + recurring cap
      // gains + qualified div + property-sale derived gain/recapture.
      // Matches what _baseScenarioForYear uses as the provisional
      // base before adding 0.5 × scaled gross SS.
      var otherAgi = (Number(cfg.baseOrdinaryIncome) || 0)
                   + (Number(cfg.qualifiedDividend) || 0)
                   + Math.max(0, Number(cfg.baseShortTermGain) || 0)
                   + (Number(cfg.baseLongTermGain) || 0)
                   + ltDerived + recapDerived;
      ssProv = otherAgi + 0.5 * socSec;
      ssTaxable = root._computeTaxableSocialSecurity(socSec, otherAgi, 0, cfg.filingStatus);
      var t1 = (cfg.filingStatus === 'mfj') ? 32000 : 25000;
      var t2 = (cfg.filingStatus === 'mfj') ? 44000 : 34000;
      if (cfg.filingStatus === 'mfs') ssTier = 'MFS-lived-with-spouse → 85% from $0';
      else if (ssProv <= t1) ssTier = 'Tier 1 (0% taxable; prov ≤ ' + _fmtUSD(t1) + ')';
      else if (ssProv <= t2) ssTier = 'Tier 2 (up to 50%; prov ' + _fmtUSD(t1) + '–' + _fmtUSD(t2) + ')';
      else ssTier = 'Tier 3 (up to 85%; prov > ' + _fmtUSD(t2) + ')';
    }

    sections.push(_section('Derived Values (engine reads these)', [
      _row('totalGain', totalGain, 'salePrice &minus; costBasis = ' + _fmtUSD(sp) + ' &minus; ' + _fmtUSD(cb)),
      _row('longTermGain', ltDerived, 'salePrice &minus; costBasis &minus; acceleratedDepreciation &minus; shortTermPropertyGain'),
      _row('recapture (§1250)', recapDerived, '= acceleratedDepreciation; recognized as Y1 ordinary income, capped at 25%'),
      _row('SS provisional income', ssProv, '§86 worksheet: otherAGI + 50% × gross SS (' + _fmtUSD(socSec) + ')'),
      _row('SS §86 tier', ssTier, 'Drives 0% / up to 50% / up to 85% taxable inclusion'),
      _row('SS taxable portion', ssTaxable, 'Added to ordinary brackets each year; NOT in NIIT or Add’l Medicare base; engine subtracts SS-exempt states like GA NOT modeled per-state')
    ]));

    return sections.join('');
  }

  root._registerPageMath('page-inputs', _renderInputs);
})(window);
