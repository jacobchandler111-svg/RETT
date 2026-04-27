// FILE: js/03-solver/multi-year-solver.js
// Stage-2 solver for the two-stage decision tree, with partial-year
// time-weighting in year 1.
//
// Year-1 capacity = invested * lossRate(cap) * yearFraction
// Years 2..N capacity = invested * lossRate(cap)        (full year)
//
// All Brooklyn-generated losses are short-term.

(function () {

  function solveMultiYear({
    strategyKey,
    totalGain,
    investedCapital,
    leverageCap,
    horizonYears,
    yearFraction,
    distribution = 'even'
  }) {
    const yf = (yearFraction == null) ? 1 : Math.max(0, Math.min(1, yearFraction));
    const horizon = horizonYears || 5;

    if (!(totalGain > 0)) {
      return {
        feasible: true,
        years: 0,
        gainByYear: new Array(horizon).fill(0),
        lossByYear: new Array(horizon).fill(0),
        capByYear: new Array(horizon).fill(0),
        yearFraction: yf,
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

    const annualCap = investedCapital * info.lossRate;
    if (annualCap <= 0) {
      return { feasible: false, error: 'cap leverage produces zero loss' };
    }

    // Per-year loss capacity at the cap. Year 1 is partial; rest are full.
    const capByYear = new Array(horizon).fill(annualCap);
    capByYear[0] = annualCap * yf;

    // Total capacity over the horizon.
    const totalCapacity = capByYear.reduce((s, x) => s + x, 0);
    const feasibleWithinHorizon = totalCapacity >= totalGain - 1e-6;

    // Distribute the gain across years according to capByYear and chosen mode.
    const gainByYear = new Array(horizon).fill(0);
    let remaining = totalGain;

    if (distribution === 'front') {
      // Pack as much as possible into earliest years up to each year's capacity.
      for (let i = 0; i < horizon && remaining > 0; i++) {
        const take = Math.min(capByYear[i], remaining);
        gainByYear[i] = take;
        remaining -= take;
      }
    } else if (distribution === 'back') {
      for (let i = horizon - 1; i >= 0 && remaining > 0; i--) {
        const take = Math.min(capByYear[i], remaining);
        gainByYear[i] = take;
        remaining -= take;
      }
    } else {
      // 'even' but respecting per-year capacity (year 1 is smaller).
      // Strategy: pro-rata by capacity. If totalCapacity >= totalGain,
      // each year gets gain = capByYear[i] * (totalGain / totalCapacity);
      // otherwise each year is filled to its cap and remainder is shortfall.
      if (feasibleWithinHorizon) {
        const ratio = totalGain / totalCapacity;
        for (let i = 0; i < horizon; i++) {
          gainByYear[i] = capByYear[i] * ratio;
        }
        remaining = 0;
      } else {
        for (let i = 0; i < horizon; i++) {
          gainByYear[i] = capByYear[i];
          remaining -= capByYear[i];
        }
      }
    }

    // Compute years actually used (any with gain > 0).
    let yearsUsed = 0;
    for (let i = 0; i < horizon; i++) if (gainByYear[i] > 0) yearsUsed = i + 1;

    // Required leverage per year (assuming fixed invested capital).
    // year 1: required-rate = gain / (invested * yf)
    // year n: required-rate = gain / invested
    const leverageByYear = gainByYear.map((g, i) => {
      if (g <= 0) return 0;
      const denom = (i === 0) ? (investedCapital * yf) : investedCapital;
      if (denom <= 0) return null;
      const reqRate = g / denom;
      return invertLossRate(strategyKey, reqRate);
    });

    return {
      feasible: feasibleWithinHorizon,
      yearsNeeded: feasibleWithinHorizon ? yearsUsed : horizon,
      yearsUsed,
      capLossRate: info.lossRate,
      annualCap,
      capByYear,
      gainByYear,
      lossByYear: gainByYear.slice(),
      leverageByYear,
      yearFraction: yf,
      shortfall: feasibleWithinHorizon ? 0 : Math.max(0, totalGain - totalCapacity),
      note: feasibleWithinHorizon
        ? 'gain fully absorbed within horizon at or below cap leverage'
        : 'gain exceeds horizon-wide capacity at the leverage cap'
    };
  }

  // Inverse of brooklynInterpolate: given target lossRate, find leverage.
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
        const t = (targetRate - prev.rate) / (rate - prev.rate);
        return prev.lev + t * (lev - prev.lev);
      }
      prev = { lev, rate };
    }
    return presets[presets.length - 1];
  }

  window.solveMultiYear = solveMultiYear;
  window.invertLossRate = invertLossRate;
})();
