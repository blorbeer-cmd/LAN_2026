// Browser E2E test for real per-user login (see
// docs/KONZEPT-USER-MANAGEMENT.md): an invite link
// registers a brand-new account and logs it straight in, logging out drops
// back to the login gate, and logging back in with the same credentials
// works. Bootstraps one admin via ADMIN_RECOVERY_CODE (through plain fetch,
// not the browser — that flow has its own coverage in
// api.auth.recovery.test.ts) purely to be able to mint the invite code this
// test needs.

import { before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { ChildProcess } from 'child_process';
import { chromium, Browser, Page } from 'playwright';
import { createE2EDiagnosticTest, trackE2EContext, deferE2EContextClose } from './e2eDiagnostics';
import { startE2EServer, type E2EServer } from './e2eServer';
import { waitForPlayerData } from './authHelpers';
import { activateAdminMode, openAdminCard, openMoreViewEntry, openUtilityView } from './navHelpers';
import { assertControlHeights, assertNoOverflow } from './visualHelpers';

let BASE_URL: string;
const RECOVERY_CODE = 'e2e-admin-recovery-code';
const NAME = 'E2E New Person';
const PASSWORD = 'e2e new person password';
const PASSWORD_AFTER_RESET = 'e2e password after reset';

let serverProcess: ChildProcess;
let e2eServer: E2EServer;
let browser: Browser;
let page: Page;
let adminCookie: string;

const test = createE2EDiagnosticTest(() => ({ browser, server: e2eServer }));

// Mints a fresh 'register' invite code by bootstrapping one admin account
// via the recovery code (plain HTTP, no browser involved) and having it
// issue the invite the actual browser flow will consume.
async function mintRegisterInviteCode(): Promise<string> {
  const bootstrap = await fetch(`${BASE_URL}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code: RECOVERY_CODE, name: 'E2E Bootstrap Admin', password: 'e2e bootstrap password' }),
  });
  const setCookie = bootstrap.headers.get('set-cookie');
  assert.ok(setCookie, 'bootstrap register should set a session cookie');
  adminCookie = setCookie!.split(';')[0];
  const onboarding = await fetch(`${BASE_URL}/api/me/onboarding/test-complete`, {
    method: 'POST',
    headers: { Cookie: adminCookie },
  });
  assert.equal(onboarding.status, 200, await onboarding.text());

  const reauth = await fetch(`${BASE_URL}/api/auth/reauth`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
    body: JSON.stringify({ password: 'e2e bootstrap password' }),
  });
  assert.equal(reauth.status, 204);

  const invite = await fetch(`${BASE_URL}/api/auth/invites`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
    body: JSON.stringify({ purpose: 'register' }),
  });
  const body = (await invite.json()) as { code: string };
  return body.code;
}

async function mintResetInviteCode(): Promise<string> {
  const login = await fetch(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: NAME, password: PASSWORD }),
  });
  assert.equal(login.status, 200);
  const account = (await login.json()) as { id: string };
  const reauth = await fetch(`${BASE_URL}/api/auth/reauth`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
    body: JSON.stringify({ password: 'e2e bootstrap password' }),
  });
  assert.equal(reauth.status, 204);
  const invite = await fetch(`${BASE_URL}/api/auth/invites`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
    body: JSON.stringify({ purpose: 'reset', playerId: account.id }),
  });
  assert.equal(invite.status, 201);
  const body = (await invite.json()) as { code: string };
  return body.code;
}

before(async () => {
  const server = await startE2EServer({
    ...process.env,
    DB_FILE: ':memory:',
    ADMIN_RECOVERY_CODE: RECOVERY_CODE,
    KIOSK_TOKEN: 'e2e-kiosk-token',
  });
  e2eServer = server;
  serverProcess = server.process;
  BASE_URL = server.baseUrl;
  browser = await chromium.launch();
  page = await browser.newPage({ viewport: { width: 390, height: 844 } });
});

after(async () => {
  await browser?.close();
  serverProcess?.kill();
});

test('an invite link registers a new account and logs it straight in', async () => {
  const code = await mintRegisterInviteCode();

  await page.goto(`${BASE_URL}/?invite=${code}`);
  await page.waitForSelector('#auth-screen:not([hidden])');

  await page.fill('#auth-name', NAME);
  await page.fill('#auth-password', PASSWORD);
  for (const viewport of [
    { width: 320, height: 568 }, { width: 390, height: 844 },
    { width: 512, height: 384 }, { width: 720, height: 450 },
    { width: 1024, height: 768 }, { width: 1440, height: 900 },
  ]) {
    await page.setViewportSize(viewport);
    const geometry = await page.locator('#auth-form').evaluate((form) => ({
      controls: Array.from(form.querySelectorAll('input:not([type="hidden"]), button'))
        .filter((control) => control.getBoundingClientRect().width > 0)
        .map((control) => ({ height: control.getBoundingClientRect().height, width: control.getBoundingClientRect().width,
          icon: control.classList.contains('icon-btn') })),
      overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
    }));
    assert.equal(geometry.overflow, false, `login overflow at ${viewport.width}`);
    assert.ok(geometry.controls.length >= 3);
    for (const control of geometry.controls) {
      assert.ok(control.height >= 31 && control.height <= 33, JSON.stringify({ viewport, control }));
      if (control.icon) assert.ok(control.width >= 44);
    }
  }
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.getAttribute('#auth-password', 'type'), 'password');
  await page.click('[data-password-toggle]');
  assert.equal(await page.getAttribute('#auth-password', 'type'), 'text');
  assert.equal(await page.getAttribute('[data-password-toggle]', 'aria-label'), 'Passwort verbergen');
  await page.click('[data-password-toggle]');
  await page.click('#auth-form button[type="submit"]');

  await waitForPlayerData(page);
  const search = new URL(page.url()).search;
  assert.equal(search, '', 'the consumed invite code should be dropped from the URL');

  await page.waitForSelector('#onboarding-root [role="dialog"]');

  // Regression coverage: the onboarding dialog keeps one stable bottom
  // position even while the spotlight moves between targets. The spotlight
  // shadow must remain below the dialog instead of dimming its copy and
  // controls.
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.waitForSelector('.onboarding-dialog');
  await page.waitForSelector('.onboarding-target-ring');
  const onboardingLayers = await page.evaluate(() => {
    const dialog = document.querySelector('.onboarding-dialog');
    const ring = document.querySelector('.onboarding-target-ring');
    if (!dialog || !ring) throw new Error('onboarding layers are missing');
    const dialogStyle = getComputedStyle(dialog);
    const ringStyle = getComputedStyle(ring);
    const laptopBottomAnchor = Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--space-6'));
    return {
      dialogBottom: Number.parseFloat(dialogStyle.bottom),
      dialogHeight: dialog.getBoundingClientRect().height,
      dialogZIndex: Number(dialogStyle.zIndex),
      ringZIndex: Number(ringStyle.zIndex),
      isTop: dialog.classList.contains('onboarding-dialog--top'),
      laptopBottomAnchor,
      viewportHeight: window.innerHeight,
    };
  });
  assert.ok(Math.abs(onboardingLayers.dialogBottom - onboardingLayers.laptopBottomAnchor) < 0.1);
  assert.equal(onboardingLayers.isTop, false);
  assert.ok(onboardingLayers.dialogHeight < onboardingLayers.viewportHeight / 2, 'the bottom dialog must stay compact');
  assert.ok(onboardingLayers.dialogZIndex > onboardingLayers.ringZIndex, 'the dialog must stay above the spotlight shadow');
  await page.setViewportSize({ width: 390, height: 844 });

  // The shared tour has eight steps and ends directly in the catalog. No
  // rating is required before the player can finish it.
  const totalCoreSteps = await page.locator('.onboarding-progress').evaluate((element) => {
    const match = element.textContent?.match(/von (\d+)/);
    if (!match) throw new Error('onboarding progress text is missing the step count');
    return Number(match[1]);
  });
  const mobileDialogBottom = await page.locator('.onboarding-dialog').evaluate((element) => (
    window.innerHeight - element.getBoundingClientRect().bottom
  ));
  assert.equal(totalCoreSteps, 8);
  const titles: string[] = [];
  for (let step = 0; step < totalCoreSteps; step += 1) {
    titles.push((await page.locator('#onboarding-title').textContent()) ?? '');
    if (step === totalCoreSteps - 1) {
      await page.waitForSelector('#view-container[data-view="gameCatalog"]');
      assert.equal(await page.locator('[data-onboarding-next]').textContent(), 'Abschließen');
      assert.equal(await page.locator('.game-table-row.onboarding-required').count(), 0);
      await page.click('[data-onboarding-next]');
      break;
    }
    const previousTitle = titles.at(-1);
    await page.click('[data-onboarding-next]');
    await page.waitForFunction(
      (title) => document.querySelector('#onboarding-title')?.textContent !== title,
      previousTitle,
    );
    const currentDialogBottom = await page.locator('.onboarding-dialog').evaluate((element) => (
      window.innerHeight - element.getBoundingClientRect().bottom
    ));
    assert.ok(
      Math.abs(currentDialogBottom - mobileDialogBottom) < 0.1,
      `the onboarding dialog must keep its bottom position after step ${step + 1}`,
    );
  }
  assert.deepEqual(titles, ['Home', 'Mein Profil', 'Orga', 'Aktives Event', 'Match', 'Vote', 'Essen', 'Spielekatalog']);
  await page.waitForSelector('#onboarding-root [role="dialog"]', { state: 'detached' });
  await page.waitForSelector('[data-tab="catalog"]');
  assert.equal(await page.locator('.game-table-row.onboarding-required').count(), 0);
});

test('admin onboarding uses the same shared tour without admin-only steps', async () => {
  const reset = await fetch(`${BASE_URL}/api/me/onboarding`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
    body: JSON.stringify({ status: 'pending', lastCoreStep: 0, ratingStatus: 'pending' }),
  });
  assert.equal(reset.status, 200, await reset.text());

  const adminPage = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  await trackE2EContext(adminPage.context(), 'auth-onboarding-admin');
  try {
    await adminPage.goto(BASE_URL);
    await adminPage.waitForSelector('#auth-screen:not([hidden])');
    await adminPage.fill('#auth-name', 'E2E Bootstrap Admin');
    await adminPage.fill('#auth-password', 'e2e bootstrap password');
    await adminPage.click('#auth-form button[type="submit"]');
    await adminPage.waitForSelector('#app:not([hidden])');
    await adminPage.waitForSelector('#onboarding-root [role="dialog"]');

    await adminPage.waitForFunction(() =>
      document.querySelector('.onboarding-progress')?.textContent?.includes('von 8') ?? false,
      undefined,
      { timeout: 10_000 },
    );
    const totalCoreSteps = await adminPage.locator('.onboarding-progress').evaluate((element) => {
      const match = element.textContent?.match(/von (\d+)/);
      if (!match) throw new Error('onboarding progress text is missing the step count');
      return Number(match[1]);
    });
    assert.equal(totalCoreSteps, 8);

    assert.equal(await adminPage.locator('html').getAttribute('data-layout-mode'), 'desktop');
    await adminPage.waitForSelector('.desktop-nav-btn[data-view="home"]:visible');
    await adminPage.waitForSelector('.onboarding-target-ring');
    await adminPage.waitForFunction(() => {
      const target = document.querySelector('.desktop-nav-btn[data-view="home"]')?.getBoundingClientRect();
      const ring = document.querySelector('.onboarding-target-ring')?.getBoundingClientRect();
      return Boolean(target && ring && target.width > 0 && target.height > 0)
        && Math.abs(target!.left - ring!.left) < 1
        && Math.abs(target!.top - ring!.top) < 1
        && Math.abs(target!.width - ring!.width) < 1
        && Math.abs(target!.height - ring!.height) < 1;
    }, undefined, { timeout: 5_000 });

    let sawHeaderEvent = false;
    for (let step = 0; step < totalCoreSteps; step += 1) {
      const title = await adminPage.locator('#onboarding-title').textContent();
      if (title === 'Aktives Event') {
        sawHeaderEvent = true;
        await adminPage.waitForSelector('#event-context:not([hidden]) .search-select-control');
        for (const width of [1920, 1024]) {
          await adminPage.setViewportSize({ width, height: 768 });
          await adminPage.waitForFunction(() => {
            const target = document.querySelector('#event-context .search-select-control')?.getBoundingClientRect();
            const ring = document.querySelector('.onboarding-target-ring')?.getBoundingClientRect();
            return Boolean(target && ring)
              && Math.abs(target!.left - ring!.left) < 1
              && Math.abs(target!.top - ring!.top) < 1
              && Math.abs(target!.width - ring!.width) < 1
              && Math.abs(target!.height - ring!.height) < 1;
          }, undefined, { timeout: 5_000 });
        }
        await adminPage.setViewportSize({ width: 1920, height: 1080 });
      }
      assert.notEqual(title, 'Admin');
      assert.notEqual(title, 'Event-Auswahl');
      await adminPage.click('[data-onboarding-next]');
      if (step + 1 < totalCoreSteps) {
        await adminPage.waitForFunction(
          (previousTitle) => document.querySelector('#onboarding-title')?.textContent !== previousTitle,
          title,
          { timeout: 5_000 },
        );
      }
    }
    assert.equal(sawHeaderEvent, true);
    await adminPage.waitForFunction(() => !document.querySelector('#onboarding-root [role="dialog"]'));
  } finally {
    await adminPage.close();
    const restored = await fetch(`${BASE_URL}/api/me/onboarding/test-complete`, {
      method: 'POST',
      headers: { Cookie: adminCookie },
    });
    assert.equal(restored.status, 200, await restored.text());
  }
});

test('logging out drops back to the login gate, and logging back in works', async () => {
  await page.click('.nav-btn[data-view="more"]');

  await page.click('[data-navigate="profile"]');
  await page.waitForSelector('#profile-logout');
  await page.click('#profile-logout');

  await page.waitForSelector('#auth-screen:not([hidden])');
  await page.waitForSelector('#auth-name');

  await page.fill('#auth-name', NAME);
  await page.fill('#auth-password', PASSWORD);
  await page.click('#auth-form button[type="submit"]');

  await waitForPlayerData(page);
});

test('a wrong password on the login gate shows an error and does not proceed', async () => {
  await page.click('.nav-btn[data-view="more"]');

  await page.click('[data-navigate="profile"]');
  await page.waitForSelector('#profile-logout');
  await page.click('#profile-logout');
  await page.waitForSelector('#auth-screen:not([hidden])');

  await page.fill('#auth-name', NAME);
  await page.fill('#auth-password', 'not the right password');
  await page.click('#auth-form button[type="submit"]');

  await page.waitForSelector('#auth-error:not([hidden])');
  const appHidden = await page.getAttribute('#app', 'hidden');
  assert.notEqual(appHidden, null);

  // Recover the session for any later test that might reuse this page.
  await page.fill('#auth-password', PASSWORD);
  await page.click('#auth-form button[type="submit"]');
  await page.waitForSelector('#app:not([hidden])');
});

test('a logged-in user can leave a stale action link without editing the URL', async () => {
  await page.goto(`${BASE_URL}/?invite=already-used-or-invalid`);
  await page.waitForSelector('#auth-continue-session');
  assert.match((await page.textContent('#auth-continue-session')) ?? '', new RegExp(NAME));
  await page.click('#auth-continue-session');
  await page.waitForSelector('#app:not([hidden])');
  assert.equal(new URL(page.url()).searchParams.has('invite'), false);
});

test('the required-mode kiosk starts with its dedicated read-only token', async () => {
  const kioskPage = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  await trackE2EContext(kioskPage.context(), 'auth-kiosk');
  try {
    await kioskPage.goto(`${BASE_URL}/kiosk.html?token=e2e-kiosk-token`);
    await kioskPage.waitForSelector('#kiosk-dashboard:not([hidden])');
    await kioskPage.waitForSelector('#kiosk-live');
    assert.equal(new URL(kioskPage.url()).searchParams.has('token'), false);
  } finally {
    await kioskPage.close();
  }
});

test('each Broadcast button opens its own event in a separate tab', async () => {
  const adminPage = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  await trackE2EContext(adminPage.context(), 'auth-broadcast-handoff');
  const openedPages: Page[] = [];
  try {
    await adminPage.goto(BASE_URL);
    await adminPage.fill('#auth-name', 'E2E Bootstrap Admin');
    await adminPage.fill('#auth-password', 'e2e bootstrap password');
    await adminPage.click('#auth-form button[type="submit"]');
    await waitForPlayerData(adminPage);
    const events = [];
    for (const name of ['Handoff E2E A', 'Handoff E2E B']) {
      const response = await adminPage.request.post(`${BASE_URL}/api/events`, {
        data: { name, startsAt: Date.now() + 7_200_000, endsAt: Date.now() + 10_800_000, eventType: 'lan' },
      });
      assert.equal(response.status(), 201, await response.text());
      events.push((await response.json()) as { id: string; name: string });
    }
    await adminPage.reload();
    await waitForPlayerData(adminPage);
    await openUtilityView(adminPage, 'admin');
    await adminPage.click('[data-navigate="kiosk"]');
    for (const event of events) {
      const row = adminPage.locator('.profile-row', { hasText: event.name });
      const [popup] = await Promise.all([adminPage.waitForEvent('popup'), row.locator('.kiosk-open-link').click()]);
      openedPages.push(popup);
      await popup.waitForFunction(() => Boolean(sessionStorage.getItem('respawn_kiosk_event')));
      await popup.waitForSelector('#kiosk-fullscreen');
      assert.equal(await popup.evaluate(() => sessionStorage.getItem('respawn_kiosk_event')), event.id);
      assert.equal(new URL(popup.url()).hash, '', 'the one-use handoff is removed from the address');
    }
    const tokens = await Promise.all(openedPages.map((popup) => popup.evaluate(() => sessionStorage.getItem('respawn_kiosk_token'))));
    assert.ok(tokens[0] && tokens[1] && tokens[0] !== tokens[1]);
  } finally {
    for (const popup of openedPages) await popup.close();
    await adminPage.close();
  }
});

test('a reset link replaces the password and signs the browser in with a fresh session', async () => {
  const code = await mintResetInviteCode();
  await page.goto(`${BASE_URL}/?reset=${code}`);
  await page.waitForSelector('#auth-screen:not([hidden])');
  await page.fill('#auth-password', PASSWORD_AFTER_RESET);
  await page.click('#auth-form button[type="submit"]');

  await page.waitForSelector('#app:not([hidden])');
  assert.equal(new URL(page.url()).search, '');

  const oldLogin = await fetch(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: NAME, password: PASSWORD }),
  });
  assert.equal(oldLogin.status, 401);
  const newLogin = await fetch(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: NAME, password: PASSWORD_AFTER_RESET }),
  });
  assert.equal(newLogin.status, 200);
});

test('admin creates, displays and revokes a registration link in the UI', async () => {
  const adminPage = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const eventIds: string[] = [];
  let controlPlayerId: string | undefined;
  await trackE2EContext(adminPage.context(), 'auth-invite-admin');
  try {
    await adminPage.goto(BASE_URL);
    await adminPage.waitForSelector('#auth-screen:not([hidden])');
    await adminPage.fill('#auth-name', 'E2E Bootstrap Admin');
    await adminPage.fill('#auth-password', 'e2e bootstrap password');
    await adminPage.click('#auth-form button[type="submit"]');
    await waitForPlayerData(adminPage);

    const startsAt = Date.now() + 24 * 60 * 60 * 1000;
    for (let index = 0; index < 4; index += 1) {
      const created = await adminPage.request.post(`${BASE_URL}/api/events`, {
        data: {
          name: `Dropdown LAN ${index + 1}`,
          startsAt: startsAt + index * 24 * 60 * 60 * 1000,
          endsAt: startsAt + (index + 1) * 24 * 60 * 60 * 1000,
        },
      });
      const createdText = await created.text();
      assert.equal(created.status(), 201, createdText);
      eventIds.push((JSON.parse(createdText) as { id: string }).id);
    }
    const controlName = 'Kontozugang mit langem Testnamen';
    const controlPlayer = await adminPage.request.post(`${BASE_URL}/api/players`, { data: { name: controlName, color: '#5b8cff' } });
    assert.equal(controlPlayer.status(), 201, await controlPlayer.text());
    controlPlayerId = ((await controlPlayer.json()) as { id: string }).id;
    await adminPage.reload();
    await adminPage.waitForSelector('#app:not([hidden])');

    await openMoreViewEntry(adminPage, '[data-navigate="admin"]');
    await adminPage.waitForSelector('[aria-label="Werkzeuge"]');
    assert.equal(await adminPage.locator('#admin-indicator').isHidden(), true);
    assert.equal(await adminPage.locator('#admin-test-players-title').count(), 0);
    assert.equal(await adminPage.locator('#group-btn').count(), 0);
    await openAdminCard(adminPage, 'accounts');
    assert.equal(await adminPage.locator('#admin-players-title').textContent(), 'Konten');
    assert.equal(
      await adminPage.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      true,
      'mobile onboarding must not introduce horizontal page scrolling',
    );
    // Each account is one row: name plus state, every change in its "Aktion"
    // menu. An owner may move an unclaimed member to either higher role.
    const accountRowSelector = `.profile-row:has([data-delete-player="${controlPlayerId}"])`;
    const accountRow = adminPage.locator(accountRowSelector);
    await accountRow.waitFor();
    assert.equal(await accountRow.locator('.player-name').textContent(), controlName);
    assert.equal(await accountRow.locator('.profile-row-meta').textContent(), 'Noch nicht übernommen');
    assert.deepEqual(await accountRow.locator('.action-menu-panel button').allTextContents(), [
      'Zum Admin machen', 'Zum Owner machen', 'Claim-Link erstellen', 'Deaktivieren', 'Löschen',
    ]);
    // The panel re-renders its whole container whenever an async load or a
    // realtime signal lands, so every measurement looks its target up and
    // measures it in one page task once the preceding resize has applied.
    for (const viewport of [
      { width: 320, height: 568 }, { width: 390, height: 844 },
      { width: 512, height: 384 }, { width: 720, height: 450 },
      { width: 1024, height: 768 }, { width: 1440, height: 900 },
    ]) {
      await adminPage.setViewportSize(viewport);
      const rowHandle = await adminPage.waitForFunction(({ selector, width }) => {
        const row = document.querySelector(selector);
        const trigger = row?.querySelector('.action-menu > summary');
        if (window.innerWidth !== width || !row?.checkVisibility() || !trigger) return null;
        const rowBox = row.getBoundingClientRect();
        const triggerBox = trigger.getBoundingClientRect();
        const view = document.getElementById('view-container')!;
        return { height: triggerBox.height, triggerOverflow: triggerBox.right - rowBox.right,
          viewOverflow: view.scrollWidth - view.clientWidth,
          overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth };
      }, { selector: accountRowSelector, width: viewport.width });
      const rowState = await rowHandle.jsonValue();
      assert.ok(rowState);
      assert.ok(rowState.height >= 31 && rowState.height <= 33, JSON.stringify({ viewport, rowState }));
      assert.ok(rowState.triggerOverflow <= 0.5, JSON.stringify({ viewport, rowState }));
      assert.equal(rowState.viewOverflow, 0, `admin view overflow at ${viewport.width}`);
      assert.equal(rowState.overflow, false, `admin overflow at ${viewport.width}`);
    }
    await adminPage.setViewportSize({ width: 390, height: 844 });
    await openAdminCard(adminPage, 'invites');
    await adminPage.click('#admin-register-link');

    await adminPage.waitForSelector('#admin-register-invite-form');
    assert.equal(await adminPage.locator('#admin-register-expires').inputValue(), String(7 * 24 * 60 * 60 * 1000));
    assert.equal(
      (await adminPage.locator('#admin-register-expires option').allTextContents()).some((label) => /unbegrenzt/i.test(label)),
      false,
    );
    // A plain select names the target event; its validity line follows the duration.
    assert.equal(await adminPage.locator('#admin-register-event option').first().textContent(), 'Kein Event');
    await adminPage.selectOption('#admin-register-expires', String(24 * 60 * 60 * 1000));
    assert.match((await adminPage.locator('#admin-register-validity').textContent()) ?? '', /^Bis .* Uhr · mehrfach nutzbar$/);
    await adminPage.selectOption('#admin-register-expires', String(7 * 24 * 60 * 60 * 1000));
    for (const viewport of [{ width: 557, height: 406 }, { width: 1024, height: 800 }]) {
      await adminPage.setViewportSize(viewport);
      await assertNoOverflow(adminPage.locator('.modal-backdrop .modal').last());
    }
    await adminPage.selectOption('#admin-register-event', eventIds[0]);
    await adminPage.click('#admin-register-invite-form button[type="submit"]');
    await adminPage.waitForSelector('#reauth-form');
    await adminPage.fill('#reauth-password', 'e2e bootstrap password');
    await adminPage.click('#reauth-form button[type="submit"]');
    await adminPage.waitForSelector('#admin-invite-link');
    const link = await adminPage.inputValue('#admin-invite-link');
    for (const viewport of [
      { width: 320, height: 568 }, { width: 390, height: 844 },
      { width: 512, height: 384 }, { width: 720, height: 450 },
      { width: 1024, height: 768 }, { width: 1440, height: 900 },
    ]) {
      await adminPage.setViewportSize(viewport);
      // Crossing the sheet/dialog breakpoint restarts its entrance animation.
      await adminPage.locator('#admin-invite-link').evaluate(async (field) => {
        await Promise.all(field.closest('.modal')!.getAnimations().map((animation) => animation.finished));
      });
      const fieldStyle = await adminPage.locator('#admin-invite-link').evaluate((field) => {
        const reference = document.createElement('span');
        reference.style.fontSize = 'var(--font-size-xs)';
        reference.style.position = 'absolute';
        field.parentElement!.append(reference);
        try {
          return { actual: getComputedStyle(field).fontSize, expected: getComputedStyle(reference).fontSize,
            height: field.getBoundingClientRect().height,
            overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth };
        } finally { reference.remove(); }
      });
      assert.equal(fieldStyle.actual, fieldStyle.expected, `invite URL retains its compact owner typography at ${viewport.width}px`);
      assert.ok(fieldStyle.height >= 31 && fieldStyle.height <= 33, JSON.stringify({ viewport, fieldStyle }));
      assert.equal(fieldStyle.overflow, false);
    }
    await adminPage.setViewportSize({ width: 1024, height: 800 });
    const inviteCode = new URL(link).searchParams.get('invite');
    assert.ok(inviteCode);
    assert.match((await adminPage.locator('.modal-backdrop p.muted').last().textContent()) ?? '', /noch .* gültig/);

    await adminPage.click('#admin-invite-qr-toggle');
    await adminPage.waitForSelector('#admin-invite-qr svg');
    await adminPage.click('.modal-backdrop [data-close]');

    await adminPage.setViewportSize({ width: 1024, height: 800 });
    assert.equal(
      await adminPage.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      true,
      'desktop onboarding must not introduce horizontal page scrolling',
    );

    const activeLinkSelector = `[data-show-login-link="${inviteCode}"]`;
    const activeLink = adminPage.locator(activeLinkSelector);
    await activeLink.waitFor();
    for (const viewport of [{ width: 320, height: 568 }, { width: 390, height: 844 }]) {
      await adminPage.setViewportSize(viewport);
      const geometryHandle = await adminPage.waitForFunction(({ selector, width }) => {
        const button = document.querySelector(selector);
        if (window.innerWidth !== width || !button?.checkVisibility()) return null;
        const row = button.closest('.profile-row')!.getBoundingClientRect();
        const view = document.getElementById('view-container')!;
        const range = document.createRange();
        range.selectNodeContents(button);
        const box = button.getBoundingClientRect();
        return { viewOverflow: view.scrollWidth - view.clientWidth,
          pageFits: document.documentElement.scrollWidth <= window.innerWidth,
          actions: button.parentElement!.querySelectorAll('button').length,
          height: box.height, rightOverflow: box.right - row.right,
          lines: range.getClientRects().length, clipped: button.scrollWidth > button.clientWidth };
      }, { selector: activeLinkSelector, width: viewport.width });
      const geometry = await geometryHandle.jsonValue();
      assert.ok(geometry);
      // One action per row; revoking lives in the link dialog.
      assert.equal(geometry.actions, 1);
      assert.ok(geometry.height >= 31 && geometry.height <= 33, JSON.stringify({ viewport, geometry }));
      assert.equal(geometry.lines, 1);
      assert.equal(geometry.clipped, false);
      assert.ok(geometry.rightOverflow <= 0.5, JSON.stringify({ viewport, geometry }));
      assert.equal(geometry.viewOverflow, 0, `invitation actions must not overflow the view at ${viewport.width}`);
      assert.equal(geometry.pageFits, true, `invitation actions must not overflow the page at ${viewport.width}`);
    }
    await activeLink.click();
    await adminPage.click('#admin-invite-revoke');
    await adminPage.click('[data-confirm]');
    await activeLink.waitFor({ state: 'detached' });
  } finally {
    if (controlPlayerId) await adminPage.request.delete(`${BASE_URL}/api/players/${controlPlayerId}`);
    for (const eventId of eventIds) {
      await adminPage.request.delete(`${BASE_URL}/api/events/${eventId}`);
    }
    await adminPage.close();
  }
});

test('switching from an admin to a new account clears the local admin mode', async () => {
  const invite = await fetch(`${BASE_URL}/api/auth/invites`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
    body: JSON.stringify({ purpose: 'register' }),
  });
  const inviteText = await invite.text();
  assert.equal(invite.status, 201, inviteText);
  const { code } = JSON.parse(inviteText) as { code: string };

  const switchPage = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await trackE2EContext(switchPage.context(), 'auth-account-switch');
  try {
    await switchPage.goto(BASE_URL);
    await switchPage.waitForSelector('#auth-screen:not([hidden])');
    await switchPage.fill('#auth-name', 'E2E Bootstrap Admin');
    await switchPage.fill('#auth-password', 'e2e bootstrap password');
    await switchPage.click('#auth-form button[type="submit"]');
    await switchPage.waitForSelector('#app:not([hidden])');
    await activateAdminMode(switchPage);

    await switchPage.goto(`${BASE_URL}/?invite=${code}`);
    await switchPage.waitForSelector('#auth-screen:not([hidden])');
    await switchPage.fill('#auth-name', 'E2E Switched Person');
    await switchPage.fill('#auth-password', 'e2e switched password');
    await switchPage.click('#auth-form button[type="submit"]');
    await waitForPlayerData(switchPage);

    assert.equal(await switchPage.locator('#admin-indicator').isHidden(), true);
    assert.equal(
      await switchPage.evaluate(() => localStorage.getItem('respawn_admin')),
      null,
    );
  } finally {
    await switchPage.close();
  }
});

test('admin roster retries role loading, serializes changes and follows group role signals', async () => {
  const groupsResponse = await fetch(`${BASE_URL}/api/groups`, { headers: { Cookie: adminCookie } });
  const [{ id: groupId }] = (await groupsResponse.json()) as Array<{ id: string }>;
  const playersResponse = await fetch(`${BASE_URL}/api/admin/players`, { headers: { Cookie: adminCookie } });
  const target = ((await playersResponse.json()) as Array<{ id: string; name: string }>).find(
    (player) => player.name === NAME,
  );
  assert.ok(target);

  const adminPage = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await trackE2EContext(adminPage.context(), 'auth-roster-admin');
  let failNextMembersRequest = true;
  let rolePatchRequests = 0;
  adminPage.on('request', (request) => {
    if (request.method() === 'PATCH' && request.url().includes(`/members/${target.id}`)) rolePatchRequests += 1;
  });
  await adminPage.route(`**/api/groups/${groupId}/members`, async (route) => {
    if (failNextMembersRequest) {
      failNextMembersRequest = false;
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: '{"error":"Temporärer Rollenfehler."}',
      });
      return;
    }
    await route.continue();
  });

  try {
    await adminPage.goto(BASE_URL);
    await adminPage.fill('#auth-name', 'E2E Bootstrap Admin');
    await adminPage.fill('#auth-password', 'e2e bootstrap password');
    await adminPage.click('#auth-form button[type="submit"]');
    await adminPage.waitForSelector('#app:not([hidden])');
    // Admin mode is switched in Mein Profil; the Testdaten card only exists
    // once the Admin page has re-rendered in that mode.
    await activateAdminMode(adminPage);
    await openUtilityView(adminPage, 'admin');
    await adminPage.waitForSelector('#admin-test-players-title');
    await openAdminCard(adminPage, 'accounts');

    await adminPage.waitForSelector('#admin-members-retry');
    // This real error row makes the two-word retry label wrap on phones.
    // Require actual text lines for growth; desktop must return to 32px.
    for (const viewport of [{ width: 320, height: 568 }, { width: 390, height: 844 }, { width: 1024, height: 768 }]) {
      await adminPage.setViewportSize(viewport);
      // Look up and measure in one page task once the resize has applied: the
      // panel's remaining roster loads re-render it, and a separate lookup
      // could otherwise hand a replaced, detached 0px button to the measurement.
      const retryHandle = await adminPage.waitForFunction((width) => {
        const element = document.querySelector('#admin-members-retry');
        if (window.innerWidth !== width || !element?.checkVisibility()) return null;
        const range = document.createRange();
        range.selectNodeContents(element);
        const textRects = Array.from(range.getClientRects());
        const box = element.getBoundingClientRect();
        return {
          height: box.height,
          lines: new Set(textRects.map((rect) => Math.round(rect.top))).size,
          fits: textRects.every((rect) => rect.left >= box.left && rect.right <= box.right && rect.top >= box.top && rect.bottom <= box.bottom),
        };
      }, viewport.width);
      const retry = await retryHandle.jsonValue();
      assert.ok(retry);
      assert.equal(retry.fits, true, JSON.stringify(retry));
      assert.ok(retry.lines > 1 ? retry.height > 33 : retry.height >= 31 && retry.height <= 33, JSON.stringify(retry));
      if (viewport.width === 1024) assert.equal(retry.lines, 1);
      await assertNoOverflow(adminPage.locator('#view-container'));
    }
    await adminPage.setViewportSize({ width: 390, height: 844 });
    await assertNoOverflow(adminPage.locator('#view-container'));
    // Accounts are grouped by role: owners, admins, then members.
    const roleGroups = { owner: 0, admin: 1, member: 2 } as const;
    const waitForRoleGroup = (role: keyof typeof roleGroups, width: number) =>
      adminPage.waitForFunction(
        ({ playerId, group, width }) => {
          const row = document.querySelector(`.profile-row:has([data-delete-player="${playerId}"])`);
          const section = row?.closest('.admin-account-group');
          const trigger = row?.querySelector('.action-menu > summary');
          return window.innerWidth === width && section?.getAttribute('aria-labelledby') === `admin-account-group-${group}`
            && !row?.querySelector('[data-set-role]:disabled') && trigger?.checkVisibility();
        },
        { playerId: target.id, group: roleGroups[role], width },
      );
    const accountRow = () => adminPage.locator(`.profile-row:has([data-delete-player="${target.id}"])`);
    await adminPage.waitForSelector(`[data-admin-section="accounts"] .profile-row:has-text("${NAME}")`);
    assert.match((await adminPage.locator('[data-admin-section="accounts"] > summary .badge').textContent()) ?? '', /^[1-9]\d*$/);
    await adminPage.click('#admin-members-retry');

    await waitForRoleGroup('member', 390);
    await assertControlHeights(accountRow().locator('.action-menu > summary'));
    await accountRow().locator('.action-menu > summary').click();
    await accountRow().locator('[data-set-role="admin"]').click();
    await adminPage.waitForSelector('#reauth-form');
    // While the change waits for reauthentication, a second role change for
    // the same account is ignored instead of adding another request.
    await adminPage.evaluate((playerId) => {
      document.querySelector<HTMLButtonElement>(`[data-set-role][data-player-id="${playerId}"]`)?.click();
    }, target.id);
    await adminPage.fill('#reauth-password', 'e2e bootstrap password');
    await adminPage.click('#reauth-form button[type="submit"]');
    // The UI change has only settled once the account has moved to its new
    // group and its menu is unlocked again, after the trailing roster reload.
    await waitForRoleGroup('admin', 390);
    assert.equal(
      rolePatchRequests,
      2,
      'only the expected initial 403 plus the post-reauth retry may run; the busy change must add no request',
    );

    const reauth = await fetch(`${BASE_URL}/api/auth/reauth`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({ password: 'e2e bootstrap password' }),
    });
    assert.equal(reauth.status, 204);
    const promoteOwner = await fetch(`${BASE_URL}/api/groups/${groupId}/members/${target.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({ role: 'owner' }),
    });
    assert.equal(promoteOwner.status, 200, JSON.stringify(await promoteOwner.clone().json()));
    await waitForRoleGroup('owner', 390);

    const restoreMember = await fetch(`${BASE_URL}/api/groups/${groupId}/members/${target.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({ role: 'member' }),
    });
    assert.equal(restoreMember.status, 200, JSON.stringify(await restoreMember.clone().json()));
    await waitForRoleGroup('member', 390);
    for (const viewport of [{ width: 320, height: 568 }, { width: 1024, height: 768 }]) {
      await adminPage.setViewportSize(viewport);
      await waitForRoleGroup('member', viewport.width);
      await assertControlHeights(accountRow().locator('.action-menu > summary'));
      await assertNoOverflow(adminPage.locator('#view-container'));
      await assertNoOverflow(accountRow());
    }
  } finally {
    await deferE2EContextClose(adminPage.context());
  }
});

test('admin mints a test-session link; a second browser opens it as the seeded test player and sees its test peer', async () => {
  // The Admin UI uses the group-scoped endpoint; seed two so the redeemed identity's
  // visibility of its *peer* (not just itself) can be checked.
  const groupsRes = await fetch(`${BASE_URL}/api/groups`, { headers: { Cookie: adminCookie } });
  const groupList = (await groupsRes.json()) as Array<{ id: string }>;
  const groupId = groupList[0].id;
  const seeded = await fetch(`${BASE_URL}/api/groups/${groupId}/test-users`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
    body: JSON.stringify({ count: 2 }),
  });
  assert.equal(seeded.status, 201, JSON.stringify(await seeded.clone().json()));
  const seededBody = (await seeded.json()) as { created: Array<{ id: string; name: string }> };
  const [testPlayer, peerTestPlayer] = seededBody.created;

  const adminPage = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await trackE2EContext(adminPage.context(), 'auth-test-session-admin');
  let testSessionLink = '';
  try {
    await adminPage.goto(BASE_URL);
    await adminPage.waitForSelector('#auth-screen:not([hidden])');
    await adminPage.fill('#auth-name', 'E2E Bootstrap Admin');
    await adminPage.fill('#auth-password', 'e2e bootstrap password');
    await adminPage.click('#auth-form button[type="submit"]');
    await waitForPlayerData(adminPage);

    // Test players are listed only in admin mode, which Mein Profil switches.
    await activateAdminMode(adminPage);
    await openUtilityView(adminPage, 'admin');
    await openAdminCard(adminPage, 'accounts');
    const testSessionRow = adminPage.locator(`.profile-row:has([data-test-session="${testPlayer.id}"])`);
    await testSessionRow.locator('.action-menu > summary').click();
    await testSessionRow.locator(`[data-test-session="${testPlayer.id}"]`).click();

    await adminPage.waitForSelector('#reauth-form');
    await adminPage.fill('#reauth-password', 'e2e bootstrap password');
    await adminPage.click('#reauth-form button[type="submit"]');
    await adminPage.waitForSelector('#admin-invite-link');
    testSessionLink = await adminPage.inputValue('#admin-invite-link');
    assert.equal(new URL(testSessionLink).searchParams.has('testSession'), true);
  } finally {
    await adminPage.close();
  }

  const testPage = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await trackE2EContext(testPage.context(), 'auth-test-session-player');
  try {
    await testPage.goto(testSessionLink);
    await testPage.waitForSelector('#auth-screen:not([hidden])');
    await testPage.click('#auth-form button[type="submit"]');
    await waitForPlayerData(testPage);
    assert.equal(new URL(testPage.url()).search, '', 'the consumed test-session code should be dropped from the URL');

    // The session behind this browser is the redeemed test player itself.
    const me = await (await testPage.request.get(`${BASE_URL}/api/me`)).json();
    assert.equal(me.id, testPlayer.id);
    assert.equal(me.isTest, true);
    assert.equal(me.isAdmin, false);

    await testPage.click('.nav-btn[data-view="more"]');


    await testPage.click('[data-navigate="profile"]');
    await testPage.waitForSelector('#profile-logout');
    await testPage.keyboard.press('Escape');

    // Despite having no real admin role, it must see its seeded peer (not
    // just itself) - otherwise it could never join a carpool/vote/arcade
    // lobby created by another test player (see testFilter.js isTestIdentity()).
    // Home's Live-Status is the roster since the separate "Spieler" area was
    // removed.
    await testPage.click('.nav-btn[data-view="home"]');
    await testPage.waitForSelector(`button[data-player]:has-text("${peerTestPlayer.name}")`);

    // But it does not gain real admin rights.
    await testPage.click('.nav-btn[data-view="more"]');
    assert.equal(await testPage.locator('[data-navigate="admin"]').count(), 0);
  } finally {
    await testPage.close();
  }

  // The single-use link is now dead for anyone else who might have it.
  const reused = await fetch(`${BASE_URL}/api/auth/test-session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code: new URL(testSessionLink).searchParams.get('testSession') }),
  });
  assert.equal(reused.status, 400);
});

test('single-group access context is no longer exposed as a separate topbar control', async () => {
  assert.equal(await page.locator('#group-btn').count(), 0);
});
