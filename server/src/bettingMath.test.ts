import { test } from 'node:test';
import assert from 'node:assert/strict';
import { distributePool } from './bettingMath';

test('pools distribute existing stakes exactly, refund invalid rounds, and allocate fractional remainders deterministically', () => {
  const tips = [
    { id: 'a', outcomeId: 'blue', stake: 10, createdAt: 1, sequence: 1 },
    { id: 'b', outcomeId: 'blue', stake: 30, createdAt: 2, sequence: 2 },
    { id: 'c', outcomeId: 'red', stake: 20, createdAt: 3, sequence: 3 },
  ];
  assert.deepEqual([...distributePool(tips, 'blue').values()], [15, 45, 0]);
  assert.deepEqual([...distributePool(tips, 'red').values()], [0, 0, 60]);
  assert.deepEqual([...distributePool(tips, null).values()], [10, 30, 20]);
  assert.deepEqual([...distributePool(tips, 'unknown').values()], [10, 30, 20]);
  assert.deepEqual([...distributePool([
    { ...tips[0], stake: 5 }, { ...tips[1], stake: 3 }, { ...tips[2], stake: 2 },
  ], 'blue').values()], [6, 4, 0], 'the larger fractional share receives the remainder, not the larger stake');
  const equal = [
    { ...tips[0], id: 'z-early', stake: 10, createdAt: 100, sequence: 1 },
    { ...tips[1], id: 'a-later', stake: 10, createdAt: 101, sequence: 2 },
    { ...tips[2], stake: 1, createdAt: 102, sequence: 3 },
  ];
  assert.equal(distributePool(equal, 'blue').get('z-early'), 11, 'submission time precedes random IDs');
  equal[1].createdAt = 100;
  assert.equal(distributePool(equal, 'blue').get('z-early'), 11, 'persisted submission order breaks equal timestamps');
  assert.deepEqual(distributePool([...equal].reverse(), 'blue'), distributePool(equal, 'blue'));
  for (let size = 2; size < 25; size++) {
    const pool = Array.from({ length: size }, (_, i) => ({
      id: String(i).padStart(3, '0'),
      outcomeId: i % 2 ? 'a' : 'b',
      stake: ((i * 7) % 10) + 1,
      createdAt: i,
      sequence: i,
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
