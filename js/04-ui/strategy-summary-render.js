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
    if (ratio >= 10)  return ratio.toFixed(0);
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
    var fees = m.fees || 0;
    var primarySavings = Math.max(0, (m.doNothing || 0) - (m.tax || 0));
    var primaryNet = m.net || 0;
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

    // Engagement note about duration: spell out whether the engine
    // extended past the 18-month minimum so the seller understands
    // when they will see the cash.
    var durNote;
    if (entry.type === 'C') {
      if (dur > 18) {
        durNote = '<strong>Sale term:</strong> ' + dur + ' months. The engine extended past the 18-month minimum because a longer term yielded the highest projected net for this transaction size. Recognition starts in Year ' + (recYr || 2) + ' (' + (year1 + (recYr || 2) - 1) + ').';
      } else {
        durNote = '<strong>Sale term:</strong> 18 months (the regulatory minimum). The engine did not need to extend &mdash; an 18-month structured sale was sufficient. Recognition starts in Year ' + (recYr || 2) + ' (' + (year1 + (recYr || 2) - 1) + ').';
      }
    } else if (entry.type === 'B') {
      durNote = '<strong>Closing date:</strong> January 1, ' + (year1 + 1) + '. The seller defers the close into the next tax year so the entire gain hits Year 2, giving Brooklyn a full Year-1 to stockpile losses against it.';
    } else {
      durNote = '<strong>Closing date:</strong> ' + (currentCfg.implementationDate || (year1 + '-09-15')) + '. Sale proceeds receive their tax treatment in the current calendar year.';
    }

    var html = '';

    // Top intro band
    html += '<div class="forward-intro">' +
      '<h1>Moving Forward With Brookhaven</h1>' +
      '<p>The setup pays for itself many times over in tax savings. Below is the full breakdown of <em>' + _stratName(entry.type) + '</em> &mdash; what you pay (Brooklyn position fees + Brookhaven planning fees) and what it returns.</p>' +
    '</div>';

    html += '<div class="forward-layout">';

    // ============ LEFT COLUMN ============
    html += '<div class="forward-inputs">';

    // Section: Selected Strategy
    html += '<div class="input-section">' +
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
            'Horizon ' + horizon + 'y &middot; Leverage ' + leverage + '%' +
            (entry.type === 'C' ? ' &middot; ' + dur + ' mo' : '') +
          '</div>' +
        '</div>' +
      '</div>' +
    '</div>';

    // Section: Supplemental Strategies (left column, sits between
    // Selected Strategy and Fees Baked In). Only renders when at least
    // one supplemental was marked Interested on Page 4. Each row is a
    // single line — toggle, name, signed contribution. Toggling a row
    // re-runs the master solver and updates the hero numbers above.
    if (enabledSupplements.length || (solverOut && solverOut.anyInterested)) {
      html += _renderSupplementalLeftColumn(solverOut);
    }

    // Section: Fees Included
    html += '<div class="input-section" id="fee-strategies-section">' +
      '<div class="section-heading">' +
        '<h2>Fees Baked In</h2>' +
        '<span class="num">REVIEW</span>' +
      '</div>' +
      '<div class="section-body">' +
        _bullet('Brooklyn fees<span class="strat-savings-line">Borrow + fund + short-side carry over the position</span>', m.brooklynFees || 0) +
        _bullet('Brookhaven fees<span class="strat-savings-line">Planning engagement + ongoing service (flat schedule)</span>', m.brookhavenFees || 0) +
        '<div class="fee-summary-row">' +
          '<div class="fee-summary-label">Total Fees</div>' +
          '<div class="fee-summary-amt">' + _fmt(fees) + '</div>' +
        '</div>' +
      '</div>' +
    '</div>';

    // Section: Engagement Notes
    html += '<div class="input-section">' +
      '<div class="section-heading">' +
        '<h2>Engagement Notes</h2>' +
        '<span class="num">REFERENCE</span>' +
      '</div>' +
      '<div class="section-body" style="font-size:13px;line-height:1.6;color:var(--ink-soft);">' +
        '<p style="margin-bottom:10px;">' + durNote + '</p>' +
        '<p style="margin-bottom:10px;"><strong>Horizon:</strong> ' + horizon + ' years. The dollar figures below are <em>cumulative across the full horizon</em> &mdash; not single-year. The Page-1 baseline shows the single-year do-nothing tax; this page shows the multi-year sum so fees and savings are on the same time scale.</p>' +
        '<p style="margin-bottom:10px;"><strong>Total losses generated (' + horizon + '-yr):</strong> ' + _fmt(entry.loss || 0) + '. Brooklyn produces these year-by-year; only the recognition year(s) actually need the offset.</p>' +
        '<p style="margin-bottom:10px;"><strong>Do-nothing tax baseline (' + horizon + '-yr):</strong> ' + _fmt(m.doNothing || 0) + '. This is what the client would owe with no planning across the full horizon.</p>' +
        '<p style="margin-bottom:10px;"><strong>Tax with strategy (' + horizon + '-yr):</strong> ' + _fmt(m.tax || 0) + '. Difference is the projected savings shown to the right.</p>' +
      '</div>' +
    '</div>';

    html += '</div>'; // /forward-inputs

    // ============ RIGHT COLUMN ============
    html += '<div class="forward-results">';

    // ROI Hero — relabeled "Return on Planning" (was "Return on Fees")
    // and the multiplier + × are slightly bigger per user spec.
    html += '<div class="roi-hero">' +
      '<div class="roi-label">Return on Planning</div>' +
      '<div class="roi-multiple">' + _fmtMultiplier(roi) + '<span class="x">&times;</span></div>' +
      '<div class="roi-sub">For every $1 paid in planning, $' + _fmtMultiplier(roi) + ' is returned in projected tax savings</div>' +
    '</div>';

    // Compare Row + Net. Order is now: You Save → Total Fees → Net
    // Benefit (footer) so the reading flow is "you save this, you pay
    // this, you net this" instead of comparing-via-versus. The "vs."
    // separator is gone — both sides are now part of the same story
    // about the strategy's outcome.
    html += '<div class="forward-compare">' +
      '<div class="compare-row">' +
        '<div class="compare-side savings">' +
          '<div class="compare-label">You Save</div>' +
          '<div class="compare-amt"><span class="currency">$</span>' + Math.round(savings).toLocaleString('en-US') + '</div>' +
          '<div class="compare-detail">Total projected tax savings vs. doing nothing</div>' +
        '</div>' +
        '<div class="compare-side cost">' +
          '<div class="compare-label">Total Fees</div>' +
          '<div class="compare-amt"><span class="currency">$</span>' + Math.round(fees).toLocaleString('en-US') + '</div>' +
          '<div class="compare-detail">Brooklyn position + Brookhaven planning</div>' +
        '</div>' +
      '</div>' +
      '<div class="compare-net">' +
        '<div class="net-label">Net Benefit</div>' +
        '<div class="net-amt"><span class="currency">$</span>' + Math.round(net).toLocaleString('en-US') + '</div>' +
      '</div>' +
    '</div>';

    // Bar Viz
    html += '<div class="forward-viz">' +
      '<div class="viz-row">' +
        '<div class="viz-label">Total Fees</div>' +
        '<div class="viz-bar-wrap">' +
          '<div class="viz-bar fee" style="width:' + feePct.toFixed(2) + '%"></div>' +
          '<span class="viz-amt">' + _fmt(fees) + '</span>' +
        '</div>' +
      '</div>' +
      '<div class="viz-row">' +
        '<div class="viz-label">Tax Savings</div>' +
        '<div class="viz-bar-wrap">' +
          '<div class="viz-bar savings" style="width:' + savePct.toFixed(2) + '%"></div>' +
          '<span class="viz-amt">' + _fmt(savings) + '</span>' +
        '</div>' +
      '</div>' +
    '</div>';

    // Bottom-line callout removed per user spec (placeholder phrasing
    // didn't add value; will be re-introduced with better copy later).

    html += '</div>'; // /forward-results
    html += '</div>'; // /forward-layout

    // Implementation panel — hidden by default, expand via the small
    // triangle on the trailing dash. Advisor-only audit view: shows
    // the dollar allocation across Brooklyn + each enabled supplemental
    // so the math can be checked (no double-spending sale proceeds).
    // Not for client presentation — kept minimal and quiet.
    html += _renderImplementationPanel(currentCfg);

    host.innerHTML = html;
    _bindSupplementalToggleEvents();
  }

  function _renderImplementationPanel(cfg) {
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
  }

  root.renderStrategySummary = renderStrategySummary;
})(window);
