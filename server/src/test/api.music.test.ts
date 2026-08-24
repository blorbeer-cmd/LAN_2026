import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import type { Response as SuperAgentResponse } from 'superagent';
import request from 'supertest';
import { BASE_EVENT_ID, db, DEFAULT_GROUP_ID } from '../db';
import { createTestApp } from './testApp';

const app = createTestApp();
let controllerToken = '';
let controllerLoop: ReturnType<typeof setInterval> | undefined;
let controllerBusy = false;
let failNextControllerCommand: { type: string; message: string } | null = null;
const controllerCommands: Array<{ type: string; payload: Record<string, unknown> }> = [];

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

const playlist = {
  id: 'DDDDDDDDDDDDDDDDDDDDDD',
  uri: 'spotify:playlist:DDDDDDDDDDDDDDDDDDDDDD',
  name: 'LAN Playlist',
  owner: 'Respawn DJ',
  imageUrl: 'https://image.example/playlist.jpg',
  trackCount: 42,
};

function controllerData(type: string, payload: Record<string, unknown>) {
  if (type === 'devices') return { devices: [{ id: 'speaker-1', name: 'LAN Boxen', type: 'Speaker', active: true }] };
  if (type === 'search') return { tracks: Object.values(tracks), playlists: [playlist] };
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
        controllerCommands.push({ type: command.type, payload: command.payload || {} });
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

  const pairing = await request(app).post('/api/music/pairing').send({});
  assert.equal(pairing.status, 200);
  assert.match(pairing.body.code, /^[A-Z0-9]+$/);
  assert.equal(pairing.body.controllerUrl, 'http://127.0.0.1:43821');

  const controllerPackage = await request(app)
    .post('/api/music/controller-package')
    .send({ pairingCode: pairing.body.code })
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

  await request(app).post('/api/music/controller/heartbeat').set('x-music-controller-token', controllerToken).send({
    playback: null,
    connectionStatus: { spotify: 'connected', message: null },
  });
  const status = await request(app).get('/api/music/status');
  assert.equal(status.status, 200);
  assert.deepEqual(status.body.controller.label, 'LAN Pi');
  assert.equal(status.body.controller.spotifyDisplayName, 'LAN DJ');
  assert.equal(status.body.controller.online, true);
  assert.deepEqual(status.body.controller.connectionStatus, { spotify: 'connected', message: null });
  assert.equal(status.body.canManageController, true);
  assert.equal(JSON.stringify(status.body).includes(controllerToken), false);
  assert.equal(JSON.stringify(status.body).toLowerCase().includes('spotifyclient'), false);
  const memberStatus = await request(app).get('/api/music/status').set('x-test-player-id', bob.id);
  assert.equal(memberStatus.body.canManageController, false);

  startControllerLoop();

  const devices = await request(app).get('/api/music/devices');
  assert.equal(devices.status, 200);
  assert.equal(devices.body.devices[0].name, 'LAN Boxen');

  const started = await request(app).post('/api/music/sessions').send({ deviceId: 'speaker-1' });
  assert.equal(started.status, 201);
  assert.equal(started.body.deviceName, 'LAN Boxen');

  const otherEventId = `music-other-${Date.now()}`;
  const now = Date.now();
  db.prepare(
    `INSERT INTO events
       (id, name, starts_at, ends_at, group_id, status, visibility_scope)
     VALUES (?, 'Music Other Event', ?, ?, ?, 'published', 'participants')`,
  ).run(otherEventId, now - 1_000, now + 60_000, DEFAULT_GROUP_ID);
  db.prepare("INSERT INTO event_participants (event_id, player_id, status) VALUES (?, ?, 'accepted')").run(otherEventId, alice.id);
  db.prepare('UPDATE player_event_contexts SET active_event_id = ?, updated_at = ? WHERE player_id = ?').run(otherEventId, now, alice.id);
  const crossEventConflict = await request(app)
    .post('/api/music/sessions')
    .send({ playerId: alice.id, deviceId: 'speaker-1' });
  assert.equal(crossEventConflict.status, 409);
  assert.match(crossEventConflict.body.error, /anderen Event/);
  db.prepare('UPDATE player_event_contexts SET active_event_id = ?, updated_at = ? WHERE player_id = ?').run(BASE_EVENT_ID, now, alice.id);

  const oldControllerToken = controllerToken;
  db.prepare('UPDATE music_controllers SET last_seen = 0 WHERE group_id = ?').run('default-group');
  const reconnectPairing = await request(app).post('/api/music/pairing').send({});
  assert.equal(reconnectPairing.status, 200, 'an offline controller can be repaired while its Jam session remains active');
  const reconnected = await request(app).post('/api/music/controller/register').send({
    pairingCode: reconnectPairing.body.code, label: 'LAN Pi', spotifyDisplayName: 'LAN DJ',
  });
  assert.equal(reconnected.status, 201);
  controllerToken = reconnected.body.controllerToken;
  assert.notEqual(controllerToken, oldControllerToken);
  const rejectedOldToken = await request(app)
    .get('/api/music/controller/commands')
    .set('x-music-controller-token', oldControllerToken);
  assert.equal(rejectedOldToken.status, 401);
  await request(app).post('/api/music/controller/heartbeat').set('x-music-controller-token', controllerToken).send({
    connectionStatus: { spotify: 'connected', message: null },
  });
  const reconnectedStatus = await request(app).get('/api/music/status');
  assert.equal(reconnectedStatus.body.session.id, started.body.id, 're-pairing does not discard the running Jam');
  assert.equal(reconnectedStatus.body.controller.online, true);

  const search = await request(app).get('/api/music/search?q=LAN');
  assert.equal(search.status, 200);
  assert.equal(search.body.tracks.length, 3);
  assert.deepEqual(search.body.playlists, [playlist]);

  const invalidPlaylist = await request(app).post('/api/music/playlists/not-an-id/play').send({ playerId: bob.id });
  assert.equal(invalidPlaylist.status, 400);
  const unknownPlaylist = await request(app)
    .post('/api/music/playlists/EEEEEEEEEEEEEEEEEEEEEE/play')
    .send({ playerId: bob.id });
  assert.equal(unknownPlaylist.status, 404);

  const first = await request(app).post('/api/music/requests').send({ playerId: bob.id, trackId: tracks.AAAAAAAAAAAAAAAAAAAAAA.id });
  const second = await request(app).post('/api/music/requests').send({ playerId: bob.id, trackId: tracks.BBBBBBBBBBBBBBBBBBBBBB.id });
  const third = await request(app).post('/api/music/requests').send({ playerId: alice.id, trackId: tracks.CCCCCCCCCCCCCCCCCCCCCC.id });
  assert.equal(first.status, 201);
  assert.equal(second.status, 201);
  assert.equal(third.status, 201);

  await request(app).post('/api/music/controller/heartbeat').set('x-music-controller-token', controllerToken).send({
    connectionStatus: { spotify: 'unavailable', message: 'Spotify ist vorübergehend nicht erreichbar.' },
  });
  const degradedStatus = await request(app).get('/api/music/status');
  assert.equal(degradedStatus.body.controller.online, true, 'Spotify errors do not make the local controller look offline');
  assert.equal(degradedStatus.body.controller.connectionStatus.spotify, 'unavailable');
  assert.equal(degradedStatus.body.session.currentTrack.uri, tracks.AAAAAAAAAAAAAAAAAAAAAA.uri,
    'a heartbeat without a Spotify snapshot preserves the last known playback');

  let live = await request(app).get('/api/music/status').set('x-test-player-id', alice.id);
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

  const playedPlaylist = await request(app)
    .post(`/api/music/playlists/${playlist.id}/play`)
    .send({ playerId: bob.id });
  assert.equal(playedPlaylist.status, 200);
  assert.deepEqual(playedPlaylist.body.playlist, playlist);
  assert.ok(controllerCommands.some((command) => command.type === 'playContext' && command.payload.uri === playlist.uri));

  await request(app)
    .post('/api/music/controller/heartbeat')
    .set('x-music-controller-token', controllerToken)
    .send({
      playback: {
        track: tracks.AAAAAAAAAAAAAAAAAAAAAA,
        deviceId: 'speaker-1',
        context: { type: 'playlist', uri: playlist.uri },
        isPlaying: true,
        progressMs: 1_500,
      },
    });
  live = await request(app).get('/api/music/status').set('x-test-player-id', alice.id);
  assert.deepEqual(live.body.session.playbackContext, { ...playlist, remainingTrackCount: 41 });
  assert.equal(live.body.session.currentTrack.name, 'LAN Anthem');
  assert.equal(live.body.session.requests.length, 0, 'starting a playlist replaces the prior shared queue');

  await request(app)
    .post('/api/music/controller/heartbeat')
    .set('x-music-controller-token', controllerToken)
    .send({
      playback: {
        track: tracks.BBBBBBBBBBBBBBBBBBBBBB,
        deviceId: 'speaker-1',
        context: { type: 'playlist', uri: playlist.uri },
        isPlaying: true,
        progressMs: 2_000,
      },
    });
  live = await request(app).get('/api/music/status').set('x-test-player-id', alice.id);
  assert.equal(live.body.session.playbackContext.remainingTrackCount, 40);

  const playlistRequest = await request(app)
    .post('/api/music/requests')
    .send({ playerId: bob.id, trackId: tracks.CCCCCCCCCCCCCCCCCCCCCC.id });
  assert.equal(playlistRequest.status, 201);
  assert.ok(controllerCommands.some((command) => command.type === 'queueTrack' && command.payload.uri === tracks.CCCCCCCCCCCCCCCCCCCCCC.uri));
  const playlistRequestId = playlistRequest.body.requestId;
  const forbiddenPlaylistRemoval = await request(app)
    .delete(`/api/music/requests/${playlistRequestId}`)
    .send({ playerId: bob.id });
  assert.equal(forbiddenPlaylistRemoval.status, 409);
  const forbiddenPlaylistReorder = await request(app)
    .put('/api/music/requests/order')
    .send({ playerId: bob.id, requestIds: [playlistRequestId] });
  assert.equal(forbiddenPlaylistReorder.status, 409);
  await request(app)
    .post('/api/music/controller/heartbeat')
    .set('x-music-controller-token', controllerToken)
    .send({
      playback: {
        track: tracks.CCCCCCCCCCCCCCCCCCCCCC,
        deviceId: 'speaker-1',
        context: { type: 'playlist', uri: playlist.uri },
        isPlaying: true,
        progressMs: 1_000,
      },
    });
  live = await request(app).get('/api/music/status').set('x-test-player-id', alice.id);
  assert.equal(live.body.session.playbackContext.remainingTrackCount, 40,
    'a queued request does not reduce the remaining playlist tracks');
  const skippedPlaylistTrack = await request(app).post('/api/music/skip').send({ playerId: bob.id });
  assert.equal(skippedPlaylistTrack.status, 200);
  assert.ok(controllerCommands.some((command) => command.type === 'next'));

  live = await request(app).get('/api/music/kiosk');
  assert.equal(live.status, 200);
  assert.equal(live.body.session.deviceName, 'LAN Boxen');

  failNextControllerCommand = { type: 'pause', message: 'Player command failed: Restriction violated' };
  const ended = await request(app).post('/api/music/end').send({});
  assert.equal(ended.status, 200);
  assert.match(ended.body.warning, /Spotify konnte/);
  const forbiddenDisconnect = await request(app).delete('/api/music/controller').send({ playerId: bob.id });
  assert.equal(forbiddenDisconnect.status, 403);
  const disconnected = await request(app).delete('/api/music/controller').send({});
  assert.equal(disconnected.status, 204);

  const pairingAfterDisconnect = await request(app).post('/api/music/pairing').send({});
  assert.equal(pairingAfterDisconnect.status, 200, 'disconnecting permits a new code without downloading another package');
  const repairedWithoutDownload = await request(app).post('/api/music/controller/register').send({
    pairingCode: pairingAfterDisconnect.body.code,
    label: 'LAN Pi',
    spotifyDisplayName: 'LAN DJ',
  });
  assert.equal(repairedWithoutDownload.status, 201);
});
