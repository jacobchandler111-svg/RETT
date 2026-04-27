// FILE: js/04-ui/inputs-collector.js
// Reads form inputs and produces a normalized config object that the
// projection engine can consume. Per-year arrays (ordinaryByYear,
// shortGainByYear, longGainByYear, lossRateByYear) are pulled from
// repeated input rows when present so the user can structure a
// multi-year sale.

function _val(id) {
      const el = document.getElementById(id);
      return el ? el.value : '';
}

function _arrayFromRows(rowSelector, fieldName) {
      const rows = document.querySelectorAll(rowSelector);
      const out  = [];
      rows.forEach(r => {
                const el = r.querySelector('[data-field="' + fieldName + '"]');
                if (el && el.value !== '') out.push(parseUSD(el.value));
      });
      return out.length ? out : null;
}

function _arrayPctFromRows(rowSelector, fieldName) {
      const rows = document.querySelectorAll(rowSelector);
      const out  = [];
      rows.forEach(r => {
                const el = r.querySelector('[data-field="' + fieldName + '"]');
                if (el && el.value !== '') out.push(parsePct(el.value));
      });
      return out.length ? out : null;
}

function collectInputs() {
      const horizon = parseInt(_val('horizon-years'), 10) || 5;
      const year1   = parseInt(_val('year1'), 10) || (new Date()).getFullYear();
      const cfg = {
                year1:               year1,
                horizonYears:        horizon,
                filingStatus:        _val('filing-status') || 'single',
                state:               _val('state-code')    || 'NONE',
                availableCapital:    parseUSD(_val('available-capital')),
                investment:          parseUSD(_val('investment')),
                tierKey:             _val('tier-key')      || 'beta1',
                leverage:            parseFloat(_val('leverage')) || 1,
                baseOrdinaryIncome:  parseUSD(_val('ordinary-income')),
                baseShortTermGain:   parseUSD(_val('short-term-gain')),
                baseLongTermGain:    parseUSD(_val('long-term-gain')),
                // Per-year overrides (optional - leave blank to use the year-1
                // base values for every projected year).
                ordinaryByYear:      _arrayFromRows('.year-row', 'ordinary'),
                shortGainByYear:     _arrayFromRows('.year-row', 'short-gain'),
                longGainByYear:      _arrayFromRows('.year-row', 'long-gain'),
                lossRateByYear:      _arrayPctFromRows('.year-row', 'loss-rate')
      };
      return cfg;
}
