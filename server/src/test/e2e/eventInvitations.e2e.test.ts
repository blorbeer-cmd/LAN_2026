import { before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { ChildProcess } from 'child_process';
import { readFile } from 'node:fs/promises';
import { chromium, Browser, Page } from 'playwright';
import { finishE2EOnboarding, waitForPlayerData } from './authHelpers';
import { createE2EDiagnosticTest, trackE2EContext } from './e2eDiagnostics';
import { startE2EServer, type E2EServer } from './e2eServer';

let BASE_URL: string;
const RECOVERY_CODE = 'event-invitations-e2e-recovery';
const OWNER_NAME = 'E2E Event Owner';
const OWNER_PASSWORD = 'e2e event owner secure passphrase';
const MEMBER_NAME = '$t3vYb0y';
const MEMBER_PASSWORD = 'e2e event member secure passphrase';
const EVENT_NAME = 'E2E Einladung LAN';
const OUTSIDER_NAME = 'E2E Ohne Event';
const OUTSIDER_PASSWORD = 'e2e event outsider secure passphrase';

let serverProcess: ChildProcess;
let e2eServer: E2EServer;
let browser: Browser;
let ownerPage: Page;
let memberPage: Page;
let eventId: string;
let memberId: string;
const memberEventNotFoundResponses: string[] = [];

const test = createE2EDiagnosticTest(() => ({ browser, server: e2eServer }));

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
  await waitForPlayerData(page);
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
  const paymentDueAt = Math.floor((now + 24 * 60 * 60 * 1000) / 60_000) * 60_000;
  const event = await fetch(`${BASE_URL}/api/events`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: ownerCookie },
    body: JSON.stringify({
      name: EVENT_NAME,
      startsAt: now,
      endsAt: now + 5 * 60_000,
      visibilityScope: 'participants',
      location: 'https://maps.example.test/respawn',
      costCents: 2550,
      accommodationCostCents: 10000,
      paypalLink: 'https://paypal.me/respawn-e2e',
      paymentDueAt,
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
  // Auswertung (leaderboard/analytics/hallOfFame) lives behind Admin's own
  // "Auswertung" tool card now, gated by the real admin role a plain member
  // never has — switchView() redirects any attempt to reach it to Essen
  // instead of rendering it, so it is excluded from this per-view "no stale
  // event data" check.
  for (const view of ['votes', 'broadcast', 'foodOrders', 'checklist', 'checklistPacking', 'arrivals', 'events', 'kiosk', 'seating', 'myStats']) {
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

  await ownerPage.evaluate(() => window.dispatchEvent(new CustomEvent('respawn:navigate', { detail: 'events' })));
  await memberPage.evaluate(() => window.dispatchEvent(new CustomEvent('respawn:navigate', { detail: 'events' })));
  await ownerPage.waitForSelector(`[data-participants-event="${eventId}"]`);
  const ownerEventCard = ownerPage.locator(`[data-event-card="${eventId}"]`);
  assert.equal(await ownerEventCard.locator(`[data-event-participants="${eventId}"]`).getAttribute('open'), null);
  assert.equal(await ownerEventCard.locator('.event-card-info.food-order-details').count(), 1);
  assert.equal(await ownerEventCard.locator('.event-card-info .event-card-payment-creator').count(), 1);
  assert.match((await ownerEventCard.locator('.event-settlement').textContent()) ?? '', /Unterkunft gesamt/);
  assert.match((await ownerEventCard.locator('.event-settlement').textContent()) ?? '', /100,00/);
  assert.equal(await ownerEventCard.locator('.event-card-info [data-edit-event]').count(), 1);
  assert.equal(await ownerEventCard.locator('.event-card-actions [data-edit-event]').count(), 0);
  await ownerEventCard.locator('.event-card-info [data-edit-event]').click();
  const editEventModal = ownerPage.locator('.modal-backdrop', { hasText: 'Event bearbeiten' });
  await editEventModal.waitFor();
  assert.equal(await editEventModal.locator('[data-dt-field="event-ends"] [data-dt-clear]').count(), 0);
  await editEventModal.locator('[data-close]').click();
  const discardChanges = ownerPage.locator('.modal-backdrop [data-confirm]');
  assert.equal(await discardChanges.count(), 0, 'opening and closing an unchanged event must not ask to discard changes');
  await editEventModal.waitFor({ state: 'detached' });
  assert.equal(await ownerEventCard.locator('.event-calendar-actions').count(), 1);
  assert.equal(await ownerEventCard.locator('[data-event-calendar], [data-download-event-calendar]').count(), 3);
  assert.equal(await ownerEventCard.locator('.event-card-kicker').count(), 0, 'event cards do not repeat their type above the title');
  assert.equal(
    await ownerEventCard.evaluate((card) => {
      const info = card.querySelector('.event-card-info')?.getBoundingClientRect();
      const participants = card.querySelector('[data-event-participants]')?.getBoundingClientRect();
      return Boolean(info && participants && participants.top >= info.bottom);
    }),
    true,
    'the collapsible participant list follows the shared information box',
  );
  assert.deepEqual(
    await ownerPage.locator('.orga-event-grid').last().evaluate((element) => {
      const style = getComputedStyle(element);
      return { display: style.display, flexDirection: style.flexDirection };
    }),
    { display: 'flex', flexDirection: 'column' },
  );
  assert.equal(
    await memberPage.locator(`[data-participants-event="${eventId}"]`).count(),
    0,
    'a private event must stay hidden before the member is invited',
  );
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
  const ownerParticipantList = ownerEventCard.locator(`[data-event-participants="${eventId}"]`);
  const invitedRosterRow = ownerParticipantList.locator('[data-event-participation-status="invited"]', { hasText: MEMBER_NAME });
  await invitedRosterRow.waitFor({ state: 'attached' });
  assert.match((await ownerParticipantList.locator('.food-order-group-meta').textContent()) ?? '', /1 Einladung offen/);
  assert.match((await invitedRosterRow.textContent()) ?? '', /Einladung offen/);
  assert.equal(
    await invitedRosterRow.locator('[data-toggle-event-paid]').count(),
    0,
    'an open invitation cannot receive a payment state',
  );

  // A pending invitation is no longer shown on the Events tab at all — it
  // would otherwise sit directly above the tab's own event cards. Instead it
  // surfaces as a Home "Aktuell" nudge and is actually answered in "Mein
  // Profil" (see events.js/profile.js/aktuellStatus.js).
  assert.equal(await memberPage.locator(`[data-pending-invitation="${eventId}"]`).count(), 0);
  await memberPage.evaluate(() => window.dispatchEvent(new CustomEvent('respawn:navigate', { detail: 'home' })));
  await memberPage.waitForSelector('#view-container[data-view="home"]');
  const homeInvitationRow = memberPage.locator('[data-current-item]', { hasText: EVENT_NAME });
  await homeInvitationRow.waitFor();
  assert.match((await homeInvitationRow.textContent()) ?? '', /Einladung/);
  await homeInvitationRow.locator('.home-current-navigate').click();
  await memberPage.waitForSelector('#view-container[data-view="profile"]');

  const pending = memberPage.locator(`[data-pending-invitation="${eventId}"]`);
  await pending.waitFor();

  // The invitation also arrives as a personal notification. It is delivered in
  // the base workspace because the member is not a participant of the target
  // event yet, and it deep-links back into the profile, where the invitation
  // is now answered.
  const invitationNotification = memberPage.locator('[data-notification-entry]', { hasText: EVENT_NAME });
  await memberPage.click('#notifications-btn');
  await invitationNotification.waitFor();
  assert.match((await invitationNotification.textContent()) ?? '', /Einladung/);
  assert.equal(
    await invitationNotification.locator('[data-notification-navigate="profile"]').count(),
    1,
    'the notification offers the jump into the profile, where the invitation is answered',
  );
  await memberPage.click('#notifications-btn');
  assert.match((await pending.textContent()) ?? '', new RegExp(EVENT_NAME));
  assert.match((await pending.textContent()) ?? '', /Eingeladen/);
  assert.match(
    (await pending.textContent()) ?? '',
    /25,50/,
    'the invitation discloses the per-person cost before acceptance',
  );
  assert.match((await pending.textContent()) ?? '', /Zahlungsziel/);
  assert.equal(await pending.locator('.event-card-info.food-order-details .event-invitation-payment').count(), 1);
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
  const openAcceptedEvent = memberPage.locator(`[data-open-accepted-event="${eventId}"]`);
  await openAcceptedEvent.waitFor();
  assert.equal(await openAcceptedEvent.textContent(), 'Event öffnen');
  await memberPage.click('#notifications-btn');
  await invitationNotification.waitFor();
  assert.equal(
    await invitationNotification.evaluate((entry) => entry.classList.contains('is-unread')),
    false,
    'the resolved invitation remains as read history instead of an open notification',
  );
  await memberPage.click('#notifications-btn');
  await ownerRefresh;
  const acceptedRosterRow = ownerParticipantList.locator('[data-event-participation-status="accepted"]', { hasText: MEMBER_NAME });
  await acceptedRosterRow.waitFor({ state: 'attached' });
  assert.match((await ownerParticipantList.locator('.food-order-group-meta').textContent()) ?? '', /1 Zusage/);

  await openAcceptedEvent.click();
  await memberPage.waitForSelector('#view-container[data-view="home"]');
  await memberPage.waitForFunction(
    (acceptedEventId) => (document.getElementById('event-context-switcher') as HTMLInputElement | null)?.value === acceptedEventId,
    eventId,
  );

  // The accepted event's own card only ever lived on the Events tab.
  await memberPage.evaluate(() => window.dispatchEvent(new CustomEvent('respawn:navigate', { detail: 'events' })));
  await memberPage.waitForSelector('#view-container[data-view="events"]');
  const memberEventCard = memberPage.locator(`[data-event-card="${eventId}"]`);
  await memberEventCard.waitFor();
  assert.ok(((await memberEventCard.textContent()) ?? '').includes(MEMBER_NAME));
  assert.equal(
    await memberEventCard.locator('a.event-location-link').getAttribute('href'),
    'https://maps.example.test/respawn',
  );
  assert.equal(await memberEventCard.locator('[data-copy-event-location]').count(), 0);
  const googleCalendarUrl = new URL(
    (await memberEventCard.locator('[data-event-calendar="google"]').getAttribute('href')) as string,
  );
  assert.equal(googleCalendarUrl.origin, 'https://calendar.google.com');
  assert.equal(googleCalendarUrl.searchParams.get('text'), EVENT_NAME);
  assert.equal(googleCalendarUrl.searchParams.get('location'), 'https://maps.example.test/respawn');
  assert.match(googleCalendarUrl.searchParams.get('dates') ?? '', /^\d{8}T\d{6}Z\/\d{8}T\d{6}Z$/);
  const outlookCalendarUrl = new URL(
    (await memberEventCard.locator('[data-event-calendar="outlook"]').getAttribute('href')) as string,
  );
  assert.equal(outlookCalendarUrl.origin, 'https://outlook.live.com');
  assert.equal(outlookCalendarUrl.searchParams.get('subject'), EVENT_NAME);
  assert.equal(outlookCalendarUrl.searchParams.get('location'), 'https://maps.example.test/respawn');
  const calendarDownload = memberPage.waitForEvent('download');
  const calendarFileButton = memberEventCard.locator(`[data-download-event-calendar="${eventId}"]`);
  await calendarFileButton.focus();
  await calendarFileButton.press('Enter');
  const downloadedCalendar = await calendarDownload;
  assert.equal(downloadedCalendar.suggestedFilename(), `${EVENT_NAME}.ics`);
  const calendarPath = await downloadedCalendar.path();
  assert.ok(calendarPath);
  const calendarContents = await readFile(calendarPath, 'utf8');
  assert.match(calendarContents, /BEGIN:VCALENDAR\r?\n/);
  assert.match(calendarContents, new RegExp(`UID:${eventId}@respawn\\.local`));
  assert.match(calendarContents, /SUMMARY:E2E Einladung LAN\r?\n/);
  assert.match(calendarContents, /LOCATION:https:\/\/maps\.example\.test\/respawn\r?\n/);
  assert.match((await memberEventCard.textContent()) ?? '', /Beendet die Kalender-Erinnerungen/);
  const confirmationResponse = memberPage.waitForResponse(
    (response) =>
      response.request().method() === 'POST' &&
      response.url() === `${BASE_URL}/api/events/${eventId}/calendar-confirmation`,
  );
  const confirmCalendarButton = memberEventCard.locator(`[data-confirm-event-calendar="${eventId}"]`);
  await confirmCalendarButton.focus();
  await confirmCalendarButton.press('Enter');
  const stefanConfirmation = memberPage.locator('[role="alertdialog"]', {
    hasText: 'Hast du den Termin wirklich eingetragen, Stefan??!!',
  });
  await stefanConfirmation.waitFor();
  assert.match((await stefanConfirmation.textContent()) ?? '', /Ganz sicher, Stefan\?/);
  await stefanConfirmation.locator('[data-confirm]').focus();
  await stefanConfirmation.locator('[data-confirm]').press('Enter');
  assert.equal((await confirmationResponse).status(), 200);
  const calendarConfirmed = memberEventCard.locator(`[data-event-calendar-confirmed="${eventId}"]`);
  await calendarConfirmed.waitFor();
  assert.match((await calendarConfirmed.textContent()) ?? '', /Im Kalender eingetragen/);
  assert.equal(await memberEventCard.locator('[data-confirm-event-calendar]').count(), 0);
  assert.equal(
    await memberPage.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    true,
    'calendar actions must remain usable without horizontal scrolling on a phone',
  );
  const paypalButton = memberEventCard.locator(`[data-pay-event="${eventId}"]`);
  assert.equal(await memberEventCard.locator('.event-card-info.food-order-details .event-card-payment-member').count(), 1);
  assert.match((await memberEventCard.textContent()) ?? '', /Dein Beitrag/);
  assert.doesNotMatch((await memberEventCard.textContent()) ?? '', /Noch zu bezahlen/);
  assert.doesNotMatch((await memberEventCard.textContent()) ?? '', /\d+ von \d+ bezahlt/);
  assert.match((await paypalButton.textContent()) ?? '', /Bezahlen/);
  assert.match((await paypalButton.getAttribute('aria-label')) ?? '', /25,50.*PayPal bezahlen/);
  const participantList = memberEventCard.locator(`[data-event-participants="${eventId}"]`);
  assert.equal(await participantList.getAttribute('open'), null, 'participant lists start collapsed');
  assert.match((await participantList.locator('.food-order-group-meta').textContent()) ?? '', /1 Person/);
  assert.equal(
    await participantList.locator('.event-participant-toggle').evaluate((toggle) => {
      return toggle.firstElementChild?.classList.contains('collapsible-section-chevron') ?? false;
    }),
    true,
    'the participant disclosure follows the food-order pattern with a leading chevron',
  );
  assert.equal(
    await participantList.locator('[data-toggle-event-paid]').count(),
    0,
    'members do not see payment controls on roster rows',
  );
  assert.equal(
    await memberEventCard.locator('.event-card-payment-member [data-toggle-event-paid]').count(),
    1,
    'members can correct only their own payment state',
  );
  assert.equal(
    await memberEventCard.locator('[data-event-participation-status]').count(),
    0,
    'members receive only accepted people and no invitation-status roster',
  );
  await participantList.locator('summary').click();
  assert.equal(
    await participantList.locator('.event-participant-list').evaluate((list) => getComputedStyle(list).gridTemplateColumns.split(' ').length),
    1,
    'participant rows keep one full-width column like orderer groups',
  );
  assert.equal(
    await memberEventCard.evaluate((card) => card.scrollWidth <= card.clientWidth),
    true,
    'the combined information box and participant list fit the phone card',
  );
  await memberPage.evaluate(() => {
    window.open = (() => {
      const fake = {
        opener: window,
        closed: false,
        _location: '',
        get location() { return this._location; },
        set location(value: string) { this._location = value; },
        close() { this.closed = true; },
      };
      (window as unknown as { __eventPaymentPopup: typeof fake }).__eventPaymentPopup = fake;
      return fake as unknown as Window;
    }) as typeof window.open;
  });
  await paypalButton.click();
  await memberPage.waitForFunction(
    () => (window as unknown as { __eventPaymentPopup?: { location: string } }).__eventPaymentPopup?.location,
  );
  assert.deepEqual(
    await memberPage.evaluate(() => {
      const popup = (window as unknown as { __eventPaymentPopup: { location: string; opener: unknown } }).__eventPaymentPopup;
      return { location: popup.location, opener: popup.opener };
    }),
    { location: 'https://paypal.me/respawn-e2e/25.50EUR', opener: null },
  );
  await memberPage.locator('.modal-backdrop', { hasText: 'Bezahlt?' }).waitFor();
  await memberPage.click('[data-confirm]');
  await memberPage.locator(`[data-event-card="${eventId}"] .event-card-payment-member [data-toggle-event-paid][aria-pressed="true"]`).waitFor();
  await memberEventCard.locator('.event-card-payment-member .event-payment-proof', { hasText: `Bezahlt von ${MEMBER_NAME}` }).waitFor();
  assert.doesNotMatch((await memberEventCard.textContent()) ?? '', /\d+ von \d+ bezahlt/);
  const ownerSettlement = ownerEventCard.locator('.event-settlement', { hasText: 'Fehlbetrag 74,50' });
  await ownerSettlement.waitFor();
  assert.match((await ownerSettlement.textContent()) ?? '', /Rechnerisch pro Zusage\s*100,00/);
  assert.match((await ownerSettlement.textContent()) ?? '', /Bereits eingegangen\s*25,50/);

  const optionSelector = `#event-context-switcher-list [data-search-select-value="${eventId}"]`;
  await memberPage.locator(optionSelector).waitFor({ state: 'attached' });
  const mirrorPage = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await trackE2EContext(mirrorPage.context(), 'event-invitations-mirror');
  await login(mirrorPage, MEMBER_NAME, MEMBER_PASSWORD);
  await mirrorPage.locator(optionSelector).waitFor({ state: 'attached' });

  // The switcher is the shared searchable dropdown: open the listbox, then
  // pick the new workspace the way a person would.
  await memberPage.click('#event-context .search-select-toggle');
  await memberPage.click(optionSelector);
  await memberPage.waitForFunction(
    (expected) => (document.querySelector('#event-context-switcher') as HTMLInputElement | null)?.value === expected,
    eventId,
  );
  await mirrorPage.waitForFunction(
    (expected) => (document.querySelector('#event-context-switcher') as HTMLInputElement | null)?.value === expected,
    eventId,
  );
  // The title lives on the wrapper (#event-context), not the control itself:
  // the search field carries only an aria-label now that it shares the app's
  // standard dropdown shape, and the wrapper describes the status icon
  // alongside the event name.
  await memberPage.waitForFunction(
    (eventName) => document.querySelector('#event-context')?.getAttribute('title')?.includes(eventName),
    EVENT_NAME,
  );
  assert.match(await memberPage.locator('#event-context').getAttribute('title') ?? '', new RegExp(EVENT_NAME));
  const activeEvent = await memberPage.request.get(`${BASE_URL}/api/events/active`);
  assert.equal(activeEvent.status(), 200);
  assert.equal(((await activeEvent.json()) as { id: string }).id, eventId);
  await mirrorPage.close();

  // An- & Abreise's "Alle Zeiten" is scoped to the people who accepted this
  // event. GET /api/players hands every client the whole instance roster, so
  // an account that has nothing to do with the event would otherwise sit in
  // the table forever as a permanent "offen" row.
  assert.equal(
    (await ownerPage.request.post(`${BASE_URL}/api/auth/reauth`, { data: { password: OWNER_PASSWORD } })).status(),
    204,
  );
  const outsiderInvite = await ownerPage.request.post(`${BASE_URL}/api/auth/invites`, { data: { purpose: 'register' } });
  assert.equal(outsiderInvite.status(), 201);
  const outsiderRegistration = await fetch(`${BASE_URL}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      code: ((await outsiderInvite.json()) as { code: string }).code,
      name: OUTSIDER_NAME,
      password: OUTSIDER_PASSWORD,
    }),
  });
  assert.equal(outsiderRegistration.status, 201);

  // The roster is only fetched on load, so pick the new account up first and
  // confirm the member's own client really does receive it.
  await memberPage.reload();
  await memberPage.waitForSelector('#app:not([hidden])');
  const memberRoster = await memberPage.request.get(`${BASE_URL}/api/players`);
  assert.equal(memberRoster.status(), 200);
  assert.equal(
    ((await memberRoster.json()) as Array<{ name: string }>).some((player) => player.name === OUTSIDER_NAME),
    true,
    'the roster the client renders from does contain the uninvolved account',
  );

  await memberPage.evaluate(() => window.dispatchEvent(new CustomEvent('respawn:navigate', { detail: 'arrivals' })));
  await memberPage.waitForSelector('#view-container[data-view="arrivals"] .arrivals-times-row');
  await memberPage.locator('.arrivals-times-row', { hasText: MEMBER_NAME }).waitFor();
  assert.equal(
    await memberPage.locator('.arrivals-times-row', { hasText: OUTSIDER_NAME }).count(),
    0,
    'the times table skips accounts that never accepted this event',
  );
  // The manager runs this event without attending it (the roster above reads
  // "1 Zusage"), so they are no more part of the times table than a stranger.
  assert.equal(
    await memberPage.locator('.arrivals-times-row', { hasText: OWNER_NAME }).count(),
    0,
    'managing an event is not the same as having accepted it',
  );
  assert.equal(
    await memberPage.locator('.arrivals-times-row').count(),
    1,
    'the sole accepted participant is the only row in the times table',
  );
  await memberPage.evaluate(() => window.dispatchEvent(new CustomEvent('respawn:navigate', { detail: 'events' })));
  await memberPage.waitForSelector('#view-container[data-view="events"]');
  await memberPage.locator(`[data-event-card="${eventId}"]`).waitFor();

  await ownerPage.locator('.modal-backdrop [data-close]').click();
  await ownerPage.click(`[data-participants-event="${eventId}"]`);
  const memberRow = ownerPage.locator('.modal-backdrop .event-participant-manager-row', { hasText: MEMBER_NAME });
  await memberRow.waitFor();
  assert.match((await memberRow.textContent()) ?? '', /Zugesagt/);
  const creatorPaymentButton = memberRow.locator(`[data-modal-toggle-event-paid="${memberId}"]`);
  assert.equal(await creatorPaymentButton.getAttribute('aria-pressed'), 'true');
  assert.equal(await creatorPaymentButton.textContent(), 'Bezahlt');
  assert.ok(((await memberRow.textContent()) ?? '').includes(`Bezahlt von ${MEMBER_NAME}`));
  assert.doesNotMatch((await memberRow.textContent()) ?? '', /Zahlung zuerst zurücksetzen/);
  const lockedRemoveButton = memberRow.locator('[data-remove-participant]');
  assert.equal(await lockedRemoveButton.getAttribute('disabled'), null);
  assert.equal(await lockedRemoveButton.isDisabled(), true);
  assert.equal(await lockedRemoveButton.getAttribute('aria-disabled'), 'true');
  assert.equal(await lockedRemoveButton.getAttribute('aria-describedby'), null);
  await lockedRemoveButton.evaluate((button) => (button as HTMLButtonElement).click());
  assert.equal(
    await ownerPage.locator('.modal-backdrop', { hasText: 'Teilnehmer entfernen' }).count(),
    0,
    'the aria-disabled removal action does not open its destructive confirmation',
  );
  await creatorPaymentButton.click();
  await memberPage.locator(`[data-event-card="${eventId}"] .event-card-payment-member [data-toggle-event-paid][aria-pressed="false"]`).waitFor();
  assert.equal(await ownerPage.locator('.modal-backdrop [data-mark-all-event-paid]').count(), 0);
  await creatorPaymentButton.click();
  await memberPage.locator(`[data-event-card="${eventId}"] .event-card-payment-member [data-toggle-event-paid][aria-pressed="true"]`).waitFor();
  await memberRow.locator('.event-payment-proof', { hasText: `Bezahlt von ${OWNER_NAME}` }).waitFor();
  assert.match((await memberRow.textContent()) ?? '', new RegExp(`Bezahlt von ${OWNER_NAME}`));

  await creatorPaymentButton.click();
  await memberPage.locator(`[data-event-card="${eventId}"] .event-card-payment-member [data-toggle-event-paid][aria-pressed="false"]`).waitFor();
  await ownerPage.locator('.modal-backdrop [data-close]').click();

  if ((await ownerParticipantList.getAttribute('open')) === null) await ownerParticipantList.locator('summary').click();
  let cardPaymentButton = ownerParticipantList.locator(`[data-toggle-event-paid="${eventId}"][data-payment-player="${memberId}"]`);
  await cardPaymentButton.click();
  await ownerPage.waitForFunction(
    ([expectedEventId, expectedPlayerId]) => {
      const button = Array.from(document.querySelectorAll<HTMLElement>('[data-toggle-event-paid]')).find(
        (candidate) =>
          candidate.dataset.toggleEventPaid === expectedEventId && candidate.dataset.paymentPlayer === expectedPlayerId,
      );
      return button?.getAttribute('aria-pressed') === 'true' && document.activeElement === button;
    },
    [eventId, memberId],
  );
  cardPaymentButton = ownerParticipantList.locator(`[data-toggle-event-paid="${eventId}"][data-payment-player="${memberId}"]`);
  assert.equal(await cardPaymentButton.getAttribute('aria-pressed'), 'true');
  assert.equal(await cardPaymentButton.textContent(), 'Bezahlt');
  assert.equal(
    await cardPaymentButton.evaluate((button) => document.activeElement === button),
    true,
    'the card payment toggle restores focus after its realtime rerender',
  );
  await cardPaymentButton.click();
  await memberPage.locator(`[data-event-card="${eventId}"] .event-card-payment-member [data-toggle-event-paid][aria-pressed="false"]`).waitFor();
  await ownerParticipantList.locator(`[data-toggle-event-paid="${eventId}"][data-payment-player="${memberId}"][aria-pressed="false"]`).waitFor();
  assert.equal(
    await ownerParticipantList.locator(`[data-toggle-event-paid="${eventId}"][data-payment-player="${memberId}"]`).textContent(),
    'Bezahlt?',
  );

  const noPaypalRefresh = memberPage.waitForResponse(
    (response) => response.request().method() === 'GET' && response.url() === `${BASE_URL}/api/events`,
  );
  assert.equal(
    (await ownerPage.request.patch(`${BASE_URL}/api/events/${eventId}`, { data: { paypalLink: null } })).status(),
    200,
  );
  await noPaypalRefresh;
  await memberEventCard.locator('[data-pay-event]').waitFor({ state: 'detached' });
  assert.equal(await memberEventCard.locator('[data-pay-event]').count(), 0);
  const ownPaymentToggle = memberEventCard.locator('.event-card-payment-member [data-toggle-event-paid]');
  assert.equal(await ownPaymentToggle.count(), 1, 'payment can still be recorded without a PayPal destination');
  await ownPaymentToggle.click();
  await memberEventCard.locator('.event-card-payment-member [data-toggle-event-paid][aria-pressed="true"]').waitFor();
  await memberEventCard.locator('.event-card-payment-member [data-toggle-event-paid]').click();
  await memberEventCard.locator('.event-card-payment-member [data-toggle-event-paid][aria-pressed="false"]').waitFor();

  const genericPaypalLink = 'https://www.paypal.com/myaccount/transfer/homepage/pay?recipient=orga%40example.com';
  const memberPaymentRefresh = memberPage.waitForResponse(
    (response) => response.request().method() === 'GET' && response.url() === `${BASE_URL}/api/events`,
  );
  const genericPaypalUpdate = await ownerPage.request.patch(`${BASE_URL}/api/events/${eventId}`, {
    data: { paypalLink: genericPaypalLink },
  });
  assert.equal(genericPaypalUpdate.status(), 200, await genericPaypalUpdate.text());
  await memberPaymentRefresh;
  await memberPage.evaluate(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText(value: string) {
          (window as unknown as { __copiedEventPaypal?: string }).__copiedEventPaypal = value;
          return Promise.resolve();
        },
      },
    });
    window.open = (() => {
      const fake = {
        opener: window,
        closed: false,
        _location: '',
        get location() { return this._location; },
        set location(value: string) { this._location = value; },
        close() { this.closed = true; },
      };
      (window as unknown as { __eventPaymentPopup: typeof fake }).__eventPaymentPopup = fake;
      return fake as unknown as Window;
    }) as typeof window.open;
  });
  await memberEventCard.locator(`[data-pay-event="${eventId}"]`).click();
  await memberPage.locator('.modal-backdrop', { hasText: 'Bezahlt?' }).waitFor();
  assert.equal(
    await memberPage.evaluate(() => (window as unknown as { __copiedEventPaypal?: string }).__copiedEventPaypal),
    'orga@example.com',
  );
  assert.deepEqual(
    await memberPage.evaluate(() => {
      const popup = (window as unknown as { __eventPaymentPopup: { location: string; opener: unknown } }).__eventPaymentPopup;
      return { location: popup.location, opener: popup.opener };
    }),
    { location: genericPaypalLink, opener: null },
  );
  assert.match((await memberPage.locator('.modal-body').textContent()) ?? '', /25,50.*selbst eintragen/);
  await memberPage.locator('.modal-backdrop [data-cancel]').last().click();

  await memberPage.evaluate(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText() {
          return Promise.reject(new DOMException('Document is not focused', 'NotAllowedError'));
        },
      },
    });
  });
  await memberEventCard.locator(`[data-pay-event="${eventId}"]`).click();
  const clipboardFallbackToast = memberPage.locator('.toast', {
    hasText: 'PayPal-Adresse nicht kopiert. Empfänger: orga@example.com',
  }).last();
  await clipboardFallbackToast.waitFor();
  assert.equal(await clipboardFallbackToast.evaluate((toast) => toast.classList.contains('toast-error')), false);
  const clipboardFallbackDialog = memberPage.locator('.modal-backdrop', { hasText: 'Bezahlt?' });
  await clipboardFallbackDialog.waitFor();
  assert.match((await clipboardFallbackDialog.locator('.modal-body').textContent()) ?? '', /Empfänger:\s*orga@example\.com/);
  assert.match((await clipboardFallbackDialog.locator('.modal-body').textContent()) ?? '', /25,50.*selbst eintragen/);
  await clipboardFallbackDialog.locator('[data-cancel]', { hasText: 'Noch nicht' }).click();

  const ownPaidToggle = memberEventCard.locator('.event-card-payment-member [data-toggle-event-paid]');
  await ownPaidToggle.click();
  await memberEventCard.locator('.event-card-payment-member [data-toggle-event-paid][aria-pressed="true"]').waitFor();
  const clearedContributionRefresh = memberPage.waitForResponse(
    (response) => response.request().method() === 'GET' && response.url() === `${BASE_URL}/api/events`,
  );
  const clearedContribution = await ownerPage.request.patch(`${BASE_URL}/api/events/${eventId}`, {
    data: { costCents: null, paypalLink: null, paymentDueAt: null },
  });
  assert.equal(clearedContribution.status(), 200, await clearedContribution.text());
  await clearedContributionRefresh;
  const paidWithoutContribution = memberEventCard.locator('.event-card-payment-member', { hasText: 'Nicht festgelegt' });
  await paidWithoutContribution.waitFor();
  const resetWithoutContribution = paidWithoutContribution.locator('[data-toggle-event-paid]');
  assert.equal(await resetWithoutContribution.getAttribute('aria-pressed'), 'true');
  await resetWithoutContribution.click();
  await paidWithoutContribution.waitFor({ state: 'detached' });

  const restoredContributionRefresh = memberPage.waitForResponse(
    (response) => response.request().method() === 'GET' && response.url() === `${BASE_URL}/api/events`,
  );
  const restoredContribution = await ownerPage.request.patch(`${BASE_URL}/api/events/${eventId}`, {
    data: { costCents: 2550, paypalLink: genericPaypalLink },
  });
  assert.equal(restoredContribution.status(), 200, await restoredContribution.text());
  await restoredContributionRefresh;
  await memberEventCard.locator('.event-card-payment-member [data-toggle-event-paid][aria-pressed="false"]').waitFor();

  const memberEndedRefresh = memberPage.waitForResponse(
    (response) => response.request().method() === 'GET' && response.url() === `${BASE_URL}/api/events`,
  );
  await ownerPage.click(`[data-end-event="${eventId}"]`);
  await ownerPage.click('[data-confirm]');
  // A finished event moves into the collapsed "Historie" section (see
  // events.js's renderEventSection): open it before interacting with its
  // now-hidden card actions.
  await ownerPage.locator('[data-event-history] > summary').click();
  await ownerPage.waitForSelector(`[data-restart-event="${eventId}"]`);

  // The same Historie collapse applies to a plain member's own event list —
  // sourced from its own `endedEvents` field (see routes/events.ts) since
  // `availableEvents` deliberately excludes ended events entirely.
  await memberEndedRefresh;
  await memberPage.locator('[data-event-history] > summary').click();
  await memberEventCard.waitFor();

  await ownerPage.click(`[data-participants-event="${eventId}"]`);
  assert.equal(await ownerPage.locator('.modal-backdrop [data-invite-participant]').count(), 0);
  const endedEventNote = ownerPage.locator('.modal-backdrop .event-participants-note');
  assert.equal(await endedEventNote.count(), 1);
  assert.match((await endedEventNote.textContent()) ?? '', /keine neuen Einladungen mehr möglich/);
  await ownerPage.locator('.modal-backdrop [data-close]').click();

  await ownerPage.click(`[data-restart-event="${eventId}"]`);
  await ownerPage.click('[data-confirm]');
  await ownerPage.waitForSelector(`[data-stop-tracking="${eventId}"]`);
});
