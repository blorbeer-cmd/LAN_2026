// Shared fixture for the four Core flow shards (flowsShell, flowsCompetition,
// flowsCommunity, foodOrders). It owns the one server session, browser context
// and page that a shard's sibling tests deliberately share, plus the helpers
// they navigate with. Separate from the fast unit/integration suite
// (`npm test`) — run via `npm run test:e2e` since it spawns a server process
// and a browser, which is much slower.
//
// The shard fixtures hold the flowTest cases themselves so a change to one
// shard no longer touches the file of the other three.

import { test, before, after, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import type { ChildProcess } from 'child_process';
import { chromium, Browser, Page, type Locator } from 'playwright';
import {
  addSessionCookie,
  switchSessionCookie,
  authenticatedServerEnv,
  createE2EAccount,
  E2E_ADMIN_PASSWORD,
  loginE2EAdmin,
  type E2EAccount,
} from './authHelpers';
import { StatefulE2EDiagnosticGuard } from './e2eDiagnostics';
import { startE2EServer, type E2EServer } from './e2eServer';

export let BASE_URL: string;

// The Core cross-view scenarios live in this process only. Arcade cross-view
// scenarios are kept in arcadeFlows.e2e.test.ts so changing them cannot select
// the Core browser partition.
let serverProcess: ChildProcess;
let e2eServer: E2EServer;
export let browser: Browser;
export let page: Page;
export let adminCookie: string;
export let alice: E2EAccount;
export let bob: E2EAccount;
export const accountsByName = new Map<string, E2EAccount>();
const flowDiagnostics = new StatefulE2EDiagnosticGuard(
  () => ({ browser, server: e2eServer }),
  { sharedState: 'server, browser context, and page' },
);

export type FlowShard = 'shell' | 'competition' | 'community' | 'food-orders';

// Each shard fixture calls registerFlowFixture() once, at import time and
// before its own flowTest registrations. The shared before() hook below needs
// to know which shard owns this process because the shards expect different
// account fixtures.
let activeShard: FlowShard | undefined;

export function registerFlowFixture(shard: FlowShard): void {
  activeShard = shard;
}

export async function waitForTextDecoration(locator: Locator, expected: string): Promise<void> {
  const deadline = Date.now() + 5_000;
  let lastObserved = 'Element nicht verfügbar';
  while (Date.now() < deadline) {
    try {
      const actual = await locator.evaluate((element) => {
        if (!element.isConnected) return null;
        return getComputedStyle(element).textDecorationLine;
      });
      if (actual === expected) return;
      lastObserved = actual ?? 'Element nicht verbunden';
    } catch {
      // A payment rerender can detach the current node between resolution and
      // evaluation. The next locator evaluation resolves the current node.
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.fail(`text-decoration-line sollte ${expected} sein, war zuletzt ${lastObserved}`);
}

export function flowTest(
  name: string,
  fn: (context: TestContext) => void | Promise<void>,
): void {
  // All flows in a shard intentionally share one server session and one
  // Playwright page. Running sibling tests concurrently lets one flow
  // navigate or resize that page while another is asserting it.
  test(name, { concurrency: false }, (context) =>
    flowDiagnostics.run(context, name, () => fn(context)),
  );
}

// The claim is "the Bezahlt marker does not jump when the group's state
// changes", not "two getBoundingClientRect() reads return bit-identical
// floats". Comparing them with deepEqual made a sub-pixel difference — a late
// font, a scrollbar, a different device pixel ratio — a failure with nothing
// behind it, while a real jump moves the control by far more than a pixel.
export function assertMarkerStaysPut(
  actual: { left: number; width: number },
  expected: { left: number; width: number },
  because: string,
): void {
  assert.ok(
    Math.abs(actual.left - expected.left) <= 1 && Math.abs(actual.width - expected.width) <= 1,
    `${because} must not move the paid marker (${JSON.stringify(expected)} -> ${JSON.stringify(actual)})`,
  );
}

export async function setDateTimeField(id: string, value: string): Promise<void> {
  await page.locator(`#${id}`).evaluate((element, nextValue) => {
    (element as HTMLInputElement).value = nextValue;
  }, value);
}

export async function openMatchmakingHistory(): Promise<void> {
  const details = page.locator('details.history-details:has(summary:has-text("Historie"))');
  if ((await details.getAttribute('open')) === null) await details.locator('summary').click();
}

// Merged areas (see public/js/sectionNav.js): the bottom nav opens the area on
// its first tab, the tab row switches within it. Each tab is still its own
// route, so these two clicks are ordinary navigation.
async function openSectionTab(navView: string, tab: string): Promise<void> {
  await page.click(`.nav-btn[data-view="${navView}"]`);
  await page.click(`[data-section-tab="${tab}"]`);
}

export async function openTeams(): Promise<void> {
  await openSectionTab('matchmaking', 'matchmaking');
}

// Auswertung (Rangliste/Statistiken/Hall of Fame) has no bottom-nav slot or
// "Mehr" entry of its own any more - it lives behind Admin's own
// "Auswertung" tool card, gated by the real admin role instead.
export async function openAuswertungTab(tab: string): Promise<void> {
  await page.click('.nav-btn[data-view="more"]');
  await page.click('[data-navigate="admin"]');
  await page.click('[data-navigate="leaderboard"]');
  await page.click(`[data-section-tab="${tab}"]`);
}

export async function ensureAdminMode(): Promise<void> {
  await page.waitForSelector('#admin-mode-activate, #admin-tools-title');
  const activateButton = page.locator('#admin-mode-activate');
  if (await activateButton.count()) await activateButton.click();
  await page.waitForSelector('#admin-banner:not([hidden])');
  // setAdmin(true) exposes the persistent banner synchronously, while the
  // admin view itself is rebuilt only after ctx.refresh() has finished. Wait
  // for that second state as well so callers never inspect the old panel.
  await page.waitForSelector('#admin-test-players-title');
}

// Desktop exposes every Orga destination directly. Compact layouts retain
// the established Mehr entry and the shared tab shell.
export async function openOrgaTab(tab: string): Promise<void> {
  const desktopEntry = page.locator(`.desktop-nav-btn[data-view="${tab}"]`);
  if (await desktopEntry.isVisible()) {
    await desktopEntry.click();
    return;
  }
  await page.click('.nav-btn[data-view="more"]');
  await page.click('[data-navigate="eventPolls"]');
  await page.click(`[data-section-tab="${tab}"]`);
}

// Phones reach "Mein Profil" through Mehr; wide desktop uses the bottom
// utility block of the grouped rail.
export async function openProfile(): Promise<void> {
  const desktopEntry = page.locator('.desktop-nav-btn[data-view="profile"]');
  if (await desktopEntry.isVisible()) {
    await desktopEntry.click();
    return;
  }
  await page.click('.nav-btn[data-view="more"]');
  await page.click('[data-navigate="profile"]');
}

export async function switchIdentityAndOpenArrivals(label: string): Promise<void> {
  const account = accountsByName.get(label);
  assert.ok(account, `missing E2E account for ${label}`);
  await switchSessionCookie(page, BASE_URL, account.cookie);
  await page.waitForSelector('#app:not([hidden])');
  await openOrgaTab('arrivals');
  await page.waitForSelector('[data-new-carpool="arrival"]');
}

export async function switchIdentityAndOpenFoodOrders(label: string): Promise<void> {
  const account = accountsByName.get(label);
  assert.ok(account, `missing E2E account for ${label}`);
  await switchSessionCookie(page, BASE_URL, account.cookie);
  await page.waitForSelector('#app:not([hidden])');
  await page.click('#nav-food-orders');
  await page.waitForSelector('#order-new-btn');
}

export async function createAccountForFlow(name: string): Promise<E2EAccount> {
  const reauthenticated = await fetch(`${BASE_URL}/api/auth/reauth`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: alice.cookie },
    body: JSON.stringify({ password: alice.password }),
  });
  assert.equal(reauthenticated.status, 204, await reauthenticated.text());
  adminCookie = alice.cookie;
  const account = await createE2EAccount(BASE_URL, adminCookie, name);
  accountsByName.set(name, account);
  await page.reload();
  await page.waitForSelector('#app:not([hidden])');
  // The API setup above already verifies the new account. Home's live roster
  // is populated asynchronously and is not required for the arrival flow;
  // requiring it here makes this setup depend on an unrelated live-status
  // refresh race.
  return account;
}

async function bootstrapAdminAccount(name: string): Promise<E2EAccount> {
  const meResponse = await fetch(`${BASE_URL}/api/me`, { headers: { cookie: adminCookie } });
  assert.equal(meResponse.status, 200, await meResponse.clone().text());
  const me = await meResponse.json() as { id: string };
  const renamed = await fetch(`${BASE_URL}/api/players/${me.id}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', cookie: adminCookie },
    body: JSON.stringify({ name }),
  });
  assert.equal(renamed.status, 200, await renamed.clone().text());
  return { id: me.id, name, cookie: adminCookie, password: E2E_ADMIN_PASSWORD };
}

before(async () => {
  const server = await startE2EServer(authenticatedServerEnv());
  e2eServer = server;
  serverProcess = server.process;
  BASE_URL = server.baseUrl;
  if (!activeShard) throw new Error('registerFlowFixture() wurde nicht aufgerufen');
  adminCookie = await loginE2EAdmin(BASE_URL);
  alice = await bootstrapAdminAccount(['community', 'food-orders'].includes(activeShard) ? 'E2E Alice Pro' : 'E2E Alice');
  bob = await createE2EAccount(BASE_URL, adminCookie, 'E2E Bob');
  accountsByName.set(alice.name, alice);
  accountsByName.set(bob.name, bob);
  // Let Playwright resolve its own installed browser (via `npx playwright
  // install chromium`, run before `npm run test:e2e`) instead of a fixed
  // path — a hardcoded path only worked in one specific pre-provisioned
  // environment and broke everywhere else, including CI.
  browser = await chromium.launch();
  page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await addSessionCookie(page.context(), BASE_URL, alice.cookie);
  // Native confirm() dialogs (vote cancel, game delete, tracking start) —
  // accept them so click-through tests don't hang.
  page.on('dialog', (d) => void d.accept());
  // Surface frontend errors in the test output — a silent JS error otherwise
  // just shows up as an unexplained selector timeout.
  page.on('pageerror', (err) => console.error('[pageerror]', err.message));
  page.on('console', (msg) => {
    if (msg.type() === 'error') console.error('[console.error]', msg.text());
  });

  await page.goto(BASE_URL);
  await page.waitForSelector('.nav-btn[data-view="home"]');
});

after(async () => {
  await browser?.close();
  serverProcess?.kill();
});

