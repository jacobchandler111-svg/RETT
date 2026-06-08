// FILE: js/04-ui/projection-dashboard-render.js
// Multi-year projection dashboard for the Projection page (Page 2).
// Renders into #projection-table:
//   1. KPI tile row (Total Tax Saved, Cumulative Fees, Net Benefit, ROI)
//   2. SVG paired bar chart: Without vs With strategy per year. Bars
//      carry data-rett-bar / data-label / data-amount; a viewport-fixed
//      tooltip wired once at module load shows "Without Strategy (YYYY)
//      / $X owed" while the cursor is over a bar.
//   3. Side-by-side pie charts (do-nothing vs with-planning).
//   4. Compact data table with year-by-year detail.
//
// Uses RETT's existing blue palette and styling; depends on no external
// chart library. Reads from window.__lastResult populated by controls.js.
//
// Public entry point: renderProjectionDashboard()

(function (root) {
  'use strict';

  // Floating tooltip wired once on first load. Bars in the chart carry
  // data-rett-bar / data-label / data-amount attributes; on mousemove
  // we read those off whatever rect the cursor is over and position
  // the tooltip near the cursor. Self-init so it survives every
  // dashboard re-render without re-wiring.
  function _initBarTooltipOnce() {
    if (root.__rettBarTooltipInit) return;
    root.__rettBarTooltipInit = true;
    var doc = root.document;
    if (!doc || !doc.body) return;
    var tip = doc.createElement('div');
    tip.className = 'rett-bar-tooltip';
    tip.style.display = 'none';
    doc.body.appendChild(tip);
    doc.addEventListener('mousemove', function (e) {
      var t = e.target;
      var role = t && t.getAttribute && t.getAttribute('data-rett-bar');
      if (!role) {
        if (tip.style.display !== 'none') tip.style.display = 'none';
        return;
      }
      tip.innerHTML =
        '<strong>' + (t.getAttribute('data-label') || '') + '</strong>' +
        '<div>' + (t.getAttribute('data-amount') || '') + ' owed</div>';
      tip.style.display = 'block';
      // Clamp to viewport so the tooltip doesn't run off the right edge
      // when hovering the last bar.
      var x = e.clientX + 14;
      var y = e.clientY + 14;
      var maxX = (root.innerWidth || 1200) - tip.offsetWidth - 8;
      if (x > maxX) x = e.clientX - tip.offsetWidth - 14;
      tip.style.left = x + 'px';
      tip.style.top  = y + 'px';
    });
    doc.addEventListener('scroll', function () { tip.style.display = 'none'; }, true);
  }
  if (typeof root.document !== 'undefined') {
    if (root.document.readyState === 'loading') {
      root.document.addEventListener('DOMContentLoaded', _initBarTooltipOnce);
    } else {
      _initBarTooltipOnce();
    }
  }

  function _fmt(n) {
    if (n == null || !isFinite(n)) return '—';
    if (typeof fmtUSD === 'function') return fmtUSD(n);
    var sign = n < 0 ? '-' : '';
    var v = Math.round(Math.abs(n));
    return sign + '$' + v.toLocaleString('en-US');
  }

  function _fmtCompact(n) {
    if (n == null || !isFinite(n)) return '—';
    var abs = Math.abs(n);
    var sign = n < 0 ? '-' : '';
    if (abs >= 1e6) return sign + '$' + (abs / 1e6).toFixed(abs >= 1e7 ? 1 : 2) + 'M';
    if (abs >= 1e3) return sign + '$' + (abs / 1e3).toFixed(0) + 'k';
    return sign + '$' + Math.round(abs).toLocaleString('en-US');
  }

  // Human-readable payment / gain-recognition schedule for the deferred
  // §453 installment strategies (B Installment Sale, C Structured Sale).
  // Returns null for the immediate strategy (A) or any non-installment
  // cfg. Derived PURELY from the cfg fields the engine itself consumes
  // (tax-comparison.js ~764-911: totalLT, _gpContractPrice, the GP ratio,
  // y0DownPayment, installmentScheduleWeights), so the terms displayed to
  // the advisor are exactly what the optimizer modeled — no re-derivation
  // that could drift from the engine.
  //
  //   contractPrice (GP) = salePrice − recapture
  //   GP ratio           = totalLT / contractPrice
  //   Y0 (sale year)     = down payment D + recapture cash; D recognizes
  //                        D × GP of LT gain, recap is Y0 ordinary
  //   Installment year i = (contractPrice − D) × weight[i] cash, which
  //                        recognizes that × GP of LT gain (Jan 1 dates)
  function _describeInstallmentSchedule(cfg) {
    if (!cfg) return null;
    var N = Math.max(0, Math.min(3, Number(cfg.installmentPayments) || 0));
    if (N < 1) return null;                 // immediate (A) — no schedule
    var sale  = Math.max(0, Number(cfg.salePrice) || 0);
    var basis = Math.max(0, Number(cfg.costBasis) || 0);
    var recap = Math.max(0, Number(cfg.acceleratedDepreciation) || 0);
    var stp   = Math.max(0, Number(cfg.shortTermPropertyGain) || 0);
    var totalLT  = Math.max(0, sale - basis - recap - stp);
    var contract = Math.max(0, sale - recap);          // §453 GP contract price
    var gp = contract > 0 ? totalLT / contract : 0;
    var D = Math.max(0, Math.min(Number(cfg.y0DownPayment) || 0, contract));
    // Forced Y0 payment — sale proceeds the seller must take at closing to
    // pay off outstanding debt / personal-use cash (cfg.forcedY0Payment =
    // amount-owed + personal-use, summed in inputs-collector.js). That cash
    // is received at closing, so for a §453 deferral it recognizes F × GP
    // of LT gain in Y0 and is NOT available to deploy to Brooklyn. Capped,
    // together with the down payment, at the contract price — mirrors the
    // engine's _forcedY0Payment handling (tax-comparison.js ~904-911), so
    // the schedule reflects the same Y0 gain the engine recognizes.
    var F = Math.max(0, Math.min(Number(cfg.forcedY0Payment) || 0, Math.max(0, contract - D)));
    var y0 = Number(cfg.year1) || (new Date()).getFullYear();
    var weights = (Array.isArray(cfg.installmentScheduleWeights)
          && cfg.installmentScheduleWeights.length === N)
          ? cfg.installmentScheduleWeights : null;
    var remaining = Math.max(0, contract - D - F);
    var rows = [];   // { year, cash, ltGain, recap, downPayment, debtPayoff, atClosing }
    if (D > 0.5 || F > 0.5 || recap > 0.5) {
      rows.push({ year: y0, cash: D + F + recap, ltGain: (D + F) * gp,
        recap: recap, downPayment: D, debtPayoff: F, atClosing: true });
    }
    for (var i = 0; i < N; i++) {
      var w = weights ? Math.max(0, Number(weights[i]) || 0) : (1 / N);
      var pay = remaining * w;
      rows.push({ year: y0 + 1 + i, cash: pay, ltGain: pay * gp,
        recap: 0, downPayment: 0, debtPayoff: 0, atClosing: false });
    }
    return { gpRatio: gp, totalLT: totalLT, downPayment: D, debtPayoff: F, payments: N, rows: rows };
  }

  // One-line "Recommended terms: …" summary for the comparison table and
  // the temp page. Empty string when there's no installment schedule.
  function _scheduleSummaryLine(cfg) {
    var s = _describeInstallmentSchedule(cfg);
    if (!s || !s.rows.length) return '';
    var parts = s.rows.map(function (r) {
      if (!r.atClosing) return _fmt(r.cash) + ' on Jan 1, ' + r.year;
      var note = (r.debtPayoff > 0.5) ? ', incl. ' + _fmt(r.debtPayoff) + ' debt payoff' : '';
      return _fmt(r.cash) + ' at closing (' + r.year + note + ')';
    });
    return 'Recommended terms: ' + parts.join('  +  ');
  }

  function _kpiTile(label, value, sub, kind) {
    var cls = 'rett-kpi-tile';
    if (kind === 'positive') cls += ' kpi-positive';
    else if (kind === 'negative') cls += ' kpi-negative';
    return '<div class="' + cls + '">' +
      '<div class="rett-kpi-label">' + label + '</div>' +
      '<div class="rett-kpi-value">' + value + '</div>' +
      (sub ? '<div class="rett-kpi-sub">' + sub + '</div>' : '') +
      '</div>';
  }

  function _buildKpiRow(years, totals, scenarioComp, scenarioResult) {
    var totalSave = 0, cumFees = 0, totalNo = 0, totalWith = 0;
    years.forEach(function (y) {
      // Prefer the do-nothing baseline (lump-Y1, what the client would
      // owe if they sold today and ignored Brooklyn) over the matched-
      // timing baseline (same recognition schedule but no losses) so
      // the KPI Total Tax Saved agrees with the strategy comparison
      // row, the ribbon, and the bar chart. Without this preference
      // the KPI showed savings ~$4K higher than the row for a deferred
      // structured sale because matched-timing back-loaded gain into
      // higher-bracket years that the client wouldn't actually choose.
      var no = (y.taxNoBrooklynDoNothing != null) ? y.taxNoBrooklynDoNothing : (y.taxNoBrooklyn || 0);
      var w = (y.taxWithBrooklyn != null) ? y.taxWithBrooklyn : no;
      totalSave += (no - w);
      cumFees += (y.fee || 0);
      totalNo += no;
      totalWith += w;
    });
    // Per-section render: when scenarioComp is supplied (multi-scenario
    // stack), use it directly so each section's KPI tile reflects ITS
    // own scenario's fees rather than the globally-active one.
    var comp = scenarioComp || window.__lastComparison;
    var lastResult = scenarioResult || window.__lastResult;
    // In deferred mode, comp.totalFees is the tranche-aware authoritative
    // figure (e.g. Y1-Y2 only basis, Y3 basis + gain release). Don't
    // override with projection-engine totals.cumulativeFees, which holds
    // cfg.investment constant every year and underestimates fees for
    // a structured-sale schedule. Matches savings-ribbon's logic so
    // the KPI Net Benefit and the ribbon Net Benefit agree.
    if (comp && comp.deferred && comp.totalFees != null) {
      cumFees = comp.totalFees;
    } else if (totals && totals.cumulativeFees != null) {
      cumFees = totals.cumulativeFees;
    }

    var brookhavenFees = (comp && comp.totalBrookhavenFees) || 0;
    // Single-source engagement detection (format-helpers.rettEngineEngaged).
    var _engineEngaged = (typeof window.rettEngineEngaged === 'function')
      ? window.rettEngineEngaged(comp, lastResult)
      : (totalSave !== 0 || cumFees > 0);
    if (!_engineEngaged) {
      cumFees = 0;
      brookhavenFees = 0;
    }
    var allFees = cumFees + brookhavenFees;
    var net = totalSave - allFees;
    var roi = allFees > 0 ? (net / allFees * 100) : 0;
    // When fees are exactly $0 with positive savings, the old code
    // displayed "∞" — hard to defend in front of a client and not
    // animatable. Show "1000%+" as a sensible cap that still
    // communicates the "all upside, no fee drag" message.
    var roiTxt;
    if (allFees <= 0 && totalSave > 0) {
      roiTxt = '1000%+';
    } else {
      roiTxt = roi.toFixed(0) + '%';
    }
    var pctReduce = totalNo > 0 ? (totalSave / totalNo * 100).toFixed(1) + '% lower tax' : '';

    var savedKind = totalSave > 0 ? 'positive' : (totalSave < 0 ? 'negative' : '');
    var netKind = net > 0 ? 'positive' : (net < 0 ? 'negative' : '');
    var roiKind = (allFees <= 0 && totalSave > 0)
      ? 'positive'
      : (isFinite(roi) && roi > 0 ? 'positive' : (isFinite(roi) && roi < 0 ? 'negative' : ''));

    var brookhavenTile = brookhavenFees > 0
      ? _kpiTile('Brookhaven Fees', _fmt(brookhavenFees), 'Setup + quarterly retainer', '')
      : '';
    return '<div class="rett-kpi-row">' +
      _kpiTile('Total Tax Saved', _fmt(totalSave), pctReduce + ' over ' + years.length + ' yrs', savedKind) +
      _kpiTile('Brooklyn Fees', _fmt(cumFees), 'Strategy fees (mgmt + financing)', '') +
      brookhavenTile +
      _kpiTile('Net Benefit', _fmt(net), 'Savings minus all fees', netKind) +
      _kpiTile('Return on Planning', roiTxt, 'Net benefit / fees', roiKind) +
      '</div>';
  }

  // Build the SVG paired bar chart. Bars carry data-* attributes that
  // _initBarTooltipOnce reads on mousemove to render a floating tooltip
  // ("Without Strategy (2026)" / "$4,200,000 owed"). No constant labels
  // above the bars — the tooltip is the single source of detail.
  function _buildChart(years) {
    var n = years.length;
    if (!n) return '';

    var W = 760, H = 340;
    var padL = 60, padR = 20, padT = 20, padB = 50;
    var innerW = W - padL - padR;
    var innerH = H - padT - padB;

    // Compute scales. The "Without Strategy" bar is the do-nothing
    // scenario — all property gain hits Y1 as a lump sum, Y2+ are just
    // ordinary income. Falls back to taxNoBrooklyn when the engine
    // didn't supply a do-nothing series (immediate path, where the
    // matched-timing baseline already piles everything in Y1).
    var maxBar = 0;
    var data = years.map(function (y) {
      var no = (y.taxNoBrooklynDoNothing != null) ? y.taxNoBrooklynDoNothing : (y.taxNoBrooklyn || 0);
      var w = (y.taxWithBrooklyn != null) ? y.taxWithBrooklyn : no;
      if (no > maxBar) maxBar = no;
      if (w > maxBar) maxBar = w;
      return { year: y.year, no: no, w: w };
    });
    if (maxBar <= 0) maxBar = 1;
    var pow = Math.pow(10, Math.floor(Math.log10(maxBar)));
    var yMax = Math.ceil(maxBar / pow) * pow;

    var groupW = innerW / n;
    var barW = Math.min(28, groupW * 0.32);
    var gap = 6;

    var svg = '';
    svg += '<svg class="rett-chart-svg" viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="xMidYMid meet">';

    // Y-axis grid lines (left axis = tax dollars)
    var ticks = 4;
    for (var i = 0; i <= ticks; i++) {
      var v = yMax * i / ticks;
      var y = padT + innerH - (v / yMax) * innerH;
      svg += '<line x1="' + padL + '" x2="' + (W - padR) + '" y1="' + y + '" y2="' + y +
             '" stroke="rgba(95,168,255,0.12)" stroke-width="1"/>';
      svg += '<text x="' + (padL - 8) + '" y="' + (y + 4) + '" text-anchor="end" ' +
             'font-size="11" fill="#8fb3e0" font-family="inherit">' + _fmtCompact(v) + '</text>';
    }

    data.forEach(function (d, idx) {
      var cx = padL + groupW * idx + groupW / 2;
      var x1 = cx - barW - gap / 2;
      var x2 = cx + gap / 2;
      var hNo = (d.no / yMax) * innerH;
      var hW  = (d.w  / yMax) * innerH;
      var yNo = padT + innerH - hNo;
      var yW  = padT + innerH - hW;

      svg += '<rect class="rett-bar" data-rett-bar="without"' +
             ' data-label="Without Strategy (' + d.year + ')"' +
             ' data-amount="' + _fmt(d.no) + '"' +
             ' x="' + x1 + '" y="' + yNo + '" width="' + barW + '" height="' + hNo +
             '" fill="#5fa8ff" rx="2"/>';
      svg += '<rect class="rett-bar" data-rett-bar="with"' +
             ' data-label="With Strategy (' + d.year + ')"' +
             ' data-amount="' + _fmt(d.w) + '"' +
             ' x="' + x2 + '" y="' + yW + '" width="' + barW + '" height="' + hW +
             '" fill="#2c5aa0" rx="2"/>';

      // X-axis label
      svg += '<text x="' + cx + '" y="' + (padT + innerH + 18) + '" text-anchor="middle" ' +
             'font-size="12" fill="#b3d4ff" font-family="inherit">' + d.year + '</text>';
    });

    // Axis lines
    svg += '<line x1="' + padL + '" x2="' + padL + '" y1="' + padT + '" y2="' + (padT + innerH) +
           '" stroke="rgba(95,168,255,0.3)" stroke-width="1"/>';
    svg += '<line x1="' + padL + '" x2="' + (W - padR) + '" y1="' + (padT + innerH) + '" y2="' + (padT + innerH) +
           '" stroke="rgba(95,168,255,0.3)" stroke-width="1"/>';

    svg += '</svg>';

    var legend =
      '<div class="rett-chart-legend">' +
        '<span><span class="rett-legend-swatch swatch-without"></span>Without Strategy</span>' +
        '<span><span class="rett-legend-swatch swatch-with"></span>With Strategy</span>' +
      '</div>';

    return '<div class="rett-chart-wrap">' +
      '<div class="rett-chart-title"><span>Year-by-Year Tax: Without Strategy vs With Strategy</span>' + legend + '</div>' +
      svg +
      '</div>';
  }

  // ---- Pie charts (do-nothing vs with-planning) ----------------------
  // Side-by-side comparison of total cash inflow over the horizon
  // (sale proceeds + ordinary income across all years) and what
  // percentage gets eaten by tax (and fees, on the planning side).
  // The pies are scaled to the SAME denominator, so visual area =
  // visual area; the green "Kept" slice growing is the headline.
  function _polarToCart(cx, cy, r, angle) {
    return [cx + r * Math.cos(angle), cy + r * Math.sin(angle)];
  }
  function _arcPath(cx, cy, r, startA, endA) {
    // Full-circle case (single slice = 100%) needs two arcs because
    // SVG can't draw a 360° arc in one path command.
    if (Math.abs(endA - startA) >= Math.PI * 2 - 1e-6) {
      var p1 = _polarToCart(cx, cy, r, 0);
      var p2 = _polarToCart(cx, cy, r, Math.PI);
      return 'M' + p1[0] + ',' + p1[1] +
             ' A' + r + ',' + r + ' 0 1 1 ' + p2[0] + ',' + p2[1] +
             ' A' + r + ',' + r + ' 0 1 1 ' + p1[0] + ',' + p1[1] + ' Z';
    }
    var s = _polarToCart(cx, cy, r, startA);
    var e = _polarToCart(cx, cy, r, endA);
    var large = (endA - startA) > Math.PI ? 1 : 0;
    return 'M' + cx + ',' + cy +
           ' L' + s[0] + ',' + s[1] +
           ' A' + r + ',' + r + ' 0 ' + large + ' 1 ' + e[0] + ',' + e[1] +
           ' Z';
  }

  function _pieCard(slices, title, subtitle) {
    var total = slices.reduce(function (s, sl) { return s + Math.max(0, sl.value); }, 0);
    if (total <= 0) return '';
    var W = 240, H = 240, cx = W / 2, cy = H / 2, r = 100;
    var paths = '';
    var legend = '';
    var angle = -Math.PI / 2;
    slices.forEach(function (sl) {
      var v = Math.max(0, sl.value);
      if (v <= 0) return;
      var portion = v / total;
      var nextAngle = angle + portion * Math.PI * 2;
      var pct = (portion * 100).toFixed(1) + '%';
      paths += '<path d="' + _arcPath(cx, cy, r, angle, nextAngle) +
               '" fill="' + sl.color + '" stroke="#0a1929" stroke-width="2">' +
               '<title>' + sl.label + ': ' + _fmt(v) + ' (' + pct + ')</title></path>';
      legend +=
        '<div class="rett-pie-legend-item">' +
          '<span class="rett-pie-swatch" style="background:' + sl.color + '"></span>' +
          '<span>' + sl.label + '</span>' +
          '<strong>' + pct + '</strong>' +
          '<span class="muted">' + _fmt(v) + '</span>' +
        '</div>';
      angle = nextAngle;
    });
    return '<div class="rett-pie-card">' +
      '<div class="rett-pie-title">' + title + '</div>' +
      (subtitle ? '<div class="rett-pie-subtitle">' + subtitle + '</div>' : '') +
      '<svg viewBox="0 0 ' + W + ' ' + H + '" class="rett-pie-svg" preserveAspectRatio="xMidYMid meet">' + paths + '</svg>' +
      '<div class="rett-pie-legend">' + legend + '</div>' +
      '</div>';
  }

  function _buildPies(years, comp, result) {
    if (!comp || !Array.isArray(comp.rows) || !comp.rows.length) return '';

    // Total cash inflow over the horizon: sale price (one-time, hits Y1)
    // plus ordinary income for each year, inflated 2%/yr to mirror the
    // tax engine's bracket projection. Same denominator drives both
    // pies, so the green "Kept" slice difference reads as pure planning
    // value.
    var cfg = (result && result.config) || {};
    var salePrice = cfg.salePrice || (
      (typeof window.__rettSumPropertyField === 'function')
        ? window.__rettSumPropertyField('sale-price')
        : (parseUSD((document.getElementById('sale-price') || {}).value) || 0)
    );
    var baseOrd = cfg.baseOrdinaryIncome || 0;
    var inflRate = (window.TAX_DATA && typeof window.TAX_DATA.inflationRate === 'number')
      ? window.TAX_DATA.inflationRate : 0.02;
    var totalOrd = 0;
    for (var i = 0; i < years.length; i++) {
      totalOrd += baseOrd * Math.pow(1 + inflRate, i);
    }
    var totalInflow = salePrice + totalOrd;
    if (totalInflow <= 0) return '';

    var totalTaxDoNothing = 0;
    var totalTaxWith = 0;
    comp.rows.forEach(function (r) {
      var dn = (r.doNothingBaseline && r.doNothingBaseline.total != null)
        ? r.doNothingBaseline.total
        : (r.baseline ? r.baseline.total : 0);
      totalTaxDoNothing += dn;
      totalTaxWith += (r.withStrategy ? r.withStrategy.total : 0);
    });
    var brooklynFees = (comp.totalFees != null) ? comp.totalFees
      : ((result && result.totals && result.totals.cumulativeFees != null) ? result.totals.cumulativeFees : 0);
    var brookhavenFees = comp.totalBrookhavenFees || 0;
    var totalFees = brooklynFees + brookhavenFees;

    var keptDoNothing = Math.max(0, totalInflow - totalTaxDoNothing);
    var keptWith = Math.max(0, totalInflow - totalTaxWith - totalFees);

    var subtitle = 'Of ' + _fmt(totalInflow) + ' total inflow over ' + years.length + ' yrs';

    var pieDoNothing = _pieCard([
      { label: 'Tax Owed', value: totalTaxDoNothing, color: '#d96f6f' },
      { label: 'Kept',     value: keptDoNothing,     color: '#5fd97e' }
    ], 'If You Do Nothing', subtitle);

    var pieWith = _pieCard([
      { label: 'Tax Owed', value: totalTaxWith, color: '#d96f6f' },
      { label: 'Fees',     value: totalFees,    color: '#f0b041' },
      { label: 'Kept',     value: keptWith,     color: '#5fd97e' }
    ], 'With Planning', subtitle);

    if (!pieDoNothing && !pieWith) return '';
    return '<div class="rett-pies-row">' + pieDoNothing + pieWith + '</div>';
  }

  // Map a numeric value to a CSS class so positive/negative deltas read at a
  // glance (Holistiplan / RightCapital convention).
  function _deltaClass(n) {
    if (!isFinite(n) || n === 0) return '';
    return n > 0 ? 'rett-delta-positive' : 'rett-delta-negative';
  }

  function _buildTable(years) {
    var head = '<tr>' +
      '<th title="Calendar tax year">Year</th>' +
      '<th title="Federal + state tax owed without the Brooklyn strategy">Tax Without</th>' +
      '<th title="Federal + state tax owed with the Brooklyn strategy applied">Tax With</th>' +
      '<th title="Tax Without minus Tax With. Green = strategy reduces tax this year.">Savings (Δ)</th>' +
      '<th title="Long-term capital gain recognized this year. Savings appear in years where gain is recognized AND Brooklyn losses absorb it — that is what drives the With-Strategy tax down.">Gain Recognized</th>' +
      '<th title="New capital deposited into Brooklyn this year (basis cash + structured-sale tranche release)">New Investment</th>' +
      '<th title="Short-term capital losses generated by Brooklyn this year (before applying to gains)">Loss Generated</th>' +
      '<th title="Brooklyn management fee for the year">Fee</th>' +
    '</tr>';
    var body = '';
    var cNo = 0, cWith = 0, cSave = 0, cGain = 0, cLoss = 0, cFee = 0;
    var prevInv = 0;
    years.forEach(function (y) {
      var no = y.taxNoBrooklyn || 0;
      var w = (y.taxWithBrooklyn != null) ? y.taxWithBrooklyn : no;
      var save = no - w;
      // investmentThisYear is the cumulative position at year end. NEW
      // investment for THIS year is the delta from the prior year. The
      // total of these deltas equals the final position (= last year's
      // investmentThisYear), which is the meaningful total to show.
      var curInv = y.investmentThisYear || 0;
      var newInv = Math.max(0, curInv - prevInv);
      prevInv = curInv;
      var gain = y.gainRecognized || 0;
      cNo += no; cWith += w; cSave += save;
      cGain += gain;
      cLoss += (y.grossLoss || 0);
      cFee += (y.fee || 0);
      body += '<tr>' +
        '<td>' + y.year + '</td>' +
        '<td>' + _fmt(no) + '</td>' +
        '<td>' + _fmt(w) + '</td>' +
        '<td class="rett-savings-cell ' + _deltaClass(save) + '">' + _fmt(save) + '</td>' +
        '<td>' + (gain > 0 ? _fmt(gain) : '—') + '</td>' +
        '<td>' + _fmt(newInv) + '</td>' +
        '<td>' + _fmt(y.grossLoss) + '</td>' +
        '<td>' + _fmt(y.fee) + '</td>' +
      '</tr>';
    });
    var totalInvested = prevInv; // sum of deltas = final cumulative
    body += '<tr class="rett-total-row">' +
      '<td>Total</td>' +
      '<td>' + _fmt(cNo) + '</td>' +
      '<td>' + _fmt(cWith) + '</td>' +
      '<td class="rett-savings-cell ' + _deltaClass(cSave) + '">' + _fmt(cSave) + '</td>' +
      '<td>' + (cGain > 0 ? _fmt(cGain) : '—') + '</td>' +
      '<td>' + _fmt(totalInvested) + '</td>' +
      '<td>' + _fmt(cLoss) + '</td>' +
      '<td>' + _fmt(cFee) + '</td>' +
    '</tr>';
    return '<div class="rett-table-wrap rett-table-scroll">' +
      '<table class="rett-data-table rett-data-table-frozen"><thead>' + head + '</thead><tbody>' + body + '</tbody></table>' +
      '</div>';
  }

  // ---- Strategy Comparison panel ------------------------------------
  // Three real-world planning options for the same client scenario:
  //   A. Sell now (Year 1) — Brooklyn deployed same year, gain absorbed Y1.
  //   B. Delay close to Jan 1 of next year — gain hits Y2 naturally
  //      (no structured-sale product); Brooklyn builds STCL all of Y1
  //      to absorb gain when it lands.
  //   C. Structured sale at the user's duration setting — gain deferred
  //      via insurance product across the legal recognition window.
  //
  // All three are scored against the SAME do-nothing baseline (full
  // gain in Y1 with no Brooklyn losses) so net-benefit numbers are
  // directly comparable. The highest net is flagged "RECOMMENDED."
  //
  // The dashboard's active scenario (KPI tiles, chart, pies) reflects
  // whichever leverage/horizon/recognition the user picked or auto-pick
  // chose — it may or may not match the recommended scenario here.
  function _scenarioMetrics(cfg) {
    if (!cfg) return null;
    var horizon = cfg.horizonYears || cfg.years || 5;
    var deferred = (cfg.recognitionStartYearIndex || 0) >= 1;
    var tax = 0, doNothing = 0, brooklynFees = 0, brookhavenTotal = 0;

    if (deferred) {
      // Deferred-path engine collapse complete. Legacy
      // computeDeferredTaxComparison was removed after the parity
      // sweep verified $0 delta across 4,800 scenarios + live UI
      // cards. Unified handles deferred mode (recognitionStartYearIndex
      // >= 1) directly — same tranche-based loop, same §1(h) loss
      // netting, same do-nothing baseline. The
      // window.__rettUseUnifiedEngine rollback flag no longer affects
      // deferred — only immediate (where legacy computeTaxComparison
      // is still present pending the optimizer migration in Session B).
      if (typeof window === 'undefined' || typeof window.unifiedTaxComparison !== 'function') return null;
      var def = window.unifiedTaxComparison(cfg);
      if (!def || !def.rows) return null;
      def.rows.forEach(function (r) {
        tax += (r.withStrategy ? r.withStrategy.total : 0);
        doNothing += (r.doNothingBaseline ? r.doNothingBaseline.total
                       : (r.baseline ? r.baseline.total : 0));
      });
      brooklynFees = def.totalFees || 0;
      brookhavenTotal = def.totalBrookhavenFees || 0;
    } else {
      // Immediate path. Unified engine handles both modes — derives
      // totalLT from cfg directly (salePrice − basis − depr) so the
      // baseline correctly reflects the full property gain even when
      // ordinary income is $0. ProjectionEngine.run is still required
      // for the year-by-year fee accrual the dashboard Details table
      // reads via _scenarioFullData.
      if (typeof window === 'undefined' || typeof window.unifiedTaxComparison !== 'function' ||
          typeof ProjectionEngine === 'undefined' || !ProjectionEngine.run) return null;
      // Patch tierKey→strategyKey + investment→investedCapital aliases.
      cfg = _engineFlavoredCfg(cfg);
      var compIm;
      try { compIm = window.unifiedTaxComparison(cfg); } catch (e) { return null; }
      if (!compIm || !Array.isArray(compIm.rows)) return null;
      compIm.rows.forEach(function (r) {
        tax += r.withStrategy ? r.withStrategy.total : 0;
        // Immediate path's _flatRec forces full LT gain into Y1, so
        // baseline.total IS the do-nothing baseline by construction.
        doNothing += r.baseline ? r.baseline.total : 0;
      });
      // Brooklyn fees: pull from ProjectionEngine's per-year accrual
      // (it tracks the position open across the horizon — same as the
      // immediate-path scoring elsewhere in the codebase).
      var projIm;
      try { projIm = ProjectionEngine.run(cfg); } catch (e) {}
      if (projIm && projIm.totals && projIm.totals.cumulativeFees != null) {
        brooklynFees = projIm.totals.cumulativeFees;
      } else if (projIm && Array.isArray(projIm.years)) {
        projIm.years.forEach(function (y) { brooklynFees += (y.fee || 0); });
      }
      // Brookhaven flat fees from the schedule directly. Engagement
      // proration anchors on the strategy implementation date.
      if (typeof brookhavenFeeSchedule === 'function') {
        var yfImpl = (typeof yearFractionRemaining === 'function')
          ? yearFractionRemaining((typeof cfgStrategyDate === 'function' ? cfgStrategyDate(cfg) : (cfg.strategyImplementationDate || cfg.implementationDate))) : 1;
        var bhSched = brookhavenFeeSchedule(horizon, yfImpl);
        brookhavenTotal = (bhSched && bhSched.total) || 0;
      }
    }
    var totalFees = brooklynFees + brookhavenTotal;
    var netBenefit = doNothing - tax - totalFees;
    // Boundary guard: NaN / Infinity from a malformed cfg or a divide-
    // by-zero in the engine renders as "$NaN" in the comparison table —
    // worse than no number at all because it looks like a bug we shipped
    // rather than missing data. Coerce to 0 and warn so the issue
    // surfaces in dev without blanking the row.
    function _finite(label, v) {
      if (typeof v === 'number' && isFinite(v)) return v;
      try {
        console.warn('[RETT non-finite] _scenarioMetrics ' + label + '=', v,
          'cfg.recognitionStartYearIndex=', cfg && cfg.recognitionStartYearIndex);
      } catch (e) { /* */ }
      return 0;
    }
    return {
      tax:            _finite('tax',            tax),
      brooklynFees:   _finite('brooklynFees',   brooklynFees),
      brookhavenFees: _finite('brookhavenFees', brookhavenTotal),
      fees:           _finite('fees',           totalFees),
      doNothing:      _finite('doNothing',      doNothing),
      net:            _finite('net',            netBenefit)
    };
  }

  // Net-maximizing deployment sweep (advisor 2026-05-28). The optimizer
  // should never deploy a dollar whose marginal fee exceeds its marginal
  // tax savings. Brooklyn loss can overshoot the gain it can offset —
  // especially the structured sale, where the loss ramps up year-over-year
  // (the position grows as installments deploy) but the final installment's
  // gain is small, so the last slug of capital only manufactures an
  // unusable carryforward + extra fees (carryforward past the projection
  // window is valued at $0 — advisor confirmed 2026-05-28). We sweep the
  // deployment AMOUNT and pick the SMALLEST that's within a hair of the
  // best net (savings − fees), measured by the engine so it captures that
  // timing waste (the old proportional approximation could not).
  //
  // Search = three passes (advisor 2026-05-28): COARSE 5% (100%→30%) to
  // localize, FINE 1% (±5% around coarse winner), then ULTRA-FINE 0.1%
  // (±1% around fine winner). The 0.1% pass matters for the structured
  // sale: its installment tranches deploy in fixed slugs, so the net peak
  // sits on a CLEAN tranche boundary — a 1% grid can step over it and land
  // a tiny wasteful final tranche just past the peak (e.g. a $32,400 4th
  // tranche whose loss is unused). Runs are cached by permille so passes
  // never re-run a shared point. The winner is the net-MAX deployment, with
  // a SMALLEST-deployment tiebreak only for near-exact ties ($250) so we
  // never sacrifice real net to deploy slightly less. Cheap-exits to full
  // when there's no wasted loss, so no-waste strategies (e.g. lump-sum A)
  // are untouched. Returns a fraction in [0,1] of cfg.availableCapital.
  function _netMaxDeployFraction(cfg) {
    var availCap = Number(cfg && cfg.availableCapital) || 0;
    if (!(availCap > 0) || typeof window.unifiedTaxComparison !== 'function') return 1;
    // The dial-back must never reduce deployment below the account-opening
    // minimum (smallest combo min) — a sub-$1M deposit can't open a Schwab
    // account, so those fractions are invalid (deploy ≥ floor, or $0).
    var _floor = _smallestComboMinFor(cfg);
    var _cache = {};                           // permille -> result | null
    // pm = deployment in PERMILLE of availCap (1000 = 100%, 1 = 0.1%).
    function run(pm) {
      pm = Math.round(pm);
      if (pm <= 0 || pm > 1000) return null;
      if (pm in _cache) return _cache[pm];
      var cap = Math.round(availCap * (pm / 1000));
      if (cap <= 0) return (_cache[pm] = null);
      if (_floor > 0 && cap < _floor - 1) return (_cache[pm] = null);  // below account minimum → invalid
      var c = _engineFlavoredCfg(Object.assign({}, cfg, { availableCapital: cap, investment: cap, investedCapital: cap }));
      var cmp; try { cmp = window.unifiedTaxComparison(c); } catch (e) { return (_cache[pm] = null); }
      if (!cmp) return (_cache[pm] = null);
      var fees = Number.isFinite(cmp.totalAllFees) ? cmp.totalAllFees
               : (Number(cmp.totalFees || 0) + Number(cmp.totalBrookhavenFees || 0));
      var gen = 0, applied = 0;
      (cmp.rows || []).forEach(function (r) { gen += r.lossGenerated || 0; applied += r.lossApplied || 0; });
      return (_cache[pm] = { frac: pm / 1000, cap: cap, net: (Number(cmp.totalSavings) || 0) - fees, waste: gen - applied });
    }
    var full = run(1000);
    if (!full) return 1;
    if (full.waste < 1000) return 1;          // no wasted loss → full is already optimal (cheap exit)
    var scored = [], _seen = {};
    function consider(pm) {
      pm = Math.round(pm);
      if (pm < 1 || pm > 1000 || _seen[pm]) return;
      var r = run(pm);
      if (r) { _seen[pm] = 1; scored.push(r); }
    }
    function bestPm() { return Math.round(scored.reduce(function (a, b) { return b.net > a.net ? b : a; }).frac * 1000); }
    // Coarse pass: 5% steps (50 permille), 100% → 30%.
    consider(1000);
    for (var p = 950; p >= 300; p -= 50) consider(p);
    // Fine pass: 1% steps (10 permille) within ±5% of the coarse winner.
    var bc = bestPm();
    for (var q = bc - 50; q <= bc + 50; q += 10) consider(q);
    // Ultra-fine pass: 0.1% steps (1 permille) within ±1% of the fine
    // winner — lands the net peak on its clean tranche boundary instead of
    // overshooting into a tiny wasteful final tranche.
    var bf = bestPm();
    for (var u = bf - 10; u <= bf + 10; u++) consider(u);
    var maxNet = scored.reduce(function (m, s) { return Math.max(m, s.net); }, -Infinity);
    if (maxNet <= 0) return 0;                 // even the best deployment loses money → don't deploy
    // Pick the net-MAX deployment; among near-exact ties (within $250 — e.g.
    // a strategy whose excess capital is inert, so several deployments net
    // identically) prefer the SMALLEST so we don't park idle capital. The
    // tight tolerance prevents drifting BELOW the peak and giving up real net.
    var tol = 250;
    var winners = scored.filter(function (s) { return s.net >= maxNet - tol; })
                        .sort(function (a, b) { return a.frac - b.frac; });
    return winners.length ? Math.min(1, Math.max(0, winners[0].frac)) : 1;
  }

  // "Don't engage" metrics: zero fees / savings / net. Used by the two
  // optimizer floors below (no executable account, or money-losing run).
  function _zeroEngageMetrics(m) {
    return Object.assign({}, m, {
      brooklynFees: 0, brookhavenFees: 0, fees: 0, savings: 0, net: 0
    });
  }

  // Smallest Schwab combo minimum for the cfg's strategy — the account-
  // opening floor. Below this, no combo can open, so Brooklyn can't run at
  // all. 0 when the custodian/strategy has no combo list (non-Schwab).
  function _smallestComboMinFor(cfg) {
    try {
      if ((cfg && cfg.custodian && cfg.custodian !== 'schwab')) return 0;
      var key = (cfg && cfg.tierKey) || 'beta1';
      if (typeof root.listSchwabCombosForStrategy !== 'function') return 0;
      var list = root.listSchwabCombosForStrategy(key) || [];
      return list.reduce(function (m, c) {
        var v = Number(c.minInvestment) || 0;
        return (v > 0 && (m === 0 || v < m)) ? v : m;
      }, 0);
    } catch (e) { return 0; }
  }

  // Apply the net-max deployment dial-back to a full-deployment scenario,
  // mirroring buildInterestedSummary's non-override path so the strategy
  // comparison table reports the SAME post-optimizer net as the section
  // cards. Without this the table showed full-deployment net (e.g. the
  // structured sale at 100% = $721,405) while the card showed the
  // dialed-back optimum ($726,845) — the "stale net benefit" the advisor
  // flagged 2026-05-28. Also applies the account-opening floor (#3) and the
  // positive-net floor (#1) from the 2026-05-28 100-scenario sweep.
  function _dialBackScenarioMetrics(cfg, fullMetrics) {
    if (!fullMetrics) return fullMetrics;
    var availCap = Number(cfg && cfg.availableCapital) || 0;
    if (!(availCap > 0)) return fullMetrics;
    // #3 Account-opening floor: capital below the smallest combo minimum
    // can't open a Schwab account, so no strategy is executable → $0.
    var minMin = _smallestComboMinFor(cfg);
    if (minMin > 0 && availCap < minMin - 1) return _zeroEngageMetrics(fullMetrics);
    var scale = _netMaxDeployFraction(cfg);
    var result;
    if (scale >= 1) {
      result = fullMetrics;
    } else if (scale <= 0) {
      result = _zeroEngageMetrics(fullMetrics);
    } else {
      var redCap = Math.round(availCap * scale);
      var redCfg = Object.assign({}, cfg, { availableCapital: redCap, investment: redCap, investedCapital: redCap });
      var m2 = _scenarioMetrics(redCfg);
      // Only accept the dial-back when it genuinely improves net (same guard
      // the card path uses), so a row can never look worse than full deploy.
      result = (m2 && m2.net > fullMetrics.net) ? m2 : fullMetrics;
    }
    // #1 Positive-net floor: if the best this strategy can do still loses
    // money, don't engage — show $0 rather than a negative net (A had no
    // dial-back sweep to catch this; B/C already floored via scale=0).
    if (result && result.net < 0) return _zeroEngageMetrics(fullMetrics);
    return result;
  }

  function _buildScenarioComparison(currentCfg) {
    if (!currentCfg) return '';
    var userDuration = currentCfg.structuredSaleDurationMonths || 36;

    // Each row shows the BEST configuration of that strategy — same
    // auto-pick the section dashboard runs — so row and dashboard never
    // disagree on the comparison the user is here to make. The Page-1
    // horizon / leverage / combo are explicitly NOT honored here:
    // strategies have different optimal horizons (Sell-Now caps at Y1
    // for max savings, Structured wants 5+), and forcing all three rows
    // to share Page-1's horizon makes whichever one mismatches it look
    // artificially terrible.
    function _bestPickedCfg(type, baseCfg) {
      var picked = _autoPickSection(type, baseCfg);
      var sectionCfg = Object.assign({}, baseCfg, {
        horizonYears: picked.horizon,
        leverage:     picked.shortPct / 100,
        leverageCap:  picked.shortPct / 100,
        comboId:      picked.comboId
      });
      var pr = (type === 'C' && Number.isFinite(picked.parkRatio)) ? picked.parkRatio : null;
      var iw = (type === 'B' && Array.isArray(picked.installmentWeights)) ? picked.installmentWeights : null;
      // Y0 down-payment applies to BOTH B and C (advisor 2026-05-27).
      // Gating to C-only silently dropped B's solver-chosen Y0 down,
      // rebuilding B at D=0 and discarding the optimization — which let
      // C beat B on small sales.
      var y0d = ((type === 'B' || type === 'C') && Number.isFinite(picked.y0DownPayment)) ? picked.y0DownPayment : null;
      return {
        cfg: _scenarioCfgFor(type, sectionCfg, picked.bestRecC, userDuration, pr, iw, y0d),
        picked: picked
      };
    }

    // Scenario A: Sell now, no deferral (rec=1 immediate path).
    var pickedA = _bestPickedCfg('A', currentCfg);
    var mA = _scenarioMetrics(pickedA.cfg);
    if (mA) mA = _dialBackScenarioMetrics(pickedA.cfg, mA);

    // Scenario B: Delay close to Jan 1 of next year. Force gain into Y2
    // ONLY (no further deferral). Compute for ALL sale dates so the user
    // can always compare A vs B vs C side-by-side. (Prior gating on
    // saleMonth >= September hid B from early-year sales, which made
    // the table show only A and C and prevented the A-vs-B comparison
    // Blake explicitly asked for. Same fix already applied to the
    // per-strategy cards at line ~2196.)
    var pickedB = _bestPickedCfg('B', currentCfg);
    var mB = _scenarioMetrics(pickedB.cfg);
    if (mB) mB = _dialBackScenarioMetrics(pickedB.cfg, mB);

    // Scenario C: Structured sale. Auto-pick searches horizon × leverage
    // × recognition year and returns the (h, lev, combo, bestRecC)
    // tuple with max net.
    var pickedC = _bestPickedCfg('C', currentCfg);
    var bestC = _scenarioMetrics(pickedC.cfg);
    if (bestC) bestC = _dialBackScenarioMetrics(pickedC.cfg, bestC);
    var bestRecC = pickedC.picked.bestRecC;

    var rows = [];
    if (mA) rows.push({
      type: 'A', rec: 1, maxRec: null,
      label: 'Traditional Sale (Year 1)',
      sub: 'Close in current year, Brooklyn losses absorb gain immediately',
      metrics: mA
    });
    if (mB) rows.push({
      type: 'B', rec: 2, maxRec: 1,
      label: 'Installment Sale',
      sub: 'Gain hits Year 2 naturally — no structured-sale product needed',
      metrics: mB,
      cfg: pickedB && pickedB.cfg
    });
    if (bestC) rows.push({
      type: 'C', rec: bestRecC, maxRec: null,
      label: 'Structured Installment Sale (' + userDuration + ' months)',
      sub: 'Insurance product defers gain to Year ' + bestRecC + ' under the legal window',
      metrics: bestC,
      cfg: pickedC && pickedC.cfg
    });

    if (!rows.length) return '';

    var maxNet = Math.max.apply(null, rows.map(function (r) { return r.metrics.net; }));
    // Tiebreak: only the FIRST row matching the max gets the badge, so
    // when scenarios produce identical numbers (common when duration
    // forces gain into the same year as a "delay-close" plan) we
    // recommend the simpler option (A → B → C order).
    var winnerIdx = -1;
    for (var ri = 0; ri < rows.length; ri++) {
      if (Math.abs(rows[ri].metrics.net - maxNet) < 0.5) { winnerIdx = ri; break; }
    }

    // Active row: which scenario is currently powering the dashboard?
    // Compare against the user's current Page-2 state (recognitionStartYearIndex
    // + the scenario maxRec override). Falls back to "no active row" if
    // no row matches (e.g. odd manual override combinations).
    var activeRec = (currentCfg.recognitionStartYearIndex || 0) + 1;
    var activeMaxRec = (window.__rettScenarioMaxRec != null)
      ? window.__rettScenarioMaxRec : null;
    var activeIdx = -1;
    for (var ai = 0; ai < rows.length; ai++) {
      var rr = rows[ai];
      if (rr.rec === activeRec && (rr.maxRec || null) === activeMaxRec) {
        activeIdx = ai;
        break;
      }
    }
    // If nothing matched but user is on rec=2/3/4 and no maxRec override,
    // they're effectively in scenario C (structured sale).
    if (activeIdx < 0 && activeRec >= 2 && activeMaxRec == null) {
      for (var bi = 0; bi < rows.length; bi++) {
        if (rows[bi].type === 'C') { activeIdx = bi; break; }
      }
    }
    if (activeIdx < 0 && activeRec === 1) {
      for (var ci = 0; ci < rows.length; ci++) {
        if (rows[ci].type === 'A') { activeIdx = ci; break; }
      }
    }

    // Initialize the checked-scenarios set on first render. Default
    // priority:
    //   1. user's CHOSEN strategy (Page-2 "Use This Strategy" pick) —
    //      so the savings ribbon + KPI tiles match Page-5's hero. F19b
    //      fix: previously defaulted to winner regardless of pick,
    //      causing Page-3 ribbon ($X / Y× ROP) to show a different
    //      strategy than Page-5 ($Z / W×) for the same scenario.
    //   2. recommended (highest-net) winner — when no chosen pick yet.
    //   3. first row — when neither is available.
    // Once the user toggles a checkbox manually, their selection
    // persists across re-renders.
    if (!root.__rettCheckedScenarios) {
      root.__rettCheckedScenarios = {};
      var _chosenS = (typeof root !== 'undefined' && root.__rettChosenStrategy)
        || (typeof window !== 'undefined' && window.__rettChosenStrategy);
      var _chosenInRows = _chosenS && rows.some(function (r) { return r.type === _chosenS; });
      if (_chosenInRows) {
        root.__rettCheckedScenarios[_chosenS] = true;
      } else if (winnerIdx >= 0) {
        root.__rettCheckedScenarios[rows[winnerIdx].type] = true;
      } else if (rows.length) {
        root.__rettCheckedScenarios[rows[0].type] = true;
      }
    }
    // Stash the row->cfg map so the dashboard renderer can compute
    // per-scenario data without re-deriving cfg shapes. metrics are
    // included so the per-section render can assert dashboard numbers
    // match the row that motivated them — a drift here means somebody
    // changed the row pipeline or the section pipeline without keeping
    // the other in sync, which would silently corrupt the user's picture.
    root.__rettScenarioRows = rows.map(function (r) { return {
      type: r.type, rec: r.rec, maxRec: r.maxRec, label: r.label,
      metrics: r.metrics ? {
        tax:  Number(r.metrics.tax)  || 0,
        fees: Number(r.metrics.fees) || 0,
        net:  Number(r.metrics.net)  || 0
      } : null
    }; });
    // Expose the recommended scenario so the narrative can pin to it
    // instead of the global __lastComparison (which floats with whatever
    // the engine last ran with, often a stale or in-progress config).
    // Also stash the full {comp, result, cfg} so the narrative renders
    // even when the user has unchecked the recommended row in the
    // comparison table.
    root.__rettRecommendedScenario = (winnerIdx >= 0) ? rows[winnerIdx].type : null;
    root.__rettRecommendedLabel    = (winnerIdx >= 0) ? rows[winnerIdx].label : null;
    if (winnerIdx >= 0) {
      var winnerType = rows[winnerIdx].type;
      var winnerCfg = (winnerType === 'A') ? pickedA.cfg
                    : (winnerType === 'B') ? (pickedB && pickedB.cfg)
                    : pickedC.cfg;
      var winnerData = winnerCfg ? _scenarioFullData(winnerCfg) : null;
      root.__rettRecommendedData = winnerData
        ? { comp: winnerData.comp, result: winnerData.result, cfg: winnerCfg, label: rows[winnerIdx].label }
        : null;
    } else {
      root.__rettRecommendedData = null;
    }

    var html = '<div class="rett-scenario-card">';
    html += '<div class="rett-scenario-title">Strategy Comparison</div>';
    html += '<div class="rett-scenario-subtitle">Three real-world planning options — same scenario, same do-nothing baseline. Check a row to add its dashboard below; check multiple to compare side-by-side.</div>';
    html += '<table class="rett-scenario-table">';
    html += '<thead><tr><th class="rett-scenario-check"></th><th>Strategy</th><th class="num">Tax Owed</th><th class="num">Fees</th><th class="num">Net Benefit</th></tr></thead><tbody>';
    rows.forEach(function (row, idx) {
      var isWinner = (idx === winnerIdx);
      var isChecked = !!root.__rettCheckedScenarios[row.type];
      var isNetNegative = row.metrics && row.metrics.net < 0;
      var classes = ['rett-scenario-row'];
      if (isWinner) classes.push('rett-scenario-winner');
      if (isChecked) classes.push('rett-scenario-checked');
      if (isNetNegative) classes.push('rett-scenario-net-negative');
      html += '<tr class="' + classes.join(' ') + '"' +
              ' data-scenario="' + row.type + '"' +
              ' data-rec="' + row.rec + '"' +
              ' data-max-rec="' + (row.maxRec == null ? '' : row.maxRec) + '"' +
              ' tabindex="0" role="button" aria-pressed="' + (isChecked ? 'true' : 'false') + '">';
      html += '<td class="rett-scenario-check">';
      html += '<input type="checkbox" class="rett-scenario-checkbox"' +
              ' data-scenario-toggle="' + row.type + '"' +
              ' aria-label="Show ' + row.label + ' dashboard"' +
              (isChecked ? ' checked' : '') + '>';
      html += '</td>';
      html += '<td>';
      html += '<div class="rett-scenario-label">' + row.label;
      if (isWinner) html += ' <span class="rett-scenario-badge">RECOMMENDED</span>';
      // Net-negative badge: a scenario whose fees exceed its savings
      // costs the client money. Surface that explicitly so the row
      // doesn\'t look like a viable choice tied for ranking.
      if (isNetNegative) html += ' <span class="rett-scenario-badge rett-scenario-badge-warn">NET NEGATIVE</span>';
      html += '</div>';
      html += '<div class="rett-scenario-sub">' + row.sub + '</div>';
      // Deferred strategies (B / C): surface the optimizer's recommended
      // payment terms so the advisor knows what to negotiate, and so this
      // table reconciles with the temp/tax-implication page.
      var _sched = row.cfg ? _scheduleSummaryLine(row.cfg) : '';
      if (_sched) html += '<div class="rett-scenario-schedule">' + _sched + '</div>';
      html += '</td>';
      html += '<td class="num">' + _fmt(row.metrics.tax) + '</td>';
      html += '<td class="num">' + _fmt(row.metrics.fees) + '</td>';
      html += '<td class="num"><strong>' + _fmt(row.metrics.net) + '</strong></td>';
      html += '</tr>';
    });
    html += '</tbody></table></div>';
    return html;
  }

  // Build the cfg variant for a scenario type ('A', 'B', 'C').
  //
  // IMPORTANT — strategy dispatch lives HERE, not in the recognition-start
  // dropdown (#recognition-start-select). That dropdown is hidden in the
  // DOM (index.html:802 inside `<div hidden>`) and is engine-only — the
  // auto-picker writes to it for Strategy C's recognition sweep. Users
  // never touch it directly. Strategy A/B/C selection happens via Page-2
  // Interest clicks, which route through this function to set the cfg
  // fields the engine actually consumes:
  //
  //   Strategy A (Sell Now)        → recognitionStartYearIndex=0, year1 unchanged
  //   Strategy B (Seller Finance)  → recognitionStartYearIndex=0, year1+1, Jan-1 dates
  //   Strategy C (Structured Sale) → recognitionStartYearIndex=bestRecC-1, duration sweep
  //
  // Strategy B does NOT use rec>=1 — the engine sees it as an immediate
  // sale that just happens to close Jan 1 of next year. So a probe like
  // `setVal('recognition-start-select', '1'); collectInputs();` will NOT
  // produce Strategy B's behavior — that flow only modifies the recognition
  // index, not year1 / implementationDate. Verify Strategy B by setting
  // __rettStrategyInterest.B = true and checking entry.cfg.year1 ===
  // currentYear+1. (Bug verified 2026-05-06; no fix needed — working as
  // designed, just non-obvious from a probe-the-dropdown angle.)
  function _scenarioCfgFor(type, currentCfg, bestRecC, userDuration, parkRatio, installmentWeights, y0DownPayment) {
    if (!currentCfg) return null;
    if (type === 'A') {
      // F2 (2026-05-27): explicitly clear cross-strategy fields so
      // entry.cfg fully describes Strategy A. Without these clears,
      // currentCfg's default structuredSaleDurationMonths (36) rides
      // along, and any downstream code that re-calls
      // unifiedTaxComparison(entry.cfg) interprets it as a degenerate
      // structured sale and accrues phantom Brooklyn fees.
      return Object.assign({}, currentCfg, {
        recognitionStartYearIndex: 0,
        maxRecognitionYearIndex: null,
        structuredSaleDurationMonths: 0,
        installmentPayments: null,
        parkRatio: null
      });
    }
    if (type === 'B') {
      // Strategy B - §453 installment sale (advisor 2026-05-26):
      //
      // Buyer pays N equal installments on Jan 1 of each year following
      // the close, where N ∈ {1, 2, 3} - chosen by the auto-picker for
      // highest net benefit. Each installment recognizes:
      //   gain = paymentAmount × (totalLT / (salePrice - accelDepr))
      //   basis = paymentAmount × ((salePrice - accelDepr - totalLT) / (salePrice - accelDepr))
      // Equivalently, totalLT / N is recognized as LT gain each year.
      //
      // Per §453(i), depreciation recapture is recognized in the YEAR
      // OF SALE (Y0) at ordinary rates - separately from the installment
      // schedule. The engine handles this via the existing _recapDrag
      // path in unifiedTaxComparison.
      //
      // Engine routing: cfg.installmentPayments = N triggers the
      // installment-sale path. No structuredSaleDurationMonths (this
      // is NOT a MetLife product), no maxRecognitionYearIndex (the
      // installment path sets its own maturityIdx from N).
      //
      // Horizon: must be ≥ N+1 so engine sees Y0 (recap) + N payment
      // years. _userDurationParam (the bestRecC slot) is repurposed as
      // the installment-payment count, passed via _scenarioCfgFor's
      // bestRecC argument from _autoPickSection.
      var bYear = (currentCfg.year1 || (new Date()).getFullYear()) + 1;
      var bPayments = Math.max(1, Math.min(3, (bestRecC | 0) || 1));
      // Installment weights (advisor 2026-05-27): when the auto-picker
      // passes a custom weight array, use it; otherwise the engine
      // defaults to equal split (1/N each year). Each weight is the
      // FRACTION of (salePrice − recap) paid that year. Weights must
      // sum to ~1.0 and have length == bPayments.
      var bWeights = null;
      if (Array.isArray(installmentWeights) && installmentWeights.length === bPayments) {
        var _wSum = installmentWeights.reduce(function (s, w) { return s + (Number(w) || 0); }, 0);
        if (Math.abs(_wSum - 1) < 0.01) {
          // Normalize defensively against minor rounding drift.
          bWeights = installmentWeights.map(function (w) { return Number(w) / _wSum; });
        }
      }
      // Y0 down-payment for B (advisor 2026-05-27): §453 doesn't
      // require deferring all sale proceeds to future installments —
      // the buyer can also pay a Y0 portion at closing. Same engine
      // handling as C; B's solver search subsumes C's whenever B
      // also has this knob.
      var bY0Down = Math.max(0, Number(y0DownPayment) || 0);
      // Date routing (advisor 2026-05-27 follow-up):
      //   yfImpl drives the Y0 Brooklyn tranche's age-0 partial-year
      //   loss multiplier AND the Brookhaven setup + Q1 proration. Two
      //   regimes:
      //     • D > 0: Brooklyn deploys at sale-close (the Y0 down
      //       payment IS the Y0 deposit). yfImpl = sale-close year
      //       fraction. Use the original strategyImplementationDate.
      //     • D = 0: no Y0 Brooklyn tranche; Brooklyn first deploys
      //       when the Y1 installment lands at year+1 Jan 1. yfImpl
      //       should be 1.0 so Brookhaven Y0 gets the full Q1-Q4
      //       (the engagement starts at signing/sale-close but the
      //       year+1 deployment doesn't begin until Y1 Jan 1).
      //   Engine handoff's "B is date-invariant" property is preserved
      //   for the D=0 branch — only D>0 makes B date-sensitive, which
      //   is correct (Y0 deposit timing really does matter).
      // Y0 tranche exists when the Y0 deposit pool (down-payment +
      // recapture cash) clears the $1M account-opening minimum. When it
      // does, Brooklyn opens at sale-close → use the real sale date so
      // the Y0 tranche gets its partial-year loss factor. Otherwise the
      // pool rolls into the Y1 installment (year+1 Jan 1, yfImpl=1.0).
      var bRecapCash = Math.max(0, Number(currentCfg.acceleratedDepreciation) || 0);
      var bHasY0Tranche = (bY0Down + bRecapCash) >= 1000000;
      var bStratDate = (bHasY0Tranche && currentCfg.strategyImplementationDate)
            ? currentCfg.strategyImplementationDate
            : bYear + '-01-01';
      var bImplDate = bStratDate;
      var bCfg = Object.assign({}, currentCfg, {
        recognitionStartYearIndex: 1,
        maxRecognitionYearIndex:   null,
        installmentPayments:       bPayments,
        // F2: B is §453 installment, not a structured sale. Clear so
        // entry.cfg unambiguously identifies B.
        structuredSaleDurationMonths: 0,
        parkRatio:                  null,
        y0DownPayment:              bY0Down,
        horizonYears: Math.max(bPayments + 1, Number(currentCfg.horizonYears) || (bPayments + 1)),
        implementationDate:         bImplDate,
        strategyImplementationDate: bStratDate
        // year1 stays at original sale year so Y0 = year of sale (recap).
      });
      if (bWeights) bCfg.installmentScheduleWeights = bWeights;
      return bCfg;
    }
    if (type === 'C') {
      // Strategy C — MetLife structured installment sale
      // (advisor 2026-05-27, RE-SPEC):
      //
      // Routed through the §453 installment engine with LOCKED 40/40/20
      // weights. Recap stays Y0 ordinary per §453(i). Basis recovery
      // flows proportionally with each installment per the §453 GP ratio
      // — basis is contractually inside the insurance product, NOT
      // parked in Brooklyn.
      //
      // The prior model (parkRatio + basisCash = basis + recap +
      // (1-pr)·LT deployed at Y0) was wrong: it treated cost basis as
      // deployable Brooklyn capital. The MetLife product can hold sale
      // proceeds (basis + LT), but basis returns to the seller as
      // non-taxable principal recovery with each installment, not as a
      // Y0 lump that can be invested in Brooklyn.
      //
      // Y0 down-payment (cfg.y0DownPayment) is an OPTIONAL knob the
      // solver may sweep — recognizing some gain early to open a Y0
      // Brooklyn tranche when that beats deferring everything.
      // Default 0 means recap-only at Y0, all gain via 40/40/20.
      var cYear = (currentCfg.year1 || (new Date()).getFullYear()) + 1;
      // Y0 down-payment knob (advisor 2026-05-27): when the solver
      // passes a positive value, the engine recognizes (D × GP ratio)
      // of LT gain at Y0 and opens a Brooklyn tranche of size D — see
      // tax-comparison.js `_y0DownPayment` handling. Default 0 keeps
      // the recap-only Y0 behavior.
      var _y0Down = Math.max(0, Number(y0DownPayment) || 0);
      // Date routing parallels B. Y0 tranche exists when the Y0 deposit
      // pool (down-payment + recapture cash) clears $1M → sale-close
      // date for partial-year yf. Otherwise the pool rolls into the Y1
      // installment (year+1 Jan 1, yfImpl=1.0).
      var cRecapCash = Math.max(0, Number(currentCfg.acceleratedDepreciation) || 0);
      var cHasY0Tranche = (_y0Down + cRecapCash) >= 1000000;
      var cStratDate = (cHasY0Tranche && currentCfg.strategyImplementationDate)
            ? currentCfg.strategyImplementationDate
            : cYear + '-01-01';
      var cImplDate = cStratDate;
      var cCfg = Object.assign({}, currentCfg, {
        recognitionStartYearIndex: 1,
        maxRecognitionYearIndex:   null,
        installmentPayments:       3,
        installmentScheduleWeights: [0.4, 0.4, 0.2],
        // Display-only label hint — engine ignores in installment path.
        structuredSaleDurationMonths: userDuration || 36,
        // parkRatio retired for C.
        parkRatio:                  null,
        y0DownPayment:              _y0Down,
        horizonYears: Math.max(4, Number(currentCfg.horizonYears) || 4),
        implementationDate:         cImplDate,
        strategyImplementationDate: cStratDate
      });
      return cCfg;
    }
    return null;
  }

  // Compute (comp, result, years) for a single scenario cfg. Mirrors
  // the data shape renderProjectionDashboard expects, so the same
  // _buildKpiRow / _buildChart / _buildPies helpers can render any
  // scenario's section.
  function _scenarioFullData(cfg) {
    if (!cfg) return null;
    var horizon = cfg.horizonYears || cfg.years || 5;
    var deferred = (cfg.recognitionStartYearIndex || 0) >= 1;
    var comp = null, result = null, years = null;

    if (deferred) {
      // Deferred routes through unified directly — see _scenarioMetrics.
      if (typeof window === 'undefined' || typeof window.unifiedTaxComparison !== 'function') return null;
      comp = window.unifiedTaxComparison(cfg);
      if (!comp || !Array.isArray(comp.rows)) return null;
      // Synthesize a result-shape for fee accounting consumers.
      result = { config: cfg, totals: { cumulativeFees: comp.totalFees || 0 } };
      years = comp.rows.map(function (r) {
        return {
          year: r.year,
          taxNoBrooklyn: r.baseline ? r.baseline.total : 0,
          taxNoBrooklynDoNothing: r.doNothingBaseline ? r.doNothingBaseline.total : null,
          taxWithBrooklyn: r.withStrategy ? r.withStrategy.total : 0,
          investmentThisYear: r.investmentThisYear || 0,
          gainRecognized: r.gainRecognized || 0,
          grossLoss: r.lossGenerated || r.lossApplied || 0,
          fee: r.fee || 0
        };
      });
    } else {
      // Immediate path. Unified engine handles both modes — derives
      // totalLT from cfg directly. ProjectionEngine.run still needed
      // for per-year fee/loss display in the Details table.
      if (typeof window === 'undefined' || typeof window.unifiedTaxComparison !== 'function'
          || typeof ProjectionEngine === 'undefined' || !ProjectionEngine.run) return null;
      cfg = _engineFlavoredCfg(cfg);
      try { result = ProjectionEngine.run(cfg); } catch (e) { return null; }
      if (!result || !Array.isArray(result.years)) return null;
      try { comp = window.unifiedTaxComparison(cfg); } catch (e) { return null; }
      if (!comp || !Array.isArray(comp.rows)) return null;
      years = comp.rows.map(function (r, idx) {
        var resYr = (result.years && result.years[idx]) || {};
        return {
          year: r.year,
          taxNoBrooklyn: r.baseline ? r.baseline.total : (resYr.taxNoBrooklyn || 0),
          taxNoBrooklynDoNothing: r.doNothingBaseline ? r.doNothingBaseline.total : null,
          taxWithBrooklyn: r.withStrategy ? r.withStrategy.total : (resYr.taxWithBrooklyn || resYr.taxNoBrooklyn || 0),
          investmentThisYear: resYr.investmentThisYear || 0,
          gainRecognized: r.gainRecognized || 0,
          grossLoss: resYr.grossLoss != null ? resYr.grossLoss : (r.lossApplied || 0),
          fee: resYr.fee || 0
        };
      });
    }
    return { comp: comp, result: result, years: years };
  }

  // Local non-mutating wrapper around the global rettFlavorEngineCfg
  // (defined in format-helpers.js). The dashboard-side callers want a
  // cloned cfg so they can also stamp scenario-specific overrides
  // without mutating their input — the global helper mutates in place
  // for callers that explicitly want that.
  function _engineFlavoredCfg(cfg) {
    if (!cfg) return cfg;
    return rettFlavorEngineCfg(Object.assign({}, cfg));
  }

  // ---- Per-section state + auto-pick + controls ---------------------
  // Each scenario section (A / B / C) holds its OWN horizon, leverage,
  // and (for C) duration overrides — so checking multiple scenarios
  // doesn't lock all of them to the global Page-2 toolbar's settings.
  // Section state lives on window.__rettSectionState[type] and survives
  // section re-renders. Page-1 edits and the global revert clear it.
  function _candidateShortPctsLocal(stratKey, custodianId) {
    if (custodianId === 'schwab' && typeof root.listSchwabCombos === 'function') {
      var combos = root.listSchwabCombos().filter(function (c) { return c.strategyKey === stratKey; });
      return combos.map(function (c) { return { shortPct: c.shortPct || 0, comboId: c.id }; });
    }
    var maxShort = 225;
    var tier = (root.BROOKLYN_STRATEGIES || {})[stratKey];
    if (tier && Array.isArray(tier.dataPoints)) {
      maxShort = Math.max.apply(null, tier.dataPoints.map(function (p) { return p.shortPct || 0; }));
    }
    var out = [];
    for (var s = 0; s <= maxShort; s += 5) out.push({ shortPct: s, comboId: null });
    if (out.length === 0 || out[out.length - 1].shortPct !== maxShort) {
      out.push({ shortPct: maxShort, comboId: null });
    }
    return out;
  }

  // Find the (horizon, shortPct, comboId, bestRec for C) tuple that
  // maximizes net for this scenario type. Used both when a section is
  // first checked AND when the user clicks Revert on a section.
  function _autoPickSection(type, baseCfg) {
    if (!baseCfg) return { horizon: 5, shortPct: 100, comboId: null, bestRecC: 2, durationMonths: 36, parkRatio: 0 };
    var stratKey = baseCfg.tierKey || 'beta1';
    var custId = baseCfg.custodian || '';
    var pcts = _candidateShortPctsLocal(stratKey, custId);
    // Per advisor 2026-05-26: structured sale is locked to a single
    // 3-year 40/40/20 schedule.
    //   • horizon=1 — Strategy A (Sell-Now lump-sum)
    //   • horizon=2 — Strategy B (§453 installment, N=1 yearly payment)
    //   • horizon=3 — Strategy B (N=2 yearly payments)
    //   • horizon=4 — Strategy B (N=3) + Strategy C (36mo, Y1-Y3 recog)
    var horizons = [1, 2, 3, 4];
    function _durationsForHorizon(hor) {
      // Only 36mo offered. Returns [] when horizon can't fit it so
      // auto-picker naturally skips Strategy C in those configs.
      return (hor >= 4) ? [36] : [];
    }
    var userDurationFallback = baseCfg.structuredSaleDurationMonths || 36;
    var best = null;

    // Supplemental Year-0 cash floor (cash-flow timing). Supplementals
    // deploy their investment in Year 0, so on installment / structured
    // sales the Y0 cash (down payment) must be at least the supplemental
    // capital — otherwise the model "invests" more in Y0 than the client
    // received. Rather than capping the supps, we RAISE the down payment
    // to cover them: the down-payment optimizers below only consider D >=
    // this floor, so they still pick the highest-net payment that funds the
    // supplementals (the user's "adjust the payment, solve for best net").
    // Computed once — the supplemental deployment is independent of the
    // strategy / horizon / combo / down-payment being swept. Zero when no
    // capital-consuming supp is funded (then there's no floor, no change).
    // Supp-blind gate (advisor 2026-06-08): the standalone Projection-tab
    // path (runFullPipeline) passes _suppBlind so the auto-pick ignores the
    // supplemental draw entirely — Brooklyn is sized as if no supp exists,
    // so the headline net HOLDS when supps are toggled on Page-5. The
    // combined Summary/Temp path (buildInterestedSummary) leaves _suppBlind
    // unset, keeping the down-payment floor that funds the supps.
    var _suppY0Floor = 0;
    if (!(baseCfg && baseCfg._suppBlind)) {
      try {
        if (typeof root.runAllocator === 'function') {
          var _aFloor = root.runAllocator(Math.max(0, Number(baseCfg.availableCapital) || 0));
          if (_aFloor && Number.isFinite(_aFloor.allocatedToSupplementals)) {
            _suppY0Floor = Math.max(0, Math.round(_aFloor.allocatedToSupplementals));
          }
        }
      } catch (e) { _suppY0Floor = 0; }
    }
    // Dial-back-aware combo selection (2026-05-29): the sweep scores every
    // candidate at FULL deployment, but a combo can over-deploy at full
    // (lower full net) yet dial back to a HIGHER net than the full-winner —
    // confirmed on the structured sale (200/100 dialed beats 145/45 by
    // ~$17K in a $5M/$1M case where 145/45 won at full). Track each combo's
    // best-FULL candidate here, then re-score them at their dial-back
    // optimum after the sweep (see below) and pick the genuinely net-best.
    var _bestPerComboFull = {};   // comboId -> { picked, fullNet }
    function _recordCombo(pk, fullNet) {
      if (!pk || !pk.comboId || !isFinite(fullNet)) return;
      var k = pk.comboId;
      if (!_bestPerComboFull[k] || fullNet > _bestPerComboFull[k].fullNet) {
        _bestPerComboFull[k] = { picked: pk, fullNet: fullNet };
      }
    }
    horizons.forEach(function (hor) {
      // Strategy-specific minimum horizons:
      //   • B (Seller-Finance §453 installment): hor >= 2 — engine deferred
      //     path uses Y0 for recap-only / sale-year ordinary tax and Y1+
      //     for LT gain recognition. With hor=1 there's no Y1 row, so the
      //     engine collapses recap + LT back into the same year (the §453(i)
      //     violation the B fix removes).
      //   • C (Structured Sale): hor >= 4 — minimum 36mo duration is 3
      //     yearly recognition payments; with sale year Y0 + recognition
      //     Y1-Y3 = 4 years total horizon required. Skipping hor < 4
      //     prevents the auto-picker from generating infeasible
      //     (startIdx == maturityIdx) shapes that collapse all gain
      //     into a single year and bypass MetLife caps.
      if (type === 'C' && hor < 4) return;
      if (type === 'B' && hor < 2) return;
      pcts.forEach(function (p) {
        var cfgSection = Object.assign({}, baseCfg, {
          horizonYears: hor,
          leverage: p.shortPct / 100,
          leverageCap: p.shortPct / 100,
          comboId: p.comboId
        });
        if (type === 'C') {
          // Strategy C — MetLife structured installment sale
          // (advisor 2026-05-27, RE-SPEC).
          //
          // Routed through the §453 installment engine with LOCKED
          // [0.40, 0.40, 0.20] weights. Solver sweeps:
          //   (1) combo (handled by outer pcts loop)
          //   (2) y0DownPayment — optional Y0 cash beyond recap that
          //       opens a Brooklyn Y0 tranche + recognizes
          //       (D × GP_ratio) of LT gain at Y0. Range: 0 to
          //       (salePrice − recap). 3-pass: coarse 10% of contract
          //       price, fine 2%, ultra-fine 0.5%.
          //
          // Custodian min: any D in (0, $1M) is illegal — Schwab
          // won't open a sub-$1M tranche. Skip D values that fall in
          // the gap so we pick either D=0 or D >= $1M.
          var _contractPrice = Math.max(0, Number(cfgSection.salePrice || 0)
                - Number(cfgSection.acceleratedDepreciation || 0));
          var _availTotal = Math.max(0, Number(cfgSection.availableCapital || 0));
          // D cap = min(contract price, available capital) — can't pay
          // a down beyond what cash the buyer brings, and can't fund
          // Brooklyn beyond availableCapital.
          var _dMax = Math.min(_contractPrice, _availTotal);
          // Down payment must cover the supplemental Y0 deployment (clamped
          // to what the proceeds can pay). 0 when no supp is funded.
          var _floorC = Math.min(Math.max(0, _suppY0Floor), _dMax);
          var _smallestMin = 1000000;
          var _recapC = Math.max(0, Number(cfgSection.acceleratedDepreciation) || 0);
          // First-deposit account-opening gate (advisor 2026-05-27):
          // Schwab needs ≥ $1M to OPEN the account. The Y0 deposit pool
          // = down-payment + recapture cash. If the pool clears $1M the
          // account opens at Y0; otherwise the pool rolls into the Y1
          // installment and that combined first deposit must clear $1M.
          // (For C the Y1 weight is locked at 40%.)
          function _firstDepositLegalC(D) {
            var pool = D + _recapC;
            if (pool >= _smallestMin - 0.5) return true;     // Y0 opens
            var firstInstall = (_contractPrice - D) * 0.40;
            return (firstInstall + pool) >= _smallestMin - 0.5;
          }

          var _evalD = function (D) {
            if (D < _floorC - 0.5) return null;   // must fund the supps' Y0 deployment
            if (!_firstDepositLegalC(D)) return null;
            var typedCfg = _scenarioCfgFor(type, cfgSection, 3, 36, null, null, D);
            var m = _scenarioMetrics(typedCfg);
            if (!m) return null;
            var _pk = { horizon: hor, shortPct: p.shortPct, comboId: p.comboId,
              bestRecC: 3, net: m.net, durationMonths: 36, parkRatio: null, y0DownPayment: D };
            _recordCombo(_pk, m.net);
            if (!best || m.net > best.net) best = _pk;
            return m;
          };

          // Always evaluate the supp floor itself so a feasible D that
          // funds the supplementals stays in the running even if the
          // coarse grid steps over it.
          if (_floorC > 0) _evalD(_floorC);
          // Coarse pass at 0%, 10%, 20%, ..., 100% of D_max.
          var coarseBest = null;
          for (var ci = 0; ci <= 10; ci++) {
            var D = Math.round(_dMax * (ci / 10));
            if (D < _floorC - 0.5) continue;
            if (!_firstDepositLegalC(D)) continue;
            var mc = _evalD(D);
            if (mc && (!coarseBest || mc.net > coarseBest.net)) {
              coarseBest = { D: D, net: mc.net };
            }
          }
          // BOUNDARY-VALUE PASS (advisor 2026-06-01): the net(D) curve has
          // SPIKES at the Schwab combo minimums ($1M for 145/45, $3M for
          // 200/100). At D = combo_min, the Y0 deposit opens that combo
          // exactly at the floor, generating the maximum age-0 loss
          // density. Between spikes net drops by ~$15K because the Y0
          // tranche either over-shoots the floor (wasted capacity vs
          // restarting fresh at the next tier) or under-shoots (cash
          // rolls into Y1 with no Y0 absorption). The 10% coarse grid
          // can step OVER these spikes (e.g. with $4.9M D_max it samples
          // $0, $490K, $980K, $1.47M — missing $1M and $3M). Explicitly
          // probe the combo-min boundaries so the optimum lands on the
          // spike when it dominates.
          if (typeof root.listSchwabCombosForStrategy === 'function') {
            try {
              var _stratKeyC = (cfgSection.tierKey || cfgSection.strategyKey || 'beta1');
              var _allCombos = root.listSchwabCombosForStrategy(_stratKeyC) || [];
              var _userCapC = Number(cfgSection.leverageCap != null ? cfgSection.leverageCap
                              : (cfgSection.leverage != null ? cfgSection.leverage : 1));
              _allCombos.forEach(function (c) {
                if (!c || !Number.isFinite(c.minInvestment) || c.minInvestment <= 0) return;
                if (Number(c.leverage) > _userCapC + 1e-6) return;
                var Dbound = Math.round(c.minInvestment);
                if (Dbound > _dMax) return;
                if (!_firstDepositLegalC(Dbound)) return;
                var mb = _evalD(Dbound);
                if (mb && (!coarseBest || mb.net > coarseBest.net)) {
                  coarseBest = { D: Dbound, net: mb.net };
                }
              });
            } catch (e) { /* keep coarse winner */ }
          }
          // Fine pass ±10% of D_max in 2% steps around coarse peak.
          var fineBest = coarseBest;
          if (coarseBest) {
            for (var fstep = 1; fstep <= 5; fstep++) {
              [-1, 1].forEach(function (sign) {
                var D = Math.round(coarseBest.D + sign * fstep * 0.02 * _dMax);
                if (D < 0 || D > _dMax) return;
                if (!_firstDepositLegalC(D)) return;
                var mf = _evalD(D);
                if (mf && (!fineBest || mf.net > fineBest.net)) {
                  fineBest = { D: D, net: mf.net };
                }
              });
            }
          }
          // Ultra-fine ±2% in 0.5% steps.
          if (fineBest) {
            for (var ustep = 1; ustep <= 4; ustep++) {
              [-1, 1].forEach(function (sign) {
                var D = Math.round(fineBest.D + sign * ustep * 0.005 * _dMax);
                if (D < 0 || D > _dMax) return;
                if (!_firstDepositLegalC(D)) return;
                _evalD(D);
              });
            }
          }
        } else if (type === 'B') {
          // For B (§453 installment), each horizon iteration tries
          // exactly one N value (N = hor - 1, so Y0 + N payment years).
          // The outer horizons sweep [2, 3, 4] covers N=1/2/3. bestRecC
          // slot carries N into _scenarioCfgFor.
          //
          // §453 weight sweep (advisor 2026-05-27): §453 contracts
          // don't require equal payments — the buyer can pay e.g. 80%
          // Y1 + 20% Y2, which can let the Y1 payment qualify for a
          // higher-leverage Schwab combo ($3M+ → 200/100 at 0.59 Y0
          // loss rate vs 145/45 at 0.322). For N=2 and N=3, the auto-
          // picker now sweeps weight allocations to find the highest-
          // net split. 2-pass: coarse 0.10 step, fine 0.02 step around
          // winner. Skipped for N=1 (only one valid weight = [1.0]).
          var nForHor = hor - 1;
          if (nForHor < 1 || nForHor > 3) return;

          // Y0 down-payment + first-deposit gate constants (advisor
          // 2026-05-27). §453 allows a Y0 cash payment alongside the
          // future installments; the first chronological Brooklyn
          // deposit must clear the $1M Schwab account-opening minimum.
          var _bContractPrice = Math.max(0, Number(cfgSection.salePrice || 0)
                - Number(cfgSection.acceleratedDepreciation || 0));
          var _bAvail = Math.max(0, Number(cfgSection.availableCapital || 0));
          var _bDMax = Math.min(_bContractPrice, _bAvail);
          var _bRecap = Math.max(0, Number(cfgSection.acceleratedDepreciation) || 0);
          // No artificial floor on D (advisor 2026-06-08). Earlier
          // iterations gated D >= suppY0Floor (and later max(0, supp -
          // recap)) to enforce "supps deploy from Y0 sale cash only" —
          // but in practice supps can draw from side capital, and the
          // engine handles a Y0 shortfall correctly (Brooklyn auto-
          // downgrades to closed if pool − supp < min). With the floor
          // present, the optimizer was forced to recognize extra Y0 LT
          // gain when Brooklyn couldn't open profitably, bleeding
          // ~$24K of net per $300K of forced down payment.
          //
          // Probed at $7M sale / $200K recap / $500K Oil & Gas: primary
          // net at D=$0 is $551,143 vs $527,548 at D=$300K. With no
          // floor, the optimizer is free to pick D=$0 (pure deferral)
          // when Brooklyn can't open, or push D up to ≥$1M-recap-supp
          // when Brooklyn opens profitably.
          var _floorB = 0;
          var _bSmallestMin = 1000000;
          // Account opens with the first deposit. Y0 deposit pool =
          // down-payment + recapture cash. If the pool clears $1M the
          // account opens at Y0; otherwise the pool rolls into the Y1
          // installment and that combined deposit must clear $1M.
          function _firstDepositLegalB(weights, D) {
            // Pool = D + recap, less supps' Y0 deployment (which the engine
            // reserves from the pool before sizing Brooklyn's tranche).
            // Previously this check used the raw pool, so the optimizer
            // believed Brooklyn opened at pool >= $1M even when supps ate
            // it down below the min — pushing D upward chasing a phantom
            // Brooklyn benefit.
            var pool = D + _bRecap;
            var poolAfterSupp = Math.max(0, pool - _suppY0Floor);
            if (poolAfterSupp >= _bSmallestMin - 0.5) return true;   // Y0 opens
            var w0 = (weights && Number.isFinite(weights[0])) ? weights[0] : 0;
            var firstInstall = (_bContractPrice - D) * w0;
            return (firstInstall + poolAfterSupp) >= _bSmallestMin - 0.5;
          }

          function _evalB(weights, D) {
            // Default to the supp FLOOR (not 0). The weight-selection passes
            // call _evalB(weights) with no D to compare installment splits;
            // at D=0 the floor would reject them all and collapse weight
            // selection. Comparing schedules at the floored down payment is
            // both feasible and correct (we want the best split at a payment
            // that funds the supps). Explicit D values from the down-payment
            // sweeps are honored as-is (and still floor-checked below).
            D = (D == null) ? _floorB : D;
            if (D < _floorB - 0.5) return null;   // must fund the supps' Y0 deployment
            if (!_firstDepositLegalB(weights, D)) return null;
            var typedCfgB = _scenarioCfgFor('B', cfgSection, nForHor, userDurationFallback, null, weights, D);
            var mB = _scenarioMetrics(typedCfgB);
            return mB ? { metrics: mB, weights: weights, D: D } : null;
          }
          function _maybeUpdateBest(out) {
            if (!out) return;
            var _pk = { horizon: hor, shortPct: p.shortPct, comboId: p.comboId,
              bestRecC: nForHor, net: out.metrics.net, durationMonths: userDurationFallback,
              installmentWeights: out.weights, y0DownPayment: out.D };
            _recordCombo(_pk, out.metrics.net);
            if (!best || out.metrics.net > best.net) best = _pk;
          }
          // Coarse 10%-step down-payment sweep on a fixed weight set.
          // Returns the best { metrics, weights, D } found (or null).
          // Also probes the Schwab combo minimums ($1M / $3M) as boundary
          // values — the net(D) curve spikes at those D values because
          // the Y0 deposit opens that tier exactly at the floor (max
          // age-0 loss density). The 10% grid can step over these spikes
          // (e.g. with $4.9M D_max it samples $980K + $1.47M, missing
          // $1M). Mirror of the same fix on Strategy C above.
          function _sweepBDCoarse(lockedWeights) {
            if (_bDMax <= 0) return null;
            var coarseBest = null;
            // Evaluate the supp floor itself so a feasible D that funds the
            // supplementals stays in the running even if the grid skips it.
            if (_floorB > 0) {
              var mFloor = _evalB(lockedWeights, _floorB);
              if (mFloor) { coarseBest = mFloor; _maybeUpdateBest(mFloor); }
            }
            for (var ci = 0; ci <= 10; ci++) {
              var D = Math.round(_bDMax * (ci / 10));
              if (D < _floorB - 0.5) continue;
              if (!_firstDepositLegalB(lockedWeights, D)) continue;
              var m = _evalB(lockedWeights, D);
              if (m && (!coarseBest || m.metrics.net > coarseBest.metrics.net)) coarseBest = m;
              _maybeUpdateBest(m);
            }
            if (typeof root.listSchwabCombosForStrategy === 'function') {
              try {
                var _stratKeyB = (cfgSection.tierKey || cfgSection.strategyKey || 'beta1');
                var _allCombosB = root.listSchwabCombosForStrategy(_stratKeyB) || [];
                var _userCapB = Number(cfgSection.leverageCap != null ? cfgSection.leverageCap
                                : (cfgSection.leverage != null ? cfgSection.leverage : 1));
                _allCombosB.forEach(function (c) {
                  if (!c || !Number.isFinite(c.minInvestment) || c.minInvestment <= 0) return;
                  if (Number(c.leverage) > _userCapB + 1e-6) return;
                  var Dbound = Math.round(c.minInvestment);
                  if (Dbound > _bDMax) return;
                  if (!_firstDepositLegalB(lockedWeights, Dbound)) return;
                  var mb = _evalB(lockedWeights, Dbound);
                  if (mb && (!coarseBest || mb.metrics.net > coarseBest.metrics.net)) coarseBest = mb;
                  _maybeUpdateBest(mb);
                });
              } catch (e) { /* keep coarse winner */ }
            }
            return coarseBest;
          }
          // Fine (±10% @ 2%) + ultra (±2% @ 0.5%) refinement around a
          // coarse winner, for a fixed weight set.
          function _sweepBDRefine(lockedWeights, coarseBest) {
            if (!coarseBest) return;
            var fineBest = coarseBest;
            for (var f = 1; f <= 5; f++) {
              [-1, 1].forEach(function (sign) {
                var D = Math.round(coarseBest.D + sign * f * 0.02 * _bDMax);
                if (D < 0 || D > _bDMax) return;
                if (!_firstDepositLegalB(lockedWeights, D)) return;
                var m = _evalB(lockedWeights, D);
                if (m && (!fineBest || m.metrics.net > fineBest.metrics.net)) fineBest = m;
                _maybeUpdateBest(m);
              });
            }
            if (fineBest) {
              for (var u = 1; u <= 4; u++) {
                [-1, 1].forEach(function (sign) {
                  var D = Math.round(fineBest.D + sign * u * 0.005 * _bDMax);
                  if (D < 0 || D > _bDMax) return;
                  if (!_firstDepositLegalB(lockedWeights, D)) return;
                  _maybeUpdateBest(_evalB(lockedWeights, D));
                });
              }
            }
          }
          function _sweepBD(lockedWeights) {
            _sweepBDRefine(lockedWeights, _sweepBDCoarse(lockedWeights));
          }
          // Joint (weights × down-payment) coverage (2026-06-01). The
          // best weights at D=0 are NOT necessarily the best weights at
          // the optimal down-payment. The decisive case: some weight
          // splits are ILLEGAL at D=0 (first deposit < the $1M Schwab
          // account-opening minimum) yet become legal — and optimal —
          // once a mid down-payment lifts the first deposit over $1M
          // (e.g. [0.2,0.6,0.2] @ ~$300K down, a real ~0.5% win that a
          // two-stage "weights@D=0 then D" search can never see, because
          // those weights return null at D=0 and never enter its
          // candidate set).
          //
          // Fix: sweep the FULL coarse weight grid jointly with the
          // coarse down-payment sweep. _sweepBDCoarse skips D's where the
          // first deposit is illegal, so an illegal-at-D=0 weight is
          // still scored at the D where it becomes legal. Pick the global
          // best (weights, D), then refine the down-payment around it.
          // The separate 2D fine/ultra weight passes above already
          // sharpen the D=0 weight peak, so coarse weight resolution here
          // is enough to GUARANTEE the joint optimum is contained.
          function _sweepBDJoint(weightGrid) {
            if (_bDMax <= 0 || !weightGrid || !weightGrid.length) return;
            var jointBest = null;
            weightGrid.forEach(function (w) {
              if (!w) return;
              var cb = _sweepBDCoarse(w);
              if (cb && (!jointBest || cb.metrics.net > jointBest.metrics.net)) jointBest = cb;
            });
            if (jointBest) _sweepBDRefine(jointBest.weights, jointBest);
          }

          if (nForHor === 1) {
            _maybeUpdateBest(_evalB([1]));
            _sweepBD([1]);
          } else if (nForHor === 2) {
            // 3-pass 1D sweep on w1 (w2 = 1 − w1):
            //   coarse 0.10 step over [0.1, 0.9]            (9 evals)
            //   fine   0.02 step ±0.10 around coarse winner (10 evals)
            //   ultra  0.001 step ±0.02 around fine winner  (~40 evals)
            // Total ~59 evals; finds optimum to ~0.1% (0.001 of split).
            var coarseW2 = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9];
            var coarseBestB2 = null;
            coarseW2.forEach(function (w1) {
              var out = _evalB([w1, 1 - w1]);
              if (out && (!coarseBestB2 || out.metrics.net > coarseBestB2.metrics.net)) coarseBestB2 = out;
              _maybeUpdateBest(out);
            });
            var fineBestB2 = coarseBestB2;
            if (coarseBestB2) {
              var w1Center = coarseBestB2.weights[0];
              for (var step2 = 1; step2 <= 4; step2++) {
                [-1, 1].forEach(function (sign) {
                  var w1Fine = Math.round((w1Center + sign * step2 * 0.02) * 1000) / 1000;
                  if (w1Fine <= 0.05 || w1Fine >= 0.95) return;
                  var outF = _evalB([w1Fine, 1 - w1Fine]);
                  if (outF && (!fineBestB2 || outF.metrics.net > fineBestB2.metrics.net)) fineBestB2 = outF;
                  _maybeUpdateBest(outF);
                });
              }
            }
            if (fineBestB2) {
              // Ultra-fine: ±0.020 in 0.001 steps around fine winner.
              // 40 evals — finds the precise peak to 0.1% precision.
              var w1Ultra = fineBestB2.weights[0];
              for (var us = -20; us <= 20; us++) {
                if (us === 0) continue;
                var w1U = Math.round((w1Ultra + us * 0.001) * 1000) / 1000;
                if (w1U <= 0.05 || w1U >= 0.95) continue;
                _maybeUpdateBest(_evalB([w1U, Math.round((1 - w1U) * 1000) / 1000]));
              }
              // Joint (weights × Y0 down-payment) sweep over the FULL
              // coarse weight grid plus the ultra-fine D=0 winner — so
              // splits that are illegal at D=0 but optimal at a mid
              // down-payment are still found (closes ~0.5% gap).
              var gridB2 = coarseW2.map(function (w1) {
                return [w1, Math.round((1 - w1) * 1000) / 1000];
              });
              gridB2.push(fineBestB2.weights);
              _sweepBDJoint(gridB2);
            }
          } else { // nForHor === 3
            // 3-pass 2D sweep on (w1, w2) with w3 = 1 − w1 − w2:
            //   coarse 0.10 grid    over [0.1, 0.8]²       (~50 valid)
            //   fine   0.02 grid   ±0.10 around 2D winner  (~80 valid)
            //   ultra  0.005 grid  ±0.02 around 2D winner  (~64 valid)
            // 2D quadratic blow-up keeps ultra at 0.005 (~0.5%) - 0.001
            // would be 1600+ ultra evals per (hor, combo).
            var coarseW3 = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8];
            var coarseBestB3 = null;
            coarseW3.forEach(function (w1) {
              coarseW3.forEach(function (w2) {
                var w3 = 1 - w1 - w2;
                if (w3 < 0.05 || w3 > 0.9) return;
                var out = _evalB([w1, w2, w3]);
                if (out && (!coarseBestB3 || out.metrics.net > coarseBestB3.metrics.net)) coarseBestB3 = out;
                _maybeUpdateBest(out);
              });
            });
            var fineBestB3 = coarseBestB3;
            if (coarseBestB3) {
              var w1c = coarseBestB3.weights[0];
              var w2c = coarseBestB3.weights[1];
              for (var s1 = -4; s1 <= 4; s1++) {
                for (var s2 = -4; s2 <= 4; s2++) {
                  if (s1 === 0 && s2 === 0) continue;
                  var w1f = Math.round((w1c + s1 * 0.02) * 1000) / 1000;
                  var w2f = Math.round((w2c + s2 * 0.02) * 1000) / 1000;
                  var w3f = Math.round((1 - w1f - w2f) * 1000) / 1000;
                  if (w1f < 0.05 || w2f < 0.05 || w3f < 0.05) continue;
                  if (w1f > 0.9 || w2f > 0.9 || w3f > 0.9) continue;
                  var outF3 = _evalB([w1f, w2f, w3f]);
                  if (outF3 && (!fineBestB3 || outF3.metrics.net > fineBestB3.metrics.net)) fineBestB3 = outF3;
                  _maybeUpdateBest(outF3);
                }
              }
            }
            if (fineBestB3) {
              // Ultra-fine: 0.005 step ±0.02 (~8×8 grid = 64) around
              // 2D fine winner.
              var w1u = fineBestB3.weights[0];
              var w2u = fineBestB3.weights[1];
              for (var u1 = -4; u1 <= 4; u1++) {
                for (var u2 = -4; u2 <= 4; u2++) {
                  if (u1 === 0 && u2 === 0) continue;
                  var w1uf = Math.round((w1u + u1 * 0.005) * 1000) / 1000;
                  var w2uf = Math.round((w2u + u2 * 0.005) * 1000) / 1000;
                  var w3uf = Math.round((1 - w1uf - w2uf) * 1000) / 1000;
                  if (w1uf < 0.05 || w2uf < 0.05 || w3uf < 0.05) continue;
                  if (w1uf > 0.9 || w2uf > 0.9 || w3uf > 0.9) continue;
                  _maybeUpdateBest(_evalB([w1uf, w2uf, w3uf]));
                }
              }
              // Joint (weights × Y0 down-payment) sweep over the FULL
              // coarse 2D weight grid plus the 2D ultra-fine D=0 winner —
              // closes the ~0.5% joint-optimum gap where a split that is
              // illegal at D=0 (first deposit < $1M) wins once a mid
              // down-payment lifts its first deposit over the $1M floor
              // (e.g. [0.2,0.6,0.2] @ ~$300K down).
              var gridB3 = [];
              coarseW3.forEach(function (w1) {
                coarseW3.forEach(function (w2) {
                  var w3 = Math.round((1 - w1 - w2) * 1000) / 1000;
                  if (w3 < 0.05 || w3 > 0.9) return;
                  gridB3.push([w1, w2, w3]);
                });
              });
              gridB3.push(fineBestB3.weights);
              _sweepBDJoint(gridB3);
            }
            // C-coverage guarantee (advisor 2026-05-27): Strategy C is
            // locked to [0.40, 0.40, 0.20] + a Y0-down sweep. B's
            // two-stage solver (weights@D=0, then D on those weights)
            // can miss the joint (weights, D) optimum that C finds —
            // e.g. small sales where the C-style 40/40/20 + a mid Y0
            // down beats B's D=0 weight pick. Run the D sweep on C's
            // exact locked weights so B's search ALWAYS contains C's
            // configuration and B ≥ C holds by construction.
            _sweepBD([0.4, 0.4, 0.2]);
          }
        } else {
          // A doesn't use a deferred-sale duration — pass through the
          // cfg fallback so downstream callers always have something.
          var typedCfg2 = _scenarioCfgFor(type, cfgSection, 2, userDurationFallback);
          var m2 = _scenarioMetrics(typedCfg2);
          if (m2) {
            var _pkA = { horizon: hor, shortPct: p.shortPct, comboId: p.comboId, bestRecC: 2, net: m2.net, durationMonths: userDurationFallback };
            _recordCombo(_pkA, m2.net);   // F25: feed A into dial-back refinement
            if (!best || m2.net > best.net) best = _pkA;
          }
        }
      });
    });

    // Dial-back-aware combo refinement (2026-05-29). Re-score each combo's
    // best-FULL candidate at its dial-back optimum and switch `best` to the
    // genuinely net-best — so the optimizer doesn't lock in a combo that
    // wins at full deployment but loses once dialed back (the structured
    // sale's 200/100-vs-145/45 mis-pick). F25 (2026-06-01): A IS dialed
    // back too (buildInterestedSummary line ~3215), so it gets the same
    // refinement — fixes the cap=$8M combo mis-pick where A locked a combo
    // at full deployment that lost once scaled down.
    if (best && (type === 'A' || type === 'B' || type === 'C')) {
      var _comboKeys = Object.keys(_bestPerComboFull);
      if (_comboKeys.length > 1 && typeof _netMaxDeployFraction === 'function') {
        var _dialedNetForPick = function (pk) {
          var sec = Object.assign({}, baseCfg, {
            horizonYears: pk.horizon, leverage: pk.shortPct / 100,
            leverageCap: pk.shortPct / 100, comboId: pk.comboId
          });
          var iw = Array.isArray(pk.installmentWeights) ? pk.installmentWeights : null;
          var pr = Number.isFinite(pk.parkRatio) ? pk.parkRatio : null;
          var y0 = Number.isFinite(pk.y0DownPayment) ? pk.y0DownPayment : null;
          var cfg = _scenarioCfgFor(type, sec, pk.bestRecC, pk.durationMonths || userDurationFallback, pr, iw, y0);
          var m = _scenarioMetrics(cfg);
          if (!m) return -Infinity;
          var avail = Number(cfg.availableCapital) || 0;
          if (!(avail > 0)) return m.net;
          var scale = _netMaxDeployFraction(cfg);
          if (scale >= 1) return m.net;
          if (scale <= 0) return Math.max(0, m.net);   // no-engage floor
          var redCap = Math.round(avail * scale);
          var m2 = _scenarioMetrics(Object.assign({}, cfg, { availableCapital: redCap, investment: redCap, investedCapital: redCap }));
          return (m2 && m2.net > m.net) ? m2.net : m.net;
        };
        var _bestDialed = null;
        _comboKeys.forEach(function (k) {
          var pk = _bestPerComboFull[k].picked;
          var dn = _dialedNetForPick(pk);
          if (!_bestDialed || dn > _bestDialed.dn) _bestDialed = { pk: pk, dn: dn };
        });
        // Only switch if the dial-back winner genuinely beats the current
        // pick's dialed net (avoids churn on ties).
        if (_bestDialed && _bestDialed.pk && _bestDialed.pk.comboId !== best.comboId) {
          var _curDialed = _dialedNetForPick(best);
          if (_bestDialed.dn > _curDialed + 250) best = _bestDialed.pk;
        }
      }
    }
    return best || { horizon: 5, shortPct: 100, comboId: null, bestRecC: 2, durationMonths: 36, parkRatio: 0 };
  }

  function _ensureSectionState(type, baseCfg) {
    if (!root.__rettSectionState) root.__rettSectionState = {};
    var existing = root.__rettSectionState[type];
    if (existing && existing.autoPickEnabled === false) return existing;
    // Auto-pick from scratch (or refresh after a Page-1 edit).
    var picked = _autoPickSection(type, baseCfg);
    root.__rettSectionState[type] = {
      horizon: picked.horizon,
      shortPct: picked.shortPct,
      comboId: picked.comboId,
      bestRecC: picked.bestRecC,
      durationMonths: baseCfg.structuredSaleDurationMonths || 36,
      autoPickEnabled: true
    };
    return root.__rettSectionState[type];
  }

  // Drift guard. Compares a section's rendered totals against the row
  // metrics that motivated the section. Skips when the section was
  // manually overridden (autoPickEnabled === false) — drift in that
  // case is INTENTIONAL.
  //
  // F1 (2026-05-27): the check now applies only to Strategy B. The
  // original $1 tolerance was correct when both pipelines ran through
  // the same engine path with the same cfg, but two known sources of
  // legitimate divergence have since been introduced:
  //   • Strategy A immediate path: _scenarioMetrics pulls Brooklyn
  //     fees from ProjectionEngine.run (1-year hold), while the section
  //     dashboard reads unifiedTaxComparison.totalFees (multi-year).
  //     These are different fee-accrual models and disagree by design.
  //   • Strategy C parkRatio sweep: the row pipeline's pickedC.cfg
  //     carries a sweep-winning parkRatio that the section pipeline
  //     re-derives independently — producing 60%+ deltas in net.
  // Tolerance also widened to max($1000, 1% of net) so floating-point
  // noise on Strategy B doesn't false-trigger.
  function _assertRowDashboardConsistency(type, sectionData, rowMetrics, sectionState) {
    if (!sectionData || !sectionData.comp || !rowMetrics) return;
    if (sectionState && sectionState.autoPickEnabled === false) return;
    // Skip strategies with known multi-pipeline divergence.
    if (type === 'A' || type === 'C') return;
    var dn = 0, w = 0;
    (sectionData.comp.rows || []).forEach(function (rr) {
      dn += (rr.doNothingBaseline ? rr.doNothingBaseline.total
              : (rr.baseline ? rr.baseline.total : 0));
      w  += (rr.withStrategy ? rr.withStrategy.total : 0);
    });
    var bk = sectionData.comp.totalFees != null
              ? sectionData.comp.totalFees
              : ((sectionData.result && sectionData.result.totals
                  && sectionData.result.totals.cumulativeFees) || 0);
    var bh = sectionData.comp.totalBrookhavenFees || 0;
    var dashTax  = w;
    var dashFees = bk + bh;
    var dashNet  = dn - w - bk - bh;
    var dTax  = Math.abs(dashTax  - rowMetrics.tax);
    var dFees = Math.abs(dashFees - rowMetrics.fees);
    var dNet  = Math.abs(dashNet  - rowMetrics.net);
    var tol   = Math.max(1000, Math.abs(rowMetrics.net) * 0.01);
    if (dTax > tol || dFees > tol || dNet > tol) {
      try {
        console.warn('[RETT drift] Scenario ' + type +
          ' row vs dashboard mismatch (tolerance ' + Math.round(tol) + '):',
          { row:  { tax: rowMetrics.tax,  fees: rowMetrics.fees,  net: rowMetrics.net  },
            dash: { tax: dashTax,         fees: dashFees,         net: dashNet         },
            deltas: { tax: dTax, fees: dFees, net: dNet } });
      } catch (e) { /* console may be missing in headless contexts */ }
    }
  }

  function _resolveSectionCfg(type, baseCfg) {
    var st = _ensureSectionState(type, baseCfg);
    var cfgSection = Object.assign({}, baseCfg, {
      horizonYears: st.horizon,
      leverage: st.shortPct / 100,
      leverageCap: st.shortPct / 100,
      comboId: st.comboId
    });
    return _scenarioCfgFor(type, cfgSection, st.bestRecC, st.durationMonths);
  }

  // Tier-migration-aware leverage label. The engine ratchets all active
  // tranches up to a higher combo the year cumulative deployment crosses
  // that combo's minimum (tax-comparison.js _pickComboForCumulative), but
  // the summary only printed the ceiling combo, hiding the swap. This
  // replays the SAME one-way ratchet over the per-year cumulative
  // investment already on `years` and returns e.g. "145/45 → 200/100
  // (Year 2)" when the position migrates mid-horizon, or just "200/100"
  // when it doesn't. cfg.comboId is the ceiling (auto-pick / user combo);
  // the tier list is filtered to leverage <= ceiling, exactly like the
  // engine. No extra engine run — years[] is already computed. (2026-05-28)
  function _comboMigrationLabel(comboId, years) {
    if (!comboId || typeof root.getSchwabCombo !== 'function') return null;
    var ceiling = root.getSchwabCombo(comboId);
    if (!ceiling) return null;
    if (typeof root.listSchwabCombosForStrategy !== 'function') return ceiling.leverageLabel;
    var tier = (root.listSchwabCombosForStrategy(ceiling.strategyKey) || [])
      .filter(function (c) { return c && c.leverage <= ceiling.leverage + 1e-6; })
      .sort(function (a, b) { return a.minInvestment - b.minInvestment; });
    if (!tier.length) return ceiling.leverageLabel;
    function pick(cum) {
      var p = tier[0];
      for (var k = 0; k < tier.length; k++) if (cum + 0.01 >= tier[k].minInvestment) p = tier[k];
      return p;
    }
    var seq = [], peak = 0, lastId = null;
    (years || []).forEach(function (y, idx) {
      var cum = Number(y.investmentThisYear) || 0;
      if (cum <= 0) return;                       // no active capital yet → no combo
      if (cum > peak) peak = cum;                 // one-way ratchet on peak cumulative
      var c = pick(peak);
      if (c && c.id !== lastId) { seq.push({ label: c.leverageLabel, year: idx + 1 }); lastId = c.id; }
    });
    if (seq.length <= 1) return seq.length ? seq[0].label : ceiling.leverageLabel;
    return seq.map(function (s) { return s.label; }).join(' → ') +
           ' (Year ' + seq[seq.length - 1].year + ')';
  }

  // The combo id a given cumulative deployment actually qualifies for,
  // capped at the ceiling combo (same one-way ratchet as the engine's
  // _pickComboForCumulative). When the deployment never reaches a higher
  // tier's minimum, this returns the lower tier — so callers can show the
  // EFFECTIVE combo (and its real loss/fee rates) instead of the ceiling.
  function _effectiveComboId(ceilingComboId, cumulative) {
    if (!ceilingComboId || typeof root.getSchwabCombo !== 'function') return ceilingComboId;
    var ceiling = root.getSchwabCombo(ceilingComboId);
    if (!ceiling || typeof root.listSchwabCombosForStrategy !== 'function') return ceilingComboId;
    var tier = (root.listSchwabCombosForStrategy(ceiling.strategyKey) || [])
      .filter(function (c) { return c && c.leverage <= ceiling.leverage + 1e-6; })
      .sort(function (a, b) { return a.minInvestment - b.minInvestment; });
    if (!tier.length) return ceilingComboId;
    var picked = tier[0], cum = Number(cumulative) || 0;
    for (var k = 0; k < tier.length; k++) if (cum + 0.01 >= tier[k].minInvestment) picked = tier[k];
    return picked ? picked.id : ceilingComboId;
  }

  function _sectionConfigDescription(type, st, levOverride) {
    if (!st) return '';
    var lev = st.shortPct + '% short';
    // Schwab: show the friendly label
    if (st.comboId && typeof root.getSchwabCombo === 'function') {
      var combo = root.getSchwabCombo(st.comboId);
      if (combo) lev = combo.leverageLabel;
    }
    // Migration-aware override (e.g. "145/45 → 200/100 (Year 2)") when the
    // tier ratchets mid-horizon — supplied by _buildScenarioSection.
    if (levOverride) lev = levOverride;
    var hor = st.horizon + ' yr' + (st.horizon === 1 ? '' : 's');
    if (type === 'A') return hor + ' / ' + lev;
    if (type === 'B') return hor + ' / ' + lev;
    if (type === 'C') return st.durationMonths + ' months / ' + hor + ' / ' + lev + ' / Y' + (st.bestRecC || 2) + ' recog.';
    return '';
  }

  function _buildSectionControls(type, baseCfg) {
    var st = _ensureSectionState(type, baseCfg);
    var custId = baseCfg.custodian || '';
    var stratKey = baseCfg.tierKey || 'beta1';
    var horizons = [1, 3, 5, 7];
    var horHtml = '<div class="rett-section-pillgroup"><span class="pill-group-label">Horizon</span><div class="pill-track">';
    horizons.forEach(function (h) {
      // Hide 1-year for B/C — recognition needs ≥ 2 years.
      // C still requires horizon >= 2 (deferred path needs a recognition
      // year past Y1). B is now a single-tranche immediate path and
      // works at horizon=1.
      if (h < 2 && type === 'C') return;
      var active = h === st.horizon;
      horHtml += '<button type="button" class="pill' + (active ? ' active' : '') +
        '" data-section-pill="horizon" data-section="' + type +
        '" data-value="' + h + '" role="radio" aria-checked="' + (active ? 'true' : 'false') +
        '">' + h + 'y</button>';
    });
    horHtml += '</div></div>';

    var levHtml = '';
    if (custId === 'schwab' && typeof root.listSchwabCombos === 'function') {
      var combos = root.listSchwabCombos().filter(function (c) { return c.strategyKey === stratKey; });
      levHtml = '<div class="rett-section-pillgroup"><span class="pill-group-label">Leverage</span><div class="pill-track">';
      combos.forEach(function (c) {
        var active = c.id === st.comboId;
        levHtml += '<button type="button" class="pill' + (active ? ' active' : '') +
          '" data-section-pill="combo" data-section="' + type +
          '" data-combo-id="' + c.id + '" data-value="' + (c.shortPct || 0) +
          '" role="radio" aria-checked="' + (active ? 'true' : 'false') +
          '">' + c.leverageLabel + '</button>';
      });
      levHtml += '</div></div>';
    } else {
      levHtml = '<div class="rett-section-slidergroup">' +
        '<span class="pill-group-label">Leverage</span>' +
        '<input type="range" class="rett-section-leverage-slider" data-section="' + type +
        '" min="0" max="225" step="1" value="' + st.shortPct + '">' +
        '<span class="rett-section-leverage-readout" data-section-readout="' + type + '">' +
        st.shortPct + '% short</span>' +
        '</div>';
    }

    var revertHtml = '';
    if (st.autoPickEnabled === false) {
      revertHtml = '<button type="button" class="btn btn-secondary btn-revert"' +
        ' data-section-revert="' + type + '">Revert to optimized</button>';
    } else {
      revertHtml = '<span class="rett-section-optimized-tag">auto-optimized</span>';
    }

    return '<div class="rett-section-controls">' + horHtml + levHtml + revertHtml + '</div>';
  }

  function _buildScenarioSection(label, data, type, baseCfg) {
    if (!data || !data.years) return '';
    var totals = (data.result && data.result.totals) || {};
    var st = (root.__rettSectionState || {})[type] || null;
    var migLabel = null;
    try {
      if (st && st.comboId && data && data.years) {
        migLabel = _comboMigrationLabel(st.comboId, data.years);
      }
    } catch (e) { migLabel = null; }
    var configStr = _sectionConfigDescription(type, st, migLabel);
    var html = '<div class="rett-dashboard rett-scenario-section" id="rett-section-' + (type || 'X') + '">';
    html += '<div class="rett-scenario-section-header">' +
            '<span class="rett-scenario-section-title-text">' + label + '</span>' +
            (configStr ? ' <span class="rett-scenario-section-config">' + configStr + '</span>' : '') +
            '</div>';
    // Per-section horizon / leverage controls only make sense for the
    // Structured-sale dashboard (C). Sell-Now (A) is naturally a Y1
    // event and Delay-Close (B) is naturally a Y2-only event — both
    // auto-pick optimally and have no useful "tune the leverage"
    // story. C is the one multi-year scenario where the advisor might
    // reasonably want to override.
    if (type === 'C' && baseCfg) {
      html += _buildSectionControls(type, baseCfg);
    }
    html += _buildKpiRow(data.years, totals, data.comp, data.result);
    html += _buildChart(data.years);
    html += _buildPies(data.years, data.comp, data.result);
    html += '</div>';
    return html;
  }

  // Build the Details sub-tab content from the per-section data the
  // Summary tab just rendered. One labeled table per checked scenario
  // so the data-table view stays in lock-step with whatever is
  // visible on the Summary tab. Falls back to a global single-table
  // render via the caller when no sections are checked.
  function _buildDetailsForChecked() {
    var rows = root.__rettScenarioRows || [];
    var checked = root.__rettCheckedScenarios || {};
    var sectionData = root.__rettSectionData || {};
    var html = '';
    rows.forEach(function (row) {
      if (!checked[row.type]) return;
      var data = sectionData[row.type];
      if (!data) return;
      // Years array is what _scenarioFullData built; if absent, derive
      // from comp.rows so the table still renders.
      var years = data.years;
      if (!years && data.comp && Array.isArray(data.comp.rows)) {
        years = data.comp.rows.map(function (r) {
          return {
            year: r.year,
            taxNoBrooklyn: r.baseline ? r.baseline.total : 0,
            taxWithBrooklyn: r.withStrategy ? r.withStrategy.total : 0,
            investmentThisYear: r.investmentThisYear || 0,
            gainRecognized: r.gainRecognized || 0,
            grossLoss: r.lossGenerated || r.lossApplied || 0,
            fee: r.fee || 0
          };
        });
      }
      if (!years || !years.length) return;
      html += '<div class="rett-details-section">' +
              '<h3 class="rett-details-section-title">' + row.label + '</h3>' +
              _buildTable(years) +
              '</div>';
    });
    return html;
  }

  // Re-render a single section in place (no full pipeline, no global
  // recompute). Called from per-section pill / slider / revert handlers.
  function _renderSingleSection(type) {
    var host = document.getElementById('rett-section-' + type);
    if (!host) return;
    var baseCfg = (typeof collectInputs === 'function') ? (function () {
      try { return collectInputs(); } catch (e) { return null; }
    })() : null;
    if (!baseCfg) return;
    var rows = root.__rettScenarioRows || [];
    var row = rows.filter(function (r) { return r.type === type; })[0];
    var label = row ? row.label : type;
    var sectionCfg = _resolveSectionCfg(type, baseCfg);
    var data = _scenarioFullData(sectionCfg);
    if (!data) return;
    // Replace the entire section in place by rebuilding its HTML.
    var newHtml = _buildScenarioSection(label, data, type, baseCfg);
    var tmp = document.createElement('div');
    tmp.innerHTML = newHtml;
    var newSection = tmp.firstChild;
    if (newSection && host.parentNode) {
      host.parentNode.replaceChild(newSection, host);
    }
    if (typeof root.animateRettNumbers === 'function') {
      try { root.animateRettNumbers(newSection); } catch (e) { /* */ }
    }
  }

  // Click delegation for per-section controls — wired once on the
  // summary host. Catches horizon pills, Schwab combo pills, slider
  // input, and revert clicks; routes each to the right section's state
  // update + single-section re-render.
  function _wireSectionControls() {
    var host = document.getElementById('projection-summary-host');
    if (!host || host.__rettSectionControlsWired) return;
    host.__rettSectionControlsWired = true;
    host.addEventListener('click', function (e) {
      var pill = e.target.closest && e.target.closest('button[data-section-pill]');
      if (pill) {
        var type = pill.getAttribute('data-section');
        var kind = pill.getAttribute('data-section-pill');
        var value = pill.getAttribute('data-value');
        if (!type || !root.__rettSectionState || !root.__rettSectionState[type]) return;
        var st = root.__rettSectionState[type];
        if (kind === 'horizon') {
          st.horizon = parseInt(value, 10) || st.horizon;
        } else if (kind === 'combo') {
          st.shortPct = parseFloat(value) || st.shortPct;
          st.comboId = pill.getAttribute('data-combo-id') || null;
        }
        st.autoPickEnabled = false;
        _renderSingleSection(type);
        return;
      }
      var revertBtn = e.target.closest && e.target.closest('[data-section-revert]');
      if (revertBtn) {
        var rType = revertBtn.getAttribute('data-section-revert');
        if (root.__rettSectionState && root.__rettSectionState[rType]) {
          delete root.__rettSectionState[rType];
        }
        _renderSingleSection(rType);
        return;
      }
    });
    host.addEventListener('input', function (e) {
      if (!e.target.classList || !e.target.classList.contains('rett-section-leverage-slider')) return;
      var type = e.target.getAttribute('data-section');
      if (!type || !root.__rettSectionState || !root.__rettSectionState[type]) return;
      var st = root.__rettSectionState[type];
      st.shortPct = parseInt(e.target.value, 10) || 0;
      st.comboId = null;
      st.autoPickEnabled = false;
      // Cheap immediate update of the readout text; full section
      // re-render coalesced via rAF to keep drag responsive.
      var readout = document.querySelector('[data-section-readout="' + type + '"]');
      if (readout) readout.textContent = st.shortPct + '% short';
      if (st.__rafPending) return;
      st.__rafPending = true;
      (root.requestAnimationFrame || function (cb) { return setTimeout(cb, 16); })(function () {
        st.__rafPending = false;
        _renderSingleSection(type);
      });
    });
  }

  // Click delegation for scenario rows. Toggles the row's checked state
  // (multi-select). Re-attaches on every render since the scenarioHost
  // innerHTML rebuild replaces the row elements.
  function _wireScenarioRowClicks(scenarioHost) {
    if (!scenarioHost) return;
    scenarioHost.onclick = function (e) {
      // Direct checkbox click is handled natively — capture its state
      // via the change event we redirect through the row toggle.
      var checkbox = e.target.closest && e.target.closest('input.rett-scenario-checkbox');
      if (checkbox) {
        // Let the click flip the checkbox first, then read state.
        // setTimeout(0) so we read AFTER the browser updates checked.
        setTimeout(function () { _syncCheckedFromDom(); _renderDashboardsFromChecked(); }, 0);
        return;
      }
      var tr = e.target.closest && e.target.closest('tr.rett-scenario-row');
      if (!tr) return;
      _toggleScenarioRow(tr);
    };
    scenarioHost.onkeydown = function (e) {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      var tr = e.target.closest && e.target.closest('tr.rett-scenario-row');
      if (!tr) return;
      e.preventDefault();
      _toggleScenarioRow(tr);
    };
  }

  function _toggleScenarioRow(tr) {
    var type = tr.getAttribute('data-scenario');
    if (!type) return;
    var checked = root.__rettCheckedScenarios || (root.__rettCheckedScenarios = {});
    if (checked[type]) delete checked[type];
    else checked[type] = true;
    // Sync checkbox state in DOM without a re-render of the panel.
    var cb = tr.querySelector('input.rett-scenario-checkbox');
    if (cb) cb.checked = !!checked[type];
    tr.classList.toggle('rett-scenario-checked', !!checked[type]);
    tr.setAttribute('aria-pressed', checked[type] ? 'true' : 'false');
    _renderDashboardsFromChecked();
  }

  // Read checkbox state from DOM and update the global set (used by the
  // direct checkbox-click path).
  function _syncCheckedFromDom() {
    var checked = root.__rettCheckedScenarios = {};
    document.querySelectorAll('input.rett-scenario-checkbox').forEach(function (cb) {
      var type = cb.getAttribute('data-scenario-toggle');
      if (type && cb.checked) checked[type] = true;
    });
    // Sync row classes
    document.querySelectorAll('tr.rett-scenario-row').forEach(function (tr) {
      var t = tr.getAttribute('data-scenario');
      var on = !!checked[t];
      tr.classList.toggle('rett-scenario-checked', on);
      tr.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
  }

  // Re-render only the dashboard sections (KPIs/chart/pies) without
  // touching the comparison panel. Called after a checkbox toggle.
  function _renderDashboardsFromChecked() {
    var summaryHost = document.getElementById('projection-summary-host');
    if (!summaryHost) return;
    var rows = root.__rettScenarioRows || [];
    var checked = root.__rettCheckedScenarios || {};
    var currentCfg = (typeof collectInputs === 'function') ? (function () {
      try { return collectInputs(); } catch (e) { return null; }
    })() : null;
    if (!currentCfg) return;
    // Reset the per-section data map and active-section tracker before
    // we rebuild — stale data from an unchecked section would otherwise
    // leak into the savings-ribbon render path.
    root.__rettSectionData = {};
    var sections = '';
    var renderedTypes = [];
    var labelByType = {};
    var dataByType = {};
    rows.forEach(function (row) {
      if (!checked[row.type]) return;
      // Per-section: each section auto-picks its OWN (horizon, leverage,
      // bestRec for C) — independent of the global Page-2 toolbar — so
      // checking multiple scenarios surfaces three independently
      // optimized dashboards. _resolveSectionCfg ensures each section
      // has state and applies it to the cfg.
      var cfg = _resolveSectionCfg(row.type, currentCfg);
      var data = _scenarioFullData(cfg);
      if (!data) return;
      sections += _buildScenarioSection(row.label, data, row.type, currentCfg);
      renderedTypes.push(row.type);
      labelByType[row.type] = row.label;
      dataByType[row.type] = data;
      // Stash for the savings-ribbon scroll observer.
      root.__rettSectionData[row.type] = { comp: data.comp, result: data.result };
      // Drift guard: when the section is in auto-pick mode, its rendered
      // numbers MUST match the comparison row that motivated it. A
      // disagreement means the row pipeline (_buildScenarioComparison ->
      // _bestPickedCfg) and the section pipeline (_resolveSectionCfg ->
      // _scenarioFullData) have drifted — typically because somebody
      // changed one auto-pick path without the other. Warn (not throw)
      // so the calculator still renders, but a developer watching the
      // console sees the corruption immediately.
      _assertRowDashboardConsistency(row.type, data, row.metrics,
        (root.__rettSectionState || {})[row.type]);
    });
    if (!sections) {
      sections = '<div class="rett-no-scenarios" style="' +
        'background:rgba(15, 76, 129, 0.18);border:1px solid rgba(26, 58, 110, 0.6);' +
        'border-radius:6px;padding:18px;margin:18px 0;color:#cfe1ff;text-align:center;">' +
        'Check a scenario above to see its dashboard.' +
        '</div>';
    }
    summaryHost.innerHTML = sections;
    _wireSectionControls();
    _wireSectionRibbonObserver(renderedTypes, labelByType);
    // Mirror the section list into the Details sub-tab so the data
    // table view never shows stale numbers from a scenario the user
    // unchecked. One labeled table per checked scenario, in the same
    // order as the comparison rows above.
    var detailsHost = document.getElementById('projection-details-host');
    if (detailsHost) {
      var detailsHtml = _buildDetailsForChecked();
      detailsHost.innerHTML = detailsHtml ||
        '<p class="subtitle">Check a scenario above to see its year-by-year detail.</p>';
    }
    if (typeof root.animateRettNumbers === 'function') {
      try { root.animateRettNumbers(); } catch (e) { /* */ }
    }
  }

  // Sticky savings ribbon: as the user scrolls, swap which scenario's
  // numbers populate the ribbon at the top. On initial render the
  // ribbon shows the first rendered section (which is the recommended
  // scenario when only that one is checked, or the topmost checked one
  // when multiple are checked). As the user scrolls past one section
  // into the next, the ribbon updates to reflect the section currently
  // dominating the viewport. Hides entirely when no sections are
  // rendered (empty-state callout above).
  function _wireSectionRibbonObserver(renderedTypes, labelByType) {
    var ribbon = document.getElementById('savings-ribbon');
    if (!ribbon) return;
    if (!renderedTypes || !renderedTypes.length) {
      ribbon.hidden = true;
      ribbon.innerHTML = '';
      root.__rettActiveRibbonType = null;
      return;
    }
    // Disconnect any prior observer — new section list, fresh observer.
    if (root.__rettSectionRibbonObserver) {
      try { root.__rettSectionRibbonObserver.disconnect(); } catch (e) { /* */ }
      root.__rettSectionRibbonObserver = null;
    }
    // When multiple scenarios are checked the ribbon can't pick a single
    // truth without misleading the user, and the scroll-handoff logic
    // has known glitches across stacked sections. Hide it entirely in
    // that case; bring it back the moment the user narrows to one.
    if (renderedTypes.length > 1) {
      ribbon.hidden = true;
      ribbon.innerHTML = '';
      root.__rettActiveRibbonType = null;
      return;
    }
    // Default to the FIRST rendered section so the ribbon has content
    // before the user has scrolled. Reset the dedupe key first — the
    // sections were just rebuilt with fresh data, so even if the type
    // is unchanged from the prior render we MUST refresh the ribbon's
    // numbers. Without this reset, reloading a saved client whose
    // recommended scenario type matches the prior page state leaves
    // the ribbon stuck displaying the old client's totals.
    root.__rettActiveRibbonType = null;
    var initialType = renderedTypes[0];
    _maybeRenderRibbonForSection(initialType, labelByType[initialType]);

    if (typeof root.IntersectionObserver !== 'function') {
      // No observer support — leave ribbon on the initial section.
      return;
    }
    // Track each section's intersection ratio. The most-visible one
    // wins. Single-threshold observer (fires only when crossing 30%)
    // limits the fire rate during smooth scroll so we don't churn the
    // ribbon's number animator on every pixel of scroll.
    var ratios = {};
    var observer = new root.IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        var t = entry.target.getAttribute('data-section-type');
        if (!t) return;
        ratios[t] = entry.isIntersecting ? entry.intersectionRatio : 0;
      });
      // Pick the type with the highest current ratio — when nothing is
      // significantly on-screen (e.g. scrolled past everything), keep
      // showing whatever was last active rather than snapping back to
      // the first rendered type. This avoids the ribbon flickering
      // back to A when the user scrolls below all sections.
      var bestType = null, bestRatio = 0;
      renderedTypes.forEach(function (t) {
        var r = ratios[t] || 0;
        if (r > bestRatio) { bestRatio = r; bestType = t; }
      });
      if (!bestType || bestRatio <= 0) bestType = root.__rettActiveRibbonType || renderedTypes[0];
      _maybeRenderRibbonForSection(bestType, labelByType[bestType]);
    }, {
      // Single 30% threshold gives clean handoff (one section reaches
      // 30% as the previous drops below it) without the firehose of
      // events the multi-step threshold pattern produces.
      threshold: 0.3,
      // Account for the sticky ribbon's own height at the top so a
      // section technically "in view" but obscured by the ribbon
      // doesn't count.
      rootMargin: '-72px 0px 0px 0px'
    });
    renderedTypes.forEach(function (t) {
      var el = document.getElementById('rett-section-' + t);
      if (!el) return;
      el.setAttribute('data-section-type', t);
      observer.observe(el);
    });
    root.__rettSectionRibbonObserver = observer;
  }

  // Skip the ribbon re-render entirely when the active section hasn't
  // changed. Without this guard, every IntersectionObserver fire (which
  // can happen many times per second during smooth scroll) rebuilds
  // the ribbon's innerHTML, restarting the number-animator's count-up
  // for each tile and producing a visible flicker on the values.
  function _maybeRenderRibbonForSection(type, label) {
    if (!type) return;
    if (root.__rettActiveRibbonType === type) return;
    root.__rettActiveRibbonType = type;
    if (typeof root.renderSavingsRibbon === 'function') {
      try { root.renderSavingsRibbon(type, label); } catch (e) { /* */ }
    }
  }

  function renderProjectionDashboard(host) {
    // Sub-tab layout: Summary holds KPI tiles + chart, Details holds
    // the data table. The split hosts are always present in the
    // current HTML; the legacy single-host fallback (#projection-table)
    // was removed once the dashboard fully replaced the old renderer.
    var summaryHost = document.getElementById('projection-summary-host');
    var detailsHost = document.getElementById('projection-details-host');
    var splitMode = !!(summaryHost && detailsHost) && !host;
    if (!splitMode && !host) return;
    var result = window.__lastResult;
    var comp = window.__lastComparison;

    // If we have a comparison (from Run Decision Engine), use its richer
    // year-by-year baseline-vs-with numbers as the source of truth.
    var years = null;
    if (comp && Array.isArray(comp.rows) && comp.rows.length) {
      // No-action detection: when the engine recommended no investment
      // (zero gain to offset, or all rows show zero strategy activity), we
      // must NOT apply the per-year fee from the projection engine, since
      // the user wouldn't actually invest. Treat the dashboard as $0/$0/$0.
      var isNoAction = comp.totalSavings === 0 && comp.rows.every(function (r) {
        return (!r.gainRecognized || r.gainRecognized === 0) &&
               (!r.lossApplied || r.lossApplied === 0);
      });
      years = comp.rows.map(function (r, idx) {
        var resYr = (result && result.years && result.years[idx]) || {};
        // Deferred-comparison rows carry their own per-year investment, fee,
        // and lossGenerated values that are authoritative — ignore the
        // projection-engine row when present.
        if (comp.deferred) {
          return {
            year: r.year,
            taxNoBrooklyn: r.baseline ? r.baseline.total : 0,
            // Chart-only "do nothing" baseline: full property gain in Y1,
            // zero in Y2+. KPI / details / ribbon ignore this and keep
            // using taxNoBrooklyn (matched-timing apples-to-apples).
            taxNoBrooklynDoNothing: r.doNothingBaseline ? r.doNothingBaseline.total : null,
            taxWithBrooklyn: r.withStrategy ? r.withStrategy.total : 0,
            investmentThisYear: r.investmentThisYear || 0,
            gainRecognized: r.gainRecognized || 0,
            grossLoss: r.lossGenerated || r.lossApplied || 0,
            fee: r.fee || 0
          };
        }
        // Immediate path: pull investmentThisYear / grossLoss / fee
        // STRICTLY from the projection engine (resYr). The Brooklyn
        // position stays open every year the user has capital deployed,
        // so fees and losses both track cfg.investment held constant.
        // We deliberately do NOT use the legacy
        // recommendation.stage2.{investmentByYear, feeByYear} arrays —
        // those described a "structured-sale-then-close" lifecycle that
        // assumed the position closes after Y1 and would zero fees /
        // investment in Y2+ even though the engine kept generating
        // losses, producing an inconsistent display (losses every year,
        // fees only Y1, ROI inflated).
        return {
          year: r.year,
          taxNoBrooklyn: r.baseline ? r.baseline.total : (resYr.taxNoBrooklyn || 0),
          taxWithBrooklyn: r.withStrategy ? r.withStrategy.total : (resYr.taxWithBrooklyn || resYr.taxNoBrooklyn || 0),
          investmentThisYear: isNoAction ? 0 : (resYr.investmentThisYear || 0),
          gainRecognized: isNoAction ? 0 : (r.gainRecognized || 0),
          grossLoss: isNoAction ? 0 : (resYr.grossLoss != null ? resYr.grossLoss : (r.lossApplied || 0)),
          fee: isNoAction ? 0 : (resYr.fee || 0)
        };
      });
    } else if (result && result.years && result.years.length) {
      years = result.years;
    }

    if (!years || !years.length) {
      var emptyHtml = '<div class="muted" style="padding:12px 0;">' +
        'Run the Decision Engine above to populate the multi-year projection.' +
        '</div>';
      if (splitMode) {
        summaryHost.innerHTML = emptyHtml;
        detailsHost.innerHTML = '';
      } else {
        host.innerHTML = emptyHtml;
      }
      return;
    }
    var totals = (result && result.totals) || {};
    // Single source of truth for engagement state (format-helpers).
    var _isEngaged = (typeof window.rettEngineEngaged === 'function')
      ? window.rettEngineEngaged(comp, result)
      : true;
    if (!_isEngaged) {
      totals = { cumulativeFees: 0, cumulativeNetSavings: 0 };
    }
    // No-engagement card replaces the bar chart so the user doesn't
    // see "Without strategy" vs "With strategy" bars that are
    // visually identical (both equal to baseline).
    var noEngagementCard = '<div class="rett-no-engagement-card" role="note" style="' +
      'background:rgba(15, 76, 129, 0.18);border:1px solid rgba(26, 58, 110, 0.6);' +
      'border-radius:6px;padding:18px;margin:18px 0;color:#cfe1ff;text-align:center;">' +
      '<strong>No Brooklyn engagement recommended for these inputs.</strong> ' +
      'The strategy produces no net tax offset here — try a different strategy, leverage, or recognition timing.' +
      '</div>';

    // The scenario comparison panel renders into its own host
    // (#scenario-comparison-host above Brooklyn Configuration) so it
    // sits at the top of the Summary sub-tab. The dashboard below
    // (KPIs/chart/pies) reflects whichever scenario is active —
    // either the auto-pick choice or the row the user clicked.
    var scenarioCfg = (typeof collectInputs === 'function') ? (function () {
      try { return collectInputs(); } catch (e) { return null; }
    })() : null;
    var scenarioHost = document.getElementById('scenario-comparison-host');
    if (scenarioHost) {
      // Render the panel regardless of the dashboard's engagement state.
      // Even when the active scenario produces a no-engagement result
      // (e.g. an invalid Goldman leverage tripped recommendSale's gate),
      // the user needs to see the comparison rows so they can click a
      // different scenario to escape that state.
      scenarioHost.innerHTML = scenarioCfg
        ? _buildScenarioComparison(scenarioCfg) : '';
      _wireScenarioRowClicks(scenarioHost);
    }

    if (splitMode) {
      // Multi-scenario stack: render one dashboard section per CHECKED
      // scenario row. Default-checked is the recommended row, so on
      // first render this looks identical to the prior single-scenario
      // dashboard; checking additional rows stacks more sections below.
      // _renderDashboardsFromChecked also writes the per-scenario
      // tables into #projection-details-host, so the Details sub-tab
      // tracks the same set of checked scenarios as Summary.
      _renderDashboardsFromChecked();
    } else {
      var html = '<div class="rett-dashboard">';
      html += _buildKpiRow(years, totals);
      html += (_isEngaged ? _buildChart(years) + _buildPies(years, comp, result) : noEngagementCard);
      html += _buildTable(years);
      html += '</div>';
      host.innerHTML = html;
    }

    // Refresh the sticky savings ribbon. Skip in splitMode — the
    // section observer already chose the right scenario (or hid the
    // ribbon for the multi-checked case), and an unconditional re-render
    // here would resurrect the ribbon with global numbers and undo that.
    if (!splitMode && typeof root.renderSavingsRibbon === 'function') {
      try { root.renderSavingsRibbon(); } catch (e) { if (typeof window !== "undefined" && typeof window.reportFailure === "function") window.reportFailure("non-fatal in projection-dashboard-render.js", e); else if (typeof console !== "undefined") console.warn(e); }
    }
    // Refresh the plain-English narrative card.
    if (typeof root.renderNarrative === 'function') {
      try { root.renderNarrative(); } catch (e) { if (typeof window !== "undefined" && typeof window.reportFailure === "function") window.reportFailure("non-fatal in projection-dashboard-render.js", e); else if (typeof console !== "undefined") console.warn(e); }
    }
    // Refresh the year-by-year cashflow schedule (Brooklyn investment +
    // structured-sale balance) below the Multi-Year Snapshot.
    if (typeof root.renderCashflowSchedule === 'function') {
      try { root.renderCashflowSchedule(); } catch (e) { if (typeof window !== "undefined" && typeof window.reportFailure === "function") window.reportFailure("non-fatal in projection-dashboard-render.js", e); else if (typeof console !== "undefined") console.warn(e); }
    }
    // Animate any KPI / hero / ribbon numbers that just changed.
    if (typeof root.animateRettNumbers === 'function') {
      try { root.animateRettNumbers(); } catch (e) { if (typeof window !== "undefined" && typeof window.reportFailure === "function") window.reportFailure("non-fatal in projection-dashboard-render.js", e); else if (typeof console !== "undefined") console.warn(e); }
    }
  }

  root.renderProjectionDashboard = renderProjectionDashboard;
  // Exposed so the temp / tax-implication page can render the SAME
  // recommended payment terms as the comparison table (single source).
  root.__rettDescribeInstallmentSchedule = _describeInstallmentSchedule;
  root.__rettScheduleSummaryLine = _scheduleSummaryLine;

  // -------------------------------------------------------------------
  // Page-3 minimal view: filter to scenarios marked Interested on Page 2,
  // show one card per scenario with the net benefit big and a click-to-
  // expand details panel for math verification. The legacy comparison
  // table + dashboards live behind the Next button (#full-projection-region)
  // and stay rendered (so calculations still run + state stays consistent).
  // -------------------------------------------------------------------
  function _scenarioLossSum(cfg) {
    var data = _scenarioFullData(cfg);
    if (!data || !Array.isArray(data.years)) return 0;
    var sum = 0;
    data.years.forEach(function (y) { sum += (y.grossLoss || 0); });
    return sum;
  }

  function _interestedDetailRow(label, value, indent) {
    var pad = indent ? 'style="padding-left:18px;color:var(--ink-soft)"' : '';
    return '<li ' + pad + '><span>' + label + '</span><strong>' + _fmt(value) + '</strong></li>';
  }

  // Format a YYYY-MM-DD string as "Mon DD, YYYY". Falls back to Jan 1 of
  // a known year, then to a literal en-dash.
  function _fmtClosingDate(dateStr, fallbackYear) {
    var months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    if (dateStr && typeof window !== 'undefined' && typeof window.parseLocalDate === 'function') {
      var d = window.parseLocalDate(dateStr);
      if (d && !isNaN(d.getTime())) {
        return months[d.getMonth()] + ' ' + d.getDate() + ', ' + d.getFullYear();
      }
    }
    return fallbackYear ? ('Jan 1, ' + fallbackYear) : '—';
  }

  // Build the cash-flow table the seller cares about: when does the
  // structured-sale buyer actually deliver money? At closing they pay
  // the basis cash up front; gain installments hit in the recognition
  // year(s) the engine resolved (typically Year +recIdx+1 under the
  // 18-month MEP window). Reads the recognitionSchedule directly so
  // multi-year recognition (rec=3, rec=4) renders correctly without
  // re-deriving the calendar math here.
  function _buildPaymentScheduleHtml(cfg, comp, durationMonths) {
    if (!cfg || !comp) return '';
    var year1 = cfg.year1 || (new Date()).getFullYear();
    // Closing-day cash = basis recovery + accelerated-depreciation
    // proceeds. In a structured sale only the LTCG is parked inside
    // the insurance product; the basis cash AND the depr-equivalent
    // cash (representing the buyer's payment that corresponds to
    // recaptured depreciation) both flow to the seller at closing.
    // Recapture is recognized as Y1 ordinary income in the tax engine,
    // but the cash itself is delivered up front — so the seller's
    // closing-day check is basis + accel-depr, not basis alone.
    var basisCash = Math.max(0, Number(cfg.costBasis) || 0);
    var accelDeprCash = Math.max(0, Number(cfg.acceleratedDepreciation) || 0);
    var closingCash = basisCash + accelDeprCash;
    var sched = (comp.recognitionSchedule && comp.recognitionSchedule.length)
      ? comp.recognitionSchedule.slice()
      : [];
    if (!sched.length) return '';

    // Build a year -> {gain, isClosing} map so we can merge the closing
    // basis-cash line into Y1 instead of showing two rows for the same
    // year (cleaner for sellers — one cash deposit, one date).
    var byYear = {};
    sched.forEach(function (r) {
      var y = r.year || year1;
      if (!byYear[y]) byYear[y] = { year: y, gain: 0, isClosing: false };
      byYear[y].gain += (r.gainRecognized || 0);
    });
    if (!byYear[year1]) byYear[year1] = { year: year1, gain: 0, isClosing: false };
    byYear[year1].isClosing = true;

    var years = Object.keys(byYear).map(function (k) { return byYear[k]; })
      .sort(function (a, b) { return a.year - b.year; });

    // Total gain in the structured product = sum of all recognized
    // installments. Used to express each gain row as a % so the advisor
    // can confirm the schedule against MetLife's canonical caps
    // (3-yr: 40/40/20; 4-yr+: 50/30/10/10).
    var totalGainInstallments = years.reduce(function (s, y) { return s + (y.gain || 0); }, 0);

    var rows = '';
    var totalCash = 0;
    years.forEach(function (yr) {
      var cash = (yr.isClosing ? closingCash : 0) + yr.gain;
      // Suppress zero-cash rows so the table only shows years where the
      // seller actually receives money. Zero rows are honest engine
      // output (the recognitionSchedule pads to horizon) but they add
      // noise to a table built specifically to answer "when does cash
      // arrive?".
      if (cash <= 0) return;
      var dateLabel = yr.isClosing ? _fmtClosingDate(cfg.implementationDate, yr.year) : ('Jan 1, ' + yr.year);
      totalCash += cash;
      rows += '<tr>' +
        '<td>' + dateLabel + '</td>' +
        '<td>' + _fmt(cash) + '</td>' +
      '</tr>';
    });
    rows += '<tr class="rett-payments-total">' +
      '<td>Total payments received</td>' +
      '<td>' + _fmt(totalCash) + '</td>' +
    '</tr>';

    return '<div class="rett-interested-payments">' +
      '<h4>Payment Schedule</h4>' +
      '<table class="rett-payments-table">' +
        '<thead><tr><th>Date</th><th>Cash Received</th></tr></thead>' +
        '<tbody>' + rows + '</tbody>' +
      '</table>' +
    '</div>';
  }

  // Strategy B payment schedule (§453 installment sale - advisor
  // 2026-05-26). Different from Strategy C: basis recovery happens
  // PER PAYMENT (proportionally per gross-profit ratio), not all at
  // closing. Each year's cash = (salePrice - accelDepr) / N. Of that:
  //   gain portion = paymentAmount * GP_ratio   (taxed as LT)
  //   basis portion = paymentAmount * (1 - GP_ratio)  (principal recovery)
  // GP_ratio = totalLT / (salePrice - accelDepr) per §453(c).
  function _buildBPaymentScheduleHtml(cfg) {
    if (!cfg) return '';
    var N = (cfg.installmentPayments | 0) || 1;
    if (N < 1) return '';
    var year1 = cfg.year1 || (new Date()).getFullYear();
    var salePrice = Math.max(0, Number(cfg.salePrice) || 0);
    var basis = Math.max(0, Number(cfg.costBasis) || 0);
    var depr = Math.max(0, Number(cfg.acceleratedDepreciation) || 0);
    var contractPriceForLT = Math.max(0, salePrice - depr);
    if (contractPriceForLT <= 0) return '';
    // Use the engine's auto-picked §453 installment weights so the
    // displayed cash matches what the engine actually deploys (and the
    // Tab 7 tranche matrix). Equal split is only a fallback when weights
    // are absent — otherwise the card showed equal payments while the
    // engine deployed a non-equal weighted schedule, so the two views
    // disagreed.
    var weights = (Array.isArray(cfg.installmentScheduleWeights) && cfg.installmentScheduleWeights.length === N)
      ? cfg.installmentScheduleWeights : null;
    function _paymentFor(i) {
      return weights ? contractPriceForLT * (Number(weights[i]) || 0) : contractPriceForLT / N;
    }

    // Build cash entries, then COMBINE any that land on the same date so
    // the schedule shows actual cash received per date. For Strategy B
    // the engine sets close to Jan 1 of year+1, so the §453(i) recapture
    // cash and the first installment both fall on that date — merge them
    // into one payment (e.g. $200K recap + $1.6M installment = $1.8M).
    var entries = [];
    if (depr > 0) {
      var closingYear = year1;
      try {
        if (typeof root.parseLocalDate === 'function' && cfg.implementationDate) {
          var d = root.parseLocalDate(cfg.implementationDate);
          if (d && !isNaN(d.getTime())) closingYear = d.getFullYear();
        }
      } catch (e) { /* fall back to year1 */ }
      entries.push({ date: _fmtClosingDate(cfg.implementationDate, closingYear), cash: depr });
    }
    for (var i = 0; i < N; i++) {
      entries.push({ date: 'Jan 1, ' + (year1 + 1 + i), cash: _paymentFor(i) });
    }
    var merged = [], byDate = {};
    entries.forEach(function (e) {
      if (byDate[e.date] != null) { merged[byDate[e.date]].cash += e.cash; }
      else { byDate[e.date] = merged.length; merged.push({ date: e.date, cash: e.cash }); }
    });
    var rows = '';
    var totalCash = 0;
    merged.forEach(function (e) {
      totalCash += e.cash;
      rows += '<tr><td>' + e.date + '</td><td>' + _fmt(e.cash) + '</td></tr>';
    });
    rows += '<tr class="rett-payments-total">' +
      '<td>Total payments received</td>' +
      '<td>' + _fmt(totalCash) + '</td>' +
    '</tr>';

    return '<div class="rett-interested-payments">' +
      '<h4>Payment Schedule</h4>' +
      '<table class="rett-payments-table">' +
        '<thead><tr><th>Date</th><th>Cash Received</th></tr></thead>' +
        '<tbody>' + rows + '</tbody>' +
      '</table>' +
    '</div>';
  }

  // -------------------------------------------------------------------
  // Sale-only donut chart. The pie's whole-circle quantity is the
  // GAIN FROM THE SALE alone — LT gain + recapture + ST gain. Ordinary
  // income (W-2, rental, dividend) is intentionally OUT of frame; the
  // user is here to see what the strategy does to the SALE TAX, not
  // their overall tax picture.
  //
  // Three variants while the user is choosing presentation framing:
  //   A — 4-slice: kept-doing-nothing | net benefit | fees | tax due
  //       Most granular. Each slice is a real-world dollar.
  //   B — 3-slice: kept-doing-nothing | net benefit | tax+fees combined
  //       Hides the fee/tax split inside one "outflow" slice.
  //   C — 3-slice + callout: kept-doing-nothing | savings (gross)
  //       | tax due. Fees shown separately as an annotation under the
  //       legend so the user sees savings before fees were taken out.
  //
  // ALL three center the same percentage — the actual fraction of the
  // sale the client takes home after the strategy + fees — so the
  // headline stays consistent regardless of variant.
  // Inline SVG, no chart-lib deps, zero external requests.
  // -------------------------------------------------------------------
  function _saleOnlyDonutSvg(cfg, metrics, variant) {
    if (!cfg || !metrics) return '';
    var sale  = Math.max(0, Number(cfg.salePrice) || 0);
    var basis = Math.max(0, Number(cfg.costBasis) || 0);
    var depr  = Math.max(0, Number(cfg.acceleratedDepreciation) || 0);
    // Q2: subtract ST-held property gain (ordinary-taxed, not LT-flavored).
    var _stPropGain = (typeof window.__rettShortTermPropertyGain === 'function')
      ? window.__rettShortTermPropertyGain() : 0;
    var ltGain = Math.max(0, sale - basis - depr - _stPropGain);
    // Total taxable from the sale. Cost basis is NOT income — it's
    // recovery of capital — so we exclude it. STG is independent
    // (Income Sources), not part of the property sale, so it's NOT
    // in the sale-only pie.
    var saleGain = ltGain + depr;
    if (saleGain <= 0) return '';

    // Compute the do-nothing tax IF the sale were the only income.
    // Treats LT gain through the LTCG bracket stack, recapture as
    // ordinary, ST gain as ordinary. This isolates the tax bill the
    // user is actually seeing this strategy address.
    var year   = cfg.year1 || (new Date()).getFullYear();
    var status = cfg.filingStatus || 'mfj';
    var state  = cfg.state || 'NONE';
    var saleTaxDoNothing = 0;
    if (typeof computeFederalTaxBreakdown === 'function') {
      // Sale-only tax: treats the LT gain + recapture as if they were
      // the only income. STG is NOT included — it's an independent
      // income item shown elsewhere, not part of the property sale.
      var fedB = computeFederalTaxBreakdown(depr, year, status, {
        longTermGain: ltGain
      });
      var fedTotal = (Number(fedB.ordinaryTax) || 0) + (Number(fedB.ltTax) || 0)
                   + (Number(fedB.amtTopUp) || 0) + (Number(fedB.niit) || 0)
                   + (Number(fedB.addlMedicare) || 0);
      var stateTax = (typeof computeStateTax === 'function')
        ? (computeStateTax(depr + ltGain, year, state, status, {
            longTermGain: ltGain
          }) || 0)
        : 0;
      saleTaxDoNothing = fedTotal + stateTax;
    }

    // Real-world dollar quantities each slice can describe:
    //   keptOriginal     — saleGain − saleTaxDoNothing (kept doing nothing)
    //   savings          — gross tax savings (capped at saleTaxDoNothing)
    //   fees             — strategy fees
    //   netBenefit       — savings − fees (= extra in pocket vs do-nothing)
    //   taxWithStrategy  — saleTaxDoNothing − savings (tax actually owed)
    var fees = Math.max(0, metrics.fees || 0);
    var savings = Math.max(0, (metrics.doNothing || 0) - (metrics.tax || 0));
    savings = Math.min(savings, saleTaxDoNothing);
    var netBenefit = Math.max(0, savings - fees);
    netBenefit = Math.min(netBenefit, saleTaxDoNothing);
    var taxWithStrategy = Math.max(0, saleTaxDoNothing - savings);
    var keptOriginal = Math.max(0, saleGain - saleTaxDoNothing);

    // Center percentage = actual fraction of sale the client takes
    // home AFTER strategy + fees. Same denominator across all variants
    // so the headline doesn't change between A/B/C framing.
    var keptAfterStrategy = saleGain - taxWithStrategy - fees;
    var pctKept = ((Math.max(0, keptAfterStrategy) / saleGain) * 100).toFixed(1) + '%';

    // Build the slice list per-variant. Each slice is { value, fill,
    // label } where the slice values must SUM TO saleGain so the pie
    // closes the circle.
    var slicesData = [];
    var legendRows = [];
    var feesCallout = '';
    if (variant === 'A') {
      // 4-slice: kept | net benefit | fees | tax due
      slicesData = [
        { value: keptOriginal,    fill: 'rett-donut-kept',    label: 'Original income kept', shortLabel: 'Original income', amt: keptOriginal },
        { value: netBenefit,      fill: 'rett-donut-benefit', label: 'Net benefit',          shortLabel: 'Money gained',    amt: netBenefit },
        { value: fees,            fill: 'rett-donut-fees',    label: 'Fees',                 shortLabel: 'Fees',            amt: fees },
        { value: taxWithStrategy, fill: 'rett-donut-owed',    label: 'Tax due',              shortLabel: 'Taxes',           amt: taxWithStrategy }
      ];
    } else if (variant === 'B') {
      // 3-slice: kept | net benefit | tax+fees combined
      slicesData = [
        { value: keptOriginal,             fill: 'rett-donut-kept',    label: 'Original income kept', shortLabel: 'Original income', amt: keptOriginal },
        { value: netBenefit,               fill: 'rett-donut-benefit', label: 'Net benefit',          shortLabel: 'Money gained',    amt: netBenefit },
        { value: taxWithStrategy + fees,   fill: 'rett-donut-owed',    label: 'Tax + fees',           shortLabel: 'Taxes',           amt: taxWithStrategy + fees }
      ];
    } else {
      // C: 3-slice with savings (gross) green + fees as separate callout
      slicesData = [
        { value: keptOriginal,    fill: 'rett-donut-kept',    label: 'Original income kept', shortLabel: 'Original income', amt: keptOriginal },
        { value: savings,         fill: 'rett-donut-benefit', label: 'Savings (gross)',      shortLabel: 'Money gained',    amt: savings },
        { value: taxWithStrategy, fill: 'rett-donut-owed',    label: 'Tax due',              shortLabel: 'Taxes',           amt: taxWithStrategy }
      ];
      feesCallout = '<div class="rett-donut-fees-callout">Less fees: <strong>&minus;' + _fmt(fees) +
                    '</strong> <span class="muted">(net benefit ' + _fmt(netBenefit) + ')</span></div>';
    }

    // Render slices by sweeping clockwise starting at 12 o'clock.
    var twoPi = Math.PI * 2;
    var cx = 110, cy = 110, r = 88, rInner = 56;
    function _slice(startA, sweepA, fillCss) {
      if (sweepA <= 0.0001) return '';
      var endA = startA + sweepA;
      var x1 = cx + r * Math.cos(startA);
      var y1 = cy + r * Math.sin(startA);
      var x2 = cx + r * Math.cos(endA);
      var y2 = cy + r * Math.sin(endA);
      var x3 = cx + rInner * Math.cos(endA);
      var y3 = cy + rInner * Math.sin(endA);
      var x4 = cx + rInner * Math.cos(startA);
      var y4 = cy + rInner * Math.sin(startA);
      var largeArc = sweepA > Math.PI ? 1 : 0;
      var d = 'M ' + x1.toFixed(2) + ',' + y1.toFixed(2) +
              ' A ' + r + ',' + r + ' 0 ' + largeArc + ',1 ' + x2.toFixed(2) + ',' + y2.toFixed(2) +
              ' L ' + x3.toFixed(2) + ',' + y3.toFixed(2) +
              ' A ' + rInner + ',' + rInner + ' 0 ' + largeArc + ',0 ' + x4.toFixed(2) + ',' + y4.toFixed(2) +
              ' Z';
      return '<path d="' + d + '" class="' + fillCss + '"></path>';
    }
    var startA = -Math.PI / 2;
    var slices = '';
    var callouts = '';
    var cursor = startA;
    slicesData.forEach(function (s) {
      var sweep = (s.value / saleGain) * twoPi;
      slices += _slice(cursor, sweep, s.fill);
      // Callout line + label for slices large enough to warrant one
      // (skip slivers under ~6° to avoid label collisions).
      if (sweep > 0.10 && s.shortLabel) {
        var midA = cursor + sweep / 2;
        var p1x = cx + r * Math.cos(midA);
        var p1y = cy + r * Math.sin(midA);
        var p2x = cx + (r + 18) * Math.cos(midA);
        var p2y = cy + (r + 18) * Math.sin(midA);
        var rightSide = Math.cos(midA) >= 0;
        var p3x = rightSide ? (p2x + 22) : (p2x - 22);
        var p3y = p2y;
        var anchor = rightSide ? 'start' : 'end';
        var tx = rightSide ? (p3x + 4) : (p3x - 4);
        callouts +=
          '<polyline class="rett-donut-leader" points="' +
            p1x.toFixed(2) + ',' + p1y.toFixed(2) + ' ' +
            p2x.toFixed(2) + ',' + p2y.toFixed(2) + ' ' +
            p3x.toFixed(2) + ',' + p3y.toFixed(2) +
          '"></polyline>' +
          '<text class="rett-donut-leader-label" x="' + tx.toFixed(2) +
            '" y="' + (p3y + 4).toFixed(2) + '" text-anchor="' + anchor + '">' +
            s.shortLabel +
          '</text>';
      }
      cursor += sweep;
    });

    // Map slice fill class → swatch class for the legend.
    var swatchMap = {
      'rett-donut-kept':    'sw-kept',
      'rett-donut-benefit': 'sw-benefit',
      'rett-donut-fees':    'sw-fees',
      'rett-donut-owed':    'sw-owed'
    };
    legendRows = slicesData.map(function (s) {
      return '<div class="rett-donut-leg-row">' +
               '<span class="rett-donut-swatch ' + (swatchMap[s.fill] || '') + '"></span>' +
               '<span class="rett-donut-leg-label">' + s.label + '</span>' +
               '<strong>' + _fmt(s.amt) + '</strong>' +
             '</div>';
    }).join('');

    // Per-card spec: the donut sits centered inside Show Details with
    // NO legend rows — the only label kept is the % center text. The
    // user removed the dollar list (Original income kept / Net benefit /
    // Tax + fees) so the chart reads as a single visual rather than a
    // breakdown table. legendRows / feesCallout are still computed above
    // so the function can be reused if a legend variant is needed later.
    void legendRows; void feesCallout;
    // viewBox widened from "-90 -10 400 240" to "-150 -10 520 240"
    // so the right-side "Original income" leader label and left-side
    // "Money gained" leader label both fit inside the SVG canvas
    // (they were truncated at the SVG edge by `overflow: hidden`).
    return '<div class="rett-donut-wrap rett-donut-wrap-centered">' +
      '<svg class="rett-donut" viewBox="-150 -10 520 240" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Sale tax breakdown">' +
        slices +
        callouts +
        '<text x="110" y="120" text-anchor="middle" class="rett-donut-center-pct">' + pctKept + '</text>' +
      '</svg>' +
    '</div>';
  }

  // Build the visualizations object for a card. All three cards show
  // the centered donut inside Show Details; C additionally renders a
  // nested "Show payment schedule" details element underneath the
  // donut so the cash-arrival timing is one extra click away.
  function _buildVisuals(typeLabel, metrics, cfg, comp) {
    return { donut: _saleOnlyDonutSvg(cfg, metrics, 'B') };
  }

  function _interestedCard(typeLabel, num, name, picked, metrics, lossSum, isRecommended, durationMonths, paymentScheduleHtml, visuals, currentCfg) {
    // Lockup line replaces the old "Time horizon · Leverage" auto-pick
    // summary. Strategy choice is now described by how long the seller's
    // proceeds are tied up:
    //   A — None (cash hits at close)
    //   B — months from the proposed sale date to Jan 1 of the next year
    //   C — engine-picked structured-sale duration in months
    // Leverage is intentionally NOT surfaced here — it's discussed in
    // the meeting, not auto-displayed on the card.
    var lockupValue;
    if (typeLabel === 'A') {
      lockupValue = 'None &ndash; Cash up front';
    } else if (typeLabel === 'B') {
      // Strategy B is a §453 installment sale with N=1, 2, or 3 yearly
      // Jan-1 payments. Lockup shows the ACTUAL span from sale date to
      // when the seller receives all payments:
      //   monthsUntilFirstJan1 + (N-1) × 12
      // For a June 15 close + N=1: ~7 mo to Jan 1 next year.
      // For Jan 1 close + N=3: 12 + 24 = 36 mo. Per advisor 2026-05-27.
      var bN = (picked && picked.bestRecC) | 0;
      if (!bN || bN < 1) bN = 1;
      // Use currentCfg (original sale date), not picked.cfg (which is
      // mutated by _scenarioCfgFor to year+1 Jan 1 for Strategy B).
      var monthsToFirst = _bMonthsUntilJan1(currentCfg);
      if (monthsToFirst == null) monthsToFirst = 12;
      var totalMonths = monthsToFirst + (bN - 1) * 12;
      lockupValue = totalMonths + (totalMonths === 1 ? ' month' : ' months');
    } else {
      var pickedDur = (picked && picked.durationMonths) || durationMonths || 36;
      lockupValue = pickedDur + (pickedDur === 1 ? ' month' : ' months');
    }

    // Card visual: only the user's own "chosen" pick gets a ring.
    // The engine-recommended border treatment was intentionally removed
    // — keeping is-recommended class application out of the rendered
    // markup so the visual stays neutral until the user decides.
    var chosen = (typeof window !== 'undefined' && window.__rettChosenStrategy === typeLabel);
    var cls = 'rett-interested-card' + (chosen ? ' is-chosen' : '');
    var chooseBtn =
      '<button type="button" class="rett-use-strategy-btn" data-use-strategy="' + typeLabel + '">' +
        (chosen ? '✓ Selected &mdash; continue to Supplemental' : 'Use This Strategy &rarr;') +
      '</button>';
    // New cash walk-away (advisor 2026-05-28): replaces the donut in
    // Show Details. = "Cash Kept from Sale" (Tab 2 middle tile,
    // salePrice − sale tax) + this strategy's Net Benefit. Shown as a
    // blue figure mirroring the Tax Implications cash-kept tile so the
    // client sees the new total cash they walk away with under the
    // strategy. Read the Tab 2 value straight from the DOM so it's the
    // exact number the client already saw there.
    var _cashKeptEl = (typeof document !== 'undefined') ? document.getElementById('bt-cash-kept') : null;
    var _cashKept = (_cashKeptEl && typeof parseUSD === 'function')
      ? (parseUSD(_cashKeptEl.textContent) || 0) : 0;
    var _netBen = Number(metrics.net) || 0;
    var _newWalkAway = _cashKept + _netBen;
    var walkAwayHtml =
      '<div class="rett-interested-walkaway">' +
        '<div class="rett-walkaway-label">New cash from sale</div>' +
        '<div class="rett-walkaway-value">' + _fmt(_newWalkAway) + '</div>' +
        '<div class="rett-walkaway-sub">Cash kept from sale ' + _fmt(_cashKept) +
          ' + net benefit ' + _fmt(_netBen) + '</div>' +
      '</div>';
    // Payment schedule (B + C - per advisor 2026-05-26 B now has a
    // multi-year payment cadence too) lives BELOW the Use This Strategy
    // button as a small chevron-only toggle, so the button line stays
    // aligned across all three cards. A presenter can click it during
    // the meeting if a payment-cadence question comes up; otherwise
    // it stays out of the way.
    var paymentArrow = ((typeLabel === 'B' || typeLabel === 'C') && paymentScheduleHtml)
      ? '<details class="rett-interested-paysched-arrow">' +
          '<summary aria-label="Show payment schedule"><span class="rett-paysched-arrow-glyph" aria-hidden="true"></span></summary>' +
          paymentScheduleHtml +
        '</details>'
      : '';
    return '<div class="' + cls + '" data-type="' + typeLabel + '">' +
      '<div class="rett-interested-header">' +
        '<span class="rett-interested-num">STRATEGY <span class="rett-interested-num-big">' + num + '</span></span>' +
      '</div>' +
      '<div class="rett-interested-name">' + name + '</div>' +
      '<div class="rett-interested-net-label">Net Benefit</div>' +
      '<div class="rett-interested-net-value">' + _fmt(metrics.net) + '</div>' +
      '<div class="rett-interested-lockup">' +
        '<span class="rett-interested-lockup-label">Payment Period</span>' +
        '<span class="rett-interested-lockup-value">' + lockupValue + '</span>' +
      '</div>' +
      '<details class="rett-interested-details">' +
        '<summary>Show details</summary>' +
        walkAwayHtml +
      '</details>' +
      chooseBtn +
      paymentArrow +
    '</div>';
  }

  // Months from the configured sale (implementation) date to Jan 1 of
  // the next calendar year. Returned as an integer in [1, 12]; null if
  // the date can't be parsed. Mirrors the helper in controls.js so the
  // Page-3 Lockup line and the Page-2 Closing Window value agree.
  function _bMonthsUntilJan1(cfg) {
    if (!cfg) return null;
    // Lockup is driven by when Brooklyn actually opens the position
    // (strategy implementation date), not the sale closing date. Fall
    // back to the closing date for legacy cfgs that lack the strategy
    // field. Mirrors the helper in controls.js.
    var iso = cfg.strategyImplementationDate || cfg.implementationDate;
    if (!iso) return null;
    var d = (typeof window !== 'undefined' && typeof window.parseLocalDate === 'function')
      ? window.parseLocalDate(iso)
      : new Date(iso);
    if (!d || isNaN(d.getTime())) return null;
    // Month-based diff: March 1 → Jan 1 next year = 10 months (not 11
    // as ceil(days/30.4375) would round). Whole-month gap from d's
    // month to month 12, minus a fractional adjustment when d.day > 1.
    var months = 12 - d.getMonth();
    var day = d.getDate();
    if (day > 1) {
      var dim = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
      months -= (day - 1) / dim;
    }
    return Math.max(1, Math.min(12, Math.round(months)));
  }

  // Build the per-scenario summary data shared by Page 3 (Interested
  // cards) and Page 4 (Strategy Summary). Returns null when inputs
  // aren't ready yet. Callers are responsible for filtering by interest
  // and rendering — this function only computes.
  // Strategy C over-harvests Brooklyn short-term loss: even after the
  // optimizer dials deployment back, a residual unused carryforward can
  // remain. The FIRST $3,000 ($1,500 MFS) of that residual is usable next
  // year as a §1211(b) ordinary offset, and is valued separately by
  // _carryoverOffsetCredit. Everything ABOVE that one-year offset is
  // genuinely unusable within the horizon — rather than claim its
  // far-future value (≈30¢/$ is too hand-wavy), we REFUND the AM fee spent
  // generating it, credited back to net. The two credits are complementary
  // and split at the §1211(b) boundary (no double-count): below it we VALUE
  // the offset, above it we REFUND the fee. Floor is the offset amount
  // itself ($3,000 / $1,500), and we subtract it before prorating the fee.
  // C-only by design; B is verified never to leave a material carryforward.
  // Returns the fee credit (a positive dollar amount) or 0. Mirrors the
  // deferred path of _scenarioMetrics (direct unifiedTaxComparison, no
  // immediate-path flavoring) so it operates on the same numbers that
  // produced e.metrics.brooklynFees.
  function _excessLossFeeCredit(e) {
    if (!e || e.type !== 'C' || !e.cfg || !e.metrics) return 0;
    var bf = Math.max(0, Number(e.metrics.brooklynFees) || 0);
    if (bf <= 0) return 0;   // scale=0 / below account floor → no fee to refund
    var dep = (e._partialDeploy && Number.isFinite(Number(e._partialDeploy.deployed)))
      ? Math.max(0, Math.round(Number(e._partialDeploy.deployed)))
      : Math.round(Number(e.cfg.availableCapital) || 0);
    if (dep <= 0) return 0;
    if (typeof window === 'undefined' || typeof window.unifiedTaxComparison !== 'function') return 0;
    var ecfg = Object.assign({}, e.cfg, { availableCapital: dep, investment: dep, investedCapital: dep });
    var comp;
    try { comp = window.unifiedTaxComparison(ecfg); } catch (err) { return 0; }
    if (!comp || !Array.isArray(comp.rows) || !comp.rows.length) return 0;
    var rows = comp.rows;
    var residual = Math.max(0, Number(rows[rows.length - 1].stCarryForward) || 0);
    var status = e.cfg.filingStatus || 'mfj';
    var ordCap = (status === 'mfs' || status === 'married_separate') ? 1500 : 3000;
    var excess = residual - ordCap;   // keep one usable offset year; refund fee on the rest
    if (excess <= 0) return 0;
    var totalLossGen = 0;
    rows.forEach(function (r) { totalLossGen += Math.max(0, Number(r && r.lossGenerated) || 0); });
    if (totalLossGen <= 0) return 0;
    return Math.round(bf * (excess / totalLossGen));
  }

  // Carryover-loss net-benefit credit (A/B/C). When the projection ends
  // with a residual short-term loss carryforward, the FIRST idle year
  // after deployment (when we'd otherwise show a blank temporary page)
  // still gets one §1211(b) $3,000 ordinary offset ($1,500 MFS) for free.
  // We put a real dollar value on that single year: tax on the flat
  // recurring income vs. that income minus the creditable offset
  // (whatever residual remains, capped at the annual limit). Federal-only
  // by design (conservative — no state conformity assumptions). "This can
  // only be for one year" — we do NOT carry it further. Complementary to
  // _excessLossFeeCredit, split at the offset boundary: this VALUES the
  // first $3,000 / $1,500 of residual as a usable offset; the fee credit
  // REFUNDS the AM fee on anything above that. No double-count.
  function _carryoverOffsetCredit(e) {
    if (!e || !e.cfg || !e.metrics) return 0;
    if (typeof window === 'undefined' ||
        typeof window.unifiedTaxComparison !== 'function' ||
        typeof window.computeFederalTax !== 'function') return 0;
    var dep = (e._partialDeploy && Number.isFinite(Number(e._partialDeploy.deployed)))
      ? Math.max(0, Math.round(Number(e._partialDeploy.deployed)))
      : Math.round(Number(e.cfg.availableCapital) || 0);
    if (dep <= 0) return 0;
    var ecfg = Object.assign({}, e.cfg, { availableCapital: dep, investment: dep, investedCapital: dep });
    var comp;
    try { comp = window.unifiedTaxComparison(ecfg); } catch (err) { return 0; }
    if (!comp || !Array.isArray(comp.rows) || !comp.rows.length) return 0;
    var rows = comp.rows;
    var lastRow = rows[rows.length - 1];
    var residual = Math.max(0, Number(lastRow.stCarryForward) || 0);
    if (residual <= 0) return 0;
    var status = e.cfg.filingStatus || 'mfj';
    var ordCap = (status === 'mfs' || status === 'married_separate') ? 1500 : 3000;
    var creditable = Math.min(residual, ordCap);
    if (creditable <= 0) return 0;
    var idleYear = (Number(lastRow.year) || 0) + 1;
    var ord = Math.max(0, Number(e.cfg.baseOrdinaryIncome) || 0);
    var t0 = Number(window.computeFederalTax(ord, idleYear, status)) || 0;
    var t1 = Number(window.computeFederalTax(Math.max(0, ord - creditable), idleYear, status)) || 0;
    return Math.max(0, Math.round(t0 - t1));
  }

  function buildInterestedSummary() {
    if (typeof collectInputs !== 'function') return null;
    var currentCfg;
    try { currentCfg = collectInputs(); } catch (e) { currentCfg = null; }
    if (!currentCfg) return null;
    // Dollar rivalry: every dollar committed to an Interested supplemental
    // (Oil & Gas, Delphi, ...) is unavailable to Brooklyn. Subtract the
    // allocator's supplemental total from availableCapital so the engine
    // computes A/B/C with the correct Brooklyn deployment, and the
    // optimizer's cap math (recommendedInvestment, slider scale) is keyed
    // off the same reduced base. The implementation panel still shows the
    // breakdown for advisor audit.
    if (typeof root.runAllocator === 'function') {
      var rawCap = Math.max(0, Number(currentCfg.availableCapital) || 0);
      var alloc = root.runAllocator(rawCap);
      var brooklynCap = Math.max(0, alloc.brooklynRemaining || 0);
      // Supplementals' Year-0 cash draw. Threaded onto the cfg so the
      // installment engine (tax-comparison.js) reserves their share of the
      // Year-0 pool (down payment + recapture) before sizing Brooklyn's Y0
      // tranche — otherwise Brooklyn claims the whole pool and the supps
      // deploy on top of it, exceeding the cash actually paid in Y0. Flows
      // to every A/B/C entry cfg and into _autoPickSection's down-payment
      // optimization (both spread currentCfg). 0 when no supp is funded.
      var _suppY0Deploy = Math.max(0, Math.round(alloc.allocatedToSupplementals || 0));
      currentCfg = Object.assign({}, currentCfg, { suppY0Deployment: _suppY0Deploy });
      if (brooklynCap !== rawCap) {
        currentCfg = Object.assign({}, currentCfg, {
          availableCapital: brooklynCap,
          investedCapital:  brooklynCap,
          investment:       brooklynCap
        });
      }
    }
    var userDuration = currentCfg.structuredSaleDurationMonths || 36;

    function _bestPickedCfgLocal(type) {
      var picked = _autoPickSection(type, currentCfg);
      var sectionCfg = Object.assign({}, currentCfg, {
        horizonYears: picked.horizon,
        leverage:     picked.shortPct / 100,
        leverageCap:  picked.shortPct / 100,
        comboId:      picked.comboId
      });
      // For C, use the duration the auto-pick chose (engine may extend
      // past the 18-month minimum if a longer term yields a higher net).
      // A and B don't use the field downstream but we still pass the
      // fallback so _scenarioCfgFor doesn't see undefined.
      var dur = (type === 'C' && picked.durationMonths)
        ? picked.durationMonths
        : userDuration;
      var pr = (type === 'C' && Number.isFinite(picked.parkRatio)) ? picked.parkRatio : null;
      var iw = (type === 'B' && Array.isArray(picked.installmentWeights)) ? picked.installmentWeights : null;
      // Y0 down-payment applies to BOTH B and C (advisor 2026-05-27).
      var y0d = ((type === 'B' || type === 'C') && Number.isFinite(picked.y0DownPayment)) ? picked.y0DownPayment : null;
      return {
        cfg: _scenarioCfgFor(type, sectionCfg, picked.bestRecC, dur, pr, iw, y0d),
        picked: picked
      };
    }

    var saleMonth0 = -1;
    if (currentCfg.implementationDate &&
        typeof window !== 'undefined' &&
        typeof window.parseLocalDate === 'function') {
      var d = window.parseLocalDate(currentCfg.implementationDate);
      if (d && !isNaN(d.getTime())) saleMonth0 = d.getMonth();
    }

    // Optimization (2026-05-06): skip per-strategy auto-pick + scenario
    // metrics for strategies the user has explicitly marked Not Interested.
    // _autoPickSection sweeps ~50-200 (leverage, horizon, duration,
    // recognition) combos per strategy — a meaningful chunk of total
    // pipeline time. When interest[X] === false, X cannot be the chosen
    // strategy AND won't render on Page 3, so its metrics are never
    // consumed. Skipping yields a measurable speedup for the common
    // single-strategy flow (e.g., user marks A Interested, B+C Not
    // Interested → only Strategy A sweeps).
    //
    // Conservative: skip only when interest === false (strict opt-out).
    // For unmarked (null/undefined), keep computing — those entries
    // appear on Page 3 as comparison cards.
    var _interestEarly = (typeof window !== 'undefined' && window.__rettStrategyInterest) || {};
    var _skipA = _interestEarly.A === false;
    var _skipB = _interestEarly.B === false;
    var _skipC = _interestEarly.C === false;

    var pickedA = _skipA ? null : _bestPickedCfgLocal('A');
    var mA = (!_skipA && pickedA) ? _scenarioMetrics(pickedA.cfg) : null;
    var lossA = mA ? _scenarioLossSum(pickedA.cfg) : 0;
    var visualsA = mA ? _buildVisuals('A', mA, pickedA.cfg, null) : null;

    // Compute B (Seller Finance / Delay-Close-to-Jan-1) for ALL sale
    // dates. Previously B was suppressed when the sale closed before
    // September on the theory that delaying a close by 6+ months is
    // usually impractical — but suppressing the card meant clicking
    // "Interested" on B did nothing for those scenarios, which the user
    // saw as a bug. Now we always compute and render B; the math will
    // show whether it helps or hurts, and the user can decide.
    var pickedB = _skipB ? null : _bestPickedCfgLocal('B');
    var mB = (!_skipB && pickedB) ? _scenarioMetrics(pickedB.cfg) : null;
    var lossB = mB ? _scenarioLossSum(pickedB.cfg) : 0;
    var visualsB = mB ? _buildVisuals('B', mB, pickedB.cfg, null) : null;
    var paymentsB = (mB && pickedB) ? _buildBPaymentScheduleHtml(pickedB.cfg) : '';

    var pickedC = _skipC ? null : _bestPickedCfgLocal('C');
    var mC = (!_skipC && pickedC) ? _scenarioMetrics(pickedC.cfg) : null;
    var lossC = mC ? _scenarioLossSum(pickedC.cfg) : 0;
    var paymentsC = '';
    var visualsC = null;
    var durationC = (pickedC && pickedC.picked && pickedC.picked.durationMonths) || userDuration;
    if (mC) {
      var dataC = _scenarioFullData(pickedC.cfg);
      if (dataC && dataC.comp) {
        paymentsC = _buildPaymentScheduleHtml(pickedC.cfg, dataC.comp, durationC);
        visualsC = _buildVisuals('C', mC, pickedC.cfg, dataC.comp);
      }
    }

    var entries = [];
    if (mA) entries.push({ type: 'A', num: '01', name: 'Traditional Sale',             picked: pickedA.picked, metrics: mA, loss: lossA, payments: '',        cfg: pickedA.cfg, visuals: visualsA });
    if (mB) entries.push({ type: 'B', num: '02', name: 'Installment Sale',             picked: pickedB.picked, metrics: mB, loss: lossB, payments: paymentsB, cfg: pickedB.cfg, visuals: visualsB });
    if (mC) entries.push({ type: 'C', num: '03', name: 'Structured Installment Sale',  picked: pickedC.picked, metrics: mC, loss: lossC, payments: paymentsC, cfg: pickedC.cfg, visuals: visualsC });

    if (!entries.length) return null;

    // Apply Brooklyn optimizer to each entry so Page 3 cards AND the
    // Page 5 hero numbers reflect the optimized investment. Without
    // this, the projection cards show "fully invested in Brooklyn"
    // math which over-states fees (and understates net) when the
    // optimizer recommends dialing back. Mutates metrics in place
    // so all consumers (Page 3 cards, Page 5 strategy summary,
    // Implementation panel) see the same numbers. The full-investment
    // values are preserved on metrics._brooklynFeesAtFull and
    // metrics._lossAtFull for the reference-line UI on the cards.
    if (typeof root.runBrooklynOptimizer === 'function') {
      var availCap = (currentCfg && Number(currentCfg.availableCapital)) || 0;
      var override = root.__rettBrooklynInvestmentOverride;
      var hasOverride = (typeof override === 'number' && override >= 0);
      entries.forEach(function (e) {
        // Pass the entry's pre-scaling net (computed by _scenarioMetrics
        // at the auto-picked combo) so the optimizer's positive-net gate
        // measures the same value the display will show. Without this,
        // the gate would probe at the GLOBAL cfg's combo, which can
        // differ from the strategy's per-section auto-pick (e.g. Strategy
        // A often picks horizon=1 to minimize Brookhaven, while cfg
        // defaults to horizon=5) — false positives possible.
        var entryNetAtFull = (e.metrics && Number.isFinite(e.metrics.net))
          ? e.metrics.net : null;
        var opt = root.runBrooklynOptimizer(currentCfg, e.loss || 0, entryNetAtFull);
        // Scale resolution: user's slider override > optimizer cap > full.
        // Override is clamped to [0, 1] of available capital — past 100%
        // doesn't make engineering sense (can't invest more than you have).
        var scale;
        if (hasOverride && availCap > 0) {
          scale = Math.max(0, Math.min(1, override / availCap));
        } else {
          // Engine-measured net-max deployment: dial back whenever extra
          // capital would only add fees without extra savings (e.g. the
          // structured sale's late-year carryforward overshoot). Cheap-
          // exits to full when there's no wasted loss, so no-waste
          // strategies (lump-sum A) are unaffected. Supersedes the old
          // absorbable-ratio recommendedScale.
          scale = _netMaxDeployFraction(e.cfg);
        }
        e._opt = opt;
        e._optScale = scale;
        // Always preserve the full-investment baseline so the slider /
        // reference-line UI can render "loss at full / loss at this
        // dial-back" without re-running the engine.
        e.metrics._brooklynFeesAtFull = (e.metrics.brooklynFees || 0);
        e.metrics._lossAtFull         = e.loss || 0;
        // Always persist `savings` on metrics so downstream renderers
        // (Page-5 hero) read a single source of truth that reflects the
        // active scale. At full investment this equals doNothing − tax;
        // at a dial-back below absorbable, savings drop proportionally
        // with the unabsorbed gain.
        var fullSavings = Math.max(0, (e.metrics.doNothing || 0) - (e.metrics.tax || 0));
        e.metrics._savingsAtFull = fullSavings;
        if (scale === 0) {
          // Optimizer recommends NO deployment — Brooklyn's marginal net
          // would be negative (positive-net gate in master-solver.js), or
          // an explicit slider override forced 0. No engagement ⇒ no
          // Brooklyn AM fees AND no Brookhaven fees: the planning fee
          // ties to the engagement, not to bare interest. Display reads
          // a clean "$0 net, capital free" instead of a fee-only loss.
          e.metrics.brooklynFees   = 0;
          e.metrics.brookhavenFees = 0;
          e.metrics.fees           = 0;
          e.metrics.savings        = 0;
          e.metrics.net            = 0;
          e._partialDeploy = { available: Math.round(Number(e.cfg.availableCapital) || availCap), deployed: 0, scale: 0 };
        } else if (scale < 1) {
          // Engine-accurate metrics at the dialed-back deployment: re-run
          // the scenario at the reduced capital rather than the old
          // proportional approximation (which mis-stated savings when the
          // binding constraint was loss TIMING, not magnitude — the
          // structured-sale carryforward case). The slider-override path
          // also lands here and now shows the true engine numbers.
          var _entryCap = Number(e.cfg.availableCapital) || availCap;
          var _redCap   = Math.round(_entryCap * scale);
          var _redCfg   = Object.assign({}, e.cfg, { availableCapital: _redCap, investment: _redCap, investedCapital: _redCap });
          var _fullNet  = e.metrics.net;   // full-deployment net (from the auto-pick)
          var m2 = _scenarioMetrics(_redCfg);
          // Apply the dial-back when it's an explicit user slider override,
          // OR when it genuinely improves the displayed net — a safety guard
          // so the optimizer's dial-back can never make net WORSE than full
          // (e.g. if a fee-model edge case ever disagreed with the sweep).
          if (m2 && (hasOverride || m2.net > _fullNet)) {
            e.metrics.tax            = m2.tax;
            e.metrics.brooklynFees   = m2.brooklynFees;
            e.metrics.brookhavenFees = m2.brookhavenFees;
            e.metrics.fees           = m2.fees;
            e.metrics.savings        = Math.max(0, (m2.doNothing || 0) - (m2.tax || 0));
            e.metrics.net            = m2.net;
            e._partialDeploy = { available: Math.round(_entryCap), deployed: _redCap, scale: scale };
          } else {
            // Dial-back wouldn't help (or the re-run failed) → keep full.
            e.metrics.savings = fullSavings;
            e._partialDeploy = { available: Math.round(_entryCap), deployed: Math.round(_entryCap), scale: 1 };
          }
        } else {
          // Scale = 1 (full or override at full): keep the engine's
          // computed values but make `savings` explicit on metrics.
          e.metrics.savings = fullSavings;
          var _capFull = Math.round(Number(e.cfg.availableCapital) || availCap);
          e._partialDeploy = { available: _capFull, deployed: _capFull, scale: 1 };
        }
      });
    }

    // Post-optimizer floors (2026-05-28 sweep). Run unconditionally so they
    // apply even when runBrooklynOptimizer is absent:
    //   #3 Account-opening floor — capital below the smallest combo minimum
    //      can't open a Schwab account, so no strategy is executable → $0.
    //   #1 Positive-net floor — if the best a strategy can do still loses
    //      money, don't engage (show $0). Catches Strategy A, whose lump-sum
    //      path has no dial-back sweep to floor it (B/C floor via scale=0).
    entries.forEach(function (e) {
      var entAvail = Number(e.cfg && e.cfg.availableCapital) || ((currentCfg && Number(currentCfg.availableCapital)) || 0);
      var minMin = _smallestComboMinFor(e.cfg);
      var belowAccountFloor = (minMin > 0 && entAvail < minMin - 1);
      if (belowAccountFloor || (e.metrics && e.metrics.net < 0)) {
        e.metrics.brooklynFees   = 0;
        e.metrics.brookhavenFees = 0;
        e.metrics.fees           = 0;
        e.metrics.savings        = 0;
        e.metrics.net            = 0;
        e._partialDeploy = { available: Math.round(entAvail), deployed: 0, scale: 0 };
        e._belowAccountFloor = belowAccountFloor;   // breadcrumb for admin/UI
      }
    });

    // Excess-carryover-loss fee credit (Strategy C). Refund the AM fee
    // spent generating residual unused short-term loss ABOVE the one-year
    // §1211(b) offset ($3,000 / $1,500 MFS) by
    // reducing the displayed fees and adding the same amount back to net.
    // Single source of truth: _excessLossFeeCredit runs the engine at the
    // entry's deployed capital. Applied AFTER the optimizer/floors (so it
    // operates on final deployment) and BEFORE ranking (so the honest,
    // credited net drives the recommendation). The raw excess loss + this
    // credit are surfaced on Tab 7 via metrics._excessLossFeeCredit.
    entries.forEach(function (e) {
      var credit = _excessLossFeeCredit(e);
      e.metrics._excessLossFeeCredit = credit || 0;
      if (credit > 0) {
        e.metrics.brooklynFees = Math.max(0, (e.metrics.brooklynFees || 0) - credit);
        e.metrics.fees         = Math.max(0, (e.metrics.fees || 0) - credit);
        e.metrics.net          = (e.metrics.net || 0) + credit;
      }
    });

    // Carryover-loss net-benefit credit (A/B/C). Value the one free
    // §1211(b) $3,000 ($1,500 MFS) ordinary offset the residual
    // carryforward buys in the first idle year after deployment.
    // Federal-only; complementary to the fee credit above (it values the
    // first $3k/$1.5k, the fee credit refunds the AM fee on the rest).
    // Applied AFTER optimizer/floors and BEFORE ranking so the optimizer
    // naturally favors configs that leave ~$3k of residual to harvest.
    entries.forEach(function (e) {
      if (!e.metrics || !Number.isFinite(e.metrics.net) || e.metrics.net === 0) {
        if (e.metrics) e.metrics._carryoverOffsetCredit = 0;
        return;
      }
      var credit = _carryoverOffsetCredit(e);
      e.metrics._carryoverOffsetCredit = credit || 0;
      if (credit > 0) e.metrics.net = (e.metrics.net || 0) + credit;
    });

    // ---- Additional Funds: phantom-free net (Stage 2, advisor 2026-05-28)
    // When the advisor folded additional funds in (toggle ON →
    // collectInputs set additionalFundsApplied + the one-time Y0 gains),
    // each strategy's displayed savings includes Brooklyn OFFSETTING that
    // self-created liquidation gain. That's circular ("phantom") — the
    // client only owes that tax because they chose to liquidate. Net
    // benefit must be measured OFF THE SALE only, so we subtract the
    // one-time liquidation tax from each deployed entry's net.
    //
    //   triggeredTax = doNothingTax(with funds) − doNothingTax(without)
    //
    // computed here via two unifiedTaxComparison baselines (NO recursion
    // into buildInterestedSummary). Skipped while additional-funds.js is
    // probing (root.__rettAFProbing) — the probe wants the raw net and
    // subtracts triggeredTax itself, so stripping here too would
    // double-count. Result: displayed-net(funds ON) − displayed-net(OFF)
    // == the phantom-free netBenefit. Entries that didn't deploy
    // (net === 0) never realized the liquidation, so they're left alone.
    var _afApplied = Math.max(0, Number(currentCfg && currentCfg.additionalFundsApplied) || 0);
    if (_afApplied > 0 && !root.__rettAFProbing &&
        typeof window !== 'undefined' && typeof window.unifiedTaxComparison === 'function') {
      var _afTriggeredTax = 0;
      try {
        var _cmpWith = window.unifiedTaxComparison(currentCfg);
        var _cfgNoFunds = Object.assign({}, currentCfg, {
          additionalY0LongGain:  0,
          additionalY0ShortGain: 0,
          additionalFundsApplied: 0,
          availableCapital: Math.max(0, (Number(currentCfg.availableCapital) || 0) - _afApplied),
          investment:       Math.max(0, (Number(currentCfg.investment) || 0) - _afApplied),
          investedCapital:  Math.max(0, (Number(currentCfg.investedCapital) || 0) - _afApplied)
        });
        var _cmpNo = window.unifiedTaxComparison(_cfgNoFunds);
        _afTriggeredTax = Math.max(0,
          (Number(_cmpWith && _cmpWith.totalBaseline) || 0) -
          (Number(_cmpNo && _cmpNo.totalBaseline) || 0));
      } catch (e) { _afTriggeredTax = 0; }
      if (_afTriggeredTax > 0) {
        entries.forEach(function (e) {
          if (!e.metrics || !Number.isFinite(e.metrics.net) || e.metrics.net === 0) return;
          e.metrics._additionalFundsTriggeredTax = _afTriggeredTax;
          e.metrics.net = e.metrics.net - _afTriggeredTax;
        });
      }
    }

    // ---- Additional Funds: PER-STRATEGY amount sweep (advisor 2026-06-02) ---
    // Toggling "Include Additional Funds" on means CONSIDER the funds for each
    // strategy — it must never make a card worse, and it shouldn't force every
    // card to use the SAME amount. The phantom-strip above subtracts the
    // one-time liquidation tax from every deployed card, so a strategy that
    // can't put the extra capital to good use would otherwise drop below its
    // no-funds net. Instead, let each strategy independently pick the
    // liquidation amount that maximizes ITS OWN phantom-free net.
    //
    // Candidates = { 0 (decline), reachable Schwab tier gaps, the entered
    // amount }. We deliberately do NOT sweep arbitrary fractions — per
    // additional-funds.js, deploying past "cover the sale" only washes the
    // self-created liquidation gains (phantom). Tier bumps ($1M → 145/45,
    // $3M → 200/100) are the clean lever, so those gaps + the advisor's entered
    // amount + 0 are the only candidates worth probing.
    //
    // Each candidate is scored by re-running buildInterestedSummary at that
    // amount via the __rettAdditionalFundsOverride hook (collectInputs folds
    // the override instead of the DOM value). __rettAFSweeping guards against
    // recursion (the sub-runs skip this block). Because 0 is always a
    // candidate, no card can land below its no-funds net — improve-or-flat,
    // never a drop. Skipped during additional-funds.js probes (__rettAFProbing).
    if (_afApplied > 0 && !root.__rettAFProbing &&
        typeof window !== 'undefined' && !window.__rettAFSweeping) {
      // Account value + the base (no-funds) Brooklyn capital, used to compute
      // which tier gaps are reachable by liquidating part of the account.
      var _avEl = (typeof document !== 'undefined') ? document.getElementById('additional-account-value') : null;
      var _avSweep = _avEl ? ((typeof root.parseUSD === 'function')
                        ? (root.parseUSD(_avEl.value) || 0)
                        : (parseFloat(String(_avEl.value).replace(/[^0-9.\-]/g, '')) || 0)) : 0;
      var _baseCapNoFunds = Math.max(0, (Number(currentCfg.availableCapital) || 0) - _afApplied);

      // Build the candidate amount set: 0 (decline), the entered amount,
      // reachable Schwab tier gaps, and fractional account amounts (so a
      // capital-constrained strategy can pick the slice that offsets the most
      // REAL gain even when no tier unlock is involved — matches the broadened
      // suggestion logic in additional-funds.js).
      var _cands = [0, _afApplied];
      try {
        var _tierKey = (currentCfg && currentCfg.tierKey) || 'beta1';
        if (typeof root.listSchwabCombosForStrategy === 'function') {
          (root.listSchwabCombosForStrategy(_tierKey) || []).forEach(function (c) {
            var min = Number(c && c.minInvestment) || 0;
            var gap = Math.round(min - _baseCapNoFunds);
            if (gap > 0 && gap <= _avSweep) _cands.push(gap);
          });
        }
      } catch (e) { /* tier gaps optional — entered + 0 always present */ }
      [0.25, 0.5, 0.75, 1].forEach(function (f) {
        var amt = Math.round(_avSweep * f);
        if (amt > 0 && amt <= _avSweep) _cands.push(amt);
      });

      // Score per candidate, per strategy: { amount -> { type -> {net, trig} } }.
      // The entered amount is already computed (it's what `entries` holds now).
      // _entByCand parallels _byCand but holds the candidate's full ENTRY
      // (cfg + _partialDeploy) so a strategy that adopts a different amount
      // can also pick up that amount's CONFIG — see the adoption loop below.
      var _byCand = {};
      var _entByCand = {};
      _byCand[_afApplied] = {};
      _entByCand[_afApplied] = {};
      entries.forEach(function (e) {
        if (e.metrics && Number.isFinite(e.metrics.net)) {
          _byCand[_afApplied][e.type] = {
            net:  e.metrics.net,
            trig: Number(e.metrics._additionalFundsTriggeredTax) || 0
          };
          _entByCand[_afApplied][e.type] = e;
        }
      });

      window.__rettAFSweeping = true;
      var _prevOverride = window.__rettAdditionalFundsOverride;
      _cands.forEach(function (c) {
        if (_byCand.hasOwnProperty(c)) return;           // dedup (incl. entered)
        window.__rettAdditionalFundsOverride = c;
        try {
          var r = buildInterestedSummary();
          var m = {};
          var em = {};
          if (r && Array.isArray(r.entries)) {
            r.entries.forEach(function (e) {
              if (e.metrics && Number.isFinite(e.metrics.net)) {
                m[e.type] = { net: e.metrics.net, trig: Number(e.metrics._additionalFundsTriggeredTax) || 0 };
                em[e.type] = e;
              }
            });
          }
          _byCand[c] = m;
          _entByCand[c] = em;
        } catch (e) { /* keep entered-amount numbers if a candidate run fails */ }
      });
      window.__rettAdditionalFundsOverride = _prevOverride;
      window.__rettAFSweeping = false;

      // Each strategy adopts its best candidate (ties prefer the smaller
      // amount — the efficient minimum, matching the suggestion logic).
      entries.forEach(function (e) {
        var enteredNet = (e.metrics.net || 0);            // funds-on at entered amount
        var bestAmt = _afApplied, bestNet = enteredNet, bestTrig = Number(e.metrics._additionalFundsTriggeredTax) || 0;
        Object.keys(_byCand).forEach(function (k) {
          var amt = Number(k);
          var rec = _byCand[k] && _byCand[k][e.type];
          if (!rec || !Number.isFinite(rec.net)) return;
          if (rec.net > bestNet + 0.5 || (Math.abs(rec.net - bestNet) <= 0.5 && amt < bestAmt)) {
            bestNet = rec.net; bestAmt = amt; bestTrig = rec.trig;
          }
        });
        e.metrics._netBeforeFloor            = enteredNet;     // what it'd be at the entered amount
        e.metrics.net                        = bestNet;
        e.metrics._additionalFundsUsed       = bestAmt;
        e.metrics._additionalFundsTriggeredTax = bestTrig;
        e.metrics._additionalFundsFloored    = (bestAmt !== _afApplied);  // chose a different amount
        // Adopt the chosen amount's CONFIG, not just its net. Every
        // downstream reader of e.cfg — chiefly the temp / tax-implication
        // page, which re-runs unifiedTaxComparison(entry.cfg) — must see the
        // additional-funds amount this strategy ACTUALLY chose. Without this,
        // a strategy that declined (bestAmt 0) or under-used the funds still
        // carried the ENTERED-amount fold (full availableCapital +
        // additionalY0LongGain), so the tax page showed a phantom Year-0
        // liquidation gain (e.g. the full $500K) the strategy never realized.
        // The candidate sub-run's entry is internally consistent (cfg folded
        // at bestAmt + matching _partialDeploy), so swap both together.
        if (bestAmt !== _afApplied) {
          var _be = _entByCand[bestAmt] && _entByCand[bestAmt][e.type];
          if (_be && _be.cfg) {
            e.cfg = _be.cfg;
            e._partialDeploy = _be._partialDeploy;
          }
        }
      });
    }

    var maxNet = -Infinity, recIdx = -1;
    entries.forEach(function (e, i) {
      if (e.metrics.net > maxNet) { maxNet = e.metrics.net; recIdx = i; }
    });
    return {
      currentCfg: currentCfg,
      userDuration: userDuration,
      entries: entries,
      recIdx: recIdx
    };
  }
  root.buildInterestedSummary = buildInterestedSummary;
  // Expose so runFullPipeline can patch cfg with the chosen strategy's
  // auto-picked combo BEFORE running ProjectionEngine. Without this,
  // the pipeline's optimizer runs at cfg's nominal (leverage, horizon,
  // rec) which can be a strictly worse combo than the auto-pick — when
  // the nominal combo's net is negative but the auto-picked combo's
  // net is positive, the pipeline dials Brooklyn to $0 while Page-5
  // continues to render the auto-picked combo's positive net (F20).
  root._autoPickSection      = _autoPickSection;
  root._scenarioCfgFor       = _scenarioCfgFor;
  // Debug/verification hooks (2026-06-01): expose the engine's own
  // per-scenario scorer and the net-max deployment sweep so an external
  // brute-force can score arbitrary lever combos (strategy / combo /
  // horizon / recognition / down-payment / deployment fraction) using the
  // EXACT same math the optimizer uses — confirming the auto-pick lands on
  // the global net optimum. Read-only computational helpers.
  root._scenarioMetrics      = _scenarioMetrics;
  root._netMaxDeployFraction = _netMaxDeployFraction;
  root.buildInterestedSummary = buildInterestedSummary;
  // Tier-migration display helpers (2026-05-28). Exposed so the admin
  // panels show the EFFECTIVE operating tier instead of the auto-pick
  // ceiling combo (which can over-state the tier when deployment never
  // reaches the higher combo's minimum — sweep finding #2).
  //   _rettComboTierLabel(ceilingComboId, years) → "145/45 → 200/100 (Year 2)"
  //   _rettEffectiveComboId(ceilingComboId, cumulative) → the combo id a
  //     given cumulative deployment actually qualifies for (≤ ceiling).
  root._rettComboTierLabel   = _comboMigrationLabel;
  root._rettEffectiveComboId = _effectiveComboId;

  // Public helper for the Strategy-Selection page (controls.js
  // _refreshCard3Visibility). Returns the same NET BENEFIT that
  // projection-dashboard renders for a given strategy type.
  //
  // Routes through buildInterestedSummary so the result reflects the
  // FULL pipeline — _autoPickSection (leverage/horizon/recognition) +
  // _scenarioMetrics + runBrooklynOptimizer's dial-back. Previous
  // implementation called only _scenarioMetrics, which omitted the
  // optimizer pass and could drift ~$15K from the displayed value.
  // Same rankings either way, so the ±5% visibility band was stable,
  // but absolute parity is cleaner and lets us reuse the band check
  // against the actual user-facing number.
  //
  // Returns null if compute fails (engine unavailable, malformed cfg,
  // etc.) or if the type isn't an A/B/C primary strategy.
  root._computeBestNetForStrategy = function (type) {
    if (type !== 'A' && type !== 'B' && type !== 'C') return null;
    if (typeof buildInterestedSummary !== 'function') return null;
    try {
      var summary = buildInterestedSummary();
      if (!summary || !summary.entries) return null;
      var entry = summary.entries.find(function (e) { return e.type === type; });
      if (!entry || !entry.metrics) return null;
      var net = Number(entry.metrics.net);
      return Number.isFinite(net) ? net : null;
    } catch (e) {
      return null;
    }
  };

  function renderInterestedSnapshot() {
    var host = document.getElementById('interested-cards-host');
    if (!host) return;
    var summary = buildInterestedSummary();
    if (!summary) {
      host.innerHTML = '<div class="muted" style="padding:18px 0;">Fill in the client inputs on Page 1 to see projections.</div>';
      return;
    }
    var entries = summary.entries;
    var recIdx = summary.recIdx;
    var userDuration = summary.userDuration;

    // Filter logic per P1-1:
    //   - Always include strategies the user marked Interested.
    //   - Always include the engine-Recommended strategy UNLESS the user
    //     explicitly clicked Not Interested on it. The recommendation is
    //     a real signal — silently dropping it because the user didn't
    //     click anything yet meant a fresh user landing on Projection
    //     could see "Sell Now" alone (auto-defaulted) instead of the
    //     option the engine actually wants them to consider.
    //   - If the resulting set is empty, show an explicit empty-state
    //     CTA back to Page 2 (P1-2) instead of a blank page.
    var interest = (typeof window !== 'undefined' && window.__rettStrategyInterest) || {};

    // Filter semantics per advisor 2026-05-27 RE-SPEC:
    //   - At least one Interested → show only those.
    //   - Some Not Interested but none Interested → show the leftovers
    //     (the user implicitly ruled out the others).
    //   - Nothing clicked at all → empty state. The advisor wants
    //     Projections to be a "you must commit" step, not a passive
    //     dump of all three strategies. Forces deliberate selection
    //     on Page 3 before the multi-year detail.
    var anyInterested = ['A', 'B', 'C'].some(function (t) {
      return interest[t] === true;
    });
    var anyNotInterested = ['A', 'B', 'C'].some(function (t) {
      return interest[t] === false;
    });
    var nothingClicked = !anyInterested && !anyNotInterested;
    var filtered = anyInterested
      ? entries.filter(function (e) { return interest[e.type] === true; })
      : entries.filter(function (e) { return interest[e.type] !== false; });

    // The legacy "Mark Interested / Not Interested on the Strategies
    // page to filter this view ..." hint was removed — the cards
    // speak for themselves and the hint added visual noise above the
    // grid during presentations.
    var hint = '';

    if (nothingClicked || !filtered.length) {
      // Empty state — either user landed on Projections without
      // making a selection, or every strategy was clicked Not
      // Interested. Either way, surface a polite CTA back to Page 3.
      var msg = nothingClicked
        ? 'Please select a strategy on the previous page before continuing.'
        : 'No strategies are selected. Mark at least one as <strong>Interested</strong>, or unmark the ones you ruled out.';
      host.innerHTML =
        '<div class="rett-interested-hint" style="padding:24px;text-align:center;">' +
        '<p style="margin:0 0 12px 0;">' + msg + '</p>' +
        '<button type="button" class="cta-btn" onclick="document.getElementById(\'nav-strategies\').click()">&larr; Return to Strategies</button>' +
        '</div>';
      return;
    }

    var grid = '<div class="rett-interested-grid count-' + filtered.length + '">';
    filtered.forEach(function (e, i) {
      var isRec = (entries.indexOf(e) === recIdx);
      grid += _interestedCard(e.type, e.num, e.name, e.picked, e.metrics, e.loss, isRec, userDuration, e.payments, e.visuals, summary.currentCfg);
    });
    grid += '</div>';

    host.innerHTML = hint + grid;
  }

  root.renderInterestedSnapshot = renderInterestedSnapshot;
})(window);
