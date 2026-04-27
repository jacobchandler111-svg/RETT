// FILE: js/05-projections/projection-engine.js
// Multi-year orchestrator for the Brooklyn capital-loss-harvesting strategy.
//
// Given a year-1 client snapshot, a Brooklyn fund tier, a leverage tier,
// and a horizon (in years), this engine rolls the strategy forward year
// by year and produces:
//   - Each year's federal and state tax liability (with and without Brooklyn).
//   - Brooklyn fees paid each year.
//   - Capital-loss carryforwards.
//   - Cumulative net tax savings over the horizon.
//
// The engine is intentionally unaware of the DOM. It takes plain inputs and
// returns plain output objects. The UI layer (04-ui/projection-render.js) is
// responsible for formatting and display.
//
// Dependencies (provided by other subsystems via globals):
//   BROOKLYN_STRATEGIES                          (01-brooklyn/brooklyn-data)
//   brooklynInterpolate(tierKey, leverage)       (01-brooklyn/brooklyn-interpolation)
//   brooklynFee(tierKey, leverage, investment)   (03-solver/fees)
//   computeFederalTax(income, year, status)      (02-tax-engine/tax-calc-federal)
//   computeStateTax(income, year, state, status) (02-tax-engine/tax-calc-state)
//   CarryforwardTracker                          (05-projections/carryforward-tracker)

const ProjectionEngine = {
    /**
         * Run a multi-year Brooklyn projection.
     *
         * @param {object} cfg
     * @param {number} cfg.startingYear        - First tax year of the projection (e.g. 2026).
     * @param {number} cfg.horizonYears        - Number of years to project (e.g. 5).
     * @param {string} cfg.filingStatus        - 'single' | 'mfj' | 'mfs' | 'hoh'
     * @param {string} cfg.state               - Two-letter state code, or '' for federal-only.
     * @param {object} cfg.year1Income         - { w2, se, qualifiedDividends, ordinaryDividends }
     * @param {object} cfg.year1Gains          - { stGains, ltGains }  (pre-Brooklyn realized gains)
     * @param {object} cfg.growthRates         - { wage, gains } in decimal (0.03 = 3%)
     * @param {object} cfg.brooklyn
     * @param {string} cfg.brooklyn.tier       - 'beta1' | 'beta05' | 'beta0' | 'advisorManaged'
     * @param {number} cfg.brooklyn.leverage   - Selected leverage tier.
     * @param {number} cfg.brooklyn.investment - Initial dollars allocated to Brooklyn.
     * @returns {object} projection result
     */
    run(cfg) {
          const interp = brooklynInterpolate(cfg.brooklyn.tier, cfg.brooklyn.leverage);
          const tracker = new CarryforwardTracker(cfg.filingStatus);
          const years = [];

      let wages = (cfg.year1Income.w2 || 0) + (cfg.year1Income.se || 0);
          let qDiv = cfg.year1Income.qualifiedDividends || 0;
          let oDiv = cfg.year1Income.ordinaryDividends || 0;
          let stGains = cfg.year1Gains.stGains || 0;
          let ltGains = cfg.year1Gains.ltGains || 0;

      for (let i = 0; i < cfg.horizonYears; i++) {
              const taxYear = cfg.startingYear + i;

            // Brooklyn loss generation for this year. The lossRate reflects the
            // expected annual loss harvest as a fraction of investment notional.
            // Short/long character is split based on observed historical mix.
            // Default split: roughly 60% short-term, 40% long-term per source data.
            const annualLoss = cfg.brooklyn.investment * interp.lossRate;
              const stLoss = annualLoss * 0.60;
              const ltLoss = annualLoss * 0.40;
              const fee = brooklynFee(
                        cfg.brooklyn.tier,
                        cfg.brooklyn.leverage,
                        cfg.brooklyn.investment
                      );

            // Apply this year's gains and losses (with carryforward).
            const cf = tracker.applyYear({
                      stGains: stGains,
                      stLosses: stLoss,
                      ltGains: ltGains,
                      ltLosses: ltLoss
            });

            // Build taxable-income inputs for the tax engine.
            // Without Brooklyn: full pre-strategy gains, no harvested losses.
            // With Brooklyn: net gains from the carryforward tracker, plus
            // ordinary offset reduction.
            const incomeWithout = {
                      ordinary: wages + oDiv,
                      stGains: stGains,
                      ltGains: ltGains,
                      qualifiedDividends: qDiv
            };
              const incomeWith = {
                        ordinary: wages + oDiv - cf.ordinaryOffset,
                        stGains: cf.netST,
                        ltGains: cf.netLT,
                        qualifiedDividends: qDiv
              };

            const fedWithout = computeFederalTax(incomeWithout, taxYear, cfg.filingStatus);
              const fedWith    = computeFederalTax(incomeWith,    taxYear, cfg.filingStatus);
              const stateWithout = cfg.state
                ? computeStateTax(incomeWithout, taxYear, cfg.state, cfg.filingStatus)
                        : 0;
              const stateWith    = cfg.state
                ? computeStateTax(incomeWith,    taxYear, cfg.state, cfg.filingStatus)
                        : 0;

            const grossSavings = (fedWithout + stateWithout) - (fedWith + stateWith);
              const netSavings = grossSavings - fee;

            years.push({
                      taxYear,
                      wages,
                      qDiv,
                      oDiv,
                      stGainsPre: stGains,
                      ltGainsPre: ltGains,
                      brooklynStLoss: stLoss,
                      brooklynLtLoss: ltLoss,
                      carryforward: cf,
                      fee,
                      fedWithout,
                      fedWith,
                      stateWithout,
                      stateWith,
                      grossSavings,
                      netSavings
            });

            // Roll forward income / gains for next year.
            wages *= (1 + cfg.growthRates.wage);
              qDiv  *= (1 + cfg.growthRates.wage);
              oDiv  *= (1 + cfg.growthRates.wage);
              stGains *= (1 + cfg.growthRates.gains);
              ltGains *= (1 + cfg.growthRates.gains);
      }

      const totalNetSavings = years.reduce((s, y) => s + y.netSavings, 0);
          const totalFees       = years.reduce((s, y) => s + y.fee, 0);

      return {
              config: cfg,
              interpolation: interp,
              years,
              totals: {
                        netSavings: totalNetSavings,
                        fees: totalFees,
                        finalStCarry: tracker.stCarry,
                        finalLtCarry: tracker.ltCarry
              }
      };
    }
};
