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
    return type === 'A' ? 'Traditional Sale'
      : type === 'B' ? 'Installment Sale'
      : type === 'C' ? 'Structured Installment Sale' : 'Strategy';
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
    // Don't blow away the Future Sales Estimator while the advisor is typing
    // in it. A reactive re-render (the supplemental pipeline / supp-refresh
    // fires on ANY input via document-level listeners) mid-keystroke would
    // replace host.innerHTML, destroying the focused input and eating the
    // caret — the "click in, edit, then it poses out" bug. The estimator is a
    // standalone calc whose rows live in window.__rettFutureSalesPlanner and
    // recompute themselves on input, so skipping the full re-render while one
    // of its fields is focused loses nothing; it renders normally once focus
    // leaves. Single-point guard so EVERY re-render source is covered.
    // (advisor 2026-06-17.)
    // Only skip when the focused fsp-input is INSIDE this host (would be
    // destroyed by the re-render). The future-sale inputs now live on Page 1
    // (#future-sale-inputs-host), a different host — re-rendering Tab 6 while
    // one of those is focused is harmless, and blocking it left the summary
    // stale after future-sale edits (advisor 2026-06-22). host.contains scopes
    // the guard back to its original intent.
    var _ae = (typeof document !== 'undefined') ? document.activeElement : null;
    if (_ae && _ae.classList && _ae.classList.contains('fsp-input') && host.contains(_ae)) return;
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
    // Force-recompute supp math before solving. Oil & Gas / Delphi
    // calcs are strategy-dependent (year-count comes from
    // _resolvedSaleStrategyKey()) but only re-fire on supp-input events,
    // NOT on __rettChosenStrategy changes. Without this prefix call,
    // switching A→B→C left lastResult frozen at the prior strategy's
    // year-count, causing the hero, admin, and Tab 7 to display
    // different OG values for the same scenario.
    if (typeof root.__rettRunAllSuppMath === 'function') {
      try { root.__rettRunAllSuppMath(); } catch (e) { /* */ }
    }
    // Pull supplementals through the master solver. The rivalry has
    // already decided which Interested supps actually get funded —
    // anything rejected (brooklyn-beats, capital-exhausted, negative-net)
    // contributes zero to the client's plan because no dollars deploy
    // to it. master-solver's totalSupplementalBenefit is the
    // rivalry-filtered sum (FUNDED supps only), so the hero numbers
    // stay consistent with the Implementation panel and the per-supp
    // rows below: a rejected supp shows $0 everywhere and is excluded
    // from totals everywhere.
    // Cap funded-supp benefit at the tax remaining after the chosen
    // (primary) strategy — supps can't save tax Brooklyn already
    // eliminated (advisor 2026-06-09). Without this the hero over-claims.
    var _ppCap = (typeof root.__rettResidualCapForEntry === 'function')
      ? root.__rettResidualCapForEntry(entry) : null;
    var solverOut = (typeof root.runMasterSolver === 'function')
      ? root.runMasterSolver(primaryNet, (_ppCap != null ? { postPrimaryTaxRemaining: _ppCap } : undefined)) : null;
    // Honest (recompute-based) supplemental benefit — the actual stacked tax
    // saved, not the master solver's standalone-marginal-rate sum (which
    // overstates when several ordinary-deduction supps stack). Falls back to
    // the solver total when the recompute helper isn't available (advisor
    // 2026-06-10).
    var _solverSupp = (solverOut && Number.isFinite(solverOut.totalSupplementalBenefit))
      ? Number(solverOut.totalSupplementalBenefit)
      : null;
    var supplementalBenefit = (_solverSupp != null) ? _solverSupp : 0;
    if (typeof root.__rettHonestSuppBenefitForEntry === 'function') {
      try {
        var _honest = root.__rettHonestSuppBenefitForEntry(entry, solverOut);
        if (Number.isFinite(_honest)) {
          // The honest recompute only sees each supp's ORDINARY offset, so it
          // correctly TRIMS overstated stacking of ordinary-deduction supps —
          // but it OVERSTATES a character-conversion supp (Delphi adds LT gain
          // + qualified dividends it can't see, so it counts the ordinary
          // savings without the offsetting capital-gain cost). Let it correct
          // the benefit DOWN only, never above the solver's already-correct
          // realized total (which DOES net the added gain). (advisor 2026-06-17.)
          supplementalBenefit = (_solverSupp != null) ? Math.min(_solverSupp, _honest) : _honest;
        }
      } catch (e) { /* keep solver value */ }
    }
    // For print iteration / per-supp rows: only the FUNDED supps
    // surface as contributing. Rejected supps still appear in
    // _renderSupplementalLeftColumn (so the advisor sees the toggle)
    // but with $0 + a reason note, not a positive number.
    var fundedSupplements = (solverOut && solverOut.supplementals)
      ? solverOut.supplementals.filter(function (s) {
          return s.enabled && s.available && s.rivalry && s.rivalry.funded;
        })
      : [];
    // Brookhaven flat per-strategy SETUP fees (advisor-entered on the Temp
    // page, persisted in window.__rettSuppSetupFees). Charged ONCE per FUNDED
    // supplemental strategy (rivalry funded + dollars granted), regardless of
    // how many investments deploy. Unlike the management fees already netted
    // into each supp's honest benefit, the setup fee is a NEW cost not yet
    // reflected anywhere, so: (1) subtract it from each funded supp's own
    // displayed net benefit — mutate realizedNetBenefit/netBenefit ONCE,
    // guarded, so every per-supp display site reflects it; (2) subtract the
    // total from the overall net here; (3) add it to the ROP denominator and
    // the Fees Baked In total below. Only funded supps (which add net benefit)
    // are charged, so this only bites when there's a benefit to reduce.
    var _suppSetupFeeMap = (window.__rettSuppSetupFees && typeof window.__rettSuppSetupFees === 'object')
      ? window.__rettSuppSetupFees : {};
    var appliedSetupFees = 0;
    (solverOut && solverOut.supplementals ? solverOut.supplementals : []).forEach(function (s) {
      if (!(s.rivalry && s.rivalry.funded && (s.rivalry.granted || 0) > 0)) return;
      var setup = Math.max(0, Number(_suppSetupFeeMap[s.id]) || 0);
      if (setup <= 0) return;
      appliedSetupFees += setup;
      if (!s._setupFeeApplied) {
        if (Number.isFinite(Number(s.realizedNetBenefit))) s.realizedNetBenefit = Number(s.realizedNetBenefit) - setup;
        if (Number.isFinite(Number(s.netBenefit)))         s.netBenefit         = Number(s.netBenefit) - setup;
        s._setupFeeApplied = true;
      }
    });
    var savings = primarySavings + supplementalBenefit;
    var net = primaryNet + supplementalBenefit - appliedSetupFees;
    // Supplemental fees the client actually pays on FUNDED supps — Delphi-style
    // mgmtFeeDollars + the flat Brookhaven setup fee. Computed up here so the
    // Return on Planning denominator below uses the SAME total the Fees Baked
    // In section shows. (advisor 2026-06-17: ROP was dividing by Brooklyn +
    // setup fees only, omitting the supp management fee, so it overstated —
    // e.g. $340K net / $85K instead of / $140K total fees → 400% vs 243%.)
    var fundedSuppFees = (solverOut && solverOut.supplementals ? solverOut.supplementals : [])
      .filter(function (s) { return s.rivalry && s.rivalry.funded && (s.rivalry.granted || 0) > 0; })
      .map(function (s) {
        var mgmtFee  = Number(s.result && s.result.mgmtFeeDollars) || 0;
        var setupFee = Math.max(0, Number(_suppSetupFeeMap[s.id]) || 0);
        return { id: s.id, fee: mgmtFee + setupFee };
      })
      .filter(function (x) { return x.fee > 0; });
    var suppFeesTotal = fundedSuppFees.reduce(function (sum, s) { return sum + s.fee; }, 0);
    var totalFeesAll = fees + suppFeesTotal;   // all fees: Brooklyn + Brookhaven + supp mgmt + setup

    // ---- Multi-sale string: layer the future sales onto the summary ----
    // (advisor 2026-06-22) When the client flagged future sales, the Strategy
    // Summary reflects ALL their sales: the Net Benefit hero, Return on
    // Planning, the No/With-Planning walk-aways, and Fees Baked In all become
    // collective = this sale (engine net, incl. supplementals) + the
    // future-sales installment estimate. Supplementals stay tied to the
    // current/granular sale. Single-sale string is untouched (futures = 0).
    var _summaryMultiSale = false;
    try { var _fyS = document.getElementById('future-sale-yes-no'); _summaryMultiSale = !!(_fyS && _fyS.value === 'yes'); } catch (e) { _summaryMultiSale = false; }
    var _fbSummary = (_summaryMultiSale && typeof root.__rettFutureInstallmentBenefit === 'function')
      ? root.__rettFutureInstallmentBenefit() : null;
    var futureNet = _fbSummary ? (Number(_fbSummary.net) || 0) : 0;
    var futureFees = _fbSummary ? (Number(_fbSummary.fees) || 0) : 0;
    var futureTaxSaved = _fbSummary ? (Number(_fbSummary.taxSaved) || 0) : 0;
    var isMultiSummary = _summaryMultiSale && (futureNet > 0 || futureFees > 0);
    var displayNet = net + futureNet;            // collective net when multi, = net otherwise
    var displayFees = totalFeesAll + futureFees;  // collective fees when multi
    var displaySavings = savings + futureTaxSaved; // collective tax saved when multi (= savings single-sale)
    // Return on Planning expressed as a percentage of NET benefit over
    // fees ("for every $1 of fees, you get back $X of net benefit",
    // rendered as a percentage). Was a multiplier (× back); switched per
    // advisor 2026-05-09 to a percent so it reads as a clean ROI figure
    // (e.g. 828%) instead of "8.3×". Uses net (not savings) so the
    // numerator is the true take-home benefit shown on the hero.
    var roi = fees > 0 ? (net / fees) : 0;
    var maxBar = Math.max(fees, savings, 1);
    var feePct = Math.max(1, (fees / maxBar) * 100);
    var savePct = Math.max(1, (savings / maxBar) * 100);

    var picked = entry.picked || {};
    var dur = picked.durationMonths || 36;
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
    // Selected Strategy + Supplementals block moved BELOW the value block
    // (advisor 2026-06-22) — rendered after the Net Benefit / Return on
    // Planning hero. See its new location below.

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
    // Walk-away on the SALE-ONLY basis (advisor 2026-06-12). "No Planning"
    // = Tab 2's "Cash Kept from Sale" (sale price − tax ON THE SALE) — read
    // straight from that tile's DOM so it's the EXACT figure the client saw,
    // exactly as the Projection page (Tab 4) does. Previously this used
    // salePrice − m.doNothing (TOTAL tax), which wrongly subtracted the
    // client's recurring W-2 income tax from the sale walk-away and made this
    // tile ~$94k lower than Tab 2 for the same scenario. "With Planning" =
    // "No Planning" + Net Benefit, so the delta between the two tiles still
    // equals the Net Benefit shown below (net = savings − fees + suppBenefit).
    var _cashKeptEl = (typeof document !== 'undefined') ? document.getElementById('bt-cash-kept') : null;
    var _cashKeptFromSale = (_cashKeptEl && typeof parseUSD === 'function' && _cashKeptEl.textContent)
      ? (parseUSD(_cashKeptEl.textContent) || 0)
      : (salePrice - (m.doNothing || 0));   // fallback if Tab 2 hasn't rendered yet
    var walkawayNoPlanning   = _cashKeptFromSale;   // collective cash-kept on the multi-sale string (Tab 2 already collective)
    var walkawayWithPlanning = _cashKeptFromSale + displayNet;
    // Return on Planning rendered as a percentage = (net / fees) × 100.
    // Was a multiplier (× back) earlier; switched to percent per advisor
    // 2026-05-09 so the headline reads as an ROI figure ("828%") rather
    // than the abstract "8.3×". Uses NET benefit over fees (not gross
    // savings) — the numerator matches the hero number above.
    var ropRatio = (displayFees > 0 && displayNet > 0) ? (displayNet / displayFees) : 0;
    var ropPctNum = Math.round(ropRatio * 100);
    var ropDisplay = (ropRatio > 0)
      ? ropPctNum.toLocaleString('en-US') + '<span class="rop-x">%</span>'
      : '—';
    // Inline the percent into the sub-copy so it reads as a complete
    // sentence — "every dollar you spend gets you 828% back" rather
    // than the abstract "this much back" which forced the reader to
    // glance up at the big number to fill in the blank.
    var ropSubText = (ropRatio > 0)
      ? 'every dollar you spend gets you ' + ropPctNum.toLocaleString('en-US') + '% back'
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
              // When the with-planning walk-away exceeds the sale price, the
              // planning offset baseline (non-sale) income tax on top of the
              // sale tax — flag it with a small side note so the figure
              // doesn't look like a typo. (advisor 2026-06-12.)
              '<div class="walkaway-tagline">what you walk away with' +
                (walkawayWithPlanning > salePrice
                  ? '<span class="walkaway-sidenote"> &mdash; incl. additional baseline offset</span>'
                  : '') +
              '</div>' +
            '</div>' +
          '</div>' +
        '</div>' +
        '<div class="forward-net-hero" data-net-hero title="Double-click to see how this benefit breaks down">' +
          '<div class="net-hero-label">' + (isMultiSummary ? 'Net Benefit &mdash; All Sales' : 'Net Benefit') + '</div>' +
          '<div class="net-hero-amt"><span class="currency">$</span>' + Math.round(displayNet).toLocaleString('en-US') + '</div>' +
          // 3-part breakdown of the net benefit, hidden by default;
          // double-clicking the hero toggles .is-expanded and reveals
          // it. Cash / charity / asset categorization comes from the
          // master-solver supplementals' incomeBucket field (mapped
          // from spec.bucket at registration time). Brooklyn's primary
          // net is always 'cash'.
          _renderNetBenefitBreakdown(primaryNet, solverOut, futureNet) +
        '</div>' +
      '</div>' +
      '<div class="forward-rop-square">' +
        '<div class="rop-label">Return on Planning</div>' +
        '<div class="rop-amt">' + ropDisplay + '</div>' +
        '<div class="rop-sub">' + ropSubText + '</div>' +
      '</div>' +
    '</div>';

    // ============ Selected Strategy + Supplemental Strategies ============
    // Sits BELOW the Net Benefit / Return on Planning value block (advisor
    // 2026-06-22): the client lands on the value first, then we name the
    // strategy + supplementals. Asset Manager leverage row removed per the
    // same spec — just the strategy name, supplementals directly under it.
    html += '<div class="input-section forward-strategy-block">' +
      '<div class="section-heading">' +
        '<h2>Selected Strategy</h2>' +
        '<span class="num">STRATEGY ' + _stratNum(entry.type) + '</span>' +
      '</div>' +
      '<div class="section-body">' +
        '<div class="forward-strategy-body">' +
          '<div class="input-row forward-strategy-row">' +
            '<div class="label">Strategy<span class="sub">' + _strategyDescriptor(entry.type) + '</span></div>' +
            '<div class="forward-fee-display forward-strategy-name">' +
              _stratName(entry.type) +
            '</div>' +
          '</div>' +
        '</div>' +
        _renderSupplementalLeftColumn(solverOut) +
      '</div>' +
    '</div>';

    // ============ Fees Baked In — Asset Manager + Brookhaven breakdown ============
    // This sits BEFORE the Future Sale Option callout per advisor spec.
    // Logic: walk the client through the existing engagement's fees
    // first ("here's what you'd spend on the current sale"), then —
    // if there's a planned future sale — pivot to "if you size up,
    // here's what additional fees buy you." Tied chronologically.
    // fundedSuppFees / suppFeesTotal / totalFeesAll are computed up top (so the
    // ROP denominator matches). The bullet for the supp fees lives here.
    var suppFeeBullet = suppFeesTotal > 0
      ? _bullet('Supplemental Strategy Fees', suppFeesTotal)
      : '';

    html += '<div class="input-section" id="fee-strategies-section">' +
      '<div class="section-heading">' +
        '<h2>Fees Baked In</h2>' +
        '<button type="button" class="num section-review-btn" id="fee-review-btn" aria-expanded="false" title="Toggle side-by-side baseline vs. strategy reconciliation">REVIEW &#9662;</button>' +
      '</div>' +
      '<div class="section-body">' +
        _bullet('Asset Manager fees', effectiveBrooklynFees) +
        suppFeeBullet +
        _bullet('Brookhaven fees', m.brookhavenFees || 0) +
        (isMultiSummary ? _bullet('Future sales fees', futureFees) : '') +
        '<div class="fee-summary-row">' +
          '<div class="fee-summary-label">Total Fees</div>' +
          '<div class="fee-summary-amt">' + _fmt(displayFees) + '</div>' +
        '</div>' +
        _renderReconciliationPanel(entry, currentCfg, solverOut, fundedSupplements) +
      '</div>' +
    '</div>';

    // ============ Savings by Sale (multi-sale string) ============
    // Per-sale net benefit across the current sale + each future sale; sums to
    // the collective Net Benefit hero (advisor 2026-06-22).
    if (isMultiSummary) {
      var _curGain = Math.max(0, salePrice - ((currentCfg && Number(currentCfg.costBasis)) || 0));
      html += _renderPerSaleSavingsTable(_curGain, net, _fbSummary);
    }

    // ============ Grow-your-net-benefit projection ============
    // Sits at the very bottom — below the Future Sale callout when it
    // renders, takes that slot when it's hidden. Empty inputs by
    // design (no defaults — advisor enters years and assumed return
    // live in the meeting based on client risk profile).
    // Growth phase begins AFTER the strategy's loss-generation horizon
    // is complete (taxes paid, capital freed) — so start year is the
    // first calendar year after year1 + horizon. Falls back to year1 + 5
    // when horizon is unknown so the chart still renders sensibly.
    var growthStartYear = (Number(year1) || (new Date()).getFullYear())
      + (Number(horizon) || 5);
    html += _renderGrowthProjection(displayNet, growthStartYear);

    // Engagement Notes section removed per advisor spec — the
    // information lives in the Implementation panel (audit) and on
    // Page 1 already; no need to repeat it on the client-facing
    // summary.

    // Implementation panel (advisor-only audit triangle) REMOVED from the
    // Strategy Summary per advisor 2026-06-12 — the same allocation/audit
    // detail lives on the Temporary page (CPA view + fees panel), which is
    // where the advisor goes to verify the math. _renderImplementationPanel
    // is left defined (unused) in case it's wanted back.
    // html += _renderImplementationPanel(currentCfg, entry.loss || 0, opt);

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
      brookhavenFees: m.brookhavenFees || 0,
      fees:           fees,
      // Collective when multi-sale (= current single-sale): the leave-behind's
      // You Save + Total fees must be on the SAME (all-sales) basis as its Net
      // Benefit so the print matches the on-screen summary and ties out
      // (net = savings - fees). Single-sale: futures are 0, so these are
      // identical to the prior current-only values (no change). (advisor 2026-06-23)
      savings:        displaySavings,
      net:            displayNet,
      futureFees:     futureFees,
      roi:            roi,
      // Return on Planning — use the SAME ratio the on-screen ROP square
      // shows (net / (fees + setup fees)) so the printout and the screen
      // never disagree. The legacy `roi` (net/fees) is left passed for
      // back-compat but the print view reads `rop`.
      rop:            ropRatio,
      horizon:        horizon,
      leverage:       leverage,
      leverageLabel:  leverageLabel,
      dur:            dur,
      recYr:          recYr,
      year1:          year1,
      supplements:    fundedSupplements,
      supplementalBenefit: supplementalBenefit,
      // Fee roll-up for the "Fees" block at the bottom of the leave-behind.
      suppFeesTotal:  suppFeesTotal,
      totalFeesAll:   displayFees,
      suppSetupFeeMap: _suppSetupFeeMap
    });

    host.innerHTML = html;
    _bindSupplementalToggleEvents();
    _bindReviewToggle();
    // Repopulate the growth chart from the preserved input values
    // immediately after a re-render so the user doesn't see an empty
    // chart between re-render and their next keystroke.
    try { _refreshGrowthChart(); } catch (e) { /* */ }
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

    var stratLabel  = d.entry.type === 'A' ? 'Traditional Sale'
      : d.entry.type === 'B' ? 'Installment Sale'
      : 'Structured Installment Sale';
    var stratNum = d.entry.type === 'A' ? '01' : d.entry.type === 'B' ? '02' : '03';

    // Email field will eventually pull from the Pre-Meeting
    // Questionnaire. Until that's wired up, we render a muted
    // placeholder so the row still renders proportionally.
    var clientEmail = (typeof root.__rettCaseEmail !== 'undefined' && root.__rettCaseEmail)
      ? root.__rettCaseEmail
      : ((document.getElementById('case-email-input') || {}).value || '');

    // Outer .print-doc-frame draws the bordered "leave-behind" card.
    // Header mirrors the trade-booth wall: RETT wordmark + 3-bar
    // glyph on the LEFT, client name/email/date stacked on the
    // RIGHT, with an amber rule beneath.
    var glyphSVG = '<svg class="print-brand-glyph" viewBox="0 0 40 40" xmlns="http://www.w3.org/2000/svg">' +
      '<rect x="4"  y="16" width="7" height="20" fill="#1e4f9a"/>' +
      '<rect x="15" y="8"  width="7" height="28" fill="#1e4f9a"/>' +
      '<rect x="26" y="3"  width="7" height="33" fill="#6dc5e8"/>' +
    '</svg>';
    var h = '<div class="print-view"><div class="print-doc-frame">';
    h += '<div class="print-header">' +
      '<div class="print-header-brand">' +
        glyphSVG +
        '<div class="print-brand-text">' +
          '<div class="print-brand-rett-line">RETT<sup>&trade;</sup></div>' +
          '<div class="print-brand-sub">Real Estate Transition Trust</div>' +
        '</div>' +
      '</div>' +
      '<div class="print-header-meta">' +
        '<span class="print-client-name">' + (clientName || 'Client Name') + '</span>' +
        // Only render the email line when we actually have one — no
        // "email pending" placeholder on the client leave-behind
        // (advisor 2026-06-15).
        (clientEmail ? '<span class="print-client-email">' + clientEmail + '</span>' : '') +
        '<span class="print-date">Prepared ' + dateStr + '</span>' +
      '</div>' +
    '</div>';
    h += '<div class="print-rule"></div>';

    // Title block
    h += '<div class="print-title-block">' +
      '<h1 class="print-title">Moving Forward With Brookhaven</h1>' +
      // Filing status + state live in the "What You Told Us" block below,
      // so the tag stays lean: just the strategy number + name
      // (advisor 2026-06-15).
      '<div class="print-strategy-tag">Strategy ' + stratNum + ' &mdash; ' + stratLabel + '</div>' +
    '</div>';

    // The printout reads as a top-to-bottom narrative (advisor 2026-06-15):
    //   1. What You Told Us   — the client inputs, summarized (one income
    //      figure + the sale + its gain), NOT a line-by-line breakdown.
    //   2. Your Strategy      — the primary strategy + any supplemental
    //      strategies, each with its return and the fees baked into it.
    //   3. What We Save You    — You Save / Net Benefit / Return on Planning.
    //   4. Fees                — the full fee roll-up, at the very bottom.
    var reportedIncome = Number(cfg.baseOrdinaryIncome) || 0;
    var salePriceV     = Number(cfg.salePrice) || 0;
    var costBasisV     = Number(cfg.costBasis) || 0;
    // The SALE's long-term gain is computed from the property fields, NOT
    // cfg.baseLongTermGain (that's the separate Section-02 "other capital
    // gains" input). Mirror inputs-collector's formula exactly:
    //   ltGain   = max(0, salePrice − costBasis − depreciation − stPropGain)
    //   recapture = depreciation taken (the part taxed at recapture rates)
    var accelDepV      = Number(cfg.acceleratedDepreciation) || 0;
    var stPropGainV    = Number(cfg.shortTermPropertyGain) || 0;
    var ltGainV        = Math.max(0, salePriceV - costBasisV - accelDepV - stPropGainV);
    var recaptureV     = Math.max(0, accelDepV);
    // Return on Planning — combined net benefit (primary + supps) over the
    // combined fees, mirroring the on-screen ROP square exactly so the
    // printout and the live page never disagree (advisor 2026-06-15: do
    // NOT compute a per-supp %, which goes infinite for fee-free supps —
    // sum the nets, sum the fees, divide once).
    var ropRatioP    = Number(d.rop) || 0;
    var ropPct       = Math.round(ropRatioP * 100);
    var ropPerDollar = (ropRatioP > 0) ? ropRatioP.toFixed(2) : '0.00';
    var suppSetupMap = d.suppSetupFeeMap || {};

    // ===== 1 + 2 : "What You Told Us"  |  "Your Strategy" (two columns) =====
    h += '<div class="print-body">';

    // LEFT: client-input summary, simplified to a single income figure.
    h += '<div class="print-col">';
    h += '<div class="print-section">' +
      '<div class="print-section-head">What You Told Us</div>' +
      '<table class="print-table"><tbody>' +
        '<tr><td>Reported annual income</td><td class="print-r">' + _fmt(reportedIncome) + '</td></tr>' +
        '<tr><td>Property sale price</td><td class="print-r">' + _fmt(salePriceV) + '</td></tr>' +
        '<tr><td>Cost basis</td><td class="print-r">' + _fmt(costBasisV) + '</td></tr>' +
        '<tr><td>Long-term capital gain</td><td class="print-r">' + _fmt(ltGainV) + '</td></tr>' +
        (recaptureV > 0
          ? '<tr><td>Depreciation recapture</td><td class="print-r">' + _fmt(recaptureV) + '</td></tr>'
          : '') +
        '<tr><td>Filing &middot; State</td><td class="print-r">' + _filingLabel(cfg.filingStatus) +
          ' &middot; ' + (cfg.state && cfg.state !== 'NONE' ? cfg.state : '&mdash;') + '</td></tr>' +
      '</tbody></table>' +
    '</div>';
    h += '</div>'; // /print-col left

    // RIGHT: the strategy we selected + supplemental strategies.
    h += '<div class="print-col">';
    h += '<div class="print-section">' +
      '<div class="print-section-head">Your Strategy</div>' +
      '<table class="print-table"><tbody>' +
        '<tr><td>Main strategy</td><td class="print-r"><strong>' + stratLabel + '</strong></td></tr>' +
        (d.leverageLabel
          ? '<tr><td>Asset Manager (long / short)</td><td class="print-r"><strong>' + d.leverageLabel + '</strong></td></tr>'
          : '') +
        '<tr><td>Tax year</td><td class="print-r">' + year1 + '</td></tr>' +
        (entry.type === 'C'
          ? '<tr><td>Structured sale term</td><td class="print-r">' + d.dur + ' months</td></tr>'
          : '') +
      '</tbody></table>' +
    '</div>';

    if (d.supplements && d.supplements.length) {
      var suppRows = '';
      d.supplements.forEach(function (s) {
        // Saturation-adjusted realized net (matches the on-screen per-supp
        // rows and the combined-net hero). Skip supps the shared ordinary
        // pool fully crowded out (realized $0) — they add nothing.
        var printNet = Number.isFinite(Number(s.realizedNetBenefit))
          ? Number(s.realizedNetBenefit)
          : (Number(s.netBenefit) || 0);
        if (printNet <= 0) return;
        // Per advisor 2026-06-15: the supplemental block tells the client
        // only WHAT they picked and the RETURN — the fees live in the
        // "Fees" roll-up at the bottom, so no per-supp fee column here.
        suppRows += '<tr><td>' + s.name + '</td>' +
          '<td class="print-num print-green">+' + _fmt(printNet) + '</td></tr>';
      });
      if (suppRows) {
        h += '<div class="print-section">' +
          '<div class="print-section-head">Supplemental Strategies</div>' +
          '<table class="print-table">' +
            '<thead><tr><th>Strategy</th><th class="print-num">Return</th></tr></thead>' +
            '<tbody>' + suppRows + '</tbody>' +
          '</table>' +
        '</div>';
      }
    }
    h += '</div>'; // /print-col right
    h += '</div>'; // /print-body

    // ===== 3 : "What We Save You" (hero) =====
    h += '<div class="print-section-head print-savings-head">What We Save You</div>';
    h += '<div class="print-hero-row">' +
      '<div class="print-hero-box">' +
        '<div class="print-hero-label">You Save</div>' +
        '<div class="print-hero-value">' + _fmt(savings) + '</div>' +
        '<div class="print-hero-sub">Total projected tax saved vs. doing nothing</div>' +
      '</div>' +
      '<div class="print-hero-box print-hero-net">' +
        '<div class="print-hero-label">Net Benefit</div>' +
        '<div class="print-hero-value">' + _fmt(net) + '</div>' +
        '<div class="print-hero-sub">After all fees shown below</div>' +
      '</div>' +
      '<div class="print-hero-box">' +
        '<div class="print-hero-label">Return on Planning</div>' +
        '<div class="print-hero-value">' + ropPct.toLocaleString('en-US') + '%</div>' +
        '<div class="print-hero-sub">$' + ropPerDollar + ' back for every $1 in fees</div>' +
      '</div>' +
    '</div>';

    // "Investment optimized" note removed from the client leave-behind per
    // advisor 2026-06-15 — the dial-back rationale is internal and isn't
    // shown to the client.

    // ===== 4 : "Fees" (the full roll-up, at the very bottom) =====
    h += '<div class="print-section print-fees-section">' +
      '<div class="print-section-head">Fees</div>' +
      '<table class="print-table"><tbody>' +
        '<tr><td>Asset Manager fees</td><td class="print-num">' + _fmt(d.effectiveBkFees) + '</td></tr>' +
        (Number(d.suppFeesTotal) > 0
          ? '<tr><td>Supplemental strategy fees</td><td class="print-num">' + _fmt(d.suppFeesTotal) + '</td></tr>'
          : '') +
        '<tr><td>Brookhaven planning &amp; advisory</td><td class="print-num">' + _fmt(d.brookhavenFees || 0) + '</td></tr>' +
        (Number(d.futureFees) > 0
          ? '<tr><td>Future sales fees</td><td class="print-num">' + _fmt(d.futureFees) + '</td></tr>'
          : '') +
        '<tr class="print-total-row"><td><strong>Total fees</strong></td><td class="print-num"><strong>' + _fmt(d.totalFeesAll) + '</strong></td></tr>' +
      '</tbody></table>' +
    '</div>';

    h += '<div class="print-footer">' +
      '<div class="print-footer-attrib">' +
        '<span class="print-footer-bh">BrookHaven</span>' +
        '<span class="print-footer-bh-sub">Integrated Wealth Solutions &middot; A Multi-Family Office</span>' +
      '</div>' +
      '<p class="print-footer-disclaimer">' +
        'This document is provided for informational and discussion purposes only and does not constitute tax, legal, accounting, or investment advice. ' +
        'All figures shown are estimates based on current tax law and the information provided; they are not guarantees, and actual financial results may differ materially from these estimates. ' +
        'Please consult your own tax, legal, and financial advisors before acting on any strategy described here.' +
      '</p>' +
    '</div>';

    h += '</div></div>'; // /print-doc-frame /print-view
    return h;
  }

  // -----------------------------------------------------------------
  // REVIEW reconciliation panel — toggled by the "REVIEW ▾" button on
  // the Fees Baked In header. Hidden by default. Two-column side-by-
  // side: LEFT shows the Tax Baseline (what the client would pay with
  // no strategy applied), RIGHT shows every strategy effect that
  // alters those baseline buckets, with explicit subtraction. Lets the
  // advisor manually verify net benefit by walking the math:
  // baseline minus offsets equals post-strategy result.
  // -----------------------------------------------------------------
  function _renderReconciliationPanel(entry, cfg, solverOut, fundedSupplements) {
    if (!entry || !entry.cfg) return '';
    // Engine doesn't attach rows to the summary entry — re-run engine
    // with entry.cfg to recover the per-year breakdown.
    var ecfg = entry.cfg;
    if (typeof root.rettFlavorEngineCfg === 'function') ecfg = root.rettFlavorEngineCfg(ecfg);
    var engineOut = (typeof root.unifiedTaxComparison === 'function')
      ? root.unifiedTaxComparison(ecfg) : null;
    var rows = (engineOut && engineOut.rows) || [];
    if (!rows.length) return '';
    var r0base = rows[0]?.baseline || {};
    var r0with = rows[0]?.withStrategy || {};
    var totalLossApplied = rows.reduce(function (s, r) { return s + (Number(r.lossApplied) || 0); }, 0);
    var totalGainRecognized = rows.reduce(function (s, r) { return s + (Number(r.gainRecognized) || 0); }, 0);

    // Per-supp contribution to the offsets — pull from each spec's
    // lastResult to show what bucket it touches.
    var suppEffects = [];
    (fundedSupplements || []).forEach(function (s) {
      // Realized (post shared-ordinary-pool saturation) benefit.
      var benefit = Number.isFinite(Number(s.realizedNetBenefit))
        ? Number(s.realizedNetBenefit) : (Number(s.netBenefit) || 0);
      if (benefit <= 0) return;
      // Best-effort label of which bucket the supp affects.
      // Most placeholder-rail supps are ordinary-income deductions;
      // PTET shifts state↔federal; Charitable is itemized deduction;
      // O&G/Delphi are ordinary-income offsets.
      var bucket = 'Ordinary income';
      if (s.id === 'ptet') bucket = 'State income tax';
      if (s.id === 'charitableGifts') bucket = 'Itemized deduction (ordinary)';
      if (s.id === 'delphi') bucket = 'Ordinary → LT conversion';
      suppEffects.push({ id: s.id, name: s.name, benefit: benefit, bucket: bucket });
    });

    var suppRowsHtml = suppEffects.map(function (s) {
      return '<div class="recon-row recon-supp">' +
        '<div class="recon-label">' + s.name + ' &mdash; <span class="recon-bucket">' + s.bucket + '</span></div>' +
        '<div class="recon-amt">&minus;' + _fmt(s.benefit) + '</div>' +
      '</div>';
    }).join('');

    var brooklynNetBenefit = (Number(r0base.federal) || 0) - (Number(r0with.federal) || 0)
                            + (Number(r0base.state)   || 0) - (Number(r0with.state)   || 0);
    // Aggregate across all years for total federal+state savings tied to Brooklyn
    var totalFedSav = rows.reduce(function (s, r) { return s + ((Number(r.baseline?.federal) || 0) - (Number(r.withStrategy?.federal) || 0)); }, 0);
    var totalStateSav = rows.reduce(function (s, r) { return s + ((Number(r.baseline?.state) || 0) - (Number(r.withStrategy?.state) || 0)); }, 0);

    return '' +
      '<div class="recon-panel" id="fee-review-panel" hidden>' +
        '<div class="recon-intro">Side-by-side reconciliation. <strong>Left:</strong> what the client would pay without any planning. <strong>Right:</strong> each lever pulled and what it offset, with subtraction. Manual check: baseline &minus; offsets should equal post-strategy tax bill.</div>' +
        '<div class="recon-grid">' +
          '<div class="recon-col recon-col-left">' +
            '<div class="recon-col-head">Tax Baseline (no planning)</div>' +
            '<div class="recon-row"><div class="recon-label">Ordinary income</div><div class="recon-amt">' + _fmt(cfg.baseOrdinaryIncome) + '</div></div>' +
            '<div class="recon-row"><div class="recon-label">Long-term capital gain</div><div class="recon-amt">' + _fmt(cfg.baseLongTermGain) + '</div></div>' +
            '<div class="recon-row"><div class="recon-label">§1250 recapture</div><div class="recon-amt">' + _fmt(cfg.recapture || 0) + '</div></div>' +
            '<div class="recon-row recon-divider"></div>' +
            '<div class="recon-row"><div class="recon-label">Federal income tax</div><div class="recon-amt">' + _fmt(r0base.federalIncomeTax) + '</div></div>' +
            '<div class="recon-row"><div class="recon-label">AMT top-up</div><div class="recon-amt">' + _fmt(r0base.amt || 0) + '</div></div>' +
            '<div class="recon-row"><div class="recon-label">NIIT (3.8%)</div><div class="recon-amt">' + _fmt(r0base.niit || 0) + '</div></div>' +
            '<div class="recon-row"><div class="recon-label">State income tax</div><div class="recon-amt">' + _fmt(r0base.state || 0) + '</div></div>' +
            '<div class="recon-row recon-total"><div class="recon-label">Total tax</div><div class="recon-amt">' + _fmt(r0base.total) + '</div></div>' +
          '</div>' +
          '<div class="recon-col recon-col-right">' +
            '<div class="recon-col-head">Strategy effects (offsets)</div>' +
            '<div class="recon-row recon-supp"><div class="recon-label">Brooklyn loss applied to gain &mdash; <span class="recon-bucket">LT gain / §1250 recapture</span></div><div class="recon-amt">&minus;' + _fmt(totalLossApplied) + '</div></div>' +
            suppRowsHtml +
            '<div class="recon-row recon-divider"></div>' +
            '<div class="recon-row"><div class="recon-label">Federal tax savings (Y0)</div><div class="recon-amt">&minus;' + _fmt((Number(r0base.federal) || 0) - (Number(r0with.federal) || 0)) + '</div></div>' +
            '<div class="recon-row"><div class="recon-label">State tax savings (Y0)</div><div class="recon-amt">&minus;' + _fmt((Number(r0base.state) || 0) - (Number(r0with.state) || 0)) + '</div></div>' +
            '<div class="recon-row recon-divider"></div>' +
            '<div class="recon-row recon-total"><div class="recon-label">Total tax with strategy</div><div class="recon-amt">' + _fmt(r0with.total) + '</div></div>' +
          '</div>' +
        '</div>' +
        '<div class="recon-checkmath">Reconciliation check: <strong>' + _fmt(r0base.total) + '</strong> baseline &minus; <strong>' + _fmt((Number(r0base.total) || 0) - (Number(r0with.total) || 0)) + '</strong> Y0 savings = <strong>' + _fmt(r0with.total) + '</strong> after strategy. ✓</div>' +
      '</div>';
  }

  function _renderImplementationPanel(cfg, brooklynCumulativeLoss, precomputedOpt) {
    if (typeof root.runAllocator !== 'function') return '';
    // The cfg passed in here has already been reduced by buildInterestedSummary
    // to "availableCapital after rivalry consumed supps" — Brooklyn's slice.
    // The panel needs the ORIGINAL pre-rivalry capital so we can show
    // dollars flowing both to supps AND to Brooklyn.
    var rawCfg = (typeof root.collectInputs === 'function') ? root.collectInputs() : null;
    var totalAvailable = (rawCfg && Number(rawCfg.availableCapital)) ||
                         (cfg && Number(cfg.availableCapital)) || 0;
    var alloc = root.runAllocator(totalAvailable);
    var rows = '';
    rows += '<div class="impl-row"><span class="impl-name">Total available capital</span>' +
            '<span class="impl-amt">' + _fmt(alloc.totalAvailable) + '</span></div>';
    // Only show supplementals that actually receive dollars. Tax-side
    // strategies (PTET, Augusta, 401(k), heavy vehicle, charitable
    // gifts) deploy $0 of sale-proceed capital — they belong on the
    // Page-5 supplemental row list, not in the dollar-allocation
    // panel. Rivalry-rejected supps also drop out (they didn't get
    // capital). The panel's job is showing where dollars flow.
    alloc.supplementals
      .filter(function (s) { return Number(s.investment) > 0; })
      .forEach(function (s) {
        rows += '<div class="impl-row impl-row-supp">' +
                '<span class="impl-name">&rarr; ' + s.name + '</span>' +
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

  // 3-part breakdown of the Net Benefit hero. Categorizes each
  // contributing strategy's net into cash / charity / physical-asset
  // buckets so the advisor can show the client where the savings
  // landed (advisor 2026-05-06): "you walk away with $X cash, donated
  // $Y to charity, bought $Z of physical assets." Hidden by default;
  // double-clicking the hero reveals it.
  //
  // Categorization comes from the supp's `incomeBucket` field
  // (registry maps it from spec.bucket). 'charity' → charity bucket,
  // 'asset' → physical-asset bucket, anything else → cash bucket.
  // Brooklyn's primary net is always cash.
  function _renderNetBenefitBreakdown(primaryNet, solverOut, futureNet) {
    var cashNet = Number(primaryNet) || 0;
    var charityNet = 0;
    var assetNet = 0;
    var charitySpend = 0;
    var assetSpend = 0;
    if (solverOut && Array.isArray(solverOut.supplementals)) {
      solverOut.supplementals.forEach(function (s) {
        if (!(s.enabled && s.available && s.rivalry && s.rivalry.funded)) return;
        // Use realized (post shared-ordinary-pool saturation) benefit so
        // the breakdown sums to the saturated hero, not the raw double-count.
        var net = Number.isFinite(Number(s.realizedNetBenefit))
          ? Number(s.realizedNetBenefit) : (Number(s.netBenefit) || 0);
        var bucket = String(s.incomeBucket || 'cash').toLowerCase();
        if (bucket === 'charity') {
          charityNet += net;
          // Track the gift amount for context.
          var gift = Number(s.result && s.result.detail && s.result.detail.giftAmount) || 0;
          charitySpend += gift;
        } else if (bucket === 'asset') {
          assetNet += net;
          var assetCost = Number(s.result && s.result.assetCost) || 0;
          if (!assetCost && s.result && s.result.detail) {
            assetCost = Number(s.result.detail.assetCost) || 0;
          }
          assetSpend += assetCost;
        } else {
          cashNet += net;
        }
      });
    }
    var _futNet = Number(futureNet) || 0;
    var totalNet = cashNet + charityNet + assetNet + _futNet;
    if (totalNet === 0) return '';
    var rows = [
      { label: _futNet > 0 ? 'This sale' : 'Cash savings', value: cashNet, sub: 'Tax-only strategies + Brooklyn position' }
    ];
    if (charityNet > 0 || charitySpend > 0) {
      rows.push({
        label: 'Charitable giving',
        value: charityNet,
        sub: charitySpend > 0
          ? 'You donated ' + _fmt(charitySpend) + '; tax savings shown'
          : 'Tax savings from gift deduction'
      });
    }
    if (assetNet > 0 || assetSpend > 0) {
      rows.push({
        label: 'Physical-asset purchases',
        value: assetNet,
        sub: assetSpend > 0
          ? 'Asset acquisitions of ' + _fmt(assetSpend) + '; tax savings shown'
          : 'Depreciation tax savings on asset purchases'
      });
    }
    if (_futNet > 0) {
      rows.push({ label: 'Future sales', value: _futNet,
        sub: 'Installment offset across your planned sales' });
    }
    var html = '<div class="net-hero-breakdown" hidden>';
    rows.forEach(function (r) {
      html += '<div class="net-hero-breakdown-row">' +
        '<div class="net-hero-breakdown-label">' + r.label +
          '<div class="net-hero-breakdown-sub">' + r.sub + '</div>' +
        '</div>' +
        '<div class="net-hero-breakdown-amt">' + _fmt(r.value) + '</div>' +
      '</div>';
    });
    html += '</div>';
    return html;
  }

  // Per-sale savings table for the multi-sale string (advisor 2026-06-22):
  // "here's all your sales, here's how much we saved you per sale." Current
  // sale = its engine net (incl. supplementals); future sales = the installment
  // estimate, pro-rated so the rows sum to the collective net the hero shows
  // (the optimizer pools cross-sale carryforward, so per-sale is an allocation,
  // not a standalone figure). Falls back to gain-weighting if the independent
  // per-sale nets are non-positive. Total reconciles to currentNet + fb.net.
  function _renderPerSaleSavingsTable(currentGain, currentNet, fb) {
    var perSale = (fb && fb.perSale) || [];
    if (!perSale.length) return '';
    var proj = (typeof root.__rettFutureSalesProjected === 'function')
      ? root.__rettFutureSalesProjected().filter(function (f) { return f.gain > 0; }) : [];
    var indepTotal = perSale.reduce(function (s, p) { return s + (Number(p.net) || 0); }, 0);
    var gainTotal = perSale.reduce(function (s, p) { return s + (Number(p.gain) || 0); }, 0);
    var target = Number(fb.net) || 0;
    function shareNet(p) {
      if (indepTotal > 0) return (Number(p.net) || 0) * (target / indepTotal);
      if (gainTotal > 0) return target * ((Number(p.gain) || 0) / gainTotal);
      return 0;
    }
    function _saleRow(label, amt, cls) {
      return '<tr class="savings-row' + (cls ? ' ' + cls : '') + '">' +
        '<td class="savings-sale-label">' + label + '</td>' +
        '<td class="savings-amt">' + _fmt(amt) + '</td>' +
      '</tr>';
    }
    // Future rows ordered chronologically by sale year (current sale is now,
    // so it stays first). Pro-rated net carried per row.
    var futures = perSale.map(function (p, i) {
      return { saleYear: proj[i] ? proj[i].saleYear : null, net: shareNet(p) };
    }).sort(function (a, b) { return (a.saleYear || 0) - (b.saleYear || 0); });
    var body = _saleRow('Current Sale', currentNet);
    futures.forEach(function (f, i) {
      var label = 'Future Sale' + (f.saleYear ? ' &middot; ' + f.saleYear : ' ' + (i + 1));
      body += _saleRow(label, f.net);
    });
    var totalSaved = currentNet + target;
    return '<div class="input-section savings-by-sale-section">' +
      '<div class="section-heading"><h2>Savings by Sale</h2></div>' +
      '<div class="section-body">' +
        '<table class="savings-table">' +
          '<thead><tr><th>Sale</th><th class="savings-amt-head">We Saved You</th></tr></thead>' +
          '<tbody>' + body + '</tbody>' +
          '<tfoot>' + _saleRow('Total Saved', totalSaved, 'savings-total-row') + '</tfoot>' +
        '</table>' +
      '</div>' +
    '</div>';
  }

  function _renderSupplementalLeftColumn(solverOut) {
    if (!solverOut || !solverOut.anyInterested) return '';
    // Only surface supps that actually contribute. Rivalry-rejected
    // supps (Brooklyn-beats, capital-exhausted, negative-net) and
    // pending / disabled rows are hidden — the advisor explains in
    // conversation that some Interested picks didn't add benefit and
    // were dropped. Keeps Page 5 focused on what the client gets.
    function _realized(s) {
      return Number.isFinite(Number(s.realizedNetBenefit))
        ? Number(s.realizedNetBenefit) : (Number(s.netBenefit) || 0);
    }
    // ACTIVE = supps currently adding benefit (enabled, funded, realized > 0).
    var active = solverOut.supplementals.filter(function (s) {
      if (!s.enabled || !s.available) return false;
      if (s.rivalry && !s.rivalry.funded) return false;
      // Hide supps the shared ordinary pool fully crowded out (realized $0)
      // — they don't add to the client's net, so they shouldn't list here.
      return _realized(s) > 0;
    });
    // INACTIVE = Interested supps the advisor has TOGGLED OFF. Keep them
    // visible as a muted row with the toggle (unchecked) so they can be
    // flipped back on — toggling a supplemental off must NOT make it vanish
    // (advisor 2026-06-12: "what if I want to bring it back"). Still skips
    // supps that never produced a result (nothing to bring back).
    var inactive = solverOut.supplementals.filter(function (s) {
      // Toggled off — keep visible regardless of whether the disabled supp
      // still has a computed result. Capital supps (Equipment Leasing, Farm)
      // auto-size to $0 when disabled, which nulls their result (available =
      // false); we still want the muted row + re-enable toggle.
      return !s.enabled;
    });
    if (!active.length && !inactive.length) return '';
    function _suppRow(s, isActive) {
      var amt, rowAttr, checked;
      if (isActive) {
        var rNet = _realized(s);
        amt = (rNet >= 0 ? '+' : '') + _fmt(rNet);
        rowAttr = ''; checked = ' checked';
      } else {
        amt = 'Not active';
        rowAttr = ' style="opacity:.5"'; checked = '';
      }
      return '' +
        '<div class="supp-strat-row" data-supp-row="' + s.id + '"' + rowAttr + '>' +
          '<label class="supp-row-toggle">' +
            '<input type="checkbox" data-supp-toggle="' + s.id + '"' + checked + '>' +
            '<span class="supp-row-switch" aria-hidden="true"></span>' +
          '</label>' +
          '<div class="supp-strat-name">' + s.name + '</div>' +
          '<div class="supp-strat-amt">' + amt + '</div>' +
        '</div>';
    }
    var rows = active.map(function (s) { return _suppRow(s, true); })
      .concat(inactive.map(function (s) { return _suppRow(s, false); }))
      .join('');

    // Bare sub-section (no standalone card) — nests inside the Selected
    // Strategy block so the two read as one full-width section. The advisor
    // flips supps on/off via the switches here (advisor 2026-06-17).
    return '' +
      '<div class="forward-supp-subsection">' +
        '<div class="forward-supp-subhead">Supplemental Strategies' +
          '<span class="forward-supp-hint">tap a switch to add or remove</span>' +
        '</div>' +
        rows +
      '</div>';
  }

  // Toggle the REVIEW reconciliation panel via the section-heading button.
  function _bindReviewToggle() {
    var btn = document.getElementById('fee-review-btn');
    var panel = document.getElementById('fee-review-panel');
    if (!btn || !panel || btn.dataset.bound) return;
    btn.dataset.bound = '1';
    btn.addEventListener('click', function () {
      var isOpen = !panel.hasAttribute('hidden');
      if (isOpen) {
        panel.setAttribute('hidden', '');
        btn.setAttribute('aria-expanded', 'false');
        btn.innerHTML = 'REVIEW &#9662;';
      } else {
        panel.removeAttribute('hidden');
        btn.setAttribute('aria-expanded', 'true');
        btn.innerHTML = 'REVIEW &#9652;';
      }
    });
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
  // -----------------------------------------------------------------
  // Grow-your-net-benefit projection. Sits at the bottom of Page 5;
  // renders ONLY when net benefit > 0. Two empty inputs (no defaults
  // — advisor enters years + assumed return live, calibrated to the
  // client's risk profile). Chart populates on input.
  // -----------------------------------------------------------------
  function _renderGrowthProjection(net, startYear) {
    var principal = Math.round(Number(net) || 0);
    if (principal <= 0) return '';
    var sy = Number(startYear) || (new Date()).getFullYear();
    var startISO = sy + '-01-01';

    // Preserve any in-progress values across Page-5 re-renders.
    // Without this, ANY trigger that re-renders the strategy
    // summary (input event elsewhere, toggle change, etc.) would
    // blow the user's typed End Date / Return back to empty.
    var prevEndEl = document.getElementById('growth-end-date');
    var prevRetEl = document.getElementById('growth-return');
    var prevEnd = prevEndEl ? (prevEndEl.value || '') : '';
    var prevRet = prevRetEl ? (prevRetEl.value || '') : '';
    var endValAttr = prevEnd ? ' value="' + prevEnd + '"' : '';
    var retValAttr = prevRet ? ' value="' + prevRet + '"' : '';

    return '<div class="growth-projection" data-net-benefit="' + principal +
              '" data-start-year="' + sy + '" data-start-iso="' + startISO + '">' +
      '<div class="growth-head">' +
        '<h2>Grow Your Net Benefit</h2>' +
        '<div class="growth-savings-hero">' +
          '<span class="growth-savings-label">Net Benefit (to invest)</span>' +
          '<span class="growth-savings-amt">' + _fmt(principal) + '</span>' +
        '</div>' +
        '<p class="growth-desc">The growth phase starts when planning wraps and capital is freed; pick the date the client wants the money out and an assumed annual return.</p>' +
      '</div>' +
      '<div class="growth-input-row">' +
        '<label class="growth-input-cell">' +
          '<span class="growth-input-label">End Date</span>' +
          '<span class="growth-input-wrap">' +
            '<input type="date" id="growth-end-date" class="growth-input" min="' + startISO + '" autocomplete="off"' + endValAttr + '>' +
          '</span>' +
          '<span class="growth-input-help">Growth starts Jan 1, ' + sy + '</span>' +
        '</label>' +
        '<label class="growth-input-cell">' +
          '<span class="growth-input-label">Assumed Annual Return</span>' +
          '<span class="growth-input-wrap">' +
            '<input type="number" id="growth-return" class="growth-input" min="0" max="50" step="0.1" inputmode="decimal" autocomplete="off"' + retValAttr + '>' +
            '<span class="growth-input-suffix">%</span>' +
          '</span>' +
        '</label>' +
      '</div>' +
      '<div class="growth-chart-host" id="growth-chart-host" aria-hidden="true"></div>' +
      '<div class="growth-final" id="growth-final"></div>' +
    '</div>';
  }

  function _fmtUSDShort(n) {
    n = Math.round(Number(n) || 0);
    if (n >= 1e9) return '$' + (n / 1e9).toFixed(2).replace(/\.?0+$/, '') + 'B';
    if (n >= 1e6) return '$' + (n / 1e6).toFixed(2).replace(/\.?0+$/, '') + 'M';
    if (n >= 1e3) return '$' + (n / 1e3).toFixed(0) + 'K';
    return '$' + n.toLocaleString('en-US');
  }

  function _refreshGrowthChart() {
    var card = document.querySelector('.growth-projection');
    if (!card) return;
    var principal = Number(card.getAttribute('data-net-benefit')) || 0;
    var startYear = Number(card.getAttribute('data-start-year')) || (new Date()).getFullYear();
    var startISO  = card.getAttribute('data-start-iso') || (startYear + '-01-01');
    var startDate = new Date(startISO + 'T00:00:00');

    var chartHost  = document.getElementById('growth-chart-host');
    var finalHost  = document.getElementById('growth-final');
    var heroAmt    = card.querySelector('.growth-savings-amt');
    var heroLabel  = card.querySelector('.growth-savings-label');
    if (!chartHost || !finalHost) return;
    var endEl    = document.getElementById('growth-end-date');
    var returnEl = document.getElementById('growth-return');
    var rawEnd    = endEl    ? String(endEl.value).trim()    : '';
    var rawReturn = returnEl ? String(returnEl.value).trim() : '';
    var ret = Number(rawReturn);

    // End date must be after start; return must be a valid number.
    var endDate = rawEnd ? new Date(rawEnd + 'T00:00:00') : null;
    var hasValidEnd = endDate && !isNaN(endDate.getTime()) && endDate > startDate;
    var hasReturn   = rawReturn !== '' && Number.isFinite(ret) && ret >= 0 && ret <= 50;
    if (!hasValidEnd || !hasReturn || principal <= 0) {
      chartHost.innerHTML = '';
      finalHost.innerHTML = '';
      chartHost.setAttribute('aria-hidden', 'true');
      if (heroAmt)   heroAmt.textContent = _fmt(principal);
      if (heroLabel) heroLabel.textContent = 'Net Benefit (to invest)';
      return;
    }
    chartHost.setAttribute('aria-hidden', 'false');

    // Continuous-time fractional years between start and end so the
    // final value reflects the exact picked date rather than rounding
    // to whole years.
    var msPerYear = 365.2425 * 24 * 3600 * 1000;
    var totalYears = (endDate - startDate) / msPerYear;
    if (totalYears <= 0) {
      chartHost.innerHTML = ''; finalHost.innerHTML = '';
      chartHost.setAttribute('aria-hidden', 'true');
      return;
    }
    var r = ret / 100;
    var n = Math.max(1, Math.ceil(totalYears));         // grid years for x-axis
    var endYear = startYear + n;
    var pts = [];
    for (var i = 0; i <= n; i++) pts.push(principal * Math.pow(1 + r, i));
    var finalVal = principal * Math.pow(1 + r, totalYears);

    // Larger chart per advisor spec.
    var W = 920, H = 360;
    var padL = 80, padR = 32, padT = 32, padB = 48;
    var innerW = W - padL - padR;
    var innerH = H - padT - padB;
    var vmin = pts[0];
    var vmax = Math.max(pts[pts.length - 1], finalVal);
    var range = vmax - vmin;
    function xAt(i) { return padL + (i / Math.max(1, n)) * innerW; }
    function yAt(v) {
      if (range <= 0) return padT + innerH / 2;
      return padT + innerH - ((v - vmin) / range) * innerH;
    }

    var svg = '';
    svg += '<svg class="growth-chart-svg" viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Growth projection chart">';
    svg += '<defs><linearGradient id="growthFill" x1="0" x2="0" y1="0" y2="1">' +
           '<stop offset="0" stop-color="var(--bh-blue)" stop-opacity="0.28"/>' +
           '<stop offset="1" stop-color="var(--bh-blue)" stop-opacity="0.02"/>' +
           '</linearGradient></defs>';

    // Y-axis gridlines + labels.
    for (var g = 0; g <= 4; g++) {
      var gy = padT + (g / 4) * innerH;
      var gv = vmax - (g / 4) * range;
      svg += '<line x1="' + padL + '" x2="' + (W - padR) + '" y1="' + gy + '" y2="' + gy +
             '" stroke="var(--rule-soft)" stroke-width="1" stroke-dasharray="2 4"/>';
      svg += '<text x="' + (padL - 10) + '" y="' + (gy + 4) +
             '" text-anchor="end" font-size="12" fill="var(--muted)" font-family="var(--font-mono)">' +
             _fmtUSDShort(gv) + '</text>';
    }

    // X-axis: calendar years. When the horizon is long, thin the
    // labels (every Nth year) but keep a dot at every year so the
    // hover tooltips line up.
    var step = (n <= 10) ? 1 : (n <= 20 ? 2 : Math.ceil(n / 8));
    for (var k = 0; k <= n; k += step) {
      var tx = xAt(k);
      svg += '<text x="' + tx + '" y="' + (H - padB + 22) +
             '" text-anchor="middle" font-size="12" fill="var(--muted)" font-family="var(--font-mono)">' +
             (startYear + k) + '</text>';
    }
    if ((n % step) !== 0) {
      var lx = xAt(n);
      svg += '<text x="' + lx + '" y="' + (H - padB + 22) +
             '" text-anchor="middle" font-size="12" fill="var(--muted)" font-family="var(--font-mono)">' +
             endYear + '</text>';
    }

    // Area + line.
    var areaPath = 'M ' + xAt(0) + ' ' + yAt(pts[0]);
    var linePath = 'M ' + xAt(0) + ' ' + yAt(pts[0]);
    for (var p = 1; p <= n; p++) {
      areaPath += ' L ' + xAt(p) + ' ' + yAt(pts[p]);
      linePath += ' L ' + xAt(p) + ' ' + yAt(pts[p]);
    }
    areaPath += ' L ' + xAt(n) + ' ' + (padT + innerH) + ' L ' + xAt(0) + ' ' + (padT + innerH) + ' Z';
    svg += '<path d="' + areaPath + '" fill="url(#growthFill)" stroke="none"/>';
    svg += '<path d="' + linePath + '" fill="none" stroke="var(--bh-blue-deep)" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>';

    // Per-year dots with hover tooltips. The native <title> tag
    // surfaces the dollar amount + calendar year on cursor hover —
    // no JS popover needed. Larger hit-target via an outer transparent
    // circle so the tooltip is easy to trigger on dense charts.
    for (var d = 0; d <= n; d++) {
      var cx = xAt(d), cy = yAt(pts[d]);
      var yr = startYear + d;
      var amt = pts[d];
      svg += '<g class="growth-dot-group">' +
        '<circle class="growth-dot-hit" cx="' + cx + '" cy="' + cy + '" r="14" fill="transparent">' +
          '<title>' + yr + ': ' + _fmt(Math.round(amt)) + '</title>' +
        '</circle>' +
        '<circle class="growth-dot" cx="' + cx + '" cy="' + cy + '" r="3.5" fill="var(--bh-blue-deep)" pointer-events="none"></circle>' +
      '</g>';
    }

    svg += '</svg>';
    chartHost.innerHTML = svg;

    // The grown value lives in the top hero now. Bottom block carries
    // only the date + rate context as a quiet caption.
    var endLabel = endDate.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
    if (heroAmt)   heroAmt.textContent = _fmt(Math.round(finalVal));
    if (heroLabel) heroLabel.textContent = 'Grown To';
    finalHost.innerHTML =
      '<div class="growth-final-sub">' + endLabel + ' &middot; ' + ret + '% annual return</div>';
  }

  // =====================================================================
  // Future Sales Estimator (advisor 2026-06-17) — a standalone, simple
  // multi-row table for ballparking the tax on the client's FUTURE property
  // sales. Each row: planned date, sale price, cost basis → gain (price −
  // basis) and estimated tax (gain × [23.8% federal LTCG+NIIT + the client's
  // state top rate]). Purely informational — it does NOT feed the engine,
  // the optimizer, or the net-benefit hero. Rows + values persist in
  // window.__rettFutureSalesPlanner + localStorage so they survive re-renders
  // and reloads. Sits between "Fees Baked In" and "Grow Your Net Benefit".
  // -----------------------------------------------------------------
  var FSP_KEY = 'rettFutureSalesPlanner';
  function _fspState() {
    if (!Array.isArray(root.__rettFutureSalesPlanner)) {
      var init = null;
      try {
        var s = JSON.parse((root.localStorage && root.localStorage.getItem(FSP_KEY)) || 'null');
        if (Array.isArray(s)) init = s;
      } catch (e) { /* ignore */ }
      root.__rettFutureSalesPlanner = init || [
        { yearsUntil: 0, salePrice: 0, costBasis: 0, growth: 0 },
        { yearsUntil: 0, salePrice: 0, costBasis: 0, growth: 0 },
        { yearsUntil: 0, salePrice: 0, costBasis: 0, growth: 0 }
      ];
    }
    return root.__rettFutureSalesPlanner;
  }
  function _fspPersist() {
    try { root.localStorage.setItem(FSP_KEY, JSON.stringify(_fspState())); } catch (e) { /* ignore */ }
  }
  function _fspParse(v) {
    return Math.max(0, Number(String(v == null ? '' : v).replace(/[^0-9.]/g, '')) || 0);
  }
  // Federal LTCG + NIIT for the high-bracket clients this tool targets.
  var FSP_FED_RATE = 0.238;
  // Client's effective top state rate on a large LT gain (captures the top
  // marginal bracket + any state LTCG preferential treatment via the engine's
  // own computeStateTax). NONE/no-tax states → 0.
  function _fspCombinedRate() {
    var state = 'NONE', year = (new Date()).getFullYear(), status = 'mfj';
    try {
      var ci = root.collectInputs() || {};
      state  = ci.state || ci.stateCode || 'NONE';
      year   = Number(ci.year1) || year;
      status = ci.filingStatus || 'mfj';
    } catch (e) { /* defaults */ }
    var BIG = 10000000, st = 0;
    if (typeof root.computeStateTax === 'function') {
      try { st = Number(root.computeStateTax(BIG, year, state, status, { longTermGain: BIG })) || 0; }
      catch (e) { st = 0; }
    }
    var stateRate = BIG > 0 ? (st / BIG) : 0;
    return { fed: FSP_FED_RATE, state: stateRate, combined: FSP_FED_RATE + stateRate, stateCode: state };
  }
  // Exposed so the Tax Implications page (baseline-table.js) taxes future
  // sales at the SAME 23.8% LTCG+NIIT + state rate the estimator uses.
  root.__rettFspCombinedRate = _fspCombinedRate;
  // Cumulative loss-as-fraction-of-capital a combo generates over its first N
  // years (declining per-year curve in schwab-strategies.js, summed). Beyond
  // the 10-year curve, reuse the last year's factor.
  function _fspCumLoss(combo, N) {
    if (!combo || !Array.isArray(combo.lossByYear) || !(N > 0)) return 0;
    var lb = combo.lossByYear, last = lb.length - 1, s = 0;
    for (var i = 0; i < N; i++) s += (i <= last) ? lb[i] : lb[last];
    return s;
  }
  function _fspFeeRate(combo) {
    if (!combo || typeof root.brooklynFeeRateFor !== 'function') return 0;
    return Number(root.brooklynFeeRateFor(combo.longPct, combo.shortPct)) || 0;
  }

  // Collective future-sale benefit under the multi-sale installment model
  // (advisor 2026-06-22, 50/50 net-of-fees). Each future sale is taken as a
  // 50/50 two-January §453 installment with proceeds deployed at 200/100.
  // §453 recognizes half the gain each year; the year-1 loss (59% of that
  // year's capital) offsets year-1 gain, then the year-1 capital compounds
  // (cumLoss 108% by yr2) and — with the year-2 payment's own loss — typically
  // wipes the remaining gain. Net of 200/100 fees (1.31%/yr) on deployed
  // capital: p1 held 2yr, p2 held 1yr. Worst case (100% gain) ≈ 79% offset.
  // Pure estimate; does NOT touch the engine/optimizer.
  // Cross-sale carryforward optimizer (advisor 2026-06-22). The future sales
  // share ONE chronological loss pool: an early sale's 200/100 capital keeps
  // generating loss that — because capital losses carry FORWARD only — can
  // offset LATER sales' gains too. Each sale's 50/50 proceeds become two
  // capital tranches (sale year + next); each tranche held `hold` years pays
  // feeRate × cap × hold and contributes lossByYear[age] × cap to the pool each
  // year it's open. We pick the hold-horizons that maximize Σoffset×rate − fees
  // via two greedy passes from the max-hold start: (1) trim fee-years where
  // total offset is preserved, (2) drop coverage where net strictly improves.
  // Caller floors this at the independent per-sale result, so it can only help.
  function _optimizeSharedPool(sales, rate, feeRate, lossByYear, year0) {
    if (!sales || !sales.length) return null;
    var last = lossByYear.length - 1;
    function lossAt(age) { return age <= last ? lossByYear[age] : lossByYear[last]; }
    var tranches = [], recog = {};
    sales.forEach(function (f) {
      var Y = (Number(year0) || 0) + (Number(f.years) || 0);
      tranches.push({ d: Y, cap: f.projectedPrice * 0.5 });
      tranches.push({ d: Y + 1, cap: f.projectedPrice * 0.5 });
      recog[Y] = (recog[Y] || 0) + f.gain * 0.5;
      recog[Y + 1] = (recog[Y + 1] || 0) + f.gain * 0.5;
    });
    var recogYears = Object.keys(recog).map(Number);
    var maxR = Math.max.apply(null, recogYears);
    var minY = Math.min.apply(null, tranches.map(function (t) { return t.d; }));
    function simulate(holds) {
      var pool = 0, offset = 0;
      for (var y = minY; y <= maxR; y++) {
        for (var i = 0; i < tranches.length; i++) {
          var t = tranches[i];
          if (t.d <= y && y <= holds[i]) pool += t.cap * lossAt(y - t.d);
        }
        var g = recog[y] || 0;
        var o = Math.min(g, pool); pool -= o; offset += o;
      }
      var fees = 0;
      for (var j = 0; j < tranches.length; j++) fees += tranches[j].cap * feeRate * (holds[j] - tranches[j].d + 1);
      return { offset: offset, fees: fees, net: offset * rate - fees };
    }
    var holds = tranches.map(function () { return maxR; });
    var base = simulate(holds);
    // Pass 1 — trim fee-years that don't reduce offset.
    var improved = true, guard = 0;
    while (improved && guard++ < 4000) {
      improved = false;
      for (var k = 0; k < tranches.length; k++) {
        while (holds[k] > tranches[k].d) {
          var trial = holds.slice(); trial[k] = holds[k] - 1;
          var r = simulate(trial);
          if (r.offset >= base.offset - 1) { holds = trial; base = r; improved = true; }
          else break;
        }
      }
    }
    // Pass 2 — drop coverage where shedding the fee beats the lost offset.
    improved = true; guard = 0;
    while (improved && guard++ < 4000) {
      improved = false;
      for (var k2 = 0; k2 < tranches.length; k2++) {
        if (holds[k2] > tranches[k2].d) {
          var trial2 = holds.slice(); trial2[k2] = holds[k2] - 1;
          var r2 = simulate(trial2);
          if (r2.net > base.net + 1) { holds = trial2; base = r2; improved = true; }
        }
      }
    }
    return { offset: base.offset, taxSaved: base.offset * rate, fees: base.fees, net: base.net };
  }

  function _futureInstallmentBenefit() {
    var combined = _fspCombinedRate().combined || FSP_FED_RATE;
    var combo = (typeof root.getSchwabCombo === 'function') ? root.getSchwabCombo('beta1_200_100') : null;
    var L1 = _fspCumLoss(combo, 1), L2 = _fspCumLoss(combo, 2);
    var feeRate = _fspFeeRate(combo);
    var sales = _futureSalesProjected().filter(function (f) { return f.gain > 0; });
    // ---- Independent per-sale baseline (each sale covers only its own gain) ----
    var totOffset = 0, totTaxSaved = 0, totFees = 0, perSale = [];
    sales.forEach(function (f) {
      var price = f.projectedPrice, G = f.gain;
      var p1 = price * 0.5, p2 = price * 0.5;   // 50/50 proceeds = deployed capital
      var g1 = G * 0.5, g2 = G * 0.5;           // §453 gain recognized per year
      var pool1 = p1 * L1;
      var used1 = Math.min(g1, pool1);
      var carry = pool1 - used1;                // unused year-1 loss carries forward
      var pool2 = carry + (p1 * (L2 - L1) + p2 * L1);
      var used2 = Math.min(g2, pool2);
      var offset = Math.min(G, used1 + used2);
      var fees = p1 * feeRate * 2 + p2 * feeRate * 1;
      var taxSaved = offset * combined;
      totOffset += offset; totTaxSaved += taxSaved; totFees += fees;
      perSale.push({ price: price, gain: G, offset: offset,
        offsetPct: G > 0 ? offset / G : 0, taxSaved: taxSaved, fees: fees,
        net: taxSaved - fees });
    });
    var indepNet = totTaxSaved - totFees;
    // ---- Cross-sale optimizer, floored at the independent baseline ----
    var year0;
    try { year0 = Number((root.collectInputs() || {}).year1) || (new Date()).getFullYear(); }
    catch (e) { year0 = (new Date()).getFullYear(); }
    var opt = (combo && Array.isArray(combo.lossByYear))
      ? _optimizeSharedPool(sales, combined, feeRate, combo.lossByYear, year0) : null;
    var useOpt = !!(opt && opt.net > indepNet + 1);
    var chosen = useOpt
      ? { offset: opt.offset, taxSaved: opt.taxSaved, fees: opt.fees, net: opt.net }
      : { offset: totOffset, taxSaved: totTaxSaved, fees: totFees, net: indepNet };
    return { combined: combined, L1: L1, L2: L2, feeRate: feeRate,
      offset: chosen.offset, taxSaved: chosen.taxSaved, fees: chosen.fees, net: chosen.net,
      perSale: perSale, independentNet: indepNet, optimizedNet: opt ? opt.net : null,
      usedOptimizer: useOpt };
  }
  root.__rettFutureInstallmentBenefit = _futureInstallmentBenefit;
  function _fspRerender() {
    // Re-paint the Page-1 (Section 04) input table after rows are added/removed.
    try { renderFutureSaleInputs(); } catch (e) { /* */ }
  }

  // ---- Page-1 (Section 04) future-sale INPUT table -------------------
  // Mirrors the estimator's data model — shares __rettFutureSalesPlanner and
  // the fsp-* classes + data-fsp-* attrs, so the same delegated input/change/
  // add/del listeners persist edits — but shows ONLY the inputs the client
  // fills in: planned sale date, fair market value, cost basis. No gain / tax
  // / coverage here; that math lives downstream (advisor 2026-06-22). The host
  // is filled only when the Section-04 yes/no is "yes" (cleared otherwise).
  function _renderFutureSaleInputsTable() {
    var rows = _fspState();
    var body = rows.map(function (r, i) {
      var sp = _fspParse(r.salePrice), cb = _fspParse(r.costBasis), g = _fspParse(r.growth), yu = _fspParse(r.yearsUntil);
      return '<tr class="fsp-row" data-fsp-row="' + i + '">' +
        '<td><input type="text" inputmode="numeric" class="fsp-input fsp-years" data-fsp-field="yearsUntil" data-fsp-idx="' + i + '" value="' + (yu > 0 ? yu : '') + '" placeholder="0" autocomplete="off"></td>' +
        '<td><input type="text" inputmode="numeric" class="fsp-input fsp-usd" data-fsp-field="salePrice" data-fsp-idx="' + i + '" value="' + (sp > 0 ? _fmt(sp) : '') + '" placeholder="$0"></td>' +
        '<td><input type="text" inputmode="numeric" class="fsp-input fsp-usd" data-fsp-field="costBasis" data-fsp-idx="' + i + '" value="' + (cb > 0 ? _fmt(cb) : '') + '" placeholder="$0"></td>' +
        '<td><input type="text" inputmode="decimal" class="fsp-input fsp-pct" data-fsp-field="growth" data-fsp-idx="' + i + '" value="' + (g > 0 ? g : '') + '" placeholder="0"></td>' +
        '<td class="fsp-del-cell">' + (rows.length > 1 ? '<button type="button" class="fsp-del" data-fsp-del="' + i + '" title="Remove this sale" aria-label="Remove this sale">&times;</button>' : '') + '</td>' +
      '</tr>';
    }).join('');
    return '<table class="fsp-table fsp-input-table">' +
      '<thead><tr>' +
        '<th>Years until sale</th><th>Fair market value</th><th>What you paid (cost basis)</th><th>Growth rate (%/yr)</th><th aria-hidden="true"></th>' +
      '</tr></thead>' +
      '<tbody>' + body + '</tbody>' +
    '</table>' +
    '<button type="button" class="fsp-add" data-fsp-add="1">+ Add another sale</button>';
  }
  function renderFutureSaleInputs() {
    var host = (typeof document !== 'undefined') ? document.getElementById('future-sale-inputs-host') : null;
    if (!host) return;
    var yes = false;
    try {
      var el = document.getElementById('future-sale-yes-no');
      yes = !!(el && el.value === 'yes');
    } catch (e) { yes = false; }
    host.innerHTML = yes ? _renderFutureSaleInputsTable() : '';
  }
  root.renderFutureSaleInputs = renderFutureSaleInputs;

  // Canonical projected future-sale data (advisor 2026-06-22). Each row's fair
  // market value is grown by its year-over-year growth rate over the years
  // from the tax year to the planned sale date, yielding the projected sale
  // price + gain that downstream pages (Tax Implications, etc.) consume — one
  // source of truth so every surface agrees. Future-sale gain is taxed at
  // FSP_FED_RATE (23.8% LTCG+NIIT) + the client's state rate, baseline LT gain
  // only (no recapture detail for these). years = 0 when no date → no growth.
  function _futureSalesProjected() {
    var rows = _fspState();
    var year0;
    try { year0 = Number((root.collectInputs() || {}).year1) || (new Date()).getFullYear(); }
    catch (e) { year0 = (new Date()).getFullYear(); }
    return rows.map(function (r) {
      var fmv = _fspParse(r.salePrice), cb = _fspParse(r.costBasis), g = _fspParse(r.growth);
      // "Years until sale" is the canonical input now (advisor 2026-06-22) —
      // clients think in "X years away", not a calendar date. Legacy rows that
      // still carry a `date` fall back to deriving years from it.
      var yu = _fspParse(r.yearsUntil);
      var years;
      if (yu > 0) {
        years = Math.round(yu);
      } else if (r.date) {
        var sy = Number(String(r.date).slice(0, 4));
        years = (sy > year0) ? (sy - year0) : 0;
      } else {
        years = 0;
      }
      var saleYear = year0 + years;
      var projectedPrice = fmv * Math.pow(1 + g / 100, years);
      return {
        yearsUntil: years, fmv: fmv, costBasis: cb, growth: g, years: years, saleYear: saleYear,
        projectedPrice: projectedPrice, gain: Math.max(0, projectedPrice - cb)
      };
    });
  }
  root.__rettFutureSalesProjected = _futureSalesProjected;
  if (typeof root !== 'undefined' && root.document && !root.__rettFspListenerWired) {
    root.__rettFspListenerWired = true;
    root.document.addEventListener('input', function (e) {
      var el = e.target;
      if (!el || !el.classList || !el.classList.contains('fsp-input')) return;
      var idx = Number(el.getAttribute('data-fsp-idx')), field = el.getAttribute('data-fsp-field');
      if (!Number.isFinite(idx) || !field) return;
      var rows = _fspState(); if (!rows[idx]) return;
      rows[idx][field] = (field === 'date') ? el.value : _fspParse(el.value);
      _fspPersist();   // downstream renders fire on blur (change) / add / remove
    });
    root.document.addEventListener('change', function (e) {
      var el = e.target;
      // Section-04 yes/no toggles the Page-1 input table on/off.
      if (el && el.id === 'future-sale-yes-no') {
        renderFutureSaleInputs();
        if (el.value === 'yes') {
          // Multi-sale string: the installment sale (B) is THE strategy we
          // show, so mark it interested (and only it) — the Projection
          // collective net benefit renders off the interested strategy
          // (advisor 2026-06-22). Switching back to "no" leaves the original
          // single-sale flow untouched; we don't undo here so a deliberate
          // pick isn't wiped.
          try {
            root.__rettStrategyInterest = { A: null, B: true, C: null };
            root.__rettChosenStrategy = 'B';
            if (root.localStorage) {
              root.localStorage.setItem('_strategyInterest', JSON.stringify(root.__rettStrategyInterest));
              root.localStorage.setItem('_chosenStrategy', 'B');
            }
          } catch (e) { /* */ }
        }
        // Refresh in BOTH directions so the multi-sale presentation (Page-3
        // featuring, Projection collective tile, the B card's future-sales
        // receipt schedule + suppressed lockup) appears on Yes and fully
        // reverts on No. renderInterestedSnapshot drives the B card; the
        // dashboard drives the collective KPI tile — both must re-run.
        // _refreshCard3Visibility owns the Page-3 multi-sale layout (all three
        // cards shown, default-risk hidden, grid .is-multi-sale) — it MUST run
        // here or toggling Yes leaves Page 3 in its stale single-sale layout.
        // renderBaselineTable (Tab 2) MUST run before renderInterestedSnapshot:
        // the projection card's walk-away reads bt-cash-kept from Tab 2's DOM,
        // so Tab 2 has to hold the fresh COLLECTIVE cash-kept first or the card
        // captures a stale value (advisor 2026-06-22).
        ['_refreshCard3Visibility', '_refreshStrategyPickCards', 'renderBaselineTable',
         'renderInterestedSnapshot', 'renderSupplementalPage', 'renderProjectionDashboard',
         'renderStrategySummary'].forEach(function (fn) {
          if (typeof root[fn] === 'function') { try { root[fn](); } catch (e) { /* */ } }
        });
        return;
      }
      if (!el || !el.classList || !el.classList.contains('fsp-input')) return;
      if (el.classList.contains('fsp-usd')) {
        var v = _fspParse(el.value);
        el.value = v > 0 ? _fmt(v) : '';
      }
      // A future-sale edit changes Tab 2's collective figures, the Projection
      // collective net benefit, the installment card's receipt schedule AND the
      // Strategy Summary collective hero / Savings-by-Sale table. renderBaseline
      // first so the card's walk-away reads a fresh collective bt-cash-kept
      // (advisor 2026-06-22).
      ['renderBaselineTable', 'renderProjectionDashboard', 'renderInterestedSnapshot',
       'renderStrategySummary'].forEach(function (fn) {
        if (typeof root[fn] === 'function') { try { root[fn](); } catch (e2) { /* */ } }
      });
    });
    // Initial paint (the inputs page is already in the DOM at script load).
    try { renderFutureSaleInputs(); } catch (e) { /* */ }
    root.document.addEventListener('click', function (e) {
      var add = e.target && e.target.closest && e.target.closest('[data-fsp-add]');
      var del = e.target && e.target.closest && e.target.closest('[data-fsp-del]');
      if (add) {
        _fspState().push({ yearsUntil: 0, salePrice: 0, costBasis: 0, growth: 0 });
        _fspPersist(); _fspRerender();
      } else if (del) {
        var i = Number(del.getAttribute('data-fsp-del')), rows = _fspState();
        if (rows.length > 1 && rows[i] != null) { rows.splice(i, 1); _fspPersist(); _fspRerender(); }
      } else {
        return;
      }
      // Adding/removing a sale changes Tab 2, the Projection collective net
      // benefit, the receipt schedule AND the Strategy Summary. Tab 2 first
      // (walk-away reads its bt-cash-kept).
      ['renderBaselineTable', 'renderProjectionDashboard', 'renderInterestedSnapshot',
       'renderStrategySummary'].forEach(function (fn) {
        if (typeof root[fn] === 'function') { try { root[fn](); } catch (e2) { /* */ } }
      });
    });
  }

  if (typeof root !== 'undefined' && root.document && !root.__rettGrowthListenerWired) {
    root.__rettGrowthListenerWired = true;
    root.document.addEventListener('input', function (e) {
      var t = e.target;
      if (t && (t.id === 'growth-end-date' || t.id === 'growth-return')) {
        _refreshGrowthChart();
      }
    });
    root.document.addEventListener('change', function (e) {
      var t = e.target;
      if (t && t.id === 'growth-end-date') _refreshGrowthChart();
    });
  }

  // Net Benefit hero double-click: toggles the 3-part breakdown
  // (cash / charity / physical-asset) so the advisor can show the
  // client where the savings landed without crowding the Page-5
  // summary view by default.
  if (typeof root !== 'undefined' && root.document && !root.__rettNetHeroBreakdownWired) {
    root.__rettNetHeroBreakdownWired = true;
    root.document.addEventListener('dblclick', function (e) {
      var t = e.target;
      var hero = t && t.closest && t.closest('[data-net-hero]');
      if (!hero) return;
      var panel = hero.querySelector('.net-hero-breakdown');
      if (!panel) return;
      panel.hidden = !panel.hidden;
      hero.classList.toggle('is-expanded', !panel.hidden);
    });
  }

  // Future-Sale Apply / Undo button. One delegated handler covers both
  // states. On click: flip the global absorption flag, persist to
  // localStorage, rerun the pipeline (so Brooklyn resizes), re-render
  // Page 5, and scroll to the Net Benefit hero so the advisor sees the
  // updated total.
  if (typeof root !== 'undefined' && root.document && !root.__rettFsApplyListenerWired) {
    root.__rettFsApplyListenerWired = true;
    // Restore prior choice on page load.
    try {
      if (root.localStorage && root.localStorage.getItem('_absorbFutureSale') === '1') {
        root.__rettAbsorbFutureSale = true;
      }
    } catch (e) { /* localStorage unavailable */ }
    root.document.addEventListener('click', function (e) {
      var btn = e.target && e.target.closest && e.target.closest('[data-fs-apply]');
      if (!btn) return;
      var action = btn.getAttribute('data-fs-apply');
      if (action === 'apply') {
        root.__rettAbsorbFutureSale = true;
      } else if (action === 'undo') {
        root.__rettAbsorbFutureSale = false;
      } else {
        return;
      }
      try {
        if (root.localStorage) {
          root.localStorage.setItem('_absorbFutureSale',
            root.__rettAbsorbFutureSale ? '1' : '0');
        }
      } catch (err) { /* localStorage unavailable */ }
      if (typeof root.runFullPipeline === 'function') {
        try { root.runFullPipeline(); } catch (err) { /* */ }
      }
      if (typeof root.renderStrategySummary === 'function') {
        try { root.renderStrategySummary(); } catch (err) { /* */ }
      }
      var hero = root.document.querySelector('.forward-net-hero');
      if (hero && typeof hero.scrollIntoView === 'function') {
        hero.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    });
  }


  root.renderStrategySummary = renderStrategySummary;
})(window);
