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

// Hard cap on dollar-amount inputs. A two-digit typo (e.g. "$1,000,000"
// → "$10,000,000,000" by accidentally appending zeros) can otherwise
// propagate $1B+ figures into projections that produce $607T tax bills
// and no warning. $1B is well above any realistic single client's
// taxable transaction; values past it are clipped + flagged. (P2-4.)
const RETT_USD_CAP = 1e9;

function parseUSD(s) {
  if (s == null) return 0;
  if (typeof s === 'number') {
    if (!isFinite(s)) return 0;
    if (s >  RETT_USD_CAP) return RETT_USD_CAP;
    if (s < -RETT_USD_CAP) return -RETT_USD_CAP;
    return s;
  }
  // Normalize Unicode so full-width digits ("１００００"), Arabic
  // numerals, and superscripts collapse to ASCII before parsing.
  // Without this, "１００００" stripped to "" and parsed as 0. (P2-3.)
  let raw;
  try {
    raw = String(s).normalize('NFKC');
  } catch (e) {
    raw = String(s);
  }
  // Strip whitespace + dollar signs + commas. Keep digits, dot, minus,
  // 'e'/'E' for scientific notation, and '+' for positive exponents.
  const cleaned = raw.replace(/[^0-9.\-eE+]/g, '');
  if (cleaned === '' || cleaned === '-' || cleaned === '.') return 0;
  // parseFloat happily accepts "1e9" — that's a real concern when a
  // user types "1e9" thinking it'll be flagged but ends up as
  // $1,000,000,000. We allow it for power users (it's a valid number)
  // but apply the global cap below so a typo can't run away. (P2-1.)
  const n = parseFloat(cleaned);
  if (!isFinite(n)) return 0;
  if (n >  RETT_USD_CAP) return RETT_USD_CAP;
  if (n < -RETT_USD_CAP) return -RETT_USD_CAP;
  return n;
}

function parsePct(s) {
  if (s == null) return 0;
  if (typeof s === 'number') return s;
  const cleaned = String(s).replace(/[^0-9.\-]/g, '');
  const n = parseFloat(cleaned);
  if (isNaN(n)) return 0;
  return n > 1 ? n / 100 : n;
}

// inputs-collector returns cfg with `tierKey` + `investment`. The
// engines (recommendSale, ProjectionEngine.run, multi-year solver)
// expect `strategyKey` + `investedCapital` + `years`. Patch the
// engine-flavored aliases in one place so every cfg consumer stays
// in sync — this used to be inlined at 4 sites (controls.js,
// pill-toggles.js x2, projection-dashboard-render.js) and routinely
// drifted (e.g. one site forgot `cfg.years` and the multi-year
// solver got horizon=undefined → silently 5).
//
// Idempotent: safe to call on an already-flavored cfg.
function rettFlavorEngineCfg(cfg) {
  if (!cfg) return cfg;
  if (cfg.strategyKey == null)     cfg.strategyKey     = cfg.tierKey;
  if (cfg.investedCapital == null) cfg.investedCapital = cfg.investment;
  if (cfg.years == null)           cfg.years           = cfg.horizonYears;
  return cfg;
}

// Single source of truth for "did the engine actually deploy any
// Brooklyn capital?" used by the savings ribbon, narrative, dashboard
// KPI tiles, strategy summary hero, and chart-suppression logic. All
// of these used to re-derive this independently — keeping the rule in
// one place means the dashboard, ribbon, and narrative can never
// disagree on whether to suppress fees / show "no engagement"
// messaging.
function rettEngineEngaged(comp, projectionResult) {
  // Highest-priority signal: explicit engaged:false from the
  // projection engine's below-min path.
  if (projectionResult && projectionResult.engaged === false) return false;
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
