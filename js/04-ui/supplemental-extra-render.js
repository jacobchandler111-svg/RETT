// FILE: js/04-ui/supplemental-extra-render.js
// Page-4 supplemental strategy rail — placeholder-style cards that
// auto-register with the master solver and the dollar-rivalry
// allocator the moment a slot goes live.
//
// Active strategies (post-trim 2026-05-06): PTET, Charitable Gifts.
// Reserved slots (slot05 .. slot11) ship rendered as "Coming Soon"
// placeholders ready to receive the next round of strategies.
//
// ============ ACTIVATION CONTRACT (2-file edit) ============
// To turn a `placeholder: true` slot into a live strategy:
//
//   STEP 1 — supplemental-extra-render.js (THIS FILE)
//   Replace the placeholder spec entry with full config:
//     {
//       id:              'slotNN',           // keep the slotNN id
//       num:             'NN',
//       name:            'My Strategy',
//       shortName:       'My Strat',          // optional — chip label
//       keyaspect:       'Headline',
//       descriptor:      'One-liner describing the lever.',
//       audience:        'Target client type',
//       bucket:          'ordinary',          // 'ordinary'|'capital'|'mixed'
//       investmentField: 'maxInvestment',     // optional — see below
//       defaults:        { ... },
//       detailRows:      [ ... ]
//     }
//   (Remove `placeholder: true` to flip the slot live.)
//
//   STEP 2 — js/03-solver/calc-supplemental-extra.js
//   Add the calc fn to the _CALCS map:
//     _CALCS.slotNN = function () {
//       var cfg = _cfg(); if (!cfg) return _writeResult('slotNN', null);
//       var st = _state('slotNN');
//       // ... math here ...
//       _writeResult('slotNN', {
//         netBenefit: <dollar tax savings>,
//         investment: <dollar capital deployed>,
//         marginalRate: <effective rate, optional>,
//         detail: { ... whatever surfaces in the See Value row ... }
//       });
//     };
//
//   That's it. Registry, allocator, master solver, See Value chevron,
//   Page-5 hero numbers, and the dollar-rivalry engine all auto-light
//   up the moment the user clicks Interested + types details.
//
// `investmentField` semantics:
//   - When set, the registry uses that detail-row id as the "max
//     investment" surrogate the allocator sees BEFORE the calc has
//     run a tick (so clicking Interested immediately starts taking
//     capital away from Brooklyn).
//   - When the calc DOES run and writes result.investment, that
//     wins.
//   - Tax-side strategies (PTET, Charitable Gifts) leave it unset
//     so they never claim sale-proceed capital from Brooklyn.
//
// State persists via:
//   window.__rettSupplementalExtraInterest[id]    -> true|false|null
//   window.__rettSupplementalExtra[id]            -> { detailFields..., lastResult }

(function (root) {
  'use strict';

  var STATE_KEY    = '__rettSupplementalExtra';
  var INTEREST_KEY = '__rettSupplementalExtraInterest';

  // Quick-pick chip presets per strategy. Shown inline on the card
  // when the user clicks Interested AND the primary dollar field is
  // still $0. Provides a one-click "ballpark" so the advisor doesn't
  // have to dig into the Details panel mid-meeting. Picking a chip
  // populates the field, marks it user-touched, and fires the calc.
  // Strategies whose primary input auto-fills from sale data
  // (oilGas, delphi, ptet, slot09) are NOT in this map — they don't
  // need a prompt because warm-up handles them.
  var CHIPS_CONFIG = {
    slot07: {
      primaryField: 'investmentAmount',
      prompt:       'Investment amount',
      picks: [
        { label: '$250K', value: 250000 },
        { label: '$500K', value: 500000 },
        { label: '$1M',   value: 1000000 }
      ]
    },
    slot08: {
      primaryField: 'fmvPerDay',
      prompt:       'Daily FMV rent',
      picks: [
        { label: '$1,000', value: 1000 },
        { label: '$1,500', value: 1500 },
        { label: '$2,500', value: 2500 }
      ]
    },
    slot12: {
      primaryField: 'equipmentCost',
      prompt:       'Equipment cost',
      picks: [
        { label: '$250K', value: 250000 },
        { label: '$1M',   value: 1000000 },
        { label: '$2.5M', value: 2500000 }
      ]
    }
  };

  // --------------------------------------------------------------
  // Strategy specs. Order = display order. `defaults` populates
  // the Details dropdown placeholder inputs. `descriptor` is the
  // 1-2 sentence summary that lives on the front of the card.
  // --------------------------------------------------------------
  // Trimmed per advisor 2026-05-06: only PTET and Charitable Gifts
  // remain on the placeholder rail. The other six (412(e)(3), QBI,
  // R&D, 401(h), Solar ITC, Film §181) were removed because they
  // either happen automatically (QBI, business already running) or
  // come up too rarely in the typical sale-and-transition advisory
  // setting. QCD was repurposed into a broader Charitable Gifts
  // strategy (cash + appreciated assets, not the IRA-only QCD path)
  // since the latter has tighter eligibility (age 70.5+ only).
  var SPECS = [
    {
      id: 'ptet',
      num: '03',
      name: 'PTET &mdash; Pass-Through Entity SALT',
      shortName: 'PTET',
      keyaspect: 'SALT Cap Workaround',
      descriptor: 'Routing state income tax through the entity recovers it as a federal deduction, bypassing the SALT cap.',
      audience: 'Pass-through owner',
      bucket: 'ordinary',
      // No investmentField — PTET is a tax payment, not capital that
      // competes with Brooklyn for sale-proceed dollars.
      defaults: {
        taxableIncome:         1000000,
        stateRate:             5.49,
        saltCapacityRemaining: 0,        // unused individual SALT cap headroom
        creditPct:             100,       // % of PTET creditable on owner state return (MA = 90)
        annualRecurring:       true       // PTET recurs every recognition year of the viewed strategy
                                          // (Strategy A → Y0 only via _strategyYearCount; B/C → each year)
      },
      detailRows: [
        { id: 'taxableIncome',         label: 'Pass-through income',                 kind: 'usd', placeholder: '1,000,000' },
        { id: 'stateRate',             label: 'State PTET rate (%)',                 kind: 'pct', placeholder: '5.49' },
        { id: 'saltCapacityRemaining', label: 'Unused individual SALT cap',          kind: 'usd', placeholder: '0' },
        { id: 'creditPct',             label: 'PTET-to-owner credit (%)',            kind: 'pct', placeholder: '100' }
        // (No "Recurs each year?" toggle — PTET always recurs over the
        // viewed strategy's horizon; the calc forces it unconditionally.)
      ]
    },
    // ----------------------------------------------------------------
    // Reserved placeholder slots — names land here as the research
    // report delivers them. Each placeholder renders the same shell
    // (numbered badge + name + key-aspect + descriptor + interest
    // buttons + value chevron) so the grid layout doesn't shift when
    // a real strategy slots in. To activate one: replace placeholder:
    // true with the real config (name, keyaspect, descriptor, audience,
    // defaults, detailRows) and add the matching calc fn + registry
    // entry. No layout work required at swap-in.
    // ----------------------------------------------------------------
    {
      id: 'slot07',
      num: '08',
      name: 'Equipment Leasing Fund',
      shortName: 'Equip Leasing',
      keyaspect: 'Bonus Pass-Through',
      descriptor: 'Through active participation, an investment offsets ordinary income.',
      audience: 'Active investor',
      bucket: 'capital',
      investmentField: 'investmentAmount',
      defaults: {
        investmentAmount:  500000,
        depreciablePct:    90,
        commitHours:       false
      },
      detailRows: [
        { id: 'investmentAmount', label: 'Investment amount',                kind: 'usd', placeholder: '500,000' },
        { id: 'depreciablePct',   label: 'Depreciable basis (% of capital)', kind: 'pct', placeholder: '90' },
        // Material participation is a strict requirement under §469
        // (otherwise the loss is suspended as passive). The simplest
        // §469-5T(a) test for active investors is 100 hours/year + at
        // least as many as anyone else. Asking the user this directly
        // captures the binding constraint without requiring them to
        // self-classify under multi-prong tests.
        { id: 'commitHours',      label: 'Will commit ≥100 hours/year?',     kind: 'yesno' }
      ]
    },
    {
      id: 'slot08',
      num: '09',
      name: 'Augusta Rule &mdash; §280A(g)',
      shortName: 'Augusta Rule',
      keyaspect: 'Tax-Free Home Rental',
      descriptor: 'Reporting property as rented to business produces tax benefits.',
      audience: 'S-corp / partnership owner',
      bucket: 'ordinary',
      defaults: {
        daysRented:      14,
        fmvPerDay:       1500,
        annualRecurring: true       // Augusta is structurally annual — recurs every recognition year of the
                                    // viewed strategy (Strategy A → Y0 only via _strategyYearCount; B/C → each year)
      },
      detailRows: [
        { id: 'daysRented',     label: 'Days rented (max 14)',                kind: 'num', placeholder: '14' },
        { id: 'fmvPerDay',      label: 'FMV rental per day',                  kind: 'usd', placeholder: '1,500' }
        // (No "Recurs each year?" toggle — Augusta always recurs over the
        // viewed strategy's horizon; the calc forces it unconditionally.)
      ]
    },
    {
      id: 'slot12',
      num: '12',
      name: 'Farm / Business Equipment',
      shortName: 'Equipment',
      keyaspect: 'Equipment Expensing',
      descriptor: 'Each dollar of equipment fully offsets income in year one.',
      audience: 'Farm / business operator',
      bucket: 'asset',
      // No investmentField — equipment is a physical-asset purchase the
      // operator needs anyway; doesn't compete with Brooklyn for capital.
      // Business taxable income is pulled from the Page-1 biz revenue
      // field rather than re-entered here (advisor 2026-05-06).
      defaults: {
        equipmentCost: 1000000,
        isFarm:        false
      },
      detailRows: [
        { id: 'equipmentCost', label: 'Equipment cost',   kind: 'usd', placeholder: '1,000,000' },
        { id: 'isFarm',        label: 'Schedule F farm?', kind: 'yesno' }
      ]
    }
  ];

  function _state() {
    if (!root[STATE_KEY]) root[STATE_KEY] = {};
    var s = root[STATE_KEY];
    SPECS.forEach(function (spec) {
      if (!s[spec.id]) {
        s[spec.id] = Object.assign({ detailsOpen: false }, spec.defaults);
      } else {
        // Backfill any missing default keys (when SPECS gain fields).
        Object.keys(spec.defaults).forEach(function (k) {
          if (typeof s[spec.id][k] === 'undefined') s[spec.id][k] = spec.defaults[k];
        });
        if (typeof s[spec.id].detailsOpen === 'undefined') s[spec.id].detailsOpen = false;
        if (typeof s[spec.id].valueOpen   === 'undefined') s[spec.id].valueOpen   = false;
      }
    });
    return s;
  }

  function _interestState() {
    if (!root[INTEREST_KEY]) root[INTEREST_KEY] = {};
    var s = root[INTEREST_KEY];
    SPECS.forEach(function (spec) {
      if (typeof s[spec.id] === 'undefined') s[spec.id] = null;
    });
    return s;
  }

  function _fmtMoney(n) {
    if (!Number.isFinite(n)) return '$0';
    return '$' + Math.round(Math.abs(n)).toLocaleString('en-US');
  }
  function _fmtUSD(n) {
    return (typeof root.fmtUSD === 'function') ? root.fmtUSD(n) : _fmtMoney(n);
  }

  function _interestClassFor(id) {
    var s = _interestState()[id];
    if (s === true)  return 'is-interested';
    if (s === false) return 'is-not-interested';
    return '';
  }

  function _btnActiveClass(id, action) {
    var s = _interestState()[id];
    if (action === 'interested' && s === true) return ' is-active';
    if (action === 'not-interested' && s === false) return ' is-active';
    return '';
  }

  // Generic placeholder icon — abstract glyph (intersecting circles)
  // since each strategy's iconography would be a separate design pass.
  function _genericIconSVG() {
    return '' +
      '<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">' +
        '<circle cx="18" cy="24" r="10"/>' +
        '<circle cx="30" cy="24" r="10"/>' +
      '</svg>';
  }

  function _renderDetailRow(specId, st, row) {
    var val = st[row.id];
    var html = '<div class="supp-details-row">' +
      '<div class="supp-details-rowlabel">' + row.label + '</div>' +
      '<div class="supp-details-cell">';
    if (row.kind === 'usd') {
      html += '<div class="currency-input"><input type="text" data-supx-input="' + specId + ':' + row.id + '" inputmode="numeric" autocomplete="off" value="' + _fmtUSD(Number(val) || 0) + '" placeholder="' + (row.placeholder || '') + '"></div>';
    } else if (row.kind === 'pct') {
      html += '<div class="currency-input percent"><input type="number" data-supx-input="' + specId + ':' + row.id + '" min="0" max="100" step="0.01" value="' + (Number(val) || 0) + '" placeholder="' + (row.placeholder || '') + '"><span class="pct-suffix" aria-hidden="true">%</span></div>';
    } else if (row.kind === 'num') {
      html += '<div class="currency-input"><input type="number" data-supx-input="' + specId + ':' + row.id + '" min="0" step="1" value="' + (Number(val) || 0) + '" placeholder="' + (row.placeholder || '') + '"></div>';
    } else if (row.kind === 'yesno') {
      html += '<select data-supx-input="' + specId + ':' + row.id + '" class="yes-no">' +
        '<option value="no"' + (!val ? ' selected' : '') + '>No</option>' +
        '<option value="yes"' + (val ? ' selected' : '') + '>Yes</option>' +
        '</select>';
    } else if (row.kind === 'select') {
      var opts = (row.options || []).map(function (o) {
        var sel = (String(val) === String(o.value)) ? ' selected' : '';
        return '<option value="' + o.value + '"' + sel + '>' + o.label + '</option>';
      }).join('');
      html += '<select data-supx-input="' + specId + ':' + row.id + '" class="yes-no">' + opts + '</select>';
    }
    html += '</div></div>';
    return html;
  }

  // Read the master-solver output for a single supplemental id and
  // turn it into one of three display states for the "See Value"
  // result row:
  //   - 'value':    a positive netBenefit was computed and the allocator
  //                 routed capital to it (interested + enabled +
  //                 result available + investment > 0).
  //   - 'crowded':  interested but the allocator gave $0 because better
  //                 options consumed available capital. Surfaces as
  //                 "Other strategies utilized."
  //   - 'pending':  interested but result is null (calc not yet wired
  //                 in for this strategy, or details haven't been
  //                 entered). Surfaces as "Math pending."
  //   - 'none':     not Interested — the row stays hidden.
  function _readResultState(id) {
    var iState = _interestState();
    if (iState[id] !== true) return { state: 'none' };
    var solverOut = (typeof root.runMasterSolver === 'function')
      ? root.runMasterSolver(0) : null;
    var solverEntry = solverOut && solverOut.supplementals
      ? solverOut.supplementals.filter(function (s) { return s.id === id; })[0]
      : null;
    if (!solverEntry || !solverEntry.available) {
      return { state: 'pending' };
    }
    var benefit = Number(solverEntry.netBenefit) || 0;
    var rivalry = solverEntry.rivalry || {};
    // Single source of truth for "is this supp contributing": the rivalry
    // decision. Funded supps (incl. free-benefit, where granted=0 but
    // funded=true) show 'value'. Rejected supps show 'crowded' with the
    // reason carried so the messaging can be specific. Earlier the code
    // gated on `invested > 0` and mis-classified free-benefit supps
    // (PTET, Charitable Gifts, Heavy Vehicle, Augusta, 401k) as
    // "crowded out" even though they were actually contributing real
    // net benefit.
    if (rivalry.funded && benefit > 0) {
      var invested = Number(rivalry.granted) || 0;
      return { state: 'value', netBenefit: benefit, investment: invested };
    }
    return { state: 'crowded', reason: rivalry.reason };
  }

  function _renderResultRow(spec, st) {
    if (!st.valueOpen) return '';
    var r = _readResultState(spec.id);
    var body;
    if (r.state === 'value') {
      var subline = (r.investment > 0)
        ? 'net tax benefit &middot; ' + _fmtUSD(r.investment) + ' invested'
        : 'net tax benefit &middot; no Brooklyn capital deployed';
      body = '<div class="supx-result-amt">' + _fmtUSD(r.netBenefit) + '</div>' +
             '<div class="supx-result-sub">' + subline + '</div>';
    } else if (r.state === 'crowded') {
      // Reason-specific copy so the advisor and client see WHY this
      // supp didn't end up in the funded plan, instead of a generic
      // "other strategies utilized" line that doesn't distinguish
      // brooklyn-beats from capital-exhausted from negative-net.
      var msg = 'Not funded in this scenario';
      var sub = '';
      if (r.reason === 'brooklyn-beats') {
        sub = 'Brooklyn yields more per dollar &mdash; dollars stay with Brooklyn.';
      } else if (r.reason === 'capital-exhausted') {
        sub = 'No capital left after higher-yield strategies funded.';
      } else if (r.reason === 'negative-net') {
        sub = 'Fees exceed savings at the current configuration.';
      } else {
        sub = 'Allocator routed capital to higher-ROI options for this scenario.';
      }
      body = '<div class="supx-result-msg">' + msg + '</div>' +
             '<div class="supx-result-sub">' + sub + '</div>';
    } else {
      body = '<div class="supx-result-msg supx-result-pending">Math pending</div>' +
             '<div class="supx-result-sub">Calculation lands when the engine work for this strategy is wired in.</div>';
    }
    return '<div class="supx-result-row" data-state="' + r.state + '">' + body + '</div>';
  }

  function _renderCard(spec) {
    var st = _state()[spec.id];
    var isPlaceholder   = !!spec.placeholder;
    var interestCls     = isPlaceholder ? 'is-placeholder' : _interestClassFor(spec.id);
    var detailsOpenCls  = st.detailsOpen ? ' is-open' : '';
    var valueOpenCls    = st.valueOpen   ? ' is-open' : '';
    var detailRows      = (spec.detailRows || []).map(function (r) {
      return _renderDetailRow(spec.id, st, r);
    }).join('');
    var iState = _interestState();
    var seeValueDisabled = isPlaceholder || (iState[spec.id] !== true);
    var interestDisabled = isPlaceholder;

    // Interest buttons: disabled-attr stops clicks; aria-disabled for AT.
    var disAttrInt = interestDisabled ? ' disabled aria-disabled="true"' : '';
    var disAttrVal = seeValueDisabled ? ' disabled aria-disabled="true" title="Mark Interested first to see the projected value"' : '';

    // Details arrow only shown when there are rows OR the card is
    // active. Placeholder cards skip details entirely.
    var detailsBlock = '';
    if (!isPlaceholder && (spec.detailRows || []).length) {
      detailsBlock =
        '<button type="button" class="supp-details-arrow' + detailsOpenCls + '" data-supx-details-target="' + spec.id + '" aria-expanded="' + (st.detailsOpen ? 'true' : 'false') + '" title="' + (st.detailsOpen ? 'Hide details' : 'Show details') + '">' +
          '<span class="supp-details-arrow-chev" aria-hidden="true">&#9662;</span>' +
          '<span class="supp-details-arrow-label">Details</span>' +
        '</button>' +
        '<div class="supp-details-panel"' + (st.detailsOpen ? '' : ' hidden') + '>' +
          detailRows +
        '</div>';
    }

    // Value chevron — same visual treatment as the Details chevron
    // and as the oilGas / delphi "Value Added" arrow on the
    // existing supplemental cards. Replaces the prior heavy
    // .supx-see-value-btn pill button per advisor spec.
    var valueArrow =
      '<button type="button" class="supp-details-arrow supx-value-arrow' + valueOpenCls + '"' +
        disAttrVal +
        ' data-supx-value-target="' + spec.id + '" aria-expanded="' + (st.valueOpen ? 'true' : 'false') + '" title="' + (st.valueOpen ? 'Hide value' : 'See value') + '">' +
        '<span class="supp-details-arrow-chev" aria-hidden="true">&#9662;</span>' +
        '<span class="supp-details-arrow-label">' + (st.valueOpen ? 'Hide value' : 'See value') + '</span>' +
      '</button>';

    // Inline amount box: when Interested, show a single input for the
    // strategy's primary dollar figure (investment / equipment cost /
    // daily FMV). Replaces the prior quick-pick chips ($250K/$500K/Custom)
    // per advisor — advisors type the exact number rather than picking a
    // suggested amount. Bound to the same data-supx-input the Details
    // panel uses, so the host 'input' listener updates state WITHOUT a
    // re-render (caret stays put while typing). Stays visible while
    // Interested (not just at $0) so the figure can be edited in place.
    var amountBlock = '';
    var chipsCfg = CHIPS_CONFIG[spec.id];
    if (!isPlaceholder && chipsCfg && iState[spec.id] === true) {
      var primaryVal = Number(st[chipsCfg.primaryField]) || 0;
      amountBlock =
        '<div class="supx-chips-row supx-amount-row">' +
          '<span class="supx-chips-prompt">' + chipsCfg.prompt + ':</span>' +
          '<div class="currency-input supx-amount-input-wrap">' +
            '<input type="text" class="supx-amount-input" data-supx-input="' + spec.id + ':' + chipsCfg.primaryField + '" inputmode="numeric" autocomplete="off" value="' + (primaryVal > 0 ? _fmtUSD(primaryVal) : '') + '" placeholder="0">' +
          '</div>' +
        '</div>';
    }

    var hiddenCls = (root.__rettSuppHidden && root.__rettSuppHidden[spec.id]) ? ' is-supp-hidden' : '';
    return '' +
      '<div class="strategy-pick-card supp-strategy-card ' + interestCls + hiddenCls + '" data-supx-strategy="' + spec.id + '" data-supp-strategy="' + spec.id + '">' +
        '<div class="strategy-pick-card-header">' +
          '<div class="strategy-pick-num supp-num-clickable" role="button" tabindex="0" title="Click to hide this card" data-supp-hide-target="' + spec.id + '">SUPPLEMENTAL <span class="num-big"></span></div>' +
          (isPlaceholder ? '<span class="supx-placeholder-tag">Coming Soon</span>' : '') +
        '</div>' +
        '<h3 class="strategy-pick-name">' + spec.name + '</h3>' +
        '<div class="strategy-keyaspect">' +
          '<div class="strategy-keyaspect-label">' + spec.keyaspect + '</div>' +
          '<p class="strategy-keyaspect-body">' + spec.descriptor + '</p>' +
        '</div>' +
        '<div class="strategy-lockup-graphic" data-lockup-style="ordinary">' +
          '<span class="strategy-lockup-icon" aria-hidden="true">' + _genericIconSVG() + '</span>' +
          '<div class="strategy-lockup-text">' +
            '<span class="strategy-lockup-value">' + spec.audience + '</span>' +
          '</div>' +
        '</div>' +
        '<div class="strategy-pick-buttons">' +
          '<button type="button" class="strategy-pick-btn supp-pick-btn' + _btnActiveClass(spec.id, 'interested') + '"' + disAttrInt + ' data-supx-pick-action="interested" data-supx-pick-target="' + spec.id + '">&#10003; Interested</button>' +
          '<button type="button" class="strategy-pick-btn supp-pick-btn' + _btnActiveClass(spec.id, 'not-interested') + '"' + disAttrInt + ' data-supx-pick-action="not-interested" data-supx-pick-target="' + spec.id + '">Not Interested</button>' +
        '</div>' +
        amountBlock +
        detailsBlock +
        valueArrow +
        _renderResultRow(spec, st) +
      '</div>';
  }

  // Business-income gate (advisor 2026-06-03). Three strategies only
  // make sense when the client runs an operating business / pass-
  // through: PTET (entity pays state tax), Augusta §280A(g) (rent home
  // to your business), and Farm/Business Equipment §179 (capped by
  // business income). They stay OFF the rail until the Page-1 business-
  // income field has a value. The other four (Oil & Gas, Delphi,
  // Charitable Gifts, Equipment Leasing) are generic and always show.
  var BUSINESS_GATED = { ptet: true, slot08: true, slot12: true };

  function _businessIncomePresent() {
    // Fail OPEN (show) when inputs aren't ready yet, so a load-time
    // race never permanently buries a card. On a real cfg read, the
    // gate is strictly business income > 0.
    if (typeof root.collectInputs !== 'function') return true;
    try {
      var cfg = root.collectInputs();
      if (!cfg) return true;
      return (Number(cfg.businessIncomeAmount) || 0) > 0;
    } catch (e) { return true; }
  }

  function _specVisible(spec) {
    if (BUSINESS_GATED[spec.id] && !_businessIncomePresent()) return false;
    return true;
  }

  function _renderHost() {
    var host = document.getElementById('supplemental-extra-host');
    if (!host) return;
    var iState = _interestState();
    // Drop business-gated cards entirely when business income is blank.
    var visibleSpecs = SPECS.filter(_specVisible);
    // Sort:
    //   1. Not-interested cards drop to the very end.
    //   2. Cards that need a chip-pick (Independent strategies whose
    //      primary $ input can't be auto-derived) come AFTER cards
    //      that auto-fill from sale data / wages — so the advisor
    //      can rapid-fire Interested/Not Interested on the easy ones
    //      first, then deal with the chip-prompt cards.
    var sorted = visibleSpecs.slice().sort(function (a, b) {
      var aNo = iState[a.id] === false ? 1 : 0;
      var bNo = iState[b.id] === false ? 1 : 0;
      if (aNo !== bNo) return aNo - bNo;
      var aChip = CHIPS_CONFIG[a.id] ? 1 : 0;
      var bChip = CHIPS_CONFIG[b.id] ? 1 : 0;
      return aChip - bChip;
    });
    var cards = sorted.map(_renderCard).join('');
    host.innerHTML = '<div class="supp-strategies-grid">' + cards + '</div>';
    _bindEvents();
  }

  function _bindEvents() {
    var host = document.getElementById('supplemental-extra-host');
    if (!host || host.dataset.bound) return;
    host.dataset.bound = '1';

    host.addEventListener('click', function (ev) {
      var t = ev.target;
      if (!t || !t.closest) return;

      // Click the SUPPLEMENTAL number badge to hide the card (advisor
      // 2026-05-26). Visual hide only - Interested state preserved.
      // Cleared by the "Reset supplemental selections" button.
      var hideBtn = t.closest('[data-supp-hide-target]');
      if (hideBtn) {
        var hideId = hideBtn.getAttribute('data-supp-hide-target');
        if (!root.__rettSuppHidden) root.__rettSuppHidden = {};
        root.__rettSuppHidden[hideId] = true;
        // Re-render both hosts so CSS counter renumbers remaining cards.
        if (typeof root.renderSupplementalPage === 'function') {
          try { root.renderSupplementalPage(); } catch (e) { _render(); }
        } else {
          _render();
        }
        return;
      }

      var pickBtn = t.closest('[data-supx-pick-action]');
      if (pickBtn) {
        var target = pickBtn.getAttribute('data-supx-pick-target');
        var action = pickBtn.getAttribute('data-supx-pick-action');
        var newVal = (action === 'interested') ? true : false;
        var iState = _interestState();
        iState[target] = (iState[target] === newVal) ? null : newVal;
        // When Interested is freshly engaged, "warm up" the card —
        // restore any USD field that is currently $0 from the spec
        // default. Without this, a card that survived a New Client
        // reset (which zeros all USD fields) sits at netBenefit=$0
        // forever and never appears on Page 5, even though the user
        // explicitly clicked Interested. The user-touched flag is
        // respected: a field the advisor explicitly typed $0 into
        // stays at $0.
        if (iState[target] === true) {
          var st = _state()[target];
          var spec = SPECS.filter(function (s) { return s.id === target; })[0];
          var chipsCfg = CHIPS_CONFIG[target];
          if (st && spec) {
            (spec.detailRows || []).forEach(function (row) {
              if (row.kind !== 'usd') return;
              // Skip the chip-managed primary field — chips show when
              // it's $0 and let the advisor pick a value explicitly.
              if (chipsCfg && chipsCfg.primaryField === row.id) return;
              var current = Number(st[row.id]) || 0;
              var defaultVal = Number((spec.defaults || {})[row.id]) || 0;
              var touched = st._userTouched && st._userTouched[row.id];
              if (current === 0 && defaultVal > 0 && !touched) {
                st[row.id] = defaultVal;
              }
            });
            // Recompute so lastResult lands before the next render.
            if (typeof root.recomputeSupplementalExtra === 'function') {
              try { root.recomputeSupplementalExtra(); } catch (e) { /* */ }
            }
          }
        }
        _renderHost();
        _persist();
        // Conservation: toggling Interested changes the rivalry-funded
        // supplemental total, which changes Brooklyn's effective pool.
        // Run the full pipeline first so __lastResult / cfg.investment
        // reflect the new allocation, THEN re-render Page 5. Without
        // this, Page 5 would surface stale Brooklyn deployment numbers
        // until another input change triggered a pipeline rerun.
        if (typeof root.runFullPipeline === 'function') {
          try { root.runFullPipeline(); } catch (e) { /* */ }
        }
        if (typeof root.renderStrategySummary === 'function') {
          try { root.renderStrategySummary(); } catch (e) { /* */ }
        }
        return;
      }

      var detailsBtn = t.closest('[data-supx-details-target]');
      if (detailsBtn) {
        var dTarget = detailsBtn.getAttribute('data-supx-details-target');
        var s = _state()[dTarget];
        if (s) {
          s.detailsOpen = !s.detailsOpen;
          _renderHost();
          _persist();
        }
        return;
      }

      var valueBtn = t.closest('[data-supx-value-target]');
      if (valueBtn && !valueBtn.disabled) {
        var vTarget = valueBtn.getAttribute('data-supx-value-target');
        var sv = _state()[vTarget];
        if (sv) {
          sv.valueOpen = !sv.valueOpen;
          // Force a fresh calc before rendering so the result row
          // reflects whatever the user just typed in Details.
          if (typeof root.recomputeSupplementalExtra === 'function') {
            try { root.recomputeSupplementalExtra(); } catch (e) { /* */ }
          }
          _renderHost();
          _persist();
        }
        return;
      }

      // Quick-pick chip (preset value)
      var chipBtn = t.closest('[data-supx-chip-target]');
      if (chipBtn) {
        var cTarget = chipBtn.getAttribute('data-supx-chip-target');
        var cField  = chipBtn.getAttribute('data-supx-chip-field');
        var cValue  = Number(chipBtn.getAttribute('data-supx-chip-value')) || 0;
        var cSt = _state()[cTarget];
        if (cSt) {
          cSt[cField] = cValue;
          if (!cSt._userTouched) cSt._userTouched = {};
          cSt._userTouched[cField] = true;
          if (typeof root.recomputeSupplementalExtra === 'function') {
            try { root.recomputeSupplementalExtra(); } catch (e) { /* */ }
          }
          if (typeof root.runFullPipeline === 'function') {
            try { root.runFullPipeline(); } catch (e) { /* */ }
          }
          _renderHost();
          _persist();
        }
        return;
      }
      // Custom chip — opens Details panel for direct entry
      var chipCustom = t.closest('[data-supx-chip-custom]');
      if (chipCustom) {
        var custId = chipCustom.getAttribute('data-supx-chip-custom');
        var custSt = _state()[custId];
        if (custSt) {
          custSt.detailsOpen = true;
          _renderHost();
          _persist();
        }
        return;
      }
    });

    host.addEventListener('input', function (ev) {
      var t = ev.target;
      if (!t || !t.dataset || !t.dataset.supxInput) return;
      var parts = t.dataset.supxInput.split(':');
      var specId = parts[0], fieldId = parts[1];
      var st = _state()[specId];
      if (!st) return;
      var raw = t.value;
      // Coerce based on the input type — currency/number/yesno.
      if (t.tagName === 'SELECT') {
        // Yes/no selects coerce to bool; arbitrary-value selects
        // (kind: 'select') store the string verbatim.
        if (raw === 'yes' || raw === 'no') st[fieldId] = (raw === 'yes');
        else st[fieldId] = raw;
      } else if (t.type === 'number') {
        st[fieldId] = Number(raw) || 0;
      } else {
        st[fieldId] = (typeof root.parseUSD === 'function')
          ? (root.parseUSD(raw) || 0)
          : Number(String(raw).replace(/[^\d.-]/g, '')) || 0;
      }
      // Mark user-touched so the sale-derived auto-seeder doesn't
      // overwrite a value the advisor explicitly typed in. Once
      // touched, the field stays at the user's value even if sale
      // price / cost basis change later.
      if (!st._userTouched) st._userTouched = {};
      st._userTouched[fieldId] = true;
      _persist();
    });
  }

  function _persist() {
    if (root.__rettApplyingState) return;
    var s = root.RETTCaseStorage;
    if (!s) return;
    // autoSaveCurrent routes to the active named case (if any) so that
    // Page-4 Interested clicks land in the right slot. saveWorkingState
    // would only update the un-named draft and the named case would
    // load stale on refresh.
    if (typeof s.autoSaveCurrent === 'function') {
      try { s.autoSaveCurrent(); } catch (e) { /* */ }
    } else if (typeof s.saveWorkingState === 'function') {
      try { s.saveWorkingState(); } catch (e) { /* */ }
    }
  }

  function _attach() {
    _renderHost();
    var navSupp = document.getElementById('nav-supplemental');
    if (navSupp) navSupp.addEventListener('click', function () {
      setTimeout(_renderHost, 0);
    });
    // Re-render the rail when the Page-1 business-income field changes
    // so the business-gated cards (PTET / Augusta / Farm) appear or
    // disappear live. Safe to fire while the user types on Page 1 —
    // the rail host isn't focused, so no caret is lost.
    var bizInput = document.getElementById('business-income-amount');
    if (bizInput) {
      bizInput.addEventListener('input',  function () { setTimeout(_renderHost, 0); });
      bizInput.addEventListener('change', function () { setTimeout(_renderHost, 0); });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _attach);
  } else {
    _attach();
  }

  // Refresh ONLY the .supx-result-row content for cards that have
  // valueOpen=true, leaving inputs / focus / DOM identity intact.
  // Called from the calc-supplemental-extra debounced listener after
  // recomputeAll, so the displayed dollar amount stays in sync with
  // the latest input values without losing the user's caret in
  // whatever field they were typing in.
  function _refreshOpenValueRows() {
    var host = document.getElementById('supplemental-extra-host');
    if (!host) return;
    var s = _state();
    SPECS.forEach(function (spec) {
      var st = s[spec.id];
      if (!st || !st.valueOpen) return;
      var card = host.querySelector('[data-supx-strategy="' + spec.id + '"]');
      if (!card) return;
      var existing = card.querySelector('.supx-result-row');
      var fresh = _renderResultRow(spec, st);
      if (existing) {
        // Replace in place so the outer card structure (with inputs)
        // doesn't get rebuilt — preserves focus on whatever input
        // the user is typing in.
        var wrap = document.createElement('div');
        wrap.innerHTML = fresh;
        if (wrap.firstChild) existing.replaceWith(wrap.firstChild);
        else existing.remove();
      } else if (fresh) {
        card.insertAdjacentHTML('beforeend', fresh);
      }
    });
  }

  // New Client reset: re-seed every spec's state from defaults, then
  // ZERO any kind:'usd' field so the next client starts with blank
  // dollar inputs (max investment, gift amount, vehicle cost, etc.).
  // Percentages, selects, yes/no defaults survive — the advisor
  // wanted the depreciation %s and similar rate factory defaults to
  // remain (e.g. equipment-leasing depreciablePct=90, cost-seg
  // landPct=20). Interest state also clears so the cards revert
  // to neutral.
  function _resetState() {
    root[STATE_KEY]    = {};
    root[INTEREST_KEY] = {};
    var s = root[STATE_KEY];
    var i = root[INTEREST_KEY];
    SPECS.forEach(function (spec) {
      s[spec.id] = Object.assign({ detailsOpen: false, valueOpen: false }, spec.defaults || {});
      (spec.detailRows || []).forEach(function (row) {
        if (row.kind === 'usd') s[spec.id][row.id] = 0;
      });
      s[spec.id].lastResult = null;
      i[spec.id] = null;
    });
    _renderHost();
  }

  // Expose for case-storage / debugging.
  root.renderSupplementalExtra = _renderHost;
  root.refreshSupplementalExtraValueRows = _refreshOpenValueRows;
  root.resetSupplementalExtra = _resetState;
  root.__SUPPLEMENTAL_EXTRA_SPECS = SPECS;

})(window);
