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
    var prevF = fEl.value, prevT = tEl.checked;
    var out = { rawNet: null, baselineTax: 0 };
    try {
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
    fEl.value = prevF; tEl.checked = prevT;
    return out;
  }

  function rettSuggestAdditionalFunds() {
    var AV = _pv('additional-account-value');
    if (!(AV > 0)) return null;                         // no account → no suggestion (cheap exit)
    if (typeof root.collectInputs !== 'function' ||
        typeof root.buildInterestedSummary !== 'function') return null;

    var curCap = _pv('available-capital');              // base Brooklyn capital (no add'l funds)

    // ---- Candidates = reachable Schwab tier gaps ONLY ------------------
    // We deliberately do NOT sweep arbitrary fractions of the account.
    // Deploying past the point that covers the real-estate sale only
    // washes the self-created liquidation gains (offsetting them at an
    // unlocked tier can even show a sliver of "benefit" — still phantom).
    // The clean, non-phantom lever is the TIER BUMP: getting capital to
    // the next combo minimum ($1M → 145/45, $3M → 200/100) unlocks a
    // higher loss-rate that offsets the SALE gain more efficiently.
    var gaps = [];
    try {
      var cfg = root.collectInputs();
      var stratKey = (cfg && cfg.tierKey) || 'beta1';
      if (typeof root.listSchwabCombosForStrategy === 'function') {
        (root.listSchwabCombosForStrategy(stratKey) || []).forEach(function (c) {
          var min = Number(c && c.minInvestment) || 0;
          if (min > curCap && (min - curCap) <= AV) gaps.push(Math.round(min - curCap));
        });
      }
    } catch (e) { return null; }
    gaps.sort(function (a, b) { return a - b; });
    if (!gaps.length) return null;

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

    // Suggest the SMALLEST tier gap whose net benefit clears the bar — the
    // cheapest tier jump that pays off far more than the tax it triggers.
    // null when none do (sale already covered, or the win doesn't dwarf the
    // additional tax).
    for (var i = 0; i < gaps.length; i++) {
      var p = _probe(gaps[i]);
      if (!p || p.rawNet == null) continue;
      var triggeredTax = Math.max(0, p.baselineTax - base.baselineTax);
      var netBenefit = (p.rawNet - base.rawNet) - triggeredTax;
      var bar = Math.max(1000, BENEFIT_MULT * triggeredTax);
      if (netBenefit > bar) return gaps[i];
    }
    return null;
  }

  root.rettSuggestAdditionalFunds = rettSuggestAdditionalFunds;
})(window);
