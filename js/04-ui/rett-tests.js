// FILE: js/04-ui/rett-tests.js
// Self-contained logic-check harness. Exposes window.RETT_Tests.run() which
// executes a small battery of property-sale / tax-strategy regression tests
// against the live ProjectionEngine and returns a {passed, failed, results[]}
// summary that can be eyeballed in the browser console.
//
// These tests deliberately exercise the public surface of the projection
// engine (cfg in -> result out) rather than reaching into module internals,
// so they continue to work as long as the cfg / result contracts are honored.
// They are NOT a substitute for full unit tests with a build step; they're a
// quick "is the strategy actually doing anything?" check that a reviewer can
// run after a deploy.
//
// Public API:
//   window.RETT_Tests.run() -> {passed, failed, results: [{name, pass, detail}]}
//
// Added by tax-strategy-fixes branch.

(function (root) {
  'use strict';

  function _baseCfg(overrides) {
    return Object.assign({
      year1: 2026,
      horizonYears: 5,
      filingStatus: 'mfj',
      state: 'NY',
      tierKey: 'beta1',
      leverage: 1,
      leverageCap: 2.25,
      strategyKey: 'beta1',
      baseOrdinaryIncome: 1500000,
      baseShortTermGain: 0,
      baseLongTermGain: 0,
      ordinaryByYear: [1500000, 1500000, 1500000, 1500000, 1500000],
      shortGainByYear: [0, 0, 0, 0, 0],
      longGainByYear:  [0, 0, 0, 0, 0],
      lossRateByYear:  null,
      investment: 0,
      availableCapital: 0,
      // property sale fields default to 0 (no sale)
      salePrice: 0,
      costBasis: 0,
      acceleratedDepreciation: 0,
      propertyGain: 0,
      recapture: 0
    }, overrides || {});
  }

  function _runEngine(cfg) {
    if (typeof ProjectionEngine === 'undefined' || !ProjectionEngine.run) {
      return null;
    }
    return ProjectionEngine.run(cfg);
  }

  function _y1(result) {
    return result && result.years && result.years[0] ? result.years[0] : null;
  }

  function _check(name, predicate, detail) {
    var pass;
    try { pass = !!predicate(); } catch (e) { pass = false; detail = (detail || '') + ' [threw: ' + e.message + ']'; }
    return { name: name, pass: pass, detail: detail || '' };
  }

  function run() {
    var results = [];

    // 1. Zero-investment, zero-property: with-strategy == baseline (identity).
    var r1 = _runEngine(_baseCfg({ investment: 0 }));
    var y1_1 = _y1(r1);
    results.push(_check(
      'zero investment + zero property: with == baseline',
      function () { return y1_1 && Math.abs(y1_1.taxWithBrooklyn - y1_1.taxNoBrooklyn) < 1; },
      y1_1 ? ('with=' + y1_1.taxWithBrooklyn + ' baseline=' + y1_1.taxNoBrooklyn) : 'no result'
    ));

    // 2. Property gain flows through baseline (year-1 longGain reflects propertyGain).
    var r2 = _runEngine(_baseCfg({ propertyGain: 5000000, recapture: 1000000 }));
    var y1_2 = _y1(r2);
    results.push(_check(
      'property gain raises baseline longGain',
      function () { return y1_2 && y1_2.longGain >= 5000000 && y1_2.ordinary >= 2500000; },
      y1_2 ? ('longGain=' + y1_2.longGain + ' ordinary=' + y1_2.ordinary) : 'no result'
    ));

    // 3. Property gain raises baseline tax above no-property baseline.
    var r3a = _runEngine(_baseCfg({ propertyGain: 0, recapture: 0 }));
    var r3b = _runEngine(_baseCfg({ propertyGain: 5000000, recapture: 1000000 }));
    var y1_3a = _y1(r3a);
    var y1_3b = _y1(r3b);
    results.push(_check(
      'property gain raises baseline tax',
      function () { return y1_3a && y1_3b && (y1_3b.taxNoBrooklyn > y1_3a.taxNoBrooklyn + 100000); },
      y1_3a && y1_3b ? ('without=' + y1_3a.taxNoBrooklyn + ' with-property=' + y1_3b.taxNoBrooklyn) : 'no result'
    ));

    // 4. Brooklyn losses reduce with-strategy tax below baseline (the whole point).
    var r4 = _runEngine(_baseCfg({ propertyGain: 5000000, recapture: 1000000, investment: 2000000, leverage: 2.25 }));
    var y1_4 = _y1(r4);
    results.push(_check(
      'with-strategy < baseline when losses generated',
      function () { return y1_4 && y1_4.taxWithBrooklyn < y1_4.taxNoBrooklyn - 1; },
      y1_4 ? ('with=' + y1_4.taxWithBrooklyn + ' baseline=' + y1_4.taxNoBrooklyn) : 'no result'
    ));

    // 5. State tax drops in tax states under strategy.
    var r5 = _runEngine(_baseCfg({ state: 'NY', propertyGain: 5000000, recapture: 1000000, investment: 2000000, leverage: 2.25 }));
    var y1_5 = _y1(r5);
    results.push(_check(
      'state tax drops in NY under strategy',
      function () { return y1_5 && y1_5.stateTaxWithBrooklyn < y1_5.stateTaxNoBrooklyn - 1; },
      y1_5 ? ('stateWith=' + y1_5.stateTaxWithBrooklyn + ' stateBaseline=' + y1_5.stateTaxNoBrooklyn) : 'no result'
    ));

    // 6. No-tax state stays at $0 state tax under both paths.
    var r6 = _runEngine(_baseCfg({ state: 'TX', propertyGain: 5000000, recapture: 1000000, investment: 2000000, leverage: 2.25 }));
    var y1_6 = _y1(r6);
    results.push(_check(
      'no-tax state (TX) keeps state tax at 0',
      function () { return y1_6 && y1_6.stateTaxWithBrooklyn === 0 && y1_6.stateTaxNoBrooklyn === 0; },
      y1_6 ? ('stateWith=' + y1_6.stateTaxWithBrooklyn + ' stateBaseline=' + y1_6.stateTaxNoBrooklyn) : 'no result'
    ));

    // 7. Savings identity: netSavingsThisYear = taxNoBrooklyn - taxWithBrooklyn - fee.
    var r7 = _runEngine(_baseCfg({ propertyGain: 5000000, recapture: 1000000, investment: 2000000, leverage: 2.25 }));
    var y1_7 = _y1(r7);
    results.push(_check(
      'savings identity: tn - tw - fee = netSavings',
      function () {
        if (!y1_7) return false;
        var expected = y1_7.taxNoBrooklyn - y1_7.taxWithBrooklyn - y1_7.fee;
        return Math.abs(y1_7.netSavingsThisYear - expected) < 0.01;
      },
      y1_7 ? ('netSavings=' + y1_7.netSavingsThisYear + ' tn-tw-fee=' + ((y1_7.taxNoBrooklyn||0)-(y1_7.taxWithBrooklyn||0)-(y1_7.fee||0))) : 'no result'
    ));

    var passed = 0, failed = 0;
    for (var i = 0; i < results.length; i++) {
      if (results[i].pass) passed++; else failed++;
    }
    var summary = { passed: passed, failed: failed, total: results.length, results: results };
    if (typeof console !== 'undefined' && console.log) {
      console.log('[RETT_Tests] ' + passed + '/' + results.length + ' passed');
      for (var j = 0; j < results.length; j++) {
        console.log((results[j].pass ? '  PASS ' : '  FAIL ') + results[j].name + ' -- ' + results[j].detail);
      }
    }
    return summary;
  }

  root.RETT_Tests = { run: run };
})(typeof window !== 'undefined' ? window : this);
