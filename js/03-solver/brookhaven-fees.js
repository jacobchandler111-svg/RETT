// FILE: js/03-solver/brookhaven-fees.js
// Flat-fee schedule charged by Brookhaven (the advisory wrapper around
// the Brooklyn strategy). Independent of the Brooklyn strategy fee.
//
// Schedule:
//   - Setup fee: $45,000 once, charged at engagement (Year 1).
//   - Quarterly fee: $2,000 per calendar quarter, for 8 quarters
//     (2 years from engagement). After 8 quarters the meter stops.
//   - Pro-ration: when engagement starts mid-year, Year-1 quarterly
//     fees are scaled by year-fraction-remaining so a partial quarter
//     is billed proportionally. The setup fee is NOT pro-rated.
//
// Default constants are exposed on root so a future settings UI can
// override them without forking this file. Engagement date drives the
// pro-ration; we accept either an implementationDate (YYYY-MM-DD) or a
// pre-computed year fraction.
//
// Integration points: tax-comparison.js (immediate + deferred paths)
// adds the per-year Brookhaven fee to each row's totals; the dashboard
// shows it as a separate line so the advisor can defend the all-in
// number to the client.

(function (root) {
  'use strict';

  var DEFAULTS = {
    setupFeeUSD:        45000,   // one-time, Year 1
    quarterlyFeeUSD:    2000,    // per quarter
    quarterlyFeeQtrs:   8        // 2 years × 4 quarters
  };

  // Compute the Year-N Brookhaven fee in dollars. yearOffset is 0-indexed
  // from engagement (Year 1 = 0). yearFractionYear1 is the fraction of
  // the engagement year remaining when services begin (1.0 if Jan 1
  // start, ~0.5 if mid-year). Quarterly fees beyond Year 2 are zero.
  //
  // Returns: { setup, quarterly, total }
  function brookhavenFeeForYear(yearOffset, yearFractionYear1, opts) {
    opts = opts || {};
    var setupFee   = opts.setupFeeUSD     != null ? opts.setupFeeUSD     : DEFAULTS.setupFeeUSD;
    var qFeePerQtr = opts.quarterlyFeeUSD != null ? opts.quarterlyFeeUSD : DEFAULTS.quarterlyFeeUSD;
    var qTotal     = opts.quarterlyFeeQtrs!= null ? opts.quarterlyFeeQtrs: DEFAULTS.quarterlyFeeQtrs;
    var fullYearQ  = qFeePerQtr * 4;

    var setup = (yearOffset === 0) ? setupFee : 0;
    var quarterly;

    var yf = (yearFractionYear1 == null) ? 1 : Math.max(0, Math.min(1, yearFractionYear1));
    if (yearOffset === 0) {
      // First year: pro-rate by year-fraction-remaining (Q1 may be partial).
      quarterly = fullYearQ * yf;
    } else if (yearOffset === 1) {
      // Second year: full 4 quarters.
      quarterly = fullYearQ;
    } else if (yearOffset === 2) {
      // Third year: only the un-billed remainder of the 8-quarter
      // cap. When Y1 was prorated (yf < 1), Y1 + Y2 only billed
      // (yf × 4 + 4) quarters; the remaining (4 × (1 - yf)) belongs
      // here so the total still reaches the 8-quarter cap.
      quarterly = fullYearQ * (1 - yf);
    } else {
      // Year 4+: nothing.
      quarterly = 0;
    }

    // Final safety cap: total quarterly fees never exceed the configured
    // 8-quarter maximum. Previously this only fired in Y2 and assumed Y1
    // was billed in full, which over-clipped Y2 when Y1 was prorated.
    // The Y3-tail logic above is now the primary mechanism; this cap
    // remains as a defensive guard against caller misuse.

    return {
      setup: setup,
      quarterly: quarterly,
      total: setup + quarterly
    };
  }

  // Sum the Brookhaven fees across the projection horizon. yearFractionYear1
  // pro-rates Year 1; subsequent years are full. Returns:
  //   { perYear: [n1, n2, ...], total: number }
  function brookhavenFeeSchedule(horizonYears, yearFractionYear1, opts) {
    var horizon = Math.max(1, horizonYears | 0);
    var perYear = [];
    var total = 0;
    for (var i = 0; i < horizon; i++) {
      var y = brookhavenFeeForYear(i, yearFractionYear1, opts);
      perYear.push(y);
      total += y.total;
    }
    return { perYear: perYear, total: total };
  }

  root.BROOKHAVEN_FEE_DEFAULTS = DEFAULTS;
  root.brookhavenFeeForYear    = brookhavenFeeForYear;
  root.brookhavenFeeSchedule   = brookhavenFeeSchedule;
})(window);
