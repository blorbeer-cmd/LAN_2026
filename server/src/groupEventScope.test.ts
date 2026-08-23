// The shared workspace guard. Roughly thirty call sites delegate their event
// boundary to it, so it has to hold on its own rather than assume every
// caller pre-scoped the event id it is handed.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Request } from 'express';
import { nanoid } from 'nanoid';
import { BASE_EVENT_ID, db, DEFAULT_GROUP_ID } from './db';
import { ensureAccountEventContext } from './eventContext';
import { requestCanUseEventWorkspace } from './groupEventScope';

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

function createEvent(name: string, groupId: string = DEFAULT_GROUP_ID): string {
  const id = nanoid();
  const now = Date.now();
  db.prepare(
    `INSERT INTO events
       (id, name, starts_at, ends_at, tracking_enabled, group_id, status, visibility_scope)
     VALUES (?, ?, ?, ?, 0, ?, 'published', 'participants')`,
  ).run(id, `${name} ${id}`, now - 1_000, now + 60_000, groupId);
  return id;
}

function accept(eventId: string, playerId: string): void {
  db.prepare(
    `INSERT INTO event_participants (event_id, player_id, status)
     VALUES (?, ?, 'accepted')
     ON CONFLICT(event_id, player_id) DO UPDATE SET status = 'accepted'`,
  ).run(eventId, playerId);
}

function playerRequest(playerId: string, groupId: string = DEFAULT_GROUP_ID): Request {
  return { player: { id: playerId }, group: { id: groupId } } as unknown as Request;
}

function kioskRequest(eventId: string | null): Request {
  return { kioskScope: { eventId } } as unknown as Request;
}

test('an accepted participant may use their event workspace', () => {
  const player = createPlayer('Workspace Member');
  const eventId = createEvent('Workspace Event');
  accept(eventId, player);

  assert.equal(requestCanUseEventWorkspace(playerRequest(player), eventId), true);
});

test('a non-participant is refused even inside their own group', () => {
  const player = createPlayer('Workspace Outsider');
  const eventId = createEvent('Foreign Workspace');

  assert.equal(requestCanUseEventWorkspace(playerRequest(player), eventId), false);
});

test('an invited but not yet accepted participant may not use the workspace', () => {
  const player = createPlayer('Workspace Invitee');
  const eventId = createEvent('Invited Workspace');
  db.prepare("INSERT INTO event_participants (event_id, player_id, status) VALUES (?, ?, 'invited')").run(
    eventId,
    player,
  );

  assert.equal(requestCanUseEventWorkspace(playerRequest(player), eventId), false);
});

test('participation alone does not carry across the group boundary', () => {
  // The guard is shared by call sites that resolve their event id in very
  // different ways. If it only asked "is this account a participant?", a
  // single caller passing an unscoped id would hand out an event belonging to
  // another group — so the boundary is checked here, not left to the callers.
  const otherGroupId = nanoid();
  db.prepare('INSERT INTO groups (id, name, created_at) VALUES (?, ?, ?)').run(
    otherGroupId,
    `Foreign Group ${otherGroupId}`,
    Date.now(),
  );
  const player = createPlayer('Cross Group Member');
  const foreignEventId = createEvent('Cross Group Event', otherGroupId);
  accept(foreignEventId, player);

  assert.equal(
    requestCanUseEventWorkspace(playerRequest(player), foreignEventId),
    false,
    'an event of another group stays invisible even to an accepted participant',
  );
  assert.equal(
    requestCanUseEventWorkspace(playerRequest(player, otherGroupId), foreignEventId),
    true,
    'the very same event is usable once the request itself is scoped to that group',
  );
});

test('an unknown event id and a null scope are refused', () => {
  const player = createPlayer('Workspace Unknown');

  assert.equal(requestCanUseEventWorkspace(playerRequest(player), `unknown-${nanoid()}`), false);
  assert.equal(requestCanUseEventWorkspace(playerRequest(player), null), false);
});

test('a kiosk stays bound to exactly its token event', () => {
  const eventId = createEvent('Kiosk Workspace');

  assert.equal(requestCanUseEventWorkspace(kioskRequest(eventId), eventId), true);
  assert.equal(requestCanUseEventWorkspace(kioskRequest(eventId), BASE_EVENT_ID), false);
  assert.equal(requestCanUseEventWorkspace(kioskRequest(null), eventId), false);
});
