# Additional Funds Optimizer — Engine Bot Spec

**Date:** 2026-05-28
**Status:** UI built (inert inputs + display hooks). Engine optimizer NOT implemented — this doc specifies it.
**Origin:** advisor wants a *suggested optimal contribution* auto-populated into the Additional Funds box on Tab 1.

---

## What the UI already provides

Tab 1 Section 03 "Additional Funds" (all `data-inert="true"` — engine doesn't read them yet):

| Field | ID | Meaning |
|---|---|---|
| Account Value | `additional-account-value` | Current value of a taxable investment account the client could tap |
| Long-Term Gain | `additional-lt-gain` | Unrealized LT gain embedded in the account |
| Short-Term Gain | `additional-st-gain` | Unrealized ST gain (loss = negative) |
| Cost Basis | `additional-cost-basis-derived` | **Derived live**: account value − LT − ST (read-only) |
| Additional Funds | `additional-funds` | Amount to liquidate from the account & deploy |

**Funding model (advisor-confirmed):** the Additional Funds contribution is **liquidated from the account**, so it triggers **proportional** gains. Liquidating $X from an account worth $AV with $LT LT gain + $ST ST gain realizes:
- `ltRealized   = X × (LT / AV)`
- `stRealized   = X × (ST / AV)`
- `basisReturned = X × (basis / AV)` (no tax)

The UI already renders this proportional breakdown live (`#additional-funds-breakdown`).

**Projection toggle:** `#additional-funds-toggle` (small checkbox by the Projection headline). When ON, the deployed contribution should become additional Brooklyn available capital.

---

## What the engine bot needs to build

### 1. `window.rettSuggestAdditionalFunds()` → number | null

Returns the **suggested optimal liquidation amount**. The UI calls this and shows a "Use suggested: $X" button next to the Additional Funds box (already wired — `#additional-funds-suggest`). Return `null` (or 0) when no suggestion improves things.

The function should **solve for the smallest contribution** that achieves whichever of these two goals is reachable and net-benefit-positive:

#### Goal A — Schwab tier-jump
If the client's current available capital sits just below a higher-leverage Schwab combo minimum (e.g. $900K when the 200/100 combo needs $1,000,000), and contributing the gap **increases net benefit**, suggest the gap amount.

- Read the combo minimums from the custodian/combo data (same `minInvestment` the Brooklyn tier-jumping logic already uses — see `project-rett.md` "Brooklyn tier-jumping").
- Candidate suggestion = `nextTierMin − currentAvailableCapital`.
- **Validate it pays off**: run the optimizer with availableCapital bumped by the candidate (and the triggered account gains added — see below) and confirm net benefit rises vs. not contributing. If net benefit drops (fees/triggered-gain outweigh the better leverage), don't suggest it.

#### Goal B — Full Year-0 offset
The contribution lets Brooklyn generate enough loss to **fully absorb the gain in Year 0** (so the client doesn't have to defer into a structured/installment multi-year path).

- Solve for the contribution where Brooklyn's Y0 loss generation ≥ the total Y0 taxable gain (real-estate sale gain + recapture + the **newly-triggered account gains** from liquidating the contribution itself).
- This is circular: more contribution → more capital → more Brooklyn loss, BUT liquidating more also realizes more account gain to offset. Solve the fixed point (binary search on contribution amount is fine).

#### Picking between A and B
Suggest whichever yields the higher net benefit. If neither beats "contribute nothing," return null.

### 2. Constraints

- **Cap at account value**: the suggestion can't exceed `additional-account-value` (you can only liquidate what's there). The UI already caps the proportional display at account value.
- **Account the triggered gains**: when you add the contribution to available capital, you MUST also add the proportional `ltRealized` + `stRealized` to the gain the strategy has to offset (they're new taxable income that year). Net benefit must be computed on the post-liquidation tax picture.
- **Respect the toggle**: only fold the contribution into available capital when `#additional-funds-toggle` is checked. When unchecked, the Additional Funds inputs are display-only (proportional breakdown still shows, but no engine impact).

### 3. Wiring the contribution into the engine (when toggle ON)

In `inputs-collector.js` (or wherever `availableCapital` is assembled):
- `availableCapital += parseUSD('#additional-funds')` when toggle checked.
- Add the triggered account gains to the year-0 gain buckets:
  - `baseLongTermGain += ltRealized`
  - `baseShortTermGain += stRealized`
  - (basisReturned adds nothing taxable)
- Recompute as normal. The Brooklyn optimizer then sees the larger capital + larger gain.

---

## Worked example (advisor's numbers)

Account Value $1,000,000 · LT gain $200,000 · ST gain $100,000 → basis $700,000.
Proportions: LT 20%, ST 10%, basis 70%.

- Liquidate $10 → realizes $2 LT + $1 ST + $7 basis. ✓ (matches advisor's "$10 sold = $2/$1/$7")
- Suppose current available capital is $900K and the 200/100 tier needs $1,000,000. Candidate Goal-A contribution = $100,000.
  - Liquidating $100,000 realizes $20,000 LT + $10,000 ST (new taxable gain).
  - New available capital = $1,000,000 → unlocks 200/100 leverage.
  - Engine bot validates: does the net benefit with 200/100 (minus tax on the $30K triggered gain, minus fees) exceed the net benefit at 145/45 with no contribution? If yes → suggest $100,000.

---

## UI integration points (already in place)

- `window.rettSuggestAdditionalFunds()` — implement this; UI auto-shows the suggest button when it returns > 0.
- The suggest button populates `#additional-funds` and fires input/change so the proportional breakdown updates.
- The UI re-polls the suggestion whenever sale-price / cost-basis / depreciation / account fields / custodian / state / filing-status change (capture-phase change listener already added).
- `#additional-funds-toggle` on the Projection page — read this to decide whether to fold the contribution into available capital.

---

## Acceptance checks

1. `rettSuggestAdditionalFunds()` returns the gap-to-next-tier when that tier-jump raises net benefit; null when it doesn't.
2. Suggestion never exceeds account value.
3. With toggle ON + a contribution, availableCapital rises by the contribution AND baseLongTermGain/baseShortTermGain rise by the proportional triggered gains.
4. Net benefit shown on Tab 4 reflects the post-liquidation tax picture (triggered gains taxed, offset by the larger Brooklyn position).
5. With toggle OFF, zero engine impact (proportional breakdown still displays).
