import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import artifactDirectoryModule from './e2e-artifact-directory.cjs';
import {
  CORE_E2E_DOMAINS,
  E2E_PARTITIONS,
  E2E_SMOKE_FILES,
  selectedCoreDomains,
  selectedE2EFiles,
  validateE2EManifest,
} from '../../scripts/e2e-partitions.mjs';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const serverDir = path.resolve(scriptDir, '..');
const sourceDir = path.join(serverDir, 'src', 'test', 'e2e');
const compiledDir = path.join(serverDir, 'dist-test', 'test', 'e2e');
const ownerDiagnosticsImport = pathToFileURL(
  path.join(scriptDir, 'e2e-owner-diagnostics.mjs'),
).href;
const { e2eArtifactDirectory } = artifactDirectoryModule;

export {
  CORE_E2E_DOMAINS,
  E2E_PARTITIONS,
  E2E_SMOKE_FILES,
  e2eArtifactDirectory,
  selectedCoreDomains,
};

export function validateE2EPartitions(sourceFiles) {
  validateE2EManifest(sourceFiles);
}

export function selectedSourceFiles(partition, coreSelection = 'all') {
  return selectedE2EFiles(partition, coreSelection);
}

function metadataFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return metadataFiles(entryPath);
    return entry.isFile() && entry.name === 'metadata.json' ? [entryPath] : [];
  });
}

function selectionSlug(partition, coreSelection) {
  return `${partition}-${coreSelection}`
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase();
}

function runStateFile(artifactRoot, partition, coreSelection) {
  return path.join(artifactRoot, `.latest-${selectionSlug(partition, coreSelection)}.json`);
}

export function createE2EArtifactRun(
  artifactRoot,
  partition,
  coreSelection,
  selectedFiles,
  runId = `${Date.now().toString(36)}-${process.pid}-${randomUUID()}`,
) {
  const runDirectory = path.join(artifactRoot, 'runs', runId);
  mkdirSync(runDirectory, { recursive: true });
  const stateFile = runStateFile(artifactRoot, partition, coreSelection);
  const temporaryStateFile = `${stateFile}.${process.pid}.tmp`;
  writeFileSync(
    temporaryStateFile,
    `${JSON.stringify({ version: 1, runId, partition, coreSelection, selectedFiles }, null, 2)}\n`,
    'utf8',
  );
  renameSync(temporaryStateFile, stateFile);
  return runDirectory;
}

export function retryE2EArtifactDirectory(artifactRoot, partition, coreSelection, selectedFiles) {
  const stateFile = runStateFile(artifactRoot, partition, coreSelection);
  if (!existsSync(stateFile)) {
    throw new Error(`Gezielter E2E-Retry fand keinen aktuellen Laufzustand: ${stateFile}`);
  }

  let state;
  try {
    state = JSON.parse(readFileSync(stateFile, 'utf8'));
  } catch (error) {
    throw new Error(`Ungültiger E2E-Laufzustand: ${stateFile}`, { cause: error });
  }
  const validRunId = typeof state?.runId === 'string' && /^[a-zA-Z0-9-]+$/.test(state.runId);
  const validSelection = state?.version === 1
    && state?.partition === partition
    && state?.coreSelection === coreSelection
    && Array.isArray(state?.selectedFiles)
    && JSON.stringify(state.selectedFiles) === JSON.stringify(selectedFiles);
  if (!validRunId || !validSelection) {
    throw new Error(`E2E-Laufzustand passt nicht zur gewählten Partition: ${stateFile}`);
  }

  const runDirectory = path.join(artifactRoot, 'runs', state.runId);
  if (!existsSync(runDirectory)) {
    throw new Error(`Gezielter E2E-Retry benötigt das Diagnoseverzeichnis des aktuellen Laufs: ${runDirectory}`);
  }
  return runDirectory;
}

export function failedE2EOwnerFiles(artifactDirectory = e2eArtifactDirectory()) {
  if (!existsSync(artifactDirectory)) {
    throw new Error(`Gezielter E2E-Retry benötigt vorhandene Diagnoseartefakte: ${artifactDirectory}`);
  }

  const files = metadataFiles(artifactDirectory);
  if (files.length === 0) {
    throw new Error('Gezielter E2E-Retry fand keine metadata.json im E2E_ARTIFACT_DIR.');
  }

  const owners = new Set();
  for (const file of files) {
    let metadata;
    try {
      metadata = JSON.parse(readFileSync(file, 'utf8'));
    } catch (error) {
      throw new Error(`Ungültige E2E-Diagnosemetadaten: ${file}`, { cause: error });
    }
    const ownerFile = metadata?.ownerFile;
    if (
      typeof ownerFile !== 'string'
      || /[\\/]/.test(ownerFile)
      || !ownerFile.endsWith('.e2e.test.ts')
    ) {
      throw new Error(`Ungültige E2E-Owner-Datei in ${file}: ${String(ownerFile)}`);
    }
    owners.add(ownerFile);
  }
  return [...owners];
}

export function selectedRetrySourceFiles(sourceFiles, artifactDirectory = e2eArtifactDirectory()) {
  const owners = new Set(failedE2EOwnerFiles(artifactDirectory));
  const outsideSelection = [...owners].filter((file) => !sourceFiles.includes(file));
  if (outsideSelection.length > 0) {
    throw new Error(
      `E2E-Retry-Owner liegt außerhalb der gewählten Partition: ${outsideSelection.join(', ')}`,
    );
  }
  return sourceFiles.filter((file) => owners.has(file));
}

export function runE2EPartition({
  argv = process.argv,
  env = process.env,
  sourceFiles,
  compiledDirectory = compiledDir,
  fileExists = existsSync,
  spawn = spawnSync,
  log = console.log,
} = {}) {
  const partition = argv[2] ?? 'all';
  const coreSelection = argv[3] ?? 'all';
  const availableSourceFiles = sourceFiles ?? readdirSync(sourceDir)
    .filter((file) => file.endsWith('.e2e.test.ts'))
    .sort();
  validateE2EPartitions(availableSourceFiles);

  const selectedFiles = selectedSourceFiles(partition, coreSelection);
  const artifactRoot = e2eArtifactDirectory(env);
  const retryFailedOnly = env.E2E_RETRY_FAILED_ONLY === '1';
  const artifactDirectory = retryFailedOnly
    ? retryE2EArtifactDirectory(artifactRoot, partition, coreSelection, selectedFiles)
    : createE2EArtifactRun(artifactRoot, partition, coreSelection, selectedFiles);
  const filesToRun = retryFailedOnly
    ? selectedRetrySourceFiles(selectedFiles, artifactDirectory)
    : selectedFiles;
  if (retryFailedOnly) {
    log(`[e2e retry] selected owner files: ${filesToRun.join(', ')}`);
  }
  const compiledFiles = filesToRun.map((file) =>
    path.join(compiledDirectory, file.replace(/\.ts$/, '.js')),
  );
  const missingCompiled = compiledFiles.filter((file) => !fileExists(file));
  if (missingCompiled.length) throw new Error(`E2E-Build fehlt: ${missingCompiled.join(', ')}`);

  // Every file owns a server and usually a Chromium process. Keep the former
  // six-file concurrency bounded after splitting the suites into more fixtures.
  const result = spawn(process.execPath, [
    '--import',
    ownerDiagnosticsImport,
    '--test',
    '--test-concurrency=6',
    ...compiledFiles,
  ], {
    cwd: serverDir,
    // All producers receive the runner's one absolute per-run directory, so
    // their standalone cwd-based fallback cannot diverge from retry lookup.
    env: { ...env, E2E_ARTIFACT_DIR: artifactDirectory },
    stdio: 'inherit',
  });
  if (result.error) throw result.error;
  return result.status ?? 1;
}

function main() {
  process.exitCode = runE2EPartition();
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
