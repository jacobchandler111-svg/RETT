// FILE: js/04-ui/cashflow-schedule-render.js
// Below the Multi-Year Snapshot on Page 2, render two coordinated
// year-by-year tables that tell the cash-flow story:
//
//   1) Brooklyn Investment Schedule
//      How much NEW capital is added to Brooklyn each year (basis
//      cash in Year 1, structured-sale tranche releases in later
//      years), the date that capital is assumed to be deployed,
//      and a running cumulative balance for context. Total at the
//      bottom = the sum of new investments = the final cumulative.
//
//   2) Structured-Sale Schedule
//      How much of the original gain remains locked in the
//      structured-sale agreement, and the dollar amount + date of
//      each scheduled release.
//
// Minimum-investment check: if the very first year's deposit is
// below the custodian's strategy minimum, a banner is rendered above
// the tables warning the advisor that Brooklyn cannot legally accept
// the position. Once the position is open, subsequent tranche
// additions are allowed at any size (no per-tranche minimum).
//
// Reads from window.__lastComparison (built by tax-comparison.js's
// computeDeferredTaxComparison or computeTaxComparison) and the
// projection cfg. Public entry point: renderCashflowSchedule().

(function (root) {
  'use strict';

  function _fmt(n) {
    if (n == null || !isFinite(n)) return '—';
    if (typeof fmtUSD === 'function') return fmtUSD(n);
    var sign = n < 0 ? '-' : '';
    var v = Math.round(Math.abs(n));
    return sign + '$' + v.toLocaleString('en-US');
  }

  function _section(title, body, sub) {
    var subHtml = sub ? '<p class="subtitle muted" style="margin-bottom:6px;">' + sub + '</p>' : '';
    return '<h3 class="section-title" style="margin-top:24px;">' + title + '</h3>' +
           subHtml +
           '<div class="rett-table-wrap rett-table-scroll">' +
             '<table class="rett-data-table rett-data-table-frozen">' + body + '</table>' +
           '</div>';
  }

  // Format a date string (YYYY-MM-DD) as "Mon DD, YYYY" for display.
  // Falls back to the raw string if parsing fails.
  function _fmtDate(dateStr, year) {
    if (!dateStr) {
      // No implementation date provided — assume Jan 1 of the year.
      return year ? ('Jan 1, ' + year) : '—';
    }
    var d = (typeof window.parseLocalDate === 'function')
      ? window.parseLocalDate(dateStr) : new Date(dateStr);
    if (!d || isNaN(d.getTime())) return year ? ('Jan 1, ' + year) : dateStr;
    var months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    return months[d.getMonth()] + ' ' + d.getDate() + ', ' + d.getFullYear();
  }

  // Build the year-by-year cashflow rows from a comparison's
  // recognitionSchedule + investmentThisYear. For the immediate path
  // (no recognitionSchedule), we synthesize a single Year-1 recognition.
  function _buildScheduleRows(cfg, comp, years) {
    if (!comp || !Array.isArray(comp.rows)) return [];
    var year1 = (cfg && cfg.year1) || (years[0] && years[0].year) || (new Date()).getFullYear();
    // Short-term gain carved from the property sale reduces the LT
    // bucket here so the schedule reconciles with the tax engines.
    var stShort = Math.max(0, cfg.baseShortTermGain || 0);
    var totalLT = Math.max(0,
      (cfg.salePrice || 0) - (cfg.costBasis || 0) - (cfg.acceleratedDepreciation || 0) - stShort);
    var recapture = Math.max(0, cfg.acceleratedDepreciation || 0);
    var totalGain = totalLT + recapture;
    var basis = Math.max(0, cfg.costBasis || 0);

    // recognitionSchedule (deferred path): array of {year, gainRecognized}.
    // For immediate path we synthesize: full gain in Year 1.
    var recSched = (comp.recognitionSchedule && comp.recognitionSchedule.length)
      ? comp.recognitionSchedule
      : comp.rows.map(function (r, idx) {
          return {
            year: r.year,
            gainRecognized: idx === 0 ? totalGain : 0
          };
        });

    var rows = [];
    var cumulativeRecognized = 0;
    var ssBalanceStart = totalGain;
    var prevBrookCum = 0;
    for (var i = 0; i < recSched.length; i++) {
      var rec = recSched[i];
      var year = rec.year || (year1 + i);
      var recThisYear = rec.gainRecognized || 0;
      var ssBalanceEnd = Math.max(0, ssBalanceStart - recThisYear);
      // Cumulative position in Brooklyn at year end.
      // Deferred path: comp.rows carries investmentThisYear (tranche-aware).
      // Immediate path (lump-sum): cfg.investment is the constant Brooklyn
      // deposit — Year 1 receives full sale proceeds and the position holds
      // steady at that level. Falls back to basis + cumulativeRecognized if
      // neither field is available.
      var compRow = comp.rows[i] || {};
      var brookCum;
      if (compRow.investmentThisYear != null) {
        brookCum = compRow.investmentThisYear;
      } else if (Number(cfg.investment) > 0) {
        brookCum = Number(cfg.investment);
      } else {
        brookCum = (i === 0 ? basis : basis + cumulativeRecognized);
      }
      // NEW investment for THIS year = increment over prior year's
      // cumulative. Year 1 = the initial basis cash (or whatever Y1
      // amount the engine chose). Subsequent years = the released
      // tranche reinvested same year.
      var newInvested = Math.max(0, brookCum - prevBrookCum);
      // Implementation date: Year 1 honors the user's chosen date so
      // partial-year fee proration lines up with the cashflow display.
      // Tranche years are released on Jan 1 (consistent with the
      // engine's model of full-year same-year reinvestment).
      var assumedDate = (i === 0 && cfg.implementationDate)
        ? cfg.implementationDate
        : (year + '-01-01');
      rows.push({
        year: year,
        assumedDate: assumedDate,
        newInvested: newInvested,
        cumulative: brookCum,
        ssBalanceStart: ssBalanceStart,
        ssBalanceEnd: ssBalanceEnd,
        gainRecognized: recThisYear,
        recognizedDate: recThisYear > 0 ? ('Jan 1, ' + year) : ''
      });
      cumulativeRecognized += recThisYear;
      ssBalanceStart = ssBalanceEnd;
      prevBrookCum = brookCum;
    }
    return rows;
  }

  function _buildBrooklynTable(rows) {
    if (!rows.length) return '';
    var head = '<thead><tr>' +
      '<th>Year</th>' +
      '<th>Date Implemented</th>' +
      '<th>New Investment</th>' +
      '<th>Cumulative Position</th>' +
    '</tr></thead>';
    var body = '<tbody>';
    rows.forEach(function (r) {
      var newCell = r.newInvested > 0
        ? _fmt(r.newInvested)
        : '—';
      var dateCell = r.newInvested > 0 ? _fmtDate(r.assumedDate, r.year) : '—';
      body += '<tr>' +
        '<td>' + r.year + '</td>' +
        '<td>' + dateCell + '</td>' +
        '<td>' + newCell + '</td>' +
        '<td>' + _fmt(r.cumulative) + '</td>' +
      '</tr>';
    });
    // No Total row — the last row's Cumulative Position already shows
    // the total deployed across the horizon, by construction.
    body += '</tbody>';
    return head + body;
  }

  function _buildStructuredSaleTable(rows) {
    if (!rows.length) return '';
    var head = '<thead><tr>' +
      '<th>Year</th>' +
      '<th>Locked at Year Start</th>' +
      '<th>Released Jan 1</th>' +
      '<th>Locked at Year End</th>' +
    '</tr></thead>';
    var body = '<tbody>';
    rows.forEach(function (r) {
      var releasedCell = r.gainRecognized > 0
        ? _fmt(r.gainRecognized) + ' <span class="muted">(' + r.recognizedDate + ')</span>'
        : '—';
      body += '<tr>' +
        '<td>' + r.year + '</td>' +
        '<td>' + _fmt(r.ssBalanceStart) + '</td>' +
        '<td>' + releasedCell + '</td>' +
        '<td>' + _fmt(r.ssBalanceEnd) + '</td>' +
      '</tr>';
    });
    body += '</tbody>';
    return head + body;
  }

  // Build a banner that shows when the user's intended Year-1 deposit
  // is below the custodian's strategy minimum. Returns '' when not
  // below min. Compares to the user's INTENT (cfg.investment) rather
  // than rows[0].newInvested so a "no-action" result for a different
  // reason (no gain to offset) doesn't false-positive into a min
  // warning that doesn't apply.
  function _buildMinimumBanner(cfg, rows) {
    if (!rows.length) return '';
    var custodianId = cfg.custodian || (document.getElementById('custodian-select') || {}).value || '';
    var stratKey = cfg.tierKey || cfg.strategyKey || (document.getElementById('strategy-select') || {}).value || 'beta1';
    if (!custodianId || typeof root.getMinInvestment !== 'function') return '';
    var minInv = root.getMinInvestment(custodianId, stratKey);
    if (!minInv) return '';
    // User intent: what they typed in the Available Capital input.
    // Falls back to the engine's first-year deposit only if no input.
    var userIntent = Number(cfg.investment || 0)
      || Number((document.getElementById('available-capital') || {}).value || 0);
    if (!userIntent) return '';
    if (userIntent >= minInv) return '';
    // User intent is real and below the min — this is a true warning.
    return '<div class="rett-min-warning" role="alert" style="' +
        'background:#fff5e6;border:1px solid #f0b041;border-radius:6px;' +
        'padding:10px 14px;margin:18px 0 0 0;color:#5a3b00;' +
      '">' +
        '<strong>Below custodian minimum.</strong> ' +
        'The Year-1 deposit of ' + _fmt(userIntent) + ' is below the ' +
        'minimum of ' + _fmt(minInv) + ' required to open a Brooklyn ' +
        'position with the chosen strategy. The schedule below shows ' +
        'planned cashflows; the position cannot actually be opened until ' +
        'the deposit reaches the minimum.' +
      '</div>';
  }

  // Detect when the engine chose immediate Year-1 recognition (no
  // structured-sale lockup needed). Lump-sum requires BOTH:
  //   1. ALL gain recognized in Year 1 (recognitionSchedule has it
  //      concentrated there, OR comp is the immediate-path shape with
  //      no recognitionSchedule + cfg.recognitionStartYearIndex===0).
  //   2. No new Brooklyn deposit in Year 2 or later — if there's a
  //      tranche release in Y2+, that's a structured sale by
  //      definition, regardless of what the recognition schedule says.
  // Both conditions must hold. When this returns true, the
  // structured-sale schedule is replaced with a "no structured sale
  // needed" callout.
  function _isLumpSum(cfg, comp, rows) {
    if (!comp) return false;
    var allRecogInY1 = false;
    if (Array.isArray(comp.recognitionSchedule) && comp.recognitionSchedule.length) {
      var firstRec = comp.recognitionSchedule[0];
      var totalRec = comp.recognitionSchedule.reduce(function (s, r) {
        return s + (r.gainRecognized || 0);
      }, 0);
      allRecogInY1 = totalRec > 0 && firstRec &&
        firstRec.gainRecognized >= totalRec - 0.01;
    } else if (cfg && (cfg.recognitionStartYearIndex === 0 || cfg.recognitionStartYearIndex == null) &&
               !comp.deferred) {
      // Immediate-path comp shape (no schedule, no deferred flag).
      allRecogInY1 = true;
    }
    if (!allRecogInY1) return false;
    // Second gate: no new Brooklyn deposit after Year 1. Any positive
    // newInvested in Y2+ contradicts the lump-sum framing — that capital
    // is arriving from a structured-sale tranche release.
    if (Array.isArray(rows) && rows.length > 1) {
      for (var i = 1; i < rows.length; i++) {
        if ((rows[i].newInvested || 0) > 0.5) return false;
      }
    }
    return true;
  }

  function renderCashflowSchedule(host) {
    host = host || document.getElementById('cashflow-schedule-host');
    if (!host) return;
    var result = window.__lastResult;
    var comp = window.__lastComparison;
    if (!result || !result.years || !result.years.length || !comp) {
      host.innerHTML = '';
      return;
    }
    var cfg = result.config || {};
    // Patch in the property-sale fields (the projection-engine result
    // doesn't always carry them on cfg).
    cfg.salePrice = cfg.salePrice
      || Number((document.getElementById('sale-price') || {}).value) || 0;
    cfg.costBasis = cfg.costBasis
      || Number((document.getElementById('cost-basis') || {}).value) || 0;
    cfg.acceleratedDepreciation = cfg.acceleratedDepreciation
      || Number((document.getElementById('accelerated-depreciation') || {}).value) || 0;
    cfg.implementationDate = cfg.implementationDate
      || (document.getElementById('implementation-date') || {}).value || '';
    cfg.baseShortTermGain = cfg.baseShortTermGain
      || Number((document.getElementById('short-term-gain') || {}).value) || 0;

    var rows = _buildScheduleRows(cfg, comp, result.years);
    if (!rows.length) {
      host.innerHTML = '';
      return;
    }

    // Total locked in the structured sale = LT capital gain + recapture.
    var _stShortSub = Math.max(0, cfg.baseShortTermGain || 0);
    var _totalLT = Math.max(0,
      (cfg.salePrice || 0) - (cfg.costBasis || 0) - (cfg.acceleratedDepreciation || 0) - _stShortSub);
    var totalGain = _totalLT + Math.max(0, cfg.acceleratedDepreciation || 0);

    var lumpSum = _isLumpSum(cfg, comp, rows);
    var brookSub = lumpSum
      ? 'Lump-sum scenario: the full sale proceeds are received at close and deployed into Brooklyn in Year 1 — no structured-sale lockup, no later tranche releases.'
      : 'New capital deployed each year — basis cash on engagement plus structured-sale tranche releases. Each row shows the assumed implementation date for that year’s deposit and the cumulative position for context.';

    var ssSection;
    if (lumpSum) {
      // Replace the structured-sale schedule with a callout. The
      // seller takes a lump-sum payment at close; Brooklyn losses
      // absorb the gain in Year 1, so there's nothing to schedule.
      ssSection = '<h3 class="section-title" style="margin-top:24px;">Structured Sale</h3>' +
        '<div class="rett-no-structured-sale" role="note" style="' +
          'background:rgba(15, 76, 129, 0.18);border:1px solid rgba(26, 58, 110, 0.6);' +
          'border-radius:6px;padding:12px 16px;color:#cfe1ff;' +
        '">' +
          '<strong>No structured sale needed.</strong> ' +
          'The optimizer found that taking a lump-sum payment at close and deploying the full ' +
          _fmt(totalGain) +
          ' gain into Brooklyn in Year 1 produces the highest net benefit. ' +
          'Brooklyn’s Year-1 losses absorb the recognized gain immediately — no 18-month or two-year hold-up required.' +
        '</div>';
    } else {
      var ssSub = 'Total gain held in the structured-sale agreement (' + _fmt(totalGain) + '). ' +
        'Releases happen on Jan 1 of each scheduled year so the cash works in Brooklyn for the full following year.';
      ssSection = _section('Structured-Sale Schedule', _buildStructuredSaleTable(rows), ssSub);
    }

    host.innerHTML =
      _buildMinimumBanner(cfg, rows) +
      _section('Brooklyn Investment Schedule', _buildBrooklynTable(rows), brookSub) +
      ssSection;
  }

  root.renderCashflowSchedule = renderCashflowSchedule;
})(window);
