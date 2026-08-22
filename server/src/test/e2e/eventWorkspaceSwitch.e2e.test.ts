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

async function createAcceptedEvent(name: string, playerId: string): Promise<string> {
  const now = Date.now();
  const created = await api('/api/events', {
    method: 'POST',
    body: JSON.stringify({ name, startsAt: now, endsAt: now + 3_600_000 }),
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
  await page.click(`#event-context-switcher-list [data-search-select-value="${eventA}"]`);
  // The onChange handler disables both elements synchronously, before its
  // first await — so by the time the click above has resolved, the disabled
  // state is already in the DOM. Reading both in one evaluate() call (a
  // single browser round trip) instead of two sequential waitForSelector
  // polls avoids a race against an in-memory-DB switch that can complete
  // (and re-enable the rebuilt control) between the two separate round
  // trips a pair of waitForSelector calls would need.
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
