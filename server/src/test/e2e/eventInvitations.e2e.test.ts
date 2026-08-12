import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { ChildProcess } from 'child_process';
import { chromium, Browser, Page } from 'playwright';
import { finishE2EOnboarding } from './authHelpers';
import { startE2EServer } from './e2eServer';

let BASE_URL: string;
const RECOVERY_CODE = 'event-invitations-e2e-recovery';
const OWNER_NAME = 'E2E Event Owner';
const OWNER_PASSWORD = 'e2e event owner secure passphrase';
const MEMBER_NAME = 'E2E Event Member';
const MEMBER_PASSWORD = 'e2e event member secure passphrase';
const EVENT_NAME = 'E2E Einladung LAN';

let serverProcess: ChildProcess;
let browser: Browser;
let ownerPage: Page;
let memberPage: Page;
let eventId: string;
let memberId: string;
const memberEventNotFoundResponses: string[] = [];

function sessionCookie(response: Response): string {
  const value = response.headers.get('set-cookie');
  assert.ok(value, 'authentication response should set a session cookie');
  return value.split(';')[0];
}

async function login(page: Page, name: string, password: string): Promise<void> {
  await page.goto(BASE_URL);
  await page.waitForSelector('#auth-screen:not([hidden])');
  await page.fill('#auth-name', name);
  await page.fill('#auth-password', password);
  await page.click('#auth-form button[type="submit"]');
  await page.waitForSelector('#app:not([hidden])');
  await page.waitForTimeout(300);
}

before(async () => {
  const server = await startE2EServer({
    ...process.env,
    DB_FILE: ':memory:',
    ADMIN_RECOVERY_CODE: RECOVERY_CODE,
  });
  serverProcess = server.process;
  BASE_URL = server.baseUrl;

  const ownerRegistration = await fetch(`${BASE_URL}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code: RECOVERY_CODE, name: OWNER_NAME, password: OWNER_PASSWORD }),
  });
  assert.equal(ownerRegistration.status, 201);
  const ownerCookie = sessionCookie(ownerRegistration);
  await finishE2EOnboarding(BASE_URL, ownerCookie);
  assert.equal(
    (
      await fetch(`${BASE_URL}/api/auth/reauth`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: ownerCookie },
        body: JSON.stringify({ password: OWNER_PASSWORD }),
      })
    ).status,
    204,
  );
  const registerInvite = await fetch(`${BASE_URL}/api/auth/invites`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: ownerCookie },
    body: JSON.stringify({ purpose: 'register' }),
  });
  assert.equal(registerInvite.status, 201);
  const registerCode = ((await registerInvite.json()) as { code: string }).code;
  const memberRegistration = await fetch(`${BASE_URL}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code: registerCode, name: MEMBER_NAME, password: MEMBER_PASSWORD }),
  });
  assert.equal(memberRegistration.status, 201);
  memberId = ((await memberRegistration.json()) as { id: string }).id;
  const memberCookie = sessionCookie(memberRegistration);
  await finishE2EOnboarding(BASE_URL, memberCookie);

  const now = Date.now();
  const event = await fetch(`${BASE_URL}/api/events`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: ownerCookie },
    body: JSON.stringify({
      name: EVENT_NAME,
      startsAt: now,
      endsAt: now + 60_000,
      visibilityScope: 'participants',
    }),
  });
  assert.equal(event.status, 201);
  eventId = ((await event.json()) as { id: string }).id;
  const tracking = await fetch(`${BASE_URL}/api/events/${eventId}/tracking/start`, {
    method: 'POST',
    headers: { Cookie: ownerCookie },
  });
  assert.equal(tracking.status, 200, await tracking.text());

  browser = await chromium.launch();
  ownerPage = await browser.newPage({ viewport: { width: 1024, height: 800 } });
  memberPage = await browser.newPage({ viewport: { width: 390, height: 844 } });
  memberPage.on('response', async (response) => {
    if (response.status() !== 404 || !response.url().startsWith(`${BASE_URL}/api/`)) return;
    if ((await response.text()).includes('Event nicht gefunden.')) {
      memberEventNotFoundResponses.push(response.url());
    }
  });
  await login(ownerPage, OWNER_NAME, OWNER_PASSWORD);
  await login(memberPage, MEMBER_NAME, MEMBER_PASSWORD);
});

after(async () => {
  await browser?.close();
  serverProcess?.kill();
});

test('manager invites a member who accepts and both open clients update', async () => {
  for (const view of ['votes', 'broadcast', 'foodOrders', 'checklist', 'checklistPacking', 'arrivals', 'seating', 'myStats', 'analytics', 'hallOfFame']) {
    await memberPage.evaluate((target) => {
      window.dispatchEvent(new CustomEvent('respawn:navigate', { detail: target }));
    }, view);
    await memberPage.waitForSelector(`#view-container[data-view="${view}"]`);
  }
  // Info is a topbar dialog rather than a view, but loads the same event-scoped
  // data and therefore belongs in this check.
  await memberPage.click('#info-btn');
  await memberPage.waitForSelector('#info-new-btn');
  await memberPage.click('.info-board-modal [data-close]');
  await memberPage.waitForTimeout(300);
  assert.deepEqual(memberEventNotFoundResponses, []);
  assert.equal(await memberPage.locator('.toast-error', { hasText: 'Event nicht gefunden.' }).count(), 0);

  await ownerPage.click('#settings-btn');
  await memberPage.click('#settings-btn');
  await ownerPage.waitForSelector(`[data-participants-event="${eventId}"]`);
  await memberPage.waitForSelector(`[data-participants-event="${eventId}"]`);
  assert.equal(await memberPage.locator(`[data-pending-invitation="${eventId}"]`).count(), 0);

  await ownerPage.click(`[data-participants-event="${eventId}"]`);
  const inviteButton = ownerPage.locator(`[data-invite-participant="${memberId}"]`);
  await inviteButton.waitFor();
  const memberRefresh = memberPage.waitForResponse(
    (response) => response.request().method() === 'GET' && response.url() === `${BASE_URL}/api/events`,
  );
  await inviteButton.click();
  await memberRefresh;
  assert.equal(await ownerPage.locator('.modal-backdrop').count(), 1, 'participant dialog stays open after inviting');

  const pending = memberPage.locator(`[data-pending-invitation="${eventId}"]`);
  await pending.waitFor();
  assert.match((await pending.textContent()) ?? '', new RegExp(EVENT_NAME));
  assert.match((await pending.textContent()) ?? '', /Eingeladen/);
  assert.equal(
    await memberPage.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    true,
    'the invitation actions must remain usable without horizontal scrolling on a phone',
  );

  const ownerRefresh = ownerPage.waitForResponse(
    (response) => response.request().method() === 'GET' && response.url() === `${BASE_URL}/api/events`,
  );
  const acceptButton = memberPage.locator(`[data-accept-invitation="${eventId}"]`);
  await acceptButton.focus();
  await acceptButton.press('Enter');
  await pending.waitFor({ state: 'detached' });
  await ownerRefresh;

  await ownerPage.locator('.modal-backdrop [data-close]').click();
  await ownerPage.click(`[data-participants-event="${eventId}"]`);
  const memberRow = ownerPage.locator('.modal-backdrop .card', { hasText: MEMBER_NAME });
  await memberRow.waitFor();
  assert.match((await memberRow.textContent()) ?? '', /Zugesagt/);
});
