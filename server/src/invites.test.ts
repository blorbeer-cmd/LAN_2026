// Unit tests for invite code lifecycle (create/find/consume/revoke/void).
// Uses the real (in-memory) DB for the FK-backed rows.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nanoid } from 'nanoid';
import { db } from './db';
import { createInvite, findValidInvite, markInviteUsed, revokeInvite, voidOutstandingInvites } from './invites';

function makePlayer(): string {
  const id = nanoid();
  db.prepare('INSERT INTO players (id, name, api_key, created_at) VALUES (?, ?, ?, ?)').run(
    id,
    `Invite Test ${id}`,
    nanoid(24),
    Date.now()
  );
  return id;
}

test('createInvite + findValidInvite round-trip for a register code', () => {
  const admin = makePlayer();
  const invite = createInvite({ purpose: 'register', createdBy: admin });
  const found = findValidInvite(invite.code, 'register');
  assert.ok(found);
  assert.equal(found!.code, invite.code);
});

test('findValidInvite rejects a purpose mismatch', () => {
  const admin = makePlayer();
  const invite = createInvite({ purpose: 'register', createdBy: admin });
  assert.equal(findValidInvite(invite.code, 'claim'), undefined);
});

test('findValidInvite rejects an unknown code', () => {
  assert.equal(findValidInvite('does-not-exist', 'register'), undefined);
});

test('markInviteUsed prevents the code from being consumed again', () => {
  const admin = makePlayer();
  const target = makePlayer();
  const invite = createInvite({ purpose: 'claim', playerId: target, createdBy: admin });
  markInviteUsed(invite.code, target);
  assert.equal(findValidInvite(invite.code, 'claim'), undefined);
});

test('revokeInvite invalidates an unused code and is idempotent', () => {
  const admin = makePlayer();
  const invite = createInvite({ purpose: 'register', createdBy: admin });
  assert.equal(revokeInvite(invite.code), true);
  assert.equal(findValidInvite(invite.code, 'register'), undefined);
  assert.equal(revokeInvite(invite.code), false, 'revoking again should be a no-op, not an error');
});

test('revokeInvite refuses to revoke an already-used code', () => {
  const admin = makePlayer();
  const target = makePlayer();
  const invite = createInvite({ purpose: 'claim', playerId: target, createdBy: admin });
  markInviteUsed(invite.code, target);
  assert.equal(revokeInvite(invite.code), false);
});

test('a code past its expiry is no longer valid', () => {
  const admin = makePlayer();
  const invite = createInvite({ purpose: 'register', createdBy: admin, expiresInMs: 1000 });
  db.prepare('UPDATE invites SET expires_at = ? WHERE code = ?').run(Date.now() - 1, invite.code);
  assert.equal(findValidInvite(invite.code, 'register'), undefined);
});

test('voidOutstandingInvites revokes every open code of that purpose for the player, and no others', () => {
  const admin = makePlayer();
  const target = makePlayer();
  const claimA = createInvite({ purpose: 'claim', playerId: target, createdBy: admin });
  const claimB = createInvite({ purpose: 'claim', playerId: target, createdBy: admin });
  const resetCode = createInvite({ purpose: 'reset', playerId: target, createdBy: admin });

  voidOutstandingInvites(target, 'claim');

  assert.equal(findValidInvite(claimA.code, 'claim'), undefined);
  assert.equal(findValidInvite(claimB.code, 'claim'), undefined);
  assert.ok(findValidInvite(resetCode.code, 'reset'), 'a different purpose should be untouched');
});
