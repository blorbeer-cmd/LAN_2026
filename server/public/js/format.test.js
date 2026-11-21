// Unit tests for the pure string/formatting helpers shared by every view.
// No DOM needed — these are plain functions over strings/timestamps.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  escapeHtml,
  formatSince,
  formatDateTime,
  formatDate,
  toDatetimeLocal,
  stateLabel,
  avatarHtml,
  gameChipsHtml,
  linkifyHtml,
  webUrlHref,
} from './format.js';

test('escapeHtml neutralizes all five HTML-significant characters', () => {
  assert.equal(escapeHtml(`<b>"Tom & Jerry's"</b>`), '&lt;b&gt;&quot;Tom &amp; Jerry&#39;s&quot;&lt;/b&gt;');
});

test('escapeHtml handles null/undefined/numbers without throwing', () => {
  assert.equal(escapeHtml(null), '');
  assert.equal(escapeHtml(undefined), '');
  assert.equal(escapeHtml(42), '42');
});

test('formatSince returns empty string for a falsy timestamp', () => {
  assert.equal(formatSince(0), '');
  assert.equal(formatSince(null), '');
});

test('formatSince shows "gerade eben" for anything under a minute', () => {
  assert.equal(formatSince(Date.now() - 5_000), 'gerade eben');
});

test('formatSince shows relative minutes under an hour', () => {
  assert.equal(formatSince(Date.now() - 5 * 60_000), 'seit 5 Min.');
});

test('formatSince falls back to a zero-padded local clock time past an hour', () => {
  // A literal expectation, like toDatetimeLocal's below: deriving it from
  // getHours()/getMinutes() again would only restate the implementation and
  // could never catch a bug inside it.
  assert.equal(formatSince(new Date(2026, 6, 8, 14, 30).getTime()), 'seit 14:30 Uhr');
  assert.equal(formatSince(new Date(2026, 0, 5, 3, 7).getTime()), 'seit 03:07 Uhr');
});

test('formatDateTime and formatDate return the placeholder dash for a falsy timestamp', () => {
  assert.equal(formatDateTime(0), '–');
  assert.equal(formatDate(null), '–');
});

test('toDatetimeLocal produces the exact datetime-local input format', () => {
  const d = new Date(2026, 6, 8, 14, 30, 0);
  assert.equal(toDatetimeLocal(d.getTime()), '2026-07-08T14:30');
});

test('toDatetimeLocal pads single-digit month/day/hour/minute', () => {
  const d = new Date(2026, 0, 5, 3, 7, 0);
  assert.equal(toDatetimeLocal(d.getTime()), '2026-01-05T03:07');
});

test('stateLabel maps known live states to their German label', () => {
  assert.equal(stateLabel('playing'), 'Spielt');
  assert.equal(stateLabel('online'), 'Online');
  assert.equal(stateLabel('paused'), 'Pause');
  assert.equal(stateLabel('offline'), 'Offline');
});

test('stateLabel falls back to the raw value for an unknown state', () => {
  assert.equal(stateLabel('mystery'), 'mystery');
});

test('avatarHtml renders an image when the player has an avatar set', () => {
  const html = avatarHtml({ color: '#123456', avatar: 'data:image/png;base64,abc' }, 40); // design-token-ok: arbitrary test fixture value, not a UI color
  assert.match(html, /<img class="avatar-img"/);
  assert.match(html, /width:40px;height:40px/);
});

test('avatarHtml falls back to a color dot when there is no avatar', () => {
  const html = avatarHtml({ color: '#abcdef' }, 24); // design-token-ok: arbitrary test fixture value, not a UI color
  assert.match(html, /<span class="avatar-dot"/);
  assert.match(html, /background:#abcdef/); // design-token-ok: asserting the fixture color above round-trips
});

test('avatarHtml escapes an unsafe color/avatar value', () => {
  const html = avatarHtml({ color: '"><script>' }, 20);
  assert.doesNotMatch(html, /<script>/);
});

test('gameChipsHtml renders one chip per game with the elapsed time', () => {
  const games = [{ game_id: 'g1', game_name: 'CS2', game_icon: '🔫', since: Date.now() - 60_000, foreground: true }];
  const html = gameChipsHtml(games, false);
  assert.match(html, /CS2/);
  assert.match(html, /seit 1 Min\./);
});

test('gameChipsHtml only distinguishes foreground/background with >1 game and activity tracking on', () => {
  const games = [
    { game_id: 'g1', game_name: 'CS2', game_icon: '🔫', since: Date.now(), foreground: true },
    { game_id: 'g2', game_name: 'Discord', game_icon: '💬', since: Date.now(), foreground: false },
  ];
  const trackedHtml = gameChipsHtml(games, true);
  assert.match(trackedHtml, /chip-foreground/);
  assert.match(trackedHtml, /chip-background/);

  const untrackedHtml = gameChipsHtml(games, false);
  assert.doesNotMatch(untrackedHtml, /chip-foreground/);
  assert.doesNotMatch(untrackedHtml, /chip-background/);
});

test('gameChipsHtml with a single game never shows the foreground/background distinction', () => {
  const games = [{ game_id: 'g1', game_name: 'CS2', game_icon: '🔫', since: Date.now(), foreground: true }];
  const html = gameChipsHtml(games, true);
  assert.doesNotMatch(html, /chip-foreground/);
  assert.doesNotMatch(html, /aktiv/);
});

test('linkifyHtml links web addresses in escaped user text and leaves trailing punctuation outside', () => {
  assert.equal(
    linkifyHtml('Bracket: https://lan.example/t?a=1&b=2. Fotos (www.fotos.example) <b>'),
    'Bracket: <a class="text-link" href="https://lan.example/t?a=1&amp;b=2" target="_blank" rel="noopener noreferrer">https://lan.example/t?a=1&amp;b=2</a>. '
      + 'Fotos (<a class="text-link" href="https://www.fotos.example/" target="_blank" rel="noopener noreferrer">www.fotos.example</a>) &lt;b&gt;',
  );
  assert.match(linkifyHtml('https://de.wikipedia.org/wiki/LAN_(Netz)'), /href="https:\/\/de\.wikipedia\.org\/wiki\/LAN_\(Netz\)"/);
});

test('linkifyHtml never builds a link from another scheme or a quote-breaking address', () => {
  assert.equal(linkifyHtml('javascript:alert(1) steam://connect/1.2.3.4'), 'javascript:alert(1) steam://connect/1.2.3.4');
  assert.equal(linkifyHtml('Essen kommen!'), 'Essen kommen!');
  const html = linkifyHtml('https://x.example/"onmouseover="alert(1)');
  assert.match(html, /href="https:\/\/x\.example\/"/);
  assert.match(html, /&quot;onmouseover=&quot;alert\(1\)$/);
});

test('webUrlHref accepts only a whole http(s) or www address', () => {
  assert.equal(webUrlHref(' https://lan.example/join '), 'https://lan.example/join');
  assert.equal(webUrlHref('www.lan.example'), 'https://www.lan.example/');
  assert.equal(webUrlHref('10.0.0.5:27015'), null);
  assert.equal(webUrlHref('https://lan.example join'), null);
  assert.equal(webUrlHref('steam://connect/10.0.0.5'), null);
  assert.equal(webUrlHref(null), null);
});
