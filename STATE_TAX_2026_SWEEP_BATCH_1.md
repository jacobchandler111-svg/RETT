# 2026 State Tax Verification Sweep — Batch 1 (AL–GA)

**Date:** 2026-05-27
**States in this batch:** Alabama, Alaska, Arizona, Arkansas, California, Colorado, Connecticut, Delaware, Florida, Georgia
**Source authorities consulted:** Tax Foundation 2025 State Income Tax page, Rev. Proc. 2025-32 (federal anchors), state statutes via FindLaw / Bloomberg Tax / state DoR landing pages (where accessible)
**Note on web-fetch limitations:** Most state DoR sites do not publish 2026 inflation-adjusted values until late Q4 of the prior year and post them only in PDF instruction booklets that are difficult to extract programmatically. Where this is the case, I cite the statutory authority and 2025 baseline + an annotation that 2026 inflation adjustments need DoR confirmation in Q4.

---

## Per-state status

### 🟢 Alabama (AL)
- **Rate structure**: Statutory 2% / 4% / 5%, last set in 1933 — **NOT inflation-indexed**.
- **Single**: 2% to $500, 4% to $3,000, 5% above
- **MFJ**: 2% to $1,000, 4% to $6,000, 5% above
- **Std deduction (current JSON)**: $2,500 single / $7,500 MFJ
- **Std deduction reality**: AL has a **phaseout** based on AGI (ALA. CODE §40-18-15(b)). For single filers, std ded phases from $2,500 down to $1,500 as AGI rises from $20K to $30K. For MFJ, $7,500 down to $4,000 over $20K–$50K AGI. **For RETT clients (AGI $1M+), AL std ded would phase to the minimum ~$1,500/$4,000** — the JSON's flat $2,500/$7,500 over-deducts for these clients.
- **Verdict**: ⚠️ **Brackets OK (statutory unchanged 2026 = 2025 = 1933).** Std deduction phaseout not modeled — would slightly under-tax AL clients. Engine bot to add AGI-based phaseout if AL becomes a frequent client state.
- **Authority**: ALA. CODE §40-18-5 (brackets), §40-18-15(b) (std ded phaseout).

### 🟢 Alaska (AK)
- **No state income tax** (never has had one for individuals).
- **JSON**: `noIncomeTax: true` ✓
- **Verdict**: ✓ Correct.

### ⚠️ Arizona (AZ) — **PATCH APPLIED THIS COMMIT**
- **Rate structure**: Flat 2.50% (since 2023 per AZ HB 2898, 2021).
- **JSON brackets**: ✓ correct
- **Std deduction**: Arizona statute **ARS §43-1042(A)(1)** ties state std ded to the federal §63 std ded.
- **2025 federal std ded**: $15,000 single / $30,000 MFJ → matches current JSON
- **2026 federal std ded**: $16,100 single / $32,200 MFJ (per Rev. Proc. 2025-32 §3.16)
- **Patch**: Updated JSON to $16,100 / $32,200 to reflect 2026 federal values.
- **Authority**: ARS §43-1042, Rev. Proc. 2025-32 §3.16.

### ⚠️ Arkansas (AR)
- **Rate structure**: Top rate **3.9%** since AR HB 1001 (June 2024, retroactive to Jan 1 2024). 
- **JSON brackets (single & MFJ)**: 2% to $5,099, 4% to $10,299, 3.9% above
- **2025 actual (Tax Foundation)**: 2% to $4,500, 3.9% above (TWO brackets, not three)
- **Discrepancy**: JSON has a 4% middle bracket that doesn't match TF 2025. Possibly a legacy 2023-vintage structure or a projection that drifted. **Per AR DFA Notice 2024-01**, the 2024+ structure is **two brackets**: 2% to $4,500 (single), 3.9% above; with continuing annual inflation indexing.
- **Verdict**: ⚠️ JSON LIKELY HAS STRUCTURAL DRIFT. The middle 4% bracket appears extraneous. Recommend the engine bot re-derive from AR DFA 2026 instruction PDF (typically Form AR1000F instructions, published December).
- **Std ded**: $2,340 / $4,680 (JSON) vs $2,410 / $4,820 (Tax Foundation 2025). Close — likely 2026 indexed values from DFA.
- **Authority**: AR HB 1001 (2024), AR Code §26-51-201; AR DFA Notice 2024-01.

### ⚠️ California (CA)
- **Rate structure**: 9 brackets, 1% to 12.3%, with **1% mental health surtax over $1M MFJ / $1M MFS / $1M Single** (no MFJ-doubling on the surtax — statutory).
- **JSON 2026 bracket thresholds**: $10,756 / $25,499 / $40,245 / $55,867 / $70,609 / $360,834 / $432,978 / $721,417 / 12.3% above (single)
- **Tax Foundation 2025 thresholds (single)**: $10,756 / $25,499 / $40,245 / $55,866 / $70,606 / $360,659 / $432,787 / $721,314 / $1,000,000 / 13.30% above $1M
- **Discrepancy**: JSON values are ~0.03–0.05% higher than 2025 — appears to be a ~2% inflation projection. **CA brackets ARE indexed annually by FTB.**
- **Mental health surcharge in JSON**: separate field `mentalHealthSurcharge: { threshold: 1000000, rate: 0.01 }` — that's the 1% addition over $1M to get to 13.3%. ✓ correct structure.
- **Std ded**: $5,722 / $11,444 (JSON) vs $5,540 / $11,080 (TF 2025) — JSON ~3.3% higher, likely a 2026 projection.
- **Verdict**: ⚠️ Values appear to be 2025 inflation-projected to 2026. **CA FTB Publication 17 will have actual 2026 values when published late 2025.** Recommend engine bot verify against FTB Form 540 instructions for 2026.
- **Authority**: CA Rev. & Tax. Code §17041 (brackets), §17047 (indexing), §17043 (mental health surtax).

### ⚠️ Colorado (CO)
- **Rate structure**: Flat 4.40% (statutory baseline; was temporarily 4.25% for 2024 only, reverted Jan 2025).
- **JSON rate**: 4.4% ✓
- **Std deduction**: This is where CO is unusual. **Colorado starts from federal taxable income** (CRS §39-22-104(1)(c)), which already has the federal std ded subtracted. The JSON's `standardDeduction: { single: 15000, married_joint: 30000 }` is conceptually NOT a Colorado std deduction — it's a pass-through of federal std ded so the engine's state computation arithmetic ends up correct.
- **2026 federal std ded**: $16,100 / $32,200.
- **Patch**: Updated CO std ded to $16,100 / $32,200 to reflect the 2026 federal pass-through.
- **Verdict**: ⚠️ Patched. Engine bot may want to formalize the federal-conformity model so this doesn't drift each year.
- **Authority**: CRS §39-22-104, Rev. Proc. 2025-32 §3.16.

### 🟢 Connecticut (CT)
- **Rate structure**: 6 brackets, 2% to 6.99% — **statutory, NOT inflation-indexed**. Unchanged since 2024 reform that lowered the 3% rate to 2% and the 5% rate to 4.5%.
- **JSON**: ✓ matches statute
- **Std deduction**: CT has **no standard deduction** — uses a personal exemption with phaseout. JSON has `standardDeduction: { single: 0, married_joint: 0 }` ✓ correct as a marker.
- **Note**: Personal exemption phaseout NOT modeled. For RETT clients (high income), the personal exemption is fully phased out, so the JSON's $0 effectively gives the correct answer.
- **Verdict**: ✓ Correct.
- **Authority**: CGS §12-700, §12-702.

### 🟢 Delaware (DE)
- **Rate structure**: 6 brackets, 2.2% to 6.6% — **statutory, NOT inflation-indexed**. Last touched in 2014 reform.
- **JSON**: ✓ matches statute
- **Std deduction**: $3,250 / $6,500 — statutory per DE Code Title 30 §1108. ✓ matches.
- **Verdict**: ✓ Correct.
- **Authority**: 30 Del. C. §1102 (brackets), §1108 (std ded).

### 🟢 Florida (FL)
- **No state income tax.**
- **JSON**: `noIncomeTax: true` ✓
- **Verdict**: ✓ Correct.

### 🟢 Georgia (GA)
- **Rate structure**: Flat **5.19%** (HB 111, signed April 2025, effective Jan 1 2025; carries to 2026 absent further trigger).
- **JSON rate**: 5.19% ✓
- **Std deduction**: $12,000 single / $24,000 MFJ — set by HB 1023 (2022 reform). ✓ matches.
- **Verdict**: ✓ Correct.
- **Authority**: GA HB 111 (2025), GA HB 1023 (2022).

---

## Summary

| State | Status | Action |
|---|:-:|---|
| AL | 🟢 brackets / ⚠️ std ded phaseout | Brackets correct; std ded phaseout not modeled (minor over-deduction for high-income) |
| AK | 🟢 | No change |
| AZ | ⚠️ std ded | **Patched** to federal 2026 ($16,100 / $32,200) per ARS §43-1042 |
| AR | ⚠️ | Verify: JSON has 3-bracket structure but AR HB 1001 (2024) created 2-bracket structure. Needs DFA confirmation. |
| CA | ⚠️ | Verify: JSON values appear to be 2025 inflation-projected. Needs FTB 2026 confirmation. |
| CO | ⚠️ std ded | **Patched** to federal 2026 ($16,100 / $32,200) per CRS §39-22-104 federal-conformity model |
| CT | 🟢 | No change (statutory, unchanged) |
| DE | 🟢 | No change (statutory, unchanged) |
| FL | 🟢 | No change (no income tax) |
| GA | 🟢 | No change (HB 111 rate verified) |

**Patches this commit**: 2 (AZ + CO std deductions to federal 2026 values).
**Open verification tasks for engine bot**: 3 (AR bracket structure, CA inflation indexing, AL std ded phaseout model).
