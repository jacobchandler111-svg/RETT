// FILE: js/01-brooklyn/brooklyn-data.js
// Brooklyn fund data: leverage tiers and loss-rate observations.
// Carried over from Brookhaven verbatim. The numeric tables below are the
// regression-fit data points that the interpolation engine reads.
//
// Fee data lives in fee-split.js (the single source of truth for forward-
// looking fee modeling). Static feeRate fields used to ship on each data
// point but were removed: they disagreed with the fee-split regression by
// 0.4-1.4% absolute and any caller that read tier.feeRate / snap.feeRate
// without overriding via brooklynFeeRateFor() would silently drift.

const BROOKLYN_STRATEGIES = {
  beta1: {
      id: 'brooklyn_beta1',
          name: 'S&P 500 - Brooklyn Managed - Beta 1',
              benchmark: 'S&P 500',
                  advisorManaged: false,
                      beta: 1,
                          dataPoints: [
                                { leverage: 0,    longPct: 100, shortPct: 0,   lossRate: 0.104, label: 'Long-Only', minInvestment: 250000  },
                                      { leverage: 0.30, longPct: 130, shortPct: 30,  lossRate: 0.248, label: '130/30',    minInvestment: 500000  },
                                            { leverage: 0.45, longPct: 145, shortPct: 45,  lossRate: 0.322, label: '145/45',    minInvestment: 500000  },
                                                  { leverage: 1.00, longPct: 200, shortPct: 100, lossRate: 0.590, label: '200/100',   minInvestment: 1000000 },
                                                        { leverage: 1.50, longPct: 250, shortPct: 150, lossRate: 0.855, label: '250/150',   minInvestment: 1000000 },
                                                              { leverage: 2.25, longPct: 325, shortPct: 225, lossRate: 1.224, label: '325/225',   minInvestment: 1000000 }
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
                                                                                                                { leverage: 1.00, longPct: 100, shortPct: 100, lossRate: 0.495, label: '100/100', minInvestment: 1000000 },
                                                                                                                      { leverage: 1.50, longPct: 150, shortPct: 150, lossRate: 0.758, label: '150/150', minInvestment: 1000000 },
                                                                                                                            { leverage: 2.00, longPct: 200, shortPct: 200, lossRate: 1.011, label: '200/200', minInvestment: 1000000 },
                                                                                                                                  { leverage: 2.75, longPct: 275, shortPct: 275, lossRate: 1.427, label: '275/275', minInvestment: 1000000 }
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
                                                                                                                                                                                    { leverage: 1.00, longPct: 200, shortPct: 100, lossRate: 0.674,  label: '200/100', minInvestment: 1000000 },
                                                                                                                                                                                          { leverage: 1.50, longPct: 250, shortPct: 150, lossRate: 0.933,  label: '250/150', minInvestment: 1000000 },
                                                                                                                                                                                                { leverage: 2.25, longPct: 325, shortPct: 225, lossRate: 1.3255, label: '325/225', minInvestment: 1000000 }
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
                                                                                                                                                                                                                                                  { leverage: 0,    longPct: 100, shortPct: 0,   lossRate: 0.104, label: 'Long-Only', minInvestment: 250000  },
                                                                                                                                                                                                                                                        { leverage: 0.30, longPct: 130, shortPct: 30,  lossRate: 0.144, label: '130/30',    minInvestment: 500000  },
                                                                                                                                                                                                                                                              { leverage: 0.45, longPct: 145, shortPct: 45,  lossRate: 0.218, label: '145/45',    minInvestment: 500000  },
                                                                                                                                                                                                                                                                    { leverage: 1.00, longPct: 200, shortPct: 100, lossRate: 0.486, label: '200/100',   minInvestment: 1000000 },
                                                                                                                                                                                                                                                                          { leverage: 1.50, longPct: 250, shortPct: 150, lossRate: 0.751, label: '250/150',   minInvestment: 1000000 },
                                                                                                                                                                                                                                                                                { leverage: 2.25, longPct: 325, shortPct: 225, lossRate: 1.120, label: '325/225',   minInvestment: 1000000 }
                                                                                                                                                                                                                                                                                    ],
                                                                                                                                                                                                                                                                                        presets: ['Long-Only','130/30','145/45','200/100','250/150','325/225'],
                                                                                                                                                                                                                                                                                            minInvestment: 250000,
                                                                                                                                                                                                                                                                                                managementFee: 0
                                                                                                                                                                                                                                                                                                  }
                                                                                                                                                                                                                                                                                                  };
                                                                                                                                                                                                                                                                                                  
