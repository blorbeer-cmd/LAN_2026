// Tests for env-driven admin seeding (bootstrapAdmins.ts). Touches the real
// in-memory database (DB_FILE=:memory:); each case uses a distinct name so the
// shared per-file database does not leak state between assertions.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nanoid } from 'nanoid';
import { parseBootstrapAdmins, runBootstrapAdmins } from './bootstrapAdmins';
import { hashPassword, verifyPassword } from './accounts';
import { db } from './db';

function env(overrides: Record<string, string>): NodeJS.ProcessEnv {
  return overrides as NodeJS.ProcessEnv;
}

function playerByName(name: string) {
  return db
    .prepare('SELECT id, is_admin, is_test, password_hash, deactivated_at FROM players WHERE name = ? COLLATE NOCASE')
    .get(name) as
    | { id: string; is_admin: number; is_test: number; password_hash: string | null; deactivated_at: number | null }
    | undefined;
}

function hasActiveDefaultMembership(playerId: string): boolean {
  const row = db
    .prepare("SELECT 1 FROM group_memberships WHERE player_id = ? AND status = 'active'")
    .get(playerId);
  return Boolean(row);
}

test('parseBootstrapAdmins reads configured slots and ignores empty ones', () => {
  const entries = parseBootstrapAdmins(
    env({
      BOOTSTRAP_ADMIN_1_NAME: 'Alice',
      BOOTSTRAP_ADMIN_1_PASSWORD: 'a',
      BOOTSTRAP_ADMIN_3_NAME: 'Carol',
    }),
  );
  assert.equal(entries.length, 2);
  assert.deepEqual(
    entries.map((e) => e.slot),
    [1, 3],
  );
  assert.equal(entries[0].name, 'Alice');
  assert.equal(entries[1].password, undefined);
});

test('runBootstrapAdmins creates a ready-to-use admin with password and membership', () => {
  const name = `Boot Create ${nanoid(6)}`;
  const results = runBootstrapAdmins(
    env({ BOOTSTRAP_ADMIN_1_NAME: name, BOOTSTRAP_ADMIN_1_PASSWORD: 'a-fresh-password' }),
  );
  assert.deepEqual(
    results.map((r) => r.action),
    ['created'],
  );
  const player = playerByName(name);
  assert.ok(player);
  assert.equal(player!.is_admin, 1);
  assert.equal(player!.is_test, 0);
  assert.ok(player!.password_hash);
  assert.equal(verifyPassword('a-fresh-password', player!.password_hash!), true);
  assert.equal(hasActiveDefaultMembership(player!.id), true);
});

test('runBootstrapAdmins is idempotent and never overwrites an existing password', () => {
  const name = `Boot Idempotent ${nanoid(6)}`;
  runBootstrapAdmins(env({ BOOTSTRAP_ADMIN_1_NAME: name, BOOTSTRAP_ADMIN_1_PASSWORD: 'original-password' }));

  // Simulate the person changing their own password afterwards.
  const player = playerByName(name)!;
  const selfChosen = hashPassword('self-chosen-later');
  db.prepare('UPDATE players SET password_hash = ? WHERE id = ?').run(selfChosen, player.id);

  const results = runBootstrapAdmins(
    env({ BOOTSTRAP_ADMIN_1_NAME: name, BOOTSTRAP_ADMIN_1_PASSWORD: 'original-password' }),
  );
  assert.deepEqual(
    results.map((r) => r.action),
    ['skipped-exists'],
  );
  const after = playerByName(name)!;
  assert.equal(after.password_hash, selfChosen, 'a self-changed password must survive re-runs');
});

test('runBootstrapAdmins claims an existing unclaimed profile and promotes it to admin', () => {
  const name = `Boot Claim ${nanoid(6)}`;
  const id = nanoid();
  db.prepare(
    'INSERT INTO players (id, name, api_key, is_admin, is_test, created_at) VALUES (?, ?, ?, 0, 0, ?)',
  ).run(id, name, nanoid(24), Date.now());

  const results = runBootstrapAdmins(env({ BOOTSTRAP_ADMIN_1_NAME: name, BOOTSTRAP_ADMIN_1_PASSWORD: 'claim-password' }));
  assert.deepEqual(
    results.map((r) => r.action),
    ['claimed'],
  );
  const player = playerByName(name)!;
  assert.equal(player.is_admin, 1);
  assert.equal(verifyPassword('claim-password', player.password_hash!), true);
  assert.equal(hasActiveDefaultMembership(player.id), true);
});

test('runBootstrapAdmins skips an empty password', () => {
  const name = `Boot Empty ${nanoid(6)}`;
  const results = runBootstrapAdmins(env({ BOOTSTRAP_ADMIN_1_NAME: name, BOOTSTRAP_ADMIN_1_PASSWORD: '' }));
  assert.deepEqual(
    results.map((r) => r.action),
    ['skipped-invalid-password'],
  );
  assert.equal(playerByName(name), undefined);
});

test('runBootstrapAdmins refuses to turn a test player into an admin', () => {
  const name = `Boot Test ${nanoid(6)}`;
  const id = nanoid();
  db.prepare(
    'INSERT INTO players (id, name, api_key, is_admin, is_test, created_at) VALUES (?, ?, ?, 0, 1, ?)',
  ).run(id, name, nanoid(24), Date.now());

  const results = runBootstrapAdmins(env({ BOOTSTRAP_ADMIN_1_NAME: name, BOOTSTRAP_ADMIN_1_PASSWORD: 'a-valid-password' }));
  assert.deepEqual(
    results.map((r) => r.action),
    ['skipped-test'],
  );
  const player = playerByName(name)!;
  assert.equal(player.is_admin, 0);
  assert.equal(player.password_hash, null);
});
