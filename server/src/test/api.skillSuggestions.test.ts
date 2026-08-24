// Integration tests for the skill-suggestion endpoint: exercises it through
// real recorded matches rather than re-testing the Elo math itself (that's
// covered in skillSuggestion.test.ts).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createTestApp, TEST_ADMIN_ID } from './testApp';
import { db, DEFAULT_GROUP_ID } from '../db';

const app = createTestApp();
let winnerId: string;
let loserId: string;
let gameId: string;

test('setup: two players and a game', async () => {
  const winner = await request(app).post('/api/players').send({ name: 'Suggestion Winner' });
  const loser = await request(app).post('/api/players').send({ name: 'Suggestion Loser' });
  const game = await request(app).post('/api/games').send({ name: 'Suggestion Test Game' });
  winnerId = winner.body.id;
  loserId = loser.body.id;
  gameId = game.body.id;
});

test('GET /api/skills/suggestions omits a game with fewer than 3 decided results', async () => {
  for (let i = 0; i < 2; i++) {
    const res = await request(app)
      .post('/api/matches')
      .send({ gameId, teams: [{ playerIds: [winnerId] }, { playerIds: [loserId] }], winnerTeamIndex: 0 });
    assert.equal(res.status, 201);
  }
  const res = await request(app).get('/api/skills/suggestions');
  assert.equal(res.status, 200);
  assert.ok(!res.body.suggestions.some((s: { gameId: string }) => s.gameId === gameId));
});

test('GET /api/skills/suggestions rates the consistent winner above the consistent loser once there are 3+ results', async () => {
  const res = await request(app)
    .post('/api/matches')
    .send({ gameId, teams: [{ playerIds: [winnerId] }, { playerIds: [loserId] }], winnerTeamIndex: 0 });
  assert.equal(res.status, 201);

  const list = await request(app).get('/api/skills/suggestions');
  assert.equal(list.status, 200);
  const forGame = list.body.suggestions.filter((s: { gameId: string }) => s.gameId === gameId);
  assert.equal(forGame.length, 2);

  const winnerSuggestion = forGame.find((s: { playerId: string }) => s.playerId === winnerId);
  const loserSuggestion = forGame.find((s: { playerId: string }) => s.playerId === loserId);
  assert.ok(winnerSuggestion.rating > loserSuggestion.rating);
  assert.equal(winnerSuggestion.matchCount, 3);
  assert.equal(winnerSuggestion.wins, 3);
  assert.equal(loserSuggestion.wins, 0);
});

// The suggestion carries gamesPlayed and wins per player, so it is a report
// on how an event went. Reading it must therefore follow the same personal
// participation allowlist as every other endpoint derived from `matches`
// (Rangliste, Hall of Fame, Auswertungen) — otherwise it is the one remaining
// instance-wide all-events aggregate and tells an account that was never
// invited to a private event exactly who played and won there.
test('GET /api/skills/suggestions ignores matches from an event this account never joined', async () => {
  const now = Date.now();
  const privateEvent = await request(app)
    .post('/api/events')
    .send({ name: 'Privates Event', startsAt: now, endsAt: now + 5 * 60_000 });
  assert.equal(privateEvent.status, 201, JSON.stringify(privateEvent.body));
  const privateEventId = privateEvent.body.id as string;
  // Creating an event is not attending it: drop the creator's own roster row
  // and its history so this account has provably never taken part.
  db.prepare('DELETE FROM event_participants WHERE event_id = ? AND player_id = ?').run(privateEventId, TEST_ADMIN_ID);
  db.prepare('DELETE FROM event_participation_history WHERE event_id = ? AND player_id = ?').run(
    privateEventId,
    TEST_ADMIN_ID,
  );

  const privateGame = await request(app).post('/api/games').send({ name: 'Private Event Game' });
  const privateGameId = privateGame.body.id as string;
  const insertMatch = db.prepare(
    'INSERT INTO matches (id, group_id, game_id, event_id, played_at, result) VALUES (?, ?, ?, ?, ?, ?)',
  );
  const result = JSON.stringify({
    teams: [{ playerIds: [winnerId] }, { playerIds: [loserId] }],
    winnerTeamIndex: 0,
  });
  for (let i = 0; i < 4; i++) {
    insertMatch.run(`private-match-${i}`, DEFAULT_GROUP_ID, privateGameId, privateEventId, now + i, result);
  }

  const hidden = await request(app).get('/api/skills/suggestions');
  assert.equal(hidden.status, 200);
  assert.equal(
    hidden.body.suggestions.some((s: { gameId: string }) => s.gameId === privateGameId),
    false,
    'four decided results are well past the threshold, so only the missing participation can be hiding them',
  );

  // Same rows, same reader — the only thing that changes is that the account
  // now has an accepted participation in that event.
  db.prepare("INSERT INTO event_participants (event_id, player_id, status) VALUES (?, ?, 'accepted')").run(
    privateEventId,
    TEST_ADMIN_ID,
  );
  const visible = await request(app).get('/api/skills/suggestions');
  const forGame = visible.body.suggestions.filter((s: { gameId: string }) => s.gameId === privateGameId);
  assert.equal(forGame.length, 2, 'attending the event makes its own results count again');
  assert.equal(
    forGame.find((s: { playerId: string }) => s.playerId === winnerId).wins,
    4,
  );
});

test('GET /api/skills/suggestions rejects an explicit event the account never joined', async () => {
  const now = Date.now();
  const other = await request(app)
    .post('/api/events')
    .send({ name: 'Nicht besucht', startsAt: now, endsAt: now + 5 * 60_000 });
  const otherId = other.body.id as string;
  db.prepare('DELETE FROM event_participants WHERE event_id = ? AND player_id = ?').run(otherId, TEST_ADMIN_ID);
  db.prepare('DELETE FROM event_participation_history WHERE event_id = ? AND player_id = ?').run(otherId, TEST_ADMIN_ID);

  assert.equal((await request(app).get(`/api/skills/suggestions?eventId=${otherId}`)).status, 404);
  assert.equal((await request(app).get('/api/skills/suggestions?eventId=does-not-exist')).status, 404);
});

test('GET /api/skills/suggestions ignores an undecided match toward the threshold', async () => {
  const otherGame = await request(app).post('/api/games').send({ name: 'Undecided Only Game' });
  for (let i = 0; i < 5; i++) {
    await request(app)
      .post('/api/matches')
      .send({ gameId: otherGame.body.id, teams: [{ playerIds: [winnerId] }, { playerIds: [loserId] }] });
  }
  const res = await request(app).get('/api/skills/suggestions');
  assert.ok(!res.body.suggestions.some((s: { gameId: string }) => s.gameId === otherGame.body.id));
});
