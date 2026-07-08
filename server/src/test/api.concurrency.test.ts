// Concurrency/race regression tests: on a LAN, 15 phones fire actions at
// nearly the same time (everyone taps "Abstimmung starten" when someone
// shouts "vote!"). All handlers are synchronous (better-sqlite3), so requests
// serialize — these tests pin down the *guards* that make the second-arriving
// request fail cleanly instead of corrupting shared state, and would catch a
// regression if a handler ever became async between check and write.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../app';

const app = createApp();

const statusCounts = (statuses: number[]) =>
  statuses.reduce<Record<number, number>>((acc, s) => ((acc[s] = (acc[s] ?? 0) + 1), acc), {});

let playerIds: string[];
let gameIds: string[];

test('setup: players and games', async () => {
  playerIds = [];
  for (const name of ['Race A', 'Race B', 'Race C', 'Race D']) {
    const res = await request(app).post('/api/players').send({ name });
    playerIds.push(res.body.id);
  }
  const games = await request(app).get('/api/games');
  gameIds = games.body.slice(0, 3).map((g: { id: string }) => g.id);
});

test('simultaneous vote starts: exactly one round opens', async () => {
  const results = await Promise.all(
    Array.from({ length: 10 }, () => request(app).post('/api/votes/start'))
  );
  const counts = statusCounts(results.map((r) => r.status));
  assert.equal(counts[201], 1, JSON.stringify(counts));
  assert.equal(counts[409], 9, JSON.stringify(counts));

  const state = await request(app).get('/api/votes');
  assert.equal(state.body.open, true);
  assert.equal(state.body.round, 1);
});

test('double-tapped and simultaneous votes: one vote per player, last choice wins', async () => {
  const results = await Promise.all(
    playerIds.flatMap((playerId) => [
      request(app).post('/api/votes').send({ playerId, gameId: gameIds[0] }),
      request(app).post('/api/votes').send({ playerId, gameId: gameIds[1] }),
    ])
  );
  assert.ok(results.every((r) => r.status === 200), JSON.stringify(statusCounts(results.map((r) => r.status))));

  const state = await request(app).get('/api/votes');
  assert.equal(state.body.totalVotes, playerIds.length);
});

test('simultaneous closes plus late casts: one close wins, stragglers are cleanly rejected', async () => {
  const results = await Promise.all([
    request(app).post('/api/votes/close'),
    request(app).post('/api/votes/close'),
    request(app).post('/api/votes').send({ playerId: playerIds[0], gameId: gameIds[0] }),
    request(app).post('/api/votes').send({ playerId: playerIds[1], gameId: gameIds[0] }),
  ]);
  const closeCounts = statusCounts(results.slice(0, 2).map((r) => r.status));
  assert.equal(closeCounts[200], 1, JSON.stringify(closeCounts));
  assert.equal(closeCounts[409], 1, JSON.stringify(closeCounts));
  // A cast either landed before the close (200) or was rejected (409) —
  // never accepted into an already-closed round.
  assert.ok(results.slice(2).every((r) => r.status === 200 || r.status === 409));
});

test('simultaneous creates with the same name: exactly one player/game wins', async () => {
  const players = await Promise.all(
    Array.from({ length: 6 }, () => request(app).post('/api/players').send({ name: 'Race Twin' }))
  );
  const pCounts = statusCounts(players.map((r) => r.status));
  assert.equal(pCounts[201], 1, JSON.stringify(pCounts));
  assert.equal(pCounts[409], 5, JSON.stringify(pCounts));

  const games = await Promise.all(
    Array.from({ length: 6 }, () => request(app).post('/api/games').send({ name: 'Race Game' }))
  );
  const gCounts = statusCounts(games.map((r) => r.status));
  assert.equal(gCounts[201], 1, JSON.stringify(gCounts));
  assert.equal(gCounts[409], 5, JSON.stringify(gCounts));
});

test('conflicting simultaneous tournament reports: one result, one leaderboard match, consistent bracket', async () => {
  const create = await request(app)
    .post('/api/tournaments')
    .send({
      gameId: gameIds[0],
      format: 'single_elimination',
      teams: [
        { name: 'R1', playerIds: [playerIds[0]] },
        { name: 'R2', playerIds: [playerIds[1]] },
        { name: 'R3', playerIds: [playerIds[2]] },
        { name: 'R4', playerIds: [playerIds[3]] },
      ],
    });
  assert.equal(create.status, 201);
  const match = create.body.matches.find((m: { round: number }) => m.round === 1);

  const before = (await request(app).get(`/api/matches?gameId=${gameIds[0]}`)).body.length;
  const results = await Promise.all([
    request(app)
      .post(`/api/tournaments/${create.body.id}/matches/${match.id}/result`)
      .send({ winnerTeamId: match.teamAId }),
    request(app)
      .post(`/api/tournaments/${create.body.id}/matches/${match.id}/result`)
      .send({ winnerTeamId: match.teamBId }),
  ]);
  const counts = statusCounts(results.map((r) => r.status));
  assert.equal(counts[200], 1, JSON.stringify(counts));
  assert.equal(counts[409], 1, JSON.stringify(counts));

  const after = (await request(app).get(`/api/matches?gameId=${gameIds[0]}`)).body.length;
  assert.equal(after, before + 1);

  // The final's slot must match whichever report actually won the race.
  const detail = await request(app).get(`/api/tournaments/${create.body.id}`);
  const decided = detail.body.matches.find((m: { id: string }) => m.id === match.id);
  const final = detail.body.matches.find((m: { round: number }) => m.round === 2);
  assert.equal(final.teamAId, decided.winnerTeamId);
});

test('two events starting tracking simultaneously: exactly one wins', async () => {
  const now = Date.now();
  const events = await Promise.all(
    ['Race Event A', 'Race Event B'].map((name) =>
      request(app).post('/api/events').send({ name, startsAt: now, endsAt: now + 86_400_000 })
    )
  );
  const results = await Promise.all(
    events.map((e) => request(app).post(`/api/events/${e.body.id}/tracking/start`))
  );
  const counts = statusCounts(results.map((r) => r.status));
  assert.equal(counts[200], 1, JSON.stringify(counts));
  assert.equal(counts[409], 1, JSON.stringify(counts));
});
