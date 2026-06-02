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
//   netBenefit(C) = [ rawNet(C) - rawNet(0) ]          // extra strategy net
//                 - [ baselineTax(C) - baselineTax(0) ] // one-time tax from
//                                                        // liquidating (the
//                                                        // triggered Y0 gain)
//
// rawNet = best strategy's (savings - fees) from buildInterestedSummary.
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
  // { rawNet, baselineTax } or null. contribution <= 0 = do-nothing.
  function _probe(contribution) {
    var fEl = _el('additional-funds'), tEl = _el('additional-funds-toggle');
    if (!fEl || !tEl) return null;
    var prevF = fEl.value, prevT = tEl.checked, prevProbe = root.__rettAFProbing;
    var out = { rawNet: null, baselineTax: 0 };
    try {
      // Suppress buildInterestedSummary's phantom-strip (Stage 2) while we
      // probe — we want the RAW net here and subtract triggeredTax
      // ourselves below. Without this flag the strip would already remove
      // triggeredTax from p.rawNet, and the netBenefit formula would then
      // double-subtract it.
      root.__rettAFProbing = true;
      fEl.value = (contribution > 0) ? String(Math.round(contribution)) : '';
      tEl.checked = contribution > 0;
      if (typeof root.buildInterestedSummary === 'function') {
        var sum = root.buildInterestedSummary();
        if (sum && sum.entries && sum.entries.length) {
          var n = -Infinity;
          sum.entries.forEach(function (e) {
            if (e && e.metrics && Number.isFinite(e.metrics.net)) n = Math.max(n, e.metrics.net);
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

    // ---- Score each gap by netBenefit (offset-of-sale, phantom-free) ---
    //   netBenefit    = (extra strategy net) − (one-time liquidation tax)
    //   triggeredTax  = the extra tax the liquidation creates this year
    //
    // Only-when-it-clearly-pays guard (advisor 2026-05-28): the suggestion
    // should fire when the SAVINGS dwarf the ADDITIONAL TAX the client pays
    // to realize the gain — e.g. "put in $10K, save $100K" — and NOT reach
    // for a small win with a big liquidation ("put in $500K to save $10K").
    // So require the net benefit to be MUCH larger than the triggered tax:
    //     netBenefit > max($1K, BENEFIT_MULT × triggeredTax)
    // BENEFIT_MULT = 2 ⇒ the net win must be ≥ 2× the extra tax (gross
    // savings ≥ ~3× the tax). Tiny tier-unlocks (a few $ from a threshold →
    // ~$0 triggered tax) still clear the $1K floor; big liquidations that
    // only edge out a positive net are suppressed.
    var BENEFIT_MULT = 2;

    var base = _probe(0);
    if (!base || base.rawNet == null) return null;

    // Suggest the amount with the HIGHEST phantom-free net benefit; within a
    // small tolerance prefer the SMALLER amount (the efficient minimum). Only
    // amounts whose benefit clears the bar (>> the tax the liquidation
    // triggers) qualify. null when none do — sale already covered, or the win
    // doesn't dwarf the additional tax. cands is ascending, so the smaller of
    // two near-tied amounts is kept (a later, larger amount only wins if it
    // beats the current best by more than the tolerance).
    var TOL = 1000, best = null;
    for (var i = 0; i < cands.length; i++) {
      var p = _probe(cands[i]);
      if (!p || p.rawNet == null) continue;
      var triggeredTax = Math.max(0, p.baselineTax - base.baselineTax);
      var netBenefit = (p.rawNet - base.rawNet) - triggeredTax;
      var bar = Math.max(1000, BENEFIT_MULT * triggeredTax);
      if (netBenefit <= bar) continue;
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
  //   netBenefit   = (rawNet_with − rawNet_without) − triggeredTax
  //                  i.e. benefit OFF THE SALE, with the self-created
  //                  liquidation gain's offset (the "phantom") removed
  //   qualifies    = netBenefit > 0  (adding the funds genuinely helps)
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
    if (!base || base.rawNet == null) return ZERO;
    var p = _probe(liq);
    if (!p || p.rawNet == null) return ZERO;
    var triggeredTax = Math.max(0, p.baselineTax - base.baselineTax);
    var netBenefit = (p.rawNet - base.rawNet) - triggeredTax;
    return {
      amount: liq,
      netBenefit: netBenefit,
      triggeredTax: triggeredTax,
      qualifies: netBenefit > 0
    };
  }
  root.rettAdditionalFundsBenefit = rettAdditionalFundsBenefit;
})(window);
