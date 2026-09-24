import test from 'node:test';
import assert from 'node:assert/strict';

import { matchesSelectionSearch, selectionSearchHtml } from './selectionSearch.js';

test('matchesSelectionSearch ignores casing and German diacritics', () => {
  assert.equal(matchesSelectionSearch('Grüße aus Köln', 'GRUSSE'), true);
  assert.equal(matchesSelectionSearch('Grüße aus Köln', 'koln'), true);
});

test('matchesSelectionSearch preserves non-Latin letters', () => {
  assert.equal(matchesSelectionSearch('Команда Дракон', 'дракон'), true);
  assert.equal(matchesSelectionSearch('東京チーム', '東京'), true);
});

test('matchesSelectionSearch keeps all entries visible for an empty query', () => {
  assert.equal(matchesSelectionSearch('Counter-Strike 2', '  '), true);
});

test('matchesSelectionSearch rejects non-matching entries', () => {
  assert.equal(matchesSelectionSearch('Counter-Strike 2', 'Rocket League'), false);
});

test('selectionSearchHtml renders an always-visible named search field', () => {
  const html = selectionSearchHtml('players-search', 'Alex');
  assert.match(html, /class="selection-search is-open"/);
  assert.match(html, /id="players-search"[^>]*value="Alex"[^>]*placeholder="Spieler suchen"[^>]*aria-label="Spieler suchen"/);
  assert.doesNotMatch(html, /selection-search-trigger|hidden/);
});
