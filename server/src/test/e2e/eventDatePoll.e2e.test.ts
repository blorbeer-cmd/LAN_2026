import { before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { ChildProcess } from 'child_process';
import { chromium, Browser, Page } from 'playwright';
import { finishE2EOnboarding } from './authHelpers';
import { createE2EDiagnosticTest, trackE2EContext } from './e2eDiagnostics';
import { startE2EServer, type E2EServer } from './e2eServer';

let BASE_URL: string;
const RECOVERY_CODE = 'event-date-poll-e2e-recovery';
const OWNER_NAME = 'E2E Poll Owner';
const OWNER_PASSWORD = 'e2e poll owner secure passphrase';
const MEMBER_NAME = 'E2E Poll Member';
const MEMBER_PASSWORD = 'e2e poll member secure passphrase';
const CREATOR_NAME = 'E2E Poll Creator';
const CREATOR_PASSWORD = 'e2e poll creator secure passphrase';
const EVENT_NAME = 'LAN Herbst E2E';

let serverProcess: ChildProcess;
let e2eServer: E2EServer;
let browser: Browser;
let ownerPage: Page;
let memberPage: Page;

const test = createE2EDiagnosticTest(() => ({ browser, server: e2eServer }));

function sessionCookie(response: Response): string {
  const value = response.headers.get('set-cookie');
  assert.ok(value, 'authentication response should set a session cookie');
  return value.split(';')[0];
}

async function registerMember(ownerCookie: string, name: string, password: string): Promise<{ id: string; cookie: string }> {
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
    body: JSON.stringify({ code, name, password }),
  });
  assert.equal(registration.status, 201);
  const id = ((await registration.json()) as { id: string }).id;
  const cookie = sessionCookie(registration);
  await finishE2EOnboarding(BASE_URL, cookie);
  return { id, cookie };
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

async function goToEvents(page: Page): Promise<void> {
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('respawn:navigate', { detail: 'events' })));
  await page.waitForSelector('#orga-events-title');
}

// Picks a date on the shared themed date-only picker (dateTimeField.js): opens
// the popover, navigates forward the number of months between "now" (its
// starting view, since these fields are always empty on first use in this
// test) and the target month, then clicks the target day cell.
async function pickDate(page: Page, fieldId: string, target: Date): Promise<void> {
  await page.click(`[data-dt-field="${fieldId}"] [data-dt-trigger]`);
  await page.waitForSelector('.dt-popover');
  const now = new Date();
  const diffMonths = (target.getFullYear() - now.getFullYear()) * 12 + (target.getMonth() - now.getMonth());
  for (let i = 0; i < diffMonths; i++) {
    await page.click('.dt-popover [data-dt-nav="1"]');
  }
  await page.click(`.dt-popover [data-dt-day="${target.getDate()}"]`);
  await page.waitForSelector('.dt-popover', { state: 'detached' });
}

function daysFromNow(n: number): Date {
  return new Date(Date.now() + n * 86_400_000);
}

before(async () => {
  const server = await startE2EServer({
    ...process.env,
    DB_FILE: ':memory:',
    ADMIN_RECOVERY_CODE: RECOVERY_CODE,
  });
  e2eServer = server;
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
  // Creating a registration invite requires a recent password confirmation.
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

  await registerMember(ownerCookie, MEMBER_NAME, MEMBER_PASSWORD);

  browser = await chromium.launch();
  // The owner drives the planning/creator side on a laptop-sized viewport;
  // the member votes and reconfirms on a phone-sized, touch-capable viewport
  // to exercise the mobile/touch requirement for the normal-participant view.
  ownerPage = await browser.newPage({ viewport: { width: 1024, height: 800 } });
  memberPage = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  await login(ownerPage, OWNER_NAME, OWNER_PASSWORD);
  await login(memberPage, MEMBER_NAME, MEMBER_PASSWORD);
});

after(async () => {
  await browser?.close();
  serverProcess?.kill();
});

test('planning event: creator starts a poll, a normal member votes by keyboard/touch, the creator schedules it, and a later reschedule requires reconfirmation', async () => {
  await goToEvents(ownerPage);
  await goToEvents(memberPage);

  // --- Create the planning event (no fixed date yet) via the UI ---
  await ownerPage.click('#new-planning-event-btn');
  await ownerPage.waitForSelector('#planning-event-form');
  await ownerPage.fill('#planning-event-name', EVENT_NAME);
  await ownerPage.fill('#planning-event-location', 'Vereinsheim');
  await ownerPage.click('#planning-event-form button[type="submit"]');
  const ownerEventCard = ownerPage.locator('.event-card', { hasText: EVENT_NAME });
  await ownerEventCard.waitFor();
  // Before any poll round exists, the card offers only the CTA to start one —
  // no date, no "Invalid Date", nothing implying tracking/roster management.
  assert.match((await ownerEventCard.textContent()) ?? '', /Termin abstimmen/);
  assert.doesNotMatch((await ownerEventCard.textContent()) ?? '', /Invalid Date/);
  assert.equal(await ownerEventCard.locator('[data-participants-event]').count(), 0);
  assert.equal(
    await ownerEventCard.evaluate((card) => document.documentElement.scrollWidth <= window.innerWidth),
    true,
    'a draft event card never forces horizontal scrolling',
  );
  const eventId = (await ownerEventCard.getAttribute('data-event-card')) as string;

  // --- Creator starts the first date poll round with two option ranges ---
  await ownerPage.click(`[data-start-date-poll="${eventId}"]`);
  await ownerPage.waitForSelector('#date-poll-form');
  await pickDate(ownerPage, 'poll-option-0-starts', daysFromNow(10));
  await pickDate(ownerPage, 'poll-option-0-ends', daysFromNow(12));
  await pickDate(ownerPage, 'poll-option-1-starts', daysFromNow(17));
  await pickDate(ownerPage, 'poll-option-1-ends', daysFromNow(19));
  await pickDate(ownerPage, 'poll-due', daysFromNow(5));
  await ownerPage.click('#date-poll-form button[type="submit"]');
  await ownerPage.waitForSelector('#date-poll-form', { state: 'detached' });

  // --- The plain member: no event_participants row exists yet, so the draft
  // must still show up (plannedEvents) — this is the exact visibility gap the
  // fix in routes/events.ts closes. ---
  const memberEventCard = memberPage.locator(`[data-event-card="${eventId}"]`);
  await memberEventCard.waitFor();
  assert.match((await memberEventCard.textContent()) ?? '', /In Planung/);
  assert.match((await memberEventCard.textContent()) ?? '', /Terminabstimmung läuft/);
  assert.equal(
    await memberEventCard.evaluate((card) => card.scrollWidth <= card.clientWidth),
    true,
    'the poll section fits the phone card without horizontal scrolling',
  );
  const memberRound = memberEventCard.locator('[data-poll-id]');
  await memberRound.waitFor();
  const optionRows = memberRound.locator('.event-date-poll-option');
  assert.equal(await optionRows.count(), 2);

  // Member answers via keyboard: focus the "Kann" toggle on option 1 and
  // activate it with Enter/Space instead of a pointer click.
  const option1CanBtn = optionRows.nth(0).locator('[data-response-value="can"]');
  await option1CanBtn.focus();
  await option1CanBtn.press('Enter');
  assert.equal(await option1CanBtn.getAttribute('aria-pressed'), 'true');

  // Member answers option 2 via touch (tap).
  const option2CannotBtn = optionRows.nth(1).locator('[data-response-value="cannot"]');
  await option2CannotBtn.tap();
  assert.equal(await option2CannotBtn.getAttribute('aria-pressed'), 'true');

  const saveBtn = memberRound.locator('[data-save-responses]');
  assert.equal(await saveBtn.isDisabled(), false, 'both options answered, saving is now allowed');
  await saveBtn.click();
  await memberPage.locator('.toast', { hasText: 'Antwort gespeichert' }).waitFor();

  // --- Creator: sees the live counts and the collapsible people list ---
  const ownerRound = ownerEventCard.locator('[data-poll-id]');
  await ownerRound.waitFor();
  const ownerOption1 = ownerRound.locator('.event-date-poll-option').nth(0);
  await ownerOption1.locator('.event-date-poll-counts', { hasText: 'Kann 1' }).waitFor();
  const peopleList = ownerOption1.locator('[data-people-key$=":can"]');
  await peopleList.locator('summary').click();
  assert.match((await peopleList.textContent()) ?? '', new RegExp(MEMBER_NAME));

  // --- Creator schedules option 1 (the only one anyone said "Kann" to) ---
  const scheduleBtn = ownerOption1.locator('[data-schedule-option]');
  await scheduleBtn.click();
  await ownerPage.locator('.modal-backdrop', { hasText: 'Termin festlegen?' }).waitFor();
  await ownerPage.click('.modal-backdrop [data-confirm]');
  await ownerEventCard.locator('.badge', { hasText: 'Aktueller Termin' }).waitFor();
  await memberEventCard.locator('.badge', { hasText: 'Aktueller Termin' }).waitFor();
  assert.doesNotMatch((await memberEventCard.textContent()) ?? '', /Invalid Date/);
  assert.doesNotMatch((await ownerEventCard.textContent()) ?? '', /Invalid Date/);

  // --- Creator now sends the regular invitation and the member accepts, so
  // there is a real acceptance that can later go stale on reschedule. ---
  await ownerEventCard.locator('[data-participants-event]').click();
  const memberManagerRow = ownerPage.locator('.modal-backdrop .event-participant-manager-row', { hasText: MEMBER_NAME });
  const inviteButton = memberManagerRow.locator('[data-invite-participant]');
  await inviteButton.click();
  await ownerPage.locator('.toast', { hasText: 'Einladung gesendet' }).waitFor();
  await ownerPage.click('.modal-backdrop [data-close]');
  // Invitations are answered from Profile's own "Einladungen" section, not
  // inline in the Events tab.
  await memberPage.evaluate(() => window.dispatchEvent(new CustomEvent('respawn:navigate', { detail: 'profile' })));
  const memberAccept = memberPage.locator(`[data-accept-invitation="${eventId}"]`);
  await memberAccept.waitFor();
  await memberAccept.click();
  await memberAccept.waitFor({ state: 'detached' });
  await goToEvents(memberPage);

  // --- Reschedule: the creator starts a new round; the previous acceptance
  // is kept but goes stale until reconfirmed. ---
  await ownerPage.click(`[data-start-date-poll="${eventId}"]`);
  await ownerPage.locator('.modal-backdrop', { hasText: 'Neuen Termin abstimmen?' }).waitFor();
  await ownerPage.click('.modal-backdrop [data-confirm]');
  await ownerPage.waitForSelector('#date-poll-form');
  await pickDate(ownerPage, 'poll-option-0-starts', daysFromNow(24));
  await pickDate(ownerPage, 'poll-option-0-ends', daysFromNow(26));
  await pickDate(ownerPage, 'poll-option-1-starts', daysFromNow(31));
  await pickDate(ownerPage, 'poll-option-1-ends', daysFromNow(33));
  await pickDate(ownerPage, 'poll-due', daysFromNow(20));
  await ownerPage.click('#date-poll-form button[type="submit"]');
  await ownerPage.waitForSelector('#date-poll-form', { state: 'detached' });
  await ownerRound.locator('strong', { hasText: 'Runde 2' }).waitFor();

  const round2 = ownerEventCard.locator('[data-poll-id]');
  const round2Option1 = round2.locator('.event-date-poll-option').nth(0);
  await round2Option1.locator('[data-schedule-option]').click();
  await ownerPage.locator('.modal-backdrop', { hasText: 'Termin festlegen?' }).waitFor();
  await ownerPage.click('.modal-backdrop [data-confirm]');

  // The member's own acceptance is now stale for the new revision — without
  // the fix, this event would vanish from the member's list entirely instead
  // of showing the reconfirmation prompt.
  await memberEventCard.locator('.badge', { hasText: 'Erneute Bestätigung erforderlich' }).waitFor();
  const reconfirmBtn = memberEventCard.locator(`[data-reconfirm-event="${eventId}"]`);
  await reconfirmBtn.waitFor();
  await reconfirmBtn.focus();
  await reconfirmBtn.press('Enter');
  await memberPage.locator('.toast', { hasText: 'Termin bestätigt' }).waitFor();
  await memberEventCard.locator('.badge', { hasText: 'Erneute Bestätigung erforderlich' }).waitFor({ state: 'detached' });

  // The card itself survives the reschedule intact (still exports, no reset
  // to some "no event" empty state). The actual claim that payments and
  // accommodation accounting from before a reschedule stay untouched is
  // covered at the API level, where it can assert on the real settlement
  // figures instead of just a button's presence — see api.eventDatePolls.test.ts's
  // "a reschedule leaves existing payments and accommodation accounting untouched".
  assert.equal(await ownerEventCard.locator('[data-export-event]').count(), 1);
});

test('creator delegation: the group owner can manage a planning event after its original (non-owner) admin creator is deactivated', async () => {
  const ownerLogin = await fetch(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: OWNER_NAME, password: OWNER_PASSWORD }),
  });
  assert.equal(ownerLogin.status, 200, await ownerLogin.text());
  const ownerCookie = sessionCookie(ownerLogin);
  // Role changes require a recent password confirmation, not just a session.
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

  const creator = await registerMember(ownerCookie, CREATOR_NAME, CREATOR_PASSWORD);
  // Admin rights are managed only via the group role, not the player profile
  // (see routes/players.ts's explicit 400 for a body carrying isAdmin) —
  // promote the creator to admin so they can create a planning event at all.
  // Single-group instance: 'default-group' is db.ts's stable DEFAULT_GROUP_ID.
  const promote = await fetch(`${BASE_URL}/api/groups/default-group/members/${creator.id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Cookie: ownerCookie },
    body: JSON.stringify({ role: 'admin' }),
  });
  assert.equal(promote.status, 200, await promote.text());

  const creatorPage = await browser.newPage({ viewport: { width: 1024, height: 800 } });
  await trackE2EContext(creatorPage.context(), 'event-date-poll-creator');
  await login(creatorPage, CREATOR_NAME, CREATOR_PASSWORD);
  await goToEvents(creatorPage);

  await creatorPage.click('#new-planning-event-btn');
  await creatorPage.waitForSelector('#planning-event-form');
  await creatorPage.fill('#planning-event-name', 'Delegation LAN');
  await creatorPage.click('#planning-event-form button[type="submit"]');
  const creatorCard = creatorPage.locator('.event-card', { hasText: 'Delegation LAN' });
  await creatorCard.waitFor();
  const delegatedEventId = (await creatorCard.getAttribute('data-event-card')) as string;

  await creatorPage.click(`[data-start-date-poll="${delegatedEventId}"]`);
  await creatorPage.waitForSelector('#date-poll-form');
  await pickDate(creatorPage, 'poll-option-0-starts', daysFromNow(40));
  await pickDate(creatorPage, 'poll-option-0-ends', daysFromNow(41));
  await pickDate(creatorPage, 'poll-option-1-starts', daysFromNow(45));
  await pickDate(creatorPage, 'poll-option-1-ends', daysFromNow(46));
  await pickDate(creatorPage, 'poll-due', daysFromNow(35));
  await creatorPage.click('#date-poll-form button[type="submit"]');
  await creatorPage.waitForSelector('#date-poll-form', { state: 'detached' });
  await creatorPage.close();

  // The creator account is deactivated (e.g. they left before the LAN).
  const deactivate = await fetch(`${BASE_URL}/api/players/${creator.id}/deactivate`, {
    method: 'POST',
    headers: { Cookie: ownerCookie },
  });
  assert.equal(deactivate.status, 204);

  // The owner (not the original creator) reloads and can still manage the
  // round: pick the recommended option and schedule it.
  await ownerPage.reload();
  await ownerPage.waitForSelector('#app:not([hidden])');
  await goToEvents(ownerPage);
  const ownerDelegatedCard = ownerPage.locator(`[data-event-card="${delegatedEventId}"]`);
  await ownerDelegatedCard.waitFor();
  const scheduleBtn = ownerDelegatedCard.locator('[data-schedule-option]').first();
  await scheduleBtn.waitFor();
  await scheduleBtn.click();
  await ownerPage.locator('.modal-backdrop', { hasText: 'Termin festlegen?' }).waitFor();
  await ownerPage.click('.modal-backdrop [data-confirm]');
  await ownerDelegatedCard.locator('.badge', { hasText: 'Aktueller Termin' }).waitFor();
});
