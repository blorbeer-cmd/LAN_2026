import { existsSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  E2E_PARTITIONS,
  E2E_SMOKE_FILES,
  selectedE2EFiles,
  validateE2EManifest,
} from '../../scripts/e2e-partitions.mjs';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const serverDir = path.resolve(scriptDir, '..');
const sourceDir = path.join(serverDir, 'src', 'test', 'e2e');
const compiledDir = path.join(serverDir, 'dist-test', 'test', 'e2e');

export { E2E_PARTITIONS, E2E_SMOKE_FILES };

export function validateE2EPartitions(sourceFiles) {
  validateE2EManifest(sourceFiles);
}

export function selectedSourceFiles(partition) {
  return selectedE2EFiles(partition);
}

function main() {
  const partition = process.argv[2] ?? 'all';
  const sourceFiles = readdirSync(sourceDir)
    .filter((file) => file.endsWith('.e2e.test.ts'))
    .sort();
  validateE2EPartitions(sourceFiles);

  const compiledFiles = selectedSourceFiles(partition).map((file) =>
    path.join(compiledDir, file.replace(/\.ts$/, '.js')),
  );
  const missingCompiled = compiledFiles.filter((file) => !existsSync(file));
  if (missingCompiled.length) throw new Error(`E2E-Build fehlt: ${missingCompiled.join(', ')}`);

  const result = spawnSync(process.execPath, ['--test', ...compiledFiles], {
    cwd: serverDir,
    env: process.env,
    stdio: 'inherit',
  });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
