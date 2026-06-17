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
    descriptor:   'IDC + bonus depreciation deduct ~90% of capital against ordinary income.',
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
    // Oil & Gas calc has no product-level management fee — the IDC
    // deduction is the entire mechanism, and the investment dollar
    // funds the working interest itself (Y2+ production income is not
    // modeled). totalSaved is already net of any fees we model today.
    getNetBenefit: function (result) {
      if (!result) return 0;
      var v = Number(result.totalSaved);
      return Number.isFinite(v) ? v : 0;
    },
    // The multi-year shape totals investment via totalInvestment; the
    // single-year shape uses investment. Read whichever is present so
    // the rivalry optimizer sees the dollars committed across the
    // configured horizon.
    getInvestment: function (result) {
      if (!result) return 0;
      var v = Number(result.totalInvestment);
      if (Number.isFinite(v) && v > 0) return v;
      v = Number(result.investment);
      return Number.isFinite(v) ? Math.max(0, v) : 0;
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
    // Net benefit = gross tax saved minus the fund's management fee.
    // The calc returns totalSaved (gross) and mgmtFeeDollars separately;
    // failing to net the fee was inflating Delphi's apparent value by
    // 1.75–2.0% × invested capital ($20K on a $1M Class B at 2%) — at
    // top-bracket rates, that flipped Delphi from "loses to Brooklyn"
    // to "narrowly beats Brooklyn" on canonical scenarios. Same fix
    // applies to any future fund-style supplemental that returns its
    // mgmtFeeDollars separately.
    getNetBenefit: function (result) {
      if (!result) return 0;
      var saved = Number(result.totalSaved) || 0;
      var fee   = Number(result.mgmtFeeDollars) || 0;
      var net = saved - fee;
      return Number.isFinite(net) ? net : 0;
    },
    // Investment for the allocator + rivalry optimizer reads the user's
    // dialed amount on the Delphi card. The K-1 allocations scale
    // linearly off this, so the supplemental's per-dollar rate is
    // constant — comparing it against Brooklyn's per-dollar rate is
    // a clean rate-rank.
    getInvestment: function (result) {
      if (result && Number.isFinite(Number(result.investment))) {
        return Math.max(0, Number(result.investment));
      }
      return 0;
    }
  });
})(window);
