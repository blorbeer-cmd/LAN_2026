# Design System

Single source of truth for colors, spacing, typography, radius, shadows and
breakpoints in the frontend (`server/public/`). No framework, no build step —
tokens are plain CSS custom properties defined once in `server/public/css/style.css`
(`:root` block, top of the file) and consumed everywhere else via `var(--token-name)`,
including inline `style="..."` attributes built by the JS views.

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
5. From `server/`, run `npm run check:tokens`, `npm run build`, `npm test` and
   `npm run test:e2e`. If a command cannot run, report the exact reason and risk.

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

**Avatar color palette** — a separate, JS-side single source of truth
(`server/public/js/avatarPalette.js`, `AVATAR_PALETTE`), used for the player
avatar-color picker and bulk test-player generation. Six of its eight swatches
deliberately reuse the semantic colors above (so a player's avatar color never
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
| `--font-size-3xl` | 2rem | Large hero icons/numbers (login icon, empty-state emoji) |
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
`--assignment-select-width` (112px) keeps repeated player-to-team selectors aligned independently
of player-name length.
`--notification-panel-width` (360px) caps the header notification center while it remains
viewport-responsive on phones.
`--search-panel-width` (640px) gives the global search palette enough room for titles and short
descriptions while the shared modal remains full-width on phones.

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

## Components

Components are plain CSS classes (no JS component library) in `style.css`:

- **Button** — `.btn` (default), `.btn-primary`, `.btn-danger`, `.btn-block`
  (full width), `.btn-sm` (compact). Combine variant + size, e.g.
  `class="btn btn-primary btn-sm"`.
- **Input** — plain `<input>`/`<select>`/`<textarea>` are styled globally by
  type selector; no class needed.
- **Card** — `.card`.
- **Badge** (status pill) — `.badge` + one of `.badge-playing` /
  `.badge-paused` / `.badge-offline`.
- **Chip** — `.chip` (generic pill, works on `<span>`, `<button>`, `<a>`).
- **List row** — `.list-row` (+ `.list-row-icon`, `.list-row-desc`) for
  Spieler/Spiele/Turniere lists and the "Mehr" hub.
- **Contextual help** — `.info-tooltip` with `.info-tooltip-trigger` and
  `.info-tooltip-panel`, rendered/wired through `infoTooltip.js`; works with pointer, keyboard and
  touch instead of relying on the native `title` attribute. A tooltip trigger always follows
  directly to the right of the visible text it explains; it does not precede a checkbox or float
  independently at the far edge of a row.
- **Notification center** — `.notification-highlight` exposes the newest active unread entry as a
  brand-gradient direct link below the topbar and follows its domain/expiry lifecycle;
  `.notification-center` with `.notification-center-panel`, `.notification-center-toolbar` and
  `.notification-center-entry` keeps the full personal history plus single/bulk read/remove state;
  unread entries use the accent edge and elevated background without an additional „Neu“ badge;
  the two bulk actions share the complete sticky footer width in equal columns below the history.
- **Global search** — `.global-search` with `.global-search-results` and
  `.global-search-result`, wired through `searchPalette.js`; opens from the topbar or with
  `Strg/Cmd + K`, searches both areas and current app content without an external service, and uses
  `.search-target-highlight` to expose a concrete result after navigation.
- **Seating status** — `.seating-status-indicator` sits directly after the gamer name and mirrors
  the shared live state as green „Spielt“, yellow „Pause“ or red „Offline“. Its German title and
  accessible label preserve the meaning beyond color. Playing and pause indicators pulse gently,
  while offline stays static; the global reduced-motion rule disables that motion when requested.
- **Tournament overview** — `.tournament-list-grid` shows at most two tournament cards per row;
  a single card stretches across the available width and further cards wrap. `.tournament-list-section` presents
  active and completed tournaments as two prominent status rows without separate summary-stat
  cards. `.tournament-player-grid` keeps the player picker at two cards per row, while
  `.tournament-detail-stats` and `.tournament-team-grid` expose real progress and roster information
  above a centered, locally scrollable bracket; team cards use at most two columns. The proposal
  grid follows the same two-column cap and uses draggable `.tournament-drag-player` rows, with
  touch selection and keyboard arrows as equivalent input paths. The create form separates
  „Auslosung“ from „Modus“ through reusable bordered `.tournament-section-panel` sections with a
  restrained accent rail instead of numbered badges. The same section pattern groups each
  tournament group with its table and rounds. Result controls remain compact and decided matches
  expose an explicit edit action. The standard `.section-title` introduces „Lobby-Zugang“ while
  `.tournament-lobby-info` presents lobby name and password as a prominent access card below it.
  Each credential uses a centered label/value/action grid and provides Lucide's `copy` action with
  a full touch target.
  A separate „Turnierstatus“ section groups the team, participant and decided-match counters so
  they remain visually distinct from the lobby card.
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
  buttons, status badges, chips, empty states or toasts. The Respawn logo is the
  intentional exception; user-authored content such as game names may contain emoji.
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

```js
// Shared avatar color palette — import, don't hardcode a new hex array.
import { AVATAR_PALETTE } from '../avatarPalette.js';
const color = AVATAR_PALETTE[i % AVATAR_PALETTE.length];
```

## Do / Don't

| Don't | Do |
|---|---|
| `style="color:#2563eb;"` | `style="color:var(--accent);"` |
| `style="padding:16px;"` | `style="padding:var(--space-4);"` |
| `style="font-size:0.8rem;"` | `style="font-size:var(--font-size-xs);"` |
| `style="border-radius:999px;"` | `style="border-radius:var(--radius-full);"` |
| `const PALETTE = ['#5b8cff', ...]` in a new view file | `import { AVATAR_PALETTE } from '../avatarPalette.js';` |
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

- **`analytics.js`'s Arcade timeline chart** (`renderArcadeTimelineChart`) — its 2px bar
  corner-radius is sized against the chart's own thin bars, not the radius scale.
- **`.dt-time-select`** and the native `select` chevron padding (`style.css`)
  — the wider side clears each element's own chevron icon; the 11px vertical
  rhythm matches the other inputs' `11px var(--space-3)` padding exactly, it's
  just not itself a token value.
- **Avatar sizes at `avatarHtml()` call sites** — real, intentional variety
  (18px inline chips up to 64px on the profile hero); see "Avatar sizes"
  above.
- **Three glow shadows** (topbar logo icon, the login-screen logo splash, the
  active nav icon) — each tuned to a different blur/alpha for a
  different-sized element; see "Shadows" above.

Everything else that was off-scale (values like 6px, 10px, 14px sitting
between two spacing steps) has been rounded onto the scale.

## Automated check (pre-commit)

`server/scripts/check-design-tokens.js` runs automatically on every commit
(installed via `npm install` → the `prepare` script wires git to
`.githooks/pre-commit`). It only looks at the **added lines** of the staged
diff under `server/public/**/*.{css,js}` — not the whole codebase — so it
enforces the rule going forward without requiring every existing off-scale
value to be fixed or allowlisted first.

It blocks a commit that introduces:
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

Because the script reads the staged diff, an unstaged change may produce no finding.
Before relying on the result, review the complete working diff as well. Do not stage
unrelated user changes merely to make the checker inspect them. CI or review should run
the same command on the intended change set; the same-line `design-token-ok` escape hatch
always requires a concrete reason, never a generic suppression.

GitHub Actions checks the full branch range with
`npm run check:tokens -- --base-ref <base-sha>`. The explicit base is required in CI:
a clean checkout has no staged diff, so the default pre-commit mode would otherwise inspect
nothing and produce a misleading success.

## UI review checklist

- [ ] Existing tokens, helpers and base components are reused where appropriate.
- [ ] No new raw color, spacing, radius or font values exist without a documented
  `design-token-ok` reason.
- [ ] Icons come from `icons.js`; icon-only controls have accessible German names.
- [ ] Loading, empty, error, disabled and long-content states remain clear and stable.
- [ ] The flow works with keyboard, visible focus, pointer and touch interaction.
- [ ] Meaning is not color-only; reduced-motion and hover media rules are respected.
- [ ] Phone and laptop layouts were checked, including browser zoom and long German text.
- [ ] `check:tokens`, build, unit/integration tests and E2E tests are green, or the
  unexecuted check and its remaining risk are explicitly reported.
