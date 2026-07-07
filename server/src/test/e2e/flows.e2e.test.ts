// Browser E2E test: drives the real built server + real Chromium through the
// main click paths (players, matchmaking, voting, leaderboard). Separate from
// the fast unit/integration suite (`npm test`) — run via `npm run test:e2e`
// since it spawns a server process and a browser, which is much slower.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, ChildProcess } from 'child_process';
import path from 'path';
import { chromium, Browser, Page } from 'playwright';

const PORT = 3901;
const BASE_URL = `http://localhost:${PORT}`;

let serverProcess: ChildProcess;
let browser: Browser;
let page: Page;

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

before(async () => {
  serverProcess = spawn('node', [path.join(__dirname, '..', '..', '..', 'dist', 'index.js')], {
    env: { ...process.env, PORT: String(PORT), DB_FILE: ':memory:', ACCESS_TOKEN: '' },
    stdio: 'ignore',
  });
  await waitForServer(`${BASE_URL}/api/health`);
  // Use the browser pre-installed in this environment instead of triggering
  // a download (see PLAYWRIGHT_BROWSERS_PATH in the environment docs).
  browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  page = await browser.newPage({ viewport: { width: 390, height: 844 } });
});

after(async () => {
  await browser?.close();
  serverProcess?.kill();
});

test('full click-through: players, matchmaking, voting, leaderboard', async () => {
  await page.goto(BASE_URL);
  await page.waitForSelector('#app:not([hidden])');
  assert.equal(await page.textContent('.view-title'), 'Live-Status');

  // Add two players.
  await page.click('[data-view="players"]');
  await page.click('#add-player-btn');
  await page.fill('#new-player-name', 'E2E Alice');
  await page.click('#add-player-form button[type="submit"]');
  await page.waitForSelector('text=E2E Alice');

  await page.click('#add-player-btn');
  await page.fill('#new-player-name', 'E2E Bob');
  await page.click('#add-player-form button[type="submit"]');
  await page.waitForSelector('text=E2E Bob');

  // Player detail: API key loads.
  await page.click('button[data-player] >> text=E2E Alice');
  await page.waitForFunction(() => {
    const el = document.querySelector('#detail-apikey') as HTMLInputElement | null;
    return !!el && el.value.length > 10;
  });
  await page.click('[data-close]');

  // Matchmaking: draw teams for both players.
  await page.click('[data-view="matchmaking"]');
  await page.click('#mm-generate');
  await page.waitForSelector('.team-card');
  const teamCards = await page.locator('.team-card').count();
  assert.ok(teamCards >= 2, 'expected at least 2 team cards');

  // Voting: start a round, cast a vote, close it.
  await page.click('[data-view="votes"]');
  await page.click('#votes-start');
  await page.selectOption('#whoami', { label: 'E2E Alice' });
  await page.click('[data-vote-game] >> nth=0');
  await page.waitForFunction(() => document.body.textContent?.includes('1 Stimme'));
  await page.click('#votes-close');
  await page.waitForSelector('#votes-start');

  // Leaderboard: record a match and see it reflected.
  await page.click('[data-view="leaderboard"]');
  await page.click('#add-match-btn');
  await page.waitForSelector('#match-players');
  const teamSelects = page.locator('[data-team-for]');
  await teamSelects.nth(0).selectOption('0');
  await teamSelects.nth(1).selectOption('1');
  await page.check('input[name="winner"][value="0"]');
  await page.click('#match-form button[type="submit"]');
  await page.waitForSelector('.lb-row');
  assert.ok((await page.locator('.lb-row').count()) >= 2);

  // Back to Live: should now show both players (offline, since no agent ran).
  await page.click('[data-view="live"]');
  await page.waitForSelector('.player-card');
  assert.equal(await page.locator('.player-card').count(), 2);

  // Manual pause override (FR-28): pick "who am I", toggle pause, see the
  // badge flip, then toggle back.
  await page.selectOption('#live-whoami', { label: 'E2E Alice' });
  await page.click('[data-toggle-pause]');
  await page.waitForSelector('.badge-paused');
  await page.click('[data-toggle-pause]');
  await page.waitForFunction(() => !document.querySelector('.badge-paused'));
});
