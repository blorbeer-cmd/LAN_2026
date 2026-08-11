import { existsSync, readdirSync } from 'node:fs';
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

function main() {
  const partition = process.argv[2] ?? 'all';
  const coreSelection = process.argv[3] ?? 'all';
  const sourceFiles = readdirSync(sourceDir)
    .filter((file) => file.endsWith('.e2e.test.ts'))
    .sort();
  validateE2EPartitions(sourceFiles);

  const compiledFiles = selectedSourceFiles(partition, coreSelection).map((file) =>
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
