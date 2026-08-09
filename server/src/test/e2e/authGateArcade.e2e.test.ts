import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, ChildProcess } from 'child_process';
import path from 'path';
import { chromium, Browser, BrowserContext, Page } from 'playwright';
import { addSessionCookie, authenticatedServerEnv, createE2EAccount, loginE2EAdmin } from './authHelpers';

const PORT = 3918;
const BASE_URL = `http://localhost:${PORT}`;

let serverProcess: ChildProcess;
let browser: Browser;
let context: BrowserContext;
let page: Page;

async function waitForServer(timeoutMs = 10_000): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      if ((await fetch(`${BASE_URL}/api/health`)).ok) return;
    } catch {
      // startup
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error('Arcade-Auth-E2E-Server wurde nicht bereit.');
}

before(async () => {
  serverProcess = spawn('node', [path.join(__dirname, '..', '..', '..', 'dist', 'index.js')], {
    env: authenticatedServerEnv(PORT),
    stdio: 'ignore',
  });
  await waitForServer();
  const adminCookie = await loginE2EAdmin(BASE_URL);
  const member = await createE2EAccount(BASE_URL, adminCookie, 'E2E Arcade Auth Member');

  browser = await chromium.launch();
  context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await addSessionCookie(context, BASE_URL, member.cookie);
  page = await context.newPage();
  await page.goto(BASE_URL);
  await page.waitForSelector('#app:not([hidden])');
  await page.waitForSelector('.nav-btn[data-view="more"]');
});

after(async () => {
  await context?.close();
  await browser?.close();
  serverProcess?.kill();
});

test('a required-mode member can open an Arcade lobby with a scoped game socket', async () => {
  await page.click('.nav-btn[data-view="more"]');
  await page.click('[data-navigate="arcade"]');
  await page.waitForSelector('.arcade-tiles');
  await page.click('[data-game="tetris"]');
  await page.waitForSelector('#tetris-create:not([disabled])');
  await page.click('#tetris-create');
  await page.waitForSelector('[data-tetris-close]');
  assert.equal(await page.locator('.toast-error:has-text("Gruppen- oder Eventzugriff verweigert")').count(), 0);
  await page.click('[data-tetris-close]');
  await page.waitForSelector('#tetris-create:not([disabled])');
});
