import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

function ownerFileFromArgv(argv) {
  const entryFile = path.basename(argv[1] ?? '');
  if (!entryFile.endsWith('.e2e.test.js')) return null;
  return entryFile.replace(/\.js$/, '.ts');
}

function artifactSlug(value) {
  return value
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase();
}

// Node's test runner imports this module in both its coordinator and its
// isolated test-file children. Only a child owns exactly one E2E entry file.
if (process.env.NODE_TEST_CONTEXT) {
  const ownerFile = ownerFileFromArgv(process.argv);
  if (ownerFile) {
    process.once('exit', (exitCode) => {
      if (exitCode === 0) return;
      const root = path.resolve(
        process.env.E2E_ARTIFACT_DIR ?? path.join(process.cwd(), 'test-results', 'e2e'),
      );
      const directory = path.join(root, `process-${artifactSlug(ownerFile)}-${process.pid}`);
      try {
        mkdirSync(directory, { recursive: true });
        writeFileSync(
          path.join(directory, 'metadata.json'),
          `${JSON.stringify(
            {
              testName: 'E2E test process failure',
              ownerFile,
              error: `Node test process exited with code ${exitCode}.`,
              serverExit: null,
              pages: [],
            },
            null,
            2,
          )}\n`,
          'utf8',
        );
      } catch (error) {
        console.error(`[e2e diagnostics] could not persist process owner metadata: ${error}`);
      }
    });
  }
}
