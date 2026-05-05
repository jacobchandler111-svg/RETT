// FILE: js/03-solver/supplemental-investment-shims.js
// Augments the existing supplemental-strategy registry entries with
// getInvestment(result) → number — the dollar amount the strategy
// commits when enabled. The Implementation panel on Page 5 reads this
// to show the dollar allocation across Brooklyn + supplementals so
// the advisor can audit that no single dollar is double-spent.
//
// This file is a SHIM — it doesn't redefine the strategies, just adds
// one accessor each. Loaded AFTER supplemental-defaults.js so the
// registry entries already exist.

(function (root) {
  'use strict';

  if (typeof root.getSupplemental !== 'function') return;

  function _attachInvestment(id, getInvestmentFn) {
    var spec = root.getSupplemental(id);
    if (spec && typeof spec.getInvestment !== 'function') {
      spec.getInvestment = getInvestmentFn;
    }
  }

  function applyAll() {
    // Oil & Gas: per-year investment array sums to totalInvestment
    // across the configured horizon (Year-1 default $250K, additional
    // years default $0 unless the user overrides on Page 4).
    _attachInvestment('oilGas', function (result) {
      if (!result) return 0;
      var v = Number(result.totalInvestment);
      return Number.isFinite(v) ? v : 0;
    });
    // Delphi Fund: single investment amount (typically the $1M minimum
    // for Class B, $250K for Class A).
    _attachInvestment('delphi', function (result) {
      if (!result) return 0;
      var v = Number(result.investment);
      return Number.isFinite(v) ? v : 0;
    });
  }

  applyAll();
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', applyAll);
  }
})(window);
