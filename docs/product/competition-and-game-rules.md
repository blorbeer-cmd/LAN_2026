# Produktregeln: Wettbewerb und Spiele

Diese Datei enthält die aus dem Designkern verschobenen Regeln zu Match, Spielen, Vote und Turnieren. Gemeinsame Control-, Modal- und Auswahlverträge bleiben unter [Frontend-Verträgen](../../server/frontend-contracts/README.md).

## Auswahlentscheidungen

- **Mode / setting choice** — pick the widget by the shape of the decision, not by habit: a native
  `<select>` for three or more mutually exclusive named options (tournament format); the
  `.btn`/`.btn-primary` two-or-three-way toggle (`aria-pressed`, usually inside `.selection-toolbar`)
  for a plain either/or choice with no competing primary action nearby (Team formation's
  Auslosung/Captain Draft, Checkliste's tabs, the To-Do dialog's Art); the Arcade
  section's `.arcade-mode-toggle` segmented pill only when the toggle sits directly beside a primary
  gradient CTA it must not visually compete with; a plain checkbox only for an independent on/off
  flag (Hin- & Rückrunde, Punktestand tracken, Sitznachbarn), never for a named exclusive
  choice among alternatives.

## Kartenfooter-Aktionen

- **In-card footer actions** — `.card-footer-actions` sets a card's primary action(s) off from a
  long preceding list (vote game rows, player-selection grids) with a hairline top border. It
  scrolls with the rest of the card like any other content. Used for the „Teams auslosen“/„Draft
  starten“ actions in Team formation and Tournament creation; Vote's open round uses the Umfrage
  footer instead. This replaced an
  earlier `position: sticky` treatment (issue #557) that pinned the bar to the bottom of the
  viewport while its card scrolled through: the pinned bar briefly covered whatever list row
  scrolled past behind it, which read as more disruptive than just scrolling a little further to
  reach the button.

## Teams, Skill und Spielkatalog

- **Team formation** — the „Teams“ tab of the „Match“ area. The view first asks for game and mode: one shared `<select>` picks the
  game, followed by a `Modus` toggle (two `.btn`/`.btn-sm` buttons, `.btn-primary` marking the active
  one, `aria-pressed` conveying state beyond color) choosing between „Auslosung“ and „Captain Draft“.
  Only the chosen mode's form renders below, flat inside the same card (no nested panel and no
  accent rail, because only one mode is ever visible) — the two workflows never compete for space —
  while the shared game picker and the loaded history stay visible regardless of mode. The mode
  toggle already names the open mode, so the form carries no visible repeated heading.
  Draw participants and draft participants are independent `.tournament-player-grid` checkbox
  selections; captains are then chosen only from the prepared draft roster. In Desktop mode these
  Match-specific player grids use three equal columns; Laptop and phone keep the existing responsive
  one/two-column fallback. One tooltip directly beside
  the „Captain Draft“ toggle explains the complete participant/captain/pick sequence; the Captains label has no
  duplicate tooltip or empty-state instruction. `.captain-selection-group` keeps its label close to
  the associated player grid. Both selections use the standard checkbox-card state without an
  additional selected-card highlight. „Teams auslosen“ and „Draft starten“ are compact gradient buttons at the bottom
  right; the lone „Sitznachbarn“ option carries no list-row hairline, so only the footer divider
  separates it from the action. The captain action stays labeled simply „Draft starten“ without repeating participant counts already visible in the
  selections. The draw and draft participant grids each show a visible, named search field
  („Spieler suchen“) that filters rows without changing hidden selections; the draft field also
  filters the captain list, which has no search field of its own. A single bulk toggle selects all
  visible rows, or deselects them when every visible row is already selected. Switching modes keeps both selections and search
  terms intact, so toggling back and forth loses no work.
  „Teams auslosen“ and „Draft starten“ share one rule: each stays disabled until its minimum
  (2 selected players; 2–4 captains plus at least 1 pool player) is met, and a red
  `.info-tooltip-trigger--warning` beside the disabled button names the exact missing requirement —
  disabled actions stay understandable instead of silently ignoring a tap. The remaining live-draft
  participants appear under the heading „Spieler“ in the same full-width player cards instead of
  chips; the drafted teams are introduced by the parallel heading „Captains“. Decorative draft icons
  and the redundant local-turn hint are omitted. The live draft offers a compact neutral
  „Abbrechen“ beside its „Live“ badge in the card header; the confirmation dialog still names the
  destructive „Draft abbrechen“.
  Every player row in both setup flows, the live draft and the drawn teams shows the shared activity
  icon followed by the selected game's `0–5` skill value; in the rating-balanced draw a missing
  self-rating shows the matchmaking fallback in parentheses, so the visible value matches the one
  the draw balanced with, while the captain draft keeps the en dash because it never uses ratings.
  The title and accessible label retain the full term „Skill-Level“.
  Open draws and recorded results share one newest-first „Historie“ because they are two states of
  the same lineup. It starts collapsed through the shared collapsible-section component. Every
  history card repeats its game name. A fresh draw appears under the heading „Neue Auslosung“; a
  finished Captain Draft becomes the fresh draw on every device the same way.
  The winning team carries the green „Win“ chip and an accessible group label, the losing teams
  are muted and a drawn result shows „Remis“. Card actions sit in the card header: an open draw
  offers a neutral „+“ for a single result and, rightmost, „Turnier erstellen“ (the primary
  gradient on the fresh draw, neutral in Historie); a recorded draw offers „Rematch“ and a pencil;
  a draw that became a tournament offers only a button named after its tournament that opens it.
  „Turnier erstellen“ opens one compact dialog: Turnierformat, the group fields for „Gruppenphase +
  K.O.“, one name field per team (a drafted team is prefilled as „Team <Captain>“, a drawn one as
  „Team 1“ …), the options side by side and the optional lobby base name and password. The server
  claims the draw in the same transaction that creates the tournament, so one lineup becomes either
  a single result or a tournament, never both (`409` for the loser of a race). Recording and editing share one compact result dialog: one
  button per team plus „Unentschieden“ saves immediately, or „Mit Werten eintragen“ takes one value
  per team from which the winner (unique highest value) and the places follow. An empty value field
  counts as its „0“ placeholder; only a dialog without any entered value is rejected. Editing updates the
  existing match instead of creating a duplicate result, and „Rematch“ opens the same dialog. The
  free result form with game choice and „Frei-für-alle“ stays in Auswertung.
  A drawn lineup moves players by drag and drop on desktop; touch and phone layouts additionally
  show a native team picker per player row. There is no tap-to-select highlight of other teams.
  Successful seat-neighbor grouping stays silent; a note appears only when requested seat neighbors
  still had to be placed in opposing teams.
- **Player skill display** — `skillDisplay.js` renders the shared activity icon plus the selected
  game's skill value. Teams and Tournaments reuse it in participant selection, drawn-team previews,
  live drafts, histories and tournament detail teams; the icon's tooltip and accessible label
  retain the full „Skill-Level“ meaning. Two call-site options decide what an honest value is:
  - `balanced` (default `true`) — the shown teams really were built from these ratings. A player
    without an own rating then shows the neutral matchmaking fallback dimmed and in parentheses
    (`.rating-unrated`, `3`, mirroring `DEFAULT_RATING` in `src/routes/matchmaking.ts`) instead of
    an en dash, because that is the value the draw balanced with; the team header's total includes
    those fallbacks and appends the dimmed parenthesized count of unrated players. Changing the
    server-side fallback requires updating `UNRATED_SKILL_VALUE` in the same work item so the shown
    totals cannot drift away from the balancing again.
  - `balanced: false` — the captain draft, which picks by turn order and never reads ratings
    (`src/routes/draft.ts`). Its values are purely informational for the picking captain, so a
    missing rating stays an en dash („Noch kein Skill-Level eingetragen“) and neither the row nor
    the total claims that anything counted with `3`. This covers the live draft board, the draft
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
  „Spiel vorschlagen“ is the compact gradient action at the right end of the tab row; below
  `--bp-sm` it collapses to a square „+“ with the same accessible name so it still fits beside the
  three tabs. The „Spiel vorschlagen“ form exposes the same game metadata that can later be edited: title,
  platform and its link, YouTube gameplay link, genres, additional info and the seat-neighbor
  default. Process-name mappings remain an admin-only management action because they control
  automatic game detection on participant computers.
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
  Bock and Skill are rated with the shared 0–5 number scale (`ratingScale.js`) that Vote and
  Umfragen use: six square buttons below the label, the chosen one outlined. No selected number
  means "no rating yet"; 0 is a deliberate answer (for Bock „kein Bock“) and counts as rated. A
  press saves immediately and keeps keyboard focus on the pressed number. Existing 1–10 ratings
  were halved and rounded up onto this scale. Unlike the team views, where a missing rating still
  enters the draw as the parenthesized fallback, the own-rating scale shows no number at all. Two independent chip
  filters, „Bock offen“ and „Skill offen“, narrow the list to games the current identity hasn't
  rated yet on that facet; both active at once is an AND, unlike the genre chips'
  OR-within-one-facet semantics.
  The first-login onboarding uses the same catalog rows in a temporary rating mode. The first ten
  required games are marked with the textual `Pflicht` badge and an accent rail; the list can be
  expanded to all catalog games, but completion still requires both ratings for the required set.
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
  and „Top 10 nach Bock-Level“; the Top 10 card is collapsible and starts closed.
  An open round and every closed result use the same presentation as an Umfrage with a hidden
  interim result (see „Umfragen“ in [Organisation](organisation-and-event-rules.md)), minus the
  poll-only parts: no response-mode tag, no „Neue Runde“ and no „Wieder öffnen“. The open round is
  one `.event-poll-card` whose header names the round, the participation („X/Y abgegeben“, updated
  through the existing realtime refresh) and the viewer's own state („Abgegeben“ or „Deine Stimme
  fehlt“); admins get a compact „Beenden“ beside an „Aktion“ menu holding „Abbrechen“. A
  „Zwischenstand verborgen“ tag and the round info follow. Games are listed alphabetically, one
  Umfrage option row each: name and one compact meta line without empty values, the empty result
  and voter columns of a hidden interim result, and the same 0–5 number scale as an Umfrage rating
  as the answer control. No selected number means unrated; pressing the chosen number again clears
  it. 0 is a deliberate rating, marked „Spiele ich nicht“ in the voter column. The footer shows the
  own progress („X von Y bewertet“), the „Unbewertet“ chip that narrows the list to still-unrated
  games, and „Speichern“, enabled once every game is rated. A runoff offers the Umfrage
  „Wählen“/„Ausgewählt“ choice instead of numbers. „Letzter Vote“ is a collapsible Umfrage card
  that starts collapsed and keeps its open state across live re-renders; its header names the
  round, date, participation and winner and always offers „Stimmen ansehen“ and, on a tie, a
  compact „Stichwahl starten“. Opened, it lists every game of the round sorted by score, each with
  its result bar, „N Pkt. · X/Y spielen mit“ (voters who gave at least one point, out of everyone
  who voted) and the avatars of those voters; winners carry the green „Win“ chip, tied winners
  each carry it. „Stimmen ansehen“ — in that header, on every history row and behind each avatar
  stack — opens the Umfrage vote table: numbered legend with each game's summary, one row per
  voter with their points, a 0 shown as „Spielt nicht“. History lists only the rounds before the
  latest one as compact Umfrage history rows (title, date, participation, winner).
  The Top 10 form two ordered five-item columns from `--bp-md`, while phones keep one continuous
  list. The new-round form's `.vote-game-grid` keeps one column on phones, two from `--bp-md` and
  three from `--bp-xl`, with the same bordered card treatment at every size.
  Vote shows no info tooltips. Title, info and the game search („Spiel suchen“) with the bulk toggle
  share one row of equal-width parts from `--bp-md` and stack on phones; title and info have the
  same control height. „Starten“ is a compact primary action in the new-round card header.
  Starting a round always shows its game selection grid — there is no separate checkbox gating it.
  It preselects the current Top 10 by Bock as a starting point, same as before; a round covering
  everything simply uses the bulk toggle or clears the remaining exclusions by hand. The grid
  reuses the same single bulk toggle (`.selection-toolbar-icon`) and visible named search field
  (`selectionSearchHtml`) as Team formation's and Tournament creation's player pickers. Search
  filters the visible rows while hidden checkbox selections remain intact; the bulk toggle applies
  only to the currently visible intersection. That grid, an
  unrestricted round's ballot and „Top 10 nach Bock-Level“ all cover the accepted games only;
  suggestions are not votable (see „Game catalog“). A suggestion's own Bock ranking stays visible
  in the Spiele view, which sorts by Ø Bock on every tab. A round keeps the exact games it was
  started with for its whole life: a game demoted mid-round keeps the votes already cast for it,
  stays votable for everyone else and can still win, and „Stichwahl starten“ still offers every
  tied winner of the closed round. Only a fresh selection is restricted.
  Vote-specific empty states center their copy vertically in both overview and history.
  A points ballot rates every game of the round with 0 to 5 points; the server rejects empty or
  incomplete ballots with `400`. Until the round ends, every identity can change and save its
  ballot again: each submission atomically replaces that identity's earlier one, so double taps
  and concurrent devices leave exactly one ballot. Who voted how stays hidden from everyone while
  the round is open and becomes visible to the event's participants once it is closed.
  A cancelled round is deleted together with its votes and the next round may reuse its number, so
  the client tells rounds apart by number and start time and never carries a cancelled round's
  ballot over.
  Vote history is labeled simply „Historie“, uses the shared icon-free collapsible header, starts
  closed and retains its open state across live re-renders.
- **Tournament overview** — the „Turniere“ tab in the „Match“ area, whose first/default tab is
  „Teams“; switching back to „Turniere“ from the tab row always returns to the
  list rather than the tournament board that was last open. Tournaments have no creation form of
  their own: every tournament starts from a draw or Captain Draft on „Teams“ (see „Team
  formation“), so the list's „Turnier anlegen“ action leads there and a legacy `#tournaments/new`
  link opens the list. A tournament's own detail page keeps
  the area tabs above it, titles itself with an `h2` and needs no „Zurück“ action; a compact neutral
  „Löschen“ sits beside the title while its confirmation dialog keeps the danger meaning. The page never carries two `h1` headings. `.tournament-list-grid` shows at most two tournament cards per row;
  a single card stretches across the available width and further cards wrap. `.tournament-list-section` presents
  active and completed tournaments as two prominent status rows without separate summary-stat
  cards and with the standard gap between them. Tournament cards show the progress of a running
  tournament („X/Y Partien“) and the winner of a completed one („Sieger: …“). The completed row
  uses the shared collapsible-section presentation with a vertically centered header, starts
  collapsed and retains its open state across view re-renders.
  The detail page's meta line carries format, options, team and player counts and the decided
  matches („4 Teams · 15 Spieler · 0/3 entschieden“) instead of separate counter tiles. Below it
  follow „Aktive Lobbys“, the results and a collapsible „Teams“ card with its team count that
  starts closed and keeps its open state; team cards use at most two columns. Tournament results use plain cards without
  accent rails: a knockout bracket card, stacked „Tabelle“ and „Spielplan“ cards for a league, and
  one card per group with its table and rounds plus a „K.O.-Runde“ card. Fixtures read like a
  scoreboard (home team right-aligned, result chip centered, away team left-aligned); winners are
  emphasized and losers muted, with a green winner score or a „‹ Win“/„Win ›“ chip without a score.
  Tables show #, Team, Sp, S, U, N, +/− (only with scores) and Pkt; advancing group teams carry a
  „weiter“ marker. Every result action sits in a fixed trailing slot („+“ open, pencil recorded)
  and opens one shared result dialog: two score fields (an empty one counts as its „0“ placeholder,
  but at least one must be filled), or one button per team plus
  „Unentschieden“ (not in knockout matches) that saves immediately. A decided final adds a
  „Sieger“ box in the primary gradient beside the bracket. The last result completes the
  tournament automatically (no separate „Beenden“ action): a toast names the winner and the
  detail page then leads with a „Turnier beendet“ card showing the winning team (knockout final
  winner, or the league leader) with its „Win“ chip and players. „Aktive Lobbys“ is one card with its
  heading inside; each currently playable pairing is a flat hairline row with the matchup, a muted
  line naming phase and hosting team („Halbfinale · Team 1 eröffnet“) and, on the right, the lobby
  name and password as non-wrapping code chips with equal-width labels. A stored lobby base name
  receives a deterministic phase/round/match suffix, so parallel pairings always have distinct
  lobby names without mutable lobby assignments. League and group modes show only the earliest
  unfinished round; knockout modes show every open match whose two teams are known. Each credential
  provides Lucide's `copy` action with a full touch target. Tournament details show no info
  tooltips.
  Bracket matches keep a fixed height with an internal trailing action column. Tournament details
  show the full format configuration as plain text (for example „Liga · Hin- & Rückrunde ·
  Punktestand“). Tournament overview cards use the compact format names without explanatory
  parentheses.
