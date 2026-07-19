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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'respawn-migration-test-'));
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

test('historical test LANs are marked and food-order quantity/paid/finalized/paypal/tip columns default safely during upgrade', () => {
  const dbFile = makeTempDbPath('test-data-and-food-quantity');
  const now = Date.now();
  const fixture = new Database(dbFile);
  fixture.exec(`
    CREATE TABLE players (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, real_name TEXT, color TEXT NOT NULL DEFAULT '#4f9dff',
      avatar TEXT, api_key TEXT NOT NULL UNIQUE, tracking_paused INTEGER NOT NULL DEFAULT 0,
      is_admin INTEGER NOT NULL DEFAULT 1, is_test INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL
    );
    CREATE TABLE events (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, starts_at INTEGER NOT NULL, ends_at INTEGER,
      location TEXT, description TEXT, tracking_enabled INTEGER NOT NULL DEFAULT 0, ended_at INTEGER
    );
    CREATE TABLE food_orders (
      id TEXT PRIMARY KEY, event_id TEXT NOT NULL, title TEXT NOT NULL, created_by TEXT NOT NULL,
      created_at INTEGER NOT NULL, closed_at INTEGER, send_at INTEGER, notes TEXT, link TEXT
    );
    CREATE TABLE food_order_items (
      id TEXT PRIMARY KEY, order_id TEXT NOT NULL, player_id TEXT NOT NULL,
      description TEXT NOT NULL, price_cents INTEGER, created_at INTEGER NOT NULL
    );
  `);
  fixture.prepare('INSERT INTO players (id, name, api_key, created_at) VALUES (?, ?, ?, ?)').run('p1', 'Migration Player', 'key', now);
  fixture.prepare('INSERT INTO events (id, name, starts_at) VALUES (?, ?, ?)').run('e-test', 'Respawn Test-LAN 2020', now);
  fixture.prepare('INSERT INTO events (id, name, starts_at) VALUES (?, ?, ?)').run('e-real', 'Echte LAN 2020', now);
  fixture.prepare('INSERT INTO food_orders (id, event_id, title, created_by, created_at) VALUES (?, ?, ?, ?, ?)').run('o1', 'e-real', 'Pizza', 'p1', now);
  fixture.prepare('INSERT INTO food_order_items (id, order_id, player_id, description, price_cents, created_at) VALUES (?, ?, ?, ?, ?, ?)').run('i1', 'o1', 'p1', 'Margherita', 900, now);
  // Pre-upgrade, closing an order WAS the terminal frozen state (today's
  // "Geschlossen", not the new reopenable "Abgeschickt") — the migration
  // must backfill finalized_at for it, not leave old history reopenable.
  fixture.prepare('INSERT INTO food_orders (id, event_id, title, created_by, created_at, closed_at) VALUES (?, ?, ?, ?, ?, ?)').run('o2', 'e-real', 'Getränke', 'p1', now, now + 500);
  fixture.close();

  runMigrations(dbFile);

  const migrated = new Database(dbFile, { readonly: true });
  const testEvent = migrated.prepare('SELECT is_test FROM events WHERE id = ?').get('e-test') as { is_test: number };
  const realEvent = migrated.prepare('SELECT is_test FROM events WHERE id = ?').get('e-real') as { is_test: number };
  const item = migrated.prepare('SELECT quantity, paid FROM food_order_items WHERE id = ?').get('i1') as {
    quantity: number;
    paid: number;
  };
  const order = migrated.prepare('SELECT finalized_at, paypal_link, tip_percent FROM food_orders WHERE id = ?').get('o1') as {
    finalized_at: number | null;
    paypal_link: string | null;
    tip_percent: number | null;
  };
  assert.equal(testEvent.is_test, 1);
  assert.equal(realEvent.is_test, 0);
  assert.equal(item.quantity, 1);
  assert.equal(item.paid, 0);
  assert.equal(order.finalized_at, null);
  assert.equal(order.paypal_link, null);
  assert.equal(order.tip_percent, null);
  const closedOrder = migrated.prepare('SELECT closed_at, finalized_at FROM food_orders WHERE id = ?').get('o2') as {
    closed_at: number;
    finalized_at: number | null;
  };
  assert.equal(closedOrder.finalized_at, closedOrder.closed_at);
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
    .prepare('SELECT id, group_id, player_id, player_name_snapshot, game_id, round, points FROM votes ORDER BY id')
    .all() as Array<{
    id: string;
    group_id: string;
    player_id: string;
    player_name_snapshot: string;
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
  assert.ok(existingVotes.every((vote) => vote.group_id === 'default-group'));
  assert.deepEqual(
    existingVotes.map((vote) => vote.player_name_snapshot),
    ['Voter A', 'Voter B'],
    'historical votes gain immutable voter-name snapshots',
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
        `INSERT INTO votes
           (id, group_id, player_id, player_name_snapshot, game_id, event_id, round, points, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run('v3', 'default-group', 'p1', 'Voter A', 'g2', 'e1', 1, 5, now);
  }, 'the widened constraint should allow a second game vote from the same player in the same round');
  writable.close();

  fs.rmSync(path.dirname(dbFile), { recursive: true, force: true });
});

test('migration 34 backfills draft ownership, event binding and immutable player snapshots', () => {
  const dbFile = makeTempDbPath('draft-group-backfill');
  runMigrations(dbFile);

  const fixture = new Database(dbFile);
  fixture.pragma('foreign_keys = OFF');
  const now = Date.now();
  fixture
    .prepare('INSERT INTO players (id, name, api_key, created_at) VALUES (?, ?, ?, ?)')
    .run('draft-player-a', 'Draft Player A', 'draft-player-key-a', now);
  fixture
    .prepare('INSERT INTO players (id, name, api_key, created_at) VALUES (?, ?, ?, ?)')
    .run('draft-player-b', 'Draft Player B', 'draft-player-key-b', now);
  fixture
    .prepare(
      `INSERT INTO group_memberships
         (group_id, player_id, role, status, joined_at, outside_tracking_enabled)
       VALUES ('default-group', ?, 'member', 'active', ?, 1)`,
    )
    .run('draft-player-a', now);
  fixture
    .prepare(
      `INSERT INTO group_memberships
         (group_id, player_id, role, status, joined_at, outside_tracking_enabled)
       VALUES ('default-group', ?, 'member', 'active', ?, 1)`,
    )
    .run('draft-player-b', now);
  const game = fixture.prepare('SELECT id FROM games WHERE group_id = ? LIMIT 1').get('default-group') as {
    id: string;
  };
  const event = { id: 'legacy-draft-event' };
  fixture
    .prepare(
      `INSERT INTO events
         (id, name, starts_at, ends_at, tracking_enabled, group_id, status)
       VALUES (?, 'Legacy Draft Event', ?, ?, 0, 'default-group', 'ended')`,
    )
    .run(event.id, now, now + 1000);
  fixture.exec(`
    DELETE FROM schema_migrations WHERE version = 34;
    DROP TABLE draft_player_refs;
    DROP TABLE drafts;
    CREATE TABLE drafts (
      id TEXT PRIMARY KEY,
      event_id TEXT NOT NULL,
      game_id TEXT NOT NULL,
      status TEXT NOT NULL,
      captain_ids TEXT NOT NULL,
      pool_ids TEXT NOT NULL,
      picks TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
  `);
  fixture
    .prepare(
      `INSERT INTO drafts (id, event_id, game_id, status, captain_ids, pool_ids, picks, created_at)
       VALUES (?, ?, ?, 'completed', ?, '[]', ?, ?)`,
    )
    .run(
      'legacy-draft',
      event.id,
      game.id,
      JSON.stringify(['draft-player-a']),
      JSON.stringify([{ captainIndex: 0, playerId: 'draft-player-b', pickedAt: now }]),
      now,
    );
  fixture.close();

  runMigrations(dbFile);

  const migrated = new Database(dbFile);
  migrated.pragma('foreign_keys = ON');
  const draft = migrated.prepare('SELECT group_id, event_id FROM drafts WHERE id = ?').get('legacy-draft');
  assert.deepEqual(draft, { group_id: 'default-group', event_id: event.id });
  const refs = migrated
    .prepare(
      `SELECT player_id, player_name_snapshot FROM draft_player_refs
       WHERE draft_id = ? ORDER BY player_id`,
    )
    .all('legacy-draft');
  assert.deepEqual(refs, [
    { player_id: 'draft-player-a', player_name_snapshot: 'Draft Player A' },
    { player_id: 'draft-player-b', player_name_snapshot: 'Draft Player B' },
  ]);
  assert.deepEqual(migrated.prepare('PRAGMA foreign_key_check').all(), []);
  migrated.close();
  fs.rmSync(path.dirname(dbFile), { recursive: true, force: true });
});

test('migration 34 skips historical drafts referencing since-deleted players instead of crashing', () => {
  const dbFile = makeTempDbPath('draft-group-backfill-orphaned-player');
  runMigrations(dbFile);

  const fixture = new Database(dbFile);
  fixture.pragma('foreign_keys = OFF');
  const now = Date.now();
  fixture
    .prepare('INSERT INTO players (id, name, api_key, created_at) VALUES (?, ?, ?, ?)')
    .run('draft-player-live', 'Draft Player Live', 'draft-player-key-live', now);
  fixture
    .prepare(
      `INSERT INTO group_memberships
         (group_id, player_id, role, status, joined_at, outside_tracking_enabled)
       VALUES ('default-group', ?, 'member', 'active', ?, 1)`,
    )
    .run('draft-player-live', now);
  const game = fixture.prepare('SELECT id FROM games WHERE group_id = ? LIMIT 1').get('default-group') as {
    id: string;
  };
  const event = { id: 'legacy-draft-event-orphaned' };
  fixture
    .prepare(
      `INSERT INTO events
         (id, name, starts_at, ends_at, tracking_enabled, group_id, status)
       VALUES (?, 'Legacy Draft Event Orphaned', ?, ?, 0, 'default-group', 'ended')`,
    )
    .run(event.id, now, now + 1000);
  fixture.exec(`
    DELETE FROM schema_migrations WHERE version = 34;
    DROP TABLE draft_player_refs;
    DROP TABLE drafts;
    CREATE TABLE drafts (
      id TEXT PRIMARY KEY,
      event_id TEXT NOT NULL,
      game_id TEXT NOT NULL,
      status TEXT NOT NULL,
      captain_ids TEXT NOT NULL,
      pool_ids TEXT NOT NULL,
      picks TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
  `);
  // captain_ids references a player that was deleted after the draft ran (real-world:
  // test-data cleanup removes test players but leaves their IDs in historical draft JSON).
  fixture
    .prepare(
      `INSERT INTO drafts (id, event_id, game_id, status, captain_ids, pool_ids, picks, created_at)
       VALUES (?, ?, ?, 'completed', ?, '[]', ?, ?)`,
    )
    .run(
      'legacy-draft-orphaned',
      event.id,
      game.id,
      JSON.stringify(['draft-player-deleted']),
      JSON.stringify([{ captainIndex: 0, playerId: 'draft-player-live', pickedAt: now }]),
      now,
    );
  fixture.close();

  // Previously crashed with "FOREIGN KEY constraint failed" because
  // ensureHistoricalMembership inserted a group_memberships row for the deleted player.
  assert.doesNotThrow(() => runMigrations(dbFile));

  const migrated = new Database(dbFile);
  migrated.pragma('foreign_keys = ON');
  const draft = migrated.prepare('SELECT group_id, event_id FROM drafts WHERE id = ?').get('legacy-draft-orphaned');
  assert.deepEqual(draft, { group_id: 'default-group', event_id: event.id });
  const refs = migrated
    .prepare(
      `SELECT player_id FROM draft_player_refs WHERE draft_id = ? ORDER BY player_id`,
    )
    .all('legacy-draft-orphaned');
  assert.deepEqual(refs, [{ player_id: 'draft-player-live' }]);
  const orphanedMembership = migrated
    .prepare(`SELECT 1 FROM group_memberships WHERE group_id = ? AND player_id = ?`)
    .get('default-group', 'draft-player-deleted');
  assert.equal(orphanedMembership, undefined);
  assert.deepEqual(migrated.prepare('PRAGMA foreign_key_check').all(), []);
  migrated.close();
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

test('migration 40 assigns legacy Arcade results to the default group and snapshots participants', () => {
  const dbFile = makeTempDbPath('arcade-data-group-backfill');
  runMigrations(dbFile);

  const fixture = new Database(dbFile);
  fixture.pragma('foreign_keys = ON');
  const now = Date.now();
  fixture.prepare('INSERT INTO players (id, name, api_key, created_at) VALUES (?, ?, ?, ?)')
    .run('legacy-arcade-player', 'Legacy Arcade Player', 'legacy-arcade-player-key', now);
  fixture.prepare(
    `INSERT INTO group_memberships
       (group_id, player_id, role, status, joined_at, ended_at, outside_tracking_enabled, invited_by)
     VALUES ('default-group', 'legacy-arcade-player', 'member', 'active', ?, NULL, 1, NULL)`,
  ).run(now);
  fixture.exec(`
    DROP TRIGGER trg_arcade_results_legacy_scope_insert;
    DELETE FROM schema_migrations WHERE version = 40;
  `);
  fixture.prepare(
    `INSERT INTO arcade_results
       (id, game_type, winner_id, players, scores, reason, started_at, ended_at, group_id, event_id)
     VALUES ('legacy-arcade-result', 'quiz', 'legacy-arcade-player', ?, ?, 'completed', ?, ?, NULL, NULL)`,
  ).run(
    JSON.stringify([{ id: 'legacy-arcade-player', name: 'Legacy Arcade Player' }]),
    JSON.stringify([{ playerId: 'legacy-arcade-player', name: 'Legacy Arcade Player', score: 5 }]),
    now,
    now + 1000,
  );
  fixture.close();

  runMigrations(dbFile);

  const migrated = new Database(dbFile, { readonly: true });
  assert.deepEqual(
    migrated.prepare('SELECT group_id, event_id FROM arcade_results WHERE id = ?').get('legacy-arcade-result'),
    { group_id: 'default-group', event_id: null },
  );
  assert.deepEqual(
    migrated.prepare(
      `SELECT group_id, player_id, player_name_snapshot, is_winner
       FROM arcade_result_participants WHERE result_id = ?`,
    ).get('legacy-arcade-result'),
    {
      group_id: 'default-group',
      player_id: 'legacy-arcade-player',
      player_name_snapshot: 'Legacy Arcade Player',
      is_winner: 1,
    },
  );
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

  assert.equal(migrations.length, 49);
  assert.deepEqual(
    migrations.map((migration) => migration.version),
    Array.from({ length: 49 }, (_, index) => index + 1),
  );
  assert.ok(migrations.every((migration) => migration.name.length > 0));
  for (const table of ['scribble_drawings', 'scribble_drawing_reactions', 'scribble_drawing_favorites']) {
    const row = migrated.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(table);
    assert.ok(row, `${table} should be created for legacy databases`);
  }
  for (const table of ['music_controllers', 'music_controller_pairings', 'music_sessions', 'music_requests']) {
    const row = migrated.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(table);
    assert.ok(row, `${table} should be created for legacy databases`);
  }
  for (const removedTable of ['spotify_connections', 'spotify_oauth_states']) {
    assert.equal(
      migrated.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(removedTable),
      undefined,
    );
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
  const pushHidden = migrated.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'push_log_hidden'").get();
  assert.ok(pushHidden, 'push_log_hidden should be created for legacy databases');
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
  for (const table of ['seating_layouts', 'seat_neighbors', 'game_pings', 'game_ping_interested']) {
    const columns = migrated.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
    assert.ok(columns.some((column) => column.name === 'group_id'), `${table} should be group-owned`);
  }
  const seatingEvent = migrated.prepare('PRAGMA table_info(seating_layouts)').all() as Array<{
    name: string;
    notnull: number;
  }>;
  assert.equal(seatingEvent.find((column) => column.name === 'event_id')?.notnull, 0);
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

test('migration 35 preserves legacy ping rows as scoped history', () => {
  const dbFile = makeTempDbPath('legacy-pings');
  runMigrations(dbFile);

  const fixture = new Database(dbFile);
  fixture.pragma('foreign_keys = OFF');
  fixture.exec(`
    DELETE FROM schema_migrations WHERE version = 35;
    DROP TABLE game_ping_interested;
    DROP TABLE game_pings;
    CREATE TABLE game_pings (
      id TEXT PRIMARY KEY,
      player_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
      game_id TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
      event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
      message TEXT,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL
    );
    CREATE TABLE game_ping_interested (
      ping_id TEXT NOT NULL REFERENCES game_pings(id) ON DELETE CASCADE,
      player_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
      PRIMARY KEY (ping_id, player_id)
    );
  `);
  const now = Date.now();
  fixture.prepare(
    `INSERT INTO players (id, name, api_key, created_at) VALUES
       ('legacy-ping-owner', 'Legacy Ping Owner', 'legacy-ping-owner-key', ?),
       ('legacy-ping-friend', 'Legacy Ping Friend', 'legacy-ping-friend-key', ?)`,
  ).run(now, now);
  fixture.prepare(
    `INSERT INTO group_memberships
       (group_id, player_id, role, status, joined_at, outside_tracking_enabled)
     VALUES ('default-group', ?, 'member', 'active', ?, 1),
            ('default-group', ?, 'member', 'active', ?, 1)`,
  ).run('legacy-ping-owner', now, 'legacy-ping-friend', now);
  const game = fixture.prepare('SELECT id FROM games WHERE group_id = ? LIMIT 1').get('default-group') as { id: string };
  fixture.prepare(
    `INSERT INTO game_pings (id, player_id, game_id, event_id, message, created_at, expires_at)
     VALUES ('legacy-ping', ?, ?, ?, 'legacy message', ?, ?)`,
  ).run('legacy-ping-owner', game.id, 'outside-events', now, now + 60_000);
  fixture.prepare('INSERT INTO game_ping_interested (ping_id, player_id) VALUES (?, ?)')
    .run('legacy-ping', 'legacy-ping-friend');
  fixture.close();

  runMigrations(dbFile);

  const migrated = new Database(dbFile, { readonly: true });
  const migratedGame = migrated.prepare('SELECT name FROM games WHERE id = ?').get(game.id) as { name: string };
  assert.deepEqual(
    migrated.prepare(
      `SELECT group_id, event_id, player_name_snapshot, game_name_snapshot, message
       FROM game_pings WHERE id = 'legacy-ping'`,
    ).get(),
    {
      group_id: 'default-group',
      event_id: null,
      player_name_snapshot: 'Legacy Ping Owner',
      game_name_snapshot: migratedGame.name,
      message: 'legacy message',
    },
  );
  assert.deepEqual(
    migrated.prepare('SELECT group_id, player_name_snapshot FROM game_ping_interested WHERE ping_id = ?')
      .get('legacy-ping'),
    { group_id: 'default-group', player_name_snapshot: 'Legacy Ping Friend' },
  );
  migrated.close();
  fs.rmSync(path.dirname(dbFile), { recursive: true, force: true });
});

test('migration 39 preserves legacy communication rows in the default group', () => {
  const dbFile = makeTempDbPath('legacy-communications');
  runMigrations(dbFile);
  const fixture = new Database(dbFile);
  fixture.pragma('foreign_keys = OFF');
  fixture.exec(`
    DELETE FROM schema_migrations WHERE version = 39;
    DROP TABLE push_log_hidden;
    DROP TABLE push_log_seen;
    DROP TABLE push_log;
    DROP TABLE broadcasts;
    DROP TABLE info_entries;
    CREATE TABLE broadcasts (
      id TEXT PRIMARY KEY, player_id TEXT NOT NULL, message TEXT NOT NULL,
      ends_at INTEGER NOT NULL, ended_at INTEGER, created_at INTEGER NOT NULL
    );
    CREATE TABLE push_log (
      id TEXT PRIMARY KEY, title TEXT NOT NULL, body TEXT NOT NULL, url TEXT,
      audience TEXT NOT NULL DEFAULT 'all', player_ids TEXT, topic_key TEXT,
      expires_at INTEGER, resolved_at INTEGER, created_at INTEGER NOT NULL
    );
    CREATE TABLE push_log_seen (
      push_id TEXT NOT NULL, player_id TEXT NOT NULL, seen_at INTEGER NOT NULL,
      PRIMARY KEY (push_id, player_id)
    );
    CREATE TABLE push_log_hidden (
      push_id TEXT NOT NULL, player_id TEXT NOT NULL, hidden_at INTEGER NOT NULL,
      PRIMARY KEY (push_id, player_id)
    );
    CREATE TABLE info_entries (
      id TEXT PRIMARY KEY, title TEXT NOT NULL, content TEXT NOT NULL,
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    );
  `);
  const now = Date.now();
  fixture.prepare('INSERT INTO players (id, name, api_key, created_at) VALUES (?, ?, ?, ?)')
    .run('legacy-comms-player', 'Legacy Comms', 'legacy-comms-key', now);
  fixture.prepare(
    `INSERT INTO group_memberships
       (group_id, player_id, role, status, joined_at, outside_tracking_enabled)
     VALUES ('default-group', ?, 'member', 'active', ?, 1)`,
  ).run('legacy-comms-player', now);
  fixture.prepare('INSERT INTO broadcasts VALUES (?, ?, ?, ?, NULL, ?)')
    .run('legacy-broadcast', 'legacy-comms-player', 'Legacy message', now + 1000, now);
  fixture.prepare('INSERT INTO push_log VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)')
    .run('legacy-push', 'Legacy title', 'Legacy body', '/legacy', 'all', null, 'legacy-topic', now + 1000, now);
  fixture.prepare('INSERT INTO push_log_seen VALUES (?, ?, ?)').run('legacy-push', 'legacy-comms-player', now);
  fixture.prepare('INSERT INTO push_log_hidden VALUES (?, ?, ?)').run('legacy-push', 'legacy-comms-player', now);
  fixture.prepare('INSERT INTO info_entries VALUES (?, ?, ?, ?, ?)')
    .run('legacy-info', 'Legacy info', 'Legacy content', now, now);
  fixture.close();

  runMigrations(dbFile);
  const migrated = new Database(dbFile, { readonly: true });
  assert.deepEqual(
    migrated.prepare('SELECT group_id, event_id, player_name_snapshot FROM broadcasts WHERE id = ?')
      .get('legacy-broadcast'),
    { group_id: 'default-group', event_id: null, player_name_snapshot: 'Legacy Comms' },
  );
  assert.deepEqual(
    migrated.prepare('SELECT group_id, event_id, player_ids FROM push_log WHERE id = ?').get('legacy-push'),
    { group_id: 'default-group', event_id: null, player_ids: '["legacy-comms-player"]' },
  );
  assert.deepEqual(
    migrated.prepare('SELECT group_id, event_id FROM info_entries WHERE id = ?').get('legacy-info'),
    { group_id: 'default-group', event_id: null },
  );
  assert.ok(migrated.prepare('SELECT 1 FROM push_log_seen WHERE push_id = ?').get('legacy-push'));
  assert.ok(migrated.prepare('SELECT 1 FROM push_log_hidden WHERE push_id = ?').get('legacy-push'));
  migrated.close();
  fs.rmSync(path.dirname(dbFile), { recursive: true, force: true });
});
