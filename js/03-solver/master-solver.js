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

  // ---- Shared ordinary-income pool saturation ----------------------
  // Several supplementals offset the SAME finite Year-0 ordinary income:
  // Oil & Gas (IDC), Equipment Leasing (slot07), Farm §179 (slot12),
  // Augusta rent (slot08), PTET entity tax, and Delphi's ordinary
  // recharacterization. Each calc independently caps its own deduction
  // at the FULL pool, and the solver used to SUM their net benefits — so
  // stacking two that each absorb the whole pool double-counted the same
  // income (Strategy Summary net overstated ~2.5x when several stack).
  //
  // Fix: treat the Year-0 ordinary income as one shared pool and allocate
  // it across the funded ord-offset supps BEST-FIRST (highest realized $
  // saved per $ of deduction). Each supp earns its per-dollar rate only on
  // the deduction it actually receives; once the pool is exhausted the
  // next supp realizes ~$0. That both removes the double-count and picks
  // the best combination (high-rate Farm/Equipment/Oil&Gas win the pool;
  // low-rate Delphi/PTET get crowded out when capital is the constraint).
  function _y0OrdPool(cfg) {
    if (!cfg) return 0;
    return Math.max(0,
      (Number(cfg.baseOrdinaryIncome) || 0) +
      (Number(cfg.acceleratedDepreciation) || 0));
  }
  // Extract the Y0-only tax savings from a supp's result. Multi-year
  // recurring supps (PTET/Augusta/charitable/401k) report netBenefit =
  // benY0 + benRest×(yearCount-1), but the saturation pool is Y0-only —
  // so the rate calc must use the Y0 slice, not the multi-year sum.
  // Without this split, PTET/Augusta crowded out single-year supps with
  // higher TRUE Y0 yields (rate was inflated by ~yearCount×).
  // Audit 2026-06-08 findings #2 + #5.
  function _y0NetOf(result) {
    if (!result) return 0;
    var d  = result.detail || {};
    var py = result.perYear;
    // perYear shape (Oil & Gas, sometimes Delphi): first-year totalSaved.
    if (Array.isArray(py) && py[0] && py[0].totalSaved != null) {
      return Math.max(0, Number(py[0].totalSaved) || 0);
    }
    // Multi-year recurring (PTET/Augusta/charitable/401k): explicit Y0 field.
    if (d.taxSavingsY0 != null) {
      return Math.max(0, Number(d.taxSavingsY0) || 0);
    }
    // Single-year fallback: full netBenefit is Y0.
    return Math.max(0, Number(result.netBenefit) || 0);
  }

  // Per-supp ordinary-deduction demand + realized per-dollar rate.
  // `demand` is the supp's UNCAPPED desired ordinary offset; `rate` is the
  // $ saved per $ of deduction it actually realized AT Y0 ONLY. `restNet`
  // is the supp's Y1+ tax savings, which pass through saturation untouched
  // (each future year has its own pool, independent of Y0's). Returns
  // null for supps that don't offset ordinary income (they keep full net).
  function _ordInfoOf(id, result, net) {
    if (!result) return null;
    var d = result.detail || {};
    var al = result.allocations || {};
    var py = (Array.isArray(result.perYear) && result.perYear[0]) || {};
    var demand = 0, basis = 0;
    if (id === 'oilGas') {
      demand = Number(py.deduction) || Number(py.absorbed) || 0;
      basis  = Number(py.absorbed) || demand;
    } else if (id === 'delphi') {
      // When Delphi is multi-year, allocations.ordinaryExpense is the
      // SUM across years but the Y0 ord-offset pool only cares about Y0.
      // Read perYear[0].ordExpense when present (multi-year path); fall
      // back to allocations.ordinaryExpense for single-year deployments.
      // Audit R2 finding #2: prior version used the sum, which (a)
      // understated Delphi's rate by ~yearCount× — sinking it in the
      // rate-sorted order — and (b) inflated its demand, over-claiming
      // the Y0 pool and starving other ord-offset supps.
      var _delphiY0Ord = (Array.isArray(result.perYear) && result.perYear[0]
        && result.perYear[0].ordExpense != null)
        ? Number(result.perYear[0].ordExpense) || 0
        : Number(al.ordinaryExpense) || 0;
      demand = _delphiY0Ord; basis = _delphiY0Ord;
    } else if (id === 'ptet') {
      demand = Number(d.ordOffsetY0) || 0; basis = demand;
    } else if (id === 'slot07') {
      demand = Number(d.nonPassiveUncapped) || Number(d.nonPassive) || 0;
      basis  = Number(d.nonPassive) || demand;
    } else if (id === 'slot08') {
      demand = Number(d.ordOffsetY0) || Number(d.businessRent) || 0; basis = demand;
    } else if (id === 'slot12') {
      demand = Number(d.totalUncapped) || Number(d.total) || 0;
      basis  = Number(d.total) || demand;
    } else if (id === 'charitableGifts') {
      // Charitable gift cash + appreciated-asset ord deduction.
      // Engine writes detail.deductibleAmount (capped at AGI %) and
      // detail.ordOffsetY0 (the Y0 deductible slice). Audit 2026-06-08:
      // previously fell through to else→null, bypassing saturation.
      demand = Number(d.deductibleAmount) || Number(d.ordOffsetY0) || 0;
      basis  = Number(d.ordOffsetY0)     || demand;
    } else if (id === 'slot09') {
      // 401(k) + profit-sharing reduces W-2/SE income by total contribution.
      demand = Number(d.ordOffsetY0) || Number(d.totalContribution) || 0;
      basis  = Number(d.ordOffsetY0) || demand;
    } else if (id === 'slot10') {
      // Aircraft §168 bonus / ADS depreciation on bizUse-qualified cost.
      demand = Number(d.yr1DeductionUncapped) || Number(d.yr1Deduction) || 0;
      basis  = Number(d.yr1Deduction)         || demand;
    } else if (id === 'slot11') {
      // STR loophole — non-passive year-1 cost-seg deduction.
      demand = Number(d.year1DeductionUncapped) || Number(d.year1Deduction) || 0;
      basis  = Number(d.year1Deduction)         || demand;
    } else {
      return null;
    }
    if (demand <= 0 || basis <= 0) return null;
    var y0Net   = _y0NetOf(result);
    var fullNet = Math.max(0, Number(net) || 0);
    var restNet = Math.max(0, fullNet - y0Net);  // Y1+ pass-through
    return {
      demand:  demand,
      rate:    y0Net / basis,   // Y0-only rate (not multi-year inflated)
      restNet: restNet           // never saturated — each future year has its own pool
    };
  }
  // Allocate the shared Y0 ordinary pool across funded supps best-first.
  // Input items: [{ id, netBenefit, ordInfo }]. Returns
  //   { total, realized: { id -> realizedNet } }.
  // Supps with no ordInfo keep their full net (they don't touch the pool).
  //
  // Multi-year supps: only their Y0 component is rationed against the Y0
  // ord pool; their Y1+ benefit (restNet) is added back unchanged because
  // each future year has its own independent ordinary income pool. Prior
  // behavior wiped Y1+ proportionally to Y0 crowding — caught in audit
  // 2026-06-08 finding #5.
  function _saturateOrdinary(items, pool) {
    var realized = {};
    // Track Y0 vs rest separately so per-year displays can scale only Y0
    // (Y1+ passes through unscaled — audit R2 #5). realizedDetail[id] =
    // { y0, rest, y0Demand, rate }. Consumers downstream (temp-page-
    // render) can read y0SaturationScale = y0/(y0Demand*rate) to scale
    // Y0 specifically, leaving Y1+ at full value.
    var realizedDetail = {};
    var ordList = [];
    items.forEach(function (s) {
      if (s.ordInfo) ordList.push(s);
      else {
        realized[s.id] = Math.round(Number(s.netBenefit) || 0);
        realizedDetail[s.id] = { y0: realized[s.id], rest: 0, y0Demand: 0, rate: 0 };
      }
    });
    // Sort by Y0 rate descending; on a rate tie, prefer the supp with
    // SMALLER restNet (single-year supps get first dibs on the pool —
    // a multi-year supp with restNet > 0 can still realize its Y1+
    // benefit even if Y0 is fully crowded out, while a single-year
    // supp with restNet=0 loses everything). Audit R2 finding #10.
    ordList.sort(function (a, b) {
      var d = b.ordInfo.rate - a.ordInfo.rate;
      if (d !== 0) return d;
      return (a.ordInfo.restNet || 0) - (b.ordInfo.restNet || 0);
    });
    var remaining = Math.max(0, Number(pool) || 0);
    ordList.forEach(function (s) {
      var take = Math.min(s.ordInfo.demand, remaining);
      var realized_y0 = take * s.ordInfo.rate;
      var rest        = s.ordInfo.restNet || 0;
      realized[s.id] = Math.round(realized_y0 + rest);
      realizedDetail[s.id] = {
        y0:        realized_y0,
        rest:      rest,
        y0Demand:  s.ordInfo.demand,
        rate:      s.ordInfo.rate
      };
      remaining -= take;
    });
    var total = 0;
    Object.keys(realized).forEach(function (k) { total += realized[k]; });
    return { total: Math.round(total), realized: realized, detail: realizedDetail };
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
        return { id: spec.id, available: !!result, investment: inv, netBenefit: net, rate: rate,
                 ordInfo: _ordInfoOf(spec.id, result, net) };
      });

    // Shared Y0 ordinary-income pool — the rival subset objective below is
    // saturation-aware so it won't commit capital to an ord-offset supp
    // that would be crowded out of the pool (realizing ~$0 for real
    // dollars deployed). `alwaysOnOrd` are the investment-free supps
    // (PTET / Augusta) that are funded unconditionally but still draw from
    // the shared pool, so every subset's saturation must include them.
    var ordPool = _y0OrdPool(cfg);
    var alwaysOnOrd = [];

    var decisions = {};

    // First pass — non-rival classifications. These don't depend on the
    // subset choice and can be assigned directly:
    //   - !available: no result yet
    //   - investment === 0 with positive net: free benefit (always funded)
    //   - investment === 0 with non-positive net: nothing to fund
    //   - positive investment with rate <= 0: hard-rule rejection (negative-net)
    //   - positive investment with 0 < rate <= brooklynRate: 'brooklyn-beats'
    // Anything else goes into `rivals` and competes in subset selection.
    var rivals = [];
    candidates.forEach(function (c) {
      if (!c.available) {
        decisions[c.id] = { funded: false, reason: 'no-result-or-zero',
          granted: 0, rate: c.rate, brooklynRate: brooklynYieldRate,
          netBenefit: c.netBenefit, requested: c.investment };
      } else if (c.investment <= 0) {
        if (c.netBenefit > 0) {
          decisions[c.id] = { funded: true, reason: 'free-benefit',
            granted: 0, rate: 0, brooklynRate: brooklynYieldRate,
            netBenefit: c.netBenefit, requested: 0 };
          // Investment-free but still consumes the shared ordinary pool.
          if (c.ordInfo) alwaysOnOrd.push({ id: c.id, netBenefit: c.netBenefit, ordInfo: c.ordInfo });
        } else {
          decisions[c.id] = { funded: false, reason: 'no-result-or-zero',
            granted: 0, rate: c.rate, brooklynRate: brooklynYieldRate,
            netBenefit: c.netBenefit, requested: c.investment };
        }
      } else if (c.rate <= 0) {
        decisions[c.id] = { funded: false, reason: 'negative-net',
          granted: 0, rate: c.rate, brooklynRate: brooklynYieldRate,
          netBenefit: c.netBenefit, requested: c.investment };
      } else if (c.rate <= brooklynYieldRate) {
        decisions[c.id] = { funded: false, reason: 'brooklyn-beats',
          granted: 0, rate: c.rate, brooklynRate: brooklynYieldRate,
          netBenefit: c.netBenefit, requested: c.investment };
      } else {
        rivals.push(c);
      }
    });

    // Subset selection across rivals. Greedy-by-rate fails the knapsack
    // case (Monte Carlo run 2026-05-06 found greedy suboptimal in 6% of
    // random scenarios, leaving up to $1.9M on the table). Exhaustive
    // search over 2^k subsets is fast for our scale (typically k ≤ 4,
    // and the registry is unlikely to grow past 12 rivals at once).
    //
    // Objective per subset S: sum(S.net) - sum(S.inv) * brooklynRate.
    // Equivalent to maximizing total combined net under linear Brooklyn,
    // since `avail * brooklynRate` is a constant across subsets.
    // Constraint: sum(S.inv) ≤ avail.
    //
    // Tie-breaker: among subsets with identical objective, prefer the
    // one with smaller total investment (frees more capital, simpler
    // implementation for the advisor).
    var k = rivals.length;
    var bestMask = 0;
    var bestInv = 0;
    // Baseline: fund no rivals — Brooklyn keeps all capital and only the
    // investment-free pool supps realize benefit. Any rival subset must
    // beat this saturated baseline net of the capital it pulls.
    var bestObj = _saturateOrdinary(alwaysOnOrd, ordPool).total;
    if (k > 0 && k <= 20) {
      var subsetCount = 1 << k;
      for (var m = 1; m < subsetCount; m++) {
        var sumInv = 0;
        var items = alwaysOnOrd.slice();
        for (var i = 0; i < k; i++) {
          if ((m >> i) & 1) {
            sumInv += rivals[i].investment;
            items.push({ id: rivals[i].id, netBenefit: rivals[i].netBenefit, ordInfo: rivals[i].ordInfo });
          }
        }
        if (sumInv > avail) continue;
        // Saturation-aware combined supp net for this subset (shared pool
        // allocated best-first), minus the Brooklyn yield foregone on the
        // capital the subset pulls. A crowded-out ord supp adds ~$0
        // saturated net but costs sumInv*brooklynRate, so it loses here.
        var sumNet = _saturateOrdinary(items, ordPool).total;
        var obj = sumNet - sumInv * brooklynYieldRate;
        if (obj > bestObj || (obj === bestObj && sumInv < bestInv)) {
          bestObj = obj;
          bestMask = m;
          bestInv = sumInv;
        }
      }
    } else if (k > 20) {
      // Fallback for absurdly large rival sets — exhaustive blows up
      // beyond 2^20 = 1M iterations. Greedy by rate is the safety net;
      // keep the existing behavior (suboptimal but bounded). Logging
      // so we know if the registry ever ships at this scale.
      if (typeof console !== 'undefined' && console.warn) {
        console.warn('rivalry: ' + k + ' rivals exceeds exhaustive search budget — falling back to greedy');
      }
      var sortedIdx = rivals.map(function (_, i) { return i; })
        .sort(function (a, b) { return rivals[b].rate - rivals[a].rate; });
      var remGreedy = avail;
      sortedIdx.forEach(function (i) {
        if (rivals[i].investment <= remGreedy) {
          bestMask |= (1 << i);
          remGreedy -= rivals[i].investment;
        }
      });
    }

    // cfg._forceDisabledSupps: { id: true } — let upstream callers force
    // specific rivals to funded=false (used by buildInterestedSummary's
    // combined-net drop-one verification, where the FULL pipeline cost
    // of recognizing Y0 gain to fund a supp is computed and compared).
    // Mark forced-disabled supps with reason 'forced-disabled' so
    // downstream consumers know it's an upstream override, not rivalry.
    var _forceDisabled = (cfg && cfg._forceDisabledSupps) || {};
    if (Object.keys(_forceDisabled).length > 0) {
      var origMask = bestMask;
      var maskOut = 0;
      for (var fi = 0; fi < k; fi++) {
        if (!((origMask >> fi) & 1)) continue;
        if (_forceDisabled[rivals[fi].id]) continue;
        maskOut |= (1 << fi);
      }
      bestMask = maskOut;
      bestInv = 0;
      for (var fri = 0; fri < k; fri++) {
        if ((bestMask >> fri) & 1) bestInv += rivals[fri].investment;
      }
    }

    // Assign decisions to rivals based on the selected subset.
    rivals.forEach(function (c, i) {
      if ((bestMask >> i) & 1) {
        decisions[c.id] = { funded: true, reason: 'beats-brooklyn',
          granted: c.investment, rate: c.rate, brooklynRate: brooklynYieldRate,
          netBenefit: c.netBenefit, requested: c.investment };
      } else if (_forceDisabled[c.id]) {
        // Upstream caller (buildInterestedSummary drop-one verification)
        // determined this supp's marginal combined-net contribution was
        // negative when the full B/C down-payment recognition cost is
        // included. Distinct from 'capital-exhausted' (knapsack-bound).
        decisions[c.id] = { funded: false, reason: 'drop-one-verified',
          granted: 0, rate: c.rate, brooklynRate: brooklynYieldRate,
          netBenefit: c.netBenefit, requested: c.investment };
      } else {
        // Beat Brooklyn standalone but excluded from the optimum subset
        // because including it would have displaced a better combination
        // (knapsack constraint). Reason 'capital-exhausted' captures the
        // user-visible meaning: there weren't enough dollars left for it.
        decisions[c.id] = { funded: false, reason: 'capital-exhausted',
          granted: 0, rate: c.rate, brooklynRate: brooklynYieldRate,
          netBenefit: c.netBenefit, requested: c.investment };
      }
    });

    var remaining = avail - bestInv;
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
  function runMasterSolver(primaryNetBenefit, opts) {
    var primary = Number(primaryNetBenefit) || 0;
    var list = listSupplementals();

    // Pull live cfg so the rivalry can compute Brooklyn's yield rate.
    // opts.forceDisabledSupps lets buildInterestedSummary's drop-one
    // verification pin specific rivals to funded=false for a counter-
    // factual evaluation (audit handoff Bug A).
    var cfg = (typeof root.collectInputs === 'function') ? root.collectInputs() : null;
    cfg = cfg || {};
    if (opts && opts.forceDisabledSupps) {
      cfg = Object.assign({}, cfg, { _forceDisabledSupps: opts.forceDisabledSupps });
    }
    var rivalry = _computeRivalryDecisions(cfg);

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
    //
    // Shared ordinary-income pool: the funded ord-offset supps don't get
    // to each independently claim the full Y0 ordinary income. Saturate
    // the shared pool best-first so the total reflects what's actually
    // realizable (no double-count), and annotate each supp with its
    // realized benefit so downstream consumers report the same figure.
    var fundedSupps = supplementals.filter(function (s) {
      return s.enabled && s.available && s.rivalry && s.rivalry.funded;
    });
    var sat = _saturateOrdinary(
      fundedSupps.map(function (s) {
        return { id: s.id, netBenefit: s.netBenefit,
                 ordInfo: _ordInfoOf(s.id, s.result, s.netBenefit) };
      }),
      _y0OrdPool(cfg)
    );
    supplementals.forEach(function (s) {
      s.realizedNetBenefit = Object.prototype.hasOwnProperty.call(sat.realized, s.id)
        ? sat.realized[s.id]
        : 0;
      // Legacy single-scalar scale (kept for back-compat consumers).
      s.saturationScale = (Number(s.netBenefit) > 0)
        ? (s.realizedNetBenefit / s.netBenefit)
        : (s.realizedNetBenefit > 0 ? 1 : 0);
      // Per-year split: Y0 may be saturated (scaled down) but Y1+
      // passes through unchanged. Consumers (temp-page-render) should
      // apply y0SaturationScale ONLY to perYear[0] and y1PlusSaturation
      // Scale (=1) to perYear[1..]. Audit R2 #5: prior single-scalar
      // application mis-attributed dollars across years on clipped
      // supps (Y0 over-displayed, Y1+ under-displayed).
      var det = sat.detail && sat.detail[s.id];
      if (det && det.y0Demand > 0 && det.rate > 0) {
        var y0FullNet = det.y0Demand * det.rate;
        s.y0SaturationScale = y0FullNet > 0 ? (det.y0 / y0FullNet) : 1;
      } else {
        s.y0SaturationScale = 1;
      }
      s.y1PlusSaturationScale = 1;  // Y1+ never saturated by Y0 pool
    });
    var totalSupp = sat.total;

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
  //                           to deploy AFTER supps reserve their share —
  //                           it is NOT the post-optimizer deployment.
  //                           runFullPipeline (controls.js) feeds this
  //                           value into the engine as cfg.investment, and
  //                           runBrooklynOptimizer THEN dials it back when
  //                           cumulative Brooklyn loss exceeds absorbable
  //                           gain or marginal net would be negative.
  //                           The actual deployment lives at
  //                           __lastResult.config.investment (Path 2)
  //                           after the optimizer has run. The Page-5
  //                           hero reads from the per-strategy entry's
  //                           metrics (Path 1, set in
  //                           buildInterestedSummary), which can pick a
  //                           different optimizer-applied combo than
  //                           Path 2 — that divergence is documented in
  //                           project-rett-audit-findings.md.
  //
  //                           DO NOT use brooklynRemaining as a proxy for
  //                           "how much Brooklyn actually deployed" — it
  //                           is the PRE-OPTIMIZER capacity. To check
  //                           actual deployment in a probe, read
  //                           __lastResult.config.investment or
  //                           buildInterestedSummary().entries[i]._opt
  //                           .recommendedInvestment.
  //   overAllocated         — true if supplementals exceed totalAvailable.
  //                           Surfaces in the Implementation panel so
  //                           the advisor can spot a broken rule.
  function runAllocator(totalAvailable, opts) {
    var avail = Math.max(0, Number(totalAvailable) || 0);

    // Build a cfg snapshot that the rivalry optimizer can use to
    // compute Brooklyn's per-dollar yield. collectInputs is the same
    // reader buildInterestedSummary uses — lives on window.
    // opts.forceDisabledSupps lets the combined-net drop-one verification
    // pin specific rivals to funded=false so the allocator reports the
    // reduced supp Y0 deployment for that counterfactual.
    var cfg = (typeof root.collectInputs === 'function') ? root.collectInputs() : null;
    cfg = cfg || { availableCapital: avail };
    cfg.availableCapital = avail;
    if (opts && opts.forceDisabledSupps) {
      cfg = Object.assign({}, cfg, { _forceDisabledSupps: opts.forceDisabledSupps });
    }
    var rivalry = _computeRivalryDecisions(cfg);

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
  function runBrooklynOptimizer(cfg, brooklynCumulativeLoss, brooklynNetAtFull) {
    var c = cfg || {};
    var availCap = Math.max(0, Number(c.availableCapital) || 0);
    // Q2: subtract shortTermPropertyGain — properties the user marked
    // held < 1 year route to ST and don't count as LT-absorbable gain.
    var currentLT = Math.max(0,
      (Number(c.salePrice) || 0) - (Number(c.costBasis) || 0)
      - (Number(c.acceleratedDepreciation) || 0)
      - (Number(c.shortTermPropertyGain) || 0));
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
    // Future-sale handling (advisor 2026-05-27): the engine does NOT
    // model the future-sale year. Adding futureGain into `absorbable`
    // would expand Brooklyn's optimizer cap (less dial-back, more
    // deployment, more fees) without simulating the offsetting future
    // savings — net result was strategies showing LOWER nets when
    // __rettAbsorbFutureSale was set, the opposite of user intent.
    //
    // Page 6 (strategy-summary-render.js _renderFutureSaleOption)
    // computes the analytical "if you size Brooklyn up to also absorb
    // the future sale, here's the additional fees + savings + net"
    // independently. That callout is the authoritative source of
    // truth for future-sale impact. The optimizer here stays focused
    // on the current sale; the flag is preserved for callout framing
    // (Apply vs Another Option) but no longer changes the cap.
    var futureGain = 0;
    var absorbable = currentLT + currentRecap;

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

    var recommendedInvestment = Math.round(availCap * scale);

    // Positive-net gate (advisor principle 2026-05-06):
    //   "A dollar only deploys — Brooklyn OR any supplemental — if its
    //    marginal net-of-fee benefit is strictly > 0."
    // The absorbable-gain check above only verifies CAPACITY (loss fits
    // within available gain). It does NOT verify ECONOMICS (savings >
    // fees). When availableCapital is small relative to the Brookhaven
    // flat-fee floor (or when ordinary income is low so the marginal
    // tax-savings rate is small), Brooklyn can pass the absorbable check
    // and still produce negative net — fees > savings. The rivalry's
    // 'negative-net' rule already prevents supplementals from deploying
    // into a fee trap; this is the symmetric Brooklyn-side rule.
    //
    // Probe order:
    //   1) When `brooklynNetAtFull` is positive, the dialed-back version is
    //      guaranteed to be positive too — proportional capital scaling
    //      trims fees while savings stay capped at absorbable × marginal.
    //      Skip the probe entirely.
    //   2) When `brooklynNetAtFull` is unknown or non-positive, run the
    //      targeted unifiedTaxComparison probe at the dial-back amount
    //      to verify economics at the new deployment size.
    //
    // Audit 2026-05-17: previously the probe ran whenever scale < 1, even
    // when full-deployment net was already known positive. The probe
    // builds `probe` from `currentCfg` — which carries the user's GENERIC
    // strategy settings (horizon=5, leverage=1, combo defaulting to the
    // last-set one), NOT the strategy-specific cfg that produced
    // brooklynNetAtFull. For Strategy B (horizon=2) or C (horizon=4) at
    // their auto-picked combo, the probe was effectively measuring
    // "what would Strategy A look like at this capital?" which often
    // returned negative net → false dial-back to zero. Affected ~10%
    // of all scenarios and produced the Blake-class "A beats B+C with
    // substantial LT gain" results that should not be possible. See
    // AUDIT_FINDINGS doc.
    if (recommendedInvestment > 0) {
      var netAtRec = null;
      if (Number.isFinite(brooklynNetAtFull) && brooklynNetAtFull > 0) {
        // Dialed-back net is monotone-improving in scale-down direction
        // (fees scale with capital, savings cap at absorbable × marginal).
        // Trust the caller's full-deployment net.
        netAtRec = brooklynNetAtFull;
      } else if (scale === 1 && Number.isFinite(brooklynNetAtFull)) {
        netAtRec = brooklynNetAtFull;
      } else if (typeof root.unifiedTaxComparison === 'function') {
        try {
          var probe = Object.assign({}, c, {
            availableCapital: recommendedInvestment,
            investment:       recommendedInvestment,
            investedCapital:  recommendedInvestment
          });
          if (typeof root.rettFlavorEngineCfg === 'function') {
            probe = root.rettFlavorEngineCfg(probe);
          }
          var pr = root.unifiedTaxComparison(probe) || {};
          var prFees = Number(pr.totalAllFees);
          if (!Number.isFinite(prFees)) {
            prFees = (Number(pr.totalFees) || 0) + (Number(pr.totalBrookhavenFees) || 0);
          }
          netAtRec = (Number(pr.totalSavings) || 0) - prFees;
        } catch (e) { /* probe failed — leave the recommendation alone */ }
      }
      if (netAtRec !== null && netAtRec <= 0) {
        recommendedInvestment = 0;
        scale = 0;
        dialBack = true;
        reason = 'brooklyn-marginal-net-negative';
      }
    }

    return {
      availableCapital:        availCap,
      currentLTGain:           currentLT,
      currentRecapture:        currentRecap,
      futureGain:              futureGain,
      // Legacy keys preserved for consumers that haven't been updated to
      // the new shape — futureGain is the canonical total now.
      futureLTGain:            futureGain,
      futureRecapture:         0,
      futureSaleEnabled:       !!future,
      futureSaleAbsorbing:     !!(future && root.__rettAbsorbFutureSale),
      totalAbsorbableGain:     absorbable,
      brooklynLossAtFull:      lossAtFull,
      dialBack:                dialBack,
      recommendedScale:        scale,
      recommendedInvestment:   recommendedInvestment,
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
  // on document). Two attribute conventions in play:
  //   - oilGas / delphi cards use [data-supp-pick-action]
  //     + [data-supp-pick-target]  (supplemental-render.js)
  //   - placeholder-rail cards (PTET, charitableGifts, slot05..slot12)
  //     use [data-supx-pick-action] + [data-supx-pick-target]
  //     (supplemental-extra-render.js)
  // Without catching BOTH, toggling a placeholder-rail supp off on
  // Page 5 leaves the enabled override sticking even after the
  // advisor re-clicks Interested on Page 4 — the row never repopulates.
  if (typeof document !== 'undefined') {
    document.addEventListener('click', function (ev) {
      var t = ev.target;
      if (!t || !t.closest) return;
      var btn = t.closest('[data-supp-pick-action], [data-supx-pick-action]');
      if (!btn) return;
      var id = btn.getAttribute('data-supp-pick-target') ||
               btn.getAttribute('data-supx-pick-target');
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
