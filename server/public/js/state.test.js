// Unit tests for the shared in-memory client store's lookup helpers.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { state, playerById, gameById } from './state.js';

test('state starts with the expected empty defaults', () => {
  assert.deepEqual(state.players, []);
  assert.deepEqual(state.games, []);
  assert.equal(state.votes, null);
  assert.equal(state.selectedGameId, null);
  assert.equal(state.lastMatchmaking, null);
});

test('playerById finds a player by id', () => {
  state.players = [{ id: 'p1', name: 'Alice' }, { id: 'p2', name: 'Bob' }];
  assert.equal(playerById('p2').name, 'Bob');
});

test('playerById returns undefined for an unknown id', () => {
  state.players = [{ id: 'p1', name: 'Alice' }];
  assert.equal(playerById('nope'), undefined);
});

test('gameById finds a game by id', () => {
  state.games = [{ id: 'g1', name: 'CS2' }, { id: 'g2', name: 'Rocket League' }];
  assert.equal(gameById('g1').name, 'CS2');
});

test('gameById returns undefined for an unknown id', () => {
  state.games = [];
  assert.equal(gameById('missing'), undefined);
});
