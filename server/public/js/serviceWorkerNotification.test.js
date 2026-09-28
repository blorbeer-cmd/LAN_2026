import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const workerSource = readFileSync(new URL('../sw.js', import.meta.url), 'utf8');

async function clickNotification(url, { openClient = true } = {}) {
  const listeners = new Map();
  const messages = [];
  const openedUrls = [];
  let focused = false;
  const client = {
    postMessage: (message) => messages.push(JSON.parse(JSON.stringify(message))),
    focus: async () => { focused = true; },
  };
  const self = {
    addEventListener: (name, listener) => listeners.set(name, listener),
    clients: {
      matchAll: async () => openClient ? [client] : [],
      openWindow: async (target) => { openedUrls.push(target); },
    },
    location: { origin: 'https://respawn.example' },
  };
  runInNewContext(workerSource, { self, URL, decodeURIComponent, Date });
  let completion;
  listeners.get('notificationclick')({
    notification: { data: { url, eventId: 'lan-1' }, close: () => {} },
    waitUntil: (promise) => { completion = promise; },
  });
  await completion;
  return { messages, openedUrls, focused };
}

test('a tournament push opens its detail in an already open app', async () => {
  const result = await clickNotification('/#tournaments/cup-123');
  assert.equal(result.focused, true);
  assert.deepEqual(result.messages, [{
    type: 'navigate', view: 'tournaments', target: { type: 'tournament', id: 'cup-123' }, eventId: 'lan-1',
  }]);
  assert.deepEqual(result.openedUrls, []);
});

test('order pushes keep their target and a cold start keeps the tournament hash', async () => {
  const order = await clickNotification('/#foodOrders/order-123');
  assert.deepEqual(order.messages[0].target, { type: 'order', id: 'order-123' });

  const coldStart = await clickNotification('/#tournaments/cup-123', { openClient: false });
  assert.deepEqual(coldStart.messages, []);
  assert.deepEqual(coldStart.openedUrls, ['https://respawn.example/?eventId=lan-1#tournaments/cup-123']);
});
