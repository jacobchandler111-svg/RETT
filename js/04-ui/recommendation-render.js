// FILE: js/04-ui/recommendation-render.js
// Renders the decision-engine recommendation into #recommendation-panel and
// also into the #year-schedule rows when a multi-year fallback is needed.
// Wires the "Run Decision Engine" button (#run-projection) so clicking it
// reads the property-sale inputs, calls recommendSale, and renders.

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
      salePrice:       num('sale-price'),
      costBasis:       num('cost-basis'),
      strategyKey:     txt('tier-key'),
      investedCapital: num('investment'),
      leverageCap:     num('leverage-cap'),
      horizonYears:    parseInt(txt('horizon-years'), 10) || 5,
      distribution:    txt('distribution') || 'even',
      year1:           parseInt(txt('year1'), 10) || 2025
    };
  }

  function updateGainDisplay() {
    const sp = parseFloat((document.getElementById('sale-price') || {}).value);
    const cb = parseFloat((document.getElementById('cost-basis') || {}).value);
    const out = document.getElementById('computed-gain');
    if (!out) return;
    if (isNaN(sp) || isNaN(cb)) { out.value = ''; return; }
    out.value = fmtMoney(sp - cb);
  }

  function renderRecommendation(result, cfg) {
    const panel = document.getElementById('recommendation-panel');
    if (!panel) return;
    if (!result) { panel.innerHTML = ''; return; }

    const lines = [];
    lines.push('<div class="recommendation">');
    lines.push('<h3>Decision Engine Recommendation</h3>');
    lines.push('<div class="rec-row"><span class="rec-label">Total long-term gain:</span> <strong>' + fmtMoney(result.gain) + '</strong></div>');

    // Stage 1 explanation.
    const s1 = result.stage1;
    lines.push('<h4>Stage 1: Single-Year Wipeout</h4>');
    if (!s1) {
      lines.push('<div>(skipped)</div>');
    } else if (s1.error) {
      lines.push('<div class="rec-error">Error: ' + s1.error + '</div>');
    } else if (s1.feasible) {
      lines.push('<div>Feasible at leverage <strong>' + (s1.leverageLabel || s1.leverage) + '</strong> ' +
                 '(loss rate ' + fmtPct(s1.lossRate, 2) + ', generates ' + fmtMoney(s1.lossGenerated) + ' of short-term loss).</div>');
      lines.push('<div>Estimated annual fee: ' + fmtMoney(s1.feeDollar) + ' (' + fmtPct(s1.feeRate, 2) + ').</div>');
      lines.push('<div>Min investment for this tier: ' + fmtMoney(s1.minInvestment) + '.</div>');
    } else {
      lines.push('<div class="rec-warning">Even at the maximum leverage tier (' + (s1.leverageLabel || s1.leverage) + ') invested capital can only generate ' + fmtMoney(s1.lossGenerated) + ' of loss — short by ' + fmtMoney(s1.gap) + '.</div>');
    }

    // Stage-1 cap check.
    const cap = (cfg.leverageCap == null) ? Infinity : cfg.leverageCap;
    if (s1 && s1.feasible) {
      if (s1.leverage <= cap + 1e-9) {
        lines.push('<div class="rec-good">Required leverage is at or below your cap (' + fmtPct(cap) + '). <strong>Recommendation: single-year sale.</strong></div>');
      } else {
        lines.push('<div class="rec-warning">Required leverage (' + (s1.leverageLabel || '') + ') EXCEEDS your cap of ' + fmtPct(cap) + '. Falling through to multi-year structured-sale.</div>');
      }
    }

    // Stage 2 if it ran.
    const s2 = result.stage2;
    if (s2) {
      lines.push('<h4>Stage 2: Multi-Year Structured Sale</h4>');
      if (s2.error) {
        lines.push('<div class="rec-error">Error: ' + s2.error + '</div>');
      } else if (s2.feasible) {
        lines.push('<div>At the cap leverage (loss rate ' + fmtPct(s2.capLossRate, 2) + '), invested capital absorbs ' + fmtMoney(s2.lossPerYearAtCap) + ' of gain per year.</div>');
        lines.push('<div>Years needed: <strong>' + s2.yearsNeeded + '</strong> (using ' + s2.yearsUsed + ' of ' + cfg.horizonYears + ').</div>');
      } else {
        lines.push('<div class="rec-error">INFEASIBLE within ' + cfg.horizonYears + '-year horizon at this cap. Shortfall: ' + fmtMoney(s2.shortfall) + '. Either raise the leverage cap, increase invested capital, or extend the horizon.</div>');
      }
    }

    // Per-year breakdown.
    if (result.summary && result.summary.gainByYear) {
      lines.push('<h4>Year-by-Year Plan</h4>');
      lines.push('<table class="rec-table"><thead><tr><th>Year</th><th>Gain Recognized</th><th>Loss Needed</th><th>Leverage</th></tr></thead><tbody>');
      const gby = result.summary.gainByYear;
      const lby = result.summary.leverageByYear || gby.map(()=> result.summary.leverageUsed);
      for (let i = 0; i < gby.length; i++) {
        const yr = (cfg.year1 || 2025) + i;
        const gain = gby[i];
        if (gain <= 0 && i > 0) continue;
        const lev = lby[i];
        const levLabel = (typeof leverageLabelFor === 'function')
          ? leverageLabelFor(cfg.strategyKey, lev)
          : (lev === 0 ? 'Long-Only' : (lev * 100).toFixed(0) + '%');
        lines.push('<tr><td>' + yr + '</td><td>' + fmtMoney(gain) + '</td><td>' + fmtMoney(gain) + '</td><td>' + levLabel + '</td></tr>');
      }
      lines.push('</tbody></table>');
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
    if (cfg.salePrice == null || cfg.costBasis == null) {
      const panel = document.getElementById('recommendation-panel');
      if (panel) panel.innerHTML = '<div class="rec-warning">Enter sale price and cost basis to run the decision engine.</div>';
      return;
    }
    if (cfg.investedCapital == null || cfg.investedCapital <= 0) {
      const panel = document.getElementById('recommendation-panel');
      if (panel) panel.innerHTML = '<div class="rec-warning">Enter Brooklyn invested capital to run the decision engine.</div>';
      return;
    }
    const result = recommendSale(cfg);
    renderRecommendation(result, cfg);
    pushScheduleToYearRows(result, cfg);
    window.__lastDecisionResult = result;
  }

  function bind() {
    const sp = document.getElementById('sale-price');
    const cb = document.getElementById('cost-basis');
    if (sp) sp.addEventListener('input', updateGainDisplay);
    if (cb) cb.addEventListener('input', updateGainDisplay);
    updateGainDisplay();

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
