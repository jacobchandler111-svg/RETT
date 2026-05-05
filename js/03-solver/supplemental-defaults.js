// FILE: js/03-solver/supplemental-defaults.js
// Default registrations for the supplemental-strategy registry.
// One self-contained spec per strategy. Each spec hooks into the
// per-strategy module's published globals — never reaches into
// internals — so the calc module stays the source of truth and
// this file stays an inert lego connector.
//
// Adding a new strategy: append a registerSupplemental({ ... }) block
// here. The Page-5 master solver picks it up automatically.

(function (root) {
  'use strict';

  if (typeof root.registerSupplemental !== 'function') return;

  // ---------------------------------------------------------------
  // Oil & Gas Working Interest
  // Math:    js/03-solver/calc-oil-gas.js  (computeOilGasMultiYear)
  // UI:      js/04-ui/supplemental-render.js
  // Result:  window.__rettSupplemental.oilGas.lastResult
  //          { perYear[], totalSaved, totalDeduction, ... }
  // ---------------------------------------------------------------
  root.registerSupplemental({
    id:           'oilGas',
    name:         'Oil & Gas Working Interest',
    shortName:    'Oil & Gas',
    descriptor:   'IDC + bonus depreciation deduct ~95% of capital against ordinary income.',
    order:        10,
    incomeBucket: 'ordinary',
    getInterest: function () {
      var i = root.__rettSupplementalInterest;
      return i && typeof i.oilGas !== 'undefined' ? i.oilGas : null;
    },
    getResult: function () {
      var s = root.__rettSupplemental && root.__rettSupplemental.oilGas;
      return s ? s.lastResult : null;
    },
    getNetBenefit: function (result) {
      if (!result) return 0;
      var v = Number(result.totalSaved);
      return Number.isFinite(v) ? v : 0;
    }
  });

  // ---------------------------------------------------------------
  // Delphi Fund (Class A & Class B)
  // Math:    js/03-solver/calc-delphi.js  (computeDelphiYear1)
  // UI:      js/04-ui/supplemental-render.js
  // Result:  window.__rettSupplemental.delphi.lastResult
  //          { classKey, investment, allocations{...}, totalSaved,
  //            fedSaved, stateSaved, ftcApplied, ... }
  // 'mixed' bucket because Delphi simultaneously generates ordinary
  // expense (-30%) AND offsetting LT capital gain (+25%) — the
  // future allocator needs to know it pulls from both.
  // ---------------------------------------------------------------
  root.registerSupplemental({
    id:           'delphi',
    name:         'Delphi Fund',
    shortName:    'Delphi',
    descriptor:   'K-1 fund recharacterizes ordinary income as long-term capital gain.',
    order:        20,
    incomeBucket: 'mixed',
    getInterest: function () {
      var i = root.__rettSupplementalInterest;
      return i && typeof i.delphi !== 'undefined' ? i.delphi : null;
    },
    getResult: function () {
      var s = root.__rettSupplemental && root.__rettSupplemental.delphi;
      return s ? s.lastResult : null;
    },
    getNetBenefit: function (result) {
      if (!result) return 0;
      var v = Number(result.totalSaved);
      return Number.isFinite(v) ? v : 0;
    }
  });
})(window);
