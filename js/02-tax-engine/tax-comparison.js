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

// ============================================================
// Deferred-recognition comparison.
// Models a structured-sale scenario where:
//   - Year 1: cost-basis cash is invested in Brooklyn (gain locked up
//     in a structured-sale agreement with an insurance company).
//   - Years 1..(R-1): Brooklyn generates short-term losses with no
//     gain to absorb them. Per IRS rules, only $3,000 of those losses
//     can offset ordinary income each year; the rest carries forward
//     as short-term capital loss.
//   - Year R onwards: a portion of the gain is paid out (Jan 1 so it
//     gets a full year of fresh STL). The accumulated CF + same-year
//     Brooklyn loss offsets the recognized gain. Recognized gain cash
//     is reinvested in Brooklyn as a NEW tranche.
//   - Greedy schedule: each eligible year, recognize as much gain as
//     accumulated capacity will absorb. If gain still remains in the
//     final horizon year, force-recognize the remainder (it gets taxed).
//
// Tranche math: each tranche tracks (capital, startYearIdx). The Year-i
// loss for tranche t = t.capital * lossRate(i - t.startYearIdx). For
// non-Schwab strategies the rate is year-independent (brooklynInterpolate
// returns one number); for Schwab combos the rate comes from the
// combo's lossByYear array indexed by the tranche's age in years.
//
// Returns the same shape as computeTaxComparison plus a deferred:true
// flag and a recognitionSchedule[] for display.

function _applyLossesWithSTCfCap(scenario, lossAvailable, capOrdinary) {
      capOrdinary = capOrdinary != null ? capOrdinary : 3000;
      const out = Object.assign({}, scenario);
      let loss = lossAvailable;

      // Step 1: ST gain (none expected in deferred scenarios but kept for safety).
      const offsetShort = Math.min(out.shortTermGain || 0, loss);
      out.shortTermGain = (out.shortTermGain || 0) - offsetShort;
      loss -= offsetShort;

      // Step 2: LT gain (the recognized property gain in year R).
      if (loss > 0) {
            const offsetLong = Math.min(out.longTermGain || 0, loss);
            out.longTermGain = (out.longTermGain || 0) - offsetLong;
            out.investmentIncome = Math.max(0, (out.investmentIncome || 0) - offsetLong);
            loss -= offsetLong;
      }

      // Step 3: ordinary income, capped at $3,000 (or $1,500 for MFS).
      if (loss > 0) {
            const cap = Math.min(out.ordinaryIncome || 0, capOrdinary);
            const offsetOrd = Math.min(cap, loss);
            out.ordinaryIncome = (out.ordinaryIncome || 0) - offsetOrd;
            out.wages = Math.min(out.wages || 0, out.ordinaryIncome);
            loss -= offsetOrd;
      }

      out._lossUsed = lossAvailable - loss;
      out._lossUnused = loss;
      return out;
}

function computeDeferredTaxComparison(cfg) {
      const horizon = Math.max(1, cfg.horizonYears || cfg.years || 5);
      const startIdx = Math.max(1, Math.min(horizon - 1,
            (cfg.recognitionStartYearIndex != null ? cfg.recognitionStartYearIndex : 1)));
      const ordCap = (cfg.filingStatus === 'mfs') ? 1500 : 3000;

      const totalLT = Math.max(0,
            (cfg.salePrice || 0) - (cfg.costBasis || 0) - (cfg.acceleratedDepreciation || 0));
      const recapture = Math.max(0, cfg.acceleratedDepreciation || 0);
      // For MVP we treat the recapture as part of the deferred LT bucket so
      // the math reflects a structured sale that defers the entire gain
      // recognition. (Recapture is technically ordinary-rate income; this
      // is a known approximation flagged in the UI.)
      const totalGainBucket = totalLT + recapture;
      const basisCash = Math.max(0, cfg.costBasis || 0);

      const combo = (cfg.comboId && typeof getSchwabCombo === 'function')
            ? getSchwabCombo(cfg.comboId) : null;
      const feeRate = combo ? (combo.feeRate || 0) : (function () {
            if (typeof brooklynInterpolate !== 'function') return 0;
            const snap = brooklynInterpolate(cfg.tierKey || 'beta1', cfg.leverage || cfg.leverageCap || 2.25);
            return snap ? (snap.feeRate || 0) : 0;
      })();
      const lossRateForTrancheYear = (function () {
            if (combo && Array.isArray(combo.lossByYear)) {
                  return function (j) { return combo.lossByYear[j] || 0; };
            }
            const snap = (typeof brooklynInterpolate === 'function')
                  ? brooklynInterpolate(cfg.tierKey || 'beta1', cfg.leverage || cfg.leverageCap || 2.25)
                  : null;
            const flatRate = snap ? (snap.lossRate || 0) : 0;
            return function () { return flatRate; };
      })();

      // Tranche state. tranches[k] = { capital, startIdx } where startIdx is
      // the cfg-relative year (0 = year1).
      const tranches = [];
      if (basisCash > 0) tranches.push({ capital: basisCash, startIdx: 0 });

      let stCF = 0;
      let gainRemaining = totalGainBucket;
      const rows = [];
      const recognitionSchedule = [];

      for (let i = 0; i < horizon; i++) {
            const year = (cfg.year1 || (new Date()).getFullYear()) + i;

            // Step 1 — compute Brooklyn loss + fees from EXISTING tranches.
            // Each tranche uses lossRateForTrancheYear(age-of-tranche), so
            // the basis position keeps generating losses every year using
            // the year-2, year-3, ... rates of the lossByYear curve while
            // newer tranches start at the year-1 rate.
            let existingLoss = 0;
            let existingFee = 0;
            let existingInvested = 0;
            tranches.forEach(function (t) {
                  const trancheAge = i - t.startIdx;
                  if (trancheAge < 0) return;
                  existingLoss += t.capital * lossRateForTrancheYear(trancheAge);
                  existingFee += t.capital * feeRate;
                  existingInvested += t.capital;
            });

            // Step 2 — decide gain to recognize this year. Gain proceeds
            // are received Jan 1 of year R and reinvested same year, so
            // the new tranche generates fresh year-1 losses in year R
            // alongside the existing tranches' year-N losses. The max
            // recognizable gain therefore solves:
            //     G ≤ stCF + existingLoss + G * year1Rate
            // i.e. G ≤ (stCF + existingLoss) / (1 - year1Rate).
            // Final-year fallback: recognize any remaining gain even if
            // it can't be fully offset.
            const year1Rate = lossRateForTrancheYear(0);
            const denom = Math.max(0.001, 1 - year1Rate);
            let gainRecThisYear = 0;
            if (i >= startIdx && gainRemaining > 0) {
                  const maxAbsorbable = (stCF + existingLoss) / denom;
                  gainRecThisYear = Math.min(gainRemaining, maxAbsorbable);
                  if (i === horizon - 1 && gainRemaining > gainRecThisYear) {
                        gainRecThisYear = gainRemaining;
                  }
                  gainRemaining -= gainRecThisYear;
            }

            // Step 3 — push the new tranche (immediate same-year reinvestment).
            if (gainRecThisYear > 0) {
                  tranches.push({ capital: gainRecThisYear, startIdx: i });
            }

            // Step 4 — recompute year totals INCLUDING the new tranche.
            const newTrancheLoss = gainRecThisYear * year1Rate;
            const newTrancheFee = gainRecThisYear * feeRate;
            const yearLoss = existingLoss + newTrancheLoss;
            const yearFee = existingFee + newTrancheFee;
            const yearInvested = existingInvested + gainRecThisYear;

            recognitionSchedule.push({ year: year, gainRecognized: gainRecThisYear });

            const baseline = _baseScenarioForYear(cfg, year, gainRecThisYear);
            const baselineTax = _yearTaxes(baseline);

            const totalLossAvail = stCF + yearLoss;
            const withStrat = _applyLossesWithSTCfCap(baseline, totalLossAvail, ordCap);
            const withStratTax = _yearTaxes(withStrat);

            stCF = Math.max(0, withStrat._lossUnused || 0);

            rows.push({
                  year: year,
                  gainRecognized: gainRecThisYear,
                  lossGenerated: yearLoss,
                  lossApplied: withStrat._lossUsed || 0,
                  stCarryForward: stCF,
                  investmentThisYear: yearInvested,
                  fee: yearFee,
                  baseline: baselineTax,
                  withStrategy: withStratTax,
                  savings: baselineTax.total - withStratTax.total
            });
      }

      let totalBaseline = 0, totalWith = 0, totalFees = 0;
      rows.forEach(function (r) {
            totalBaseline += r.baseline.total;
            totalWith += r.withStrategy.total;
            totalFees += r.fee;
      });

      // Effective duration = number of years over which gain was recognized
      // (used by the optimizer's tie-breaker to prefer shorter lockups).
      const recognitionYears = recognitionSchedule.filter(function (r) {
            return r.gainRecognized > 0;
      }).map(function (r) { return r.year; });
      const durationYears = recognitionYears.length
            ? (recognitionYears[recognitionYears.length - 1] - recognitionYears[0] + 1)
            : 0;

      return {
            rows: rows,
            totalBaseline: totalBaseline,
            totalWithStrategy: totalWith,
            totalSavings: totalBaseline - totalWith,
            totalFees: totalFees,
            recognitionSchedule: recognitionSchedule,
            durationYears: durationYears,
            unrecognizedGain: gainRemaining,
            deferred: true
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
