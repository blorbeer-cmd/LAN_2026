import test from 'node:test';
import assert from 'node:assert/strict';

import { SEARCH_ENTRIES, createContentSearchEntries, normalizeSearchText, searchEntries, searchEntriesVisibleToRole } from './searchPalette.js';

test('normalizeSearchText makes German labels accent-insensitive', () => {
  assert.equal(normalizeSearchText('  ÜBERSICHT & Grüße  '), 'ubersicht grusse');
});

test('searchEntries finds navigation targets by title and aliases', () => {
  assert.equal(searchEntries('Captain Draft')[0]?.view, 'matchmaking');
  assert.equal(searchEntries('Anreise')[0]?.view, 'arrivals');
  assert.equal(searchEntries('Einladungslink')[0]?.view, 'admin');
});

test('merged areas stay findable by their area name and open Info as a dialog', () => {
  // The merged areas are listed by tab, so the area name has to reach them
  // through its alias instead of an own entry.
  assert.equal(searchEntries('Match')[0]?.category, 'Match');
    assert.equal(searchEntries('Wettkampf')[0]?.category, 'Match');
  assert.equal(searchEntries('Orga')[0]?.category, 'Orga');
  assert.equal(searchEntries('Hall of Fame')[0]?.view, 'hallOfFame');
  assert.equal(searchEntries('Packliste')[0]?.view, 'checklistPacking');
  // Info has no view any more: it is opened as a dialog over the current view.
  const info = searchEntries('WLAN')[0];
  assert.equal(info?.action, 'info');
  assert.equal(info?.view, undefined);
  // The removed "Spieler" area must not linger as a dead navigation target.
  assert.equal(searchEntries('Spieler').some((entry) => entry.view === 'players'), false);
});

test('searchEntries prioritizes an exact title and respects the result limit', () => {
  assert.equal(searchEntries('Meine Statistiken')[0]?.view, 'myStats');
  assert.equal(searchEntries('').length, 0);
  assert.equal(searchEntries('e', undefined, 4).length, 4);
});

test('admin destinations are absent for members and visible for admins', () => {
  const memberViews = searchEntriesVisibleToRole(SEARCH_ENTRIES, false).map((entry) => entry.view);
  const adminViews = searchEntriesVisibleToRole(SEARCH_ENTRIES, true).map((entry) => entry.view);
  assert.equal(memberViews.includes('admin'), false);
  assert.equal(memberViews.includes('seating'), false);
  assert.equal(adminViews.includes('admin'), true);
  assert.equal(adminViews.includes('seating'), true);
});

test('content index finds players and an order by one of its items', () => {
  const entries = createContentSearchEntries(
    { players: [{ id: 'p1', name: 'Nebelwolf', real_name: 'Daniel' }], games: [], events: [] },
    {
      orders: [{ id: 'o1', title: 'Pizza bei Luigi', open: true, items: [{ playerName: 'Nebelwolf', description: 'Margherita groß' }] }],
    }
  );
  const player = searchEntries('Daniel', entries)[0];
  assert.deepEqual(player?.target, { type: 'player', id: 'p1' });
  assert.equal(player?.action, 'player');
  assert.deepEqual(searchEntries('Margherita', entries)[0]?.target, { type: 'order', id: 'o1' });
});
