// FILE: js/02-tax-engine/tax-data.js
// In-memory cache for the federal + state bracket tables loaded from
// data/taxBrackets.json. The actual fetch + Infinity-decoding happens in
// 02-tax-engine/tax-loader.js; consumers should always access the data
// through the helpers in tax-lookups.js so the cache is shared.

const TAX_DATA = {
      loaded: false,
      raw: null,           // The decoded JSON object (with 999999999 -> Infinity).
      federal: null,       // Shortcut: TAX_DATA.raw.federal
      states:  null,       // Shortcut: TAX_DATA.raw.states
      years:   [],         // Sorted list of available years e.g. [2025, 2026].
      inflationRate: 0.02, // Default inflation roll for years past the last published year.
      baseYear: 2026,      // After this year, brackets are projected with inflationRate.
      maxProjectedYear: 2031
};

// Mark the cache populated. Called by tax-loader after a successful load.
function setTaxData(decoded) {
      TAX_DATA.raw      = decoded;
      TAX_DATA.federal  = decoded.federal  || null;
      TAX_DATA.states   = decoded.states   || null;
      TAX_DATA.years    = Object.keys(decoded.federal || {}).map(Number).sort((a, b) => a - b);
      TAX_DATA.loaded   = true;
}

function isTaxDataLoaded() {
      return TAX_DATA.loaded;
}
