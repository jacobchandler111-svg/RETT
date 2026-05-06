// FILE: js/04-ui/supplemental-extra-render.js
// Placeholder cards for the additional supplemental strategies the
// advisor identified from the Tax Strategy Reference Guide:
//   1. 412(e)(3) Fully Insured Plan
//   2. PTET (Pass-Through Entity SALT)
//   3. QBI Deduction (Section 199A)
//   4. R&D Credit + OBBBA R&D Expensing
//   5. 401(h) Tax Trifecta
//   6. Qualified Charitable Distributions (QCDs)
//   7. Solar ITC Investment
//   8. Film Debt Financing (Section 181)
//
// Math is intentionally NOT implemented — the other agent owns engine
// work. This file just renders cards in the same visual format as the
// oilGas / delphi cards (same .strategy-pick-card / .supp-strategy-card
// classes, same Interested/Not-Interested buttons, same Details
// dropdown). State persists via window.__rettSupplementalExtra and
// window.__rettSupplementalExtraInterest so the advisor's selections
// survive a page reload.
//
// When the math is wired in, each spec below grows a calc function
// that reads its `state` (investment, rate, etc.) and returns a
// netBenefit. The runMasterSolver registry pattern is the integration
// point — see supplemental-defaults.js for the existing pattern.

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
      keyaspect: 'SALT Cap Workaround',
      descriptor: 'Pass-through entity elects to pay state income tax at the entity level, deductible as a federal business expense &mdash; bypasses the $40K SALT cap.',
      audience: 'Pass-through owner',
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
      keyaspect: '§170 Deduction',
      descriptor: 'Cash or appreciated-asset gift to a public charity. Cash deductible up to 60% of AGI; appreciated stock at FMV up to 30% of AGI &mdash; avoids capital gains on the appreciation.',
      audience: 'Any donor',
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
    var interestCls = _interestClassFor(spec.id);
    var detailsOpenCls = st.detailsOpen ? ' is-open' : '';
    var valueOpenCls   = st.valueOpen   ? ' is-open' : '';
    var detailRows = (spec.detailRows || []).map(function (r) {
      return _renderDetailRow(spec.id, st, r);
    }).join('');
    var iState = _interestState();
    // The See Value button only makes sense once the user has marked
    // Interested (so the solver actually evaluates the strategy).
    // Disabled+muted state otherwise — the button stays in place so
    // the card height doesn't jump when interest changes.
    var seeValueDisabled = (iState[spec.id] !== true);

    return '' +
      '<div class="strategy-pick-card supp-strategy-card ' + interestCls + '" data-supx-strategy="' + spec.id + '">' +
        '<div class="strategy-pick-card-header">' +
          '<div class="strategy-pick-num">SUPPLEMENTAL <span class="num-big">' + spec.num + '</span></div>' +
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
          '<button type="button" class="strategy-pick-btn supp-pick-btn' + _btnActiveClass(spec.id, 'interested') + '" data-supx-pick-action="interested" data-supx-pick-target="' + spec.id + '">&#10003; Interested</button>' +
          '<button type="button" class="strategy-pick-btn supp-pick-btn' + _btnActiveClass(spec.id, 'not-interested') + '" data-supx-pick-action="not-interested" data-supx-pick-target="' + spec.id + '">Not Interested</button>' +
        '</div>' +
        '<button type="button" class="supp-details-arrow' + detailsOpenCls + '" data-supx-details-target="' + spec.id + '" aria-expanded="' + (st.detailsOpen ? 'true' : 'false') + '" title="' + (st.detailsOpen ? 'Hide details' : 'Show details') + '">' +
          '<span class="supp-details-arrow-chev" aria-hidden="true">&#9662;</span>' +
          '<span class="supp-details-arrow-label">Details</span>' +
        '</button>' +
        '<div class="supp-details-panel"' + (st.detailsOpen ? '' : ' hidden') + '>' +
          detailRows +
        '</div>' +
        '<button type="button" class="supx-see-value-btn' + valueOpenCls + '"' +
          (seeValueDisabled ? ' disabled aria-disabled="true" title="Mark Interested first to see the projected value"' : '') +
          ' data-supx-value-target="' + spec.id + '">' +
          (st.valueOpen ? 'Hide value' : 'See Value') +
        '</button>' +
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

  // Expose for case-storage / debugging.
  root.renderSupplementalExtra = _renderHost;
  root.__SUPPLEMENTAL_EXTRA_SPECS = SPECS;

})(window);
