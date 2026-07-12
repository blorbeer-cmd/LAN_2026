// Integration tests for the agent report endpoint and the live-status board it
// feeds. Covers FR-09..14: auth via player API key, process-name matching
// (including several simultaneous games on one PC), "since" preserved across
// repeated reports, and clearing games that are no longer detected.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../app';
import { db } from '../db';

const app = createApp();
let apiKey: string;
let playerId: string;
let cs2GameId: string;
let rocketLeagueGameId: string;

function gamesOf(entry: { games: Array<{ game_id: string }> }): string[] {
  return entry.games.map((g) => g.game_id);
}

test('setup: create a player and locate two seeded games', async () => {
  const player = await request(app).post('/api/players').send({ name: 'Agent Tester' });
  playerId = player.body.id;
  apiKey = player.body.api_key;

  const games = await request(app).get('/api/games');
  cs2GameId = games.body.find((g: { name: string }) => g.name === 'Counter-Strike 2').id;
  rocketLeagueGameId = games.body.find((g: { name: string }) => g.name === 'Rocket League').id;
  assert.ok(apiKey && cs2GameId && rocketLeagueGameId);
});

test('POST /api/agent/report without x-api-key is rejected', async () => {
  const res = await request(app).post('/api/agent/report').send({ processNames: [] });
  assert.equal(res.status, 401);
});

test('POST /api/agent/report with a wrong api key is rejected', async () => {
  const res = await request(app)
    .post('/api/agent/report')
    .set('x-api-key', 'not-a-real-key')
    .send({ processNames: [] });
  assert.equal(res.status, 401);
});

test('POST /api/agent/report rejects a non-array processNames', async () => {
  const res = await request(app)
    .post('/api/agent/report')
    .set('x-api-key', apiKey)
    .send({ processNames: 'cs2.exe' });
  assert.equal(res.status, 400);
});

test('POST /api/agent/report matches a known process to its game', async () => {
  const res = await request(app)
    .post('/api/agent/report')
    .set('x-api-key', apiKey)
    .send({ processNames: ['explorer.exe', 'CS2.EXE'], agentVersion: '1.0.0' });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.gameIds, [cs2GameId]);
});

test('GET /api/admin/agent-diagnostics exposes the latest agent heartbeat', async () => {
  const res = await request(app).get('/api/admin/agent-diagnostics');
  assert.equal(res.status, 200);
  const entry = res.body.find((row: { playerId: string }) => row.playerId === playerId);
  assert.ok(entry);
  assert.equal(entry.agentVersion, '1.0.0');
  assert.ok(entry.lastReportAt);
  assert.deepEqual(entry.processNames, ['explorer.exe', 'cs2.exe']);
  assert.equal(entry.online, true);
});

test('GET /api/live shows the player as playing exactly CS2', async () => {
  const res = await request(app).get('/api/live');
  const entry = res.body.find((r: { player_id: string }) => r.player_id === playerId);
  assert.ok(entry);
  assert.equal(entry.state, 'playing');
  assert.deepEqual(gamesOf(entry), [cs2GameId]);
  assert.ok(entry.games[0].since);
});

test('reporting two games at once (e.g. launcher + game) surfaces both', async () => {
  const res = await request(app)
    .post('/api/agent/report')
    .set('x-api-key', apiKey)
    .send({ processNames: ['cs2.exe', 'rocketleague.exe'] });
  assert.equal(res.status, 200);
  assert.deepEqual(new Set(res.body.gameIds), new Set([cs2GameId, rocketLeagueGameId]));

  const board = await request(app).get('/api/live');
  const entry = board.body.find((r: { player_id: string }) => r.player_id === playerId);
  assert.equal(entry.state, 'playing');
  assert.deepEqual(new Set(gamesOf(entry)), new Set([cs2GameId, rocketLeagueGameId]));
});

test('reporting the same game again keeps its original "since" timestamp', async () => {
  const before = await request(app).get('/api/live');
  const cs2Before = before.body
    .find((r: { player_id: string }) => r.player_id === playerId)
    .games.find((g: { game_id: string }) => g.game_id === cs2GameId).since;

  await new Promise((r) => setTimeout(r, 10));
  await request(app)
    .post('/api/agent/report')
    .set('x-api-key', apiKey)
    .send({ processNames: ['cs2.exe', 'rocketleague.exe'] });

  const after = await request(app).get('/api/live');
  const cs2After = after.body
    .find((r: { player_id: string }) => r.player_id === playerId)
    .games.find((g: { game_id: string }) => g.game_id === cs2GameId).since;
  assert.equal(cs2After, cs2Before);
});

test('closing one of two games removes only that one', async () => {
  await request(app)
    .post('/api/agent/report')
    .set('x-api-key', apiKey)
    .send({ processNames: ['cs2.exe'] }); // Rocket League closed

  const res = await request(app).get('/api/live');
  const entry = res.body.find((r: { player_id: string }) => r.player_id === playerId);
  assert.deepEqual(gamesOf(entry), [cs2GameId]);
  assert.equal(entry.state, 'playing');
});

test('reporting no matching process clears all games and flips state to offline', async () => {
  await request(app)
    .post('/api/agent/report')
    .set('x-api-key', apiKey)
    .send({ processNames: ['notepad.exe'] });

  const res = await request(app).get('/api/live');
  const entry = res.body.find((r: { player_id: string }) => r.player_id === playerId);
  assert.deepEqual(entry.games, []);
  assert.equal(entry.state, 'offline');
});

test('a player with no report at all appears as offline on the board', async () => {
  const other = await request(app).post('/api/players').send({ name: 'Never Reported' });
  const res = await request(app).get('/api/live');
  const entry = res.body.find((r: { player_id: string }) => r.player_id === other.body.id);
  assert.ok(entry);
  assert.equal(entry.state, 'offline');
  assert.deepEqual(entry.games, []);
});

test('a report with no foreground signal at all leaves activity_tracked false and every game not foreground', async () => {
  await request(app)
    .post('/api/agent/report')
    .set('x-api-key', apiKey)
    .send({ processNames: ['cs2.exe', 'rocketleague.exe'] });

  const board = await request(app).get('/api/live');
  const entry = board.body.find((r: { player_id: string }) => r.player_id === playerId);
  assert.equal(entry.activity_tracked, false);
  assert.ok(entry.games.every((g: { foreground: boolean }) => g.foreground === false));
});

test('a report with a foreground signal marks activity_tracked and the focused game only', async () => {
  await request(app)
    .post('/api/agent/report')
    .set('x-api-key', apiKey)
    .send({ processNames: ['cs2.exe', 'rocketleague.exe'], foregroundProcessName: 'cs2.exe', idleSeconds: 0 });

  const board = await request(app).get('/api/live');
  const entry = board.body.find((r: { player_id: string }) => r.player_id === playerId);
  assert.equal(entry.activity_tracked, true);
  const cs2Entry = entry.games.find((g: { game_id: string }) => g.game_id === cs2GameId);
  const rlEntry = entry.games.find((g: { game_id: string }) => g.game_id === rocketLeagueGameId);
  assert.equal(cs2Entry.foreground, true);
  assert.equal(rlEntry.foreground, false);
});

test('focus switching between two running games updates which one is foreground on the next report', async () => {
  await request(app)
    .post('/api/agent/report')
    .set('x-api-key', apiKey)
    .send({ processNames: ['cs2.exe', 'rocketleague.exe'], foregroundProcessName: 'rocketleague.exe', idleSeconds: 0 });

  const board = await request(app).get('/api/live');
  const entry = board.body.find((r: { player_id: string }) => r.player_id === playerId);
  const cs2Entry = entry.games.find((g: { game_id: string }) => g.game_id === cs2GameId);
  const rlEntry = entry.games.find((g: { game_id: string }) => g.game_id === rocketLeagueGameId);
  assert.equal(cs2Entry.foreground, false);
  assert.equal(rlEntry.foreground, true);

  // Clean up back to the single-game state the following tests expect.
  await request(app)
    .post('/api/agent/report')
    .set('x-api-key', apiKey)
    .send({ processNames: ['cs2.exe'] });
});

test('POST /api/agent/report includes trackingPaused: false by default', async () => {
  const res = await request(app)
    .post('/api/agent/report')
    .set('x-api-key', apiKey)
    .send({ processNames: [] });
  assert.equal(res.body.trackingPaused, false);
});

test('POST /api/agent/tracking-paused without x-api-key is rejected', async () => {
  const res = await request(app).post('/api/agent/tracking-paused').send({ paused: true });
  assert.equal(res.status, 401);
});

test('POST /api/agent/tracking-paused rejects a non-boolean paused', async () => {
  const res = await request(app)
    .post('/api/agent/tracking-paused')
    .set('x-api-key', apiKey)
    .send({ paused: 'yes' });
  assert.equal(res.status, 400);
});

test('POST /api/agent/tracking-paused sets the flag that both the web profile and /report see', async () => {
  await request(app)
    .post('/api/agent/report')
    .set('x-api-key', apiKey)
    .send({ processNames: ['cs2.exe'] });

  const paused = await request(app).post('/api/agent/tracking-paused').set('x-api-key', apiKey).send({ paused: true });
  assert.equal(paused.status, 200);
  assert.equal(paused.body.trackingPaused, true);

  const live = await request(app).get('/api/live');
  const entry = live.body.find((row: { player_id: string }) => row.player_id === playerId);
  assert.deepEqual(entry.games, []);
  assert.equal(
    (db.prepare('SELECT COUNT(*) AS count FROM play_sessions WHERE player_id = ? AND ended_at IS NULL').get(playerId) as { count: number }).count,
    0
  );

  const profile = await request(app).get(`/api/players/${playerId}`);
  assert.equal(profile.body.tracking_paused, 1);

  const report = await request(app)
    .post('/api/agent/report')
    .set('x-api-key', apiKey)
    .send({ processNames: ['cs2.exe'] });
  assert.equal(report.body.tracked, false);
  assert.equal(report.body.trackingPaused, true);

  const resumed = await request(app).post('/api/agent/tracking-paused').set('x-api-key', apiKey).send({ paused: false });
  assert.equal(resumed.body.trackingPaused, false);
});
