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
// ---- Multi-property year-of-sale schedule ----
// When a client has multiple properties closing in DIFFERENT calendar
// years (e.g. P1 in 2026 and P2 in 2027), each property's gain belongs
// in its own tax year — not aggregated into the earliest-year Y0 lump
// that the engine has historically used. This helper builds a year-
// offset map of LT gain + recapture + ST property gain so the engine
// (specifically _baseScenarioForYear in tax-comparison.js) can apply
// the right gain to the right year.
//
// Shape: [{ yearOffset, ltGain, recapture, stPropertyGain, saleDate }, ...]
// where yearOffset is 0-indexed relative to cfg.year1.
//
// Returns [] when every active property closes in the same calendar
// year — the engine falls through to the legacy aggregate path in
// that case (no behavior change for the common single-year scenario).
function _propertyGainSchedule(baseYear) {
      var byYear = {};
      var dates = [];
      for (var n = 1; n <= 5; n++) {
            if (!_propertyIsActive(n)) continue;
            var sp   = parseUSD((document.getElementById(_propertyFieldId('sale-price', n)) || {}).value) || 0;
            var cb   = parseUSD((document.getElementById(_propertyFieldId('cost-basis', n)) || {}).value) || 0;
            var depr = parseUSD((document.getElementById(_propertyFieldId('accelerated-depreciation', n)) || {}).value) || 0;
            var dateStr = (document.getElementById(_propertyFieldId('implementation-date', n)) || {}).value || '';
            if (!dateStr || sp <= 0) continue;
            var yr = parseInt(dateStr.slice(0, 4), 10);
            if (!Number.isFinite(yr)) continue;
            var isShort = _propertyHoldingPeriod(n) === 'short';
            var rawGain = Math.max(0, sp - cb - depr);
            byYear[yr] = byYear[yr] || { yearOffset: yr - baseYear, ltGain: 0, recapture: 0, stPropertyGain: 0, saleYears: [] };
            byYear[yr].recapture += Math.max(0, depr);
            if (isShort) byYear[yr].stPropertyGain += rawGain;
            else         byYear[yr].ltGain         += rawGain;
            byYear[yr].saleYears.push(yr);
            dates.push(dateStr);
      }
      var keys = Object.keys(byYear).map(Number).sort(function (a, b) { return a - b; });
      // No multi-year split needed when every property lands in the same year.
      if (keys.length < 2) return [];
      return keys.map(function (yr) {
            var b = byYear[yr];
            return {
                  yearOffset:     b.yearOffset,
                  ltGain:         b.ltGain,
                  recapture:      b.recapture,
                  stPropertyGain: b.stPropertyGain,
                  saleYear:       yr
            };
      });
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
      // Personal-use carve-out per property (replaces the top-level
      // "investing everything?" question). Returns total amount the
      // client wants to keep off the table across all active properties.
      window.__rettSumPersonalUseAmount = function () {
            let total = 0;
            for (let n = 1; n <= 5; n++) {
                  if (!_propertyIsActive(n)) continue;
                  const yn = document.getElementById('personal-use-yes-no-' + n);
                  if (!yn || yn.value !== 'yes') continue;
                  const amt = document.getElementById('personal-use-amount-' + n);
                  if (!amt) continue;
                  total += parseUSD(amt.value) || 0;
            }
            return total;
      };
      window.__rettAnyPersonalUseYes = function () {
            for (let n = 1; n <= 5; n++) {
                  if (!_propertyIsActive(n)) continue;
                  const yn = document.getElementById('personal-use-yes-no-' + n);
                  if (yn && yn.value === 'yes') return true;
            }
            return false;
      };
      // Outstanding debt / payoff per property. Like personal-use, this is
      // a Y0 reduction of available capital (proceeds go to retire the
      // mortgage/note, so they never reach Brooklyn). Summed across active
      // properties where the "amount still owed" toggle is yes.
      window.__rettSumAmountOwed = function () {
            let total = 0;
            for (let n = 1; n <= 5; n++) {
                  if (!_propertyIsActive(n)) continue;
                  const yn = document.getElementById('amount-owed-yes-no-' + n);
                  if (!yn || yn.value !== 'yes') continue;
                  const amt = document.getElementById('amount-owed-amount-' + n);
                  if (!amt) continue;
                  total += parseUSD(amt.value) || 0;
            }
            return total;
      };
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
      // Positive-only sources: wages, dividends, retirement, taxable
      // interest. Business income flows through the new
      // #business-income-amount block (any type goes to ordinary
      // brackets — SE-tax routing happens separately based on the
      // type radio). Legacy IDs se-income and biz-revenue are hidden
      // inputs that read 0 and are no longer summed here (replaced by
      // the new business-income block 2026-05-27).
      const posIds = ['w2-wages', 'dividend-income', 'retirement-distributions', 'interest-income', 'business-income-amount'];
      // Signed sources: rental — real-world losses allowed.
      const signedIds = ['rental-income'];
      let sum = 0;
      for (const id of posIds) sum += _safeIncome(id);
      for (const id of signedIds) sum += _signedIncome(id);
      return sum;
}

// Returns true when the selected business-income type triggers
// self-employment tax (IRC §1401). Per §1402(a)(13), limited
// partners are exempt; S-corp distributions are also exempt
// (the S-corp owner-employee pays FICA on reasonable W-2 comp
// separately, which goes through #w2-wages).
function _businessTypeTriggersSE() {
      var el = document.querySelector('input[name="business-income-type"]:checked');
      var t = el ? el.value : null;
      return t === 'se' || t === 'k1-partnership-gp';
}

function _businessIncomeForSE() {
      return _businessTypeTriggersSE() ? _safeIncome('business-income-amount') : 0;
}

// Wage base used for Additional Medicare (0.9% over $200K single /
// $250K MFJ). Per IRC §3101(b)(2) this applies to W-2 wages and
// self-employment earnings only — NOT to rental, dividend, biz, or
// retirement income. The federal engine adds (seIncome × 0.9235)
// to this on top — so we pass W-2 only here and let the engine
// fold in the SE portion via opts.seIncome.
function _wageIncomeForAddlMedicare() {
      return _safeIncome('w2-wages');
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
      // Per IRC §1411(c)(1)(A)(i) — "interest, dividends, annuities,
      // royalties, and rents." Taxable interest (1040 Line 2b) is in
      // the NIIT base alongside rental and non-qualified dividends.
      return _safeIncome('rental-income') + _safeIncome('dividend-income') + _safeIncome('interest-income');
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
                // Forced Y0 payment = personal-use cash + outstanding-debt
                // payoff carved off the sale proceeds at closing. Already
                // netted out of availableCapital upstream; the engine uses
                // this to recognize F × GP-ratio of gain at Y0 for the
                // deferred strategies (B/C) since that cash was received at
                // closing rather than deferred. Not deployed to Brooklyn.
                forcedY0Payment: (
                      ((typeof window.__rettSumPersonalUseAmount === 'function') ? (window.__rettSumPersonalUseAmount() || 0) : 0) +
                      ((typeof window.__rettSumAmountOwed === 'function') ? (window.__rettSumAmountOwed() || 0) : 0)
                ),
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
                // Qualified dividends (1040 Line 3a). Taxed at LTCG
                // preferential rates per IRC §1(h)(11); also in §1411
                // NIIT base. Stacks on top of ordinary income for
                // bracket placement, same as LT capital gain. Engine
                // path: scenario.qualifiedDividend → computeFederalTax-
                // Breakdown opts.qualifiedDividend → ltAmount in the
                // bracket walk. Wired 2026-05-27.
                qualifiedDividend:   _safeIncome('qualified-dividends'),
                // Gross Social Security benefits (1040 Line 6a). Engine
                // applies IRC §86 provisional-income worksheet inside
                // _baseScenarioForYear to derive the taxable portion
                // (0% / up to 50% / up to 85%) which is added to
                // ordinary income. NOT in NIIT base, NOT in Additional
                // Medicare wage base. State exemption varies; not
                // modeled per-state. Wired 2026-05-27.
                socialSecurityBenefits: _safeIncome('social-security'),
                // Business income — total amount + type. Amount is
                // always in baseOrdinaryIncome (ordinary brackets) via
                // _sumIncomeSources. seIncome below is the SE-eligible
                // portion that triggers §1401 SE tax (12.4% SS capped
                // at wage base + 2.9% Medicare uncapped) and adds to
                // the Additional Medicare wage base. Only fires for
                // type='se' (Sch C / sole prop / 1099) and type=
                // 'k1-partnership-gp' (general partner / active).
                // k1-scorp and k1-partnership-lp are exempt per
                // §1402(a)(13). Wired 2026-05-27. Half-SE deduction
                // (§164(f)) is a P1 follow-up - currently engine
                // does NOT subtract half of SE tax from AGI.
                businessIncomeAmount: _safeIncome('business-income-amount'),
                businessIncomeType: (function () {
                      var el = document.querySelector('input[name="business-income-type"]:checked');
                      return el ? el.value : null;
                })(),
                seIncome: _businessIncomeForSE(),
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
                // §1245/§1250 split (UI sub-block under acceleratedDepreciation).
                //   §1245 (personal property / cost-seg 5-7-15-yr) → ordinary
                //     income rates, NOT subject to NIIT (active trade/business
                //     assumption), AMT lumps into ordinary slice (26/28%).
                //   §1250 (real property / 39-yr building shell) → unrecaptured
                //     §1250 gain, taxed at per-slice min(marginal, 25%) via
                //     §1(h)(1)(E), included in NIIT base, capital losses can
                //     offset it via §1(h) netting.
                //   Backward compat: if the split fields are blank, the engine
                //     defaults the whole acceleratedDepreciation to §1250
                //     (current behavior). Sum validator in controls.js flags
                //     mismatch but doesn't block; engine trusts the split when
                //     either field is non-blank.
                acceleratedDepreciation1245: parseUSD(_val('accelerated-depreciation-1245')) || 0,
                acceleratedDepreciation1250: parseUSD(_val('accelerated-depreciation-1250')) || 0,
                // Multi-property year-of-sale schedule (Q1-extended).
                // Empty array when every property closes in the same
                // calendar year — engine falls through to the legacy
                // aggregate (no behavior change). When non-empty, the
                // engine routes each year's gain into its own row of
                // the without-sale baseline instead of stacking the
                // full aggregate into Y0. See _propertyGainSchedule
                // above for shape.
                propertyGainSchedule: _propertyGainSchedule(
                      parseInt(_val('year1'), 10) || new Date().getFullYear()
                ),
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

      // ---- Additional Funds (Tab 1 Section 03), gated on the Projection
      // tab's "Include Additional Funds" toggle ----------------------------
      // When ON, the client liquidates `additional-funds` dollars from a
      // taxable account (value AV, unrealized LT/ST gain). That cash becomes
      // extra Brooklyn capital, and the liquidation realizes gain PRO-RATA
      // to the account's composition:
      //   ltRealized = liq * (acctLT / AV)   (signed — LT can be a loss)
      //   stRealized = liq * (acctST / AV)   (signed — ST can be a loss)
      // Those realized amounts are new taxable income this year, folded into
      // baseLongTermGain / baseShortTermGain (which now accept negatives as
      // §1211 capital losses). Toggle OFF ⇒ zero impact (cfg identical to
      // pre-feature). See ADDITIONAL_FUNDS_OPTIMIZER_SPEC.md §2.
      // __rettAdditionalFundsOverride: the per-strategy amount sweep (in
      // buildInterestedSummary) sets this to a specific liquidation amount so
      // it can measure each strategy's net at a candidate amount (0 = decline,
      // a tier gap, or the entered amount) regardless of the toggle/DOM value.
      // A finite override wins over the toggle; override 0 ⇒ no fold.
      var _afOverride  = (typeof window !== 'undefined') ? window.__rettAdditionalFundsOverride : undefined;
      var _hasAfOver   = (typeof _afOverride === 'number' && isFinite(_afOverride) && _afOverride >= 0);
      var _addFundsToggle = document.getElementById('additional-funds-toggle');
      var _doAddFunds  = _hasAfOver ? (_afOverride > 0)
                                    : !!(_addFundsToggle && _addFundsToggle.checked);
      if (_doAddFunds) {
            var _addFunds = _hasAfOver ? _afOverride : (parseUSD(_val('additional-funds')) || 0);
            var _acctVal  = parseUSD(_val('additional-account-value')) || 0;
            var _acctLT   = parseUSD(_val('additional-lt-gain')) || 0;   // signed
            var _acctST   = parseUSD(_val('additional-st-gain')) || 0;   // signed
            if (_addFunds > 0 && _acctVal > 0) {
                  var _liq = Math.min(_addFunds, _acctVal);   // can't liquidate more than exists
                  cfg.availableCapital = (Number(cfg.availableCapital) || 0) + _liq;
                  cfg.investment       = (Number(cfg.investment) || 0) + _liq;
                  // The triggered gains are a ONE-TIME Y0 event (the
                  // liquidation happens once). Route them through Y0-only
                  // channels — NOT baseLongTermGain / baseShortTermGain,
                  // which RECUR every projection year in
                  // _baseScenarioForYear (they model recurring annual
                  // stock/crypto income). Folding a one-time sale into them
                  // taxed the gain every year.
                  cfg.additionalY0LongGain  = _liq * (_acctLT / _acctVal);   // signed (loss ok)
                  cfg.additionalY0ShortGain = _liq * (_acctST / _acctVal);   // signed (loss ok)
                  cfg.additionalFundsApplied = _liq;   // breadcrumb for admin/debug
            }
      }

      return cfg;
}
