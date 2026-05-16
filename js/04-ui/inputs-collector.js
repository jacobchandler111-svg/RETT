// FILE: js/04-ui/inputs-collector.js
// Reads form inputs and produces a normalized config object that the
// projection engine can consume. Per-year arrays (ordinaryByYear,
// shortGainByYear, longGainByYear, lossRateByYear) are pulled from
// repeated input rows when present so the user can structure a
// multi-year sale.
//
// Year-1 baseOrdinaryIncome is the sum of the granular income inputs:
//   W-2 wages + self-employment + business + rental + dividend + retirement.
// (Capital gains are tracked separately.)

function _val(id) {
      const el = document.getElementById(id);
      return el ? el.value : '';
}

// ---- Multi-property aggregator helpers (Q1) ----
// inputs-collector + every direct-DOM reader uses these to fold Property
// 1..5 into a single number/date. A property block is "active" when:
//   - Property 1 (always active — base case)
//   - Property 2..5: block exists AND is visible (not hidden) AND has a
//     positive sale-price. The sale-price gate prevents partial-entry
//     phantom-loss artifacts during typing (entering cost-basis before
//     sale-price would otherwise make aggregate LT gain go negative).
function _propertyIsActive(n) {
      if (n === 1) return true;
      const block = document.getElementById('property-' + n);
      if (!block || block.hidden) return false;
      const spEl = document.getElementById('sale-price-' + n);
      const sp = spEl ? (parseUSD(spEl.value) || 0) : 0;
      return sp > 0;
}
// Returns the field ID for property n. Property 1 uses the unsuffixed
// IDs (sale-price, cost-basis, ...); properties 2..5 use sale-price-2 etc.
function _propertyFieldId(baseId, n) {
      return (n === 1) ? baseId : (baseId + '-' + n);
}
// Sum a currency field across all active properties.
function _sumPropertyField(baseId) {
      let total = 0;
      for (let n = 1; n <= 5; n++) {
            if (!_propertyIsActive(n)) continue;
            const el = document.getElementById(_propertyFieldId(baseId, n));
            if (!el) continue;
            total += parseUSD(el.value) || 0;
      }
      return total;
}
// Earliest sale date across active properties (sorts ISO YYYY-MM-DD
// strings lexicographically). Returns '' if no dates are filled.
function _earliestPropertySaleDate() {
      const dates = [];
      for (let n = 1; n <= 5; n++) {
            if (!_propertyIsActive(n)) continue;
            const el = document.getElementById(_propertyFieldId('implementation-date', n));
            if (el && el.value) dates.push(el.value);
      }
      dates.sort();
      return dates[0] || '';
}
// Latest sale date across active properties (used to clamp per-property
// strategy-impl-date — each tranche shouldn't deploy before that property
// has closed).
function _latestPropertySaleDate() {
      const dates = [];
      for (let n = 1; n <= 5; n++) {
            if (!_propertyIsActive(n)) continue;
            const el = document.getElementById(_propertyFieldId('implementation-date', n));
            if (el && el.value) dates.push(el.value);
      }
      dates.sort();
      return dates[dates.length - 1] || '';
}
// Earliest Strategy Implementation Date across active properties. The
// engine's cfg.strategyImplementationDate is the FIRST tranche - when
// Brooklyn opens the position. Subsequent tranches can deposit later
// per-property, but for the existing single-date engine the earliest is
// the correct anchor for fee proration + Y0 deployment.
function _earliestPropertyStrategyDate() {
      const dates = [];
      for (let n = 1; n <= 5; n++) {
            if (!_propertyIsActive(n)) continue;
            const el = document.getElementById(_propertyFieldId('strategy-implementation-date', n));
            if (el && el.value) dates.push(el.value);
      }
      dates.sort();
      return dates[0] || '';
}

// ---- Per-property holding-period routing (Q2) ----
// Each property block has a Yes/No toggle "Has this property been held a
// year?" Yes (default) means the property's gain is long-term cap gain.
// No means short-term — the property's gain rolls into the ST bucket
// alongside any non-property STG from Section 02. Engine treats:
//   ltGain  = max(0, salePrice − costBasis − depr − shortTermPropertyGain)
//   stTax   = (Section 02 STG + shortTermPropertyGain)  // ordinary rate
// Recapture stays §1250-flavored ordinary regardless of holding period.
function _propertyHoldingPeriod(n) {
      // holding-period toggles ALWAYS use the suffixed ID (holding-period-1,
      // holding-period-2, ...) — Property 1 doesn't get the unsuffixed
      // alias the way sale-price / cost-basis / etc. do.
      const el = document.getElementById('holding-period-' + n);
      // Default to LT ('yes') so partial entries / legacy saves behave like
      // today. Only an explicit 'no' selection routes the gain to ST.
      return (el && el.value === 'no') ? 'short' : 'long';
}
// Sum the gain (sale − basis − depr, clamped at 0) for every active
// property the user marked as short-term-held.
function _shortTermPropertyGain() {
      let stg = 0;
      for (let n = 1; n <= 5; n++) {
            if (!_propertyIsActive(n)) continue;
            if (_propertyHoldingPeriod(n) !== 'short') continue;
            const sale  = parseUSD((document.getElementById(_propertyFieldId('sale-price', n))  || {}).value) || 0;
            const basis = parseUSD((document.getElementById(_propertyFieldId('cost-basis', n))  || {}).value) || 0;
            const depr  = parseUSD((document.getElementById(_propertyFieldId('accelerated-depreciation', n)) || {}).value) || 0;
            stg += Math.max(0, sale - basis - depr);
      }
      return stg;
}

// Expose to other JS files so direct-DOM readers can call the same
// aggregator without rebuilding the logic 13 different ways.
if (typeof window !== 'undefined') {
      window.__rettSumPropertyField = _sumPropertyField;
      window.__rettEarliestPropertySaleDate = _earliestPropertySaleDate;
      window.__rettLatestPropertySaleDate = _latestPropertySaleDate;
      window.__rettEarliestPropertyStrategyDate = _earliestPropertyStrategyDate;
      window.__rettPropertyIsActive = _propertyIsActive;
      window.__rettShortTermPropertyGain = _shortTermPropertyGain;
      window.__rettPropertyHoldingPeriod = _propertyHoldingPeriod;
}

// Most income inputs are clamped to >= 0 (a negative wage / dividend
// is meaningless — capital losses are tracked separately). But
// biz-revenue and rental-income legitimately can be negative —
// Schedule C / Schedule E losses are real ordinary-income offsets.
// _signedIncome is used for those; _safeIncome for the others.
function _safeIncome(id) {
      const v = parseUSD(_val(id));
      return Math.max(0, Number.isFinite(v) ? v : 0);
}
function _signedIncome(id) {
      const v = parseUSD(_val(id));
      return Number.isFinite(v) ? v : 0;
}

function _sumIncomeSources() {
      // Positive-only sources: wages, SE earnings, dividends, retirement.
      const posIds = ['w2-wages', 'se-income', 'dividend-income', 'retirement-distributions'];
      // Signed sources: business and rental — real-world losses allowed.
      const signedIds = ['biz-revenue', 'rental-income'];
      let sum = 0;
      for (const id of posIds) sum += _safeIncome(id);
      for (const id of signedIds) sum += _signedIncome(id);
      return sum;
}

// Wage base used for Additional Medicare (0.9% over $200K single /
// $250K MFJ). Per IRC §3101(b)(2) this applies to W-2 wages and
// self-employment earnings only — NOT to rental, dividend, biz, or
// retirement income. Keeping this carve-out prevents over-charging
// the surtax on real-estate clients with no W-2.
function _wageIncomeForAddlMedicare() {
      return _safeIncome('w2-wages') + _safeIncome('se-income');
}

// Passive / portfolio income that's part of the §1411 NIIT base —
// rental, non-qualified dividends, and interest sit in ordinary
// income for bracket purposes but ALSO surface on Form 8960 as net
// investment income subject to the 3.8% NIIT. Without this routing
// the engine understated NIIT for clients whose ordinary income is
// mostly passive (a common real-estate-investor pattern). Wages,
// SE earnings, business distributions, and retirement distributions
// are NOT in the NIIT base.
function _ordinaryInvestmentIncome() {
      return _safeIncome('rental-income') + _safeIncome('dividend-income');
}

function collectInputs() {
      const horizon = parseInt(_val('projection-years'), 10) || 5;
      const year1   = parseInt(_val('year1'), 10) || (new Date()).getFullYear();
      const custodianId = _val('custodian-select') || '';
        const leverageCapVal = parseFloat(_val('leverage-cap-select'));
        const cfg = {
                custodian:           custodianId,
                leverageCap:         (Number.isFinite(leverageCapVal) && leverageCapVal > 0) ? leverageCapVal : null,
                year1:               year1,
                horizonYears:        horizon,
                filingStatus:        _val('filing-status') || 'single',
                state:               _val('state-code')    || 'NONE',
                availableCapital:    parseUSD(_val('available-capital')),
                // The dedicated Brooklyn Investment input was removed: the
                // whole available capital is treated as the Brooklyn
                // investment. If the (hidden) legacy field has a non-zero
                // value, it still wins so existing programmatic flows can
                // override.
                // Prefer available-capital (the visible Page-2 source
                // of truth). Hidden #invested-capital is a legacy
                // fallback only — stops stale saved-state values from
                // overriding the user's current Available Capital edit.
                investment:          (_val('available-capital') !== '' ? parseUSD(_val('available-capital')) : null) ?? parseUSD(_val('invested-capital')),
                tierKey:             _val('strategy-select') || 'beta1',
                // leverage default; the Schwab-combo and variable-leverage
                // blocks below override this with the actual selection.
                leverage:            1,
                baseOrdinaryIncome:  _sumIncomeSources(),
                // Additional-Medicare wage base (W-2 + SE only). The
                // tax engine reads cfg.wages so it doesn't surcharge
                // rental/dividend/retirement income.
                wages:               _wageIncomeForAddlMedicare(),
                investmentIncomeOrdinary: _ordinaryInvestmentIncome(),
                baseShortTermGain:   parseUSD(_val('short-term-gain')),
                // Q7: non-property LT cap gain income (stocks, crypto, etc.).
                // Recurs annually; engine adds it to the LT bucket each year
                // alongside any property LT gain from the sale.
                baseLongTermGain:    parseUSD(_val('long-term-gain')),
                baseLongTermGain:    parseUSD(_val('long-term-gain')),
                // Property-sale fields. Engine paths (computeDeferred-
                // TaxComparison, recommendSale, projection-engine
                // below-min check, _belowMinForLifecycle) all read
                // these for LT-gain math. Previously they were missing
                // from collectInputs and runAutoPick patched them in
                // post-hoc — but every other consumer of collectInputs
                // got a broken cfg with sale/basis = undefined, which
                // zeroed out the deferred-comparison engine.
                // Multi-property aggregation (Q1): sum across all active
                // property blocks. _sumPropertyField handles the visibility
                // gate and the partial-entry sale-price gate.
                salePrice:               _sumPropertyField('sale-price'),
                costBasis:               _sumPropertyField('cost-basis'),
                acceleratedDepreciation: _sumPropertyField('accelerated-depreciation'),
                // Per-property holding-period split (Q2). Engine readers
                // subtract this from the LT-gain formula and add it to
                // the ST-gain (ordinary-rate) tax base.
                shortTermPropertyGain:   _shortTermPropertyGain(),
                // Sale / Closing Date — anchors gain-recognition timing
                // (which calendar year the gain falls in) and the
                // structured-sale clock (when the buyer's installment
                // schedule starts). For multi-property: use the EARLIEST
                // active property close date, since Brooklyn first opens
                // for business on day one of the first close.
                implementationDate:      _earliestPropertySaleDate() || _val('implementation-date') || '',
                // Strategy Implementation Date — when Brooklyn actually
                // opens the position. Defaults to the sale date but the
                // user can defer it (e.g. proceeds take a few weeks to
                // settle, advisor is between trade windows). Drives
                // partial-year fee/loss proration on the Brooklyn side.
                // Engine consumers should read
                //   cfg.strategyImplementationDate || cfg.implementationDate
                // so older saved cases (which only carry implementationDate)
                // continue to work without migration.
                // Each property has its own Strategy Implementation Date.
                // For the existing single-date engine, use the EARLIEST
                // active property's strategy date (when Brooklyn opens
                // the position - first tranche). Falls back to Property 1's
                // direct field if helpers haven't loaded yet.
                strategyImplementationDate: _earliestPropertyStrategyDate() || _val('strategy-implementation-date') || _val('implementation-date') || '',
                // Structured-sale product term (months from sale date to
                // maturity). Empty input → 36-month default (regulatory
                // minimum as of 2026-05-08; 3 years of yearly Jan-1
                // payments). 36mo replaced 48mo per MetLife's 3-year
                // approval; engine clips gain recognition so all gain
                // hits by the maturity year.
                structuredSaleDurationMonths: (function () {
                      var raw = parseInt(_val('structured-sale-duration-months'), 10);
                      return (Number.isFinite(raw) && raw > 0) ? raw : 36;
                })(),
                // "Cover taxes from sale": when yes, the calculator carves
                // estimated federal + state tax out of the sale proceeds
                // before they hit Brooklyn — so the client doesn't end up
                // cash-short on April 1 of the year following the sale.
                // The estimate uses computeFederalTax + computeStateTax on
                // the full LT gain (treated as Y1 lump-sum), which is the
                // conservative-high tax floor for both immediate and
                // structured paths. Math is applied in
                // _recomputeAvailableCapital — the cfg field below just
                // surfaces the toggle to the engine for future use.
                coverTaxesFromSale: (_val('cover-taxes-yes-no') === 'yes'),
                // Future Sale Loss Target (Page 1 Section 05).
                // When enabled, the optimizer can let loss carryforward
                // roll forward to absorb futureSale.estimatedGain instead
                // of being capped at the $3K/yr §1211(b) trickle. When
                // disabled, the solver should pull Brooklyn back to avoid
                // generating loss the client can't deploy.
                //
                // Simplified shape (2026-05-15): single estimatedGain
                // replaces prior 4-field sale-price/basis/depr/LT-gain
                // breakdown — clients estimate their total taxable amount
                // directly rather than reverse-engineering it from a deal
                // structure they may not have nailed down yet.
                futureSale: (function () {
                  var enabled = (_val('future-sale-yes-no') === 'yes');
                  if (!enabled) return { enabled: false };
                  var eg = parseUSD(_val('future-estimated-gain')) || 0;
                  return {
                    enabled:        true,
                    saleDate:       _val('future-sale-date') || '',
                    estimatedGain:  Math.max(0, eg)
                  };
                })(),
                // Scenario-comparison override: when the user clicked the
                // "Delay close to Jan 1 next year" row, we stash the
                // year-index cap on window so the engine forces gain to
                // recognize at exactly that year (no insurance product
                // term to honor). Cleared when the user clicks any other
                // scenario or reverts to the auto-pick choice.
                maxRecognitionYearIndex: (typeof window !== 'undefined' &&
                            window.__rettScenarioMaxRec != null)
                            ? Number(window.__rettScenarioMaxRec) : null
                // Per-year override arrays (ordinaryByYear, shortGainByYear,
                // longGainByYear, lossRateByYear) were sourced from a
                // future-years UI that has been removed. The engine falls
                // through to Year-1 base values for every projected year
                // when these arrays are absent, which is the desired
                // behavior for the current single-snapshot input model.
      };
      // Recognition-start year (1-indexed user year, 1 = immediate). Stored
      // on cfg as a 0-indexed offset so engine code can use it as an array
      // index directly. Default 0 = recognize gain in year 1 (today's
      // behavior).
      var recRaw = parseInt(_val('recognition-start-select'), 10);
      cfg.recognitionStartYearIndex = (Number.isFinite(recRaw) && recRaw >= 1) ? (recRaw - 1) : 0;

      // Schwab combo resolution: when the custodian is Charles Schwab,
      // resolve the active short% to a Schwab combo. The Page-2 pill
      // picker is the canonical source-of-truth (it writes to
      // #custom-short-pct), so we look that up FIRST. Page-1's
      // leverage-cap-select is a fallback for flows that never hit
      // Page 2 (cfg-build during initial auto-pick before the user
      // engages the slider/pills). The auto-pick optimizer also drives
      // #custom-short-pct directly, so it honors the same priority.
      if (cfg.custodian === 'schwab' && typeof listSchwabCombos === 'function') {
        var combo = null;
        var spRawSch = parseFloat(_val('custom-short-pct'));
        if (Number.isFinite(spRawSch)) {
          combo = listSchwabCombos().filter(function (c) {
            return c.strategyKey === cfg.tierKey && c.shortPct === spRawSch;
          })[0] || null;
        }
        // Fallback: leverage-cap-select label (Page-1 dropdown).
        if (!combo && typeof findSchwabCombo === 'function') {
          var leverageLabel = _val('leverage-cap-select') || '';
          combo = findSchwabCombo(cfg.tierKey, leverageLabel);
        }
        if (combo) {
          cfg.comboId = combo.id;
          cfg.leverageLabel = combo.leverageLabel;
          cfg.leverage = (combo.shortPct || 0) / 100;
          // Multi-property: use earliest active property close date
          // (falls back to Property 1 directly if helper unavailable).
          var implDate = _earliestPropertySaleDate() || _val('implementation-date') || '';
          cfg.implementationDate = implDate || (cfg.year1 + '-01-01');
        }
      }

      // Custom (variable) leverage override — non-Schwab only. Schwab
      // is preset-only with baked-in per-year loss curves (lossByYear);
      // running through the regression here would override that and
      // lose the tapering. So this block ONLY fires when the custodian
      // is NOT Schwab.
      if (cfg.custodian !== 'schwab') {
        var customToggle = document.getElementById('use-variable-leverage');
        if (customToggle && customToggle.checked) {
          var spRaw = parseFloat(_val('custom-short-pct'));
          if (Number.isFinite(spRaw) && spRaw >= 0) {
            cfg.useVariableLeverage = true;
            cfg.customShortPct = spRaw;
            cfg.leverage = spRaw / 100;
            cfg.leverageCap = spRaw / 100;
            delete cfg.comboId;
            delete cfg.leverageLabel;
          }
        }
      }

      return cfg;
}
