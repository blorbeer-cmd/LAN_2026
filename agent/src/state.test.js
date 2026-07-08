const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { loadState, setPaused, setTrackActivity } = require('./state');

function tempStatePath() {
  return path.join(os.tmpdir(), `agent-state-test-${Date.now()}-${Math.random()}.json`);
}

test('loadState defaults to not paused, not tracking activity when the file does not exist', () => {
  const file = tempStatePath();
  assert.deepEqual(loadState(file), { paused: false, trackActivity: false });
});

test('loadState defaults to not paused on corrupt JSON', () => {
  const file = tempStatePath();
  fs.writeFileSync(file, '{ not valid json');
  assert.deepEqual(loadState(file), { paused: false, trackActivity: false });
  fs.unlinkSync(file);
});

test('loadState falls back to the given trackActivity default when no state file exists yet', () => {
  const file = tempStatePath();
  assert.deepEqual(loadState(file, { trackActivity: true }), { paused: false, trackActivity: true });
});

test('setPaused persists true, loadState reads it back', () => {
  const file = tempStatePath();
  setPaused(file, true);
  assert.deepEqual(loadState(file), { paused: true, trackActivity: false });
  fs.unlinkSync(file);
});

test('setPaused persists false, loadState reads it back', () => {
  const file = tempStatePath();
  setPaused(file, true);
  setPaused(file, false);
  assert.deepEqual(loadState(file), { paused: false, trackActivity: false });
  fs.unlinkSync(file);
});

test('setPaused treats a non-boolean value as false', () => {
  const file = tempStatePath();
  setPaused(file, 'yes');
  assert.deepEqual(loadState(file), { paused: false, trackActivity: false });
  fs.unlinkSync(file);
});

test('setPaused does not clobber a previously stored trackActivity value', () => {
  const file = tempStatePath();
  setTrackActivity(file, true);
  setPaused(file, true);
  assert.deepEqual(loadState(file), { paused: true, trackActivity: true });
  fs.unlinkSync(file);
});

test('setTrackActivity persists true, loadState reads it back regardless of the default', () => {
  const file = tempStatePath();
  setTrackActivity(file, true);
  assert.deepEqual(loadState(file, { trackActivity: false }), { paused: false, trackActivity: true });
  fs.unlinkSync(file);
});

test('setTrackActivity persists false, overriding a truthy default', () => {
  const file = tempStatePath();
  setTrackActivity(file, false);
  assert.deepEqual(loadState(file, { trackActivity: true }), { paused: false, trackActivity: false });
  fs.unlinkSync(file);
});

test('setTrackActivity treats a non-boolean value as false', () => {
  const file = tempStatePath();
  setTrackActivity(file, 'yes');
  assert.deepEqual(loadState(file, { trackActivity: true }), { paused: false, trackActivity: false });
  fs.unlinkSync(file);
});

test('setTrackActivity does not clobber a previously stored paused value', () => {
  const file = tempStatePath();
  setPaused(file, true);
  setTrackActivity(file, true);
  assert.deepEqual(loadState(file), { paused: true, trackActivity: true });
  fs.unlinkSync(file);
});
