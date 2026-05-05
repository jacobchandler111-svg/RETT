// FILE: js/01-brooklyn/defaults.js
// Live, drop-in defaults for the multi-year sale-structuring schedule and
// loss-projection table. When the user provides finalized numbers, edit ONLY
// the arrays in window.RETT_DEFAULTS below and the Future Year Income
// Estimates rows will auto-populate on page load.
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

// The Future Year Income Estimates UI was removed; the auto-populate
// hook that filled it from RETT_DEFAULTS is no longer needed. The
// RETT_DEFAULTS object above is preserved as a reference doc for
// future per-year override work.

// Preload tax data on page init so any consumer can call lookups immediately.
// On failure, surface a visible banner so the user knows calculations will
// be unreliable (and how to recover).
(function () {
  function notifyFailure(err) {
    var msg = (err && err.message) ? err.message : String(err);
    console.error('Tax data preload failed:', err);
    if (typeof window.showBanner === 'function') {
      window.showBanner(
        'error',
        'Could not load tax brackets (' + msg + '). Reload the page or check your connection — projections will be inaccurate until this loads.'
      );
    }
  }
  if (typeof window.loadTaxData !== 'function') {
    notifyFailure(new Error('loadTaxData function not available'));
    return;
  }
  try {
    window.loadTaxData().then(function () {
      // The Page-1 baseline table fires its initial render BEFORE the
      // async tax-bracket fetch resolves, so on a fresh refresh the
      // cells render as $0 even though form values are restored.
      // Re-render once brackets are live so the user sees the correct
      // "Tax Liability if you did nothing" without having to touch the
      // form first.
      if (typeof window.renderBaselineTable === 'function') {
        try { window.renderBaselineTable(); } catch (e) { /* */ }
      }
    }).catch(notifyFailure);
  } catch (e) {
    notifyFailure(e);
  }
})();
