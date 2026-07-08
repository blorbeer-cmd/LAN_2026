const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { loadState, setPaused } = require('./state');

function tempStatePath() {
  return path.join(os.tmpdir(), `agent-state-test-${Date.now()}-${Math.random()}.json`);
}

test('loadState defaults to not paused when the file does not exist', () => {
  const file = tempStatePath();
  assert.deepEqual(loadState(file), { paused: false });
});

test('loadState defaults to not paused on corrupt JSON', () => {
  const file = tempStatePath();
  fs.writeFileSync(file, '{ not valid json');
  assert.deepEqual(loadState(file), { paused: false });
  fs.unlinkSync(file);
});

test('setPaused persists true, loadState reads it back', () => {
  const file = tempStatePath();
  setPaused(file, true);
  assert.deepEqual(loadState(file), { paused: true });
  fs.unlinkSync(file);
});

test('setPaused persists false, loadState reads it back', () => {
  const file = tempStatePath();
  setPaused(file, true);
  setPaused(file, false);
  assert.deepEqual(loadState(file), { paused: false });
  fs.unlinkSync(file);
});

test('setPaused treats a non-boolean value as false', () => {
  const file = tempStatePath();
  setPaused(file, 'yes');
  assert.deepEqual(loadState(file), { paused: false });
  fs.unlinkSync(file);
});
