// FILE: js/02-tax-engine/tax-comparison.js
// Side-by-side baseline vs. post-strategy tax. Per-year, multi-year aware.
//
// Per-year scenario shape used by computeFederalTaxBreakdown / computeStateTax:
//   { year, status, state, ordinaryIncome, shortTermGain, longTermGain,
//     qualifiedDividend, investmentIncome, wages, itemized }
//
// Brooklyn-generated losses are SHORT-TERM. They offset short-term gain first,
// then ordinary income up to a yearly cap (default $3,000 if unused capital
// loss carryforward applies; for our use-case the loss is structured against
// the full ordinary income from the property gain in the year it is realized,
// so we apply the loss to ordinary first, then short-term gain).

function _baseScenarioForYear(cfg, yr, gainTakenThisYear) {
      // gainTakenThisYear is the long-term gain recognized in this year of
      // the structured sale. For single-year recommendations, year-1 gets
      // the full longTermGain. For multi-year, the engine spreads it.
      const idx = yr - cfg.year1;
      const ordOverride = (cfg.ordinaryByYear   && cfg.ordinaryByYear[idx]   != null) ? cfg.ordinaryByYear[idx]   : cfg.baseOrdinaryIncome;
      const shortOverride = (cfg.shortGainByYear && cfg.shortGainByYear[idx] != null) ? cfg.shortGainByYear[idx] : (cfg.baseShortTermGain || 0);
      const longOverride  = (cfg.longGainByYear  && cfg.longGainByYear[idx]  != null) ? cfg.longGainByYear[idx]  : 0;
      const ltAmt = (gainTakenThisYear != null ? gainTakenThisYear : 0) + longOverride;
      return {
            year: yr,
            status: cfg.filingStatus,
            state: cfg.state,
            ordinaryIncome: ordOverride,
            shortTermGain: shortOverride,
            longTermGain: ltAmt,
            qualifiedDividend: 0,
            investmentIncome: ltAmt,
            wages: ordOverride,
            itemized: cfg.itemized || 0
      };
}

function _yearTaxes(scenario) {
      const fed   = computeFederalTaxBreakdown(
            scenario.ordinaryIncome + scenario.shortTermGain,
            scenario.year, scenario.status,
            { longTermGain: scenario.longTermGain, qualifiedDividend: scenario.qualifiedDividend,
              investmentIncome: scenario.investmentIncome, wages: scenario.wages,
              itemized: scenario.itemized });
      const stateTax = computeStateTax(
            scenario.ordinaryIncome + scenario.shortTermGain + scenario.longTermGain + scenario.qualifiedDividend,
            scenario.year, scenario.state, scenario.status,
            { itemized: scenario.itemized, longTermGain: scenario.longTermGain });
      return {
            federal: fed.total,
            ordinaryTax: fed.ordinaryTax,
            ltTax: fed.ltTax,
            amt: fed.amtTopUp,
            niit: fed.niit,
            addlMedicare: fed.addlMedicare,
            state: stateTax,
            total: fed.total + stateTax
      };
}

function _applyLossesToScenario(scenario, lossAvailable) {
      // Brooklyn-generated losses are SHORT-TERM. IRS netting rules:
      //   1) Short-term loss first offsets short-term gain (netted at ST level).
      //   2) Net ST loss then offsets long-term gain dollar-for-dollar.
      //   3) Any remaining net loss offsets ordinary income (subject to the
      //      $3,000/yr personal cap, but for a structured-sale strategy we
      //      apply the loss to ordinary up to the offset capacity since the
      //      loss is sized specifically against the property recognition).
      const out = Object.assign({}, scenario);
      let loss = lossAvailable;

      // Step 1: against short-term gain
      const offsetShort = Math.min(out.shortTermGain || 0, loss);
      out.shortTermGain = (out.shortTermGain || 0) - offsetShort;
      loss -= offsetShort;

      // Step 2: against long-term gain (qualified div NOT a capital gain;
      // it's taxed at LTCG rates but loss netting only applies to actual gains)
      if (loss > 0) {
            const offsetLong = Math.min(out.longTermGain || 0, loss);
            out.longTermGain = (out.longTermGain || 0) - offsetLong;
            // investmentIncome should track LTG since NIIT applies to net inv income
            out.investmentIncome = Math.max(0, (out.investmentIncome || 0) - offsetLong);
            loss -= offsetLong;
      }

      // Step 3: against ordinary income
      if (loss > 0) {
            const offsetOrd = Math.min(out.ordinaryIncome || 0, loss);
            out.ordinaryIncome = (out.ordinaryIncome || 0) - offsetOrd;
            // Wages can't go below new ordinary income (Additional Medicare base)
            out.wages = Math.min(out.wages || 0, out.ordinaryIncome);
            loss -= offsetOrd;
      }

      out._lossUsed = lossAvailable - loss;
      out._lossUnused = loss;
      return out;
}

function computeTaxComparison(cfg, recommendation) {
      const horizon = cfg.horizonYears || 5;
      const rows = [];
      for (let i = 0; i < horizon; i++) {
            const yr = cfg.year1 + i;
            let gainThisYear = 0;
            let lossThisYear = 0;

            if (recommendation && recommendation.recommendation === 'single-year') {
                  if (i === 0) {
                        gainThisYear = recommendation.longTermGain || 0;
                        lossThisYear = recommendation.lossGenerated || 0;
                  }
            } else if (recommendation && (recommendation.recommendation === 'multi-year' || recommendation.recommendation === 'multi-year-shortfall')) {
                  const sched = recommendation.schedule || recommendation.years || [];
                  const slot = sched[i];
                  if (slot) {
                        gainThisYear = slot.gainTaken || slot.gain || 0;
                        lossThisYear = slot.lossGenerated || slot.loss || 0;
                  }
            }

            const baseline = _baseScenarioForYear(cfg, yr, gainThisYear);
            const baselineTax = _yearTaxes(baseline);
            const withStrat = _applyLossesToScenario(baseline, lossThisYear);
            const withStratTax = _yearTaxes(withStrat);

            rows.push({
                  year: yr,
                  gainRecognized: gainThisYear,
                  lossApplied: lossThisYear,
                  baseline: baselineTax,
                  withStrategy: withStratTax,
                  savings: baselineTax.total - withStratTax.total
            });
      }

      let totalBaseline = 0, totalWith = 0;
      rows.forEach(r => { totalBaseline += r.baseline.total; totalWith += r.withStrategy.total; });
      return {
            rows: rows,
            totalBaseline: totalBaseline,
            totalWithStrategy: totalWith,
            totalSavings: totalBaseline - totalWith
      };
}

function _fmtUSD(n) {
      if (typeof n !== 'number' || !isFinite(n)) return '-';
      const sign = n < 0 ? '-' : '';
      return sign + '$' + Math.abs(Math.round(n)).toLocaleString();
}

function renderTaxComparison(host, comparison) {
      if (!host) return;
      if (!comparison || !comparison.rows || !comparison.rows.length) {
            host.innerHTML = '<p class="subtitle">Run the Decision Engine on the Projection page to populate the tax comparison.</p>';
            return;
      }
      const yrs = comparison.rows.map(r => '<th>Y' + (r.year - comparison.rows[0].year + 1) + ' (' + r.year + ')</th>').join('');
      const cellsBaseline = comparison.rows.map(r => '<td>' + _fmtUSD(r.baseline.total) + '</td>').join('');
      const cellsWith     = comparison.rows.map(r => '<td>' + _fmtUSD(r.withStrategy.total) + '</td>').join('');
      const cellsSavings  = comparison.rows.map(r => '<td>' + _fmtUSD(r.savings) + '</td>').join('');
      const cellsLoss     = comparison.rows.map(r => '<td>' + _fmtUSD(r.lossApplied) + '</td>').join('');
      const cellsGain     = comparison.rows.map(r => '<td>' + _fmtUSD(r.gainRecognized) + '</td>').join('');

      const fedRows = comparison.rows.map(r => '<td>' + _fmtUSD(r.baseline.federal) + '</td>').join('');
      const stRows  = comparison.rows.map(r => '<td>' + _fmtUSD(r.baseline.state) + '</td>').join('');
      const niitRow = comparison.rows.map(r => '<td>' + _fmtUSD(r.baseline.niit) + '</td>').join('');
      const medRow  = comparison.rows.map(r => '<td>' + _fmtUSD(r.baseline.addlMedicare) + '</td>').join('');

      host.innerHTML =
            '<table class="tax-comparison-table">' +
            '<thead><tr><th>Line Item</th>' + yrs + '<th>Total</th></tr></thead>' +
            '<tbody>' +
            '<tr class="grp-head"><td colspan="' + (comparison.rows.length + 2) + '">Sale Activity</td></tr>' +
            '<tr><td>Long-term gain recognized</td>' + cellsGain + '<td>' + _fmtUSD(comparison.rows.reduce((a,r)=>a+r.gainRecognized,0)) + '</td></tr>' +
            '<tr><td>Brooklyn loss applied</td>' + cellsLoss + '<td>' + _fmtUSD(comparison.rows.reduce((a,r)=>a+r.lossApplied,0)) + '</td></tr>' +
            '<tr class="grp-head"><td colspan="' + (comparison.rows.length + 2) + '">Without Strategy (Baseline)</td></tr>' +
            '<tr><td>Federal tax</td>' + fedRows + '<td>' + _fmtUSD(comparison.rows.reduce((a,r)=>a+r.baseline.federal,0)) + '</td></tr>' +
            '<tr><td>State tax</td>' + stRows + '<td>' + _fmtUSD(comparison.rows.reduce((a,r)=>a+r.baseline.state,0)) + '</td></tr>' +
            '<tr><td>NIIT (3.8%)</td>' + niitRow + '<td>' + _fmtUSD(comparison.rows.reduce((a,r)=>a+r.baseline.niit,0)) + '</td></tr>' +
            '<tr><td>Additional Medicare (0.9%)</td>' + medRow + '<td>' + _fmtUSD(comparison.rows.reduce((a,r)=>a+r.baseline.addlMedicare,0)) + '</td></tr>' +
            '<tr class="row-total"><td><strong>Total tax (baseline)</strong></td>' + cellsBaseline + '<td><strong>' + _fmtUSD(comparison.totalBaseline) + '</strong></td></tr>' +
            '<tr class="grp-head"><td colspan="' + (comparison.rows.length + 2) + '">With Brooklyn Strategy</td></tr>' +
            '<tr class="row-total"><td><strong>Total tax (with strategy)</strong></td>' + cellsWith + '<td><strong>' + _fmtUSD(comparison.totalWithStrategy) + '</strong></td></tr>' +
            '<tr class="row-savings"><td><strong>Tax savings</strong></td>' + cellsSavings + '<td><strong>' + _fmtUSD(comparison.totalSavings) + '</strong></td></tr>' +
            '</tbody></table>';
}
