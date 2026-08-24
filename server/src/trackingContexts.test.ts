import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { BASE_EVENT_ID, db, DEFAULT_GROUP_ID, OUTSIDE_EVENTS_ID } from './db';
import { ensureAccountEventContext, setActiveEventForPlayer } from './eventContext';
import { activeTrackingContexts, setEventTrackingConsent, setGroupTrackingConsent } from './trackingContexts';

let seq = 0;

function ids(prefix: string): string {
  seq += 1;
  return `${prefix}-${seq}`;
}

function createPlayer(now: number, role = 'member'): string {
  const playerId = ids('player');
  db.prepare('INSERT INTO players (id, name, api_key, created_at) VALUES (?, ?, ?, ?)').run(
    playerId,
    playerId,
    ids('key'),
    now,
  );
  db.prepare(
    `INSERT INTO group_memberships
       (group_id, player_id, role, status, joined_at, outside_tracking_enabled)
     VALUES (?, ?, ?, 'active', ?, 0)`,
  ).run(DEFAULT_GROUP_ID, playerId, role, now);
  ensureAccountEventContext(playerId);
  return playerId;
}

function createTrackingEvent(
  playerId: string,
  now: number,
  status: 'invited' | 'accepted' | 'declined' = 'accepted',
  visibility: 'group' | 'participants' | 'public' = 'participants',
): string {
  const eventId = ids('event');
  db.prepare(
    `INSERT INTO events
       (id, name, starts_at, ends_at, tracking_enabled, group_id, status, visibility_scope)
     VALUES (?, ?, ?, ?, 1, ?, 'published', ?)`,
  ).run(eventId, eventId, now - 10, now + 10_000, DEFAULT_GROUP_ID, visibility);
  db.prepare('INSERT INTO event_participants (event_id, player_id, status) VALUES (?, ?, ?)').run(
    eventId,
    playerId,
    status,
  );
  return eventId;
}

beforeEach(() => {
  db.exec(`
    DELETE FROM tracking_live_games;
    DELETE FROM tracking_live_contexts;
    DELETE FROM play_sessions;
    DELETE FROM players WHERE id LIKE 'player-%';
    DELETE FROM event_tracking_consents;
    DELETE FROM group_tracking_consents;
    DELETE FROM event_participants WHERE event_id NOT IN ('outside-events', 'instance-base-event');
    DELETE FROM events WHERE id NOT IN ('outside-events', 'instance-base-event');
    UPDATE events SET tracking_enabled = 0 WHERE id = 'instance-base-event';
  `);
});

test('the selected base event requires event consent and revocation closes only that context', () => {
  const now = Date.now();
  const playerId = createPlayer(now);
  db.prepare('UPDATE events SET tracking_enabled = 1, starts_at = 0 WHERE id = ?').run(BASE_EVENT_ID);

  setGroupTrackingConsent(DEFAULT_GROUP_ID, playerId, true, now);
  assert.deepEqual(activeTrackingContexts(playerId, now), [], 'group consent never substitutes for event consent');
  setEventTrackingConsent(BASE_EVENT_ID, DEFAULT_GROUP_ID, playerId, true, now);
  assert.deepEqual(activeTrackingContexts(playerId, now), [
    { groupId: DEFAULT_GROUP_ID, eventId: BASE_EVENT_ID, weight: 1 },
  ]);

  db.prepare(
    `INSERT INTO tracking_live_contexts
       (player_id, group_id, event_id, last_seen, activity_tracked)
     VALUES (?, ?, ?, ?, 0)`,
  ).run(playerId, DEFAULT_GROUP_ID, BASE_EVENT_ID, now);
  const gameId = (db.prepare('SELECT id FROM games LIMIT 1').get() as { id: string }).id;
  const sessionId = ids('session');
  db.prepare(
    `INSERT INTO play_sessions
       (id, player_id, game_id, group_id, event_id, started_at, ended_at)
     VALUES (?, ?, ?, ?, ?, ?, NULL)`,
  ).run(sessionId, playerId, gameId, DEFAULT_GROUP_ID, BASE_EVENT_ID, now);

  setEventTrackingConsent(BASE_EVENT_ID, DEFAULT_GROUP_ID, playerId, false, now + 1);
  setEventTrackingConsent(BASE_EVENT_ID, DEFAULT_GROUP_ID, playerId, false, now + 1);
  assert.deepEqual(activeTrackingContexts(playerId, now + 1), []);
  assert.equal(
    (db.prepare('SELECT ended_at FROM play_sessions WHERE id = ?').get(sessionId) as { ended_at: number }).ended_at,
    now + 1,
  );
});

test('accepted participation and consent do not track until the event is selected', () => {
  const now = Date.now();
  const playerId = createPlayer(now);
  const eventId = createTrackingEvent(playerId, now);

  setEventTrackingConsent(eventId, DEFAULT_GROUP_ID, playerId, true, now);
  assert.deepEqual(activeTrackingContexts(playerId, now), []);
  assert.equal(setActiveEventForPlayer(playerId, eventId)?.id, eventId);
  assert.deepEqual(activeTrackingContexts(playerId, now), [{ groupId: DEFAULT_GROUP_ID, eventId, weight: 1 }]);
});

test('event consent never makes invited or declined rows selectable, including for owners', () => {
  const now = Date.now();
  for (const [status, role] of [
    ['invited', 'member'],
    ['declined', 'owner'],
  ] as const) {
    const playerId = createPlayer(now, role);
    const eventId = createTrackingEvent(playerId, now, status);
    setEventTrackingConsent(eventId, DEFAULT_GROUP_ID, playerId, true, now);
    assert.equal(setActiveEventForPlayer(playerId, eventId), undefined);
    assert.deepEqual(activeTrackingContexts(playerId, now), []);
  }
});

test('overlapping events track only the selected event and never split one report', () => {
  const now = Date.now();
  const playerId = createPlayer(now);
  const eventIds = [createTrackingEvent(playerId, now), createTrackingEvent(playerId, now)];
  for (const eventId of eventIds) setEventTrackingConsent(eventId, DEFAULT_GROUP_ID, playerId, true, now);

  setActiveEventForPlayer(playerId, eventIds[0]);
  assert.deepEqual(activeTrackingContexts(playerId, now), [
    { groupId: DEFAULT_GROUP_ID, eventId: eventIds[0], weight: 1 },
  ]);

  setActiveEventForPlayer(playerId, eventIds[1]);
  assert.deepEqual(activeTrackingContexts(playerId, now), [
    { groupId: DEFAULT_GROUP_ID, eventId: eventIds[1], weight: 1 },
  ]);

  setEventTrackingConsent(eventIds[0], DEFAULT_GROUP_ID, playerId, false, now + 1);
  assert.deepEqual(activeTrackingContexts(playerId, now + 1), [
    { groupId: DEFAULT_GROUP_ID, eventId: eventIds[1], weight: 1 },
  ]);
});

test('group and public visibility never bypass accepted participation', () => {
  const now = Date.now();
  for (const visibility of ['group', 'public'] as const) {
    const playerId = createPlayer(now);
    const eventId = createTrackingEvent(playerId, now, 'invited', visibility);
    setGroupTrackingConsent(DEFAULT_GROUP_ID, playerId, true, now);
    setEventTrackingConsent(eventId, DEFAULT_GROUP_ID, playerId, true, now);
    assert.equal(setActiveEventForPlayer(playerId, eventId), undefined);
    assert.deepEqual(activeTrackingContexts(playerId, now), []);
  }
});

test('accepted participants still require explicit event consent', () => {
  const now = Date.now();
  const playerId = createPlayer(now);
  const eventId = createTrackingEvent(playerId, now);
  setActiveEventForPlayer(playerId, eventId);
  assert.deepEqual(activeTrackingContexts(playerId, now), []);
});

test('the migration sentinel can never become an account context', () => {
  const now = Date.now();
  const playerId = createPlayer(now);
  assert.equal(setActiveEventForPlayer(playerId, OUTSIDE_EVENTS_ID), undefined);
});
