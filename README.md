# RETT — Brooklyn Multi-Year Tax Strategy Projector

A client-side, modular projection engine that models the Brooklyn capital-loss-harvesting strategy across a five-year horizon. Built with HTML, CSS, and vanilla JavaScript. No server, no database, no build step. Deployed via GitHub Pages.

This project is the multi-year successor to the Brookhaven Tax Strategy Planning Engine. It carries forward Brookhaven's modular numbered-subsystem architecture but narrows the scope to a single strategy (Brooklyn) so we can focus on getting the multi-year projection mechanics right before adding other strategies.

## Scope

In scope (v1): Brooklyn fund tiers (Beta 1, Beta 0, Beta 0.5, Advisor Managed), leverage and fee interpolation, federal tax calc with AMT/NIIT/Additional Medicare, state tax calc for all 50 states, 2025 and 2026 IRS-published brackets, 2027 through 2031 projected at 2 percent annual inflation, capital-loss carryforward tracking, and a five-year roll-forward of basis, harvested losses, fees, and net tax savings.

Deferred to future versions: Delphi (Class A/B) and Helix funds, the multi-strategy solver from Brookhaven, multi-strategy ranking.

## Bracket Projection Methodology

The IRS does not publish brackets beyond 2026. For 2027 through 2031, this engine takes each 2026 bracket threshold and multiplies it by 1.02 raised to the power of (year minus 2026). Rates are held constant. Thresholds are kept at full floating-point precision because this is a planning model, not a return preparation tool. The 2% assumption is configurable via `TAX_DATA.inflationRate` in `js/02-tax-engine/tax-data.js`; the projection logic lives in `_yearProjectionFactor` / `_projectFlatBrackets` in `js/02-tax-engine/tax-lookups.js`.

## Project Structure

```
index.html
README.md
.gitignore
css/styles.css
data/taxBrackets.json
js/
  00-data/             custodians.js, schwab-strategies.js
  01-brooklyn/         date-utils.js (loads first — shared parseLocalDate),
                       brooklyn-data.js, time-weight.js,
                       brooklyn-interpolation.js, variable-leverage.js,
                       defaults.js
  02-tax-engine/       tax-data.js, tax-loader.js, tax-lookups.js,
                       tax-calc-federal.js, tax-calc-state.js,
                       tax-comparison.js
  03-solver/           fees.js, fee-split.js, brookhaven-fees.js,
                       single-year-solver.js, multi-year-solver.js,
                       structured-sale.js, decision-engine.js
  04-ui/               format-helpers.js (loads first), banner.js,
                       number-animator.js, case-storage.js,
                       pill-toggles.js, variable-leverage-ui.js,
                       input-validation.js, inputs-collector.js,
                       controls.js, recommendation-render.js,
                       projection-dashboard-render.js, savings-ribbon.js,
                       bracket-viz-render.js, cashflow-schedule-render.js,
                       narrative-render.js, strategy-summary-render.js
  05-projections/      carryforward-tracker.js, projection-engine.js
```

Files no longer in the codebase (deleted as dead code in earlier
cleanup passes): `tax-baseline.js`, `brooklyn-allocator.js`,
`projection-render.js`, `bracket-projector.js`. Their responsibilities
are documented inline in the surviving files.

## Script Load Order

Subsystems load in numeric order: `00 → 01 → 02 → 03 → 05 → 04`. The UI layer loads last because it depends on every primitive, lookup, calculator, and projection routine below it. Inside `04-ui`, `banner.js` loads first so other modules can call `showBanner()` for non-blocking error feedback.

## Adding a New Year of IRS Data

When the IRS publishes 2027 brackets, add the published 2027 block to `data/taxBrackets.json` for federal and each state. The synthetic projection in `js/02-tax-engine/tax-lookups.js` (`_yearProjectionFactor`) already short-circuits to the published data when present, so no projector code change is needed — bump `TAX_DATA.baseYear` in `tax-data.js` only if you want the 2% roll to start from 2027 instead of 2026.

## Deployment (GitHub Pages)

This is a static site — no build step.

1. Push to `main`.
2. In the repo on GitHub: **Settings → Pages**.
3. **Source**: Deploy from a branch.
4. **Branch**: `main`, folder `/ (root)`. Save.
5. Within ~1 minute the site is live at `https://<your-username>.github.io/RETT/`.

To bust caches after a release, bump the `?v=...` query string on the `<link>` and `<script>` tags in `index.html`.

## Local Development

Open `index.html` directly in a browser, **or** run any static file server. The app needs to fetch `data/taxBrackets.json`, which most browsers block from `file://` origins, so a server is recommended:

```
# Python 3
python -m http.server 8000

# Node
npx serve .
```

Then visit `http://localhost:8000`.

## License

Proprietary — internal use only.
