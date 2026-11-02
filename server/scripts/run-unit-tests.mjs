// Independent test files use every available core, capped at four workers.
// Node's default reserves a core even though the coordinator mostly waits.
import { availableParallelism } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const concurrency = Math.min(4, availableParallelism());
const preload = fileURLToPath(new URL('./test-compile-cache.mjs', import.meta.url));
const suites = [
  { files: ['dist-test/*.test.js', 'dist-test/arcade/*.test.js', 'dist-test/test/*.test.js'],
    env: { ...process.env, DB_FILE: ':memory:', NODE_ENV: 'test', ARCADE_FAST_TIMERS: '1' } },
  { files: ['public/js/**/*.test.js', 'scripts/*.test.mjs'], env: process.env },
];
console.log(`[unit] ${concurrency} isolated test files in parallel`);
for (const suite of suites) {
  const result = spawnSync(process.execPath,
    ['--import', preload, '--test', `--test-concurrency=${concurrency}`, ...suite.files],
    { stdio: 'inherit', env: suite.env });
  if (result.error) console.error(result.error);
  if (result.status !== 0) process.exit(result.status ?? 1);
}
