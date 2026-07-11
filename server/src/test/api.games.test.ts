// Integration tests for game CRUD and process-name mappings.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../app';

const app = createApp();
let createdId: string;

test('GET /api/games returns the seeded default games with process names', async () => {
  const res = await request(app).get('/api/games');
  assert.equal(res.status, 200);
  assert.ok(res.body.length >= 5);
  const cs2 = res.body.find((g: { name: string }) => g.name === 'Counter-Strike 2');
  assert.ok(cs2);
  assert.ok(cs2.processNames.includes('cs2.exe'));
  assert.equal(cs2.isSuggestion, false);
});

test('GET /api/games also includes the seeded catalog pool (platform/trailer, no process names)', async () => {
  const res = await request(app).get('/api/games');
  const dota = res.body.find((g: { name: string }) => g.name === 'DOTA 2');
  assert.ok(dota);
  assert.equal(dota.isSuggestion, false);
  assert.match(dota.platform_url, /store\.steampowered\.com/);
  assert.match(dota.trailer_url, /youtube\.com/);
  assert.deepEqual(dota.processNames, []);
});

test('GET /api/games reflects the July 2026 catalog revision', async () => {
  const res = await request(app).get('/api/games');
  const names = res.body.map((g: { name: string }) => g.name);

  for (const removed of ['CS 1.5', 'CS 1.6', 'CS GO', 'Iron Harvest', 'Splitgate', 'Worms', 'Warcraft 3']) {
    assert.ok(!names.includes(removed), `${removed} should be gone from the catalog`);
  }

  const battlefront = res.body.find((g: { name: string }) => g.name === 'Star Wars Battlefront 2');
  assert.ok(battlefront);
  assert.match(battlefront.platform_url, /app\/1237950/);

  const trackmania = res.body.find((g: { name: string }) => g.name === 'TrackMania Nations Forever');
  assert.ok(trackmania);
  assert.match(trackmania.platform_url, /app\/11020/);

  // Exactly one Warcraft entry: the tracked classic TFT install from the NAS.
  const warcraft = res.body.filter((g: { name: string }) => g.name.toLowerCase().startsWith('warcraft'));
  assert.equal(warcraft.length, 1);
  assert.equal(warcraft[0].name, 'Warcraft III');
  assert.equal(warcraft[0].platform, 'NAS');
  assert.match(warcraft[0].trailer_url, /Frozen%20Throne/);
});

test('GET /api/games merges a catalog title that collides with a tracked game onto the same row', async () => {
  // "Rocket League" is both one of seedGames()'s tracked defaults and one of
  // the seeded catalog titles — after the merge it must be exactly one row
  // with both the process name and the catalog platform/trailer info.
  const res = await request(app).get('/api/games');
  const rocketLeague = res.body.filter((g: { name: string }) => g.name === 'Rocket League');
  assert.equal(rocketLeague.length, 1);
  assert.ok(rocketLeague[0].processNames.includes('rocketleague.exe'));
  assert.ok(rocketLeague[0].platform);
});

test('POST /api/games rejects min team size greater than max', async () => {
  const res = await request(app)
    .post('/api/games')
    .send({ name: 'Testspiel', minTeamSize: 5, maxTeamSize: 2 });
  assert.equal(res.status, 400);
  assert.match(res.body.error, /Teamgröße/);
});

test('POST /api/games creates a game with defaults', async () => {
  const res = await request(app).post('/api/games').send({ name: 'Testspiel' });
  assert.equal(res.status, 201);
  assert.equal(res.body.icon, '🎮');
  assert.equal(res.body.min_team_size, 1);
  assert.equal(res.body.max_team_size, 5);
  assert.deepEqual(res.body.processNames, []);
  createdId = res.body.id;
});

test('POST /api/games rejects a duplicate name (case-insensitive), so votes/skills never split across two identical entries', async () => {
  const res = await request(app).post('/api/games').send({ name: 'counter-strike 2' });
  assert.equal(res.status, 409);
  assert.match(res.body.error, /gibt es schon/);
});

test("PATCH /api/games/:id rejects renaming onto another game's name", async () => {
  const res = await request(app).patch(`/api/games/${createdId}`).send({ name: 'Rocket League' });
  assert.equal(res.status, 409);
  assert.match(res.body.error, /gibt es schon/);
});

test('PATCH /api/games/:id still allows re-saving a game under its own name (e.g. icon-only edit)', async () => {
  const res = await request(app).patch(`/api/games/${createdId}`).send({ name: 'Testspiel' });
  assert.equal(res.status, 200);
  assert.equal(res.body.name, 'Testspiel');
});

test('PATCH /api/games/:id updates fields', async () => {
  const res = await request(app)
    .patch(`/api/games/${createdId}`)
    .send({ icon: '🧪', maxTeamSize: 4 });
  assert.equal(res.status, 200);
  assert.equal(res.body.icon, '🧪');
  assert.equal(res.body.max_team_size, 4);
});

test('PATCH /api/games/:id 404s for an unknown id', async () => {
  const res = await request(app).patch('/api/games/nope').send({ icon: '🧪' });
  assert.equal(res.status, 404);
});

const TINY_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

test('PATCH /api/games/:id accepts a custom iconImage (self-uploaded logo/artwork)', async () => {
  const res = await request(app).patch(`/api/games/${createdId}`).send({ iconImage: TINY_PNG });
  assert.equal(res.status, 200);
  assert.equal(res.body.icon_image, TINY_PNG);

  const list = await request(app).get('/api/games');
  const g = list.body.find((x: { id: string }) => x.id === createdId);
  assert.equal(g.icon_image, TINY_PNG);
});

test('PATCH /api/games/:id rejects a malformed iconImage', async () => {
  const res = await request(app).patch(`/api/games/${createdId}`).send({ iconImage: 'not-an-image' });
  assert.equal(res.status, 400);
});

test('PATCH /api/games/:id clears iconImage when explicitly set to null', async () => {
  const res = await request(app).patch(`/api/games/${createdId}`).send({ iconImage: null });
  assert.equal(res.status, 200);
  assert.equal(res.body.icon_image, null);
});

test('POST /api/games accepts an iconImage at creation', async () => {
  const res = await request(app).post('/api/games').send({ name: 'Mit Icon', iconImage: TINY_PNG });
  assert.equal(res.status, 201);
  assert.equal(res.body.icon_image, TINY_PNG);
});

test('POST /api/games/:id/processes adds a mapping', async () => {
  const res = await request(app)
    .post(`/api/games/${createdId}/processes`)
    .send({ processName: 'Testspiel.EXE' });
  assert.equal(res.status, 201);
  assert.equal(res.body.processName, 'testspiel.exe'); // lowercased
});

test('POST /api/games/:id/processes rejects a duplicate process name', async () => {
  const res = await request(app)
    .post(`/api/games/${createdId}/processes`)
    .send({ processName: 'cs2.exe' }); // already mapped to CS2 by the seed
  assert.equal(res.status, 409);
});

test('DELETE /api/games/:id/processes/:processName removes the mapping', async () => {
  const res = await request(app).delete(`/api/games/${createdId}/processes/testspiel.exe`);
  assert.equal(res.status, 204);
});

test('DELETE /api/games/:id removes the game', async () => {
  const res = await request(app).delete(`/api/games/${createdId}`);
  assert.equal(res.status, 204);

  const after = await request(app).get(`/api/games/${createdId}`);
  assert.equal(after.status, 404);
});

let suggesterId: string;
let suggestionId: string;

test('setup: a player to suggest games', async () => {
  const res = await request(app).post('/api/players').send({ name: 'Suggester Sam' });
  assert.equal(res.status, 201);
  suggesterId = res.body.id;
});

test('POST /api/games with status "suggestion" creates a player-submitted proposal', async () => {
  const res = await request(app).post('/api/games').send({
    name: 'LAN Test Racer',
    status: 'suggestion',
    platform: 'Steam',
    platformUrl: 'https://store.steampowered.com/search/?term=LAN%20Test%20Racer',
    trailerUrl: 'https://example.test/trailer',
    playerId: suggesterId,
  });
  assert.equal(res.status, 201);
  assert.equal(res.body.isSuggestion, true);
  assert.equal(res.body.status, 'suggestion');
  assert.equal(res.body.platform, 'Steam');
  assert.equal(res.body.created_by, suggesterId);
  suggestionId = res.body.id;
});

test('POST /api/games rejects a malformed trailer link', async () => {
  const res = await request(app).post('/api/games').send({ name: 'Bad Trailer Game', trailerUrl: 'ftp://example.test' });
  assert.equal(res.status, 400);
});

test('POST /api/games rejects an unknown playerId as suggester', async () => {
  const res = await request(app).post('/api/games').send({ name: 'Orphan Suggestion', status: 'suggestion', playerId: 'nope' });
  assert.equal(res.status, 404);
});

test('POST /api/games/:id/promote moves a suggestion into the catalog', async () => {
  const res = await request(app).post(`/api/games/${suggestionId}/promote`).send();
  assert.equal(res.status, 200);
  assert.equal(res.body.isSuggestion, false);
  assert.equal(res.body.status, 'catalog');

  const again = await request(app).post(`/api/games/${suggestionId}/promote`).send();
  assert.equal(again.status, 409);
});

test('POST /api/games/:id/promote 404s for an unknown id', async () => {
  const res = await request(app).post('/api/games/nope/promote').send();
  assert.equal(res.status, 404);
});
