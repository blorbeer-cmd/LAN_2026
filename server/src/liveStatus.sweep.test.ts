// Tests the offline-sweeper's stale-session cleanup against the real
// in-memory DB (not just deriveState in isolation): if an agent goes silent
// past the timeout, its lingering live_status_games row and open
// play_sessions row must both be closed, not left accumulating forever.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nanoid } from 'nanoid';
import { BASE_EVENT_ID, db, DEFAULT_GROUP_ID } from './db';
import { config } from './config';
import { closeStaleSessions } from './liveStatus';

test('a stale live_status_games row is removed and its session closed at last_seen', () => {
  const playerId = nanoid();
  const gameId = nanoid();
  db.prepare('INSERT INTO players (id, name, color, api_key, created_at) VALUES (?, ?, ?, ?, ?)').run(
    playerId,
    'Sweep Test Player',
    '#123456',
    nanoid(),
    Date.now()
  );
  db.prepare(
    'INSERT INTO games (id, name, icon, min_team_size, max_team_size, created_at) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(gameId, 'Sweep Test Game', '🎮', 1, 5, Date.now());

  const longAgo = Date.now() - config.offlineTimeoutMs * 5;
  db.prepare(
    'INSERT INTO tracking_live_contexts (player_id, group_id, event_id, last_seen, manual_note, activity_tracked) VALUES (?, ?, ?, ?, NULL, 0)',
  ).run(playerId, DEFAULT_GROUP_ID, BASE_EVENT_ID, longAgo);
  db.prepare(
    'INSERT INTO tracking_live_games (player_id, group_id, event_id, game_id, since, is_foreground) VALUES (?, ?, ?, ?, ?, 0)',
  ).run(playerId, DEFAULT_GROUP_ID, BASE_EVENT_ID, gameId, longAgo);
  const sessionId = nanoid();
  db.prepare(
    'INSERT INTO play_sessions (id, player_id, game_id, group_id, event_id, started_at, ended_at) VALUES (?, ?, ?, ?, ?, ?, NULL)'
  ).run(sessionId, playerId, gameId, DEFAULT_GROUP_ID, BASE_EVENT_ID, longAgo);

  closeStaleSessions(Date.now());

  const remaining = db
    .prepare('SELECT 1 FROM tracking_live_games WHERE player_id = ? AND game_id = ?')
    .get(playerId, gameId);
  assert.equal(remaining, undefined, 'stale live_status_games row should be removed');

  const session = db.prepare('SELECT ended_at FROM play_sessions WHERE id = ?').get(sessionId) as {
    ended_at: number | null;
  };
  assert.equal(session.ended_at, longAgo, 'session should be closed at last_seen, not now');
});

test('a fresh live_status_games row is left untouched', () => {
  const playerId = nanoid();
  const gameId = nanoid();
  db.prepare('INSERT INTO players (id, name, color, api_key, created_at) VALUES (?, ?, ?, ?, ?)').run(
    playerId,
    'Fresh Player',
    '#654321',
    nanoid(),
    Date.now()
  );
  db.prepare(
    'INSERT INTO games (id, name, icon, min_team_size, max_team_size, created_at) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(gameId, 'Fresh Game', '🎮', 1, 5, Date.now());

  const now = Date.now();
  db.prepare(
    'INSERT INTO tracking_live_contexts (player_id, group_id, event_id, last_seen, manual_note, activity_tracked) VALUES (?, ?, ?, ?, NULL, 0)',
  ).run(playerId, DEFAULT_GROUP_ID, BASE_EVENT_ID, now);
  db.prepare(
    'INSERT INTO tracking_live_games (player_id, group_id, event_id, game_id, since, is_foreground) VALUES (?, ?, ?, ?, ?, 0)',
  ).run(playerId, DEFAULT_GROUP_ID, BASE_EVENT_ID, gameId, now);

  closeStaleSessions(now + 1000);

  const remaining = db
    .prepare('SELECT 1 FROM tracking_live_games WHERE player_id = ? AND game_id = ?')
    .get(playerId, gameId);
  assert.ok(remaining, 'fresh row must not be swept');
});
