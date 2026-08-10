import test from 'node:test';
import assert from 'node:assert/strict';
import { beginDataLoad, isCurrentDataLoad } from './data.js';

test('only the newest data load may commit its result', () => {
  const first = beginDataLoad();
  const second = beginDataLoad();

  assert.equal(isCurrentDataLoad(first), false);
  assert.equal(isCurrentDataLoad(second), true);
});
