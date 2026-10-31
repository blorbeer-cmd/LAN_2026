// Integration tests for the Mehrjahres-Hall-of-Fame aggregation.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createTestApp, TEST_ADMIN_ID, DEFAULT_GROUP_ID } from './testApp';
import { createEvent, setParticipants } from '../events';
import { setActiveEventForPlayer } from '../eventContext';

const app = createTestApp();
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
  const roster = await request(app)
    .put(`/api/events/${activeEventId}/participants`)
    .send({ playerIds: [TEST_ADMIN_ID, playerA, playerB] });
  assert.equal(roster.status, 200, JSON.stringify(roster.body));
  const selected = await request(app).put('/api/me/active-event').send({ eventId: activeEventId });
  assert.equal(selected.status, 200, JSON.stringify(selected.body));
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
      teams: [
        { name: 'Alice Squad', playerIds: [playerA] },
        { name: 'Bob Squad', playerIds: [playerB] },
      ],
    });
  const final = created.body.matches[0];
  // Bracket sides are drawn at random, so pick Alice's team by name.
  const aliceTeamId = created.body.teams.find((team: { name: string }) => team.name === 'Alice Squad').id;
  await request(app)
    .post(`/api/tournaments/${created.body.id}/matches/${final.id}/result`)
    .send({ winnerTeamId: aliceTeamId });
});

test('GET /api/hall-of-fame includes this event with the right overall + tournament champion', async () => {
  const res = await request(app).get('/api/hall-of-fame');
  assert.equal(res.status, 200);

  const entry = res.body.events.find((e: { eventId: string }) => e.eventId === activeEventId);
  assert.ok(entry, 'active event should be present');
  assert.equal(entry.overallChampion.playerId, playerA);
  assert.equal(entry.overallStandings[0].playerId, playerA);
  assert.equal(entry.overallStandings[1].playerId, playerB);
  assert.ok(entry.overallStandings[0].points > entry.overallStandings[1].points);
  assert.equal(entry.overallStandings[0].matchesPlayed, 2);
  assert.ok(
    entry.tournamentChampions.some((t: { championPlayers: string[] }) => t.championPlayers.includes('HoF Alice')),
  );
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
    .send({ name: 'Empty HoF Event', startsAt: Date.now(), endsAt: Date.now() + 5 * 60_000 });
  assert.equal(created.status, 201);
  const roster = await request(app)
    .put(`/api/events/${created.body.id}/participants`)
    .send({ playerIds: [TEST_ADMIN_ID] });
  assert.equal(roster.status, 200, JSON.stringify(roster.body));
  const res = await request(app).get('/api/hall-of-fame');
  const entry = res.body.events.find((e: { eventId: string }) => e.eventId === created.body.id);
  assert.ok(entry);
  assert.equal(entry.overallChampion, null);
  assert.deepEqual(entry.overallStandings, []);
  assert.deepEqual(entry.tournamentChampions, []);
});

test('frozen LAN points retain shared champions, shared places and equal all-time credits, including zero balances', async () => {
  const players = [TEST_ADMIN_ID];
  for (const name of ['AAA Shared Alice', 'ZZZ Shared Bob', 'Middle Lower']) {
    players.push((await request(app).post('/api/players').send({ name })).body.id);
  }
  for (const initialPoints of [100, 0]) {
    const event = createEvent(`Shared points ${initialPoints}`, {
      groupId: DEFAULT_GROUP_ID,
      startsAt: Date.now(),
      endsAt: Date.now() + 86400000,
    });
    setParticipants(event.id, players);
    setActiveEventForPlayer(TEST_ADMIN_ID, event.id);
    assert.equal((await request(app).put('/api/points/settings').send({ initialPoints })).status, 200);
    if (initialPoints > 0) {
      const entries = (await request(app).get('/api/points/admin/entries')).body.entries;
      const lowerCredit = entries.find(
        (entry: { player_id: string; source: string }) => entry.player_id === players[3] && entry.source === 'start',
      );
      assert.equal(
        (
          await request(app)
            .post(`/api/points/entries/${lowerCredit.id}/deduct`)
            .send({ amount: 10, reason: 'Lower fourth place', requestId: 'hof-lower' })
        ).status,
        200,
      );
    }
    assert.equal((await request(app).post('/api/points/close').send({})).status, 200);
    const response = await request(app).get(`/api/hall-of-fame?eventId=${event.id}`);
    assert.equal(response.status, 200);
    const summary = response.body.events[0];
    const champions = initialPoints > 0 ? players.slice(0, 3) : players;
    assert.equal(summary.scoringModel, 'lan_points');
    assert.equal(summary.overallChampion, null, 'there is no sole champion in a tied points event');
    assert.deepEqual(
      summary.overallChampions.map((p: { playerId: string }) => p.playerId).sort(),
      [...champions].sort(),
    );
    assert.deepEqual(
      summary.overallStandings.map((p: { rank: number }) => p.rank),
      initialPoints > 0 ? [1, 1, 1, 4] : [1, 1, 1, 1],
    );
    assert.deepEqual(
      response.body.allTime.mostOverallWins.map((p: { playerId: string }) => p.playerId).sort(),
      [...champions].sort(),
    );
    assert.ok(response.body.allTime.mostOverallWins.every((p: { count: number }) => p.count === 1));
  }
});
