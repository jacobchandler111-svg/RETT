// FILE: js/04-ui/controls.js
// Page navigation and main run/reset wiring. The app has three pages
// shown one at a time:
//   - 'inputs'     : data entry form
//   - 'projection' : multi-year results table
//   - 'allocator'  : year-1 allocator suggestions

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
  if (id === 'page-allocator') {
    try {
      const host = document.getElementById('tax-comparison-host');
      if (host && typeof renderTaxComparison === 'function') {
        renderTaxComparison(host, window.__lastComparison);
      }
    } catch(e) {
      console.warn('renderTaxComparison failed:', e && e.message);
    }
  }
}

function _yearSchedule(cfg) {
  const host = document.getElementById('year-schedule');
  if (!host) return;
  host.innerHTML = '';
  for (let i = 0; i < cfg.horizonYears; i++) {
    const yr = cfg.year1 + i;
    const row = document.createElement('div');
    row.className = 'year-row';
    row.innerHTML = '<span class="yr-label">' + yr + '</span>'
                  + '<input data-field="ordinary"   type="text" placeholder="Ordinary income" />'
                  + '<input data-field="short-gain" type="text" placeholder="Short-term gain" />'
                  + '<input data-field="long-gain"  type="text" placeholder="Long-term gain" />'
                  + '<input data-field="loss-rate"  type="text" placeholder="Loss rate %" />';
    host.appendChild(row);
  }
}

function _buildFutureYearsUI() {
  const host = document.getElementById('future-years-host');
  if (!host) return;
  const horizon = parseInt((document.getElementById('projection-years') || {}).value, 10) || 5;
  const year1 = parseInt((document.getElementById('year1') || {}).value, 10) || (new Date()).getFullYear();
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
  for (let i = 1; i < horizon; i++) {
    const yr = year1 + i;
    const prev = existing[yr] || {};
    const row = document.createElement('div');
    row.className = 'year-row';
    row.setAttribute('data-year', yr);
    row.innerHTML = '<span class="yr-label">Year ' + (i + 1) + ' (' + yr + ')</span>'
                  + '<input data-field="ordinary"   type="text" placeholder="Ordinary income" value="' + (prev.ordinary || '') + '" />'
                  + '<input data-field="short-gain" type="text" placeholder="Short-term gain" value="' + (prev['short-gain'] || '') + '" />'
                  + '<input data-field="long-gain"  type="text" placeholder="Long-term gain"  value="' + (prev['long-gain'] || '') + '" />';
    host.appendChild(row);
  }
}

// --- Custodian wiring ---------------------------------------------------
function _populateCustodian() {
  const sel = document.getElementById('custodian-select');
  if (!sel) return;
  if (typeof listCustodians !== 'function') return;
  const items = listCustodians();
  while (sel.options.length > 1) sel.remove(1);
  items.forEach(it => {
    const opt = document.createElement('option');
    opt.value = it.id;
    opt.textContent = it.label;
    sel.appendChild(opt);
  });
}

function _onCustodianChange() {
  const custSel = document.getElementById('custodian-select');
  const lcSel = document.getElementById('leverage-cap-select');
  const stratSel = document.getElementById('strategy-select');
  const info = document.getElementById('custodian-info');
  if (!custSel || !lcSel) return;
  const id = custSel.value;
  const c = (typeof getCustodian === 'function') ? getCustodian(id) : null;
  while (lcSel.options.length > 0) lcSel.remove(0);
  if (!c) {
    const opt = document.createElement('option');
    opt.value = '';
    opt.textContent = '-- choose custodian first --';
    lcSel.appendChild(opt);
    lcSel.disabled = true;
    if (info) info.textContent = 'No custodian selected. Pick a custodian above to unlock strategies and leverage caps.';
    if (stratSel) Array.from(stratSel.options).forEach(o => { o.disabled = false; });
    return;
  }
  c.allowedLeverageCaps.forEach((lev, idx) => {
    const opt = document.createElement('option');
    opt.value = String(lev);
    opt.textContent = lev.toFixed(2) + 'x';
    if (idx === c.allowedLeverageCaps.length - 1) opt.selected = true;
    lcSel.appendChild(opt);
  });
  lcSel.disabled = false;
  if (stratSel) {
    Array.from(stratSel.options).forEach(o => {
      const allowed = c.allowedStrategies.indexOf(o.value) !== -1;
      o.disabled = !allowed;
      if (!allowed && stratSel.value === o.value) {
        stratSel.value = c.allowedStrategies[0];
      }
    });
  }
  if (info) {
    const minStrat = stratSel ? stratSel.value : c.allowedStrategies[0];
    const minInv = (typeof getMinInvestment === 'function') ? getMinInvestment(id, minStrat) : 0;
    const dollarSign = String.fromCharCode(36);
    info.textContent = c.label + ' • ' + c.allowedStrategies.length + ' strategies offered • ' +
      'leverage caps: ' + c.allowedLeverageCaps.map(v => v.toFixed(2) + 'x').join(', ') +
      (minInv ? ' • minimum investment for ' + minStrat + ': ' + dollarSign + minInv.toLocaleString() : '');
  }
}

async function runProjection() {
  const _custSel0 = document.getElementById('custodian-select');
  if (_custSel0 && !_custSel0.value) {
    alert('Please select a custodian first (Page 1 → Custodian).');
    showPage('page-inputs');
    return;
  }
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
    year: cfg.year1,
    filingStatus: cfg.filingStatus,
    state: cfg.state,
    ordinaryIncome: cfg.baseOrdinaryIncome,
    shortTermGain: cfg.baseShortTermGain,
    longTermGain: cfg.baseLongTermGain
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

  const navInputs = document.getElementById('nav-inputs');
  const navProjection = document.getElementById('nav-projection');
  const navAllocator = document.getElementById('nav-allocator');
  if (navInputs)     navInputs.addEventListener('click', () => showPage('page-inputs'));
  if (navProjection) navProjection.addEventListener('click', () => showPage('page-projection'));
  if (navAllocator)  navAllocator.addEventListener('click', () => showPage('page-allocator'));

  const contBtn = document.getElementById('continue-to-projection');
  if (contBtn) contBtn.addEventListener('click', () => {
    const _cs = document.getElementById('custodian-select');
    if (_cs && !_cs.value) { alert('Please select a custodian first.'); return; }
    showPage('page-projection');
    const recBtn = document.getElementById('run-recommendation');
    if (recBtn) recBtn.click();
  });

  const projYrsSel = document.getElementById('projection-years');
  if (projYrsSel) projYrsSel.addEventListener('change', _buildFutureYearsUI);
  const year1Inp = document.getElementById('year1');
  if (year1Inp) year1Inp.addEventListener('change', _buildFutureYearsUI);
  const futureDetails = document.getElementById('future-years-details');
  if (futureDetails) futureDetails.addEventListener('toggle', () => {
    if (futureDetails.open) _buildFutureYearsUI();
  });
  _buildFutureYearsUI();

  // Custodian wiring
  _populateCustodian();
  const _custSel = document.getElementById('custodian-select');
  if (_custSel) _custSel.addEventListener('change', _onCustodianChange);
  const _stratSel = document.getElementById('strategy-select');
  if (_stratSel) _stratSel.addEventListener('change', _onCustodianChange);
  _onCustodianChange();

  showPage('page-inputs');
}

document.addEventListener('DOMContentLoaded', bindControls);
