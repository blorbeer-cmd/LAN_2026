// Integration tests for screenshots attached to recorded match results: the
// stored file and its listing, format and size guards, the per-match limit
// under parallel uploads, delete permissions and file cleanup.

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import request from 'supertest';
import { createTestApp } from './testApp';
import { config } from '../config';
import { db } from '../db';
import { MATCH_SCREENSHOT_LIMIT, MATCH_SCREENSHOT_MAX_BYTES, pruneMatchScreenshotFiles } from '../matchScreenshots';

const mutableConfig = config as unknown as { matchScreenshotDir: string };
const screenshotDir = fs.mkdtempSync(path.join(os.tmpdir(), 'respawn-match-screenshots-'));
mutableConfig.matchScreenshotDir = screenshotDir;
after(() => fs.rmSync(screenshotDir, { recursive: true, force: true }));

const app = createTestApp();
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from('scoreboard')]);
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('png')]);

let gameId: string;
let alice: string;
let bob: string;

function files(): string[] {
  return fs.readdirSync(screenshotDir).sort();
}

function upload(matchId: string, body: Buffer, type = 'image/jpeg', playerId = alice) {
  return request(app)
    .post(`/api/matches/${matchId}/screenshots`)
    .set('x-test-player-id', playerId)
    .set('Content-Type', type)
    .send(body);
}

async function recordMatch(): Promise<string> {
  const res = await request(app)
    .post('/api/matches')
    .send({ gameId, teams: [{ playerIds: [alice] }, { playerIds: [bob] }], winnerTeamIndex: 0 });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return res.body.id;
}

test('setup: a game and two players', async () => {
  gameId = (await request(app).post('/api/games').send({ name: 'Screenshot Game' })).body.id;
  alice = (await request(app).post('/api/players').send({ name: 'Shot Alice' })).body.id;
  bob = (await request(app).post('/api/players').send({ name: 'Shot Bob' })).body.id;
});

test('a participant attaches a screenshot to a draw result and everyone sees it in the history', async () => {
  const draw = await request(app).post('/api/matchmaking').send({ gameId, playerIds: [alice, bob] });
  assert.equal(draw.status, 200, JSON.stringify(draw.body));
  const lineup = draw.body.teams.map((team: { players: Array<{ id: string }> }) => team.players.map((p) => p.id));
  const match = await request(app)
    .post('/api/matches')
    .send({ gameId, drawId: draw.body.id, teams: lineup.map((playerIds: string[]) => ({ playerIds })), winnerTeamIndex: 0 });
  assert.equal(match.status, 201, JSON.stringify(match.body));

  const created = await upload(match.body.id, JPEG);
  assert.equal(created.status, 201, JSON.stringify(created.body));
  assert.equal(created.body.uploadedBy, alice);

  const history = await request(app).get('/api/matchmaking/history?kind=matches');
  const entry = history.body.history.find((item: { id: string }) => item.id === draw.body.id);
  assert.deepEqual(entry.screenshots, [created.body]);
  const listed = await request(app).get('/api/matches');
  assert.deepEqual(listed.body.find((item: { id: string }) => item.id === match.body.id).screenshots, [created.body]);

  const image = await request(app)
    .get(`/api/matches/${match.body.id}/screenshots/${created.body.id}`)
    .set('x-test-player-id', bob)
    .buffer(true)
    .parse((res, done) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => done(null, Buffer.concat(chunks)));
    });
  assert.equal(image.status, 200);
  assert.equal(image.headers['content-type'], 'image/jpeg');
  assert.deepEqual(image.body, JPEG);
  assert.deepEqual(files(), [`${created.body.id}.jpg`]);
});

test('uploads with a wrong type, forged content, excess size or unknown match are rejected without leftovers', async () => {
  const matchId = await recordMatch();
  const before = files();
  const cases: Array<[request.Test, number]> = [
    [upload(matchId, Buffer.from('GIF89a'), 'image/gif'), 415],
    [upload(matchId, PNG, 'image/jpeg'), 400],
    [upload(matchId, Buffer.alloc(0)), 400],
    [upload(matchId, Buffer.concat([JPEG, Buffer.alloc(MATCH_SCREENSHOT_MAX_BYTES)])), 413],
    [upload('missing-match', JPEG), 404],
  ];
  for (const [pending, status] of cases) {
    const res = await pending;
    assert.equal(res.status, status, JSON.stringify(res.body));
    assert.equal(typeof res.body.error, 'string');
  }
  assert.equal((await upload(matchId, PNG, 'image/png')).status, 201);
  assert.equal(files().length, before.length + 1);
  assert.ok(files().every((name) => !name.endsWith('.upload')));
});

test('parallel uploads never exceed the per-match limit', async () => {
  const matchId = await recordMatch();
  const results = await Promise.all(Array.from({ length: MATCH_SCREENSHOT_LIMIT + 2 }, () => upload(matchId, JPEG)));
  const statuses = results.map((res) => res.status).sort();
  assert.deepEqual(statuses, [...Array(MATCH_SCREENSHOT_LIMIT).fill(201), 409, 409]);
  const rows = db.prepare('SELECT id FROM match_screenshots WHERE match_id = ?').all(matchId) as Array<{ id: string }>;
  assert.equal(rows.length, MATCH_SCREENSHOT_LIMIT);
  for (const { id } of rows) assert.ok(fs.existsSync(path.join(screenshotDir, `${id}.jpg`)));
  assert.ok(files().every((name) => !name.endsWith('.upload')));
});

test('only the uploader or an admin removes a screenshot, and deleting the match removes its files', async () => {
  const matchId = await recordMatch();
  const own = (await upload(matchId, JPEG, 'image/jpeg', alice)).body.id;
  const foreign = (await upload(matchId, JPEG, 'image/jpeg', bob)).body.id;

  const denied = await request(app).delete(`/api/matches/${matchId}/screenshots/${own}`).set('x-test-player-id', bob);
  assert.equal(denied.status, 403);
  assert.equal((await request(app).delete(`/api/matches/${matchId}/screenshots/${own}`).set('x-test-player-id', alice)).status, 204);
  assert.equal(fs.existsSync(path.join(screenshotDir, `${own}.jpg`)), false);
  assert.equal((await request(app).get(`/api/matches/${matchId}/screenshots/${own}`)).status, 404);

  // The default test identity is the group owner.
  assert.equal((await request(app).delete(`/api/matches/${matchId}/screenshots/${foreign}`)).status, 204);

  const kept = (await upload(matchId, JPEG)).body.id;
  assert.equal((await request(app).delete(`/api/matches/${matchId}`)).status, 204);
  assert.equal(fs.existsSync(path.join(screenshotDir, `${kept}.jpg`)), false);
});

test('the cleanup keeps live files and young uploads, and removes orphans and stale temporary files', () => {
  const live = db.prepare('SELECT id FROM match_screenshots LIMIT 1').get() as { id: string };
  fs.writeFileSync(path.join(screenshotDir, 'orphan.jpg'), JPEG);
  fs.writeFileSync(path.join(screenshotDir, '.young.upload'), JPEG);
  const stale = path.join(screenshotDir, '.stale.upload');
  fs.writeFileSync(stale, JPEG);
  const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
  fs.utimesSync(stale, twoHoursAgo, twoHoursAgo);

  assert.equal(pruneMatchScreenshotFiles(), 2);
  assert.ok(files().includes(`${live.id}.jpg`));
  assert.ok(files().includes('.young.upload'));
  assert.ok(!files().includes('orphan.jpg'));
  assert.ok(!files().includes('.stale.upload'));
});
