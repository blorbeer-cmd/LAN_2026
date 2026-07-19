// Integration tests for the Info-Board: CRUD lifecycle + validation.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../app';

const app = createApp();
let entryId: string;

test('GET /api/info starts empty', async () => {
  const res = await request(app).get('/api/info');
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.entries, []);
});

test('POST /api/info validates title and content', async () => {
  const noTitle = await request(app).post('/api/info').send({ content: 'x' });
  assert.equal(noTitle.status, 400);
  const noContent = await request(app).post('/api/info').send({ title: 'WLAN' });
  assert.equal(noContent.status, 400);
  const longTitle = await request(app).post('/api/info').send({ title: 'x'.repeat(81), content: 'y' });
  assert.equal(longTitle.status, 400);
});

test('POST /api/info creates an entry', async () => {
  const res = await request(app)
    .post('/api/info')
    .send({ title: 'WLAN', content: 'Netz: Respawn\nPasswort: kartoffel' });
  assert.equal(res.status, 201);
  assert.equal(res.body.title, 'WLAN');
  entryId = res.body.id;

  const list = await request(app).get('/api/info');
  assert.equal(list.body.entries.length, 1);
});

test('PATCH /api/info/:id updates fields and bumps updated_at', async () => {
  const res = await request(app).patch(`/api/info/${entryId}`).send({ content: 'Netz: Respawn\nPasswort: gurke' });
  assert.equal(res.status, 200);
  assert.equal(res.body.title, 'WLAN');
  assert.match(res.body.content, /gurke/);

  const missing = await request(app).patch('/api/info/nope').send({ title: 'x' });
  assert.equal(missing.status, 404);
});

test('DELETE /api/info/:id removes the entry', async () => {
  const res = await request(app).delete(`/api/info/${entryId}`);
  assert.equal(res.status, 204);
  const again = await request(app).delete(`/api/info/${entryId}`);
  assert.equal(again.status, 404);

  const list = await request(app).get('/api/info');
  assert.deepEqual(list.body.entries, []);
});
