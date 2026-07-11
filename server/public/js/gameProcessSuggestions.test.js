// Unit tests for the game-name -> known .exe suggestion lookup. Pure string
// matching, no DOM.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { suggestProcessNames } from './gameProcessSuggestions.js';

test('matches a known game by its full name', () => {
  assert.deepEqual(suggestProcessNames('Counter-Strike 2'), ['cs2.exe']);
});

test('matches case-insensitively and via a short alias', () => {
  assert.deepEqual(suggestProcessNames('cs2'), ['cs2.exe']);
  assert.deepEqual(suggestProcessNames('CS2'), ['cs2.exe']);
});

test('matches when the typed name is a superset of the keyword (e.g. a suffix like "(Premier)")', () => {
  assert.deepEqual(suggestProcessNames('Counter-Strike 2 (Premier)'), ['cs2.exe']);
});

test('returns an empty array for an unknown game', () => {
  assert.deepEqual(suggestProcessNames('Some Totally Unknown Indie Game'), []);
});

test('returns an empty array for very short input (under 3 characters)', () => {
  assert.deepEqual(suggestProcessNames('cs'), []);
  assert.deepEqual(suggestProcessNames(''), []);
});

test('returns an empty array for null/undefined input', () => {
  assert.deepEqual(suggestProcessNames(null), []);
  assert.deepEqual(suggestProcessNames(undefined), []);
});

test('trims surrounding whitespace before matching', () => {
  assert.deepEqual(suggestProcessNames('  rocket league  '), ['RocketLeague.exe']);
});

test('a game with several known process names returns all of them', () => {
  assert.deepEqual(suggestProcessNames('league of legends'), ['League of Legends.exe', 'LeagueClientUx.exe']);
});
