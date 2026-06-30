---
name: SalesLens
description: Private POS analytics dashboard for fast retail account analysis.
colors:
  app-bg: "#f4f3f0"
  surface: "#ffffff"
  surface-muted: "#f8f7f4"
  nav-active: "#f3f2ee"
  text: "#141413"
  text-soft: "#5f5b53"
  text-faint: "#858178"
  ink: "#15120f"
  clay: "#a96f4a"
  steel: "#6f8795"
  steel-dark: "#4f6878"
  rebel-blue: "#8ecae6"
  rebel-blue-dark: "#5caed4"
  volshop-orange: "#ff8200"
  chart-prior: "#a8a39b"
  positive: "#23834b"
  negative: "#c62828"
  on-ink: "#fffefa"
  danger-surface: "#fff6f3"
  danger-bg: "#8f2f25"
  hero-positive: "#9dd6b4"
  hero-negative: "#ffb4a9"
typography:
  display:
    fontFamily: "Montserrat, Inter, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    fontSize: "clamp(2.9rem, 5.2vw, 5.4rem)"
    fontWeight: 860
    lineHeight: 0.9
    letterSpacing: "0"
  headline:
    fontFamily: "Montserrat, Inter, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    fontSize: "clamp(1.9rem, 3vw, 3.2rem)"
    fontWeight: 860
    lineHeight: 1.04
    letterSpacing: "0"
  title:
    fontFamily: "Inter, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    fontSize: "1.08rem"
    fontWeight: 850
    lineHeight: 1.1
    letterSpacing: "0"
  body:
    fontFamily: "Inter, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.55
  label:
    fontFamily: "Inter, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    fontSize: "0.62rem"
    fontWeight: 850
    lineHeight: 1
    letterSpacing: "0.08em"
rounded:
  xs: "2px"
  sm: "8px"
  soft: "10px"
  md: "12px"
  product: "14px"
  lg: "18px"
  pill: "999px"
spacing:
  xs: "0.42rem"
  sm: "0.65rem"
  md: "1rem"
  lg: "1.35rem"
  xl: "1.85rem"
interaction:
  touchTarget: "44px"
components:
  button-primary:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.surface}"
    rounded: "{rounded.md}"
    padding: "0 0.85rem"
    height: "42px"
  button-toolbar:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.pill}"
    padding: "0 0.82rem"
    height: "34px"
  card-standard:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    rounded: "{rounded.lg}"
    padding: "1rem"
  input-standard:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    rounded: "{rounded.md}"
    padding: "0 0.75rem"
    height: "42px"
---

# Design System: SalesLens

## 1. Overview

**Creative North Star: "The Operator's Scoreboard"**

SalesLens is a working dashboard for retail POS analysis, so the design system serves speed, trust, and repeat scanning before decoration. The current active web layer is a flat, light dashboard: warm gray application canvas, white cards, dark ink navigation, compact controls, and large scorecard typography that makes the important comparison impossible to miss.

The mood is fun to view, minimal, and efficient. Fun comes from merchandise imagery, sharp ranking badges, compact scorecards, and account-specific accents; it does not come from gratuitous animation or ornamental panels. Minimal means each section has a clear purpose and uses whitespace, grouping, and hierarchy to reduce cognitive load. Efficient means controls stay close to the reports they affect, and dense POS data stays organized rather than hidden.

This system rejects complexity for its own sake: overloaded dashboards, dense control clusters, repeated card grids, generic SaaS dashboard tropes, decorative gradients, bloated hero metrics, and visual flourishes that slow analysis. The older macOS app is historical workflow context only; the active design source of truth is the web dashboard.

**Key Characteristics:**
- Flat app shell with a warm gray canvas (`#f4f3f0`) and white analytic surfaces.
- Dark ink top navigation (`#15120f`) with pill controls for account, period, upload, and sign-out actions.
- Large, confident scorecard type for comparisons, backed by compact cards for secondary signals.
- Account accents that change chart and emphasis color without changing the whole interface.
- Product imagery, rank badges, and inventory gauges as the main sources of visual energy.

## 2. Colors

The palette is restrained and operational: warm neutral surfaces do most of the work, dark ink anchors navigation and primary actions, and account colors provide limited, meaningful emphasis.

### Primary
- **Operator Ink** (`#15120f`): primary navigation, primary actions, active filter controls, rank badges, and the strongest text moments. Use it when the interface needs certainty.
- **Scorecard Clay** (`#a96f4a`): default large dashboard headline accent and negative or warm emphasis in legacy report contexts. Use sparingly; it should not flood routine controls.

### Secondary
- **Muted Steel** (`#6f8795`): default current-series chart color, selected account accents, and positive dashboard emphasis where the account has no custom theme.
- **Deep Steel** (`#4f6878`): stronger steel accent for primary buttons and emphasis text when steel needs more contrast.
- **Rebel Blue** (`#8ecae6`): Rebel Rags account accent and current-series chart color for that account.
- **Volshop Orange** (`#ff8200`): Volshop account accent and current-series chart color for that account.

### Tertiary
- **Prior-Year Stone** (`#a8a39b`): prior-year chart series and comparison context. This color is intentionally quieter than current-series accents.
- **Positive Green** (`#23834b`): positive deltas only.
- **Negative Red** (`#c62828`): negative deltas only.

### Neutral
- **App Canvas** (`#f4f3f0`): main page background. It keeps the dashboard light without using pure white everywhere.
- **Surface White** (`#ffffff`): cards, report panels, modals, inputs, and public report surfaces.
- **Muted Surface** (`#f8f7f4`): tabs, low-emphasis grouped controls, and subtle panel separation.
- **Primary Text** (`#141413`): body text, metric values, titles, and analytic labels that must be readable.
- **Soft Text** (`#5f5b53`): descriptions, helper copy, secondary metrics, and chart notes.
- **Faint Text** (`#858178`): section eyebrows, low-priority labels, timestamps, and contextual metadata.

### Named Rules

**The Account Accent Rule.** Account colors are data accents, not themes. They may color charts, active tabs, gauges, and select emphasis states, but the dashboard stays structurally neutral.

**The Current Beats Prior Rule.** Current-period values use the account accent; prior-period values use Prior-Year Stone. Never give prior-year data the brighter color.

**The No Decorative Gradient Rule.** Gradients are allowed only when encoding a data continuum, such as inventory position. They are prohibited as decorative page backgrounds or button treatments.

## 3. Typography

**Display Font:** Montserrat with Inter and system fallbacks  
**Body Font:** Inter with system fallbacks  
**Label/Mono Font:** Inter; no separate mono system is currently defined

**Character:** The type system is assertive but utilitarian. Montserrat gives scorecards and section heads a sports-merchandise scoreboard feel; Inter keeps dense controls, labels, metadata, and report copy compact and readable.

### Hierarchy
- **Display** (860, `clamp(2.9rem, 5.2vw, 5.4rem)`, 0.9): dashboard hero values and public report account titles. Use only for top-level report identity.
- **Headline** (860, `clamp(1.9rem, 3vw, 3.2rem)`, 1.04): section titles such as Monthly Scorecard, Weekly Scorecard, Inventory Snapshot, and Top Performers.
- **Title** (850, `1.08rem`, 1.1): product identity, card titles, product style names, and compact report headings.
- **Body** (400-800, `14px`, 1.55): dashboard prose, report context, takeaways, upload rows, and operational notes.
- **Label** (850-900, `0.62rem`, `0.08em`, uppercase): metadata labels, control labels, section eyebrows, chart legends, and field labels.

### Named Rules

**The Scoreboard Reserve Rule.** Large Montserrat is reserved for account names, section heads, and major scorecard values. Do not use display type for ordinary labels, buttons, table cells, or product metadata.

**The Compact Label Rule.** Uppercase labels are acceptable because this is a dense dashboard, but they must stay short and functional. Do not place decorative eyebrows above every minor block.

## 4. Elevation

SalesLens is flat by default. The active web dashboard uses tonal separation, white cards, rounded corners, gutters, and dark navigation instead of shadow stacks. Older login and legacy report layers still contain ambient shadows, but new dashboard work should treat those as legacy atmosphere rather than the main system.

### Shadow Vocabulary
- **Flat Card** (`box-shadow: none`): default for metrics, scorecards, product cards, report panels, upload rows, and controls.
- **Legacy Panel Shadow** (`0 22px 70px rgba(36, 35, 33, 0.09)`): older paper/stadium surfaces only. Do not introduce it into new dashboard sections.
- **Modal Shadow** (`0 30px 90px rgba(36, 35, 33, 0.22)`): legacy share/import modal depth. If redesigning modals, prefer simpler overlays and flat white panels unless separation truly needs the lift.

### Named Rules

**The Flat-By-Default Rule.** Surfaces are flat at rest. Use background, radius, spacing, and borders before reaching for shadow.

**The No Ghost Card Rule.** Do not pair a 1px border with a large soft shadow on the same analytic card. It makes the dashboard feel generic and heavier than the work requires.

## 5. Components

### Buttons
- **Shape:** dashboard primary buttons use gently rounded corners (`12px`); top-nav controls use pills (`999px`).
- **Primary:** Operator Ink background (`#15120f`), Surface White text (`#ffffff`), uppercase Inter label, 42px minimum height.
- **Hover / Focus:** hover darkens or shifts to Charcoal where defined; focus states should use a visible outline or ring with enough contrast. Keep transitions short (`140-180ms`).
- **Toolbar / Top Nav:** Surface White pill controls on ink navigation, 34px height, compact uppercase labels. These are for account, period, upload, and sign-out actions only.
- **Danger:** transparent button with red/clay text and a thin red-tinted border for destructive upload actions.

### Chips
- **Style:** filter and option chips are compact white or transparent controls with `12px` radius, uppercase labels, and strong active states.
- **State:** selected filters invert to Operator Ink or use the account accent only when selection is tied to account/report state. Unselected chips stay neutral.

### Cards / Containers
- **Corner Style:** standard analytic cards use soft rounded corners (`18px`); general controls and modal shells use the shared radius (`12px`).
- **Background:** Surface White (`#ffffff`) for report cards; Muted Surface (`#f8f7f4`) for grouped tabs and secondary panels.
- **Shadow Strategy:** no shadow in the active dashboard layer.
- **Border:** most active dashboard cards remove borders; subtle dividers use `rgba(31, 31, 29, 0.08-0.1)`.
- **Internal Padding:** compact cards use `0.85rem-1rem`; richer scorecards and takeaways use `1.35rem-1.85rem`.

### Inputs / Fields
- **Style:** white background, subtle line border, `12px` radius, 42px height in dashboard controls.
- **Focus:** must be visible and should use either a dark outline or a restrained steel/account-color ring.
- **Error / Disabled:** disabled controls reduce opacity and should preserve layout size. Error states should use Negative Red only for the failing field and its message.

### Navigation
- **Style:** sticky top navigation with Operator Ink background, white SalesLens mark, centered report-section links, and compact pill controls on the right.
- **Default:** nav links use translucent white text.
- **Hover / Active:** active links turn white and receive a 2px underline. Do not use filled nav tabs in the main top nav.
- **Mobile:** collapse into a single-column top bar with wrapped section links and stacked controls.

### Metric Cards
- **Style:** white rounded cards with compact uppercase labels and strong numeric values.
- **Purpose:** scan-first summaries for sales, units, transactions, average sales, breadth, and deltas.
- **State:** positive and negative colors apply only to the value or delta, not the whole card.

### Scorecards
- **Style:** larger rounded white panels (`18px`) with major totals, comparison bars, and short takeaways.
- **Purpose:** explain the period change, not just display a number.
- **Behavior:** keep current vs prior visual mapping stable: current is accent, prior is stone.

### Product Cards
- **Style:** white rounded cards with product image area, black rank badge, product identity, sales/unit/inventory metadata, and optional product link.
- **Purpose:** carry delight through actual merchandise, not decoration.
- **Image Treatment:** product images sit on white with contain-fit sizing; missing images use a small neutral placeholder.

### Inventory Gauges
- **Style:** horizontal gauge with lean/balanced/heavy continuum and an ink marker.
- **Purpose:** make inventory risk visible without requiring table reading.
- **Rule:** gauge color implies position; supporting copy must still state the takeaway so color is not the only signal.

## 6. Do's and Don'ts

### Do:
- **Do** keep SalesLens a product dashboard, not a landing page. Design for repeated POS analysis and quick operational decisions.
- **Do** use the active flat dashboard system: `#f4f3f0` canvas, `#ffffff` cards, `#15120f` navigation/actions, and account accents as data color.
- **Do** keep controls close to the reports they affect, especially period, account, brand/class, upload, share, and product-gallery controls.
- **Do** use product imagery, rank badges, gauges, and compact scorecards as the main source of visual interest.
- **Do** preserve WCAG AA contrast, keyboard focus, color-blind-safe chart distinction, and reduced-motion alternatives.
- **Do** make dense data feel light through grouping, whitespace, progressive disclosure, and stable comparison patterns.

### Don't:
- **Don't** introduce complexity for its own sake: overloaded dashboards, dense control clusters, repeated card grids, and panels that all compete for attention.
- **Don't** use generic SaaS dashboard tropes, decorative gradients, bloated hero metrics, or visual flourishes that make POS analysis slower.
- **Don't** treat SalesLens like a public marketing site. It is a working tool first.
- **Don't** let the retired macOS app define the redesign. Preserve useful workflow knowledge, but design from the active web version.
- **Don't** use side-stripe borders as decorative accents on cards. Existing data-state stripes should be redesigned into clearer badges, labels, or full-state treatments when touched.
- **Don't** add shadow-heavy ghost cards to the active dashboard layer. New analytic cards stay flat.
- **Don't** make account colors dominate the page. Account colors identify data and selected states; they do not repaint the product.
