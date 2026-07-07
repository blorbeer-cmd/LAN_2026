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
  await page.waitForSelector('text=Spielzeit');

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

  // Auswertungen dashboard: reachable from Rangliste, loads its async data
  // and renders the section headers (no play_sessions exist in this flow —
  // no agent ever reported — so we check structure, not specific awards).
  await page.click('[data-view="leaderboard"]');
  await page.click('[data-navigate="analytics"]');
  await page.waitForSelector('text=Auswertungen');
  await page.waitForSelector('text=Wer hat wann was gespielt', { timeout: 5000 });
  await page.waitForSelector('text=Awards');
});

test('Auswertungen shows a real award and a visible, auto-scrolled concurrency chart', async () => {
  // Create a player + a session via the real agent-report endpoint (not the
  // UI) so there's an actual play_sessions row to render.
  const playerRes = await page.request.post(`${BASE_URL}/api/players`, {
    data: { name: 'Analytics E2E Player' },
  });
  const player = await playerRes.json();
  const gamesRes = await page.request.get(`${BASE_URL}/api/games`);
  const games = (await gamesRes.json()) as Array<{ id: string; name: string; icon: string }>;
  const cs2 = games.find((g) => g.name === 'Counter-Strike 2')!;

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
  await page.click('[data-view="leaderboard"]');
  await page.click('[data-navigate="analytics"]');
  await page.waitForSelector('text=Marathon-Zocker', { timeout: 5000 });
  assert.ok((await page.textContent('.view-title'))?.includes('Auswertungen'));

  // Switch the concurrency chart to CS2 and confirm at least one bar has a
  // real height (regression check for the auto-scroll/empty-looking-chart
  // bug: bars must be reachable/visible, not scrolled off-screen).
  await page.selectOption('#an-concurrency-game', { label: `${cs2.icon} ${cs2.name}` });
  await page.waitForFunction(
    () => {
      const bars = Array.from(document.querySelectorAll<HTMLElement>('#an-concurrency-chart > div'));
      return bars.some((b) => (parseFloat(b.style.height) || 0) > 2);
    },
    { timeout: 5000 }
  );
});

test('Mein Profil: pick identity, rename with a uniqueness conflict, then succeed', async () => {
  await page.click('#profile-btn');

  // The earlier "full click-through" test already picked "E2E Alice" as
  // whoami (via the Live view's pause toggle) — that identity is shared
  // storage, so this view opens straight into the profile editor for her
  // rather than the identity picker.
  await page.waitForSelector('#profile-name');
  assert.equal(await page.inputValue('#profile-name'), 'E2E Alice');

  // Renaming to a name someone else already has must be rejected, not
  // silently accepted or crash the view.
  await page.fill('#profile-name', 'E2E Bob');
  await page.click('#profile-save');
  await page.waitForSelector('.toast-error');
  await page.waitForSelector('text=vergeben');

  // A genuinely free name should save fine.
  await page.fill('#profile-name', 'E2E Alice Pro');
  await page.click('#profile-save');
  await page.waitForFunction(() => {
    const el = document.querySelector('#profile-name') as HTMLInputElement | null;
    return el?.value === 'E2E Alice Pro';
  });

  // Self-service skill rating and the personal stats dashboard both render.
  assert.ok((await page.locator('.skill-row').count()) > 0);
  await page.waitForSelector('text=Meine Statistiken');
  await page.waitForSelector('#profile-stats-event');

  // "Nicht du?" resets identity back to the picker.
  await page.click('#profile-not-me');
  await page.waitForSelector('#profile-whoami');
});
