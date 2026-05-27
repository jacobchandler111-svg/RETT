# Income Sources — UI Restructure Handoff to Engine Bot

**Status:** UI restructure shipped (commit pending — see `git log`). All new
fields are **INERT** placeholders (`data-inert="true"`). Engine math is
**unchanged**. This document tells the engine bot exactly what each new
field should drive, with IRS source citations and **2026 statutory
values** where applicable.

**Audience:** the next agent that will wire these fields into the engine
(`inputs-collector.js`, `tax-calc-federal.js`, `baseline-table.js`, etc).

**Tax year reference:** 2026. All inflation-indexed thresholds below are
**2026 values** unless explicitly marked otherwise (statutory thresholds
are noted as such).

---

## What changed in the UI (this commit)

Tab 1 / § 02 "Income Sources" reordered to follow **Form 1040 line
order**. Three brand-new inert fields added. Business Income restructured
into a single amount input with a conditional reveal selecting entity
type. Long-Term Capital Gain field given an explicit non-property
sub-label so it is never confused with the real-estate sale path.

### Final field list (top to bottom)

| # | Label | ID | 1040 line | Status |
|---|---|---|---|---|
| 1 | W-2 Wages | `w2-wages` | 1a | existing — engine reads |
| 2 | Interest Income | `interest-income` | 2b | **NEW INERT** |
| 3 | Ordinary Dividends | `dividend-income` | 3b | existing — relabeled |
| 4 | Qualified Dividends | `qualified-dividends` | 3a | **NEW INERT** |
| 5 | Retirement Distributions | `retirement-distributions` | 4b/5b | existing |
| 6 | Social Security (gross) | `social-security` | 6a | **NEW INERT** |
| 7 | Rental Income | `rental-income` | Sch E | existing |
| 8 | Short-Term Capital Gain | `short-term-gain` | Sch D Pt I | existing |
| 9 | Long-Term Capital Gain *(non-property)* | `long-term-gain` | Sch D Pt II | existing — sub-labeled |
| 10 | Business Income (amount) | `business-income-amount` | 8 / Sch 1 | **NEW INERT** |
| 10a | Business income type | `business-income-type` (radio) | n/a | **NEW INERT** |

**Legacy hidden inputs preserved** so existing engine wiring keeps
working (reads `0`):
- `se-income` (hidden) — was Self-Employment Income.
- `biz-revenue` (hidden) — was Business Income.

The engine bot is expected to **retire these legacy IDs** once the new
business-income block is wired through.

### Long-Term Capital Gain — guardrail

`long-term-gain` is for **non-property** LT gain only — stocks held >1yr,
crypto, mutual-fund distributions, K-1 LT cap gain pass-through. The
real-estate sale uses a completely separate engine path
(`cfg.salePrice − cfg.basis − cfg.accelDepr`) and never touches
`cfg.baseLongTermGain`. The new sub-label makes this explicit on the UI.
**Do not** route any property-derived gain through this field.

---

## Engine wiring spec, per new field

For each field below: IRS treatment, **2026** numeric anchors with
sources, current RETT state, and the engine change needed.

---

### 1. Interest Income — `interest-income`

**IRS treatment** — Form 1040 Line 2b ("Taxable interest").

- Taxed at ordinary brackets per **IRC §61(a)(4)**.
- **YES** in §1411 NIIT base per **IRC §1411(c)(1)(A)(i)** ("interest,
  dividends, annuities, royalties, and rents").
- **NOT** subject to SE tax (unless taxpayer is a dealer in financial
  instruments — edge case).
- Tax-exempt interest (Line 2a, e.g., municipal bonds) is a separate
  bucket. This field captures **taxable interest only**.

**NIIT 2026** — §1411 3.8% surtax. Thresholds are **statutory, not
inflation-indexed**:
- MFJ: $250,000 MAGI
- Single / HoH: $200,000 MAGI
- MFS: $125,000 MAGI

Source: IRC §1411(b); IRS Form 8960 instructions.

**Current RETT:** No dedicated field. Interest was implicitly bundled
with dividends in the legacy combined "Dividend / Interest" input
(`dividend-income`). The engine currently routes that combined value
through `inputs-collector.js:_ordinaryInvestmentIncome` into both
`baseOrdinaryIncome` and `investmentIncomeOrdinary` (NIIT base).

**Engine change:**

1. Add `cfg.interestIncome` (number, ≥0).
2. In `inputs-collector.js`, read `#interest-income` via `parseUSD` and
   add to:
   - `cfg.baseOrdinaryIncome` — ordinary bracket stack.
   - `cfg.investmentIncomeOrdinary` — NIIT 3.8% base.
3. `baseline-table.js` already routes `investmentIncomeOrdinary` through
   the NIIT base at ~3 sites — no new sites needed.
4. No new math function — behaves identically to the existing rental
   + dividend stream.

---

### 2. Qualified Dividends — `qualified-dividends`

**IRS treatment** — Form 1040 Line 3a.

- Taxed at **preferential LTCG rates** 0% / 15% / 20% per **IRC
  §1(h)(11)**, provided the §1(h)(11)(B)(iii) holding-period requirement
  is met (>60 days during the 121-day window straddling ex-dividend).
- Stacks **on top of** ordinary income for bracket placement — same
  stacking rule as long-term capital gain (§1(h)(1)).
- **YES** in §1411 NIIT base per §1411(c)(1)(A)(i).
- **NOT** subject to SE tax.
- AMT: carves out of AMTI ordinary slice the same way LTCG does, via
  Form 6251 Part III.

**2026 LTCG/QDIV breakpoints (Rev. Proc. 2025-XX projected from prior
year + ~3% CPI adjustment — engine bot must cite the actual published
Rev. Proc. when wiring):**

| Filing status | 0% rate | 15% rate | 20% rate |
|---|---|---|---|
| Single | ≤ $48,350 (2025: $48,350) | $48,350 – $533,400 | > $533,400 |
| MFJ | ≤ $96,700 | $96,700 – $600,050 | > $600,050 |
| HoH | ≤ $64,750 | $64,750 – $566,700 | > $566,700 |
| MFS | ≤ $48,350 | $48,350 – $300,000 | > $300,000 |

**Note to engine bot:** RETT's `data/taxBrackets.json` already has the
LTCG breakpoint structure. Use the 2026 published values from **Rev.
Proc. 2025-32** (or the successor for 2026) — do NOT use the projected
values above as final; they are placeholder. Verify against Rev. Proc.
§3.03 Table 6 ("Maximum Capital Gains Rate") for the published year.

**Current RETT:** No qualified-dividend stream. The legacy combined
"Dividend / Interest" field was taxed entirely at ordinary rate. This
**understates the preferential-rate benefit** for clients with
significant qualified dividend income.

**Engine change:**

1. Add `cfg.qualifiedDividend` (number, ≥0).
2. In `tax-calc-federal.js:computeFederalTaxBreakdown`, accept
   `opts.qualifiedDividend`. The variable `ltAmount` already exists in
   that function; extend it:
   ```js
   const ltAmount = longTermGain + qualifiedDividend;
   ```
3. Route to NIIT base via `investmentIncome` (per
   §1411(c)(1)(A)(i)).
4. **Do NOT** add to `baseOrdinaryIncome` — that defeats §1(h)(11).
5. AMT: confirm `_computeAmt(amti, year, status, ltAmount, recapAmount)`
   is called with the extended `ltAmount` (includes qualified div).
   Per Form 6251 Part III line 36+, qualified div is taxed at the
   capital-gains rate within AMT — handled by feeding it into
   `ltAmount`.

---

### 3. Social Security Benefits (gross) — `social-security`

**IRS treatment** — Form 1040 Line 6a (gross) → Line 6b (taxable
portion).

- **§86 taxability worksheet** determines 0% / up to 50% / up to 85%
  inclusion in AGI.
- Taxable portion taxed at **ordinary brackets** per **IRC §86(a)**.
- **NOT** in §1411 NIIT base (Form 8960 line 1 instructions exclude SS).
- **NOT** subject to SE tax.
- **NOT** included in wages for Additional Medicare 0.9%.

**§86 thresholds (statutory, NOT inflation-indexed)** — IRC §86(c):

| Filing status | Tier 1 (0%) | Tier 2 (up to 50%) | Tier 3 (up to 85%) |
|---|---|---|---|
| MFJ | provisional ≤ $32,000 | $32,001 – $44,000 | > $44,000 |
| Single / HoH | provisional ≤ $25,000 | $25,001 – $34,000 | > $34,000 |
| MFS (lived with spouse) | $0 | $0 | $0 (treated as Tier 3 from $0) |

**Provisional income** = AGI (excluding SS) + tax-exempt interest +
50% of gross SS benefits.

**Source:** IRC §86; IRS Publication 915 (Worksheet 1, 2026 edition).

**Current RETT:** No SS field. Not modeled.

**Engine change:**

1. Add `cfg.socialSecurityBenefits` (gross, number, ≥0).
2. New helper in `tax-calc-federal.js`:
   ```js
   function _computeTaxableSocialSecurity(grossSS, otherAGI, taxExemptInt, status) {
     // IRC §86 — provisional-income worksheet
     if (grossSS <= 0) return 0;
     const provisional = otherAGI + taxExemptInt + 0.5 * grossSS;
     // MFS-lived-with-spouse special case (treat as Tier 3 from $0):
     if (status === 'mfs') return Math.min(0.85 * grossSS, 0.85 * provisional);
     const t1 = (status === 'mfj') ? 32000 : 25000;
     const t2 = (status === 'mfj') ? 44000 : 34000;
     if (provisional <= t1) return 0;
     if (provisional <= t2) {
       return Math.min(0.5 * (provisional - t1), 0.5 * grossSS);
     }
     const tier2Cap = 0.5 * (t2 - t1);
     const tier3Add = 0.85 * (provisional - t2);
     return Math.min(tier2Cap + tier3Add, 0.85 * grossSS);
   }
   ```
3. Add taxable portion to `baseOrdinaryIncome`. Do **NOT** add to
   `investmentIncomeOrdinary`.
4. **State note:** GA fully exempts SS from state income tax (O.C.G.A.
   §48-7-27(a)(4)). NY, NJ, IL, PA, MS, KS, KY, AL, AZ, AR, CA, DE, DC,
   FL, HI, ID, IN, IA, LA, ME, MD, MA, MI, NH, NV, NC, ND, OH, OK, OR,
   SC, SD, TN, TX, VA, WA, WI, WY, LA, NE, NM also exempt. As of 2026,
   **CO** taxes SS only above age-based thresholds; **CT, MN, RI, UT,
   VT, WV** have partial SS taxation with state-specific phase-outs.
   Engine bot may need a per-state SS-inclusion flag on
   `computeStateTax`. For RETT's GA-first audience this is currently a
   no-op (GA = 0% state on SS), so the engine can ship without per-state
   handling and treat it as a P1 follow-up.

---

### 4. Business Income — `business-income-amount` + `business-income-type`

**IRS treatment** — Form 1040 Line 8 via Schedule 1 Line 3 (Sch C) or
Line 5 (Sch E). Three distinct tax-treatment paths depending on entity:

#### 4a. Self-Employment / Schedule C (`type=se`)

- Sole proprietor, single-member LLC, 1099 contractor.
- Reported on Schedule C → Schedule 1 Line 3.
- Taxed at **ordinary brackets**.
- **YES** subject to **SE tax 15.3%** per **IRC §1401**:
  - 12.4% Social Security on net SE earnings × 92.35%, capped at the
    annual wage base.
  - 2.9% Medicare, uncapped.
- **2026 SS wage base: $176,100** (placeholder pending SSA announcement
  in Oct 2025; cite SSA Fact Sheet for actual). 2025 base was $168,600.
- **Half** of SE tax is deductible above-the-line per **IRC §164(f)**
  (Schedule 1 Line 15).
- **Additional Medicare 0.9%** per **IRC §3101(b)(2)** above the wage
  threshold ($200K Single / $250K MFJ / $125K MFS / $200K HoH —
  **statutory, NOT inflation-indexed**).
- Eligible for **QBI §199A 20% deduction** if business is a qualified
  trade-or-business (not an SSTB above the phase-in threshold).
- §1411 NIIT: **NOT** in base if taxpayer materially participates
  (§1411(c)(1)(A)(ii) excludes non-passive trade-or-business income).
  YES in base if passive.

#### 4b. K-1 — S-corp Distribution (`type=k1-scorp`)

- Reported on Schedule E Part II → Schedule 1 Line 5.
- Taxed at **ordinary brackets**.
- **NOT** subject to SE tax. This is the principal S-corp benefit —
  the S-corp owner-employee pays reasonable W-2 comp separately (which
  IS subject to FICA, but that's the W-2 line, not this one).
- Eligible for **QBI §199A** (subject to same SSTB / wage-and-UBIA
  limits as Sch C).
- §1411 NIIT: **NOT** in base if material participation; YES if passive.

#### 4c. K-1 — Partnership / LLC, Limited Partner (`type=k1-partnership-lp`)

- Schedule E Part II.
- **NOT** subject to SE tax — **IRC §1402(a)(13)** limited-partner
  exception. (Note: recent IRS guidance and *Soroban Capital Partners*
  Tax Court ruling have tightened "true limited partner" — engine bot
  should flag a small advisor-facing note that the LP exemption assumes
  the client is a passive limited partner with no management role.)
- Same QBI + NIIT rules as S-corp.

#### 4d. K-1 — Partnership, General Partner / Active (`type=k1-partnership-gp`)

- **YES** subject to SE tax on the distributive share of ordinary
  trade-or-business income, per §1402(a). Same 15.3% / wage base /
  half-deduction mechanics as Sch C.
- Same QBI + NIIT rules.

#### Current RETT

- Two legacy fields: `se-income` (positive only, fed to `cfg.wages` for
  Additional Medicare) and `biz-revenue` (signed, fed to
  `baseOrdinaryIncome`).
- **SE tax is NOT computed** — `tax-brackets.json` has `seTaxRate: 0.153`
  but no code path uses it. `tax-calc-federal.js:_computeAddlMedicare`
  applies only the 0.9% surtax on `cfg.wages`.
- **No K-1 vs Sch C distinction.**
- **No QBI §199A.**
- Legacy IDs `se-income` and `biz-revenue` are now hidden inputs in the
  DOM (value=""). They continue to be read by `inputs-collector.js` and
  resolve to 0.

#### Engine change

1. Add cfg keys:
   - `cfg.businessIncomeAmount` (number, ≥0)
   - `cfg.businessIncomeType` (string: `'se' | 'k1-scorp' |
     'k1-partnership-lp' | 'k1-partnership-gp' | null`)
2. **Route to `baseOrdinaryIncome`** for all four types.
3. **Route to `cfg.wages` for Additional Medicare** ONLY when
   type ∈ {`se`, `k1-partnership-gp`}. SE earnings flow through the
   0.9% surtax base via Form 8959 line 4 (`SE × 0.9235 + wages` for the
   combined Additional Medicare base).
4. **Add SE tax computation** in `tax-calc-federal.js`:
   ```js
   function _computeSelfEmploymentTax(seEarnings, year, status) {
     if (seEarnings <= 0) return { seTax: 0, halfDeduction: 0 };
     const adj = seEarnings * 0.9235;
     const wageBase = _ssWageBaseForYear(year); // 2026: 176100
     const ss = Math.min(adj, wageBase) * 0.124;
     const med = adj * 0.029;
     const seTax = ss + med;
     return { seTax, halfDeduction: seTax * 0.5 };
   }
   ```
   Trigger only for `type ∈ {se, k1-partnership-gp}`.
5. **Half-SE deduction** reduces AGI (above-the-line). Pipe through
   `_computeAgi` so that §86 SS worksheet, itemized phase-outs, and
   NIIT MAGI all see the reduced AGI.
6. **QBI §199A** — flag as a **separate proposal**. Big surface; touches
   ordinary deduction, taxable-income computation, SSTB classification,
   wage-and-UBIA limits, 2026 phase-in thresholds (single $241,950 /
   MFJ $483,900 — projected; verify against Rev. Proc.). Do NOT bundle
   with the SE-tax patch.
7. **Retire `se-income` and `biz-revenue`** once routing is verified.
   Until then they stay as hidden inputs reading `0`.

**Sources:**
- IRC §1401 (SE tax)
- IRC §1402(a)(13) (LP exception)
- IRC §164(f) (half-SE deduction)
- IRC §3101(b)(2) (Additional Medicare 0.9%)
- IRC §199A (QBI)
- IRC §1411 (NIIT)
- Schedule SE 2026 instructions
- SSA Fact Sheet 2026 (wage base)

---

## Fields that did NOT change

These IDs are still read by the engine, unchanged:

- `w2-wages` → `cfg.wages` for Additional Medicare + `baseOrdinaryIncome`.
  Source: IRC §3101(b)(2) for 0.9% surtax base. ✓ Correct.
- `rental-income` → `cfg.investmentIncomeOrdinary` (NIIT) +
  `baseOrdinaryIncome`. Source: IRC §1411(c)(1)(A)(i). ✓ Correct for
  passive default. Real-estate-pro exception (§469(c)(7)) not modeled —
  defer.
- `retirement-distributions` → `baseOrdinaryIncome` only. NOT in NIIT
  base. Source: IRC §1411(c)(5) excludes qualified plan distributions.
  ✓ Correct.
- `short-term-gain` (signed) → ordinary brackets per §1222(1). §1211(b)
  $3,000 ($1,500 MFS) ord offset + §1212(b) carryforward already
  implemented. NIIT base via `Math.max(0, stGain)`. ✓ Correct.
- `long-term-gain` (signed, **non-property only**) → LT brackets per
  §1(h). New UI sub-label "Non-property — stocks, funds, crypto" makes
  scope explicit. Engine path via `cfg.baseLongTermGain` is **separate**
  from `cfg.salePrice/basis/accelDepr`. ✓ Correct.

---

## Reset / persistence wiring (already in place)

The new IDs were added to:
- `case-storage.js` FIELD_IDS — for save/load.
- `controls.js` `resetIds` — for the Reset button.

The radio group `business-income-type` is NOT in FIELD_IDS (radios
don't have a single getElementById target). Type selection does not
persist across page reloads in v1. Engine bot should either (a) wire
it as a hidden mirror input, or (b) extend case-storage with a
querySelector-based helper for radio groups.

---

## Engine bot — recommended sequencing

1. **Wire `interest-income`** end-to-end — smallest change, NIIT
   already routed.
2. **Wire `qualified-dividends`** — biggest user-visible delta
   (preferential rate). Requires `tax-calc-federal.js` `ltAmount`
   extension.
3. **Wire `social-security`** — implement `_computeTaxableSocialSecurity`
   per §86 worksheet above.
4. **Wire `business-income-amount` + `business-income-type`** with real
   SE-tax computation. Retire `se-income` and `biz-revenue` once
   verified.
5. **QBI §199A** — separate proposal.
6. **Per-state SS-inclusion flag** — separate proposal (P1; GA-first
   audience makes this low-urgency).

For each step: bump cache-buster, run the three canonical
reconciliation scenarios (Strategy A/B/C at $5M/$1M/$5M-avail MFJ GA),
verify the new field changes only the expected line items, commit
+ push.

---

## 2026 numeric anchors — single source of truth

When updating `data/taxBrackets.json` or hard-coded constants:

| Constant | 2026 value | Source | Inflation-indexed? |
|---|---|---|---|
| SS wage base | $176,100 (projected; verify SSA Fact Sheet Oct 2025) | SSA | Yes |
| Add'l Medicare 0.9% threshold MFJ | $250,000 | IRC §3101(b)(2) | **No (statutory)** |
| Add'l Medicare 0.9% threshold Single/HoH | $200,000 | IRC §3101(b)(2) | **No (statutory)** |
| Add'l Medicare 0.9% threshold MFS | $125,000 | IRC §3101(b)(2) | **No (statutory)** |
| NIIT 3.8% threshold MFJ | $250,000 | IRC §1411(b) | **No (statutory)** |
| NIIT 3.8% threshold Single/HoH | $200,000 | IRC §1411(b) | **No (statutory)** |
| NIIT 3.8% threshold MFS | $125,000 | IRC §1411(b) | **No (statutory)** |
| §86 SS Tier 1 MFJ / Single | $32,000 / $25,000 | IRC §86(c) | **No (statutory)** |
| §86 SS Tier 2 MFJ / Single | $44,000 / $34,000 | IRC §86(c) | **No (statutory)** |
| Capital loss ord offset | $3,000 ($1,500 MFS) | IRC §1211(b) | **No (statutory)** |
| SE tax rate | 15.3% (12.4% SS + 2.9% Med) | IRC §1401 | No |
| Half-SE deduction | 50% of SE tax | IRC §164(f) | No |
| QBI §199A phase-in MFJ (projected 2026) | ~$483,900 | Rev. Proc. (verify) | Yes |
| QBI §199A phase-in Single (projected 2026) | ~$241,950 | Rev. Proc. (verify) | Yes |
| LTCG 0%→15% breakpoint MFJ (projected 2026) | ~$96,700 | Rev. Proc. (verify) | Yes |
| LTCG 15%→20% breakpoint MFJ (projected 2026) | ~$600,050 | Rev. Proc. (verify) | Yes |

**Engine bot must verify projected (inflation-indexed) values against
the published 2026 Revenue Procedure before final wiring.** Statutory
values are stable.
