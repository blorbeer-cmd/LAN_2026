import test from 'node:test';
import assert from 'node:assert/strict';
import { snakeColor } from './snakeColors.js';

test('Snake colors provide stable German labels for every arena slot', () => {
  assert.deepEqual(
    Array.from({ length: 8 }, (_, index) => snakeColor(index).label),
    ['Blau', 'Pink', 'Grün', 'Orange', 'Violett', 'Rot', 'Gold', 'Weiß']
  );
  assert.deepEqual(snakeColor(8), snakeColor(0));
});
