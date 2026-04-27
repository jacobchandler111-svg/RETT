// FILE: js/03-solver/decision-engine.js
// Orchestrator for the two-stage decision tree:
//
//   Q1: Can we wipe out the entire long-term gain in a SINGLE year using
//       Brooklyn? (calls solveSingleYear)
//   Q2: If yes, what's the required leverage? Is it at or below the
//       user's acceptable leverage cap?
//   Q3: If single-year is infeasible OR exceeds the cap, fall through to
//       the multi-year structured-sale solver (calls solveMultiYear).
//
// Inputs:
//   {
//     salePrice, costBasis,           // computes gain = salePrice - costBasis
//     strategyKey,                    // 'beta1' | 'beta0' | 'beta05' | 'advisorManaged'
//     investedCapital,
//     leverageCap,                    // user's max acceptable leverage value
//     horizonYears
//   }
//
// Output:
//   {
//     gain,
//     stage1: { ...solveSingleYear result... },
//     stage1RecommendsSingleYear: bool,
//     stage2: { ...solveMultiYear result... } or null,
//     recommendation: 'single-year' | 'multi-year' | 'infeasible',
//     summary: { years, leverageUsed, totalLossNeeded, totalFees }
//   }

(function () {

  function recommendSale(cfg) {
    const gain = Math.max(0, (cfg.salePrice || 0) - (cfg.costBasis || 0));

    const stage1 = solveSingleYear({
      strategyKey:     cfg.strategyKey,
      gainToOffset:    gain,
      investedCapital: cfg.investedCapital
    });

    // Stage-1 verdict: feasible AND required leverage <= user cap.
    const cap = (cfg.leverageCap == null) ? Infinity : cfg.leverageCap;
    const stage1RecommendsSingleYear =
      stage1.feasible && (stage1.leverage <= cap + 1e-9);

    let stage2 = null;
    let recommendation = 'single-year';
    let summary;

    if (stage1RecommendsSingleYear) {
      summary = {
        years: 1,
        leverageUsed: stage1.leverage,
        leverageLabel: stage1.leverageLabel,
        totalLossNeeded: gain,
        totalFees: stage1.feeDollar || 0,
        gainByYear: padArray([gain], cfg.horizonYears)
      };
    } else {
      // Fall through to multi-year structured sale.
      stage2 = solveMultiYear({
        strategyKey:     cfg.strategyKey,
        totalGain:       gain,
        investedCapital: cfg.investedCapital,
        leverageCap:     cap,
        horizonYears:    cfg.horizonYears,
        distribution:    cfg.distribution || 'even'
      });

      if (stage2.feasible) {
        recommendation = 'multi-year';
        const capInfo = brooklynInterpolate(cfg.strategyKey, cap);
        summary = {
          years: stage2.yearsUsed,
          leverageUsed: cap,
          leverageLabel: capInfo ? capInfo.label : '',
          totalLossNeeded: gain,
          totalFees: (capInfo ? cfg.investedCapital * (capInfo.feeRate || 0) : 0) * stage2.yearsUsed,
          gainByYear: stage2.gainByYear,
          leverageByYear: stage2.leverageByYear
        };
      } else {
        recommendation = 'infeasible';
        summary = {
          years: cfg.horizonYears,
          leverageUsed: cap,
          totalLossNeeded: gain,
          shortfall: stage2.shortfall,
          gainByYear: stage2.gainByYear,
          note: 'Cannot absorb the full gain within the projection horizon at the chosen leverage cap. Increase invested capital, raise the leverage cap, or extend the horizon.'
        };
      }
    }

    return {
      gain,
      stage1,
      stage1RecommendsSingleYear,
      stage2,
      recommendation,
      summary
    };
  }

  function padArray(arr, length) {
    const out = arr.slice(0, length);
    while (out.length < length) out.push(0);
    return out;
  }

  window.recommendSale = recommendSale;
})();
