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
const EVENT_NAME = 'LAN Abstimmungen E2E';

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

async function currentPlayerId(page: Page): Promise<string> {
  return page.evaluate(async () => ((await (await fetch('/api/me')).json()) as { id: string }).id);
}

async function invitePlayer(page: Page, eventId: string, playerId: string): Promise<void> {
  const status = await page.evaluate(
    async ({ selectedEventId, selectedPlayerId }) =>
      (await fetch(`/api/events/${selectedEventId}/invitations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ playerId: selectedPlayerId }),
      })).status,
    { selectedEventId: eventId, selectedPlayerId: playerId },
  );
  assert.equal(status, 201);
}

async function acceptEvent(page: Page, eventId: string): Promise<void> {
  const status = await page.evaluate(
    async (selectedEventId) => (await fetch(`/api/events/${selectedEventId}/invitation/accept`, { method: 'POST' })).status,
    eventId,
  );
  assert.equal(status, 200);
}

async function selectActiveEvent(page: Page, eventId: string): Promise<void> {
  await page.reload();
  await page.waitForSelector('#app:not([hidden])');
  await page.click('#event-context .search-select-toggle');
  await page.click(`#event-context-switcher-list [data-search-select-value="${eventId}"]`);
  await page.waitForFunction(
    (selectedEventId) => (document.getElementById('event-context-switcher') as HTMLInputElement | null)?.value === selectedEventId,
    eventId,
  );
}

async function createPoll(
  page: Page,
  { title, options, mode = 'feasibility', maxSelections, anonymous = false }: {
    title: string;
    options: Array<string | { label: string; description?: string; url?: string }>;
    mode?: 'feasibility' | 'single_choice' | 'multiple_choice' | 'rating_1_5';
    maxSelections?: number;
    anonymous?: boolean;
  },
): Promise<void> {
  await page.click('#new-event-poll');
  await page.waitForSelector('#event-poll-form');
  await page.fill('#poll-title', title);
  await page.selectOption('#poll-mode', mode);
  if (anonymous) await page.check('#poll-anonymous');
  if (maxSelections !== undefined) await page.fill('#poll-max', String(maxSelections));
  while ((await page.locator('[data-poll-option-input]').count()) < options.length) await page.click('#poll-add-option');
  for (let index = 0; index < options.length; index += 1) {
    const rawOption = options[index];
    const option = typeof rawOption === 'string' ? { label: rawOption } : rawOption;
    await page.locator('[data-poll-option-input]').nth(index).fill(option.label);
    if (option.description || option.url) {
      await page.locator('[data-poll-option-row]').nth(index).locator('.event-poll-form-option-details').evaluate((details) => {
        (details as HTMLDetailsElement).open = true;
      });
      if (option.description) await page.locator('[data-poll-option-note]').nth(index).fill(option.description);
      if (option.url) await page.locator('[data-poll-option-url]').nth(index).fill(option.url);
    }
  }
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
    (await fetch(`${BASE_URL}/api/auth/reauth`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: ownerCookie },
      body: JSON.stringify({ password: OWNER_PASSWORD }),
    })).status,
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

test('confirmed participants use clear poll modes, finish a round and keep results separate from the event', async () => {
  await navigate(ownerPage, 'events');
  await ownerPage.waitForSelector('#orga-events-title');
  await ownerPage.click('#new-event-btn');
  await ownerPage.waitForSelector('#event-form');
  await ownerPage.fill('#event-name', EVENT_NAME);
  await ownerPage.fill('#event-location', 'Bestehender Ort');
  await ownerPage.click('#event-form button[type="submit"]');
  const eventCard = ownerPage.locator('.event-card', { hasText: EVENT_NAME });
  await eventCard.waitFor();
  const eventId = (await eventCard.getAttribute('data-event-card')) as string;

  const ownerId = await currentPlayerId(ownerPage);
  const memberId = await currentPlayerId(memberPage);
  await invitePlayer(ownerPage, eventId, ownerId);
  await invitePlayer(ownerPage, eventId, memberId);
  await acceptEvent(ownerPage, eventId);
  await navigate(memberPage, 'profile');
  const invitation = memberPage.locator('[data-pending-invitation]', { hasText: EVENT_NAME });
  await invitation.waitFor();
  assert.equal(await invitation.locator('[data-interest-invitation]').count(), 0);
  await invitation.locator('[data-accept-invitation]').tap();
  await memberPage.locator('.toast', { hasText: 'Einladung angenommen' }).waitFor();

  await selectActiveEvent(ownerPage, eventId);
  await selectActiveEvent(memberPage, eventId);
  assert.equal(await eventCard.locator('[data-poll-round]').count(), 0, 'event cards do not embed polls');
  await navigate(ownerPage, 'eventPolls');
  await ownerPage.waitForSelector('[data-section-tab="eventPolls"][aria-current="page"]');
  assert.equal(await ownerPage.locator('#poll-event-select').count(), 0);
  assert.equal(await ownerPage.locator('.event-polls-page h1').count(), 0, 'the tab adds no duplicate event heading');
  assert.equal(await ownerPage.locator('#new-event-poll').textContent(), 'Abstimmung starten');

  await createPoll(ownerPage, {
    title: 'Welcher Zeitraum passt?',
    options: ['Erstes Wochenende', 'Zweites Wochenende'],
  });
  const ownerPoll = ownerPage.locator('[data-poll-group]', { hasText: 'Welcher Zeitraum passt?' });
  await ownerPoll.waitFor();
  await ownerPoll.locator('[data-toggle-poll]').click();
  assert.equal(await ownerPoll.locator('[data-poll-round]:visible').count(), 0, 'the poll can be collapsed');
  assert.equal(await ownerPoll.locator('[data-remind-poll]:visible').count(), 1, 'management actions stay in the collapsed header');
  assert.equal(await ownerPoll.locator('[data-close-poll]:visible').count(), 1);
  assert.equal(await ownerPoll.locator('[data-cancel-poll]:visible').count(), 1);
  await ownerPoll.locator('[data-toggle-poll]').click();
  assert.equal(await ownerPoll.locator('[data-poll-response="can"]').count(), 2);
  assert.equal(await ownerPoll.locator('[data-poll-response="if_needed"]').count(), 2);
  assert.equal(await ownerPoll.locator('[data-poll-response="cannot"]').count(), 2);
  assert.equal(await ownerPoll.locator('[data-poll-response="open"]').count(), 2);

  await navigate(memberPage, 'eventPolls');
  const memberPoll = memberPage.locator('[data-poll-group]', { hasText: 'Welcher Zeitraum passt?' });
  await memberPoll.waitFor();
  const memberOptions = memberPoll.locator('.event-poll-option');
  await memberOptions.nth(0).locator('[data-poll-response="can"]').tap();
  await memberOptions.nth(1).locator('[data-poll-response="cannot"]').tap();
  await memberPoll.locator('[data-save-poll]').tap();
  await memberPage.locator('.toast', { hasText: 'Antwort gespeichert' }).waitFor();
  assert.equal(await memberPage.locator('[data-participation]').count(), 0, 'attendance is not managed in the poll tab');

  await ownerPage.reload();
  await ownerPage.waitForSelector('#app:not([hidden])');
  await navigate(ownerPage, 'eventPolls');
  const refreshed = ownerPage.locator('[data-poll-group]', { hasText: 'Welcher Zeitraum passt?' });
  await refreshed.waitFor();
  assert.equal(await refreshed.locator('.event-poll-response-details').count(), 0, 'names stay hidden while voting is open');
  await refreshed.locator('[data-close-poll]').click();
  await ownerPage.locator('.modal-backdrop [data-confirm]').click();
  await ownerPage.locator('.toast', { hasText: 'Abstimmung beendet' }).waitFor();
  const closed = ownerPage.locator('[data-poll-group]', { hasText: 'Welcher Zeitraum passt?' });
  await closed.locator('.event-poll-response-details').first().waitFor();
  assert.match((await closed.locator('.event-poll-response-details').first().textContent()) ?? '', new RegExp(MEMBER_NAME));
  assert.equal(await closed.locator('.event-poll-result-title', { hasText: 'Ergebnis' }).count(), 1);
  assert.equal(await closed.locator('[data-decide-poll]').count(), 0, 'the closed counts are the result; there is no second decision step');
  await ownerPage.locator('[data-new-poll-round]').waitFor();

  await createPoll(memberPage, {
    title: 'Welche Verpflegung?',
    mode: 'multiple_choice',
    maxSelections: 2,
    options: ['Pizza', 'Curry', 'Salat'],
  });
  const memberCreated = memberPage.locator('[data-poll-group]', { hasText: 'Welche Verpflegung?' });
  await memberCreated.waitFor();
  assert.equal(await memberCreated.locator('[data-poll-choice]').count(), 3, 'a regular participant can create a poll');
  assert.deepEqual(
    await memberCreated.locator('[data-poll-choice]').allTextContents(),
    ['Wählen', 'Wählen', 'Wählen'],
  );
  await memberCreated.locator('[data-poll-choice]').first().tap();
  const pollViewport = memberPage.locator('#view-container');
  await pollViewport.evaluate((element) => { element.scrollTop = element.scrollHeight; });
  const beforeSaveTop = await memberCreated.evaluate((element) => element.getBoundingClientRect().top);
  const beforeSaveHeight = await memberCreated.evaluate((element) => element.getBoundingClientRect().height);
  await memberCreated.locator('[data-save-poll]').tap();
  await memberPage.locator('.toast', { hasText: 'Antwort gespeichert' }).waitFor();
  await memberPage.waitForTimeout(300);
  const afterSaveTop = await memberCreated.evaluate((element) => element.getBoundingClientRect().top);
  const afterSaveHeight = await memberCreated.evaluate((element) => element.getBoundingClientRect().height);
  assert.ok(
    Math.abs(afterSaveTop - beforeSaveTop) <= 24 && afterSaveTop < -100,
    `saving keeps the visible poll anchored instead of jumping to the top (${beforeSaveTop}/${beforeSaveHeight} -> ${afterSaveTop}/${afterSaveHeight})`,
  );
  assert.deepEqual(await memberCreated.locator('[data-poll-choice]').allTextContents(), ['Ausgewählt', 'Wählen', 'Wählen']);
  assert.equal(await memberCreated.locator('.event-poll-option-header .badge', { hasText: 'Meiste Stimmen' }).count(), 1);
  const compactOptionHeight = (await memberCreated.locator('.event-poll-option').first().boundingBox())!.height;
  assert.ok(compactOptionHeight < 80, `choice options stay compact (${compactOptionHeight}px)`);

  await memberCreated.locator('[data-poll-choice]').nth(1).tap();
  await memberCreated.locator('[data-poll-choice]').nth(0).tap();
  await memberCreated.locator('[data-save-poll]').tap();
  await memberPage.waitForFunction(() => {
    const poll = Array.from(document.querySelectorAll('[data-poll-group]')).find((element) => element.textContent?.includes('Welche Verpflegung?'));
    const counts = poll?.querySelectorAll('.event-poll-counts');
    return counts?.[0]?.textContent?.includes('0 Stimmen') && counts?.[1]?.textContent?.includes('1 Stimme');
  });
  assert.deepEqual(
    await memberCreated.locator('[data-poll-choice]').allTextContents(),
    ['Wählen', 'Ausgewählt', 'Wählen'],
    'the saved answer, counts and recommendation reconcile to the same server response',
  );
  assert.equal(await memberCreated.locator('[data-poll-choice]').nth(1).locator('.ui-icon').count(), 0, 'the compact selected action has no redundant check icon');
  assert.equal(
    await memberCreated.locator('.event-poll-option').nth(1).locator('.event-poll-option-header .badge', { hasText: 'Meiste Stimmen' }).count(),
    1,
    'the recommendation stays on the title line',
  );

  await memberCreated.locator('[data-edit-poll]').tap();
  await memberPage.waitForSelector('#event-poll-edit-form');
  assert.equal(await memberPage.locator('#event-poll-edit-form [data-poll-option-id] [data-remove-poll-option]').count(), 0);
  const firstEditOption = memberPage.locator('#event-poll-edit-form [data-poll-option-row]').first();
  await firstEditOption.locator('.event-poll-form-option-details').evaluate((details) => { (details as HTMLDetailsElement).open = true; });
  await firstEditOption.locator('[data-poll-option-note]').fill('Auch vegetarisch verfügbar');
  await firstEditOption.locator('[data-poll-option-url]').fill('https://example.com/pizza');
  await memberPage.click('#event-poll-edit-form #poll-add-option');
  await memberPage.locator('#event-poll-edit-form [data-poll-option-input]').last().fill('Dessert');
  await memberPage.click('#event-poll-edit-form button[type="submit"]');
  await memberPage.locator('.toast', { hasText: 'Bereits abgestimmte Teilnehmer wurden informiert' }).waitFor();
  await memberPage.waitForFunction(() => {
    const poll = Array.from(document.querySelectorAll('[data-poll-group]')).find((element) => element.textContent?.includes('Welche Verpflegung?'));
    return poll?.querySelectorAll('.event-poll-option').length === 4;
  });
  assert.equal(await memberCreated.locator('a[href="https://example.com/pizza"]').count(), 1);
  assert.equal(await memberCreated.locator('[aria-label="Mehr Informationen zu Notiz zu Pizza"]').count(), 1);
  assert.equal(
    await memberPage.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    true,
    'the redesigned poll tab stays within the phone viewport',
  );

  await createPoll(ownerPage, {
    title: 'Unterkünfte bewerten',
    mode: 'rating_1_5',
    options: [
      { label: 'Haus am See', description: 'Mit Sauna', url: 'https://example.com/haus' },
      'Hütte im Wald',
    ],
  });
  const ratingPoll = ownerPage.locator('[data-poll-group]', { hasText: 'Unterkünfte bewerten' });
  await ratingPoll.waitFor();
  assert.equal(await ratingPoll.locator('[data-poll-response="1"]').count(), 2);
  assert.equal(await ratingPoll.locator('[data-poll-response="5"]').count(), 2);
  const linkedOption = ratingPoll.locator('.event-poll-option').first();
  const optionLink = linkedOption.locator('a[href="https://example.com/haus"]');
  assert.equal(await optionLink.count(), 1);
  assert.ok((await optionLink.getAttribute('class'))?.includes('icon-btn'));
  assert.equal(await optionLink.getAttribute('aria-label'), 'Link zu Haus am See öffnen');
  assert.equal(await optionLink.evaluate((element) => element.previousElementSibling?.tagName), 'STRONG');
  assert.equal(await linkedOption.locator('[aria-label="Mehr Informationen zu Notiz zu Haus am See"]').count(), 1);
  assert.equal(await linkedOption.locator('.event-poll-option-title-row > .muted').count(), 0, 'the note is no longer an extra visible line');

  await createPoll(ownerPage, {
    title: 'Anonyme Unterkunftswahl',
    mode: 'single_choice',
    anonymous: true,
    options: ['Haus', 'Hotel'],
  });
  const anonymousPoll = ownerPage.locator('[data-poll-group]', { hasText: 'Anonyme Unterkunftswahl' });
  await anonymousPoll.waitFor();
  assert.match((await anonymousPoll.locator('[data-poll-round]').textContent()) ?? '', /Anonym/);
  await anonymousPoll.locator('[data-poll-choice]').first().click();
  await anonymousPoll.locator('[data-save-poll]').click();
  await ownerPage.locator('.toast', { hasText: 'Antwort gespeichert' }).waitFor();
  assert.deepEqual(await anonymousPoll.locator('[data-poll-choice]').allTextContents(), ['Ausgewählt', 'Wählen']);
  assert.match((await anonymousPoll.locator('.event-poll-counts').first().textContent()) ?? '', /1 Stimme/);
  await anonymousPoll.locator('[data-close-poll]').click();
  await ownerPage.locator('.modal-backdrop [data-confirm]').click();
  await ownerPage.locator('.toast', { hasText: 'Abstimmung beendet' }).waitFor();
  assert.equal(await anonymousPoll.locator('.event-poll-response-details').count(), 0, 'anonymous votes never expose identities');
});
