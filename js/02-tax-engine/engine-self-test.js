// FILE: js/02-tax-engine/engine-self-test.js
// Engine regression harness (G5 audit guardrail).
//
// Replaces the runEngineParitySweep harness deleted in Session B of the
// engine collapse — there's no legacy engine left to compare against, so
// this harness validates the unified engine against (a) hand-baked
// canonical scenarios with expected dollar values, and (b) random Monte
// Carlo trials checking the engine's invariants.
//
// Invariants checked per scenario:
//   • Gain conservation: sumRecognized + unrecognizedGain ≈ totalGainBucket
//   • Savings sign: totalWithStrategy ≤ totalBaseline (Brooklyn never hurts)
//   • Finiteness: all top-level totals + per-row totals are finite numbers
//   • Non-negative: fees, brookhaven fees, totalSavings non-negative
//
// Expected-value regression scenarios catch numerical drift the
// invariant checks would miss (e.g., a fee-curve refresh that shifts
// savings by 0.5%). Tolerance is ±$10 per total to absorb rounding
// without masking real changes. To re-bake the expected values after
// an INTENTIONAL engine change, call window.runEngineSelfTest({rebake:true})
// and copy the printed CANONICAL_EXPECTED block back into this file.
//
// Usage from a browser console:
//   window.runEngineSelfTest()                 → 100 random + canonicals
//   window.runEngineSelfTest({iterations: 1000}) → 1K random + canonicals
//   window.runEngineSelfTest({rebake: true})   → print fresh canonicals
//
// Returns:
//   { pass, fail, total, failures: [...], canonicals: [...] }

(function () {
      'use strict';

      // Hand-picked scenarios with hardcoded expected dollar values.
      // If the engine math drifts, these fire first — before MC stats
      // smooth over a small bias. Each hits a different code path:
      //   - imm_GA: vanilla immediate
      //   - def_GA: vanilla deferred, structured-sale 24mo
      //   - imm_NJ: NJ disconformLossOffset path (F13)
      //   - imm_CA_recap: §1250 recapture path (state pref + recap cap)
      //   - imm_TX_stg: zero-state, baseShortTermGain present (F12)
      //   - def_belowmin: deferred + below-min (F14 zero-shape)
      //   - imm_noengage: nothing happening (zero bucket)
      var BASE_CFG = {
            filingStatus: 'mfj', baseOrdinaryIncome: 500000, wages: 500000,
            baseShortTermGain: 0, horizonYears: 5, year1: 2026,
            implementationDate: '2026-06-15', strategyImplementationDate: '2026-06-15',
            strategyKey: 'beta1', tierKey: 'beta1', leverage: 1.0, leverageCap: 1.0,
            comboId: 'beta1_200_100', custodian: 'schwab',
            recognitionStartYearIndex: 0
      };

      var CANONICAL_SCENARIOS = [
            { name: 'imm_GA',       cfg: { salePrice: 48000000, costBasis: 8000000, acceleratedDepreciation: 0,    state: 'GA', investedCapital: 48000000, investment: 48000000 } },
            { name: 'def_GA',       cfg: { salePrice: 48000000, costBasis: 8000000, acceleratedDepreciation: 0,    state: 'GA', investedCapital: 48000000, investment: 48000000, recognitionStartYearIndex: 1, structuredSaleDurationMonths: 60 } },
            { name: 'imm_NJ',       cfg: { salePrice: 30000000, costBasis: 5000000, acceleratedDepreciation: 0,    state: 'NJ', investedCapital: 30000000, investment: 30000000 } },
            { name: 'imm_CA_recap', cfg: { salePrice: 25000000, costBasis: 5000000, acceleratedDepreciation: 4000000, state: 'CA', investedCapital: 25000000, investment: 25000000 } },
            { name: 'imm_TX_stg',   cfg: { salePrice: 15000000, costBasis: 3000000, acceleratedDepreciation: 0,    state: 'TX', baseShortTermGain: 250000, investedCapital: 15000000, investment: 15000000 } },
            { name: 'def_belowmin', cfg: { salePrice:  1500000, costBasis:  500000, acceleratedDepreciation: 0,    state: 'GA', investedCapital:  1500000, investment:  1500000, recognitionStartYearIndex: 1, structuredSaleDurationMonths: 60 } },
            { name: 'imm_noengage', cfg: { salePrice:        0, costBasis:       0, acceleratedDepreciation: 0,    state: 'GA', investedCapital:        0, investment:        0 } }
      ];

      // Captured 2026-05-06 after data/taxBrackets.json 2026 state refresh
      // (GA HB 463 4.99%, OH/IA/LA flat moves, OK/NE/KS restructures, MD top
      // tier additions, MA millionaire COLA, plus rate cuts for IN/KY/NC/ID/
      // UT/MS/MT/WV/SC). Tolerance ±$10. To regenerate after a future
      // intentional change: window.runEngineSelfTest({rebake:true}).
      // Rebaked 2026-05-08 after the MetLife rules ship (term-specific
      // caps + 80% Y1+Y2 combined cap + 36mo minimum). Prior baked values
      // dated to before NIIT-on-ST-gain absorption fix (ae40061), the
      // F12 / F13 / F14 engine fixes, and the MetLife schedule
      // constraints. To regenerate after a future intentional engine
      // change: window.runEngineSelfTest({rebake:true}).
      var CANONICAL_EXPECTED = {
            imm_GA:       { totalBaseline: 12286908, totalWith:  7782273, totalSavings:  4504635, totalFees: 2859820, totalBrookhavenFees: 61000 },
            def_GA:       { totalBaseline: 12286908, totalWith:   670893, totalSavings: 11616015, totalFees: 1914571, totalBrookhavenFees: 61000 },
            imm_NJ:       { totalBaseline:  9264457, totalWith:  5909042, totalSavings:  3355415, totalFees: 1787387, totalBrookhavenFees: 61000 },
            imm_CA_recap: { totalBaseline:  8493768, totalWith:  5161283, totalSavings:  3332485, totalFees: 1489489, totalBrookhavenFees: 61000 },
            imm_TX_stg:   { totalBaseline:  3887509, totalWith:  2319628, totalSavings:  1567881, totalFees:  893694, totalBrookhavenFees: 61000 },
            def_belowmin: { totalBaseline:   974298, totalWith:   974298, totalSavings:        0, totalFees:       0, totalBrookhavenFees:     0 },
            imm_noengage: { totalBaseline:   674707, totalWith:   674707, totalSavings:        0, totalFees:       0, totalBrookhavenFees:     0 }
      };
      var TOLERANCE = 10;

      function _expectedKeys() {
            return ['totalBaseline','totalWith','totalSavings','totalFees','totalBrookhavenFees'];
      }

      function checkInvariants(r, cfg) {
            var fails = [];
            if (!r) { fails.push('null result'); return fails; }
            // Conservation
            var totalLT = Math.max(0,
                  (cfg.salePrice || 0) - (cfg.costBasis || 0) - (cfg.acceleratedDepreciation || 0));
            var sumRec = (r.recognitionSchedule || []).reduce(function (s, x) {
                  return s + (x.gainRecognized || 0);
            }, 0);
            var unrec = r.unrecognizedGain || 0;
            if (Math.abs(sumRec + unrec - totalLT) > 1) {
                  fails.push('conservation: sumRec=' + sumRec + ' unrec=' + unrec + ' totalLT=' + totalLT);
            }
            // Savings sign
            if ((r.totalWithStrategy || 0) > (r.totalBaseline || 0) + 1) {
                  fails.push('with > baseline: with=' + r.totalWithStrategy + ' base=' + r.totalBaseline);
            }
            // Finite totals
            ['totalBaseline','totalWithStrategy','totalSavings','totalFees','totalBrookhavenFees','totalAllFees']
                  .forEach(function (k) {
                        if (!isFinite(r[k])) fails.push('non-finite ' + k + '=' + r[k]);
                  });
            // Non-negative fees
            if ((r.totalFees || 0) < 0) fails.push('negative totalFees=' + r.totalFees);
            if ((r.totalBrookhavenFees || 0) < 0) fails.push('negative totalBrookhavenFees=' + r.totalBrookhavenFees);
            if ((r.totalSavings || 0) < -1) fails.push('negative totalSavings=' + r.totalSavings);
            // Per-row finiteness
            (r.rows || []).forEach(function (row, i) {
                  if (!row.baseline || !isFinite(row.baseline.total)) fails.push('row[' + i + '].baseline.total non-finite');
                  if (!row.withStrategy || !isFinite(row.withStrategy.total)) fails.push('row[' + i + '].withStrategy.total non-finite');
            });
            return fails;
      }

      function summarize(r) {
            return {
                  totalBaseline: Math.round(r.totalBaseline || 0),
                  totalWith: Math.round(r.totalWithStrategy || 0),
                  totalSavings: Math.round(r.totalSavings || 0),
                  totalFees: Math.round(r.totalFees || 0),
                  totalBrookhavenFees: Math.round(r.totalBrookhavenFees || 0)
            };
      }

      function _randInt(min, max) { return Math.floor(min + Math.random() * (max - min + 1)); }
      function _pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

      function _randomCfg() {
            var basis = _randInt(50000, 10000000);
            var gain = _randInt(0, 100000000);
            var depr = _randInt(0, basis);
            var state = _pick(['GA','CA','NJ','NY','TX','FL','WA','HI','VA','PA','OH']);
            var status = _pick(['mfj','single','mfj','mfj']); // weighted toward MFJ
            var deferred = Math.random() < 0.4;
            return Object.assign({}, BASE_CFG, {
                  salePrice: basis + gain,
                  costBasis: basis,
                  acceleratedDepreciation: depr,
                  filingStatus: status,
                  state: state,
                  investedCapital: basis + gain,
                  investment: basis + gain,
                  baseShortTermGain: Math.random() < 0.3 ? _randInt(0, 500000) : 0,
                  recognitionStartYearIndex: deferred ? 1 : 0,
                  structuredSaleDurationMonths: deferred ? _pick([48, 60, 72, 84]) : undefined
            });
      }

      function runEngineSelfTest(opts) {
            opts = opts || {};
            var iterations = opts.iterations != null ? Math.max(0, opts.iterations | 0) : 100;
            var rebake = !!opts.rebake;
            var failures = [];
            var canonicalsOut = [];
            var pass = 0, fail = 0;

            // Suppress engine warnings during the run — invariant warnings
            // duplicate what we're already checking, and we want clean output.
            var origWarn = (typeof console !== 'undefined') ? console.warn : null;
            if (origWarn) {
                  console.warn = function () {
                        var msg = Array.prototype.join.call(arguments, ' ');
                        if (/\[RETT engine\]/.test(msg)) return;
                        return origWarn.apply(console, arguments);
                  };
            }

            try {
                  // --- Canonicals ---
                  CANONICAL_SCENARIOS.forEach(function (sc) {
                        var cfg = Object.assign({}, BASE_CFG, sc.cfg);
                        var r;
                        try { r = window.unifiedTaxComparison(cfg); }
                        catch (e) {
                              fail++;
                              failures.push({ kind: 'canonical_throw', name: sc.name, error: String(e && e.message) });
                              return;
                        }
                        var got = summarize(r);
                        canonicalsOut.push({ name: sc.name, got: got });

                        var invFails = checkInvariants(r, cfg);
                        if (invFails.length) {
                              fail++;
                              failures.push({ kind: 'canonical_invariant', name: sc.name, fails: invFails });
                        }
                        if (!rebake) {
                              var exp = CANONICAL_EXPECTED[sc.name];
                              if (exp) {
                                    var drift = [];
                                    _expectedKeys().forEach(function (k) {
                                          if (Math.abs(got[k] - exp[k]) > TOLERANCE) {
                                                drift.push(k + ': expected=' + exp[k] + ' got=' + got[k] + ' delta=' + (got[k] - exp[k]));
                                          }
                                    });
                                    if (drift.length) {
                                          fail++;
                                          failures.push({ kind: 'canonical_drift', name: sc.name, drift: drift });
                                    } else {
                                          pass++;
                                    }
                              }
                        } else {
                              pass++;
                        }
                  });

                  // --- Random Monte Carlo ---
                  for (var i = 0; i < iterations; i++) {
                        var cfgR = _randomCfg();
                        var rR;
                        try { rR = window.unifiedTaxComparison(cfgR); }
                        catch (e) {
                              fail++;
                              failures.push({ kind: 'random_throw', cfg: cfgR, error: String(e && e.message) });
                              continue;
                        }
                        var iv = checkInvariants(rR, cfgR);
                        if (iv.length) {
                              fail++;
                              if (failures.length < 20) {
                                    failures.push({ kind: 'random_invariant', cfg: cfgR, fails: iv });
                              }
                        } else {
                              pass++;
                        }
                  }
            } finally {
                  if (origWarn) console.warn = origWarn;
            }

            var result = {
                  pass: pass,
                  fail: fail,
                  total: pass + fail,
                  failures: failures,
                  canonicals: canonicalsOut
            };
            if (rebake) {
                  result.rebake = canonicalsOut.reduce(function (m, c) {
                        m[c.name] = c.got; return m;
                  }, {});
            }
            return result;
      }

      if (typeof window !== 'undefined') {
            window.runEngineSelfTest = runEngineSelfTest;
      }
})();
