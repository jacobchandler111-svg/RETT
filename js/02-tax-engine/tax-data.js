// FILE: js/02-tax-engine/tax-data.js
// In-memory cache for the federal + state bracket tables loaded from
// data/taxBrackets.json. The actual fetch + Infinity-decoding happens in
// 02-tax-engine/tax-loader.js; consumers should always access the data
// through the helpers in tax-lookups.js so the cache is shared.
//
// Source schema (note 'state' not 'states'):
//   { federal: { '2025': {...}, '2026': {...} },
//     state:   { '2025': { AL: {...}, ... }, '2026': { AL: {...}, ... } } }

const TAX_DATA = {
          loaded: false,
          raw: null,
          federal: null,       // Shortcut: TAX_DATA.raw.federal
          states:  null,       // Shortcut: TAX_DATA.raw.state  (note source key is singular)
          years:   [],         // Sorted list of available federal years e.g. [2025, 2026].
          inflationRate: 0.02, // Inflation roll for years past the last published year.
          baseYear: 2026,      // After this year, brackets are projected with inflationRate.
          maxProjectedYear: 2031,
          // SECA Self-Employment tax constants. seTaxMultiplier (0.9235)
          // is the SE-earnings adjustment per Form SE — multiply gross SE
          // income by this before applying SS/Medicare rates. ssWageBase
          // is the Social Security taxable wage cap (the 2.9% Medicare
          // portion is uncapped). Verify ssWageBase against SSA each
          // January — 2025 was $176,100, the 2026 value is published in
          // late October 2025 and should be patched here when released.
          seTaxRate: 0.153,        // 12.4% SS + 2.9% Medicare combined
          seTaxMultiplier: 0.9235, // SE income × this = SECA base
          ssWageBase: 176100       // 2025 SSA wage base; 2026 TBD-pending
};

function setTaxData(decoded) {
          TAX_DATA.raw      = decoded;
          TAX_DATA.federal  = decoded.federal || null;
          TAX_DATA.states   = decoded.state   || null;   // source uses 'state' (singular)
    TAX_DATA.years    = Object.keys(decoded.federal || {}).map(Number).sort((a, b) => a - b);
          TAX_DATA.loaded   = true;
}

function isTaxDataLoaded() { return TAX_DATA.loaded; }
