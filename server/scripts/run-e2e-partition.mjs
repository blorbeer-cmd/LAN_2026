import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
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

export { CORE_E2E_DOMAINS, E2E_PARTITIONS, E2E_SMOKE_FILES, selectedCoreDomains };

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

export function failedE2EOwnerFiles(artifactDirectory) {
  if (!artifactDirectory || !existsSync(artifactDirectory)) {
    throw new Error('Gezielter E2E-Retry benötigt ein vorhandenes E2E_ARTIFACT_DIR.');
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

export function selectedRetrySourceFiles(sourceFiles, artifactDirectory) {
  const owners = new Set(failedE2EOwnerFiles(artifactDirectory));
  const outsideSelection = [...owners].filter((file) => !sourceFiles.includes(file));
  if (outsideSelection.length > 0) {
    throw new Error(
      `E2E-Retry-Owner liegt außerhalb der gewählten Partition: ${outsideSelection.join(', ')}`,
    );
  }
  return sourceFiles.filter((file) => owners.has(file));
}

function main() {
  const partition = process.argv[2] ?? 'all';
  const coreSelection = process.argv[3] ?? 'all';
  const sourceFiles = readdirSync(sourceDir)
    .filter((file) => file.endsWith('.e2e.test.ts'))
    .sort();
  validateE2EPartitions(sourceFiles);

  const selectedFiles = selectedSourceFiles(partition, coreSelection);
  const filesToRun = process.env.E2E_RETRY_FAILED_ONLY === '1'
    ? selectedRetrySourceFiles(selectedFiles, process.env.E2E_ARTIFACT_DIR)
    : selectedFiles;
  const compiledFiles = filesToRun.map((file) =>
    path.join(compiledDir, file.replace(/\.ts$/, '.js')),
  );
  const missingCompiled = compiledFiles.filter((file) => !existsSync(file));
  if (missingCompiled.length) throw new Error(`E2E-Build fehlt: ${missingCompiled.join(', ')}`);

  // Every file owns a server and usually a Chromium process. Keep the former
  // six-file concurrency bounded after splitting the suites into more fixtures.
  const result = spawnSync(process.execPath, ['--test', '--test-concurrency=6', ...compiledFiles], {
    cwd: serverDir,
    env: process.env,
    stdio: 'inherit',
  });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
