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

  function _buildKpiRow(years, totals, scenarioComp, scenarioResult) {
    var totalSave = 0, cumFees = 0, totalNo = 0, totalWith = 0;
    years.forEach(function (y) {
      var no = y.taxNoBrooklyn || 0;
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
      // Immediate path. Use computeTaxComparison so the Y1 baseline
      // INCLUDES the full property LT gain (via _flatRec's cfg-derived
      // _totalLT). ProjectionEngine.run alone produces taxNoBrooklyn
      // for ordinary income only — for scenarios with $0 ordinary
      // income (e.g. retirees with a real-estate gain) that read of
      // "do nothing" registers as ~zero, which made the auto-pick
      // optimizer choose 0% short (no Brooklyn) since any positive
      // leverage just added fees against a zero-savings baseline.
      if (typeof computeTaxComparison !== 'function' ||
          typeof recommendSale !== 'function' ||
          typeof ProjectionEngine === 'undefined' ||
          !ProjectionEngine.run) return null;
      // recommendSale expects strategyKey + investedCapital — patch
      // them on so it doesn't return zero capacity.
      cfg = _engineFlavoredCfg(cfg);
      var recObj;
      try { recObj = recommendSale(cfg); } catch (e) { return null; }
      var lossGenIm = (recObj && recObj.summary && recObj.summary.lossByYear && recObj.summary.lossByYear[0]) || 0;
      var scheduleIm = recObj && recObj.summary && Array.isArray(recObj.summary.gainByYear)
        ? recObj.summary.gainByYear.map(function (g, i) {
            return { year: i, gainTaken: g || 0,
              lossGenerated: (recObj.summary.lossByYear && recObj.summary.lossByYear[i]) || 0 };
          })
        : null;
      var normRecIm = {
        recommendation: recObj ? recObj.recommendation : 'no-action',
        longTermGain: (recObj && recObj.longTermGain) || 0,
        lossGenerated: lossGenIm,
        schedule: scheduleIm
      };
      var compIm;
      try { compIm = computeTaxComparison(cfg, normRecIm); } catch (e) { return null; }
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
      // Brookhaven flat fees from the schedule directly.
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
    var userDuration = currentCfg.structuredSaleDurationMonths || 18;

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
      return {
        cfg: _scenarioCfgFor(type, sectionCfg, picked.bestRecC, userDuration),
        picked: picked
      };
    }

    // Scenario A: Sell now, no deferral (rec=1 immediate path).
    var pickedA = _bestPickedCfg('A', currentCfg);
    var mA = _scenarioMetrics(pickedA.cfg);

    // Scenario B: Delay close to Jan 1 of next year. Force gain into Y2
    // ONLY (no further deferral). Only feasible when the sale is close
    // to year-end — hide when impl date is before September.
    var saleMonth0_b = -1;
    if (currentCfg.implementationDate &&
        typeof window !== 'undefined' &&
        typeof window.parseLocalDate === 'function') {
      var dB = window.parseLocalDate(currentCfg.implementationDate);
      if (dB && !isNaN(dB.getTime())) saleMonth0_b = dB.getMonth();
    }
    var mB = null;
    if (saleMonth0_b >= 8) {
      var pickedB = _bestPickedCfg('B', currentCfg);
      mB = _scenarioMetrics(pickedB.cfg);
    }

    // Scenario C: Structured sale. Auto-pick searches horizon × leverage
    // × recognition year and returns the (h, lev, combo, bestRecC)
    // tuple with max net.
    var pickedC = _bestPickedCfg('C', currentCfg);
    var bestC = _scenarioMetrics(pickedC.cfg);
    var bestRecC = pickedC.picked.bestRecC;

    var rows = [];
    if (mA) rows.push({
      type: 'A', rec: 1, maxRec: null,
      label: 'Sell now (Year 1)',
      sub: 'Close in current year, Brooklyn losses absorb gain immediately',
      metrics: mA
    });
    if (mB) rows.push({
      type: 'B', rec: 2, maxRec: 1,
      label: 'Delay close to Jan 1 next year',
      sub: 'Gain hits Year 2 naturally — no structured-sale product needed',
      metrics: mB
    });
    if (bestC) rows.push({
      type: 'C', rec: bestRecC, maxRec: null,
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

    // Initialize the checked-scenarios set on first render. Default:
    // only the RECOMMENDED row is checked, so the dashboard below
    // shows that single scenario by default. Once the user toggles a
    // checkbox, their selection persists across re-renders.
    if (!root.__rettCheckedScenarios) {
      root.__rettCheckedScenarios = {};
      if (winnerIdx >= 0) {
        root.__rettCheckedScenarios[rows[winnerIdx].type] = true;
      } else if (rows.length) {
        root.__rettCheckedScenarios[rows[0].type] = true;
      }
    }
    // Stash the row->cfg map so the dashboard renderer can compute
    // per-scenario data without re-deriving cfg shapes.
    root.__rettScenarioRows = rows.map(function (r) { return {
      type: r.type, rec: r.rec, maxRec: r.maxRec, label: r.label
    }; });

    var html = '<div class="rett-scenario-card">';
    html += '<div class="rett-scenario-title">Strategy Comparison</div>';
    html += '<div class="rett-scenario-subtitle">Three real-world planning options — same scenario, same do-nothing baseline. Check a row to add its dashboard below; check multiple to compare side-by-side.</div>';
    html += '<table class="rett-scenario-table">';
    html += '<thead><tr><th class="rett-scenario-check"></th><th>Strategy</th><th class="num">Tax Owed</th><th class="num">Fees</th><th class="num">Net Benefit</th></tr></thead><tbody>';
    rows.forEach(function (row, idx) {
      var isWinner = (idx === winnerIdx);
      var isChecked = !!root.__rettCheckedScenarios[row.type];
      var classes = ['rett-scenario-row'];
      if (isWinner) classes.push('rett-scenario-winner');
      if (isChecked) classes.push('rett-scenario-checked');
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

  // Build the cfg variant for a scenario type ('A', 'B', 'C').
  function _scenarioCfgFor(type, currentCfg, bestRecC, userDuration) {
    if (!currentCfg) return null;
    if (type === 'A') {
      return Object.assign({}, currentCfg, {
        recognitionStartYearIndex: 0,
        maxRecognitionYearIndex: null
      });
    }
    if (type === 'B') {
      return Object.assign({}, currentCfg, {
        recognitionStartYearIndex: 1,
        maxRecognitionYearIndex: 1
      });
    }
    if (type === 'C') {
      return Object.assign({}, currentCfg, {
        recognitionStartYearIndex: (bestRecC || 2) - 1,
        structuredSaleDurationMonths: userDuration || 18,
        maxRecognitionYearIndex: null
      });
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
      if (typeof computeDeferredTaxComparison !== 'function') return null;
      comp = computeDeferredTaxComparison(cfg);
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
      // Immediate path. Use the same chain runRecommendation uses.
      if (typeof ProjectionEngine === 'undefined' || !ProjectionEngine.run) return null;
      // Patch tierKey→strategyKey and investment→investedCapital so
      // recommendSale doesn't silently treat the position as zero.
      cfg = _engineFlavoredCfg(cfg);
      try { result = ProjectionEngine.run(cfg); } catch (e) { return null; }
      if (!result || !Array.isArray(result.years)) return null;
      var rec = (typeof recommendSale === 'function') ? recommendSale(cfg) : null;
      var lossGen = 0;
      var schedule = null;
      if (rec && rec.summary) {
        lossGen = (rec.summary.lossByYear && rec.summary.lossByYear[0]) || 0;
        if (Array.isArray(rec.summary.gainByYear)) {
          schedule = rec.summary.gainByYear.map(function (g, i) {
            return { year: i, gainTaken: g || 0,
              lossGenerated: (rec.summary.lossByYear && rec.summary.lossByYear[i]) || 0 };
          });
        }
      }
      var normRec = {
        recommendation: rec ? rec.recommendation : 'no-action',
        longTermGain: (rec && rec.longTermGain) || 0,
        lossGenerated: lossGen,
        schedule: schedule
      };
      try { comp = computeTaxComparison(cfg, normRec); } catch (e) { return null; }
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

  // recommendSale and ProjectionEngine.run expect cfg.strategyKey and
  // cfg.investedCapital, but collectInputs returns cfg.tierKey and
  // cfg.investment. controls.js' _buildEngineCfg patches these for the
  // dashboard pipeline; dashboard-side scenario code needs the same
  // patch so recommendSale doesn't silently return lossByYear=[0...]
  // (treating the position as zero capital → zero capacity → engine
  // says "no losses possible" → auto-pick sees only fee drag and
  // chooses 0% short).
  function _engineFlavoredCfg(cfg) {
    if (!cfg) return cfg;
    var out = Object.assign({}, cfg);
    if (out.strategyKey == null) out.strategyKey = out.tierKey;
    if (out.investedCapital == null) out.investedCapital = out.investment;
    if (out.years == null) out.years = out.horizonYears;
    return out;
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
    if (!baseCfg) return { horizon: 5, shortPct: 100, comboId: null, bestRecC: 2 };
    var stratKey = baseCfg.tierKey || 'beta1';
    var custId = baseCfg.custodian || '';
    var pcts = _candidateShortPctsLocal(stratKey, custId);
    var horizons = [1, 3, 5, 7];
    var userDuration = baseCfg.structuredSaleDurationMonths || 18;
    var best = null;
    horizons.forEach(function (hor) {
      // Scenarios B and C need horizon >= 2 (recognition starts in Y2 or later).
      if (hor < 2 && (type === 'B' || type === 'C')) return;
      pcts.forEach(function (p) {
        var cfgSection = Object.assign({}, baseCfg, {
          horizonYears: hor,
          leverage: p.shortPct / 100,
          leverageCap: p.shortPct / 100,
          comboId: p.comboId
        });
        // For scenario C, also find the best recognition year.
        var pickRec = 2;
        if (type === 'C') {
          var bestRecNet = -Infinity;
          for (var r = 2; r <= Math.min(4, hor); r++) {
            var cfgR = Object.assign({}, cfgSection, {
              recognitionStartYearIndex: r - 1,
              structuredSaleDurationMonths: userDuration,
              maxRecognitionYearIndex: null
            });
            var mr = _scenarioMetrics(cfgR);
            if (mr && mr.net > bestRecNet) { bestRecNet = mr.net; pickRec = r; }
          }
        }
        var typedCfg = _scenarioCfgFor(type, cfgSection, pickRec, userDuration);
        var m = _scenarioMetrics(typedCfg);
        if (m && (!best || m.net > best.net)) {
          best = { horizon: hor, shortPct: p.shortPct, comboId: p.comboId, bestRecC: pickRec, net: m.net };
        }
      });
    });
    return best || { horizon: 5, shortPct: 100, comboId: null, bestRecC: 2 };
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
      durationMonths: baseCfg.structuredSaleDurationMonths || 18,
      autoPickEnabled: true
    };
    return root.__rettSectionState[type];
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

  function _sectionConfigDescription(type, st) {
    if (!st) return '';
    var lev = st.shortPct + '% short';
    // Schwab: show the friendly label
    if (st.comboId && typeof root.getSchwabCombo === 'function') {
      var combo = root.getSchwabCombo(st.comboId);
      if (combo) lev = combo.leverageLabel;
    }
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
      if (h < 2 && (type === 'B' || type === 'C')) return;
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
    var configStr = _sectionConfigDescription(type, st);
    var html = '<div class="rett-dashboard rett-scenario-section" id="rett-section-' + (type || 'X') + '">';
    html += '<div class="rett-scenario-section-header">' +
            '<span class="rett-scenario-section-title-text">' + label + '</span>' +
            (configStr ? ' <span class="rett-scenario-section-config">' + configStr + '</span>' : '') +
            '</div>';
    if (type && baseCfg) {
      html += _buildSectionControls(type, baseCfg);
    }
    html += _buildKpiRow(data.years, totals, data.comp, data.result);
    html += _buildChart(data.years);
    html += _buildPies(data.years, data.comp, data.result);
    html += '</div>';
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
    // before the user has scrolled.
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
      _renderDashboardsFromChecked();
      detailsHost.innerHTML = _buildTable(years);
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
