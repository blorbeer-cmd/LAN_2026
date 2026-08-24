import test from 'node:test';
import assert from 'node:assert/strict';
import { createConnectionRefreshCoordinator } from './connectionRefresh.js';

const flush = () => new Promise((resolve) => setImmediate(resolve));

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

test('a reconnect arriving during a refresh receives its own full refresh', async () => {
  const first = deferred();
  const second = deferred();
  const gates = [first, second];
  const refreshed = [];
  const completed = [];
  const coordinator = createConnectionRefreshCoordinator({
    refresh: async (request) => {
      refreshed.push(request.generation);
      await gates[refreshed.length - 1].promise;
    },
  });

  coordinator.enqueue({ generation: 1, complete: () => completed.push(1) });
  await flush();
  coordinator.enqueue({ generation: 2, complete: () => completed.push(2) });
  assert.deepEqual(refreshed, [1]);

  first.resolve();
  await flush();
  assert.deepEqual(refreshed, [1, 2]);
  assert.deepEqual(completed, [1]);

  second.resolve();
  await flush();
  assert.deepEqual(completed, [1, 2]);
});

test('a transient refresh failure retries before confirming recovery', async () => {
  let attempts = 0;
  let retry = null;
  let completed = 0;
  let failures = 0;
  const coordinator = createConnectionRefreshCoordinator({
    refresh: async () => {
      attempts += 1;
      if (attempts === 1) throw new Error('temporary');
    },
    onFailure: () => {
      failures += 1;
    },
    scheduleRetry: (callback) => {
      retry = callback;
      return 1;
    },
    cancelRetry: () => undefined,
  });

  coordinator.enqueue({ generation: 1, complete: () => { completed += 1; } });
  await flush();
  assert.equal(attempts, 1);
  assert.equal(failures, 1);
  assert.equal(completed, 0);
  assert.equal(typeof retry, 'function');

  retry();
  await flush();
  assert.equal(attempts, 2);
  assert.equal(completed, 1);
});

test('an unauthorized refresh requests recovery without retrying', async () => {
  let recoveryRequired = 0;
  let retryScheduled = false;
  const coordinator = createConnectionRefreshCoordinator({
    refresh: async () => {
      throw Object.assign(new Error('unauthorized'), { status: 401 });
    },
    onUnauthorized: () => {
      recoveryRequired += 1;
    },
    scheduleRetry: () => {
      retryScheduled = true;
      return 1;
    },
  });

  coordinator.enqueue({ generation: 1, complete: () => true });
  await flush();
  assert.equal(recoveryRequired, 1);
  assert.equal(retryScheduled, false);
});
