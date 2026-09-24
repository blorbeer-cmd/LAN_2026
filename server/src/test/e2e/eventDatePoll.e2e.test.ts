import { before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { ChildProcess } from 'child_process';
import { chromium, Browser, Locator, Page } from 'playwright';
import { finishE2EOnboarding } from './authHelpers';
import { createE2EDiagnosticTest } from './e2eDiagnostics';
import { startE2EServer, type E2EServer } from './e2eServer';

let BASE_URL: string;
const RECOVERY_CODE = 'event-polls-e2e-recovery';
const OWNER_NAME = 'E2E Poll Owner';
const OWNER_PASSWORD = 'e2e poll owner secure passphrase';
const MEMBER_NAME = 'E2E Poll Member';
const MEMBER_PASSWORD = 'e2e poll member secure passphrase';
const EVENT_NAME = 'LAN Umfragen E2E';

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
  { title, options, mode = 'feasibility', anonymous = false, hideLiveResults = true, maxSelections, withoutDeadline = false }: {
    title: string;
    options: Array<string | { label: string; description?: string; url?: string; active?: boolean }>;
    mode?: 'feasibility' | 'single_choice' | 'multiple_choice' | 'rating_1_5';
    maxSelections?: number;
    anonymous?: boolean;
    hideLiveResults?: boolean;
    withoutDeadline?: boolean;
  },
): Promise<void> {
  await page.click('#new-event-poll');
  await page.waitForSelector('#event-poll-form');
  assert.equal(await page.getByText('2 bis 8', { exact: true }).count(), 0);
  assert.equal(await page.locator('#poll-max').getAttribute('max'), null);
  await page.fill('#poll-title', title);
  await page.selectOption('#poll-mode', mode);
  if (anonymous) await page.check('#poll-anonymous');
  assert.equal(await page.locator('#poll-hide-live-results').isChecked(), true, 'a new round hides its interim result by default');
  if (!hideLiveResults) await page.uncheck('#poll-hide-live-results');
  if (withoutDeadline) await page.locator('[data-dt-field="poll-due"] [data-dt-clear]').click();
  if (maxSelections !== undefined) await page.fill('#poll-max', String(maxSelections));
  while ((await page.locator('[data-poll-option-input]').count()) > options.length) {
    await page.locator('[data-remove-poll-option]').last().click();
  }
  while ((await page.locator('[data-poll-option-input]').count()) < options.length) await page.click('#poll-add-option');
  assert.equal(await page.locator('#event-poll-form [role="switch"]').count(), options.length);
  assert.deepEqual(await page.locator('#event-poll-form [role="switch"]').evaluateAll(
    (switches) => switches.map((element) => (element as HTMLInputElement).checked),
  ), options.map(() => true), 'new options are votable by default');
  for (let index = 0; index < options.length; index += 1) {
    const rawOption = options[index];
    const option = typeof rawOption === 'string' ? { label: rawOption } : rawOption;
    await page.locator('[data-poll-option-input]').nth(index).fill(option.label);
    if (option.active === false) await page.locator('[data-poll-option-active]').nth(index).uncheck();
    if (option.description || option.url) {
      const extraToggle = page.locator('[data-poll-option-row]').nth(index).locator('[data-toggle-option-extra]');
      if ((await extraToggle.getAttribute('aria-expanded')) !== 'true') await extraToggle.click();
      if (option.description) await page.locator('[data-poll-option-note]').nth(index).fill(option.description);
      if (option.url) await page.locator('[data-poll-option-url]').nth(index).fill(option.url);
    }
  }
  await page.click('#event-poll-form button[type="submit"]');
  await page.waitForSelector('#event-poll-form', { state: 'detached' });
}

async function choosePollAction(poll: Locator, selector: string): Promise<void> {
  // „Beenden“ and „Neue Runde“ are compact header buttons; everything else
  // lives in the card's „Aktion“ menu.
  const headerAction = poll.locator(`.event-poll-card-side > ${selector}`);
  if (await headerAction.count()) {
    await headerAction.click();
    return;
  }
  const menu = poll.locator('.action-menu');
  if (!(await menu.evaluate((details) => (details as HTMLDetailsElement).open))) await menu.locator('summary').click();
  await menu.locator(selector).click();
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
  const participantHandoff = ownerPage.locator('.event-card', { hasText: EVENT_NAME }).locator('[data-event-participants][open]');
  await participantHandoff.waitFor();
  assert.match((await ownerPage.locator('.toast').last().textContent()) ?? '', /Jetzt Teilnehmende einladen/);
  assert.equal(await ownerPage.locator('.modal-backdrop').count(), 0, 'creation opens the inline roster');
  const eventCard = ownerPage.locator('.event-card', { hasText: EVENT_NAME });
  await eventCard.waitFor();
  const eventId = (await eventCard.getAttribute('data-event-card')) as string;

  await eventCard.locator('.action-menu > summary').click();
  await eventCard.locator('[data-edit-event]').click();
  const editEventModal = ownerPage.locator('.modal-backdrop', { hasText: 'Event bearbeiten' });
  await editEventModal.waitFor();
  assert.equal(await editEventModal.locator('#event-starts-date:disabled').count(), 0, 'an undated event can receive its period later');
  await editEventModal.locator('#event-starts-date').fill('08072027');
  await editEventModal.locator('#event-starts-time').fill('1200');
  await editEventModal.locator('#event-ends-date').fill('10.07.2027');
  await editEventModal.locator('#event-ends-time').fill('1600');
  await editEventModal.locator('#event-form button[type="submit"]').click();
  await editEventModal.waitFor({ state: 'detached' });
  await ownerPage.waitForFunction((name) => {
    const card = Array.from(document.querySelectorAll('.event-card')).find((candidate) => candidate.textContent?.includes(name));
    return card?.textContent?.includes('8.7.2027') && card?.textContent?.includes('10.7.2027');
  }, EVENT_NAME);

  const memberId = await currentPlayerId(memberPage);
  // The owner created this event and is therefore already an accepted
  // participant; only the member still needs an invitation.
  await invitePlayer(ownerPage, eventId, memberId);
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
  assert.equal(await ownerPage.locator('#new-event-poll').textContent(), 'Umfrage starten');

  await createPoll(ownerPage, {
    title: 'Welcher Zeitraum passt?',
    options: ['Erstes Wochenende', 'Zweites Wochenende'],
    withoutDeadline: true,
  });
  const ownerPoll = ownerPage.locator('[data-poll-group]', { hasText: 'Welcher Zeitraum passt?' });
  await ownerPoll.waitFor();
  assert.doesNotMatch(await ownerPoll.locator('.event-poll-card-title').innerText(), /Frist/, 'an undated round names no deadline');
  assert.match(await ownerPoll.locator('.event-poll-answer-side').innerText(), /Deine Antwort fehlt/, 'the header says the viewer still has to answer');
  assert.doesNotMatch(await ownerPoll.innerText(), /01\.01\.1970/);
  await ownerPoll.locator('[data-toggle-poll]').click();
  assert.equal(await ownerPoll.locator('[data-poll-round]:visible').count(), 0, 'the poll can be collapsed');
  assert.equal(await ownerPoll.locator('.action-menu > summary:visible').count(), 1, 'management actions stay available in one collapsed-header menu');
  await ownerPoll.locator('.action-menu > summary').click();
  assert.equal(await ownerPoll.locator('[data-remind-poll]:visible').count(), 1);
  assert.equal(await ownerPoll.locator('[data-close-poll]:visible').count(), 1);
  assert.equal(await ownerPoll.locator('[data-delete-poll]:visible').count(), 1);
  await ownerPoll.locator('.action-menu > summary').click();
  await ownerPoll.locator('[data-toggle-poll]').click();
  assert.equal(await ownerPoll.locator('[data-poll-response="can"]').count(), 2);
  assert.equal(await ownerPoll.locator('[data-poll-response="if_needed"]').count(), 2);
  assert.equal(await ownerPoll.locator('[data-poll-response="cannot"]').count(), 2);
  assert.equal(await ownerPoll.locator('[data-poll-response="open"]').count(), 0, '„offen“ is no answer button of its own');
  assert.equal(await ownerPoll.locator('.event-poll-progress').count(), 0, 'progress and deadline are not repeated above the options');
  const ownerOptions = ownerPoll.locator('.event-poll-option');
  await ownerOptions.nth(0).locator('[data-poll-response="cannot"]').click();
  await ownerOptions.nth(0).locator('[data-poll-response="cannot"]').click();
  assert.equal(await ownerOptions.nth(0).locator('[aria-pressed="true"]').count(), 0, 'choosing the current answer again clears it back to „offen“');
  await ownerOptions.nth(0).locator('[data-poll-response="can"]').click();
  await ownerOptions.nth(1).locator('[data-poll-response="can"]').click();
  assert.match(await ownerPoll.locator('.event-poll-footer').innerText(), /2 von 2 bewertet/);
  await ownerPoll.locator('[data-save-poll]').click();
  await ownerPage.locator('.toast', { hasText: 'Antwort gespeichert' }).waitFor();
  await ownerPoll.locator('.event-poll-answer-side', { hasText: 'Beantwortet' }).waitFor();

  await navigate(memberPage, 'eventPolls');
  const memberPoll = memberPage.locator('[data-poll-group]', { hasText: 'Welcher Zeitraum passt?' });
  await memberPoll.waitFor();
  assert.match(await memberPoll.locator('.event-poll-answer-inline').innerText(), /Deine Antwort fehlt/, 'phones show the answer state in the meta line');
  const memberOptions = memberPoll.locator('.event-poll-option');
  await memberOptions.nth(0).locator('[data-poll-response="can"]').tap();
  await memberOptions.nth(1).locator('[data-poll-response="cannot"]').tap();
  await memberPoll.locator('[data-save-poll]').tap();
  await memberPage.locator('.toast', { hasText: 'Antwort gespeichert' }).waitFor();
  assert.equal(await memberPage.locator('[data-participation]').count(), 0, 'attendance is not managed in the poll tab');
  assert.match(await memberPoll.innerText(), /Zwischenstand verborgen/, 'the round says once that its interim result is withheld');
  assert.equal(await memberPoll.locator('[data-view-poll-votes]').count(), 0, 'a withheld interim result names nobody else');
  assert.equal(await memberPoll.locator('.event-poll-counts').count(), 0, 'the withheld interim result shows no counts either');
  assert.equal(await memberPoll.locator('.event-poll-bar').count(), 0, 'nor a result bar');

  await ownerPage.reload();
  await ownerPage.waitForSelector('#app:not([hidden])');
  await navigate(ownerPage, 'eventPolls');
  const refreshed = ownerPage.locator('[data-poll-group]', { hasText: 'Welcher Zeitraum passt?' });
  await refreshed.waitFor();
  // The creator keeps the interim result: avatars beside the option open the
  // same dialog the round publishes to everyone once it ends.
  assert.match(await refreshed.innerText(), /Zwischenstand nur für dich/);
  const liveStack = refreshed.locator('.event-poll-option').first().locator('.event-poll-voter-stack');
  const singleVoterStack = refreshed.locator('.event-poll-option').nth(1).locator('.event-poll-voter-stack');
  await liveStack.waitFor();
  await singleVoterStack.waitFor();
  assert.equal(await refreshed.locator('.badge-online').count(), 0, 'a running round names no leader');
  const liveStackLabel = (await liveStack.getAttribute('aria-label')) ?? '';
  assert.match(liveStackLabel, /· Passt: /);
  assert.match(liveStackLabel, new RegExp(OWNER_NAME));
  assert.match(liveStackLabel, new RegExp(MEMBER_NAME));
  assert.equal(await liveStack.locator('.avatar-dot, .avatar-img').count(), 2);
  assert.equal(await singleVoterStack.locator('.avatar-dot, .avatar-img').count(), 1);
  const voterStackGeometry = (stack: typeof liveStack) => stack.evaluate((element) => {
    const option = element.closest('.event-poll-option')!;
    const avatars = element.querySelectorAll('.avatar-dot, .avatar-img');
    const first = avatars.item(0).getBoundingClientRect();
    const last = avatars.item(avatars.length - 1).getBoundingClientRect();
    const stackBox = element.getBoundingClientRect();
    const bar = option.querySelector('.event-poll-bar')!.getBoundingClientRect();
    const controls = option.querySelector('.event-poll-response-toolbar')!.getBoundingClientRect();
    const middle = (box: DOMRect) => (box.top + box.bottom) / 2;
    return {
      stackWidth: stackBox.width,
      stackHeight: stackBox.height,
      avatarWidth: last.width,
      stackContentLeftInset: first.left - stackBox.left,
      stackContentRightInset: stackBox.right - last.right,
      avatarLeft: first.left,
      avatarToBarMiddle: Math.abs(middle(first) - middle(bar)),
      avatarToControlsMiddle: Math.abs(middle(first) - middle(controls)),
    };
  });
  await ownerPage.setViewportSize({ width: 390, height: 844 });
  const mobileStack = await voterStackGeometry(liveStack);
  const mobileSingleStack = await voterStackGeometry(singleVoterStack);
  assert.ok(mobileStack.stackWidth >= 44 && mobileStack.stackHeight >= 32, `the multi-voter stack keeps a comfortable tap target (${JSON.stringify(mobileStack)})`);
  assert.equal(mobileSingleStack.stackWidth, 44, `the single-voter stack keeps the minimum width (${JSON.stringify(mobileSingleStack)})`);
  assert.ok(mobileStack.stackContentRightInset <= 1 && mobileSingleStack.stackContentRightInset <= 1, `mobile avatars align to the right of the title line (${JSON.stringify({ mobileStack, mobileSingleStack })})`);
  await ownerPage.setViewportSize({ width: 1024, height: 800 });
  const desktopStack = await voterStackGeometry(liveStack);
  const desktopSingleStack = await voterStackGeometry(singleVoterStack);
  assert.equal(desktopStack.avatarWidth, 24, `voter avatars remain clearly visible (${JSON.stringify(desktopStack)})`);
  assert.ok(desktopStack.stackContentLeftInset <= 1 && desktopSingleStack.stackContentLeftInset <= 1, `desktop avatars start at their column edge (${JSON.stringify({ desktopStack, desktopSingleStack })})`);
  assert.ok(Math.abs(desktopStack.avatarLeft - desktopSingleStack.avatarLeft) <= 1, `avatars of different rows share one left edge (${JSON.stringify({ desktopStack, desktopSingleStack })})`);
  assert.ok(desktopStack.avatarToBarMiddle <= 1 && desktopStack.avatarToControlsMiddle <= 1, `bar, avatars and answers share one middle line (${JSON.stringify(desktopStack)})`);
  await liveStack.click();
  const liveVoteDialog = ownerPage.locator('.modal-backdrop', { hasText: 'Stimmen · Welcher Zeitraum passt?' });
  await liveVoteDialog.waitFor();
  assert.match((await liveVoteDialog.textContent()) ?? '', new RegExp(MEMBER_NAME));
  await liveVoteDialog.locator('[data-close]').click();
  await liveVoteDialog.waitFor({ state: 'detached' });
  await choosePollAction(refreshed, '[data-close-poll]');
  await ownerPage.locator('.modal-backdrop [data-confirm]').click();
  await ownerPage.locator('.toast', { hasText: 'Umfrage beendet' }).waitFor();
  await ownerPage.locator('.event-poll-ended-history').evaluate((details) => {
    (details as HTMLDetailsElement).open = true;
    details.dispatchEvent(new Event('toggle'));
  });
  const closed = ownerPage.locator('[data-poll-group]', { hasText: 'Welcher Zeitraum passt?' });
  assert.match((await closed.locator('.event-poll-best-result').textContent()) ?? '', /Win\s*Erstes Wochenende/, 'the collapsed card includes the winning option');
  await choosePollAction(closed, '[data-view-poll-votes]');
  const voteDialog = ownerPage.locator('.modal-backdrop', { hasText: 'Stimmen · Welcher Zeitraum passt?' });
  await voteDialog.waitFor();
  assert.match((await voteDialog.textContent()) ?? '', new RegExp(MEMBER_NAME));
  assert.match((await voteDialog.textContent()) ?? '', /\d{2}:\d{2}/, 'the vote dialog shows when the response was saved');
  const voterAvatar = voteDialog.locator('.event-poll-vote-person .avatar-dot, .event-poll-vote-person .avatar-img').first();
  const voterName = voteDialog.locator('.event-poll-voter-name').first();
  const voterAlignment = await voteDialog.locator('.event-poll-vote-person .player-name').first().evaluate((element) => {
    const styles = getComputedStyle(element);
    return { display: styles.display, alignItems: styles.alignItems };
  });
  assert.ok(voterAlignment.display.includes('flex') && voterAlignment.alignItems === 'center', 'the voter identity uses a centered flex row');
  assert.equal(await voterAvatar.count(), 1);
  assert.equal(await voterName.count(), 1);
  await voteDialog.locator('[data-close]').click();
  assert.equal(await closed.locator('.event-poll-option.is-winner .vote-win-chip').count(), 1, 'the ended round marks its winner');
  assert.match((await closed.locator('.event-poll-option').first().textContent()) ?? '', /Erstes Wochenende/, 'the ended round lists its options by result');
  assert.equal(await closed.locator('[data-decide-poll]').count(), 0, 'the closed counts are the result; there is no second decision step');
  await choosePollAction(closed, '[data-new-poll-round]');
  await ownerPage.waitForSelector('#event-poll-form');
  await ownerPage.click('#event-poll-form button[type="submit"]');
  await ownerPage.waitForSelector('#event-poll-form', { state: 'detached' });
  await ownerPage.waitForFunction(() => {
    const poll = Array.from(document.querySelectorAll('[data-poll-group]')).find((element) => element.textContent?.includes('Welcher Zeitraum passt?'));
    return poll?.textContent?.includes('Runde 2');
  });
  const repeated = ownerPage.locator('[data-poll-group]', { hasText: 'Welcher Zeitraum passt?' });
  const previousRounds = repeated.locator('.event-poll-history');
  if (!(await previousRounds.evaluate((details) => (details as HTMLDetailsElement).open))) await previousRounds.locator(':scope > summary').click();
  const previousRoundText = (await previousRounds.locator('.event-poll-history-round').textContent()) ?? '';
  assert.match(previousRoundText, /Runde 1 · \d{2}\.\d{2}\. · 2\/2 beantwortet/, 'the earlier round is one compact row');
  assert.match(previousRoundText, /Win\s*Erstes Wochenende/, 'the earlier round exposes its winner directly');
  assert.doesNotMatch(previousRoundText, /01\.01\.1970/);
  await previousRounds.locator('.event-poll-history-round [data-view-poll-votes]').click();
  const previousRoundDialog = ownerPage.locator('.modal-backdrop', { hasText: 'Stimmen · Welcher Zeitraum passt? · Runde 1' });
  await previousRoundDialog.waitFor();
  await previousRoundDialog.locator('[data-close]').click();
  await previousRoundDialog.waitFor({ state: 'detached' });
  assert.match(await repeated.locator('.event-poll-card-title').innerText(), /Frist \d{2}\.\d{2}\./, 'the new dated round still displays its deadline');

  await createPoll(memberPage, {
    title: 'Welche Verpflegung?',
    mode: 'multiple_choice',
    maxSelections: 2,
    options: ['Pizza', 'Curry', 'Salat'],
  });
  const memberCreated = memberPage.locator('[data-poll-group]', { hasText: 'Welche Verpflegung?' });
  await memberCreated.waitFor();
  await memberPage.waitForFunction(() => {
    const poll = Array.from(document.querySelectorAll('[data-poll-group]')).find((element) => element.textContent?.includes('Welcher Zeitraum passt?'));
    return poll?.textContent?.includes('Runde 2');
  });
  assert.equal(await memberCreated.locator('[data-poll-choice]').count(), 3, 'a regular participant can create a poll');
  assert.deepEqual(
    await memberCreated.locator('[data-poll-choice]').allTextContents(),
    ['Wählen', 'Wählen', 'Wählen'],
  );
  await memberCreated.locator('[data-poll-choice]').first().tap();
  const pollViewport = memberPage.locator('#view-container');
  await pollViewport.evaluate((element) => { element.scrollTop = element.scrollHeight; });
  const savePollButton = memberCreated.locator('[data-save-poll]');
  await savePollButton.evaluate((button) => button.addEventListener('pointerdown', () => {
    const card = button.closest('[data-poll-group]');
    if (!card) return;
    const rect = card.getBoundingClientRect();
    const testWindow = window as typeof window & { __eventPollBeforeSave?: { top: number; height: number } };
    testWindow.__eventPollBeforeSave = { top: rect.top, height: rect.height };
  }, { once: true }));
  await savePollButton.tap();
  await memberPage.locator('.toast', { hasText: 'Antwort gespeichert' }).waitFor();
  const beforeSave = await memberPage.evaluate(() => {
    const testWindow = window as typeof window & { __eventPollBeforeSave?: { top: number; height: number } };
    return testWindow.__eventPollBeforeSave;
  });
  assert.ok(beforeSave, 'the poll position was captured at the actual tap');
  await memberPage.waitForTimeout(300);
  const afterSaveTop = await memberCreated.evaluate((element) => element.getBoundingClientRect().top);
  const afterSaveHeight = await memberCreated.evaluate((element) => element.getBoundingClientRect().height);
  assert.ok(
    Math.abs(afterSaveTop - beforeSave.top) <= 24,
    `saving keeps the visible poll anchored instead of jumping to the top (${beforeSave.top}/${beforeSave.height} -> ${afterSaveTop}/${afterSaveHeight})`,
  );
  assert.deepEqual(await memberCreated.locator('[data-poll-choice]').allTextContents(), ['Ausgewählt', 'Wählen', 'Wählen']);
  assert.equal(await memberCreated.locator('.badge', { hasText: 'Meiste Stimmen' }).count(), 0, 'a running round names no leader');
  const compactOptionHeight = (await memberCreated.locator('.event-poll-option').first().boundingBox())!.height;
  assert.ok(compactOptionHeight < 130, `choice options stay compact (${compactOptionHeight}px)`);
  // Flat rows drop the outer padding of the first and last row, so compare the
  // content height each row needs.
  const optionHeights = await memberCreated.locator('.event-poll-option').evaluateAll((options) => options.map((option) => {
    const style = getComputedStyle(option);
    return option.getBoundingClientRect().height - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom);
  }));
  assert.ok(Math.max(...optionHeights) - Math.min(...optionHeights) <= 1, `voters do not change option height (${optionHeights.join('/')})`);

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
    'the saved answer and counts reconcile to the same server response',
  );
  assert.equal(await memberCreated.locator('[data-poll-choice]').nth(1).locator('.ui-icon').count(), 0, 'the compact selected action has no redundant check icon');

  await choosePollAction(memberCreated, '[data-edit-poll]');
  await memberPage.waitForSelector('#event-poll-edit-form');
  assert.equal(await memberPage.locator('#event-poll-edit-form [data-poll-option-id] [data-remove-poll-option]').count(), 3);
  const firstEditOption = memberPage.locator('#event-poll-edit-form [data-poll-option-row]').first();
  await firstEditOption.locator('[data-toggle-option-extra]').click();
  await firstEditOption.locator('[data-poll-option-note]').fill('Auch vegetarisch verfügbar');
  await firstEditOption.locator('[data-poll-option-url]').fill('https://example.com/pizza');
  const secondEditOption = memberPage.locator('#event-poll-edit-form [data-poll-option-row]').nth(1);
  await secondEditOption.locator('[data-toggle-option-extra]').click();
  await secondEditOption.locator('[data-poll-option-note]').fill('Weitere Variante');
  await memberPage.click('#event-poll-edit-form #poll-add-option');
  await memberPage.locator('#event-poll-edit-form [data-poll-option-input]').last().fill('Dessert');
  assert.equal(await memberPage.locator('#event-poll-edit-form [data-poll-option-row]').last().locator('[role="switch"]').isChecked(), true);
  await memberPage.click('#event-poll-edit-form button[type="submit"]');
  await memberPage.locator('.toast', { hasText: 'Personen mit geänderter Antwort wurden informiert' }).waitFor();
  await memberPage.waitForFunction(() => {
    const poll = Array.from(document.querySelectorAll('[data-poll-group]')).find((element) => element.textContent?.includes('Welche Verpflegung?'));
    return poll?.querySelectorAll('.event-poll-option').length === 4;
  });
  assert.equal(await memberCreated.locator('a[href="https://example.com/pizza"]').count(), 1);
  assert.equal(await memberCreated.locator('.event-poll-option-note', { hasText: 'Auch vegetarisch verfügbar' }).count(), 1, 'an option note is a visible line');
  assert.equal(await memberCreated.locator('.event-poll-option').first()
    .locator('.event-poll-option-title-row strong + .badge', { hasText: 'Bearbeitet' }).count(), 1);
  assert.equal(await memberCreated.locator('.event-poll-option').nth(1)
    .locator('.event-poll-option-title-row strong + .badge', { hasText: 'Bearbeitet' }).count(), 1);
  await choosePollAction(memberCreated, '[data-edit-poll]');
  await memberPage.waitForSelector('#event-poll-edit-form');
  assert.equal(await memberPage.locator('#event-poll-edit-form [data-poll-option-row] .badge', { hasText: 'Bearbeitet' }).count(), 0);
  assert.equal(await memberPage.locator('#event-poll-edit-form [role="switch"]').count(), 4);
  assert.equal(await memberPage.locator('#event-poll-edit-form [data-poll-option-row]').nth(1)
    .locator('.event-poll-form-option-main > [data-poll-option-input] ~ [role="switch"]').count(), 1);
  await memberPage.locator('#event-poll-edit-form [data-poll-option-row]').first().locator('[data-poll-option-active]').uncheck();
  await memberPage.locator('#event-poll-edit-form [data-poll-option-row]').nth(1).locator('[data-remove-poll-option]').click();
  assert.deepEqual(await memberPage.locator('#event-poll-edit-form [data-poll-option-input]').evaluateAll(
    (inputs) => inputs.map((input) => input.getAttribute('aria-label'))), ['Option 1', 'Option 2', 'Option 3']);
  assert.equal(await memberPage.locator('#event-poll-edit-form [data-poll-option-row]').nth(1)
    .locator('[data-poll-option-active]').getAttribute('aria-label'), 'Option 2 wählbar');
  await memberPage.click('#event-poll-edit-form button[type="submit"]');
  await memberPage.locator('.modal-backdrop [data-confirm]').click();
  await memberPage.waitForFunction(() => {
    const poll = Array.from(document.querySelectorAll('[data-poll-group]')).find((element) => element.textContent?.includes('Welche Verpflegung?'));
    return poll?.querySelectorAll('.event-poll-option').length === 3;
  });
  assert.equal(await memberCreated.locator('.event-poll-option').first().locator('.badge', { hasText: 'Deaktiviert' }).count(), 1);
  assert.equal(await memberCreated.locator('.event-poll-option').first().locator('[data-poll-choice]').count(), 0);
  assert.doesNotMatch((await memberCreated.locator('.event-poll-option').first().locator('.event-poll-counts').textContent()) ?? '', /offen/i);
  assert.equal(await memberCreated.locator('[data-poll-choice]').count(), 2);
  await choosePollAction(memberCreated, '[data-edit-poll]');
  const activeSwitch = memberPage.locator('#event-poll-edit-form [data-poll-option-row]').first().locator('[data-poll-option-active]');
  const disabledEditRow = memberPage.locator('#event-poll-edit-form [data-poll-option-row]').first();
  assert.equal(await activeSwitch.isChecked(), false);
  assert.equal(await activeSwitch.getAttribute('aria-label'), 'Option 1 wählbar');
  assert.match(await disabledEditRow.locator('[data-poll-option-input]').evaluate((input) => getComputedStyle(input).textDecorationLine), /line-through/);
  await activeSwitch.check();
  assert.doesNotMatch(await disabledEditRow.locator('[data-poll-option-input]').evaluate((input) => getComputedStyle(input).textDecorationLine), /line-through/);
  await memberPage.click('#event-poll-edit-form button[type="submit"]');
  await memberCreated.locator('.event-poll-option').first().locator('[data-poll-choice]').waitFor();
  assert.equal(await memberCreated.locator('.event-poll-option').first().locator('.badge', { hasText: 'Deaktiviert' }).count(), 0);
  await choosePollAction(memberCreated, '[data-edit-poll]');
  await memberPage.locator('#event-poll-edit-form [data-poll-option-row]').first().locator('[data-poll-option-active]').uncheck();
  await memberPage.click('#event-poll-edit-form button[type="submit"]');
  await memberCreated.locator('.event-poll-option').first().locator('.badge', { hasText: 'Deaktiviert' }).waitFor();
  await choosePollAction(memberCreated, '[data-close-poll]');
  await memberPage.locator('.modal-backdrop [data-confirm]').click();
  await memberPage.locator('.toast', { hasText: 'Umfrage beendet' }).waitFor();
  await memberPage.locator('.event-poll-ended-history').evaluate((details) => {
    (details as HTMLDetailsElement).open = true;
    details.dispatchEvent(new Event('toggle'));
  });
  await choosePollAction(memberCreated, '[data-new-poll-round]');
  await memberPage.waitForSelector('#event-poll-form');
  assert.deepEqual(await memberPage.locator('#event-poll-form [data-poll-option-input]').evaluateAll(
    (inputs) => inputs.map((input) => (input as HTMLInputElement).value),
  ), ['Salat', 'Dessert'], 'a new round only copies options that are currently active');
  await memberPage.locator('.modal-backdrop [data-close]').click();
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
      {
        label: 'Ein langer frei eingegebener Optionstitel mit mehreren Wörtern für den gemeinsamen Termin',
        description: 'Notiz zur langen Option',
        url: 'https://example.com/lang',
      },
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
  assert.equal(await linkedOption.locator('.info-tooltip').count(), 0, 'a display-only poll view carries no info tooltips');
  assert.equal((await linkedOption.locator('.event-poll-option-note').textContent())?.trim(), 'Mit Sauna', 'the note is a visible line below the title');
  const ratingButtons = linkedOption.locator('[data-poll-response]');
  const assertRatingGeometry = async () => {
    const geometry = await linkedOption.evaluate((option) => {
      const toolbar = option.querySelector('.event-poll-rating-toolbar')! as HTMLElement;
      return {
        availableWidth: toolbar.clientWidth,
        gap: parseFloat(getComputedStyle(toolbar).columnGap),
        buttons: Array.from(toolbar.querySelectorAll('button')).map((button) => {
          const box = button.getBoundingClientRect();
          return { width: box.width, height: box.height, left: box.left, top: box.top,
            text: button.textContent?.trim(), pressed: button.getAttribute('aria-pressed'),
            clipped: button.scrollWidth > button.clientWidth };
        }),
        overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      };
    });
    assert.deepEqual(geometry.buttons.map((button) => button.text), ['1', '2', '3', '4', '5']);
    assert.equal(geometry.gap, 8);
    assert.equal(geometry.overflow, false);
    for (const button of geometry.buttons) {
      assert.equal(button.width, 32, JSON.stringify(geometry));
      assert.equal(button.height, 32, JSON.stringify(geometry));
      assert.equal(button.clipped, false);
    }
    assert.equal(new Set(geometry.buttons.map((button) => button.top)).size === 1, geometry.availableWidth >= 192, JSON.stringify(geometry));
    if (geometry.availableWidth >= 192) assert.equal(geometry.buttons[4].left + 32 - geometry.buttons[0].left, 192);
    else for (let index = 1; index < 5; index += 1) {
      const previous = geometry.buttons[index - 1];
      const current = geometry.buttons[index];
      assert.ok(current.top > previous.top || (current.top === previous.top && current.left > previous.left));
    }
  };
  for (const viewport of [
    { width: 320, height: 568 }, { width: 390, height: 844 },
    { width: 512, height: 384 }, { width: 720, height: 450 },
    { width: 1024, height: 768 }, { width: 1440, height: 900 },
  ]) {
    await ownerPage.setViewportSize(viewport);
    await assertRatingGeometry();
    const optionLinkControl = await optionLink.evaluate((control) => {
      const box = control.getBoundingClientRect();
      const icon = control.querySelector('.ui-icon')!.getBoundingClientRect();
      return { width: box.width, height: box.height, iconWidth: icon.width, iconHeight: icon.height };
    });
    assert.ok(optionLinkControl.width >= 44 && optionLinkControl.height >= 31 && optionLinkControl.height <= 33,
      JSON.stringify({ viewport, optionLinkControl }));
    assert.equal(optionLinkControl.iconWidth, 20, 'the option link uses its icon-button owner glyph');
    assert.equal(optionLinkControl.iconHeight, 20);
    // A long option title keeps a readable column instead of being squeezed
    // to letter width by the avatars or the answer buttons.
    const longTitle = await ratingPoll.locator('.event-poll-option', { hasText: 'Ein langer frei eingegebener' })
      .evaluate((option) => option.querySelector('.event-poll-option-title-row strong')!.getBoundingClientRect().width);
    assert.ok(longTitle >= 120, `a long option title keeps a readable width: ${JSON.stringify({ viewport, longTitle })}`);
  }
  await optionLink.focus();
  await ownerPage.keyboard.press('Shift+Tab');
  await ownerPage.keyboard.press('Tab');
  assert.equal(await optionLink.evaluate((element) => document.activeElement === element), true);
  assert.notEqual(await optionLink.evaluate((element) => getComputedStyle(element).outlineStyle), 'none', 'the option link shows its keyboard focus');
  // Every value is measured both unselected and selected through the real draft handler.
  for (let value = 1; value <= 5; value += 1) {
    await ratingButtons.nth(value - 1).click();
    await ownerPage.waitForFunction(() => Array.from(document.querySelectorAll('.event-poll-rating-toolbar button'))
      .every((button) => getComputedStyle(button).transform === 'none'));
    assert.equal(await ratingButtons.nth(value - 1).getAttribute('aria-pressed'), 'true');
    await assertRatingGeometry();
  }
  const ratingToolbar = linkedOption.locator('.event-poll-rating-toolbar');
  for (const width of [192, 191]) {
    await ratingToolbar.evaluate((toolbar, available) => { (toolbar as HTMLElement).style.width = `${available}px`; }, width);
    await assertRatingGeometry();
    await ratingButtons.first().focus();
    await ownerPage.keyboard.press('Tab');
    await ownerPage.keyboard.press('Shift+Tab');
    for (let index = 0; index < 5; index += 1) {
      assert.equal(await ratingButtons.nth(index).evaluate((button) => document.activeElement === button && getComputedStyle(button).outlineStyle !== 'none'), true);
      if (index < 4) await ownerPage.keyboard.press('Tab');
    }
    for (let index = 3; index >= 0; index -= 1) {
      await ownerPage.keyboard.press('Shift+Tab');
      assert.equal(await ratingButtons.nth(index).evaluate((button) => document.activeElement === button), true);
    }
  }
  await ratingToolbar.evaluate((toolbar) => { (toolbar as HTMLElement).style.removeProperty('width'); });
  const longOption = ratingPoll.locator('.event-poll-option', { hasText: 'Ein langer frei eingegebener' });
  await longOption.locator('[data-poll-response="5"]').click();
  await linkedOption.locator('[data-poll-response="1"]').click();
  await ratingPoll.locator('[data-save-poll]').click();
  const ratingSavedToast = ownerPage.locator('.toast', { hasText: 'Antwort gespeichert' });
  await ratingSavedToast.waitFor();
  // The saved ratings fill each option's bar in proportion to its average.
  await ownerPage.waitForFunction((pollId) => {
    const fills = Array.from(document.querySelectorAll(`[data-poll-card="${pollId}"] .event-poll-bar-fill`)) as HTMLElement[];
    return fills.map((fill) => fill.style.width).sort().join('/') === '100%/20%';
  }, await ratingPoll.getAttribute('data-poll-card'));
  // This response's toast has to be gone before the anonymous poll waits for
  // its own one below, otherwise that wait matches this stale toast and the
  // vote count is read before the save has landed.
  await ratingSavedToast.waitFor({ state: 'detached' });
  await ownerPage.setViewportSize({ width: 1024, height: 768 });
  const ratingPollId = await ratingPoll.getAttribute('data-poll-card');
  await navigate(ownerPage, 'home');
  await ownerPage.click('#global-search-btn');
  await ownerPage.fill('#global-search-input', 'Haus am See');
  const pollSearchResult = ownerPage.locator('.global-search-result', { hasText: 'Unterkünfte bewerten' });
  await pollSearchResult.waitFor();
  await pollSearchResult.click();
  await ownerPage.waitForSelector('[data-section-tab="eventPolls"][aria-current="page"]');
  await ownerPage.waitForSelector(`[data-poll-card="${ratingPollId}"].search-target-highlight`);

  await createPoll(ownerPage, {
    title: 'Anonyme Unterkunftswahl',
    mode: 'single_choice',
    anonymous: true,
    options: ['Haus', 'Hotel'],
  });
  const anonymousPoll = ownerPage.locator('[data-poll-group]', { hasText: 'Anonyme Unterkunftswahl' });
  await anonymousPoll.waitFor();
  const ratingActionMenu = ratingPoll.locator('.action-menu');
  const anonymousActionMenu = anonymousPoll.locator('.action-menu');
  assert.match((await ratingActionMenu.locator('summary').innerText()).trim(), /^Aktion/);
  assert.match((await ratingActionMenu.locator('summary').getAttribute('aria-label')) ?? '', /^Aktion/);
  for (const viewport of [
    { width: 320, height: 568 }, { width: 390, height: 844 },
    { width: 512, height: 384 }, { width: 720, height: 450 },
    { width: 1024, height: 768 },
  ]) {
    await ownerPage.setViewportSize(viewport);
    await ratingActionMenu.locator('summary').click();
    await ownerPage.waitForFunction(() => document.querySelector('.action-menu[open]')?.closest('.event-poll-card')?.classList.contains('has-open-action-menu'));
    const menuGeometry = await ratingActionMenu.evaluate((menu) => {
      const panel = menu.querySelector('.action-menu-panel')!.getBoundingClientRect();
      return {
        triggerHeight: menu.querySelector('summary')!.getBoundingClientRect().height,
        entries: Array.from(menu.querySelectorAll('.action-menu-panel .btn')).map((button) => ({
          height: button.getBoundingClientRect().height, width: button.getBoundingClientRect().width,
        })),
        panelLeft: panel.left,
        panelRight: panel.right,
        viewportWidth: window.innerWidth,
        viewOverflow: document.querySelector('#view-container')!.scrollWidth > document.querySelector('#view-container')!.clientWidth,
      };
    });
    assert.ok(menuGeometry.triggerHeight >= 31 && menuGeometry.triggerHeight <= 33);
    assert.ok(menuGeometry.entries.length > 0);
    assert.ok(menuGeometry.entries.every((entry) => entry.height >= 44 && entry.width >= 44));
    assert.ok(menuGeometry.panelLeft >= 0 && menuGeometry.panelRight <= menuGeometry.viewportWidth);
    assert.equal(menuGeometry.viewOverflow, false);
    await ownerPage.keyboard.press('Escape');
    assert.equal(await ratingActionMenu.locator('summary').evaluate((element) => document.activeElement === element), true);
  }
  await ownerPage.setViewportSize({ width: 1024, height: 768 });
  await ratingActionMenu.locator('summary').click();
  await ownerPage.waitForFunction(() => document.querySelector('.action-menu[open]')?.closest('.event-poll-card')?.classList.contains('has-open-action-menu'));
  assert.equal(await ratingPoll.evaluate((element) => element.classList.contains('has-open-action-menu')), true);
  await anonymousActionMenu.evaluate((details) => { (details as HTMLDetailsElement).open = true; });
  await ownerPage.waitForFunction(() => document.querySelectorAll('.action-menu[open]').length === 1);
  assert.equal(await ratingActionMenu.evaluate((details) => (details as HTMLDetailsElement).open), false, 'opening another action menu closes the previous one');
  assert.equal(await anonymousActionMenu.evaluate((details) => (details as HTMLDetailsElement).open), true);
  assert.equal(await anonymousPoll.evaluate((element) => element.classList.contains('has-open-action-menu')), true, 'the open menu raises only its own card');
  await ownerPage.keyboard.press('Escape');
  assert.equal(await anonymousActionMenu.evaluate((details) => (details as HTMLDetailsElement).open), false, 'Escape closes the action menu');
  assert.equal(await anonymousActionMenu.locator('summary').evaluate((element) => document.activeElement === element), true, 'Escape returns focus to the action trigger');
  await anonymousActionMenu.locator('summary').click();
  const outsideAction = ownerPage.locator('#new-event-poll');
  await outsideAction.focus();
  await outsideAction.dispatchEvent('pointerdown');
  assert.equal(await anonymousActionMenu.evaluate((details) => (details as HTMLDetailsElement).open), false, 'clicking outside closes the action menu');
  assert.equal(await outsideAction.evaluate((element) => document.activeElement === element), true, 'outside pointer dismissal does not move focus back to the trigger');

  await ratingActionMenu.locator('summary').click();
  await ratingActionMenu.locator('summary').evaluate((summary) => {
    const testWindow = window as Window & { __actionMenuRestoredFocus?: boolean };
    testWindow.__actionMenuRestoredFocus = false;
    summary.addEventListener('focus', () => { testWindow.__actionMenuRestoredFocus = true; }, { once: true });
  });
  await ratingActionMenu.locator('[data-edit-poll]').click();
  const editPollDialog = ownerPage.locator('.modal-backdrop', { hasText: 'Umfrage bearbeiten' });
  await editPollDialog.waitFor();
  assert.equal(
    await ownerPage.evaluate(() => (window as Window & { __actionMenuRestoredFocus?: boolean }).__actionMenuRestoredFocus),
    true,
    'an action selection restores the trigger before its dialog takes focus',
  );
  assert.equal(await ratingActionMenu.evaluate((details) => (details as HTMLDetailsElement).open), false);
  await editPollDialog.locator('[data-close]').click();
  await editPollDialog.waitFor({ state: 'detached' });
  assert.match((await anonymousPoll.locator('[data-poll-round]').textContent()) ?? '', /Anonym/);
  await anonymousPoll.locator('[data-poll-choice]').first().click();
  await anonymousPoll.locator('[data-save-poll]').click();
  await ownerPage.locator('.toast', { hasText: 'Antwort gespeichert' }).waitFor();
  assert.deepEqual(await anonymousPoll.locator('[data-poll-choice]').allTextContents(), ['Ausgewählt', 'Wählen']);
  assert.match((await anonymousPoll.locator('.event-poll-counts').first().textContent()) ?? '', /1 Stimme/);
  await choosePollAction(anonymousPoll, '[data-close-poll]');
  await ownerPage.locator('.modal-backdrop [data-confirm]').click();
  await ownerPage.locator('.toast', { hasText: 'Umfrage beendet' }).waitFor();
  assert.equal(await anonymousPoll.locator('[data-view-poll-votes]').count(), 0, 'anonymous votes never expose identities');

  await createPoll(ownerPage, {
    title: 'Eine Möglichkeit',
    options: ['Nur diese'],
  });
  const singleOptionPoll = ownerPage.locator('[data-poll-group]', { hasText: 'Eine Möglichkeit' });
  await singleOptionPoll.waitFor();
  assert.equal(await singleOptionPoll.locator('.event-poll-option').count(), 1);

  await createPoll(ownerPage, {
    title: 'Viele Möglichkeiten',
    mode: 'multiple_choice',
    maxSelections: 9,
    options: Array.from({ length: 9 }, (_, index) => `Möglichkeit ${index + 1}`),
  });
  const manyOptionPoll = ownerPage.locator('[data-poll-group]', { hasText: 'Viele Möglichkeiten' });
  await manyOptionPoll.waitFor();
  assert.equal(await manyOptionPoll.locator('.event-poll-option').count(), 9);
  assert.equal(await manyOptionPoll.locator('.event-poll-voter-stack').count(), 0, 'options without votes stay avatar-free');

  await createPoll(ownerPage, {
    title: 'Schalter beim Starten',
    options: [{ label: 'Wählbar' }, { label: 'Gesperrt', active: false }],
  });
  const createSwitchPoll = ownerPage.locator('[data-poll-group]', { hasText: 'Schalter beim Starten' });
  await createSwitchPoll.waitFor();
  assert.equal(await createSwitchPoll.locator('.event-poll-option').nth(1).locator('.badge', { hasText: 'Deaktiviert' }).count(), 1);
  assert.equal(await createSwitchPoll.locator('.event-poll-option').nth(1).locator('[data-poll-response]').count(), 0);
});
