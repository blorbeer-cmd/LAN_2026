import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'jam-controller.mjs');

async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return server.address().port;
}

async function waitFor(check, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const value = await check();
      if (value) return value;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw lastError || new Error('Bedingung wurde nicht rechtzeitig erfüllt.');
}

test('Jam controller can re-pair in place and stays online when Spotify needs a login', async (t) => {
  const storeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'respawn-jam-controller-'));
  const heartbeats = [];
  let registrations = 0;
  let commandPolls = 0;
  const respawn = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      const token = req.headers['x-music-controller-token'];
      if (req.url === '/api/music/controller/register' && req.method === 'POST') {
        registrations += 1;
        const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        assert.equal(body.pairingCode, 'REPAIR23');
        res.writeHead(201, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ controllerId: 'new-controller', controllerToken: 'new-token', groupId: 'group-1' }));
        return;
      }
      if (token !== 'new-token') {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Jam-Controller ist nicht autorisiert.' }));
        return;
      }
      if (req.url === '/api/music/controller/heartbeat' && req.method === 'POST') {
        heartbeats.push(JSON.parse(Buffer.concat(chunks).toString('utf8')));
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
        return;
      }
      if (req.url === '/api/music/controller/commands' && req.method === 'GET') {
        commandPolls += 1;
        if (commandPolls === 1) return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ command: null }));
    });
  });
  const respawnPort = await listen(respawn);
  const probe = http.createServer();
  const controllerPort = await listen(probe);
  await new Promise((resolve) => probe.close(resolve));

  fs.writeFileSync(path.join(storeDir, 'jam-controller.json'), JSON.stringify({
    respawnBaseUrl: `http://127.0.0.1:${respawnPort}`,
    label: 'LAN-Musik-PC',
    clientId: 'spotify-client',
    controllerId: 'old-controller',
    controllerToken: 'expired-token',
    groupId: 'group-1',
    spotifyDisplayName: 'LAN DJ',
  }));

  let output = '';
  const controller = spawn(process.execPath, [SCRIPT], {
    env: {
      ...process.env,
      JAM_CONTROLLER_PORT: String(controllerPort),
      JAM_CONTROLLER_STORE_DIR: storeDir,
      JAM_CONTROLLER_REQUEST_TIMEOUT_MS: '100',
      JAM_CONTROLLER_NO_OPEN: '1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  controller.stdout.on('data', (chunk) => { output += chunk; });
  controller.stderr.on('data', (chunk) => { output += chunk; });

  t.after(async () => {
    controller.kill('SIGTERM');
    await new Promise((resolve) => respawn.close(resolve));
    fs.rmSync(storeDir, { recursive: true, force: true });
  });

  const localUrl = `http://127.0.0.1:${controllerPort}`;
  await waitFor(async () => (await fetch(localUrl)).ok);
  await waitFor(() => output.includes('nicht autorisiert'));
  const initialResponse = await fetch(localUrl);
  assert.equal(initialResponse.headers.get('x-frame-options'), 'DENY');
  // The Spotify login form is redirected to Spotify; without this source the
  // browser silently drops the submit.
  assert.match(initialResponse.headers.get('content-security-policy'), /form-action 'self' https:\/\/accounts\.spotify\.com;/);
  const initialPage = await initialResponse.text();
  const csrf = initialPage.match(/name="_csrf" value="([^"]+)"/)?.[1];
  assert.ok(csrf);

  const rejectedCrossSitePost = await fetch(`${localUrl}/reconnect`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ pairingCode: 'REPAIR23' }),
  });
  assert.equal(rejectedCrossSitePost.status, 400);
  assert.equal(registrations, 0);

  const repaired = await fetch(`${localUrl}/reconnect`, {
    method: 'POST',
    redirect: 'manual',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      _csrf: csrf,
      respawnBaseUrl: `http://127.0.0.1:${respawnPort}`,
      pairingCode: 'REPAIR23',
      label: 'LAN-Musik-PC',
    }),
  });
  assert.equal(repaired.status, 302);
  await waitFor(() => registrations === 1 && heartbeats.length > 0);
  await waitFor(() => commandPolls >= 2, 2_000);

  const saved = JSON.parse(fs.readFileSync(path.join(storeDir, 'jam-controller.json'), 'utf8'));
  assert.equal(saved.controllerToken, 'new-token');
  assert.equal(saved.controllerId, 'new-controller');
  assert.equal(heartbeats.at(-1).connectionStatus.spotify, 'authorization_required');
  assert.equal(Object.hasOwn(heartbeats.at(-1), 'playback'), false,
    'a missing Spotify snapshot must not clear the server playback state');

  const page = await (await fetch(localUrl)).text();
  assert.match(page, /Spotify-Anmeldung erneuern/);
  assert.doesNotMatch(page, /Controller-Paket erneut/);
  assert.doesNotMatch(page, /\son(?:submit|click)=/, 'the page CSP forbids inline scripts');
});

test('Jam controller blocks foreign browser origins from its scoped Web Playback token', async (t) => {
  const storeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'respawn-jam-web-player-'));
  const probe = http.createServer();
  const controllerPort = await listen(probe);
  await new Promise((resolve) => probe.close(resolve));
  const respawnOrigin = 'https://respawn.example.test';

  fs.writeFileSync(path.join(storeDir, 'jam-controller.json'), JSON.stringify({
    respawnBaseUrl: `${respawnOrigin}/`,
    label: 'TV-Musik-PC',
    clientId: 'spotify-client',
    spotifyDisplayName: 'LAN DJ',
    spotifyScopes: 'user-read-playback-state user-modify-playback-state streaming user-read-email user-read-private',
    accessTokenSpotify: 'short-lived-browser-token',
    refreshToken: 'refresh-token',
    expiresAt: Date.now() + 10 * 60_000,
  }));

  const controller = spawn(process.execPath, [SCRIPT], {
    env: {
      ...process.env,
      JAM_CONTROLLER_PORT: String(controllerPort),
      JAM_CONTROLLER_STORE_DIR: storeDir,
      JAM_CONTROLLER_NO_OPEN: '1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  t.after(() => {
    controller.kill('SIGTERM');
    fs.rmSync(storeDir, { recursive: true, force: true });
  });

  const localUrl = `http://127.0.0.1:${controllerPort}`;
  await waitFor(async () => (await fetch(localUrl)).ok);

  const rejected = await fetch(`${localUrl}/web-player/status`, {
    headers: { Origin: 'https://attacker.example' },
  });
  assert.equal(rejected.status, 403);
  assert.equal(rejected.headers.get('access-control-allow-origin'), null);

  const preflight = await fetch(`${localUrl}/web-player/token`, {
    method: 'OPTIONS',
    headers: {
      Origin: respawnOrigin,
      'Access-Control-Request-Private-Network': 'true',
    },
  });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get('access-control-allow-origin'), respawnOrigin);
  assert.equal(preflight.headers.get('access-control-allow-private-network'), 'true');

  const statusResponse = await fetch(`${localUrl}/web-player/status`, {
    headers: { Origin: respawnOrigin },
  });
  assert.equal(statusResponse.status, 200);
  assert.deepEqual(await statusResponse.json(), {
    available: true,
    ready: true,
    playerName: 'Respawn · TV-Musik-PC',
    message: null,
  });

  const tokenResponse = await fetch(`${localUrl}/web-player/token`, {
    headers: { Origin: respawnOrigin },
  });
  assert.equal(tokenResponse.status, 200);
  assert.equal(tokenResponse.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await tokenResponse.json(), { accessToken: 'short-lived-browser-token' });
});

test('Jam controller reports playback before a slow queue and reconnects after Spotify outages', async (t) => {
  const storeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'respawn-jam-heartbeat-'));
  const heartbeats = [];
  const commandResults = [];
  let nextCommand = null;
  let playerRequests = 0;
  let trackRequests = 0;
  let heartbeatCountAtQueueStart = null;
  const respawn = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      if (req.url === '/api/music/controller/heartbeat' && req.method === 'POST') {
        heartbeats.push(JSON.parse(Buffer.concat(chunks).toString('utf8')));
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
        return;
      }
      if (req.url === '/api/music/controller/commands' && req.method === 'GET') {
        const command = nextCommand;
        nextCommand = null;
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ command }));
        return;
      }
      if (req.url === '/api/music/controller/commands/command-1/result' && req.method === 'POST') {
        commandResults.push(JSON.parse(Buffer.concat(chunks).toString('utf8')));
        res.writeHead(204).end();
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ command: null }));
    });
  });
  const spotify = http.createServer((req, res) => {
    if (req.url === '/v1/me/player/queue') {
      heartbeatCountAtQueueStart = heartbeats.length;
      setTimeout(() => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ queue: [] }));
      }, 400);
      return;
    }
    if (req.url === '/v1/me/player') {
      playerRequests += 1;
      if (playerRequests > 1 && playerRequests < 8) {
        res.writeHead(503, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message: 'temporarily unavailable' } }));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        item: {
          id: 'track-1',
          uri: 'spotify:track:track-1',
          name: 'Test title',
          duration_ms: 180_000,
          artists: [{ name: 'Test artist' }],
          album: { name: 'Test album', images: [] },
        },
        device: { id: 'device-1' },
        context: { type: 'playlist', uri: 'spotify:playlist:playlist-1' },
        is_playing: true,
        progress_ms: 12_000,
      }));
      return;
    }
    if (req.url === '/v1/tracks/0123456789012345678901') {
      trackRequests += 1;
      if (trackRequests === 1) {
        res.writeHead(503, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message: 'temporary command failure' } }));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        id: '0123456789012345678901',
        uri: 'spotify:track:0123456789012345678901',
        name: 'Recovered title',
        duration_ms: 180_000,
        artists: [{ name: 'Recovered artist' }],
        album: { name: 'Recovered album', images: [] },
      }));
      return;
    }
    res.writeHead(404).end();
  });
  const respawnPort = await listen(respawn);
  const spotifyPort = await listen(spotify);
  const probe = http.createServer();
  const controllerPort = await listen(probe);
  await new Promise((resolve) => probe.close(resolve));

  fs.writeFileSync(path.join(storeDir, 'jam-controller.json'), JSON.stringify({
    respawnBaseUrl: `http://127.0.0.1:${respawnPort}`,
    label: 'LAN-Musik-PC',
    clientId: 'spotify-client',
    controllerId: 'controller-1',
    controllerToken: 'controller-token',
    groupId: 'group-1',
    spotifyDisplayName: 'LAN DJ',
    accessTokenSpotify: 'spotify-token',
    refreshToken: 'refresh-token',
    expiresAt: Date.now() + 10 * 60_000,
  }));

  const controller = spawn(process.execPath, [SCRIPT], {
    env: {
      ...process.env,
      JAM_CONTROLLER_PORT: String(controllerPort),
      JAM_CONTROLLER_STORE_DIR: storeDir,
      JAM_CONTROLLER_REQUEST_TIMEOUT_MS: '1000',
      JAM_CONTROLLER_SPOTIFY_API_BASE_URL: `http://127.0.0.1:${spotifyPort}/v1`,
      JAM_CONTROLLER_SPOTIFY_STATUS_GRACE_MS: '700',
      JAM_CONTROLLER_SPOTIFY_ACTIVE_STATUS_INTERVAL_MS: '100',
      JAM_CONTROLLER_HEARTBEAT_INTERVAL_MS: '100',
      JAM_CONTROLLER_NO_OPEN: '1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  t.after(async () => {
    controller.kill('SIGTERM');
    await Promise.all([
      new Promise((resolve) => respawn.close(resolve)),
      new Promise((resolve) => spotify.close(resolve)),
    ]);
    fs.rmSync(storeDir, { recursive: true, force: true });
  });

  await waitFor(() => heartbeatCountAtQueueStart !== null);
  assert.equal(heartbeatCountAtQueueStart, 1,
    'the current playback heartbeat must not wait for Spotify queue enrichment');
  assert.equal(heartbeats[0].connectionStatus.spotify, 'connected');
  assert.equal(heartbeats[0].playback.track.uri, 'spotify:track:track-1');

  await waitFor(() => heartbeats.find((heartbeat, index) => index > 0
    && heartbeat.connectionStatus.spotify === 'connected'
    && !Object.hasOwn(heartbeat, 'playback')));
  const unavailable = await waitFor(() => {
    const index = heartbeats.findIndex((heartbeat) => heartbeat.connectionStatus.spotify === 'unavailable');
    return index >= 0 ? index : null;
  });
  await waitFor(() => heartbeats.slice(unavailable + 1).find(
    (heartbeat) => heartbeat.connectionStatus.spotify === 'connected'
      && heartbeat.playback?.track?.uri === 'spotify:track:track-1',
  ));

  nextCommand = {
    id: 'command-1',
    type: 'track',
    payload: { trackId: '0123456789012345678901' },
  };
  await waitFor(() => commandResults[0]);
  assert.equal(trackRequests, 2, 'a direct Spotify 503 should be retried once');
  assert.equal(commandResults[0].ok, true);
  assert.equal(commandResults[0].data.uri, 'spotify:track:0123456789012345678901');
});

test('Jam controller asks Spotify only after changes and song ends and waits out a long block', async (t) => {
  const storeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'respawn-jam-polling-'));
  const heartbeats = [];
  const commandResults = [];
  let sessionActive = false;
  let nextCommand = null;
  let spotifyRequests = 0;
  let playerRequests = 0;
  let queueReads = 0;
  let playing = false;
  let blockSpotify = false;
  const respawn = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      if (req.url === '/api/music/controller/heartbeat') {
        heartbeats.push({ ...JSON.parse(Buffer.concat(chunks).toString('utf8')), playerRequests });
        res.end(JSON.stringify({ ok: true, sessionActive }));
        return;
      }
      if (req.url === '/api/music/controller/commands') {
        const command = nextCommand;
        nextCommand = null;
        res.end(JSON.stringify({ command }));
        return;
      }
      commandResults.push(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      res.end('{}');
    });
  });
  const spotify = http.createServer((req, res) => {
    spotifyRequests += 1;
    if (req.method === 'GET' && req.url === '/v1/me/player') {
      playerRequests += 1;
      if (blockSpotify) {
        res.writeHead(429, { 'Content-Type': 'application/json', 'Retry-After': '3600' });
        res.end(JSON.stringify({ error: { status: 429, message: 'Too many requests' } }));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        item: {
          id: 'track-1', uri: 'spotify:track:track-1', name: 'Test title', duration_ms: 10_000,
          artists: [{ name: 'Test artist' }], album: { name: 'Test album', images: [] },
        },
        device: { id: 'device-1' },
        context: { type: 'playlist', uri: 'spotify:playlist:playlist-1' },
        is_playing: playing,
        // One second before the end, so the controller plans a check after it.
        progress_ms: 9_000,
      }));
      return;
    }
    if (req.method === 'GET' && req.url === '/v1/me/player/queue') {
      queueReads += 1;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ queue: [] }));
      return;
    }
    if (req.url?.startsWith('/v1/me/player/pause') || req.url?.startsWith('/v1/me/player/queue?')) {
      res.writeHead(204).end();
      return;
    }
    res.writeHead(404).end();
  });
  const respawnPort = await listen(respawn);
  const spotifyPort = await listen(spotify);
  const probe = http.createServer();
  const controllerPort = await listen(probe);
  await new Promise((resolve) => probe.close(resolve));

  fs.writeFileSync(path.join(storeDir, 'jam-controller.json'), JSON.stringify({
    respawnBaseUrl: `http://127.0.0.1:${respawnPort}`,
    label: 'LAN-Musik-PC',
    clientId: 'spotify-client',
    controllerId: 'controller-1',
    controllerToken: 'controller-token',
    groupId: 'group-1',
    spotifyDisplayName: 'LAN DJ',
    accessTokenSpotify: 'spotify-token',
    refreshToken: 'refresh-token',
    expiresAt: Date.now() + 10 * 60_000,
  }));

  const controller = spawn(process.execPath, [SCRIPT], {
    env: {
      ...process.env,
      JAM_CONTROLLER_PORT: String(controllerPort),
      JAM_CONTROLLER_STORE_DIR: storeDir,
      JAM_CONTROLLER_REQUEST_TIMEOUT_MS: '1000',
      JAM_CONTROLLER_SPOTIFY_API_BASE_URL: `http://127.0.0.1:${spotifyPort}/v1`,
      JAM_CONTROLLER_HEARTBEAT_INTERVAL_MS: '50',
      JAM_CONTROLLER_NO_OPEN: '1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  t.after(async () => {
    controller.kill('SIGTERM');
    await Promise.all([
      new Promise((resolve) => respawn.close(resolve)),
      new Promise((resolve) => spotify.close(resolve)),
    ]);
    fs.rmSync(storeDir, { recursive: true, force: true });
  });

  // Each heartbeat is sent after its Spotify decision, so counting heartbeats
  // proves that the heartbeats in between really skipped Spotify.
  const heartbeatsAfter = (count) => waitFor(() => heartbeats.length >= count);

  // Idle: one check at start, then nothing at the heartbeat rate.
  await heartbeatsAfter(6);
  assert.equal(heartbeats[0].playerRequests, 1, 'the first heartbeat reports the current Spotify state');
  assert.equal(heartbeats[5].playerRequests, 1, 'idle heartbeats must not ask Spotify again');
  assert.equal(Object.hasOwn(heartbeats[5], 'playback'), false);
  assert.equal(heartbeats[5].connectionStatus.spotify, 'connected');
  // The queue read follows its heartbeat on another connection: wait for it.
  await waitFor(() => queueReads === 1);

  // A playback command is checked at once, even without a running Jam.
  nextCommand = { id: 'command-1', type: 'pause', payload: { deviceId: 'device-1' } };
  await waitFor(() => commandResults[0]);
  assert.equal(commandResults[0].ok, true);
  await waitFor(() => playerRequests === 2);

  // A Jam starts: checked at once, then again only after the song end.
  playing = true;
  sessionActive = true;
  // The Jam start rereads the queue; the pause before could not change it.
  await waitFor(() => playerRequests === 3 && queueReads === 2);
  const afterJamStart = heartbeats.length;
  // Three 50 ms heartbeats stay well inside the 2.5 s until the song-end check.
  await heartbeatsAfter(afterJamStart + 3);
  assert.equal(playerRequests, 3, 'a running Jam does not ask Spotify at the heartbeat rate');
  // Paused after the song end: no further song-end checks race the steps below.
  playing = false;
  // The heartbeat carrying the song-end check arrives after Spotify's answer.
  await waitFor(() => heartbeats.find((heartbeat) => heartbeat.playerRequests === 4 && heartbeat.playback), 5_000);
  const afterSongEnd = heartbeats.length;
  // Negative window: a queue read starts right after its heartbeat, so three
  // further 50 ms heartbeats leave ample time for one to arrive.
  await heartbeatsAfter(afterSongEnd + 3);
  assert.equal(queueReads, 2, 'an unchanged song and playlist do not read the queue again');

  // A queued request changes Spotify's queue and is checked at once.
  nextCommand = { id: 'command-2', type: 'queueTrack', payload: { uri: 'spotify:track:track-2', deviceId: 'device-1' } };
  await waitFor(() => commandResults[1]);
  await waitFor(() => playerRequests === 5 && queueReads === 3);

  // A long Spotify block is named and waited out instead of hammered.
  blockSpotify = true;
  nextCommand = { id: 'command-3', type: 'pause', payload: { deviceId: 'device-1' } };
  const blocked = await waitFor(() => {
    const index = heartbeats.findIndex((heartbeat) => heartbeat.connectionStatus.spotify === 'unavailable');
    return index >= 0 ? index : null;
  });
  assert.match(heartbeats[blocked].connectionStatus.message, /sperrt die Wiedergabesteuerung dieses Spotify-Kontos .* bis etwa \d{2}:\d{2} Uhr/);
  const requestsWhenBlocked = spotifyRequests;
  await heartbeatsAfter(blocked + 6);
  assert.equal(spotifyRequests, requestsWhenBlocked, 'a long Spotify block must not be hammered by heartbeats');

  const page = await (await fetch(`http://127.0.0.1:${controllerPort}`)).text();
  const shown = Number(page.match(/Spotify-Anfragen in der letzten Stunde<\/span><strong>(\d+)</)?.[1]);
  assert.equal(shown, spotifyRequests, 'the local page shows every Spotify request of the last hour');
  assert.match(page, /Davon: [^<]*Status \d+[^<]*Warteschlange 3[^<]*</);
});

test('Jam controller forwards browser player reports instead of asking Spotify', async (t) => {
  const storeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'respawn-jam-browser-'));
  const heartbeats = [];
  let playerRequests = 0;
  let nextCommand = null;
  const commandResults = [];
  const respawn = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      if (req.url === '/api/music/controller/heartbeat') {
        heartbeats.push({ ...JSON.parse(Buffer.concat(chunks).toString('utf8')), playerRequests });
        res.end(JSON.stringify({ ok: true, sessionActive: true }));
        return;
      }
      if (req.url === '/api/music/controller/commands') {
        const command = nextCommand;
        nextCommand = null;
        res.end(JSON.stringify({ command }));
        return;
      }
      commandResults.push(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      res.end('{}');
    });
  });
  const spotify = http.createServer((req, res) => {
    if (req.url?.startsWith('/v1/me/player/pause')) {
      res.writeHead(204).end();
      return;
    }
    if (req.url === '/v1/me/player') {
      playerRequests += 1;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ item: null, device: { id: 'phone' }, is_playing: false, progress_ms: 0 }));
      return;
    }
    res.writeHead(404).end();
  });
  const respawnPort = await listen(respawn);
  const spotifyPort = await listen(spotify);
  const probe = http.createServer();
  const controllerPort = await listen(probe);
  await new Promise((resolve) => probe.close(resolve));
  const respawnOrigin = `http://127.0.0.1:${respawnPort}`;

  fs.writeFileSync(path.join(storeDir, 'jam-controller.json'), JSON.stringify({
    respawnBaseUrl: respawnOrigin,
    label: 'LAN-Musik-PC',
    clientId: 'spotify-client',
    controllerId: 'controller-1',
    controllerToken: 'controller-token',
    groupId: 'group-1',
    spotifyDisplayName: 'LAN DJ',
    accessTokenSpotify: 'spotify-token',
    refreshToken: 'refresh-token',
    expiresAt: Date.now() + 10 * 60_000,
  }));

  const controller = spawn(process.execPath, [SCRIPT], {
    env: {
      ...process.env,
      JAM_CONTROLLER_PORT: String(controllerPort),
      JAM_CONTROLLER_STORE_DIR: storeDir,
      JAM_CONTROLLER_REQUEST_TIMEOUT_MS: '1000',
      JAM_CONTROLLER_SPOTIFY_API_BASE_URL: `http://127.0.0.1:${spotifyPort}/v1`,
      JAM_CONTROLLER_HEARTBEAT_INTERVAL_MS: '50',
      JAM_CONTROLLER_NO_OPEN: '1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  t.after(async () => {
    controller.kill('SIGTERM');
    await Promise.all([
      new Promise((resolve) => respawn.close(resolve)),
      new Promise((resolve) => spotify.close(resolve)),
    ]);
    fs.rmSync(storeDir, { recursive: true, force: true });
  });

  const stateUrl = `http://127.0.0.1:${controllerPort}/web-player/state`;
  const report = (body, origin = respawnOrigin) => fetch(stateUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: origin },
    body: JSON.stringify(body),
  });
  const browserState = {
    track: {
      uri: 'spotify:track:0123456789012345678901',
      name: 'Browser title',
      artists: ['Browser artist'],
      album: 'Browser album',
      imageUrl: 'https://i.scdn.co/image/1',
      durationMs: 180_000,
    },
    contextUri: null,
    isPlaying: true,
    progressMs: 5_000,
  };

  await waitFor(() => heartbeats.length >= 1);
  assert.equal(playerRequests, 1);

  const preflight = await fetch(stateUrl, { method: 'OPTIONS', headers: { Origin: respawnOrigin } });
  assert.equal(preflight.status, 204);
  assert.match(preflight.headers.get('access-control-allow-methods'), /POST/);
  assert.equal((await report({ deviceId: 'browser-device', state: browserState }, 'https://evil.example')).status, 403);
  assert.equal((await report({ deviceId: 'browser-device', state: { ...browserState, track: { uri: 'javascript:1' } } })).status, 400);
  assert.equal((await fetch(stateUrl, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Origin: respawnOrigin }, body: '{',
  })).status, 400);

  assert.equal((await report({ deviceId: 'browser-device', state: browserState })).status, 204);
  const forwarded = await waitFor(() => heartbeats.find((heartbeat) => heartbeat.playback?.deviceId === 'browser-device'));
  assert.equal(forwarded.playerRequests, 1, 'a browser report needs no Spotify request');
  assert.deepEqual(forwarded.playback.track, {
    id: '0123456789012345678901',
    uri: 'spotify:track:0123456789012345678901',
    name: 'Browser title',
    artist: 'Browser artist',
    album: 'Browser album',
    imageUrl: 'https://i.scdn.co/image/1',
    durationMs: 180_000,
  });
  assert.equal(forwarded.playback.isPlaying, true);
  assert.equal(forwarded.playback.progressMs, 5_000);

  // A command for the reporting browser player needs no Spotify check: the
  // player reports the result itself.
  nextCommand = { id: 'command-1', type: 'pause', payload: { deviceId: 'browser-device' } };
  await waitFor(() => commandResults[0]);
  assert.equal(commandResults[0].ok, true);
  const afterCommand = heartbeats.length;
  // Negative window: a forced check would run on the very next heartbeat.
  await waitFor(() => heartbeats.length >= afterCommand + 3);
  assert.equal(playerRequests, 1, 'the browser player reports the pause instead of a Spotify check');

  // A stopped browser player hands over to Spotify at once.
  assert.equal((await report({ deviceId: 'browser-device', state: null })).status, 204);
  await waitFor(() => playerRequests === 2);
});

test('Jam controller logs the host and reason when a connection fails', async (t) => {
  const storeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'respawn-jam-network-'));
  // Bind and release ports so nothing listens there: connections are refused.
  const ports = [];
  for (let i = 0; i < 2; i += 1) {
    const probe = http.createServer();
    ports.push(await listen(probe));
    await new Promise((resolve) => probe.close(resolve));
  }
  const [controllerPort, respawnPort] = ports;
  // A plain HTTP server behind an https:// address fails the TLS handshake.
  const plainHttp = http.createServer((req, res) => res.end());
  const spotifyPort = await listen(plainHttp);

  fs.writeFileSync(path.join(storeDir, 'jam-controller.json'), JSON.stringify({
    respawnBaseUrl: `http://127.0.0.1:${respawnPort}`,
    label: 'LAN-Musik-PC',
    clientId: 'spotify-client',
    controllerId: 'controller-1',
    controllerToken: 'controller-token',
    groupId: 'group-1',
    spotifyDisplayName: 'LAN DJ',
    accessTokenSpotify: 'spotify-token',
    refreshToken: 'refresh-token',
    expiresAt: Date.now() + 10 * 60_000,
  }));

  let output = '';
  const controller = spawn(process.execPath, [SCRIPT], {
    env: {
      ...process.env,
      JAM_CONTROLLER_PORT: String(controllerPort),
      JAM_CONTROLLER_STORE_DIR: storeDir,
      JAM_CONTROLLER_REQUEST_TIMEOUT_MS: '1000',
      JAM_CONTROLLER_SPOTIFY_API_BASE_URL: `https://127.0.0.1:${spotifyPort}/v1`,
      JAM_CONTROLLER_NO_OPEN: '1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  controller.stdout.on('data', (chunk) => { output += chunk; });
  controller.stderr.on('data', (chunk) => { output += chunk; });

  t.after(() => {
    controller.kill('SIGTERM');
    plainHttp.close();
    fs.rmSync(storeDir, { recursive: true, force: true });
  });

  const refused = (port) => `127.0.0.1:${port} nicht erreichbar: Verbindung abgelehnt, der Dienst läuft dort nicht (ECONNREFUSED).`;
  await waitFor(() => output.includes(`[Jam] Heartbeat: ${refused(respawnPort)}`)
    && output.includes(`[Jam] Spotify-Status: 127.0.0.1:${spotifyPort} nicht erreichbar: TLS-Verbindung fehlgeschlagen, stimmen http/https und Port in der Adresse? (ERR_SSL_WRONG_VERSION_NUMBER).`));
  assert.doesNotMatch(output, /fetch failed/);
});
