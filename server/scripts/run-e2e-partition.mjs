import { existsSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const serverDir = path.resolve(scriptDir, '..');
const sourceDir = path.join(serverDir, 'src', 'test', 'e2e');
const compiledDir = path.join(serverDir, 'dist-test', 'test', 'e2e');

export const E2E_PARTITIONS = Object.freeze({
  core: Object.freeze([
    'access.e2e.test.ts',
    'authGate.e2e.test.ts',
    'checklist.e2e.test.ts',
    'eventInvitations.e2e.test.ts',
    'flows.e2e.test.ts',
    'phase5eIsolation.e2e.test.ts',
  ]),
  arcade: Object.freeze([
    'arcade.e2e.test.ts',
    'arcadeStreamRenderer.e2e.test.ts',
    'authGateArcade.e2e.test.ts',
    'battleship.e2e.test.ts',
    'challengeRush.e2e.test.ts',
    'flowsArcade.e2e.test.ts',
  ]),
});

export const E2E_SMOKE_FILES = Object.freeze(['arcade.e2e.test.ts', 'authGateArcade.e2e.test.ts']);

export function validateE2EPartitions(sourceFiles) {
  const assignments = new Map();
  for (const [partition, files] of Object.entries(E2E_PARTITIONS)) {
    for (const file of files) {
      const owners = assignments.get(file) ?? [];
      owners.push(partition);
      assignments.set(file, owners);
    }
  }

  const duplicates = [...assignments.entries()]
    .filter(([, owners]) => owners.length !== 1)
    .map(([file, owners]) => `${file} (${owners.join(', ')})`);
  const missing = sourceFiles.filter((file) => !assignments.has(file));
  const absent = [...assignments.keys()].filter((file) => !sourceFiles.includes(file));

  if (duplicates.length || missing.length || absent.length) {
    const details = [
      duplicates.length ? `mehrfach zugeordnet: ${duplicates.join(', ')}` : '',
      missing.length ? `nicht zugeordnet: ${missing.join(', ')}` : '',
      absent.length ? `nicht vorhanden: ${absent.join(', ')}` : '',
    ].filter(Boolean);
    throw new Error(`Ungültige E2E-Partitionen – ${details.join('; ')}`);
  }
}

export function selectedSourceFiles(partition) {
  if (partition === 'all') return [...E2E_PARTITIONS.core, ...E2E_PARTITIONS.arcade];
  if (partition === 'arcade-smoke') return [...E2E_SMOKE_FILES];
  const files = E2E_PARTITIONS[partition];
  if (!files) throw new Error(`Unbekannte E2E-Partition: ${partition}`);
  return [...files];
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
