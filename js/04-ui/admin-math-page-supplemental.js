// js/04-ui/admin-math-page-supplemental.js
//
// Admin math reveal panel - Tab 5 (Supplemental Strategies).
//
// Surfaces the runMasterSolver output per supplemental: interest
// state, calc result, marginal rate (when applicable), net benefit,
// rivalry decision (funded vs not funded due to Brooklyn-beats /
// negative-net / capital-exhausted). Also shows the runAllocator
// breakdown: how the user's total capital splits between Brooklyn
// and each interested supplemental.
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
  function _row(label, value, note) {
    return '<tr><td>' + _esc(label) + '</td>' +
      '<td class="admin-math-num">' + (value == null ? '—' : value) + '</td>' +
      '<td class="admin-math-note-cell">' + (note || '') + '</td></tr>';
  }

  function _allocatorSection() {
    if (typeof root.collectInputs !== 'function' || typeof root.runAllocator !== 'function') {
      return '';
    }
    var cfg;
    try { cfg = root.collectInputs(); } catch (e) { return ''; }
    var totalAvail = _num(cfg && cfg.availableCapital);
    var alloc;
    try { alloc = root.runAllocator(totalAvail); } catch (e) { alloc = null; }
    if (!alloc) return '';
    var rows = [
      _row('Total available capital (Page 1)', _fmtUSD(totalAvail), 'sale − keep'),
      _row('Allocated to supplementals',       _fmtUSD(_num(alloc.allocatedToSupplementals)),
                                               'Sum of supplemental investments (Interested + funded)'),
      _row('Brooklyn remaining',                _fmtUSD(_num(alloc.brooklynRemaining)),
                                               'totalAvailable − allocatedToSupplementals (pre-optimizer cap)')
    ];
    var suppRows = (alloc.supplementals || []).map(function (s) {
      return _row(_esc(s.name || s.id), _fmtUSD(_num(s.investment)), 'enabled supplemental commitment');
    });
    return '<div class="admin-math-section">' +
      '<h4>Allocator &mdash; Dollar Rivalry</h4>' +
      '<table class="admin-math-table">' +
        '<thead><tr><th>Field</th><th class="admin-math-num">Value</th><th>Notes</th></tr></thead>' +
        '<tbody>' + rows.join('') + suppRows.join('') + '</tbody>' +
      '</table>' +
    '</div>';
  }

  function _solverSection() {
    if (typeof root.runMasterSolver !== 'function') return '';
    // Primary (Brooklyn-only) net for the CHOSEN strategy. This feeds the
    // "Combined primary + supplementals" total below (runMasterSolver
    // returns totalCombinedNetBenefit = primary + funded-supp benefit).
    // __rettPrimaryNetBenefit was never set by any caller — it always
    // read 0, which silently dropped the entire Brooklyn primary net from
    // the combined line so admin showed only the supp benefit (e.g.
    // $13,000 where the client hero showed $3,015,935). Derive primary
    // from buildInterestedSummary's chosen-strategy metrics.net, exactly
    // as the client temp-page reconciliation does, so the combined total
    // matches what the client sees. (The per-supp rivalry decisions and
    // totalSupplementalBenefit do NOT depend on this value — only the
    // combined total does.)
    var primary = _num(root.__rettPrimaryNetBenefit);
    if (!primary && typeof root.buildInterestedSummary === 'function') {
      try {
        var _sum = root.buildInterestedSummary();
        var _chosen = root.__rettChosenStrategy || 'A';
        var _ent = (_sum && _sum.entries || []).find(function (e) { return e.type === _chosen; });
        if (_ent && _ent.metrics && Number.isFinite(Number(_ent.metrics.net))) {
          primary = _num(_ent.metrics.net);
        }
      } catch (e) { /* leave primary at its prior value */ }
    }
    var solver;
    try { solver = root.runMasterSolver(primary); } catch (e) {
      return '<p class="admin-math-error">runMasterSolver threw: ' + _esc(e.message || e) + '</p>';
    }
    var supps = (solver && solver.supplementals) || [];
    if (!supps.length) {
      return '<div class="admin-math-section">' +
        '<h4>Supplementals (None Marked Interested)</h4>' +
        '<p class="admin-math-empty">Mark a supplemental as Interested on Tab 5 to see its math here.</p>' +
      '</div>';
    }
    var totalBenefit = _num(solver.totalSupplementalBenefit);
    var combined = _num(solver.totalCombinedNetBenefit);
    var thead =
      '<thead><tr>' +
        '<th>Supplemental</th>' +
        '<th>Interested</th>' +
        '<th>Enabled</th>' +
        '<th>Rivalry</th>' +
        '<th class="admin-math-num">Net Benefit</th>' +
        '<th>Notes</th>' +
      '</tr></thead>';
    var body = supps.map(function (s) {
      var rivalryReason = (s.rivalry && (s.rivalry.reason || (s.rivalry.funded ? 'funded' : '?'))) || '—';
      var fundedLabel = s.rivalry && s.rivalry.funded ? 'funded' : 'NOT funded';
      // Realized (post-saturation) benefit is what actually flows into the
      // combined total — when several ord-offset supps share the finite Y0
      // ordinary pool, a crowded-out supp's realized benefit is scaled
      // below its raw net (often to $0). Show realized; note the raw when
      // they differ so the advisor sees the pool saturation at work.
      var realized = Number(s.realizedNetBenefit);
      if (!Number.isFinite(realized)) {
        realized = (s.enabled && s.available && s.rivalry && s.rivalry.funded) ? s.netBenefit : 0;
      }
      var rawNote = (s.rivalry && s.rivalry.funded && Math.abs(realized - s.netBenefit) > 1)
        ? ' <span class="admin-math-note-cell">(raw ' + _fmtUSD(s.netBenefit) + ', clipped by shared ordinary pool)</span>'
        : '';
      return '<tr>' +
        '<td><strong>' + _esc(s.name) + '</strong><br><span class="admin-math-note-cell">' + _esc(s.descriptor || '') + '</span></td>' +
        '<td>' + (s.interested ? 'Yes' : '—') + '</td>' +
        '<td>' + (s.enabled ? 'Yes' : 'No') + '</td>' +
        '<td>' + _esc(fundedLabel) + ' (' + _esc(rivalryReason) + ')</td>' +
        '<td class="admin-math-num">' + _fmtUSD(realized) + rawNote + '</td>' +
        '<td class="admin-math-note-cell">contributes ' + _fmtUSD(realized) + ' to combined</td>' +
      '</tr>';
    }).join('');
    body +=
      '<tr class="admin-math-subtotal">' +
        '<td colspan="4"><strong>Total funded supplemental benefit</strong></td>' +
        '<td class="admin-math-num"><strong>' + _fmtUSD(totalBenefit) + '</strong></td>' +
        '<td></td>' +
      '</tr>' +
      '<tr class="admin-math-total">' +
        '<td colspan="4"><strong>Combined primary + supplementals</strong></td>' +
        '<td class="admin-math-num"><strong>' + _fmtUSD(combined) + '</strong></td>' +
        '<td class="admin-math-note-cell">primary (Brooklyn) + total supp benefit</td>' +
      '</tr>';
    return '<div class="admin-math-section">' +
      '<h4>Master Solver &mdash; Per-Supplemental Output</h4>' +
      '<table class="admin-math-table">' + thead + '<tbody>' + body + '</tbody></table>' +
    '</div>';
  }

  function _renderSupplemental() {
    return _allocatorSection() + _solverSection();
  }

  root._registerPageMath('page-supplemental', _renderSupplemental);
})(window);
