// Browser E2E tests for the Arcade area: spectating running matches (list
// lifecycle, auto-redirect on match end, stale history entries), the
// expandable playfield geometry, and rapid-fire robustness (lobby-create
// bursts, ready-toggle spam). Complements the broader click-through suite in
// flows.e2e.test.ts — this file owns the Arcade-specific regressions from the
// spectator/expand work.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, ChildProcess } from 'child_process';
import path from 'path';
import { chromium, Browser, BrowserContext, Page } from 'playwright';

const PORT = 3903; // 3901 = flows, 3902 = access, 3910 = agent integration
const BASE_URL = `http://localhost:${PORT}`;

let serverProcess: ChildProcess;
let browser: Browser;

interface Actor {
  context: BrowserContext;
  page: Page;
}

async function waitForServer(url: string, timeoutMs = 10_000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      // not up yet, keep polling
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error(`Server at ${url} did not become ready in time`);
}

async function createPlayer(name: string): Promise<{ id: string; name: string }> {
  const res = await fetch(`${BASE_URL}/api/players`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  if (res.status !== 201) throw new Error(`creating player "${name}" failed: ${res.status}`);
  return res.json() as Promise<{ id: string; name: string }>;
}

// Opens a fresh context+page logged in (via localStorage identity) as the
// given player, already sitting on the Arcade view.
async function openArcadeAs(
  playerId: string,
  { viewport = { width: 390, height: 844 }, expanded = false } = {}
): Promise<Actor> {
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  page.on('pageerror', (err) => console.error('[pageerror]', err.message));
  await page.goto(BASE_URL);
  await page.evaluate(
    ({ id, expand }) => {
      localStorage.setItem('respawn_my_player_id', id);
      // The expand preference must already exist before the game view first
      // renders — that ordering is exactly what the geometry regressions
      // below are about (see wireArcadeExpandControl).
      localStorage.setItem('lan-arcade-expanded', String(expand));
    },
    { id: playerId, expand: expanded }
  );
  await page.reload();
  await page.waitForSelector('.nav-btn[data-view="more"]');
  // Freshly created players still broadcast players:changed refreshes that
  // re-render the "Mehr" view mid-click — retry the two-step navigation
  // instead of failing on a detached button.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await page.click('[data-view="more"]', { timeout: 4000 }).catch(() => undefined);
    try {
      await page.click('[data-navigate="arcade"]', { timeout: 4000 });
      await page.waitForSelector('.arcade-tiles', { timeout: 4000 });
      return { context, page };
    } catch {
      // late realtime re-render replaced the view — try again
    }
  }
  throw new Error('could not open the Arcade view');
}

function activeView(page: Page): Promise<string | undefined> {
  return page.evaluate(() => (document.getElementById('view-container') as HTMLElement | null)?.dataset.view);
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
  serverProcess = spawn('node', [path.join(__dirname, '..', '..', '..', 'dist', 'index.js')], {
    env: { ...process.env, PORT: String(PORT), DB_FILE: ':memory:', ACCESS_TOKEN: '' },
    stdio: 'ignore',
  });
  await waitForServer(`${BASE_URL}/api/health`);
  browser = await chromium.launch();
});

after(async () => {
  await browser?.close();
  serverProcess?.kill();
});

test('watch list: a finished match disappears and active watchers are sent back to the Arcade', async () => {
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

test('watch history: a stale watch entry redirects to the Arcade instead of hanging', async () => {
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
    await spectator.page.click('[data-view="home"]');
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

test('rapid fire: lobby-create burst keeps one lobby, ready toggle survives spam clicking', async () => {
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
    const lobbies = (await (await fetch(`${BASE_URL}/api/arcade/lobbies`)).json()) as { lobbies: unknown[] };
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

test('expanded Tetris keeps the page free of horizontal scroll and the board aligned', async () => {
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

test('Scribble: expanded canvas keeps 8:5, live thumbs-up survives a reconnect, new turn starts blank', async () => {
  const hostPlayer = await createPlayer('Scribble Maler');
  const guestPlayer = await createPlayer('Scribble Rater');
  const spectatorPlayer = await createPlayer('Scribble Zuschauer');

  // Short desktop viewport so the height cap (100dvh - 18rem) is what limits
  // the expanded playfield — the code path that used to distort the canvas.
  const host = await openArcadeAs(hostPlayer.id, { viewport: { width: 1280, height: 640 }, expanded: true });
  const guest = await openArcadeAs(guestPlayer.id);
  const spectator = await openArcadeAs(spectatorPlayer.id);
  try {
    await host.page.click('[data-game="scribble"]');
    await host.page.waitForSelector('#scribble-create:not([disabled])');
    await host.page.click('#scribble-create');
    if ((await guest.page.locator('[data-scribble-join]').count()) === 0) await guest.page.click('[data-game="scribble"]');
    await guest.page.waitForSelector('[data-scribble-join]');
    await guest.page.click('[data-scribble-join]');
    await host.page.waitForSelector('#scribble-start:not([disabled])');
    await host.page.check('input[name="scribble-rounds"][value="2"]');
    await host.page.click('#scribble-start');

    // Round 1, turn 1: the host draws.
    await host.page.waitForSelector('.scribble-word-choice-btn');
    const firstWordBtn = host.page.locator('.scribble-word-choice-btn').first();
    const firstWord = (await firstWordBtn.textContent())!.trim();
    await firstWordBtn.click();
    await host.page.waitForSelector('#scribble-canvas');

    // Geometry with the expand preference applied before the canvas mounted:
    // the drawable surface must fill the 8:5 wrapper exactly — a mismatch
    // means strokes replay distorted for everyone else.
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

    // The expand toggle itself must survive rapid clicking and stay in sync
    // (button state, shell class, persisted preference).
    for (let i = 0; i < 7; i += 1) {
      await host.page.click('[data-arcade-expand]');
    }
    const toggleState = await host.page.evaluate(() => ({
      pressed: document.querySelector('[data-arcade-expand]')?.getAttribute('aria-pressed'),
      expanded: !!document.querySelector('.arcade-game-shell.is-expanded'),
      stored: localStorage.getItem('lan-arcade-expanded'),
    }));
    assert.equal(toggleState.pressed, String(toggleState.expanded), 'button state must match the shell state');
    assert.equal(toggleState.stored, String(toggleState.expanded), 'persisted preference must match the shell state');
    // 7 toggles from "expanded" end collapsed; bring it back for the rest.
    if (!toggleState.expanded) await host.page.click('[data-arcade-expand]');
    await host.page.waitForSelector('.arcade-game-shell.is-expanded');

    // Draw something clearly visible, then let the guest guess correctly.
    const box = await host.page.locator('#scribble-canvas').boundingBox();
    await host.page.mouse.move(box!.x + 30, box!.y + 30);
    await host.page.mouse.down();
    await host.page.mouse.move(box!.x + 200, box!.y + 120, { steps: 10 });
    await host.page.mouse.up();
    await guest.page.waitForFunction(
      () => Number(document.querySelector('#scribble-canvas')?.getAttribute('data-scribble-stroke-count') ?? 0) >= 1
    );
    await guest.page.fill('#scribble-guess-input', firstWord);
    await guest.page.click('#scribble-guess-form button[type="submit"]');
    await host.page.waitForSelector(`text=Wort war: ${firstWord}`);

    // The just-finished drawing is still votable through 'reveal'/'choosing'
    // (up until the next word is chosen) — the guest marks it with a thumb.
    // (The host drew it, so their own thumbButtonHtml() stays hidden — the
    // count is only checked on the guest's page, which does render it.)
    await guest.page.waitForSelector('#scribble-thumb');
    await guest.page.click('#scribble-thumb');
    await guest.page.waitForFunction(
      () => document.querySelector('[data-scribble-thumb-count]')?.textContent === '1'
    );

    // The spectator follows along in the readonly watch view and may thumb too.
    await spectator.page.waitForSelector('[data-watch-match]');
    await spectator.page.click('[data-watch-match]');
    await spectator.page.waitForSelector('#arcade-watch-thumb:not([disabled])');

    // Guest briefly drops offline right after thumbing (network blip) — the
    // rejoin sync must not park the previous turn's strokes for the next
    // turn's blank canvas, and the vote window must still work afterwards.
    await guest.context.setOffline(true);
    await guest.page.waitForTimeout(600);
    await guest.context.setOffline(false);
    await spectator.page.click('#arcade-watch-thumb');
    await guest.page.waitForFunction(
      () => document.querySelector('[data-scribble-thumb-count]')?.textContent === '2'
    );

    // Turn 2: the guest draws, the host guesses — no round-gallery pause
    // anymore, the next word choice appears directly.
    await guest.page.waitForSelector('.scribble-word-choice-btn');
    const secondWordBtn = guest.page.locator('.scribble-word-choice-btn').first();
    const secondWord = (await secondWordBtn.textContent())!.trim();
    await secondWordBtn.click();
    await host.page.waitForSelector('#scribble-guess-input');
    await host.page.fill('#scribble-guess-input', secondWord);
    await host.page.click('#scribble-guess-form button[type="submit"]');

    await host.page.waitForSelector('.scribble-word-choice-btn', { timeout: 15_000 });
    const thirdWordBtn = host.page.locator('.scribble-word-choice-btn').first();
    await thirdWordBtn.click();
    await host.page.waitForSelector('#scribble-canvas');
    await guest.page.waitForSelector('#scribble-canvas');
    // Give any (buggy) replay a moment to paint before sampling the pixels.
    await guest.page.waitForTimeout(400);
    const guestPainted = await countPaintedPixels(guest.page, '#scribble-canvas');
    assert.equal(guestPainted, 0, 'the new round must start on a blank canvas — no replay of the previous drawing');
    const hostPainted = await countPaintedPixels(host.page, '#scribble-canvas');
    assert.equal(hostPainted, 0, 'the drawer must start on a blank canvas too');
  } finally {
    await host.context.close();
    await guest.context.close();
    await spectator.context.close();
  }
});
