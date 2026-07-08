// Browser E2E test: drives the real built server + real Chromium through the
// main click paths (self-onboarding, players, matchmaking, voting,
// leaderboard, game admin, tournament). Separate from the fast
// unit/integration suite (`npm test`) — run via `npm run test:e2e` since it
// spawns a server process and a browser, which is much slower.

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
  // Native confirm() dialogs (vote cancel, game delete, tracking start) —
  // accept them so click-through tests don't hang.
  page.on('dialog', (d) => void d.accept());
});

after(async () => {
  await browser?.close();
  serverProcess?.kill();
});

test('fresh device lands on self-onboarding and creates its profile there', async () => {
  await page.goto(BASE_URL);
  await page.waitForSelector('#app:not([hidden])');

  // No identity stored on this device yet -> the app must route straight to
  // the profile/onboarding view, not the Live board.
  assert.equal(await page.textContent('.view-title'), '👋 Willkommen bei RespawnHQ');

  await page.fill('#profile-new-name', 'E2E Alice');
  await page.click('#profile-new-form button[type="submit"]');

  // Creating the profile switches into the full profile editor for the new
  // identity (name field prefilled, skill sliders section, agent download).
  await page.waitForSelector('#profile-name');
  assert.equal(await page.inputValue('#profile-name'), 'E2E Alice');
});

test('full click-through: players, matchmaking, voting, leaderboard, live pause', async () => {
  // Add a second player via the roster view (lives in the "Mehr" hub — the
  // bottom nav slot went to Turniere).
  await page.click('[data-view="more"]');
  await page.click('[data-navigate="players"]');
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

  // Voting: start a round and cast a vote. The device identity was already
  // set during onboarding, so no "who am I" picker appears — voting is one
  // tap, which is exactly the intended flow.
  await page.click('[data-view="votes"]');
  await page.waitForSelector('text=Du bist E2E Alice');
  await page.click('#votes-start');
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

  // Manual pause override (FR-28): the pause toggle renders only on your own
  // card. Toggle pause, see the badge flip, then toggle back.
  await page.click('[data-toggle-pause]');
  await page.waitForSelector('.badge-paused');
  await page.click('[data-toggle-pause]');
  await page.waitForFunction(() => !document.querySelector('.badge-paused'));
});

test('Auswertungen (via Mehr) shows a real award and a visible, auto-scrolled concurrency chart', async () => {
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
  // Spielzeit-Auswertungen lives in the "Mehr" tab.
  await page.click('[data-view="more"]');
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

test('Mein Profil: rename with a uniqueness conflict, then succeed; Meine Statistiken reachable', async () => {
  await page.click('#profile-btn');

  // The device identity is still "E2E Alice" from onboarding, so this view
  // opens straight into the profile editor rather than the identity picker.
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

  // Self-service skill rating renders, and the personal stats dashboard is
  // one tap away (it moved to its own view, myStats).
  assert.ok((await page.locator('.skill-row').count()) > 0);
  await page.click('[data-navigate="myStats"]');
  await page.waitForSelector('text=Meine Statistiken');
  await page.waitForSelector('#my-stats-event');

  // Back to the profile; "Nicht du?" resets identity back to the picker.
  await page.click('[data-navigate="profile"]');
  await page.waitForSelector('#profile-not-me');
  await page.click('#profile-not-me');
  await page.waitForSelector('#profile-whoami');
  // Restore the identity — later tests (tournament) still act as her.
  await page.selectOption('#profile-whoami', { label: 'E2E Alice Pro' });
});

test('Spiele verwalten: create a game, and a duplicate name is rejected with a clear error', async () => {
  await page.click('#settings-btn');
  await page.click('#add-game-btn');
  await page.fill('#new-game-name', 'E2E Partyspiel');
  await page.click('#add-game-form button[type="submit"]');
  await page.waitForSelector('text=E2E Partyspiel');

  // Same name again (different case): server must refuse — otherwise votes,
  // skills and results would silently split across two identical entries.
  await page.click('#add-game-btn');
  await page.fill('#new-game-name', 'e2e partyspiel');
  await page.click('#add-game-form button[type="submit"]');
  await page.waitForSelector('.toast-error');
  await page.waitForSelector('text=gibt es schon');
  await page.click('[data-close]');
});

test('Turnier: create a K.O. bracket from proposed teams and play it to a champion', async () => {
  // Tournaments earned their own bottom-nav slot.
  await page.click('[data-view="tournaments"]');
  await page.waitForSelector('#tourn-new-btn');
  await page.click('#tourn-new-btn');

  // Propose balanced teams from the checked players (all by default), then
  // create — the submit button only unlocks once a proposal exists.
  await page.waitForSelector('#tourn-propose');
  assert.equal(await page.locator('#tourn-submit').isDisabled(), true);
  await page.click('#tourn-propose');
  await page.waitForSelector('[data-team-name]');
  await page.click('#tourn-submit');

  // Bracket renders with clickable team buttons; click winners until the
  // tournament reports itself finished.
  await page.waitForSelector('.bracket-match');
  for (let i = 0; i < 8; i++) {
    const btn = page.locator('button.bracket-team-row:not(.is-tbd)').first();
    if ((await btn.count()) === 0) break;
    if (await page.locator('text=Beendet').count()) break;
    await btn.click();
    await page.waitForTimeout(300);
  }
  await page.waitForSelector('text=Beendet', { timeout: 5000 });
});
