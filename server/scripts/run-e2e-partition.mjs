import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { availableParallelism, loadavg } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import artifactDirectoryModule from './e2e-artifact-directory.cjs';
import * as visualReference from './visual-reference.mjs';
import {
  CORE_E2E_DOMAINS,
  E2E_PARTITIONS,
  E2E_SMOKE_FILES,
  E2E_VISUAL_FILES,
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

// The process-level owner marker from e2e-owner-diagnostics.mjs. It only names
// the owner file, so it counts as a failure of its own only when the process
// left no concrete test failure behind (for example a crash in a file hook).
const PROCESS_FAILURE_TEST_NAME = 'E2E test process failure';

// Reads every failure record below a run directory. Unlike the retry owner
// selection, the summary is diagnostic only: unreadable records are skipped
// instead of failing the run a second time.
export function e2eFailureRecords(artifactDirectory) {
  if (!existsSync(artifactDirectory)) return [];
  return metadataFiles(artifactDirectory).flatMap((file) => {
    try {
      const metadata = JSON.parse(readFileSync(file, 'utf8'));
      if (typeof metadata?.ownerFile !== 'string' || typeof metadata?.testName !== 'string') return [];
      return [{ file, ownerFile: metadata.ownerFile, testName: metadata.testName }];
    } catch {
      return [];
    }
  });
}

function failureKeys(records) {
  const ownersWithTests = new Set(records
    .filter((record) => record.testName !== PROCESS_FAILURE_TEST_NAME)
    .map((record) => record.ownerFile));
  const keys = records
    .filter((record) => record.testName !== PROCESS_FAILURE_TEST_NAME || !ownersWithTests.has(record.ownerFile))
    .map((record) => `${record.ownerFile} › ${record.testName}`);
  return [...new Set(keys)].sort();
}

// A failure that the isolated owner retry no longer shows is a flake; one that
// it shows again is reproducible and most likely a real regression. The job
// stays red in both cases, the split only tells where to start looking.
export function classifyE2ERetry(firstRecords, retryRecords) {
  const first = failureKeys(firstRecords);
  const retry = new Set(failureKeys(retryRecords));
  return {
    flaky: first.filter((key) => !retry.has(key)),
    reproduced: first.filter((key) => retry.has(key)),
    retryOnly: [...retry].filter((key) => !first.includes(key)).sort(),
  };
}

export function formatE2ERetrySummary(label, classification, retryStatus) {
  const { flaky, reproduced, retryOnly } = classification;
  let verdict;
  if (reproduced.length || retryOnly.length) {
    verdict = 'Reproduzierbar: Der Retry ist wieder rot. Wahrscheinlich eine echte Regression.';
  } else if (retryStatus !== 0) {
    verdict = 'Retry rot ohne zugeordnete Testfehler. Diagnoseartefakte prüfen.';
  } else if (flaky.length) {
    verdict = 'Flake: Alle Fehler sind im Retry grün. Der Job bleibt rot, die Ursache muss behoben werden.';
  } else {
    verdict = 'Keine Fehler-Metadaten aus dem ersten Lauf gefunden.';
  }
  const section = (title, keys) => (keys.length
    ? [`**${title}**`, '', ...keys.map((key) => `- ${key}`), '']
    : []);
  return [
    `### E2E-Retry ${label}`,
    '',
    verdict,
    '',
    ...section('Flake (im Retry grün)', flaky),
    ...section('Reproduziert (auch im Retry rot)', reproduced),
    ...section('Nur im Retry rot', retryOnly),
  ].join('\n');
}

const MAX_E2E_CONCURRENCY = 6;
const MIN_LOCAL_E2E_CONCURRENCY = 2;

// Every file owns a server and a Chromium, and Arcade files drive several
// browser contexts with live game loops. CI keeps the fixed six files of the
// measured baseline on its dedicated runner. Local runs share the machine with
// other worktrees and agents, so they derive the file count from the free
// cores; an oversubscribed CPU turns short game windows into timeouts.
export function e2eTestConcurrency(env, system = {}) {
  const explicit = `${env.E2E_CONCURRENCY ?? ''}`.trim();
  if (explicit) {
    const value = Number(explicit);
    if (!Number.isInteger(value) || value < 1 || value > 16) {
      throw new Error(`E2E_CONCURRENCY muss eine ganze Zahl von 1 bis 16 sein: ${explicit}`);
    }
    return { value, reason: 'E2E_CONCURRENCY' };
  }
  if (/^(1|true)$/i.test(`${env.CI ?? ''}`.trim())) {
    return { value: MAX_E2E_CONCURRENCY, reason: 'CI-Basiswert' };
  }
  const cpus = system.cpus ?? availableParallelism();
  const load = system.load ?? loadavg()[0];
  const free = Math.floor((cpus - load) / 1.5);
  const value = Math.max(MIN_LOCAL_E2E_CONCURRENCY, Math.min(MAX_E2E_CONCURRENCY, free));
  return { value, reason: `lokal: ${cpus} Kerne, Last ${load.toFixed(1)}` };
}

export function runE2EPartition({
  argv = process.argv,
  env = process.env,
  sourceFiles,
  compiledDirectory = compiledDir,
  fileExists = existsSync,
  spawn = spawnSync,
  log = console.log,
  logError = console.error,
  visual = visualReference,
  system = {},
  appendSummary = appendFileSync,
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
  const firstRunFailures = retryFailedOnly ? e2eFailureRecords(artifactDirectory) : [];
  if (retryFailedOnly) {
    log(`[e2e retry] selected owner files: ${filesToRun.join(', ')}`);
  }
  const compiledFile = (file) => path.join(compiledDirectory, file.replace(/\.ts$/, '.js'));
  const missingCompiled = filesToRun.map(compiledFile).filter((file) => !fileExists(file));
  if (missingCompiled.length) throw new Error(`E2E-Build fehlt: ${missingCompiled.join(', ')}`);

  // Visual reference owners compare pixels, so they run in the pinned reference container.
  // Functional owners keep using the host browser; inside that container everything runs here.
  const visualFiles = env.RESPAWN_VISUAL_BASE_IMAGE
    ? []
    : filesToRun.filter((file) => E2E_VISUAL_FILES.includes(file));
  const hostFiles = filesToRun.filter((file) => !visualFiles.includes(file));
  const docker = visualFiles.length ? visual.dockerStatus() : { ok: true };
  // A reachable engine keeps the comparison mandatory; without one the visual owners are optional
  // and only skipped, unless the environment demands them (CI, RESPAWN_VISUAL_REQUIRED=1).
  const visualRequired = visual.visualRunRequired(env);
  const visualNotRun = (reason) =>
    `[e2e visual] NICHT AUSGEFÜHRT: ${visualFiles.join(', ')} – ${reason}. `
    + `Dieser Lauf gilt daher nicht als bestanden. ${visual.VISUAL_REFERENCE_SETUP_HINT}`;
  const visualUnavailable = (reason) =>
    (visualRequired ? visualNotRun(reason) : visual.visualSkipNotice(visualFiles, reason));
  if (!docker.ok) logError(visualUnavailable(docker.reason));

  let status = 0;
  if (hostFiles.length) {
    const concurrency = e2eTestConcurrency(env, system);
    log(`[e2e] Dateiparallelität ${concurrency.value} (${concurrency.reason})`);
    const result = spawn(process.execPath, [
      '--import',
      ownerDiagnosticsImport,
      '--test',
      `--test-concurrency=${concurrency.value}`,
      ...hostFiles.map(compiledFile),
    ], {
      cwd: serverDir,
      // All producers receive the runner's one absolute per-run directory, so
      // their standalone cwd-based fallback cannot diverge from retry lookup.
      env: { ...env, E2E_ARTIFACT_DIR: artifactDirectory },
      stdio: 'inherit',
    });
    if (result.error) throw result.error;
    status = result.status ?? 1;
  }
  if (visualFiles.length) {
    let visualStatus = 1;
    if (!docker.ok) {
      logError(visualUnavailable(docker.reason));
      // Only an unavailable engine is optional; a reachable one that fails stays a red run below.
      if (!visualRequired) visualStatus = 0;
    } else {
      try {
        visualStatus = visual.runVisualOwnersInContainer({ files: visualFiles, artifactDirectory, env, log });
      } catch (error) {
        logError(visualNotRun(error.message));
      }
    }
    if (status === 0) status = visualStatus;
  }
  if (retryFailedOnly) {
    const firstRunFiles = new Set(firstRunFailures.map((record) => record.file));
    const retryFailures = e2eFailureRecords(artifactDirectory)
      .filter((record) => !firstRunFiles.has(record.file));
    const label = partition === 'core' ? `${partition} (${coreSelection})` : partition;
    const summary = formatE2ERetrySummary(label, classifyE2ERetry(firstRunFailures, retryFailures), status);
    log(summary);
    if (env.GITHUB_STEP_SUMMARY) {
      try {
        appendSummary(env.GITHUB_STEP_SUMMARY, `${summary}\n`, 'utf8');
      } catch (error) {
        logError(`[e2e retry] Job-Summary nicht geschrieben: ${error.message}`);
      }
    }
  }
  return status;
}

function main() {
  process.exitCode = runE2EPartition();
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
