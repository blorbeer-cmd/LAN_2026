import test from 'node:test';
import assert from 'node:assert/strict';
import {
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
    selectNoneId: 'legacy-none',
  });
  assert.match(html, /id="legacy-search"/);
  assert.match(html, /data-legacy-item/);
  assert.match(html, /data-legacy-player="a"/);
  assert.match(html, /data-legacy-empty/);
  assert.match(html, /id="legacy-all"/);
  assert.match(html, /id="legacy-none"/);
});
