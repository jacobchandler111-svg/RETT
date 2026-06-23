// ============================================================================
// Key Points export (admin-only) — advisor 2026-06-23
// ----------------------------------------------------------------------------
// A one-click "Export Key Points" button that sits left of the Print/Save-as-
// PDF button on BOTH sources of truth (Tab 6 Strategy Summary + Tab 7 CPA
// Verification View) and is visible ONLY in admin mode. It spits out a clean
// PDF of the data the advisor tracks regularly:
//   - which Brooklyn strategy is selected (+ leverage / horizon),
//   - per-year: capital invested, expected loss harvested, AM fees,
//   - projected fees (Brooklyn AM + Brookhaven, total),
//   - the same shape for each funded supplemental strategy,
//   - the bottom-line net benefit + tax saved.
//
// SOURCE OF TRUTH: every number is read through root.__rettResolveChosen()
// (exposed by temp-page-render.js) — the SAME resolver Tab 7 uses, which
// applies the optimizer's partial-deploy dial-back and the funded-supp
// filter. So the export ties to the displayed numbers; it never re-derives
// the engine independently.
//
// Mechanism: builds a self-contained, styled .kp-doc node offscreen and runs
// html2pdf (already loaded for the print button) to download it. No math.
// ============================================================================
(function (root) {
  'use strict';

  var doc = (typeof document !== 'undefined') ? document : null;

  // ---- formatting helpers -------------------------------------------------
  function _usd(n) {
    n = Math.round(Number(n) || 0);
    var neg = n < 0; n = Math.abs(n);
    return (neg ? '-$' : '$') + n.toLocaleString('en-US');
  }
  function _esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
  function _stratLabel(t) {
    if (t === 'A') return 'Traditional Sale';
    if (t === 'B') return 'Installment Sale';
    if (t === 'C') return 'Structured Installment Sale';
    return 'Strategy ' + t;
  }
  function _filingLabel(f) {
    var m = { mfj: 'Married Filing Jointly', single: 'Single',
              mfs: 'Married Filing Separately', hoh: 'Head of Household' };
    return m[String(f || '').toLowerCase()] || (f || '');
  }
  function _clientName() {
    if (!doc) return '';
    var ids = ['client-name', 'clientName', 'client_name'];
    for (var i = 0; i < ids.length; i++) {
      var el = doc.getElementById(ids[i]);
      if (el && el.value && el.value.trim()) return el.value.trim();
    }
    var ph = doc.getElementById('print-header-client');
    if (ph && ph.textContent && ph.textContent.trim() &&
        ph.textContent.trim().toLowerCase() !== 'strategy summary') {
      return ph.textContent.trim();
    }
    return '';
  }
  function _todayStr() {
    var d = new Date();
    return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  }

  function _suppLast(s) {
    var core  = (root.__rettSupplemental      && root.__rettSupplemental[s.id])      || null;
    var extra = (root.__rettSupplementalExtra && root.__rettSupplementalExtra[s.id]) || null;
    return (core && core.lastResult) || (extra && extra.lastResult) || null;
  }

  // ---- data assembly ------------------------------------------------------
  // Returns a structured key-points object (or null if no strategy chosen).
  function buildKeyPointsData() {
    if (typeof root.__rettResolveChosen !== 'function') return null;
    var ctx = null;
    try { ctx = root.__rettResolveChosen(); } catch (e) { return null; }
    if (!ctx || !ctx.comp || !Array.isArray(ctx.comp.rows)) return null;

    var entry = ctx.entry, comp = ctx.comp;
    var m = entry.metrics || {}, cfg = entry.cfg || {};

    // Brooklyn per-year: investmentThisYear is the CUMULATIVE deployed
    // position, so NEW capital that year = this year's cumulative minus last
    // year's (sums back to total deployed). Loss + fee are already per-year
    // (Σ row.fee === metrics.brooklynFees, verified).
    var prevCum = 0;
    var perYear = comp.rows.map(function (r) {
      var cum = Number(r.investmentThisYear) || 0;
      var newInv = Math.max(0, cum - prevCum); prevCum = cum;
      return {
        year: r.year,
        proceeds: 0,
        invested: newInv,
        loss: Number(r.lossGenerated) || Number(r.lossApplied) || 0,
        gainRecognized: Number(r.gainRecognized) || 0,
        fee: Number(r.fee) || 0
      };
    });

    // Sale proceeds RECEIVED each year — the payment schedule. Reuses the
    // engine's cfg-derived §453 schedule (down payment + debt payoff + recap
    // at closing, then installments; Σ cash === salePrice). For the immediate
    // strategy (A) the schedule fn returns null → all proceeds land at the
    // sale year. Merged onto perYear by year; total = salePrice.
    var sched = (typeof root.__rettDescribeInstallmentSchedule === 'function')
      ? root.__rettDescribeInstallmentSchedule(cfg) : null;
    var proceedsByYear = {};
    if (sched && Array.isArray(sched.rows) && sched.rows.length) {
      sched.rows.forEach(function (r) {
        proceedsByYear[r.year] = (proceedsByYear[r.year] || 0) + (Number(r.cash) || 0);
      });
    } else {
      var saleYr = (perYear[0] && perYear[0].year) || cfg.year1;
      proceedsByYear[saleYr] = Number(cfg.salePrice) || 0;
    }
    perYear.forEach(function (r) { r.proceeds = Number(proceedsByYear[r.year]) || 0; });
    var proceedsTotal = Object.keys(proceedsByYear).reduce(function (a, k) {
      return a + (Number(proceedsByYear[k]) || 0);
    }, 0);

    // ---- Combined supplemental + fee reconciliation — EXACTLY as Tab 6 ----
    // CRITICAL: the Strategy Summary hero caps each funded supp's benefit at
    // the tax remaining AFTER the chosen Brooklyn strategy (residual cap), so
    // supps can't double-claim tax Brooklyn already eliminated. We MUST mirror
    // that here using __rettResidualCapForEntry — NOT _resolveChosen's looser
    // Σ-withStrategy.total cap, which over-credited supps (e.g. Delphi showed
    // +$101K of benefit Brooklyn had already captured) and omitted supp fees.
    // (advisor 2026-06-23.) net = primaryNet + cappedSuppBenefit − setupFees;
    // totalFees = Brooklyn + Brookhaven + supp mgmt + supp setup.
    if (typeof root.__rettRunAllSuppMath === 'function') {
      try { root.__rettRunAllSuppMath(); } catch (e) { /* */ }
    }
    var primaryNet = Number(m.net) || 0;
    var primarySavings = Number(m.savings) || 0;
    var _ppCap = (typeof root.__rettResidualCapForEntry === 'function')
      ? root.__rettResidualCapForEntry(entry) : null;
    var solverOut = (typeof root.runMasterSolver === 'function')
      ? root.runMasterSolver(primaryNet, (_ppCap != null ? { postPrimaryTaxRemaining: _ppCap } : undefined))
      : null;
    var _solverSupp = (solverOut && isFinite(solverOut.totalSupplementalBenefit))
      ? Number(solverOut.totalSupplementalBenefit) : 0;
    var supplementalBenefit = _solverSupp;
    if (typeof root.__rettHonestSuppBenefitForEntry === 'function') {
      try {
        var _honest = root.__rettHonestSuppBenefitForEntry(entry, solverOut);
        if (isFinite(_honest)) supplementalBenefit = Math.min(_solverSupp, _honest);
      } catch (e) { /* keep solver value */ }
    }
    var _setupMap = (window.__rettSuppSetupFees && typeof window.__rettSuppSetupFees === 'object')
      ? window.__rettSuppSetupFees : {};
    var fundedSupps = (solverOut && Array.isArray(solverOut.supplementals))
      ? solverOut.supplementals.filter(function (s) {
          return s.enabled && s.available && s.rivalry && s.rivalry.funded;
        })
      : [];
    var appliedSetupFees = 0;
    fundedSupps.forEach(function (s) {
      if ((s.rivalry.granted || 0) > 0) appliedSetupFees += Math.max(0, Number(_setupMap[s.id]) || 0);
    });
    var suppFeesTotal = fundedSupps
      .filter(function (s) { return (s.rivalry.granted || 0) > 0; })
      .reduce(function (a, s) {
        return a + ((Number(s.result && s.result.mgmtFeeDollars) || 0) + Math.max(0, Number(_setupMap[s.id]) || 0));
      }, 0);
    var combinedNet = primaryNet + supplementalBenefit - appliedSetupFees;
    var combinedSavings = primarySavings + supplementalBenefit;
    var totalFeesAll = (Number(m.fees) || 0) + suppFeesTotal;

    // Per funded supp: realized benefit (residual-capped, net of its setup fee
    // — matching Tab 6's per-supp rows) + per-year invested/benefit. perYear
    // `year` is derived from the Brooklyn schedule (Delphi's rows omit it).
    var _y1 = (perYear[0] && perYear[0].year) || cfg.year1 || (new Date()).getFullYear();
    var supps = fundedSupps.map(function (s) {
      var last = _suppLast(s);
      var py = (last && Array.isArray(last.perYear)) ? last.perYear : [];
      var rows = py.map(function (p, i) {
        var sc = (typeof root.__rettSuppSatScale === 'function') ? root.__rettSuppSatScale(s, i) : 1;
        return {
          year: p.year || (_y1 + i),
          invested: Number(p.investment) || 0,
          benefit: Math.max(0, Number(p.totalSaved) || 0) * sc
        };
      }).filter(function (r) { return r.invested > 0 || r.benefit > 0; });
      var setup = ((s.rivalry.granted || 0) > 0) ? Math.max(0, Number(_setupMap[s.id]) || 0) : 0;
      return {
        id: s.id,
        name: s.name || s.shortName || s.id,
        realized: (Number(s.realizedNetBenefit) || 0) - setup,
        fee: (Number(s.result && s.result.mgmtFeeDollars) || 0) + setup,
        perYear: rows
      };
    });

    // Leverage label: derive from the ACTUAL combo (cfg.comboId) — cfg.leverageLabel
    // can be stale (e.g. shows "200/100" while the auto-pick dropped to 145/45
    // because the deposit is under the $3M 200/100 minimum). getSchwabCombo is
    // the source of truth for the label that matches the loss rate the engine ran.
    var _combo = (typeof root.getSchwabCombo === 'function' && cfg.comboId)
      ? root.getSchwabCombo(cfg.comboId) : null;
    var _leverageLabel = (_combo && _combo.leverageLabel) || cfg.leverageLabel ||
      (cfg.leverage ? (Math.round(cfg.leverage * 100) + '%') : '');

    var subParts = [];
    if (cfg.year1) subParts.push('Tax Year ' + cfg.year1);
    var st = cfg.state || cfg.stateCode;
    if (st && st !== 'NONE') subParts.push(st);
    if (cfg.filingStatus) subParts.push(_filingLabel(cfg.filingStatus));
    subParts.push('Prepared ' + _todayStr());

    return {
      client: _clientName(),
      sub: subParts.join('  ·  '),
      strategy: {
        type: ctx.chosen,
        name: entry.name || _stratLabel(ctx.chosen),
        leverageLabel: _leverageLabel,
        horizon: cfg.horizonYears,
        installments: cfg.installmentPayments
      },
      perYear: perYear,
      fees: {
        brooklyn: Number(m.brooklynFees) || 0,
        brookhaven: Number(m.brookhavenFees) || 0,
        supp: suppFeesTotal,
        total: totalFeesAll
      },
      totals: {
        proceeds: proceedsTotal,
        invested: perYear.reduce(function (a, r) { return a + r.invested; }, 0),
        loss: perYear.reduce(function (a, r) { return a + r.loss; }, 0),
        fee: perYear.reduce(function (a, r) { return a + r.fee; }, 0)
      },
      supps: supps,
      totalSuppBenefit: supplementalBenefit,
      net: combinedNet,
      savings: combinedSavings
    };
  }

  // ---- HTML template (self-contained, html2canvas-friendly) ---------------
  function _styles() {
    return '' +
'.kp-doc{box-sizing:border-box;width:760px;background:#ffffff;color:#1c1c1c;' +
  'font-family:Georgia,"Times New Roman",serif;font-size:13px;line-height:1.45;' +
  'padding:0 0 18px 0;margin:0;}' +
'.kp-doc *{box-sizing:border-box;}' +
'.kp-head{background:#14233f;color:#fff;padding:22px 28px 18px 28px;}' +
'.kp-head .kp-brand{font-family:Arial,Helvetica,sans-serif;font-size:11px;letter-spacing:3px;' +
  'text-transform:uppercase;color:#9db4d8;margin:0 0 6px 0;}' +
'.kp-head h1{font-size:24px;margin:0 0 8px 0;font-weight:700;letter-spacing:.3px;}' +
'.kp-head .kp-client{font-size:15px;color:#e7eefb;margin:0;font-weight:700;}' +
'.kp-head .kp-sub{font-family:Arial,Helvetica,sans-serif;font-size:11px;color:#9db4d8;margin:4px 0 0 0;}' +
'.kp-body{padding:18px 28px 0 28px;}' +
'.kp-sec{margin:0 0 20px 0;}' +
'.kp-sec h2{font-family:Arial,Helvetica,sans-serif;font-size:12px;letter-spacing:1.5px;' +
  'text-transform:uppercase;color:#7a1620;border-bottom:2px solid #7a1620;' +
  'padding:0 0 5px 0;margin:0 0 10px 0;}' +
'.kp-strat{display:flex;flex-wrap:wrap;gap:8px 26px;align-items:baseline;}' +
'.kp-strat .kp-strat-name{font-size:18px;font-weight:700;color:#14233f;}' +
'.kp-pill{font-family:Arial,Helvetica,sans-serif;font-size:11px;color:#374151;' +
  'background:#eef2f8;border:1px solid #d4ddec;border-radius:3px;padding:3px 9px;}' +
'table.kp-tbl{width:100%;border-collapse:collapse;font-size:12.5px;}' +
'table.kp-tbl th{font-family:Arial,Helvetica,sans-serif;font-size:10.5px;letter-spacing:.5px;' +
  'text-transform:uppercase;color:#5b6573;text-align:right;padding:6px 10px;' +
  'border-bottom:1.5px solid #cbd3df;}' +
'table.kp-tbl th.kp-l,table.kp-tbl td.kp-l{text-align:left;}' +
'table.kp-tbl td{padding:7px 10px;text-align:right;border-bottom:1px solid #edf0f5;' +
  'font-variant-numeric:tabular-nums;}' +
'table.kp-tbl tr.kp-total td{border-top:2px solid #14233f;border-bottom:none;' +
  'font-weight:700;color:#14233f;padding-top:8px;}' +
'.kp-year{font-weight:700;color:#14233f;}' +
'.kp-fees{display:flex;gap:0;border:1px solid #d4ddec;border-radius:4px;overflow:hidden;}' +
'.kp-fees .kp-fee{flex:1;padding:11px 14px;border-right:1px solid #e6ebf3;}' +
'.kp-fees .kp-fee:last-child{border-right:none;background:#f7f9fc;}' +
'.kp-fee .kp-fee-lbl{font-family:Arial,Helvetica,sans-serif;font-size:10px;letter-spacing:.5px;' +
  'text-transform:uppercase;color:#5b6573;margin:0 0 3px 0;}' +
'.kp-fee .kp-fee-val{font-size:17px;font-weight:700;color:#14233f;}' +
'.kp-supp{border:1px solid #e0e6ef;border-radius:4px;padding:11px 14px;margin:0 0 10px 0;}' +
'.kp-supp .kp-supp-head{display:flex;justify-content:space-between;align-items:baseline;margin:0 0 6px 0;}' +
'.kp-supp .kp-supp-name{font-size:15px;font-weight:700;color:#14233f;}' +
'.kp-supp .kp-supp-ben{font-size:15px;font-weight:700;color:#1f7a3d;}' +
'.kp-supp table.kp-tbl td,.kp-supp table.kp-tbl th{padding:4px 8px;font-size:11.5px;}' +
'.kp-none{color:#6b7280;font-style:italic;font-size:12.5px;}' +
'.kp-bottom{display:flex;gap:0;border-radius:5px;overflow:hidden;margin:4px 0 0 0;}' +
'.kp-bottom .kp-bl{flex:1;padding:14px 16px;color:#fff;}' +
'.kp-bottom .kp-bl-net{background-color:#1850b8;' +
  'background-image:linear-gradient(135deg,#1f6feb 0%,#0b1b3a 100%);}' +
'.kp-bottom .kp-bl-sav{background-color:#1a7a44;' +
  'background-image:linear-gradient(135deg,#22a85a 0%,#0f5132 100%);}' +
'.kp-bl .kp-bl-lbl{font-family:Arial,Helvetica,sans-serif;font-size:10.5px;letter-spacing:1px;' +
  'text-transform:uppercase;opacity:.8;margin:0 0 3px 0;}' +
'.kp-bl .kp-bl-val{font-size:22px;font-weight:700;}' +
'.kp-foot{padding:14px 28px 0 28px;margin:16px 0 0 0;border-top:1px solid #e6ebf3;' +
  'font-family:Arial,Helvetica,sans-serif;font-size:9.5px;color:#8a93a0;line-height:1.5;}';
  }

  function _suppTable(rows) {
    if (!rows || !rows.length) return '';
    var body = rows.map(function (r) {
      return '<tr><td class="kp-l kp-year">' + _esc(r.year) + '</td>' +
        '<td>' + (r.invested > 0 ? _usd(r.invested) : '&mdash;') + '</td>' +
        '<td>' + _usd(r.benefit) + '</td></tr>';
    }).join('');
    return '<table class="kp-tbl"><thead><tr>' +
      '<th class="kp-l">Year</th><th>Invested</th><th>Tax Benefit</th>' +
      '</tr></thead><tbody>' + body + '</tbody></table>';
  }

  function buildKeyPointsHTML(d) {
    if (!d) return '';
    var s = d.strategy;
    var stratPills = [];
    if (s.leverageLabel) stratPills.push('Leverage ' + _esc(s.leverageLabel));
    if (s.horizon) stratPills.push(_esc(s.horizon) + '-year horizon');
    if (s.type === 'B' && s.installments) stratPills.push(_esc(s.installments) + ' installment payment' + (s.installments > 1 ? 's' : ''));

    // Year-by-year table: sale proceeds received (payment schedule) alongside
    // the Brooklyn capital invested, expected loss, and fees.
    var pyBody = d.perYear.map(function (r) {
      return '<tr><td class="kp-l kp-year">' + _esc(r.year) + '</td>' +
        '<td>' + (r.proceeds > 0 ? _usd(r.proceeds) : '&mdash;') + '</td>' +
        '<td>' + _usd(r.invested) + '</td>' +
        '<td>' + _usd(r.loss) + '</td>' +
        '<td>' + _usd(r.fee) + '</td></tr>';
    }).join('');
    var pyTotal = '<tr class="kp-total"><td class="kp-l">Total</td>' +
      '<td>' + _usd(d.totals.proceeds) + '</td>' +
      '<td>' + _usd(d.totals.invested) + '</td>' +
      '<td>' + _usd(d.totals.loss) + '</td>' +
      '<td>' + _usd(d.totals.fee) + '</td></tr>';

    var suppsHtml;
    if (d.supps && d.supps.length) {
      suppsHtml = d.supps.map(function (sp) {
        return '<div class="kp-supp"><div class="kp-supp-head">' +
          '<span class="kp-supp-name">' + _esc(sp.name) + '</span>' +
          '<span class="kp-supp-ben">' + _usd(sp.realized) + ' benefit</span>' +
          '</div>' + _suppTable(sp.perYear) + '</div>';
      }).join('');
    } else {
      suppsHtml = '<p class="kp-none">No supplemental strategies funded for this plan.</p>';
    }

    return '<div class="kp-doc"><style>' + _styles() + '</style>' +
      '<div class="kp-head">' +
        '<p class="kp-brand">BrookHaven &middot; Strategy Key Points</p>' +
        '<h1>Strategy Key Points</h1>' +
        (d.client ? '<p class="kp-client">' + _esc(d.client) + '</p>' : '') +
        '<p class="kp-sub">' + _esc(d.sub) + '</p>' +
      '</div>' +
      '<div class="kp-body">' +
        '<div class="kp-sec"><h2>Selected Strategy</h2>' +
          '<div class="kp-strat"><span class="kp-strat-name">' + _esc(s.name) + '</span>' +
          stratPills.map(function (p) { return '<span class="kp-pill">' + p + '</span>'; }).join('') +
          '</div></div>' +
        '<div class="kp-sec"><h2>Year-by-Year Schedule</h2>' +
          '<table class="kp-tbl"><thead><tr>' +
          '<th class="kp-l">Year</th><th>Sale Proceeds</th><th>Capital Invested</th><th>Expected Loss</th><th>Fees</th>' +
          '</tr></thead><tbody>' + pyBody + pyTotal + '</tbody></table></div>' +
        '<div class="kp-sec"><h2>Projected Fees</h2>' +
          '<div class="kp-fees">' +
            '<div class="kp-fee"><p class="kp-fee-lbl">Brooklyn (AM)</p><p class="kp-fee-val">' + _usd(d.fees.brooklyn) + '</p></div>' +
            ((Number(d.fees.supp) || 0) > 0
              ? '<div class="kp-fee"><p class="kp-fee-lbl">Supplemental Strategies</p><p class="kp-fee-val">' + _usd(d.fees.supp) + '</p></div>'
              : '') +
            '<div class="kp-fee"><p class="kp-fee-lbl">Brookhaven</p><p class="kp-fee-val">' + _usd(d.fees.brookhaven) + '</p></div>' +
            '<div class="kp-fee"><p class="kp-fee-lbl">Total Fees</p><p class="kp-fee-val">' + _usd(d.fees.total) + '</p></div>' +
          '</div></div>' +
        '<div class="kp-sec"><h2>Supplemental Strategies</h2>' + suppsHtml + '</div>' +
        '<div class="kp-sec"><h2>Bottom Line</h2>' +
          '<div class="kp-bottom">' +
            '<div class="kp-bl kp-bl-net"><p class="kp-bl-lbl">Net Benefit</p><p class="kp-bl-val">' + _usd(d.net) + '</p></div>' +
            '<div class="kp-bl kp-bl-sav"><p class="kp-bl-lbl">Total Tax Saved</p><p class="kp-bl-val">' + _usd(d.savings) + '</p></div>' +
          '</div></div>' +
      '</div>' +
      '<div class="kp-foot">Prepared by BrookHaven for planning discussion. Figures are projections based on the inputs provided and current tax law; they are estimates, not a guarantee of results, and do not constitute tax or legal advice. Confirm with your CPA before acting.</div>' +
    '</div>';
  }

  function _fname(d) {
    var base = (d && d.client) ? d.client.replace(/[^\w]+/g, '-') : 'Strategy';
    return base + '-Key-Points.pdf';
  }

  // ---- export action: on-screen preview modal + reliable PDF download -----
  // The report MUST be rendered on-screen (visible, in the viewport) when
  // html2canvas captures it. A node parked off-screen at left:-99999px renders
  // a blank PDF in some browsers (the "totally blank" report). The modal also
  // doubles as the preview the advisor wanted ("shows us the info"), and the
  // Download button captures the visible node — reliable everywhere.
  function _kpEsc(e) { if (e.key === 'Escape') _closeKpModal(); }
  function _closeKpModal() {
    var ov = doc.getElementById('kp-modal-overlay');
    if (ov) ov.remove();
    doc.removeEventListener('keydown', _kpEsc, true);
  }

  function _kpDownload(el, d, btn) {
    if (!el) return;
    var opt = {
      margin: [8, 8, 8, 8],
      filename: _fname(d),
      image: { type: 'jpeg', quality: 0.98 },
      html2canvas: { scale: 2, useCORS: true, backgroundColor: '#ffffff' },
      jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
      pagebreak: { mode: ['css', 'legacy'] }
    };
    if (typeof root.html2pdf === 'function') {
      var prev = btn ? btn.textContent : '';
      var done = function () { if (btn) { btn.textContent = prev; btn.disabled = false; } };
      if (btn) { btn.textContent = 'Generating…'; btn.disabled = true; }
      try { root.html2pdf().set(opt).from(el).save().then(done, done); }
      catch (e) { done(); }
    } else {
      // Fallback (html2pdf missing): print just the report via a hidden iframe
      // — not a popup, so it can't be blocked. User picks "Save as PDF".
      try {
        var ifr = doc.createElement('iframe');
        ifr.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;';
        doc.body.appendChild(ifr);
        var idoc = ifr.contentWindow.document;
        idoc.open();
        idoc.write('<!doctype html><html><head><title>' + _esc(_fname(d).replace('.pdf', '')) +
          '</title></head><body style="margin:0">' + el.outerHTML + '</body></html>');
        idoc.close();
        setTimeout(function () {
          try { ifr.contentWindow.focus(); ifr.contentWindow.print(); } catch (e) {}
          setTimeout(function () { try { ifr.remove(); } catch (e) {} }, 1500);
        }, 300);
      } catch (e) {}
    }
  }

  function exportKeyPoints() {
    _closeKpModal();
    var d = buildKeyPointsData();

    var overlay = doc.createElement('div');
    overlay.id = 'kp-modal-overlay';
    overlay.style.cssText = 'position:fixed;inset:0;z-index:2147483600;background:rgba(15,23,42,.55);' +
      'display:flex;align-items:flex-start;justify-content:center;overflow:auto;padding:24px 16px;';
    overlay.addEventListener('click', function (e) { if (e.target === overlay) _closeKpModal(); });

    var panel = doc.createElement('div');
    panel.style.cssText = 'background:#fff;border-radius:8px;max-width:812px;width:100%;margin:auto;' +
      'box-shadow:0 12px 48px rgba(0,0,0,.35);overflow:hidden;';

    var bar = doc.createElement('div');
    bar.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:12px;' +
      'padding:11px 16px;border-bottom:1px solid #e6ebf3;background:#f7f9fc;';
    var title = doc.createElement('strong');
    title.style.cssText = 'font-family:Arial,Helvetica,sans-serif;font-size:13px;letter-spacing:.5px;color:#14233f;';
    title.textContent = 'Strategy Key Points';
    bar.appendChild(title);

    var actions = doc.createElement('div');
    var dl = null;
    if (d) {
      dl = doc.createElement('button');
      dl.type = 'button'; dl.className = 'cta-btn'; dl.textContent = 'Download PDF';
      dl.style.cssText = 'margin-right:8px;';
      actions.appendChild(dl);
    }
    var cl = doc.createElement('button');
    cl.type = 'button'; cl.className = 'cta-btn cta-btn-secondary'; cl.textContent = 'Close';
    cl.addEventListener('click', _closeKpModal);
    actions.appendChild(cl);
    bar.appendChild(actions);

    var body = doc.createElement('div');
    body.style.cssText = 'max-height:74vh;overflow:auto;padding:18px;background:#eef1f5;display:flex;justify-content:center;';
    if (d) {
      var sheet = doc.createElement('div');
      sheet.innerHTML = buildKeyPointsHTML(d);
      body.appendChild(sheet);
      dl.addEventListener('click', function () { _kpDownload(sheet.querySelector('.kp-doc'), d, dl); });
    } else {
      body.innerHTML = '<p style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#5b6573;' +
        'padding:28px;text-align:center;">Pick a strategy on the Projection tab first, then export.</p>';
    }

    panel.appendChild(bar);
    panel.appendChild(body);
    overlay.appendChild(panel);
    doc.body.appendChild(overlay);
    doc.addEventListener('keydown', _kpEsc, true);
  }

  // ---- admin-only button wiring -------------------------------------------
  // The buttons live in the print-cta-row on each source-of-truth tab, to the
  // LEFT of Print/Save-as-PDF. They start hidden and are shown only when
  // admin mode is unlocked (mirrors the ADMIN badge pattern).
  function _ensureButton(rowEl) {
    if (!rowEl) return null;
    var existing = rowEl.querySelector('.kp-export-btn');
    if (existing) return existing;
    var btn = doc.createElement('button');
    btn.type = 'button';
    btn.className = 'cta-btn cta-btn-secondary kp-export-btn';
    btn.hidden = true;
    btn.innerHTML = '📋 Export Key Points';
    btn.addEventListener('click', exportKeyPoints);
    // insert as the FIRST child so it sits left of the print button
    rowEl.insertBefore(btn, rowEl.firstChild);
    return btn;
  }

  // Tab 6 has a static .print-cta-row in index.html. Tab 7 has none, so we
  // create one inside its container.
  function _tab7Row() {
    var page = doc.getElementById('page-temp');
    if (!page) return null;
    var row = page.querySelector('.print-cta-row.kp-temp-row');
    if (row) return row;
    row = doc.createElement('div');
    row.className = 'print-cta-row no-print kp-temp-row';
    page.appendChild(row);
    return row;
  }

  function refreshKeyPointsButtons() {
    if (!doc) return;
    var isAdmin = !!root.__rettAdmin;
    var rows = [];
    var allocRow = doc.querySelector('#page-allocator .print-cta-row');
    if (allocRow) rows.push(allocRow);
    var tempRow = _tab7Row();
    if (tempRow) rows.push(tempRow);
    rows.forEach(function (r) {
      var btn = _ensureButton(r);
      if (btn) btn.hidden = !isAdmin;
    });
  }
  root.__rettRefreshKeyPointsButtons = refreshKeyPointsButtons;

  // Expose for testing / reuse.
  root.buildKeyPointsData = buildKeyPointsData;
  root.buildKeyPointsHTML = buildKeyPointsHTML;
  root.exportKeyPoints = exportKeyPoints;

  // Initial wiring once the DOM is ready, then keep visibility in sync on
  // every page show (showPage calls renderAdminMath; we piggyback via a
  // light interval-free hook: re-check on nav by exposing the refresher,
  // which admin unlock/lock + showPage call).
  if (doc) {
    if (doc.readyState === 'loading') {
      doc.addEventListener('DOMContentLoaded', refreshKeyPointsButtons);
    } else {
      refreshKeyPointsButtons();
    }
  }
})(window);
