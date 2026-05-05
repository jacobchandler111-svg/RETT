// FILE: js/01-brooklyn/brooklyn-interpolation.js
// Linear interpolation between Brooklyn's documented leverage tier presets.
//
// Each tier in BROOKLYN_STRATEGIES has a small set of preset data points.
// When a user selects a leverage value that falls between presets, this
// function interpolates each output field linearly. Per the original
// regression analysis, fees are highly linear so this is accurate.
//
// If the requested leverage is below the lowest preset or above the highest,
// it is clamped to the nearest preset (no extrapolation).
//
// Returns an object with the interpolated longPct, shortPct, lossRate,
// and the binding minInvestment (the higher of the two surrounding
// presets, since you cannot enter a tier you do not qualify for).
// Fee rate is NOT returned — fee-split.js owns that. Callers compute it
// via brooklynFeeRateFor(longPct, shortPct).

/**
 * @param {string} tierKey - 'beta1' | 'beta05' | 'beta0' | 'advisorManaged'
 * @param {number} leverage - Selected leverage tier (e.g. 0, 0.30, 1.00, 2.25).
 * @returns {{longPct:number, shortPct:number, lossRate:number, minInvestment:number, label:string}}
 */
function brooklynInterpolate(tierKey, leverage) {
    const tier = BROOKLYN_STRATEGIES[tierKey];
    if (!tier) throw new Error('Unknown Brooklyn tier: ' + tierKey);
    const dp = tier.dataPoints.slice().sort((a, b) => a.leverage - b.leverage);

  // Clamp to bounds.
  if (leverage <= dp[0].leverage) return _copy(dp[0]);
    if (leverage >= dp[dp.length - 1].leverage) return _copy(dp[dp.length - 1]);

  // Find surrounding pair.
  let lo = dp[0], hi = dp[dp.length - 1];
    for (let i = 0; i < dp.length - 1; i++) {
          if (leverage >= dp[i].leverage && leverage <= dp[i + 1].leverage) {
                  lo = dp[i];
                  hi = dp[i + 1];
                  break;
          }
    }

  const span = hi.leverage - lo.leverage;
    const t = span > 0 ? (leverage - lo.leverage) / span : 0;

  return {
        longPct:       lo.longPct       + t * (hi.longPct       - lo.longPct),
        shortPct:      lo.shortPct      + t * (hi.shortPct      - lo.shortPct),
        lossRate:      lo.lossRate      + t * (hi.lossRate      - lo.lossRate),
        minInvestment: Math.max(lo.minInvestment, hi.minInvestment),
        label:         lo.label + ' to ' + hi.label
  };
}

function _copy(p) {
    return {
          longPct: p.longPct,
          shortPct: p.shortPct,
          lossRate: p.lossRate,
          minInvestment: p.minInvestment,
          label: p.label
    };
}
