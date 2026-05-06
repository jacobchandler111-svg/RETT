// FILE: js/03-solver/supplemental-extra-registry.js
// Registry entries for the 8 supplemental strategies whose math is
// pending. Each spec hooks into the per-strategy state object that
// supplemental-extra-render.js owns:
//
//   window.__rettSupplementalExtraInterest[id]       -> true|false|null
//   window.__rettSupplementalExtra[id]               -> { ...detailFields, lastResult }
//
// Until the calc modules land, getResult() returns null and the master
// solver / allocator naturally treat the strategy as "interested but
// not yet computed" — netBenefit 0, investment 0. The UI's "See Value"
// button reads runMasterSolver + runAllocator output and shows:
//   - the dollar net benefit when result is non-null AND allocator gave
//     the strategy investment > 0;
//   - "Other strategies utilized" when interested but allocator gave 0
//     (a future competitive allocator will route capital to the best
//     ROI options when capital is finite);
//   - "Math pending" when result is null (calc not yet wired in).
//
// Adding the math for a strategy is a 2-line change in the calc module:
//   window.__rettSupplementalExtra[id].lastResult = {
//     netBenefit: <dollar tax savings>,
//     investment: <dollar capital deployed>,
//     ...whatever else the UI wants to surface
//   };
// No changes needed here once the lastResult contract is honored.

(function (root) {
  'use strict';

  if (typeof root.registerSupplemental !== 'function') return;

  // The 8 placeholder ids must match supplemental-extra-render.js SPECS.
  // Order numbers continue past oilGas (10) and delphi (20) so the
  // master-solver list view shows them after the math-having pair.
  var EXTRAS = [
    { id: 'plan412e3',  name: '412(e)(3) Fully Insured Plan',     shortName: '412(e)(3)',      bucket: 'ordinary', order: 30,
      descriptor: 'Defined-benefit plan funded with insurance contracts; very large annual deduction.' },
    { id: 'ptet',       name: 'PTET — Pass-Through Entity SALT',  shortName: 'PTET',           bucket: 'ordinary', order: 40,
      descriptor: 'State income tax paid at the entity level — bypasses the federal SALT cap.' },
    { id: 'qbi',        name: 'QBI Deduction (199A)',             shortName: 'QBI',            bucket: 'ordinary', order: 50,
      descriptor: '20% deduction on qualified business income from pass-through entities.' },
    { id: 'rdCredit',   name: 'R&D Credit + Expensing',           shortName: 'R&D',            bucket: 'ordinary', order: 60,
      descriptor: 'Federal credit on qualified research expenses plus immediate expensing of domestic R&D.' },
    { id: 'plan401h',   name: '401(h) Tax Trifecta',              shortName: '401(h)',         bucket: 'ordinary', order: 70,
      descriptor: 'Add-on to a DB plan: deductible in, tax-free growth, tax-free retiree medical out.' },
    { id: 'qcd',        name: 'Qualified Charitable Distribution', shortName: 'QCD',           bucket: 'ordinary', order: 80,
      descriptor: 'IRA-to-charity transfer at 70.5+ that counts toward the RMD without entering income.' },
    { id: 'solarITC',   name: 'Solar ITC Investment',             shortName: 'Solar ITC',      bucket: 'mixed',    order: 90,
      descriptor: '30% federal investment tax credit plus 5-year MACRS depreciation on a solar project.' },
    { id: 'film181',    name: 'Film Debt Financing (§181)',       shortName: 'Film §181',      bucket: 'ordinary', order: 100,
      descriptor: 'Section 181 immediate expensing of qualified domestic film production investment.' }
  ];

  EXTRAS.forEach(function (e) {
    root.registerSupplemental({
      id:           e.id,
      name:         e.name,
      shortName:    e.shortName,
      descriptor:   e.descriptor,
      order:        e.order,
      incomeBucket: e.bucket,
      // Interest is owned by supplemental-extra-render.js — it writes
      // window.__rettSupplementalExtraInterest[id] when the user hits
      // Interested / Not Interested. Returning null when the global
      // hasn't been initialized yet keeps the solver inert.
      getInterest: function () {
        var i = root.__rettSupplementalExtraInterest;
        if (!i) return null;
        return (typeof i[e.id] === 'undefined') ? null : i[e.id];
      },
      // Result is owned by the per-strategy calc module (pending). The
      // null path is the steady state until math is wired in; the
      // master solver treats null results as "available: false" and
      // the UI reads that to display "Math pending".
      getResult: function () {
        var s = root.__rettSupplementalExtra && root.__rettSupplementalExtra[e.id];
        return (s && s.lastResult) ? s.lastResult : null;
      },
      // netBenefit reads result.netBenefit. Defensive Number() so a
      // half-implemented calc that writes a string doesn't poison
      // the combined hero number on Page 5.
      getNetBenefit: function (result) {
        if (!result) return 0;
        var v = Number(result.netBenefit);
        return Number.isFinite(v) ? v : 0;
      },
      // Investment for the allocator. Two-tier read so the spec works
      // before AND after math arrives:
      //   1. result.investment when the calc has run.
      //   2. The user's preferred-investment field on the Details
      //      panel as a fallback so the allocator can show the dollar
      //      the strategy WOULD claim if math were live. Falls back to
      //      0 when neither is available.
      getInvestment: function (result) {
        if (result && Number.isFinite(Number(result.investment))) {
          return Number(result.investment);
        }
        var s = root.__rettSupplementalExtra && root.__rettSupplementalExtra[e.id];
        if (!s) return 0;
        // Map of detail-row id used as the "investment" surrogate for
        // each strategy. Mirrors the SPECS detailRows in
        // supplemental-extra-render.js.
        var INVESTMENT_FIELD = {
          plan412e3:  'contribution',
          ptet:       'taxableIncome',
          qbi:        'qbiIncome',
          rdCredit:   'rdSpend',
          plan401h:   'medContribution',
          qcd:        'qcdAmount',
          solarITC:   'solarInvestment',
          film181:    'filmInvestment'
        };
        var key = INVESTMENT_FIELD[e.id];
        if (!key) return 0;
        var v = Number(s[key]);
        return Number.isFinite(v) ? Math.max(0, v) : 0;
      }
    });
  });

  // Expose the extras list for the UI's "See Value" button so it can
  // map id -> {name, shortName, bucket} without knowing the registry
  // internals.
  root.__SUPPLEMENTAL_EXTRA_REGISTRY = EXTRAS;
})(window);
