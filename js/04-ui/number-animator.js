// FILE: js/04-ui/number-animator.js
// Animated number transitions on KPI tiles, the savings ribbon, and the
// Strategy Summary hero. Pattern source: ProjectionLab and most modern
// fintech dashboards — small touch, big perception lift.
//
// How it works:
//   - After any renderer paints HTML, call animateRettNumbers(rootEl).
//   - The animator finds elements with class .rett-kpi-value, .ribbon-value,
//     .rett-hero-value (configurable below) and any element marked
//     [data-animate-number].
//   - It parses the dollar value (or raw number) from the textContent,
//     compares to the previous value cached on the element, and uses
//     requestAnimationFrame to count from previous → new over ~400ms.
//   - First render skips the animation (no previous to count from).
//
// Respects prefers-reduced-motion: skips animation if user prefers.

(function (root) {
  'use strict';

  var DURATION_MS = 400;
  var TARGET_SELECTORS = '.rett-kpi-value, .ribbon-value, .rett-hero-value, [data-animate-number]';

  var prefersReducedMotion = false;
  try {
    prefersReducedMotion = root.matchMedia &&
      root.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch (e) { /* old browsers */ }

  // Parse a numeric value out of a display string. Handles:
  //   "$1,234"           -> 1234
  //   "+$1,234"          -> 1234
  //   "−$1,234" / "-$1,234" -> -1234
  //   "$2.5M"            -> 2500000
  //   "$300k"            -> 300000
  //   "32%"              -> 32 (with __isPercent marker on the el)
  //   "—" or empty       -> null
  function _parseNumber(text) {
    if (!text) return null;
    var s = String(text).trim();
    if (!s || s === '\u2014' || s === '-' || s === '\u221E') return null;
    var neg = /^[\u2212\-]/.test(s);
    s = s.replace(/^[+\u2212\-]/, '');
    var pct = /%\s*$/.test(s);
    s = s.replace(/[%\$\s,]/g, '');
    var mult = 1;
    if (/m$/i.test(s)) { mult = 1e6; s = s.slice(0, -1); }
    else if (/k$/i.test(s)) { mult = 1e3; s = s.slice(0, -1); }
    var n = parseFloat(s);
    if (!isFinite(n)) return null;
    n = n * mult * (neg ? -1 : 1);
    return { value: n, isPercent: pct };
  }

  // Format a number back to the same display style we read it as.
  function _formatNumber(n, opts) {
    if (opts && opts.isPercent) return Math.round(n) + '%';
    if (opts && opts.compact) {
      var abs = Math.abs(n);
      var sign = n < 0 ? '-' : (opts.signed && n > 0 ? '+' : '');
      if (abs >= 1e6) return sign + '$' + (abs / 1e6).toFixed(abs >= 1e7 ? 1 : 2) + 'M';
      if (abs >= 1e3) return sign + '$' + (abs / 1e3).toFixed(0) + 'k';
      return sign + '$' + Math.round(abs).toLocaleString('en-US');
    }
    var pre = '';
    if (opts && opts.signed && n > 0) pre = '+';
    if (opts && opts.signed && n < 0) pre = '\u2212';
    var absN = Math.abs(n);
    var rounded = Math.round(absN);
    return pre + (opts && opts.dollar !== false ? '$' : '') + rounded.toLocaleString('en-US');
  }

  function _easeOut(t) { return 1 - Math.pow(1 - t, 3); }

  // Animate one element from (cached previous, or 0) to its currently rendered value.
  function _animateEl(el) {
    var rendered = el.textContent;
    // Prefer an explicit data-numeric-value attribute when the
    // renderer set one — that's the locale-proof source of truth.
    // Falls back to the regex parse on rendered text for older
    // renderers that don't set the attr yet.
    var explicitNum = el.getAttribute('data-numeric-value');
    var parsed;
    if (explicitNum != null && explicitNum !== '') {
      var n = Number(explicitNum);
      if (Number.isFinite(n)) {
        parsed = { value: n };
      }
    }
    if (!parsed) parsed = _parseNumber(rendered);
    if (!parsed) {
      delete el.__rett_lastValue;
      return;
    }
    var to = parsed.value;
    var from = (el.__rett_lastValue != null) ? el.__rett_lastValue : null;
    el.__rett_lastValue = to;

    if (from == null || from === to || prefersReducedMotion) {
      // First paint or same value — leave the rendered text alone.
      return;
    }

    // Detect format style from the existing rendered text so we restore it.
    var compact = /[Mk]/.test(rendered);
    var signed = /^[+\u2212\-]/.test(rendered.trim());
    var dollar = /\$/.test(rendered);
    var fmtOpts = {
      compact: compact,
      signed: signed,
      dollar: dollar,
      isPercent: parsed.isPercent
    };

    var start = performance.now();
    function tick(now) {
      var elapsed = now - start;
      var t = Math.min(1, elapsed / DURATION_MS);
      var eased = _easeOut(t);
      var current = from + (to - from) * eased;
      el.textContent = _formatNumber(current, fmtOpts);
      if (t < 1 && el.__rett_lastValue === to) {
        requestAnimationFrame(tick);
      } else if (el.__rett_lastValue === to) {
        // Natural completion — restore the originally-rendered text in
        // case our format diverges slightly from the renderer's format.
        el.textContent = rendered;
      }
      // Otherwise (lastValue !== to): a newer render fired mid-flight
      // and already overwrote textContent with the latest text. Don't
      // restore the captured `rendered` here — it would flash a stale
      // value over the new one. (Issue #45 fix.)
    }
    requestAnimationFrame(tick);
  }

  function animateRettNumbers(scope) {
    var rootEl = scope || document;
    var els = rootEl.querySelectorAll(TARGET_SELECTORS);
    els.forEach(_animateEl);
  }

  root.animateRettNumbers = animateRettNumbers;
})(window);
