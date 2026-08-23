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
| `--state-offline` | `#6b7280` | "Offline" status |
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

`--tap-target-size` (44px) is the shared minimum square for icon-only touch controls.
`--info-popover-max-width` (320px) caps contextual-help popovers while their actual width remains
responsive on smaller screens.
`--selection-card-min-width` (160px) controls when player checkbox cards reflow into additional
columns without making names or avatars too cramped.
`--seating-seat-width` / `--seating-seat-height` and their compact counterparts keep every place
around the physical seating plan the same size; the compact size preserves that equality on phones.
`--assignment-select-width` (112px) keeps repeated player-to-team selectors aligned independently
of player-name length.
`--payment-marker-width` (96px, 88px only below 360px) keeps the food-order payment toggle stable
directly beside its PayPal action while the label, position count and amount change.
`--notification-panel-width` (360px) caps the header notification center while it remains
viewport-responsive on phones.
`--search-panel-width` (640px) gives the global search palette enough room for titles and short
descriptions while the shared modal remains full-width on phones.
`--search-select-results-max-height` (320px) keeps a long searchable option list usable without
letting it cover the full page; additional results scroll inside the dark listbox.

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
| `--bp-xl` | 1280px | Content max-width bump (wide desktop) |

The kiosk dashboard's own breakpoint (900px, `kiosk.css`) is intentionally
**not** `--bp-lg` — it's a different device class (TV/monitor) with its own
layout needs, not a phone/laptop breakpoint that happens to be slightly off.

## Core composition and content rules

These rules are the durable outcome of the general UI-polish pass. They apply to every existing
view and to new views unless a documented domain constraint requires a different presentation.

1. **Build pages from three visible levels.** A page consists of full-width main groups, nested
   cards for repeated entities or independent subflows, and stable rows inside those cards. Main
   headings live inside their surface instead of floating between unrelated cards. Do not add a
   fourth enclosing card that repeats the same title or selected value.
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
   footer when variable content would otherwise make cards drift.
6. **Prefer rectangular rows over pills for people and data.** Player selections, assigned players,
   lobby members and similar records use the shared avatar/name/metadata row. Avatar, name, status,
   role and trailing action remain vertically centered, and long user content may wrap or truncate
   without pushing controls outside the card.
7. **Use one history pattern.** Historical or completed datasets use the icon-free
   `.collapsible-section` header, start collapsed when they are secondary to the active workflow,
   and preserve their open state across live re-renders. Use the concise visible title „Historie“
   unless the domain requires a more specific active/completed label.
8. **Make states structural, not ornamental.** Empty states center their short text and optional
   canonical icon in the available surface. Selection remains recognizable through its semantic
   control; winner, unread, running and error states use border/background plus text or accessible
   labeling rather than a redundant „Neu“ or result badge. Loading, disabled and long-content
   states must retain the same geometry as the populated state.
9. **Reuse canonical semantics.** Navigation and „Mehr“ define domain icons through
   `domainIcons.js`; all other appearances reuse those mappings. Visible German page labels stay
   concise (`Teams`, `Vote`, `Orga`, `Info`, `Trivia`, `Historie`), while longer explanations and
   former labels may appear only in help text or technical documentation where needed.
10. **Keep account management behind the authenticated boundary.** The current roster is readable
    by every signed-in member, while only the session account can edit its own profile. Player
    creation, deletion, roles and foreign-profile editing remain admin-only actions.
11. **Group related workflows into one area with tabs instead of adding nav entries.** The bottom
    nav carries exactly the six during-party destinations Home, Match, Vote, Essen, Spiele and
    Mehr; everything else lives under „Mehr“, the topbar, or (for the merged Rangliste/Statistiken/
    Hall-of-Fame area, „Auswertung“) inside the role-protected Admin area. Auswertung is not a
    bottom-nav destination: reaching it now always requires the real owner/admin role
    (`switchView()`'s redirect guard in `app.js`, checked via `currentPlayerHasAdminRole()`), so it
    lives behind Admin's „Auswertung“ tool card (see „Admin tools“) rather than sharing a
    conditional bottom-nav slot with Essen the way it once did — Essen now has that slot
    unconditionally, for every device. Where two or three
    closely related workflows would otherwise each claim their own entry, they become tabs of one area (see
    `sectionNav.js`). Every tab keeps its own route, so deep links, the back button and persisted
    push urls stay valid, and a tab never nests inside another tab row — a merged area flattens the
    sub-view's own tabs into its area tab row.

## Components

Components are plain CSS classes (no JS component library) in `style.css`:

- **Button** — `.btn` (default), `.btn-primary`, `.btn-danger`, `.btn-block`
  (full width), `.btn-sm` (compact). Combine variant + size, e.g.
  `class="btn btn-primary btn-sm"`.
- **Area tabs** — `.section-tabs` with `.section-tab` is the tab row of a merged top-level area
  (Match, Auswertung, Orga; defined in `sectionNav.js`). It sits directly under the area's
  `.view-title`, outside any card, which is what keeps it distinguishable from the in-card control
  rows further down. Because each tab is a real route, the row is `<nav>` navigation rather than a
  toggle: the active tab carries `aria-current="page"` plus `.btn-primary`, never `aria-pressed`.
  A tab may carry a live count in parentheses (Orga's „To-Do“ shows the current identity's own
  open items) so the number stays visible from every tab of the area; a zero count renders no
  parentheses at all. That count is loaded once the area is entered on any of its tabs, not only the
  one that renders the underlying list, and is patched into all of the area's tab buttons in place. Tabs share the full width on phones for a comfortable tap target and size to
  their own label from `--bp-md`, because two tabs stretched across the wide content column would
  read as banners rather than navigation. A page-level primary action that used to share a row with the view title
  moves into a right-aligned `.row.view-actions` above the content („Turnier anlegen“,
  „Ergebnis eintragen“).
  Re-rendering the same tab reuses its existing `.section-view` element instead of rebuilding the
  shell, so a sub-view that reads its own previous DOM before redrawing (the Packliste's add-item
  draft and focus, the same survives-its-own-rerender pattern the Checkliste's To-Do form uses)
  keeps working across a background refresh triggered from outside that tab.
- **Mode / setting choice** — pick the widget by the shape of the decision, not by habit: a native
  `<select>` for three or more mutually exclusive named options (tournament format); the
  `.btn`/`.btn-primary` two-or-three-way toggle (`aria-pressed`, usually inside `.selection-toolbar`)
  for a plain either/or choice with no competing primary action nearby (Team formation's
  Auslosung/Captain Draft, Checkliste's tabs, the To-Do dialog's Art/Zuweisen-an); the Arcade
  section's `.arcade-mode-toggle` segmented pill only when the toggle sits directly beside a primary
  gradient CTA it must not visually compete with; a plain checkbox only for an independent on/off
  flag (Hin-/Rückspiel, Punktestand tracken, Sitznachbarn), never for a named exclusive
  choice among alternatives.
- **Input** — plain `<input>`/`<select>`/`<textarea>` are styled globally by
  type selector; no class needed.
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
  touch instead of relying on the native `title` attribute. A tooltip trigger always follows
  directly to the right of the visible text it explains; it does not precede a checkbox or float
  independently at the far edge of a row. The optional `.info-tooltip-trigger--warning` variant
  (red instead of muted) marks the reason beside a currently disabled action, e.g. „Teams
  auslosen“/„Draft starten“ in Team formation.
- **Notification center** — `.notification-highlight` exposes the newest active unread entry as a
  brand-gradient direct link below the topbar and follows its domain/expiry lifecycle;
  `.notification-center` with `.notification-center-panel`, `.notification-center-toolbar` and
  `.notification-center-entry` keeps the full personal history plus single/bulk read/remove state;
  unread entries use the accent edge and elevated background without an additional „Neu“ badge;
  the two bulk actions share the complete sticky footer width in equal columns below the history.
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
  pointer, touch, arrow keys, Enter, Escape and visible focus. An option may carry a leading
  status icon (`icon`, `iconLabel`, `iconState`); the component then renders it both inside the
  collapsed control (`.search-select-value-icon`/`.search-select-status`, seated in the field's own
  left padding, which `.has-status-icon` reserves) and on every row of the open list
  (`.search-select-option-icon`). That is the point of the icon: the state is readable *while*
  choosing, which a native `<select>` cannot do inside its options. `iconState` only colours the
  icon — each one also carries the German state as `aria-label` and `title`, so meaning is never
  colour alone. Option sets without icons render exactly the markup they did before.
- **Event dropdown** — every place that picks an event uses the searchable select above with one
  shared option shape from `eventStatus.js` (`eventSelectOption`/`eventSelectOptions`): the event
  title plus its state as an icon, newest first. That covers the topbar workspace switcher
  (`#event-context`), Auswertung's shared filter, „Meine Statistiken“ and Hall of Fame's „Nach
  LAN“ picker. They previously described the same events in three different ways — one appended
  the date range, another showed the bare name, and none showed the state until after a choice had
  been made. The date range is deliberately gone: `eventStatus.js`'s vocabulary is what the reader
  chooses by, and the event cards in Orga remain the place that shows a LAN's exact dates. A filter
  that also offers „Gesamt (alle Events)“ passes it as `allEntryLabel`; that entry is not an event
  and therefore carries no state icon. Hall of Fame's payload holds results rather than lifecycle
  flags, so it joins its events against `accessibleEvents()` for the state and falls back to a
  plain title for an event that list no longer holds.
- **Sticky in-card actions** — `.sticky-actions` pins a card's primary action(s) to the bottom of
  the viewport, just above the fixed bottom nav, while a long preceding list (vote game rows,
  player-selection grids) scrolls through. It stays bounded to its own card via `position: sticky`
  and releases back into normal flow once that card is fully scrolled past, so it never covers an
  unrelated card further down the page. Used for the open vote round's submit/cancel/beenden stack
  and the „Abstimmung starten“ action in Vote, and the „Teams auslosen“/„Draft starten“ actions in
  Team formation and Tournament creation.
  While it's stuck, whatever list row is scrolling past directly behind it is briefly hidden —
  reproducible on a full-size roster at common laptop heights like 1366×768, not only on phones.
  A structural fix (reserving matching blank space so no real row ever lines up behind the bar)
  would need to track live content height for every row along the whole scrollable region, i.e.
  turn each long list into its own internally-scrolling box instead of scrolling with the page —
  a materially different, riskier interaction model for a narrow, self-resolving annoyance
  (scrolling a little further always clears it). Instead the bar reuses the topbar/bottom-nav
  frosted-glass treatment (`background: rgba(23, 30, 46, 0.7)` plus `backdrop-filter: blur(16px)
  saturate(1.4)` where supported) so a covered row stays legible through it, and only its actual
  controls (`button`, `a`, `input`, `[tabindex]`) opt back into `pointer-events` — the bar's own
  background is `pointer-events: none`, so a click on the empty part of the bar falls through to
  whatever row is currently behind it instead of being swallowed by the bar's wrapping layout.
- **Collapsible section** — `.collapsible-section` uses a native `details` element with
  `.collapsible-section-header`, a count/status badge and `.collapsible-section-chevron`. It is the
  standard presentation for collapsed histories, completed tournament lists and closed order
  cards: a full bordered card whose chevron rotates when opened. Section-specific content lives in
  `.collapsible-section-content`; decorative heading icons are omitted.
- **Seating status** — `.seating-status-indicator` sits directly after the gamer name and mirrors
  the shared live state as green „Spielt“, blue „Online“, yellow „Pause“ or red „Offline“. Its German title and
  accessible label preserve the meaning beyond color. Playing, online and pause indicators pulse gently,
  while offline stays static; the global reduced-motion rule disables that motion when requested.
  Every `.seating-seat` uses the same width and height on all four table sides, so vertical sides
  no longer stretch into wide rows. Phones switch all four sides to one shared compact size and
  keep exceptionally narrow layouts locally scrollable instead of widening the page.
- **Team formation** — the „Teams“ tab of the „Match“ area. The view first asks for game and mode: one shared `<select>` picks the
  game, followed by a `Modus` toggle (two `.btn`/`.btn-sm` buttons, `.btn-primary` marking the active
  one, `aria-pressed` conveying state beyond color) choosing between „Auslosung“ and „Captain Draft“.
  Only the chosen mode's `.tournament-section-panel` renders below — the two workflows never compete
  for space — while the shared game picker and the loaded history stay visible regardless of mode.
  Draw participants and draft participants are independent `.tournament-player-grid` checkbox
  selections; captains are then chosen only from the prepared draft roster. One tooltip beside
  „Captain Draft“ explains the complete participant/captain/pick sequence; the Captains label has no
  duplicate tooltip or empty-state instruction. `.captain-selection-group` keeps its label close to
  the associated player grid. Both selections use the standard checkbox-card state without an
  additional selected-card highlight. The captain action stretches like the draw action and stays
  labeled simply „Draft starten“ without repeating participant counts already visible in the
  selections. Each player and captain checkbox grid has a directly labeled search field that filters
  its visible rows without changing hidden selections; where bulk selection actions are offered, they
  apply only to the currently visible search results. Switching modes keeps both selections and search
  terms intact, so toggling back and forth loses no work.
  „Teams auslosen“ and „Draft starten“ share one rule: each stays disabled until its minimum
  (2 selected players; 2–4 captains plus at least 1 pool player) is met, and a red
  `.info-tooltip-trigger--warning` beside the disabled button names the exact missing requirement —
  disabled actions stay understandable instead of silently ignoring a tap. The remaining live-draft
  participants appear under the heading „Spieler“ in the same full-width player cards instead of
  chips; the drafted teams are introduced by the parallel heading „Captains“. Decorative draft icons
  and the redundant local-turn hint are omitted.
  Every player row in both setup flows, the live draft and the drawn teams shows the shared activity
  icon followed by the selected game's `1–10` skill value; in the rating-balanced draw a missing
  self-rating shows the matchmaking fallback in parentheses, so the visible value matches the one
  the draw balanced with, while the captain draft keeps the en dash because it never uses ratings.
  The title and accessible label retain the full term „Skill-Level“.
  Open draws and recorded results share one newest-first „Historie“ because they are two states of
  the same lineup. It starts collapsed through the shared collapsible-section component. Every
  history card repeats its game name. Recorded results omit a status badge;
  `.matchmaking-draw-team.is-winner` identifies the winner through a reinforced border and an
  accessible group label. „Ergebnis bearbeiten“ opens a correction form for winner, value and
  placement and updates the existing match instead of creating a duplicate result. On recorded
  history cards, „Rematch“ is the primary action while editing remains visually secondary.
  Successful seat-neighbor grouping stays silent; a note appears only when requested seat neighbors
  still had to be placed in opposing teams.
- **Player skill display** — `skillDisplay.js` renders the shared activity icon plus the selected
  game's skill value. Teams and Tournaments reuse it in participant selection, drawn-team previews,
  live drafts, histories and tournament detail teams; the icon's tooltip and accessible label
  retain the full „Skill-Level“ meaning. Two call-site options decide what an honest value is:
  - `balanced` (default `true`) — the shown teams really were built from these ratings. A player
    without an own rating then shows the neutral matchmaking fallback dimmed and in parentheses
    (`.rating-unrated`, `5`, mirroring `DEFAULT_RATING` in `src/routes/matchmaking.ts`) instead of
    an en dash, because that is the value the draw balanced with; the team header's total includes
    those fallbacks and appends the dimmed parenthesized count of unrated players. Changing the
    server-side fallback requires updating `UNRATED_SKILL_VALUE` in the same work item so the shown
    totals cannot drift away from the balancing again.
  - `balanced: false` — the captain draft, which picks by turn order and never reads ratings
    (`src/routes/draft.ts`). Its values are purely informational for the picking captain, so a
    missing rating stays an en dash („Noch kein Skill-Level eingetragen“) and neither the row nor
    the total claims that anything counted with `5`. This covers the live draft board, the draft
    participant/captain selections and drafted lineups in the history.
  - `stored: true` — the player objects come from a persisted draw snapshot
    (`matchmaking_draws.teams`, the `POST /api/matchmaking` response) and carry the rating that
    draw used, `null` where there was none. Those values are shown as-is, so a self-rating entered
    later cannot retroactively change a recorded lineup's rows or total. Live selections carry no
    snapshot and read the current rating from state.
- **Game catalog** — The list has three tabs: „Katalog“ (the accepted games), „Vorschläge“ (the
  proposals waiting to be accepted) and „Alle“ (both together). „Alle“ means all — in that mixed
  list every suggestion keeps its `.badge-paused` marker (`.game-row-status-badge`) plus a matching
  `.is-suggestion` border/inset-shadow tint on the row itself, which an accepted game never
  carries, so the two remain distinguishable without switching tabs. The marker is icon-only (a
  lightbulb with an accessible name and native title, not the spelled-out word) since it repeats on
  every suggestion row in that mixed list; the „Vorschläge“ tab's own label and active state already
  say what the whole list is, so its rows carry no additional per-row marker.
  Below the tabs, the sort buttons and the filter controls share one compact
  `.tournament-section-panel` — the same bordered/accent-rail pattern the Tournament create form
  and result dialogs use to separate sibling control groups, but one panel instead of two so the
  combined control area doesn't push the actual list further down than it has to. Neither group
  carries a visible text heading; `.game-catalog-filter-group`'s hairline `border-top` is the only
  visual separator between them, and each group still has an `aria-label` (`role="group"`) so the
  category survives for assistive tech even without on-screen text. The active sort key gets
  `.btn-primary` plus its direction arrow, which combined with the `.btn`/`.chip` shape difference
  from the filter controls below is enough to read as sort vs. filter without a heading for either.
  Inside the filter group, genre chips, the „Bock offen“/„Skill offen“ chips and the free-text
  search carry no per-row label either — each control's own text or accessible name already says
  what it does — and `.game-catalog-filter-divider` separates them from each other with the same
  kind of hairline.
  Every other surface that picks a game to actually play — Vote, Turnier, Team-Auslosung, Captain
  Draft, „Ergebnis eintragen“ and game pings — offers accepted games only (`catalogGames()` in
  `public/js/state.js`, enforced server-side by `src/routes/gameSelection.ts`), which is what keeps
  those pickers short. Demoting a game must not strand what it already produced, so
  `gamesWithHistory()` adds back every game that already carries data wherever a picker also
  scopes existing records: the Rangliste's game filter and the Teams view's game select, whose
  one control also scopes the Historie below it. Such a game stays visible but cannot start
  anything new — the Teams view disables „Teams auslosen“/„Draft starten“ with the usual red
  warning tooltip naming the reason, and „Ergebnis eintragen“ preselects a different game and
  says why in a toast instead of silently swapping it. The one action that stays open is
  completing a draw made while the game was still in the catalog: a result carrying that
  `drawId` is accepted, because recording what was actually played is history rather than
  scheduling. Both meters are editable on every tab, suggestions included — how good the group
  already is at a game is part of deciding whether to accept it.
  Bock and Skill sliders in the game catalog are stored 1-10 and have no true
  empty position, so an untouched slider still renders at a plausible mid-value; it stays dimmed
  (`.skill-row-slider-unset`) and its number label shows an en dash for "no rating yet" until the
  player's own input event fires. The dash belongs to this own-rating input, where no value has
  been given at all — unlike the team views, where a missing rating still enters the draw as the
  parenthesized fallback. Two independent chip
  filters, „Bock offen“ and „Skill offen“, narrow the list to games the current identity hasn't
  rated yet on that facet; both active at once is an AND, unlike the genre chips'
  OR-within-one-facet semantics.
  The first-login onboarding uses the same catalog rows in a temporary rating mode. The first ten
  required games are marked with the textual `Pflicht` badge and an accent rail; the list can be
  expanded to all catalog games, but completion still requires both sliders for the required set.
  If a required game is demoted or removed while the round is open, the server reconciles the
  candidate list against the current catalog and fills the vacancy from the next ranked game.
  Test-player ratings are excluded from this ranking because those players are hidden in normal
  member views. `Später` persists a deferred round, restores the normal catalog for the current
  session and resumes the rating panel on the next login.
- **Player profiles** — There is no separate roster area: Home's Live-Status already lists everyone,
  so every card there is a button that opens that participant's read-only detail dialog. The card
  of the session account is marked „(du)“ and opens the dedicated self-service profile editor
  instead. A global-search hit on a person behaves the same way — the dialog opens over the current
  view rather than navigating away from it. The card's children stay `<span>`s carrying only display
  styling — a `<button>`'s content model is phrasing content, and its descendants are presentational
  to assistive technology once an `aria-label` is set — so the live state and running games are
  spelled into that accessible name itself instead of only appearing as visible child markup.
  Foreign profiles expose neither edit/delete actions nor the private agent key;
  the API omits the private agent key and rejects profile-field updates when the session does not
  match the target player.
  A foreign profile's detail dialog leads with identity (avatar, Gamertag, real name); the complete
  „Bock & Skill“ rating list across every game sits inside one initially collapsed
  `.collapsible-section` carrying the total game count, so a roster of many games does not force a
  long scroll just to see who someone is.
  Player creation stays in the authenticated Admin workflow. The desktop live board keeps exactly
  two equal-width cards per row; an odd final player does not stretch.
  The self-service profile uses the shared
  grouped-page hierarchy for profile data, Agent setup, Push, visible monitors and personal stats.
  Agent setup is split into three stable nested cards for choosing tracking, downloading and
  installing; tracking pause belongs to the first step beside foreground-activity tracking, and
  both explanations live in contextual tooltips beside their checkboxes. The profile header owns
  its spacing to the first group. The unlabeled profile image, Farbe, Gamertag and optional name form one row from
  `--bp-md`; the three controls align their own centers to the image while their labels sit above.
  Phones wrap the two text fields below the visual controls. The shared save action stays
  below that row. The foreground option uses the concise label „Erweitertes Tracking“. Push uses the same checkbox language with its
  explanation in a tooltip instead of an action button and omits a redundant off-state sentence.
  Visible-monitor choices form exactly two columns from `--bp-md`, with phones kept to one column.
- **Admin tools** — Account invitations and claim/reset links live in Admin's authenticated
  onboarding group; their QR codes open in the shared centered modal.
  Admin begins with one „LAN-Bereitschaft“ group: its overall badge and responsive
  two-column check cards cover Server/SQLite, Event and participants, agent coverage/version,
  process mappings, Kiosk and the latest persistent backup. Every card pairs its semantic badge
  with a textual summary and actionable detail; loading and retry errors stay inside the group.
  Backup and seating-plan editing are absent from regular member views and live
  together as nested tool cards in the role-protected Admin area. Admin settings and tools remain
  visible to owners/admins without activating the device-local Admin mode; that mode only reveals
  test players and test-data controls throughout the app and enables Arcade AI matches. The leading
  tool card, „Auswertung“, is the sole entry point into the merged Rangliste/Statistiken/Hall-of-Fame
  area: it used to be a conditional bottom-nav destination gated by the device-local Admin mode
  (sharing that slot with Essen), but now lives only here, gated by the real admin role like the
  rest of Admin — the same standalone, role-protected pattern as „Kioskverwaltung“ below, not a
  shortcut into an otherwise generally-reachable tab. A further
  tool card, „Eventverwaltung“, links into Orga's „Events“ tab — that global, non-personal
  management surface is otherwise only reachable through „Mehr“ like any other Orga tab. „Kioskverwaltung“
  is different: TV-Kiosk is not an Orga tab at all, so this card is its only entry point, a
  standalone role-protected route of its own (the same pattern as „Sitzplan“) rather than a link
  into a tab row. Each tool card keeps its
  title, adjacent help tooltip and colorful primary action on one row; the seating and kiosk
  editors both return to Admin and remain role-protected independently of that mode. Dense 2015–2026 Hall-of-Fame fixtures ship with the local test data and
  need no separate Admin action. The test-data fixture explanation and the existing test-player count live in adjacent
  tooltips; the compact count input, „Test-Daten aufräumen“ and create action share one control row
  in that order. Cleanup removes every marked test player and test LAN
  without touching real events. The single-instance access context is not shown as a separate group
  control in the topbar. Owner/Admin/Member roles are managed directly in Admin's consolidated
  „Benutzer“ list; test players keep a read-only member role there.
  „Benutzer“ list; test players keep a read-only member role there. The underlying group detail,
  update, removal and audit endpoints remain server-side compatibility interfaces and intentionally
  have no separate frontend commands.
  The seating editor follows the same grouped-page hierarchy: the editable plan comes first, followed
  by „Spieler“ and „Konfiguration“. Unassigned players use the shared rectangular two-column player
  rows instead of pills; phones keep one column. Empty seats use an accent border and only the
  centered white label „Frei“, without a redundant seat number. Players without a real name omit that empty second line so their
  gamertag remains vertically centered with the avatar. The automatic monitor-neighbor and save
  behavior use adjacent info tooltips; the monitor explanation sits directly beside „Sitzplan“
  instead of occupying a separate row below the plan.
- **Kiosk dashboard** — Kiosk is a fixed, read-only TV canvas with no page or card scrollbars. Its
  four primary cards remain a 2×2 grid and distribute live players, rankings, tournament standings,
  groups and matches across internal columns, ordered Live-Status and Rangliste above Abstimmung
  and Turnier. Vote status is a centered icon/text stack. Only the
  newest active system notification appears above the dashboard as one full-width brand-gradient
  banner; separate food-order summary cards are omitted because order pushes already use that banner.
  Tournament standings and group phases start directly below their metadata. In a
  knockout view, game and round remain fixed at the top while the bracket round itself is centered in
  the remaining card area. All variants use bordered standing, group or match cards with textual winner
  states, matching the main app's nested-surface hierarchy. Vote is a live room display: open rounds
  vertically center their participant count in the status header and show their current ranking as
  „Zwischenstand“, but replace every game name with a stable, differently sized random-character
  mask plus blur so the room display cannot influence voting. Single-choice runoffs are explicitly labeled
  „Stichwahl“. The two-column live ranking uses the complete remaining card height for up to ten
  games, distributing its five rows evenly instead of compressing them at the top. Low-height TV
  canvases reduce only row padding and gaps so the fixed dashboard still needs no scrollbar. After
  a round closes, a five-second countdown hides every result and reuses Arcade's large layered
  gradient/glow number with its per-second pop effect. The revealed view starts at the top rather
  than floating vertically centered: the standard section title „Gewinner“ introduces a separately
  purple-pink gradient-bordered winner surface (including every tied winner). The smaller standard
  section title „Ergebnis im Detail“ then introduces the complete neutral ranking; its leading rows
  do not repeat the winner border. The result remains visible for ten minutes,
  based on the persisted close timestamp; then the card switches to the empty state. A new
  open round replaces that result immediately. Without an open or recently closed round, the card
  only states that no vote is running. The regular personal Vote
  view keeps its open-round distribution hidden. Without a tournament, the tournament card uses
  the concise empty state „Kein offenes Turnier.“.
- **Grouped page sections** — `.grouped-page-sections` stacks the page's major areas with the
  shared vertical rhythm. Every `.grouped-page-section` is a full-width `.card`; its visible
  heading lives inside the surface through `.grouped-page-section-title`, while filters and
  subordinate rows remain part of that same group. This is the default hierarchy for overview
  pages with several related datasets instead of headings that float between unrelated cards.
  Nested `.card` surfaces use the secondary elevated background so their hierarchy remains visible.
  `.two-column-card-grid` keeps repeated cards in one column on phones and exactly two columns from
  `--bp-md`; a lone or final odd card spans the full row instead of leaving an accidental hole.
  The „Mehr“ hub holds Mein Profil, Admin, Arcade, Durchsage, Jam and Orga — the destinations that
  are not among the six bottom-nav entries. Mein Profil moved here from its former topbar icon
  (`#profile-btn`) to make room for the always-available Feedback icon there (see „Feedback“
  below); the needs-setup indicator that used to sit on that topbar icon now sits on the „Mehr“
  bottom-nav icon instead. Essen is never listed here since it already has an
  unconditional bottom-nav slot of its own (`more.js`); Auswertung is never listed here either —
  it has no general-audience entry point at all, living only behind Admin's „Auswertung“ tool card
  (see „Admin tools“). It keeps each destination's canonical icon
  directly beside its centered title so both read as one label; those icons are one spacing step smaller than standard list-row icons and
  use the wider section gap to keep icon and text visually distinct. Only the navigation chevron
  remains independently aligned at the right.
  The destinations below „Mehr“ follow this same hierarchy without adding decorative accent rails:
  their major workflows and datasets are main groups, while entries, players, orders and results
  remain subordinate cards or rows inside those groups.
- **Broadcasts** — „Neue Durchsage“ and the recent history are separate grouped sections. Delivery
  channels live in the shared contextual tooltip directly beside „Neue Durchsage“ instead of a
  persistent explanation below the form. Recent broadcasts live in one standard, initially
  collapsed „Historie“ section whose open state survives live re-renders; its entries use the
  responsive two-column row grid.
- **Food orders** — Open and historical orders use one full-width nested card per row. Consecutive
  open cards alternate blue and pink accent rails; orderer groups and position rows use no decorative
  order, timer or link symbols. A send time is shown as `20.08. 19:30 Uhr`; without one the detail
  line reads `Kein Zeitpunkt festgelegt`. The view keeps the existing free-text description suggestions,
  quantity field, optional unit price with euro suffix, consolidated list and lifecycle actions.

  Payment is a per-person handoff, never a per-position action. Each orderer group shows the
  quantity-weighted meta line (`<n> Positionen`, plus `Preis fehlt` when necessary), the complete
  tip-inclusive person sum with a small `inkl. x % Trinkgeld` line when a tip is set, a copy action, a PayPal action when the order has a link, and one two-state
  paid marker. `Bezahlt?` uses a dashed circle; `Bezahlt` uses a green check and names the confirmer.
  Its fixed-width slot follows directly to the right of the PayPal action in the group action
  cluster, so label, position and total changes do not move it.
  The marker is derived from the group's items, is available to every authenticated member, and is
  disabled only after finalization. Both marking and reversing happen directly without a confirmation;
  the paid marker's tooltip names existing confirmers. A group delete is available only for the current
  member's open, entirely unpaid group and confirms the complete position list. When a group is paid,
  every one of its position descriptions and amounts is struck through; reversing removes that treatment.
  Finalization itself is not permanent: the creator/an admin can reopen a finalized ("Geschlossen") order
  back to the closed/"Abgeschickt" state through the same `Wieder öffnen` action shown for a merely closed
  order, which restores paid marking and metadata edits (items stay frozen until a further reopen).

  The PayPal button is the only payment handoff. It opens a blank tab synchronously, clears its opener,
  refreshes the order immediately before navigation, aborts when the order or any group item vanished,
  was paid elsewhere, lost its link, or has an incomplete price, and then navigates to the exact
  stored URL, appending the amount only for a bare `paypal.me` recipient link. A `Bezahlt?` dialog
  opens immediately after navigation, explains whether the amount was prefilled, lists every displayed
  position amount, and offers copy actions for both the total and stored PayPal address; only the
  affirmative answer marks all group items paid. The local `paypal` icon is the filled brand path in
  `icons.js`; other icons remain line icons.

  Position rows contain only quantity × description, amount, copy and delete. The displayed amount
  includes quantity and tip; copy uses exactly that display string. There is no position-level paid
  marker, selection state or row divider; their strike-through is derived from the person-level paid
  state. Own open positions can be deleted after the existing confirmation; paid positions disable
  deletion. Foreign and unavailable actions keep their reserved spacer so columns stay aligned. The
  order summary counts quantity-weighted positions,
  people, fully paid people and the open sum of people not fully confirmed. Missing prices show the
  actual priced subtotal with `Preise unvollständig`; the total is labeled `(unvollständig)`.

  The detail-links row always contains `Bestellübersicht`, visible to everyone, with `margin-left:auto`.
  The list deliberately contains no names or paid state: it consolidates normalized descriptions by
  exact unit price and shows quantity, unit price, line total, subtotal and tip-inclusive total.
  The order card puts title/status, creator/time metadata, info, summary, toolbar, groups, total,
  add form and lifecycle actions in that order. The toolbar contains only
  `Alle ausklappen`/`Alle einklappen`, aligned left. When more than one order is open, each card
  starts collapsed; a sibling `aria-expanded` button controls its body, and a search/push target
  expands exactly that card. A single open order has no card-collapse chrome. The same rule applies
  independently inside Historie: once it holds more than one closed/finalized order, each of its
  cards gets the identical collapsible header/chevron and starts collapsed too, while a single
  history entry stays chrome-free. A target for a sent order opens the history section and expands
  that specific card within it (when Historie holds more than one entry) instead of only the section
  itself. Both expanded-state sets live in module state and survive live re-renders.
  The add action is a normal `.btn` spanning the last grid columns and stretching to field height.

  Two hours after an order is sent, unpaid active members become eligible for a direct payment
  reminder, repeated at most once per rolling two-hour window. Home's `Aktuell` list enriches the
  existing order row instead of adding a duplicate. The
  reminder uses the same order deep link and a durable per-player/event send timestamp independent of
  the bounded push history.
- **Orga** — the area that holds the LAN's preparation, reached through „Mehr“. Its five area tabs
  are sorted alphabetically by their German label: „Abstimmungen“, „An- & Abreise“, „Events“, „Packliste“ and
  „To-Do“ (the last two formerly the separate „Checkliste“ and „An- & Abreise“ areas;
  docs/KONZEPT-PACKLISTE-TICKETS.md Abschnitt 9 records the earlier „Packliste“→„Checkliste“
  rename — „Events“ is the former standalone „Einstellungen“ view, moved here because it is setup
  work like the rest of Orga rather than a personal preference screen; there is no longer a topbar
  settings icon). TV-Kiosk is deliberately not an Orga tab — it lives only behind Admin's
  „Kioskverwaltung“ tool card (see „Admin tools“) since opening the shared-screen dashboard is an
  admin task, not something every member needs from Orga. „Mehr“ opens Orga on its first tab,
  „Abstimmungen“, like every other area (`sectionEntryView()` in `sectionNav.js`), so the tab row's
  top-left tab is the one actually selected on arrival; the already persisted push url `/#checklist`
  is unaffected and still lands directly on To-Do. That tab label carries
  the live count of the current identity's own open+taken items. The checklist's former in-view
  toggle is gone — its two halves are area tabs now, so no tab row nests inside another.
  The personal list is unchanged: a compact checkbox row per item (Grundstock plus freely added/removable
  custom entries) with a checked item shown via muted, struck-through text instead of a separate
  badge, followed by the plain add-item field/button row.
  Any active member — not only Owner/Admin — can create a To-Do of either Art (Aufgabe/
  Mitbring-Anfrage) through one unified „To-Do erstellen“ dialog: a `.selection-toolbar` Art toggle,
  Titel/Beschreibung, a second `.selection-toolbar` for „Zuweisen an“ (Niemand/Ich/Personen wählen —
  the last reveals the existing player-selection grid plus „Alle auswählen“/„Alle abwählen“), and an
  optional „Fällig bis“ date using `dateTimeFieldHtml`'s `dateOnly` mode (no time-of-day picker, since
  none is meaningful here). Switching Art or Zuweisen-an mid-form preserves already-typed field values
  across the internal re-render, the same survives-its-own-rerender pattern the add-item field uses.
  „Mir zugewiesen“ is a dedicated first subsection listing the current identity's own open+taken
  To-Dos sorted by due date (undated ones last); an overdue card gets the `checklist-task-overdue`
  border/background treatment and every card with a due date carries a `.badge-overdue`/
  `.badge-due-soon`/`.badge-neutral` pill (never color alone — the badge text itself says „Überfällig“/
  „Heute fällig“/„Morgen fällig“/„Fällig in N Tagen“/a plain date). „Offen“ (the shared pool) gets
  `.chip` filter toggles for Art (Alle/Aufgaben/Mitbring-Anfragen) plus a „Von mir erstellt“ toggle,
  each marked `.chip.is-active` when selected; the pool otherwise still uses one bare `.badge` to
  distinguish the two types and the same nested-card layout as before. „Übernehmen“ replaces the claim
  action once someone else already committed to it, and the creator sees „Zurückziehen“ on their own
  open entry instead. To-Dos already taken by someone else move into the „Unterwegs“ subsection with
  the current assignee's avatar/name and due badge; taken by the current identity, they show in „Mir
  zugewiesen“ with „Freigeben“/„Erledigt“ actions instead. Completed To-Dos live in one standard,
  initially collapsed „Historie“ section whose open state survives live re-renders, same as Food
  orders.
  The „Abstimmungen“ tab is the event-centric planning surface for free questions such as dates,
  locations, duration or budget. It always uses the active event from the existing top-right
  workspace switcher: neither the tab nor its create dialog contains a second event picker. With
  „Allgemein“ active it shows an explicit select-an-event empty state. Visibility, creation and
  voting all require confirmed participation in that event; being Owner/Admin or merely invited
  never bypasses this boundary. Every confirmed participant may start a poll, while the creator of
  that poll manages its deadline, reminders and rounds. The create dialog uses labelled fields,
  repeatable free-text option rows and three explicit response modes: per-option „Passt / Wenn nötig
  / Passt nicht / Offen“, exactly one choice, or multiple choices with an optional maximum. It never exposes
  a participant picker because the accepted event roster is the single source of truth.
  Each poll is one collapsible card. Its current round, response progress and clearly named actions
  stay together; earlier rounds live in a nested, initially collapsed history. „Offen“ is both an
  explicit way to clear a per-option rating and the resulting incomplete-response count. „Abgabe beenden“, „offene Antworten erinnern“ and
  „Ergebnis festhalten“ each explain their concrete effect, and choosing a result is offered only
  after voting ends. Event cards do not embed or link to poll controls. A recorded poll result changes
  no event field, schedule revision or participation state; the confirmation says this explicitly.
  A future explicit „apply to event“ interaction is outside the current UI.
  The „Events“ tab is reachable by every member, not only by owner/admin, because answering an
  invitation is a personal action. What it shows depends on the role: owner/admin receive the full
  management surface — anlegen/bearbeiten, Tracking starten/stoppen, Teilnehmer einladen/entfernen
  and the PDF „Andenken“-Export — while a member gets read-only cards for the events they take
  part in, without the „+ Event“ action or administrative invitation/decline controls; the card
  includes the event-status badge plus the count and names of accepted participants. Cards sort
  newest-first by start date. A finished event moves out of the active list into the tab's own
  „Historie“ (the same collapsible-section pattern as Food orders): it starts collapsed and
  preserves its open state across live re-renders. Pending invitations for the current identity are
  deliberately absent from this tab — a teaser sitting directly above the Events cards made it too
  easy to miss and cluttered the tab with the cards immediately following it. Instead, an
  invitation surfaces as a personal Home „Aktuell“ nudge (see „Home overview“) that links into „Mein
  Profil“, and Profile's own leading „Einladungen“ section is where it is actually answered
  (`renderInvitationCard`/`pendingEventInvitations`/`wirePendingInvitationActions` in `events.js`,
  reused by `profile.js` so the card markup and accept/decline wiring exist exactly once). Event
  cards stay in one vertical column at
  phone and laptop widths so payment and participant controls keep enough room. Their card hierarchy
  deliberately mirrors Food orders: alternating accent rails and a concise title/status header lead
  into one shared `.food-order-details` information box, followed by the separately collapsible
  participant list. Date, location, note and payment information therefore never form competing
  sibling boxes; an editable management card places „Bearbeiten“ in the information-box header like
  an order does. The remaining management actions stay in a stable flex footer, and location links
  are clickable without a separate copy
  action when an event stores a web URL; plain locations remain text. Event creation and editing may
  add one optional per-person cost plus the same PayPal input as food orders: either an e-mail address
  or a complete HTTPS address on `paypal.me`/`paypal.com`. Cost and PayPal controls reuse the food-order price suffix
  and contextual label layout so both fields stay aligned. Invitation cards disclose that cost
  and its optional deadline before acceptance, without offering payment actions yet. Accepted
  non-creators see only their own contribution and `Noch zu bezahlen`/`Bezahlt` state, the confirmer
  and timestamp of their own payment, plus a personal toggle for recording or correcting it; foreign
  payment states and aggregates are absent from both UI and API payload. A managing non-creator who
  lacks payment-management rights receives only the boolean `paymentLocked` removal guard on roster
  rows, without amount, actor or timestamp, so the blocked action has an explicit reason; this is
  the sole administrative exception to the foreign-payment privacy rule. The visible full-width
  PayPal action says `Bezahlen`. The handoff refreshes the event before opening PayPal,
  prefills the EUR amount for PayPal.me, attempts to copy an e-mail recipient for the generic PayPal
  flow and keeps that recipient visible in the confirmation if clipboard access is unavailable. It
  asks „Bezahlt?“ afterwards; only an affirmative answer records the payment. The recorded event
  creator instead receives the aggregate overview and the same `Offen`/`Bezahlt` toggle used by food
  orders on every accepted participant row. There is no bulk-payment action. The edit form can also
  record the accommodation's total invoice separately from the fixed contribution per person. The
  creator's payment box compares snapshotted received contributions with that invoice. Confirmed
  payments remain in the received total after a decline or account deactivation; a paid roster row
  cannot be removed until its payment is explicitly reset. If the creator account becomes inactive
  or is deleted, the group owner becomes the payment manager. The box shows the
  current surplus/deficit, the projected result after every accepted person pays and the rounded
  accommodation price per current acceptance; pending and declined invitations never enter that
  per-head calculation. Payment controls keep the reset action visible for an already recorded
  payment even if the current contribution was subsequently cleared, so roster and account-removal
  guards never create a dead end. The card-level list
  includes every invited account and labels each row as `Zugesagt`, `Einladung offen` or
  `Abgelehnt`; its summary separates accepted and still-open invitation counts. Member cards remain
  accepted-only and expose neither pending/declined identities nor that management status. Participant lists use
  the shared collapsible-section behavior plus Food orders' leading chevron/name/meta header pattern,
  start closed and preserve their open state across live re-renders. Their people remain one full-width
  row per line at every breakpoint so payment proof and the creator's toggle have predictable room;
  the separate management dialog proceeds directly to its rows without repeated counts or general
  explanatory paragraphs. State-specific blockers remain explicit: an ended event shows once that
  new invitations are unavailable, and a paid row associates its removal action with the instruction
  to reset the payment first.
  An optional date-only payment deadline starts reminders on that day; without one, contributions
  become eligible two hours after acceptance. Further reminders run at most once per rolling two-hour
  window, using durable reminder state independent of push history. TV-Kiosk (Admin's „Kioskverwaltung“
  card, not an Orga tab) is deliberately minimal — one grouped-page-section with a single
  full-width link that opens `/kiosk.html` in a new tab.
- **Hall of Fame and Info** — Hall-of-Fame all-time rankings use the shared two-column leaderboard
  grid. „Nach LAN“ uses one directly labeled event dropdown and shows every overall placement for
  the selected LAN, followed by tournament winners in the same leaderboard-row structure. Blue and
  pink accent rails distinguish the two result groups; tournament game names have no decorative
  game symbols. Admin fixtures cover twelve years with full standings and three tournament winners per LAN so dense
  long-term states remain testable. Hall of Fame is the third tab of the „Auswertung“ area.
  Info is not an area at all: the topbar's „i“ (`#info-btn`, the canonical `info` icon from
  `domainIcons.js`) opens it as a dialog over whatever view is open, because it is reference
  material — WLAN, Discord, server IPs, house rules — that people look up mid-conversation and must
  not cost them their current workflow. Entries remain alphabetically sorted responsive two-column
  nested cards; „Eintrag anlegen“ is the dialog's leading full-width primary action, and an open
  dialog refreshes itself on `info:changed` instead of stacking a second copy. Being itself an
  `openModal()` instance, its entry form and delete confirmation can open on top of it — `modal.js`
  delivers Escape only to the topmost open `.modal-backdrop`, so cancelling a nested confirmation
  never takes the dialog underneath it down too.
- **Feedback** — the topbar's `#feedback-btn` (the canonical `feedback` icon from
  `domainIcons.js`) opens the feedback dialog as a modal over whatever view is open, the same
  reachable-from-anywhere pattern as Info. It automatically captures the view that was open when
  the icon was tapped, so a report never needs to explain where it happened. A submission picks one
  of four distinct sentiments — Positiv, Negativ, Problem, Idee — through the shared
  `.selection-toolbar` toggle rather than a free-text category, plus a message field. Admin's
  Feedback section lists submissions newest first and filters them by the same four sentiments plus
  „Alle“ through the shared `.chip`/`.chip.is-active` pattern (mirroring Spiele's genre chips and
  Orga's To-Do Art filter).
- **Arrival carpools** — the „An- & Abreise“ tab of Orga. Anreise and Abreise remain separate
  full-width accented panels. Their
  carpool cards use two columns from `--bp-md`, but an odd final card deliberately keeps one-column
  width instead of spanning the row; phones stay single-column. Every card repeats Start and
  Ankunft vertically and proceeds directly into the passenger rows without a redundant
  „Mitfahrende“ caption. Below the current passengers, every available passenger seat has its own
  compact „Frei“ row with a direct „Mitfahren“ action for eligible players. The driver row uses the
  same right-hand action column for a neutral „Fahrer“ label. Occupied passenger rows and free rows
  without an available join action show the parallel neutral „Mitfahrer“ role. All member and free
  rows share one minimum height; the join action stays compact inside it. A driver's „Bearbeiten“
  action uses the primary button treatment next to the destructive delete action.
- **Arcade** — The launcher follows the grouped-page hierarchy with separate full-width cards for
  „Spiele“, optional running games, the selected game and „Statistiken“.
  Game choices are horizontal nested cards with their Lucide game icon, name and an explicit
  „… offen“ lobby badge; they form one column on phones and exactly two from `--bp-md`. Running
  games reuse the same responsive two-column rhythm. The tile badge is the only separate open-lobby
  overview; selecting a game reveals all of its lobbies in the dedicated main group. Goal and
  controls live in one tooltip directly beside that selected game's title instead of a second
  „Lobby“ heading. Every open lobby is a nested card modeled on the
  carpool cards, with the host's lobby name in the header, stable player rows with
  role/readiness at the right, a direct join action in a free-slot row and host/member actions in a
  separated full-width footer. Host labels, free labels and join actions share an exact three-column
  grid and row height. A host's game settings belong inside that lobby card; the compact
  „Punkte bis Sieg“ control shares the separated footer with „Start“ and „Schließen“ from `--bp-md`
  instead of forming a wide radio-button block. „Start“ precedes „Schließen“ in that footer so the
  primary action reads first, ahead of the destructive one, and both split the footer evenly so they
  render at the same width. A disabled „Start“ keeps its red reason tooltip as a direct sibling in
  that footer rather than wrapping it together with the button: a wrapper claims only its content
  width while the lone sibling stretches, which left the pair visibly uneven. Readiness is
  communicated in the player rows without a duplicate status sentence. Tetris exposes a compact Duell/Arena selector before creation.
  „Lobby öffnen“ precedes the lobby cards at full width, so opening a new lobby never requires
  scrolling past every existing one first. The mode selector is a small bordered segmented switch
  (`.arcade-mode-toggle`) with a flat `--accent` fill on the active segment, deliberately distinct
  from `.btn-primary`'s accent-gradient treatment so the pill reads as a setting rather than a
  second, equally weighted action next to „Lobby öffnen“ — that primary create action keeps the
  gradient to itself. Duell keeps two equal boards;
  Arena accepts three to eight players and keeps the local board large beside a responsive grid of
  opponent boards. On phones the local board sits above that grid. The current automatic attack
  target receives a textual „Ziel“ marker in addition to its accent border, while eliminated
  players remain visibly dimmed for spectating. For admins with active Admin mode the opponent
  choice is a second `.arcade-mode-toggle` segmented switch („Mensch“/„KI“) directly to the right
  of „Lobby öffnen“, so the create row reads as [Modus] [Lobby öffnen] [Gegner] and the primary
  create action keeps its gradient to itself instead of competing with a separate „Gegen KI“
  button. That switch only selects; „Lobby öffnen“ then opens either a human or an AI lobby, and
  the AI lobby honors the mode switch beside it — Tetris and Snake Duell use one bot while their
  Arena fills all seven opponent slots, and Pong and Blobby Volley cover both the AI duel and the
  Doppel variant with a bot teammate. An empty
  lobby no longer adds
  a redundant waiting sentence. Member actions use the same destructive treatment for „Verlassen“
  as the host's „Schließen“ action, and only render for a member who actually joined that lobby.
  Guest footers place „Verlassen“ before the readiness toggle;
  compact score selectors use the smaller shared row height. Create-action containers use the same
  outer inset as lobby footers. Whichever of the two flanking switches a game or player does not
  get reserves its width anyway (`.arcade-lobby-create-row--no-mode` /
  `--no-opponent`), so from `--bp-md` „Lobby öffnen“ keeps one width and equal left and right
  insets across every game; on phones the
  primary action remains full-width. Tetris, Pong, Snake and
  Blobby Volley all select Duell by default. A disabled „Lobby
  öffnen“ or „Start“ carries the same red `.info-tooltip-trigger--warning` reason pattern as Team
  formation's „Teams auslosen“/„Draft starten“.
  Blobby Volley and Pong both offer Duell (1 gegen 1) and Doppel (2 gegen 2) through the same
  segmented switch, without a separate mode label or explanatory tooltip. Doppel lobbies expose
  two explicit teams with two slots each, require all four participants to be ready and award the
  shared team score and win to both teammates. Pong follows Atari's Pong-4 rules: each participant
  controls a separate paddle that remains in its assigned upper/lower half, player initials and roster
  lane labels identify all four paddles, and Doppel defaults to 21 points.
  Both games reach a Doppel AI match through the same two switches — „Doppel“ plus „KI“ — where
  the host and one bot teammate play against two bot opponents.
  Statistics use the concise title „Statistiken“ and one full-width game dropdown whose options
  include each game's match count. The selected game is not repeated above its results. Those
  results follow directly without another enclosing card or accent rail; player rows reuse
  `.leaderboard-list-grid` for the shared one-/two-column ranking presentation and spell out wins
  and losses in German. Tetris Duell and Tetris Arena are separate dropdown entries so an Arena's
  many non-winning placements do not distort the duel win rate. Arena rows instead show wins,
  Top-3 finishes, average placement, cleared lines, sent garbage and knockouts. Matches containing
  bots appear as separate „KI-Test“ entries and never alter the human-only Duell/Arena rankings.
  Mode-capable Arcade lobbies use the shared `.arcade-mode-toggle` segmented switch in the same
  action row as lobby creation. Snake „Duell“ remains the two-player classic mode; „Arena“ accepts
  three to eight players and labels every lobby with mode and occupancy. Snake's AI lobby follows
  that same mode switch: „Duell“ opens a one-on-one against a single bot, „Arena“ fills the lobby
  with the maximum seven bots. Neither exposes a count selector.
  Arena matches keep eliminated players visibly in the roster with a textual status, while the
  canvas dims their snake and marks the shrinking safe zone with the shared danger treatment.
  Numbered head markers and a matching `Schlange N · Name` legend identify every participant
  without relying on color; the same legend appears in player, spectator and kiosk contexts.
  Challenge Rush also exposes the Admin-mode-gated opponent switch plus its test-challenge
  selection; playing the bot solo draws
  from its ten original single-payload challenges, since the bot cannot yet play the thirty
  logic/memory trial challenges. A lobby that further humans join before it starts keeps the
  full forty-challenge catalog like any other match, and the bot then simply scores 0 on
  whichever trial challenges come up.
- **Jam sessions** — Jam is a grouped page below „Mehr“. Its page heading always exposes an info
  tooltip explaining the shared title/playlist workflow, controller lifecycle and that only the
  controller device needs Spotify. The setup card is shown whenever no controller is paired yet or
  the paired one is offline, so the unconfigured state is not silently empty. A dedicated local controller on the
  playback PC or kiosk Raspberry Pi connects Spotify through PKCE and never appears as a player.
  The server stores neither Spotify application credentials nor OAuth tokens. One participant
  starts a session on an explicitly selected playback device; this player is the host. All active
  group members share pause, resume and skip controls and search the same catalog for tracks and
  playlists. „Als Nächstes“ follows directly below „Jetzt läuft“ before the search workflow. Search
  results stay inside one stable block and use a full-width two-button switch built from the shared
  secondary and primary button treatments to switch between titles and playlists. Both choices get
  equal space, and only the active result type receives primary emphasis. A playlist
  result starts its complete Spotify playback context and replaces the
  current playback plus pending requests after explicit confirmation. While that context is active,
  „Als Nächstes“ shows the remaining playlist-track count separately from additional song requests.
  Those requests follow Spotify's append-only queue in request order; reorder and remove
  controls stay hidden because Spotify exposes neither operation for its live queue. Requests use stable full-width rows with artwork,
  title, artist and requester instead of pills; their order is the shared queue order. The current
  track is the most prominent nested surface, with progress and host controls directly attached.
  Members can reorder two or more queued requests through native drag-and-drop or the equivalent
  arrow controls. Respawn persists that order and replaces the active Spotify URI context at the
  current playback position so the visible order also becomes the actual playback order.
  The kiosk reuses a single compact full-width music bar below the fixed dashboard and shows current
  track, progress and next request without exposing controls or Spotify credentials. The fixed
  loopback redirect `http://127.0.0.1:43821/callback` makes controller setup independent of the
  Respawn server URL. A short-lived pairing code replaces an existing controller; only its hashed
  credential and public playback/queue metadata reach the server.
  The setup card offers a fresh pairing code independently from the generated controller ZIP, so an
  already installed controller can always be paired again without another download. Explicitly
  disconnecting a controller immediately creates and displays such a code; the ZIP remains the
  secondary first-installation or recovery fallback instead of becoming the only available action.
  The package needs neither repository nor `npm` instructions.
  It contains prefilled server/pairing data and platform launchers for macOS, Windows and Raspberry
  Pi/Linux; the first launch installs the controller and its isolated runtime once below the user's
  `.respawn` directory. Its local status page can enable login autostart, retry immediately, renew
  Spotify authorization independently and re-pair an existing installation with a fresh code.
  Respawn's offline state therefore offers reconnection first and a new download only as a fallback.
  Controller requests have bounded timeouts and retry automatically after transient network errors.
  The controller heartbeat remains online when Spotify is temporarily unavailable and omits the
  unavailable playback snapshot so the server retains the last confirmed track. An invalid Respawn
  credential explicitly requests re-pairing; an expired or revoked Spotify refresh token explicitly
  requests only Spotify reauthorization, never an unnecessary controller reinstall. Realtime
  playback refreshes retain the current Jam DOM while new status is fetched; active controls keep
  focus and the view preserves its internal scroll position instead of flashing a loading state.
- **Analytics** — the „Statistiken“ tab of the „Auswertung“ area. Its own three datasets
  (Spielzeit, Matches & Turniere, Arcade) stay an in-card control group under the visible heading
  „Ansicht“, which is what separates them from the area tab row above. All three share the same
  event dropdown and show no additional date controls.
  Playtime and tournament data use the selected event directly; Arcade internally derives the
  event's date bounds because arcade results have no event assignment. The daily match chart is
  omitted. Tournament formats and per-game tournament counts are separate nested groups with blue
  and pink accent rails.
  The former „Witzige Rekorde“ section uses the concise title „Trivia“.
  Its empty state is symbol-free and avoids repeating that title.
- **Profile** — The profile row uses the original compact square color preview. Activating it opens
  a centered Respawn modal instead of the browser's native color dialog. The modal combines a
  keyboard-, pointer- and touch-operable hue/saturation wheel with a live preview, an editable and
  copyable `#RRGGBB` field, and explicit cancel/apply actions; it has no competing preset palette.
  Invalid hex input is visibly rejected and cannot be applied or copied. The chosen value remains a draft until the profile's
  main save action persists it.
  A leading „Einladungen“ section (present only while pending event invitations exist) shows the
  same invitation cards Orga's Events tab used to render inline — cost/deadline disclosure plus
  Annehmen/Ablehnen — via events.js's shared `renderInvitationCard`.
- **Leaderboard** — the „Rangliste“ tab and default entry of the „Auswertung“ area, reached only
  through Admin's „Auswertung“ tool card (see „Admin tools“). The filtered „Rangliste“ and per-player
  „Spielzeit“ share one main card titled „Rangliste & Spielzeit“ with the game picker above them;
  each remains a distinct `.tournament-section-panel` with the shared accent rail. „Spielzeit pro
  Spiel“ stays a separate grouped page section. The selected game scopes the two accented sections
  only; „Spielzeit pro Spiel“ always keeps the all-game totals so the comparison does not collapse
  to one row.
  Every section uses `.leaderboard-list-grid`: one column on phones and two columns from `--bp-md`;
  a single row or empty state spans the full available width.
  Player and game names truncate safely without pushing points or controls outside the card; wins
  and matches remain visible as a second text line rather than depending on native hover text.
  The result dialog reuses `.tournament-section-panel` to separate „Modus“, player assignment and
  result entry. Team and free-for-all result inputs use the same aligned responsive grid.
- **Home overview** — Home follows the same full-width grouped-card hierarchy as Tournaments,
  Teams and Vote. „Aktuell“, „Live-Status“, „Rangliste“ and „Sitzplan“ are separate main cards with
  their heading inside the surface. Every current item pairs its full-row navigation action with a
  separate icon action that hides only that live occurrence for the signed-in identity and active
  event on the current device; a new vote round, order, tournament or lobby remains visible again.
  Tappable current items, the personal status and player entries remain nested cards on the
  secondary elevated background; „Gerade aktiv“ is a subsection of
  „Live-Status“ rather than a competing page-level group. A pending event invitation appears here as
  a plain linking nudge into „Mein Profil“ (see aktuellStatus.js); the full card with
  Annehmen/Ablehnen lives only in Profile, not in this list. Main groups stay in one continuous column
  at phone and laptop widths while their existing internal grids remain responsive.
- **Voting** — The page titles are the concise navigation labels „Teams“ and „Vote“. Vote uses the
  same card grouping as the other polished workflows without an accent rail.
  New/current-round controls come first, followed by separate full-width cards for „Letzter Vote“
  and „Top 10 nach Bock-Level“. An open round exposes a bordered participation counter with the
  submitted and eligible-player totals, updated through the existing realtime refresh. In points
  mode, an open round that the current identity hasn't submitted yet also shows its own rating
  progress („X von Y bewertet“) beside an „Unbewertet“ chip that narrows the game grid to
  still-unrated rows. `.vote-game-grid` itself keeps two columns from `--bp-md` and gains a third from `--bp-xl`
  (1280px) instead of stretching each 0-10 slider across half of a wide desktop's full content
  width. The latest
  result and every history card show up to ten scored games with the same compact rows and
  responsive columns as the Bock ranking; games with zero votes or points are omitted. History
  keeps an explicit detail action for the complete non-zero bar view. Equal top scores use the same
  visible rank and a reinforced gold border on every tied
  row, so the shared placement remains understandable beyond the border color. The full-width
  „Stichwahl starten“ action sits at the bottom of the same „Letzter Vote“ card without a
  redundant explanatory block or separate group.
  The Top 10 form two ordered five-item columns from `--bp-md`, while phones keep one continuous
  list. Game rows remain one
  column on phones and two from `--bp-md`, with the same bordered card treatment at both sizes.
  Explanations sit in info tooltips immediately beside their titles. Title and info fields start at
  the same control height. The participant action spans the full width, with equal-width „Abbrechen“ and „Beenden“ actions below.
  Starting a round always shows its game selection grid — there is no separate checkbox gating it.
  It preselects the current Top 10 by Bock as a starting point, same as before; a round covering
  everything simply uses „Alle markieren“ or clears the remaining exclusions by hand. The
  grid reuses the same icon select-all/deselect-all buttons (`.selection-toolbar-icon`) and
  collapsible text search (`selectionSearchHtml`) as Team formation's and Tournament creation's
  player pickers, alongside its own genre chips. All three controls filter the visible rows while
  hidden checkbox selections remain intact; bulk selection actions apply only to the currently
  visible intersection. That grid, an
  unrestricted round's ballot and „Top 10 nach Bock-Level“ all cover the accepted games only;
  suggestions are not votable (see „Game catalog“). A suggestion's own Bock ranking stays visible
  in the Spiele view, which sorts by Ø Bock on every tab. A round keeps the exact games it was
  started with for its whole life: a game demoted mid-round keeps the votes already cast for it,
  stays votable for everyone else and can still win, and „Stichwahl starten“ still offers every
  tied winner of the closed round. Only a fresh selection is restricted.
  Vote-specific empty states center icon and copy vertically in both overview and history.
  Every identity can submit only once per round: the server enforces this atomically with `409`,
  empty points submissions are invalid, and the client replaces the submit action with a green
  „Bewertung/Stimme abgegeben“ state while locking that identity's controls.
  Vote history is labeled simply „Historie“, uses the shared icon-free collapsible header, starts
  closed and retains its open state across live re-renders.
- **Tournament overview** — the „Turniere“ tab in the „Match“ area, whose first/default tab is
  „Teams“; switching back to „Turniere“ from the tab row always returns to the
  list rather than the tournament board that was last open. A tournament's own detail page keeps
  the area tabs above it and titles itself with an `h2`, so the page never carries two `h1`
  headings. `.tournament-list-grid` shows at most two tournament cards per row;
  a single card stretches across the available width and further cards wrap. `.tournament-list-section` presents
  active and completed tournaments as two prominent status rows without separate summary-stat
  cards. The completed row uses the shared collapsible-section presentation, starts collapsed and
  retains its open state across view re-renders. `.tournament-player-grid` keeps the player picker at two cards per row from `--bp-md`; phones
  stack one card per row so checkbox, avatar, name and skill value stay readable inside each card.
  Tournament creation places a directly labeled player search above that grid; it filters rows
  without clearing hidden selections, and its bulk actions affect only visible search results.
  `.tournament-detail-stats` and `.tournament-team-grid` expose real progress and roster information
  above a centered, locally scrollable bracket; team cards use at most two columns. The proposal
  grid follows the same two-column cap and uses draggable `.tournament-drag-player` rows, with
  touch selection and keyboard arrows as equivalent input paths. The create form separates
  „Auslosung“ from „Modus“ through reusable bordered `.tournament-section-panel` sections with a
  restrained accent rail instead of numbered badges. The same section pattern groups each
  tournament group with its table and rounds. Result controls remain compact and decided matches
  expose an explicit edit action. The standard `.section-title` introduces „Aktive Lobbys“ while
  `.tournament-active-lobby-grid` presents up to two currently playable pairings per row; a single
  active lobby spans the full row. Each
  `.tournament-lobby-info` card names the phase, matchup and hosting team. A stored lobby base name
  receives a deterministic phase/round/match suffix, so parallel pairings always have distinct
  lobby names without mutable lobby assignments. League and group modes show only the earliest
  unfinished round; knockout modes show every open match whose two teams are known. Each credential
  uses a centered label/value/action grid and provides Lucide's `copy` action with a full touch
  target. The general lobby-host rule lives in the info popover beside the section title.
  A separate „Turnierstatus“ section groups the team, participant and decided-match counters so
  they remain visually distinct from the lobby cards.
  Bracket matches reserve an internal action area so score inputs and their save/edit control never
  overlap. Tournament details shorten the visible formats to „Liga“ and „Gruppenphase + K.O.“;
  their full configuration remains available from the adjacent info popover. Tournament overview
  cards use the same compact format names without explanatory parentheses. Standalone league rounds
  reuse `.tournament-section-panel` so their accent rail matches the grouped tournament stages.

Prefer composition of these primitives over view-specific copies. A new component
class needs a distinct reusable purpose; a one-page selector that merely restates a
base component is not a new component. Keep repeated row heights stable even when
optional descriptions differ in length, using the established line-clamp or reserved-
space pattern rather than content-dependent card heights.

## Icons and visual language

- New or changed interface icons must use the local Lucide-style helper in
  `server/public/js/icons.js` (`icon(...)` or a suitable specialized helper).
- Repeated domain meanings use `server/public/js/domainIcons.js` as their semantic source of truth
  across navigation-adjacent cards, empty states, cross-links, kiosk content and notifications.
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
- Every interactive element must be usable by keyboard and show a visible focus state.
  Focus order follows the visual and logical order; opening a modal moves focus inside,
  closing it returns focus to the trigger.
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
- The first-login core tour is a true modal: `#app` is inert, focus cycles inside the dialog,
  Escape skips the explanatory steps into the required rating mode, and focus returns to the
  previous control after completion. The rating panel is intentionally non-modal so its sliders
  remain usable; it stays below the shared modal layer so game details and other forms remain
  operable.
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

- **The 11px vertical control rhythm** — base inputs, `.dt-date-btn`,
  `.dt-time-select` and the native `select` chevron padding (`style.css`) all
  share `11px var(--space-3)`; the wider chevron side clears each element's
  own icon. 11px is deliberate (12px makes the controls taller than the
  compact buttons they sit next to), it's just not itself a token value.
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
`.githooks/pre-commit`). It only looks at the **added lines** of the staged
diff under `server/public/**/*.{css,js}` — not the whole codebase — so it
enforces the rule going forward without requiring every existing off-scale
value to be fixed or allowlisted first.

It checks the complete frontend snapshot for references to undefined CSS custom
properties: the full staged Git index locally and the full committed `HEAD` tree
with `--base-ref` in CI. It never mixes either snapshot with unrelated unstaged
working-tree changes. A property set dynamically with `style.setProperty(...)`
counts as defined; a `var(--name, fallback)` reference is also valid without a
global definition because it has an explicit recovery value. This full-state
check also catches removal of a definition that is still referenced elsewhere.

For the added lines in the staged or branch diff, it additionally blocks:
- a hardcoded hex color outside a `--token: #...` definition itself,
- a hardcoded `font-size`/`font-weight`,
- a hardcoded `gap`/`padding`/`margin`,
- a hardcoded `border-radius`,

unless the value already exists as a `var(--...)` reference.

For a genuine, deliberate exception (see above), add a comment containing
`design-token-ok` on the same line, e.g.:

```css
border-radius: 2px; /* design-token-ok: scaled to this bar's own height */
```

Run it manually any time with `npm run check:tokens` (from `server/`). It
does **not** check colors/spacing outside `server/public` (e.g. `agent/`),
and it does not check `box-shadow` or breakpoint values — those needed either
too much judgment (glows are legitimately different sizes for different
elements) or too much false-positive risk to check mechanically.

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
