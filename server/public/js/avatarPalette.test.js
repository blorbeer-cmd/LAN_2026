// Sanity checks for the shared avatar color palette: catches an accidental
// duplicate or malformed hex value creeping in, which would otherwise only
// surface visually (two swatches looking the same in the color picker).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AVATAR_PALETTE } from './avatarPalette.js';

test('the palette has 8 distinct swatches', () => {
  assert.equal(AVATAR_PALETTE.length, 8);
  assert.equal(new Set(AVATAR_PALETTE).size, 8, 'no two swatches should be identical');
});

test('every swatch is a valid 6-digit hex color', () => {
  for (const color of AVATAR_PALETTE) {
    assert.match(color, /^#[0-9a-f]{6}$/i, `${color} is not a valid hex color`);
  }
});
