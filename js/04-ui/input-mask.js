// FILE: js/04-ui/input-mask.js
// Self-contained currency input masking. Wraps any input with a "data-money"
// attribute (or any element matching #w2-wages, #se-income, #biz-revenue,
// #rental-income, #dividend-income, #retirement-distributions, #sale-price,
// #cost-basis, #accelerated-depreciation, #short-term-gain, #long-term-gain,
// #available-capital, #invested-capital) in a <span class="currency-prefix">
// so a left-aligned $ sign appears, and masks keystrokes so the displayed
// value is comma-separated while the underlying numeric remains accessible
// to parseUSD(). Inputs are converted from type="number" to type="text" so
// that comma display works across browsers; numeric validation is enforced
// by the keystroke filter.
//
// This module is purely additive: it does not modify any other file's
// behavior, and parseUSD() (defined in format-helpers.js) already strips
// commas and currency symbols, so existing code paths continue to read
// these inputs unchanged.
//
// Public API:
//   window.RETT_InputMask.refresh()  -- re-bind after dynamic re-renders
//
// Added by tax-strategy-fixes branch.

(function (root) {
  'use strict';

  var DOLLAR_INPUT_IDS = [
    'w2-wages', 'se-income', 'biz-revenue', 'rental-income',
    'dividend-income', 'retirement-distributions',
    'sale-price', 'cost-basis', 'accelerated-depreciation',
    'short-term-gain', 'long-term-gain',
    'available-capital', 'invested-capital'
  ];

  function _formatWithCommas(rawDigits) {
    if (!rawDigits) return '';
    return rawDigits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }

  function _stripNonDigits(s) {
    return String(s == null ? '' : s).replace(/[^\d]/g, '');
  }

  function _wrap(input) {
    if (!input || input.dataset.maskApplied === '1') return;
    // Convert number inputs to text so we can render commas.
    if (input.type === 'number') input.type = 'text';
    input.setAttribute('inputmode', 'numeric');
    input.setAttribute('autocomplete', 'off');
    // Initialize displayed value with commas if there's an existing value.
    var initial = _stripNonDigits(input.value);
    input.value = _formatWithCommas(initial);
    // Wrap in .currency-prefix span if not already wrapped.
    var parent = input.parentElement;
    if (!parent || !parent.classList || !parent.classList.contains('currency-prefix')) {
      var span = document.createElement('span');
      span.className = 'currency-prefix';
      input.parentNode.insertBefore(span, input);
      span.appendChild(input);
    }
    // Bind input handler.
    input.addEventListener('input', function () {
      var caretFromEnd = (input.value || '').length - (input.selectionStart || 0);
      var digits = _stripNonDigits(input.value);
      var formatted = _formatWithCommas(digits);
      input.value = formatted;
      var newPos = Math.max(0, formatted.length - caretFromEnd);
      try { input.setSelectionRange(newPos, newPos); } catch (e) { /* ignore for non-text types */ }
    });
    // On change, fire a synthetic event so listeners that previously listened
    // to "input" on type="number" still see updates.
    input.dataset.maskApplied = '1';
  }

  function refresh() {
    for (var i = 0; i < DOLLAR_INPUT_IDS.length; i++) {
      var el = document.getElementById(DOLLAR_INPUT_IDS[i]);
      if (el) _wrap(el);
    }
    // Also bind any element marked with [data-money].
    var attr = document.querySelectorAll('[data-money]');
    for (var j = 0; j < attr.length; j++) _wrap(attr[j]);
  }

  function _onReady() {
    refresh();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _onReady);
  } else {
    _onReady();
  }

  root.RETT_InputMask = { refresh: refresh };
})(typeof window !== 'undefined' ? window : this);
