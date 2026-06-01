// js/04-ui/admin-math-page-projection.js
//
// Admin math reveal panel - Tab 4 (Projection / page-projection).
//
// For each strategy, surfaces the auto-pick decision + per-year
// breakdown table the engine produced. Each row of the per-year
// table shows: gain recognized, Brooklyn loss generated, baseline tax,
// with-strategy tax, savings (delta), Brooklyn fee, Brookhaven fee.
// Totals row sums to the headline Net Benefit on the Page-3 cards.
(function (root) {
  'use strict';
  if (typeof root._registerPageMath !== 'function') return;

  function _esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  function _fmtUSD(n) {
    if (typeof root._fmt === 'function') return root._fmt(n);
    var v = Number(n);
    if (!isFinite(v)) return String(n);
    return (v < 0 ? '-' : '') + '$' + Math.round(Math.abs(v)).toLocaleString('en-US');
  }
  function _num(v) { var n = Number(v); return isFinite(n) ? n : 0; }

  // Same approach as Tab 3: read post-optimizer entries from
  // buildInterestedSummary so the headline net matches the card.
  // We ALSO call unifiedTaxComparison(...) to get the per-year engine
  // row breakdown. CRITICAL: we run the engine on the DIALED-BACK cfg
  // (entry._partialDeploy.deployed), NOT entry.cfg, so the per-year
  // and per-tranche numbers match what the optimizer actually chose.
  // Previously this called engine on full cfg and scaled fees by
  // optScale, which gave the right total by coincidence but wrong
  // per-year/per-tranche breakdowns (tier-jumping is non-linear in
  // capital — fee structure at $5M deployment is not just 0.61× the
  // fee structure at $3.05M deployment, the tranches live on different
  // Schwab combos). Tab 7 (temp-page-render.js) has used this dialed
  // path all along; this brings projection admin in line.
  function _strategyAnalysis(type) {
    if (typeof root.buildInterestedSummary !== 'function') {
      return { error: 'buildInterestedSummary unavailable' };
    }
    if (typeof root.unifiedTaxComparison !== 'function') {
      return { error: 'unifiedTaxComparison unavailable' };
    }
    var summary;
    try { summary = root.buildInterestedSummary(); }
    catch (e) { return { error: 'buildInterestedSummary threw: ' + (e.message || e) }; }
    if (!summary) return { error: 'no summary (no inputs?)' };
    var entry = (summary.entries || []).find(function (e) { return e.type === type; });
    if (!entry) return { error: 'no entry for ' + type };

    // Build the engine cfg at the DIALED-BACK deployment so per-year /
    // per-tranche rows reconcile to the card without post-scaling.
    var pd = entry._partialDeploy || null;
    var ecfg = entry.cfg;
    if (pd && Number.isFinite(Number(pd.deployed))) {
      var _dep = Math.max(0, Math.round(Number(pd.deployed)));
      if (_dep !== Math.round(Number(ecfg.availableCapital) || 0)) {
        ecfg = Object.assign({}, ecfg, {
          availableCapital: _dep, investment: _dep, investedCapital: _dep
        });
      }
    }
    if (typeof root.rettFlavorEngineCfg === 'function') {
      try { ecfg = root.rettFlavorEngineCfg(ecfg); } catch (e) { /* */ }
    }
    var cmp;
    try { cmp = root.unifiedTaxComparison(ecfg, { includeTrancheBreakdown: true }); }
    catch (e) { return { error: 'engine threw: ' + (e.message || e) }; }
    var m = entry.metrics || {};
    var _lossGen = 0, _lossApp = 0;
    (cmp.rows || []).forEach(function (r) { _lossGen += _num(r.lossGenerated); _lossApp += _num(r.lossApplied); });
    // Strategy A immediate path: card reads brooklynFees from
    // ProjectionEngine.run (actual-hold-period close), NOT from
    // unifiedTaxComparison.totalFees (annualized accrual). These
    // disagree by $30K+ on canonical scenarios. Pull the ProjectionEngine
    // per-year fees here so the admin tables can substitute them and
    // reconcile to the card.
    var projFees = null;
    if (type === 'A' && typeof ProjectionEngine !== 'undefined' && ProjectionEngine.run) {
      try {
        var flavoredCfg = (typeof root.rettFlavorEngineCfg === 'function')
          ? root.rettFlavorEngineCfg(entry.cfg) : entry.cfg;
        var proj = ProjectionEngine.run(flavoredCfg);
        if (proj && Array.isArray(proj.years)) {
          projFees = {
            byYear: {},
            total: (proj.totals && proj.totals.cumulativeFees) || 0
          };
          proj.years.forEach(function (y) { projFees.byYear[y.year] = _num(y.fee); });
        }
      } catch (e) { projFees = null; }
    }
    // Cover-taxes set-aside at the ACTUAL (dialed-back) deployment, so the
    // displayed figure matches the chosen plan. B/C: total cash held back
    // from the January installments to pay the sale tax (not invested). A:
    // the Y0 sale tax shown for planning (A deploys in full, no Y1 sale).
    var _coverSetAside = 0, _coverSaleTaxY0 = 0;
    if (entry.cfg && entry.cfg.coverTaxesFromSale) {
      try {
        var _dCap = pd ? _num(pd.deployed) : _num(entry.cfg.availableCapital);
        var _dCfg = Object.assign({}, entry.cfg, { availableCapital: _dCap, investment: _dCap, investedCapital: _dCap });
        var _dCmp = root.unifiedTaxComparison(_dCfg);
        _coverSetAside = _num(_dCmp.totalTaxSetAside);
        _coverSaleTaxY0 = _num(_dCmp.coverTaxSaleTaxY0);
      } catch (e) { /* */ }
    }
    return {
      type: type,
      picked: entry.picked || {},
      cfg: entry.cfg || {},
      cmp: cmp,
      projFees: projFees,
      coverSetAside:   _coverSetAside,
      coverSaleTaxY0:  _coverSaleTaxY0,
      optScale: entry._optScale != null ? entry._optScale : 1,
      _opt: entry._opt || null,
      partialScale:    pd ? _num(pd.scale) : 1,
      deployedCap:     pd ? _num(pd.deployed)  : _num((entry.cfg || {}).availableCapital),
      availCap:        pd ? _num(pd.available) : _num((entry.cfg || {}).availableCapital),
      lossGenFull:     _lossGen,
      lossAppliedFull: _lossApp,
      wastedFull:      Math.max(0, _lossGen - _lossApp),
      // Post-optimizer headline values (match Page 3 cards):
      cardSavings: _num(m.savings != null ? m.savings : m._savingsAtFull),
      cardBrooklynFees: _num(m.brooklynFees),
      cardBrookhavenFees: _num(m.brookhavenFees),
      cardNet: _num(m.net),
      // Excess-loss fee credit (Strategy C only): when Brooklyn
      // generates >$10K of carryover loss that can't be absorbed,
      // the AM fee on that excess is refunded into net. Already
      // baked into m.brooklynFees / m.net by projection-dashboard-
      // render.js. Surfacing here as an explicit line so the admin
      // reconciliation doesn't show a phantom $14K gap between
      // "savings − fees" and "NET BENEFIT (on card)".
      excessLossFeeCredit: _num(m._excessLossFeeCredit || 0)
    };
  }

  function _autoPickRow(label, value, note) {
    return '<tr><td>' + _esc(label) + '</td>' +
      '<td class="admin-math-num">' + (value == null ? '—' : value) + '</td>' +
      (note ? '<td class="admin-math-note-cell">' + note + '</td>' : '<td></td>') + '</tr>';
  }

  function _perYearTable(cmp, projFees, optScale, excessLossFeeCredit) {
    var rows = cmp.rows || [];
    if (!rows.length) return '<p class="admin-math-empty">No per-year rows from engine.</p>';
    var scale = (typeof optScale === 'number' && isFinite(optScale)) ? optScale : 1;
    var totS = 0, totF = 0, totFH = 0, totL = 0, totG = 0, totR = 0, totWd = 0;
    var cumL = 0, cumS = 0, cumFAll = 0;
    var prevCumInv = 0;
    var html =
      '<div class="admin-math-scroll">' +
      '<table class="admin-math-table admin-math-table-wide">' +
        '<thead><tr>' +
          '<th>Year</th>' +
          '<th class="admin-math-num">Gain Recog.</th>' +
          '<th class="admin-math-num">Brk New Deposit</th>' +
          '<th class="admin-math-num">Brk Withdrawn</th>' +
          '<th class="admin-math-num">Brk Invested (Cum.)</th>' +
          '<th class="admin-math-num">Brk ST Loss</th>' +
          '<th class="admin-math-num">Cum. Loss</th>' +
          '<th class="admin-math-num">Baseline Tax</th>' +
          '<th class="admin-math-num">With-Strat Tax</th>' +
          '<th class="admin-math-num">Savings</th>' +
          '<th class="admin-math-num">Cum. Savings</th>' +
          '<th class="admin-math-num">Brk Fee</th>' +
          '<th class="admin-math-num">BH Fee</th>' +
          '<th class="admin-math-num">Cum. Net</th>' +
        '</tr></thead><tbody>';
    rows.forEach(function (r) {
      var g = _num(r.gainRecognized);
      var newDep = _num(r.reinvestedThisYear);
      var cumInv = _num(r.investmentThisYear);
      // Implicit withdrawals: when a tranche hits its maxAgeInclusive
      // (cover-taxes Y0-only tax-reserve tranche on Apr 1 of Y1, or
      // basis tranche under _y0OnlyDegeneracy), engine drops its capital
      // from investmentThisYear. Surface explicitly: withdrawn =
      // max(0, prev + newDep - cur).
      var withdrawn = Math.max(0, prevCumInv + newDep - cumInv);
      prevCumInv = cumInv;
      var l = _num(r.lossGenerated);
      var b = _num(r.doNothingBaseline && r.doNothingBaseline.total);
      var w = _num(r.withStrategy && r.withStrategy.total);
      var s = b - w;
      // Strategy A: substitute the ProjectionEngine per-year fee (the
      // value the card actually uses) for unifiedTaxComparison's
      // annualized accrual. Without this the per-year fee column shows
      // $84,815 while the card reads $54,733 — same scenario, two
      // different engines, a $30K phantom gap that looked like a bug.
      // B/C: r.fee is already at the dialed-back deployment (engine
      // was called with pd.deployed), so no post-scaling needed. The
      // legacy `_num(r.fee) * scale` pattern was an attempt to scale
      // FULL-cfg fees down, but tier-jumping makes that non-linear
      // and produced bogus per-year fees. Use engine truth directly.
      var f = (projFees && projFees.byYear && projFees.byYear[r.year] != null)
        ? _num(projFees.byYear[r.year])
        : _num(r.fee);
      var fh = _num(r.brookhavenFee);
      totG += g; totL += l; totS += s; totF += f; totFH += fh; totR += newDep; totWd += withdrawn;
      cumL += l; cumS += s; cumFAll += (f + fh);
      var cumNet = cumS - cumFAll;
      var wdCellClass = 'admin-math-num' + (withdrawn > 0 ? ' admin-math-withdrawn' : '');
      var wdCellDisplay = withdrawn > 0 ? ('&minus;' + _fmtUSD(withdrawn)) : _fmtUSD(0);
      html +=
        '<tr>' +
          '<td>' + _esc(r.year) + '</td>' +
          '<td class="admin-math-num">' + _fmtUSD(g) + '</td>' +
          '<td class="admin-math-num">' + _fmtUSD(newDep) + '</td>' +
          '<td class="' + wdCellClass + '">' + wdCellDisplay + '</td>' +
          '<td class="admin-math-num"><strong>' + _fmtUSD(cumInv) + '</strong></td>' +
          '<td class="admin-math-num">' + _fmtUSD(l) + '</td>' +
          '<td class="admin-math-num">' + _fmtUSD(cumL) + '</td>' +
          '<td class="admin-math-num">' + _fmtUSD(b) + '</td>' +
          '<td class="admin-math-num">' + _fmtUSD(w) + '</td>' +
          '<td class="admin-math-num">' + _fmtUSD(s) + '</td>' +
          '<td class="admin-math-num">' + _fmtUSD(cumS) + '</td>' +
          '<td class="admin-math-num">' + _fmtUSD(f) + '</td>' +
          '<td class="admin-math-num">' + _fmtUSD(fh) + '</td>' +
          '<td class="admin-math-num"><strong>' + _fmtUSD(cumNet) + '</strong></td>' +
        '</tr>';
    });
    var net = totS - totF - totFH;
    html +=
      '<tr class="admin-math-subtotal">' +
        '<td><strong>Totals</strong></td>' +
        '<td class="admin-math-num"><strong>' + _fmtUSD(totG) + '</strong></td>' +
        '<td class="admin-math-num"><strong>' + _fmtUSD(totR) + '</strong></td>' +
        '<td class="admin-math-num">' + (totWd > 0 ? '<strong>&minus;' + _fmtUSD(totWd) + '</strong>' : _fmtUSD(0)) + '</td>' +
        '<td class="admin-math-num">—</td>' +
        '<td class="admin-math-num"><strong>' + _fmtUSD(totL) + '</strong></td>' +
        '<td class="admin-math-num">—</td>' +
        '<td class="admin-math-num">—</td>' +
        '<td class="admin-math-num">—</td>' +
        '<td class="admin-math-num"><strong>' + _fmtUSD(totS) + '</strong></td>' +
        '<td class="admin-math-num">—</td>' +
        '<td class="admin-math-num"><strong>' + _fmtUSD(totF) + '</strong></td>' +
        '<td class="admin-math-num"><strong>' + _fmtUSD(totFH) + '</strong></td>' +
        '<td class="admin-math-num"><strong>' + _fmtUSD(net) + '</strong></td>' +
      '</tr>' +
      '<tr class="admin-math-total">' +
        '<td colspan="13"><strong>Raw engine net</strong> &mdash; sum of per-year (savings &minus; fees)' +
          (excessLossFeeCredit > 0 ? ', before excess-loss credit' : '') +
        '</td>' +
        '<td class="admin-math-num"><strong>' + _fmtUSD(net) + '</strong></td>' +
      '</tr>';
    if (excessLossFeeCredit > 0) {
      html +=
        '<tr class="admin-math-total">' +
          '<td colspan="13">+ Excess-loss fee credit (Strategy C: refunds AM fee on residual unused short-term loss &gt; $10K)</td>' +
          '<td class="admin-math-num"><strong>+' + _fmtUSD(excessLossFeeCredit) + '</strong></td>' +
        '</tr>' +
        '<tr class="admin-math-total">' +
          '<td colspan="13"><strong>Reconciles to NET BENEFIT on card</strong></td>' +
          '<td class="admin-math-num"><strong>' + _fmtUSD(net + excessLossFeeCredit) + '</strong></td>' +
        '</tr>';
    }
    html += '</tbody></table>' +
      '</div>';
    return html;
  }

  // Per-tranche breakdown: for each tranche (Y0 basis, [Y0 tax-reserve if
  // cover-taxes is on], each Y1+ reinvest), show year-by-year loss + fee
  // contribution. Lets a CPA see "tranche 1 at age 0 produced X loss, at
  // age 1 produced Y loss" etc. Engine populates r.trancheBreakdown when
  // opts.includeTrancheBreakdown is set (admin path opts in).
  function _perTrancheTable(cmp, projFees, optScale) {
    var rows = cmp.rows || [];
    if (!rows.length) return '';
    // A: ratio-scale tranche fees to projFees.total (single-tranche
    //    single-year so it's a straight substitution; kept as ratio
    //    for safety).
    // B/C: NO scaling — cmp was already run at the dialed deployment
    //    (see _strategyAnalysis), so tranche fees are already correct.
    var feeScale = 1;
    if (projFees && projFees.total != null) {
      var unifiedFeeTotal = 0;
      rows.forEach(function (r) { unifiedFeeTotal += _num(r.fee); });
      if (unifiedFeeTotal > 0) feeScale = projFees.total / unifiedFeeTotal;
    }
    // Pivot: collect all tranches across all years, keyed by trancheIdx.
    var trancheMap = {};
    var orderedKeys = [];
    rows.forEach(function (r) {
      var br = r.trancheBreakdown || [];
      br.forEach(function (tr) {
        var key = tr.trancheIdx + '|' + tr.openYear;
        if (!(key in trancheMap)) {
          trancheMap[key] = {
            trancheIdx:  tr.trancheIdx,
            openYear:    tr.openYear,
            capital:     tr.capital,
            comboId:     tr.comboId,
            isTaxReserve: tr.isTaxReserve,
            perYear:     {} // year -> { loss, fee, age, lossRate, feeRate, yf }
          };
          orderedKeys.push(key);
        }
        trancheMap[key].perYear[r.year] = {
          age: tr.age, loss: tr.loss, fee: tr.fee * feeScale,
          lossRate: tr.lossRate, feeRate: tr.feeRate, yf: tr.yf
        };
      });
    });
    if (!orderedKeys.length) {
      return '<p class="admin-math-empty">No tranches deployed (Strategy B basisCash=0 or below-min lifecycle).</p>';
    }
    var years = rows.map(function (r) { return r.year; });
    var html =
      '<div class="admin-math-scroll">' +
      '<table class="admin-math-table admin-math-table-wide">' +
        '<thead><tr>' +
          '<th>Tranche</th>' +
          '<th>Opened</th>' +
          '<th class="admin-math-num">Capital</th>' +
          '<th>Combo</th>';
    years.forEach(function (y) {
      html += '<th class="admin-math-num">' + _esc(y) + ' Loss</th>' +
              '<th class="admin-math-num">' + _esc(y) + ' Fee</th>';
    });
    html += '<th class="admin-math-num">Cum. Loss</th><th class="admin-math-num">Cum. Fee</th>' +
      '</tr></thead><tbody>';
    var grandLoss = 0, grandFee = 0;
    orderedKeys.forEach(function (key, idx) {
      var t = trancheMap[key];
      var combo = (t.comboId && typeof root.getSchwabCombo === 'function')
        ? root.getSchwabCombo(t.comboId) : null;
      var comboLabel = combo ? combo.leverageLabel : (t.comboId || '—');
      var label = (idx === 0 ? 'Y0 basis' : 't' + (idx + 1));
      if (t.isTaxReserve) label = 'Tax reserve (Y0-only)';
      var cumL = 0, cumF = 0;
      var cells = '';
      years.forEach(function (y) {
        var yd = t.perYear[y];
        if (yd) {
          cumL += yd.loss; cumF += yd.fee;
          var lossNote = '@ ' + (yd.lossRate * 100).toFixed(1) + '%' +
            (yd.yf < 1 ? ' × yf=' + yd.yf.toFixed(2) : '') +
            ' (age ' + yd.age + ')';
          cells += '<td class="admin-math-num" title="' + _esc(lossNote) + '">' + _fmtUSD(yd.loss) + '</td>';
          cells += '<td class="admin-math-num">' + _fmtUSD(yd.fee) + '</td>';
        } else {
          cells += '<td class="admin-math-num">—</td><td class="admin-math-num">—</td>';
        }
      });
      grandLoss += cumL; grandFee += cumF;
      html +=
        '<tr>' +
          '<td><strong>' + _esc(label) + '</strong></td>' +
          '<td>' + _esc(t.openYear) + '</td>' +
          '<td class="admin-math-num">' + _fmtUSD(t.capital) + '</td>' +
          '<td>' + _esc(comboLabel) + '</td>' +
          cells +
          '<td class="admin-math-num"><strong>' + _fmtUSD(cumL) + '</strong></td>' +
          '<td class="admin-math-num"><strong>' + _fmtUSD(cumF) + '</strong></td>' +
        '</tr>';
    });
    // Totals
    html += '<tr class="admin-math-subtotal"><td colspan="4"><strong>All tranches</strong></td>';
    years.forEach(function (y) {
      var yLoss = 0, yFee = 0;
      orderedKeys.forEach(function (key) {
        var yd = trancheMap[key].perYear[y];
        if (yd) { yLoss += yd.loss; yFee += yd.fee; }
      });
      html += '<td class="admin-math-num"><strong>' + _fmtUSD(yLoss) + '</strong></td>' +
              '<td class="admin-math-num"><strong>' + _fmtUSD(yFee) + '</strong></td>';
    });
    html += '<td class="admin-math-num"><strong>' + _fmtUSD(grandLoss) + '</strong></td>' +
            '<td class="admin-math-num"><strong>' + _fmtUSD(grandFee) + '</strong></td></tr>';
    html += '</tbody></table></div>';
    return html;
  }

  // Brookhaven fee schedule per-year breakdown (setup + quarterly + total).
  function _brookhavenTable(cmp) {
    var rows = cmp.rows || [];
    if (!rows.length) return '';
    var html =
      '<table class="admin-math-table">' +
        '<thead><tr>' +
          '<th>Year</th>' +
          '<th class="admin-math-num">Setup</th>' +
          '<th class="admin-math-num">Quarterly</th>' +
          '<th class="admin-math-num">Annual Total</th>' +
          '<th class="admin-math-num">Cum. Total</th>' +
        '</tr></thead><tbody>';
    var cum = 0, totSetup = 0, totQ = 0, totT = 0;
    rows.forEach(function (r) {
      var setup = _num(r.brookhavenSetupFee);
      var q = _num(r.brookhavenQuarterlyFee);
      var t = _num(r.brookhavenFee);
      cum += t; totSetup += setup; totQ += q; totT += t;
      html +=
        '<tr>' +
          '<td>' + _esc(r.year) + '</td>' +
          '<td class="admin-math-num">' + _fmtUSD(setup) + '</td>' +
          '<td class="admin-math-num">' + _fmtUSD(q) + '</td>' +
          '<td class="admin-math-num">' + _fmtUSD(t) + '</td>' +
          '<td class="admin-math-num"><strong>' + _fmtUSD(cum) + '</strong></td>' +
        '</tr>';
    });
    html +=
      '<tr class="admin-math-subtotal">' +
        '<td><strong>Totals</strong></td>' +
        '<td class="admin-math-num"><strong>' + _fmtUSD(totSetup) + '</strong></td>' +
        '<td class="admin-math-num"><strong>' + _fmtUSD(totQ) + '</strong></td>' +
        '<td class="admin-math-num"><strong>' + _fmtUSD(totT) + '</strong></td>' +
        '<td class="admin-math-num"><strong>' + _fmtUSD(cum) + '</strong></td>' +
      '</tr>' +
      '</tbody></table>';
    return html;
  }

  // Partial-investment callout: surfaces the optimizer's "don't invest all"
  // decision — how much it deployed vs available, and the full-deployment
  // loss it would have WASTED (carried forward past the projection, pure
  // fees). Reads the _partialDeploy breadcrumb + the at-full loss waste.
  function _deploymentCallout(a) {
    var avail = _num(a.availCap), deployed = _num(a.deployedCap);
    var leftover = Math.max(0, avail - deployed);
    if (leftover < 1000) return '';        // deployed essentially all → nothing to explain
    var pct = avail > 0 ? (deployed / avail * 100).toFixed(1) : '100';
    var wasteLine = a.wastedFull > 1000
      ? ' At full $' + Math.round(avail).toLocaleString('en-US') +
        ', Brooklyn would generate ' + _fmtUSD(a.lossGenFull) + ' of loss but only ' +
        _fmtUSD(a.lossAppliedFull) + ' is usable — the other ' + _fmtUSD(a.wastedFull) +
        ' carries forward unused (past the projection window), so the extra capital is pure fees.'
      : '';
    return '<div class="admin-math-callout">' +
      '<strong>Partial investment: ' + _fmtUSD(deployed) + ' of ' + _fmtUSD(avail) +
      ' deployed (' + pct + '%).</strong> ' +
      'The optimizer held back the remaining ' + _fmtUSD(leftover) +
      ' because deploying it would not raise net benefit.' + wasteLine +
      '</div>';
  }

  function _strategySection(letter, name, analysis) {
    if (analysis.error) {
      return '<div class="admin-math-section">' +
        '<h4>Strategy ' + letter + ' &mdash; ' + _esc(name) + '</h4>' +
        '<p class="admin-math-error">' + _esc(analysis.error) + '</p>' +
      '</div>';
    }
    var p = analysis.picked, cfg = analysis.cfg, cmp = analysis.cmp;
    var lockupHint;
    if (letter === 'A') lockupHint = 'Y0 lump-sum';
    else if (letter === 'B') {
      var bN = (p.bestRecC | 0);
      lockupHint = bN + ' yearly Jan-1 payment' + (bN === 1 ? '' : 's');
      // §453 weight split (advisor 2026-05-27): when N>1, show the
      // auto-picked weight allocation. Sums to ~100%; if equal split
      // would have been chosen the row shows '1/N each'.
      if (bN > 1) {
        var weights = (cfg && Array.isArray(cfg.installmentScheduleWeights)) ? cfg.installmentScheduleWeights : null;
        if (weights && weights.length === bN) {
          lockupHint += ' &mdash; split ' + weights.map(function (w) {
            return Math.round(w * 100) + '%';
          }).join(' / ');
        } else {
          lockupHint += ' &mdash; equal split (' + Math.round(100 / bN) + '% each)';
        }
      }
    }
    else lockupHint = (p.durationMonths || 36) + 'mo structured-sale (40/40/20 over 3 yrs)';
    var scalePct = (analysis.optScale * 100).toFixed(0) + '%';
    var scaleNote = analysis.optScale < 1
      ? 'Optimizer dialed back to ' + scalePct + ' of available - reduces fees'
      : 'Full deployment (no dial-back)';
    // Resolve the EFFECTIVE operating tier, not the auto-pick ceiling
    // (sweep finding #2): when the actual deployment never reaches a higher
    // combo's minimum, the engine runs at the lower tier — so show that
    // tier (and its real loss/fee rates), not the ceiling the sweep tagged.
    var _ceilingCombo = (p.comboId && typeof root.getSchwabCombo === 'function')
      ? root.getSchwabCombo(p.comboId) : null;
    var _deployedCap = _num(analysis.deployedCap);
    var _effComboId = (typeof root._rettEffectiveComboId === 'function')
      ? root._rettEffectiveComboId(p.comboId, _deployedCap) : p.comboId;
    var combo = (_effComboId && typeof root.getSchwabCombo === 'function')
      ? root.getSchwabCombo(_effComboId) : _ceilingCombo;
    // Tier-migration label from the actual per-tranche combos: when early
    // tranches open under a lower combo and later ones ratchet up, show
    // "145/45 → 200/100" instead of just the ceiling/effective tier.
    var _migLev = (combo && typeof root._comboMigrationFromCmp === 'function')
      ? root._comboMigrationFromCmp(analysis.cmp, combo.leverageLabel)
      : (combo ? combo.leverageLabel : null);
    var _isMig = !!(combo && _migLev && _migLev.indexOf('→') !== -1);
    var comboLabel = combo ? (_migLev + ' (' + combo.strategyLabel + ')') : (p.comboId || '—');
    var _comboNote = _isMig
      ? 'Tranches ratchet up as cumulative deposits cross each combo minimum ($1M &rarr; 145/45, $3M &rarr; 200/100)'
      : (_ceilingCombo && combo && _ceilingCombo.id !== combo.id)
        ? 'Operating tier — deployment (' + _fmtUSD(_deployedCap) + ') stays below the ' +
          _ceilingCombo.leverageLabel + ' minimum, so it runs at ' + combo.leverageLabel
        : 'Best-net combo from the auto-pick sweep across leverage tiers';
    var y0LossRate = combo && combo.lossByYear ? combo.lossByYear[0] : null;
    var lossRateRow = y0LossRate != null
      ? _autoPickRow('Loss rate (Y0)', (y0LossRate * 100).toFixed(1) + '%',
                     'First-year loss/$ ratio under ' + comboLabel + ' - decays each subsequent year (see per-year table for actuals)')
      : _autoPickRow('Loss rate (Y0)', '—', null);
    var _comboFeeRate = (combo && typeof root.brooklynFeeRateFor === 'function')
      ? (root.brooklynFeeRateFor(combo.longPct, combo.shortPct) || 0)
      : 0;
    var feeRateRow = combo
      ? _autoPickRow('Brooklyn fee rate', (_comboFeeRate * 100).toFixed(2) + '%',
                     'Per-year fee on deployed capital under ' + comboLabel)
      : _autoPickRow('Brooklyn fee rate', '—', null);
    var pickRows = [
      _autoPickRow('Brooklyn combo',     comboLabel, _comboNote),
      _autoPickRow('Horizon',            p.horizon + ' year' + (p.horizon === 1 ? '' : 's'), null),
      _autoPickRow('Recognition shape',  lockupHint, null),
      _autoPickRow('Optimizer scale',    scalePct, scaleNote),
      lossRateRow,
      feeRateRow,
      _autoPickRow('Cover taxes',        cfg.coverTaxesFromSale ? 'Yes' : 'No',
                                         !cfg.coverTaxesFromSale ? null
                                           : (letter === 'A'
                                               ? 'Est. sale tax ' + _fmtUSD(analysis.coverSaleTaxY0) + ' — shown for planning; A is Y0-only, no Y1 sale modeled'
                                               : _fmtUSD(analysis.coverSetAside) + ' set aside from the January installments to pay the sale tax — NOT invested in Brooklyn')),
      _autoPickRow('Available capital',  _fmtUSD(_num(cfg.availableCapital)),
                                         'Total Brooklyn investment commitment'),
      _autoPickRow('Deployed (optimizer)', _fmtUSD(_num(analysis.deployedCap)),
                                         analysis.partialScale < 0.999
                                           ? 'PARTIAL — ' + (analysis.partialScale * 100).toFixed(0) + '% of available; the rest would only add fees (see callout)'
                                           : 'Full deployment (no waste to dial back)')
    ];
    // Forced Y0 payment (personal-use + amount-owed carved off at
    // closing). For deferred strategies (B/C) this cash is received in
    // year zero, so it pulls F × gross-profit-ratio of LT gain forward
    // into the Y0 row of the per-year table below (and is NOT deployed
    // to Brooklyn). Strategy A already recognizes everything Y0, so
    // there it only shrinks available capital.
    var _forced = _num(cfg.forcedY0Payment);
    if (_forced > 0) {
      var _recapF    = Math.max(0, _num(cfg.acceleratedDepreciation));
      var _ltGF      = Math.max(0, _num(cfg.salePrice) - _num(cfg.costBasis) - _recapF - _num(cfg.shortTermPropertyGain));
      var _contractF = Math.max(0, _num(cfg.salePrice) - _recapF);
      var _gpF       = _contractF > 0 ? _ltGF / _contractF : 0;
      var _forcedGainF = _forced * _gpF;
      pickRows.push(_autoPickRow('Forced Y0 payment', _fmtUSD(_forced),
        letter === 'A'
          ? 'Personal-use + amount-owed carved off proceeds at closing. Strategy A recognizes all gain Y0 anyway, so this only reduces available capital — no extra recognition.'
          : 'Personal-use + amount-owed carved off at closing. Received Y0 &rarr; recognizes ' +
            _fmtUSD(_forcedGainF) + ' of LT gain in year zero (F &times; gross-profit-ratio ' +
            (_gpF * 100).toFixed(1) + '%). Pulled forward out of the deferral schedule (included in the Y0 Gain Recog. row below). NOT deployed to Brooklyn.'));
    }
    // Build card-values block. Strategy C may have an excess-loss fee
    // credit baked into cardBrooklynFees + cardNet; surface it so the
    // CPA can see the arithmetic close: savings − net fees − BH = card net.
    var _excessCredit = analysis.excessLossFeeCredit || 0;
    var _grossBrkFees = analysis.cardBrooklynFees + _excessCredit;  // pre-credit
    var cardSummaryRows = '';
    cardSummaryRows += '<tr><td>Gross tax savings</td><td class="admin-math-num">' + _fmtUSD(analysis.cardSavings) + '</td><td class="admin-math-note-cell">post-optimizer</td></tr>';
    if (_excessCredit > 0) {
      cardSummaryRows += '<tr><td>Brooklyn fees (gross)</td><td class="admin-math-num">' + _fmtUSD(_grossBrkFees) + '</td><td class="admin-math-note-cell">at deployed capital</td></tr>';
      cardSummaryRows += '<tr><td>&nbsp;&nbsp;Excess-loss fee credit</td><td class="admin-math-num">&minus;' + _fmtUSD(_excessCredit) + '</td><td class="admin-math-note-cell">Strategy C: AM fee refunded on residual unused short-term loss (&gt;$10K)</td></tr>';
      cardSummaryRows += '<tr><td>Brooklyn fees (net of credit)</td><td class="admin-math-num">' + _fmtUSD(analysis.cardBrooklynFees) + '</td><td class="admin-math-note-cell">used in NET BENEFIT below</td></tr>';
    } else {
      cardSummaryRows += '<tr><td>Brooklyn fees</td><td class="admin-math-num">' + _fmtUSD(analysis.cardBrooklynFees) + '</td><td class="admin-math-note-cell">post-optimizer</td></tr>';
    }
    cardSummaryRows += '<tr><td>Brookhaven fees</td><td class="admin-math-num">' + _fmtUSD(analysis.cardBrookhavenFees) + '</td><td></td></tr>';
    cardSummaryRows += '<tr class="admin-math-total"><td><strong>NET BENEFIT (on card)</strong></td><td class="admin-math-num"><strong>' + _fmtUSD(analysis.cardNet) + '</strong></td><td class="admin-math-note-cell">savings − net fees</td></tr>';
    var cardSummary =
      '<p class="admin-math-subtitle" style="margin-top:10px;">Page 3 card values (post-optimizer):</p>' +
      '<table class="admin-math-table">' +
        '<tbody>' + cardSummaryRows + '</tbody>' +
      '</table>';
    return '<div class="admin-math-section">' +
      '<h4>Strategy ' + letter + ' &mdash; ' + _esc(name) + ' &mdash; ' + _esc(comboLabel) + '</h4>' +
      '<table class="admin-math-table">' +
        '<thead><tr><th>Auto-pick</th><th class="admin-math-num">Value</th><th>Note</th></tr></thead>' +
        '<tbody>' + pickRows.join('') + '</tbody>' +
      '</table>' +
      cardSummary +
      _deploymentCallout(analysis) +
      '<p class="admin-math-subtitle" style="margin-top:10px;">Per-year engine output (Brooklyn fee reconciled to card; other columns are raw engine pre-optimizer):</p>' +
      _perYearTable(cmp, analysis.projFees, analysis.optScale, analysis.excessLossFeeCredit) +
      '<p class="admin-math-subtitle" style="margin-top:10px;">Per-tranche breakdown (each Brooklyn deposit aged through every year):</p>' +
      _perTrancheTable(cmp, analysis.projFees, analysis.optScale) +
      '<p class="admin-math-subtitle" style="margin-top:10px;">Brookhaven planning fee schedule (setup + quarterly accrual):</p>' +
      _brookhavenTable(cmp) +
    '</div>';
  }

  function _renderProjection() {
    return _strategySection('A', 'Traditional Sale',             _strategyAnalysis('A'))
         + _strategySection('B', 'Installment Sale (§453)',       _strategyAnalysis('B'))
         + _strategySection('C', 'Structured Installment Sale',   _strategyAnalysis('C'));
  }

  root._registerPageMath('page-projection', _renderProjection);
})(window);
