// End-to-end test of the real agent loop against the real (built) server —
// no mocks. Since this sandbox is Linux, we exercise the `ps`-based fallback
// path instead of `tasklist`, but the flow is identical: scan processes,
// match against game_process_names, report, show up on the live board.
//
// Trick: our own Node process is always running, so we map the name returned
// by the production process scanner to a throwaway game. Recent Node/Linux
// combinations may expose it as `MainThread` in `ps` instead of `node`, while
// Windows reports `node.exe`; discovering it through the real scanner keeps
// the test aligned with the platform it runs on.

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { getRunningProcessNames } = require('../../processList');

let BASE_URL;
const ADMIN_NAME = 'Agent E2E Admin';
const ADMIN_PASSWORD = 'agent-e2e-admin-password';

let serverProcess;
let stopAgent;
let tempDir;
let configFile;
let stateFilePath;
let player;
let adminCookie;
let playerCookie;

function startServer(serverEntry, timeoutMs = 10_000) {
  const child = spawn('node', [serverEntry], {
    env: {
      ...process.env,
      PORT: '0',
      DB_FILE: ':memory:',
      COOKIE_SECURE: '0',
      BOOTSTRAP_ADMIN_1_NAME: ADMIN_NAME,
      BOOTSTRAP_ADMIN_1_PASSWORD: ADMIN_PASSWORD,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  return new Promise((resolve, reject) => {
    let output = '';
    let settled = false;
    const finish = (error, server) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      child.removeListener('exit', onExit);
      if (error) {
        child.kill();
        reject(error);
      } else {
        resolve(server);
      }
    };
    const inspectOutput = (chunk) => {
      output = `${output}${chunk.toString()}`.slice(-8_000);
      const match = output.match(/Respawn server .* http:\/\/localhost:(\d+)/);
      if (!match) return;
      const port = Number(match[1]);
      finish(undefined, { process: child, baseUrl: `http://localhost:${port}` });
    };
    const onExit = (code, signal) =>
      finish(
        new Error(
          `Agent E2E server exited before binding a port (code ${code}, signal ${signal ?? 'none'})${output ? `\n${output}` : ''}`
        )
      );
    const timeout = setTimeout(
      () =>
        finish(
          new Error(
            `Agent E2E server did not bind a port within ${timeoutMs}ms${output ? `\n${output}` : ''}`
          )
        ),
      timeoutMs
    );

    child.stdout.on('data', inspectOutput);
    child.stderr.on('data', inspectOutput);
    child.once('error', (error) =>
      finish(
        new Error(
          `Agent E2E server failed to spawn: ${error.message}${output ? `\n${output}` : ''}`
        )
      )
    );
    child.once('exit', onExit);
  });
}

before(async () => {
  const serverEntry = path.join(__dirname, '..', '..', '..', '..', 'server', 'dist', 'index.js');
  if (!fs.existsSync(serverEntry)) {
    throw new Error(`Server build not found at ${serverEntry} — run "npm run build" in server/ first.`);
  }
  const server = await startServer(serverEntry);
  serverProcess = server.process;
  BASE_URL = server.baseUrl;
  const login = await fetch(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: ADMIN_NAME, password: ADMIN_PASSWORD }),
  });
  assert.equal(login.status, 200);
  adminCookie = login.headers.get('set-cookie').split(';')[0];
  const reauthenticated = await fetch(`${BASE_URL}/api/auth/reauth`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
    body: JSON.stringify({ password: ADMIN_PASSWORD }),
  });
  assert.equal(reauthenticated.status, 204);
});

after(async () => {
  if (stopAgent) stopAgent();
  serverProcess?.kill();
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
});

test('agent reports the running node process and the server reflects it as "playing"', async () => {
  const runningProcessNames = await getRunningProcessNames();
  const nodeProcessName = ['node.exe', 'node', 'mainthread'].find((name) => runningProcessNames.includes(name));
  assert.ok(nodeProcessName, 'the real process scanner should find the running Node test process');

  // Map our own detected process name to a throwaway game.
  const gameRes = await fetch(`${BASE_URL}/api/games`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
    body: JSON.stringify({ name: 'E2E Node Game' }),
  });
  const game = await gameRes.json();
  await fetch(`${BASE_URL}/api/games/${game.id}/processes`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
    body: JSON.stringify({ processName: nodeProcessName }),
  });

  // Create a player and grab their API key.
  const playerRes = await fetch(`${BASE_URL}/api/players`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
    body: JSON.stringify({ name: 'E2E Agent Player' }),
  });
  player = await playerRes.json();
  const inviteRes = await fetch(`${BASE_URL}/api/auth/invites`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
    body: JSON.stringify({ purpose: 'claim', playerId: player.id }),
  });
  const invite = await inviteRes.json();
  assert.equal(inviteRes.status, 201, JSON.stringify(invite));
  const claimRes = await fetch(`${BASE_URL}/api/auth/claim`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code: invite.code, password: 'agent-e2e-player-password' }),
  });
  assert.equal(claimRes.status, 200);
  playerCookie = claimRes.headers.get('set-cookie').split(';')[0];

  // Agent reports are deliberately counted only inside the account's active
  // event, while that event's tracking window is open and the participant has
  // opted in. Set up that real contract explicitly instead of relying on the
  // legacy group-wide tracking default.
  const activeEventRes = await fetch(`${BASE_URL}/api/events/active`, {
    headers: { Cookie: playerCookie },
  });
  assert.equal(activeEventRes.status, 200);
  const activeEvent = await activeEventRes.json();
  const trackingStartRes = await fetch(`${BASE_URL}/api/events/${activeEvent.id}/tracking/start`, {
    method: 'POST',
    headers: { Cookie: adminCookie },
  });
  assert.equal(trackingStartRes.status, 200, await trackingStartRes.text());
  const consentRes = await fetch(`${BASE_URL}/api/events/${activeEvent.id}/tracking-consent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: playerCookie },
    body: JSON.stringify({ granted: true }),
  });
  assert.equal(consentRes.status, 200, await consentRes.text());

  // Write a real agent config file and start the real agent loop.
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-e2e-'));
  configFile = path.join(tempDir, 'agent.config.json');
  stateFilePath = path.join(path.dirname(configFile), 'agent.state.json');
  fs.writeFileSync(
    configFile,
    JSON.stringify({ serverUrl: BASE_URL, apiKey: player.api_key, pollIntervalMs: 300 })
  );

  const { start } = require('../../index.js');
  stopAgent = start(configFile);

  // Give it a couple of poll cycles to scan + report.
  await new Promise((r) => setTimeout(r, 1200));

  const liveRes = await fetch(`${BASE_URL}/api/live`, { headers: { Cookie: adminCookie } });
  const board = await liveRes.json();
  const entry = board.find((p) => p.player_id === player.id);

  assert.ok(entry, 'player should appear on the live board');
  assert.equal(entry.state, 'playing');
  assert.ok(
    entry.games.some((g) => g.game_id === game.id),
    'the E2E Node Game should be listed as currently running'
  );
});

test('pausing via the web profile (PATCH /api/players) is picked up by the already-running agent', async () => {
  // The productive web profile uses the player's personal session.
  await fetch(`${BASE_URL}/api/players/${player.id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Cookie: playerCookie },
    body: JSON.stringify({ trackingPaused: true }),
  });

  // Wait for the agent's next tick (pollIntervalMs=300) to pick this up via
  // the report response and mirror it into its local state file.
  await new Promise((r) => setTimeout(r, 700));
  const paused = JSON.parse(fs.readFileSync(stateFilePath, 'utf8'));
  assert.equal(paused.paused, true, 'agent should mirror the server-side pause locally');

  await fetch(`${BASE_URL}/api/players/${player.id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Cookie: playerCookie },
    body: JSON.stringify({ trackingPaused: false }),
  });
  await new Promise((r) => setTimeout(r, 700));
  const resumed = JSON.parse(fs.readFileSync(stateFilePath, 'utf8'));
  assert.equal(resumed.paused, false, 'agent should mirror the server-side resume locally');
});
