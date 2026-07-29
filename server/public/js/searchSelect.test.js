// Unit tests for searchSelectHtml(), the pure string-rendering half of the
// searchable combobox (see searchSelect.js's header for why it exists).
// wireSearchSelect() itself needs a real DOM and is exercised indirectly by
// the e2e suite instead.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { searchSelectHtml } from './searchSelect.js';

const OPTIONS = [
  { value: 'g1', label: '🎮 Counter-Strike 2' },
  { value: 'g2', label: '🎮 Age of Empires 2' },
];

test('renders a hidden input carrying the selected value', () => {
  const html = searchSelectHtml('my-field', OPTIONS, 'g2');
  assert.match(html, /<input type="hidden" id="my-field" value="g2" \/>/);
});

test('the visible search input shows the selected option label', () => {
  const html = searchSelectHtml('my-field', OPTIONS, 'g2');
  assert.match(html, /<input type="text" id="my-field-search"[^>]*value="🎮 Age of Empires 2"/);
});

test('an unknown/empty selected value leaves the visible input blank', () => {
  const html = searchSelectHtml('my-field', OPTIONS, null);
  assert.match(html, /<input type="hidden" id="my-field" value="" \/>/);
  assert.match(html, /<input type="text" id="my-field-search"[^>]*value=""/);
});

test('renders a themed listbox instead of a native datalist', () => {
  const html = searchSelectHtml('my-field', OPTIONS, null);
  assert.match(html, /class="search-select-list" role="listbox"/);
  assert.match(html, /class="search-select-option" role="option"/);
  assert.doesNotMatch(html, /<datalist/);
  assert.match(html, />🎮 Counter-Strike 2<\/button>/);
  assert.match(html, />🎮 Age of Empires 2<\/button>/);
});

test('connects the combobox to its listbox with accessible state', () => {
  const html = searchSelectHtml('my-field', OPTIONS, 'g2');
  assert.match(html, /id="my-field-search"[^>]*role="combobox"[^>]*aria-autocomplete="list"[^>]*aria-expanded="false"[^>]*aria-controls="my-field-list"/);
  assert.match(html, /id="my-field-option-1"[^>]*aria-selected="true"/);
  assert.match(html, /class="search-select-toggle" aria-label="Auswahl öffnen"/);
});

test('option labels are HTML-escaped', () => {
  const html = searchSelectHtml('my-field', [{ value: 'g1', label: '<b>Evil</b>' }], null);
  assert.doesNotMatch(html, /<b>Evil<\/b>/);
  assert.match(html, /&lt;b&gt;Evil&lt;\/b&gt;/);
});

test('option values are HTML-escaped', () => {
  const html = searchSelectHtml('my-field', [{ value: '" onfocus="evil', label: 'Safe' }], null);
  assert.doesNotMatch(html, /data-search-select-value="" onfocus=/);
  assert.match(html, /data-search-select-value="&quot; onfocus=&quot;evil"/);
});

test('the placeholder defaults to a generic search hint and can be overridden', () => {
  const withDefault = searchSelectHtml('my-field', OPTIONS, null);
  assert.match(withDefault, /placeholder="Suchen…"/);

  const withCustom = searchSelectHtml('my-field', OPTIONS, null, { placeholder: 'Spiel suchen…' });
  assert.match(withCustom, /placeholder="Spiel suchen…"/);
});
