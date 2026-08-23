import { before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { ChildProcess } from 'child_process';
import { chromium, Browser, Page } from 'playwright';
import { finishE2EOnboarding } from './authHelpers';
import { createE2EDiagnosticTest } from './e2eDiagnostics';
import { startE2EServer, type E2EServer } from './e2eServer';

let BASE_URL: string;
const RECOVERY_CODE = 'event-polls-e2e-recovery';
const OWNER_NAME = 'E2E Poll Owner';
const OWNER_PASSWORD = 'e2e poll owner secure passphrase';
const MEMBER_NAME = 'E2E Poll Member';
const MEMBER_PASSWORD = 'e2e poll member secure passphrase';
const EVENT_NAME = 'LAN Planung E2E';

let serverProcess: ChildProcess;
let e2eServer: E2EServer;
let browser: Browser;
let ownerPage: Page;
let memberPage: Page;

const test = createE2EDiagnosticTest(() => ({ browser, server: e2eServer }));

function sessionCookie(response: Response): string {
  const value = response.headers.get('set-cookie');
  assert.ok(value);
  return value.split(';')[0];
}

async function registerMember(ownerCookie: string): Promise<void> {
  const invite = await fetch(`${BASE_URL}/api/auth/invites`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: ownerCookie },
    body: JSON.stringify({ purpose: 'register' }),
  });
  assert.equal(invite.status, 201);
  const code = ((await invite.json()) as { code: string }).code;
  const registration = await fetch(`${BASE_URL}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code, name: MEMBER_NAME, password: MEMBER_PASSWORD }),
  });
  assert.equal(registration.status, 201);
  await finishE2EOnboarding(BASE_URL, sessionCookie(registration));
}

async function login(page: Page, name: string, password: string): Promise<void> {
  await page.goto(BASE_URL);
  await page.waitForSelector('#auth-screen:not([hidden])');
  await page.fill('#auth-name', name);
  await page.fill('#auth-password', password);
  await page.click('#auth-form button[type="submit"]');
  await page.waitForSelector('#app:not([hidden])');
}

async function navigate(page: Page, view: string): Promise<void> {
  await page.evaluate((target) => window.dispatchEvent(new CustomEvent('respawn:navigate', { detail: target })), view);
}

function isoDate(daysFromNow: number): string {
  return new Date(Date.now() + daysFromNow * 86_400_000).toISOString().slice(0, 10);
}

async function createPoll(
  page: Page,
  { topic, title, options, mode = 'feasibility' }: { topic: string; title: string; options: string[]; mode?: string },
): Promise<void> {
  await page.click('#new-event-poll');
  await page.waitForSelector('#event-poll-form');
  await page.selectOption('#poll-topic', topic);
  await page.fill('#poll-title', title);
  await page.selectOption('#poll-mode', mode);
  await page.fill('#poll-options', options.join('\n'));
  await page.fill('#poll-due', isoDate(5));
  await page.click('#event-poll-form button[type="submit"]');
  await page.waitForSelector('#event-poll-form', { state: 'detached' });
}

before(async () => {
  e2eServer = await startE2EServer({
    ...process.env,
    DB_FILE: ':memory:',
    ADMIN_RECOVERY_CODE: RECOVERY_CODE,
  });
  serverProcess = e2eServer.process;
  BASE_URL = e2eServer.baseUrl;

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
  await registerMember(ownerCookie);

  browser = await chromium.launch();
  ownerPage = await browser.newPage({ viewport: { width: 1024, height: 800 } });
  memberPage = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  await login(ownerPage, OWNER_NAME, OWNER_PASSWORD);
  await login(memberPage, MEMBER_NAME, MEMBER_PASSWORD);
});

after(async () => {
  await browser?.close();
  serverProcess?.kill();
});

test('the Orga poll tab plans an undated event, supports interest/decline, and preserves acceptance after a location decision', async () => {
  await navigate(ownerPage, 'events');
  await ownerPage.waitForSelector('#orga-events-title');

  // One event creation flow: an unset schedule creates a normal event in the
  // planning state, without a separate "Planungs-Event" action.
  assert.equal(await ownerPage.locator('#new-planning-event-btn').count(), 0);
  await ownerPage.click('#new-event-btn');
  await ownerPage.waitForSelector('#event-form');
  await ownerPage.fill('#event-name', EVENT_NAME);
  await ownerPage.uncheck('#event-has-schedule');
  await ownerPage.fill('#event-location', 'Noch offen');
  await ownerPage.click('#event-form button[type="submit"]');
  const eventCard = ownerPage.locator('.event-card', { hasText: EVENT_NAME });
  await eventCard.waitFor();
  assert.doesNotMatch((await eventCard.textContent()) ?? '', /Invalid Date/);
  const eventId = (await eventCard.getAttribute('data-event-card')) as string;

  // Event cards contain only the compact entry; the complete controls live
  // in the new first Orga tab.
  assert.equal(await eventCard.locator('[data-poll-id]').count(), 0);
  await eventCard.locator('[data-open-event-polls]').click();
  await ownerPage.waitForSelector('[data-section-tab="eventPolls"][aria-current="page"]');
  assert.equal(await ownerPage.locator('#poll-event-select').inputValue(), eventId);

  await createPoll(ownerPage, {
    topic: 'date_range',
    title: 'Welcher Zeitraum passt?',
    options: [`${isoDate(10)} bis ${isoDate(12)}`, `${isoDate(17)} bis ${isoDate(19)}`],
  });
  const datePoll = ownerPage.locator('[data-poll-card]', { hasText: 'Welcher Zeitraum passt?' });
  await datePoll.waitFor();

  // The invited member reaches the same tab on a touch-sized viewport and can
  // first express non-binding interest.
  await navigate(memberPage, 'eventPolls');
  const memberDatePoll = memberPage.locator('[data-poll-card]', { hasText: 'Welcher Zeitraum passt?' });
  await memberDatePoll.waitFor();
  await memberPage.locator('[data-participation="interested"]').tap();
  await memberPage.locator('.toast', { hasText: 'Teilnahmestatus aktualisiert' }).last().waitFor();

  const memberOptions = memberDatePoll.locator('[data-poll-option-card]');
  await memberOptions.nth(0).locator('[data-poll-response="can"]').tap();
  await memberOptions.nth(1).locator('[data-poll-response="cannot"]').tap();
  await memberDatePoll.locator('[data-save-poll]').tap();
  await memberPage.locator('.toast', { hasText: 'Antwort gespeichert' }).waitFor();

  // Accept before the date is decided; selecting the date invalidates that
  // revision and the same reversible participation control reconfirms it.
  await memberPage.locator('[data-participation="accepted"]').tap();
  await ownerPage.reload();
  await ownerPage.waitForSelector('#app:not([hidden])');
  await navigate(ownerPage, 'eventPolls');
  const refreshedDatePoll = ownerPage.locator('[data-poll-card]', { hasText: 'Welcher Zeitraum passt?' });
  await refreshedDatePoll.waitFor();
  await refreshedDatePoll.locator('[data-decision-option]').first().check();
  await refreshedDatePoll.locator('[data-decide-poll]').click();
  await ownerPage.locator('.modal-backdrop [data-confirm]').click();
  await ownerPage.locator('.toast', { hasText: 'Ergebnis festgelegt' }).waitFor();
  await memberPage.locator('[data-participation="accepted"]').tap();

  // A second, parallel planning stream changes the location. The member can
  // later decline and re-accept; the location decision itself leaves the
  // current schedule acceptance valid.
  await createPoll(ownerPage, {
    topic: 'location',
    title: 'Wo findet die LAN statt?',
    mode: 'single_choice',
    options: ['Vereinsheim', 'Ferienhaus'],
  });
  const locationPoll = ownerPage.locator('[data-poll-card]', { hasText: 'Wo findet die LAN statt?' });
  await locationPoll.locator('[data-decision-option]').first().check();
  await locationPoll.locator('[data-decide-poll]').click();
  await ownerPage.locator('.modal-backdrop [data-confirm]').click();
  await ownerPage.locator('.toast', { hasText: 'Ergebnis festgelegt' }).waitFor();

  await memberPage.locator('[data-participation="declined"]').tap();
  await memberPage.locator('.toast', { hasText: 'Teilnahmestatus aktualisiert' }).last().waitFor();
  await memberPage.locator('[data-participation="accepted"]').tap();
  await memberPage.locator('.toast', { hasText: 'Teilnahmestatus aktualisiert' }).last().waitFor();
  assert.equal(
    await memberPage.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    true,
    'the poll tab stays within the phone viewport',
  );
});
