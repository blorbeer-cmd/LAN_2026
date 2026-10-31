import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createTestApp } from './testApp';
import { BASE_EVENT_ID, db } from '../db';

const app = createTestApp();

interface Fixture {
  id: string;
  round: number;
  teamAId: string | null;
  teamBId: string | null;
  winnerTeamId: string | null;
  isDraw: boolean;
  isBye: boolean;
  isThirdPlace: boolean;
  playedAt: number;
}
interface Team {
  id: string;
  players: Array<{ id: string }>;
}
interface Standing {
  playerId: string;
  points: number;
  wins: number;
  matchesPlayed: number;
}

test('rank-only results and their corrections agree across leaderboard, Hall of Fame and export', async () => {
  const game = await request(app).post('/api/games').send({ name: 'Scoring placements' });
  const players: string[] = [];
  for (let index = 0; index < 4; index++) {
    const response = await request(app)
      .post('/api/players')
      .send({ name: `Placement ${index}` });
    assert.equal(response.status, 201);
    players.push(response.body.id);
  }
  const teams = (ranks: number[]) => players.map((id, index) => ({ playerIds: [id], rank: ranks[index] }));
  const created = await request(app)
    .post('/api/matches')
    .send({
      gameId: game.body.id,
      teams: teams([1, 1, 3, 4]),
    });
  assert.equal(created.status, 201);
  const verifyViews = async (points: number[], winnerIndex: number | null) => {
    const leaderboard = await request(app).get(`/api/leaderboard?eventId=${BASE_EVENT_ID}&gameId=${game.body.id}`);
    const hall = await request(app).get(`/api/hall-of-fame?eventId=${BASE_EVENT_ID}`);
    const exported = await request(app).get(`/api/export?eventId=${BASE_EVENT_ID}`);
    for (const response of [leaderboard, hall, exported]) assert.equal(response.status, 200);
    for (const rows of [
      leaderboard.body.standings,
      hall.body.events[0].overallStandings,
      exported.body.leaderboard,
    ] as Standing[][]) {
      const actual = rows
        .filter((row) => players.includes(row.playerId))
        .sort((a, b) => players.indexOf(a.playerId) - players.indexOf(b.playerId));
      assert.deepEqual(
        actual.map(({ playerId, points, wins, matchesPlayed }) => ({ playerId, points, wins, matchesPlayed })),
        points.map((value, index) => ({
          playerId: players[index],
          points: value,
          wins: index === winnerIndex ? 1 : 0,
          matchesPlayed: 1,
        })),
      );
    }
  };
  await verifyViews([3, 3, 2, 1], null);
  const corrected = await request(app)
    .patch(`/api/matches/${created.body.id}`)
    .send({ teams: teams([2, 3, 1, 4]) });
  assert.equal(corrected.status, 200);
  await verifyViews([3, 2, 4, 1], 2);
  const deleted = await request(app).delete(`/api/matches/${created.body.id}`);
  assert.equal(deleted.status, 204);
  await verifyViews([], null);
});

test('placement bonuses follow completed tournaments, filters, corrections and deletion in every points view', async () => {
  const players: string[] = [];
  for (let index = 0; index < 8; index++) {
    const response = await request(app)
      .post('/api/players')
      .send({ name: `Scoring ${index}` });
    assert.equal(response.status, 201);
    players.push(response.body.id);
  }
  const game = await request(app).post('/api/games').send({ name: 'Scoring knockout' });
  const otherGame = await request(app).post('/api/games').send({ name: 'No tournament bonuses here' });
  const created = await request(app)
    .post('/api/tournaments')
    .send({
      gameId: game.body.id,
      format: 'single_elimination',
      thirdPlaceMatch: true,
      teams: Array.from({ length: 4 }, (_, index) => ({ playerIds: players.slice(index * 2, index * 2 + 2) })),
    });
  assert.equal(created.status, 201);
  let board = created.body;
  const matchPoints = new Map<string, number>();
  const teamById = new Map<string, Team>(board.teams.map((team: Team) => [team.id, team]));
  const leaderboard = async () => {
    const response = await request(app).get(`/api/leaderboard?eventId=${BASE_EVENT_ID}&gameId=${game.body.id}`);
    assert.equal(response.status, 200);
    return response.body.standings as Standing[];
  };
  while (board.status === 'active') {
    const fixture = (board.matches as Fixture[]).find(
      (match) => !match.isBye && !match.winnerTeamId && match.teamAId && match.teamBId,
    )!;
    const response = await request(app)
      .post(`/api/tournaments/${board.id}/matches/${fixture.id}/result`)
      .send({ winnerTeamId: fixture.teamAId });
    assert.equal(response.status, 200);
    board = response.body;
    for (const [teamId, points] of [
      [fixture.teamAId!, 4],
      [fixture.teamBId!, 1],
    ] as const) {
      for (const player of teamById.get(teamId)!.players)
        matchPoints.set(player.id, (matchPoints.get(player.id) ?? 0) + points);
    }
    if (board.status === 'active') {
      for (const standing of await leaderboard()) assert.equal(standing.points, matchPoints.get(standing.playerId));
    }
  }
  const completed = await leaderboard();
  for (const placement of board.placements as Array<{ teamId: string; place: number }>) {
    const bonus = ({ 1: 5, 2: 3, 3: 1 } as Record<number, number>)[placement.place] ?? 0;
    for (const player of teamById.get(placement.teamId)!.players) {
      const standing = completed.find((row) => row.playerId === player.id)!;
      assert.equal(standing.points, matchPoints.get(player.id)! + bonus);
      assert.equal(standing.matchesPlayed, 2, 'placement bonuses do not add fictitious matches');
    }
  }
  const hall = await request(app).get(`/api/hall-of-fame?eventId=${BASE_EVENT_ID}`);
  const exported = await request(app).get(`/api/export?eventId=${BASE_EVENT_ID}`);
  const scores = (rows: Standing[]) =>
    rows
      .filter((row) => players.includes(row.playerId))
      .map(({ playerId, points, wins, matchesPlayed }) => ({ playerId, points, wins, matchesPlayed }));
  assert.deepEqual(scores(hall.body.events[0].overallStandings), scores(completed));
  assert.deepEqual(scores(exported.body.leaderboard), scores(completed));
  const other = await request(app).get(`/api/leaderboard?gameId=${otherGame.body.id}`);
  assert.deepEqual(other.body.standings, []);

  db.prepare('UPDATE players SET is_test = 1 WHERE id = ?').run(players[0]);
  const hidden = await leaderboard();
  assert.ok(
    hidden.every((standing) => standing.points <= 8),
    'hidden test participation cannot yield tournament bonuses',
  );
  const admin = await request(app).get(`/api/leaderboard?gameId=${game.body.id}`).set('x-admin-mode', '1');
  assert.deepEqual(admin.body.standings, completed);
  db.prepare('UPDATE players SET is_test = 0 WHERE id = ?').run(players[0]);

  const semifinal = (board.matches as Fixture[]).find((match) => match.round === 1)!;
  const correction = await request(app)
    .put(`/api/tournaments/${board.id}/matches/${semifinal.id}/result`)
    .send({ winnerTeamId: semifinal.teamBId, expectedPlayedAt: semifinal.playedAt });
  assert.equal(correction.status, 200);
  assert.equal(correction.body.status, 'active');
  const reopened = await leaderboard();
  assert.ok(
    reopened.every((standing) => standing.points <= 4 && standing.matchesPlayed === 1),
    'reopened tournament loses all placement bonuses',
  );
  // Deleting a tournament keeps its recorded match points, with no bonus.
  const removed = await request(app).delete(`/api/tournaments/${board.id}`);
  assert.equal(removed.status, 204);
  assert.deepEqual(await leaderboard(), reopened);
});

test('league ties share bonuses; legacy tournament draws count and early endings earn no placement bonus', async () => {
  const game = await request(app).post('/api/games').send({ name: 'Scoring league' });
  const players: string[] = [];
  for (let index = 0; index < 3; index++) {
    const player = await request(app)
      .post('/api/players')
      .send({ name: `League scoring ${index}` });
    players.push(player.body.id);
  }
  const created = await request(app)
    .post('/api/tournaments')
    .send({
      gameId: game.body.id,
      format: 'round_robin',
      teams: players.map((id) => ({ playerIds: [id] })),
    });
  assert.equal(created.status, 201);
  for (const fixture of created.body.matches as Fixture[]) {
    const response = await request(app)
      .post(`/api/tournaments/${created.body.id}/matches/${fixture.id}/result`)
      .send({ winnerTeamId: null });
    assert.equal(response.status, 200);
  }
  // Simulate the stored format before explicit isDraw was added to match JSON.
  db.prepare(`UPDATE matches SET result = json_remove(result, '$.isDraw') WHERE game_id = ?`).run(game.body.id);
  const complete = await request(app).get(`/api/leaderboard?gameId=${game.body.id}`);
  assert.equal(complete.body.standings.length, 3);
  for (const standing of complete.body.standings as Standing[])
    assert.equal(standing.points, 9, 'two two-point draws plus shared first-place bonus');

  const deletes = await Promise.all([
    request(app).delete(`/api/tournaments/${created.body.id}`),
    request(app).delete(`/api/tournaments/${created.body.id}`),
  ]);
  assert.deepEqual(deletes.map((response) => response.status).sort(), [204, 404]);
  const deleted = await request(app).get(`/api/leaderboard?gameId=${game.body.id}`);
  assert.equal(deleted.body.standings.length, 3);
  for (const standing of deleted.body.standings as Standing[])
    assert.equal(standing.points, 4, 'deletion removes bonuses but preserves legacy draw points');

  const unfinished = await request(app)
    .post('/api/tournaments')
    .send({
      gameId: game.body.id,
      format: 'round_robin',
      teams: players.map((id) => ({ playerIds: [id] })),
    });
  const fixture = unfinished.body.matches[0] as Fixture;
  await request(app)
    .post(`/api/tournaments/${unfinished.body.id}/matches/${fixture.id}/result`)
    .send({ winnerTeamId: null });
  const before = await request(app).get(`/api/leaderboard?gameId=${game.body.id}`);
  const ended = await request(app).post(`/api/tournaments/${unfinished.body.id}/finish`).send({});
  assert.equal(ended.status, 200);
  const after = await request(app).get(`/api/leaderboard?gameId=${game.body.id}`);
  assert.deepEqual(after.body.standings, before.body.standings);
});

test('group stages award match points and only the final knockout placements award bonuses', async () => {
  const game = await request(app).post('/api/games').send({ name: 'Scoring groups' });
  const teams: Array<{ playerIds: string[] }> = [];
  for (let index = 0; index < 4; index++) {
    const player = await request(app)
      .post('/api/players')
      .send({ name: `Group scoring ${index}` });
    teams.push({ playerIds: [player.body.id] });
  }
  const created = await request(app).post('/api/tournaments').send({
    gameId: game.body.id,
    format: 'group_knockout',
    groupCount: 2,
    advancersPerGroup: 1,
    teams,
  });
  assert.equal(created.status, 201);
  let board = created.body;
  while (board.status === 'active') {
    const fixture = (board.matches as Fixture[]).find(
      (match) => !match.isBye && !match.winnerTeamId && match.teamAId && match.teamBId,
    )!;
    const response = await request(app)
      .post(`/api/tournaments/${board.id}/matches/${fixture.id}/result`)
      .send({ winnerTeamId: fixture.teamAId });
    assert.equal(response.status, 200);
    board = response.body;
  }
  const leaderboard = await request(app).get(`/api/leaderboard?gameId=${game.body.id}`);
  assert.deepEqual(
    leaderboard.body.standings.map((standing: Standing) => standing.points),
    [13, 8, 1, 1],
  );
});
