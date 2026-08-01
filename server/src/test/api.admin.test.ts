// Admin base: instance roles are managed only through group memberships.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createTestApp } from './testApp';

const app = createTestApp();

test('PATCH /api/players/:id rejects the retired direct is_admin toggle', async () => {
  const created = await request(app).post('/api/players').send({ name: 'AdminTest' });
  assert.equal(created.status, 201);
  assert.equal(created.body.is_admin, 0);
  const id = created.body.id;

  const bad = await request(app).patch(`/api/players/${id}`).send({ isAdmin: 'yes' });
  assert.equal(bad.status, 400);

  const grant = await request(app).patch(`/api/players/${id}`).send({ isAdmin: true });
  assert.equal(grant.status, 400);

  const revoke = await request(app).patch(`/api/players/${id}`).send({ isAdmin: false });
  assert.equal(revoke.status, 400);
});
