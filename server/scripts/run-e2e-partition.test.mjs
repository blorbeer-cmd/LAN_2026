import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import {
  CORE_E2E_DOMAINS,
  E2E_PARTITIONS,
  E2E_SMOKE_FILES,
  failedE2EOwnerFiles,
  selectedCoreDomains,
  selectedRetrySourceFiles,
  selectedSourceFiles,
  validateE2EPartitions,
} from './run-e2e-partition.mjs';
import { E2E_MANIFEST, validateE2EManifest } from '../../scripts/e2e-partitions.mjs';

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

test('deleted and duplicate assignments fail closed', () => {
  const files = [...E2E_PARTITIONS.core, ...E2E_PARTITIONS.arcade];
  assert.throws(
    () => validateE2EPartitions(files.filter((file) => file !== E2E_PARTITIONS.core[0])),
    /nicht vorhanden:/,
  );
  assert.throws(
    () =>
      validateE2EManifest(files, {
        ...E2E_MANIFEST,
        partitions: {
          core: [...E2E_PARTITIONS.core, E2E_PARTITIONS.arcade[0]],
          arcade: E2E_PARTITIONS.arcade,
        },
      }),
    /mehrfach zugeordnet:/,
  );
});

test('all preserves both explicit partitions', () => {
  assert.deepEqual(selectedSourceFiles('all'), [...E2E_PARTITIONS.core, ...E2E_PARTITIONS.arcade]);
  assert.throws(() => selectedSourceFiles('unknown'), /Unbekannte E2E-Partition/);
});

test('Arcade smoke is an explicit fast subset of the Arcade partition', () => {
  assert.deepEqual(selectedSourceFiles('arcade-smoke'), [...E2E_SMOKE_FILES]);
  assert.deepEqual(E2E_SMOKE_FILES, ['arcadeSmoke.e2e.test.ts', 'authGateArcade.e2e.test.ts']);
  for (const file of E2E_SMOKE_FILES) assert.ok(E2E_PARTITIONS.arcade.includes(file), file);
});

test('Core domains select stable, deduplicated fixture sets', () => {
  assert.deepEqual(selectedCoreDomains('all'), ['auth', 'checklist', 'invitations', 'flows']);
  assert.deepEqual(selectedCoreDomains('flows,auth,auth'), ['auth', 'flows']);
  assert.deepEqual(selectedSourceFiles('core', 'auth,checklist'), [
    ...CORE_E2E_DOMAINS.auth,
    ...CORE_E2E_DOMAINS.checklist,
  ]);
  assert.deepEqual(selectedSourceFiles('core'), E2E_PARTITIONS.core);
  assert.throws(() => selectedSourceFiles('core', 'unknown'), /Ungültige Core-E2E-Auswahl/);
});

test('targeted retries read, deduplicate, and preserve the selected partition order', (context) => {
  const artifactDirectory = mkdtempSync(path.join(tmpdir(), 'e2e-retry-'));
  context.after(() => rmSync(artifactDirectory, { recursive: true, force: true }));
  const selected = E2E_PARTITIONS.arcade.slice(0, 3);
  for (const [directory, ownerFile] of [
    ['failure-a', selected[2]],
    ['failure-b', selected[0]],
    ['nested/failure-c', selected[2]],
  ]) {
    const target = path.join(artifactDirectory, directory);
    mkdirSync(target, { recursive: true });
    writeFileSync(path.join(target, 'metadata.json'), JSON.stringify({ ownerFile }));
  }

  assert.deepEqual(failedE2EOwnerFiles(artifactDirectory), [selected[2], selected[0]]);
  assert.deepEqual(selectedRetrySourceFiles(selected, artifactDirectory), [selected[0], selected[2]]);
});

test('targeted retries fail closed without trustworthy in-scope owner metadata', (context) => {
  const artifactDirectory = mkdtempSync(path.join(tmpdir(), 'e2e-retry-'));
  context.after(() => rmSync(artifactDirectory, { recursive: true, force: true }));
  assert.throws(
    () => failedE2EOwnerFiles(path.join(artifactDirectory, 'missing')),
    /vorhandenes E2E_ARTIFACT_DIR/,
  );
  assert.throws(() => failedE2EOwnerFiles(artifactDirectory), /keine metadata\.json/);

  const failureDirectory = path.join(artifactDirectory, 'failure');
  mkdirSync(failureDirectory);
  writeFileSync(path.join(failureDirectory, 'metadata.json'), JSON.stringify({ ownerFile: '../bad.ts' }));
  assert.throws(() => failedE2EOwnerFiles(artifactDirectory), /Ungültige E2E-Owner-Datei/);

  writeFileSync(
    path.join(failureDirectory, 'metadata.json'),
    JSON.stringify({ ownerFile: E2E_PARTITIONS.arcade[0] }),
  );
  assert.throws(
    () => selectedRetrySourceFiles(E2E_PARTITIONS.core, artifactDirectory),
    /außerhalb der gewählten Partition/,
  );
});
