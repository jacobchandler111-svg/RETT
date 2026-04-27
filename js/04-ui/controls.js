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

// Render Year-2..Year-N future income override rows on the Client Inputs page.
// Each row writes to data-field attributes that collectInputs() reads via
// _arrayFromRows('.year-row', ...). Empty inputs fall through to year-1 base values.
// These rows are written to #future-years-host (separate from #year-schedule).
function _buildFutureYearsUI() {
    const host = document.getElementById('future-years-host');
    if (!host) return;
    const horizon = parseInt((document.getElementById('projection-years') || {}).value, 10) || 5;
    const year1   = parseInt((document.getElementById('year1') || {}).value, 10) || (new Date()).getFullYear();
    // Preserve existing values when re-rendering
    const existing = {};
    host.querySelectorAll('.year-row').forEach(r => {
        const y = parseInt(r.getAttribute('data-year'), 10);
        if (!Number.isFinite(y)) return;
        existing[y] = {};
        r.querySelectorAll('input[data-field]').forEach(inp => {
            existing[y][inp.getAttribute('data-field')] = inp.value;
        });
    });
    host.innerHTML = '';
    // Years 2..horizon (Year 1 already entered above as the 'Income Sources' block)
    for (let i = 1; i < horizon; i++) {
        const yr = year1 + i;
        const prev = existing[yr] || {};
        const row = document.createElement('div');
        row.className = 'year-row';
        row.setAttribute('data-year', yr);
        row.innerHTML =
            '<span class="yr-label">Year ' + (i + 1) + ' (' + yr + ')</span>' +
            '<input data-field="ordinary"   type="text" placeholder="Ordinary income" value="' + (prev.ordinary || '') + '" />' +
            '<input data-field="short-gain" type="text" placeholder="Short-term gain"  value="' + (prev['short-gain'] || '') + '" />' +
            '<input data-field="long-gain"  type="text" placeholder="Long-term gain"   value="' + (prev['long-gain'] || '') + '" />';
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

  
    // Re-render Future Year Estimates rows whenever horizon, year1, or details panel toggles
    const projYrsSel = document.getElementById('projection-years');
    if (projYrsSel) projYrsSel.addEventListener('change', _buildFutureYearsUI);
    const year1Inp = document.getElementById('year1');
    if (year1Inp) year1Inp.addEventListener('change', _buildFutureYearsUI);
    const futureDetails = document.getElementById('future-years-details');
    if (futureDetails) futureDetails.addEventListener('toggle', () => { if (futureDetails.open) _buildFutureYearsUI(); });
    // Also build once on initial load so values persist if user opens the panel later
    _buildFutureYearsUI();

        showPage('page-inputs');
}

document.addEventListener('DOMContentLoaded', bindControls);
