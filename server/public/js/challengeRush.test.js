import test from 'node:test';
import assert from 'node:assert/strict';

import {
  acknowledgedRevealSeq,
  challengeSelectionForPlayer,
  freshInteraction,
  memoryRevealSchedule,
  nextInteractionState,
  orderedChallengeSelection,
  pairHideStillApplies,
  renderChallengeRushTrial,
  renderOddOneOut,
  shouldPreserveInteractionOnMatchStart,
  timedChallengeFocusSelector,
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
  state.revealSeq = acknowledgedRevealSeq(1, 2);
  const staleTimerSequence = state.revealSeq;
  assert.equal(pairHideStillApplies(state, 'trial-1', staleTimerSequence), true);
  const reconnected = nextInteractionState(state, { trialId: 'trial-1', resume: { revealSeq: 3 } });
  assert.equal(reconnected.revealSeq, 3);
  assert.equal(pairHideStillApplies(reconnected, 'trial-1', staleTimerSequence), false);
  assert.equal(pairHideStillApplies(state, 'trial-2', 3), false);
});

test('reconnect match-start preserves same-match partial input', () => {
  assert.equal(shouldPreserveInteractionOnMatchStart({ matchId: 'match-1' }, { matchId: 'match-1', reconnected: true }), true);
  assert.equal(shouldPreserveInteractionOnMatchStart({ matchId: 'match-1' }, { matchId: 'match-2', reconnected: true }), false);
  assert.equal(shouldPreserveInteractionOnMatchStart({ matchId: 'match-1' }, { matchId: 'match-1' }), false);
});

test('memory reveal acknowledgements use the authoritative server sequence', () => {
  assert.equal(acknowledgedRevealSeq(3, 3), 3);
  assert.equal(acknowledgedRevealSeq(3, 4), 4);
  assert.equal(acknowledgedRevealSeq(3, undefined), 4);
});

test('memory reveal schedule follows the server timing and preserves production defaults', () => {
  assert.deepEqual(memoryRevealSchedule(undefined, 7), { stepMs: 700, showMs: 500, totalMs: 4_900 });
  const fast = memoryRevealSchedule(50, 7);
  assert.equal(fast.totalMs, 50);
  assert.equal(fast.stepMs * 7, 50);
  assert.equal(fast.showMs / fast.stepMs, 5 / 7);
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

test('timed target focus is requested only while its challenge is actively playable', () => {
  assert.equal(timedChallengeFocusSelector({ phase: 'playing', paused: false, challenge: { key: 'aim-trainer' } }), '.challenge-rush-circle');
  assert.equal(timedChallengeFocusSelector({ phase: 'playing', paused: false, challenge: { key: 'whack-a-mole' } }), '.challenge-rush-tile.is-active');
  assert.equal(timedChallengeFocusSelector({ phase: 'countdown', paused: false, challenge: { key: 'aim-trainer' } }), '');
  assert.equal(timedChallengeFocusSelector({ phase: 'playing', paused: true, challenge: { key: 'whack-a-mole' } }), '');
});

test('an older memory resume cannot replace newer pair state', () => {
  const state = freshInteraction('trial-1');
  state.revealSeq = 3;
  state.found.add(0);
  state.pair = [4];
  state.values.set(4, '◆');
  const replay = nextInteractionState(state, { trialId: 'trial-1', resume: { revealSeq: 2, found: [], revealed: [] } });
  assert.equal(replay.revealSeq, 3);
  assert.deepEqual([...replay.found], [0]);
  assert.deepEqual(replay.pair, [4]);
  assert.equal(replay.values.get(4), '◆');
});

test('sequence-transform renders only the displayed terms, never the expected answer', () => {
  const html = renderChallengeRushTrial(
    { key: 'sequence-transform' },
    { phase: 'input', data: { prompt: '2 → 5 → 11 → ?', options: ['22', '23', '24', '25'] }, expected: '23' },
  );
  assert.match(html, /2 → 5 → 11 → \?/);
  assert.doesNotMatch(html, />23 →/);
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
