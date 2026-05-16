# Blake Feedback — Complete Issue Map

**Source**: `C:/Users/jacob/Downloads/RETT_Calculator_Feedback_Summary (1).pdf` (Claude-generated structured summary of the 2026-05-15 meeting recording with Blake Schaper).
**Video**: `C:/Users/jacob/Downloads/RETT Calculator Feedback-20260515_103557-Meeting Recording.mp4` — **NOT directly viewed.** No ffmpeg/whisper on this machine to transcribe MP4. Worked from the PDF, which is comprehensive. If anything below feels off, the source video has the nuance.
**Companion Excel** referenced in PDF (`RETT_Calculator_Due_Outs.xlsx`, 53 due-outs, deadline 2026-05-20) — **NOT present in Downloads.** Only the PDF + MP4 were available.

## How this doc is organized

Every issue Blake raised, in PDF order, with:
- **What** Blake said (paraphrased)
- **Where** in the code (file:line)
- **How** to fix it (sketch — no code written yet)
- **Risk** tag (S/M/L) + **Pre/Post-Vegas** tag

Tags:
- 🟢 **PRE-VEGAS** — Blake's minimum bar before booth opens Tuesday 2026-05-19
- 🟡 **POST-VEGAS** — explicitly deferred per PDF
- 🔵 **HOUSEKEEPING** — not code; logistics
- ⚠️ **DECISION** — needs Blake's clarification before action
- **Risk:** S (small / cosmetic, low blast radius), M (medium / multi-file or UI rework), L (large / engine-deep, may move many numbers)

---

# 1. HOUSEKEEPING (not code)

### H1. 🔵 Jacob moves into apartment Monday
Logistics — no action.

### H2. 🔵 Server setup Tuesday
Coordinate with April on physical placement to keep equipment cool. Not in this codebase.

### H3. 🔵 Employment contract from Crystal — expected EOD today
Wait for it.

### H4. 🔵 Job title — propose options
Blake agrees the current title doesn't encompass the role. Jacob to research and propose options that read well to external audiences. Not in this codebase.

### H5. 🔵 Blake is coordinating Upwork resources for video animation
RETT marketing — Blake handles, not Jacob's task.

---

# 2. TAB 1 — CLIENT INPUTS

## 2.A Structural changes (POST-VEGAS)

### 2.A.1. 🟡 Backend database (John's work) — single source of truth
- **Issue:** Lisa pulls up a client and doesn't see what Blake sees because there's no shared backend. Each session re-enters from form data.
- **Code involvement:** when John ships the DB, the front-end will need to **read** from it instead of localStorage. Today the case-storage layer is at [js/04-ui/case-storage.js](js/04-ui/case-storage.js) (saves/loads to localStorage). Future: this file becomes the integration point with John's API.
- **Action now:** Jacob to stay in lockstep with John so front-end work isn't redone every time the API shape shifts. **No code changes pre-Vegas.**
- **Risk:** L (when started). **Tag:** 🟡 POST-VEGAS.

### 2.A.2. 🟡 Move Client Financial Inputs to a "pre-meeting setup" view
- **Issue:** During live meetings, scrolling exposes other clients' financial data on-screen. Move sensitive fields off the meeting-facing view.
- **Where:** the "Income Sources" section currently sits at [index.html:295-330](index.html#L295) — visible inline on Page 1 (Client Inputs). The "sensitive" stuff Blake's worried about is mainly the income inputs (W-2, SE, business, rental, dividend, retirement).
- **Fix sketch:**
  - Add a new section/page (`page-prep` or expand PMQ) where the user fills financial inputs **before** the meeting.
  - On Page 1 (the meeting-facing inputs page), the income section reads computed values from the prep step but doesn't display dollar amounts inline. Show a "Financials loaded ✓" pill instead.
  - Or simpler: add a "Hide financials" toggle on Page 1 that masks values to "$•••".
- **Risk:** M. **Tag:** 🟡 POST-VEGAS.

## 2.B Section renames and field cleanups

### 2.B.1. 🟢 ⚠️ "W-2 / 1040 / 1099" header → just "1040" — Risk: S
- **Issue (verbatim PDF):** *"The header pulling 'W2 1040 1099' should just read 1040 — that's what populates the downstream fields."*
- **Ambiguity:** No literal "W2 1040 1099" string exists in code. Closest candidates (all in the PMQ Tax Doc Import UI):
  - [index.html:150](index.html#L150) — `<p class="pmq-desc">Drop the client's W-2 or 1040 PDF. Gemini reads the document...</p>`
  - [index.html:153](index.html#L153) — `<span class="pmq-drop-label">Drag &amp; drop W-2 or 1040 PDF</span>`
- **Fix sketch:** change both strings to drop the W-2:
  - Line 150 → *"Drop the client's 1040 PDF. Gemini reads the document and pre-fills the income fields below."*
  - Line 153 → *"Drag & drop 1040 PDF"*
- **⚠️ DECISION:** confirm with Blake that these PMQ lines are what he meant. If he meant the "Income Sources" section heading at [index.html:298](index.html#L298), that's a different change.
- **Tag:** 🟢 PRE-VEGAS.

### 2.B.2. 🟢 "Appreciated Asset Sale" → "Real Estate Sale Details" — Risk: S
- **Primary:** [index.html:344](index.html#L344) — `<h2>Appreciated Asset Sale</h2>` (Section 03 heading)
- **Comment update for consistency** (not user-visible):
  - [index.html:199](index.html#L199), [index.html:337](index.html#L337), [js/04-ui/case-storage.js:43](js/04-ui/case-storage.js#L43), [js/04-ui/controls.js:291](js/04-ui/controls.js#L291)
- **Future Asset Sale section heading** [index.html:425](index.html#L425) — `<h2>Future Appreciated Asset Sale</h2>` — if Blake wants the parallel rename, change too. Confirm.
- **Fix sketch:** edit `<h2>` text only. No JS or id changes.
- **Tag:** 🟢 PRE-VEGAS.

### 2.B.3. 🟢 ⚠️ "Expected Sale Price" → "Cost Basis (Original Sale Price)" — Risk: S
- **Issue (verbatim PDF):** *"Update Expected Sale Price to Cost Basis (Original Sale Price)."*
- **Ambiguity:** No field labeled "Expected Sale Price" currently exists. The two relevant fields in Section 03:
  - [index.html:349](index.html#L349) — `<div class="label">Sale Price</div>` (id `sale-price`)
  - [index.html:353](index.html#L353) — `<div class="label">Cost Basis</div>` (id `cost-basis`)
- **Most likely interpretation:** rename the **Cost Basis** label to *"Cost Basis (Original Sale Price)"* — clarifying jargon with the plain-English parenthetical, since the cost basis IS the original purchase price.
- **Alternate interpretation:** Blake may want the "Sale Price" label retitled — but the parenthetical "(Original Sale Price)" makes more sense paired with Cost Basis.
- **Fix sketch:** edit label text at [index.html:353](index.html#L353). Mirror in [index.html:447](index.html#L447) for the Future Asset block if doing parallel rename.
- **⚠️ DECISION:** confirm intent with Blake.
- **Tag:** 🟢 PRE-VEGAS.

### 2.B.4. 🟢 Long-Term Gain box → Yes/No "Was this property held for more than a year?" — Risk: M
- **Issue:** Replace the readonly LT-gain box with a single checkbox. Yes = long-term, No = short-term.
- **Current UI:**
  - [index.html:361-363](index.html#L361) — `<div class="label">Long-Term Gain</div>` + `<input id="computed-gain" readonly>` (auto-computed from sale − basis − depr)
  - [index.html:327-328](index.html#L327) — separate `<input id="short-term-gain">` (independent free-form input)
  - [index.html:487](index.html#L487) — `<input type="hidden" id="long-term-gain" value="0">` (legacy hidden field; some readers still touch it)
- **Behavior change:**
  - When user picks Yes (long-term): the computed `sale − basis − depr` flows into the LT bucket (current default).
  - When user picks No (short-term): the computed gain flows into the **ST bucket** instead. Either re-route into `short-term-gain`, or add a new state flag `cfg.holdingPeriodShort = true` that downstream engines respect.
- **Files that read these gain fields** (where the toggle must propagate):
  - [js/04-ui/baseline-table.js:60-77](js/04-ui/baseline-table.js#L60) — `stGain`, `ltGain` derivation
  - [js/02-tax-engine/tax-comparison.js:400-401](js/02-tax-engine/tax-comparison.js#L400) — `ltGain` derivation in `_belowMinForLifecycle`
  - [js/02-tax-engine/tax-comparison.js:648-649](js/02-tax-engine/tax-comparison.js#L648) — same in `_flatRec`
  - [js/02-tax-engine/engine-self-test.js:97](js/02-tax-engine/engine-self-test.js#L97) — same in scenario builder
  - [js/03-solver/decision-engine.js:84-85](js/03-solver/decision-engine.js#L84) — `longTermGain` derivation
  - [js/04-ui/cashflow-schedule-render.js:71-72, 310-311](js/04-ui/cashflow-schedule-render.js#L71)
  - [js/04-ui/recommendation-render.js:113](js/04-ui/recommendation-render.js#L113)
  - [js/04-ui/projection-dashboard-render.js:1842](js/04-ui/projection-dashboard-render.js#L1842)
  - [js/04-ui/strategy-summary-render.js:1344-1351](js/04-ui/strategy-summary-render.js#L1344)
- **Fix sketch (lightest touch):**
  - Replace the LT-gain readonly row at index.html:361-363 with a yes/no toggle (`#holding-period-yesno`, value="yes" default).
  - On toggle change in `controls.js`: when "no", **mirror the computed gain into `#short-term-gain`** and zero `#long-term-gain`. When "yes", restore the computed value to `#long-term-gain` and let `#short-term-gain` be its own user input.
  - All the engine readers above auto-pick up via existing field IDs — no engine surgery needed.
- **Tag:** 🟢 PRE-VEGAS.

### 2.B.5. 🟡 "Add Another Property" button (multi-property) — Risk: M
- **Issue:** add a button to clone the Real Estate Sale Details block so the same client can model 3+ properties. Confirm downstream math handles aggregation.
- **Where:** Section 03 lives at [index.html:342-374](index.html#L342). Currently a single instance with hardcoded IDs (`sale-price`, `cost-basis`, etc.).
- **Fix sketch:**
  - Convert the block to a template that can be cloned with namespaced IDs (`sale-price-1`, `sale-price-2`, ...).
  - Aggregate at engine boundary: [js/04-ui/inputs-collector.js:108](js/04-ui/inputs-collector.js#L108) currently reads one set of fields; sum across instances before populating `cfg.salePrice`, `cfg.costBasis`, `cfg.acceleratedDepreciation`.
  - Or keep the engine single-property and pre-aggregate in JS: simpler but loses property-level traceability.
  - "Confirm doesn't break downstream math" = run engine self-test with the aggregated config.
- **Tag:** 🟡 POST-VEGAS.
- **Risk:** M (touches inputs-collector, case-storage save/load shape, and every engine reader of the sale fields).

### 2.B.6. 🟢 "Accelerated Depreciation" → "Accelerated Depreciation Recapture" — Risk: S
- **Issue:** rename label + clarify it's ordinary income, taxed in year of sale. (Engine already treats this correctly via §1250; the rename is purely UX.)
- **Visible labels:**
  - [index.html:357](index.html#L357) — main sale block: `<div class="label">Accelerated Depreciation</div>`
  - [index.html:450](index.html#L450) — future asset block: same
- **Screen-reader hint:** [index.html:363](index.html#L363) — `<span id="computed-gain-hint">Calculated as sale price minus cost basis minus accelerated depreciation.</span>` (update for consistency)
- **DO NOT rename the DOM ID `accelerated-depreciation`** or the JS variable `acceleratedDepreciation` — they're referenced in ~30+ places across the engine. Visible label only.
- **Tag:** 🟢 PRE-VEGAS.

## 2.C Sale proceeds / tax treatment

### 2.C.1. 🟢 Remove "Payment on Sale Date" — Risk: S
- **HTML to delete:** [index.html:383-393](index.html#L383) — the comment + entire `<div id="payment-on-sale-date-group" hidden>` block
- **JS to clean up:**
  - [js/04-ui/controls.js:1339-1356](js/04-ui/controls.js#L1339) — the whole orchestration block that auto-shows the field when `#accelerated-depreciation > 0`. Delete.
  - [js/04-ui/controls.js:1437](js/04-ui/controls.js#L1437) — surrounding `futureDeprEl` block may reference it; audit.
  - [js/04-ui/money-format.js:22](js/04-ui/money-format.js#L22), [js/04-ui/money-format.js:44](js/04-ui/money-format.js#L44) — remove `'payment-on-sale-date'` from the format ID list and the cents-precision map.
- **Engine impact:** **none.** Comment at [controls.js:1339-1340](js/04-ui/controls.js#L1339) explicitly says *"Not currently read by the engine — UI scaffold for the first-payment-on-sale-date concept the advisor will wire in once the rules are finalized."* Safe to delete.
- **Tag:** 🟢 PRE-VEGAS.

### 2.C.2. 🟢 Reword "Will the client be investing everything?" + invert logic — Risk: S
- **Current:** [index.html:395-399](index.html#L395)
  ```html
  <div class="label">Will the client be investing everything?</div>
  <select id="withhold-yes-no" class="yes-no">
    <option value="no" selected>Yes</option>
    <option value="yes">No</option>
  </select>
  ```
  (Note the long-standing quirk: value="no" displays as "Yes".)
- **Blake's new wording:** *"Will the client require any portion of the sale proceeds at closing or shortly thereafter?"*
- **Logic INVERTS:**
  - Old: Yes = investing all → hide amount-to-keep
  - New: Yes = requires proceeds → SHOW input; No = invests all → HIDE input
- **Fix sketch:**
  - Update label text at [index.html:395](index.html#L395)
  - Fix the `value` ↔ display-text mapping so value="yes" reads "Yes" and value="no" reads "No"
  - Update the show/hide listener in [js/04-ui/controls.js:1338-1640](js/04-ui/controls.js#L1338): when value === "yes", show `#withhold-amount-group`; else hide. (Inverted from today.)
  - Update the available-capital derivation at [controls.js:1645-1654](js/04-ui/controls.js#L1645) to match the new semantic.
- **Tag:** 🟢 PRE-VEGAS.

### 2.C.3. 🟢/🟡 "Amount to Keep" → "Cover the Tax Bill from Sale Proceeds" + math wiring — Risk: M
- **Two parts:** label/default flip (small, pre-Vegas) AND math wiring (medium, possibly post-Vegas).
- **Current state — two fields exist:**
  - [index.html:401-404](index.html#L401) — `<div class="label">Amount to keep</div>` + free-form `#withhold-amount`
  - [index.html:407-411](index.html#L407) — `<div class="label">Cover the tax bill from the sale?</div>` + Yes/No `#cover-taxes-yes-no` (currently defaults **No**)

#### 2.C.3.a 🟢 Label rename + default flip — Risk: S
- Rename "Cover the tax bill from the sale?" → "Cover the Tax Bill from Sale Proceeds"
- Default Yes (currently `value="no" selected` at [index.html:409](index.html#L409) → change to `value="yes" selected`).
- Consider hiding/removing the separate "Amount to keep" row at lines 401-404 since the new toggle consolidates the concept. **Confirm with Blake.**

#### 2.C.3.b 🟡 Math wiring (new logic) — Risk: M
- When toggle = Yes:
  - (a) compute **additional tax** due on 4/15 of each year specifically **from the sale**
  - (b) reduce the **Brooklyn bucket** by that amount on **4/1 of each year**
- Assume **70% of proceeds are taxable** for the calc; expose as **editable**.
- **Where to wire:**
  - Add new field `#cover-taxes-pct-taxable` (default 70, editable) somewhere in Section 04.
  - [js/04-ui/inputs-collector.js:108](js/04-ui/inputs-collector.js#L108) — pass through to cfg: `cfg.coverTaxes`, `cfg.coverTaxesPctTaxable`.
  - **Engine-side new logic** in projection year-loop: each year, compute the additional-tax-from-sale (a per-year delta versus do-nothing) and subtract from Brooklyn's deployable bucket. Lives in [js/05-projections/projection-engine.js](js/05-projections/projection-engine.js) or [js/01-brooklyn/time-weight.js](js/01-brooklyn/time-weight.js).
  - Date anchors: 4/15 for tax due, 4/1 for Brooklyn reduction — use [js/01-brooklyn/date-utils.js](js/01-brooklyn/date-utils.js) for the fractional-year math.
- **Tag:** 🟡 POST-VEGAS (math wiring) — but discuss with user; PDF doesn't explicitly assign Vegas priority to the math.

## 2.D Future Appreciated Asset Sale section (POST-VEGAS)

### 2.D.1. 🟡 Simplify to "Additional Loss Needed by [date]" — Risk: M
- **Issue:** the lead with 9 properties can't list every one. Replace property-by-property listing with a single "additional loss needed" input. Calculator treats that as additional gain to offset. Use case is broader than real estate (stock sales, concentrated positions).
- **Where:** the entire Section 05 at [index.html:416-459](index.html#L416) — current implementation asks for full future-asset details (sale date, sale price, cost basis, accel dep, computed LT gain).
- **Fix sketch:**
  - Replace the inner fields (lines 437-456) with a single `<input id="additional-loss-needed">` (currency) + `<input id="additional-loss-needed-date" type="date">`.
  - Keep the Yes/No toggle (`#future-sale-yes-no`) at lines 430-434 as the gate.
  - **Engine impact:** [js/04-ui/inputs-collector.js:146-163](js/04-ui/inputs-collector.js#L146) currently builds a "future sale" struct from sale-price/basis/depr. Replace with `{ additionalLossNeeded, byDate }` and update the optimizer's carryforward steering at [js/03-solver/master-solver.js:481-502](js/03-solver/master-solver.js#L481) to read the new shape.
- **Tag:** 🟡 POST-VEGAS.

## 2.E Reference date

### 2.E.1. 🟢 Audit: every Brooklyn calc references Strategy Implementation Date, not sale date — Risk: M (audit only; fixes would be M+)
- **Issue:** Blake wants Brooklyn-related math anchored to `#strategy-implementation-date`, NOT `#implementation-date` (the sale date).
- **Field locations:**
  - [index.html:367](index.html#L367) — `#implementation-date` (Sale / Closing Date)
  - [index.html:371](index.html#L371) — `#strategy-implementation-date` (Strategy Implementation Date)
- **Files that read these dates** (16 hits — audit each):
  - `js/04-ui/controls.js`, `js/04-ui/strategy-summary-render.js`, `js/04-ui/projection-dashboard-render.js`, `js/04-ui/inputs-collector.js`, `js/04-ui/case-storage.js`, `js/04-ui/recommendation-render.js`, `js/04-ui/input-validation.js`, `js/04-ui/cashflow-schedule-render.js`
  - `js/02-tax-engine/engine-self-test.js`, `js/02-tax-engine/tax-comparison.js`
  - `js/03-solver/structured-sale.js`, `js/03-solver/decision-engine.js`
  - `js/05-projections/projection-engine.js`
  - `js/01-brooklyn/time-weight.js`
  - `js/00-data/schwab-strategies.js`, `js/03-solver/brookhaven-fees.js`
- **Pattern to look for:** prefer `cfg.strategyImplementationDate`; fall back to `cfg.implementationDate` only if explicit. Reference example: [projection-dashboard-render.js:517](js/04-ui/projection-dashboard-render.js#L517) — `cfgStrategyDate(cfg) || (cfg.strategyImplementationDate || cfg.implementationDate)`.
- **Action:** walk each file, flag every place that anchors to sale date when it should be strategy date. **Audit pre-Vegas, fix fixes post-Vegas** unless they're obvious 1-liners.
- **Tag:** 🟢 PRE-VEGAS (audit). Fixes likely 🟡.

---

# 3. TAB 2 — TAX BASELINE

### 3.A.1. 🟢 Show delta (with sale vs without), not total tax — Risk: M
- **Page anchor:** [index.html:500-549](index.html#L500) — `<section id="page-baseline">`
- **Current heading:** [index.html:513](index.html#L513) — `<h2>Total Tax If You Did Nothing</h2>`
- **Current footer total:** [index.html:536](index.html#L536) — `<tr class="total"><td>Total Tax If You Did Nothing</td><td id="bt-tot">$0</td></tr>`
- **Render owner:** [js/04-ui/baseline-table.js — render() at line 41](js/04-ui/baseline-table.js#L41)
- **Blake's spec:**
  - Run two scenarios internally: tax **with** sale + tax **without** sale
  - Headline = **delta** (additional tax caused by the sale)
  - Short breakdown of delta: depreciation recapture, capital gain, NIIT, state tax
  - **Hide** the full tax-bill table
  - Lisa to confirm two-scenario math
- **Fix sketch:**
  1. In `baseline-table.js`'s `render()` (lines 41-200ish), after computing the existing "with sale" scenario, also compute a "without sale" scenario by zeroing `salePrice`, `costBasis`, `acceleratedDepreciation`, and any future-sale fields. Same filing status / state / income.
  2. delta = total_with − total_without. Same for each row (recap, LT cap gain, NIIT, state).
  3. Restructure HTML:
     - Headline cell: "Additional Tax Due to the Sale" + delta value (replace #bt-tot semantics)
     - Show only delta rows: depreciation recapture, LT cap gain, NIIT, state tax
     - Hide ordinary-income, AMT, SE-tax, total-taxable rows
  4. Confirm: delta-line-items sum to headline delta.
- **PRE-VEGAS minimum:** even if the full table still shows, the **headline number must be the delta** (per PDF: *"Even if the full UI rework isn't done, the headline number must be the additional tax due to the sale."*)
- **Tag:** 🟢 PRE-VEGAS.

---

# 4. TAB 3 — STRATEGIES

## 4.A Visual and naming

### 4.A.1. 🟡 Recolor orange → light Brookhaven blue — Risk: M
- **Issue:** PDF: *"Recolor from orange to a light Brookhaven blue (after Vegas is fine). Lock down the standard Brookhaven palette so it's consistent across the tool."*
- **Orange hex** used in code: `#f29c2c` — found in `css/styles.css` (12+ references). Key locations:
  - [css/styles.css:34-36](css/styles.css#L34) — `--step-circle-orange` declaration (the booth orange)
  - [css/styles.css:2013](css/styles.css#L2013) — "live in orange filled circles to match the booth visual"
  - [css/styles.css:3640-3641, 3690, 3904](css/styles.css#L3640) — strategy-card border / Interested button / popping orange
  - [css/styles.css:4371](css/styles.css#L4371) — "tax still owed" pie slice
  - [css/styles.css:5995, 6034, 6152](css/styles.css#L5995) — print template
- **Fix sketch:**
  - Step 1: define `--brookhaven-blue-light` and `--brookhaven-blue` CSS variables at the top of `styles.css`
  - Step 2: replace every `#f29c2c` usage with the appropriate Brookhaven-blue variable (use Find&Replace, then visually QA)
  - Step 3: Blake to provide the exact Brookhaven hex values (and confirm what "light blue" means — probably a specific brand spec)
- **⚠️ DECISION:** Get exact Brookhaven palette hex codes from Blake.
- **Tag:** 🟡 POST-VEGAS. **PDF explicitly says "after Vegas is fine."**

### 4.A.2. 🟡 Lock down Brookhaven palette across the tool — Risk: S
- Once 4.A.1 is done, audit every hex color in styles.css and ensure they all derive from a palette token. No raw hex outside the palette block.
- **Tag:** 🟡 POST-VEGAS.

### 4.A.3. 🟢 ⚠️ Drop "Seller Finance" label (per Greg) — Risk: S (once name decided)
- PDF: *"It's really a purposeful delay of receipt of proceeds — use ChatGPT/Claude to land on better terminology."*
- **Visible label:** [index.html:617](index.html#L617) — `<h3 class="strategy-pick-name">Seller Finance</h3>`
- **JS render references:**
  - [js/04-ui/strategy-summary-render.js:49, 481](js/04-ui/strategy-summary-render.js#L49) — `'Seller Finance'` for type B
  - [js/04-ui/temp-page-render.js:215](js/04-ui/temp-page-render.js#L215) — same
  - [js/04-ui/projection-dashboard-render.js:2224](js/04-ui/projection-dashboard-render.js#L2224) — same in scenario entries
- **Engine code comments** that mention "Seller Finance" (rename for clarity, not functionally required):
  - [js/02-tax-engine/tax-comparison.js:37](js/02-tax-engine/tax-comparison.js#L37)
  - [js/04-ui/controls.js:414](js/04-ui/controls.js#L414)
  - [js/04-ui/projection-dashboard-render.js:772, 792, 939, 972, 2196](js/04-ui/projection-dashboard-render.js#L772)
- **Replacement candidates** (for Blake/Greg to pick):
  - "Delayed Close" / "January 1 Close"
  - "Year-End Crossing"
  - "Deferred Receipt"
- **⚠️ DECISION:** need Blake's chosen replacement.
- **Tag:** 🟢 PRE-VEGAS (per Vegas Priorities: *"Strategy naming. Drop 'Seller Finance' and 'Sell Now' terminology before the booth opens."*)

### 4.A.4. 🟢 Strategy 1: "Sell Now" → "Full Receipt of Proceeds at Sale" / "Cash in Hand" — Risk: S
- **Visible label:** [index.html:572](index.html#L572) — `<h3 class="strategy-pick-name">Sell Now</h3>`
- **JS render references (same files as 4.A.3):**
  - [js/04-ui/strategy-summary-render.js:48, 480](js/04-ui/strategy-summary-render.js#L48)
  - [js/04-ui/temp-page-render.js:214](js/04-ui/temp-page-render.js#L214)
  - [js/04-ui/projection-dashboard-render.js:2223, 602](js/04-ui/projection-dashboard-render.js#L2223)
- **Suggestion:** card body already shows "Cash In Hand" at [index.html:575](index.html#L575). Simplest: rename header to match → "Cash in Hand" everywhere. **Confirm with Blake.**
- **Tag:** 🟢 PRE-VEGAS.

### 4.A.5. 🟢 Strategy 2: "Installment Sale" — Risk: S
- After 4.A.3 picks a replacement for "Seller Finance," Blake's spec is the result should land on plain *"Installment Sale"* for Strategy 2.
- Same locations as 4.A.3.
- **Tag:** 🟢 PRE-VEGAS.

### 4.A.6. 🟢 Strategy 3: "Installment Sale — Mitigating Buyer Default Risk" — Risk: S
- **Visible label:** [index.html:655](index.html#L655) — `<h3 class="strategy-pick-name">Structured Sale</h3>`
- **JS render references:**
  - [js/04-ui/projection-dashboard-render.js:2225](js/04-ui/projection-dashboard-render.js#L2225) — `name: 'Structured Sale'`
  - [js/04-ui/strategy-summary-render.js](js/04-ui/strategy-summary-render.js) — also has the C→"Structured" mapping
  - [js/04-ui/temp-page-render.js](js/04-ui/temp-page-render.js) — same
- **Fix:** replace `'Structured Sale'` → `'Installment Sale — Mitigating Buyer Default Risk'`. Watch UI overflow — this title is long.
- **Tag:** 🟢 PRE-VEGAS.

### 4.A.7. 🟢 Use "distribution period", never "lockup" — Risk: S
- **Visible text strings to change:**
  - [index.html:672](index.html#L672) — `<span ... data-lockup-display="C">18 Month Lockup</span>` → "18 Month Distribution Period"
  - [js/04-ui/controls.js:468](js/04-ui/controls.js#L468) — `cEl.textContent = (pickedMonths ? pickedMonths : 18) + ' Month Lockup';` → ' Month Distribution Period' (and default 18→36 per 4.A.8)
  - [js/04-ui/projection-dashboard-render.js:2074](js/04-ui/projection-dashboard-render.js#L2074) — `<span ...>Lockup</span>` → "Distribution Period"
  - [js/04-ui/cashflow-schedule-render.js:228, 315](js/04-ui/cashflow-schedule-render.js#L228) — narrative copy *"no structured-sale lockup"* → *"no structured-sale distribution period"*
  - [js/04-ui/narrative-render.js:252-253](js/04-ui/narrative-render.js#L252) — same narrative copy
- **DO NOT rename CSS classes (`.strategy-lockup-*`, `.rett-interested-lockup`) or `data-lockup-*` attributes.** They're internal contracts; visible text only.
- **Code comments using "lockup":** [css/styles.css:1122, 3608, 3723, 3784, 3828, 3853, 4168](css/styles.css#L1122) — update for clarity, optional.
- **Tag:** 🟢 PRE-VEGAS.

### 4.A.8. 🟢 Default distribution period to 36 months — Risk: S
- Current defaults are inconsistent:
  - [js/04-ui/controls.js:468](js/04-ui/controls.js#L468) — fallback `18` → **change to `36`**
  - [js/04-ui/projection-dashboard-render.js:829](js/04-ui/projection-dashboard-render.js#L829) — `userDuration || 18` → `userDuration || 36`
  - [js/04-ui/projection-dashboard-render.js:548, 968, 1041](js/04-ui/projection-dashboard-render.js#L548) — already use `|| 36` ✓
  - [index.html:469](index.html#L469) — `<input id="structured-sale-duration-months" value="">` → set `value="36"`
- **Tag:** 🟢 PRE-VEGAS.

## 4.B Conditional display logic (POST-VEGAS)

PDF: *"The Strategies tab should be conditionally populated based on internal math run before the user lands on it."*

### 4.B.1. 🟡 If S1 offsets all gain → show only S1 — Risk: M
### 4.B.2. 🟡 If S1 doesn't but S2 does → show S1 + S2 — Risk: M
### 4.B.3. 🟡 If neither → show all three (default) — Risk: M
### 4.B.4. 🟡 Default-risk question only when S3 is viable alt (S3 savings ≥ S2) — Risk: M
### 4.B.5. 🟡 If S3 reduces tax efficiency vs S2, don't show even if buyer has default risk — Risk: M

- **Where the cards live:** [index.html:565-682](index.html#L565) — `<div id="strategy-pick-list">` with three hardcoded cards (`strategy-pick-A`, `-B`, `-C`).
- **Where the engine math runs:** [js/04-ui/projection-dashboard-render.js:2186-2226](js/04-ui/projection-dashboard-render.js#L2186) — `pickedA/B/C` and `mA/mB/mC` already compute per-strategy metrics. We have the math; we just don't conditionally hide cards on Page-Strategies based on it.
- **Fix sketch:**
  - Run `_bestPickedCfgLocal('A')`, `'B'`, `'C'` BEFORE Page-Strategies renders.
  - Compute `lossA`, `lossB`, `lossC` (Brooklyn losses) and compare to `totalGain` (LT + recapture).
  - Hide cards per Blake's rules: data attributes / inline `display:none` on `#strategy-pick-A/B/C`.
  - Move the actual computation to a small helper function in `controls.js` triggered on `showPage('page-strategies')`.
- **Blake's note:** *"All of this depends on the Projections tab math being correct — once it is, the Strategies tab logic becomes straightforward conditional rendering."* So fix 5.x (Tab 4 math) **before** doing this.
- **Tag:** 🟡 POST-VEGAS.

## 4.C Strategy 3 modeling (POST-VEGAS)

### 4.C.1. 🟡 Use 40 / 40 / 20 distribution across 3 years for now — Risk: M
- **Issue:** PDF: *"Use a 40% / 40% / 20% distribution across three years for now (make it adjustable later)."*
- **Current behavior:** [js/03-solver/structured-sale.js:209-255](js/03-solver/structured-sale.js#L209) — `_scoreSchedule` accepts `gainByYear` and `lossByYear` as arrays. The 40/40/20 reference appears in [js/02-tax-engine/tax-comparison.js:17](js/02-tax-engine/tax-comparison.js#L17) — *"canonical: 40/40/20 split"* — so the **schedule is already 40/40/20 by convention**, but the optimizer searches across multiple schedules.
- **Fix sketch:**
  - Pin the 3-year distribution to `[0.40, 0.40, 0.20]` for Strategy 3.
  - The optimizer currently picks the best schedule; Blake wants a fixed default.
  - Make adjustable via a new field (post-post-Vegas).
- **Tag:** 🟡 POST-VEGAS.

### 4.C.2. 🟡 Edge case: 40% of sale doesn't reach deployable threshold — Risk: M
- **Issue:** for $1M cap gain, 40% = $400K — below Brooklyn's $1M min deployable. S3 actually loses efficiency vs S2 in this scenario.
- **Where minimum lives:** [js/00-data/custodians.js:38, 48, 85](js/00-data/custodians.js#L38) — `minInvestment` per custodian per strategy
- **Where it's read:** [js/02-tax-engine/tax-comparison.js:396](js/02-tax-engine/tax-comparison.js#L396) — `_belowMinForLifecycle` already checks this
- **Fix sketch:** in the conditional-display logic (4.B.4/4.B.5), when computing whether S3 is viable, explicitly check if the Y1 deployable share would clear the minimum. If not, classify S3 as non-viable for this case.
- **Tag:** 🟡 POST-VEGAS.

### 4.C.3. 🟡 All of this depends on Tab 4 math correct
- See 5.x. PDF: *"All of this depends on the Projections tab math being correct."*

---

# 5. TAB 4 — PROJECTIONS (the biggest concern)

### 5.A.1. 🟢 Sell Now beating Seller Finance is wrong — Risk: L (most concerning)
- **Issue (verbatim PDF):** *"With $10M in sale price and $4.25M of long-term gain, the tab is showing Sell Now beating Seller Finance — that should not be possible."*
- **Back-of-napkin Blake expects:**
  - Strategy 1 (Sell Now, mid-year, ~30% efficiency on $10M) → ~$3M capital loss → offsets ~$3M of $4.25M gain (partial)
  - Strategy 2 (Seller Finance / Jan 1, full $10M deployed full Y1 at ~59% efficiency) → ~$5.9M capital loss → wipes gain
  - **Strategy 2 should win by a lot.** Tool shows opposite.
- **PDF says:** *"One of the two figures shown is wrong. Verify both, and confirm Strategy 1 is not offsetting depreciation recapture (that piece needs to come out of the Brooklyn bucket separately)."*

#### 5.A.1.a 🟢 Verify A and B baselines match — Risk: S (investigation only)
- **Code path:** [js/04-ui/projection-dashboard-render.js:457-545](js/04-ui/projection-dashboard-render.js#L457) — `_scenarioMetrics(cfg)`
- The **deferred** branch (B) reads `r.doNothingBaseline.total` with fallback to `r.baseline.total` ([line 478-479](js/04-ui/projection-dashboard-render.js#L478))
- The **immediate** branch (A) reads `r.baseline.total` only ([line 501](js/04-ui/projection-dashboard-render.js#L501))
- Comment claims they should equal — **verify with the $10M/$4.25M scenario.** Log both. If they differ, the comparison is unfair before any loss applies.

#### 5.A.1.b 🟢 Verify the loss generation per strategy
- Run engine on $10M / $4.25M with Strategy A picked → expect ~$3M loss.
- Run engine on same scenario with Strategy B picked → expect ~$5.9M loss.
- If those don't match the back-of-napkin, the bug is in the structured-sale optimizer / leverage-tier interpolation, not the recapture path.
- Files to scrutinize:
  - [js/01-brooklyn/variable-leverage.js](js/01-brooklyn/variable-leverage.js) — leverage-to-lossRate curve
  - [js/01-brooklyn/time-weight.js](js/01-brooklyn/time-weight.js) — mid-year scaling (Strategy A's "30% efficiency at mid-year")
  - [js/03-solver/single-year-solver.js](js/03-solver/single-year-solver.js), [js/03-solver/multi-year-solver.js](js/03-solver/multi-year-solver.js)

#### 5.A.1.c 🟢 ⚠️ Strategy 1 offsetting depreciation recapture (Blake says: should NOT) — Risk: L
- **Engine code:** [js/02-tax-engine/tax-comparison.js:340-345](js/02-tax-engine/tax-comparison.js#L340)
  ```js
  // Step 2: §1250 unrecaptured gain (recapture). Still a capital gain
  // for §1211 netting purposes, just rate-capped at 25% downstream.
  if (loss > 0) {
    const offsetRecap = Math.min(out.depreciationRecapture || 0, loss);
    out.depreciationRecapture -= offsetRecap;
    out.investmentIncome = Math.max(0, out.investmentIncome - offsetRecap);
    loss -= offsetRecap;
  }
  ```
- Current engine **absorbs recapture with Brooklyn ST losses** per IRC §1(h) ordering interpretation (comment at [strategy-summary-render.js:1345-1346](js/04-ui/strategy-summary-render.js#L1345): *"Brooklyn ST losses absorb recapture per IRC §1(h) (ST losses → recapture → LT gain → ordinary cap order)"*).
- **Blake disagrees** — wants recapture treated as ordinary income, not offsettable by Brooklyn losses.
- **Fix sketch:**
  - In `tax-comparison.js:340-345`, **skip the recapture-offset step entirely** (or gate behind a config flag). Recapture flows to tax at full §1250 25% cap, separate from the Brooklyn loss bucket.
  - **Downstream impacts to update:**
    - [js/03-solver/structured-sale.js:340-348](js/03-solver/structured-sale.js#L340) — `_y1WantedLoss = lossPerYear[0] + recapture` would need to drop the `+ recapture` term so optimizer doesn't oversize Y1 capacity for recapture it won't absorb.
    - [js/03-solver/structured-sale.js:209-255](js/03-solver/structured-sale.js#L209) — `_scoreSchedule` recaptureY1 plumbing
    - [js/04-ui/strategy-summary-render.js:790-810, 1344-1351](js/04-ui/strategy-summary-render.js#L790) — UI copy that describes recapture as Brooklyn-loss-absorbable
    - [js/04-ui/temp-page-render.js:555-566](js/04-ui/temp-page-render.js#L555) — "Loss applied to §1250 recapture" display logic
    - [js/04-ui/baseline-table.js:91-93](js/04-ui/baseline-table.js#L91) — NIIT base computation includes recap; verify still correct
    - [js/02-tax-engine/engine-self-test.js](js/02-tax-engine/engine-self-test.js) — `imm_CA_recap` test case at line 57 needs re-baselining
  - **Self-test rebaking:** 307/307 currently pass under existing interpretation. Expect significant re-baselining after change.
- **⚠️ DECISION:** This change inverts an IRC interpretation baked deep into the engine. Confirm with Blake he understands the scope. If yes, single highest-impact fix for Strategy 1 vs 2 reconciliation.
- **Tag:** 🟢 PRE-VEGAS per Vegas Priorities (Projections math correct). But test the lighter fixes (5.A.1.a, 5.A.1.b) first — they may resolve the issue without 5.A.1.c.

### 5.A.2. 🟢 ⚠️ "60/60 seller-finance percentage display" — Risk: S (once identified)
- **Issue (verbatim PDF):** *"The 60/60 seller-finance percentage display also needs clarification and likely a layout tweak."*
- **Ambiguity:** literal "60/60" doesn't appear in code. Candidates:
  - [index.html:790](index.html#L790) — `<output id="custom-tier-readout">200/100</output>` (hidden leverage tier readout)
  - [index.html:791](index.html#L791) — `<output id="custom-fee-readout">59.0% / 1.96%</output>` (hidden fee readout)
  - [js/04-ui/projection-dashboard-render.js:1104-1106](js/04-ui/projection-dashboard-render.js#L1104) — strategy-comparison-row config display:
    ```js
    if (type === 'A') return hor + ' / ' + lev;     // e.g. "1 / 200%"
    if (type === 'B') return hor + ' / ' + lev;     // same
    if (type === 'C') return st.durationMonths + ' months / ' + hor + ' / ' + lev + ' / Y' + ...
    ```
- **Most likely:** the comparison-row display for B at line 1105 renders `horizon / leverage` as a confusing slash. Blake's "60/60" is probably his approximation of two numbers separated by a slash.
- **Fix sketch (once confirmed):** rewrite the format string to use a label, e.g. `'Horizon ' + hor + 'y · Leverage ' + lev` or stack on two lines.
- **⚠️ DECISION:** ask Blake to screenshot the exact display.
- **Tag:** 🟢 PRE-VEGAS.

### 5.A.3. 🟢 Hold off on supplemental strategies until 1-4 math is correct
- **No code change.** Discipline rule.
- DO NOT touch:
  - [js/03-solver/calc-supplemental-extra.js](js/03-solver/calc-supplemental-extra.js)
  - [js/03-solver/calc-delphi.js](js/03-solver/calc-delphi.js)
  - [js/03-solver/calc-oil-gas.js](js/03-solver/calc-oil-gas.js)
  - [js/04-ui/supplemental-render.js](js/04-ui/supplemental-render.js)
  - [js/04-ui/supplemental-extra-render.js](js/04-ui/supplemental-extra-render.js)
- **Tag:** 🟢 PRE-VEGAS (discipline only).

---

# 6. SUMMARY — Vegas Minimum Bar (from PDF)

PDF explicitly: *"The minimum bar before Vegas:"*

| # | Item | Risk | Doc § |
|---|------|------|------|
| 1 | **Projections math correct** | L | 5.A.1 |
| 2 | **Tax Baseline shows delta, not total** | M | 3.A.1 |
| 3 | **Client Inputs accurate** (renames, remove Payment on Sale Date, conditional sale-proceeds) | S-M | 2.B + 2.C |
| 4 | **Strategy naming** (drop "Seller Finance" + "Sell Now") | S | 4.A.3-4.A.6 |

Everything tagged 🟡 in this doc is **explicitly post-Vegas** per the PDF and should not be touched until after Tuesday.

---

# 7. RECOMMENDED EXECUTION ORDER (when user is back)

Starting easiest → hardest, items needing decisions first:

### Phase 0 — Get Blake's clarifications (10 min phone call)
- **2.B.1** Which "W2 1040 1099" header exactly?
- **2.B.3** Cost Basis label rename — is that what he meant?
- **2.B.4** UX for LT/ST yes/no toggle when "No": flow into ST field, or new flag?
- **4.A.3** New name for "Seller Finance" (Blake/Greg to decide)
- **4.A.4** "Sell Now" → "Cash in Hand" OK?
- **4.A.1** Exact Brookhaven palette hex codes (post-Vegas)
- **5.A.1.c** Confirm intent on recapture engine change (engine-deep)
- **5.A.2** Screenshot the "60/60" display
- **2.C.3.b** Math wiring pre-Vegas or post?

### Phase 1 — Pre-Vegas quick wins (1-2 hrs)
1. **4.A.7** Lockup → Distribution Period (5 strings)
2. **4.A.8** Default 36 months (4 file edits)
3. **2.B.2** "Appreciated Asset Sale" → "Real Estate Sale Details"
4. **2.B.6** "Accelerated Depreciation" → "Accelerated Depreciation Recapture"
5. **2.C.1** Remove "Payment on Sale Date" (HTML + 3 JS files)
6. **2.B.3** Cost Basis label (after Blake confirms)
7. **2.B.1** PMQ 1040 line (after Blake confirms)
8. **4.A.4, 4.A.5, 4.A.6** Strategy renames (after Blake confirms names)

### Phase 2 — Pre-Vegas medium (3-5 hrs)
9. **2.C.2** Reword "investing everything" + invert show/hide logic
10. **2.C.3.a** Default Cover-Tax-Bill to Yes (label rename)
11. **2.B.4** LT/ST yes/no toggle (UI swap + 1 listener)
12. **3.A.1** Tax Baseline delta (minimum: headline number; full UI rework if time)
13. **2.E.1** Reference-date audit (no fixes yet)
14. **5.A.2** "60/60" display fix (after Blake's screenshot)

### Phase 3 — Pre-Vegas heavy (4-6 hrs + risk of re-baking self-test)
15. **5.A.1.a** Investigate A/B baseline parity ($10M/$4.25M scenario)
16. **5.A.1.b** Investigate loss generation per strategy
17. **5.A.1.c** (if 15-16 don't resolve) Recapture engine change — **only after Blake green-lights the scope**

### Phase 4 — POST-VEGAS (do NOT start before Tuesday)
- 2.A.1, 2.A.2, 2.B.5, 2.C.3.b, 2.D.1, 4.A.1, 4.A.2, 4.B.*, 4.C.*

---

# 8. FILES MODIFIED PRE-VEGAS — Cache-buster note

Per memory `rett-session-handoff.md`: every JS/CSS asset is loaded with `?v=NNN`. Currently at **v=1777600000295**. Bump on every code push:

```powershell
# 54 occurrences in index.html
```

Don't forget. Hard refresh required to invalidate stale caches.

---

# 9. Files Touched in This Analysis (Recap)

Discovery only — no edits yet:
- `index.html` (1032 lines) — heavily mapped
- `css/styles.css` — orange palette located
- `js/04-ui/*` — most UI render files
- `js/02-tax-engine/tax-comparison.js` — recapture offset path located
- `js/03-solver/structured-sale.js` — Y1 recapture absorption located
- `js/03-solver/master-solver.js` — recapture references
- `js/04-ui/baseline-table.js` — full read

---

*End of map. Ready to fix when you are — ask which to start.*
