import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeSkillSuggestionsForGame, type SkillSuggestionMatch } from './skillSuggestion';

function match(
  teams: string[][],
  winnerTeamIndex: number | null,
  playedAt: number
): SkillSuggestionMatch {
  return { teams: teams.map((playerIds) => ({ playerIds })), winnerTeamIndex, playedAt };
}

test('computeSkillSuggestionsForGame returns nothing for an empty match list', () => {
  assert.deepEqual(computeSkillSuggestionsForGame([]), []);
});

test('a lone winner ends up rated above a lone loser after one match', () => {
  const suggestions = computeSkillSuggestionsForGame([match([['a'], ['b']], 0, 1)]);
  const a = suggestions.find((s) => s.playerId === 'a')!;
  const b = suggestions.find((s) => s.playerId === 'b')!;
  assert.ok(a.rating > b.rating, `expected a (${a.rating}) > b (${b.rating})`);
  assert.equal(a.gamesPlayed, 1);
  assert.equal(a.wins, 1);
  assert.equal(b.gamesPlayed, 1);
  assert.equal(b.wins, 0);
});

test('a player who never wins converges toward the low end (clamped at 1, never below)', () => {
  const matches: SkillSuggestionMatch[] = [];
  for (let i = 0; i < 20; i++) matches.push(match([['loser'], ['winner']], 1, i));
  const suggestions = computeSkillSuggestionsForGame(matches);
  const loser = suggestions.find((s) => s.playerId === 'loser')!;
  const winner = suggestions.find((s) => s.playerId === 'winner')!;
  assert.ok(loser.rating >= 1 && loser.rating <= 10);
  assert.ok(winner.rating >= 1 && winner.rating <= 10);
  assert.ok(winner.rating > loser.rating);
  assert.equal(winner.wins, 20);
  assert.equal(loser.wins, 0);
});

test('team ratings are the average of their members, and results are processed chronologically', () => {
  // Out of order on purpose — playedAt drives the order, not array position.
  const matches: SkillSuggestionMatch[] = [
    match([['a', 'b'], ['c', 'd']], 0, 2000),
    match([['a', 'b'], ['c', 'd']], 0, 1000),
  ];
  const suggestions = computeSkillSuggestionsForGame(matches);
  const ids = suggestions.map((s) => s.playerId).sort();
  assert.deepEqual(ids, ['a', 'b', 'c', 'd']);
  for (const s of suggestions) assert.equal(s.gamesPlayed, 2);
});

test('undecided matches (no winner) are ignored entirely', () => {
  const suggestions = computeSkillSuggestionsForGame([match([['a'], ['b']], null, 1)]);
  assert.deepEqual(suggestions, []);
});

test('matches with more than two teams are ignored (no clear 1v1 update)', () => {
  const suggestions = computeSkillSuggestionsForGame([match([['a'], ['b'], ['c']], 0, 1)]);
  assert.deepEqual(suggestions, []);
});

test('every returned rating stays within the 1-10 range', () => {
  const matches: SkillSuggestionMatch[] = [];
  for (let i = 0; i < 50; i++) matches.push(match([['champ'], ['punchingbag']], 0, i));
  const suggestions = computeSkillSuggestionsForGame(matches);
  for (const s of suggestions) {
    assert.ok(Number.isInteger(s.rating));
    assert.ok(s.rating >= 1 && s.rating <= 10);
  }
});
