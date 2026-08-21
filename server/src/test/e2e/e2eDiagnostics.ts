import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { test as nodeTest, type TestContext } from 'node:test';
import type { Browser, BrowserContext, Page } from 'playwright';
import { e2eArtifactDirectory } from '../../../scripts/e2e-artifact-directory.cjs';
import type { E2EServer } from './e2eServer';

interface DiagnosticResources {
  testName: string;
  browser: Browser;
  server?: E2EServer;
  ownerFile?: string;
}

interface StatefulDiagnosticOptions {
  sharedState: string;
}

interface StatefulPrimaryFailure {
  testName: string;
  error: string;
  recordedAt: string;
}

interface SuppressedCascade {
  testName: string;
  reason: string;
}

interface TrackedContext {
  context: BrowserContext;
  label: string;
  tracing: boolean;
  traceIndex: number;
  closeAfterRun: boolean;
}

const MAX_BROWSER_LOG_LINES = 500;
let activeRun: E2EDiagnosticRun | null = null;

function artifactSlug(value: string): string {
  const slug = value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase();
  return slug.slice(0, 80) || 'e2e-failure';
}

function errorText(error: unknown): string {
  if (error instanceof Error) return error.stack ?? error.message;
  return String(error);
}

export function e2eOwnerFileFromArgv(argv: readonly string[] = process.argv): string | null {
  const entryFile = path.basename(argv[1] ?? '');
  if (entryFile.endsWith('.e2e.test.ts')) return entryFile;
  if (entryFile.endsWith('.e2e.test.js')) return entryFile.replace(/\.js$/, '.ts');
  return null;
}

class E2EDiagnosticRun {
  private readonly contexts = new Map<BrowserContext, TrackedContext>();
  private readonly browserLog: string[] = [];
  private readonly directory: string;
  private captured = false;

  constructor(private readonly resources: DiagnosticResources) {
    const root = e2eArtifactDirectory();
    this.directory = path.join(root, `${artifactSlug(resources.testName)}-${process.pid}`);
  }

  private appendBrowserLog(line: string): void {
    this.browserLog.push(`${new Date().toISOString()} ${line}`);
    if (this.browserLog.length > MAX_BROWSER_LOG_LINES) this.browserLog.shift();
  }

  private instrumentPage(page: Page, label: string): void {
    page.on('console', (message) => {
      if (message.type() === 'error' || message.type() === 'warning') {
        this.appendBrowserLog(`[${label}] console.${message.type()}: ${message.text()}`);
      }
    });
    page.on('pageerror', (error) => this.appendBrowserLog(`[${label}] pageerror: ${error.message}`));
    page.on('requestfailed', (request) => {
      this.appendBrowserLog(
        `[${label}] requestfailed: ${request.method()} ${request.url()} (${request.failure()?.errorText ?? 'unknown'})`,
      );
    });
  }

  async trackContext(context: BrowserContext, label: string, startTrace = true): Promise<void> {
    if (this.contexts.has(context)) return;
    const tracked: TrackedContext = {
      context,
      label: artifactSlug(label),
      tracing: false,
      traceIndex: this.contexts.size + 1,
      closeAfterRun: false,
    };
    this.contexts.set(context, tracked);
    context.pages().forEach((page, index) => this.instrumentPage(page, `${tracked.label}-${index + 1}`));
    context.on('page', (page) => this.instrumentPage(page, `${tracked.label}-${context.pages().length}`));

    if (startTrace && process.env.E2E_TRACE === '1') {
      try {
        await mkdir(this.directory, { recursive: true });
        await context.tracing.start({ screenshots: true, snapshots: true, sources: false });
        tracked.tracing = true;
        const close = context.close.bind(context);
        context.close = async (options) => {
          // Many fixtures close their short-lived contexts in a finally block
          // before the outer test wrapper sees the assertion error. Persist
          // the trace at that boundary so the most useful evidence survives.
          await this.stopTrace(tracked, this.directory);
          await close(options);
        };
      } catch (error) {
        this.appendBrowserLog(`[${tracked.label}] trace start failed: ${errorText(error)}`);
      }
    }
  }

  async deferContextClose(context: BrowserContext): Promise<void> {
    await this.trackContext(context, 'deferred-context');
    this.contexts.get(context)!.closeAfterRun = true;
  }

  async trackExistingContexts(): Promise<void> {
    await Promise.all(
      this.resources.browser
        .contexts()
        .map((context, index) => this.trackContext(context, `existing-context-${index + 1}`)),
    );
  }

  private captureContexts(): BrowserContext[] {
    return [...new Set([...this.contexts.keys(), ...this.resources.browser.contexts()])];
  }

  private async stopTrace(tracked: TrackedContext, directory?: string): Promise<void> {
    if (!tracked.tracing) return;
    tracked.tracing = false;
    try {
      await tracked.context.tracing.stop(
        directory
          ? { path: path.join(directory, `trace-${tracked.traceIndex}-${tracked.label}.zip`) }
          : undefined,
      );
    } catch (error) {
      this.appendBrowserLog(`[${tracked.label}] trace stop failed: ${errorText(error)}`);
    }
  }

  private async stopTraces(directory?: string): Promise<void> {
    await Promise.all(
      [...this.contexts.values()].map((tracked) => this.stopTrace(tracked, directory)),
    );
  }

  async capture(error: unknown): Promise<void> {
    this.captured = true;
    await mkdir(this.directory, { recursive: true });

    const contexts = this.captureContexts();
    for (const [contextIndex, context] of contexts.entries()) {
      await this.trackContext(context, `failure-context-${contextIndex + 1}`, false);
      for (const [pageIndex, page] of context.pages().entries()) {
        if (page.isClosed()) continue;
        const prefix = `page-${contextIndex + 1}-${pageIndex + 1}`;
        try {
          await page.screenshot({ path: path.join(this.directory, `${prefix}.png`), fullPage: true });
        } catch (captureError) {
          this.appendBrowserLog(`[${prefix}] screenshot failed: ${errorText(captureError)}`);
        }
        try {
          await writeFile(path.join(this.directory, `${prefix}.html`), await page.content(), 'utf8');
        } catch (captureError) {
          this.appendBrowserLog(`[${prefix}] DOM capture failed: ${errorText(captureError)}`);
        }
      }
    }

    await this.stopTraces(this.directory);
    const serverDiagnostics = this.resources.server?.diagnostics() ?? {
      output: 'No E2E server diagnostics are available for this browser-only fixture.\n',
      exit: null,
    };
    await Promise.all([
      writeFile(path.join(this.directory, 'browser.log'), `${this.browserLog.join('\n')}\n`, 'utf8'),
      writeFile(path.join(this.directory, 'server.log'), serverDiagnostics.output, 'utf8'),
      writeFile(
        path.join(this.directory, 'metadata.json'),
        `${JSON.stringify(
          {
            testName: this.resources.testName,
            ownerFile: this.resources.ownerFile ?? e2eOwnerFileFromArgv(),
            error: errorText(error),
            serverExit: serverDiagnostics.exit,
            pages: contexts.flatMap((context) =>
              context.pages().filter((page) => !page.isClosed()).map((page) => page.url()),
            ),
          },
          null,
          2,
        )}\n`,
        'utf8',
      ),
    ]);
    console.error(`[e2e diagnostics] failure artifacts: ${this.directory}`);
  }

  async finish(): Promise<void> {
    if (this.captured) return;
    await this.stopTraces();
    // A trace that was saved because a context closed during a successful
    // test is only staging data. Keep the artifact tree focused on failures.
    await rm(this.directory, { recursive: true, force: true });
  }

  async closeDeferredContexts(): Promise<void> {
    for (const tracked of this.contexts.values()) {
      if (!tracked.closeAfterRun) continue;
      try {
        await tracked.context.close();
      } catch (error) {
        console.error(
          `[e2e diagnostics] deferred context cleanup failed (${tracked.label}): ${errorText(error)}`,
        );
      }
    }
  }
}

export async function trackE2EContext(context: BrowserContext, label: string): Promise<void> {
  await activeRun?.trackContext(context, label);
}

export async function deferE2EContextClose(context: BrowserContext): Promise<void> {
  if (activeRun) {
    await activeRun.deferContextClose(context);
    return;
  }
  await context.close();
}

export function createE2EDiagnosticTest(
  resources: () => Omit<DiagnosticResources, 'testName'>,
): (name: string, run: () => void | Promise<void>) => Promise<void> {
  return (name, run) =>
    nodeTest(name, () =>
      runWithE2EDiagnostics({ testName: name, ...resources() }, run),
    );
}

export class StatefulE2EDiagnosticGuard {
  private primaryFailure: StatefulPrimaryFailure | null = null;
  private readonly cascadeSuppressed: SuppressedCascade[] = [];
  private summaryFile: string | null = null;

  constructor(
    private readonly resources: () => Omit<DiagnosticResources, 'testName'>,
    private readonly options: StatefulDiagnosticOptions,
  ) {}

  private resolveSummaryFile(resources: Omit<DiagnosticResources, 'testName'>): string {
    if (this.summaryFile) return this.summaryFile;
    const ownerFile = resources.ownerFile ?? e2eOwnerFileFromArgv() ?? 'unknown-e2e-owner.ts';
    this.summaryFile = path.join(
      e2eArtifactDirectory(),
      `stateful-${artifactSlug(ownerFile)}-${process.pid}`,
      'stateful-summary.json',
    );
    return this.summaryFile;
  }

  private async persistSummary(resources: Omit<DiagnosticResources, 'testName'>): Promise<void> {
    if (!this.primaryFailure) return;
    const summaryFile = this.resolveSummaryFile(resources);
    try {
      await mkdir(path.dirname(summaryFile), { recursive: true });
      await writeFile(
        summaryFile,
        `${JSON.stringify(
          {
            version: 1,
            ownerFile: resources.ownerFile ?? e2eOwnerFileFromArgv(),
            primaryFailure: this.primaryFailure,
            cascadeSuppressed: this.cascadeSuppressed,
            resetResult: {
              status: 'unsafe',
              action: 'skip-remaining-owner-tests',
              reason: `A generic reset cannot prove a clean ${this.options.sharedState} state after a failed stateful flow.`,
            },
          },
          null,
          2,
        )}\n`,
        'utf8',
      );
    } catch (error) {
      console.error(`[e2e diagnostics] stateful summary failed: ${errorText(error)}`);
    }
  }

  async run(
    context: Pick<TestContext, 'skip'>,
    testName: string,
    run: () => void | Promise<void>,
  ): Promise<void> {
    const resources = this.resources();
    if (this.primaryFailure) {
      const reason = `blocked by earlier stateful failure: ${this.primaryFailure.testName}`;
      this.cascadeSuppressed.push({ testName, reason });
      await this.persistSummary(resources);
      console.error(`[e2e cascade] skipped "${testName}": ${reason}`);
      context.skip(reason);
      return;
    }

    await runWithE2EDiagnostics(
      { testName, ...resources },
      async () => {
        try {
          await run();
        } catch (error) {
          this.primaryFailure = {
            testName,
            error: errorText(error),
            recordedAt: new Date().toISOString(),
          };
          await this.persistSummary(resources);
          throw error;
        }
      },
    );
  }
}

export function createStatefulE2EDiagnosticTest(
  resources: () => Omit<DiagnosticResources, 'testName'>,
  options: StatefulDiagnosticOptions,
): (name: string, run: () => void | Promise<void>) => Promise<void> {
  const guard = new StatefulE2EDiagnosticGuard(resources, options);
  return (name, run) =>
    nodeTest(name, { concurrency: false }, (context) => guard.run(context, name, run));
}

export async function runWithE2EDiagnostics(
  resources: DiagnosticResources,
  run: () => void | Promise<void>,
): Promise<void> {
  const diagnosticRun = new E2EDiagnosticRun(resources);
  activeRun = diagnosticRun;
  await diagnosticRun.trackExistingContexts();
  try {
    await run();
  } catch (error) {
    try {
      await diagnosticRun.capture(error);
    } catch (captureError) {
      console.error(`[e2e diagnostics] artifact capture failed: ${errorText(captureError)}`);
    }
    throw error;
  } finally {
    try {
      await diagnosticRun.finish();
    } finally {
      await diagnosticRun.closeDeferredContexts();
      if (activeRun === diagnosticRun) activeRun = null;
    }
  }
}
