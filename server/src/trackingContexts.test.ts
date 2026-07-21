import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { db } from './db';
import { activeTrackingContexts, setEventTrackingConsent, setGroupTrackingConsent } from './trackingContexts';

let seq = 0;
function ids(prefix: string): string { seq += 1; return `${prefix}-${seq}`; }

beforeEach(() => {
  db.exec("DELETE FROM event_tracking_consents; DELETE FROM group_tracking_consents; DELETE FROM event_participants; DELETE FROM events WHERE id != 'outside-events'; DELETE FROM group_memberships WHERE group_id != 'default-group'; DELETE FROM groups WHERE id != 'default-group';");
});

test('group consent is historized and revocation removes the context immediately', () => {
  const now = Date.now();
  const player = ids('player');
  const group = ids('group');
  db.prepare('INSERT INTO players (id, name, api_key, created_at) VALUES (?, ?, ?, ?)').run(player, player, ids('key'), now);
  db.prepare('INSERT INTO groups (id, name, created_at) VALUES (?, ?, ?)').run(group, group, now);
  db.prepare(`INSERT INTO group_memberships (group_id, player_id, role, status, joined_at, outside_tracking_enabled) VALUES (?, ?, 'member', 'active', ?, 0)`).run(group, player, now);
  setGroupTrackingConsent(group, player, true, now);
  assert.deepEqual(activeTrackingContexts(player, now).map((c) => c.groupId), [group]);
  setGroupTrackingConsent(group, player, false, now + 1);
  assert.equal(activeTrackingContexts(player, now + 1).length, 0);
  assert.equal((db.prepare('SELECT COUNT(*) AS count FROM group_tracking_consents WHERE group_id = ?').get(group) as { count: number }).count, 1);
});

test('two accepted overlapping events fan out deterministically with equal weights', () => {
  const now = Date.now();
  const player = ids('player');
  const group = ids('group');
  db.prepare('INSERT INTO players (id, name, api_key, created_at) VALUES (?, ?, ?, ?)').run(player, player, ids('key'), now);
  db.prepare('INSERT INTO groups (id, name, created_at) VALUES (?, ?, ?)').run(group, group, now);
  db.prepare(`INSERT INTO group_memberships (group_id, player_id, role, status, joined_at, outside_tracking_enabled) VALUES (?, ?, 'member', 'active', ?, 0)`).run(group, player, now);
  setGroupTrackingConsent(group, player, true, now);
  const eventIds = [ids('event-a'), ids('event-b')];
  for (const eventId of eventIds) {
    db.prepare(`INSERT INTO events (id, name, starts_at, ends_at, tracking_enabled, group_id, status, visibility_scope) VALUES (?, ?, ?, ?, 1, ?, 'published', 'participants')`).run(eventId, eventId, now - 10, now + 10_000, group);
    db.prepare("INSERT INTO event_participants (event_id, player_id, status) VALUES (?, ?, 'accepted')").run(eventId, player);
    setEventTrackingConsent(eventId, group, player, true, now);
  }
  const contexts = activeTrackingContexts(player, now);
  assert.deepEqual(contexts.map((c) => c.eventId), eventIds);
  assert.deepEqual(contexts.map((c) => c.weight), [0.5, 0.5]);
});

test('event consent never turns invited or declined rows into tracking contexts', () => {
  const now = Date.now();
  const player = ids('player');
  const group = ids('group');
  db.prepare('INSERT INTO players (id, name, api_key, created_at) VALUES (?, ?, ?, ?)').run(player, player, ids('key'), now);
  db.prepare('INSERT INTO groups (id, name, created_at) VALUES (?, ?, ?)').run(group, group, now);
  db.prepare(`INSERT INTO group_memberships (group_id, player_id, role, status, joined_at, outside_tracking_enabled) VALUES (?, ?, 'member', 'active', ?, 0)`).run(group, player, now);
  setGroupTrackingConsent(group, player, true, now);

  for (const status of ['invited', 'declined']) {
    const eventId = ids(`event-${status}`);
    db.prepare(`INSERT INTO events (id, name, starts_at, ends_at, tracking_enabled, group_id, status, visibility_scope) VALUES (?, ?, ?, ?, 1, ?, 'published', 'participants')`).run(eventId, eventId, now - 10, now + 10_000, group);
    db.prepare('INSERT INTO event_participants (event_id, player_id, status) VALUES (?, ?, ?)').run(eventId, player, status);
    setEventTrackingConsent(eventId, group, player, true, now);
  }

  assert.deepEqual(activeTrackingContexts(player, now), []);
});
