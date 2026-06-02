// FILE: js/03-solver/additional-funds.js
// Additional Funds optimizer — window.rettSuggestAdditionalFunds().
//
// The Tab-1 Section-03 inputs (account value / unrealized LT gain /
// unrealized ST gain / contribution) plus the Projection-tab "Include
// Additional Funds" toggle are wired in index.html. collectInputs()
// folds a contribution in when the toggle is ON: capped liquidation adds
// to availableCapital + investment, and the proportional ONE-TIME (Y0)
// triggered gains go to cfg.additionalY0LongGain / additionalY0ShortGain.
//
// ---- What "net benefit" means here (advisor 2026-05-28) --------------
// The target is to maximize the net benefit of OFFSETTING THE REAL-ESTATE
// SALE tax — NOT of offsetting the gains created by liquidating the
// securities portfolio. Selling more of the portfolio can look optimal on
// paper because Brooklyn then offsets those self-created gains, which
// reads as "savings" — but that's circular (the client wouldn't owe that
// tax if they didn't liquidate). So we strip it out:
//
//   netBenefit(C) = MAX over strategies of
//                     [ net_s(C) - net_s(0) ]            // that strategy's
//                                                        // extra net
//                   - [ baselineTax(C) - baselineTax(0) ] // one-time tax from
//                                                        // liquidating (the
//                                                        // triggered Y0 gain)
//
// net_s = strategy s's (savings - fees) from buildInterestedSummary. We score
// off the MAX over strategies (not the single best-net strategy's delta):
// a large benefit to a weaker strategy must still surface the toggle. Without
// this the toggle was a FALSE NEGATIVE whenever the benefit landed on a
// non-top strategy (fixed 2026-06-02 — see _maxPerCardImprove).
// baselineTax = the do-nothing total tax (unifiedTaxComparison.totalBaseline);
// its delta isolates the tax created purely by the liquidation. Subtracting
// it leaves the benefit attributable to better offsetting the SALE — so the
// optimum sits at "deploy enough to cover the sale," not "liquidate
// everything." We then prefer the SMALLEST contribution within a small
// tolerance of the best netBenefit (the efficient minimum — usually a tier
// threshold), and never exceed the account value.
//
// Only runs when the account has value (AV > 0), so the common
// no-additional-funds case is an instant null.

(function (root) {
  'use strict';

  function _el(id) { return document.getElementById(id); }
  function _pv(id) {
    var el = _el(id);
    var raw = el ? el.value : '';
    var v = (typeof root.parseUSD === 'function')
      ? root.parseUSD(raw)
      : parseFloat(String(raw).replace(/[^0-9.\-]/g, ''));
    return Number.isFinite(v) ? v : 0;
  }

  // Probe the engine at a given contribution. Temporarily forces the
  // toggle ON + writes #additional-funds (no change events dispatched, so
  // the live UI doesn't react), then restores. Returns
  // { nets, rawNet, baselineTax } or null. contribution <= 0 = do-nothing.
  //   nets    = per-strategy RAW net keyed by entry type (A/B/C) — so the
  //             scorer can measure the improvement to EACH strategy, not
  //             just the single best-net one (the false-negative bug:
  //             a big benefit to a weaker strategy was invisible when only
  //             the top strategy's delta was measured).
  //   rawNet  = max(nets) (kept for the cheap exit check).
  function _probe(contribution) {
    var fEl = _el('additional-funds'), tEl = _el('additional-funds-toggle');
    if (!fEl || !tEl) return null;
    var prevF = fEl.value, prevT = tEl.checked, prevProbe = root.__rettAFProbing;
    var out = { nets: {}, rawNet: null, baselineTax: 0 };
    try {
      // Suppress buildInterestedSummary's phantom-strip (Stage 2) while we
      // probe — we want the RAW net here and subtract triggeredTax
      // ourselves below. Without this flag the strip would already remove
      // triggeredTax from p.nets, and the netBenefit formula would then
      // double-subtract it.
      root.__rettAFProbing = true;
      fEl.value = (contribution > 0) ? String(Math.round(contribution)) : '';
      tEl.checked = contribution > 0;
      if (typeof root.buildInterestedSummary === 'function') {
        var sum = root.buildInterestedSummary();
        if (sum && sum.entries && sum.entries.length) {
          var n = -Infinity;
          sum.entries.forEach(function (e, idx) {
            if (e && e.metrics && Number.isFinite(e.metrics.net)) {
              out.nets[e.type || ('idx' + idx)] = e.metrics.net;
              n = Math.max(n, e.metrics.net);
            }
          });
          out.rawNet = Number.isFinite(n) ? n : null;
        }
      }
      if (typeof root.unifiedTaxComparison === 'function' && typeof root.collectInputs === 'function') {
        var cmp = root.unifiedTaxComparison(root.collectInputs());
        out.baselineTax = Number(cmp && cmp.totalBaseline) || 0;
      }
    } catch (e) { out = null; }
    fEl.value = prevF; tEl.checked = prevT; root.__rettAFProbing = prevProbe;
    return out;
  }

  // Max over strategies of the phantom-free improvement at this probe:
  //   improve(s) = (nets_c[s] − nets_0[s]) − triggeredTax
  // triggeredTax is the one-time liquidation tax (global — the brokerage is
  // sold once regardless of how each strategy deploys the capital), so it is
  // subtracted from every card, matching the render's per-card phantom strip.
  // Taking the MAX answers "does AT LEAST ONE strategy positively benefit?"
  // — a drop in another strategy is irrelevant (the render's per-card sweep
  // makes that strategy DECLINE so it never shows a lower number).
  function _maxPerCardImprove(base, p, triggeredTax) {
    var maxImp = -Infinity;
    Object.keys(p.nets).forEach(function (k) {
      if (!(k in base.nets)) return;
      var imp = (p.nets[k] - base.nets[k]) - triggeredTax;
      if (imp > maxImp) maxImp = imp;
    });
    return Number.isFinite(maxImp) ? maxImp : null;
  }

  function rettSuggestAdditionalFunds() {
    var AV = _pv('additional-account-value');
    if (!(AV > 0)) return null;                         // no account → no suggestion (cheap exit)
    if (typeof root.collectInputs !== 'function' ||
        typeof root.buildInterestedSummary !== 'function') return null;

    var curCap = _pv('available-capital');              // base Brooklyn capital (no add'l funds)

    // ---- Candidates = tier gaps + fractional account amounts -----------
    // Two kinds of clean, non-phantom lever:
    //   (1) TIER BUMP — getting capital to the next combo minimum
    //       ($1M → 145/45, $3M → 200/100) unlocks a higher loss-rate that
    //       offsets the SALE gain more efficiently.
    //   (2) CAPITAL TO COVER MORE REAL GAIN — when the sale gain isn't yet
    //       fully offset (a strategy is capital-constrained, e.g. already at
    //       the top tier), adding capital WITHIN the tier still offsets more
    //       REAL gain. (Broadened 2026-06-02 — the old tier-gap-ONLY set hid
    //       the toggle at the top tier even when more capital clearly helped.)
    // Sweeping fractions is safe because the phantom-free scoring below nets
    // any self-created liquidation gain to ~0 (its offset is cancelled by the
    // triggered tax), so over-liquidation can never look beneficial.
    var cands = [];
    try {
      var cfg = root.collectInputs();
      var stratKey = (cfg && cfg.tierKey) || 'beta1';
      if (typeof root.listSchwabCombosForStrategy === 'function') {
        (root.listSchwabCombosForStrategy(stratKey) || []).forEach(function (c) {
          var min = Number(c && c.minInvestment) || 0;
          if (min > curCap && (min - curCap) <= AV) cands.push(Math.round(min - curCap));
        });
      }
    } catch (e) { return null; }
    [0.25, 0.5, 0.75, 1].forEach(function (f) {
      var amt = Math.round(AV * f);
      if (amt > 0) cands.push(amt);
    });
    cands = cands.filter(function (v, i, a) { return v > 0 && a.indexOf(v) === i; })
                 .sort(function (a, b) { return a - b; });
    if (!cands.length) return null;

    // ---- Score each candidate by max-per-card netBenefit (phantom-free) -
    //   netBenefit(c) = MAX over strategies of the phantom-free improvement
    //                   that strategy gets from contribution c (see
    //                   _maxPerCardImprove). Taking the max means the
    //                   suggestion fires whenever ANY strategy genuinely
    //                   benefits — aligning the auto-populate (which gates
    //                   toggle visibility) with the user's invariant
    //                   "show if AT LEAST ONE strategy positively benefits."
    //
    // Noise floor only (was BENEFIT_MULT × triggeredTax, advisor 2026-05-28).
    // The old 2× multiplier suppressed genuine wins because the phantom-free
    // netBenefit ALREADY subtracts the liquidation's triggered tax — the
    // extra multiplier double-penalized and hid real benefits. The user's
    // 2026-06-02 invariant is "positively benefits" = improvement > 0, so we
    // keep only a $1K noise floor to ignore rounding-scale wins.
    var FLOOR = 1000;

    var base = _probe(0);
    if (!base || !base.nets || !Object.keys(base.nets).length) return null;

    // Suggest the amount with the HIGHEST max-per-card net benefit; within a
    // small tolerance prefer the SMALLER amount (the efficient minimum). null
    // when no amount clears the noise floor — sale already covered for every
    // strategy, or no strategy gains more than rounding noise. cands is
    // ascending, so the smaller of two near-tied amounts is kept (a later,
    // larger amount only wins if it beats the current best by > tolerance).
    var TOL = 1000, best = null;
    for (var i = 0; i < cands.length; i++) {
      var p = _probe(cands[i]);
      if (!p || !p.nets || !Object.keys(p.nets).length) continue;
      var triggeredTax = Math.max(0, p.baselineTax - base.baselineTax);
      var netBenefit = _maxPerCardImprove(base, p, triggeredTax);
      if (netBenefit == null || netBenefit <= FLOOR) continue;
      if (!best || netBenefit > best.nb + TOL) best = { amt: cands[i], nb: netBenefit };
    }
    return best ? best.amt : null;
  }

  root.rettSuggestAdditionalFunds = rettSuggestAdditionalFunds;

  // ---- Benefit of the ADVISOR'S ENTERED amount (Stage 1 visibility gate) -
  // rettSuggestAdditionalFunds() only scores reachable Schwab tier gaps to
  // pick an optimal amount. The visibility gate instead needs the
  // phantom-free net benefit of whatever amount is CURRENTLY in
  // #additional-funds (auto-suggested OR a manual advisor override), so the
  // "Include additional funds" control can be hidden when that amount
  // doesn't actually pay off the sale.
  //
  // Returns { amount, netBenefit, triggeredTax, qualifies }:
  //   amount       = capped liquidation (min(entered, accountValue))
  //   triggeredTax = one-time do-nothing tax the liquidation creates
  //   netBenefit   = MAX over strategies of the phantom-free improvement
  //                  each strategy gets (see _maxPerCardImprove) — NOT just
  //                  the top-net strategy's delta. This is what makes the
  //                  gate honor "show if AT LEAST ONE strategy benefits": a
  //                  big benefit to a weaker strategy now counts even when
  //                  the best-net strategy is unaffected.
  //   qualifies    = netBenefit > 0  (at least one strategy genuinely helps)
  // Cheap exit (no probing) when there's no account value or no amount.
  function rettAdditionalFundsBenefit() {
    var ZERO = { amount: 0, netBenefit: 0, triggeredTax: 0, qualifies: false };
    var AV = _pv('additional-account-value');
    var amt = _pv('additional-funds');
    if (!(AV > 0) || !(amt > 0)) return ZERO;
    if (typeof root.collectInputs !== 'function' ||
        typeof root.buildInterestedSummary !== 'function') return ZERO;
    var liq = Math.min(amt, AV);
    var base = _probe(0);
    if (!base || !base.nets || !Object.keys(base.nets).length) return ZERO;
    var p = _probe(liq);
    if (!p || !p.nets || !Object.keys(p.nets).length) return ZERO;
    var triggeredTax = Math.max(0, p.baselineTax - base.baselineTax);
    var netBenefit = _maxPerCardImprove(base, p, triggeredTax);
    if (netBenefit == null) return ZERO;
    return {
      amount: liq,
      netBenefit: netBenefit,
      triggeredTax: triggeredTax,
      qualifies: netBenefit > 0
    };
  }
  root.rettAdditionalFundsBenefit = rettAdditionalFundsBenefit;
})(window);
