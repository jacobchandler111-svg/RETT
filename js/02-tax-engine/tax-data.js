// FILE: js/02-tax-engine/tax-data.js
// In-memory cache for the federal + state bracket tables loaded from
// data/taxBrackets.json. The actual fetch + Infinity-decoding happens in
// 02-tax-engine/tax-loader.js; consumers should always access the data
// through the helpers in tax-lookups.js so the cache is shared.
//
// Source schema (note 'state' not 'states'):
//   { federal: { '2025': {...}, '2026': {...} },
//     state:   { '2025': { AL: {...}, ... }, '2026': { AL: {...}, ... } } }
//
// =====================================================================
// IRS BRACKET VERIFICATION — REQUIRED MANUAL AUDIT (P0-9)
// =====================================================================
// Cross-checked data/taxBrackets.json against Tax Foundation's 2026
// inflation-adjusted figures (https://taxfoundation.org/data/all/federal/2026-tax-brackets/)
// on 2026-05-04. The following discrepancies are SUSPECTED and need
// IRS Rev. Proc. 2025-32 verbatim verification before patching:
//
//   federal.2026.brackets.married_joint  35% bracket cap:
//     RETT data: 1281200    Tax Foundation: 768700    Δ +$512,500
//     Note: 2025 RETT data is 751600. A 2% inflation roll → ~$766,632,
//     which matches Tax Foundation. RETT 2026 value of $1,281,200 is
//     ~67% above expectation — almost certainly a typo or stale OBBBA
//     placeholder. Effect: HIGH-INCOME MFJ baselines are UNDER-stated
//     because the 35→37 boundary is pushed way past correct.
//
//   federal.2026.ltcgRates.single   0%→15% boundary:
//     RETT: 47025    Tax Foundation: 49450    Δ +$2,425
//   federal.2026.ltcgRates.single   15%→20% boundary:
//     RETT: 518900   Tax Foundation: 545500   Δ +$26,600
//   federal.2026.ltcgRates.married_joint  0%→15% boundary:
//     RETT: 94050    Tax Foundation: 98900    Δ +$4,850
//   federal.2026.ltcgRates.married_joint  15%→20% boundary:
//     RETT: 583750   Tax Foundation: 613700   Δ +$29,950
//   federal.2026.ltcgRates.head_household  0%→15% boundary:
//     RETT: 63000    Tax Foundation: 66200    Δ +$3,200
//   federal.2026.ltcgRates.head_household  15%→20% boundary:
//     RETT: 551350   Tax Foundation: 579600   Δ +$28,250
//   The MFJ values RETT carries are very close to the 2025 LTCG figures
//   ($96,700 / $600,050) — looks like 2025 data was copied without the
//   inflation roll for 2026. Effect: LTCG tax slightly OVER-stated.
//
// Verification path (cannot be automated — IRS PDF strips text content):
//   1. Open https://www.irs.gov/pub/irs-drop/rp-25-32.pdf in a browser
//   2. Quote §3.01 (ordinary brackets) and §3.03 (LTCG breakpoints)
//   3. Patch data/taxBrackets.json with verbatim figures
//   4. Drop this comment block once verified
// =====================================================================

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
