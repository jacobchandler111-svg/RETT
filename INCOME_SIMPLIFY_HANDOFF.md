# Income Simplification — Engine Bot Handoff

**Date:** 2026-05-27
**UI commits:** `e758436` (HTML simplification) + `8e3768d` (admin panels)
**Origin:** advisor request "we're just going to have business income and treat it as just... and instead of doing qualified dividends and unqualified just do dividends"
**Scope:** UI is done. Engine routing needs to follow.

---

## TL;DR for the engine bot

The advisor pulled back two recently-wired tax distinctions. The visible
form fields and the admin math panel are already updated. The engine
hasn't been touched — it will still read the old hidden inputs (which
now sit at 0) and silently lose qualified-dividend preferential
treatment + SE tax. That's the intended interim behavior; please make
it the intended PERMANENT behavior by deleting the dead routing.

Two single-field merges:

| Was | Now |
|---|---|
| `dividend-income` (ordinary) + `qualified-dividends` (preferential) | `dividend-income` only — treat the whole amount as ordinary investment income |
| `business-income-amount` + `business-income-type` (radio: se / k1-scorp / k1-partnership-lp / k1-partnership-gp) | `business-income-amount` only — treat as plain ordinary income, no SE tax routing |

---

## What I changed (UI side)

### 1. HTML — Tab 1 Income Sources (`index.html`)

- **Qualified Dividends row deleted.** The `<input id="qualified-dividends">` survives as a hidden input (`value=""`) so any engine code still reading it gets `0`.
- **Ordinary Dividends → Dividends** label change. ID `dividend-income` unchanged.
- **Business Income type radio block deleted.** No more "What type?" reveal, no more radios. The `<input id="business-income-amount">` is now a standalone field.
- **Inline business-income reveal script deleted.** Dead code (it toggled the now-gone radio block).
- **Hidden inputs preserved**: `se-income` and `biz-revenue` still in the DOM (both `value=""`) — for back-compat with anything that hasn't migrated yet.

### 2. Admin math panel — Tab 1 (`admin-math-page-inputs.js`)

- Dropped the `Qualified Dividends` and `Business Income Type` raw-read rows.
- Renamed `Ordinary Dividends` row → `Dividends`.
- Removed the SE tax derivation block entirely (`seBase = amount × 0.9235`, half-SE deduction row, SE-eligible business income row).
- Fixed runtime crash: leftover `bizType` references after the variable was deleted were throwing `bizType is not defined` and breaking the entire admin panel render.

### 3. Admin math panel — Tab 4 (`admin-math-page-projection.js`)

Relabel only — no math change. The per-year totals row at the bottom of the per-year engine table is now labeled **"Raw engine net"** (was misleadingly called "NET BENEFIT" and competed visually with the "Net benefit (on card)" row above it). See the *Discrepancy* section below for what causes the two numbers to differ.

---

## What the engine needs to do

### Required (otherwise math is silently wrong)

**1. Drop the qualified-dividend preferential-rate path.**

In `inputs-collector.js`, find where `qualified-dividends` is read and removed from `cfg.qualifiedDividend`. Either:
- Delete that read entirely so `cfg.qualifiedDividend` doesn't exist, OR
- Read it as `0` (since the hidden input is empty, this happens naturally).

In `tax-calc-federal.js:computeFederalTaxBreakdown`, the `opts.qualifiedDividend` parameter should be deprecated. The variable `ltAmount` should drop the `+ qualifiedDividend` term that was added in commit `7571c85` ("Wire #2: qualified-dividends end-to-end").

In `baseline-table.js` and any other caller, drop the `qualifiedDividend` opts pass-through.

**Why:** the advisor explicitly said "just do dividends" — no preferential rate logic. Whatever the client enters in the Dividends field stacks into ordinary income (same as before the qualified-div wiring), period. Leaving the code wired but the input at `0` works today but is fragile — any code path that later reads the hidden input directly will get an unexpected branch.

**2. Drop the SE tax / K-1 type dispatch.**

In `inputs-collector.js`, the routing that reads `input[name="business-income-type"]:checked` and routes `business-income-amount` into either `cfg.wages` (for SE / GP) or `cfg.baseOrdinaryIncome` only (for S-corp / LP) should collapse to: **all business income → `baseOrdinaryIncome`, never `cfg.wages`**.

In `tax-calc-federal.js`, the `_computeSelfEmploymentTax` helper (added in commit `210be7a` "Wire #4: business-income + type radio + SE tax (§1401)") should be unwired from the breakdown. Either delete the call site or make it return `{ seTax: 0, halfDeduction: 0 }` for now. The function itself can stay in case it's needed later.

The half-SE above-the-line adjustment that was being added to AGI should also go away.

**Why:** the advisor said "we're not even going to take into consideration if it's self employment or K1 or any of that." Business income becomes plain ordinary income, full stop. No SE tax (12.4% + 2.9%), no half-deduction, no NIIT exclusion based on material participation, none of it.

### Optional cleanup (nice to have, not required for correctness)

- Delete the now-unused hidden inputs (`qualified-dividends`, `se-income`, `biz-revenue`) once you've verified no caller reads them.
- Update `INCOME_SOURCES_RESEARCH.md` (the original wiring handoff doc) to mark sections 3 and 4a-4d as **deferred / not implemented per advisor 2026-05-27**.
- The `cfg.qualifiedDividend` and `cfg.businessIncomeType` keys can be retired.

---

## Why these specific simplifications

These were not arbitrary. The advisor's framing:

- **Dividends merge**: the client-facing conversation doesn't surface preferential rates at this stage. The Tax Doc Import path on Tab 1 hadn't been wired to split a 1040 Line 3a vs 3b reading anyway, so requiring the advisor to manually split was advisor cost with no client conversation upside.
- **Business income type collapse**: the advisor said the SE / K-1 distinction adds clicks but doesn't change which strategy gets recommended. Strategies that gate on business ownership (PTET, Augusta, 401k, etc.) only care *whether* there's business income, not the entity type. The PMQ questionnaire that was the upstream filter was just removed in commit `5429254`, so we're consistent with that direction.

This is a deliberate scope reduction. Not a bug — a product decision the advisor wants honored.

---

## The Tab 4 fee/net discrepancy — context for engine bot

While investigating the simplification, I confirmed the F1 finding from `QA_REPORT_2026-05-27.md` is still live and the advisor noticed it on their own.

For **Strategy A on the canonical $5M / $1M / MFJ / GA / Jan 1 scenario**:

| Source | Brooklyn Fees | Brookhaven Fees | Net |
|---|---:|---:|---:|
| Tab 4 card (uses `ProjectionEngine.run`) | $65,500 | $53,000 | $744,461 |
| Admin per-year table (uses `unifiedTaxComparison.totalFees`) | $101,500 | $53,000 | $708,461 |
| **Delta** | **$36,000** | $0 | **$36,000** |

`ProjectionEngine.run` computes Brooklyn fees for the **actual hold period** (Strategy A unwinds the position when the sale closes — a partial-year hold). `unifiedTaxComparison` accrues fees **annually per row**, treating horizon=1 as "1 full year of fee accrual."

Both engines are mathematically self-consistent; they just answer slightly different questions. The card's answer (actual hold-period accrual) is the one the advisor wants to show clients. The per-year table's answer is useful for CPA verification of the raw engine math.

**My admin fix relabels the per-year totals row** so the two numbers don't visually compete. The deeper question — should there be ONE canonical fee engine for Strategy A? — is a refactor I'm not proposing here. It's been sitting in the QA report as an "open architectural question" item.

If you want to close that gap: pick one engine as canonical for Strategy A's fee accrual and route the other call site through it. The cleanest direction is probably to have `unifiedTaxComparison`'s row-level `r.fee` reflect actual hold-period economics (matching ProjectionEngine), but it's an invasive change.

---

## Verification I ran

- Tab 1 Income Sources renders 9 labels: W-2 / Interest / Dividends / Retirement / Social Security / Rental / Short-Term CG / Long-Term CG / Business Income. No qualified-div row visible. No business-type radios visible.
- `qualified-dividends` field still findable via `document.getElementById('qualified-dividends')` with `type === 'hidden'` and `value === ''`.
- Admin Tab 1 panel renders without errors. Income section shows 7 rows (was 9). Derived section no longer shows SE tax / half-SE rows.
- Admin Tab 4 per-year table bottom row reads "Raw engine net — pre-optimizer, full-year fee accrual (may differ from Net benefit (on card) above...)".
- Engine math still computes correctly on the canonical scenario (totalBaseline = $1,672,316 for MFJ GA Jan 1).

---

## File pointers

- `index.html` — Tab 1 Income Sources block (around the `<!-- Dividends -->` and `<!-- Business Income (simplified... -->` comments)
- `js/04-ui/admin-math-page-inputs.js` — the cleaned-up income rows + derived section
- `js/04-ui/admin-math-page-projection.js` — the relabeled "Raw engine net" row
- `INCOME_SOURCES_RESEARCH.md` — original wiring handoff (now partially superseded)
- `QA_REPORT_2026-05-27.md` — fee engine discrepancy was F1 there

---

## TL;DR for what to commit

Two engine commits:

1. **Drop qualified-dividend preferential-rate routing**: undo commit `7571c85` for the LTCG-bracket extension and the NIIT-route. Keep `dividend-income` reading the way it was before that commit (ordinary brackets + NIIT base).

2. **Drop business-income SE-tax routing**: undo the `cfg.wages` injection from commit `210be7a` and bypass `_computeSelfEmploymentTax`. Business income reads through `baseOrdinaryIncome` only.

After both: regression-test the canonical scenarios. Numbers should drift slightly from the post-wiring baseline (less tax overall for clients with qualified-div or SE business income, since both removals lower their tax burden by removing the preferential-rate offset / SE tax addition). Cross-reference with the Tab 4 card net.
