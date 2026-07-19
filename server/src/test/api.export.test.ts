// Integration tests for the "Export als Andenken" snapshot endpoint.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nanoid } from 'nanoid';
import request from 'supertest';
import { createApp } from '../app';
import { db } from '../db';
import { getTrackingEventId } from '../events';

const app = createApp();
let gameId: string;
let playerA: string;
let playerB: string;

test('setup: a game, two players, and a recorded match', async () => {
  const game = await request(app).post('/api/games').send({ name: 'Export Test Game' });
  gameId = game.body.id;
  const a = await request(app).post('/api/players').send({ name: 'Export Alice' });
  const b = await request(app).post('/api/players').send({ name: 'Export Bob' });
  playerA = a.body.id;
  playerB = b.body.id;

  await request(app)
    .post('/api/matches')
    .send({ gameId, teams: [{ playerIds: [playerA] }, { playerIds: [playerB] }], winnerTeamIndex: 0 });
});

test('GET /api/export 404s for an unknown eventId', async () => {
  const res = await request(app).get('/api/export?eventId=ghost');
  assert.equal(res.status, 404);
});

test('GET /api/export returns a full snapshot for the active event', async () => {
  const res = await request(app).get('/api/export');
  assert.equal(res.status, 200);
  assert.ok(res.body.event.id);
  assert.ok(typeof res.body.exportedAt === 'number');
  assert.ok(Array.isArray(res.body.leaderboard));
  assert.ok(Array.isArray(res.body.playtimeByPlayer));
  assert.ok(Array.isArray(res.body.playtimeByGame));
  assert.ok(Array.isArray(res.body.awards));
  assert.ok(Array.isArray(res.body.tournaments));

  const alice = res.body.leaderboard.find((s: { playerId: string }) => s.playerId === playerA);
  assert.ok(alice);
  assert.equal(alice.wins, 1);
});

test('GET /api/export includes a completed tournament champion', async () => {
  const created = await request(app)
    .post('/api/tournaments')
    .send({
      gameId,
      format: 'single_elimination',
      teams: [{ name: 'Alice Squad', playerIds: [playerA] }, { name: 'Bob Squad', playerIds: [playerB] }],
    });
  const final = created.body.matches[0];
  await request(app)
    .post(`/api/tournaments/${created.body.id}/matches/${final.id}/result`)
    .send({ winnerTeamId: final.teamAId });

  const res = await request(app).get('/api/export');
  assert.equal(res.status, 200);
  const entry = res.body.tournaments.find((t: { name: string }) => t.name === created.body.name);
  assert.ok(entry);
  assert.equal(entry.championTeamName, 'Alice Squad');
  assert.deepEqual(entry.championPlayers, ['Export Alice']);
});

test('GET /api/export includes playtime-by-player/game and awards from recorded play sessions', async () => {
  const eventId = getTrackingEventId();
  const now = Date.now();
  const oneHourAgo = now - 3_600_000;
  db.prepare(
    'INSERT INTO play_sessions (id, player_id, game_id, event_id, started_at, ended_at, active_ms) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).run(nanoid(), playerA, gameId, eventId, oneHourAgo, now, 3_600_000);

  const res = await request(app).get('/api/export');
  assert.equal(res.status, 200);

  const playerEntry = res.body.playtimeByPlayer.find((p: { playerId: string }) => p.playerId === playerA);
  assert.ok(playerEntry, 'the player with a recorded session should appear in playtimeByPlayer');
  assert.equal(playerEntry.name, 'Export Alice');
  assert.ok(playerEntry.totalFormatted.length > 0);

  const gameEntry = res.body.playtimeByGame.find((g: { gameId: string }) => g.gameId === gameId);
  assert.ok(gameEntry, 'the game with a recorded session should appear in playtimeByGame');
  assert.equal(gameEntry.gameName, 'Export Test Game');
  assert.ok(gameEntry.totalFormatted.length > 0);

  assert.ok(Array.isArray(res.body.awards));
  assert.ok(
    res.body.awards.every((a: { playerName: string }) => typeof a.playerName === 'string' && a.playerName.length > 0),
    'every award should resolve to a real player name'
  );
});

test('GET /api/export/pdf 404s for an unknown eventId', async () => {
  const res = await request(app).get('/api/export/pdf?eventId=ghost');
  assert.equal(res.status, 404);
});

test('GET /api/export/pdf renders the empty-state notes for an event with no data at all', async () => {
  const emptyEvent = await request(app)
    .post('/api/events')
    .send({ name: 'Untouched Export Event', startsAt: Date.now(), endsAt: Date.now() + 3_600_000 });
  assert.equal(emptyEvent.status, 201);

  const res = await request(app)
    .get(`/api/export/pdf?eventId=${emptyEvent.body.id}`)
    .buffer(true)
    .parse((response, callback) => {
      const chunks: Buffer[] = [];
      response.on('data', (chunk: Buffer) => chunks.push(chunk));
      response.on('end', () => callback(null, Buffer.concat(chunks)));
    });
  assert.equal(res.status, 200);
  const buf = res.body as Buffer;
  assert.equal(buf.subarray(0, 5).toString('latin1'), '%PDF-');

  const json = await request(app).get(`/api/export?eventId=${emptyEvent.body.id}`);
  assert.deepEqual(json.body.leaderboard, []);
  assert.deepEqual(json.body.playtimeByPlayer, []);
  assert.deepEqual(json.body.playtimeByGame, []);
  assert.deepEqual(json.body.awards, []);
  assert.deepEqual(json.body.tournaments, []);
});

test('GET /api/export/pdf returns a PDF document', async () => {
  // supertest/superagent doesn't know application/pdf, so it falls back to a
  // raw Buffer in res.body rather than auto-parsing — same situation as the
  // QR code SVG endpoint's test.
  const res = await request(app)
    .get('/api/export/pdf')
    .buffer(true)
    .parse((response, callback) => {
      const chunks: Buffer[] = [];
      response.on('data', (chunk: Buffer) => chunks.push(chunk));
      response.on('end', () => callback(null, Buffer.concat(chunks)));
    });
  assert.equal(res.status, 200);
  assert.match(res.headers['content-type'], /application\/pdf/);
  assert.match(res.headers['content-disposition'], /attachment; filename="respawn-.+\.pdf"/);
  const buf = res.body as Buffer;
  assert.equal(buf.subarray(0, 5).toString('latin1'), '%PDF-');
});
