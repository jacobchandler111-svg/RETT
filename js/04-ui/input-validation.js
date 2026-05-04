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

    // --- Income sources (just sanity, all should be non-negative) ---
    var incomeIds = ['w2-wages','se-income','biz-revenue','rental-income','dividend-income','retirement-distributions'];
    incomeIds.forEach(function (id) {
      if (_num(id) < 0) errors.push({ field: id, message: 'Income value cannot be negative.' });
    });

    // --- Other capital gains ---
    var stGain = _num('short-term-gain');
    var ltGain = _num('long-term-gain');
    if (stGain < 0) errors.push({ field: 'short-term-gain', message: 'Short-term gain cannot be negative. (Use the projection engine to handle losses.)' });
    if (ltGain < 0) errors.push({ field: 'long-term-gain',  message: 'Long-term gain cannot be negative. (Use the projection engine to handle losses.)' });

    // --- Implementation date ---
    var implDate = _str('implementation-date');
    var year1    = parseInt(_str('year1'), 10) || (new Date()).getFullYear();
    if (implDate) {
      // Use the shared parseLocalDate so the validator agrees with the
      // engine. new Date(YYYY-MM-DD) parses as UTC midnight in most
      // browsers; reading getUTCFullYear() in negative-UTC timezones
      // can return the prior year for early-January dates and produce
      // a spurious "outside Year 1" warning.
      var d = (typeof window.parseLocalDate === 'function')
        ? window.parseLocalDate(implDate)
        : new Date(implDate);
      if (!d || isNaN(d.getTime())) {
        errors.push({ field: 'implementation-date', message: 'Implementation date is not a valid date.' });
      } else {
        var yr = d.getFullYear();
        if (yr < year1 || yr > year1 + 1) {
          warnings.push({
            field: 'implementation-date',
            message: 'Implementation date is outside Year 1 (' + year1 + '). Time-weighting may be unexpected.'
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

    // Custodian-driven minimum investment (Schwab combos checked in controls.js
    // already; here we cover the non-Schwab fast path).
    var custodianId = _str('custodian-select');
    var strategyKey = _str('strategy-select');
    if (custodianId && strategyKey && typeof getMinInvestment === 'function') {
      var minInv = getMinInvestment(custodianId, strategyKey);
      if (minInv > 0 && invested > 0 && invested < minInv) {
        errors.push({
          field: 'invested-capital',
          message: 'Below minimum investment for this strategy ($' + minInv.toLocaleString() + ').'
        });
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
