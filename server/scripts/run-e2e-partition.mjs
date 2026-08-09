import { existsSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const serverDir = path.resolve(scriptDir, '..');
const sourceDir = path.join(serverDir, 'src', 'test', 'e2e');
const compiledDir = path.join(serverDir, 'dist-test', 'test', 'e2e');

export const CORE_E2E_DOMAINS = Object.freeze({
  auth: Object.freeze([
    'access.e2e.test.ts',
    'authGate.e2e.test.ts',
  ]),
  checklist: Object.freeze([
    'checklist.e2e.test.ts',
  ]),
  invitations: Object.freeze([
    'eventInvitations.e2e.test.ts',
  ]),
  flows: Object.freeze([
    'flowsCompetition.e2e.test.ts',
    'flowsCommunity.e2e.test.ts',
    'flowsShell.e2e.test.ts',
    'phase5eIsolation.e2e.test.ts',
  ]),
});

const ALL_CORE_E2E_FILES = Object.freeze(Object.values(CORE_E2E_DOMAINS).flat());

export const E2E_PARTITIONS = Object.freeze({
  core: ALL_CORE_E2E_FILES,
  arcade: Object.freeze([
    // Start the longest isolated fixtures first so the bounded Node test
    // runner can overlap them with the remaining shorter Arcade files.
    'challengeRushLifecycle.e2e.test.ts',
    'snakeArenaViews.e2e.test.ts',
    'challengeRush.e2e.test.ts',
    'battleship.e2e.test.ts',
    'arcadeFlows.e2e.test.ts',
    'arcade.e2e.test.ts',
    'arcadeMultiplayer.e2e.test.ts',
    'arcadeScribbleViews.e2e.test.ts',
    'arcadeSmoke.e2e.test.ts',
    'arcadeStreamRenderer.e2e.test.ts',
    'authGateArcade.e2e.test.ts',
  ]),
});

export const E2E_SMOKE_FILES = Object.freeze(['arcadeSmoke.e2e.test.ts', 'authGateArcade.e2e.test.ts']);

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

export function selectedCoreDomains(selection = 'all') {
  if (selection === 'all') return Object.keys(CORE_E2E_DOMAINS);
  const requested = [...new Set(selection.split(',').map((value) => value.trim()).filter(Boolean))];
  const unknown = requested.filter((domain) => !Object.hasOwn(CORE_E2E_DOMAINS, domain));
  if (!requested.length || unknown.length) {
    throw new Error(`Ungültige Core-E2E-Auswahl: ${selection || '(leer)'}`);
  }
  return Object.keys(CORE_E2E_DOMAINS).filter((domain) => requested.includes(domain));
}

export function selectedSourceFiles(partition, coreSelection = 'all') {
  if (partition === 'all') return [...E2E_PARTITIONS.core, ...E2E_PARTITIONS.arcade];
  if (partition === 'arcade-smoke') return [...E2E_SMOKE_FILES];
  if (partition === 'core') {
    return selectedCoreDomains(coreSelection).flatMap((domain) => CORE_E2E_DOMAINS[domain]);
  }
  const files = E2E_PARTITIONS[partition];
  if (!files) throw new Error(`Unbekannte E2E-Partition: ${partition}`);
  return [...files];
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

  // Every file owns a server and usually a Chromium process. Letting Node use
  // all logical CPUs after sharding oversubscribes larger developer machines
  // and makes each browser substantially slower. Six workers preserve the
  // concurrency of the former six-file Arcade partition while still bounding
  // the additional isolated fixtures.
  const result = spawnSync(process.execPath, ['--test', '--test-concurrency=6', ...compiledFiles], {
    cwd: serverDir,
    env: process.env,
    stdio: 'inherit',
  });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
