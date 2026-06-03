// FILE: js/04-ui/pmq-questions.js
// Pre-Meeting Questionnaire question set + strategy-gating logic.
//
// Design goal (per advisor): minimum number of questions to filter
// the 10 supplemental strategies down to the ones applicable to the
// client. A strategy that's gated by a "no" answer auto-marks itself
// Not Interested on Page 5, so the advisor doesn't have to click
// through irrelevant ones.
//
// Questions are intentionally minimal — just three top-level + three
// conditional sub-questions. Six max if everything is "yes". Three
// if every top-level is "no".
//
// Gating logic is one-way: a "no" answer auto-marks the gated
// strategy as Not Interested. Flipping back to "yes" / unanswered
// does NOT auto-clear — the advisor sees the suggestion and chooses
// fresh. Prevents thrashing if they're exploring "what-if" scenarios.

(function (root) {
  'use strict';

  var ANSWERS_KEY = '__rettPMQAnswers';

  // ----------------------------------------------------------------
  // Questions. `showIf` = parent question must be answered with the
  // given value for this question to render. Order = display order.
  // ----------------------------------------------------------------
  // Per advisor 2026-05-26: reduced from 5 top-level questions to just
  // one - "Do you own or run a business?" - the only filter the
  // advisor wants is business vs non-business cards. Other cards always
  // show. The 'realEstate', 'charitable', 'altInvestments', and the
  // conditional 'passThrough' questions were removed.
  var PMQ_QUESTIONS = [
    {
      id:    'businessOwner',
      label: 'Do you own or run a business?',
      helper:'LLC, S-Corp, Partnership, Sole Proprietor — any active business income.',
      type:  'yesno'
    }
  ];

  // ----------------------------------------------------------------
  // Strategy gates. Each entry: a strategy id → an object of
  // required-answer pairs. ALL required answers must be `true` for
  // the strategy to be applicable. If ANY required answer is `false`,
  // the strategy is gated out (auto-marked Not Interested). If a
  // required answer is null (unanswered), the strategy stays neutral.
  //
  // Per advisor 2026-05-26: only business-owner gating applies now.
  // Non-business cards (oilGas, delphi, charitableGifts, equipment
  // leasing) always show - the advisor no longer filters them via PMQ.
  // Business-owner-gated cards: ptet, slot08 (Augusta), slot12 (Farm
  // Equipment).
  // (Heavy Vehicle slot06, 401k slot09, Aircraft slot10 hidden from the
  // rail per advisor 2026-06-03 — gates removed alongside.)
  var STRATEGY_GATES = {
    ptet:    { businessOwner: true },
    slot08:  { businessOwner: true },                         // Augusta Rule
    slot12:  { businessOwner: true }                          // Farm / Business Equipment
  };

  function _answers() {
    if (!root[ANSWERS_KEY]) root[ANSWERS_KEY] = {};
    return root[ANSWERS_KEY];
  }

  function _persist() {
    if (root.__rettApplyingState) return;
    var s = root.RETTCaseStorage;
    if (!s) return;
    // Route to active named case (if any) instead of always writing to
    // the un-named draft slot — otherwise PMQ answers don't survive a
    // refresh when a named client is loaded.
    if (typeof s.autoSaveCurrent === 'function') {
      try { s.autoSaveCurrent(); } catch (e) { /* */ }
    } else if (typeof s.saveWorkingState === 'function') {
      try { s.saveWorkingState(); } catch (e) { /* */ }
    }
  }

  // Decide whether a question should render based on its showIf
  // dependency. Sub-questions only appear when the parent has been
  // answered with the gating value.
  function _isQuestionVisible(q, answers) {
    if (!q.showIf) return true;
    return Object.keys(q.showIf).every(function (parentId) {
      return answers[parentId] === q.showIf[parentId];
    });
  }

  // ----------------------------------------------------------------
  // Strategy gating: derive the set of strategies that should be
  // auto-marked Not Interested based on current answers. Only
  // strategies whose gate has at least one explicit `no` answer
  // get auto-marked. Unanswered gates do not auto-mark.
  // ----------------------------------------------------------------
  function _computeGatedStrategies(answers) {
    var gated = {};
    Object.keys(STRATEGY_GATES).forEach(function (stratId) {
      var gates = STRATEGY_GATES[stratId];
      var anyNo = false;
      Object.keys(gates).forEach(function (qId) {
        if (answers[qId] === false) anyNo = true;
      });
      if (anyNo) gated[stratId] = true;
    });
    return gated;
  }

  // Apply gating: for each strategy that's now gated, auto-mark it
  // Not Interested in the corresponding interest state map. The
  // strategy lives in either __rettSupplementalInterest (oilGas,
  // delphi) or __rettSupplementalExtraInterest (everything else).
  // Re-renders both card hosts so the visual state updates.
  function _applyGating(answers) {
    var gated = _computeGatedStrategies(answers);
    var coreInterest  = root.__rettSupplementalInterest || {};
    var extraInterest = root.__rettSupplementalExtraInterest || {};
    var coreIds  = ['oilGas', 'delphi'];
    Object.keys(gated).forEach(function (id) {
      // Only auto-mark if not already explicitly set (avoid
      // clobbering an advisor's manual Interested click). The "auto"
      // flavor here is one-way: we set false. We never overwrite
      // an existing true (Interested) — but we DO overwrite a prior
      // null (neutral) with false (Not Interested) so the auto-gate
      // delivers the click reduction the advisor wanted.
      var bucket = (coreIds.indexOf(id) >= 0) ? coreInterest : extraInterest;
      if (bucket[id] !== true) bucket[id] = false;
    });
    // Trigger re-renders.
    if (typeof root.renderSupplementalExtra === 'function') {
      try { root.renderSupplementalExtra(); } catch (e) { /* */ }
    }
    if (typeof root.renderSupplementalPage === 'function') {
      try { root.renderSupplementalPage(); } catch (e) { /* */ }
    }
    if (typeof root.renderStrategySummary === 'function') {
      try { root.renderStrategySummary(); } catch (e) { /* */ }
    }
  }

  // ----------------------------------------------------------------
  // Renderer
  // ----------------------------------------------------------------
  function _renderQuestion(q, answers) {
    if (!_isQuestionVisible(q, answers)) return '';
    var ans = answers[q.id];
    var subClass  = q.showIf ? ' pmq-q-sub' : '';
    var control;
    if (q.type === 'toggle') {
      var onClass = (ans === true) ? ' is-on' : '';
      control =
        '<div class="pmq-q-buttons">' +
          '<button type="button" role="switch" aria-checked="' + (ans === true ? 'true' : 'false') + '" ' +
            'class="pmq-q-toggle' + onClass + '" data-pmq-action="toggle" data-pmq-target="' + q.id + '">' +
            '<span class="pmq-q-toggle-track"><span class="pmq-q-toggle-thumb"></span></span>' +
            '<span class="pmq-q-toggle-text">' + (ans === true ? 'Yes' : 'No') + '</span>' +
          '</button>' +
        '</div>';
    } else {
      var yesActive = (ans === true)  ? ' is-active' : '';
      var noActive  = (ans === false) ? ' is-active' : '';
      control =
        '<div class="pmq-q-buttons">' +
          '<button type="button" class="pmq-q-btn pmq-q-btn-yes' + yesActive + '" data-pmq-action="yes" data-pmq-target="' + q.id + '">Yes</button>' +
          '<button type="button" class="pmq-q-btn pmq-q-btn-no' + noActive + '" data-pmq-action="no" data-pmq-target="' + q.id + '">No</button>' +
        '</div>';
    }
    return '' +
      '<div class="pmq-q' + subClass + '" data-pmq-q="' + q.id + '">' +
        '<div class="pmq-q-text">' +
          '<div class="pmq-q-label">' + q.label + '</div>' +
        '</div>' +
        control +
      '</div>';
  }

  function _renderHost() {
    var host = document.getElementById('pmq-question-host');
    if (!host) return;
    var answers = _answers();
    var qHtml = PMQ_QUESTIONS.map(function (q) {
      return _renderQuestion(q, answers);
    }).join('');
    // No header row, no progress count, no helper text — just the
    // questions and a tucked-in Reset link at the very end.
    host.innerHTML = '' +
      '<div class="pmq-q-list">' + qHtml + '</div>' +
      '<div class="pmq-q-footer-row">' +
        '<button type="button" class="pmq-q-reset" id="pmq-q-reset-btn">Reset answers</button>' +
      '</div>';
    _bindEvents();
  }

  function _bindEvents() {
    var host = document.getElementById('pmq-question-host');
    if (!host || host.dataset.bound) return;
    host.dataset.bound = '1';

    host.addEventListener('click', function (ev) {
      var t = ev.target;
      if (!t || !t.closest) return;

      var resetBtn = t.closest('#pmq-q-reset-btn');
      if (resetBtn) {
        var a = _answers();
        Object.keys(a).forEach(function (k) { delete a[k]; });
        _renderHost();
        _persist();
        // Don't re-apply gating — clearing answers leaves all
        // strategies in their current state (the advisor may have
        // manually changed some).
        return;
      }

      var qBtn = t.closest('[data-pmq-action]');
      if (qBtn) {
        var qId = qBtn.getAttribute('data-pmq-target');
        var act = qBtn.getAttribute('data-pmq-action');
        var ans = _answers();
        var newVal;
        if (act === 'toggle') {
          // Switch flips between true and false (no null state on toggles).
          newVal = !(ans[qId] === true);
          ans[qId] = newVal;
        } else {
          newVal = (act === 'yes');
          // Toggle off if clicking the same answer again.
          ans[qId] = (ans[qId] === newVal) ? null : newVal;
        }
        // If a parent answer changed away from the showIf trigger,
        // null out any dependent answers so they don't linger as
        // "yes" while the parent is now "no".
        PMQ_QUESTIONS.forEach(function (sub) {
          if (sub.showIf && !_isQuestionVisible(sub, ans)) {
            ans[sub.id] = null;
          }
        });
        _renderHost();
        _applyGating(ans);
        _persist();
      }
    });
  }

  function _attach() {
    _renderHost();
    var navPmq = document.getElementById('nav-pmq');
    if (navPmq) navPmq.addEventListener('click', function () {
      setTimeout(_renderHost, 0);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _attach);
  } else {
    _attach();
  }

  // Public API for case-storage / debugging.
  root.PMQ_QUESTIONS = PMQ_QUESTIONS;
  root.PMQ_STRATEGY_GATES = STRATEGY_GATES;
  root.renderPMQQuestions = _renderHost;
  root.applyPMQGating = function () { _applyGating(_answers()); };

})(window);
