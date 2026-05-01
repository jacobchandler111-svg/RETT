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

function _arrayFromRows(rowSelector, fieldName) {
      const rows = document.querySelectorAll(rowSelector);
      const out = [];
      rows.forEach(r => {
            const inp = r.querySelector('[data-field="' + fieldName + '"]');
            if (inp) out.push(parseUSD(inp.value));
      });
      return out.length ? out : null;
}

function _arrayPctFromRows(rowSelector, fieldName) {
      const rows = document.querySelectorAll(rowSelector);
      const out = [];
      rows.forEach(r => {
            const inp = r.querySelector('[data-field="' + fieldName + '"]');
            if (inp) out.push(parseFloat(inp.value) / 100);
      });
      return out.length ? out : null;
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

function _buildPerYearArray(field, year1Base) {
    // Always include Year 1 at index 0 from base inputs.
    // Then read Year 2..N from #future-years-host (blank => fall through to Year-1 base).
    const out = [year1Base || 0];
    const rows = document.querySelectorAll('#future-years-host .year-row');
    rows.forEach(r => {
        const inp = r.querySelector('[data-field="' + field + '"]');
        const raw = inp ? inp.value.trim() : '';
        out.push(raw === '' ? (year1Base || 0) : parseUSD(raw));
    });
    return out;
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
                leverage:            parseFloat(_val('leverage')) || 1,
                baseOrdinaryIncome:  _sumIncomeSources(),
                baseShortTermGain:   parseUSD(_val('short-term-gain')),
                baseLongTermGain:    parseUSD(_val('long-term-gain')),
                // Per-year overrides (optional - leave blank to use the year-1
                // base values for every projected year).
                // Per-year arrays: index 0 = Year 1 (uses base inputs), index 1+ = Year 2+
                // from #future-years-host. Empty future-year inputs fall through to Year-1 base.
                ordinaryByYear:    _buildPerYearArray('ordinary',   _sumIncomeSources()),
                shortGainByYear:   _buildPerYearArray('short-gain', parseUSD(_val('short-term-gain'))),
                longGainByYear:    _buildPerYearArray('long-gain',  parseUSD(_val('long-term-gain'))),
                lossRateByYear:    _arrayPctFromRows('#future-years-host .year-row', 'loss-rate')
      };
      // Schwab combo resolution: when the custodian is Charles Schwab, resolve
      // the (strategy, leverageLabel) pair to a Schwab combo and inject
      // cfg.comboId so the projection engine uses the multi-year tranche curve.
      // Implementation date drives the 365-day tranche anchor.
      if (cfg.custodian === 'schwab' && typeof findSchwabCombo === 'function') {
        var leverageLabel = _val('leverage-cap-select') || '';
        var combo = findSchwabCombo(cfg.tierKey, leverageLabel);
        if (combo) {
          cfg.comboId = combo.id;
          cfg.leverageLabel = leverageLabel;
          var implDate = _val('implementation-date') || '';
          cfg.implementationDate = implDate || (cfg.year1 + '-01-01');
        }
      }

      return cfg;
}
