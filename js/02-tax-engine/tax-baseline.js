// FILE: js/02-tax-engine/tax-baseline.js
// Convenience wrapper that combines federal and state into a single
// "all-in" tax for a given year + scenario. Used by the projection
// engine for the "no Brooklyn" baseline column and by the UI to display
// pre-strategy numbers.

function computeBaselineTax(scenario) {
      // scenario shape:
    //   { year, status, state, ordinaryIncome, shortTermGain, longTermGain,
    //     qualifiedDividend, investmentIncome, wages, itemized }
    const ordinary       = scenario.ordinaryIncome  || 0;
      const shortGain      = Math.max(0, scenario.shortTermGain || 0);
      const longGain       = Math.max(0, scenario.longTermGain  || 0);
      const qualDiv        = Math.max(0, scenario.qualifiedDividend || 0);
      const invIncome      = scenario.investmentIncome != null
          ? scenario.investmentIncome : (longGain + qualDiv);
      const wages          = scenario.wages != null ? scenario.wages : ordinary;

    const fed = computeFederalTax(
              ordinary + shortGain,
              scenario.year, scenario.status,
      {
                    longTermGain: longGain,
                    qualifiedDividend: qualDiv,
                    investmentIncome: invIncome,
                    wages: wages,
                    itemized: scenario.itemized || 0
      }
          );

    const state = computeStateTax(
              ordinary + shortGain + longGain + qualDiv,
              scenario.year, scenario.state, scenario.status,
      { itemized: scenario.itemized || 0 }
          );

    return { federal: fed, state: state, total: fed + state };
}
