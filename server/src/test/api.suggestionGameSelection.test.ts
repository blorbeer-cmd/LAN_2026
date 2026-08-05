// A suggestion is a proposal, not a game the group has agreed to play: it may
// collect Bock/Skill ratings in the Spiele view, but no vote, tournament,
// draw, draft, recorded result or game ping may reference it until someone
// promotes it into the catalog. The frontend hides suggestions from those
// pickers (catalogGames() in public/js/state.js); these tests cover the
// server-side half of the same rule.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createTestApp } from './testApp';

const app = createTestApp();

let catalogGameId: string;
let suggestionGameId: string;
let players: string[];

test('setup: one catalog game, one suggestion and enough players', async () => {
  catalogGameId = (await request(app).post('/api/games').send({ name: 'Selection Catalog Game' })).body.id;
  const suggester = await request(app).post('/api/players').send({ name: 'Selection Suggester' });
  const suggestion = await request(app)
    .post('/api/games')
    .send({ name: 'Selection Suggested Game', status: 'suggestion', playerId: suggester.body.id });
  assert.equal(suggestion.status, 201);
  assert.equal(suggestion.body.isSuggestion, true);
  suggestionGameId = suggestion.body.id;

  players = [suggester.body.id];
  for (const name of ['Selection Bob', 'Selection Cara', 'Selection Dan']) {
    players.push((await request(app).post('/api/players').send({ name })).body.id);
  }
});

test('a suggestion cannot be put on a vote ballot, drawn, drafted or scheduled', async () => {
  const voteRound = await request(app).post('/api/votes/start').send({ gameIds: [suggestionGameId] });
  assert.equal(voteRound.status, 400);
  assert.match(voteRound.body.error, /Vorschlag/);

  const draw = await request(app).post('/api/matchmaking').send({ gameId: suggestionGameId, playerIds: players });
  assert.equal(draw.status, 400);

  const draft = await request(app)
    .post('/api/draft/start')
    .send({ gameId: suggestionGameId, captainIds: [players[0], players[1]], poolPlayerIds: [players[2], players[3]] });
  assert.equal(draft.status, 400);

  const tournament = await request(app)
    .post('/api/tournaments')
    .send({
      gameId: suggestionGameId,
      format: 'round_robin',
      teams: [{ playerIds: [players[0]] }, { playerIds: [players[1]] }],
    });
  assert.equal(tournament.status, 400);

  const ping = await request(app).post('/api/pings').send({ playerId: players[0], gameId: suggestionGameId });
  assert.equal(ping.status, 400);

  const match = await request(app)
    .post('/api/matches')
    .send({ gameId: suggestionGameId, teams: [{ playerIds: [players[0]] }, { playerIds: [players[1]] }] });
  assert.equal(match.status, 400);
});

test('the same requests still work for an accepted catalog game', async () => {
  const draw = await request(app).post('/api/matchmaking').send({ gameId: catalogGameId, playerIds: players });
  assert.equal(draw.status, 200, JSON.stringify(draw.body));

  const match = await request(app)
    .post('/api/matches')
    .send({ gameId: catalogGameId, teams: [{ playerIds: [players[0]] }, { playerIds: [players[1]] }], winnerTeamIndex: 0 });
  assert.equal(match.status, 201, JSON.stringify(match.body));

  const ping = await request(app).post('/api/pings').send({ playerId: players[0], gameId: catalogGameId });
  assert.equal(ping.status, 201, JSON.stringify(ping.body));
});

test('an unrestricted round covers the catalog only, and a suggestion vote is refused', async () => {
  const started = await request(app).post('/api/votes/start').send();
  assert.equal(started.status, 201);
  const ballotIds = started.body.results.map((r: { gameId: string }) => r.gameId);
  assert.ok(ballotIds.includes(catalogGameId), 'the catalog game belongs on the ballot');
  assert.ok(!ballotIds.includes(suggestionGameId), 'the suggestion must not be votable');

  const points = await request(app)
    .post('/api/votes/points')
    .send({ playerId: players[0], entries: [{ gameId: suggestionGameId, points: 5 }] });
  assert.equal(points.status, 400);
  assert.match(points.body.error, /Vorschlag/);

  const accepted = await request(app)
    .post('/api/votes/points')
    .send({ playerId: players[0], entries: [{ gameId: catalogGameId, points: 5 }] });
  assert.equal(accepted.status, 200, JSON.stringify(accepted.body));

  await request(app).post('/api/votes/cancel').send();
});

test('promoting the suggestion makes it selectable everywhere', async () => {
  const promoted = await request(app).post(`/api/games/${suggestionGameId}/promote`).send();
  assert.equal(promoted.status, 200);
  assert.equal(promoted.body.isSuggestion, false);

  const draw = await request(app).post('/api/matchmaking').send({ gameId: suggestionGameId, playerIds: players });
  assert.equal(draw.status, 200, JSON.stringify(draw.body));

  const started = await request(app).post('/api/votes/start').send();
  assert.equal(started.status, 201);
  const ballotIds = started.body.results.map((r: { gameId: string }) => r.gameId);
  assert.ok(ballotIds.includes(suggestionGameId), 'the promoted game is on the ballot');
  await request(app).post('/api/votes/cancel').send();
});

test('a game demoted after it was played keeps its recorded result editable', async () => {
  const match = await request(app)
    .post('/api/matches')
    .send({ gameId: suggestionGameId, teams: [{ playerIds: [players[0]] }, { playerIds: [players[1]] }], winnerTeamIndex: 0 });
  assert.equal(match.status, 201, JSON.stringify(match.body));

  const demoted = await request(app).post(`/api/games/${suggestionGameId}/demote`).send();
  assert.equal(demoted.status, 200);
  assert.equal(demoted.body.isSuggestion, true);

  // Correcting the winner keeps the match on its own (now demoted) game.
  const edited = await request(app)
    .patch(`/api/matches/${match.body.id}`)
    .send({ gameId: suggestionGameId, winnerTeamIndex: 1 });
  assert.equal(edited.status, 200, JSON.stringify(edited.body));
  assert.equal(edited.body.winnerTeamIndex, 1);

  // Moving a result onto a suggestion is still refused.
  const moved = await request(app)
    .patch(`/api/matches/${match.body.id}`)
    .send({ gameId: catalogGameId, winnerTeamIndex: 1 });
  assert.equal(moved.status, 200, JSON.stringify(moved.body));
  const movedBack = await request(app)
    .patch(`/api/matches/${match.body.id}`)
    .send({ gameId: suggestionGameId, winnerTeamIndex: 1 });
  assert.equal(movedBack.status, 400);
});
