import { before, test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createTestApp, sessionCookie } from './testApp';

const app = createTestApp();
let playerId: string;
let otherPlayerId: string;
let gameId: string;
let otherGameId: string;

before(async () => {
  const createPlayer = (name: string) => request(app).post('/api/players').send({ name }).expect(201);
  const createGame = (name: string) => request(app).post('/api/games').send({ name }).expect(201);
  playerId = (await createPlayer('Rating tester')).body.id;
  otherPlayerId = (await createPlayer('Other rating tester')).body.id;
  gameId = (await createGame('Rated game')).body.id;
  otherGameId = (await createGame('Other rated game')).body.id;
});

for (const [resource, updatedRating] of [['skills', 4], ['preferences', 3]] as const) {
  const url = `/api/${resource}`;

  test(`${resource}: reject out-of-range ratings, unknown games and writes for another player`, async () => {
    const put = (values: Partial<{ playerId: string; gameId: string; rating: number }>) =>
      request(app).put(url).send({ playerId, gameId, rating: 5, ...values });

    await put({ rating: -1 }).expect(400);
    await put({ rating: 6 }).expect(400);
    await put({ gameId: 'ghost' }).expect(404);
    await put({ playerId: 'ghost' }).expect(401);
    await put({ playerId: otherPlayerId }).set('Cookie', sessionCookie(playerId)).expect(403);
  });

  test(`${resource}: store zero, replace one rating, filter by player or game, and delete`, async () => {
    const put = (ratedPlayer: string, ratedGame: string, rating: number) =>
      request(app).put(url).send({ playerId: ratedPlayer, gameId: ratedGame, rating }).expect(200);
    const list = (query: { playerId?: string; gameId?: string }) =>
      request(app).get(url).query(query).expect(200);
    const row = (player_id: string, game_id: string, rating: number) => ({ player_id, game_id, rating });

    await put(playerId, otherGameId, 1);
    await put(otherPlayerId, otherGameId, 2);
    assert.equal((await put(playerId, gameId, 0)).body.rating, 0);
    assert.deepEqual((await list({ gameId })).body, [row(playerId, gameId, 0)]);

    await put(playerId, gameId, updatedRating);
    assert.deepEqual((await list({ gameId })).body, [row(playerId, gameId, updatedRating)]);
    assert.deepEqual(
      (await list({ playerId })).body.map((entry: { game_id: string }) => entry.game_id).sort(),
      [gameId, otherGameId].sort(),
    );

    const ratingUrl = `${url}/${playerId}/${gameId}`;
    await request(app).delete(ratingUrl).expect(204);
    assert.deepEqual((await list({ playerId })).body, [row(playerId, otherGameId, 1)]);
    await request(app).delete(ratingUrl).expect(404);
  });
}
