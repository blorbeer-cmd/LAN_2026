import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { nanoid } from 'nanoid';
import { BASE_EVENT_ID, DEFAULT_GROUP_ID, db } from './db';
import { bookBettingMarket } from './bettingAccounting';
import {
  readPointsBalances,
  readPointsSource,
  readPointsJournal,
  recordPointsEntitlements,
  PointsJournalConflict,
  type PointsEntitlement,
} from './pointsJournal';

function participant(status = 'accepted'): string {
  const id = nanoid();
  db.prepare('INSERT INTO players(id, name, api_key, created_at) VALUES (?, ?, ?, ?)').run(
    id,
    id,
    nanoid(),
    Date.now(),
  );
  db.prepare('INSERT INTO event_participants(event_id, player_id, status) VALUES (?, ?, ?)').run(
    BASE_EVENT_ID,
    id,
    status,
  );
  return id;
}

function entitlement(playerId: string, extra: Partial<PointsEntitlement> = {}): PointsEntitlement {
  return {
    groupId: DEFAULT_GROUP_ID,
    eventId: BASE_EVENT_ID,
    playerId,
    account: 'orga',
    sourceKey: 'todo:example',
    title: 'To-do erledigt',
    total: 5,
    expectedRevision: 0,
    ...extra,
  };
}

test('accepting participation creates four empty accounts and preserves them across leaving and rejoining', () => {
  const playerId = participant('invited');
  assert.equal(readPointsBalances(DEFAULT_GROUP_ID, BASE_EVENT_ID, playerId), undefined);
  db.prepare("UPDATE event_participants SET status = 'accepted' WHERE player_id = ?").run(playerId);
  assert.deepEqual(readPointsBalances(DEFAULT_GROUP_ID, BASE_EVENT_ID, playerId), {
    betting: 0,
    orga: 0,
    playing: 0,
    wallet: 0,
  });
  recordPointsEntitlements([entitlement(playerId)]);
  db.prepare('DELETE FROM event_participants WHERE player_id = ?').run(playerId);
  db.prepare("INSERT INTO event_participants(event_id, player_id, status) VALUES (?, ?, 'accepted')").run(
    BASE_EVENT_ID,
    playerId,
  );
  assert.deepEqual(readPointsBalances(DEFAULT_GROUP_ID, BASE_EVENT_ID, playerId), {
    betting: 0,
    orga: 5,
    playing: 0,
    wallet: 0,
  });
  assert.equal(readPointsBalances('wrong-group', BASE_EVENT_ID, playerId), undefined);
  assert.throws(
    () => recordPointsEntitlements([entitlement(playerId, { groupId: 'wrong-group' })]),
    /account not found/,
  );
  db.prepare(
    `INSERT INTO event_participants(event_id,player_id,status) VALUES (?, ?, 'accepted')
    ON CONFLICT(event_id,player_id) DO UPDATE SET status = excluded.status`,
  ).run(BASE_EVENT_ID, playerId);
  assert.equal(readPointsBalances(DEFAULT_GROUP_ID, BASE_EVENT_ID, playerId)!.orga, 5);
  const eventId = nanoid();
  db.prepare(
    "INSERT INTO events(id,name,starts_at,group_id,status) VALUES (?, 'Other points event', 1, ?, 'published')",
  ).run(eventId, DEFAULT_GROUP_ID);
  db.prepare("INSERT INTO event_participants(event_id,player_id,status) VALUES (?, ?, 'accepted')").run(
    eventId,
    playerId,
  );
  recordPointsEntitlements([entitlement(playerId, { eventId, total: 2 })]);
  assert.equal(readPointsBalances(DEFAULT_GROUP_ID, eventId, playerId)!.orga, 2);
  db.prepare('DELETE FROM events WHERE id = ?').run(eventId);
  assert.equal(readPointsBalances(DEFAULT_GROUP_ID, eventId, playerId), undefined);
  assert.equal(readPointsBalances(DEFAULT_GROUP_ID, BASE_EVENT_ID, playerId)!.orga, 5);
});

test('entitlements deduplicate, correct by difference and restore without losing immutable history', () => {
  const change = entitlement(participant());
  const first = recordPointsEntitlements([change])[0];
  assert.equal(first.changed, true);
  assert.equal(recordPointsEntitlements([change])[0].changed, false);
  assert.throws(() => recordPointsEntitlements([{ ...change, total: 3 }]), PointsJournalConflict);
  assert.throws(() => recordPointsEntitlements([{ ...change, total: 3, expectedRevision: 1 }]), /require a reason/);
  recordPointsEntitlements([{ ...change, total: 0, expectedRevision: 1, reason: 'To-do wieder geöffnet' }]);
  recordPointsEntitlements([{ ...change, expectedRevision: 2, reason: 'To-do erneut erledigt' }]);
  assert.deepEqual(readPointsSource(change), { revision: 3, total: 5 });
  const visibleHistory = readPointsJournal(DEFAULT_GROUP_ID, BASE_EVENT_ID, change.playerId);
  assert.deepEqual(
    visibleHistory.map((entry) => entry.amount),
    [5, -5, 5],
  );
  assert.ok(visibleHistory.every((entry) => entry.sourceKey === change.sourceKey && Number.isInteger(entry.createdAt)));
  assert.deepEqual(readPointsJournal('wrong-group', BASE_EVENT_ID, change.playerId), []);
  const history = db
    .prepare(
      `SELECT j.revision, j.amount, j.title, j.reason FROM points_journal j
    JOIN points_sources s ON s.id = j.source_id WHERE s.player_id = ? ORDER BY j.revision`,
    )
    .all(change.playerId);
  assert.deepEqual(history, [
    { revision: 1, amount: 5, title: change.title, reason: null },
    { revision: 2, amount: -5, title: change.title, reason: 'To-do wieder geöffnet' },
    { revision: 3, amount: 5, title: change.title, reason: 'To-do erneut erledigt' },
  ]);
  assert.throws(
    () => db.prepare('UPDATE points_journal SET amount = 100 WHERE id = ?').run(first.entryId),
    /immutable/,
  );
  assert.throws(() => db.prepare('DELETE FROM points_journal WHERE id = ?').run(first.entryId), /immutable/);
  assert.throws(() => db.prepare('DELETE FROM points_sources WHERE player_id = ?').run(change.playerId), /immutable/);
});

test('wallet and three category totals stay separate; negative corrections and atomic batches are supported', () => {
  const playerId = participant();
  const base = entitlement(playerId);
  recordPointsEntitlements([
    { ...base, account: 'wallet', sourceKey: 'start', total: 100 },
    { ...base, account: 'orga', total: 5 },
    { ...base, account: 'playing', sourceKey: 'match:one', total: 4 },
    { ...base, account: 'wallet', sourceKey: 'market:one', total: -20 },
    { ...base, account: 'betting', sourceKey: 'market:one', total: 0 },
  ]);
  assert.deepEqual(readPointsBalances(DEFAULT_GROUP_ID, BASE_EVENT_ID, playerId), {
    wallet: 80,
    orga: 5,
    playing: 4,
    betting: 0,
  });
  assert.throws(
    () =>
      recordPointsEntitlements([
        {
          ...base,
          account: 'wallet',
          sourceKey: 'market:one',
          total: -200,
          expectedRevision: 1,
          reason: 'Ergebnis korrigiert',
        },
        { ...base, total: 2, expectedRevision: 999, reason: 'Veralteter Stand' },
      ]),
    PointsJournalConflict,
  );
  assert.equal(readPointsBalances(DEFAULT_GROUP_ID, BASE_EVENT_ID, playerId)!.wallet, 80);
  recordPointsEntitlements([
    {
      ...base,
      account: 'wallet',
      sourceKey: 'market:one',
      total: -200,
      expectedRevision: 1,
      reason: 'Ergebnis korrigiert',
    },
    { ...base, account: 'betting', sourceKey: 'market:one', total: -200 },
  ]);
  assert.deepEqual(readPointsBalances(DEFAULT_GROUP_ID, BASE_EVENT_ID, playerId), {
    wallet: -100,
    orga: 5,
    playing: 4,
    betting: -200,
  });
  for (const total of [0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => recordPointsEntitlements([{ ...base, sourceKey: 'invalid', total }]), RangeError);
  }
  assert.equal(readPointsSource({ ...base, sourceKey: 'invalid' })!.revision, 0);
});

test('market accounting reserves, withdraws, settles and voids paired journal claims atomically', () => {
  const eventId = nanoid();
  db.prepare(`INSERT INTO events(id,name,starts_at,group_id,status,event_type_key)
    VALUES (?,'Wallet accounting',1,?,'published','lan')`).run(eventId, DEFAULT_GROUP_ID);
  const players = [participant(), participant()];
  for (const playerId of players) {
    db.prepare("INSERT INTO event_participants(event_id,player_id,status) VALUES (?,?,'accepted')").run(eventId, playerId);
    recordPointsEntitlements([entitlement(playerId, { eventId, account: 'wallet', sourceKey: 'start', total: 100 })]);
  }
  const roundId = nanoid();
  db.prepare(`INSERT INTO betting_rounds(id,group_id,event_id,source_type,source_id,title,outcomes,status,closes_at,created_at)
    VALUES (?,?,?,'draw',?,'Test market','[]','open',9999999999999,1)`).run(roundId, DEFAULT_GROUP_ID, eventId, nanoid());
  const tipIds = [nanoid(), nanoid()];
  players.forEach((playerId, index) => db.prepare(`INSERT INTO betting_tips
    (id,round_id,player_id,outcome_id,stake,day,created_at,updated_at) VALUES (?,?,?,?,5,'2026-11-01',1,1)`)
    .run(tipIds[index], roundId, playerId, String(index)));
  const book = () => bookBettingMarket(DEFAULT_GROUP_ID, eventId, roundId, 'Markt neu berechnet');
  const balances = () => players.map((id) => readPointsBalances(DEFAULT_GROUP_ID, eventId, id)!);
  book();
  assert.deepEqual(balances().map(({ wallet, betting }) => [wallet, betting]), [[95, 0], [95, 0]]);
  const entries = () => db.prepare(`SELECT j.* FROM points_journal j JOIN points_sources s ON s.id=j.source_id
    WHERE s.event_id=? ORDER BY j.rowid`).all(eventId);
  const first = entries();
  book();
  assert.deepEqual(entries(), first, 'identical reconciliation does not pay twice');
  db.prepare('DELETE FROM betting_tips WHERE id=?').run(tipIds[0]);
  book();
  assert.equal(balances()[0].wallet, 100, 'withdrawal releases the persisted reservation');
  db.prepare(`INSERT INTO betting_tips(id,round_id,player_id,outcome_id,stake,day,created_at,updated_at)
    VALUES (?,?,?,'0',5,'2026-11-01',1,1)`).run(tipIds[0], roundId, players[0]);
  db.prepare("UPDATE betting_rounds SET status='settled' WHERE id=?").run(roundId);
  db.prepare('UPDATE betting_tips SET payout=CASE WHEN id=? THEN 10 ELSE 0 END WHERE round_id=?').run(tipIds[0], roundId);
  db.exec(`CREATE TEMP TRIGGER fail_market_net BEFORE INSERT ON points_journal
    WHEN (SELECT account FROM points_sources WHERE id=NEW.source_id)='betting'
    BEGIN SELECT RAISE(ABORT,'market journal failure'); END`);
  const before = entries();
  try {
    assert.throws(book, /market journal failure/);
    assert.deepEqual(entries(), before, 'a failure in the net leg rolls back the wallet leg for every player');
  } finally { db.exec('DROP TRIGGER fail_market_net'); }
  book();
  assert.deepEqual(balances().map(({ wallet, betting }) => [wallet, betting]), [[105, 5], [95, -5]]);
  db.prepare('UPDATE betting_tips SET payout=11 WHERE id=?').run(tipIds[0]);
  assert.throws(book, /Summe aller Einsätze/);
  assert.deepEqual(balances().map(({ wallet, betting }) => [wallet, betting]), [[105, 5], [95, -5]]);
  db.prepare('UPDATE betting_tips SET payout=CASE WHEN id=? THEN 0 ELSE 10 END WHERE round_id=?').run(tipIds[0], roundId);
  book();
  assert.deepEqual(balances().map(({ wallet, betting }) => [wallet, betting]), [[95, -5], [105, 5]]);
  db.prepare("UPDATE betting_rounds SET status='refunded' WHERE id=?").run(roundId);
  book();
  assert.deepEqual(balances().map(({ wallet, betting }) => [wallet, betting]), [[100, 0], [100, 0]]);
  db.prepare('UPDATE points_settings SET closed_at=1 WHERE event_id=?').run(eventId);
  assert.throws(book, /abgeschlossen/);
});

test(
  'independent concurrent writers cannot overwrite a different entitlement from the same source revision',
  { timeout: 20000 },
  async (t) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'respawn-points-writers-'));
    const dbFile = path.join(dir, 'points.db');
    const env = { ...process.env, DB_FILE: dbFile };
    const dbPath = path.join(__dirname, 'db.js');
    const modulePath = path.join(__dirname, 'pointsJournal.js');
    execFileSync(
      process.execPath,
      [
        '-e',
        `const {db, BASE_EVENT_ID} = require(${JSON.stringify(dbPath)});
    db.prepare("INSERT INTO players(id,name,api_key,created_at) VALUES ('writer','Writer','writer-key',1)").run();
    db.prepare("INSERT INTO event_participants(event_id,player_id,status) VALUES (?,'writer','accepted')").run(BASE_EVENT_ID);
    db.close();`,
      ],
      { env, stdio: 'pipe' },
    );
    const program = `const {recordPointsEntitlements, PointsJournalConflict} = require(${JSON.stringify(modulePath)});
    process.once('message', change => {
      try { recordPointsEntitlements([change]); process.send('recorded'); }
      catch (error) { process.send(error instanceof PointsJournalConflict ? 'conflict' : error.message); }
      finally { require(${JSON.stringify(dbPath)}).db.close(); process.disconnect(); }
    }); process.send('ready');`;
    const writers = [0, 1].map(() =>
      spawn(process.execPath, ['-e', program], { env, stdio: ['ignore', 'ignore', 'pipe', 'ipc'] }),
    );
    t.after(() => {
      for (const writer of writers) writer.kill();
      fs.rmSync(dir, { recursive: true, force: true });
    });
    await Promise.all(writers.map((writer) => once(writer, 'message')));
    const results = await Promise.all(
      writers.map(async (writer, index) => {
        const response = once(writer, 'message');
        writer.send(entitlement('writer', { total: index + 4 }));
        return (await response)[0];
      }),
    );
    assert.deepEqual(results.sort(), ['conflict', 'recorded']);
    const persisted = new Database(dbFile, { readonly: true });
    assert.equal((persisted.prepare('SELECT COUNT(*) AS n FROM points_journal').get() as { n: number }).n, 1);
    persisted.close();
  },
);
