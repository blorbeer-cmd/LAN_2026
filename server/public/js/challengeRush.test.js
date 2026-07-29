import test from 'node:test';
import assert from 'node:assert/strict';

import {
  freshInteraction,
  nextInteractionState,
  pairHideStillApplies,
  renderChallengeRushTrial,
  renderOddOneOut,
} from './views/challengeRush.js';

test('same-trial replay preserves partial sequence and matrix input while merging server resume state', () => {
  const previous = freshInteraction('trial-1');
  previous.sequence.push(2, 4);
  previous.cells.push(1);
  const next = nextInteractionState(previous, {
    trialId: 'trial-1',
    resume: {
      found: [0, 3],
      revealed: [2],
      foundCards: [{ index: 0, value: '◆' }, { index: 3, value: '◆' }],
      revealedCards: [{ index: 2, value: '●' }],
      revealSeq: 4,
    },
  });
  assert.deepEqual(next.sequence, [2, 4]);
  assert.deepEqual(next.cells, [1]);
  assert.deepEqual([...next.found], [0, 3]);
  assert.deepEqual(next.pair, [2]);
  assert.equal(next.values.get(2), '●');
  assert.equal(next.revealSeq, 4);
});

test('a new trial resets local partial input', () => {
  const previous = freshInteraction('trial-1');
  previous.sequence.push(2, 4);
  assert.deepEqual(nextInteractionState(previous, { trialId: 'trial-2', resume: {} }).sequence, []);
});

test('pair hide guard rejects an obsolete timer after another reveal', () => {
  const state = freshInteraction('trial-1');
  state.revealSeq = 2;
  assert.equal(pairHideStillApplies(state, 'trial-1', 2), true);
  state.revealSeq = 3;
  assert.equal(pairHideStillApplies(state, 'trial-1', 2), false);
  assert.equal(pairHideStillApplies(state, 'trial-2', 3), false);
});

test('sequence-transform renders only the displayed terms, never the expected answer', () => {
  const html = renderChallengeRushTrial(
    { key: 'sequence-transform' },
    { phase: 'input', data: { prompt: '2 → 5 → 11 → ?', options: ['22', '23', '24', '25'] }, expected: '23' },
  );
  assert.match(html, /2 → 5 → 11 → \?/);
  assert.doesNotMatch(html, />23 →/);
});

test('odd-one-out keeps every field structurally equal and exposes all five visual levels', () => {
  for (let subtlety = 1; subtlety <= 5; subtlety += 1) {
    const html = renderOddOneOut({ tileCount: 16, oddIndex: 7, subtlety });
    assert.match(html, new RegExp(`data-cr-subtlety="${subtlety}"`));
    assert.match(html, /cr-odd-at-7/);
    assert.doesNotMatch(html, /is-odd|abweichend/i);
    assert.equal((html.match(/class="challenge-rush-tile"/g) ?? []).length, 16);
  }
});
