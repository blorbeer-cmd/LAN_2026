import { test, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { config } from './config';
import { db, DEFAULT_GROUP_ID, OUTSIDE_EVENTS_ID } from './db';
import { activeTrackingContexts, setEventTrackingConsent, setGroupTrackingConsent } from './trackingContexts';

const originalAuthMode = config.authMode;
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
  (config as { authMode: 'legacy' | 'required' }).authMode = 'required';
  db.exec(`
    DELETE FROM tracking_live_games;
    DELETE FROM tracking_live_contexts;
    DELETE FROM play_sessions;
    DELETE FROM event_tracking_consents;
    DELETE FROM group_tracking_consents;
    DELETE FROM event_participants;
    DELETE FROM events WHERE id != 'outside-events';
  `);
});

after(() => {
  (config as { authMode: 'legacy' | 'required' }).authMode = originalAuthMode;
});

test('group consent grant, revoke and re-grant are idempotent and revoke the live outside context', () => {
  const now = Date.now();
  const playerId = createPlayer(now);

  setGroupTrackingConsent(DEFAULT_GROUP_ID, playerId, true, now);
  setGroupTrackingConsent(DEFAULT_GROUP_ID, playerId, true, now);
  assert.deepEqual(activeTrackingContexts(playerId, now), [{ groupId: DEFAULT_GROUP_ID, eventId: null, weight: 1 }]);

  db.prepare(
    `INSERT INTO tracking_live_contexts
       (player_id, group_id, event_id, last_seen, activity_tracked)
     VALUES (?, ?, NULL, ?, 0)`,
  ).run(playerId, DEFAULT_GROUP_ID, now);
  const gameId = (db.prepare('SELECT id FROM games LIMIT 1').get() as { id: string }).id;
  const sessionId = ids('session');
  db.prepare(
    `INSERT INTO play_sessions
       (id, player_id, game_id, group_id, event_id, started_at, ended_at)
     VALUES (?, ?, ?, ?, ?, ?, NULL)`,
  ).run(sessionId, playerId, gameId, DEFAULT_GROUP_ID, OUTSIDE_EVENTS_ID, now);

  setGroupTrackingConsent(DEFAULT_GROUP_ID, playerId, false, now + 1);
  setGroupTrackingConsent(DEFAULT_GROUP_ID, playerId, false, now + 1);
  assert.deepEqual(activeTrackingContexts(playerId, now + 1), []);
  assert.equal(
    (
      db.prepare('SELECT COUNT(*) AS count FROM tracking_live_contexts WHERE player_id = ?').get(playerId) as {
        count: number;
      }
    ).count,
    0,
  );
  assert.equal(
    (db.prepare('SELECT ended_at FROM play_sessions WHERE id = ?').get(sessionId) as { ended_at: number }).ended_at,
    now + 1,
  );

  setGroupTrackingConsent(DEFAULT_GROUP_ID, playerId, true, now + 1);
  setGroupTrackingConsent(DEFAULT_GROUP_ID, playerId, true, now + 1);
  assert.equal(
    (
      db.prepare('SELECT COUNT(*) AS count FROM group_tracking_consents WHERE player_id = ?').get(playerId) as {
        count: number;
      }
    ).count,
    2,
  );
  assert.deepEqual(activeTrackingContexts(playerId, now + 1), [
    { groupId: DEFAULT_GROUP_ID, eventId: null, weight: 1 },
  ]);
});

test('accepted participant-private tracking depends on event consent, not group-room consent', () => {
  const now = Date.now();
  const playerId = createPlayer(now);
  const eventId = createTrackingEvent(playerId, now);

  assert.deepEqual(activeTrackingContexts(playerId, now), [], 'accepted without event consent stays untracked');
  setEventTrackingConsent(eventId, DEFAULT_GROUP_ID, playerId, true, now);
  assert.deepEqual(activeTrackingContexts(playerId, now), [{ groupId: DEFAULT_GROUP_ID, eventId, weight: 1 }]);
});

test('event consent never turns invited or declined rows into tracking contexts, including for owners', () => {
  const now = Date.now();
  for (const [status, role] of [
    ['invited', 'member'],
    ['declined', 'owner'],
  ] as const) {
    const playerId = createPlayer(now, role);
    const eventId = createTrackingEvent(playerId, now, status);
    setEventTrackingConsent(eventId, DEFAULT_GROUP_ID, playerId, true, now);
    assert.deepEqual(activeTrackingContexts(playerId, now), []);
  }
});

test('event consent lifecycle is idempotent and revokes only its overlapping live context', () => {
  const now = Date.now();
  const playerId = createPlayer(now);
  const eventIds = [createTrackingEvent(playerId, now), createTrackingEvent(playerId, now)];
  for (const eventId of eventIds) {
    setEventTrackingConsent(eventId, DEFAULT_GROUP_ID, playerId, true, now);
    setEventTrackingConsent(eventId, DEFAULT_GROUP_ID, playerId, true, now);
    db.prepare(
      `INSERT INTO tracking_live_contexts
         (player_id, group_id, event_id, last_seen, activity_tracked)
       VALUES (?, ?, ?, ?, 0)`,
    ).run(playerId, DEFAULT_GROUP_ID, eventId, now);
  }

  assert.deepEqual(
    new Set(activeTrackingContexts(playerId, now).map((context) => `${context.eventId}:${context.weight}`)),
    new Set(eventIds.map((eventId) => `${eventId}:0.5`)),
  );

  setEventTrackingConsent(eventIds[0], DEFAULT_GROUP_ID, playerId, false, now + 1);
  setEventTrackingConsent(eventIds[0], DEFAULT_GROUP_ID, playerId, false, now + 1);
  assert.deepEqual(activeTrackingContexts(playerId, now + 1), [
    { groupId: DEFAULT_GROUP_ID, eventId: eventIds[1], weight: 1 },
  ]);
  assert.deepEqual(
    (
      db
        .prepare('SELECT event_id FROM tracking_live_contexts WHERE player_id = ? ORDER BY event_id')
        .all(playerId) as Array<{
        event_id: string;
      }>
    ).map((row) => row.event_id),
    [eventIds[1]],
  );

  setEventTrackingConsent(eventIds[0], DEFAULT_GROUP_ID, playerId, true, now + 1);
  setEventTrackingConsent(eventIds[0], DEFAULT_GROUP_ID, playerId, true, now + 1);
  assert.equal(
    (
      db.prepare('SELECT COUNT(*) AS count FROM event_tracking_consents WHERE event_id = ?').get(eventIds[0]) as {
        count: number;
      }
    ).count,
    2,
  );
  assert.deepEqual(
    new Set(activeTrackingContexts(playerId, now + 1).map((context) => context.eventId)),
    new Set(eventIds),
  );
});

test('group and public event tracking retain the group-consent contract', () => {
  const now = Date.now();
  for (const visibility of ['group', 'public'] as const) {
    const playerId = createPlayer(now);
    const eventId = createTrackingEvent(playerId, now, 'invited', visibility);
    assert.deepEqual(activeTrackingContexts(playerId, now), []);
    setGroupTrackingConsent(DEFAULT_GROUP_ID, playerId, true, now);
    assert.deepEqual(activeTrackingContexts(playerId, now), [{ groupId: DEFAULT_GROUP_ID, eventId, weight: 1 }]);
    db.prepare('UPDATE events SET tracking_enabled = 0 WHERE id = ?').run(eventId);
  }
});

test('legacy accepted participants retain roster-based event compatibility without a consent row', () => {
  const now = Date.now();
  const playerId = createPlayer(now);
  const eventId = createTrackingEvent(playerId, now);
  (config as { authMode: 'legacy' | 'required' }).authMode = 'legacy';

  assert.deepEqual(activeTrackingContexts(playerId, now), [{ groupId: DEFAULT_GROUP_ID, eventId, weight: 1 }]);
});
