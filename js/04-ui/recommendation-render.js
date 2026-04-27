// FILE: js/04-ui/recommendation-render.js
// Renders the decision-engine recommendation. Reads property-sale inputs
// including accelerated depreciation and implementation date, computes
// time-weighting, and pushes per-year results into the year-schedule rows.

(function () {

  function fmtMoney(n) {
    if (n == null || isNaN(n)) return '-';
    const sign = n < 0 ? '-' : '';
    const a = Math.abs(n);
    return sign + '$' + a.toLocaleString('en-US', { maximumFractionDigits: 0 });
  }
  function fmtPct(x, digits) {
    if (x == null || isNaN(x)) return '-';
    return (x * 100).toFixed(digits == null ? 1 : digits) + '%';
  }

  function readSaleInputs() {
    const num = id => {
      const v = document.getElementById(id);
      if (!v) return null;
      const n = parseFloat(v.value);
      return isNaN(n) ? null : n;
    };
    const txt = id => (document.getElementById(id) || {}).value || '';
    return {
      salePrice:               num('sale-price'),
      costBasis:               num('cost-basis'),
      acceleratedDepreciation: num('accelerated-depreciation') || 0,
      strategyKey:             txt('tier-key'),
      investedCapital:         num('investment'),
      leverageCap:             num('leverage-cap'),
      horizonYears:            parseInt(txt('horizon-years'), 10) || 5,
      distribution:            txt('distribution') || 'even',
      year1:                   parseInt(txt('year1'), 10) || 2025,
      implementationDate:      txt('implementation-date')
    };
  }

  function updateGainDisplay() {
    const sp = parseFloat((document.getElementById('sale-price') || {}).value);
    const cb = parseFloat((document.getElementById('cost-basis') || {}).value);
    const ad = parseFloat((document.getElementById('accelerated-depreciation') || {}).value) || 0;
    const out  = document.getElementById('computed-gain');
    const out2 = document.getElementById('computed-total-taxable');
    const ltg = (!isNaN(sp) && !isNaN(cb)) ? Math.max(0, sp - cb) : null;
    if (out)  out.value  = ltg == null ? '' : fmtMoney(ltg);
    if (out2) out2.value = ltg == null ? '' : fmtMoney(ltg + ad);
  }

  function updateYearFractionDisplay() {
    const dateStr = (document.getElementById('implementation-date') || {}).value;
    const out = document.getElementById('year-fraction-remaining');
    if (!out) return;
    if (!dateStr || typeof yearFractionRemaining !== 'function') {
      out.value = '';
      return;
    }
    const yf = yearFractionRemaining(dateStr);
    out.value = fmtPct(yf, 1) + ' of year remaining';
  }

  function renderRecommendation(result, cfg) {
    const panel = document.getElementById('recommendation-panel');
    if (!panel) return;
    if (!result) { panel.innerHTML = ''; return; }

    const lines = [];
    lines.push('<div class="recommendation">');
    lines.push('<h3>Decision Engine Recommendation</h3>');
    lines.push('<div class="rec-row"><span class="rec-label">Long-term capital gain:</span> <strong>' + fmtMoney(result.longTermGain) + '</strong></div>');
    if (result.recapture > 0) {
      lines.push('<div class="rec-row"><span class="rec-label">Accelerated depreciation recapture (ordinary):</span> <strong>' + fmtMoney(result.recapture) + '</strong></div>');
    }
    lines.push('<div class="rec-row"><span class="rec-label">Total taxable to offset:</span> <strong>' + fmtMoney(result.gain) + '</strong></div>');
    lines.push('<div class="rec-row"><span class="rec-label">Year-1 fraction (time-weight):</span> <strong>' + fmtPct(result.yearFraction, 1) + '</strong></div>');

    const s1 = result.stage1;
    lines.push('<h4>Stage 1: Single-Year Wipeout</h4>');
    if (!s1) {
      lines.push('<div>(skipped)</div>');
    } else if (s1.error) {
      lines.push('<div class="rec-error">' + s1.error + '</div>');
    } else if (s1.feasible) {
      const annual = (s1.annualLossRate != null) ? s1.annualLossRate : s1.lossRate;
      lines.push('<div>Feasible at leverage <strong>' + (s1.leverageLabel || s1.leverage) + '</strong>.</div>');
      lines.push('<div>Annual loss rate ' + fmtPct(annual, 2) + ' × year-1 fraction ' + fmtPct(result.yearFraction, 1) +
                 ' = effective ' + fmtPct(s1.effectiveLossRate || (annual * result.yearFraction), 2) + '.</div>');
      lines.push('<div>Generates <strong>' + fmtMoney(s1.lossGenerated) + '</strong> of short-term loss.</div>');
      lines.push('<div>Year-1 fee (time-weighted): ' + fmtMoney(s1.feeDollar) + ' (' + fmtPct(s1.feeRate, 2) + ' annual).</div>');
      lines.push('<div>Min investment for this tier: ' + fmtMoney(s1.minInvestment) + '.</div>');
    } else {
      lines.push('<div class="rec-warning">Even at the maximum tier (' + (s1.leverageLabel || s1.leverage) + ') invested capital generates only ' + fmtMoney(s1.lossGenerated) + ' of loss — short by ' + fmtMoney(s1.gap) + ' (year-fraction ' + fmtPct(result.yearFraction, 1) + ').</div>');
    }

    const cap = (cfg.leverageCap == null) ? Infinity : cfg.leverageCap;
    if (s1 && s1.feasible) {
      if (s1.leverage <= cap + 1e-9) {
        lines.push('<div class="rec-good">Required leverage is at or below your cap (' + fmtPct(cap) + '). <strong>Recommendation: single-year sale.</strong></div>');
      } else {
        lines.push('<div class="rec-warning">Required leverage (' + (s1.leverageLabel || '') + ') EXCEEDS your cap of ' + fmtPct(cap) + '. Falling through to multi-year structured-sale.</div>');
      }
    }

    const s2 = result.stage2;
    if (s2) {
      lines.push('<h4>Stage 2: Multi-Year Structured Sale</h4>');
      if (s2.error) {
        lines.push('<div class="rec-error">' + s2.error + '</div>');
      } else {
        lines.push('<div>At cap leverage the annual loss capacity is ' + fmtMoney(s2.annualCap) + '.</div>');
        if (s2.capByYear && s2.capByYear[0] !== s2.annualCap) {
          lines.push('<div>Year-1 capacity is reduced to ' + fmtMoney(s2.capByYear[0]) + ' by the time-weight (' + fmtPct(result.yearFraction, 1) + ').</div>');
        }
        if (s2.feasible) {
          lines.push('<div>Years used: <strong>' + s2.yearsUsed + '</strong> of ' + cfg.horizonYears + '.</div>');
        } else {
          lines.push('<div class="rec-error">INFEASIBLE within ' + cfg.horizonYears + '-year horizon at this cap. Shortfall: ' + fmtMoney(s2.shortfall) + '. Either raise the leverage cap, increase invested capital, extend the horizon, or push the implementation date earlier.</div>');
        }
      }
    }

    if (result.summary && result.summary.gainByYear) {
      lines.push('<h4>Year-by-Year Plan</h4>');
      lines.push('<table class="rec-table"><thead><tr><th>Year</th><th>Gain Recognized</th><th>Loss Needed</th><th>Capacity</th><th>Leverage</th></tr></thead><tbody>');
      const gby = result.summary.gainByYear;
      const lby = result.summary.leverageByYear || gby.map(()=> result.summary.leverageUsed);
      const cby = result.summary.capByYear || gby.map(()=> null);
      let any = false;
      for (let i = 0; i < gby.length; i++) {
        const yr = (cfg.year1 || 2025) + i;
        const gain = gby[i];
        if (gain <= 0 && i > 0) continue;
        any = true;
        const lev = lby[i];
        const levLabel = (typeof leverageLabelFor === 'function')
          ? leverageLabelFor(cfg.strategyKey, lev)
          : (lev === 0 ? 'Long-Only' : (lev * 100).toFixed(0) + '%');
        const capCell = (cby[i] != null) ? fmtMoney(cby[i]) : '-';
        lines.push('<tr><td>' + yr + '</td><td>' + fmtMoney(gain) + '</td><td>' + fmtMoney(gain) + '</td><td>' + capCell + '</td><td>' + levLabel + '</td></tr>');
      }
      if (!any) lines.push('<tr><td colspan="5">(no recognition planned)</td></tr>');
      lines.push('</tbody></table>');
    }

    if (result.summary && result.summary.totalFees != null) {
      lines.push('<div class="rec-row"><span class="rec-label">Total Brooklyn fees (across plan):</span> <strong>' + fmtMoney(result.summary.totalFees) + '</strong></div>');
    }

    lines.push('</div>');
    panel.innerHTML = lines.join('\n');
  }

  function pushScheduleToYearRows(result, cfg) {
    const host = document.getElementById('year-schedule');
    if (!host || !result || !result.summary || !result.summary.gainByYear) return;
    if (host.children.length === 0) {
      const btn = document.getElementById('build-year-schedule');
      if (btn) btn.click();
    }
    const rows = host.querySelectorAll('.year-row');
    const gby = result.summary.gainByYear;
    rows.forEach((row, i) => {
      const lg = row.querySelector('[data-field="long-gain"]');
      if (lg && gby[i] != null) lg.value = String(Math.round(gby[i]));
    });
  }

  function runEngine() {
    const cfg = readSaleInputs();
    const panel = document.getElementById('recommendation-panel');
    if (cfg.salePrice == null || cfg.costBasis == null) {
      if (panel) panel.innerHTML = '<div class="recommendation rec-warning">Enter sale price and cost basis to run the decision engine.</div>';
      return;
    }
    if (cfg.investedCapital == null || cfg.investedCapital <= 0) {
      if (panel) panel.innerHTML = '<div class="recommendation rec-warning">Enter Brooklyn invested capital to run the decision engine.</div>';
      return;
    }
    const result = recommendSale(cfg);
    renderRecommendation(result, cfg);
    pushScheduleToYearRows(result, cfg);
    window.__lastDecisionResult = result;
  }

  function bind() {
    ['sale-price','cost-basis','accelerated-depreciation'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.addEventListener('input', updateGainDisplay);
    });
    updateGainDisplay();

    const dt = document.getElementById('implementation-date');
    if (dt) dt.addEventListener('input', updateYearFractionDisplay);
    updateYearFractionDisplay();

    const run = document.getElementById('run-projection');
    if (run) run.addEventListener('click', runEngine);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bind);
  } else {
    bind();
  }

  window.runDecisionEngine = runEngine;
})();
