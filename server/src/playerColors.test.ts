// Initial profile colors (playerColors.ts): random, but spread away from the
// hues already in use so new accounts rarely share a color.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickPlayerColor } from './playerColors';

function seeded(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1103515245 + 12345) % 2147483648;
    return state / 2147483648;
  };
}

function hueOf(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const max = Math.max(r, g, b);
  const delta = max - Math.min(r, g, b);
  const hue = max === r ? ((g - b) / delta) % 6 : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4;
  return (hue * 60 + 360) % 360;
}

test('a color is a lowercase six-digit hex value with visible saturation', () => {
  const color = pickPlayerColor([], seeded(1));
  assert.match(color, /^#[0-9a-f]{6}$/);
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(color.slice(i, i + 2), 16));
  assert.ok(Math.max(r, g, b) - Math.min(r, g, b) > 100, `${color} is too gray`);
});

test('ten accounts in a row keep their hues at least 15 degrees apart', () => {
  // A fixed palette of ten would repeat; random candidates spread away from
  // the used hues instead. Several seeds so one lucky draw proves nothing.
  for (let seed = 1; seed <= 5; seed += 1) {
    const random = seeded(seed);
    const used: string[] = [];
    for (let i = 0; i < 10; i += 1) used.push(pickPlayerColor(used, random));
    const hues = used.map(hueOf).sort((a, b) => a - b);
    const gaps = hues.map((hue, i) => (i === 0 ? hue + 360 - hues[hues.length - 1] : hue - hues[i - 1]));
    assert.ok(Math.min(...gaps) >= 15, `seed ${seed}: hues too close: ${hues.map(Math.round).join(', ')}`);
  }
});

test('grays and invalid values in use do not break the choice', () => {
  assert.match(pickPlayerColor(['#808080', 'not-a-color', '#ffffff'], seeded(3)), /^#[0-9a-f]{6}$/);
});
