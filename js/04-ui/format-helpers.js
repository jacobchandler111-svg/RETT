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

// Single source of truth for "did the engine actually deploy any
// Brooklyn capital?" used by the savings ribbon, narrative, dashboard
// KPI tiles, strategy summary hero, and chart-suppression logic. All
// of these used to re-derive this independently — keeping the rule in
// one place means the dashboard, ribbon, and narrative can never
// disagree on whether to suppress fees / show "no engagement"
// messaging.
function rettEngineEngaged(comp, projectionResult) {
  if (comp && Array.isArray(comp.rows) && comp.rows.length) {
    return comp.rows.some(function (r) {
      return (r.investmentThisYear || 0) > 0 ||
             (r.gainRecognized || 0) > 0 ||
             (r.lossApplied || 0) > 0;
    });
  }
  if (projectionResult && Array.isArray(projectionResult.years) && projectionResult.years.length) {
    return projectionResult.years.some(function (y) {
      return (y.investmentThisYear || 0) > 0 ||
             (y.grossLoss || 0) > 0;
    });
  }
  return false;
}

// Headline totals for the dashboard / ribbon / narrative. Returns the
// engaged flag plus the four numbers everyone needs in one place so
// drift can't sneak back in.
function rettResolveDisplayTotals(comp, projectionResult) {
  var engaged = rettEngineEngaged(comp, projectionResult);
  var totalSavings = 0;
  var brooklynFees = 0;
  var brookhavenFees = 0;
  if (comp) {
    if (comp.totalSavings != null) totalSavings = comp.totalSavings;
    else if (Array.isArray(comp.rows)) {
      comp.rows.forEach(function (r) {
        var no = r.baseline ? r.baseline.total : 0;
        var w  = r.withStrategy ? r.withStrategy.total : no;
        totalSavings += (no - w);
      });
    }
    if (comp.deferred && comp.totalFees != null) {
      brooklynFees = comp.totalFees;
    }
    if (comp.totalBrookhavenFees != null) brookhavenFees = comp.totalBrookhavenFees;
  }
  // Non-deferred path: prefer projection-engine cumulativeFees.
  if (!brooklynFees && projectionResult && projectionResult.totals && projectionResult.totals.cumulativeFees != null) {
    brooklynFees = projectionResult.totals.cumulativeFees;
  }
  // No-engagement: zero out fees so the ribbon doesn't show the
  // Brookhaven setup fee for clients who aren't engaging.
  if (!engaged) {
    brooklynFees = 0;
    brookhavenFees = 0;
  }
  return {
    engaged: engaged,
    totalSavings: totalSavings,
    brooklynFees: brooklynFees,
    brookhavenFees: brookhavenFees,
    net: totalSavings - brooklynFees - brookhavenFees
  };
}
