// Browser E2E regression for the retired shared-token gate: a token-shaped
// query parameter must not bypass the personal login, while a real account
// session remains active across reloads.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, ChildProcess } from 'child_process';
import path from 'path';
import { chromium, Browser, Page } from 'playwright';

const PORT = 3902;
const BASE_URL = `http://localhost:${PORT}`;
const ADMIN_NAME = 'Access E2E Admin';
const ADMIN_PASSWORD = 'access-e2e-admin-password';

let serverProcess: ChildProcess;
let browser: Browser;
let page: Page;

async function waitForServer(url: string, timeoutMs = 10_000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {
      // not up yet, keep polling
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(`Server at ${url} did not become ready in time`);
}

before(async () => {
  serverProcess = spawn('node', [path.join(__dirname, '..', '..', '..', 'dist', 'index.js')], {
    env: {
      ...process.env,
      PORT: String(PORT),
      DB_FILE: ':memory:',
      COOKIE_SECURE: '0',
      BOOTSTRAP_ADMIN_1_NAME: ADMIN_NAME,
      BOOTSTRAP_ADMIN_1_PASSWORD: ADMIN_PASSWORD,
    },
    stdio: 'ignore',
  });
  await waitForServer(`${BASE_URL}/api/health`);
  browser = await chromium.launch();
  page = await browser.newPage({ viewport: { width: 390, height: 844 } });
});

after(async () => {
  await browser?.close();
  serverProcess?.kill();
});

test('a shared-token-shaped URL still requires personal login', async () => {
  await page.goto(`${BASE_URL}/?token=obsolete-shared-token`);
  await page.waitForSelector('#auth-screen:not([hidden])');
  assert.equal(await page.locator('#app').isHidden(), true);

  await page.fill('#auth-name', ADMIN_NAME);
  await page.fill('#auth-password', ADMIN_PASSWORD);
  await page.click('#auth-form button[type="submit"]');
  await page.waitForSelector('#app:not([hidden])');
});

test('the personal session is remembered across a reload', async () => {
  await page.reload();
  await page.waitForSelector('#app:not([hidden])');
  assert.equal(await page.locator('#auth-screen').isHidden(), true);
});
