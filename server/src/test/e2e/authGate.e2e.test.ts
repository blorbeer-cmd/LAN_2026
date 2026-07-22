// Browser E2E test for real per-user login (see
// docs/KONZEPT-USER-MANAGEMENT.md): once AUTH_MODE=required, an invite link
// registers a brand-new account and logs it straight in, logging out drops
// back to the login gate, and logging back in with the same credentials
// works. Bootstraps one admin via ADMIN_RECOVERY_CODE (through plain fetch,
// not the browser — that flow has its own coverage in
// api.auth.recovery.test.ts) purely to be able to mint the invite code this
// test needs.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, ChildProcess } from 'child_process';
import path from 'path';
import { chromium, Browser, Page } from 'playwright';

const PORT = 3904; // 3901 = flows, 3902 = access, 3903 = arcade, 3910 = agent integration
const BASE_URL = `http://localhost:${PORT}`;
const RECOVERY_CODE = 'e2e-admin-recovery-code';
const NAME = 'E2E New Person';
const PASSWORD = 'e2e new person password';
const PASSWORD_AFTER_RESET = 'e2e password after reset';

let serverProcess: ChildProcess;
let browser: Browser;
let page: Page;
let adminCookie: string;

async function waitForServer(url: string, timeoutMs = 10_000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      // not up yet, keep polling
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error(`Server at ${url} did not become ready in time`);
}

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
  serverProcess = spawn('node', [path.join(__dirname, '..', '..', '..', 'dist', 'index.js')], {
    env: {
      ...process.env,
      PORT: String(PORT),
      DB_FILE: ':memory:',
      AUTH_MODE: 'required',
      ACCESS_TOKEN: 'obsolete-shared-token',
      ADMIN_RECOVERY_CODE: RECOVERY_CODE,
      KIOSK_TOKEN: 'e2e-kiosk-token',
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
});

test('logging out drops back to the login gate, and logging back in works', async () => {
  await page.click('#profile-btn');
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
  await page.click('#profile-btn');
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
    await adminPage.waitForSelector('#admin-register-link');
    assert.equal(
      await adminPage.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      true,
      'mobile onboarding must not introduce horizontal page scrolling'
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
      'desktop onboarding must not introduce horizontal page scrolling'
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

test('admin mints a test-session link; a second browser opens it as the seeded test player and sees its test peer', async () => {
  // Required mode retires POST /api/admin/test-users (see admin.ts) in favor
  // of the group-scoped endpoint; seed two so the redeemed identity's
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

    await testPage.click('#profile-btn');
    await testPage.waitForSelector('#profile-logout');
    await testPage.keyboard.press('Escape');

    // Despite having no real admin role, it must see its seeded peer (not
    // just itself) - otherwise it could never join a carpool/vote/arcade
    // lobby created by another test player (see testFilter.js isTestIdentity()).
    await testPage.click('.nav-btn[data-view="more"]');
    await testPage.click('[data-navigate="players"]');
    await testPage.waitForSelector(`text=${peerTestPlayer.name}`);

    // But it does not gain real admin rights.
    await testPage.click('.nav-btn[data-view="more"]');
    await testPage.click('[data-navigate="admin"]');
    await testPage.waitForSelector('text=Dieses Konto hat keine Admin-Rechte.');
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

test('group context button opens read-only group details for the one real group', async () => {
  // `page` is logged in as a plain member (E2E New Person), not the owner -
  // it sees the group's name/member list but neither the edit form nor the
  // admin-only test-user section.
  await page.click('#group-btn');
  await page.waitForSelector('.group-member-list');
  await page.locator('.group-member-row').first().waitFor();
  assert.ok((await page.locator('.group-member-row').count()) >= 2, 'the owner and this member both show up');
  assert.equal(await page.locator('#group-edit-form').count(), 0);
  assert.equal(await page.locator('#group-test-users-form').count(), 0);
  assert.equal(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    true,
    'the group context modal must not introduce horizontal scrolling',
  );
  await page.click('.modal-backdrop [data-close]');
});
