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
const BOOTSTRAP_ADMINS_JS_PATH = path.join(__dirname, '..', 'bootstrapAdmins.js');

function makeTempDbPath(name: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'respawn-migration-test-'));
  return path.join(dir, `${name}.db`);
}

// Runs the real db.ts module (compiled) against the given file in a fresh
// node process, so its module-level migrations execute exactly once against
// this exact fixture.
function runMigrations(dbFile: string, env: Record<string, string> = {}): void {
  execFileSync(process.execPath, ['-e', `require(${JSON.stringify(DB_JS_PATH)})`], {
    env: { ...process.env, ...env, DB_FILE: dbFile },
    stdio: 'pipe',
  });
}

// Reads db.ts's computed migration run order from a fresh child process (same
// module-side-effect isolation as runMigrations) against a throwaway in-memory
// database, so the assertion sees exactly the order the module would execute.
function readMigrationRunOrder(): number[] {
  const stdout = execFileSync(
    process.execPath,
    ['-e', `process.stdout.write(JSON.stringify(require(${JSON.stringify(DB_JS_PATH)}).getMigrationRunOrder()))`],
    { env: { ...process.env, DB_FILE: ':memory:' }, stdio: ['ignore', 'pipe', 'inherit'] },
  );
  return JSON.parse(stdout.toString()) as number[];
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

test('historical test LANs are marked and food-order quantity/paid/paid_by/paid_at/finalized/paypal/tip columns default safely during upgrade', () => {
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
  const item = migrated.prepare('SELECT quantity, paid, paid_by, paid_at FROM food_order_items WHERE id = ?').get('i1') as {
    quantity: number;
    paid: number;
    paid_by: string | null;
    paid_at: number | null;
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
  assert.equal(item.paid_by, null);
  assert.equal(item.paid_at, null);
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

  assert.equal(migrations.length, 88);
  assert.deepEqual(
    migrations.map((migration) => migration.version),
    Array.from({ length: 88 }, (_, index) => index + 1),
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
  const musicSessionColumns = migrated.prepare('PRAGMA table_info(music_sessions)').all() as Array<{ name: string }>;
  assert.ok(musicSessionColumns.some((column) => column.name === 'playback_context_json'));
  const musicControllerColumns = migrated.prepare('PRAGMA table_info(music_controllers)').all() as Array<{ name: string }>;
  assert.ok(musicControllerColumns.some((column) => column.name === 'connection_status_json'));
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
  for (const column of ['cost_cents', 'paypal_link', 'payment_due_at', 'created_by']) {
    assert.ok(eventColumns.some((entry) => entry.name === column), `${column} should be added to events`);
  }
  const participantColumns = migrated.prepare('PRAGMA table_info(event_participants)').all() as Array<{ name: string }>;
  assert.ok(participantColumns.some((column) => column.name === 'status'));
  assert.ok(participantColumns.some((column) => column.name === 'paid'));
  assert.ok(participantColumns.some((column) => column.name === 'paid_by'));
  assert.ok(participantColumns.some((column) => column.name === 'paid_at'));
  assert.ok(migrated.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'event_payment_reminders'").get());
  const arcadeResultColumns = migrated.prepare('PRAGMA table_info(arcade_results)').all() as Array<{ name: string }>;
  assert.ok(arcadeResultColumns.some((column) => column.name === 'source_match_id'));
  const scribbleDrawingColumns = migrated.prepare('PRAGMA table_info(scribble_drawings)').all() as Array<{ name: string }>;
  assert.ok(scribbleDrawingColumns.some((column) => column.name === 'is_ai_match'));
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

test('music reconnect migrations preserve existing sessions and are restart-safe', () => {
  const dbFile = makeTempDbPath('music-playback-context');
  const now = Date.now();
  runMigrations(dbFile);

  const fixture = new Database(dbFile);
  fixture.prepare('INSERT INTO players (id, name, api_key, created_at) VALUES (?, ?, ?, ?)')
    .run('music-migration-player', 'Music Migration Player', 'music-migration-key', now);
  fixture.prepare(
    `INSERT INTO music_sessions
       (id, group_id, event_id, host_player_id, device_id, device_name, status, current_track_uri,
        current_track_json, playback_is_playing, playback_progress_ms, playback_updated_at, started_at)
     VALUES (?, 'default-group', 'instance-base-event', ?, 'speaker-1', 'LAN Boxen', 'active', ?, ?, 1, 1234, ?, ?)`,
  ).run(
    'music-migration-session',
    'music-migration-player',
    'spotify:track:AAAAAAAAAAAAAAAAAAAAAA',
    JSON.stringify({ name: 'Existing Track' }),
    now,
    now,
  );
  fixture.exec('ALTER TABLE music_sessions DROP COLUMN playback_context_json');
  fixture.exec('ALTER TABLE music_controllers DROP COLUMN connection_status_json');
  fixture.prepare('DELETE FROM schema_migrations WHERE version IN (60, 61)').run();
  fixture.close();

  assert.doesNotThrow(() => runMigrations(dbFile));
  assert.doesNotThrow(() => runMigrations(dbFile), 'a second start must skip the recorded migration');

  const migrated = new Database(dbFile, { readonly: true });
  const columns = migrated.prepare('PRAGMA table_info(music_sessions)').all() as Array<{ name: string }>;
  assert.ok(columns.some((column) => column.name === 'playback_context_json'));
  const controllerColumns = migrated.prepare('PRAGMA table_info(music_controllers)').all() as Array<{ name: string }>;
  assert.ok(controllerColumns.some((column) => column.name === 'connection_status_json'));
  const session = migrated.prepare(
    'SELECT current_track_uri AS currentTrackUri, playback_progress_ms AS progressMs, playback_context_json AS context FROM music_sessions WHERE id = ?',
  ).get('music-migration-session') as { currentTrackUri: string; progressMs: number; context: string | null };
  assert.equal(session.currentTrackUri, 'spotify:track:AAAAAAAAAAAAAAAAAAAAAA');
  assert.equal(session.progressMs, 1234);
  assert.equal(session.context, null);
  assert.ok(migrated.prepare('SELECT 1 FROM schema_migrations WHERE version = 60').get());
  assert.ok(migrated.prepare('SELECT 1 FROM schema_migrations WHERE version = 61').get());
  migrated.close();
  fs.rmSync(path.dirname(dbFile), { recursive: true, force: true });
});

test('startup reconciles admin flags from active default-group roles once', () => {
  const dbFile = makeTempDbPath('required-admin-reconciliation');
  runMigrations(dbFile);
  const fixture = new Database(dbFile);
  const now = Date.now();
  const player = fixture.prepare(
    `INSERT INTO players (id, name, api_key, is_admin, is_test, password_hash, deactivated_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const member = fixture.prepare(
    `INSERT INTO group_memberships (group_id, player_id, role, status, joined_at, outside_tracking_enabled)
     VALUES ('default-group', ?, ?, 'active', ?, 1)`,
  );
  player.run('drift-member', 'Drift Member', 'drift-member-key', 1, 0, 'hash', null, now);
  member.run('drift-member', 'member', now);
  player.run('drift-admin', 'Drift Admin', 'drift-admin-key', 0, 0, 'hash', null, now);
  member.run('drift-admin', 'admin', now);
  player.run('inactive-owner', 'Inactive Owner', 'inactive-owner-key', 1, 0, 'hash', now, now);
  member.run('inactive-owner', 'owner', now);
  player.run('test-owner', 'Test Owner', 'test-owner-key', 1, 1, null, null, now);
  member.run('test-owner', 'owner', now);
  fixture.close();

  runMigrations(dbFile);
  let inspected = new Database(dbFile, { readonly: true });
  assert.deepEqual(inspected.prepare('SELECT id, is_admin FROM players WHERE id LIKE ? ORDER BY id').all('drift-%'), [
    { id: 'drift-admin', is_admin: 1 },
    { id: 'drift-member', is_admin: 0 },
  ]);
  inspected.close();

  const required = { ADMIN_RECOVERY_CODE: 'reconciliation-test-code' };
  runMigrations(dbFile, required);
  runMigrations(dbFile, required);
  inspected = new Database(dbFile, { readonly: true });
  assert.deepEqual(
    inspected.prepare('SELECT id, is_admin FROM players WHERE id IN (?, ?, ?, ?) ORDER BY id').all(
      'drift-admin', 'drift-member', 'inactive-owner', 'test-owner',
    ),
    [
      { id: 'drift-admin', is_admin: 1 },
      { id: 'drift-member', is_admin: 0 },
      { id: 'inactive-owner', is_admin: 0 },
      { id: 'test-owner', is_admin: 0 },
    ],
  );
  const audits = inspected.prepare(
    `SELECT action, target_id, details FROM admin_log
     WHERE target_id IN (?, ?, ?, ?) ORDER BY target_id`,
  ).all('drift-admin', 'drift-member', 'inactive-owner', 'test-owner') as Array<{
    action: string; target_id: string; details: string;
  }>;
  assert.deepEqual(audits.map((row) => [row.action, row.target_id, JSON.parse(row.details).via]), [
    ['admin_granted', 'drift-admin', 'group_role_reconciliation'],
    ['admin_revoked', 'drift-member', 'group_role_reconciliation'],
    ['admin_revoked', 'inactive-owner', 'group_role_reconciliation'],
    ['admin_revoked', 'test-owner', 'group_role_reconciliation'],
  ]);
  inspected.close();
  fs.rmSync(path.dirname(dbFile), { recursive: true, force: true });
});

test('required bootstrap promotes an active existing member once', () => {
  const dbFile = makeTempDbPath('required-bootstrap-active');
  runMigrations(dbFile);
  const fixture = new Database(dbFile);
  const now = Date.now();
  fixture.prepare(
    `INSERT INTO players (id, name, api_key, is_admin, password_hash, created_at)
     VALUES ('owner', 'Owner', 'owner-key', 1, 'hash', ?)`,
  ).run(now);
  fixture.prepare(
    `INSERT INTO players (id, name, api_key, is_admin, password_hash, created_at)
     VALUES ('bootstrap-member', 'Bootstrap Member', 'bootstrap-member-key', 0, NULL, ?)`,
  ).run(now);
  const membership = fixture.prepare(
    `INSERT INTO group_memberships (group_id, player_id, role, status, joined_at, outside_tracking_enabled)
     VALUES ('default-group', ?, ?, 'active', ?, 1)`,
  );
  membership.run('owner', 'owner', now);
  membership.run('bootstrap-member', 'member', now);
  fixture.close();
  const env = {
    ADMIN_RECOVERY_CODE: 'bootstrap-test-code',
    BOOTSTRAP_ADMIN_1_NAME: 'Bootstrap Member', BOOTSTRAP_ADMIN_1_PASSWORD: 'bootstrap-member-password',
  };
  const startup = () => execFileSync(process.execPath, ['-e',
    `require(${JSON.stringify(DB_JS_PATH)}); require(${JSON.stringify(BOOTSTRAP_ADMINS_JS_PATH)}).runBootstrapAdmins();`,
  ], { env: { ...process.env, ...env, DB_FILE: dbFile }, stdio: 'pipe' });
  startup();
  startup();
  const inspected = new Database(dbFile, { readonly: true });
  assert.deepEqual(inspected.prepare(
    `SELECT p.is_admin, gm.role, p.password_hash IS NOT NULL AS claimed FROM players p
     JOIN group_memberships gm ON gm.player_id = p.id AND gm.group_id = 'default-group'
     WHERE p.id = 'bootstrap-member'`,
  ).get(), { is_admin: 1, role: 'admin', claimed: 1 });
  assert.equal((inspected.prepare(
    `SELECT COUNT(*) AS count FROM admin_log
     WHERE target_id = 'bootstrap-member' AND action = 'admin_granted'`,
  ).get() as { count: number }).count, 1);
  inspected.close();
  fs.rmSync(path.dirname(dbFile), { recursive: true, force: true });
});

test('required bootstrap cannot derive rights from inactive memberships', () => {
  const dbFile = makeTempDbPath('required-bootstrap-inactive');
  runMigrations(dbFile);
  const fixture = new Database(dbFile);
  const now = Date.now();
  const player = fixture.prepare(
    `INSERT INTO players (id, name, api_key, is_admin, password_hash, created_at) VALUES (?, ?, ?, 1, ?, ?)`,
  );
  const membership = fixture.prepare(
    `INSERT INTO group_memberships (group_id, player_id, role, status, joined_at, ended_at, outside_tracking_enabled)
     VALUES ('default-group', ?, ?, ?, ?, ?, 0)`,
  );
  player.run('active-owner', 'Active Owner', 'active-owner-key', 'hash', now);
  membership.run('active-owner', 'owner', 'active', now, null);
  player.run('removed-owner', 'Removed Owner', 'removed-owner-key', null, now);
  membership.run('removed-owner', 'owner', 'removed', now, now);
  player.run('invited-admin', 'Invited Admin', 'invited-admin-key', null, now);
  membership.run('invited-admin', 'admin', 'invited', null, null);
  fixture.close();
  const env = {
    ADMIN_RECOVERY_CODE: 'inactive-test-code',
    BOOTSTRAP_ADMIN_1_NAME: 'Removed Owner', BOOTSTRAP_ADMIN_1_PASSWORD: 'removed-owner-password',
    BOOTSTRAP_ADMIN_2_NAME: 'Invited Admin', BOOTSTRAP_ADMIN_2_PASSWORD: 'invited-admin-password',
  };
  const startup = () => execFileSync(process.execPath, ['-e',
    `require(${JSON.stringify(DB_JS_PATH)}); require(${JSON.stringify(BOOTSTRAP_ADMINS_JS_PATH)}).runBootstrapAdmins();`,
  ], { env: { ...process.env, ...env, DB_FILE: dbFile }, stdio: 'pipe' });
  startup();
  startup();
  const inspected = new Database(dbFile, { readonly: true });
  assert.deepEqual(inspected.prepare(
    `SELECT p.id, p.is_admin, p.password_hash IS NOT NULL AS claimed, gm.role, gm.status FROM players p
     JOIN group_memberships gm ON gm.player_id = p.id AND gm.group_id = 'default-group'
     WHERE p.id IN ('removed-owner', 'invited-admin') ORDER BY p.id`,
  ).all(), [
    { id: 'invited-admin', is_admin: 0, claimed: 1, role: 'admin', status: 'invited' },
    { id: 'removed-owner', is_admin: 0, claimed: 1, role: 'owner', status: 'removed' },
  ]);
  const audits = inspected.prepare(
    `SELECT action, target_id, details FROM admin_log
     WHERE target_id IN ('removed-owner', 'invited-admin') ORDER BY target_id`,
  ).all() as Array<{ action: string; target_id: string; details: string }>;
  assert.deepEqual(audits.map((row) => [row.action, row.target_id, JSON.parse(row.details).via]), [
    ['admin_revoked', 'invited-admin', 'group_role_reconciliation'],
    ['admin_revoked', 'removed-owner', 'group_role_reconciliation'],
  ]);
  inspected.close();
  fs.rmSync(path.dirname(dbFile), { recursive: true, force: true });
});

test('account hardening clears legacy admin flags without an active admin role', () => {
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
    { id: 'claimed-admin', is_admin: 0 },
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

test('runs migrations in ascending version order regardless of declaration order', () => {
  // db.ts registers v44 and v45 textually before v41–v43 (they landed on
  // parallel branches). The module must still execute migrations sorted by
  // version, so a higher version never runs before a lower one.
  const order = readMigrationRunOrder();
  assert.deepEqual(
    order,
    [...order].sort((a, b) => a - b),
    'migrations must run in ascending version order, not declaration order',
  );
  assert.deepEqual(
    order,
    Array.from({ length: 88 }, (_, index) => index + 1),
    'every version 1..88 runs exactly once',
  );
});

test('migration 62 backfills existing players as completed and is restart-safe', () => {
  const dbFile = makeTempDbPath('player-onboarding-backfill');
  runMigrations(dbFile);

  const fixture = new Database(dbFile);
  fixture.prepare('DELETE FROM schema_migrations WHERE version = 62').run();
  fixture
    .prepare('INSERT INTO players (id, name, api_key, created_at) VALUES (?, ?, ?, ?)')
    .run('legacy-onboarding-player', 'Legacy Onboarding Player', 'legacy-onboarding-key', Date.now());
  fixture.prepare('DELETE FROM player_onboarding WHERE player_id = ?').run('legacy-onboarding-player');
  fixture.close();

  runMigrations(dbFile);
  runMigrations(dbFile);

  const migrated = new Database(dbFile, { readonly: true });
  assert.deepEqual(
    migrated.prepare('SELECT status, last_core_step, rating_status FROM player_onboarding WHERE player_id = ?').get('legacy-onboarding-player'),
    { status: 'completed', last_core_step: 9, rating_status: 'completed' },
  );
  migrated.close();
  fs.rmSync(path.dirname(dbFile), { recursive: true, force: true });
});

test('migration 75 widens the onboarding core step bound and is restart-safe', () => {
  const dbFile = makeTempDbPath('onboarding-core-step-bound');
  runMigrations(dbFile);

  // Rebuild the legacy migration-62 shape (CHECK last_core_step BETWEEN 0 AND
  // 9) over the already-migrated database, carrying over one row parked at
  // the old maximum, so migration 75 has to widen a populated table rather
  // than an empty one.
  const fixture = new Database(dbFile);
  fixture
    .prepare('INSERT INTO players (id, name, api_key, created_at) VALUES (?, ?, ?, ?)')
    .run('legacy-step-bound-player', 'Legacy Step Bound Player', 'legacy-step-bound-key', Date.now());
  fixture.exec(`
    ALTER TABLE player_onboarding RENAME TO player_onboarding_legacy;
    CREATE TABLE player_onboarding (
      player_id                 TEXT PRIMARY KEY REFERENCES players(id) ON DELETE CASCADE,
      version                   INTEGER NOT NULL DEFAULT 1,
      status                    TEXT NOT NULL DEFAULT 'completed'
                                CHECK (status IN ('pending', 'active', 'completed', 'skipped')),
      last_core_step            INTEGER NOT NULL DEFAULT 9 CHECK (last_core_step BETWEEN 0 AND 9),
      rating_status             TEXT NOT NULL DEFAULT 'completed'
                                CHECK (rating_status IN ('pending', 'active', 'completed', 'deferred')),
      rating_candidate_ids_json TEXT NOT NULL DEFAULT '[]',
      seen_views_json           TEXT NOT NULL DEFAULT '[]',
      completed_at              INTEGER,
      updated_at                INTEGER NOT NULL
    );
    INSERT INTO player_onboarding
      (player_id, version, status, last_core_step, rating_status, rating_candidate_ids_json, seen_views_json, completed_at, updated_at)
    SELECT player_id, version, status, last_core_step, rating_status, rating_candidate_ids_json, seen_views_json, completed_at, updated_at
    FROM player_onboarding_legacy;
    DROP TABLE player_onboarding_legacy;
  `);
  fixture
    .prepare(
      `INSERT INTO player_onboarding
         (player_id, version, status, last_core_step, rating_status, rating_candidate_ids_json, seen_views_json, completed_at, updated_at)
       VALUES (?, 1, 'active', 9, 'pending', '[]', '[]', NULL, ?)`,
    )
    .run('legacy-step-bound-player', Date.now());
  assert.throws(
    () =>
      fixture
        .prepare('UPDATE player_onboarding SET last_core_step = 11 WHERE player_id = ?')
        .run('legacy-step-bound-player'),
    /CHECK constraint failed/,
    'the pre-migration table must still reject the widened bound',
  );
  fixture.prepare('DELETE FROM schema_migrations WHERE version = 75').run();
  fixture.close();

  assert.doesNotThrow(() => runMigrations(dbFile));
  assert.doesNotThrow(() => runMigrations(dbFile), 'a second start must skip the recorded migration');

  const migrated = new Database(dbFile);
  assert.deepEqual(
    migrated.prepare('SELECT last_core_step FROM player_onboarding WHERE player_id = ?').get('legacy-step-bound-player'),
    { last_core_step: 9 },
    'the pre-existing row survives the rebuild unchanged',
  );
  assert.doesNotThrow(
    () =>
      migrated
        .prepare('UPDATE player_onboarding SET last_core_step = 11 WHERE player_id = ?')
        .run('legacy-step-bound-player'),
    'the widened CHECK must accept the new maximum step index',
  );
  assert.throws(
    () =>
      migrated
        .prepare('UPDATE player_onboarding SET last_core_step = 12 WHERE player_id = ?')
        .run('legacy-step-bound-player'),
    /CHECK constraint failed/,
    'the widened CHECK must still reject anything past the new maximum',
  );
  assert.ok(migrated.prepare('SELECT 1 FROM schema_migrations WHERE version = 75').get());
  migrated.close();
  fs.rmSync(path.dirname(dbFile), { recursive: true, force: true });
});

test('migration 78 widens the onboarding core step bound for event selection and is restart-safe', () => {
  const dbFile = makeTempDbPath('onboarding-event-selection-step-bound');
  runMigrations(dbFile);

  const fixture = new Database(dbFile);
  fixture
    .prepare('INSERT INTO players (id, name, api_key, created_at) VALUES (?, ?, ?, ?)')
    .run('legacy-event-step-bound-player', 'Legacy Event Step Bound Player', 'legacy-event-step-bound-key', Date.now());
  fixture.exec(`
    ALTER TABLE player_onboarding RENAME TO player_onboarding_legacy_78;
    CREATE TABLE player_onboarding (
      player_id                 TEXT PRIMARY KEY REFERENCES players(id) ON DELETE CASCADE,
      version                   INTEGER NOT NULL DEFAULT 1,
      status                    TEXT NOT NULL DEFAULT 'completed'
                                CHECK (status IN ('pending', 'active', 'completed', 'skipped')),
      last_core_step            INTEGER NOT NULL DEFAULT 9 CHECK (last_core_step BETWEEN 0 AND 11),
      rating_status             TEXT NOT NULL DEFAULT 'completed'
                                CHECK (rating_status IN ('pending', 'active', 'completed', 'deferred')),
      rating_candidate_ids_json TEXT NOT NULL DEFAULT '[]',
      seen_views_json           TEXT NOT NULL DEFAULT '[]',
      completed_at              INTEGER,
      updated_at                INTEGER NOT NULL
    );
    INSERT INTO player_onboarding
      (player_id, version, status, last_core_step, rating_status, rating_candidate_ids_json, seen_views_json, completed_at, updated_at)
    SELECT player_id, version, status, last_core_step, rating_status, rating_candidate_ids_json, seen_views_json, completed_at, updated_at
    FROM player_onboarding_legacy_78;
    DROP TABLE player_onboarding_legacy_78;
  `);
  fixture
    .prepare(
      `INSERT INTO player_onboarding
         (player_id, version, status, last_core_step, rating_status, rating_candidate_ids_json, seen_views_json, completed_at, updated_at)
       VALUES (?, 1, 'active', 11, 'pending', '[]', '[]', NULL, ?)`,
    )
    .run('legacy-event-step-bound-player', Date.now());
  assert.throws(
    () =>
      fixture
        .prepare('UPDATE player_onboarding SET last_core_step = 12 WHERE player_id = ?')
        .run('legacy-event-step-bound-player'),
    /CHECK constraint failed/,
    'the pre-migration table must still reject the event-selection step',
  );
  fixture.prepare('DELETE FROM schema_migrations WHERE version = 78').run();
  fixture.close();

  assert.doesNotThrow(() => runMigrations(dbFile));
  assert.doesNotThrow(() => runMigrations(dbFile), 'a second start must skip the recorded migration');

  const migrated = new Database(dbFile);
  assert.deepEqual(
    migrated.prepare('SELECT last_core_step FROM player_onboarding WHERE player_id = ?').get('legacy-event-step-bound-player'),
    { last_core_step: 11 },
    'the pre-existing row survives the rebuild unchanged',
  );
  assert.doesNotThrow(
    () =>
      migrated
        .prepare('UPDATE player_onboarding SET last_core_step = 12 WHERE player_id = ?')
        .run('legacy-event-step-bound-player'),
    'the event-selection step is accepted after migration',
  );
  assert.throws(
    () =>
      migrated
        .prepare('UPDATE player_onboarding SET last_core_step = 13 WHERE player_id = ?')
        .run('legacy-event-step-bound-player'),
    /CHECK constraint failed/,
    'the widened CHECK must still reject anything past the new maximum',
  );
  assert.ok(migrated.prepare('SELECT 1 FROM schema_migrations WHERE version = 78').get());
  migrated.close();
  fs.rmSync(path.dirname(dbFile), { recursive: true, force: true });
});

test('migration 70 removes legacy group/public event visibility', () => {
  const dbFile = makeTempDbPath('participant-event-visibility');
  runMigrations(dbFile);

  const fixture = new Database(dbFile);
  fixture
    .prepare(
      `INSERT INTO events
         (id, name, starts_at, group_id, status, visibility_scope)
       VALUES ('legacy-group-event', 'Legacy Group Event', 0, 'default-group', 'published', 'group')`,
    )
    .run();
  fixture.prepare('DELETE FROM schema_migrations WHERE version = 70').run();
  fixture.close();

  runMigrations(dbFile);
  runMigrations(dbFile);

  const migrated = new Database(dbFile, { readonly: true });
  assert.deepEqual(
    migrated.prepare('SELECT visibility_scope FROM events WHERE id = ?').get('legacy-group-event'),
    { visibility_scope: 'participants' },
  );
  migrated.close();
  fs.rmSync(path.dirname(dbFile), { recursive: true, force: true });
});

test('migrations 64 through 69 backfill event-bound state and keep participation history working', () => {
  const dbFile = makeTempDbPath('event-workspace-migrations-64-69');
  runMigrations(dbFile);

  const fixture = new Database(dbFile);
  const now = Date.now();
  fixture
    .prepare('INSERT INTO players (id, name, api_key, created_at) VALUES (?, ?, ?, ?)')
    .run('workspace-migration-player', 'Workspace Migration Player', 'workspace-migration-key', now);
  fixture.prepare(
    `INSERT INTO group_memberships
       (group_id, player_id, role, status, joined_at, outside_tracking_enabled)
     VALUES ('default-group', 'workspace-migration-player', 'member', 'active', ?, 0)`,
  ).run(now);
  fixture.prepare(
    `INSERT INTO events (id, name, starts_at, ends_at, group_id, status, visibility_scope)
     VALUES ('workspace-migration-event', 'Workspace Migration Event', ?, ?, 'default-group', 'published', 'participants')`,
  ).run(now, now + 60_000);
  fixture.prepare(
    "INSERT INTO event_participants (event_id, player_id, status) VALUES ('workspace-migration-event', 'workspace-migration-player', 'accepted')",
  ).run();
  const game = fixture.prepare("SELECT id FROM games WHERE group_id = 'default-group' LIMIT 1").get() as { id: string };
  fixture.prepare(
    `INSERT INTO drafts
       (id, group_id, event_id, game_id, status, captain_ids, pool_ids, picks, created_at)
     VALUES ('legacy-null-draft', 'default-group', NULL, ?, 'active', '[]', '[]', '[]', ?)`,
  ).run(game.id, now);
  fixture.exec(`
    DROP TRIGGER IF EXISTS trg_music_sessions_event_group_insert;
    DROP TRIGGER IF EXISTS trg_music_sessions_event_group_update;
  `);
  fixture.prepare(
    `INSERT INTO music_sessions
       (id, group_id, event_id, host_player_id, device_id, device_name, status, started_at)
     VALUES ('legacy-null-music', 'default-group', NULL, 'workspace-migration-player', 'device', 'Device', 'active', ?)`,
  ).run(now);
  fixture.prepare(
    `INSERT INTO push_log
       (id, group_id, event_id, title, body, audience, player_ids, created_at)
     VALUES ('legacy-null-push', 'default-group', NULL, 'Legacy', 'Body', 'direct', '["workspace-migration-player"]', ?)`,
  ).run(now);
  fixture.prepare(
    `INSERT INTO push_mutes (group_id, player_id, event_id, muted_at)
     VALUES ('default-group', 'workspace-migration-player', NULL, ?)`,
  ).run(now);
  fixture.prepare('DELETE FROM schema_migrations WHERE version BETWEEN 64 AND 69').run();
  fixture.close();

  assert.doesNotThrow(() => runMigrations(dbFile));
  assert.doesNotThrow(() => runMigrations(dbFile), 'the event workspace migrations must be restart-safe');

  const migrated = new Database(dbFile);
  assert.deepEqual(migrated.prepare('SELECT event_id FROM drafts WHERE id = ?').get('legacy-null-draft'), {
    event_id: 'instance-base-event',
  });
  assert.deepEqual(migrated.prepare('SELECT event_id FROM music_sessions WHERE id = ?').get('legacy-null-music'), {
    event_id: 'instance-base-event',
  });
  assert.deepEqual(
    migrated
      .prepare('SELECT event_id, event_name_snapshot, notification_type, target_id FROM push_log WHERE id = ?')
      .get('legacy-null-push'),
    {
      event_id: 'instance-base-event',
      event_name_snapshot: 'Allgemein',
      notification_type: 'legacy',
      target_id: 'legacy-null-push',
    },
  );
  assert.deepEqual(
    migrated
      .prepare('SELECT event_id FROM push_mutes WHERE group_id = ? AND player_id = ?')
      .get('default-group', 'workspace-migration-player'),
    { event_id: 'instance-base-event' },
  );
  migrated
    .prepare('DELETE FROM event_participants WHERE event_id = ? AND player_id = ?')
    .run('workspace-migration-event', 'workspace-migration-player');
  const history = migrated
    .prepare('SELECT accepted_at, removed_at FROM event_participation_history WHERE event_id = ? AND player_id = ?')
    .get('workspace-migration-event', 'workspace-migration-player') as { accepted_at: number | null; removed_at: number | null };
  assert.equal(typeof history.accepted_at, 'number');
  assert.equal(typeof history.removed_at, 'number');
  migrated.close();
  fs.rmSync(path.dirname(dbFile), { recursive: true, force: true });
});

test('migration 71 moves legacy NULL operational scopes into the permanent base event', () => {
  const dbFile = makeTempDbPath('legacy-operational-base-event');
  runMigrations(dbFile);

  const fixture = new Database(dbFile);
  const now = Date.now();
  fixture
    .prepare('INSERT INTO players (id, name, api_key, created_at) VALUES (?, ?, ?, ?)')
    .run('legacy-operational-player', 'Legacy Operational Player', 'legacy-operational-key', now);
  fixture.prepare(
    `INSERT INTO group_memberships
       (group_id, player_id, role, status, joined_at, outside_tracking_enabled)
     VALUES ('default-group', 'legacy-operational-player', 'member', 'active', ?, 0)`,
  ).run(now);
  fixture.prepare(
    `INSERT INTO broadcasts
       (id, group_id, event_id, player_id, player_name_snapshot, message, ends_at, recipient_ids, created_at)
     VALUES ('legacy-operational-broadcast', 'default-group', NULL, 'legacy-operational-player',
             'Legacy Operational Player', 'Legacy broadcast', ?, '["legacy-operational-player"]', ?)`,
  ).run(now + 60_000, now);
  fixture.prepare(
    `INSERT INTO info_entries (id, group_id, event_id, title, content, created_at, updated_at)
     VALUES ('legacy-operational-info', 'default-group', NULL, 'Legacy info', 'Content', ?, ?)`,
  ).run(now, now);
  fixture.prepare(
    `INSERT INTO arcade_results
       (id, game_type, players, scores, reason, started_at, ended_at, group_id, event_id)
     VALUES ('legacy-operational-arcade', 'quiz', '[]', '[]', 'completed', ?, ?, 'default-group', NULL)`,
  ).run(now, now + 1);
  fixture.prepare(
    `INSERT INTO scribble_drawings
       (id, match_id, round_number, turn_number, artist_id, artist_name, word, draw_ops,
        created_at, group_id, event_id)
     VALUES ('legacy-operational-drawing', 'legacy-match', 1, 1, 'legacy-operational-player',
             'Legacy Operational Player', 'LAN', '[]', ?, 'default-group', NULL)`,
  ).run(now);
  fixture.prepare(
    `INSERT INTO checklist_items
       (id, group_id, event_id, player_id, label, created_at)
     VALUES ('legacy-operational-checklist', 'default-group', NULL, 'legacy-operational-player', 'Maus', ?)`,
  ).run(now);
  fixture.prepare(
    `INSERT INTO checklist_materializations (group_id, event_id, player_id, materialized_at)
     VALUES ('default-group', NULL, 'legacy-operational-player', ?)`,
  ).run(now);
  fixture.prepare(
    `INSERT INTO tracking_live_contexts
       (player_id, group_id, event_id, last_seen, manual_note, activity_tracked)
     VALUES ('legacy-operational-player', 'default-group', NULL, ?, 'legacy', 1)`,
  ).run(now);
  fixture.prepare(
    `INSERT INTO kiosk_tokens
       (id, token_hash, group_id, event_id, label, created_by, created_at)
     VALUES ('legacy-operational-kiosk', 'legacy-operational-token-hash', 'default-group', NULL,
             'Legacy TV', 'legacy-operational-player', ?)`,
  ).run(now);
  fixture.prepare('DELETE FROM schema_migrations WHERE version = 71').run();
  fixture.close();

  assert.doesNotThrow(() => runMigrations(dbFile));
  assert.doesNotThrow(() => runMigrations(dbFile), 'the base-event backfill must be restart-safe');

  const migrated = new Database(dbFile, { readonly: true });
  for (const [table, id] of [
    ['broadcasts', 'legacy-operational-broadcast'],
    ['info_entries', 'legacy-operational-info'],
    ['arcade_results', 'legacy-operational-arcade'],
    ['scribble_drawings', 'legacy-operational-drawing'],
    ['checklist_items', 'legacy-operational-checklist'],
    ['kiosk_tokens', 'legacy-operational-kiosk'],
  ] as const) {
    assert.deepEqual(migrated.prepare(`SELECT event_id FROM ${table} WHERE id = ?`).get(id), {
      event_id: 'instance-base-event',
    });
  }
  assert.deepEqual(
    migrated
      .prepare('SELECT event_id FROM checklist_materializations WHERE group_id = ? AND player_id = ?')
      .get('default-group', 'legacy-operational-player'),
    { event_id: 'instance-base-event' },
  );
  assert.deepEqual(
    migrated
      .prepare('SELECT event_id, manual_note, activity_tracked FROM tracking_live_contexts WHERE group_id = ? AND player_id = ?')
      .get('default-group', 'legacy-operational-player'),
    { event_id: 'instance-base-event', manual_note: 'legacy', activity_tracked: 1 },
  );
  migrated.close();
  fs.rmSync(path.dirname(dbFile), { recursive: true, force: true });
});

test('migration 63 creates the base event and repairs missing account event contexts', () => {
  const dbFile = makeTempDbPath('player-event-context-backfill');
  runMigrations(dbFile);

  const fixture = new Database(dbFile);
  const now = Date.now();
  fixture.prepare('DELETE FROM schema_migrations WHERE version = 63').run();
  fixture
    .prepare('INSERT INTO players (id, name, api_key, created_at) VALUES (?, ?, ?, ?)')
    .run('legacy-context-player', 'Legacy Context Player', 'legacy-context-key', now);
  fixture
    .prepare('INSERT INTO players (id, name, api_key, created_at) VALUES (?, ?, ?, ?)')
    .run('legacy-tracked-player', 'Legacy Tracked Player', 'legacy-tracked-key', now);
  fixture.prepare(
    `INSERT INTO group_memberships
       (group_id, player_id, role, status, joined_at, outside_tracking_enabled)
     VALUES ('default-group', 'legacy-tracked-player', 'member', 'active', ?, 0)`,
  ).run(now);
  fixture.prepare(
    `INSERT INTO events
       (id, name, starts_at, ends_at, tracking_enabled, group_id, status, visibility_scope)
     VALUES ('legacy-tracked-event', 'Legacy Tracked Event', ?, ?, 1,
             'default-group', 'published', 'participants')`,
  ).run(now - 60_000, now + 60_000);
  fixture.prepare(
    `INSERT INTO event_participants (event_id, player_id, status)
     VALUES ('legacy-tracked-event', 'legacy-tracked-player', 'accepted')`,
  ).run();
  fixture.prepare(
    `INSERT INTO tracking_live_contexts
       (player_id, group_id, event_id, last_seen, manual_note, activity_tracked)
     VALUES ('legacy-tracked-player', 'default-group', 'legacy-tracked-event', ?, NULL, 1)`,
  ).run(now);
  fixture
    .prepare(
      `INSERT INTO invites (code, purpose, player_id, created_by, created_at, expires_at)
       VALUES (?, 'register', NULL, NULL, ?, ?)`,
    )
    .run('legacy-context-invite', now, now + 60_000);
  fixture.close();

  assert.doesNotThrow(() => runMigrations(dbFile));
  assert.doesNotThrow(() => runMigrations(dbFile), 'a second start must not duplicate the base event or context');

  const migrated = new Database(dbFile, { readonly: true });
  assert.deepEqual(
    migrated
      .prepare('SELECT name, starts_at, ends_at, status, visibility_scope FROM events WHERE id = ?')
      .get('instance-base-event'),
    {
      name: 'Allgemein',
      starts_at: 0,
      ends_at: null,
      status: 'published',
      visibility_scope: 'participants',
    },
  );
  assert.deepEqual(migrated.prepare("SELECT value FROM app_state WHERE key = 'base_event_id'").get(), {
    value: 'instance-base-event',
  });
  assert.deepEqual(
    migrated
      .prepare('SELECT status FROM event_participants WHERE event_id = ? AND player_id = ?')
      .get('instance-base-event', 'legacy-context-player'),
    { status: 'accepted' },
  );
  assert.deepEqual(
    migrated.prepare('SELECT active_event_id FROM player_event_contexts WHERE player_id = ?').get('legacy-context-player'),
    { active_event_id: 'instance-base-event' },
  );
  assert.deepEqual(
    migrated.prepare('SELECT active_event_id FROM player_event_contexts WHERE player_id = ?').get('legacy-tracked-player'),
    { active_event_id: 'legacy-tracked-event' },
    'an in-progress accepted tracking context must survive the event-workspace migration',
  );
  assert.deepEqual(migrated.prepare('SELECT event_id FROM invites WHERE code = ?').get('legacy-context-invite'), {
    event_id: 'instance-base-event',
  });
  assert.equal(
    (migrated.prepare('SELECT COUNT(*) AS count FROM events WHERE id = ?').get('instance-base-event') as { count: number })
      .count,
    1,
  );
  migrated.close();
  fs.rmSync(path.dirname(dbFile), { recursive: true, force: true });
});

test('migration 53 preserves legacy event participants as accepted and is restart-safe', () => {
  const dbFile = makeTempDbPath('event-participant-status');
  runMigrations(dbFile);

  const fixture = new Database(dbFile);
  fixture.pragma('foreign_keys = OFF');
  fixture
    .prepare('INSERT INTO players (id, name, api_key, created_at) VALUES (?, ?, ?, ?)')
    .run('legacy-event-player', 'Legacy Event Player', 'legacy-event-player-key', Date.now());
  fixture
    .prepare(
      `INSERT INTO events (id, name, starts_at, ends_at, group_id, status, visibility_scope)
       VALUES (?, ?, ?, ?, 'default-group', 'published', 'participants')`,
    )
    .run('legacy-event', 'Legacy Event', Date.now(), Date.now() + 60_000);
  fixture.exec(`
    CREATE TABLE event_participants_legacy (
      event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
      player_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
      PRIMARY KEY (event_id, player_id)
    );
    INSERT INTO event_participants_legacy (event_id, player_id)
      VALUES ('legacy-event', 'legacy-event-player');
    DROP TABLE event_participants;
    ALTER TABLE event_participants_legacy RENAME TO event_participants;
    DELETE FROM schema_migrations WHERE version = 53;
  `);
  fixture.close();

  assert.doesNotThrow(() => runMigrations(dbFile));
  assert.doesNotThrow(() => runMigrations(dbFile), 'a second start must skip the recorded migration');

  const migrated = new Database(dbFile);
  const row = migrated
    .prepare('SELECT status FROM event_participants WHERE event_id = ? AND player_id = ?')
    .get('legacy-event', 'legacy-event-player');
  assert.deepEqual(row, { status: 'accepted' });
  assert.throws(
    () =>
      migrated
        .prepare('UPDATE event_participants SET status = ? WHERE event_id = ? AND player_id = ?')
        .run('unknown', 'legacy-event', 'legacy-event-player'),
    /CHECK constraint failed/,
  );
  assert.ok(migrated.prepare('SELECT 1 FROM schema_migrations WHERE version = 53').get());
  migrated.close();
  fs.rmSync(path.dirname(dbFile), { recursive: true, force: true });
});

test('re-running migration 44 does not crash on the guarded allocation_weight column', () => {
  const dbFile = makeTempDbPath('v44-alter-idempotent');
  runMigrations(dbFile);

  // Simulate a database that still carries the v44 schema (allocation_weight
  // and the consent/kiosk tables) but whose migration record was cleared,
  // forcing v44 to run a second time over an already-migrated schema. Before
  // the guard, the bare `ALTER TABLE play_sessions ADD COLUMN allocation_weight`
  // crashed here with "duplicate column name: allocation_weight".
  const fixture = new Database(dbFile);
  const before = fixture.prepare('PRAGMA table_info(play_sessions)').all() as Array<{ name: string }>;
  assert.ok(before.some((column) => column.name === 'allocation_weight'), 'v44 should have added allocation_weight');
  fixture.prepare('DELETE FROM schema_migrations WHERE version = 44').run();
  fixture.close();

  assert.doesNotThrow(() => runMigrations(dbFile));

  const migrated = new Database(dbFile, { readonly: true });
  const allocationColumns = (migrated.prepare('PRAGMA table_info(play_sessions)').all() as Array<{ name: string }>).filter(
    (column) => column.name === 'allocation_weight',
  );
  assert.equal(allocationColumns.length, 1, 'allocation_weight must exist exactly once after re-running v44');
  assert.ok(
    migrated.prepare('SELECT 1 FROM schema_migrations WHERE version = 44').get(),
    'v44 is recorded again after the forced re-run',
  );
  migrated.close();
  fs.rmSync(path.dirname(dbFile), { recursive: true, force: true });
});

test('re-applying the reordered v41–v45 migrations over populated data is idempotent and lossless', () => {
  const dbFile = makeTempDbPath('reorder-upgrade-no-data-loss');
  runMigrations(dbFile);

  const fixture = new Database(dbFile);
  const now = Date.now();
  const game = fixture.prepare('SELECT id FROM games WHERE group_id = ? LIMIT 1').get('default-group') as { id: string };
  fixture
    .prepare('INSERT INTO players (id, name, api_key, created_at) VALUES (?, ?, ?, ?)')
    .run('keep-player', 'Keep Player', 'keep-player-key', now);
  // allocation_weight (v44), food-order paid (v41)/finalize+paypal (v42)/tip
  // (v43) and checklist rows (v45) are exactly the columns/tables the
  // out-of-order migrations own. Seed a value in each so a destructive or
  // duplicated re-run would be observable.
  fixture
    .prepare(
      `INSERT INTO play_sessions (id, player_id, game_id, event_id, started_at, ended_at, active_ms, group_id, allocation_weight)
       VALUES (?, ?, ?, 'outside-events', ?, ?, 0, 'default-group', 2.5)`,
    )
    .run('keep-session', 'keep-player', game.id, now, now + 1000);
  fixture
    .prepare(
      `INSERT INTO food_orders (id, event_id, title, created_by, created_at, closed_at, finalized_at, paypal_link, tip_percent)
       VALUES (?, 'outside-events', 'Keep Order', 'keep-player', ?, ?, ?, 'http://pay.example', 15)`,
    )
    .run('keep-order', now, now + 10, now + 20);
  fixture
    .prepare(
      `INSERT INTO food_order_items (id, order_id, player_id, description, quantity, price_cents, paid, created_at)
       VALUES (?, 'keep-order', 'keep-player', 'Pizza', 3, 900, 1, ?)`,
    )
    .run('keep-item', now);
  fixture
    .prepare(
      `INSERT INTO checklist_items (id, group_id, event_id, player_id, label, template_key, checked_at, created_at)
       VALUES (?, 'default-group', NULL, 'keep-player', 'Maus', NULL, NULL, ?)`,
    )
    .run('keep-checklist', now);
  // Clear the records for the out-of-order versions so the sorted runner
  // re-applies them over the existing rows — the exact situation a database
  // that first saw v44/v45 before v41–v43 faces on the next start after the fix.
  fixture.prepare('DELETE FROM schema_migrations WHERE version IN (41, 42, 43, 44, 45)').run();
  fixture.close();

  assert.doesNotThrow(() => runMigrations(dbFile));

  const migrated = new Database(dbFile, { readonly: true });
  const session = migrated.prepare('SELECT allocation_weight FROM play_sessions WHERE id = ?').get('keep-session') as {
    allocation_weight: number;
  };
  assert.equal(session.allocation_weight, 2.5, 'existing allocation_weight must survive the v44 re-run');
  const order = migrated
    .prepare('SELECT finalized_at, paypal_link, tip_percent FROM food_orders WHERE id = ?')
    .get('keep-order') as { finalized_at: number; paypal_link: string; tip_percent: number };
  assert.equal(order.finalized_at, now + 20);
  assert.equal(order.paypal_link, 'http://pay.example');
  assert.equal(order.tip_percent, 15);
  const item = migrated.prepare('SELECT quantity, paid FROM food_order_items WHERE id = ?').get('keep-item') as {
    quantity: number;
    paid: number;
  };
  assert.equal(item.quantity, 3);
  assert.equal(item.paid, 1);
  const checklist = migrated.prepare('SELECT label FROM checklist_items WHERE id = ?').get('keep-checklist') as {
    label: string;
  };
  assert.equal(checklist.label, 'Maus', 'existing checklist rows must survive the v45 re-run');
  const versions = (
    migrated.prepare('SELECT version FROM schema_migrations WHERE version IN (41, 42, 43, 44, 45) ORDER BY version').all() as Array<{
      version: number;
    }>
  ).map((row) => row.version);
  assert.deepEqual(versions, [41, 42, 43, 44, 45], 'the cleared versions are recorded again after re-applying');
  migrated.close();
  fs.rmSync(path.dirname(dbFile), { recursive: true, force: true });
});

test('migration 55 converts legacy free-text genre values into the multiselect JSON array and is restart-safe', () => {
  const dbFile = makeTempDbPath('games-genre-multiselect');
  runMigrations(dbFile);

  const fixture = new Database(dbFile);
  const now = Date.now();
  fixture
    .prepare('INSERT INTO games (id, name, created_at, genre) VALUES (?, ?, ?, ?)')
    .run('legacy-genre-known', 'Legacy Known Genre', now, 'shooter');
  fixture
    .prepare('INSERT INTO games (id, name, created_at, genre) VALUES (?, ?, ?, ?)')
    .run('legacy-genre-unknown', 'Legacy Unknown Genre', now, 'Battle Royale FPS Extreme');
  fixture
    .prepare('INSERT INTO games (id, name, created_at, genre) VALUES (?, ?, ?, ?)')
    .run('legacy-genre-blank', 'Legacy Blank Genre', now, '   ');
  fixture.exec('DELETE FROM schema_migrations WHERE version = 55');
  fixture.close();

  assert.doesNotThrow(() => runMigrations(dbFile));
  assert.doesNotThrow(() => runMigrations(dbFile), 'a second start must skip the recorded migration');

  const migrated = new Database(dbFile);
  const known = migrated.prepare('SELECT genre FROM games WHERE id = ?').get('legacy-genre-known') as { genre: string };
  assert.equal(known.genre, JSON.stringify(['Shooter']), 'a case-insensitive match is normalized to the canonical spelling');
  const unknown = migrated.prepare('SELECT genre FROM games WHERE id = ?').get('legacy-genre-unknown') as { genre: string | null };
  assert.equal(unknown.genre, null, 'free text that matches no known genre is cleared instead of kept unselectable');
  const blank = migrated.prepare('SELECT genre FROM games WHERE id = ?').get('legacy-genre-blank') as { genre: string | null };
  assert.equal(blank.genre, null);
  assert.ok(migrated.prepare('SELECT 1 FROM schema_migrations WHERE version = 55').get());
  migrated.close();
  fs.rmSync(path.dirname(dbFile), { recursive: true, force: true });
});

test('migration 58 preserves late legacy admins and backfills memberships without reviving tracking consent', () => {
  const dbFile = makeTempDbPath('legacy-auth-cutover');
  runMigrations(dbFile);

  const fixture = new Database(dbFile);
  const now = Date.now();
  const insertPlayer = fixture.prepare(
    `INSERT INTO players
       (id, name, api_key, tracking_paused, is_admin, is_test, password_hash, deactivated_at, created_at)
     VALUES (?, ?, ?, ?, ?, 0, ?, NULL, ?)`,
  );
  const insertMembership = fixture.prepare(
    `INSERT INTO group_memberships
       (group_id, player_id, role, status, joined_at, ended_at, outside_tracking_enabled, invited_by)
     VALUES ('default-group', ?, ?, ?, ?, ?, ?, NULL)`,
  );

  insertPlayer.run('legacy-admin', 'Legacy Admin', 'legacy-admin-key', 0, 1, 'claimed-hash', now);
  insertMembership.run('legacy-admin', 'member', 'active', now, null, 1);

  insertPlayer.run('legacy-unclaimed-admin', 'Legacy Unclaimed Admin', 'legacy-unclaimed-admin-key', 0, 1, null, now);
  insertMembership.run('legacy-unclaimed-admin', 'member', 'active', now, null, 1);

  insertPlayer.run('late-player', 'Late Player', 'late-player-key', 0, 0, null, now + 1);

  insertPlayer.run('revoked-player', 'Revoked Player', 'revoked-player-key', 0, 0, null, now + 2);
  insertMembership.run('revoked-player', 'member', 'active', now + 2, null, 1);
  fixture
    .prepare(
      `INSERT INTO group_tracking_consents
         (id, group_id, player_id, granted_at, revoked_at, source)
       VALUES (?, 'default-group', ?, ?, ?, 'user')`,
    )
    .run('revoked-consent', 'revoked-player', now + 2, now + 3);

  fixture
    .prepare(
      `INSERT INTO events (id, name, starts_at, ends_at, group_id, status, visibility_scope)
       VALUES (?, ?, ?, ?, 'default-group', 'published', 'participants')`,
    )
    .run('legacy-private-event', 'Legacy Private Event', now, now + 60_000);
  fixture
    .prepare("INSERT INTO event_participants (event_id, player_id, status) VALUES ('legacy-private-event', ?, 'accepted')")
    .run('late-player');
  fixture
    .prepare("INSERT INTO event_participants (event_id, player_id, status) VALUES ('legacy-private-event', ?, 'accepted')")
    .run('revoked-player');
  fixture
    .prepare(
      `INSERT INTO event_tracking_consents
         (id, event_id, group_id, player_id, accepted_at, revoked_at, source)
       VALUES (?, 'legacy-private-event', 'default-group', ?, ?, ?, 'user')`,
    )
    .run('revoked-event-consent', 'revoked-player', now + 2, now + 3);

  insertPlayer.run('removed-player', 'Removed Player', 'removed-player-key', 0, 0, null, now + 4);
  insertMembership.run('removed-player', 'member', 'removed', now + 4, now + 5, 0);

  fixture.prepare('DELETE FROM schema_migrations WHERE version = 58').run();
  fixture.close();

  assert.doesNotThrow(() => runMigrations(dbFile, { AUTH_MODE: 'legacy' }));
  assert.doesNotThrow(
    () => runMigrations(dbFile, { AUTH_MODE: 'legacy' }),
    'the cutover migration must be restart-safe',
  );

  const migrated = new Database(dbFile, { readonly: true });
  assert.deepEqual(
    migrated
      .prepare('SELECT role, status, outside_tracking_enabled FROM group_memberships WHERE group_id = ? AND player_id = ?')
      .get('default-group', 'legacy-admin'),
    { role: 'admin', status: 'active', outside_tracking_enabled: 1 },
  );
  assert.deepEqual(
    migrated.prepare('SELECT is_admin FROM players WHERE id = ?').get('legacy-admin'),
    { is_admin: 1 },
  );
  assert.deepEqual(
    migrated
      .prepare('SELECT role, status FROM group_memberships WHERE group_id = ? AND player_id = ?')
      .get('default-group', 'legacy-unclaimed-admin'),
    { role: 'admin', status: 'active' },
  );
  assert.deepEqual(
    migrated.prepare('SELECT is_admin, password_hash FROM players WHERE id = ?').get('legacy-unclaimed-admin'),
    { is_admin: 1, password_hash: null },
  );
  assert.deepEqual(
    migrated
      .prepare('SELECT role, status, outside_tracking_enabled FROM group_memberships WHERE group_id = ? AND player_id = ?')
      .get('default-group', 'late-player'),
    { role: 'member', status: 'active', outside_tracking_enabled: 1 },
  );
  assert.equal(
    (migrated
      .prepare(
        `SELECT COUNT(*) AS count FROM group_tracking_consents
         WHERE group_id = ? AND player_id = ? AND revoked_at IS NULL`,
      )
      .get('default-group', 'late-player') as { count: number }).count,
    1,
  );
  assert.deepEqual(
    migrated
      .prepare('SELECT status, outside_tracking_enabled FROM group_memberships WHERE group_id = ? AND player_id = ?')
      .get('default-group', 'revoked-player'),
    { status: 'active', outside_tracking_enabled: 0 },
  );
  assert.equal(
    (migrated
      .prepare(
        `SELECT COUNT(*) AS count FROM group_tracking_consents
         WHERE group_id = ? AND player_id = ? AND revoked_at IS NULL`,
      )
      .get('default-group', 'revoked-player') as { count: number }).count,
    0,
  );
  assert.equal(
    (migrated
      .prepare(
        `SELECT COUNT(*) AS count FROM event_tracking_consents
         WHERE event_id = ? AND player_id = ? AND revoked_at IS NULL`,
      )
      .get('legacy-private-event', 'late-player') as { count: number }).count,
    1,
  );
  assert.equal(
    (migrated
      .prepare(
        `SELECT COUNT(*) AS count FROM event_tracking_consents
         WHERE event_id = ? AND player_id = ? AND revoked_at IS NULL`,
      )
      .get('legacy-private-event', 'revoked-player') as { count: number }).count,
    0,
  );
  assert.deepEqual(
    migrated
      .prepare('SELECT status, outside_tracking_enabled FROM group_memberships WHERE group_id = ? AND player_id = ?')
      .get('default-group', 'removed-player'),
    { status: 'removed', outside_tracking_enabled: 0 },
  );
  assert.equal(
    (migrated
      .prepare(
        `SELECT COUNT(*) AS count FROM admin_log
         WHERE target_id = ? AND action = 'admin_granted' AND details LIKE '%legacy_auth_cutover%'`,
      )
      .get('legacy-admin') as { count: number }).count,
    1,
  );
  assert.equal(
    (migrated
      .prepare(
        `SELECT COUNT(*) AS count FROM admin_log
         WHERE target_id = ? AND action = 'admin_granted' AND details LIKE '%legacy_auth_cutover%'`,
      )
      .get('legacy-unclaimed-admin') as { count: number }).count,
    1,
  );
  assert.ok(migrated.prepare('SELECT 1 FROM schema_migrations WHERE version = 58').get());
  migrated.close();
  fs.rmSync(path.dirname(dbFile), { recursive: true, force: true });
});

test('migration 58 preserves missing event consent from required-auth operation', () => {
  const dbFile = makeTempDbPath('required-auth-event-consent');
  runMigrations(dbFile);

  const fixture = new Database(dbFile);
  const now = Date.now();
  fixture
    .prepare(
      `INSERT INTO players
         (id, name, api_key, tracking_paused, is_admin, is_test, password_hash, deactivated_at, created_at)
       VALUES (?, ?, ?, 0, 0, 0, ?, NULL, ?)`,
    )
    .run('required-member', 'Required Member', 'required-member-key', 'claimed-hash', now);
  fixture
    .prepare(
      `INSERT INTO group_memberships
         (group_id, player_id, role, status, joined_at, ended_at, outside_tracking_enabled, invited_by)
       VALUES ('default-group', 'required-member', 'member', 'active', ?, NULL, 1, NULL)`,
    )
    .run(now);
  fixture
    .prepare(
      `INSERT INTO events (id, name, starts_at, ends_at, group_id, status, visibility_scope)
       VALUES ('required-private-event', 'Required Private Event', ?, ?, 'default-group', 'published', 'participants')`,
    )
    .run(now, now + 60_000);
  fixture
    .prepare(
      `INSERT INTO event_participants (event_id, player_id, status)
       VALUES ('required-private-event', 'required-member', 'accepted')`,
    )
    .run();
  fixture.prepare('DELETE FROM schema_migrations WHERE version = 58').run();
  fixture.close();

  assert.doesNotThrow(() => runMigrations(dbFile, { AUTH_MODE: 'required' }));

  const migrated = new Database(dbFile, { readonly: true });
  assert.equal(
    (migrated
      .prepare(
        `SELECT COUNT(*) AS count FROM event_tracking_consents
         WHERE event_id = 'required-private-event' AND player_id = 'required-member'`,
      )
      .get() as { count: number }).count,
    0,
    'accepted roster membership must not be upgraded to tracking consent in required auth mode',
  );
  assert.ok(migrated.prepare('SELECT 1 FROM schema_migrations WHERE version = 58').get());
  migrated.close();
  fs.rmSync(path.dirname(dbFile), { recursive: true, force: true });
});

test('the Battleship display-name rename reaches a database seeded before the rename and is restart-safe', () => {
  const dbFile = makeTempDbPath('arcade-battleship-rename');
  runMigrations(dbFile);

  const fixture = new Database(dbFile);
  fixture.prepare("UPDATE games SET name = 'Schiffe versenken' WHERE arcade_key = 'battleship'").run();
  fixture.prepare("DELETE FROM app_state WHERE key = 'arcade_rename_battleship_2026_08'").run();
  fixture.close();

  runMigrations(dbFile);
  runMigrations(dbFile);

  const migrated = new Database(dbFile, { readonly: true });
  assert.equal(
    (migrated.prepare("SELECT name FROM games WHERE arcade_key = 'battleship'").get() as { name: string }).name,
    'Battleship',
  );
  migrated.close();
  fs.rmSync(path.dirname(dbFile), { recursive: true, force: true });
});

test('migration 72 keeps legacy competition and seating rows reachable through the base event', () => {
  const dbFile = makeTempDbPath('legacy-competition-backfill');
  runMigrations(dbFile);

  const fixture = new Database(dbFile);
  const now = Date.now();
  for (const [id, name] of [
    ['legacy-vote-player', 'Legacy Vote Player'],
    ['legacy-seat-neighbor', 'Legacy Seat Neighbor'],
  ]) {
    fixture
      .prepare('INSERT INTO players (id, name, api_key, created_at) VALUES (?, ?, ?, ?)')
      .run(id, name, `${id}-key`, now);
    fixture
      .prepare(
        `INSERT INTO group_memberships
           (group_id, player_id, role, status, joined_at, outside_tracking_enabled)
         VALUES ('default-group', ?, 'member', 'active', ?, 0)`,
      )
      .run(id, now);
  }
  const game = fixture.prepare("SELECT id FROM games WHERE group_id = 'default-group' LIMIT 1").get() as { id: string };

  // Exactly what POST /api/votes/start wrote before this PR whenever no event
  // was tracking: a real, closed round with no event of its own.
  fixture
    .prepare(
      `INSERT INTO vote_rounds
         (group_id, round, event_id, started_at, closed_at, winner_game_ids, mode, title, info, selected_game_ids)
       VALUES ('default-group', 4711, NULL, ?, ?, NULL, 'points', 'Legacy Runde', NULL, NULL)`,
    )
    .run(now, now + 1_000);
  fixture
    .prepare(
      `INSERT INTO votes
         (id, group_id, player_id, player_name_snapshot, game_id, event_id, round, points, created_at)
       VALUES ('legacy-vote', 'default-group', 'legacy-vote-player', 'Legacy Vote Player', ?, NULL, 4711, 7, ?)`,
    )
    .run(game.id, now);
  fixture
    .prepare(
      `INSERT INTO seat_neighbors
         (group_id, event_id, player_id, neighbor_id, player_name_snapshot, neighbor_name_snapshot)
       VALUES ('default-group', NULL, 'legacy-vote-player', 'legacy-seat-neighbor',
               'Legacy Vote Player', 'Legacy Seat Neighbor')`,
    )
    .run();

  fixture.prepare('DELETE FROM schema_migrations WHERE version = 72').run();
  fixture.close();

  runMigrations(dbFile);
  // Re-running must not double-write or fail.
  runMigrations(dbFile);

  const migrated = new Database(dbFile, { readonly: true });
  assert.equal(
    (migrated.prepare('SELECT event_id AS eventId FROM vote_rounds WHERE round = 4711').get() as { eventId: string })
      .eventId,
    'instance-base-event',
    'a closed legacy round stays readable through the base workspace',
  );
  assert.equal(
    (migrated.prepare("SELECT event_id AS eventId FROM votes WHERE id = 'legacy-vote'").get() as { eventId: string })
      .eventId,
    'instance-base-event',
    'and so do the votes cast in it',
  );
  assert.equal(
    (
      migrated
        .prepare("SELECT event_id AS eventId FROM seat_neighbors WHERE player_id = 'legacy-vote-player'")
        .get() as { eventId: string }
    ).eventId,
    'instance-base-event',
  );
  assert.equal(
    (migrated.prepare('SELECT COUNT(*) AS n FROM vote_rounds WHERE event_id IS NULL').get() as { n: number }).n,
    0,
    'no competition row is left in the retired NULL room',
  );
  migrated.close();
  fs.rmSync(path.dirname(dbFile), { recursive: true, force: true });
});

test('migration 73 re-filters legacy agent diagnostics down to configured game processes', () => {
  const dbFile = makeTempDbPath('legacy-agent-diagnostics-refilter');
  runMigrations(dbFile);

  const fixture = new Database(dbFile);
  const now = Date.now();
  fixture
    .prepare(
      `INSERT INTO games (id, name, icon, min_team_size, max_team_size, created_at, group_id)
       VALUES ('legacy-diag-game', 'Legacy Diag Game', '🎮', 1, 1, ?, 'default-group')`,
    )
    .run(now);
  fixture
    .prepare(
      `INSERT INTO game_process_names (id, game_id, group_id, process_name)
       VALUES ('legacy-diag-proc', 'legacy-diag-game', 'default-group', 'legacy-diag-legit.exe')`,
    )
    .run();

  // A player whose agent reported before routes/agent.ts filtered every scan
  // server-side: raw Windows system processes sit next to the one real game
  // process, exactly what the admin diagnostics view showed in production.
  fixture
    .prepare('INSERT INTO players (id, name, api_key, created_at) VALUES (?, ?, ?, ?)')
    .run('legacy-diag-player', 'Legacy Diag Player', 'legacy-diag-player-key', now);
  fixture
    .prepare(
      `INSERT INTO group_memberships
         (group_id, player_id, role, status, joined_at, outside_tracking_enabled)
       VALUES ('default-group', 'legacy-diag-player', 'member', 'active', ?, 0)`,
    )
    .run(now);
  fixture
    .prepare('INSERT INTO agent_diagnostics (player_id, agent_version, last_report_at, process_names) VALUES (?, ?, ?, ?)')
    .run(
      'legacy-diag-player',
      '0.9.0',
      now,
      JSON.stringify(['legacy-diag-legit.exe', 'svchost.exe', 'lsass.exe', 'csrss.exe', 'memory compression']),
    );

  // A player whose stored diagnostics are already clean must be left exactly
  // as-is — this migration only removes, it never needs to touch a row that
  // is already correct.
  fixture
    .prepare('INSERT INTO players (id, name, api_key, created_at) VALUES (?, ?, ?, ?)')
    .run('legacy-diag-clean-player', 'Legacy Diag Clean Player', 'legacy-diag-clean-key', now);
  fixture
    .prepare(
      `INSERT INTO group_memberships
         (group_id, player_id, role, status, joined_at, outside_tracking_enabled)
       VALUES ('default-group', 'legacy-diag-clean-player', 'member', 'active', ?, 0)`,
    )
    .run(now);
  fixture
    .prepare('INSERT INTO agent_diagnostics (player_id, agent_version, last_report_at, process_names) VALUES (?, ?, ?, ?)')
    .run('legacy-diag-clean-player', '1.0.0', now, JSON.stringify(['legacy-diag-legit.exe']));

  // A player with no group_memberships row at all falls back to the default
  // group, same as activePlayerGroupIds() does at request time — so this
  // legacy player must be re-filtered against the default group's allow-list
  // too, not skipped or wiped to nothing.
  fixture
    .prepare('INSERT INTO players (id, name, api_key, created_at) VALUES (?, ?, ?, ?)')
    .run('legacy-diag-no-membership', 'Legacy Diag No Membership', 'legacy-diag-no-membership-key', now);
  fixture
    .prepare('INSERT INTO agent_diagnostics (player_id, agent_version, last_report_at, process_names) VALUES (?, ?, ?, ?)')
    .run('legacy-diag-no-membership', '0.8.0', now, JSON.stringify(['legacy-diag-legit.exe', 'explorer.exe']));

  // A row corrupted beyond valid JSON must not crash the migration or the
  // rest of the database it runs alongside.
  fixture
    .prepare('INSERT INTO players (id, name, api_key, created_at) VALUES (?, ?, ?, ?)')
    .run('legacy-diag-malformed', 'Legacy Diag Malformed', 'legacy-diag-malformed-key', now);
  fixture
    .prepare('INSERT INTO agent_diagnostics (player_id, agent_version, last_report_at, process_names) VALUES (?, ?, ?, ?)')
    .run('legacy-diag-malformed', '0.7.0', now, 'not valid json');

  fixture.prepare('DELETE FROM schema_migrations WHERE version = 73').run();
  fixture.close();

  assert.doesNotThrow(() => runMigrations(dbFile));
  // Re-running must not double-write or fail: schema_migrations already
  // records version 73 by now, so this second call must be a pure no-op.
  assert.doesNotThrow(() => runMigrations(dbFile), 'the re-filter must be restart-safe');

  const migrated = new Database(dbFile, { readonly: true });
  const processNamesOf = (playerId: string): string[] =>
    JSON.parse(
      (migrated.prepare('SELECT process_names FROM agent_diagnostics WHERE player_id = ?').get(playerId) as {
        process_names: string;
      }).process_names,
    );

  assert.deepEqual(
    processNamesOf('legacy-diag-player'),
    ['legacy-diag-legit.exe'],
    'Windows system processes from before server-side filtering existed must be removed',
  );
  assert.deepEqual(
    processNamesOf('legacy-diag-clean-player'),
    ['legacy-diag-legit.exe'],
    'an already-clean row must be left untouched',
  );
  assert.deepEqual(
    processNamesOf('legacy-diag-no-membership'),
    ['legacy-diag-legit.exe'],
    'a player without a group_memberships row falls back to the default group allow-list, same as at request time',
  );
  assert.deepEqual(processNamesOf('legacy-diag-malformed'), [], 'unreadable JSON is normalized to an empty array, not left broken');

  migrated.close();
  fs.rmSync(path.dirname(dbFile), { recursive: true, force: true });
});

test('migration 77 creates durable food-order reminder state and is restart-safe', () => {
  const dbFile = makeTempDbPath('food-order-reminder-state');
  runMigrations(dbFile);

  const fixture = new Database(dbFile);
  fixture.exec(`
    DROP TABLE food_order_payment_reminders;
    DELETE FROM schema_migrations WHERE version = 77;
  `);
  fixture.close();

  assert.doesNotThrow(() => runMigrations(dbFile));
  assert.doesNotThrow(() => runMigrations(dbFile), 'the reminder-state migration must be restart-safe');

  const migrated = new Database(dbFile, { readonly: true });
  assert.ok(
    migrated
      .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'food_order_payment_reminders'")
      .get(),
  );
  assert.ok(migrated.prepare('SELECT 1 FROM schema_migrations WHERE version = 77').get());
  migrated.close();
  fs.rmSync(path.dirname(dbFile), { recursive: true, force: true });
});

test('migration 79 preserves event payment data and is restart-safe', () => {
  const dbFile = makeTempDbPath('event-payment-columns');
  runMigrations(dbFile);

  const fixture = new Database(dbFile);
  const now = Date.now();
  fixture
    .prepare(
      `INSERT INTO players (id, name, color, api_key, created_at)
       VALUES ('event-payment-creator', 'Event Payment Creator', '#4f9dff', 'event-payment-key', ?)`,
    )
    .run(now);
  fixture
    .prepare(
      `INSERT INTO events
         (id, name, starts_at, ends_at, group_id, status, visibility_scope, cost_cents, paypal_link, created_by)
       VALUES ('event-payment-event', 'Payment Event', ?, ?, 'default-group', 'published', 'participants', 2550,
               'https://paypal.me/creator', 'event-payment-creator')`,
    )
    .run(now, now + 60_000);
  fixture
    .prepare(
      `INSERT INTO group_memberships (group_id, player_id, role, status, joined_at)
       VALUES ('default-group', 'event-payment-creator', 'member', 'active', ?)`,
    )
    .run(now);
  fixture
    .prepare(
      `INSERT INTO event_participants (event_id, player_id, status, paid)
       VALUES ('event-payment-event', 'event-payment-creator', 'accepted', 1)`,
    )
    .run();
  fixture.prepare('DELETE FROM schema_migrations WHERE version = 79').run();
  fixture.close();

  assert.doesNotThrow(() => runMigrations(dbFile));
  assert.doesNotThrow(() => runMigrations(dbFile), 'the event payment migration must be restart-safe');

  const migrated = new Database(dbFile, { readonly: true });
  assert.deepEqual(
    migrated
      .prepare('SELECT cost_cents AS costCents, paypal_link AS paypalLink, created_by AS createdBy FROM events WHERE id = ?')
      .get('event-payment-event'),
    { costCents: 2550, paypalLink: 'https://paypal.me/creator', createdBy: 'event-payment-creator' },
  );
  assert.equal(
    (migrated
      .prepare('SELECT paid FROM event_participants WHERE event_id = ? AND player_id = ?')
      .get('event-payment-event', 'event-payment-creator') as { paid: number }).paid,
    1,
  );
  assert.ok(migrated.prepare('SELECT 1 FROM schema_migrations WHERE version = 79').get());
  migrated.close();
  fs.rmSync(path.dirname(dbFile), { recursive: true, force: true });
});

test('migration 80 creates durable event payment reminder state and is restart-safe', () => {
  const dbFile = makeTempDbPath('event-payment-reminders');
  runMigrations(dbFile);

  const fixture = new Database(dbFile);
  fixture.exec(`
    DROP TABLE event_payment_reminders;
    DELETE FROM schema_migrations WHERE version = 80;
  `);
  fixture.close();

  assert.doesNotThrow(() => runMigrations(dbFile));
  assert.doesNotThrow(() => runMigrations(dbFile), 'the event reminder-state migration must be restart-safe');

  const migrated = new Database(dbFile, { readonly: true });
  assert.ok(
    migrated
      .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'event_payment_reminders'")
      .get(),
  );
  assert.ok(migrated.prepare('SELECT 1 FROM schema_migrations WHERE version = 80').get());
  migrated.close();
  fs.rmSync(path.dirname(dbFile), { recursive: true, force: true });
});

test('migration 81 preserves event payment audit and due dates and is restart-safe', () => {
  const dbFile = makeTempDbPath('event-payment-audit');
  runMigrations(dbFile);

  const fixture = new Database(dbFile);
  const now = Date.now();
  fixture.exec(`
    INSERT INTO players (id, name, api_key, created_at)
      VALUES ('payment-audit-player', 'Payment Audit Player', 'payment-audit-key', ${now});
    INSERT INTO group_memberships (group_id, player_id, role, status, joined_at)
      VALUES ('default-group', 'payment-audit-player', 'member', 'active', ${now});
    INSERT INTO events
      (id, name, starts_at, ends_at, cost_cents, payment_due_at, created_by, group_id, status, visibility_scope)
      VALUES ('payment-audit-event', 'Payment Audit Event', ${now}, ${now + 60_000}, 2550, ${now + 30_000},
              'payment-audit-player', 'default-group', 'published', 'participants');
    INSERT INTO event_participants (event_id, player_id, status, paid, paid_by, paid_at)
      VALUES ('payment-audit-event', 'payment-audit-player', 'accepted', 1, 'payment-audit-player', ${now});
    DELETE FROM schema_migrations WHERE version = 81;
  `);
  fixture.close();

  assert.doesNotThrow(() => runMigrations(dbFile));
  assert.doesNotThrow(() => runMigrations(dbFile), 'the event payment audit migration must be restart-safe');

  const migrated = new Database(dbFile, { readonly: true });
  const eventColumns = migrated.prepare('PRAGMA table_info(events)').all() as Array<{ name: string }>;
  const participantColumns = migrated.prepare('PRAGMA table_info(event_participants)').all() as Array<{ name: string }>;
  assert.ok(eventColumns.some((column) => column.name === 'payment_due_at'));
  assert.ok(participantColumns.some((column) => column.name === 'paid_by'));
  assert.ok(participantColumns.some((column) => column.name === 'paid_at'));
  assert.deepEqual(
    migrated.prepare('SELECT payment_due_at AS paymentDueAt FROM events WHERE id = ?').get('payment-audit-event'),
    { paymentDueAt: now + 30_000 },
  );
  assert.deepEqual(
    migrated.prepare('SELECT paid, paid_by AS paidBy, paid_at AS paidAt FROM event_participants WHERE event_id = ?').get('payment-audit-event'),
    { paid: 1, paidBy: 'payment-audit-player', paidAt: now },
  );
  assert.ok(migrated.prepare('SELECT 1 FROM schema_migrations WHERE version = 81').get());
  migrated.close();
  fs.rmSync(path.dirname(dbFile), { recursive: true, force: true });
});

test('migration 82 adds accommodation accounting, leaves legacy paid amounts unknown and is restart-safe', () => {
  const dbFile = makeTempDbPath('event-accommodation-accounting');
  runMigrations(dbFile);

  const fixture = new Database(dbFile);
  const now = Date.now();
  fixture.exec(`
    INSERT INTO players (id, name, api_key, created_at)
      VALUES ('accommodation-player', 'Accommodation Player', 'accommodation-key', ${now});
    INSERT INTO group_memberships (group_id, player_id, role, status, joined_at)
      VALUES ('default-group', 'accommodation-player', 'member', 'active', ${now});
    INSERT INTO events
      (id, name, starts_at, ends_at, cost_cents, created_by, group_id, status, visibility_scope)
      VALUES ('accommodation-event', 'Accommodation Event', ${now}, ${now + 60_000}, 2550,
              'accommodation-player', 'default-group', 'published', 'participants');
    INSERT INTO event_participants (event_id, player_id, status, paid)
      VALUES ('accommodation-event', 'accommodation-player', 'accepted', 1);
    ALTER TABLE events DROP COLUMN accommodation_cost_cents;
    ALTER TABLE event_participants DROP COLUMN paid_amount_cents;
    DELETE FROM schema_migrations WHERE version = 82;
  `);
  fixture.close();

  assert.doesNotThrow(() => runMigrations(dbFile));

  const firstMigration = new Database(dbFile);
  assert.deepEqual(
    firstMigration
      .prepare('SELECT accommodation_cost_cents AS accommodationCostCents FROM events WHERE id = ?')
      .get('accommodation-event'),
    { accommodationCostCents: null },
  );
  assert.deepEqual(
    firstMigration
      .prepare('SELECT paid_amount_cents AS paidAmountCents FROM event_participants WHERE event_id = ?')
      .get('accommodation-event'),
    { paidAmountCents: null },
  );
  firstMigration.prepare('UPDATE events SET accommodation_cost_cents = 120000 WHERE id = ?').run('accommodation-event');
  firstMigration.prepare('DELETE FROM schema_migrations WHERE version = 82').run();
  firstMigration.close();

  assert.doesNotThrow(() => runMigrations(dbFile), 'the accommodation-accounting migration must be restart-safe');

  const migrated = new Database(dbFile, { readonly: true });
  assert.deepEqual(
    migrated
      .prepare('SELECT accommodation_cost_cents AS accommodationCostCents FROM events WHERE id = ?')
      .get('accommodation-event'),
    { accommodationCostCents: 120000 },
  );
  assert.deepEqual(
    migrated
      .prepare('SELECT paid_amount_cents AS paidAmountCents FROM event_participants WHERE event_id = ?')
      .get('accommodation-event'),
    { paidAmountCents: null },
  );
  assert.ok(migrated.prepare('SELECT 1 FROM schema_migrations WHERE version = 82').get());
  migrated.close();
  fs.rmSync(path.dirname(dbFile), { recursive: true, force: true });
});

// Reverts a fully migrated events/event_participants pair back to their
// pre-83 shape: starts_at NOT NULL again, no schedule_revision/
// confirmed_schedule_revision, no poll tables. Mirrors the DROP+CREATE+
// copy-back rebuild migration 83 itself uses (see db.ts's addEventDatePolls),
// which is what keeps this legacy fixture faithful to what an actual
// pre-migration installation's schema looked like. better-sqlite3 defaults
// new connections to foreign_keys=ON, so — exactly like the real migration —
// this must disable it first: push_log's composite FK to events(group_id,
// id) is otherwise validated the moment the rebuilt events table is written
// to (the INSERT ... SELECT below), before this helper has even reached the
// statement that recreates that composite unique index, which SQLite reports
// as "foreign key mismatch" despite the finished schema being perfectly
// valid a few statements later.
function downgradeToPre83Shape(fixture: Database.Database): void {
  fixture.pragma('foreign_keys = OFF');
  fixture.exec(`
    CREATE TABLE events_legacy_stage AS SELECT * FROM events;
    DROP TABLE events;
    CREATE TABLE events (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      starts_at INTEGER NOT NULL,
      ends_at INTEGER,
      location TEXT,
      description TEXT,
      cost_cents INTEGER CHECK (cost_cents IS NULL OR cost_cents > 0),
      accommodation_cost_cents INTEGER CHECK (accommodation_cost_cents IS NULL OR accommodation_cost_cents > 0),
      paypal_link TEXT,
      payment_due_at INTEGER,
      created_by TEXT REFERENCES players(id) ON DELETE SET NULL,
      tracking_enabled INTEGER NOT NULL DEFAULT 0,
      ended_at INTEGER,
      is_test INTEGER NOT NULL DEFAULT 0,
      group_id TEXT REFERENCES groups(id) ON DELETE RESTRICT,
      status TEXT NOT NULL DEFAULT 'published' CHECK (status IN ('draft', 'published', 'cancelled', 'ended')),
      visibility_scope TEXT NOT NULL DEFAULT 'participants' CHECK (visibility_scope IN ('group', 'participants', 'public'))
    );
    INSERT INTO events
      (id, name, starts_at, ends_at, location, description, cost_cents, accommodation_cost_cents,
       paypal_link, payment_due_at, created_by, tracking_enabled, ended_at, is_test, group_id, status, visibility_scope)
    SELECT id, name, starts_at, ends_at, location, description, cost_cents, accommodation_cost_cents,
           paypal_link, payment_due_at, created_by, tracking_enabled, ended_at, is_test, group_id, status, visibility_scope
    FROM events_legacy_stage;
    DROP TABLE events_legacy_stage;
    CREATE INDEX IF NOT EXISTS idx_events_group_start ON events(group_id, starts_at DESC);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_events_group_pk ON events(group_id, id);

    DROP TRIGGER IF EXISTS trg_event_participants_confirm_revision_insert;
    DROP TRIGGER IF EXISTS trg_event_participants_confirm_revision_update;
    ALTER TABLE event_participants DROP COLUMN confirmed_schedule_revision;

    DROP TABLE IF EXISTS event_date_poll_responses;
    DROP TABLE IF EXISTS event_date_poll_invitees;
    DROP TABLE IF EXISTS event_date_poll_options;
    DROP TABLE IF EXISTS event_date_polls;

    DELETE FROM schema_migrations WHERE version = 83;
  `);
  assert.deepEqual(fixture.pragma('foreign_key_check'), [], 'the downgraded legacy fixture itself must stay referentially consistent');
  fixture.pragma('foreign_keys = ON');
}

test('migration 83 makes starts_at nullable for drafts, adds schedule revisions, and creates the date poll tables', () => {
  const dbFile = makeTempDbPath('event-date-polls');
  runMigrations(dbFile);

  const fixture = new Database(dbFile);
  const now = Date.now();
  fixture.exec(`
    INSERT INTO players (id, name, api_key, created_at) VALUES ('poll-legacy-creator', 'Legacy Creator', 'poll-legacy-creator-key', ${now});
    INSERT INTO players (id, name, api_key, created_at) VALUES ('poll-legacy-accepted', 'Legacy Accepted', 'poll-legacy-accepted-key', ${now});
    INSERT INTO players (id, name, api_key, created_at) VALUES ('poll-legacy-declined', 'Legacy Declined', 'poll-legacy-declined-key', ${now});
    INSERT INTO players (id, name, api_key, created_at) VALUES ('poll-legacy-invited', 'Legacy Invited', 'poll-legacy-invited-key', ${now});
    INSERT INTO group_memberships (group_id, player_id, role, status, joined_at)
      VALUES ('default-group', 'poll-legacy-creator', 'member', 'active', ${now});
    INSERT INTO events (id, name, starts_at, ends_at, created_by, group_id, status, visibility_scope)
      VALUES ('poll-legacy-event', 'Legacy Dated Event', ${now}, ${now + 60_000}, 'poll-legacy-creator', 'default-group', 'published', 'participants');
    INSERT INTO event_participants (event_id, player_id, status) VALUES ('poll-legacy-event', 'poll-legacy-accepted', 'accepted');
    INSERT INTO event_participants (event_id, player_id, status) VALUES ('poll-legacy-event', 'poll-legacy-declined', 'declined');
    INSERT INTO event_participants (event_id, player_id, status) VALUES ('poll-legacy-event', 'poll-legacy-invited', 'invited');
  `);
  downgradeToPre83Shape(fixture);
  // The legacy schema must genuinely still reject what migration 83 is about
  // to relax, so this fixture is proven pre-migration rather than merely
  // missing a version marker.
  assert.throws(
    () =>
      fixture
        .prepare("INSERT INTO events (id, name, starts_at, group_id, status, visibility_scope) VALUES ('should-fail', 'x', NULL, 'default-group', 'draft', 'participants')")
        .run(),
    /NOT NULL constraint failed/,
  );
  fixture.close();

  assert.doesNotThrow(() => runMigrations(dbFile));
  assert.doesNotThrow(() => runMigrations(dbFile), 'a second start must skip the already-recorded migration');

  const migrated = new Database(dbFile);
  const event = migrated.prepare('SELECT starts_at, schedule_revision FROM events WHERE id = ?').get('poll-legacy-event') as {
    starts_at: number;
    schedule_revision: number;
  };
  assert.equal(event.starts_at, now, 'existing dated event keeps its exact starts_at');
  assert.equal(event.schedule_revision, 1, 'a pre-existing dated event is backfilled to revision 1');

  const participants = migrated
    .prepare('SELECT player_id AS playerId, status, confirmed_schedule_revision AS confirmedRevision FROM event_participants WHERE event_id = ? ORDER BY player_id')
    .all('poll-legacy-event') as Array<{ playerId: string; status: string; confirmedRevision: number | null }>;
  const byId = new Map(participants.map((p) => [p.playerId, p]));
  assert.equal(byId.get('poll-legacy-accepted')?.confirmedRevision, 1, 'accepted rows are backfilled to revision 1');
  assert.equal(byId.get('poll-legacy-declined')?.confirmedRevision, 1, 'declined rows are backfilled to revision 1');
  assert.equal(byId.get('poll-legacy-invited')?.confirmedRevision, null, 'a still-open invitation stays unconfirmed');

  // A draft planning event is now representable at the schema level.
  assert.doesNotThrow(() =>
    migrated
      .prepare(
        "INSERT INTO events (id, name, starts_at, group_id, status, visibility_scope, schedule_revision) VALUES ('poll-legacy-draft', 'Draft', NULL, 'default-group', 'draft', 'participants', 0)",
      )
      .run(),
  );
  assert.throws(
    () =>
      migrated
        .prepare(
          "INSERT INTO events (id, name, starts_at, group_id, status, visibility_scope, schedule_revision) VALUES ('poll-legacy-bad', 'Bad', NULL, 'default-group', 'published', 'participants', 0)",
        )
        .run(),
    /CHECK constraint failed/,
    'a non-draft event still requires a date',
  );

  // Cascades: a poll's options/invitees/responses are removed once its event
  // (or, one level down, its round/option/invitee) is deleted.
  const pollNow = Date.now();
  migrated
    .prepare(
      `INSERT INTO event_date_polls (id, event_id, round_number, response_due_at, status, created_at, updated_at)
       VALUES ('poll-legacy-round', 'poll-legacy-draft', 1, ?, 'open', ?, ?)`,
    )
    .run(pollNow + 1000, pollNow, pollNow);
  migrated
    .prepare(
      `INSERT INTO event_date_poll_options (id, poll_id, starts_on, ends_on, position) VALUES ('poll-legacy-option', 'poll-legacy-round', '2027-01-01', '2027-01-03', 0)`,
    )
    .run();
  migrated
    .prepare(
      `INSERT INTO event_date_poll_invitees (poll_id, player_id, invited_at) VALUES ('poll-legacy-round', 'poll-legacy-accepted', ?)`,
    )
    .run(pollNow);
  migrated
    .prepare(
      `INSERT INTO event_date_poll_responses (poll_id, option_id, player_id, response, updated_at)
       VALUES ('poll-legacy-round', 'poll-legacy-option', 'poll-legacy-accepted', 'can', ?)`,
    )
    .run(pollNow);
  migrated.prepare('DELETE FROM events WHERE id = ?').run('poll-legacy-draft');
  assert.equal((migrated.prepare('SELECT COUNT(*) AS n FROM event_date_polls WHERE id = ?').get('poll-legacy-round') as { n: number }).n, 0);
  assert.equal((migrated.prepare('SELECT COUNT(*) AS n FROM event_date_poll_options WHERE id = ?').get('poll-legacy-option') as { n: number }).n, 0);
  assert.equal(
    (migrated.prepare("SELECT COUNT(*) AS n FROM event_date_poll_invitees WHERE poll_id = 'poll-legacy-round'").get() as { n: number }).n,
    0,
  );
  assert.equal(
    (migrated.prepare("SELECT COUNT(*) AS n FROM event_date_poll_responses WHERE poll_id = 'poll-legacy-round'").get() as { n: number }).n,
    0,
    'cascading from events all the way down to responses',
  );

  assert.deepEqual(migrated.pragma('foreign_key_check'), []);
  migrated.close();
  fs.rmSync(path.dirname(dbFile), { recursive: true, force: true });
});

test('migration 83 rolls back completely if it fails partway through, and is retryable afterward', () => {
  const dbFile = makeTempDbPath('event-date-polls-rollback');
  runMigrations(dbFile);

  const fixture = new Database(dbFile);
  const now = Date.now();
  fixture.exec(`
    INSERT INTO players (id, name, api_key, created_at) VALUES ('poll-rollback-player', 'Rollback Player', 'poll-rollback-player-key', ${now});
    INSERT INTO events (id, name, starts_at, ends_at, group_id, status, visibility_scope)
      VALUES ('poll-rollback-event', 'Rollback Event', ${now}, ${now + 60_000}, 'default-group', 'published', 'participants');
    INSERT INTO event_participants (event_id, player_id, status) VALUES ('poll-rollback-event', 'poll-rollback-player', 'accepted');
  `);
  downgradeToPre83Shape(fixture);
  // Forces the migration's very first statement (staging the pre-rebuild
  // events rows) to fail: CREATE TABLE events_staging_83 AS SELECT ... hits a
  // name collision, so nothing about the rebuild — or anything later in the
  // same migration body, since it's one transaction — ever runs.
  fixture.exec('CREATE TABLE events_staging_83 (blocking INTEGER)');
  fixture.close();

  assert.throws(() => runMigrations(dbFile), /events_staging_83/);

  const afterFailure = new Database(dbFile);
  assert.equal(
    afterFailure.prepare('SELECT 1 FROM schema_migrations WHERE version = 83').get(),
    undefined,
    'the failed migration must not be recorded as applied',
  );
  const columns = afterFailure.prepare('PRAGMA table_info(events)').all() as Array<{ name: string }>;
  assert.equal(
    columns.some((c) => c.name === 'schedule_revision'),
    false,
    'the events table must still be in its pre-migration shape after a rolled-back attempt',
  );
  assert.equal(
    afterFailure.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'event_date_polls'").get(),
    undefined,
    'no poll table may exist after a rolled-back migration',
  );
  assert.deepEqual(
    afterFailure.prepare('SELECT starts_at FROM events WHERE id = ?').get('poll-rollback-event'),
    { starts_at: now },
    'pre-existing data survives the rollback untouched',
  );
  afterFailure.close();

  // Clear the blocker and retry — the migration must succeed cleanly now.
  const retry = new Database(dbFile);
  retry.exec('DROP TABLE events_staging_83');
  retry.close();
  assert.doesNotThrow(() => runMigrations(dbFile), 'after removing the blocker, the migration must succeed');

  const migrated = new Database(dbFile, { readonly: true });
  assert.ok(migrated.prepare('SELECT 1 FROM schema_migrations WHERE version = 83').get());
  assert.deepEqual(
    migrated.prepare('SELECT starts_at, schedule_revision FROM events WHERE id = ?').get('poll-rollback-event'),
    { starts_at: now, schedule_revision: 1 },
  );
  migrated.close();
  fs.rmSync(path.dirname(dbFile), { recursive: true, force: true });
});

test('migration 83 rolls back completely if it leaves a dangling foreign key, and is retryable afterward', () => {
  // The rollback test above only forces the very first statement of up() to
  // fail, so it never exercises the post-check that catches a foreign key
  // left dangling by the rebuild itself. This one instead lets up() run to
  // completion untouched, but pre-seeds a row that up() never revisits, so
  // `PRAGMA foreign_key_check` finds a violation once the rebuild is done —
  // proving that check still rolls the whole migration back (including the
  // schema_migrations insert) instead of leaving it recorded as applied.
  const dbFile = makeTempDbPath('event-date-polls-fk-violation');
  runMigrations(dbFile);

  const fixture = new Database(dbFile);
  const now = Date.now();
  fixture.exec(`
    INSERT INTO players (id, name, api_key, created_at) VALUES ('poll-fk-player', 'FK Player', 'poll-fk-player-key', ${now});
  `);
  // downgradeToPre83Shape asserts the fixture it produces is itself
  // referentially clean, so the dangling row is seeded afterward instead.
  downgradeToPre83Shape(fixture);
  fixture.pragma('foreign_keys = OFF');
  fixture.exec(
    `INSERT INTO event_participants (event_id, player_id, status) VALUES ('poll-fk-ghost-event', 'poll-fk-player', 'accepted')`,
  );
  // This dangling row references an event id that never exists in either
  // shape, so it survives migration 83's own rebuild of `events` untouched
  // and is still dangling once that rebuild finishes.
  assert.deepEqual(
    fixture.prepare('SELECT event_id AS eventId FROM event_participants WHERE player_id = ?').all('poll-fk-player'),
    [{ eventId: 'poll-fk-ghost-event' }],
  );
  fixture.close();

  assert.throws(() => runMigrations(dbFile), /dangling foreign keys/);

  const afterFailure = new Database(dbFile);
  assert.equal(
    afterFailure.prepare('SELECT 1 FROM schema_migrations WHERE version = 83').get(),
    undefined,
    'a migration that leaves a dangling foreign key must not be recorded as applied',
  );
  const columns = afterFailure.prepare('PRAGMA table_info(events)').all() as Array<{ name: string }>;
  assert.equal(
    columns.some((c) => c.name === 'schedule_revision'),
    false,
    'the events table must still be in its pre-migration shape after the rolled-back attempt',
  );
  assert.equal(
    afterFailure.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'event_date_polls'").get(),
    undefined,
    'no poll table may exist after a rolled-back migration',
  );
  assert.deepEqual(
    afterFailure.prepare('SELECT event_id AS eventId FROM event_participants WHERE player_id = ?').all('poll-fk-player'),
    [{ eventId: 'poll-fk-ghost-event' }],
    'the pre-existing dangling row itself is untouched by the rollback',
  );
  afterFailure.close();

  // Clear the dangling rows and retry — the migration must succeed cleanly
  // now. event_participation_history also needs clearing: the insert above
  // fired the existing accepted-participation trigger, and that history
  // table is append-only rather than kept in sync by a cascade.
  const retry = new Database(dbFile);
  retry.pragma('foreign_keys = OFF');
  retry.exec(`
    DELETE FROM event_participants WHERE event_id = 'poll-fk-ghost-event';
    DELETE FROM event_participation_history WHERE event_id = 'poll-fk-ghost-event';
  `);
  assert.deepEqual(retry.pragma('foreign_key_check'), []);
  retry.close();
  assert.doesNotThrow(() => runMigrations(dbFile), 'after removing the dangling row, the migration must succeed');

  const migrated = new Database(dbFile, { readonly: true });
  assert.ok(migrated.prepare('SELECT 1 FROM schema_migrations WHERE version = 83').get());
  assert.deepEqual(migrated.pragma('foreign_key_check'), []);
  migrated.close();
  fs.rmSync(path.dirname(dbFile), { recursive: true, force: true });
});

test('migration 85 restores accepted-only participation and enables independent round numbering', () => {
  const dbFile = makeTempDbPath('generic-event-polls');
  runMigrations(dbFile);

  const fixture = new Database(dbFile);
  fixture.pragma('foreign_keys = OFF');
  const participantTriggers = fixture
    .prepare("SELECT sql FROM sqlite_master WHERE type = 'trigger' AND tbl_name = 'event_participants'")
    .all() as Array<{ sql: string }>;
  fixture.exec(`
    CREATE TABLE event_participants_before_85 AS SELECT * FROM event_participants;
    DROP TABLE event_participants;
    CREATE TABLE event_participants (
      event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
      player_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'accepted'
             CHECK (status IN ('invited', 'interested', 'accepted', 'declined')),
      paid INTEGER NOT NULL DEFAULT 0 CHECK (paid IN (0, 1)),
      paid_by TEXT REFERENCES players(id) ON DELETE SET NULL,
      paid_at INTEGER,
      paid_amount_cents INTEGER CHECK (paid_amount_cents IS NULL OR paid_amount_cents > 0),
      confirmed_schedule_revision INTEGER,
      PRIMARY KEY (event_id, player_id)
    );
    INSERT INTO event_participants SELECT * FROM event_participants_before_85;
    DROP TABLE event_participants_before_85;
    INSERT INTO players (id, name, api_key, created_at)
      VALUES ('migration-85-interested', 'Migration 85 Interested', 'migration-85-key', 1);
    INSERT INTO event_participants (event_id, player_id, status)
      VALUES ('instance-base-event', 'migration-85-interested', 'interested');
    DELETE FROM schema_migrations WHERE version = 85;
  `);
  for (const trigger of participantTriggers) fixture.exec(trigger.sql);
  fixture.close();

  runMigrations(dbFile);
  runMigrations(dbFile);

  const migrated = new Database(dbFile);
  assert.equal(
    (migrated.prepare('SELECT status FROM event_participants WHERE player_id = ?').get('migration-85-interested') as { status: string }).status,
    'invited',
  );
  assert.throws(
    () => migrated.prepare("UPDATE event_participants SET status = 'interested' WHERE player_id = ?").run('migration-85-interested'),
    /CHECK constraint failed/,
  );
  const pollColumns = migrated.prepare('PRAGMA table_info(event_date_polls)').all() as Array<{ name: string }>;
  assert.ok(pollColumns.some((column) => column.name === 'max_selections'));
  const pollSql = (migrated
    .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'event_date_polls'")
    .get() as { sql: string }).sql;
  assert.match(pollSql, /UNIQUE\s*\(event_id,\s*decision_key,\s*round_number\)/i);
  assert.deepEqual(migrated.pragma('foreign_key_check'), []);
  migrated.close();
  fs.rmSync(path.dirname(dbFile), { recursive: true, force: true });
});

test('migrations 86 through 88 preserve poll history and allow a new round after close', () => {
  const dbFile = makeTempDbPath('event-poll-ratings');
  runMigrations(dbFile);

  const fixture = new Database(dbFile);
  fixture.pragma('foreign_keys = OFF');
  fixture.exec(`
    CREATE TABLE event_date_polls_before_86 AS
      SELECT id, event_id, round_number, note, created_by, response_due_at, status, selected_option_id,
             created_at, updated_at, topic, decision_key, title, response_mode, decision_note, max_selections
      FROM event_date_polls;
    DROP TABLE event_date_polls;
    CREATE TABLE event_date_polls (
      id TEXT PRIMARY KEY,
      event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
      round_number INTEGER NOT NULL,
      note TEXT,
      created_by TEXT REFERENCES players(id) ON DELETE SET NULL,
      response_due_at INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'open'
             CHECK (status IN ('open', 'closed', 'scheduled', 'superseded', 'cancelled')),
      selected_option_id TEXT REFERENCES event_date_poll_options(id) ON DELETE SET NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      topic TEXT NOT NULL DEFAULT 'custom'
            CHECK (topic IN ('date_range', 'location', 'duration', 'budget', 'custom')),
      decision_key TEXT NOT NULL,
      title TEXT NOT NULL,
      response_mode TEXT NOT NULL DEFAULT 'feasibility'
                    CHECK (response_mode IN ('feasibility', 'single_choice', 'multiple_choice')),
      decision_note TEXT,
      max_selections INTEGER CHECK (max_selections IS NULL OR max_selections >= 1),
      UNIQUE (event_id, decision_key, round_number)
    );
    INSERT INTO event_date_polls SELECT * FROM event_date_polls_before_86;
    DROP TABLE event_date_polls_before_86;
    CREATE UNIQUE INDEX idx_event_polls_undecided
      ON event_date_polls(event_id, decision_key) WHERE status IN ('open', 'closed');
    CREATE UNIQUE INDEX idx_event_polls_decided
      ON event_date_polls(event_id, decision_key) WHERE status = 'scheduled';
    CREATE INDEX idx_event_date_polls_event
      ON event_date_polls(event_id, decision_key, round_number);

    CREATE TABLE event_date_poll_responses_before_86 AS SELECT * FROM event_date_poll_responses;
    DROP TABLE event_date_poll_responses;
    CREATE TABLE event_date_poll_responses (
      poll_id TEXT NOT NULL,
      option_id TEXT NOT NULL,
      player_id TEXT NOT NULL,
      response TEXT NOT NULL CHECK (response IN ('can', 'if_needed', 'cannot')),
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (poll_id, option_id, player_id),
      FOREIGN KEY (poll_id, option_id) REFERENCES event_date_poll_options(poll_id, id) ON DELETE CASCADE,
      FOREIGN KEY (poll_id, player_id) REFERENCES event_date_poll_invitees(poll_id, player_id) ON DELETE CASCADE
    );
    INSERT INTO event_date_poll_responses SELECT * FROM event_date_poll_responses_before_86;
    DROP TABLE event_date_poll_responses_before_86;
    CREATE INDEX idx_event_date_poll_responses_option ON event_date_poll_responses(option_id);

    INSERT INTO players (id, name, api_key, created_at)
      VALUES ('migration-86-player', 'Migration 86 Player', 'migration-86-key', 1);
    INSERT INTO event_date_polls
      (id, event_id, round_number, response_due_at, status, created_at, updated_at,
       topic, decision_key, title, response_mode)
      VALUES ('migration-86-poll', 'instance-base-event', 1, 9999999999999, 'open', 1, 1,
              'custom', 'migration-86', 'Migration 86 Poll', 'feasibility');
    INSERT INTO event_date_poll_options
      (id, poll_id, starts_on, ends_on, position, label, payload_json)
      VALUES ('migration-86-option', 'migration-86-poll', '0001-01-01', '0001-01-01', 0, 'Option', '{}');
    INSERT INTO event_date_poll_invitees (poll_id, player_id, invited_at)
      VALUES ('migration-86-poll', 'migration-86-player', 1);
    INSERT INTO event_date_poll_responses (poll_id, option_id, player_id, response, updated_at)
      VALUES ('migration-86-poll', 'migration-86-option', 'migration-86-player', 'can', 1);
    DELETE FROM schema_migrations WHERE version IN (86, 87, 88);
  `);
  fixture.close();

  runMigrations(dbFile);
  runMigrations(dbFile);

  const migrated = new Database(dbFile);
  assert.equal(
    (migrated.prepare('SELECT response FROM event_date_poll_responses WHERE poll_id = ?').get('migration-86-poll') as { response: string }).response,
    'can',
  );
  migrated.prepare("UPDATE event_date_polls SET response_mode = 'rating_1_5' WHERE id = ?").run('migration-86-poll');
  migrated
    .prepare("UPDATE event_date_poll_responses SET response = '5' WHERE poll_id = ?")
    .run('migration-86-poll');
  assert.equal(
    (migrated.prepare('SELECT response FROM event_date_poll_responses WHERE poll_id = ?').get('migration-86-poll') as { response: string }).response,
    '5',
  );
  assert.equal(
    (migrated.prepare('SELECT is_anonymous AS anonymous FROM event_date_polls WHERE id = ?').get('migration-86-poll') as { anonymous: number }).anonymous,
    0,
    'existing polls remain non-anonymous by default',
  );
  migrated.prepare('UPDATE event_date_polls SET is_anonymous = 1 WHERE id = ?').run('migration-86-poll');
  assert.throws(
    () => migrated.prepare('UPDATE event_date_polls SET is_anonymous = 2 WHERE id = ?').run('migration-86-poll'),
    /CHECK constraint failed/,
  );
  const openIndexSql = (migrated
    .prepare("SELECT sql FROM sqlite_master WHERE type = 'index' AND name = 'idx_event_polls_undecided'")
    .get() as { sql: string }).sql;
  assert.match(openIndexSql, /WHERE status = 'open'\s*$/i);
  assert.doesNotMatch(openIndexSql, /closed/i);
  migrated.prepare("UPDATE event_date_polls SET status = 'closed' WHERE id = ?").run('migration-86-poll');
  migrated.prepare(
    `INSERT INTO event_date_polls
       (id, event_id, round_number, response_due_at, status, created_at, updated_at,
        topic, decision_key, title, response_mode, is_anonymous)
     VALUES ('migration-88-round-2', 'instance-base-event', 2, 9999999999999, 'open', 2, 2,
             'custom', 'migration-86', 'Migration 88 Round 2', 'feasibility', 0)`,
  ).run();
  assert.throws(
    () => migrated.prepare(
      `INSERT INTO event_date_polls
         (id, event_id, round_number, response_due_at, status, created_at, updated_at,
          topic, decision_key, title, response_mode, is_anonymous)
       VALUES ('migration-88-round-3', 'instance-base-event', 3, 9999999999999, 'open', 3, 3,
               'custom', 'migration-86', 'Migration 88 Round 3', 'feasibility', 0)`,
    ).run(),
    /UNIQUE constraint failed/,
  );
  assert.deepEqual(migrated.pragma('foreign_key_check'), []);
  migrated.close();
  fs.rmSync(path.dirname(dbFile), { recursive: true, force: true });
});
