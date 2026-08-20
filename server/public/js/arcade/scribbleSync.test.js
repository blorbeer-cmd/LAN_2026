import test from 'node:test';
import assert from 'node:assert/strict';
import { strokesForScribbleSync } from './scribbleSync.js';

test('Scribble reconnect restores strokes only while the same turn is still drawing', () => {
  const strokes = [{ strokeId: 'old-stroke', points: [[1, 2]] }];

  assert.deepEqual(strokesForScribbleSync({ phase: 'drawing', strokes }), strokes);
  assert.deepEqual(strokesForScribbleSync({ phase: 'reveal', strokes }), []);
  assert.deepEqual(strokesForScribbleSync({ phase: 'choosing', strokes }), []);
  assert.deepEqual(strokesForScribbleSync({ phase: 'drawing' }), []);
});
