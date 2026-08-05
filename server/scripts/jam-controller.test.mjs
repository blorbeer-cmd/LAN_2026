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
});
