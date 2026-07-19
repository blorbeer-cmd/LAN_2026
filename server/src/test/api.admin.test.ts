// Admin base: role toggling and test-user administration in legacy mode.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../app';

const app = createApp();

test('PATCH /api/players/:id toggles is_admin and validates the type', async () => {
  const created = await request(app).post('/api/players').send({ name: 'AdminTest' });
  assert.equal(created.status, 201);
  assert.equal(created.body.is_admin, 0);
  const id = created.body.id;

  const bad = await request(app).patch(`/api/players/${id}`).send({ isAdmin: 'yes' });
  assert.equal(bad.status, 400);

  const grant = await request(app).patch(`/api/players/${id}`).send({ isAdmin: true });
  assert.equal(grant.status, 200);
  assert.equal(grant.body.is_admin, 1);

  const single = await request(app).get(`/api/players/${id}`);
  assert.equal(single.body.is_admin, 1);

  const second = await request(app).post('/api/players').send({ name: 'SecondAdminTest' });
  assert.equal((await request(app).patch(`/api/players/${second.body.id}`).send({ isAdmin: true })).status, 200);

  const revoke = await request(app).patch(`/api/players/${id}`).send({ isAdmin: false });
  assert.equal(revoke.status, 200);
  assert.equal(revoke.body.is_admin, 0);
});
