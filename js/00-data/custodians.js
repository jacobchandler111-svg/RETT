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
// CUSTODIAN CONFIG IS LIVE. Edit the CUSTODIANS object to change behavior
// across the app — no other file edits required.
//
// To update minimums or leverage caps:
//   1. Confirm the new figures with the custodian relationship manager.
//   2. Update the relevant fields in CUSTODIANS below.
//   3. Bump CUSTODIANS_LAST_UPDATED so consumers can audit freshness.

(function (root) {
  'use strict';

  var CUSTODIANS_LAST_UPDATED = '2026-01-01';

  var CUSTODIANS = {
    schwab: {
      id: 'schwab',
      label: 'Charles Schwab',
      // Schwab restriction (2026-05-04): Beta 1 only, two preset combos
      // (145/45 and 200/100). No continuous / variable leverage.
      // The numeric values in allowedLeverageCaps match the combos'
      // shortPct/100 field so the existing isLeverageCapAllowed check
      // accepts them.
      allowedStrategies: ['beta1'],
      allowedLeverageCaps: [0.45, 1.00],
      minInvestment: {
        beta1: 1000000
      },
      notes: 'Beta 1 only, presets 145/45 and 200/100. Confirm minimums quarterly with Schwab relationship manager.'
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
      notes: 'Confirm minimums quarterly with Goldman Sachs relationship manager.'
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

  function getMinInvestment(custodianId, strategyKey, comboId) {
    // Schwab combo-specific override: 145/45 needs $1M, 200/100 needs $3M.
    // The custodian-level minInvestment[strategyKey] is the floor across
    // ALL combos (the smallest one), so checking against just that lets
    // a $2M deposit pass when the user actually picked 200/100. Honor
    // the combo when supplied.
    if (comboId && typeof root.getSchwabCombo === 'function') {
      var combo = root.getSchwabCombo(comboId);
      if (combo && typeof combo.minInvestment === 'number' && isFinite(combo.minInvestment)) {
        return combo.minInvestment;
      }
    }
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

  root.CUSTODIANS_LAST_UPDATED = CUSTODIANS_LAST_UPDATED;
  root.CUSTODIANS = CUSTODIANS;
  root.listCustodians = listCustodians;
  root.getCustodian = getCustodian;
  root.isStrategyAllowed = isStrategyAllowed;
  root.isLeverageCapAllowed = isLeverageCapAllowed;
  root.getMinInvestment = getMinInvestment;
  root.validateAgainstCustodian = validateAgainstCustodian;
})(window);
