import { before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { ChildProcess } from 'child_process';
import { chromium, Browser, BrowserContext, Page } from 'playwright';
import { addSessionCookie, authenticatedServerEnv, createE2EAccount, loginE2EAdmin } from './authHelpers';
import { createE2EDiagnosticTest, trackE2EContext } from './e2eDiagnostics';
import { startE2EServer, type E2EServer } from './e2eServer';
import { selectArcadeGame } from './arcadeHelpers';

let BASE_URL: string;

let serverProcess: ChildProcess;
let e2eServer: E2EServer;
let browser: Browser;
let context: BrowserContext;
let page: Page;
let adminCookie: string;

const test = createE2EDiagnosticTest(() => ({ browser, server: e2eServer }));

before(async () => {
  const server = await startE2EServer(authenticatedServerEnv());
  e2eServer = server;
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
  await selectArcadeGame(page, 'tetris');
  await page.waitForSelector('#tetris-create:not([disabled])');
  assert.equal(await page.locator('#tetris-opponent').count(), 0);
  await page.click('#tetris-create');
  await page.waitForSelector('[data-tetris-close]');
  assert.equal(await page.locator('.toast-error:has-text("Gruppen- oder Eventzugriff verweigert")').count(), 0);
  await page.click('[data-tetris-close]');
  await page.waitForSelector('#tetris-create:not([disabled])');
  await selectArcadeGame(page, 'challenge-rush');
  await page.waitForSelector('#cr-create:not([disabled])');
  assert.equal(await page.locator('#cr-opponent').count(), 0);
  assert.equal(await page.locator('.challenge-rush-test-selector').count(), 0);
});

test('an admin sees test settings only after activation while Challenge Rush remains multiplayer-only', async () => {
  const adminContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await trackE2EContext(adminContext, 'arcade-auth-admin');
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
    await selectArcadeGame(adminPage, 'tetris');
    await adminPage.waitForSelector('#tetris-create:not([disabled])');
    assert.equal(await adminPage.locator('#tetris-opponent').count(), 0);
    await selectArcadeGame(adminPage, 'challenge-rush');
    await adminPage.waitForSelector('#cr-create:not([disabled])');
    assert.equal(await adminPage.locator('#cr-opponent').count(), 0);
    assert.equal(await adminPage.locator('.challenge-rush-test-selector').count(), 0);

    await adminPage.click('.nav-btn[data-view="more"]');
    await adminPage.click('[data-navigate="admin"]');
    await adminPage.click('#admin-mode-activate');
    await adminPage.waitForSelector('#admin-banner:not([hidden])');
    await adminPage.waitForSelector('#admin-test-players-title');
    await adminPage.click('.nav-btn[data-view="more"]');
    await adminPage.click('[data-navigate="arcade"]');
    await selectArcadeGame(adminPage, 'tetris');
    await adminPage.waitForSelector('#tetris-opponent');
    await selectArcadeGame(adminPage, 'challenge-rush');
    await adminPage.waitForSelector('#cr-create:not([disabled])');
    assert.equal(await adminPage.locator('#cr-opponent').count(), 0);
    await adminPage.waitForSelector('.challenge-rush-test-selector');

    // Challenge Rush has neither a mode nor an opponent switch. Its create
    // action still keeps the shared lobby button width and remains centered.
    await adminPage.setViewportSize({ width: 1280, height: 900 });
    await selectArcadeGame(adminPage, 'tetris');
    await adminPage.waitForSelector('#tetris-mode');
    const withMode = (await adminPage.locator('#tetris-create').boundingBox())!;
    const modeRow = (await adminPage.locator('#tetris-create').locator('xpath=..').boundingBox())!;
    await selectArcadeGame(adminPage, 'challenge-rush');
    await adminPage.waitForSelector('#cr-create');
    assert.equal(await adminPage.locator('#cr-mode').count(), 0);
    assert.equal(await adminPage.locator('#cr-opponent').count(), 0);
    const withoutMode = (await adminPage.locator('#cr-create').boundingBox())!;
    const plainRow = (await adminPage.locator('#cr-create').locator('xpath=..').boundingBox())!;
    assert.equal(withoutMode.width, withMode.width);
    assert.equal(
      Math.round(withoutMode.x - plainRow.x),
      Math.round(withMode.x - modeRow.x),
      'the create action keeps the same left inset with and without a mode switch',
    );
    assert.equal(
      Math.round(plainRow.x + plainRow.width - (withoutMode.x + withoutMode.width)),
      Math.round(withoutMode.x - plainRow.x),
      'the create action keeps equal left and right insets',
    );

    // A host's lobby footer pairs Start with the destructive action. Both must
    // render at the same width. Tetris with only its host is exactly the case
    // that used to break it: Start is disabled and carries a reason tooltip,
    // which nested inside Start's own wrapper took width out of its half.
    await selectArcadeGame(adminPage, 'tetris');
    await adminPage.waitForSelector('#tetris-create:not([disabled])');
    await adminPage.click('#tetris-create');
    await adminPage.waitForSelector('#tetris-start');
    assert.equal(
      await adminPage.locator('.arcade-lobby-entry-actions > .info-tooltip').count(),
      1,
      'a solo Tetris host shows the disabled-Start reason beside the action',
    );
    const startBox = (await adminPage.locator('#tetris-start').boundingBox())!;
    const closeBox = (await adminPage.locator('[data-tetris-close]').boundingBox())!;
    assert.equal(
      Math.round(startBox.width),
      Math.round(closeBox.width),
      'Start and the closing action share the lobby footer evenly',
    );
    await adminPage.click('[data-tetris-close]');
    await adminPage.waitForSelector('#tetris-create:not([disabled])');

    // Leaving Admin mode hides the exact challenge selector in place. The
    // normal multiplayer lobby action remains available.
    await selectArcadeGame(adminPage, 'challenge-rush');
    await adminPage.waitForSelector('#cr-create:not([disabled])');
    await adminPage.click('#admin-banner-leave');
    await adminPage.waitForSelector('#admin-banner', { state: 'hidden' });
    await adminPage.waitForSelector('.challenge-rush-test-selector', { state: 'detached' });
    assert.equal(await adminPage.locator('#cr-opponent').count(), 0);
    await adminPage.waitForSelector('#cr-create:not([disabled])');
    await adminPage.click('#cr-create');
    await adminPage.waitForSelector('[data-cr-start]');
  } finally {
    await adminContext.close();
  }
});
