import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, ChildProcess } from 'child_process';
import path from 'path';
import { chromium, Browser, BrowserContext, Page } from 'playwright';

const PORT = 3916; // 3915 = battleship
const BASE_URL = `http://localhost:${PORT}`;
let serverProcess: ChildProcess;
let browser: Browser;

async function waitForServer(): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < 10_000) {
    try { if ((await fetch(`${BASE_URL}/api/health`)).ok) return; } catch { /* startup */ }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error('Challenge-Rush-E2E-Server wurde nicht bereit.');
}

async function createPlayer(): Promise<string> {
  const name = `Challenge Rush E2E ${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const response = await fetch(`${BASE_URL}/api/players`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name }) });
  assert.equal(response.status, 201);
  return ((await response.json()) as { id: string }).id;
}

async function openArcade(playerId: string): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  // This file's tests run at the busiest point of the whole e2e suite (right after Battleship's
  // now audio-synthesizing duel specs), so the default 30s action timeout is more exposed to CI
  // CPU contention than elsewhere. Each game view opens its own fresh socket.io connection lazily
  // on first use (see socket.js), and a contended CPU can make even that initial handshake take
  // multiple 20s connect-timeout/backoff cycles — 60s already proved insufficient in one real CI
  // run, so this goes further; it has no bearing on what's actually being asserted.
  page.setDefaultTimeout(90_000);
  await page.goto(BASE_URL);
  await page.evaluate((id) => localStorage.setItem('respawn_my_player_id', id), playerId);
  await page.reload();
  await page.click('.nav-btn[data-view="more"]');
  await page.click('[data-navigate="arcade"]');
  await page.waitForSelector('.arcade-tiles');
  return { context, page };
}

before(async () => {
  serverProcess = spawn('node', [path.join(__dirname, '..', '..', '..', 'dist', 'index.js')], { env: { ...process.env, PORT: String(PORT), DB_FILE: ':memory:', ACCESS_TOKEN: '' }, stdio: 'ignore' });
  await waitForServer();
  browser = await chromium.launch();
});

after(async () => { await browser?.close(); serverProcess?.kill(); });

test('Challenge Rush pauses active time and reconnects the same match', async () => {
  const actor = await openArcade(await createPlayer());
  try {
    await actor.page.click('[data-game="challenge-rush"]');
    await actor.page.click('#cr-create');
    await actor.page.waitForSelector('[data-cr-start]');
    await actor.page.click('[data-cr-start]');
    await actor.page.waitForSelector('.challenge-rush-stage');
    await actor.page.waitForSelector('[data-cr-pause]');
    await actor.page.waitForFunction(() => { const node = document.querySelector('.challenge-rush-stage'); return node?.getAttribute('data-phase') === 'playing' && Number(node.getAttribute('data-remaining-ms')) > 0; });
    const beforePause = await actor.page.locator('.challenge-rush-stage').evaluate((node) => ({
      matchId: node.getAttribute('data-match-id'), challengeIndex: node.getAttribute('data-challenge-index'), remainingMs: Number(node.getAttribute('data-remaining-ms')),
    }));
    await actor.page.click('[data-cr-pause]');
    await actor.page.waitForFunction(() => document.body.textContent?.includes('Pause') === true);
    const paused = await actor.page.locator('.challenge-rush-stage').evaluate((node) => ({
      matchId: node.getAttribute('data-match-id'), challengeIndex: node.getAttribute('data-challenge-index'), remainingMs: Number(node.getAttribute('data-remaining-ms')),
    }));
    assert.equal(paused.matchId, beforePause.matchId);
    assert.equal(paused.challengeIndex, beforePause.challengeIndex);
    assert.ok(paused.remainingMs > 0 && paused.remainingMs <= beforePause.remainingMs);
    await actor.page.waitForTimeout(1_000);
    assert.equal(Number(await actor.page.locator('.challenge-rush-stage').getAttribute('data-remaining-ms')), paused.remainingMs);

    // Resume, let real time pass while actually playing, then pause again to
    // snapshot a genuinely decreased remaining time (the display itself only
    // refreshes on transitions/actions, so a fresh pause is how this reads
    // the post-resume value instead of waiting for the round to run out).
    await actor.page.click('[data-cr-pause]');
    await actor.page.waitForFunction(() => document.querySelector('.challenge-rush-stage')?.getAttribute('data-phase') === 'playing');
    await actor.page.waitForTimeout(500);
    await actor.page.click('[data-cr-pause]');
    await actor.page.waitForFunction((remaining) => Number(document.querySelector('.challenge-rush-stage')?.getAttribute('data-remaining-ms')) < remaining, paused.remainingMs);
    const resumedThenPaused = await actor.page.locator('.challenge-rush-stage').evaluate((node) => ({
      matchId: node.getAttribute('data-match-id'), challengeIndex: node.getAttribute('data-challenge-index'), remainingMs: Number(node.getAttribute('data-remaining-ms')),
    }));
    assert.equal(resumedThenPaused.matchId, beforePause.matchId);
    assert.equal(resumedThenPaused.challengeIndex, beforePause.challengeIndex);

    await actor.page.click('[data-cr-pause]');
    await actor.page.waitForFunction(() => document.querySelector('.challenge-rush-stage')?.getAttribute('data-phase') === 'playing');

    await actor.page.evaluate(() => window.dispatchEvent(new Event('respawn:challenge-rush-disconnect')));
    await actor.page.waitForFunction(() => document.querySelector('.challenge-rush-stage')?.getAttribute('data-disconnected') === 'true');
    await actor.page.evaluate(() => window.dispatchEvent(new Event('respawn:challenge-rush-connect')));
    await actor.page.waitForFunction((expected) => { const node = document.querySelector('.challenge-rush-stage'); return node?.getAttribute('data-reconnected') === 'true' && node.getAttribute('data-match-id') === expected.matchId && node.getAttribute('data-challenge-index') === expected.challengeIndex; }, beforePause);
  } finally {
    await actor.context.close();
  }
});

test('Challenge Rush hides the reaction target until play, gates the next challenge behind a ready click, and ends with a per-challenge summary', async () => {
  const actor = await openArcade(await createPlayer());
  try {
    await actor.page.click('[data-game="challenge-rush"]');

    // First challenge is always reaction-circle (fixed CHALLENGES order): its target must stay
    // invisible during the countdown and only appear once play begins. In E2E_FAST_TIMERS mode the
    // countdown is only 50ms, and Playwright's default waitForFunction polling runs on
    // requestAnimationFrame — under real CI CPU contention, whole animation frames can be skipped,
    // silently missing a state that transient. A MutationObserver installed before the match even
    // starts fires synchronously on every DOM mutation regardless of frame scheduling, so it can't
    // miss the circle appearing even for a single render.
    await actor.page.evaluate(() => {
      (window as unknown as { __crViolation: boolean }).__crViolation = false;
      const observer = new MutationObserver(() => {
        const node = document.querySelector('.challenge-rush-stage');
        if (node?.getAttribute('data-phase') !== 'playing' && document.querySelector('.challenge-rush-circle')) {
          (window as unknown as { __crViolation: boolean }).__crViolation = true;
        }
      });
      observer.observe(document.body, { childList: true, subtree: true, attributes: true });
      (window as unknown as { __crObserver: MutationObserver }).__crObserver = observer;
    });

    await actor.page.click('#cr-create');
    await actor.page.waitForSelector('[data-cr-start]');
    await actor.page.click('[data-cr-start]');
    await actor.page.waitForSelector('.challenge-rush-circle');
    assert.equal(await actor.page.evaluate(() => (window as unknown as { __crViolation: boolean }).__crViolation), false);
    await actor.page.click('.challenge-rush-circle');

    // The result stays on screen until the player explicitly clicks ready — no automatic advance.
    await actor.page.waitForSelector('#cr-ready-next');
    await actor.page.waitForTimeout(200);
    assert.equal(await actor.page.locator('.challenge-rush-stage').count(), 0);
    await actor.page.click('#cr-ready-next');
    await actor.page.waitForFunction(() => document.querySelector('.challenge-rush-stage')?.getAttribute('data-challenge-index') === '1');

    await actor.page.waitForSelector('[data-cr-finish]');
    await actor.page.click('[data-cr-finish]');
    await actor.page.click('.modal [data-confirm]');

    await actor.page.waitForSelector('.challenge-rush-final-breakdown');
    const breakdown = await actor.page.locator('.challenge-rush-final-breakdown').first().textContent();
    assert.ok(breakdown?.includes('Klick den Kreis'));
  } finally {
    await actor.context.close();
  }
});

// Drives one round of whichever challenge is currently active based on the
// stage's data-challenge-key, exercising every Phase 3 renderer's real click
// wiring in a browser instead of just the socket protocol (already covered
// by the integration tests in api.challengeRush.test.ts).
//
// Every loop below re-checks isStillPlaying(key) before each click instead of
// only checking "does my target selector still exist": several challenges
// (memory-sequence, odd-one-out, whack-a-mole) share the generic
// `.challenge-rush-tile` class, so once a round ends the *next* challenge's
// tiles can satisfy a stale selector and a queued click would silently land
// on the wrong challenge instead of failing loudly.
async function isStillPlaying(page: Page, key: string): Promise<boolean> {
  return (await page.locator(`.challenge-rush-stage[data-phase="playing"][data-challenge-key="${key}"]`).count()) > 0;
}

async function playCurrentChallenge(page: Page): Promise<void> {
  const key = await page.locator('.challenge-rush-stage').getAttribute('data-challenge-key');
  if (!key) throw new Error('Keine aktive Challenge im E2E-Test gefunden.');
  if (key === 'reaction-circle' || key === 'aim-trainer') {
    while (await isStillPlaying(page, key) && await page.locator('.challenge-rush-circle').count() > 0) { await page.click('.challenge-rush-circle'); await page.waitForTimeout(80); }
    return;
  }
  if (key === 'cps') { await page.click('.challenge-rush-big-button:not([data-cr-stop])'); return; }
  if (key === 'number-salad') {
    const numbers = await page.locator('.challenge-rush-number').evaluateAll((nodes) => nodes.map((node) => Number(node.getAttribute('data-cr-number'))).sort((a, b) => a - b));
    for (const value of numbers) { if (!(await isStillPlaying(page, key))) break; await page.click(`.challenge-rush-number[data-cr-number="${value}"]`); await page.waitForTimeout(80); }
    return;
  }
  if (key === 'timing-10') { await page.click('[data-cr-stop]'); return; }
  if (key === 'memory-sequence') {
    await page.waitForSelector('.challenge-rush-tile:not([disabled])');
    const tileCount = await page.locator('.challenge-rush-tile').count();
    for (let index = 0; index < tileCount; index += 1) { if (!(await isStillPlaying(page, key))) break; await page.click(`.challenge-rush-tile[data-cr-tile="${index}"]`); await page.waitForTimeout(80); }
    return;
  }
  if (key === 'odd-one-out') { await page.click('.challenge-rush-tile.is-odd'); return; }
  if (key === 'whack-a-mole') {
    for (let attempt = 0; attempt < 10 && await isStillPlaying(page, key) && await page.locator('.challenge-rush-tile.is-active').count() > 0; attempt += 1) { await page.click('.challenge-rush-tile.is-active'); await page.waitForTimeout(80); }
    return;
  }
  if (key === 'traffic-light') { await page.click('[data-cr-traffic]'); return; }
  if (key === 'color-word') {
    for (let attempt = 0; attempt < 8 && await isStillPlaying(page, key) && await page.locator('.challenge-rush-color-option').count() > 0; attempt += 1) { await page.locator('.challenge-rush-color-option').first().click(); await page.waitForTimeout(80); }
    return;
  }
  throw new Error(`Unbekannte Challenge im E2E-Test: ${key}`);
}

test('Challenge Rush plays every Phase 3 mini-challenge to a final summary in the browser', async () => {
  const actor = await openArcade(await createPlayer());
  try {
    await actor.page.click('[data-game="challenge-rush"]');
    await actor.page.click('#cr-create');
    await actor.page.waitForSelector('[data-cr-start]');
    await actor.page.click('[data-cr-start]');

    for (let index = 0; index < 10; index += 1) {
      await actor.page.waitForFunction((expectedIndex) => {
        const node = document.querySelector('.challenge-rush-stage');
        return node?.getAttribute('data-phase') === 'playing' && node.getAttribute('data-challenge-index') === String(expectedIndex);
      }, index);
      await playCurrentChallenge(actor.page);
      await actor.page.waitForSelector('#cr-ready-next:not([disabled])');
      await actor.page.click('#cr-ready-next');
    }

    await actor.page.waitForSelector('.challenge-rush-final-breakdown');
    const titles = await actor.page.locator('.challenge-rush-final-breakdown').first().textContent();
    for (const title of ['Klick den Kreis', 'Aim Trainer', 'Merk dir die Reihenfolge', 'Finde den Unterschied', 'Whack-a-Mole', 'Ampel-Reaktion', 'Farbwort-Chaos']) {
      assert.ok(titles?.includes(title), `Ergebnis-Aufschlüsselung sollte "${title}" enthalten`);
    }
  } finally {
    await actor.context.close();
  }
});

test('Challenge Rush lets a guest leave a running match without ending it for the host', async () => {
  const hostId = await createPlayer();
  const guestId = await createPlayer();
  const host = await openArcade(hostId);
  const guest = await openArcade(guestId);
  try {
    await host.page.click('[data-game="challenge-rush"]');
    await host.page.click('#cr-create');
    await guest.page.click('[data-game="challenge-rush"]');
    await guest.page.waitForSelector('[data-cr-join]');
    await guest.page.click('[data-cr-join]');
    await guest.page.waitForSelector('[data-cr-ready]');
    await guest.page.click('[data-cr-ready]');
    await host.page.waitForSelector('[data-cr-start]:not([disabled])');
    await host.page.click('[data-cr-start]');
    await guest.page.waitForSelector('.challenge-rush-stage');
    await guest.page.waitForFunction(() => document.querySelector('.challenge-rush-stage')?.getAttribute('data-phase') === 'playing');

    await guest.page.waitForSelector('[data-cr-leave-match]');
    await guest.page.click('[data-cr-leave-match]');
    await guest.page.click('.modal [data-confirm]');

    await host.page.waitForFunction(() => document.body.textContent?.includes('Forfait') === true);
    assert.equal(await host.page.locator('.challenge-rush-stage').count(), 1);
  } finally {
    await host.context.close();
    await guest.context.close();
  }
});
