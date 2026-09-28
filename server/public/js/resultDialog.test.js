import assert from 'node:assert/strict';
import test from 'node:test';
import { resultFormHtml, resultRanks, resultWinnerIndex } from './resultDialog.js';

test('score ranks share places on ties and the unique highest score wins', () => {
  assert.deepEqual(resultRanks([5, 8, 8, 0]), [3, 1, 1, 4]);
  assert.equal(resultWinnerIndex([5, 8, 8, 0]), null);
  assert.equal(resultWinnerIndex([5, 9, 8, 0]), 1);
});

test('six teams get identical score rows and one explicit save action', () => {
  const teams = Array.from({ length: 6 }, (_, index) => ({ name: `Team ${index + 1}`, players: [`Person ${index + 1}`] }));
  const html = resultFormHtml({ teams, prefix: 'test', mode: 'score' });
  assert.equal((html.match(/class="result-score-row"/g) ?? []).length, 6);
  assert.equal((html.match(/data-result-save/g) ?? []).length, 1);
  assert.match(html, /aria-label="Punktestand Team 6"/);
  assert.doesNotMatch(html, /data-result-rank[^>]*type="number"/);
});

test('knockout winner choices omit draw and the fixed mode has no switch', () => {
  const html = resultFormHtml({ teams: [{ name: 'A' }, { name: 'B' }], prefix: 'ko', fixedMode: true, allowDraw: false });
  assert.equal((html.match(/type="radio"/g) ?? []).length, 2);
  assert.doesNotMatch(html, /Unentschieden|data-result-mode/);
  assert.match(html, /data-result-save/);
});
