// Unit tests for searchSelectHtml(), the pure string-rendering half of the
// searchable <select> stand-in (see searchSelect.js's header for why it
// exists). wireSearchSelect() itself needs a real DOM and is exercised
// indirectly by the e2e suite instead.

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

test('the datalist lists every option label', () => {
  const html = searchSelectHtml('my-field', OPTIONS, null);
  assert.match(html, /<datalist id="my-field-list">/);
  assert.match(html, /<option value="🎮 Counter-Strike 2">/);
  assert.match(html, /<option value="🎮 Age of Empires 2">/);
});

test('option labels are HTML-escaped', () => {
  const html = searchSelectHtml('my-field', [{ value: 'g1', label: '<b>Evil</b>' }], null);
  assert.doesNotMatch(html, /<b>Evil<\/b>/);
  assert.match(html, /&lt;b&gt;Evil&lt;\/b&gt;/);
});

test('the placeholder defaults to a generic search hint and can be overridden', () => {
  const withDefault = searchSelectHtml('my-field', OPTIONS, null);
  assert.match(withDefault, /placeholder="Suchen…"/);

  const withCustom = searchSelectHtml('my-field', OPTIONS, null, { placeholder: 'Spiel suchen…' });
  assert.match(withCustom, /placeholder="Spiel suchen…"/);
});
