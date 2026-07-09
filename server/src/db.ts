// SQLite access layer. better-sqlite3 is synchronous, which keeps handlers
// simple and predictable for a tool of this size. The schema is created on
// first run and seeded with our default games.

import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { nanoid } from 'nanoid';
import { config } from './config';

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

  CREATE TABLE IF NOT EXISTS games (
    id            TEXT PRIMARY KEY,
    name          TEXT NOT NULL,
    icon          TEXT NOT NULL DEFAULT '🎮',
    icon_image    TEXT,    -- optional data: URL (self-uploaded box art/logo), takes over from icon when set
    min_team_size INTEGER NOT NULL DEFAULT 1,
    max_team_size INTEGER NOT NULL DEFAULT 5,
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
    round           INTEGER PRIMARY KEY,
    event_id        TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    started_at      INTEGER NOT NULL,
    closed_at       INTEGER,
    winner_game_ids TEXT,   -- JSON array of game ids, set on close
    mode            TEXT NOT NULL DEFAULT 'single'
  );

  -- Physical seating declared per event (FR-18 extension): "player_id sits
  -- next to neighbor_id". Self-service, one row per direction a player
  -- declares (so a player can update their own row without needing their
  -- neighbor to also confirm it) — matchmaking treats the pair as adjacent
  -- if either direction exists. Scoped per event since people sit somewhere
  -- different at every LAN.
  CREATE TABLE IF NOT EXISTS seat_neighbors (
    event_id    TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    player_id   TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    neighbor_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    PRIMARY KEY (event_id, player_id, neighbor_id)
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
    generated_at          INTEGER NOT NULL
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
    created_at           INTEGER NOT NULL
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

function migrateGameIconImageColumn(): void {
  const columns = db.prepare('PRAGMA table_info(games)').all() as Array<{ name: string }>;
  if (columns.some((c) => c.name === 'icon_image')) return;
  db.exec('ALTER TABLE games ADD COLUMN icon_image TEXT');
}
migrateGameIconImageColumn();

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
}
migrateTournamentColumns();

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
