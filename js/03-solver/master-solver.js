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

  // ── Oil & Gas IDC AMT preference fraction ────────────────────────────────
  // Only the "excess IDC" is an AMT preference (IRC §57(a)(2)): the IDC
  // deducted MINUS what 120-month (10-year) straight-line amortization would
  // allow. In the first year ~1/10 of the IDC is recovered by that
  // amortization and stays deductible for AMT, so the preference is ~90% of
  // the IDC, NOT 100%. The advisor chose the conservative middle ground
  // (option C, 2026-06-12 research): use 90% and deliberately SKIP the
  // independent-producer exception (§57(a)(2)(E)) + 40% AMTI cap, which would
  // exempt most individual working-interest investors entirely. Single source
  // of truth — temp-page-render reads this same global. Dial later for a
  // partial-IDC split or to model the independent-producer exemption.
  if (root.__rettIdcAmtPrefFraction == null) root.__rettIdcAmtPrefFraction = 0.90;
  function _idcAmtPrefFraction() {
    var f = Number(root.__rettIdcAmtPrefFraction);
    return (isNaN(f) || f < 0) ? 0.90 : Math.min(1, f);
  }

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
  // Ordinary-income FLOOR — the optimizer shelters ordinary income down to
  // this floor, never to $0. The standard-deduction band is taxed at 0% and
  // the first 10% bracket band at only 10%, so spending a supplemental
  // deduction (or capital) to shelter those low-value dollars wastes a
  // deduction that yields far more against higher-bracket income — leave
  // them unsheltered and redeploy the capital (advisor 2026-06-10). Floor =
  // standard deduction + top of the 10% bracket, per filing status and year.
  // Brackets inflate ~2%/yr so it's computed for the specific projection
  // year (yearOffset 0 = sale year). Std deduction is held flat per the
  // engine's projection model.
  function _ordFloor(cfg, yearOffset) {
    var status   = (cfg && cfg.filingStatus) || 'mfj';
    var baseYear = Number(cfg && cfg.year1) || 2026;
    var year     = baseYear + (Number(yearOffset) || 0);
    var stdDed = (typeof root.getFederalStandardDeduction === 'function')
      ? Number(root.getFederalStandardDeduction(year, status)) || 0 : 0;
    var tenTop = 0;
    if (typeof root.getFederalBrackets === 'function') {
      var br = root.getFederalBrackets(year, status) || [];
      for (var i = 0; i < br.length; i++) {
        if (Math.abs((Number(br[i][1]) || 0) - 0.10) < 1e-9) { tenTop = Number(br[i][0]) || 0; break; }
      }
    }
    return Math.max(0, stdDed + tenTop);
  }
  // Brooklyn-first recapture (advisor 2026-06-11). The §1250 unrecaptured-
  // depreciation recapture that the chosen PRIMARY (Brooklyn) strategy already
  // absorbs with its short-term losses must NOT also be sheltered by the
  // ordinary-offset supps — otherwise a supp sizes up to offset recapture
  // Brooklyn has already wiped (a double-offset; the supp "does the excess").
  // buildInterestedSummary stashes how much §1250 Brooklyn absorbs AT FULL
  // STRENGTH (supp-blind) on __rettPrimaryRecap1250Absorbed each render — full
  // strength because we run Brooklyn first and never dial it back to feed the
  // offsetters. The loss waterfall is ST -> LT -> §1250, so this is >0 only
  // when Brooklyn's loss exceeds the regular LT gain; otherwise it's 0 and the
  // supps keep the full recapture (a real, non-overlapping offset).
  function _suppExposedRecap(r1245, r1250) {
    var absorbed = Math.max(0, Number(root.__rettPrimaryRecap1250Absorbed) || 0);
    // §1245 is ordinary income — Brooklyn capital losses can't net it past the
    // §1211(b) $3K cap — so it stays fully exposed. Only the §1250 slice
    // Brooklyn absorbs is removed.
    var e1245 = Math.max(0, Number(r1245) || 0);
    var e1250 = Math.max(0, (Number(r1250) || 0) - absorbed);
    return { recap1245: e1245, recap1250: e1250, total: e1245 + e1250 };
  }
  // Resolve a cfg's recapture into the §1245/§1250 split (lump defaults to
  // §1250, matching the engine's real-estate convention) then return the
  // slice still exposed to the supps.
  function _exposedRecapFromCfg(cfg) {
    if (!cfg) return { recap1245: 0, recap1250: 0, total: 0 };
    var r1245 = Number(cfg.acceleratedDepreciation1245 || cfg.depreciationRecapture1245) || 0;
    var r1250 = Number(cfg.acceleratedDepreciation1250 || cfg.depreciationRecapture1250) || 0;
    if (r1245 + r1250 === 0) {
      r1250 = Number(cfg.acceleratedDepreciation || cfg.depreciationRecapture || cfg.recap) || 0;
    }
    return _suppExposedRecap(r1245, r1250);
  }

  // Year-0 shared ordinary pool available to ord-offset supps: total Y0
  // ordinary income (recurring + the EXPOSED accelerated-depreciation
  // recapture — net of what Brooklyn already absorbs) LESS the floor we
  // deliberately leave unsheltered.
  function _y0OrdPool(cfg) {
    if (!cfg) return 0;
    var gross = (Number(cfg.baseOrdinaryIncome) || 0) + _exposedRecapFromCfg(cfg).total;
    return Math.max(0, gross - _ordFloor(cfg, 0));
  }
  // Recurring (Y1+) shared ordinary pool. Each future year has its OWN pool
  // — the recapture is Y0-only, so out-years see just the recurring ordinary
  // income, again less the floor. Used to saturate multi-year supps so the
  // sum of their out-year offsets can't exceed a single year's income
  // (advisor 2026-06-10: multi-year allocations must report correctly).
  function _y1OrdPool(cfg) {
    if (!cfg) return 0;
    return Math.max(0, (Number(cfg.baseOrdinaryIncome) || 0) - _ordFloor(cfg, 1));
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

  // Per-recurring-year (Y1+) ordinary demand + per-year net for a supp.
  // Multi-year supps repeat an offset each future year against that year's
  // own ordinary pool; this returns the ONE-YEAR demand + net so the Y1+
  // pool can be saturated the same way Y0 is. null when the supp has no
  // recurring ordinary offset (single-year supps — their restNet is ~0).
  function _y1OrdInfo(id, result) {
    if (!result) return null;
    var d  = result.detail || {};
    var py = result.perYear;
    if (Array.isArray(py) && py.length > 1 && py[1]) {
      var p1  = py[1];
      var dem = (id === 'delphi')
        ? (Number(p1.ordExpense) || 0)
        : (Number(p1.deduction) || Number(p1.absorbed) || 0);
      var net = Number(p1.totalSaved) || 0;
      if (dem > 0 && net > 0) return { demand: dem, netPerYear: net };
      return null;
    }
    // Unified recurring shape (PTET, Augusta, charitable, 401k):
    // ordOffsetRestPerYear is the per-year offset, taxSavingsRestPerYear the
    // per-year tax saved.
    var dem2 = Number(d.ordOffsetRestPerYear) || 0;
    var net2 = Number(d.taxSavingsRestPerYear) || 0;
    if (dem2 > 0 && net2 > 0) return { demand: dem2, netPerYear: net2 };
    return null;
  }

  // Per-supp ordinary-deduction demand + realized per-dollar rate.
  // `demand` is the supp's UNCAPPED desired ordinary offset; `rate` is the
  // $ saved per $ of deduction it actually realized AT Y0 ONLY. `restNet`
  // is the supp's Y1+ tax savings (sum across future years); `y1Demand` /
  // `y1Rate` describe one recurring year so _saturateOrdinary can ration the
  // Y1+ pool too and scale restNet down when multi-year supps over-subscribe
  // a future year's income. Returns null for supps that don't offset
  // ordinary income (they keep full net).
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
    var restNet = Math.max(0, fullNet - y0Net);  // Y1+ total (rationed below)
    var y1 = _y1OrdInfo(id, result);
    return {
      demand:   demand,
      rate:     y0Net / basis,   // Y0-only rate (not multi-year inflated)
      restNet:  restNet,         // Y1+ total — scaled by the Y1 saturation
      y1Demand: y1 ? y1.demand : 0,
      y1Rate:   (y1 && y1.demand > 0) ? (y1.netPerYear / y1.demand) : 0
    };
  }
  // Allocate the shared Y0 ordinary pool across funded supps best-first.
  // Input items: [{ id, netBenefit, ordInfo }]. Returns
  //   { total, realized: { id -> realizedNet } }.
  // Supps with no ordInfo keep their full net (they don't touch the pool).
  //
  // Multi-year supps: their Y0 component is rationed against the Y0 pool and
  // their recurring (Y1+) component against the SEPARATE recurring pool
  // (y1Pool). Each future year has its own independent ordinary income, so
  // restNet is scaled by the fraction of one recurring year's demand that
  // fits — not wiped proportionally to Y0 crowding (audit 2026-06-08 #5),
  // but no longer passed through at 100% either (advisor 2026-06-10: when
  // several multi-year supps over-subscribe a future year's income their
  // out-year offsets must be rationed, or the sum exceeds that year's income).
  function _saturateOrdinary(items, pool, y1Pool) {
    var realized = {};
    // realizedDetail[id] = { y0, rest, y0Demand, rate, y1Scale }. Consumers
    // (temp-page-render) read y0SaturationScale = y0/(y0Demand*rate) and
    // y1PlusSaturationScale = y1Scale to scale each year band independently.
    var realizedDetail = {};
    var ordList = [];
    items.forEach(function (s) {
      if (s.ordInfo) ordList.push(s);
      else {
        realized[s.id] = Math.round(Number(s.netBenefit) || 0);
        realizedDetail[s.id] = { y0: realized[s.id], rest: 0, y0Demand: 0, rate: 0, y1Scale: 1 };
      }
    });
    // ---- Y0 ration. FREE supps first: Augusta / PTET deploy no capital —
    // they're "set-and-forget" benefits the client gets just for opting in —
    // so they claim their slice of the shared ordinary pool BEFORE the
    // capital strategies (Oil & Gas, Delphi, Equipment Leasing, Farm). A
    // capital supp's deduction that over-subscribes the pool is wasted NOL
    // anyway, so seating the free supps first never costs total benefit and
    // makes them show every applicable year instead of being crowded out of
    // Y0 (advisor 2026-06-10). Within each tier: sort by Y0 rate desc; tie ->
    // smaller restNet first (single-year supps get first dibs; a multi-year
    // supp can still realize Y1+ even if Y0 is crowded out). Audit R2 #10.
    ordList.sort(function (a, b) {
      var af = a.isFree ? 1 : 0, bf = b.isFree ? 1 : 0;
      if (af !== bf) return bf - af;
      var d = b.ordInfo.rate - a.ordInfo.rate;
      if (d !== 0) return d;
      return (a.ordInfo.restNet || 0) - (b.ordInfo.restNet || 0);
    });
    var y0Realized = {};
    var remaining = Math.max(0, Number(pool) || 0);
    ordList.forEach(function (s) {
      var take = Math.min(s.ordInfo.demand, remaining);
      y0Realized[s.id] = take * s.ordInfo.rate;
      remaining -= take;
    });
    // ---- Y1+ ration: ration the recurring pool by one-year demand best-
    // first; each supp's restNet scales by the fraction of its recurring
    // demand that fits. Supps with no recurring ord demand keep full restNet.
    var y1Scale = {};
    var y1List = ordList.filter(function (s) { return (s.ordInfo.y1Demand || 0) > 0; });
    y1List.sort(function (a, b) {
      var af = a.isFree ? 1 : 0, bf = b.isFree ? 1 : 0;
      if (af !== bf) return bf - af;   // free (no-capital) supps first, same as Y0
      var d = (b.ordInfo.y1Rate || 0) - (a.ordInfo.y1Rate || 0);
      if (d !== 0) return d;
      return (a.ordInfo.restNet || 0) - (b.ordInfo.restNet || 0);
    });
    var y1Remaining = Math.max(0, Number(y1Pool) || 0);
    y1List.forEach(function (s) {
      var dem = s.ordInfo.y1Demand || 0;
      var take1 = Math.min(dem, y1Remaining);
      y1Scale[s.id] = dem > 0 ? (take1 / dem) : 1;
      y1Remaining -= take1;
    });
    // ---- combine
    ordList.forEach(function (s) {
      var realized_y0 = y0Realized[s.id] || 0;
      var sc          = (y1Scale[s.id] != null) ? y1Scale[s.id] : 1;
      var rest        = (s.ordInfo.restNet || 0) * sc;
      realized[s.id] = Math.round(realized_y0 + rest);
      realizedDetail[s.id] = {
        y0:        realized_y0,
        rest:      rest,
        y0Demand:  s.ordInfo.demand,
        rate:      s.ordInfo.rate,
        y1Scale:   sc
      };
    });
    var total = 0;
    Object.keys(realized).forEach(function (k) { total += realized[k]; });
    return { total: Math.round(total), realized: realized, detail: realizedDetail };
  }

  // Oil & Gas IDC AMT clawback (advisor 2026-06-12). O&G's intangible drilling
  // cost is deducted for regular tax but added BACK to AMTI post-strategy (IDC
  // isn't deductible for AMT — see tax-calc-federal `amtIdcPreference`). After
  // the primary (Brooklyn) strategy wipes the capital gain, the residual is the
  // recurring ordinary income; adding the IDC back there often triggers AMT
  // that claws back most of O&G's federal benefit. The FUNDING layer (rivalry +
  // auto-sizer) must rank/size O&G by this AFTER-AMT value so it doesn't
  // over-invest in O&G when AMT eats it (and funds higher-benefit supps first).
  //
  // Returns a SHALLOW CLONE of the O&G result with each year's totalSaved (and
  // the rollup) reduced by that year's incremental IDC AMT. The original
  // lastResult is NOT mutated — the per-year display recompute
  // (__rettHonestSuppBenefit / temp-page) applies the IDC AMT itself from the
  // untouched absorbedOrd, so there's no double-count. Demand/absorbed fields
  // are left intact so the shared-ordinary-pool rationing is unchanged.
  function _oilGasResultAfterAmt(cfg, result) {
    if (!result || typeof root.computeFederalTaxBreakdown !== 'function') return result;
    var py = Array.isArray(result.perYear) ? result.perYear : null;
    if (!py || !py.length) return result;
    var year     = Number(cfg && cfg.year1) || 2026;
    var status   = (cfg && cfg.filingStatus) || 'mfj';
    var residOrd = Math.max(0, Number(cfg && cfg.baseOrdinaryIncome) || 0);
    var wages    = Math.max(0, Number(cfg && cfg.wages) || 0);
    var touched  = false;
    var newPy = py.map(function (p, i) {
      // Only the excess IDC (~90%) is an AMT preference — see _idcAmtPrefFraction.
      var idc = Math.max(0, Number(p && p.absorbedOrd) || 0) * _idcAmtPrefFraction();
      if (idc <= 0) return p;
      var regOrd = Math.max(0, residOrd - idc);
      var clawback = 0;
      try {
        var w = root.computeFederalTaxBreakdown(regOrd, year + i, status, { longTermGain: 0, wages: wages, amtIdcPreference: idc }) || {};
        var n = root.computeFederalTaxBreakdown(regOrd, year + i, status, { longTermGain: 0, wages: wages }) || {};
        clawback = Math.max(0, (Number(w.amtTopUp) || 0) - (Number(n.amtTopUp) || 0));
      } catch (e) { clawback = 0; }
      if (clawback <= 0) return p;
      touched = true;
      return Object.assign({}, p, { totalSaved: Math.max(0, (Number(p.totalSaved) || 0) - clawback) });
    });
    if (!touched) return result;
    var newTotal = newPy.reduce(function (a, p) { return a + (Number(p.totalSaved) || 0); }, 0);
    return Object.assign({}, result, { perYear: newPy, totalSaved: newTotal });
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
        // Rank O&G by its AFTER-AMT benefit (IDC added back post-strategy).
        if (spec.id === 'oilGas') result = _oilGasResultAfterAmt(cfg, result);
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
    // Recurring (Y1+) pool — the rivalry's subset objective must credit the
    // SAME out-year benefit the final realization does (runMasterSolver passes
    // this to _saturateOrdinary at funding time). Without it, a multi-year
    // capital supp whose Year 0 is crowded out (e.g. Farm / Equipment Leasing
    // behind Oil & Gas) evaluates to ~$0 net here and is denied funding as
    // 'capital-exhausted', even though its Year 1+ deduction is real and gets
    // realized downstream — a funding-vs-realization inconsistency (advisor
    // 2026-06-10).
    var y1Pool = _y1OrdPool(cfg);
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
    var bestObj = _saturateOrdinary(alwaysOnOrd, ordPool, y1Pool).total;
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
        var sumNet = _saturateOrdinary(items, ordPool, y1Pool).total;
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
        // O&G ranked/saturated by its AFTER-AMT benefit (IDC added back).
        if (spec.id === 'oilGas') result = _oilGasResultAfterAmt(cfg, result);
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
                 // Free (no-capital) supps — PTET / Augusta — are funded
                 // unconditionally as 'free-benefit'; they claim the shared
                 // ordinary pool ahead of the capital strategies (2026-06-10).
                 isFree: !!(s.rivalry && s.rivalry.reason === 'free-benefit'),
                 ordInfo: _ordInfoOf(s.id, s.result, s.netBenefit) };
      }),
      _y0OrdPool(cfg),
      _y1OrdPool(cfg)
    );
    supplementals.forEach(function (s) {
      s.realizedNetBenefit = Object.prototype.hasOwnProperty.call(sat.realized, s.id)
        ? sat.realized[s.id]
        : 0;
      // Legacy single-scalar scale (kept for back-compat consumers).
      s.saturationScale = (Number(s.netBenefit) > 0)
        ? (s.realizedNetBenefit / s.netBenefit)
        : (s.realizedNetBenefit > 0 ? 1 : 0);
      // Per-year split: Y0 is rationed against the Y0 pool and Y1+ against
      // the recurring pool. Consumers (temp-page-render) apply
      // y0SaturationScale ONLY to perYear[0] and y1PlusSaturationScale to
      // perYear[1..]. Audit R2 #5: per-year split avoids mis-attributing
      // dollars across years on clipped supps; advisor 2026-06-10: Y1+ is
      // now itself rationed so out-year offsets can't exceed a year's income.
      var det = sat.detail && sat.detail[s.id];
      if (det && det.y0Demand > 0 && det.rate > 0) {
        var y0FullNet = det.y0Demand * det.rate;
        s.y0SaturationScale = y0FullNet > 0 ? (det.y0 / y0FullNet) : 1;
      } else {
        s.y0SaturationScale = 1;
      }
      s.y1PlusSaturationScale = (det && Number.isFinite(Number(det.y1Scale)))
        ? Number(det.y1Scale) : 1;
    });
    var totalSupp = sat.total;

    // Cross-strategy residual cap (advisor 2026-06-09). Each funded supp's
    // netBenefit is computed against its OWN pre-primary baseline, so when
    // the primary strategy (Brooklyn) already eliminated part of the year's
    // tax, the supps would double-claim that overlap — making combined
    // "tax saved" exceed the tax that was EVER owed (measured case:
    // Brooklyn $152K + Oil&Gas standalone $178K = $330K "saved" on a $324K
    // bill → $6K phantom in the Tab-6 hero). Supps can only offset the tax
    // that REMAINS after the primary strategy. The caller — which knows the
    // chosen strategy's dialed-back deployment — supplies that residual
    // (Σ withStrategy.total across the chosen comp rows) via
    // opts.postPrimaryTaxRemaining. We cap the funded-supp total there and
    // scale each funded supp's realized benefit proportionally so per-supp
    // figures + saturationScale stay consistent. _saturateOrdinary already
    // handles supp-vs-supp ordinary-pool crowding; THIS is the orthogonal
    // supp-vs-primary cap. Omitted (no cap) when the caller can't supply it.
    // Applies even alongside forceDisabledSupps so buildInterestedSummary's
    // drop-one verification optimizes the SAME capped combined net the
    // hero/Temp/admin display (the cap is caller-supplied — no re-entrancy).
    var _ppCap = (opts && Number.isFinite(Number(opts.postPrimaryTaxRemaining)))
      ? Math.max(0, Number(opts.postPrimaryTaxRemaining)) : null;
    if (_ppCap != null && totalSupp > _ppCap + 0.5) {
      var _ppScale = totalSupp > 0 ? (_ppCap / totalSupp) : 0;
      supplementals.forEach(function (s) {
        if (s && s.rivalry && s.rivalry.funded) {
          s.realizedNetBenefit = Math.round((Number(s.realizedNetBenefit) || 0) * _ppScale);
          s.saturationScale = (Number(s.netBenefit) > 0)
            ? (s.realizedNetBenefit / s.netBenefit)
            : (s.realizedNetBenefit > 0 ? 1 : 0);
        }
      });
      totalSupp = Math.round(_ppCap);
    }

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
    // Future-sale impact is modeled separately on Page 6 (the multi-sale
    // collective Net Benefit / Savings-by-Sale, driven by
    // __rettFutureInstallmentBenefit). The optimizer here stays focused on the
    // current sale, so futureGain is held at 0.
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
  // Shared by the supp calc modules (calc-oil-gas, calc-supplemental-extra) so
  // they size against the SAME Brooklyn-net-of recapture pool the solver uses.
  root.__rettSuppExposedRecap       = _suppExposedRecap;

  // Post-primary residual tax for a chosen-strategy entry = Σ withStrategy
  // .total across the engine rows = the tax that REMAINS after the primary
  // (Brooklyn) strategy, before any supplemental. Funded supps can only
  // offset this residual; pass it as runMasterSolver's
  // opts.postPrimaryTaxRemaining so the combined hero/temp/admin net can't
  // claim more tax saved than was ever owed (advisor 2026-06-09). Takes a
  // buildInterestedSummary entry (has .cfg + ._partialDeploy dial-back).
  // Returns null when it can't compute (caller then passes no cap → prior
  // behavior). Cheap: one unifiedTaxComparison, no buildInterestedSummary,
  // so it's safe to call from runMasterSolver's consumers without re-entrancy.
  root.__rettResidualCapForEntry = function (entry) {
    if (!entry || !entry.cfg || typeof root.unifiedTaxComparison !== 'function') return null;
    var ecfg = entry.cfg;
    var pd = entry._partialDeploy;
    if (pd && Number.isFinite(Number(pd.deployed)) &&
        Math.round(Number(pd.deployed)) !== Math.round(Number(ecfg.availableCapital) || 0)) {
      var d = Math.max(0, Math.round(Number(pd.deployed)));
      ecfg = Object.assign({}, ecfg, { availableCapital: d, investment: d, investedCapital: d });
    }
    if (typeof root.rettFlavorEngineCfg === 'function') {
      try { ecfg = root.rettFlavorEngineCfg(ecfg); } catch (e) { /* */ }
    }
    var comp;
    try { comp = root.unifiedTaxComparison(ecfg); } catch (e) { return null; }
    if (!comp || !Array.isArray(comp.rows)) return null;
    return comp.rows.reduce(function (a, r) {
      return a + ((r.withStrategy && Number(r.withStrategy.total)) || 0);
    }, 0);
  };
})(window);
