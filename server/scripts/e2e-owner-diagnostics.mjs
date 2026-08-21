import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import artifactDirectoryModule from './e2e-artifact-directory.cjs';

const { e2eArtifactDirectory } = artifactDirectoryModule;

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
    const root = e2eArtifactDirectory();
    const directory = path.join(root, `process-${artifactSlug(ownerFile)}-${process.pid}`);
    const metadataFile = path.join(directory, 'metadata.json');
    const persistOwner = (error) => {
      try {
        mkdirSync(directory, { recursive: true });
        writeFileSync(
          metadataFile,
          `${JSON.stringify(
            {
              testName: 'E2E test process failure',
              ownerFile,
              error,
              serverExit: null,
              pages: [],
            },
            null,
            2,
          )}\n`,
          'utf8',
        );
      } catch (writeError) {
        console.error(`[e2e diagnostics] could not persist process owner metadata: ${writeError}`);
      }
    };

    // Start pessimistically: SIGKILL and host/OOM termination run no cleanup
    // callbacks. A clean exit removes this marker; every other exit leaves the
    // owner available to the targeted retry.
    persistOwner('Node test process did not report a successful exit.');
    process.once('exit', (exitCode) => {
      if (exitCode === 0) {
        try {
          rmSync(directory, { recursive: true, force: true });
        } catch (removeError) {
          console.error(`[e2e diagnostics] could not remove successful process marker: ${removeError}`);
        }
        return;
      }
      persistOwner(`Node test process exited with code ${exitCode}.`);
    });

    let terminatingForSignal = false;
    for (const signal of ['SIGTERM', 'SIGINT', 'SIGHUP']) {
      try {
        process.once(signal, () => {
          if (terminatingForSignal) return;
          terminatingForSignal = true;
          persistOwner(`Node test process received ${signal}.`);
          process.removeAllListeners(signal);
          try {
            process.kill(process.pid, signal);
          } catch {
            process.exit(1);
          }
        });
      } catch {
        // Some signals are not available on every supported platform. The
        // pessimistic startup marker still covers forced termination there.
      }
    }
  }
}
