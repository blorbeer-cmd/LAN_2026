import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test, type TestContext } from 'node:test';
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

async function useDiagnosticArtifacts(context: TestContext): Promise<string> {
  const artifactDirectory = await mkdtemp(path.join(tmpdir(), 'e2e-diagnostics-'));
  context.after(() => rm(artifactDirectory, { recursive: true, force: true }));
  const previousArtifactDirectory = process.env.E2E_ARTIFACT_DIR;
  const previousTrace = process.env.E2E_TRACE;
  process.env.E2E_ARTIFACT_DIR = artifactDirectory;
  process.env.E2E_TRACE = '1';
  context.after(() => {
    if (previousArtifactDirectory === undefined) delete process.env.E2E_ARTIFACT_DIR;
    else process.env.E2E_ARTIFACT_DIR = previousArtifactDirectory;
    if (previousTrace === undefined) delete process.env.E2E_TRACE;
    else process.env.E2E_TRACE = previousTrace;
  });
  return artifactDirectory;
}

function createFakeBrowser(
  events: string[],
  failures: Partial<Record<'screenshot' | 'content' | 'traceStop' | 'close', boolean>> = {},
): { browser: Browser; browserContext: BrowserContext } {
  let closed = false;
  const page = {
    on: () => page,
    isClosed: () => closed,
    screenshot: async ({ path: screenshotPath }: { path: string }) => {
      events.push('screenshot');
      if (failures.screenshot) throw new Error('screenshot failed');
      await writeFile(screenshotPath, 'screenshot');
    },
    content: async () => {
      events.push('content');
      if (failures.content) throw new Error('content failed');
      return '<main>diagnostic state</main>';
    },
    url: () => 'http://127.0.0.1/arcade',
  } as unknown as Page;
  const browserContext = {
    pages: () => [page],
    on: () => browserContext,
    close: async () => {
      events.push('close');
      if (failures.close) throw new Error('close failed');
      closed = true;
    },
    tracing: {
      start: async () => {
        events.push('trace:start');
      },
      stop: async (options?: { path?: string }) => {
        events.push(options?.path ? 'trace:stop:saved' : 'trace:stop:discarded');
        if (failures.traceStop) throw new Error('trace stop failed');
        if (options?.path) await writeFile(options.path, 'trace');
      },
    },
  } as unknown as BrowserContext;
  const browser = {
    contexts: () => [browserContext],
  } as unknown as Browser;
  return { browser, browserContext };
}

test('deferred contexts preserve screenshots, DOM, and traces before failure cleanup', async (context) => {
  const artifactDirectory = await useDiagnosticArtifacts(context);
  const events: string[] = [];
  const { browser, browserContext } = createFakeBrowser(events);
  const expectedFailure = new Error('expected failure');

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
          throw expectedFailure;
        } finally {
          await deferE2EContextClose(browserContext);
        }
      },
    ),
    (error) => error === expectedFailure,
  );

  assert.deepEqual(events, [
    'trace:start',
    'screenshot',
    'content',
    'trace:stop:saved',
    'close',
  ]);
  const [failureDirectory] = await readdir(artifactDirectory);
  assert.ok(
    (await readdir(path.join(artifactDirectory, failureDirectory)))
      .some((file) => file.startsWith('trace-') && file.endsWith('.zip')),
  );
  const metadata = JSON.parse(
    await readFile(path.join(artifactDirectory, failureDirectory, 'metadata.json'), 'utf8'),
  );
  assert.equal(metadata.ownerFile, 'challengeRushLifecycle.e2e.test.ts');
  assert.deepEqual(metadata.pages, ['http://127.0.0.1/arcade']);
});

test('successful deferred contexts discard trace staging data before cleanup', async (context) => {
  const artifactDirectory = await useDiagnosticArtifacts(context);
  const events: string[] = [];
  const { browser, browserContext } = createFakeBrowser(events);

  await runWithE2EDiagnostics(
    { testName: 'successful deferred cleanup', browser },
    async () => {
      await trackE2EContext(browserContext, 'challenge-rush-player');
      await deferE2EContextClose(browserContext);
    },
  );

  assert.deepEqual(events, ['trace:start', 'trace:stop:discarded', 'close']);
  assert.deepEqual(await readdir(artifactDirectory), []);
});

test('capture and deferred cleanup failures never replace the original test failure', async (context) => {
  await useDiagnosticArtifacts(context);
  for (const component of ['screenshot', 'content', 'traceStop', 'close'] as const) {
    const events: string[] = [];
    const { browser, browserContext } = createFakeBrowser(events, { [component]: true });
    const expectedFailure = new Error(`original failure before ${component}`);

    await assert.rejects(
      runWithE2EDiagnostics(
        {
          testName: `preserves original failure when ${component} fails`,
          browser,
          ownerFile: 'challengeRushLifecycle.e2e.test.ts',
        },
        async () => {
          try {
            throw expectedFailure;
          } finally {
            await deferE2EContextClose(browserContext);
          }
        },
      ),
      (error) => error === expectedFailure,
    );
    assert.ok(events.includes('close'), `${component} failure must still attempt context cleanup`);
  }
});
