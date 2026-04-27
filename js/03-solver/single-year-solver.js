// FILE: js/03-solver/single-year-solver.js
// Stage-1 solver for the two-stage decision tree:
//   "Given a single-year capital gain, what is the MINIMUM Brooklyn leverage
//    tier required to wipe out that gain entirely?"
//
// If the answer is at or below the user's leverage cap, recommend a
// single-year sale. Otherwise, the engine falls through to the multi-year
// structured-sale solver (see multi-year-solver.js).
//
// Loss generation model (from brooklyn-data.js, verified verbatim against
// the original Brookhaven engine):
//   loss_short_term = invested_capital * lossRate(strategyKey, leverage)
//
// Where lossRate is interpolated by brooklynInterpolate(strategyKey, leverage).
// All Brooklyn-generated losses are short-term.

(function () {

  // Standard preset ladders by strategy. Solver scans these in ascending order.
  const PRESET_LEVERAGES = {
    beta1:           [0, 0.30, 0.45, 1.00, 1.50, 2.25],
    beta0:           [1.00, 1.50, 2.00, 2.75],
    beta05:          [1.00, 1.50, 2.25],
    advisorManaged:  [0, 0.30, 0.45, 1.00, 1.50, 2.25]
  };

  function leverageLabel(strategyKey, leverage) {
    const info = (typeof brooklynInterpolate === 'function')
      ? brooklynInterpolate(strategyKey, leverage)
      : null;
    return info ? info.label : (leverage === 0 ? 'Long-Only' : (leverage * 100) + '%');
  }

  // Given total gain to offset and invested capital, find the minimum
  // leverage tier that produces enough short-term loss.
  function solveSingleYear({ strategyKey, gainToOffset, investedCapital }) {
    if (!strategyKey || !PRESET_LEVERAGES[strategyKey]) {
      return { feasible: false, error: 'unknown strategy: ' + strategyKey };
    }
    if (!(gainToOffset > 0)) {
      return { feasible: true, leverage: 0, lossRate: 0, lossGenerated: 0, feeRate: 0, gap: 0, note: 'no gain to offset' };
    }
    if (!(investedCapital > 0)) {
      return { feasible: false, error: 'invested capital must be > 0' };
    }

    const ladder = PRESET_LEVERAGES[strategyKey];
    let lastInfo = null;

    for (let i = 0; i < ladder.length; i++) {
      const lev = ladder[i];
      const info = brooklynInterpolate(strategyKey, lev);
      lastInfo = { lev, info };
      const loss = investedCapital * (info.lossRate || 0);
      if (loss >= gainToOffset) {
        return {
          feasible: true,
          leverage: lev,
          leverageLabel: info.label,
          lossRate: info.lossRate,
          lossGenerated: loss,
          feeRate: info.feeRate,
          feeDollar: investedCapital * (info.feeRate || 0),
          minInvestment: info.minInvestment,
          gap: 0
        };
      }
    }

    const maxLoss = investedCapital * (lastInfo.info.lossRate || 0);
    return {
      feasible: false,
      leverage: lastInfo.lev,
      leverageLabel: lastInfo.info.label,
      lossRate: lastInfo.info.lossRate,
      lossGenerated: maxLoss,
      feeRate: lastInfo.info.feeRate,
      feeDollar: investedCapital * (lastInfo.info.feeRate || 0),
      minInvestment: lastInfo.info.minInvestment,
      gap: gainToOffset - maxLoss
    };
  }

  // Given a gain and a fixed leverage, the invested capital required to wipe.
  function requiredCapitalAtLeverage({ strategyKey, gainToOffset, leverage }) {
    const info = brooklynInterpolate(strategyKey, leverage);
    if (!info || !info.lossRate) return null;
    return gainToOffset / info.lossRate;
  }

  window.solveSingleYear = solveSingleYear;
  window.requiredCapitalAtLeverage = requiredCapitalAtLeverage;
  window.leverageLabelFor = leverageLabel;
  window.PRESET_LEVERAGES = PRESET_LEVERAGES;
})();
