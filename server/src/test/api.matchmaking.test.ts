// Integration tests for the matchmaking endpoint: input validation, rating
// lookup (with a neutral default for unrated players), and team balance.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../app';

const app = createApp();
let gameId: string;
let playerIds: string[];

test('setup: create a game and 4 players with skill ratings', async () => {
  const game = await request(app).post('/api/games').send({ name: 'MM Test Game' });
  gameId = game.body.id;

  const names = ['A', 'B', 'C', 'D'];
  const ratings = [10, 1, 8, 3];
  playerIds = [];
  for (let i = 0; i < names.length; i++) {
    const p = await request(app).post('/api/players').send({ name: names[i] });
    playerIds.push(p.body.id);
    await request(app).put('/api/skills').send({ playerId: p.body.id, gameId, rating: ratings[i] });
  }
  assert.equal(playerIds.length, 4);
});

test('POST /api/matchmaking rejects fewer than 2 players', async () => {
  const res = await request(app)
    .post('/api/matchmaking')
    .send({ gameId, playerIds: [playerIds[0]] });
  assert.equal(res.status, 400);
});

test('POST /api/matchmaking rejects duplicate playerIds', async () => {
  const res = await request(app)
    .post('/api/matchmaking')
    .send({ gameId, playerIds: [playerIds[0], playerIds[0]] });
  assert.equal(res.status, 400);
});

test('POST /api/matchmaking 404s for an unknown game', async () => {
  const res = await request(app).post('/api/matchmaking').send({ gameId: 'nope', playerIds });
  assert.equal(res.status, 404);
});

test('POST /api/matchmaking 404s if a player does not exist', async () => {
  const res = await request(app)
    .post('/api/matchmaking')
    .send({ gameId, playerIds: [...playerIds, 'ghost'] });
  assert.equal(res.status, 404);
});

test('POST /api/matchmaking draws two balanced teams by default', async () => {
  const res = await request(app).post('/api/matchmaking').send({ gameId, playerIds });
  assert.equal(res.status, 200);
  assert.equal(res.body.teams.length, 2);
  const allIds = res.body.teams.flatMap((t: { players: { id: string }[] }) =>
    t.players.map((p) => p.id)
  );
  assert.deepEqual(allIds.sort(), [...playerIds].sort());
  const [sumA, sumB] = res.body.teams.map((t: { totalRating: number }) => t.totalRating);
  assert.ok(Math.abs(sumA - sumB) <= 2);
});

test('POST /api/matchmaking respects an explicit teamCount', async () => {
  const res = await request(app).post('/api/matchmaking').send({ gameId, playerIds, teamCount: 4 });
  assert.equal(res.status, 200);
  assert.equal(res.body.teams.length, 4);
  for (const team of res.body.teams) {
    assert.equal(team.players.length, 1);
  }
});

test('POST /api/matchmaking uses a neutral default rating for unrated players', async () => {
  const unrated = await request(app).post('/api/players').send({ name: 'Unrated' });
  const res = await request(app)
    .post('/api/matchmaking')
    .send({ gameId, playerIds: [...playerIds, unrated.body.id], teamCount: 2 });
  assert.equal(res.status, 200);
  const found = res.body.teams
    .flatMap((t: { players: { id: string; rating: number }[] }) => t.players)
    .find((p: { id: string }) => p.id === unrated.body.id);
  assert.equal(found.rating, 5);
});

test('POST /api/matchmaking ignores seat neighbors unless this draw asks for it', async () => {
  const game = await request(app).post('/api/games').send({ name: 'Seating Test Game A' });

  const names = ['E', 'F', 'G', 'H'];
  const ratings = [8, 7, 6, 1];
  const ids: string[] = [];
  for (let i = 0; i < names.length; i++) {
    const p = await request(app).post('/api/players').send({ name: names[i] });
    ids.push(p.body.id);
    await request(app).put('/api/skills').send({ playerId: p.body.id, gameId: game.body.id, rating: ratings[i] });
  }
  await request(app).put(`/api/players/${ids[0]}/neighbors`).send({ neighborIds: [ids[1]] });

  const res = await request(app)
    .post('/api/matchmaking')
    .send({ gameId: game.body.id, playerIds: ids, teamCount: 2 }); // avoidAdjacentOpponents omitted
  assert.equal(res.status, 200);
  assert.equal(res.body.seatConflicts, 0); // not evaluated either way
  assert.equal(res.body.seatPairsConsidered, 0);
});

test('POST /api/matchmaking rejects a non-boolean avoidAdjacentOpponents', async () => {
  const res = await request(app)
    .post('/api/matchmaking')
    .send({ gameId, playerIds, avoidAdjacentOpponents: 'yes' });
  assert.equal(res.status, 400);
});

test('POST /api/matchmaking keeps seat neighbors together when this draw asks for it', async () => {
  const game = await request(app).post('/api/games').send({ name: 'Seating Test Game B' });

  // Same ratings as the deterministic matchmaking.test.ts unit test: the
  // plain skill-balanced draft splits the two highest-rated players (I, J)
  // across teams, and reuniting them only costs a small, affordable amount
  // of balance.
  const names = ['I', 'J', 'K', 'L'];
  const ratings = [8, 7, 6, 1];
  const ids: string[] = [];
  for (let i = 0; i < names.length; i++) {
    const p = await request(app).post('/api/players').send({ name: names[i] });
    ids.push(p.body.id);
    await request(app).put('/api/skills').send({ playerId: p.body.id, gameId: game.body.id, rating: ratings[i] });
  }
  await request(app).put(`/api/players/${ids[0]}/neighbors`).send({ neighborIds: [ids[1]] });

  const res = await request(app)
    .post('/api/matchmaking')
    .send({ gameId: game.body.id, playerIds: ids, teamCount: 2, avoidAdjacentOpponents: true });
  assert.equal(res.status, 200);
  assert.equal(res.body.seatPairsConsidered, 1);
  assert.equal(res.body.seatConflicts, 0);
  const teamOf = (id: string) =>
    res.body.teams.findIndex((t: { players: { id: string }[] }) => t.players.some((p) => p.id === id));
  assert.equal(teamOf(ids[0]), teamOf(ids[1]));
});

test('POST /api/matchmaking flags the specific players left as opponents despite a seat-neighbor pairing', async () => {
  const game = await request(app).post('/api/games').send({ name: 'Seating Test Game C' });

  // Same shape as balanceTeams' "leaves a seat conflict unresolved" unit
  // test: a and b are by far the strongest, so forcing them together would
  // blow the skill balance apart and the conflict is left unresolved.
  const names = ['O', 'P', 'Q', 'R'];
  const ratings = [10, 9, 1, 2];
  const ids: string[] = [];
  for (let i = 0; i < names.length; i++) {
    const p = await request(app).post('/api/players').send({ name: names[i] });
    ids.push(p.body.id);
    await request(app).put('/api/skills').send({ playerId: p.body.id, gameId: game.body.id, rating: ratings[i] });
  }
  await request(app).put(`/api/players/${ids[0]}/neighbors`).send({ neighborIds: [ids[1]] });

  const res = await request(app)
    .post('/api/matchmaking')
    .send({ gameId: game.body.id, playerIds: ids, teamCount: 2, avoidAdjacentOpponents: true });
  assert.equal(res.status, 200);
  assert.equal(res.body.seatConflicts, 1);
  type FlaggedPlayer = { id: string; name: string; seatConflict: boolean; seatConflictNames: string[] };
  const players = res.body.teams.flatMap((t: { players: FlaggedPlayer[] }) => t.players) as FlaggedPlayer[];
  const flagged = players.filter((p) => p.seatConflict).map((p) => p.id).sort();
  assert.deepEqual(flagged, [ids[0], ids[1]].sort());

  // Each flagged player's tooltip should name the specific neighbor they
  // ended up against, not just an aggregate count.
  const playerO = players.find((p) => p.id === ids[0])!;
  const playerP = players.find((p) => p.id === ids[1])!;
  assert.deepEqual(playerO.seatConflictNames, ['P']);
  assert.deepEqual(playerP.seatConflictNames, ['O']);
  const unaffected = players.find((p) => p.id === ids[2])!;
  assert.deepEqual(unaffected.seatConflictNames, []);
});

test('GET /api/matchmaking/history lists past draws for this game, newest first, with team scores', async () => {
  const game = await request(app).post('/api/games').send({ name: 'History Test Game' });
  const names = ['M', 'N'];
  const ratings = [9, 4];
  const ids: string[] = [];
  for (let i = 0; i < names.length; i++) {
    const p = await request(app).post('/api/players').send({ name: names[i] });
    ids.push(p.body.id);
    await request(app).put('/api/skills').send({ playerId: p.body.id, gameId: game.body.id, rating: ratings[i] });
  }

  // Two separate draws (e.g. a re-roll) — both should show up.
  await request(app).post('/api/matchmaking').send({ gameId: game.body.id, playerIds: ids, teamCount: 2 });
  const second = await request(app)
    .post('/api/matchmaking')
    .send({ gameId: game.body.id, playerIds: ids, teamCount: 2 });

  const history = await request(app).get(`/api/matchmaking/history?gameId=${game.body.id}`);
  assert.equal(history.status, 200);
  assert.equal(history.body.history.length, 2);

  const [newest] = history.body.history;
  assert.equal(newest.gameId, game.body.id);
  assert.equal(newest.gameName, 'History Test Game');
  assert.equal(newest.generatedAt, second.body.generatedAt);
  // Each historical team keeps its score (totalRating), same as a fresh draw.
  for (const team of newest.teams) {
    assert.equal(
      team.totalRating,
      team.players.reduce((sum: number, p: { rating: number }) => sum + p.rating, 0)
    );
  }
});

test('GET /api/matchmaking/history does not leak draws from other games', async () => {
  const res = await request(app).get(`/api/matchmaking/history?gameId=${gameId}`);
  assert.equal(res.status, 200);
  assert.ok(res.body.history.every((h: { gameId: string }) => h.gameId === gameId));
});

test('POST /api/matchmaking returns a draw id and null matchId', async () => {
  const res = await request(app).post('/api/matchmaking').send({ gameId, playerIds, teamCount: 2 });
  assert.equal(res.status, 200);
  assert.ok(res.body.id);
  assert.equal(res.body.matchId, null);
});

test('POST /api/matchmaking has a null source (only a Captain-Draft sets it)', async () => {
  const res = await request(app).post('/api/matchmaking').send({ gameId, playerIds, teamCount: 2 });
  assert.equal(res.status, 200);
  assert.equal(res.body.source, null);

  const history = await request(app).get(`/api/matchmaking/history?gameId=${gameId}`);
  const entry = history.body.history.find((h: { id: string }) => h.id === res.body.id);
  assert.equal(entry.source, null);
});

test('POST /api/matchmaking/rematch rejects fewer than 2 teams', async () => {
  const res = await request(app)
    .post('/api/matchmaking/rematch')
    .send({ gameId, teams: [{ playerIds: [playerIds[0]] }] });
  assert.equal(res.status, 400);
});

test('POST /api/matchmaking/rematch rejects a player in multiple teams', async () => {
  const res = await request(app)
    .post('/api/matchmaking/rematch')
    .send({
      gameId,
      teams: [{ playerIds: [playerIds[0], playerIds[1]] }, { playerIds: [playerIds[1], playerIds[2]] }],
    });
  assert.equal(res.status, 400);
});

test('POST /api/matchmaking/rematch 404s for an unknown game', async () => {
  const res = await request(app)
    .post('/api/matchmaking/rematch')
    .send({ gameId: 'nope', teams: [{ playerIds: [playerIds[0]] }, { playerIds: [playerIds[1]] }] });
  assert.equal(res.status, 404);
});

test('POST /api/matchmaking/rematch keeps the exact team lineup (no rebalancing) and tags source', async () => {
  const teams = [{ playerIds: [playerIds[0], playerIds[1]] }, { playerIds: [playerIds[2], playerIds[3]] }];
  const res = await request(app).post('/api/matchmaking/rematch').send({ gameId, teams });
  assert.equal(res.status, 200);
  assert.equal(res.body.source, 'rematch');
  assert.equal(res.body.matchId, null);
  assert.deepEqual(
    res.body.teams.map((t: { players: { id: string }[] }) => t.players.map((p) => p.id).sort()),
    teams.map((t) => [...t.playerIds].sort())
  );
});

test('a rematch result links back to the new draw and shows up in Ergebnis-Historie', async () => {
  const game = await request(app).post('/api/games').send({ name: 'Rematch History Game' });
  const p1 = await request(app).post('/api/players').send({ name: 'RematchA' });
  const p2 = await request(app).post('/api/players').send({ name: 'RematchB' });
  const ids = [p1.body.id, p2.body.id];

  const rematchDraw = await request(app)
    .post('/api/matchmaking/rematch')
    .send({ gameId: game.body.id, teams: [{ playerIds: [ids[0]] }, { playerIds: [ids[1]] }] });
  assert.equal(rematchDraw.status, 200);

  await request(app)
    .post('/api/matches')
    .send({
      gameId: game.body.id,
      teams: [
        { playerIds: [ids[0]] },
        { playerIds: [ids[1]] },
      ],
      winnerTeamIndex: 0,
      drawId: rematchDraw.body.id,
    });

  const history = await request(app).get(`/api/matchmaking/history?gameId=${game.body.id}`);
  const linked = history.body.history.find((h: { id: string }) => h.id === rematchDraw.body.id);
  assert.ok(linked, 'rematch draw should appear in history');
  assert.ok(linked.matchId, 'rematch draw should be linked to the recorded match');
  assert.equal(linked.source, 'rematch');
  assert.equal(linked.winnerTeamIndex, 0);
});

test('GET /api/matchmaking/history enriches a linked draw with the recorded score/rank/winner', async () => {
  const game = await request(app).post('/api/games').send({ name: 'Enrich Test Game' });
  const p1 = await request(app).post('/api/players').send({ name: 'EnrichA' });
  const p2 = await request(app).post('/api/players').send({ name: 'EnrichB' });
  const ids = [p1.body.id, p2.body.id];

  const draw = await request(app)
    .post('/api/matchmaking')
    .send({ gameId: game.body.id, playerIds: ids, teamCount: 2 });

  await request(app)
    .post('/api/matches')
    .send({
      gameId: game.body.id,
      teams: [
        { playerIds: [ids[0]], score: 21, rank: 1 },
        { playerIds: [ids[1]], score: 14, rank: 2 },
      ],
      winnerTeamIndex: 0,
      drawId: draw.body.id,
    });

  const history = await request(app).get(`/api/matchmaking/history?gameId=${game.body.id}`);
  const linked = history.body.history.find((h: { id: string }) => h.id === draw.body.id);
  assert.equal(linked.winnerTeamIndex, 0);
  assert.equal(linked.teams[0].score, 21);
  assert.equal(linked.teams[0].rank, 1);
  assert.equal(linked.teams[1].score, 14);
  assert.equal(linked.teams[1].rank, 2);
});

test('PATCH /api/matchmaking/draws/:id/move moves a player and recomputes totals', async () => {
  const game = await request(app).post('/api/games').send({ name: 'Move Test Game' });
  const names = ['MoveA', 'MoveB', 'MoveC', 'MoveD'];
  const ratings = [10, 1, 8, 3];
  const ids: string[] = [];
  for (let i = 0; i < names.length; i++) {
    const p = await request(app).post('/api/players').send({ name: names[i] });
    ids.push(p.body.id);
    await request(app).put('/api/skills').send({ playerId: p.body.id, gameId: game.body.id, rating: ratings[i] });
  }

  const draw = await request(app)
    .post('/api/matchmaking')
    .send({ gameId: game.body.id, playerIds: ids, teamCount: 2 });
  const drawId = draw.body.id;
  const teamOf = (teams: Array<{ players: { id: string }[] }>, id: string) =>
    teams.findIndex((t) => t.players.some((p) => p.id === id));

  const fromTeam = teamOf(draw.body.teams, ids[0]);
  const toTeam = fromTeam === 0 ? 1 : 0;

  const moved = await request(app)
    .patch(`/api/matchmaking/draws/${drawId}/move`)
    .send({ playerId: ids[0], toTeamIndex: toTeam });
  assert.equal(moved.status, 200);
  assert.equal(teamOf(moved.body.teams, ids[0]), toTeam);
  for (const team of moved.body.teams) {
    assert.equal(
      team.totalRating,
      team.players.reduce((sum: number, p: { rating: number | null }) => sum + (p.rating ?? 0), 0)
    );
  }

  const history = await request(app).get(`/api/matchmaking/history?gameId=${game.body.id}`);
  assert.equal(teamOf(history.body.history[0].teams, ids[0]), toTeam);
});

test('PATCH /api/matchmaking/draws/:id/move recomputes seat-conflict flags after a manual reassignment', async () => {
  const game = await request(app).post('/api/games').send({ name: 'Move Seating Test Game' });
  const names = ['MoveSeatA', 'MoveSeatB', 'MoveSeatC', 'MoveSeatD'];
  const ratings = [8, 7, 6, 1];
  const ids: string[] = [];
  for (let i = 0; i < names.length; i++) {
    const p = await request(app).post('/api/players').send({ name: names[i] });
    ids.push(p.body.id);
    await request(app).put('/api/skills').send({ playerId: p.body.id, gameId: game.body.id, rating: ratings[i] });
  }
  await request(app).put(`/api/players/${ids[0]}/neighbors`).send({ neighborIds: [ids[1]] });

  // Balanced draft with avoidAdjacentOpponents on: the two neighbors start
  // out on the same team (no unresolved conflict), see the sibling test
  // above ("keeps seat neighbors together...") for the same ratings shape.
  const draw = await request(app)
    .post('/api/matchmaking')
    .send({ gameId: game.body.id, playerIds: ids, teamCount: 2, avoidAdjacentOpponents: true });
  assert.equal(draw.body.seatConflicts, 0);

  const teamOf = (teams: Array<{ players: { id: string }[] }>, id: string) =>
    teams.findIndex((t) => t.players.some((p) => p.id === id));
  const neighborTeam = teamOf(draw.body.teams, ids[1]);
  const otherTeam = neighborTeam === 0 ? 1 : 0;

  // Manually pulling the first neighbor onto the other team creates a fresh,
  // unresolved conflict — the move endpoint should flag it even though the
  // original draw had none.
  const moved = await request(app)
    .patch(`/api/matchmaking/draws/${draw.body.id}/move`)
    .send({ playerId: ids[0], toTeamIndex: otherTeam });
  assert.equal(moved.status, 200);
  assert.equal(moved.body.seatConflicts, 1);
  type FlaggedPlayer = { id: string; seatConflict: boolean; seatConflictNames: string[] };
  const players = moved.body.teams.flatMap((t: { players: FlaggedPlayer[] }) => t.players) as FlaggedPlayer[];
  const flagged = players.filter((p) => p.seatConflict).map((p) => p.id).sort();
  assert.deepEqual(flagged, [ids[0], ids[1]].sort());
  const movedPlayer = players.find((p) => p.id === ids[0])!;
  assert.deepEqual(movedPlayer.seatConflictNames, ['MoveSeatB']);
});

test('PATCH /api/matchmaking/draws/:id/move keeps every drawn team populated', async () => {
  const game = await request(app).post('/api/games').send({ name: 'Move Empty Team Guard' });
  const first = await request(app).post('/api/players').send({ name: 'MoveSoloA' });
  const second = await request(app).post('/api/players').send({ name: 'MoveSoloB' });
  const draw = await request(app)
    .post('/api/matchmaking')
    .send({ gameId: game.body.id, playerIds: [first.body.id, second.body.id], teamCount: 2 });
  const fromTeam = draw.body.teams.findIndex((team: { players: Array<{ id: string }> }) =>
    team.players.some((player: { id: string }) => player.id === first.body.id)
  );

  const moved = await request(app)
    .patch(`/api/matchmaking/draws/${draw.body.id}/move`)
    .send({ playerId: first.body.id, toTeamIndex: fromTeam === 0 ? 1 : 0 });

  assert.equal(moved.status, 409);
  assert.match(moved.body.error, /nicht komplett leer/);
});

test('PATCH /api/matchmaking/draws/:id/move 404s for an unknown draw', async () => {
  const res = await request(app)
    .patch('/api/matchmaking/draws/nope/move')
    .send({ playerId: playerIds[0], toTeamIndex: 0 });
  assert.equal(res.status, 404);
});

test('PATCH /api/matchmaking/draws/:id/move rejects once a result was recorded for the draw', async () => {
  const game = await request(app).post('/api/games').send({ name: 'Frozen Draw Test Game' });
  const p1 = await request(app).post('/api/players').send({ name: 'FrozenA' });
  const p2 = await request(app).post('/api/players').send({ name: 'FrozenB' });
  const ids = [p1.body.id, p2.body.id];

  const draw = await request(app)
    .post('/api/matchmaking')
    .send({ gameId: game.body.id, playerIds: ids, teamCount: 2 });

  await request(app)
    .post('/api/matches')
    .send({
      gameId: game.body.id,
      teams: [{ playerIds: [ids[0]] }, { playerIds: [ids[1]] }],
      drawId: draw.body.id,
    });

  const moved = await request(app)
    .patch(`/api/matchmaking/draws/${draw.body.id}/move`)
    .send({ playerId: ids[0], toTeamIndex: 1 });
  assert.equal(moved.status, 409);
});
