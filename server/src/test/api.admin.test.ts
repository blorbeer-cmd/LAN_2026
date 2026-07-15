// Admin base: unlock endpoint, admin-flag toggling via the players PATCH, and
// the pure gate logic in both open mode (no PIN) and PIN mode.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../app';
import { adminUnlockValid, createAdminGuard } from '../auth';

const app = createApp();

// ---- pure gate logic (independent of the process-wide ADMIN_PIN env) ----

test('adminUnlockValid: open mode (empty expected) always passes', () => {
  assert.equal(adminUnlockValid(undefined, ''), true);
  assert.equal(adminUnlockValid('anything', ''), true);
});

test('adminUnlockValid: PIN mode requires an exact match', () => {
  assert.equal(adminUnlockValid('1234', '1234'), true);
  assert.equal(adminUnlockValid('0000', '1234'), false);
  assert.equal(adminUnlockValid(undefined, '1234'), false);
  assert.equal(adminUnlockValid(42, '1234'), false);
});

test('createAdminGuard: PIN mode rejects a missing/wrong header, open mode lets through', () => {
  const guarded = createAdminGuard('1234');
  const open = createAdminGuard('');
  const mkRes = () => {
    const r: { code?: number; body?: unknown; status: (n: number) => typeof r; json: (b: unknown) => typeof r } = {
      status(n) {
        r.code = n;
        return r;
      },
      json(b) {
        r.body = b;
        return r;
      },
    };
    return r;
  };

  let nexted = false;
  guarded({ header: () => undefined } as never, mkRes() as never, () => {
    nexted = true;
  });
  assert.equal(nexted, false); // rejected

  nexted = false;
  guarded({ header: (h: string) => (h === 'x-admin-pin' ? '1234' : undefined) } as never, mkRes() as never, () => {
    nexted = true;
  });
  assert.equal(nexted, true); // accepted with correct header

  nexted = false;
  open({ header: () => undefined } as never, mkRes() as never, () => {
    nexted = true;
  });
  assert.equal(nexted, true); // open mode always passes
});

// ---- HTTP endpoints (test env has no ADMIN_PIN → open mode) ----

test('GET /api/admin/status reports no PIN required in open mode', async () => {
  const res = await request(app).get('/api/admin/status');
  assert.equal(res.status, 200);
  assert.equal(res.body.pinRequired, false);
});

test('POST /api/admin/unlock succeeds in open mode', async () => {
  const res = await request(app).post('/api/admin/unlock').send({ pin: '' });
  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
});

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
