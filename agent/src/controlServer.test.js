const { test, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const { createControlServer, listenWithRetry } = require('./controlServer');

const ACCESS_KEY = 'A'.repeat(43);

let server;
let baseUrl;
let state;
let handlerCalls;
let failEnableAutostart;

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
      if (failEnableAutostart) {
        throw new Error('Autostart kann nur mit der installierten .exe eingerichtet werden.');
      }
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

async function createSession() {
  const launchResponse = await fetch(`${baseUrl}/api/launch`, {
    method: 'POST',
    headers: { 'X-Respawn-Control-Key': ACCESS_KEY },
  });
  assert.equal(launchResponse.status, 200);
  const { ticket } = await launchResponse.json();
  const sessionResponse = await fetch(`${baseUrl}/api/session`, {
    method: 'POST',
    headers: {
      Origin: baseUrl,
      'Sec-Fetch-Site': 'same-origin',
      'X-Respawn-Control-Ticket': ticket,
    },
  });
  assert.equal(sessionResponse.status, 204);
  return sessionResponse.headers.getSetCookie()[0].split(';', 1)[0];
}

function authenticatedHeaders(cookie, { origin = true } = {}) {
  return {
    Cookie: cookie,
    ...(origin ? { Origin: baseUrl } : {}),
    'Sec-Fetch-Site': 'same-origin',
  };
}

function requestWithHost(pathname, host, headers = {}) {
  const port = Number(new URL(baseUrl).port);
  return new Promise((resolve, reject) => {
    const request = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path: pathname,
        headers: { ...headers, Host: host },
      },
      (response) => {
        let body = '';
        response.setEncoding('utf8');
        response.on('data', (chunk) => {
          body += chunk;
        });
        response.on('end', () => resolve({ response, body }));
      },
    );
    request.on('error', reject);
    request.end();
  });
}

before(async () => {
  state = { paused: false, autostart: false, trackActivity: false };
  handlerCalls = [];
  server = createControlServer(makeHandlers(), { accessKey: ACCESS_KEY });
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
  failEnableAutostart = false;
});

test('GET / serves the hardened control page only as a direct navigation', async () => {
  const { response, body } = await requestWithHost('/', new URL(baseUrl).host, {
    'Sec-Fetch-Site': 'none',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Dest': 'document',
  });
  assert.equal(response.statusCode, 200);
  assert.match(response.headers['content-type'], /text\/html/);
  assert.match(response.headers['content-security-policy'], /frame-ancestors 'none'/);
  assert.equal(response.headers['referrer-policy'], 'no-referrer');
  assert.match(body, /Respawn-Agent/);
  assert.match(body, /history\.replaceState/);
  assert.doesNotMatch(body, new RegExp(ACCESS_KEY));
});

test('GET / keeps the inline uninstall confirmation behind the authenticated API', async () => {
  const { body } = await requestWithHost('/', new URL(baseUrl).host, {
    'Sec-Fetch-Site': 'none',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Dest': 'document',
  });
  assert.doesNotMatch(body, /confirm\(/);
  assert.match(body, /id="uninstallConfirmRow"/);
  assert.match(body, /id="uninstallCancelBtn"/);
  assert.match(body, /id="uninstallConfirmBtn"/);
});

test('a launch ticket establishes a session for status and all control actions', async () => {
  const cookie = await createSession();

  state.paused = true;
  const statusResponse = await fetch(`${baseUrl}/api/status`, {
    headers: authenticatedHeaders(cookie, { origin: false }),
  });
  assert.equal(statusResponse.status, 200);
  assert.equal((await statusResponse.json()).paused, true);

  for (const route of [
    '/api/resume',
    '/api/pause',
    '/api/activity-tracking/enable',
    '/api/activity-tracking/disable',
    '/api/autostart/enable',
    '/api/autostart/disable',
    '/api/uninstall',
  ]) {
    const response = await fetch(`${baseUrl}${route}`, {
      method: 'POST',
      headers: authenticatedHeaders(cookie),
    });
    assert.equal(response.status, 200, route);
  }

  assert.deepEqual(handlerCalls, [
    'resume',
    'pause',
    'enableActivityTracking',
    'disableActivityTracking',
    'enableAutostart',
    'disableAutostart',
    'uninstall',
  ]);
});

test('foreign origins, cross-site fetches, and missing mutation origins are rejected before handlers', async () => {
  const cookie = await createSession();
  const attempts = [
    {
      Origin: 'https://untrusted.example',
      'Sec-Fetch-Site': 'cross-site',
      Cookie: cookie,
    },
    authenticatedHeaders(cookie, { origin: false }),
  ];

  for (const headers of attempts) {
    const response = await fetch(`${baseUrl}/api/activity-tracking/enable`, { method: 'POST', headers });
    assert.equal(response.status, 403);
  }
  assert.deepEqual(handlerCalls, []);

  const readResponse = await fetch(`${baseUrl}/api/status`, {
    headers: {
      Origin: 'https://untrusted.example',
      'Sec-Fetch-Site': 'cross-site',
      Cookie: cookie,
    },
  });
  assert.equal(readResponse.status, 403);
});

test('a foreign Host header is rejected even with an otherwise valid session', async () => {
  const cookie = await createSession();
  const { response } = await requestWithHost(
    '/api/status',
    'untrusted.example',
    authenticatedHeaders(cookie, { origin: false }),
  );
  assert.equal(response.statusCode, 403);
  assert.deepEqual(handlerCalls, []);
});

test('missing or invalid access evidence cannot read status or create a session', async () => {
  const missingSession = await fetch(`${baseUrl}/api/status`, {
    headers: { 'Sec-Fetch-Site': 'same-origin' },
  });
  assert.equal(missingSession.status, 401);

  const badLaunch = await fetch(`${baseUrl}/api/launch`, {
    method: 'POST',
    headers: { 'X-Respawn-Control-Key': 'wrong' },
  });
  assert.equal(badLaunch.status, 401);

  const badTicket = await fetch(`${baseUrl}/api/session`, {
    method: 'POST',
    headers: {
      Origin: baseUrl,
      'Sec-Fetch-Site': 'same-origin',
      'X-Respawn-Control-Ticket': 'missing',
    },
  });
  assert.equal(badTicket.status, 401);
});

test('launch tickets are single-use', async () => {
  const launchResponse = await fetch(`${baseUrl}/api/launch`, {
    method: 'POST',
    headers: { 'X-Respawn-Control-Key': ACCESS_KEY },
  });
  const { ticket } = await launchResponse.json();
  const headers = {
    Origin: baseUrl,
    'Sec-Fetch-Site': 'same-origin',
    'X-Respawn-Control-Ticket': ticket,
  };
  assert.equal((await fetch(`${baseUrl}/api/session`, { method: 'POST', headers })).status, 204);
  assert.equal((await fetch(`${baseUrl}/api/session`, { method: 'POST', headers })).status, 401);
});

test('handler failures still return a bounded client error after authorization', async () => {
  failEnableAutostart = true;
  const cookie = await createSession();
  const res = await fetch(`${baseUrl}/api/autostart/enable`, {
    method: 'POST',
    headers: authenticatedHeaders(cookie),
  });
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.match(body.error, /installierten \.exe/);
});

test('unknown routes return 404 for the expected Host', async () => {
  const res = await fetch(`${baseUrl}/nope`);
  assert.equal(res.status, 404);
});

test('listenWithRetry keeps loopback binding and advances to the next port', async () => {
  const occupied = http.createServer();
  await new Promise((resolve) => occupied.listen(0, '127.0.0.1', resolve));
  const preferredPort = occupied.address().port;
  const retryServer = createControlServer(makeHandlers(), { accessKey: ACCESS_KEY });
  try {
    const { port } = await listenWithRetry(retryServer, preferredPort, 1);
    assert.equal(port, preferredPort + 1);
    assert.equal(retryServer.address().address, '127.0.0.1');
  } finally {
    occupied.close();
    retryServer.close();
  }
});
