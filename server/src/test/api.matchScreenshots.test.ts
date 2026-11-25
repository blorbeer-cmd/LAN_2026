// Integration tests for screenshots attached to recorded Match results: the
// stored file and its listing, format and size guards, the per-match limit
// under parallel uploads, which results take screenshots, delete permissions
// and file cleanup.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import http from 'http';
import type { AddressInfo } from 'net';
import os from 'os';
import path from 'path';
import request from 'supertest';
import { createTestApp } from './testApp';
import { config } from '../config';
import { db, DEFAULT_GROUP_ID } from '../db';
import { MATCH_SCREENSHOT_LIMIT, MATCH_SCREENSHOT_MAX_BYTES, pruneMatchScreenshotFiles } from '../matchScreenshots';

const mutableConfig = config as unknown as { matchScreenshotDir: string };
const screenshotDir = fs.mkdtempSync(path.join(os.tmpdir(), 'respawn-match-screenshots-'));
mutableConfig.matchScreenshotDir = screenshotDir;

const app = createTestApp();
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from('scoreboard')]);
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('png')]);
const ADMIN = '__integration-test-admin__';

let server: http.Server;
let gameId: string;
let alice: string;
let bob: string;

before(async () => {
  server = app.listen(0);
  gameId = (await request(server).post('/api/games').send({ name: 'Screenshot Game' })).body.id;
  alice = (await request(server).post('/api/players').send({ name: 'Shot Alice' })).body.id;
  bob = (await request(server).post('/api/players').send({ name: 'Shot Bob' })).body.id;
});

after(() => {
  server.close();
  fs.rmSync(screenshotDir, { recursive: true, force: true });
});

function files(): string[] {
  return fs.readdirSync(screenshotDir).sort();
}

function fileOf(id: string, ext = 'jpg'): string {
  return path.join(screenshotDir, `match-shot-${id}.${ext}`);
}

function upload(matchId: string, body: Buffer, type = 'image/jpeg', playerId = alice) {
  return request(server)
    .post(`/api/matches/${matchId}/screenshots`)
    .set('x-test-player-id', playerId)
    .set('Content-Type', type)
    .send(body);
}

// A result recorded for a drawn lineup: the kind of match the Match history
// shows and the only kind that takes screenshots.
async function recordDrawMatch(): Promise<{ drawId: string; matchId: string }> {
  const draw = await request(server).post('/api/matchmaking').send({ gameId, playerIds: [alice, bob] });
  assert.equal(draw.status, 200, JSON.stringify(draw.body));
  const teams = draw.body.teams.map((team: { players: Array<{ id: string }> }) => ({ playerIds: team.players.map((p) => p.id) }));
  const match = await request(server).post('/api/matches').send({ gameId, drawId: draw.body.id, teams, winnerTeamIndex: 0 });
  assert.equal(match.status, 201, JSON.stringify(match.body));
  return { drawId: draw.body.id, matchId: match.body.id };
}

// Sends the body in chunks without Content-Length, so the server only learns
// the size while streaming. Resolves with the HTTP status the client received.
function streamUpload(matchId: string, totalBytes: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const { port } = server.address() as AddressInfo;
    const req = http.request({
      port,
      method: 'POST',
      path: `/api/matches/${matchId}/screenshots`,
      headers: { 'content-type': 'image/jpeg', 'transfer-encoding': 'chunked', 'x-test-player-id': alice },
    }, (res) => {
      res.resume();
      res.on('end', () => resolve(res.statusCode ?? 0));
    });
    req.on('error', reject);
    const chunk = Buffer.alloc(256 * 1024, 0xff);
    let sent = 0;
    const write = () => {
      while (sent < totalBytes) {
        sent += chunk.length;
        if (!req.write(chunk)) {
          req.once('drain', write);
          return;
        }
      }
      req.end();
    };
    write();
  });
}

test('a participant attaches a screenshot to a draw result and everyone sees it in the history', async () => {
  const { drawId, matchId } = await recordDrawMatch();

  const created = await upload(matchId, JPEG);
  assert.equal(created.status, 201, JSON.stringify(created.body));
  assert.equal(created.body.uploadedBy, alice);

  const history = await request(server).get('/api/matchmaking/history?kind=matches');
  const entry = history.body.history.find((item: { id: string }) => item.id === drawId);
  assert.deepEqual(entry.screenshots, [created.body]);
  const listed = await request(server).get('/api/matches');
  assert.deepEqual(listed.body.find((item: { id: string }) => item.id === matchId).screenshots, [created.body]);

  const image = await request(server)
    .get(`/api/matches/${matchId}/screenshots/${created.body.id}`)
    .set('x-test-player-id', bob)
    .buffer(true)
    .parse((res, done) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => done(null, Buffer.concat(chunks)));
    });
  assert.equal(image.status, 200);
  assert.equal(image.headers['content-type'], 'image/jpeg');
  // Revalidated on every view, so deletion and lost access apply at once.
  assert.equal(image.headers['cache-control'], 'private, no-cache');
  assert.deepEqual(image.body, JPEG);
  assert.ok(fs.existsSync(fileOf(created.body.id)));
});

test('only Match history results take screenshots', async () => {
  const adHoc = await request(server)
    .post('/api/matches')
    .send({ gameId, teams: [{ playerIds: [alice] }, { playerIds: [bob] }], winnerTeamIndex: 0 });
  assert.equal(adHoc.status, 201);
  const before = files();
  const rejected = await upload(adHoc.body.id, JPEG);
  assert.equal(rejected.status, 409);
  assert.match(rejected.body.error, /Match-Historie/);
  assert.deepEqual(files(), before);
});

test('uploads with a wrong type, forged content, excess size or unknown match are rejected without leftovers', async () => {
  const { matchId } = await recordDrawMatch();
  const before = files();
  // Built one at a time: a request object starts its own server right away.
  const cases: Array<[() => request.Test, number]> = [
    [() => upload(matchId, Buffer.from('GIF89a'), 'image/gif'), 415],
    [() => upload(matchId, PNG, 'image/jpeg'), 400],
    [() => upload(matchId, Buffer.alloc(0)), 400],
    [() => upload(matchId, Buffer.concat([JPEG, Buffer.alloc(MATCH_SCREENSHOT_MAX_BYTES)])), 413],
    [() => upload('missing-match', JPEG), 404],
  ];
  for (const [send, status] of cases) {
    const res = await send();
    assert.equal(res.status, status, JSON.stringify(res.body));
    assert.equal(typeof res.body.error, 'string');
  }
  // Without Content-Length the size only shows while streaming; the client
  // still receives the 413 instead of a reset connection.
  assert.equal(await streamUpload(matchId, MATCH_SCREENSHOT_MAX_BYTES + 512 * 1024), 413);
  assert.deepEqual(files(), before);
  assert.equal((await upload(matchId, PNG, 'image/png')).status, 201);
});

test('parallel uploads never exceed the per-match limit', async () => {
  const { matchId } = await recordDrawMatch();
  const results = await Promise.all(Array.from({ length: MATCH_SCREENSHOT_LIMIT + 2 }, () => upload(matchId, JPEG)));
  const statuses = results.map((res) => res.status).sort();
  assert.deepEqual(statuses, [...Array(MATCH_SCREENSHOT_LIMIT).fill(201), 409, 409]);
  const rows = db.prepare('SELECT id FROM match_screenshots WHERE match_id = ?').all(matchId) as Array<{ id: string }>;
  assert.equal(rows.length, MATCH_SCREENSHOT_LIMIT);
  for (const { id } of rows) assert.ok(fs.existsSync(fileOf(id)));
  assert.ok(files().every((name) => !name.endsWith('.upload')));
});

test('Admin mode reaches the screenshots of a test event, also as an image query flag', async () => {
  const { matchId } = await recordDrawMatch();
  const shot = (await upload(matchId, JPEG)).body.id;
  const testEvent = 'screenshot-test-lan';
  db.prepare(`INSERT INTO events (id, name, starts_at, ends_at, group_id, status, visibility_scope, schedule_revision, is_test)
    VALUES (?, 'Screenshot Test LAN', ?, ?, ?, 'published', 'participants', 1, 1)`).run(testEvent, Date.now() - 1000, Date.now() + 86_400_000, DEFAULT_GROUP_ID);
  db.prepare("INSERT INTO event_participants (event_id, player_id, status) VALUES (?, ?, 'accepted')").run(testEvent, ADMIN);
  db.prepare('UPDATE matches SET event_id = ? WHERE id = ?').run(testEvent, matchId);
  db.prepare('UPDATE matchmaking_draws SET event_id = ? WHERE match_id = ?').run(testEvent, matchId);

  const url = `/api/matches/${matchId}/screenshots/${shot}`;
  assert.equal((await request(server).get(url)).status, 404);
  assert.equal((await request(server).get(url).set('x-admin-mode', '1')).status, 200);
  assert.equal((await request(server).get(`${url}?adminMode=1`)).status, 200);
  const uploaded = await request(server)
    .post(`/api/matches/${matchId}/screenshots`)
    .set('x-admin-mode', '1')
    .set('Content-Type', 'image/jpeg')
    .send(JPEG);
  assert.equal(uploaded.status, 201, JSON.stringify(uploaded.body));
});

test('only the uploader or an admin removes a screenshot, and deleting the match removes its files', async () => {
  const { matchId } = await recordDrawMatch();
  const own = (await upload(matchId, JPEG, 'image/jpeg', alice)).body.id;
  const foreign = (await upload(matchId, JPEG, 'image/jpeg', bob)).body.id;

  const denied = await request(server).delete(`/api/matches/${matchId}/screenshots/${own}`).set('x-test-player-id', bob);
  assert.equal(denied.status, 403);
  assert.equal((await request(server).delete(`/api/matches/${matchId}/screenshots/${own}`).set('x-test-player-id', alice)).status, 204);
  assert.equal(fs.existsSync(fileOf(own)), false);
  assert.equal((await request(server).get(`/api/matches/${matchId}/screenshots/${own}`)).status, 404);

  // The default test identity is the group owner.
  assert.equal((await request(server).delete(`/api/matches/${matchId}/screenshots/${foreign}`)).status, 204);

  const kept = (await upload(matchId, JPEG)).body.id;
  assert.equal((await request(server).delete(`/api/matches/${matchId}`)).status, 204);
  assert.equal(fs.existsSync(fileOf(kept)), false);
});

test('the cleanup keeps live and foreign files and young uploads, and removes orphans and stale temporary files', async () => {
  const { matchId } = await recordDrawMatch();
  const jpeg = (await upload(matchId, JPEG)).body.id;
  const png = (await upload(matchId, PNG, 'image/png')).body.id;
  const write = (name: string, ageMs = 0) => {
    const file = path.join(screenshotDir, name);
    fs.writeFileSync(file, JPEG);
    const time = new Date(Date.now() - ageMs);
    fs.utimesSync(file, time, time);
  };
  const twoHours = 2 * 60 * 60 * 1000;
  write('match-shot-orphan.jpg');
  write('.match-shot-young.upload');
  write('.match-shot-stale.upload', twoHours);
  // Another feature's media in the same folder must survive.
  write('welcome-trailer-poster.jpg', twoHours);
  write('.welcome-trailer.mp4.abc.upload', twoHours);

  assert.equal(pruneMatchScreenshotFiles(), 2);
  const remaining = files();
  for (const name of [`match-shot-${jpeg}.jpg`, `match-shot-${png}.png`, '.match-shot-young.upload',
    'welcome-trailer-poster.jpg', '.welcome-trailer.mp4.abc.upload']) {
    assert.ok(remaining.includes(name), name);
  }
  assert.ok(!remaining.includes('match-shot-orphan.jpg'));
  assert.ok(!remaining.includes('.match-shot-stale.upload'));
});
