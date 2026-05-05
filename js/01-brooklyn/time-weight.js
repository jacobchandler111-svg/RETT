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

  // parseLocalDate is loaded from date-utils.js (which is loaded before
  // this file in index.html). Falling back to a local copy keeps this
  // module robust if the load order ever changes.
  var parseLocalDate = window.parseLocalDate || function (dateStr) {
    if (!dateStr) return new Date();
    var parts = String(dateStr).split(/[-/T]/);
    return new Date(
      parseInt(parts[0], 10),
      parseInt(parts[1], 10) - 1,
      parseInt(parts[2], 10) || 1
    );
  };

  // Returns the fraction of the implementation-year still ahead.
  // 1.0 = full year, 0.0 = none left.
  // The "year-end" anchor is Jan 1 of the FOLLOWING year so the
  // denominator covers the full 365 (or 366) days. Using Dec 31 as
  // the anchor under-weights every implementation date by ~1 day.
  // Invalid input (unparseable string, NaN-time Date) returns 1 — a
  // conservative default that treats unrecognized dates as a Jan-1
  // start. Without this guard the engines would propagate NaN through
  // every loss calc and show "$NaN" totals.
  function yearFractionRemaining(implementationDate) {
    if (!implementationDate) return 1.0;
    const d = parseLocalDate(implementationDate);
    if (!d || isNaN(d.getTime())) return 1.0;
    const year = d.getFullYear();
    const yearStart = new Date(year, 0, 1);
    const nextYearStart = new Date(year + 1, 0, 1);
    if (d >= nextYearStart) return 0;
    if (d <= yearStart) return 1;
    const msInYear = nextYearStart - yearStart;
    const remaining = Math.max(0, nextYearStart - d);
    const frac = remaining / msInYear;
    return isFinite(frac) ? Math.min(1, frac) : 1.0;
  }

  // Time-weight an annual rate by the implementation date.
  function timeWeightedRate(annualRate, implementationDate) {
    return (annualRate || 0) * yearFractionRemaining(implementationDate);
  }

  // Resolve the strategy implementation date for a cfg. The Brooklyn
  // position can open later than the sale closes (proceeds clearing,
  // advisor windows). cfg.strategyImplementationDate is the explicit
  // value when present; we fall back to cfg.implementationDate (the
  // sale date) for older saved cases that pre-date the split. Engine
  // consumers that prorate Brooklyn fees / losses should call this
  // helper rather than reading either field directly so the routing
  // is centralized.
  function cfgStrategyDate(cfg) {
    if (!cfg) return '';
    return cfg.strategyImplementationDate || cfg.implementationDate || '';
  }

  // parseLocalDate is already exported by date-utils.js; we don't
  // re-export so there is one source of truth for the function.
  window.yearFractionRemaining = yearFractionRemaining;
  window.timeWeightedRate     = timeWeightedRate;
  window.cfgStrategyDate      = cfgStrategyDate;
})();
