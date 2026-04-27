// FILE: js/03-solver/brooklyn-allocator.js
// Single-fund Brooklyn allocator: picks the (tier, leverage, investment)
// combination that maximizes net tax savings for a given client snapshot.
//
// IMPORTANT: This is a LIVING module. Brooklyn fund minimums and fees
// can change year to year (and may change mid-year). The minimums come
// from the BROOKLYN_STRATEGIES table in 01-brooklyn/brooklyn-data.js,
// which is the single source of truth - update there, not here.
//
// The allocator does NOT pick the loss-rate. It always uses the
// interpolated lossRate baked into the strategy snapshot for the chosen
// (tier, leverage). A future per-year loss-projection table will be
// supplied through the projection engine, not the allocator.
//
// Algorithm:
//   1. For each fund tier, walk every leverage tier (and every snapshot
//      it offers) and compute the implied year-1 net savings at the
//      capped-by-cash investment level.
//   2. Respect each tier's minInvestment - if availableCapital is below
//      the minimum the tier is skipped.
//   3. Return the best combination plus a sorted ranking of all viable
//      candidates so the UI can show alternatives.

function _maxBrooklynInvestment(tierKey, snap, availableCapital) {
    // Cap by available cash. Tier minimums come from the snap (set in
    // brooklyn-data.js). If the available capital is below the minimum
    // this combination is not viable.
    const min = snap && snap.minInvestment ? snap.minInvestment : 0;
    if (availableCapital < min) return 0;
    return Math.min(availableCapital, snap.maxInvestment || availableCapital);
}

function _scoreBrooklynCombo(tierKey, leverage, snap, ctx) {
    const investment = _maxBrooklynInvestment(tierKey, snap, ctx.availableCapital);
    if (investment <= 0) return null;

    const grossLoss = investment * leverage * (snap.lossRate || 0);
    const fee       = brooklynFee(tierKey, leverage, investment);

    // Year-1 baseline tax: ordinary + ST gain + LT gain, no Brooklyn.
    const baseFed = computeFederalTax(
        ctx.ordinaryIncome + Math.max(0, ctx.shortTermGain),
        ctx.year, ctx.filingStatus,
        { longTermGain: Math.max(0, ctx.longTermGain) }
    );
    const baseState = computeStateTax(
        ctx.ordinaryIncome + Math.max(0, ctx.shortTermGain) + Math.max(0, ctx.longTermGain),
        ctx.year, ctx.state, ctx.filingStatus,
        { longTermGain: Math.max(0, ctx.longTermGain) }
    );

    // With Brooklyn: all losses are short-term. Apply against ST gain
    // first, then LT gain, then ordinary up to $3k/$1.5k, the rest is
    // a carryforward (year-1-only score, so we ignore the carryforward
    // value here - the projection engine handles multi-year scoring).
    const stCap   = (ctx.filingStatus === 'mfs') ? 1500 : 3000;
    let remaining = grossLoss;
    const useShort = Math.min(remaining, Math.max(0, ctx.shortTermGain));
    remaining -= useShort;
    const useLong  = Math.min(remaining, Math.max(0, ctx.longTermGain));
    remaining -= useLong;
    const useOrd   = Math.min(remaining, stCap);

    const adjOrd  = Math.max(0, ctx.ordinaryIncome - useOrd);
    const adjShort = Math.max(0, ctx.shortTermGain - useShort);
    const adjLong  = Math.max(0, ctx.longTermGain  - useLong);

    const fedWith = computeFederalTax(
        adjOrd + adjShort,
        ctx.year, ctx.filingStatus,
        { longTermGain: adjLong }
    );
    const stateWith = computeStateTax(
        adjOrd + adjShort + adjLong,
        ctx.year, ctx.state, ctx.filingStatus,
        { longTermGain: adjLong }
    );

    const taxBase = baseFed + baseState;
    const taxNew  = fedWith + stateWith;
    const grossSavings = taxBase - taxNew;
    const netSavings   = grossSavings - fee;

    return {
        tierKey, leverage, investment,
        grossLoss, fee,
        taxBase, taxNew,
        grossSavings, netSavings,
        carryforwardLeft: Math.max(0, remaining - stCap)
    };
}

function allocateBrooklyn(ctx) {
    // ctx shape:
    //   { availableCapital, year, filingStatus, state,
    //     ordinaryIncome, shortTermGain, longTermGain }
    const candidates = [];
    if (typeof BROOKLYN_STRATEGIES === 'undefined') return { best: null, candidates };

    for (const tierKey of Object.keys(BROOKLYN_STRATEGIES)) {
        const tier = BROOKLYN_STRATEGIES[tierKey];
        if (!tier || !tier.dataPoints) continue;
        for (const snap of tier.dataPoints) {
            const lev = snap.leverage;
            const result = _scoreBrooklynCombo(tierKey, lev, snap, ctx);
            if (result) candidates.push(result);
        }
    }

    candidates.sort((a, b) => b.netSavings - a.netSavings);
    return {
        best: candidates.length ? candidates[0] : null,
        candidates
    };
}
