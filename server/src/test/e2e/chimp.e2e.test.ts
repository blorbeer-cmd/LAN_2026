import { before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { ChildProcess } from 'child_process';
import { chromium, Browser, BrowserContext, Page } from 'playwright';
import { addSessionCookie, authenticatedServerEnv, createE2EAccount, loginE2EAdmin, waitForPlayerData } from './authHelpers';
import { openMoreViewEntry } from './navHelpers';
import { createE2EDiagnosticTest, trackE2EContext } from './e2eDiagnostics';
import { startE2EServer, type E2EServer } from './e2eServer';
import { assertNoOverflow } from './visualHelpers';
import { ARCADE_HUB, openArcadeLobby } from './arcadeHelpers';

let BASE_URL: string;
let serverProcess: ChildProcess;
let e2eServer: E2EServer;
let browser: Browser;
let adminCookie: string;
const playerCookies = new Map<string, string>();

interface Actor { context: BrowserContext; page: Page }

const test = createE2EDiagnosticTest(() => ({ browser, server: e2eServer }));

async function createPlayer(name: string): Promise<{ id: string; name: string }> {
  const account = await createE2EAccount(BASE_URL, adminCookie, name);
  playerCookies.set(account.id, account.cookie);
  return account;
}

// The Chimp Test is a regular game: plain members without Admin mode play it.
async function openArcadeAs(playerId: string, viewport: { width: number; height: number }): Promise<Actor> {
  const context = await browser.newContext({ viewport });
  await trackE2EContext(context, `chimp-${playerId}`);
  await addSessionCookie(context, BASE_URL, playerCookies.get(playerId)!);
  const page = await context.newPage();
  await page.goto(BASE_URL);
  await page.waitForSelector('.nav-btn[data-view="more"]');
  await waitForPlayerData(page);
  await openMoreViewEntry(page, '[data-navigate="arcade"]');
  await page.waitForSelector(ARCADE_HUB);
  return { context, page };
}

// Cell index of every visible number, in number order.
async function readNumbers(page: Page, count: number): Promise<number[]> {
  await page.waitForFunction((expected) => document.querySelectorAll('.chimp-cell.is-number').length === expected, count);
  const entries = await page.locator('.chimp-cell.is-number').evaluateAll((cells) =>
    cells.map((cell) => ({ cell: Number((cell as HTMLElement).dataset.chimpCell), number: Number(cell.textContent) })));
  return entries.sort((a, b) => a.number - b.number).map((entry) => entry.cell);
}

before(async () => {
  const server = await startE2EServer({ ...authenticatedServerEnv(), NODE_ENV: 'test', E2E_FAST_TIMERS: '1' });
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

test('Chimp Test: a shared round on phone and laptop, reveal on a mistake, round ranking and solo leaderboard', async () => {
  const hostPlayer = await createPlayer('Chimp E2E Host');
  const guestPlayer = await createPlayer('Chimp E2E Guest');
  const host = await openArcadeAs(hostPlayer.id, { width: 390, height: 844 });
  const guest = await openArcadeAs(guestPlayer.id, { width: 1024, height: 768 });
  try {
    await openArcadeLobby(host.page, 'chimp');
    await guest.page.waitForSelector('[data-chimp-join]');
    await guest.page.click('[data-chimp-join]');
    await guest.page.waitForSelector('[data-chimp-ready][data-ready="1"]');
    await guest.page.click('[data-chimp-ready][data-ready="1"]');
    await host.page.waitForSelector('[data-chimp-start]:not([disabled])');
    await host.page.click('[data-chimp-start]');

    // Phone: five columns that fill top to bottom; laptop: rows of eight.
    const hostLayout = await readNumbers(host.page, 4);
    const geometry = await host.page.locator('.chimp-cell').evaluateAll((cells) => cells.map((cell) => cell.getBoundingClientRect()).map((box) => ({ x: Math.round(box.x), y: Math.round(box.y), width: box.width, height: box.height })));
    assert.equal(geometry[0].x, geometry[1].x, 'phone grid flows column by column');
    assert.ok(geometry[8].x > geometry[0].x);
    assert.equal(new Set(geometry.map((box) => box.x)).size, 5);
    assert.ok(geometry.every((box) => box.width >= 44 && box.height >= 44), 'tiles keep the 44px touch target');
    await assertNoOverflow(host.page.locator('#view-container'));
    const guestGeometry = await guest.page.locator('.chimp-cell').evaluateAll((cells) => cells.map((cell) => Math.round(cell.getBoundingClientRect().y)));
    assert.equal(new Set(guestGeometry).size, 5, 'laptop grid has five rows of eight');

    // Tapping the 1 hides every other number at once.
    await host.page.click(`[data-chimp-cell="${hostLayout[0]}"]`);
    await host.page.waitForFunction(() => document.querySelectorAll('.chimp-cell.is-number').length === 0 && document.querySelectorAll('.chimp-cell.is-hidden').length === 3);
    for (const cell of hostLayout.slice(1)) await host.page.click(`[data-chimp-cell="${cell}"]`);
    await host.page.waitForSelector('.chimp-interstitial-title:has-text("4 Zahlen geschafft")');
    await host.page.click('[data-chimp-continue]');

    // A wrong first tap at level 5 reveals the solution to this player only.
    const levelFive = await readNumbers(host.page, 5);
    await host.page.click(`[data-chimp-cell="${levelFive[1]}"]`);
    await host.page.waitForSelector(`.chimp-cell.is-wrong[data-chimp-cell="${levelFive[1]}"]`);
    await host.page.waitForSelector('.chimp-note.is-danger:has-text("die 1 war dran")');
    assert.equal(await guest.page.locator('.chimp-cell.is-wrong, .chimp-cell.is-revealed').count(), 0);
    await host.page.waitForSelector('.chimp-interstitial-title:has-text("Strike 1 von 3")');

    // The laptop player uses the keyboard: arrows move along the row, Enter taps.
    const guestLayout = await readNumbers(guest.page, 4);
    await guest.page.locator('.chimp-cell[tabindex="0"]').focus();
    await guest.page.keyboard.press('ArrowRight');
    assert.equal(await guest.page.evaluate(() => (document.activeElement as HTMLElement | null)?.dataset.chimpCell), '1');
    await guest.page.locator(`[data-chimp-cell="${guestLayout[0]}"]`).focus();
    await guest.page.keyboard.press('Enter');
    await guest.page.waitForFunction(() => document.querySelectorAll('.chimp-cell.is-hidden').length === 3);

    // The host ends the round: both see the display-only round ranking.
    await host.page.click('[data-chimp-finish]');
    await host.page.click('.modal [data-confirm]');
    for (const actor of [host, guest]) {
      await actor.page.waitForSelector('.chimp-round .arcade-result-row >> nth=1');
      await actor.page.waitForSelector('.chimp-round-note:has-text("gezählt wird dein Solo-Ergebnis")');
      assert.equal(await actor.page.locator('.chimp-round .arcade-result-row.is-winner').count(), 0);
    }
    await guest.page.waitForSelector(`.chimp-round .arcade-result-row.is-me:has-text(${JSON.stringify(guestPlayer.name)})`);
    await host.page.waitForSelector('[data-chimp-result] .chimp-rating-label:has-text("44 % · Zoobesucher")');

    // The result links to the Chimp Test leaderboard in the Arcade statistics.
    await host.page.click('[data-chimp-leaderboard]');
    await host.page.waitForSelector(ARCADE_HUB);
    await host.page.waitForSelector(`.chimp-stats-row:has-text(${JSON.stringify(hostPlayer.name)})`);
    assert.equal(await host.page.locator('#arcade-stats-filter').inputValue(), 'chimp');
  } finally {
    await host.context.close();
    await guest.context.close();
  }
});
