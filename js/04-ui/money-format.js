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
    'interest-income', 'social-security', 'business-income-amount',
    'sale-price', 'cost-basis', 'accelerated-depreciation',
    // Multi-property (Q1): Properties 2-5 currency fields.
    'sale-price-2', 'cost-basis-2', 'accelerated-depreciation-2',
    'sale-price-3', 'cost-basis-3', 'accelerated-depreciation-3',
    'sale-price-4', 'cost-basis-4', 'accelerated-depreciation-4',
    'sale-price-5', 'cost-basis-5', 'accelerated-depreciation-5',
    'short-term-gain', 'long-term-gain',
    'withhold-amount', 'available-capital',
    // Per-property personal-use amounts (replaces the old single withhold-amount).
    'personal-use-amount-1', 'personal-use-amount-2', 'personal-use-amount-3',
    'personal-use-amount-4', 'personal-use-amount-5',
    // Per-property outstanding-debt payoff amounts.
    'amount-owed-amount-1', 'amount-owed-amount-2', 'amount-owed-amount-3',
    'amount-owed-amount-4', 'amount-owed-amount-5',
    // Future Sale Loss Target (Section 05) — single estimated gain.
    'future-estimated-gain',
    // Additional Funds (Section 03) — inert/display fields today, but
    // format them so they read like every other money input.
    'additional-account-value', 'additional-lt-gain', 'additional-st-gain',
    'additional-cost-basis-derived', 'additional-funds'
  ];

  // Fields where negative values are nonsensical (W-2 / SE / dividend /
  // retirement / sale-price / basis / depr / withhold / available
  // capital). parseUSD permits negatives so the user can paste them,
  // but for these fields a negative is silently clamped to 0 here so
  // the displayed value matches what the engine uses.
  //
  // biz-revenue and rental-income INTENTIONALLY allow negatives —
  // Schedule C / Schedule E losses are real ordinary-income losses
  // that legitimately offset other income. Previously they were
  // clamped to $0 here, which silently dropped tens of thousands of
  // dollars of legitimate loss offset. (Bug #14.)
  var NON_NEGATIVE_IDS = {
    'w2-wages': 1, 'se-income': 1,
    'dividend-income': 1, 'retirement-distributions': 1,
    'sale-price': 1, 'cost-basis': 1, 'accelerated-depreciation': 1,
    'sale-price-2': 1, 'cost-basis-2': 1, 'accelerated-depreciation-2': 1,
    'sale-price-3': 1, 'cost-basis-3': 1, 'accelerated-depreciation-3': 1,
    'sale-price-4': 1, 'cost-basis-4': 1, 'accelerated-depreciation-4': 1,
    'sale-price-5': 1, 'cost-basis-5': 1, 'accelerated-depreciation-5': 1,
    // short-term-gain / long-term-gain are OMITTED on purpose: a negative
    // value is a §1211 capital loss (nets against gains; up to $3K/yr
    // [$1.5K MFS] offsets ordinary; the remainder carries forward).
    // Clamping them to $0 silently dropped legitimate losses.
    'withhold-amount': 1, 'available-capital': 1,
    'personal-use-amount-1': 1, 'personal-use-amount-2': 1, 'personal-use-amount-3': 1,
    'personal-use-amount-4': 1, 'personal-use-amount-5': 1,
    'amount-owed-amount-1': 1, 'amount-owed-amount-2': 1, 'amount-owed-amount-3': 1,
    'amount-owed-amount-4': 1, 'amount-owed-amount-5': 1,
    'future-estimated-gain': 1,
    'interest-income': 1, 'social-security': 1,
    // Additional Funds: account value / liquidation amount / derived
    // basis are non-negative. additional-lt-gain AND additional-st-gain
    // are OMITTED — each can be a gain OR a loss (advisor: "it could be
    // negative or positive"), like the main ST/LT fields and
    // business-income-amount (Schedule C / K-1 loss).
    'additional-account-value': 1,
    'additional-funds': 1, 'additional-cost-basis-derived': 1
  };

  function _toNum(s) {
    if (typeof parseUSD === 'function') return parseUSD(s);
    var cleaned = String(s == null ? '' : s).replace(/[^0-9.\-]/g, '');
    var n = parseFloat(cleaned);
    return isFinite(n) ? n : 0;
  }

  function _formatNum(n) {
    // Accounting notation: render negatives (capital losses in the
    // loss-capable fields — short/long-term gain, business income,
    // rental) as parentheses, e.g. -100000 → "($100,000)". parseUSD
    // reads parentheses back as negative, so the value round-trips.
    if (n < 0) {
      var pos = (typeof fmtUSD === 'function') ? fmtUSD(-n)
                                               : '$' + Math.round(-n).toLocaleString('en-US');
      return '(' + pos + ')';
    }
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
    // Future-proof: auto-wire EVERY input inside a .currency-input
    // wrapper so any newly-added money field gets accounting formatting
    // automatically — no need to remember to update MONEY_INPUT_IDS.
    // wire() is idempotent (guards on __rettMoneyWired), so re-wiring the
    // explicit IDs above is a harmless no-op. (Fields with no wrapper,
    // e.g. withhold-amount, are still covered by the explicit list.)
    var wrapped = document.querySelectorAll('.currency-input input');
    for (var i = 0; i < wrapped.length; i++) wire(wrapped[i]);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
