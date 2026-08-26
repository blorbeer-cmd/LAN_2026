// Switching the active event has to leave nothing of the previous workspace
// behind. The server already scopes every endpoint (see the required API
// suites); what this covers is the browser side of the same promise, where
// each view caches its own fetch outside the shared `state` and those caches
// used to survive the switch.
//
// Two events, both accepted by the same account, with real data in exactly
// one of them: after switching, the other event must show its own empty
// state rather than the neighbour's rows.

import { before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { ChildProcess } from 'child_process';
import { chromium, Browser, Page } from 'playwright';
import { authenticatedServerEnv, loginE2EAdmin, finishE2EOnboarding, E2E_ADMIN_NAME, E2E_ADMIN_PASSWORD } from './authHelpers';
import { createStatefulE2EDiagnosticTest } from './e2eDiagnostics';
import { startE2EServer, type E2EServer } from './e2eServer';

let BASE_URL: string;
let serverProcess: ChildProcess;
let e2eServer: E2EServer;
let browser: Browser;
let page: Page;
let cookie: string;
let eventA: string;
let eventB: string;
let generalEvent: string;

const test = createStatefulE2EDiagnosticTest(
  () => ({ browser, server: e2eServer }),
  { sharedState: 'server, browser context, and page' },
);

async function api(path: string, init: RequestInit = {}): Promise<{ status: number; body: any }> {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', cookie, ...(init.headers ?? {}) },
  });
  const text = await res.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { status: res.status, body };
}

async function createAcceptedEvent(
  name: string,
  playerId: string,
  eventType = 'lan',
  details: Record<string, unknown> = {},
): Promise<string> {
  const now = Date.now();
  const created = await api('/api/events', {
    method: 'POST',
    body: JSON.stringify({ name, startsAt: now, endsAt: now + 3_600_000, eventType, ...details }),
  });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const id = created.body.id as string;
  const invited = await api(`/api/events/${id}/participants`, {
    method: 'PUT',
    body: JSON.stringify({ playerIds: [playerId] }),
  });
  assert.equal(invited.status, 200, JSON.stringify(invited.body));
  const accepted = await api(`/api/events/${id}/invitation/accept`, { method: 'POST' });
  assert.equal(accepted.status, 200, JSON.stringify(accepted.body));
  return id;
}

async function activate(eventId: string): Promise<void> {
  const res = await api('/api/me/active-event', { method: 'PUT', body: JSON.stringify({ eventId }) });
  assert.equal(res.status, 200, JSON.stringify(res.body));
}

// The switcher is the shared searchable dropdown, not a native <select>: open
// its listbox and click the option, the same path a person takes.
async function switchWorkspaceInBrowser(eventId: string): Promise<void> {
  // A failed assertion in a preceding test can leave the shared switcher
  // open. Normalize that state before selecting: toggling an already-open
  // list would close it and make the option below permanently invisible.
  if (await page.locator('#event-context-switcher-list').isHidden()) {
    await page.click('#event-context .search-select-toggle');
  }
  await page.click(`#event-context-switcher-list [data-search-select-value="${eventId}"]`);
  await page.waitForFunction(
    (id) => (document.getElementById('event-context-switcher') as HTMLInputElement | null)?.value === id,
    eventId,
  );
  // The switch persists the workspace, reloads every dataset and re-renders;
  // waiting for the hidden value alone would race that refresh. app.js's
  // onChange handler disables the switcher's search field and toggle before
  // awaiting the switch and only re-enables them in its `finally`, once
  // loadAll(), renderEventContextSwitcher() and renderCurrent() have all
  // settled — the same completion signal "the switcher disables itself
  // while a workspace switch is in flight" below asserts against. Waiting
  // for it here (instead of a fixed sleep) removes the fixed-timeout race
  // against a slower CI runner without ever waiting less than necessary.
  await page.waitForSelector('#event-context-switcher-search:not([disabled])');
  await page.waitForSelector('#event-context .search-select-toggle:not([disabled])');
}

// The bottom nav only carries the six primary views; everything else is
// reached through the "Mehr" hub, whose cards use data-navigate.
async function openView(view: string): Promise<void> {
  const direct = await page.$(`[data-view="${view}"]`);
  if (direct) {
    await direct.click();
  } else {
    await page.click('[data-view="more"]');
    await page.waitForSelector(`[data-navigate="${view}"]`);
    await page.click(`[data-navigate="${view}"]`);
  }
  await page.waitForTimeout(1_000);
}

function viewText(): Promise<string> {
  return page.$eval('#view-container', (el) => (el as HTMLElement).innerText);
}

before(async () => {
  const server = await startE2EServer({ ...authenticatedServerEnv(), NODE_ENV: 'test' });
  e2eServer = server;
  serverProcess = server.process;
  BASE_URL = server.baseUrl;
  cookie = await loginE2EAdmin(BASE_URL);
  await finishE2EOnboarding(BASE_URL, cookie);

  const me = await api('/api/me');
  const myId = me.body.id as string;
  eventA = await createAcceptedEvent('E2E Workspace A', myId);
  eventB = await createAcceptedEvent('E2E Workspace B', myId);
  generalEvent = await createAcceptedEvent('E2E Allgemeines Event', myId, 'general', {
    location: 'Gemeinschaftsgarten',
    description: 'Bitte wetterfeste Kleidung mitbringen.',
    costCents: 1500,
  });

  // Data that exists only in event A.
  await activate(eventA);
  const started = await api('/api/votes/start', { method: 'POST', body: JSON.stringify({ mode: 'points' }) });
  assert.equal(started.status, 201, JSON.stringify(started.body));
  const board = await api('/api/info', {
    method: 'POST',
    body: JSON.stringify({ title: 'Nur in Event A', content: 'Aushang des ersten Workspaces.' }),
  });
  assert.equal(board.status, 201, JSON.stringify(board.body));

  browser = await chromium.launch();
  page = await browser.newPage();
  await page.goto(BASE_URL);
  await page.waitForSelector('#auth-screen:not([hidden])');
  await page.fill('#auth-name', E2E_ADMIN_NAME);
  await page.fill('#auth-password', E2E_ADMIN_PASSWORD);
  await page.click('#auth-form button[type="submit"]');
  await page.waitForSelector('#app:not([hidden])');
  await page.waitForTimeout(1_000);
});

after(async () => {
  await browser?.close();
  serverProcess?.kill();
});

test('the running vote of the previous event disappears when the workspace changes', async () => {
  await switchWorkspaceInBrowser(eventA);
  await openView('votes');
  const inA = await viewText();
  assert.match(inA, /Abstimmung läuft/, 'event A owns the open round');

  await switchWorkspaceInBrowser(eventB);
  const inB = await viewText();
  assert.doesNotMatch(inB, /Abstimmung läuft/, 'event B must not show event A running round');
  assert.match(inB, /Neue Abstimmung/, 'event B offers starting its own round instead');

  await switchWorkspaceInBrowser(eventA);
  const backInA = await viewText();
  assert.match(backInA, /Abstimmung läuft/, 'switching back restores the real state of event A');
});

test('an info board entry stays inside the event it was written in', async () => {
  // Info is a topbar dialog rather than a view, so it is read from the modal
  // and closed again before the switcher in that same topbar is used.
  async function infoDialogText(): Promise<string> {
    await page.click('#info-btn');
    await page.waitForSelector('.modal-body');
    // openInfoBoard() starts its fetch and renders the modal in the same
    // synchronous turn, so the first paint is always the "Lädt…" placeholder
    // (infoBoard.js: `loading` is set before the await, entriesHtml() checks
    // it). Reading here without waiting would make the positive assertion a
    // race — and, worse, let the negative one pass against the placeholder
    // instead of against event B's actual entries. The cache is dropped on
    // every workspace switch, so this applies to both openings.
    await page.waitForFunction(() => {
      const body = document.querySelector('.modal-body');
      return body !== null && !body.textContent?.includes('Lädt');
    });
    const text = await page.$eval('.modal-body', (el) => (el as HTMLElement).innerText);
    await page.click('.modal [data-close]');
    await page.waitForSelector('.modal-body', { state: 'detached' });
    return text;
  }

  await switchWorkspaceInBrowser(eventA);
  assert.match(await infoDialogText(), /Nur in Event A/, 'event A owns the entry');

  await switchWorkspaceInBrowser(eventB);
  const inB = await infoDialogText();
  assert.doesNotMatch(inB, /Nur in Event A/, 'event B must not inherit the entry');
  // Stated positively as well, so the check above cannot pass merely because
  // the dialog had not finished loading: event B owns no entry at all.
  assert.match(inB, /Noch keine Einträge/, 'event B starts from its own empty info board');
});

test('the personal statistics event filter only offers accepted workspaces', async () => {
  await switchWorkspaceInBrowser(eventB);
  // "Meine Statistiken" hangs off the profile view rather than the nav or the
  // "Mehr" hub, and is reached through its "Ansehen" action.
  await page.click('.nav-btn[data-view="more"]');
  await page.click('[data-navigate="profile"]');
  await page.waitForSelector('[data-navigate="myStats"]');
  await page.click('[data-navigate="myStats"]');
  // The event dropdown only exists once the first stats payload has arrived.
  // Wait for its visible control: `#my-stats-event` itself is the hidden input
  // carrying the selected value.
  await page.waitForSelector('#my-stats-event-search');

  const options = await page.$$eval('#my-stats-event-list .search-select-option', (nodes) =>
    nodes.map((node) => ({
      value: node.getAttribute('data-search-select-value') ?? '',
      label: node.querySelector('.search-select-option-label')?.textContent?.trim() ?? '',
    })),
  );
  assert.ok(
    options.some((option) => option.label.includes('Allgemein')),
    `the permanent base workspace stays selectable for every role, got: ${JSON.stringify(options)}`,
  );

  // Regression guard for the admin case: state.events is the management list
  // for owner/admin, which contains events this account never accepted. Those
  // are rejected by resolveAnalyticsEvents with a 404, so offering them here
  // produced an error toast and an empty dashboard for every pick.
  const notFound: string[] = [];
  page.on('response', (response) => {
    if (response.url().includes('/api/players/') && response.status() === 404) notFound.push(response.url());
  });
  for (const option of options) {
    await page.click('#my-stats-event-search');
    await page.click(`#my-stats-event-list [data-search-select-value="${option.value}"]`);
    await page.waitForTimeout(400);
  }
  assert.deepEqual(notFound, [], 'no offered event may answer the personal stats request with 404');
});

test('the workspace switcher keeps event names concise and shows state through its icon', async () => {
  // Hold the socket-driven event snapshot long enough for the switcher to
  // open first. This deterministically exercises the ordering seen on CI.
  await page.route(`${BASE_URL}/api/events`, async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 250));
    await route.continue();
  }, { times: 1 });
  const started = await api(`/api/events/${eventA}/tracking/start`, { method: 'POST' });
  assert.equal(started.status, 200, JSON.stringify(started.body));

  await switchWorkspaceInBrowser(eventB);
  // Wait for the socket refresh while the list is still closed. The control
  // deliberately skips rebuilding an open, focused search so it does not
  // discard a reader's query; opening before this signal therefore made the
  // stale row permanent until the test timed out. The delayed route above
  // turns that CI ordering into a deterministic regression case.
  await page.waitForFunction(
    (id) =>
      document
        .querySelector(`#event-context-switcher-list [data-search-select-value="${id}"] .search-select-option-icon`)
        ?.getAttribute('data-event-status') === 'tracking',
    eventA,
  );
  await page.click('#event-context .search-select-toggle');
  const rows = await page.$$eval('#event-context-switcher-list .search-select-option', (nodes) =>
    nodes.map((node) => ({
      label: node.querySelector('.search-select-option-label')?.textContent?.trim() ?? '',
      state: node.querySelector('.search-select-option-icon')?.getAttribute('data-event-status') ?? '',
      iconLabel: node.querySelector('.search-select-option-icon')?.getAttribute('aria-label') ?? '',
    })),
  );
  const labels = rows.map((row) => row.label);
  assert.ok(
    labels.includes('Allgemein'),
    `the base workspace names itself once, got: ${JSON.stringify(labels)}`,
  );
  assert.ok(
    labels.some((label) => label === 'E2E Workspace A'),
    `the tracking event keeps only its name in the dropdown, got: ${JSON.stringify(labels)}`,
  );
  assert.ok(
    labels.some((label) => label === 'E2E Workspace B'),
    `the idle event keeps only its name in the dropdown, got: ${JSON.stringify(labels)}`,
  );
  assert.ok(labels.every((label) => !label.includes('Trackt gerade') && !label.includes('Nicht aktiv')));

  // The state is an icon on every row of the *open* list, not something the
  // reader only learns after choosing — and never colour alone, so each icon
  // carries its German state as accessible name.
  assert.equal(rows.find((row) => row.label === 'E2E Workspace A')?.state, 'tracking');
  assert.equal(rows.find((row) => row.label === 'E2E Workspace A')?.iconLabel, 'Trackt gerade');
  assert.equal(rows.find((row) => row.label === 'E2E Workspace B')?.state, 'idle');
  assert.equal(rows.find((row) => row.label === 'Allgemein')?.state, 'base');
  await page.keyboard.press('Escape');

  // The collapsed control shows the active event's state through the same
  // vocabulary, and the wrapper keeps it in words for assistive technology.
  assert.equal(
    await page.$eval('#event-context .search-select-status', (el) => (el as HTMLElement).dataset.eventStatus),
    'idle',
  );
  await switchWorkspaceInBrowser(eventA);
  // Same tracking/start race as above: the switch's own dataset reload can
  // still occasionally settle a beat behind the raw API write it followed.
  await page.waitForFunction(
    () => (document.querySelector('#event-context .search-select-status') as HTMLElement | null)?.dataset.eventStatus === 'tracking',
  );
  assert.equal(
    await page.$eval('#event-context-switcher-search', (el) => el.getAttribute('aria-label')),
    'Aktives Event: E2E Workspace A – Trackt gerade',
  );

  // Same control shape as every other dropdown in the app, not a pill.
  const shape = await page.$eval('#event-context-switcher-search', (el) => {
    const style = getComputedStyle(el);
    return { radius: style.borderTopLeftRadius };
  });
  assert.equal(shape.radius, '8px', 'the switcher uses the shared --radius-sm control treatment');
  assert.equal(
    await page.$$eval('#event-context [data-search-select]', (nodes) => nodes.length),
    1,
    'the switcher is the shared searchable dropdown component',
  );

  const overflows = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  assert.equal(overflows, false, 'the topbar control must not create horizontal page scrolling');
});

test('the switcher disables itself while a workspace switch is in flight', async () => {
  await switchWorkspaceInBrowser(eventB);
  await page.click('#event-context .search-select-toggle');
  await page.route(`${BASE_URL}/api/me/active-event`, async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 250));
    await route.continue();
  }, { times: 1 });
  await page.click(`#event-context-switcher-list [data-search-select-value="${eventA}"]`);
  // The onChange handler disables both elements synchronously, before its
  // first await — so by the time the click above has resolved, the disabled
  // state is already in the DOM. Reading both in one evaluate() call (a
  // single browser round trip) instead of two sequential waitForSelector
  // polls avoids a race against an in-memory-DB switch that can complete
  // (and re-enable the rebuilt control) between the two separate round
  // trips a pair of waitForSelector calls would need.
  await page.waitForSelector('#event-context-switcher-search[disabled]');
  await page.waitForSelector('#event-context .search-select-toggle[disabled]');
  const disabledDuringSwitch = await page.evaluate(() => ({
    search: (document.getElementById('event-context-switcher-search') as HTMLInputElement | null)?.disabled,
    toggle: (document.querySelector('#event-context .search-select-toggle') as HTMLButtonElement | null)?.disabled,
  }));
  assert.equal(disabledDuringSwitch.search, true, 'the search field must be disabled while the switch is in flight');
  assert.equal(disabledDuringSwitch.toggle, true, 'the toggle button must be disabled while the switch is in flight');
  // It re-enables again once the switch (and the render it triggers) settles.
  await page.waitForFunction(
    (id) => (document.getElementById('event-context-switcher') as HTMLInputElement | null)?.value === id,
    eventA,
    { timeout: 5_000 },
  );
  await page.waitForSelector('#event-context-switcher-search:not([disabled])');
  await page.waitForSelector('#event-context .search-select-toggle:not([disabled])');
});

test('an open, actively-searched switcher survives an unrelated background refresh', async () => {
  await switchWorkspaceInBrowser(eventA);
  await page.click('#event-context .search-select-toggle');
  await page.fill('#event-context-switcher-search', 'E2E Work');
  await page.waitForSelector('#event-context-switcher-list:not([hidden])');

  // events:changed (fired by creating an event) reaches every open client of
  // the group and drives one of the 30+ unrelated ctx.refresh() call sites
  // that rebuild this same switcher — exactly the kind of refresh that used
  // to blow away in-progress typing.
  const created = await api('/api/events', {
    method: 'POST',
    body: JSON.stringify({ name: 'Background Refresh Probe', startsAt: Date.now(), endsAt: Date.now() + 3_600_000 }),
  });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  await page.waitForTimeout(1_000);

  assert.equal(
    await page.$eval('#event-context-switcher-search', (el) => (el as HTMLInputElement).value),
    'E2E Work',
    'the typed search term must survive the unrelated refresh while the switcher is open',
  );
  assert.equal(
    await page.$eval('#event-context-switcher-list', (el) => (el as HTMLElement).hidden),
    false,
    'the open list must stay open across the unrelated refresh',
  );
  await page.keyboard.press('Escape');
});

test('a general event removes LAN-only whole areas across navigation, Home, Profile and Admin', async () => {
  await switchWorkspaceInBrowser(generalEvent);

  const expectedNavViews = ['home', 'arrivals', 'checklistPacking', 'checklist', 'eventPolls', 'more'];
  // The switcher's enabled state confirms that its own refresh settled, but
  // the event-feature navigation follows through a separate render signal.
  // Wait for that observable contract instead of racing it on a loaded CI
  // runner; the assertion below still fails if the general-event nav never
  // arrives or contains the wrong destinations.
  await page.waitForFunction(
    (expected) => Array.from(document.querySelectorAll<HTMLElement>('.nav-btn'))
      .filter((button) => button.getClientRects().length > 0)
      .map((button) => button.dataset.view)
      .join(',') === expected.join(','),
    expectedNavViews,
  );
  assert.deepEqual(
    await page.locator('.nav-btn:visible').evaluateAll((buttons) => buttons.map((button) => (button as HTMLElement).dataset.view)),
    expectedNavViews,
  );
  assert.equal(await page.locator('.nav-btn[data-view="eventPolls"]').isEnabled(), true);
  await page.click('.nav-btn[data-view="eventPolls"]');
  assert.match(await page.locator('#view-container > .view-title').innerText(), /Abstimmungen/);

  await page.click('.nav-btn[data-view="home"]');
  const home = await viewText();
  assert.doesNotMatch(home, /Live-Status|Rangliste/);
  for (const text of [
    'Eventübersicht',
    'Allgemeines Event',
    'Gemeinschaftsgarten',
    'wetterfeste Kleidung',
    '15,00',
    '1 teilnehmende Person',
    'Organisation',
    'Eventdetails & Kosten',
    'To-Dos',
    'An- & Abreise',
    'Essen',
    'Jam',
    'Sitzplan',
  ]) {
    assert.ok(home.includes(text), `Home must show ${text}`);
  }
  for (const view of ['events', 'checklist', 'arrivals', 'foodOrders', 'music']) {
    assert.equal(await page.locator(`[data-navigate="${view}"]`).first().isVisible(), true, `${view} summary link must be visible`);
  }

  await openView('profile');
  const profile = await viewText();
  assert.doesNotMatch(profile, /Live-Status-Agent|Sichtbare Monitore|Meine Statistiken|Bock & Skill eintragen/);
  assert.match(profile, /Push-Benachrichtigungen/);

  await page.click('.nav-btn[data-view="more"]');
  const more = await viewText();
  assert.match(more, /Arcade|Jam|Events|Essen/);
  assert.doesNotMatch(more, /Orga/);
  assert.equal(await page.locator('[data-navigate="arcade"]').isVisible(), true);

  await page.click('.nav-btn[data-view="arrivals"]');
  await page.waitForSelector('#arrivals-times-title');
  assert.doesNotMatch(await viewText(), /Spieler/);
  assert.match(await viewText(), /Person|Teilnehmende/i);
  assert.match(await page.locator('#view-container > .view-title').innerText(), /An- & Abreise/);
  assert.equal(await page.locator('#view-container > .section-tabs').count(), 0);

  await page.click('.nav-btn[data-view="more"]');
  await page.click('[data-navigate="events"]');
  const generalEventCard = page.locator(`[data-event-card="${generalEvent}"]`);
  assert.equal(
    await generalEventCard.locator('.event-card-header-badges .badge').first().innerText(),
    'Allgemeines Event',
  );
  assert.match(await generalEventCard.innerText(), /Teilnehmende verwalten/);
  assert.equal(
    await generalEventCard.locator('[data-export-event]').count(),
    0,
    'general events must not offer the LAN keepsake PDF',
  );
  await page.click('#new-event-btn');
  assert.deepEqual(
    await page.locator('#event-type option').allTextContents(),
    ['LAN-Party', 'Allgemeines Event'],
  );
  assert.equal(await page.locator('#event-type-description').count(), 0);
  await page.selectOption('#event-type', 'general');
  assert.equal(await page.locator('#event-type-description').count(), 0);
  await page.click('.modal-backdrop [data-close]');

  await openView('admin');
  const admin = await viewText();
  assert.doesNotMatch(admin, /LAN-Bereitschaft|Agent-Diagnose|Kioskverwaltung/);
  assert.equal(await page.locator('[data-navigate="leaderboard"]').count(), 0);
  assert.equal(await page.locator('[data-navigate="kiosk"]').count(), 0);
  assert.match(admin, /Sitzplan|Eventverwaltung/);

  await page.click('[data-navigate="seating"]');
  await page.waitForSelector('#seating-players-title');
  const seating = await viewText();
  assert.match(seating, /Teilnehmende/);
  assert.doesNotMatch(seating, /Spieler/);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.click('.nav-btn[data-view="home"]');
  await page.waitForSelector('[data-home-event-overview]');
  await page.waitForSelector('[data-home-assigned-todos]');
  assert.match(await page.locator('[data-home-assigned-todos]').innerText(), /Meine To-Dos|Alle To-Dos/);
  assert.equal(
    await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth),
    true,
    'the general-event overview must not introduce horizontal page scrolling on a phone',
  );
  assert.equal(await page.locator('[data-home-event-overview] .badge').isVisible(), true);
  await page.setViewportSize({ width: 1280, height: 720 });

  await switchWorkspaceInBrowser(eventA);
  assert.deepEqual(
    await page.locator('.nav-btn:visible').evaluateAll((buttons) => buttons.map((button) => (button as HTMLElement).dataset.view)),
    ['home', 'matchmaking', 'votes', 'foodOrders', 'gameCatalog', 'more'],
  );
  await page.click('.nav-btn[data-view="more"]');
  assert.equal(await page.locator('[data-navigate="eventPolls"]').isVisible(), true);
  assert.match(await viewText(), /Orga/);
});

// The organizer is the account most likely to answer for itself here: they see
// every event of the group as a management card, and their own answer was
// missing from exactly that card — an owner had no way to withdraw an
// acceptance at all. A dedicated future-dated event keeps this independent of
// the events the tests above switch between, and of the "already running" lock
// that deliberately blocks withdrawing from an event that has started.
test('an organizer can withdraw and restore their own participation on the management card', async () => {
  const startsAt = Date.now() + 7 * 24 * 60 * 60 * 1000;
  const created = await api('/api/events', {
    method: 'POST',
    body: JSON.stringify({ name: 'E2E Orga Eigene Teilnahme', startsAt, endsAt: startsAt + 3_600_000 }),
  });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const eventId = created.body.id as string;
  const me = await api('/api/me');
  const roster = await api(`/api/events/${eventId}/participants`, {
    method: 'PUT',
    body: JSON.stringify({ playerIds: [me.body.id] }),
  });
  assert.equal(roster.status, 200, JSON.stringify(roster.body));

  // Events is an Orga tab rather than a "Mehr" destination of its own, so this
  // routes straight to it the same way the other event fixtures do.
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('respawn:navigate', { detail: 'events' })));
  await page.waitForSelector('#view-container[data-view="events"]');
  await page.waitForSelector(`[data-event-card="${eventId}"]`);
  const card = page.locator(`[data-event-card="${eventId}"]`);
  await card.locator(`[data-decline-participation="${eventId}"]`).click();
  await page.click('[data-confirm]');
  await card.locator(`[data-accept-participation="${eventId}"]`).waitFor();
  assert.match((await card.textContent()) ?? '', /Du: Abgesagt/);
  // Declined means no workspace: the switcher must not offer it any more.
  assert.doesNotMatch(
    (await page.locator('#event-context').textContent()) ?? '',
    /E2E Orga Eigene Teilnahme/,
  );

  await card.locator(`[data-accept-participation="${eventId}"]`).click();
  await card.locator(`[data-decline-participation="${eventId}"]`).waitFor();
  assert.doesNotMatch((await card.textContent()) ?? '', /Du: Abgesagt/);
});
