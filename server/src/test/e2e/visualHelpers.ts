import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import type { Browser, BrowserContext, Locator, Page, Request } from 'playwright';
import { addE2EVisualArtifacts, setE2EVisualEnvironment, trackE2EContext } from './e2eDiagnostics';
import { compareVisualBaseline, visualEnvironmentDifferences } from './visualComparison';

const BASELINE_DIRECTORY = path.resolve(__dirname, '../../../src/test/e2e/visual-baselines');
// Rendering settings of every visual scene; they are part of the recorded reference environment.
const VISUAL_CONTEXT_OPTIONS = {
  locale: 'de-DE', timezoneId: 'Europe/Berlin', reducedMotion: 'reduce', colorScheme: 'dark', deviceScaleFactor: 1,
} as const;

interface ReferenceProfile {
  environment?: unknown;
  baselines?: Record<string, string>;
}

function readReferenceProfile(): ReferenceProfile {
  return JSON.parse(readFileSync(path.join(BASELINE_DIRECTORY, 'reference-profile.json'), 'utf8')) as ReferenceProfile;
}

function treeDigest(roots: string[], describe: (file: string) => string): string {
  const entries: string[] = [];
  const walk = (entry: string): void => {
    let isDirectory: boolean;
    try {
      isDirectory = statSync(entry).isDirectory();
    } catch {
      entries.push(`${entry}|unreadable`);
      return;
    }
    if (isDirectory) readdirSync(entry).forEach((child) => walk(path.join(entry, child)));
    else entries.push(`${entry}|${describe(entry)}`);
  };
  roots.filter((root) => existsSync(root)).forEach(walk);
  return `sha256:${createHash('sha256').update(entries.sort().join('\n')).digest('hex')}`;
}

function operatingSystem(): string {
  try {
    const fields = new Map(readFileSync('/etc/os-release', 'utf8').split('\n')
      .map((line) => /^([A-Z_]+)=(.*)$/.exec(line))
      .filter((match): match is RegExpExecArray => match !== null)
      .map(([, key, value]) => [key, value.replace(/^"|"$/g, '')]));
    return `${fields.get('ID')} ${fields.get('VERSION_ID')}`;
  } catch {
    return `${process.platform} without /etc/os-release`;
  }
}

// Everything that decides how a scene rasterizes. Kernel and host details are deliberately
// absent: Docker Desktop and CI runners differ there without changing Chromium's output.
function collectVisualEnvironment(browser: Browser): Record<string, unknown> {
  const report = process.report?.getReport() as { header?: { glibcVersionRuntime?: string } } | undefined;
  return {
    baseImage: process.env.RESPAWN_VISUAL_BASE_IMAGE ?? 'none',
    os: operatingSystem(),
    glibc: report?.header?.glibcVersionRuntime ?? 'none',
    arch: process.arch,
    node: process.version,
    playwright: (require('playwright/package.json') as { version: string }).version,
    browser: `${browser.browserType().name()} ${browser.version()}`,
    fonts: treeDigest(['/usr/share/fonts', '/usr/local/share/fonts'], (file) => String(statSync(file).size)),
    fontconfig: treeDigest(['/etc/fonts'], (file) => createHash('sha256').update(readFileSync(file)).digest('hex')),
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    rendering: VISUAL_CONTEXT_OPTIONS,
  };
}

export async function visualContext(browser: Browser): Promise<BrowserContext> {
  assert.ok(
    process.env.RESPAWN_VISUAL_BASE_IMAGE,
    'Visual reference scenes run only in the pinned reference container (server/visual-reference). '
      + 'Use the regular E2E commands with a running Docker engine or `npm run test:e2e:visual`; see server/TESTING.md.',
  );
  const context = await browser.newContext({ ...VISUAL_CONTEXT_OPTIONS, viewport: { width: 1024, height: 900 } });
  await trackE2EContext(context, 'visual-reference');
  return context;
}

export class VisualScenes {
  private readonly pending = new Set<Request>();
  private readonly failures: string[] = [];
  private readonly runtimeErrors: string[] = [];
  private readonly profile = readReferenceProfile();
  private readonly environment: Record<string, unknown>;
  private readonly environmentDifferences: string[];

  constructor(private readonly page: Page) {
    const browser = page.context().browser();
    assert.ok(browser, 'Visual scenes require a launched browser');
    // Checked on every run, independent of any pixel comparison.
    this.environment = collectVisualEnvironment(browser);
    this.environmentDifferences = visualEnvironmentDifferences(this.profile.environment, this.environment);
    setE2EVisualEnvironment({ actual: this.environment, differences: this.environmentDifferences });
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
    const file = `${name}.png`;
    const result = await compareVisualBaseline(actual, path.join(BASELINE_DIRECTORY, file), this.profile.baselines?.[file] ?? null);
    // After an environment change every scene is a review candidate, not only the failing ones.
    if (!result.matches || this.environmentDifferences.length) addE2EVisualArtifacts(name, actual, result.diff);
    if (!result.matches) this.failures.push(`${name}: ${result.reason}`);
  }

  finish(): void {
    const environmentChange = this.environmentDifferences.length
      ? [`Reference environment differs from reference-profile.json (${this.environmentDifferences.join('; ')}); `
        + 'review every scene and refresh profile and references explicitly (server/TESTING.md)']
      : [];
    assert.deepEqual([...environmentChange, ...this.failures], [],
      `Visual reference check failed. Actual environment: ${JSON.stringify(this.environment)}. `
      + 'Refresh candidates come only from reference CI artifacts; never adopt screenshots automatically.');
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

/* The help trigger belongs to the text it explains: its square target and its
   pinned glyph are what keep that distance identical in a 12px field label and
   an 18px card heading. Measured from the rendered text edge to the glyph edge,
   because the button box carries padding that the eye does not see.
   Contract: server/frontend-contracts/components/info-tooltip.md#geometrie */
export async function assertInfoTooltipPlacement(page: Page, expectedMinimum: number): Promise<void> {
  const measured = await page.evaluate(() => {
    const results: { label: string; box: number[]; glyph: number[]; gap: number; centerOffset: number }[] = [];
    for (const wrapper of Array.from(document.querySelectorAll('.info-tooltip'))) {
      const trigger = wrapper.querySelector('.info-tooltip-trigger');
      // The warning variant explains a disabled control, not a text, so it
      // follows the gap of the control row instead of the 4px text row.
      if (!trigger || trigger.classList.contains('info-tooltip-trigger--warning')) continue;
      const glyph = trigger.querySelector('.ui-icon');
      const previous = wrapper.previousElementSibling;
      if (!glyph || !previous || !previous.textContent?.trim()) continue;
      // A trigger that explains a control measures from that control's border
      // box; one that explains text measures from the rendered text. Both land
      // on the same 12px because the carrier gap is --space-1 either way, and
      // for wrapped text the element box — not the last line — is the edge the
      // contract names.
      const explainsControl = previous.matches('button, a.btn, a.icon-btn, .btn, .icon-btn');
      let text: DOMRect;
      if (explainsControl) {
        text = previous.getBoundingClientRect();
      } else {
        const range = document.createRange();
        range.selectNodeContents(previous);
        text = range.getBoundingClientRect();
      }
      const triggerBox = trigger.getBoundingClientRect();
      const glyphBox = glyph.getBoundingClientRect();
      if (!text.width) continue;
      results.push({
        label: trigger.getAttribute('aria-label') ?? '',
        box: [triggerBox.width, triggerBox.height],
        glyph: [glyphBox.width, glyphBox.height],
        gap: glyphBox.left - text.right,
        centerOffset: (glyphBox.top + glyphBox.height / 2) - (text.top + text.height / 2),
      });
    }
    return results;
  });
  assert.ok(measured.length >= expectedMinimum,
    `measured ${measured.length} help tooltips, expected at least ${expectedMinimum}`);
  for (const item of measured) {
    assert.ok(Math.abs(item.box[0] - 32) <= 1 && Math.abs(item.box[1] - 32) <= 1,
      `${item.label}: target ${item.box.join('x')}px, expected 32x32px`);
    assert.ok(Math.abs(item.glyph[0] - 16) <= 0.5 && Math.abs(item.glyph[1] - 16) <= 0.5,
      `${item.label}: glyph ${item.glyph.join('x')}px, expected 16x16px`);
    assert.ok(Math.abs(item.gap - 12) <= 1,
      `${item.label}: ${item.gap.toFixed(1)}px from the explained text, expected 12±1px`);
    assert.ok(Math.abs(item.centerOffset) <= 1,
      `${item.label}: glyph center off the text center by ${item.centerOffset.toFixed(1)}px`);
  }
}

export async function assertNoOverflow(target: Locator): Promise<void> {
  assert.equal(await target.evaluate((element) => element.scrollWidth <= element.clientWidth), true);
}
