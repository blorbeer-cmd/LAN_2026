import test from 'node:test';
import assert from 'node:assert/strict';
import { createStartupDataGate } from './startupDataGate.js';

test('an overtaken initial load settles when the newer load fails', async () => {
  const published = [];
  const gate = createStartupDataGate((state) => published.push(state));
  const initial = gate.loadAndPublish(async () => false)
    .then((committed) => committed || gate.settled);
  const failure = new Error('newer snapshot failed');

  await assert.rejects(gate.loadAndPublish(async () => { throw failure; }), failure);
  await initial;

  assert.equal(gate.ready, false);
  assert.deepEqual(published, ['failed']);

  assert.equal(await gate.loadAndPublish(async () => true), true);
  assert.equal(gate.ready, true);
  assert.deepEqual(published, ['failed', 'ready']);
});

test('a late failed load cannot retract a committed snapshot', async () => {
  const published = [];
  const gate = createStartupDataGate((state) => published.push(state));

  assert.equal(await gate.loadAndPublish(async () => true), true);
  await assert.rejects(
    gate.loadAndPublish(async () => { throw new Error('overtaken request failed'); }),
    /overtaken request failed/,
  );

  assert.equal(gate.ready, true);
  assert.deepEqual(published, ['ready']);
});
