// FILE: js/04-ui/banner.js
// Lightweight top-of-page banner for non-blocking errors, warnings, and
// info notifications. Replaces silent console.warn/console.error so users
// actually see when something has gone wrong.
//
// Usage:
//   showBanner('error',   'Could not load tax data.');
//   showBanner('warning', 'Some calculations may be incomplete.');
//   showBanner('info',    'Working...');
//   hideBanner();

(function (root) {
  'use strict';

  function showBanner(level, message) {
    var el = document.getElementById('app-banner');
    if (!el) return;
    var cls = 'app-banner';
    if (level === 'error')   cls += ' banner-error';
    else if (level === 'warning') cls += ' banner-warning';
    else                          cls += ' banner-info';
    el.className = cls;
    el.innerHTML = '';
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'banner-close';
    btn.setAttribute('aria-label', 'Dismiss');
    btn.textContent = '\u00d7';
    btn.addEventListener('click', hideBanner);
    var msg = document.createElement('span');
    msg.textContent = message;
    el.appendChild(btn);
    el.appendChild(msg);
    el.hidden = false;
  }

  function hideBanner() {
    var el = document.getElementById('app-banner');
    if (!el) return;
    el.hidden = true;
    el.innerHTML = '';
    _lastMessage = '';
    _lastReportedAt = 0;
  }

  // Logs the error to the console AND surfaces a transient banner to the
  // user. Auto-dismisses after a short window so successive failures
  // don't pile up. Use this for defensive try/catch blocks where the
  // user should be notified that something didn't render but the page
  // is still usable.
  var _lastReportedAt = 0;
  var _lastMessage = '';
  function reportFailure(label, err, opts) {
    opts = opts || {};
    var msg = label + (err && err.message ? ': ' + err.message : '');
    try { console.warn(msg, err); } catch (e) { /* */ }
    // Suppress duplicates within 1.5s — keeps the banner from
    // flickering when the same catch fires repeatedly.
    var now = Date.now();
    if (msg === _lastMessage && (now - _lastReportedAt) < 1500) return;
    _lastReportedAt = now;
    _lastMessage = msg;
    showBanner(opts.level || 'warning', msg);
    var ms = opts.dismissMs != null ? opts.dismissMs : 3500;
    if (ms > 0) {
      setTimeout(function () {
        var el = document.getElementById('app-banner');
        if (el && el.textContent.indexOf(msg) !== -1) hideBanner();
      }, ms);
    }
  }

  root.showBanner    = showBanner;
  root.reportFailure = reportFailure;
  root.hideBanner = hideBanner;
})(window);
