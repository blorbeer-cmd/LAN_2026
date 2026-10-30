import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createTestApp, TEST_ADMIN_ID, DEFAULT_GROUP_ID } from './testApp';
import { createEvent, setParticipants } from '../events';
import { setActiveEventForPlayer } from '../eventContext';
import { db } from '../db';
import { wallet } from '../points';
import { buildPersonalDataExport, deleteAccount } from '../privacyService';
import { config } from '../config';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const app = createTestApp();
let sequence = 0;
async function fixture(config: object = {}) {
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

test('points start once per accepted participant, preserve event access, and block member administration', async () => {
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
});

test('task completion awards promised slots immediately and once, with atomic budget and partial administrative deductions', async () => {
  const f = await fixture({ orgaBudget: 10 });
  const task = await request(app)
    .post('/api/checklist/tasks/todo')
    .send({ playerId: TEST_ADMIN_ID, type: 'todo', title: 'Cable cleanup' });
  assert.equal(task.status, 201, JSON.stringify(task.body));
  const id = task.body.id ?? task.body.tasks?.[0]?.id;
  assert.ok(id, JSON.stringify(task.body));
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
});

test('players bet on their own games; hidden tips lock and settle zero-sum, once, with a personal notification', async () => {
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
  const corrections = await Promise.all(
    [0, 1].map(() =>
      request(app)
        .patch(`/api/matches/${result.body.id}`)
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
  const voids = await Promise.all(
    [0, 1].map(() =>
      request(app).post(`/api/points/rounds/${r.id}/void`).send({ reason: 'Invalid game', revision: 1 }),
    ),
  );
  assert.deepEqual(voids.map((v) => v.status).sort(), [200, 409]);
  assert.equal(wallet(f.eventId, a).total, 100);
  assert.equal(wallet(f.eventId, b).total, 100);
  assert.equal((await request(app).patch(`/api/matches/${result.body.id}`).send({ winnerTeamIndex: 1 })).status, 200);
  assert.equal((await request(app).get('/api/points')).body.rounds[0].status, 'refunded');
});

test('parallel reservations obey available funds and event limits; empty opposition refunds, and closing prevents new bets', async () => {
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
  assert.equal((await request(app).post('/api/points/close').send({})).status, 200);
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
    organisation: { bettingTips: unknown[]; pointEntries: unknown[] };
  };
  assert.equal(exported.organisation.bettingTips.length, 2);
  assert.equal(exported.organisation.pointEntries.length, 7);
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
