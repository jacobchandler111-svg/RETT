// js/04-ui/admin-math-page-strategies.js
//
// Admin math reveal panel - Tab 3 (Strategies / page-strategies).
//
// Surfaces the auto-pick result for each strategy (A/B/C), the math
// summary (Brooklyn deployment, loss generated, gain offset, savings,
// fees, net benefit), and the card visibility decision (why each card
// is shown or hidden). Read-only - calls _autoPickSection +
// unifiedTaxComparison + the existing card-visibility logic. No engine
// mutation.
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
  function _fmtPct(x, dp) {
    var d = dp == null ? 1 : dp;
    var v = Number(x);
    if (!isFinite(v)) return '—';
    return (v * 100).toFixed(d) + '%';
  }
  function _num(v) { var n = Number(v); return isFinite(n) ? n : 0; }

  function _row(label, value, note) {
    return '<tr><td>' + _esc(label) + '</td>' +
      '<td class="admin-math-num">' + (value == null ? '—' : value) + '</td>' +
      (note ? '<td class="admin-math-note-cell">' + note + '</td>' : '<td></td>') + '</tr>';
  }

  // Run the same _autoPickSection + unifiedTaxComparison the dashboard
  // uses, then surface the chosen combo + horizon + per-year totals.
  function _strategyAnalysis(type, baseCfg) {
    if (typeof root._autoPickSection !== 'function') return { error: '_autoPickSection unavailable' };
    if (typeof root.unifiedTaxComparison !== 'function') return { error: 'unifiedTaxComparison unavailable' };
    var picked;
    try { picked = root._autoPickSection(type, baseCfg); }
    catch (e) { return { error: 'auto-pick threw: ' + (e.message || e) }; }
    if (!picked) return { error: 'no auto-pick result' };

    // Build the strategy cfg the same way projection-dashboard-render does.
    var sectionCfg = Object.assign({}, baseCfg, {
      horizonYears: picked.horizon,
      leverage:     picked.shortPct / 100,
      leverageCap:  picked.shortPct / 100,
      comboId:      picked.comboId
    });
    // _scenarioCfgFor expects (type, currentCfg, bestRecC, userDuration).
    var typedCfg;
    if (typeof root._scenarioCfgFor === 'function') {
      typedCfg = root._scenarioCfgFor(type, sectionCfg, picked.bestRecC, picked.durationMonths);
    } else {
      typedCfg = sectionCfg;
    }
    var cmp;
    try { cmp = root.unifiedTaxComparison(typedCfg); }
    catch (e) { return { error: 'unifiedTaxComparison threw: ' + (e.message || e) }; }

    var totalLoss = (cmp.rows || []).reduce(function (s, r) { return s + (_num(r.lossGenerated) || 0); }, 0);
    var totalRecognized = (cmp.recognitionSchedule || []).reduce(function (s, r) { return s + _num(r.gainRecognized); }, 0);
    var totalRecap = _num(typedCfg.acceleratedDepreciation);
    return {
      picked: picked,
      cfg: typedCfg,
      cmp: cmp,
      totalLoss: totalLoss,
      totalRecognized: totalRecognized,
      totalRecap: totalRecap,
      net: _num(cmp.totalSavings) - _num(cmp.totalAllFees)
    };
  }

  // Card visibility decision per controls.js _refreshCard3Visibility.
  function _cardVisibilityDecision(netA, netB, netC, defaultRiskYes) {
    var card1Visible = (netA > 0);
    var card2Visible = defaultRiskYes || ((netB > 0) && (netB > netA));
    var card3Visible = defaultRiskYes || (card2Visible && (netC > 0) && (netC > netB));
    function explain(letter, visible, net, comparedTo) {
      if (defaultRiskYes && (letter === 'B' || letter === 'C')) {
        return 'Visible (default-risk = Yes forces showing)';
      }
      if (net <= 0) return 'HIDDEN (net &le; $0)';
      if (letter === 'A') return 'Visible (net > $0)';
      if (letter === 'B') return visible
        ? 'Visible (net > $0 AND net &gt; Strategy A)'
        : 'HIDDEN (' + _fmtUSD(net) + ' not greater than Strategy A ' + _fmtUSD(comparedTo) + ')';
      if (letter === 'C') {
        if (!card2Visible) return 'HIDDEN (Card 2 hidden so Card 3 hides too)';
        return visible
          ? 'Visible (net > $0 AND net &gt; Strategy B)'
          : 'HIDDEN (' + _fmtUSD(net) + ' not greater than Strategy B ' + _fmtUSD(comparedTo) + ')';
      }
      return '';
    }
    return [
      _row('Strategy A (Normal Sale)',                _fmtUSD(netA), explain('A', card1Visible, netA, null)),
      _row('Strategy B (Installment Sale)',           _fmtUSD(netB), explain('B', card2Visible, netB, netA)),
      _row('Strategy C (Structured Installment Sale)', _fmtUSD(netC), explain('C', card3Visible, netC, netB)),
      _row('Default-risk toggle', defaultRiskYes ? 'Yes' : 'No', defaultRiskYes ? 'Forces Cards 2 + 3 visible regardless of math' : 'Cards 2/3 hide if not strictly better than prior')
    ];
  }

  function _strategySection(letter, name, analysis) {
    if (analysis.error) {
      return '<div class="admin-math-section">' +
        '<h4>Strategy ' + letter + ' &mdash; ' + _esc(name) + '</h4>' +
        '<p class="admin-math-error">' + _esc(analysis.error) + '</p>' +
      '</div>';
    }
    var p = analysis.picked, cfg = analysis.cfg, cmp = analysis.cmp;
    var brooklynFees = _num(cmp.totalFees);
    var brookhavenFees = _num(cmp.totalBrookhavenFees);
    var savings = _num(cmp.totalSavings);
    var net = analysis.net;
    var lockupHint;
    if (letter === 'A') lockupHint = 'Y0 lump-sum (sell now)';
    else if (letter === 'B') lockupHint = (p.bestRecC | 0) + ' yearly Jan-1 payment' + (p.bestRecC === 1 ? '' : 's');
    else lockupHint = (p.durationMonths || 36) + 'mo structured-sale (40/40/20 over 3 yrs)';

    var rows = [
      _row('Auto-pick combo',     p.comboId || _esc(String(p.shortPct) + '/' + String(100 - p.shortPct)),
                                  'Highest-net combo from the auto-pick sweep'),
      _row('Horizon',             p.horizon + ' year' + (p.horizon === 1 ? '' : 's'),
                                  'Number of projection years this strategy operates over'),
      _row('Recognition shape',   lockupHint, null),
      _row('Total gain recognized', _fmtUSD(analysis.totalRecognized),
                                  'Sum of LT gain hitting in years ' + cfg.year1 + '–' + (cfg.year1 + p.horizon - 1)),
      _row('Recapture (§1250 ord)', _fmtUSD(analysis.totalRecap),
                                  'Recognized Y0 as ordinary income regardless of strategy'),
      _row('Total Brooklyn loss',  _fmtUSD(analysis.totalLoss),
                                  'Sum of per-year loss across all tranches'),
      _row('Tax savings (gross)',  _fmtUSD(savings),
                                  'Baseline tax − With-strategy tax = ' +
                                  _fmtUSD(_num(cmp.totalBaseline)) + ' − ' +
                                  _fmtUSD(_num(cmp.totalWithStrategy))),
      _row('Brooklyn fees',        _fmtUSD(brooklynFees), null),
      _row('Brookhaven fees',      _fmtUSD(brookhavenFees), null),
      '<tr class="admin-math-total"><td><strong>NET BENEFIT</strong></td>' +
        '<td class="admin-math-num"><strong>' + _fmtUSD(net) + '</strong></td>' +
        '<td class="admin-math-note-cell">savings &minus; fees</td></tr>'
    ];
    return '<div class="admin-math-section">' +
      '<h4>Strategy ' + letter + ' &mdash; ' + _esc(name) + '</h4>' +
      '<table class="admin-math-table">' +
        '<thead><tr><th>Field</th><th class="admin-math-num">Value</th><th>Notes / Formula</th></tr></thead>' +
        '<tbody>' + rows.join('') + '</tbody>' +
      '</table>' +
    '</div>';
  }

  function _renderStrategies() {
    if (typeof root.collectInputs !== 'function') {
      return '<p class="admin-math-error">collectInputs() unavailable.</p>';
    }
    var baseCfg;
    try { baseCfg = root.collectInputs(); }
    catch (e) { return '<p class="admin-math-error">collectInputs() threw: ' + _esc(e.message || e) + '</p>'; }

    var aA = _strategyAnalysis('A', baseCfg);
    var aB = _strategyAnalysis('B', baseCfg);
    var aC = _strategyAnalysis('C', baseCfg);
    var netA = aA.net || 0, netB = aB.net || 0, netC = aC.net || 0;

    var drEl = document.getElementById('default-risk-yes-no');
    var defaultRiskYes = !!(drEl && drEl.value === 'yes');

    var visibilityRows = _cardVisibilityDecision(netA, netB, netC, defaultRiskYes);
    var visibilitySection =
      '<div class="admin-math-section">' +
        '<h4>Card Visibility Decision</h4>' +
        '<table class="admin-math-table">' +
          '<thead><tr><th>Card</th><th class="admin-math-num">Net</th><th>Visibility</th></tr></thead>' +
          '<tbody>' + visibilityRows.join('') + '</tbody>' +
        '</table>' +
      '</div>';

    return visibilitySection
      + _strategySection('A', 'Normal Sale', aA)
      + _strategySection('B', 'Installment Sale', aB)
      + _strategySection('C', 'Structured Installment Sale', aC);
  }

  root._registerPageMath('page-strategies', _renderStrategies);
})(window);
