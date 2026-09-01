import test from 'node:test';
import assert from 'node:assert/strict';

import {
  challengeSelectionForPlayer,
  freshInteraction,
  nextInteractionState,
  orderedChallengeSelection,
  renderChallengeRushTrial,
  renderOddOneOut,
  shouldPreserveInteractionOnMatchStart,
} from './views/challengeRush.js';

test('same-trial replay preserves partial sequence and matrix input', () => {
  const previous = freshInteraction('trial-1');
  previous.sequence.push(2, 4);
  previous.cells.push(1);
  const next = nextInteractionState(previous, { trialId: 'trial-1' });
  assert.deepEqual(next.sequence, [2, 4]);
  assert.deepEqual(next.cells, [1]);
});

test('a new trial resets local partial input', () => {
  const previous = freshInteraction('trial-1');
  previous.sequence.push(2, 4);
  assert.deepEqual(nextInteractionState(previous, { trialId: 'trial-2' }).sequence, []);
});

test('reconnect match-start preserves same-match partial input', () => {
  assert.equal(shouldPreserveInteractionOnMatchStart({ matchId: 'match-1' }, { matchId: 'match-1', reconnected: true }), true);
  assert.equal(shouldPreserveInteractionOnMatchStart({ matchId: 'match-1' }, { matchId: 'match-2', reconnected: true }), false);
  assert.equal(shouldPreserveInteractionOnMatchStart({ matchId: 'match-1' }, { matchId: 'match-1' }), false);
});

test('admin challenge selection keeps checkbox insertion order and is omitted for non-admins', () => {
  const catalog = [
    { key: 'binary-pattern', title: 'Binary pattern' },
    { key: 'digit-sum', title: 'Ziffernsumme' },
  ];
  const selected = new Set(['digit-sum', 'binary-pattern']);
  assert.deepEqual(orderedChallengeSelection(catalog, selected).map(({ key }) => key), ['digit-sum', 'binary-pattern']);
  assert.deepEqual(challengeSelectionForPlayer(catalog, selected, true), ['digit-sum', 'binary-pattern']);
  assert.deepEqual(challengeSelectionForPlayer(catalog, selected, false), []);
});

test('letter-order renders every compared letter as a prominent task element', () => {
  const html = renderChallengeRushTrial(
    { key: 'letter-order' },
    { phase: 'input', data: { type: 'letter-choice', prompt: 'Welcher Buchstabe steht alphabetisch zuerst?', letters: ['Q', 'B', 'M'], options: ['M', 'B', 'Q'] } },
  );
  assert.match(html, /challenge-rush-letter-row/);
  for (const letter of ['Q', 'B', 'M']) assert.match(html, new RegExp(`<span>${letter}</span>`));
});

test('odd-one-out keeps every field structurally equal and exposes all five visual levels', () => {
  for (let subtlety = 1; subtlety <= 5; subtlety += 1) {
    const html = renderOddOneOut({ tileCount: 16, oddIndex: 7, subtlety });
    assert.match(html, new RegExp(`data-cr-subtlety="${subtlety}"`));
    assert.match(html, /Form /);
    assert.doesNotMatch(html, /oddIndex|odd-at|is-odd|abweichend/i);
    assert.equal((html.match(/class="challenge-rush-tile"/g) ?? []).length, 16);
  }
});

test('memory-matrix preview exposes marked cells to assistive technology, not just visually', () => {
  const html = renderChallengeRushTrial(
    { key: 'memory-matrix' },
    { phase: 'preview', data: { type: 'matrix', size: 3, highlights: [1, 4] } },
  );
  assert.match(html, /aria-label="Feld 2, markiert"/);
  assert.match(html, /aria-label="Feld 5, markiert"/);
  assert.match(html, /aria-label="Feld 1"[^,]/);
});
