// Browser E2E test for real per-user login (see
// docs/KONZEPT-USER-MANAGEMENT.md): an invite link
// registers a brand-new account and logs it straight in, logging out drops
// back to the login gate, and logging back in with the same credentials
// works. Bootstraps one admin via ADMIN_RECOVERY_CODE (through plain fetch,
// not the browser — that flow has its own coverage in
// api.auth.recovery.test.ts) purely to be able to mint the invite code this
// test needs.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { ChildProcess } from 'child_process';
import { chromium, Browser, Page } from 'playwright';
import { startE2EServer } from './e2eServer';

let BASE_URL: string;
const RECOVERY_CODE = 'e2e-admin-recovery-code';
const NAME = 'E2E New Person';
const PASSWORD = 'e2e new person password';
const PASSWORD_AFTER_RESET = 'e2e password after reset';

let serverProcess: ChildProcess;
let browser: Browser;
let page: Page;
let adminCookie: string;

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
  assert.equal(await page.getAttribute('#auth-password', 'type'), 'password');
  await page.click('[data-password-toggle]');
  assert.equal(await page.getAttribute('#auth-password', 'type'), 'text');
  assert.equal(await page.getAttribute('[data-password-toggle]', 'aria-label'), 'Passwort verbergen');
  await page.click('[data-password-toggle]');
  await page.click('#auth-form button[type="submit"]');

  await page.waitForSelector('#app:not([hidden])');
  const search = new URL(page.url()).search;
  assert.equal(search, '', 'the consumed invite code should be dropped from the URL');
  // #app unhides as soon as the gate resolves, before main()'s subsequent
  // loadAll() populates state.players — navigating to Profile before that
  // finishes would find no matching player and show the "pick an identity"
  // fallback instead of the real profile (with its Logout button). A brief
  // settle avoids racing that unrelated, pre-existing boot-order timing.
  await page.waitForTimeout(500);

  await page.waitForSelector('#onboarding-root [role="dialog"]');

  // Regression coverage: highlighted bottom-navigation steps move the dialog
  // to the top. At laptop widths, the later media rule must not restore a
  // bottom anchor (which would stretch the panel), and the spotlight shadow
  // must remain below the dialog instead of dimming its copy and controls.
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.waitForSelector('.onboarding-dialog--top');
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
      laptopBottomAnchor,
      viewportHeight: window.innerHeight,
    };
  });
  assert.ok(
    onboardingLayers.dialogBottom > onboardingLayers.laptopBottomAnchor,
    'the top dialog must not retain the laptop bottom anchor',
  );
  assert.ok(onboardingLayers.dialogHeight < onboardingLayers.viewportHeight / 2, 'the top dialog must stay compact');
  assert.ok(onboardingLayers.dialogZIndex > onboardingLayers.ringZIndex, 'the dialog must stay above the spotlight shadow');
  await page.setViewportSize({ width: 390, height: 844 });

  // One click per STEPS entry in onboarding.js (3 total) reaches the
  // mandatory rating phase after the compact core tour.
  for (let step = 0; step < 3; step += 1) {
    await page.click('[data-onboarding-next]');
    await page.waitForSelector('#onboarding-root [role="dialog"]');
  }
  await page.waitForSelector('.game-table-row.onboarding-required input[type="range"]');
  assert.equal(
    await page.evaluate(() => document.activeElement?.matches('.game-table-row.onboarding-required input[type="range"]')),
    true,
    'rating mode should place initial focus on a required slider',
  );
  await page.click('[data-onboarding-later]');
  await page.waitForFunction(() => !document.querySelector('#onboarding-root [role="dialog"]'));
  await page.waitForSelector('[data-tab="catalog"]');
  await page.reload();
  await page.waitForSelector('#onboarding-root [role="dialog"]');
  await page.waitForSelector('[data-onboarding-finish][disabled]');
  const requiredRows = page.locator('.game-table-row.onboarding-required');
  assert.equal(await requiredRows.count(), 10);

  // Regression coverage: a rerender triggered by a required slider's own
  // debounced save must not steal focus (and the page scroll with it) back
  // to the very first required row - it only used to happen for a row other
  // than the first, so rate a later one via real keyboard input.
  const midSlider = requiredRows.nth(5).locator('input[type="range"]').first();
  await midSlider.focus();
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(350);
  assert.equal(
    await midSlider.evaluate((element) => element === document.activeElement),
    true,
    'saving a later required row must keep focus on that row instead of jumping back to the first one',
  );

  for (let rowIndex = 0; rowIndex < await requiredRows.count(); rowIndex += 1) {
    const sliders = requiredRows.nth(rowIndex).locator('input[type="range"]');
    for (let sliderIndex = 0; sliderIndex < await sliders.count(); sliderIndex += 1) {
      await sliders.nth(sliderIndex).evaluate((element) => {
        const slider = element as HTMLInputElement;
        slider.value = '5';
        slider.dispatchEvent(new Event('input', { bubbles: true }));
      });
      await page.waitForTimeout(350);
    }
  }
  await page.waitForSelector('[data-onboarding-finish]:not([disabled])');
  await page.click('[data-onboarding-finish]');
  await page.waitForSelector('#onboarding-root [role="dialog"]', { state: 'detached' });
  // Regression: the "Pflicht" badge/blue outline is a rating-mode-only
  // marker and must disappear once the round is done, not linger on the
  // catalog forever just because the server still remembers which ten
  // games were the required set.
  await page.waitForSelector('[data-tab="catalog"]');
  assert.equal(await page.locator('.game-table-row.onboarding-required').count(), 0);
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

  await page.waitForSelector('#app:not([hidden])');
  await page.waitForTimeout(500); // see the comment on the previous test
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
  try {
    await kioskPage.goto(`${BASE_URL}/kiosk.html?token=e2e-kiosk-token`);
    await kioskPage.waitForSelector('#kiosk-dashboard:not([hidden])');
    await kioskPage.waitForSelector('#kiosk-live');
    assert.equal(new URL(kioskPage.url()).searchParams.has('token'), false);
  } finally {
    await kioskPage.close();
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
  try {
    await adminPage.goto(BASE_URL);
    await adminPage.waitForSelector('#auth-screen:not([hidden])');
    await adminPage.fill('#auth-name', 'E2E Bootstrap Admin');
    await adminPage.fill('#auth-password', 'e2e bootstrap password');
    await adminPage.click('#auth-form button[type="submit"]');
    await adminPage.waitForSelector('#app:not([hidden])');
    await adminPage.waitForTimeout(500);

    await adminPage.click('.nav-btn[data-view="more"]');
    await adminPage.click('[data-navigate="admin"]');
    await adminPage.waitForSelector('#admin-mode-activate');
    assert.equal(await adminPage.locator('#admin-banner').isHidden(), true);
    await adminPage.waitForSelector('#admin-register-link');
    await adminPage.waitForSelector('#admin-tools-title');
    await adminPage.waitForSelector('.admin-role-select');
    assert.equal(await adminPage.locator('#admin-test-players-title').count(), 0);
    assert.equal(await adminPage.locator('#group-btn').count(), 0);
    assert.match((await adminPage.locator('#admin-players-title').textContent()) ?? '', /^Benutzer \(\d+\)$/);
    assert.deepEqual(await adminPage.locator('.admin-role-select').first().locator('option').allTextContents(), [
      'Mitglied',
      'Admin',
      'Owner',
    ]);
    assert.equal(
      await adminPage.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      true,
      'mobile onboarding must not introduce horizontal page scrolling',
    );
    await adminPage.click('#admin-register-link');

    await adminPage.waitForSelector('#reauth-form');
    await adminPage.fill('#reauth-password', 'e2e bootstrap password');
    await adminPage.click('#reauth-form button[type="submit"]');
    await adminPage.waitForSelector('#admin-invite-link');
    const link = await adminPage.inputValue('#admin-invite-link');
    assert.equal(new URL(link).searchParams.has('invite'), true);

    await adminPage.click('#admin-invite-qr-toggle');
    await adminPage.waitForSelector('#admin-invite-qr svg');
    await adminPage.click('.modal-backdrop [data-close]');

    await adminPage.setViewportSize({ width: 1024, height: 800 });
    assert.equal(
      await adminPage.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      true,
      'desktop onboarding must not introduce horizontal page scrolling',
    );

    const activeLink = adminPage.locator('[data-show-login-link]').first();
    await activeLink.waitFor();
    await adminPage.locator('[data-revoke-login-link]').first().click();
    await adminPage.click('[data-confirm]');
    await activeLink.waitFor({ state: 'detached' });
  } finally {
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
  try {
    await switchPage.goto(BASE_URL);
    await switchPage.waitForSelector('#auth-screen:not([hidden])');
    await switchPage.fill('#auth-name', 'E2E Bootstrap Admin');
    await switchPage.fill('#auth-password', 'e2e bootstrap password');
    await switchPage.click('#auth-form button[type="submit"]');
    await switchPage.waitForSelector('#app:not([hidden])');
    await switchPage.click('.nav-btn[data-view="more"]');
    await switchPage.click('[data-navigate="admin"]');
    await switchPage.click('#admin-mode-activate');
    await switchPage.waitForSelector('#admin-banner:not([hidden])');

    await switchPage.goto(`${BASE_URL}/?invite=${code}`);
    await switchPage.waitForSelector('#auth-screen:not([hidden])');
    await switchPage.fill('#auth-name', 'E2E Switched Person');
    await switchPage.fill('#auth-password', 'e2e switched password');
    await switchPage.click('#auth-form button[type="submit"]');
    await switchPage.waitForSelector('#app:not([hidden])');
    await switchPage.waitForTimeout(300);

    assert.equal(await switchPage.locator('#admin-banner').isHidden(), true);
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
    await adminPage.click('.nav-btn[data-view="more"]');
    await adminPage.click('[data-navigate="admin"]');
    if (await adminPage.locator('#admin-mode-activate').count()) {
      await adminPage.click('#admin-mode-activate');
      // Activating admin mode drops the cached roster and refetches it with the
      // test players included, but the panel only re-renders once that refresh
      // resolves. Until then the pre-activation DOM is still on screen, so the
      // roster waits below would settle on the stale markup and the assertion
      // could then read the empty in-between render. The Testdaten section only
      // exists in admin mode and is therefore the barrier for that re-render.
      await adminPage.waitForSelector('#admin-test-players-title');
    }

    await adminPage.waitForSelector('#admin-members-retry');
    await adminPage.waitForSelector(`.admin-player-row:has-text("${NAME}")`);
    await adminPage.waitForFunction(() => /^Benutzer \([1-9]\d*\)$/.test(document.querySelector('#admin-players-title')?.textContent ?? ''));
    assert.match((await adminPage.locator('#admin-players-title').textContent()) ?? '', /^Benutzer \([1-9]\d*\)$/);
    await adminPage.click('#admin-members-retry');

    let roleSelect = adminPage.locator(`[data-player-role="${target.id}"]`);
    await roleSelect.waitFor();
    await roleSelect.selectOption('admin');
    assert.equal(await roleSelect.isDisabled(), true, 'the role control locks before reauthentication and mutation');
    await roleSelect.evaluate((select) => {
      (select as HTMLSelectElement).value = 'member';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await adminPage.fill('#reauth-password', 'e2e bootstrap password');
    await adminPage.click('#reauth-form button[type="submit"]');
    await adminPage.waitForFunction(
      (playerId) =>
        (document.querySelector(`[data-player-role="${playerId}"]`) as HTMLSelectElement | null)?.value === 'admin',
      target.id,
    );
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
    await adminPage.waitForFunction(
      (playerId) =>
        (document.querySelector(`[data-player-role="${playerId}"]`) as HTMLSelectElement | null)?.value === 'owner',
      target.id,
    );

    const restoreMember = await fetch(`${BASE_URL}/api/groups/${groupId}/members/${target.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Cookie: adminCookie },
      body: JSON.stringify({ role: 'member' }),
    });
    assert.equal(restoreMember.status, 200, JSON.stringify(await restoreMember.clone().json()));
  } finally {
    await adminPage.close();
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
  let testSessionLink = '';
  try {
    await adminPage.goto(BASE_URL);
    await adminPage.waitForSelector('#auth-screen:not([hidden])');
    await adminPage.fill('#auth-name', 'E2E Bootstrap Admin');
    await adminPage.fill('#auth-password', 'e2e bootstrap password');
    await adminPage.click('#auth-form button[type="submit"]');
    await adminPage.waitForSelector('#app:not([hidden])');
    await adminPage.waitForTimeout(500);

    await adminPage.click('.nav-btn[data-view="more"]');
    await adminPage.click('[data-navigate="admin"]');
    if (await adminPage.locator('#admin-mode-activate').count()) await adminPage.click('#admin-mode-activate');
    const testSessionButton = adminPage.locator(`[data-test-session="${testPlayer.id}"]`);
    await testSessionButton.waitFor();
    await testSessionButton.click();

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
  try {
    await testPage.goto(testSessionLink);
    await testPage.waitForSelector('#auth-screen:not([hidden])');
    await testPage.click('#auth-form button[type="submit"]');
    await testPage.waitForSelector('#app:not([hidden])');
    assert.equal(new URL(testPage.url()).search, '', 'the consumed test-session code should be dropped from the URL');
    await testPage.waitForTimeout(500);

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
