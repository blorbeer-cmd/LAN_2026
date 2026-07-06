// Integration tests for the app-level endpoints and the access gate, driven
// through real HTTP with supertest. Runs against an in-memory DB (DB_FILE set
// by the test script) so it never touches real data.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../app';

const app = createApp();

test('GET /api/meta reports access protection state', async () => {
  const res = await request(app).get('/api/meta');
  assert.equal(res.status, 200);
  assert.equal(typeof res.body.accessProtection, 'boolean');
});

test('GET /api/health returns ok with a timestamp', async () => {
  const res = await request(app).get('/api/health');
  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
  assert.equal(typeof res.body.time, 'number');
});

test('unknown API route falls through to 404', async () => {
  const res = await request(app).get('/api/does-not-exist');
  assert.equal(res.status, 404);
});
