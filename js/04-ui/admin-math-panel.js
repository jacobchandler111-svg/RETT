// js/04-ui/admin-math-panel.js
//
// Admin math reveal mode (Chunk 0 - foundation only).
//
// Locked behind a double-click on the RETT logo + passcode. When
// unlocked, every page renders an additional "Math Behind This Page"
// panel at the bottom showing the calculations driving the visible
// numbers. Read-only - pulls from existing engine outputs
// (collectInputs, unifiedTaxComparison, runFullPipeline) and never
// modifies state.
//
// Chunk 0 ships: unlock/lock flow, ADMIN badge, panel scaffold
// injection, and the dispatcher with a per-page registration API.
// No page-specific math content yet - that lands in chunks 1-3 via
// _registerPageMath('page-xxx', renderFn).
//
// Hard nope: this is NOT a security boundary. The passcode hash
// lives in localStorage and the panel content is computed in-page.
// Anyone with devtools access can flip __rettAdmin manually. The
// gate is here purely to keep the math drawer hidden from clients
// during live demos.
(function (root) {
  'use strict';

  var LS_HASH = '_rettAdminHash';
  var LS_FLAG = '_rettAdmin';
  // Page ids matching index.html <section class="page"> nodes.
  // Keep in sync with PAGE_IDS in controls.js - if a new page tab
  // is ever added there, mirror it here so the panel injection
  // covers it.
  var PAGE_IDS = ['page-pmq', 'page-inputs', 'page-baseline',
                  'page-strategies', 'page-projection',
                  'page-supplemental', 'page-allocator', 'page-temp'];

  // SHA-256 hex digest of the passcode via SubtleCrypto. Available on
  // localhost + HTTPS contexts (GitHub Pages qualifies). Falls back to
  // raw string compare on legacy contexts - this is hygiene, not
  // security.
  function _hash(input) {
    if (!root.crypto || !root.crypto.subtle) {
      return Promise.resolve(input);
    }
    var enc = new TextEncoder().encode(input);
    return root.crypto.subtle.digest('SHA-256', enc).then(function (buf) {
      return Array.from(new Uint8Array(buf)).map(function (b) {
        return b.toString(16).padStart(2, '0');
      }).join('');
    });
  }

  // Rehydrate admin state from localStorage on boot. Flag is the
  // session state ("admin currently active in this browser"); hash is
  // the persistent credential ("here's what passcode looks like"). A
  // lock clears the flag but keeps the hash so the next unlock just
  // re-prompts. To fully reset, manually clear localStorage.
  function _rehydrate() {
    try {
      root.__rettAdmin = (
        localStorage.getItem(LS_FLAG) === '1'
        && !!localStorage.getItem(LS_HASH)
      );
    } catch (e) {
      root.__rettAdmin = false;
    }
  }

  // Inject one <section class="admin-math-panel" hidden> as a sibling
  // after each existing <section class="page">. Idempotent so it's safe
  // to call on every render. The panel body has a stable id so per-
  // page renderers (chunks 1-3) can target it directly.
  function _injectPanels() {
    PAGE_IDS.forEach(function (pid) {
      var page = document.getElementById(pid);
      if (!page) return;
      var panelId = 'admin-math-' + pid;
      if (document.getElementById(panelId)) return;
      var panel = document.createElement('section');
      panel.id = panelId;
      panel.className = 'admin-math-panel';
      panel.hidden = true;
      panel.innerHTML =
        '<div class="admin-math-header">' +
          '<h3>Math Behind This Page</h3>' +
          '<span class="admin-math-flag">ADMIN ONLY</span>' +
        '</div>' +
        '<div class="admin-math-body" id="admin-math-body-' + pid + '">' +
          '<p class="admin-math-empty">No math content registered for this page yet.</p>' +
        '</div>';
      page.parentNode.insertBefore(panel, page.nextSibling);
    });
  }

  // Per-page render registry. Each entry is a function that returns
  // an HTML string to drop into <div class="admin-math-body">. Chunks
  // 1-3 register their content via root._registerPageMath.
  var _pageRenderers = {};

  function _registerPageMath(pageId, renderFn) {
    _pageRenderers[pageId] = renderFn;
  }

  // Dispatcher - called by controls.js showPage after each page entry.
  // Hides all panels when admin is off; otherwise shows the active
  // page's panel and renders content via the registered renderer (or
  // shows the placeholder text if no renderer is registered yet).
  function renderAdminMath(activePageId) {
    if (!root.__rettAdmin) {
      PAGE_IDS.forEach(function (pid) {
        var p = document.getElementById('admin-math-' + pid);
        if (p) p.hidden = true;
      });
      return;
    }
    _injectPanels();
    PAGE_IDS.forEach(function (pid) {
      var p = document.getElementById('admin-math-' + pid);
      if (!p) return;
      var isActive = (pid === activePageId);
      p.hidden = !isActive;
      if (!isActive) return;
      var body = document.getElementById('admin-math-body-' + pid);
      if (!body) return;
      var fn = _pageRenderers[pid];
      if (typeof fn !== 'function') {
        body.innerHTML = '<p class="admin-math-empty">No math content registered for this page yet.</p>';
        return;
      }
      try {
        body.innerHTML = fn();
      } catch (e) {
        body.innerHTML = '<p class="admin-math-error">Math panel error: ' +
          String((e && e.message) || e) + '</p>';
      }
    });
  }

  // Show / hide the ADMIN badge based on current state.
  function _refreshBadge() {
    var badge = document.getElementById('rett-admin-badge');
    if (badge) badge.hidden = !root.__rettAdmin;
  }

  // First unlock prompts to set a passcode; subsequent unlocks verify
  // against the stored hash. Returns a promise so the dblclick handler
  // can swallow errors uniformly.
  function _unlockFlow() {
    var existingHash;
    try { existingHash = localStorage.getItem(LS_HASH); } catch (e) { existingHash = null; }
    if (!existingHash) {
      var newPass = prompt('Set admin passcode (4+ characters):');
      if (!newPass || newPass.length < 4) {
        if (newPass != null) alert('Passcode must be at least 4 characters.');
        return Promise.resolve();
      }
      return _hash(newPass).then(function (h) {
        try {
          localStorage.setItem(LS_HASH, h);
          localStorage.setItem(LS_FLAG, '1');
        } catch (e) { return; }
        root.__rettAdmin = true;
        _afterUnlock();
      });
    }
    var pass = prompt('Enter admin passcode:');
    if (!pass) return Promise.resolve();
    return _hash(pass).then(function (ph) {
      if (ph !== existingHash) { alert('Wrong passcode.'); return; }
      try { localStorage.setItem(LS_FLAG, '1'); } catch (e) {}
      root.__rettAdmin = true;
      _afterUnlock();
    });
  }

  // Shared post-unlock work: inject panels, paint badge, immediately
  // re-render the active page's math so the panel pops in without a
  // manual nav.
  function _afterUnlock() {
    _injectPanels();
    _refreshBadge();
    var active = document.querySelector('section.page.active');
    var pid = active && active.id;
    if (pid) renderAdminMath(pid);
  }

  function _lock() {
    root.__rettAdmin = false;
    try { localStorage.removeItem(LS_FLAG); } catch (e) {}
    _refreshBadge();
    PAGE_IDS.forEach(function (pid) {
      var p = document.getElementById('admin-math-' + pid);
      if (p) p.hidden = true;
    });
  }

  // Click-count tracker so the RETT logo can drive both unlock
  // (2 quick clicks when locked) and lock (3 quick clicks when
  // unlocked) without conflicting handlers. Window for grouping
  // clicks together is 500ms.
  function _wireTriggers() {
    var logo = document.querySelector('header.header .header-left h1');
    if (logo) {
      logo.classList.add('rett-admin-trigger');
      logo.title = 'Double-click to unlock admin mode • Triple-click to log out';
      var _clickCount = 0;
      var _clickTimer = null;
      logo.addEventListener('click', function (e) {
        e.preventDefault();
        _clickCount += 1;
        if (_clickTimer) clearTimeout(_clickTimer);
        _clickTimer = setTimeout(function () {
          var n = _clickCount;
          _clickCount = 0;
          _clickTimer = null;
          // 3+ clicks while admin is ON -> log out. The user explicitly
          // requested this gesture so the badge clears without having
          // to hunt for the small badge button in the corner.
          if (n >= 3 && root.__rettAdmin) {
            _lock();
            return;
          }
          // Exactly 2 clicks while admin is OFF -> open the unlock prompt.
          if (n === 2 && !root.__rettAdmin) {
            _unlockFlow().catch(function (err) {
              if (typeof console !== 'undefined') console.warn('Admin unlock failed:', err);
            });
          }
        }, 500);
      });
    }
    var badge = document.getElementById('rett-admin-badge');
    if (badge) badge.addEventListener('click', _lock);
  }

  function _init() {
    _rehydrate();
    _wireTriggers();
    if (root.__rettAdmin) {
      _injectPanels();
      _refreshBadge();
    }
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', _init);
  } else {
    _init();
  }

  root.renderAdminMath = renderAdminMath;
  root._registerPageMath = _registerPageMath;
})(window);
