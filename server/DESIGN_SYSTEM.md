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
reference it elsewhere.

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
tied to something specific that a shared token would distort — a chart bar's
corner radius scaled to its own height, a splash-screen glow sized for a much
bigger logo than the token set's normal icon, an avatar deliberately larger or
smaller than the three standard sizes for its specific context. When in
doubt: if reusing the nearest token would look wrong, leave a short comment
explaining why instead of forcing it.

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
