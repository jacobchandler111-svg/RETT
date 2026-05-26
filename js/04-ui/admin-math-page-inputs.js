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

    sections.push(_section('Annual Income Sources', [
      _row('baseOrdinaryIncome', cfg.baseOrdinaryIncome, 'Sum of W-2 + SE + rental + dividend + retirement income'),
      _row('wages', cfg.wages, 'W-2 + SE only - Additional Medicare (0.9%) base'),
      _row('investmentIncomeOrdinary', cfg.investmentIncomeOrdinary, 'Dividend + interest portion - NIIT base'),
      _row('baseShortTermGain', cfg.baseShortTermGain, 'Annual ST cap gain - taxed at ordinary rates'),
      _row('baseLongTermGain', cfg.baseLongTermGain, 'Annual LT cap gain (non-property) - stocks, crypto, etc.')
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
    sections.push(_section('Derived Values (engine reads these)', [
      _row('totalGain', totalGain, 'salePrice &minus; costBasis = ' + _fmtUSD(sp) + ' &minus; ' + _fmtUSD(cb)),
      _row('longTermGain', ltDerived, 'salePrice &minus; costBasis &minus; acceleratedDepreciation &minus; shortTermPropertyGain'),
      _row('recapture (§1250)', recapDerived, '= acceleratedDepreciation; recognized as Y1 ordinary income, capped at 25%')
    ]));

    return sections.join('');
  }

  root._registerPageMath('page-inputs', _renderInputs);
})(window);
