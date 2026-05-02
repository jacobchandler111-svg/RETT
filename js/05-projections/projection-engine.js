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

            // Below-min lifecycle check: if the cumulative deposit can
            // never reach the custodian's strategy minimum, the position
            // can't legally open. Run with investment = 0 so the engine
            // produces zero loss, zero fee — the dashboard surfaces a
            // "no engagement" presentation. The tax baseline still
            // computes correctly because cfg is shallow-copied.
            let _belowMin = false;
            if (cfg.custodian && typeof window.getMinInvestment === 'function') {
              const _stratKey = cfg.tierKey || cfg.strategyKey;
              const _min = _stratKey ? window.getMinInvestment(cfg.custodian, _stratKey) : 0;
              if (_min > 0) {
                const _basis = Math.max(0, cfg.costBasis || 0);
                const _ltGain = Math.max(0, (cfg.salePrice || 0) - (cfg.costBasis || 0) - (cfg.acceleratedDepreciation || 0));
                const _recapture = Math.max(0, cfg.acceleratedDepreciation || 0);
                const _fromSale = (cfg.salePrice || 0) > 0 && _basis > 0
                  ? (_basis + _ltGain + _recapture) : 0;
                const _maxCum = Math.max(_fromSale, Number(cfg.investment || 0));
                if (_maxCum < _min) {
                  _belowMin = true;
                  cfg = Object.assign({}, cfg, { investment: 0 });
                }
              }
            }

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

      // The Brooklyn position stays open through the full horizon for
      // BOTH Schwab and non-Schwab paths. Previously the non-Schwab
      // path zeroed out investmentThisYear after Year 1, which meant
      // the dashboard's Details table showed $0 invested / $0 loss
      // generated in years 2+ even though the strategy was still
      // running. The carryforward tracker handles the resulting
      // year-2+ short-term loss correctly (capped at $3K/yr against
      // ordinary income, rest carries forward).
      const investmentThisYear = cfg.investment;
      // Schwab combos: leverage already baked into lossRate, so skip
      // the * leverage step. Non-Schwab uses brooklyn-data lossRate
      // (now from regression in fee-split.js) at cfg.leverage.
      const grossLoss = _schwabCombo
        ? cfg.investment * lossRate
        : investmentThisYear * cfg.leverage * lossRate;
      // Fee uses the unified regression (fee-split.js) for all paths,
      // including Schwab combos. The combo's published feeRate is
      // intentionally bypassed; see fees.js docstring. Charged every
      // year the position is open.
      let fee = 0;
      if (_schwabCombo && typeof window.brooklynFeeRateFor === 'function') {
        fee = cfg.investment * window.brooklynFeeRateFor(_schwabCombo.longPct, _schwabCombo.shortPct);
      } else if (_schwabCombo) {
        fee = cfg.investment * (_schwabCombo.feeRate || 0);
      } else {
        fee = brooklynFee(cfg.tierKey, cfg.leverage, cfg.investment);
      }

                        // All losses are short-term.
                        const newShortLoss = grossLoss;
                            const newLongLoss = 0;

                        // Apply current-year gains + new losses + carryforwards.
                        const applied = tracker.applyYear({
                                            stGains:        shortGain,
                                            ltGains:        longGain,
                                            stLosses:         newShortLoss,
                                            ltLosses:         newLongLoss
                        });

                        // Taxable income WITH Brooklyn — passed inline to
                        // computeFederalTax/computeStateTax below. The
                        // intermediate variable used to live here but was
                        // dead code with an operator-precedence bug
                        // (the `>` was binding before the `+`).
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
                                                finalShortCarryforward: tracker.stCarry,
                                                finalLongCarryforward:  tracker.ltCarry
                            }
            };
        }
};
