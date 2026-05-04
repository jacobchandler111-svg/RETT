// FILE: js/02-tax-engine/tax-lookups.js
// Bracket lookup helpers. The on-disk schema (data/taxBrackets.json) uses:
//   federal[YEAR].brackets.{single|married_joint|married_separate|head_household}
//                         => array of [maxOfBracket, rate]
//   federal[YEAR].standardDeduction.{status} => number
//   federal[YEAR].ltcgRates.{status}         => array of [maxOfBracket, rate]
//   federal[YEAR].niitThreshold.{status}     => number
//   federal[YEAR].seTaxRate, seTaxMultiplier
//
//   state[YEAR][CC].brackets.{single|married_joint} => array of [max, rate]
//   state[YEAR][CC].standardDeduction.{status}      => number
//   state[YEAR][CC].flatRate (optional bool)
//   state[YEAR][CC].noIncomeTax (optional bool)
//   state[YEAR][CC].capitalGainsTax (optional)
//   state[YEAR][CC].mentalHealthSurcharge (CA, optional)
//   state[YEAR][CC].millionaireSurcharge (MA, optional)
//
// For years past TAX_DATA.baseYear (2026) we project bracket thresholds
// forward at TAX_DATA.inflationRate per year using FULL FLOATING-POINT
// PRECISION. Rates and the $3,000 / $1,500 ordinary-offset cap are NOT
// inflated. Standard deductions ARE inflated.

// UI uses these short codes. JSON keys use snake_case. Translate here.
// (Issue #59: extended to accept BOTH the UI codes AND the JSON
// long-form keys so a saved-state migration that stored the long
// form doesn't silently fall back to single brackets.)
const TAX_FILING_STATUSES = ['single', 'mfj', 'mfs', 'hoh'];
const TAX_FS_TO_KEY = {
          single:           'single',
          mfj:              'married_joint',
          mfs:              'married_separate',
          hoh:              'head_household',
          // Long-form pass-through (defensive — accepts engine codes
          // already in canonical form):
          married_joint:    'married_joint',
          married_separate: 'married_separate',
          head_household:   'head_household'
};

function isFilingStatusValid(s) { return TAX_FILING_STATUSES.indexOf(s) !== -1; }
function fsKey(s) { return TAX_FS_TO_KEY[s] || s; }

function _yearProjectionFactor(year) {
          const base = TAX_DATA.baseYear;
          if (year <= base) return 1;
          // Issue #68: far-future projections (>10 yrs past base)
          // are increasingly speculative because real bracket creep
          // diverges from a flat 2% over decades. Warn once per
          // session so the dashboard can label projections beyond
          // the comfort horizon as "projected, beyond IRS horizon".
          if (year - base > 10 && typeof window !== 'undefined') {
                if (!window.__rettFarFutureWarned) {
                      window.__rettFarFutureWarned = true;
                      if (typeof console !== 'undefined' && console.warn) {
                            console.warn('[tax-lookups] _yearProjectionFactor called for year ' + year +
                              ' (' + (year - base) + ' yrs past base ' + base +
                              '). Numbers beyond +10 yrs are speculative.');
                      }
                }
          }
          return Math.pow(1 + TAX_DATA.inflationRate, year - base);
}

function _resolveYearKey(year) {
          if (TAX_DATA.federal && TAX_DATA.federal[String(year)]) return String(year);
          return String(TAX_DATA.baseYear);
}

function _projectFlatBrackets(brackets, factor) {
          // Original shape: [[max, rate], [max, rate], ...]. We project the max
    // (except sentinel max which is Infinity post-decode) by factor.
    return brackets.map(b => [b[0] === Infinity ? Infinity : b[0] * factor, b[1]]);
}

function getFederalNode(year) {
          const key = _resolveYearKey(year);
          return TAX_DATA.federal[key] || null;
}

function getFederalBrackets(year, status) {
          const node = getFederalNode(year);
          if (!node) return null;
          const k = fsKey(status);
          const factor = (TAX_DATA.federal[String(year)]) ? 1 : _yearProjectionFactor(year);
          return _projectFlatBrackets(node.brackets[k] || [], factor);
}

function getFederalLTCGBrackets(year, status) {
          const node = getFederalNode(year);
          if (!node) return null;
          const k = fsKey(status);
          const factor = (TAX_DATA.federal[String(year)]) ? 1 : _yearProjectionFactor(year);
          return _projectFlatBrackets(node.ltcgRates[k] || [], factor);
}

function getFederalStandardDeduction(year, status) {
          const node = getFederalNode(year);
          if (!node) return 0;
          const k = fsKey(status);
          const raw = node.standardDeduction[k] || 0;
          const factor = (TAX_DATA.federal[String(year)]) ? 1 : _yearProjectionFactor(year);
          return raw * factor;
}

function getFederalNiitThreshold(year, status) {
          const node = getFederalNode(year);
          if (!node) return Infinity;
          const k = fsKey(status);
          const raw = node.niitThreshold[k] != null ? node.niitThreshold[k] : Infinity;
          const factor = (TAX_DATA.federal[String(year)]) ? 1 : _yearProjectionFactor(year);
          return raw === Infinity ? Infinity : raw * factor;
}

function getStateNode(year, stateCode) {
          if (!stateCode || stateCode === 'NONE') return null;
          const key = _resolveYearKey(year);
          if (!TAX_DATA.states || !TAX_DATA.states[key]) return null;
          return TAX_DATA.states[key][stateCode] || null;
}

// Map a federal filing status to the state bracket bucket. Source data
// only carries 'single' and 'married_joint'; MFS uses MFJ-halved
// brackets (Form 1040 standard treatment), HOH uses single brackets
// (close approximation — actual HOH brackets are slightly wider in some
// states but unpublished data points are out of scope here).
function _stateBracketChoice(status) {
          const fk = fsKey(status);
          if (fk === 'married_joint') return { key: 'married_joint', halve: false };
          if (fk === 'married_separate' || fk === 'mfs')
                  return { key: 'married_joint', halve: true };
          // single, hoh, head_of_household → 'single'
          return { key: 'single', halve: false };
}

function getStateBrackets(year, stateCode, status) {
          const node = getStateNode(year, stateCode);
          if (!node || node.noIncomeTax) return null;
          const choice = _stateBracketChoice(status);
          const factor = (TAX_DATA.states[String(year)] && TAX_DATA.states[String(year)][stateCode])
                  ? 1 : _yearProjectionFactor(year);
          // MFS halves the MFJ thresholds (rates are unchanged) — mirrors
          // how a real return treats MFS at the federal level.
          const halve = choice.halve ? 0.5 : 1;
          const raw = (node.brackets && node.brackets[choice.key]) || [];
          return _projectFlatBrackets(raw, factor * halve);
}

function getStateStandardDeduction(year, stateCode, status) {
          const node = getStateNode(year, stateCode);
          if (!node || node.noIncomeTax) return 0;
          const choice = _stateBracketChoice(status);
          const raw = (node.standardDeduction && node.standardDeduction[choice.key]) || 0;
          const factor = (TAX_DATA.states[String(year)] && TAX_DATA.states[String(year)][stateCode])
                  ? 1 : _yearProjectionFactor(year);
          // MFS gets half the MFJ standard deduction.
          const halve = choice.halve ? 0.5 : 1;
          return raw * factor * halve;
}

function isStateNoIncomeTax(year, stateCode) {
          const node = getStateNode(year, stateCode);
          return !!(node && node.noIncomeTax);
}

function getStateSurcharges(year, stateCode) {
          const node = getStateNode(year, stateCode);
          if (!node) return {};
          return {
                        capitalGainsTax:        node.capitalGainsTax        || null,  // WA
                        mentalHealthSurcharge:  node.mentalHealthSurcharge  || null,  // CA
                        millionaireSurcharge:   node.millionaireSurcharge   || null   // MA
          };
}
