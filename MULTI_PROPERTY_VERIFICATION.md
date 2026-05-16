# Multi-Property + Future-Sale Simplification — Verification Report

**Scope**: Line-by-line trace of every consumer of the relevant inputs to verify both planned changes will carry correctly through all downstream code under all entry states.

**States tested**: S1 fresh entry / S2 partial entry / S3 edit after entry / S4 toggle-off-then-on.

---

# Part 1 — Future Sale simplification (4 fields → 2)

## Current shape
```js
cfg.futureSale = {
  enabled,
  saleDate,
  salePrice, costBasis, acceleratedDepreciation,
  longTermGain          // = max(0, sale − basis − depr)
}
```

## Proposed shape
```js
cfg.futureSale = {
  enabled,
  saleDate,
  estimatedGain         // single user-entered number; replaces the 4-field computation
}
```

## Every consumer found (5 sites)

| File:Line | Reads | New behavior |
|---|---|---|
| [`inputs-collector.js:152-166`](RETT/js/04-ui/inputs-collector.js#L152) | Builds the cfg object from DOM | Replace 4 DOM reads with 1 (`#future-estimated-gain`). Drop `longTermGain` derivation. |
| [`master-solver.js:491-503`](RETT/js/03-solver/master-solver.js#L491) | `future.longTermGain` (line 500), `future.acceleratedDepreciation` (line 502) | Sum becomes single `future.estimatedGain`. **Net math identical** — client enters their total taxable amount instead of letting the engine split LT/recap. |
| [`strategy-summary-render.js:1330`](RETT/js/04-ui/strategy-summary-render.js#L1330) | `cfg.futureSale.longTermGain` | Field rename to `cfg.futureSale.estimatedGain`. |
| [`strategy-summary-render.js:1382-1387`](RETT/js/04-ui/strategy-summary-render.js#L1382) | `cfg.futureSale.saleDate` | No change — date field stays. |
| [`controls.js:1414-1443`](RETT/js/04-ui/controls.js#L1414) | DOM elements `#future-sale-price`, `#future-cost-basis`, `#future-accelerated-depreciation`, `#future-long-term-gain` for the auto-compute-gain listener | **Delete entire `recomputeFutureGain` block.** Keep only the `syncFutureGroup` show/hide. |
| [`case-storage.js:49-50`](RETT/js/04-ui/case-storage.js#L49) | Persisted field list | Replace 4 IDs with 1 (`future-estimated-gain`). |
| [`money-format.js:23, 43`](RETT/js/04-ui/money-format.js#L23) | Money-format field list | Same. |

## Behavior under each state

| State | Outcome | Notes |
|---|---|---|
| S1 — toggle Yes, fill gain + date | `cfg.futureSale = {enabled: true, saleDate, estimatedGain}` flows clean to master-solver + strategy-summary | ✅ |
| S2a — toggle Yes, no gain entered | `estimatedGain = 0` → master-solver `absorbable += 0` → strategy-summary `futureLT <= 0` early-out | ✅ Safe — callout doesn't render |
| S2b — toggle Yes, gain entered, no date | `saleDate = ''` → strategy-summary defaults to `year1 + 3` (existing fallback at L1386) | ✅ Existing behavior preserved |
| S3 — change gain $100K → $500K | Standard debounced re-render | ✅ |
| S4a — toggle Yes → No after data entry | `inputs-collector` returns `{enabled: false}` → master-solver: `future = null` → strategy-summary early-outs | ✅ Data preserved in DOM for re-toggle |
| S4b — toggle No → Yes again | Existing field values flow back into cfg | ✅ |

## Save/load backwards compat

**Risk**: legacy saved cases carry the 4 old field IDs (`future-sale-price`, etc.) and no `future-estimated-gain`. On restore, the new field is empty.

**Migration**: in [`case-storage.js`](RETT/js/04-ui/case-storage.js)'s load path, after restoring field values, check: if `future-estimated-gain` is empty AND any of the old fields is non-zero, compute `gain = max(0, oldSalePrice − oldCostBasis − oldDepreciation)` and write to `#future-estimated-gain`. ~10 lines.

## Risk: **S (small)**. ~1-1.5 hrs implementation + visual test.

---

# Part 2 — Multi-property "Add Another Property"

## Pre-existing direct-DOM readers of property fields (11 sites)

These read directly from `#sale-price` / `#cost-basis` / `#accelerated-depreciation` / `#implementation-date` / `#strategy-implementation-date`, bypassing `cfg`. Every one of these must update to sum across properties:

| File:Line | Reader | Purpose | Multi-property fix |
|---|---|---|---|
| [`baseline-table.js:61-63`](RETT/js/04-ui/baseline-table.js#L61) | `_num('sale-price')`, etc. (3) | Page 2 Tax Baseline tile math | Sum across all property blocks |
| [`controls.js:800-802`](RETT/js/04-ui/controls.js#L800) | `parseUSD($('sale-price').value)` etc. (3) | (untested fn — needs read) | Sum |
| [`controls.js:1347`](RETT/js/04-ui/controls.js#L1347) | `getElementById('accelerated-depreciation')` | `syncPayment` (Cover-Tax-Bill auto-default) | Sum across all `#accelerated-depreciation-N` |
| [`controls.js:1544-1546`](RETT/js/04-ui/controls.js#L1544) | sale/basis/depr (3) | `_estimatedSaleTax()` → drives Available Capital reduction | Sum across all properties |
| [`controls.js:1582-1591`](RETT/js/04-ui/controls.js#L1582) | `sale-price` | `_recomputeAvailableCapital` → derives `#available-capital = saleVal − keep − taxCarveOut` | Sum sale-price across all properties |
| [`controls.js:1656`](RETT/js/04-ui/controls.js#L1656) | Field-list for listeners | Triggers `_recomputeAvailableCapital` on changes | Add `-2/-3` IDs to listener list |
| [`narrative-render.js:139-141`](RETT/js/04-ui/narrative-render.js#L139) | sale/basis/depr (3) | Narrative card text | Sum |
| [`cashflow-schedule-render.js:288-296`](RETT/js/04-ui/cashflow-schedule-render.js#L288) | sale/basis/depr/dates (5) — fallback when cfg doesn't carry | Cashflow schedule rendering | Sum (or rely on aggregated cfg from inputs-collector) |
| [`projection-dashboard-render.js:332`](RETT/js/04-ui/projection-dashboard-render.js#L332) | `cfg.salePrice \|\| $('sale-price').value` | Visual rendering — fallback path | Sum in the fallback |
| [`input-validation.js:33-35`](RETT/js/04-ui/input-validation.js#L33) | sale/basis/depr (3) | "basis cannot exceed sale price" validation | Validate per-property, surface error per block |
| [`inputs-collector.js:106-114`](RETT/js/04-ui/inputs-collector.js#L106) | Primary cfg builder | Source of truth | **This is the aggregator** — sum here, downstream cfg-only readers auto-correct |

## Engine-side consumers (read aggregated cfg — no change needed)

These read `cfg.salePrice`, `cfg.costBasis`, etc. from the cfg object built by `inputs-collector`. **As long as inputs-collector returns the correct aggregate, engine code works unchanged**:

- `js/02-tax-engine/tax-comparison.js` — all sale-math sites
- `js/02-tax-engine/engine-self-test.js`
- `js/03-solver/structured-sale.js`
- `js/03-solver/decision-engine.js`
- `js/03-solver/calc-supplemental-extra.js`
- `js/05-projections/projection-engine.js`
- `js/01-brooklyn/time-weight.js`
- `js/04-ui/temp-page-render.js`
- `js/04-ui/supplemental-render.js`
- `js/04-ui/strategy-summary-render.js` (for the property-sale parts; future-sale is Part 1)

Math is linear: `Σ(sale_i − basis_i − depr_i) = Σsale_i − Σbasis_i − Σdepr_i`. Aggregation is mathematically safe.

## Behavior under each state — and the gotchas I found

| State | Behavior | Risk |
|---|---|---|
| **S1 — Property 1 only** | Aggregator sums P1 + 0 + 0 → identical to single-property today | ✅ |
| **S1' — Properties 1 + 2 both filled** | Aggregator sums P1 + P2 → engine sees combined gain | ✅ Math is linear |
| **S2a — Property 2 visible, sale-price empty, cost-basis filled** | If naive sum: `costBasis += P2.basis` but `salePrice += 0` → aggregate `ltGain = sum_sale − sum_basis − sum_depr` goes NEGATIVE | ⚠️ **Live baseline display would show §1211(b) loss offset transiently while user is mid-typing.** Confusing UX. |
| **S2b — Same partial entry — engine impact** | Most engines clamp `max(0, ...)` on LT gain so loss doesn't propagate. But `baseline-table.js:72` uses **signed** `ltGainSigned` for the §1211(b) loss-offset row | ⚠️ Baseline-table would briefly show a "phantom" loss offset |
| **S3 — Edit after entry** | Standard listener fires → aggregator re-runs → engine sees new aggregate | ✅ |
| **S4 — Remove a property** | If "Remove" clears fields AND hides the block, aggregator excludes it. If only hides (fields keep values), aggregator must check `block.hidden` | ⚠️ **Implementation detail** — choose clear-on-remove |

## Critical gotchas

### G1 — Partial-entry phantom loss (S2)
**Mitigation**: aggregator excludes properties where sale-price is 0. Pseudocode:
```js
function _sumPropertyField(baseId) {
  var ids = [baseId, baseId + '-2', baseId + '-3'];
  return ids.reduce((sum, id) => {
    var block = document.getElementById(id)?.closest('.property-block');
    if (block && block.hidden) return sum;
    var salePriceForBlock = block ? parseUSD(block.querySelector('[id^="sale-price"]').value) : 0;
    if (salePriceForBlock <= 0) return sum;
    return sum + (parseUSD(document.getElementById(id)?.value) || 0);
  }, 0);
}
```
Each property contributes nothing until its sale-price is non-zero. Matches user mental model.

### G2 — Date logic (staggered closes)
- **Sale date**: each property has its own. Engine `cfg.implementationDate` = earliest filled sale-date.
- **Strategy implementation date**: SINGLE field, applies to all. Constraint: must be ≥ LATEST sale-date across visible properties (otherwise Brooklyn deploys before all cash is in).
- [`controls.js:1313-1331`](RETT/js/04-ui/controls.js#L1313) currently sets `strategyDateEl.min = saleDateEl.value`. Must update to use the LATEST property sale-date.

### G3 — Brooklyn capital timing assumption
Engine treats aggregated `cfg.salePrice` as available on `cfg.implementationDate` (earliest sale-date). If Property 1 closes June and Property 2 closes October, engine assumes $13M is available in June. Reality: only $10M is available in June; $3M arrives in October.

**Impact**: overstates Brooklyn loss generation for the June-October window by ~$3M of capital × loss rate × 4 months ≈ low six-figure error on a realistic case.

**Mitigation A (ship-pre-Vegas)**: accept the approximation. Document in code. Typical staggered closes are within 30-60 days; error is small.

**Mitigation B (post-Vegas)**: pass `cfg.propertySchedule = [{date, salePrice, ...}]` for the time-weight calculator + projection-engine to consume. Engines that don't care about timing (most) ignore it.

### G4 — Computed-gain readout per property
Each block needs its own readonly `#computed-gain-N`. Listener updates on changes to that block's sale/basis/depr. Independent of the aggregator. Pure UI feedback.

### G5 — `_estimatedSaleTax()` aggregation
[`controls.js:1543-1579`](RETT/js/04-ui/controls.js#L1543) reads single-property values and runs federal+state tax engine. For multi-property: must sum sale/basis/depr before passing to the tax fns. Otherwise Cover-Tax-Bill carve-out from Available Capital is wrong (uses only Property 1's tax estimate).

### G6 — Listener registration for `_recomputeAvailableCapital`
[`controls.js:1656`](RETT/js/04-ui/controls.js#L1656) lists field IDs that trigger Available Capital recompute. Must add all `-2/-3` IDs:
```js
['sale-price', 'sale-price-2', 'sale-price-3',
 'cost-basis', 'cost-basis-2', 'cost-basis-3',
 'accelerated-depreciation', 'accelerated-depreciation-2', 'accelerated-depreciation-3',
 'implementation-date', 'implementation-date-2', 'implementation-date-3',
 ...existing...]
```

### G7 — Save/load
[`case-storage.js:43-44`](RETT/js/04-ui/case-storage.js#L43) field list adds 12 new IDs. Must also persist "is Property 2/3 visible?" flag so layout state restores. Legacy cases without these fields default to "Property 1 only" — backwards compatible.

### G8 — Input validation
[`input-validation.js:33-50`](RETT/js/04-ui/input-validation.js#L33) currently validates one property. Must run per-block:
- "Property 2: Cost basis cannot exceed sale price"
- Surface error with property name
- Disable Continue if ANY property has errors

## Risk: **M-to-L (medium-to-large)**. ~4-6 hrs implementation + ~1 hr testing each of S1-S4 across single + multi-property combinations.

---

# Comparing to Option C — "additional gains" instead of full per-property blocks

There's a simpler structural choice I want to flag before you commit:

## Option C: Property 1 stays detailed; additional properties = (estimated gain + date) pairs

Rather than 3 identical detailed property blocks, the UX could be:
- **Property 1**: full detailed entry (sale price, basis, depreciation) — exact UX today
- **"Have additional sales?"** toggle → reveals up to 3 additional **estimated-gain + date** pairs

```
Section 03: Real Estate Sale Details
  Property 1: [sale price] [cost basis (original)] [accel. depr. recap.] [LT gain readonly] [closing date]

  Additional sales?  [No ▼]
    ↓ if Yes:
    [+ Add another sale]
    Sale A: [Estimated Gain $] [Sale Date]
    Sale B: [Estimated Gain $] [Sale Date]
    Sale C: [Estimated Gain $] [Sale Date]
```

**Architectural payoff**:
- Aggregation simplifies — only Property 1 has the sale-basis-depr breakdown; additional sales contribute a single `estimatedGain` each. The same shape as the proposed Part 1 future-sale field.
- The 11 direct-DOM-reader sites in Part 2 only see Property 1's numbers — none need to change.
- New data flows through ONE channel: a new `cfg.additionalSales = [{date, estimatedGain}]` array.
- Engine handles it like a future-sale array — add each entry's gain to `absorbable` capacity, schedule by date.
- **Total blast radius: maybe 4 files** instead of 11+.
- Risk drops from M-to-L → S-to-M.

**Trade-off vs Blake's "Add Another Property"**:
- Blake said *"add an Add Another Property button so the same input block can be repeated (target 3+)"* — implying detailed blocks
- Option C is **less faithful to that wording**, but it captures the spirit (model multiple sales) with much simpler implementation
- For the lead with nine properties Blake mentioned: he can't realistically enter all 9 with full detail anyway — "estimated gain + date" for 8 of them is more realistic than asking for sale price, basis, depreciation × 9
- Converges nicely with the Future Sale simplification (same `{date, estimatedGain}` shape)

## Recommendation order:

1. **Decision needed first**: Option A (3 detailed blocks) or Option C (1 detailed + N estimated-gain entries)?
2. If A: Part 1 first (~1.5 hr), then Part 2 (~4-6 hr). Total ~6-8 hrs.
3. If C: Part 1 first (~1.5 hr), then Part 2-simplified (~2-3 hr). Total ~4-5 hrs. **And the data shape becomes consistent across both — `additionalSales[]` is a superset of `futureSale`, so they could even unify.**

## What I want you to think about before authorizing

Per state-by-state analysis, both options are buildable safely:
- **Option A** has more direct-DOM sites to update (11) but is more faithful to Blake's wording. Phantom-loss gotcha (G1) needs the per-block exclusion logic. Date logic (G2/G3) needs MAX-of-property-dates strategy clamp.
- **Option C** simplifies aggregation drastically and converges with the future-sale shape, but doesn't model staggered close timing per property (just per estimated sale date). Probably FINE because additional sales are estimates, not currently-closing deals.

Want me to recommend Option C? Reasoning:
1. Less code surface = less Vegas-blocker risk
2. Aligns with PDF spec for future-sale section (same shape)
3. The "9 properties" lead Blake mentioned won't enter all of them in detail anyway
4. Property 1 keeps the full advisor-trusted detailed entry for the *primary* sale (the one driving the strategy)
5. Easy to upgrade later if Blake wants full per-property fidelity

---

# Go/no-go decision matrix

| Item | Option | Risk | Time | Pre-Vegas |
|---|---|---|---|---|
| Part 1 (future-sale → estimatedGain) | only option | S | 1.5 hr | ✅ go |
| Part 2 — Option A (3 detailed blocks) | full fidelity | M-L | 4-6 hr | borderline |
| Part 2 — Option C (1 detailed + N gain entries) | simplified | S-M | 2-3 hr | ✅ go |

**My recommendation**:
- Ship **Part 1** before anything else (low risk, validates pattern, decoupled from Part 2)
- Then decide A vs C with full information
- If aiming for Tuesday: **strongly prefer Option C** for time + risk margin

---

*End of verification report. Ready to discuss approach + start Part 1 on your go.*
