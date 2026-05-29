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

  // Pull the dashboard's post-optimizer entry for a strategy so the
  // admin panel's net matches what the Page 3 cards display. The
  // entries returned by buildInterestedSummary have been through
  // runBrooklynOptimizer (which can dial Brooklyn deployment back
  // when that produces a better net), so reading metrics directly
  // from unifiedTaxComparison would diverge for any strategy whose
  // optimizer applied a scale less than 1.
  function _strategyAnalysis(type) {
    if (typeof root.buildInterestedSummary !== 'function') {
      return { error: 'buildInterestedSummary unavailable' };
    }
    var summary;
    try { summary = root.buildInterestedSummary(); }
    catch (e) { return { error: 'buildInterestedSummary threw: ' + (e.message || e) }; }
    if (!summary) return { error: 'no summary (no inputs?)' };
    var entry = (summary.entries || []).find(function (e) { return e.type === type; });
    if (!entry) return { error: 'no entry for ' + type };
    var m = entry.metrics || {};
    var picked = entry.picked || {};
    var cfg = entry.cfg || {};
    return {
      picked: picked,
      cfg: cfg,
      // Post-optimizer metrics (what the card shows):
      savings:      _num(m.savings != null ? m.savings : m._savingsAtFull),
      brooklynFees: _num(m.brooklynFees),
      brookhavenFees: _num(m.brookhavenFees),
      allFees:      _num(m.fees),
      net:          _num(m.net),
      doNothing:    _num(m.doNothing),
      tax:          _num(m.tax),
      optScale:     entry._optScale != null ? entry._optScale : 1,
      totalLoss:    _num(entry.loss),
      totalRecognized: 0,  // not directly available on metrics; would need a separate engine call
      totalRecap:   _num(cfg.acceleratedDepreciation)
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
      _row('Strategy A (Traditional Sale)',           _fmtUSD(netA), explain('A', card1Visible, netA, null)),
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
    var p = analysis.picked, cfg = analysis.cfg;
    var lockupHint;
    if (letter === 'A') lockupHint = 'Y0 lump-sum (sell now)';
    else if (letter === 'B') lockupHint = (p.bestRecC | 0) + ' yearly Jan-1 payment' + (p.bestRecC === 1 ? '' : 's');
    else lockupHint = (p.durationMonths || 36) + 'mo structured-sale (40/40/20 over 3 yrs)';
    var scalePct = (analysis.optScale * 100).toFixed(0) + '%';
    var scaleNote = analysis.optScale < 1
      ? 'Optimizer dialed Brooklyn deployment back to ' + scalePct + ' of available - reduces fees while still absorbing gain'
      : 'Full deployment (optimizer found no benefit to dialing back)';

    // Resolve the Schwab combo so we can show the Y0 loss rate + fee
    // rate the CPA needs to verify the math (capital × rate × yf = loss).
    var combo = (p.comboId && typeof root.getSchwabCombo === 'function')
      ? root.getSchwabCombo(p.comboId) : null;
    var y0LossRate = combo && combo.lossByYear ? combo.lossByYear[0] : null;
    // Tier-migration label from the engine's actual per-tranche combos —
    // shows "145/45 → 200/100" when the plan ratchets up, not just the
    // ceiling. This panel has no cmp, so fetch the tranche breakdown.
    var _migLev = combo ? combo.leverageLabel : null;
    if (combo && cfg && typeof root.unifiedTaxComparison === 'function'
        && typeof root._comboMigrationFromCmp === 'function') {
      try {
        var _cmpMig = root.unifiedTaxComparison(cfg, { includeTrancheBreakdown: true });
        _migLev = root._comboMigrationFromCmp(_cmpMig, combo.leverageLabel);
      } catch (e) { /* keep ceiling label */ }
    }
    var comboLabel = combo ? (_migLev + ' (' + combo.strategyLabel + ')') : (p.comboId || '—');
    var lossRateRow = y0LossRate != null
      ? _row('Loss rate (Y0)', (y0LossRate * 100).toFixed(1) + '%',
             'Combo ' + _esc(comboLabel) + ' first-year loss/$ ratio &mdash; decays in subsequent years')
      : _row('Loss rate (Y0)', '—', 'No Schwab combo (non-tier or below-min)');
    var _comboFeeRate = (combo && typeof root.brooklynFeeRateFor === 'function')
      ? (root.brooklynFeeRateFor(combo.longPct, combo.shortPct) || 0)
      : 0;
    var feeRateRow = combo
      ? _row('Brooklyn fee rate', (_comboFeeRate * 100).toFixed(2) + '%',
             'Per-year fee on deployed capital under ' + _esc(comboLabel))
      : _row('Brooklyn fee rate', '—', null);

    var rows = [
      _row('Auto-pick combo',      _esc(comboLabel),
                                   'Highest-net combo from the auto-pick sweep'),
      _row('Horizon',              p.horizon + ' year' + (p.horizon === 1 ? '' : 's'),
                                   'Number of projection years this strategy operates over'),
      _row('Recognition shape',    lockupHint, null),
      _row('Optimizer scale',      scalePct, scaleNote),
      lossRateRow,
      feeRateRow,
      _row('Recapture (§1250 ord)', _fmtUSD(analysis.totalRecap),
                                    'Recognized Y0 as ordinary income regardless of strategy'),
      _row('Brooklyn short-term loss', _fmtUSD(analysis.totalLoss),
                                       'All Brooklyn losses are ST per project rule. Generated by ' +
                                       _esc(comboLabel) + ' over ' + p.horizon + ' year' + (p.horizon === 1 ? '' : 's') +
                                       '. Sum across tranches.'),
      _row('Tax savings (gross)',  _fmtUSD(analysis.savings),
                                   'doNothing tax − with-strategy tax (post-optimizer)'),
      _row('Brooklyn fees',        _fmtUSD(analysis.brooklynFees), 'Post-optimizer'),
      _row('Brookhaven fees',      _fmtUSD(analysis.brookhavenFees), null),
      '<tr class="admin-math-total"><td><strong>NET BENEFIT</strong></td>' +
        '<td class="admin-math-num"><strong>' + _fmtUSD(analysis.net) + '</strong></td>' +
        '<td class="admin-math-note-cell">savings &minus; fees (matches Page 3 card)</td></tr>'
    ];
    return '<div class="admin-math-section">' +
      '<h4>Strategy ' + letter + ' &mdash; ' + _esc(name) + ' &mdash; ' + _esc(comboLabel) + '</h4>' +
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
    var aA = _strategyAnalysis('A');
    var aB = _strategyAnalysis('B');
    var aC = _strategyAnalysis('C');
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
      + _strategySection('A', 'Traditional Sale', aA)
      + _strategySection('B', 'Installment Sale', aB)
      + _strategySection('C', 'Structured Installment Sale', aC);
  }

  root._registerPageMath('page-strategies', _renderStrategies);
})(window);
