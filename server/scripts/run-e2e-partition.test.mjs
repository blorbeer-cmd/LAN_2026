import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import {
  existsSync,
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
import artifactDirectoryModule from './e2e-artifact-directory.cjs';
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
import { E2E_MANIFEST, E2E_VISUAL_FILES, validateE2EManifest } from '../../scripts/e2e-partitions.mjs';
import { classifyChangedPaths } from '../../scripts/ci-path-classifier.mjs';

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
  assert.deepEqual(E2E_SMOKE_FILES, ['arcadeSmoke.e2e.test.ts', 'authGateArcade.e2e.test.ts', 'visualArcade.e2e.test.ts']);
  for (const file of E2E_SMOKE_FILES) assert.ok(E2E_PARTITIONS.arcade.includes(file), file);
});

test('Core domains select stable, deduplicated fixture sets', () => {
  assert.equal(CORE_E2E_DOMAINS.flows.filter((file) => file === 'visualCore.e2e.test.ts').length, 1);
  for (const file of ['visualCore.e2e.test.ts', 'visualArcade.e2e.test.ts']) {
    assert.equal(selectedSourceFiles('all').filter((entry) => entry === file).length, 1);
  }
  assert.deepEqual(selectedCoreDomains('all'), ['auth', 'checklist', 'invitations', 'flows']);
  assert.deepEqual(selectedCoreDomains('flows,auth,auth'), ['auth', 'flows']);
  assert.deepEqual(selectedSourceFiles('core', 'auth,checklist'), [
    ...CORE_E2E_DOMAINS.auth,
    ...CORE_E2E_DOMAINS.checklist,
  ]);
  assert.deepEqual(selectedSourceFiles('core'), E2E_PARTITIONS.core);
  assert.throws(() => selectedSourceFiles('core', 'unknown'), /Ungültige Core-E2E-Auswahl/);
});

test('the visual form owner selects the flows suite without broadening auth routing', () => {
  const selection = classifyChangedPaths(['server/public/js/views/gameCatalog.js']);
  assert.ok(selectedSourceFiles('core', selection.e2eCoreScope).includes('visualCore.e2e.test.ts'));
  assert.equal(classifyChangedPaths(['server/public/js/authGate.js']).e2eCoreScope, 'auth');
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

function visualStub({ docker = { ok: true, server: 'linux/amd64' }, status = 0 } = {}) {
  const calls = [];
  return {
    calls,
    VISUAL_REFERENCE_SETUP_HINT: 'Einrichtung: siehe TESTING.md',
    dockerStatus: () => docker,
    runVisualOwnersInContainer: (options) => {
      calls.push(options);
      if (status instanceof Error) throw status;
      return status;
    },
  };
}

function runnerFixture(context, name) {
  const artifactRoot = mkdtempSync(path.join(tmpdir(), name));
  context.after(() => rmSync(artifactRoot, { recursive: true, force: true }));
  const compiledDirectory = path.join(artifactRoot, 'compiled');
  const spawnCalls = [];
  return {
    artifactRoot,
    compiledDirectory,
    spawnCalls,
    compiled: (files) => files.map((file) => path.join(compiledDirectory, file.replace(/\.ts$/, '.js'))),
    hostFiles: (call) => call.args.slice(call.args.indexOf('--test-concurrency=6') + 1),
    options: (partition, overrides = {}) => ({
      argv: ['node', 'run-e2e-partition.mjs', ...partition],
      env: { E2E_ARTIFACT_DIR: artifactRoot },
      sourceFiles: [...E2E_PARTITIONS.core, ...E2E_PARTITIONS.arcade].sort(),
      compiledDirectory,
      fileExists: () => true,
      spawn: (command, args, options) => {
        spawnCalls.push({ command, args, options });
        return { status: overrides.hostStatus ?? 0 };
      },
      log: () => undefined,
      logError: () => undefined,
      ...overrides,
    }),
  };
}

test('the retry environment variable controls the final files passed to the test runner', (context) => {
  const artifactRoot = mkdtempSync(path.join(tmpdir(), 'e2e-retry-contract-'));
  context.after(() => rmSync(artifactRoot, { recursive: true, force: true }));
  const allSourceFiles = [...E2E_PARTITIONS.core, ...E2E_PARTITIONS.arcade].sort();
  const compiledDirectory = path.join(artifactRoot, 'compiled');
  const spawnCalls = [];
  const spawn = (command, args, options) => {
    spawnCalls.push({ command, args, options });
    return { status: 0 };
  };
  const visual = visualStub();
  const common = {
    argv: ['node', 'run-e2e-partition.mjs', 'arcade-smoke'],
    sourceFiles: allSourceFiles,
    compiledDirectory,
    fileExists: () => true,
    spawn,
    log: () => undefined,
    visual,
  };

  assert.equal(runE2EPartition({ ...common, env: { E2E_ARTIFACT_DIR: artifactRoot } }), 0);
  assert.equal(spawnCalls[0].args[0], '--import');
  assert.match(spawnCalls[0].args[1], /e2e-owner-diagnostics\.mjs$/);
  const currentRunDirectory = spawnCalls[0].options.env.E2E_ARTIFACT_DIR;
  assert.equal(path.isAbsolute(currentRunDirectory), true);
  assert.equal(path.dirname(currentRunDirectory), path.join(artifactRoot, 'runs'));
  assert.deepEqual(
    spawnCalls[0].args.slice(spawnCalls[0].args.indexOf('--test-concurrency=6') + 1),
    E2E_SMOKE_FILES.filter((file) => !E2E_VISUAL_FILES.includes(file))
      .map((file) => path.join(compiledDirectory, file.replace(/\.ts$/, '.js'))),
  );
  assert.deepEqual(visual.calls.map(({ files, artifactDirectory }) => ({ files, artifactDirectory })), [
    { files: ['visualArcade.e2e.test.ts'], artifactDirectory: currentRunDirectory },
  ]);

  const failureDirectory = path.join(currentRunDirectory, 'failure');
  mkdirSync(failureDirectory);
  writeFileSync(
    path.join(failureDirectory, 'metadata.json'),
    JSON.stringify({ ownerFile: E2E_SMOKE_FILES[1] }),
  );
  const staleDirectory = path.join(artifactRoot, 'stale-other-partition');
  mkdirSync(staleDirectory);
  writeFileSync(
    path.join(staleDirectory, 'metadata.json'),
    JSON.stringify({ ownerFile: E2E_PARTITIONS.core[0] }),
  );
  const brokenStaleDirectory = path.join(artifactRoot, 'stale-broken');
  mkdirSync(brokenStaleDirectory);
  writeFileSync(path.join(brokenStaleDirectory, 'metadata.json'), '{broken old metadata');

  assert.equal(runE2EPartition({
    ...common,
    env: { E2E_ARTIFACT_DIR: artifactRoot, E2E_RETRY_FAILED_ONLY: '1' },
  }), 0);
  assert.equal(spawnCalls[1].options.env.E2E_ARTIFACT_DIR, currentRunDirectory);
  assert.deepEqual(
    spawnCalls[1].args.slice(spawnCalls[1].args.indexOf('--test-concurrency=6') + 1),
    [path.join(compiledDirectory, E2E_SMOKE_FILES[1].replace(/\.ts$/, '.js'))],
  );
  assert.equal(visual.calls.length, 1, 'a retry without a visual owner starts no container');
});

test('a missing reference container never looks like a passed visual run', (context) => {
  const runner = runnerFixture(context, 'e2e-visual-missing-');
  const errors = [];
  const visual = visualStub({ docker: { ok: false, reason: 'Docker-Engine nicht erreichbar' } });
  const status = runE2EPartition(runner.options(['core', 'flows'], {
    visual,
    logError: (message) => errors.push(message),
  }));
  assert.equal(status, 1);
  // Windows functional checks still run on the host.
  assert.deepEqual(
    runner.hostFiles(runner.spawnCalls[0]),
    runner.compiled(CORE_E2E_DOMAINS.flows.filter((file) => file !== 'visualCore.e2e.test.ts')),
  );
  assert.equal(visual.calls.length, 0);
  assert.equal(errors.length, 2, 'announced before the host run and repeated as the final result');
  for (const message of errors) {
    assert.match(
      message,
      /NICHT AUSGEFÜHRT: visualCore\.e2e\.test\.ts – Docker-Engine nicht erreichbar\. .*nicht als bestanden\. Einrichtung/,
    );
  }
});

test('host and container results both decide the run; the container itself runs every owner', (context) => {
  const runner = runnerFixture(context, 'e2e-visual-status-');
  assert.equal(runE2EPartition(runner.options(['arcade-smoke'], { visual: visualStub({ status: 1 }) })), 1);
  assert.equal(runE2EPartition(runner.options(['arcade-smoke'], { visual: visualStub(), hostStatus: 3 })), 3);
  const errors = [];
  assert.equal(runE2EPartition(runner.options(['arcade-smoke'], {
    visual: visualStub({ status: new Error('docker build: Exit 1') }),
    logError: (message) => errors.push(message),
  })), 1);
  assert.match(errors[0], /NICHT AUSGEFÜHRT: visualArcade\.e2e\.test\.ts – docker build: Exit 1/);

  const onlyVisual = visualStub();
  const before = runner.spawnCalls.length;
  assert.equal(runE2EPartition(runner.options(['visual'], { visual: onlyVisual })), 0);
  assert.equal(runner.spawnCalls.length, before, 'the visual selection needs no host browser run');
  assert.deepEqual(onlyVisual.calls[0].files, [...E2E_VISUAL_FILES]);

  const inside = visualStub();
  assert.equal(runE2EPartition(runner.options(['arcade-smoke'], {
    visual: inside,
    env: { E2E_ARTIFACT_DIR: runner.artifactRoot, RESPAWN_VISUAL_BASE_IMAGE: 'pinned' },
  })), 0);
  assert.deepEqual(runner.hostFiles(runner.spawnCalls.at(-1)), runner.compiled(E2E_SMOKE_FILES));
  assert.equal(inside.calls.length, 0);
});

test('runner and diagnostic producers share one cwd-independent local artifact default', () => {
  const serverDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  assert.equal(e2eArtifactDirectory, artifactDirectoryModule.e2eArtifactDirectory);
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
  const successfulMetadata = readdirSync(successArtifacts, { recursive: true })
    .filter((file) => file.endsWith('metadata.json'));
  assert.deepEqual(successfulMetadata, []);
});

async function waitForProcessMetadata(artifactDirectory) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (existsSync(artifactDirectory)) {
      const files = readdirSync(artifactDirectory, { recursive: true })
        .filter((file) => file.endsWith('metadata.json'));
      if (files.length > 0) return path.join(artifactDirectory, files[0]);
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Timed out waiting for process metadata in ${artifactDirectory}`);
}

test('signal and forced termination retain pessimistic process owner metadata', async (context) => {
  const root = mkdtempSync(path.join(tmpdir(), 'e2e-process-signal-'));
  context.after(() => rmSync(root, { recursive: true, force: true }));
  const diagnosticsImport = pathToFileURL(
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'e2e-owner-diagnostics.mjs'),
  ).href;

  for (const signal of ['SIGTERM', 'SIGKILL']) {
    const artifactDirectory = path.join(root, signal.toLowerCase());
    const testFile = path.join(root, `${signal.toLowerCase()}.e2e.test.js`);
    writeFileSync(testFile, 'setInterval(() => undefined, 1000);\n');
    const child = spawn(process.execPath, ['--import', diagnosticsImport, testFile], {
      env: {
        ...process.env,
        E2E_ARTIFACT_DIR: artifactDirectory,
        NODE_TEST_CONTEXT: 'child-v8',
      },
      stdio: 'pipe',
    });
    context.after(() => {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    });

    const metadataFile = await waitForProcessMetadata(artifactDirectory);
    const childExit = new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('exit', resolve);
    });
    assert.equal(child.kill(signal), true);
    await childExit;
    const metadata = JSON.parse(readFileSync(metadataFile, 'utf8'));
    assert.equal(metadata.ownerFile, `${signal.toLowerCase()}.e2e.test.ts`);
    if (signal === 'SIGTERM' && process.platform !== 'win32') {
      assert.match(metadata.error, /received SIGTERM/);
    }
  }
});
