// FILE: js/03-solver/decision-engine.js
// Two-stage decision tree with partial-year time-weighting and accelerated
// depreciation recapture.
//
// Inputs:
//   {
//     salePrice, costBasis,            // basis-only gain
//     acceleratedDepreciation,         // recaptured at ordinary rates (Sec 1245)
//     strategyKey,
//     investedCapital,
//     leverageCap,
//     horizonYears,
//     implementationDate (YYYY-MM-DD)  // drives yearFraction
//   }
//
// Total taxable from sale = (salePrice - costBasis) + acceleratedDepreciation
//   - The (salePrice - costBasis) piece is long-term capital gain.
//   - The acceleratedDepreciation piece is ordinary income (recapture).
//
// Brooklyn short-term losses offset BOTH: short-term losses first net
// against any short-term gain, then against long-term gain, and any excess
// can offset up to $3k of ordinary income per year for federal purposes
// (state varies). For solver purposes we treat the wipe-out target as the
// SUM of long-term gain and recapture, since both need to be neutralized.

(function () {

  function recommendSale(cfg) {
    const longTermGain = Math.max(0, (cfg.salePrice || 0) - (cfg.costBasis || 0));
    const recapture    = Math.max(0, cfg.acceleratedDepreciation || 0);
    const totalToOffset = longTermGain + recapture;

    // Time-weight from implementation date.
    const yf = (typeof yearFractionRemaining === 'function')
      ? yearFractionRemaining(cfg.implementationDate)
      : 1;

    const stage1 = solveSingleYear({
      strategyKey:     cfg.strategyKey,
      gainToOffset:    totalToOffset,
      investedCapital: cfg.investedCapital,
      yearFraction:    yf
    });

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
        totalLossNeeded: totalToOffset,
        totalFees: stage1.feeDollar || 0,
        gainByYear: padArray([totalToOffset], cfg.horizonYears),
        leverageByYear: padArray([stage1.leverage], cfg.horizonYears),
        yearFraction: yf
      };
    } else {
      stage2 = solveMultiYear({
        strategyKey:     cfg.strategyKey,
        totalGain:       totalToOffset,
        investedCapital: cfg.investedCapital,
        leverageCap:     cap,
        horizonYears:    cfg.horizonYears,
        yearFraction:    yf,
        distribution:    cfg.distribution || 'even'
      });

      if (stage2.feasible) {
        recommendation = 'multi-year';
        const capInfo = brooklynInterpolate(cfg.strategyKey, cap);

        // Total fees: year-1 partial, rest full.
        let totalFees = 0;
        for (let i = 0; i < (stage2.gainByYear || []).length; i++) {
          if (stage2.gainByYear[i] <= 0) continue;
          const yfI = (i === 0) ? yf : 1;
          totalFees += cfg.investedCapital * (capInfo.feeRate || 0) * yfI;
        }

        summary = {
          years: stage2.yearsUsed,
          leverageUsed: cap,
          leverageLabel: capInfo ? capInfo.label : '',
          totalLossNeeded: totalToOffset,
          totalFees,
          gainByYear: stage2.gainByYear,
          leverageByYear: stage2.leverageByYear,
          capByYear: stage2.capByYear,
          yearFraction: yf
        };
      } else {
        recommendation = 'infeasible';
        summary = {
          years: cfg.horizonYears,
          leverageUsed: cap,
          totalLossNeeded: totalToOffset,
          shortfall: stage2.shortfall,
          gainByYear: stage2.gainByYear,
          capByYear: stage2.capByYear,
          yearFraction: yf,
          note: 'Cannot absorb the full taxable amount within the projection horizon at the chosen leverage cap. Increase invested capital, raise the leverage cap, extend the horizon, or push implementation earlier in the year.'
        };
      }
    }

    return {
      longTermGain,
      recapture,
      gain: totalToOffset,
      yearFraction: yf,
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
