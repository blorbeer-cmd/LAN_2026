// Integration tests for the Mehrjahres-Hall-of-Fame aggregation.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../app';

const app = createApp();
let gameId: string;
let playerA: string;
let playerB: string;
let activeEventId: string;

test('setup: a game, two players, a match, and a completed tournament', async () => {
  const game = await request(app).post('/api/games').send({ name: 'HoF Test Game' });
  gameId = game.body.id;
  const a = await request(app).post('/api/players').send({ name: 'HoF Alice' });
  const b = await request(app).post('/api/players').send({ name: 'HoF Bob' });
  playerA = a.body.id;
  playerB = b.body.id;

  // Hall of Fame only ever covers real (trackable) events, never "außerhalb
  // von Events" — create and start tracking one so this data lands there.
  const trackedEvent = await request(app)
    .post('/api/events')
    .send({ name: 'HoF Test Event', startsAt: Date.now(), endsAt: Date.now() + 24 * 60 * 60 * 1000 });
  activeEventId = trackedEvent.body.id;
  await request(app).post(`/api/events/${activeEventId}/tracking/start`).send({});

  // Alice wins the overall leaderboard for this event...
  await request(app)
    .post('/api/matches')
    .send({ gameId, teams: [{ playerIds: [playerA] }, { playerIds: [playerB] }], winnerTeamIndex: 0 });

  // ...and also wins a tournament.
  const created = await request(app)
    .post('/api/tournaments')
    .send({
      gameId,
      format: 'single_elimination',
      teams: [{ name: 'Alice Squad', playerIds: [playerA] }, { name: 'Bob Squad', playerIds: [playerB] }],
    });
  const final = created.body.matches[0];
  await request(app)
    .post(`/api/tournaments/${created.body.id}/matches/${final.id}/result`)
    .send({ winnerTeamId: final.teamAId });
});

test('GET /api/hall-of-fame includes this event with the right overall + tournament champion', async () => {
  const res = await request(app).get('/api/hall-of-fame');
  assert.equal(res.status, 200);

  const entry = res.body.events.find((e: { eventId: string }) => e.eventId === activeEventId);
  assert.ok(entry, 'active event should be present');
  assert.equal(entry.overallChampion.playerId, playerA);
  assert.ok(entry.tournamentChampions.some((t: { championPlayers: string[] }) => t.championPlayers.includes('HoF Alice')));
});

test('GET /api/hall-of-fame all-time rankings credit the champion', async () => {
  const res = await request(app).get('/api/hall-of-fame');
  const overall = res.body.allTime.mostOverallWins.find((r: { playerId: string }) => r.playerId === playerA);
  const tourney = res.body.allTime.mostTournamentWins.find((r: { playerId: string }) => r.playerId === playerA);
  assert.ok(overall && overall.count >= 1);
  assert.ok(tourney && tourney.count >= 1);
});

test('GET /api/hall-of-fame reports no champion for an event with no matches', async () => {
  const created = await request(app)
    .post('/api/events')
    .send({ name: 'Empty HoF Event', startsAt: Date.now(), endsAt: Date.now() + 1000 });
  assert.equal(created.status, 201);
  const res = await request(app).get('/api/hall-of-fame');
  const entry = res.body.events.find((e: { eventId: string }) => e.eventId === created.body.id);
  assert.ok(entry);
  assert.equal(entry.overallChampion, null);
  assert.deepEqual(entry.tournamentChampions, []);
});
