import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createTestApp } from './testApp';

const app = createTestApp();

test('GET /api/backup clearly rejects the in-memory test database', async () => {
  const res = await request(app).get('/api/backup');
  assert.equal(res.status, 409);
  assert.match(res.body.error, /In-Memory/);
});
