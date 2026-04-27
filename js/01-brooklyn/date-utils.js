// FILE: js/01-brooklyn/date-utils.js
// Date parsing helpers used across Brooklyn engines.
// Carried over from Brookhaven with no behavior changes.

/**
 * Parse a YYYY-MM-DD string as a local-time Date so the JavaScript runtime
 * does not implicitly convert it to UTC and shift the day.
 * Returns the current date if no input is provided.
 *
 * @param {string} dateStr - ISO-style date (YYYY-MM-DD or with T separator).
 * @returns {Date}
 */
function parseLocalDate(dateStr) {
    if (!dateStr) return new Date();
    const parts = String(dateStr).split(/[-/T]/);
    return new Date(
          parseInt(parts[0], 10),
          parseInt(parts[1], 10) - 1,
          parseInt(parts[2], 10) || 1
        );
}
