// FILE: js/01-brooklyn/time-weight.js
// Time-weighting helper for partial-year Brooklyn implementation.
//
// Brooklyn loss rates are quoted as ANNUAL figures. If the strategy is
// implemented mid-year, only the fraction of the year remaining produces
// loss. Subsequent years are full-year and use the unweighted rate.
//
// Math (carried over verbatim from the original Brookhaven engine):
//   remaining_ms = (year-end Dec 31) - implementation_date
//   fraction     = remaining_ms / ms_in_year
//   weighted     = annual_rate * fraction
//
// fraction range: 0 (implemented Dec 31) to ~1.0 (implemented Jan 1).

(function () {

  function parseLocalDate(dateStr) {
    if (!dateStr) return new Date();
    const parts = String(dateStr).split(/[-/T]/);
    return new Date(
      parseInt(parts[0], 10),
      parseInt(parts[1], 10) - 1,
      parseInt(parts[2], 10) || 1
    );
  }

  // Returns the fraction of the implementation-year still ahead.
  // 1.0 = full year, 0.0 = none left.
  function yearFractionRemaining(implementationDate) {
    if (!implementationDate) return 1.0;
    const d = parseLocalDate(implementationDate);
    const year = d.getFullYear();
    const yearStart = new Date(year, 0, 1);
    const yearEnd = new Date(year, 11, 31);
    if (d >= yearEnd) return 0;
    if (d <= yearStart) return 1;
    const msInYear = yearEnd - yearStart;
    const remaining = Math.max(0, yearEnd - d);
    return Math.min(1, remaining / msInYear);
  }

  // Time-weight an annual rate by the implementation date.
  function timeWeightedRate(annualRate, implementationDate) {
    return (annualRate || 0) * yearFractionRemaining(implementationDate);
  }

  window.parseLocalDate       = parseLocalDate;
  window.yearFractionRemaining = yearFractionRemaining;
  window.timeWeightedRate     = timeWeightedRate;
})();
