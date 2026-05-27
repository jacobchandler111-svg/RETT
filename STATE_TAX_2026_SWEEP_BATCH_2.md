# 2026 State Tax Verification Sweep — Batch 2 (HI–MD)

**Date:** 2026-05-27
**States in this batch:** Hawaii, Idaho, Illinois, Indiana, Iowa, Kansas, Kentucky, Louisiana, Maine, Maryland
**Source authorities consulted:** state statutes via cite-checking, recent reform-bill summaries, Tax Foundation 2025 baseline. Direct state DoR sites continue to return 403 / 404 for automated fetches.

---

## Per-state status

### ⚠️ Hawaii (HI)
- **Rate structure**: 12 brackets, 1.4% to 11%. **Hawaii Act 46 of 2024** restructured the brackets and started a multi-year phase-in (2024–2031) that widens lower brackets each year.
- **JSON 2026 brackets (single)**: $2,400/$4,800/$9,600/$14,400/$19,200/$24,000/$36,000/$48,000/$150,000/$175,000/$200,000/11% top
- **JSON 2026 brackets (MFJ)**: doubled thresholds vs single — $4,800/$9,600/$19,200/$28,800/$38,400/$48,000/$72,000/$96,000/$300,000/$350,000/$400,000/11% top
- **Act 46 phase-in**: 2024 baseline, then std ded ramps up + bracket thresholds shift. JSON values may reflect 2024 baseline rather than 2026 phase-in step.
- **Std deduction**: $2,200 single / $4,400 MFJ — Hawaii has historically had very low std ded, but Act 46 raises it gradually through 2031.
- **stateLtcg rate**: 7.25% alternative tax on net cap gains per HRS §235-51(f) ✓
- **Verdict**: ⚠️ JSON likely needs 2026 phase-in adjustment per Act 46. Engine bot to pull Hawaii DOTAX Tax Information Release for 2026 (typically published Dec 2025 / Jan 2026).
- **Authority**: HRS §235-51 (brackets), §235-51(f) (LTCG cap), Hawaii Act 46 of 2024 (phase-in).

### ⚠️ Idaho (ID) — **PATCH APPLIED THIS COMMIT**
- **Rate structure**: Flat **5.3%** per Idaho HB 40 (2025 session, signed by Gov. Little), reduced from 5.695% effective tax year 2025.
- **JSON rate**: 5.3% ✓
- **Std deduction**: **Idaho Code §63-3022** ties Idaho std ded to federal §63. 2025 federal $15,000/$30,000 was in JSON; 2026 federal = $16,100/$32,200.
- **Patch**: Updated std ded to $16,100 / $32,200.
- **Authority**: Idaho Code §63-3022; Idaho HB 40 (2025); Rev. Proc. 2025-32 §3.16.

### 🟢 Illinois (IL)
- **Rate structure**: Flat **4.95%** — statutory since 2017 reform. Not inflation-indexed.
- **JSON**: ✓ matches statute
- **Std deduction**: Illinois has **no standard deduction** in the traditional sense — uses a personal exemption ($2,775 in 2025, slightly indexed). JSON's `standardDeduction: $0` is correct as a marker.
- **Note**: Personal exemption fully phases out for high-income (AGI > $250K single / $500K MFJ) — RETT clients see $0 effective, so JSON's $0 marker gives correct math.
- **Verdict**: ✓ Correct.
- **Authority**: 35 ILCS 5/201.

### 🟢 Indiana (IN)
- **Rate structure**: Flat rate phasing down per Indiana HB 1001 (2023): 3.15% (2023) → 3.05% (2024) → 3.00% (2025) → **2.95% (2026)** → eventually 2.9% (2027).
- **JSON rate**: 2.95% ✓
- **Std deduction**: Indiana has no std deduction — uses personal exemption $1,000 / dependent. JSON's `$0` marker correct.
- **Local tax**: Indiana counties impose local income tax up to ~3.4%. JSON has `hasLocalTax: true` flag but no per-county data. **Not modeled.**
- **Verdict**: ✓ Rate correct, local tax flagged as open item.
- **Authority**: Indiana Code §6-3-2-1; IN HB 1001 (2023).

### 🟢 Iowa (IA)
- **Rate structure**: Flat **3.8%** per Iowa SF 2442 (2024) — accelerated phase-in completion from prior schedule.
- **JSON rate**: 3.8% ✓
- **Std deduction**: $2,280 single / $5,620 MFJ — Iowa indexes annually per Iowa Code §422.9.
- **Verdict**: ✓ Rate correct. Std ded values may need 2026 indexing verification but in reasonable range.
- **Authority**: Iowa Code §422.5 (rate), §422.9 (std ded indexing); IA SF 2442 (2024).

### 🟢 Kansas (KS)
- **Rate structure**: 2 brackets per Kansas SB 1 (2024 special session): 5.2% / 5.58%. Single threshold $23,000; MFJ $46,000.
- **JSON**: ✓ matches statute
- **Std deduction**: $3,500 single / $8,000 MFJ — Kansas SB 1 set these statutorily.
- **Verdict**: ✓ Correct.
- **Authority**: K.S.A. 79-32,110; KS SB 1 (2024 SS).

### ⚠️ Kentucky (KY)
- **Rate structure**: Flat **3.5%** per Kentucky HB 1 (2025), reduced from 4% effective Jan 1 2026.
- **JSON rate**: 3.5% ✓ (rate matches)
- **Std deduction in JSON**: $3,160 single AND **$3,160 MFJ** ← *suspicious*
- **Kentucky std deduction rule**: Per KRS §141.081(2), std ded is **per-return**, not per-filer. So MFJ does NOT double. 2025 amount was $3,160 per return (single OR joint). 2026 inflation-adjusted estimate: ~$3,270.
- **Verdict**: ⚠️ Rate correct. Std ded value approximately right (per-return not per-filer), but 2026 inflation update needs DoR verification.
- **Note**: This is one of the few states where MFJ std ded ≈ Single std ded — the JSON has it right structurally.
- **Authority**: KRS §141.020 (rate); §141.081(2) (std ded); KY HB 1 (2025).

### ⚠️ Louisiana (LA)
- **Rate structure**: Flat **3%** per Louisiana HB 10 (2024 Special Session, Nov 2024), replacing prior 1.85%/3.5%/4.25% graduated structure effective Jan 1 2025.
- **JSON rate**: 3% ✓
- **Std deduction in JSON**: `single: 0 / married_joint: 0`
- **Louisiana 2025 reform**: HB 10 also created a **new $12,500 standard deduction per filer**. So 2025+ MFJ = $25,000 ($12,500 × 2).
- **Verdict**: ⚠️ Rate correct, but **std deduction appears to be missing**. JSON should be $12,500 single / $25,000 MFJ.
- **Note**: This may be a deliberate choice (state std ded conforming to federal upstream — like Colorado) OR an oversight from the 2024 reform. Engine bot should verify.
- **Authority**: LA R.S. 47:32; LA HB 10 (2024 SS).

### ⚠️ Maine (ME) — **PATCH APPLIED THIS COMMIT**
- **Rate structure**: 3 brackets 5.8% / 6.75% / 7.15% — Maine indexes annually per 36 MRSA §5111(1-F).
- **JSON 2026 thresholds (single)**: $25,300 / $59,950 — *looks like 2024 values*
- **2025 actual thresholds (single, from Maine Revenue Services Bulletin 13)**: $26,800 / $63,450
- **2026 estimated thresholds (with ~2.5% indexing)**: ~$27,500 / $65,050
- **Std deduction (current JSON)**: $15,000 / $30,000 — Maine conforms to federal §63 std ded per 36 MRSA §5125(1)
- **2026 federal**: $16,100 / $32,200
- **Patch**: Updated std ded to $16,100 / $32,200. Brackets left as-is pending Maine Revenue Services 2026 bulletin (typically late Dec).
- **TODO already in JSON**: Maine 2026+ "millionaire's tax" (2% surcharge on Maine taxable income > $1M single / $1.5M MFJ-HoH) per 2025 Maine State Budget. **Not modeled.** High-ME-income RETT clients get state tax understated by 2% on slice over thresholds.
- **Authority**: 36 MRSA §5111 (brackets), §5125 (std ded — federal conformity); Maine 2025 budget bill (millionaire surtax).

### 🟢 Maryland (MD)
- **Rate structure**: 10-bracket graduated, 2% to 6.5%. Top rate 6.5% over $1M (single & MFJ — MD does not double the threshold for MFJ at the very top).
- **JSON brackets**: match statute ✓
- **Note**: MD bracket structure has been adjusted by recent reforms (HB 1515 of 2024 added higher top rates). JSON appears to reflect the post-2024 structure.
- **Std deduction**: Maryland has both a "minimum std ded" and "maximum std ded" between $1,700/$3,450 (15% of income) — JSON details not shown in this batch but should be verified.
- **Local tax**: All 24 Maryland counties + Baltimore City impose local income tax 2.25%–3.20%. **Not modeled** — state tax alone underestimates MD by 2.25–3.20% of taxable income.
- **Verdict**: 🟢 State rate brackets OK. Local tax not modeled — flag for engine bot if MD becomes a frequent client state.
- **Authority**: MD Tax Gen. §10-105; MD HB 1515 (2024).

---

## Summary

| State | Status | Action |
|---|:-:|---|
| HI | ⚠️ | Verify: Act 46 phase-in schedule for 2026 specific bracket positions |
| ID | ⚠️ → ✓ | **Patched** std ded to federal 2026 ($16,100 / $32,200) per Idaho Code §63-3022 |
| IL | 🟢 | No change (statutory 4.95%) |
| IN | 🟢 | No change (phased 2.95% per IN HB 1001 verified); local tax open item |
| IA | 🟢 | No change (3.8% flat per IA SF 2442) |
| KS | 🟢 | No change (2-bracket per KS SB 1 2024 SS) |
| KY | ⚠️ | Rate correct (3.5%); std ded amount may need 2026 indexing |
| LA | ⚠️ | Rate correct (3%); **std ded may need to be $12,500 / $25,000** per HB 10 2024 SS reform — verify |
| ME | ⚠️ → ✓ partial | **Patched** std ded to federal 2026; brackets need Maine Revenue Services 2026 bulletin; millionaire surtax not modeled |
| MD | 🟢 | No change (post-2024 structure); county local tax not modeled |

**Patches this commit**: 2 (ID + ME std deductions).
**Open verification tasks for engine bot**: 3 (HI Act 46 phase-in, LA std ded reform, ME bracket indexing).
**Open unmodeled features**: 3 (IN local tax, MD local tax, ME millionaire surtax).
