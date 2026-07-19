import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import type { Response as SuperAgentResponse } from 'superagent';
import request from 'supertest';
import { createApp } from '../app';

const app = createApp();
let controllerToken = '';
let controllerLoop: ReturnType<typeof setInterval> | undefined;
let controllerBusy = false;
let failNextControllerCommand: { type: string; message: string } | null = null;

const tracks = {
  AAAAAAAAAAAAAAAAAAAAAA: {
    id: 'AAAAAAAAAAAAAAAAAAAAAA', uri: 'spotify:track:AAAAAAAAAAAAAAAAAAAAAA', name: 'LAN Anthem',
    artist: 'Respawners', album: 'LAN 2026', imageUrl: 'https://image.example/anthem.jpg', durationMs: 180_000,
  },
  BBBBBBBBBBBBBBBBBBBBBB: {
    id: 'BBBBBBBBBBBBBBBBBBBBBB', uri: 'spotify:track:BBBBBBBBBBBBBBBBBBBBBB', name: 'Queue Two',
    artist: 'Test Band', album: 'Second', imageUrl: null, durationMs: 200_000,
  },
  CCCCCCCCCCCCCCCCCCCCCC: {
    id: 'CCCCCCCCCCCCCCCCCCCCCC', uri: 'spotify:track:CCCCCCCCCCCCCCCCCCCCCC', name: 'Queue Three',
    artist: 'No Limits', album: 'Third', imageUrl: null, durationMs: 210_000,
  },
};

function controllerData(type: string, payload: Record<string, unknown>) {
  if (type === 'devices') return { devices: [{ id: 'speaker-1', name: 'LAN Boxen', type: 'Speaker', active: true }] };
  if (type === 'search') return { tracks: Object.values(tracks) };
  if (type === 'track') return tracks[payload.trackId as keyof typeof tracks] ?? null;
  return { ok: true };
}

function startControllerLoop(): void {
  controllerLoop = setInterval(async () => {
    if (controllerBusy) return;
    controllerBusy = true;
    try {
      const polled = await request(app).get('/api/music/controller/commands').set('x-music-controller-token', controllerToken);
      const command = polled.body.command;
      if (command) {
        const forcedFailure = failNextControllerCommand?.type === command.type ? failNextControllerCommand : null;
        if (forcedFailure) failNextControllerCommand = null;
        await request(app)
          .post(`/api/music/controller/commands/${command.id}/result`)
          .set('x-music-controller-token', controllerToken)
          .send(forcedFailure
            ? { ok: false, error: forcedFailure.message }
            : { ok: true, data: controllerData(command.type, command.payload || {}) });
      }
    } finally {
      controllerBusy = false;
    }
  }, 5);
}

after(() => {
  if (controllerLoop) clearInterval(controllerLoop);
});

test('local controller pairs without sending Spotify credentials to Respawn', async () => {
  const alice = (await request(app).post('/api/players').send({ name: 'Music Alice' })).body;
  const bob = (await request(app).post('/api/players').send({ name: 'Music Bob' })).body;

  const memberPairing = await request(app).post('/api/music/pairing').send({ playerId: bob.id });
  assert.equal(memberPairing.status, 403);

  const pairing = await request(app).post('/api/music/pairing').set('x-admin-mode', '1').send({ playerId: alice.id });
  assert.equal(pairing.status, 200);
  assert.match(pairing.body.code, /^[A-Z0-9]+$/);
  assert.equal(pairing.body.controllerUrl, 'http://127.0.0.1:43821');

  const controllerPackage = await request(app)
    .post('/api/music/controller-package')
    .set('x-admin-mode', '1')
    .send({ playerId: alice.id, pairingCode: pairing.body.code })
    .buffer(true)
    .parse((response: SuperAgentResponse, callback: (error: Error | null, body: Buffer) => void) => {
      const chunks: Buffer[] = [];
      response.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
      response.on('end', () => callback(null, Buffer.concat(chunks)));
      response.on('error', callback);
    });
  assert.equal(controllerPackage.status, 200);
  assert.match(controllerPackage.headers['content-disposition'], /Respawn-Jam-Controller\.zip/);
  assert.equal(Buffer.isBuffer(controllerPackage.body), true);
  assert.equal(controllerPackage.body.subarray(0, 2).toString(), 'PK');

  const invalid = await request(app).post('/api/music/controller/register').send({
    pairingCode: 'WRONG', label: 'LAN Pi', spotifyDisplayName: 'LAN DJ',
  });
  assert.equal(invalid.status, 400);

  const registered = await request(app).post('/api/music/controller/register').send({
    pairingCode: pairing.body.code, label: 'LAN Pi', spotifyDisplayName: 'LAN DJ',
  });
  assert.equal(registered.status, 201);
  controllerToken = registered.body.controllerToken;
  assert.ok(controllerToken);

  await request(app).post('/api/music/controller/heartbeat').set('x-music-controller-token', controllerToken).send({ playback: null });
  const status = await request(app).get('/api/music/status').set('x-player-id', alice.id).set('x-admin-mode', '1');
  assert.equal(status.status, 200);
  assert.deepEqual(status.body.controller.label, 'LAN Pi');
  assert.equal(status.body.controller.spotifyDisplayName, 'LAN DJ');
  assert.equal(status.body.controller.online, true);
  assert.equal(status.body.canManageController, true);
  assert.equal(JSON.stringify(status.body).includes(controllerToken), false);
  assert.equal(JSON.stringify(status.body).toLowerCase().includes('spotifyclient'), false);
  const memberStatus = await request(app).get('/api/music/status').set('x-player-id', bob.id);
  assert.equal(memberStatus.body.canManageController, false);

  startControllerLoop();

  const devices = await request(app).get('/api/music/devices');
  assert.equal(devices.status, 200);
  assert.equal(devices.body.devices[0].name, 'LAN Boxen');

  const started = await request(app).post('/api/music/sessions').send({ playerId: alice.id, deviceId: 'speaker-1' });
  assert.equal(started.status, 201);
  assert.equal(started.body.deviceName, 'LAN Boxen');

  const search = await request(app).get('/api/music/search?q=LAN');
  assert.equal(search.status, 200);
  assert.equal(search.body.tracks.length, 3);

  const first = await request(app).post('/api/music/requests').send({ playerId: bob.id, trackId: tracks.AAAAAAAAAAAAAAAAAAAAAA.id });
  const second = await request(app).post('/api/music/requests').send({ playerId: bob.id, trackId: tracks.BBBBBBBBBBBBBBBBBBBBBB.id });
  const third = await request(app).post('/api/music/requests').send({ playerId: alice.id, trackId: tracks.CCCCCCCCCCCCCCCCCCCCCC.id });
  assert.equal(first.status, 201);
  assert.equal(second.status, 201);
  assert.equal(third.status, 201);

  let live = await request(app).get('/api/music/status').set('x-player-id', alice.id);
  const queued = live.body.session.requests.filter((entry: { status: string }) => entry.status === 'queued');
  const reorderedIds = queued.map((entry: { id: string }) => entry.id).reverse();
  const reordered = await request(app).put('/api/music/requests/order').send({ playerId: bob.id, requestIds: reorderedIds });
  assert.equal(reordered.status, 200);
  const removed = await request(app).delete(`/api/music/requests/${reorderedIds[0]}`).send({ playerId: bob.id });
  assert.equal(removed.status, 204);

  const paused = await request(app).post('/api/music/playback').send({ playerId: bob.id, playing: false });
  assert.equal(paused.status, 200);
  const resumed = await request(app).post('/api/music/playback').send({ playerId: alice.id, playing: true });
  assert.equal(resumed.status, 200);
  const skipped = await request(app).post('/api/music/skip').send({ playerId: bob.id });
  assert.equal(skipped.status, 200);

  live = await request(app).get('/api/music/kiosk');
  assert.equal(live.status, 200);
  assert.equal(live.body.session.deviceName, 'LAN Boxen');

  failNextControllerCommand = { type: 'pause', message: 'Player command failed: Restriction violated' };
  const ended = await request(app).post('/api/music/end').send({ playerId: alice.id });
  assert.equal(ended.status, 200);
  assert.match(ended.body.warning, /Spotify konnte/);
  const forbiddenDisconnect = await request(app).delete('/api/music/controller').send({ playerId: bob.id });
  assert.equal(forbiddenDisconnect.status, 403);
  const disconnected = await request(app).delete('/api/music/controller').set('x-admin-mode', '1').send({ playerId: alice.id });
  assert.equal(disconnected.status, 204);
});
