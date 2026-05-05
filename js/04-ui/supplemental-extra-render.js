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
  var SPECS = [
    {
      id: 'plan412e3',
      num: '03',
      name: '412(e)(3) Fully Insured Plan',
      keyaspect: 'Maximum Deduction',
      descriptor: 'A defined-benefit plan funded with insurance contracts. Allows business owners to deduct $300K&ndash;$1M+ per year &mdash; the largest annual deduction available.',
      audience: 'Business owner',
      defaults: { contribution: 350000, ageOwner: 55 },
      detailRows: [
        { id: 'contribution', label: 'Annual contribution', kind: 'usd', placeholder: '350,000' },
        { id: 'ageOwner',     label: 'Owner age',           kind: 'num', placeholder: '55' }
      ]
    },
    {
      id: 'ptet',
      num: '04',
      name: 'PTET &mdash; Pass-Through Entity SALT',
      keyaspect: 'SALT Cap Workaround',
      descriptor: 'Pass-through entity elects to pay state income tax at the entity level, deductible as a federal business expense &mdash; bypasses the $40K SALT cap.',
      audience: 'Pass-through owner',
      defaults: { stateRate: 5.49, taxableIncome: 1000000 },
      detailRows: [
        { id: 'taxableIncome', label: 'Pass-through income',  kind: 'usd', placeholder: '1,000,000' },
        { id: 'stateRate',     label: 'State tax rate (%)',   kind: 'pct', placeholder: '5.49' }
      ]
    },
    {
      id: 'qbi',
      num: '05',
      name: 'QBI Deduction (199A)',
      keyaspect: '20% Deduction',
      descriptor: 'A 20% deduction on qualified business income from pass-through entities. Phases out for high-earning service-business owners.',
      audience: 'Pass-through owner',
      defaults: { qbiIncome: 500000, isSSTB: false },
      detailRows: [
        { id: 'qbiIncome', label: 'Qualified business income', kind: 'usd', placeholder: '500,000' },
        { id: 'isSSTB',    label: 'Specified service business?', kind: 'yesno' }
      ]
    },
    {
      id: 'rdCredit',
      num: '06',
      name: 'R&amp;D Credit + Expensing',
      keyaspect: 'Credit & Deduction',
      descriptor: 'Dollar-for-dollar federal credit on qualified research expenses, paired with OBBBA&rsquo;s immediate expensing of domestic R&amp;D costs.',
      audience: 'Tech / manufacturing',
      defaults: { rdSpend: 500000 },
      detailRows: [
        { id: 'rdSpend', label: 'Annual R&D spend', kind: 'usd', placeholder: '500,000' }
      ]
    },
    {
      id: 'plan401h',
      num: '07',
      name: '401(h) Tax Trifecta',
      keyaspect: 'Triple Tax Benefit',
      descriptor: 'Add-on to a defined-benefit plan: contributions are deductible, growth is tax-free, and withdrawals for retiree medical expenses are tax-free.',
      audience: 'Business owner',
      defaults: { medContribution: 50000 },
      detailRows: [
        { id: 'medContribution', label: 'Annual medical contribution', kind: 'usd', placeholder: '50,000' }
      ]
    },
    {
      id: 'qcd',
      num: '08',
      name: 'Qualified Charitable Distribution',
      keyaspect: 'Charitable RMD Bypass',
      descriptor: 'Direct transfer from an IRA to a charity at age 70.5+. Counts toward the RMD but never enters taxable income &mdash; cleanest charitable lever for retirees.',
      audience: 'Retiree (70.5+)',
      defaults: { qcdAmount: 100000 },
      detailRows: [
        { id: 'qcdAmount', label: 'QCD amount', kind: 'usd', placeholder: '100,000' }
      ]
    },
    {
      id: 'solarITC',
      num: '09',
      name: 'Solar ITC Investment',
      keyaspect: 'Federal Credit + MACRS',
      descriptor: 'Tax-equity partnership in a solar project: 30% Investment Tax Credit plus 5-year MACRS depreciation. Combines a credit and a deduction.',
      audience: 'Passive investor',
      defaults: { solarInvestment: 250000 },
      detailRows: [
        { id: 'solarInvestment', label: 'Investment amount', kind: 'usd', placeholder: '250,000' }
      ]
    },
    {
      id: 'film181',
      num: '10',
      name: 'Film Debt Financing (§181)',
      keyaspect: 'Section 181 Expensing',
      descriptor: 'Investment in film production debt. Section 181 allows immediate expensing of the full cost in Y1 for qualified domestic productions.',
      audience: 'HNW investor',
      defaults: { filmInvestment: 250000 },
      detailRows: [
        { id: 'filmInvestment', label: 'Investment amount', kind: 'usd', placeholder: '250,000' }
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
    }
    html += '</div></div>';
    return html;
  }

  function _renderCard(spec) {
    var st = _state()[spec.id];
    var interestCls = _interestClassFor(spec.id);
    var detailsOpenCls = st.detailsOpen ? ' is-open' : '';
    var detailRows = (spec.detailRows || []).map(function (r) {
      return _renderDetailRow(spec.id, st, r);
    }).join('');

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
          '<p class="supp-details-note">Math placeholder &mdash; coming with the engine work.</p>' +
        '</div>' +
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
        st[fieldId] = (raw === 'yes');
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
