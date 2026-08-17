// Unit tests for the agent's main-loop pieces (tick() + logging). This is the
// one piece of the tool that runs unattended on someone else's PC and must
// never crash — index.js's own header comment says so. Exercised here
// against a fake HTTP server instead of the real one so failure modes
// (unreachable server, malformed response, non-2xx status) can be forced
// deterministically, something the existing e2e test (agent + real server)
// can't easily do.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { tick, setUpLogFile, formatLocalTime, LOG_FILE_MAX_BYTES, matchAllowedProcessNames } = require('./index.js');
const { getRunningProcessNames } = require('./processList');
const { setPaused } = require('./state');

function startFakeServer(handler) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      let body = '';
      req.on('data', (chunk) => (body += chunk));
      req.on('end', () => handler(req, res, body));
    });
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

// Fake server that additionally records every request it received (method +
// path + parsed JSON body), for tests that need to inspect what tick() sent
// rather than only what it logged.
function startRecordingServer(routeHandler) {
  const requests = [];
  return startFakeServer((req, res, body) => {
    let parsedBody = null;
    try {
      parsedBody = body ? JSON.parse(body) : null;
    } catch {
      // leave parsedBody null — a malformed body just isn't inspectable
    }
    requests.push({ method: req.method, url: req.url, body: parsedBody });
    routeHandler(req, res, parsedBody);
  }).then((server) => ({ server, requests }));
}

function serverUrl(server) {
  return `http://127.0.0.1:${server.address().port}`;
}

function tempStatePath() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-tick-test-'));
  return path.join(dir, 'agent.state.json');
}

function withCapturedLogs(fn) {
  const lines = [];
  const original = console.log;
  console.log = (line) => lines.push(line);
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      console.log = original;
    })
    .then(() => lines);
}

test('tick() reports successfully and mirrors a server-side pause into local state', async () => {
  const server = await startFakeServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ gameIds: ['game-1'], trackingPaused: true }));
  });
  const stateFilePath = tempStatePath();
  const config = { serverUrl: serverUrl(server), apiKey: 'test-key' };

  try {
    const lines = await withCapturedLogs(() => tick(config, stateFilePath));
    assert.ok(
      lines.some((l) => l.includes('Verbunden') && l.includes('1 Spiel')),
      'should log a successful report with the reported game count'
    );

    const state = JSON.parse(fs.readFileSync(stateFilePath, 'utf8'));
    assert.equal(state.paused, true, 'a trackingPaused:true response should be mirrored into local state');
  } finally {
    server.close();
  }
});

test('tick() never throws when the server is unreachable', async () => {
  // Bind and immediately close: the port is very likely still refusing
  // connections right after, which is exactly the "server down" case a
  // crashed/rebooting server produces during a 3-day LAN party.
  const server = await startFakeServer((_req, res) => res.end());
  const url = serverUrl(server);
  await new Promise((resolve) => server.close(resolve));

  const stateFilePath = tempStatePath();
  const config = { serverUrl: url, apiKey: 'test-key' };

  const lines = await withCapturedLogs(() => tick(config, stateFilePath));
  assert.ok(
    lines.some((l) => l.includes('❌') && l.includes('Fehler beim Melden')),
    'an unreachable server should be logged as a report error, not thrown'
  );
});

test('tick() tolerates a non-JSON (malformed) server response', async () => {
  const server = await startFakeServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('this is not json');
  });
  const stateFilePath = tempStatePath();
  const config = { serverUrl: serverUrl(server), apiKey: 'test-key' };

  try {
    const lines = await withCapturedLogs(() => tick(config, stateFilePath));
    assert.ok(
      lines.some((l) => l.includes('✅') && l.includes('kein bekanntes Spiel')),
      'a malformed-but-200 response should be treated as "no games reported", not crash the tick'
    );
  } finally {
    server.close();
  }
});

test('tick() logs a clean error for a non-2xx server response instead of throwing', async () => {
  const server = await startFakeServer((req, res) => {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Interner Serverfehler.' }));
  });
  const stateFilePath = tempStatePath();
  const config = { serverUrl: serverUrl(server), apiKey: 'test-key' };

  try {
    const lines = await withCapturedLogs(() => tick(config, stateFilePath));
    assert.ok(
      lines.some((l) => l.includes('❌') && l.includes('Interner Serverfehler')),
      'the server error message should surface in the log'
    );
  } finally {
    server.close();
  }
});

test('matchAllowedProcessNames keeps only names present in the allow-list', () => {
  assert.deepEqual(matchAllowedProcessNames(['cs2.exe', 'discord.exe', 'chrome.exe'], ['cs2.exe']), ['cs2.exe']);
});

test('matchAllowedProcessNames returns nothing when the allow-list is empty', () => {
  assert.deepEqual(matchAllowedProcessNames(['cs2.exe', 'explorer.exe'], []), []);
});

test('matchAllowedProcessNames returns nothing for an empty scan regardless of the allow-list', () => {
  assert.deepEqual(matchAllowedProcessNames([], ['cs2.exe']), []);
});

test('matchAllowedProcessNames keeps every match, including duplicates from the raw scan', () => {
  assert.deepEqual(matchAllowedProcessNames(['cs2.exe', 'cs2.exe', 'explorer.exe'], ['cs2.exe']), ['cs2.exe', 'cs2.exe']);
});

test('tick() fetches the server allow-list and only reports process names it contains', async () => {
  // Real scan (same trick the e2e test uses) so this exercises the actual
  // wiring instead of a fabricated process list — see agent.e2e.test.js.
  const runningProcessNames = [...new Set(await getRunningProcessNames())];
  assert.ok(runningProcessNames.length > 0, 'expected at least one process on the test machine to filter against');
  const allowedName = runningProcessNames[0];
  const disallowedName = runningProcessNames.find((name) => name !== allowedName);

  const { server, requests } = await startRecordingServer((req, res) => {
    if (req.method === 'GET' && req.url === '/api/agent/process-names') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ processNames: [allowedName] }));
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ gameIds: [], trackingPaused: false }));
  });
  const stateFilePath = tempStatePath();
  const config = { serverUrl: serverUrl(server), apiKey: 'test-key' };

  try {
    await tick(config, stateFilePath);

    const allowListReq = requests.find((r) => r.method === 'GET' && r.url === '/api/agent/process-names');
    assert.ok(allowListReq, 'tick() should fetch the process-name allow-list before reporting');

    const reportReq = requests.find((r) => r.method === 'POST' && r.url === '/api/agent/report');
    assert.ok(reportReq, 'tick() should still report after fetching the allow-list');
    assert.ok(reportReq.body.processNames.length > 0, 'the allowed process should be reported');
    assert.ok(
      reportReq.body.processNames.every((name) => name === allowedName),
      'only the allow-listed process name should be reported'
    );
    if (disallowedName) {
      assert.ok(
        !reportReq.body.processNames.includes(disallowedName),
        'a process not present in the allow-list must never be reported'
      );
    }
  } finally {
    server.close();
  }
});

test('tick() skips the allow-list fetch entirely while locally paused', async () => {
  const { server, requests } = await startRecordingServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ gameIds: [], trackingPaused: true }));
  });
  const stateFilePath = tempStatePath();
  setPaused(stateFilePath, true);
  const config = { serverUrl: serverUrl(server), apiKey: 'test-key' };

  try {
    await tick(config, stateFilePath);
    assert.ok(
      !requests.some((r) => r.method === 'GET' && r.url === '/api/agent/process-names'),
      'a paused agent must not fetch the allow-list, same as it already skips the process scan'
    );
  } finally {
    server.close();
  }
});

test('setUpLogFile resets the log file instead of letting it grow forever', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-log-test-'));
  const logFile = path.join(dir, 'agent.log');
  fs.writeFileSync(logFile, 'x'.repeat(LOG_FILE_MAX_BYTES + 1024));

  setUpLogFile(logFile);

  assert.equal(fs.existsSync(logFile), false, 'an oversized log file should be removed once it crosses the cap');
});

test('setUpLogFile leaves a small existing log file alone', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-log-test-'));
  const logFile = path.join(dir, 'agent.log');
  fs.writeFileSync(logFile, 'existing content\n');

  setUpLogFile(logFile);

  assert.equal(fs.readFileSync(logFile, 'utf8'), 'existing content\n', 'a log file under the cap must be untouched');
});

test('formatLocalTime pads hours/minutes/seconds to two digits', () => {
  const d = new Date(2026, 0, 5, 3, 7, 9);
  assert.equal(formatLocalTime(d), '03:07:09');
});
