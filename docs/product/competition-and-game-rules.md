# Produktregeln: Wettbewerb und Spiele

Diese Datei enthält die aus dem Designkern verschobenen Regeln zu Match, Spielen, Vote und Turnieren. Gemeinsame Control-, Modal- und Auswahlverträge bleiben unter [Frontend-Verträgen](../../server/frontend-contracts/README.md).

## Auswahlentscheidungen

- **Mode / setting choice** — pick the widget by the shape of the decision, not by habit: a native
  `<select>` for three or more mutually exclusive named options (tournament format); the
  `.btn`/`.btn-primary` two-or-three-way toggle (`aria-pressed`, usually inside `.selection-toolbar`)
  for a plain either/or choice with no competing primary action nearby (Team formation's
  Auslosung/Captain Draft, Checkliste's tabs, the To-Do dialog's Art/Zuweisen-an); the Arcade
  section's `.arcade-mode-toggle` segmented pill only when the toggle sits directly beside a primary
  gradient CTA it must not visually compete with; a plain checkbox only for an independent on/off
  flag (Hin-/Rückspiel, Punktestand tracken, Sitznachbarn), never for a named exclusive
  choice among alternatives.
## Kartenfooter-Aktionen

- **In-card footer actions** — `.card-footer-actions` sets a card's primary action(s) off from a
  long preceding list (vote game rows, player-selection grids) with a hairline top border. It
  scrolls with the rest of the card like any other content. Used for the open vote round's
  submit/cancel/beenden stack and the „Abstimmung starten“ action in Vote, and the „Teams
  auslosen“/„Draft starten“ actions in Team formation and Tournament creation. This replaced an
  earlier `position: sticky` treatment (issue #557) that pinned the bar to the bottom of the
  viewport while its card scrolled through: the pinned bar briefly covered whatever list row
  scrolled past behind it, which read as more disruptive than just scrolling a little further to
  reach the button.
## Teams, Skill und Spielkatalog

- **Team formation** — the „Teams“ tab of the „Match“ area. The view first asks for game and mode: one shared `<select>` picks the
  game, followed by a `Modus` toggle (two `.btn`/`.btn-sm` buttons, `.btn-primary` marking the active
  one, `aria-pressed` conveying state beyond color) choosing between „Auslosung“ and „Captain Draft“.
  Only the chosen mode's `.tournament-section-panel` renders below — the two workflows never compete
  for space — while the shared game picker and the loaded history stay visible regardless of mode.
  Draw participants and draft participants are independent `.tournament-player-grid` checkbox
  selections; captains are then chosen only from the prepared draft roster. In Desktop mode these
  Match-specific player grids use three equal columns; Laptop and phone keep the existing responsive
  one/two-column fallback. One tooltip beside
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
## Arcade

- **Arcade** — The launcher follows the grouped-page hierarchy with separate full-width cards for
  „Spiele“, optional running games, the selected game and „Statistiken“.
  The game grid remains the first visible group with or without a selection. Once a game is selected,
  its lobby group follows directly below the grid; there is no separate „Spielauswahl“ back action.
  The selected game is represented by `#arcade/<spiel>` so browser back/forward, reload and the
  highlighted game tile agree. That route refines the launcher in place rather than opening a
  sub-page: the tile grid stays exactly where it is, so switching games keeps the reader's scroll
  position and focus and does not replay the view-enter animation — on a phone a reset to the top
  read as a full reload of the page. The Arcade route declares this through `inPlaceLocalRoutes`
  in `viewManifest.js`; a local route that replaces the whole page (Turniere's list becoming a
  tournament board) leaves the flag off and keeps entering like any other screen.
  Selecting a game is not a toggle: clicking the already active tile
  keeps the selection and route unchanged. The active tile keeps `.is-active` and carries
  `aria-current="page"` rather than `aria-pressed`; the route `#arcade` via browser back remains
  the only way to return to the unselected launcher.
  Game choices are horizontal nested cards with their Lucide game icon, name and an explicit
  „… offen“ lobby badge; they form one column on phones, exactly two from `--bp-md` and three in
  desktop mode from `--bp-xl`. Running
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
  insets across every game. On phones the primary action forms the full-width first row. The mode
  and opponent switches form the second row in that order and split its available width evenly;
  every label stays inside its segment. Below the minimum width documented in the
  [Controls contract](../../server/frontend-contracts/components/controls.md), each switch receives its own row.
  Tetris, Pong, Snake and
  Blobby Volley all select Duell by default. A disabled „Lobby
  öffnen“ or „Start“ carries the same red `.info-tooltip-trigger--warning` reason pattern as Team
  formation's „Teams auslosen“/„Draft starten“.
  Blobby Volley and Pong both offer Duell (1 gegen 1) and Doppel (2 gegen 2) through the same
  segmented switch, without a separate mode label or explanatory tooltip. Doppel lobbies expose
  two explicit teams with two slots each, require all four participants to be ready and award the
  shared team score and win to both teammates. Pong follows Atari's Pong-4 rules: each participant
  controls a separate paddle that remains in its assigned upper/lower half, player initials and roster
  lane labels identify all four paddles, and Doppel defaults to 21 points. Each Doppel paddle is
  shorter than a Duell paddle so four defended lanes do not make rallies automatic. The ball gains
  speed continuously during a rally as well as on paddle contact; the browser predicts the short
  interval between authoritative server snapshots so that this higher speed still renders smoothly.
  Both games reach a Doppel AI match through the same two switches — „Doppel“ plus „KI“ — where
  the host and one bot teammate play against two bot opponents.
  Statistics use the concise title „Statistiken“ and one full-width game dropdown whose options
  include each game's match count. Picking a game tile above auto-syncs this dropdown to the same
  game (matched by its own gameType/statsKey) so its stats show without a second, redundant
  selection; a manual dropdown choice stays in place until the tile selection above changes again.
  The selected game is not repeated above its results. Those
  results follow directly without another enclosing card or accent rail; player rows reuse
  `.leaderboard-list-grid` for the shared one-/two-column ranking presentation, gain a third column
  in desktop mode from `--bp-xl` and spell out wins and losses in German. Tetris Duell and Tetris
  Arena are separate dropdown entries so an Arena's
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
  without relying on color; the same legend appears in player, spectator and kiosk contexts. The
  local match view names the current participant's color in a large full-width banner from the start.
  The same color and snake number appear in the countdown itself, whose translucent overlay leaves the
  board unblurred so players can orient themselves before movement begins.
  Snake uses a 48×30 logical field in the existing 8:5 canvas, making cells and snakes smaller in
  relation to the available play area without shrinking the visible board.
  Challenge Rush is a human lobby without an AI-opponent switch. Admin mode only adds the exact
  test-challenge selection. Its deliberately reduced catalog contains 21 challenges: two direct
  interactions (reaction circle and ten-second stop), eighteen choice-based logic trials and one
  memory-matrix trial. These three interaction shapes share the same lobby, round, pause,
  reconnect and result lifecycle.
## Vote und Turniere

- **Voting** — The page titles are the concise navigation labels „Teams“ and „Vote“. Vote uses the
  same card grouping as the other polished workflows without an accent rail.
  New/current-round controls come first. The new-round form keeps its searchable full game list
  directly visible and deliberately offers no additional genre filter. Draft selection, query,
  focus and scroll survive same-view renders. Separate full-width cards for „Letzter Vote“
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
  Vote-specific empty states center their copy vertically in both overview and history.
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
