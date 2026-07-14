// Integration tests for match-result CRUD and the aggregated leaderboard it
// feeds (FR-22..25).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../app';

const app = createApp();
let gameId: string;
let playerA: string;
let playerB: string;
let playerC: string;
let matchId: string;

test('setup: a game and three players', async () => {
  const game = await request(app).post('/api/games').send({ name: 'Leaderboard Test Game' });
  gameId = game.body.id;
  const a = await request(app).post('/api/players').send({ name: 'LB Alice' });
  const b = await request(app).post('/api/players').send({ name: 'LB Bob' });
  const c = await request(app).post('/api/players').send({ name: 'LB Carol' });
  playerA = a.body.id;
  playerB = b.body.id;
  playerC = c.body.id;
});

test('POST /api/matches rejects a player in two teams at once', async () => {
  const res = await request(app)
    .post('/api/matches')
    .send({ gameId, teams: [{ playerIds: [playerA] }, { playerIds: [playerA] }] });
  assert.equal(res.status, 400);
});

test('POST /api/matches rejects fewer than 2 teams', async () => {
  const res = await request(app)
    .post('/api/matches')
    .send({ gameId, teams: [{ playerIds: [playerA] }] });
  assert.equal(res.status, 400);
});

test('POST /api/matches rejects an unknown player', async () => {
  const res = await request(app)
    .post('/api/matches')
    .send({ gameId, teams: [{ playerIds: [playerA] }, { playerIds: ['ghost'] }] });
  assert.equal(res.status, 404);
});

test('POST /api/matches records a result with a winning team', async () => {
  const res = await request(app)
    .post('/api/matches')
    .send({
      gameId,
      teams: [{ playerIds: [playerA] }, { playerIds: [playerB, playerC] }],
      winnerTeamIndex: 1,
    });
  assert.equal(res.status, 201);
  assert.equal(res.body.gameId, gameId);
  assert.equal(res.body.winnerTeamIndex, 1);
  matchId = res.body.id;
});

test('GET /api/matches lists the recorded match', async () => {
  const res = await request(app).get(`/api/matches?gameId=${gameId}`);
  assert.equal(res.status, 200);
  assert.equal(res.body.length, 1);
  assert.equal(res.body[0].id, matchId);
});

test('GET /api/leaderboard reflects points from the recorded match', async () => {
  const res = await request(app).get(`/api/leaderboard?gameId=${gameId}`);
  assert.equal(res.status, 200);
  const byId = new Map(res.body.standings.map((s: { playerId: string }) => [s.playerId, s]));
  assert.ok((byId.get(playerB) as { wins: number }).wins === 1);
  assert.ok((byId.get(playerA) as { wins: number }).wins === 0);
  // Winner's points should be strictly higher than the loser's.
  assert.ok((byId.get(playerB) as { points: number }).points > (byId.get(playerA) as { points: number }).points);
});

test('PATCH /api/matches/:id corrects a mistaken winner', async () => {
  const res = await request(app).patch(`/api/matches/${matchId}`).send({ winnerTeamIndex: 0 });
  assert.equal(res.status, 200);
  assert.equal(res.body.winnerTeamIndex, 0);

  const board = await request(app).get(`/api/leaderboard?gameId=${gameId}`);
  const a = board.body.standings.find((s: { playerId: string }) => s.playerId === playerA);
  assert.equal(a.wins, 1);
});

test('PATCH /api/matches/:id 404s for an unknown id', async () => {
  const res = await request(app).patch('/api/matches/nope').send({ winnerTeamIndex: 0 });
  assert.equal(res.status, 404);
});

test('DELETE /api/matches/:id removes the match', async () => {
  const res = await request(app).delete(`/api/matches/${matchId}`);
  assert.equal(res.status, 204);

  const board = await request(app).get(`/api/leaderboard?gameId=${gameId}`);
  assert.deepEqual(board.body.standings, []);
});

test('DELETE /api/matches/:id 404s when already gone', async () => {
  const res = await request(app).delete(`/api/matches/${matchId}`);
  assert.equal(res.status, 404);
});

test('GET /api/leaderboard without gameId aggregates across all games', async () => {
  await request(app)
    .post('/api/matches')
    .send({ gameId, teams: [{ playerIds: [playerA] }, { playerIds: [playerB] }], winnerTeamIndex: 0 });
  const res = await request(app).get('/api/leaderboard');
  assert.equal(res.status, 200);
  assert.equal(res.body.gameId, null);
  const a = res.body.standings.find((s: { playerId: string }) => s.playerId === playerA);
  assert.ok(a.points > 0);
});

test('POST /api/matches with a drawId links the draw to the new match (Team-Historie -> Ergebnis-Historie)', async () => {
  const draw = await request(app)
    .post('/api/matchmaking')
    .send({ gameId, playerIds: [playerA, playerB], teamCount: 2 });

  const match = await request(app)
    .post('/api/matches')
    .send({
      gameId,
      teams: [{ playerIds: [playerA] }, { playerIds: [playerB] }],
      drawId: draw.body.id,
    });
  assert.equal(match.status, 201);

  const history = await request(app).get(`/api/matchmaking/history?gameId=${gameId}`);
  const linked = history.body.history.find((h: { id: string }) => h.id === draw.body.id);
  assert.equal(linked.matchId, match.body.id);
});

test('POST /api/matches re-snapshots the linked draw to the actually-submitted teams (player moved before saving)', async () => {
  // Draw puts A+C on one team, B alone on the other, but the result is
  // entered with A moved onto B's team instead (as if reassigned in the
  // entry form) — Ergebnis-Historie must reflect what was actually played,
  // not the original draw lineup.
  const draw = await request(app)
    .post('/api/matchmaking')
    .send({ gameId, playerIds: [playerA, playerB, playerC], teamCount: 2 });

  const match = await request(app)
    .post('/api/matches')
    .send({
      gameId,
      teams: [{ playerIds: [playerB, playerA] }, { playerIds: [playerC] }],
      winnerTeamIndex: 0,
      drawId: draw.body.id,
    });
  assert.equal(match.status, 201);

  const history = await request(app).get(`/api/matchmaking/history?gameId=${gameId}`);
  const linked = history.body.history.find((h: { id: string }) => h.id === draw.body.id);
  assert.ok(linked, 'draw should appear in history');
  assert.equal(linked.matchId, match.body.id);
  assert.deepEqual(
    linked.teams.map((t: { players: { id: string }[] }) => t.players.map((p) => p.id).sort()),
    [[playerA, playerB].sort(), [playerC]]
  );
  assert.equal(linked.winnerTeamIndex, 0);
});

test('POST /api/matches links a Frei-für-alle result (different team shape) back to its draw and shows the winner', async () => {
  const draw = await request(app)
    .post('/api/matchmaking')
    .send({ gameId, playerIds: [playerA, playerB, playerC], teamCount: 2 });

  // Frei-für-alle: every participant becomes their own one-player team,
  // unlike the drawn 2-team lineup above.
  const match = await request(app)
    .post('/api/matches')
    .send({
      gameId,
      teams: [{ playerIds: [playerA] }, { playerIds: [playerB] }, { playerIds: [playerC] }],
      winnerTeamIndex: 2,
      drawId: draw.body.id,
    });
  assert.equal(match.status, 201);

  const history = await request(app).get(`/api/matchmaking/history?gameId=${gameId}`);
  const linked = history.body.history.find((h: { id: string }) => h.id === draw.body.id);
  assert.ok(linked, 'draw should appear in history');
  assert.equal(linked.matchId, match.body.id);
  assert.equal(linked.teams.length, 3);
  assert.equal(linked.winnerTeamIndex, 2);
  assert.deepEqual(
    linked.teams.map((t: { players: { id: string }[] }) => t.players.map((p) => p.id)),
    [[playerA], [playerB], [playerC]]
  );
});

test('POST /api/matches 404s for an unknown drawId', async () => {
  const res = await request(app)
    .post('/api/matches')
    .send({ gameId, teams: [{ playerIds: [playerA] }, { playerIds: [playerB] }], drawId: 'nope' });
  assert.equal(res.status, 404);
});

test('POST /api/matches rejects a drawId that already has a result', async () => {
  const draw = await request(app)
    .post('/api/matchmaking')
    .send({ gameId, playerIds: [playerA, playerB], teamCount: 2 });
  await request(app)
    .post('/api/matches')
    .send({
      gameId,
      teams: [{ playerIds: [playerA] }, { playerIds: [playerB] }],
      drawId: draw.body.id,
    });

  const second = await request(app)
    .post('/api/matches')
    .send({
      gameId,
      teams: [{ playerIds: [playerA] }, { playerIds: [playerB] }],
      drawId: draw.body.id,
    });
  assert.equal(second.status, 409);
});

test('POST /api/matches stores an optional score and rank per team', async () => {
  const res = await request(app)
    .post('/api/matches')
    .send({
      gameId,
      teams: [
        { playerIds: [playerA], score: 42, rank: 1 },
        { playerIds: [playerB], score: 17, rank: 2 },
      ],
      winnerTeamIndex: 0,
    });
  assert.equal(res.status, 201);
  assert.equal(res.body.teams[0].score, 42);
  assert.equal(res.body.teams[0].rank, 1);
  assert.equal(res.body.teams[1].score, 17);
  assert.equal(res.body.teams[1].rank, 2);

  const fetched = await request(app).get(`/api/matches?gameId=${gameId}`);
  const stored = fetched.body.find((m: { id: string }) => m.id === res.body.id);
  assert.equal(stored.teams[0].score, 42);
  assert.equal(stored.teams[0].rank, 1);
});

test('POST /api/matches allows score/rank without each other or without a winner', async () => {
  const scoreOnly = await request(app)
    .post('/api/matches')
    .send({ gameId, teams: [{ playerIds: [playerA], score: 5 }, { playerIds: [playerB] }] });
  assert.equal(scoreOnly.status, 201);
  assert.equal(scoreOnly.body.teams[0].score, 5);
  assert.equal(scoreOnly.body.teams[0].rank, null);
  assert.equal(scoreOnly.body.winnerTeamIndex, null);

  const rankOnly = await request(app)
    .post('/api/matches')
    .send({ gameId, teams: [{ playerIds: [playerA], rank: 2 }, { playerIds: [playerB], rank: 1 }] });
  assert.equal(rankOnly.status, 201);
  assert.equal(rankOnly.body.teams[0].rank, 2);
  assert.equal(rankOnly.body.teams[0].score, null);
});

test('POST /api/matches rejects a non-numeric score', async () => {
  const res = await request(app)
    .post('/api/matches')
    .send({ gameId, teams: [{ playerIds: [playerA], score: 'lots' }, { playerIds: [playerB] }] });
  assert.equal(res.status, 400);
});

test('POST /api/matches rejects a rank below 1', async () => {
  const res = await request(app)
    .post('/api/matches')
    .send({ gameId, teams: [{ playerIds: [playerA], rank: 0 }, { playerIds: [playerB] }] });
  assert.equal(res.status, 400);
});

test('PATCH /api/matches/:id can correct the score/rank', async () => {
  const created = await request(app)
    .post('/api/matches')
    .send({ gameId, teams: [{ playerIds: [playerA], score: 1 }, { playerIds: [playerB], score: 2 }] });

  const patched = await request(app)
    .patch(`/api/matches/${created.body.id}`)
    .send({ teams: [{ playerIds: [playerA], score: 10 }, { playerIds: [playerB], score: 20 }] });
  assert.equal(patched.status, 200);
  assert.equal(patched.body.teams[0].score, 10);
  assert.equal(patched.body.teams[1].score, 20);
});

test('POST /api/matches rejects a team without any players', async () => {
  const res = await request(app)
    .post('/api/matches')
    .send({ gameId, teams: [{ playerIds: [] }, { playerIds: [playerB] }] });
  assert.equal(res.status, 400);
});

test('POST /api/matches requires a gameId', async () => {
  const res = await request(app)
    .post('/api/matches')
    .send({ teams: [{ playerIds: [playerA] }, { playerIds: [playerB] }] });
  assert.equal(res.status, 400);
});

test('POST /api/matches rejects a non-numeric playedAt', async () => {
  const res = await request(app)
    .post('/api/matches')
    .send({ gameId, teams: [{ playerIds: [playerA] }, { playerIds: [playerB] }], playedAt: 'yesterday' });
  assert.equal(res.status, 400);
});

test('POST /api/matches accepts a numeric playedAt override', async () => {
  const playedAt = Date.now() - 86_400_000;
  const res = await request(app)
    .post('/api/matches')
    .send({ gameId, teams: [{ playerIds: [playerA] }, { playerIds: [playerB] }], playedAt });
  assert.equal(res.status, 201);
  assert.equal(res.body.playedAt, playedAt);
});

test('POST /api/matches rejects an empty-string drawId', async () => {
  const res = await request(app)
    .post('/api/matches')
    .send({ gameId, teams: [{ playerIds: [playerA] }, { playerIds: [playerB] }], drawId: '' });
  assert.equal(res.status, 400);
});

test('GET /api/matches filters by eventId', async () => {
  const created = await request(app)
    .post('/api/matches')
    .send({ gameId, teams: [{ playerIds: [playerA] }, { playerIds: [playerB] }] });
  const eventId = created.body.eventId;

  const filtered = await request(app).get(`/api/matches?eventId=${eventId}`);
  assert.equal(filtered.status, 200);
  assert.ok(filtered.body.every((m: { eventId: string }) => m.eventId === eventId));
  assert.ok(filtered.body.some((m: { id: string }) => m.id === created.body.id));

  const noneForFakeEvent = await request(app).get('/api/matches?eventId=nonexistent-event');
  assert.deepEqual(noneForFakeEvent.body, []);
});

test('PATCH /api/matches/:id rejects an invalid gameId', async () => {
  const created = await request(app)
    .post('/api/matches')
    .send({ gameId, teams: [{ playerIds: [playerA] }, { playerIds: [playerB] }] });

  const res = await request(app).patch(`/api/matches/${created.body.id}`).send({ gameId: '' });
  assert.equal(res.status, 400);
});

test('PATCH /api/matches/:id 404s when the new gameId does not exist', async () => {
  const created = await request(app)
    .post('/api/matches')
    .send({ gameId, teams: [{ playerIds: [playerA] }, { playerIds: [playerB] }] });

  const res = await request(app).patch(`/api/matches/${created.body.id}`).send({ gameId: 'ghost-game' });
  assert.equal(res.status, 404);
});

test('PATCH /api/matches/:id can move a match to a different existing game', async () => {
  const otherGame = await request(app).post('/api/games').send({ name: 'Second Leaderboard Test Game' });
  const created = await request(app)
    .post('/api/matches')
    .send({ gameId, teams: [{ playerIds: [playerA] }, { playerIds: [playerB] }] });

  const res = await request(app)
    .patch(`/api/matches/${created.body.id}`)
    .send({ gameId: otherGame.body.id });
  assert.equal(res.status, 200);
  assert.equal(res.body.gameId, otherGame.body.id);
});

test('PATCH /api/matches/:id 404s when the corrected teams include an unknown player', async () => {
  const created = await request(app)
    .post('/api/matches')
    .send({ gameId, teams: [{ playerIds: [playerA] }, { playerIds: [playerB] }] });

  const res = await request(app)
    .patch(`/api/matches/${created.body.id}`)
    .send({ teams: [{ playerIds: [playerA] }, { playerIds: ['ghost-player'] }] });
  assert.equal(res.status, 404);
});

test('PATCH /api/matches/:id rejects a non-numeric playedAt', async () => {
  const created = await request(app)
    .post('/api/matches')
    .send({ gameId, teams: [{ playerIds: [playerA] }, { playerIds: [playerB] }] });

  const res = await request(app).patch(`/api/matches/${created.body.id}`).send({ playedAt: 'not a timestamp' });
  assert.equal(res.status, 400);
});

test('PATCH /api/matches/:id can correct playedAt', async () => {
  const created = await request(app)
    .post('/api/matches')
    .send({ gameId, teams: [{ playerIds: [playerA] }, { playerIds: [playerB] }] });

  const newPlayedAt = Date.now() - 3600_000;
  const res = await request(app).patch(`/api/matches/${created.body.id}`).send({ playedAt: newPlayedAt });
  assert.equal(res.status, 200);
  assert.equal(res.body.playedAt, newPlayedAt);
});
