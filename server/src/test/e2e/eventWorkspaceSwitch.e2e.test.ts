// Switching the active event has to leave nothing of the previous workspace
// behind. The server already scopes every endpoint (see the required API
// suites); what this covers is the browser side of the same promise, where
// each view caches its own fetch outside the shared `state` and those caches
// used to survive the switch.
//
// Two events, both accepted by the same account, with real data in exactly
// one of them: after switching, the other event must show its own empty
// state rather than the neighbour's rows.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { ChildProcess } from 'child_process';
import { chromium, Browser, Page } from 'playwright';
import { authenticatedServerEnv, loginE2EAdmin, finishE2EOnboarding, E2E_ADMIN_NAME, E2E_ADMIN_PASSWORD } from './authHelpers';
import { startE2EServer } from './e2eServer';

let BASE_URL: string;
let serverProcess: ChildProcess;
let browser: Browser;
let page: Page;
let cookie: string;
let eventA: string;
let eventB: string;

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

async function switchWorkspaceInBrowser(eventId: string): Promise<void> {
  await page.selectOption('#event-context-switcher', eventId);
  await page.waitForFunction(
    (id) => (document.getElementById('event-context-switcher') as HTMLSelectElement | null)?.value === id,
    eventId,
  );
  // The switch persists the workspace, reloads every dataset and re-renders;
  // waiting for the select alone would race that refresh.
  await page.waitForTimeout(1_500);
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
  await page.click('#profile-btn');
  await page.waitForSelector('[data-navigate="myStats"]');
  await page.click('[data-navigate="myStats"]');
  // The event select only exists once the first stats payload has arrived.
  await page.waitForSelector('#my-stats-event');

  const options = await page.$$eval('#my-stats-event option', (nodes) =>
    nodes.map((node) => ({
      value: (node as HTMLOptionElement).value,
      label: node.textContent?.trim() ?? '',
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
    await page.selectOption('#my-stats-event', option.value);
    await page.waitForTimeout(400);
  }
  assert.deepEqual(notFound, [], 'no offered event may answer the personal stats request with 404');
});

test('the workspace switcher names and shows the state of every event it offers', async () => {
  const started = await api(`/api/events/${eventA}/tracking/start`, { method: 'POST' });
  assert.equal(started.status, 200, JSON.stringify(started.body));

  await switchWorkspaceInBrowser(eventB);
  const labels = await page.$$eval('#event-context-switcher option', (nodes) =>
    nodes.map((node) => node.textContent?.trim() ?? ''),
  );
  assert.ok(
    labels.includes('Allgemein'),
    `the base workspace names itself once, got: ${JSON.stringify(labels)}`,
  );
  assert.ok(
    labels.some((label) => label === 'E2E Workspace A · Trackt gerade'),
    `a tracking event says so in the dropdown, got: ${JSON.stringify(labels)}`,
  );
  assert.ok(
    labels.some((label) => label === 'E2E Workspace B · Nicht aktiv'),
    `a created but idle event says so too, got: ${JSON.stringify(labels)}`,
  );

  // The indicator follows the active event, and the state stays readable
  // without it: the option text spells it out and the control is described.
  assert.equal(await page.$eval('#event-context-status', (el) => (el as HTMLElement).dataset.eventStatus), 'idle');
  await switchWorkspaceInBrowser(eventA);
  assert.equal(await page.$eval('#event-context-status', (el) => (el as HTMLElement).dataset.eventStatus), 'tracking');
  assert.equal(
    await page.$eval('#event-context-switcher', (el) => el.getAttribute('aria-label')),
    'Aktives Event: E2E Workspace A – Trackt gerade',
  );

  // Same control shape as every other dropdown in the app, not a pill.
  const shape = await page.$eval('#event-context-switcher', (el) => {
    const style = getComputedStyle(el);
    return { radius: style.borderTopLeftRadius, appearance: style.appearance };
  });
  assert.equal(shape.radius, '8px', 'the switcher uses the shared --radius-sm select treatment');
  assert.equal(shape.appearance, 'none', 'and the shared custom chevron rather than the native arrow');

  const overflows = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  assert.equal(overflows, false, 'the topbar control must not create horizontal page scrolling');
});
