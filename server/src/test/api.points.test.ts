import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createTestApp, TEST_ADMIN_ID, DEFAULT_GROUP_ID } from './testApp';
import { createEvent, setParticipants } from '../events';
import { setActiveEventForPlayer } from '../eventContext';
import { db } from '../db';
import { wallet, PointsError } from '../points';
import { correctJournalEntry } from '../pointsAdministration';
import { readPointsBalances, readPointsSource, recordPointsEntitlements } from '../pointsJournal';
import { buildPersonalDataExport, deleteAccount } from '../privacyService';
import { syncOrgaPoints } from '../orgaPoints';
import { config } from '../config';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const app = createTestApp();
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
async function round(f: Awaited<ReturnType<typeof fixture>>) {
  const draw = await request(app)
    .post('/api/matchmaking')
    .send({ gameId: f.gameId, playerIds: f.players.slice(0, 2), teamCount: 2 });
  assert.equal(draw.status, 200, JSON.stringify(draw.body));
  const id = draw.body.drawId ?? draw.body.id;
  assert.ok(id, JSON.stringify(draw.body));
  const created = await request(app)
    .post('/api/points/rounds')
    .send({ sourceType: 'draw', sourceId: id, closesAt: Date.now() + 60000 });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  return {
    id: created.body.id as string,
    drawId: id as string,
    outcomes: created.body.outcomes as Array<{ id: string; playerIds: string[] }>,
  };
}

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
  assert.deepEqual(configurations.map((r) => r.status).sort(), [200, 409]);
  const configured = configurations.find((r) => r.status === 200)!;
  assert.equal(wallet(background.id, TEST_ADMIN_ID).total, configured.body.initial_points);
  const adjustments = db.prepare("SELECT COUNT(*) AS n FROM point_entries WHERE event_id = ? AND source = 'correction'").get(background.id) as { n: number };
  assert.equal(adjustments.n, 1);
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
  assert.deepEqual((await scores(`?eventId=${f.eventId}`)).map((row: { points: number }) => row.points), [100, 100, 100],
    'the explicit unfiltered LAN view keeps its legacy account until the model transition');
  assert.equal((await request(app).patch(`/api/events/${f.eventId}/points-visibility`)
    .send({ visible: false, revision: 1 })).status, 200);
  assert.deepEqual(await scores(`?eventId=${f.eventId}&gameId=${f.gameId}`), []);
  assert.deepEqual(await scores(`?gameId=${f.gameId}`), []);
  assert.deepEqual((await scores('')).map((row: { points: number }) => row.points), [1, 4]);
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
  db.prepare("UPDATE checklist_tasks SET points_value = 0, points_model = 'legacy' WHERE id = ?").run(taskId); // pre-upgrade task
  assert.equal((await request(app).post(`/api/points/tasks/${taskId}/reward`).send({ perPerson: 5, slots: 1 })).status, 201);
  await request(app).post(`/api/checklist/tasks/${taskId}/claim`).set('x-test-player-id', creator).send({ playerId: creator });
  const done = await request(app).patch(`/api/checklist/tasks/${taskId}/done`).set('x-test-player-id', creator).send({ playerId: creator });
  assert.equal(done.status, 200);
  assert.equal(done.body.reward, null, 'a hidden reward is not disclosed by a task mutation');
  assert.equal(wallet(f.eventId, creator).total, 105, 'completion credits without any participant viewing points');
  const reveals = await Promise.all([0, 1].map(() => visibility(true, 0, creator)));
  assert.deepEqual(reveals.map((r) => r.status).sort(), [200, 409]);
  assert.equal((await request(app).get('/api/points').set('x-test-player-id', creator)).body.wallet.total, 105);
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
  assert.deepEqual([wallet(f.eventId, creator).total, wallet(f.eventId, opponent).total], [110, 95]);
  const hidden = await request(app).get('/api/points');
  assert.equal(hidden.body.rounds[0].status, 'settled', 'reconciliation continues while hidden');
  assert.deepEqual((await request(app).get(`/api/export?eventId=${f.eventId}`)).body.leaderboard, [], 'keepsake exports do not disclose hidden standings');
  assert.equal((await request(app).get('/api/points').set('x-test-player-id', creator)).status, 403);
  assert.equal((await visibility(true, 2, creator)).status, 200);
  const restored = await request(app).get('/api/points').set('x-test-player-id', creator);
  assert.equal(restored.body.wallet.total, 110);
  assert.deepEqual(restored.body.entries.map((entry: { source: string }) => entry.source), ['start', 'task', 'tip']);
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
    assert.equal((await request(app).post('/api/checklist/tasks/todo').send({ title: 'Invalid reward', pointsValue })).status, 400);
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
  assert.equal((await request(app).patch(`/api/checklist/tasks/${id}`).send({ pointsValue: 4, expectedPointsValue: 5 })).status, 409);
  const done = () => request(app).patch(`/api/checklist/tasks/${id}/done`).send({ playerId: b });
  const completions = await Promise.all([done(), done()]);
  assert.deepEqual(completions.map((r) => r.status).sort(), [200, 409]);
  assert.equal(readPointsSource(source)!.total, 5);
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
  assert.equal(readPointsSource(source)!.total, 5, 'recompletion replaces the claim instead of adding another reward');
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
  db.prepare("UPDATE checklist_tasks SET points_value=0,status='done',done_at=1 WHERE id=?").run(oldId);
  syncOrgaPoints(DEFAULT_GROUP_ID, f.eventId);
  assert.equal(readPointsSource({ ...source, sourceKey: `todo:${oldId}` })!.total, 0);
  const requestTask = await request(app).post('/api/checklist/tasks').send({ title: 'Bring a cable', assigneePlayerIds: [a], pointsValue: 5 });
  const requestId = requestTask.body.tasks[0].id;
  assert.equal(requestTask.body.tasks[0].legacyRewardAvailable, false);
  assert.equal((await request(app).post(`/api/points/tasks/${requestId}/reward`).send({ perPerson: 5, slots: 1 })).status, 409);
  assert.equal((await request(app).patch(`/api/checklist/tasks/${requestId}/done`).send({ playerId: a })).status, 200);
  assert.equal(readPointsSource({ ...source, sourceKey: `todo:${requestId}` })!.total, 0);
  const own = await request(app).post('/api/checklist/tasks/todo').send({ title: 'My own task', assigneePlayerIds: [TEST_ADMIN_ID], pointsValue: 5 });
  assert.equal((await request(app).patch(`/api/checklist/tasks/${own.body.tasks[0].id}/done`).send({})).status, 200);
  assert.equal(readPointsBalances(DEFAULT_GROUP_ID, f.eventId, TEST_ADMIN_ID)!.orga, 0);
  const unclaimed = await request(app).post('/api/checklist/tasks/todo').send({ title: 'Change before claiming' });
  const id = unclaimed.body.tasks[0].id;
  const edits = await Promise.all([2, 4].map((pointsValue) => request(app).patch(`/api/checklist/tasks/${id}`).send({ pointsValue, expectedPointsValue: 1 })));
  assert.deepEqual(edits.map((r) => r.status).sort(), [200, 409], 'a stale point-value edit cannot overwrite a concurrent change');
  assert.equal((await request(app).post(`/api/checklist/tasks/${id}/claim`).send({ playerId: a })).status, 200);
  const releases = await Promise.all([a, a].map((playerId) => request(app).post(`/api/checklist/tasks/${id}/release`).send({ playerId })));
  assert.deepEqual(releases.map((r) => r.status).sort(), [200, 403]);
  const cancellations = await Promise.all([0, 1].map(() => request(app).delete(`/api/checklist/tasks/${id}`).send({})));
  assert.deepEqual(cancellations.map((r) => r.status).sort(), [204, 409]);
  const transition = await request(app).post('/api/checklist/tasks/todo').send({ title: 'Historical open task at cutover' });
  const transitionId = transition.body.tasks[0].id;
  db.prepare("UPDATE checklist_tasks SET points_value=0, points_model='legacy' WHERE id=?").run(transitionId);
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

test('task completion awards promised slots immediately and once, with atomic budget and partial administrative deductions', async () => {
  const f = await fixture({ orgaBudget: 10 });
  const task = await request(app)
    .post('/api/checklist/tasks/todo')
    .send({ playerId: TEST_ADMIN_ID, type: 'todo', title: 'Cable cleanup' });
  assert.equal(task.status, 201, JSON.stringify(task.body));
  const id = task.body.id ?? task.body.tasks?.[0]?.id;
  assert.ok(id, JSON.stringify(task.body));
  db.prepare("UPDATE checklist_tasks SET points_value = 0, points_model = 'legacy' WHERE id = ?").run(id); // pre-upgrade task
  const reward = await request(app).post(`/api/points/tasks/${id}/reward`).send({ perPerson: 5, slots: 2 });
  assert.equal(reward.status, 201, JSON.stringify(reward.body));
  const claims = await Promise.all(
    f.players.map((p) => request(app).post(`/api/checklist/tasks/${id}/claim`).send({ playerId: p })),
  );
  assert.ok(claims.every((r) => r.status === 200));
  const completions = await Promise.all(
    [0, 1].map(() => request(app).patch(`/api/checklist/tasks/${id}/done`).send({ playerId: f.players[0] })),
  );
  assert.deepEqual(completions.map((r) => r.status).sort(), [200, 409]);
  const balances = f.players.map((p) => wallet(f.eventId, p).total).sort();
  assert.deepEqual(balances, [100, 105, 105]);
  const entry = db
    .prepare("SELECT id,player_id FROM point_entries WHERE event_id = ? AND source = 'task' LIMIT 1")
    .get(f.eventId) as { id: string; player_id: string };
  const bad = await request(app)
    .post(`/api/points/entries/${entry.id}/deduct`)
    .send({ amount: 1, reason: '', requestId: 'bad' });
  assert.equal(bad.status, 400);
  const attempts = await Promise.all(
    [0, 1].map(() =>
      request(app)
        .post(`/api/points/entries/${entry.id}/deduct`)
        .send({ amount: 3, reason: 'Only part completed', requestId: 'same-deduction' }),
    ),
  );
  assert.ok(attempts.every((r) => r.status === 200));
  assert.equal(wallet(f.eventId, entry.player_id).total, 102);
  assert.equal(
    (
      await request(app)
        .post(`/api/points/entries/${entry.id}/deduct`)
        .send({ amount: 3, reason: 'Too much', requestId: 'new-deduction' })
    ).status,
    409,
  );
  const view = await request(app).get('/api/points');
  assert.equal(view.body.budget.issued, 10);
  assert.equal(view.body.budget.available, 0, 'deductions do not create a new task budget');
  assert.equal((db.prepare("SELECT COUNT(*) AS n FROM admin_log WHERE action = 'points_deducted' AND target_id = ?").get(entry.id) as { n: number }).n, 1,
    'an idempotent retry creates neither a second deduction nor a second audit');
  db.exec(`CREATE TEMP TRIGGER fail_deduction_audit BEFORE INSERT ON admin_log
    WHEN NEW.action = 'points_deducted' BEGIN SELECT RAISE(ABORT, 'test deduction audit failure'); END;`);
  try {
    assert.equal((await request(app).post(`/api/points/entries/${entry.id}/deduct`)
      .send({ amount: 1, reason: 'Audit muss atomar sein', requestId: 'audit-failure' })).status, 500);
    assert.equal(wallet(f.eventId, entry.player_id).total, 102);
  } finally {
    db.exec('DROP TRIGGER fail_deduction_audit');
  }
  const ownEntry = db.prepare("SELECT id FROM point_entries WHERE event_id = ? AND player_id = ? AND source = 'start'").get(f.eventId, TEST_ADMIN_ID) as { id: string };
  const ownDeduction = await request(app).post(`/api/points/entries/${ownEntry.id}/deduct`)
    .send({ amount: 1, reason: 'Eigenen Anspruch berichtigt', requestId: 'own-deduction' });
  assert.equal(ownDeduction.status, 200, JSON.stringify(ownDeduction.body));
  assert.equal(wallet(f.eventId, TEST_ADMIN_ID).total, 99);
});

test('players bet on their own games; hidden tips lock and settle zero-sum, once, with a personal notification', async (t) => {
  const f = await fixture();
  const r = await round(f);
  const a = f.players[0],
    b = f.players[1];
  const bets = await Promise.all([
    request(app).put(`/api/points/rounds/${r.id}/tip`).set('x-test-player-id', a).send({ outcomeId: '0', stake: 10 }),
    request(app).put(`/api/points/rounds/${r.id}/tip`).set('x-test-player-id', b).send({ outcomeId: '1', stake: 5 }),
  ]);
  assert.ok(
    bets.every((v) => v.status === 200),
    JSON.stringify(bets.map((v) => v.body)),
  );
  assert.equal(bets[0].body.pot, null);
  assert.equal(bets[0].body.outcomes[1].stake, null);
  assert.deepEqual(wallet(f.eventId, a), { total: 100, held: 10, available: 90 });
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
  const result = await request(app)
    .post('/api/matches')
    .send({
      gameId: f.gameId,
      drawId: r.drawId,
      teams: r.outcomes.map((o) => ({ playerIds: o.playerIds })),
      winnerTeamIndex: 0,
    });
  assert.equal(result.status, 201, JSON.stringify(result.body));
  await Promise.all([request(app).get('/api/points'), request(app).get('/api/points')]);
  assert.equal(wallet(f.eventId, a).total, 105);
  assert.equal(wallet(f.eventId, b).total, 95);
  assert.equal(wallet(f.eventId, a).held, 0);
  assert.equal(
    db.prepare("SELECT COUNT(*) AS n FROM point_entries WHERE event_id = ? AND source = 'tip'").get(f.eventId) &&
      (
        db.prepare("SELECT COUNT(*) AS n FROM point_entries WHERE event_id = ? AND source = 'tip'").get(f.eventId) as {
          n: number;
        }
      ).n,
    2,
  );
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
          winnerTeamIndex: 1,
          bettingCorrection: { reason: 'Actually the other team won', revisions: [{ id: r.id, revision: 0 }] },
        }),
    ),
  );
  assert.deepEqual(corrections.map((v) => v.status).sort(), [200, 409]);
  assert.equal(wallet(f.eventId, a).total, 90);
  assert.equal(wallet(f.eventId, b).total, 110);
  assert.equal((await request(app).get('/api/points')).body.rounds[0].revision, 1);
  db.exec(`CREATE TEMP TRIGGER fail_void_audit BEFORE INSERT ON admin_log
    WHEN NEW.action = 'betting_settlement_voided' BEGIN SELECT RAISE(ABORT, 'test void audit failure'); END;`);
  try {
    assert.equal((await request(app).post(`/api/points/rounds/${r.id}/void`).set('x-test-player-id', a)
      .send({ reason: 'Audit muss atomar sein', revision: 1 })).status, 500);
    assert.deepEqual([wallet(f.eventId, a).total, wallet(f.eventId, b).total], [90, 110]);
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
});

test('parallel reservations obey available funds and event limits; closing prevents bets but keeps To-dos usable without credits', async () => {
  const f = await fixture({ initialPoints: 10, dailyLimit: 10 });
  const a = f.players[0],
    first = await round(f),
    second = await round(f);
  const attempts = await Promise.all(
    [first, second].map((r) =>
      request(app).put(`/api/points/rounds/${r.id}/tip`).set('x-test-player-id', a).send({ outcomeId: '0', stake: 10 }),
    ),
  );
  assert.deepEqual(attempts.map((r) => r.status).sort(), [200, 409]);
  const accepted = attempts[0].status === 200 ? first : second;
  assert.equal((await request(app).post(`/api/points/rounds/${accepted.id}/lock`).send({})).status, 200);
  assert.deepEqual(wallet(f.eventId, a), { total: 10, held: 0, available: 10 });
  const other = accepted.id === first.id ? second : first;
  assert.equal(
    (await request(app).post(`/api/points/rounds/${other.id}/refund`).send({ reason: 'Not played' })).status,
    200,
  );
  const taskIds: string[] = [];
  for (const rewarded of [true, false]) {
    const created = await request(app).post('/api/checklist/tasks/todo')
      .send({ playerId: TEST_ADMIN_ID, type: 'todo', title: rewarded ? 'Rewarded after closure' : 'Unrewarded after closure' });
    assert.equal(created.status, 201);
    const taskId = created.body.id ?? created.body.tasks[0].id;
    taskIds.push(taskId);
    db.prepare("UPDATE checklist_tasks SET points_value = 0, points_model = 'legacy' WHERE id = ?").run(taskId); // pre-upgrade task
    if (rewarded) assert.equal((await request(app).post(`/api/points/tasks/${taskId}/reward`)
      .send({ perPerson: 5, slots: 1 })).status, 201);
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
    const opened = await request(app)
      .post('/api/points/rounds')
      .send({ sourceType, sourceId, closesAt: Date.now() + 60000 });
    assert.equal(opened.status, 201, JSON.stringify(opened.body));
    rounds.push(opened.body);
    const tips = await Promise.all(
      f.players
        .slice(0, 2)
        .map((p, i) =>
          request(app)
            .put(`/api/points/rounds/${opened.body.id}/tip`)
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
          .post(`/api/points/rounds/${opened.body.id}/lock`)
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
  const entry = db
    .prepare("SELECT id FROM point_entries WHERE event_id = ? AND player_id = ? AND source = 'start'")
    .get(f.eventId, late) as { id: string };
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
    200,
  );
  assert.equal((await request(app).post('/api/points/close').send({})).status, 200);
  assert.equal(
    (db.prepare('SELECT COUNT(*) AS n FROM points_snapshots WHERE event_id = ?').get(f.eventId) as { n: number }).n,
    2,
  );
});

test('deadlines and pre-start changes refund unsafe pools; official round limits cannot be bypassed by redrawing', async () => {
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
  const early = await request(app)
    .post('/api/matches')
    .send({
      gameId: f.gameId,
      drawId: r.drawId,
      teams: r.outcomes.map((o) => ({ playerIds: o.playerIds })),
      winnerTeamIndex: 0,
    });
  assert.equal(early.status, 201);
  assert.equal((await request(app).get('/api/points')).body.rounds[0].status, 'refunded');
  assert.equal(wallet(f.eventId, f.players[0]).total, 100);
  const draw = await request(app)
    .post('/api/matchmaking')
    .send({ gameId: f.gameId, playerIds: f.players.slice(0, 2), teamCount: 2 });
  assert.equal(
    (
      await request(app)
        .post('/api/points/rounds')
        .send({ sourceType: 'draw', sourceId: draw.body.id ?? draw.body.drawId, closesAt: Date.now() + 60000 })
    ).status,
    409,
  );
  assert.equal((await request(app).put('/api/points/settings').send({ maxRounds: 1, maxStake: 11 })).status, 409);
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
});

test('result corrections keep original pools zero-sum even when the old winnings are already reserved elsewhere', async () => {
  const f = await fixture({ initialPoints: 10, maxStake: 20, dailyLimit: 40 });
  const first = await round(f);
  for (let i = 0; i < 2; i++)
    assert.equal(
      (
        await request(app)
          .put(`/api/points/rounds/${first.id}/tip`)
          .set('x-test-player-id', f.players[i])
          .send({ outcomeId: String(i), stake: 10 })
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
  const second = await round(f);
  assert.equal(
    (
      await request(app)
        .put(`/api/points/rounds/${second.id}/tip`)
        .set('x-test-player-id', f.players[0])
        .send({ outcomeId: '0', stake: 20 })
    ).status,
    200,
  );
  const corrected = await request(app)
    .patch(`/api/matches/${match.body.id}`)
    .send({
      winnerTeamIndex: 1,
      bettingCorrection: { reason: 'Score reversed', revisions: [{ id: first.id, revision: 0 }] },
    });
  assert.equal(corrected.status, 200, JSON.stringify(corrected.body));
  assert.deepEqual(wallet(f.eventId, f.players[0]), { total: 0, held: 20, available: -20 });
  assert.equal(wallet(f.eventId, f.players[1]).total, 20);
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

test('an orga-only LAN cannot open betting pools; simultaneous reward promises cannot overspend the budget', async () => {
  const f = await fixture({ maxRounds: 0, orgaBudget: 5 });
  const tasks = [];
  for (const title of ['Setup', 'Cleanup'])
    tasks.push(
      (await request(app).post('/api/checklist/tasks/todo').send({ playerId: TEST_ADMIN_ID, type: 'todo', title })).body
        .tasks[0].id as string,
    );
  for (const id of tasks) db.prepare("UPDATE checklist_tasks SET points_value = 0, points_model = 'legacy' WHERE id = ?").run(id); // pre-upgrade tasks
  const rewards = await Promise.all(
    tasks.map((id) => request(app).post(`/api/points/tasks/${id}/reward`).send({ perPerson: 5, slots: 1 })),
  );
  assert.deepEqual(rewards.map((r) => r.status).sort(), [201, 409]);
  const draw = (
    await request(app)
      .post('/api/matchmaking')
      .send({ gameId: f.gameId, playerIds: f.players.slice(0, 2), teamCount: 2 })
  ).body;
  assert.equal(
    (
      await request(app)
        .post('/api/points/rounds')
        .send({ sourceType: 'draw', sourceId: draw.id, closesAt: Date.now() + 60000 })
    ).status,
    409,
  );
  assert.equal((await request(app).get('/api/points')).body.budget.available, 0);
});

test('account erasure keeps other helpers credited, retains committed budget and anonymizes historical pool stakes', async () => {
  const f = await fixture({ orgaBudget: 5 });
  const task = await request(app)
    .post('/api/checklist/tasks/todo')
    .set('x-test-player-id', f.players[0])
    .send({ playerId: f.players[0], type: 'todo', title: 'Completed shared task' });
  const taskId = task.body.tasks[0].id;
  db.prepare("UPDATE checklist_tasks SET points_value = 0, points_model = 'legacy' WHERE id = ?").run(taskId); // pre-upgrade task
  await request(app).post(`/api/points/tasks/${taskId}/reward`).send({ perPerson: 5, slots: 1 });
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
      100,
      'task reward survives erasing its creator; lost bet remains',
    );
    const view = (await request(app).get('/api/points')).body;
    assert.equal(view.budget.available, 0, 'deleting the task creator cannot recycle the reward budget');
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
      const opened = await request(app)
        .post('/api/points/rounds')
        .send({
          sourceType,
          sourceId: sourceType === 'tournament' ? tournamentId : fixtureId,
          closesAt: Date.now() + 60000,
        });
      assert.equal(opened.status, 201, JSON.stringify(opened.body));
      roundId = opened.body.id;
      outcomes = opened.body.outcomes;
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
    assert.equal((await request(app).get('/api/points')).body.rounds[0].status, 'settled');
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
    assert.equal((await request(app).get('/api/points')).body.rounds[0].status, 'refunded');
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
