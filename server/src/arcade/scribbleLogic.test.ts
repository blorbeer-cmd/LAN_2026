import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildHintSchedule,
  hintCount,
  isCloseGuess,
  isMatchComplete,
  levenshteinDistance,
  nextDrawerIndex,
  pickWordChoices,
  pointsForDrawer,
  pointsForGuess,
  selectRoundWinnerIds,
  wordMask,
} from './scribbleLogic';

test('pickWordChoices prefers ids nobody has seen yet', () => {
  const rng = () => 0.99; // stable "shuffle" for a deterministic assertion
  const picked = pickWordChoices(['a', 'b', 'c', 'd'], new Set(['a', 'b']), 2, rng);
  assert.equal(picked.length, 2);
  assert.ok(picked.every((id) => id === 'c' || id === 'd'));
});

test('pickWordChoices falls back to seen ids when not enough fresh ones exist', () => {
  const picked = pickWordChoices(['a', 'b'], new Set(['a', 'b']), 3);
  assert.equal(picked.length, 2);
  assert.deepEqual(new Set(picked), new Set(['a', 'b']));
});

test('pickWordChoices returns nothing for an empty pool', () => {
  assert.deepEqual(pickWordChoices([], new Set(), 3), []);
});

test('wordMask hides letters but keeps spaces and hyphens visible', () => {
  assert.equal(wordMask('Ab-c d', new Set([0])), 'A _ - _   _');
});

test('hintCount scales with word length', () => {
  assert.equal(hintCount(3), 0);
  assert.equal(hintCount(4), 1);
  assert.equal(hintCount(5), 1);
  assert.equal(hintCount(6), 2);
  assert.equal(hintCount(12), 2);
});

test('buildHintSchedule reveals no letters for short words', () => {
  assert.deepEqual(buildHintSchedule('Eis', 60_000), []);
});

test('buildHintSchedule reveals two letters at 50%/75% of the turn for long words', () => {
  const schedule = buildHintSchedule('Respawn', 60_000, () => 0);
  assert.equal(schedule.length, 2);
  assert.deepEqual(
    schedule.map((s) => s.atMs),
    [30_000, 45_000]
  );
  const indices = schedule.map((s) => s.index);
  assert.equal(new Set(indices).size, 2);
});

test('pointsForGuess rewards speed but never gives zero for a correct guess', () => {
  assert.equal(pointsForGuess(60_000, 60_000), 300);
  assert.equal(pointsForGuess(0, 60_000), 1);
  assert.equal(pointsForGuess(30_000, 60_000), 150);
});

test('pointsForDrawer scales with the share of correct guessers', () => {
  assert.equal(pointsForDrawer(0, 4), 0);
  assert.equal(pointsForDrawer(4, 4), 100);
  assert.equal(pointsForDrawer(2, 4), 50);
  assert.equal(pointsForDrawer(1, 3), 33);
});

test('nextDrawerIndex skips offline players and wraps around', () => {
  const order = ['a', 'b', 'c', 'd'];
  assert.equal(nextDrawerIndex(order, 0, new Set(['a', 'b', 'c', 'd'])), 1);
  assert.equal(nextDrawerIndex(order, 3, new Set(['a', 'b', 'c', 'd'])), 0);
  assert.equal(nextDrawerIndex(order, 0, new Set(['a', 'd'])), 3);
});

test('nextDrawerIndex returns null when nobody is online', () => {
  assert.equal(nextDrawerIndex(['a', 'b'], 0, new Set()), null);
});

test('isMatchComplete compares turns played against rounds * player count', () => {
  assert.equal(isMatchComplete(5, 2, 3), false);
  assert.equal(isMatchComplete(6, 2, 3), true);
  assert.equal(isMatchComplete(0, 1, 0), true);
});

test('selectRoundWinnerIds prioritizes favorite votes and keeps exact ties', () => {
  assert.deepEqual(
    selectRoundWinnerIds([
      { id: 'a', favoriteVotes: 2, reactionCount: 1 },
      { id: 'b', favoriteVotes: 2, reactionCount: 3 },
      { id: 'c', favoriteVotes: 1, reactionCount: 9 },
    ]),
    ['b']
  );
  assert.deepEqual(
    selectRoundWinnerIds([
      { id: 'a', favoriteVotes: 2, reactionCount: 3 },
      { id: 'b', favoriteVotes: 2, reactionCount: 3 },
    ]),
    ['a', 'b']
  );
});

test('selectRoundWinnerIds falls back to reactions when nobody votes', () => {
  assert.deepEqual(
    selectRoundWinnerIds([
      { id: 'a', favoriteVotes: 0, reactionCount: 1 },
      { id: 'b', favoriteVotes: 0, reactionCount: 4 },
    ]),
    ['b']
  );
  assert.deepEqual(selectRoundWinnerIds([]), []);
});

test('levenshteinDistance counts single-character edits', () => {
  assert.equal(levenshteinDistance('katze', 'katze'), 0);
  assert.equal(levenshteinDistance('katze', 'katza'), 1); // substitution
  assert.equal(levenshteinDistance('katze', 'katz'), 1); // deletion
  assert.equal(levenshteinDistance('katz', 'katze'), 1); // insertion
  assert.equal(levenshteinDistance('', 'abc'), 3);
  assert.equal(levenshteinDistance('abc', ''), 3);
  assert.equal(levenshteinDistance('kitten', 'sitting'), 3);
});

test('isCloseGuess accepts a single typo after normalization, ignoring case/diacritics/punctuation', () => {
  assert.equal(isCloseGuess('Repawn', 'Respawn'), true); // missing letter
  assert.equal(isCloseGuess('Respawn!!', 'respawn'), false); // identical once normalized -> exact match, not "close"
  assert.equal(isCloseGuess('Löven', 'Loewe'), false); // two edits apart -> not close enough
  assert.equal(isCloseGuess('katze', 'hund'), false); // far off
});

test('isCloseGuess rejects an exact match (that path is handled elsewhere) and empty input', () => {
  assert.equal(isCloseGuess('Respawn', 'Respawn'), false);
  assert.equal(isCloseGuess('', 'Respawn'), false);
  assert.equal(isCloseGuess('   ', 'Respawn'), false);
});
