// FILE: js/02-tax-engine/tax-loader.js
// Fetches data/taxBrackets.json, decodes the 999999999 sentinel back to
// JavaScript Infinity, and populates the TAX_DATA cache exposed by
// tax-data.js. The loader is idempotent.

const TAX_INFINITY_SENTINEL = 999999999;

function decodeTaxInfinity(node) {
      if (node === TAX_INFINITY_SENTINEL) return Infinity;
      if (Array.isArray(node)) return node.map(decodeTaxInfinity);
      if (node && typeof node === 'object') {
                const out = {};
                for (const k of Object.keys(node)) out[k] = decodeTaxInfinity(node[k]);
                return out;
      }
      return node;
}

async function loadTaxData(url) {
      if (isTaxDataLoaded()) return TAX_DATA;
      const path = url || 'data/taxBrackets.json';
      const resp = await fetch(path, { cache: 'no-cache' });
      if (!resp.ok) throw new Error('taxBrackets.json fetch failed: ' + resp.status);
      const raw  = await resp.json();
      const decoded = decodeTaxInfinity(raw);
      setTaxData(decoded);
      return TAX_DATA;
}
