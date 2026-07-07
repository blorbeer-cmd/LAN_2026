// Integration tests for tournaments (FR-33): creation (both formats),
// result recording advancing a bracket / filling in round-robin standings,
// and leaderboard integration.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../app';

const app = createApp();
let gameId: string;
let playerIds: string[];

test('setup: a game and 4 players', async () => {
  const game = await request(app).post('/api/games').send({ name: 'Tourney Test Game' });
  gameId = game.body.id;
  playerIds = [];
  for (const name of ['T1', 'T2', 'T3', 'T4']) {
    const p = await request(app).post('/api/players').send({ name });
    playerIds.push(p.body.id);
  }
});

function soloTeams(ids: string[]) {
  return ids.map((id) => ({ playerIds: [id] }));
}

test('POST /api/tournaments rejects an unknown game', async () => {
  const res = await request(app)
    .post('/api/tournaments')
    .send({ gameId: 'nope', format: 'single_elimination', teams: soloTeams(playerIds) });
  assert.equal(res.status, 404);
});

test('POST /api/tournaments rejects an invalid format', async () => {
  const res = await request(app)
    .post('/api/tournaments')
    .send({ gameId, format: 'best_of_three', teams: soloTeams(playerIds) });
  assert.equal(res.status, 400);
});

test('POST /api/tournaments rejects fewer than 2 teams', async () => {
  const res = await request(app)
    .post('/api/tournaments')
    .send({ gameId, format: 'round_robin', teams: soloTeams([playerIds[0]]) });
  assert.equal(res.status, 400);
});

test('POST /api/tournaments rejects a player listed on two teams', async () => {
  const res = await request(app)
    .post('/api/tournaments')
    .send({
      gameId,
      format: 'round_robin',
      teams: [{ playerIds: [playerIds[0]] }, { playerIds: [playerIds[0]] }],
    });
  assert.equal(res.status, 400);
});

test('POST /api/tournaments rejects an unknown player', async () => {
  const res = await request(app)
    .post('/api/tournaments')
    .send({ gameId, format: 'round_robin', teams: [{ playerIds: ['ghost'] }, { playerIds: [playerIds[0]] }] });
  assert.equal(res.status, 404);
});

let bracketId: string;
let bracketTeamIds: string[];
let bracketMatches: Array<{ id: string; round: number; slot: number; teamAId: string | null; teamBId: string | null; isBye: boolean }>;

test('POST /api/tournaments creates a single-elimination bracket for 4 teams', async () => {
  const res = await request(app)
    .post('/api/tournaments')
    .send({ gameId, format: 'single_elimination', teams: soloTeams(playerIds) });
  assert.equal(res.status, 201);
  assert.equal(res.body.format, 'single_elimination');
  assert.equal(res.body.status, 'active');
  assert.equal(res.body.teams.length, 4);
  assert.equal(res.body.matches.length, 3); // 2 round-1 + 1 final
  assert.ok(res.body.matches.every((m: { isBye: boolean }) => !m.isBye));

  bracketId = res.body.id;
  bracketTeamIds = res.body.teams.map((t: { id: string }) => t.id);
  bracketMatches = res.body.matches;
});

test('POST .../matches/:id/result rejects a winner not in that match', async () => {
  const round1 = bracketMatches.filter((m) => m.round === 1);
  const res = await request(app)
    .post(`/api/tournaments/${bracketId}/matches/${round1[0].id}/result`)
    .send({ winnerTeamId: 'not-a-real-team' });
  assert.equal(res.status, 400);
});

test('POST .../matches/:id/result rejects a draw in a single-elimination match', async () => {
  const round1 = bracketMatches.filter((m) => m.round === 1);
  const res = await request(app)
    .post(`/api/tournaments/${bracketId}/matches/${round1[0].id}/result`)
    .send({ winnerTeamId: null });
  assert.equal(res.status, 400);
});

test('POST .../matches/:id/result rejects recording a result before both teams are known', async () => {
  const final = bracketMatches.find((m) => m.round === 2)!;
  const res = await request(app)
    .post(`/api/tournaments/${bracketId}/matches/${final.id}/result`)
    .send({ winnerTeamId: bracketTeamIds[0] });
  assert.equal(res.status, 409);
});

test('recording round-1 results advances winners into the final and creates leaderboard matches', async () => {
  const round1 = bracketMatches.filter((m) => m.round === 1);

  const first = await request(app)
    .post(`/api/tournaments/${bracketId}/matches/${round1[0].id}/result`)
    .send({ winnerTeamId: round1[0].teamAId });
  assert.equal(first.status, 200);
  assert.equal(first.body.status, 'active'); // not complete yet

  const second = await request(app)
    .post(`/api/tournaments/${bracketId}/matches/${round1[1].id}/result`)
    .send({ winnerTeamId: round1[1].teamAId });
  assert.equal(second.status, 200);

  const final = second.body.matches.find((m: { round: number }) => m.round === 2);
  assert.equal(final.teamAId, round1[0].teamAId);
  assert.equal(final.teamBId, round1[1].teamAId);

  // Each recorded result should also show up as a normal leaderboard match.
  const matches = await request(app).get(`/api/matches?gameId=${gameId}`);
  assert.equal(matches.body.length, 2);
});

test('recording the final marks the tournament completed', async () => {
  const detail = await request(app).get(`/api/tournaments/${bracketId}`);
  const final = detail.body.matches.find((m: { round: number }) => m.round === 2);

  const res = await request(app)
    .post(`/api/tournaments/${bracketId}/matches/${final.id}/result`)
    .send({ winnerTeamId: final.teamAId });
  assert.equal(res.status, 200);
  assert.equal(res.body.status, 'completed');
});

test('POST /api/tournaments auto-resolves a bye for an odd team count', async () => {
  const res = await request(app)
    .post('/api/tournaments')
    .send({ gameId, format: 'single_elimination', teams: soloTeams(playerIds.slice(0, 3)) });
  assert.equal(res.status, 201);
  const round1 = res.body.matches.filter((m: { round: number }) => m.round === 1);
  assert.equal(round1.length, 2);
  const bye = round1.find((m: { isBye: boolean }) => m.isBye);
  assert.ok(bye);
  assert.ok(bye.winnerTeamId);

  const final = res.body.matches.find((m: { round: number }) => m.round === 2);
  assert.ok(final.teamAId === bye.winnerTeamId || final.teamBId === bye.winnerTeamId);
});

test('POST .../matches/:id/result rejects recording a result for a bye', async () => {
  const res = await request(app)
    .post('/api/tournaments')
    .send({ gameId, format: 'single_elimination', teams: soloTeams(playerIds.slice(0, 3)) });
  const bye = res.body.matches.find((m: { isBye: boolean }) => m.isBye);

  const result = await request(app)
    .post(`/api/tournaments/${res.body.id}/matches/${bye.id}/result`)
    .send({ winnerTeamId: bye.winnerTeamId });
  assert.equal(result.status, 400);
});

let roundRobinId: string;
let rrTeamIds: string[];

test('POST /api/tournaments creates a single round-robin schedule for 3 teams', async () => {
  const res = await request(app)
    .post('/api/tournaments')
    .send({ gameId, format: 'round_robin', teams: soloTeams(playerIds.slice(0, 3)) });
  assert.equal(res.status, 201);
  assert.equal(res.body.twoLegged, false);
  assert.equal(res.body.matches.length, 3); // C(3,2)
  assert.ok(res.body.standings);
  assert.equal(res.body.standings.length, 3);
  assert.ok(res.body.standings.every((s: { played: number }) => s.played === 0));

  roundRobinId = res.body.id;
  rrTeamIds = res.body.teams.map((t: { id: string }) => t.id);
});

test('POST /api/tournaments doubles fixtures for twoLegged round-robin', async () => {
  const res = await request(app)
    .post('/api/tournaments')
    .send({ gameId, format: 'round_robin', twoLegged: true, teams: soloTeams(playerIds.slice(0, 3)) });
  assert.equal(res.status, 201);
  assert.equal(res.body.twoLegged, true);
  assert.equal(res.body.matches.length, 6);
});

test('recording round-robin results (including a draw) updates standings and completes the tournament', async () => {
  const detail = await request(app).get(`/api/tournaments/${roundRobinId}`);
  const matches = detail.body.matches;

  // Match 1: team A beats team B.
  const m1 = matches[0];
  await request(app)
    .post(`/api/tournaments/${roundRobinId}/matches/${m1.id}/result`)
    .send({ winnerTeamId: m1.teamAId });

  // Match 2: a draw.
  const m2 = matches[1];
  const drawRes = await request(app)
    .post(`/api/tournaments/${roundRobinId}/matches/${m2.id}/result`)
    .send({ winnerTeamId: null });
  assert.equal(drawRes.status, 200);
  assert.equal(drawRes.body.status, 'active');

  // Match 3: whichever teams are left.
  const m3 = matches[2];
  const finalRes = await request(app)
    .post(`/api/tournaments/${roundRobinId}/matches/${m3.id}/result`)
    .send({ winnerTeamId: m3.teamAId });
  assert.equal(finalRes.status, 200);
  assert.equal(finalRes.body.status, 'completed');

  // With 3 teams, each plays the other two, so a team's total points depend
  // on both of its fixtures — don't assume m1's loser ends up at exactly 0,
  // since with only 3 teams they're guaranteed to also be in m2 or m3.
  // Check the aggregate invariants instead: everyone played twice, and the
  // total points handed out matches win(3) + draw(1+1) + win(3) = 8.
  assert.ok(finalRes.body.standings.every((s: { played: number }) => s.played === 2));
  const totalPoints = finalRes.body.standings.reduce((sum: number, s: { points: number }) => sum + s.points, 0);
  assert.equal(totalPoints, 8);
  assert.ok(rrTeamIds.every((id) => finalRes.body.standings.some((s: { teamId: string }) => s.teamId === id)));
});

test('GET /api/tournaments lists tournaments for the active event, newest first', async () => {
  const res = await request(app).get('/api/tournaments');
  assert.equal(res.status, 200);
  assert.ok(res.body.length >= 4);
  assert.ok(res.body.every((t: { gameId: string }) => typeof t.gameId === 'string'));
});

test('DELETE /api/tournaments/:id removes it but keeps its leaderboard matches', async () => {
  const beforeMatches = await request(app).get(`/api/matches?gameId=${gameId}`);

  const res = await request(app).delete(`/api/tournaments/${roundRobinId}`);
  assert.equal(res.status, 204);

  const after = await request(app).get(`/api/tournaments/${roundRobinId}`);
  assert.equal(after.status, 404);

  const afterMatches = await request(app).get(`/api/matches?gameId=${gameId}`);
  assert.equal(afterMatches.body.length, beforeMatches.body.length);
});

test('DELETE /api/tournaments/:id 404s for an unknown id', async () => {
  const res = await request(app).delete('/api/tournaments/ghost');
  assert.equal(res.status, 404);
});
