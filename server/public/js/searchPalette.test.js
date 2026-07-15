import test from 'node:test';
import assert from 'node:assert/strict';

import { normalizeSearchText, searchEntries } from './searchPalette.js';

test('normalizeSearchText makes German labels accent-insensitive', () => {
  assert.equal(normalizeSearchText('  ÜBERSICHT & Grüße  '), 'ubersicht grusse');
});

test('searchEntries finds navigation targets by title and aliases', () => {
  assert.equal(searchEntries('Captain Draft')[0]?.view, 'matchmaking');
  assert.equal(searchEntries('Anreise')[0]?.view, 'arrivals');
  assert.equal(searchEntries('WLAN')[0]?.view, 'infoBoard');
});

test('searchEntries prioritizes an exact title and respects the result limit', () => {
  assert.equal(searchEntries('Meine Statistiken')[0]?.view, 'myStats');
  assert.equal(searchEntries('', 4).length, 4);
});
