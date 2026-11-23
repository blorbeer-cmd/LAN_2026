// End-to-end test of the real agent loop against the built server. The agent
// fetches the allow-list, probes the OS, reports and shows up on the live board.
//
// Trick: our own Node process is always running, so we map the name the
// production probe returns for it to a throwaway game. Recent Node/Linux
// combinations may expose it as `MainThread` instead of `node`, while Windows
// reports `node.exe`; discovering it through the real probe keeps the test
// aligned with the platform it runs on.

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('child_process');
const { once } = require('node:events');
const { setTimeout: delay } = require('node:timers/promises');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { probeSystem } = require('../../systemProbe');

let BASE_URL;
const ADMIN_NAME = 'Agent E2E Admin';
const ADMIN_PASSWORD = 'agent-e2e-admin-password';

let serverProcess;
let adminCookie;

async function waitFor(check, message) {
  const deadline = Date.now() + 15_000;
  do {
    if (await check()) return;
    await delay(100);
  } while (Date.now() < deadline);
  assert.fail(message);
}

function startServer(serverEntry, timeoutMs = 10_000) {
  const child = spawn(process.execPath, [serverEntry], {
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

after(() => {
  serverProcess?.kill();
});

test('the agent reports a running game and follows pause and resume from the web profile', async (t) => {
  // The lookup is targeted, so the candidate spellings go in and whichever one
  // this platform actually uses comes back out.
  const { processNames } = await probeSystem({ allowedProcessNames: ['node.exe', 'node', 'mainthread'] });
  const [nodeProcessName] = processNames;
  assert.ok(nodeProcessName, 'the real process lookup should find the running Node test process');

  // Map our own detected process name to a throwaway game.
  const gameRes = await fetch(`${BASE_URL}/api/games`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
    body: JSON.stringify({ name: 'E2E Node Game' }),
  });
  const game = await gameRes.json();
  assert.equal(gameRes.status, 201, JSON.stringify(game));
  const processRes = await fetch(`${BASE_URL}/api/games/${game.id}/processes`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
    body: JSON.stringify({ processName: nodeProcessName }),
  });

  assert.ok(processRes.ok, await processRes.text());

  // Create a player and grab their API key.
  const playerRes = await fetch(`${BASE_URL}/api/players`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
    body: JSON.stringify({ name: 'E2E Agent Player' }),
  });
  const player = await playerRes.json();
  assert.equal(playerRes.status, 201, JSON.stringify(player));
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
  const playerCookie = claimRes.headers.get('set-cookie').split(';')[0];

  // Agent reports are deliberately counted only inside the account's active
  // event, while that event's tracking window is open and the participant has
  // opted in. Set up that real contract explicitly instead of relying on the
  // legacy group-wide tracking default. The permanently open base workspace is
  // not trackable, so this needs a real LAN period the account joins and
  // selects — the same sequence an organizer walks through in production.
  const now = Date.now();
  const createdEventRes = await fetch(`${BASE_URL}/api/events`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
    body: JSON.stringify({ name: 'E2E Agent LAN', startsAt: now - 1000, endsAt: now + 3600000 }),
  });
  const activeEvent = await createdEventRes.json();
  assert.equal(createdEventRes.status, 201, JSON.stringify(activeEvent));
  // Both identities join and select it: the account produces the report, and
  // the live board below is scoped to the *reader's* active event, so the
  // admin has to be in the same period to see it.
  const meRes = await fetch(`${BASE_URL}/api/me`, { headers: { Cookie: adminCookie } });
  const admin = await meRes.json();
  assert.equal(meRes.status, 200, JSON.stringify(admin));
  const participantsRes = await fetch(`${BASE_URL}/api/events/${activeEvent.id}/participants`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
    body: JSON.stringify({ playerIds: [player.id, admin.id] }),
  });
  assert.equal(participantsRes.status, 200, await participantsRes.text());
  for (const cookie of [playerCookie, adminCookie]) {
    const acceptRes = await fetch(`${BASE_URL}/api/events/${activeEvent.id}/invitation/accept`, {
      method: 'POST',
      headers: { Cookie: cookie },
    });
    assert.equal(acceptRes.status, 200, await acceptRes.text());
    const selectRes = await fetch(`${BASE_URL}/api/me/active-event`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ eventId: activeEvent.id }),
    });
    assert.equal(selectRes.status, 200, await selectRes.text());
  }
  const trackingStartRes = await fetch(`${BASE_URL}/api/events/${activeEvent.id}/tracking/start`, {
    method: 'POST',
    headers: { Cookie: adminCookie },
  });
  assert.equal(trackingStartRes.status, 200, await trackingStartRes.text());
  const privacyRes = await fetch(`${BASE_URL}/api/privacy`, { headers: { Cookie: playerCookie } });
  assert.equal(privacyRes.status, 200);
  const privacy = await privacyRes.json();
  const consentRes = await fetch(`${BASE_URL}/api/events/${activeEvent.id}/tracking-consent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: playerCookie },
    body: JSON.stringify({ granted: true, textVersion: privacy.trackingConsent.textVersion }),
  });
  assert.equal(consentRes.status, 200, await consentRes.text());

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-e2e-'));
  const configFile = path.join(tempDir, 'agent.config.json');
  const stateFilePath = path.join(tempDir, 'agent.state.json');
  fs.writeFileSync(
    configFile,
    JSON.stringify({ serverUrl: BASE_URL, apiKey: player.api_key, pollIntervalMs: 1_000 })
  );

  const agent = spawn(process.execPath, [path.join(__dirname, '..', '..', 'index.js'), configFile], {
    stdio: 'ignore',
    windowsHide: true,
  });
  const exited = once(agent, 'exit');
  t.after(async () => {
    agent.kill();
    await exited;
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  await waitFor(async () => {
    const liveRes = await fetch(`${BASE_URL}/api/live`, { headers: { Cookie: adminCookie } });
    assert.equal(liveRes.status, 200);
    const board = await liveRes.json();
    const entry = board.find((row) => row.player_id === player.id);
    return entry?.state === 'playing' && entry.games.some((item) => item.game_id === game.id);
  }, 'the agent never reported the running test game to the live board');

  for (const paused of [true, false]) {
    const response = await fetch(`${BASE_URL}/api/players/${player.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Cookie: playerCookie },
      body: JSON.stringify({ trackingPaused: paused }),
    });
    assert.ok(response.ok, await response.text());
    await waitFor(
      () => fs.existsSync(stateFilePath) && JSON.parse(fs.readFileSync(stateFilePath, 'utf8')).paused === paused,
      `the agent did not mirror trackingPaused=${paused} into its local state`,
    );
  }
});
