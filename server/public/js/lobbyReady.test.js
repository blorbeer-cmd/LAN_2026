import assert from 'node:assert/strict';
import test from 'node:test';

import { arcadeLobbyModeSelectHtml } from './lobbyReady.js';

test('renders the shared arcade mode selector with the selected option', () => {
  const html = arcadeLobbyModeSelectHtml(
    'pong-mode',
    'Pong-Modus',
    [
      { value: 'doubles', label: 'Doppel · 4' },
      { value: 'duel', label: 'Duell · 2' },
    ],
    'duel'
  );

  assert.match(html, /class="arcade-lobby-mode-compact"/);
  assert.match(html, /class="arcade-lobby-mode-control" for="pong-mode"><span>Modus<\/span>/);
  assert.match(html, /aria-label="Pong-Modus"/);
  assert.match(html, /<option value="duel" selected>Duell · 2<\/option>/);
  assert.doesNotMatch(html, / disabled/);
});

test('escapes selector attributes and supports disabled lobbies', () => {
  const html = arcadeLobbyModeSelectHtml(
    'mode-<x>',
    'Modus "Test"',
    [{ value: 'a&b', label: '<Arena>' }],
    'a&b',
    true
  );

  assert.match(html, /id="mode-&lt;x&gt;"/);
  assert.match(html, /aria-label="Modus &quot;Test&quot;"/);
  assert.match(html, /<option value="a&amp;b" selected>&lt;Arena&gt;<\/option>/);
  assert.match(html, / disabled/);
});
