# 2026 State Tax Verification Sweep — Batch 5 (SD–WY + DC)

**Date:** 2026-05-27
**Final batch — completes the 50-state + DC sweep.**
**States in this batch:** South Dakota, Tennessee, Texas, Utah, Vermont, Virginia, Washington, West Virginia, Wisconsin, Wyoming, District of Columbia

---

## Per-state status

### 🟢 South Dakota (SD)
- **No state income tax.**
- **JSON**: `noIncomeTax: true` ✓
- **Verdict**: ✓ Correct.

### 🟢 Tennessee (TN)
- **No state income tax.** (Hall Tax on interest/dividends was fully repealed effective Jan 1 2021.)
- **JSON**: `noIncomeTax: true` ✓
- **Verdict**: ✓ Correct.

### 🟢 Texas (TX)
- **No state income tax.** (Constitutionally prohibited per Texas Const. Art. VIII §24-a.)
- **JSON**: `noIncomeTax: true` ✓
- **Verdict**: ✓ Correct.

### 🟢 Utah (UT)
- **Rate structure**: Flat **4.45%** per Utah HB 106 (signed March 2025) — reduced from 4.5% effective tax year 2026. JSON `_source` already documents this.
- **JSON rate**: 4.45% ✓
- **Std deduction $0**: Utah uses a single-rate-with-taxpayer-credit system (no traditional std ded). For high-income filers the credit fully phases out so $0 is effectively correct.
- **Verdict**: ✓ Correct (verified per HB 106).
- **Authority**: Utah Code §59-10-104; UT HB 106 (2025).

### ⚠️ Vermont (VT) — **PATCH APPLIED THIS COMMIT**
- **Rate structure**: 4 brackets 3.35% / 6.6% / 7.6% / 8.75%. **Brackets indexed annually** per 32 VSA §5822.
- **JSON 2026 thresholds (single)**: $46,850 / $113,950 / $236,850 — approximately 2025 values.
- **2026 estimated thresholds (~2.5% indexing)**: ~$48,000 / $116,800 / $242,800.
- **Std deduction**: 32 VSA §5811(21) ties VT std ded to federal §63. Patched to **$16,100 / $32,200** (federal 2026 per Rev. Proc. 2025-32 §3.16).
- **Verdict**: ⚠️ Std ded patched. Brackets need VT DOTax 2026 bulletin verification.
- **Authority**: 32 VSA §5822 (brackets), §5811(21) (std ded conformity).

### ⚠️ Virginia (VA)
- **Rate structure**: 4 brackets 2% / 3% / 5% / **5.75%**. Per Va Code §58.1-320. **Statutory — NOT inflation-indexed since 1990.**
- **JSON**: ✓ matches statute
- **Std deduction**: $4,700 single / $9,400 MFJ in JSON. **Virginia HB 700 / SB 700 (2024)** set std ded at $5,000 single / $10,000 MFJ permanently for 2024+. The JSON's $4,700/$9,400 appears to be a pre-HB-700 transitional value.
- **Verdict**: ⚠️ **Std ded likely needs update to $5,000 / $10,000** per VA HB 700 (2024).
- **Authority**: Va Code §58.1-320 (rate), §58.1-322.03 (std ded); VA HB 700 (2024 session).

### ⚠️ Washington (WA)
- **No state income tax on wages.** But **7% capital gains tax** on long-term capital gains > inflation-indexed threshold per WA SB 5096 (2021), codified at RCW 82.87.
- **JSON**: `noIncomeTax: true` + `capitalGainsTax: { threshold: 270000, rate: 0.07 }` ✓
- **Threshold history**: 2022 = $250K, 2023 = $262K, 2024 = $270K, 2025 = $270K (no change announced), 2026 estimated $275-280K with WA DOR Q4 indexing.
- **Verdict**: ⚠️ Verify 2026 indexed threshold against WA DoR bulletin (typically late Q4).
- **Authority**: RCW 82.87; WA SB 5096 (2021).

### ⚠️ West Virginia (WV)
- **Rate structure**: 5-bracket. **WV HB 2526 (2023)** initiated phased rate cuts. **WV SB 2033 (2024 session)** + revenue-trigger reductions accelerated further.
- **JSON top rate**: 4.82% — appears to be **2024 value**.
- **WV phase schedule per HB 2526 + subsequent reductions**:
  - 2023: 5.12%
  - 2024: 4.82%
  - 2025: 4.65% (per January 2025 revenue trigger reduction)
  - **2026: 4.55%** (estimated; needs WV State Tax Department confirmation)
- **JSON brackets**: 5-bracket structure with progressive rates 2.36/3.15/3.54/4.72/4.82% — all rates need proportional reduction per the phase schedule.
- **Std deduction $0**: WV uses personal exemption ($2,000/filer). ✓ marker.
- **Verdict**: ⚠️ **Brackets need rate updates per 2025 + 2026 reductions.** Engine bot to pull WV State Tax Department 2026 IT-140 instructions.
- **Authority**: WV Code §11-21-4e (rate); WV HB 2526 (2023), SB 2033 (2024), and post-2024 trigger reductions.

### ⚠️ Wisconsin (WI)
- **Rate structure**: 4-bracket 3.5% / 4.4% / 5.3% / 7.65%. **Brackets indexed annually** per Wis Stat §71.06(2)(j).
- **JSON 2026 thresholds (single)**: $14,780 / $29,560 / $325,520 — approximately 2025 values.
- **2026 estimated thresholds**: ~$15,150 / $30,300 / $333,650 (with ~2.5% indexing).
- **Std deduction**: $13,170 / $24,380 — Wisconsin has its **OWN std ded** (does NOT conform to federal), indexed annually per Wis Stat §71.05(22). **Phases out** for high-AGI filers (single AGI > $128K, MFJ > $145K → $0).
- **For RETT clients**: high-AGI clients will have WI std ded fully phased to $0; JSON values over-deduct for these clients.
- **stateLtcg**: 30% exclusion on LT gain per Wis Stat §71.05(6)(b)9 ✓
- **Verdict**: ⚠️ Brackets + std ded need 2026 WI DoR indexing verification. Std ded phaseout for high-AGI not modeled — over-deducts ~$13K for RETT clients (~$1K state tax impact at 7.65% top rate).
- **Authority**: Wis Stat §71.06 (brackets), §71.05(22) (std ded + phaseout), §71.05(6)(b)9 (LTCG).

### 🟢 Wyoming (WY)
- **No state income tax.**
- **JSON**: `noIncomeTax: true` ✓
- **Verdict**: ✓ Correct.

### ⚠️ District of Columbia (DC)
- **Rate structure**: 7-bracket 4% / 6% / 6.5% / 8.5% / 9.25% / 9.75% / 10.75%. Per DC Code §47-1806.03. Top rate 10.75% over $1M established by DC Council 2021 budget.
- **JSON**: brackets match statute ✓
- **Std deduction**: Need to check JSON entry (cut off in my read).
- **Indexing**: DC indexes brackets annually per §47-1806.03(a)(11). 2026 values need DC OTR confirmation.
- **Verdict**: ⚠️ Brackets approximately correct. 2026 indexing + std ded need DC Office of Tax & Revenue confirmation.
- **Authority**: DC Code §47-1806.03.

---

## Summary

| State | Status | Action |
|---|:-:|---|
| SD | 🟢 | No income tax |
| TN | 🟢 | No income tax |
| TX | 🟢 | No income tax (constitutional) |
| UT | 🟢 | 4.45% per HB 106 ✓ |
| VT | ⚠️ → ✓ | **Patched** std ded to federal 2026 |
| VA | ⚠️ | Verify std ded: HB 700 (2024) set $5,000/$10,000 vs JSON $4,700/$9,400 |
| WA | ⚠️ | Verify 2026 cap gains threshold (currently $270K, may index) |
| WV | ⚠️ | Brackets need rate updates per 2025 + 2026 trigger reductions (currently 4.82% top, est 4.55% for 2026) |
| WI | ⚠️ | Brackets + std ded need 2026 indexing; std ded phaseout not modeled |
| WY | 🟢 | No income tax |
| DC | ⚠️ | 2026 bracket indexing + std ded need DC OTR confirmation |

**Patches this commit**: 1 (VT std ded).
**Open verification tasks**: 5 (VA std ded HB 700, WA cap gains threshold, WV rate phase, WI 2026 indexing, DC 2026 indexing).

---

# 🏁 Sweep Complete — Final 50-State + DC Summary

Across all 5 batches:

### Patches applied this sweep (11 std ded updates → federal 2026):
- AZ (batch 1)
- CO (batch 1)
- ID (batch 2)
- ME (batch 2)
- MN (batch 3)
- MO (batch 3)
- MT (batch 3)
- ND (batch 3)
- NM (batch 4)
- SC (batch 4)
- VT (batch 5)

### High-confidence verified (no change needed):
- AL (brackets statutory 1933)
- AK (no income tax)
- CT (statutory unchanged)
- DE (statutory unchanged)
- FL (no income tax)
- GA (HB 111 5.19% ✓)
- IL (4.95% statutory)
- IN (2.95% per HB 1001 phase ✓)
- IA (3.8% flat per SF 2442 ✓)
- KS (2-bracket per SB 1 ✓)
- MA brackets (statutory ✓, surtax indexing flagged)
- MI (4.25% statutory)
- MS (4% per HB 1733 ✓)
- NC (3.99% per phase ✓)
- NE (4.55% per LB 754 ✓)
- NH (no income tax 2026+)
- NJ (statutory ✓)
- NV (no income tax)
- NY (statutory ✓)
- OK (statutory, no 2026 cut)
- PA (3.07% statutory)
- SD (no income tax)
- TN (no income tax)
- TX (no income tax)
- UT (4.45% per HB 106 ✓)
- WY (no income tax)

### High-priority verification flags for engine bot (require DoR PDF access):
- **AR**: bracket structure (3-bracket vs 2-bracket DFA confirmation)
- **CA**: 2026 bracket + std ded inflation indexing (FTB)
- **HI**: Act 46 phase-in 2026 specific bracket positions (DOTAX)
- **KY**: std ded 2026 indexing
- **LA**: $12,500 std ded per HB 10 2024 SS (currently $0 in JSON)
- **MA**: 2026 millionaire surtax threshold indexing
- **MN**: 2026 bracket indexing
- **MO**: 2026 bracket indexing
- **NC**: 2026 std ded inflation
- **ND**: 2026 bracket indexing
- **OH**: HB 96 (June 2025) 2026 rate
- **OR**: 2026 bracket + std ded indexing
- **RI**: 2026 bracket + std ded indexing
- **SC**: 2026 top rate trigger compliance
- **VA**: HB 700 std ded update ($5,000/$10,000)
- **VT**: 2026 bracket indexing (DOTax)
- **WA**: 2026 cap gains threshold
- **WV**: 2025+2026 rate phase reductions
- **WI**: 2026 indexing + std ded phaseout
- **DC**: 2026 indexing (OTR)

### Unmodeled features (already documented in JSON or this sweep):
- **AL**: std ded AGI-based phaseout
- **IN**: county local tax up to 3.4%
- **MD**: county local tax 2.25–3.20%
- **ME**: 2026 millionaire surtax 2% > $1M / $1.5M (TODO in JSON)
- **MN**: net investment surtax 1% > $1M (TODO in JSON)
- **NY**: NYC + Yonkers local tax 3-4%
- **OH**: municipal local tax 2-3%
- **PA**: local EIT up to 3.928% (Philadelphia)
- **WI**: std ded high-AGI phaseout (~$1K state tax impact)

### Recommended next action for engine bot
The federal-conformity std deduction updates (11 patches) close the most common annual maintenance gap. The verification flags (20 items) need access to state DoR Q4 / January instruction PDFs that are mostly behind browser-detection or PDF-only delivery; an engine bot session with PDF-text extraction would tackle them efficiently.
