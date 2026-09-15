import assert from 'node:assert/strict';
import path from 'node:path';
import type { Browser, BrowserContext, Locator, Page, Request } from 'playwright';
import { addE2EVisualArtifacts, trackE2EContext } from './e2eDiagnostics';
import { compareVisualBaseline } from './visualComparison';

export async function visualContext(browser: Browser): Promise<BrowserContext> {
  const context = await browser.newContext({
    locale: 'de-DE', timezoneId: 'Europe/Berlin', reducedMotion: 'reduce',
    colorScheme: 'dark', deviceScaleFactor: 1, viewport: { width: 1024, height: 900 },
  });
  await trackE2EContext(context, 'visual-reference');
  return context;
}

export class VisualScenes {
  private readonly pending = new Set<Request>();
  private readonly failures: string[] = [];
  private readonly runtimeErrors: string[] = [];

  constructor(private readonly page: Page) {
    page.on('request', (request) => this.pending.add(request));
    page.on('requestfinished', (request) => this.pending.delete(request));
    page.on('requestfailed', (request) => {
      this.pending.delete(request);
      if (request.failure()?.errorText !== 'net::ERR_ABORTED') this.runtimeErrors.push(`Request failed: ${request.url()}`);
    });
    page.on('pageerror', (error) => this.runtimeErrors.push(error.message));
    page.on('response', (response) => {
      if (response.status() >= 500) this.runtimeErrors.push(`HTTP ${response.status()}: ${response.url()}`);
    });
  }

  async ready(): Promise<void> {
    // Await precisely the current requests, not a fixed settling delay or network-idle window.
    while (this.pending.size) {
      const current = [...this.pending];
      await Promise.all(current.map(async (request) => { await (await request.response())?.finished(); }));
    }
    await this.page.evaluate(async () => {
      await document.fonts.ready;
      await Promise.all(Array.from(document.images).filter((image) => image.currentSrc).map((image) => image.decode()));
      // A rendered frame also lets the existing icon MutationObserver finish.
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    });
    assert.deepEqual(this.runtimeErrors, [], 'Separate product/runtime finding; never refresh a baseline to hide this');
  }

  async capture(name: string, target: Locator, semanticAssertions: () => Promise<void>): Promise<void> {
    await target.scrollIntoViewIfNeeded();
    await this.page.mouse.move(0, 0);
    await this.ready();
    await semanticAssertions();
    const actual = await target.screenshot({ animations: 'disabled', caret: 'hide', scale: 'css' });
    const baseline = path.resolve(__dirname, '../../../src/test/e2e/visual-baselines', `${name}.png`);
    const result = await compareVisualBaseline(actual, baseline);
    if (!result.matches) {
      addE2EVisualArtifacts(name, actual, result.diff);
      this.failures.push(`${name}: ${result.reason}`);
    }
  }

  finish(): void {
    const version = (require('playwright/package.json') as { version: string }).version;
    const profile = `platform=${process.platform}, CI=${process.env.CI ?? 'unset'}, ImageOS=${process.env.ImageOS ?? 'unset'}, ImageVersion=${process.env.ImageVersion ?? 'unset'}, Playwright=${version}`;
    assert.deepEqual(this.failures, [],
      'Visual reference comparison failed. Reference: CI ubuntu-latest, Playwright 1.56.1; '
      + 'baseline image provenance: see TESTING.md and the baseline PR. '
      + `Actual profile: ${profile}. `
      + 'A different profile can affect fonts/rasterization; it does not prove that a mismatch is harmless. '
      + 'Confirm on the same PR head in reference CI; do not accept local screenshots as baselines.');
  }
}

export async function assertControlHeights(controls: Locator): Promise<void> {
  const measure = () => controls.evaluateAll((elements) => elements.map((element) => ({
    label: element.textContent || element.getAttribute('aria-label'),
    height: element.getBoundingClientRect().height,
    connected: element.isConnected,
  })));
  // evaluateAll resolves the locator and runs the callback in two protocol
  // steps. A re-render in between hands over replaced, detached nodes whose
  // 0px box is no geometry at all, so only such a sample is taken again. An
  // empty match is never re-sampled and still fails below.
  let boxes = await measure();
  for (let attempt = 1; attempt < 3 && boxes.some((box) => !box.connected); attempt += 1) boxes = await measure();
  assert.ok(boxes.length > 0);
  for (const box of boxes) {
    assert.ok(box.connected, `${box.label}: replaced during every measurement`);
    assert.ok(box.height >= 31 && box.height <= 33, `${box.label}: ${box.height}px, expected 32±1px`);
  }
}

export async function assertNoOverflow(target: Locator): Promise<void> {
  assert.equal(await target.evaluate((element) => element.scrollWidth <= element.clientWidth), true);
}
