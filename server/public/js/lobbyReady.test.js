import assert from 'node:assert/strict';
import test from 'node:test';

import { arcadeLobbyModeButtonsHtml } from './lobbyReady.js';

test('renders the shared arcade mode toggle with the selected button', () => {
  const html = arcadeLobbyModeButtonsHtml(
    'pong-mode',
    'Pong-Modus',
    [
      { value: 'duel', label: 'Duell' },
      { value: 'doubles', label: 'Doppel' },
    ],
    'duel'
  );

  assert.match(html, /id="pong-mode" class="arcade-mode-toggle" role="group" aria-label="Pong-Modus"/);
  assert.match(html, /class="arcade-mode-toggle-btn is-active" data-arcade-mode="duel" aria-pressed="true">Duell<\/button>/);
  assert.match(html, /class="arcade-mode-toggle-btn" data-arcade-mode="doubles" aria-pressed="false">Doppel<\/button>/);
  assert.doesNotMatch(html, /<select|>Modus</);
  assert.doesNotMatch(html, / disabled/);
});

test('escapes mode button content and supports disabled lobbies', () => {
  const html = arcadeLobbyModeButtonsHtml(
    'mode-<x>',
    'Modus "Test"',
    [{ value: 'a&b', label: '<Arena>' }],
    'a&b',
    true
  );

  assert.match(html, /id="mode-&lt;x&gt;"/);
  assert.match(html, /aria-label="Modus &quot;Test&quot;"/);
  assert.match(html, /data-arcade-mode="a&amp;b" aria-pressed="true" disabled>&lt;Arena&gt;<\/button>/);
  assert.match(html, / disabled/);
});
