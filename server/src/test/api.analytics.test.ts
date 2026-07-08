// Integration tests for the deeper analytics endpoints: longest sessions,
// simultaneous-game time, the raw session log, day/time filtering, and the
// per-game concurrency timeseries.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../app';

const app = createApp();
let cs2GameId: string;
let rlGameId: string;
let playerA: string;
let apiKeyA: string;
let playerB: string;
let apiKeyB: string;

async function report(apiKey: string, processNames: string[]) {
  return request(app).post('/api/agent/report').set('x-api-key', apiKey).send({ processNames });
}

test('setup: two players and two seeded games', async () => {
  const a = await request(app).post('/api/players').send({ name: 'Analytics A' });
  const b = await request(app).post('/api/players').send({ name: 'Analytics B' });
  playerA = a.body.id;
  apiKeyA = a.body.api_key;
  playerB = b.body.id;
  apiKeyB = b.body.api_key;

  const games = await request(app).get('/api/games');
  cs2GameId = games.body.find((g: { name: string }) => g.name === 'Counter-Strike 2').id;
  rlGameId = games.body.find((g: { name: string }) => g.name === 'Rocket League').id;
});

test('GET /api/analytics/overview is empty before any sessions', async () => {
  const res = await request(app).get(`/api/analytics/overview?gameId=${cs2GameId}`);
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.longestSessionsPerPlayerGame, []);
});

test('longest session and simultaneous-game time reflect real sessions', async () => {
  // Player A opens both CS2 and Rocket League at once (multitasking).
  await report(apiKeyA, ['cs2.exe', 'rocketleague.exe']);
  await new Promise((r) => setTimeout(r, 60));
  // Player B just plays CS2 alone, briefly.
  await report(apiKeyB, ['cs2.exe']);
  await new Promise((r) => setTimeout(r, 60));
  await report(apiKeyB, []);
  await new Promise((r) => setTimeout(r, 60));
  await report(apiKeyA, []); // A closes everything

  const res = await request(app).get('/api/analytics/overview');
  assert.equal(res.status, 200);

  const cs2Record = res.body.longestSessionsPerGame.find((r: { gameId: string }) => r.gameId === cs2GameId);
  assert.ok(cs2Record);

  const aSimultaneous = res.body.simultaneousGameTime.find((r: { playerId: string }) => r.playerId === playerA);
  assert.ok(aSimultaneous, 'player A should show up in the multitasking list');
  assert.ok(aSimultaneous.maxSimultaneous >= 2);
  assert.ok(aSimultaneous.multiGameMs > 0);

  // Player B never had 2 games open, so shouldn't appear (filtered to >0).
  const bSimultaneous = res.body.simultaneousGameTime.find((r: { playerId: string }) => r.playerId === playerB);
  assert.equal(bSimultaneous, undefined);
});

test('GET /api/analytics/sessions returns a chronological log with names', async () => {
  const res = await request(app).get(`/api/analytics/sessions?playerId=${playerA}`);
  assert.equal(res.status, 200);
  assert.ok(res.body.length >= 2); // CS2 + Rocket League sessions for player A
  assert.ok(res.body.every((s: { playerName: string }) => s.playerName === 'Analytics A'));
});

test('GET /api/analytics/sessions filters by gameId', async () => {
  const res = await request(app).get(`/api/analytics/sessions?gameId=${rlGameId}`);
  assert.equal(res.status, 200);
  assert.ok(res.body.every((s: { gameId: string }) => s.gameId === rlGameId));
});

test('day/time range filtering excludes sessions outside the window', async () => {
  const farFuture = Date.now() + 24 * 60 * 60 * 1000;
  const res = await request(app).get(`/api/analytics/sessions?from=${farFuture}`);
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, []);
});

test('GET /api/analytics/overview rejects from > to', async () => {
  const res = await request(app).get('/api/analytics/overview?from=2000&to=1000');
  assert.equal(res.status, 400);
});

test('GET /api/analytics/concurrency requires gameId, from and to', async () => {
  const missingGame = await request(app).get('/api/analytics/concurrency?from=0&to=1000');
  assert.equal(missingGame.status, 400);

  const missingRange = await request(app).get(`/api/analytics/concurrency?gameId=${cs2GameId}`);
  assert.equal(missingRange.status, 400);
});

test('GET /api/analytics/concurrency buckets sessions for one game over a range', async () => {
  const from = Date.now() - 60_000;
  const to = Date.now() + 60_000;
  const res = await request(app).get(
    `/api/analytics/concurrency?gameId=${cs2GameId}&from=${from}&to=${to}&bucketMinutes=1`
  );
  assert.equal(res.status, 200);
  assert.equal(res.body.gameId, cs2GameId);
  assert.ok(Array.isArray(res.body.buckets));
  assert.ok(res.body.buckets.length >= 1);
});

test('GET /api/analytics/concurrency rejects an out-of-range bucketMinutes', async () => {
  const res = await request(app).get(
    `/api/analytics/concurrency?gameId=${cs2GameId}&from=0&to=1000&bucketMinutes=0`
  );
  assert.equal(res.status, 400);
});

test('GET /api/analytics/awards includes the Marathon-Zocker award with a player name', async () => {
  const res = await request(app).get('/api/analytics/awards');
  assert.equal(res.status, 200);
  const marathon = res.body.awards.find((a: { id: string }) => a.id === 'marathon');
  assert.ok(marathon);
  assert.ok(marathon.playerName);
  assert.ok(marathon.value);
});

test('GET /api/analytics/awards rejects from > to', async () => {
  const res = await request(app).get('/api/analytics/awards?from=2000&to=1000');
  assert.equal(res.status, 400);
});

test('eventId filters analytics precisely, independent of session timestamps', async () => {
  const firstEvent = await request(app).get('/api/events/active');

  // A session recorded in the first event.
  await report(apiKeyA, ['cs2.exe']);
  await new Promise((r) => setTimeout(r, 30));
  await report(apiKeyA, []);

  const beforeSwitch = await request(app).get(`/api/analytics/sessions?eventId=${firstEvent.body.id}`);
  const countBeforeSwitch = beforeSwitch.body.length;
  assert.ok(countBeforeSwitch > 0);

  // Switch to a new event and record a different session there.
  const secondEvent = await request(app).post('/api/events').send({ name: 'Zweites Event' });
  await report(apiKeyB, ['rocketleague.exe']);
  await new Promise((r) => setTimeout(r, 30));
  await report(apiKeyB, []);

  const secondSessions = await request(app).get(`/api/analytics/sessions?eventId=${secondEvent.body.id}`);
  assert.equal(secondSessions.body.length, 1, 'the new event should only contain the one new session');
  assert.equal(secondSessions.body[0].playerId, playerB);

  // The first event's own sessions must be unaffected by what happened after
  // the switch (exact event_id filtering, not an approximate date range).
  const afterSwitch = await request(app).get(`/api/analytics/sessions?eventId=${firstEvent.body.id}`);
  assert.equal(afterSwitch.body.length, countBeforeSwitch);

  const secondPlaytime = await request(app).get(`/api/stats/playtime?eventId=${secondEvent.body.id}`);
  assert.ok(secondPlaytime.body.entries.every((e: { playerId: string }) => e.playerId === playerB));

  const secondOverview = await request(app).get(`/api/analytics/overview?eventId=${secondEvent.body.id}`);
  assert.ok(
    secondOverview.body.longestSessionsPerPlayerGame.every((e: { playerId: string }) => e.playerId === playerB)
  );
});

test('GET /api/analytics/games ranks games by playtime with distinct player/session counts', async () => {
  const res = await request(app).get('/api/analytics/games');
  assert.equal(res.status, 200);
  const cs2 = res.body.games.find((g: { gameId: string }) => g.gameId === cs2GameId);
  assert.ok(cs2);
  assert.ok(cs2.playerCount >= 2); // both Analytics A and B played CS2
  assert.ok(cs2.sessionCount >= 2);
  assert.ok(cs2.totalFormatted);
});

// ---------- games-tournaments (matches, tournaments, draws, fun stats) ----------

let statP1: string;
let statP2: string;
let statP3: string;

test('setup: players + skills + matches + a tournament + a draw for games-tournaments stats', async () => {
  const p1 = await request(app).post('/api/players').send({ name: 'Stat P1' });
  const p2 = await request(app).post('/api/players').send({ name: 'Stat P2' });
  const p3 = await request(app).post('/api/players').send({ name: 'Stat P3' });
  statP1 = p1.body.id;
  statP2 = p2.body.id;
  statP3 = p3.body.id;

  // P1 is rated far below P2 for CS2, so P1 beating P2 is a clear underdog win.
  await request(app).put('/api/skills').send({ playerId: statP1, gameId: cs2GameId, rating: 2 });
  await request(app).put('/api/skills').send({ playerId: statP2, gameId: cs2GameId, rating: 9 });

  // P1 vs P2 twice (the rivalry), once each way so it's not just a repeat of
  // the underdog match.
  await request(app)
    .post('/api/matches')
    .send({ gameId: cs2GameId, teams: [{ playerIds: [statP1] }, { playerIds: [statP2] }], winnerTeamIndex: 0 });
  await request(app)
    .post('/api/matches')
    .send({ gameId: cs2GameId, teams: [{ playerIds: [statP1] }, { playerIds: [statP2] }], winnerTeamIndex: 1 });

  // P1+P3 team up and win (the duo).
  await request(app)
    .post('/api/matches')
    .send({
      gameId: cs2GameId,
      teams: [{ playerIds: [statP1, statP3] }, { playerIds: [statP2] }],
      winnerTeamIndex: 0,
    });

  await request(app)
    .post('/api/tournaments')
    .send({ gameId: cs2GameId, format: 'round_robin', teams: [{ playerIds: [statP1] }, { playerIds: [statP2] }] });

  await request(app)
    .post('/api/matchmaking')
    .send({ gameId: cs2GameId, playerIds: [statP1, statP2, statP3] });
});

test('GET /api/analytics/games-tournaments aggregates matches, tournaments, draws and fun stats', async () => {
  const res = await request(app).get('/api/analytics/games-tournaments');
  assert.equal(res.status, 200);

  assert.ok(res.body.matches.total >= 3);
  const cs2Matches = res.body.matches.byGame.find((g: { gameId: string }) => g.gameId === cs2GameId);
  assert.ok(cs2Matches.count >= 3);

  assert.ok(res.body.tournaments.total >= 1);
  const rrFormat = res.body.tournaments.byFormat.find((f: { format: string }) => f.format === 'round_robin');
  assert.ok(rrFormat);

  assert.ok(res.body.draws.total >= 1);

  assert.ok(res.body.fun.biggestRivalry);
  // 2 direct P1-vs-P2 matches, plus the duo match (P1+P3 vs P2) also counts
  // as a P1-vs-P2 encounter — 3 total.
  assert.equal(res.body.fun.biggestRivalry.count, 3);
  assert.deepEqual(
    [res.body.fun.biggestRivalry.playerA.id, res.body.fun.biggestRivalry.playerB.id].sort(),
    [statP1, statP2].sort()
  );

  assert.ok(res.body.fun.bestDuo);
  assert.deepEqual([res.body.fun.bestDuo.playerA.id, res.body.fun.bestDuo.playerB.id].sort(), [statP1, statP3].sort());
  assert.equal(res.body.fun.bestDuo.gamesTogether, 1);
  assert.equal(res.body.fun.bestDuo.winsTogether, 1);

  assert.ok(res.body.fun.biggestUnderdogWin);
  assert.ok(res.body.fun.biggestUnderdogWin.winners.some((w: { id: string }) => w.id === statP1));
});

test('GET /api/analytics/games-tournaments filters by eventId', async () => {
  const ghostEvent = await request(app).post('/api/events').send({ name: 'Leeres Event' });
  const res = await request(app).get(`/api/analytics/games-tournaments?eventId=${ghostEvent.body.id}`);
  assert.equal(res.status, 200);
  assert.equal(res.body.matches.total, 0);
  assert.equal(res.body.tournaments.total, 0);
  assert.equal(res.body.draws.total, 0);
  assert.equal(res.body.fun.biggestRivalry, null);
});
