const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { reportToServer, syncTrackingPaused, fetchAllowedProcessNames } = require('./report');

let calls;
let originalFetch;

beforeEach(() => {
  calls = [];
  originalFetch = global.fetch;
});

afterEach(() => {
  global.fetch = originalFetch;
});

function stubFetch(status, body) {
  global.fetch = async (url, options) => {
    calls.push({ url, options });
    return {
      ok: status >= 200 && status < 300,
      status,
      text: async () => JSON.stringify(body),
    };
  };
}

test('reportToServer posts processNames and the api key header to /api/agent/report', async () => {
  stubFetch(200, { ok: true, gameIds: ['g1'], tracked: true, trackingPaused: false });
  const result = await reportToServer({ serverUrl: 'http://x', apiKey: 'key123' }, ['cs2.exe'], null);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'http://x/api/agent/report');
  assert.equal(calls[0].options.headers['x-api-key'], 'key123');
  assert.deepEqual(JSON.parse(calls[0].options.body), { processNames: ['cs2.exe'], agentVersion: '1.0.0' });
  assert.deepEqual(result, { ok: true, gameIds: ['g1'], tracked: true, trackingPaused: false });
});

test('reportToServer includes the activity snapshot fields when given one', async () => {
  stubFetch(200, { ok: true });
  await reportToServer(
    { serverUrl: 'http://x', apiKey: 'key123' },
    ['cs2.exe'],
    { foregroundProcessName: 'cs2.exe', idleSeconds: 3 }
  );
  assert.deepEqual(JSON.parse(calls[0].options.body), {
    processNames: ['cs2.exe'],
    agentVersion: '1.0.0',
    foregroundProcessName: 'cs2.exe',
    idleSeconds: 3,
  });
});

test('reportToServer throws the server error message on a non-ok response', async () => {
  stubFetch(401, { error: 'Ungültiger API-Key.' });
  await assert.rejects(
    () => reportToServer({ serverUrl: 'http://x', apiKey: 'bad' }, [], null),
    /Ungültiger API-Key/
  );
});

test('syncTrackingPaused posts { paused } to /api/agent/tracking-paused', async () => {
  stubFetch(200, { ok: true, trackingPaused: true });
  const result = await syncTrackingPaused({ serverUrl: 'http://x', apiKey: 'key123' }, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'http://x/api/agent/tracking-paused');
  assert.equal(calls[0].options.headers['x-api-key'], 'key123');
  assert.deepEqual(JSON.parse(calls[0].options.body), { paused: true });
  assert.deepEqual(result, { ok: true, trackingPaused: true });
});

test('syncTrackingPaused throws on a non-ok response', async () => {
  stubFetch(400, { error: 'paused muss ein Boolean sein.' });
  await assert.rejects(
    () => syncTrackingPaused({ serverUrl: 'http://x', apiKey: 'key123' }, 'not-a-bool'),
    /paused muss ein Boolean sein/
  );
});

test('fetchAllowedProcessNames GETs /api/agent/process-names with the api key header', async () => {
  stubFetch(200, { processNames: ['cs2.exe', 'rocketleague.exe'] });
  const result = await fetchAllowedProcessNames({ serverUrl: 'http://x', apiKey: 'key123' });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'http://x/api/agent/process-names');
  assert.equal(calls[0].options.headers['x-api-key'], 'key123');
  assert.deepEqual(result, ['cs2.exe', 'rocketleague.exe']);
});

test('fetchAllowedProcessNames returns an empty array for a malformed or missing processNames field', async () => {
  stubFetch(200, { ok: true });
  const result = await fetchAllowedProcessNames({ serverUrl: 'http://x', apiKey: 'key123' });
  assert.deepEqual(result, []);
});

test('fetchAllowedProcessNames throws the server error message on a non-ok response', async () => {
  stubFetch(401, { error: 'Ungültiger API-Key.' });
  await assert.rejects(
    () => fetchAllowedProcessNames({ serverUrl: 'http://x', apiKey: 'bad' }),
    /Ungültiger API-Key/
  );
});
