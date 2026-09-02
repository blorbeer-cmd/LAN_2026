import assert from 'node:assert/strict';
import type { BrowserContext, Page } from 'playwright';

export const E2E_ADMIN_NAME = 'E2E Bootstrap Admin';
export const E2E_ADMIN_PASSWORD = 'e2e-bootstrap-admin-password';
export const E2E_KIOSK_TOKEN = 'e2e-kiosk-token';

export function authenticatedServerEnv(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    DB_FILE: ':memory:',
    COOKIE_SECURE: '0',
    KIOSK_TOKEN: E2E_KIOSK_TOKEN,
    BOOTSTRAP_ADMIN_1_NAME: E2E_ADMIN_NAME,
    BOOTSTRAP_ADMIN_1_PASSWORD: E2E_ADMIN_PASSWORD,
  };
}

function sessionCookie(response: Response): string {
  const setCookie = response.headers.get('set-cookie');
  assert.ok(setCookie, 'authentication response must set a session cookie');
  return setCookie.split(';')[0];
}

export async function loginE2EAdmin(baseUrl: string): Promise<string> {
  const login = await fetch(`${baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: E2E_ADMIN_NAME, password: E2E_ADMIN_PASSWORD }),
  });
  assert.equal(login.status, 200, await login.text());
  const cookie = sessionCookie(login);
  const reauthenticated = await fetch(`${baseUrl}/api/auth/reauth`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ password: E2E_ADMIN_PASSWORD }),
  });
  assert.equal(reauthenticated.status, 204, await reauthenticated.text());
  return cookie;
}

export interface E2EAccount {
  id: string;
  name: string;
  cookie: string;
  password: string;
}

export async function finishE2EOnboarding(baseUrl: string, cookie: string): Promise<void> {
  const response = await fetch(`${baseUrl}/api/me/onboarding/test-complete`, {
    method: 'POST',
    headers: { cookie },
  });
  assert.equal(response.status, 200, await response.text());
}

export async function createE2EAccount(baseUrl: string, adminCookie: string, name: string): Promise<E2EAccount> {
  const created = await fetch(`${baseUrl}/api/players`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: adminCookie },
    body: JSON.stringify({ name }),
  });
  assert.equal(created.status, 201, await created.clone().text());
  const player = (await created.json()) as { id: string; name: string };
  const inviteResponse = await fetch(`${baseUrl}/api/auth/invites`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: adminCookie },
    body: JSON.stringify({ purpose: 'claim', playerId: player.id }),
  });
  assert.equal(inviteResponse.status, 201, await inviteResponse.clone().text());
  const invite = (await inviteResponse.json()) as { code: string };
  const password = `e2e-${player.id}-password`;
  const claimed = await fetch(`${baseUrl}/api/auth/claim`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code: invite.code, password }),
  });
  assert.equal(claimed.status, 200, await claimed.text());
  const cookie = sessionCookie(claimed);
  await finishE2EOnboarding(baseUrl, cookie);
  return { ...player, cookie, password };
}

export async function promoteE2EAdmin(baseUrl: string, adminCookie: string, playerId: string): Promise<void> {
  const promoted = await fetch(`${baseUrl}/api/groups/default-group/members/${playerId}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', cookie: adminCookie },
    body: JSON.stringify({ role: 'admin' }),
  });
  assert.equal(promoted.status, 200, await promoted.text());
}

export async function addSessionCookie(context: BrowserContext, baseUrl: string, cookie: string): Promise<void> {
  const separator = cookie.indexOf('=');
  assert.ok(separator > 0, 'session cookie must contain a name and value');
  await context.clearCookies({ name: cookie.slice(0, separator) });
  await context.addCookies([
    {
      name: cookie.slice(0, separator),
      value: cookie.slice(separator + 1),
      url: baseUrl,
    },
  ]);
}

// Swapping the session cookie on a *live* page races the server's own sliding
// session refresh: requireUser re-issues a Set-Cookie for whatever session the
// request carried (src/sessions.ts), and the app fires a burst of background
// requests on every view. A response belonging to the previous identity that
// lands after the write below restores that identity's cookie, and every later
// request acts as the old account. An explicit playerId in a request body does
// not save it either — bindBodyPlayerId overwrites it with the session's
// player, so the write silently lands on the wrong account instead of failing.
// Park the page on a blank document first: that ends every app request of the
// old identity, so no response can write a cookie after this one.
export async function switchSessionCookie(page: Page, baseUrl: string, cookie: string): Promise<void> {
  // `networkidle` is the load-bearing part: parking the page alone only stops
  // the app from *starting* new requests, while the ones already in flight are
  // cancelled asynchronously and can still deliver their Set-Cookie after the
  // write below. Waiting for the blank document to reach a quiet network means
  // every old-identity response has been processed before the cookie changes.
  // Return to the exact URL the page was on, hash route included: callers used
  // to reload in place, and landing on the app root instead would enter their
  // view through a different path and reset per-view state they rely on.
  const current = page.url();
  const destination = current.startsWith(baseUrl) ? current : baseUrl;
  await page.goto('about:blank', { waitUntil: 'networkidle' });
  await addSessionCookie(page.context(), baseUrl, cookie);
  await page.goto(destination);
}

// The shell unhides as soon as the auth gate resolves, but main() then loads
// the central snapshot in the background and only afterwards re-renders the
// current view and rebuilds the navigation. Everything that reads the roster —
// Profile, the admin tools, the desktop rail — is only trustworthy from that
// point on. app.js publishes the transition as #app[data-player-data]; waiting
// for it replaces the fixed settle delays this suite used to sprinkle after
// every login, which guessed at a duration instead of observing the state.
export async function waitForPlayerData(page: Page): Promise<void> {
  await page.waitForSelector('#app:not([hidden])');
  await page.waitForSelector('#app[data-player-data="ready"]');
}
