import test from 'node:test';
import assert from 'node:assert/strict';

import { matchesSelectionSearch } from './selectionSearch.js';

test('matchesSelectionSearch ignores casing and German diacritics', () => {
  assert.equal(matchesSelectionSearch('Grüße aus Köln', 'GRUSSE'), true);
  assert.equal(matchesSelectionSearch('Grüße aus Köln', 'koln'), true);
});

test('matchesSelectionSearch keeps all entries visible for an empty query', () => {
  assert.equal(matchesSelectionSearch('Counter-Strike 2', '  '), true);
});

test('matchesSelectionSearch rejects non-matching entries', () => {
  assert.equal(matchesSelectionSearch('Counter-Strike 2', 'Rocket League'), false);
});
