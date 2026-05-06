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
      descriptor: 'Pass-through entity elects to pay state income tax at the entity level, deductible as a federal business expense &mdash; bypasses the $40K SALT cap.',
      audience: 'Pass-through owner',
      bucket: 'ordinary',
      // No investmentField — PTET is a tax payment, not capital that
      // competes with Brooklyn for sale-proceed dollars.
      defaults: {
        taxableIncome:         1000000,
        stateRate:             5.49,
        saltCapacityRemaining: 0,        // unused individual SALT cap headroom
        creditPct:             100        // % of PTET creditable on owner state return (MA = 90)
      },
      detailRows: [
        { id: 'taxableIncome',         label: 'Pass-through income',                 kind: 'usd', placeholder: '1,000,000' },
        { id: 'stateRate',             label: 'State PTET rate (%)',                 kind: 'pct', placeholder: '5.49' },
        { id: 'saltCapacityRemaining', label: 'Unused individual SALT cap',          kind: 'usd', placeholder: '0' },
        { id: 'creditPct',             label: 'PTET-to-owner credit (%)',            kind: 'pct', placeholder: '100' }
      ]
    },
    {
      id: 'charitableGifts',
      num: '04',
      name: 'Charitable Gifts',
      shortName: 'Charitable Gifts',
      keyaspect: '§170 Deduction',
      descriptor: 'Cash or appreciated-asset gift to a public charity. Cash deductible up to 60% of AGI; appreciated stock at FMV up to 30% of AGI &mdash; avoids capital gains on the appreciation.',
      audience: 'Any donor',
      bucket: 'ordinary',
      // No investmentField — gifts leave the estate but don't
      // compete with Brooklyn for sale-proceed capital (tax-side).
      defaults: {
        giftAmount:    100000,
        giftType:      'cash',     // 'cash' | 'appreciated' | 'daf'
        appreciation:  0,           // dollars of unrealized gain (appreciated path)
        agi:           0            // donor AGI for §170 percentage caps
      },
      detailRows: [
        { id: 'giftAmount',   label: 'Gift amount',                        kind: 'usd',   placeholder: '100,000' },
        { id: 'giftType',     label: 'Gift type',                          kind: 'select', options: [
            { value: 'cash',         label: 'Cash (60% AGI cap)' },
            { value: 'appreciated',  label: 'Appreciated stock / asset (30% AGI cap)' },
            { value: 'daf',          label: 'Donor-advised fund (60% AGI cap)' }
        ] },
        { id: 'appreciation', label: 'Unrealized gain (appreciated only)', kind: 'usd',   placeholder: '0' },
        { id: 'agi',          label: 'Donor AGI (for AGI cap, optional)',  kind: 'usd',   placeholder: '0' }
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
      id: 'slot05',
      num: '05',
      name: 'Cost Segregation Study',
      shortName: 'Cost Seg',
      keyaspect: 'Accelerated Depreciation',
      descriptor: 'Engineering study reclassifies 5/7/15-year personal property and land improvements out of 27.5/39-year shell &mdash; year-1 deduction multiplied by 100% bonus depreciation (OBBBA permanent post-1/19/2025).',
      audience: 'Real estate owner',
      bucket: 'capital',
      investmentField: 'purchasePrice',
      defaults: {
        purchasePrice: 2000000,
        landPct:       20,
        propertyType:  'apartment',
        newlyAcquired: true
      },
      detailRows: [
        { id: 'purchasePrice', label: 'Property purchase price',        kind: 'usd', placeholder: '2,000,000' },
        { id: 'landPct',       label: 'Land allocation (%)',            kind: 'pct', placeholder: '20' },
        { id: 'propertyType',  label: 'Property type',                  kind: 'select', options: [
            { value: 'apartment',     label: 'Apartment / Multifamily (~25%)' },
            { value: 'hotel',         label: 'Hotel (~30%)' },
            { value: 'office',        label: 'Office (~22%)' },
            { value: 'retail',        label: 'Retail (~26%)' },
            { value: 'industrial',    label: 'Manufacturing / Industrial (~35%)' },
            { value: 'restaurant',    label: 'Restaurant (~35%)' },
            { value: 'medical',       label: 'Medical / Dental (~30%)' },
            { value: 'selfStorage',   label: 'Self-Storage (~35%)' },
            { value: 'shortTerm',     label: 'STR / Vacation Rental (~30%)' }
        ] },
        { id: 'newlyAcquired', label: 'Newly acquired this year?',      kind: 'yesno' }
      ]
    },
    {
      id: 'slot06',
      num: '06',
      name: 'Heavy Vehicle Deduction',
      shortName: 'Heavy Vehicle',
      keyaspect: '§179 + 100% Bonus',
      descriptor: 'Business vehicle &gt;6,000 lb GVWR. SUVs capped at $32,000 §179 (2026); heavy pickups (6-ft bed), cargo vans, and &gt;14,000 lb vehicles take full §179 + 100% bonus on residual.',
      audience: 'Business owner',
      bucket: 'ordinary',
      defaults: {
        vehicleCost:  120000,
        vehicleClass: 'suvHeavy',
        bizUsePct:    100
      },
      detailRows: [
        { id: 'vehicleCost',  label: 'Vehicle cost',                  kind: 'usd', placeholder: '120,000' },
        { id: 'vehicleClass', label: 'Vehicle class',                 kind: 'select', options: [
            { value: 'lightAuto',   label: 'Light auto / truck (≤6,000 lb GVWR)' },
            { value: 'suvHeavy',    label: 'Heavy SUV (6,001-14,000 lb)' },
            { value: 'heavyPickup', label: 'Heavy pickup w/ ≥6-ft bed' },
            { value: 'cargoVan',    label: 'Cargo van (no rear seats)' },
            { value: 'over14000',   label: 'Vehicle &gt;14,000 lb GVWR' }
        ] },
        { id: 'bizUsePct',    label: 'Business use (%)',              kind: 'pct', placeholder: '100' }
      ]
    },
    {
      id: 'slot07',
      num: '07',
      name: 'Equipment Leasing Fund',
      shortName: 'Equip Leasing',
      keyaspect: 'Bonus Depreciation Pass-Through',
      descriptor: 'Partnership/LLC owns leased equipment. 100% bonus depreciation on placement; year-1 K-1 loss flows to investor if material participation under Reg. §1.469-5T(a). Subject to §465 at-risk + §461(l) excess-business-loss caps.',
      audience: 'Active investor',
      bucket: 'capital',
      investmentField: 'investmentAmount',
      defaults: {
        investmentAmount:  500000,
        depreciablePct:    90,
        materialPart:      false
      },
      detailRows: [
        { id: 'investmentAmount', label: 'Investment amount',                kind: 'usd', placeholder: '500,000' },
        { id: 'depreciablePct',   label: 'Depreciable basis (% of capital)', kind: 'pct', placeholder: '90' },
        { id: 'materialPart',     label: 'Material participation (§469)?',   kind: 'yesno' }
      ]
    },
    {
      id: 'slot08',
      num: '08',
      name: 'Augusta Rule &mdash; §280A(g)',
      shortName: 'Augusta Rule',
      keyaspect: '14-Day Home Rental Exclusion',
      descriptor: 'Owner&apos;s entity rents owner&apos;s residence for legitimate business meetings (≤14 days/yr). Rent deductible to entity at FMV; income excluded from owner under §280A(g). Requires arm&apos;s-length FMV substantiation post-Sinopoli.',
      audience: 'S-corp / partnership owner',
      bucket: 'ordinary',
      defaults: {
        daysRented:  14,
        fmvPerDay:   1500
      },
      detailRows: [
        { id: 'daysRented', label: 'Days rented (max 14)', kind: 'num', placeholder: '14' },
        { id: 'fmvPerDay',  label: 'FMV rental per day',   kind: 'usd', placeholder: '1,500' }
      ]
    },
    {
      id: 'slot09',
      num: '09',
      name: '401(k) + Profit Sharing',
      shortName: '401(k) + PS',
      keyaspect: 'Retirement Deferral',
      descriptor: '2026 limits: $24,500 elective + $8,000 age-50 catch-up + $11,250 super-catch-up (60-63) + 25%-of-comp employer share. §415(c) cap $72,000 (or $80,000 / $83,250 with catch-ups). Roth-mandatory if 2025 FICA wages &gt;$150,000.',
      audience: 'Business owner',
      bucket: 'ordinary',
      defaults: {
        compensation:  300000,
        ownerAge:      55,
        priorYearWages: 200000
      },
      detailRows: [
        { id: 'compensation',   label: 'Eligible compensation / SE earnings', kind: 'usd', placeholder: '300,000' },
        { id: 'ownerAge',       label: 'Owner age',                            kind: 'num', placeholder: '55' },
        { id: 'priorYearWages', label: 'Prior-year FICA wages',                kind: 'usd', placeholder: '200,000' }
      ]
    },
    {
      id: 'slot10',
      num: '10',
      name: 'Aircraft Purchase',
      shortName: 'Aircraft',
      keyaspect: 'Business Aviation Bonus',
      descriptor: '100% bonus on qualified aircraft acquired post-1/19/2025 if QBU &gt;50% (§280F predominant-use). Failure forces ADS straight-line, no bonus. §274 entertainment + commuting flights 100% disallowed; SIFL imputation on personal use.',
      audience: 'Business aviation user',
      bucket: 'capital',
      investmentField: 'aircraftCost',
      defaults: {
        aircraftCost: 3000000,
        qbuPct:       75
      },
      detailRows: [
        { id: 'aircraftCost', label: 'Aircraft acquisition cost',     kind: 'usd', placeholder: '3,000,000' },
        { id: 'qbuPct',       label: 'Qualified business use (%)',    kind: 'pct', placeholder: '75' }
      ]
    },
    {
      id: 'slot11',
      num: '11',
      name: 'Short-Term Rental Loophole',
      shortName: 'STR Loophole',
      keyaspect: 'Non-Passive Bonus + Cost Seg',
      descriptor: 'Avg guest stay ≤7 days + material participation (Reg. §1.469-1T(e)(3)(ii)) → activity is non-passive. Stack with cost segregation + 100% bonus to offset W-2 / active income with year-1 paper loss.',
      audience: 'STR investor',
      bucket: 'capital',
      investmentField: 'propertyCost',
      defaults: {
        propertyCost:    1500000,
        landPct:         20,
        avgUseDays:      5,
        materialPart:    true
      },
      detailRows: [
        { id: 'propertyCost', label: 'Property cost',                       kind: 'usd', placeholder: '1,500,000' },
        { id: 'landPct',      label: 'Land allocation (%)',                 kind: 'pct', placeholder: '20' },
        { id: 'avgUseDays',   label: 'Avg guest stay (days)',               kind: 'num', placeholder: '5' },
        { id: 'materialPart', label: 'Material participation (any test)?', kind: 'yesno' }
      ]
    },
    {
      id: 'slot12',
      num: '12',
      name: 'Farm / Business Equipment',
      shortName: 'Equipment',
      keyaspect: '§179 + 100% Bonus',
      descriptor: 'Equipment placed in service post-1/19/2025. §179 cap $2,560,000 (phase-out begins $4,090,000); 100% bonus on residual. §179 limited by business taxable income; carryforward unlimited.',
      audience: 'Farm / business operator',
      bucket: 'capital',
      investmentField: 'equipmentCost',
      defaults: {
        equipmentCost:    1000000,
        bizTaxableIncome: 500000,
        isFarm:           false
      },
      detailRows: [
        { id: 'equipmentCost',    label: 'Equipment cost',           kind: 'usd', placeholder: '1,000,000' },
        { id: 'bizTaxableIncome', label: 'Business taxable income',  kind: 'usd', placeholder: '500,000' },
        { id: 'isFarm',           label: 'Schedule F farm?',         kind: 'yesno' }
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
    var allocOut  = (typeof root.runAllocator    === 'function')
      ? root.runAllocator((root.collectInputs && root.collectInputs().availableCapital) || 0)
      : null;
    var solverEntry = solverOut && solverOut.supplementals
      ? solverOut.supplementals.filter(function (s) { return s.id === id; })[0]
      : null;
    var allocEntry  = allocOut && allocOut.supplementals
      ? allocOut.supplementals.filter(function (s) { return s.id === id; })[0]
      : null;
    if (!solverEntry || !solverEntry.available) {
      return { state: 'pending' };
    }
    var benefit = Number(solverEntry.netBenefit) || 0;
    var invested = allocEntry ? (Number(allocEntry.investment) || 0) : 0;
    if (benefit > 0 && invested > 0) {
      return { state: 'value', netBenefit: benefit, investment: invested };
    }
    return { state: 'crowded' };
  }

  function _renderResultRow(spec, st) {
    if (!st.valueOpen) return '';
    var r = _readResultState(spec.id);
    var body;
    if (r.state === 'value') {
      body = '<div class="supx-result-amt">' + _fmtUSD(r.netBenefit) + '</div>' +
             '<div class="supx-result-sub">net tax benefit &middot; ' + _fmtUSD(r.investment) + ' invested</div>';
    } else if (r.state === 'crowded') {
      body = '<div class="supx-result-msg">Other strategies utilized</div>' +
             '<div class="supx-result-sub">Interested noted &mdash; the allocator routed capital to higher-ROI options for this scenario.</div>';
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

    return '' +
      '<div class="strategy-pick-card supp-strategy-card ' + interestCls + '" data-supx-strategy="' + spec.id + '">' +
        '<div class="strategy-pick-card-header">' +
          '<div class="strategy-pick-num">SUPPLEMENTAL <span class="num-big">' + spec.num + '</span></div>' +
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
        detailsBlock +
        valueArrow +
        _renderResultRow(spec, st) +
      '</div>';
  }

  function _renderHost() {
    var host = document.getElementById('supplemental-extra-host');
    if (!host) return;
    var iState = _interestState();
    // Sort: not-interested cards drop to the end, then by spec order.
    var sorted = SPECS.slice().sort(function (a, b) {
      var an = iState[a.id] === false ? 1 : 0;
      var bn = iState[b.id] === false ? 1 : 0;
      return an - bn;
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

      var pickBtn = t.closest('[data-supx-pick-action]');
      if (pickBtn) {
        var target = pickBtn.getAttribute('data-supx-pick-target');
        var action = pickBtn.getAttribute('data-supx-pick-action');
        var newVal = (action === 'interested') ? true : false;
        var iState = _interestState();
        iState[target] = (iState[target] === newVal) ? null : newVal;
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
      _persist();
    });
  }

  function _persist() {
    if (root.__rettApplyingState) return;
    if (root.RETTCaseStorage && typeof root.RETTCaseStorage.saveWorkingState === 'function') {
      try { root.RETTCaseStorage.saveWorkingState(); } catch (e) { /* */ }
    }
  }

  function _attach() {
    _renderHost();
    var navSupp = document.getElementById('nav-supplemental');
    if (navSupp) navSupp.addEventListener('click', function () {
      setTimeout(_renderHost, 0);
    });
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

  // Expose for case-storage / debugging.
  root.renderSupplementalExtra = _renderHost;
  root.refreshSupplementalExtraValueRows = _refreshOpenValueRows;
  root.__SUPPLEMENTAL_EXTRA_SPECS = SPECS;

})(window);
