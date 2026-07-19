import test from 'node:test';
import assert from 'node:assert/strict';

import { createContentSearchEntries, normalizeSearchText, searchEntries } from './searchPalette.js';

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
  assert.equal(searchEntries('').length, 0);
  assert.equal(searchEntries('e', undefined, 4).length, 4);
});

test('content index finds players and an order by one of its items', () => {
  const entries = createContentSearchEntries(
    { players: [{ id: 'p1', name: 'Nebelwolf', real_name: 'Daniel' }], games: [], events: [] },
    {
      orders: [{ id: 'o1', title: 'Pizza bei Luigi', open: true, items: [{ playerName: 'Nebelwolf', description: 'Margherita groß' }] }],
    }
  );
  assert.deepEqual(searchEntries('Daniel', entries)[0]?.target, { type: 'player', id: 'p1' });
  assert.deepEqual(searchEntries('Margherita', entries)[0]?.target, { type: 'order', id: 'o1' });
});
