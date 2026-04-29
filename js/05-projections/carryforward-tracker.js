// FILE: js/05-projections/carryforward-tracker.js
// Capital-loss carryforward tracker.
//
// Implements the standard US capital-loss netting and $3,000 ordinary-income
// offset, with the unused balance carried forward into later years preserving
// short-term vs long-term character.
//
// Netting order (per IRC sec 1211 and sec 1212):
//   1. Short-term losses offset short-term gains.
//   2. Long-term losses offset long-term gains.
//   3. If one bucket has a net loss and the other a net gain, they are
//      netted across buckets (short-first).
//   4. If both buckets are net losses, up to $3,000 ($1,500 if MFS) of the
//      total may offset ordinary income in the current year. Excess is
//      carried into the next year preserving its short/long character.
//
// All amounts are dollars. Inputs are non-negative numbers (gains and losses
// expressed as positives). The tracker maintains state across years.

const ORDINARY_OFFSET_CAP = {
    single: 3000,
        mfj:    3000,
        mfs:    1500,
        hoh:    3000
      };

class CarryforwardTracker {
  /**
   * @param {string} filingStatus - 'single' | 'mfj' | 'mfs' | 'hoh'
   * @param {number} stCarryIn - Optional starting short-term carryforward.
   * @param {number} ltCarryIn - Optional starting long-term carryforward.
   */
  constructor(filingStatus, stCarryIn = 0, ltCarryIn = 0) {
    this.filingStatus = filingStatus;
    this.stCarry = Math.max(0, stCarryIn);
    this.ltCarry = Math.max(0, ltCarryIn);
    this.history = [];
  }

  /**
         * Apply a single tax year's gains and losses, including any prior
   * carryforward, and update internal state.
         *
         * @param {object} year
   * @param {number} year.stGains    - Short-term realized gains (>=0)
   * @param {number} year.stLosses   - Short-term realized losses (>=0, includes Brooklyn ST harvest)
   * @param {number} year.ltGains    - Long-term realized gains (>=0)
   * @param {number} year.ltLosses   - Long-term realized losses (>=0, includes Brooklyn LT harvest)
   * @returns {object} resolution: { netST, netLT, ordinaryOffset, stCarryOut, ltCarryOut }
   */
  applyYear(year) {
        // Backwards-compatible parameter normalizer. Older callers
        // pass {stGains, stLosses, ltGains, ltLosses}; the projection
        // engine passes {shortTermGain, longTermGain,
        // newShortTermLoss, newLongTermLoss}. Translate the engine
        // shape into the canonical bucket names used internally so
        // both call sites work with the same logic. (Added by
        // tax-strategy-fixes branch.)
        if (year && (
          year.shortTermGain !== undefined || year.longTermGain !== undefined ||
          year.newShortTermLoss !== undefined || year.newLongTermLoss !== undefined
        )) {
          year = {
            stGains:   (year.stGains   != null) ? year.stGains   : (year.shortTermGain    || 0),
            ltGains:   (year.ltGains   != null) ? year.ltGains   : (year.longTermGain     || 0),
            stLosses:  (year.stLosses  != null) ? year.stLosses  : (year.newShortTermLoss || 0),
            ltLosses:  (year.ltLosses  != null) ? year.ltLosses  : (year.newLongTermLoss  || 0)
          };
        }

        // Pull prior carryforwards into this year's loss buckets.
    const stLossesTotal = (year.stLosses || 0) + this.stCarry;
    const ltLossesTotal = (year.ltLosses || 0) + this.ltCarry;
    const stGains = year.stGains || 0;
    const ltGains = year.ltGains || 0;

    // Step 1+2: net within buckets. Positive = net gain, negative = net loss.
    let netST = stGains - stLossesTotal;
    let netLT = ltGains - ltLossesTotal;

    // Step 3: cross-bucket netting.
    if (netST < 0 && netLT > 0) {
      const used = Math.min(-netST, netLT);
      netST += used;
      netLT -= used;
    } else if (netLT < 0 && netST > 0) {
      const used = Math.min(-netLT, netST);
      netLT += used;
      netST -= used;
    }

    // Step 4: $3,000 ordinary offset and carryforward.
    const cap = ORDINARY_OFFSET_CAP[this.filingStatus] || 3000;
    let ordinaryOffset = 0;
    let stCarryOut = 0;
    let ltCarryOut = 0;

    if (netST < 0 || netLT < 0) {
      const totalNetLoss = Math.max(0, -netST) + Math.max(0, -netLT);
      ordinaryOffset = Math.min(totalNetLoss, cap);

      // Apply offset against short-term losses first (worse rate so it is
      // most valuable to absorb), then long-term.
      let offsetRemaining = ordinaryOffset;
      let stLossNet = Math.max(0, -netST);
      let ltLossNet = Math.max(0, -netLT);

      const stApplied = Math.min(stLossNet, offsetRemaining);
      stLossNet -= stApplied;
      offsetRemaining -= stApplied;

      const ltApplied = Math.min(ltLossNet, offsetRemaining);
      ltLossNet -= ltApplied;
      offsetRemaining -= ltApplied;

      stCarryOut = stLossNet;
      ltCarryOut = ltLossNet;
    }

    // Update internal state for the next year.
    this.stCarry = stCarryOut;
    this.ltCarry = ltCarryOut;

    const resolution = {
            netST: netST > 0 ? netST : 0,
                    netLT: netLT > 0 ? netLT : 0,
                    ordinaryOffset,
                    stCarryOut,
                    ltCarryOut
              };
    this.history.push(resolution);
    return resolution;
  }

  /** Reset all state. */
  reset() {
    this.stCarry = 0;
    this.ltCarry = 0;
    this.history = [];
  }
}
