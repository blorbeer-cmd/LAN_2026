// SQLite access layer. better-sqlite3 is synchronous, which keeps handlers
// simple and predictable for a tool of this size. The schema is created on
// first run and seeded with our default games.

import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { nanoid } from 'nanoid';
import { config } from './config';
import { DEFAULT_QUIZ_QUESTIONS } from './arcade/quizQuestions';
import { DEFAULT_SCRIBBLE_WORDS } from './arcade/scribbleWords';

// Ensure the data directory exists before opening a file-based DB. Skipped for
// the in-memory database used in tests.
if (config.dbFile !== ':memory:') {
  fs.mkdirSync(path.dirname(config.dbFile), { recursive: true });
}

export const db = new Database(config.dbFile);

// Pragmas: WAL for better concurrent reads during live updates; foreign keys on
// so cascading deletes keep the data consistent.
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS players (
    id              TEXT PRIMARY KEY,
    name            TEXT NOT NULL,
    color           TEXT NOT NULL DEFAULT '#4f9dff',
    avatar          TEXT,
    api_key         TEXT NOT NULL UNIQUE,
    tracking_paused INTEGER NOT NULL DEFAULT 0, -- player-side opt-out; agent reports for this player are dropped
    is_admin        INTEGER NOT NULL DEFAULT 0, -- moderation role; can be granted via PATCH /api/players/:id
    is_test         INTEGER NOT NULL DEFAULT 0, -- admin-seeded test player; hidden outside admin mode (see testUsers.ts)
    created_at      INTEGER NOT NULL
  );

  -- LAN events (e.g. "LAN Party Sommer 2026"). Several can exist and even
  -- overlap in time — the thing that must stay exclusive is *tracking*
  -- (live status / playtime), not the events themselves: at most one event
  -- has tracking_enabled = 1 at any moment (enforced in events.ts, not by
  -- the schema), and only that event's roster (event_participants) gets
  -- tracked. ended_at is set once an event is explicitly closed (separate
  -- from just pausing tracking). location/description are optional
  -- freeform notes (e.g. "bei Tim", "Fokus: AoE2-Turnier"). A permanent
  -- sentinel row (id = OUTSIDE_EVENTS_ID, seeded below) represents
  -- "außerhalb von Events" — where everything gets tagged whenever no real
  -- event is tracking, so every event-scoped table can keep a plain
  -- NOT NULL event_id instead of needing a nullable "no event" case
  -- threaded through the whole codebase. Players, games and skills stay
  -- global across events on purpose (the same friend group year after
  -- year) — only live/session/vote/match data is scoped per event so
  -- analytics can be viewed per LAN afterwards.
  CREATE TABLE IF NOT EXISTS events (
    id               TEXT PRIMARY KEY,
    name             TEXT NOT NULL,
    starts_at        INTEGER NOT NULL,
    ends_at          INTEGER,
    location         TEXT,
    description      TEXT,
    tracking_enabled INTEGER NOT NULL DEFAULT 0,
    ended_at         INTEGER
  );

  -- An event's roster. Only participants get tracked while their event has
  -- tracking_enabled — everyone else's agent reports are simply ignored
  -- while that event is the one tracking (see routes/agent.ts).
  CREATE TABLE IF NOT EXISTS event_participants (
    event_id  TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    player_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    PRIMARY KEY (event_id, player_id)
  );

  -- Every game the group could play lives here — from a bare tracked entry
  -- (name + process names, for the agent) to a full catalog entry (platform,
  -- trailer) to a player-submitted suggestion, all as one lifecycle instead
  -- of two separate tables. status distinguishes "vorgeschlagen" from
  -- "im Katalog" — whether a game additionally counts as "getrackt" is never
  -- stored, just derived from whether it has any game_process_names.
  CREATE TABLE IF NOT EXISTS games (
    id            TEXT PRIMARY KEY,
    name          TEXT NOT NULL,
    icon          TEXT NOT NULL DEFAULT '🎮',
    icon_image    TEXT,    -- optional data: URL (self-uploaded box art/logo), takes over from icon when set
    min_team_size INTEGER NOT NULL DEFAULT 1,
    max_team_size INTEGER NOT NULL DEFAULT 5,
    platform      TEXT,
    platform_url  TEXT,
    trailer_url   TEXT,
    status        TEXT NOT NULL DEFAULT 'catalog' CHECK (status IN ('suggestion', 'catalog')),
    created_by    TEXT REFERENCES players(id) ON DELETE SET NULL,
    created_at    INTEGER NOT NULL
  );

  -- Maps a running process name (lowercased, e.g. "cs2.exe") to a game so the
  -- agent scan can identify what someone is playing.
  CREATE TABLE IF NOT EXISTS game_process_names (
    id           TEXT PRIMARY KEY,
    game_id      TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
    process_name TEXT NOT NULL UNIQUE
  );

  -- Skill rating 1-10 per (player, game). One row per pair.
  CREATE TABLE IF NOT EXISTS skills (
    player_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    game_id   TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
    rating    INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 10),
    PRIMARY KEY (player_id, game_id)
  );

  -- "Bock"-Rating 1-10 per (player, game): how much a player currently feels
  -- like playing it, as opposed to skills.rating (how good they are). Kept
  -- as its own table rather than a column on skills since it's meant to be
  -- changed on a whim throughout the LAN (mood-of-the-moment), independent
  -- of the skill rating lifecycle. Aggregated across all players it becomes
  -- a game's overall "Beliebtheit", used to pre-sort the voting view and
  -- shown there directly (see routes/votes.ts).
  CREATE TABLE IF NOT EXISTS preferences (
    player_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    game_id   TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
    rating    INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 10),
    PRIMARY KEY (player_id, game_id)
  );

  -- Per-player live meta: when the agent last reported and an optional manual
  -- override (e.g. "Pause/Essen"). Which games are currently running lives in
  -- live_status_games below, since a PC can run several games at once
  -- (e.g. a launcher + the actual game, or genuinely two games side by side).
  -- activity_tracked mirrors whether that last report actually carried the
  -- foreground/idle signal (i.e. the player's agent has trackActivity on) —
  -- the frontend uses it to decide whether live_status_games.is_foreground
  -- means anything or is just "unknown" (always 0 when this is 0).
  CREATE TABLE IF NOT EXISTS live_status (
    player_id       TEXT PRIMARY KEY REFERENCES players(id) ON DELETE CASCADE,
    last_seen       INTEGER NOT NULL,   -- last agent report (ms UTC)
    manual_note     TEXT,               -- optional manual override text (e.g. "Pause")
    activity_tracked INTEGER NOT NULL DEFAULT 0
  );

  -- Technical heartbeat metadata for the admin diagnosis view. Kept apart
  -- from live_status because these are troubleshooting details, not gameplay
  -- state, and must still update while tracking is paused or roster-gated.
  CREATE TABLE IF NOT EXISTS agent_diagnostics (
    player_id       TEXT PRIMARY KEY REFERENCES players(id) ON DELETE CASCADE,
    agent_version   TEXT,
    last_report_at  INTEGER NOT NULL,
    process_names   TEXT NOT NULL DEFAULT '[]'
  );

  -- One row per game currently detected as running for a player. Rows are
  -- added/removed on every agent report to match what's actually running.
  -- is_foreground: whether this is the one game (of possibly several running
  -- at once) whose window was actually focused as of the last report — only
  -- meaningful when the owning live_status row has activity_tracked = 1.
  CREATE TABLE IF NOT EXISTS live_status_games (
    player_id     TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    game_id       TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
    since         INTEGER NOT NULL,     -- when this game started (ms UTC)
    is_foreground INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (player_id, game_id)
  );

  -- Historical play sessions (FR-29): one row per continuous stretch of a
  -- player having a game detected as running. Written alongside
  -- live_status_games on every agent report (open on start, closed on stop),
  -- so total playtime per player/game can be computed even after a session
  -- has ended. ended_at NULL means the session is still ongoing.
  -- active_ms accumulates estimated time the game was actually being played
  -- (its window focused + system not idle), as opposed to just running in
  -- the background. Only accrues when the player's agent opts in to sending
  -- foreground/idle data (trackActivity); otherwise stays 0 and total
  -- playtime (ended_at - started_at) is all we know.
  CREATE TABLE IF NOT EXISTS play_sessions (
    id         TEXT PRIMARY KEY,
    player_id  TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    game_id    TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
    event_id   TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    started_at INTEGER NOT NULL,
    ended_at   INTEGER,
    active_ms  INTEGER NOT NULL DEFAULT 0
  );

  -- "What's next" votes. Round numbers increment forever (never reset per
  -- event) so the UNIQUE constraint stays valid across event boundaries;
  -- event_id is stored for historical filtering. Two modes, chosen per round
  -- in vote_rounds.mode: 'single' (one row per player per round, changing a
  -- vote replaces it — enforced in routes/votes.ts, not by a UNIQUE(player,
  -- round) constraint, since 'points' mode needs several rows per player)
  -- and 'points' (up to 5 rows per player per round, one per game they gave
  -- points to). points stays NULL for 'single'-mode rows.
  CREATE TABLE IF NOT EXISTS votes (
    id         TEXT PRIMARY KEY,
    player_id  TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    game_id    TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
    event_id   TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    round      INTEGER NOT NULL,   -- vote round id, lets us reset without deleting history
    points     INTEGER CHECK (points IS NULL OR points BETWEEN 1 AND 10),
    created_at INTEGER NOT NULL,
    UNIQUE (player_id, round, game_id)
  );

  -- One row per vote round, so the history view can list past rounds even
  -- ones nobody voted in (which would otherwise leave no trace in the votes
  -- table at all). Written on /start, filled in with the winner(s) on /close;
  -- deleted on /cancel so mistaken rounds don't linger in the history,
  -- mirroring the votes rows themselves being deleted on cancel. mode is
  -- fixed for the round's whole lifetime ('single' | 'points').
  CREATE TABLE IF NOT EXISTS vote_rounds (
    round             INTEGER PRIMARY KEY,
    event_id          TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    started_at        INTEGER NOT NULL,
    closed_at         INTEGER,
    winner_game_ids   TEXT,   -- JSON array of game ids, set on close
    mode              TEXT NOT NULL DEFAULT 'single',
    title             TEXT,   -- optional, freely chosen name for the round
    info              TEXT,   -- optional free-text note shown to voters
    selected_game_ids TEXT    -- JSON array of game ids the round is limited to, NULL = all games
  );

  -- Whose monitor a player can see from their seat, per event (FR-18
  -- extension, framed in the UI as "Sichtbare Monitore" rather than "seat
  -- neighbors" since it's really about line-of-sight to a screen, not just
  -- physical proximity). Self-service, one row per direction a player
  -- declares (so a player can update their own row without needing their
  -- neighbor to also confirm it) — matchmaking treats the pair as adjacent
  -- if either direction exists. Scoped per event since people sit somewhere
  -- different at every LAN. source distinguishes rows the seating-plan editor
  -- derived automatically from same-edge seat adjacency ('auto', see
  -- seating.ts's syncAutoSeatNeighbors) from ones a player explicitly checked
  -- themselves ('manual', written by players.ts's PUT /:id/neighbors) — the
  -- auto-sync only ever adds/removes its own 'auto' rows, never a manual one.
  CREATE TABLE IF NOT EXISTS seat_neighbors (
    event_id    TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    player_id   TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    neighbor_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    source      TEXT NOT NULL DEFAULT 'manual',
    PRIMARY KEY (event_id, player_id, neighbor_id)
  );

  -- Shared physical table plan for an event. assignments is JSON so the
  -- layout can move players between seats without a join table for every
  -- drag operation; each entry is { side, seat, playerId }.
  CREATE TABLE IF NOT EXISTS seating_layouts (
    event_id     TEXT PRIMARY KEY REFERENCES events(id) ON DELETE CASCADE,
    top_seats    INTEGER NOT NULL DEFAULT 2,
    right_seats  INTEGER NOT NULL DEFAULT 2,
    bottom_seats INTEGER NOT NULL DEFAULT 2,
    left_seats   INTEGER NOT NULL DEFAULT 2,
    assignments  TEXT NOT NULL DEFAULT '[]',
    updated_at   INTEGER NOT NULL
  );

  -- Recorded matches for the leaderboard. Result details are stored as JSON to
  -- stay flexible while the scoring rules are still being decided.
  CREATE TABLE IF NOT EXISTS matches (
    id         TEXT PRIMARY KEY,
    game_id    TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
    event_id   TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    played_at  INTEGER NOT NULL,
    result     TEXT NOT NULL        -- JSON: teams/players and winner
  );

  -- History of drawn (not necessarily played) teams from "Teams auslosen".
  -- Every draw is logged, including re-rolls — distinct from the matches
  -- table above, which is the actual recorded outcome of a game someone
  -- chose to enter afterwards. The teams column is a full snapshot (not
  -- just player ids) so the history keeps showing the exact names/ratings
  -- used at draw time even if a player later gets renamed, re-rated, or
  -- removed.
  CREATE TABLE IF NOT EXISTS matchmaking_draws (
    id                    TEXT PRIMARY KEY,
    game_id               TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
    event_id              TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    teams                 TEXT NOT NULL,  -- JSON: [{ players: [{id,name,color,avatar,rating}], totalRating }]
    seat_conflicts        INTEGER NOT NULL DEFAULT 0,
    seat_pairs_considered INTEGER NOT NULL DEFAULT 0,
    generated_at          INTEGER NOT NULL,
    match_id              TEXT REFERENCES matches(id) ON DELETE SET NULL,
    -- Set once someone enters a result for this exact draw (Team-Historie ->
    -- Ergebnis-Historie). ON DELETE SET NULL mirrors tournament_matches.match_id:
    -- correcting/removing that leaderboard entry moves the draw back to
    -- Team-Historie instead of deleting the draw itself.
    source                TEXT
    -- NULL for a regular skill-balanced draw, 'draft' when these teams came
    -- out of a finished Captain-Draft (see draft.ts) — shown as a badge so
    -- Team-/Ergebnis-Historie still says how a lineup came to be.
  );

  -- Tournaments (FR-33): a single-elimination bracket ("Turnierbaum"), a
  -- round-robin league ("jeder gegen jeden", optionally home-and-away), or a
  -- group stage followed by a knockout bracket ("Gruppenphase + K.O.").
  -- group_count/advancers_per_group are only meaningful for group_knockout —
  -- how many groups the roster is split into, and how many teams per group
  -- advance into the knockout bracket once every group match is decided.
  -- track_score applies to all formats: whether results carry an actual
  -- score (tournament_matches.score_a/score_b) or are win/loss-only.
  -- Kept as its own family of tables rather than reusing matchmaking_draws,
  -- since a tournament's teams are fixed for its whole duration and its
  -- matches need to track bracket position / standings, neither of which a
  -- one-off draw needs.
  CREATE TABLE IF NOT EXISTS tournaments (
    id                   TEXT PRIMARY KEY,
    event_id             TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    game_id              TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
    name                 TEXT NOT NULL,
    format               TEXT NOT NULL,               -- 'single_elimination' | 'round_robin' | 'group_knockout'
    two_legged           INTEGER NOT NULL DEFAULT 0,  -- only meaningful for round_robin / group stage
    track_score          INTEGER NOT NULL DEFAULT 0,  -- results carry a real score, not just win/loss
    group_count          INTEGER,                     -- only for group_knockout
    advancers_per_group  INTEGER,                     -- only for group_knockout
    status               TEXT NOT NULL DEFAULT 'active', -- 'active' | 'completed'
    created_at           INTEGER NOT NULL,
    lobby_name           TEXT,                         -- optional: in-game lobby name used throughout the tournament
    lobby_password       TEXT                          -- optional: in-game lobby password used throughout the tournament
  );

  -- A tournament's roster: fixed for the tournament's whole duration (unlike
  -- a matchmaking draw's teams, which are a one-off snapshot). group_index
  -- (0-indexed) is only set for group_knockout tournaments.
  CREATE TABLE IF NOT EXISTS tournament_teams (
    id            TEXT PRIMARY KEY,
    tournament_id TEXT NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
    name          TEXT NOT NULL,
    player_ids    TEXT NOT NULL, -- JSON array of player ids
    group_index   INTEGER
  );

  -- One row per bracket slot (single_elimination), fixture (round_robin), or
  -- group-stage fixture / knockout-bracket slot (group_knockout). For a
  -- bracket, later rounds start with NULL team_*_id and get filled in as
  -- earlier rounds are decided (see tournament.ts's applyBracketResult).
  -- stage/group_index disambiguate group_knockout's two phases: 'group'
  -- rows belong to one group's round-robin schedule (group_index says
  -- which), 'knockout' rows are the bracket generated once every group
  -- match is decided — both NULL for the other two formats. score_a/score_b
  -- are only populated when the owning tournament has track_score set.
  -- match_id points at the matches row created when a result is recorded,
  -- so playing in a tournament also counts toward the normal leaderboard;
  -- ON DELETE SET NULL rather than CASCADE so correcting/removing that
  -- leaderboard entry doesn't silently erase the tournament result too.
  CREATE TABLE IF NOT EXISTS tournament_matches (
    id             TEXT PRIMARY KEY,
    tournament_id  TEXT NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
    round          INTEGER NOT NULL,
    slot           INTEGER NOT NULL,
    stage          TEXT,     -- 'group' | 'knockout' (group_knockout only)
    group_index    INTEGER,  -- group_knockout group-stage rows only
    team_a_id      TEXT REFERENCES tournament_teams(id) ON DELETE CASCADE,
    team_b_id      TEXT REFERENCES tournament_teams(id) ON DELETE CASCADE,
    winner_team_id TEXT REFERENCES tournament_teams(id) ON DELETE CASCADE,
    score_a        INTEGER,
    score_b        INTEGER,
    is_draw        INTEGER NOT NULL DEFAULT 0,
    is_bye         INTEGER NOT NULL DEFAULT 0,
    match_id       TEXT REFERENCES matches(id) ON DELETE SET NULL,
    played_at      INTEGER
  );

  -- "Jetzt zocken" pings: a spontaneous, short-lived "I want to play X right
  -- now, who's in?" — deliberately lighter-weight than a vote round (no
  -- start/stop lifecycle, just expires on its own) for the common case of
  -- one player wanting to round up others immediately.
  CREATE TABLE IF NOT EXISTS game_pings (
    id         TEXT PRIMARY KEY,
    player_id  TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    game_id    TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
    event_id   TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    message    TEXT,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
  );

  -- Who tapped "Ich bin dabei" on a ping.
  CREATE TABLE IF NOT EXISTS game_ping_interested (
    ping_id   TEXT NOT NULL REFERENCES game_pings(id) ON DELETE CASCADE,
    player_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    PRIMARY KEY (ping_id, player_id)
  );

  -- Web Push subscriptions (real OS-level notifications, not just in-app
  -- toasts): one row per browser/device a player opted in on. Keyed by
  -- endpoint (unique per browser+origin) rather than player_id, since one
  -- player can have several devices subscribed; re-subscribing the same
  -- endpoint under a different player just re-points it (see push.ts).
  CREATE TABLE IF NOT EXISTS push_subscriptions (
    id         TEXT PRIMARY KEY,
    player_id  TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    endpoint   TEXT NOT NULL UNIQUE,
    p256dh     TEXT NOT NULL,
    auth       TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );

  -- Captain draft: the social alternative to auto-balanced matchmaking.
  -- Exactly one draft can be running at a time (like a vote round), so this
  -- is a single row with JSON columns rather than a family of tables —
  -- captains/pool/picks are snapshots of a short-lived live event, not
  -- entities other features join against. Completed/cancelled drafts stay
  -- as rows only until the next draft starts (the completed teams also get
  -- logged into matchmaking_draws so Team-Historie shows them).
  CREATE TABLE IF NOT EXISTS drafts (
    id          TEXT PRIMARY KEY,
    event_id    TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    game_id     TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
    status      TEXT NOT NULL,          -- 'active' | 'completed' | 'cancelled'
    captain_ids TEXT NOT NULL,          -- JSON: [playerId, ...] (one per team, in seat order)
    pool_ids    TEXT NOT NULL,          -- JSON: remaining un-picked player ids
    picks       TEXT NOT NULL,          -- JSON: [{ captainIndex, playerId, pickedAt }, ...]
    created_at  INTEGER NOT NULL
  );

  -- Durchsagen ("Essen ist da!"): broadcast to every device as a toast +
  -- kiosk banner + push notification. Kept as rows (not fire-and-forget) so
  -- the Durchsage view can show the recent history and late joiners still
  -- see what they missed.
  CREATE TABLE IF NOT EXISTS broadcasts (
    id         TEXT PRIMARY KEY,
    player_id  TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    message    TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );

  -- Every real push notification sent via notifyPlayers() (Durchsagen, neue
  -- Sammelbestellung, Abstimmung offen, Arcade-Lobby, "Jetzt zocken?"-Ping,
  -- Turnier/Draft-Events, ...), so a shared screen (Kiosk) can always show
  -- "was zuletzt an alle rausging" without caring which feature triggered
  -- it. No player_id/target list on purpose - this is a title/body/when
  -- log, not a per-recipient delivery record (push_subscriptions handles
  -- the actual delivery targets).
  CREATE TABLE IF NOT EXISTS push_log (
    id         TEXT PRIMARY KEY,
    title      TEXT NOT NULL,
    body       TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS quiz_questions (
    id         TEXT PRIMARY KEY,
    question   TEXT NOT NULL,
    answers    TEXT NOT NULL,
    category   TEXT,
    difficulty TEXT,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS quiz_seen (
    question_id TEXT NOT NULL REFERENCES quiz_questions(id) ON DELETE CASCADE,
    player_id   TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    seen_at     INTEGER NOT NULL,
    was_correct INTEGER,
    PRIMARY KEY (question_id, player_id)
  );

  CREATE TABLE IF NOT EXISTS scribble_words (
    id         TEXT PRIMARY KEY,
    word       TEXT NOT NULL,
    difficulty TEXT,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS scribble_seen (
    word_id     TEXT NOT NULL REFERENCES scribble_words(id) ON DELETE CASCADE,
    player_id   TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    seen_at     INTEGER NOT NULL,
    PRIMARY KEY (word_id, player_id)
  );

  CREATE TABLE IF NOT EXISTS arcade_results (
    id          TEXT PRIMARY KEY,
    game_type   TEXT NOT NULL,
    winner_id   TEXT REFERENCES players(id) ON DELETE SET NULL,
    players     TEXT NOT NULL,
    scores      TEXT NOT NULL,
    reason      TEXT NOT NULL,
    started_at  INTEGER NOT NULL,
    ended_at    INTEGER NOT NULL
  );

  -- Info-Board: the answers to the questions everyone asks five times per
  -- evening (WLAN password, Discord link, game-server IPs, house rules).
  -- Plain title+content entries, editable by anyone (LAN trust model).
  CREATE TABLE IF NOT EXISTS info_entries (
    id         TEXT PRIMARY KEY,
    title      TEXT NOT NULL,
    content    TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

  -- Sammelbestellungen ("wer will was von Luigi's"): one order is opened,
  -- everyone adds their own items while it's open, closing freezes the list
  -- for reading out to the phone/delivery app. price_cents is optional —
  -- splitting the bill is the usual pain, but forcing prices would slow
  -- down the common "just write what you want" case.
  CREATE TABLE IF NOT EXISTS food_orders (
    id         TEXT PRIMARY KEY,
    event_id   TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    title      TEXT NOT NULL,
    created_by TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL,
    closed_at  INTEGER,
    send_at    INTEGER, -- optional, editable: when the order will actually be placed/picked up
    notes      TEXT,    -- optional, editable: free-text info (e.g. "bar zahlen", "Mindestbestellwert 15€")
    link       TEXT     -- optional, editable: URL to the menu/delivery service
  );

  CREATE TABLE IF NOT EXISTS food_order_items (
    id          TEXT PRIMARY KEY,
    order_id    TEXT NOT NULL REFERENCES food_orders(id) ON DELETE CASCADE,
    player_id   TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    description TEXT NOT NULL,
    price_cents INTEGER,
    created_at  INTEGER NOT NULL
  );

  -- An-/Abreise: one self-service row per player/event, plus separate
  -- arrival/departure carpool groups that players can join/leave.
  CREATE TABLE IF NOT EXISTS arrivals (
    event_id     TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    player_id    TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    arrival_at   INTEGER,
    departure_at INTEGER,
    note         TEXT,
    updated_at   INTEGER NOT NULL,
    PRIMARY KEY (event_id, player_id)
  );

  -- created_by is always the driver (enforced in arrivals.ts: can't leave,
  -- only delete the whole group) - start_at/start_location/eta_at are the
  -- driver's plan (when/where they set off, and when they expect to
  -- arrive), seats_total caps how many others (not counting the driver) can
  -- join via carpool_members.
  CREATE TABLE IF NOT EXISTS carpools (
    id             TEXT PRIMARY KEY,
    event_id       TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    direction      TEXT NOT NULL,
    label          TEXT NOT NULL,
    start_at       INTEGER,
    start_location TEXT,
    eta_at         INTEGER,
    seats_total    INTEGER NOT NULL DEFAULT 3,
    created_by     TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    created_at     INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS carpool_members (
    carpool_id TEXT NOT NULL REFERENCES carpools(id) ON DELETE CASCADE,
    player_id  TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    PRIMARY KEY (carpool_id, player_id)
  );

  CREATE INDEX IF NOT EXISTS idx_skills_game ON skills(game_id);
  CREATE INDEX IF NOT EXISTS idx_preferences_game ON preferences(game_id);
  CREATE INDEX IF NOT EXISTS idx_live_status_games_game ON live_status_games(game_id);
  CREATE INDEX IF NOT EXISTS idx_votes_round ON votes(round);
  CREATE INDEX IF NOT EXISTS idx_votes_event ON votes(event_id);
  CREATE INDEX IF NOT EXISTS idx_vote_rounds_event ON vote_rounds(event_id);
  CREATE INDEX IF NOT EXISTS idx_seat_neighbors_event_player ON seat_neighbors(event_id, player_id);
  CREATE INDEX IF NOT EXISTS idx_game_pings_event ON game_pings(event_id, expires_at);
  CREATE INDEX IF NOT EXISTS idx_matches_game ON matches(game_id);
  CREATE INDEX IF NOT EXISTS idx_matches_event ON matches(event_id);
  CREATE INDEX IF NOT EXISTS idx_matchmaking_draws_event ON matchmaking_draws(event_id);
  CREATE INDEX IF NOT EXISTS idx_matchmaking_draws_game ON matchmaking_draws(game_id);
  CREATE INDEX IF NOT EXISTS idx_tournaments_event ON tournaments(event_id);
  CREATE INDEX IF NOT EXISTS idx_tournament_teams_tournament ON tournament_teams(tournament_id);
  CREATE INDEX IF NOT EXISTS idx_tournament_matches_tournament ON tournament_matches(tournament_id);
  CREATE INDEX IF NOT EXISTS idx_play_sessions_player ON play_sessions(player_id);
  CREATE INDEX IF NOT EXISTS idx_play_sessions_game ON play_sessions(game_id);
  CREATE INDEX IF NOT EXISTS idx_play_sessions_open ON play_sessions(ended_at);
  CREATE INDEX IF NOT EXISTS idx_play_sessions_event ON play_sessions(event_id);
  CREATE INDEX IF NOT EXISTS idx_push_subscriptions_player ON push_subscriptions(player_id);
  CREATE INDEX IF NOT EXISTS idx_drafts_status ON drafts(status);
  CREATE INDEX IF NOT EXISTS idx_broadcasts_created ON broadcasts(created_at);
  CREATE INDEX IF NOT EXISTS idx_push_log_created ON push_log(created_at);
  CREATE INDEX IF NOT EXISTS idx_quiz_seen_player ON quiz_seen(player_id);
  CREATE INDEX IF NOT EXISTS idx_scribble_seen_player ON scribble_seen(player_id);
  CREATE INDEX IF NOT EXISTS idx_food_orders_event ON food_orders(event_id, created_at);
  CREATE INDEX IF NOT EXISTS idx_food_order_items_order ON food_order_items(order_id);
  CREATE INDEX IF NOT EXISTS idx_arrivals_event ON arrivals(event_id, arrival_at, departure_at);
  CREATE INDEX IF NOT EXISTS idx_carpools_event ON carpools(event_id, direction, created_at);
  CREATE INDEX IF NOT EXISTS idx_carpool_members_carpool ON carpool_members(carpool_id);
`);

// Migration: older databases were created before the `avatar` column existed.
// CREATE TABLE IF NOT EXISTS above only applies to brand-new databases, so
// add it here if missing (checked via PRAGMA rather than a version counter —
// simple and idempotent, matches the size of this project).
function migrateAvatarColumn(): void {
  const columns = db.prepare('PRAGMA table_info(players)').all() as Array<{ name: string }>;
  if (columns.some((c) => c.name === 'avatar')) return;
  db.exec('ALTER TABLE players ADD COLUMN avatar TEXT');
}
migrateAvatarColumn();

// Migration: older databases predate the is_admin moderation flag.
function migrateAdminColumn(): void {
  const columns = db.prepare('PRAGMA table_info(players)').all() as Array<{ name: string }>;
  if (columns.some((c) => c.name === 'is_admin')) return;
  db.exec('ALTER TABLE players ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0');
}
migrateAdminColumn();

// Migration: older databases predate the is_test flag for admin-seeded test
// players (see testUsers.ts).
function migrateTestColumn(): void {
  const columns = db.prepare('PRAGMA table_info(players)').all() as Array<{ name: string }>;
  if (columns.some((c) => c.name === 'is_test')) return;
  db.exec('ALTER TABLE players ADD COLUMN is_test INTEGER NOT NULL DEFAULT 0');
}
migrateTestColumn();

function migrateGameIconImageColumn(): void {
  const columns = db.prepare('PRAGMA table_info(games)').all() as Array<{ name: string }>;
  if (columns.some((c) => c.name === 'icon_image')) return;
  db.exec('ALTER TABLE games ADD COLUMN icon_image TEXT');
}
migrateGameIconImageColumn();

// Migration: older databases predate the games/game_catalog merge (see
// server/CLAUDE.md games reorg) — games itself needs the catalog columns
// added, and if a standalone game_catalog table still exists from before the
// merge, its rows get folded into games (and its old 1-5 ratings into
// preferences, ×2 onto the shared 1-10 scale) before the legacy tables are
// dropped. A brand-new database gets both already via the schema above and
// never creates game_catalog in the first place, so this is a no-op there.
function migrateGamesCatalogMergeColumns(): void {
  const columns = db.prepare('PRAGMA table_info(games)').all() as Array<{ name: string }>;
  const has = (name: string) => columns.some((c) => c.name === name);
  if (!has('platform')) db.exec('ALTER TABLE games ADD COLUMN platform TEXT');
  if (!has('platform_url')) db.exec('ALTER TABLE games ADD COLUMN platform_url TEXT');
  if (!has('trailer_url')) db.exec('ALTER TABLE games ADD COLUMN trailer_url TEXT');
  if (!has('status')) db.exec("ALTER TABLE games ADD COLUMN status TEXT NOT NULL DEFAULT 'catalog'");
  if (!has('created_by')) db.exec('ALTER TABLE games ADD COLUMN created_by TEXT REFERENCES players(id) ON DELETE SET NULL');
}
migrateGamesCatalogMergeColumns();

function migrateLegacyGameCatalogIntoGames(): void {
  const catalogTableExists = db
    .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'game_catalog'`)
    .get();
  if (!catalogTableExists) return;

  interface LegacyCatalogRow {
    id: string;
    title: string;
    platform: string | null;
    platform_url: string | null;
    trailer_url: string | null;
    is_suggestion: number;
    created_by: string | null;
    created_at: number;
  }
  const catalogRows = db.prepare('SELECT * FROM game_catalog').all() as LegacyCatalogRow[];
  const findGameByName = db.prepare('SELECT id FROM games WHERE name = ? COLLATE NOCASE');
  // COALESCE: a title that already exists as a game (e.g. "Rocket League" was
  // both a tracked game and a catalog entry before the merge) only gets its
  // blank catalog fields filled in — the tracked row's own data always wins.
  const fillMissing = db.prepare(
    `UPDATE games SET platform = COALESCE(platform, ?), platform_url = COALESCE(platform_url, ?), trailer_url = COALESCE(trailer_url, ?) WHERE id = ?`
  );
  const insertGame = db.prepare(
    `INSERT INTO games (id, name, icon, min_team_size, max_team_size, created_at, platform, platform_url, trailer_url, status, created_by)
     VALUES (?, ?, '🎮', 1, 5, ?, ?, ?, ?, ?, ?)`
  );

  // catalog_id -> the games.id its ratings should be re-homed to.
  const resolvedGameId = new Map<string, string>();

  db.transaction(() => {
    for (const row of catalogRows) {
      const existing = findGameByName.get(row.title) as { id: string } | undefined;
      if (existing) {
        fillMissing.run(row.platform, row.platform_url, row.trailer_url, existing.id);
        resolvedGameId.set(row.id, existing.id);
      } else {
        insertGame.run(
          row.id,
          row.title,
          row.created_at,
          row.platform,
          row.platform_url,
          row.trailer_url,
          row.is_suggestion ? 'suggestion' : 'catalog',
          row.created_by
        );
        resolvedGameId.set(row.id, row.id);
      }
    }

    const ratingRows = db.prepare('SELECT catalog_id, player_id, rating FROM game_catalog_ratings').all() as Array<{
      catalog_id: string;
      player_id: string;
      rating: number;
    }>;
    // Never overwrites a preference the player already has on the merged
    // game — the 1-10 "Bock" scale (changeable on a whim throughout the LAN)
    // is more current than a one-time 1-5 catalog rating from before the merge.
    const insertPreference = db.prepare('INSERT OR IGNORE INTO preferences (player_id, game_id, rating) VALUES (?, ?, ?)');
    for (const r of ratingRows) {
      const gameId = resolvedGameId.get(r.catalog_id);
      if (!gameId) continue;
      insertPreference.run(r.player_id, gameId, Math.min(10, r.rating * 2));
    }

    db.exec('DROP TABLE game_catalog_ratings');
    db.exec('DROP TABLE game_catalog_interest');
    db.exec('DROP TABLE game_catalog');
  })();
}
migrateLegacyGameCatalogIntoGames();

// Migration: older databases predate the optional "wann geht's raus"
// send_at field on food orders.
function migrateFoodOrderSendAtColumn(): void {
  const columns = db.prepare('PRAGMA table_info(food_orders)').all() as Array<{ name: string }>;
  if (columns.some((c) => c.name === 'send_at')) return;
  db.exec('ALTER TABLE food_orders ADD COLUMN send_at INTEGER');
}
migrateFoodOrderSendAtColumn();

// Migration: older databases predate the optional notes/link fields on food
// orders (free-text info + link to the menu/delivery service).
function migrateFoodOrderNotesLinkColumns(): void {
  const columns = db.prepare('PRAGMA table_info(food_orders)').all() as Array<{ name: string }>;
  const has = (name: string) => columns.some((c) => c.name === name);
  if (!has('notes')) db.exec('ALTER TABLE food_orders ADD COLUMN notes TEXT');
  if (!has('link')) db.exec('ALTER TABLE food_orders ADD COLUMN link TEXT');
}
migrateFoodOrderNotesLinkColumns();

// Migration: older databases predate the carpool driver plan (when/where
// they start, ETA, seat count).
function migrateCarpoolPlanColumns(): void {
  const columns = db.prepare('PRAGMA table_info(carpools)').all() as Array<{ name: string }>;
  const has = (name: string) => columns.some((c) => c.name === name);
  if (!has('start_at')) db.exec('ALTER TABLE carpools ADD COLUMN start_at INTEGER');
  if (!has('start_location')) db.exec('ALTER TABLE carpools ADD COLUMN start_location TEXT');
  if (!has('eta_at')) db.exec('ALTER TABLE carpools ADD COLUMN eta_at INTEGER');
  if (!has('seats_total')) db.exec('ALTER TABLE carpools ADD COLUMN seats_total INTEGER NOT NULL DEFAULT 3');
}
migrateCarpoolPlanColumns();

// Migration: older databases predate the group-knockout format and score
// tracking (both added together) — add the columns they need if missing.
function migrateTournamentColumns(): void {
  const tournamentColumns = db.prepare('PRAGMA table_info(tournaments)').all() as Array<{ name: string }>;
  const has = (name: string) => tournamentColumns.some((c) => c.name === name);
  if (!has('track_score')) db.exec('ALTER TABLE tournaments ADD COLUMN track_score INTEGER NOT NULL DEFAULT 0');
  if (!has('group_count')) db.exec('ALTER TABLE tournaments ADD COLUMN group_count INTEGER');
  if (!has('advancers_per_group')) db.exec('ALTER TABLE tournaments ADD COLUMN advancers_per_group INTEGER');

  const teamColumns = db.prepare('PRAGMA table_info(tournament_teams)').all() as Array<{ name: string }>;
  if (!teamColumns.some((c) => c.name === 'group_index')) {
    db.exec('ALTER TABLE tournament_teams ADD COLUMN group_index INTEGER');
  }

  const matchColumns = db.prepare('PRAGMA table_info(tournament_matches)').all() as Array<{ name: string }>;
  const hasMatchCol = (name: string) => matchColumns.some((c) => c.name === name);
  if (!hasMatchCol('stage')) db.exec('ALTER TABLE tournament_matches ADD COLUMN stage TEXT');
  if (!hasMatchCol('group_index')) db.exec('ALTER TABLE tournament_matches ADD COLUMN group_index INTEGER');
  if (!hasMatchCol('score_a')) db.exec('ALTER TABLE tournament_matches ADD COLUMN score_a INTEGER');
  if (!hasMatchCol('score_b')) db.exec('ALTER TABLE tournament_matches ADD COLUMN score_b INTEGER');

  if (!has('lobby_name')) db.exec('ALTER TABLE tournaments ADD COLUMN lobby_name TEXT');
  if (!has('lobby_password')) db.exec('ALTER TABLE tournaments ADD COLUMN lobby_password TEXT');
}
migrateTournamentColumns();

// Migration: older databases predate linking a matchmaking draw to the match
// result eventually recorded for it (Team-Historie -> Ergebnis-Historie).
function migrateMatchmakingDrawsColumns(): void {
  const columns = db.prepare('PRAGMA table_info(matchmaking_draws)').all() as Array<{ name: string }>;
  if (!columns.some((c) => c.name === 'match_id')) {
    db.exec('ALTER TABLE matchmaking_draws ADD COLUMN match_id TEXT REFERENCES matches(id) ON DELETE SET NULL');
  }
  if (!columns.some((c) => c.name === 'source')) {
    db.exec('ALTER TABLE matchmaking_draws ADD COLUMN source TEXT');
  }
}
migrateMatchmakingDrawsColumns();

// Migration: older databases predate the foreground-game tracking columns
// (which game of possibly several is actually focused right now).
function migrateForegroundColumns(): void {
  const liveStatusColumns = db.prepare('PRAGMA table_info(live_status)').all() as Array<{ name: string }>;
  if (!liveStatusColumns.some((c) => c.name === 'activity_tracked')) {
    db.exec('ALTER TABLE live_status ADD COLUMN activity_tracked INTEGER NOT NULL DEFAULT 0');
  }
  const liveStatusGamesColumns = db.prepare('PRAGMA table_info(live_status_games)').all() as Array<{ name: string }>;
  if (!liveStatusGamesColumns.some((c) => c.name === 'is_foreground')) {
    db.exec('ALTER TABLE live_status_games ADD COLUMN is_foreground INTEGER NOT NULL DEFAULT 0');
  }
}
migrateForegroundColumns();

// Migration: older databases predate the points-mode voting round (added
// alongside the "Bock"/preference feature). votes used to have
// UNIQUE(player_id, round) and no points column; points-mode needs several
// rows per player per round (one per game they gave points to), so the
// constraint has to widen to (player_id, round, game_id). better-sqlite3
// can't ALTER an inline UNIQUE constraint, so detect the old one via
// index_info and rebuild the table when found; the points column and
// vote_rounds.mode are plain ADD COLUMNs.
function migrateVotesPointsMode(): void {
  const voteRoundsColumns = db.prepare('PRAGMA table_info(vote_rounds)').all() as Array<{ name: string }>;
  if (!voteRoundsColumns.some((c) => c.name === 'mode')) {
    db.exec("ALTER TABLE vote_rounds ADD COLUMN mode TEXT NOT NULL DEFAULT 'single'");
  }

  const voteColumns = db.prepare('PRAGMA table_info(votes)').all() as Array<{ name: string }>;
  const hasPoints = voteColumns.some((c) => c.name === 'points');

  const indexes = db.prepare('PRAGMA index_list(votes)').all() as Array<{ name: string; unique: number }>;
  const oldUniqueIndex = indexes.find((idx) => {
    if (!idx.unique) return false;
    const cols = (db.prepare(`PRAGMA index_info(${idx.name})`).all() as Array<{ name: string }>).map((c) => c.name);
    return cols.length === 2 && cols[0] === 'player_id' && cols[1] === 'round';
  });

  if (hasPoints && !oldUniqueIndex) return; // already migrated, or a fresh DB

  db.transaction(() => {
    if (!hasPoints) db.exec('ALTER TABLE votes ADD COLUMN points INTEGER');
    if (oldUniqueIndex) {
      db.exec(`
        CREATE TABLE votes_new (
          id         TEXT PRIMARY KEY,
          player_id  TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
          game_id    TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
          event_id   TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
          round      INTEGER NOT NULL,
          points     INTEGER CHECK (points IS NULL OR points BETWEEN 1 AND 10),
          created_at INTEGER NOT NULL,
          UNIQUE (player_id, round, game_id)
        );
      `);
      db.exec(
        'INSERT INTO votes_new (id, player_id, game_id, event_id, round, points, created_at) ' +
          'SELECT id, player_id, game_id, event_id, round, points, created_at FROM votes'
      );
      db.exec('DROP TABLE votes');
      db.exec('ALTER TABLE votes_new RENAME TO votes');
      db.exec('CREATE INDEX IF NOT EXISTS idx_votes_round ON votes(round)');
      db.exec('CREATE INDEX IF NOT EXISTS idx_votes_event ON votes(event_id)');
    }
  })();
}
migrateVotesPointsMode();

// Migration: older databases predate the round title/info/selected-games
// fields (a round used to be identified only by its number and mode).
function migrateVoteRoundsMetaColumns(): void {
  const columns = db.prepare('PRAGMA table_info(vote_rounds)').all() as Array<{ name: string }>;
  if (!columns.some((c) => c.name === 'title')) db.exec('ALTER TABLE vote_rounds ADD COLUMN title TEXT');
  if (!columns.some((c) => c.name === 'info')) db.exec('ALTER TABLE vote_rounds ADD COLUMN info TEXT');
  if (!columns.some((c) => c.name === 'selected_game_ids')) {
    db.exec('ALTER TABLE vote_rounds ADD COLUMN selected_game_ids TEXT');
  }
}
migrateVoteRoundsMetaColumns();

// Migration: older databases predate the optional location/description
// event fields.
function migrateEventColumns(): void {
  const columns = db.prepare('PRAGMA table_info(events)').all() as Array<{ name: string }>;
  const has = (name: string) => columns.some((c) => c.name === name);
  if (!has('location')) db.exec('ALTER TABLE events ADD COLUMN location TEXT');
  if (!has('description')) db.exec('ALTER TABLE events ADD COLUMN description TEXT');
}
migrateEventColumns();

// Fixed id for the permanent "außerhalb von Events" sentinel — see the
// `events` table comment above for why this exists. Exported so events.ts
// can recognize/exclude it without duplicating the constant.
export const OUTSIDE_EVENTS_ID = 'outside-events';

// Migration: older databases predate the tracking_enabled/ended_at event
// columns, event_participants, and players.tracking_paused (all added
// together, replacing the old "exactly one active event" model with
// "several events, at most one tracking"). If this is an upgrade (the
// columns didn't exist yet), preserve continuity by turning tracking on for
// whichever event used to be "active" under the old model and rostering
// every current player onto it — otherwise an in-progress LAN would
// silently stop being tracked the moment the server restarts on the new
// version.
function migrateEventTrackingColumns(): void {
  const columns = db.prepare('PRAGMA table_info(events)').all() as Array<{ name: string }>;
  const isUpgrade = !columns.some((c) => c.name === 'tracking_enabled');
  if (isUpgrade) db.exec('ALTER TABLE events ADD COLUMN tracking_enabled INTEGER NOT NULL DEFAULT 0');
  if (!columns.some((c) => c.name === 'ended_at')) db.exec('ALTER TABLE events ADD COLUMN ended_at INTEGER');

  db.exec(`
    CREATE TABLE IF NOT EXISTS event_participants (
      event_id  TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
      player_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
      PRIMARY KEY (event_id, player_id)
    );
  `);

  const playerColumns = db.prepare('PRAGMA table_info(players)').all() as Array<{ name: string }>;
  if (!playerColumns.some((c) => c.name === 'tracking_paused')) {
    db.exec('ALTER TABLE players ADD COLUMN tracking_paused INTEGER NOT NULL DEFAULT 0');
  }

  if (isUpgrade) {
    const previousActiveId = getState('active_event_id');
    if (previousActiveId) {
      db.prepare('UPDATE events SET tracking_enabled = 1 WHERE id = ?').run(previousActiveId);
      const players = db.prepare('SELECT id FROM players').all() as Array<{ id: string }>;
      const insertParticipant = db.prepare(
        'INSERT OR IGNORE INTO event_participants (event_id, player_id) VALUES (?, ?)'
      );
      for (const p of players) insertParticipant.run(previousActiveId, p.id);
    }
  }
}
// Called further down, once app_state (and getState/setState) exist — see
// the call site right after those are defined.

// Gamer names must be unique across the whole player list (case-insensitive)
// so invited players can tell each other apart. A unique index rather than a
// column constraint so it also applies to databases migrating in from before
// this rule existed. Wrapped defensively: if an existing database somehow
// already has two players sharing a name, creating the index would throw and
// take the whole server down on startup, which would be far worse than
// leaving the (rare, pre-existing) duplicate unenforced until someone renames
// one of them.
function ensureUniquePlayerNames(): void {
  try {
    db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_players_name_unique ON players (name COLLATE NOCASE)');
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('Konnte eindeutigen Namens-Index nicht anlegen (vermutlich Duplikate in bestehenden Daten):', err);
  }
}
ensureUniquePlayerNames();

// Key/value table for small bits of server state (e.g. current vote round).
db.exec(`
  CREATE TABLE IF NOT EXISTS app_state (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`);

export function getState(key: string): string | undefined {
  const row = db.prepare('SELECT value FROM app_state WHERE key = ?').get(key) as
    | { value: string }
    | undefined;
  return row?.value;
}

export function setState(key: string, value: string): void {
  db.prepare(
    `INSERT INTO app_state (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  ).run(key, value);
}

// Needs app_state (just above) to exist first for its upgrade-continuity
// backfill, which reads the old active_event_id key.
migrateEventTrackingColumns();

function migrateSeatNeighborsSourceColumn(): void {
  const columns = db.prepare('PRAGMA table_info(seat_neighbors)').all() as Array<{ name: string }>;
  if (columns.some((c) => c.name === 'source')) return;
  db.exec("ALTER TABLE seat_neighbors ADD COLUMN source TEXT NOT NULL DEFAULT 'manual'");
}
migrateSeatNeighborsSourceColumn();

// Seed the games we actually play, once, on an empty database. Process-name
// mappings are best-effort defaults and can be edited later in the UI.
function seedGames(): void {
  const count = (db.prepare('SELECT COUNT(*) AS n FROM games').get() as { n: number }).n;
  if (count > 0) return;

  const now = Date.now();
  const insertGame = db.prepare(
    `INSERT INTO games (id, name, icon, min_team_size, max_team_size, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  );
  const insertProc = db.prepare(
    `INSERT OR IGNORE INTO game_process_names (id, game_id, process_name) VALUES (?, ?, ?)`
  );

  const defaults: Array<{
    name: string;
    icon: string;
    min: number;
    max: number;
    procs: string[];
  }> = [
    { name: 'Counter-Strike 2', icon: '🔫', min: 1, max: 5, procs: ['cs2.exe'] },
    { name: 'Rocket League', icon: '🚗', min: 1, max: 3, procs: ['rocketleague.exe'] },
    { name: 'League of Legends', icon: '⚔️', min: 1, max: 5, procs: ['league of legends.exe', 'leagueclient.exe'] },
    { name: 'Warcraft III', icon: '🛡️', min: 1, max: 4, procs: ['warcraft iii.exe', 'war3.exe', 'warcraft3.exe'] },
    { name: 'Golf with your Friends', icon: '⛳', min: 1, max: 8, procs: ['golfwithyourfriends.exe'] },
  ];

  const seed = db.transaction(() => {
    for (const g of defaults) {
      const gameId = nanoid();
      insertGame.run(gameId, g.name, g.icon, g.min, g.max, now);
      for (const p of g.procs) {
        insertProc.run(nanoid(), gameId, p.toLowerCase());
      }
    }
  });
  seed();
}

seedGames();

function seedQuizQuestions(): void {
  const count = (db.prepare('SELECT COUNT(*) AS n FROM quiz_questions').get() as { n: number }).n;
  if (count > 0) return;

  const now = Date.now();
  const insert = db.prepare(
    'INSERT INTO quiz_questions (id, question, answers, category, difficulty, created_at) VALUES (?, ?, ?, ?, ?, ?)'
  );
  db.transaction(() => {
    for (const q of DEFAULT_QUIZ_QUESTIONS) {
      insert.run(nanoid(), q.question, JSON.stringify(q.answers), q.category, q.difficulty, now);
    }
  })();
}

// Classic Warcraft III (The Frozen Throne) — deliberately not the generated
// "<title> gameplay trailer" search, which surfaces Reforged material.
const WARCRAFT3_TFT_TRAILER_URL =
  'https://www.youtube.com/results?search_query=Warcraft%203%20The%20Frozen%20Throne%20gameplay';

// One-time catalog revision (July 2026): seedCatalogGames() below only ever
// fills blank fields, so removals/renames from the planning sheet never reach
// a database that has already been seeded. This applies them once, guarded by
// an app_state key. Must run BEFORE seedCatalogGames(), otherwise the seed
// would insert the renamed titles as fresh rows next to the old ones.
function cleanupCatalogGames(): void {
  const KEY = 'catalog_cleanup_2026_07';
  if (getState(KEY)) return;

  const removedTitles = ['CS 1.5', 'CS 1.6', 'CS GO', 'Iron Harvest', 'Splitgate', 'Worms', 'Warcraft 3'];
  const renames: Array<{ from: string; to: string; platformUrl: string; trailerUrl: string }> = [
    {
      from: 'Star Wars Battlefront',
      to: 'Star Wars Battlefront 2',
      platformUrl: 'https://store.steampowered.com/app/1237950/STAR_WARS_Battlefront_II/',
      trailerUrl: 'https://www.youtube.com/results?search_query=Star%20Wars%20Battlefront%202%20gameplay%20trailer',
    },
    {
      from: 'Trackmania',
      to: 'TrackMania Nations Forever',
      platformUrl: 'https://store.steampowered.com/app/11020/TrackMania_Nations_Forever/',
      trailerUrl: 'https://www.youtube.com/results?search_query=TrackMania%20Nations%20Forever%20gameplay%20trailer',
    },
  ];

  const findByName = db.prepare('SELECT id FROM games WHERE name = ? COLLATE NOCASE');
  // Cascades to process names, skills, preferences, votes, matches via the
  // schema's ON DELETE clauses (foreign_keys pragma is ON).
  const deleteGame = db.prepare('DELETE FROM games WHERE name = ? COLLATE NOCASE');
  const applyRename = db.prepare('UPDATE games SET name = ?, platform_url = ?, trailer_url = ? WHERE id = ?');

  db.transaction(() => {
    // "Warcraft 3" (the NAS catalog duplicate) goes away; the tracked
    // "Warcraft III" row stays and gets the NAS platform + classic trailer.
    for (const title of removedTitles) deleteGame.run(title);

    for (const r of renames) {
      const source = findByName.get(r.from) as { id: string } | undefined;
      const target = findByName.get(r.to) as { id: string } | undefined;
      // Skip if the old title is gone or the new one already exists — an
      // admin got there first, and games.name must stay unique.
      if (!source || target) continue;
      applyRename.run(r.to, r.platformUrl, r.trailerUrl, source.id);
    }

    const warcraft = findByName.get('Warcraft III') as { id: string } | undefined;
    if (warcraft) {
      db.prepare('UPDATE games SET platform = ?, trailer_url = ? WHERE id = ?').run(
        'NAS',
        WARCRAFT3_TFT_TRAILER_URL,
        warcraft.id
      );
    }

    setState(KEY, String(Date.now()));
  })();
}

// Seed the broader "could we play this?" pool directly into games (status
// 'catalog') from the shared planning sheet. Runs every start, not just on an
// empty database, since it also fills in platform/trailer for a title that
// already exists as a tracked game (e.g. "Rocket League") — COALESCE below
// only touches still-blank fields, so an admin's own edit is never reverted.
function seedCatalogGames(): void {
  const now = Date.now();
  const trailer = (title: string) => `https://www.youtube.com/results?search_query=${encodeURIComponent(`${title} gameplay trailer`)}`;
  const defaults: Array<{ title: string; platform: string; platformUrl: string | null; trailerUrl?: string }> = [
    { title: 'Age of Empires 2', platform: 'Steam', platformUrl: 'https://store.steampowered.com/app/813780/Age_of_Empires_II_Definitive_Edition/' },
    { title: 'Age of Empires 4', platform: 'Steam', platformUrl: 'https://store.steampowered.com/app/1466860/Age_of_Empires_IV_Anniversary_Edition/' },
    { title: 'Among Us', platform: 'Steam', platformUrl: 'https://store.steampowered.com/app/945360/Among_Us/' },
    { title: 'Back 4 Blood', platform: 'Steam', platformUrl: 'https://store.steampowered.com/app/924970/Back_4_Blood/' },
    { title: 'C&C Generals', platform: 'EA', platformUrl: 'https://www.ea.com/games/command-and-conquer/command-and-conquer-generals' },
    { title: 'Call of Duty 4 - Modern Warfare', platform: 'Steam', platformUrl: 'https://store.steampowered.com/app/7940/Call_of_Duty_4_Modern_Warfare_2007/' },
    { title: 'Call of Duty II', platform: 'Steam', platformUrl: 'https://store.steampowered.com/app/2630/Call_of_Duty_2/' },
    { title: 'Chivalry 2', platform: 'Steam', platformUrl: 'https://store.steampowered.com/app/1824220/Chivalry_2/' },
    { title: 'Dawn of War', platform: 'Steam', platformUrl: 'https://store.steampowered.com/app/4570/Warhammer_40000_Dawn_of_War__Game_of_the_Year_Edition/' },
    { title: 'DOTA 2', platform: 'Steam', platformUrl: 'https://store.steampowered.com/app/570/Dota_2/' },
    { title: 'Fall Guys', platform: 'Epic', platformUrl: 'https://store.epicgames.com/p/fall-guys' },
    { title: 'Golf with your Friends', platform: 'Steam', platformUrl: 'https://store.steampowered.com/app/431240/Golf_With_Your_Friends/' },
    { title: 'GRID', platform: 'Steam', platformUrl: 'https://store.steampowered.com/search/?term=GRID' },
    { title: 'Halo Infinite', platform: 'Steam', platformUrl: 'https://store.steampowered.com/app/1240440/Halo_Infinite/' },
    { title: 'Hot Wheels Unleashed', platform: 'Steam', platformUrl: 'https://store.steampowered.com/app/1271700/HOT_WHEELS_UNLEASHED/' },
    { title: 'Jedi Knight II', platform: 'Steam', platformUrl: 'https://store.steampowered.com/app/6030/STAR_WARS_Jedi_Knight_II_Jedi_Outcast/' },
    { title: 'League of Legends', platform: 'Riot', platformUrl: 'https://www.leagueoflegends.com/' },
    { title: 'Rocket League', platform: 'Epic', platformUrl: 'https://store.epicgames.com/p/rocket-league' },
    { title: 'Sea of Thieves', platform: 'Steam', platformUrl: 'https://store.steampowered.com/app/1172620/Sea_of_Thieves_2024_Edition/' },
    { title: 'Star Wars Battlefront 2', platform: 'Steam', platformUrl: 'https://store.steampowered.com/app/1237950/STAR_WARS_Battlefront_II/' },
    { title: 'Starcraft 2', platform: 'Battle.net', platformUrl: 'https://starcraft2.blizzard.com/' },
    { title: 'Team Fortress 2', platform: 'Steam', platformUrl: 'https://store.steampowered.com/app/440/Team_Fortress_2/' },
    { title: 'TrackMania Nations Forever', platform: 'Steam', platformUrl: 'https://store.steampowered.com/app/11020/TrackMania_Nations_Forever/' },
    { title: 'Tricky Towers', platform: 'Steam', platformUrl: 'https://store.steampowered.com/app/437920/Tricky_Towers/' },
    { title: 'Ultimate Chicken Horse', platform: 'Steam', platformUrl: 'https://store.steampowered.com/app/386940/Ultimate_Chicken_Horse/' },
    { title: 'UT2003', platform: 'NAS', platformUrl: null },
    { title: 'UT2004', platform: 'NAS', platformUrl: null },
    // The classic The Frozen Throne install from the NAS, not Reforged — hence
    // the explicit trailer override instead of the generated title search.
    { title: 'Warcraft III', platform: 'NAS', platformUrl: null, trailerUrl: WARCRAFT3_TFT_TRAILER_URL },
    { title: 'Wreckfest', platform: 'Steam', platformUrl: 'https://store.steampowered.com/app/228380/Wreckfest/' },
  ];

  const findByName = db.prepare('SELECT id FROM games WHERE name = ? COLLATE NOCASE');
  const insertGame = db.prepare(
    `INSERT INTO games (id, name, icon, min_team_size, max_team_size, created_at, platform, platform_url, trailer_url, status)
     VALUES (?, ?, '🎮', 1, 5, ?, ?, ?, ?, 'catalog')`
  );
  const fillMissing = db.prepare(
    `UPDATE games SET platform = COALESCE(platform, ?), platform_url = COALESCE(platform_url, ?), trailer_url = COALESCE(trailer_url, ?) WHERE id = ?`
  );

  db.transaction(() => {
    for (const g of defaults) {
      const trailerUrl = g.trailerUrl ?? trailer(g.title);
      const existing = findByName.get(g.title) as { id: string } | undefined;
      if (existing) {
        fillMissing.run(g.platform, g.platformUrl, trailerUrl, existing.id);
      } else {
        insertGame.run(nanoid(), g.title, now, g.platform, g.platformUrl, trailerUrl);
      }
    }
  })();
}

function seedScribbleWords(): void {
  const count = (db.prepare('SELECT COUNT(*) AS n FROM scribble_words').get() as { n: number }).n;
  if (count > 0) return;

  const now = Date.now();
  const insert = db.prepare('INSERT INTO scribble_words (id, word, difficulty, created_at) VALUES (?, ?, ?, ?)');
  db.transaction(() => {
    for (const w of DEFAULT_SCRIBBLE_WORDS) {
      insert.run(nanoid(), w.word, w.difficulty, now);
    }
  })();
}

seedQuizQuestions();
seedScribbleWords();
cleanupCatalogGames();
seedCatalogGames();

// Seed the permanent "außerhalb von Events" sentinel, once. This is the ONLY
// place that ever creates it: events.ts's getTrackingEventId() is a pure
// reader that assumes this has already run. Never touched again after —
// no tracking, no roster, no end date, always present as the fallback
// event_id for anything recorded while no real event is tracking.
function seedOutsideEventsEvent(): void {
  const exists = db.prepare('SELECT 1 FROM events WHERE id = ?').get(OUTSIDE_EVENTS_ID);
  if (exists) return;
  db.prepare(
    `INSERT INTO events (id, name, starts_at, ends_at, location, description, tracking_enabled, ended_at)
     VALUES (?, ?, ?, NULL, NULL, NULL, 0, NULL)`
  ).run(OUTSIDE_EVENTS_ID, 'Außerhalb von Events', Date.now());
}

seedOutsideEventsEvent();
