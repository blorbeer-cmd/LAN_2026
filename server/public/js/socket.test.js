import test from 'node:test';
import assert from 'node:assert/strict';
import { connectSocket, connectionStateAfterFailure } from './socket.js';

test('connection failures distinguish initial setup from reconnects', () => {
  assert.equal(connectionStateAfterFailure({ hasConnected: false, online: true }), 'connecting');
  assert.equal(connectionStateAfterFailure({ hasConnected: true, online: true }), 'reconnecting');
  assert.equal(connectionStateAfterFailure({ hasConnected: false, online: false }), 'offline');
  assert.equal(connectionStateAfterFailure({ hasConnected: true, online: false }), 'offline');
});

test('only an explicitly designated socket reports global connection state', () => {
  const globalNames = ['io', 'localStorage', 'sessionStorage', 'window', 'CustomEvent'];
  const originalDescriptors = new Map(
    globalNames.map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]),
  );
  const states = [];
  const defineGlobal = (name, value) =>
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  try {
    defineGlobal('io', () => ({ on: () => undefined, emit: () => undefined }));
    defineGlobal('localStorage', { getItem: () => null });
    defineGlobal('sessionStorage', { getItem: () => null });
    defineGlobal('window', {
      addEventListener: () => undefined,
      dispatchEvent: (event) => {
        states.push(event.detail.state);
        return true;
      },
    });
    defineGlobal(
      'CustomEvent',
      class {
        constructor(_type, options) {
          this.detail = options.detail;
        }
      },
    );

    connectSocket();
    assert.deepEqual(states, [], 'auxiliary sockets stay invisible to the global status');
    connectSocket({ reportConnectionState: true });
    assert.deepEqual(states, ['connecting']);
  } finally {
    for (const name of globalNames) {
      const descriptor = originalDescriptors.get(name);
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
  }
});
