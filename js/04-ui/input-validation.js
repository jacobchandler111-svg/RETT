// FILE: js/04-ui/input-validation.js
// Form validation for Page 1 (Client Inputs) and Page 2 (Brooklyn Config).
// Returns { ok: bool, errors: [{field, message}], warnings: [{field, message}] }.
//
// Errors block navigation to the projection. Warnings are surfaced but
// non-blocking (e.g., very small invested capital, missing state).

(function (root) {
  'use strict';

  function _num(id) {
    var el = document.getElementById(id);
    if (!el) return 0;
    var v = (typeof parseUSD === 'function') ? parseUSD(el.value) : Number(el.value);
    return Number.isFinite(v) ? v : 0;
  }

  function _str(id) {
    var el = document.getElementById(id);
    return el ? String(el.value || '').trim() : '';
  }

  function validateClientInputs() {
    var errors = [];
    var warnings = [];

    // --- Custodian ---
    if (!_str('custodian-select')) {
      errors.push({ field: 'custodian-select', message: 'Select a custodian.' });
    }

    // --- Property sale ---
    var salePrice    = _num('sale-price');
    var costBasis    = _num('cost-basis');
    var accelDep     = _num('accelerated-depreciation');

    if (salePrice < 0)    errors.push({ field: 'sale-price',    message: 'Sale price cannot be negative.' });
    if (costBasis < 0)    errors.push({ field: 'cost-basis',    message: 'Cost basis cannot be negative.' });
    if (accelDep < 0)     errors.push({ field: 'accelerated-depreciation', message: 'Accelerated depreciation cannot be negative.' });

    if (salePrice > 0 && costBasis > 0 && salePrice < costBasis) {
      warnings.push({
        field: 'sale-price',
        message: 'Sale price is less than cost basis — there is no capital gain to offset.'
      });
    }
    if (accelDep > 0 && costBasis > 0 && accelDep > costBasis) {
      errors.push({
        field: 'accelerated-depreciation',
        message: 'Accelerated depreciation cannot exceed cost basis.'
      });
    }

    // --- Income sources ---
    // Most fields must be non-negative; biz-revenue and rental-income
    // are signed because Schedule C / Schedule E losses are real
    // ordinary-income offsets. (Bug #14.)
    var positiveIncomeIds = ['w2-wages','se-income','dividend-income','retirement-distributions'];
    positiveIncomeIds.forEach(function (id) {
      if (_num(id) < 0) errors.push({ field: id, message: 'Income value cannot be negative.' });
    });

    // --- Other capital gains ---
    // STG is now an independent income item under Income Sources
    // (any short-term gain the client recognized this year, NOT a
    // carve-out from the property sale). LT gain = sale - basis - depr.
    var stGain = _num('short-term-gain');
    if (stGain < 0) errors.push({ field: 'short-term-gain', message: 'Short-term gain cannot be negative. (Use the projection engine to handle losses.)' });
    var computedLT = Math.max(0, salePrice - costBasis - accelDep);
    if (computedLT > 100_000_000) {
      warnings.push({
        field: 'sale-price',
        message: 'Computed long-term gain exceeds $100M — please double-check the inputs.'
      });
    }

    // --- Sale / Closing date ---
    var implDate = _str('implementation-date');
    var year1    = parseInt(_str('year1'), 10) || (new Date()).getFullYear();
    var saleDateValid = false;
    var saleD = null;
    if (implDate) {
      // Use the shared parseLocalDate so the validator agrees with the
      // engine. new Date(YYYY-MM-DD) parses as UTC midnight in most
      // browsers; reading getUTCFullYear() in negative-UTC timezones
      // can return the prior year for early-January dates and produce
      // a spurious "outside Year 1" warning.
      saleD = (typeof window.parseLocalDate === 'function')
        ? window.parseLocalDate(implDate)
        : new Date(implDate);
      if (!saleD || isNaN(saleD.getTime())) {
        errors.push({ field: 'implementation-date', message: 'Sale / closing date is not a valid date.' });
      } else {
        saleDateValid = true;
        var yr = saleD.getFullYear();
        if (yr < year1 || yr > year1 + 1) {
          warnings.push({
            field: 'implementation-date',
            message: 'Sale / closing date is outside Year 1 (' + year1 + '). Time-weighting may be unexpected.'
          });
        }
        // Sanity bound — out-of-range dates produce nonsense projections
        // (e.g. 1900-01-01 or 9999-12-31). Bound to year1 ± 5 years.
        if (yr < year1 - 5 || yr > year1 + 10) {
          errors.push({
            field: 'implementation-date',
            message: 'Sale / closing date is far outside the tax-year window (' + year1 + ' ± 5 years).'
          });
        }
      }
    }

    // --- Strategy implementation date ---
    var stratDate = _str('strategy-implementation-date');
    if (stratDate) {
      var sd = (typeof window.parseLocalDate === 'function')
        ? window.parseLocalDate(stratDate)
        : new Date(stratDate);
      if (!sd || isNaN(sd.getTime())) {
        errors.push({ field: 'strategy-implementation-date', message: 'Strategy implementation date is not a valid date.' });
      } else {
        // Strategy can't open before the sale closes — there are no
        // proceeds to deploy yet. Flag as warning rather than error so
        // a 1-day overlap from time-zone drift doesn't block the form.
        if (saleDateValid && sd < saleD) {
          warnings.push({
            field: 'strategy-implementation-date',
            message: 'Strategy implementation date is before the sale / closing date — the position cannot open before proceeds clear.'
          });
        }
        var sdYr = sd.getFullYear();
        if (sdYr < year1 - 5 || sdYr > year1 + 10) {
          errors.push({
            field: 'strategy-implementation-date',
            message: 'Strategy implementation date is far outside the tax-year window.'
          });
        }
      }
    }

    return { ok: errors.length === 0, errors: errors, warnings: warnings };
  }

  function validateBrooklynConfig() {
    var errors = [];
    var warnings = [];

    var available = _num('available-capital');
    var invested  = _num('invested-capital');

    if (available < 0) errors.push({ field: 'available-capital', message: 'Available capital cannot be negative.' });
    if (invested  < 0) errors.push({ field: 'invested-capital',  message: 'Invested capital cannot be negative.' });
    if (invested === 0) {
      warnings.push({ field: 'invested-capital', message: 'Invested capital is zero — no Brooklyn loss will be generated.' });
    }
    if (available > 0 && invested > available) {
      errors.push({
        field: 'invested-capital',
        message: 'Invested capital ($' + invested.toLocaleString() + ') exceeds available capital ($' + available.toLocaleString() + ').'
      });
    }

    // Custodian-driven minimum investment. Routes through
    // validateAgainstCustodian (custodians.js) so the validator,
    // engine-side _belowMinForLifecycle, and the controls.js Schwab
    // combo warning all share one min source. Combo-specific minimums
    // (Schwab 145/45 $1M vs 200/100 $3M) flow through via cfg.comboId
    // which validateAgainstCustodian honors after Issue #2.
    var custodianId = _str('custodian-select');
    var strategyKey = _str('strategy-select');
    if (custodianId && strategyKey && typeof validateAgainstCustodian === 'function') {
      var leverageLabel = _str('leverage-cap-select') || '';
      var combo = (custodianId === 'schwab' && typeof findSchwabCombo === 'function')
        ? findSchwabCombo(strategyKey, leverageLabel)
        : null;
      var validRes = validateAgainstCustodian({
        custodian: custodianId,
        strategyKey: strategyKey,
        comboId: combo ? combo.id : null,
        investedCapital: invested,
        investment: invested,
        leverageCap: combo ? combo.leverage : null
      });
      if (validRes && validRes.ok === false && validRes.code === 'below-minimum') {
        errors.push({ field: 'invested-capital', message: validRes.message });
      }
    }

    return { ok: errors.length === 0, errors: errors, warnings: warnings };
  }

  // Highlight error fields with a subtle red border. Non-blocking — visual only.
  function highlightFields(fieldIds, on) {
    fieldIds.forEach(function (id) {
      var el = document.getElementById(id);
      if (!el) return;
      el.classList.toggle('input-error', !!on);
    });
  }

  function _clearAllHighlights() {
    var els = document.querySelectorAll('.input-error');
    els.forEach(function (el) { el.classList.remove('input-error'); });
  }

  // Run the appropriate validator and surface results via the banner.
  // Returns true if validation passed (no errors).
  function validateAndReport(scope) {
    _clearAllHighlights();
    var result = (scope === 'brooklyn') ? validateBrooklynConfig() : validateClientInputs();

    if (result.errors.length) {
      highlightFields(result.errors.map(function (e) { return e.field; }), true);
      var first = result.errors[0];
      var more  = result.errors.length > 1 ? ' (' + (result.errors.length - 1) + ' more)' : '';
      if (typeof showBanner === 'function') {
        showBanner('error', first.message + more);
      }
      var firstEl = document.getElementById(first.field);
      if (firstEl && typeof firstEl.focus === 'function') firstEl.focus();
      return false;
    }

    if (result.warnings.length) {
      var w = result.warnings[0];
      if (typeof showBanner === 'function') {
        showBanner('warning', w.message);
      }
    } else if (typeof hideBanner === 'function') {
      hideBanner();
    }
    return true;
  }

  root.validateClientInputs   = validateClientInputs;
  root.validateBrooklynConfig = validateBrooklynConfig;
  root.validateAndReport      = validateAndReport;
})(window);
