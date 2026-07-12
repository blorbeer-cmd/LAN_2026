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

const PORT = 3910;
const BASE_URL = `http://localhost:${PORT}`;

let serverProcess;
let stopAgent;
let configFile;
let stateFilePath;
let player;

async function waitForServer(url, timeoutMs = 10_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error(`Server at ${url} did not become ready in time`);
}

before(async () => {
  const serverEntry = path.join(__dirname, '..', '..', '..', '..', 'server', 'dist', 'index.js');
  if (!fs.existsSync(serverEntry)) {
    throw new Error(`Server build not found at ${serverEntry} — run "npm run build" in server/ first.`);
  }
  serverProcess = spawn('node', [serverEntry], {
    env: { ...process.env, PORT: String(PORT), DB_FILE: ':memory:', ACCESS_TOKEN: '' },
    stdio: 'ignore',
  });
  await waitForServer(`${BASE_URL}/api/health`);
});

after(async () => {
  if (stopAgent) stopAgent();
  serverProcess?.kill();
  if (configFile && fs.existsSync(configFile)) fs.unlinkSync(configFile);
});

test('agent reports the running node process and the server reflects it as "playing"', async () => {
  const runningProcessNames = await getRunningProcessNames();
  const nodeProcessName = ['node.exe', 'node', 'mainthread'].find((name) => runningProcessNames.includes(name));
  assert.ok(nodeProcessName, 'the real process scanner should find the running Node test process');

  // Map our own detected process name to a throwaway game.
  const gameRes = await fetch(`${BASE_URL}/api/games`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'E2E Node Game' }),
  });
  const game = await gameRes.json();
  await fetch(`${BASE_URL}/api/games/${game.id}/processes`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ processName: nodeProcessName }),
  });

  // Create a player and grab their API key.
  const playerRes = await fetch(`${BASE_URL}/api/players`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'E2E Agent Player' }),
  });
  player = await playerRes.json();

  // Write a real agent config file and start the real agent loop.
  configFile = path.join(os.tmpdir(), `agent-e2e-config-${Date.now()}.json`);
  stateFilePath = path.join(path.dirname(configFile), 'agent.state.json');
  fs.writeFileSync(
    configFile,
    JSON.stringify({ serverUrl: BASE_URL, apiKey: player.api_key, pollIntervalMs: 300 })
  );

  const { start } = require('../../index.js');
  stopAgent = start(configFile);

  // Give it a couple of poll cycles to scan + report.
  await new Promise((r) => setTimeout(r, 1200));

  const liveRes = await fetch(`${BASE_URL}/api/live`);
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
  await fetch(`${BASE_URL}/api/players/${player.id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ trackingPaused: true }),
  });

  // Wait for the agent's next tick (pollIntervalMs=300) to pick this up via
  // the report response and mirror it into its local state file.
  await new Promise((r) => setTimeout(r, 700));
  const paused = JSON.parse(fs.readFileSync(stateFilePath, 'utf8'));
  assert.equal(paused.paused, true, 'agent should mirror the server-side pause locally');

  await fetch(`${BASE_URL}/api/players/${player.id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ trackingPaused: false }),
  });
  await new Promise((r) => setTimeout(r, 700));
  const resumed = JSON.parse(fs.readFileSync(stateFilePath, 'utf8'));
  assert.equal(resumed.paused, false, 'agent should mirror the server-side resume locally');
});
