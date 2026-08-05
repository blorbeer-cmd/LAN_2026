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

test('an open draw of a game demoted afterwards can still be completed', async () => {
  // Everything below runs on a second catalog game, so the demotion here does
  // not interfere with the shared fixtures above.
  const gameId = (await request(app).post('/api/games').send({ name: 'Selection Drawn Game' })).body.id;
  const draw = await request(app).post('/api/matchmaking').send({ gameId, playerIds: players });
  assert.equal(draw.status, 200, JSON.stringify(draw.body));

  const demoted = await request(app).post(`/api/games/${gameId}/demote`).send();
  assert.equal(demoted.status, 200);
  assert.equal(demoted.body.isSuggestion, true);

  // Recording what was actually played is history, not scheduling: the result
  // linked to that draw goes through.
  const recorded = await request(app)
    .post('/api/matches')
    .send({
      gameId,
      drawId: draw.body.id,
      teams: [{ playerIds: [players[0]] }, { playerIds: [players[1]] }],
      winnerTeamIndex: 0,
    });
  assert.equal(recorded.status, 201, JSON.stringify(recorded.body));

  // An ad-hoc result without that link stays refused, and so does a fresh draw.
  const adHoc = await request(app)
    .post('/api/matches')
    .send({ gameId, teams: [{ playerIds: [players[0]] }, { playerIds: [players[1]] }] });
  assert.equal(adHoc.status, 400);
  const rematch = await request(app)
    .post('/api/matchmaking/rematch')
    .send({ gameId, teams: [{ playerIds: [players[0]] }, { playerIds: [players[1]] }] });
  assert.equal(rematch.status, 400);
});

test('a game demoted mid-round keeps this round votes, totals and winner chance', async () => {
  const otherId = (await request(app).post('/api/games').send({ name: 'Selection Voted Game' })).body.id;
  const started = await request(app).post('/api/votes/start').send();
  assert.equal(started.status, 201);

  const submitted = await request(app)
    .post('/api/votes/points')
    .send({
      playerId: players[1],
      entries: [
        { gameId: catalogGameId, points: 4 },
        { gameId: otherId, points: 9 },
      ],
    });
  assert.equal(submitted.status, 200, JSON.stringify(submitted.body));

  const demoted = await request(app).post(`/api/games/${otherId}/demote`).send();
  assert.equal(demoted.status, 200);

  // The demotion must not erase what was already cast: the game stays on this
  // round's ballot with its points, and the totals stay whole.
  const current = await request(app).get('/api/votes');
  assert.equal(current.status, 200);
  const ballotIds = current.body.results.map((r: { gameId: string }) => r.gameId);
  assert.ok(ballotIds.includes(otherId), 'a demoted game with votes stays on this round');
  assert.ok(!ballotIds.includes(suggestionGameId), 'a suggestion without votes stays off the ballot');
  assert.equal(current.body.totalPoints, 13);

  // A player who had not submitted yet can still rate it — everyone sees the
  // same ballot for the whole round.
  const late = await request(app)
    .post('/api/votes/points')
    .send({ playerId: players[2], entries: [{ gameId: otherId, points: 2 }] });
  assert.equal(late.status, 200, JSON.stringify(late.body));

  const closed = await request(app).post('/api/votes/close').send();
  assert.equal(closed.status, 200);
  assert.deepEqual(closed.body.winnerGameIds, [otherId], 'the demoted game can still win its own round');
  const closedRow = closed.body.results.find((r: { gameId: string }) => r.gameId === otherId);
  assert.equal(closedRow.points, 11);
});

test('a runoff still offers the tied winners after one of them was demoted', async () => {
  const history = await request(app).get('/api/votes/history');
  const lastRound = history.body.history[0];
  assert.ok(lastRound.winners.length >= 1);

  // The previous round's winners are what the "Stichwahl" button sends — a
  // demoted winner among them must not block the whole runoff.
  const runoff = await request(app)
    .post('/api/votes/start')
    .send({ mode: 'single', title: 'Stichwahl', gameIds: lastRound.winners.map((w: { gameId: string }) => w.gameId) });
  assert.equal(runoff.status, 201, JSON.stringify(runoff.body));
  const runoffIds = runoff.body.results.map((r: { gameId: string }) => r.gameId);
  assert.ok(runoffIds.includes(lastRound.winners[0].gameId), 'the demoted winner is on the runoff ballot');

  // Voting for it works too, otherwise the runoff could not be decided.
  const vote = await request(app)
    .post('/api/votes')
    .send({ playerId: players[0], gameId: lastRound.winners[0].gameId });
  assert.equal(vote.status, 200, JSON.stringify(vote.body));

  // A suggestion that never won anything stays refused as a runoff candidate.
  await request(app).post('/api/votes/cancel').send();
  const bogus = await request(app)
    .post('/api/votes/start')
    .send({ mode: 'single', gameIds: [catalogGameId, suggestionGameId] });
  assert.equal(bogus.status, 400);
});
