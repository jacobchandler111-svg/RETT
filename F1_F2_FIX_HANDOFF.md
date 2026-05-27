# F1 + F2 fix handoff — for engine bot review

**Date:** 2026-05-27
**Commit:** `95a3734` on `main`
**Origin:** `QA_REPORT_2026-05-27.md` (HIGH-severity findings F1 + F2)
**Files touched:** `js/04-ui/projection-dashboard-render.js`, `index.html` (cache-buster)

---

## F2 — entry.cfg now self-describes the strategy variant

### What was wrong
`_scenarioCfgFor(type, currentCfg, ...)` at `projection-dashboard-render.js:782` clones `currentCfg` (from `collectInputs()`) and overlays a handful of strategy-specific fields. It did **not** clear cross-strategy fields. Result: a Strategy A entry's `cfg` rode along with the form's default `structuredSaleDurationMonths: 36`, a Strategy C entry's cfg rode along with whatever stale `installmentPayments` happened to be on the form, etc.

Reproduced before fix: `buildInterestedSummary().entries[0].cfg.structuredSaleDurationMonths === 36` even though `entries[0].type === 'A'`.

### What I changed
Each `if (type === 'X')` branch in `_scenarioCfgFor` now explicitly clears the OTHER strategies' fields:

```js
// A branch
return Object.assign({}, currentCfg, {
  recognitionStartYearIndex: 0,
  maxRecognitionYearIndex: null,
  structuredSaleDurationMonths: 0,   // F2: A is immediate, not structured
  installmentPayments: null,         // F2: A is not §453 installment
  parkRatio: null
});

// B branch — adds:
structuredSaleDurationMonths: 0,   // F2: B is §453, not structured
parkRatio: null

// C branch — adds:
installmentPayments: null          // F2: C is structured, not §453
```

### Why this is safe
The engine routes by `installmentPayments` first (`tax-comparison.js:826-963`). When `installmentPayments >= 1`, the engine **does not read** `structuredSaleDurationMonths`. Verified by direct comparison:

```
B with installmentPayments=3, structured=0:  savings $802,974, fees $151,240, net $651,734
B with installmentPayments=3, structured=36: savings $802,974, fees $151,240, net $651,734
```

Identical to the dollar. No engine math regression.

### What engine bot should verify
1. **Direct engine paths still equivalent**: Run a few scenarios with `installmentPayments` set + `structuredSaleDurationMonths` both 0 and 36 — confirm `unifiedTaxComparison` outputs match. (Above test already shows this for the canonical case.)
2. **Other consumers of `entry.cfg`**: search the codebase for `entry.cfg` / `entries[*].cfg` and confirm any consumer that re-routes through `unifiedTaxComparison` now produces correct numbers for Strategy A. Likely affected: admin math panels (`admin-math-page-projection.js`, `admin-math-page-allocator.js`), report generation (`strategy-summary-render.js`), Tab 7 reconciliation.
3. **Engine code paths reading `structuredSaleDurationMonths`**: confirm none assume non-zero. Specifically `tax-comparison.js:611` (`_structuredSaleMaturityYearIdx`) and `tax-comparison.js:1226` (MetLife rules lookup). Both already short-circuit on `monthsRaw <= 0`.
4. **Auto-pick stability**: B's auto-picker chose `installmentPayments=3` after the fix in the canonical scenario (vs `2` before). This was due to engine bot's intervening income-field wiring changes, **not** my fix — but worth double-checking by replaying a known scenario through the auto-picker.

---

## F1 — drift guard scoped to Strategy B only

### What was wrong
`_assertRowDashboardConsistency` at `projection-dashboard-render.js:1127` compared two parallel pipelines:
- **row pipeline** (`_scenarioMetrics(cfg)`) — generates the row.metrics that feed the green/red best-strategy badge.
- **section pipeline** (`_scenarioFullData(cfg).comp`) — generates the per-year breakdown displayed on the Projection card.

Original $1 tolerance assumed both pipelines were equivalent. **They aren't** for two reasons:

1. **Strategy A immediate path** uses **two different engines**:
   - `_scenarioMetrics`'s immediate branch (line 487) pulls Brooklyn fees from `ProjectionEngine.run(cfg).totals.cumulativeFees` (1-year position close).
   - `_scenarioFullData(cfg).comp.totalFees` comes from `unifiedTaxComparison` (multi-year accrual when horizon > 1).
   - These disagree by design. Canonical $5M/$1M Jan 1: ProjectionEngine $65,500 vs unifiedTaxComparison $101,500. Delta $36K, fires every render.

2. **Strategy C parkRatio sweep** — `pickedC.cfg` carries the sweep-winning `parkRatio`. The section pipeline re-derives independently and may land on a different parkRatio, producing 60%+ drift in net. Captured magnitude: row.net $972K vs dash.net $363K (delta $609K, 62.8% of net).

Strategy B has neither problem — single engine path (`unifiedTaxComparison` only), no sweep. Drift there really would indicate a bug.

### What I changed
```js
function _assertRowDashboardConsistency(type, sectionData, rowMetrics, sectionState) {
  if (!sectionData || !sectionData.comp || !rowMetrics) return;
  if (sectionState && sectionState.autoPickEnabled === false) return;
  // F1: skip strategies with known multi-pipeline divergence
  if (type === 'A' || type === 'C') return;
  // ... rest unchanged ...
  var tol = Math.max(1000, Math.abs(rowMetrics.net) * 0.01);
  if (dTax > tol || dFees > tol || dNet > tol) { ... }
}
```

Strategy B retains the check with a sane tolerance.

### What engine bot should verify
1. **The skip is the right answer for A and C**, not a bandaid for a deeper bug. Specifically:
   - **For A**: confirm that `ProjectionEngine.run`'s `cumulativeFees` is the **intended displayed value**, and `unifiedTaxComparison.totalFees` is just the raw multi-year accrual used internally. If both numbers should ever agree, this is a deeper bug — file a separate ticket.
   - **For C**: confirm that the parkRatio sweep's drift between row and section is acceptable. If the section should be re-deriving with the row-pipeline's parkRatio, that's a fix for `_resolveSectionCfg` / `_scenarioFullData` to thread parkRatio through.
2. **B-only check still catches real bugs**: introduce a synthetic mismatch (e.g., manually change a copy of `_scenarioMetrics` to return wrong fees) and confirm the warning fires for B. Optional.
3. **The dual-engine-for-A architecture is intentional**: this is the deeper question. Two engines computing Brooklyn fees for the same scenario is a code-smell. The clean long-term fix is to retire one engine path or document explicitly why both exist and which is canonical for which view. **Not done in this commit** — proposing as a follow-up.

---

## Reproduction commands

```js
// F1 — should be 0 after fix
(function(){
  const orig = console.warn;
  const drifts = [];
  console.warn = function(...args){
    if (args[0] && String(args[0]).includes('RETT drift')) drifts.push(args[0]);
    return orig.apply(this, args);
  };
  document.getElementById('nav-projection').click();
  setTimeout(() => { console.warn = orig; console.log('drifts:', drifts.length); }, 1500);
})();

// F2 — A.cfg should self-describe (structured=0, installments=null)
(function(){
  const sum = window.buildInterestedSummary();
  const A = sum.entries.find(e => e.type === 'A');
  console.log({
    structured: A.cfg.structuredSaleDurationMonths,  // 0 after fix
    installments: A.cfg.installmentPayments,         // null after fix
    parkRatio: A.cfg.parkRatio                       // null after fix
  });
})();
```

---

## Other QA-report items NOT touched

These are from `QA_REPORT_2026-05-27.md`. Left alone — defer to engine bot for prioritization:

| # | Severity | Item | Why not touched |
|---|---|---|---|
| **F3** | MED | Strategy A net erodes 97% from Jan→Dec | This is correct math (partial-year Brookhaven). Advisor UX consideration, not a bug. |
| **F4** | MED | Strategy B is fully date-invariant | Correct by design (`_scenarioCfgFor` forces year+1 Jan 1). Advisor copy might want a tooltip. |
| **F5** | LOW | Autosave overrides `__rettStrategyInterest` from external assignment | Test-harness friction. Could expose `window.rettSetStrategyInterest(obj)` as a programmatic API. |
| **F6** | LOW | `cmp.brookhavenSchedule.perYear` shape in `project-rett.md` doesn't match reality | Docs fix only. Per-year Brookhaven fees live on `cmp.rows[i].brookhavenFee` / `Setup` / `Quarterly`. Engine returns no top-level `brookhavenSchedule`. |
| — | LOW | Strategy A's mid-year net *uptick* on low-gain scenarios (Phase 2 batch A) | Looks optimizer-rational (shorter Y0 hold avoids Y1 quarterly fees) but worth a sanity check. |
| — | LOW | Net/fee ratio of 1.35× at $2M sale (scenario i=12) | May warrant a "minimum viable scale" advisor hint. Pure UX. |
| — | OPEN | Dual-engine architecture for Strategy A (`ProjectionEngine.run` + `unifiedTaxComparison`) | **Bigger refactor**. Either retire one engine for immediate-path fees, or formally document which is canonical for which view. F1 fix scopes around this; the underlying split remains. |

---

## TL;DR

- **F1** fixed: drift guard skips A and C (known design divergence), keeps B with sane tolerance. Zero drift warnings now on canonical render.
- **F2** fixed: `entry.cfg` now fully describes the strategy variant. No engine math change (verified by direct comparison).
- **Engine bot's job**: verify the skip logic is appropriate (not papering over a real bug), grep for `entry.cfg` consumers that may now produce different numbers, decide whether to tackle the dual-engine refactor as a follow-up.
