import { test } from 'node:test';
import assert from 'node:assert/strict';
import { matchesAnswer, normalizeAnswer, pickQuestion } from './quizLogic';

test('normalizeAnswer ignores case, whitespace, punctuation and diacritics', () => {
  assert.equal(normalizeAnswer('  Kluft der Beschwörer! '), 'kluftderbeschworer');
});

test('matchesAnswer accepts configured answer variants', () => {
  assert.equal(matchesAnswer('summoners rift', ["Summoner's Rift", 'Kluft der Beschwörer']), true);
  assert.equal(matchesAnswer('dust2', ["Summoner's Rift"]), false);
});

test('pickQuestion prefers questions not seen by both players', () => {
  const picked = pickQuestion(['a', 'b', 'c'], new Set(['a', 'b']));
  assert.equal(picked, 'c');
});

test('pickQuestion falls back when all questions were seen by both players', () => {
  const picked = pickQuestion(['a'], new Set(['a']));
  assert.equal(picked, 'a');
});
