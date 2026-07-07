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
