// FILE: js/05-projections/projection-engine.js
// Multi-year orchestrator for the Brooklyn capital-loss-harvesting strategy.
//
// Given a year-1 client snapshot, a Brooklyn fund tier, a leverage tier,
// and a horizon (in years), this engine rolls the strategy forward year
// by year and produces:
//   - Each year's federal and state tax liability (with and without Brooklyn)
//   - Brooklyn fees paid each year.
//   - Capital-loss carryforwards (short-term only by default).
//   - Cumulative net tax savings over the horizon.
//
// Loss treatment:
//   All Brooklyn-generated losses are treated as SHORT-TERM. There is no
//   60/40 split. A future per-year loss-projection table (provided by the
//   user) will replace the constant lossRate and may vary year to year.
//
// Sale-structuring inflows:
//   The engine accepts an optional perYearInflows[] array that adds gain
//   recognition events in any year (e.g. installment-sale principal,
//   deferred earn-outs). Brooklyn-generated short-term losses offset these
//   gains directly; any unused short-term loss falls through to ordinary
//   income up to the $3,000 / $1,500 cap and the remainder carries forward
//   as short-term.
//
// Dependencies (provided by other subsystems via globals):
//   BROOKLYN_STRATEGIES                         (01-brooklyn/brooklyn-data)
//   brooklynInterpolate(tierKey, leverage)      (01-brooklyn/brooklyn-interp)
//   brooklynFee(tierKey, leverage, investment)  (03-solver/fees)
//   computeFederalTax(income, year, status)     (02-tax-engine/tax-calc-fed)
//   computeStateTax(income, year, state, status)(02-tax-engine/tax-calc-state)
//   CarryforwardTracker                         (05-projections/carryforward)

const ProjectionEngine = {
        /**
                 * Run a multi-year Brooklyn projection.
         *
                 * @param {object} cfg
         * @param {number} cfg.year1                - First calendar year of the projection.
         * @param {number} cfg.horizonYears         - Number of years to project (e.g. 5).
         * @param {string} cfg.filingStatus         - 'single' | 'mfj' | 'mfs' | 'hoh'
         * @param {string} cfg.state                - Two-letter state code (or 'NONE').
         * @param {number} cfg.investment           - Brooklyn investment amount (year-1).
         * @param {string} cfg.tierKey              - Brooklyn fund tier key.
         * @param {number} cfg.leverage             - Selected leverage multiple.
         * @param {number} cfg.baseOrdinaryIncome   - Ordinary income (year-1, pre-Brooklyn).
         * @param {number} cfg.baseShortTermGain    - Short-term capital gain (year-1, pre-Brooklyn).
         * @param {number} cfg.baseLongTermGain     - Long-term capital gain (year-1, pre-Brooklyn).
         * @param {number[]} [cfg.ordinaryByYear]   - Optional: ordinary income per year (length = horizonYears).
         * @param {number[]} [cfg.shortGainByYear]  - Optional: short-term gain per year.
         * @param {number[]} [cfg.longGainByYear]   - Optional: long-term gain per year.
         * @param {number[]} [cfg.lossRateByYear]   - Optional: per-year loss rate (decimal). Overrides flat lossRate.
         *
                 * @returns {object} projection results: { years[], totals, ... }
         */
        run(cfg) {
                    const horizon = Math.max(1, cfg.horizonYears | 0);
                    const tracker = new CarryforwardTracker(cfg.filingStatus);

            // Year-1 strategy snapshot (drives default loss rate when no per-year table is supplied).
            const snap = brooklynInterpolate(cfg.tierKey, cfg.leverage);
                    const flatLossRate = snap ? snap.lossRate : 0;

  // Schwab combo override: when cfg.comboId resolves to a Schwab combo,
  // the loss factors already include leverage. We override lossRateByYear
  // with the tranche-derived array and skip the * cfg.leverage multiplier.
  const _schwabCombo = (cfg.comboId && typeof getSchwabCombo === 'function')
    ? getSchwabCombo(cfg.comboId) : null;
  const _schwabRates = (_schwabCombo && typeof schwabLossRateByYear === 'function')
    ? schwabLossRateByYear(cfg.comboId, cfg.implementationDate || (cfg.year1 + '-01-01'), horizon)
    : null;

            const yearRows = [];
                    let cumulativeSavings = 0;
                    let cumulativeFees = 0;

            for (let i = 0; i < horizon; i++) {
                            const year = cfg.year1 + i;
                            const ordinary = (cfg.ordinaryByYear && cfg.ordinaryByYear[i] != null)
                                ? cfg.ordinaryByYear[i] : cfg.baseOrdinaryIncome;
                            const shortGain = (cfg.shortGainByYear && cfg.shortGainByYear[i] != null)
                                ? cfg.shortGainByYear[i] : (i === 0 ? cfg.baseShortTermGain : 0);
                            const longGain = (cfg.longGainByYear && cfg.longGainByYear[i] != null)
                                ? cfg.longGainByYear[i] : (i === 0 ? cfg.baseLongTermGain : 0);

                        const lossRate = _schwabRates ? _schwabRates[i]
      : (cfg.lossRateByYear && cfg.lossRateByYear[i] != null)
        ? cfg.lossRateByYear[i] : flatLossRate;

      // Brooklyn investment sized only in year 1 by default.
      const investmentThisYear = (i === 0) ? cfg.investment : 0;
      // Schwab combos: leverage already baked in, so skip the * leverage step.
      const grossLoss = _schwabCombo
        ? investmentThisYear * lossRate
        : investmentThisYear * cfg.leverage * lossRate;
      const fee = (i === 0)
        ? (_schwabCombo
            ? cfg.investment * _schwabCombo.feeRate
            : brooklynFee(cfg.tierKey, cfg.leverage, cfg.investment))
        : 0;

                        // All losses are short-term.
                        const newShortLoss = grossLoss;
                            const newLongLoss = 0;

                        // Apply current-year gains + new losses + carryforwards.
                        const applied = tracker.applyYear({
                                            shortTermGain: shortGain,
                                            longTermGain:  longGain,
                                            newShortTermLoss: newShortLoss,
                                            newLongTermLoss:  newLongLoss
                        });

                        // Taxable income WITH Brooklyn.
                        const taxableOrdWith = ordinary + applied.ordinaryOffset * -1 + applied.netST > 0
                                ? ordinary + Math.max(0, applied.netST) - applied.ordinaryOffset
                                            : ordinary - applied.ordinaryOffset;
                            const fedWith = computeFederalTax(
                                                Math.max(0, ordinary - applied.ordinaryOffset) + Math.max(0, applied.netST),
                                                year, cfg.filingStatus,
                                { longTermGain: Math.max(0, applied.netLT) }
                                            );
                            const stateWith = computeStateTax(
                                                Math.max(0, ordinary - applied.ordinaryOffset)
                                                  + Math.max(0, applied.netST)
                                                  + Math.max(0, applied.netLT),
                                                year, cfg.state, cfg.filingStatus
                                            );

                        // Taxable income WITHOUT Brooklyn (baseline: just gains, no offset).
                        const fedNo = computeFederalTax(
                                            ordinary + Math.max(0, shortGain),
                                            year, cfg.filingStatus,
                            { longTermGain: Math.max(0, longGain) }
                                        );
                            const stateNo = computeStateTax(
                                                ordinary + Math.max(0, shortGain) + Math.max(0, longGain),
                                                year, cfg.state, cfg.filingStatus
                                            );

                        const taxWith = fedWith + stateWith;
                            const taxNo   = fedNo   + stateNo;
                            const savings = taxNo - taxWith - fee;

                        cumulativeSavings += savings;
                            cumulativeFees    += fee;

                        yearRows.push({
                                            year,
                                            ordinary,
                                            shortGain,
                                            longGain,
                                            investmentThisYear,
                                            lossRate,
                                            grossLoss,
                                            fee,
                                            shortTermLossUsedAgainstGains: 0,
                                            longTermLossUsedAgainstGains: 0,
                                            ordinaryOffsetUsed: applied.ordinaryOffset,
                                            shortCarryforwardEnd: applied.stCarryOut,
                                            longCarryforwardEnd: applied.ltCarryOut,
                                            fedTaxWithBrooklyn:    fedWith,
                                            stateTaxWithBrooklyn:  stateWith,
                                            fedTaxNoBrooklyn:      fedNo,
                                            stateTaxNoBrooklyn:    stateNo,
                                            taxWithBrooklyn:       taxWith,
                                            taxNoBrooklyn:         taxNo,
                                            netSavingsThisYear:    savings
                        });
            }

            return {
                            config: cfg,
                            years: yearRows,
                            totals: {
                                                cumulativeFees,
                                                cumulativeNetSavings: cumulativeSavings,
                                                finalShortCarryforward: tracker.shortCarryforward,
                                                finalLongCarryforward:  tracker.longCarryforward
                            }
            };
        }
};
