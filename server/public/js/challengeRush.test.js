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

test('whack-a-mole preview exposes every remembered step in order', () => {
  const html = renderChallengeRushTrial(challenge('whack-a-mole'), trial({ type: 'whack-a-mole', size: 3, sequence: [5, 1, 7, 3] }, 'preview'), false);
  assert.match(html, /Schritt 1/);
  assert.match(html, /Schritt 4/);
});

test('odd-one-out keeps the visual difference without revealing it in the accessible name', () => {
  const html = renderChallengeRushTrial(challenge('odd-one-out'), trial({ type: 'odd-one-out', tileCount: 9, size: 3, oddIndex: 4 }));
  assert.match(html, /is-odd/);
  assert.doesNotMatch(html, /Abweichendes Feld/);
  assert.match(html, /aria-label="Feld 5"/);
});

test('memory pairs reveal only server-approved cards and keep found values visible', () => {
  const current = { ...trial({ type: 'pairs', boardSize: 2, cards: [{ index: 0 }, { index: 1 }, { index: 2 }, { index: 3 }] }), resume: { found: [0, 2], foundCards: [{ index: 0, value: '◆' }, { index: 2, value: '◆' }] } };
  const html = renderChallengeRushTrial(challenge('memory-pairs'), current);
  assert.match(html, /Karte 1: ◆/);
  assert.match(html, />◆<\/button>/);
  assert.match(html, /Karte 2/);
});

test('number blind hides values and suitcase asks for the target position', () => {
  const blind = renderChallengeRushTrial(challenge('number-blind'), trial({ type: 'number-blind', size: 3, numbers: [{ number: 1, position: 2 }] }));
  assert.match(blind, /Position 3/);
  assert.match(blind, />\?<\/button>/);
  const suitcase = renderChallengeRushTrial(challenge('suitcase-memory'), trial({ type: 'suitcase', position: 2, items: ['Schlüssel'], options: ['Schlüssel', 'Lampe'] }));
  assert.match(suitcase, /Position 2/);
});

test('N-back states N explicitly and missing-item shows the reduced group', () => {
  const nBack = renderChallengeRushTrial(challenge('n-back'), trial({ type: 'choice', symbol: '◆', n: 2, itemIndex: 5 }));
  assert.match(nBack, /vor 2 Schritten/);
  const missing = renderChallengeRushTrial(challenge('missing-item'), trial({ type: 'missing', items: ['Becher', 'Würfel'], options: ['Lampe', 'Becher', 'Würfel'] }));
  assert.match(missing, /Becher/);
  assert.match(missing, /Welcher Gegenstand fehlt/);
});

test('matrix-missing renders a structured two-by-two grid', () => {
  const html = renderChallengeRushTrial(challenge('matrix-missing'), trial({ type: 'matrix-choice', matrix: [[3, 4], [9, null]], options: ['10', '11'] }));
  assert.match(html, /role="grid"/);
  assert.match(html, /Gesuchte Zahl/);
  assert.match(html, />\?</);
});
