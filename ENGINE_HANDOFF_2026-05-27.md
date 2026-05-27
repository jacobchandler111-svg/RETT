# RETT Engine Handoff — for the next engine bot

**Date:** 2026-05-27 (end-of-session)
**HEAD on origin/main:** `6d78d2f`
**Cache-buster:** `v=1777600000418` (61 occurrences in index.html)
**Local:** `C:\Users\jacob\OneDrive\Desktop\Claude Code\RETT`
**Deploy:** GitHub Pages — https://jacobchandler111-svg.github.io/RETT/

---

## Pickup checklist (do this FIRST)

1. Read `~/.claude/.../memory/` files in this order:
   - `rett-session-handoff.md` (the older Vegas-era handoff)
   - `project-rett.md`
   - `feedback-rett-working-style.md`
   - `feedback-rett-optimizer.md`
   - `feedback-commit-push-workflow.md`
2. Read this file (you're already doing it).
3. Read `INCOME_SOURCES_RESEARCH.md` (the income-restructure handoff from another bot — wiring is now DONE, but the doc is the IRS-citation source of truth).
4. Read `F1_F2_FIX_HANDOFF.md` (a prior fix-pass handoff — F1+F2 are shipped at `95a3734`, verified in this session).
5. `git log --oneline -30` to see the recent commit history.
6. `preview_start name=rett-static` (port 8765). Cache-buster expects `v=1777600000418`.
7. Wait for instruction. Don't proactively start work.

---

## What this session did (in commit order)

### Income source wiring (4 commits, `a642b6a` → `210be7a`)

The other bot had restructured Tab 1 § 02 "Income Sources" into the new form layout with 4 inert fields (`#interest-income`, `#qualified-dividends`, `#social-security`, `#business-income-amount` + radio group). I wired them end-to-end:

| Commit | Field | Engine routing |
|---|---|---|
| `a642b6a` | **interest** | `cfg.investmentIncomeOrdinary` (NIIT) + `cfg.baseOrdinaryIncome` (ordinary brackets). Per IRC §61(a)(4) + §1411(c)(1)(A)(i). **Also fixed pre-existing bug**: `doNothingBaseline.investmentIncome` was dropping `_scaledInvOrd` term — silently zeroed NIIT on rental/interest income in the do-nothing baseline. |
| `7571c85` | **qualified divs** | `cfg.qualifiedDividend` → `scenario.qualifiedDividend` → engine's `ltAmount`. Federal engine already accepted `qualifiedDividend` opt; just needed cfg plumbing + baseline-table threading. Per IRC §1(h)(11). |
| `57c3284` | **Social Security** | New `_computeTaxableSocialSecurity(grossSS, otherAGI, taxExemptInt, status)` in `tax-calc-federal.js`. Statutory §86 thresholds (NOT inflation-indexed). Taxable portion adds to ordinary brackets only — NOT NIIT, NOT Additional Medicare base. Per-state SS exemption (GA exempts) is **NOT modeled** — flagged as P1 in admin. |
| `210be7a` | **business income + type radio** | `cfg.businessIncomeAmount` (always ordinary brackets) + `cfg.seIncome` (only when type ∈ {`se`, `k1-partnership-gp`}). Engine's existing SE-tax calc (12.4% SS capped + 2.9% Medicare, half-SE deduction NOT yet applied) handles it. Per IRC §1401, §1402(a)(13) LP exception. |

**Half-SE deduction (§164(f)) is NOT yet implemented.** Engine over-states baseline tax for SE-heavy clients by ~half × SE tax × marginal rate. Visible in admin Tab 1 as "NOT YET DEDUCTED" warning. P1 follow-up.

### Downstream rewiring (`0af375d`)

After the income wiring landed, **four downstream consumers were still reading the OLD field IDs** (`se-income`, `biz-revenue`, both now hidden = 0). Tab 2's "Tax Due from the Sale" hero card was under-reporting by $117K on realistic SE + interest + SS scenarios.

**Fix:** new public helper `window.rettY0BaselineSnapshot()` in `tax-comparison.js` — wraps `_baseScenarioForYear` for Y0 with the full property sale. Returns canonical snapshot shape (`{ year, status, state, ordTotal, recap, stGain, ltGain, qualifiedDividend, niitBase, wages, seInc, taxableSS, grossSS, cfg, scenario }`). All 4 consumers now route through it:
- `js/04-ui/baseline-table.js` (Tab 2 hero)
- `js/03-solver/calc-oil-gas.js`
- `js/03-solver/calc-delphi.js`
- `js/04-ui/temp-page-render.js` (Tab 7)

Each has a direct-DOM fallback (with new field IDs) for boot-timing safety.

### Round 5 QA fixes (`a92d70f`)

From a separate QA report by another Claude:
- **F6** (HIGH): admin "Brooklyn Fee Breakdown" was showing $0 invested every row. Typo — `r.invested` should have been `r.investmentThisYear`. Single-word fix.
- **F4** (HIGH): Tab 2 hero + cash-kept tiles were clipping the last digit on 7-digit numbers. CSS fix: `font-size: clamp(2.2rem, 4.2vw, 3.4rem)` + `overflow: visible` + `white-space: nowrap` on both tiles.
- **F3**: "1 months" grammar — fixed.

**Not touched** (defer / not bugs): F1 card-rendering (can't reproduce after F1+F2 from prior session), F2 cascade hide rule (user previously deferred), F5/F7/F8/F11 design/architecture, F9 layout artifact, F10 reviewer-specific localStorage state.

### Strategy C: `parkRatio` sweep + custodian min gate

Across multiple commits, Strategy C's auto-pick was refined to:
1. **3-pass parkRatio sweep** (coarse 0.25 → fine 0.05 → ultra-fine 0.01) finds the precise peak. Verified deltaPr=0 on 6 scenarios.
2. **Custodian min gate** (`_isLegalParkRatio`) — skip any parkRatio that would produce 0 < basisCash < $1M (illegal Y0 tranche size that Schwab wouldn't open). Solver picks either basisCash=0 (no Y0 deposit, parkRatio=1) or basisCash≥$1M (legal Y0 opening).

### Strategy B: §453 installment improvements (`302ed3b` + `f2f0890` + `6d78d2f`)

User pointed out §453 doesn't require equal payments. Three commits:

1. **`302ed3b`** — added `cfg.installmentScheduleWeights` array. Engine accepts per-year weights (sum to 1.0). Auto-pick sweeps over weight space:
   - N=1: trivial single payment
   - N=2: 1D sweep (coarse 0.10 + fine 0.02 = ~17 evals)
   - N=3: 2D sweep (coarse 0.10 grid + fine 0.02 ±0.10 = ~130 evals)
2. **`f2f0890`** — added 3rd ultra-fine pass. N=2 now at 0.001 precision (0.1%), N=3 at 0.005 (0.5%). 2D quadratic blowup keeps N=3 from being finer. Full sweep runs in ~111ms.
3. **`6d78d2f`** — when `cover-taxes-from-sale` is ON, the engine was carving a tax slice from EVERY Brooklyn deposit (including B's installments). For B this was wrong — §453 sellers naturally pay taxes from each installment as it lands, no upfront reserve needed. Fix: gate `_gainTaxRate` on `!_isInstallment`. **Restored B's competitive position** — B was losing to A by $7K with cover-taxes ON; now wins by $290K (where it should).

---

## Engine architecture — current state

### `unifiedTaxComparison(cfg, opts)` — `js/02-tax-engine/tax-comparison.js`

Single engine for all 3 strategies (immediate + deferred). Branches:
- **Strategy A** (immediate): `cfg.recognitionStartYearIndex === 0`. Single Y0 tranche of full `availableCapital`. Horizon = 1.
- **Strategy B** (§453 installment): `cfg.installmentPayments ∈ {1,2,3}` + `cfg.installmentScheduleWeights[]`. `basisCash = 0`. Each payment year creates a new tranche from the (salePrice − recap) × weight[i] amount. Recap recognized Y0 ordinary per §453(i).
- **Strategy C** (structured): `cfg.recognitionStartYearIndex >= 1` + `cfg.structuredSaleDurationMonths` (locked to 36) + `cfg.parkRatio` (0..1). `basisCash = basis + recap + (1-parkRatio) × totalLT` clamped. Parked gain recognized 40/40/20 over 3 yearly Jan-1 payments.

**Critical engine fields you may not realize exist:**
- `cfg.parkRatio` — Strategy C only. When unset, engine falls back to legacy greedy (unpark max). Auto-pick sweeps 0.00–1.00 in 3 passes.
- `cfg.installmentScheduleWeights` — Strategy B only. Array of N weights summing to 1.0. When unset, engine uses equal 1/N split.
- `cfg.coverTaxesFromSale` — when true, A and C have a Y0 tax-reserve tranche carved out (Y0-only, withdraws Apr 1 Y1). B is exempt as of `6d78d2f`.
- `opts.includeTrancheBreakdown: true` — when set, each row's `trancheBreakdown` field is populated with per-tranche records. Used by admin Projection panel.
- `opts.y1LossOverride` — legacy, immediate-mode only, used by optimizer's `_scoreSchedule`.

**Per-row output shape** (`comp.rows[i]`):
```
{ year, gainRecognized, taxCarveOut, reinvestedThisYear, lossGenerated,
  lossApplied, stCarryForward, investmentThisYear, trancheBreakdown,
  fee, brookhavenFee, brookhavenSetupFee, brookhavenQuarterlyFee,
  baseline: {...}, doNothingBaseline: {...}, withStrategy: {...}, savings }
```

**Top-level output:**
```
{ rows, totalBaseline, totalWithStrategy, totalSavings, totalFees,
  totalBrookhavenFees, totalAllFees, recognitionSchedule,
  durationYears, unrecognizedGain, deferred }
```

### `rettY0BaselineSnapshot()` — public helper

Returns the canonical Y0 income snapshot (used by baseline-table, calc-oil-gas, calc-delphi, temp-page-render). New as of this session — all downstream income consumers should use it instead of re-reading DOM directly.

### Auto-pick (`_autoPickSection` in `projection-dashboard-render.js`)

Three sub-pickers:
- **A**: horizon=1, pick combo with highest net.
- **B**: horizons {2, 3, 4} → N={1, 2, 3}. For each (horizon, combo), sweep installment weights via 3-pass.
- **C**: horizon=4 (only valid horizon for 36mo duration), sweep `parkRatio` via 3-pass.

Each `best` record carries `installmentWeights` (B) or `parkRatio` (C) so downstream callers (`_bestPickedCfg`, `_bestPickedCfgLocal`, `controls.js` `runFullPipeline`) can thread the chosen values back into the engine cfg.

### Admin Projection panel (`admin-math-page-projection.js`)

Per strategy section, in order:
1. Auto-pick decisions table (combo, horizon, recognition shape — includes the picked installment split for B and parkRatio for C)
2. Card values summary (post-optimizer)
3. Fully-wiped callout (green, when optimizer dialed back and leftover capital is freed)
4. **Per-year engine output** (13 columns, spreadsheet-style: Year, Gain Recog, Brk New Deposit, **Brk Withdrawn**, Brk Invested Cum, Brk ST Loss, Cum Loss, Baseline Tax, With-Strat Tax, Savings, Cum Savings, Brk Fee, BH Fee, Cum Net)
5. **Per-tranche breakdown** (each tranche × each year matrix, with combo + age + rate tooltip per cell)
6. **Brookhaven fee schedule** (per-year setup + quarterly + total + cumulative)

The "Brk Withdrawn" column shows the Apr 1 Y1 cover-taxes withdrawal explicitly (gold-highlighted negative number).

---

## Known issues / open items

### Half-SE deduction (§164(f))
Engine does NOT subtract half of SE tax from AGI. For a $150K Sch C: SE tax ~$14.5K, half = $7.25K, × marginal 24% = $1,740 over-stated baseline tax. Flagged in admin as "NOT YET DEDUCTED".

### Per-state SS exemption
GA exempts SS from state tax (O.C.G.A. §48-7-27(a)(4)) but the state engine still includes the §86 taxable portion in the state base. Over-states GA tax by ~$1.8K per $40K of SS. P1 — needs a per-state inclusion flag on `computeStateTax`.

### QBI §199A (separate proposal per income handoff)
Not implemented. Big surface — SSTB classification, wage-and-UBIA limits, 2026 phase-in thresholds. Per the handoff doc: do NOT bundle with the SE-tax patch.

### 2026 inflation-indexed values
Some constants are still "projected" — SS wage base ($176,100 placeholder, pending SSA Oct 2025), LTCG breakpoints, QBI thresholds. Verify against published Rev. Proc. before any client-facing commitment.

### Strategy A's dual engine path (from F1 fix)
For Strategy A's immediate-path fees:
- `_scenarioMetrics` reads `ProjectionEngine.run(cfg).totals.cumulativeFees` (1-year close).
- `_scenarioFullData(cfg).comp.totalFees` reads `unifiedTaxComparison` (multi-year accrual).
- These DISAGREE by design at $36K+ for canonical scenarios.

`_assertRowDashboardConsistency` skips A and C to avoid drift-warning floods. This is a scope-around — the deeper fix is to retire one engine for A's fee calc or formally document which is canonical for which view.

### N=3 installment weight precision capped at 0.5%
2D weight space (w1, w2) with 0.001 precision = 40,000+ candidates per (hor, combo). Current sweep stays at 0.005 (0.5%) for N=3. If the user asks for true 0.1% on N=3, the path is pattern search / Nelder-Mead in 2D — converges to 0.001 in ~50 evals.

### Future Sale absorption
Tab 1 "Future Sale" section captures the input but is **analytically modeled only** on Page 6 callout — the engine's `runBrooklynOptimizer` does NOT expand its absorbable cap based on future-sale gain anymore (per user decision in this session, the prior expansion was causing nets to DROP when "Apply" was clicked). The `__rettAbsorbFutureSale` flag still exists for the Page 6 callout to switch its framing ("Apply" vs "Another Option") but no longer affects engine math.

### Card visibility cascade (Round 5 QA F2)
Card C is hidden when Card B is hidden, even if C beats A. User previously deferred this — leave the strict-greater-than-prior-card rule in place unless user revisits.

---

## Gotchas (read these before touching code)

1. **`entry.cfg` now self-describes its strategy variant.** `_scenarioCfgFor` clears cross-strategy fields (A clears parkRatio/installmentPayments/structuredSaleDurationMonths, etc.) so any consumer of `entry.cfg` gets unambiguous routing. Don't add new strategy-routing fields without clearing them in the other branches.

2. **`_baseScenarioForYear` is called twice per row** in `unifiedTaxComparison` — once for the matched-timing `baseline`, once for the `doNothingBaseline` (lump-Y0). The `doNothingBaseline.investmentIncome` is RECOMPUTED inline after the call to swap in the Y0 LT/recap. **The recompute MUST include `_scaledInvOrd` AND `_scaledQualDiv`** — earlier this session those were missing and silently dropped NIIT on rental/interest/qualified-div in the do-nothing path. If you add new income types in NIIT base, mirror them into the dnBaseline recompute.

3. **`_isInstallment` gates a lot now.** Cover-taxes carve, parkRatio logic, basisCash split — all check `!_isInstallment`. If you add new engine behavior, decide explicitly whether it applies to B or not.

4. **`window.rettY0BaselineSnapshot()` is the canonical source for downstream income reads.** Don't re-implement DOM-based income aggregation in new files; call the helper. It already handles §86 SS derivation, qualified-div separation, biz-income SE routing — everything the engine does.

5. **Strategy B's `implementationDate` is always rewritten to year+1 Jan 1** by `_scenarioCfgFor` B branch. The original sale date is preserved on `currentCfg` but `entry.cfg.implementationDate` is the contractual close. This means B is intentionally date-invariant for current-year sale-date changes. Users have asked "why doesn't changing the sale date affect B?" — the answer is the zero-down-payment assumption.

6. **Custodian min ($1M for 145/45, $3M for 200/100) is enforced in TWO places**:
   - `_belowMinForLifecycle` (engine) — gates whether ANY Brooklyn engagement can open.
   - `_isLegalParkRatio` (Strategy C auto-pick) — skips parkRatios that would produce 0 < basisCash < $1M.
   The engine itself doesn't reject sub-$1M tranches; auto-pick has to avoid generating them.

7. **Cache-buster: bump in `index.html`** via `sed -i 's/v=NNN/v=NNN+1/g' index.html` — should hit 61 occurrences. After CSS or JS edits, force-reload with `location.reload(true)` if the preview is showing stale code (browsers aggressively cache).

8. **Filing status key is `'hoh'`** not `'head'`. Engine paths handle the alias but if you write tests, use `'hoh'`.

9. **Custodian dropdown is Schwab-only.** Goldman is in `HIDDEN_FROM_DROPDOWN` in `custodians.js`. Don't assume multi-custodian flow.

10. **Engine has invariant guards.** `unifiedTaxComparison` logs `[RETT engine]` console warnings for: gain conservation broken, withStrategy > totalBaseline, non-finite totals. If you see these in your dev console while testing, treat as P0 bugs.

---

## Workflow (the loop)

1. User describes change.
2. Edit (use `Edit`/`Read`/`Grep` tools — NOT Bash `sed`/`grep`).
3. Bump cache-buster: `sed -i 's/v=NNN/v=NNN+1/g' index.html`.
4. `preview_eval` to verify (canonical scenarios are $5M/$1M/$5M-avail MFJ GA OR $5M/$250K HoH ME for high-gain stress).
5. `git add` specific files (NEVER `-A` — leaves test files like `tax_calculator (13).html` out).
6. Commit with HEREDOC + `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>`.
7. `git push origin main`.
8. End-turn summary: 1–2 sentences, latest commit hash.

**Screenshots time out on this project.** Use `preview_eval` with DOM probes instead.

---

## Canonical verification scenarios

When you need to verify a change, use one of these:

| Scenario | Use case |
|---|---|
| **$48M GA MFJ** ($48M sale, $5M basis, $0 depr, $48M avail, MFJ, GA) | Big Strategy C wins. Historical reference. |
| **$5M / $1M basis / $5M avail / MFJ GA / June 15** | Standard mid-gain case. Shows zero-park degeneracy if avail covers basis+recap+totalLT. |
| **$5M / $250K basis / $5M avail / HoH ME / Mar 2** | High-gain (95%) stress case the user has been iterating on. With cover-taxes ON: A=\$657K, B=\$946K, C=\$1.09M. |
| **$3M / $0 basis / $3M avail / MFJ GA / June 15** | C-degeneracy stress. parkRatio sweep should land at 0.66 with basisCash=\$1.02M (legal). |
| **$13M / $3M / $3M avail** | Constrained-capital C deferral. Multi-year fees actually matter. |

---

## What the user values

- **Brutal honesty about math.** If something doesn't add up, say so directly. Don't paper over.
- **Tight UI semantics** — they notice when labels say "2026" but data says 2027.
- **Verify before claiming done** — preview_eval probes, not assumptions.
- **Commit + push every coherent chunk** (per `feedback-commit-push-workflow.md` memory). Don't sit on local changes.
- **Less is more on UI.** They've repeatedly asked to remove cards/questions/options.
- **CSS-only solutions when possible.** CSS counters for renumbering, `[hidden]` for visibility, `clamp()` for responsive type.
- **Math honesty.** When something doesn't tie out, say so — don't fabricate explanations.

---

## TL;DR for the next bot

The engine is in a good state. All 4 new income fields wire correctly through every downstream consumer. Strategy C and B both have auto-picked optimizations that solve for highest net benefit. Cover-taxes works for A and C but is correctly skipped for B. Admin panel is CPA-grade with per-tranche breakdown + running totals.

**Things most likely to come up next:**
1. Half-SE deduction implementation (~30 min, well-scoped)
2. Per-state SS exemption (P1, needs a flag on `computeStateTax`)
3. QBI §199A (separate proposal — don't bundle)
4. Strategy B with down-payment option (user said "defer for now" but may come back)
5. More precision on N=3 weight sweep (Nelder-Mead in 2D if they ask)

If the user asks "why is X happening" — first reproduce via `preview_eval`, then read the relevant engine path, then explain the math. **Don't change code until you've verified the behavior matches what's reported.**

Latest commit: `6d78d2f` on `main`. Cache-buster `v=1777600000418`.
