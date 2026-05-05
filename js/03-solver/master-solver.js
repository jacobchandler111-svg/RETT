// FILE: js/03-solver/master-solver.js
// Master solver — registry + combiner for supplemental strategies that
// layer on top of the user's chosen sale-side strategy on Page 5.
//
// Lego pipeline (advisor convo 2026-05-05):
//   Page 4 cards capture Interest in supplemental strategies (oil & gas
//   today; Delphi etc. coming). Each strategy module publishes its own
//   computed savings on a known global field. This file:
//     - exposes a registry so any supplemental module can self-register
//       its metadata + accessor hooks (id, name, getInterest, getResult,
//       getNetBenefit) without the master solver knowing internals.
//     - exposes runMasterSolver() that walks the registry, reads each
//       interested strategy's latest result, and returns a combined view
//       (primary + per-supplemental + combined net benefit).
//     - tracks per-strategy enabled state (Page 5 toggle on/off) so the
//       advisor can dial supplementals on and off mid-meeting and watch
//       the combined net update in real time.
//
// State globals owned here:
//   window.__rettSupplementalRegistry    — { id: spec, ... }
//   window.__rettSupplementalEnabled     — { id: true|false }  (Page-5
//                                           toggle; defaults to ON when
//                                           Page-4 interest is true)
// State globals consumed (NOT owned — managed by supplemental-render.js
// and the per-strategy calc modules):
//   window.__rettSupplementalInterest    — { id: true|false|null }
//   window.__rettSupplemental[id].lastResult — per-strategy compute output
//
// For now the combiner just SUMS. Allocation logic (e.g. when two
// strategies compete for the same investment dollar) lands here later
// — the registry shape is designed so each spec can declare which
// "income bucket" it pulls from (ordinary vs. capital), letting a
// future allocator split limited dollars optimally.

(function (root) {
  'use strict';

  var REGISTRY_KEY = '__rettSupplementalRegistry';
  var ENABLED_KEY  = '__rettSupplementalEnabled';

  function _registry() {
    if (!root[REGISTRY_KEY]) root[REGISTRY_KEY] = {};
    return root[REGISTRY_KEY];
  }
  function _enabledState() {
    if (!root[ENABLED_KEY]) root[ENABLED_KEY] = {};
    return root[ENABLED_KEY];
  }

  // Register a supplemental strategy. Spec shape:
  //   { id            — stable string used as the lookup key
  //     name          — human-readable label ("Oil & Gas Working Interest")
  //     shortName?    — terse label for chips/badges (defaults to name)
  //     descriptor?   — one-line plain-English summary
  //     order?        — sort order in lists; lower = earlier
  //     incomeBucket? — 'ordinary' | 'capital' | 'mixed' — informs the
  //                     future allocator
  //     getInterest   — () => true|false|null  (read Page-4 interest)
  //     getResult     — () => latest computed result object (or null)
  //     getNetBenefit — (result) => number   (per-strategy tax savings)
  //   }
  function registerSupplemental(spec) {
    if (!spec || typeof spec.id !== 'string' || !spec.id) return false;
    _registry()[spec.id] = spec;
    return true;
  }

  function unregisterSupplemental(id) {
    var r = _registry();
    if (id in r) { delete r[id]; return true; }
    return false;
  }

  function listSupplementals() {
    var r = _registry();
    var arr = Object.keys(r).map(function (k) { return r[k]; });
    arr.sort(function (a, b) {
      var oa = (typeof a.order === 'number') ? a.order : 99;
      var ob = (typeof b.order === 'number') ? b.order : 99;
      if (oa !== ob) return oa - ob;
      return String(a.name || '').localeCompare(String(b.name || ''));
    });
    return arr;
  }

  function getSupplemental(id) {
    return _registry()[id] || null;
  }

  // Page-5 toggle state. Defaults to ON the first time the user lands
  // on the summary with the strategy marked Interested on Page 4.
  function isSupplementalEnabled(id) {
    var en = _enabledState();
    if (typeof en[id] === 'boolean') return en[id];
    var spec = getSupplemental(id);
    if (!spec || typeof spec.getInterest !== 'function') return false;
    return spec.getInterest() === true;
  }

  function setSupplementalEnabled(id, on) {
    _enabledState()[id] = !!on;
  }

  // Walks the registry and produces a combined view for the strategy
  // summary. Caller passes the chosen-strategy net benefit (from Page-3
  // _scenarioMetrics.net). Returns:
  //   {
  //     primaryNetBenefit:        number,
  //     supplementals: [{
  //       id, name, shortName, descriptor, incomeBucket,
  //       interested:   bool,    // Page-4 interest === true
  //       enabled:      bool,    // Page-5 toggle on
  //       available:    bool,    // getResult() returned a non-null
  //       netBenefit:   number,  // per-strategy savings (0 when unavailable)
  //       result:       object,  // raw spec.getResult() output
  //     }, ...],
  //     totalSupplementalBenefit:    number,  // sum of enabled & available
  //     totalCombinedNetBenefit:     number,  // primary + total supplemental
  //     anyInterested:               bool
  //   }
  function runMasterSolver(primaryNetBenefit) {
    var primary = Number(primaryNetBenefit) || 0;
    var list = listSupplementals();
    var supplementals = list
      .map(function (spec) {
        var interest = (typeof spec.getInterest === 'function') ? spec.getInterest() : null;
        var result   = (typeof spec.getResult   === 'function') ? spec.getResult()   : null;
        var benefit  = (typeof spec.getNetBenefit === 'function')
          ? Number(spec.getNetBenefit(result)) || 0
          : 0;
        var enabled  = isSupplementalEnabled(spec.id);
        return {
          id:           spec.id,
          name:         spec.name,
          shortName:    spec.shortName || spec.name,
          descriptor:   spec.descriptor || '',
          incomeBucket: spec.incomeBucket || 'unknown',
          interested:   interest === true,
          enabled:      enabled,
          available:    !!result,
          netBenefit:   benefit,
          result:       result
        };
      })
      .filter(function (s) { return s.interested; });

    var totalSupp = supplementals
      .filter(function (s) { return s.enabled && s.available; })
      .reduce(function (sum, s) { return sum + s.netBenefit; }, 0);

    return {
      primaryNetBenefit:        primary,
      supplementals:            supplementals,
      totalSupplementalBenefit: totalSupp,
      totalCombinedNetBenefit:  primary + totalSupp,
      anyInterested:            supplementals.length > 0
    };
  }

  // Allocate dollars across the chosen Brooklyn position and any
  // enabled supplementals. The same dollar can't fund Brooklyn AND
  // Oil & Gas AND Delphi — sale proceeds are finite. This function is
  // the auditor: read the user's total available capital, walk the
  // registry for enabled supplementals, sum each one's committed
  // investment via spec.getInvestment(result), and return a tidy
  // breakdown the Implementation panel can render.
  //
  //   totalAvailable        — Page-1 Available Capital.
  //   supplementals[]       — { id, name, investment } per enabled spec.
  //   allocatedToSupplementals — sum of supplemental investments.
  //   brooklynRemaining     — totalAvailable − allocatedToSupplementals.
  //                           This is the dollar Brooklyn is ENTITLED
  //                           to deploy under correct accounting; the
  //                           engine still uses cfg.availableCapital
  //                           for now (no enforcement, just visibility).
  //   overAllocated         — true if supplementals exceed totalAvailable.
  //                           Surfaces in the Implementation panel so
  //                           the advisor can spot a broken rule.
  function runAllocator(totalAvailable) {
    var avail = Math.max(0, Number(totalAvailable) || 0);
    var list = listSupplementals();
    var supps = list
      .map(function (spec) {
        var enabled = isSupplementalEnabled(spec.id);
        var result  = (typeof spec.getResult === 'function') ? spec.getResult() : null;
        var inv = (typeof spec.getInvestment === 'function')
          ? Number(spec.getInvestment(result)) || 0
          : 0;
        return {
          id:         spec.id,
          name:       spec.name,
          shortName:  spec.shortName || spec.name,
          enabled:    enabled,
          available:  !!result,
          investment: enabled && result ? inv : 0
        };
      })
      .filter(function (s) {
        var spec = getSupplemental(s.id);
        if (!spec || typeof spec.getInterest !== 'function') return false;
        return spec.getInterest() === true;
      });
    var alloc = supps.reduce(function (sum, s) { return sum + s.investment; }, 0);
    return {
      totalAvailable:           avail,
      supplementals:            supps,
      allocatedToSupplementals: alloc,
      brooklynRemaining:        Math.max(0, avail - alloc),
      overAllocated:            alloc > avail,
      overage:                  Math.max(0, alloc - avail)
    };
  }

  // Brooklyn investment optimizer. Goal: maximize net benefit while
  // keeping cumulative short-term loss carryforward within the gain
  // the client can actually use.
  //
  // Use rule (advisor instruction 2026-05-05):
  //   - "Carryover loss should not exceed whatever their long-term
  //      gain is." Hard guardrail — don't ever recommend more Brooklyn
  //      than (current property gain + future-sale gain if planned).
  //   - "If the sale is really close to when we would be finishing this
  //      then you can have it equal the game or the expected game to
  //      wipe that out." So the cap is an UPPER bound, not an exact
  //      target — we want full absorption when feasible.
  //   - When no future sale is planned, generating loss beyond the
  //      current-year gain is largely wasted (the §1211(b) trickle is
  //      $3K/yr against ordinary, immaterial for advisory clients).
  //
  // Math (linear-loss approximation):
  //   absorbable = current LT gain + (futureSale.longTermGain if enabled)
  //   if Brooklyn cumulative loss at full investment > absorbable:
  //       scale = absorbable / lossAtFull
  //       recommendedInvestment = availableCapital * scale
  //   else: no dial-back, full investment is fine.
  //
  // Returns the diagnostic the Implementation panel renders. The
  // engine is NOT auto-rewired by this call — it's an advisory output
  // until the broader fee + scale-aware engine pass lands. Callers can
  // apply the recommendation by setting Available Capital to the
  // returned recommendedInvestment.
  function runBrooklynOptimizer(cfg, brooklynCumulativeLoss) {
    var c = cfg || {};
    var availCap = Math.max(0, Number(c.availableCapital) || 0);
    var currentLT = Math.max(0,
      (Number(c.salePrice) || 0) - (Number(c.costBasis) || 0)
      - (Number(c.acceleratedDepreciation) || 0));
    // §1250 unrecaptured-depreciation recapture is ALSO absorbable by
    // Brooklyn's short-term losses per IRC §1(h)'s 25%-bucket rule
    // (see _applyLossesToScenario / _applyLossesWithSTCfCap, where ST
    // losses absorb recapture before regular LT gain). Without this
    // line, the optimizer dialed Brooklyn back too aggressively for
    // any client with accelerated depreciation — leaving recapture
    // exposed to the §1250 25% cap rate when extra Brooklyn loss
    // could have shielded it.
    var currentRecap = Math.max(0, Number(c.acceleratedDepreciation) || 0);
    var future = (c.futureSale && c.futureSale.enabled) ? c.futureSale : null;
    var futureLT = future ? Math.max(0, Number(future.longTermGain) || 0) : 0;
    var futureRecap = future
      ? Math.max(0, Number(future.acceleratedDepreciation) || 0) : 0;
    var absorbable = currentLT + currentRecap + futureLT + futureRecap;

    var lossAtFull = Math.max(0, Number(brooklynCumulativeLoss) || 0);
    var dialBack = false;
    var scale = 1;
    var reason = 'no-action';

    if (lossAtFull > 0 && lossAtFull > absorbable && absorbable > 0) {
      scale = absorbable / lossAtFull;
      dialBack = true;
      reason = future
        ? 'loss-exceeds-current-and-future-gain'
        : 'loss-exceeds-current-gain';
    } else if (lossAtFull > 0 && absorbable === 0) {
      // No gain to absorb anywhere. Keep at full investment — this is
      // a deliberate choice the user made (they bought Brooklyn). Flag
      // as "wasted" so the panel can still surface the warning.
      dialBack = false;
      reason = 'no-absorbable-gain';
    } else if (lossAtFull <= absorbable) {
      reason = 'loss-within-absorbable-gain';
    }

    return {
      availableCapital:        availCap,
      currentLTGain:           currentLT,
      currentRecapture:        currentRecap,
      futureLTGain:            futureLT,
      futureRecapture:         futureRecap,
      futureSaleEnabled:       !!future,
      totalAbsorbableGain:     absorbable,
      brooklynLossAtFull:      lossAtFull,
      dialBack:                dialBack,
      recommendedScale:        scale,
      recommendedInvestment:   Math.round(availCap * scale),
      excessLossAtFull:        Math.max(0, lossAtFull - absorbable),
      reason:                  reason
    };
  }

  // Wipe the Page-5 enabled override for a single supplemental, so the
  // next render falls back to the default-on rule (enabled iff Interest
  // is true). Used to fix two bugs that share the same root cause:
  //   (a) user toggles off on Page 5 → unmarks Interested on Page 4 →
  //       re-marks Interested. Expected: toggle ON (fresh start).
  //   (b) loading a different client carries over the prior client's
  //       OFF toggle, even though the new client never toggled it.
  // Both reset to the right behavior by clearing enabled[id] whenever
  // interest is changed on Page 4 (or the form is cleared).
  function resetEnabledOverride(id) {
    var en = _enabledState();
    if (id == null) {
      // Clear all — used on form reset.
      Object.keys(en).forEach(function (k) { delete en[k]; });
      return;
    }
    if (id in en) delete en[id];
  }

  // Listen for Page-4 Interested/Not-Interested clicks (event delegation
  // on document). The supplemental-render.js card uses
  // [data-supp-pick-action] / [data-supp-pick-target]; we read the
  // target id and clear the corresponding enabled override. Doesn't
  // require modifying supplemental-render.js — purely additive.
  if (typeof document !== 'undefined') {
    document.addEventListener('click', function (ev) {
      var t = ev.target;
      var btn = t && t.closest && t.closest('[data-supp-pick-action]');
      if (!btn) return;
      var id = btn.getAttribute('data-supp-pick-target');
      if (id) resetEnabledOverride(id);
    }, true);
  }

  root.registerSupplemental         = registerSupplemental;
  root.unregisterSupplemental       = unregisterSupplemental;
  root.listSupplementals            = listSupplementals;
  root.getSupplemental              = getSupplemental;
  root.isSupplementalEnabled        = isSupplementalEnabled;
  root.setSupplementalEnabled       = setSupplementalEnabled;
  root.resetSupplementalEnabledOverride = resetEnabledOverride;
  root.runMasterSolver              = runMasterSolver;
  root.runAllocator                 = runAllocator;
  root.runBrooklynOptimizer         = runBrooklynOptimizer;
})(window);
