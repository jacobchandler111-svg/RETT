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
  }

  root.showBanner = showBanner;
  root.hideBanner = hideBanner;
})(window);
