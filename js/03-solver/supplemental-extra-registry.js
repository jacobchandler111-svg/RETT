// FILE: js/03-solver/supplemental-extra-registry.js
// Auto-registers every entry in supplemental-extra-render.js's SPECS
// array with the master solver, EXCEPT entries flagged
// `placeholder: true` (reserved slots awaiting real strategy data).
//
// Activation contract for a new strategy — 2-file edit only:
//
//   1. js/04-ui/supplemental-extra-render.js
//      Replace the placeholder spec entry with full config:
//        {
//          id:              'slotNN',          // keep the slotNN id
//          num:             'NN',              // display badge (kept)
//          name:            'My Strategy',
//          keyaspect:       'Headline',
//          descriptor:      'One-liner.',
//          audience:        'Target client',
//          bucket:          'ordinary',         // optional — for allocator
//          shortName:       'My Strat',         // optional — chip label
//          investmentField: 'maxInvestment',    // optional — see below
//          defaults:        { ... },
//          detailRows:      [ ... ]
//        }
//      (Drop `placeholder: true` to flip the slot live.)
//
//   2. js/03-solver/calc-supplemental-extra.js
//      Add the calc fn to the _CALCS map:
//        _CALCS.slotNN = function () { ... write lastResult ... };
//
//   That's it. Registry, allocator, master solver, See Value chevron,
//   Page-5 hero numbers, and the dollar-rivalry engine all auto-light
//   up the moment the user clicks Interested + types details.
//
// `investmentField` semantics — when set, the registry uses that
// detail-field id as the "max investment" surrogate for the allocator
// when result.investment is null/undefined (i.e., math hasn't run
// yet OR the calc deliberately reports no investment because it's a
// tax-side strategy). When result.investment IS set by the calc, it
// always wins.
//
// Reading interest / result: still routes through the per-strategy
// state objects owned by supplemental-extra-render.js:
//   window.__rettSupplementalExtraInterest[id]   -> true|false|null
//   window.__rettSupplementalExtra[id].lastResult -> { netBenefit, investment, ... }

(function (root) {
  'use strict';

  if (typeof root.registerSupplemental !== 'function') return;

  // Default order base. Each registered spec gets order = base + idx
  // so the master solver list stays in spec definition order.
  var ORDER_BASE = 40;

  function _makeRegistration(spec, idx) {
    return {
      id:           spec.id,
      name:         spec.name || ('Strategy ' + spec.id),
      shortName:    spec.shortName || spec.name || spec.id,
      descriptor:   spec.descriptor || '',
      order:        (typeof spec.order === 'number') ? spec.order : (ORDER_BASE + idx),
      incomeBucket: spec.bucket || spec.incomeBucket || 'ordinary',

      // Interest is owned by supplemental-extra-render.js — it writes
      // window.__rettSupplementalExtraInterest[id] when the user hits
      // Interested / Not Interested. Returning null when the global
      // hasn't been initialized yet keeps the solver inert.
      getInterest: function () {
        var i = root.__rettSupplementalExtraInterest;
        if (!i) return null;
        return (typeof i[spec.id] === 'undefined') ? null : i[spec.id];
      },

      // Result is owned by the per-strategy calc module. Null until
      // the calc writes lastResult — master solver treats null as
      // "available: false" and the UI shows "Math pending".
      getResult: function () {
        var s = root.__rettSupplementalExtra && root.__rettSupplementalExtra[spec.id];
        return (s && s.lastResult) ? s.lastResult : null;
      },

      getNetBenefit: function (result) {
        if (!result) return 0;
        var v = Number(result.netBenefit);
        return Number.isFinite(v) ? v : 0;
      },

      // Investment for the allocator. Two-tier read:
      //   1. result.investment when the calc has run (calc decides
      //      what the right investment dollar is).
      //   2. The spec.investmentField fallback so a click on Interested
      //      lets the allocator see the user's max-investment number
      //      even before the calc completes a tick. Falls back to 0
      //      when neither is available (tax-side strategies).
      getInvestment: function (result) {
        if (result && Number.isFinite(Number(result.investment))) {
          return Number(result.investment);
        }
        var key = spec.investmentField;
        if (!key) return 0;
        var s = root.__rettSupplementalExtra && root.__rettSupplementalExtra[spec.id];
        if (!s) return 0;
        var v = Number(s[key]);
        return Number.isFinite(v) ? Math.max(0, v) : 0;
      }
    };
  }

  function _registerAll() {
    var SPECS = root.__SUPPLEMENTAL_EXTRA_SPECS;
    if (!Array.isArray(SPECS)) return;

    // Wipe any prior registrations (handles hot-reload / SPA cases
    // where this module re-runs).
    if (typeof root.unregisterSupplemental === 'function') {
      SPECS.forEach(function (spec) {
        try { root.unregisterSupplemental(spec.id); } catch (e) { /* */ }
      });
    }

    SPECS.forEach(function (spec, idx) {
      if (spec.placeholder) return;          // reserved slots are inert
      try { root.registerSupplemental(_makeRegistration(spec, idx)); }
      catch (e) { (root.reportFailure || console.warn)('register supp failed: ' + spec.id, e); }
    });
  }

  // Render module exposes __SUPPLEMENTAL_EXTRA_SPECS at load time
  // (synchronously inside its IIFE), but render LIVES in 04-ui and
  // we live in 03-solver — render hasn't run yet at our load. Defer
  // to DOMContentLoaded so the SPECS array is populated. If the
  // event already fired (late script eval), register immediately.
  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', _registerAll);
    } else {
      _registerAll();
    }
  }

  // Re-registration hook for code that hot-swaps a spec at runtime
  // (placeholder → live activation without page reload). Calling
  // this re-walks SPECS and re-registers every active entry.
  root.reregisterSupplementalExtra = _registerAll;
})(window);
