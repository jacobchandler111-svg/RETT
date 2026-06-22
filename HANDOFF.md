# RETT — Builder Session Handoff
*Written 2026-06-22. HEAD `2b68d85` on `main`. Stack: vanilla HTML/CSS/JS, no build.*

---

## 🔥 To the next session: read this first

You're the builder. The advisor wants to go **deep** next — a "more advanced line of thought," a serious, dedicated build session. That means real architecture work, not a one-line tweak. Good. You are *built* for this.

Here's the truth: this codebase is large (~33k LOC) but it is **well-organized, heavily commented, and you already have a map** (this file + a deep set of memory notes). Every gnarly part has a comment explaining *why*. The engine ties out to the dollar. The advisor is sharp, fair, and gives crisp corrections — when something's off they'll tell you exactly what they saw, and when you nail it you'll hear it. You will not be flying blind.

Work the loop, verify everything with live DOM probes, commit each coherent chunk, and trust the advisor's math instinct (it's excellent). You've got this. Now let's build something great.

---

## Mission / how the advisor works

- **Brutal math honesty.** When a number doesn't tie out, say so plainly with the evidence. They caught real bugs this session by noticing fees didn't match recognition, a 400% ROP that should've been 243%, and a coverage model that over-credited a future sale. Match that rigor.
- **Verify before claiming done.** Always reproduce live (preview_eval DOM probes — screenshots time out on this project) and prove no regression.
- **Commit + push every coherent chunk** without being asked (see `feedback-commit-push-workflow` memory). Don't sit on local changes.
- **Less-is-more UI.** They repeatedly ask to *remove* words/cards/options. Tight semantics. CSS-only when possible.
- **They'll give you the model in their words** — your job is to translate it faithfully into math and verify it with their examples.

---

## Pickup checklist (do this first, in order)

1. Read the memory index `MEMORY.md`, then these in order: `rett-session-handoff`, `project-rett`, `feedback-rett-working-style`, `feedback-rett-optimizer`, `feedback-commit-push-workflow`, `rett-future-sales-estimator`, `rett-delphi-honest-benefit-fix`, `feedback-rett-test-before-after`.
2. `cd "C:/Users/jacob/OneDrive/Desktop/Claude Code/RETT" && git log --oneline -15 && git status` — confirm `2b68d85` is HEAD on origin/main, clean tree. (NOTE: a parallel agent has historically also committed here — `git pull`/`status` before work.)
3. `preview_start` name `rett-static` (port 8765, root = the RETT dir). Browse `http://localhost:8765/`.
4. **Cache-busting is mandatory.** Every JS/CSS file is loaded with `?v=NNN` in `index.html`. If you edit a file and DON'T bump its `?v=`, `location.reload()` serves STALE code and your change silently does nothing (this has wasted long debug sessions). After editing `js/foo.js`, bump its `?v=` token in index.html to a higher number. (Tokens vary per file now; just increment the edited file's.)
5. Wait for the advisor's direction on the "advanced" build. Don't pre-build.

---

## Architecture map (load order = dependency order)

Subsystems load in `index.html` in this order; later layers depend on earlier ones.

- **`00-data`** — static catalogs. `schwab-strategies.js` (the only 2 allowed leverage combos + per-year loss curves), `custodians.js` (Schwab only; Goldman hidden).
- **`01-brooklyn`** — the loss-harvest model. `brooklyn-data.js` (leverage tiers + lossRate + minInvestment regression points), `brooklyn-interpolation.js`, `time-weight.js` (day-weighted tranche aging), `fee` lives in solver. `date-utils.js`, `variable-leverage.js`, `defaults.js`.
- **`02-tax-engine`** — `tax-calc-federal.js` (710 LOC: brackets, LTCG, NIIT, AMT, Add'l Medicare, recapture, SE), `tax-calc-state.js` (`computeStateTax`, LTCG-preferential states), **`tax-comparison.js` (2251 LOC — the heart): `unifiedTaxComparison(cfg, opts)`**, `tax-lookups.js`/`tax-data.js`/`tax-loader.js`, `engine-self-test.js`.
- **`03-solver`** — `fee-split.js` (`brooklynFeeRateFor(longPct,shortPct)` — the single source of truth for fees), `brookhaven-fees.js`, `single-year-solver.js` / `multi-year-solver.js` / `structured-sale.js` (the Strategy A/B/C math), `calc-delphi.js` / `calc-oil-gas.js` / `calc-supplemental-extra.js` (the supplemental strategies), `decision-engine.js`, **`master-solver.js` (1228 — supplemental registry + `runMasterSolver`)**, `additional-funds.js`, `supplemental-defaults.js` / `-registry.js` / `-investment-shims.js`.
- **`05-projections`** — `projection-engine.js` (`ProjectionEngine.run`), `carryforward-tracker.js`.
- **`04-ui`** — input pipeline (`inputs-collector.js`, **`controls.js` 2666 — `runFullPipeline()`, `showPage()`, `collectInputs()`**), per-page renderers (below), `format-helpers.js`/`money-format.js`/`number-animator.js`, `admin-math-*` (the admin reveal panels), `case-storage.js` (save/load cases).

### The data flow (one cycle)
1. User edits inputs → `collectInputs()` builds a `cfg`.
2. `runFullPipeline()` (controls.js:1093): runs the recognition optimizer → `runRecommendation()` → `ProjectionEngine.run` → patches `cfg` with the **auto-picked combo** (leverage/horizon/comboId/recognition) for the chosen strategy (gated by `__rettAutoPickEnabled`).
3. The active page's render function reads the engine output and paints.
4. **Tab 6/7 combined view**: `buildInterestedSummary()` (projection-dashboard-render.js) runs `unifiedTaxComparison` per interested strategy, applies the **Brooklyn optimizer dial-back**, then `runMasterSolver()` layers supplementals. This is the authoritative source for the Strategy Summary hero + Temp reconciliation.

### `unifiedTaxComparison(cfg, opts)` — the engine contract
- **In:** `cfg` with `salePrice, costBasis, acceleratedDepreciation, investment` (= Available Capital), `leverage`/`leverageCap`/`comboId`, `horizonYears`, `year1`, `filingStatus`, `state`, income fields, and strategy markers (`recognitionStartYearIndex` ≥ 1 ⇒ deferred/Strategy C; `installmentPayments` ⇒ Strategy B; `structuredSaleDurationMonths` = 36 locked).
- **Out:** `{ rows: [...perYear {baseline, withStrategy, ltOffsetApplied, ordOffsetApplied, ...}], totalSavings, ... }`. `totalLT = salePrice − costBasis − acceleratedDepreciation − shortTermPropertyGain`; `recapture = acceleratedDepreciation` (§1250, taxed Y0).
- **Strategy A** = immediate, single Y0 tranche of full available capital, horizon 1. **B** = §453 installment (N∈{1,2,3} Jan-1 payments, no Y0 Brooklyn tranche). **C** = structured/MetLife, locked 36mo / 40-40-20 / rec=2.

### Brooklyn loss model (memorize)
- Schwab is **beta1-only** with exactly **two combos**: **145/45** (min $1M, year-1 loss = **0.322**/$ of capital) and **200/100** (min $3M, year-1 loss = **0.590**/$). Per-year curves decline (`schwab-strategies.js` `lossByYear`); a dollar generates loss **every year it sits**, cumulatively.
- Fees (annual, % of capital): **145/45 = 0.68%**, **200/100 = 1.31%** (`fee-split.js` `SCHWAB_BETA1_FEES`). Brookhaven engagement fee = $45k setup + $2k/qtr × 8.
- `brooklyn-data.js` has more tiers (beta0/beta05/advisorManaged) used by the regression/proxy decay, but the UI/Schwab path only uses the two beta1 combos.

---

## Page-by-page (nav numbers 0–7, advisor-numbered)

| # | id | What's on it | Main render file(s) |
|---|----|--------------|---------------------|
| 0 | `page-pmq` | Pre-Meeting: Client Info (incl. Custodian = Schwab). PMQ = **one** question: "Do you own/run a business?" | `pmq-handler.js`, `pmq-questions.js` |
| 1 | `page-inputs` | Client Inputs: 01 Filing, 02 Income, 03 Real Estate Sale, 04 **Future Sale** (now just a yes/no — details moved to Tab 6) | `controls.js`, `inputs-collector.js` |
| 2 | `page-baseline` | Tax Implications: "Tax Due from the Sale" hero + keep-vs-tax donut (denominator = salePrice; blue=keep, red=tax) | `baseline-table.js` |
| 3 | `page-strategies` | Strategy Selection: 3 cards (A "Normal Sale"/B/C). Card hides if net ≤ 0 or ≤ prior card | `recommendation-render.js`, `pill-toggles.js` |
| 4 | `page-projection` | Projection: per-strategy engine cards, cashflow schedule, narrative. **STANDALONE** full-capital net (holds when supps toggle) | `projection-dashboard-render.js`, `cashflow-schedule-render.js`, `narrative-render.js`, `savings-ribbon.js` |
| 5 | `page-supplemental` | Supplemental Strategies: unified grid (oilGas, delphi, ptet, slot07 Equip-Leasing, slot08 Augusta, slot12 Farm…). Click badge to hide; toggle interest | `supplemental-render.js`, `supplemental-extra-render.js` |
| 6 | `page-allocator` | **Strategy Summary** (the COMBINED view): Selected Strategy + Supplementals (now one full-width block), Net Benefit hero, Return on Planning, walk-away tiles, Fees Baked In, **Future Sales Estimator**, Grow Your Net Benefit | `strategy-summary-render.js` (2004) |
| 7 | `page-temp` | Temporary: per-year reconciliation table that ties to the Tab-6 hero to the dollar; fee panel | `temp-page-render.js` (1958) |

- **Admin reveal mode**: double-click the RETT logo → passcode → `__rettAdmin`. Per-page math panels in `admin-math-page-*.js`. Admin reads POST-optimizer values from `buildInterestedSummary().entries[i].metrics`, NOT raw `unifiedTaxComparison`.

---

## Key window state / globals (don't break)

- `__rettChosenStrategy` `'A'|'B'|'C'`; `__rettStrategyInterest {A,B,C}`; `__rettSupplementalInterest {oilGas,delphi}`; `__rettSupplementalExtraInterest {ptet,slot07,slot08,slot12,...}`.
- `__rettSupplemental[id].lastResult` — per-supp calc output (the master-solver reads this). `__rettSupplementalExtra[id]` — extra-supp state.
- `__rettSuppHidden` (click-to-hide, not persisted); `__rettSuppSetupFees` (Brookhaven flat fees, persisted); `__rettAdmin`; `__rettAutoPickEnabled`; `__rettBrooklynInvestmentOverride`.
- `__rettFutureSalesPlanner` (array of `{date,salePrice,costBasis}`, persisted to localStorage `rettFutureSalesPlanner`).
- Filing status key is **`'hoh'`** not `'head'`.

---

## The Future Sales Estimator (this session's big build — full spec)

A standalone, informational tool on the Strategy Summary (Tab 6), gated on the Page-1 future-sale yes/no. **Does NOT touch the engine or the net-benefit hero** (the optimizer hardcodes futureGain=0, master-solver.js ~1029). Lives in `strategy-summary-render.js` (`_renderFutureSalesPlanner` + `_fsp*` helpers; CSS `.fsp-*`). Columns: Planned date · Sale price · Cost basis · Gain · Est. tax owed · **Covered by current sale** · **We could save you**.

**The coverage math (advisor-confirmed, iterated heavily — get this right):**
- **Tax rate** = 23.8% federal LTCG+NIIT + the client's state top rate (via `computeStateTax` on a large reference gain). `tax = gain × combinedRate`.
- Each future sale is offset by **two sources**:
  1. **Carryforward from the CURRENT sale** ("Covered by current sale"): the existing position's excess loss by the sale year = `fullAvailableCapital × cumLoss(currentCombo, N) − currentGain`, where N = years-until-sale (from the date). **Grows with lead time.** Uses the FULL available capital (assume fully invested), not the dialed-back deployment.
  2. **The future sale's OWN proceeds**, redeployed: combo by proceeds (≥$3M → 200/100, else 145/45). **Only works the SALE YEAR — one year of loss** (~59%/32%), capped at the proceeds. More lead time does NOT help this piece.
- **Shared-pool allocation** (`_fspComputePortfolio`, 3 passes):
  - Pass 1: each sale self-covers from its own proceeds.
  - Pass 2: the current sale's carryforward fills **shortfalls first** (sales that can't self-cover), chronologically — so a small sale right after a big self-covering one still gets covered.
  - Pass 3: **leftover carryforward "rides"** on self-covering sales, displacing the proceeds they'd deploy (cuts fees — "invest less"). Never wasted.
- `netSaved = coveredTotal × rate − fees` (carryforward is free; fee only on deployed proceeds, one year). The %-saved falls as gain outgrows the pool — a near-100%-gain sale on a short fuse can't be fully wiped.
- **Commits to study:** `9e667e5` (feature) → `f5eb4d1` (1-yr proceeds) → `074ba6b` (full-capital) → `958700e` (self-cover first) → `478a4c1` (leftover rides) → `1b1c150` (loss-gen cap). Full detail in memory `rett-future-sales-estimator`.

---

## Other fixes this session (context)

- **Delphi net-benefit honesty** (`461cfdc`): the honest recompute ignored Delphi's added LT gain/QD → overstated hero+Temp by ~$283K. Fixed with `min(solver, recompute)` at the 2 override sites. See memory `rett-delphi-honest-benefit-fix`.
- **Temp gross/fee restructure** (`ef0e1bc`): Tab 7 now shows supplemental **gross** + Delphi fund fee as its own line (gross − all fees = net).
- **ROP denominator** (`2b68d85`): Return on Planning now divides by the **full** Total Fees (incl. supplemental management fee), not just Brooklyn+setup. Was reading ~400% instead of ~243%.
- **Tab-2 donut colors** → §1250 cyan `#5ba9ff`. **Selected Strategy + Supplementals** merged into one full-width block. Future-sale callout retired; Page-1 reduced to a yes/no.

---

## Gotchas / invariants — DON'T break

- **Cache-bust after every edit** (see checklist #4). #1 source of "my change did nothing."
- **Screenshots time out** — use `preview_eval` DOM probes for all verification.
- **`renderStrategySummary` has an `.fsp-input` focus guard** (skips re-render while a Future-Sales input is focused) — removing it reintroduces the "type, then it poses out" bug. Document-level input listeners (`_scheduleP5Refresh`, `_afterRecompute`) re-render Tab 6 on ANY input.
- **Admin reads post-optimizer `entry.metrics`**, not raw `unifiedTaxComparison` (they diverge: `runBrooklynOptimizer` dials back in place).
- **Supp benefit display**: `min(solver, recompute)` guard (Delphi). Don't let the recompute raise the number above the solver's realized total.
- **Optimizer is honest-net-optimal in practice** (memory `rett-optimizer-empirical-audit`) — don't chase ~0.2% micro-opts in the hot path.
- **AMT LTCG stacking** is an intentional departure from Form 6251 line 44 (memory `project-rett-amt-ltcg-stacking`) — don't "fix" it.
- **Brooklyn-first recapture**, **excess-loss fee credit**, **additional-funds per-strategy rule** — all have dedicated memories; read before touching those pools.

---

## How to work (the loop)

1. Advisor describes the change (often the *model* in their words).
2. Edit with Read/Edit/Grep (not Bash sed/grep). Match surrounding code style.
3. **Bump the edited file's `?v=` in index.html.**
4. `preview_eval` to reproduce + verify (canonical scenario: $10M sale / $9M basis / $1M W-2, Strategy A, Delphi interested → drive inputs, navigate via `.nav-tab` clicks, read DOM). For Tab-6 reads, call `window.renderStrategySummary()` after setting state (tab-click renders can be async). Probe `.net-hero-amt`, `.fsp-*`, the temp fee rows, etc.
5. Check `preview_console_logs` level error.
6. `git add <specific files>` → commit with a clear HEREDOC message ending `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>` → `git push origin main`.
7. End-turn: 1–2 sentence summary + latest commit hash. Update/create memory for non-obvious findings.

**Reconciliation invariant to keep:** Tab 6 Net Benefit hero == Tab 7 "Net benefit" (the panel shows a "✓ matches" check). If you touch supp benefit, fees, or the optimizer, re-verify this ties to the dollar.

---

## You're ready

You have the map, the memories, the engine contract, the page layout, the gotchas, and a clean tree at `2b68d85`. The advisor is engaged and precise — lean on their examples to verify, and tell them honestly when the math doesn't tie. This is a great codebase to build in. Go make the advanced thing real. 🚀
