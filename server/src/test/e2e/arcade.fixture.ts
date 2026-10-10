// Browser E2E tests for the Arcade area: spectating running matches (list
// lifecycle, auto-redirect on match end, stale history entries), the
// fitted playfield geometry and fullscreen, and rapid-fire robustness (lobby-create
// bursts, ready-toggle spam). Complements the broader click-through suite in
// flows.e2e.test.ts — this file owns the Arcade-specific regressions from the
// spectator, fit and fullscreen work.

import { test, before, after, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import type { ChildProcess } from 'child_process';
import { chromium, Browser, BrowserContext, Page } from 'playwright';
import { laidOutRect } from './canvasHelpers';
import {
  E2E_KIOSK_TOKEN,
  addSessionCookie,
  authenticatedServerEnv,
  createE2EAccount,
  loginE2EAdmin,
  promoteE2EAdmin,
  waitForPlayerData,
} from './authHelpers';
import { ARCADE_HUB, openArcadeLobby } from './arcadeHelpers';
import { activateAdminMode } from './navHelpers';
import { runWithE2EDiagnostics, trackE2EContext, deferE2EContextClose } from './e2eDiagnostics';
import { startE2EServer, type E2EServer } from './e2eServer';
import { assertControlHeights, assertNoOverflow } from './visualHelpers';

let BASE_URL: string;

let serverProcess: ChildProcess;
let e2eServer: E2EServer;
let browser: Browser;
let adminCookie: string;

type ArcadeShard = 'navigation' | 'multiplayer' | 'scribble' | 'snake-arena';

const arcadeShard = process.env.E2E_ARCADE_SHARD as ArcadeShard | undefined;
if (!arcadeShard || !['navigation', 'multiplayer', 'scribble', 'snake-arena'].includes(arcadeShard)) {
  throw new Error(`Unbekannter Arcade-Shard: ${arcadeShard ?? '(fehlt)'}`);
}

function arcadeTest(
  shard: ArcadeShard,
  name: string,
  fn: (context: TestContext) => void | Promise<void>,
): void {
  if (arcadeShard === shard) {
    test(name, (context) =>
      runWithE2EDiagnostics(
        { testName: name, browser, server: e2eServer },
        () => fn(context),
      ),
    );
  }
}
const playerCookies = new Map<string, string>();

interface Actor {
  context: BrowserContext;
  page: Page;
}

async function createPlayer(name: string): Promise<{ id: string; name: string }> {
  const account = await createE2EAccount(BASE_URL, adminCookie, name);
  playerCookies.set(account.id, account.cookie);
  return account;
}

// Scribble is visible to admins in Admin mode only; its players and
// spectators are promoted before their page opens with adminMode: true.
async function createAdminPlayer(name: string): Promise<{ id: string; name: string }> {
  const account = await createPlayer(name);
  await promoteE2EAdmin(BASE_URL, adminCookie, account.id);
  return account;
}

// Opens a fresh context+page with the player's personal session.
async function openArcadeAs(
  playerId: string,
  { viewport = { width: 390, height: 844 }, adminMode = false } = {}
): Promise<Actor> {
  const context = await browser.newContext({ viewport });
  await trackE2EContext(context, `${playerId}-arcade`);
  const cookie = playerCookies.get(playerId);
  assert.ok(cookie, `missing personal session for ${playerId}`);
  await addSessionCookie(context, BASE_URL, cookie);
  const page = await context.newPage();
  page.on('pageerror', (err) => console.error('[pageerror]', err.message));
  await page.goto(BASE_URL);
  await page.waitForFunction(() =>
    Array.from(document.querySelectorAll<HTMLElement>(
      '.desktop-nav-btn[data-view="arcade"], .nav-btn[data-view="more"]',
    )).some((button) => button.getClientRects().length > 0));
  if (adminMode) await activateAdminMode(page);
  await navigateToArcade(page);
  return { context, page };
}

async function openHomeAs(playerId: string): Promise<Actor> {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await trackE2EContext(context, `${playerId}-home`);
  const cookie = playerCookies.get(playerId);
  assert.ok(cookie, `missing personal session for ${playerId}`);
  await addSessionCookie(context, BASE_URL, cookie);
  const page = await context.newPage();
  page.on('pageerror', (err) => console.error('[pageerror]', err.message));
  await page.goto(BASE_URL);
  await page.waitForSelector('.nav-btn[data-view="more"]');
  await page.waitForFunction(() =>
    (document.getElementById('view-container') as HTMLElement | null)?.dataset.view === 'home');
  return { context, page };
}

async function clickArcadeDestination(page: Page): Promise<void> {
  const desktopArcade = page.locator('.desktop-nav-btn[data-view="arcade"]:visible');
  if (await desktopArcade.count()) {
    await desktopArcade.click();
    return;
  }
  await page.click('.nav-btn[data-view="more"]:visible');
  await page.click('[data-navigate="arcade"]');
}

// No retry loop any more. The three attempts here used to paper over a real
// defect: a players:changed refresh rebuilt the navigation and detached the
// button between resolving it and clicking it — which drops a real user's tap
// the same way. app.js now reconciles the rail in place and publishes when the
// roster has landed, so waiting for that state is enough and a failure here is
// a genuine one again.
async function navigateToArcade(page: Page): Promise<void> {
  await waitForPlayerData(page);
  await clickArcadeDestination(page);
  await page.waitForSelector(ARCADE_HUB);
}

function activeView(page: Page): Promise<string | undefined> {
  return page.evaluate(() => (document.getElementById('view-container') as HTMLElement | null)?.dataset.view);
}

async function startQuizMatch(host: Page, guest: Page): Promise<void> {
  await openArcadeLobby(host, 'quiz');
  await host.waitForSelector('[data-close-lobby]');
  await guest.waitForSelector('[data-join-lobby]');
  await guest.click('[data-join-lobby]');
  await guest.waitForSelector('[data-quiz-ready][data-ready="1"]');
  await guest.click('[data-quiz-ready][data-ready="1"]');
  await host.waitForSelector('.arcade-lobby-member-role:has-text("Bereit")');
  await host.click('#quiz-start-lobby');
  await host.waitForSelector('#quiz-answer-form');
}

// Ends the running quiz match from the host's match view and returns the
// host to the Arcade launcher, so the next test starts from a clean slate.
async function finishQuizMatch(host: Page): Promise<void> {
  await host.click('#quiz-finish');
  await host.click('[data-confirm]');
  await host.waitForSelector('#quiz-back');
  await host.click('#quiz-back');
  await host.waitForSelector(ARCADE_HUB);
}

async function startScribbleMatch(host: Page, guests: Page[], rounds: 1 | 2 | 3): Promise<void> {
  await openArcadeLobby(host, 'scribble');
  await host.waitForSelector('[data-scribble-close]');
  for (const guest of guests) {
    await guest.waitForSelector('[data-scribble-join]');
    await guest.click('[data-scribble-join]');
  }
  await host.waitForFunction(
    (expectedPlayers) => document.querySelectorAll('.arcade-lobby-entry .arcade-lobby-member-row:not(.arcade-lobby-free-row)').length === expectedPlayers,
    guests.length + 1,
  );
  await host.waitForSelector('#scribble-start:not([disabled])');
  await host.check(`input[name="scribble-rounds"][value="${rounds}"]`);
  await host.click('#scribble-start');
}

async function finishScribbleMatch(host: Page): Promise<void> {
  await host.click('#scribble-finish');
  await host.click('[data-confirm]');
  await host.waitForSelector('#scribble-result-title');
}

const countPaintedPixels = (page: Page, selector: string) =>
  page.evaluate((sel) => {
    const canvas = document.querySelector(sel) as HTMLCanvasElement | null;
    if (!canvas) return -1;
    const data = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
    let painted = 0;
    for (let i = 3; i < data.length; i += 4) if (data[i] !== 0) painted += 1;
    return painted;
  }, selector);

before(async () => {
  const server = await startE2EServer(authenticatedServerEnv());
  e2eServer = server;
  serverProcess = server.process;
  BASE_URL = server.baseUrl;
  adminCookie = await loginE2EAdmin(BASE_URL);
  browser = await chromium.launch();
});

after(async () => {
  await browser?.close();
  serverProcess?.kill();
});

arcadeTest('navigation', 'Arcade JavaScript and CSS stay lazy, are cached, and support a direct hash route', async () => {
  const player = await createPlayer('Arcade Lazy Assets');
  const actor = await openHomeAs(player.id);
  const requests: string[] = [];
  actor.page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.pathname.startsWith('/js/arcade/') || url.pathname === '/css/arcade.css') {
      requests.push(`${url.pathname}${url.search}`);
    }
  });

  try {
    const bootAssets = await actor.page.evaluate(() => performance.getEntriesByType('resource')
      .map((entry) => new URL(entry.name).pathname)
      .filter((pathname) => pathname.startsWith('/js/arcade/') || pathname === '/css/arcade.css'));
    assert.equal(await actor.page.locator('#arcade-stylesheet').count(), 0);
    assert.deepEqual(bootAssets, []);
    assert.equal(requests.length, 0);

    await navigateToArcade(actor.page);
    await actor.page.waitForSelector('#arcade-stylesheet[data-loaded="true"]', { state: 'attached' });
    const firstLoad = [...requests];
    assert.equal(firstLoad.filter((request) => request.startsWith('/css/arcade.css?')).length, 1);
    assert.ok(firstLoad.some((request) => request === '/js/arcade/views/arcade.js'));
    assert.equal(new Set(firstLoad).size, firstLoad.length, 'each Arcade asset should load once');

    // The hub is one page: opening and closing the create dialog keeps the
    // route and loads nothing new.
    assert.equal(new URL(actor.page.url()).hash, '#arcade');
    await actor.page.click(ARCADE_HUB);
    await actor.page.waitForSelector('#arcade-create-form');
    await actor.page.keyboard.press('Escape');
    await actor.page.waitForSelector('#arcade-create-form', { state: 'detached' });
    assert.equal(new URL(actor.page.url()).hash, '#arcade');
    assert.equal(new Set(requests).size, requests.length, 'the create dialog must not reload Arcade assets');

    await actor.page.click('.nav-btn[data-view="home"]');
    await actor.page.waitForFunction(() => !document.getElementById('arcade-stylesheet'));
    await navigateToArcade(actor.page);
    await actor.page.waitForSelector('#arcade-stylesheet[data-loaded="true"]', { state: 'attached' });
    const secondLoadJavaScript = requests.filter((request) => request.startsWith('/js/arcade/'));
    assert.deepEqual(
      secondLoadJavaScript,
      firstLoad.filter((request) => request.startsWith('/js/arcade/')),
      'native module caching must prevent a second Arcade JavaScript fetch',
    );

    const direct = await actor.context.newPage();
    await direct.goto(`${BASE_URL}/#arcade`);
    await direct.waitForSelector(ARCADE_HUB);
    await direct.waitForSelector('#arcade-stylesheet[data-loaded="true"]', { state: 'attached' });
    assert.equal(await activeView(direct), 'arcade');
    await direct.reload();
    await direct.waitForSelector(ARCADE_HUB);
    assert.equal(await activeView(direct), 'arcade');
    await direct.close();
  } finally {
    await actor.context.close();
  }
});

arcadeTest('navigation', 'a direct or expired-match link to a game room returns to the Arcade hub instead of a dead end', async () => {
  // Regression for issue #577: game rooms only render while a match is live.
  // Without a match, every room route now leads to the Arcade hub, where all
  // open lobbies live, instead of showing free-floating text or an empty room.
  const player = await createPlayer('Arcade Direct Match Link');
  const actor = await openHomeAs(player.id);
  try {
    for (const route of ['tetris', 'quizRoom', 'scribbleRoom', 'blobby', 'pong', 'snake', 'battleship']) {
      await actor.page.goto(`${BASE_URL}/#${route}`);
      await actor.page.waitForSelector(ARCADE_HUB);
      assert.equal(await activeView(actor.page), 'arcade', `${route} without a match must land on the hub`);
      assert.equal(
        await actor.page.locator('#view-container [data-navigate="arcade"]').count(),
        0,
        `${route} carries no back button; the navigation leads back to Arcade`,
      );
    }
  } finally {
    await actor.context.close();
  }
});

arcadeTest('navigation', 'a deferred background render does not detach an active Arcade create click', async () => {
  const player = await createPlayer('Arcade Pointer Host');
  const host = await openArcadeAs(player.id);
  await host.page.waitForSelector(`${ARCADE_HUB}:not([disabled])`);
  try {
    const tile = host.page.locator(ARCADE_HUB);
    await tile.dispatchEvent('pointerdown', {
      button: 0,
      buttons: 1,
      isPrimary: true,
      pointerId: 1,
      pointerType: 'mouse',
    });
    const tileHandle = await tile.elementHandle();
    assert.ok(tileHandle, 'the create button must remain present after pointerdown');

    // Trigger the background refresh only after pointerdown so the test
    // deterministically exercises the deferred-render path. Waiting merely
    // for a network response raced the page's fetch continuation and could
    // instead exercise a normal post-click refresh under runner load.
    await host.page.evaluate(() => {
      window.dispatchEvent(new Event('respawn:rerender'));
    });
    assert.equal(await tileHandle.evaluate((element) => element.isConnected), true);

    // Drain only the zero-delay work caused by this click, in order, before
    // unrelated socket deliveries can render the page. Observing every later
    // DOM replacement also blamed legitimate background updates on the stale flush.
    const directRenderConnected = await tileHandle.evaluate((element) => {
      const schedule = window.setTimeout.bind(window);
      const cancel = window.clearTimeout.bind(window);
      const pending = new Map<number, () => void>();
      window.setTimeout = ((handler: TimerHandler, delay?: number, ...args: unknown[]) => {
        const id = schedule(handler, delay, ...args);
        if (delay === 0 && typeof handler === 'function') {
          cancel(id);
          pending.set(id, () => handler(...args));
        }
        return id;
      }) as typeof window.setTimeout;
      window.clearTimeout = (id) => {
        if (typeof id === 'number') pending.delete(id);
        cancel(id);
      };
      try {
        element.dispatchEvent(new PointerEvent('pointerup', {
          bubbles: true, button: 0, buttons: 0, isPrimary: true, pointerId: 1, pointerType: 'mouse',
        }));
        element.dispatchEvent(new MouseEvent('click', { bubbles: true, button: 0 }));
      } finally {
        window.setTimeout = schedule;
        window.clearTimeout = cancel;
      }
      const form = document.getElementById('arcade-create-form');
      for (const callback of pending.values()) callback();
      return form?.isConnected ?? false;
    });

    await host.page.waitForSelector('#arcade-create-form');
    assert.equal(
      directRenderConnected,
      true,
      'the click must open the create dialog despite the deferred background render',
    );
    assert.equal(new URL(host.page.url()).hash, '#arcade');
  } finally {
    await host.context.close();
  }
});

arcadeTest('navigation', 'an obsolete or failed Arcade import cannot replace or damage a Core view', async () => {
  const player = await createPlayer('Arcade Import Recovery');
  const stale = await openHomeAs(player.id);
  let releaseImport!: () => void;
  const importReleased = new Promise<void>((resolve) => { releaseImport = resolve; });
  const delayArcade = async (route: import('playwright').Route) => {
    await importReleased;
    await route.continue();
  };
  await stale.page.route('**/js/arcade/views/arcade.js', delayArcade);

  try {
    await clickArcadeDestination(stale.page);
    await stale.page.waitForSelector('text=Arcade wird geladen');
    await stale.page.click('.nav-btn[data-view="home"]');
    releaseImport();
    await stale.page.waitForTimeout(250);
    assert.equal(await activeView(stale.page), 'home');
    assert.equal(await stale.page.locator(ARCADE_HUB).count(), 0);
  } finally {
    releaseImport();
    await stale.context.close();
  }

  const failed = await openHomeAs(player.id);
  const failArcade = (route: import('playwright').Route) => route.abort('failed');
  await failed.page.route('**/js/arcade/views/arcade.js', failArcade);
  try {
    await clickArcadeDestination(failed.page);
    await failed.page.waitForSelector('text=Arcade konnte nicht geladen werden.');
    await failed.page.click('.nav-btn[data-view="home"]');
    assert.equal(await activeView(failed.page), 'home');
    await failed.page.unroute('**/js/arcade/views/arcade.js', failArcade);
    await navigateToArcade(failed.page);
    assert.equal(await activeView(failed.page), 'arcade');
  } finally {
    await failed.context.close();
  }
});

arcadeTest('navigation', 'classic Snake guest returns to the Arcade immediately after leaving', async () => {
  const hostPlayer = await createPlayer('Snake Leave Host');
  const guestPlayer = await createPlayer('Snake Leave Guest');
  const host = await openArcadeAs(hostPlayer.id, { viewport: { width: 568, height: 320 } });
  const guest = await openArcadeAs(guestPlayer.id);
  try {
    await openArcadeLobby(host.page, 'snake', { mode: 'classic' });
    await guest.page.waitForSelector('[data-snake-join]');
    await guest.page.click('[data-snake-join]');
    await host.page.waitForSelector('#snake-start:not([disabled])');
    await host.page.click('#snake-start');
    await Promise.all([
      guest.page.waitForSelector('#snake-canvas'),
      host.page.waitForSelector('#snake-pause'),
    ]);
    // Each player finds the own snake colour on the score bar, in text and
    // not only as a swatch.
    assert.match((await host.page.locator('.arcade-scoreboard').textContent()) ?? '', /Blau · Deine Farbe/);
    assert.match((await guest.page.locator('.arcade-scoreboard').textContent()) ?? '', /Pink · Deine Farbe/);
    // Keep the match alive while the guest handles the confirmation dialog.
    // Under loaded CI runners an unpaused classic round can end first and
    // replace the view, turning this navigation assertion into a timing race.
    await host.page.click('#snake-pause');
    await guest.page.waitForSelector('.snake-overlay');

    await guest.page.click('#snake-leave-match');
    await guest.page.click('[data-confirm]');
    await guest.page.waitForSelector(ARCADE_HUB);
    assert.equal(await activeView(guest.page), 'arcade');
    assert.equal(await guest.page.locator('#snake-canvas').count(), 0);
    assert.equal(
      await guest.page.locator('#connection-status').isHidden(),
      true,
      'closing an auxiliary game socket must not mark the whole app as disconnected',
    );

    await host.page.waitForSelector('#snake-back');
    await host.page.click('#snake-back');
  } finally {
    await host.context.close();
    await guest.context.close();
  }
});

arcadeTest('navigation', 'the kiosk keeps its dashboard while an Arcade match runs', async () => {
  const hostPlayer = await createPlayer('Kiosk Arcade Host');
  const guestPlayer = await createPlayer('Kiosk Arcade Guest');
  const host = await openArcadeAs(hostPlayer.id);
  const guest = await openArcadeAs(guestPlayer.id);
  const kiosk = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await trackE2EContext(kiosk.context(), 'kiosk-arcade');
  try {
    await kiosk.goto(`${BASE_URL}/kiosk.html?token=${E2E_KIOSK_TOKEN}`);
    await kiosk.waitForSelector('#kiosk-dashboard:not([hidden])');
    await startQuizMatch(host.page, guest.page);
    // Negative window: the Arcade full-screen takeover is switched off, so the
    // running match must never hide the dashboard. The server pushes its kiosk
    // snapshot right after the match start; 500 ms covers that delivery.
    await kiosk.waitForTimeout(500);
    assert.equal(await kiosk.locator('#kiosk-dashboard').isVisible(), true);
    assert.equal(await kiosk.locator('#kiosk-game').isHidden(), true);
    await assertNoOverflow(kiosk.locator('#kiosk-dashboard'));
    await assertNoOverflow(kiosk.locator('html'));
    const fullscreen = kiosk.locator('#kiosk-fullscreen');
    await fullscreen.waitFor();
    // Deliberately a small plain icon next to the header clock, not a
    // touch-sized control: this unattended TV canvas is operated by mouse at
    // most, and a full 44px button here would visually compete with the
    // clock it sits beside instead of reading as part of it.
    const fullscreenBox = await fullscreen.boundingBox();
    assert.ok(fullscreenBox && fullscreenBox.width > 0 && fullscreenBox.height > 0 && fullscreenBox.width < 44 && fullscreenBox.height < 44, 'TV fullscreen stays a small icon-sized control, not a touch target');
    await fullscreen.focus();
    await kiosk.keyboard.press('Tab');
    await kiosk.keyboard.press('Shift+Tab');
    assert.equal(await fullscreen.evaluate((element) => document.activeElement === element && element.matches(':focus-visible') && getComputedStyle(element).outlineStyle !== 'none'), true);

    await finishQuizMatch(host.page);
  } finally {
    await deferE2EContextClose(kiosk.context());
    await deferE2EContextClose(host.context);
    await deferE2EContextClose(guest.context);
  }
});

arcadeTest('snake-arena', 'Snake Arena elimination status updates in the spectator view', async () => {
  const players = await Promise.all([
    createPlayer('Snake Status Host'),
    createPlayer('Snake Status Zwei'),
    createPlayer('Snake Status Drei'),
    createPlayer('Snake Status Zuschauer'),
  ]);
  const actors = await Promise.all(players.map((player) => openArcadeAs(player.id)));
  const [host, guest, leaver, spectator] = actors;
  try {
    await openArcadeLobby(host.page, 'snake', { mode: 'arena' });

    for (const actor of [guest, leaver]) {
      await actor.page.waitForSelector('[data-snake-join]');
      await actor.page.click('[data-snake-join]');
    }
    await host.page.waitForSelector('#snake-start:not([disabled])');
    await host.page.click('#snake-start');
    await host.page.waitForSelector('#snake-pause');
    await host.page.click('#snake-pause');
    await host.page.waitForSelector('.snake-overlay');

    await spectator.page.waitForSelector('[data-watch-match]');
    await spectator.page.click('[data-watch-match]');
    await spectator.page.waitForTimeout(500);
    assert.equal(
      await activeView(spectator.page),
      'arcadeWatch',
      (await spectator.page.locator('.toast').last().textContent().catch(() => null)) ?? 'watch view closed without an error',
    );
    await spectator.page.waitForSelector('#arcade-watch-scores .arcade-player-strip-item');

    // The arena can advance between the 50ms test countdown and the pause
    // button becoming clickable, so either the host or the other guest may be
    // the stable survivor. Capture an actually living non-leaver after the
    // pause, then keep verifying that exact player on every readonly view.
    const racingPlayerName = await spectator.page.locator('#arcade-watch-scores .arcade-player-strip-item').evaluateAll(
      (items, candidateNames) => candidateNames.find((name) => items.some((item) => item.textContent?.includes(name) && !item.classList.contains('is-out'))) ?? null,
      [players[0].name, players[1].name]
    );
    assert.ok(racingPlayerName, 'expected a paused host or guest to remain in the race');

    await leaver.page.waitForSelector('#snake-leave-match');
    await leaver.page.click('#snake-leave-match');
    await leaver.page.click('[data-confirm]');

    await spectator.page.waitForFunction((playerName) => Array.from(document.querySelectorAll('#arcade-watch-scores .arcade-player-strip-item')).some(
      (item) => item.textContent?.includes(playerName) && item.classList.contains('is-out') && item.textContent.includes('Ausgeschieden')
    ), players[2].name);
    const racing = spectator.page.locator('#arcade-watch-scores .arcade-player-strip-item', { hasText: racingPlayerName });
    assert.equal(await racing.evaluate((item) => item.classList.contains('is-out')), false);

    await host.page.click('#snake-finish');
    await host.page.click('[data-confirm]');
    await host.page.waitForSelector('#snake-back');
    await host.page.click('#snake-back');
  } finally {
    await Promise.all(actors.map((actor) => actor.context.close()));
  }
});

arcadeTest('navigation', 'watch list: a finished match disappears and active watchers are sent back to the Arcade', async () => {
  const hostPlayer = await createPlayer('Watch Host');
  const guestPlayer = await createPlayer('Watch Guest');
  const spectatorPlayer = await createPlayer('Watch Zuschauer');

  const host = await openArcadeAs(hostPlayer.id);
  const guest = await openArcadeAs(guestPlayer.id);
  const spectator = await openArcadeAs(spectatorPlayer.id);
  try {
    await startQuizMatch(host.page, guest.page);

    // The running match shows up in "Läuft gerade" with a watch action; the
    // readonly watch view opens the quiz stage without answer controls.
    await spectator.page.waitForSelector('.arcade-running-row');
    await spectator.page.setViewportSize({ width: 320, height: 568 });
    await assertControlHeights(spectator.page.locator('[data-watch-match]'));
    await assertNoOverflow(spectator.page.locator('#view-container'));
    await spectator.page.click('[data-watch-match]');
    await spectator.page.waitForSelector('#arcade-watch-stage .quiz-stage-area');
    assert.equal(await activeView(spectator.page), 'arcadeWatch');
    for (const viewport of [{ width: 320, height: 568 }, { width: 512, height: 384 }, { width: 720, height: 450 }]) {
      await spectator.page.setViewportSize(viewport);
      await assertNoOverflow(spectator.page.locator('#view-container'));
      await assertControlHeights(spectator.page.locator('#view-container button'));
      assert.equal(await spectator.page.locator('#quiz-answer-form').count(), 0);
    }

    // Ending the match must push the watcher back to the Arcade on its own —
    // previously the watch view could hang around dead until a reload.
    await finishQuizMatch(host.page);
    await spectator.page.waitForFunction(
      () => (document.getElementById('view-container') as HTMLElement | null)?.dataset.view === 'arcade'
    );
    // ...and the finished match must vanish from the overview list.
    await spectator.page.waitForFunction(() => document.querySelectorAll('.arcade-running-row').length === 0);
  } finally {
    await deferE2EContextClose(host.context);
    await deferE2EContextClose(guest.context);
    await deferE2EContextClose(spectator.context);
  }
});

arcadeTest('navigation', 'watch history: a stale watch entry redirects to the Arcade instead of hanging', async () => {
  const hostPlayer = await createPlayer('Stale Host');
  const guestPlayer = await createPlayer('Stale Guest');
  const spectatorPlayer = await createPlayer('Stale Zuschauer');

  const host = await openArcadeAs(hostPlayer.id);
  const guest = await openArcadeAs(guestPlayer.id);
  const spectator = await openArcadeAs(spectatorPlayer.id);
  try {
    await startQuizMatch(host.page, guest.page);

    await spectator.page.waitForSelector('[data-watch-match]');
    await spectator.page.click('[data-watch-match]');
    await spectator.page.waitForSelector('#arcade-watch-stage .quiz-stage-area');

    // Leave the watch view via the global nav (not its own back button) —
    // the watch history entry stays behind on the stack.
    await spectator.page.click('.nav-btn[data-view="home"]');
    await spectator.page.waitForFunction(
      () => (document.getElementById('view-container') as HTMLElement | null)?.dataset.view === 'home'
    );

    await finishQuizMatch(host.page);

    // Back now pops the stale watch entry. It must immediately redirect to
    // the Arcade (replacing the entry) instead of rendering a dead
    // "Verbindung…" view that never receives updates.
    await spectator.page.goBack();
    await spectator.page.waitForFunction(
      () => (document.getElementById('view-container') as HTMLElement | null)?.dataset.view === 'arcade'
    );
    assert.equal(
      await spectator.page.locator('text=Verbindung zum Spiel wird hergestellt').count(),
      0,
      'the stale watch view must not stay on screen'
    );

    // The replaced entry must not create a back/forward trap: one more back
    // leaves the Arcade for a previous view instead of bouncing.
    await spectator.page.goBack();
    const viewAfterSecondBack = await activeView(spectator.page);
    assert.notEqual(viewAfterSecondBack, 'arcadeWatch', 'back must never land on the dead watch entry again');
  } finally {
    await host.context.close();
    await guest.context.close();
    await spectator.context.close();
  }
});

arcadeTest('navigation', 'rapid fire: lobby-create burst keeps one lobby, ready toggle survives spam clicking', async () => {
  const hostPlayer = await createPlayer('Spam Klicker');
  const guestPlayer = await createPlayer('Spam Gast');

  const host = await openArcadeAs(hostPlayer.id);
  const guest = await openArcadeAs(guestPlayer.id);
  try {
    await host.page.waitForSelector(`${ARCADE_HUB}:not([disabled])`);
    // Five create submissions as fast as the UI allows, without awaiting the
    // acks in between: the server-side membership guard must collapse the
    // burst into exactly one lobby. Depending on broadcast timing a submit can
    // hit the "already in a lobby" confirm dialog instead; both paths are part
    // of the spam scenario, so short timeouts + catch keep the burst going.
    for (let i = 0; i < 5; i += 1) {
      await host.page.click(ARCADE_HUB, { timeout: 500 }).catch(() => undefined);
      await host.page.click('#arcade-create-form button[type="submit"]', { timeout: 500 }).catch(() => undefined);
    }
    // Dismiss any leave-confirmations or dialogs the spam happened to open.
    while ((await host.page.locator('[data-cancel], .modal [data-close]').count()) > 0) {
      await host.page.click('[data-cancel], .modal [data-close]', { timeout: 500 }).catch(() => undefined);
      await host.page.waitForTimeout(100);
    }
    await host.page.waitForSelector('[data-close-lobby]');
    await host.page.waitForTimeout(400); // let every ack/broadcast settle
    assert.equal(await host.page.locator('[data-close-lobby]').count(), 1, 'the burst must leave exactly one own lobby');
    const lobbies = (await (
      await fetch(`${BASE_URL}/api/arcade/lobbies`, { headers: { cookie: adminCookie } })
    ).json()) as { lobbies: unknown[] };
    assert.equal(lobbies.lobbies.length, 1, 'the server must hold exactly one open lobby after the burst');

    await guest.page.waitForSelector('[data-join-lobby]');
    await guest.page.click('[data-join-lobby]');

    // Spam the ready toggle: every click lands on the freshly re-rendered
    // button (each toggle broadcast rebuilds the list). The UI must stay
    // responsive and consistent instead of dying on a detached node.
    for (let i = 0; i < 6; i += 1) {
      await guest.page.click('[data-quiz-ready]', { timeout: 500 }).catch(() => undefined);
      await guest.page.waitForTimeout(60);
    }
    await guest.page.waitForTimeout(400);
    // Whatever parity the spam ended on, the control must still work:
    // force it to "ready", then back to not ready. Readiness now lives in
    // the player row instead of a duplicate summary sentence.
    if ((await guest.page.locator('[data-quiz-ready][data-ready="1"]').count()) > 0) {
      await guest.page.click('[data-quiz-ready][data-ready="1"]');
    }
    await host.page.waitForSelector('.arcade-lobby-member-role:has-text("Bereit")');
    await guest.page.waitForSelector('[data-quiz-ready][data-ready="0"]');
    await guest.page.click('[data-quiz-ready][data-ready="0"]');
    await host.page.waitForSelector('.arcade-lobby-member-role:has-text("Wartet")');

    await host.page.click('[data-close-lobby]');
    await host.page.waitForSelector('text=Keine offene Lobby.');
  } finally {
    await host.context.close();
    await guest.context.close();
  }
});

// Geometry of the running game room: the fitted board, whether the view
// scrolls and whether the app chrome is on screen.
async function readGameRoomFit(page: Page) {
  return page.evaluate(() => {
    const view = document.getElementById('view-container') as HTMLElement;
    const shell = document.querySelector('.arcade-game-shell') as HTMLElement;
    const board = document.querySelector('.tetris-canvas') as HTMLElement;
    const topbar = document.querySelector('.topbar') as HTMLElement;
    return {
      budget: shell.style.getPropertyValue('--arcade-h-budget').trim(),
      boardHeight: board.getBoundingClientRect().height,
      verticalOverflow: view.scrollHeight - view.clientHeight,
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
      fullscreenClass: document.documentElement.classList.contains('arcade-fullscreen'),
      topbarVisible: topbar.getClientRects().length > 0,
      pressed: document.querySelector('[data-arcade-fullscreen]')?.getAttribute('aria-pressed') ?? null,
    };
  });
}

arcadeTest('multiplayer', 'Tetris fits a short laptop screen and fullscreen grows the board until the room is left', async () => {
  const hostPlayer = await createPlayer('Tetris Host');
  const guestPlayer = await createPlayer('Tetris Gast');

  // Wide-but-short desktop viewport: exactly the shape where the board used
  // to overflow below the fold, the layout overflowed sideways (decorative
  // glow) and the overlays were misaligned.
  const host = await openArcadeAs(hostPlayer.id, { viewport: { width: 1280, height: 640 } });
  const guest = await openArcadeAs(guestPlayer.id);
  try {
    await openArcadeLobby(host.page, 'tetris', { mode: 'duel' });
    await guest.page.waitForSelector('[data-tetris-join]');
    await guest.page.click('[data-tetris-join]');
    await guest.page.waitForSelector('[data-tetris-ready][data-ready="1"]');
    await guest.page.click('[data-tetris-ready][data-ready="1"]');
    await host.page.waitForSelector('#tetris-start:not([disabled])');
    await host.page.click('#tetris-start');

    await host.page.waitForSelector('.arcade-game-shell #tetris-boards .tetris-canvas');
    await host.page.waitForFunction(() =>
      Boolean((document.querySelector('.arcade-game-shell') as HTMLElement | null)?.style.getPropertyValue('--arcade-h-budget').trim()));
    const fitted = await readGameRoomFit(host.page);
    // Without any toggle the board fits the remaining height: header and
    // match controls stay on screen and nothing scrolls in either direction.
    assert.ok(fitted.verticalOverflow <= 0, `the fitted game room must not scroll vertically (${fitted.verticalOverflow}px)`);
    assert.ok(
      fitted.scrollWidth <= fitted.clientWidth,
      `the fitted game room must not scroll sideways (scrollWidth ${fitted.scrollWidth} > clientWidth ${fitted.clientWidth})`
    );
    assert.equal(fitted.pressed, 'false');

    // Overlay geometry: the absolute layers (fx/overlay/incoming) position
    // against .tetris-canvas-wrap, so the wrap must hug the visible canvas.
    const alignment = await host.page.evaluate(() => {
      const canvas = document.querySelector('.tetris-canvas') as HTMLElement;
      const wrap = canvas.closest('.tetris-canvas-wrap') as HTMLElement;
      const c = canvas.getBoundingClientRect();
      const w = wrap.getBoundingClientRect();
      return { canvasWidth: c.width, wrapWidth: w.width };
    });
    assert.ok(
      Math.abs(alignment.canvasWidth - alignment.wrapWidth) <= 2,
      `overlays anchor to the wrap, so it must match the canvas width (canvas ${alignment.canvasWidth}, wrap ${alignment.wrapWidth})`
    );

    // Fullscreen hides the app chrome and hands its height to the board,
    // which still fits without scrolling. Toggling back restores the chrome.
    await host.page.click('[data-arcade-fullscreen]');
    await host.page.waitForFunction((before) =>
      (document.querySelector('.tetris-canvas') as HTMLElement).getBoundingClientRect().height > before + 20, fitted.boardHeight);
    const fullscreen = await readGameRoomFit(host.page);
    assert.equal(fullscreen.fullscreenClass, true);
    assert.equal(fullscreen.topbarVisible, false, 'fullscreen must hide the topbar');
    assert.equal(fullscreen.pressed, 'true');
    assert.ok(fullscreen.verticalOverflow <= 0, `the fullscreen game room must not scroll vertically (${fullscreen.verticalOverflow}px)`);
    assert.ok(fullscreen.scrollWidth <= fullscreen.clientWidth, 'the fullscreen game room must not scroll sideways');
    await host.page.click('[data-arcade-fullscreen]');
    await host.page.waitForSelector('.topbar', { state: 'visible' });
    const restored = await readGameRoomFit(host.page);
    assert.equal(restored.fullscreenClass, false);
    assert.equal(restored.pressed, 'false');
    assert.ok(restored.verticalOverflow <= 0, 'leaving fullscreen must refit the board below the restored chrome');

    // Leaving the Arcade area must not strand an active match. "Läuft gerade"
    // offers the own match as "Weiterspielen" so the host can still finish it.
    await host.page.locator('.desktop-nav-btn[data-view="home"]:visible').click();
    await host.page.waitForFunction(() => (document.getElementById('view-container') as HTMLElement | null)?.dataset.view === 'home');
    await navigateToArcade(host.page);
    await host.page.waitForSelector('[data-arcade-resume="tetris"]');
    await host.page.click('[data-arcade-resume="tetris"]');
    await host.page.waitForSelector('#tetris-finish');

    // Fullscreen survives the end of the match (the result stays in the game
    // room) and ends together with the game room.
    await host.page.click('[data-arcade-fullscreen]');
    await host.page.waitForSelector('html.arcade-fullscreen', { state: 'attached' });
    await host.page.click('#tetris-finish');
    await host.page.click('[data-confirm]');
    await host.page.waitForSelector('#tetris-back');
    assert.equal(await host.page.evaluate(() => document.documentElement.classList.contains('arcade-fullscreen')), true);
    await host.page.click('#tetris-back');
    await host.page.waitForSelector(ARCADE_HUB);
    await host.page.waitForFunction(() =>
      !document.documentElement.classList.contains('arcade-fullscreen') && !document.fullscreenElement);
    await host.page.waitForSelector('.topbar', { state: 'visible' });
  } finally {
    await host.context.close();
    await guest.context.close();
  }
});

arcadeTest('multiplayer', 'Tetris Arena supports six ready players across multiple opponent rows', async () => {
  const players = await Promise.all(
    ['Arena Browser Host', 'Arena Browser Zwei', 'Arena Browser Drei', 'Arena Browser Vier', 'Arena Browser Fünf', 'Arena Browser Sechs'].map(createPlayer),
  );
  const actors = await Promise.all(players.map((player, index) => openArcadeAs(
    player.id,
    index === 0 ? { viewport: { width: 1280, height: 1000 } } : undefined,
  )));
  const [host, ...guests] = actors;
  let hostClosed = false;
  try {
    await openArcadeLobby(host.page, 'tetris', { mode: 'arena' });

    for (const guest of guests) {
      await guest.page.waitForSelector('[data-tetris-join]');
      await guest.page.click('[data-tetris-join]');
      await guest.page.waitForSelector('[data-tetris-ready][data-ready="1"]');
      await guest.page.click('[data-tetris-ready][data-ready="1"]');
    }

    await host.page.waitForSelector('#tetris-start:not([disabled])');
    await host.page.click('#tetris-start');
    await host.page.waitForSelector('.tetris-boards.is-arena');
    assert.equal(await host.page.locator('.tetris-canvas').count(), 6);
    assert.equal(await host.page.locator('.tetris-primary-board .tetris-canvas').count(), 1);
    assert.equal(await host.page.locator('.tetris-opponent-grid .tetris-canvas').count(), 5);
    await host.page.waitForFunction(() => {
      const shell = document.querySelector('.arcade-game-shell') as HTMLElement | null;
      return Boolean(shell?.style.getPropertyValue('--arcade-h-budget').trim());
    });

    // Home's background current-item refresh may finish after entering a
    // match. Deliver that completion between layout and measurement: it must
    // not rebuild the active game or reset its measured height budget.
    await host.page.locator('.tetris-primary-board .tetris-canvas').evaluate((canvas) => {
      canvas.dataset.renderIdentity = 'before-pause';
      window.dispatchEvent(new CustomEvent('respawn:aktuell-changed'));
    });
    const layout = await host.page.evaluate(() => {
      const primary = document.querySelector('.tetris-primary-board .tetris-canvas') as HTMLElement;
      const opponent = document.querySelector('.tetris-opponent-grid .tetris-canvas') as HTMLElement;
      return {
        primaryWidth: primary.getBoundingClientRect().width,
        opponentWidth: opponent.getBoundingClientRect().width,
        opponentGridHeight: (document.querySelector('.tetris-opponent-grid') as HTMLElement).getBoundingClientRect().height,
        primaryHeight: primary.getBoundingClientRect().height,
        heightBudget: Number.parseFloat(getComputedStyle(document.querySelector('.arcade-game-shell') as HTMLElement).getPropertyValue('--arcade-h-budget')),
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      };
    });
    assert.ok(layout.primaryWidth > layout.opponentWidth);
    assert.ok(layout.opponentGridHeight > layout.primaryHeight, 'multiple opponent rows must be represented by the full opponent grid');
    assert.ok(layout.heightBudget > 160, `multi-row arena must not collapse to the minimum height budget (${layout.heightBudget})`);
    assert.ok(layout.scrollWidth <= layout.clientWidth);

    assert.equal(
      await host.page.locator('.tetris-primary-board .tetris-canvas').getAttribute('data-render-identity'),
      'before-pause',
      'a background Home refresh must preserve the active game canvas',
    );
    await host.page.click('#tetris-pause');
    await host.page.waitForSelector('#tetris-resume');
    await guests[0].page.waitForSelector('.tetris-overlay:has-text("Pause")');
    await assertControlHeights(host.page.locator('#tetris-resume, #tetris-finish'));
    await assertControlHeights(guests[0].page.locator('#tetris-leave'));
    await guests[0].page.locator('.tetris-boards').scrollIntoViewIfNeeded();
    const guestViewport = await guests[0].page.locator('#view-container').evaluate((element) => ({
      scrollWidth: element.scrollWidth,
      clientWidth: element.clientWidth,
      overflowing: Array.from(element.querySelectorAll<HTMLElement>('*')).filter((child) => child.getBoundingClientRect().right > element.getBoundingClientRect().right + 1)
        .map((child) => ({ className: child.className, right: child.getBoundingClientRect().right })),
    }));
    assert.ok(guestViewport.scrollWidth <= guestViewport.clientWidth, `paused guest view overflows: ${JSON.stringify(guestViewport)}`);
    assert.equal(
      await host.page.locator('.tetris-primary-board .tetris-canvas').getAttribute('data-render-identity'),
      'before-pause',
      'pausing must update controls/overlay without replacing the live canvas',
    );
    // Regression guard for #592: the host disconnecting mid-match hands
    // control to guests[0]. That handover must only swap the control footer
    // (Verlassen -> Pausieren/Beenden), never rebuild the mounted canvases.
    await guests[0].page.locator('.tetris-primary-board .tetris-canvas').evaluate((canvas) => {
      canvas.dataset.renderIdentity = 'before-host-handover';
    });
    await host.context.close();
    hostClosed = true;
    await guests[0].page.waitForSelector('#tetris-resume');
    assert.equal(
      await guests[0].page.locator('.tetris-primary-board .tetris-canvas').getAttribute('data-render-identity'),
      'before-host-handover',
      'a host handover must update controls without replacing the live canvas',
    );
    await guests[0].page.click('#tetris-resume');
    await guests[0].page.waitForSelector('#tetris-finish');
    await guests[0].page.click('#tetris-finish');
    await guests[0].page.click('[data-confirm]');
    await guests[0].page.waitForSelector('#tetris-back');
    // Regression guard: the end-of-match ranking lists every player with the
    // full name instead of squeezing names into an avatar-sized column and
    // truncating them to a single letter (e.g. "T…", "B…").
    const rosterNames = await guests[0].page
      .locator('.arcade-result-list .arcade-result-player .player-name')
      .allTextContents();
    assert.equal(rosterNames.length, players.length);
    for (const player of players) assert.ok(rosterNames.includes(player.name), `missing full name for ${player.name}`);
  } finally {
    if (!hostClosed) await deferE2EContextClose(host.context);
    for (const actor of guests) await deferE2EContextClose(actor.context);
  }
});

// The focused Blobby browser flow keeps its game-specific doubles toggle and
// team payload covered without repeating this complete four-player start.
// The full Blobby match contract remains in api.blobbyMultiplayer.test.ts.
arcadeTest('multiplayer', 'Pong Doppel: mobile and desktop lobbies assign two full teams and start four players', async () => {
  const players = await Promise.all([
    createPlayer('Pong Blau Host'),
    createPlayer('Pong Blau Zwei'),
    createPlayer('Pong Pink Eins'),
    createPlayer('Pong Pink Zwei'),
  ]);
  const actors = await Promise.all(players.map((player, index) => openArcadeAs(
    player.id,
    index === 0 ? { viewport: { width: 1280, height: 800 } } : undefined
  )));

  try {
    const [host, blue, pinkA, pinkB] = actors;
    await host.page.click(ARCADE_HUB);
    await host.page.selectOption('#arcade-create-game', 'pong');
    await host.page.waitForSelector('#arcade-create-mode [data-arcade-mode="duel"][aria-pressed="true"]');
    await host.page.keyboard.press('Escape');
    await openArcadeLobby(host.page, 'pong', { mode: 'doubles' });
    await host.page.waitForSelector('text=Team Blau');
    await host.page.waitForSelector('text=Team Pink');
    await host.page.waitForSelector('#pong-start:disabled');
    assert.equal(await host.page.locator('select[name="pong-target"]').inputValue(), '21');

    await blue.page.waitForSelector('[data-pong-team="left"]');
    await blue.page.click('[data-pong-team="left"]');
    await blue.page.waitForSelector('[data-pong-ready][data-ready="1"]');
    await blue.page.click('[data-pong-ready][data-ready="1"]');

    for (const actor of [pinkA, pinkB]) {
      await actor.page.waitForSelector('[data-pong-team="right"]');
      await actor.page.click('[data-pong-team="right"]');
      await actor.page.waitForSelector('[data-pong-ready][data-ready="1"]');
      await actor.page.click('[data-pong-ready][data-ready="1"]');
    }

    await host.page.waitForSelector('#pong-start:not([disabled])');
    assert.equal(await host.page.locator('.arcade-lobby-member-row .player-name').count(), 4);
    for (const actor of [host, blue]) {
      const width = await actor.page.evaluate(() => ({
        scroll: document.documentElement.scrollWidth,
        client: document.documentElement.clientWidth,
      }));
      assert.ok(width.scroll <= width.client, 'the Pong Doppel lobby must not scroll horizontally');
    }
    await host.page.click('#pong-start');

    for (const actor of actors) {
      await actor.page.waitForSelector('#pong-canvas');
      assert.equal(await actor.page.locator('.arcade-scoreboard-player').count(), 4);
    }
  } finally {
    await Promise.all(actors.map((actor) => actor.context.close()));
  }
});

arcadeTest('scribble', 'Scribble: the fitted canvas keeps 8:5 beside its tools and rapid fullscreen toggles stay synchronized', async () => {
  const hostPlayer = await createAdminPlayer('Scribble Geometrie Host');
  const guestPlayer = await createAdminPlayer('Scribble Geometrie Gast');

  // Short desktop viewport so the remaining height is what limits the
  // fitted playfield — the code path that used to distort the canvas.
  const host = await openArcadeAs(hostPlayer.id, { viewport: { width: 1280, height: 640 }, adminMode: true });
  const guest = await openArcadeAs(guestPlayer.id, { adminMode: true });
  try {
    await startScribbleMatch(host.page, [guest.page], 1);
    await host.page.waitForSelector('.scribble-word-choice-btn');
    await host.page.locator('.scribble-word-choice-btn').first().click();
    await host.page.waitForSelector('#scribble-canvas');
    await host.page.waitForFunction(() =>
      Boolean((document.querySelector('.arcade-game-shell') as HTMLElement | null)?.style.getPropertyValue('--arcade-h-budget').trim()));

    const geometry = await host.page.evaluate(() => {
      const canvas = document.querySelector('#scribble-canvas') as HTMLCanvasElement;
      const wrap = canvas.closest('.scribble-canvas-wrap') as HTMLElement;
      const tools = document.querySelector('.scribble-toolbar') as HTMLElement;
      const view = document.getElementById('view-container') as HTMLElement;
      return {
        canvasWidth: canvas.clientWidth,
        canvasHeight: canvas.clientHeight,
        wrapRight: wrap.getBoundingClientRect().right,
        wrapHeight: wrap.clientHeight,
        toolsLeft: tools.getBoundingClientRect().left,
        verticalOverflow: view.scrollHeight - view.clientHeight,
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      };
    });
    assert.ok(
      Math.abs(geometry.canvasHeight - geometry.wrapHeight) <= 2,
      `the canvas must fill the 8:5 wrapper (canvas ${geometry.canvasHeight}px vs wrap ${geometry.wrapHeight}px high)`
    );
    const ratio = geometry.canvasWidth / geometry.canvasHeight;
    assert.ok(Math.abs(ratio - 1.6) < 0.05, `the fitted Scribble canvas must stay at 8:5 (got ${ratio.toFixed(3)})`);
    assert.ok(geometry.toolsLeft >= geometry.wrapRight, 'on a laptop the drawing tools sit beside the canvas');
    assert.ok(geometry.verticalOverflow <= 0, `the fitted Scribble room must not scroll vertically (${geometry.verticalOverflow}px)`);
    assert.ok(geometry.scrollWidth <= geometry.clientWidth, 'the fitted Scribble room must not scroll sideways');

    // An odd number of rapid clicks ends in fullscreen; the button, the page
    // state and a pending browser request must all agree afterwards.
    for (let i = 0; i < 7; i += 1) await host.page.click('[data-arcade-fullscreen]');
    const toggleState = await host.page.evaluate(() => ({
      pressed: document.querySelector('[data-arcade-fullscreen]')?.getAttribute('aria-pressed'),
      label: document.querySelector('[data-arcade-fullscreen]')?.getAttribute('aria-label'),
      fullscreen: document.documentElement.classList.contains('arcade-fullscreen'),
    }));
    assert.deepEqual(toggleState, { pressed: 'true', label: 'Vollbild beenden', fullscreen: true });
    await host.page.click('[data-arcade-fullscreen]');
    await host.page.waitForFunction(() =>
      !document.documentElement.classList.contains('arcade-fullscreen') && !document.fullscreenElement);
    assert.equal(await host.page.getAttribute('[data-arcade-fullscreen]', 'aria-pressed'), 'false');
    await finishScribbleMatch(host.page);
  } finally {
    await Promise.all([host.context.close(), guest.context.close()]);
  }
});

arcadeTest('scribble', 'Scribble: live thumbs-up stays synchronized and the next round starts blank', async () => {
  const hostPlayer = await createAdminPlayer('Scribble Maler');
  const guestPlayer = await createAdminPlayer('Scribble Rater');
  const spectatorPlayer = await createAdminPlayer('Scribble Zuschauer');

  const host = await openArcadeAs(hostPlayer.id, { adminMode: true });
  const guest = await openArcadeAs(guestPlayer.id, { adminMode: true });
  const spectator = await openArcadeAs(spectatorPlayer.id, { adminMode: true });
  try {
    await startScribbleMatch(host.page, [guest.page], 2);

    // Round 1, turn 1: the host draws.
    await host.page.waitForSelector('.scribble-word-choice-btn');
    await guest.page.waitForSelector('#scribble-countdown');
    assert.match((await guest.page.locator('#scribble-countdown').textContent()) ?? '', /^\d+ s$/);
    const firstWordBtn = host.page.locator('.scribble-word-choice-btn').first();
    const firstWord = (await firstWordBtn.textContent())!.trim();
    await firstWordBtn.click();
    await host.page.waitForSelector('#scribble-canvas');

    const box = await laidOutRect(host.page, '#scribble-canvas');
    await host.page.mouse.move(box.x + 30, box.y + 30);
    await host.page.mouse.down();
    await host.page.mouse.move(box.x + 200, box.y + 120, { steps: 10 });
    await host.page.mouse.up();
    await guest.page.waitForFunction(
      () => Number(document.querySelector('#scribble-canvas')?.getAttribute('data-scribble-stroke-count') ?? 0) >= 1
    );
    await guest.page.waitForSelector('#scribble-thumb');
    await guest.page.click('#scribble-thumb');
    await guest.page.waitForFunction(
      () => document.querySelector('[data-scribble-thumb-count]')?.textContent === '1'
    );

    await spectator.page.waitForSelector('[data-watch-match]');
    await spectator.page.click('[data-watch-match]');
    await spectator.page.waitForSelector('#arcade-watch-thumb:not([disabled])');
    await spectator.page.click('#arcade-watch-thumb');
    await guest.page.waitForFunction(
      () => document.querySelector('[data-scribble-thumb-count]')?.textContent === '2'
    );

    // Submit like a player, through the live input: a background room re-render can replace
    // the form at any time, and a separately resolved form handle may already be detached.
    await guest.page.fill('#scribble-guess-input', 'zzzz-kein-scribble-wort-zzzz');
    await guest.page.locator('#scribble-guess-input').press('Enter');
    await guest.page.waitForFunction(
      () => document.getElementById('scribble-guess-feedback')?.textContent === 'Noch nicht richtig.',
    );

    await guest.page.fill('#scribble-guess-input', firstWord);
    await guest.page.locator('#scribble-guess-input').press('Enter');
    await guest.page.waitForFunction(
      () => ['correct', 'wrong', 'rejected'].includes(document.getElementById('view-container')?.dataset.scribbleGuessResult ?? ''),
    );
    assert.equal(
      await guest.page.locator('#view-container').getAttribute('data-scribble-guess-result'),
      'correct',
      'the first guess must be acknowledged as correct before the turn transition',
    );
    await guest.page.waitForSelector('[data-scribble-guess-feedback-result="correct"]');
    assert.match(
      (await guest.page.locator('[data-scribble-guess-feedback-result="correct"]').textContent()) ?? '',
      /^Richtig! \+\d+ Punkte$/,
    );
    await guest.page.waitForSelector('.scribble-word-choice-btn');

    // Turn 2: the guest draws, then the next durable word-choice state proves
    // that both clients crossed reveal before round two is sampled.
    const secondWordBtn = guest.page.locator('.scribble-word-choice-btn').first();
    const secondWord = (await secondWordBtn.textContent())!.trim();
    await secondWordBtn.click();
    await host.page.waitForSelector('#scribble-guess-input');
    await host.page.fill('#scribble-guess-input', secondWord);
    await host.page.locator('#scribble-guess-input').press('Enter');
    await host.page.waitForFunction(
      () => ['correct', 'wrong', 'rejected'].includes(document.getElementById('view-container')?.dataset.scribbleGuessResult ?? ''),
    );
    assert.equal(
      await host.page.locator('#view-container').getAttribute('data-scribble-guess-result'),
      'correct',
      'the second guess must be acknowledged as correct before the round transition',
    );
    await host.page.waitForSelector('.scribble-word-choice-btn');
    await host.page.locator('.scribble-word-choice-btn').first().click();
    await Promise.all([host.page, guest.page].map((page) => page.waitForSelector('#scribble-canvas')));
    // This is a negative assertion window: a stale reconnect replay must not
    // paint after the freshly mounted round-two canvas has appeared.
    await guest.page.waitForTimeout(400);
    const guestPainted = await countPaintedPixels(guest.page, '#scribble-canvas');
    assert.equal(guestPainted, 0, 'the new round must start on a blank canvas — no replay of the previous drawing');
    const hostPainted = await countPaintedPixels(host.page, '#scribble-canvas');
    assert.equal(hostPainted, 0, 'the drawer must start on a blank canvas too');
    await finishScribbleMatch(host.page);
  } finally {
    await Promise.all([host.context.close(), guest.context.close(), spectator.context.close()]);
  }
});
