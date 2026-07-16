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
`--seating-seat-width` / `--seating-seat-height` and their compact counterparts keep every place
around the physical seating plan the same size; the compact size preserves that equality on phones.
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
- **Collapsible section** — `.collapsible-section` uses a native `details` element with
  `.collapsible-section-header`, a count/status badge and `.collapsible-section-chevron`. It is the
  standard presentation for collapsed histories, completed tournament lists and closed order
  cards: a full bordered card whose chevron rotates when opened. Section-specific content lives in
  `.collapsible-section-content`; decorative heading icons are omitted.
- **Seating status** — `.seating-status-indicator` sits directly after the gamer name and mirrors
  the shared live state as green „Spielt“, yellow „Pause“ or red „Offline“. Its German title and
  accessible label preserve the meaning beyond color. Playing and pause indicators pulse gently,
  while offline stays static; the global reduced-motion rule disables that motion when requested.
  Every `.seating-seat` uses the same width and height on all four table sides, so vertical sides
  no longer stretch into wide rows. Phones switch all four sides to one shared compact size and
  keep exceptionally narrow layouts locally scrollable instead of widening the page.
- **Team formation** — the Teams view places „Auslosung“ and „Captain Draft“ inside one main card
  as equal `.tournament-section-panel` sections with the shared accent rail. Draw participants and
  draft participants are independent `.tournament-player-grid` checkbox selections; captains are
  then chosen only from the prepared draft roster. One tooltip beside „Captain Draft“ explains the
  complete participant/captain/pick sequence; the Captains label has no duplicate tooltip or empty-state
  instruction. `.captain-selection-group` keeps its label close to the associated player grid.
  Both selections use the standard checkbox-card state without an additional selected-card highlight.
  The captain action stretches like the draw action and stays labeled simply „Draft starten“ without
  repeating participant counts already visible in the selections.
  One shared game picker sits above both sections and controls draw, draft and the loaded history;
  it does not visually belong to either workflow. The remaining live-draft participants appear under
  the heading „Spieler“ in the same full-width player cards instead of chips; the drafted teams are
  introduced by the parallel heading „Captains“. Decorative draft icons and the redundant local-turn
  hint are omitted.
  Every player row in both setup flows, the live draft and the drawn teams shows the shared activity
  icon followed by the selected game's `1–10` skill value; an en dash makes a missing self-rating
  explicit instead of silently presenting the matchmaking fallback as a real rating. The title and
  accessible label retain the full term „Skill-Level“.
  Open draws and recorded results share one newest-first „Historie“ because they are two states of
  the same lineup. It starts collapsed through the shared collapsible-section component. Every
  history card repeats its game badge and name. Recorded results omit a status badge;
  `.matchmaking-draw-team.is-winner` identifies the winner through a reinforced border and an
  accessible group label. „Ergebnis bearbeiten“ opens a correction form for winner, value and
  placement and updates the existing match instead of creating a duplicate result. On recorded
  history cards, „Rematch“ is the primary action while editing remains visually secondary.
  Successful seat-neighbor grouping stays silent; a note appears only when requested seat neighbors
  still had to be placed in opposing teams.
- **Player skill display** — `skillDisplay.js` renders the shared activity icon plus the selected
  game's current self-rating, or an en dash when no rating exists. Teams and Tournaments reuse it
  in participant selection, drawn-team previews, live drafts, histories and tournament detail teams;
  the icon's tooltip and accessible label retain the full „Skill-Level“ meaning. Team headers show
  the same icon with a dynamically calculated total; missing ratings contribute `0`, stated
  explicitly in its tooltip and accessible label.
- **Player profiles** — The roster is public and opens read-only details for other participants.
  The current device identity is marked as „Mein Profil“ and opens the dedicated self-service
  profile editor. Foreign profiles expose neither edit/delete actions nor the private agent key;
  the API omits the private agent key and rejects profile-field updates when `x-player-id` does not
  match the target player.
  The roster itself has no duplicate „Teilnehmende“ heading and no player-creation action. Player
  creation stays deliberately deferred until authenticated user management owns that workflow.
  This device-local identity header is deliberately documented as the temporary boundary that
  future authenticated user management must replace. The self-service profile uses the shared
  grouped-page hierarchy for profile data, Agent setup, Push, visible monitors and personal stats.
  Agent setup is split into three stable nested cards for choosing tracking, downloading and
  installing; tracking pause belongs to the first step beside foreground-activity tracking, and
  both explanations live in contextual tooltips beside their checkboxes. The profile header owns
  its spacing to the first group. Bild, Farbe, Gamertag and optional name form one aligned row from
  `--bp-md`; phones wrap the two text fields below the visual controls. The shared save action stays
  below that row. The foreground option uses the concise label „Erweitertes Tracking“. Push uses the same checkbox language with its
  explanation in a tooltip instead of an action button and omits a redundant off-state sentence.
  Visible-monitor choices form exactly two columns from `--bp-md`, with phones kept to one column.
- **Settings and admin tools** — Settings uses separate grouped cards for Events, the invitation
  link and the TV/Kiosk view. Their concise explanations live in contextual tooltips beside each
  heading. Event cards use the standard two-column nested-card grid. Invitation link, copy action
  and QR action share one compact row at one shared control height; the QR code opens in the shared centered modal rather than expanding
  the settings page. Backup and seating-plan editing are absent from regular settings and live
  together as nested tool cards in the active Admin mode. Each tool card keeps its title, adjacent
  help tooltip and colorful primary action on one row; the seating editor returns to Admin and blocks
  editing outside that mode. Dense 2015–2026 Hall-of-Fame fixtures ship with the local test data and
  need no separate Admin action. The test-data fixture explanation and the existing test-player count live in adjacent
  tooltips; the compact count input, „Test-Daten aufräumen“ and create action share one control row
  in that order. Cleanup removes every marked test player and test LAN
  without touching real events.
  The seating editor follows the same grouped-page hierarchy: the editable plan comes first, followed
  by „Spieler“ and „Konfiguration“. Unassigned players use the shared rectangular two-column player
  rows instead of pills; phones keep one column.
- **Kiosk dashboard** — Kiosk is a fixed, read-only TV canvas with no page or card scrollbars. Its
  four primary cards remain a 2×2 grid and distribute live players, rankings, tournament standings,
  groups and matches across internal columns. Vote status is a centered icon/text stack. Only the
  newest active system notification appears above the dashboard as one full-width brand-gradient
  banner; separate food-order summary cards are omitted because order pushes already use that banner.
  Tournament content is centered vertically and horizontally inside its card and uses a metadata row
  plus bordered standing, group or match cards with textual winner states, matching the main app's
  nested-surface hierarchy.
- **Grouped page sections** — `.grouped-page-sections` stacks the page's major areas with the
  shared vertical rhythm. Every `.grouped-page-section` is a full-width `.card`; its visible
  heading lives inside the surface through `.grouped-page-section-title`, while filters and
  subordinate rows remain part of that same group. This is the default hierarchy for overview
  pages with several related datasets instead of headings that float between unrelated cards.
  Nested `.card` surfaces use the secondary elevated background so their hierarchy remains visible.
  `.two-column-card-grid` keeps repeated cards in one column on phones and exactly two columns from
  `--bp-md`; a lone or final odd card spans the full row instead of leaving an accidental hole.
  The „Mehr“ hub keeps each destination's canonical icon directly beside its centered title so
  both read as one label; those icons are one spacing step smaller than standard list-row icons and
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
- **Food orders** — Open and historical orders use one full-width nested card per row so their
  metadata, player positions, add-item form, total and actions stay aligned regardless of content.
  Consecutive cards alternate blue and pink accent rails and omit decorative order, timer and link
  symbols. The responsive add-item row keeps description, explicit quantity, unit price with euro
  suffix and the compact action together. Item totals multiply unit price by quantity; clearly
  labeled subtotals per player and the order-wide total use consistent German currency formatting.
  Quantity starts empty with the explicit placeholder „Anzahl“ instead of implying one item.
  An absent send time is plain text without a misleading timer icon. Closing an order is the
  colorful full-width primary action below a divider; the compact neutral „Hinzufügen“ action does
  not stretch to the input height. Closed orders live inside one standard, initially collapsed
  „Historie“ section whose open state survives live re-renders.
- **Hall of Fame and Info** — Hall-of-Fame all-time rankings use the shared two-column leaderboard
  grid. „Nach LAN“ uses one directly labeled event dropdown and shows every overall placement for
  the selected LAN, followed by tournament winners in the same leaderboard-row structure. Blue and
  pink accent rails distinguish the two result groups; tournament game names have no decorative
  game symbols. Admin fixtures cover twelve years with full standings and three tournament winners per LAN so dense
  long-term states remain testable. The
  visible short name for the former Info-Board is „Info“ throughout navigation, search and the page
  itself; entries remain alphabetically sorted responsive two-column nested cards.
- **Arrival carpools** — Anreise and Abreise remain separate full-width accented panels. Their
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
  carpool cards, with the host's lobby name and player count in the header, stable player rows with
  role/readiness at the right, a direct join action in a free-slot row and host/member actions in a
  separated full-width footer. Host labels, free labels and join actions share an exact three-column
  grid and row height. A host's game settings belong inside that lobby card; the compact
  „Punkte bis Sieg“ control shares the separated footer with „Schließen“ and „Start“ from `--bp-md`
  instead of forming a wide radio-button block. Readiness is communicated in the player rows without
  a duplicate status sentence. „Lobby öffnen“ follows the lobby cards at full width, while the
  temporary „Gegen KI“ mode occupies its own full-width row below it. An empty lobby no longer adds
  a redundant waiting sentence. Member actions use the same destructive treatment for „Verlassen“
  as the host's „Schließen“ action. Guest footers place „Verlassen“ before the readiness toggle;
  compact score selectors use the smaller shared row height.
  Statistics use the concise title „Statistiken“ and one full-width game dropdown whose options
  include each game's match count. The selected game is not repeated above its results. Those
  results follow directly without another enclosing card or accent rail; player rows reuse
  `.leaderboard-list-grid` for the shared one-/two-column ranking presentation and spell out wins
  and losses in German.
- **Leaderboard** — The concise page title is „Rang“. The filtered „Rangliste“ and per-player
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
  their heading inside the surface. Tappable current items, the personal status and player entries
  remain nested cards on the secondary elevated background; „Gerade aktiv“ is a subsection of
  „Live-Status“ rather than a competing page-level group. Main groups stay in one continuous column
  at phone and laptop widths while their existing internal grids remain responsive.
- **Voting** — The page titles are the concise navigation labels „Teams“ and „Vote“. Vote uses the
  same card grouping as the other polished workflows without an accent rail.
  New/current-round controls come first, followed by separate full-width cards for „Aktueller Vote“
  and „Top 10 nach Bock-Level“. An open round exposes a bordered participation counter with the
  submitted and eligible-player totals, updated through the existing realtime refresh. The latest
  result and every history card show the ten highest-ranked games with the same compact rows and
  responsive columns as the Bock ranking; history keeps an explicit detail action for the complete
  bar view. Equal top scores use the same visible rank and a reinforced gold border on every tied
  row, so the shared placement remains understandable beyond the border color. The full-width
  „Stichwahl starten“ action sits at the bottom of the same „Aktueller Vote“ card without a
  redundant explanatory block or separate group.
  The Top 10 form two ordered five-item columns from `--bp-md`, while phones keep one continuous
  list. Game rows remain one
  column on phones and two from `--bp-md`, with the same bordered card treatment at both sizes.
  Explanations sit in info tooltips immediately beside their titles. Title and info fields start at
  the same control height; the optional game filter uses an aligned toolbar and consistent gaps.
  The participant action spans the full width, with equal-width „Abbrechen“ and „Beenden“ actions below.
  Vote-specific empty states center icon and copy vertically in both overview and history.
  Every identity can submit only once per round: the server enforces this atomically with `409`,
  empty points submissions are invalid, and the client replaces the submit action with a green
  „Bewertung/Stimme abgegeben“ state while locking that identity's controls.
  Vote history is labeled simply „Historie“, uses the shared icon-free collapsible header, starts
  closed and retains its open state across live re-renders.
- **Tournament overview** — `.tournament-list-grid` shows at most two tournament cards per row;
  a single card stretches across the available width and further cards wrap. `.tournament-list-section` presents
  active and completed tournaments as two prominent status rows without separate summary-stat
  cards. The completed row uses the shared collapsible-section presentation, starts collapsed and
  retains its open state across view re-renders. `.tournament-player-grid` keeps the player picker at two cards per row, while
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
