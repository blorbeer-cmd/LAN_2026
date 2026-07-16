// Integration tests for db.ts's startup migrations. Unlike every other test
// file (which imports the modern schema fresh via DB_FILE=:memory:), these
// build a *legacy* on-disk database by hand — the exact pre-migration shape
// an upgraded production DB would have — then run the real db.ts module
// against it in a child process (its migrations are top-level side effects
// that run once per process, keyed off config.dbFile at import time, so a
// fresh process per fixture is the only way to exercise them at all). This
// is the one place a bug means corrupted data or a crash on the single real
// database from the previous LAN, not a throwaway in-memory one.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import Database from 'better-sqlite3';

const DB_JS_PATH = path.join(__dirname, '..', 'db.js');

function makeTempDbPath(name: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lan2026-migration-test-'));
  return path.join(dir, `${name}.db`);
}

// Runs the real db.ts module (compiled) against the given file in a fresh
// node process, so its module-level migrations execute exactly once against
// this exact fixture.
function runMigrations(dbFile: string): void {
  execFileSync(process.execPath, ['-e', `require(${JSON.stringify(DB_JS_PATH)})`], {
    env: { ...process.env, DB_FILE: dbFile },
    stdio: 'pipe',
  });
}

test('legacy game_catalog tables are merged into games and preferences', () => {
  const dbFile = makeTempDbPath('catalog-merge');
  const now = Date.now();

  const fixture = new Database(dbFile);
  fixture.exec(`
    CREATE TABLE players (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, color TEXT NOT NULL DEFAULT '#4f9dff',
      avatar TEXT, api_key TEXT NOT NULL UNIQUE, tracking_paused INTEGER NOT NULL DEFAULT 0,
      is_admin INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL
    );
    -- Legacy shape: predates the games/game_catalog merge columns entirely.
    CREATE TABLE games (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, icon TEXT NOT NULL DEFAULT '🎮',
      min_team_size INTEGER NOT NULL DEFAULT 1, max_team_size INTEGER NOT NULL DEFAULT 5,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE preferences (
      player_id TEXT NOT NULL, game_id TEXT NOT NULL, rating INTEGER NOT NULL,
      PRIMARY KEY (player_id, game_id)
    );
    CREATE TABLE game_catalog (
      id TEXT PRIMARY KEY, title TEXT NOT NULL, platform TEXT, platform_url TEXT,
      trailer_url TEXT, is_suggestion INTEGER NOT NULL DEFAULT 0,
      created_by TEXT, created_at INTEGER NOT NULL
    );
    CREATE TABLE game_catalog_ratings (
      catalog_id TEXT NOT NULL, player_id TEXT NOT NULL, rating INTEGER NOT NULL
    );
    CREATE TABLE game_catalog_interest (
      catalog_id TEXT NOT NULL, player_id TEXT NOT NULL
    );
  `);

  fixture
    .prepare('INSERT INTO players (id, name, api_key, created_at) VALUES (?, ?, ?, ?)')
    .run('p-legacy-1', 'Legacy Player A', 'key-a', now);
  fixture
    .prepare('INSERT INTO players (id, name, api_key, created_at) VALUES (?, ?, ?, ?)')
    .run('p-legacy-2', 'Legacy Player B', 'key-b', now);

  // A game that was already tracked (has process-name mappings elsewhere)
  // AND separately listed in the catalog before the merge — the merge must
  // fill in its blank catalog fields without touching its identity.
  fixture
    .prepare('INSERT INTO games (id, name, icon, min_team_size, max_team_size, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run('g-existing', 'Custom LAN Shooter', '🎮', 1, 5, now);

  // Player B already rated this game via the modern preferences table (e.g.
  // set after upgrading but before the catalog rows were cleaned up) — the
  // merge must never clobber a rating that's already there.
  fixture
    .prepare('INSERT INTO preferences (player_id, game_id, rating) VALUES (?, ?, ?)')
    .run('p-legacy-2', 'g-existing', 7);

  fixture
    .prepare(
      'INSERT INTO game_catalog (id, title, platform, platform_url, trailer_url, is_suggestion, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    )
    .run('c-existing', 'Custom LAN Shooter', 'PlatformX', 'http://platform-x', 'http://trailer-x', 0, null, now);
  fixture
    .prepare(
      'INSERT INTO game_catalog (id, title, platform, platform_url, trailer_url, is_suggestion, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    )
    .run('c-new', 'Legacy Catalog Only Game', 'PlatformY', null, null, 1, 'p-legacy-1', now);

  fixture
    .prepare('INSERT INTO game_catalog_ratings (catalog_id, player_id, rating) VALUES (?, ?, ?)')
    .run('c-existing', 'p-legacy-1', 4);
  fixture
    .prepare('INSERT INTO game_catalog_ratings (catalog_id, player_id, rating) VALUES (?, ?, ?)')
    .run('c-existing', 'p-legacy-2', 3);
  fixture
    .prepare('INSERT INTO game_catalog_ratings (catalog_id, player_id, rating) VALUES (?, ?, ?)')
    .run('c-new', 'p-legacy-1', 6);
  fixture.close();

  runMigrations(dbFile);

  const migrated = new Database(dbFile, { readonly: true });

  const catalogTable = migrated
    .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'game_catalog'`)
    .get();
  assert.equal(catalogTable, undefined, 'legacy game_catalog table should be dropped');

  const existingGame = migrated.prepare('SELECT * FROM games WHERE id = ?').get('g-existing') as any;
  assert.equal(existingGame.platform, 'PlatformX', 'blank platform should be filled from the catalog entry');
  assert.equal(existingGame.platform_url, 'http://platform-x');
  assert.equal(existingGame.trailer_url, 'http://trailer-x');

  const newGame = migrated.prepare('SELECT * FROM games WHERE name = ?').get('Legacy Catalog Only Game') as any;
  assert.ok(newGame, 'a catalog-only title should become its own games row');
  assert.equal(newGame.status, 'suggestion');
  assert.equal(newGame.created_by, 'p-legacy-1');

  const prefA = migrated
    .prepare('SELECT rating FROM preferences WHERE player_id = ? AND game_id = ?')
    .get('p-legacy-1', 'g-existing') as { rating: number };
  assert.equal(prefA.rating, 8, 'a fresh preference should be the catalog rating doubled onto the 1-10 scale');

  const prefB = migrated
    .prepare('SELECT rating FROM preferences WHERE player_id = ? AND game_id = ?')
    .get('p-legacy-2', 'g-existing') as { rating: number };
  assert.equal(prefB.rating, 7, 'an existing preference must never be overwritten by the legacy catalog rating');

  const prefNewGame = migrated
    .prepare('SELECT rating FROM preferences WHERE player_id = ? AND game_id = ?')
    .get('p-legacy-1', newGame.id) as { rating: number };
  assert.equal(prefNewGame.rating, 10, 'a doubled rating above 10 should be capped, not overflow the 1-10 scale');

  migrated.close();
  fs.rmSync(path.dirname(dbFile), { recursive: true, force: true });
});

test('legacy votes/vote_rounds schema is rebuilt for points-mode voting without losing data', () => {
  const dbFile = makeTempDbPath('votes-points-mode');
  const now = Date.now();

  const fixture = new Database(dbFile);
  fixture.exec(`
    -- players/games/events are already in their modern shape here — this
    -- fixture only targets the votes/vote_rounds migration, so the other
    -- tables must match what the rest of db.ts (schema + other seed/migration
    -- functions, which always run regardless) expects, or they'll fail for
    -- unrelated reasons.
    CREATE TABLE players (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, color TEXT NOT NULL DEFAULT '#4f9dff',
      avatar TEXT, api_key TEXT NOT NULL UNIQUE, tracking_paused INTEGER NOT NULL DEFAULT 0,
      is_admin INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL
    );
    CREATE TABLE games (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, icon TEXT NOT NULL DEFAULT '🎮', icon_image TEXT,
      min_team_size INTEGER NOT NULL DEFAULT 1, max_team_size INTEGER NOT NULL DEFAULT 5,
      platform TEXT, platform_url TEXT, trailer_url TEXT,
      status TEXT NOT NULL DEFAULT 'catalog', created_by TEXT, created_at INTEGER NOT NULL
    );
    CREATE TABLE events (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, starts_at INTEGER NOT NULL, ends_at INTEGER,
      location TEXT, description TEXT, tracking_enabled INTEGER NOT NULL DEFAULT 0, ended_at INTEGER
    );
    -- Legacy shape: predates the points column and the widened unique constraint.
    CREATE TABLE votes (
      id TEXT PRIMARY KEY,
      player_id TEXT NOT NULL,
      game_id TEXT NOT NULL,
      event_id TEXT NOT NULL,
      round INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      UNIQUE (player_id, round)
    );
    CREATE TABLE vote_rounds (
      round INTEGER PRIMARY KEY,
      event_id TEXT NOT NULL,
      started_at INTEGER NOT NULL,
      closed_at INTEGER,
      winner_game_ids TEXT
    );
  `);

  fixture
    .prepare('INSERT INTO players (id, name, api_key, created_at) VALUES (?, ?, ?, ?)')
    .run('p1', 'Voter A', 'key-1', now);
  fixture
    .prepare('INSERT INTO players (id, name, api_key, created_at) VALUES (?, ?, ?, ?)')
    .run('p2', 'Voter B', 'key-2', now);
  fixture.prepare('INSERT INTO games (id, name, created_at) VALUES (?, ?, ?)').run('g1', 'Legacy Game One', now);
  fixture.prepare('INSERT INTO games (id, name, created_at) VALUES (?, ?, ?)').run('g2', 'Legacy Game Two', now);
  fixture.prepare('INSERT INTO events (id, name, starts_at) VALUES (?, ?, ?)').run('e1', 'Legacy Event', now);
  fixture
    .prepare('INSERT INTO vote_rounds (round, event_id, started_at, closed_at, winner_game_ids) VALUES (?, ?, ?, ?, ?)')
    .run(1, 'e1', now, now, JSON.stringify(['g1']));
  fixture
    .prepare('INSERT INTO votes (id, player_id, game_id, event_id, round, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run('v1', 'p1', 'g1', 'e1', 1, now);
  fixture
    .prepare('INSERT INTO votes (id, player_id, game_id, event_id, round, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run('v2', 'p2', 'g2', 'e1', 1, now);
  fixture.close();

  runMigrations(dbFile);

  const migrated = new Database(dbFile, { readonly: true });

  const voteColumns = migrated.prepare('PRAGMA table_info(votes)').all() as Array<{ name: string }>;
  assert.ok(
    voteColumns.some((c) => c.name === 'points'),
    'votes should gain a points column',
  );

  const roundColumns = migrated.prepare('PRAGMA table_info(vote_rounds)').all() as Array<{ name: string }>;
  for (const col of ['mode', 'title', 'info', 'selected_game_ids']) {
    assert.ok(
      roundColumns.some((c) => c.name === col),
      `vote_rounds should gain a ${col} column`,
    );
  }

  const existingVotes = migrated
    .prepare('SELECT id, player_id, game_id, round, points FROM votes ORDER BY id')
    .all() as Array<{
    id: string;
    player_id: string;
    game_id: string;
    round: number;
    points: number | null;
  }>;
  assert.deepEqual(
    existingVotes.map((v) => ({ id: v.id, player_id: v.player_id, game_id: v.game_id, round: v.round })),
    [
      { id: 'v1', player_id: 'p1', game_id: 'g1', round: 1 },
      { id: 'v2', player_id: 'p2', game_id: 'g2', round: 1 },
    ],
    'pre-existing votes must survive the rebuild unchanged',
  );
  assert.ok(
    existingVotes.every((v) => v.points === null),
    'migrated legacy rows have no points yet',
  );

  const migratedRound = migrated.prepare('SELECT mode, winner_game_ids FROM vote_rounds WHERE round = ?').get(1) as {
    mode: string;
    winner_game_ids: string;
  };
  assert.equal(migratedRound.mode, 'single', 'a pre-existing round defaults to single-vote mode');
  assert.deepEqual(JSON.parse(migratedRound.winner_game_ids), ['g1'], 'historical winner data must survive');

  migrated.close();

  // The whole point of widening the unique constraint to (player_id, round,
  // game_id): a player casting points-mode votes for a second game in the
  // same round they already voted in must now be allowed, not rejected as a
  // duplicate of their first (player_id, round) vote.
  const writable = new Database(dbFile);
  assert.doesNotThrow(() => {
    writable
      .prepare(
        'INSERT INTO votes (id, player_id, game_id, event_id, round, points, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      )
      .run('v3', 'p1', 'g2', 'e1', 1, 5, now);
  }, 'the widened constraint should allow a second game vote from the same player in the same round');
  writable.close();

  fs.rmSync(path.dirname(dbFile), { recursive: true, force: true });
});

test('migration 32 keeps historical Arcade sessions visible in their event group', () => {
  const dbFile = makeTempDbPath('arcade-session-group-backfill');
  runMigrations(dbFile);

  const fixture = new Database(dbFile);
  const arcade = fixture.prepare('SELECT id, group_id FROM games WHERE arcade_key IS NOT NULL LIMIT 1').get() as {
    id: string;
    group_id: string | null;
  };
  const event = fixture.prepare('SELECT id, group_id FROM events WHERE group_id = ? LIMIT 1').get('default-group') as {
    id: string;
    group_id: string;
  };
  assert.equal(arcade.group_id, null, 'Arcade fixtures intentionally have no catalog owner');
  assert.equal(event.group_id, 'default-group');

  fixture
    .prepare('INSERT INTO players (id, name, api_key, created_at) VALUES (?, ?, ?, ?)')
    .run('historical-arcade-player', 'Historical Arcade Player', 'historical-arcade-key', Date.now());
  fixture
    .prepare(
      `INSERT INTO play_sessions
       (id, player_id, game_id, event_id, started_at, ended_at, active_ms, group_id)
       VALUES (?, ?, ?, ?, ?, ?, 0, NULL)`,
    )
    .run('historical-arcade-session', 'historical-arcade-player', arcade.id, event.id, 1000, 2000);
  fixture.prepare('DELETE FROM schema_migrations WHERE version = 32').run();
  fixture.close();

  runMigrations(dbFile);

  const migrated = new Database(dbFile, { readonly: true });
  const session = migrated
    .prepare('SELECT group_id FROM play_sessions WHERE id = ?')
    .get('historical-arcade-session') as { group_id: string | null };
  assert.equal(session.group_id, 'default-group');
  migrated.close();
  fs.rmSync(path.dirname(dbFile), { recursive: true, force: true });
});

test('records the complete migration history and does not duplicate it on restart', () => {
  const dbFile = makeTempDbPath('migration-history');

  runMigrations(dbFile);
  runMigrations(dbFile);

  const migrated = new Database(dbFile, { readonly: true });
  const migrations = migrated.prepare('SELECT version, name FROM schema_migrations ORDER BY version').all() as Array<{
    version: number;
    name: string;
  }>;

  assert.equal(migrations.length, 32);
  assert.deepEqual(
    migrations.map((migration) => migration.version),
    Array.from({ length: 32 }, (_, index) => index + 1),
  );
  assert.ok(migrations.every((migration) => migration.name.length > 0));
  for (const table of ['scribble_drawings', 'scribble_drawing_reactions', 'scribble_drawing_favorites']) {
    const row = migrated.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(table);
    assert.ok(row, `${table} should be created for legacy databases`);
  }
  const pushLogColumns = migrated.prepare('PRAGMA table_info(push_log)').all() as Array<{ name: string }>;
  for (const column of ['topic_key', 'expires_at', 'resolved_at']) {
    assert.ok(
      pushLogColumns.some((entry) => entry.name === column),
      `${column} should be added to legacy push logs`,
    );
  }
  const broadcastColumns = migrated.prepare('PRAGMA table_info(broadcasts)').all() as Array<{ name: string }>;
  for (const column of ['ends_at', 'ended_at']) {
    assert.ok(
      broadcastColumns.some((entry) => entry.name === column),
      `${column} should be added to legacy broadcasts`,
    );
  }
  const pushSeen = migrated
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'push_log_seen'")
    .get();
  assert.ok(pushSeen, 'push_log_seen should be created for legacy databases');
  const playerColumns = migrated.prepare('PRAGMA table_info(players)').all() as Array<{ name: string }>;
  assert.ok(playerColumns.some((column) => column.name === 'deactivated_at'));
  assert.ok(playerColumns.some((column) => column.name === 'test_owner_group_id'));
  assert.ok(migrated.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'admin_log'").get());
  for (const table of ['groups', 'group_memberships', 'group_invites']) {
    assert.ok(migrated.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(table));
  }
  const eventColumns = migrated.prepare('PRAGMA table_info(events)').all() as Array<{ name: string }>;
  assert.ok(eventColumns.some((column) => column.name === 'group_id'));
  assert.ok(eventColumns.some((column) => column.name === 'status'));
  const auditColumns = migrated.prepare('PRAGMA table_info(admin_log)').all() as Array<{ name: string }>;
  assert.ok(auditColumns.some((column) => column.name === 'group_id'));
  assert.ok(migrated.prepare("SELECT id FROM groups WHERE id = 'default-group'").get());
  migrated.close();
  fs.rmSync(path.dirname(dbFile), { recursive: true, force: true });
});

test('account hardening clears only unclaimed and test-user legacy admin flags', () => {
  const dbFile = makeTempDbPath('admin-role-cutover');
  runMigrations(dbFile);

  const fixture = new Database(dbFile);
  const insert = fixture.prepare(
    'INSERT INTO players (id, name, api_key, is_admin, is_test, password_hash, created_at) VALUES (?, ?, ?, 1, ?, ?, ?)',
  );
  insert.run('claimed-admin', 'Claimed Admin', 'claimed-admin-key', 0, 'stored-password-hash', Date.now());
  insert.run('legacy-admin', 'Legacy Admin', 'legacy-admin-key', 0, null, Date.now());
  insert.run('test-admin', 'Test Admin', 'test-admin-key', 1, 'stored-password-hash', Date.now());
  fixture.prepare('DELETE FROM schema_migrations WHERE version = 29').run();
  fixture.close();

  runMigrations(dbFile);

  const migrated = new Database(dbFile, { readonly: true });
  const roles = migrated
    .prepare('SELECT id, is_admin FROM players WHERE id IN (?, ?, ?) ORDER BY id')
    .all('claimed-admin', 'legacy-admin', 'test-admin');
  assert.deepEqual(roles, [
    { id: 'claimed-admin', is_admin: 1 },
    { id: 'legacy-admin', is_admin: 0 },
    { id: 'test-admin', is_admin: 0 },
  ]);
  migrated.close();
  fs.rmSync(path.dirname(dbFile), { recursive: true, force: true });
});

test('repairs databases that already recorded the original invite migration', () => {
  const dbFile = makeTempDbPath('invite-fk-repair');
  const now = Date.now();
  runMigrations(dbFile);

  const fixture = new Database(dbFile);
  fixture.pragma('foreign_keys = OFF');
  fixture.exec(`
    DELETE FROM schema_migrations WHERE version = 27;
    DROP INDEX idx_invites_player;
    DROP TABLE invites;
    CREATE TABLE invites (
      code TEXT PRIMARY KEY,
      purpose TEXT NOT NULL,
      player_id TEXT REFERENCES players(id) ON DELETE CASCADE,
      created_by TEXT NOT NULL REFERENCES players(id),
      created_at INTEGER NOT NULL,
      expires_at INTEGER,
      revoked_at INTEGER,
      used_at INTEGER,
      used_by TEXT REFERENCES players(id)
    );
    CREATE INDEX idx_invites_player ON invites(player_id);
  `);
  fixture
    .prepare('INSERT INTO players (id, name, api_key, created_at) VALUES (?, ?, ?, ?)')
    .run('invite-creator', 'Invite Creator', 'invite-creator-key', now);
  fixture
    .prepare('INSERT INTO players (id, name, api_key, created_at) VALUES (?, ?, ?, ?)')
    .run('invite-user', 'Invite User', 'invite-user-key', now);
  fixture
    .prepare(
      'INSERT INTO invites (code, purpose, created_by, created_at, expires_at, used_at, used_by) VALUES (?, ?, ?, ?, NULL, ?, ?)',
    )
    .run('legacy-invite', 'register', 'invite-creator', now, now, 'invite-user');
  fixture.close();

  runMigrations(dbFile);

  const migrated = new Database(dbFile);
  migrated.pragma('foreign_keys = ON');
  const foreignKeys = migrated.prepare('PRAGMA foreign_key_list(invites)').all() as Array<{
    from: string;
    on_delete: string;
  }>;
  assert.equal(foreignKeys.find((key) => key.from === 'created_by')?.on_delete, 'SET NULL');
  assert.equal(foreignKeys.find((key) => key.from === 'used_by')?.on_delete, 'SET NULL');

  const repaired = migrated.prepare('SELECT expires_at FROM invites WHERE code = ?').get('legacy-invite') as {
    expires_at: number;
  };
  assert.equal(repaired.expires_at, now + 14 * 24 * 60 * 60 * 1000);

  migrated.prepare('DELETE FROM players WHERE id IN (?, ?)').run('invite-creator', 'invite-user');
  const audit = migrated.prepare('SELECT created_by, used_by FROM invites WHERE code = ?').get('legacy-invite');
  assert.deepEqual(audit, { created_by: null, used_by: null });
  migrated.close();
  fs.rmSync(path.dirname(dbFile), { recursive: true, force: true });
});
