import assert from 'node:assert/strict';
import test from 'node:test';
import { parseResultScores, resultScoreInputValue } from './resultScores.js';

test('parseResultScores counts an empty field as its placeholder 0', () => {
  assert.deepEqual(parseResultScores(['3', '']), [3, 0]);
  assert.deepEqual(parseResultScores([' ', '2.5', '0']), [0, 2.5, 0]);
});

test('parseResultScores rejects a dialog where nothing was entered', () => {
  assert.equal(parseResultScores(['', ' ']), null);
});

test('rejected browser input stays invalid instead of becoming 0', () => {
  const raw = resultScoreInputValue({ value: '', validity: { badInput: true } });
  assert.ok(Number.isNaN(parseResultScores(['1', raw])[1]));
  assert.equal(resultScoreInputValue({ value: '4', validity: { badInput: false } }), '4');
});
