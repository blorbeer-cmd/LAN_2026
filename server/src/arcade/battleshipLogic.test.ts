import assert from 'node:assert/strict';
import test from 'node:test';
import { applyShot, remainingSegments, validatePlacements } from './battleshipLogic';

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
