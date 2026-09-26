import test from 'node:test';
import assert from 'node:assert/strict';
import { createLatestValueLoader } from './latestValueLoader.js';

function deferred() {
  let resolve;
  const promise = new Promise((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

test('a forced load during an active request waits for one trailing fresh value', async () => {
  const first = deferred();
  const second = deferred();
  const gates = [first, second];
  let calls = 0;
  const loader = createLatestValueLoader(async () => {
    const gate = gates[calls];
    calls += 1;
    await gate.promise;
  });

  const active = loader.run();
  const forced = loader.run(true);
  assert.equal(active, forced);
  assert.equal(calls, 1);

  first.resolve();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls, 2);

  second.resolve();
  await forced;
  assert.equal(calls, 2);
});

test('invalidate queues a refresh while a request is active', async () => {
  const first = deferred();
  let calls = 0;
  const loader = createLatestValueLoader(async () => {
    calls += 1;
    if (calls === 1) await first.promise;
  });

  const active = loader.run();
  loader.invalidate();
  first.resolve();
  await active;
  assert.equal(calls, 2);
});
