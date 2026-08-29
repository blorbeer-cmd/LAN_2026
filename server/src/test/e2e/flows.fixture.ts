// Browser E2E test: drives the real built server + real Chromium through the
// main click paths (personal login, players, matchmaking, voting,
// leaderboard, game admin, tournament). Separate from the fast
// unit/integration suite (`npm test`) — run via `npm run test:e2e` since it
// spawns a server process and a browser, which is much slower.

import { test, before, after, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import type { ChildProcess } from 'child_process';
import { chromium, Browser, Page, type Locator } from 'playwright';
import {
  addSessionCookie,
  authenticatedServerEnv,
  createE2EAccount,
  E2E_ADMIN_PASSWORD,
  E2E_KIOSK_TOKEN,
  finishE2EOnboarding,
  loginE2EAdmin,
  type E2EAccount,
} from './authHelpers';
import { StatefulE2EDiagnosticGuard, trackE2EContext } from './e2eDiagnostics';
import { startE2EServer, type E2EServer } from './e2eServer';

let BASE_URL: string;

// The Core cross-view scenarios live in this process only. Arcade cross-view
// scenarios are kept in arcadeFlows.e2e.test.ts so changing them cannot select
// the Core browser partition.
let serverProcess: ChildProcess;
let e2eServer: E2EServer;
let browser: Browser;
let page: Page;
let adminCookie: string;
let alice: E2EAccount;
let bob: E2EAccount;
const accountsByName = new Map<string, E2EAccount>();
const flowDiagnostics = new StatefulE2EDiagnosticGuard(
  () => ({ browser, server: e2eServer }),
  { sharedState: 'server, browser context, and page' },
);

type FlowShard = 'shell' | 'competition' | 'community' | 'food-orders';

const flowShard = process.env.E2E_FLOW_SHARD as FlowShard | undefined;
if (!flowShard || !['shell', 'competition', 'community', 'food-orders'].includes(flowShard)) {
  throw new Error(`Unbekannter Core-Flow-Shard: ${flowShard ?? '(fehlt)'}`);
}

async function waitForTextDecoration(locator: Locator, expected: string): Promise<void> {
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

function flowTest(
  shard: FlowShard,
  name: string,
  fn: (context: TestContext) => void | Promise<void>,
): void {
  if (flowShard === shard) {
    // All flows in a shard intentionally share one server session and one
    // Playwright page. Running sibling tests concurrently lets one flow
    // navigate or resize that page while another is asserting it.
    test(name, { concurrency: false }, (context) =>
      flowDiagnostics.run(context, name, () => fn(context)),
    );
  }
}

async function setDateTimeField(id: string, value: string): Promise<void> {
  await page.locator(`#${id}`).evaluate((element, nextValue) => {
    (element as HTMLInputElement).value = nextValue;
  }, value);
}

async function openMatchmakingHistory(): Promise<void> {
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

async function openTeams(): Promise<void> {
  await openSectionTab('matchmaking', 'matchmaking');
}

// Auswertung (Rangliste/Statistiken/Hall of Fame) has no bottom-nav slot or
// "Mehr" entry of its own any more - it lives behind Admin's own
// "Auswertung" tool card, gated by the real admin role instead.
async function openAuswertungTab(tab: string): Promise<void> {
  await page.click('.nav-btn[data-view="more"]');
  await page.click('[data-navigate="admin"]');
  await page.click('[data-navigate="leaderboard"]');
  await page.click(`[data-section-tab="${tab}"]`);
}

async function ensureAdminMode(): Promise<void> {
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
async function openOrgaTab(tab: string): Promise<void> {
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
async function openProfile(): Promise<void> {
  const desktopEntry = page.locator('.desktop-nav-btn[data-view="profile"]');
  if (await desktopEntry.isVisible()) {
    await desktopEntry.click();
    return;
  }
  await page.click('.nav-btn[data-view="more"]');
  await page.click('[data-navigate="profile"]');
}

async function switchIdentityAndOpenArrivals(label: string): Promise<void> {
  const account = accountsByName.get(label);
  assert.ok(account, `missing E2E account for ${label}`);
  await addSessionCookie(page.context(), BASE_URL, account.cookie);
  await page.reload();
  await page.waitForSelector('#app:not([hidden])');
  await openOrgaTab('arrivals');
  await page.waitForSelector('[data-new-carpool="arrival"]');
}

async function switchIdentityAndOpenFoodOrders(label: string): Promise<void> {
  const account = accountsByName.get(label);
  assert.ok(account, `missing E2E account for ${label}`);
  await addSessionCookie(page.context(), BASE_URL, account.cookie);
  await page.reload();
  await page.waitForSelector('#app:not([hidden])');
  await page.click('#nav-food-orders');
  await page.waitForSelector('#order-new-btn');
}

async function createAccountForFlow(name: string): Promise<E2EAccount> {
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
  adminCookie = await loginE2EAdmin(BASE_URL);
  alice = await bootstrapAdminAccount(['community', 'food-orders'].includes(flowShard) ? 'E2E Alice Pro' : 'E2E Alice');
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

flowTest('shell', 'fresh device uses the personal login and reaches the app with its verified account', async (t) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await trackE2EContext(context, 'fresh-device');
  const loginPage = await context.newPage();
  t.after(async () => context.close());
  await loginPage.goto(BASE_URL);
  await loginPage.waitForSelector('#auth-screen:not([hidden])');
  await loginPage.fill('#auth-name', alice.name);
  await loginPage.fill('#auth-password', alice.password);
  await loginPage.click('#auth-form button[type="submit"]');
  await loginPage.waitForSelector('#app:not([hidden])');

  const topbarWordmark = loginPage.locator('.topbar-title .brand-title');
  assert.equal((await topbarWordmark.textContent())?.trim(), 'Respawn');
  assert.deepEqual(
    await topbarWordmark.evaluate((element) => {
      const style = getComputedStyle(element);
      return { fontStyle: style.fontStyle, transform: style.transform };
    }),
    { fontStyle: 'normal', transform: 'none' },
  );

  await loginPage.click('.nav-btn[data-view="more"]');
  await loginPage.click('[data-navigate="profile"]');
  await loginPage.waitForSelector('#profile-name');
  assert.equal(await loginPage.inputValue('#profile-name'), alice.name);
});

flowTest('shell', 'wide desktop adapts the shared shell and pilot views without changing mobile navigation', async (t) => {
  t.after(async () => {
    await page.setViewportSize({ width: 390, height: 844 });
  });

  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.click('.desktop-nav-btn[data-view="home"]');
  await page.waitForSelector('#view-container h1:text-is("Home")');

  const desktopShell = await page.evaluate(() => {
    const topbar = document.querySelector('.topbar')?.getBoundingClientRect();
    const navElement = document.querySelector('.desktop-nav');
    const nav = navElement?.getBoundingClientRect();
    const navMain = document.querySelector('.desktop-nav-main');
    const navButton = document.querySelector('.desktop-nav-btn');
    const viewElement = document.querySelector('#view-container');
    const view = viewElement?.getBoundingClientRect();
    if (!topbar || !navElement || !nav || !navMain || !navButton || !viewElement || !view) return null;
    const viewStyle = getComputedStyle(viewElement);
    return {
      nav: { left: Math.round(nav.left), top: Math.round(nav.top), right: Math.round(nav.right) },
      topbarBottom: Math.round(topbar.bottom),
      viewLeft: Math.round(view.left),
      navDirection: getComputedStyle(navElement).flexDirection,
      navMainOverflow: getComputedStyle(navMain).overflowY,
      buttonWidth: Math.round(navButton.getBoundingClientRect().width),
      navMainWidth: Math.round(navMain.getBoundingClientRect().width),
      contentWidth: Math.round(
        view.width
        - Number.parseFloat(viewStyle.paddingLeft)
        - Number.parseFloat(viewStyle.paddingRight)
      ),
    };
  });
  assert.ok(desktopShell);
  assert.equal(desktopShell.nav.left, 0);
  assert.equal(desktopShell.nav.top, desktopShell.topbarBottom);
  assert.ok(desktopShell.viewLeft >= desktopShell.nav.right);
  assert.equal(desktopShell.navDirection, 'column');
  assert.equal(desktopShell.navMainOverflow, 'auto');
  assert.ok(desktopShell.nav.right < 200);
  assert.ok(desktopShell.buttonWidth < desktopShell.navMainWidth);
  assert.ok(desktopShell.contentWidth >= 1500);
  assert.equal(await page.locator('.bottom-nav').isHidden(), true);
  assert.deepEqual(await page.locator('.desktop-nav-heading').allTextContents(), ['LAN', 'Orga', 'Sonstiges']);
  assert.equal(await page.locator('.desktop-nav-btn[data-view="more"]').count(), 0);
  assert.equal(await page.locator('.desktop-nav-btn[data-view="profile"]').isVisible(), true);
  assert.equal(await page.locator('.desktop-nav-btn[data-desktop-action="feedback"]').isVisible(), true);
  assert.equal(await page.locator('.desktop-nav-btn[data-view="admin"]').isVisible(), true);
  assert.equal(await page.locator('#feedback-btn').isHidden(), true);
  assert.equal(await page.locator('#profile-btn').count(), 0);
  assert.equal(await page.locator('.desktop-nav-btn[aria-current="page"]').getAttribute('data-view'), 'home');
  assert.equal(await page.title(), 'Home · Respawn');

  const homeColumns = await page.locator('.home-priority-grid').evaluate((layout) => ({
    display: getComputedStyle(layout).display,
    columns: getComputedStyle(layout).gridTemplateColumns.split(' ').length,
  }));
  assert.deepEqual(homeColumns, { display: 'grid', columns: 2 });
  const homeSectionFlow = await page.evaluate(() => {
    const rect = (selector: string) => document.querySelector(selector)?.getBoundingClientRect();
    const todos = rect('[aria-labelledby="home-todos-title"]');
    const live = rect('[aria-labelledby="home-live-title"]');
    const leaderboard = rect('[aria-labelledby="home-leaderboard-title"]');
    const seating = rect('[aria-labelledby="home-seating-title"]');
    const priority = rect('.home-priority-grid');
    if (!todos || !live) return null;
    return {
      todosTop: Math.round(todos.top),
      liveTop: Math.round(live.top),
      priorityBottom: priority ? Math.round(priority.bottom) : null,
      seatingGap: seating ? Math.round(seating.top - live.bottom) : null,
      leaderboardGap: leaderboard && seating ? Math.round(leaderboard.top - seating.bottom) : null,
    };
  });
  assert.ok(homeSectionFlow);
  assert.ok(homeSectionFlow.priorityBottom !== null);
  assert.ok(homeSectionFlow.liveTop > homeSectionFlow.priorityBottom);
  assert.equal(
    await page.locator('.home-live-grid').evaluate((grid) => getComputedStyle(grid).gridTemplateColumns.split(' ').length),
    3,
  );
  if (homeSectionFlow.seatingGap !== null) {
    assert.ok(homeSectionFlow.seatingGap >= 8 && homeSectionFlow.seatingGap <= 32);
  }
  if (homeSectionFlow.leaderboardGap !== null) {
    assert.ok(homeSectionFlow.leaderboardGap >= 8 && homeSectionFlow.leaderboardGap <= 32);
    assert.equal(
      await page.locator('.home-leaderboard-grid').evaluate((grid) => getComputedStyle(grid).gridTemplateColumns.split(' ').length),
      3,
    );
  }

  await page.click('.desktop-nav-btn[data-view="matchmaking"]');
  await page.waitForSelector('#view-container[data-view="matchmaking"] .tournament-player-grid');
  assert.equal(
    await page.locator('#view-container[data-view="matchmaking"] .tournament-player-grid').first()
      .evaluate((grid) => getComputedStyle(grid).gridTemplateColumns.split(' ').length),
    3,
  );
  await page.click('.desktop-nav-btn[data-view="home"]');
  await page.waitForSelector('#view-container h1:text-is("Home")');

  await page.click('.desktop-nav-btn[data-view="profile"]');
  await page.waitForSelector('#profile-name');
  assert.equal(await page.title(), 'Mein Profil · Respawn');
  assert.equal(await page.locator('.nav-btn[aria-current="page"]').getAttribute('data-view'), 'more');
  assert.equal(
    await page.locator('.desktop-nav-btn[data-view="profile"]').getAttribute('aria-current'),
    'page',
  );
  assert.equal(
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.dataset.view),
    'profile',
  );
  assert.equal(await page.locator('.more-subpage-title-row [data-navigate="more"]').isHidden(), true);
  const profileColumns = await page.locator('.profile-dashboard-columns').evaluate((layout) => {
    const account = layout.querySelector('.profile-dashboard-account')?.getBoundingClientRect();
    const lan = layout.querySelector('.profile-dashboard-lan')?.getBoundingClientRect();
    const agent = document.querySelector('[aria-labelledby="profile-agent-title"]')?.getBoundingClientRect();
    return {
      display: getComputedStyle(layout).display,
      accountLeft: account ? Math.round(account.left) : null,
      accountTop: account ? Math.round(account.top) : null,
      lanLeft: lan ? Math.round(lan.left) : null,
      lanTop: lan ? Math.round(lan.top) : null,
      agentWidth: agent ? Math.round(agent.width) : null,
      layoutWidth: Math.round(layout.getBoundingClientRect().width),
    };
  });
  assert.equal(profileColumns.display, 'grid');
  assert.ok(profileColumns.accountLeft !== null && profileColumns.lanLeft !== null);
  assert.ok(profileColumns.lanLeft > profileColumns.accountLeft);
  assert.equal(profileColumns.lanTop, profileColumns.accountTop);
  assert.equal(profileColumns.agentWidth, profileColumns.layoutWidth);

  await page.goBack();
  await page.waitForSelector('#view-container h1:text-is("Home")');
  assert.equal(await page.evaluate(() => document.activeElement?.textContent?.trim()), 'Home');

  await page.click('.desktop-nav-btn[data-view="admin"]');
  await page.waitForSelector('#admin-tools-title');
  assert.equal(await page.locator('.desktop-nav-btn[aria-current="page"]').getAttribute('data-view'), 'admin');
  const adminColumnsHandle = await page.waitForFunction(() => {
    const overview = document.querySelector('.admin-dashboard-overview');
    const access = document.querySelector('.admin-dashboard-access');
    const tools = overview?.querySelector('[aria-labelledby="admin-tools-title"]')?.getBoundingClientRect();
    const readiness = overview?.querySelector('[aria-labelledby="admin-readiness-title"]')?.getBoundingClientRect();
    const users = document.querySelector('[aria-labelledby="admin-players-title"]')?.getBoundingClientRect();
    if (!overview?.isConnected || !access?.isConnected || getComputedStyle(overview).display !== 'grid' || !tools || !readiness || !users) return null;
    return {
      display: getComputedStyle(overview).display,
      toolsLeft: Math.round(tools.left),
      toolsTop: Math.round(tools.top),
      readinessLeft: Math.round(readiness.left),
      readinessTop: Math.round(readiness.top),
      usersTop: Math.round(users.top),
      accessBottom: Math.round(access.getBoundingClientRect().bottom),
    };
  });
  const adminColumns = await adminColumnsHandle.jsonValue();
  assert.ok(adminColumns);
  assert.equal(adminColumns.display, 'grid');
  assert.ok(adminColumns.readinessLeft > adminColumns.toolsLeft);
  assert.equal(adminColumns.readinessTop, adminColumns.toolsTop);
  assert.ok(adminColumns.usersTop - adminColumns.accessBottom >= 8);
  assert.ok(adminColumns.usersTop - adminColumns.accessBottom <= 32);
  assert.equal(
    await page.locator('.admin-player-list').evaluate((grid) => getComputedStyle(grid).gridTemplateColumns.split(' ').length),
    3,
  );

  await page.click('.desktop-nav-btn[data-view="arcade"]');
  await page.waitForSelector('#arcade-games-title');
  assert.equal(await page.locator('.desktop-nav-btn[aria-current="page"]').getAttribute('data-view'), 'arcade');
  await page.click('[data-game="quiz"]');
  await page.waitForSelector('#arcade-active-game-title');
  const arcadeColumnsHandle = await page.waitForFunction(() => {
    const layout = document.querySelector('.arcade-desktop-layout');
    if (!layout?.isConnected || getComputedStyle(layout).display !== 'grid') return null;
    const active = layout.querySelector('[aria-labelledby="arcade-active-game-title"]')?.getBoundingClientRect();
    const picker = layout.querySelector('.arcade-game-picker')?.getBoundingClientRect();
    if (!active || !picker) return null;
    return {
      display: getComputedStyle(layout).display,
      activeLeft: Math.round(active.left),
      activeTop: Math.round(active.top),
      pickerLeft: Math.round(picker.left),
      pickerTop: Math.round(picker.top),
    };
  });
  const arcadeColumns = await arcadeColumnsHandle.jsonValue();
  assert.ok(arcadeColumns);
  assert.equal(arcadeColumns.display, 'grid');
  assert.ok(arcadeColumns.activeLeft !== null && arcadeColumns.pickerLeft !== null);
  assert.ok(arcadeColumns.pickerLeft > arcadeColumns.activeLeft);
  assert.equal(arcadeColumns.pickerTop, arcadeColumns.activeTop);

  await page.click('.desktop-nav-btn[data-view="profile"]');
  await page.waitForSelector('button[data-layout-preference="laptop"]');
  await page.click('button[data-layout-preference="laptop"]');
  await page.waitForFunction(() => document.documentElement.dataset.layoutMode === 'laptop');
  assert.equal(await page.getAttribute('html', 'data-layout-preference'), 'laptop');
  assert.equal(await page.locator('button[data-layout-preference="laptop"]').getAttribute('aria-pressed'), 'true');
  assert.equal(await page.locator('.desktop-nav').isHidden(), true);
  assert.equal(await page.locator('.bottom-nav').isVisible(), true);
  assert.equal(await page.locator('.profile-dashboard-columns').evaluate((layout) => getComputedStyle(layout).display), 'flex');

  // The choice survives a reload in the current session.
  await page.reload();
  await page.waitForSelector('#app:not([hidden])');
  assert.equal(await page.getAttribute('html', 'data-layout-mode'), 'laptop');
  assert.equal(await page.getAttribute('html', 'data-layout-preference'), 'laptop');
  await page.click('button[data-layout-preference="desktop"]');
  await page.waitForFunction(() => document.documentElement.dataset.layoutMode === 'desktop');
  assert.equal(await page.locator('.desktop-nav').isVisible(), true);
  assert.equal(await page.locator('.bottom-nav').isHidden(), true);
  await page.click('.desktop-nav-btn[data-view="arcade"]');
  await page.waitForSelector('.arcade-desktop-layout');

  // A separate session verifies a real logout/login without invalidating the
  // fixture's shared admin cookie for the tests that follow. The same account
  // gets the same browser-side preference back before #app becomes visible.
  const persistenceContext = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  await trackE2EContext(persistenceContext, 'layout-mode-persistence');
  const persistencePage = await persistenceContext.newPage();
  try {
    await persistencePage.goto(BASE_URL);
    await persistencePage.waitForSelector('#auth-screen:not([hidden])');
    await persistencePage.fill('#auth-name', alice.name);
    await persistencePage.fill('#auth-password', alice.password);
    await persistencePage.click('#auth-form button[type="submit"]');
    await persistencePage.waitForSelector('#app:not([hidden])');
    await persistencePage.goto(`${BASE_URL}/#profile`);
    await persistencePage.waitForSelector('button[data-layout-preference="laptop"]');
    await persistencePage.click('button[data-layout-preference="laptop"]');
    await persistencePage.waitForFunction(() => document.documentElement.dataset.layoutMode === 'laptop');
    await persistencePage.click('#profile-logout');
    await persistencePage.waitForSelector('#auth-screen:not([hidden])');
    await persistencePage.fill('#auth-name', alice.name);
    await persistencePage.fill('#auth-password', alice.password);
    await persistencePage.click('#auth-form button[type="submit"]');
    await persistencePage.waitForSelector('#app:not([hidden])');
    assert.equal(await persistencePage.getAttribute('html', 'data-layout-mode'), 'laptop');
    assert.equal(await persistencePage.getAttribute('html', 'data-layout-preference'), 'laptop');
    assert.equal(await persistencePage.locator('.bottom-nav').isVisible(), true);

    // The storage key is scoped by account id (see layoutMode.js), so a
    // different account logging in on this same device/browser must not
    // inherit alice's stored "laptop" choice.
    await persistencePage.click('#profile-logout');
    await persistencePage.waitForSelector('#auth-screen:not([hidden])');
    await persistencePage.fill('#auth-name', bob.name);
    await persistencePage.fill('#auth-password', bob.password);
    await persistencePage.click('#auth-form button[type="submit"]');
    await persistencePage.waitForSelector('#app:not([hidden])');
    assert.equal(await persistencePage.getAttribute('html', 'data-layout-preference'), 'auto');
    assert.equal(await persistencePage.getAttribute('html', 'data-layout-mode'), 'desktop');
    assert.equal(await persistencePage.locator('.desktop-nav').isVisible(), true);
  } finally {
    await persistenceContext.close();
  }

  await page.click('.desktop-nav-btn[data-view="profile"]');
  await page.click('button[data-layout-preference="auto"]');
  await page.waitForFunction(() => document.documentElement.dataset.layoutPreference === 'auto' && document.documentElement.dataset.layoutMode === 'desktop');
  await page.click('.desktop-nav-btn[data-view="arcade"]');
  await page.waitForSelector('.arcade-desktop-layout');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForFunction(() => document.documentElement.dataset.layoutMode === 'laptop');
  const mobileShell = await page.evaluate(() => {
    const nav = document.querySelector('.bottom-nav')?.getBoundingClientRect();
    const navInner = document.querySelector('.bottom-nav-inner');
    const desktopNav = document.querySelector('.desktop-nav');
    const arcadeLayout = document.querySelector('.arcade-desktop-layout');
    if (!nav || !navInner || !desktopNav || !arcadeLayout) return null;
    return {
      navBottom: Math.round(nav.bottom),
      navWidth: Math.round(nav.width),
      navDirection: getComputedStyle(navInner).flexDirection,
      desktopNavDisplay: getComputedStyle(desktopNav).display,
      arcadeDisplay: getComputedStyle(arcadeLayout).display,
    };
  });
  assert.ok(mobileShell);
  assert.equal(mobileShell.navBottom, 844);
  assert.equal(mobileShell.navWidth, 390);
  assert.equal(mobileShell.navDirection, 'row');
  assert.equal(mobileShell.desktopNavDisplay, 'none');
  assert.equal(mobileShell.arcadeDisplay, 'flex');
  assert.equal(await page.locator('#feedback-btn').isVisible(), true);
  assert.equal(await page.locator('.nav-btn:not([hidden])').count(), 6);
});

flowTest('shell', 'Umfragen: works for the permanently open "Allgemein" base event without forcing an event switch', async () => {
  await openOrgaTab('eventPolls');
  await page.waitForSelector('#new-event-poll');
  assert.equal(await page.locator('#choose-event-context').count(), 0);
  assert.equal((await page.locator('.empty-state-title').textContent())?.trim(), 'Noch keine Umfrage');
});

flowTest('shell', 'untabbed areas align compact cards while tabbed areas reserve a second row', async (t) => {
  t.after(async () => {
    await page.setViewportSize({ width: 390, height: 844 });
  });

  type CardMetrics = {
    top: number;
    headingMetrics: { fontSize: string; inset: number } | null;
  };
  const firstCardMetrics = async (label: string): Promise<CardMetrics> => {
    const metrics = await page.waitForFunction((areaLabel) => {
      const container = document.querySelector('#view-container');
      if (!container) return null;
      const card = container.querySelector('.card');
      if (!card) return null;
      const cardBox = card.getBoundingClientRect();
      if (!cardBox.width || !cardBox.height) return null;
      const heading = card.querySelector('h2');
      const headingMetrics = heading
        ? {
            fontSize: getComputedStyle(heading).fontSize,
            inset: Math.round(heading.getBoundingClientRect().top - cardBox.top),
          }
        : null;
      // Relative to the scroll box, not the viewport: #view-container is the
      // element that scrolls, so a raw viewport y compares "edge minus
      // scroll offset" across areas and would differ purely because one view
      // happened to be scrolled. The comparisons below (one shared edge, and
      // a tabbed header reserving more room) are about the edge itself.
      const top = Math.round(cardBox.top - container.getBoundingClientRect().top + container.scrollTop);
      return { label: areaLabel, top, headingMetrics };
    }, label);
    const value = await metrics.jsonValue();
    assert.ok(value, `${label} should render a first card`);
    return { top: value.top, headingMetrics: value.headingMetrics };
  };

  for (const width of [390, 900]) {
    await page.setViewportSize({ width, height: 844 });
    const metrics: Array<[string, CardMetrics]> = [];
    const tabbedMetrics: Array<[string, CardMetrics]> = [];

    await page.click('.nav-btn[data-view="matchmaking"]');
    await page.waitForSelector('#view-container h1:text-is("Match")');
    tabbedMetrics.push(['Match', await firstCardMetrics('Match')]);

    for (const [view, title] of [
      ['home', 'Home'],
      ['votes', 'Vote'],
      ['foodOrders', 'Essen'],
      ['gameCatalog', 'Spiele'],
      ['more', 'Mehr'],
    ] as const) {
      await page.click(`.nav-btn[data-view="${view}"]`);
      await page.waitForSelector(`#view-container h1:text-is("${title}")`);
      metrics.push([title, await firstCardMetrics(title)]);
    }

    for (const [view, title, readySelector] of [
      ['profile', 'Mein Profil', '#profile-name'],
      ['admin', 'Admin', '#admin-mode-title'],
      ['arcade', 'Arcade', '#arcade-games-title'],
      ['broadcast', 'Durchsage', '#broadcast-new-title'],
      ['music', 'Jam', '#music-setup-title'],
    ] as const) {
      await page.click('.nav-btn[data-view="more"]');
      await page.waitForSelector('.more-grid');
      await page.click(`[data-navigate="${view}"]`);
      await page.waitForSelector(readySelector);
      metrics.push([title, await firstCardMetrics(title)]);
      const backButton = page.locator('.more-subpage-header [data-navigate="more"]');
      assert.equal(await backButton.count(), 1);
      assert.equal((await backButton.textContent())?.trim(), 'Zurück');
      assert.equal(await backButton.locator('svg').count(), 1);
    }

    const alignedTops = new Set(metrics.map(([, value]) => value.top));
    assert.equal(
      alignedTops.size,
      1,
      `all compact areas should share one first-card edge at ${width}px: ${JSON.stringify(metrics)}`,
    );

    const headingMetrics = metrics
      .map(([, value]) => value.headingMetrics)
      .filter((value): value is NonNullable<CardMetrics['headingMetrics']> => value !== null);
    assert.equal(new Set(headingMetrics.map((value) => value.fontSize)).size, 1);
    assert.equal(new Set(headingMetrics.map((value) => value.inset)).size, 1);

    await page.click('.nav-btn[data-view="more"]');
    await page.waitForSelector('.more-grid');
    await page.click('[data-navigate="admin"]');
    await page.waitForSelector('#admin-mode-title');
    await page.click('[data-navigate="leaderboard"]');
    await page.waitForSelector('#view-container h1:text-is("Auswertung")');
    tabbedMetrics.push(['Auswertung', await firstCardMetrics('Auswertung')]);

    await openOrgaTab('events');
    await page.waitForSelector('#orga-events-title');
    assert.deepEqual(
      await page.locator('.more-subpage-header--tabs .section-tabs').evaluate((tabs) => {
        const style = getComputedStyle(tabs);
        return { marginTop: style.marginTop, marginBottom: style.marginBottom };
      }),
      { marginTop: '0px', marginBottom: '0px' },
      `Orga's tab row should not add spacing outside the shared header at ${width}px`,
    );
    const orgaMetrics = await firstCardMetrics('Orga');
    tabbedMetrics.push(['Orga', orgaMetrics]);
    for (const [title, value] of tabbedMetrics) {
      assert.ok(value.top > metrics[0][1].top, `${title} tabs should reserve their own row at ${width}px`);
      if (value.headingMetrics) assert.deepEqual(value.headingMetrics, headingMetrics[0]);
    }
    if (width === 900) {
      assert.equal(
        new Set(tabbedMetrics.map(([, value]) => value.top)).size,
        1,
        `desktop tabbed areas should share one first-card edge: ${JSON.stringify(tabbedMetrics)}`,
      );
    }
    assert.equal(await page.locator('.more-subpage-header--tabs [data-navigate="more"]').count(), 1);
    await page.click('.more-subpage-header--tabs [data-navigate="more"]');
    await page.waitForSelector('.more-grid');
  }
});

flowTest('shell', 'Orga Events tab and Profil use grouped help while admin tools stay out of regular Orga', async (t) => {
  // Switches to a desktop viewport partway through (for the desktop-only
  // profile layout checks below) and never switches back on its own —
  // relying on a later test happening to reset it first. If this test
  // throws before reaching that point, or a later test that resets it
  // (e.g. "global search...") fails before its own reset runs, every test
  // in between silently keeps running at the wrong viewport size, which
  // reads as an unrelated mobile-layout assertion failure. Restore the
  // shared page's actual default (see the `before()` above) regardless of
  // how this test ends.
  t.after(async () => {
    await page.setViewportSize({ width: 390, height: 844 });
  });
  await openOrgaTab('events');
  await page.waitForSelector('#orga-events-title');
  assert.equal(await page.locator('.grouped-page-sections > .grouped-page-section').count(), 1);
  assert.equal(await page.locator('[data-navigate="seating"]').count(), 0);
  assert.equal(await page.locator('#download-backup').count(), 0);

  await page.click('[aria-label="Mehr Informationen zu Events"]');
  await page.waitForSelector('#orga-events-help:not([hidden])');
  await page.click('[aria-label="Mehr Informationen zu Events"]');
  assert.equal((await page.locator('#new-event-btn').textContent())?.trim(), 'Event anlegen');
  await page.click('#new-event-btn');
  assert.equal(await page.getByText('Tracking', { exact: true }).count(), 0);
  assert.equal(await page.locator('#event-cost').count(), 1);
  assert.equal(await page.locator('#event-paypal').count(), 1);
  assert.equal(await page.locator('#event-payment-due').count(), 1);
  assert.equal(await page.locator('#event-cost.food-order-price-input').count(), 1);
  assert.equal(
    await page.locator('.food-order-paypal-label label[for="event-accommodation-cost"]').textContent(),
    'Gesamtpreis Unterkunft',
  );
  assert.equal(await page.locator('.food-order-paypal-label label[for="event-paypal"]').textContent(), 'PayPal');
  assert.equal(
    await page.locator('.food-order-paypal-label label[for="event-payment-due-date"]').textContent(),
    'Zahlungsziel',
  );
  assert.equal(await page.locator('#event-starts-date[placeholder="TT.MM.JJJJ"]').count(), 1);
  assert.equal(await page.locator('#event-starts-time[placeholder="HH:MM"]').count(), 1);
  assert.equal(await page.locator('#event-ends-date[placeholder="TT.MM.JJJJ"]').count(), 1);
  assert.equal(await page.locator('#event-ends-time[placeholder="HH:MM"]').count(), 1);
  assert.equal(await page.locator('#event-starts-time').evaluate((element) => element.tagName), 'INPUT');
  assert.equal(await page.locator('[data-dt-field="event-starts"] select').count(), 0);

  const invalidEnd = new Date(Date.now() - 86_400_000);
  const invalidEndLabel = `${String(invalidEnd.getDate()).padStart(2, '0')}.${String(invalidEnd.getMonth() + 1).padStart(2, '0')}.${invalidEnd.getFullYear()}`;
  await page.fill('#event-ends-date', invalidEndLabel);
  await page.locator('#event-ends-date').blur();
  assert.equal(await page.locator('#event-ends-date').getAttribute('aria-invalid'), 'true');
  assert.equal(await page.locator('#event-ends-error').textContent(), 'Das Ende muss nach dem Beginn liegen.');
  await page.click('[data-dt-field="event-ends"] [data-dt-trigger]');
  await page.waitForSelector('.dt-popover');
  assert.ok(await page.locator('.dt-popover [data-dt-day]:disabled').count() > 0, 'days before the event start are disabled');
  const visibleMonth = await page.locator('.dt-popover [data-dt-month]').textContent();
  const focusedDay = await page.locator('.dt-popover [data-dt-day]:focus').getAttribute('data-dt-day');
  await page.keyboard.press('PageUp');
  assert.equal(await page.locator('.dt-popover [data-dt-month]').textContent(), visibleMonth, 'PageUp cannot enter a fully disabled month');
  assert.equal(await page.locator('.dt-popover [data-dt-day]:focus').getAttribute('data-dt-day'), focusedDay, 'calendar focus remains on the enabled day');
  await page.keyboard.press('Escape');
  await page.fill('#event-starts-date', '08072027');
  await page.fill('#event-starts-time', '1435');
  assert.equal(await page.inputValue('#event-starts-date'), '08.07.2027');
  assert.equal(await page.inputValue('#event-starts-time'), '14:35');
  assert.equal(await page.locator('.event-payment-label').count(), 0);
  assert.match(await page.locator('#event-paypal').getAttribute('placeholder') ?? '', /E-Mail-Adresse/);
  await page.click('.modal[aria-label="Neues Event"] [data-close]');
  // TV-Kiosk is not an Orga tab (only "Kioskverwaltung" in Admin reaches it,
  // see "the authenticated admin role owns the seating editor and backup
  // tools" below) — Orga itself only ever exposes these five tabs, sorted
  // alphabetically by their German label.
  assert.deepEqual(
    await page.locator('.section-tabs [data-section-tab]').evaluateAll((tabs) => tabs.map((tab) => tab.dataset.sectionTab)),
    ['eventPolls', 'arrivals', 'events', 'checklistPacking', 'checklist']
  );

  await page.setViewportSize({ width: 1280, height: 900 });
  await page.waitForFunction(() => document.documentElement.dataset.layoutMode === 'desktop');
  await openProfile();
  await page.waitForSelector('#profile-name');
  assert.equal(await page.locator('.profile-agent-step').count(), 3);
  assert.equal(await page.locator('#push-toggle[type="checkbox"]').count(), 1);
  assert.equal(await page.locator('label:has(#push-toggle) > span').getByText('Aktivieren', { exact: true }).count(), 1);
  assert.equal(await page.locator('#profile-tracking-pause-help').count(), 1);
  assert.equal(await page.locator('#profile-activity-tracking-help').count(), 1);
  assert.equal(await page.locator('.profile-agent-step').first().locator('#tracking-paused').count(), 1);
  assert.equal(await page.locator('label[for="profile-name"]').textContent(), 'Gamertag');
  assert.equal(await page.locator('label[for="profile-real-name"]').textContent(), 'Name');
  assert.equal(await page.locator('.profile-avatar-editor .field-label').count(), 0);
  assert.equal(await page.locator('label[for="profile-color-trigger"]').textContent(), 'Farbe');
  assert.equal(await page.locator('.profile-color-trigger').count(), 1);
  assert.equal(await page.locator('.profile-color-trigger').evaluate((element) => getComputedStyle(element).borderRadius), '8px');
  assert.equal(await page.locator('input[type="color"]').count(), 0);
  assert.equal(await page.locator('.profile-identity-fields').evaluate((element) => getComputedStyle(element).gridTemplateColumns.split(' ').length), 4);
  const identityFieldCenters = await page.locator('.profile-identity-fields').evaluate((editor) => {
    const controls = [
      editor.querySelector('.profile-avatar-control'),
      editor.querySelector('.profile-color-trigger'),
      editor.querySelector('#profile-name'),
      editor.querySelector('#profile-real-name'),
    ];
    if (controls.some((control) => !control)) return [];
    return controls.map((control) => {
      const box = control!.getBoundingClientRect();
      return box.top + box.height / 2;
    });
  });
  assert.equal(identityFieldCenters.length, 4);
  // Inline line-box rounding differs slightly across Windows font/rendering
  // versions. A 2px center delta is visually aligned and must not make the
  // otherwise unrelated end-to-end suite flaky.
  assert.ok(
    Math.round((Math.max(...identityFieldCenters) - Math.min(...identityFieldCenters)) * 10) / 10 <= 2,
    `profile identity controls should remain vertically aligned: ${JSON.stringify(identityFieldCenters)}`,
  );
  const originalProfileColor = await page.inputValue('#profile-color');
  await page.click('#profile-color-trigger');
  await page.waitForSelector('.profile-color-picker-modal .profile-color-picker-wheel');
  assert.equal(await page.locator('.profile-color-preset').count(), 0);
  await page.locator('.profile-color-picker-modal .modal').evaluate((element) => Promise.all(element.getAnimations().map((animation) => animation.finished)));
  const colorModal = await page.locator('.profile-color-picker-modal .modal').boundingBox();
  assert.ok(colorModal && Math.abs(colorModal.x + colorModal.width / 2 - 640) < 2 && Math.abs(colorModal.y + colorModal.height / 2 - 450) < 2);
  await page.locator('.profile-color-picker-wheel').press('ArrowRight');
  const keyboardColor = await page.inputValue('.profile-color-picker-value');
  assert.notEqual(keyboardColor, originalProfileColor.toUpperCase());
  await page.fill('.profile-color-picker-value', 'ungueltig');
  assert.equal(await page.locator('.profile-color-picker-value').getAttribute('aria-invalid'), 'true');
  assert.equal(await page.locator('.profile-color-picker-copy').isDisabled(), true);
  assert.equal(await page.locator('[data-profile-color-apply]').isDisabled(), true);
  assert.equal(await page.locator('.profile-color-picker-error').isVisible(), true);
  await page.fill('.profile-color-picker-value', '12abef');
  assert.equal(await page.locator('.profile-color-picker-value').getAttribute('aria-invalid'), 'false');
  assert.equal(await page.locator('.profile-color-picker-copy').isEnabled(), true);
  assert.equal(await page.locator('[data-profile-color-apply]').isEnabled(), true);
  assert.equal(await page.locator('.profile-color-picker-error').isHidden(), true);
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: async (value: string) => { (window as Window & { copiedProfileColor?: string }).copiedProfileColor = value; } },
    });
  });
  await page.click('.profile-color-picker-copy');
  assert.equal(await page.evaluate(() => (window as Window & { copiedProfileColor?: string }).copiedProfileColor), '#12ABEF');
  await page.click('[data-profile-color-cancel]');
  assert.equal(await page.inputValue('#profile-color'), originalProfileColor);
  await page.click('#profile-color-trigger');
  await page.fill('.profile-color-picker-value', '#12ABEF');
  const appliedColor = (await page.inputValue('.profile-color-picker-value')).toLowerCase();
  await page.click('[data-profile-color-apply]');
  assert.equal(await page.inputValue('#profile-color'), appliedColor);
  assert.equal(await page.getByText('Erweitertes Tracking', { exact: true }).count(), 1);
  const profileSectionKeys = ['password', 'push', 'monitors', 'agent'];
  assert.deepEqual(
    await page.locator('[data-profile-section]').evaluateAll((sections) =>
      sections.map((section) => ({ key: (section as HTMLElement).dataset.profileSection, open: (section as HTMLDetailsElement).open })),
    ),
    profileSectionKeys.map((key) => ({ key, open: true })),
    'profile groups should start expanded',
  );
  await page.click('[data-profile-section="push"] > summary');
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('respawn:rerender')));
  assert.equal(
    await page.locator('[data-profile-section="push"]').getAttribute('open'),
    null,
    'a manually collapsed profile group should stay collapsed across a view re-render',
  );
  assert.equal(await page.locator('.profile-identity-editor').evaluate((element) => element.scrollWidth <= element.clientWidth), true);
  assert.equal(await page.getByText('Auf diesem Gerät aus.', { exact: true }).count(), 0);
  assert.equal(await page.getByText('Auf diesem Gerät aktiv.', { exact: true }).count(), 0);
});

flowTest('shell', 'the authenticated admin role owns the seating editor and backup tools', async (t) => {
  t.after(async () => {
    // This test switches to a desktop viewport for the pool-column check;
    // always restore the shared page's mobile default regardless of how the
    // test ends (same viewport-leak safety net as the Orga Events test).
    await page.setViewportSize({ width: 390, height: 844 });
  });
  const assertCompactAdminHeader = async (title: string) => {
    const header = page.locator('.more-subpage-header');
    assert.equal(await header.count(), 1);
    assert.equal(await header.locator('.more-subpage-title-row h1.view-title').innerText(), title);
    assert.equal(await header.locator('[data-navigate="admin"]').count(), 1);
    // #view-container is itself the scroll box (overflow-y: auto in
    // style.css), so comparing two viewport rects measures "inset minus
    // however far the view happens to be scrolled" rather than the layout
    // inset this asserts. switchView() resets scrollTop, but only around the
    // synchronous render — these admin views show a loading state first and
    // swap in their real content from an async fetch, and the reload() above
    // lets the browser restore a scroll offset of its own. A leftover offset
    // of 124px is what produced the reported -56 (68 - 124).
    //
    // Adding scrollTop back makes this measure the inset itself, so it stays
    // exact and still fails on a real layout change - it just no longer
    // depends on an unrelated variable the test never controlled. Querying
    // the card inside the same evaluation additionally keeps resolution and
    // measurement in one task, so an async re-render cannot land between them.
    const cardInset = await page.evaluate(() => {
      const container = document.querySelector('#view-container');
      if (!container) throw new Error('View container missing');
      const card = container.querySelector('.card');
      if (!card) throw new Error('No card rendered inside the view container');
      return Math.round(
        card.getBoundingClientRect().top - container.getBoundingClientRect().top + container.scrollTop,
      );
    });
    assert.equal(cardInset, 68, `${title} should share the compact first-card inset`);
  };
  // The bootstrap admin is intentionally created before onboarding is
  // completed. Finish it here so the deep-link assertions exercise the
  // admin-role load race instead of the onboarding tour taking over the
  // requested initial view.
  await finishE2EOnboarding(BASE_URL, adminCookie);
  await addSessionCookie(page.context(), BASE_URL, adminCookie);
  await page.goto(`${BASE_URL}/#adminFeatureUsage`);
  // Playwright may treat a hash-only goto as same-document navigation when
  // the shared page is already on the app root. Reload to exercise the real
  // startup path that a bookmarked hash link uses.
  await page.reload();
  await page.waitForSelector('#admin-feature-usage-title');
  await assertCompactAdminHeader('Nutzungsauswertung');
  await page.goto(`${BASE_URL}/#adminFeedback`);
  await page.reload();
  await page.waitForSelector('#admin-feedback-title');
  await assertCompactAdminHeader('Feedback');
  // A regular member must not see the admin content behind the same deep link.
  const memberContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const memberPage = await memberContext.newPage();
  try {
    await addSessionCookie(memberContext, BASE_URL, bob.cookie);
    await memberPage.goto(`${BASE_URL}/#adminFeatureUsage`);
    await memberPage.waitForFunction(() => {
      const container = document.querySelector('#view-container');
      return Boolean(
        container?.querySelector('#admin-feature-usage-title')
        || container?.querySelector('#order-new-btn')
        || container?.textContent?.includes('Dieses Konto hat keine Admin-Rechte.'),
      );
    });
    assert.equal(await memberPage.locator('#admin-feature-usage-title').count(), 0);
  } finally {
    await memberContext.close();
  }
  // The same role gate applies to the wide-viewport desktop rail, which
  // filters `.desktop-nav-btn` entries independently of the old bottom-nav
  // "more" list — a regular member must not see the Admin destination there.
  const wideMemberContext = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const wideMemberPage = await wideMemberContext.newPage();
  try {
    await addSessionCookie(wideMemberContext, BASE_URL, bob.cookie);
    await wideMemberPage.goto(BASE_URL);
    await wideMemberPage.waitForSelector('#app:not([hidden])');
    await wideMemberPage.waitForFunction(() => document.documentElement.dataset.layoutMode === 'desktop');
    await wideMemberPage.waitForSelector('.desktop-nav-btn[data-view]');
    assert.equal(await wideMemberPage.locator('.desktop-nav-btn[data-view="admin"]').count(), 0);
  } finally {
    await wideMemberContext.close();
  }
  await page.click('.nav-btn[data-view="more"]');
  await page.click('[data-navigate="admin"]');
  await ensureAdminMode();
  await page.waitForSelector('#admin-tools-title');
  assert.equal(await page.locator('#download-backup').count(), 1);
  assert.equal(await page.locator('[data-navigate="seating"]').count(), 1);
  assert.equal(await page.locator('[data-navigate="seating"]').textContent(), 'Öffnen');
  assert.ok(await page.locator('[data-navigate="seating"]').evaluate((element) => element.classList.contains('btn-primary')));
  assert.equal(await page.locator('#admin-seating-help').count(), 0);
  assert.equal(await page.locator('#admin-backup-help').count(), 0);
  assert.equal(await page.locator('[aria-label$="Test-Spieler vorhanden"]').count(), 1);
  assert.equal(await page.locator('#admin-test-data-help').count(), 1);
  // Global Event management is reachable from Admin's tool grid too, not
  // only through Orga's own "Events" tab. Kiosk management, by contrast, is
  // only reachable from here — it is not an Orga tab at all.
  assert.equal(await page.locator('[data-navigate="events"]').count(), 1);
  assert.equal(await page.locator('#admin-event-help').count(), 0);
  assert.equal(await page.locator('[data-navigate="kiosk"]').count(), 1);
  assert.equal(await page.locator('#admin-kiosk-help').count(), 0);
  // Auswertung (Rangliste/Statistiken/Hall of Fame) is reachable only from
  // here — it has no bottom-nav slot or "Mehr" entry of its own any more.
  assert.equal(await page.locator('[data-navigate="leaderboard"]').count(), 1);
  assert.equal(await page.locator('[data-navigate="adminFeatureUsage"]').count(), 1);
  assert.equal(await page.locator('[data-navigate="adminFeedback"]').count(), 1);
  assert.equal(await page.locator('#admin-feature-usage-title').count(), 0);
  assert.equal(await page.locator('#admin-feedback-title').count(), 0);
  assert.equal(await page.locator('.admin-tool-row').count(), 7);
  await page.click('[data-navigate="adminFeatureUsage"]');
  await page.waitForSelector('#admin-feature-usage-title');
  assert.equal(await page.locator('#admin-feedback-title').count(), 0);
  await page.click('[data-navigate="admin"]');
  await page.waitForSelector('#admin-tools-title');
  await page.click('[data-navigate="adminFeedback"]');
  await page.waitForSelector('#admin-feedback-title');
  assert.equal(await page.locator('#admin-feature-usage-title').count(), 0);
  await page.click('[data-navigate="admin"]');
  await page.waitForSelector('#admin-tools-title');
  await page.click('[data-navigate="kiosk"]');
  await page.waitForSelector('a[href="/kiosk.html"]');
  await assertCompactAdminHeader('TV-Kiosk');
  assert.equal(await page.getByRole('heading', { name: 'TV-Kiosk' }).count(), 1);
  assert.equal(await page.locator('.grouped-page-sections > .grouped-page-section').count(), 1);
  assert.equal(await page.locator('#orga-kiosk-help').count(), 1);
  await page.click('[data-navigate="admin"]');
  await page.waitForSelector('#admin-tools-title');
  assert.equal(await page.locator('.admin-test-controls > *').count(), 3);
  assert.equal(await page.locator('#admin-cleanup').textContent(), 'Test-Daten aufräumen');
  // The count field's own id now sits one level down, inside the
  // `.number-stepper` wrapper numberStepper.js adds around every
  // `input[type="number"]` (see DESIGN_SYSTEM.md's "Number stepper" entry).
  assert.deepEqual(await page.locator('.admin-test-controls > *').evaluateAll((controls) => controls.map((control) => control.querySelector('#admin-count') ? 'admin-count' : control.id)), ['admin-count', 'admin-cleanup', 'admin-bulk']);
  // Rounded: getBoundingClientRect() can return a sub-pixel value like
  // 35.999969482421875 for an intended 36px depending on the browser's
  // layout rounding, which a strict-equality assertion here flakes on.
  assert.equal(await page.locator('#admin-count').evaluate((input) => Math.round(input.getBoundingClientRect().height)), 36);
  assert.equal(await page.locator('.admin-test-controls').evaluate((element) => element.scrollWidth <= element.clientWidth), true);
  // The overlay stepper buttons adjust the value by click...
  await page.fill('#admin-count', '5');
  await page.click('.admin-test-controls .number-stepper-btn[aria-label="Wert erhöhen"]');
  assert.equal(await page.locator('#admin-count').inputValue(), '6');
  await page.click('.admin-test-controls .number-stepper-btn[aria-label="Wert verringern"]');
  await page.click('.admin-test-controls .number-stepper-btn[aria-label="Wert verringern"]');
  assert.equal(await page.locator('#admin-count').inputValue(), '4');
  // ...and mouse-wheel scrolling over the focused field no longer changes it
  // (the field blurs itself on wheel instead of applying the native step).
  await page.focus('#admin-count');
  assert.equal(await page.locator('#admin-count').evaluate((input) => document.activeElement === input), true);
  await page.locator('#admin-count').dispatchEvent('wheel', { deltaY: -100 });
  assert.equal(await page.locator('#admin-count').inputValue(), '4');
  assert.equal(await page.locator('#admin-count').evaluate((input) => document.activeElement === input), false);
  await page.click('[data-navigate="seating"]');
  await page.waitForSelector('.seating-plan.is-editable');
  await assertCompactAdminHeader('Sitzplan');
  assert.equal(await page.locator('.seating-editor > .grouped-page-section').count(), 3);
  assert.deepEqual(await page.locator('.seating-editor > .grouped-page-section h2 > span:first-child, .seating-editor > .grouped-page-section h2:not(:has(> span:first-child))').allTextContents(), ['Sitzplan', 'Teilnehmende', 'Konfiguration']);
  assert.equal(await page.locator('.seating-pool-player').evaluateAll((players) => players.every((player) => getComputedStyle(player).borderRadius !== '999px')), true);
  // The unassigned-player pool is one column on phones and two from --bp-md
  // (DESIGN_SYSTEM.md: "phones keep one column"). The old bare 2-column
  // assertion only ever passed while a desktop viewport leaked in from the
  // Orga Events test; check both documented layouts explicitly instead.
  assert.equal(await page.locator('.seating-player-pool').evaluate((pool) => getComputedStyle(pool).gridTemplateColumns.split(' ').length), 1);
  await page.setViewportSize({ width: 900, height: 844 });
  assert.equal(await page.locator('.seating-player-pool').evaluate((pool) => getComputedStyle(pool).gridTemplateColumns.split(' ').length), 2);
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok((await page.locator('.seating-seat:not(.is-occupied)').count()) > 0);
  assert.equal(await page.locator('.seating-seat:not(.is-occupied)').first().getByText('Frei', { exact: true }).count(), 1);
  assert.equal(await page.locator('.seating-seat:not(.is-occupied)').first().evaluate((seat) => getComputedStyle(seat).borderStyle), 'dashed');
  assert.equal(await page.locator('.seating-seat-number').count(), 0);
  assert.equal(await page.locator('.seating-seat-free-label').first().evaluate((label) => {
    const probe = document.createElement('span');
    probe.style.color = 'var(--text)';
    document.body.appendChild(probe);
    const tokenColor = getComputedStyle(probe).color;
    probe.remove();
    return getComputedStyle(label).color === tokenColor;
  }), true);
  assert.equal(await page.locator('.seating-pool-player').first().evaluate((player) => {
    const avatar = player.querySelector('.avatar-dot, .avatar-img')!.getBoundingClientRect();
    const name = player.querySelector('.seating-seat-name-line')!.getBoundingClientRect();
    return Math.abs(avatar.top + avatar.height / 2 - (name.top + name.height / 2)) < 2;
  }), true);
  assert.equal(await page.locator('.seating-seat-realname.is-empty').first().evaluate((element) => getComputedStyle(element).display), 'none');
  assert.equal(await page.getByText('Sichtbare Monitore', { exact: true }).count(), 0);
  assert.equal(await page.getByText('Automatisch gespeichert', { exact: true }).count(), 0);
  assert.equal(await page.locator('#seating-monitors-help').count(), 1);
  assert.equal(await page.locator('#seating-save-help').count(), 0);
  assert.equal(await page.locator('#seating-plan-title [data-info-tooltip-trigger]').count(), 1);
  await page.click('[aria-label="Mehr Informationen zu Sitzplan"]');
  await page.waitForSelector('#seating-monitors-help:not([hidden])');
});

flowTest('shell', 'global search filters areas, supports keyboard navigation and restores focus', async (t) => {
  // Also switches viewport size mid-test (see the note on the same pattern
  // in "Orga Events tab and Profil..." above) and only restores the shared
  // page's default at the very end — guarantee it regardless of where this
  // test fails, so a flake here can't cascade into unrelated mobile-layout
  // assertions in whatever test runs next.
  t.after(async () => {
    await page.setViewportSize({ width: 390, height: 844 });
  });
  await page.click('#global-search-btn');
  await page.waitForSelector('.global-search-modal');
  assert.equal(await page.locator('#global-search-input').evaluate((element) => element === document.activeElement), true);
  assert.ok(
    await page.locator('#global-search-input').evaluate((element) => parseFloat(getComputedStyle(element).borderRadius) >= 14),
    'search input should use the rounded modal/card radius'
  );
  assert.equal(await page.locator('.global-search-result').count(), 0, 'search must not show frequent areas before input');
  assert.equal(await page.locator('.global-search-shortcuts').count(), 0, 'keyboard legend is intentionally omitted');

  // The current identity's own search hit leads to the editable profile; a
  // foreign one opens the read-only detail dialog over the current view.
  await page.fill('#global-search-input', 'E2E Alice');
  await page.waitForSelector('.global-search-result:has-text("E2E Alice")');
  await page.click('.global-search-result:has-text("E2E Alice")');
  await page.waitForSelector('#profile-name');

  await page.keyboard.press('Control+K');
  await page.fill('#global-search-input', 'E2E Bob');
  await page.waitForSelector('.global-search-result:has-text("E2E Bob")');
  await page.click('.global-search-result:has-text("E2E Bob")');
  await page.waitForSelector('.modal:has-text("E2E Bob")');
  assert.equal(await page.getByText('Dieses Profil kann nur von E2E Bob selbst bearbeitet werden.', { exact: true }).count(), 0);
  await page.click('[data-close]');

  // A merged area's tab is its own search hit and lands on that tab.
  await page.keyboard.press('Control+K');
  await page.fill('#global-search-input', 'Captain Draft');
  await page.waitForSelector('.global-search-result:has-text("Teams")');
  await page.click('.global-search-result:has-text("Teams")');
  await page.waitForSelector('.view-title:text("Match")');
  await page.waitForSelector('[data-section-tab="matchmaking"][aria-current="page"]');

  await page.keyboard.press('Control+K');
  await page.fill('#global-search-input', 'Statistiken');
  await page.keyboard.press('Enter');
  await page.waitForSelector('.view-title:text("Auswertung")');
  await page.waitForSelector('[data-section-tab="analytics"][aria-current="page"]');

  await page.click('#global-search-btn');
  await page.fill('#global-search-input', 'gibt es nicht');
  await page.waitForSelector('text=Kein passender Inhalt gefunden.');
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('.global-search-modal').count(), 0);
  assert.equal(await page.locator('#global-search-btn').evaluate((element) => element === document.activeElement), true);

  await page.setViewportSize({ width: 320, height: 720 });
  await page.click('#global-search-btn');
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
  await page.keyboard.press('Escape');
  await page.setViewportSize({ width: 900, height: 844 });
  await page.click('#global-search-btn');
  const desktopModal = await page.locator('.global-search-modal .modal').boundingBox();
  assert.ok(desktopModal && desktopModal.width <= 640);
  assert.ok(Math.abs(desktopModal.x + desktopModal.width / 2 - 450) <= 1);
  await page.keyboard.press('Escape');
  await page.setViewportSize({ width: 390, height: 844 });
});

flowTest('competition', 'full click-through: players, matchmaking, voting, leaderboard, live pause', async (t) => {
  // This test starts a vote round partway through and only cancels it via UI
  // clicks much later, once its own assertions along the way all pass. If
  // one of those throws first, the round is left open for the rest of the
  // shared page/session — the later "Aktuell" test then times out because it
  // expects the idle "start a round" form, not an already-open round. Cancel
  // any round left open directly through the API, bypassing whatever UI
  // state the test aborted in, so a failure here can't cascade like that.
  t.after(async () => {
    const current = await (await page.request.get(`${BASE_URL}/api/votes`)).json();
    if (current.open) await page.request.post(`${BASE_URL}/api/votes/cancel`);
  });
  // The separate "Spieler" area is gone: Home's Live-Status is the roster and
  // every card opens that participant's profile. Identities are still created
  // through the API that future user management will own.
  await page.click('.nav-btn[data-view="home"]');
  await page.waitForSelector('button[data-player]:has-text("E2E Bob")');

  // The live state (badge text) is part of the button's accessible name, not
  // hidden inside presentational children — role=button treats descendants as
  // presentational, so an aria-label alone would have silently dropped it.
  const bobCard = page.locator('button[data-player]', { hasText: 'E2E Bob' });
  const bobBadgeText = (await bobCard.locator('.badge').innerText()).trim();
  assert.ok(
    (await bobCard.getAttribute('aria-label'))?.includes(bobBadgeText),
    'the live-status badge text must be part of the card\'s accessible name',
  );

  // Other profiles are read-only; the current identity opens its own editor.
  await page.click('button[data-player] >> text=E2E Bob');
  await page.waitForSelector('.modal:has-text("E2E Bob")');
  assert.equal(await page.getByText('Dieses Profil kann nur von E2E Bob selbst bearbeitet werden.', { exact: true }).count(), 0);
  assert.equal(await page.locator('#detail-save, #detail-delete, #detail-apikey').count(), 0);
  await page.click('[data-close]');
  await page.click('button[data-player] >> text=E2E Alice');
  await page.waitForSelector('#profile-name');
  assert.equal(await page.inputValue('#profile-name'), 'E2E Alice');

  // Matchmaking: draw teams for both players.
  await openTeams();
  assert.equal(await page.inputValue('#mm-teamcount'), '2');
  await page.click('[data-selection-search-trigger][aria-controls="mm-player-search"]');
  await page.fill('#mm-player-search', 'E2E Bob');
  await page.waitForFunction(() => document.querySelectorAll('[data-mm-draw-search-item]:not([hidden])').length === 1);
  assert.equal(await page.locator('[data-mm-draw-search-item]:not([hidden])').getByText('E2E Bob', { exact: true }).count(), 1);
  await page.click('#mm-select-none');
  assert.equal(await page.locator('[data-mm-draw-search-item]:not([hidden]) [data-player]:checked').count(), 0);
  assert.equal(
    await page.locator('[data-mm-draw-search-item][hidden] [data-player]:checked').count(),
    1,
    'filtering must not clear a hidden player selection',
  );
  await page.click('[data-selection-search]:has(#mm-player-search) [data-selection-search-close]');
  await page.click('#mm-select-none');
  assert.equal(await page.locator('[data-player]:checked').count(), 0);
  await page.click('#mm-select-all');
  assert.equal(await page.locator('[data-player]:checked').count(), 2);
  assert.equal(await page.locator('details.history-details:has(summary:has-text("Historie"))').getAttribute('open'), null);

  // Player cards (checkbox, avatar, name, skill value) stack in a single
  // column on phones; two columns would leave no readable room for names.
  const drawPlayerGrid = page.locator('section[aria-labelledby="matchmaking-draw-title"] .player-selection-grid');
  const mobileSelectionColumns = await drawPlayerGrid.evaluate((element) =>
    getComputedStyle(element).gridTemplateColumns.split(' ').length
  );
  assert.equal(mobileSelectionColumns, 1);
  await page.setViewportSize({ width: 900, height: 844 });
  const desktopSelectionColumns = await drawPlayerGrid.evaluate((element) =>
    getComputedStyle(element).gridTemplateColumns.split(' ').length
  );
  assert.ok(desktopSelectionColumns >= 2);
  await page.setViewportSize({ width: 390, height: 844 });

  // Only the selected mode's section renders — switch to Captain Draft to
  // reach its tooltip, then back to Auslosung to reach "Teams auslosen".
  await page.click('[data-mm-mode="draft"]');
  assert.equal(await page.locator('#draft-player-search').count(), 1);
  await page.click('[data-selection-search-trigger][aria-controls="captain-player-search"]');
  await page.fill('#captain-player-search', 'E2E Alice');
  await page.waitForFunction(() => document.querySelectorAll('[data-mm-captain-search-item]:not([hidden])').length === 1);
  assert.equal(await page.locator('[data-mm-captain-search-item]:not([hidden])').getByText('E2E Alice', { exact: true }).count(), 1);
  await page.click('[data-selection-search]:has(#captain-player-search) [data-selection-search-close]');
  const draftHelp = page.locator('[aria-controls="captain-draft-help"]');
  await draftHelp.waitFor();
  await draftHelp.click();
  assert.equal(await draftHelp.getAttribute('aria-expanded'), 'true');
  await page.keyboard.press('Escape');
  assert.equal(await draftHelp.getAttribute('aria-expanded'), 'false');

  await page.click('[data-mm-mode="draw"]');
  await page.waitForSelector('#mm-generate');
  // The sticky action bar must not steal clicks from rows scrolling behind
  // it: only real controls (the button here) opt back into pointer events,
  // the bar's own background stays pass-through (see .sticky-actions in
  // style.css).
  const stickyActions = page.locator('.sticky-actions', { has: page.locator('#mm-generate') });
  assert.equal(await stickyActions.evaluate((el) => getComputedStyle(el).pointerEvents), 'none');
  assert.equal(await page.locator('#mm-generate').evaluate((el) => getComputedStyle(el).pointerEvents), 'auto');
  await page.click('#mm-generate');
  await page.waitForSelector('.team-card');
  const teamCards = await page.locator('.team-card').count();
  assert.ok(teamCards >= 2, 'expected at least 2 team cards');

  // Neither of these two players rated the game, so both enter the draw with
  // the server's neutral fallback. That has to stay visible: each row shows
  // the parenthesized fallback, and every team header's total is the sum of
  // its own visible rows plus the count of unrated players.
  assert.ok((await page.locator('.team-card .team-player .rating-unrated').count()) > 0);
  const drawnTeams = await page.locator('.team-card').evaluateAll((cards) =>
    cards.map((card) => ({
      header: card.querySelector('.team-skill-total')?.textContent?.trim() ?? '',
      players: Array.from(card.querySelectorAll('.team-player .rating')).map(
        (row) => row.textContent?.trim() ?? ''
      ),
    }))
  );
  for (const team of drawnTeams) {
    const ratings = team.players.map((text) => Number(text.replace(/[()]/g, '')));
    const [total, unratedCount] = team.header.replace(/[()]/g, ' ').trim().split(/\s+/).map(Number);
    assert.equal(
      total,
      ratings.reduce((sum, rating) => sum + rating, 0)
    );
    assert.equal(unratedCount ?? 0, team.players.filter((text) => text.startsWith('(')).length);
  }

  // Voting: start a round (points mode, the only mode offered when starting
  // fresh), rate a game, and submit. Alice's personal session already fixes
  // the voter identity, so no extra identity form appears. Moving a slider only
  // stages a local draft — it must not count as a vote until the submit
  // button is pressed. While the round is open, no per-game distribution
  // (bars/counts) may be visible anywhere — only total participation and the
  // voter's own pick.
  await page.click('.nav-btn[data-view="votes"]');
  await page.waitForSelector('#votes-start');
  assert.equal(await page.getByText('Du bist E2E Alice', { exact: true }).count(), 0);
  await page.click('#votes-start');
  await page.waitForSelector('#votes-close'); // only rendered once the round shows as open
  await page.waitForSelector('.vote-participation-status:has-text("Bewertungen abgegeben"):has-text("0 / 2")');
  // Opening the round also kicks off votes.js's own follow-up mine/history
  // fetches, each of which rerenders (replacing this whole section) again
  // once it resolves. Settling on network idle first, then reading all
  // three boxes from one synchronous evaluate(), avoids one of those
  // rerenders landing between three separate boundingBox() round trips and
  // handing back a stale/zero-size box for whichever button it replaced.
  await page.waitForLoadState('networkidle');
  const { submitWidth, closeWidth, cancelWidth } = await page.evaluate(() => ({
    submitWidth: document.querySelector('#votes-submit')?.getBoundingClientRect().width ?? 0,
    closeWidth: document.querySelector('#votes-close')?.getBoundingClientRect().width ?? 0,
    cancelWidth: document.querySelector('#votes-cancel')?.getBoundingClientRect().width ?? 0,
  }));
  assert.ok(submitWidth > closeWidth);
  assert.equal(Math.round(cancelWidth), Math.round(closeWidth));
  assert.equal(await page.locator('.vote-game-grid').evaluate((element) => getComputedStyle(element).gridTemplateColumns.split(' ').length), 1);
  await page.setViewportSize({ width: 900, height: 844 });
  assert.equal(await page.locator('.vote-game-grid').evaluate((element) => getComputedStyle(element).gridTemplateColumns.split(' ').length), 2);
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.locator('.vote-bar-track').count(), 0, 'no bars while the round is open');
  await page.locator('[data-points-slider] >> nth=0').evaluate((el) => {
    (el as HTMLInputElement).value = '5';
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.locator('[data-points-slider] >> nth=1').evaluate((el) => {
    (el as HTMLInputElement).value = '5';
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.waitForSelector('.skill-value:text("5")'); // staged locally
  assert.equal(
    await page.locator('.vote-participation-status:has-text("0 / 2")').count(),
    1,
    'moving a slider must not submit it by itself'
  );

  // Own rating progress and the "Unbewertet" filter reflect the two just-
  // staged (not yet submitted) picks against the round's full game count.
  const totalGames = await page.locator('[data-points-slider]').count();
  await page.waitForSelector(`.vote-workflow-section >> text=2 von ${totalGames} bewertet`);
  await page.click('#votes-unrated-toggle');
  await page.waitForFunction(
    (expected) => document.querySelectorAll('[data-points-slider]').length === expected,
    totalGames - 2
  );
  await page.click('#votes-unrated-toggle');
  await page.waitForFunction(
    (expected) => document.querySelectorAll('[data-points-slider]').length === expected,
    totalGames
  );

  await page.click('#votes-submit');
  await page.waitForSelector('.vote-participation-status:has-text("1 / 2")');
  await page.waitForSelector('.vote-submitted-state:has-text("Bewertung abgegeben")');
  assert.equal(await page.locator('#votes-submit').count(), 0);
  assert.ok(await page.locator('[data-points-slider]').first().isDisabled());
  assert.equal(await page.locator('.vote-bar-track').count(), 0, 'still no bars after casting, before closing');

  await page.click('#votes-close');
  await page.waitForSelector('#votes-start');
  // Closing reveals only games that actually received points in the compact
  // "Letzter Vote" group; the detail modal applies the same zero-score filter.
  await page.waitForSelector('text=Letzter Vote');
  await page.waitForFunction(() => document.querySelectorAll('section[aria-labelledby="vote-current-result-title"] .lb-row').length >= 2);
  const currentVote = page.locator('section[aria-labelledby="vote-current-result-title"]');
  assert.equal(await currentVote.locator('.lb-row').count(), 2);
  assert.equal(await currentVote.locator('.lb-row.is-tied').count(), 2);
  assert.deepEqual(await currentVote.locator('.lb-row.is-tied .lb-rank').allTextContents(), ['1', '1']);
  assert.equal(await currentVote.getByText('Unentschieden', { exact: true }).count(), 0);
  assert.equal(await currentVote.locator('#votes-runoff').count(), 1, 'the runoff action belongs to the current Vote card');
  assert.equal(await page.locator('section[aria-labelledby="vote-runoff-title"]').count(), 0, 'no separate runoff card remains');
  assert.equal(await page.locator('.vote-bar-track').count(), 0, 'no bars on the main page, even after closing');
  assert.equal(await page.locator('details.history-details:has(summary:has-text("Historie"))').getAttribute('open'), null);

  // The just-closed round can be reopened from the history list for the
  // full detailed breakdown.
  await page.click('details.history-details:has(summary:has-text("Historie")) > summary');
  await page.waitForFunction(() => document.querySelectorAll('.vote-history-round .lb-row').length >= 2);
  assert.equal(await page.locator('.vote-history-round').first().locator('.lb-row').count(), 2);
  await page.click('[data-open-history-round]');
  await page.waitForSelector('text=Abstimmung Runde 1');
  await page.waitForSelector('.modal .vote-bar-track');
  assert.equal(await page.locator('.modal .vote-row').count(), 2);
  await page.click('[data-close]');

  // Admin mode stays active from here for the rest of this shard's shared
  // page/session (test players, Arcade AI). Auswertung itself no longer
  // depends on it - it lives behind Admin's own "Auswertung" tool card,
  // gated by the real admin role instead.
  await page.click('.nav-btn[data-view="more"]');
  await page.click('[data-navigate="admin"]');
  await ensureAdminMode();

  // Leaderboard: record a match and see it reflected.
  await page.click('[data-navigate="leaderboard"]');
  await page.waitForSelector('h1:text-is("Auswertung")');
  await page.waitForSelector('[data-section-tab="leaderboard"][aria-current="page"]');
  assert.equal(
    await page.locator('section.grouped-page-section:has(> .grouped-page-section-title > h2:text-is("Rangliste & Spielzeit"))').count(),
    1,
    'filtered ranking and playtime should share one grouped section'
  );
  for (const title of ['Rangliste', 'Spielzeit']) {
    assert.equal(
      await page.locator(`section[aria-labelledby="leaderboard-filtered-title"] section.tournament-section-panel:has(h2:text-is("${title}"))`).count(),
      1,
      `${title} should remain an accented subsection`
    );
  }
  assert.equal(
    await page.locator('section.grouped-page-section:has(> .grouped-page-section-title > h2:text-is("Spielzeit pro Spiel"))').count(),
    1,
    'per-game playtime should remain a separate grouped section'
  );
  assert.equal(
    await page.locator('section[aria-labelledby="leaderboard-filtered-title"] #lb-filter').count(),
    1,
    'the game filter belongs to the shared filtered section'
  );
  for (const grid of await page.locator('.leaderboard-list-grid').all()) {
    assert.equal(
      await grid.evaluate((element) => getComputedStyle(element).gridTemplateColumns.split(' ').length),
      1,
      'leaderboard lists should stay single-column on phones'
    );
  }
  await page.setViewportSize({ width: 900, height: 844 });
  for (const grid of await page.locator('.leaderboard-list-grid').all()) {
    assert.equal(
      await grid.evaluate((element) => getComputedStyle(element).gridTemplateColumns.split(' ').length),
      2,
      'leaderboard lists should use two columns when space is available'
    );
  }
  await page.setViewportSize({ width: 390, height: 844 });
  // #lb-filter is a searchable combobox (searchSelect.js), not a native
  // <select>: typing an option's exact label into #lb-filter-search resolves
  // the hidden #lb-filter input to that game's id, just like choosing it from
  // the app-rendered listbox.
  const gamesRes = await page.request.get(`${BASE_URL}/api/games`);
  const games = await gamesRes.json();
  const filteredGame = games[1];
  assert.ok(filteredGame);
  const filteredGameId = filteredGame.id;
  const [filteredPlaytimeResponse, allPlaytimeResponse] = await Promise.all([
    page.waitForResponse((response) => {
      const url = new URL(response.url());
      return url.pathname === '/api/stats/playtime' && url.searchParams.get('gameId') === filteredGameId;
    }),
    page.waitForResponse((response) => {
      const url = new URL(response.url());
      return url.pathname === '/api/stats/playtime' && !url.searchParams.has('gameId');
    }),
    page.fill('#lb-filter-search', filteredGame.name),
  ]);
  assert.equal(filteredPlaytimeResponse.ok(), true, 'per-player playtime should follow the selected game');
  assert.equal(allPlaytimeResponse.ok(), true, 'per-game playtime should keep loading all games');
  await page.click('#add-match-btn');
  await page.waitForSelector('#match-players');
  assert.deepEqual(
    await page.locator('#match-form .match-form-section h2').allTextContents(),
    ['Modus', 'Spieler-Zuordnung', 'Ergebnis']
  );
  assert.equal(
    await page.locator('#match-form').evaluate((element) => element.scrollWidth <= element.clientWidth),
    true,
    'the result form should not overflow at phone width'
  );
  await page.check('#match-advanced');
  assert.equal(await page.locator('.match-result-row').count(), 2);
  assert.equal(
    await page.locator('#match-form').evaluate((element) => element.scrollWidth <= element.clientWidth),
    true,
    'advanced result fields should remain inside the result group'
  );
  // The "Wert" field uses step="any" (arbitrary decimal scores) while "Platz"
  // uses the default whole-number step — native stepUp()/stepDown() throws on
  // a step="any" field, so the shared numberStepper.js click handler needs
  // its own fallback there instead of silently doing nothing.
  await page.click('[data-team-score="0"] + .number-stepper-steps .number-stepper-btn[aria-label="Wert erhöhen"]');
  assert.equal(await page.locator('[data-team-score="0"]').inputValue(), '1');
  await page.click('[data-team-rank="0"] + .number-stepper-steps .number-stepper-btn[aria-label="Wert erhöhen"]');
  assert.equal(await page.locator('[data-team-rank="0"]').inputValue(), '1');
  await page.uncheck('#match-advanced');
  const teamSelects = page.locator('[data-team-for]');
  await teamSelects.nth(0).selectOption('0');
  await teamSelects.nth(1).selectOption('1');
  await page.check('input[name="winner"][value="0"]');
  await page.click('#match-form button[type="submit"]');
  await page.waitForSelector('.lb-row');
  assert.ok((await page.locator('.lb-row').count()) >= 2);
  // The app can render its first data view before the stylesheet request has
  // completed on a cold CI browser. Wait for the actual sheet and a resolved
  // body font before comparing typography across views.
  await page.waitForFunction(() => {
    const stylesheet = document.querySelector('link[href*="/css/style.css"]') as HTMLLinkElement | null;
    return stylesheet?.sheet !== null && getComputedStyle(document.body).fontFamily !== '';
  });
  // Read the styles off a freshly queried node at evaluation time: a
  // players:/live:changed refresh can re-render the list between resolving a
  // locator handle and evaluating it, and a detached node reports every
  // computed style as ''. Retry until a live node answers.
  const readNameTypography = (selector: string) =>
    page
      .waitForFunction((sel) => {
        const element = document.querySelector(sel);
        if (!element) return null;
        const style = getComputedStyle(element);
        if (!style.fontFamily) return null;
        return { family: style.fontFamily, size: style.fontSize, weight: style.fontWeight };
      }, selector)
      .then((result) => result.jsonValue() as Promise<{ family: string; size: string; weight: string }>);
  const leaderboardNameTypography = await readNameTypography('.lb-row .player-name');
  await page.waitForSelector('text=Spielzeit');

  // Back to Home: should now show both players (offline, since no agent ran).
  await page.click('.nav-btn[data-view="home"]');
  await page.waitForSelector('.player-card');
  assert.equal(await page.locator('.player-card').count(), 2);
  for (const title of ['Live-Status', 'Rangliste', 'Sitzplan']) {
    assert.equal(
      await page.locator(`section.grouped-page-section:has(h2:text-is("${title}"))`).count(),
      1,
      `${title} should be presented as a grouped Home section`
    );
  }
  const liveNameTypography = await readNameTypography('.player-card .player-name');
  assert.deepEqual(liveNameTypography, leaderboardNameTypography, 'player names should use one shared typography');
  await page.setViewportSize({ width: 900, height: 844 });
  assert.equal(
    await page.locator('.home-leaderboard-grid').evaluate((element) => getComputedStyle(element).gridTemplateColumns.split(' ').length),
    2,
    'home leaderboard should use two columns when the card has enough width'
  );
  await page.setViewportSize({ width: 390, height: 844 });

  // Manual pause override (FR-28): the pause toggle lives in the "Dein
  // Status" bar, not on the player's own tile. Toggle pause, see the badge
  // flip, then toggle back.
  assert.equal((await page.locator('[data-toggle-pause]').textContent())?.trim(), 'Pause');
  await page.click('[data-toggle-pause]');
  await page.waitForSelector('.badge-paused');
  assert.equal((await page.locator('[data-toggle-pause]').textContent())?.trim(), 'Bin wieder da');
  await page.click('[data-toggle-pause]');
  await page.waitForFunction(() => !document.querySelector('.badge-paused'));
});

flowTest('competition', 'Vote: game-limit selection survives an unrelated re-render and select-all/none ignore prior manual state', async () => {
  // Regression test: the game-selection checkboxes used to live only in the
  // DOM with no persisted JS state. A votes:changed/preferences:changed
  // socket event re-renders this whole view from scratch whenever *anyone*
  // interacts with voting elsewhere — that silently cleared manual
  // deselections. `respawn:rerender` is the same generic re-render signal
  // the app itself dispatches; firing it here simulates that unrelated
  // event without needing a second browser context.
  await page.click('.nav-btn[data-view="votes"]');
  await page.waitForSelector('#votes-start');
  await page.waitForSelector('#votes-game-select-wrap:not([hidden])');
  const initialVoteState = await (await page.request.get(`${BASE_URL}/api/votes`)).json();
  const catalogGames = (await (await page.request.get(`${BASE_URL}/api/games`)).json()) as Array<{
    id: string;
    name: string;
    isSuggestion?: boolean;
  }>;
  const counterStrike = catalogGames.find((game) => game.name === 'Counter-Strike 2')!;
  const catalogGameIds = new Set(catalogGames.filter((game) => !game.isSuggestion).map((game) => game.id));
  const preferenceByGameId = new Map<string, number>(
    initialVoteState.catalogResults.map(
      (result: { gameId: string; avgPreference: number | null }): [string, number] => [
        result.gameId,
        result.avgPreference ?? -1,
      ],
    ),
  );
  const expectedVoteOrder = catalogGames
    .filter((game) => catalogGameIds.has(game.id))
    .sort((a, b) => {
      const preferenceDiff = (preferenceByGameId.get(b.id) ?? -1) - (preferenceByGameId.get(a.id) ?? -1);
      return preferenceDiff !== 0 ? preferenceDiff : a.name.localeCompare(b.name, 'de');
    })
    .map((game) => game.id);
  const renderedVoteOrder = await page.locator('[data-vote-game-checkbox]').evaluateAll((els) =>
    els.map((el) => (el as HTMLInputElement).value),
  );
  assert.deepEqual(renderedVoteOrder, expectedVoteOrder, 'the vote game list should be sorted by Bock level');
  let initiallySelected = await page.locator('[data-vote-game-checkbox]:checked').evaluateAll((els) =>
    els.map((el) => (el as HTMLInputElement).value),
  );
  assert.deepEqual(
    initiallySelected,
    expectedVoteOrder.slice(0, 10),
    'the initial vote selection should contain the current Top 10 by Bock level',
  );

  // A live Bock update while the idle form is still untouched must refresh
  // the automatic Top-10 selection together with the visible sort order.
  // Preserve the fixture's previous rating so later scenarios stay isolated.
  if (expectedVoteOrder.length > 10) {
    const liveBockTarget = expectedVoteOrder[expectedVoteOrder.length - 1];
    const previousPreferenceResponse = await page.request.get(
      `${BASE_URL}/api/preferences?playerId=${alice.id}&gameId=${liveBockTarget}`,
    );
    const previousPreferences = (await previousPreferenceResponse.json()) as Array<{ rating: number }>;
    const previousRating = previousPreferences[0]?.rating;
    const updatedPreference = await page.request.put(`${BASE_URL}/api/preferences`, {
      data: { playerId: alice.id, gameId: liveBockTarget, rating: 10 },
    });
    assert.equal(updatedPreference.status(), 200, await updatedPreference.text());
    await page.waitForFunction((targetId) => {
      const checkbox = document.querySelector(`[data-vote-game-checkbox][value="${targetId}"]`) as HTMLInputElement | null;
      return checkbox?.checked === true;
    }, liveBockTarget);

    const liveVoteState = await (await page.request.get(`${BASE_URL}/api/votes`)).json();
    const livePreferenceByGameId = new Map<string, number>(
      liveVoteState.catalogResults.map(
        (result: { gameId: string; avgPreference: number | null }): [string, number] => [
          result.gameId,
          result.avgPreference ?? -1,
        ],
      ),
    );
    const liveExpectedVoteOrder = catalogGames
      .filter((game) => catalogGameIds.has(game.id))
      .sort((a, b) => {
        const preferenceDiff = (livePreferenceByGameId.get(b.id) ?? -1) - (livePreferenceByGameId.get(a.id) ?? -1);
        return preferenceDiff !== 0 ? preferenceDiff : a.name.localeCompare(b.name, 'de');
      })
      .map((game) => game.id);
    const liveSelected = await page.locator('[data-vote-game-checkbox]:checked').evaluateAll((els) =>
      els.map((el) => (el as HTMLInputElement).value),
    );
    assert.deepEqual(
      liveSelected,
      liveExpectedVoteOrder.slice(0, 10),
      'a live Bock update should refresh the untouched Top-10 selection',
    );

    if (previousRating === undefined) {
      await page.request.delete(`${BASE_URL}/api/preferences/${alice.id}/${liveBockTarget}`);
    } else {
      await page.request.put(`${BASE_URL}/api/preferences`, {
        data: { playerId: alice.id, gameId: liveBockTarget, rating: previousRating },
      });
    }
    await page.waitForTimeout(250);
    initiallySelected = await page.locator('[data-vote-game-checkbox]:checked').evaluateAll((els) =>
      els.map((el) => (el as HTMLInputElement).value),
    );
  }

  const voteGameCheckboxes = page.locator('[data-vote-game-checkbox]');
  const voteGameCount = await voteGameCheckboxes.count();
  assert.ok(voteGameCount >= 2, 'test fixture must ship at least two games');
  await page.click('[data-selection-search-trigger][aria-controls="votes-game-search"]');
  await page.fill('#votes-game-search', 'Counter-Strike 2');
  await page.waitForFunction(() => document.querySelectorAll('[data-vote-game-search-item]:not([hidden])').length === 1);
  await page.click('#votes-select-none');
  assert.equal(await page.locator('[data-vote-game-search-item]:not([hidden]) [data-vote-game-checkbox]:checked').count(), 0);
  assert.equal(
    await page.locator('[data-vote-game-search-item][hidden] [data-vote-game-checkbox]:checked').count(),
    initiallySelected.filter((gameId) => gameId !== counterStrike.id).length,
    'filtering must preserve checked games outside the visible result',
  );
  await page.fill('#votes-game-search', 'Kein Treffer XYZ');
  await page.waitForSelector('[data-vote-game-search-empty]:not([hidden])');
  await page.fill('#votes-game-search', '');
  await page.click('[data-selection-search]:has(#votes-game-search) [data-selection-search-close]');
  await page.click('#votes-select-all');
  await voteGameCheckboxes.nth(0).uncheck();
  await voteGameCheckboxes.nth(1).uncheck();

  await page.evaluate(() => window.dispatchEvent(new CustomEvent('respawn:rerender')));

  await page.waitForSelector('#votes-game-select-wrap:not([hidden])');
  assert.equal(await voteGameCheckboxes.nth(0).isChecked(), false, 'a manual deselection must survive an unrelated re-render');
  assert.equal(await voteGameCheckboxes.nth(1).isChecked(), false);

  // The previous single toggle button computed its action from whether
  // *all* boxes were checked, so clicking it in this exact mixed state
  // (2 unchecked, rest checked) re-checked everything instead of clearing
  // the rest. The two dedicated buttons must not depend on prior state.
  await page.click('#votes-select-none');
  assert.deepEqual(
    await voteGameCheckboxes.evaluateAll((els) => els.map((el) => (el as HTMLInputElement).checked)),
    Array(voteGameCount).fill(false)
  );
  await page.click('#votes-select-all');
  assert.deepEqual(
    await voteGameCheckboxes.evaluateAll((els) => els.map((el) => (el as HTMLInputElement).checked)),
    Array(voteGameCount).fill(true)
  );
});

flowTest('competition', 'matchmaking Historie marks a recorded draw as Unentschieden', async () => {
  await openTeams();
  await page.click('#mm-generate');
  await openMatchmakingHistory();
  await page.waitForSelector('[data-record-draw]');
  await page.click('[data-record-draw]');

  // "Unentschieden" is the default winner radio in the result form — submit
  // as-is to record a drawn result.
  await page.waitForSelector('#match-form');
  await page.click('#match-form button[type="submit"]');

  await page.waitForFunction(() => !!document.querySelector('[data-edit-draw-result]'));
  await openMatchmakingHistory();
  await page.waitForSelector('[data-draw-card] .badge:has-text("Unentschieden")');
});

flowTest('competition', 'matchmaking Historie shows the winner after switching to Frei-für-alle for a drawn lineup', async () => {
  // Regression test: teams were drawn, but the result was entered as
  // "Frei-für-alle" instead of the drawn team shape — the draw must still
  // remain in Historie with the winner shown instead of retaining the open
  // draw actions.
  await openTeams();
  await page.click('#mm-generate');
  await openMatchmakingHistory();
  await page.waitForSelector('[data-record-draw]');
  await page.click('[data-record-draw]');

  await page.waitForSelector('#match-form');
  await page.check('#match-ffa');
  await page.waitForSelector('input[name="ffa-winner"]');
  // First radio is a real participant (the "Kein Sieger" fallback is last).
  await page.check('input[name="ffa-winner"] >> nth=0');
  await page.click('#match-form button[type="submit"]');

  await page.waitForFunction(() => !!document.querySelector('[data-edit-draw-result]'));
  await openMatchmakingHistory();
  await page.waitForSelector('[data-draw-card] .matchmaking-draw-team.is-winner');
});

flowTest('competition', 'Ergebnis eintragen keeps a manual team reassignment after changing "Anzahl Teams"', async () => {
  // Regression test: reassigning a player to a different team in the entry
  // form, then changing "Anzahl Teams", must not silently revert that player
  // back to the original drawn team.
  await openTeams();
  await page.click('#mm-generate');
  await openMatchmakingHistory();
  await page.waitForSelector('[data-record-draw]');
  await page.click('[data-record-draw]');
  await page.waitForSelector('#match-players');

  await page.click('#match-game-search');
  await page.waitForSelector('#match-game-list:not([hidden])');
  await page.keyboard.press('Escape');
  await page.waitForSelector('#match-game-list', { state: 'hidden' });
  assert.equal(
    await page.locator('#match-form').isVisible(),
    true,
    'Escape should close the game listbox without propagating to the result modal',
  );

  const teamSelects = page.locator('[data-team-for]');
  const firstPlayerId = await teamSelects.nth(0).getAttribute('data-team-for');
  const originalValue = await teamSelects.nth(0).inputValue();
  const otherValue = originalValue === '0' ? '1' : '0';
  await teamSelects.nth(0).selectOption(otherValue);

  // Bumping team count re-renders the player list — the manual reassignment
  // just made must survive that re-render.
  await page.fill('#match-teamcount', '3');
  await page.waitForSelector('[data-team-for]');
  const reselected = page.locator(`[data-team-for="${firstPlayerId}"]`);
  assert.equal(await reselected.inputValue(), otherValue);
});

flowTest('competition', 'Auswertungen (via Mehr) shows a real award and keeps detail logs collapsed', async () => {
  // Create a player + a session via the real agent-report endpoint (not the
  // UI) so there's an actual play_sessions row to render.
  const account = await createE2EAccount(BASE_URL, adminCookie, 'Analytics E2E Player');
  const playerRes = await page.request.get(`${BASE_URL}/api/players/${account.id}`);
  assert.equal(playerRes.status(), 200);
  const player = await playerRes.json() as { api_key: string };
  const activeEventResponse = await fetch(`${BASE_URL}/api/events/active`, {
    headers: { cookie: account.cookie },
  });
  assert.equal(activeEventResponse.status, 200);
  const activeEvent = await activeEventResponse.json() as { id: string };
  const trackingResponse = await page.request.post(`${BASE_URL}/api/events/${activeEvent.id}/tracking/start`);
  assert.equal(trackingResponse.status(), 200, await trackingResponse.text());
  const consentResponse = await fetch(`${BASE_URL}/api/events/${activeEvent.id}/tracking-consent`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: account.cookie },
    body: JSON.stringify({ granted: true }),
  });
  assert.equal(consentResponse.status, 200, await consentResponse.text());
  await page.request.post(`${BASE_URL}/api/agent/report`, {
    headers: { 'x-api-key': player.api_key },
    data: { processNames: ['cs2.exe'] },
  });
  await new Promise((r) => setTimeout(r, 50));
  await page.request.post(`${BASE_URL}/api/agent/report`, {
    headers: { 'x-api-key': player.api_key },
    data: { processNames: [] }, // close the session so it has a real duration
  });

  await page.reload();
  await page.waitForSelector('#app:not([hidden])');
  // Spielzeit-Statistiken are the second tab of the "Auswertung" area.
  await openAuswertungTab('analytics');
  await page.waitForSelector('text=Marathon-Zocker', { timeout: 5000 });
  assert.ok((await page.textContent('.view-title'))?.includes('Auswertung'));

  // The noisy concurrency controls are intentionally gone. The session log
  // remains available on demand, but starts collapsed.
  assert.equal(await page.locator('#an-concurrency-game').count(), 0);
  const sessionLog = page.locator('details:has(summary:has-text("Session-Protokoll"))');
  assert.equal(await sessionLog.getAttribute('open'), null);
  await page.waitForSelector('text=Längste individuelle Session pro Spiel');
  assert.equal(await page.locator('#analytics-event-range-help').count(), 0);
  assert.equal(await page.getByText('Event wählen zeigt genau dessen Daten.', { exact: true }).count(), 0);
  assert.equal(await page.locator('#an-event-search[aria-label="Veranstaltung"]').count(), 1);
  assert.equal(await page.locator('[data-dt-field^="an-"]').count(), 0);

  // The "Matches & Turniere" tab (merged in from the old separate Spiele &
  // Turniere view) shares this same event filter and renders alongside it.
  await page.click('[data-an-tab="matches"]');
  await page.waitForSelector('text=Ergebnisse pro Spiel');
  assert.equal(await page.locator('#analytics-event-help').count(), 0);
  assert.equal(await page.locator('.analytics-tournament-breakdown').count(), 2);
  await page.waitForSelector('#analytics-fun-title:text-is("Trivia")');
  const triviaSection = page.locator('section[aria-labelledby="analytics-fun-title"]');
  // Earlier tests in this suite already recorded 1v1 results, so the biggest
  // rivalry card exists and the empty state must be gone.
  assert.equal(await triviaSection.getByText('Noch nicht genug Ergebnisse.', { exact: true }).count(), 0);
  assert.ok((await triviaSection.locator('.card').count()) >= 1, 'trivia should show at least one fun record');
  assert.equal(await triviaSection.locator('.empty-state-icon').count(), 0);
  assert.equal(await page.locator('#an-event-search[aria-label="Veranstaltung"]').count(), 1);

  await page.click('[data-an-tab="arcade"]');
  await page.waitForSelector('#analytics-arcade-total-title');
  assert.equal(await page.locator('#an-event-search[aria-label="Veranstaltung"]').count(), 1);
  assert.equal(await page.locator('[data-dt-field^="an-"]').count(), 0);
  assert.equal(await page.locator('#analytics-arcade-range-help').count(), 0);
  assert.equal(await page.getByText('Matches pro Tag', { exact: true }).count(), 0);
});

flowTest('shell', 'Mein Profil: rename with a uniqueness conflict, then succeed; Meine Statistiken reachable', async () => {
  // Keep this test deterministic even if the preceding click-through test
  // changes its setup data or a future test order is introduced.
  const playersRes = await page.request.get(`${BASE_URL}/api/players`);
  const players = (await playersRes.json()) as Array<{ name: string }>;
  if (!players.some((p) => p.name === 'E2E Bob')) {
    const createRes = await page.request.post(`${BASE_URL}/api/players`, { data: { name: 'E2E Bob' } });
    assert.equal(createRes.status(), 201);
  }
  await openProfile();

  // The personal session still belongs to "E2E Alice", so this view opens
  // straight into her profile editor.
  await page.waitForSelector('#profile-name');
  // Profile-local neighbor/push state loads immediately after the first
  // paint and can replace the form once. Let that initial render settle so
  // the test never types into a form that is about to be detached.
  await page.waitForTimeout(250);
  assert.equal(await page.inputValue('#profile-name'), 'E2E Alice');

  // Renaming to a name someone else already has must be rejected, not
  // silently accepted or crash the view.
  await page.fill('#profile-name', 'E2E Bob');
  const conflictResponse = page.waitForResponse(
    (response) => response.url().includes('/api/players/') && response.request().method() === 'PATCH'
  );
  await page.click('#profile-save');
  const conflict = await conflictResponse;
  assert.equal(conflict.status(), 409, `duplicate rename returned: ${await conflict.text()}`);
  assert.equal(await page.inputValue('#profile-name'), 'E2E Bob');

  // A genuinely free name should save fine.
  await page.fill('#profile-name', 'E2E Alice Pro');
  const renameResponse = page.waitForResponse(
    (response) => response.url().includes('/api/players/') && response.request().method() === 'PATCH'
  );
  await page.click('#profile-save');
  const renamed = await renameResponse;
  assert.ok(renamed.ok(), `profile rename failed (${renamed.status()}): ${await renamed.text()}`);
  await page.waitForSelector('.toast:has-text("Gespeichert")');
  await page.waitForFunction(() => {
    const el = document.querySelector('#profile-name') as HTMLInputElement | null;
    return el?.value === 'E2E Alice Pro';
  });
  alice.name = 'E2E Alice Pro';
  accountsByName.set(alice.name, alice);

  // Bock/Skill-Ratings live in the Spiele view now, reachable from here via
  // the onboarding nudge; the personal stats dashboard is one tap away too
  // (it moved to its own view, myStats).
  await page.waitForSelector('text=Bock & Skill eintragen');
  await page.click('[data-navigate="myStats"]');
  await page.waitForSelector('text=Meine Statistiken');
  // `#my-stats-event` is the dropdown's hidden value input; its visible
  // control is the `-search` combobox.
  await page.waitForSelector('#my-stats-event-search');

  // Back to the profile; the session remains bound to this account.
  await page.click('[data-navigate="profile"]');
  await page.waitForSelector('#profile-name');
  // Restore the identity — later tests (tournament) still act as her.
  assert.equal(await page.inputValue('#profile-name'), 'E2E Alice Pro');
});

flowTest('shell', 'Sitzplan: the real name set in Mein Profil shows in small everywhere the seating plan renders', async () => {
  await openProfile();
  await page.waitForSelector('#profile-real-name');
  await page.fill('#profile-real-name', 'Alice Musterfrau');
  await page.click('#profile-save');
  await page.waitForSelector('.toast:has-text("Gespeichert")');

  // Seat her via the editor's tap-to-place path (select the pool chip, then
  // tap an empty seat) rather than HTML5 drag & drop, which Playwright can't
  // simulate reliably.
  await page.click('.nav-btn[data-view="more"]');
  await page.click('[data-navigate="admin"]');
  await ensureAdminMode();
  await page.click('.nav-btn[data-view="more"]');
  await page.click('[data-navigate="admin"]');
  await page.click('[data-navigate="seating"]');
  await page.waitForSelector('[data-seat-pool] [data-player-id]');
  await page.locator('[data-seat-pool] [data-player-id]', { hasText: 'E2E Alice Pro' }).click();
  await page.locator('[data-seat-side="top"][data-seat-index="0"]').click();
  await page.waitForSelector('.seating-seat.is-occupied .seating-seat-realname:has-text("Alice Musterfrau")');

  // Same shared renderSeatingPlan() component also feeds Home's read-only
  // board - the real name must show up there too, unprompted. Check the
  // requested side-by-side desktop layout separately from the intentionally
  // stacked narrow-screen variant used by the rest of this suite.
  await page.setViewportSize({ width: 900, height: 844 });
  await page.click('.nav-btn[data-view="home"]');
  await page.waitForSelector('.seating-seat-realname:has-text("Alice Musterfrau")');
  const homeSeatName = page.locator('.live-seating .seating-seat.is-occupied .seating-seat-name', { hasText: 'E2E Alice Pro' });
  await homeSeatName.waitFor();
  assert.equal(await homeSeatName.evaluate((element) => getComputedStyle(element).fontWeight), '600');
  assert.equal(await homeSeatName.evaluate((element) => getComputedStyle(element).textAlign), 'left');
  await page.setViewportSize({ width: 390, height: 844 });
});

flowTest('shell', 'Spiele: suggest a game (duplicate name rejected), promote it, then rate Bock/Skill inline', async () => {
  await page.click('.nav-btn[data-view="gameCatalog"]');
  await page.waitForSelector('#suggest-new');

  await page.click('#suggest-new');
  await page.fill('#suggest-title', 'E2E Partyspiel');
  await page.click('#suggest-form button[type="submit"]');
  await page.waitForSelector('text=E2E Partyspiel');
  await page.waitForSelector('button[data-tab="suggestions"].btn-primary');

  // Same name again (different case): server must refuse — otherwise votes,
  // skills and results would silently split across two identical entries.
  await page.click('#suggest-new');
  await page.fill('#suggest-title', 'e2e partyspiel');
  await page.click('#suggest-form button[type="submit"]');
  await page.waitForSelector('.toast-error');
  await page.waitForSelector('text=gibt es schon');
  await page.click('[data-close]');
  // Closing still discards the typed (rejected) title, so the new
  // confirm-before-discard guard steps in — confirm it away.
  await page.click('[data-confirm]');

  // A suggestion carries both meters, Bock *and* Skill — how good the group
  // already is at a game is part of deciding whether to accept it at all.
  const suggestionRow = page.locator('.game-table-row', { hasText: 'E2E Partyspiel' });
  await suggestionRow.locator('.skill-row[data-kind="skill"] input[type="range"]').waitFor();

  // "Katalog" holds the accepted games only, so the still-open suggestion is
  // not in it; "Alle" lists both and keeps the suggestion recognizable
  // through its icon-only "Vorschlag" badge (plus a matching row border),
  // which an accepted game never carries.
  await page.click('button[data-tab="catalog"]');
  await page.waitForSelector('.game-table-row:has-text("E2E Partyspiel")', { state: 'detached' });
  await page.click('button[data-tab="all"]');
  await suggestionRow.locator('.game-row-status-badge[title="Vorschlag"]').waitFor();
  assert.ok(await suggestionRow.evaluate((el) => el.classList.contains('is-suggestion')));
  const acceptedRow = page.locator('.game-table-row', { hasText: 'Counter-Strike 2' });
  await acceptedRow.waitFor();
  assert.equal(await acceptedRow.locator('.game-row-status-badge').count(), 0);
  assert.equal(await acceptedRow.evaluate((el) => el.classList.contains('is-suggestion')), false);
  await page.click('button[data-tab="suggestions"]');
  await suggestionRow.waitFor();

  // ... and wherever a game gets picked to actually play, only the accepted
  // ones are offered — the Vote round's game list must not list it.
  const openRound = await (await page.request.get(`${BASE_URL}/api/votes`)).json();
  if (openRound.open) {
    const cancelled = await page.request.post(`${BASE_URL}/api/votes/cancel`);
    assert.ok(cancelled.ok(), `vote cleanup failed (${cancelled.status()}): ${await cancelled.text()}`);
  }
  await page.click('.nav-btn[data-view="votes"]');
  await page.waitForSelector('#votes-start');
  await page.waitForSelector('#votes-game-select-wrap:not([hidden])');
  await page.locator('#votes-game-select label.check-row', { hasText: 'Counter-Strike 2' }).waitFor();
  assert.equal(
    await page.locator('#votes-game-select label.check-row', { hasText: 'E2E Partyspiel' }).count(),
    0,
    'a suggestion must not be offered as a votable game',
  );
  await page.click('.nav-btn[data-view="gameCatalog"]');
  await suggestionRow.waitFor();

  // Promote the suggestion into the catalog via its detail modal (row-level
  // actions live only in there now — the row itself just carries the info
  // icon), then rate it right in the row — no detour through a separate
  // profile page needed.
  await suggestionRow.locator('[data-detail]').click();
  await page.click('#edit-promote');
  await page.waitForSelector('button[data-tab="catalog"].btn-primary');
  const partyspielRow = page.locator('.game-table-row', { hasText: 'E2E Partyspiel' });
  await partyspielRow.waitFor();
  const bockSlider = partyspielRow.locator('.skill-row[data-kind="bock"] input[type="range"]');
  const skillSlider = partyspielRow.locator('.skill-row[data-kind="skill"] input[type="range"]');

  // An unrated slider still has to sit at a plausible-looking position
  // (Bock/Skill are stored 1-10, never 0) - it stays dimmed and shows an
  // en dash instead of a blank label until touched.
  assert.ok(await bockSlider.evaluate((el) => el.classList.contains('skill-row-slider-unset')));
  assert.equal(await partyspielRow.locator('[data-kind="bock"] .skill-value').textContent(), '–');
  assert.ok(await skillSlider.evaluate((el) => el.classList.contains('skill-row-slider-unset')));

  // Both "X offen" facet filters are independent AND conditions: with both
  // active the still-fully-unrated game stays visible.
  await page.click('[data-rating-filter="bock"]');
  await page.click('[data-rating-filter="skill"]');
  await partyspielRow.waitFor();

  await bockSlider.fill('8');
  await page.waitForFunction(() => {
    const cards = Array.from(document.querySelectorAll('.game-table-row'));
    const card = cards.find((c) => c.textContent?.includes('E2E Partyspiel'));
    return card?.querySelector('[data-kind="bock"] .skill-value')?.textContent === '8';
  });
  assert.equal(await bockSlider.evaluate((el) => el.classList.contains('skill-row-slider-unset')), false);
  // Bock is rated now but Skill isn't - "Bock offen" alone already excludes
  // the row even though "Skill offen" is still active too (AND, not OR).
  await page.waitForSelector('.game-table-row:has-text("E2E Partyspiel")', { state: 'detached' });

  await page.click('[data-rating-filter="bock"]');
  await partyspielRow.waitFor();
  await skillSlider.fill('7');
  await page.waitForFunction(() => {
    const cards = Array.from(document.querySelectorAll('.game-table-row'));
    const card = cards.find((c) => c.textContent?.includes('E2E Partyspiel'));
    return card?.querySelector('[data-kind="skill"] .skill-value')?.textContent === '7';
  });
  await page.waitForSelector('.game-table-row:has-text("E2E Partyspiel")', { state: 'detached' });

  // Restore filter state for whatever runs next in this shared-page suite.
  await page.click('[data-rating-filter="skill"]');
  await partyspielRow.waitFor();
});

flowTest('shell', 'Spiele: a skill suggestion chip appears after enough recorded results and can be applied', async () => {
  const playersRes = await page.request.get(`${BASE_URL}/api/players`);
  const players = (await playersRes.json()) as Array<{ id: string; name: string }>;
  const alice = players.find((p) => p.name === 'E2E Alice Pro')!;
  const bob = players.find((p) => p.name === 'E2E Bob')!;
  const gamesRes = await page.request.get(`${BASE_URL}/api/games`);
  const games = (await gamesRes.json()) as Array<{ id: string; name: string }>;
  const cs2 = games.find((g) => g.name === 'Counter-Strike 2')!;

  for (let i = 0; i < 3; i++) {
    const res = await page.request.post(`${BASE_URL}/api/matches`, {
      data: { gameId: cs2.id, teams: [{ playerIds: [alice.id] }, { playerIds: [bob.id] }], winnerTeamIndex: 0 },
    });
    assert.equal(res.status(), 201);
  }

  await page.click('.nav-btn[data-view="gameCatalog"]');
  const cs2Row = page.locator('.game-table-row', { hasText: 'Counter-Strike 2' });
  await cs2Row.waitFor();
  const chip = cs2Row.locator('[data-apply-suggestion]');
  await chip.waitFor();

  await chip.click();
  await page.waitForFunction(() => {
    const cards = Array.from(document.querySelectorAll('.game-table-row'));
    const card = cards.find((c) => c.textContent?.includes('Counter-Strike 2'));
    const value = card?.querySelector('[data-kind="skill"] .skill-value')?.textContent;
    return value && value !== '–';
  });
});

flowTest('shell', 'Turnier: create a K.O. bracket from proposed teams and play it to a champion', async () => {
  // Tournaments live in the second tab of the shared Match area.
  await page.click('.nav-btn[data-view="matchmaking"]');
  await page.click('[data-section-tab="tournaments"]');
  await page.waitForSelector('#tourn-new-btn');
  await page.click('#tourn-new-btn');
  assert.equal(new URL(page.url()).hash, '#tournaments/new');
  assert.equal(await page.locator('#tourn-new-btn').count(), 0);
  assert.equal(await page.locator('[data-open-tournament], [data-completed-tournaments]').count(), 0);
  await page.goBack();
  await page.waitForSelector('#tourn-new-btn');
  assert.equal(new URL(page.url()).hash, '#tournaments');
  await page.goForward();
  await page.waitForSelector('#tourn-propose');
  assert.equal(new URL(page.url()).hash, '#tournaments/new');

  // Propose balanced teams from the checked players (all by default), then
  // create — the submit button only unlocks once a proposal exists.
  await page.waitForSelector('#tourn-propose');
  assert.equal(await page.locator('#tourn-submit').isDisabled(), true);
  const tournamentGamesRes = await page.request.get(`${BASE_URL}/api/games`);
  const tournamentGames = (await tournamentGamesRes.json()) as Array<{ id: string; icon: string; name: string }>;
  assert.ok(tournamentGames.length >= 2, 'the searchable tournament picker needs at least two games');
  const initialTournamentGameId = await page.locator('#tourn-game').inputValue();
  const initialTournamentGame = tournamentGames.find((game) => game.id === initialTournamentGameId)!;
  const otherTournamentGame = tournamentGames.find((game) => game.id !== initialTournamentGameId)!;
  assert.ok(initialTournamentGame);
  await page.click('#tourn-game-search');
  assert.equal(
    await page.locator('#tourn-game-search').inputValue(),
    '',
    'focusing the searchable picker should expose the full list without manually deleting the selected game',
  );
  const tournamentGameList = page.locator('#tourn-game-list');
  await tournamentGameList.waitFor({ state: 'visible' });
  assert.equal(
    await tournamentGameList.locator('.search-select-option').count(),
    tournamentGames.length,
    'the app-rendered listbox should expose every game before filtering',
  );
  assert.equal(
    await tournamentGameList.evaluate((element) => getComputedStyle(element).backgroundColor),
    'rgb(23, 30, 46)',
    'the game listbox should use the dark Respawn surface instead of the native white browser popup',
  );
  assert.equal(
    await tournamentGameList.evaluate((element) => getComputedStyle(element).maxHeight),
    '320px',
    'long game lists should scroll inside a bounded dropdown',
  );
  assert.notEqual(
    await page.locator('#tourn-game-search + .search-select-toggle .ui-icon').evaluate((element) => getComputedStyle(element).transform),
    'none',
    'the dropdown chevron should rotate to communicate the open state',
  );
  await page.keyboard.press('Tab');
  await tournamentGameList.waitFor({ state: 'hidden' });
  assert.equal(
    await page.evaluate(() => document.activeElement?.id),
    'tourn-teamcount',
    'Tab should leave the combobox instead of moving through every listbox option',
  );
  assert.ok(
    await page.locator('[data-selection-search]:has(#tourn-player-search)').evaluate((search) => {
      return search.closest('.selection-toolbar')?.nextElementSibling?.matches('.tournament-player-grid') === true;
    }),
    'the player search should be directly before the player list after the filters',
  );
  await page.click('#tourn-game-search');
  await tournamentGameList.waitFor({ state: 'visible' });
  await page.keyboard.press('ArrowDown');
  const activeTournamentGameId = await page.locator('#tourn-game-search').getAttribute('aria-activedescendant');
  assert.ok(
    activeTournamentGameId,
    'arrow-key navigation should expose the active option to assistive technology',
  );
  assert.notEqual(
    activeTournamentGameId,
    await tournamentGameList.locator('[aria-selected="true"]').getAttribute('id'),
    'arrow-key navigation should visibly distinguish the active option from the saved selection',
  );
  assert.equal(
    await page.locator(`#${activeTournamentGameId}`).evaluate((element) => getComputedStyle(element).outlineStyle),
    'solid',
    'the active option should receive its own visible focus treatment',
  );
  await page.keyboard.press('Escape');
  await tournamentGameList.waitFor({ state: 'hidden' });
  assert.equal(
    await page.locator('#tourn-game-search').inputValue(),
    initialTournamentGame.name,
    'Escape should close the listbox without changing the game',
  );
  const tournamentGameToggle = page.locator('#tourn-game-search + .search-select-toggle');
  assert.equal(await tournamentGameToggle.getAttribute('aria-label'), 'Auswahl öffnen');
  await tournamentGameToggle.dispatchEvent('click');
  await tournamentGameList.waitFor({ state: 'visible' });
  assert.equal(
    await tournamentGameToggle.getAttribute('aria-label'),
    'Auswahl schließen',
    'the toggle should expose its current close action while the listbox is open',
  );
  await page.locator('#tournament-draw-step-title').dispatchEvent('pointerdown');
  await tournamentGameList.waitFor({ state: 'hidden' });
  assert.equal(
    await tournamentGameToggle.getAttribute('aria-label'),
    'Auswahl öffnen',
    'a pointer interaction outside the picker should close it and restore the toggle action',
  );
  await page.click('#tourn-game-search');
  await tournamentGameList.waitFor({ state: 'visible' });
  await page.locator('#tourn-teamcount').focus();
  assert.equal(
    await page.locator('#tourn-game-search').inputValue(),
    initialTournamentGame.name,
    'leaving the picker without a new valid choice should restore its current selection',
  );
  await page.click('#tourn-game-search');
  await page.locator(`#tourn-game-list [data-search-select-value="${otherTournamentGame.id}"]`).click();
  await page.waitForFunction(
    (gameId) => (document.querySelector('#tourn-game') as HTMLInputElement | null)?.value === gameId,
    otherTournamentGame.id,
  );
  await page.click('#tourn-game-search');
  await tournamentGameList.waitFor({ state: 'visible' });
  assert.equal(
    await page.locator('#tourn-game-search').getAttribute('aria-expanded'),
    'true',
    'clicking the still-focused search field should reopen the listbox after a pointer selection',
  );
  await page.keyboard.press('Escape');
  const neighborHelp = page.locator('[aria-controls="tournament-neighbors-help"]');
  const lobbyHelp = page.locator('[aria-controls="tournament-lobby-help"]');
  assert.equal(await page.locator('[aria-controls="tournament-score-help"]').count(), 0);
  assert.equal(await page.locator('[aria-controls="tournament-two-legged-help"]').count(), 0);
  assert.ok((await page.locator('[data-create-player]').count()) >= 2);
  await page.click('[data-selection-search-trigger][aria-controls="tourn-player-search"]');
  await page.fill('#tourn-player-search', 'E2E Alice');
  await page.waitForFunction(() => document.querySelectorAll('[data-tourn-player-search-item]:not([hidden])').length === 1);
  assert.equal(await page.locator('[data-tourn-player-search-item]:not([hidden])').getByText('E2E Alice Pro', { exact: true }).count(), 1);
  const hiddenTournamentSelections = await page.locator('[data-tourn-player-search-item][hidden] [data-create-player]:checked').count();
  await page.click('#tourn-select-none');
  assert.equal(await page.locator('[data-tourn-player-search-item]:not([hidden]) [data-create-player]:checked').count(), 0);
  assert.equal(
    await page.locator('[data-tourn-player-search-item][hidden] [data-create-player]:checked').count(),
    hiddenTournamentSelections,
    'filtering must preserve hidden tournament participants',
  );
  await page.click('#tourn-select-all');
  await page.click('[data-selection-search]:has(#tourn-player-search) [data-selection-search-close]');
  // Single column on the phone viewport; the two-column cap applies from
  // --bp-md where the cards have room for avatar, name and skill value.
  assert.equal(
    await page.locator('.tournament-player-grid').evaluate((element) => getComputedStyle(element).gridTemplateColumns.split(' ').length),
    1,
  );
  await neighborHelp.click();
  assert.equal(await neighborHelp.getAttribute('aria-expanded'), 'true');
  await page.keyboard.press('Escape');
  await neighborHelp.focus();
  await page.keyboard.press('Enter');
  assert.equal(await neighborHelp.getAttribute('aria-expanded'), 'true');
  await page.keyboard.press('Escape');
  await lobbyHelp.click();
  assert.equal(await lobbyHelp.getAttribute('aria-expanded'), 'true');
  await page.keyboard.press('Escape');

  await page.click('#tourn-propose');
  await page.waitForSelector('[data-team-name]');
  await page.click('#tourn-submit');

  // Bracket renders with clickable team buttons; click winners until the
  // tournament reports itself finished.
  await page.waitForSelector('.bracket-match');
  assert.match(new URL(page.url()).hash, /^#tournaments\/.+/);
  const tournamentDetailHash = new URL(page.url()).hash;
  await page.reload();
  await page.waitForSelector('.bracket-match');
  assert.equal(new URL(page.url()).hash, tournamentDetailHash);
  for (let i = 0; i < 8; i++) {
    const btn = page.locator('button.bracket-team-row:not(.is-tbd)').first();
    if ((await btn.count()) === 0) break;
    if (await page.locator('text=Beendet').count()) break;
    await btn.click();
    await page.waitForTimeout(300);
  }
  await page.waitForSelector('text=Beendet', { timeout: 5000 });
});

flowTest('community', 'Info: create an entry, see it rendered', async () => {
  // Info is a topbar dialog, reachable from whatever view is open.
  await page.click('#info-btn');
  await page.waitForSelector('#info-new-btn');
  await page.click('#info-new-btn');
  await page.fill('#info-title', 'WLAN');
  await page.fill('#info-content', 'Netz: Respawn\nPasswort: kartoffel');
  await page.click('#info-form button[type="submit"]');
  await page.waitForSelector('text=kartoffel');

  // Regression: saving reloads the dialog's own data (load() -> renderOpenDialog()),
  // which used to rebuild .modal-body without restoring focus - the entry
  // form's close() already returned focus to "Eintrag anlegen" by this point,
  // and the async reload's DOM rebuild must not then drop it back to <body>.
  assert.equal(
    await page.evaluate(() => document.activeElement?.id),
    'info-new-btn',
    'focus must stay on "Eintrag anlegen" after the Info dialog refreshes its data'
  );

  // Modals stack now that Info is one itself: Escape must dismiss only the
  // topmost dialog, not the whole stack underneath it.
  await page.click('[data-delete-entry]');
  await page.waitForSelector('[data-confirm]');
  await page.keyboard.press('Escape');
  await page.waitForSelector('[data-confirm]', { state: 'detached' });
  assert.equal(await page.locator('.info-board-modal').count(), 1, 'Escape must not close the Info dialog underneath');
  await page.waitForSelector('text=kartoffel');

  await page.click('#info-new-btn');
  await page.fill('#info-title', 'Discord');
  await page.keyboard.press('Escape');
  // The entry form asks before discarding; that question is now the topmost
  // dialog and Escape declines it without taking Info down with it.
  await page.waitForSelector('[data-confirm]');
  await page.keyboard.press('Escape');
  await page.waitForSelector('[data-confirm]', { state: 'detached' });
  assert.equal(await page.locator('#info-title').count(), 1, 'the entry form stays open after declining');
  assert.equal(await page.locator('.info-board-modal').count(), 1);
  await page.keyboard.press('Escape');
  await page.waitForSelector('[data-confirm]');
  await page.click('[data-confirm]');
  await page.waitForSelector('#info-title', { state: 'detached' });

  // The dialog stays open over the current view until it is dismissed.
  assert.equal(await page.locator('.info-board-modal').count(), 1);
  await page.click('.info-board-modal [data-close]');
  await page.waitForSelector('.info-board-modal', { state: 'detached' });
});

flowTest('community', 'Modal: a pointer interaction started inside the dialog does not close it, but a real backdrop click still does', async () => {
  // Regression for modal.js's backdrop click-to-close: a click event's target
  // is the nearest common ancestor of its mousedown and mouseup targets, not
  // necessarily where either one landed. Selecting text (or dragging a
  // slider) that starts inside the dialog and ends on the bare backdrop used
  // to report the backdrop as e.target and close the dialog mid-interaction.
  await page.click('#info-btn');
  await page.waitForSelector('.info-board-modal');
  const title = page.locator('.info-board-modal .modal-header h2');
  const titleBox = await title.boundingBox();
  assert.ok(titleBox, 'modal title must be visible to anchor the drag');

  await page.mouse.move(titleBox.x + titleBox.width / 2, titleBox.y + titleBox.height / 2);
  await page.mouse.down();
  // Drag out past the dialog onto the bare backdrop before releasing, the
  // same motion a text selection or slider drag produces.
  await page.mouse.move(5, 5, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(100);
  assert.equal(await page.locator('.info-board-modal').count(), 1, 'a drag that started inside the dialog must not close it');

  // A genuine backdrop click - both mousedown and mouseup on the bare
  // backdrop - still closes the dialog as before.
  await page.mouse.move(5, 5);
  await page.mouse.down();
  await page.mouse.up();
  await page.waitForSelector('.info-board-modal', { state: 'detached' });
});

flowTest('community', 'Info: a long entry scrolls within a bounded box instead of collapsing', async () => {
  await page.click('#info-btn');
  await page.waitForSelector('#info-new-btn');

  // A short entry (well under the scroll threshold) renders in full, with no
  // bounded scroll box at all.
  await page.click('#info-new-btn');
  await page.fill('#info-title', 'Discord');
  await page.fill('#info-content', 'discord.gg/example');
  await page.click('#info-form button[type="submit"]');
  await page.waitForSelector('text=discord.gg/example');
  const discordEntry = page.locator('[data-info-entry]', { hasText: 'Discord' });
  assert.equal(await discordEntry.locator('.info-board-content-scroll').count(), 0);

  // A long entry stays fully visible - no toggle, nothing hidden - but
  // scrolls within a bounded box instead of stretching its card (and its
  // short neighbor) to match its full height.
  const longContent = Array.from({ length: 6 }, (_, i) => `Regel ${i + 1}: Sei nett zueinander.`).join('\n');
  await page.click('#info-new-btn');
  await page.fill('#info-title', 'Hausregeln');
  await page.fill('#info-content', longContent);
  await page.click('#info-form button[type="submit"]');
  const rulesEntry = page.locator('[data-info-entry]', { hasText: 'Hausregeln' });
  const scrollBox = rulesEntry.locator('.info-board-content-scroll');
  await scrollBox.waitFor();
  assert.equal(await rulesEntry.getByText('Regel 6: Sei nett zueinander.').isVisible(), true);
  // The box is actually bounded rather than merely tall enough to fit
  // everything - otherwise the scroll container would be pointless.
  const isBounded = await scrollBox.evaluate((el) => el.scrollHeight > el.clientHeight);
  assert.equal(isBounded, true);

  await page.click('.info-board-modal [data-close]');
  await page.waitForSelector('.info-board-modal', { state: 'detached' });
});

flowTest('food-orders', 'Essensbestellung: direkte Zahlung pro Personenblock und Lebenszyklus', async () => {
  await page.click('#nav-food-orders');
  await page.waitForSelector('#order-new-btn');
  await page.click('#order-new-btn');
  await page.getByLabel('Speisekarte (optional)', { exact: true }).waitFor();
  await page.fill('#order-title', "Pizza bei Luigi's");
  await setDateTimeField('order-sendat', '2026-12-24T20:00');
  await page.fill('#order-notes', 'Mindestbestellwert 15€, bar zahlen');
  await page.fill('#order-link', 'https://luigis-pizza.example/karte');
  await page.fill('#order-paypal', 'https://paypal.me/luigi');
  await page.fill('#order-tip', '10');
  await page.click('#order-form button[type="submit"]');
  await page.waitForSelector('text=Pizza bei Luigi');
  await page.waitForSelector('text=24.12. 20:00 Uhr');
  await page.waitForSelector('text=Mindestbestellwert 15€, bar zahlen');
  await page.waitForSelector('a[href="https://luigis-pizza.example/karte"]');
  assert.equal(await page.locator('a[href="https://paypal.me/luigi"] .ui-icon').count(), 1);
  await page.getByRole('button', { name: 'Bestellübersicht', exact: true }).waitFor();

  await page.click('[data-edit-details]');
  await page.getByLabel('Speisekarte', { exact: true }).waitFor();
  await setDateTimeField('sendat-input', '2026-12-24T21:30');
  await page.fill('#notes-input', 'Doch Kartenzahlung möglich');
  await page.click('#details-form button[type="submit"]');
  await page.waitForSelector('text=24.12. 21:30 Uhr');
  await page.waitForSelector('text=Doch Kartenzahlung möglich');

  assert.equal(await page.locator('[data-item-quantity]').inputValue(), '');
  assert.equal(await page.locator('[data-item-quantity]').getAttribute('placeholder'), 'Anzahl');
  assert.equal(await page.locator('.food-order-quantity-field > span').count(), 0);
  assert.equal(await page.locator('[data-item-quantity]').evaluate((input) => getComputedStyle(input).textAlign), 'left');
  await page.fill('[data-item-desc]', 'Margherita groß');
  await page.fill('[data-item-quantity]', '2');
  await page.fill('[data-item-price]', '9,50');
  await page.click('[data-add-item-form] button[type="submit"]');
  await page.waitForSelector('text=Margherita');
  await page.waitForSelector('.food-order-item-amount:has-text("20,90 €")');
  await page.waitForSelector('.food-order-item-amount:has-text("2 × 9,50 €")');
  await page.waitForSelector('.food-order-item-amount:has-text("inkl. 10% Trinkgeld")');
  await page.waitForSelector('.food-order-group-tip:has-text("inkl. 10 % Trinkgeld")');
  await page.waitForSelector('.food-order-total:has-text("Gesamtsumme inkl. 10% Trinkgeld")');
  await page.waitForSelector('.food-order-overview:has-text("2 Positionen von 1 Person")');
  await page.waitForSelector('.food-order-overview:has-text("0 von 1 bezahlt")');
  await page.waitForSelector('.food-order-overview:has-text("Gesamt 20,90")');
  await page.waitForSelector('.food-order-overview:has-text("offen 20,90")');

  await page.evaluate(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: async (value: string) => { (window as Window & { copiedFoodTotal?: string }).copiedFoodTotal = value; } },
    });
  });
  const marghieRow = page.locator('.food-order-item', { hasText: 'Margherita' }).first();
  const rowOrder = await marghieRow.evaluate((row) =>
    Array.from(row.children).map((child) => {
      if (child.matches('.food-order-item-description')) return 'description';
      if (child.matches('.food-order-item-amount')) return 'amount';
      if (child.matches('.food-order-item-action-cluster')) return 'cluster';
      return 'other';
    })
  );
  assert.deepEqual(rowOrder, ['description', 'amount', 'cluster', 'other']);
  assert.equal(await marghieRow.locator('[data-toggle-group-paid], [data-group-pay]').count(), 0);
  await marghieRow.locator('[data-copy-food-total]').click();
  assert.equal(await page.evaluate(() => (window as Window & { copiedFoodTotal?: string }).copiedFoodTotal), '20,90 €');

  const group = page.locator('.food-order-group', { hasText: alice.name });
  await page.waitForSelector('.food-order-paid-marker[aria-pressed="false"]:has-text("Bezahlt?")');
  assert.equal(await group.locator('.food-order-paid-marker').getAttribute('aria-pressed'), 'false');
  const openMarkerGeometry = await group.locator('.food-order-paid-marker').evaluate((marker) => {
    const rect = marker.getBoundingClientRect();
    return { left: rect.left, width: rect.width };
  });
  assert.equal(await group.locator('.food-order-group-amount').innerText(), '20,90 €');
  assert.equal(await group.locator('[data-group-pay]').count(), 1);
  assert.equal(await page.locator('.food-order-item [data-group-pay]').count(), 0);
  const groupActionOrder = await group.locator('.food-order-group-actions').evaluate((actions) =>
    Array.from(actions.children).map((child) => {
      if (child.matches('[data-copy-food-total]')) return 'copy';
      if (child.matches('[data-group-pay]')) return 'paypal';
      if (child.matches('[data-toggle-group-paid]')) return 'paid';
      if (child.matches('[data-remove-group]')) return 'remove';
      return 'spacer';
    })
  );
  assert.deepEqual(groupActionOrder, ['copy', 'paypal', 'paid', 'remove']);

  await page.evaluate(() => {
    const original = window.open;
    (window as unknown as { __restoreWindowOpen: () => void }).__restoreWindowOpen = () => { window.open = original; };
    window.open = ((_url?: string, _target?: string, features?: string) => {
      if (features && features.includes('noopener')) return null;
      const fake = {
        opener: window,
        closed: false,
        _location: '',
        get location() { return this._location; },
        set location(value: string) { this._location = value; },
        close() { this.closed = true; },
      };
      (window as unknown as { __lastPopup: typeof fake }).__lastPopup = fake;
      return fake as unknown as Window;
    }) as typeof window.open;
  });
  const lastPopup = () =>
    page.evaluate(() => {
      const popup = (window as unknown as { __lastPopup?: { location: string; closed: boolean } }).__lastPopup;
      return popup ? { location: popup.location, closed: popup.closed } : null;
    });

  await group.locator('[data-group-pay]').click();
  await page.waitForFunction(() => (window as unknown as { __lastPopup?: { location: string } }).__lastPopup?.location);
  assert.deepEqual(await lastPopup(), { location: 'https://paypal.me/luigi/20.90EUR', closed: false });
  assert.equal(await page.evaluate(() => (window as unknown as { __lastPopup?: { opener: unknown } }).__lastPopup?.opener), null);
  await page.waitForSelector('.modal h2:has-text("Bezahlt?")');
  assert.match(await page.locator('.modal-body p').first().innerText(), /20,90 € für .* an PayPal übergeben \(paypal\.me\)\./);
  await page.waitForSelector('.food-order-confirm-list li:has-text("2 × Margherita groß")');
  assert.equal(await page.locator('[data-confirm-copy]').count(), 2);
  assert.equal(
    await page.locator('[data-confirm-copy-kind="paypal"]').getAttribute('data-confirm-copy'),
    'https://paypal.me/luigi',
  );
  await page.locator('[data-confirm-copy-kind="paypal"]').click();
  assert.equal(await page.evaluate(() => (window as Window & { copiedFoodTotal?: string }).copiedFoodTotal), 'https://paypal.me/luigi');
  await page.locator('[data-confirm-copy-kind="total"]').click();
  assert.equal(await page.evaluate(() => (window as Window & { copiedFoodTotal?: string }).copiedFoodTotal), '20,90 €');
  assert.equal(await page.locator('.modal h2:has-text("Bezahlt?")').count(), 1);
  await page.click('[data-confirm-cancel]');
  await page.waitForSelector('.modal-backdrop', { state: 'detached' });
  assert.equal(await group.locator('.food-order-paid-marker').getAttribute('aria-pressed'), 'false');

  await group.locator('[data-group-pay]').click();
  await page.waitForSelector('.modal h2:has-text("Bezahlt?")');
  await page.click('[data-confirm-ok]');
  await page.waitForSelector('text=1 Position als bezahlt markiert.');
  await page.waitForSelector('.food-order-paid-marker[aria-pressed="true"]:has-text("Bezahlt")');
  const paidMarkerGeometry = await group.locator('.food-order-paid-marker').evaluate((marker) => {
    const rect = marker.getBoundingClientRect();
    return { left: rect.left, width: rect.width };
  });
  assert.deepEqual(paidMarkerGeometry, openMarkerGeometry);
  await waitForTextDecoration(group.locator('.food-order-group-amount'), 'line-through');
  await waitForTextDecoration(marghieRow.locator('.food-order-item-description'), 'line-through');
  await waitForTextDecoration(marghieRow.locator('.food-order-item-amount'), 'line-through');
  assert.equal(await marghieRow.locator('[data-remove-item]').isDisabled(), true);
  assert.equal(await marghieRow.locator('[data-copy-food-total]').isDisabled(), false);
  assert.equal(await marghieRow.locator('[data-group-pay]').count(), 0);
  assert.equal(await group.locator('[data-group-pay]').isDisabled(), true);
  assert.equal(await group.locator('[data-remove-group]').isDisabled(), true);
  assert.match((await group.locator('.food-order-paid-marker').getAttribute('title')) ?? '', new RegExp('Bezahlt, bestätigt von ' + alice.name));

  await group.locator('[data-toggle-group-paid]').click();
  await page.waitForSelector('.food-order-paid-marker[aria-pressed="false"]:has-text("Bezahlt?")');
  await waitForTextDecoration(marghieRow.locator('.food-order-item-description'), 'none');

  await page.fill('[data-item-desc]', 'Wasser');
  await page.fill('[data-item-quantity]', '1');
  await page.click('[data-add-item-form] button[type="submit"]');
  await page.waitForSelector('text=Wasser');
  assert.equal(await group.locator('.food-order-group-meta').innerText(), '3 Positionen · Preis fehlt');
  assert.equal(await group.locator('.food-order-group-amount').innerText(), '20,90 €');
  assert.equal(await group.locator('.food-order-group-copy').getAttribute('data-copy-food-total'), '20,90 €');
  assert.equal(await group.locator('[data-group-pay]').isDisabled(), true);
  await group.locator('[data-remove-group]').click();
  await page.waitForSelector('.modal h2:has-text("Deine 2 Positionen löschen?")');
  assert.equal(await page.locator('.food-order-confirm-list li').count(), 2);
  assert.equal(await page.locator('.modal-body').getByText('Lässt sich nicht rückgängig machen.').count(), 1);
  await page.click('[data-confirm-cancel]');
  await page.waitForSelector('.modal-backdrop', { state: 'detached' });
  const wasserRow = page.locator('.food-order-item', { hasText: 'Wasser' });
  await wasserRow.locator('[data-remove-item]').click();
  await page.waitForSelector('[data-confirm]');
  assert.equal(await page.locator('.modal h2').innerText(), '1 × Wasser löschen?');
  await page.click('[data-cancel]');
  await wasserRow.waitFor();
  await wasserRow.locator('[data-remove-item]').click();
  await page.click('[data-confirm]');
  await page.waitForSelector('.food-order-item:has-text("Wasser")', { state: 'detached' });

  // A previously paid group becomes payable again when a new priced position
  // is added. The full group sum is shown and the already-paid item remains
  // visible in the handoff. Only the newly added unpaid item is marked after
  // confirmation.
  await group.locator('[data-group-pay]').click();
  await page.waitForSelector('.modal h2:has-text("Bezahlt?")');
  await page.click('[data-confirm-ok]');
  await page.waitForSelector('.food-order-paid-marker[aria-pressed="true"]:has-text("Bezahlt")');
  await page.fill('[data-item-desc]', 'Nachtrag nach Bestätigung');
  await page.fill('[data-item-quantity]', '1');
  await page.fill('[data-item-price]', '4,00');
  await page.click('[data-add-item-form] button[type="submit"]');
  await page.waitForSelector('text=Nachtrag nach Bestätigung');
  await page.waitForSelector('.food-order-paid-marker[aria-pressed="false"]:has-text("Bezahlt?")');
  assert.equal(await group.locator('.food-order-group-amount').innerText(), '25,30 €');
  const changedTotalMarkerGeometry = await group.locator('.food-order-paid-marker').evaluate((marker) => {
    const rect = marker.getBoundingClientRect();
    return { left: rect.left, width: rect.width };
  });
  assert.deepEqual(changedTotalMarkerGeometry, openMarkerGeometry);
  assert.equal(await group.locator('[data-group-pay]').isDisabled(), false);
  await group.locator('[data-group-pay]').click();
  await page.waitForSelector('.modal h2:has-text("Bezahlt?")');
  assert.match(await page.locator('.modal-body p').first().innerText(), /25,30 € für/);
  assert.equal(await page.locator('.food-order-confirm-list li').count(), 2);
  await page.waitForSelector('.food-order-confirm-list li:has-text("2 × Margherita groß")');
  await page.waitForSelector('.food-order-confirm-list li:has-text("Nachtrag nach Bestätigung")');
  await page.click('[data-confirm-cancel]');
  await page.waitForSelector('.modal-backdrop', { state: 'detached' });
  await group.locator('[data-group-pay]').click();
  await page.waitForSelector('.modal h2:has-text("Bezahlt?")');
  await page.click('[data-confirm-ok]');
  await page.waitForSelector('text=1 Position als bezahlt markiert.');
  await page.waitForSelector('.food-order-paid-marker[aria-pressed="true"]:has-text("Bezahlt")');

  await page.keyboard.press('Control+K');
  await page.fill('#global-search-input', 'Margherita groß');
  await page.waitForSelector('.global-search-result:has-text("Pizza bei Luigi")');
  await page.click('.global-search-result:has-text("Pizza bei Luigi")');
  await page.waitForSelector('[data-order-card].search-target-highlight');

  // Keep the realtime follow-up GET pending while the close response is
  // applied. The lifecycle change must render from that response directly:
  // no one-line loading frame, no scroll reset, and the moved order remains
  // visible in the automatically opened history.
  let releaseCloseRefresh!: () => void;
  let closeRefreshSeen!: () => void;
  let closeRefreshFinished!: () => void;
  const closeRefreshRelease = new Promise<void>((resolve) => { releaseCloseRefresh = resolve; });
  const closeRefreshStarted = new Promise<void>((resolve) => { closeRefreshSeen = resolve; });
  const closeRefreshDone = new Promise<void>((resolve) => { closeRefreshFinished = resolve; });
  let closeRefreshBlocked = false;
  const closeRefreshRoute = async (route: import('playwright').Route) => {
    if (route.request().method() === 'GET' && !closeRefreshBlocked) {
      closeRefreshBlocked = true;
      closeRefreshSeen();
      await closeRefreshRelease;
      const response = await route.fetch();
      await route.fulfill({ response });
      closeRefreshFinished();
      return;
    }
    await route.continue();
  };
  await page.route('**/api/food-orders', closeRefreshRoute);
  const foodScroller = page.locator('#view-container');
  const scrollTopBeforeClose = await foodScroller.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
    return element.scrollTop;
  });
  assert.ok(scrollTopBeforeClose > 0);
  try {
    await page.click('[data-close-order]');
    await page.click('[data-confirm]');
    await closeRefreshStarted;
    await page.waitForSelector('[data-food-history][open] .badge-paused:has-text("Abgeschickt")');
    assert.equal(await page.getByText('Lädt…', { exact: true }).count(), 0);
    assert.equal(await page.locator('[data-closed-order]', { hasText: 'Pizza bei Luigi' }).isVisible(), true);
    assert.ok(await foodScroller.evaluate((element) => element.scrollTop > 0));
  } finally {
    releaseCloseRefresh();
    if (closeRefreshBlocked) await closeRefreshDone;
    await page.unroute('**/api/food-orders', closeRefreshRoute);
  }
  await page.click('[data-reopen-order]');
  await page.waitForSelector('.badge-playing >> text=Offen');
  await page.fill('[data-item-desc]', 'Vergessene Cola');
  await page.fill('[data-item-quantity]', '1');
  await page.fill('[data-item-price]', '2,50');
  await page.click('[data-add-item-form] button[type="submit"]');
  await page.waitForSelector('text=Vergessene Cola');
  await page.click('[data-close-order]');
  await page.click('[data-confirm]');
  await page.waitForSelector('.badge-paused >> text=Abgeschickt');
  await page.click('[data-finalize-order]');
  await page.click('[data-confirm]');
  await page.waitForSelector('.badge-offline >> text=Geschlossen');
  const closedOrder = page.locator('[data-closed-order]', { hasText: 'Pizza bei Luigi' });
  assert.equal(await closedOrder.locator('[data-reopen-order]').count(), 1);
  assert.equal(await closedOrder.locator('[data-edit-details]').count(), 0);
  assert.equal(await closedOrder.locator('[data-toggle-group-paid]').first().isDisabled(), true);
  assert.equal(await closedOrder.locator('[data-group-pay]').first().isDisabled(), true);

  // Finalizing is reversible one lock step at a time: reopening a finalized
  // order drops it back to "Abgeschickt", unlocking payment marking and
  // metadata edits again while items stay frozen.
  await closedOrder.locator('[data-reopen-order]').click();
  await page.waitForSelector('.badge-paused >> text=Abgeschickt');
  assert.equal(await closedOrder.locator('[data-edit-details]').count(), 1);
  assert.equal(await closedOrder.locator('[data-toggle-group-paid]').first().isDisabled(), false);

  await page.evaluate(() => (window as unknown as { __restoreWindowOpen: () => void }).__restoreWindowOpen());
});
flowTest('food-orders', 'Essensbestellung: orderer groups collapse/expand and pay as a group', async () => {
  await switchIdentityAndOpenFoodOrders('E2E Alice Pro');
  await page.click('#order-new-btn');
  await page.fill('#order-title', 'Gruppen-Test-Bestellung');
  await page.click('#order-form button[type="submit"]');
  await page.waitForSelector('text=Gruppen-Test-Bestellung');
  const groupOrderCard = page.locator('[data-order-card]', { hasText: 'Gruppen-Test-Bestellung' });

  await groupOrderCard.locator('[data-item-desc]').fill('Alice-Snack');
  await groupOrderCard.locator('[data-item-quantity]').fill('1');
  await groupOrderCard.locator('[data-item-price]').fill('3,00');
  await groupOrderCard.locator('[data-add-item-form] button[type="submit"]').click();
  await page.waitForSelector('text=Alice-Snack');
  assert.equal(await groupOrderCard.locator('.food-order-group-toggle').count(), 0);
  assert.equal(await groupOrderCard.locator('[data-toggle-all-groups]').count(), 0);
  assert.equal(await groupOrderCard.locator('.food-order-card-header-toggle').count(), 0);

  await switchIdentityAndOpenFoodOrders('E2E Bob');
  const bobFormCard = page.locator('[data-order-card]', { hasText: 'Gruppen-Test-Bestellung' });
  await bobFormCard.locator('[data-item-desc]').fill('Bob Erster Snack');
  await bobFormCard.locator('[data-item-quantity]').fill('1');
  await bobFormCard.locator('[data-item-price]').fill('1,00');
  await bobFormCard.locator('[data-add-item-form] button[type="submit"]').click();
  await page.waitForSelector('text=Bob Erster Snack');

  const orderCard = page.locator('[data-order-card]', { hasText: 'Gruppen-Test-Bestellung' });
  const bobGroup = orderCard.locator('.food-order-group', { hasText: 'E2E Bob' });
  const aliceGroup = orderCard.locator('.food-order-group', { hasText: 'E2E Alice Pro' });
  await bobGroup.locator('.food-order-group-toggle').waitFor();
  assert.equal(await bobGroup.locator('.food-order-group-toggle').getAttribute('aria-expanded'), 'true');
  assert.equal(await aliceGroup.locator('.food-order-group-toggle').getAttribute('aria-expanded'), 'false');
  assert.equal(await aliceGroup.locator('.food-order-group-items').isHidden(), true);
  assert.match(await bobGroup.locator('.food-order-group-toggle').innerText(), /E2E Bob \(du\)/);
  assert.equal(await bobGroup.locator('.food-order-group-toggle[aria-expanded="true"] .food-order-group-meta').textContent(), '1 Position');
  assert.equal(await bobGroup.locator('.food-order-group-amount').innerText(), '1,00 €');
  assert.equal(await bobGroup.locator('.food-order-item-copy').getAttribute('title'), 'Betrag dieser Position kopieren');

  await orderCard.locator('[data-toggle-all-groups]').click();
  await aliceGroup.locator('.food-order-group-toggle[aria-expanded="true"]').waitFor();
  assert.equal(await orderCard.locator('[data-toggle-all-groups]').innerText(), 'Alle einklappen');
  await orderCard.locator('[data-toggle-all-groups]').click();
  assert.equal(await aliceGroup.locator('.food-order-group-toggle').getAttribute('aria-expanded'), 'false');

  assert.equal(await bobGroup.locator('.food-order-group-toggle').getAttribute('aria-expanded'), 'false');
  await bobFormCard.locator('[data-item-desc]').fill('Bob Zweiter Snack');
  await bobFormCard.locator('[data-item-quantity]').fill('1');
  await bobFormCard.locator('[data-item-price]').fill('1,50');
  await bobFormCard.locator('[data-add-item-form] button[type="submit"]').click();
  await page.waitForSelector('text=Bob Zweiter Snack');
  assert.equal(await bobGroup.locator('.food-order-group-toggle').getAttribute('aria-expanded'), 'true');

  assert.equal(await bobGroup.locator('[data-group-pay]').count(), 0);

  await switchIdentityAndOpenFoodOrders('E2E Alice Pro');
  const detailsCard = page.locator('[data-order-card]', { hasText: 'Gruppen-Test-Bestellung' });
  await detailsCard.locator('[data-edit-details]').click();
  await page.fill('#paypal-input', 'https://paypal.me/luigi');
  await page.click('#details-form button[type="submit"]');
  await page.waitForSelector('[data-group-pay]');

  const bobGroupAfterLink = page.locator('[data-order-card]', { hasText: 'Gruppen-Test-Bestellung' }).locator('.food-order-group', { hasText: 'E2E Bob' });
  const bobMarker = bobGroupAfterLink.locator('[data-toggle-group-paid]');
  await bobMarker.click();
  await bobGroupAfterLink.locator('.food-order-paid-marker[aria-pressed="true"]:has-text("Bezahlt")').waitFor();
  assert.equal(await bobGroupAfterLink.locator('[data-group-pay]').isDisabled(), true);
  assert.equal(await bobGroupAfterLink.locator('[data-toggle-group-paid]').getAttribute('aria-pressed'), 'true');
  assert.equal(await bobGroupAfterLink.locator('.food-order-item .food-order-paid-marker').count(), 0);
  assert.equal(await bobGroupAfterLink.locator('[data-remove-group]').count(), 0);

  // The compact payment marker plus three action slots must remain inside the
  // header at the narrowest supported phone width instead of being clipped.
  await page.setViewportSize({ width: 320, height: 720 });
  const narrowGroupLayout = await bobGroupAfterLink.locator('.food-order-group-header').evaluate((header) => {
    const box = header.getBoundingClientRect();
    const marker = header.querySelector('.food-order-paid-marker');
    const controls = Array.from(header.querySelectorAll('.food-order-paid-marker, .food-order-group-amount, .food-order-group-actions button'));
    return {
      markerWidth: marker?.getBoundingClientRect().width ?? 0,
      markerHeight: marker?.getBoundingClientRect().height ?? 0,
      controlBounds: controls.map((control) => {
        const rect = control.getBoundingClientRect();
        return {
          name: control.getAttribute('aria-label') ?? control.textContent?.trim() ?? control.tagName,
          left: rect.left,
          right: rect.right,
          width: rect.width,
        };
      }),
      headerBounds: { left: box.left, right: box.right },
      controlsVisible: controls.every((control) => {
        const rect = control.getBoundingClientRect();
        return rect.width > 0 && rect.left >= box.left - 1 && rect.right <= box.right + 1;
      }),
      pageFits: document.documentElement.scrollWidth <= window.innerWidth,
    };
  });
  assert.ok(narrowGroupLayout.markerWidth <= 100);
  assert.ok(narrowGroupLayout.markerHeight >= 32);
  assert.equal(narrowGroupLayout.controlsVisible, true, JSON.stringify(narrowGroupLayout));
  assert.equal(narrowGroupLayout.pageFits, true);
  await page.setViewportSize({ width: 390, height: 844 });

  // Bob can undo the paid marker directly; reopening the group is an explicit
  // toggle and does not require a second confirmation dialog.
  await switchIdentityAndOpenFoodOrders('E2E Bob');
  const bobPaidGroup = page.locator('[data-order-card]', { hasText: 'Gruppen-Test-Bestellung' }).locator('.food-order-group', { hasText: 'E2E Bob' });
  await bobPaidGroup.locator('[data-toggle-group-paid]').click();
  await page.waitForSelector('.food-order-paid-marker[aria-pressed="false"]:has-text("Bezahlt?")');
});

flowTest('food-orders', 'Essensbestellung: PayPal-Handoff verwirft veraltete Daten und bleibt synchron', async () => {
  await switchIdentityAndOpenFoodOrders('E2E Alice Pro');

  type FoodScenario = { id: string; itemIds: string[]; title: string };
  type ScenarioItem = { description: string; priceCents?: number };

  const createScenario = async (title: string, items: ScenarioItem[], paypalLink = 'https://paypal.me/fresh-test', tipPercent?: number): Promise<FoodScenario> => {
    const orderResponse = await page.request.post(`${BASE_URL}/api/food-orders`, {
      data: { playerId: alice.id, title, paypalLink, ...(tipPercent === undefined ? {} : { tipPercent }) },
    });
    assert.equal(orderResponse.status(), 201, await orderResponse.text());
    const order = await orderResponse.json() as { id: string };
    let itemIds: string[] = [];
    for (const item of items) {
      const itemResponse = await page.request.post(`${BASE_URL}/api/food-orders/${order.id}/items`, {
        data: {
          playerId: alice.id,
          description: item.description,
          quantity: 1,
          ...(item.priceCents === undefined ? {} : { priceCents: item.priceCents }),
        },
      });
      assert.equal(itemResponse.status(), 201, await itemResponse.text());
      const serialized = await itemResponse.json() as { items: Array<{ id: string }> };
      itemIds = serialized.items.map((entry) => entry.id);
    }
    return { id: order.id, itemIds, title };
  };

  const openScenario = async (scenario: FoodScenario) => {
    await page.reload();
    await page.waitForSelector('#app:not([hidden])');
    await page.click('#nav-food-orders');
    // Use the generated id instead of the title: a failed/retried scenario
    // can leave an older card with the same title in the shared test event.
    // Matching that card makes the following group wait hang even though the
    // newly created scenario has already rendered correctly.
    const card = page.locator(`[data-order-card="${scenario.id}"]`);
    await card.waitFor();
    if (await card.locator('.food-order-card-body').getAttribute('hidden') !== null) {
      await card.locator('.food-order-card-header-toggle').click();
    }
    await card.locator('.food-order-card-body').waitFor({ state: 'visible' });
    const group = card.locator('.food-order-group', { hasText: 'E2E Alice Pro' });
    await group.locator('.food-order-group-header').waitFor();
    return { card, group };
  };

  const cleanupScenario = async (scenario: FoodScenario) => {
    const response = await page.request.delete(`${BASE_URL}/api/food-orders/${scenario.id}`);
    assert.ok([204, 404].includes(response.status()), await response.text());
  };

  // Keep the popup synchronous with the click while making its opener
  // harmless, exactly like the production handoff hardening requires.
  await page.evaluate(() => {
    const original = window.open;
    (window as unknown as { __restoreFreshPopup?: () => void }).__restoreFreshPopup = () => { window.open = original; };
    window.open = ((_url?: string, _target?: string, _features?: string) => {
      const popup = {
        opener: window as unknown as Window,
        closed: false,
        _location: '',
        get location() { return this._location; },
        set location(value: string) { this._location = value; },
        close() { this.closed = true; },
      };
      (window as unknown as { __freshPopup?: typeof popup }).__freshPopup = popup;
      return popup as unknown as Window;
    }) as typeof window.open;
  });

  const runStalePayCase = async (
    title: string,
    mutate: (scenario: FoodScenario) => Promise<void>,
    expectedMessage: string,
  ) => {
    const scenario = await createScenario(title, [{ description: `${title} Position`, priceCents: 5_00 }]);
    const { group } = await openScenario(scenario);
    let intercepted = false;
    const routeHandler = async (route: import('playwright').Route) => {
      if (!intercepted && route.request().method() === 'GET') {
        intercepted = true;
        await mutate(scenario);
      }
      await route.continue();
    };
    await page.route('**/api/food-orders', routeHandler);
    try {
      await group.locator('[data-group-pay]').click();
      await page.waitForSelector(`.toast-error:has-text("${expectedMessage}")`);
      assert.equal(intercepted, true);
    } finally {
      await page.unroute('**/api/food-orders', routeHandler);
    }
    await cleanupScenario(scenario);
  };

  await runStalePayCase(
    'Freshness gelöschte Position',
    async (scenario) => {
      const response = await page.request.delete(`${BASE_URL}/api/food-orders/${scenario.id}/items/${scenario.itemIds[0]}`, { data: { playerId: alice.id } });
      assert.equal(response.status(), 200, await response.text());
    },
    'Eine Position existiert nicht mehr. Bitte Betrag prüfen.',
  );
  await runStalePayCase(
    'Freshness bezahlte Position',
    async (scenario) => {
      const response = await page.request.patch(`${BASE_URL}/api/food-orders/${scenario.id}/items/${scenario.itemIds[0]}`, { data: { paid: true } });
      assert.equal(response.status(), 200, await response.text());
    },
    'Diese Person wurde inzwischen bereits als bezahlt markiert.',
  );
  await runStalePayCase(
    'Freshness entfernter PayPal-Link',
    async (scenario) => {
      const response = await page.request.patch(`${BASE_URL}/api/food-orders/${scenario.id}`, { data: { paypalLink: null } });
      assert.equal(response.status(), 200, await response.text());
    },
    'Für diese Bestellung ist kein PayPal-Link mehr hinterlegt.',
  );
  await runStalePayCase(
    'Freshness gelöschte Bestellung',
    async (scenario) => {
      const response = await page.request.delete(`${BASE_URL}/api/food-orders/${scenario.id}`);
      assert.equal(response.status(), 204, await response.text());
    },
    'Diese Bestellung existiert nicht mehr.',
  );
  await runStalePayCase(
    'Freshness abgeschlossene Bestellung',
    async (scenario) => {
      const closeResponse = await page.request.post(`${BASE_URL}/api/food-orders/${scenario.id}/close`);
      assert.equal(closeResponse.status(), 200, await closeResponse.text());
      const finalizeResponse = await page.request.post(`${BASE_URL}/api/food-orders/${scenario.id}/finalize`);
      assert.equal(finalizeResponse.status(), 200, await finalizeResponse.text());
    },
    'Bestellung geschlossen – keine Änderungen mehr möglich',
  );

  const genericPaypalLink = 'https://www.paypal.com/myaccount/transfer/homepage/pay?recipient=luigi%40example.com';
  const genericPaypalScenario = await createScenario(
    'Freshness allgemeiner PayPal-Link',
    [{ description: 'Allgemeiner PayPal-Link Position', priceCents: 5_00 }],
    genericPaypalLink,
  );
  const { group: genericPaypalGroup } = await openScenario(genericPaypalScenario);
  await page.evaluate(() => {
    window.open = ((_url?: string, _target?: string, _features?: string) => {
      const popup = {
        opener: window as unknown as Window,
        closed: false,
        _location: '',
        get location() { return this._location; },
        set location(value: string) { this._location = value; },
        close() { this.closed = true; },
      };
      (window as unknown as { __freshPopup?: typeof popup }).__freshPopup = popup;
      return popup as unknown as Window;
    }) as typeof window.open;
  });
  await genericPaypalGroup.locator('[data-group-pay]').click();
  await page.waitForFunction(() => (window as unknown as { __freshPopup?: { location: string } }).__freshPopup?.location);
  assert.deepEqual(
    await page.evaluate(() => {
      const popup = (window as unknown as { __freshPopup?: { location: string; closed: boolean } }).__freshPopup;
      return popup ? { location: popup.location, closed: popup.closed } : null;
    }),
    { location: genericPaypalLink, closed: false },
  );
  await page.waitForSelector('.modal h2:has-text("Bezahlt?")');
  assert.match(
    await page.locator('.modal-body p').first().innerText(),
    /PayPal geöffnet\. Die Summe 5,00 € für .* wird dort nicht vorausgefüllt\./,
  );
  await page.click('[data-confirm-cancel]');
  await page.waitForSelector('.modal-backdrop', { state: 'detached' });
  await cleanupScenario(genericPaypalScenario);

  // In a mixed group, a paid legacy position may be present after a new item
  // was added. It is still part of the initial group and its disappearance
  // must abort the handoff, while the paid-state race only covers open items.
  const mixedDeleteScenario = await createScenario('Freshness gelöschte Altposition', [
    { description: 'Bereits bezahlte Altposition', priceCents: 5_00 },
    { description: 'Offener Nachtrag', priceCents: 4_00 },
  ]);
  const paidResponse = await page.request.patch(`${BASE_URL}/api/food-orders/${mixedDeleteScenario.id}/items/${mixedDeleteScenario.itemIds[0]}`, { data: { paid: true } });
  assert.equal(paidResponse.status(), 200, await paidResponse.text());
  const { group: mixedDeleteGroup } = await openScenario(mixedDeleteScenario);
  let mixedDeleteIntercepted = false;
  const mixedDeleteRoute = async (route: import('playwright').Route) => {
    if (!mixedDeleteIntercepted && route.request().method() === 'GET') {
      mixedDeleteIntercepted = true;
      // The real DELETE route correctly refuses paid positions. Simulate a
      // stale server response instead, so this test still covers a previously
      // paid legacy position disappearing from the complete initial group.
      const response = await route.fetch();
      const payload = await response.json() as { orders: Array<{ id: string; items: Array<{ id: string }> }> };
      const targetOrder = payload.orders.find((order) => order.id === mixedDeleteScenario.id);
      assert.ok(targetOrder);
      targetOrder.items = targetOrder.items.filter((item) => item.id !== mixedDeleteScenario.itemIds[0]);
      await route.fulfill({ response, json: payload });
      return;
    }
    await route.continue();
  };
  await page.route('**/api/food-orders', mixedDeleteRoute);
  try {
    await mixedDeleteGroup.locator('[data-group-pay]').click();
    await page.waitForSelector('.toast-error:has-text("Eine Position existiert nicht mehr. Bitte Betrag prüfen.")');
    assert.equal(mixedDeleteIntercepted, true);
  } finally {
    await page.unroute('**/api/food-orders', mixedDeleteRoute);
  }
  await cleanupScenario(mixedDeleteScenario);

  // A zero-priced position is still a valid priced position. Together with a
  // missing price it must expose the 0,00 € subtotal and keep its copy action.
  const zeroScenario = await createScenario('Freshness Nullbetrag plus offen', [
    { description: 'Nullbetrag', priceCents: 0 },
    { description: 'Preis noch offen' },
  ]);
  const { card: zeroCard, group: zeroGroup } = await openScenario(zeroScenario);
  assert.match(await zeroCard.locator('.food-order-total').innerText(), /Gesamtsumme.*unvollständig[\s\S]*0,00/);
  assert.equal(await zeroGroup.locator('.food-order-group-meta').innerText(), '2 Positionen · Preis fehlt');
  assert.equal(await zeroGroup.locator('.food-order-group-amount').innerText(), '0,00 €');
  assert.equal(await zeroGroup.locator('.food-order-group-copy').getAttribute('data-copy-food-total'), '0,00 €');
  assert.equal(await zeroGroup.locator('[data-group-pay]').isDisabled(), true);
  await zeroGroup.locator('[data-toggle-group-paid]').click();
  await page.waitForSelector('.food-order-paid-marker[aria-pressed="true"]:has-text("Bezahlt")');
  await waitForTextDecoration(zeroGroup.locator('.food-order-group-amount'), 'line-through');
  await cleanupScenario(zeroScenario);

  // Tip rounding is defined per payable line, so the group sum, order
  // overview, total row and PayPal handoff must agree even when aggregation
  // would round differently (two 1-cent lines at 50% tip are 0,04 €).
  const roundingScenario = await createScenario('Trinkgeld-Rundung', [
    { description: 'Ein-Cent-Position A', priceCents: 1 },
    { description: 'Ein-Cent-Position B', priceCents: 1 },
  ], 'https://paypal.me/rounding-test', 50);
  const { card: roundingCard, group: roundingGroup } = await openScenario(roundingScenario);
  assert.equal(await roundingGroup.locator('.food-order-group-amount').innerText(), '0,04 €');
  assert.match(await roundingCard.locator('.food-order-overview').innerText(), /Gesamt 0,04 €/);
  assert.match(await roundingCard.locator('.food-order-total').innerText(), /0,04 €/);
  await cleanupScenario(roundingScenario);

  // While the first fresh GET is paused, an item add triggers the realtime
  // refresh path. The shared single-flight coordinator must settle on the
  // current group snapshot: the new item belongs in the complete handoff
  // amount and list, but remains open until the confirmation is accepted.
  const concurrencyScenario = await createScenario('Freshness parallele Aktualisierung', [{ description: 'Erster Betrag', priceCents: 2_50 }]);
  const { group: concurrencyGroup } = await openScenario(concurrencyScenario);
  let firstRequestSeen!: () => void;
  let releaseFirstRequest!: () => void;
  let followUpGetSeen!: () => void;
  const firstSeen = new Promise<void>((resolve) => { firstRequestSeen = resolve; });
  const release = new Promise<void>((resolve) => { releaseFirstRequest = resolve; });
  const followUpGet = new Promise<void>((resolve) => { followUpGetSeen = resolve; });
  let orderListGetCount = 0;
  const concurrencyRoute = async (route: import('playwright').Route) => {
    if (route.request().method() === 'GET') {
      orderListGetCount += 1;
      if (orderListGetCount === 2) followUpGetSeen();
      if (orderListGetCount === 1) {
        firstRequestSeen();
        await release;
      }
    }
    await route.continue();
  };
  await page.route('**/api/food-orders', concurrencyRoute);
  try {
    await concurrencyGroup.locator('[data-group-pay]').click();
    await firstSeen;
    const addResponse = await page.request.post(`${BASE_URL}/api/food-orders/${concurrencyScenario.id}/items`, {
      data: { playerId: alice.id, description: 'Nachtrag während Refresh', quantity: 1, priceCents: 1_00 },
    });
    assert.equal(addResponse.status(), 201, await addResponse.text());
    assert.ok(orderListGetCount >= 1);
    releaseFirstRequest();
    await followUpGet;
    await page.waitForSelector('.modal h2:has-text("Bezahlt?")');
    assert.match(await page.locator('.modal-body p').first().innerText(), /3,50 € für/);
    assert.equal(await page.locator('.food-order-confirm-list li').count(), 2);
    assert.equal(await page.locator('.food-order-confirm-list li:has-text("Nachtrag während Refresh")').count(), 1);
    await page.click('[data-confirm-cancel]');
    await page.waitForSelector('.modal-backdrop', { state: 'detached' });
    await concurrencyGroup.locator('.food-order-item', { hasText: 'Nachtrag während Refresh' }).waitFor();
  } finally {
    await page.unroute('**/api/food-orders', concurrencyRoute);
  }
  await cleanupScenario(concurrencyScenario);

  // Group deletion is confirmed against a visible snapshot. A position added
  // while that dialog is open is outside the confirmed list and must survive.
  const deleteSnapshotScenario = await createScenario('Freshness Löschen-Snapshot', [{ description: 'Vorhandene Position', priceCents: 1_00 }]);
  const { card: deleteSnapshotCard, group: deleteSnapshotGroup } = await openScenario(deleteSnapshotScenario);
  let deleteSnapshotIntercepted = false;
  const deleteSnapshotRoute = async (route: import('playwright').Route) => {
    if (!deleteSnapshotIntercepted && route.request().method() === 'GET') {
      deleteSnapshotIntercepted = true;
      const response = await page.request.post(`${BASE_URL}/api/food-orders/${deleteSnapshotScenario.id}/items`, {
        data: { playerId: alice.id, description: 'Während Bestätigung ergänzt', quantity: 1, priceCents: 2_00 },
      });
      assert.equal(response.status(), 201, await response.text());
    }
    await route.continue();
  };
  await page.route('**/api/food-orders', deleteSnapshotRoute);
  try {
    await deleteSnapshotGroup.locator('[data-remove-group]').click();
    await page.waitForSelector('.modal h2:has-text("Deine 1 Position löschen?")');
    await page.click('[data-confirm-ok]');
    await page.waitForSelector('text=Während Bestätigung ergänzt');
    await deleteSnapshotCard.locator('.food-order-item', { hasText: 'Vorhandene Position' }).waitFor({ state: 'detached' });
    assert.equal(await deleteSnapshotCard.locator('.food-order-item', { hasText: 'Während Bestätigung ergänzt' }).count(), 1);
    assert.equal(deleteSnapshotIntercepted, true);
  } finally {
    await page.unroute('**/api/food-orders', deleteSnapshotRoute);
  }
  await cleanupScenario(deleteSnapshotScenario);

  // Promise.all deletion is deliberately partial-safe: if one DELETE fails,
  // the successful sibling is gone, the failed one remains, and the quiet
  // authoritative refresh reconciles both without a loading frame.
  const partialScenario = await createScenario('Freshness Teil-Löschen', [
    { description: 'Teilweise entfernen', priceCents: 1_00 },
    { description: 'Teilweise behalten', priceCents: 1_50 },
  ]);
  const { card: partialCard, group: partialGroup } = await openScenario(partialScenario);
  const failingItemId = partialScenario.itemIds[1];
  const partialRoute = async (route: import('playwright').Route) => {
    if (route.request().method() === 'DELETE' && route.request().url().endsWith(`/items/${failingItemId}`)) {
      await route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ error: 'Simulierter Teilfehler' }) });
      return;
    }
    await route.continue();
  };
  await page.route(`**/api/food-orders/${partialScenario.id}/items/${failingItemId}`, partialRoute);
  try {
    await partialGroup.locator('[data-remove-group]').click();
    await page.waitForSelector('.modal h2:has-text("Deine 2 Positionen löschen?")');
    await page.click('[data-confirm-ok]');
    await page.waitForSelector('.toast-error');
    await partialCard.locator('.food-order-item', { hasText: 'Teilweise entfernen' }).waitFor({ state: 'detached' });
    await partialCard.locator('.food-order-item', { hasText: 'Teilweise behalten' }).waitFor();
  } finally {
    await page.unroute(`**/api/food-orders/${partialScenario.id}/items/${failingItemId}`, partialRoute);
  }
  await cleanupScenario(partialScenario);
  await page.evaluate(() => (window as unknown as { __restoreFreshPopup?: () => void }).__restoreFreshPopup?.());
});

flowTest('food-orders', 'Essensbestellung: Bestellübersicht consolidates positions for the creator/admin and can close the order', async () => {
  await switchIdentityAndOpenFoodOrders('E2E Alice Pro');
  await page.click('#order-new-btn');
  await page.fill('#order-title', 'Bestellübersicht-Test');
  await page.fill('#order-tip', '10');
  const createOrderResponse = page.waitForResponse(
    (response) => response.url() === `${BASE_URL}/api/food-orders` && response.request().method() === 'POST',
  );
  await page.click('#order-form button[type="submit"]');
  const createdOrderResponse = await createOrderResponse;
  assert.equal(createdOrderResponse.status(), 201, await createdOrderResponse.text());
  const createdOrder = await createdOrderResponse.json() as { id: string; open: boolean };
  assert.equal(createdOrder.open, true);
  const listOrderId = createdOrder.id;
  const listOrderCard = page.locator(`[data-order-card="${listOrderId}"]`);
  await listOrderCard.waitFor();

  // "Gruppen-Test-Bestellung" (from the previous test) is still open, so
  // there are now two open orders at once - each card gets its own
  // whole-order collapse toggle, independent of the per-orderer-group one.
  // The just-created order stays open while the older one starts collapsed;
  // that state must survive a live re-render triggered elsewhere (the item
  // adds below).
  const groupOrderCard = page.locator('[data-order-card]', { hasText: 'Gruppen-Test-Bestellung' });
  await page.waitForSelector('.food-order-card-header-toggle');
  assert.equal(await groupOrderCard.locator('.food-order-card-header-toggle').count(), 1);
  assert.equal(await listOrderCard.locator('.food-order-card-header-toggle').count(), 1);
  assert.equal(await groupOrderCard.locator('.food-order-card-header-toggle .food-order-card-title').innerText(), 'Gruppen-Test-Bestellung');
  assert.equal(await groupOrderCard.locator('.food-order-card-body').getAttribute('hidden'), '');
  assert.equal(await groupOrderCard.locator('.food-order-card-body').isVisible(), false);
  assert.equal(await listOrderCard.locator('.food-order-card-body').isVisible(), true);

  const addItem = async (desc: string, quantity: string, price?: string) => {
    await listOrderCard.locator('[data-item-desc]').fill(desc);
    await listOrderCard.locator('[data-item-quantity]').fill(quantity);
    if (price) await listOrderCard.locator('[data-item-price]').fill(price);
    const responsePromise = page.waitForResponse(
      (response) =>
        response.url() === `${BASE_URL}/api/food-orders/${listOrderId}/items` &&
        response.request().method() === 'POST',
    );
    await listOrderCard.locator('[data-add-item-form] button[type="submit"]').click();
    const response = await responsePromise;
    assert.equal(response.status(), 201, await response.text());
    // Earlier orders in this shared shard contain the same descriptions.
    // A page-wide or case-insensitive wait can therefore resolve before this
    // exact add and live re-render finish, letting the next add race it.
    await listOrderCard.getByText(`${quantity} × ${desc}`, { exact: true }).waitFor();
  };
  await addItem('Margherita', '1', '8,50');
  await addItem('margherita', '2', '8,50');
  await addItem('Wasser', '1');

  // The three item-add re-renders above must not have silently re-expanded
  // "Gruppen-Test-Bestellung" again - collapse state belongs to the person
  // looking at it, same rule as the orderer-group toggle above.
  assert.equal(await groupOrderCard.locator('.food-order-card-body').isVisible(), false);
  await groupOrderCard.locator('.food-order-card-header-toggle').click();
  await page.waitForSelector('[data-order-card]:has-text("Gruppen-Test-Bestellung") .food-order-card-body:not([hidden])');

  await listOrderCard.locator('[data-open-order-list]').click();
  await page.waitForSelector('.modal h2:has-text("Bestellübersicht – Bestellübersicht-Test")');
  // Same normalized description + same price merges into one consolidated
  // row (AP4.2) — 1 + 2 = 3 × Margherita.
  await page.waitForSelector('.food-order-consolidated-row:has-text("3 × Margherita")');
  await page.waitForSelector('.food-order-consolidated-row:has-text("1 × Wasser")');
  await page.waitForSelector('.food-order-consolidated-row:has-text("kein Preis")');
  await page.waitForSelector('text=Bestellung ist noch offen.');
  // Unpriced Wasser keeps the subtotal flagged as incomplete.
  await page.waitForSelector('.food-order-consolidated-totals:has-text("Zwischensumme (unvollständig)")');
  await page.waitForSelector('.food-order-consolidated-totals:has-text("+ 10% Trinkgeld")');
  await page.waitForSelector('.food-order-consolidated-totals:has-text("Gesamt (unvollständig)")');

  // The clipboard "Liste kopieren" action was removed - the dialog no longer
  // offers it at all.
  assert.equal(await page.locator('[data-copy-consolidated-list]').count(), 0);

  // A direct food-order link expands the target before the first populated
  // render, even though multiple open orders currently exist.
  await page.keyboard.press('Escape');
  await page.waitForSelector('.modal-backdrop', { state: 'detached' });
  await page.goto(`${BASE_URL}/#foodOrders/${listOrderId}`);
  await page.reload();
  const directOrderCard = page.locator('[data-order-card]', { hasText: 'Bestellübersicht-Test' });
  await directOrderCard.waitFor();
  assert.equal(await directOrderCard.locator('.food-order-card-body').isVisible(), true);

  // Home's Aktuell entry carries the same order target as a push/deep link,
  // so tapping it also lands on the expanded card.
  await page.click('.nav-btn[data-view="home"]');
  const currentOrder = page.locator(`[data-current-item="food-order:${listOrderId}"]`);
  await currentOrder.waitFor();
  await currentOrder.locator('.home-current-navigate').click();
  await directOrderCard.waitFor();
  assert.equal(await directOrderCard.locator('.food-order-card-body').isVisible(), true);

  // The dialog can close the still-open order directly (AP4.7).
  await directOrderCard.locator('[data-open-order-list]').click();
  await page.click('[data-close-order-from-list]');
  await page.click('[data-confirm]');
  await page.waitForSelector('text=Bestellung ist noch offen.', { state: 'detached' });
  await page.waitForSelector('[data-close-order-from-list]', { state: 'detached' });
  await page.keyboard.press('Escape');
  await page.waitForSelector('.modal-backdrop', { state: 'detached' });

  // Sent orders live in the collapsed history. A reminder/push-style direct
  // link must open that section so the requested order is immediately visible.
  await page.goto(`${BASE_URL}/#foodOrders/${listOrderId}`);
  await page.reload();
  const directHistory = page.locator('[data-food-history]');
  await directHistory.waitFor();
  assert.equal(await directHistory.getAttribute('open'), '');
  assert.equal(
    await page.locator('[data-closed-order]', { hasText: 'Bestellübersicht-Test' }).isVisible(),
    true,
  );

  // The list is visible to everyone, including a non-creator on a closed order.
  await switchIdentityAndOpenFoodOrders('E2E Bob');
  await page.waitForSelector('text=Bestellübersicht-Test');
  assert.equal(
    await page.locator('[data-closed-order]', { hasText: 'Bestellübersicht-Test' }).locator('[data-open-order-list]').count(),
    1
  );

  // Leave the shared page back on Alice's identity - every later flow in
  // this shard assumes that starting point, same as before these food-order
  // tests started switching identities.
  await switchIdentityAndOpenFoodOrders('E2E Alice Pro');
});

flowTest('food-orders', "Essensbestellung: the description field suggests the order's own existing positions while typing", async (t) => {
  const realtimeProbeOrderIds: string[] = [];
  t.after(async () => {
    for (const probeOrderId of realtimeProbeOrderIds) {
      const response = await page.request.delete(`${BASE_URL}/api/food-orders/${probeOrderId}`);
      assert.ok([204, 404].includes(response.status()), await response.text());
    }
  });

  await switchIdentityAndOpenFoodOrders('E2E Alice Pro');
  await page.click('#order-new-btn');
  await page.fill('#order-title', 'Vorschlags-Test');
  await page.click('#order-form button[type="submit"]');
  await page.waitForSelector('text=Vorschlags-Test');
  const suggestOrderCard = page.locator('[data-order-card]', { hasText: 'Vorschlags-Test' });
  if (await suggestOrderCard.locator('.food-order-card-body').getAttribute('hidden') !== null) {
    await suggestOrderCard.locator('.food-order-card-header-toggle').click();
  }

  // A brand-new order's first position has nothing to suggest yet - the
  // description field stays a plain text input without the search-select
  // chrome.
  assert.equal(await suggestOrderCard.locator('[data-desc-suggest]').count(), 0);

  // Instrument document.addEventListener/removeEventListener before any
  // dropdown-bearing render happens, so the counter below reflects the true
  // number of 'pointerdown' listeners wireDescSuggest() has registered - not
  // just a delta from some later point.
  await page.evaluate(() => {
    const w = window as unknown as { __pointerdownListenerCount: number };
    w.__pointerdownListenerCount = 0;
    const originalAdd = document.addEventListener.bind(document);
    const originalRemove = document.removeEventListener.bind(document);
    document.addEventListener = ((
      type: string,
      listener: EventListenerOrEventListenerObject,
      options?: boolean | AddEventListenerOptions
    ) => {
      if (type === 'pointerdown') w.__pointerdownListenerCount += 1;
      return originalAdd(type, listener, options);
    }) as typeof document.addEventListener;
    document.removeEventListener = ((
      type: string,
      listener: EventListenerOrEventListenerObject,
      options?: boolean | EventListenerOptions
    ) => {
      if (type === 'pointerdown') w.__pointerdownListenerCount -= 1;
      return originalRemove(type, listener, options);
    }) as typeof document.removeEventListener;
  });
  const pointerdownListenerCount = () =>
    page.evaluate(() => (window as unknown as { __pointerdownListenerCount: number }).__pointerdownListenerCount);

  await suggestOrderCard.locator('[data-item-desc]').fill('Margherita groß');
  await suggestOrderCard.locator('[data-item-price]').fill('8,50');
  await suggestOrderCard.locator('[data-item-quantity]').fill('1');
  await suggestOrderCard.locator('[data-add-item-form] button[type="submit"]').click();
  await suggestOrderCard.locator('.food-order-item', { hasText: 'Margherita groß' }).waitFor();

  // Once the order has a position, the field gains the dropdown - opening it
  // via its toggle lists that exact existing description. Its render also
  // registered wireDescSuggest()'s document-level pointerdown listener,
  // alongside one for every other order-with-a-position card this shard's
  // earlier flows have left open on the same shared page - so this reads the
  // current count as a baseline instead of assuming a specific number.
  const descField = suggestOrderCard.locator('[data-desc-suggest]');
  await descField.waitFor();
  const afterFirstPosition = await pointerdownListenerCount();

  // renderFoodOrders() rebuilds the whole card - including this wrapper - on
  // every realtime re-render, so add two more positions via the API
  // (no click involved) to trigger two re-renders without any interaction.
  // Each one re-wires the currently visible order-with-a-position cards'
  // listeners while the old, now-detached wrappers' listeners are
  // deliberately *not* removed yet - cleanup is lazy, the same as the shared
  // search-select's own pattern - so the count should keep growing with
  // every render that has no click in between.
  const orderId = await suggestOrderCard.getAttribute('data-order-card');
  await page.request.post(`${BASE_URL}/api/food-orders/${orderId}/items`, {
    data: { playerId: alice.id, description: 'Wasser', quantity: 1 },
  });
  await suggestOrderCard.locator('.food-order-item', { hasText: 'Wasser' }).waitFor();
  const afterWasser = await pointerdownListenerCount();
  assert.ok(
    afterWasser > afterFirstPosition,
    'a re-render without any click should register at least one more pointerdown listener, not clean up the previous one'
  );

  await page.request.post(`${BASE_URL}/api/food-orders/${orderId}/items`, {
    data: { playerId: alice.id, description: 'Cola', quantity: 1 },
  });
  await suggestOrderCard.locator('.food-order-item', { hasText: 'Cola' }).waitFor();
  const afterCola = await pointerdownListenerCount();
  assert.ok(afterCola > afterWasser, 'a second re-render without any click should again grow the listener count, not stay flat');

  // A single pointerdown anywhere on the page must let every detached
  // wrapper's listener remove itself - before the fix nothing ever called
  // removeEventListener, so this count would only ever grow, unboundedly,
  // over a multi-day event.
  await page.click('h1.view-title');
  const afterClick = await pointerdownListenerCount();
  assert.ok(afterClick < afterCola, 'a single pointerdown must let the stale, detached listeners remove themselves again');

  // Typing filters the open list live. The option also carries the price it
  // was entered with, so it's visible before picking it.
  await descField.locator('[data-desc-toggle]').click();
  await page.waitForSelector('.food-order-desc-field .search-select-option:has-text("Margherita groß")');
  assert.match(
    (await page.locator('.food-order-desc-field .search-select-option', { hasText: 'Margherita groß' }).textContent()) ?? '',
    /8,50/
  );
  await descField.locator('[data-item-desc]').fill('marg');
  await page.waitForSelector('.food-order-desc-field .search-select-option:has-text("Margherita groß")');
  assert.equal(await descField.locator('.search-select-option').count(), 1);

  // Socket refreshes used to rebuild the open combobox continuously. Keep a
  // probe order in the newest cache until after the deferred render so the
  // test verifies both DOM stability and that the flush renders real data.
  const createRealtimeProbe = async (title: string) => {
    const refresh = page.waitForResponse(
      (response) => new URL(response.url()).pathname === '/api/food-orders' && response.request().method() === 'GET',
    );
    const response = await page.request.post(`${BASE_URL}/api/food-orders`, {
      data: { playerId: alice.id, title },
    });
    assert.equal(response.status(), 201, await response.text());
    const probe = await response.json() as { id: string };
    realtimeProbeOrderIds.push(probe.id);
    const refreshResponse = await refresh;
    assert.equal(refreshResponse.status(), 200);
    await refreshResponse.finished();
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    return probe.id;
  };

  await descField.evaluate((element) => { element.dataset.e2eInstance = 'outside-pointer'; });
  await createRealtimeProbe('Realtime-Render-Probe A');
  assert.equal(await descField.getAttribute('data-e2e-instance'), 'outside-pointer');

  // A realistic press must not let the pointerdown-close flush detach the
  // card toggle before pointerup/click. The first tap must collapse the card.
  const cardToggle = suggestOrderCard.locator('.food-order-card-header-toggle');
  await cardToggle.scrollIntoViewIfNeeded();
  const cardToggleBox = await cardToggle.boundingBox();
  assert.ok(cardToggleBox);
  await page.mouse.move(cardToggleBox.x + cardToggleBox.width / 2, cardToggleBox.y + cardToggleBox.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(80);
  await page.mouse.up();
  await suggestOrderCard.locator('.food-order-card-body').waitFor({ state: 'hidden' });
  await page.waitForFunction(() => document.querySelector('[data-desc-suggest][data-e2e-instance="outside-pointer"]') === null);
  await page.locator('[data-order-card]', { hasText: 'Realtime-Render-Probe A' }).waitFor();

  await cardToggle.click();
  await suggestOrderCard.locator('.food-order-card-body').waitFor({ state: 'visible' });
  const descInput = descField.locator('[data-item-desc]');
  await descInput.fill('marg');
  await descField.evaluate((element) => { element.dataset.e2eInstance = 'suggestion-click'; });
  await createRealtimeProbe('Realtime-Render-Probe B');
  assert.equal(await descField.getAttribute('data-e2e-instance'), 'suggestion-click');
  assert.equal(await descField.locator('.search-select-option').count(), 1);

  await descField.locator('.search-select-option', { hasText: 'Margherita groß' }).click();
  assert.equal(await descField.locator('[data-item-desc]').inputValue(), 'Margherita groß');
  assert.equal(await suggestOrderCard.locator('[data-item-price]').inputValue(), '8,50');
  await page.waitForFunction(() => document.querySelector('[data-desc-suggest][data-e2e-instance="suggestion-click"]') === null);
  await page.locator('[data-order-card]', { hasText: 'Realtime-Render-Probe B' }).waitFor();

  // Shift+Tab closes the list in keydown, then moves focus before the deferred
  // render replaces the card. The logically focused control must survive that
  // replacement instead of dropping focus back to the document body.
  await descInput.fill('marg');
  await descField.evaluate((element) => { element.dataset.e2eInstance = 'keyboard-tab'; });
  await createRealtimeProbe('Realtime-Render-Probe C');
  assert.equal(await descField.getAttribute('data-e2e-instance'), 'keyboard-tab');
  await descInput.press('Shift+Tab');
  await page.waitForFunction(() => document.querySelector('[data-desc-suggest][data-e2e-instance="keyboard-tab"]') === null);
  assert.equal(
    await page.evaluate(() => document.activeElement !== document.body && document.querySelector('#view-container')?.contains(document.activeElement)),
    true,
    'the deferred render must restore the meaningful food-order control reached by Shift+Tab'
  );
  await page.locator('[data-order-card]', { hasText: 'Realtime-Render-Probe C' }).waitFor();

  for (const probeOrderId of realtimeProbeOrderIds) {
    const response = await page.request.delete(`${BASE_URL}/api/food-orders/${probeOrderId}`);
    assert.equal(response.status(), 204, await response.text());
  }
  await page.locator('[data-order-card]', { hasText: 'Realtime-Render-Probe A' }).waitFor({ state: 'detached' });
  await page.locator('[data-order-card]', { hasText: 'Realtime-Render-Probe B' }).waitFor({ state: 'detached' });
  await page.locator('[data-order-card]', { hasText: 'Realtime-Render-Probe C' }).waitFor({ state: 'detached' });

  // This field is free text (the main supported case per the PR description
  // is typing something genuinely new), so an unmatched query keeps the list
  // closed instead of showing an empty-state box - on a phone that box would
  // sit right over the next field (quantity) and eat the tap meant for it.
  // Playwright's .click() itself fails if another element intercepts the
  // pointer at that point, so this also proves nothing is left overlapping.
  await descField.locator('[data-item-desc]').fill('xyz-nicht-vorhanden');
  assert.equal(await descField.evaluate((el) => el.classList.contains('is-open')), false);
  const quantityInput = suggestOrderCard.locator('[data-item-quantity]');
  await quantityInput.click();
  assert.equal(await quantityInput.evaluate((el) => el === document.activeElement), true);

  // Reopening with an empty query re-lists every suggestion. ArrowDown
  // activates the first option and sets aria-activedescendant; typing
  // further re-filters and must not leave that attribute pointing at an
  // option id that may no longer be in the (rebuilt) list.
  await descInput.fill('');
  await page.waitForSelector('.food-order-desc-field .search-select-option');
  await descInput.press('ArrowDown');
  assert.ok(await descInput.getAttribute('aria-activedescendant'));
  await descInput.press('a');
  assert.equal(await descInput.getAttribute('aria-activedescendant'), null);

  // A fresh open leaves no option pre-activated (activeIndex -1). ArrowUp
  // from that state must land on the alphabetically last suggestion
  // ("Wasser" of Cola/Margherita groß/Wasser) rather than skip past it, which
  // the plain wrap-around arithmetic otherwise does starting from -1.
  await descInput.fill('');
  await page.waitForSelector('.food-order-desc-field .search-select-option');
  await descInput.press('ArrowUp');
  await descInput.press('Enter');
  assert.equal(await descInput.inputValue(), 'Wasser');

  // Picking a suggestion reuses its exact spelling instead of whatever was
  // typed - the point being that the consolidated "Bestellübersicht" keeps
  // merging repeat orders of the same item into one row instead of splitting
  // it because someone spelled it slightly differently. It also syncs the
  // price field to the picked suggestion, overwriting whatever price happens
  // to already be typed for the new position.
  const priceInput = suggestOrderCard.locator('[data-item-price]');
  await priceInput.fill('1,00');
  await descInput.fill('marg');
  await descField.locator('.search-select-option', { hasText: 'Margherita groß' }).click();
  assert.equal(await descInput.inputValue(), 'Margherita groß');
  assert.equal(await priceInput.inputValue(), '8,50');

  // ...and just as reliably clears it again when the next picked suggestion
  // has no recorded price - a price auto-filled by an earlier pick must
  // never silently survive picking a different, price-less suggestion
  // afterwards.
  await descInput.fill('');
  await page.waitForSelector('.food-order-desc-field .search-select-option');
  await descInput.press('ArrowUp');
  await descInput.press('Enter');
  assert.equal(await descInput.inputValue(), 'Wasser');
  assert.equal(await priceInput.inputValue(), '');

  await descInput.fill('marg');
  await descField.locator('.search-select-option', { hasText: 'Margherita groß' }).click();
  assert.equal(await descInput.inputValue(), 'Margherita groß');
  assert.equal(await priceInput.inputValue(), '8,50');
  await suggestOrderCard.locator('[data-item-quantity]').fill('2');
  await suggestOrderCard.locator('[data-add-item-form] button[type="submit"]').click();

  await suggestOrderCard.locator('[data-open-order-list]').click();
  await page.waitForSelector('.modal h2:has-text("Bestellübersicht – Vorschlags-Test")');
  await page.waitForSelector('.food-order-consolidated-row:has-text("3 × Margherita groß")');
  await page.waitForSelector('.food-order-consolidated-row:has-text("1 × Wasser")');
  await page.waitForSelector('.food-order-consolidated-row:has-text("1 × Cola")');
  assert.equal(await page.locator('.food-order-consolidated-row').count(), 3);
  await page.keyboard.press('Escape');
  await page.waitForSelector('.modal-backdrop', { state: 'detached' });

  // The own-group delete is the only destructive bulk action and therefore
  // shows the full list before it can be confirmed.
  await suggestOrderCard.locator('[data-remove-group]').click();
  await page.waitForSelector('.modal h2:has-text("Deine 4 Positionen löschen?")');
  assert.equal(await page.locator('.food-order-confirm-list li').count(), 4);
  await page.click('[data-confirm-ok]');
  await page.waitForSelector('text=Noch keine Positionen.');
});

flowTest('food-orders', 'Essensbestellung: marking a position paid does not scroll the Essen view back to the top', async () => {
  // Regression for the socket race behind the reported bug: PATCHing a
  // position's paid state makes the server broadcast foodOrders:changed to
  // every connected client, including the very device that just made the
  // change - often before that device's own fetch() promise has even
  // resolved. Handling that echo with a hard cache invalidate collapsed the
  // whole card list down to a one-line "Lädt…" placeholder for a moment,
  // which clamps .view-container's scrollTop to 0 - and it never recovered
  // once the real content came back (see refreshFoodOrders in
  // views/foodOrders.js, which now refetches quietly in place instead).
  await page.click('#nav-food-orders');
  await page.waitForSelector('#order-new-btn');
  await page.click('#order-new-btn');
  await page.fill('#order-title', 'Scroll-Test-Bestellung');
  await page.click('#order-form button[type="submit"]');
  await page.waitForSelector('text=Scroll-Test-Bestellung');

  // Scoped to this order's own card throughout: earlier food-order-shard
  // tests in this same file (shared page/session, see flowTest above) leave
  // their own orders open with their own live add-item forms on screen, so
  // bare page-level selectors here could hit the wrong order's form.
  const orderCard = page.locator('[data-order-card]', { hasText: 'Scroll-Test-Bestellung' });
  if (await orderCard.locator('.food-order-card-body').getAttribute('hidden') !== null) {
    await orderCard.locator('.food-order-card-header-toggle').click();
  }

  // Enough positions for the order card alone to overflow the phone
  // viewport's .view-container, so there is an actual scroll position to
  // lose.
  for (let i = 0; i < 15; i += 1) {
    await orderCard.locator('[data-item-desc]').fill(`Scrolltest-Artikel ${i}`);
    await orderCard.locator('[data-item-quantity]').fill('1');
    await orderCard.locator('[data-item-price]').fill('1,00');
    await orderCard.locator('[data-add-item-form] button[type="submit"]').click();
    // Once the order has at least one position, the description field grows
    // its own suggestion dropdown listing already-entered descriptions (see
    // renderDescField) - a bare text match would then also hit that
    // suggestion option, not just the newly added row itself.
    await orderCard.locator('.food-order-item', { hasText: `Scrolltest-Artikel ${i}` }).waitFor();
  }

  const viewContainer = page.locator('#view-container');
  assert.equal(
    await viewContainer.evaluate((el) => el.scrollHeight > el.clientHeight),
    true,
    'the Essen view must actually be scrollable for this test to be meaningful'
  );

  // Center the target position in the viewport ourselves (native
  // scrollIntoView, not Playwright's own actionability auto-scroll) so its
  // toggle is already fully visible - other food-order cards this shard's
  // earlier tests left on screen make "the very bottom of the page" an
  // unreliable stand-in for "this row's own position", and a Playwright
  // click that still had to nudge the page into view would move the exact
  // scroll position this test checks.
  const lastRow = orderCard.locator('.food-order-item', { hasText: 'Scrolltest-Artikel 14' });
  await lastRow.evaluate((el) => el.scrollIntoView({ block: 'center' }));
  const scrollTopBeforeToggle = await viewContainer.evaluate((el) => el.scrollTop);
  assert.ok(scrollTopBeforeToggle > 0);

  await lastRow.evaluate((row) => (row.closest('[data-order-card]')?.querySelector('[data-toggle-group-paid]') as HTMLElement | null)?.click());
  await orderCard.locator('.food-order-paid-marker[aria-pressed="true"]:has-text("Bezahlt")').waitFor();
  // Give the realtime echo of this device's own change time to arrive and
  // (if the regression came back) trigger its reload.
  await page.waitForTimeout(300);

  const scrollTopAfterToggle = await viewContainer.evaluate((el) => el.scrollTop);
  assert.ok(
    scrollTopAfterToggle > scrollTopBeforeToggle - 4,
    `expected the scroll position to stay near ${scrollTopBeforeToggle}, was ${scrollTopAfterToggle}`
  );
});

flowTest('community', 'An- & Abreise: carpool marks the driver, enforces seats, driver can only delete', async () => {
  // A third player to later demonstrate a full carpool.
  await createAccountForFlow('E2E Carol');

  await openOrgaTab('arrivals');
  await page.waitForSelector('[data-new-carpool="arrival"]');
  assert.equal((await page.locator('[data-new-carpool="arrival"]').textContent())?.trim(), 'Fahrt anlegen');

  // Current identity is still "E2E Alice Pro" - she creates the carpool and
  // becomes its driver, with just 1 free passenger seat.
  await page.click('[data-new-carpool="arrival"]');
  await page.fill('#carpool-label', 'Auto Alice');
  await page.fill('#carpool-location', 'Hamburg');
  await page.fill('#carpool-seats', '1');
  await page.click('#carpool-form button[type="submit"]');
  await page.waitForSelector('.arrivals-member-row:has-text("E2E Alice Pro"):has-text("Fahrer")');
  await page.waitForSelector('.arrivals-free-seat-row');
  // The driver only ever gets Bearbeiten/Löschen, never a "Raus" button.
  await page.waitForSelector('[data-edit-carpool]');
  await page.waitForSelector('[data-remove-carpool]');
  assert.equal(await page.locator('[data-leave-carpool]').count(), 0);

  // Switch identity to Bob: he joins, taking the last seat.
  await switchIdentityAndOpenArrivals('E2E Bob');
  await page.waitForSelector('[data-join-carpool]');
  await page.click('[data-join-carpool]');
  await page.waitForSelector('.arrivals-free-seat-row', { state: 'detached' });
  await page.waitForSelector('[data-leave-carpool]');

  // "Alle Zeiten" below shows who Bob is riding with.
  const bobTimesRow = page.locator('.arrivals-times-row', { hasText: 'E2E Bob' });
  await bobTimesRow.waitFor();
  assert.match((await bobTimesRow.textContent()) ?? '', /Fahrer: E2E Alice Pro/);

  // A third player finds the carpool full and can't join.
  await switchIdentityAndOpenArrivals('E2E Carol');
  await page.waitForSelector('.arrivals-member-row:has-text("E2E Bob"):has-text("Mitfahrer")');
  assert.equal(await page.locator('.arrivals-free-seat-row').count(), 0);
  assert.equal(await page.locator('[data-join-carpool]').count(), 0);

  // Bob leaves, freeing the seat back up; the driver deletes the group.
  await switchIdentityAndOpenArrivals('E2E Bob');
  await page.click('[data-leave-carpool]');
  await page.waitForSelector('.arrivals-free-seat-row');
  assert.doesNotMatch((await bobTimesRow.textContent()) ?? '', /Fahrer:/);

  await switchIdentityAndOpenArrivals('E2E Alice Pro');
  await page.click('[data-remove-carpool]');
  await page.waitForSelector('[data-confirm]');
  // Destructive confirm dialogs must default focus to Cancel (not the danger
  // action) and use a concrete verb, so a stray Enter right after opening
  // cannot re-trigger the deletion.
  assert.equal(
    await page.locator('.modal-body [data-cancel]').evaluate((el) => el === document.activeElement),
    true
  );
  assert.equal(await page.locator('[data-confirm]').innerText(), 'Löschen');
  assert.equal(
    await page.locator('[data-confirm]').evaluate((el) => el.classList.contains('btn-danger')),
    true
  );
  await page.keyboard.press('Enter');
  await page.waitForSelector('.modal-backdrop', { state: 'detached' });
  // The carpool must still exist - Enter cancelled instead of confirming.
  await page.waitForSelector('[data-remove-carpool]');

  // Deleting for real still works through an explicit confirm click.
  await page.click('[data-remove-carpool]');
  await page.click('[data-confirm]');
  await page.waitForSelector('text=Noch keine Fahrgemeinschaft.');
});

flowTest(
  'community',
  'An- & Abreise: an unrelated Orga To-Do keeps the unsaved Ankunft/Abreise draft and focus',
  async () => {
    // Regression for the area shell: checklist:changed now re-renders every
    // Orga tab (see app.js), not only the Checkliste's own, so that the
    // To-Dos tab's live count stays correct everywhere. An unrelated To-Do
    // assigned to Alice by someone else must not throw away what she is
    // still typing into "Meine An-/Abreise" on a different Orga tab.
    await switchIdentityAndOpenArrivals('E2E Alice Pro');

    const note = page.locator('#arrival-note');
    await note.click();
    await note.fill('Bringe Verlängerungskabel mit');

    const badge = page.locator('[data-section-tab="checklist"] [data-section-tab-count]');
    const before = (await badge.textContent()) ?? '';

    // Playwright's page.request shares the browser context's cookie jar. An
    // authenticated response renews its session cookie, so using Bob's
    // explicit Cookie header there can silently switch the page itself to
    // Bob once a racing response settles. Node fetch is intentionally
    // isolated from that jar while the open Alice page receives the socket
    // update this scenario needs.
    const created = await fetch(`${BASE_URL}/api/checklist/tasks/todo`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: bob.cookie },
      body: JSON.stringify({ playerId: bob.id, title: 'Kabeltrommel besorgen', assigneePlayerIds: [alice.id] }),
    });
    assert.equal(created.status, 201, await created.text());
    // The changed tab count is the visible proof that the unrelated event's
    // re-render actually landed on this tab, not just that nothing happened.
    await page.waitForFunction(
      ({ selector, previous }) => document.querySelector(selector)?.textContent !== previous,
      { selector: '[data-section-tab="checklist"] [data-section-tab-count]', previous: before }
    );

    assert.equal(await note.inputValue(), 'Bringe Verlängerungskabel mit');
    assert.equal(
      await page.evaluate(() => document.activeElement?.id === 'arrival-note'),
      true,
      'focus must stay in the Notiz field across a background Orga re-render'
    );

    // Saving afterwards still works, so the surviving node is the live one.
    await page.click('#arrival-form button[type="submit"]');
    await page.waitForSelector('text=An-/Abreise gespeichert.');

    // The assignment above sent Alice a personal, still-unread push
    // notification ("Dir wurde eine Aufgabe zugewiesen") - the same
    // getCurrentPushLogEntryFor() query the header highlight banner uses
    // would otherwise keep surfacing it as the *next* highlighted entry the
    // moment a later test's own notification gets dismissed, since it
    // orders by creation time and this one is now the oldest unseen. Clear
    // it so it does not leak into the "Durchsage" test's
    // #notification-highlight assertions right after this one.
    const cleared = await fetch(`${BASE_URL}/api/push/seen-all`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: alice.cookie },
      body: JSON.stringify({ playerId: alice.id }),
    });
    assert.equal(cleared.status, 200, await cleared.text());
  }
);

flowTest('community', 'Durchsage: notification center can navigate, mark read and remove without duplicating Home', async () => {
  await page.click('.nav-btn[data-view="more"]');
  await page.click('[data-navigate="broadcast"]');
  await page.waitForSelector('#broadcast-message');
  const defaultEndsAt = new Date(await page.inputValue('#broadcast-ends-at')).getTime();
  assert.ok(defaultEndsAt >= Date.now() + 55 * 60 * 1000);
  assert.ok(defaultEndsAt <= Date.now() + 65 * 60 * 1000);
  await page.fill('#broadcast-message', 'Essen ist da!');
  await page.click('#broadcast-form button[type="submit"]');
  // Wait for the durable signal (the entry in "Letzte Durchsagen"), not the
  // 2.6s confirmation toast — too short-lived to assert on reliably.
  try {
    await page.click('details[data-broadcast-history] summary');
    await page.waitForSelector('.lb-row >> text=Essen ist da!', { timeout: 8000 });
  } catch (err) {
    console.error('[debug] view:', (await page.innerText('#view-container')).slice(0, 500));
    console.error('[debug] toasts:', await page.innerText('#toast-container'));
    const apiState = await page.request.get(`${BASE_URL}/api/broadcasts`);
    console.error('[debug] api:', JSON.stringify(await apiState.json()).slice(0, 300));
    throw err;
  }

  // The highlighted strip shows the newest active push on any view and
  // deep-links back into Durchsagen. Opening it marks the entry as read,
  // while the bell keeps it in the durable history. (Auswertung is
  // admin-mode-only, so "any view" is exercised with Home here instead.)
  await page.click('.nav-btn[data-view="home"]');
  const highlight = page.locator('#notification-highlight:has-text("Essen ist da!")');
  await highlight.waitFor();
  await highlight.locator('[data-notification-highlight-navigate]').click();
  await page.waitForSelector('#broadcast-message');
  await page.waitForSelector('#notification-highlight', { state: 'hidden' });

  await page.click('#notifications-btn');
  assert.equal(await page.getAttribute('#notifications-btn', 'aria-expanded'), 'true');
  assert.equal(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    true,
    'notification center must not create horizontal page scroll on mobile',
  );
  const panelBox = await page.locator('#notifications-panel').boundingBox();
  assert.ok(panelBox && panelBox.x >= 0 && panelBox.x + panelBox.width <= 390);
  await page.keyboard.press('Escape');
  await page.waitForSelector('#notifications-panel', { state: 'hidden' });
  assert.equal(await page.getAttribute('#notifications-btn', 'aria-expanded'), 'false');
  assert.equal(await page.evaluate(() => document.activeElement?.id), 'notifications-btn');
  await page.click('#notifications-btn');
  const foodNotification = page.locator('.notification-center-entry:has-text("Essen ist da!")');
  await foodNotification.waitFor();
  assert.ok(!((await foodNotification.getAttribute('class')) ?? '').includes('is-unread'));

  // Removing is personal and leaves the durable Durchsage itself intact.
  await foodNotification.locator('[data-notification-hide]').click();
  await foodNotification.waitFor({ state: 'detached' });
  await page.click('[data-notification-close]');
  await page.waitForSelector('.lb-row >> text=Essen ist da!');

  // Home no longer renders a second notification history in a different
  // style; notifications live only under the bell.
  await page.click('.nav-btn[data-view="home"]');
  assert.equal(await page.locator('.section-title:has-text("Mitteilungen")').count(), 0);

  // A second message can be ended early by its creator; it remains a past
  // notification until this player removes it from the center.
  await page.click('.nav-btn[data-view="more"]');
  await page.click('[data-navigate="broadcast"]');
  await page.fill('#broadcast-message', 'Turnier startet gleich!');
  await page.click('#broadcast-form button[type="submit"]');
  const activeRow = page.locator('.lb-row:has-text("Turnier startet gleich!")');
  await activeRow.waitFor();
  await activeRow.locator('[data-end-broadcast]').click();
  await activeRow.locator('text=Beendet am').waitFor();
  await page.click('#notifications-btn');
  const endedNotification = page.locator('.notification-center-entry:has-text("Turnier startet gleich!")');
  await endedNotification.waitFor();
  // Ending the broadcast before anyone opened this notification resolves it
  // server-side (resolvePushTopic in routes/broadcasts.ts): the center shows
  // it as already settled rather than as something still needing attention,
  // even though it was never explicitly marked read.
  await endedNotification.locator('text=Obsolet').waitFor();
  assert.ok(!((await endedNotification.getAttribute('class')) ?? '').includes('is-unread'));
  // "Alle gelesen" has nothing to do here either: every visible entry is
  // already obsolete, so it stays disabled instead of offering a click with
  // no visible effect.
  assert.ok(await page.isDisabled('[data-notifications-seen-all]'));
  // The dedicated cleanup action only ever removes settled entries like this
  // one, leaving anything still open untouched.
  await page.click('[data-notifications-hide-resolved]');
  await endedNotification.waitFor({ state: 'detached' });
  // Earlier flows in this shared fixture may have left their own, unrelated
  // entries in this player's history — clear those the regular way so the
  // panel is guaranteed empty for the next flow, regardless of what "Obsolete
  // aufräumen" already removed above.
  if ((await page.locator('.notification-center-entry').count()) > 0) {
    await page.click('[data-notifications-hide-all]');
    // Confirming lands a pointerdown outside `.notification-center`, which the
    // panel's own document-level listener reads as "click outside" and closes
    // it — even though the deletion underneath still goes through. Reopen it
    // to actually observe the resulting empty state below.
    await page.click('[data-confirm]');
    await page.click('#notifications-btn');
  }
  await page.waitForSelector('text=Keine Mitteilungen.');
  await page.click('[data-notification-close]');

  // A visible time-limited banner removes itself at its deadline even when
  // no later socket event happens and the user never clicks it.
  const meResponse = await page.request.get(`${BASE_URL}/api/me`);
  assert.equal(meResponse.status(), 200);
  const { id: myId } = await meResponse.json() as { id: string };
  const expiring = await page.request.post(`${BASE_URL}/api/broadcasts`, {
    data: { playerId: myId, message: 'Läuft automatisch ab', endsAt: Date.now() + 2000 },
  });
  assert.equal(expiring.status(), 201);
  // APIRequestContext bypasses the sending browser. Phase 5c intentionally
  // has no delivery signal, so model the browser's explicit REST refresh.
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('respawn:notifications-refresh')));
  await page.waitForSelector('#notification-highlight:has-text("Läuft automatisch ab")');
  await page.waitForSelector('#notification-highlight', { state: 'hidden', timeout: 5000 });
});

flowTest('community', 'Captain-Draft: pick captains, run the live draft to completion', async () => {
  await openTeams();
  await page.click('[data-mm-mode="draft"]');
  await page.waitForSelector('[data-captain-toggle]');

  // The session account ("E2E Alice Pro") must be a captain so this page is
  // allowed to pick; E2E Bob is the second captain, everyone else is pool.
  await page.click('label.check-row:has-text("E2E Alice Pro") input[data-captain-toggle]');
  await page.click('label.check-row:has-text("E2E Bob") input[data-captain-toggle]');
  await page.waitForSelector('#draft-start:not([disabled])');
  await page.click('#draft-start');
  await page.waitForSelector('text=Captain Draft läuft');

  // The destructive draft-cancel confirmation must read differently than the
  // neighboring Abbrechen button (both used to say "Abbrechen"). Dismiss via
  // the dialog's own Abbrechen button so the draft keeps running afterward.
  await page.click('#draft-cancel');
  await page.waitForSelector('[data-confirm]');
  assert.equal(await page.locator('[data-confirm]').innerText(), 'Draft abbrechen');
  assert.notEqual(
    await page.locator('[data-confirm]').innerText(),
    await page.locator('.modal-body [data-cancel]').innerText(),
  );
  await page.click('.modal-body [data-cancel]');
  await page.waitForSelector('.modal-backdrop', { state: 'detached' });

  // Live board appears; it's Alice's turn (first captain). Keep picking
  // until the pool is empty — the last player is auto-assigned server-side,
  // which ends the draft and returns the view to the regular Teams-auslosen
  // page (no pinned "draft result" card — see matchmaking.js).
  await page.waitForSelector('text=Captain Draft läuft');
  for (let i = 0; i < 8; i++) {
    if ((await page.locator('text=Captain Draft läuft').count()) === 0) break;
    const pick = page.locator('button[data-draft-pick]').first();
    if ((await pick.count()) === 0) break;
    await pick.click();
    await page.waitForTimeout(300);
  }
  await page.waitForSelector('text=Captain Draft läuft', { state: 'detached', timeout: 5000 });

  // The finished draft landed in the shared Historie (not pinned to the
  // page top) with the usual "Ergebnis eintragen" follow-up available there.
  await page.waitForSelector('details.history-details:has(summary:has-text("Historie"))');
  await openMatchmakingHistory();
  await page.waitForSelector('[data-record-draw]');
});

flowTest('community', 'the device back button steps back through in-app views instead of leaving the tool', async () => {
  // Land on a known view, then navigate through two more — each deliberate
  // tab switch should push a history entry (see switchView in app.js).
  await page.click('.nav-btn[data-view="home"]');
  await page.waitForSelector('.view-title');
  await page.click('.nav-btn[data-view="votes"]');
  await page.waitForFunction(() => document.querySelector('.view-title')?.textContent === 'Vote');
  // Auswertung is admin-mode-only, so the third view here is Spiele instead.
  await page.click('.nav-btn[data-view="gameCatalog"]');
  await page.waitForFunction(() => document.querySelector('.view-title')?.textContent === 'Spiele');

  // Back should undo the last switch (Spiele -> votes), not leave the
  // single-page app (there is nowhere else to navigate to in this test, so
  // if this fell through to real browser navigation the page would end up
  // blank/erroring instead of showing the votes view).
  await page.goBack();
  await page.waitForFunction(() => document.querySelector('.view-title')?.textContent === 'Vote');

  await page.goBack();
  await page.waitForFunction(() => document.querySelector('.view-title')?.textContent === 'Home');

  // Forward should redo the same steps.
  await page.goForward();
  await page.waitForFunction(() => document.querySelector('.view-title')?.textContent === 'Vote');
});

flowTest('community', 'Aktuell: an open vote can be dismissed without hiding the next round', async (t) => {
  t.after(async () => page.setViewportSize({ width: 390, height: 844 }));
  await page.click('.nav-btn[data-view="votes"]');
  await page.waitForSelector('#votes-title');
  await page.fill('#votes-title', 'Freitagabend-Runde');
  await page.click('#votes-start');
  await page.waitForSelector('#votes-close'); // only rendered once ctx.refresh() shows the round as open

  // This shard deliberately has no earlier vote lifecycle that happens to
  // warm the shared app state. Rehydrate once from the server so the Home
  // assertion proves persisted state instead of relying on test order.
  const openedVote = await (await page.request.get(`${BASE_URL}/api/votes`)).json();
  assert.equal(openedVote.title, 'Freitagabend-Runde');
  await page.reload();
  await page.waitForSelector('#app:not([hidden])');

  await page.click('.nav-btn[data-view="home"]');
  await page.waitForSelector('section.grouped-page-section:has(h2:text-is("Aktuell"))');
  const currentVote = page.locator(`[data-current-item="vote:${openedVote.round}"]`);
  await currentVote.waitFor();
  const dismissButton = currentVote.locator('[data-dismiss-current]');
  assert.equal(await dismissButton.getAttribute('aria-label'), 'Freitagabend-Runde ausblenden');
  await page.waitForFunction(() => {
    const box = document.querySelector('[data-current-item] [data-dismiss-current]')?.getBoundingClientRect();
    return Boolean(box && box.width >= 44 && box.height >= 44);
  });
  const mobileDismissBox = await dismissButton.boundingBox();
  assert.ok(mobileDismissBox && mobileDismissBox.width >= 44 && mobileDismissBox.height >= 44);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), true);
  await page.setViewportSize({ width: 900, height: 844 });
  await currentVote.waitFor();
  assert.ok(await dismissButton.isVisible());
  await page.setViewportSize({ width: 390, height: 844 });
  await dismissButton.focus();
  await page.keyboard.press('Enter');
  await currentVote.waitFor({ state: 'detached' });

  // The personal dismissal survives a reload, just like removing an entry
  // from Mitteilungen, without closing the shared vote itself.
  await page.reload();
  await page.waitForSelector('#app:not([hidden])');
  await page.click('.nav-btn[data-view="home"]');
  assert.equal(await page.locator(`[data-current-item="vote:${openedVote.round}"]`).count(), 0);
  assert.equal((await (await page.request.get(`${BASE_URL}/api/votes`)).json()).open, true);

  // A later lifecycle gets a new stable id and must be visible again.
  await page.click('.nav-btn[data-view="votes"]');
  await page.click('#votes-close');
  await page.waitForSelector('#votes-start');
  await page.fill('#votes-title', 'Samstagabend-Runde');
  await page.click('#votes-start');
  await page.waitForSelector('#votes-close');
  const nextVote = await (await page.request.get(`${BASE_URL}/api/votes`)).json();
  assert.notEqual(nextVote.round, openedVote.round);
  await page.click('.nav-btn[data-view="home"]');
  await page.waitForSelector(`[data-current-item="vote:${nextVote.round}"]:has-text("Samstagabend-Runde")`);

  // Leave no open round behind for later tests.
  await page.click('.nav-btn[data-view="votes"]');
  await page.click('#votes-close');
  await page.waitForSelector('#votes-start');
});

flowTest('community', 'Kiosk: centers tournament content and shows only the latest feature push across the full width', async () => {
  const playerId = alice.id;

  // Send a Durchsage first, then trigger a different feature's push (opening
  // a food order) — the banner must show the *food order's* push afterward,
  // proving it reflects any notifyPlayers() call, not only Durchsagen.
  await page.request.post(`${BASE_URL}/api/broadcasts`, {
    data: { playerId, message: 'Kiosk-Test-Durchsage' },
  });
  const opponent = await page.request.post(`${BASE_URL}/api/players`, { data: { name: 'Kiosk Gegner' } });
  const opponentId = (await opponent.json()).id;
  const games = await (await page.request.get(`${BASE_URL}/api/games`)).json();
  await page.request.post(`${BASE_URL}/api/votes/start`, {
    data: { mode: 'points', title: 'Kiosk Vote', gameIds: [games[0].id, games[1].id] },
  });
  await page.request.post(`${BASE_URL}/api/votes/points`, {
    data: { playerId, entries: [{ gameId: games[0].id, points: 8 }, { gameId: games[1].id, points: 5 }] },
  });
  await page.request.post(`${BASE_URL}/api/votes/close`);
  await page.request.post(`${BASE_URL}/api/votes/start`, {
    data: { mode: 'single', title: 'Stichwahl: Kiosk Vote', gameIds: [games[0].id, games[1].id] },
  });
  await page.request.post(`${BASE_URL}/api/votes`, { data: { playerId, gameId: games[1].id } });
  await page.request.post(`${BASE_URL}/api/tournaments`, {
    data: {
      gameId: games[0].id,
      format: 'single_elimination',
      teams: [
        { name: 'Kiosk Team Blau', playerIds: [playerId] },
        { name: 'Kiosk Team Pink', playerIds: [opponentId] },
      ],
    },
  });
  const sendAt = Date.now() + 3600_000;
  await page.request.post(`${BASE_URL}/api/food-orders`, {
    data: { playerId, title: 'Kiosk-Test-Pizza', sendAt, link: 'https://kiosk-test.example/karte' },
  });

  await page.setViewportSize({ width: 1280, height: 720 });

  // A newly created LAN can sign in with its automatic account and the one
  // shared password. This creates no normal browser session; the page only
  // stores the resulting event-scoped kiosk token.
  const loginEventResponse = await page.request.post(`${BASE_URL}/api/events`, {
    data: {
      name: 'Kiosk Login E2E',
      startsAt: Date.now() + 7_200_000,
      endsAt: Date.now() + 10_800_000,
      eventType: 'lan',
    },
  });
  assert.equal(loginEventResponse.status(), 201, await loginEventResponse.text());
  const loginEvent = await loginEventResponse.json();
  await page.goto(`${BASE_URL}/kiosk.html?account=${encodeURIComponent(`kiosk-${loginEvent.id}`)}`);
  await page.waitForSelector('[data-kiosk-login]');
  assert.equal(await page.inputValue('[data-kiosk-login] input[name="username"]'), `kiosk-${loginEvent.id}`);
  await page.fill('[data-kiosk-login] input[name="password"]', E2E_KIOSK_TOKEN);
  await page.click('[data-kiosk-login] button[type="submit"]');
  await page.waitForSelector('.kiosk-header .brand-title');

  // Regression test for the review finding on ensureAccess(): this kiosk is
  // set up once with ?token=... and then left running unattended for the
  // whole LAN, so a transient failure (network blip, timeout, a 5xx from the
  // server restarting mid-deploy) while re-checking access on reload must not
  // wipe an otherwise valid, persisted token — only a genuine 401 means the
  // credential itself is bad.
  const loginKioskToken = await page.evaluate(() => localStorage.getItem('respawn_kiosk_token'));
  assert.ok(loginKioskToken, 'kiosk login should have stored a token');
  const transientFailureRoute = (route: import('playwright').Route) =>
    route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Kiosk-Serverfehler (Test)' }) });
  await page.route('**/api/live', transientFailureRoute);
  try {
    await page.reload();
    await page.waitForSelector('[data-kiosk-login]');
  } finally {
    await page.unroute('**/api/live', transientFailureRoute);
  }
  assert.equal(
    await page.evaluate(() => localStorage.getItem('respawn_kiosk_token')),
    loginKioskToken,
    'a transient failure while checking kiosk access must not clear the stored token',
  );

  const invalidTokenRoute = (route: import('playwright').Route) =>
    route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ error: 'Nicht angemeldet.' }) });
  await page.route('**/api/live', invalidTokenRoute);
  try {
    await page.reload();
    await page.waitForSelector('[data-kiosk-login]');
  } finally {
    await page.unroute('**/api/live', invalidTokenRoute);
  }
  assert.equal(
    await page.evaluate(() => localStorage.getItem('respawn_kiosk_token')),
    '',
    'a genuine 401 while checking kiosk access must clear the stale token',
  );

  await page.evaluate(() => localStorage.removeItem('respawn_kiosk_token'));
  assert.equal((await page.request.delete(`${BASE_URL}/api/events/${loginEvent.id}`)).status(), 200);

  await page.goto(`${BASE_URL}/kiosk.html?token=${E2E_KIOSK_TOKEN}`);
  assert.equal((await page.locator('.kiosk-header .brand-title').textContent())?.trim(), 'Respawn');
  assert.deepEqual(
    await page.locator('#kiosk-dashboard > .kiosk-card > div').evaluateAll((contents) => contents.map((content) => content.id)),
    ['kiosk-live', 'kiosk-leaderboard', 'kiosk-votes', 'kiosk-tournament'],
  );

  // The last-push banner shows the food order's own push (title "Neue
  // Sammelbestellung"), not the earlier Durchsage — with a timestamp, and
  // it stays up permanently rather than auto-hiding after a few minutes.
  await page.waitForSelector('#kiosk-broadcast:not([hidden]) >> text=Neue Sammelbestellung');
  await page.waitForSelector('#kiosk-broadcast >> text=Kiosk-Test-Pizza');
  await page.waitForSelector('.kiosk-broadcast-time');
  await page.waitForSelector('.notification-banner-body');
  await page.click('#kiosk-fullscreen');
  await page.waitForSelector('#kiosk-fullscreen[aria-pressed="true"]');
  await page.click('#kiosk-fullscreen');
  await page.waitForSelector('#kiosk-fullscreen[aria-pressed="false"]');

  await page.request.post(`${BASE_URL}/api/broadcasts`, {
    data: { playerId, message: 'Kiosk-Live-Durchsage alt' },
  });
  await page.waitForSelector('#kiosk-broadcast >> text=Kiosk-Live-Durchsage alt');
  await page.request.post(`${BASE_URL}/api/broadcasts`, {
    data: { playerId, message: 'Kiosk-Live-Durchsage neu' },
  });
  await page.waitForSelector('#kiosk-broadcast >> text=Kiosk-Live-Durchsage neu');
  assert.equal(await page.locator('#kiosk-broadcast >> text=Kiosk-Live-Durchsage alt').count(), 0);
  await page.waitForSelector('.kiosk-vote-overview >> text=Stichwahl läuft');
  await page.waitForSelector('.kiosk-vote-overview >> text=Zwischenstand');
  await page.waitForFunction(() => {
    const text = document.querySelector('.kiosk-vote-header .badge')?.textContent ?? '';
    return /^1 \/ \d+ abgestimmt$/.test(text.trim());
  });
  assert.equal(await page.locator('.kiosk-vote-results.is-compact').count(), 1);
  assert.equal(await page.locator('.kiosk-vote-results.is-compact').evaluate((element) => getComputedStyle(element).flexGrow), '0');
  assert.equal(await page.locator('.kiosk-vote-header').evaluate((element) => getComputedStyle(element).alignItems), 'center');
  await page.waitForSelector('.kiosk-vote-result.is-concealed >> text=1 Stimme');
  assert.equal(await page.locator(`.kiosk-vote-result:has-text("${games[1].name}")`).count(), 0);
  assert.notEqual(await page.locator('.kiosk-vote-result.is-concealed strong').evaluate((element) => getComputedStyle(element).filter), 'none');
  assert.equal(await page.getByText('Ergebnis erst nach dem Ende.', { exact: false }).count(), 0);
  await page.waitForSelector('.kiosk-match-grid .kiosk-match-card');
  await page.locator('#kiosk-broadcast').evaluate((element) => Promise.all(element.getAnimations().map((animation) => animation.finished)));
  assert.equal(await page.locator('#kiosk-alerts > *').count(), 1);
  const [alertBox, bannerBox] = await Promise.all([
    page.locator('#kiosk-alerts').boundingBox(),
    page.locator('#kiosk-broadcast').boundingBox(),
  ]);
  assert.ok(
    alertBox && bannerBox && Math.abs(alertBox.width - bannerBox.width) <= 1,
    `highlighted message should fill the alert row (${JSON.stringify({ alertBox, bannerBox })})`
  );
  const [tournamentBox, metaBox, bracketBodyBox, matchGridBox] = await Promise.all([
    page.locator('#kiosk-tournament').boundingBox(),
    page.locator('.kiosk-tournament-meta').boundingBox(),
    page.locator('.kiosk-tournament-bracket-body').boundingBox(),
    page.locator('.kiosk-match-grid').boundingBox(),
  ]);
  assert.ok(
    tournamentBox && metaBox && Math.abs(tournamentBox.y - metaBox.y) < 4,
    'tournament game and round should remain at the top of the card content area'
  );
  assert.ok(
    bracketBodyBox && matchGridBox && Math.abs(bracketBodyBox.y + bracketBodyBox.height / 2 - (matchGridBox.y + matchGridBox.height / 2)) < 4,
    'tournament bracket should be vertically centered below its metadata'
  );
  assert.equal(
    await page.evaluate(() => document.documentElement.scrollHeight <= window.innerHeight && document.body.scrollHeight <= window.innerHeight),
    true,
    'kiosk page must fit without page scrollbars'
  );
  assert.equal(
    await page.locator('.kiosk-card > div').evaluateAll((elements) => elements.every((element) => getComputedStyle(element).overflowY !== 'auto' && getComputedStyle(element).overflowY !== 'scroll')),
    true,
    'kiosk cards must not introduce internal scrollbars'
  );
  // Reconnect is a cache-recovery boundary: changes made while the display
  // was offline must appear immediately after Socket.IO reconnects, without
  // waiting for another domain event or the periodic safety refresh.
  await page.context().setOffline(true);
  await page.waitForTimeout(250);
  const offlineCancel = await fetch(`${BASE_URL}/api/votes/cancel`, {
    method: 'POST',
    headers: { cookie: adminCookie },
  });
  assert.equal(offlineCancel.status, 200, await offlineCancel.clone().text());
  const offlineStart = await fetch(`${BASE_URL}/api/votes/start`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: adminCookie },
    body: JSON.stringify({ mode: 'single', title: 'Kiosk nach Reconnect', gameIds: [games[0].id, games[1].id] }),
  });
  assert.equal(offlineStart.status, 201, await offlineStart.clone().text());
  await page.context().setOffline(false);
  await page.waitForSelector('.kiosk-vote-overview >> text=Kiosk nach Reconnect', { timeout: 10_000 });
  await page.request.post(`${BASE_URL}/api/votes/cancel`);
  const kioskGames = games.slice(0, 10) as Array<{ id: string }>;
  await page.request.post(`${BASE_URL}/api/votes/start`, {
    data: { mode: 'points', title: 'Großer Kiosk Vote', gameIds: kioskGames.map((game) => game.id) },
  });
  await page.request.post(`${BASE_URL}/api/votes/points`, {
    data: {
      playerId,
      entries: kioskGames.map((game, index) => ({ gameId: game.id, points: 10 - index })),
    },
  });
  await page.waitForSelector('.kiosk-vote-result:nth-child(10)');
  assert.equal(await page.locator('.kiosk-vote-result').count(), 10);
  assert.equal(await page.locator('.kiosk-vote-result.is-concealed').count(), 10);
  assert.ok(await page.locator('.kiosk-vote-result.is-concealed strong').evaluateAll((names) => {
    const lengths = names.map((name) => name.textContent?.length ?? 0);
    return new Set(lengths).size > 1;
  }), 'concealed game labels should use varying character counts');
  const voteBounds = await page.locator('#kiosk-votes').evaluate((voteContent) => {
    const contentBox = voteContent.getBoundingClientRect();
    const resultBoxes = Array.from(voteContent.querySelectorAll('.kiosk-vote-result')).map((result) => {
      const resultBox = result.getBoundingClientRect();
      return { top: resultBox.top, bottom: resultBox.bottom };
    });
    return {
      content: { top: contentBox.top, bottom: contentBox.bottom },
      results: resultBoxes,
      allVisible: resultBoxes.every((result) => result.top >= contentBox.top && result.bottom <= contentBox.bottom),
    };
  });
  assert.equal(voteBounds.allVisible, true, `ten live vote results should remain visible inside the kiosk card: ${JSON.stringify(voteBounds)}`);
  assert.ok(await page.locator('.kiosk-vote-results').evaluate((results) => {
    const resultBox = results.getBoundingClientRect();
    const parentBox = results.parentElement!.getBoundingClientRect();
    return Math.abs(resultBox.bottom - parentBox.bottom) < 2;
  }), 'live vote results should use the remaining card height');
  const compactVoteRowHeight = (await page.locator('.kiosk-vote-result').first().boundingBox())!.height;
  await page.setViewportSize({ width: 1280, height: 1080 });
  const tallVoteRowHeight = (await page.locator('.kiosk-vote-result').first().boundingBox())!.height;
  assert.ok(tallVoteRowHeight > compactVoteRowHeight * 2, 'tall kiosk cards should distribute their free height across vote rows');
  await page.request.post(`${BASE_URL}/api/votes/close`);
  await page.waitForSelector('.kiosk-vote-countdown >> text=Ergebnis in');
  assert.equal(await page.locator('.kiosk-vote-countdown .countdown-num-fill').textContent(), '5');
  assert.equal(await page.locator('.kiosk-vote-countdown .countdown-num-glow').textContent(), '5');
  assert.equal(await page.locator('.kiosk-vote-countdown .countdown-pop').count(), 1);
  assert.equal(await page.locator('.kiosk-vote-result').count(), 0);
  await page.waitForSelector('.kiosk-vote-final >> text=Ergebnis im Detail', { timeout: 7_000 });
  assert.equal(await page.locator('.kiosk-vote-final .kiosk-vote-result').count(), 10);
  assert.equal(await page.locator('.kiosk-vote-final .kiosk-vote-result.is-concealed').count(), 0);
  assert.equal(await page.locator('.kiosk-vote-final .kiosk-vote-result.is-leading').count(), 0);
  assert.deepEqual(await page.locator('.kiosk-vote-final-title').allTextContents(), ['Gewinner', 'Ergebnis im Detail']);
  assert.equal(
    await page.locator('.kiosk-vote-final-title').evaluateAll((titles) => titles.every((title) => getComputedStyle(title).fontSize === getComputedStyle(titles[0]).fontSize)),
    true,
  );
  await page.waitForSelector(`.kiosk-vote-winner:has-text("${games[0].name}")`);
  assert.equal(await page.locator('.kiosk-vote-final > :first-child').getAttribute('class'), 'kiosk-vote-winner-section');
  assert.ok((await page.locator('.kiosk-vote-winner').evaluate((winner) => getComputedStyle(winner).backgroundImage)).includes('linear-gradient'));
  await page.waitForSelector(`.kiosk-vote-final .kiosk-vote-result:has-text("${games[0].name}")`);
  assert.ok(await page.locator('.kiosk-vote-final').evaluate((result) => {
    const resultBox = result.getBoundingClientRect();
    const contentBox = result.parentElement!.getBoundingClientRect();
    return Math.abs(resultBox.top - contentBox.top) < 2;
  }));
  await page.setViewportSize({ width: 1280, height: 720 });
  assert.equal(await page.locator('#kiosk-votes').evaluate((voteContent) => {
    const contentBox = voteContent.getBoundingClientRect();
    return Array.from(voteContent.querySelectorAll('.kiosk-vote-winner, .kiosk-vote-result')).every((element) => {
      const box = element.getBoundingClientRect();
      return box.top >= contentBox.top && box.bottom <= contentBox.bottom;
    });
  }), true, 'winner and ten detailed results should remain visible at 720p');
  await page.request.post(`${BASE_URL}/api/votes/start`, {
    data: { mode: 'single', title: 'Kiosk Ergebnis ausblenden', gameIds: [games[0].id] },
  });
  await page.waitForSelector('.kiosk-vote-overview >> text=Stichwahl läuft');
  await page.request.post(`${BASE_URL}/api/votes/cancel`);
  await page.waitForSelector('#kiosk-votes >> text=Keine offene Abstimmung.');
  assert.equal(await page.locator('.kiosk-vote-overview').count(), 0);
  assert.ok(await page.locator('#kiosk-votes .kiosk-vote-state').evaluate((emptyState) => {
    const emptyBox = emptyState.getBoundingClientRect();
    const contentBox = emptyState.parentElement!.getBoundingClientRect();
    return Math.abs(emptyBox.y + emptyBox.height / 2 - (contentBox.y + contentBox.height / 2)) < 2;
  }));
  await page.setViewportSize({ width: 390, height: 844 });
});

flowTest('shell', 'Admin: the verified role exposes tools and can temporarily hide seeded test users', async () => {
  await page.goto(BASE_URL);
  await page.waitForSelector('#app:not([hidden])');

  // Enter admin mode explicitly; opening the Admin area alone must not enable it.
  await page.click('.nav-btn[data-view="more"]');
  await page.click('[data-navigate="admin"]');
  await ensureAdminMode();

  await page.waitForSelector('#admin-readiness-refresh:not([disabled])');
  assert.equal(await page.locator('#admin-readiness-status').getAttribute('role'), 'status');
  assert.equal(await page.locator('#admin-readiness-status').getAttribute('aria-live'), 'polite');
  await page.click('[data-admin-readiness-details] > summary');
  await page.click('#admin-readiness-refresh');
  await page.waitForSelector('#admin-readiness-refresh:not([disabled])');
  assert.equal(
    await page.locator('[data-admin-readiness-details]').getAttribute('open'),
    '',
    'readiness details should stay open across a successful refresh',
  );
  await page.click('[data-admin-readiness-details] > summary');

  let failNextReadiness = true;
  await page.route('**/api/admin/readiness', async (route) => {
    if (!failNextReadiness) {
      await route.continue();
      return;
    }
    failNextReadiness = false;
    await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Temporär nicht verfügbar.' }) });
  });
  await page.focus('#admin-readiness-refresh');
  await page.keyboard.press('Enter');
  await page.waitForSelector('#admin-readiness-retry');
  assert.equal(await page.evaluate(() => document.activeElement?.id), 'admin-readiness-refresh');

  await page.focus('#admin-readiness-retry');
  await page.keyboard.press('Enter');
  await page.waitForSelector('#admin-readiness-refresh:not([disabled])');
  assert.equal(await page.evaluate(() => document.activeElement?.id), 'admin-readiness-refresh');
  await page.unroute('**/api/admin/readiness');

  // Seed test users from the role-protected panel.
  await page.click('.nav-btn[data-view="more"]');
  await page.click('[data-navigate="admin"]');
  await ensureAdminMode();
  const reauthenticated = await page.request.post(`${BASE_URL}/api/auth/reauth`, {
    data: { password: alice.password },
  });
  assert.equal(reauthenticated.status(), 204, await reauthenticated.text());
  await page.fill('#admin-count', '4');
  const seedResponse = page.waitForResponse(
    (response) => response.url().includes('/test-users') && response.request().method() === 'POST'
  );
  await page.click('#admin-bulk');
  const seeded = await seedResponse;
  const seededText = await seeded.text();
  assert.ok(seeded.ok(), `test-user seed failed (${seeded.status()}): ${seededText}`);
  const seededBody = JSON.parse(seededText) as { created: Array<{ id: string; name: string }> };
  const pausedTestPlayer = seededBody.created[2];
  const testSessionInviteResponse = await page.request.post(`${BASE_URL}/api/auth/invites`, {
    data: { purpose: 'test_login', playerId: pausedTestPlayer.id },
  });
  assert.equal(testSessionInviteResponse.status(), 201, await testSessionInviteResponse.text());
  const testSessionInvite = await testSessionInviteResponse.json() as { code: string };
  const testSessionResponse = await fetch(`${BASE_URL}/api/auth/test-session`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code: testSessionInvite.code }),
  });
  assert.equal(testSessionResponse.status, 200, await testSessionResponse.clone().text());
  const testSessionCookie = testSessionResponse.headers.get('set-cookie')?.split(';')[0];
  assert.ok(testSessionCookie, 'test session must set a cookie');
  const pauseResponse = await fetch(`${BASE_URL}/api/live/${pausedTestPlayer.id}/note`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: testSessionCookie },
    body: JSON.stringify({ note: 'Pause / Essen' }),
  });
  assert.equal(pauseResponse.status, 200, await pauseResponse.text());
  await page.waitForFunction((minimum) => {
    const badge = document.querySelector('[aria-label$="Test-Spieler vorhanden"]');
    const match = badge?.getAttribute('aria-label')?.match(/(\d+)\s+Test-Spieler vorhanden/);
    return match !== null && match !== undefined && Number(match[1]) >= minimum;
  }, seededBody.created.length);
  await page.waitForSelector('.badge-paused >> text=Test');

  const regularEventList = await (await page.request.get(`${BASE_URL}/api/events`)).json() as {
    managedEvents: Array<{ name: string; isTest: boolean }>;
  };
  assert.equal(regularEventList.managedEvents.filter((event) => event.isTest).length, 0);
  const adminEventList = await (
    await page.request.get(`${BASE_URL}/api/events`, { headers: { 'x-admin-mode': '1' } })
  ).json() as { managedEvents: Array<{ name: string; isTest: boolean }> };
  assert.deepEqual(
    adminEventList.managedEvents.filter((event) => event.isTest).map((event) => event.name).sort(),
    ['Allgemeines Testevent', 'Test-LAN'],
  );

  assert.equal(await page.locator('#admin-seed-hall').count(), 0);
  const hallSeeded = await page.request.post(`${BASE_URL}/api/admin/test-data/hall-of-fame`);
  assert.ok(hallSeeded.ok(), `hall-of-fame seed failed (${hallSeeded.status()}): ${await hallSeeded.text()}`);
  const hallData = await page.request.get(`${BASE_URL}/api/hall-of-fame`, { headers: { 'x-admin-mode': '1' } });
  const hallBody = await hallData.json() as { events: Array<{ eventName: string; overallStandings: unknown[]; tournamentChampions: unknown[] }> };
  const testLans = hallBody.events.filter((event) => event.eventName.startsWith('Respawn Test-LAN'));
  assert.equal(testLans.length, 12);
  assert.ok(testLans.every((event) => event.overallStandings.length >= 4 && event.tournamentChampions.length === 3));
  await openAuswertungTab('hallOfFame');
  await page.waitForSelector('#hall-event-select-search');
  assert.equal(await page.getByText('LAN auswählen', { exact: true }).count(), 0);
  assert.equal(await page.locator('.hall-of-fame-event-section').count(), 2);
  assert.equal(await page.locator('.hall-of-fame-event-section.is-tournaments .hall-of-fame-tournament-row').count(), 3);

  // A lifecycle change for an unrelated event used to hard-invalidate the
  // Hall-of-Fame cache. The long result list collapsed to "Lädt…", clamped
  // the shared scroll container to the top and rebuilt the focused picker.
  // Cover the invariant at laptop and phone widths.
  for (const viewport of [{ width: 1280, height: 720 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    await page.waitForFunction(
      (mode) => document.documentElement.dataset.layoutMode === mode,
      viewport.width >= 1280 ? 'desktop' : 'laptop',
    );
    await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    const viewContainer = page.locator('#view-container');
    const before = await viewContainer.evaluate((element) => {
      const picker = document.querySelector('#hall-event-select-search') as HTMLInputElement;
      picker.focus({ preventScroll: true });
      element.scrollTop = Math.min(1200, element.scrollHeight - element.clientHeight);
      const probe = { mutations: 0, loadingFrames: 0 };
      (window as any).__renderStabilityProbe?.observer?.disconnect();
      const observer = new MutationObserver(() => {
        probe.mutations += 1;
        if (element.textContent?.includes('Lädt…')) probe.loadingFrames += 1;
      });
      observer.observe(element, { childList: true, subtree: true });
      (window as any).__renderStabilityProbe = { probe, observer };
      return element.scrollTop;
    });
    assert.ok(before > 100, `Hall of Fame must scroll at ${viewport.width}x${viewport.height}`);

    const suffix = `${viewport.width}-${Date.now()}`;
    const createdResponse = await page.request.post(`${BASE_URL}/api/events`, {
      data: {
        name: `Render-Stabilität ${suffix}`,
        startsAt: Date.now() + 30 * 24 * 60 * 60 * 1000,
        endsAt: Date.now() + 31 * 24 * 60 * 60 * 1000,
      },
    });
    const createdText = await createdResponse.text();
    assert.equal(createdResponse.status(), 201, createdText);
    const created = JSON.parse(createdText) as { id: string };
    await page.waitForFunction(() => (window as any).__renderStabilityProbe?.probe.mutations > 0);

    const after = await viewContainer.evaluate((element) => ({
      scrollTop: element.scrollTop,
      activeId: (document.activeElement as HTMLElement | null)?.id ?? null,
      loadingFrames: (window as any).__renderStabilityProbe.probe.loadingFrames,
    }));
    assert.ok(Math.abs(after.scrollTop - before) < 4, `scroll changed from ${before} to ${after.scrollTop}`);
    assert.equal(after.activeId, 'hall-event-select-search');
    assert.equal(after.loadingFrames, 0);

    const mutationsBeforeCancel = await page.evaluate(() => (window as any).__renderStabilityProbe.probe.mutations);
    const cancelled = await page.request.delete(`${BASE_URL}/api/events/${created.id}`);
    assert.ok(cancelled.ok(), await cancelled.text());
    await page.waitForFunction(
      (previous) => (window as any).__renderStabilityProbe?.probe.mutations > previous,
      mutationsBeforeCancel,
    );
  }
  await page.setViewportSize({ width: 1280, height: 720 });

  // The shared seating plan exposes the real live state compactly after the
  // gamer name: seeded players cover playing + paused while the regular
  // roster also supplies an offline seat. The title/ARIA label keeps the
  // three colors understandable without relying on color alone.
  await page.click('.desktop-nav-btn[data-view="home"]');
  await page.waitForSelector('.live-seating .seating-status-indicator.is-playing[aria-label="Status: Spielt"]');
  await page.waitForSelector(`.live-seating [data-player-id="${pausedTestPlayer.id}"] .seating-status-indicator.is-paused[aria-label="Status: Pause"]`);
  await page.waitForSelector('.live-seating .seating-status-indicator.is-offline[aria-label="Status: Offline"]');
  await page.click('.desktop-nav-btn[data-view="admin"]');
  await ensureAdminMode();
  await page.click('[data-navigate="seating"]');
  await page.waitForSelector(`.seating-plan.is-editable [data-player-id="${pausedTestPlayer.id}"] .seating-status-indicator.is-paused`);

  // Visible on Home's roster board while in admin mode...
  await page.click('.desktop-nav-btn[data-view="home"]');
  await page.waitForSelector('button[data-player]:has-text("Test Alex")');

  // ...gone everywhere once admin mode is left via the banner.
  await page.click('#admin-banner-leave');
  await page.waitForSelector('#admin-banner', { state: 'hidden' });
  await page.waitForFunction(() => !document.body.textContent?.includes('Test Alex'));

  // Reload leaves admin mode inactive until it is explicitly activated again.
  await page.reload();
  await page.waitForSelector('#app:not([hidden])');
  await page.click('.desktop-nav-btn[data-view="admin"]');
  await ensureAdminMode();
  await page.click('#admin-cleanup');
  // confirmDialog is an in-app modal (not a native browser dialog).
  await page.click('[data-confirm]');
  await page.waitForSelector('[aria-label="0 Test-Spieler vorhanden"]');
  const cleanedHall = await (await page.request.get(`${BASE_URL}/api/hall-of-fame`)).json() as { events: Array<{ eventName: string }> };
  assert.equal(cleanedHall.events.filter((event) => event.eventName.startsWith('Respawn Test-LAN')).length, 0);
});
