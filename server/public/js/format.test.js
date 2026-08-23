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
  lastInclusiveDayMs,
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

test('formatSince falls back to a clock time past an hour', () => {
  const ts = Date.now() - 90 * 60_000;
  const d = new Date(ts);
  const expected = `seit ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')} Uhr`;
  assert.equal(formatSince(ts), expected);
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

test('lastInclusiveDayMs rolls an exclusive next-midnight boundary back by exactly one millisecond', () => {
  const nextMidnightUtc = Date.UTC(2026, 5, 15, 0, 0, 0, 0);
  assert.equal(lastInclusiveDayMs(nextMidnightUtc), nextMidnightUtc - 1);
});

test('lastInclusiveDayMs stays correct across a DST transition, unlike a fixed 24h subtraction', () => {
  // Europe/Berlin's 2026 spring-forward transition (server-side verified in
  // src/localDate.test.ts): 2026-03-29 02:00 CET jumps to 03:00 CEST, so
  // 2026-03-30T00:00 local time is only 23h after 2026-03-29T00:00 local
  // time. A date poll option with ends_on '2026-03-29' schedules `endsAt` as
  // that next local midnight, i.e. 2026-03-29T22:00:00Z (UTC+2 already in
  // effect by then).
  const exclusiveEnd = Date.UTC(2026, 2, 29, 22, 0, 0, 0);

  assert.equal(
    new Date(lastInclusiveDayMs(exclusiveEnd)).toLocaleDateString('de-DE', { timeZone: 'Europe/Berlin' }),
    '29.3.2026',
  );

  // The bug this replaces: subtracting a fixed 24h instead of 1ms crosses
  // back over the DST transition itself and lands a full day too early.
  const buggyFixed24hResult = new Date(exclusiveEnd - 86_400_000).toLocaleDateString('de-DE', { timeZone: 'Europe/Berlin' });
  assert.notEqual(buggyFixed24hResult, '29.3.2026', 'a fixed 24h subtraction is wrong on the 23h-long spring-forward day');
});
