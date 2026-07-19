import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nanoid } from 'nanoid';
import { db, DEFAULT_GROUP_ID } from '../db';
import { issueKioskToken, resolveKioskToken, revokeKioskToken } from '../kioskTokens';

test('kiosk tokens resolve to their group, do not expose the secret, and revoke immediately', () => {
  const playerId = nanoid();
  db.prepare('INSERT INTO players (id, name, api_key, created_at) VALUES (?, ?, ?, ?)').run(playerId, 'Kiosk Token Test', nanoid(), Date.now());
  const issued = issueKioskToken(DEFAULT_GROUP_ID, null, playerId, 'Testschirm');
  assert.equal(issued.scope.groupId, DEFAULT_GROUP_ID);
  assert.equal(resolveKioskToken(issued.token)?.groupId, DEFAULT_GROUP_ID);
  assert.equal(resolveKioskToken('wrong-token'), null);
  assert.equal(revokeKioskToken(DEFAULT_GROUP_ID, issued.scope.id), true);
  assert.equal(resolveKioskToken(issued.token), null);
  db.prepare('DELETE FROM players WHERE id = ?').run(playerId);
});
