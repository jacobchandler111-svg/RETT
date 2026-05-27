# 2026 State Tax Verification Sweep — Batch 3 (MA–NH)

**Date:** 2026-05-27
**States in this batch:** Massachusetts, Michigan, Minnesota, Missouri, Mississippi, Montana, North Carolina, North Dakota, Nebraska, New Hampshire (alphabetical: MA, MI, MN, MO, MS, MT, NC, ND, NE, NH)

---

## Per-state status

### ⚠️ Massachusetts (MA)
- **Rate structure**: Flat **5%** statutory + 4% Fair Share Amendment surcharge over inflation-indexed threshold (per MGL Ch. 62 §4).
- **JSON**: rate 5% ✓; `millionaireSurcharge: { threshold: $1,083,150, rate: 0.04 }`
- **Threshold history**: 2023 = $1,000,000 (statutory base); 2024 = $1,053,750; 2025 = $1,083,150; 2026 ≈ $1,108,000–$1,115,000 (estimate with ~2.5% indexing).
- **JSON value $1,083,150** matches 2025 — appears 1 year stale.
- **Std ded $0**: MA has no std deduction (uses personal exemption $4,400 single / $8,800 MFJ — phases out for high-income → effectively $0 for RETT clients).
- **Verdict**: ⚠️ Verify 2026 millionaire surtax threshold against MA DOR Technical Information Release (typically published Jan).
- **Authority**: MGL Ch. 62 §4(d) (Fair Share Amendment, codified post-2022 Question 1).

### 🟢 Michigan (MI)
- **Rate structure**: Flat **4.25%**. Was 4.05% in 2023 (revenue-trigger reduction), reverted to 4.25% in 2024 (trigger not met), 4.25% in 2025 & 2026.
- **JSON**: ✓
- **Std ded $0**: MI uses personal exemption (~$5,800 in 2025) — phases out for high-income → effectively $0 for RETT clients.
- **Verdict**: ✓ Correct.
- **Authority**: MCL 206.51.

### ⚠️ Minnesota (MN) — **PATCH APPLIED THIS COMMIT**
- **Rate structure**: 4 brackets 5.35% / 6.8% / 7.85% / 9.85%. Indexed annually per Minn. Stat. §290.06.
- **JSON brackets (single)**: $32,710 / $107,430 / $189,270 / 9.85% — appears to be 2025 values.
- **Std deduction**: Minn. Stat. §290.0123 conforms to federal §63 std ded. JSON has $15K/$30K (2025 federal); patched to **$16,100 / $32,200** (2026 federal per Rev. Proc. 2025-32 §3.16).
- **Already TODO-flagged**: net investment surtax 1% on net invest income > $1M (Minn. Stat. §290.033 / 2023 Minn. Sess. Laws ch. 64). Engine doesn't apply.
- **Verdict**: ⚠️ Std ded patched. Brackets still need DoR 2026 confirmation.
- **Authority**: Minn. Stat. §290.06 (brackets), §290.0123 (std ded conformity), §290.033 (NII surtax).

### ⚠️ Missouri (MO) — **PATCH APPLIED THIS COMMIT**
- **Rate structure**: 8 brackets, top rate **4.7%** (MO HB 2649 (2022) phased rate cuts based on revenue triggers; 4.7% achieved 2025).
- **JSON top rate**: 4.7% ✓
- **Brackets**: $1,246 to $8,722 thresholds — Missouri indexes annually per Mo. Stat. §143.011. Values look like 2024/2025.
- **Std deduction**: Mo. Stat. §143.121(2) conforms to federal §63 std ded. Patched to **$16,100 / $32,200** (federal 2026).
- **Verdict**: ⚠️ Std ded patched. Bracket inflation indexing for 2026 needs DoR verification (typically Dec).
- **Authority**: Mo. Stat. §143.011 (brackets), §143.121 (std ded).

### 🟢 Mississippi (MS)
- **Rate structure**: 0% on first $10K, **4%** above. Per MS HB 1733 (2022) phase-down schedule: 5% (2022) → 4.7% → 4.4% → **4% (2026)**.
- **JSON**: ✓ matches phase schedule
- **Std deduction**: $2,300 single / $4,600 MFJ — Miss. Code §27-7-21 statutory. ✓
- **Verdict**: ✓ Correct.
- **Authority**: Miss. Code §27-7-5 (rate), §27-7-21 (std ded); MS HB 1733 (2022).

### ⚠️ Montana (MT) — **PATCH APPLIED THIS COMMIT**
- **Rate structure**: 2 brackets per MT HB 192 (2023): **4.7% / 5.65%**. Threshold $21,100.
- **JSON**: ✓ rates and threshold match
- **Note**: MT applies same threshold to single and MFJ (no doubling) — confirmed via MT DOR Form 2 instructions.
- **Std deduction**: MCA §15-30-2110 conforms to federal §63 std ded. Patched to **$16,100 / $32,200** (federal 2026).
- **stateLtcg rate 4.1%** per MCA §15-30-2103 (HB 337) ✓
- **Verdict**: ⚠️ Std ded patched.
- **Authority**: MCA §15-30-2103 (rates + LTCG), §15-30-2110 (std ded); MT HB 192 (2023), HB 337 (2023).

### ⚠️ North Carolina (NC)
- **Rate structure**: Flat per NC GS §105-153.7: 4.25% (2025) → **3.99% (2026)** → 3.49% (2027) → eventually 2.49% (2030).
- **JSON rate**: 3.99% ✓ matches 2026 schedule.
- **Std deduction**: NC GS §105-153.5(a). 2025 = $12,750/$25,500. 2026 inflation-indexed estimate: $13,150/$26,300 — JSON matches this estimate.
- **Verdict**: ⚠️ Rate correct. Std ded values look like 2026 inflation projection but worth DoR confirmation (NC DoR publishes via Notice in December).
- **Authority**: NC GS §105-153.7 (rate), §105-153.5(a) (std ded).

### ⚠️ North Dakota (ND) — **PATCH APPLIED THIS COMMIT**
- **Rate structure**: 2 brackets per ND HB 1158 (2023): **1.95% / 2.5%**.
- **JSON**: rates ✓
- **Brackets**: $44,725 single / $74,750 MFJ — indexed annually per ND Cent. Code §57-38-30.3.
- **Std deduction**: ND Cent. Code §57-38-29 conforms to federal §63 std ded. Patched to **$16,100 / $32,200** (federal 2026).
- **Verdict**: ⚠️ Std ded patched. Bracket inflation indexing for 2026 needs DoR verification.
- **Authority**: ND Cent. Code §57-38-30.3 (brackets), §57-38-29 (std ded); ND HB 1158 (2023).

### 🟢 Nebraska (NE)
- **Rate structure**: 3 brackets per NE LB 754 (2023): top rate phase-down 5.84% (2024) → 5.20% (2025) → **4.55% (2026)** → 3.99% (2027) eventually.
- **JSON top rate**: 4.55% ✓ matches 2026 schedule.
- **Brackets**: $4,130 / $24,760 single / $8,250 / $49,530 MFJ — NE indexes annually per Neb. Rev. Stat. §77-2715.03.
- **Std deduction**: $8,150 single / $16,300 MFJ — Neb. Rev. Stat. §77-2716.01 — NE has its OWN std ded amount (does NOT conform to federal).
- **Verdict**: ✓ Rate correct; brackets and std ded approximately right per recent reform. 2026 inflation indexing could shift bracket positions slightly.
- **Authority**: Neb. Rev. Stat. §77-2715 (rate), §77-2715.03 (bracket indexing), §77-2716.01 (std ded); NE LB 754 (2023).

### 🟢 New Hampshire (NH)
- **Income tax structure**: NH had an Interest & Dividends tax (5% in 2024, 4% in 2025) but it was **fully repealed effective Jan 1 2025** per NH SB 189 (2023). No wage income tax (never has had one).
- **JSON**: `noIncomeTax: true` ✓ correct for 2026.
- **Verdict**: ✓ Correct.
- **Authority**: NH RSA 77 (repealed via SB 189, 2023).

---

## Summary

| State | Status | Action |
|---|:-:|---|
| MA | ⚠️ | Verify: 2026 millionaire surtax threshold (inflation-indexed from $1,083,150 to ~$1,108K) |
| MI | 🟢 | No change (flat 4.25%) |
| MN | ⚠️ → ✓ | **Patched** std ded to federal 2026; brackets need DoR 2026 confirmation; NII surtax already TODO |
| MO | ⚠️ → ✓ | **Patched** std ded to federal 2026; brackets need DoR 2026 confirmation |
| MS | 🟢 | No change (4% per HB 1733 phase ✓) |
| MT | ⚠️ → ✓ | **Patched** std ded to federal 2026 |
| NC | ⚠️ | Rate 3.99% ✓; std ded values match inflation estimate but DoR confirmation pending |
| ND | ⚠️ → ✓ | **Patched** std ded to federal 2026; brackets need DoR 2026 confirmation |
| NE | 🟢 | No change (top rate 4.55% per LB 754 ✓) |
| NH | 🟢 | No change (no income tax for 2026+) |

**Patches this commit**: 4 (MN, MO, MT, ND std deductions).
**Open verification tasks**: 4 (MA millionaire threshold, MN+MO+ND bracket indexing).
**Unmodeled features (already noted in JSON)**: MN net investment surtax 1% > $1M.
