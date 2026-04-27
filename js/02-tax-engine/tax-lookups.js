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
const TAX_FILING_STATUSES = ['single', 'mfj', 'mfs', 'hoh'];
const TAX_FS_TO_KEY = {
          single: 'single',
          mfj:    'married_joint',
          mfs:    'married_separate',
          hoh:    'head_household'
};

function isFilingStatusValid(s) { return TAX_FILING_STATUSES.indexOf(s) !== -1; }
function fsKey(s) { return TAX_FS_TO_KEY[s] || s; }

function _yearProjectionFactor(year) {
          const base = TAX_DATA.baseYear;
          if (year <= base) return 1;
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

function getStateBrackets(year, stateCode, status) {
          const node = getStateNode(year, stateCode);
          if (!node || node.noIncomeTax) return null;
          // States only define 'single' and 'married_joint' in the source data.
    // For 'mfs' and 'hoh' fall back to single.
    const fk = fsKey(status);
          const k = (fk === 'married_joint') ? 'married_joint' : 'single';
          const factor = (TAX_DATA.states[String(year)] && TAX_DATA.states[String(year)][stateCode]) ? 1 : _yearProjectionFactor(year);
          return _projectFlatBrackets((node.brackets && node.brackets[k]) || [], factor);
}

function getStateStandardDeduction(year, stateCode, status) {
          const node = getStateNode(year, stateCode);
          if (!node || node.noIncomeTax) return 0;
          const fk = fsKey(status);
          const k = (fk === 'married_joint') ? 'married_joint' : 'single';
          const raw = (node.standardDeduction && node.standardDeduction[k]) || 0;
          const factor = (TAX_DATA.states[String(year)] && TAX_DATA.states[String(year)][stateCode]) ? 1 : _yearProjectionFactor(year);
          return raw * factor;
}

function isStateNoIncomeTax(year, stateCode) {
          const node = getStateNode(year, stateCode);
          return !!(node && node.noIncomeTax);
}

function getStateFlatRate(year, stateCode) {
          const node = getStateNode(year, stateCode);
          if (!node || !node.flatRate) return null;
          // Flat-rate states in the source still encode the rate as a single
    // bracket [[999999999, rate]]. Read the rate from there.
    const sb = node.brackets && node.brackets.single;
          if (!sb || !sb.length) return null;
          return sb[sb.length - 1][1];
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
