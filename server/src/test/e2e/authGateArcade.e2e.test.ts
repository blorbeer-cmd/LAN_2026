import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { ChildProcess } from 'child_process';
import { chromium, Browser, BrowserContext, Page } from 'playwright';
import { addSessionCookie, authenticatedServerEnv, createE2EAccount, loginE2EAdmin } from './authHelpers';
import { startE2EServer } from './e2eServer';

let BASE_URL: string;

let serverProcess: ChildProcess;
let browser: Browser;
let context: BrowserContext;
let page: Page;
let adminCookie: string;

before(async () => {
  const server = await startE2EServer(authenticatedServerEnv());
  serverProcess = server.process;
  BASE_URL = server.baseUrl;
  adminCookie = await loginE2EAdmin(BASE_URL);
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
  assert.equal(await page.locator('[data-navigate="admin"]').count(), 0);
  await page.click('[data-navigate="arcade"]');
  await page.waitForSelector('.arcade-tiles');
  await page.click('[data-game="tetris"]');
  await page.waitForSelector('#tetris-create:not([disabled])');
  assert.equal(await page.locator('#tetris-bot').count(), 0);
  await page.click('#tetris-create');
  await page.waitForSelector('[data-tetris-close]');
  assert.equal(await page.locator('.toast-error:has-text("Gruppen- oder Eventzugriff verweigert")').count(), 0);
  await page.click('[data-tetris-close]');
  await page.waitForSelector('#tetris-create:not([disabled])');
  await page.click('[data-game="challenge-rush"]');
  await page.waitForSelector('#cr-create:not([disabled])');
  assert.equal(await page.locator('#cr-bot').count(), 0);
  assert.equal(await page.locator('.challenge-rush-test-selector').count(), 0);
});

test('an admin sees settings without admin mode and Arcade AI only after activation', async () => {
  const adminContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await addSessionCookie(adminContext, BASE_URL, adminCookie);
  const adminPage = await adminContext.newPage();
  try {
    await adminPage.goto(BASE_URL);
    await adminPage.waitForSelector('#app:not([hidden])');
    await adminPage.click('.nav-btn[data-view="more"]');
    await adminPage.click('[data-navigate="admin"]');
    await adminPage.waitForSelector('#admin-mode-activate');
    await adminPage.waitForSelector('#admin-tools-title');
    await adminPage.waitForSelector('#admin-register-link');
    assert.equal(await adminPage.locator('#admin-test-players-title').count(), 0);
    assert.equal(await adminPage.locator('#admin-banner').isHidden(), true);

    await adminPage.click('.nav-btn[data-view="more"]');
    await adminPage.click('[data-navigate="arcade"]');
    await adminPage.waitForSelector('.arcade-tiles');
    await adminPage.click('[data-game="tetris"]');
    await adminPage.waitForSelector('#tetris-create:not([disabled])');
    assert.equal(await adminPage.locator('#tetris-bot').count(), 0);
    await adminPage.click('[data-game="challenge-rush"]');
    await adminPage.waitForSelector('#cr-create:not([disabled])');
    assert.equal(await adminPage.locator('#cr-bot').count(), 0);
    assert.equal(await adminPage.locator('.challenge-rush-test-selector').count(), 0);

    await adminPage.click('.nav-btn[data-view="more"]');
    await adminPage.click('[data-navigate="admin"]');
    await adminPage.click('#admin-mode-activate');
    await adminPage.waitForSelector('#admin-banner:not([hidden])');
    await adminPage.waitForSelector('#admin-test-players-title');
    await adminPage.click('.nav-btn[data-view="more"]');
    await adminPage.click('[data-navigate="arcade"]');
    await adminPage.click('[data-game="tetris"]');
    await adminPage.waitForSelector('#tetris-bot');
    await adminPage.click('[data-game="challenge-rush"]');
    await adminPage.waitForSelector('#cr-bot');
    await adminPage.waitForSelector('.challenge-rush-test-selector');
  } finally {
    await adminContext.close();
  }
});
