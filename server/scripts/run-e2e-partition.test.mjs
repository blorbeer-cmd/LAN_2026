import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  CORE_E2E_DOMAINS,
  E2E_PARTITIONS,
  E2E_SMOKE_FILES,
  e2eArtifactDirectory,
  failedE2EOwnerFiles,
  runE2EPartition,
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
    /vorhandene Diagnoseartefakte/,
  );
  assert.throws(() => failedE2EOwnerFiles(artifactDirectory), /keine metadata\.json/);

  const failureDirectory = path.join(artifactDirectory, 'failure');
  mkdirSync(failureDirectory);
  writeFileSync(path.join(failureDirectory, 'metadata.json'), '{broken');
  assert.throws(() => failedE2EOwnerFiles(artifactDirectory), /Ungültige E2E-Diagnosemetadaten/);

  writeFileSync(path.join(failureDirectory, 'metadata.json'), JSON.stringify({}));
  assert.throws(() => failedE2EOwnerFiles(artifactDirectory), /Ungültige E2E-Owner-Datei/);

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

test('the retry environment variable controls the final files passed to the test runner', (context) => {
  const artifactDirectory = mkdtempSync(path.join(tmpdir(), 'e2e-retry-contract-'));
  context.after(() => rmSync(artifactDirectory, { recursive: true, force: true }));
  const failureDirectory = path.join(artifactDirectory, 'failure');
  mkdirSync(failureDirectory);
  writeFileSync(
    path.join(failureDirectory, 'metadata.json'),
    JSON.stringify({ ownerFile: E2E_SMOKE_FILES[1] }),
  );
  const allSourceFiles = [...E2E_PARTITIONS.core, ...E2E_PARTITIONS.arcade].sort();
  const compiledDirectory = path.join(artifactDirectory, 'compiled');
  const spawnCalls = [];
  const spawn = (command, args, options) => {
    spawnCalls.push({ command, args, options });
    return { status: 0 };
  };
  const common = {
    argv: ['node', 'run-e2e-partition.mjs', 'arcade-smoke'],
    sourceFiles: allSourceFiles,
    compiledDirectory,
    fileExists: () => true,
    spawn,
    log: () => undefined,
  };

  assert.equal(runE2EPartition({
    ...common,
    env: { E2E_ARTIFACT_DIR: artifactDirectory, E2E_RETRY_FAILED_ONLY: '1' },
  }), 0);
  assert.equal(spawnCalls[0].args[0], '--import');
  assert.match(spawnCalls[0].args[1], /e2e-owner-diagnostics\.mjs$/);
  assert.deepEqual(
    spawnCalls[0].args.slice(spawnCalls[0].args.indexOf('--test-concurrency=6') + 1),
    [path.join(compiledDirectory, E2E_SMOKE_FILES[1].replace(/\.ts$/, '.js'))],
  );

  assert.equal(runE2EPartition({ ...common, env: {} }), 0);
  assert.deepEqual(
    spawnCalls[1].args.slice(spawnCalls[1].args.indexOf('--test-concurrency=6') + 1),
    E2E_SMOKE_FILES.map((file) => path.join(compiledDirectory, file.replace(/\.ts$/, '.js'))),
  );
});

test('targeted retries use the same local artifact default as E2E diagnostics', () => {
  const serverDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  assert.equal(
    e2eArtifactDirectory({}),
    path.join(serverDirectory, 'test-results', 'e2e'),
  );
});

test('test-process failures persist owner metadata even when hooks fail outside wrappers', (context) => {
  const root = mkdtempSync(path.join(tmpdir(), 'e2e-process-diagnostics-'));
  context.after(() => rmSync(root, { recursive: true, force: true }));
  const artifactDirectory = path.join(root, 'artifacts');
  const testFile = path.join(root, 'hookFailure.e2e.test.js');
  writeFileSync(
    testFile,
    "const { before, test } = require('node:test');\n"
      + "before(() => { throw new Error('hook failed'); });\n"
      + "test('body', () => undefined);\n",
  );
  const diagnosticsImport = pathToFileURL(
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'e2e-owner-diagnostics.mjs'),
  ).href;
  const childEnv = { ...process.env, E2E_ARTIFACT_DIR: artifactDirectory };
  delete childEnv.NODE_TEST_CONTEXT;
  const result = spawnSync(
    process.execPath,
    ['--import', diagnosticsImport, '--test', testFile],
    {
      env: childEnv,
      encoding: 'utf8',
    },
  );

  assert.notEqual(result.status, 0, `${result.stdout}\n${result.stderr}`);
  const metadataFiles = readdirSync(artifactDirectory, { recursive: true })
    .filter((file) => file.endsWith('metadata.json'));
  assert.equal(metadataFiles.length, 1, `${result.stdout}\n${result.stderr}`);
  const metadata = JSON.parse(readFileSync(path.join(artifactDirectory, metadataFiles[0]), 'utf8'));
  assert.equal(metadata.ownerFile, 'hookFailure.e2e.test.ts');

  const successArtifacts = path.join(root, 'success-artifacts');
  const successFile = path.join(root, 'successful.e2e.test.js');
  writeFileSync(successFile, "const { test } = require('node:test');\ntest('body', () => undefined);\n");
  const success = spawnSync(
    process.execPath,
    ['--import', diagnosticsImport, '--test', successFile],
    {
      env: { ...childEnv, E2E_ARTIFACT_DIR: successArtifacts },
      encoding: 'utf8',
    },
  );
  assert.equal(success.status, 0, `${success.stdout}\n${success.stderr}`);
  assert.equal(readdirSync(root).includes('success-artifacts'), false);
});
