// FILE: js/03-solver/additional-funds.js
// Additional Funds optimizer — window.rettSuggestAdditionalFunds().
//
// The Tab-1 Section-03 inputs (account value / unrealized LT gain /
// unrealized ST gain / contribution) plus the Projection-tab "Include
// Additional Funds" toggle are wired in index.html. collectInputs()
// folds a contribution in when the toggle is ON (proportional
// liquidation → extra Brooklyn capital + triggered LT/ST gains).
//
// This file implements the suggested-amount optimizer the UI calls. It
// returns the liquidation amount (dollars) to recommend, or null.
//
// IMPORTANT — phantom-savings caveat (found 2026-05-28):
//   Liquidating securities realizes gain that Brooklyn then offsets.
//   Because the triggered gains sit in BOTH the do-nothing baseline and
//   the with-strategy path (collectInputs folds them into base gains),
//   "offsetting them" reads as savings — so the raw best-net grows
//   monotonically with the liquidation amount (→ "liquidate everything").
//   That over-states the benefit, so we do NOT chase the raw net-max.
//
//   The RELIABLE, non-phantom benefit is the Schwab TIER-BUMP: getting
//   available capital up to the next combo minimum ($1M → 145/45,
//   $3M → 200/100) unlocks a higher loss-rate that better offsets the
//   client's EXISTING sale gain and starts generating returns earlier.
//   We suggest the smallest tier gap that genuinely improves the best
//   strategy's net. The broader "fully offset Year-0 tax" / net-max goal
//   needs a phantom-free benefit metric (do-nothing baseline WITHOUT the
//   voluntary liquidation gains) — flagged for a follow-up.
//
// Net-benefit oracle: buildInterestedSummary() (~100ms, recomputes when
// the contribution changes). Only runs when the account has value
// (AV > 0), so the common no-additional-funds case is an instant null.

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

  // Best net across A/B/C at a given contribution. Temporarily forces the
  // toggle ON + writes #additional-funds (no change events dispatched, so
  // the live UI doesn't react), then restores. contribution <= 0 measures
  // the do-nothing baseline (toggle OFF).
  function _bestNetAt(contribution) {
    var fEl = _el('additional-funds'), tEl = _el('additional-funds-toggle');
    if (!fEl || !tEl || typeof root.buildInterestedSummary !== 'function') return null;
    var prevF = fEl.value, prevT = tEl.checked;
    var net = null;
    try {
      fEl.value = (contribution > 0) ? String(Math.round(contribution)) : '';
      tEl.checked = contribution > 0;
      var sum = root.buildInterestedSummary();
      if (sum && sum.entries && sum.entries.length) {
        net = -Infinity;
        sum.entries.forEach(function (e) {
          if (e && e.metrics && Number.isFinite(e.metrics.net)) net = Math.max(net, e.metrics.net);
        });
        if (!Number.isFinite(net)) net = null;
      }
    } catch (e) { net = null; }
    fEl.value = prevF; tEl.checked = prevT;
    return net;
  }

  function rettSuggestAdditionalFunds() {
    var AV = _pv('additional-account-value');
    if (!(AV > 0)) return null;                         // no account → no suggestion (cheap exit)
    if (typeof root.collectInputs !== 'function' ||
        typeof root.buildInterestedSummary !== 'function' ||
        typeof root.listSchwabCombosForStrategy !== 'function') return null;

    // Base Brooklyn capital WITHOUT additional funds (read the field
    // directly; collectInputs would fold the contribution in when ON).
    var curCap = _pv('available-capital');

    var cfg;
    try { cfg = root.collectInputs(); } catch (e) { return null; }
    var stratKey = (cfg && cfg.tierKey) || 'beta1';

    // Reachable higher-tier gaps, ascending (the only candidates we trust).
    var gaps = [];
    (root.listSchwabCombosForStrategy(stratKey) || []).forEach(function (c) {
      var min = Number(c && c.minInvestment) || 0;
      if (min > curCap && (min - curCap) <= AV) gaps.push(Math.round(min - curCap));
    });
    gaps.sort(function (a, b) { return a - b; });
    if (!gaps.length) return null;

    var baseNet = _bestNetAt(0);
    if (baseNet == null) baseNet = 0;

    // Suggest the smallest tier gap that meaningfully improves the best
    // strategy's net (require > $1,000 so we don't recommend liquidating
    // for noise).
    var EPS = 1000;
    for (var i = 0; i < gaps.length; i++) {
      var net = _bestNetAt(gaps[i]);
      if (net != null && (net - baseNet) > EPS) return gaps[i];
    }
    return null;
  }

  root.rettSuggestAdditionalFunds = rettSuggestAdditionalFunds;
})(window);
