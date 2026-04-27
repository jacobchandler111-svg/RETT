// FILE: js/04-ui/controls.js
// Page navigation and main run/reset wiring. The app has three pages
// shown one at a time:
//   - 'inputs'      : data entry form
//   - 'projection'  : multi-year results table
//   - 'allocator'   : year-1 allocator suggestions

const PAGE_IDS = ['page-inputs', 'page-projection', 'page-allocator'];

function showPage(id) {
      PAGE_IDS.forEach(p => {
            const el = document.getElementById(p);
            if (el) {
              const isActive = (p === id);
              el.classList.toggle('active', isActive);
              el.style.display = isActive ? '' : 'none';
            }
            const tabId = p.replace('page-', 'nav-');
            const tab = document.getElementById(tabId);
            if (tab) tab.classList.toggle('active', p === id);
      });
      // When the Allocator tab is shown, re-render the latest tax comparison.
      if (id === 'page-allocator') {
            try {
                  const host = document.getElementById('tax-comparison-host');
                  if (host && typeof renderTaxComparison === 'function') {
                        renderTaxComparison(host, window.__lastComparison);
                  }
            } catch(e) { console.warn('renderTaxComparison failed:', e && e.message); }
      }
}

function _yearSchedule(cfg) {
      // Build per-year schedule rows on demand so the user can fill in the
    // multi-year sale structure. If a row already exists, leave it alone.
    const host = document.getElementById('year-schedule');
      if (!host) return;
      host.innerHTML = '';
      for (let i = 0; i < cfg.horizonYears; i++) {
                const yr = cfg.year1 + i;
                const row = document.createElement('div');
                row.className = 'year-row';
                row.innerHTML =
                              '<span class="yr-label">' + yr + '</span>' +
                              '<input data-field="ordinary"   type="text" placeholder="Ordinary income" />' +
                              '<input data-field="short-gain" type="text" placeholder="Short-term gain" />' +
                              '<input data-field="long-gain"  type="text" placeholder="Long-term gain" />' +
                              '<input data-field="loss-rate"  type="text" placeholder="Loss rate %" />';
                host.appendChild(row);
      }
}

async function runProjection() {
      if (!isTaxDataLoaded()) {
                try { await loadTaxData(); }
                catch (e) {
                              alert('Failed to load tax brackets: ' + e.message);
                              return;
                }
      }
      const cfg = collectInputs();

    const allocation = allocateBrooklyn({
              availableCapital: cfg.availableCapital || cfg.investment,
              year:             cfg.year1,
              filingStatus:     cfg.filingStatus,
              state:            cfg.state,
              ordinaryIncome:   cfg.baseOrdinaryIncome,
              shortTermGain:    cfg.baseShortTermGain,
              longTermGain:     cfg.baseLongTermGain
    });
      renderAllocator(allocation);

    const result = ProjectionEngine.run(cfg);
      renderProjection(result);
      showPage('page-projection');
}

function bindControls() {
      const runBtn = document.getElementById('run-projection');
      if (runBtn) runBtn.addEventListener('click', runProjection);

    const buildSchedBtn = document.getElementById('build-year-schedule');
      if (buildSchedBtn) {
                buildSchedBtn.addEventListener('click', () => {
                              const cfg = collectInputs();
                              _yearSchedule(cfg);
                });
      }

    const navInputs     = document.getElementById('nav-inputs');
      const navProjection = document.getElementById('nav-projection');
      const navAllocator  = document.getElementById('nav-allocator');
      if (navInputs)     navInputs.addEventListener('click',     () => showPage('page-inputs'));
      if (navProjection) navProjection.addEventListener('click', () => showPage('page-projection'));
      if (navAllocator)  navAllocator.addEventListener('click',  () => showPage('page-allocator'));

    const contBtn = document.getElementById('continue-to-projection');
      if (contBtn) contBtn.addEventListener('click', () => {
        showPage('page-projection');
        const recBtn = document.getElementById('run-recommendation');
        if (recBtn) recBtn.click();
      });

      showPage('page-inputs');
}

document.addEventListener('DOMContentLoaded', bindControls);
