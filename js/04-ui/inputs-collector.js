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

function _sumIncomeSources() {
      const ids = ['w2-wages', 'se-income', 'biz-revenue', 'rental-income',
                   'dividend-income', 'retirement-distributions'];
      let sum = 0;
      for (const id of ids) {
            const v = parseUSD(_val(id));
            if (v) sum += v;
      }
      return sum;
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
                investment:          parseUSD(_val('invested-capital')) || parseUSD(_val('available-capital')),
                tierKey:             _val('strategy-select') || 'beta1',
                // leverage default; the Schwab-combo and variable-leverage
                // blocks below override this with the actual selection.
                leverage:            1,
                baseOrdinaryIncome:  _sumIncomeSources(),
                baseShortTermGain:   parseUSD(_val('short-term-gain')),
                baseLongTermGain:    parseUSD(_val('long-term-gain'))
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
