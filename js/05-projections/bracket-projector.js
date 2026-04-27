// FILE: js/05-projections/bracket-projector.js
// Multi-year tax bracket projector.
//
// The IRS publishes federal and state brackets through 2026. For tax planning
// beyond 2026 we synthesize forward projections by applying a flat annual
// inflation assumption to each bracket threshold. Rates are held constant.
//
// Methodology:
//   projected_threshold(year) = base_threshold * (1 + INFLATION_RATE) ^ (year - BASE_YEAR)
//
// Thresholds are kept at full floating-point precision. The IRS in practice
// rounds to the nearest fifty dollars, but for an internal projection model
// the unrounded value is more accurate when compounded over five years.
//
// To change the inflation assumption (e.g. 2.5% or a CPI series), edit the
// INFLATION_RATE constant. To stop synthesizing once published data is
// available (e.g. when 2027 is published), bump BASE_YEAR.

const BRACKET_PROJECTOR = {
  BASE_YEAR: 2026,
    INFLATION_RATE: 0.02,
      MAX_PROJECTED_YEAR: 2031,

        /**
           * Return a per-year inflation factor relative to the base year.
              *   factor(2026) = 1
                 *   factor(2027) = 1.02
                    *   factor(2028) = 1.0404
                       *   ...
                          *
                             * @param {number} year
                                * @returns {number}
                                   */
                                     factor(year) {
                                         if (year <= this.BASE_YEAR) return 1;
                                             return Math.pow(1 + this.INFLATION_RATE, year - this.BASE_YEAR);
                                               },

                                                 /**
                                                    * Project a single bracket array forward to a given year.
                                                       * Each bracket has shape { threshold: number, rate: number }.
                                                          * Threshold is multiplied by the inflation factor; rate is unchanged.
                                                             * The sentinel 999999999 (used as a JSON-safe Infinity) is preserved.
                                                                *
                                                                   * @param {Array<{threshold:number, rate:number}>} brackets
                                                                      * @param {number} year
                                                                         * @returns {Array<{threshold:number, rate:number}>}
                                                                            */
                                                                              projectBracketSet(brackets, year) {
                                                                                  const f = this.factor(year);
                                                                                      return brackets.map(b => ({
                                                                                            rate: b.rate,
                                                                                                  threshold: (b.threshold >= 999999999) ? b.threshold : b.threshold * f
                                                                                                      }));
                                                                                                        },
                                                                                                        
                                                                                                          /**
                                                                                                             * Resolve the bracket set for any year, falling back to projection
                                                                                                                * when published data does not exist for that year.
                                                                                                                   *
                                                                                                                      * Lookup contract:
                                                                                                                         *   getPublishedBrackets(jurisdictionId, year, filingStatus) -> brackets | null
                                                                                                                            *
                                                                                                                               * @param {Function} getPublishedBrackets
                                                                                                                                  * @param {string} jurisdictionId  e.g. 'federal' or a state code like 'CA'
                                                                                                                                     * @param {number} year
                                                                                                                                        * @param {string} filingStatus    'single' | 'mfj' | 'mfs' | 'hoh'
                                                                                                                                           * @returns {Array<{threshold:number, rate:number}>}
                                                                                                                                              */
                                                                                                                                                resolveBrackets(getPublishedBrackets, jurisdictionId, year, filingStatus) {
                                                                                                                                                    const published = getPublishedBrackets(jurisdictionId, year, filingStatus);
                                                                                                                                                        if (published) return published;
                                                                                                                                                            const baseBrackets = getPublishedBrackets(jurisdictionId, this.BASE_YEAR, filingStatus);
                                                                                                                                                                if (!baseBrackets) {
                                                                                                                                                                      throw new Error(
                                                                                                                                                                              'No base-year bracket data for ' + jurisdictionId + ' / ' + filingStatus
                                                                                                                                                                                    );
                                                                                                                                                                                        }
                                                                                                                                                                                            return this.projectBracketSet(baseBrackets, year);
                                                                                                                                                                                              }
                                                                                                                                                                                              };
                                                                                                                                                                                              
