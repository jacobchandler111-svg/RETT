# Additional Funds Optimizer — Engine Bot Implementation Script

**Date:** 2026-05-28
**Status:** UI built (inert inputs + display hooks live). Engine optimizer NOT implemented.
**Audience:** the engine bot. This is a step-by-step build script grounded in the actual plumbing (file:line cited), not a sketch.

---

## 0. The one function to implement

```js
window.rettSuggestAdditionalFunds = function () { ... return numberOrNull; };
```

The UI (index.html inline script, bottom of body) already:
- calls it on load + whenever sale-price / cost-basis / accelerated-depreciation / additional-account-value / additional-lt-gain / additional-st-gain / custodian-select / state-code / filing-status change (capture-phase listener),
- shows a "Use suggested: $X" button (`#additional-funds-suggest`) when it returns `> 0`,
- on click, writes the value into `#additional-funds` and fires input/change.

Return the suggested **liquidation amount** (dollars), or `null`/`0` when nothing helps.

---

## 1. Inputs you read (Tab 1 Section 03, all currently inert)

| Field | DOM id | parse with |
|---|---|---|
| Account Value | `additional-account-value` | `parseUSD` |
| Long-Term Gain (unrealized) | `additional-lt-gain` | `parseUSD` |
| Short-Term Gain (unrealized) | `additional-st-gain` | `parseUSD` (signed) |
| Additional Funds (contribution) | `additional-funds` | `parseUSD` |
| Toggle (Projection tab) | `additional-funds-toggle` | `.checked` |

Cost basis is derived in the UI = `accountValue − ltGain − stGain` (display only; you don't need it for the math).

**Proportional liquidation model (advisor-confirmed):** liquidating `$X` from an account worth `$AV` realizes:
- `ltRealized = X * (ltGain / AV)`
- `stRealized = X * (stGain / AV)`
- `basisReturned = X − ltRealized − stRealized` (no tax)

---

## 2. The plumbing you'll hook into (verified file:line)

### collectInputs — `js/04-ui/inputs-collector.js:279`
Assembles the cfg. Relevant fields:
- `availableCapital` (line 291) and `investment` (line 301) ← both read `#available-capital`
- `baseLongTermGain` (line 350) ← `#long-term-gain`
- `baseShortTermGain` (line 346) ← `#short-term-gain`
- `salePrice` / `costBasis` / `acceleratedDepreciation` (lines 363-365)

**Where to fold Additional Funds in (when toggle ON):** right after the cfg literal is built in `collectInputs`, before `return cfg`. Add:
```js
var _addFundsToggle = document.getElementById('additional-funds-toggle');
if (_addFundsToggle && _addFundsToggle.checked) {
  var _addFunds = parseUSD(_val('additional-funds')) || 0;
  var _acctVal  = parseUSD(_val('additional-account-value')) || 0;
  var _acctLT   = parseUSD(_val('additional-lt-gain')) || 0;
  var _acctST   = parseUSD(_val('additional-st-gain')) || 0;
  if (_addFunds > 0 && _acctVal > 0) {
    var _liq = Math.min(_addFunds, _acctVal);          // can't liquidate more than exists
    cfg.availableCapital += _liq;
    cfg.investment       += _liq;
    // triggered gains are new taxable income this year:
    cfg.baseLongTermGain  += _liq * (_acctLT / _acctVal);
    cfg.baseShortTermGain += _liq * (_acctST / _acctVal);
  }
}
```
This is the ONLY engine-side wiring needed for the contribution to take effect. Everything downstream (optimizer, tax engine, net benefit) already reads these cfg fields.

### Schwab combos — `js/00-data/schwab-strategies.js:53`
**These are the real minimums (NOT the generic brooklyn-data.js table):**
| Combo | id | minInvestment | lossByYear[0] |
|---|---|---:|---:|
| 145/45 | `beta1_145_45` | **$1,000,000** | 0.322 |
| 200/100 | `beta1_200_100` | **$3,000,000** | 0.590 |
(plus higher-leverage combos with $3M+ mins)

Helpers (already on `window`):
- `getSchwabCombo(comboId)` — `schwab-strategies.js:88`
- `listSchwabCombosForStrategy(strategyKey)` — `schwab-strategies.js:201`
- `getMinInvestment(custodianId, strategyKey, comboId)` — `custodians.js:95`

So "bump to 145/45" = get availableCapital to **$1,000,000**; "200/100" = **$3,000,000**.

### runBrooklynOptimizer — `js/03-solver/master-solver.js:476`
Signature: `runBrooklynOptimizer(cfg, brooklynCumulativeLoss, brooklynNetAtFull)`.
Internals you should mirror conceptually:
- `absorbable = currentLT + currentRecap` where `currentLT = salePrice − costBasis − accelDepr − shortTermPropertyGain` (line 481), `currentRecap = accelDepr` (line 493).
- `lossAtFull` = Brooklyn loss at full deployment (the caller passes it; per-entry it's `e.loss` from `_scenarioLossSum`).
- Dials Brooklyn DOWN when `lossAtFull > absorbable` (more loss capacity than gain). The Additional Funds feature is the inverse lever: when `lossAtFull < absorbable`, MORE capital (or a higher-lossRate tier) closes the gap. **Full-offset (Goal B) = solve for contribution where post-liquidation `lossAtFull ≥ absorbable` (absorbable now includes the triggered account gains).**

### buildInterestedSummary — `js/04-ui/projection-dashboard-render.js:2319`
Builds entries A/B/C; applies the optimizer per entry at lines 2761-2786; sets `entry.metrics.net`. **This is your net-benefit oracle** — to evaluate a candidate contribution, mutate the form (or a cfg clone), call `buildInterestedSummary()`, read the best `entry.metrics.net`.

---

## 3. Algorithm

```
function rettSuggestAdditionalFunds():
  read accountValue (AV), ltGain, stGain from the Additional Funds fields
  if AV <= 0: return null

  baseNet  = bestNetBenefit(contribution = 0)          # no additional funds
  candidates = []

  # ---- Goal A: Schwab tier-jump ----
  cfg = collectInputs()
  curCap = cfg.availableCapital
  for each combo in listSchwabCombosForStrategy(cfg.tierKey or 'beta1'):
     min = combo.minInvestment
     if min > curCap and (min - curCap) <= AV:          # reachable by liquidating
        gap = min - curCap
        candidates.push(gap)

  # ---- Goal B: full Year-0 offset ----
  # Solve smallest contribution C such that, AFTER folding C in,
  # Brooklyn's Y0 loss >= absorbable(C).
  # absorbable(C) = currentLT + currentRecap + C*(ltGain/AV) + C*(stGain/AV)
  # lossAtFull(C) grows with capital (curCap + C) and the combo unlocked at that capital.
  # Binary search C in [0, AV] (monotone enough for a clean bisection).
  fullOffsetC = binarySearchFullOffset(0, AV)
  if fullOffsetC != null: candidates.push(fullOffsetC)

  # ---- pick the winner ----
  best = null; bestNetGain = 0
  for C in candidates:
     C = min(C, AV)                                      # hard cap at account value
     net = bestNetBenefit(contribution = C)              # via buildInterestedSummary
     if (net - baseNet) > bestNetGain:
        bestNetGain = net - baseNet; best = C

  return best   # null if no candidate beats doing nothing
```

`bestNetBenefit(contribution)` helper:
```
- stash current #additional-funds value + toggle state
- set #additional-funds = contribution, ensure toggle is ON
- summary = buildInterestedSummary()
- net = max over summary.entries of entry.metrics.net
- restore #additional-funds + toggle
- return net
```
(Or clone the cfg and run the math directly to avoid DOM thrash — but the DOM-roundtrip is simplest and matches how the rest of the app recomputes.)

---

## 4. Constraints / gotchas

1. **Cap at account value** — `Math.min(contribution, AV)` everywhere. You can't liquidate more than the account holds. (UI already caps the proportional display.)
2. **Triggered gains MUST be added** to `baseLongTermGain` / `baseShortTermGain` when folding in the contribution (see §2 collectInputs snippet). Skipping this overstates net benefit — the liquidation creates real taxable gain.
3. **Toggle gate** — when `#additional-funds-toggle` is unchecked, zero engine impact. The suggestion function can still compute (it forces the toggle internally for its probes) but the live cfg must not fold anything in unless the user has the toggle on.
4. **Circular dependency (Goal B)** — more contribution → more capital → more Brooklyn loss, but also more triggered gain to absorb. Net absorbable gap shrinks slower than loss grows (loss scales with full lossRate, triggered gain only adds ltGain/AV+stGain/AV fraction), so a bisection on `lossAtFull(C) − absorbable(C)` converges. Watch the tier-unlock discontinuity: crossing a minInvestment threshold jumps the lossRate, so evaluate candidates at the combo that the post-contribution capital actually unlocks.
5. **Positive-net only** — return null when no candidate's net beats `baseNet`. The advisor only wants a suggestion when it genuinely helps (e.g. the tier-jump's extra loss capacity outweighs the tax on the triggered gains + the higher fees).
6. **Don't suggest below the current tier's own minimum** — if curCap is already below the lowest combo min, the suggestion should first get them to the lowest usable combo (existing engine behavior may already block sub-min deployment via `getMinInvestment` / `_belowMin`).

---

## 5. Worked example (advisor numbers)

Account $1,000,000 · LT $200,000 · ST $100,000 → basis $700,000 (proportions 20% / 10% / 70%).
Current available capital $900,000. 145/45 needs $1,000,000.

- **Goal A candidate** = $1,000,000 − $900,000 = **$100,000** (reachable, ≤ $1M account).
  - Liquidating $100,000 triggers $20,000 LT + $10,000 ST new gain.
  - New available capital $1,000,000 → unlocks `beta1_145_45` (lossRate 0.322 vs the sub-$1M long-only ~0.104).
  - `bestNetBenefit($100,000)` vs `baseNet`: if the jump from ~0.104 to 0.322 lossRate (≈3× more Brooklyn loss/$) outweighs the tax on $30K triggered gain + higher fees → suggest **$100,000**.
- The UI then shows "Use suggested: $100,000"; clicking it fills the box and the proportional breakdown shows $20K LT / $10K ST / $70K basis.

---

## 6. Acceptance checks

1. `rettSuggestAdditionalFunds()` returns the gap-to-next-reachable-tier when that jump raises best-entry net; `null` when it doesn't.
2. Never exceeds `#additional-account-value`.
3. With toggle ON + a contribution in `#additional-funds`: `collectInputs().availableCapital` rises by the (capped) contribution AND `baseLongTermGain` / `baseShortTermGain` rise by the proportional triggered gains.
4. Tab 4 net benefit + Tab 2 reflect the post-liquidation tax picture (triggered gains taxed, offset by the larger Brooklyn position).
5. Toggle OFF ⇒ `collectInputs()` identical to pre-feature (zero impact); the proportional breakdown still displays on Tab 1.
6. Combo minimums read from `getSchwabCombo()` ($1M / $3M), NOT the generic brooklyn-data.js table ($500K / $1M).

---

## 7. Files you'll touch

- `js/04-ui/inputs-collector.js` — fold contribution + triggered gains into cfg (§2 snippet), gated on the toggle.
- `js/03-solver/master-solver.js` or a new `js/03-solver/additional-funds.js` — implement `rettSuggestAdditionalFunds()` + the bisection. Expose on `window`.
- (No UI changes needed — the hooks, button, breakdown, and toggle are already in index.html / styles.css.)

The UI lights up automatically the moment `window.rettSuggestAdditionalFunds` exists and returns a positive number.
