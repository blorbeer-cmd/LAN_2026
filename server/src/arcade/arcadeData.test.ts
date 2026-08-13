// Scope resolution for arcade results. The scope decides which group and
// event a finished match is booked into, so a player who is no longer an
// active member must not be able to widen or validate it.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nanoid } from 'nanoid';
import { db, DEFAULT_GROUP_ID } from '../db';
import { ensureAccountEventContext, setActiveEventForPlayer } from '../eventContext';
import { currentArcadeDataScope } from './arcadeData';

function createPlayer(name: string): string {
  const id = nanoid();
  const now = Date.now();
  db.prepare('INSERT INTO players (id, name, api_key, created_at) VALUES (?, ?, ?, ?)').run(
    id,
    `${name} ${id}`,
    nanoid(24),
    now,
  );
  db.prepare(
    `INSERT INTO group_memberships
       (group_id, player_id, role, status, joined_at, outside_tracking_enabled)
     VALUES (?, ?, 'member', 'active', ?, 0)`,
  ).run(DEFAULT_GROUP_ID, id, now);
  ensureAccountEventContext(id);
  return id;
}

function createEvent(name: string): string {
  const id = nanoid();
  const now = Date.now();
  db.prepare(
    `INSERT INTO events
       (id, name, starts_at, ends_at, tracking_enabled, group_id, status, visibility_scope)
     VALUES (?, ?, ?, ?, 0, ?, 'published', 'participants')`,
  ).run(id, `${name} ${id}`, now - 1_000, now + 60_000, DEFAULT_GROUP_ID);
  return id;
}

function join(eventId: string, playerId: string): void {
  db.prepare(
    `INSERT INTO event_participants (event_id, player_id, status)
     VALUES (?, ?, 'accepted')
     ON CONFLICT(event_id, player_id) DO UPDATE SET status = 'accepted'`,
  ).run(eventId, playerId);
  assert.ok(setActiveEventForPlayer(playerId, eventId));
}

test('a shared active event resolves to exactly that scope', () => {
  const eventId = createEvent('Arcade Scope');
  const alice = createPlayer('Scope Alice');
  const bob = createPlayer('Scope Bob');
  join(eventId, alice);
  join(eventId, bob);

  assert.deepEqual(currentArcadeDataScope([alice, bob]), { groupId: DEFAULT_GROUP_ID, eventId });
});

test('players sitting in different active events resolve to no scope', () => {
  const eventA = createEvent('Arcade Scope A');
  const eventB = createEvent('Arcade Scope B');
  const alice = createPlayer('Split Alice');
  const bob = createPlayer('Split Bob');
  join(eventA, alice);
  join(eventB, bob);

  assert.equal(currentArcadeDataScope([alice, bob]), null);
});

test('a deactivated account cannot ride along on a stale accepted participation row', () => {
  const eventId = createEvent('Arcade Stale');
  const active = createPlayer('Stale Active');
  const removed = createPlayer('Stale Removed');
  join(eventId, active);
  join(eventId, removed);

  // Deactivation intentionally leaves event_participants untouched (the
  // history of who took part stays true). The scope resolution must therefore
  // re-check the account itself: without that, the deactivated player simply
  // contributes no context row while still being counted as a participant,
  // and the match would be booked as if they were a regular member.
  db.prepare('UPDATE players SET deactivated_at = ? WHERE id = ?').run(Date.now(), removed);
  assert.ok(
    db.prepare('SELECT 1 FROM event_participants WHERE event_id = ? AND player_id = ?').get(eventId, removed),
    'the stale accepted row is exactly the precondition under test',
  );

  assert.equal(currentArcadeDataScope([active, removed]), null);
  assert.deepEqual(
    currentArcadeDataScope([active]),
    { groupId: DEFAULT_GROUP_ID, eventId },
    'the remaining active player still resolves on their own',
  );
});

test('an account whose membership ended cannot validate the scope either', () => {
  const eventId = createEvent('Arcade Left');
  const active = createPlayer('Left Active');
  const left = createPlayer('Left Member');
  join(eventId, active);
  join(eventId, left);

  db.prepare('UPDATE group_memberships SET status = ? WHERE group_id = ? AND player_id = ?').run(
    'removed',
    DEFAULT_GROUP_ID,
    left,
  );

  assert.equal(currentArcadeDataScope([active, left]), null);
});

test('an empty or unknown player list never resolves a scope', () => {
  assert.equal(currentArcadeDataScope([]), null);
  assert.equal(currentArcadeDataScope([`unknown-${nanoid()}`]), null);
});
