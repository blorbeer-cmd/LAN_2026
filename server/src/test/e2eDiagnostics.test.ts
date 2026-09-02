import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test, type TestContext } from 'node:test';
import type { Browser, BrowserContext, Page } from 'playwright';
import {
  deferE2EContextClose,
  e2eOwnerFileFromArgv,
  runWithE2EDiagnostics,
  StatefulE2EDiagnosticGuard,
  trackE2EContext,
} from './e2e/e2eDiagnostics';

interface StatefulSummary {
  primaryFailure: {
    testName: string;
    error: string;
  };
  cascadeSuppressed: Array<{
    testName: string;
    reason: string;
  }>;
}

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
    // Present because trackE2EContext sets it; deliberately not recorded, since
    // `events` asserts the diagnostics capture order and nothing else.
    setDefaultTimeout: () => {},
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

async function runStatefulChildTest(
  context: TestContext,
  testFileName: string,
  source: (diagnosticsModule: string) => string,
): Promise<{ output: string; summary: StatefulSummary }> {
  const root = await mkdtemp(path.join(tmpdir(), 'e2e-stateful-runner-'));
  context.after(() => rm(root, { recursive: true, force: true }));
  const artifactDirectory = path.join(root, 'artifacts');
  const testFile = path.join(root, testFileName);
  const diagnosticsModule = path.join(__dirname, 'e2e', 'e2eDiagnostics.js');
  await writeFile(testFile, source(diagnosticsModule), 'utf8');

  const childEnv: NodeJS.ProcessEnv = {
    ...process.env,
    E2E_ARTIFACT_DIR: artifactDirectory,
    E2E_TRACE: '0',
  };
  delete childEnv.NODE_TEST_CONTEXT;
  const result = spawnSync(process.execPath, ['--test', testFile], {
    env: childEnv,
    encoding: 'utf8',
    timeout: 15_000,
  });
  const output = `${result.stdout}\n${result.stderr}`;
  assert.notEqual(result.status, 0, output);
  assert.doesNotMatch(output, /POISONED SIBLING BODY RAN/);
  assert.match(
    output,
    /skipped "poisoned sibling flow": blocked by earlier stateful failure: primary flow/,
  );
  assert.match(output, /skipped 1/);

  const artifactEntries = await readdir(artifactDirectory, { withFileTypes: true });
  const summaryDirectory = artifactEntries.find(
    (entry) => entry.isDirectory() && entry.name.startsWith('stateful-'),
  );
  assert.ok(summaryDirectory, output);
  const summary = JSON.parse(
    await readFile(path.join(artifactDirectory, summaryDirectory.name, 'stateful-summary.json'), 'utf8'),
  ) as StatefulSummary;
  return { output, summary };
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

test('stateful diagnostics keep one primary failure and suppress poisoned sibling flows', async (context) => {
  const artifactDirectory = await useDiagnosticArtifacts(context);
  const events: string[] = [];
  const { browser } = createFakeBrowser(events);
  const guard = new StatefulE2EDiagnosticGuard(
    () => ({ browser, ownerFile: 'flowsCommunity.e2e.test.ts' }),
    { sharedState: 'server, browser context, and page' },
  );
  const skipped: string[] = [];
  const testContext = {
    skip: (message?: string) => skipped.push(message ?? ''),
  } as Pick<TestContext, 'skip'>;
  const primaryFailure = new Error('primary stateful failure');

  await assert.rejects(
    guard.run(testContext, 'primary flow', () => {
      throw primaryFailure;
    }),
    (error) => error === primaryFailure,
  );

  let poisonedSiblingRan = false;
  await guard.run(testContext, 'first poisoned sibling flow', () => {
    poisonedSiblingRan = true;
  });

  assert.equal(poisonedSiblingRan, false);
  assert.deepEqual(skipped, ['blocked by earlier stateful failure: primary flow']);
  const artifactEntries = await readdir(artifactDirectory, { withFileTypes: true });
  const summaryDirectory = artifactEntries.find(
    (entry) => entry.isDirectory() && entry.name.startsWith('stateful-flowscommunity-e2e-test-ts-'),
  );
  assert.ok(summaryDirectory, 'expected a stateful summary directory');
  const summaryPath = path.join(
    artifactDirectory,
    summaryDirectory.name,
    'stateful-summary.json',
  );
  const firstSummary = JSON.parse(await readFile(summaryPath, 'utf8'));
  assert.deepEqual(await readdir(path.dirname(summaryPath)), ['stateful-summary.json']);

  await guard.run(testContext, 'second poisoned sibling flow', () => {
    poisonedSiblingRan = true;
  });

  const summary = JSON.parse(await readFile(summaryPath, 'utf8'));
  assert.deepEqual(await readdir(path.dirname(summaryPath)), ['stateful-summary.json']);
  assert.equal(poisonedSiblingRan, false);
  assert.equal(firstSummary.cascadeSuppressed.length, 1);
  assert.deepEqual(skipped, [
    'blocked by earlier stateful failure: primary flow',
    'blocked by earlier stateful failure: primary flow',
  ]);
  assert.equal(summary.ownerFile, 'flowsCommunity.e2e.test.ts');
  assert.equal(summary.primaryFailure.testName, 'primary flow');
  assert.match(summary.primaryFailure.error, /primary stateful failure/);
  assert.deepEqual(summary.cascadeSuppressed, [
    {
      testName: 'first poisoned sibling flow',
      reason: 'blocked by earlier stateful failure: primary flow',
    },
    {
      testName: 'second poisoned sibling flow',
      reason: 'blocked by earlier stateful failure: primary flow',
    },
  ]);
  assert.deepEqual(summary.resetResult, {
    status: 'unsafe',
    action: 'skip-remaining-owner-tests',
    reason: 'A generic reset cannot prove a clean server, browser context, and page state after a failed stateful flow.',
  });
});

test('stateful diagnostics leave successful sibling flows unchanged', async (context) => {
  const artifactDirectory = await useDiagnosticArtifacts(context);
  const events: string[] = [];
  const { browser } = createFakeBrowser(events);
  const guard = new StatefulE2EDiagnosticGuard(
    () => ({ browser, ownerFile: 'flowsShell.e2e.test.ts' }),
    { sharedState: 'server, browser context, and page' },
  );
  const skipped: string[] = [];
  const testContext = {
    skip: (message?: string) => skipped.push(message ?? ''),
  } as Pick<TestContext, 'skip'>;
  const completed: string[] = [];

  await guard.run(testContext, 'first successful flow', () => {
    completed.push('first');
  });
  await guard.run(testContext, 'second successful flow', () => {
    completed.push('second');
  });

  assert.deepEqual(completed, ['first', 'second']);
  assert.deepEqual(skipped, []);
  assert.deepEqual(await readdir(artifactDirectory), []);
});

test('the node test wrapper skips a poisoned sibling without waiting for its body', async (context) => {
  const root = await mkdtemp(path.join(tmpdir(), 'e2e-cascade-runner-'));
  context.after(() => rm(root, { recursive: true, force: true }));
  const artifactDirectory = path.join(root, 'artifacts');
  const testFile = path.join(root, 'statefulCascade.e2e.test.js');
  const diagnosticsModule = path.join(__dirname, 'e2e', 'e2eDiagnostics.js');
  await writeFile(
    testFile,
    `const { createStatefulE2EDiagnosticTest } = require(${JSON.stringify(diagnosticsModule)});\n`
      + `const browser = { contexts: () => [] };\n`
      + `const test = createStatefulE2EDiagnosticTest(\n`
      + `  () => ({ browser, ownerFile: 'statefulCascade.e2e.test.ts' }),\n`
      + `  { sharedState: 'shared test state' },\n`
      + `);\n`
      + `test('primary flow', () => { throw new Error('intentional primary failure'); });\n`
      + `test('poisoned 30 second flow', () => new Promise((resolve) => setTimeout(resolve, 30_000)));\n`,
    'utf8',
  );

  const startedAt = Date.now();
  const childEnv: NodeJS.ProcessEnv = {
    ...process.env,
    E2E_ARTIFACT_DIR: artifactDirectory,
    E2E_TRACE: '0',
  };
  delete childEnv.NODE_TEST_CONTEXT;
  const result = spawnSync(process.execPath, ['--test', testFile], {
    env: childEnv,
    encoding: 'utf8',
    timeout: 15_000,
  });
  const durationMs = Date.now() - startedAt;
  const output = `${result.stdout}\n${result.stderr}`;

  assert.notEqual(result.status, 0, output);
  assert.match(
    output,
    /skipped "poisoned 30 second flow": blocked by earlier stateful failure: primary flow/,
  );
  assert.match(output, /skipped 1/);
  assert.ok(durationMs < 10_000, `poisoned sibling should not wait 30 seconds; took ${durationMs}ms`);
});

test('stateful diagnostics poison siblings when a test after hook fails', async (context) => {
  const { summary } = await runStatefulChildTest(
    context,
    'afterHookFailure.e2e.test.js',
    (diagnosticsModule) =>
      `const { test } = require('node:test');\n` +
      `const { StatefulE2EDiagnosticGuard } = require(${JSON.stringify(diagnosticsModule)});\n` +
      `const browser = { contexts: () => [] };\n` +
      `const guard = new StatefulE2EDiagnosticGuard(\n` +
      `  () => ({ browser, ownerFile: 'afterHookFailure.e2e.test.ts' }),\n` +
      `  { sharedState: 'shared test state' },\n` +
      `);\n` +
      `test('primary flow', (context) => guard.run(context, 'primary flow', () => {\n` +
      `  context.after(() => { throw new Error('intentional after hook failure'); });\n` +
      `}));\n` +
      `test('poisoned sibling flow', (context) => guard.run(context, 'poisoned sibling flow', () => {\n` +
      `  console.log('POISONED SIBLING BODY RAN');\n` +
      `}));\n`,
  );

  assert.equal(summary.primaryFailure.testName, 'primary flow');
  assert.match(summary.primaryFailure.error, /intentional after hook failure/);
  assert.equal(summary.cascadeSuppressed.length, 1);
});

test('stateful diagnostics poison siblings after an uncaught asynchronous failure', async (context) => {
  const { summary } = await runStatefulChildTest(
    context,
    'uncaughtFailure.e2e.test.js',
    (diagnosticsModule) =>
      `const { test } = require('node:test');\n` +
      `const { StatefulE2EDiagnosticGuard } = require(${JSON.stringify(diagnosticsModule)});\n` +
      `const browser = { contexts: () => [] };\n` +
      `const guard = new StatefulE2EDiagnosticGuard(\n` +
      `  () => ({ browser, ownerFile: 'uncaughtFailure.e2e.test.ts' }),\n` +
      `  { sharedState: 'shared test state' },\n` +
      `);\n` +
      `test('primary flow', (context) => guard.run(context, 'primary flow', () => new Promise((resolve) => {\n` +
      `  setTimeout(() => { throw new Error('intentional uncaught timeout failure'); }, 0);\n` +
      `  setTimeout(resolve, 50);\n` +
      `})));\n` +
      `test('poisoned sibling flow', (context) => guard.run(context, 'poisoned sibling flow', () => {\n` +
      `  console.log('POISONED SIBLING BODY RAN');\n` +
      `}));\n`,
  );

  assert.equal(summary.primaryFailure.testName, 'primary flow');
  assert.match(summary.primaryFailure.error, /intentional uncaught timeout failure/);
  assert.equal(summary.cascadeSuppressed.length, 1);
});
