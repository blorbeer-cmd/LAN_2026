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
const { tick, setUpLogFile, formatLocalTime, LOG_FILE_MAX_BYTES } = require('./index.js');

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
