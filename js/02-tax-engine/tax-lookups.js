// FILE: js/02-tax-engine/tax-lookups.js
// Bracket lookup helpers. For published years (2025, 2026 in v1) we serve the
// raw IRS / state tables from cache. For years past TAX_DATA.baseYear we
// project bracket thresholds forward at TAX_DATA.inflationRate per year using
// FULL FLOATING-POINT PRECISION (no rounding to $50 etc.). Rates and the
// $3,000 / $1,500 ordinary-offset cap are NOT inflated.

const TAX_FILING_STATUSES = ['single', 'mfj', 'mfs', 'hoh'];

function _projectBrackets(brackets, factor) {
      return brackets.map(b => ({
                rate: b.rate,
                min:  b.min === 0 ? 0 : b.min * factor,
                max:  b.max === Infinity ? Infinity : b.max * factor
      }));
}

function _projectStandardDeduction(amount, factor) {
      return amount * factor;
}

function _yearProjectionFactor(year) {
      const base = TAX_DATA.baseYear;
      if (year <= base) return 1;
      return Math.pow(1 + TAX_DATA.inflationRate, year - base);
}

function _resolveYearKey(year) {
      // Find the published key to project from. If the requested year is in
    // the published set, use it directly. Otherwise project from baseYear.
    if (TAX_DATA.federal && TAX_DATA.federal[year]) return String(year);
      return String(TAX_DATA.baseYear);
}

function getFederalBrackets(year, status) {
      const key = _resolveYearKey(year);
      const node = TAX_DATA.federal[key];
      if (!node || !node[status]) return null;
      const rawOrdinary = node[status].ordinary || [];
      const rawLT       = node[status].longTermCapitalGains || [];
      const factor      = (key === String(year)) ? 1 : _yearProjectionFactor(year);
      return {
                ordinary: _projectBrackets(rawOrdinary, factor),
                longTermCapitalGains: _projectBrackets(rawLT, factor),
                standardDeduction: _projectStandardDeduction(node[status].standardDeduction || 0, factor)
      };
}

function getFederalAddOns(year, status) {
      // AMT, NIIT, Additional Medicare thresholds. Inflated past baseYear.
    const key = _resolveYearKey(year);
      const node = TAX_DATA.federal[key];
      if (!node || !node[status]) return null;
      const factor = (key === String(year)) ? 1 : _yearProjectionFactor(year);
      const addOns = node[status].addOns || {};
      return {
                amt: addOns.amt ? {
                              exemption:        (addOns.amt.exemption        || 0) * factor,
                              phaseoutStart:    (addOns.amt.phaseoutStart    || 0) * factor,
                              rate26Threshold:  (addOns.amt.rate26Threshold  || 0) * factor,
                              rate26: addOns.amt.rate26,
                              rate28: addOns.amt.rate28
                } : null,
                niit: addOns.niit ? {
                              threshold: (addOns.niit.threshold || 0) * factor,
                              rate:      addOns.niit.rate
                } : null,
                addlMedicare: addOns.addlMedicare ? {
                              threshold: (addOns.addlMedicare.threshold || 0) * factor,
                              rate:      addOns.addlMedicare.rate
                } : null
      };
}

function getStateBrackets(year, stateCode, status) {
      if (!stateCode || stateCode === 'NONE') return null;
      const key = _resolveYearKey(year);
      const stateNode = TAX_DATA.states && TAX_DATA.states[stateCode];
      if (!stateNode || !stateNode[key]) return null;
      const yearNode = stateNode[key];
      if (!yearNode[status]) return null;
      const factor = (key === String(year)) ? 1 : _yearProjectionFactor(year);
      return {
                type: yearNode.type || 'progressive',          // 'progressive' | 'flat' | 'none'
                flatRate: yearNode.flatRate != null ? yearNode.flatRate : null,
                ordinary: _projectBrackets(yearNode[status].ordinary || [], factor),
                standardDeduction: _projectStandardDeduction(yearNode[status].standardDeduction || 0, factor),
                capitalGainsTreatment: yearNode.capitalGainsTreatment || 'ordinary'
      };
}

function isFilingStatusValid(status) {
      return TAX_FILING_STATUSES.indexOf(status) !== -1;
}
