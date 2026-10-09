import assert from 'node:assert/strict';
import test from 'node:test';
import { chimpCellLabel, chimpGridModel, chimpNeighbor, chimpRatingText, chimpRunEndDetails, chimpStageMode, chimpTimeText } from './chimpFormat.js';

const memorize = { phase: 'memorize', numbers: [{ cell: 12, number: 1 }, { cell: 3, number: 2 }, { cell: 30, number: 3 }] };

test('the first tap hides every remaining number before the server ack arrives', () => {
  const shown = chimpGridModel(memorize);
  assert.deepEqual([shown[12], shown[3], shown[30], shown[0]], [{ kind: 'number', number: 1 }, { kind: 'number', number: 2 }, { kind: 'number', number: 3 }, { kind: 'empty' }]);
  const tapped = chimpGridModel(memorize, null, [12]);
  assert.deepEqual([tapped[12], tapped[3], tapped[30]], [{ kind: 'empty' }, { kind: 'hidden' }, { kind: 'hidden' }]);
  assert.ok(tapped.every((cell) => cell.number === undefined));
});

test('input and reveal states carry numbers only after the attempt is over', () => {
  const input = chimpGridModel({ phase: 'input', hiddenCells: [3, 30] }, null, [30]);
  assert.deepEqual([input[3], input[30], input[12]], [{ kind: 'hidden' }, { kind: 'empty' }, { kind: 'empty' }]);
  assert.match(chimpCellLabel(3, input[3]), /^Verdecktes Feld/);
  const reveal = chimpGridModel({ phase: 'reveal' }, { layout: [12, 3, 30], wrongCell: 30, expectedNumber: 2 });
  assert.deepEqual([reveal[12], reveal[3], reveal[30]], [
    { kind: 'revealed', number: 1, wrong: false },
    { kind: 'revealed', number: 2, wrong: false },
    { kind: 'revealed', number: 3, wrong: true },
  ]);
});

test('arrow keys follow the drawn layout and stop at the edges', () => {
  // Laptop: rows of 8.
  assert.equal(chimpNeighbor(0, 'ArrowRight'), 1);
  assert.equal(chimpNeighbor(7, 'ArrowRight'), null);
  assert.equal(chimpNeighbor(8, 'ArrowLeft'), null);
  assert.equal(chimpNeighbor(3, 'ArrowDown'), 11);
  assert.equal(chimpNeighbor(35, 'ArrowDown'), null);
  // Phone: columns of 8.
  assert.equal(chimpNeighbor(0, 'ArrowDown', true), 1);
  assert.equal(chimpNeighbor(7, 'ArrowDown', true), null);
  assert.equal(chimpNeighbor(3, 'ArrowRight', true), 11);
  assert.equal(chimpNeighbor(35, 'ArrowRight', true), null);
  assert.equal(chimpNeighbor(3, 'Enter'), null);
});

test('a finished run or round shows the result even if the host paused before ending', () => {
  assert.equal(chimpStageMode({ phase: 'ended', paused: true, me: { phase: 'out' } }), 'result');
  assert.equal(chimpStageMode({ phase: 'playing', paused: true, me: { phase: 'out' } }), 'result');
  assert.equal(chimpStageMode({ phase: 'playing', paused: true, me: { phase: 'input' } }), 'paused');
  assert.equal(chimpStageMode({ phase: 'countdown', paused: false, me: null }), 'countdown');
  assert.equal(chimpStageMode({ phase: 'playing', paused: false, me: { phase: 'interstitial' } }), 'interstitial');
  assert.equal(chimpStageMode({ phase: 'playing', paused: false, me: { phase: 'memorize' } }), 'grid');
});

test('result details survive a reload and an invalid run stays invalid without them', () => {
  const pushed = { invalid: false, previousBest: 6, newBest: true, rank: 2 };
  assert.deepEqual(chimpRunEndDetails(pushed, { endReason: 'strikes' }), pushed);
  // After a reload only the restored state carries the details.
  assert.deepEqual(chimpRunEndDetails(null, { endReason: 'strikes', endDetails: pushed }), pushed);
  assert.deepEqual(chimpRunEndDetails(null, { endReason: 'invalid', endDetails: null }), { invalid: true, previousBest: null, newBest: false, rank: null });
});

test('formats the chimp rating and active time in German', () => {
  assert.equal(chimpRatingText({ percent: 89, beyond: 0, tier: 'Fast Ayumu' }), '89 % · Fast Ayumu');
  assert.equal(chimpRatingText({ percent: null, beyond: 3, tier: 'Silberrücken' }), 'Ayumu übertroffen (+3) · Silberrücken');
  assert.equal(chimpTimeText(42_340), '42,3 s');
  assert.equal(chimpTimeText(65_400), '1:05 min');
});
