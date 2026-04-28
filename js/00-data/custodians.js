// js/00-data/custodians.js
// Custodian registry. Each custodian governs:
//   - which Brooklyn strategies they offer
//   - which leverage caps they will allow
//   - their per-strategy minimum investment
//
// This is the SOURCE OF TRUTH for what the UI should show. Adding a new
// custodian = add a new entry to the CUSTODIANS object. The UI auto-reads
// labels and option lists from this file.
//
// Fidelity is intentionally NOT included — they do not currently offer
// this strategy. Add them later if that changes.
//
// All numeric minimums are placeholders that the user will refine. They
// are wired live, so editing this file is sufficient to change behavior
// across the app (no other file edits required for minimum/cap changes).

(function (root) {
  'use strict';

  var CUSTODIANS = {
    schwab: {
      id: 'schwab',
      label: 'Charles Schwab',
      allowedStrategies: ['beta1', 'beta0', 'beta05', 'advisorManaged'],
      allowedLeverageCaps: [1.00, 1.50, 2.00, 2.25],
      minInvestment: {
        beta1: 1000000,
        beta0: 1000000,
        beta05: 1000000,
        advisorManaged: 2000000
      },
      notes: 'Placeholder minimums — update when finalized.'
    },
    goldmanSachs: {
      id: 'goldmanSachs',
      label: 'Goldman Sachs',
      allowedStrategies: ['beta1', 'beta0', 'beta05', 'advisorManaged'],
      allowedLeverageCaps: [1.00, 1.50, 2.00, 2.25, 2.75],
      minInvestment: {
        beta1: 2500000,
        beta0: 2500000,
        beta05: 2500000,
        advisorManaged: 5000000
      },
      notes: 'Placeholder minimums — update when finalized.'
    }
  };

  function listCustodians() {
    return Object.keys(CUSTODIANS).map(function (k) {
      return { id: CUSTODIANS[k].id, label: CUSTODIANS[k].label };
    });
  }

  function getCustodian(id) {
    if (!id) return null;
    return CUSTODIANS[id] || null;
  }

  function isStrategyAllowed(custodianId, strategyKey) {
    var c = getCustodian(custodianId);
    if (!c) return false;
    return c.allowedStrategies.indexOf(strategyKey) !== -1;
  }

  function isLeverageCapAllowed(custodianId, leverageCap) {
    var c = getCustodian(custodianId);
    if (!c) return false;
    var n = Number(leverageCap);
    if (!isFinite(n)) return false;
    return c.allowedLeverageCaps.some(function (v) {
      return Math.abs(v - n) < 1e-6;
    });
  }

  function getMinInvestment(custodianId, strategyKey) {
    var c = getCustodian(custodianId);
    if (!c || !c.minInvestment) return 0;
    var v = c.minInvestment[strategyKey];
    return (typeof v === 'number' && isFinite(v)) ? v : 0;
  }

  function validateAgainstCustodian(cfg) {
    cfg = cfg || {};
    var custodianId = cfg.custodian;
    if (!custodianId) {
      return { ok: false, code: 'no-custodian', message: 'No custodian selected.' };
    }
    var c = getCustodian(custodianId);
    if (!c) {
      return { ok: false, code: 'unknown-custodian', message: 'Unknown custodian: ' + custodianId };
    }
    var strategyKey = cfg.strategyKey || cfg.tierKey;
    if (strategyKey && !isStrategyAllowed(custodianId, strategyKey)) {
      return {
        ok: false,
        code: 'strategy-not-allowed',
        message: c.label + ' does not offer strategy "' + strategyKey + '".',
        custodian: c
      };
    }
    if (cfg.leverageCap != null && !isLeverageCapAllowed(custodianId, cfg.leverageCap)) {
      return {
        ok: false,
        code: 'leverage-not-allowed',
        message: c.label + ' does not allow leverage cap ' + cfg.leverageCap + 'x.',
        custodian: c,
        allowedLeverageCaps: c.allowedLeverageCaps.slice()
      };
    }
    if (strategyKey) {
      var minInv = getMinInvestment(custodianId, strategyKey);
      var invested = Number(cfg.investedCapital || cfg.investment || 0);
      if (minInv > 0 && invested > 0 && invested < minInv) {
        return {
          ok: false,
          code: 'below-minimum',
          message: c.label + ' requires a minimum investment of $' + minInv.toLocaleString() +
                   ' for strategy "' + strategyKey + '" (you entered $' + invested.toLocaleString() + ').',
          custodian: c,
          minInvestment: minInv
        };
      }
    }
    return { ok: true, custodian: c };
  }

  root.CUSTODIANS = CUSTODIANS;
  root.listCustodians = listCustodians;
  root.getCustodian = getCustodian;
  root.isStrategyAllowed = isStrategyAllowed;
  root.isLeverageCapAllowed = isLeverageCapAllowed;
  root.getMinInvestment = getMinInvestment;
  root.validateAgainstCustodian = validateAgainstCustodian;
})(window);
