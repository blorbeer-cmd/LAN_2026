import test from 'node:test';
import assert from 'node:assert/strict';
import { connectSocket, connectionStateAfterFailure, isPermanentConnectionFailure } from './socket.js';

test('connection failures distinguish initial setup from reconnects', () => {
  assert.equal(connectionStateAfterFailure({ hasConnected: false, online: true }), 'connecting');
  assert.equal(connectionStateAfterFailure({ hasConnected: true, online: true }), 'reconnecting');
  assert.equal(connectionStateAfterFailure({ hasConnected: false, online: false }), 'offline');
  assert.equal(connectionStateAfterFailure({ hasConnected: true, online: false }), 'offline');
});

test('server disconnects and rejected authentication require explicit recovery', () => {
  assert.equal(isPermanentConnectionFailure({ reason: 'io server disconnect' }), true);
  assert.equal(isPermanentConnectionFailure({ reason: 'transport close' }), false);
  assert.equal(isPermanentConnectionFailure({ error: new Error('unauthorized') }), true);
  assert.equal(isPermanentConnectionFailure({ error: new Error('xhr poll error') }), false);
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

test('the reporting socket marks transport connectivity before cache refresh completes', () => {
  const globalNames = ['io', 'localStorage', 'sessionStorage', 'window', 'CustomEvent', 'navigator'];
  const originalDescriptors = new Map(
    globalNames.map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]),
  );
  const handlers = new Map();
  const events = [];
  const fakeSocket = {
    connected: false,
    on: (event, handler) => handlers.set(event, [...(handlers.get(event) ?? []), handler]),
    emit: () => undefined,
  };
  const defineGlobal = (name, value) =>
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  try {
    defineGlobal('io', () => fakeSocket);
    defineGlobal('localStorage', { getItem: () => null });
    defineGlobal('sessionStorage', { getItem: () => null });
    defineGlobal('navigator', { onLine: true });
    defineGlobal('window', {
      addEventListener: () => undefined,
      dispatchEvent: (event) => {
        events.push({
          type: event.type,
          state: event.detail?.state,
          generation: event.detail?.generation,
          complete: event.detail?.complete,
        });
        return true;
      },
    });
    defineGlobal(
      'CustomEvent',
      class {
        constructor(type, options = {}) {
          this.type = type;
          this.detail = options.detail;
        }
      },
    );

    const emit = (event, payload) => {
      if (event === 'connect') fakeSocket.connected = true;
      if (event === 'disconnect') fakeSocket.connected = false;
      handlers.get(event).forEach((handler) => handler(payload));
    };
    connectSocket({ reportConnectionState: true });
    emit('connect');
    assert.deepEqual(
      events.filter((event) => event.type === 'respawn:connection-state').map((event) => event.state),
      ['connecting', 'connected'],
      'the transport is connected even while the authoritative refresh runs',
    );
    const initialRefresh = events.find((event) => event.type === 'respawn:connection-restored');
    assert.equal(initialRefresh.generation, 1);
    assert.equal(initialRefresh.complete(), true);
    emit('connect');
    assert.deepEqual(
      events.filter((event) => event.type === 'respawn:connection-state').map((event) => event.state),
      ['connecting', 'connected', 'reconnecting', 'connected'],
      'a reconnect does not wait for the authoritative refresh to clear the banner',
    );
    const reconnectRefresh = events.filter((event) => event.type === 'respawn:connection-restored').at(-1);
    assert.equal(reconnectRefresh.generation, 2);
    assert.equal(reconnectRefresh.complete(), true);
    emit('disconnect', 'io server disconnect');
    emit('connect_error', new Error('unauthorized'));

    assert.deepEqual(
      events.map((event) => event.type),
      [
        'respawn:connection-state',
        'respawn:connection-restored',
        'respawn:connection-state',
        'respawn:connection-state',
        'respawn:connection-restored',
        'respawn:connection-state',
        'respawn:connection-state',
        'respawn:connection-recovery-required',
        'respawn:connection-state',
        'respawn:connection-recovery-required',
      ],
    );
  } finally {
    for (const name of globalNames) {
      const descriptor = originalDescriptors.get(name);
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
  }
});
