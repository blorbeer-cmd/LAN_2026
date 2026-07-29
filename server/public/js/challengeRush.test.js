import test from 'node:test';
import assert from 'node:assert/strict';
import { renderChallengeRushTrial } from './views/challengeRush.js';

const challenge = (key) => ({ key, title: key, description: '', durationMs: 30_000 });
const trial = (data, phase = 'input') => ({ trialId: 'fixture', index: 0, difficulty: 1, phase, phaseMs: phase === 'preview' ? 500 : 0, data });

test('sequence renderers expose the remembered order without animation races', () => {
  const html = renderChallengeRushTrial(challenge('sequence-echo'), trial({ type: 'sequence', size: 3, sequence: [0, 4, 8] }, 'preview'), false);
  assert.match(html, /Schritt 1/);
  assert.match(html, /Schritt 2/);
  assert.match(html, /Schritt 3/);
});

test('odd-one-out renders a visible odd tile and accessible label', () => {
  const html = renderChallengeRushTrial(challenge('odd-one-out'), trial({ type: 'odd-one-out', tileCount: 9, size: 3, oddIndex: 4 }));
  assert.match(html, /is-odd/);
  assert.match(html, /Abweichendes Feld/);
});

test('memory pairs never send card values to the browser', () => {
  const html = renderChallengeRushTrial(challenge('memory-pairs'), trial({ type: 'pairs', boardSize: 2, cards: [{ index: 0 }, { index: 1 }, { index: 2 }, { index: 3 }] }));
  assert.doesNotMatch(html, /value/);
  assert.match(html, /Karte 1/);
});

test('number blind hides values and suitcase asks for the target position', () => {
  const blind = renderChallengeRushTrial(challenge('number-blind'), trial({ type: 'number-blind', size: 3, numbers: [{ number: 1, position: 2 }] }));
  assert.match(blind, /Position 3/);
  assert.match(blind, />\?<\/button>/);
  const suitcase = renderChallengeRushTrial(challenge('suitcase-memory'), trial({ type: 'suitcase', position: 2, items: ['Schlüssel'], options: ['Schlüssel', 'Lampe'] }));
  assert.match(suitcase, /Position 2/);
});
