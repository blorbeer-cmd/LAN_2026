import { test } from 'node:test';
import assert from 'node:assert/strict';
import { backButtonHtml } from './backButton.js';

test('renders canonical route back navigation', () => {
  const html = backButtonHtml({ view: 'admin' });
  assert.match(html, /class="btn btn-sm"/);
  assert.match(html, /data-navigate="admin"/);
  assert.match(html, /<svg/);
  assert.match(html, /> Zurück<\/button>$/);
});

test('supports local sub-view navigation and escapes its label', () => {
  const html = backButtonHtml({ id: 'tourn-back', label: 'Zurück zu <Turnieren>' });
  assert.match(html, /id="tourn-back"/);
  assert.doesNotMatch(html, /data-navigate/);
  assert.match(html, /Zurück zu &lt;Turnieren&gt;/);
});

test('rejects a back button without a destination', () => {
  assert.throws(() => backButtonHtml(), /view oder id/);
});
