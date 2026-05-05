// FILE: js/04-ui/money-format.js
// Auto-format money inputs as accounting ($1,000,000) on blur, strip back
// to plain digits on focus so users can edit without fighting commas.
// Also reformats after programmatic value changes (case-storage applyFormState
// dispatches `change`, _recomputeAvailableCapital sets the formatted value
// directly), so the displayed value stays consistent regardless of how it
// got there.
//
// parseUSD (format-helpers.js) accepts both "1000000" and "$1,000,000",
// so existing engine consumers (inputs-collector, recommendation-render,
// cashflow-schedule-render, etc.) work unchanged once they switch from
// Number(el.value) to parseUSD(el.value).

(function () {
  'use strict';

  var MONEY_INPUT_IDS = [
    'w2-wages', 'se-income', 'biz-revenue', 'rental-income',
    'dividend-income', 'retirement-distributions',
    'sale-price', 'cost-basis', 'accelerated-depreciation',
    'short-term-gain', 'withhold-amount', 'available-capital'
  ];

  // Fields where negative values are nonsensical. parseUSD permits
  // them (the user can paste "-$500K"), and the engine has its own
  // _safeIncome clamp, but displaying a negative in the field misleads
  // the user into thinking the value was accepted as-is. Reject at
  // format time so the visible value matches what the engine uses.
  var NON_NEGATIVE_IDS = {
    'w2-wages': 1, 'se-income': 1, 'biz-revenue': 1, 'rental-income': 1,
    'dividend-income': 1, 'retirement-distributions': 1,
    'sale-price': 1, 'cost-basis': 1, 'accelerated-depreciation': 1,
    'withhold-amount': 1, 'available-capital': 1
  };

  function _toNum(s) {
    if (typeof parseUSD === 'function') return parseUSD(s);
    var cleaned = String(s == null ? '' : s).replace(/[^0-9.\-]/g, '');
    var n = parseFloat(cleaned);
    return isFinite(n) ? n : 0;
  }

  function _formatNum(n) {
    if (typeof fmtUSD === 'function') return fmtUSD(n);
    return '$' + Math.round(n).toLocaleString('en-US');
  }

  function _format(el) {
    if (!el) return;
    var raw = el.value;
    if (raw === '' || raw == null) return;
    var n = _toNum(raw);
    if (!isFinite(n)) return;
    if (n < 0 && el.id && NON_NEGATIVE_IDS[el.id]) {
      n = 0;
      if (typeof window.showBanner === 'function') {
        try { window.showBanner('warning', 'Negative value not allowed for ' + el.id.replace(/-/g, ' ') + ' — set to $0.'); } catch (e) { /* */ }
        setTimeout(function () { if (typeof window.hideBanner === 'function') window.hideBanner(); }, 2500);
      }
    }
    el.value = _formatNum(n);
  }

  function _strip(el) {
    if (!el) return;
    if (el.value === '' || el.value == null) return;
    var n = _toNum(el.value);
    if (!isFinite(n)) return;
    el.value = String(n);
  }

  function wire(el) {
    if (!el || el.__rettMoneyWired) return;
    el.__rettMoneyWired = true;
    el.addEventListener('blur',  function () { _format(el); });
    el.addEventListener('focus', function () { _strip(el);  });
    // Programmatic value writes (case restore, _recomputeAvailableCapital)
    // dispatch `change` after setting el.value. Reformat then, but only
    // when the user isn't actively typing in this field.
    el.addEventListener('change', function () {
      if (document.activeElement !== el) _format(el);
    });
    if (document.activeElement !== el) _format(el);
  }

  function init() {
    MONEY_INPUT_IDS.forEach(function (id) {
      wire(document.getElementById(id));
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
