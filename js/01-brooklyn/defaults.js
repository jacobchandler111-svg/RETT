// FILE: js/01-brooklyn/defaults.js
// Live, drop-in defaults for the multi-year sale-structuring schedule and
// loss-projection table. When the user provides finalized numbers, edit ONLY
// the arrays in window.RETT_DEFAULTS below and the year-schedule rows will
// auto-populate on page load.
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

// ----- Auto-populate hook -----
// Runs after DOMContentLoaded and after controls.js has wired up the
// year-schedule builder. Triggers the build (so rows exist) then fills
// each row's inputs from RETT_DEFAULTS where values are present.
(function () {
  function fmt(n) {
    if (n === null || n === undefined || n === '') return '';
    return String(n);
  }

  function applyDefaults() {
    const D = window.RETT_DEFAULTS || {};
    const buildBtn = document.getElementById('build-year-schedule');
    if (buildBtn) buildBtn.click();

    const host = document.getElementById('year-schedule');
    if (!host) return;
    const rows = host.querySelectorAll('.year-row');
    rows.forEach((row, i) => {
      const ord = row.querySelector('[data-field="ordinary"]');
      const sg  = row.querySelector('[data-field="short-gain"]');
      const lg  = row.querySelector('[data-field="long-gain"]');
      const lr  = row.querySelector('[data-field="loss-rate"]');
      if (ord && D.ordinaryByYear  && D.ordinaryByYear[i]  != null) ord.value = fmt(D.ordinaryByYear[i]);
      if (sg  && D.shortGainByYear && D.shortGainByYear[i] != null) sg.value  = fmt(D.shortGainByYear[i]);
      if (lg  && D.longGainByYear  && D.longGainByYear[i]  != null) lg.value  = fmt(D.longGainByYear[i]);
      if (lr  && D.lossRateByYear  && D.lossRateByYear[i]  != null) lr.value  = fmt(D.lossRateByYear[i]);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => setTimeout(applyDefaults, 0));
  } else {
    setTimeout(applyDefaults, 0);
  }
})();

// Preload tax data on page init so any consumer can call lookups immediately.
(function () {
  if (typeof window.loadTaxData === 'function') {
    try {
      window.loadTaxData().catch(function (e) { console.warn('Tax data preload failed:', e); });
    } catch (e) {
      console.warn('Tax data preload threw:', e);
    }
  }
})();
