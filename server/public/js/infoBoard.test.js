// Unit tests for the pure "is this entry long enough to collapse" check used
// by the Info board. No DOM needed - plain string logic.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isLongContent } from './views/infoBoard.js';

test('a short single-line entry (e.g. a WLAN password) stays uncollapsed', () => {
  assert.equal(isLongContent('Netz: Respawn / Passwort: geheim123'), false);
});

test('a handful of short lines stays uncollapsed', () => {
  assert.equal(isLongContent('Netz: Respawn\nPasswort: geheim123\nBand: 5GHz'), false);
});

test('content past the character threshold collapses', () => {
  assert.equal(isLongContent('x'.repeat(220)), false);
  assert.equal(isLongContent('x'.repeat(221)), true);
});

test('content past the line-count threshold collapses even if short', () => {
  const fiveShortLines = ['a', 'b', 'c', 'd', 'e'].join('\n');
  assert.equal(isLongContent(fiveShortLines), true);
});

test('handles missing content without throwing', () => {
  assert.equal(isLongContent(undefined), false);
  assert.equal(isLongContent(''), false);
});
