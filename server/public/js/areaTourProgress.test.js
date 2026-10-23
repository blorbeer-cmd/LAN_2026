import test from 'node:test';
import assert from 'node:assert/strict';
import { readTourProgress, saveTourProgress, resumeTourIndex } from './areaTourProgress.js';

test('progress resumes the named step, remains account/chapter scoped and can be restarted after completion', () => {
  const values = new Map();
  const storage = { getItem: (key) => values.get(key), setItem: (key, value) => values.set(key, value) };
  const options = { storage };
  const steps = [{ id: 'vote/bock' }, { id: 'vote/save' }];
  saveTourProgress('alice', 'votes', 'all', 'vote/save', false, options);
  const progress = readTourProgress('alice', 'votes', 'all', options);
  assert.equal(resumeTourIndex(steps, progress), 1);
  assert.equal(readTourProgress('bob', 'votes', 'all', options), null);
  assert.equal(readTourProgress('alice', 'votes', 'result', options), null);
  assert.equal(resumeTourIndex([{ id: 'other' }], progress), 0);
  saveTourProgress('alice', 'votes', 'all', 'vote/save', true, options);
  assert.equal(resumeTourIndex(steps, readTourProgress('alice', 'votes', 'all', options)), 0);
});

test('unavailable or corrupt storage never prevents a tour', () => {
  const failing = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('quota'); } };
  assert.equal(readTourProgress('alice', 'home', 'all', { storage: failing }), null);
  assert.doesNotThrow(() => saveTourProgress('alice', 'home', 'all', 'intro', false, { storage: failing }));
  for (const value of ['{', 'null', '{}', '{"stepId":1,"completed":false}', '{"stepId":"x","completed":"yes"}']) {
    assert.equal(readTourProgress('alice', 'home', 'all', { storage: { getItem: () => value } }), null);
  }
});
