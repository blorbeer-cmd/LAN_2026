// Browser E2E test for the shared access-token gate (NFR-16): the login
// screen must appear when ACCESS_TOKEN is set, reject a wrong token, accept
// the right one, and remember it across a reload.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, ChildProcess } from 'child_process';
import path from 'path';
import { chromium, Browser, Page } from 'playwright';

const PORT = 3902;
const BASE_URL = `http://localhost:${PORT}`;
const TOKEN = 'e2e-test-token';

let serverProcess: ChildProcess;
let browser: Browser;
let page: Page;

async function waitForServer(url: string, timeoutMs = 10_000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url, { headers: { 'x-access-token': TOKEN } });
      if (res.ok) return;
    } catch {
      // not up yet, keep polling
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error(`Server at ${url} did not become ready in time`);
}

before(async () => {
  serverProcess = spawn('node', [path.join(__dirname, '..', '..', '..', 'dist', 'index.js')], {
    env: { ...process.env, PORT: String(PORT), DB_FILE: ':memory:', ACCESS_TOKEN: TOKEN },
    stdio: 'ignore',
  });
  await waitForServer(`${BASE_URL}/api/health`);
  // Let Playwright resolve its own installed browser (via `npx playwright
  // install chromium`, run before `npm run test:e2e`) instead of a fixed
  // path — a hardcoded path only worked in one specific pre-provisioned
  // environment and broke everywhere else, including CI.
  browser = await chromium.launch();
  page = await browser.newPage({ viewport: { width: 390, height: 844 } });
});

after(async () => {
  await browser?.close();
  serverProcess?.kill();
});

test('login screen gates access, rejects wrong token, accepts the right one', async () => {
  await page.goto(BASE_URL);
  await page.waitForSelector('#login-screen:not([hidden])');

  await page.fill('#login-token', 'falsches-token');
  await page.click('#login-form button[type="submit"]');
  await page.waitForSelector('#login-error:not([hidden])');

  await page.fill('#login-token', TOKEN);
  await page.click('#login-form button[type="submit"]');
  await page.waitForSelector('#app:not([hidden])');
});

test('token is remembered across a reload', async () => {
  await page.reload();
  await page.waitForSelector('#app:not([hidden])');
  const loginHidden = await page.getAttribute('#login-screen', 'hidden');
  assert.notEqual(loginHidden, null);
});

test('an invite link (?token=) logs in automatically without the login form', async () => {
  await page.evaluate(() => localStorage.clear());
  await page.goto(`${BASE_URL}/?token=${TOKEN}`);
  await page.waitForSelector('#app:not([hidden])');

  // Settings shows that same link back, built from the now-stored token.
  await page.click('#settings-btn');
  await page.waitForSelector('#invite-link');
  const linkValue = await page.inputValue('#invite-link');
  assert.ok(linkValue.includes(`token=${TOKEN}`));
});

test('an invite link with a wrong token falls back to the login screen', async () => {
  await page.evaluate(() => localStorage.clear());
  await page.goto(`${BASE_URL}/?token=not-the-real-token`);
  await page.waitForSelector('#login-screen:not([hidden])');
});
