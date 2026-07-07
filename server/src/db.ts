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
    id         TEXT PRIMARY KEY,
    name       TEXT NOT NULL,
    color      TEXT NOT NULL DEFAULT '#4f9dff',
    avatar     TEXT,
    api_key    TEXT NOT NULL UNIQUE,
    created_at INTEGER NOT NULL
  );

  -- LAN events (e.g. "LAN Party Sommer 2026"). Exactly one is active at a
  -- time (ends_at IS NULL); starting a new one closes the previous one.
  -- Players, games and skills stay global across events on purpose (the same
  -- friend group year after year) — only live/session/vote/match data is
  -- scoped per event so analytics can be viewed per LAN afterwards.
  CREATE TABLE IF NOT EXISTS events (
    id         TEXT PRIMARY KEY,
    name       TEXT NOT NULL,
    starts_at  INTEGER NOT NULL,
    ends_at    INTEGER
  );

  CREATE TABLE IF NOT EXISTS games (
    id            TEXT PRIMARY KEY,
    name          TEXT NOT NULL,
    icon          TEXT NOT NULL DEFAULT '🎮',
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

  -- Per-player live meta: when the agent last reported and an optional manual
  -- override (e.g. "Pause/Essen"). Which games are currently running lives in
  -- live_status_games below, since a PC can run several games at once
  -- (e.g. a launcher + the actual game, or genuinely two games side by side).
  CREATE TABLE IF NOT EXISTS live_status (
    player_id   TEXT PRIMARY KEY REFERENCES players(id) ON DELETE CASCADE,
    last_seen   INTEGER NOT NULL,   -- last agent report (ms UTC)
    manual_note TEXT                -- optional manual override text (e.g. "Pause")
  );

  -- One row per game currently detected as running for a player. Rows are
  -- added/removed on every agent report to match what's actually running.
  CREATE TABLE IF NOT EXISTS live_status_games (
    player_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    game_id   TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
    since     INTEGER NOT NULL,     -- when this game started (ms UTC)
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

  -- Simple single active vote for "what's next". One row per player per open
  -- vote round is enforced in the application layer. Round numbers increment
  -- forever (never reset per event) so the UNIQUE constraint stays valid
  -- across event boundaries; event_id is stored for historical filtering.
  CREATE TABLE IF NOT EXISTS votes (
    id         TEXT PRIMARY KEY,
    player_id  TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    game_id    TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
    event_id   TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    round      INTEGER NOT NULL,   -- vote round id, lets us reset without deleting history
    created_at INTEGER NOT NULL,
    UNIQUE (player_id, round)
  );

  -- One row per vote round, so the history view can list past rounds even
  -- ones nobody voted in (which would otherwise leave no trace in the votes
  -- table at all). Written on /start, filled in with the winner(s) on /close;
  -- deleted on /cancel so mistaken rounds don't linger in the history,
  -- mirroring the votes rows themselves being deleted on cancel.
  CREATE TABLE IF NOT EXISTS vote_rounds (
    round           INTEGER PRIMARY KEY,
    event_id        TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
    started_at      INTEGER NOT NULL,
    closed_at       INTEGER,
    winner_game_ids TEXT   -- JSON array of game ids, set on close
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

  CREATE INDEX IF NOT EXISTS idx_skills_game ON skills(game_id);
  CREATE INDEX IF NOT EXISTS idx_live_status_games_game ON live_status_games(game_id);
  CREATE INDEX IF NOT EXISTS idx_votes_round ON votes(round);
  CREATE INDEX IF NOT EXISTS idx_votes_event ON votes(event_id);
  CREATE INDEX IF NOT EXISTS idx_vote_rounds_event ON vote_rounds(event_id);
  CREATE INDEX IF NOT EXISTS idx_matches_game ON matches(game_id);
  CREATE INDEX IF NOT EXISTS idx_matches_event ON matches(event_id);
  CREATE INDEX IF NOT EXISTS idx_play_sessions_player ON play_sessions(player_id);
  CREATE INDEX IF NOT EXISTS idx_play_sessions_game ON play_sessions(game_id);
  CREATE INDEX IF NOT EXISTS idx_play_sessions_open ON play_sessions(ended_at);
  CREATE INDEX IF NOT EXISTS idx_play_sessions_event ON play_sessions(event_id);
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

const ACTIVE_EVENT_KEY = 'active_event_id';

// Seed a default event, once, on an empty database. This is the ONLY place
// that ever creates the first event: events.ts's getActiveEventId() is a
// pure reader that assumes this has already run. Deliberately NOT done
// lazily inside a request handler — startNewEvent() clears live_status as
// part of starting fresh, and calling it reactively mid-transaction (e.g.
// from inside the agent report handler) would wipe out data that same
// request had just written moments earlier.
function seedDefaultEvent(): void {
  if (getState(ACTIVE_EVENT_KEY)) return;
  const id = nanoid();
  db.prepare('INSERT INTO events (id, name, starts_at, ends_at) VALUES (?, ?, ?, NULL)').run(
    id,
    'LAN Party',
    Date.now()
  );
  setState(ACTIVE_EVENT_KEY, id);
}

seedDefaultEvent();
