// FILE: js/03-solver/multi-year-solver.js
// Stage-2 solver for the two-stage decision tree:
//   "If single-year wipeout requires more leverage than the user accepts,
//    spread the gain across multiple years so each year's gain can be fully
//    offset within the leverage cap."
//
// Strategy:
//   1. At the cap leverage, compute the maximum short-term loss that
//      invested capital can produce per year:  capLoss = invest * lossRate(cap)
//   2. The minimum number of years required is ceil(totalGain / capLoss).
//   3. If that exceeds the projection horizon, the schedule is INFEASIBLE
//      at this leverage cap and the user must either raise the cap or
//      raise invested capital.
//   4. Otherwise distribute the gain evenly across the required years
//      (configurable: front-loaded, back-loaded, or even).
//
// All Brooklyn-generated losses are short-term.
// Loss model uses brooklynInterpolate(strategyKey, leverage).

(function () {

  function solveMultiYear({
    strategyKey,
    totalGain,
    investedCapital,
    leverageCap,
    horizonYears,
    distribution = 'even'   // 'even' | 'front' | 'back'
  }) {
    if (!(totalGain > 0)) {
      return {
        feasible: true,
        years: 0,
        gainByYear: new Array(horizonYears).fill(0),
        lossByYear: new Array(horizonYears).fill(0),
        note: 'no gain to spread'
      };
    }
    if (!(investedCapital > 0)) {
      return { feasible: false, error: 'invested capital must be > 0' };
    }
    const info = brooklynInterpolate(strategyKey, leverageCap);
    if (!info || !info.lossRate) {
      return { feasible: false, error: 'cannot interpolate loss rate at cap leverage ' + leverageCap };
    }

    const lossPerYearAtCap = investedCapital * info.lossRate;
    if (lossPerYearAtCap <= 0) {
      return { feasible: false, error: 'cap leverage produces zero loss' };
    }

    // Minimum years needed to absorb all gain at the leverage cap.
    const yearsNeeded = Math.ceil(totalGain / lossPerYearAtCap);
    const feasibleWithinHorizon = yearsNeeded <= horizonYears;
    const yearsToUse = Math.min(yearsNeeded, horizonYears);

    // Distribute the gain across yearsToUse.
    const gainByYear = new Array(horizonYears).fill(0);
    const remainderEnvelope = (yearsToUse > 0) ? (totalGain / yearsToUse) : 0;

    if (distribution === 'even') {
      for (let i = 0; i < yearsToUse; i++) gainByYear[i] = remainderEnvelope;
    } else if (distribution === 'front') {
      // Pack max into earliest years up to lossPerYearAtCap, then taper.
      let remaining = totalGain;
      for (let i = 0; i < yearsToUse && remaining > 0; i++) {
        const take = Math.min(lossPerYearAtCap, remaining);
        gainByYear[i] = take;
        remaining -= take;
      }
    } else if (distribution === 'back') {
      let remaining = totalGain;
      for (let i = yearsToUse - 1; i >= 0 && remaining > 0; i--) {
        const take = Math.min(lossPerYearAtCap, remaining);
        gainByYear[i] = take;
        remaining -= take;
      }
    }

    // Required loss generation per year (matches gain).
    // Convert each year's gain back to the leverage actually needed at fixed
    // invested capital:  required lossRate = gain / capital
    //                    leverage = invertLossRate(strategyKey, required lossRate)
    const lossByYear = gainByYear.slice();
    const leverageByYear = gainByYear.map(g => {
      if (g <= 0) return 0;
      const reqRate = g / investedCapital;
      return invertLossRate(strategyKey, reqRate);
    });

    return {
      feasible: feasibleWithinHorizon,
      yearsNeeded,
      yearsUsed: yearsToUse,
      lossPerYearAtCap,
      capLossRate: info.lossRate,
      gainByYear,
      lossByYear,
      leverageByYear,
      shortfall: feasibleWithinHorizon ? 0 : (totalGain - lossPerYearAtCap * horizonYears),
      note: feasibleWithinHorizon
        ? 'gain fully absorbed within horizon at or below cap leverage'
        : 'gain exceeds horizon-wide capacity at the leverage cap'
    };
  }

  // Inverse of brooklynInterpolate: given a target lossRate, find the
  // leverage that produces it (linear interpolation between presets).
  // Returns the smallest leverage that meets/exceeds the target rate.
  function invertLossRate(strategyKey, targetRate) {
    const presets = (window.PRESET_LEVERAGES || {})[strategyKey] || [];
    if (!presets.length) return null;
    if (targetRate <= 0) return 0;

    let prev = null;
    for (let i = 0; i < presets.length; i++) {
      const lev = presets[i];
      const info = brooklynInterpolate(strategyKey, lev);
      const rate = info ? info.lossRate : 0;
      if (rate >= targetRate) {
        if (prev === null) return lev;
        // Interpolate between prev and this preset.
        const t = (targetRate - prev.rate) / (rate - prev.rate);
        return prev.lev + t * (lev - prev.lev);
      }
      prev = { lev, rate };
    }
    // Target exceeds max preset; return max.
    return presets[presets.length - 1];
  }

  window.solveMultiYear = solveMultiYear;
  window.invertLossRate = invertLossRate;
})();
