import { test } from 'node:test';
import assert from 'node:assert/strict';
import { OFFLINE_MESSAGE, emitWhileConnected } from './matchReconnect.js';

function fakeSocket(connected) {
  const sent = [];
  return {
    connected,
    sent,
    emit(event, payload, ack) {
      sent.push(event);
      ack({ ok: true, payload });
    },
  };
}

test('match actions are refused at once while offline instead of being buffered for the reconnect', async () => {
  const offline = fakeSocket(false);
  assert.deepEqual(await emitWhileConnected(offline, 'tetris:match:resume', { matchId: 'm' }), { ok: false, error: OFFLINE_MESSAGE });
  assert.deepEqual(offline.sent, []);

  const online = fakeSocket(true);
  assert.equal((await emitWhileConnected(online, 'tetris:match:resume', { matchId: 'm' })).ok, true);
  assert.deepEqual(online.sent, ['tetris:match:resume']);
});
