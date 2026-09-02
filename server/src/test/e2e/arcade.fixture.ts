// Browser E2E tests for the Arcade area: spectating running matches (list
// lifecycle, auto-redirect on match end, stale history entries), the
// expandable playfield geometry, and rapid-fire robustness (lobby-create
// bursts, ready-toggle spam). Complements the broader click-through suite in
// flows.e2e.test.ts — this file owns the Arcade-specific regressions from the
// spectator/expand work.

import { test, before, after, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import type { ChildProcess } from 'child_process';
import { chromium, Browser, BrowserContext, Page } from 'playwright';
import { laidOutRect } from './canvasHelpers';
import {
  addSessionCookie,
  authenticatedServerEnv,
  createE2EAccount,
  E2E_KIOSK_TOKEN,
  loginE2EAdmin,
} from './authHelpers';
import { runWithE2EDiagnostics, trackE2EContext } from './e2eDiagnostics';
import { startE2EServer, type E2EServer } from './e2eServer';

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

// Opens a fresh context+page with the player's personal session.
async function openArcadeAs(
  playerId: string,
  { viewport = { width: 390, height: 844 }, expanded = false } = {}
): Promise<Actor> {
  const context = await browser.newContext({ viewport });
  await trackE2EContext(context, `${playerId}-arcade`);
  const cookie = playerCookies.get(playerId);
  assert.ok(cookie, `missing personal session for ${playerId}`);
  await addSessionCookie(context, BASE_URL, cookie);
  const page = await context.newPage();
  page.on('pageerror', (err) => console.error('[pageerror]', err.message));
  await page.goto(BASE_URL);
  await page.evaluate(
    (expand) => {
      // The expand preference must already exist before the game view first
      // renders — that ordering is exactly what the geometry regressions
      // below are about (see wireArcadeExpandControl).
      localStorage.setItem('lan-arcade-expanded', String(expand));
    },
    expanded
  );
  await page.reload();
  await page.waitForFunction(() =>
    Array.from(document.querySelectorAll<HTMLElement>(
      '.desktop-nav-btn[data-view="arcade"], .nav-btn[data-view="more"]',
    )).some((button) => button.getClientRects().length > 0));
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
    await desktopArcade.click({ timeout: 4_000 });
    return;
  }
  await page.click('.nav-btn[data-view="more"]:visible', { timeout: 4_000 });
  await page.click('[data-navigate="arcade"]', { timeout: 4_000 });
}

async function navigateToArcade(page: Page): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    // Freshly created players still broadcast players:changed refreshes that
    // can replace the mobile "Mehr" view or a direct desktop item mid-click.
    await clickArcadeDestination(page).catch(() => undefined);
    try {
      await page.waitForSelector('.arcade-tiles', { timeout: 4_000 });
      return;
    } catch {
      // A player refresh can replace More while the transition is in flight.
    }
  }
  throw new Error('could not navigate to Arcade');
}

function activeView(page: Page): Promise<string | undefined> {
  return page.evaluate(() => (document.getElementById('view-container') as HTMLElement | null)?.dataset.view);
}

async function openArcadeGame(page: Page, game: string, readySelector: string): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    if ((await page.locator(readySelector).count()) > 0) return;
    await page.waitForSelector('.arcade-tiles', { timeout: 4_000 });
    await page.click(`[data-game="${game}"]`, { timeout: 4_000 }).catch(() => undefined);
    try {
      await page.waitForSelector(readySelector, { timeout: 4_000 });
      return;
    } catch {
      // A realtime refresh can replace the launcher during the click. Retry
      // from the stable Arcade tile view instead of waiting for a stale node.
    }
  }
  throw new Error(`could not open the ${game} game view`);
}

async function startQuizMatch(host: Page, guest: Page): Promise<void> {
  if ((await host.locator('#quiz-create-lobby').count()) === 0) await host.click('[data-game="quiz"]');
  await host.waitForSelector('#quiz-create-lobby:not([disabled])');
  await host.click('#quiz-create-lobby');
  if ((await guest.locator('[data-join-lobby]').count()) === 0 && (await guest.locator('#quiz-create-lobby').count()) === 0) {
    await guest.click('[data-game="quiz"]');
  }
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
  await host.waitForSelector('.arcade-tiles');
}

async function startScribbleMatch(host: Page, guests: Page[], rounds: 1 | 2 | 3): Promise<void> {
  await host.click('[data-game="scribble"]');
  await host.waitForSelector('#scribble-create:not([disabled])');
  await host.click('#scribble-create');
  for (const guest of guests) {
    if ((await guest.locator('[data-scribble-join]').count()) === 0) await guest.click('[data-game="scribble"]');
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
  await host.waitForSelector('text=Match beendet');
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

    await actor.page.click('[data-game="snake"]');
    await actor.page.waitForSelector('#arcade-active-game-title:has-text("Snake")');
    assert.equal(new URL(actor.page.url()).hash, '#arcade/snake');
    assert.equal(
      await actor.page.locator('#arcade-active-game-title').evaluate((heading) => {
        const active = heading.closest('.grouped-page-section')?.getBoundingClientRect();
        const picker = document.querySelector('.arcade-game-picker')?.getBoundingClientRect();
        return Boolean(active && picker && picker.top < active.top);
      }),
      true,
      'the selected game lobby is placed below the game selection',
    );
    assert.equal(await actor.page.locator('#arcade-game-back').count(), 0);
    await actor.page.goBack();
    await actor.page.waitForSelector('#arcade-active-game-title', { state: 'detached' });
    assert.equal(new URL(actor.page.url()).hash, '#arcade');
    await actor.page.goForward();
    await actor.page.waitForSelector('#arcade-active-game-title:has-text("Snake")');
    await actor.page.click('[data-game="snake"]');
    await actor.page.waitForSelector('#arcade-active-game-title', { state: 'detached' });
    assert.equal(new URL(actor.page.url()).hash, '#arcade');

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
    await direct.goto(`${BASE_URL}/#arcade/snake`);
    await direct.waitForSelector('#arcade-active-game-title:has-text("Snake")');
    await direct.waitForSelector('#arcade-stylesheet[data-loaded="true"]', { state: 'attached' });
    assert.equal(await activeView(direct), 'arcade');
    await direct.reload();
    await direct.waitForSelector('#arcade-active-game-title:has-text("Snake")');
    assert.equal(await direct.locator('#arcade-game-back').count(), 0);
    await direct.click('[data-game="snake"]');
    await direct.waitForSelector('#arcade-active-game-title', { state: 'detached' });
    assert.equal(new URL(direct.url()).hash, '#arcade');
    await direct.close();
  } finally {
    await actor.context.close();
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
    assert.equal(await stale.page.locator('.arcade-tiles').count(), 0);
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
    await host.page.click('[data-game="snake"]');
    await host.page.waitForSelector('#snake-create:not([disabled])');
    await host.page.click('#snake-create');

    await guest.page.click('[data-game="snake"]');
    await guest.page.waitForSelector('[data-snake-join]');
    await guest.page.click('[data-snake-join]');
    await host.page.waitForSelector('#snake-start:not([disabled])');
    await host.page.click('#snake-start');
    await Promise.all([
      host.page.waitForSelector('.countdown-player-identity'),
      guest.page.waitForSelector('.countdown-player-identity'),
    ]);
    assert.match(await host.page.locator('.countdown-player-identity').innerText(), /Du bist\s+Blau/);
    assert.match(await guest.page.locator('.countdown-player-identity').innerText(), /Du bist\s+Pink/);
    const countdownIdentityBox = await host.page.locator('.countdown-player-identity').boundingBox();
    const countdownColorBox = await host.page.locator('.countdown-player-color').boundingBox();
    const viewportHeight = await host.page.evaluate(() => window.innerHeight);
    assert.ok(
      countdownIdentityBox
        && countdownIdentityBox.y >= 0
        && countdownIdentityBox.y + countdownIdentityBox.height <= viewportHeight,
      'the Snake player identity must remain fully visible in a short viewport',
    );
    assert.ok(
      countdownColorBox && countdownColorBox.width >= 32,
      'the countdown player colour must remain prominent',
    );
    const countdownBackdropFilter = await host.page.locator('.countdown-overlay').evaluate((element) => {
      const styles = getComputedStyle(element);
      return `${styles.backdropFilter} ${styles.getPropertyValue('-webkit-backdrop-filter')}`;
    });
    assert.doesNotMatch(countdownBackdropFilter, /blur/i);
    await Promise.all([
      guest.page.waitForSelector('#snake-canvas'),
      host.page.waitForSelector('#snake-pause'),
    ]);
    assert.match(await host.page.locator('.snake-player-identity').innerText(), /Deine Farbe\s+Blau/);
    assert.match(await guest.page.locator('.snake-player-identity').innerText(), /Deine Farbe\s+Pink/);
    const playerColorBox = await host.page.locator('.snake-player-color').boundingBox();
    assert.ok(playerColorBox && playerColorBox.width >= 32);
    // Keep the match alive while the guest handles the confirmation dialog.
    // Under loaded CI runners an unpaused classic round can end first and
    // replace the view, turning this navigation assertion into a timing race.
    await host.page.click('#snake-pause');
    await guest.page.waitForSelector('.snake-overlay');

    await guest.page.click('#snake-leave-match');
    await guest.page.click('[data-confirm]');
    await guest.page.waitForSelector('.arcade-tiles');
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

arcadeTest('navigation', 'the kiosk removes stale quiz markup before rendering a canvas game', async () => {
  const hostPlayer = await createPlayer('Kiosk Transition Host');
  const guestPlayer = await createPlayer('Kiosk Transition Guest');
  const host = await openArcadeAs(hostPlayer.id);
  const guest = await openArcadeAs(guestPlayer.id);
  const kiosk = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  try {
    await kiosk.goto(`${BASE_URL}/kiosk.html?token=${E2E_KIOSK_TOKEN}`);
    await kiosk.waitForSelector('#kiosk-dashboard:not([hidden])');
    await startQuizMatch(host.page, guest.page);
    await kiosk.waitForSelector('#kiosk-game-content .kiosk-game-question');

    await finishQuizMatch(host.page);
    await guest.page.waitForSelector('#quiz-back');
    await guest.page.click('#quiz-back');
    await guest.page.waitForSelector('.arcade-tiles');

    await host.page.click('[data-game="snake"]');
    await host.page.waitForSelector('#snake-create:not([disabled])');
    await host.page.click('#snake-create');
    await guest.page.click('[data-game="snake"]');
    await guest.page.waitForSelector('[data-snake-join]');
    await guest.page.click('[data-snake-join]');
    await host.page.waitForSelector('#snake-start:not([disabled])');
    await host.page.click('#snake-start');
    // Freeze the continuously rendered match before asserting the kiosk transition. Otherwise
    // every game tick can replace the finish button while Playwright is trying to click it.
    await host.page.dispatchEvent('#snake-pause', 'click');
    await host.page.waitForSelector('.snake-overlay');

    await kiosk.waitForSelector('#kiosk-game-content canvas');
    assert.equal(await kiosk.locator('#kiosk-game-content .kiosk-game-question').count(), 0);

    await host.page.click('#snake-finish');
    await host.page.waitForSelector('#snake-back');
    await host.page.click('#snake-back');
  } finally {
    await kiosk.close();
    await host.context.close();
    await guest.context.close();
  }
});

arcadeTest('snake-arena', 'Snake Arena elimination status updates in spectator and kiosk legends', async () => {
  const players = await Promise.all([
    createPlayer('Snake Status Host'),
    createPlayer('Snake Status Zwei'),
    createPlayer('Snake Status Drei'),
    createPlayer('Snake Status Zuschauer'),
  ]);
  const actors = await Promise.all(players.map((player) => openArcadeAs(player.id)));
  const [host, guest, leaver, spectator] = actors;
  const kiosk = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  try {
    await kiosk.goto(`${BASE_URL}/kiosk.html?token=${E2E_KIOSK_TOKEN}`);
    await kiosk.waitForSelector('#kiosk-dashboard:not([hidden])');

    await openArcadeGame(host.page, 'snake', '#snake-mode [data-arcade-mode="arena"]');
    await host.page.click('#snake-mode [data-arcade-mode="arena"]');
    await host.page.click('#snake-create');

    for (const actor of [guest, leaver]) {
      await openArcadeGame(actor.page, 'snake', '[data-snake-join]');
      await actor.page.waitForSelector('[data-snake-join]');
      await actor.page.click('[data-snake-join]');
    }
    await host.page.waitForSelector('#snake-start:not([disabled])');
    await host.page.click('#snake-start');
    await host.page.waitForSelector('#snake-pause');
    await host.page.click('#snake-pause');
    await host.page.waitForSelector('.snake-overlay');

    await kiosk.waitForSelector('#kiosk-game-content .snake-arena-legend');
    await spectator.page.waitForSelector('[data-watch-match]');
    await spectator.page.click('[data-watch-match]');
    await spectator.page.waitForTimeout(500);
    assert.equal(
      await activeView(spectator.page),
      'arcadeWatch',
      (await spectator.page.locator('.toast').last().textContent().catch(() => null)) ?? 'watch view closed without an error',
    );
    await spectator.page.waitForSelector('.snake-arena-legend');

    // The arena can advance between the 50ms test countdown and the pause
    // button becoming clickable, so either the host or the other guest may be
    // the stable survivor. Capture an actually living non-leaver after the
    // pause, then keep verifying that exact player on every readonly view.
    const racingPlayerName = await spectator.page.locator('.snake-arena-legend-item').evaluateAll(
      (items, candidateNames) => candidateNames.find((name) => items.some((item) => item.textContent?.includes(`${name} · Im Rennen`))) ?? null,
      [players[0].name, players[1].name]
    );
    assert.ok(racingPlayerName, 'expected a paused host or guest to remain in the race');

    await leaver.page.waitForSelector('#snake-leave-match');
    await leaver.page.click('#snake-leave-match');
    await leaver.page.click('[data-confirm]');

    for (const page of [spectator.page, kiosk]) {
      await page.waitForFunction((playerName) => Array.from(document.querySelectorAll('.snake-arena-legend-item')).some(
        (item) => item.textContent?.includes(playerName) && item.textContent.includes('Ausgeschieden')
      ), players[2].name);
      const legendItems = await page.locator('.snake-arena-legend-item').allTextContents();
      assert.ok(legendItems.some((item) => item.includes(`${racingPlayerName} · Im Rennen`)));
      assert.ok(legendItems.some((item) => item.includes(`${players[2].name} · Ausgeschieden`)));
    }

    await host.page.click('#snake-finish');
    await host.page.waitForSelector('#snake-back');
    await host.page.click('#snake-back');
  } finally {
    await kiosk.close();
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

    // The running match shows up in the compact "Laufende Spiele" overview
    // with a join-to-watch action; the readonly watch view opens with the
    // quiz safe note (no question, no answer controls).
    await spectator.page.waitForSelector('.arcade-watch-list-row');
    await spectator.page.click('[data-watch-match]');
    await spectator.page.waitForSelector('.arcade-watch-safe-note');
    assert.equal(await activeView(spectator.page), 'arcadeWatch');

    // Ending the match must push the watcher back to the Arcade on its own —
    // previously the watch view could hang around dead until a reload.
    await finishQuizMatch(host.page);
    await spectator.page.waitForFunction(
      () => (document.getElementById('view-container') as HTMLElement | null)?.dataset.view === 'arcade'
    );
    // ...and the finished match must vanish from the overview list.
    await spectator.page.waitForFunction(() => document.querySelectorAll('.arcade-watch-list-row').length === 0);
  } finally {
    await host.context.close();
    await guest.context.close();
    await spectator.context.close();
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
    await spectator.page.waitForSelector('.arcade-watch-safe-note');

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
    await host.page.click('[data-game="quiz"]');
    await host.page.waitForSelector('#quiz-create-lobby:not([disabled])');
    // Five clicks as fast as the UI allows, without awaiting the acks in
    // between — the server-side membership guard must collapse the burst
    // into exactly one lobby. Depending on broadcast timing a click can hit
    // the "already in a lobby" confirm dialog instead; both paths are part
    // of the spam scenario, so short timeouts + catch keep the burst going.
    for (let i = 0; i < 5; i += 1) {
      await host.page.click('#quiz-create-lobby', { timeout: 500 }).catch(() => undefined);
    }
    // Dismiss any leave-confirmations the spam happened to open.
    while ((await host.page.locator('[data-cancel]').count()) > 0) {
      await host.page.click('[data-cancel]', { timeout: 500 }).catch(() => undefined);
      await host.page.waitForTimeout(100);
    }
    await host.page.waitForSelector('[data-close-lobby]');
    await host.page.waitForTimeout(400); // let every ack/broadcast settle
    assert.equal(await host.page.locator('[data-close-lobby]').count(), 1, 'the burst must leave exactly one own lobby');
    const lobbies = (await (
      await fetch(`${BASE_URL}/api/arcade/lobbies`, { headers: { cookie: adminCookie } })
    ).json()) as { lobbies: unknown[] };
    assert.equal(lobbies.lobbies.length, 1, 'the server must hold exactly one open lobby after the burst');

    if ((await guest.page.locator('[data-join-lobby]').count()) === 0) await guest.page.click('[data-game="quiz"]');
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
    await host.page.waitForSelector('.arcade-lobby-member-role:has-text("Mitspieler")');

    await host.page.click('[data-close-lobby]');
    await host.page.waitForSelector('text=Keine offene Quiz-Lobby.');
  } finally {
    await host.context.close();
    await guest.context.close();
  }
});

arcadeTest('multiplayer', 'expanded Tetris keeps the page free of horizontal scroll and the board aligned', async () => {
  const hostPlayer = await createPlayer('Tetris Host');
  const guestPlayer = await createPlayer('Tetris Gast');

  // Wide-but-short desktop viewport: exactly the shape where the expanded
  // layout previously overflowed sideways (decorative glow) and misaligned
  // its overlays.
  const host = await openArcadeAs(hostPlayer.id, { viewport: { width: 1280, height: 640 }, expanded: true });
  const guest = await openArcadeAs(guestPlayer.id);
  try {
    await host.page.click('[data-game="tetris"]');
    await host.page.waitForSelector('#tetris-create:not([disabled])');
    await host.page.click('#tetris-create');
    if ((await guest.page.locator('[data-tetris-join]').count()) === 0) await guest.page.click('[data-game="tetris"]');
    await guest.page.waitForSelector('[data-tetris-join]');
    await guest.page.click('[data-tetris-join]');
    await guest.page.waitForSelector('[data-tetris-ready][data-ready="1"]');
    await guest.page.click('[data-tetris-ready][data-ready="1"]');
    await host.page.waitForSelector('#tetris-start:not([disabled])');
    await host.page.click('#tetris-start');

    await host.page.waitForSelector('.arcade-game-shell.is-expanded #tetris-boards');
    // The saved preference applied before the first render — and the page
    // must not scroll sideways (the ::before glow used to protrude).
    const scroll = await host.page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    assert.ok(
      scroll.scrollWidth <= scroll.clientWidth,
      `expanded Tetris must not introduce horizontal page scroll (scrollWidth ${scroll.scrollWidth} > clientWidth ${scroll.clientWidth})`
    );

    // Overlay geometry: the absolute layers (fx/overlay/incoming) position
    // against .tetris-canvas-wrap, so the wrap must hug the visible canvas.
    await host.page.waitForSelector('.tetris-canvas');
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

    await host.page.click('#tetris-finish');
    await host.page.click('[data-confirm]');
    await host.page.waitForSelector('#tetris-back');
    await host.page.click('#tetris-back');
  } finally {
    await host.context.close();
    await guest.context.close();
  }
});

arcadeTest('multiplayer', 'Tetris Arena supports four ready players with one large local board and three opponent boards', async () => {
  const players = await Promise.all(
    ['Arena Browser Host', 'Arena Browser Zwei', 'Arena Browser Drei', 'Arena Browser Vier'].map(createPlayer),
  );
  const actors = await Promise.all(players.map((player) => openArcadeAs(player.id)));
  const [host, ...guests] = actors;
  let hostClosed = false;
  try {
    await host.page.click('[data-game="tetris"]');
    await host.page.waitForSelector('#tetris-mode [data-arcade-mode="arena"]');
    await host.page.click('#tetris-mode [data-arcade-mode="arena"]');
    await host.page.waitForSelector('#tetris-create:not([disabled])');
    await host.page.click('#tetris-create');

    for (const guest of guests) {
      if ((await guest.page.locator('[data-tetris-join]').count()) === 0) await guest.page.click('[data-game="tetris"]');
      await guest.page.waitForSelector('[data-tetris-join]');
      await guest.page.click('[data-tetris-join]');
      await guest.page.waitForSelector('[data-tetris-ready][data-ready="1"]');
      await guest.page.click('[data-tetris-ready][data-ready="1"]');
    }

    await host.page.waitForSelector('#tetris-start:not([disabled])');
    await host.page.click('#tetris-start');
    await host.page.waitForSelector('.tetris-boards.is-arena');
    assert.equal(await host.page.locator('.tetris-canvas').count(), 4);
    assert.equal(await host.page.locator('.tetris-primary-board .tetris-canvas').count(), 1);
    assert.equal(await host.page.locator('.tetris-opponent-grid .tetris-canvas').count(), 3);

    const layout = await host.page.evaluate(() => {
      const primary = document.querySelector('.tetris-primary-board .tetris-canvas') as HTMLElement;
      const opponent = document.querySelector('.tetris-opponent-grid .tetris-canvas') as HTMLElement;
      return {
        primaryWidth: primary.getBoundingClientRect().width,
        opponentWidth: opponent.getBoundingClientRect().width,
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      };
    });
    assert.ok(layout.primaryWidth > layout.opponentWidth);
    assert.ok(layout.scrollWidth <= layout.clientWidth);

    await host.page.locator('.tetris-primary-board .tetris-canvas').evaluate((canvas) => {
      canvas.dataset.renderIdentity = 'before-pause';
    });
    await host.page.click('#tetris-pause');
    await host.page.waitForSelector('#tetris-resume');
    assert.equal(
      await host.page.locator('.tetris-primary-board .tetris-canvas').getAttribute('data-render-identity'),
      'before-pause',
      'pausing must update controls/overlay without replacing the live canvas',
    );
    await host.context.close();
    hostClosed = true;
    await guests[0].page.waitForSelector('#tetris-resume');
    await guests[0].page.click('#tetris-resume');
    await guests[0].page.waitForSelector('#tetris-finish');
    await guests[0].page.click('#tetris-finish');
    await guests[0].page.click('[data-confirm]');
    await guests[0].page.waitForSelector('#tetris-back');
    // Regression guard: the end-of-match ranking must reuse the shared roster
    // tile (avatar + full name) instead of a bare two-column row, which used
    // to squeeze every name into a 24px avatar-sized column and truncate it
    // down to a single letter (e.g. "T…", "B…").
    const rosterNames = await guests[0].page
      .locator('.arcade-winner-card .arcade-player-tile-body strong')
      .allTextContents();
    assert.equal(rosterNames.length, 4);
    for (const player of players) assert.ok(rosterNames.includes(player.name), `missing full name for ${player.name}`);
  } finally {
    if (!hostClosed) await host.context.close();
    for (const actor of guests) await actor.context.close();
  }
});

arcadeTest('multiplayer', 'Blobby Doppel: mobile lobby assigns two full teams and starts four players', async () => {
  const players = await Promise.all([
    createPlayer('Blobby Blau Host'),
    createPlayer('Blobby Blau Zwei'),
    createPlayer('Blobby Pink Eins'),
    createPlayer('Blobby Pink Zwei'),
  ]);
  const actors = await Promise.all(players.map((player) => openArcadeAs(player.id)));

  try {
    for (const actor of actors) {
      await actor.page.click('[data-game="blobby"]');
      await actor.page.waitForSelector('#blobby-create');
    }
    const [host, blue, pinkA, pinkB] = actors;
    assert.equal(await host.page.locator('#blobby-mode [data-arcade-mode="duel"]').getAttribute('aria-pressed'), 'true');
    await host.page.click('#blobby-mode [data-arcade-mode="doubles"]');
    assert.equal(await host.page.locator('#blobby-mode [data-arcade-mode="doubles"]').getAttribute('aria-pressed'), 'true');
    await host.page.click('#blobby-create');
    await host.page.waitForSelector('text=Team Blau');
    await host.page.waitForSelector('text=Team Pink');
    await host.page.waitForSelector('#blobby-start:disabled');

    await blue.page.waitForSelector('[data-blobby-team="left"]');
    await blue.page.click('[data-blobby-team="left"]');
    await blue.page.waitForSelector('[data-blobby-ready][data-ready="1"]');
    await blue.page.click('[data-blobby-ready][data-ready="1"]');

    for (const actor of [pinkA, pinkB]) {
      await actor.page.waitForSelector('[data-blobby-team="right"]');
      await actor.page.click('[data-blobby-team="right"]');
      await actor.page.waitForSelector('[data-blobby-ready][data-ready="1"]');
      await actor.page.click('[data-blobby-ready][data-ready="1"]');
    }

    await host.page.waitForSelector('#blobby-start:not([disabled])');
    assert.equal(await host.page.locator('.arcade-lobby-member-row .player-name').count(), 4);
    await host.page.click('#blobby-start');

    for (const actor of actors) {
      await actor.page.waitForSelector('#blobby-canvas');
      await actor.page.waitForSelector('.arcade-player-tile');
      assert.equal(await actor.page.locator('.arcade-player-tile').count(), 4);
    }
  } finally {
    await Promise.all(actors.map((actor) => actor.context.close()));
  }
});

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
    for (const actor of actors) {
      await actor.page.click('[data-game="pong"]');
      await actor.page.waitForSelector('#pong-create');
    }
    const [host, blue, pinkA, pinkB] = actors;
    assert.equal(await host.page.locator('#pong-mode [data-arcade-mode="duel"]').getAttribute('aria-pressed'), 'true');
    await host.page.click('#pong-mode [data-arcade-mode="doubles"]');
    assert.equal(await host.page.locator('#pong-mode [data-arcade-mode="doubles"]').getAttribute('aria-pressed'), 'true');
    await host.page.click('#pong-create');
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
      assert.equal(await actor.page.locator('.arcade-player-tile').count(), 4);
    }
  } finally {
    await Promise.all(actors.map((actor) => actor.context.close()));
  }
});

arcadeTest('scribble', 'Scribble: expanded canvas keeps 8:5 and its rapid toggle state stays synchronized', async () => {
  const hostPlayer = await createPlayer('Scribble Geometrie Host');
  const guestPlayer = await createPlayer('Scribble Geometrie Gast');

  // Short desktop viewport so the height cap (100dvh - 18rem) is what limits
  // the expanded playfield — the code path that used to distort the canvas.
  const host = await openArcadeAs(hostPlayer.id, { viewport: { width: 1280, height: 640 }, expanded: true });
  const guest = await openArcadeAs(guestPlayer.id);
  try {
    await startScribbleMatch(host.page, [guest.page], 1);
    await host.page.waitForSelector('.scribble-word-choice-btn');
    await host.page.locator('.scribble-word-choice-btn').first().click();
    await host.page.waitForSelector('#scribble-canvas');

    const geometry = await host.page.evaluate(() => {
      const canvas = document.querySelector('#scribble-canvas') as HTMLCanvasElement;
      const wrap = canvas.closest('.scribble-canvas-wrap') as HTMLElement;
      return {
        expanded: !!canvas.closest('.arcade-game-shell.is-expanded'),
        canvasWidth: canvas.clientWidth,
        canvasHeight: canvas.clientHeight,
        wrapWidth: wrap.clientWidth,
        wrapHeight: wrap.clientHeight,
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      };
    });
    assert.equal(geometry.expanded, true, 'the saved expand preference must apply to the Scribble room');
    assert.ok(
      Math.abs(geometry.canvasHeight - geometry.wrapHeight) <= 2,
      `the canvas must fill the 8:5 wrapper (canvas ${geometry.canvasHeight}px vs wrap ${geometry.wrapHeight}px high)`
    );
    const ratio = geometry.canvasWidth / geometry.canvasHeight;
    assert.ok(Math.abs(ratio - 1.6) < 0.05, `expanded Scribble canvas must stay at 8:5 (got ${ratio.toFixed(3)})`);
    assert.ok(geometry.scrollWidth <= geometry.clientWidth, 'expanded Scribble must not scroll sideways');

    for (let i = 0; i < 7; i += 1) await host.page.click('[data-arcade-expand]');
    const toggleState = await host.page.evaluate(() => ({
      pressed: document.querySelector('[data-arcade-expand]')?.getAttribute('aria-pressed'),
      expanded: !!document.querySelector('.arcade-game-shell.is-expanded'),
      stored: localStorage.getItem('lan-arcade-expanded'),
    }));
    assert.equal(toggleState.pressed, String(toggleState.expanded), 'button state must match the shell state');
    assert.equal(toggleState.stored, String(toggleState.expanded), 'persisted preference must match the shell state');
    await finishScribbleMatch(host.page);
  } finally {
    await Promise.all([host.context.close(), guest.context.close()]);
  }
});

arcadeTest('scribble', 'Scribble: live thumbs-up stays synchronized and the next round starts blank', async () => {
  const hostPlayer = await createPlayer('Scribble Maler');
  const guestPlayer = await createPlayer('Scribble Rater');
  const spectatorPlayer = await createPlayer('Scribble Zuschauer');

  const host = await openArcadeAs(hostPlayer.id);
  const guest = await openArcadeAs(guestPlayer.id);
  const spectator = await openArcadeAs(spectatorPlayer.id);
  try {
    await startScribbleMatch(host.page, [guest.page], 2);

    // Round 1, turn 1: the host draws.
    await host.page.waitForSelector('.scribble-word-choice-btn');
    await guest.page.waitForSelector('#scribble-countdown');
    assert.match((await guest.page.locator('#scribble-countdown').textContent()) ?? '', /^\d+s$/);
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

    await guest.page.fill('#scribble-guess-input', 'zzzz-kein-scribble-wort-zzzz');
    await guest.page.locator('#scribble-guess-form').evaluate((form) => (form as HTMLFormElement).requestSubmit());
    await guest.page.waitForFunction(
      () => document.getElementById('scribble-guess-feedback')?.textContent === 'Noch nicht richtig.',
    );

    await guest.page.fill('#scribble-guess-input', firstWord);
    await guest.page.locator('#scribble-guess-form').evaluate((form) => (form as HTMLFormElement).requestSubmit());
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
    await host.page.locator('#scribble-guess-form').evaluate((form) => (form as HTMLFormElement).requestSubmit());
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
