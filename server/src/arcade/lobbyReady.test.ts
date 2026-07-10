import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isLobbyReady, ReadyLobby, setLobbyReady } from './lobbyReady';

function lobby(): ReadyLobby {
  return {
    host: { id: 'host' },
    players: [{ id: 'host' }, { id: 'guest' }],
    ready: new Set<string>(),
  };
}

test('setLobbyReady flags and unflags a lobby member', () => {
  const l = lobby();
  assert.equal(setLobbyReady(l, 'guest', true), true);
  assert.equal(isLobbyReady(l, 'guest'), true);
  assert.equal(setLobbyReady(l, 'guest', false), true);
  assert.equal(isLobbyReady(l, 'guest'), false);
});

test('setLobbyReady rejects non-members and malformed input', () => {
  const l = lobby();
  assert.equal(setLobbyReady(l, 'stranger', true), false);
  assert.equal(setLobbyReady(l, undefined, true), false);
  assert.equal(setLobbyReady(l, 'guest', 'yes'), false);
  assert.equal(l.ready.size, 0);
});

test('the host always counts as ready', () => {
  const l = lobby();
  assert.equal(isLobbyReady(l, 'host'), true);
  assert.equal(isLobbyReady(l, 'guest'), false);
});
