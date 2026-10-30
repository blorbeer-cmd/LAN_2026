import { test } from 'node:test';
import assert from 'node:assert/strict';
import { distributePool } from './bettingMath';

test('pools distribute existing stakes exactly, refund invalid rounds, and allocate fractional remainders deterministically', () => {
  const tips = [
    { id: 'a', outcomeId: 'blue', stake: 10 },
    { id: 'b', outcomeId: 'blue', stake: 30 },
    { id: 'c', outcomeId: 'red', stake: 20 },
  ];
  assert.deepEqual([...distributePool(tips, 'blue').values()], [15, 45, 0]);
  assert.deepEqual([...distributePool(tips, 'red').values()], [0, 0, 60]);
  assert.deepEqual([...distributePool(tips, null).values()], [10, 30, 20]);
  assert.deepEqual([...distributePool(tips, 'unknown').values()], [10, 30, 20]);
  for (let size = 2; size < 25; size++) {
    const pool = Array.from({ length: size }, (_, i) => ({
      id: String(i).padStart(3, '0'),
      outcomeId: i % 2 ? 'a' : 'b',
      stake: ((i * 7) % 10) + 1,
    }));
    for (const winner of ['a', 'b']) {
      const result = distributePool(pool, winner);
      assert.equal(
        [...result.values()].reduce((a, b) => a + b, 0),
        pool.reduce((a, b) => a + b.stake, 0),
      );
      assert.deepEqual(distributePool([...pool].reverse(), winner), result);
      assert.ok([...result.values()].every(Number.isInteger));
    }
  }
});
