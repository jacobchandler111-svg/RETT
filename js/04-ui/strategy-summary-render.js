// FILE: js/04-ui/strategy-summary-render.js
// Page 4 (Strategy Summary). Mirrors the BrookHaven "Moving Forward"
// tab from the source tax calculator: a 2-col layout with Setup / Fee
// Breakdown / Engagement Notes cards on the left and ROI hero +
// Compare + Bar viz + Bottom-Line callout on the right.
//
// Renders ONLY the strategy the user picked on Page 3 (via the "Use
// This Strategy" button). State lives on window.__rettChosenStrategy.
// If no pick exists, surfaces a prompt back to Page 3.
//
// Public entry point: renderStrategySummary(). Reads per-scenario data
// from window.buildInterestedSummary() (in projection-dashboard-render.js)
// so Page 3 and Page 4 share one data path.

(function (root) {
  'use strict';

  function _fmt(n) {
    if (n == null || !isFinite(n)) return '—';
    if (typeof fmtUSD === 'function') return fmtUSD(n);
    var sign = n < 0 ? '-' : '';
    var v = Math.round(Math.abs(n));
    return sign + '$' + v.toLocaleString('en-US');
  }

  function _fmtMultiplier(ratio) {
    if (!isFinite(ratio) || ratio <= 0) return '—';
    if (ratio >= 100) return Math.round(ratio).toLocaleString('en-US');
    return ratio.toFixed(1);
  }

  function _filingLabel(f) {
    var m = { single:'Single', mfj:'Married Filing Jointly', mfs:'Married Filing Separately', hoh:'Head of Household' };
    return m[f] || f || '—';
  }

  function _strategyDescriptor(type) {
    if (type === 'A') return 'Sell in the current tax year.';
    if (type === 'B') return 'Negotiate with the buyer to receive payment on January 1st.';
    if (type === 'C') return 'Use a structured-sale insurance product to defer gain recognition past the closing year.';
    return '';
  }

  function _stratNum(type) {
    return type === 'A' ? '01' : type === 'B' ? '02' : type === 'C' ? '03' : '00';
  }
  function _stratName(type) {
    return type === 'A' ? 'Sell Now'
      : type === 'B' ? 'Seller Finance'
      : type === 'C' ? 'Structured Sale' : 'Strategy';
  }

  // Empty-state when the user lands on Page 4 without having picked a
  // strategy on Page 3. Routes them back via the nav (the prompt is
  // intentionally CTA-shaped so it reads as the next action).
  function _renderNoChoiceHtml() {
    return '<div class="forward-intro">' +
      '<h1>Strategy Summary</h1>' +
      '<p>This page breaks down the fees baked into your chosen strategy &mdash; both Brooklyn (position management) and Brookhaven (planning &amp; ongoing service) &mdash; and shows the return on those fees vs the projected tax savings.</p>' +
    '</div>' +
    '<div class="forward-noChoice">' +
      '<p>Pick a strategy on the <strong>Projection</strong> page (click <em>Use This Strategy</em> on the card you want to pursue) and the full fee breakdown lands here.</p>' +
      '<button type="button" class="cta-btn" onclick="document.getElementById(\'nav-projection\').click()">Go to Projection &rarr;</button>' +
    '</div>';
  }

  function _bullet(text, amount) {
    return '<div class="fee-strat-row">' +
      '<div class="strat-info">' +
        '<div class="strat-meta">' +
          '<div class="strat-name">' + text + '</div>' +
        '</div>' +
      '</div>' +
      '<div class="strat-fee">' + (amount != null ? _fmt(amount) : '') + '</div>' +
    '</div>';
  }

  function renderStrategySummary() {
    var host = document.getElementById('strategy-fee-summary-host');
    if (!host) return;
    if (typeof root.buildInterestedSummary !== 'function') {
      host.innerHTML = _renderNoChoiceHtml();
      return;
    }
    var summary = root.buildInterestedSummary();
    if (!summary) {
      host.innerHTML = '<div class="forward-intro"><h1>Strategy Summary</h1><p>Fill in the client inputs on Page 1, then mark a strategy as Interested and click <strong>Use This Strategy</strong> on Page 3.</p></div>';
      return;
    }
    var entries = summary.entries;
    var currentCfg = summary.currentCfg;

    // If the user marked exactly one strategy as Interested OR every
    // other strategy is explicitly Not Interested (so the engine's
    // recommended is the only one left standing), treat that as the
    // implicit choice — forcing a second click is friction.
    var chosen = (typeof window !== 'undefined') ? window.__rettChosenStrategy : null;
    if (!chosen) {
      var interest = (typeof window !== 'undefined' && window.__rettStrategyInterest) || {};
      var interested = ['A','B','C'].filter(function (k) { return interest[k] === true; });
      if (interested.length === 1) {
        chosen = interested[0];
      } else if (interested.length === 0) {
        // No explicit Interested marks. If exactly one strategy in the
        // build set isn't ruled out, that's the implicit choice.
        var stillIn = entries.filter(function (e) { return interest[e.type] !== false; });
        if (stillIn.length === 1) chosen = stillIn[0].type;
      }
    }
    if (!chosen) {
      host.innerHTML = _renderNoChoiceHtml();
      return;
    }

    var entry = null;
    for (var i = 0; i < entries.length; i++) {
      if (entries[i].type === chosen) { entry = entries[i]; break; }
    }
    if (!entry) {
      // Chosen strategy is not available for this scenario (e.g. picked
      // B but the sale date moved earlier than September). Bounce back
      // to the no-choice prompt rather than silently rendering nothing.
      host.innerHTML = _renderNoChoiceHtml();
      return;
    }

    var m = entry.metrics;

    // entry.metrics already has the Brooklyn-optimizer / slider dial-
    // back applied at buildInterestedSummary() time — so brooklynFees,
    // fees, savings, and net here are the OPTIMIZED values. The
    // full-investment baseline is preserved on m._brooklynFeesAtFull,
    // m._lossAtFull, and m._savingsAtFull for any UI that wants to
    // surface the "if invested heavier" reference line.
    var opt = entry._opt || null;
    var optScale = (typeof entry._optScale === 'number') ? entry._optScale : 1;
    var effectiveBrooklynFees = m.brooklynFees || 0;
    var fees = m.fees || 0;
    var primarySavings = (typeof m.savings === 'number')
      ? m.savings
      : Math.max(0, (m.doNothing || 0) - (m.tax || 0));
    var primaryNet = (typeof m.net === 'number')
      ? m.net
      : (primarySavings - fees);
    // Pull supplementals through the master solver so the hero numbers
    // (Net Benefit, You Save, ROI) reflect everything the client opted
    // in to. Each enabled supplemental's netBenefit is post-its-own-fees,
    // so adding them to primarySavings gives the actual dollar the
    // client keeps. Fees stay equal to primary fees (Brookhaven +
    // Brooklyn) — supplemental product fees are wrapped into their own
    // netBenefit, not double-counted in the planning fee bucket.
    var solverOut = (typeof root.runMasterSolver === 'function')
      ? root.runMasterSolver(primaryNet) : null;
    var enabledSupplements = (solverOut && solverOut.supplementals)
      ? solverOut.supplementals.filter(function (s) { return s.enabled && s.available; })
      : [];
    var supplementalBenefit = enabledSupplements.reduce(function (sum, s) {
      return sum + (Number(s.netBenefit) || 0);
    }, 0);
    var savings = primarySavings + supplementalBenefit;
    var net = primaryNet + supplementalBenefit;
    var roi = fees > 0 ? (savings / fees) : 0;
    var maxBar = Math.max(fees, savings, 1);
    var feePct = Math.max(1, (fees / maxBar) * 100);
    var savePct = Math.max(1, (savings / maxBar) * 100);

    var picked = entry.picked || {};
    var dur = picked.durationMonths || 18;
    var horizon = picked.horizon;
    var leverage = picked.shortPct;
    var recYr = picked.bestRecC;
    var year1 = (currentCfg && currentCfg.year1) || (new Date()).getFullYear();

    // Bottom-line callout removed per user spec — narrative tiers
    // were placeholder copy. Will be re-introduced once final phrasing
    // is decided.

    var html = '';

    // Top intro band
    html += '<div class="forward-intro">' +
      '<h1>Moving Forward With Brookhaven</h1>' +
    '</div>';

    // The Brooklyn-investment-optimized callout was removed per advisor
    // spec — the rationale lives in the Implementation panel (audit
    // view) for advisors who want it; the client-facing summary
    // doesn't need the explanation, just the optimized numbers.

    // ============ TOP ROW: Selected Strategy + Supplemental Strategies ============
    var hasSupps = !!(enabledSupplements.length || (solverOut && solverOut.anyInterested));
    var selectedStrategyHtml = '<div class="input-section">' +
      '<div class="section-heading">' +
        '<h2>Selected Strategy</h2>' +
        '<span class="num">STRATEGY ' + _stratNum(entry.type) + '</span>' +
      '</div>' +
      '<div class="section-body">' +
        '<div class="input-row">' +
          '<div class="label">Strategy<span class="sub">' + _strategyDescriptor(entry.type) + '</span></div>' +
          '<div class="forward-fee-display" style="font-family:var(--font-display);font-style:italic;font-size:1.4em;">' +
            _stratName(entry.type) +
          '</div>' +
        '</div>' +
        '<div class="input-row">' +
          '<div class="label">Filing<span class="sub">Tax year ' + year1 + ', ' + (currentCfg.state || '—') + '</span></div>' +
          '<div class="forward-balance">' + _filingLabel(currentCfg.filingStatus) + '</div>' +
        '</div>' +
        '<div class="input-row">' +
          '<div class="label">Brooklyn<span class="sub">Position parameters</span></div>' +
          '<div class="forward-balance" style="font-size:0.85em;">' +
            'Horizon ' + horizon + 'y &middot; Leverage ' + (leverage != null ? leverage + '%' : '—') +
            (entry.type === 'C' ? ' &middot; ' + dur + ' mo' : '') +
          '</div>' +
        '</div>' +
      '</div>' +
    '</div>';

    if (hasSupps) {
      html += '<div class="forward-top-row">' +
        selectedStrategyHtml +
        _renderSupplementalLeftColumn(solverOut) +
      '</div>';
    } else {
      html += selectedStrategyHtml;
    }

    // ============ Return on Planning — left: walk-away + compare; right: ROP square ============
    // The big-picture question for the client: "what do I actually walk
    // away with?" We show two side-by-side numbers (No / With Planning)
    // and the You Save / Total Fees / Net Benefit row below them on
    // the LEFT side; the right side gets a big percent-return tile so
    // the conversation can pivot from "you keep $X more" to "for every
    // $1 in fees you got $N back" without scrolling.
    var salePrice = (currentCfg && Number(currentCfg.salePrice)) || 0;
    // With-planning tax = do-nothing tax minus the savings we actually
    // captured at the current Brooklyn investment level. Reading m.tax
    // directly would always show the full-investment tax even when the
    // slider has dialed Brooklyn back below the absorbable cap, breaking
    // the walkaway↔you-save reconciliation.
    var withPlanningTax = Math.max(0, (m.doNothing || 0) - primarySavings);
    var walkawayNoPlanning   = salePrice - (m.doNothing || 0);
    var walkawayWithPlanning = salePrice - withPlanningTax + supplementalBenefit;
    var ropDisplay = (fees > 0 && savings > 0)
      ? _fmtMultiplier(savings / fees) + '<span class="rop-x">&times;</span>'
      : '—';
    html += '<div class="forward-rop-row">' +
      '<div class="forward-rop-left">' +
        '<div class="forward-walkaway">' +
          '<div class="walkaway-grid">' +
            '<div class="walkaway-side noplan">' +
              '<div class="walkaway-label">No Planning</div>' +
              '<div class="walkaway-amt">' + _fmt(walkawayNoPlanning) + '</div>' +
              '<div class="walkaway-tagline">what you walk away with</div>' +
            '</div>' +
            '<div class="walkaway-side withplan">' +
              '<div class="walkaway-label">With Planning</div>' +
              '<div class="walkaway-amt">' + _fmt(walkawayWithPlanning) + '</div>' +
              '<div class="walkaway-tagline">what you walk away with</div>' +
            '</div>' +
          '</div>' +
        '</div>' +
        '<div class="forward-compare">' +
          '<div class="compare-row">' +
            '<div class="compare-side savings">' +
              '<div class="compare-label">You Save</div>' +
              '<div class="compare-amt"><span class="currency">$</span>' + Math.round(savings).toLocaleString('en-US') + '</div>' +
            '</div>' +
            '<div class="compare-side cost">' +
              '<div class="compare-label">Total Fees</div>' +
              '<div class="compare-amt"><span class="currency">$</span>' + Math.round(fees).toLocaleString('en-US') + '</div>' +
            '</div>' +
          '</div>' +
          '<div class="compare-net">' +
            '<div class="net-label">Net Benefit</div>' +
            '<div class="net-amt"><span class="currency">$</span>' + Math.round(net).toLocaleString('en-US') + '</div>' +
          '</div>' +
        '</div>' +
      '</div>' +
      '<div class="forward-rop-square">' +
        '<div class="rop-label">Return on Planning</div>' +
        '<div class="rop-amt">' + ropDisplay + '</div>' +
        '<div class="rop-sub">every dollar in fees saves you this</div>' +
      '</div>' +
    '</div>';

    // ============ Brooklyn investment slider ============
    // Lets the advisor manually override the optimizer's recommended
    // dial-back. The slider's max is the full Available Capital from
    // Page 1; a marker on the track shows the optimizer cap (loss =
    // absorbable gain). Dragging past the marker generates excess
    // loss carryforward — surfaces a callout suggesting future-sale
    // planning when that happens. Revert + Max buttons snap the
    // slider back to the recommended position or push to full.
    html += _renderBrooklynSlider(entry, opt, currentCfg);

    // ============ Fees Baked In — Brooklyn + Brookhaven breakdown ============
    html += '<div class="input-section" id="fee-strategies-section">' +
      '<div class="section-heading">' +
        '<h2>Fees Baked In</h2>' +
        '<span class="num">REVIEW</span>' +
      '</div>' +
      '<div class="section-body">' +
        _bullet('Brooklyn fees<span class="strat-savings-line">Borrow + fund + short-side carry over the position' +
          (opt && opt.dialBack ? ' &mdash; scaled to ' + _fmt(opt.recommendedInvestment) + ' invested' : '') +
          '</span>', effectiveBrooklynFees) +
        _bullet('Brookhaven fees<span class="strat-savings-line">Planning engagement + ongoing service (flat schedule)</span>', m.brookhavenFees || 0) +
        '<div class="fee-summary-row">' +
          '<div class="fee-summary-label">Total Fees</div>' +
          '<div class="fee-summary-amt">' + _fmt(fees) + '</div>' +
        '</div>' +
      '</div>' +
    '</div>';

    // Engagement Notes section removed per advisor spec — the
    // information lives in the Implementation panel (audit) and on
    // Page 1 already; no need to repeat it on the client-facing
    // summary.

    // Implementation panel — hidden by default, expand via the small
    // triangle on the trailing dash. Advisor-only audit view: shows
    // the dollar allocation across Brooklyn + each enabled supplemental
    // so the math can be checked (no double-spending sale proceeds),
    // and the Brooklyn optimizer's recommendation re. dialing back
    // investment to keep loss carryforward within absorbable gain.
    html += _renderImplementationPanel(currentCfg, entry.loss || 0, opt);

    // Print button — screen-only; triggers window.print()
    html += '<div class="forward-print-bar">' +
      '<button type="button" class="btn-print" onclick="window.print()">' +
        '&#128438;&nbsp; Print / Save as PDF' +
      '</button>' +
      '<span class="forward-print-hint">Opens your browser\'s print dialog. Choose &ldquo;Save as PDF&rdquo; to generate a client-ready document.</span>' +
    '</div>';

    // Print view — hidden on screen, visible only when printing.
    html += _renderPrintView({
      cfg:            currentCfg,
      entry:          entry,
      m:              m,
      opt:            opt,
      optScale:       optScale,
      effectiveBkFees: effectiveBrooklynFees,
      fees:           fees,
      savings:        savings,
      net:            net,
      roi:            roi,
      horizon:        horizon,
      leverage:       leverage,
      dur:            dur,
      recYr:          recYr,
      year1:          year1,
      supplements:    enabledSupplements,
      supplementalBenefit: supplementalBenefit
    });

    host.innerHTML = html;
    _bindSupplementalToggleEvents();
  }

  function _renderPrintView(d) {
    var cfg      = d.cfg || {};
    var m        = d.m || {};
    var entry    = d.entry || {};
    var opt      = d.opt;
    var fees     = d.fees || 0;
    var savings  = d.savings || 0;
    var net      = d.net || 0;
    var roi      = d.roi || 0;
    var year1    = d.year1 || (new Date()).getFullYear();

    var clientName = (typeof root.__rettCaseName !== 'undefined' && root.__rettCaseName)
      ? root.__rettCaseName
      : ((document.getElementById('case-name-input') || {}).value || '');
    var today = new Date();
    var dateStr = (today.getMonth()+1) + '/' + today.getDate() + '/' + today.getFullYear();

    var stratLabel  = d.entry.type === 'A' ? 'Sell Now'
      : d.entry.type === 'B' ? 'Seller Finance'
      : 'Structured Sale';
    var stratNum = d.entry.type === 'A' ? '01' : d.entry.type === 'B' ? '02' : '03';

    // Tax comparison row
    var doNothing = m.doNothing || 0;
    var taxWith   = m.tax || 0;
    var saving    = Math.max(0, doNothing - taxWith);

    // Header
    var h = '<div class="print-view">';
    h += '<div class="print-header">' +
      '<div class="print-header-brand">Brookhaven</div>' +
      '<div class="print-header-meta">' +
        (clientName ? '<span class="print-client-name">' + clientName + '</span>' : '') +
        '<span class="print-date">Prepared ' + dateStr + '</span>' +
      '</div>' +
    '</div>';
    h += '<div class="print-rule"></div>';

    // Title block
    h += '<div class="print-title-block">' +
      '<h1 class="print-title">Moving Forward With Brookhaven</h1>' +
      '<div class="print-strategy-tag">Strategy ' + stratNum + ' &mdash; ' + stratLabel +
        ' &middot; ' + _filingLabel(cfg.filingStatus) + ' &middot; ' + (cfg.state || '') +
      '</div>' +
    '</div>';

    // Hero 3-box row
    h += '<div class="print-hero-row">' +
      '<div class="print-hero-box">' +
        '<div class="print-hero-label">You Save</div>' +
        '<div class="print-hero-value">' + _fmt(savings) + '</div>' +
        '<div class="print-hero-sub">Total projected tax savings vs. doing nothing</div>' +
      '</div>' +
      '<div class="print-hero-box print-hero-fees">' +
        '<div class="print-hero-label">Total Fees</div>' +
        '<div class="print-hero-value">' + _fmt(fees) + '</div>' +
        '<div class="print-hero-sub">Brooklyn position + Brookhaven planning</div>' +
      '</div>' +
      '<div class="print-hero-box print-hero-net">' +
        '<div class="print-hero-label">Net Benefit</div>' +
        '<div class="print-hero-value">' + _fmt(net) + '</div>' +
        '<div class="print-hero-sub">' + _fmtMultiplier(roi) + '&times; return on every $1 in fees</div>' +
      '</div>' +
    '</div>';

    // Two-column body
    h += '<div class="print-body">';

    // LEFT: Tax comparison + fee breakdown
    h += '<div class="print-col">';

    h += '<div class="print-section">' +
      '<div class="print-section-head">Tax Comparison &mdash; ' + d.horizon + '-Year Horizon</div>' +
      '<table class="print-table">' +
        '<thead><tr><th>Scenario</th><th class="print-num">Tax Owed</th><th class="print-num">Difference</th></tr></thead>' +
        '<tbody>' +
          '<tr><td>Without planning (do nothing)</td><td class="print-num">' + _fmt(doNothing) + '</td><td class="print-num">—</td></tr>' +
          '<tr><td>With ' + stratLabel + ' strategy</td><td class="print-num">' + _fmt(taxWith) + '</td><td class="print-num print-green">&#x2212;' + _fmt(saving) + '</td></tr>' +
          (d.supplements.length ? '<tr><td>Supplemental strategies benefit</td><td class="print-num print-green">+' + _fmt(d.supplementalBenefit) + '</td><td class="print-num print-green">+' + _fmt(d.supplementalBenefit) + '</td></tr>' : '') +
        '</tbody>' +
      '</table>' +
    '</div>';

    h += '<div class="print-section">' +
      '<div class="print-section-head">Fees Included</div>' +
      '<table class="print-table">' +
        '<tbody>' +
          '<tr><td>Brooklyn position management' +
            (opt && opt.dialBack ? ' <span class="print-note">(investment scaled to ' + _fmt(opt.recommendedInvestment) + ')</span>' : '') +
          '</td><td class="print-num">' + _fmt(d.effectiveBkFees) + '</td></tr>' +
          '<tr><td>Brookhaven planning &amp; advisory</td><td class="print-num">' + _fmt(m.brookhavenFees || 0) + '</td></tr>' +
          '<tr class="print-total-row"><td><strong>Total fees</strong></td><td class="print-num"><strong>' + _fmt(fees) + '</strong></td></tr>' +
        '</tbody>' +
      '</table>' +
    '</div>';

    if (opt && opt.dialBack) {
      h += '<div class="print-optimizer-note">' +
        '<strong>Investment optimized:</strong> At full capital (' + _fmt(opt.availableCapital) + '), Brooklyn would generate ' +
        _fmt(opt.brooklynLossAtFull) + ' in losses against ' + _fmt(opt.totalAbsorbableGain) + ' of absorbable gain. ' +
        'Investment scaled to ' + _fmt(opt.recommendedInvestment) + ' — same tax savings, ' + _fmt(opt.excessLossAtFull) + ' less in wasted carryforward.' +
      '</div>';
    }

    h += '</div>'; // /print-col left

    // RIGHT: Strategy details
    h += '<div class="print-col">';

    h += '<div class="print-section">' +
      '<div class="print-section-head">Selected Strategy</div>' +
      '<table class="print-table">' +
        '<tbody>' +
          '<tr><td>Strategy</td><td class="print-r"><strong>' + stratLabel + '</strong></td></tr>' +
          '<tr><td>Tax year</td><td class="print-r">' + year1 + '</td></tr>' +
          '<tr><td>Filing status</td><td class="print-r">' + _filingLabel(cfg.filingStatus) + '</td></tr>' +
          '<tr><td>State</td><td class="print-r">' + (cfg.state || '—') + '</td></tr>' +
          '<tr><td>Closing / implementation</td><td class="print-r">' + (cfg.implementationDate || '—') + '</td></tr>' +
          '<tr><td>Brooklyn horizon</td><td class="print-r">' + d.horizon + ' years</td></tr>' +
          '<tr><td>Brooklyn leverage</td><td class="print-r">' + d.leverage + '% short</td></tr>' +
          (entry.type === 'C'
            ? '<tr><td>Structured sale term</td><td class="print-r">' + d.dur + ' months</td></tr>' +
              '<tr><td>Gain recognition starts</td><td class="print-r">Year ' + (d.recYr||2) + ' (' + (year1+(d.recYr||2)-1) + ')</td></tr>'
            : '') +
        '</tbody>' +
      '</table>' +
    '</div>';

    if (d.supplements && d.supplements.length) {
      h += '<div class="print-section">' +
        '<div class="print-section-head">Supplemental Strategies</div>' +
        '<table class="print-table"><tbody>';
      d.supplements.forEach(function (s) {
        h += '<tr><td>' + s.name + '</td><td class="print-num print-green">+' + _fmt(s.netBenefit) + '</td></tr>';
      });
      h += '</tbody></table></div>';
    }

    h += '<div class="print-section">' +
      '<div class="print-section-head">Return on Planning</div>' +
      '<div class="print-roi-display">' +
        '<span class="print-roi-num">' + _fmtMultiplier(roi) + '&times;</span>' +
        '<span class="print-roi-label">For every $1 in fees, $' + _fmtMultiplier(roi) + ' returned in tax savings</span>' +
      '</div>' +
    '</div>';

    h += '</div>'; // /print-col right
    h += '</div>'; // /print-body

    h += '<div class="print-footer">' +
      'This document was prepared by Brookhaven for discussion purposes only and does not constitute tax or legal advice. ' +
      'Results are projections based on current tax law and the inputs provided; actual outcomes may vary.' +
    '</div>';

    h += '</div>'; // /print-view
    return h;
  }

  function _renderImplementationPanel(cfg, brooklynCumulativeLoss, precomputedOpt) {
    if (typeof root.runAllocator !== 'function') return '';
    var totalAvailable = (cfg && Number(cfg.availableCapital)) || 0;
    var alloc = root.runAllocator(totalAvailable);
    var rows = '';
    rows += '<div class="impl-row"><span class="impl-name">Total available capital</span>' +
            '<span class="impl-amt">' + _fmt(alloc.totalAvailable) + '</span></div>';
    alloc.supplementals.forEach(function (s) {
      var note = s.enabled && s.available ? '' :
                 (!s.enabled ? ' (disabled on Page 5)' :
                  !s.available ? ' (awaiting Page 4 input)' : '');
      rows += '<div class="impl-row impl-row-supp">' +
              '<span class="impl-name">&rarr; ' + s.name + note + '</span>' +
              '<span class="impl-amt">' + _fmt(s.investment) + '</span></div>';
    });
    rows += '<div class="impl-row impl-row-brooklyn">' +
            '<span class="impl-name">&rarr; Brooklyn (remaining)</span>' +
            '<span class="impl-amt">' + _fmt(alloc.brooklynRemaining) + '</span></div>';
    var warn = '';
    if (alloc.overAllocated) {
      warn = '<div class="impl-warn">Over-allocated by ' + _fmt(alloc.overage) +
             ' &mdash; the supplemental investments exceed available capital. Reduce a supplemental on Page 4 or raise Available Capital on Page 1.</div>';
    }

    // Brooklyn optimizer block — shows the loss-vs-absorbable-gain
    // diagnostic. The main hero numbers already reflect the optimizer's
    // recommended scale; this section shows the detailed math.
    var optBlock = '';
    if (precomputedOpt || typeof root.runBrooklynOptimizer === 'function') {
      var opt = precomputedOpt || root.runBrooklynOptimizer(cfg, brooklynCumulativeLoss);
      var rowsOpt = '';
      rowsOpt += '<div class="impl-row"><span class="impl-name">Current LT gain</span>' +
                 '<span class="impl-amt">' + _fmt(opt.currentLTGain) + '</span></div>';
      if (opt.futureSaleEnabled) {
        rowsOpt += '<div class="impl-row"><span class="impl-name">Future LT gain (planned sale)</span>' +
                   '<span class="impl-amt">' + _fmt(opt.futureLTGain) + '</span></div>';
      }
      rowsOpt += '<div class="impl-row impl-row-strong"><span class="impl-name">Total absorbable gain</span>' +
                 '<span class="impl-amt">' + _fmt(opt.totalAbsorbableGain) + '</span></div>';
      rowsOpt += '<div class="impl-row"><span class="impl-name">Brooklyn cumulative loss at full investment</span>' +
                 '<span class="impl-amt">' + _fmt(opt.brooklynLossAtFull) + '</span></div>';
      var recNote, recAmt;
      if (opt.dialBack) {
        recNote = 'Loss exceeds gain by ' + _fmt(opt.excessLossAtFull) +
                  ' &mdash; the surplus would carry forward against §1211(b)’s $3K/yr ordinary cap. ' +
                  (opt.futureSaleEnabled
                    ? 'Even with the planned future sale, the cap binds.'
                    : 'No planned future sale to absorb it.') +
                  ' Recommended Brooklyn investment is scaled to absorb gain exactly.';
        recAmt = _fmt(opt.recommendedInvestment) + ' (of ' + _fmt(opt.availableCapital) + ' available)';
      } else if (opt.reason === 'no-absorbable-gain') {
        recNote = 'No absorbable gain in scope (no current sale, no planned future sale). ' +
                  'Brooklyn loss would only offset $3K/yr of ordinary income. ' +
                  'Reconsider whether Brooklyn is the right vehicle for this client, or add a planned future sale.';
        recAmt = '—';
      } else {
        recNote = 'Loss is within absorbable gain &mdash; full investment is fine.';
        recAmt = _fmt(opt.availableCapital) + ' (full)';
      }
      rowsOpt += '<div class="impl-row impl-row-strong"><span class="impl-name">Recommended Brooklyn investment</span>' +
                 '<span class="impl-amt">' + recAmt + '</span></div>';
      optBlock = '' +
        '<div class="impl-section-divider"></div>' +
        '<div class="impl-head">Brooklyn optimizer &mdash; loss vs. absorbable gain</div>' +
        '<p class="impl-sub">Brooklyn fees and hero numbers above already reflect the recommended scale. Future sale (Section&nbsp;07 on Page&nbsp;1) raises the absorbable-gain cap.</p>' +
        rowsOpt +
        '<p class="impl-recnote">' + recNote + '</p>';
    }

    return '' +
      '<details class="forward-implementation">' +
        '<summary class="forward-implementation-summary" aria-label="Show implementation breakdown">' +
          '<span class="impl-dash" aria-hidden="true"></span>' +
        '</summary>' +
        '<div class="forward-implementation-body">' +
          '<div class="impl-head">Implementation &mdash; dollar allocation</div>' +
          '<p class="impl-sub">Advisor audit view. Confirms no dollar is committed to more than one strategy.</p>' +
          rows +
          warn +
          optBlock +
        '</div>' +
      '</details>';
  }

  // -----------------------------------------------------------------
  // Supplemental section render — sits in the LEFT column between
  // Selected Strategy and Fees Baked In. One slim row per Interested
  // supplemental: toggle · name · signed contribution. Descriptors
  // are intentionally suppressed — Page 4 has already explained the
  // strategy. Hero numbers (Net Benefit / You Save / ROI) reflect
  // the combined picture, so this section's job is just letting the
  // advisor dial supplementals on/off mid-meeting.
  // -----------------------------------------------------------------
  function _renderSupplementalLeftColumn(solverOut) {
    if (!solverOut || !solverOut.anyInterested) return '';
    var rows = solverOut.supplementals.map(function (s) {
      var sign = s.netBenefit >= 0 ? '+' : '';
      var amt  = sign + _fmt(s.netBenefit);
      var pending = (!s.available)
        ? '<span class="supp-row-pending" title="Configure on Page 4 to populate">awaiting input</span>'
        : '';
      return '' +
        '<div class="supp-strat-row" data-supp-row="' + s.id + '">' +
          '<label class="supp-row-toggle">' +
            '<input type="checkbox" data-supp-toggle="' + s.id + '"' +
              (s.enabled ? ' checked' : '') +
              (!s.available ? ' disabled' : '') + '>' +
            '<span class="supp-row-switch" aria-hidden="true"></span>' +
          '</label>' +
          '<div class="supp-strat-name">' + s.name + pending + '</div>' +
          '<div class="supp-strat-amt' + (s.enabled && s.available ? '' : ' is-off') + '">' + amt + '</div>' +
        '</div>';
    }).join('');

    return '' +
      '<div class="input-section">' +
        '<div class="section-heading">' +
          '<h2>Supplemental Strategies</h2>' +
          '<span class="num">ADD-ONS</span>' +
        '</div>' +
        '<div class="section-body">' + rows + '</div>' +
      '</div>';
  }

  function _bindSupplementalToggleEvents() {
    var host = document.getElementById('strategy-fee-summary-host');
    if (!host) return;
    var toggles = host.querySelectorAll('[data-supp-toggle]');
    toggles.forEach(function (cb) {
      cb.addEventListener('change', function () {
        var id = cb.getAttribute('data-supp-toggle');
        if (typeof root.setSupplementalEnabled === 'function') {
          root.setSupplementalEnabled(id, cb.checked);
        }
        // Re-render the section in place — full Page-5 re-render is
        // overkill since toggles only affect the supplemental block.
        renderStrategySummary();
      });
    });
    // Brooklyn investment slider — drag to override the optimizer's
    // recommendation. Stores the override on
    // window.__rettBrooklynInvestmentOverride which buildInterestedSummary
    // reads on the next render. Cleared on form reset by clearForm.
    var slider = document.getElementById('brooklyn-investment-slider');
    if (slider) {
      slider.addEventListener('input', function () {
        var v = Number(slider.value);
        root.__rettBrooklynInvestmentOverride = Number.isFinite(v) ? v : null;
        renderStrategySummary();
      });
    }
    host.querySelectorAll('[data-bs-action]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var act = btn.getAttribute('data-bs-action');
        if (act === 'revert') {
          root.__rettBrooklynInvestmentOverride = null;
        } else if (act === 'max') {
          var cfg = (typeof root.collectInputs === 'function') ? root.collectInputs() : {};
          root.__rettBrooklynInvestmentOverride = Number(cfg.availableCapital) || 0;
        }
        renderStrategySummary();
      });
    });
  }

  // -----------------------------------------------------------------
  // Brooklyn investment slider. Lets the advisor override the
  // optimizer cap manually; pushes past the cap surface excess loss.
  // The recommended position renders as a notch on the track so the
  // advisor knows where "absorbs gain exactly" lives.
  // -----------------------------------------------------------------
  function _renderBrooklynSlider(entry, opt, cfg) {
    var availCap = (cfg && Number(cfg.availableCapital)) || 0;
    if (availCap <= 0) return '';
    var lossAtFull = (entry && entry.metrics && entry.metrics._lossAtFull) || 0;
    if (lossAtFull <= 0) return '';
    var absorbable = (opt && Number(opt.totalAbsorbableGain)) || 0;
    var recommended = (opt && opt.dialBack)
      ? Math.min(availCap, opt.recommendedInvestment)
      : availCap;
    var override = root.__rettBrooklynInvestmentOverride;
    var current = (typeof override === 'number' && override >= 0)
      ? Math.max(0, Math.min(availCap, override))
      : recommended;
    var step = Math.max(1000, Math.round(availCap / 200));
    var recPct = availCap > 0 ? (recommended / availCap) * 100 : 100;
    var scale = availCap > 0 ? current / availCap : 1;
    var lossAtCurrent = lossAtFull * scale;
    var excessLoss = Math.max(0, lossAtCurrent - absorbable);
    var futureSaleEnabled = !!(opt && opt.futureSaleEnabled);

    var excessNote = '';
    if (excessLoss > 0) {
      excessNote = '<p class="bs-excess">' +
        '<strong>Excess loss carryforward: ' + _fmt(excessLoss) + '.</strong> ' +
        (futureSaleEnabled
          ? 'Your planned future sale is already factored into the cap; this surplus would only offset $3K/yr of ordinary income unless another sale is added.'
          : 'No planned future sale to absorb it &mdash; carries against ordinary income at $3K/yr only. Add a future sale on Page&nbsp;1 Section&nbsp;07 if there is more property coming.') +
        '</p>';
    }

    return '<div class="brooklyn-slider-block">' +
      '<div class="brooklyn-slider-head">' +
        '<h2>Brooklyn Investment</h2>' +
        '<p class="brooklyn-slider-sub">Drag to override the optimizer. The marker shows the level that absorbs ' + _fmt(absorbable) + ' of gain exactly.</p>' +
      '</div>' +
      '<div class="brooklyn-slider-amounts">' +
        '<div><span class="bs-label">Investment</span><span class="bs-amt">' + _fmt(current) + '</span></div>' +
        '<div><span class="bs-label">Loss generated</span><span class="bs-amt">' + _fmt(lossAtCurrent) + '</span></div>' +
        '<div><span class="bs-label">Excess</span><span class="bs-amt' + (excessLoss > 0 ? ' is-warn' : '') + '">' + _fmt(excessLoss) + '</span></div>' +
      '</div>' +
      '<div class="brooklyn-slider-track-wrap">' +
        '<input type="range" min="0" max="' + Math.round(availCap) + '" step="' + step + '" value="' + Math.round(current) + '" id="brooklyn-investment-slider" class="brooklyn-slider">' +
        '<div class="brooklyn-slider-marker" style="left:' + recPct.toFixed(2) + '%" aria-hidden="true" title="Optimizer cap (' + _fmt(recommended) + ')"></div>' +
      '</div>' +
      '<div class="brooklyn-slider-actions">' +
        '<button type="button" class="bs-btn" data-bs-action="revert">&larr; Revert to optimizer</button>' +
        '<button type="button" class="bs-btn" data-bs-action="max">Max (full capital) &rarr;</button>' +
      '</div>' +
      excessNote +
    '</div>';
  }

  root.renderStrategySummary = renderStrategySummary;
})(window);
