// Unit tests for password hashing (accounts.ts). hasClaimedAdmin touches the
// real (in-memory, per DB_FILE=:memory:) database, everything else is pure.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nanoid } from 'nanoid';
import { hashPassword, verifyPassword, verifyPasswordConstantTime, isValidPassword, hasClaimedAdmin } from './accounts';
import { db } from './db';

test('hashPassword produces a self-describing, salted hash', () => {
  const a = hashPassword('correct horse battery staple');
  const b = hashPassword('correct horse battery staple');
  assert.match(a, /^scrypt\$\d+\$\d+\$\d+\$[0-9a-f]+\$[0-9a-f]+$/);
  assert.notEqual(a, b, 'same password should hash differently each time (random salt)');
});

test('verifyPassword accepts the right password and rejects a wrong one', () => {
  const stored = hashPassword('correct horse battery staple');
  assert.equal(verifyPassword('correct horse battery staple', stored), true);
  assert.equal(verifyPassword('wrong password', stored), false);
});

test('verifyPassword rejects a malformed stored hash instead of throwing', () => {
  assert.equal(verifyPassword('anything', 'not-a-real-hash'), false);
  assert.equal(verifyPassword('anything', ''), false);
});

test('verifyPasswordConstantTime rejects when stored is null (unclaimed account)', () => {
  assert.equal(verifyPasswordConstantTime('anything', null), false);
});

test('isValidPassword only rejects empty and over-long input', () => {
  assert.equal(isValidPassword(''), false);
  assert.equal(isValidPassword('a'), true);
  assert.equal(isValidPassword('short'), true);
  assert.equal(isValidPassword('a'.repeat(200)), true);
  assert.equal(isValidPassword('a'.repeat(201)), false);
  assert.equal(isValidPassword(12345678), false);
});

test('hasClaimedAdmin reflects real player rows', () => {
  assert.equal(hasClaimedAdmin(), false);

  const id = nanoid();
  db.prepare(
    "INSERT INTO players (id, name, api_key, is_admin, password_hash, created_at) VALUES (?, ?, ?, 1, ?, ?)"
  ).run(id, `Claimed Admin ${id}`, nanoid(24), hashPassword('whatever password'), Date.now());

  assert.equal(hasClaimedAdmin(), true);
});
