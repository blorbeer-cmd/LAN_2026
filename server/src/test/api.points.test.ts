import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createTestApp, TEST_ADMIN_ID, DEFAULT_GROUP_ID } from './testApp';
import { createEvent, setParticipants } from '../events';
import { setActiveEventForPlayer } from '../eventContext';
import { db } from '../db';
import { wallet, PointsError, pointStandings, pointsAreVisible } from '../points';
import { correctJournalEntry } from '../pointsAdministration';
import { readPointsBalances, readPointsSource, readPointsJournal, recordPointsEntitlements } from '../pointsJournal';
import { buildPersonalDataExport, deleteAccount } from '../privacyService';
import { syncOrgaPoints } from '../orgaPoints';
import { grantTravelPoints } from '../travelPoints';
import { sweepTravelPoints } from '../travelPointSweep';
import { endEvent } from '../events';
import { config } from '../config';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { reconcileBetting, type roundView } from '../betting';
import { sweepBetting } from '../routes/points';
import { createPointsReport, readPointsReports, resolvePointsReport } from '../pointsReports';

const app = createTestApp();

test('private report records retain subjects, protect reporter exports and erase private copies without changing points', async () => {
  const f = await fixture();
  const [subject, reporter, creator] = f.players;
  const task = await request(app).post('/api/checklist/tasks/todo')
    .send({ title: 'Review these task points' });
  assert.equal(task.status, 201);
  const targetId = task.body.tasks[0].id;
  const input = { targetType: 'todo', targetId, reason: 'Please check the awarded points' };
  assert.throws(() => createPointsReport(DEFAULT_GROUP_ID, f.eventId, reporter, input),
    (error: unknown) => error instanceof PointsError && error.status === 404,
    'an open task without a points assignment is not a report target');
  assert.throws(() => createPointsReport(DEFAULT_GROUP_ID, f.eventId, reporter, { targetType: 'player', targetId: subject }),
    (error: unknown) => error instanceof PointsError && error.status === 400,
    'reports always identify a points assignment rather than a person');
  assert.equal((await request(app).post(`/api/checklist/tasks/${targetId}/claim`)
    .set('x-test-player-id', subject).send({ playerId: subject })).status, 200);
  assert.equal((await request(app).patch(`/api/checklist/tasks/${targetId}/done`)
    .set('x-test-player-id', subject).send({ playerId: subject })).status, 200);
  const original = readPointsJournal(DEFAULT_GROUP_ID, f.eventId, subject).find((entry) => entry.sourceKey === `todo:${targetId}`)!;
  const correction = correctJournalEntry({ groupId: DEFAULT_GROUP_ID, eventId: f.eventId, actorId: TEST_ADMIN_ID,
    entryId: original.id, total: 4, expectedRevision: original.revision, reason: 'Review the manually assigned helper points' });
  const balances = readPointsBalances(DEFAULT_GROUP_ID, f.eventId, subject);
  const first = createPointsReport(DEFAULT_GROUP_ID, f.eventId, reporter, input);
  assert.ok(first.recipients.includes(TEST_ADMIN_ID), 'creating the task does not exclude an admin whose points are not affected');
  const journalReport = createPointsReport(DEFAULT_GROUP_ID, f.eventId, TEST_ADMIN_ID,
    { targetType: 'journal', targetId: correction.entryId });
  assert.ok(readPointsReports(DEFAULT_GROUP_ID, f.eventId, TEST_ADMIN_ID).inbox.some((entry) => entry.id === journalReport.report.id),
    'assigning points to another account does not make them the admin own points');
  assert.throws(() => createPointsReport(DEFAULT_GROUP_ID, f.eventId, reporter, input),
    (error: unknown) => error instanceof PointsError && error.status === 409);
  createPointsReport(DEFAULT_GROUP_ID, f.eventId, creator, input);
  db.prepare("UPDATE group_memberships SET role='admin' WHERE group_id=? AND player_id=?").run(DEFAULT_GROUP_ID, subject);
  assert.deepEqual(readPointsReports(DEFAULT_GROUP_ID, f.eventId, subject), { own: [], inbox: [] });
  assert.deepEqual(buildPersonalDataExport(subject)!.pointsReports, []);
  db.prepare('UPDATE events SET created_by=? WHERE id=?').run(creator, f.eventId);
  const creatorInbox = readPointsReports(DEFAULT_GROUP_ID, f.eventId, creator).inbox;
  assert.equal(creatorInbox.length, 3);
  assert.equal(creatorInbox[0].canResolve, false);
  assert.throws(() => resolvePointsReport(DEFAULT_GROUP_ID, f.eventId, creator, first.report.id, { status: 'dismissed' }),
    (error: unknown) => error instanceof PointsError && error.status === 403);
  // Changing or deleting a source never grants the original subject access.
  db.prepare('UPDATE checklist_tasks SET created_by=? WHERE id=?').run(TEST_ADMIN_ID, targetId);
  db.prepare('DELETE FROM checklist_tasks WHERE id=?').run(targetId);
  assert.deepEqual(readPointsReports(DEFAULT_GROUP_ID, f.eventId, subject).inbox, []);
  assert.equal(readPointsReports(DEFAULT_GROUP_ID, f.eventId, reporter).own[0].status, 'open');
  resolvePointsReport(DEFAULT_GROUP_ID, f.eventId, TEST_ADMIN_ID, first.report.id,
    { status: 'corrected', resolution: 'Journal correction is handled separately' });
  assert.equal(readPointsReports(DEFAULT_GROUP_ID, f.eventId, reporter).own[0].status, 'corrected');
  assert.deepEqual(readPointsBalances(DEFAULT_GROUP_ID, f.eventId, subject), balances);
  assert.throws(() => resolvePointsReport(DEFAULT_GROUP_ID, f.eventId, TEST_ADMIN_ID, first.report.id, { status: 'dismissed' }),
    (error: unknown) => error instanceof PointsError && error.status === 409);
  const directory = mkdtempSync(path.join(tmpdir(), 'points-report-erasure-'));
  const mutableConfig = config as unknown as { deletionLedgerFile: string };
  const previousLedger = mutableConfig.deletionLedgerFile;
  mutableConfig.deletionLedgerFile = path.join(directory, 'receipts.jsonl');
  try {
    const erased = deleteAccount(reporter, TEST_ADMIN_ID);
    assert.equal(erased.ok, true, JSON.stringify(erased));
    const persisted = db.prepare('SELECT reporter_id,reason,status FROM points_reports WHERE id=?').get(first.report.id);
    assert.deepEqual(persisted, { reporter_id: null, reason: '', status: 'corrected' });
    assert.deepEqual(readPointsReports(DEFAULT_GROUP_ID, f.eventId, subject).inbox, []);
    const log = db.prepare("SELECT * FROM admin_log WHERE target_type='points_report' AND target_id=?").all(first.report.id);
    assert.deepEqual(log, [], 'report identities never enter the broadly visible admin log');
  } finally {
    mutableConfig.deletionLedgerFile = previousLedger;
    rmSync(directory, { recursive: true, force: true });
    db.prepare("UPDATE group_memberships SET role='member' WHERE group_id=? AND player_id=?").run(DEFAULT_GROUP_ID, subject);
  }
});

test('report API protects anonymous sole-admin review, applies role changes and serializes submission and resolution', async () => {
  const f = await fixture();
  const [reporter, secondAdmin, outsider] = f.players;
  const task = (await request(app).post('/api/checklist/tasks/todo').set('x-test-player-id', reporter)
    .send({ title: 'Disputed admin helper points' })).body.tasks[0];
  assert.equal((await request(app).post(`/api/checklist/tasks/${task.id}/claim`).send({ playerId: TEST_ADMIN_ID })).status, 200);
  assert.equal((await request(app).patch(`/api/checklist/tasks/${task.id}/done`).send({ playerId: TEST_ADMIN_ID })).status, 200);
  const reason = `Private sender ${reporter}`;
  const submit = () => request(app).post('/api/points/reports').set('x-test-player-id', reporter)
    .send({ targetType: 'todo', targetId: task.id, reason });
  const submitted = await Promise.all([submit(), submit()]);
  assert.deepEqual(submitted.map((r) => r.status).sort(), [201, 409]);
  const id = submitted.find((r) => r.status === 201)!.body.id;
  const inbox = () => request(app).get('/api/points/reports');
  const anonymous = (await inbox()).body.inbox.find((row: { id: string }) => row.id === id);
  assert.equal(anonymous.anonymous, true);
  assert.equal(anonymous.reporter, null);
  assert.equal(anonymous.reason, '');
  assert.equal(anonymous.createdAt, null);
  assert.ok(!JSON.stringify(anonymous).includes(reporter));
  const own = (await request(app).get('/api/points/reports').set('x-test-player-id', reporter)).body;
  assert.equal(own.own[0].reason, reason);
  assert.deepEqual((await request(app).get('/api/points/reports').set('x-test-player-id', outsider)).body.inbox, []);
  assert.ok(!(buildPersonalDataExport(TEST_ADMIN_ID)!.pointsReports as Array<{ id: string }>).some((report) => report.id === id),
    'admin exports contain no foreign submissions');
  assert.equal((await request(app).post('/api/points/close').send({})).status, 409);
  db.prepare("UPDATE group_memberships SET role='admin' WHERE group_id=? AND player_id=?").run(DEFAULT_GROUP_ID, secondAdmin);
  try {
    assert.deepEqual((await inbox()).body.inbox, [], 'an available second admin removes the self-review exception');
    assert.equal((await request(app).post(`/api/points/reports/${id}/resolve`).send({ status: 'dismissed' })).status, 404);
    const authorized = (await request(app).get('/api/points/reports').set('x-test-player-id', secondAdmin)).body.inbox[0];
    assert.equal(authorized.reporter.id, reporter);
    assert.equal(authorized.reason, reason);
  } finally {
    db.prepare("UPDATE group_memberships SET role='member' WHERE group_id=? AND player_id=?").run(DEFAULT_GROUP_ID, secondAdmin);
  }
  const resolutions = await Promise.all([0, 1].map(() => request(app).post(`/api/points/reports/${id}/resolve`)
    .send({ status: 'dismissed', resolution: 'Award checked against the task' })));
  assert.deepEqual(resolutions.map((r) => r.status).sort(), [200, 409]);
  assert.equal(readPointsBalances(DEFAULT_GROUP_ID, f.eventId, TEST_ADMIN_ID)!.orga, 3);
  assert.equal((await request(app).get('/api/points/reports').set('x-test-player-id', reporter)).body.own[0].status, 'dismissed');
  assert.equal((await request(app).post('/api/points/close').send({})).status, 200);
  assert.equal((await submit()).status, 409);
});

test('finalization refunds open and locked bets atomically, blocks on reports, and rolls every write back on failure', async () => {
  const f = await fixture();
  const open = await round(f), locked = await round(f);
  for (const market of [open, locked]) for (const [i, player] of f.players.slice(0, 2).entries())
    assert.equal((await request(app).put(`/api/points/rounds/${market.id}/tip`).set('x-test-player-id', player)
      .send({ outcomeId: String(i), stake: 5 })).status, 200);
  assert.equal((await request(app).post(`/api/points/rounds/${locked.id}/lock`).send({})).status, 200);
  const walletBefore = f.players.map((id) => wallet(f.eventId, id));
  const journalBefore = db.prepare('SELECT j.* FROM points_journal j JOIN points_sources s ON s.id=j.source_id WHERE s.event_id=? ORDER BY j.id').all(f.eventId);
  const roundsBefore = db.prepare('SELECT * FROM betting_rounds WHERE event_id=? ORDER BY id').all(f.eventId);
  db.exec(`CREATE TEMP TRIGGER fail_final_snapshot BEFORE INSERT ON points_snapshots
    BEGIN SELECT RAISE(ABORT,'final snapshot failed'); END`);
  try {
    assert.equal((await request(app).post('/api/points/close').send({})).status, 500);
    assert.deepEqual(f.players.map((id) => wallet(f.eventId, id)), walletBefore);
    assert.deepEqual(db.prepare('SELECT j.* FROM points_journal j JOIN points_sources s ON s.id=j.source_id WHERE s.event_id=? ORDER BY j.id').all(f.eventId), journalBefore);
    assert.deepEqual(db.prepare('SELECT * FROM betting_rounds WHERE event_id=? ORDER BY id').all(f.eventId), roundsBefore);
    assert.equal((await request(app).get('/api/points')).body.settings.closed_at, null);
  } finally { db.exec('DROP TRIGGER fail_final_snapshot'); }
  const closes = await Promise.all([0, 1].map(() => request(app).post('/api/points/close').send({})));
  assert.deepEqual(closes.map((r) => r.status).sort(), [200, 409]);
  const final = (await request(app).get('/api/points')).body;
  assert.ok(final.rounds.every((r: { status: string }) => r.status === 'refunded'));
  for (const player of f.players) {
    assert.deepEqual(wallet(f.eventId, player), { total: 100, held: 0, available: 100 });
    assert.equal(readPointsBalances(DEFAULT_GROUP_ID, f.eventId, player)!.betting, 0);
  }
  const snapshot = (await request(app).get('/api/points/snapshots/1')).body;
  assert.equal(snapshot.rules.unsettledMarketsAtClose, 'full_refund');
  assert.deepEqual(snapshot.standings, final.standings);
});

test('reports, results and market locks racing finalization preserve a consistent frozen revision', async () => {
  for (const closeFirst of [false, true]) {
    const f = await fixture();
    const task = (await request(app).post('/api/checklist/tasks/todo').send({ title: 'Report-close race' })).body.tasks[0];
    assert.equal((await request(app).post(`/api/checklist/tasks/${task.id}/claim`).send({ playerId: f.players[0] })).status, 200);
    assert.equal((await request(app).patch(`/api/checklist/tasks/${task.id}/done`).send({ playerId: f.players[0] })).status, 200);
    const report = () => request(app).post('/api/points/reports').set('x-test-player-id', f.players[1])
      .send({ targetType: 'todo', targetId: task.id });
    const close = () => request(app).post('/api/points/close').send({});
    const actions = await Promise.all(closeFirst ? [close(), report()] : [report(), close()]);
    const creation = actions[closeFirst ? 1 : 0], closure = actions[closeFirst ? 0 : 1];
    assert.deepEqual([creation.status, closure.status].sort(), creation.status === 201 ? [201, 409] : [200, 409]);
    if (creation.status === 201) {
      assert.equal(closure.status, 409);
      assert.equal((await request(app).post(`/api/points/reports/${creation.body.id}/resolve`).send({ status: 'dismissed' })).status, 200);
    } else assert.equal((await request(app).post('/api/points/reopen').send({ reason: 'Continue the race fixture' })).status, 200);
    const market = await round(f);
    for (const [index, player] of f.players.slice(0, 2).entries())
      assert.equal((await request(app).put(`/api/points/rounds/${market.id}/tip`).set('x-test-player-id', player)
        .send({ outcomeId: String(index), stake: 5 })).status, 200);
    const lock = () => request(app).post(`/api/points/rounds/${market.id}/lock`).send({});
    const locks = await Promise.all(closeFirst ? [close(), lock()] : [lock(), close()]);
    assert.equal(locks[closeFirst ? 0 : 1].status, 200);
    assert.ok([200, 409].includes(locks[closeFirst ? 1 : 0].status));
    assert.equal(wallet(f.eventId, f.players[0]).held, 0);
    assert.equal((await request(app).post('/api/points/reopen').send({ reason: 'Race result recording against close' })).status, 200);
    const resultMarket = await round(f);
    for (const [index, player] of f.players.slice(0, 2).entries())
      await request(app).put(`/api/points/rounds/${resultMarket.id}/tip`).set('x-test-player-id', player).send({ outcomeId: String(index), stake: 5 });
    await request(app).post(`/api/points/rounds/${resultMarket.id}/lock`).send({});
    const result = () => request(app).post('/api/matches').send({ gameId: f.gameId, drawId: resultMarket.drawId,
      teams: resultMarket.outcomes.map((o) => ({ playerIds: o.playerIds })), winnerTeamIndex: 0 });
    const race = await Promise.all(closeFirst ? [close(), result()] : [result(), close()]);
    assert.ok(race.every((r) => r.status === 200 || r.status === 201), JSON.stringify(race.map((r) => r.body)));
    const frozen = (await request(app).get('/api/points')).body;
    const snapshots = (await request(app).get('/api/points/snapshots')).body.revisions;
    assert.deepEqual((await request(app).get(`/api/points/snapshots/${snapshots[0].revision}`)).body.standings, frozen.standings);
    assert.deepEqual((await request(app).get('/api/export')).body.leaderboard, frozen.standings);
    assert.equal(wallet(f.eventId, f.players[0]).held, 0);
  }
});

test('exports retain the selected points revision and its rules after reopening and changing the roster', async () => {
  const f = await fixture();
  recordPointsEntitlements([{ groupId: DEFAULT_GROUP_ID, eventId: f.eventId, playerId: f.players[0],
    account: 'orga', sourceKey: 'fixture:revision', total: 7, expectedRevision: 0, title: 'Revision fixture' }]);
  const endpoint = `/api/points/snapshots?eventId=${f.eventId}`;
  const exportRevision = (revision: string) => request(app).get(`/api/export?eventId=${f.eventId}&pointsRevision=${revision}`);
  assert.equal((await request(app).post('/api/points/close').send({})).status, 200);
  const original = (await exportRevision('1')).body;
  assert.equal(original.pointsSnapshot.revision, 1);
  assert.equal(original.pointsSnapshot.rules.minimumSettledTips, 2);
  assert.equal(original.pointsSnapshot.rules.placePoints, 'N-rank+1');
  const stored = (await request(app).get(`/api/points/snapshots/1?eventId=${f.eventId}`)).body;
  assert.deepEqual(stored.standings, original.leaderboard);
  assert.equal((await request(app).post('/api/points/reopen').send({ reason: 'Correct final roster' })).status, 200);
  setParticipants(f.eventId, [TEST_ADMIN_ID, f.players[0]]);
  assert.deepEqual((await exportRevision('1')).body.leaderboard, original.leaderboard);
  assert.equal((await request(app).post('/api/points/close').send({})).status, 200);
  const current = (await request(app).get(`/api/export?eventId=${f.eventId}`)).body;
  assert.equal(current.pointsSnapshot.revision, 2);
  assert.equal(current.participantCount, 2);
  const historical = (await exportRevision('1')).body;
  assert.equal(historical.participantCount, 4);
  assert.deepEqual(historical.pointsSnapshot, original.pointsSnapshot);
  assert.deepEqual(historical.leaderboard, original.leaderboard);
  assert.deepEqual((await request(app).get(endpoint)).body.revisions.map((row: { revision: number }) => row.revision), [2, 1]);
  assert.equal((await exportRevision('3')).status, 404);
  assert.equal((await exportRevision('invalid')).status, 400);
  assert.equal((await request(app).get(`/api/points/snapshots/0?eventId=${f.eventId}`)).status, 400);
  db.prepare('UPDATE points_settings SET visible=0 WHERE event_id=?').run(f.eventId);
  assert.equal((await request(app).get(`/api/points/snapshots/1?eventId=${f.eventId}`).set('x-test-player-id', f.players[0])).status, 403);
  assert.equal((await exportRevision('1')).status, 404, 'a historical selection never exposes hidden points in the shared export');
  db.prepare('UPDATE points_settings SET visible=1 WHERE event_id=?').run(f.eventId);
  const directory = mkdtempSync(path.join(tmpdir(), 'points-snapshot-erasure-'));
  const mutableConfig = config as unknown as { deletionLedgerFile: string };
  const previousLedger = mutableConfig.deletionLedgerFile;
  mutableConfig.deletionLedgerFile = path.join(directory, 'receipts.jsonl');
  try {
    const deleted = deleteAccount(f.players[1], TEST_ADMIN_ID);
    assert.equal(deleted.ok, true, JSON.stringify(deleted));
    const anonymized = (await exportRevision('1')).body;
    assert.equal(anonymized.participantCount, 4);
    assert.deepEqual(anonymized.pointsSnapshot.rules, original.pointsSnapshot.rules);
    assert.deepEqual(anonymized.leaderboard, original.leaderboard.filter((row: { playerId: string }) => row.playerId !== f.players[1]));
    const afterDeletion = await request(app).get(`/api/points/snapshots/1?eventId=${f.eventId}`);
    assert.equal(afterDeletion.status, 200);
    assert.ok(!JSON.stringify(afterDeletion.body).includes(f.players[1]));
  } finally {
    mutableConfig.deletionLedgerFile = previousLedger;
    rmSync(directory, { recursive: true, force: true });
  }
});

test('travel awards are granted once at event start and survive later edits', async () => {
  const f = await fixture();
  const start = Date.now() + 60_000;
  db.prepare('UPDATE events SET starts_at=? WHERE id=?').run(start, f.eventId);
  db.prepare('INSERT INTO arrivals(event_id,player_id,arrival_at,departure_at,updated_at) VALUES (?,?,?,?,?)')
    .run(f.eventId, f.players[0], start + 1000, start + 2000, start - 100);
  db.prepare('INSERT INTO arrivals(event_id,player_id,arrival_at,departure_at,updated_at) VALUES (?,?,?,?,?)')
    .run(f.eventId, f.players[1], start + 1000, null, start - 100);
  db.prepare('INSERT INTO arrivals(event_id,player_id,arrival_at,departure_at,updated_at) VALUES (?,?,?,?,?)')
    .run(f.eventId, f.players[2], start + 1000, start + 2000, start + 1);
  db.prepare("UPDATE events SET status='cancelled' WHERE id=?").run(f.eventId);
  assert.equal(grantTravelPoints(DEFAULT_GROUP_ID, f.eventId, start), false, 'cancelled events do not start');
  db.prepare("UPDATE events SET status='ended',ended_at=? WHERE id=?").run(start + 1, f.eventId);
  sweepTravelPoints(start + 2);
  assert.equal(grantTravelPoints(DEFAULT_GROUP_ID, f.eventId, start + 2), false, 'finished events do not receive retroactive travel awards');
  assert.equal(readPointsBalances(DEFAULT_GROUP_ID, f.eventId, f.players[0])!.orga, 0);
  db.prepare("UPDATE events SET status='published',ended_at=NULL WHERE id=?").run(f.eventId);
  assert.equal(grantTravelPoints(DEFAULT_GROUP_ID, f.eventId, start - 1), false);
  db.exec(`CREATE TEMP TRIGGER fail_travel_points BEFORE INSERT ON points_journal
    WHEN NEW.title='Ankunft eingetragen' BEGIN SELECT RAISE(ABORT,'travel points failed'); END`);
  try {
    assert.throws(() => grantTravelPoints(DEFAULT_GROUP_ID, f.eventId, start), /travel points failed/);
    assert.equal(readPointsBalances(DEFAULT_GROUP_ID, f.eventId, f.players[0])!.orga, 0);
  } finally { db.exec('DROP TRIGGER fail_travel_points'); }
  sweepTravelPoints(start);
  assert.equal(grantTravelPoints(DEFAULT_GROUP_ID, f.eventId, start), false);
  assert.equal(readPointsBalances(DEFAULT_GROUP_ID, f.eventId, f.players[0])!.orga, 4);
  assert.equal(readPointsBalances(DEFAULT_GROUP_ID, f.eventId, f.players[1])!.orga, 2);
  assert.equal(readPointsBalances(DEFAULT_GROUP_ID, f.eventId, f.players[2])!.orga, 0);
  const entry = db.prepare(`SELECT j.id FROM points_journal j JOIN points_sources s ON s.id=j.source_id
    WHERE s.event_id=? AND s.player_id=? AND s.source_key='bonus:arrival'`).get(f.eventId, f.players[0]) as { id: string };
  assert.equal((await request(app).post(`/api/points/admin/journal/${entry.id}/correct`).send({ total: 1, revision: 1, reason: 'Korrektur' })).status, 200);
  db.prepare('UPDATE arrivals SET arrival_at=NULL,departure_at=NULL,updated_at=? WHERE event_id=? AND player_id=?')
    .run(start + 1, f.eventId, f.players[0]);
  syncOrgaPoints(DEFAULT_GROUP_ID, f.eventId);
  assert.equal(readPointsBalances(DEFAULT_GROUP_ID, f.eventId, f.players[0])!.orga, 3, 'manual corrections and the permanent bonus survive edits');
});

test('a travel edit after event start first captures the pre-start values atomically', async () => {
  const f = await fixture();
  const start = Date.now() - 1000;
  db.prepare('UPDATE events SET starts_at=? WHERE id=?').run(start, f.eventId);
  db.prepare('INSERT INTO arrivals(event_id,player_id,arrival_at,departure_at,updated_at) VALUES (?,?,?,?,?)')
    .run(f.eventId, f.players[0], start + 1000, start + 2000, start - 100);
  const response = await request(app).put('/api/arrivals/mine').set('x-test-player-id', f.players[0])
    .send({ playerId: f.players[0], arrivalAt: null, departureAt: null });
  assert.equal(response.status, 200, JSON.stringify(response.body));
  assert.equal(readPointsBalances(DEFAULT_GROUP_ID, f.eventId, f.players[0])!.orga, 4);
});

test('ending a running event captures travel awards before changing its status', async () => {
  const f = await fixture();
  const start = Date.now() - 1000;
  db.prepare('UPDATE events SET starts_at=? WHERE id=?').run(start, f.eventId);
  db.prepare('INSERT INTO arrivals(event_id,player_id,arrival_at,departure_at,updated_at) VALUES (?,?,?,?,?)')
    .run(f.eventId, f.players[0], start, start + 1000, start - 100);
  assert.equal(endEvent(f.eventId)?.status, 'ended');
  assert.equal(readPointsBalances(DEFAULT_GROUP_ID, f.eventId, f.players[0])!.orga, 4);
});

test('three distinct game voters grant two organizer points once and deletion reverses them', async () => {
  const f = await fixture();
  const started = await request(app).post('/api/votes/start').send({ mode: 'single' });
  assert.equal(started.status, 201);
  const round = started.body.round as number;
  const { started_at: startedAt } = db.prepare('SELECT started_at FROM vote_rounds WHERE group_id=? AND round=?')
    .get(DEFAULT_GROUP_ID, round) as { started_at: number };
  for (const playerId of f.players) {
    const result = await request(app).post('/api/votes').set('x-test-player-id', playerId)
      .send({ playerId, round, gameId: f.gameId });
    assert.equal(result.status, 200, JSON.stringify(result.body));
  }
  const close = () => request(app).post('/api/votes/close').send({ round });
  db.exec(`CREATE TEMP TRIGGER fail_vote_points BEFORE INSERT ON points_journal
    WHEN NEW.title LIKE 'Spieleabstimmung abgeschlossen:%' BEGIN SELECT RAISE(ABORT,'vote points failed'); END`);
  try {
    assert.equal((await close()).status, 500);
    assert.equal((db.prepare('SELECT closed_at FROM vote_rounds WHERE group_id=? AND round=?').get(DEFAULT_GROUP_ID, round) as { closed_at: number | null }).closed_at, null);
  } finally { db.exec('DROP TRIGGER fail_vote_points'); }
  const results = await Promise.all([close(), close()]);
  assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
  const source = { groupId: DEFAULT_GROUP_ID, eventId: f.eventId, playerId: TEST_ADMIN_ID,
    account: 'orga' as const, sourceKey: `vote:${round}:${startedAt}:organization` };
  assert.equal(readPointsSource(source)!.total, 2);
  syncOrgaPoints(DEFAULT_GROUP_ID, f.eventId);
  assert.equal(readPointsSource(source)!.total, 2);
  const runoff = await request(app).post('/api/votes/start').send({ mode: 'single', sourceRound: round, gameIds: [f.gameId] });
  assert.equal(runoff.status, 201, JSON.stringify(runoff.body));
  for (const playerId of f.players)
    assert.equal((await request(app).post('/api/votes').set('x-test-player-id', playerId)
      .send({ playerId, round: runoff.body.round, gameId: f.gameId })).status, 200);
  assert.equal((await request(app).post('/api/votes/close').send({ round: runoff.body.round })).status, 200);
  assert.equal(readPointsSource(source)!.total, 2, 'a runoff cannot pay the same decision twice');
  assert.equal((await request(app).delete(`/api/votes/history/${runoff.body.round}`)).status, 200);
  assert.equal((await request(app).delete(`/api/votes/history/${round}`)).status, 200);
  assert.equal(readPointsSource(source)!.total, 0);
  const next = await request(app).post('/api/votes/start').send({ mode: 'single' });
  assert.equal(next.status, 201);
  const nextRound = next.body.round as number;
  const nextStarted = (db.prepare('SELECT started_at FROM vote_rounds WHERE group_id=? AND round=?')
    .get(DEFAULT_GROUP_ID, nextRound) as { started_at: number }).started_at;
  for (const playerId of f.players)
    assert.equal((await request(app).post('/api/votes').set('x-test-player-id', playerId)
      .send({ playerId, round: nextRound, gameId: f.gameId })).status, 200);
  assert.equal((await request(app).post('/api/votes/close').send({ round: nextRound })).status, 200);
  assert.equal(readPointsSource(source)!.total, 0, 'a later round never reuses a deleted source');
  assert.equal(readPointsSource({ ...source, sourceKey: `vote:${nextRound}:${nextStarted}:organization` })!.total, 2);
});

test('two game voters do not qualify for the organizer reward', async () => {
  const f = await fixture();
  const started = await request(app).post('/api/votes/start').send({ mode: 'single' });
  assert.equal(started.status, 201);
  const round = started.body.round as number;
  for (const playerId of f.players.slice(0, 2))
    assert.equal((await request(app).post('/api/votes').set('x-test-player-id', playerId)
      .send({ playerId, round, gameId: f.gameId })).status, 200);
  assert.equal((await request(app).post('/api/votes/close').send({ round })).status, 200);
  assert.equal(readPointsBalances(DEFAULT_GROUP_ID, f.eventId, TEST_ADMIN_ID)!.orga, 0);
});
// Explicit pre-upgrade promises still have to be honored. No public endpoint
// can create these after fixed To-do rewards have replaced task configuration.
function legacyPromise(taskId: string, perPerson = 5, slots = 1) {
  db.transaction(() => {
    db.prepare("UPDATE checklist_tasks SET points_value=0,points_model='legacy' WHERE id=?").run(taskId);
    db.prepare(`INSERT INTO points_task_rewards(task_id,event_id,group_id,per_person,slots,created_at)
      SELECT id,event_id,group_id,?,?,created_at FROM checklist_tasks WHERE id=?`).run(perPerson, slots, taskId);
    db.prepare(`UPDATE points_settings SET orga_allocated=orga_allocated+?
      WHERE event_id=(SELECT event_id FROM checklist_tasks WHERE id=?)`).run(perPerson * slots, taskId);
  })();
}
let sequence = 0;
async function fixture(config: object = {}, visible = true) {
  sequence++;
  const players: string[] = [];
  for (let i = 0; i < 3; i++)
    players.push(
      (
        await request(app)
          .post('/api/players')
          .send({ name: `Points ${sequence}-${i}` })
      ).body.id,
    );
  const event = createEvent(`Points LAN ${sequence}`, {
    groupId: DEFAULT_GROUP_ID,
    startsAt: Date.now() - 1000,
    endsAt: Date.now() + 86400000,
  });
  setParticipants(event.id, [TEST_ADMIN_ID, ...players]);
  for (const id of [TEST_ADMIN_ID, ...players]) setActiveEventForPlayer(id, event.id);
  const settings = await request(app).put('/api/points/settings').send(config);
  assert.equal(settings.status, 200, JSON.stringify(settings.body));
  if (visible) {
    assert.equal((await request(app).patch(`/api/events/${event.id}/points-visibility`).send({ visible: true, revision: 0 })).status, 200);
  }
  const game = await request(app)
    .post('/api/games')
    .send({ name: `Points Game ${sequence}` });
  assert.equal(game.status, 201);
  return { eventId: event.id, players, gameId: game.body.id };
}
async function automaticMarket(f: { eventId: string }, sourceType: string, sourceId: string): Promise<ReturnType<typeof roundView>> {
  const response = await request(app).get(`/api/points?eventId=${f.eventId}`);
  assert.equal(response.status, 200);
  const found = response.body.rounds.find((row: { sourceType: string; sourceId: string }) =>
    row.sourceType === sourceType && row.sourceId === sourceId);
  assert.ok(found, `automatic market missing: ${sourceType}/${sourceId}`);
  return found;
}
async function round(f: Awaited<ReturnType<typeof fixture>>) {
  const draw = await request(app)
    .post('/api/matchmaking')
    .send({ gameId: f.gameId, playerIds: f.players.slice(0, 2), teamCount: 2, bettingAllowed: true });
  assert.equal(draw.status, 200, JSON.stringify(draw.body));
  const id = draw.body.drawId ?? draw.body.id;
  assert.ok(id, JSON.stringify(draw.body));
  const created = await automaticMarket(f, 'draw', id);
  assert.equal(created.status, 'open');
  return {
    id: created.id,
    drawId: id as string,
    outcomes: created.outcomes.filter((o) => o.playerIds.length),
  };
}

test('creators decide match betting, tournament markets open automatically, and market failures roll competition writes back', async () => {
  const f = await fixture();
  const create = (bettingAllowed?: unknown) => request(app).post('/api/matchmaking').set('x-test-player-id', f.players[0])
    .send({ gameId: f.gameId, playerIds: f.players.slice(0, 2), teamCount: 2, bettingAllowed });
  assert.equal((await create('yes')).status, 400);
  const denied = await create(false);
  assert.equal(denied.status, 200);
  for (const actor of [TEST_ADMIN_ID, f.players[0], f.players[1]])
    assert.equal((await request(app).post('/api/points/rounds').set('x-test-player-id', actor)
      .send({ sourceType: 'draw', sourceId: denied.body.id, closesAt: Date.now() + 60000 })).status,
    actor === TEST_ADMIN_ID ? 409 : 403,
    'neither admins nor participants can bypass the creator decision');
  const allowed = await create();
  assert.equal(allowed.status, 200);
  assert.equal(allowed.body.bettingAllowed, true);
  const threeSides = await request(app).post('/api/matchmaking').send({ gameId: f.gameId,
    playerIds: f.players, teamCount: 3 });
  assert.equal(threeSides.status, 200);
  assert.equal(threeSides.body.bettingAllowed, true);
  const multiMarket = await automaticMarket(f, 'draw', threeSides.body.id);
  assert.equal(multiMarket.outcomes.filter((outcome) => outcome.playerIds.length).length, 3);
  for (const [index, player] of f.players.entries()) assert.equal((await request(app)
    .put(`/api/points/rounds/${multiMarket.id}/tip`).set('x-test-player-id', player)
    .send({ outcomeId: String(index), stake: 5 })).status, 200);
  assert.equal((await request(app).post(`/api/points/rounds/${multiMarket.id}/lock`).send({})).status, 200);
  const multiResult = await request(app).post('/api/matches').send({ gameId: f.gameId,
    drawId: threeSides.body.id, teams: multiMarket.outcomes.filter((o) => o.playerIds.length)
      .map((o) => ({ playerIds: o.playerIds })), winnerTeamIndex: 2 });
  assert.equal(multiResult.status, 201);
  assert.equal((await automaticMarket(f, 'draw', threeSides.body.id)).status, 'settled');
  assert.deepEqual(f.players.map((id) => wallet(f.eventId, id).total), [97, 98, 105]);
  for (const [index, outcome] of multiMarket.outcomes.filter((o) => o.playerIds.length).entries()) {
    const booking = readPointsJournal(DEFAULT_GROUP_ID, f.eventId, outcome.playerIds[0])
      .find((entry) => entry.account === 'playing' && entry.sourceKey === `match:${multiResult.body.id}`)!;
    assert.match(booking.title, index === 2 ? / · Platz 1$/ : / · Platz 3$/);
    assert.equal(booking.amount, index === 2 ? 4 : 1);
  }
  const concurrent = await Promise.all([0, 1].map(() => request(app).get('/api/points')));
  for (const response of concurrent)
    assert.equal(response.body.rounds.filter((row: { sourceId: string }) => row.sourceId === allowed.body.id).length, 1);
  const opened = await automaticMarket(f, 'draw', allowed.body.id);
  assert.equal(opened.closesAt, null, 'automatically offered tips close at the explicit pre-game start');
  const personal = buildPersonalDataExport(f.players[0])! as { organizedCompetitions: { draws: Array<{ id: string; bettingAllowed: number }> } };
  assert.equal(personal.organizedCompetitions.draws.find((row) => row.id === allowed.body.id)!.bettingAllowed, 1);
  const malformed = await create(true);
  db.prepare("DELETE FROM betting_rounds WHERE source_type='draw' AND source_id=?").run(malformed.body.id);
  db.prepare('UPDATE matchmaking_draws SET teams=? WHERE id=?').run(JSON.stringify(malformed.body.teams.slice(0, 1)), malformed.body.id);
  assert.equal((await request(app).post('/api/points/rounds').send({ sourceType: 'draw',
    sourceId: malformed.body.id, closesAt: Date.now() + 60000 })).status, 409,
    'a legacy one-sided draw plus the optional draw selection is not a two-sided market');
  const before = (db.prepare('SELECT COUNT(*) AS n FROM matchmaking_draws WHERE event_id=?').get(f.eventId) as { n: number }).n;
  db.exec(`CREATE TEMP TRIGGER fail_automatic_market BEFORE INSERT ON betting_rounds
    BEGIN SELECT RAISE(ABORT,'automatic market failed'); END`);
  try {
    assert.equal((await create(true)).status, 500);
    assert.equal((db.prepare('SELECT COUNT(*) AS n FROM matchmaking_draws WHERE event_id=?').get(f.eventId) as { n: number }).n, before);
  } finally { db.exec('DROP TRIGGER fail_automatic_market'); }
  const rematch = await request(app).post('/api/matchmaking/rematch').set('x-test-player-id', f.players[0])
    .send({ gameId: f.gameId, teams: f.players.slice(0, 2).map((id) => ({ playerIds: [id] })) });
  assert.equal(rematch.status, 200);
  assert.equal((await automaticMarket(f, 'draw', rematch.body.id)).status, 'open');
  const multiRematch = await request(app).post('/api/matchmaking/rematch').send({ gameId: f.gameId,
    teams: f.players.map((id) => ({ playerIds: [id] })) });
  assert.equal(multiRematch.status, 200);
  assert.equal((await automaticMarket(f, 'draw', multiRematch.body.id)).outcomes.filter((o) => o.playerIds.length).length, 3);
  const draft = await request(app).post('/api/draft/start').send({ gameId: f.gameId,
    captainIds: f.players.slice(0, 2), poolPlayerIds: [f.players[2]] });
  assert.equal(draft.status, 201);
  const picked = await request(app).post('/api/draft/pick').set('x-test-player-id', f.players[0])
    .send({ playerId: f.players[0], pickPlayerId: f.players[2] });
  assert.equal(picked.status, 200);
  const drafted = (await request(app).get('/api/matchmaking/history')).body.history.find((row: { source: string }) => row.source === 'draft');
  assert.equal(drafted.bettingAllowed, true);
  assert.equal((await automaticMarket(f, 'draw', drafted.id)).status, 'open');
  const multiDraft = await request(app).post('/api/draft/start').send({ gameId: f.gameId,
    captainIds: f.players, poolPlayerIds: [TEST_ADMIN_ID] });
  assert.equal(multiDraft.status, 201);
  assert.equal((await request(app).post('/api/draft/pick').set('x-test-player-id', f.players[0])
    .send({ playerId: f.players[0], pickPlayerId: TEST_ADMIN_ID })).status, 200);
  const multiDrafted = (await request(app).get('/api/matchmaking/history')).body.openDraws
    .find((row: { source: string; teams: unknown[] }) => row.source === 'draft' && row.teams.length === 3);
  assert.ok(multiDrafted);
  assert.equal((await automaticMarket(f, 'draw', multiDrafted.id)).outcomes.filter((o) => o.playerIds.length).length, 3);
  const tournament = await request(app).post('/api/tournaments').set('x-test-player-id', f.players[0]).send({
    gameId: f.gameId, format: 'single_elimination', teams: f.players.slice(0, 2).map((id) => ({ playerIds: [id] })),
  });
  assert.equal(tournament.status, 201);
  const champion = await automaticMarket(f, 'tournament', tournament.body.id);
  const fixtureRound = await automaticMarket(f, 'tournament_match', tournament.body.matches[0].id);
  const locks = await Promise.all([0, 1].map(() => request(app).post(`/api/points/rounds/${fixtureRound.id}/lock`)
    .set('x-test-player-id', f.players[0]).send({})));
  assert.deepEqual(locks.map((response) => response.status).sort(), [200, 409]);
  assert.equal((await automaticMarket(f, 'tournament', tournament.body.id)).status, 'locked', 'manual closure retains an empty champion pool so it can be reopened before play');
  assert.equal((await request(app).post(`/api/points/rounds/${champion.id}/reopen`).send({})).status, 409,
    'the outright pool stays closed while a fixture is marked as started');
  assert.equal((await request(app).post(`/api/points/rounds/${fixtureRound.id}/reopen`).set('x-test-player-id', f.players[0]).send({})).status, 200);
  assert.equal((await request(app).post(`/api/points/rounds/${champion.id}/reopen`).send({})).status, 200);
  assert.equal((await request(app).post(`/api/points/rounds/${fixtureRound.id}/lock`).send({})).status, 200);
  assert.equal((await request(app).put(`/api/points/rounds/${champion.id}/tip`).set('x-test-player-id', f.players[0])
    .send({ outcomeId: champion.outcomes[0].id, stake: 1 })).status, 409);
  db.prepare("UPDATE events SET status='ended',ended_at=? WHERE id=?").run(Date.now(), f.eventId);
  assert.equal((await request(app).put(`/api/points/rounds/${opened.id}/tip?eventId=${f.eventId}`).set('x-test-player-id', f.players[0])
    .send({ outcomeId: opened.outcomes[0].id, stake: 1 })).status, 409, 'ended LANs retain results but accept no new tips');
});

test('manual betting closure can be reopened before play without changing money; rights, deadlines and races remain guarded', async () => {
  const f = await fixture();
  const r = await round(f);
  const [a, b, spectator] = f.players;
  const reopen = (actor = a) => request(app).post(`/api/points/rounds/${r.id}/reopen?eventId=${f.eventId}`)
    .set('x-test-player-id', actor).send({});
  assert.equal((await reopen()).status, 409, 'an already open market is not reopened');
  assert.equal((await request(app).post(`/api/points/rounds/${r.id}/lock`).send({})).status, 200);
  assert.equal((await automaticMarket(f, 'draw', r.drawId)).status, 'locked', 'empty manual closure remains reversible');
  assert.equal((await reopen(spectator)).status, 403);
  const before = [a, b].map((id) => ({ wallet: wallet(f.eventId, id), journal: readPointsJournal(DEFAULT_GROUP_ID, f.eventId, id) }));
  db.exec(`CREATE TEMP TRIGGER fail_betting_reopen BEFORE INSERT ON admin_log
    WHEN NEW.action='betting_round_reopened' BEGIN SELECT RAISE(ABORT,'reopen audit failed'); END;`);
  try { assert.equal((await reopen()).status, 500); }
  finally { db.exec('DROP TRIGGER fail_betting_reopen'); }
  assert.equal((await automaticMarket(f, 'draw', r.drawId)).status, 'locked');
  const attempts = await Promise.all([reopen(), reopen()]);
  assert.deepEqual(attempts.map((response) => response.status).sort(), [200, 409]);
  assert.deepEqual([a, b].map((id) => ({ wallet: wallet(f.eventId, id), journal: readPointsJournal(DEFAULT_GROUP_ID, f.eventId, id) })), before);
  for (const [index, player] of [a, b].entries())
    assert.equal((await request(app).put(`/api/points/rounds/${r.id}/tip`).set('x-test-player-id', player)
      .send({ outcomeId: String(index), stake: 10 })).status, 200);
  assert.equal((await request(app).post(`/api/points/rounds/${r.id}/lock`).send({})).status, 200);
  const reserved = wallet(f.eventId, a);
  db.prepare('UPDATE betting_rounds SET revision=1 WHERE id=?').run(r.id);
  assert.equal((await reopen()).status, 409, 'an immutable paid pool awaiting a corrected result cannot accept new tips');
  db.prepare('UPDATE betting_rounds SET revision=0 WHERE id=?').run(r.id);
  db.prepare('UPDATE betting_rounds SET closes_at=? WHERE id=?').run(Date.now() - 1, r.id);
  assert.equal((await reopen()).status, 409, 'a passed explicit deadline cannot be bypassed');
  db.prepare('UPDATE betting_rounds SET closes_at=0 WHERE id=?').run(r.id);
  assert.equal((await request(app).patch(`/api/events/${f.eventId}/points-visibility`).send({ visible: false, revision: 1 })).status, 200);
  assert.equal((await reopen()).status, 403);
  assert.equal((await request(app).patch(`/api/events/${f.eventId}/points-visibility`).send({ visible: true, revision: 2 })).status, 200);
  assert.equal((await reopen(TEST_ADMIN_ID)).status, 200);
  assert.deepEqual(wallet(f.eventId, a), reserved, 'paid reservations survive reopening unchanged');
  assert.equal((await request(app).post(`/api/points/rounds/${r.id}/lock`).send({})).status, 200);
  db.prepare("UPDATE events SET ended_at=?,status='ended' WHERE id=?").run(Date.now(), f.eventId);
  assert.equal((await reopen()).status, 409);
  db.prepare("UPDATE events SET ended_at=NULL,status='published' WHERE id=?").run(f.eventId);
  assert.equal((await request(app).post('/api/matches').send({ gameId: f.gameId, drawId: r.drawId,
    teams: r.outcomes.map((outcome) => ({ playerIds: outcome.playerIds })), winnerTeamIndex: 0 })).status, 201);
  assert.equal((await reopen()).status, 409, 'settled results cannot accept late tips');
  assert.equal((await request(app).post('/api/points/close').send({})).status, 200);
  assert.equal((await reopen()).status, 409);
});

test('category journal corrections require admin rights and reason, allow own changes and commit with their audit', async () => {
  const f = await fixture({}, false);
  const sources = [TEST_ADMIN_ID, f.players[0]].map((playerId) => ({ groupId: DEFAULT_GROUP_ID,
    eventId: f.eventId, playerId, account: 'orga' as const, sourceKey: 'todo:admin-correction' }));
  const originals = recordPointsEntitlements(sources.map((source) => ({ ...source, total: 3,
    expectedRevision: 0, title: 'Aufgabe erledigt' })));
  db.prepare('UPDATE events SET created_by = ? WHERE id = ?').run(f.players[0], f.eventId);
  const correct = (index: number, total: unknown, revision: unknown, reason: unknown, actor = TEST_ADMIN_ID) =>
    request(app).post(`/api/points/admin/journal/${originals[index].entryId}/correct?eventId=${f.eventId}`)
      .set('x-test-player-id', actor).send({ total, revision, reason, actorId: f.players[1] });
  assert.equal((await request(app).get('/api/points/admin/journal').set('x-test-player-id', f.players[0])).status, 403);
  assert.equal((await correct(1, 2, 1, 'Ersteller ohne Adminrolle', f.players[0])).status, 403);
  assert.throws(() => correctJournalEntry({ groupId: DEFAULT_GROUP_ID, eventId: f.eventId,
    actorId: f.players[0], entryId: originals[1].entryId!, total: 2, expectedRevision: 1, reason: 'Kein Admin' }),
    (error: unknown) => error instanceof PointsError && error.status === 403);
  assert.equal((await correct(0, 5, 1, '')).status, 400);
  assert.equal((await correct(0, 1.5, 1, 'Keine ganzen Punkte')).status, 400);
  for (const account of ['wallet', 'betting'] as const) {
    const source = { ...sources[0], account, sourceKey: 'market:correction-guard' };
    const entry = recordPointsEntitlements([{ ...source, total: 5, expectedRevision: 0, title: 'Wettabrechnung' }])[0];
    const correction = await request(app).post(`/api/points/admin/journal/${entry.entryId}/correct?eventId=${f.eventId}`)
      .send({ total: 10, revision: 1, reason: 'Einseitige Wettkorrektur' });
    assert.equal(correction.status, 409);
    assert.equal(readPointsSource(source)!.total, 5, 'financial corrections must preserve the market zero sum');
  }
  const own = await correct(0, 5, 1, 'Fehlende eigene Punkte ergänzt');
  assert.equal(own.status, 200, JSON.stringify(own.body));
  assert.equal(readPointsBalances(DEFAULT_GROUP_ID, f.eventId, TEST_ADMIN_ID)!.orga, 5);
  const ownAudit = db.prepare("SELECT actor_player_id, details FROM admin_log WHERE target_id = ? AND action = 'category_points_corrected'").get(own.body.entryId) as { actor_player_id: string; details: string };
  assert.equal(ownAudit.actor_player_id, TEST_ADMIN_ID, 'the session actor cannot be overridden by request input');
  assert.equal(JSON.parse(ownAudit.details).before, 3);
  assert.equal(JSON.parse(ownAudit.details).after, 5);
  assert.equal((await correct(0, 5, 1, 'Veralteter Stand')).status, 409);
  const auditCount = () => (db.prepare("SELECT COUNT(*) AS n FROM admin_log WHERE action = 'category_points_corrected' AND json_extract(details,'$.eventId') = ?").get(f.eventId) as { n: number }).n;
  assert.equal((await correct(0, 5, 2, 'Unverändert')).body.changed, false);
  assert.equal(auditCount(), 1);
  const parallel = await Promise.all([1, 2].map((total) => correct(1, total, 1, 'Tatsächlichen Anspruch korrigiert')));
  assert.deepEqual(parallel.map((r) => r.status).sort(), [200, 409]);
  assert.equal(readPointsSource(sources[1])!.revision, 2);
  assert.equal(readPointsSource(sources[1])!.total, parallel.find((r) => r.status === 200)!.body.total);
  assert.equal(auditCount(), 2);
  const journal = await request(app).get(`/api/points/admin/journal?eventId=${f.eventId}`);
  assert.equal(journal.status, 200);
  assert.equal(journal.body.entries.find((entry: { id: string }) => entry.id === own.body.entryId).actorId, TEST_ADMIN_ID);
  const otherEvent = createEvent(`Other journal scope ${sequence}`, { groupId: DEFAULT_GROUP_ID, startsAt: Date.now(), endsAt: null });
  setParticipants(otherEvent.id, [TEST_ADMIN_ID]);
  const foreign = recordPointsEntitlements([{ ...sources[0], eventId: otherEvent.id, total: 2, expectedRevision: 0, title: 'Anderes Event' }])[0];
  assert.equal((await request(app).post(`/api/points/admin/journal/${foreign.entryId}/correct?eventId=${f.eventId}`).send({ total: 1, revision: 1, reason: 'Falsches Event' })).status, 404);
  db.exec(`CREATE TEMP TRIGGER fail_category_audit BEFORE INSERT ON admin_log
    WHEN NEW.action = 'category_points_corrected' BEGIN SELECT RAISE(ABORT, 'test audit failure'); END;`);
  try {
    assert.equal((await correct(0, 4, 2, 'Audit muss atomar sein')).status, 500);
    assert.deepEqual(readPointsSource(sources[0]), { total: 5, revision: 2 });
  } finally {
    db.exec('DROP TRIGGER fail_category_audit');
  }
  assert.equal((await request(app).post(`/api/points/close?eventId=${f.eventId}`).send({})).status, 200);
  assert.equal((await correct(0, 4, 2, 'Festgeschrieben')).status, 409);
});

test('points start once per accepted participant, preserve event access, and block member administration', async () => {
  const background = createEvent('Unconfigured background LAN', { groupId: DEFAULT_GROUP_ID, startsAt: Date.now(), endsAt: Date.now() + 86400000 });
  setParticipants(background.id, [TEST_ADMIN_ID]);
  assert.equal(wallet(background.id, TEST_ADMIN_ID).total, 100, 'start points exist before any points API call');
  assert.deepEqual(db.prepare('SELECT visible,configured_at FROM points_settings WHERE event_id = ?').get(background.id), { visible: 0, configured_at: null });
  const configurations = await Promise.all([10, 20].map((initialPoints) => request(app)
    .put(`/api/points/settings?eventId=${background.id}`).send({ initialPoints })));
  assert.deepEqual(configurations.map((r) => r.status), [400, 400]);
  assert.equal(wallet(background.id, TEST_ADMIN_ID).total, 100, 'the fixed start cannot be reconfigured');
  assert.equal((await request(app).put(`/api/points/settings?eventId=${background.id}`).send({ initialPoints: 100 })).status, 200);
  const f = await fixture();
  await Promise.all([
    request(app).put('/api/points/settings').send({}),
    request(app).put('/api/points/settings').send({}),
  ]);
  const reads = await Promise.all([request(app).get('/api/points'), request(app).get('/api/points')]);
  assert.equal(reads[0].body.wallet.total, 100);
  assert.equal(reads[1].body.entries.length, 1);
  assert.equal(
    (await request(app).put('/api/points/settings').set('x-test-player-id', f.players[0]).send({})).status,
    403,
  );
  assert.equal((await request(app).get('/api/points?eventId=unknown')).status, 404);
  const outsider = (
    await request(app)
      .post('/api/players')
      .send({ name: `Points Outsider ${sequence}` })
  ).body.id;
  assert.equal(
    (await request(app).get(`/api/points?eventId=${f.eventId}`).set('x-test-player-id', outsider)).status,
    404,
  );
  const before = wallet(f.eventId, f.players[0]).total;
  const match = await request(app)
    .post('/api/matches')
    .send({ gameId: f.gameId, teams: f.players.slice(0, 2).map((p) => ({ playerIds: [p] })), winnerTeamIndex: 0 });
  assert.equal(match.status, 201);
  assert.equal(wallet(f.eventId, f.players[0]).total, before, 'a sports win creates no points');
  assert.equal(readPointsBalances(DEFAULT_GROUP_ID, f.eventId, f.players[0])!.playing, 4,
    'a sports win earns playing points independently of the legacy wallet');
});

test('returning eligibility funds wallets at the mutation, rolls back failed reactivation and never funds twice', async () => {
  const f = await fixture();
  const roster = [TEST_ADMIN_ID, ...f.players];
  const market = await round(f);
  for (const mode of ['reactivation', 'membership-update', 'membership-insert', 'test-flag'] as const) {
    let playerId: string;
    if (mode === 'membership-insert') {
      playerId = `returning-${sequence}`;
      db.prepare('INSERT INTO players(id,name,api_key,created_at) VALUES(?,?,?,1)')
        .run(playerId, playerId, `key-${playerId}`);
    } else {
      playerId = (await request(app).post('/api/players').send({ name: `Returning ${sequence} ${mode}` })).body.id;
      if (mode === 'reactivation')
        assert.equal((await request(app).post(`/api/players/${playerId}/deactivate`).send({})).status, 204);
      if (mode === 'membership-update') db.prepare("UPDATE group_memberships SET status='left' WHERE player_id=?").run(playerId);
      if (mode === 'test-flag') db.prepare('UPDATE players SET is_test=1 WHERE id=?').run(playerId);
    }
    roster.push(playerId);
    setParticipants(f.eventId, roster);
    assert.equal(wallet(f.eventId, playerId).total, 0, `${mode}: excluded participants are not funded`);
    const history = db.prepare('SELECT * FROM event_participation_history WHERE event_id=? AND player_id=?').get(f.eventId, playerId);
    if (mode === 'reactivation') {
      db.exec(`CREATE TEMP TRIGGER fail_returned_wallet BEFORE INSERT ON points_journal
        BEGIN SELECT RAISE(ABORT,'reactivation wallet failed'); END;`);
      try {
        assert.equal((await request(app).post(`/api/players/${playerId}/reactivate`).send({})).status, 500);
        assert.notEqual(db.prepare('SELECT deactivated_at FROM players WHERE id=?').pluck().get(playerId), null);
        assert.equal(wallet(f.eventId, playerId).total, 0);
      } finally { db.exec('DROP TRIGGER fail_returned_wallet'); }
      const attempts = await Promise.all([0, 1].map(() => request(app).post(`/api/players/${playerId}/reactivate`).send({})));
      assert.deepEqual(attempts.map((r) => r.status).sort(), [204, 404]);
    } else if (mode === 'membership-insert') {
      db.prepare("INSERT INTO group_memberships(group_id,player_id,role,status) VALUES(?,?,'member','active')").run(DEFAULT_GROUP_ID, playerId);
    } else if (mode === 'membership-update') {
      db.prepare("UPDATE group_memberships SET status='active' WHERE player_id=?").run(playerId);
    } else {
      db.prepare('UPDATE players SET is_test=0 WHERE id=?').run(playerId);
    }
    assert.equal(wallet(f.eventId, playerId).total, 100, `${mode}: funded before any read or tip`);
    setActiveEventForPlayer(playerId, f.eventId);
    const read = await request(app).get('/api/points').set('x-test-player-id', playerId);
    assert.equal(read.status, 200);
    assert.deepEqual(read.body.wallet, { total: 100, held: 0, available: 100 });
    assert.equal(read.body.participantCount, roster.length);
    assert.deepEqual(db.prepare('SELECT * FROM event_participation_history WHERE event_id=? AND player_id=?').get(f.eventId, playerId), history);
    assert.equal((await request(app).put(`/api/points/rounds/${market.id}/tip`).set('x-test-player-id', playerId)
      .send({ outcomeId: '0', stake: 5 })).status, 200);
    const journal = readPointsJournal(DEFAULT_GROUP_ID, f.eventId, playerId);
    db.prepare('UPDATE players SET is_test=1 WHERE id=?').run(playerId);
    db.prepare('UPDATE players SET is_test=0 WHERE id=?').run(playerId);
    db.prepare("UPDATE group_memberships SET status='left' WHERE player_id=?").run(playerId);
    db.prepare("UPDATE group_memberships SET status='active' WHERE player_id=?").run(playerId);
    assert.deepEqual(wallet(f.eventId, playerId), { total: 100, held: 5, available: 95 });
    assert.deepEqual(readPointsJournal(DEFAULT_GROUP_ID, f.eventId, playerId), journal, 'returning eligibility preserves reservations and the existing start');
  }
  const closedPlayer = (await request(app).post('/api/players').send({ name: `Returning after close ${sequence}` })).body.id;
  assert.equal((await request(app).post(`/api/players/${closedPlayer}/deactivate`).send({})).status, 204);
  setParticipants(f.eventId, [...roster, closedPlayer]);
  assert.equal((await request(app).post('/api/points/close').send({})).status, 200);
  const frozen = pointStandings(f.eventId);
  const journal = db.prepare('SELECT * FROM points_journal WHERE source_id IN (SELECT id FROM points_sources WHERE event_id=?) ORDER BY id').all(f.eventId);
  assert.equal((await request(app).post(`/api/players/${closedPlayer}/reactivate`).send({})).status, 204);
  assert.equal(wallet(f.eventId, closedPlayer).total, 0, 'closed valuations cannot mint a late start');
  assert.deepEqual(pointStandings(f.eventId), frozen);
  assert.deepEqual(db.prepare('SELECT * FROM points_journal WHERE source_id IN (SELECT id FROM points_sources WHERE event_id=?) ORDER BY id').all(f.eventId), journal);
  const snapshot = db.prepare('SELECT standings FROM points_snapshots WHERE event_id=?').pluck().get(f.eventId);
  db.exec(`CREATE TEMP TRIGGER fail_reopened_wallet BEFORE INSERT ON points_journal
    WHEN NEW.title='Wett-Startguthaben' BEGIN SELECT RAISE(ABORT,'reopened wallet failed'); END;`);
  try {
    assert.equal((await request(app).post('/api/points/reopen').send({ reason: 'Returning participant' })).status, 500);
    assert.notEqual(db.prepare('SELECT closed_at FROM points_settings WHERE event_id=?').pluck().get(f.eventId), null);
    assert.equal(wallet(f.eventId, closedPlayer).total, 0);
  } finally { db.exec('DROP TRIGGER fail_reopened_wallet'); }
  const reopens = await Promise.all([0, 1].map(() => request(app).post('/api/points/reopen').send({ reason: 'Returning participant' })));
  assert.deepEqual(reopens.map((r) => r.status).sort(), [200, 409]);
  assert.equal(wallet(f.eventId, closedPlayer).total, 100, 'reopening funds participants whose eligibility returned while frozen');
  assert.deepEqual(db.prepare('SELECT standings FROM points_snapshots WHERE event_id=?').pluck().get(f.eventId), snapshot);
});

test('leaderboard filters and cross-event totals use game points without mixing configured LAN wallets', async () => {
  const f = await fixture();
  const gameMatch = async (gameId: string, winnerTeamIndex: number) => {
    const response = await request(app).post('/api/matches').send({
      gameId, teams: f.players.slice(0, 2).map((id) => ({ playerIds: [id] })), winnerTeamIndex,
    });
    assert.equal(response.status, 201);
  };
  await gameMatch(f.gameId, 0);
  const neverPlayed = await request(app).post('/api/games').send({ name: `Unplayed points filter ${sequence}` });
  assert.equal(neverPlayed.status, 201);
  const secondEvent = createEvent(`Unconfigured scoring ${sequence}`, {
    groupId: DEFAULT_GROUP_ID, startsAt: Date.now(), endsAt: Date.now() + 86400000,
  });
  setParticipants(secondEvent.id, [TEST_ADMIN_ID, ...f.players]);
  setActiveEventForPlayer(TEST_ADMIN_ID, secondEvent.id);
  const secondGame = await request(app).post('/api/games').send({ name: `Second scoring game ${sequence}` });
  assert.equal(secondGame.status, 201);
  await gameMatch(secondGame.body.id, 1);
  const scores = async (query: string) => {
    const response = await request(app).get(`/api/leaderboard${query}`).set('x-test-player-id', f.players[0]);
    assert.equal(response.status, 200);
    return response.body.standings.filter((row: { playerId: string }) => f.players.includes(row.playerId))
      .sort((a: { playerId: string }, b: { playerId: string }) => f.players.indexOf(a.playerId) - f.players.indexOf(b.playerId));
  };
  assert.deepEqual(await scores(`?eventId=${f.eventId}&gameId=${neverPlayed.body.id}`), []);
  assert.deepEqual((await scores(`?eventId=${f.eventId}&gameId=${f.gameId}`)).map((row: { points: number }) => row.points), [4, 1]);
  assert.deepEqual((await scores(`?gameId=${f.gameId}`)).map((row: { points: number }) => row.points), [4, 1]);
  assert.deepEqual((await scores(`?gameId=${secondGame.body.id}`)).map((row: { points: number }) => row.points), [1, 4]);
  assert.deepEqual((await scores('')).map((row: { points: number; wins: number; matchesPlayed: number }) =>
    [row.points, row.wins, row.matchesPlayed]), [[5, 1, 2], [5, 1, 2]]);
  assert.deepEqual((await scores(`?eventId=${f.eventId}`)).map((row: { points: number }) => row.points), [4, 3, 0],
    'the explicit LAN view shows category place points, never spendable wallet balances');
  assert.equal((await request(app).patch(`/api/events/${f.eventId}/points-visibility`)
    .send({ visible: false, revision: 1 })).status, 200);
  assert.deepEqual(await scores(`?eventId=${f.eventId}&gameId=${f.gameId}`), []);
  assert.deepEqual(await scores(`?gameId=${f.gameId}`), []);
  assert.deepEqual((await scores('')).map((row: { points: number }) => row.points), [1, 4]);
});

test('category readers share participant-based places, exclude test accounts outside test events and withdrawn entrants, and freeze N with the result', async () => {
  const f = await fixture();
  const ids = [TEST_ADMIN_ID, ...f.players];
  for (const [account, totals] of [['orga', [8, 4, 4, 0]], ['playing', [4, 8, 4, 0]], ['betting', [0, 0, 0, 100]]] as const)
    recordPointsEntitlements(ids.map((playerId, index) => ({ groupId: DEFAULT_GROUP_ID, eventId: f.eventId,
      playerId, account, sourceKey: `fixture:category:${account}`, total: totals[index], expectedRevision: 0,
      title: 'Category reader fixture' })));
  const own = () => request(app).get(`/api/points?eventId=${f.eventId}`);
  const initial = (await own()).body;
  assert.equal(initial.participantCount, 4);
  assert.deepEqual(initial.standings.map((row: { points: number; rank: number }) => [row.points, row.rank]),
    [[7, 1], [7, 1], [6, 3], [0, 4]]);
  assert.deepEqual(initial.standings.find((row: { playerId: string }) => row.playerId === f.players[2]).categories.betting,
    { raw: 100, rank: null, placePoints: 0 }, 'positive betting net alone cannot bypass the two-settlement minimum');
  const comparable = (rows: Array<{ playerId: string; points: number; rank: number; categories: unknown }>) =>
    rows.map(({ playerId, points, rank, categories }) => ({ playerId, points, rank, categories }));
  assert.deepEqual(comparable((await request(app).get(`/api/leaderboard?eventId=${f.eventId}`)).body.standings), comparable(initial.standings));
  const hall = (await request(app).get(`/api/hall-of-fame?eventId=${f.eventId}`)).body.events[0];
  assert.deepEqual(comparable(hall.overallStandings), comparable(initial.standings));
  assert.equal(hall.overallChampions.length, 2);
  assert.equal(hall.categoryChampions.orga[0].playerId, TEST_ADMIN_ID);
  const exported = (await request(app).get(`/api/export?eventId=${f.eventId}`)).body;
  assert.equal(exported.scoringModel, 'category_place_points');
  assert.equal(exported.participantCount, 4);
  assert.deepEqual(comparable(exported.leaderboard), comparable(initial.standings));
  const late = (await request(app).post('/api/players').send({ name: `Late category entrant ${sequence}` })).body.id;
  setParticipants(f.eventId, [...ids, late]);
  const expanded = (await own()).body;
  assert.equal(expanded.participantCount, 5);
  assert.equal(expanded.categoryStanding.points, 9, 'late entrants change N equally for all categories');
  db.prepare('UPDATE players SET is_test=1 WHERE id=?').run(late);
  assert.equal((await own()).body.participantCount, 4, 'test accounts never count, including in admin mode');
  db.prepare('UPDATE players SET is_test=0 WHERE id=?').run(late);
  setParticipants(f.eventId, [TEST_ADMIN_ID, f.players[0], f.players[2], late]);
  const departed = (await own()).body;
  assert.equal(departed.participantCount, 4);
  assert.ok(!departed.standings.some((row: { playerId: string }) => row.playerId === f.players[1]));
  assert.equal(readPointsBalances(DEFAULT_GROUP_ID, f.eventId, f.players[1])!.orga, 4, 'withdrawal retains journal history');
  for (const status of ['draft', 'cancelled'] as const) {
    db.prepare('UPDATE events SET status=? WHERE id=?').run(status, f.eventId);
    assert.deepEqual(pointStandings(f.eventId), []);
    assert.equal(pointsAreVisible(f.eventId), false);
  }
  db.prepare("UPDATE events SET status='published',is_test=1 WHERE id=?").run(f.eventId);
  assert.equal((await own()).status, 404, 'a test event stays hidden outside Admin mode');
  const rehearsal = (await request(app).post('/api/players').send({ name: `Rehearsal identity ${sequence}` })).body.id;
  db.prepare('UPDATE players SET is_test=1 WHERE id=?').run(rehearsal);
  setParticipants(f.eventId, [TEST_ADMIN_ID, f.players[0], f.players[2], late, rehearsal]);
  assert.equal(wallet(f.eventId, rehearsal).total, 100, 'a test identity is funded in a test event');
  const rehearsed = (await own().set('x-admin-mode', '1')).body;
  assert.equal(rehearsed.participantCount, 5, 'test events score their test identities for rehearsals');
  assert.ok(rehearsed.standings.some((row: { playerId: string }) => row.playerId === rehearsal));
  setParticipants(f.eventId, [TEST_ADMIN_ID, f.players[0], f.players[2], late]);
  db.prepare("UPDATE events SET status='ended',is_test=0 WHERE id=?").run(f.eventId);
  assert.deepEqual((await own()).body.standings, departed.standings, 'ended LAN results remain visible');
  recordPointsEntitlements([{ groupId: DEFAULT_GROUP_ID, eventId: f.eventId, playerId: TEST_ADMIN_ID,
    account: 'orga', sourceKey: 'fixture:category:orga', total: 0, expectedRevision: 1,
    title: 'Category reader fixture', reason: 'Prepare a unique final leader' }]);
  assert.equal((await request(app).post(`/api/points/close?eventId=${f.eventId}`).send({})).status, 200);
  const frozen = (await own()).body;
  setParticipants(f.eventId, [TEST_ADMIN_ID]);
  assert.deepEqual((await own()).body.standings, frozen.standings);
  assert.equal((await own()).body.participantCount, 4, 'the closing roster and N survive later withdrawals');
  db.prepare('UPDATE players SET deactivated_at=? WHERE id=?').run(Date.now(), f.players[0]);
  const remaining = (await own()).body;
  assert.equal(remaining.participantCount, 4);
  assert.equal(remaining.standings[0].rank, 2, 'removing a closed account must not renumber the frozen places');
  const remainingHall = (await request(app).get(`/api/hall-of-fame?eventId=${f.eventId}`)).body.events[0];
  assert.equal(remainingHall.overallStandings[0].rank, 2);
  assert.deepEqual(remainingHall.overallChampions, []);
});

test('admins and event creators toggle visibility without interrupting hidden credits or settled pools', async () => {
  const f = await fixture({}, false);
  const [creator, opponent] = f.players;
  db.prepare('UPDATE events SET created_by = ? WHERE id = ?').run(creator, f.eventId);
  const visibility = (visible: unknown, revision: number, actor = TEST_ADMIN_ID) =>
    request(app).patch(`/api/events/${f.eventId}/points-visibility`).set('x-test-player-id', actor).send({ visible, revision });
  assert.equal(wallet(f.eventId, creator).total, 100);
  assert.equal((await request(app).get('/api/events')).body.activeEvent.pointsEnabled, false);
  assert.equal((await request(app).get('/api/points').set('x-test-player-id', creator)).status, 403);
  assert.equal((await visibility(true, 0, opponent)).status, 403);
  assert.equal((await visibility('true', 0)).status, 400);
  const task = await request(app).post('/api/checklist/tasks/todo').send({ playerId: TEST_ADMIN_ID, type: 'todo', title: 'Hidden helper task' });
  const taskId = task.body.tasks[0].id;
  await request(app).post(`/api/checklist/tasks/${taskId}/claim`).set('x-test-player-id', creator).send({ playerId: creator });
  const done = await request(app).patch(`/api/checklist/tasks/${taskId}/done`).set('x-test-player-id', creator).send({ playerId: creator });
  assert.equal(done.status, 200);
  assert.equal(done.body.reward, null, 'a hidden reward is not disclosed by a task mutation');
  assert.equal(wallet(f.eventId, creator).total, 100, 'orga credits never fund the wallet');
  assert.equal(readPointsBalances(DEFAULT_GROUP_ID, f.eventId, creator)!.orga, 3, 'hidden tasks credit the category immediately');
  const reveals = await Promise.all([0, 1].map(() => visibility(true, 0, creator)));
  assert.deepEqual(reveals.map((r) => r.status).sort(), [200, 409]);
  assert.equal((await request(app).get('/api/points').set('x-test-player-id', creator)).body.wallet.total, 100);
  const r = await round(f);
  for (const [index, playerId] of [creator, opponent].entries()) {
    assert.equal((await request(app).put(`/api/points/rounds/${r.id}/tip`).set('x-test-player-id', playerId)
      .send({ outcomeId: r.outcomes[index].id, stake: 5 })).status, 200);
  }
  await request(app).post(`/api/points/rounds/${r.id}/lock`).send({});
  assert.equal((await visibility(false, 1)).status, 200);
  assert.equal(wallet(f.eventId, creator).held, 5, 'hiding retains existing reservations');
  assert.equal((await request(app).put(`/api/points/rounds/${r.id}/tip`).set('x-test-player-id', creator)
    .send({ outcomeId: r.outcomes[0].id, stake: 5 })).status, 403);
  assert.equal((await request(app).get('/api/push/log').set('x-test-player-id', creator)).body.entries.some(
    (entry: { notificationType: string }) => entry.notificationType === 'betting-open'), false);
  const result = await request(app).post('/api/matches').send({ gameId: f.gameId, drawId: r.drawId,
    teams: r.outcomes.map((o) => ({ playerIds: o.playerIds })), winnerTeamIndex: 0 });
  assert.equal(result.status, 201, JSON.stringify(result.body));
  assert.deepEqual([wallet(f.eventId, creator).total, wallet(f.eventId, opponent).total], [105, 95]);
  const hidden = await request(app).get('/api/points');
  assert.equal(hidden.body.rounds[0].status, 'settled', 'reconciliation continues while hidden');
  assert.deepEqual((await request(app).get(`/api/export?eventId=${f.eventId}`)).body.leaderboard, [], 'keepsake exports do not disclose hidden standings');
  assert.equal((await request(app).get('/api/points').set('x-test-player-id', creator)).status, 403);
  assert.equal((await visibility(true, 2, creator)).status, 200);
  const restored = await request(app).get('/api/points').set('x-test-player-id', creator);
  assert.equal(restored.body.wallet.total, 105);
  assert.deepEqual(restored.body.entries.map((entry: { source: string }) => entry.source), ['start', 'reservation', 'tip']);
  assert.equal((await visibility(false, 2)).status, 409, 'a stale toggle cannot overwrite a newer choice');
  db.prepare('DELETE FROM event_participants WHERE event_id = ? AND player_id = ?').run(f.eventId, creator);
  const creatorContext = (await request(app).get('/api/events').set('x-test-player-id', creator)).body;
  const creatorControl = creatorContext.pointsVisibilityEvents.find((event: { id: string }) => event.id === f.eventId);
  assert.ok(creatorControl, 'the creator retains the visibility control without participation');
  assert.equal(creatorControl.acceptedParticipants, undefined, 'the visibility exception does not expose a roster');
  assert.equal((await visibility(false, 3, creator)).status, 200);
});

test('new todo rewards use one foreign helper, preserve corrections until reopening, and never fund the wallet', async () => {
  const f = await fixture();
  const [a, b] = f.players;
  for (const pointsValue of [0, 6, 1.5, '3']) {
    const fixed = await request(app).post('/api/checklist/tasks/todo').send({ title: 'Ignored old amount', pointsValue });
    assert.equal(fixed.status, 201);
    assert.equal(fixed.body.tasks[0].pointsValue, 3);
  }
  const created = await request(app).post('/api/checklist/tasks/todo').send({ title: 'New category task', pointsValue: 5 });
  assert.equal(created.status, 201);
  const id = created.body.tasks[0].id;
  const market = await round(f);
  assert.equal((await request(app).put(`/api/points/rounds/${market.id}/tip`).set('x-test-player-id', a).send({ outcomeId: market.outcomes[0].id, stake: 5 })).status, 200);
  const source = { groupId: DEFAULT_GROUP_ID, eventId: f.eventId, playerId: a, account: 'orga' as const, sourceKey: `todo:${id}` };
  assert.equal((await request(app).post(`/api/points/tasks/${id}/reward`).send({ perPerson: 5, slots: 2 })).status, 409);
  const claim = (playerId: string) => request(app).post(`/api/checklist/tasks/${id}/claim`).send({ playerId });
  assert.equal((await claim(TEST_ADMIN_ID)).status, 200, 'creators may help but receive no reward');
  assert.equal((await claim(a)).status, 200);
  const claims = await Promise.all([claim(a), claim(b)]);
  assert.deepEqual(claims.map((r) => r.status).sort(), [200, 409]);
  const attemptedChange = await request(app).patch(`/api/checklist/tasks/${id}`).send({ pointsValue: 4 });
  assert.equal(attemptedChange.status, 200);
  assert.equal(attemptedChange.body.tasks[0].pointsValue, 3);
  const done = () => request(app).patch(`/api/checklist/tasks/${id}/done`).send({ playerId: b });
  const completions = await Promise.all([done(), done()]);
  assert.deepEqual(completions.map((r) => r.status).sort(), [200, 409]);
  assert.equal(readPointsSource(source)!.total, 3);
  assert.equal(readPointsBalances(DEFAULT_GROUP_ID, f.eventId, TEST_ADMIN_ID)!.orga, 0);
  assert.equal(readPointsBalances(DEFAULT_GROUP_ID, f.eventId, b)!.orga, 0);
  assert.equal(wallet(f.eventId, a).total, 100);
  assert.equal(wallet(f.eventId, a).held, 5, 'an existing market reservation survives the new todo credit unchanged');
  assert.equal((db.prepare("SELECT COUNT(*) AS n FROM point_entries WHERE event_id = ? AND source = 'task'").get(f.eventId) as { n: number }).n, 0);
  const entry = db.prepare(`SELECT j.id FROM points_journal j JOIN points_sources s ON s.id=j.source_id
    WHERE s.event_id=? AND s.source_key=? AND s.player_id=?`).get(f.eventId, source.sourceKey, a) as { id: string };
  assert.equal((await request(app).post(`/api/points/admin/journal/${entry.id}/correct`).send({ total: 2, revision: 1, reason: 'Manuell korrigiert' })).status, 200);
  syncOrgaPoints(DEFAULT_GROUP_ID, f.eventId);
  assert.equal(readPointsSource(source)!.total, 2, 'unchanged work retains the manual correction');
  const reopen = () => request(app).patch(`/api/checklist/tasks/${id}/reopen`).send({ playerId: a });
  const reopened = await Promise.all([reopen(), reopen()]);
  assert.deepEqual(reopened.map((r) => r.status).sort(), [200, 409]);
  assert.equal(readPointsSource(source)!.total, 0);
  assert.equal((await done()).status, 200);
  assert.equal(readPointsSource(source)!.total, 3, 'recompletion replaces the claim instead of adding another reward');
  const ownExport = buildPersonalDataExport(a);
  assert.ok(JSON.stringify(ownExport).includes(source.sourceKey));
  assert.ok(JSON.stringify(ownExport).includes('"pointsModel":"category"'));
  assert.equal((await request(app).post(`/api/points/rounds/${market.id}/refund`).send({ reason: 'Bestehenden Einsatz vollständig erhalten' })).status, 200);
  assert.equal((await request(app).patch(`/api/events/${f.eventId}/points-visibility`).send({ visible: false, revision: 1 })).status, 200);
  const hidden = await request(app).get('/api/checklist/tasks').set('x-test-player-id', a);
  assert.equal(hidden.body.tasks.find((t: { id: string }) => t.id === id).pointsValue, null);
});

test('todo batches pay once, preserve historical work and promises, and roll back checklist state on journal errors', async () => {
  const f = await fixture();
  const [a, b] = f.players;
  const created = await request(app).post('/api/checklist/tasks/todo').send({ title: 'Direct batch', pointsValue: 3, assigneePlayerIds: [TEST_ADMIN_ID, a, b] });
  assert.equal(created.status, 201);
  const tasks = created.body.tasks as Array<{ id: string; assignee: { id: string }; batchId: string }>;
  const taskA = tasks.find((t) => t.assignee.id === a)!;
  const taskB = tasks.find((t) => t.assignee.id === b)!;
  const key = `todo:batch:${taskA.batchId}`;
  const source = { groupId: DEFAULT_GROUP_ID, eventId: f.eventId, playerId: a, account: 'orga' as const, sourceKey: key };
  assert.equal((await request(app).patch(`/api/checklist/tasks/${taskB.id}/done`).send({ playerId: b })).status, 200);
  assert.equal(readPointsBalances(DEFAULT_GROUP_ID, f.eventId, b)!.orga, 0, 'the second direct assignee cannot take the first helper reward');
  db.exec(`CREATE TEMP TRIGGER fail_todo_booking BEFORE INSERT ON points_journal
    WHEN NEW.title LIKE 'Aufgabe erledigt:%' BEGIN SELECT RAISE(ABORT,'todo journal failure'); END`);
  try {
    assert.equal((await request(app).patch(`/api/checklist/tasks/${taskA.id}/done`).send({ playerId: a })).status, 500);
    assert.equal((db.prepare('SELECT status FROM checklist_tasks WHERE id=?').get(taskA.id) as { status: string }).status, 'taken');
    assert.equal(readPointsSource(source)!.total, 0);
  } finally { db.exec('DROP TRIGGER fail_todo_booking'); }
  assert.equal((await request(app).patch(`/api/checklist/tasks/${taskA.id}/done`).send({ playerId: a })).status, 200);
  assert.equal(readPointsSource(source)!.total, 3);
  db.exec(`CREATE TEMP TRIGGER fail_todo_reopen BEFORE INSERT ON points_journal
    WHEN NEW.amount < 0 BEGIN SELECT RAISE(ABORT,'todo reversal failure'); END`);
  try {
    assert.equal((await request(app).patch(`/api/checklist/tasks/${taskA.id}/reopen`).send({ playerId: a })).status, 500);
    assert.equal((db.prepare('SELECT status FROM checklist_tasks WHERE id=?').get(taskA.id) as { status: string }).status, 'done');
    assert.equal(readPointsSource(source)!.total, 3);
  } finally { db.exec('DROP TRIGGER fail_todo_reopen'); }
  assert.equal((await request(app).patch(`/api/checklist/tasks/${taskA.id}/reopen`).send({ playerId: a })).status, 200);
  assert.equal(readPointsSource(source)!.total, 0);
  assert.equal((await request(app).post(`/api/checklist/tasks/${taskA.id}/release`).send({ playerId: a })).status, 200);
  assert.equal(readPointsSource({ ...source, playerId: b })!.total, 3);
  assert.equal(readPointsSource(source)!.total, 0, 'a batch never pays two people at once');
  const old = await request(app).post('/api/checklist/tasks/todo').send({ title: 'Historical completed task', assigneePlayerIds: [a] });
  const oldId = old.body.tasks[0].id;
  db.prepare("UPDATE checklist_tasks SET points_value=0,points_model='legacy',status='done',done_at=1 WHERE id=?").run(oldId);
  syncOrgaPoints(DEFAULT_GROUP_ID, f.eventId);
  assert.equal(readPointsSource({ ...source, sourceKey: `todo:${oldId}` })!.total, 0);
  const reopenedOld = await request(app).patch(`/api/checklist/tasks/${oldId}/reopen`).send({ playerId: a });
  assert.equal(reopenedOld.status, 200);
  assert.equal(reopenedOld.body.pointsValue, 0);
  assert.equal((await request(app).patch(`/api/checklist/tasks/${oldId}/done`).send({ playerId: a })).status, 200);
  assert.equal(readPointsSource({ ...source, sourceKey: `todo:${oldId}` })!.total, 0, 'reopening a historical task does not convert it to a new reward');
  const requestTask = await request(app).post('/api/checklist/tasks').send({ title: 'Bring a cable', assigneePlayerIds: [a], pointsValue: 5 });
  const requestId = requestTask.body.tasks[0].id;
  assert.equal((await request(app).post(`/api/points/tasks/${requestId}/reward`).send({ perPerson: 5, slots: 1 })).status, 409);
  assert.equal((await request(app).patch(`/api/checklist/tasks/${requestId}/done`).send({ playerId: a })).status, 200);
  assert.equal(readPointsSource({ ...source, sourceKey: `todo:${requestId}` })!.total, 0);
  const own = await request(app).post('/api/checklist/tasks/todo').send({ title: 'My own task', assigneePlayerIds: [TEST_ADMIN_ID], pointsValue: 5 });
  assert.equal((await request(app).patch(`/api/checklist/tasks/${own.body.tasks[0].id}/done`).send({})).status, 200);
  assert.equal(readPointsBalances(DEFAULT_GROUP_ID, f.eventId, TEST_ADMIN_ID)!.orga, 0);
  const unclaimed = await request(app).post('/api/checklist/tasks/todo').send({ title: 'Change before claiming' });
  const id = unclaimed.body.tasks[0].id;
  const edits = await Promise.all([2, 4].map((pointsValue) => request(app).patch(`/api/checklist/tasks/${id}`).send({ pointsValue, expectedPointsValue: 1 })));
  assert.ok(edits.every((r) => r.status === 200));
  assert.ok(edits.every((r) => r.body.tasks[0].pointsValue === 3), 'old client choices cannot change the fixed reward');
  assert.equal((await request(app).post(`/api/checklist/tasks/${id}/claim`).send({ playerId: a })).status, 200);
  const releases = await Promise.all([a, a].map((playerId) => request(app).post(`/api/checklist/tasks/${id}/release`).send({ playerId })));
  assert.deepEqual(releases.map((r) => r.status).sort(), [200, 403]);
  const cancellations = await Promise.all([0, 1].map(() => request(app).delete(`/api/checklist/tasks/${id}`).send({})));
  assert.deepEqual(cancellations.map((r) => r.status).sort(), [204, 409]);
  const transition = await request(app).post('/api/checklist/tasks/todo').send({ title: 'Historical open task at cutover' });
  const transitionId = transition.body.tasks[0].id;
  const producers = await Promise.all([
    request(app).post(`/api/points/tasks/${transitionId}/reward`).send({ perPerson: 5, slots: 1 }),
    request(app).patch(`/api/checklist/tasks/${transitionId}`).send({ pointsValue: 3, expectedPointsValue: 0 }),
  ]);
  assert.equal(producers.filter((r) => r.status >= 200 && r.status < 300).length, 1);
  assert.equal(producers.filter((r) => r.status === 409).length, 1, 'old and category promises are mutually exclusive');
  assert.equal((await request(app).post(`/api/checklist/tasks/${transitionId}/claim`).send({ playerId: a })).status, 200);
  assert.equal((await request(app).patch(`/api/checklist/tasks/${transitionId}/done`).send({ playerId: a })).status, 200);
  const newModel = producers[1].status === 200;
  assert.equal(readPointsSource({ ...source, sourceKey: `todo:${transitionId}` })!.total, newModel ? 3 : 0);
  assert.equal(wallet(f.eventId, a).total, newModel ? 100 : 105);
  const closedTask = await request(app).post('/api/checklist/tasks/todo').send({ title: 'Complete while valuation is frozen', assigneePlayerIds: [a], pointsValue: 2 });
  const closedId = closedTask.body.tasks[0].id;
  assert.equal((await request(app).post('/api/points/close').send({})).status, 200);
  const frozen = db.prepare('SELECT * FROM points_journal ORDER BY id').all();
  const closedCompletions = await Promise.all([0, 1].map(() => request(app).patch(`/api/checklist/tasks/${closedId}/done`).send({ playerId: a })));
  assert.deepEqual(closedCompletions.map((r) => r.status).sort(), [200, 409]);
  assert.deepEqual(db.prepare('SELECT * FROM points_journal ORDER BY id').all(), frozen);
});

test('retired task rewards and entry deductions cannot mint or remove wallet funds', async () => {
  const f = await fixture();
  const task = await request(app).post('/api/checklist/tasks/todo').send({ title: 'Old financial client' });
  const id = task.body.tasks[0].id;
  legacyPromise(id, 5, 2);
  const claims = await Promise.all(f.players.map((playerId) =>
    request(app).post(`/api/checklist/tasks/${id}/claim`).send({ playerId })));
  assert.ok(claims.every((response) => response.status === 200));
  const done = await Promise.all([0, 1].map(() => request(app).patch(`/api/checklist/tasks/${id}/done`).send({ playerId: f.players[0] })));
  assert.deepEqual(done.map((response) => response.status).sort(), [200, 409]);
  assert.deepEqual(f.players.map((playerId) => wallet(f.eventId, playerId).total), [100, 100, 100]);
  const entry = readPointsJournal(DEFAULT_GROUP_ID, f.eventId, f.players[0]).find((entry) => entry.account === 'wallet')!;
  const deductions = await Promise.all([0, 1].map(() => request(app).post(`/api/points/entries/${entry.id}/deduct`)
    .send({ amount: 3, reason: 'Old financial route', requestId: 'same' })));
  assert.deepEqual(deductions.map((response) => response.status), [409, 409]);
  assert.equal((await request(app).post(`/api/points/entries/${entry.id}/deduct`).set('x-test-player-id', f.players[0])
    .send({ amount: 3, reason: 'Member' })).status, 403);
  assert.equal((await request(app).patch(`/api/checklist/tasks/${id}/reopen`).send({ playerId: f.players[0] })).status, 200);
  assert.equal((await request(app).post(`/api/points/tasks/${id}/reward`).send({ perPerson: 5, slots: 1 })).status, 409);
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM point_entries WHERE event_id=?').get(f.eventId) as { n: number }).n, 0);
});

test('rank-only results and conflicting winner corrections settle zero-sum, once, with a personal notification', async (t) => {
  const f = await fixture();
  const r = await round(f);
  const a = f.players[0],
    b = f.players[1];
  db.exec(`CREATE TEMP TRIGGER fail_tip_wallet BEFORE INSERT ON points_journal
    WHEN NEW.amount<0 BEGIN SELECT RAISE(ABORT,'tip wallet failed'); END;`);
  try {
    assert.equal((await request(app).put(`/api/points/rounds/${r.id}/tip`).set('x-test-player-id', a)
      .send({ outcomeId: '0', stake: 10 })).status, 500);
    assert.deepEqual(wallet(f.eventId, a), { total: 100, held: 0, available: 100 });
    assert.equal(db.prepare('SELECT 1 FROM betting_tips WHERE round_id=? AND player_id=?').get(r.id, a), undefined);
  } finally { db.exec('DROP TRIGGER fail_tip_wallet'); }
  const bets = await Promise.all([
    request(app).put(`/api/points/rounds/${r.id}/tip`).set('x-test-player-id', a).send({ outcomeId: '0', stake: 10 }),
    request(app).put(`/api/points/rounds/${r.id}/tip`).set('x-test-player-id', b).send({ outcomeId: '1', stake: 5 }),
  ]);
  assert.ok(
    bets.every((v) => v.status === 200),
    JSON.stringify(bets.map((v) => v.body)),
  );
  const preview = (await request(app).get('/api/points').set('x-test-player-id', a)).body.rounds[0];
  assert.equal(preview.pot, 15);
  assert.equal(preview.tipCount, 2);
  assert.deepEqual(preview.outcomes.map((o: { myPossiblePayout: number | null }) => o.myPossiblePayout), [15, null, null]);
  assert.deepEqual(preview.outcomes.map((o: { stake: number; odds: number | null }) => [o.stake, o.odds]),
    [[10, 1.5], [5, 2], [0, null]]);
  assert.deepEqual(wallet(f.eventId, a), { total: 100, held: 10, available: 90 });
  const { id: tipId } = db.prepare('SELECT id FROM betting_tips WHERE round_id=? AND player_id=?').get(r.id, a) as { id: string };
  for (const target of [{ targetType: 'betting_round', targetId: r.id }, { targetType: 'tip', targetId: tipId }])
    assert.throws(() => createPointsReport(DEFAULT_GROUP_ID, f.eventId, a, target),
      (error: unknown) => error instanceof PointsError && error.status === 404,
      'an unsettled bet is not an awarded result even when its stake is reserved');
  const messages = db
    .prepare("SELECT player_ids,url FROM push_log WHERE notification_type = 'betting-open' AND target_id = ?")
    .all(r.id) as Array<{ player_ids: string; url: string }>;
  assert.equal(messages.length, 1);
  assert.ok(JSON.parse(messages[0].player_ids).includes(a), 'own players receive the message');
  assert.ok(messages[0].url.includes(r.id));
  assert.ok(messages[0].url.includes(`eventId=${f.eventId}`));
  const locks = await Promise.all(
    [0, 1].map(() => request(app).post(`/api/points/rounds/${r.id}/lock`).set('x-test-player-id', a).send({})),
  );
  assert.deepEqual(locks.map((v) => v.status).sort(), [200, 409]);
  assert.equal(
    (
      await request(app)
        .put(`/api/points/rounds/${r.id}/tip`)
        .set('x-test-player-id', a)
        .send({ outcomeId: '1', stake: 10 })
    ).status,
    409,
  );
  db.exec(`CREATE TEMP TRIGGER fail_settlement_net BEFORE INSERT ON points_journal
    WHEN (SELECT account FROM points_sources WHERE id=NEW.source_id)='betting'
    BEGIN SELECT RAISE(ABORT,'settlement net failed'); END;`);
  try {
    assert.equal((await request(app).post('/api/matches').send({ gameId: f.gameId, drawId: r.drawId,
      teams: r.outcomes.map((o) => ({ playerIds: o.playerIds })), winnerTeamIndex: 0 })).status, 500);
    assert.deepEqual(wallet(f.eventId, a), { total: 100, held: 10, available: 90 });
    assert.equal((await request(app).get('/api/points')).body.rounds[0].status, 'locked');
    assert.equal(db.prepare('SELECT 1 FROM matches WHERE id=(SELECT match_id FROM matchmaking_draws WHERE id=?)').get(r.drawId), undefined);
  } finally { db.exec('DROP TRIGGER fail_settlement_net'); }
  const result = await request(app)
    .post('/api/matches')
    .send({
      gameId: f.gameId,
      drawId: r.drawId,
      teams: r.outcomes.map((o, index) => ({ playerIds: o.playerIds, rank: index + 1 })),
    });
  assert.equal(result.status, 201, JSON.stringify(result.body));
  await Promise.all([request(app).get('/api/points'), request(app).get('/api/points')]);
  assert.equal(wallet(f.eventId, a).total, 105);
  assert.equal(wallet(f.eventId, b).total, 95);
  assert.equal(wallet(f.eventId, a).held, 0);
  assert.deepEqual([a, b].map((playerId) => readPointsBalances(DEFAULT_GROUP_ID, f.eventId, playerId)!.betting), [5, -5]);
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM point_entries WHERE event_id=?').get(f.eventId) as { n: number }).n, 0,
    'settlement has exactly one financial producer');
  assert.equal(
    (
      await request(app)
        .post('/api/points/rounds')
        .send({ sourceType: 'draw', sourceId: r.drawId, closesAt: Date.now() + 60000 })
    ).status,
    409,
  );
  assert.equal(
    (await request(app).patch(`/api/matches/${result.body.id}`).send({ winnerTeamIndex: 1 })).status,
    409,
    'paid pools prevent silently changing a result',
  );
  db.prepare("UPDATE group_memberships SET role = 'admin' WHERE group_id = ? AND player_id = ?").run(DEFAULT_GROUP_ID, a);
  t.after(() => db.prepare("UPDATE group_memberships SET role = 'member' WHERE group_id = ? AND player_id = ?").run(DEFAULT_GROUP_ID, a));
  const corrections = await Promise.all(
    [0, 1].map(() =>
      request(app)
        .patch(`/api/matches/${result.body.id}`)
        .set('x-test-player-id', a)
        .send({
          teams: r.outcomes.map((o, index) => ({ playerIds: o.playerIds, rank: 2 - index })),
          winnerTeamIndex: 0, // Complete placements override this conflicting legacy field.
          bettingCorrection: { reason: 'Actually the other team won', revisions: [{ id: r.id, revision: 0 }] },
        }),
    ),
  );
  assert.deepEqual(corrections.map((v) => v.status).sort(), [200, 409]);
  assert.equal(wallet(f.eventId, a).total, 95);
  assert.equal(wallet(f.eventId, b).total, 105);
  assert.equal((await request(app).get('/api/points')).body.rounds[0].revision, 1);
  assert.deepEqual((await request(app).get('/api/points').set('x-test-player-id', a)).body.bettingParticipation,
    { settledTips: 1, minimumTips: 2, hasMinimum: false });
  assert.equal((await request(app).get('/api/points').set('x-test-player-id', b)).body.categoryStanding.categories.betting.rank, null);
  db.exec(`CREATE TEMP TRIGGER fail_void_audit BEFORE INSERT ON admin_log
    WHEN NEW.action = 'betting_settlement_voided' BEGIN SELECT RAISE(ABORT, 'test void audit failure'); END;`);
  try {
    assert.equal((await request(app).post(`/api/points/rounds/${r.id}/void`).set('x-test-player-id', a)
      .send({ reason: 'Audit muss atomar sein', revision: 1 })).status, 500);
    assert.deepEqual([wallet(f.eventId, a).total, wallet(f.eventId, b).total], [95, 105]);
    assert.equal((await request(app).get('/api/points')).body.rounds[0].revision, 1);
  } finally {
    db.exec('DROP TRIGGER fail_void_audit');
  }
  const voids = await Promise.all(
    [0, 1].map(() =>
      request(app).post(`/api/points/rounds/${r.id}/void`).set('x-test-player-id', a).send({ reason: 'Invalid game', revision: 1 }),
    ),
  );
  assert.deepEqual(voids.map((v) => v.status).sort(), [200, 409]);
  assert.equal(wallet(f.eventId, a).total, 100);
  assert.equal(wallet(f.eventId, b).total, 100);
  assert.equal((await request(app).patch(`/api/matches/${result.body.id}`).send({ winnerTeamIndex: 1 })).status, 200);
  assert.equal((await request(app).get('/api/points')).body.rounds[0].status, 'refunded');
  assert.deepEqual((await request(app).get('/api/points').set('x-test-player-id', a)).body.bettingParticipation,
    { settledTips: 0, minimumTips: 2, hasMinimum: false });
});

test('stake-capped markets refund unused losing stakes and preserve historical policies through corrections', async () => {
  for (const policy of ['stake_cap_v1', 'pool_v1']) {
    const f = await fixture();
    const r = await round(f);
    const [a, b] = f.players;
    if (policy === 'pool_v1')
      db.prepare('UPDATE betting_rounds SET payout_policy=? WHERE id=?').run(policy, r.id);
    for (const [index, playerId] of [a, b].entries())
      assert.equal((await request(app).put(`/api/points/rounds/${r.id}/tip`).set('x-test-player-id', playerId)
        .send({ outcomeId: String(index), stake: index === 0 ? 1 : 15 })).status, 200);
    const preview = (await request(app).get('/api/points').set('x-test-player-id', a)).body.rounds.find((row: { id: string }) => row.id === r.id);
    assert.equal(preview.payoutPolicy, policy);
    assert.equal(preview.outcomes[0].odds, policy === 'stake_cap_v1' ? 2 : 16);
    assert.equal(preview.outcomes[0].myPossiblePayout, policy === 'stake_cap_v1' ? 2 : 16);
    const result = await request(app).post('/api/matches').send({ gameId: f.gameId, drawId: r.drawId,
      teams: r.outcomes.map((outcome) => ({ playerIds: outcome.playerIds })), winnerTeamIndex: 0 });
    assert.equal(result.status, 201);
    const expected = policy === 'stake_cap_v1' ? [101, 99] : [115, 85];
    const balances = () => [a, b].map((id) => wallet(f.eventId, id).total);
    assert.deepEqual(balances(), expected, 'a 1-point winner gains only 1 under the new policy');
    assert.deepEqual(db.prepare('SELECT stake,payout FROM betting_tips WHERE round_id=? ORDER BY stake').all(r.id),
      [{ stake: 1, payout: expected[0] - 99 }, { stake: 15, payout: expected[1] - 85 }]);
    for (const [revision, winnerTeamIndex] of [1, 0].entries()) {
      assert.equal((await request(app).patch(`/api/matches/${result.body.id}`).send({ winnerTeamIndex,
        bettingCorrection: { reason: 'Correcting the winner with the recorded payout rule', revisions: [{ id: r.id, revision }] },
      })).status, 200);
      assert.deepEqual(balances(), winnerTeamIndex === 1 ? [99, 101] : expected);
      assert.equal(db.prepare('SELECT payout_policy FROM betting_rounds WHERE id=?').pluck().get(r.id), policy);
    }
    await Promise.all([request(app).get('/api/points'), request(app).get('/api/points')]);
    assert.deepEqual(balances(), expected, 'reconciliation never pays a capped or historical market twice');
    assert.deepEqual([a, b].map((id) => readPointsBalances(DEFAULT_GROUP_ID, f.eventId, id)!.betting),
      expected.map((total) => total - 100));
    assert.equal(balances().reduce((sum, total) => sum + total, 0), 200);
    const exported = buildPersonalDataExport(a)! as { organisation: { bettingTips: Array<{ eventId: string; payoutPolicy: string }> } };
    assert.equal(exported.organisation.bettingTips.find((tip) => tip.eventId === f.eventId)!.payoutPolicy, policy);
  }
});

test('parallel reservations obey the fixed stake and available funds without legacy quotas; closed To-dos remain usable', async () => {
  const f = await fixture({ dailyLimit: 1, maxRounds: 1 });
  db.prepare('UPDATE points_settings SET max_stake=1,daily_limit=1,max_rounds=0 WHERE event_id=?').run(f.eventId);
  const settings = (await request(app).get('/api/points')).body.settings;
  assert.deepEqual([settings.max_stake, settings.daily_limit, settings.max_rounds], [20, null, null]);
  assert.equal((await request(app).put('/api/points/settings').send({ maxStake: 100 })).status, 400);
  const a = f.players[0],
    first = await round(f),
    second = await round(f);
  assert.equal((await request(app).put(`/api/points/rounds/${first.id}/tip`).set('x-test-player-id', a)
    .send({ outcomeId: '0', stake: 21 })).status, 400);
  const heldRounds = [];
  for (let i = 0; i < 4; i++) {
    const held = await round(f);
    heldRounds.push(held.id);
    assert.equal((await request(app).put(`/api/points/rounds/${held.id}/tip`).set('x-test-player-id', a)
      .send({ outcomeId: '0', stake: 20 })).status, 200);
  }
  const attempts = await Promise.all(
    [first, second].map((r) =>
      request(app).put(`/api/points/rounds/${r.id}/tip`).set('x-test-player-id', a).send({ outcomeId: '0', stake: 20 }),
    ),
  );
  assert.deepEqual(attempts.map((r) => r.status).sort(), [200, 409]);
  const accepted = attempts[0].status === 200 ? first : second;
  assert.equal((await request(app).post(`/api/points/rounds/${accepted.id}/lock`).send({})).status, 200);
  assert.deepEqual(wallet(f.eventId, a), { total: 100, held: 100, available: 0 }, 'manual closing retains the reservation until result or refund');
  const other = accepted.id === first.id ? second : first;
  assert.equal(
    (await request(app).post(`/api/points/rounds/${other.id}/refund`).send({ reason: 'Not played' })).status,
    200,
  );
  for (const id of heldRounds)
    assert.equal((await request(app).post(`/api/points/rounds/${id}/refund`).send({ reason: 'Test finished' })).status, 200);
  const taskIds: string[] = [];
  for (const rewarded of [true, false]) {
    const created = await request(app).post('/api/checklist/tasks/todo')
      .send({ playerId: TEST_ADMIN_ID, type: 'todo', title: rewarded ? 'Rewarded after closure' : 'Unrewarded after closure' });
    assert.equal(created.status, 201);
    const taskId = created.body.id ?? created.body.tasks[0].id;
    taskIds.push(taskId);
    db.prepare("UPDATE checklist_tasks SET points_value = 0, points_model = 'legacy' WHERE id = ?").run(taskId); // pre-upgrade task
    if (rewarded) legacyPromise(taskId);
    assert.equal((await request(app).post(`/api/checklist/tasks/${taskId}/claim`).send({ playerId: a })).status, 200);
  }
  assert.equal((await request(app).post('/api/points/close').send({})).status, 200);
  const frozenEntries = db.prepare('SELECT * FROM point_entries WHERE event_id = ? ORDER BY id').all(f.eventId);
  const frozenSnapshots = db.prepare('SELECT * FROM points_snapshots WHERE event_id = ? ORDER BY revision').all(f.eventId);
  const frozenWallet = wallet(f.eventId, a);
  const completions = await Promise.all([0, 1].map(() => request(app)
    .patch(`/api/checklist/tasks/${taskIds[0]}/done`).send({ playerId: a })));
  assert.deepEqual(completions.map((r) => r.status).sort(), [200, 409]);
  assert.equal(completions.find((r) => r.status === 200)!.body.status, 'done');
  assert.equal((await request(app).patch(`/api/checklist/tasks/${taskIds[1]}/done`).send({ playerId: a })).status, 200);
  assert.equal((db.prepare('SELECT status FROM checklist_tasks WHERE id = ?').get(taskIds[0]) as { status: string }).status, 'done');
  assert.deepEqual(db.prepare('SELECT * FROM point_entries WHERE event_id = ? ORDER BY id').all(f.eventId), frozenEntries);
  assert.deepEqual(db.prepare('SELECT * FROM points_snapshots WHERE event_id = ? ORDER BY revision').all(f.eventId), frozenSnapshots);
  assert.deepEqual(wallet(f.eventId, a), frozenWallet, 'finishing after closure preserves the frozen account');
  assert.equal(
    (
      await request(app)
        .put(`/api/points/rounds/${other.id}/tip`)
        .set('x-test-player-id', a)
        .send({ outcomeId: '0', stake: 5 })
    ).status,
    409,
  );
});

test('tournament participants can bet on themselves and opponents, including the outright champion; both pools settle once', async () => {
  const f = await fixture();
  const created = await request(app)
    .post('/api/tournaments')
    .send({
      gameId: f.gameId,
      format: 'single_elimination',
      teams: f.players.slice(0, 2).map((id) => ({ playerIds: [id] })),
    });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const tournament = created.body;
  const fixtureId = tournament.matches.find((m: { isBye: boolean }) => !m.isBye).id;
  const rounds = [];
  for (const [sourceType, sourceId] of [
    ['tournament', tournament.id],
    ['tournament_match', fixtureId],
  ]) {
    const opened = await automaticMarket(f, sourceType, sourceId);
    assert.equal(opened.status, 'open');
    assert.ok(opened.tournament);
    assert.equal(opened.tournament.id, tournament.id);
    assert.equal(opened.tournament.name, tournament.name);
    if (sourceType === 'tournament_match') assert.equal(opened.tournament.round, tournament.matches.find((m: { id: string }) => m.id === fixtureId).round);
    assert.equal(opened.outcomes.length, 2, 'knockout and champion markets do not offer a draw');
    rounds.push(opened);
    const tips = await Promise.all(
      f.players
        .slice(0, 2)
        .map((p, i) =>
          request(app)
            .put(`/api/points/rounds/${opened.id}/tip`)
            .set('x-test-player-id', p)
            .send({ outcomeId: tournament.teams[i].id, stake: 5 }),
        ),
    );
    assert.ok(
      tips.every((r) => r.status === 200),
      JSON.stringify(tips.map((r) => r.body)),
    );
    assert.equal(
      (
        await request(app)
          .post(`/api/points/rounds/${opened.id}/lock`)
          .set('x-test-player-id', f.players[0])
          .send({})
      ).status,
      200,
    );
  }
  const result = await request(app)
    .post(`/api/tournaments/${tournament.id}/matches/${fixtureId}/result`)
    .send({ winnerTeamId: tournament.teams[0].id });
  assert.equal(result.status, 200, JSON.stringify(result.body));
  const data = (await request(app).get('/api/points')).body;
  assert.ok(data.rounds.every((r: { status: string }) => r.status === 'settled'));
  const winningPlayer = tournament.teams[0].players[0].id;
  assert.deepEqual((await request(app).get('/api/points').set('x-test-player-id', winningPlayer)).body.bettingParticipation,
    { settledTips: 2, minimumTips: 2, hasMinimum: true });
  assert.equal(data.standings.find((row: { playerId: string }) => row.playerId === winningPlayer).categories.betting.rank, 1);
  assert.equal(wallet(f.eventId, winningPlayer).total, 110);
  assert.equal(
    f.players.reduce((sum, p) => sum + wallet(f.eventId, p).total, 0),
    300,
  );
  assert.equal(
    (
      await request(app)
        .put(`/api/tournaments/${tournament.id}/matches/${fixtureId}/result`)
        .send({ winnerTeamId: tournament.teams[1].id, expectedPlayedAt: result.body.matches[0].playedAt })
    ).status,
    409,
  );
  const correction = {
    winnerTeamId: tournament.teams[1].id,
    expectedPlayedAt: result.body.matches[0].playedAt,
    bettingCorrection: { reason: 'Final result corrected', revisions: rounds.map((r) => ({ id: r.id, revision: 0 })) },
  };
  assert.equal(
    (
      await request(app)
        .put(`/api/tournaments/${tournament.id}/matches/${fixtureId}/result`)
        .set('x-test-player-id', f.players[0])
        .send(correction)
    ).status,
    403,
  );
  assert.equal(
    (await request(app).put(`/api/tournaments/${tournament.id}/matches/${fixtureId}/result`).send(correction)).status,
    200,
  );
  assert.equal(wallet(f.eventId, winningPlayer).total, 90);
  assert.equal(
    f.players.reduce((sum, p) => sum + wallet(f.eventId, p).total, 0),
    300,
  );
  const exported = buildPersonalDataExport(winningPlayer)! as {
    organisation: { bettingTips: unknown[]; pointEntries: Array<{ eventId: string }> };
  };
  assert.equal(exported.organisation.bettingTips.length, 2);
  assert.equal(exported.organisation.pointEntries.filter((entry) => entry.eventId === f.eventId).length, 7);
});

test('selectable draws win free-match and league pools; a legacy market without a draw choice refunds', async () => {
  for (const mode of ['draw', 'rank_draw', 'league', 'legacy'] as const) {
    const f = await fixture();
    let roundId: string;
    let sideId: string;
    let finish: () => PromiseLike<{ status: number; body: unknown }>;
    if (mode === 'league') {
      const tournament = await request(app).post('/api/tournaments').send({ gameId: f.gameId,
        format: 'round_robin', teams: f.players.slice(0, 2).map((id) => ({ playerIds: [id] })) });
      assert.equal(tournament.status, 201);
      const champion = await automaticMarket(f, 'tournament', tournament.body.id);
      for (const [index, playerId] of f.players.slice(0, 2).entries())
        assert.equal((await request(app).put(`/api/points/rounds/${champion.id}/tip`).set('x-test-player-id', playerId)
          .send({ outcomeId: champion.outcomes[index].id, stake: 5 })).status, 200);
      const matchId = tournament.body.matches[0].id;
      const opened = await automaticMarket(f, 'tournament_match', matchId);
      assert.equal(opened.status, 'open');
      assert.ok(opened.outcomes.some((o) => o.id === '__draw__'));
      roundId = opened.id;
      sideId = opened.outcomes[0].id;
      finish = () => request(app).post(`/api/tournaments/${tournament.body.id}/matches/${matchId}/result`)
        .send({ winnerTeamId: null });
    } else {
      const r = await round(f);
      roundId = r.id;
      sideId = r.outcomes[0].id;
      if (mode === 'legacy') {
        db.prepare('UPDATE betting_rounds SET outcomes=? WHERE id=?').run(JSON.stringify(r.outcomes), roundId);
      }
      finish = () => request(app).post('/api/matches').send({ gameId: f.gameId, drawId: r.drawId,
        teams: r.outcomes.map((o) => ({ playerIds: o.playerIds, ...(mode === 'rank_draw' ? { rank: 1 } : {}) })),
        winnerTeamIndex: mode === 'rank_draw' ? 0 : null, isDraw: mode !== 'rank_draw' });
    }
    const tips = await Promise.all(f.players.slice(0, 2).map((playerId, index) => request(app)
      .put(`/api/points/rounds/${roundId}/tip`).set('x-test-player-id', playerId)
      .send({ outcomeId: index === 0 && mode !== 'legacy' ? '__draw__' : index === 0 ? '1' : sideId, stake: 5 })));
    assert.ok(tips.every((r) => r.status === 200), JSON.stringify(tips.map((r) => r.body)));
    assert.equal((await request(app).post(`/api/points/rounds/${roundId}/lock`).send({})).status, 200);
    const result = await finish();
    assert.equal(result.status, mode === 'league' ? 200 : 201, JSON.stringify(result.body));
    const market = (await request(app).get('/api/points')).body.rounds.find((row: { id: string }) => row.id === roundId);
    assert.equal(market.status, mode === 'legacy' ? 'refunded' : 'settled');
    assert.equal(market.result, mode === 'legacy' ? null : '__draw__');
    if (mode === 'league') {
      const champion = (await request(app).get('/api/points')).body.rounds.find((row: { sourceType: string }) => row.sourceType === 'tournament');
      assert.equal(champion.status, 'refunded', 'an unselectable shared tournament victory cannot favor the first stored team');
      const hall = (await request(app).get(`/api/hall-of-fame?eventId=${f.eventId}`)).body.events[0];
      assert.deepEqual([...hall.tournamentChampions[0].championPlayers].sort(),
        f.players.slice(0, 2).map((id) => db.prepare('SELECT name FROM players WHERE id=?').get(id) as { name: string }).map((p) => p.name).sort());
    }
    assert.deepEqual(f.players.slice(0, 2).map((id) => wallet(f.eventId, id).total),
      mode === 'legacy' ? [100, 100] : [105, 95]);
  }
});

test('missing fixture teams refund existing stakes and skip new markets without stopping healthy sources', async () => {
  const f = await fixture();
  const create = () => request(app).post('/api/tournaments').send({ gameId: f.gameId,
    format: 'round_robin', teams: f.players.map((id) => ({ playerIds: [id] })) });
  const tournament = await create();
  const other = await create();
  assert.equal(tournament.status, 201);
  assert.equal(other.status, 201);
  const [firstFixture, unoffered] = tournament.body.matches;
  const market = await automaticMarket(f, 'tournament_match', firstFixture.id);
  for (const [index, playerId] of f.players.slice(0, 2).entries())
    assert.equal((await request(app).put(`/api/points/rounds/${market.id}/tip`).set('x-test-player-id', playerId)
      .send({ outcomeId: market.outcomes[index].id, stake: 5 })).status, 200);
  const original = [firstFixture, unoffered].map((m) => db.prepare('SELECT team_a_id FROM tournament_matches WHERE id=?')
    .get(m.id) as { team_a_id: string });
  // A foreign tournament's team satisfies SQLite's FK but is absent from
  // this source's roster, as can happen with inconsistent legacy data.
  const foreignTeam = (db.prepare('SELECT id FROM tournament_teams WHERE tournament_id=? LIMIT 1')
    .get(other.body.id) as { id: string }).id;
  db.prepare("DELETE FROM betting_rounds WHERE source_id=? AND source_type='tournament_match'").run(unoffered.id);
  try {
    for (const match of [firstFixture, unoffered])
      db.prepare('UPDATE tournament_matches SET team_a_id=? WHERE id=?').run(foreignTeam, match.id);
    reconcileBetting(f.eventId);
    assert.equal((await request(app).get('/api/points')).status, 200);
    assert.equal(db.prepare('SELECT status FROM betting_rounds WHERE id=?').pluck().get(market.id), 'refunded');
    assert.equal(db.prepare("SELECT id FROM betting_rounds WHERE source_id=? AND source_type='tournament_match'").get(unoffered.id), undefined);
    assert.deepEqual(f.players.slice(0, 2).map((id) => wallet(f.eventId, id).total), [100, 100]);
    assert.equal((await round(f)).outcomes.length, 2, 'an unrelated source remains usable');
  } finally {
    for (const [index, match] of [firstFixture, unoffered].entries())
      db.prepare('UPDATE tournament_matches SET team_a_id=? WHERE id=?').run(original[index].team_a_id, match.id);
  }
});

test('revealed points open waiting markets at once; lineup moves update untipped markets and replace tipped open ones', async () => {
  const f = await fixture({}, false);
  const [a, b, c] = f.players;
  const markets = (drawId: string) => db.prepare(`SELECT id,status,refund_cause AS cause FROM betting_rounds
    WHERE source_type='draw' AND source_id=? ORDER BY created_at,rowid`).all(drawId) as Array<{ id: string; status: string; cause: string | null }>;
  const draw = async () => {
    const created = await request(app).post('/api/matchmaking')
      .send({ gameId: f.gameId, playerIds: f.players, teamCount: 2, bettingAllowed: true });
    assert.equal(created.status, 200, JSON.stringify(created.body));
    return created.body as { id: string; teams: Array<{ players: Array<{ id: string }> }> };
  };
  const pair = (drawId: string, teams: Array<{ players: Array<{ id: string }> }>) => {
    const from = teams.findIndex((team) => team.players.length > 1);
    return { drawId, playerId: teams[from].players[0].id, toTeamIndex: 1 - from };
  };
  const move = ({ drawId, playerId, toTeamIndex }: ReturnType<typeof pair>) =>
    request(app).patch(`/api/matchmaking/draws/${drawId}/move`).send({ playerId, toTeamIndex });
  const tip = (roundId: string, playerId: string, outcomeId = '0') =>
    request(app).put(`/api/points/rounds/${roundId}/tip`).set('x-test-player-id', playerId).send({ outcomeId, stake: 5 });

  const waiting = await draw();
  assert.deepEqual(markets(waiting.id), [], 'hidden points open no market');
  assert.equal((await request(app).patch(`/api/events/${f.eventId}/points-visibility`).send({ visible: true, revision: 0 })).status, 200);
  assert.deepEqual(markets(waiting.id).map((m) => m.status), ['open'], 'showing points opens the waiting market without a sweep');

  const firstMove = pair(waiting.id, waiting.teams);
  assert.equal((await move(firstMove)).status, 200);
  const [kept] = markets(waiting.id);
  assert.deepEqual(markets(waiting.id).map((m) => m.status), ['open'], 'an untipped market follows the new lineup');
  const view = await automaticMarket(f, 'draw', waiting.id);
  assert.equal(view.id, kept.id);
  assert.ok(view.outcomes[firstMove.toTeamIndex].playerIds.includes(firstMove.playerId));

  assert.equal((await tip(kept.id, a)).status, 200);
  const moved = (await move({ ...firstMove, toTeamIndex: 1 - firstMove.toTeamIndex })).body;
  assert.equal(wallet(f.eventId, a).held, 0, 'the changed lineup refunds the accepted tip');
  const [replaced, fresh] = markets(waiting.id);
  assert.deepEqual([replaced, fresh].map((m) => [m.id === kept.id, m.status, m.cause]),
    [[true, 'refunded', 'replaced'], [false, 'open', null]]);
  const pointsView = (await request(app).get('/api/points')).body.rounds;
  assert.equal(pointsView.find((row: { id: string }) => row.id === kept.id).replaced, true);
  assert.equal((await tip(kept.id, a)).status, 409, 'a stale client cannot tip on the replaced lineup');
  assert.equal((await tip(fresh.id, a)).status, 200);
  assert.equal((await request(app).post(`/api/points/rounds/${fresh.id}/lock`).send({})).status, 200);
  assert.equal((await move(pair(waiting.id, moved.teams))).status, 200);
  assert.deepEqual(markets(waiting.id).map((m) => [m.status, m.cause]), [['refunded', 'replaced'], ['refunded', null]],
    'closed tips stay closed after a later lineup change');

  // A move racing a tip either refunds that tip with the old lineup or rejects
  // it; it never leaves two current markets or a stake outside the current one.
  const raced = await draw();
  const [racedMarket] = markets(raced.id);
  assert.equal((await tip(racedMarket.id, b)).status, 200);
  const [moveResult, tipResult] = await Promise.all([move(pair(raced.id, raced.teams)), tip(racedMarket.id, c, '1')]);
  assert.equal(moveResult.status, 200);
  assert.ok([200, 409].includes(tipResult.status), JSON.stringify(tipResult.body));
  const current = markets(raced.id).filter((m) => m.cause !== 'replaced');
  assert.deepEqual(current.map((m) => m.status), ['open']);
  assert.notEqual(current[0].id, racedMarket.id);
  assert.deepEqual([b, c].map((id) => wallet(f.eventId, id).held), [0, 0]);
});

test('result corrections rebook pools refunded by a wrong result, and a corrected semifinal reopens the final market', async () => {
  const f = await fixture();
  const [a, b, c] = f.players;
  const r = await round(f);
  for (const [index, playerId] of [a, b].entries())
    assert.equal((await request(app).put(`/api/points/rounds/${r.id}/tip`).set('x-test-player-id', playerId)
      .send({ outcomeId: r.outcomes[index].id, stake: 10 })).status, 200);
  const teams = r.outcomes.map((o) => ({ playerIds: o.playerIds }));
  const result = await request(app).post('/api/matches').send({ gameId: f.gameId, drawId: r.drawId, teams, isDraw: true });
  assert.equal(result.status, 201, JSON.stringify(result.body));
  const refunded = await automaticMarket(f, 'draw', r.drawId);
  assert.deepEqual([refunded.status, refunded.rebooksOnCorrection], ['refunded', true]);
  assert.equal((await request(app).patch(`/api/matches/${result.body.id}`).set('x-test-player-id', a)
    .send({ winnerTeamIndex: 0 })).status, 409, 'rebooking a refunded pool requires the audited admin correction');
  assert.equal((await request(app).patch(`/api/matches/${result.body.id}`).send({ winnerTeamIndex: 0,
    bettingCorrection: { reason: 'Draw entered by mistake', revisions: [{ id: r.id, revision: refunded.revision }] } })).status, 200);
  const corrected = await automaticMarket(f, 'draw', r.drawId);
  assert.deepEqual([corrected.status, corrected.result, corrected.rebooksOnCorrection], ['settled', '0', true]);
  assert.deepEqual([a, b].map((id) => wallet(f.eventId, id).total), [110, 90]);

  const single = await round(f);
  assert.equal((await request(app).put(`/api/points/rounds/${single.id}/tip`).set('x-test-player-id', a)
    .send({ outcomeId: single.outcomes[0].id, stake: 5 })).status, 200);
  const singleResult = await request(app).post('/api/matches').send({ gameId: f.gameId, drawId: single.drawId,
    teams: single.outcomes.map((o) => ({ playerIds: o.playerIds })), isDraw: true });
  assert.equal((await automaticMarket(f, 'draw', single.drawId)).rebooksOnCorrection, false);
  assert.equal((await request(app).patch(`/api/matches/${singleResult.body.id}`).set('x-test-player-id', a)
    .send({ winnerTeamIndex: 0 })).status, 200, 'a one-sided refund cannot pay out and needs no admin');
  assert.equal((await automaticMarket(f, 'draw', single.drawId)).status, 'refunded');

  const created = await request(app).post('/api/tournaments').send({ gameId: f.gameId, format: 'single_elimination',
    teams: [TEST_ADMIN_ID, a, b, c].map((id) => ({ playerIds: [id] })) });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const tournament = created.body as { id: string; matches: Array<{ id: string; round: number; isBye: boolean;
    teamAId: string | null; teamBId: string | null; playedAt: number | null }> };
  const semis = tournament.matches.filter((m) => m.round === 1 && !m.isBye);
  assert.equal(semis.length, 2);
  const recorded = [];
  for (const semi of semis) {
    const response = await request(app).post(`/api/tournaments/${tournament.id}/matches/${semi.id}/result`)
      .send({ winnerTeamId: semi.teamAId });
    assert.equal(response.status, 200, JSON.stringify(response.body));
    recorded.push(response.body.matches.find((m: { id: string }) => m.id === semi.id));
  }
  const finalId = tournament.matches.find((m) => m.round === 2)!.id;
  const final = await automaticMarket(f, 'tournament_match', finalId);
  const finalists = final.outcomes.map((o) => o.playerIds[0]);
  for (const [index, playerId] of finalists.entries())
    assert.equal((await request(app).put(`/api/points/rounds/${final.id}/tip`).set('x-test-player-id', playerId)
      .send({ outcomeId: final.outcomes[index].id, stake: 5 })).status, 200);
  const fix = await request(app).put(`/api/tournaments/${tournament.id}/matches/${semis[0].id}/result`)
    .send({ winnerTeamId: semis[0].teamBId, expectedPlayedAt: recorded[0].playedAt });
  assert.equal(fix.status, 200, JSON.stringify(fix.body));
  assert.deepEqual(finalists.map((id) => wallet(f.eventId, id).held), [0, 0], 'the old final pairing is refunded');
  const reopened = await automaticMarket(f, 'tournament_match', finalId);
  assert.notEqual(reopened.id, final.id);
  assert.equal(reopened.status, 'open', 'the new final pairing can be tipped');
  assert.equal((await request(app).put(`/api/points/rounds/${reopened.id}/tip`).set('x-test-player-id', a)
    .send({ outcomeId: reopened.outcomes[0].id, stake: 5 })).status, 200);
});

test('competition writes and deadline sweeps isolate another event with broken legacy JSON', async (t) => {
  const broken = await fixture();
  const bad = await round(broken);
  const healthy = await fixture();
  const good = await round(healthy);
  // Session authentication still slides expiry. Guard points writes rather
  // than all SQLite writes when exercising the real authenticated endpoint.
  db.exec(`CREATE TEMP TRIGGER refuse_point_refresh BEFORE INSERT ON points_accounts
    BEGIN SELECT RAISE(ABORT,'points refresh must not initialize accounts'); END;`);
  try {
    const read = await request(app).get('/api/points');
    assert.equal(read.status, 200, 'refreshing points requires no points writes');
    assert.equal(read.body.wallet.total, 100);
    assert.equal(read.body.participantCount, 4);
  } finally { db.exec('DROP TRIGGER refuse_point_refresh'); }
  for (const [index, playerId] of healthy.players.slice(0, 2).entries())
    assert.equal((await request(app).put(`/api/points/rounds/${good.id}/tip`).set('x-test-player-id', playerId)
      .send({ outcomeId: String(index), stake: 5 })).status, 200);
  const original = db.prepare('SELECT teams FROM matchmaking_draws WHERE id=?').pluck().get(bad.drawId) as string;
  const logged = t.mock.method(console, 'error', () => {});
  try {
    db.prepare('UPDATE matchmaking_draws SET teams=? WHERE id=?').run('{broken', bad.drawId);
    assert.equal((await request(app).post('/api/matches').send({ gameId: healthy.gameId, teams: [] })).status, 400);
    assert.equal((await request(app).post('/api/matches').send({ gameId: healthy.gameId,
      teams: healthy.players.slice(0, 2).map((id) => ({ playerIds: [id] })), winnerTeamIndex: 0 })).status, 201);
    assert.equal((await round(healthy)).outcomes.length, 2);
    assert.equal((await request(app).post('/api/tournaments').send({ gameId: healthy.gameId,
      format: 'round_robin', teams: healthy.players.slice(0, 2).map((id) => ({ playerIds: [id] })) })).status, 201);
    db.prepare('UPDATE betting_rounds SET closes_at=? WHERE id IN (?,?)').run(Date.now() - 1, bad.id, good.id);
    sweepBetting();
    sweepBetting();
    assert.equal(db.prepare('SELECT status FROM betting_rounds WHERE id=?').pluck().get(good.id), 'locked');
    assert.equal(logged.mock.calls.length, 1, 'a persistent source error is logged once and does not prevent other deadlines');
    // No due deadlines or undelivered notices: the fast tick must need no writes.
    db.prepare('UPDATE betting_rounds SET closes_at=0 WHERE id=?').run(bad.id);
    db.pragma('query_only = ON');
    try {
      sweepBetting();
      assert.equal(logged.mock.calls.length, 1);
    } finally { db.pragma('query_only = OFF'); }
  } finally {
    db.prepare('UPDATE matchmaking_draws SET teams=? WHERE id=?').run(original, bad.drawId);
    logged.mock.restore();
  }
});

test('late accepted participants get exactly one starting credit; final standings remain frozen until an audited reopening', async () => {
  const f = await fixture();
  const late = (
    await request(app)
      .post('/api/players')
      .send({ name: `Points Late ${sequence}` })
  ).body.id;
  setParticipants(f.eventId, [TEST_ADMIN_ID, ...f.players, late]);
  assert.equal(wallet(f.eventId, late).total, 100, 'acceptance credits immediately, without waiting for a read');
  setParticipants(f.eventId, [TEST_ADMIN_ID, ...f.players, late]);
  assert.equal(wallet(f.eventId, late).total, 100);
  const closes = await Promise.all([0, 1].map(() => request(app).post('/api/points/close').send({})));
  assert.deepEqual(closes.map((r) => r.status).sort(), [200, 409]);
  const frozen = (await request(app).get('/api/points')).body.standings;
  setParticipants(f.eventId, [TEST_ADMIN_ID, f.players[0], late]);
  assert.deepEqual((await request(app).get('/api/points')).body.standings, frozen);
  const entry = readPointsJournal(DEFAULT_GROUP_ID, f.eventId, late).find((row) => row.account === 'wallet')!;
  assert.equal(
    (
      await request(app)
        .post(`/api/points/entries/${entry.id}/deduct`)
        .send({ amount: 1, reason: 'Closed', requestId: 'closed-deduct' })
    ).status,
    409,
  );
  assert.equal((await request(app).post('/api/points/reopen').send({ reason: '' })).status, 400);
  assert.equal((await request(app).post('/api/points/reopen').send({ reason: 'Final correction' })).status, 200);
  assert.equal(
    (
      await request(app)
        .post(`/api/points/entries/${entry.id}/deduct`)
        .send({ amount: 1, reason: 'Correction', requestId: 'reopened-deduct' })
    ).status,
    409,
  );
  assert.equal((await request(app).post('/api/points/close').send({})).status, 200);
  assert.equal(
    (db.prepare('SELECT COUNT(*) AS n FROM points_snapshots WHERE event_id = ?').get(f.eventId) as { n: number }).n,
    2,
  );
});

test('results implicitly close accepted tips atomically, deadlines reject late tips, and legacy quotas do not limit new markets', async () => {
  const f = await fixture({ maxRounds: 1 });
  const r = await round(f);
  await Promise.all(
    f.players.slice(0, 2).map((p, i) =>
      request(app)
        .put(`/api/points/rounds/${r.id}/tip`)
        .set('x-test-player-id', p)
        .send({ outcomeId: String(i), stake: 5 }),
    ),
  );
  const resultInput = {
    gameId: f.gameId,
    drawId: r.drawId,
    teams: r.outcomes.map((o) => ({ playerIds: o.playerIds })),
    winnerTeamIndex: 0,
  };
  db.exec(`CREATE TEMP TRIGGER fail_implicit_settlement BEFORE INSERT ON points_journal
    WHEN (SELECT account FROM points_sources WHERE id=NEW.source_id)='betting'
    BEGIN SELECT RAISE(ABORT,'implicit settlement failed'); END;`);
  try {
    assert.equal((await request(app).post('/api/matches').send(resultInput)).status, 500);
    assert.deepEqual(db.prepare('SELECT status, locked_at FROM betting_rounds WHERE id=?').get(r.id),
      { status: 'open', locked_at: null }, 'an accounting error also rolls back the implicit lock');
    assert.equal(db.prepare('SELECT match_id FROM matchmaking_draws WHERE id=?').pluck().get(r.drawId), null);
    assert.deepEqual(wallet(f.eventId, f.players[0]), { total: 100, held: 5, available: 95 });
    assert.equal(db.prepare('SELECT COUNT(*) FROM betting_tips WHERE round_id=? AND payout IS NOT NULL').pluck().get(r.id), 0);
  } finally { db.exec('DROP TRIGGER fail_implicit_settlement'); }
  const [early, concurrentTip] = await Promise.all([request(app)
    .post('/api/matches')
    .send(resultInput), request(app).put(`/api/points/rounds/${r.id}/tip`).set('x-test-player-id', f.players[2])
      .send({ outcomeId: '0', stake: 5 })]);
  assert.equal(early.status, 201);
  assert.ok([200, 409].includes(concurrentTip.status));
  const settled = (await request(app).get('/api/points')).body.rounds.find((row: { id: string }) => row.id === r.id);
  assert.equal(settled.status, 'settled');
  assert.ok(db.prepare('SELECT locked_at FROM betting_rounds WHERE id=?').pluck().get(r.id),
    'result submission records the implicit betting lock');
  const settledTips = db.prepare('SELECT player_id, stake, payout FROM betting_tips WHERE round_id=?').all(r.id) as
    Array<{ player_id: string; stake: number; payout: number }>;
  assert.equal(settledTips.length, concurrentTip.status === 200 ? 3 : 2);
  assert.equal(settledTips.reduce((sum, tip) => sum + tip.payout, 0), settledTips.reduce((sum, tip) => sum + tip.stake, 0));
  assert.ok(wallet(f.eventId, f.players[0]).total > 100);
  assert.ok(wallet(f.eventId, f.players[1]).total < 100);
  assert.equal((await request(app).put(`/api/points/rounds/${r.id}/tip`).set('x-test-player-id', f.players[1])
    .send({ outcomeId: '0', stake: 5 })).status, 409, 'a result never admits subsequent tips');
  const draw = await request(app)
    .post('/api/matchmaking')
    .send({ gameId: f.gameId, playerIds: f.players.slice(0, 2), teamCount: 2, bettingAllowed: true });
  assert.equal(
    (
      await request(app)
        .post('/api/points/rounds')
        .send({ sourceType: 'draw', sourceId: draw.body.id ?? draw.body.drawId, closesAt: Date.now() + 60000 })
    ).status,
    409,
  );
  assert.equal((await automaticMarket(f, 'draw', draw.body.id)).status, 'open', 'the next permitted match still opens automatically');
  assert.equal((await request(app).put('/api/points/settings').send({ maxRounds: 1, maxStake: 11 })).status, 400);
  const second = await fixture();
  const deadline = await round(second);
  await Promise.all(
    second.players.slice(0, 2).map((p, i) =>
      request(app)
        .put(`/api/points/rounds/${deadline.id}/tip`)
        .set('x-test-player-id', p)
        .send({ outcomeId: String(i), stake: 5 }),
    ),
  );
  db.prepare('UPDATE betting_rounds SET closes_at = ? WHERE id = ?').run(Date.now() - 1, deadline.id);
  assert.equal(
    (
      await request(app)
        .put(`/api/points/rounds/${deadline.id}/tip`)
        .set('x-test-player-id', second.players[0])
        .send({ outcomeId: '1', stake: 5 })
    ).status,
    409,
  );
  assert.equal((await request(app).get('/api/points')).body.rounds[0].status, 'locked');
  const delayed = await round(second);
  for (const [index, playerId] of second.players.slice(0, 2).entries())
    assert.equal((await request(app).put(`/api/points/rounds/${delayed.id}/tip`).set('x-test-player-id', playerId)
      .send({ outcomeId: String(index), stake: 5 })).status, 200);
  db.prepare('UPDATE betting_rounds SET closes_at=? WHERE id=?').run(Date.now() - 1, delayed.id);
  assert.equal((await request(app).post('/api/matches').send({ gameId: second.gameId, drawId: delayed.drawId,
    teams: delayed.outcomes.map((o) => ({ playerIds: o.playerIds })), winnerTeamIndex: 0 })).status, 201);
  assert.equal(db.prepare('SELECT status FROM betting_rounds WHERE id=?').pluck().get(delayed.id), 'settled',
    'an elapsed deadline is applied before recording the result even without a prior read or sweep');
});

test('result corrections keep original pools zero-sum even when the old winnings are already reserved elsewhere', async () => {
  const f = await fixture();
  const first = await round(f);
  for (let i = 0; i < 2; i++)
    assert.equal(
      (
        await request(app)
          .put(`/api/points/rounds/${first.id}/tip`)
          .set('x-test-player-id', f.players[i])
          .send({ outcomeId: String(i), stake: 20 })
      ).status,
      200,
    );
  await request(app).post(`/api/points/rounds/${first.id}/lock`).send({});
  const match = await request(app)
    .post('/api/matches')
    .send({
      gameId: f.gameId,
      drawId: first.drawId,
      teams: first.outcomes.map((o) => ({ playerIds: o.playerIds })),
      winnerTeamIndex: 0,
    });
  const reservations = [];
  for (let i = 0; i < 6; i++) {
    const r = await round(f);
    reservations.push(r);
    assert.equal((await request(app).put(`/api/points/rounds/${r.id}/tip`).set('x-test-player-id', f.players[0])
      .send({ outcomeId: '0', stake: 20 })).status, 200);
  }
  const second = reservations[0];
  assert.equal((await request(app).get('/api/points')).body.rounds.length, 7, 'there is no six-round quota');
  const corrected = await request(app)
    .patch(`/api/matches/${match.body.id}`)
    .send({
      winnerTeamIndex: 1,
      bettingCorrection: { reason: 'Score reversed', revisions: [{ id: first.id, revision: 0 }] },
    });
  assert.equal(corrected.status, 200, JSON.stringify(corrected.body));
  assert.deepEqual(wallet(f.eventId, f.players[0]), { total: 80, held: 120, available: -40 });
  assert.equal(wallet(f.eventId, f.players[1]).total, 120);
  assert.equal(
    (
      await request(app)
        .put(`/api/points/rounds/${second.id}/tip`)
        .set('x-test-player-id', f.players[0])
        .send({ outcomeId: '0', stake: 1 })
    ).status,
    409,
  );
  assert.equal(
    (
      db
        .prepare('SELECT stake FROM betting_tips WHERE round_id = ? AND player_id = ?')
        .get(second.id, f.players[0]) as { stake: number }
    ).stake,
    20,
    'unrelated reservations are not silently changed',
  );
});

test('legacy zero-round quotas do not disable betting; fixed todos ignore the old budget and reward route', async () => {
  const f = await fixture({ maxRounds: 0, orgaBudget: 5 });
  const tasks = [];
  for (const title of ['Setup', 'Cleanup'])
    tasks.push(
      (await request(app).post('/api/checklist/tasks/todo').send({ playerId: TEST_ADMIN_ID, type: 'todo', title })).body
        .tasks[0].id as string,
    );
  const rewards = await Promise.all(tasks.map((id) => request(app).post(`/api/points/tasks/${id}/reward`).send({ perPerson: 5, slots: 1 })));
  assert.deepEqual(rewards.map((r) => r.status), [409, 409]);
  for (const id of tasks) {
    assert.equal((await request(app).post(`/api/checklist/tasks/${id}/claim`).send({ playerId: f.players[0] })).status, 200);
    assert.equal((await request(app).patch(`/api/checklist/tasks/${id}/done`).send({ playerId: f.players[0] })).status, 200);
  }
  assert.equal(readPointsBalances(DEFAULT_GROUP_ID, f.eventId, f.players[0])!.orga, 6, 'fixed rewards do not depend on the old budget');
  assert.equal((db.prepare('SELECT orga_allocated FROM points_settings WHERE event_id=?').get(f.eventId) as { orga_allocated: number }).orga_allocated, 0);
  const draw = (
    await request(app)
      .post('/api/matchmaking')
      .send({ gameId: f.gameId, playerIds: f.players.slice(0, 2), teamCount: 2, bettingAllowed: true })
  ).body;
  assert.equal(
    (
      await request(app)
        .post('/api/points/rounds')
        .send({ sourceType: 'draw', sourceId: draw.id, closesAt: Date.now() + 60000 })
    ).status,
    409,
  );
  assert.equal((await automaticMarket(f, 'draw', draw.id)).status, 'open', 'a stored legacy zero quota cannot disable an allowed match');
  assert.equal((await request(app).get('/api/points')).body.budget, undefined);
});

test('account erasure keeps other category credits and anonymizes historical pool stakes', async () => {
  const f = await fixture({ orgaBudget: 5 });
  const task = await request(app)
    .post('/api/checklist/tasks/todo')
    .set('x-test-player-id', TEST_ADMIN_ID)
    .send({ playerId: TEST_ADMIN_ID, type: 'todo', title: 'Completed shared task' });
  const taskId = task.body.tasks[0].id;
  await request(app)
    .post(`/api/checklist/tasks/${taskId}/claim`)
    .set('x-test-player-id', f.players[1])
    .send({ playerId: f.players[1] });
  await request(app)
    .patch(`/api/checklist/tasks/${taskId}/done`)
    .set('x-test-player-id', f.players[1])
    .send({ playerId: f.players[1] });
  const r = await round(f);
  for (let i = 0; i < 2; i++)
    await request(app)
      .put(`/api/points/rounds/${r.id}/tip`)
      .set('x-test-player-id', f.players[i])
      .send({ outcomeId: String(i), stake: 5 });
  await request(app).post(`/api/points/rounds/${r.id}/lock`).send({});
  await request(app)
    .post('/api/matches')
    .send({
      gameId: f.gameId,
      drawId: r.drawId,
      teams: r.outcomes.map((o) => ({ playerIds: o.playerIds })),
      winnerTeamIndex: 0,
    });
  const directory = mkdtempSync(path.join(tmpdir(), 'points-erasure-'));
  const mutableConfig = config as unknown as { deletionLedgerFile: string };
  const oldLedger = mutableConfig.deletionLedgerFile;
  mutableConfig.deletionLedgerFile = path.join(directory, 'receipts.jsonl');
  try {
    const result = deleteAccount(f.players[0], TEST_ADMIN_ID);
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(
      wallet(f.eventId, f.players[1]).total,
      95,
      'the lost bet remains separate from the helper category credit',
    );
    const view = (await request(app).get('/api/points')).body;
    assert.equal(view.categoryBalances.wallet, 100);
    assert.equal(readPointsBalances(DEFAULT_GROUP_ID, f.eventId, f.players[1])!.orga, 3, 'the helper keeps their category credit');
    assert.equal(view.rounds[0].pot, 10, 'historic pool totals stay intact');
    assert.equal(view.rounds[0].tipCount, 2);
    assert.ok(!JSON.stringify(view.rounds[0]).includes(f.players[0]));
    assert.equal(
      (db.prepare('SELECT COUNT(*) AS n FROM point_entries WHERE player_id = ?').get(f.players[0]) as { n: number }).n,
      0,
    );
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
  } finally {
    mutableConfig.deletionLedgerFile = oldLedger;
    rmSync(directory, { recursive: true, force: true });
  }
});

test('catalog deletion protects paid draw, fixture and outright pools until an explicit void, then deletes once', async () => {
  for (const sourceType of ['draw', 'tournament_match', 'tournament'] as const) {
    const f = await fixture();
    let tournamentId = '',
      fixtureId = '',
      drawId = '',
      roundId: string;
    let outcomes: Array<{ id: string; playerIds: string[] }>;
    if (sourceType === 'draw') {
      const opened = await round(f);
      drawId = opened.drawId;
      roundId = opened.id;
      outcomes = opened.outcomes;
    } else {
      const created = await request(app)
        .post('/api/tournaments')
        .send({
          gameId: f.gameId,
          format: 'single_elimination',
          teams: f.players.slice(0, 2).map((playerId) => ({ playerIds: [playerId] })),
        });
      assert.equal(created.status, 201, JSON.stringify(created.body));
      tournamentId = created.body.id;
      fixtureId = created.body.matches.find((match: { isBye: boolean }) => !match.isBye).id;
      const opened = await automaticMarket(f, sourceType, sourceType === 'tournament' ? tournamentId : fixtureId);
      assert.equal(opened.status, 'open');
      roundId = opened.id;
      outcomes = opened.outcomes;
    }
    for (let i = 0; i < 2; i++) {
      assert.equal(
        (
          await request(app)
            .put(`/api/points/rounds/${roundId}/tip`)
            .set('x-test-player-id', f.players[i])
            .send({ outcomeId: outcomes[i].id, stake: 5 })
        ).status,
        200,
      );
    }
    assert.equal((await request(app).post(`/api/points/rounds/${roundId}/lock`).send({})).status, 200);
    const result =
      sourceType === 'draw'
        ? await request(app)
            .post('/api/matches')
            .send({
              gameId: f.gameId,
              drawId,
              teams: outcomes.map((o) => ({ playerIds: o.playerIds })),
              winnerTeamIndex: 0,
            })
        : await request(app)
            .post(`/api/tournaments/${tournamentId}/matches/${fixtureId}/result`)
            .send({ winnerTeamId: outcomes[0].id });
    assert.equal(result.status, sourceType === 'draw' ? 201 : 200, JSON.stringify(result.body));
    assert.deepEqual(
      f.players.slice(0, 2).map((id) => wallet(f.eventId, id).total),
      [105, 95],
    );

    // A corrected result can belong to another catalog game than its draw.
    // Deleting either catalog game must still protect the paid result.
    let resultGameId = f.gameId;
    if (sourceType === 'draw') {
      const otherGame = await request(app).post('/api/games').send({ name: 'Corrected result game' });
      assert.equal(otherGame.status, 201);
      resultGameId = otherGame.body.id;
      const remapped = await request(app)
        .patch(`/api/matches/${result.body.id}`)
        .send({
          gameId: resultGameId,
          bettingCorrection: { reason: 'Correct catalog assignment', revisions: [{ id: roundId, revision: 0 }] },
        });
      assert.equal(remapped.status, 200, JSON.stringify(remapped.body));
      const linked = db.prepare('SELECT game_id,match_id FROM matchmaking_draws WHERE id = ?').get(drawId);
      assert.deepEqual(linked, { game_id: f.gameId, match_id: result.body.id });
      const cascades = await Promise.all([0, 1].map(() => request(app).delete(`/api/games/${resultGameId}`)));
      assert.deepEqual(cascades.map((response) => response.status), [409, 409]);
      assert.ok(db.prepare('SELECT 1 FROM matches WHERE id = ?').get(result.body.id));
      assert.deepEqual(db.prepare('SELECT game_id,match_id FROM matchmaking_draws WHERE id = ?').get(drawId), linked);
    }

    const blocked = await Promise.all([0, 1].map(() => request(app).delete(`/api/games/${f.gameId}`)));
    assert.deepEqual(
      blocked.map((response) => response.status),
      [409, 409],
      sourceType,
    );
    assert.ok(db.prepare('SELECT 1 FROM games WHERE id = ?').get(f.gameId), 'a rejected cascade keeps its source');
    assert.equal((await request(app).get('/api/points')).body.rounds.find((row: { id: string }) => row.id === roundId).status, 'settled');
    assert.deepEqual(
      f.players.slice(0, 2).map((id) => wallet(f.eventId, id).total),
      [105, 95],
    );

    assert.equal(
      (
        await request(app)
          .post(`/api/points/rounds/${roundId}/void`)
          .send({ reason: 'Remove invalid competition', revision: 0 })
      ).status,
      200,
    );
    const deletions = await Promise.all([0, 1].map(() => request(app).delete(`/api/games/${resultGameId}`)));
    assert.deepEqual(deletions.map((response) => response.status).sort(), [204, 404]);
    if (sourceType === 'draw') {
      assert.equal(db.prepare('SELECT 1 FROM matches WHERE id = ?').get(result.body.id), undefined);
      assert.deepEqual(db.prepare('SELECT match_id FROM matchmaking_draws WHERE id = ?').get(drawId), { match_id: null });
    }
    assert.deepEqual(
      f.players.slice(0, 2).map((id) => wallet(f.eventId, id).total),
      [100, 100],
    );
    assert.equal((await request(app).get('/api/points')).body.rounds.find((row: { id: string }) => row.id === roundId).status, 'refunded');
  }

  const f = await fixture();
  const pending = await round(f);
  await request(app)
    .put(`/api/points/rounds/${pending.id}/tip`)
    .set('x-test-player-id', f.players[0])
    .send({ outcomeId: '0', stake: 5 });
  assert.equal(wallet(f.eventId, f.players[0]).held, 5);
  assert.equal((await request(app).delete(`/api/games/${f.gameId}`)).status, 204);
  assert.equal(
    wallet(f.eventId, f.players[0]).held,
    0,
    'an unpaid deleted pool refunds immediately without a later GET or timer',
  );
});
