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
    Array.from({ length: 10 }, () => request(app).post('/api/votes/start').send({ mode: 'single' }))
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

test('simultaneous promotes of the same suggestion: exactly one wins', async () => {
  const created = await request(app).post('/api/games').send({ name: 'Race Suggestion', status: 'suggestion' });
  assert.equal(created.status, 201);

  const results = await Promise.all(
    Array.from({ length: 6 }, () => request(app).post(`/api/games/${created.body.id}/promote`))
  );
  const counts = statusCounts(results.map((r) => r.status));
  assert.equal(counts[200], 1, JSON.stringify(counts));
  assert.equal(counts[409], 5, JSON.stringify(counts));

  const after = await request(app).get(`/api/games/${created.body.id}`);
  assert.equal(after.body.status, 'catalog');
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

test('simultaneous draft starts: exactly one draft opens', async () => {
  const results = await Promise.all(
    Array.from({ length: 6 }, () =>
      request(app)
        .post('/api/draft/start')
        .send({ gameId: gameIds[1], captainIds: [playerIds[0], playerIds[1]], poolPlayerIds: [playerIds[2], playerIds[3]] })
    )
  );
  const counts = statusCounts(results.map((r) => r.status));
  assert.equal(counts[201], 1, JSON.stringify(counts));
  assert.equal(counts[409], 5, JSON.stringify(counts));
});

test('simultaneous draft picks: turn and pool are enforced, board stays consistent', async () => {
  // Captain A is on turn; A double-taps a pick while B tries to pick out of
  // turn at the same moment — exactly one pick lands.
  const results = await Promise.all([
    request(app).post('/api/draft/pick').send({ playerId: playerIds[0], pickPlayerId: playerIds[2] }),
    request(app).post('/api/draft/pick').send({ playerId: playerIds[0], pickPlayerId: playerIds[2] }),
    request(app).post('/api/draft/pick').send({ playerId: playerIds[1], pickPlayerId: playerIds[3] }),
  ]);
  const counts = statusCounts(results.map((r) => r.status));
  assert.equal(counts[200], 1, JSON.stringify(counts));

  const state = await request(app).get('/api/draft');
  // One pick happened; with one pool player left it was auto-assigned, so
  // the draft is complete and every player is on exactly one team.
  assert.equal(state.body.draft.status, 'completed');
  const allIds = state.body.draft.teams.flatMap((t: { players: Array<{ id: string }> }) =>
    t.players.map((p) => p.id)
  );
  assert.equal(new Set(allIds).size, allIds.length);
  assert.equal(allIds.length, 4);
});

test('closing a food order while others still add items: stragglers get a clean 409', async () => {
  const create = await request(app)
    .post('/api/food-orders')
    .send({ playerId: playerIds[0], title: 'Race-Pizza' });
  assert.equal(create.status, 201);
  const orderId = create.body.id;

  const results = await Promise.all([
    request(app).post(`/api/food-orders/${orderId}/close`),
    request(app).post(`/api/food-orders/${orderId}/close`),
    request(app).post(`/api/food-orders/${orderId}/items`).send({ playerId: playerIds[1], description: 'Salami' }),
    request(app).post(`/api/food-orders/${orderId}/items`).send({ playerId: playerIds[2], description: 'Funghi' }),
  ]);
  const closeCounts = statusCounts(results.slice(0, 2).map((r) => r.status));
  assert.equal(closeCounts[200], 1, JSON.stringify(closeCounts));
  assert.equal(closeCounts[409], 1, JSON.stringify(closeCounts));
  // Each item either made it in before the close (201) or was rejected
  // (409) — never silently appended to a closed order.
  assert.ok(results.slice(2).every((r) => r.status === 201 || r.status === 409));

  const list = await request(app).get('/api/food-orders');
  const order = list.body.orders.find((o: { id: string }) => o.id === orderId);
  assert.equal(order.open, false);
  const accepted = results.slice(2).filter((r) => r.status === 201).length;
  assert.equal(order.items.length, accepted);
});

test('simultaneous carpool joins: exactly seatsTotal of them win', async () => {
  const driver = playerIds[0];
  const created = await request(app)
    .post('/api/arrivals/carpools')
    .send({ playerId: driver, direction: 'arrival', label: 'Race-Carpool', seatsTotal: 2 });
  assert.equal(created.status, 201);
  const carpoolId = created.body.id;

  // Reuse the setup players plus a couple more so there are clearly more
  // joiners than free seats (2).
  const extra = await Promise.all(
    ['Race E', 'Race F'].map((name) => request(app).post('/api/players').send({ name }))
  );
  const joiners = [...playerIds.slice(1), ...extra.map((r) => r.body.id)];

  const results = await Promise.all(
    joiners.map((playerId) => request(app).post(`/api/arrivals/carpools/${carpoolId}/join`).send({ playerId }))
  );
  const counts = statusCounts(results.map((r) => r.status));
  assert.equal(counts[200], 2, JSON.stringify(counts));
  assert.equal(counts[409], joiners.length - 2, JSON.stringify(counts));

  const list = await request(app).get('/api/arrivals');
  const carpool = list.body.carpools.arrival.find((c: { id: string }) => c.id === carpoolId);
  assert.equal(carpool.members.length, 3); // driver + 2 passengers
  assert.equal(carpool.seatsFree, 0);
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

test('two results submitted for the same draw at once: exactly one is recorded and claims the draw', async () => {
  const draw = await request(app)
    .post('/api/matchmaking')
    .send({ gameId: gameIds[0], playerIds: playerIds.slice(0, 2), teamCount: 2 });

  const results = await Promise.all(
    Array.from({ length: 2 }, () =>
      request(app)
        .post('/api/matches')
        .send({
          gameId: gameIds[0],
          teams: [{ playerIds: [playerIds[0]] }, { playerIds: [playerIds[1]] }],
          drawId: draw.body.id,
        })
    )
  );
  const counts = statusCounts(results.map((r) => r.status));
  assert.equal(counts[201], 1, JSON.stringify(counts));
  assert.equal(counts[409], 1, JSON.stringify(counts));

  const winner = results.find((r) => r.status === 201)!;
  const history = await request(app).get(`/api/matchmaking/history?gameId=${gameIds[0]}`);
  const linked = history.body.history.find((h: { id: string }) => h.id === draw.body.id);
  assert.equal(linked.matchId, winner.body.id);
});

test('simultaneous test-user seeding: no duplicate names or double-booked seats', async () => {
  // Both requests run their whole seed in one synchronous transaction, so
  // they serialize — the second must see the first's taken names and seats.
  const results = await Promise.all(
    Array.from({ length: 2 }, () => request(app).post('/api/admin/test-users').send({ count: 3 }))
  );
  const counts = statusCounts(results.map((r) => r.status));
  assert.equal(counts[201], 2, JSON.stringify(counts));

  const roster = await request(app).get('/api/players');
  const testUsers = roster.body.filter((p: { is_test: number }) => p.is_test === 1);
  assert.equal(testUsers.length, 6);
  const names = testUsers.map((p: { name: string }) => p.name.toLowerCase());
  assert.equal(new Set(names).size, names.length, 'names must be unique');

  const layout = await request(app).get('/api/seating/layout');
  const seatKeys = layout.body.layout.assignments.map((a: { side: string; seat: number }) => `${a.side}:${a.seat}`);
  assert.equal(new Set(seatKeys).size, seatKeys.length, 'no seat may be double-booked');

  await request(app).delete('/api/admin/test-users');
});
