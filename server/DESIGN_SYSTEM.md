# Design System

Single source of truth for colors, spacing, typography, radius, shadows and
breakpoints in the frontend (`server/public/`). No framework, no build step —
tokens are plain CSS custom properties defined once in `server/public/css/style.css`
(`:root` block, top of the file) and consumed everywhere else via `var(--token-name)`,
including inline `style="..."` attributes built by the JS views.

Arcade-only presentation rules live in `server/public/css/arcade.css`. The app loads that
stylesheet only for Arcade views, while `kiosk.html` loads it statically for its Arcade dashboard.
Keep new Arcade selectors there so shared-view changes do not expand the Arcade browser-test
trigger.

Arcade browser code lives under `server/public/js/arcade/`; route renderers live in its `views/`
subdirectory and are declared directly in `viewManifest.js` with `area: 'arcade'`. The Core app
loads those renderers with native `import()` and waits for `arcade.css` before rendering. New
Arcade code stays inside this subtree. Move a helper to shared Core code only when Core genuinely
uses it. The kiosk is the deliberate exception: it loads Arcade CSS statically and may import only
the small spectator helpers under `arcade/shared/`.

If you're adding or changing UI, the rule is simple: **never write a raw color,
pixel value, or font-size — always reference a token below.** If the token you
need doesn't exist yet, add it to the `:root` block first (with a short comment
on why), then use it. Don't invent a new one-off value at the call site.

This document is mandatory for every change under `server/public/` and complements
the repository-wide rules in `../DEVELOPMENT_GUIDELINES.md`. If code and this
document disagree, inspect the current implementation before changing either one;
then update both in the same work item so the discrepancy does not persist.

## Required workflow for UI changes

1. Read this document completely before editing frontend files.
2. Search for an existing token, base component, layout helper and comparable view.
   Extend a shared primitive only when the requirement is genuinely shared.
3. Check the result at phone and laptop widths. For interaction changes, exercise
   keyboard input and a touch-sized viewport as well as pointer input.
4. Verify loading, empty, error, disabled and long-content states that the component
   can actually reach. A happy-path screenshot alone is not sufficient.
5. Verify in proportion to the changed surface by following the matrix in
   `../DEVELOPMENT_GUIDELINES.md` and the commands in `TESTING.md`. Documentation-only changes need
   only link, path and command-name checks; frontend CSS or JS changes additionally require the
   token check and the relevant browser/E2E coverage. If a required command cannot run, report the
   exact reason and remaining risk.

The staged-diff token checker is a guardrail, not proof of design-system compliance.
Review still has to catch semantic token misuse, unnecessary component variants,
accessibility issues, responsive regressions, shadows and breakpoint decisions.

## Colors

| Token | Value | Purpose |
|---|---|---|
| `--bg` | `#0f1420` | Page background |
| `--bg-elevated` | `#171e2e` | Cards, topbar, bottom nav, modals |
| `--bg-elevated-2` | `#1e2740` | Inputs, chips, hover states, nested surfaces on top of `--bg-elevated` |
| `--border` | `rgba(122, 141, 195, 0.21)` | Hairlines/dividers everywhere (translucent so it picks up whatever's behind it) |
| `--text` | `#eef1f8` | Default text color |
| `--text-muted` | `#8b93a7` | Secondary text, captions, placeholders, "no color set" avatar fallback |
| `--accent` | `#5b8cff` | Primary brand blue — active nav, links, focus rings, primary CTAs |
| `--accent-2` | `#9163f5` | Brand gradient midpoint (violet) |
| `--accent-3` | `#ef5da8` | Brand gradient end (pink) |
| `--accent-gradient` | gradient of the three above | Primary buttons, wordmark, progress bars, brand touches |
| `--accent-text` | `#ffffff` | Text/icon color on top of `--accent-gradient` |
| `--rank-1-gold` | `#ffd166` | #1 leaderboard rank only |
| `--danger` | `#ef4444` | Destructive actions, error text |
| `--danger-bg` | `rgba(239, 68, 68, 0.15)` | Background for danger badges/buttons |
| `--state-playing` | `#22c55e` | "Spielt" status |
| `--state-playing-bg` | `rgba(34, 197, 94, 0.16)` | Background for the "Spielt" badge |
| `--state-paused` | `#f59e0b` | "Pause" status |
| `--state-paused-bg` | `rgba(245, 158, 11, 0.16)` | Background for the "Pause" badge |
| `--state-offline` | `#9ca3af` | "Offline" status; sufficient contrast for small badge text |
| `--state-offline-bg` | `rgba(107, 114, 128, 0.16)` | Background for the "Offline" badge |

**Avatar color palette** — a separate, server-side single source of truth
(`server/src/testUsers.ts`, `COLORS`), used for bulk test-player generation. The profile editor
accepts the full color space through its custom picker and presents no presets, so the frontend
no longer ships a palette module of its own. Six of the eight swatches
deliberately reuse the semantic colors above (so a generated avatar color never
introduces a hue that means something different elsewhere in the UI); the
remaining two (cyan `#06b6d4`, lime `#84cc16`) exist purely for swatch variety.

## Spacing

4px base scale. Every `gap`/`padding`/`margin` should land on one of these —
no in-between values (`6px`, `10px`, `14px`, ...).

| Token | Value |
|---|---|
| `--space-1` | 4px |
| `--space-2` | 8px |
| `--space-3` | 12px |
| `--space-4` | 16px |
| `--space-5` | 20px |
| `--space-6` | 24px |
| `--space-7` | 32px |
| `--space-8` | 48px |

`--card-padding` (`var(--space-4) var(--space-4)`) is the default `.card` padding.

## Typography

No native `<h1>`–`<h6>` scale is used — every size is explicit via one of these
tokens (there was no font-size scale at all before this pass; this consolidates
what had drifted into ~17 near-duplicate raw values).

| Token | Value | Typical use |
|---|---|---|
| `--font-size-2xs` | 0.7rem | Nav-label, bracket round captions |
| `--font-size-xs` | 0.78rem | Secondary/muted small text (the most common size in the app) |
| `--font-size-sm` | 0.85rem | Slightly larger secondary text, `.btn-sm` |
| `--font-size-md` | 0.95rem | Default UI text — buttons, inputs, section titles |
| `--font-size-lg` | 1.15rem | Subheadings, modal headers |
| `--font-size-xl` | 1.3rem | View titles |
| `--font-size-2xl` | 1.5rem | View titles (desktop, ≥ `--bp-sm`) |
| `--font-size-3xl` | 2rem | Large hero text (login-card wordmark) |
| `--font-weight-regular` | 400 | De-emphasized inline text |
| `--font-weight-medium` | 600 | Buttons, player names, badges |
| `--font-weight-bold` | 700 | Section titles, card headers |
| `--font-weight-black` | 800 | View titles, wordmark |
| `--line-height-tight` | 1 | Icons, badges, single-line chips |
| `--control-line-height` | 1.25 | Einzeilige Controls; Details: [Controls](frontend-contracts/components/controls.md) |

Font family is `--font` (system font stack) — set once on `body`, no need to
reference it elsewhere. All native form controls inherit that same stack. Use `.player-name` for a
player's standalone display name across cards, rankings and selection rows; technical keys may
remain monospace where the distinction carries meaning.

## Radius

| Token | Value | Use |
|---|---|---|
| `--radius-sm` | 8px | Buttons, inputs, small icons |
| `--radius` | 14px | Cards, toasts, bracket match boxes |
| `--radius-lg` | 20px | Modals, login card, login logo |
| `--radius-full` | 999px | Pills — badges, chips, nav active-pill, vote bars |

A handful of genuinely one-off radii are *not* tokenized on purpose — e.g. the
2px corner on the analytics concurrency-chart bars, which is tied to that
bar's own (very small) height, not a general "small radius" concept. Don't
reuse `--radius-sm` there just because it's "the smallest one".

## Shadows

| Token | Value | Use |
|---|---|---|
| `--shadow` | `0 4px 20px rgba(0, 0, 0, 0.35)` | Neutral elevation — cards, modals, toasts, login card |
| `--shadow-glow-accent` | `0 4px 20px rgba(91, 140, 255, 0.42)` | Primary-button hover glow |
| `--shadow-glow-brand` | `0 0 14px rgba(145, 99, 245, 0.5)` | Wordmark glow |

Note: a few brand-purple/accent-blue glows elsewhere (topbar logo icon, the
big login-screen logo splash, the active nav icon, the primary button's
resting-state shadow, the kiosk broadcast banner) are intentionally **not**
folded into the two tokens above — each is tuned to a different blur/alpha for
a different-sized element, and forcing them to match would either wash out a
small icon glow or under-power a full-screen splash effect. Only exact-value
duplicates were consolidated; deliberately distinct ones stay distinct.

## Motion

| Token | Value | Use |
|---|---|---|
| `--motion-fast` | `0.15s ease` | Short state transitions such as a tile changing shape |

All animations and transitions still require the global `prefers-reduced-motion`
override described below. The token only standardizes timing; it does not make
motion an acceptable substitute for a visible state change.

## Avatar sizes

| Token | Value |
|---|---|
| `--avatar-size-sm` | 24px |
| `--avatar-size-md` | 32px |
| `--avatar-size-lg` | 48px |

Defined for future use. `avatarHtml(player, size)` in `format.js` currently
takes a raw pixel number per call site, and existing call sites span a wider,
context-driven range (18px inline chips up to 64px on the profile hero) that
predates this token set and reflects real, intentional size differences
between contexts — not drift. Prefer one of the three tokens above for *new*
avatar UI; only introduce a new raw size if none of the three fits and the
context is genuinely distinct (and consider whether that's actually a 4th
scale step worth adding here instead).

`--row-icon-size` (36px) is a separate, unrelated token for the icon tile in
`.list-row` (players/games/tournaments/"Mehr" hub) — not an avatar.

`--tap-target-size` (44px) defines registered structural heights and the shared minimum width of
icon controls. `--control-height` (32px) defines the shared height of standard interactive controls
on desktop and mobile. Variants, ownership, normalized geometry and structure targets are specified in
the [Controls contract](frontend-contracts/components/controls.md).
`--info-popover-max-width` (320px) caps contextual-help popovers while their actual width remains
responsive on smaller screens.
`--date-picker-width` (360px) gives the shared calendar's month and year selectors enough room on
laptop-sized layouts while the popover remains viewport-responsive on phones.
`--selection-card-min-width` (160px) controls when player checkbox cards reflow into additional
columns without making names or avatars too cramped.
`--seating-seat-width` / `--seating-seat-height` and their compact counterparts keep every place
around the physical seating plan the same size; the compact size preserves that equality on phones.
`--assignment-select-width` (112px) keeps repeated player-to-team selectors aligned independently
of player-name length.
`--payment-marker-width` (96px, 88px only below 360px) keeps the food-order payment toggle stable
beside its PayPal action while the label, position count and amount change. It is the toggle's
width wherever the group box has room for it; on phones the action cluster fills whatever its row
leaves rather than shrinking to its own contents, so the marker may only give up the few pixels a
narrow box is short and never grows past the token. Its width therefore follows the layout and not
the `Bezahlt?`/`Bezahlt` label.
`--notification-panel-width` (360px) caps the header notification center while it remains
viewport-responsive on phones.
`--search-panel-width` (640px) gives the global search palette enough room for titles and short
descriptions while the shared modal remains full-width on phones.
`--search-select-results-max-height` (320px) keeps a long searchable option list usable without
letting it cover the full page; additional results scroll inside the dark listbox.
`--shell-bottom-inset` reserves the phone/laptop bottom navigation plus safe area and becomes zero
for the wide desktop side rail. `--desktop-nav-width` (176px) keeps that rail compact while labels
remain visible, while `--desktop-supporting-pane-min-width` (320px) prevents supporting dashboard
cards from collapsing below a useful scan width. Wide-desktop content may grow to 1600px; its
centering calculation explicitly subtracts the rail so the navigation never narrows the usable
content column by accident. Mein Profil offers Automatic/Desktop/Laptop as one account-scoped shell
choice. Automatic follows `--bp-xl`; below that breakpoint every preference intentionally retains
compact geometry.

## Breakpoints

CSS custom properties can't be evaluated inside an `@media` condition (a CSS
limitation, not something fixable without a build step) — so these are
documented here and referenced by a same-line comment at each `@media` rule,
not consumed via `var()`.

| Token | Value | Used for |
|---|---|---|
| `--bp-sm` | 480px | View-title size bump |
| `--bp-md` | 640px | Card grid columns, modal layout (sheet → centered dialog) |
| `--bp-lg` | 860px | Content max-width bump |
| `--bp-xl` | 1280px | Wide desktop side rail, adaptive page columns and content max-width bump |

The kiosk dashboard's own breakpoint (900px, `kiosk.css`) is intentionally
**not** `--bp-lg` — it's a different device class (TV/monitor) with its own
layout needs, not a phone/laptop breakpoint that happens to be slightly off.

## Core composition and content rules

These rules are the durable outcome of the general UI-polish pass. They apply to every existing
view and to new views unless a documented domain constraint requires a different presentation.

1. **Build pages from three visible levels.** A page consists of full-width main groups, nested
   cards for repeated entities or independent subflows, and stable rows inside those cards. Main
   headings live inside their surface instead of floating between unrelated cards. Do not add a
   fourth enclosing card that repeats the same title or selected value. A page-level heading — the
   `.view-title` of a secondary or untabbed page header — is never repeated verbatim as the first
   card heading directly below it. Where that lead card would only restate the page title, it drops
   its own heading and lets the header be the single heading for that surface: the card's contextual
   info trigger moves onto the `.view-title` (the `title-with-info` header the Jam and TV-Kiosk
   pages already use) and a refresh-style control moves into the header's trailing-action slot.
   Supporting sibling cards keep their own content-naming headings, so a page never mixes a
   restated title with a bare one.
2. **Use space deliberately.** Repeated players, games, rankings and comparable cards normally use
   one column on phones and two equal columns from `--bp-md`. Choose whether an odd final item spans
   the row based on meaning: summary/list rows may span; entity cards such as players, carpools,
   events and orders keep the same width as their siblings. Never let CSS auto-placement make that
   decision accidentally.
3. **Use accent rails only to distinguish siblings.** Blue and pink left rails separate adjacent
   workflows or datasets such as Anreise/Abreise or tournament-format/game counts. They are not
   generic decoration and are omitted where card hierarchy already communicates the structure.
4. **Keep visible copy short.** Remove repeated titles, counts, status sentences and instructions
   that are already evident from controls or state. A non-obvious rule moves into the shared
   contextual help component. Its info trigger sits immediately to the right of the exact title or
   label it explains; it never lives in a detached help row or to the left of a checkbox.
5. **Keep controls aligned.** Controls sharing a row use the same visual height and baseline.
   Compact actions must not increase the height of data rows. A primary action uses the Respawn
   gradient, destructive actions use the danger treatment, and parallel secondary actions share
   the available width. Actions for a repeated card belong in a separated, consistently positioned
   footer when variable content would otherwise make cards drift. See the
   [Controls contract](frontend-contracts/components/controls.md) for normative geometry and reflow.
6. **Prefer rectangular rows over pills for people and data.** Player selections, assigned players,
   lobby members and similar records use the shared avatar/name/metadata row. Avatar, name, status,
   role and trailing action remain vertically centered, and long user content may wrap or truncate
   without pushing controls outside the card.
7. **Use one history pattern.** Historical or completed datasets use the icon-free
   `.collapsible-section` header, start collapsed when they are secondary to the active workflow,
   and preserve their open state across live re-renders. Use the concise visible title „Historie“
   unless the domain requires a more specific active/completed label.
8. **Make states structural, not ornamental.** Empty states center one short, regular-weight text
   line in the available surface and stay free of decorative icons. Nearby headings and controls
   provide the context, so the line does not repeat a section or explain the next action. The
   established mascot illustration on Home remains the explicit brand exception. Selection remains
   recognizable through its semantic
   control; winner, unread, running and error states use border/background plus text or accessible
   labeling rather than a redundant „Neu“ or result badge. Loading, disabled and long-content
9. **Keep product rules separate.** Routes, roles, business flows, product copy and
   domain-state details live in [Product rules](../docs/product/README.md).
## Components

Components are plain CSS classes (no JS component library) in `style.css`:

- **Button** — `.btn` composes meaning (`.btn-primary`, `.btn-danger`, `.btn-ready`), width
  (`.btn-block`, `.btn-equal`) and compact text (`.btn-sm`) without caller-owned inner geometry.
  Variants and status: [Controls](frontend-contracts/components/controls.md).
- **Action menu** — Shared disclosure, geometry, focus, dismissal and caller boundaries follow the
  [ActionMenu contract](frontend-contracts/components/action-menu.md).
- **Back navigation** — `backButtonHtml({ view, id, label })` in `backButton.js` renders every
  compact view-level back action with Lucide's `chevronLeft` and the visible default label
  „Zurück“. `view` creates normal route navigation; `id` supports a local sub-view handler. Do not
  hand-roll the arrow, use Unicode chevrons or repeat the destination in the visible label when the
  surrounding header already names it.
- **Empty state** — Safe text, structured content, illustration, recovery and Legacy boundaries
  follow the [EmptyState contract](frontend-contracts/components/empty-state.md).
- **Primary collection** — `.primary-collection-section` gives the current collection of Events,
  polls, food orders and tournaments one shared main-card treatment. The title and primary action
  stay together in the card header. Border, empty-state height and spacing therefore remain stable
  across these areas.
- **Area tabs** — use real route navigation, an active aria-current page state and
  the established responsive tab layout. Product-specific areas, routes and labels live in
  [Product rules](../docs/product/README.md).
- **Secondary page header** — `.more-subpage-header` with `.more-subpage-title-row` is the shared
  header for the untabbed destinations reached through „Mehr“ or Admin. It keeps the „Zurück“
  action, page title and an optional trailing action on one stable, compact row. These destinations
  share the same first-card top edge as the untabbed main areas. Only
  `.more-subpage-header--tabs` reserves a lower row for LAN Orga's tabs; at phone widths that
  reservation covers the wrapped two-row tab layout. Long content or browser zoom may still grow
  either header rather than clipping controls.
- **Untabbed page header** — a direct `.view-title` or `.page-title-row` reserves one compact touch-
  target-height row plus the standard section gap. This keeps the first content surface on the
  same top edge at phone and laptop widths; a trailing page action may share `.page-title-row`.
- **Card headings** — headings inside cards use `--font-size-lg`, bold weight and the card's
  standard top/left inset. `.grouped-page-section-title` and `.collapsible-section-header` align
  heading text and trailing actions to the same top edge. A contextual-help trigger keeps its full
  touch target through negative outer margin, so adding help never shifts only that heading
  downward.
- **Mode / setting choice** — choose controls by the decision shape: a native select for
  three or more mutually exclusive named options, a toggle for an either/or choice, a segmented
  pill only beside a competing primary CTA, and a checkbox for an independent on/off flag.
  Product-specific choices live in [Product rules](../docs/product/README.md).
- **Input** — plain `<input>`/`<select>`/`<textarea>` are styled globally by
  type selector; no class needed.
- **Required fields** — mark required labels with `class="field-label is-required"`; the shared
  CSS adds the visual `*`. Optional fields remain unmarked, so `(optional)` is not used as a
  default label suffix. Keep the native `required` attribute on inputs where browser validation
  is required; the visual marker is not a substitute for validation semantics.
- **Number stepper** — every `input[type="number"]` is enhanced app-wide by
  `numberStepper.js` (no per-view wiring, same auto-enhancement approach as
  `icons.js`'s emoji replacement): a compact `.number-stepper-btn` pair
  overlays the input's own right-hand padding for click/tap increment and
  decrement — the same spot the native spinner used to occupy before it was
  disabled for space (see the `input[type='number']` exception above) — so
  every already-tuned narrow number field keeps its existing width. Mouse-
  wheel scrolling over a focused field no longer silently changes its value
  (the field blurs on wheel instead, so the page keeps scrolling normally
  underneath the pointer).
- **Card** — `.card`.
- **Badge** (status pill) — `.badge` + one of `.badge-playing` /
  `.badge-online` / `.badge-paused` / `.badge-offline`. Online reuses the
  accent color pair so it stays distinct from the green active-game state.
- **Chip** — `.chip` (generic pill, works on `<span>`, `<button>`, `<a>`).
- **List row** — `.list-row` (+ `.list-row-icon`, `.list-row-desc`) for
  Spieler/Spiele/Turniere lists and the "Mehr" hub.
- **Contextual help** — `.info-tooltip` with `.info-tooltip-trigger` and
  `.info-tooltip-panel`, rendered/wired through `infoTooltip.js`; works with pointer, keyboard and
  touch instead of relying on the native `title` attribute. It reveals on hover and on focus and is
  deliberately not a click-to-pin control and keeps the normal cursor (`cursor: default`, no pointer
  or help cursor on hover): hovering is enough on a pointer device,
  while focus is what a keyboard Tab and a touch tap produce, so the text stays reachable where there
  is no hover (phones). It closes on mouse-leave, blur, Escape or an outside pointer press. A tooltip
  trigger always follows
  directly to the right of the visible text it explains; it does not precede a checkbox or float
  independently at the far edge of a row. The optional `.info-tooltip-trigger--warning` variant
  (red instead of muted) marks the reason beside a currently disabled action, e.g. „Teams
  auslosen“/„Draft starten“ in Team formation.
- **Notification center** — presents personal notification state with text as well as visual
  treatment. Product lifecycles, actions and expiry rules live in
  [Product rules](../docs/product/README.md).
- **Connection status** — `.connection-status` is the single global technical-state strip below the
  topbar. A short initial Socket.IO connection stays hidden to avoid startup flicker; offline and
  reconnect states remain visible with explicit German text until a confirmed reconnect hides the
  strip. The state uses the shared paused color pair and a local Lucide icon, never color alone.
- **Global search** — `.global-search` with `.global-search-results` and
  `.global-search-result`, wired through `searchPalette.js`; opens from the topbar or with
  `Strg/Cmd + K`, searches both areas and current app content without an external service, and uses
  `.search-target-highlight` to expose a concrete result after navigation.
- **Searchable select** — `.search-select` combines a text input with an app-rendered
  `.search-select-list`/`.search-select-option` listbox. It replaces the browser's native
  unthemeable `datalist` popup for long game catalogs, keeps the selected value in the existing
  hidden input contract, filters while typing, caps long result lists locally and supports
  pointer, touch, arrow keys, Enter, Escape and visible focus. Inside a modal, the listbox stays
  within the modal's visible scroll boundary, opens above the field when that side has more room
  and keeps longer results locally scrollable. An option may carry a leading
  status icon (`icon`, `iconLabel`, `iconState`); the component then renders it both inside the
  collapsed control (`.search-select-value-icon`/`.search-select-status`, seated in the field's own
  left padding, which `.has-status-icon` reserves) and on every row of the open list
  (`.search-select-option-icon`). That is the point of the icon: the state is readable *while*
  choosing, which a native `<select>` cannot do inside its options. `iconState` only colours the
  icon — each one also carries the German state as `aria-label` and `title`, so meaning is never
  colour alone. Option sets without icons render exactly the markup they did before.

- **In-card footer actions** — card-footer-actions separates actions from a long preceding
  list with a hairline and scrolls with its card. Product-specific callers live in
  [Product rules](../docs/product/README.md).
- **Collapsible section** — `.collapsible-section` uses a native `details` element with
  `.collapsible-section-header`, a count/status badge and `.collapsible-section-chevron`. It is the
  standard presentation for collapsed histories, completed tournament lists and closed order
  cards: a full bordered card whose chevron rotates when opened. Section-specific content lives in
  `.collapsible-section-content`; decorative heading icons are omitted.




- **Grouped page sections** — grouped-page-sections creates a visible main-group hierarchy
  with full-width card surfaces, nested secondary surfaces and responsive repeated-card grids.
  Product-specific navigation, routes and layouts live in
  [Product rules](../docs/product/README.md).






optional descriptions differ in length, using the established line-clamp or reserved-
space pattern rather than content-dependent card heights.

## Icons and visual language

- New or changed interface icons must use the local Lucide-style helper in
  `server/public/js/icons.js` (`icon(...)` or a suitable specialized helper).
- Repeated domain meanings use `server/public/js/domainIcons.js` as their semantic source of truth
  across navigation-adjacent cards, cross-links, kiosk content and notifications. Empty states stay
  icon-free.
  Bottom navigation and the entries under „Mehr“ define the canonical view symbols; other
  appearances of one of those views must request the icon by its view key instead of choosing an
  icon locally. In particular, crossed swords mean an active tournament, scales mean team
  balancing, the activity pulse means Skill, the hamburger means a Sammelbestellung, and the trophy
  is reserved for rankings, results and wins.
- Do not use emoji, Unicode pictograms or external icon CDNs in navigation, headings,
  buttons, status badges, chips, empty states or toasts. The Respawn logo and the mascot
  illustration (`img/mascot.svg`, Home's no-players empty state) are the intentional brand
  exceptions; user-authored content such as game names may contain emoji.
- Colorful buttons (`.btn-primary`, `.btn-danger`, `.btn-ready`) carry text only — no leading
  icon; the color treatment already marks them as the significant action.
- Decorative icons are hidden from assistive technology. Icon-only controls require
  a German accessible name (`aria-label` or visible equivalent) and a discoverable
  tooltip where the action would otherwise be ambiguous.
- Keep icon size, stroke and alignment consistent with the surrounding base component;
  do not create local SVG variants for visual novelty.

## Interaction and accessibility

- Use semantic elements: `<button>` for actions, `<a>` for navigation and associated
  `<label>` elements for form controls. Do not simulate controls with clickable `<div>`
  elements.
- Every interactive element must be usable by keyboard and show a visible focus state. Focus order
  follows the visual and logical order. Shared dialog focus and calendar keyboard/reflow behavior
  follow the
  [Modal](frontend-contracts/components/modal.md) and
  [DateTimeField](frontend-contracts/components/date-time-field.md) contracts.
- Status, validation and selection cannot be communicated by color alone. Pair color
  with German text and, where helpful, an icon or shape.
- Form errors identify the affected field and explain how to recover. Disabled actions
  should remain understandable; do not silently ignore a click that appears available.
- Hover styles belong inside `@media (hover: hover)`. The default/touch state must not
  depend on hover, and controls must have a comfortably tappable hit area.
- Every animation and transition must have an effective global override under
  `@media (prefers-reduced-motion: reduce)`. Motion must not be required to understand
  a state change.
- Dynamic announcements such as errors or completed background actions use the
  established toast/live-region mechanism without repeatedly interrupting screen readers.

- Layouts must tolerate longer German text, user-provided names and browser zoom without
  clipping essential controls or creating horizontal page scrolling. Intentional
  horizontal content such as the tournament bracket remains locally scrollable.

## Usage examples

```html
<!-- Button variants -->
<button class="btn btn-primary">Anlegen</button>
<button class="btn btn-danger btn-sm">Löschen</button>

<!-- Card with tokenized spacing/typography instead of inline magic numbers -->
<div class="card stack">
  <div class="section-title">Spieler</div>
  <div class="row" style="gap:var(--space-2);">
    <span class="badge badge-playing">Spielt</span>
  </div>
</div>
```

```js
// JS views build HTML as template strings — tokens still apply via var(),
// including inside inline style attributes:
return `<div class="muted" style="font-size:var(--font-size-xs);margin-top:var(--space-2);">
  ${escapeHtml(text)}
</div>`;
```

## Do / Don't

| Don't | Do |
|---|---|
| `style="color:#2563eb;"` | `style="color:var(--accent);"` |
| `style="padding:16px;"` | `style="padding:var(--space-4);"` |
| `style="font-size:0.8rem;"` | `style="font-size:var(--font-size-xs);"` |
| `style="border-radius:999px;"` | `style="border-radius:var(--radius-full);"` |
| `const PALETTE = ['#5b8cff', ...]` in a new view file | Reference the semantic tokens (`var(--accent)`, ...); generated-player swatches live server-side in `testUsers.ts` |
| A new one-off `.my-thing-btn { padding: 6px 10px; }` override | Use `.btn` + `.btn-sm` (or `.chip`) as-is; only add a new component class if the existing ones genuinely can't express it |
| Guessing a breakpoint (`@media (min-width: 700px)`) | Reuse `--bp-sm/md/lg/xl`'s literal value, with a `/* --bp-x */` comment |

## When a value genuinely doesn't fit

Not every raw number is a bug. A value stays as a documented one-off when it's
tied to something specific that a shared token would distort. When in doubt:
if reusing the nearest token would look wrong, leave a short comment
containing `design-token-ok` and a reason instead of forcing it (see
"Automated check" below — that comment is also what tells the pre-commit
check this line is intentional).

The current, complete list of such exceptions in `server/public`:

- **The compact control rhythm** — base inputs pad `5px var(--space-3)` and
  `.btn` pads `6px var(--space-5)` (`style.css`). Together with
  `--control-line-height: 1.25` and the 32px minimum, single-line fields and buttons
  measure 31–33px; real wrapping grows without clipping. Textareas use rows/content
  and a minimum height. Native selects reserve the custom chevron separately.
  Package 2 implements this rhythm; normative geometry and variants remain in
  [Controls](frontend-contracts/components/controls.md).
- **Avatar sizes at `avatarHtml()` call sites** — real, intentional variety
  (18px inline chips up to 64px on the profile hero); see "Avatar sizes"
  above.
- **Three glow shadows** (topbar logo icon, the login-screen logo splash, the
  active nav icon) — each tuned to a different blur/alpha for a
  different-sized element; see "Shadows" above.
- **`.countdown-num-wrap`'s `4.5rem` padding** — blur headroom sized to the
  glow's own 3-sigma radius so GPU compositing never clips it; a spacing
  token would couple it to the wrong scale.
- **`.field-label`'s 2px left margin** — optical indent aligning the label
  with the input's inset text.
- **Paper-white surfaces** — the Scribble drawing canvas and the QR modal
  keep literal `#ffffff` regardless of theme (drawing convention and QR
  scan contrast respectively).
- **`.scribble-word-mask`'s 2px letter-spacing** — spreads the monospace
  underscore blanks so single letters stay countable.
- **Bracket layout constants** (`--bracket-*` on `.bracket-tree-wrap`) —
  match-box geometry for the connector math, scoped to the bracket and
  deliberately not part of the global spacing scale.

Everything else that was off-scale (values like 6px, 10px, 14px sitting
between two spacing steps) has been rounded onto the scale.

## Automated check (pre-commit)

`server/scripts/check-design-tokens.js` runs automatically on every commit
(installed via `npm install` → the `prepare` script wires git to
`.githooks/pre-commit`). Color, typography and radius rules look at the
**added lines** of the staged diff under `server/public/**/*.{css,js}`. The
cleaned spacing and responsive-breakpoint contracts additionally cover the
complete frontend snapshot, so a later edit cannot quietly reintroduce legacy
off-scale padding or remove a required breakpoint annotation elsewhere.

It checks the complete frontend snapshot for references to undefined CSS custom
properties, hardcoded `gap`/`padding`/`margin` values and unannotated
width/height media queries: the full staged Git index locally and the full committed `HEAD` tree
with `--base-ref` in CI. It never mixes either snapshot with unrelated unstaged
working-tree changes. A property set dynamically with `style.setProperty(...)`
counts as defined; a `var(--name, fallback)` reference is also valid without a
global definition because it has an explicit recovery value. This full-state
check also catches removal of a definition that is still referenced elsewhere.

For the added lines in the staged or branch diff, it additionally blocks:
- a hardcoded hex color outside a `--token: #...` definition itself,
- a hardcoded `font-size`/`font-weight`,
- a hardcoded `border-radius`,

unless the value already exists as a `var(--...)` reference.

For a genuine, deliberate exception (see above), add a comment containing
`design-token-ok` on the same line, e.g.:

```css
border-radius: 2px; /* design-token-ok: scaled to this bar's own height */
```

Run it manually any time with `npm run check:tokens` (from `server/`). It
does **not** check colors/spacing outside `server/public` (e.g. `agent/`),
and it does not check `box-shadow` values — glows legitimately need different
geometry for different elements. Media-query literals remain necessary because
CSS custom properties cannot be used in conditions; the checker requires the
matching `/* --bp-* */` reference, or a same-line `design-token-ok` reason for a
domain-specific device breakpoint such as the kiosk dashboard.

Because the local script reads the staged diff and full staged index, an unstaged
change produces no finding and cannot block an unrelated commit. Before relying on
the result, review the complete working diff as well. Do not stage unrelated user
changes merely to make the checker inspect them. CI or review should run the same
command on the intended change set; the same-line `design-token-ok` escape hatch
always requires a concrete reason, never a generic suppression.

GitHub Actions checks the full branch range with
`npm run check:tokens -- --base-ref <base-sha>`. The explicit base is required in CI:
a clean checkout has no staged diff, so the default pre-commit mode would otherwise inspect
nothing and produce a misleading success.

## UI review checklist

- [ ] Existing tokens, helpers and base components are reused where appropriate.
- [ ] Page hierarchy follows main group → nested card → stable row without repeated wrappers or
  detached headings.
- [ ] Repeated content uses the intended one-/two-column grid and an odd final entity has an
  explicit, domain-appropriate width.
- [ ] Explanations are either removed as redundant or placed in contextual help immediately to the
  right of the text they explain.
- [ ] Related controls share height and baseline; compact actions do not stretch their data rows.
- [ ] No new raw color, spacing, radius or font values exist without a documented
  `design-token-ok` reason.
- [ ] Icons come from `icons.js`; icon-only controls have accessible German names.
- [ ] Loading, empty, error, disabled and long-content states remain clear and stable.
- [ ] The flow works with keyboard, visible focus, pointer and touch interaction.
- [ ] Meaning is not color-only; reduced-motion and hover media rules are respected.
- [ ] Phone and laptop layouts were checked, including browser zoom and long German text.
- [ ] `check:tokens`, build, unit/integration tests and E2E tests are green, or the
  unexecuted check and its remaining risk are explicitly reported.
