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

    // Populate the print-only header block (id="print-header") with
    // the current client name + state + tax year. Hidden on screen
    // via @media not print; visible at top of every printout.
    var clientNameEl = document.getElementById('case-name-input');
    var clientName = clientNameEl ? clientNameEl.value.trim() : '';
    var stateCode  = (currentCfg && currentCfg.state) || '';
    var phClient = document.getElementById('print-header-client');
    var phSub    = document.getElementById('print-header-sub');
    if (phClient) phClient.textContent = clientName || 'Strategy Summary';
    if (phSub) {
      var subParts = [];
      subParts.push('Tax Year ' + year1);
      if (stateCode && stateCode !== 'NONE') subParts.push(stateCode);
      subParts.push(_filingLabel(currentCfg.filingStatus));
      var today = new Date();
      var dateStr = today.toLocaleDateString('en-US',
        { year: 'numeric', month: 'long', day: 'numeric' });
      subParts.push('Prepared ' + dateStr);
      phSub.textContent = subParts.join(' · ');
    }

    // The Brooklyn-investment-optimized callout was removed per advisor
    // spec — the rationale lives in the Implementation panel (audit
    // view) for advisors who want it; the client-facing summary
    // doesn't need the explanation, just the optimized numbers.

    // ============ TOP ROW: Selected Strategy + Supplemental Strategies ============
    // Asset Manager / leverage label — long%/short% pair. The chosen
    // leverage is the most useful single number to surface (per advisor
    // spec); lockup duration moved to the strategy descriptor sub-text.
    //   beta0 (market neutral): long = short
    //   beta1 (default):        long = 100 + short
    var shortPct = (picked && Number.isFinite(picked.shortPct))
      ? picked.shortPct
      : (Number.isFinite(currentCfg.customShortPct)
          ? currentCfg.customShortPct
          : (Number(currentCfg.leverage) || 1) * 100);
    var longPct = (currentCfg.tierKey === 'beta0') ? shortPct : 100 + shortPct;
    var leverageLabel = Math.round(longPct) + '/' + Math.round(shortPct);
    var hasSupps = !!(enabledSupplements.length || (solverOut && solverOut.anyInterested));
    var selectedStrategyHtml = '<div class="input-section forward-strategy-card">' +
      '<div class="section-heading">' +
        '<h2>Selected Strategy</h2>' +
        '<span class="num">STRATEGY ' + _stratNum(entry.type) + '</span>' +
      '</div>' +
      '<div class="section-body forward-strategy-body">' +
        '<div class="input-row forward-strategy-row">' +
          '<div class="label">Strategy<span class="sub">' + _strategyDescriptor(entry.type) + '</span></div>' +
          '<div class="forward-fee-display forward-strategy-name">' +
            _stratName(entry.type) +
          '</div>' +
        '</div>' +
        '<div class="input-row forward-strategy-row">' +
          '<div class="label">Asset Manager<span class="sub">long &percnt; / short &percnt;</span></div>' +
          '<div class="forward-balance forward-strategy-leverage">' + leverageLabel + '</div>' +
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
    // optimizer has dialed Brooklyn back below the absorbable cap,
    // breaking the walkaway↔you-save reconciliation.
    var withPlanningTax = Math.max(0, (m.doNothing || 0) - primarySavings);
    // Walk-away = sale proceeds − tax − fees (+ supplemental net, which
    // is already post-its-own-fees). Subtracting fees on the With-Planning
    // side makes the walkaway numbers TRULY comparable: the delta between
    // No Planning and With Planning equals the Net Benefit shown below
    // (savings − fees + supplementalBenefit). Without fees in the
    // walkaway, the delta over-stated the take-home benefit by the
    // fee amount.
    var walkawayNoPlanning   = salePrice - (m.doNothing || 0);
    var walkawayWithPlanning = salePrice - withPlanningTax - fees + supplementalBenefit;
    var ropMultiplierValue = (fees > 0 && savings > 0) ? (savings / fees) : 0;
    var ropDisplay = (ropMultiplierValue > 0)
      ? _fmtMultiplier(ropMultiplierValue) + '<span class="rop-x">&times;</span>'
      : '—';
    // Inline the multiplier into the sub-copy so it reads as a complete
    // sentence — "every dollar you spend gets you 13.4× back" rather
    // than the abstract "this much back" which forced the reader to
    // glance up at the big number to fill in the blank.
    var ropSubText = (ropMultiplierValue > 0)
      ? 'every dollar you spend gets you ' + _fmtMultiplier(ropMultiplierValue) + '&times; back'
      : 'every dollar you spend gets you this much back';
    // The hero of Page 5 is now Net Benefit — large, shaded, centered.
    // The walkaway tiles (No Planning / With Planning) sit ABOVE the
    // hero as small white tiles, providing the "before-and-after"
    // context that primes the client to read the Net Benefit dollar.
    // The You-Save / Total-Fees row was removed per advisor spec.
    html += '<div class="forward-rop-row">' +
      '<div class="forward-rop-left">' +
        '<div class="forward-walkaway forward-walkaway-compact">' +
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
        '<div class="forward-net-hero">' +
          '<div class="net-hero-label">Net Benefit</div>' +
          '<div class="net-hero-amt"><span class="currency">$</span>' + Math.round(net).toLocaleString('en-US') + '</div>' +
        '</div>' +
      '</div>' +
      '<div class="forward-rop-square">' +
        '<div class="rop-label">Return on Planning</div>' +
        '<div class="rop-amt">' + ropDisplay + '</div>' +
        '<div class="rop-sub">' + ropSubText + '</div>' +
      '</div>' +
    '</div>';

    // ============ Fees Baked In — Asset Manager + Brookhaven breakdown ============
    // This sits BEFORE the Future Sale Option callout per advisor spec.
    // Logic: walk the client through the existing engagement's fees
    // first ("here's what you'd spend on the current sale"), then —
    // if there's a planned future sale — pivot to "if you size up,
    // here's what additional fees buy you." Tied chronologically.
    html += '<div class="input-section" id="fee-strategies-section">' +
      '<div class="section-heading">' +
        '<h2>Fees Baked In</h2>' +
        '<span class="num">REVIEW</span>' +
      '</div>' +
      '<div class="section-body">' +
        _bullet('Asset Manager fees<span class="strat-savings-line">Borrow + fund + short-side carry over the position' +
          (opt && opt.dialBack ? ' &mdash; scaled to ' + _fmt(opt.recommendedInvestment) + ' invested' : '') +
          '</span>', effectiveBrooklynFees) +
        _bullet('Brookhaven fees<span class="strat-savings-line">Planning engagement + ongoing service (flat schedule)</span>', m.brookhavenFees || 0) +
        '<div class="fee-summary-row">' +
          '<div class="fee-summary-label">Total Fees</div>' +
          '<div class="fee-summary-amt">' + _fmt(fees) + '</div>' +
        '</div>' +
      '</div>' +
    '</div>';

    // ============ Future Sale optimization callout ============
    // Now AFTER fees-baked-in so it reads as a follow-on: "those were
    // the fees on the current sale; here's what additional fees would
    // buy on the future sale." Only renders when futureSale.enabled.
    html += _renderFutureSaleOption(entry, opt, currentCfg);

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

    // The legacy "Print / Save as PDF" button that previously rendered
    // here (window.print() trigger) was removed per advisor spec. The
    // single Download PDF button at the bottom of #page-allocator
    // (index.html, uses html2pdf.js) is the only export control now.

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
      // §1250 recapture line — surfaced separately so the advisor can
      // see WHY total-absorbable-gain might exceed sale LT gain alone.
      // Brooklyn ST losses absorb recapture per IRC §1(h) ordering.
      if (opt.currentRecapture && opt.currentRecapture > 0) {
        rowsOpt += '<div class="impl-row"><span class="impl-name">Current §1250 recapture</span>' +
                   '<span class="impl-amt">' + _fmt(opt.currentRecapture) + '</span></div>';
      }
      if (opt.futureSaleEnabled) {
        rowsOpt += '<div class="impl-row"><span class="impl-name">Future LT gain (planned sale)</span>' +
                   '<span class="impl-amt">' + _fmt(opt.futureLTGain) + '</span></div>';
        if (opt.futureRecapture && opt.futureRecapture > 0) {
          rowsOpt += '<div class="impl-row"><span class="impl-name">Future §1250 recapture</span>' +
                     '<span class="impl-amt">' + _fmt(opt.futureRecapture) + '</span></div>';
        }
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
    // Future-sale option block has no interactive controls — it's a
    // read-only comparison the advisor uses to recommend "yes, also
    // size Brooklyn up to offset the future sale". Any rewiring of
    // Available Capital happens by the advisor on Page 2.
  }

  // -----------------------------------------------------------------
  // Future-Sale Optimization callout. The solver already picked the
  // best Brooklyn investment for the CURRENT sale's gain. If the
  // client has another property sale planned (Page 1 Section 07), the
  // advisor can choose to size Brooklyn UP so the additional loss
  // carries forward and offsets THAT future gain too.
  //
  // Math (linear-scaling — the regression's loss / fee curves are
  // close enough to linear in the operating range):
  //   lossPerDollar = entry.metrics._lossAtFull / availableCapital
  //   feePerDollar  = entry.metrics._brooklynFeesAtFull / availableCapital
  //   investToCoverCurrent = currentLTGain / lossPerDollar
  //   investToCoverBoth    = (currentLTGain + futureLTGain) / lossPerDollar
  //                        = opt.recommendedInvestment (when dialBack)
  //   additionalInvestment = investToCoverBoth - investToCoverCurrent
  //   additionalFees       = additionalInvestment * feePerDollar
  //                          (Brookhaven flat fees don't scale with
  //                           investment — no incremental Brookhaven)
  //   futureSaleTaxSavings = federal LT + state + NIIT on futureLTGain
  //                          (the carryforward fully absorbs futureLTGain
  //                           by construction)
  //
  // Rendered ONLY when:
  //   - cfg.futureSale.enabled
  //   - futureLTGain > 0
  //   - opt.dialBack (otherwise the optimizer is already at availCap and
  //     there's no headroom to grow Brooklyn into)
  //
  // No interactive controls — the advisor either accepts the
  // recommendation (already applied via the optimizer dial-back) or
  // raises Available Capital on Page 2 to honor the larger investment.
  // -----------------------------------------------------------------
  function _renderFutureSaleOption(entry, opt, cfg) {
    // Per advisor spec: only render the section when there's REAL
    // future-sale coverage to discuss. Three early-out cases:
    //   1) No future sale configured at all (Section 07 = No)
    //   2) Future sale configured but futureLT = 0 (no gain to cover)
    //   3) coverageFraction === 0 (gated below — Brooklyn loss can't
    //      reach the future-sale gain)
    // The earlier "Another Sale Coming Up?" hint was removed; the
    // advisor opens Section 07 directly when there's a future sale.
    if (!cfg || !cfg.futureSale || !cfg.futureSale.enabled) return '';

    var futureLT = Math.max(0, Number(cfg.futureSale.longTermGain) || 0);
    if (futureLT <= 0) return '';

    var availCap = Math.max(0, Number(cfg.availableCapital) || 0);
    var lossAtFull = (entry && entry.metrics && entry.metrics._lossAtFull) || 0;
    var feesAtFull = (entry && entry.metrics && entry.metrics._brooklynFeesAtFull) || 0;
    if (availCap <= 0 || lossAtFull <= 0) return '';

    var lossPerDollar = lossAtFull / availCap;
    var feePerDollar  = feesAtFull / availCap;
    if (lossPerDollar <= 0) return '';

    var currentLT = Math.max(0,
      (Number(cfg.salePrice) || 0) - (Number(cfg.costBasis) || 0)
      - (Number(cfg.acceleratedDepreciation) || 0));
    // Recapture is also Brooklyn-loss-absorbable per IRC §1(h)
    // (ST losses → recapture → LT gain → ordinary cap order). Treat
    // currentLT + currentRecap as the current-sale absorbable load
    // so investToCoverCurrent doesn't under-count and the additional-
    // investment row stays consistent with the optimizer's view.
    var currentRecap = Math.max(0,
      Number(cfg.acceleratedDepreciation) || 0);
    var currentAbsorb = currentLT + currentRecap;

    // Investment levels:
    //   investToCoverCurrent — Brooklyn level needed to absorb the
    //     current sale's LT gain + recapture (capped at availCap).
    //   investToCoverBoth    — Brooklyn level needed to absorb both
    //     current and future absorbable gain (capped at availCap).
    //   additionalInvestment — the gap. If availCap is binding, this
    //     may not be enough to fully cover futureLT.
    var investToCoverCurrent = Math.min(availCap, currentAbsorb / lossPerDollar);
    var investToCoverBoth    = Math.min(availCap, (currentAbsorb + futureLT) / lossPerDollar);
    var additionalInvestment = Math.max(0, investToCoverBoth - investToCoverCurrent);
    var additionalFees       = additionalInvestment * feePerDollar;

    // Coverage of the FUTURE sale. The total Brooklyn loss at the
    // both-coverage investment level absorbs the current sale's LT +
    // recapture first; anything left over absorbs future LT. If
    // availableCapital is the binding constraint, that leftover may
    // be less than futureLT — in which case the future-sale tax
    // savings prorate to the actual coverage.
    var totalLossAtBoth = investToCoverBoth * lossPerDollar;
    var futureLTAbsorbed = Math.max(0, Math.min(futureLT, totalLossAtBoth - currentAbsorb));
    var coverageFraction = (futureLT > 0) ? (futureLTAbsorbed / futureLT) : 0;

    // Compute the FULL tax that would be owed on the future LT gain
    // if no carryforward existed — federal + state + NIIT. Then prorate
    // by the coverage fraction so the displayed savings reflect what
    // the additional investment ACTUALLY buys (not aspirational full
    // absorption).
    var saleYear;
    if (cfg.futureSale.saleDate) {
      var d = new Date(cfg.futureSale.saleDate);
      saleYear = isNaN(d.getTime()) ? ((cfg.year1 || 2026) + 3) : d.getFullYear();
    } else {
      saleYear = (cfg.year1 || 2026) + 3;
    }
    var status = cfg.filingStatus || 'mfj';
    var state  = cfg.state || 'NONE';
    var fedSavings = 0, stateSavings = 0;
    try {
      if (typeof root.computeFederalTax === 'function') {
        fedSavings = root.computeFederalTax(0, saleYear, status, {
          longTermGain: futureLT,
          investmentIncome: futureLT,
          wages: 0
        }) || 0;
      }
      if (typeof root.computeStateTax === 'function') {
        stateSavings = root.computeStateTax(futureLT, saleYear, state, status, {
          longTermGain: futureLT
        }) || 0;
      }
    } catch (e) { /* fall through to zero */ }
    var fullFutureTax = Math.max(0, fedSavings + stateSavings);
    // Prorate by coverage. If the additional investment fully covers
    // futureLT, this equals fullFutureTax. If it covers half, it's
    // half the savings.
    var futureSaleTaxSavings = fullFutureTax * coverageFraction;
    var netAdditionalBenefit = futureSaleTaxSavings - additionalFees;
    // Return on the ADDITIONAL fees specifically — the multiplier the
    // advisor uses to frame "every $1 in fees buys $X in future-sale
    // savings." Different from the page's main ROP (which is for the
    // current sale).
    var feeReturnRatio = (additionalFees > 0)
      ? (futureSaleTaxSavings / additionalFees) : 0;

    var benefitClass = netAdditionalBenefit > 0 ? 'fs-benefit-positive'
                     : (netAdditionalBenefit < 0 ? 'fs-benefit-negative' : '');

    // When the optimizer is already pushed to full Available Capital
    // for the current sale, there's no headroom to size Brooklyn UP
    // for the future sale — additionalInvestment and additionalFees
    // both come out to zero. Hiding those rows in that case so the
    // advisor doesn't see a confusing "$0 / $0 / X savings" row set.
    // What we DO show is the future-sale tax savings (the loss
    // carryforward already in flight will absorb it for free) and
    // a clear note about the cost/no-cost framing.
    var hasHeadroom = (additionalInvestment > 0) || (additionalFees > 0);

    // Coverage messaging branches. Three meaningful cases:
    //
    //   coverageFraction === 0 — Brooklyn (at any investment level the
    //     advisor can fund) can't generate carryforward beyond what
    //     the current sale needs. No future-sale absorption available.
    //     Surface a "Available Capital is the bottleneck" framing so
    //     the advisor knows to suggest funding more.
    //
    //   coverageFraction > 0 && !hasHeadroom — the optimizer is already
    //     at availableCapital for the current sale, and the leftover
    //     loss naturally carries forward to absorb some/all of future.
    //     "Bonus" framing — at no additional cost.
    //
    //   coverageFraction > 0 && hasHeadroom — there's room to scale
    //     Brooklyn up. Could be full (100%) or partial coverage; the
    //     prorated-savings line shows the effective benefit either way.
    var fullCoverage   = (coverageFraction >= 0.999);
    var noCoverage     = (coverageFraction <= 0);
    var coveragePctLabel = Math.round(coverageFraction * 100) + '%';

    // Per advisor: if there is NO coverage (Brooklyn can't even
    // partially absorb the future-sale gain), suppress the callout
    // entirely — surfacing it would only confuse the client. Only
    // show the block when there's some real benefit (or full coverage
    // potential) to discuss.
    if (noCoverage) return '';

    var headerTitle;
    var headerCopy;
    if (noCoverage) {
      headerTitle = 'Future Sale Needs More Capital';
      headerCopy  = 'Available Capital is fully consumed by the current sale, so there&rsquo;s no leftover Asset Manager loss to carry forward against your planned <strong>' + _fmt(futureLT) + '</strong> long-term gain in ' + saleYear + '. Increasing Available Capital on Page 1 would unlock future-sale offset.';
    } else if (!hasHeadroom) {
      headerTitle = 'Bonus: Your Future Sale Is Already Covered';
      headerCopy  = 'Asset Manager is already fully deployed for your current sale. The leftover loss carries forward and absorbs <strong>' + coveragePctLabel + '</strong> of your planned <strong>' + _fmt(futureLT) + '</strong> long-term gain in ' + saleYear + ' at no additional cost.';
    } else if (fullCoverage) {
      headerTitle = 'Another Option: Offset Your Future Sale';
      headerCopy  = 'Increase Asset Manager investment so the loss carryforward also fully absorbs your planned <strong>' + _fmt(futureLT) + '</strong> long-term gain in ' + saleYear + '. Same strategy, same horizon &mdash; just sized up. The fees you pay now buy the future-sale offset shown below.';
    } else {
      headerTitle = 'Another Option: Offset Your Future Sale';
      headerCopy  = 'Available Capital limits how much Asset Manager can grow. The additional investment below covers <strong>' + coveragePctLabel + '</strong> of your <strong>' + _fmt(futureLT) + '</strong> long-term gain in ' + saleYear + '; the future-sale tax savings are prorated to that coverage.';
    }

    var headerHtml = '<div class="fs-head">' +
      '<h2>' + headerTitle + '</h2>' +
      '<p class="fs-desc">' + headerCopy + '</p>' +
    '</div>';

    var rowsHtml = '';
    if (hasHeadroom) {
      // Cost-of-offset framing: the additional Brooklyn fees ARE the
      // price paid to also offset the future-sale gain. Surface that
      // explicitly so the advisor can say "for $X in fees you save
      // $Y on the next sale."
      rowsHtml += '<div class="fs-row">' +
        '<div class="fs-label">Additional Asset Manager investment<span class="fs-sub">on top of the optimizer&rsquo;s pick for the current sale</span></div>' +
        '<div class="fs-amt">' + _fmt(additionalInvestment) + '</div>' +
      '</div>';
      rowsHtml += '<div class="fs-row">' +
        '<div class="fs-label">Cost to offset the future sale<span class="fs-sub">additional Asset Manager fees you pay now over the projection horizon</span></div>' +
        '<div class="fs-amt fs-cost">' + _fmt(additionalFees) + '</div>' +
      '</div>';
    }
    rowsHtml += '<div class="fs-row">' +
      '<div class="fs-label">Future-sale tax savings<span class="fs-sub">' + (fullCoverage
            ? 'federal LT + state + NIIT on ' + _fmt(futureLT)
            : coveragePctLabel + ' coverage of ' + _fmt(futureLT) + ' &mdash; ' + _fmt(fullFutureTax) + ' full tax prorated') + '</span></div>' +
      '<div class="fs-amt fs-save">' + _fmt(futureSaleTaxSavings) + '</div>' +
    '</div>';
    if (hasHeadroom && additionalFees > 0 && feeReturnRatio > 0) {
      // Fee-return multiplier — frames the additional spend as ROI on
      // the future sale ("every $1 of fees you pay now buys $X in
      // future-sale savings"). Distinct from the page's main ROP.
      rowsHtml += '<div class="fs-row">' +
        '<div class="fs-label">Return on additional fees<span class="fs-sub">future-sale savings &divide; additional Asset Manager fees</span></div>' +
        '<div class="fs-amt fs-save">' + _fmtMultiplier(feeReturnRatio) + '&times;</div>' +
      '</div>';
    }
    rowsHtml += '<div class="fs-row fs-total">' +
      '<div class="fs-label">Net additional benefit</div>' +
      '<div class="fs-amt ' + benefitClass + '">' + _fmt(netAdditionalBenefit) + '</div>' +
    '</div>';

    // Tag the wrapper so the print stylesheet can hide the callout
    // when there's no real future-sale benefit to print: noCoverage
    // ("can't even cover current sale, can't help future") just adds
    // visual noise on the printout per advisor spec. The on-screen
    // version still shows it so the advisor sees the bottleneck.
    var wrapperClasses = 'future-sale-option';
    if (noCoverage) wrapperClasses += ' fs-no-coverage no-print';
    return '<div class="' + wrapperClasses + '">' +
      headerHtml +
      '<div class="fs-grid">' + rowsHtml + '</div>' +
    '</div>';
  }

  root.renderStrategySummary = renderStrategySummary;
})(window);
