// FILE: js/01-brooklyn/brooklyn-data.js
// Brooklyn fund data: leverage tiers, loss-rate observations, and fee curves.
// Carried over from Brookhaven verbatim. The numeric tables below are the
// regression-fit data points that the interpolation engine reads.
//
// Fee regression (validated against 19 data points across 4 segments):
//   Beta 1:    fee = -0.00525 + 0.0000682 * GN  (R-squared 0.9994)
//   Beta 0:    fee = -0.00920 + 0.0000660 * GN  (R-squared 1.0000)
//   Beta 0.5:  fee = -0.00771 + 0.0000681 * GN  (R-squared 0.9998)
//   Advisor:   identical to Beta 1
// Universal approximation: about 0.67 bps per 1% gross notional.
// Marginal fee per 1% short position: about 1.34 bps across all segments.
// Fee drag as a percent of gross loss: 1.6% to 3.3% (higher leverage = more drag).
// Linear interpolation between presets is accurate.

const BROOKLYN_STRATEGIES = {
  beta1: {
      id: 'brooklyn_beta1',
          name: 'S&P 500 - Brooklyn Managed - Beta 1',
              benchmark: 'S&P 500',
                  advisorManaged: false,
                      beta: 1,
                          dataPoints: [
                                { leverage: 0,    longPct: 100, shortPct: 0,   lossRate: 0.104, feeRate: 0.0017, label: 'Long-Only', minInvestment: 250000  },
                                      { leverage: 0.30, longPct: 130, shortPct: 30,  lossRate: 0.248, feeRate: 0.0058, label: '130/30',    minInvestment: 500000  },
                                            { leverage: 0.45, longPct: 145, shortPct: 45,  lossRate: 0.322, feeRate: 0.0077, label: '145/45',    minInvestment: 500000  },
                                                  { leverage: 1.00, longPct: 200, shortPct: 100, lossRate: 0.590, feeRate: 0.0150, label: '200/100',   minInvestment: 1000000 },
                                                        { leverage: 1.50, longPct: 250, shortPct: 150, lossRate: 0.855, feeRate: 0.0216, label: '250/150',   minInvestment: 1000000 },
                                                              { leverage: 2.25, longPct: 325, shortPct: 225, lossRate: 1.224, feeRate: 0.0326, label: '325/225',   minInvestment: 1000000 }
                                                                  ],
                                                                      presets: ['Long-Only','130/30','145/45','200/100','250/150','325/225'],
                                                                          minInvestment: 250000,
                                                                              managementFee: 0
                                                                                },

                                                                                  beta0: {
                                                                                      id: 'brooklyn_beta0',
                                                                                          name: 'CASH - Brooklyn Managed - Beta 0',
                                                                                              benchmark: 'CASH',
                                                                                                  advisorManaged: false,
                                                                                                      beta: 0,
                                                                                                          dataPoints: [
                                                                                                                { leverage: 1.00, longPct: 100, shortPct: 100, lossRate: 0.495, feeRate: 0.0040, label: '100/100', minInvestment: 1000000 },
                                                                                                                      { leverage: 1.50, longPct: 150, shortPct: 150, lossRate: 0.758, feeRate: 0.0106, label: '150/150', minInvestment: 1000000 },
                                                                                                                            { leverage: 2.00, longPct: 200, shortPct: 200, lossRate: 1.011, feeRate: 0.0172, label: '200/200', minInvestment: 1000000 },
                                                                                                                                  { leverage: 2.75, longPct: 275, shortPct: 275, lossRate: 1.427, feeRate: 0.0271, label: '275/275', minInvestment: 1000000 }
                                                                                                                                      ],
                                                                                                                                          presets: ['100/100','150/150','200/200','275/275'],
                                                                                                                                              minInvestment: 1000000,
                                                                                                                                                  managementFee: 0
                                                                                                                                                    },
                                                                                                                                                    
                                                                                                                                                      beta05: {
                                                                                                                                                          id: 'brooklyn_beta05',
                                                                                                                                                              name: 'CASH/S&P 500 - Brooklyn Managed - Beta 0.5',
                                                                                                                                                                  benchmark: 'CASH/S&P 500',
                                                                                                                                                                      advisorManaged: false,
                                                                                                                                                                          beta: 0.5,
                                                                                                                                                                              dataPoints: [
                                                                                                                                                                                    { leverage: 1.00, longPct: 200, shortPct: 100, lossRate: 0.674,  feeRate: 0.0128, label: '200/100', minInvestment: 1000000 },
                                                                                                                                                                                          { leverage: 1.50, longPct: 250, shortPct: 150, lossRate: 0.933,  feeRate: 0.0194, label: '250/150', minInvestment: 1000000 },
                                                                                                                                                                                                { leverage: 2.25, longPct: 325, shortPct: 225, lossRate: 1.3255, feeRate: 0.0298, label: '325/225', minInvestment: 1000000 }
                                                                                                                                                                                                    ],
                                                                                                                                                                                                        presets: ['200/100','250/150','325/225'],
                                                                                                                                                                                                            minInvestment: 1000000,
                                                                                                                                                                                                                managementFee: 0
                                                                                                                                                                                                                  },
                                                                                                                                                                                                                  
                                                                                                                                                                                                                    advisorManaged: {
                                                                                                                                                                                                                        id: 'brooklyn_advisor',
                                                                                                                                                                                                                            name: 'S&P 500 - Advisor Managed',
                                                                                                                                                                                                                                benchmark: 'S&P 500',
                                                                                                                                                                                                                                    advisorManaged: true,
                                                                                                                                                                                                                                        beta: null,
                                                                                                                                                                                                                                            dataPoints: [
                                                                                                                                                                                                                                                  { leverage: 0,    longPct: 100, shortPct: 0,   lossRate: 0.104, feeRate: 0.0017, label: 'Long-Only', minInvestment: 250000  },
                                                                                                                                                                                                                                                        { leverage: 0.30, longPct: 130, shortPct: 30,  lossRate: 0.144, feeRate: 0.0058, label: '130/30',    minInvestment: 500000  },
                                                                                                                                                                                                                                                              { leverage: 0.45, longPct: 145, shortPct: 45,  lossRate: 0.218, feeRate: 0.0077, label: '145/45',    minInvestment: 500000  },
                                                                                                                                                                                                                                                                    { leverage: 1.00, longPct: 200, shortPct: 100, lossRate: 0.486, feeRate: 0.0150, label: '200/100',   minInvestment: 1000000 },
                                                                                                                                                                                                                                                                          { leverage: 1.50, longPct: 250, shortPct: 150, lossRate: 0.751, feeRate: 0.0216, label: '250/150',   minInvestment: 1000000 },
                                                                                                                                                                                                                                                                                { leverage: 2.25, longPct: 325, shortPct: 225, lossRate: 1.120, feeRate: 0.0326, label: '325/225',   minInvestment: 1000000 }
                                                                                                                                                                                                                                                                                    ],
                                                                                                                                                                                                                                                                                        presets: ['Long-Only','130/30','145/45','200/100','250/150','325/225'],
                                                                                                                                                                                                                                                                                            minInvestment: 250000,
                                                                                                                                                                                                                                                                                                managementFee: 0
                                                                                                                                                                                                                                                                                                  }
                                                                                                                                                                                                                                                                                                  };
                                                                                                                                                                                                                                                                                                  
