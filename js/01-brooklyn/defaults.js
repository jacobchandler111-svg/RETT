// FILE: js/01-brooklyn/defaults.js
// Live, drop-in defaults for the multi-year sale-structuring schedule and
// loss-projection table. When the user provides finalized numbers, edit ONLY
// this file; controls.js will auto-populate the year-schedule rows from
// these arrays on initial render.
//
// Index 0 corresponds to year 1 (the base year set by #year1 in the UI).
// Leave any slot as null to roll forward the year-1 base income on that
// dimension. Loss rates are decimal fractions of invested capital
// (e.g. 0.45 means 45% of invested capital generates a short-term loss).
//
// All Brooklyn-generated losses are SHORT-TERM (no 60/40 split).
// This is a live document: minimums, fees, and these schedules will be
// updated year-to-year as new guidance comes in.

window.RETT_DEFAULTS = {
  // ----- Multi-year sale-structuring inflow schedule -----
  // Per-year ordinary income (W-2 + SE + non-qualified divs + interest).
  // Length should match the projection horizon. null = use year-1 base
  // (rolled forward by wage-growth assumption).
  ordinaryByYear: [null, null, null, null, null],

  // Per-year short-term capital gain inflows.
  shortGainByYear: [null, null, null, null, null],

  // Per-year long-term capital gain inflows (incl. qualified dividends).
  longGainByYear: [null, null, null, null, null],

  // ----- Multi-year loss-projection table -----
  // Brooklyn short-term losses generated as a fraction of invested capital
  // per year. Year 1 typically the highest, tapering in following years.
  // Replace these placeholders with the finalized loss-projection table.
  lossRateByYear: [null, null, null, null, null],

  // ----- Engine-only assumption -----
  // Bracket inflation past the 2026 base year. The ONLY assumption.
  bracketInflation: 0.02
};
