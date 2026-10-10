# Produktregeln: Wettbewerb und Spiele

Diese Datei enthält die aus dem Designkern verschobenen Regeln zu Match, Spielen, Vote und Turnieren. Gemeinsame Control-, Modal- und Auswahlverträge bleiben unter [Frontend-Verträgen](../../server/frontend-contracts/README.md).

## Auswahlentscheidungen

- **Mode / setting choice** — pick the widget by the shape of the decision, not by habit: a
  select for three or more mutually exclusive named options (a native `<select>` for the
  tournament format; the non-searchable shared select for the answer kind of Umfragen, whose list
  opens below the field like every other app dropdown); the
  `.btn`/`.btn-primary` two-or-three-way toggle (`aria-pressed`, usually inside `.selection-toolbar`)
  for a plain either/or choice with no competing primary action nearby (Team formation's
  Auslosung/Captain Draft, Checkliste's tabs, the To-Do dialog's Art); the Arcade
  section's `.arcade-mode-toggle` segmented pill only when the toggle sits directly beside a primary
  gradient CTA it must not visually compete with; a plain checkbox only for an independent on/off
  flag (Hin- & Rückrunde, Punktestand tracken, Sitznachbarn), never for a named exclusive
  choice among alternatives.

## Kartenfooter-Aktionen

- **In-card footer actions** — `.card-footer-actions` sets a card's primary action(s) off from a
  long preceding list (player-selection grids) with a hairline top border. It
  scrolls with the rest of the card like any other content. Used for the „Teams auslosen“/„Draft
  starten“ actions in Team formation and Tournament creation. Vote's start dialog and open round
  use the Umfrage footer (progress or selection count beside the primary action) instead. This replaced an
  earlier `position: sticky` treatment (issue #557) that pinned the bar to the bottom of the
  viewport while its card scrolled through: the pinned bar briefly covered whatever list row
  scrolled past behind it, which read as more disruptive than just scrolling a little further to
  reach the button.

## Teams, Skill und Spielkatalog

- **Team formation** — the direct „Match“ page. Running tournaments appear first with a clear gap before setup, including during a live Captain Draft. The setup asks for mode and game: a `Modus` toggle (two `.btn`/`.btn-sm` buttons, `.btn-primary` marking the active
  one, `aria-pressed` conveying state beyond color) choosing between „Auslosung“ and „Captain Draft“.
  One shared `<select>` picks the game to its right from tablet width onward; phones stack the two controls.
  Only the chosen mode's form renders below, flat inside the same card (no nested panel and no
  accent rail, because only one mode is ever visible) — the two workflows never compete for space —
  while the shared game picker and the loaded history stay visible regardless of mode. On wide views, game and mode share a row; the running-tournament cards use two columns. The mode
  toggle already names the open mode, so the form carries no visible repeated heading.
  Draw participants and draft participants are independent `.tournament-player-grid` checkbox
  selections; captains are then chosen only from the prepared draft roster. In Desktop mode these
  Match-specific player grids use three equal columns; Laptop and phone keep the existing responsive
  one/two-column fallback. One tooltip directly beside
  the „Captain Draft“ toggle explains the complete participant/captain/pick sequence; the Captains label has no
  duplicate tooltip or empty-state instruction. `.captain-selection-group` keeps its label close to
  the associated player grid. Both selections use the standard checkbox-card state without an
  additional selected-card highlight. „Teams auslosen“ and „Draft starten“ are compact gradient buttons at the bottom
  right; „Sitznachbarn“ sits directly to the left of „Teams auslosen“ on the same center line
  within the separated footer, wrapping as a whole option when space is insufficient.
  The captain action stays labeled simply „Draft starten“ without repeating participant counts already visible in the
  selections. The draw and draft participant grids each show a visible, named search field
  („Spieler suchen“) that filters rows without changing hidden selections; the draft field also
  filters the captain list, which has no search field of its own. A single bulk toggle selects all
  visible rows, or deselects them when every visible row is already selected. Switching modes keeps both selections and search
  terms intact, so toggling back and forth loses no work.
  „Anzahl Teams“ is capped at the number of selected draw players (never below its minimum of 2):
  a larger typed value snaps to that number, and deselecting players lowers an already-higher value
  with them. Reselecting players does not raise it again.
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
  Unplayed draws and running tournaments of the selected game have their own „Ohne Ergebnis“ section above „Historie“. It starts collapsed and builds
  its cards only when opened. Each unplayed game is also a collapsed tile that can be opened
  independently to show its teams and player moves. Recorded matches and completed tournaments share the „Historie“ for the selected game. It starts
  collapsed. The shared „Alle | Matches | Turniere“ filter row sits above „Ohne Ergebnis“ and applies
  to open draws, running tournaments and completed history. The running overview above setup is
  independent of these filters and always shows every running tournament.
  The independent „Meine“ toggle combines with each type and shows only entries whose teams include
  the signed-in player, regardless of who created them. It also scopes older Match pages before
  pagination. The filters remain visible when sections are collapsed or have no matching entries.
  Filter changes keep disclosure state. Match pages can load older entries;
  tournament entries come from the complete tournament list. Every entry is a collapsed tile with
  game, time, result and actions in its header. Expanding a match shows teams by place without changing their
  stored indices, and each team's skill sum beside its name, never individual player skills. A fresh draw appears under the heading „Neue Auslosung“; a
  finished Captain Draft becomes the fresh draw on every device the same way.
  Draw teams have no stored name; cards, the team picker, the result dialog and the history derive it
  from the current lineup with the same rule, so a player move renames affected teams immediately.
  The winning team carries the green „Win“ chip and an accessible group label, the losing teams
  are muted and a drawn result shows „Remis“. Card actions sit in the card header: an open draw
  offers a neutral „+“ for a single result and, rightmost, „Turnier erstellen“ (the primary
  gradient on the fresh draw, neutral in the open section); a recorded draw offers a pencil before „Rematch“;
  every open or recorded game card offers admins and owners a trash action with confirmation; regular members see no delete controls, including on the tournament detail page. Removing a recorded draw removes its linked result from the ranking. A tournament tile offers „Turnier“ and, for admins and owners, a trash action using the existing tournament delete behavior; already recorded tournament matches remain in the ranking, and the confirmation explains this. Its expanded state shows tournament teams,
  players and available standings or match totals. A participating player's game title is bold in a collapsed Match tile; only their name is bold in expanded teams. Open draws show every player's skill. Completed tournament headers show the winning team with „Win“ and the tournament name; team details use the same compact place numbers as Match teams in the team-name line, including the finalist's second place, with an explicit place label in the title and accessible name. The number replaces the extra Win chip inside the team card; table points stay beside the team name. With a played third-place match, the semifinal losers carry places 3 and 4 the same way. Knockout exits without a distinct place appear in the context line below the players. The result pencil precedes „Rematch“; tournament actions
  need no empty action slot.
  „Turnier erstellen“ opens one compact dialog: Turnierformat, the group fields for „Gruppenphase +
  K.O.“, one name field per team (at most 30 characters; a team with a single player is prefilled with that
  player's name, a drafted team as „Team <Captain>“, a drawn one as „Team 1“ …), the options side by
  side („Hin- & Rückrunde“ for league-based formats, „Spiel um Platz 3“ for knockout-based formats,
  „Ergebnisse inkl. Punktestand“) and the optional lobby base
  name and password. „Spiel um Platz 3“ is off by default and needs four knockout teams: a pure
  knockout with fewer drawn teams does not offer it, and after a group stage with fewer advancers the
  server ignores it. When on, both semifinal losers meet for places 3 and 4, and the tournament
  completes only once the final and this match are decided. A league ignores it. The server
  claims the draw in the same transaction that creates the tournament, so one lineup becomes either
  a single result or a tournament, never both (`409` for the loser of a race). The server draws
  the first-round bracket pairings and the group split from a random team order; team numbering
  stays as entered, and the knockout after a group stage is seeded by group placement.
  Recording and editing share one compact result dialog: one
  „Sieger“ and „Punktestand“ modes share one form with tournaments and the free Admin result. A native
  single choice selects a team or „Unentschieden“ in equal-height cards with a subtle accent outline;
  switching modes keeps the dialog body height stable. Score rows show live places, with ties sharing a
  place. The unique highest score wins. Empty score fields count as 0, but a completely empty score
  form is rejected. Both modes save only after „Speichern“. Editing opens the saved mode and updates the
  existing match instead of creating a duplicate result, and „Rematch“ opens the same dialog. The
  free result form with game choice and „Frei-für-alle“ stays in Auswertung.
  A drawn lineup moves players by drag and drop on desktop; touch and phone layouts additionally
  show a native team picker per player row. There is no tap-to-select highlight of other teams.
  Successful seat-neighbor grouping stays silent; a note appears only when requested seat neighbors
  still had to be placed in opposing teams.
- **Player skill display** — `skillDisplay.js` renders the shared activity icon plus the selected
  game's skill value. Teams and Tournaments reuse it in participant selection, drawn-team previews,
  live drafts and tournament detail teams; history shows the team sum (current for tournaments and old drafts without a snapshot). The icon's tooltip and accessible label
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
    the total claims that anything counted with `3`. This covers the live draft board and the draft
    participant/captain selections. Completion stores the then-current player ratings and team sum;
    recording a result preserves those ratings by player ID, including after regrouping or removal.
    Added participants use their rating at result entry. A result recorded for another game uses
    that game's ratings instead, without the original draft marker. Older draft entries without
    a snapshot show the current team sum in history, labelled as current rather than historical.
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
  uses to separate sibling control groups, but one panel instead of two so the
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
  Umfragen use: six square buttons below the label. The chosen number and its outline take the former
  slider's saturated color (Bock violet, Skill blue), and a fill line below the numbers repeats the value with
  that slider's gradient; the line is empty for a 0 and dashed while nothing is rated. No selected
  number means "no rating yet"; 0 is a deliberate answer and counts as rated — for Bock „kein
  Bock“, for Skill „kenne ich nicht“ — and that meaning is spelled out on the Ø note's line. A
  press saves immediately and keeps keyboard focus on the pressed number. Existing 1–10 ratings
  were halved and rounded up onto this scale, together with the ratings stored in saved team draws
  (their team totals re-derived with the fallback 3) and the points of a Vote round still open at
  the upgrade; closed Vote rounds keep their historical 1–10 points. Unlike the team views, where a missing rating still
  enters the draw as the parenthesized fallback, the own-rating scale shows no number at all.
  A Skill of 0 („kenne ich nicht“) enters a balanced draw as 0, the weakest value, so players new
  to a game are spread across the teams; the team views label it „kennt das Spiel nicht“. Two independent chip
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

- **Hub** — Arcade is one page of full-width cards: „Lobbys“, „Läuft gerade“ (only while a match
  runs) and „Statistik“. There is no game grid and no per-game sub-route; `#arcade` is the only
  hub route, and a game room opened without a running match returns there.
- **Lobbys** — The card header carries the single primary action „Lobby öffnen“. It opens one
  dialog with „Spiel“ (a select, games sorted alphabetically), „Modus“ for games with modes and,
  for admins in Admin mode, „Gegner“ („Mensch“/„KI“). Modus and Gegner are `.arcade-mode-toggle`
  segmented switches that share one row with equal segment widths; on very narrow phones the
  opponent switch wraps below. The compact submit „Lobby öffnen“ sits at the dialog's right end.
  Tetris, Pong, Snake and Blobby Volley start on Duell (Snake: „Classic“). Challenge Rush and the
  Chimp Test have neither switch; Challenge Rush's admin test selection lives in the same dialog.
  All open lobbies of every game share one list. The current player's own lobby is a card with
  game icon, „<Host>s Lobby“, a meta line (game, mode, occupancy), the member rows with role
  („Host“, „Bereit“, „Wartet“) and free seats, host settings such as „Punkte bis Sieg“ and the
  compact header actions: „Starten“ plus „Schließen“ for the host, the ready toggle plus
  „Verlassen“ for a guest. A disabled „Starten“ names its reason in the button title. Every other
  lobby is a flat row with icon, title, meta line, occupied seats and „Beitreten“; a Pong or Blobby
  Volley Doppel lobby offers „Blau“ and „Pink“ instead, so joining picks the team. Joining or
  opening another lobby while owning one asks first and closes the own lobby only on confirmation.
- **Läuft gerade** — Each running match is one row: icon, „A gegen B“ (teams as „A und B gegen
  C und D“), game and score. A player's own match still held by this tab offers „Weiterspielen“,
  every other match „Zuschauen“.
- **Statistik** — A collapsible card, collapsed by default, with one overall ranking across all
  games and a game filter. Bars use muted per-game colors from the accent gradient. The Chimp Test
  has no wins and stays out of the overall ranking; its filter entry shows the Chimp-Test-Rangliste
  instead: one row per player with the best solo run (level, then strikes and active time up to
  that level), the chimp rating, the number of runs and the average level.
- **Game rooms** — Every game uses the same structure: a header with the game title, compact
  neutral match actions („Pausieren“/„Fortsetzen“, „Beenden“, „Verlassen“) and the mute and
  fullscreen icons; one stage card with the score bar (two sides) or the player strip (more players)
  above the playfield; after the end one „Ergebnis“ card.
  The playfield of Pong, Blobby Volley, Snake, Tetris and Scribble always fits the screen on its
  own: as large as width and remaining height allow, with header, score bar, chat and match
  actions still visible; below a playable minimum the view scrolls instead. The Tetris Arena on
  phones fits the own board and lists the opponents below it. On laptops and wider screens, and
  on phones held sideways, Scribble's tools, guess field and chat sit beside the canvas.
  „Vollbild“ hides the app's topbar, navigation and banners (the connection notice stays) and
  asks the browser for real fullscreen where it allows it; „Vollbild beenden“, Esc or leaving
  the game room ends it. Watching such a game offers the same fullscreen. The result lists every player with place
  and value; the winner's value is green, everyone else is muted. „Revanche“ in the result header
  opens a lobby in the same mode for the same players; the others accept with „Annehmen“, and the
  match starts once everyone is back and ready. „Schließen“ leaves the result.
  The start countdown is centered on the playfield, not on the window, at every size and in
  fullscreen. It shows no player identity; the own color is named on the score bar
  („Blau · Deine Farbe“ in Snake).
- **Game specifics** — Tetris Duell keeps two equal boards; Arena accepts three to eight players
  and keeps the local board large beside a grid of opponent boards. Pong and Blobby Volley offer
  Duell and Doppel; Doppel lobbies have two teams with two seats, Pong Doppel defaults to 21 points
  and follows Atari's Pong-4 lanes. Snake Classic is exactly one against one; Snake Arena accepts
  three to eight players, shrinks its safe zone and keeps eliminated players in the strip as
  „Ausgeschieden“. Battleship places the fleet with a ship picker (5 columns, 3 on phones), an
  orientation switch and „Zufällig“, „Zurücksetzen“ and „Flotte bereit“ in the header; ships are
  continuous bars, shots are dots. The quiz shows question, category and timer on one stage and
  keeps the revealed answer for 3.5 seconds.
  The Chimp Test accepts one to fifteen players who start together and then each play their own
  grid (8×5 on laptops, 5×8 filled column by column on phones): the numbers stay visible until the
  1 is tapped, every mistake is a strike that briefly reveals the solution to that player only, and
  three strikes end the run. Each run is stored as a solo result without wins, losses or places;
  a shared round shows a display-only „Rundenrangliste“ once at its end. The own result shows the
  level, the „Affen-Nähe“ against Ayumu (9 numbers = 100 %) with its tier, new personal bests and
  the rank in the Chimp-Test-Rangliste, also after a reload during the round. Reload, reconnect
  and pause always return the same attempt. When the host leaves, stays away past the 15-second
  reconnect grace or switches events, the controls pass to a player who can still reach the round
  and a pause is lifted.
- **AI** — Admins in Admin mode may choose „KI“ in the create dialog. Tetris and Snake Duell use one
  bot, their Arena fills all opponent seats; Pong and Blobby Volley cover the AI duel and Doppel with
  a bot teammate.
- **Parked games** — Scribble, Challenge Rush and the Chimp Test are visible to admins in Admin mode
  only (dialog, lobby list, running matches, statistics filter). The Chimp Test stays parked until it
  has been tried out on a test system. This is a presentation filter, not a security
  boundary. Challenge Rush keeps its reduced catalog of 21 challenges and has no AI.
- **Spectating** — „Zuschauen“ opens a read-only view that reuses each game's own player
  presentation (boards, canvases, score bar). Quiz spectators see the question and, after the
  reveal, the answer; Scribble spectators never receive the word, the hints or the guesses.
  Chimp Test spectators only see each player's progress, never numbers or tile positions.
- **Kiosk** — The kiosk does not take over the screen for Arcade matches; its dashboard stays
  visible. The takeover logic remains in `kiosk.js` behind `KIOSK_ARCADE_STREAM`.

## Vote und Turniere

- **Voting** — The page titles are the concise navigation labels „Teams“ and „Vote“. Vote uses the
  same card grouping as the other polished workflows without an accent rail.
  Like „Aktuelle Umfragen“, the page opens with the primary-collection card „Aktuelle
  Abstimmungen“ and its compact header action „Abstimmung starten“, which stays available while
  other rounds run. Several Votes can run in parallel; each open round is its own collapsible card
  nested inside that main card, with its ballot, saved answer and admin actions. While none runs,
  the main card shows the one-row empty state „Keine laufende Abstimmung“; the game list is not
  shown on the page. That action opens the dialog
  „Abstimmung starten“, modeled on „Umfrage starten“: optional „Titel“ and „Beschreibung“, the
  checkboxes „Anonym“ and „Zwischenstand verbergen“ (preselected) with contextual help, then the required „Spiele“ list and a right-aligned
  „Abstimmung starten“ beside the count of selected games. The list uses the Spielekatalog's
  toolbar: „Spiel suchen“, the same sorting („Name“, „Mein Bock“, „Ø Bock“, „Ø Skill“, each in both
  directions) and a filter menu with the catalog's „Genres“ only — the open-rating filters („Bock
  offen“, „Skill offen“) are left out, and without any genre in the catalog the menu is not shown.
  Search and filters only
  narrow what is shown; a hidden game keeps its selection and still counts when the round starts.
  Each row names the game with its genres and Ø Bock. A Vote has no „Antwortart“: every round rates
  each game with 0 to 5 points, only a runoff asks for exactly one game. Separate full-width cards for „Letzter Vote“
  and „Top 10 nach Bock-Level“; the Top 10 card is collapsible and starts closed.
  An open round and every closed result use the same presentation and answer controls as a 0–5
  Umfrage, a runoff those of an „Einzelauswahl“ (see „Umfragen“ in [Organisation](organisation-and-event-rules.md)),
  minus the poll-only parts: no „Neue Runde“ and no „Wieder öffnen“. Each open round is
  one `.event-poll-card` whose header names the round, the participation („X/Y abgegeben“, updated
  through the existing realtime refresh) and the viewer's own state („Abgegeben“ or „Deine Stimme
  fehlt“); admins get a compact „Beenden“ and, directly beside it, a red „Abbrechen“; the member
  who started the round also gets „Beenden“ (not „Abbrechen“) for that round — no
  „Aktion“ menu for a single action (the shared menu never holds just one entry). Tags name
  „Stichwahl“ for a runoff whose title does not say it, „Anonym“ and „Zwischenstand verborgen“
  where they apply; the round info follows. Games are listed alphabetically, one
  Umfrage option row each: name and one compact meta line that starts with the viewer's own Skill
  („Mein Skill: X“, „–“ without one) followed by the other values, and the Umfrage answer control:
  the 0–5 number scale, in a runoff „Wählen“/„Ausgewählt“.
  The 0–5 draft meter uses the same blue-to-violet gradient as the revealed result bars. Like every
  Umfrage with a hidden interim result, the empty result column is dropped so the answers sit
  beside the name. Each game keeps its title, result bar, voter avatars and answers in one horizontal
  row. Games fill two columns, read down the left first, only when both complete rows fit;
  otherwise they use one full-width column, including when the interim result is visible.
  Unless the round is anonymous, the voter avatars appear as in an open Umfrage. A ballot the viewer has not saved yet in this round starts with the own Bock
  preselected for every game that has one; games without an own Bock start unrated. This
  preselection is only a local draft — nothing counts until „Speichern“. No selected number means unrated; pressing the chosen number again clears
  it. 0 is a deliberate rating, marked „Spiele ich nicht“ in the voter column. The footer shows the
  own progress („X von Y bewertet“, in a runoff „X gewählt“) and „Speichern“, enabled once every
  game is rated (in a runoff: once one game is picked). The number of the own Bock carries a faint
  dashed outline on every points ballot („dein Bock“ in its name and tooltip), so a changed rating
  stays visible. While at least one rated game differs from the own Bock (including games without
  one), a „Bock übernehmen“ checkbox appears beside „Speichern“: checked, saving also writes those
  points as the own Bock in the game catalog, in the same step as the ballot. It starts checked and
  remembers the last choice per account on that device; runoffs have no such option. Anonymous
  rounds offer it too: adopting then makes those points visible as the player's own Bock, an
  accepted trade-off. A runoff is titled „Stichwahl“ and keeps the
  anonymity and interim-result setting of the round it decides. „Letzter Vote“ is a collapsible Umfrage card
  that starts collapsed and keeps its open state across live re-renders. Expanded latest and
  historical results preserve the server's score ranking and fill two columns when complete
  horizontal rows fit, down the left first, then down the right; narrower cards keep one column. Each game carries a
  place number in the Top-10 style. Equal points (or votes in a runoff) share their place,
  regardless of popularity or name used to stabilize their order: `1, 1, 3` for two co-winners.
  All first-place numbers are gold, the others muted. The Top 10 likewise share places for equal
  Bock averages. Visible result numbers are hidden from assistive technology and accompanied
  by explicit „Platz N“ text for screen readers.
  The voter column remains reserved even without supporters, so zero-point result bars keep
  the same left edge as the other bars in their column.
  The passive „Win“ label follows the text height in headers and result rows; it does not increase
  the title's gap to metadata.
  Its header names the
  round, date, participation and winner and offers „Stimmen ansehen“ for named ballots and, on a tie, a
  compact „Stichwahl starten“ as long as no runoff for that round is already open. A runoff stores
  the exact round it resolves, so simultaneous Votes cannot change its decline counts or player
  selection. „Match generieren“ opens Match in „Auslosung“
  mode with the winning game selected and exactly the voters who gave it at least one point preselected.
  It never starts the draw itself; players and team count can still be changed on Match. If several
  games tie, a dialog lets the user choose one of them first. After a runoff, every runoff participant
  is preselected except those who gave the runoff's winner 0 points in the tied points round
  before it; a player who only joined for the runoff counts as a participant. Every runoff row,
  open or closed, names how many voters declined that game in that tied round
  („Vorrunde: N spielen nicht“, including 0, since the count compares the tied games). An
  anonymous round names no voters, so it offers no „Match generieren“, and a runoff after an
  anonymous tied round shows no „Vorrunde“ count. While a
  Captain Draft runs in the event, Match shows only that live draft, so „Match generieren“ does
  not open Match: it reads the current draft state and shows an error toast naming the draft's game
  („Gerade läuft ein Captain Draft für <Spiel>. …“); the draft is never cancelled from Vote. Its closed header has the same compact height as the neighboring
  closed cards and no hover fill. Opened, it lists every game of the round sorted by score, each with
  its result bar, „N Pkt. · X/Y spielen mit“ (voters who gave at least one point, out of everyone
  who voted) and the avatars of those voters; winners carry the green „Win“ chip, tied winners
  each carry it. The complete name/metadata block, bar/count block, voter avatars and answer
  controls are centered between the row separators.
  Rows have equal top and bottom padding and no extra gap between them.
  Count text removes outer font leading against the capital height and baseline where supported;
  descenders remain visible. The bar/count block uses those text metrics for its optical center.
  „Stimmen ansehen“ — in that header, on every history row and behind each avatar
  stack — opens the Umfrage vote table: numbered legend with each game's summary, one row per
  voter with their points (a 0 shown as „Spielt nicht“) or their runoff pick.
  An anonymous round offers no „Stimmen ansehen“ and no avatars; its counts stay visible. Results
  read „N Pkt. · X/Y spielen mit“, in a runoff „N Stimmen“. „Letzter Vote“ always shows the
  most recently ended round, even if another Vote is open or a lower numbered round ends later.
  History lists only the rounds before the
  latest one as separate collapsible cards. Each retains its compact history row as a header
  (title, date, participation, winner and „Stimmen ansehen“) and independently opens the same
  per-game results as „Letzter Vote“. Cards start closed, preserve their own open state across
  live re-renders and reset that state when the active event changes. Every historical card with
  an eligible winner also offers „Match generieren“. Header and results have
  no additional dividing line.
  The Top 10 form two ordered five-item columns from `--bp-md`, while phones keep one continuous
  list. The dialog's `.vote-game-grid` keeps one column on phones and two from `--bp-md`, with the
  same bordered card treatment at every size.
  The page itself shows no info tooltips; the dialog carries them only beside „Anonym“ and
  „Zwischenstand verbergen“. In the dialog the search field takes its own row; below it the single
  bulk toggle (`.selection-toolbar-icon`), sorting and the filter menu share one row.
  The game list preselects the current Top 10 by Bock as a starting point each time the dialog
  opens; a round covering everything simply uses the bulk toggle or clears the remaining
  exclusions by hand. Search and filters only change the visible rows while hidden selections
  remain intact; the bulk toggle applies only to the currently visible games. That grid, an
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
  and concurrent devices leave exactly one ballot. The same holds for a runoff pick. With „Zwischenstand verbergen“ (the default) the per-game
  distribution and who voted how stay hidden from everyone while the round is open, only the
  participation shows; without it the running result and, unless anonymous, the voters are visible
  to the event's participants. After closing, the result is visible to them and, unless the round
  is anonymous, who voted how. Any member may start a round; only community admins start a
  runoff.
  A cancelled round is deleted together with its votes and the next round may reuse its number, so
  the client tells rounds apart by number and start time and never carries a cancelled round's
  ballot over.
  Vote history is labeled simply „Historie“, uses the shared icon-free collapsible header, starts
  closed and retains its open state across live re-renders.
- **Tournament overview** — Match lists running tournaments as compact „Aktuell“ style rows above its setup. These whole-row actions highlight on pointer hover and show keyboard focus, without a trailing chevron or „Öffnen“ label. The selected game's „Ohne Ergebnis“ section keeps running tournaments as collapsible history tiles; completed tournaments belong in the history filter. Every tournament starts from a Match draw or Captain
  Draft; there is no separate creation page or tournament tab. Legacy `#tournaments` and
  `#tournaments/new` routes replace themselves with `#matchmaking`. A tournament detail link keeps
  its own `#tournaments/<id>` route, including search, Home and browser history navigation. The
  detail page has no „Zurück“ action; admins and owners see a compact neutral „Löschen“ beside its title. A deleted
  tournament link explains that the tournament is gone. The page never carries two `h1` headings.
  The detail page's meta line carries format, options, team and player counts and the decided
  matches („4 Teams · 15 Spieler · 0/3 entschieden“) instead of separate counter tiles. Below it
  follow „Aktive Lobbys“, the results and a collapsible „Teams“ card with its team count that
  starts closed and keeps its open state; team cards share the draw preview's responsive grid:
  one column on phones, two from 640 px and up to four from 860 px. The signed-in player's team leads
  that grid. While the tournament runs, every member of a team and every admin or owner sees a neutral
  pencil in the team card's trailing slot instead of the player count; it opens the compact dialog
  „Teamnamen ändern“ with only the tournament name, one team-name field and „Speichern“.
  An empty, overlong or non-unique name produces an error when saved (1–30 characters, unique
  within the tournament ignoring case). The new name replaces the old one everywhere at once, and the other participants get
  the toast „<old> heißt jetzt „<new>““. A completed tournament keeps its names (`409`); of two teams
  claiming the same name at once exactly one succeeds. Creating a tournament sends every participant
  a personal push „<Turnier> startet“ that names their teammates and asks them to choose a team name;
  the shared Kiosk keeps the neutral „Neues Turnier“ entry. The push links to
  `#tournaments/<id>/teams`, which opens the Teams card and highlights the own team until the reader
  renames it or leaves the tournament; live updates keep the highlight. Only `#tournaments/<id>` is
  kept in the history, so a reload does not repeat the highlight. Tournament results use plain cards without
  accent rails: a knockout bracket card, stacked „Tabelle“ and „Spielplan“ cards for a league, and
  one card per group with its table and rounds plus a „K.O.-Runde“ card. A knockout phase with
  exactly one fixture is a 1:1 row under „Finale“, including pure two-team knockout tournaments;
  larger phases keep the bracket and a phase not yet created keeps its empty state. A third-place match
  sits inside the bracket card directly below the final, in the final's column, under the small caption
  „Spiel um Platz 3“ and with the same match box and result action. Fixtures read like a
  scoreboard (home team right-aligned, result chip centered, away team left-aligned); winners are
  emphasized and losers muted, with a green winner score or a „‹ Win“/„Win ›“ chip without a score.
  League and group round fixtures use the same grouping and divider treatment. Fixtures, knockout
  bracket (including its winner column), group tables and league tables show only team names and
  outcomes, without team skill or member names. Champion and expanded team cards still show members
  and current team skill; no historical tournament skill snapshot exists, and missing ratings are
  identified instead of counted as a balancing fallback. The signed-in player's name alone is bold
  in champion and team cards; winner and loser states keep their own meaning. Wherever the
  signed-in player's own team appears among equal siblings (bracket rows, fixtures, table row,
  active lobby row and team card) it carries one quiet marker: thin accent edges on both sides and the faint
  `--accent-bg-subtle` tint, with a visually hidden „(dein Team)“ for screen readers and no visible
  „Du“ label. Their own lobby leads „Aktive Lobbys“; the other lobbies keep their order. On phones
  the first view of a tournament scrolls the bracket to the player's own open match, and live
  re-renders keep the reader's horizontal bracket position. Players outside the tournament see no
  marking.
  Tables show #, Team, Sp, S, U, N, +/− (only with scores) and Pkt; advancing group teams carry a
  „weiter“ marker. Every result action sits in a fixed trailing slot („+“ open, pencil recorded)
  and opens the common result form. Changing an earlier winner warns before later knockout pairings or results are reset; changing a group winner warns if the knockout phase already exists. Canceling keeps the result form usable. The tournament's score setting fixes the mode: score rows
  accept whole numbers from 0 and require at least one entry, while winner choices include
  „Unentschieden“ except in knockout matches. Saving is always explicit. A decided final shows
  its champion in the existing „Turnier beendet“ card. The last result completes the
  tournament automatically: a toast names the winner and the
  detail page then leads with a „Turnier beendet“ card showing the winning team (knockout final
  winner, or the league leader) with its „Win“ chip and players. A tournament that will not be
  played out can be ended early by group admins with a compact neutral „Beenden“ beside „Löschen“
  in the detail header (confirmation: open games no longer count and there is no winner). It then
  reads „Vorzeitig beendet“, keeps every recorded result, accepts no further results and crowns no
  champion, neither on the board nor in the Hall of Fame. Home's „Meine To-Dos“ offers the same
  action once the tournament's event period is over. „Aktive Lobbys“ is one card with its
  heading inside; each currently playable pairing is a flat hairline row with the matchup, a muted
  line naming phase and hosting team („Halbfinale · Team 1 eröffnet“, „Spiel um Platz 3 · Team 2
  eröffnet“) and, on the right, the lobby
  name and password as non-wrapping code chips with equal-width labels. A stored lobby base name
  receives a deterministic phase/round/match suffix, so parallel pairings always have distinct
  lobby names without mutable lobby assignments. League and group modes show only the earliest
  unfinished round; knockout modes show every open match whose two teams are known. Once a league
  round or one group's round is fully decided, players in that round's next pairings receive their
  match-ready push. Each credential
  provides Lucide's `copy` action with a full touch target. Tournament details show no info
  tooltips.
  Bracket matches keep a fixed height with an internal trailing action column. Tournament details
  show the full format configuration as plain text (for example „Liga · Hin- & Rückrunde ·
  Punktestand“ or „K.O.-Turnier · Spiel um Platz 3“). Tournament overview cards use the compact format names without explanatory
  parentheses.
