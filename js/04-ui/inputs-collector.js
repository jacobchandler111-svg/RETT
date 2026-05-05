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

// Income inputs are clamped to >= 0 here. parseUSD permits negatives
// (the user can paste "-$500K"), but income MEANINGFULLY can't be
// negative — losses are tracked via separate STCL/LTCL fields. Without
// this clamp a negative wage silently dropped the projection's tax
// baseline by tens of thousands and ran without warning. The
// validator (input-validation.js) still surfaces an error banner;
// this is the engine-side guard so the math never sees the bad value
// even if the user bypasses Continue and navigates straight to Page 2.
function _safeIncome(id) {
      const v = parseUSD(_val(id));
      return Math.max(0, Number.isFinite(v) ? v : 0);
}

function _sumIncomeSources() {
      const ids = ['w2-wages', 'se-income', 'biz-revenue', 'rental-income',
                   'dividend-income', 'retirement-distributions'];
      let sum = 0;
      for (const id of ids) sum += _safeIncome(id);
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
                investment:          parseUSD(_val('available-capital')) || parseUSD(_val('invested-capital')),
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
                baseLongTermGain:    parseUSD(_val('long-term-gain')),
                // Property-sale fields. Engine paths (computeDeferred-
                // TaxComparison, recommendSale, projection-engine
                // below-min check, _belowMinForLifecycle) all read
                // these for LT-gain math. Previously they were missing
                // from collectInputs and runAutoPick patched them in
                // post-hoc — but every other consumer of collectInputs
                // got a broken cfg with sale/basis = undefined, which
                // zeroed out the deferred-comparison engine.
                salePrice:               parseUSD(_val('sale-price')),
                costBasis:               parseUSD(_val('cost-basis')),
                acceleratedDepreciation: parseUSD(_val('accelerated-depreciation')),
                // Sale / Closing Date — anchors gain-recognition timing
                // (which calendar year the gain falls in) and the
                // structured-sale clock (when the buyer's installment
                // schedule starts). Use cfg.implementationDate everywhere
                // sale-side timing matters.
                implementationDate:      _val('implementation-date') || '',
                // Strategy Implementation Date — when Brooklyn actually
                // opens the position. Defaults to the sale date but the
                // user can defer it (e.g. proceeds take a few weeks to
                // settle, advisor is between trade windows). Drives
                // partial-year fee/loss proration on the Brooklyn side.
                // Engine consumers should read
                //   cfg.strategyImplementationDate || cfg.implementationDate
                // so older saved cases (which only carry implementationDate)
                // continue to work without migration.
                strategyImplementationDate: _val('strategy-implementation-date') || _val('implementation-date') || '',
                // Structured-sale product term (months from sale date to
                // maturity). Empty input → 18-month default. The deferred
                // tax-comparison engine clips gain recognition so all gain
                // hits by the maturity year.
                structuredSaleDurationMonths: (function () {
                      var raw = parseInt(_val('structured-sale-duration-months'), 10);
                      return (Number.isFinite(raw) && raw > 0) ? raw : 18;
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
          var implDate = _val('implementation-date') || '';
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
