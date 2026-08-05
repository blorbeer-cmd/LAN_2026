// Unit tests for the shared in-memory client store's lookup helpers.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { state, playerById, gameById, catalogGames } from './state.js';

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

test('catalogGames keeps the accepted games and drops the suggestions', () => {
  state.games = [
    { id: 'g1', name: 'CS2', isSuggestion: false },
    { id: 'g2', name: 'Neuer Vorschlag', isSuggestion: true },
    { id: 'g3', name: 'Rocket League' },
  ];
  assert.deepEqual(
    catalogGames().map((g) => g.id),
    ['g1', 'g3'],
  );
});

test('catalogGames is empty while only suggestions exist', () => {
  state.games = [{ id: 'g1', name: 'Nur ein Vorschlag', isSuggestion: true }];
  assert.deepEqual(catalogGames(), []);
});
