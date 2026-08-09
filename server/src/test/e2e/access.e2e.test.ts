// Browser E2E regression for the retired shared-token gate: a token-shaped
// query parameter must not bypass the personal login, while a real account
// session remains active across reloads.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { ChildProcess } from 'child_process';
import { chromium, Browser, Page } from 'playwright';
import { startE2EServer } from './e2eServer';

let BASE_URL: string;
const ADMIN_NAME = 'Access E2E Admin';
const ADMIN_PASSWORD = 'access-e2e-admin-password';

let serverProcess: ChildProcess;
let browser: Browser;
let page: Page;

before(async () => {
  const server = await startE2EServer({
    ...process.env,
    DB_FILE: ':memory:',
    COOKIE_SECURE: '0',
    BOOTSTRAP_ADMIN_1_NAME: ADMIN_NAME,
    BOOTSTRAP_ADMIN_1_PASSWORD: ADMIN_PASSWORD,
  });
  serverProcess = server.process;
  BASE_URL = server.baseUrl;
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
