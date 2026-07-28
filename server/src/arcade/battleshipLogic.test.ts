import assert from 'node:assert/strict';
import test from 'node:test';
import { applyShot, chooseBotShot, createRandomPlacements, remainingSegments, validatePlacements } from './battleshipLogic';

const validPlacements = [
  { shipId: 'carrier', row: 0, col: 0, orientation: 'horizontal' },
  { shipId: 'battleship', row: 2, col: 0, orientation: 'horizontal' },
  { shipId: 'cruiser', row: 4, col: 0, orientation: 'horizontal' },
  { shipId: 'submarine', row: 6, col: 0, orientation: 'horizontal' },
  { shipId: 'destroyer', row: 8, col: 0, orientation: 'horizontal' },
];

test('validates a complete fleet and rejects overlaps', () => {
  const result = validatePlacements(validPlacements);
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(remainingSegments(result.fleet), 17);
  const overlap = validatePlacements([...validPlacements.slice(0, 4), { ...validPlacements[4], row: 0, col: 4 }]);
  assert.equal(overlap.ok, false);
});

test('rejects ships outside the board and duplicate ships', () => {
  assert.equal(validatePlacements([{ ...validPlacements[0], col: 7 }, ...validPlacements.slice(1)]).ok, false);
  assert.equal(validatePlacements([validPlacements[0], { ...validPlacements[0], row: 2 }, ...validPlacements.slice(2)]).ok, false);
  assert.equal(validatePlacements(validPlacements.slice(0, 4)).ok, false);
  assert.equal(validatePlacements([{ ...validPlacements[0], orientation: 'diagonal' }, ...validPlacements.slice(1)]).ok, false);
  assert.equal(validatePlacements([{ ...validPlacements[0], row: -1 }, ...validPlacements.slice(1)]).ok, false);
});

test('accepts vertical ships ending exactly at the lower and right board edges', () => {
  const vertical = [
    { shipId: 'carrier', row: 5, col: 9, orientation: 'vertical' },
    { shipId: 'battleship', row: 6, col: 7, orientation: 'vertical' },
    { shipId: 'cruiser', row: 7, col: 5, orientation: 'vertical' },
    { shipId: 'submarine', row: 7, col: 3, orientation: 'vertical' },
    { shipId: 'destroyer', row: 8, col: 1, orientation: 'vertical' },
  ];
  const result = validatePlacements(vertical);
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(remainingSegments(result.fleet), 17);
});

test('resolves miss, hit, sunk and duplicate shots atomically', () => {
  const result = validatePlacements(validPlacements);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const fired = new Set<number>();
  const miss = applyShot(result.fleet, fired, 9, 9);
  assert.equal(miss.ok, true);
  if (miss.ok) assert.equal(miss.kind, 'miss');
  const firstHit = applyShot(result.fleet, fired, 0, 0);
  assert.equal(firstHit.ok, true);
  if (firstHit.ok) assert.equal(firstHit.kind, 'hit');
  assert.equal(applyShot(result.fleet, fired, 0, 0).ok, false);
  for (let col = 1; col < 5; col += 1) {
    const shot = applyShot(result.fleet, fired, 0, col);
    assert.equal(shot.ok, true);
    if (shot.ok) assert.equal(shot.kind, col === 4 ? 'sunk' : 'hit');
  }
  assert.equal(remainingSegments(result.fleet), 12);
});

test('the final fleet segment reports zero remaining and invalid coordinates never mutate shots', () => {
  const result = validatePlacements(validPlacements);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const fired = new Set<number>();
  assert.equal(applyShot(result.fleet, fired, -1, 0).ok, false);
  assert.equal(applyShot(result.fleet, fired, 10, 0).ok, false);
  assert.equal(fired.size, 0);

  let lastRemaining = 17;
  for (const ship of result.fleet) {
    for (const cell of ship.cells) {
      const shot = applyShot(result.fleet, fired, Math.floor(cell / 10), cell % 10);
      assert.equal(shot.ok, true);
      if (shot.ok) lastRemaining = shot.remainingSegments;
    }
  }
  assert.equal(lastRemaining, 0);
  assert.equal(remainingSegments(result.fleet), 0);
});

test('creates a valid random bot fleet', () => {
  const placements = createRandomPlacements(() => 0.42);
  const result = validatePlacements(placements);
  assert.equal(result.ok, true);
  assert.equal(new Set(placements.map((placement) => placement.shipId)).size, 5);
});

test('the bot follows up next to hits before searching the remaining board', () => {
  const fired = new Set([1, 10, 11]);
  assert.equal(chooseBotShot(fired, [11], () => 0), 21);
  assert.equal(chooseBotShot(new Set([0, 1, 10]), [], () => 0), 2);
  assert.equal(chooseBotShot(new Set(Array.from({ length: 100 }, (_, cell) => cell)), [], () => 0), null);
});
