import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, ChildProcess } from 'child_process';
import path from 'path';
import { chromium, Browser, BrowserContext, Page } from 'playwright';

const PORT = 3915;
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
    await actor.page.click('[data-cr-pause]');
    await actor.page.waitForFunction(() => document.body.textContent?.includes('Pause') === true);
    const pausedChallenge = await actor.page.locator('.challenge-rush-stage h2').textContent();
    await actor.page.waitForTimeout(1_000);
    assert.equal(await actor.page.locator('.challenge-rush-stage h2').textContent(), pausedChallenge);

    await actor.context.setOffline(true);
    await actor.page.waitForTimeout(500);
    await actor.context.setOffline(false);
    await actor.page.waitForSelector('.challenge-rush-stage');
    await actor.page.waitForSelector('[data-cr-pause]');
    await actor.page.click('[data-cr-pause]');
    await actor.page.waitForFunction(() => !document.body.textContent?.includes('Pause'));
  } finally {
    await actor.context.close();
  }
});
