// FILE: js/04-ui/format-helpers.js
// Pure formatting helpers for currency, percent, and integer numbers.

function fmtUSD(n, opts) {
  opts = opts || {};
  if (n == null || isNaN(n)) return '-';
  const decimals = opts.decimals != null ? opts.decimals : 0;
  return n.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals
  });
}

function fmtPct(n, opts) {
  opts = opts || {};
  if (n == null || isNaN(n)) return '-';
  const decimals = opts.decimals != null ? opts.decimals : 1;
  return (n * 100).toFixed(decimals) + '%';
}

function fmtNum(n, opts) {
  opts = opts || {};
  if (n == null || isNaN(n)) return '-';
  const decimals = opts.decimals != null ? opts.decimals : 0;
  return n.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals
  });
}

function fmtSignedUSD(n, opts) {
  if (n == null || isNaN(n)) return '-';
  const formatted = fmtUSD(Math.abs(n), opts);
  if (n > 0) return '+' + formatted;
  if (n < 0) return '-' + formatted;
  return formatted;
}

function parseUSD(s) {
  if (s == null) return 0;
  if (typeof s === 'number') return s;
  const cleaned = String(s).replace(/[^0-9.\-]/g, '');
  const n = parseFloat(cleaned);
  return isNaN(n) ? 0 : n;
}

function parsePct(s) {
  if (s == null) return 0;
  if (typeof s === 'number') return s;
  const cleaned = String(s).replace(/[^0-9.\-]/g, '');
  const n = parseFloat(cleaned);
  if (isNaN(n)) return 0;
  return n > 1 ? n / 100 : n;
}
