import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import type { Browser, BrowserContext, Page } from 'playwright';
import {
  deferE2EContextClose,
  e2eOwnerFileFromArgv,
  runWithE2EDiagnostics,
  trackE2EContext,
} from './e2e/e2eDiagnostics';

test('compiled E2E entry points map back to their source owner file', () => {
  assert.equal(
    e2eOwnerFileFromArgv([
      'node',
      path.join('repo', 'dist-test', 'test', 'e2e', 'flowsCommunity.e2e.test.js'),
    ]),
    'flowsCommunity.e2e.test.ts',
  );
  assert.equal(e2eOwnerFileFromArgv(['node', '/repo/not-an-e2e-test.js']), null);
});

test('deferred contexts remain available for failure capture and close afterwards', async (context) => {
  const artifactDirectory = await mkdtemp(path.join(tmpdir(), 'e2e-diagnostics-'));
  context.after(() => rm(artifactDirectory, { recursive: true, force: true }));
  const previousArtifactDirectory = process.env.E2E_ARTIFACT_DIR;
  const previousTrace = process.env.E2E_TRACE;
  process.env.E2E_ARTIFACT_DIR = artifactDirectory;
  delete process.env.E2E_TRACE;
  context.after(() => {
    if (previousArtifactDirectory === undefined) delete process.env.E2E_ARTIFACT_DIR;
    else process.env.E2E_ARTIFACT_DIR = previousArtifactDirectory;
    if (previousTrace === undefined) delete process.env.E2E_TRACE;
    else process.env.E2E_TRACE = previousTrace;
  });

  const events: string[] = [];
  let closed = false;
  const page = {
    on: () => page,
    isClosed: () => closed,
    screenshot: async ({ path: screenshotPath }: { path: string }) => {
      events.push('screenshot');
      await writeFile(screenshotPath, 'screenshot');
    },
    content: async () => {
      events.push('content');
      return '<main>diagnostic state</main>';
    },
    url: () => 'http://127.0.0.1/arcade',
  } as unknown as Page;
  const browserContext = {
    pages: () => [page],
    on: () => browserContext,
    close: async () => {
      events.push('close');
      closed = true;
    },
    tracing: {
      start: async () => undefined,
      stop: async () => undefined,
    },
  } as unknown as BrowserContext;
  const browser = {
    contexts: () => [browserContext],
  } as unknown as Browser;

  await assert.rejects(
    runWithE2EDiagnostics(
      {
        testName: 'captures before cleanup',
        browser,
        ownerFile: 'challengeRushLifecycle.e2e.test.ts',
      },
      async () => {
        await trackE2EContext(browserContext, 'challenge-rush-player');
        try {
          throw new Error('expected failure');
        } finally {
          await deferE2EContextClose(browserContext);
        }
      },
    ),
    /expected failure/,
  );

  assert.deepEqual(events, ['screenshot', 'content', 'close']);
  const [failureDirectory] = await readdir(artifactDirectory);
  const metadata = JSON.parse(
    await readFile(path.join(artifactDirectory, failureDirectory, 'metadata.json'), 'utf8'),
  );
  assert.equal(metadata.ownerFile, 'challengeRushLifecycle.e2e.test.ts');
  assert.deepEqual(metadata.pages, ['http://127.0.0.1/arcade']);
});
