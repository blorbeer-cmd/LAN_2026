// Integration tests for the manual live-status override (FR-28): setting a
// "Pause/Essen" note without needing the agent to report anything.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../app';
import { db } from '../db';
import { config } from '../config';

const app = createApp();
let playerId: string;

test('setup: a player with no agent report yet', async () => {
  const player = await request(app).post('/api/players').send({ name: 'Note Tester' });
  playerId = player.body.id;
});

test('POST /api/live/:playerId/note 404s for an unknown player', async () => {
  const res = await request(app).post('/api/live/ghost/note').send({ note: 'Pause' });
  assert.equal(res.status, 404);
});

test('POST /api/live/:playerId/note rejects an overly long note', async () => {
  const res = await request(app)
    .post(`/api/live/${playerId}/note`)
    .send({ note: 'x'.repeat(61) });
  assert.equal(res.status, 400);
});

test('setting a note flips a never-reported player to "paused"', async () => {
  const res = await request(app).post(`/api/live/${playerId}/note`).send({ note: 'Essen' });
  assert.equal(res.status, 200);

  const board = await request(app).get('/api/live');
  const entry = board.body.find((r: { player_id: string }) => r.player_id === playerId);
  assert.equal(entry.state, 'paused');
  assert.equal(entry.manual_note, 'Essen');
});

test('clearing the note (null) flips them back to offline', async () => {
  const res = await request(app).post(`/api/live/${playerId}/note`).send({ note: null });
  assert.equal(res.status, 200);

  const board = await request(app).get('/api/live');
  const entry = board.body.find((r: { player_id: string }) => r.player_id === playerId);
  assert.equal(entry.state, 'offline');
  assert.equal(entry.manual_note, null);
});

test('an empty/whitespace-only note is treated the same as clearing it', async () => {
  await request(app).post(`/api/live/${playerId}/note`).send({ note: 'Pause' });
  const res = await request(app).post(`/api/live/${playerId}/note`).send({ note: '   ' });
  assert.equal(res.status, 200);

  const board = await request(app).get('/api/live');
  const entry = board.body.find((r: { player_id: string }) => r.player_id === playerId);
  assert.equal(entry.manual_note, null);
});

test('setting a note still pauses a player whose last agent report has gone stale', async () => {
  // Reproduces the Home pause button silently doing nothing: a player whose
  // agent stopped reporting a while ago has a stale live_status row. Their
  // note must still bump last_seen so deriveState doesn't immediately
  // discard the fresh manual override as stale (see live.ts).
  const stalePlayer = await request(app).post('/api/players').send({ name: 'Stale Note Tester' });
  const staleId = stalePlayer.body.id;
  const staleLastSeen = Date.now() - config.offlineTimeoutMs - 5_000;
  db.prepare(
    `INSERT INTO live_status (player_id, last_seen, manual_note) VALUES (?, ?, NULL)`
  ).run(staleId, staleLastSeen);

  const res = await request(app).post(`/api/live/${staleId}/note`).send({ note: 'Pause / Essen' });
  assert.equal(res.status, 200);

  const board = await request(app).get('/api/live');
  const entry = board.body.find((r: { player_id: string }) => r.player_id === staleId);
  assert.equal(entry.state, 'paused');
  assert.equal(entry.manual_note, 'Pause / Essen');
});
