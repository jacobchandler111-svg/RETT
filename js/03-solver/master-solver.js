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

  // Rivalry optimizer — for each Interested supplemental, compare its
  // net-benefit-per-dollar against Brooklyn's net-benefit-per-dollar at
  // full Available Capital. Greedy-allocate from highest rate down,
  // capped at availableCapital. Strategies that lose to Brooklyn (or
  // run out of remaining capital, or have no computed result) get
  // granted: 0 — i.e., the dollar stays in Brooklyn rather than chasing
  // a worse marginal return.
  //
  // Why this exists: the advisor model is "every dollar belongs in the
  // strategy with the highest tax-savings yield." Without rivalry the
  // page summed Brooklyn-net + each supp's gross-tax-savings, which
  // displayed positive net benefit even when the supplemental lost to
  // Brooklyn dollar-for-dollar — flipping a "don't fund" decision into
  // a "looks like a small win" presentation bug.
  //
  // Brooklyn's yield is computed from a one-shot engine call at full
  // availCap (no supp deduction). The supp's yield is netBenefit (now
  // properly net of management fees per supplemental-defaults.js fix)
  // divided by its committed investment. Both rates are roughly linear
  // within their useful ranges, so a single-rate comparison is correct.
  function _computeRivalryDecisions(cfg) {
    cfg = cfg || {};
    var avail = Math.max(0, Number(cfg.availableCapital) || 0);

    var brooklynYieldRate = 0;
    if (avail > 0 && typeof root.unifiedTaxComparison === 'function') {
      try {
        var bCfg = Object.assign({}, cfg);
        bCfg.availableCapital = avail;
        bCfg.investment = avail;
        bCfg.investedCapital = avail;
        if (typeof root.rettFlavorEngineCfg === 'function') {
          bCfg = root.rettFlavorEngineCfg(bCfg);
        }
        var b = root.unifiedTaxComparison(bCfg) || {};
        var bSavings = Number(b.totalSavings) || 0;
        var bFees = Number(b.totalAllFees);
        if (!Number.isFinite(bFees)) {
          bFees = (Number(b.totalFees) || 0) + (Number(b.totalBrookhavenFees) || 0);
        }
        brooklynYieldRate = (bSavings - bFees) / avail;
      } catch (e) { /* fall through to 0 */ }
    }

    var list = listSupplementals();
    var candidates = list
      .filter(function (spec) {
        // Page-4 Interested gate: skip strategies the user hasn't opted into.
        if (typeof spec.getInterest !== 'function' || spec.getInterest() !== true) return false;
        // Page-5 enable toggle: when the advisor flips a strategy off mid-
        // meeting, its dollars must free up immediately and flow back to
        // Brooklyn (or to the next-best supp). Without this check, the
        // rivalry would still fund a Page-5-disabled strategy.
        if (!isSupplementalEnabled(spec.id)) return false;
        return true;
      })
      .map(function (spec) {
        var result = (typeof spec.getResult === 'function') ? spec.getResult() : null;
        var net = (typeof spec.getNetBenefit === 'function')
          ? Number(spec.getNetBenefit(result)) || 0 : 0;
        var inv = (typeof spec.getInvestment === 'function')
          ? Number(spec.getInvestment(result)) || 0 : 0;
        var rate = (inv > 0) ? net / inv : 0;
        return { id: spec.id, available: !!result, investment: inv, netBenefit: net, rate: rate };
      });

    candidates.sort(function (a, b) { return b.rate - a.rate; });

    var decisions = {};
    var remaining = avail;
    candidates.forEach(function (c) {
      if (!c.available || c.investment <= 0) {
        decisions[c.id] = { funded: false, reason: 'no-result-or-zero',
          granted: 0, rate: c.rate, brooklynRate: brooklynYieldRate,
          netBenefit: c.netBenefit, requested: c.investment };
      } else if (c.rate <= 0) {
        // Hard rule (advisor 2026-05-06): never deploy a dollar whose
        // marginal net-of-fee yield is non-positive. Money sits free.
        decisions[c.id] = { funded: false, reason: 'negative-net',
          granted: 0, rate: c.rate, brooklynRate: brooklynYieldRate,
          netBenefit: c.netBenefit, requested: c.investment };
      } else if (c.rate <= brooklynYieldRate) {
        decisions[c.id] = { funded: false, reason: 'brooklyn-beats',
          granted: 0, rate: c.rate, brooklynRate: brooklynYieldRate,
          netBenefit: c.netBenefit, requested: c.investment };
      } else if (c.investment > remaining) {
        decisions[c.id] = { funded: false, reason: 'capital-exhausted',
          granted: 0, rate: c.rate, brooklynRate: brooklynYieldRate,
          netBenefit: c.netBenefit, requested: c.investment };
      } else {
        decisions[c.id] = { funded: true, reason: 'beats-brooklyn',
          granted: c.investment, rate: c.rate, brooklynRate: brooklynYieldRate,
          netBenefit: c.netBenefit, requested: c.investment };
        remaining -= c.investment;
      }
    });

    return { decisions: decisions, brooklynRate: brooklynYieldRate, capitalRemaining: remaining };
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
  //       rivalry:      object,  // { funded, reason, granted, rate, brooklynRate }
  //     }, ...],
  //     totalSupplementalBenefit:    number,  // sum of FUNDED & enabled supps
  //     totalCombinedNetBenefit:     number,  // primary + total supplemental
  //     anyInterested:               bool,
  //     rivalry: { decisions, brooklynRate, capitalRemaining }
  //   }
  function runMasterSolver(primaryNetBenefit) {
    var primary = Number(primaryNetBenefit) || 0;
    var list = listSupplementals();

    // Pull live cfg so the rivalry can compute Brooklyn's yield rate.
    var cfg = (typeof root.collectInputs === 'function') ? root.collectInputs() : null;
    var rivalry = _computeRivalryDecisions(cfg || {});

    var supplementals = list
      .map(function (spec) {
        var interest = (typeof spec.getInterest === 'function') ? spec.getInterest() : null;
        var result   = (typeof spec.getResult   === 'function') ? spec.getResult()   : null;
        var benefit  = (typeof spec.getNetBenefit === 'function')
          ? Number(spec.getNetBenefit(result)) || 0
          : 0;
        var enabled  = isSupplementalEnabled(spec.id);
        var rDecision = rivalry.decisions[spec.id] || null;
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
          result:       result,
          rivalry:      rDecision
        };
      })
      .filter(function (s) { return s.interested; });

    // Combined net only counts FUNDED supps. Strategies that lose to
    // Brooklyn (rivalry says brooklyn-beats) contribute zero — the
    // dollar stays with Brooklyn instead.
    var totalSupp = supplementals
      .filter(function (s) {
        return s.enabled && s.available && s.rivalry && s.rivalry.funded;
      })
      .reduce(function (sum, s) { return sum + s.netBenefit; }, 0);

    return {
      primaryNetBenefit:        primary,
      supplementals:            supplementals,
      totalSupplementalBenefit: totalSupp,
      totalCombinedNetBenefit:  primary + totalSupp,
      anyInterested:            supplementals.length > 0,
      rivalry:                  rivalry
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

    // Build a cfg snapshot that the rivalry optimizer can use to
    // compute Brooklyn's per-dollar yield. collectInputs is the same
    // reader buildInterestedSummary uses — lives on window.
    var cfg = (typeof root.collectInputs === 'function') ? root.collectInputs() : null;
    if (cfg) cfg.availableCapital = avail;
    var rivalry = _computeRivalryDecisions(cfg || { availableCapital: avail });

    var list = listSupplementals();
    var supps = list
      .map(function (spec) {
        var enabled = isSupplementalEnabled(spec.id);
        var result  = (typeof spec.getResult === 'function') ? spec.getResult() : null;
        var requested = (typeof spec.getInvestment === 'function')
          ? Number(spec.getInvestment(result)) || 0
          : 0;
        var rDecision = rivalry.decisions[spec.id] || null;
        // Allocator's "investment" is the FUNDED amount post-rivalry.
        // If rivalry zeros the supp, no dollars come out of Brooklyn's
        // pool for it — Brooklyn keeps its full availCap.
        var fundedInv = (enabled && result && rDecision && rDecision.funded)
          ? rDecision.granted : 0;
        return {
          id:         spec.id,
          name:       spec.name,
          shortName:  spec.shortName || spec.name,
          enabled:    enabled,
          available:  !!result,
          investment: fundedInv,
          requested:  requested,
          rivalry:    rDecision
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
      overage:                  Math.max(0, alloc - avail),
      rivalry:                  rivalry
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
    // Future-sale absorption is OPT-IN (advisor 2026-05-06). By default
    // Brooklyn sizes only for the current sale's absorbable gain. The
    // user clicks Apply on the Future Sale callout (Page 5) to flip
    // __rettAbsorbFutureSale, which adds future LT + recapture into the
    // cap and triggers a pipeline rerun. Without the flag, today's "I
    // already include future-sale" behavior would over-deploy Brooklyn
    // for clients who haven't agreed to absorb the future sale yet.
    var absorbFuture = !!root.__rettAbsorbFutureSale;
    var futureLT = (future && absorbFuture) ? Math.max(0, Number(future.longTermGain) || 0) : 0;
    var futureRecap = (future && absorbFuture)
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
      futureSaleAbsorbing:     !!(future && absorbFuture),
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
