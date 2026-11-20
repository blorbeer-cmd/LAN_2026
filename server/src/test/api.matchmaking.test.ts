// Integration tests for the matchmaking endpoint: input validation, rating
// lookup (with a neutral default for unrated players), and team balance.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { nanoid } from 'nanoid';
import { createTestApp, TEST_ADMIN_ID } from './testApp';
import { db, DEFAULT_GROUP_ID } from '../db';

const app = createTestApp();
let gameId: string;
let playerIds: string[];

test('setup: create a game and 4 players with skill ratings', async () => {
  const game = await request(app).post('/api/games').send({ name: 'MM Test Game' });
  gameId = game.body.id;

  const names = ['A', 'B', 'C', 'D'];
  const ratings = [5, 0, 4, 1];
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

test('POST /api/matchmaking rejects a deactivated player', async () => {
  db.prepare('UPDATE players SET deactivated_at = ? WHERE id = ?').run(Date.now(), playerIds[0]);
  try {
    const res = await request(app).post('/api/matchmaking').send({ gameId, playerIds });
    assert.equal(res.status, 404);
  } finally {
    db.prepare('UPDATE players SET deactivated_at = NULL WHERE id = ?').run(playerIds[0]);
  }
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

test('POST /api/matchmaking balances an unrated player with the neutral default but stores no rating', async () => {
  const unrated = await request(app).post('/api/players').send({ name: 'Unrated' });
  const res = await request(app)
    .post('/api/matchmaking')
    .send({ gameId, playerIds: [...playerIds, unrated.body.id], teamCount: 2 });
  assert.equal(res.status, 200);
  type SnapshotTeam = { players: Array<{ id: string; rating: number | null }>; totalRating: number };
  const found = res.body.teams
    .flatMap((t: SnapshotTeam) => t.players)
    .find((p: { id: string }) => p.id === unrated.body.id);
  // null instead of the substituted 3: a later reader must be able to tell an
  // absent self-rating from someone who really rated the game a 3.
  assert.equal(found.rating, null);
  // The total still counts that player with the fallback the draw balanced on.
  const teamOfUnrated = res.body.teams.find((t: SnapshotTeam) =>
    t.players.some((p) => p.id === unrated.body.id)
  );
  assert.equal(
    teamOfUnrated.totalRating,
    teamOfUnrated.players.reduce((sum: number, p: { rating: number | null }) => sum + (p.rating ?? 3), 0)
  );
});

test('POST /api/matchmaking ignores seat neighbors unless this draw asks for it', async () => {
  const game = await request(app).post('/api/games').send({ name: 'Seating Test Game A' });

  const names = ['E', 'F', 'G', 'H'];
  const ratings = [5, 4, 3, 0];
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
  // plain skill-balanced draft splits the seat neighbors I (5) and J (3)
  // across teams, and reuniting them only costs a small, affordable amount
  // of balance.
  const names = ['I', 'J', 'K', 'L', 'Seat5', 'Seat6'];
  const ratings = [5, 3, 4, 2, 1, 0];
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
  const ratings = [5, 4, 0, 1];
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
  const ratings = [5, 2];
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

test('history pages recorded matches before the limit and keeps open draws separate', async () => {
  const game = await request(app).post('/api/games').send({ name: 'Paged History Game' });
  const createDraw = (ids = playerIds.slice(0, 2)) => request(app).post('/api/matchmaking').send({ gameId: game.body.id, playerIds: ids, teamCount: 2 });
  const oldest = await createDraw([TEST_ADMIN_ID, playerIds[0]]);
  const middle = await createDraw();
  const reroll = await createDraw([TEST_ADMIN_ID, playerIds[0]]);
  const newest = await createDraw();
  for (const [draw, time] of [[oldest, 1000], [middle, 2000], [reroll, 3000], [newest, 4000]] as const) {
    assert.equal(draw.status, 200);
    db.prepare('UPDATE matchmaking_draws SET generated_at = ? WHERE id = ?').run(time, draw.body.id);
  }
  for (const draw of [oldest, middle]) {
    const recorded = await request(app).post('/api/matches').send({
      gameId: game.body.id,
      teams: draw.body.teams.map((team: { players: Array<{ id: string }> }) => ({
        playerIds: team.players.map((player) => player.id),
      })),
      winnerTeamIndex: 0,
      drawId: draw.body.id,
    });
    assert.equal(recorded.status, 201);
  }
  const teams = newest.body.teams.map((team: { players: Array<{ id: string }> }, index: number) => ({
    name: `Team ${index + 1}`, playerIds: team.players.map((player) => player.id),
  }));
  const tournament = await request(app).post('/api/tournaments').send({
    gameId: game.body.id, format: 'single_elimination', teams, drawId: newest.body.id,
  });
  assert.equal(tournament.status, 201);

  const first = await request(app).get(`/api/matchmaking/history?gameId=${game.body.id}&kind=matches&limit=1`);
  assert.equal(first.status, 200);
  assert.deepEqual(first.body.history.map((draw: { id: string }) => draw.id), [middle.body.id]);
  const ofGame = (draws: Array<{ id: string; gameId: string }>) => draws.filter((draw) => draw.gameId === game.body.id).map((draw) => draw.id);
  assert.deepEqual(ofGame(first.body.openDraws), [reroll.body.id]);
  assert.ok(first.body.nextCursor);
  const second = await request(app).get(`/api/matchmaking/history?gameId=${game.body.id}&kind=matches&limit=1&before=${first.body.nextCursor.before}&beforeId=${first.body.nextCursor.beforeId}`);
  assert.deepEqual(second.body.history.map((draw: { id: string }) => draw.id), [oldest.body.id]);
  assert.equal(second.body.nextCursor, null);
  assert.equal(second.body.openDraws, undefined);

  // Both newer records were created by this admin but do not include them.
  // Participation must filter before LIMIT and also scope the open lineup.
  const mine = await request(app).get(`/api/matchmaking/history?gameId=${game.body.id}&kind=matches&mine=1&limit=1`);
  assert.equal(mine.status, 200);
  assert.deepEqual(mine.body.history.map((draw: { id: string }) => draw.id), [oldest.body.id]);
  assert.deepEqual(ofGame(mine.body.openDraws), [reroll.body.id]);
  assert.equal(mine.body.nextCursor, null);
  // An open lineup of another game stays in "Ohne Ergebnis" while the game
  // picker shows this game; its history stays per game.
  const otherGame = await request(app).post('/api/games').send({ name: `Open elsewhere ${Date.now()}` });
  const elsewhere = await request(app).post('/api/matchmaking').send({
    gameId: otherGame.body.id, playerIds: newest.body.teams.flatMap((team: { players: Array<{ id: string }> }) =>
      team.players.map((player) => player.id)), teamCount: 2,
  });
  assert.equal(elsewhere.status, 200, JSON.stringify(elsewhere.body));
  const acrossGames = await request(app).get(`/api/matchmaking/history?gameId=${game.body.id}&kind=matches&limit=1`);
  const openIds = acrossGames.body.openDraws.map((draw: { id: string }) => draw.id);
  assert.ok(openIds.includes(elsewhere.body.id) && openIds.includes(reroll.body.id), JSON.stringify(openIds));
  assert.deepEqual(acrossGames.body.history.map((draw: { id: string }) => draw.id), [middle.body.id]);
  const unfiltered = await request(app).get(`/api/matchmaking/history?gameId=${game.body.id}&kind=matches&mine=0&limit=1`);
  assert.deepEqual(unfiltered.body.history.map((draw: { id: string }) => draw.id), [middle.body.id]);
  for (const value of ['yes', '1&mine=0']) {
    assert.equal((await request(app).get(`/api/matchmaking/history?mine=${value}`)).status, 400);
  }
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
  const ratings = [5, 0, 4, 1];
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

test('PATCH /api/matchmaking/draws/:id/move refuses a draw from an event the account is not part of', async () => {
  // The handler's row lookup is scoped by group_id only. That is not the
  // event boundary: POST /, POST /rematch and GET /history all additionally
  // check participation, and reshuffling someone else's teams is a write, not
  // a read — so the strictest of those rules applies here too.
  const game = await request(app).post('/api/games').send({ name: 'Move Scope Game' });
  const ids: string[] = [];
  for (const name of ['ScopeA', 'ScopeB']) {
    const p = await request(app).post('/api/players').send({ name });
    ids.push(p.body.id);
  }
  const draw = await request(app)
    .post('/api/matchmaking')
    .send({ gameId: game.body.id, playerIds: ids, teamCount: 2 });
  assert.equal(draw.status, 200, JSON.stringify(draw.body));

  const foreignEventId = nanoid();
  const now = Date.now();
  db.prepare(
    `INSERT INTO events (id, name, starts_at, ends_at, tracking_enabled, group_id, status, visibility_scope)
     VALUES (?, 'Fremdes Event', ?, ?, 0, ?, 'published', 'participants')`,
  ).run(foreignEventId, now - 1_000, now + 60_000, DEFAULT_GROUP_ID);
  db.prepare('UPDATE matchmaking_draws SET event_id = ? WHERE id = ?').run(foreignEventId, draw.body.id);

  const moved = await request(app)
    .patch(`/api/matchmaking/draws/${draw.body.id}/move`)
    .send({ playerId: ids[0], toTeamIndex: 1 });
  assert.equal(moved.status, 404, JSON.stringify(moved.body));

  const stored = db.prepare('SELECT teams FROM matchmaking_draws WHERE id = ?').get(draw.body.id) as {
    teams: string;
  };
  assert.deepEqual(
    JSON.parse(stored.teams),
    draw.body.teams,
    'a refused move must not have touched the stored lineup',
  );
});

test('PATCH /api/matchmaking/draws/:id/move recomputes seat-conflict flags after a manual reassignment', async () => {
  const game = await request(app).post('/api/games').send({ name: 'Move Seating Test Game' });
  const names = ['MoveSeatA', 'MoveSeatB', 'MoveSeatC', 'MoveSeatD', 'MoveSeatE', 'MoveSeatF'];
  const ratings = [5, 3, 4, 2, 1, 0];
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

test('DELETE /api/matchmaking/draws/:id removes open draws and recorded matches from history and ranking', async () => {
  const game = await request(app).post('/api/games').send({ name: 'Delete Draw Card Game' });
  const p1 = await request(app).post('/api/players').send({ name: 'DeleteDrawA' });
  const p2 = await request(app).post('/api/players').send({ name: 'DeleteDrawB' });
  const ids = [p1.body.id, p2.body.id];
  const makeDraw = () => request(app).post('/api/matchmaking')
    .send({ gameId: game.body.id, playerIds: ids, teamCount: 2 });

  const open = await makeDraw();
  assert.equal((await request(app).delete(`/api/matchmaking/draws/${open.body.id}`)).status, 204);
  const afterOpen = await request(app).get(`/api/matchmaking/history?gameId=${game.body.id}&kind=matches`);
  assert.equal(afterOpen.body.openDraws.some((draw: { id: string }) => draw.id === open.body.id), false);

  const played = await makeDraw();
  const recorded = await request(app).post('/api/matches').send({
    gameId: game.body.id,
    teams: played.body.teams.map((team: { players: Array<{ id: string }> }) =>
      ({ playerIds: team.players.map((player) => player.id) })),
    winnerTeamIndex: 0,
    drawId: played.body.id,
  });
  assert.equal(recorded.status, 201);
  assert.equal((await request(app).delete(`/api/matchmaking/draws/${played.body.id}`)).status, 204);
  const afterPlayed = await request(app).get(`/api/matchmaking/history?gameId=${game.body.id}&kind=matches`);
  assert.equal(afterPlayed.body.history.some((draw: { id: string }) => draw.id === played.body.id), false);
  assert.equal(afterPlayed.body.openDraws.some((draw: { id: string }) => draw.id === played.body.id), false);
  assert.equal(db.prepare('SELECT id FROM matches WHERE id = ?').get(recorded.body.id), undefined);
  assert.deepEqual((await request(app).get(`/api/leaderboard?gameId=${game.body.id}`)).body.standings, []);
});

test('DELETE /api/matchmaking/draws/:id protects tournament-owned draws', async () => {
  const game = await request(app).post('/api/games').send({ name: 'Delete Tournament Draw Guard' });
  const draw = await request(app).post('/api/matchmaking')
    .send({ gameId: game.body.id, playerIds: playerIds.slice(0, 2), teamCount: 2 });
  const tournament = await request(app).post('/api/tournaments').send({
    gameId: game.body.id,
    format: 'single_elimination',
    drawId: draw.body.id,
    teams: draw.body.teams.map((team: { players: Array<{ id: string }> }) =>
      ({ playerIds: team.players.map((player) => player.id) })),
  });
  assert.equal(tournament.status, 201);
  const deleted = await request(app).delete(`/api/matchmaking/draws/${draw.body.id}`);
  assert.equal(deleted.status, 409);
  assert.ok(db.prepare('SELECT id FROM tournaments WHERE id = ?').get(tournament.body.id));
});

async function openServerTestDraw(name: string) {
  const game = await request(app).post('/api/games').send({ name });
  const draw = await request(app).post('/api/matchmaking')
    .send({ gameId: game.body.id, playerIds: playerIds.slice(0, 2), teamCount: 2 });
  assert.equal(draw.status, 200, JSON.stringify(draw.body));
  return { gameId: game.body.id as string, draw: draw.body as { id: string; teams: Array<{ players: Array<{ id: string }> }> } };
}

const storedServer = (drawId: string) => db
  .prepare('SELECT server_address AS serverAddress, server_password AS serverPassword FROM matchmaking_draws WHERE id = ?')
  .get(drawId) as { serverAddress: string | null; serverPassword: string | null };

test('PATCH /api/matchmaking/draws/:id/server stores, lists and clears trimmed server details', async () => {
  const { gameId, draw } = await openServerTestDraw('Server Details Game');
  assert.equal((draw as { serverAddress?: unknown }).serverAddress, null);

  const saved = await request(app).patch(`/api/matchmaking/draws/${draw.id}/server`)
    .send({ serverAddress: '  10.0.0.5:27015 ', serverPassword: ' zocken123 ' });
  assert.equal(saved.status, 200, JSON.stringify(saved.body));
  assert.equal(saved.body.serverAddress, '10.0.0.5:27015');
  assert.equal(saved.body.serverPassword, 'zocken123');
  assert.deepEqual(saved.body.teams, draw.teams);

  const history = await request(app).get(`/api/matchmaking/history?gameId=${gameId}`);
  const listed = history.body.openDraws.find((entry: { id: string }) => entry.id === draw.id);
  assert.equal(listed.serverAddress, '10.0.0.5:27015');
  assert.equal(listed.serverPassword, 'zocken123');

  const passwordOnly = await request(app).patch(`/api/matchmaking/draws/${draw.id}/server`)
    .send({ serverAddress: '   ', serverPassword: 'geheim' });
  assert.equal(passwordOnly.status, 200);
  assert.deepEqual(storedServer(draw.id), { serverAddress: null, serverPassword: 'geheim' });

  const cleared = await request(app).patch(`/api/matchmaking/draws/${draw.id}/server`).send({});
  assert.equal(cleared.status, 200);
  assert.deepEqual(storedServer(draw.id), { serverAddress: null, serverPassword: null });
});

test('PATCH /api/matchmaking/draws/:id/server validates input, event access and the open state', async () => {
  const { gameId, draw } = await openServerTestDraw('Server Guard Game');
  await request(app).patch(`/api/matchmaking/draws/${draw.id}/server`)
    .send({ serverAddress: 'lan-host', serverPassword: 'pw' });

  for (const body of [
    { serverAddress: 'x'.repeat(101) },
    { serverPassword: 'x'.repeat(61) },
    { serverAddress: 27015 },
    { serverPassword: ['pw'] },
  ]) {
    const res = await request(app).patch(`/api/matchmaking/draws/${draw.id}/server`).send(body);
    assert.equal(res.status, 400, JSON.stringify(body));
  }
  assert.equal((await request(app).patch('/api/matchmaking/draws/nope/server').send({})).status, 404);

  // Same event boundary as moving players: only participants may write.
  const foreign = await openServerTestDraw('Server Foreign Event Game');
  const foreignEventId = nanoid();
  const now = Date.now();
  db.prepare(
    `INSERT INTO events (id, name, starts_at, ends_at, tracking_enabled, group_id, status, visibility_scope)
     VALUES (?, 'Fremdes Server-Event', ?, ?, 0, ?, 'published', 'participants')`,
  ).run(foreignEventId, now - 1_000, now + 60_000, DEFAULT_GROUP_ID);
  db.prepare('UPDATE matchmaking_draws SET event_id = ? WHERE id = ?').run(foreignEventId, foreign.draw.id);
  const refused = await request(app).patch(`/api/matchmaking/draws/${foreign.draw.id}/server`)
    .send({ serverAddress: 'evil' });
  assert.equal(refused.status, 404);
  assert.deepEqual(storedServer(foreign.draw.id), { serverAddress: null, serverPassword: null });

  const recorded = await request(app).post('/api/matches').send({
    gameId,
    teams: draw.teams.map((team) => ({ playerIds: team.players.map((player) => player.id) })),
    winnerTeamIndex: 0,
    drawId: draw.id,
  });
  assert.equal(recorded.status, 201);
  const afterResult = await request(app).patch(`/api/matchmaking/draws/${draw.id}/server`).send({ serverAddress: 'late' });
  assert.equal(afterResult.status, 409);
  assert.deepEqual(storedServer(draw.id), { serverAddress: 'lan-host', serverPassword: 'pw' });

  const tournamentDraw = await openServerTestDraw('Server Tournament Game');
  const tournament = await request(app).post('/api/tournaments').send({
    gameId: tournamentDraw.gameId,
    format: 'single_elimination',
    drawId: tournamentDraw.draw.id,
    teams: tournamentDraw.draw.teams.map((team) => ({ playerIds: team.players.map((player) => player.id) })),
  });
  assert.equal(tournament.status, 201);
  const afterTournament = await request(app).patch(`/api/matchmaking/draws/${tournamentDraw.draw.id}/server`)
    .send({ serverAddress: 'late' });
  assert.equal(afterTournament.status, 409);
  assert.match(afterTournament.body.error, /Turnier/);
});

test('parallel PATCH /api/matchmaking/draws/:id/server writes one complete pair and loses cleanly to a recorded result', async () => {
  const { draw } = await openServerTestDraw('Server Race Game');
  const payloads = [
    { serverAddress: 'host-a', serverPassword: 'pw-a' },
    { serverAddress: 'host-b', serverPassword: 'pw-b' },
  ];
  const edits = await Promise.all(payloads.map((body) =>
    request(app).patch(`/api/matchmaking/draws/${draw.id}/server`).send(body)));
  assert.deepEqual(edits.map((res) => res.status), [200, 200]);
  const stored = storedServer(draw.id);
  assert.ok(payloads.some((body) => body.serverAddress === stored.serverAddress && body.serverPassword === stored.serverPassword),
    `fields of different edits were mixed: ${JSON.stringify(stored)}`);

  const race = await openServerTestDraw('Server Result Race Game');
  const [edit, result] = await Promise.all([
    request(app).patch(`/api/matchmaking/draws/${race.draw.id}/server`).send({ serverAddress: 'racing-host' }),
    request(app).post('/api/matches').send({
      gameId: race.gameId,
      teams: race.draw.teams.map((team) => ({ playerIds: team.players.map((player) => player.id) })),
      winnerTeamIndex: 0,
      drawId: race.draw.id,
    }),
  ]);
  assert.equal(result.status, 201, JSON.stringify(result.body));
  assert.ok([200, 409].includes(edit.status), `unexpected status ${edit.status}`);
  // A losing edit must not have written anything after the draw was frozen.
  assert.equal(storedServer(race.draw.id).serverAddress, edit.status === 200 ? 'racing-host' : null);
});

type DrawTeam = { players: Array<{ id: string }>; totalRating: number };
const teamIds = (teams: DrawTeam[]) => teams.map((team) => team.players.map((player) => player.id));
const removePlayer = (drawId: string, playerId: string) =>
  request(app).delete(`/api/matchmaking/draws/${drawId}/players/${playerId}`);

test('DELETE /api/matchmaking/draws/:id/players/:playerId removes a player and drops a team only while two remain', async () => {
  const game = await request(app).post('/api/games').send({ name: 'Remove Player Open Draw' });
  const draw = await request(app).post('/api/matchmaking')
    .send({ gameId: game.body.id, playerIds: playerIds.slice(0, 4), teamCount: 3 });
  const lineup = teamIds(draw.body.teams);
  const big = lineup.findIndex((ids) => ids.length === 2);
  const [soloA, soloB] = lineup.filter((ids) => ids.length === 1).map((ids) => ids[0]);

  assert.equal((await removePlayer(draw.body.id, 'not valid!')).status, 400);
  assert.equal((await removePlayer('nope', playerIds[0])).status, 404);

  const fromBig = await removePlayer(draw.body.id, lineup[big][0]);
  assert.equal(fromBig.status, 200);
  assert.deepEqual(fromBig.body.teams[big].players.map((p: { id: string }) => p.id), [lineup[big][1]]);
  assert.equal(fromBig.body.teams.length, 3);
  const rating = db.prepare('SELECT rating FROM skills WHERE game_id = ? AND player_id = ?').get(game.body.id, lineup[big][1]) as
    { rating: number } | undefined;
  assert.equal(fromBig.body.teams[big].totalRating, rating?.rating ?? 3);

  const dropped = await removePlayer(draw.body.id, soloA);
  assert.equal(dropped.status, 200);
  assert.equal(dropped.body.teams.length, 2);
  assert.equal(teamIds(dropped.body.teams).flat().includes(soloA), false);

  const lastTwo = await removePlayer(draw.body.id, soloB);
  assert.equal(lastTwo.status, 409);
  assert.match(lastTwo.body.error, /mindestens zwei Teams/);
  const stored = db.prepare('SELECT teams FROM matchmaking_draws WHERE id = ?').get(draw.body.id) as { teams: string };
  assert.equal(JSON.parse(stored.teams).length, 2);
});

test('DELETE /api/matchmaking/draws/:id/players/:playerId lets exactly one of two parallel removals win', async () => {
  const game = await request(app).post('/api/games').send({ name: 'Remove Player Race' });
  const draw = await request(app).post('/api/matchmaking')
    .send({ gameId: game.body.id, playerIds: playerIds.slice(0, 4), teamCount: 2 });
  const target = draw.body.teams[0].players[0].id;

  const statuses = (await Promise.all([removePlayer(draw.body.id, target), removePlayer(draw.body.id, target)]))
    .map((res) => res.status).sort();
  assert.deepEqual(statuses, [200, 409]);
  const stored = db.prepare('SELECT teams FROM matchmaking_draws WHERE id = ?').get(draw.body.id) as { teams: string };
  assert.deepEqual(teamIds(JSON.parse(stored.teams)).flat().sort(),
    playerIds.slice(0, 4).filter((id) => id !== target).sort());
});

test('DELETE /api/matchmaking/draws/:id/players/:playerId on a recorded result takes away only that player\'s game points', async () => {
  const game = await request(app).post('/api/games').send({ name: 'Remove Player Recorded' });
  const draw = await request(app).post('/api/matchmaking')
    .send({ gameId: game.body.id, playerIds: playerIds.slice(0, 4), teamCount: 2 });
  const [winners, losers] = teamIds(draw.body.teams);
  const recorded = await request(app).post('/api/matches').send({
    gameId: game.body.id,
    teams: [{ playerIds: winners }, { playerIds: losers }],
    winnerTeamIndex: 0,
    drawId: draw.body.id,
  });
  assert.equal(recorded.status, 201);
  const leaver = losers[0];

  const removed = await removePlayer(draw.body.id, leaver);
  assert.equal(removed.status, 200);
  assert.equal(removed.body.matchId, recorded.body.id);
  assert.equal(removed.body.winnerTeamIndex, 0);
  assert.deepEqual(teamIds(removed.body.teams), [winners, losers.slice(1)]);
  const match = db.prepare('SELECT result FROM matches WHERE id = ?').get(recorded.body.id) as { result: string };
  assert.deepEqual(JSON.parse(match.result).teams.map((t: { playerIds: string[] }) => t.playerIds), [winners, losers.slice(1)]);

  // Last place still earns its participation point for the remaining loser;
  // the removed player no longer appears at all.
  const standings = (await request(app).get(`/api/leaderboard?gameId=${game.body.id}`)).body.standings as
    Array<{ playerId: string; points: number }>;
  const pointsOf = new Map(standings.map((s) => [s.playerId, s.points]));
  assert.equal(pointsOf.has(leaver), false);
  for (const id of winners) assert.equal(pointsOf.get(id), 4);
  assert.equal(pointsOf.get(losers[1]), 1);
  const award = db.prepare('SELECT amount FROM points_playing_awards WHERE player_id = ? AND source_key = ?')
    .get(leaver, `match:${recorded.body.id}`) as { amount: number } | undefined;
  assert.equal(award?.amount ?? 0, 0);

  const lastOfTeam = await removePlayer(draw.body.id, losers[1]);
  assert.equal(lastOfTeam.status, 409);
});

test('DELETE /api/matchmaking/draws/:id/players/:playerId leaves tournament teams unchanged', async () => {
  const game = await request(app).post('/api/games').send({ name: 'Remove Player Tournament Guard' });
  const draw = await request(app).post('/api/matchmaking')
    .send({ gameId: game.body.id, playerIds: playerIds.slice(0, 4), teamCount: 2 });
  const tournament = await request(app).post('/api/tournaments').send({
    gameId: game.body.id,
    format: 'single_elimination',
    drawId: draw.body.id,
    teams: teamIds(draw.body.teams).map((ids) => ({ playerIds: ids })),
  });
  assert.equal(tournament.status, 201);
  const res = await removePlayer(draw.body.id, draw.body.teams[0].players[0].id);
  assert.equal(res.status, 409);
  assert.match(res.body.error, /Turnier/);
});
