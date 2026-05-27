# 2026 State Tax Verification Sweep — Batch 4 (NJ–SC)

**Date:** 2026-05-27
**States in this batch:** New Jersey, New Mexico, Nevada, New York, Ohio, Oklahoma, Oregon, Pennsylvania, Rhode Island, South Carolina

---

## Per-state status

### 🟢 New Jersey (NJ)
- **Rate structure**: 7 brackets 1.4% to 10.75% — **statutory, NOT inflation-indexed** (NJSA 54A:2-1, surcharge over $1M added in 2020).
- **JSON**: brackets match statute ✓ (single + MFJ both verified per JSON `_source` annotation noting May 2026 restoration)
- **Std ded $0**: NJ has no standard deduction — uses personal exemption ($1,000 / filer + spouse). Phases out for high-income → effectively $0 for RETT clients.
- **stateLtcg**: `disconformLossOffset: true` flag captures the NJ-specific rule (capital losses offset only capital gains, not ordinary income per NJSA 54A:5-2).
- **Verdict**: ✓ Correct.
- **Authority**: NJSA 54A:2-1, NJSA 54A:5-2.

### ⚠️ New Mexico (NM) — **PATCH APPLIED THIS COMMIT**
- **Rate structure**: 5 brackets 1.7% / 3.2% / 4.7% / 4.9% / 5.9%. Per NMSA §7-2-7, brackets restructured by NM 2024 SB 41.
- **JSON**: rates ✓; thresholds approximately match 2025 indexed values.
- **Std deduction**: NMSA §7-2-2(B) ties NM std ded to federal §63. Patched to **$16,100 / $32,200** (federal 2026 per Rev. Proc. 2025-32 §3.16).
- **stateLtcg**: $2,500 flat exclusion per NMSA §7-2-34 (effective 2025) ✓
- **Verdict**: ⚠️ Std ded patched.
- **Authority**: NMSA §7-2-7 (brackets), §7-2-2(B) (std ded), §7-2-34 (LTCG); NM SB 41 (2024).

### 🟢 Nevada (NV)
- **No state income tax.**
- **JSON**: `noIncomeTax: true` ✓
- **Verdict**: ✓ Correct.

### 🟢 New York (NY)
- **Rate structure**: 9-bracket graduated, 4% to 10.9%. Top rate 10.9% over $25M (single & MFJ). Statutory since 2021 "millionaires tax" extension (NY Tax Law §601). **NOT inflation-indexed at the top brackets.**
- **JSON**: brackets match statute ✓
- **Std deduction**: $8,000 single / $16,050 MFJ — statutory per NY Tax Law §614. Slightly indexed historically but NY froze these in 2018. Current values stable.
- **Local tax (`hasLocalTax: true`)**: NYC (3.078–3.876%) and Yonkers (16.75% × NY tax for residents) impose additional. **Not modeled** — NYC RETT clients see state-side undercount of 3-4%.
- **Verdict**: 🟢 State brackets + std ded correct. Local tax flagged.
- **Authority**: NY Tax Law §601 (brackets), §614 (std ded); NYC Admin. Code §11-1701 (local).

### ⚠️ Ohio (OH)
- **Rate structure**: 2-bracket 0% / 2.75% structure per Ohio HB 33 (June 2023). Brackets indexed annually per Ohio Rev. Code §5747.02.
- **JSON**: 0% to $26,050; 2.75% above (all filing statuses)
- **Ohio HB 96 (signed June 30 2025)**: further accelerated rate cuts — top rate phasing from 2.75% (2025) toward a single flat 2.75% by 2026 and lower thereafter. Need DoR confirmation on 2026 specific rate.
- **Std deduction $0**: Ohio uses personal exemption + brackets-with-zero-band approach. Marker $0 correct.
- **Local tax (`hasLocalTax: true`)**: Ohio municipal income taxes 2-3% widespread. **Not modeled** — Cleveland, Columbus, Cincinnati clients see state-side undercount of 2-3%.
- **Verdict**: ⚠️ Rate structure approximately correct. **Verify 2026 specific rate against ORC §5747.02 + HB 96 schedule**.
- **Authority**: ORC §5747.02; OH HB 33 (2023), HB 96 (2025).

### 🟢 Oklahoma (OK)
- **Rate structure**: 3-bracket 2.5% / 3.5% / 4.5%. Per OK Stat §68-2355. **Statutory** — 2025 OK legislative session considered rate cuts but **none enacted** for 2026.
- **JSON brackets**: $3,750 / $4,900 single; $7,500 / $9,800 MFJ ✓
- **Std deduction**: $6,350 single / $12,700 MFJ per OK Stat §68-2358. Statutory, unchanged.
- **Verdict**: ✓ Correct.
- **Authority**: OK Stat §68-2355 (rate), §68-2358 (std ded).

### ⚠️ Oregon (OR)
- **Rate structure**: 4 brackets 4.75% / 6.75% / 8.75% / 9.9%. Per ORS §316.037. **Brackets indexed annually**.
- **JSON 2026 thresholds (single)**: $4,050 / $10,200 / $125,000 — look like 2024 values.
- **2025 actual thresholds (per OR DoR)**: $4,300 / $10,750 / $125,000 (single) — top threshold $125K is statutory, not indexed.
- **2026 estimated thresholds (with ~2.5% indexing)**: ~$4,400 / $11,000 / $125,000.
- **Std deduction**: $2,745 single / $5,495 MFJ — Oregon-specific, indexed annually per ORS §316.695. **Looks like 2024 values.** 2026 estimate: $2,830 / $5,665.
- **Verdict**: ⚠️ Brackets + std ded need OR DoR 2026 bulletin verification (typically late Dec).
- **Authority**: ORS §316.037 (brackets), §316.695 (std ded).

### 🟢 Pennsylvania (PA)
- **Rate structure**: Flat **3.07%** per 72 Pa. Stat. §7302. Statutory since 2004; **never inflation-indexed; not changed since 2003**.
- **JSON**: ✓
- **Std deduction $0**: PA has no std ded — income is classified by 8 categories with category-specific rules (e.g., capital gains netted within the gains category; no general deductions).
- **Local tax (`hasLocalTax: true`)**: PA local Earned Income Tax 1-3.928% (Philadelphia 3.928%). **Not modeled** — Philly RETT clients see state-side undercount of ~4%.
- **Verdict**: ✓ State correct. Local tax flagged.
- **Authority**: 72 Pa. Stat. §7302.

### ⚠️ Rhode Island (RI)
- **Rate structure**: 3 brackets 3.75% / 4.75% / 5.99% — Brackets indexed annually per RIGL §44-30-2(c).
- **JSON brackets**: $75,800 / $172,350 — look like 2024 values.
- **2025 actual (per RI DOR)**: $77,450 / $176,050.
- **2026 estimated**: $79,400 / $180,400 (with ~2.5% indexing).
- **Std deduction**: $10,900 / $21,800 — indexed annually per RIGL §44-30-2(a)(7). **Looks like 2024 values.** 2026 estimate ~$11,500 / $23,000.
- **Verdict**: ⚠️ Both brackets + std ded need RI DOR 2026 publication verification.
- **Authority**: RIGL §44-30-2.

### ⚠️ South Carolina (SC) — **PATCH APPLIED THIS COMMIT**
- **Rate structure**: 3-bracket 0% / 3% / 6.0% — top rate phasing per SC Act 532 (2022): 6.5% (2022) → 6.4% (2023) → 6.3% (2024) → 6.2% (2025) → **6.0% (2026)** if revenue triggers met. JSON shows 6%, indicating trigger met or upcoming.
- **JSON**: ✓ (top rate 6.0% appears correct per phase schedule)
- **Std deduction**: SC Code §12-6-1140 conforms to federal §63 std ded. Patched to **$16,100 / $32,200** (federal 2026).
- **stateLtcg**: 44% deduction from net capital gain (held >1 year) per SC Code §12-6-1150 ✓
- **Verdict**: ⚠️ Std ded patched. Rate cut to 6.0% should be confirmed against SC Revenue & Fiscal Affairs Office 2026 trigger compliance.
- **Authority**: SC Code §12-6-1140 (std ded), §12-6-1150 (LTCG), §12-6-510 (rates); SC Act 532 (2022).

---

## Summary

| State | Status | Action |
|---|:-:|---|
| NJ | 🟢 | No change (statutory, JSON verified per May 2026 restoration) |
| NM | ⚠️ → ✓ | **Patched** std ded to federal 2026 |
| NV | 🟢 | No change (no income tax) |
| NY | 🟢 | State correct; NYC + Yonkers local tax not modeled |
| OH | ⚠️ | Verify: 2026 rate per HB 96 (June 2025) phase schedule; municipal local tax not modeled |
| OK | 🟢 | No change (statutory; no 2026 rate cut enacted) |
| OR | ⚠️ | Verify: 2026 bracket + std ded indexing |
| PA | 🟢 | No change (statutory 3.07%); PA local EIT not modeled |
| RI | ⚠️ | Verify: 2026 bracket + std ded indexing |
| SC | ⚠️ → ✓ | **Patched** std ded; verify 2026 rate trigger met (should be 6.0%) |

**Patches this commit**: 2 (NM + SC std ded).
**Open verification tasks**: 5 (OH HB 96 rate, OR 2026 indexing, RI 2026 indexing, SC 2026 trigger, NY local tax modeling).
