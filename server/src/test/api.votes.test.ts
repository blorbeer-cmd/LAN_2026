// Integration tests for the "what's next" voting flow (FR-19..21).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../app';

const app = createApp();
let playerA: string;
let playerB: string;
let gameCs2: string;
let gameRl: string;

test('setup: players and games for voting', async () => {
  const a = await request(app).post('/api/players').send({ name: 'Voter A' });
  const b = await request(app).post('/api/players').send({ name: 'Voter B' });
  playerA = a.body.id;
  playerB = b.body.id;

  const games = await request(app).get('/api/games');
  gameCs2 = games.body.find((g: { name: string }) => g.name === 'Counter-Strike 2').id;
  gameRl = games.body.find((g: { name: string }) => g.name === 'Rocket League').id;
});

test('GET /api/votes with no round yet: closed, no votes', async () => {
  const res = await request(app).get('/api/votes');
  assert.equal(res.status, 200);
  assert.equal(res.body.open, false);
  assert.equal(res.body.round, 0);
  assert.equal(res.body.totalVotes, 0);
});

test('POST /api/votes rejects a vote when no round is open', async () => {
  const res = await request(app).post('/api/votes').send({ playerId: playerA, gameId: gameCs2 });
  assert.equal(res.status, 409);
});

test('POST /api/votes/close rejects closing when nothing is open', async () => {
  const res = await request(app).post('/api/votes/close');
  assert.equal(res.status, 409);
});

test('POST /api/votes/start opens a round', async () => {
  const res = await request(app).post('/api/votes/start');
  assert.equal(res.status, 201);
  assert.equal(res.body.open, true);
  assert.equal(res.body.round, 1);
});

test('POST /api/votes/start rejects starting a second round while one is open', async () => {
  const res = await request(app).post('/api/votes/start');
  assert.equal(res.status, 409);
});

test('POST /api/votes rejects an unknown player or game', async () => {
  const badPlayer = await request(app).post('/api/votes').send({ playerId: 'ghost', gameId: gameCs2 });
  assert.equal(badPlayer.status, 404);
  const badGame = await request(app).post('/api/votes').send({ playerId: playerA, gameId: 'ghost' });
  assert.equal(badGame.status, 404);
});

test('players vote and the tally updates live', async () => {
  await request(app).post('/api/votes').send({ playerId: playerA, gameId: gameCs2 });
  await request(app).post('/api/votes').send({ playerId: playerB, gameId: gameCs2 });

  const res = await request(app).get('/api/votes');
  assert.equal(res.body.totalVotes, 2);
  const cs2Result = res.body.results.find((r: { gameId: string }) => r.gameId === gameCs2);
  assert.equal(cs2Result.votes, 2);
});

test('re-voting changes the player\'s previous choice instead of adding a second vote', async () => {
  await request(app).post('/api/votes').send({ playerId: playerA, gameId: gameRl });

  const res = await request(app).get('/api/votes');
  assert.equal(res.body.totalVotes, 2); // still 2 voters total, not 3
  const cs2Result = res.body.results.find((r: { gameId: string }) => r.gameId === gameCs2);
  const rlResult = res.body.results.find((r: { gameId: string }) => r.gameId === gameRl);
  assert.equal(cs2Result.votes, 1);
  assert.equal(rlResult.votes, 1);
});

test('POST /api/votes/close reports the winner(s)', async () => {
  // Currently tied 1-1 (CS2 vs Rocket League) after the re-vote above.
  await request(app).post('/api/votes').send({ playerId: playerB, gameId: gameRl }); // RL now leads 2-0... wait CS2 has 0 now
  const res = await request(app).post('/api/votes/close');
  assert.equal(res.status, 200);
  assert.equal(res.body.open, false);
  assert.deepEqual(res.body.winnerGameIds, [gameRl]);
});

test('a new round starts fresh (previous votes do not carry over)', async () => {
  const started = await request(app).post('/api/votes/start');
  assert.equal(started.body.round, 2);
  assert.equal(started.body.totalVotes, 0);
});

test('POST /api/votes/cancel discards the round without a winner', async () => {
  await request(app).post('/api/votes').send({ playerId: playerA, gameId: gameCs2 });
  const res = await request(app).post('/api/votes/cancel');
  assert.equal(res.status, 200);
  assert.equal(res.body.open, false);
  assert.equal(res.body.totalVotes, 0);
});

test('POST /api/votes/cancel rejects when nothing is open', async () => {
  const res = await request(app).post('/api/votes/cancel');
  assert.equal(res.status, 409);
});

test('GET /api/votes/history lists closed rounds, newest first, with their winner(s)', async () => {
  const res = await request(app).get('/api/votes/history');
  assert.equal(res.status, 200);
  // Round 1 closed with Rocket League winning; round 2 was cancelled, so it
  // must not show up here at all.
  assert.equal(res.body.history.length, 1);
  const [entry] = res.body.history;
  assert.equal(entry.round, 1);
  assert.equal(entry.totalVotes, 2);
  assert.deepEqual(
    entry.winners.map((w: { gameId: string }) => w.gameId),
    [gameRl]
  );
});

test('GET /api/votes/history still lists a round nobody voted in', async () => {
  await request(app).post('/api/votes/start');
  const res = await request(app).post('/api/votes/close');
  assert.deepEqual(res.body.winnerGameIds, []);

  const history = await request(app).get('/api/votes/history');
  const entry = history.body.history.find((h: { round: number }) => h.round === res.body.round);
  assert.ok(entry, 'the empty round should still appear in history');
  assert.equal(entry.totalVotes, 0);
  assert.deepEqual(entry.winners, []);
});

test('a fresh round with no votes yet is sorted by aggregate "Bock" rating (Beliebtheit)', async () => {
  // Rocket League gets rated much higher than CS2 by both players; with no
  // votes cast yet in the new round, the results order should already
  // reflect that instead of falling back to alphabetical order.
  await request(app).put('/api/preferences').send({ playerId: playerA, gameId: gameCs2, rating: 2 });
  await request(app).put('/api/preferences').send({ playerId: playerB, gameId: gameCs2, rating: 2 });
  await request(app).put('/api/preferences').send({ playerId: playerA, gameId: gameRl, rating: 9 });
  await request(app).put('/api/preferences').send({ playerId: playerB, gameId: gameRl, rating: 10 });

  const started = await request(app).post('/api/votes/start');
  assert.equal(started.body.open, true);
  const res = await request(app).get('/api/votes');
  const rlIndex = res.body.results.findIndex((r: { gameId: string }) => r.gameId === gameRl);
  const cs2Index = res.body.results.findIndex((r: { gameId: string }) => r.gameId === gameCs2);
  assert.ok(rlIndex < cs2Index, 'Rocket League (higher avg preference) should be sorted before CS2');

  const rlResult = res.body.results.find((r: { gameId: string }) => r.gameId === gameRl);
  assert.equal(rlResult.avgPreference, 9.5);
  assert.equal(rlResult.preferenceCount, 2);

  await request(app).post('/api/votes/cancel');
});

test('POST /api/votes/start rejects an invalid mode', async () => {
  const res = await request(app).post('/api/votes/start').send({ mode: 'nonsense' });
  assert.equal(res.status, 400);
});

test('points mode: start, cast, and close a round', async () => {
  const started = await request(app).post('/api/votes/start').send({ mode: 'points' });
  assert.equal(started.status, 201);
  assert.equal(started.body.mode, 'points');

  // A single-mode vote is rejected once the round is in points mode.
  const wrongMode = await request(app).post('/api/votes').send({ playerId: playerA, gameId: gameCs2 });
  assert.equal(wrongMode.status, 409);

  // No cap on how many games a player can rate - every seeded game at once is fine.
  const allGames = await request(app).get('/api/games');
  const noCap = await request(app)
    .post('/api/votes/points')
    .send({
      playerId: playerA,
      entries: allGames.body.map((g: { id: string }) => ({ gameId: g.id, points: 1 })),
    });
  assert.equal(noCap.status, 200);
  assert.equal(noCap.body.results.filter((r: { points: number }) => r.points > 0).length, allGames.body.length);

  const duplicateGame = await request(app)
    .post('/api/votes/points')
    .send({
      playerId: playerA,
      entries: [
        { gameId: gameCs2, points: 5 },
        { gameId: gameCs2, points: 6 },
      ],
    });
  assert.equal(duplicateGame.status, 400);

  const outOfRange = await request(app)
    .post('/api/votes/points')
    .send({ playerId: playerA, entries: [{ gameId: gameCs2, points: 11 }] });
  assert.equal(outOfRange.status, 400);

  const castA = await request(app)
    .post('/api/votes/points')
    .send({
      playerId: playerA,
      entries: [
        { gameId: gameCs2, points: 10 },
        { gameId: gameRl, points: 4 },
      ],
    });
  assert.equal(castA.status, 200);

  const castB = await request(app)
    .post('/api/votes/points')
    .send({ playerId: playerB, entries: [{ gameId: gameRl, points: 8 }] });
  assert.equal(castB.status, 200);

  const mine = await request(app).get(`/api/votes/mine?playerId=${playerA}`);
  assert.equal(mine.status, 200);
  assert.equal(mine.body.mode, 'points');
  assert.equal(mine.body.entries.length, 2);

  // Resubmitting replaces the player's previous set entirely.
  const recastA = await request(app)
    .post('/api/votes/points')
    .send({ playerId: playerA, entries: [{ gameId: gameCs2, points: 3 }] });
  assert.equal(recastA.status, 200);
  const mineAfter = await request(app).get(`/api/votes/mine?playerId=${playerA}`);
  assert.equal(mineAfter.body.entries.length, 1);
  assert.equal(mineAfter.body.entries[0].gameId, gameCs2);
  assert.equal(mineAfter.body.entries[0].points, 3);

  // A points-mode submission is rejected once the round is in single mode... but here it's still points mode,
  // so a points cast for an unknown game 404s instead.
  const unknownGame = await request(app)
    .post('/api/votes/points')
    .send({ playerId: playerB, entries: [{ gameId: 'ghost', points: 5 }] });
  assert.equal(unknownGame.status, 404);

  const res = await request(app).get('/api/votes');
  const cs2Result = res.body.results.find((r: { gameId: string }) => r.gameId === gameCs2);
  const rlResult = res.body.results.find((r: { gameId: string }) => r.gameId === gameRl);
  assert.equal(cs2Result.points, 3); // player A's replaced entry
  assert.equal(rlResult.points, 8); // only player B still has RL

  const closed = await request(app).post('/api/votes/close');
  assert.equal(closed.status, 200);
  assert.deepEqual(closed.body.winnerGameIds, [gameRl]);

  const history = await request(app).get('/api/votes/history');
  const entry = history.body.history.find((h: { round: number }) => h.round === closed.body.round);
  assert.ok(entry);
  assert.equal(entry.mode, 'points');
});

test('points mode: submitting an empty entries array clears a player\'s previous points', async () => {
  await request(app).post('/api/votes/start').send({ mode: 'points' });
  await request(app)
    .post('/api/votes/points')
    .send({ playerId: playerA, entries: [{ gameId: gameCs2, points: 7 }] });

  const cleared = await request(app).post('/api/votes/points').send({ playerId: playerA, entries: [] });
  assert.equal(cleared.status, 200);

  const mine = await request(app).get(`/api/votes/mine?playerId=${playerA}`);
  assert.deepEqual(mine.body.entries, []);

  const res = await request(app).get('/api/votes');
  const cs2Result = res.body.results.find((r: { gameId: string }) => r.gameId === gameCs2);
  assert.equal(cs2Result.points, 0);

  await request(app).post('/api/votes/cancel');
});

test('points endpoint is rejected while a round is in single mode', async () => {
  await request(app).post('/api/votes/start');
  const res = await request(app)
    .post('/api/votes/points')
    .send({ playerId: playerA, entries: [{ gameId: gameCs2, points: 5 }] });
  assert.equal(res.status, 409);
  await request(app).post('/api/votes/cancel');
});
