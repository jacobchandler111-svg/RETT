# RETT — Brooklyn Multi-Year Tax Strategy Projector

A client-side, modular projection engine that models the Brooklyn capital-loss-harvesting strategy across a five-year horizon. Built with HTML, CSS, and vanilla JavaScript. No server, no database, no build step. Deployed via GitHub Pages.

This project is the multi-year successor to the Brookhaven Tax Strategy Planning Engine. It carries forward Brookhaven's modular numbered-subsystem architecture but narrows the scope to a single strategy (Brooklyn) so we can focus on getting the multi-year projection mechanics right before adding other strategies.

## Scope

In scope (v1): Brooklyn fund tiers (Beta 1, Beta 0, Beta 0.5, Advisor Managed), leverage and fee interpolation, federal tax calc with AMT/NIIT/Additional Medicare, state tax calc for all 50 states, 2025 and 2026 IRS-published brackets, 2027 through 2031 projected at 2 percent annual inflation, capital-loss carryforward tracking, and a five-year roll-forward of basis, harvested losses, fees, and net tax savings.

Deferred to future versions: Delphi (Class A/B) and Helix funds, the multi-strategy solver from Brookhaven, multi-strategy ranking.

## Bracket Projection Methodology

The IRS does not publish brackets beyond 2026. For 2027 through 2031, this engine takes each 2026 bracket threshold and multiplies it by 1.02 raised to the power of (year minus 2026). Rates are held constant. Thresholds are kept at full floating-point precision because this is a planning model, not a return preparation tool. The assumption is configurable in js/05-projections/bracket-projector.js.

## Project Structure

- index.html
- - README.md
  - - css/styles.css
    - - data/taxBrackets.json
      - - js/01-brooklyn/ (brooklyn-data.js, date-utils.js, brooklyn-interpolation.js)
        - - js/02-tax-engine/ (tax-data.js, tax-loader.js, tax-lookups.js, tax-calc-federal.js, tax-calc-state.js, tax-baseline.js)
          - - js/03-solver/ (fees.js, brooklyn-allocator.js)
            - - js/04-ui/ (format-helpers.js, inputs-collector.js, controls.js, projection-render.js)
              - - js/05-projections/ (bracket-projector.js, carryforward-tracker.js, projection-engine.js)
               
                - ## Script Load Order
               
                - Subsystems load in numeric order: 01 then 02 then 03 then 05 then 04. The UI layer loads last because it depends on every primitive, lookup, calculator, and projection routine below it.
               
                - ## Adding a New Year of IRS Data
               
                - When the IRS publishes 2027 brackets, replace the synthetic projection by adding the published 2027 block to data/taxBrackets.json for federal and each state, then update js/05-projections/bracket-projector.js to start its synthetic roll from 2027 instead of 2026.
               
                - ## License
               
                - Proprietary — internal use only.
                - 
