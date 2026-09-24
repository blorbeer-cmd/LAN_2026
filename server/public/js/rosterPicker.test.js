import test from 'node:test';
import assert from 'node:assert/strict';
import {
  allVisibleRosterSelected,
  pruneRosterSelection,
  rosterPickerHtml,
  setVisibleRosterSelection,
  visibleRosterIds,
} from './rosterPicker.js';

const players = [
  { id: 'a', name: 'Änne' },
  { id: 'b', name: 'Boris' },
  { id: 'c', name: 'Carla' },
];

test('roster selection prunes identities outside the current event', () => {
  assert.deepEqual([...pruneRosterSelection(new Set(['a', 'gone']), players)], ['a']);
});

test('bulk selection changes only the visible search intersection', () => {
  const selected = new Set(['b']);
  assert.deepEqual(visibleRosterIds(players, 'anne'), ['a']);
  setVisibleRosterSelection(selected, players, 'anne', true);
  assert.deepEqual([...selected].sort(), ['a', 'b']);
  setVisibleRosterSelection(selected, players, 'anne', false);
  assert.deepEqual([...selected], ['b']);
});

test('the single bulk toggle offers deselect only when every visible player is selected', () => {
  assert.equal(allVisibleRosterSelected(new Set(['a', 'b']), players, ''), false);
  assert.equal(allVisibleRosterSelected(new Set(['a', 'b']), players, 'anne'), true);
  assert.equal(allVisibleRosterSelected(new Set(['a', 'b', 'c']), players, ''), true);
  assert.equal(allVisibleRosterSelected(new Set(), players, 'nobody'), false);

  const partly = rosterPickerHtml({ id: 'r', players, selectedIds: new Set(['a']) });
  assert.equal((partly.match(/data-roster-select-toggle/g) ?? []).length, 1);
  assert.match(partly, /aria-label="Sichtbare Spieler markieren"/);
  const all = rosterPickerHtml({ id: 'r', players, selectedIds: new Set(['a', 'b', 'c']) });
  assert.match(all, /aria-label="Sichtbare Spieler abwählen"/);
});

test('a roster without its own search is pre-filtered by an external query', () => {
  const html = rosterPickerHtml({ id: 'r', players, selectedIds: new Set(), query: 'bo', showSearch: false });
  assert.doesNotMatch(html, /data-selection-search-trigger/);
  assert.match(html, /data-selection-search="Boris">/);
  assert.match(html, /data-selection-search="Carla" hidden>/);
});

test('roster markup keeps one shared checkbox/search contract and custom metadata', () => {
  const html = rosterPickerHtml({
    id: 'test-roster',
    players,
    selectedIds: new Set(['b']),
    query: 'bo',
    renderTrailing: (player) => `<span>${player.id}</span>`,
  });
  assert.match(html, /data-roster-picker="test-roster"/);
  assert.match(html, /id="test-roster-search"[^>]*value="bo"/);
  assert.match(html, /data-roster-picker-player="b" checked/);
  assert.equal((html.match(/data-roster-picker-item/g) ?? []).length, players.length);
});

test('roster markup can retain stable view selectors during migration', () => {
  const html = rosterPickerHtml({
    id: 'test-roster',
    players: [players[0]],
    selectedIds: new Set(),
    searchId: 'legacy-search',
    itemAttribute: 'data-legacy-item',
    playerAttribute: 'data-legacy-player',
    emptyAttribute: 'data-legacy-empty',
    selectAllId: 'legacy-all',
  });
  assert.match(html, /id="legacy-search"/);
  assert.match(html, /data-legacy-item/);
  assert.match(html, /data-legacy-player="a"/);
  assert.match(html, /data-legacy-empty/);
  assert.match(html, /id="legacy-all"/);
});
