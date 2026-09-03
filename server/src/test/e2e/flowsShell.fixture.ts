// Browser E2E test, shell shard: shell, profile, games, tournament and admin.
// One owner process drives the real built server + real Chromium; the shared
// server session, browser context and page live in ./flowsShared.fixture.
// Sibling tests here intentionally share that state and run in order.

import assert from 'node:assert/strict';
import { addSessionCookie, switchSessionCookie, finishE2EOnboarding } from './authHelpers';
import { trackE2EContext } from './e2eDiagnostics';
import {
  flowTest,
  registerFlowFixture,
  BASE_URL,
  page,
  browser,
  adminCookie,
  alice,
  bob,
  accountsByName,
  openAuswertungTab,
  ensureAdminMode,
  openOrgaTab,
  openProfile,
} from './flowsShared.fixture';

registerFlowFixture('shell');

flowTest('fresh device uses the personal login and reaches the app with its verified account', async (t) => {
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

flowTest('wide desktop adapts the shared shell and pilot views without changing mobile navigation', async (t) => {
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
    alignItems: getComputedStyle(layout).alignItems,
  }));
  assert.deepEqual(homeColumns, { display: 'grid', columns: 2, alignItems: 'stretch' });
  const homeSectionFlow = await page.evaluate(() => {
    const rect = (selector: string) => document.querySelector(selector)?.getBoundingClientRect();
    const todos = rect('[aria-labelledby="home-todos-title"]');
    const current = rect('[aria-labelledby="home-current-title"]');
    const live = rect('[aria-labelledby="home-live-title"]');
    const leaderboard = rect('[aria-labelledby="home-leaderboard-title"]');
    const seating = rect('[aria-labelledby="home-seating-title"]');
    const priority = rect('.home-priority-grid');
    if (!todos || !live) return null;
    return {
      todosTop: Math.round(todos.top),
      todosBottom: Math.round(todos.bottom),
      currentTop: current ? Math.round(current.top) : null,
      currentBottom: current ? Math.round(current.bottom) : null,
      liveTop: Math.round(live.top),
      priorityBottom: priority ? Math.round(priority.bottom) : null,
      seatingGap: seating ? Math.round(seating.top - live.bottom) : null,
      leaderboardGap: leaderboard && seating ? Math.round(leaderboard.top - seating.bottom) : null,
    };
  });
  assert.ok(homeSectionFlow);
  assert.ok(homeSectionFlow.priorityBottom !== null);
  if (homeSectionFlow.currentTop !== null && homeSectionFlow.currentBottom !== null) {
    assert.equal(homeSectionFlow.currentTop, homeSectionFlow.todosTop);
    assert.equal(homeSectionFlow.currentBottom, homeSectionFlow.todosBottom);
  }
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
  // getComputedStyle reports `gridTemplateColumns: none` — a single token —
  // until the admin view has actually been laid out, so a one-shot read here
  // can see 1 instead of the real column count and did so under parallel load.
  // Wait for a resolved template, then assert its width, so a genuinely wrong
  // column count still fails with a readable difference instead of a timeout.
  const adminPlayerColumns = await page.waitForFunction(() => {
    const grid = document.querySelector('.admin-player-list');
    const columns = grid ? getComputedStyle(grid).gridTemplateColumns : '';
    return columns && columns !== 'none' ? columns.split(' ').length : null;
  });
  assert.equal(await adminPlayerColumns.jsonValue(), 3);

  await page.click('.desktop-nav-btn[data-view="arcade"]');
  await page.waitForSelector('#arcade-games-title');
  assert.equal(await page.locator('.desktop-nav-btn[aria-current="page"]').getAttribute('data-view'), 'arcade');
  await page.click('[data-game="quiz"]');
  await page.waitForSelector('#arcade-active-game-title');
  const arcadeColumnsHandle = await page.waitForFunction(() => {
    const active = document.querySelector('[aria-labelledby="arcade-active-game-title"]')?.getBoundingClientRect();
    const picker = document.querySelector('.arcade-game-picker')?.getBoundingClientRect();
    const tiles = document.querySelector('.arcade-tiles');
    if (!active || !picker || !tiles) return null;
    return {
      activeLeft: Math.round(active.left),
      activeTop: Math.round(active.top),
      pickerLeft: Math.round(picker.left),
      pickerBottom: Math.round(picker.bottom),
      tileColumns: getComputedStyle(tiles).gridTemplateColumns.split(' ').length,
    };
  });
  const arcadeColumns = await arcadeColumnsHandle.jsonValue();
  assert.ok(arcadeColumns);
  assert.ok(arcadeColumns.activeLeft !== null && arcadeColumns.pickerLeft !== null);
  assert.equal(arcadeColumns.pickerLeft, arcadeColumns.activeLeft);
  assert.ok(arcadeColumns.pickerBottom < arcadeColumns.activeTop);
  assert.equal(arcadeColumns.tileColumns, 3);

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
  await page.waitForSelector('.arcade-game-picker');

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
  await page.waitForSelector('.arcade-game-picker');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForFunction(() => document.documentElement.dataset.layoutMode === 'laptop');
  const mobileShell = await page.evaluate(() => {
    const nav = document.querySelector('.bottom-nav')?.getBoundingClientRect();
    const navInner = document.querySelector('.bottom-nav-inner');
    const desktopNav = document.querySelector('.desktop-nav');
    const arcadeLayout = document.querySelector('.grouped-page-sections');
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

flowTest('Umfragen: works for the permanently open "Allgemein" base event without forcing an event switch', async () => {
  await openOrgaTab('eventPolls');
  await page.waitForSelector('#new-event-poll');
  assert.equal(await page.locator('#choose-event-context').count(), 0);
  assert.equal((await page.locator('.empty-state-title').textContent())?.trim(), 'Noch keine Umfrage');
});

flowTest('untabbed areas align compact cards while tabbed areas reserve a second row', async (t) => {
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

flowTest('Orga Events tab and Profil use grouped help while admin tools stay out of regular Orga', async (t) => {
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

  // Pin the start instead of leaning on the form's default of "now". The end
  // field's calendar opens on the month of its minimum (the start plus the
  // range gap) and renders day buttons only for that month's own days --
  // leading cells carry no button. With a start on the first of a month, no
  // rendered day precedes the minimum and the disabled-day assertions below
  // have nothing to match, so the ambient default made them fail on every 1st.
  await page.fill('#event-starts-date', '15062027');
  await page.fill('#event-starts-time', '1200');
  // One day before the pinned start: rejected by the range rule regardless of
  // today's date. Setting the start first matters, because wireDateTimeRange
  // pulls an earlier end forward whenever the start moves past it.
  const invalidEndLabel = '14.06.2027';
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

flowTest('the authenticated admin role owns the seating editor and backup tools', async (t) => {
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
  await switchSessionCookie(page, BASE_URL, adminCookie);
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
  let feedbackId = '';
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
    feedbackId = await memberPage.evaluate(async () => {
      const response = await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: 'E2E Feedback zum Abhaken',
          view: 'home',
          device: 'mobile',
          sentiment: 'problem',
        }),
      });
      if (!response.ok) throw new Error(`Feedback setup failed with ${response.status}`);
      return (await response.json()).id;
    });
  } finally {
    await memberContext.close();
  }
  await page.click('#admin-feedback-refresh');
  const feedbackAction = page.locator(`[data-feedback-resolution="${feedbackId}"]`);
  await feedbackAction.waitFor();
  assert.equal(await feedbackAction.evaluate((element) => element.tagName), 'BUTTON');
  assert.equal(await feedbackAction.textContent(), 'Erledigt');
  assert.equal(
    await feedbackAction.evaluate(
      (element) =>
        element.classList.contains('btn') &&
        element.classList.contains('btn-sm') &&
        element.classList.contains('btn-primary'),
    ),
    true,
  );
  assert.equal(await page.locator(`[data-admin-feedback-completed] [data-feedback-entry="${feedbackId}"]`).count(), 0);
  await feedbackAction.click();
  await page.waitForFunction(
    (id) => {
      const section = document.querySelector('[data-admin-feedback-completed]');
      return Boolean(section?.querySelector(`[data-feedback-entry="${id}"]`));
    },
    feedbackId,
  );
  const completedFeedback = page.locator('[data-admin-feedback-completed]');
  assert.equal(await completedFeedback.evaluate((section) => (section as HTMLDetailsElement).open), false);
  await completedFeedback.locator('summary').click();
  await page.click('#admin-feedback-refresh');
  await page.waitForFunction(() => {
    const section = document.querySelector('[data-admin-feedback-completed]') as HTMLDetailsElement | null;
    return Boolean(section?.open && section.querySelector('[data-feedback-resolution]'));
  });
  const reopenFeedbackAction = page.locator(`[data-feedback-resolution="${feedbackId}"]`);
  assert.equal(await reopenFeedbackAction.textContent(), 'Wieder öffnen');
  await reopenFeedbackAction.click();
  await page.waitForFunction(
    (id) => {
      const entry = document.querySelector(`[data-feedback-entry="${id}"]`);
      return Boolean(entry && !entry.closest('[data-admin-feedback-completed]'));
    },
    feedbackId,
  );

  // Desktop only hides back actions that return to the direct "Mehr" hub.
  // Admin subpages keep their compact back button before the title instead
  // of stretching it across the first grid column.
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.waitForFunction(() => document.documentElement.dataset.layoutMode === 'desktop');
  const feedbackHeaderLayout = await page.locator('.more-subpage-title-row').evaluate((row) => {
    const button = row.querySelector('[data-navigate="admin"]')?.getBoundingClientRect();
    const title = row.querySelector('h1')?.getBoundingClientRect();
    const rowRect = row.getBoundingClientRect();
    if (!button || !title) throw new Error('Feedback header controls are missing');
    return {
      buttonWidth: Math.round(button.width),
      rowWidth: Math.round(rowRect.width),
      buttonRight: Math.round(button.right),
      titleLeft: Math.round(title.left),
      centerDifference: Math.round(Math.abs(button.top + button.height / 2 - (title.top + title.height / 2))),
    };
  });
  assert.ok(feedbackHeaderLayout.buttonWidth < feedbackHeaderLayout.rowWidth / 2, 'the back button must stay compact');
  assert.ok(feedbackHeaderLayout.buttonRight < feedbackHeaderLayout.titleLeft, 'the title must follow the back button');
  assert.ok(feedbackHeaderLayout.centerDifference <= 1, 'the back button and title must stay vertically aligned');
  await page.setViewportSize({ width: 390, height: 844 });
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
  let rejectFirstKioskPasswordRequest = true;
  const kioskPasswordUrl = '**/api/admin/kiosk-password';
  await page.route(kioskPasswordUrl, async (route) => {
    if (rejectFirstKioskPasswordRequest) {
      rejectFirstKioskPasswordRequest = false;
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'Vorübergehend nicht verfügbar' }),
      });
      return;
    }
    await route.continue();
  });
  await page.click('[data-navigate="kiosk"]');
  await page.waitForSelector('[data-retry-kiosk-password]');
  await page.click('[data-retry-kiosk-password]');
  await page.waitForSelector('[data-copy-kiosk-password]');
  await page.unroute(kioskPasswordUrl);
  await assertCompactAdminHeader('TV-Kiosk');
  assert.equal(await page.getByRole('heading', { name: 'TV-Kiosk' }).count(), 1);
  assert.equal(await page.locator('.grouped-page-sections > .grouped-page-section').count(), 1);
  assert.equal(await page.locator('a[href="/kiosk.html"]').count(), 0);
  assert.equal(await page.locator('.kiosk-password-credential').count(), 1);
  assert.deepEqual(
    await page.locator('a[href^="/kiosk.html?account="]').allTextContents(),
    await page.locator('a[href^="/kiosk.html?account="]').evaluateAll((links) => links.map(() => 'Kiosk öffnen')),
  );
  assert.equal(
    await page.locator('a[href^="/kiosk.html?account="]:not(.btn-primary):not(.kiosk-open-link)').count(),
    0,
  );
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

flowTest('global search filters areas, supports keyboard navigation and restores focus', async (t) => {
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

flowTest('Mein Profil: rename with a uniqueness conflict, then succeed; Meine Statistiken reachable', async () => {
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

flowTest('Sitzplan: the real name set in Mein Profil shows in small everywhere the seating plan renders', async () => {
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

flowTest('Spiele: suggest a game (duplicate name rejected), promote it, then rate Bock/Skill inline', async () => {
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

flowTest('Spiele: a skill suggestion chip appears after enough recorded results and can be applied', async () => {
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

flowTest('Turnier: create a K.O. bracket from proposed teams and play it to a champion', async () => {
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

flowTest('Admin: the verified role exposes tools and can temporarily hide seeded test users', async () => {
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
