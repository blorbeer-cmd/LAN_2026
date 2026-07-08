const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { createControlServer } = require('./controlServer');

let server;
let baseUrl;
let state;
let handlerCalls;

function makeHandlers() {
  return {
    getStatus: () => ({
      serverUrl: 'http://example.test',
      pollIntervalMs: 10000,
      trackActivity: state.trackActivity,
      activityTrackingSupported: true,
      paused: state.paused,
      autostart: state.autostart,
      autostartSupported: true,
    }),
    pause: () => {
      handlerCalls.push('pause');
      state.paused = true;
    },
    resume: () => {
      handlerCalls.push('resume');
      state.paused = false;
    },
    enableActivityTracking: () => {
      handlerCalls.push('enableActivityTracking');
      state.trackActivity = true;
    },
    disableActivityTracking: () => {
      handlerCalls.push('disableActivityTracking');
      state.trackActivity = false;
    },
    enableAutostart: () => {
      handlerCalls.push('enableAutostart');
      state.autostart = true;
    },
    disableAutostart: () => {
      handlerCalls.push('disableAutostart');
      state.autostart = false;
    },
    uninstall: () => {
      handlerCalls.push('uninstall');
    },
  };
}

before(async () => {
  state = { paused: false, autostart: false, trackActivity: false };
  handlerCalls = [];
  server = createControlServer(makeHandlers());
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  baseUrl = `http://127.0.0.1:${port}`;
});

after(() => {
  server.close();
});

beforeEach(() => {
  state.paused = false;
  state.autostart = false;
  state.trackActivity = false;
  handlerCalls = [];
});

test('GET / serves the HTML control page', async () => {
  const res = await fetch(`${baseUrl}/`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/html/);
  const body = await res.text();
  assert.match(body, /RespawnHQ-Agent/);
});

test('GET /api/status reflects current state', async () => {
  state.paused = true;
  const res = await fetch(`${baseUrl}/api/status`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.paused, true);
  assert.equal(body.serverUrl, 'http://example.test');
});

test('POST /api/pause and /api/resume toggle paused state', async () => {
  const pauseRes = await fetch(`${baseUrl}/api/pause`, { method: 'POST' });
  assert.equal(pauseRes.status, 200);
  assert.equal(state.paused, true);

  const resumeRes = await fetch(`${baseUrl}/api/resume`, { method: 'POST' });
  assert.equal(resumeRes.status, 200);
  assert.equal(state.paused, false);
});

test('POST /api/activity-tracking/enable and /disable call through to handlers', async () => {
  await fetch(`${baseUrl}/api/activity-tracking/enable`, { method: 'POST' });
  assert.equal(state.trackActivity, true);

  await fetch(`${baseUrl}/api/activity-tracking/disable`, { method: 'POST' });
  assert.equal(state.trackActivity, false);
});

test('POST /api/autostart/enable and /disable call through to handlers', async () => {
  await fetch(`${baseUrl}/api/autostart/enable`, { method: 'POST' });
  assert.equal(state.autostart, true);

  await fetch(`${baseUrl}/api/autostart/disable`, { method: 'POST' });
  assert.equal(state.autostart, false);
});

test('POST /api/uninstall invokes the uninstall handler', async () => {
  const res = await fetch(`${baseUrl}/api/uninstall`, { method: 'POST' });
  assert.equal(res.status, 200);
  assert.ok(handlerCalls.includes('uninstall'));
});

test('a handler throwing results in a 400 with the error message', async () => {
  server.close();
  const failingHandlers = makeHandlers();
  failingHandlers.enableAutostart = () => {
    throw new Error('Autostart kann nur mit der installierten .exe eingerichtet werden.');
  };
  server = createControlServer(failingHandlers);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;

  const res = await fetch(`${baseUrl}/api/autostart/enable`, { method: 'POST' });
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.match(body.error, /installierten \.exe/);
});

test('unknown routes 404', async () => {
  const res = await fetch(`${baseUrl}/nope`);
  assert.equal(res.status, 404);
});
