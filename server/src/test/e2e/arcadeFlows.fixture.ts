// Browser E2E test: drives the real built server + real Chromium through the
// main click paths (personal login, players, matchmaking, voting,
// leaderboard, game admin, tournament). Separate from the fast
// unit/integration suite (`npm test`) — run via `npm run test:e2e` since it
// spawns a server process and a browser, which is much slower.

import { test, before, after, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import type { ChildProcess } from 'child_process';
import { chromium, Browser, Page } from 'playwright';
import { normalizeAnswer } from '../../arcade/quizLogic';
import { laidOutRect } from './canvasHelpers';
import {
  addSessionCookie,
  authenticatedServerEnv,
  createE2EAccount,
  E2E_ADMIN_PASSWORD,
  loginE2EAdmin,
  type E2EAccount,
} from './authHelpers';
import { StatefulE2EDiagnosticGuard, trackE2EContext } from './e2eDiagnostics';
import { startE2EServer, type E2EServer } from './e2eServer';
import { selectArcadeGame } from './arcadeHelpers';

let BASE_URL: string;

// Arcade cross-view scenarios use a dedicated stateful fixture and process.
// Core changes therefore do not start this suite, and Arcade changes never
// need to execute the unrelated Core cross-view scenarios.
let serverProcess: ChildProcess;
let e2eServer: E2EServer;
let browser: Browser;
let page: Page;
let adminCookie: string;
let alice: E2EAccount;
let bob: E2EAccount;
let analyticsPlayer: E2EAccount | undefined;
const accountsByName = new Map<string, E2EAccount>();
const flowDiagnostics = new StatefulE2EDiagnosticGuard(
  () => ({ browser, server: e2eServer }),
  { sharedState: 'server, browser context, and page' },
);

type ArcadeFlowShard = 'smoke' | 'full';

const arcadeFlowShard = process.env.E2E_ARCADE_FLOW_SHARD as ArcadeFlowShard | undefined;
if (!arcadeFlowShard || !['smoke', 'full'].includes(arcadeFlowShard)) {
  throw new Error(`Unbekannter Arcade-Flow-Shard: ${arcadeFlowShard ?? '(fehlt)'}`);
}

function arcadeFlowTest(
  shard: ArcadeFlowShard,
  name: string,
  fn: (context: TestContext) => void | Promise<void>,
): void {
  if (arcadeFlowShard === shard) {
    test(name, { concurrency: false }, (context) =>
      flowDiagnostics.run(context, name, () => fn(context)),
    );
  }
}

async function waitForArcadeStylesheet(targetPage: Page): Promise<void> {
  await targetPage.waitForSelector('#arcade-stylesheet[href="/css/arcade.css?v=6"]', { state: 'attached' });
  await targetPage.waitForFunction(() => {
    const link = document.querySelector('#arcade-stylesheet');
    return link instanceof HTMLLinkElement && link.sheet !== null;
  });
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
  alice = await bootstrapAdminAccount('E2E Alice Pro');
  bob = await createE2EAccount(BASE_URL, adminCookie, 'E2E Bob');
  accountsByName.set(alice.name, alice);
  accountsByName.set('E2E Alice Pro', alice);
  accountsByName.set(bob.name, bob);
  analyticsPlayer = await createE2EAccount(BASE_URL, adminCookie, 'Analytics E2E Player');
  accountsByName.set(analyticsPlayer.name, analyticsPlayer);
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
  assert.equal(await page.locator('#arcade-stylesheet').count(), 0);
});

after(async () => {
  await browser?.close();
  serverProcess?.kill();
});

arcadeFlowTest('smoke', 'Arcade: open a quiz lobby, see it on Home, then close it again', async (t) => {
  const guestContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await trackE2EContext(guestContext, 'arcade-smoke-guest');
  const guestPage = await guestContext.newPage();
  t.after(async () => guestContext.close());
  await addSessionCookie(guestContext, BASE_URL, bob.cookie);
  await guestPage.goto(BASE_URL);
  await guestPage.waitForSelector('.nav-btn[data-view="home"]');

  await page.click('.nav-btn[data-view="more"]');
  await page.click('[data-navigate="arcade"]');
  await waitForArcadeStylesheet(page);
  // Arcade is a launcher; select the quiz tile before its lobby controls
  // become visible (module state is intentionally reset on a fresh run).
  await selectArcadeGame(page, 'quiz');
  await page.waitForSelector('#quiz-create-lobby');
  const mobileInsets = await page.locator('#quiz-create-lobby').evaluate((button) => {
    const buttonRect = button.getBoundingClientRect();
    const rowRect = button.closest('.arcade-lobby-create-row')!.getBoundingClientRect();
    return {
      left: Math.round(buttonRect.left - rowRect.left),
      right: Math.round(rowRect.right - buttonRect.right),
    };
  });
  assert.deepEqual(mobileInsets, { left: 0, right: 0 });

  const mobileViewport = page.viewportSize();
  await page.setViewportSize({ width: 1280, height: 800 });
  const createButtonLayout = async (selector: string) => {
    await page.waitForFunction((candidate) => {
      const button = document.querySelector(candidate);
      return Boolean(button && button.getClientRects().length > 0);
    }, selector);
    return page.locator(selector).evaluate((button) => {
      const buttonRect = button.getBoundingClientRect();
      const cardRect = button.closest('.arcade-lobby-card')!.getBoundingClientRect();
      return {
        left: Math.round(buttonRect.left - cardRect.left),
        right: Math.round(cardRect.right - buttonRect.right),
        top: Math.round(buttonRect.top - cardRect.top),
        width: Math.round(buttonRect.width),
        height: Math.round(buttonRect.height),
      };
    });
  };
  const noModeLayout = await createButtonLayout('#quiz-create-lobby');
  assert.ok(Math.abs(noModeLayout.left - noModeLayout.right) <= 1, 'the no-mode create action must be centered');
  await selectArcadeGame(page, 'scribble');
  await page.waitForSelector('#scribble-create');
  assert.deepEqual(await createButtonLayout('#scribble-create'), noModeLayout);

  const duelDefaults = [
    ['tetris', '#tetris-create', '#tetris-mode [data-arcade-mode="duel"]'],
    ['pong', '#pong-create', '#pong-mode [data-arcade-mode="duel"]'],
    ['snake', '#snake-create', '#snake-mode [data-arcade-mode="classic"]'],
    ['blobby', '#blobby-create', '#blobby-mode [data-arcade-mode="duel"]'],
  ] as const;
  let modeLayout: Awaited<ReturnType<typeof createButtonLayout>> | null = null;
  for (const [game, createSelector, duelSelector] of duelDefaults) {
    await selectArcadeGame(page, game);
    await page.waitForSelector(createSelector);
    assert.equal(await page.locator(duelSelector).getAttribute('aria-pressed'), 'true');
    const currentLayout = await createButtonLayout(createSelector);
    if (modeLayout) assert.deepEqual(currentLayout, modeLayout);
    else modeLayout = currentLayout;
  }

  if (mobileViewport) await page.setViewportSize(mobileViewport);
  await selectArcadeGame(page, 'quiz');
  await page.waitForSelector('#quiz-create-lobby');
  await page.click('#quiz-create-lobby');
  await page.waitForSelector('[data-close-lobby]');
  assert.equal(await page.locator('.arcade-game-picker').isVisible(), true);
  assert.equal(await page.locator('.arcade-tiles').isVisible(), true);

  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.waitForFunction(() => document.documentElement.dataset.layoutMode === 'desktop');
  const ownedLobbyLayout = await page.evaluate(() => {
    const activeGame = document.querySelector('[aria-labelledby="arcade-active-game-title"]')?.getBoundingClientRect();
    const gamePicker = document.querySelector('.arcade-game-picker')?.getBoundingClientRect();
    const gameGrid = document.querySelector('.arcade-tiles');
    if (!activeGame || !gamePicker || !gameGrid) return null;
    return {
      activeLeft: Math.round(activeGame.left),
      activeTop: Math.round(activeGame.top),
      pickerLeft: Math.round(gamePicker.left),
      pickerBottom: Math.round(gamePicker.bottom),
      gameColumns: getComputedStyle(gameGrid).gridTemplateColumns.split(' ').length,
    };
  });
  assert.ok(ownedLobbyLayout);
  assert.equal(ownedLobbyLayout.pickerLeft, ownedLobbyLayout.activeLeft);
  assert.ok(ownedLobbyLayout.pickerBottom < ownedLobbyLayout.activeTop);
  assert.equal(ownedLobbyLayout.gameColumns, 3);
  if (mobileViewport) await page.setViewportSize(mobileViewport);

  await guestPage.click('#notifications-btn');
  await guestPage.waitForSelector('#notifications-panel:has-text("Neue Quiz-Lobby")');
  await guestPage.click('[data-notification-close]');

  // The open lobby also shows up on Home as a compact "Aktuell" row that
  // deep-links back into the Arcade (the whole row is the tap target, not a
  // separate labeled button — see statusRowHtml in home.js). No tile click
  // needed there: the launcher force-expands the game whose lobby you're in.
  await page.click('.nav-btn[data-view="home"]');
  await page.waitForSelector('#arcade-stylesheet', { state: 'detached' });
  await page.click('button:has-text("Gaming-Quiz-Lobby offen")');
  await page.waitForSelector('#arcade-active-game-title:has-text("Gaming-Quiz")');

  // The host sees their own lobby with a "Schließen" button instead of a
  // join button/"Drin" badge - closing was previously impossible (the only
  // way to get rid of a lobby was to disconnect the socket, e.g. by closing
  // the tab), leaving abandoned lobbies listed forever.
  await page.waitForSelector('[data-close-lobby]');

  // An open lobby must not lock the launcher to its game. The host can still
  // inspect another game's lobbies and return without closing their own.
  await selectArcadeGame(page, 'tetris');
  await page.waitForSelector('#tetris-create');
  await selectArcadeGame(page, 'quiz');
  await page.waitForSelector('[data-close-lobby]');

  await page.click('[data-close-lobby]');
  await page.waitForSelector('text=Keine offene Quiz-Lobby.');

  // Closed - the create button is enabled again.
  await page.waitForSelector('#quiz-create-lobby:not([disabled])');
});

arcadeFlowTest('full', 'Arcade: joining Pong or Blobby closes the owned lobby and keeps Blobby team choice', async () => {
  await page.click('.nav-btn[data-view="more"]');
  await page.click('[data-navigate="arcade"]');
  await waitForArcadeStylesheet(page);

  const guestContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await trackE2EContext(guestContext, 'arcade-lobby-guest');
  const guestPage = await guestContext.newPage();
  try {
    await addSessionCookie(guestContext, BASE_URL, bob.cookie);
    await guestPage.goto(BASE_URL);
    await guestPage.waitForSelector('.nav-btn[data-view="more"]');
    await guestPage.click('.nav-btn[data-view="more"]');
    await guestPage.click('[data-navigate="arcade"]');
    await waitForArcadeStylesheet(guestPage);

    for (const game of ['pong', 'blobby'] as const) {
      if ((await page.locator('#quiz-create-lobby').count()) === 0) await selectArcadeGame(page, 'quiz');
      await page.waitForSelector('#quiz-create-lobby:not([disabled])');
      await page.click('#quiz-create-lobby');
      await page.waitForSelector('[data-close-lobby]');

      // Opening another lobby uses the same guarded switch flow.
      await selectArcadeGame(page, 'tetris');
      await page.click('#tetris-create');
      await page.waitForSelector('text=Wenn du eine neue Lobby öffnest, wird deine eigene Lobby aufgelöst.');
      await page.click('[data-cancel]');
      await selectArcadeGame(page, 'quiz');
      await page.waitForSelector('[data-close-lobby]');

      await selectArcadeGame(guestPage, game);
      await guestPage.waitForSelector(`#${game}-create:not([disabled])`);
      if (game === 'blobby') {
        assert.equal(
          await guestPage.locator('#blobby-mode [data-arcade-mode="duel"]').getAttribute('aria-pressed'),
          'true',
        );
        await guestPage.click('#blobby-mode [data-arcade-mode="doubles"]');
        assert.equal(
          await guestPage.locator('#blobby-mode [data-arcade-mode="doubles"]').getAttribute('aria-pressed'),
          'true',
        );
      }
      await guestPage.click(`#${game}-create`);
      const targetStateHandle = await guestPage.waitForFunction((gameName) => {
        const visibleSelects = Array.from(document.querySelectorAll<HTMLSelectElement>(
          `.arcade-lobby-control-bar select[name="${gameName}-target"]`,
        )).flatMap((select) => {
          const bounds = select.getBoundingClientRect();
          return bounds.width > 0 && bounds.height > 0
            ? [{ value: select.value, height: Math.round(bounds.height) }]
            : [];
        });
        return visibleSelects.length > 0
          ? { visibleCount: visibleSelects.length, ...visibleSelects[0] }
          : null;
      }, game);
      const targetState = await targetStateHandle.jsonValue();
      await targetStateHandle.dispose();
      // Snapshot value and geometry atomically: a realtime re-render can hide
      // the matched select between two otherwise independent locator reads.
      assert.deepEqual(targetState, { visibleCount: 1, value: '7', height: 32 });

      await selectArcadeGame(page, game);
      const joinSelector = game === 'blobby'
        ? '[data-blobby-join][data-blobby-team="right"]'
        : '[data-pong-join]';
      await page.waitForSelector(joinSelector);
      await page.click(joinSelector);
      await page.waitForSelector('text=Wenn du dieser Lobby beitrittst, wird deine eigene Lobby aufgelöst.');

      // Cancelling must keep the owned lobby intact.
      await page.click('[data-cancel]');
      await selectArcadeGame(page, 'quiz');
      await page.waitForSelector('[data-close-lobby]');

      await selectArcadeGame(page, game);
      await page.click(joinSelector);
      await page.click('[data-confirm]');
      await page.waitForSelector(`[data-${game}-leave]`);
      if (game === 'blobby') {
        const pinkPlayers = await page
          .locator('.two-column-card-grid > .stack')
          .filter({ hasText: 'Team Pink' })
          .locator('.player-name')
          .allTextContents();
        assert.deepEqual(pinkPlayers, [alice.name]);
      }
      assert.deepEqual(
        await page.locator('.arcade-lobby-entry-actions > button').allTextContents(),
        ['Verlassen', 'Bereit?'],
      );

      await selectArcadeGame(page, 'quiz');
      await page.waitForSelector('text=Keine offene Quiz-Lobby.');

      await guestPage.waitForSelector(`[data-${game}-close]`);
      await guestPage.click(`[data-${game}-close]`);
      await selectArcadeGame(page, game);
      await page.waitForSelector(`text=Keine offene ${game === 'pong' ? 'Pong' : 'Blobby-Volley'}-Lobby.`);
    }
  } finally {
    // Keep the shared host page usable after a failed assertion instead of
    // letting a switch confirmation intercept every later scenario.
    await page.keyboard.press('Escape');
    if ((await page.locator('[data-game="quiz"]').count()) > 0) {
      if ((await page.locator('#quiz-create-lobby').count()) === 0) await selectArcadeGame(page, 'quiz');
      const closeOwnedLobby = page.locator('[data-close-lobby]:visible');
      if ((await closeOwnedLobby.count()) > 0) {
        await closeOwnedLobby.click();
        await page.waitForSelector('text=Keine offene Quiz-Lobby.');
      }
    }
    await guestContext.close();
  }
});

arcadeFlowTest('full', 'Arcade: a lobby guest flags themselves ready and the host sees it', async () => {
  // Reuses "E2E Bob" (added earlier) as the guest on a second device — see
  // the Scribble test below for why the roster must not grow here.
  const guestContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await trackE2EContext(guestContext, 'arcade-ready-guest');
  const guestPage = await guestContext.newPage();
  guestPage.on('pageerror', (err) => console.error('[guest pageerror]', err.message));
  try {
    await addSessionCookie(guestContext, BASE_URL, bob.cookie);
    await guestPage.goto(BASE_URL);
    await guestPage.waitForSelector('.nav-btn[data-view="more"]');
    await guestPage.click('.nav-btn[data-view="more"]');
    await guestPage.click('[data-navigate="arcade"]');
    await selectArcadeGame(guestPage, 'quiz');

    // Host opens the lobby, guest joins. The quiz tile is a toggle and the
    // previous test left its panel expanded — only click it if it's closed.
    if ((await page.locator('#quiz-create-lobby').count()) === 0) await selectArcadeGame(page, 'quiz');
    await page.waitForSelector('#quiz-create-lobby:not([disabled])');
    await page.click('#quiz-create-lobby');
    await guestPage.waitForSelector('[data-join-lobby]');
    await guestPage.click('[data-join-lobby]');

    // Freshly joined guests are not ready; readiness lives in the member
    // rows (no summary sentence anymore, see DESIGN_SYSTEM.md arcade rules).
    await page.waitForSelector('.arcade-lobby-member-row:has-text("E2E Bob"):has-text("Mitspieler")');

    // Guest flags ready -> host sees the member row flip to "Bereit".
    await guestPage.waitForSelector('[data-quiz-ready][data-ready="1"]');
    await guestPage.click('[data-quiz-ready][data-ready="1"]');
    await page.waitForSelector('.arcade-lobby-member-row:has-text("E2E Bob") .arcade-lobby-member-role:has-text("Bereit")');

    // The toggle works both ways: un-ready shows up at the host again.
    await guestPage.waitForSelector('[data-quiz-ready][data-ready="0"]');
    await guestPage.click('[data-quiz-ready][data-ready="0"]');
    await page.waitForSelector('.arcade-lobby-member-row:has-text("E2E Bob"):has-text("Mitspieler")');
  } finally {
    // Leave no lobby behind for the tests that follow.
    await page.click('[data-close-lobby]');
    await page.waitForSelector('text=Keine offene Quiz-Lobby.');
    await guestContext.close();
  }
});

arcadeFlowTest('full', 'Arcade: a non-player can watch a running quiz without seeing the question', async () => {
  assert.ok(analyticsPlayer, 'expected the analytics spectator account to exist');

  const guestContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const spectatorContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await trackE2EContext(guestContext, 'arcade-quiz-guest');
  await trackE2EContext(spectatorContext, 'arcade-quiz-spectator');
  const guestPage = await guestContext.newPage();
  const spectatorPage = await spectatorContext.newPage();
  try {
    await addSessionCookie(guestContext, BASE_URL, bob.cookie);
    await guestPage.goto(BASE_URL);
    await guestPage.waitForSelector('.nav-btn[data-view="more"]');
    await guestPage.click('.nav-btn[data-view="more"]');
    await guestPage.click('[data-navigate="arcade"]');
    await selectArcadeGame(guestPage, 'quiz');

    if ((await page.locator('#quiz-create-lobby').count()) === 0) await selectArcadeGame(page, 'quiz');
    await page.waitForSelector('#quiz-create-lobby:not([disabled])');
    await page.click('#quiz-create-lobby');
    await guestPage.waitForSelector('[data-join-lobby]');
    await guestPage.click('[data-join-lobby]');
    await page.waitForSelector('#quiz-start-lobby:not([disabled])');
    await guestPage.waitForSelector('[data-quiz-ready][data-ready="1"]');
    await guestPage.click('[data-quiz-ready][data-ready="1"]');
    await page.waitForSelector('.arcade-lobby-member-row:has-text("E2E Bob") .arcade-lobby-member-role:has-text("Bereit")');
    await page.click('#quiz-start-lobby');
    await page.waitForSelector('#quiz-answer-form');

    await addSessionCookie(spectatorContext, BASE_URL, analyticsPlayer.cookie);
    await spectatorPage.goto(BASE_URL);
    await spectatorPage.waitForSelector('.nav-btn[data-view="more"]');
    await spectatorPage.click('.nav-btn[data-view="more"]');
    await spectatorPage.click('[data-navigate="arcade"]');
    await spectatorPage.waitForSelector('[data-watch-match]');
    await spectatorPage.click('[data-watch-match]');
    await spectatorPage.waitForSelector('.arcade-watch-safe-note');
    assert.equal(await spectatorPage.locator('#arcade-watch-canvas').count(), 0, 'quiz watchers do not receive a question canvas');
    assert.equal(await spectatorPage.locator('#quiz-answer-form').count(), 0, 'watchers must not receive answer controls');
  } finally {
    if (await page.locator('#quiz-finish').count()) {
      await page.click('#quiz-finish');
      if (await page.locator('[data-confirm]').count()) await page.click('[data-confirm]');
      await page.waitForSelector('#quiz-back', { timeout: 5000 }).catch(() => undefined);
      if (await page.locator('#quiz-back').count()) await page.click('#quiz-back');
    }
    await guestContext.close();
    await spectatorContext.close();
  }
});

arcadeFlowTest('full', 'Arcade: Scribble - host draws, a second device guesses correctly, both see the reveal', async () => {
  // Unlike the quiz/draft flows above, Scribble strictly gates who may act
  // (only the current drawer can choose a word/draw, only raters may guess —
  // enforced both client- and server-side), so one session cannot drive both
  // sides. A second real browser context, logged in as a
  // second player, is the only way to exercise the actual guess path.
  // Reuses "E2E Bob" (added by the earlier click-through test) rather than
  // adding a fresh roster player — the Captain-Draft test later in this
  // suite has a hardcoded pick-loop bound tied to the pool size, so growing
  // the roster here would silently break it.
  assert.ok(analyticsPlayer, 'expected the analytics spectator account to exist');

  const guesserContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const spectatorContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await trackE2EContext(guesserContext, 'arcade-scribble-guesser');
  await trackE2EContext(spectatorContext, 'arcade-scribble-spectator');
  const guesserPage = await guesserContext.newPage();
  const spectatorPage = await spectatorContext.newPage();
  guesserPage.on('pageerror', (err) => console.error('[guesser pageerror]', err.message));
  spectatorPage.on('pageerror', (err) => console.error('[spectator pageerror]', err.message));
  try {
    await addSessionCookie(guesserContext, BASE_URL, bob.cookie);
    await guesserPage.goto(BASE_URL);
    await guesserPage.waitForSelector('.nav-btn[data-view="more"]');
    await guesserPage.click('.nav-btn[data-view="more"]');
    await guesserPage.click('[data-navigate="arcade"]');
    await selectArcadeGame(guesserPage, 'scribble');

    await addSessionCookie(spectatorContext, BASE_URL, analyticsPlayer.cookie);
    await spectatorPage.goto(BASE_URL);
    await spectatorPage.waitForSelector('.nav-btn[data-view="more"]');
    await spectatorPage.click('.nav-btn[data-view="more"]');
    await spectatorPage.click('[data-navigate="arcade"]');

    // Host (the shared device driving `page` through this whole suite) opens
    // the lobby — draw order is lobby join order, so the host always draws
    // first, keeping this test deterministic about who does what.
    await page.click('.nav-btn[data-view="more"]');
    await page.click('[data-navigate="arcade"]');
    await selectArcadeGame(page, 'scribble');
    await page.waitForSelector('#scribble-create:not([disabled])');
    await page.click('#scribble-create');

    await guesserPage.waitForSelector('[data-scribble-join]');
    await guesserPage.click('[data-scribble-join]');

    await page.waitForSelector('#scribble-start:not([disabled])');
    await page.check('input[name="scribble-rounds"][value="1"]');
    await page.click('#scribble-start');

    // A third, non-participating player watches the same match. Their saved
    // identity may vote, but receives neither the word nor guess controls.
    await spectatorPage.waitForSelector('[data-watch-match]');
    await spectatorPage.click('[data-watch-match]');
    await spectatorPage.waitForSelector('.arcade-watch-safe-note');

    // Host picks a word — the actual text is only ever shown to the drawer,
    // never sent to the guesser (see scribble.ts), so capture it from the
    // button label before it disappears.
    await page.waitForSelector('.scribble-word-choice-btn');
    const wordBtn = page.locator('.scribble-word-choice-btn').first();
    const chosenWord = (await wordBtn.textContent())!.trim();
    await wordBtn.click();
    await spectatorPage.waitForSelector('#arcade-watch-canvas');
    assert.equal(await spectatorPage.locator('.scribble-word-mask').count(), 0, 'watchers must never receive the word mask');
    assert.equal(await spectatorPage.locator('#scribble-guess-form').count(), 0, 'watchers must never receive guess controls');
    assert.equal(await spectatorPage.getByText(chosenWord, { exact: true }).count(), 0, 'watchers must never receive the real word');

    // The guesser must never see the plain word, only the underscore mask.
    await guesserPage.waitForSelector('.scribble-word-mask');
    const guesserMask = await guesserPage.locator('.scribble-word-mask').textContent();
    assert.ok(!guesserMask?.includes(chosenWord), 'the guesser must not see the real word before guessing');

    const box = await laidOutRect(page, '#scribble-canvas');
    await page.mouse.move(box.x + 20, box.y + 20);
    await page.mouse.down();
    await page.mouse.move(box.x + 120, box.y + 90, { steps: 8 });
    await page.mouse.up();

    await page.waitForFunction(() => Number(document.querySelector('#scribble-canvas')?.getAttribute('data-scribble-stroke-count') ?? 0) >= 1);
    await guesserPage.waitForFunction(() => Number(document.querySelector('#scribble-canvas')?.getAttribute('data-scribble-stroke-count') ?? 0) >= 1);
    await spectatorPage.waitForFunction(() => {
      const canvas = document.querySelector('#arcade-watch-canvas') as HTMLCanvasElement | null;
      if (!canvas) return false;
      const data = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
      for (let i = 0; i < data.length; i += 4) {
        if (data[i] !== data[0] || data[i + 1] !== data[1] || data[i + 2] !== data[2]) return true;
      }
      return false;
    });

    // A watcher-list refresh belongs to the Arcade overview and must not
    // rebuild a running game's view. Before this regression guard, the
    // overview socket recreated Scribble's canvas here and erased its first
    // streamed stroke (the intermittent CI failure this flow covers).
    await guesserPage.evaluate(
      () =>
        new Promise<void>((resolve, reject) => {
          const probe = (window as any).io();
          const timeout = setTimeout(() => {
            probe.close();
            reject(new Error('watch-list probe timed out'));
          }, 5_000);
          probe.once('connect', () => {
            probe.emit('scope:subscribe', { groupId: 'default-group', eventId: 'instance-base-event' }, (result: { error?: string }) => {
              if (result?.error) {
                clearTimeout(timeout);
                probe.close();
                reject(new Error(result.error));
                return;
              }
              probe.once('arcade:watch:list', () => {
                clearTimeout(timeout);
                probe.close();
                setTimeout(resolve, 0);
              });
              probe.emit('arcade:watch:list');
            });
          });
        })
    );
    assert.ok(
      Number(await guesserPage.locator('#scribble-canvas').getAttribute('data-scribble-stroke-count')) >= 1,
      'Arcade watch-list updates must not reset the active Scribble canvas'
    );

    // The stroke must reach the guesser's canvas too (streamed over
    // Socket.IO, not part of the initial render).
    await guesserPage.waitForFunction(() => {
      const c = document.querySelector('#scribble-canvas') as HTMLCanvasElement | null;
      if (!c) return false;
      const data = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
      for (let i = 3; i < data.length; i += 4) if (data[i] !== 0) return true;
      return false;
    });

    const countPainted = (p: typeof page) =>
      p.evaluate(() => {
        const c = document.querySelector('#scribble-canvas') as HTMLCanvasElement;
        const data = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
        let n = 0;
        for (let i = 3; i < data.length; i += 4) if (data[i] !== 0) n++;
        return n;
      });
    // The guesser must receive the whole stroke, not just fragments. Both
    // pages use the same viewport (and thus canvas size), so the painted
    // areas are directly comparable — a regression that drops the connecting
    // segments between the per-frame network batches (leaving isolated dots)
    // paints an order of magnitude less than the drawer's own canvas. Waits
    // (instead of asserting a snapshot) because the batches stream in over
    // several socket messages after the first pixel appears.
    const hostPaintedAfterStroke1 = await countPainted(page);
    await guesserPage.waitForFunction(
      (hostPainted) => {
        const c = document.querySelector('#scribble-canvas') as HTMLCanvasElement;
        const data = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
        let n = 0;
        for (let i = 3; i < data.length; i += 4) if (data[i] !== 0) n++;
        return n >= hostPainted * 0.5;
      },
      hostPaintedAfterStroke1
    );
    const guesserPaintedAfterStroke1 = await countPainted(guesserPage);

    // A second, separate pen stroke (well clear of the first, kept inside
    // the small viewport used here) - Rückgängig must undo this whole
    // stroke, not just a fragment of it (a visible stroke is split into many
    // small network batches, see scribble.ts's strokeId grouping). Re-queries
    // the canvas position fresh rather than reusing `box`, in case anything
    // shifted the layout since the first stroke.
    const box2 = await laidOutRect(page, '#scribble-canvas');
    await page.mouse.move(box2.x + 200, box2.y + 20);
    await page.mouse.down();
    await page.mouse.move(box2.x + 260, box2.y + 60, { steps: 8 });
    await page.mouse.up();
    await page.waitForFunction(() => Number(document.querySelector('#scribble-canvas')?.getAttribute('data-scribble-stroke-count') ?? 0) >= 2);
    await guesserPage.waitForFunction(
      (before) => {
        const c = document.querySelector('#scribble-canvas') as HTMLCanvasElement | null;
        if (!c) return false;
        const data = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
        let n = 0;
        for (let i = 3; i < data.length; i += 4) if (data[i] !== 0) n++;
        return n > before;
      },
      guesserPaintedAfterStroke1
    );
    await guesserPage.waitForFunction(() => Number(document.querySelector('#scribble-canvas')?.getAttribute('data-scribble-stroke-count') ?? 0) >= 2);
    const guesserPaintedAfterStroke2 = await countPainted(guesserPage);
    const hostPaintedAfterStroke2 = await countPainted(page);

    await page.click('#scribble-undo');
    await page.waitForFunction(() => Number(document.querySelector('#scribble-canvas')?.getAttribute('data-scribble-stroke-count') ?? 0) === 1);
    await guesserPage.waitForFunction(() => Number(document.querySelector('#scribble-canvas')?.getAttribute('data-scribble-stroke-count') ?? 0) === 1);
    await page.waitForFunction(
      (before) => {
        const c = document.querySelector('#scribble-canvas') as HTMLCanvasElement;
        const data = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
        let n = 0;
        for (let i = 3; i < data.length; i += 4) if (data[i] !== 0) n++;
        return n < before;
      },
      hostPaintedAfterStroke2
    );
    await guesserPage.waitForFunction(
      (before) => {
        const c = document.querySelector('#scribble-canvas') as HTMLCanvasElement;
        const data = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
        let n = 0;
        for (let i = 3; i < data.length; i += 4) if (data[i] !== 0) n++;
        return n < before;
      },
      guesserPaintedAfterStroke2
    );
    await page.waitForFunction(() => {
      const c = document.querySelector('#scribble-canvas') as HTMLCanvasElement | null;
      if (!c) return false;
      const data = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
      for (let i = 3; i < data.length; i += 4) if (data[i] !== 0) return true;
      return false;
    });
    await guesserPage.waitForFunction(() => {
      const c = document.querySelector('#scribble-canvas') as HTMLCanvasElement | null;
      if (!c) return false;
      const data = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
      for (let i = 3; i < data.length; i += 4) if (data[i] !== 0) return true;
      return false;
    });
    // Undo removed the whole second stroke on both sides - what's left
    // should be (roughly) just the first stroke again, not an empty canvas.
    const hostPaintedAfterUndo = await countPainted(page);
    const guesserPaintedAfterUndo = await countPainted(guesserPage);
    assert.ok(hostPaintedAfterUndo > 0, 'undo must not wipe the whole canvas');
    assert.ok(guesserPaintedAfterUndo > 0, 'undo must not wipe the whole canvas for the guesser either');

    // Füllen (paint bucket): most of the canvas is still empty, so filling
    // from any point there floods a large connected area - re-queries the
    // canvas position fresh since clicking the toolbar (below the canvas)
    // can auto-scroll the page and shift it.
    await page.click('[data-color="#e03131"]');
    await page.click('#scribble-fill');
    const box3 = await laidOutRect(page, '#scribble-canvas');
    await page.mouse.click(box3.x + 280, box3.y + 20);
    await guesserPage.waitForFunction((before) => {
      const c = document.querySelector('#scribble-canvas') as HTMLCanvasElement | null;
      if (!c) return false;
      const data = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
      let n = 0;
      for (let i = 3; i < data.length; i += 4) if (data[i] !== 0) n++;
      return n > before;
    }, guesserPaintedAfterUndo);
    await page.waitForFunction(() => Number(document.querySelector('#scribble-canvas')?.getAttribute('data-scribble-stroke-count') ?? 0) === 2);
    await guesserPage.waitForFunction(() => Number(document.querySelector('#scribble-canvas')?.getAttribute('data-scribble-stroke-count') ?? 0) === 2);
    const hostPaintedAfterFill = await countPainted(page);
    assert.ok(hostPaintedAfterFill > hostPaintedAfterUndo + 1000, 'fill must flood a large area, not just paint a single pixel');

    await page.click('#scribble-undo');
    await page.waitForFunction(() => Number(document.querySelector('#scribble-canvas')?.getAttribute('data-scribble-stroke-count') ?? 0) === 1);
    await guesserPage.waitForFunction(() => Number(document.querySelector('#scribble-canvas')?.getAttribute('data-scribble-stroke-count') ?? 0) === 1);
    await page.waitForFunction(
      (before) => {
        const c = document.querySelector('#scribble-canvas') as HTMLCanvasElement;
        const data = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
        let n = 0;
        for (let i = 3; i < data.length; i += 4) if (data[i] !== 0) n++;
        return n < before;
      },
      hostPaintedAfterFill
    );
    assert.ok((await countPainted(page)) > 0, 'undoing the fill must not wipe the whole canvas either');

    // "Knapp dran": a wrong guess one edit away from the word gets private
    // feedback (via the socket ack, never broadcast) - only the guesser
    // should ever see it, not the drawer.
    const normalizedWord = normalizeAnswer(chosenWord);
    if (normalizedWord.length >= 4) {
      const mid = Math.floor(normalizedWord.length / 2);
      const closeTypo = normalizedWord.slice(0, mid) + normalizedWord.slice(mid + 1);
      await guesserPage.fill('#scribble-guess-input', closeTypo);
      await guesserPage.click('#scribble-guess-form button[type="submit"]');
      await guesserPage.waitForSelector('text=Knapp dran!');
      assert.equal(
        await page.locator('#toast-container .toast', { hasText: 'Knapp dran' }).count(),
        0,
        'the drawer must never see the close-guess hint meant for the guesser'
      );
    }

    await guesserPage.fill('#scribble-guess-input', chosenWord);
    await guesserPage.click('#scribble-guess-form button[type="submit"]');

    // Correct guess ends the turn immediately (both raters already guessed —
    // there's only one) and reveals the word to everyone.
    await page.waitForSelector(`text=Wort war: ${chosenWord}`);
    await guesserPage.waitForSelector(`text=Wort war: ${chosenWord}`);

    // The last drawing stays votable while the next turn begins - the
    // artist never sees their own thumb button; the guesser and the
    // spectator can each mark it, and the shared count updates live.
    await guesserPage.waitForSelector('#scribble-thumb');
    await guesserPage.click('#scribble-thumb');
    await guesserPage.waitForFunction(() => document.querySelector('[data-scribble-thumb-count]')?.textContent === '1');
    await spectatorPage.waitForSelector('#arcade-watch-thumb:not([disabled])');
    await spectatorPage.click('#arcade-watch-thumb');
    await guesserPage.waitForFunction(() => document.querySelector('[data-scribble-thumb-count]')?.textContent === '2');
    assert.equal(await spectatorPage.getByText(chosenWord, { exact: true }).count(), 0, 'the reveal word stays private from watchers');

    // Finish the second (and, with 1 round, last) turn - no round-gallery
    // pause anymore, the match completes straight after this turn's reveal.
    await guesserPage.waitForSelector('.scribble-word-choice-btn');
    const secondWordBtn = guesserPage.locator('.scribble-word-choice-btn').first();
    const secondWord = (await secondWordBtn.textContent())!.trim();
    await secondWordBtn.click();
    await page.waitForSelector('#scribble-guess-input');
    await page.fill('#scribble-guess-input', secondWord);
    await page.click('#scribble-guess-form button[type="submit"]');

    // The whole match ends; only the drawing marked with a thumb re-enters
    // the final, whole-match favorite vote (the second turn's drawing never
    // got a thumb, so exactly one card is offered) - it's the host's own,
    // so the host can't favorite it themselves; the guesser can.
    await page.waitForSelector('text=Match beendet');
    await guesserPage.waitForSelector('.scribble-drawing-card');
    assert.equal(await guesserPage.locator('.scribble-drawing-card').count(), 1, 'only the marked drawing re-enters the final vote');
    await guesserPage.click('[data-final-favorite]:not([disabled])');
    await guesserPage.waitForSelector('[data-final-favorite].btn-primary');

    await page.waitForSelector('#scribble-back');
    await page.click('#scribble-back');
    // With Scribble as the only completed Arcade game the existing stats UI
    // intentionally omits its one-item tab bar and opens it directly.
    await page.waitForSelector('text=Rundenbilder-Galerie');
    await page.waitForSelector('canvas[data-arcade-gallery-drawing]');
  } finally {
    await guesserContext.close();
    await spectatorContext.close();
  }
});
