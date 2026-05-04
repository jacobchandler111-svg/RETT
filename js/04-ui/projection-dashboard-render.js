// FILE: js/04-ui/projection-dashboard-render.js
// Multi-year projection dashboard for the Projection page (Page 2).
// Renders into #projection-table:
//   1. KPI tile row (Total Tax Saved, Cumulative Fees, Net Benefit, ROI)
//   2. SVG paired bar chart: Without vs With strategy per year, with a
//      cumulative-savings line overlay
//   3. Compact data table with year-by-year detail
//
// Uses RETT's existing blue palette and styling; depends on no external
// chart library. Reads from window.__lastResult populated by controls.js.
//
// Public entry point: renderProjectionDashboard()

(function (root) {
  'use strict';

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
    if (totals && totals.cumulativeFees != null) cumFees = totals.cumulativeFees;

    var comp = window.__lastComparison;
    var brookhavenFees = (comp && comp.totalBrookhavenFees) || 0;
    // No-engagement detection (matches savings-ribbon.js): suppress
    // both Brooklyn and Brookhaven fees when the engine deployed
    // nothing. Without this guard the KPI tiles displayed Brookhaven
    // setup fees for clients who weren't actually engaging the
    // strategy.
    var _engineEngaged = false;
    if (comp && Array.isArray(comp.rows) && comp.rows.length) {
      _engineEngaged = comp.rows.some(function (r) {
        return (r.investmentThisYear || 0) > 0 ||
               (r.gainRecognized || 0) > 0 ||
               (r.lossApplied || 0) > 0;
      });
    } else {
      _engineEngaged = totalSave !== 0 || cumFees > 0;
    }
    if (!_engineEngaged) {
      cumFees = 0;
      brookhavenFees = 0;
    }
    var allFees = cumFees + brookhavenFees;
    var net = totalSave - allFees;
    var roi = allFees > 0 ? (net / allFees * 100) : (totalSave > 0 ? Infinity : 0);
    var roiTxt = isFinite(roi) ? roi.toFixed(0) + '%' : '∞';
    var pctReduce = totalNo > 0 ? (totalSave / totalNo * 100).toFixed(1) + '% lower tax' : '';

    var savedKind = totalSave > 0 ? 'positive' : (totalSave < 0 ? 'negative' : '');
    var netKind = net > 0 ? 'positive' : (net < 0 ? 'negative' : '');
    var roiKind = isFinite(roi) && roi > 0 ? 'positive' : (isFinite(roi) && roi < 0 ? 'negative' : '');

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

  // Build the SVG paired bar chart with cumulative savings line overlay.
  function _buildChart(years) {
    var n = years.length;
    if (!n) return '';

    var W = 760, H = 340;
    var padL = 60, padR = 40, padT = 20, padB = 50;
    var innerW = W - padL - padR;
    var innerH = H - padT - padB;

    // Compute scales
    var maxBar = 0;
    var data = years.map(function (y) {
      var no = y.taxNoBrooklyn || 0;
      var w = (y.taxWithBrooklyn != null) ? y.taxWithBrooklyn : no;
      var save = no - w;
      if (no > maxBar) maxBar = no;
      if (w > maxBar) maxBar = w;
      return { year: y.year, no: no, w: w, save: save };
    });
    if (maxBar <= 0) maxBar = 1;
    // Round up to a nice number for axis
    var pow = Math.pow(10, Math.floor(Math.log10(maxBar)));
    var yMax = Math.ceil(maxBar / pow) * pow;

    // Cumulative savings scale (for line overlay, separate axis on right)
    var cumSeries = [];
    var run = 0;
    data.forEach(function (d) { run += d.save; cumSeries.push(run); });
    var maxCum = Math.max.apply(null, cumSeries);
    if (maxCum <= 0) maxCum = 1;
    var cumPow = Math.pow(10, Math.floor(Math.log10(maxCum)));
    var cumMax = Math.ceil(maxCum / cumPow) * cumPow;

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
    // Right axis (cumulative)
    for (var j = 0; j <= ticks; j++) {
      var cv = cumMax * j / ticks;
      var cy = padT + innerH - (cv / cumMax) * innerH;
      svg += '<text x="' + (W - padR + 8) + '" y="' + (cy + 4) + '" text-anchor="start" ' +
             'font-size="11" fill="#5fd97e" font-family="inherit">' + _fmtCompact(cv) + '</text>';
    }

    // Bars
    var pts = [];
    data.forEach(function (d, idx) {
      var cx = padL + groupW * idx + groupW / 2;
      var x1 = cx - barW - gap / 2;
      var x2 = cx + gap / 2;
      var hNo = (d.no / yMax) * innerH;
      var hW = (d.w / yMax) * innerH;
      var yNo = padT + innerH - hNo;
      var yW = padT + innerH - hW;

      svg += '<rect x="' + x1 + '" y="' + yNo + '" width="' + barW + '" height="' + hNo +
             '" fill="#5fa8ff" rx="2"><title>Without strategy: ' + _fmt(d.no) + '</title></rect>';
      svg += '<rect x="' + x2 + '" y="' + yW + '" width="' + barW + '" height="' + hW +
             '" fill="#2c5aa0" rx="2"><title>With strategy: ' + _fmt(d.w) + '</title></rect>';

      // Savings label above the taller bar
      var topY = Math.min(yNo, yW) - 6;
      if (d.save > 0) {
        svg += '<text x="' + cx + '" y="' + topY + '" text-anchor="middle" font-size="11" ' +
               'fill="#5fd97e" font-weight="700" font-family="inherit">-' + _fmtCompact(d.save) + '</text>';
      }

      // X-axis label
      svg += '<text x="' + cx + '" y="' + (padT + innerH + 18) + '" text-anchor="middle" ' +
             'font-size="12" fill="#b3d4ff" font-family="inherit">' + d.year + '</text>';

      // Cumulative point
      var cy2 = padT + innerH - (cumSeries[idx] / cumMax) * innerH;
      pts.push([cx, cy2]);
    });

    // Cumulative savings line
    if (pts.length > 1) {
      var d = 'M ' + pts[0][0] + ' ' + pts[0][1];
      for (var k = 1; k < pts.length; k++) d += ' L ' + pts[k][0] + ' ' + pts[k][1];
      svg += '<path d="' + d + '" fill="none" stroke="#5fd97e" stroke-width="2.5" ' +
             'stroke-dasharray="0" stroke-linejoin="round"/>';
    }
    pts.forEach(function (p) {
      svg += '<circle cx="' + p[0] + '" cy="' + p[1] + '" r="3.5" fill="#5fd97e" stroke="#0a1929" stroke-width="1.5"/>';
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
        '<span><span class="rett-legend-swatch swatch-cumulative"></span>Cumulative Savings</span>' +
      '</div>';

    return '<div class="rett-chart-wrap">' +
      '<div class="rett-chart-title"><span>Year-by-Year Tax: Baseline vs With Strategy</span>' + legend + '</div>' +
      svg +
      '</div>';
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
      '<th title="New capital deposited into Brooklyn this year (basis cash + structured-sale tranche release)">New Investment</th>' +
      '<th title="Short-term capital losses generated by Brooklyn this year (before applying to gains)">Loss Generated</th>' +
      '<th title="Brooklyn management fee for the year">Fee</th>' +
    '</tr>';
    var body = '';
    var cNo = 0, cWith = 0, cSave = 0, cLoss = 0, cFee = 0;
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
      cNo += no; cWith += w; cSave += save;
      cLoss += (y.grossLoss || 0);
      cFee += (y.fee || 0);
      body += '<tr>' +
        '<td>' + y.year + '</td>' +
        '<td>' + _fmt(no) + '</td>' +
        '<td>' + _fmt(w) + '</td>' +
        '<td class="rett-savings-cell ' + _deltaClass(save) + '">' + _fmt(save) + '</td>' +
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
      '<td>' + _fmt(totalInvested) + '</td>' +
      '<td>' + _fmt(cLoss) + '</td>' +
      '<td>' + _fmt(cFee) + '</td>' +
    '</tr>';
    return '<div class="rett-table-wrap rett-table-scroll">' +
      '<table class="rett-data-table rett-data-table-frozen"><thead>' + head + '</thead><tbody>' + body + '</tbody></table>' +
      '</div>';
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
            taxWithBrooklyn: r.withStrategy ? r.withStrategy.total : 0,
            investmentThisYear: r.investmentThisYear || 0,
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
    // If the comparison shows no taxable activity (engine recommended no-action),
    // suppress projection-engine fees so the dashboard reflects the engine's recommendation.
    if (comp && Array.isArray(comp.rows) && comp.rows.length &&
        comp.totalSavings === 0 &&
        comp.rows.every(function (r) {
          return (!r.gainRecognized || r.gainRecognized === 0) &&
                 (!r.lossApplied || r.lossApplied === 0);
        })) {
      totals = { cumulativeFees: 0, cumulativeNetSavings: 0 };
    }

    if (splitMode) {
      summaryHost.innerHTML = '<div class="rett-dashboard">' +
        _buildKpiRow(years, totals) +
        _buildChart(years) +
        '</div>';
      detailsHost.innerHTML = _buildTable(years);
    } else {
      var html = '<div class="rett-dashboard">';
      html += _buildKpiRow(years, totals);
      html += _buildChart(years);
      html += _buildTable(years);
      html += '</div>';
      host.innerHTML = html;
    }

    // Refresh the sticky savings ribbon (Page 2). Defensive — may not be
    // loaded yet if this runs very early in page init.
    if (typeof root.renderSavingsRibbon === 'function') {
      try { root.renderSavingsRibbon(); } catch (e) { /* non-fatal */ }
    }
    // Refresh the plain-English narrative card.
    if (typeof root.renderNarrative === 'function') {
      try { root.renderNarrative(); } catch (e) { /* non-fatal */ }
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
    //   try { root.renderBracketViz(); } catch (e) { /* non-fatal */ }
    // }
    // Refresh the year-by-year cashflow schedule (Brooklyn investment +
    // structured-sale balance) below the Multi-Year Snapshot.
    if (typeof root.renderCashflowSchedule === 'function') {
      try { root.renderCashflowSchedule(); } catch (e) { /* non-fatal */ }
    }
    // Animate any KPI / hero / ribbon numbers that just changed.
    if (typeof root.animateRettNumbers === 'function') {
      try { root.animateRettNumbers(); } catch (e) { /* non-fatal */ }
    }
  }

  root.renderProjectionDashboard = renderProjectionDashboard;
})(window);
