const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { loadConfig, DEFAULT_POLL_INTERVAL_MS } = require('./config');

function writeTempConfig(content) {
  const file = path.join(os.tmpdir(), `agent-config-test-${Date.now()}-${Math.random()}.json`);
  fs.writeFileSync(file, content);
  return file;
}

test('loadConfig throws a clear error when the file is missing', () => {
  assert.throws(() => loadConfig(path.join(os.tmpdir(), 'does-not-exist.json')), /nicht gefunden/);
});

test('loadConfig throws on invalid JSON', () => {
  const file = writeTempConfig('{ not valid json');
  assert.throws(() => loadConfig(file), /gültiges JSON/);
  fs.unlinkSync(file);
});

test('loadConfig requires serverUrl', () => {
  const file = writeTempConfig(JSON.stringify({ apiKey: 'abc' }));
  assert.throws(() => loadConfig(file), /serverUrl/);
  fs.unlinkSync(file);
});

test('loadConfig requires apiKey', () => {
  const file = writeTempConfig(JSON.stringify({ serverUrl: 'http://x' }));
  assert.throws(() => loadConfig(file), /apiKey/);
  fs.unlinkSync(file);
});

test('loadConfig applies a default poll interval when omitted', () => {
  const file = writeTempConfig(JSON.stringify({ serverUrl: 'http://x:3000', apiKey: 'abc' }));
  const config = loadConfig(file);
  assert.equal(config.pollIntervalMs, DEFAULT_POLL_INTERVAL_MS);
  fs.unlinkSync(file);
});

test('loadConfig trims a trailing slash from serverUrl', () => {
  const file = writeTempConfig(JSON.stringify({ serverUrl: 'http://x:3000/', apiKey: 'abc' }));
  const config = loadConfig(file);
  assert.equal(config.serverUrl, 'http://x:3000');
  fs.unlinkSync(file);
});

test('loadConfig respects a valid custom poll interval', () => {
  const file = writeTempConfig(JSON.stringify({ serverUrl: 'http://x:3000', apiKey: 'abc', pollIntervalMs: 5000 }));
  const config = loadConfig(file);
  assert.equal(config.pollIntervalMs, 5000);
  fs.unlinkSync(file);
});

test('loadConfig ignores an invalid (non-positive) poll interval and falls back to the default', () => {
  const file = writeTempConfig(JSON.stringify({ serverUrl: 'http://x:3000', apiKey: 'abc', pollIntervalMs: -5 }));
  const config = loadConfig(file);
  assert.equal(config.pollIntervalMs, DEFAULT_POLL_INTERVAL_MS);
  fs.unlinkSync(file);
});
