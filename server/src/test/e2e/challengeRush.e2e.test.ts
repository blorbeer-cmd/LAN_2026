import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, ChildProcess } from 'child_process';
import path from 'path';
import { chromium, Browser, BrowserContext, Page } from 'playwright';

const PORT = 3916;
const BASE_URL = `http://localhost:${PORT}`;
let serverProcess: ChildProcess;
let browser: Browser;

async function waitForServer(): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < 10_000) {
    try { if ((await fetch(`${BASE_URL}/api/health`)).ok) return; } catch { /* startup */ }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error('Challenge-Rush-E2E-Server wurde nicht bereit.');
}

async function createPlayer(): Promise<string> {
  const response = await fetch(`${BASE_URL}/api/players`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Challenge Rush E2E' }) });
  assert.equal(response.status, 201);
  return ((await response.json()) as { id: string }).id;
}

async function openArcade(playerId: string): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  await page.goto(BASE_URL);
  await page.evaluate((id) => localStorage.setItem('respawn_my_player_id', id), playerId);
  await page.reload();
  await page.click('.nav-btn[data-view="more"]');
  await page.click('[data-navigate="arcade"]');
  await page.waitForSelector('.arcade-tiles');
  return { context, page };
}

before(async () => {
  serverProcess = spawn('node', [path.join(__dirname, '..', '..', '..', 'dist', 'index.js')], { env: { ...process.env, PORT: String(PORT), DB_FILE: ':memory:', ACCESS_TOKEN: '' }, stdio: 'ignore' });
  await waitForServer();
  browser = await chromium.launch();
});

after(async () => { await browser?.close(); serverProcess?.kill(); });

test('Challenge Rush pauses active time and reconnects the same match', async () => {
  const actor = await openArcade(await createPlayer());
  try {
    await actor.page.click('[data-game="challenge-rush"]');
    await actor.page.click('#cr-create');
    await actor.page.waitForSelector('[data-cr-start]');
    await actor.page.click('[data-cr-start]');
    await actor.page.waitForSelector('.challenge-rush-stage');
    await actor.page.waitForSelector('[data-cr-pause]');
    await actor.page.waitForFunction(() => { const node = document.querySelector('.challenge-rush-stage'); return node?.getAttribute('data-phase') === 'playing' && Number(node.getAttribute('data-remaining-ms')) > 0; });
    const beforePause = await actor.page.locator('.challenge-rush-stage').evaluate((node) => ({
      matchId: node.getAttribute('data-match-id'), challengeIndex: node.getAttribute('data-challenge-index'), remainingMs: Number(node.getAttribute('data-remaining-ms')),
    }));
    await actor.page.click('[data-cr-pause]');
    await actor.page.waitForFunction(() => document.body.textContent?.includes('Pause') === true);
    const paused = await actor.page.locator('.challenge-rush-stage').evaluate((node) => ({
      matchId: node.getAttribute('data-match-id'), challengeIndex: node.getAttribute('data-challenge-index'), remainingMs: Number(node.getAttribute('data-remaining-ms')),
    }));
    assert.equal(paused.matchId, beforePause.matchId);
    assert.equal(paused.challengeIndex, beforePause.challengeIndex);
    assert.ok(paused.remainingMs > 0 && paused.remainingMs <= beforePause.remainingMs);
    await actor.page.waitForTimeout(1_000);
    assert.equal(Number(await actor.page.locator('.challenge-rush-stage').getAttribute('data-remaining-ms')), paused.remainingMs);

    await actor.page.click('[data-cr-pause]');
    await actor.page.waitForFunction((remaining) => Number(document.querySelector('.challenge-rush-stage')?.getAttribute('data-remaining-ms')) < remaining, paused.remainingMs);

    await actor.page.evaluate(() => window.dispatchEvent(new Event('respawn:challenge-rush-disconnect')));
    await actor.page.waitForFunction(() => document.querySelector('.challenge-rush-stage')?.getAttribute('data-disconnected') === 'true');
    await actor.page.evaluate(() => window.dispatchEvent(new Event('respawn:challenge-rush-connect')));
    await actor.page.waitForFunction((expected) => { const node = document.querySelector('.challenge-rush-stage'); return node?.getAttribute('data-reconnected') === 'true' && node.getAttribute('data-match-id') === expected.matchId && node.getAttribute('data-challenge-index') === expected.challengeIndex; }, beforePause);
  } finally {
    await actor.context.close();
  }
});
