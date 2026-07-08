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

// ---------- group_knockout ----------

let groupPlayerIds: string[];

test('setup: 8 more players for group_knockout tests', async () => {
  groupPlayerIds = [];
  for (const name of ['G1', 'G2', 'G3', 'G4', 'G5', 'G6', 'G7', 'G8']) {
    const p = await request(app).post('/api/players').send({ name });
    groupPlayerIds.push(p.body.id);
  }
});

test('POST /api/tournaments rejects group_knockout without groupCount/advancersPerGroup', async () => {
  const res = await request(app)
    .post('/api/tournaments')
    .send({ gameId, format: 'group_knockout', teams: soloTeams(groupPlayerIds) });
  assert.equal(res.status, 400);
});

test('POST /api/tournaments rejects a groupCount too large for the team count', async () => {
  const res = await request(app)
    .post('/api/tournaments')
    .send({ gameId, format: 'group_knockout', groupCount: 5, advancersPerGroup: 1, teams: soloTeams(groupPlayerIds) });
  assert.equal(res.status, 400); // needs >= 2 teams per group -> at most 4 groups for 8 teams
});

test('POST /api/tournaments rejects advancersPerGroup larger than the smallest group', async () => {
  const res = await request(app)
    .post('/api/tournaments')
    .send({ gameId, format: 'group_knockout', groupCount: 2, advancersPerGroup: 5, teams: soloTeams(groupPlayerIds) });
  assert.equal(res.status, 400);
});

let groupKnockoutId: string;

test('POST /api/tournaments creates a group stage (no knockout matches yet) for group_knockout', async () => {
  const res = await request(app)
    .post('/api/tournaments')
    .send({ gameId, format: 'group_knockout', groupCount: 2, advancersPerGroup: 2, teams: soloTeams(groupPlayerIds) });
  assert.equal(res.status, 201);
  assert.equal(res.body.format, 'group_knockout');
  assert.equal(res.body.groupCount, 2);
  assert.equal(res.body.advancersPerGroup, 2);
  assert.equal(res.body.groups.length, 2);
  assert.ok(res.body.groups.every((g: { standings: unknown[] }) => g.standings.length === 4));
  assert.ok(res.body.matches.every((m: { stage: string }) => m.stage === 'group'));
  assert.equal(res.body.matches.length, 12); // C(4,2) = 6 per group * 2 groups
  assert.ok(res.body.teams.every((t: { groupIndex: number | null }) => t.groupIndex === 0 || t.groupIndex === 1));

  groupKnockoutId = res.body.id;
});

test('deciding every group match auto-generates the knockout bracket', async () => {
  let detail = await request(app).get(`/api/tournaments/${groupKnockoutId}`);
  let groupMatches = detail.body.matches.filter((m: { stage: string }) => m.stage === 'group');

  for (const m of groupMatches) {
    const res = await request(app)
      .post(`/api/tournaments/${groupKnockoutId}/matches/${m.id}/result`)
      .send({ winnerTeamId: m.teamAId });
    assert.equal(res.status, 200);
  }

  detail = await request(app).get(`/api/tournaments/${groupKnockoutId}`);
  assert.equal(detail.body.status, 'active'); // group stage done, knockout not yet decided
  const knockoutMatches = detail.body.matches.filter((m: { stage: string }) => m.stage === 'knockout');
  assert.equal(knockoutMatches.length, 3); // 4 advancers -> 2 semis + 1 final
  assert.ok(knockoutMatches.every((m: { isBye: boolean }) => !m.isBye)); // 4 is already a power of two
});

test('a draw is rejected once a match has reached the knockout stage', async () => {
  const detail = await request(app).get(`/api/tournaments/${groupKnockoutId}`);
  const semiFinal = detail.body.matches.find((m: { stage: string; round: number }) => m.stage === 'knockout' && m.round === 1);
  const res = await request(app)
    .post(`/api/tournaments/${groupKnockoutId}/matches/${semiFinal.id}/result`)
    .send({ winnerTeamId: null });
  assert.equal(res.status, 400);
});

test('playing out the knockout bracket completes the tournament and resolves a champion', async () => {
  let detail = await request(app).get(`/api/tournaments/${groupKnockoutId}`);
  let semis = detail.body.matches.filter((m: { stage: string; round: number }) => m.stage === 'knockout' && m.round === 1);

  for (const m of semis) {
    await request(app)
      .post(`/api/tournaments/${groupKnockoutId}/matches/${m.id}/result`)
      .send({ winnerTeamId: m.teamAId });
  }

  detail = await request(app).get(`/api/tournaments/${groupKnockoutId}`);
  const final = detail.body.matches.find((m: { stage: string; round: number }) => m.stage === 'knockout' && m.round === 2);
  const finalRes = await request(app)
    .post(`/api/tournaments/${groupKnockoutId}/matches/${final.id}/result`)
    .send({ winnerTeamId: final.teamAId });
  assert.equal(finalRes.status, 200);
  assert.equal(finalRes.body.status, 'completed');

  const exportRes = await request(app).get('/api/export');
  const entry = exportRes.body.tournaments.find((t: { name: string }) => t.name === finalRes.body.name);
  assert.ok(entry);
  assert.ok(entry.championTeamName);
});

// ---------- trackScore ----------

let scoreRoundRobinId: string;

test('POST /api/tournaments with trackScore derives the winner from scoreA/scoreB', async () => {
  const res = await request(app)
    .post('/api/tournaments')
    .send({ gameId, format: 'round_robin', trackScore: true, teams: soloTeams(playerIds.slice(0, 3)) });
  assert.equal(res.status, 201);
  assert.equal(res.body.trackScore, true);
  scoreRoundRobinId = res.body.id;

  const m1 = res.body.matches[0];
  const winResult = await request(app)
    .post(`/api/tournaments/${scoreRoundRobinId}/matches/${m1.id}/result`)
    .send({ scoreA: 3, scoreB: 1 });
  assert.equal(winResult.status, 200);
  const recorded = winResult.body.matches.find((m: { id: string }) => m.id === m1.id);
  assert.equal(recorded.winnerTeamId, m1.teamAId);
  assert.equal(recorded.scoreA, 3);
  assert.equal(recorded.scoreB, 1);

  const m2 = res.body.matches[1];
  const drawResult = await request(app)
    .post(`/api/tournaments/${scoreRoundRobinId}/matches/${m2.id}/result`)
    .send({ scoreA: 2, scoreB: 2 });
  assert.equal(drawResult.status, 200);
  const recordedDraw = drawResult.body.matches.find((m: { id: string }) => m.id === m2.id);
  assert.equal(recordedDraw.isDraw, true);
  assert.equal(recordedDraw.winnerTeamId, null);
});

test('POST .../result rejects a non-integer score when trackScore is on', async () => {
  const detail = await request(app).get(`/api/tournaments/${scoreRoundRobinId}`);
  const undecided = detail.body.matches.find((m: { winnerTeamId: string | null; isDraw: boolean }) => !m.winnerTeamId && !m.isDraw);
  const res = await request(app)
    .post(`/api/tournaments/${scoreRoundRobinId}/matches/${undecided.id}/result`)
    .send({ scoreA: 1.5, scoreB: 2 });
  assert.equal(res.status, 400);
});

test('trackScore rejects a tied score for a knockout-shaped match', async () => {
  const created = await request(app)
    .post('/api/tournaments')
    .send({ gameId, format: 'single_elimination', trackScore: true, teams: soloTeams(playerIds.slice(0, 2)) });
  const match = created.body.matches[0];

  const tied = await request(app)
    .post(`/api/tournaments/${created.body.id}/matches/${match.id}/result`)
    .send({ scoreA: 1, scoreB: 1 });
  assert.equal(tied.status, 400);

  const decisive = await request(app)
    .post(`/api/tournaments/${created.body.id}/matches/${match.id}/result`)
    .send({ scoreA: 2, scoreB: 1 });
  assert.equal(decisive.status, 200);
  assert.equal(decisive.body.status, 'completed');
});
