// FILE: js/03-solver/calc-delphi.js
// Delphi Fund — Year-1 character-conversion math.
//
// Mechanism: Delphi is a private fund family (Class A & Class B) that
// allocates investor capital across long/short positions and natural-
// resources exposure to produce a structured K-1 with a deliberate
// bias toward ordinary-loss expense and offsetting LT capital gain.
// The economic value comes from the rate spread: ordinary income at
// ~37% top federal + state is exchanged for LT gain taxed at ~23.8%
// federal (LT 20% + 3.8% NIIT) + state.
//
// Standard per-class allocations (applied to NET investment after
// management fee). Numbers tracked from the Brookhaven canon and
// verified against fund offering memos:
//
//   shortTermCapitalGainLoss   -0.05   (ST loss)
//   ordinaryIncomeExpense      -0.30   (ordinary deduction)
//   longTermCapitalGainLoss    +0.25   (LT gain — income at LT rate)
//   qualifiedDividends         +0.06   (LT-rate income)
//   foreignTaxesPaid           -0.01   (FTC, dollar-for-dollar credit)
//
// Per $1 of net investment, the rough Year-1 federal arithmetic for
// a top-bracket client is:
//   save  ord  $0.30 × (37% + state%)        ≈ $0.126   ord savings
//   cost  LT   $0.25 × 23.8%                 ≈ $0.060   LT cost
//   cost  qd   $0.06 × 23.8%                 ≈ $0.014   qdiv cost
//   save  st   $0.05 × marginal (if absorb)  ≈ $0.018   ST loss savings
//   save  FTC  $0.01 × 1                     = $0.010   FTC credit
//   net                                       ≈ $0.080  ≈ 8% of net inv
//
// Year 1 ONLY in this file. Multi-year holding (lot tracking, FTC
// 10-yr carryover, capital-loss carryover, NAV growth, redemption)
// is the next layer once the unified solver lands.

(function (root) {
  'use strict';

  var DELPHI_STRATEGIES = {
    classA: {
      key:               'classA',
      name:              'Class A',
      minInvestment:     5000000,
      managementFee:     0.0175,
      liquidity:         'Monthly',
      liquidityNoticeDays: 30
    },
    classB: {
      key:               'classB',
      name:              'Class B',
      minInvestment:     1000000,
      managementFee:     0.0200,
      liquidity:         'Quarterly',
      liquidityNoticeDays: 30
    }
  };

  // Allocation percentages applied to net (post-fee) investment.
  // Both classes share the same allocation today; per-class overrides
  // can be added later if the offering memo diverges.
  var DELPHI_ALLOCATIONS = {
    shortTermCapitalGainLoss: -0.05,
    ordinaryIncomeExpense:    -0.30,
    longTermCapitalGainLoss:   0.25,
    qualifiedDividends:        0.06,
    foreignTaxesPaid:         -0.01
  };

  function _val(id) { var el = document.getElementById(id); return el ? el.value : ''; }
  function _num(id) {
    var raw = _val(id);
    var v = (typeof parseUSD === 'function') ? parseUSD(raw) : Number(raw);
    return Number.isFinite(v) ? v : 0;
  }
  function _safe(id) { return Math.max(0, _num(id)); }

  // Read the Delphi-specific baseline. Mirrors the snapshot that
  // calc-oil-gas reads, and additionally splits out rental + ordinary
  // dividend income so the NIIT base can be recomputed when Delphi's
  // ST loss / LT gain / qdiv allocations change the investment-income
  // mix. Single source of truth: the Page-1 form fields.
  function _readSnapshot() {
    var year   = parseInt(_val('year1'), 10) || (new Date()).getFullYear();
    var status = _val('filing-status') || 'mfj';
    var state  = _val('state-code') || 'NONE';

    var ordIds = ['w2-wages', 'se-income', 'biz-revenue',
                  'rental-income', 'dividend-income',
                  'retirement-distributions'];
    var ordTotal = 0;
    for (var i = 0; i < ordIds.length; i++) ordTotal += _safe(ordIds[i]);

    var stGain = _safe('short-term-gain');
    var sale   = _safe('sale-price');
    var basis  = _safe('cost-basis');
    var depr   = _safe('accelerated-depreciation');
    var ltGain = sale - basis - depr;
    var recap  = depr;

    var wages  = _safe('w2-wages');
    var seInc  = _safe('se-income');

    // Ordinary-flavored investment income that's part of the §1411
    // NIIT base (Form 8960). Carved out separately so we can rebuild
    // niitBase after Delphi shifts LT, ST, and qdiv.
    var rentalInvestmentIncome = _safe('rental-income') + _safe('dividend-income');

    return {
      year: year, status: status, state: state,
      ordTotal: ordTotal, recap: recap,
      stGain: stGain, ltGain: ltGain,
      wages: wages, seInc: seInc,
      rentalInvestmentIncome: rentalInvestmentIncome
    };
  }

  // Run the federal + state pipeline with explicit overrides for the
  // Delphi-affected buckets. ovr fields:
  //   ord  — ordinary income override (defaults to snap.ordTotal+recap)
  //   lt   — long-term gain (signed; engine handles §1211(b))
  //   st   — short-term gain (signed; engine handles §1211(b))
  //   qdiv — qualified dividends (engine taxes at LT rate, adds to NIIT)
  //   ftc  — foreign tax credit (subtracted from federal tax at the end)
  function _totalTaxAt(snap, ovr) {
    if (typeof computeFederalTaxBreakdown !== 'function' ||
        typeof computeStateTax !== 'function') {
      return { fed: 0, state: 0, total: 0, niit: 0, addmed: 0, seTax: 0,
               lossOrdOffsetApplied: 0, fedBeforeFTC: 0, ftc: 0 };
    }
    ovr = ovr || {};
    var ord  = (ovr.ord  != null) ? ovr.ord  : (snap.ordTotal + snap.recap);
    var lt   = (ovr.lt   != null) ? ovr.lt   : snap.ltGain;
    var st   = (ovr.st   != null) ? ovr.st   : snap.stGain;
    var qdiv = (ovr.qdiv != null) ? ovr.qdiv : 0;
    var ftc  = (ovr.ftc  != null) ? ovr.ftc  : 0;

    // NIIT base = positive LT + positive ST + qdiv + (rental + ord-div).
    // Negative LT/ST don't add to the base; they offset elsewhere.
    var niitBase = Math.max(0, lt) + Math.max(0, st) + Math.max(0, qdiv) +
                   snap.rentalInvestmentIncome;

    var fedB = computeFederalTaxBreakdown(ord, snap.year, snap.status, {
      longTermGain:      lt,
      shortTermGain:     st,
      qualifiedDividend: qdiv,
      investmentIncome:  niitBase,
      wages:             snap.wages,
      seIncome:          snap.seInc
    }) || {};
    var fedOrd  = Number(fedB.ordinaryTax)         || 0;
    var fedLt   = Number(fedB.ltTax)               || 0;
    var amt     = Number(fedB.amtTopUp)            || 0;
    var niit    = Number(fedB.niit)                || 0;
    var addmed  = Number(fedB.addlMedicare)        || 0;
    var seTax   = Number(fedB.seTax)               || 0;
    var lossOff = Number(fedB.lossOrdOffsetApplied) || 0;

    var fedBeforeFTC = fedOrd + fedLt + amt;
    // FTC is a nonrefundable credit; clip at federal tax to avoid
    // negative tax. The §904 limitation (FTC ≤ US tax × foreign-source
    // /total-taxable-income) is omitted here because for the small
    // amounts Delphi generates the limitation rarely binds.
    var ftcApplied = Math.min(fedBeforeFTC, Math.max(0, ftc));
    var fedAfterFTC = Math.max(0, fedBeforeFTC - ftcApplied);

    // State engine — pass lossOrdOffsetApplied so state's §1211(b)
    // mirror stays in lockstep with federal. State income passed is
    // the standard ord + clipped(lt) + clipped(st) sum.
    var stateTax = computeStateTax(
      ord + Math.max(0, lt) + Math.max(0, st),
      snap.year, snap.state, snap.status,
      {
        longTermGain:           Math.max(0, lt + Math.max(0, qdiv)),
        shortTermGain:          Math.max(0, st),
        lossOrdOffsetApplied:   lossOff
      }
    ) || 0;

    return {
      fed:    fedAfterFTC,
      fedBeforeFTC: fedBeforeFTC,
      ftc:    ftcApplied,
      state:  stateTax,
      niit:   niit,
      addmed: addmed,
      seTax:  seTax,
      lossOrdOffsetApplied: lossOff,
      total:  fedAfterFTC + niit + addmed + seTax + stateTax
    };
  }

  // Public entry. params = { classKey, investment }.
  function computeDelphiYear1(params) {
    params = params || {};
    var classKey = (params.classKey === 'classA' || params.classKey === 'classB')
      ? params.classKey : 'classB';
    var cls = DELPHI_STRATEGIES[classKey];
    var invest = Math.max(0, Number(params.investment) || 0);
    var netInvest = invest * (1 - cls.managementFee);

    var alloc = DELPHI_ALLOCATIONS;
    var ordExpense = netInvest * Math.abs(alloc.ordinaryIncomeExpense);    // 30%
    var ltGainAdd  = netInvest * alloc.longTermCapitalGainLoss;            // 25%
    var stLossAmt  = netInvest * Math.abs(alloc.shortTermCapitalGainLoss); // 5%
    var qdivAdd    = netInvest * alloc.qualifiedDividends;                 // 6%
    var ftcAmt     = netInvest * Math.abs(alloc.foreignTaxesPaid);         // 1%

    var snap = _readSnapshot();

    var baseline  = _totalTaxAt(snap, {});
    var optimized = _totalTaxAt(snap, {
      ord:  Math.max(0, snap.ordTotal + snap.recap - ordExpense),
      lt:   snap.ltGain + ltGainAdd,
      st:   snap.stGain - stLossAmt,
      qdiv: qdivAdd,
      ftc:  ftcAmt
    });

    return {
      classKey:          classKey,
      className:         cls.name,
      minInvestment:     cls.minInvestment,
      minInvestmentMet:  invest >= cls.minInvestment,
      investment:        invest,
      netInvestment:     netInvest,
      managementFee:     cls.managementFee,
      mgmtFeeDollars:    invest - netInvest,
      liquidity:         cls.liquidity,
      liquidityNoticeDays: cls.liquidityNoticeDays,
      allocations: {
        ordinaryExpense:    ordExpense,
        longTermGainAdded:  ltGainAdd,
        shortTermLoss:      stLossAmt,
        qualifiedDividends: qdivAdd,
        foreignTaxCredit:   ftcAmt
      },
      baselineTotal:  baseline.total,
      optimizedTotal: optimized.total,
      totalSaved:     Math.max(0, baseline.total - optimized.total),
      fedSaved:       baseline.fed   - optimized.fed,
      stateSaved:     baseline.state - optimized.state,
      niitDelta:      baseline.niit  - optimized.niit,
      ftcApplied:     optimized.ftc
    };
  }

  root.computeDelphiYear1 = computeDelphiYear1;
  root.DELPHI_STRATEGIES  = DELPHI_STRATEGIES;
  root.DELPHI_ALLOCATIONS = DELPHI_ALLOCATIONS;
})(window);
