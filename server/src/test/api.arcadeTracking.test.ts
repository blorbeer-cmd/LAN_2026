// Arcade matches must show up exactly like agent-tracked PC games (FR-29):
// "who's playing" on the Home live board, and playtime in /api/stats/playtime
// — both driven by the same live_status_games/play_sessions tables the agent
// writes to, via arcadeTracking.ts's startArcadeSession/endArcadeSession.
// Socket-driven match start/end itself is exercised by the Arcade e2e flows;
// this covers the tracking side effects directly.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createTestApp } from './testApp';
import { BASE_EVENT_ID, db, DEFAULT_GROUP_ID } from '../db';
import { getLiveBoard } from '../liveStatus';
import {
  startArcadeSession,
  endArcadeSession,
  recoverInterruptedArcadeSessions,
} from '../arcade/arcadeTracking';

const app = createTestApp();

async function makePlayer(name: string): Promise<string> {
  const res = await request(app).post('/api/players').send({ name });
  assert.equal(res.status, 201);
  return res.body.id;
}

test('GET /api/games excludes the built-in Arcade titles', async () => {
  const res = await request(app).get('/api/games');
  assert.equal(res.status, 200);
  const names = (res.body as Array<{ name: string }>).map((g) => g.name);
  for (const arcadeName of ['Gaming-Quiz', 'Tetris', 'Scribble', 'Blobby Volley', 'Snake']) {
    assert.ok(!names.includes(arcadeName), `${arcadeName} should not appear in the catalog`);
  }
});

test('DELETE /api/games/:id refuses to delete an Arcade title', async () => {
  const quizGameId = (db.prepare('SELECT id FROM games WHERE arcade_key = ?').get('quiz') as { id: string }).id;
  const res = await request(app).delete(`/api/games/${quizGameId}`);
  assert.equal(res.status, 400);
  assert.ok(db.prepare('SELECT id FROM games WHERE id = ?').get(quizGameId), 'game must still exist');
});

test('starting an Arcade session marks players "playing" on the live board and opens a play session', async () => {
  const alice = await makePlayer('Arcade Tracking Alice');
  const bob = await makePlayer('Arcade Tracking Bob');
  const quizGameId = (db.prepare('SELECT id FROM games WHERE arcade_key = ?').get('quiz') as { id: string }).id;

  startArcadeSession([alice, bob], 'quiz');

  const board = getLiveBoard(DEFAULT_GROUP_ID, BASE_EVENT_ID);
  for (const id of [alice, bob]) {
    const entry = board.find((p) => p.player_id === id);
    assert.ok(entry, 'player must appear on the live board');
    assert.equal(entry!.state, 'playing');
    assert.ok(entry!.games.some((g) => g.game_id === quizGameId && g.game_name === 'Gaming-Quiz'));
  }

  const openSessions = db
    .prepare('SELECT ended_at FROM play_sessions WHERE player_id = ? AND game_id = ?')
    .all(alice, quizGameId) as Array<{ ended_at: number | null }>;
  assert.equal(openSessions.length, 1);
  assert.equal(openSessions[0].ended_at, null);

  endArcadeSession([alice, bob], 'quiz');

  const afterEnd = getLiveBoard(DEFAULT_GROUP_ID, BASE_EVENT_ID);
  for (const id of [alice, bob]) {
    const entry = afterEnd.find((p) => p.player_id === id);
    assert.equal(entry!.games.length, 0, 'the arcade game must be removed from live_status_games on end');
  }
  const closedSessions = db
    .prepare('SELECT ended_at FROM play_sessions WHERE player_id = ? AND game_id = ?')
    .all(alice, quizGameId) as Array<{ ended_at: number | null }>;
  assert.equal(closedSessions.length, 1);
  assert.ok(closedSessions[0].ended_at !== null, 'the session must be closed');
});

test('GET /api/stats/playtime includes completed Arcade sessions', async () => {
  const carla = await makePlayer('Arcade Tracking Carla');
  const quizGameId = (db.prepare('SELECT id FROM games WHERE arcade_key = ?').get('quiz') as { id: string }).id;

  startArcadeSession([carla], 'quiz');
  endArcadeSession([carla], 'quiz');

  const res = await request(app).get('/api/stats/playtime').query({ gameId: quizGameId });
  assert.equal(res.status, 200);
  const entry = (res.body.entries as Array<{ playerId: string; gameName: string }>).find((e) => e.playerId === carla);
  assert.ok(entry, 'expected a playtime entry for the arcade session');
  assert.equal(entry!.gameName, 'Gaming-Quiz');
});

test('startup recovery closes interrupted Arcade tracking without touching regular games', async () => {
  const playerId = await makePlayer('Arcade Recovery Player');
  const scribbleGameId = (db.prepare('SELECT id FROM games WHERE arcade_key = ?').get('scribble') as { id: string }).id;
  const regularGameId = 'arcade-recovery-regular-game';
  const regularSessionId = 'arcade-recovery-regular-session';

  db.prepare(
    `INSERT INTO games (id, name, status, created_at, group_id)
     VALUES (?, ?, 'catalog', ?, ?)`,
  ).run(regularGameId, 'Recovery Regular Game', Date.now(), DEFAULT_GROUP_ID);

  startArcadeSession([playerId], 'scribble');
  const arcadeSession = db.prepare(
    'SELECT id, started_at AS startedAt FROM play_sessions WHERE player_id = ? AND game_id = ? AND ended_at IS NULL',
  ).get(playerId, scribbleGameId) as { id: string; startedAt: number };
  const confirmedUntil = arcadeSession.startedAt + 500;
  db.prepare(
    `UPDATE tracking_live_contexts SET last_seen = ?
     WHERE player_id = ? AND group_id = ? AND event_id = ?`,
  ).run(confirmedUntil, playerId, DEFAULT_GROUP_ID, BASE_EVENT_ID);
  db.prepare(
    `INSERT INTO tracking_live_games
       (player_id, game_id, group_id, event_id, since, is_foreground)
     VALUES (?, ?, ?, ?, ?, 1)`,
  ).run(playerId, regularGameId, DEFAULT_GROUP_ID, BASE_EVENT_ID, arcadeSession.startedAt);
  db.prepare(
    `INSERT INTO play_sessions
       (id, player_id, game_id, group_id, event_id, started_at, ended_at)
     VALUES (?, ?, ?, ?, ?, ?, NULL)`,
  ).run(
    regularSessionId,
    playerId,
    regularGameId,
    DEFAULT_GROUP_ID,
    BASE_EVENT_ID,
    arcadeSession.startedAt,
  );

  recoverInterruptedArcadeSessions();

  assert.equal(
    db.prepare('SELECT 1 FROM tracking_live_games WHERE player_id = ? AND game_id = ?').get(playerId, scribbleGameId),
    undefined,
    'the interrupted Arcade game must disappear from live status',
  );
  assert.ok(
    db.prepare('SELECT 1 FROM tracking_live_games WHERE player_id = ? AND game_id = ?').get(playerId, regularGameId),
    'agent-tracked games must stay live',
  );
  assert.deepEqual(
    db.prepare('SELECT ended_at AS endedAt FROM play_sessions WHERE id = ?').get(arcadeSession.id),
    { endedAt: confirmedUntil },
    'the interrupted Arcade playtime must stop at its last confirmed presence',
  );
  assert.deepEqual(
    db.prepare('SELECT ended_at AS endedAt FROM play_sessions WHERE id = ?').get(regularSessionId),
    { endedAt: null },
    'regular play sessions must remain open',
  );
});
