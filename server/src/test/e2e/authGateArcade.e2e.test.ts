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
  assert.equal(await page.locator('#tetris-opponent').count(), 0);
  await page.click('#tetris-create');
  await page.waitForSelector('[data-tetris-close]');
  assert.equal(await page.locator('.toast-error:has-text("Gruppen- oder Eventzugriff verweigert")').count(), 0);
  await page.click('[data-tetris-close]');
  await page.waitForSelector('#tetris-create:not([disabled])');
  await page.click('[data-game="challenge-rush"]');
  await page.waitForSelector('#cr-create:not([disabled])');
  assert.equal(await page.locator('#cr-opponent').count(), 0);
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
    assert.equal(await adminPage.locator('#tetris-opponent').count(), 0);
    await adminPage.click('[data-game="challenge-rush"]');
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
    await adminPage.click('[data-game="tetris"]');
    await adminPage.waitForSelector('#tetris-opponent');
    await adminPage.click('[data-game="challenge-rush"]');
    await adminPage.waitForSelector('#cr-opponent');
    await adminPage.waitForSelector('.challenge-rush-test-selector');

    // "Lobby öffnen" is flanked by the mode switch on the left and the
    // opponent switch on the right. A game that has no mode switch reserves
    // that side anyway, so the create action keeps one width and equal insets
    // across games instead of sliding sideways from game to game.
    await adminPage.setViewportSize({ width: 1280, height: 900 });
    await adminPage.click('[data-game="tetris"]');
    await adminPage.waitForSelector('#tetris-mode');
    const withMode = (await adminPage.locator('#tetris-create').boundingBox())!;
    const modeRow = (await adminPage.locator('#tetris-create').locator('xpath=..').boundingBox())!;
    await adminPage.click('[data-game="challenge-rush"]');
    await adminPage.waitForSelector('#cr-opponent');
    assert.equal(await adminPage.locator('#cr-mode').count(), 0);
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
    await adminPage.click('[data-game="tetris"]');
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

    // Leaving Admin mode revokes Arcade AI just like switching identity does,
    // so a selected 'KI' must not linger: the switch stops rendering, and a
    // stale selection would make "Lobby öffnen" emit an admin-only bot event.
    await adminPage.click('[data-game="challenge-rush"]');
    await adminPage.waitForSelector('#cr-create:not([disabled])');
    await adminPage.click('#cr-opponent [data-arcade-opponent="bot"]');
    await adminPage.waitForSelector('#cr-opponent [data-arcade-opponent="bot"][aria-pressed="true"]');
    // Leaving Admin mode refreshes the mounted Arcade view in place, so the
    // switch has to disappear without a navigation or reload — a reload would
    // drop the module state this guards and prove nothing.
    await adminPage.click('#admin-banner-leave');
    await adminPage.waitForSelector('#admin-banner', { state: 'hidden' });
    await adminPage.waitForSelector('#cr-opponent', { state: 'detached' });
    await adminPage.waitForSelector('#cr-create:not([disabled])');
    await adminPage.click('#cr-create');
    await adminPage.waitForSelector('[data-cr-start]');
    const roster = await adminPage.locator('.arcade-lobby-entry').innerText();
    assert.doesNotMatch(roster, /Challenge-Bot/, 'the reset opponent choice opens a human lobby, not an AI one');
  } finally {
    await adminContext.close();
  }
});
