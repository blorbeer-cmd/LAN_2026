import assert from 'node:assert/strict';
import { test } from 'node:test';
import { E2E_PARTITIONS, E2E_SMOKE_FILES, selectedSourceFiles, validateE2EPartitions } from './run-e2e-partition.mjs';

test('every declared E2E file belongs to exactly one partition', () => {
  const files = [...E2E_PARTITIONS.core, ...E2E_PARTITIONS.arcade].sort();
  assert.doesNotThrow(() => validateE2EPartitions(files));
});

test('missing and absent assignments fail closed', () => {
  assert.throws(
    () => validateE2EPartitions(['newScenario.e2e.test.ts']),
    /nicht zugeordnet: newScenario\.e2e\.test\.ts.*nicht vorhanden:/,
  );
});

test('all preserves both explicit partitions', () => {
  assert.deepEqual(selectedSourceFiles('all'), [...E2E_PARTITIONS.core, ...E2E_PARTITIONS.arcade]);
  assert.throws(() => selectedSourceFiles('unknown'), /Unbekannte E2E-Partition/);
});

test('Arcade smoke is an explicit fast subset of the Arcade partition', () => {
  assert.deepEqual(selectedSourceFiles('arcade-smoke'), [...E2E_SMOKE_FILES]);
  assert.ok(E2E_SMOKE_FILES.length > 0);
  for (const file of E2E_SMOKE_FILES) assert.ok(E2E_PARTITIONS.arcade.includes(file), file);
});
