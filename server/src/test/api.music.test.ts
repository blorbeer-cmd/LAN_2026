import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import type { Response as SuperAgentResponse } from 'superagent';
import request from 'supertest';
import { BASE_EVENT_ID, db, DEFAULT_GROUP_ID } from '../db';
import { createTestApp, TEST_ADMIN_ID } from './testApp';
import { expireInactiveMusicControllers, MUSIC_CONTROLLER_RETENTION_MS } from '../musicController';

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
  if (type === 'devices') return { devices: [
    { id: 'speaker-1', name: 'LAN Boxen', type: 'Speaker', active: true },
    { id: 'speaker-2', name: 'LAN Boxen', type: 'Computer', active: false },
    { id: 'other-speaker', name: 'Andere Box', type: 'Speaker', active: false },
  ] };
  if (type === 'search') return { tracks: Object.values(tracks), playlists: [playlist] };
  if (type === 'track') return tracks[payload.trackId as keyof typeof tracks] ?? null;
  if (type === 'playlist') return payload.playlistId === playlist.id ? playlist : null;
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
  assert.equal(MUSIC_CONTROLLER_RETENTION_MS, 24 * 60 * 60 * 1000);
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

  const idleHeartbeat = await request(app).post('/api/music/controller/heartbeat').set('x-music-controller-token', controllerToken).send({
    playback: null,
    connectionStatus: { spotify: 'connected', message: null },
  });
  assert.equal(idleHeartbeat.body.sessionActive, false, 'without a Jam the controller may poll Spotify rarely');
  const status = await request(app).get('/api/music/status');
  assert.equal(status.status, 200);
  assert.deepEqual(status.body.controller.label, 'LAN Pi');
  assert.equal(status.body.controller.spotifyDisplayName, 'LAN DJ');
  assert.equal(status.body.controller.online, true);
  assert.ok(status.body.controller.autoDisconnectAt > Date.now());
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
  assert.deepEqual(expireInactiveMusicControllers(), [], 'automatic cleanup preserves a controller with an active Jam');
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

  // Pasted Spotify links resolve to exactly the linked track or playlist.
  for (const link of [
    `https://open.spotify.com/intl-de/track/${tracks.BBBBBBBBBBBBBBBBBBBBBB.id}?si=0123456789abcdef`,
    `open.spotify.com/track/${tracks.BBBBBBBBBBBBBBBBBBBBBB.id}`,
    tracks.BBBBBBBBBBBBBBBBBBBBBB.uri,
  ]) {
    const linked = await request(app).get(`/api/music/search?q=${encodeURIComponent(link)}`);
    assert.equal(linked.status, 200, link);
    assert.deepEqual(linked.body, { tracks: [tracks.BBBBBBBBBBBBBBBBBBBBBB], playlists: [] }, link);
  }
  const linkedPlaylist = await request(app)
    .get(`/api/music/search?q=${encodeURIComponent(`https://open.spotify.com/playlist/${playlist.id}?si=abc`)}`);
  assert.deepEqual(linkedPlaylist.body, { tracks: [], playlists: [playlist] });
  for (const link of ['https://open.spotify.com/album/DDDDDDDDDDDDDDDDDDDDDD', 'https://spotify.link/abc123', 'spotify:track:short']) {
    const rejected = await request(app).get(`/api/music/search?q=${encodeURIComponent(link)}`);
    assert.equal(rejected.status, 400, link);
  }

  // A song nobody requested (Spotify autoplay) is paused while the queue is
  // empty and never shown as the Jam's current song.
  const pausesBeforeAutoplay = controllerCommands.filter((command) => command.type === 'pause').length;
  await request(app).post('/api/music/controller/heartbeat').set('x-music-controller-token', controllerToken).send({
    playback: { track: tracks.CCCCCCCCCCCCCCCCCCCCCC, deviceId: 'speaker-1', context: null, isPlaying: true, progressMs: 500 },
  });
  const autoplayStatus = await request(app).get('/api/music/status');
  assert.equal(autoplayStatus.body.session.currentTrack, null);
  // Wait for the state "the controller received the pause", bounded so a
  // missing pause fails the assertion below instead of hanging.
  const pauseDeadline = Date.now() + 5_000;
  while (controllerCommands.filter((command) => command.type === 'pause').length === pausesBeforeAutoplay && Date.now() < pauseDeadline) {
    await new Promise((resolve) => setImmediate(resolve));
  }
  const autoplayPause = controllerCommands.filter((command) => command.type === 'pause').at(-1);
  assert.deepEqual(autoplayPause?.payload, { deviceId: 'speaker-1' }, 'autoplay on the Jam device is paused');

  const invalidPlaylist = await request(app).post('/api/music/playlists/not-an-id/play').send({ playerId: bob.id });
  assert.equal(invalidPlaylist.status, 400);
  const unknownPlaylist = await request(app)
    .post('/api/music/playlists/EEEEEEEEEEEEEEEEEEEEEE/play')
    .send({ playerId: bob.id });
  assert.equal(unknownPlaylist.status, 404);

  const trackLookupsBeforeRequests = controllerCommands.filter((command) => command.type === 'track').length;
  const first = await request(app).post('/api/music/requests').send({ playerId: bob.id, trackId: tracks.AAAAAAAAAAAAAAAAAAAAAA.id });
  const second = await request(app).post('/api/music/requests').send({ playerId: bob.id, trackId: tracks.BBBBBBBBBBBBBBBBBBBBBB.id });
  const third = await request(app).post('/api/music/requests').send({ playerId: alice.id, trackId: tracks.CCCCCCCCCCCCCCCCCCCCCC.id });
  assert.equal(controllerCommands.filter((command) => command.type === 'track').length, trackLookupsBeforeRequests,
    'song wishes from search results need no extra Spotify lookup');
  const unknownTrack = await request(app).post('/api/music/requests').send({ playerId: bob.id, trackId: 'ZZZZZZZZZZZZZZZZZZZZZZ' });
  assert.equal(unknownTrack.status, 404, 'a song outside the search results is still looked up at Spotify');
  assert.equal(controllerCommands.filter((command) => command.type === 'track').length, trackLookupsBeforeRequests + 1);
  assert.equal(first.status, 201);
  assert.equal(second.status, 201);
  assert.equal(third.status, 201);

  const activeHeartbeat = await request(app).post('/api/music/controller/heartbeat').set('x-music-controller-token', controllerToken).send({
    connectionStatus: { spotify: 'unavailable', message: 'Spotify ist vorübergehend nicht erreichbar.' },
  });
  assert.equal(activeHeartbeat.body.sessionActive, true, 'a running Jam needs live Spotify playback');
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

  // The same song may wait twice. When it starts again from the beginning,
  // the second copy takes over instead of the finished one staying "playing".
  const firstCopy = await request(app).post('/api/music/requests').send({ playerId: bob.id, trackId: tracks.CCCCCCCCCCCCCCCCCCCCCC.id });
  const secondCopy = await request(app).post('/api/music/requests').send({ playerId: alice.id, trackId: tracks.CCCCCCCCCCCCCCCCCCCCCC.id });
  assert.deepEqual([firstCopy.status, secondCopy.status], [201, 201], 'a song can be requested twice');
  const statusOf = async () => Object.fromEntries(
    ((await request(app).get('/api/music/status')).body.session.requests as Array<{ id: string; status: string }>)
      .map((entry) => [entry.id, entry.status]),
  );
  const copyHeartbeat = (progressMs: number) => request(app)
    .post('/api/music/controller/heartbeat')
    .set('x-music-controller-token', controllerToken)
    .send({ playback: { track: tracks.CCCCCCCCCCCCCCCCCCCCCC, deviceId: 'speaker-1', context: null, isPlaying: true, progressMs } });
  await copyHeartbeat(150_000);
  assert.deepEqual(await statusOf(), { [firstCopy.body.requestId]: 'playing', [secondCopy.body.requestId]: 'queued' });
  await copyHeartbeat(150_500);
  assert.deepEqual(await statusOf(), { [firstCopy.body.requestId]: 'playing', [secondCopy.body.requestId]: 'queued' },
    'regular progress of the same song does not start the second copy');
  await copyHeartbeat(1_000);
  assert.deepEqual(await statusOf(), { [secondCopy.body.requestId]: 'playing' },
    'the song starting again plays the second copy and finishes the first');

  // Commands a heartbeat issues are not awaited by its response: wait for the
  // state "the controller received them", bounded so a missing command fails
  // the assertion after it instead of hanging.
  const commandsOf = (type: string) => controllerCommands.filter((command) => command.type === type);
  const waitForCommands = async (type: string, count: number) => {
    const deadline = Date.now() + 5_000;
    while (commandsOf(type).length < count && Date.now() < deadline) await new Promise((resolve) => setImmediate(resolve));
  };

  // Spotify's repeat starts the last request again after its end. Without a
  // waiting copy that replay is foreign: the request counts as played and the
  // Jam pauses instead of looping it.
  const pausesBeforeRepeat = commandsOf('pause').length;
  await copyHeartbeat(205_000);
  await copyHeartbeat(1_000);
  assert.deepEqual(await statusOf(), {}, 'a repeated last request counts as played');
  assert.equal((await request(app).get('/api/music/status')).body.session.currentTrack, null);
  await waitForCommands('pause', pausesBeforeRepeat + 1);
  assert.deepEqual(commandsOf('pause').at(-1)?.payload, { deviceId: 'speaker-1' }, 'a repeated last request is paused');

  // A song change plans the switch at the end of the new request, not only a
  // queue change: the last of several requests ends with the planned pause.
  const runFirst = await request(app).post('/api/music/requests').send({ playerId: bob.id, trackId: tracks.AAAAAAAAAAAAAAAAAAAAAA.id });
  const runLast = await request(app).post('/api/music/requests').send({ playerId: alice.id, trackId: tracks.BBBBBBBBBBBBBBBBBBBBBB.id });
  assert.deepEqual([runFirst.status, runLast.status], [201, 201]);
  const schedulesBeforeSongChange = commandsOf('scheduleQueue').length;
  await request(app).post('/api/music/controller/heartbeat').set('x-music-controller-token', controllerToken).send({
    playback: { track: tracks.BBBBBBBBBBBBBBBBBBBBBB, deviceId: 'speaker-1', context: null, isPlaying: true, progressMs: 2_000 },
  });
  assert.deepEqual(await statusOf(), { [runLast.body.requestId]: 'playing' });
  await waitForCommands('scheduleQueue', schedulesBeforeSongChange + 1);
  assert.deepEqual(commandsOf('scheduleQueue').at(-1)?.payload,
    { deviceId: 'speaker-1', uris: [], delayMs: tracks.BBBBBBBBBBBBBBBBBBBBBB.durationMs - 2_000 - 250 },
    'the song change plans the pause at the end of the last request');

  // After the planned pause the Jam is idle: the next request starts at once
  // instead of waiting behind the paused, finished song.
  await request(app).post('/api/music/controller/heartbeat').set('x-music-controller-token', controllerToken).send({
    playback: {
      track: tracks.BBBBBBBBBBBBBBBBBBBBBB, deviceId: 'speaker-1', context: null, isPlaying: false,
      progressMs: tracks.BBBBBBBBBBBBBBBBBBBBBB.durationMs - 250,
    },
  });
  assert.deepEqual(await statusOf(), {}, 'the request paused at its end counts as played');
  assert.equal((await request(app).get('/api/music/status')).body.session.currentTrack, null);
  const afterEnd = await request(app).post('/api/music/requests').send({ playerId: bob.id, trackId: tracks.CCCCCCCCCCCCCCCCCCCCCC.id });
  assert.equal(afterEnd.status, 201);
  assert.deepEqual(commandsOf('playUris').at(-1)?.payload,
    { deviceId: 'speaker-1', uris: [tracks.CCCCCCCCCCCCCCCCCCCCCC.uri] }, 'the next request starts at once');

  const playedPlaylist = await request(app)
    .post(`/api/music/playlists/${playlist.id}/play`)
    .send({ playerId: bob.id });
  assert.equal(playedPlaylist.status, 200);
  assert.deepEqual(playedPlaylist.body.playlist, playlist);
  assert.ok(controllerCommands.some((command) => command.type === 'playContext' && command.payload.uri === playlist.uri));
  const pausesBeforePlaylist = controllerCommands.filter((command) => command.type === 'pause').length;

  await request(app)
    .post('/api/music/controller/heartbeat')
    .set('x-music-controller-token', controllerToken)
    .send({
      playback: {
        track: tracks.AAAAAAAAAAAAAAAAAAAAAA,
        deviceId: 'speaker-1',
        context: { type: 'playlist', uri: playlist.uri },
        nextTrack: tracks.BBBBBBBBBBBBBBBBBBBBBB,
        upcomingTracks: [tracks.BBBBBBBBBBBBBBBBBBBBBB, tracks.CCCCCCCCCCCCCCCCCCCCCC],
        isPlaying: true,
        progressMs: 1_500,
      },
    });
  live = await request(app).get('/api/music/status').set('x-test-player-id', alice.id);
  assert.deepEqual(live.body.session.playbackContext, {
    ...playlist,
    addedByName: 'Music Bob',
    remainingTrackCount: 41,
    nextTrack: tracks.BBBBBBBBBBBBBBBBBBBBBB,
    upcomingTracks: [tracks.BBBBBBBBBBBBBBBBBBBBBB, tracks.CCCCCCCCCCCCCCCCCCCCCC],
  }, 'the next songs of the playlist are listed');
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
        nextTrack: tracks.CCCCCCCCCCCCCCCCCCCCCC,
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
  const forbiddenPlaylistReorder = await request(app)
    .put('/api/music/requests/order')
    .send({ playerId: bob.id, requestIds: [playlistRequestId] });
  assert.equal(forbiddenPlaylistReorder.status, 409, 'Spotify keeps its own order during a playlist');
  const playlistRequestRemoval = await request(app)
    .delete(`/api/music/requests/${playlistRequestId}`)
    .send({ playerId: bob.id });
  assert.equal(playlistRequestRemoval.status, 204, 'a request can be removed while a playlist runs');
  live = await request(app).get('/api/music/status').set('x-test-player-id', alice.id);
  assert.equal(live.body.session.requests.length, 0);
  await request(app)
    .post('/api/music/controller/heartbeat')
    .set('x-music-controller-token', controllerToken)
    .send({
      playback: {
        track: tracks.BBBBBBBBBBBBBBBBBBBBBB,
        deviceId: 'speaker-1',
        context: { type: 'playlist', uri: playlist.uri },
        nextTrack: tracks.CCCCCCCCCCCCCCCCCCCCCC,
        upcomingTracks: [tracks.CCCCCCCCCCCCCCCCCCCCCC, tracks.AAAAAAAAAAAAAAAAAAAAAA],
        isPlaying: true,
        progressMs: 4_000,
      },
    });
  live = await request(app).get('/api/music/status').set('x-test-player-id', alice.id);
  assert.deepEqual(live.body.session.playbackContext.upcomingTracks, [tracks.AAAAAAAAAAAAAAAAAAAAAA],
    'a removed request still in Spotify\'s queue is not shown as coming next');
  assert.deepEqual(live.body.session.playbackContext.nextTrack, tracks.AAAAAAAAAAAAAAAAAAAAAA);
  const nextsBeforeRemovedRequest = controllerCommands.filter((command) => command.type === 'next').length;
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
    'a removed request does not reduce the remaining playlist tracks');
  assert.equal(live.body.session.currentTrack, null, 'the removed request is not shown as playing');
  const skippedPlaylistTrack = await request(app).post('/api/music/skip').send({ playerId: bob.id });
  assert.equal(skippedPlaylistTrack.status, 200);
  // The controller handles commands in order, so the answered `next` of the
  // skip proves the heartbeat's `next` for the removed request ran before it,
  // and that no pause was queued for the playlist songs reported before it.
  assert.equal(controllerCommands.filter((command) => command.type === 'next').length, nextsBeforeRemovedRequest + 2,
    'a request removed during a playlist is skipped as soon as Spotify starts it');
  assert.equal(controllerCommands.filter((command) => command.type === 'pause').length, pausesBeforePlaylist,
    'songs of a playlist started from Respawn are never paused as foreign');

  const playlistRemovals = await Promise.all([
    request(app).delete('/api/music/playlist').send({ playerId: bob.id }),
    request(app).delete('/api/music/playlist').send({ playerId: alice.id }),
  ]);
  assert.deepEqual(playlistRemovals.map((response) => response.status).sort(), [204, 409],
    'exactly one of two parallel removals takes the playlist out of the queue');
  live = await request(app).get('/api/music/status').set('x-test-player-id', alice.id);
  assert.equal(live.body.session.playbackContext, null, 'the removed playlist no longer appears as next');
  assert.equal(controllerCommands.filter((command) => command.type === 'pause').length, pausesBeforePlaylist + 1,
    'without waiting requests the Jam pauses instead of continuing the playlist');
  await request(app)
    .post('/api/music/controller/heartbeat')
    .set('x-music-controller-token', controllerToken)
    .send({
      playback: {
        track: tracks.AAAAAAAAAAAAAAAAAAAAAA,
        deviceId: 'speaker-1',
        context: { type: 'playlist', uri: playlist.uri },
        isPlaying: true,
        progressMs: 500,
      },
    });
  live = await request(app).get('/api/music/status').set('x-test-player-id', alice.id);
  assert.equal(live.body.session.currentTrack, null, 'Spotify continuing a removed playlist is foreign playback');
  const pausedAfterRemoval = await request(app).post('/api/music/playback').send({ playerId: bob.id, playing: false });
  assert.equal(pausedAfterRemoval.status, 200);
  // Ordered like the skip above: the awaited pause proves the heartbeat's own
  // pause for the continued playlist was issued first.
  assert.equal(controllerCommands.filter((command) => command.type === 'pause').length, pausesBeforePlaylist + 3);
  const noPlaylistLeft = await request(app).delete('/api/music/playlist').send({ playerId: bob.id });
  assert.equal(noPlaylistLeft.status, 409);

  // Song wishes made during a playlist wait behind it; ending the playlist
  // hands the queue to those wishes instead of pausing.
  const restartedPlaylist = await request(app).post(`/api/music/playlists/${playlist.id}/play`).send({ playerId: bob.id });
  assert.equal(restartedPlaylist.status, 200);
  const wishBehindPlaylist = await request(app).post('/api/music/requests')
    .send({ playerId: alice.id, trackId: tracks.AAAAAAAAAAAAAAAAAAAAAA.id });
  assert.equal(wishBehindPlaylist.status, 201);
  const endedWithWish = await request(app).delete('/api/music/playlist').send({ playerId: alice.id });
  assert.equal(endedWithWish.status, 204);
  live = await request(app).get('/api/music/status').set('x-test-player-id', alice.id);
  assert.equal(live.body.session.playbackContext, null);
  assert.equal(live.body.session.currentTrack?.uri, tracks.AAAAAAAAAAAAAAAAAAAAAA.uri,
    'the wish waiting behind the ended playlist plays next');
  assert.deepEqual(live.body.session.requests.map((entry: { id: string; status: string }) => [entry.id, entry.status]),
    [[wishBehindPlaylist.body.requestId, 'playing']]);
  assert.deepEqual(controllerCommands.filter((command) => command.type === 'playUris').at(-1)?.payload?.uris,
    [tracks.AAAAAAAAAAAAAAAAAAAAAA.uri]);

  live = await request(app).get('/api/music/kiosk');
  assert.equal(live.status, 200);
  assert.equal(live.body.session.deviceName, 'LAN Boxen');

  const rejectedDeviceRecovery = await request(app)
    .patch('/api/music/sessions/device')
    .send({ deviceId: 'other-speaker' });
  assert.equal(rejectedDeviceRecovery.status, 409);
  assert.match(rejectedDeviceRecovery.body.error, /bisherige Browser-Musikgerät/);

  const recoveredDevice = await request(app)
    .patch('/api/music/sessions/device')
    .send({ deviceId: 'speaker-2' });
  assert.equal(recoveredDevice.status, 200);
  assert.equal(recoveredDevice.body.id, started.body.id);
  assert.equal(recoveredDevice.body.deviceId, 'speaker-2');
  assert.ok(controllerCommands.some((command) => command.type === 'transfer' && command.payload.deviceId === 'speaker-2'));

  db.prepare('UPDATE music_sessions SET device_id = ? WHERE id = ?').run('speaker-1', started.body.id);
  const transferCountBeforeRace = controllerCommands.filter((command) => command.type === 'transfer').length;
  const concurrentRecoveries = await Promise.all([
    request(app).patch('/api/music/sessions/device').send({ deviceId: 'speaker-2' }),
    request(app).patch('/api/music/sessions/device').send({ deviceId: 'speaker-2' }),
  ]);
  assert.deepEqual(concurrentRecoveries.map((response) => response.status).sort(), [200, 409]);
  assert.equal(
    controllerCommands.filter((command) => command.type === 'transfer').length,
    transferCountBeforeRace + 1,
    'concurrent recovery requests issue exactly one Spotify transfer',
  );

  failNextControllerCommand = { type: 'pause', message: 'Player command failed: Restriction violated' };
  db.prepare("UPDATE group_memberships SET role = 'admin' WHERE group_id = ? AND player_id = ?")
    .run(DEFAULT_GROUP_ID, alice.id);
  const ended = await request(app).post('/api/music/end').send({ playerId: alice.id });
  assert.equal(ended.status, 200);
  assert.match(ended.body.warning, /Spotify konnte/);
  const forbiddenDisconnect = await request(app).delete('/api/music/controller').send({ playerId: bob.id });
  assert.equal(forbiddenDisconnect.status, 403);
  const disconnected = await request(app).delete('/api/music/controller').send({ playerId: alice.id });
  assert.equal(disconnected.status, 204);

  const pairingAfterDisconnect = await request(app).post('/api/music/pairing').send({});
  assert.equal(pairingAfterDisconnect.status, 200, 'disconnecting permits a new code without downloading another package');
  const repairedWithoutDownload = await request(app).post('/api/music/controller/register').send({
    pairingCode: pairingAfterDisconnect.body.code,
    label: 'LAN Pi',
    spotifyDisplayName: 'LAN DJ',
  });
  assert.equal(repairedWithoutDownload.status, 201);
  db.prepare('UPDATE music_controllers SET last_seen = ? WHERE group_id = ?')
    .run(Date.now() - MUSIC_CONTROLLER_RETENTION_MS - 1, DEFAULT_GROUP_ID);
  assert.deepEqual(expireInactiveMusicControllers(), [DEFAULT_GROUP_ID]);
  const expiredStatus = await request(app).get('/api/music/status');
  assert.equal(expiredStatus.body.controller, null, 'an unused controller is removed after 30 days without a heartbeat');
});

test('ending an event releases a Jam session still marked active for it', async () => {
  const now = Date.now();
  const eventA = `music-end-a-${now}`;
  const eventB = `music-end-b-${now}`;
  for (const [id, name] of [[eventA, 'Music End A'], [eventB, 'Music End B']] as const) {
    db.prepare(
      `INSERT INTO events (id, name, starts_at, ends_at, group_id, status, visibility_scope)
       VALUES (?, ?, ?, ?, ?, 'published', 'participants')`,
    ).run(id, name, now - 1_000, now + 60_000, DEFAULT_GROUP_ID);
    db.prepare("INSERT INTO event_participants (event_id, player_id, status) VALUES (?, ?, 'accepted')").run(id, TEST_ADMIN_ID);
  }
  db.prepare('UPDATE player_event_contexts SET active_event_id = ?, updated_at = ? WHERE player_id = ?').run(eventA, now, TEST_ADMIN_ID);

  const pairing = await request(app).post('/api/music/pairing').send({});
  assert.equal(pairing.status, 200);
  const registered = await request(app).post('/api/music/controller/register').send({
    pairingCode: pairing.body.code, label: 'Endcheck Pi', spotifyDisplayName: 'Endcheck DJ',
  });
  assert.equal(registered.status, 201);
  const token = registered.body.controllerToken;
  await request(app).post('/api/music/controller/heartbeat').set('x-music-controller-token', token).send({
    playback: null,
    connectionStatus: { spotify: 'connected', message: null },
  });

  let busy = false;
  const loop = setInterval(async () => {
    if (busy) return;
    busy = true;
    try {
      const polled = await request(app).get('/api/music/controller/commands').set('x-music-controller-token', token);
      const command = polled.body.command;
      if (command) {
        await request(app)
          .post(`/api/music/controller/commands/${command.id}/result`)
          .set('x-music-controller-token', token)
          .send({ ok: true, data: controllerData(command.type, command.payload || {}) });
      }
    } finally {
      busy = false;
    }
  }, 5);

  try {
    const started = await request(app).post('/api/music/sessions').send({ deviceId: 'speaker-1' });
    assert.equal(started.status, 201);

    db.prepare('UPDATE player_event_contexts SET active_event_id = ?, updated_at = ? WHERE player_id = ?')
      .run(eventB, Date.now(), TEST_ADMIN_ID);
    const blocked = await request(app).post('/api/music/sessions').send({ deviceId: 'speaker-1' });
    assert.equal(blocked.status, 409);
    assert.match(blocked.body.error, /anderen Event/);

    const ended = await request(app).post(`/api/events/${eventA}/end`).send({});
    assert.equal(ended.status, 200);

    const sessionRow = db.prepare('SELECT status, ended_at FROM music_sessions WHERE id = ?').get(started.body.id) as
      { status: string; ended_at: number | null };
    assert.equal(sessionRow.status, 'ended', 'ending the event auto-ends its still-active Jam session');
    assert.ok(sessionRow.ended_at);

    const restarted = await request(app).post('/api/music/sessions').send({ deviceId: 'speaker-1' });
    assert.equal(restarted.status, 201, 'a different event can now start its own Jam');
  } finally {
    clearInterval(loop);
  }
});

test('an event ending while its own Jam is still starting does not leave an orphaned session', async () => {
  // The previous test deliberately leaves its second session ("restarted")
  // active to prove a different event can hold its own Jam. Clear that
  // leftover group state so pairing a fresh controller here starts clean.
  db.prepare('DELETE FROM music_sessions WHERE group_id = ?').run(DEFAULT_GROUP_ID);
  db.prepare('DELETE FROM music_controllers WHERE group_id = ?').run(DEFAULT_GROUP_ID);
  const now = Date.now();
  const eventId = `music-race-${now}`;
  db.prepare(
    `INSERT INTO events (id, name, starts_at, ends_at, group_id, status, visibility_scope)
     VALUES (?, 'Music Race Event', ?, ?, ?, 'published', 'participants')`,
  ).run(eventId, now - 1_000, now + 60_000, DEFAULT_GROUP_ID);
  db.prepare("INSERT INTO event_participants (event_id, player_id, status) VALUES (?, ?, 'accepted')").run(eventId, TEST_ADMIN_ID);
  db.prepare('UPDATE player_event_contexts SET active_event_id = ?, updated_at = ? WHERE player_id = ?').run(eventId, now, TEST_ADMIN_ID);

  const pairing = await request(app).post('/api/music/pairing').send({});
  assert.equal(pairing.status, 200);
  const registered = await request(app).post('/api/music/controller/register').send({
    pairingCode: pairing.body.code, label: 'Race Pi', spotifyDisplayName: 'Race DJ',
  });
  assert.equal(registered.status, 201);
  const token = registered.body.controllerToken;
  await request(app).post('/api/music/controller/heartbeat').set('x-music-controller-token', token).send({
    playback: null,
    connectionStatus: { spotify: 'connected', message: null },
  });

  // Kick off session creation but do not answer its "devices" controller
  // command yet, so it stays suspended on the await in POST /sessions.
  // supertest/superagent requests dispatch lazily on the first `.then()`, so
  // attach one immediately — otherwise nothing is sent until this promise is
  // finally awaited below, by which point the race window has already closed.
  const startPromise = request(app).post('/api/music/sessions').send({ deviceId: 'speaker-1' });
  startPromise.catch(() => { /* handled via the final await below */ });

  let command: { id: string; type: string; payload: Record<string, unknown> } | null = null;
  for (let attempt = 0; attempt < 200 && !command; attempt += 1) {
    const polled = await request(app).get('/api/music/controller/commands').set('x-music-controller-token', token);
    command = polled.body.command;
    if (!command) await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.ok(command, 'the devices command was queued for the suspended session request');
  assert.equal(command!.type, 'devices');

  // While the request is still suspended, the event it targets ends.
  const ended = await request(app).post(`/api/events/${eventId}/end`).send({});
  assert.equal(ended.status, 200);

  // Only now does the controller answer the still-pending command.
  await request(app)
    .post(`/api/music/controller/commands/${command!.id}/result`)
    .set('x-music-controller-token', token)
    .send({ ok: true, data: controllerData('devices', {}) });

  const started = await startPromise;
  assert.equal(started.status, 409, 'a session must not be created for an event that ended while the request was suspended');
  assert.match(started.body.error, /beendet|anderer Jam/);

  const orphaned = db.prepare("SELECT id FROM music_sessions WHERE event_id = ? AND status = 'active'").get(eventId);
  assert.equal(orphaned, undefined, 'no active session was left behind for the ended event');
});
