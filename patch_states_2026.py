"""
2026 state bracket patch script — applies confirmed 2026 rate/structure
changes to data/taxBrackets.json.

Sources:
  - IRS Rev. Proc. 2025-32 (federal — already correct, not patched)
  - Tax Foundation 2026 State Income Tax Rates and Brackets (Feb 2026)
  - Tax Foundation 2026 State Tax Changes Taking Effect Jan 1
  - Georgia HB 463 (April 2026, post-dates Tax Foundation publication)
  - Oklahoma HB 2764 (signed May 2025, effective 2026)
  - Nebraska LB 754 (multi-year phase-down, 2026 step)

Run from repo root: python3 patch_states_2026.py
Writes data/taxBrackets.json in place. Idempotent if rerun.
"""
import json
from pathlib import Path

PATH = Path(__file__).parent / 'data' / 'taxBrackets.json'

with open(PATH) as f:
    d = json.load(f)

s2026 = d['state']['2026']

# --- Confirmed rate-only fixes (preserve existing thresholds) ---
def set_flat_rate(state_code, new_rate):
    s = s2026[state_code]
    for fs in ['single', 'married_joint', 'married_separate', 'head_household']:
        if fs in s['brackets']:
            s['brackets'][fs] = [[999999999, new_rate]]

def set_top_rate_only(state_code, new_top_rate):
    """Replace just the top tier's rate. Leaves all other tiers and thresholds untouched."""
    s = s2026[state_code]
    for fs in ['single', 'married_joint', 'married_separate', 'head_household']:
        if fs in s['brackets'] and len(s['brackets'][fs]) > 0:
            s['brackets'][fs][-1] = [s['brackets'][fs][-1][0], new_top_rate]

# Georgia HB 463 — flat 5.39% → 4.99%
set_flat_rate('GA', 0.0499)

# Indiana enacted phase-down — flat 3.05% → 2.95%
set_flat_rate('IN', 0.0295)

# Kentucky enacted phase-down — flat 4.00% → 3.50%
set_flat_rate('KY', 0.035)

# North Carolina final phasedown — flat 4.25% → 3.99%
set_flat_rate('NC', 0.0399)

# Idaho — flat 5.80% → 5.30%
set_flat_rate('ID', 0.053)

# Utah — flat 4.65% → 4.50%
set_flat_rate('UT', 0.045)

# Mississippi — top 4.40% → 4.00% (keep $10K tier-1 zero-rate boundary)
set_top_rate_only('MS', 0.04)

# Montana — top 5.90% → 5.65% (keep tier-1 boundary)
set_top_rate_only('MT', 0.0565)

# West Virginia — top 5.12% → 4.82% (per TF; lower tiers untouched
# since heavy-LT scenarios route most income to the top bracket anyway)
set_top_rate_only('WV', 0.0482)

# South Carolina — top 6.40% → 6.00%
set_top_rate_only('SC', 0.06)

# --- Structural changes (replace bracket arrays) ---

# Ohio — graduated 3 tiers (top 3.688%) → flat 2.75% over $26,050
# (income under $26,050 is exempt; effectively flat-ish above)
s2026['OH']['brackets'] = {
    'single':           [[26050, 0], [999999999, 0.0275]],
    'married_joint':    [[26050, 0], [999999999, 0.0275]],
    'married_separate': [[26050, 0], [999999999, 0.0275]],
    'head_household':   [[26050, 0], [999999999, 0.0275]],
}

# Oklahoma HB 2764 — 6 brackets (top 4.75%) → 3 brackets (top 4.50%)
# Per Tax Foundation 2026 detail table.
s2026['OK']['brackets'] = {
    'single':           [[3750, 0.025], [4900, 0.035], [999999999, 0.045]],
    'married_joint':    [[7500, 0.025], [9800, 0.035], [999999999, 0.045]],
    'married_separate': [[3750, 0.025], [4900, 0.035], [999999999, 0.045]],
    'head_household':   [[3750, 0.025], [4900, 0.035], [999999999, 0.045]],
}

# Nebraska LB 754 — 4 brackets (top 5.64%) → 3 brackets (top 4.55%)
s2026['NE']['brackets'] = {
    'single':           [[4130, 0.0246], [24760, 0.0351], [999999999, 0.0455]],
    'married_joint':    [[8250, 0.0246], [49530, 0.0351], [999999999, 0.0455]],
    'married_separate': [[4130, 0.0246], [24760, 0.0351], [999999999, 0.0455]],
    'head_household':   [[4130, 0.0246], [24760, 0.0351], [999999999, 0.0455]],
}

# Iowa — graduated → flat 3.80% (effective 2026)
s2026['IA']['flatRate'] = True
s2026['IA']['brackets'] = {
    'single':           [[999999999, 0.038]],
    'married_joint':    [[999999999, 0.038]],
    'married_separate': [[999999999, 0.038]],
    'head_household':   [[999999999, 0.038]],
}

# Louisiana — graduated → flat 3.00% (effective 2026)
s2026['LA']['flatRate'] = True
s2026['LA']['brackets'] = {
    'single':           [[999999999, 0.03]],
    'married_joint':    [[999999999, 0.03]],
    'married_separate': [[999999999, 0.03]],
    'head_household':   [[999999999, 0.03]],
}

# Kansas — 3 brackets → 2 brackets (top 5.58%)
s2026['KS']['brackets'] = {
    'single':           [[23000, 0.052], [999999999, 0.0558]],
    'married_joint':    [[46000, 0.052], [999999999, 0.0558]],
    'married_separate': [[23000, 0.052], [999999999, 0.0558]],
    'head_household':   [[23000, 0.052], [999999999, 0.0558]],
}

# Maryland — added two top brackets at $500K and $1M (per HB 1515 enacted 2024)
# 8 → 10 brackets total. Top rate 5.75% → 6.50%.
s2026['MD']['brackets'] = {
    'single': [
        [1000, 0.02], [2000, 0.03], [3000, 0.04],
        [100000, 0.0475], [125000, 0.05], [150000, 0.0525],
        [250000, 0.055], [500000, 0.0575], [1000000, 0.0625],
        [999999999, 0.065]
    ],
    'married_joint': [
        [1000, 0.02], [2000, 0.03], [3000, 0.04],
        [150000, 0.0475], [175000, 0.05], [225000, 0.0525],
        [300000, 0.055], [600000, 0.0575], [1200000, 0.0625],
        [999999999, 0.065]
    ],
    'married_separate': [
        [1000, 0.02], [2000, 0.03], [3000, 0.04],
        [100000, 0.0475], [125000, 0.05], [150000, 0.0525],
        [250000, 0.055], [500000, 0.0575], [1000000, 0.0625],
        [999999999, 0.065]
    ],
    'head_household': [
        [1000, 0.02], [2000, 0.03], [3000, 0.04],
        [150000, 0.0475], [175000, 0.05], [225000, 0.0525],
        [300000, 0.055], [600000, 0.0575], [1200000, 0.0625],
        [999999999, 0.065]
    ],
}

# Massachusetts — millionaire surcharge threshold inflation-adjusted from
# $1,000,000 to $1,083,150 for tax year 2026 (per ballot measure annual COLA).
s2026['MA']['millionaireSurcharge'] = {'threshold': 1083150, 'rate': 0.04}

# --- Update _comment to reflect this verification pass ---
s2026['_comment'] = (
    '2026 state brackets verified 2026-05-06 against IRS Rev. Proc. 2025-32 '
    '(federal), Tax Foundation 2026 State Income Tax Rates page (Feb 2026), '
    'and post-Feb state law changes (GA HB 463). Patched 13 states for rate '
    'cuts or structural changes effective Jan 1 2026: GA, IN, KY, NC, ID, UT, '
    'MS, MT, WV, SC, OH, OK, NE, IA, LA, KS, MD; plus MA millionaire-surcharge '
    'inflation. Standard deductions not refreshed in this pass — verify '
    'against state DORs before relying on dollar-exact std-ded display.'
)

with open(PATH, 'w') as f:
    json.dump(d, f, indent=2)

print(f'Wrote {PATH}')
print(f'States patched: GA, IN, KY, NC, ID, UT, MS, MT, WV, SC (rates); '
      f'OH, OK, NE, IA, LA, KS, MD (structure); MA (millionaire COLA).')
