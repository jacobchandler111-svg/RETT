// FILE: js/02-tax-engine/tax-calc-state.js
// State income tax computation. Reads the per-state record via tax-lookups
// helpers and handles the special-cases that appear in the source data:
//
//   - noIncomeTax: true                  -> returns 0
//   - flatRate: true                     -> single-rate progressive shape
//   - mentalHealthSurcharge (CA)         -> 1% over $1M
//   - millionaireSurcharge (MA)          -> 4% over $1M
//   - capitalGainsTax (WA)               -> 7% on LT gains over $270k
//
// Capital gains in MOST states are taxed at ordinary rates. The engine
// honors opts.longTermGain only via three explicit channels:
//   1) WA's stand-alone capital gains tax (no income tax otherwise)
//   2) State-specific preferential-LT data on the state node:
//        node.stateLtcg = { rate?: 0.07, exclusionPct?: 0.30, ... }
//      where rate replaces the ordinary stack for the LT slice and
//      exclusionPct subtracts that fraction of LT from taxable income.
//   3) §1211(b) capital-loss offset — most states conform to the
//      federal $3K / $1.5K MFS ordinary offset; we apply it here
//      against the state taxable base too. States that explicitly
//      disconform can set stateLtcg.disconformLossOffset = true on
//      the data node.
//
// If a state has known preferential LT treatment (HI 7.25%, NM 0.40%
// LT deduction, WI 30% LT exclusion, AR 50% LT exclusion, MT $5,500
// LT exclusion) and the state node lacks stateLtcg metadata, the
// engine falls through to ORDINARY treatment with a console TODO so
// the data audit shows up. Adding stateLtcg fields requires citing the
// state DOR — do not fabricate rates. (P0-12.)

function _flatBracketTaxState(amount, brackets) {
          if (amount <= 0 || !brackets || !brackets.length) return 0;
          let tax = 0, prevMax = 0;
          for (const b of brackets) {
                        const cap = b[0], rate = b[1];
                        if (amount <= prevMax) break;
                        const slabMax = Math.min(amount, cap);
                        tax += (slabMax - prevMax) * rate;
                        prevMax = cap;
                        if (amount <= cap) break;
          }
          return tax;
}

// Track which (stateCode, year) combos we've already warned about so
// the TODO log fires once per session per state instead of on every
// keystroke as the user types.
const _stateLtcgTodoWarned = (typeof window !== 'undefined') ? (window.__rettStateLtcgWarned = window.__rettStateLtcgWarned || {}) : {};
// States that have any kind of LTCG-specific preferential treatment.
// When the state's data node lacks stateLtcg metadata, the engine logs a
// once-per-session TODO so the missing rate surfaces in the audit. AL was
// removed 2026-05-05 after research confirmed Alabama has NO LTCG
// preferential treatment — capital gains are taxed as ordinary income at
// the standard 2-5% brackets. VT remains on the list (40% exclusion exists
// but the engine schema can't cleanly express VT's multi-cap rule yet —
// $350K cap on excluded amount + asset-class exclusions for residences,
// public stocks, depreciable property — so it falls back to ordinary
// treatment, conservative-high baseline, with a TODO).
const _STATE_LTCG_PREFERENTIAL = new Set(['HI','NM','WI','AR','MT','SC','VT','NJ']);

function computeStateTax(income, year, stateCode, status, opts) {
          if (!stateCode || stateCode === 'NONE') return 0;
          // P2-7: when a state code isn't in the data file at all (typo
          // in saved case, future state added without code update), log
          // once and return 0 rather than silently falling back. The
          // user sees nothing on screen but at least the dev console
          // surfaces the data gap.
          if (typeof TAX_DATA !== 'undefined' && TAX_DATA && TAX_DATA.states &&
              !getStateNode(year, stateCode)) {
                  try {
                          if (typeof window !== 'undefined') {
                                  var k = '__rettBadStateWarned';
                                  window[k] = window[k] || {};
                                  var key = stateCode + ':' + year;
                                  if (!window[k][key]) {
                                          window[k][key] = true;
                                          if (typeof console !== 'undefined' && console.warn) {
                                                  console.warn('[tax-calc-state] No data node for state ' +
                                                          stateCode + ' in year ' + year +
                                                          ' — returning $0. Verify state code in saved case.');
                                          }
                                  }
                          }
                  } catch (e) { /* */ }
                  return 0;
          }
          opts = opts || {};
          const lt = Math.max(0, Number(opts.longTermGain) || 0);
          const st = Math.max(0, Number(opts.shortTermGain) || 0);
          // Carried-loss offset matches the federal §1211(b) handling:
          // most states conform. The caller passes lossOrdOffsetApplied
          // (the dollar amount the federal engine actually applied) so
          // both engines stay consistent on the same base.
          const lossOff = Math.max(0, Number(opts.lossOrdOffsetApplied) || 0);

          if (isStateNoIncomeTax(year, stateCode)) {
                        // WA has a stand-alone capital gains tax even though there's no
              // income tax. Caller can opt-in via opts.longTermGain.
              const sur = getStateSurcharges(year, stateCode);
                        if (sur.capitalGainsTax && lt > 0) {
                                          // B13: project the threshold by inflation for years
                                          // past the published baseYear so a 2030 sale doesn't
                                          // pay WA cap-gains tax on the same nominal $270K
                                          // threshold the data file lists for 2026.
                                          const projFactor = (TAX_DATA.states && TAX_DATA.states[String(year)]
                                                  && TAX_DATA.states[String(year)][stateCode])
                                                  ? 1 : _yearProjectionFactor(year);
                                          const t   = sur.capitalGainsTax.threshold * projFactor;
                                          const r   = sur.capitalGainsTax.rate;
                                          return Math.max(0, lt - t) * r;
                        }
                        return 0;
          }

          const itemized = Math.max(0, opts.itemized || 0);
          const stdDed   = getStateStandardDeduction(year, stateCode, status);
          const deduction = Math.max(stdDed, itemized);

          // State preferential-LT data (when present on the state node).
          const node = getStateNode(year, stateCode);
          const stateLtcg = (node && node.stateLtcg) || null;
          const disconformLossOffset = !!(stateLtcg && stateLtcg.disconformLossOffset);
          const effectiveLossOff = disconformLossOffset ? 0 : lossOff;
          // For disconforming states (NJ): the caller's `income` arg
          // has already had the federal §1211 ordinary-offset baked in
          // (the upstream loss-netting reduces scenario.ordinaryIncome
          // before it reaches us). NJ doesn't conform to that offset
          // — capital losses can't offset ordinary income in NJ — so
          // we ADD BACK the federal offset to the ordinary base before
          // running state brackets. Conforming states leave income as-is.
          const _addBackForDisconform = disconformLossOffset ? lossOff : 0;

          // Decide how much of the LT gain feeds the ordinary stack
          // versus a separate preferential calc.
          let ltOrdinaryPortion = lt;
          let ltPreferentialPortion = 0;
          let ltPreferentialTax = 0;
          if (stateLtcg) {
                        const exclusionPct = Math.min(1, Math.max(0, Number(stateLtcg.exclusionPct) || 0));
                        const flatExclusion = Math.max(0, Number(stateLtcg.flatExclusion) || 0);
                        const excluded = Math.min(lt, lt * exclusionPct + flatExclusion);
                        ltOrdinaryPortion = Math.max(0, lt - excluded);
                        // If the state taxes LT at a flat preferential rate, peel
                        // that off the ordinary stack and apply it directly.
                        if (Number.isFinite(stateLtcg.rate)) {
                                          ltPreferentialPortion = ltOrdinaryPortion;
                                          ltPreferentialTax = ltPreferentialPortion * Number(stateLtcg.rate);
                                          ltOrdinaryPortion = 0;
                        }
          } else if (_STATE_LTCG_PREFERENTIAL.has(stateCode) && lt > 0) {
                        // The data file is missing preferential-LT info for a state
                        // that actually has it on the books. Log once so the audit
                        // surfaces; treat as ordinary in the meantime so the user
                        // sees a CONSERVATIVE-HIGH baseline instead of a silent
                        // under-collection. See P0-12 for the audit list.
                        const k = stateCode + ':' + year;
                        if (!_stateLtcgTodoWarned[k]) {
                                          _stateLtcgTodoWarned[k] = true;
                                          if (typeof console !== 'undefined' && console.warn) {
                                                          console.warn('[tax-calc-state] TODO: ' + stateCode +
                                                                ' has preferential LTCG treatment but no stateLtcg data — treating LT as ordinary. Audit data/taxBrackets.json against state DOR.');
                                          }
                        }
          }

          // Build the state's ordinary bracket base. Most states tax
          // (ordinary + ST + LT-treated-as-ordinary) at progressive rates,
          // less the standard deduction and federal-conforming loss
          // offset. The caller passed `income` already including ord+LT
          // pre-deduction; if we're peeling off an LT-preferential slice
          // we subtract it from the ordinary base and add the
          // preferential tax separately. (NB: callers that DIDN'T add LT
          // to `income` will see this as a no-op subtraction, which is
          // safe; the engine never "doubles" gains it didn't see.)
          const adjIncome = Math.max(0, income - (lt - ltOrdinaryPortion) + _addBackForDisconform);
          const taxable   = Math.max(0, adjIncome - deduction - effectiveLossOff);

          const brackets = getStateBrackets(year, stateCode, status);
          let tax = _flatBracketTaxState(taxable, brackets);
          tax += ltPreferentialTax;

          // Surcharges.
          const sur = getStateSurcharges(year, stateCode);
          if (sur.mentalHealthSurcharge) {
                        const t = sur.mentalHealthSurcharge.threshold;
                        const r = sur.mentalHealthSurcharge.rate;
                        tax += Math.max(0, taxable - t) * r;
          }
          if (sur.millionaireSurcharge) {
                        const t = sur.millionaireSurcharge.threshold;
                        const r = sur.millionaireSurcharge.rate;
                        tax += Math.max(0, taxable - t) * r;
          }

          return tax;
}
