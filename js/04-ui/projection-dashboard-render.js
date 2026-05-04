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

  function _buildKpiRow(years, totals) {
    var totalSave = 0, cumFees = 0, totalNo = 0, totalWith = 0;
    years.forEach(function (y) {
      var no = y.taxNoBrooklyn || 0;
      var w = (y.taxWithBrooklyn != null) ? y.taxWithBrooklyn : no;
      totalSave += (no - w);
      cumFees += (y.fee || 0);
      totalNo += no;
      totalWith += w;
    });
    var comp = window.__lastComparison;
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
      ? window.rettEngineEngaged(comp, window.__lastResult)
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
    var salePrice = cfg.salePrice || parseUSD((document.getElementById('sale-price') || {}).value) || 0;
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
      if (typeof computeDeferredTaxComparison !== 'function') return null;
      var def = computeDeferredTaxComparison(cfg);
      if (!def || !def.rows) return null;
      def.rows.forEach(function (r) {
        tax += (r.withStrategy ? r.withStrategy.total : 0);
        doNothing += (r.doNothingBaseline ? r.doNothingBaseline.total
                       : (r.baseline ? r.baseline.total : 0));
      });
      brooklynFees = def.totalFees || 0;
      brookhavenTotal = def.totalBrookhavenFees || 0;
    } else {
      if (typeof ProjectionEngine === 'undefined' || !ProjectionEngine.run) return null;
      var proj;
      try { proj = ProjectionEngine.run(cfg); } catch (e) { return null; }
      if (!proj || !Array.isArray(proj.years)) return null;
      proj.years.forEach(function (y) {
        var no = y.taxNoBrooklyn || 0;
        var w = (y.taxWithBrooklyn != null) ? y.taxWithBrooklyn : no;
        tax += w;
        doNothing += no;
        brooklynFees += (y.fee || 0);
      });
      if (proj.totals && proj.totals.cumulativeFees != null) {
        brooklynFees = proj.totals.cumulativeFees;
      }
      // Immediate path: pull Brookhaven from the schedule directly since
      // ProjectionEngine doesn't accumulate it on the year rows.
      if (typeof brookhavenFeeSchedule === 'function') {
        var yfImpl = (typeof yearFractionRemaining === 'function' && cfg.implementationDate)
          ? yearFractionRemaining(cfg.implementationDate) : 1;
        var bhSched = brookhavenFeeSchedule(horizon, yfImpl);
        brookhavenTotal = (bhSched && bhSched.total) || 0;
      }
    }
    var totalFees = brooklynFees + brookhavenTotal;
    var netBenefit = doNothing - tax - totalFees;
    return {
      tax: tax,
      brooklynFees: brooklynFees,
      brookhavenFees: brookhavenTotal,
      fees: totalFees,
      doNothing: doNothing,
      net: netBenefit
    };
  }

  function _buildScenarioComparison(currentCfg) {
    if (!currentCfg) return '';
    var horizon = currentCfg.horizonYears || currentCfg.years || 5;
    var userDuration = currentCfg.structuredSaleDurationMonths || 18;

    // Scenario A: Sell now, no deferral (rec=1 immediate path).
    var cfgA = Object.assign({}, currentCfg, { recognitionStartYearIndex: 0 });
    var mA = _scenarioMetrics(cfgA);

    // Scenario B: Delay close to Jan 1 of next year. Force gain into Y2
    // ONLY (no further deferral). Implemented as deferred path with
    // recognitionStartYearIndex=1 and a very short duration so maturity
    // clamps to Y2 — the gain has nowhere to spread.
    var cfgB = Object.assign({}, currentCfg, {
      recognitionStartYearIndex: 1,
      structuredSaleDurationMonths: 12
    });
    var mB = _scenarioMetrics(cfgB);

    // Scenario C: Structured sale at the user's duration. Pick the
    // recognition-start year that maximizes net under the duration
    // constraint (rec=2..min(horizon,4)).
    var bestC = null, bestRecC = 2;
    for (var r = 2; r <= Math.min(4, horizon); r++) {
      var cfgR = Object.assign({}, currentCfg, {
        recognitionStartYearIndex: r - 1,
        structuredSaleDurationMonths: userDuration
      });
      var m = _scenarioMetrics(cfgR);
      if (m && (bestC == null || m.net > bestC.net)) {
        bestC = m;
        bestRecC = r;
      }
    }

    var rows = [];
    if (mA) rows.push({
      label: 'Sell now (Year 1)',
      sub: 'Close in current year, Brooklyn losses absorb gain immediately',
      metrics: mA
    });
    if (mB) rows.push({
      label: 'Delay close to Jan 1 next year',
      sub: 'Gain hits Year 2 naturally — no structured-sale product needed',
      metrics: mB
    });
    if (bestC) rows.push({
      label: 'Structured sale (' + userDuration + ' months)',
      sub: 'Insurance product defers gain to Year ' + bestRecC + ' under the legal window',
      metrics: bestC
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

    var html = '<div class="rett-scenario-card">';
    html += '<div class="rett-scenario-title">Strategy Comparison</div>';
    html += '<div class="rett-scenario-subtitle">Three real-world planning options — same scenario, same do-nothing baseline. The highest net benefit is recommended.</div>';
    html += '<table class="rett-scenario-table">';
    html += '<thead><tr><th>Strategy</th><th class="num">Tax Owed</th><th class="num">Fees</th><th class="num">Net Benefit</th></tr></thead><tbody>';
    rows.forEach(function (row, idx) {
      var isWinner = (idx === winnerIdx);
      html += '<tr' + (isWinner ? ' class="rett-scenario-winner"' : '') + '>';
      html += '<td>';
      html += '<div class="rett-scenario-label">' + row.label;
      if (isWinner) html += ' <span class="rett-scenario-badge">RECOMMENDED</span>';
      html += '</div>';
      html += '<div class="rett-scenario-sub">' + row.sub + '</div>';
      html += '</td>';
      html += '<td class="num">' + _fmt(row.metrics.tax) + '</td>';
      html += '<td class="num">' + _fmt(row.metrics.fees) + '</td>';
      html += '<td class="num"><strong>' + _fmt(row.metrics.net) + '</strong></td>';
      html += '</tr>';
    });
    html += '</tbody></table></div>';
    return html;
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

    // Build a base cfg snapshot for the scenario comparison panel.
    // Reuses inputs-collector so the three scenarios share every input
    // the user already filled in (custodian, leverage, income, sale,
    // basis, depr, ST gain, withhold, etc.) — only recognitionStartYearIndex
    // and structuredSaleDurationMonths vary across the three.
    var scenarioCfg = (typeof collectInputs === 'function') ? (function () {
      try { return collectInputs(); } catch (e) { return null; }
    })() : null;
    var scenarioComparison = (scenarioCfg && _isEngaged)
      ? _buildScenarioComparison(scenarioCfg) : '';

    if (splitMode) {
      summaryHost.innerHTML = '<div class="rett-dashboard">' +
        scenarioComparison +
        _buildKpiRow(years, totals) +
        (_isEngaged ? _buildChart(years) + _buildPies(years, comp, result) : noEngagementCard) +
        '</div>';
      detailsHost.innerHTML = _buildTable(years);
    } else {
      var html = '<div class="rett-dashboard">';
      html += _buildKpiRow(years, totals);
      html += (_isEngaged ? _buildChart(years) + _buildPies(years, comp, result) : noEngagementCard);
      html += _buildTable(years);
      html += '</div>';
      host.innerHTML = html;
    }

    // Refresh the sticky savings ribbon (Page 2). Defensive — may not be
    // loaded yet if this runs very early in page init.
    if (typeof root.renderSavingsRibbon === 'function') {
      try { root.renderSavingsRibbon(); } catch (e) { if (typeof window !== "undefined" && typeof window.reportFailure === "function") window.reportFailure("non-fatal in projection-dashboard-render.js", e); else if (typeof console !== "undefined") console.warn(e); }
    }
    // Refresh the plain-English narrative card.
    if (typeof root.renderNarrative === 'function') {
      try { root.renderNarrative(); } catch (e) { if (typeof window !== "undefined" && typeof window.reportFailure === "function") window.reportFailure("non-fatal in projection-dashboard-render.js", e); else if (typeof console !== "undefined") console.warn(e); }
    }
    // Federal-bracket position visualization is intentionally NOT
    // rendered while Brooklyn is the only strategy in the projector.
    // Brooklyn shifts capital-gain treatment, not ordinary-income
    // brackets (the $3K/yr ordinary offset is too small to draw).
    // The renderer + script tag stay loaded so that when
    // ordinary-income strategies (oil & gas, etc.) come online, this
    // call can be re-enabled and the chart will be the multi-year
    // "where they would have been vs where the strategy puts them"
    // view the user described.
    // if (typeof root.renderBracketViz === 'function') {
    //   try { root.renderBracketViz(); } catch (e) { if (typeof window !== "undefined" && typeof window.reportFailure === "function") window.reportFailure("non-fatal in projection-dashboard-render.js", e); else if (typeof console !== "undefined") console.warn(e); }
    // }
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
})(window);
