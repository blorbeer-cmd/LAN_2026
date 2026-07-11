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
  // Let Playwright resolve its own installed browser (via `npx playwright
  // install chromium`, run before `npm run test:e2e`) instead of a fixed
  // path — a hardcoded path only worked in one specific pre-provisioned
  // environment and broke everywhere else, including CI.
  browser = await chromium.launch();
  page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  // Native confirm() dialogs (vote cancel, game delete, tracking start) —
  // accept them so click-through tests don't hang.
  page.on('dialog', (d) => void d.accept());
  // Surface frontend errors in the test output — a silent JS error otherwise
  // just shows up as an unexplained selector timeout.
  page.on('pageerror', (err) => console.error('[pageerror]', err.message));
  page.on('console', (msg) => {
    if (msg.type() === 'error') console.error('[console.error]', msg.text());
  });
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
  assert.equal((await page.textContent('.view-title'))?.trim(), 'Willkommen bei RespawnHQ');

  await page.fill('#profile-new-name', 'E2E Alice');
  await page.click('#profile-new-form button[type="submit"]');

  // Creating the profile switches into the full profile editor for the new
  // identity (name field prefilled, agent download, an onboarding nudge
  // toward the Spiele view since nothing's rated yet).
  await page.waitForSelector('#profile-name');
  assert.equal(await page.inputValue('#profile-name'), 'E2E Alice');
  await page.waitForSelector('text=Bock & Skill eintragen');
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

  // Voting: start a round (points mode, the only mode offered when starting
  // fresh), rate a game, and submit. The device identity was already set
  // during onboarding, so no "who am I" picker appears. Moving a slider only
  // stages a local draft — it must not count as a vote until the submit
  // button is pressed. While the round is open, no per-game distribution
  // (bars/counts) may be visible anywhere — only total participation and the
  // voter's own pick.
  await page.click('[data-view="votes"]');
  await page.waitForSelector('text=Du bist E2E Alice');
  await page.click('#votes-start');
  await page.waitForSelector('#votes-close'); // only rendered once ctx.refresh() shows the round as open
  assert.equal(await page.locator('.vote-bar-track').count(), 0, 'no bars while the round is open');
  await page.locator('[data-points-slider] >> nth=0').evaluate((el) => {
    (el as HTMLInputElement).value = '5';
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.waitForSelector('.skill-value:text("5")'); // staged locally
  assert.equal(
    await page.locator('text=0 von 2 haben abgestimmt').count(),
    1,
    'moving a slider must not submit it by itself'
  );
  await page.click('#votes-submit');
  await page.waitForFunction(() => document.body.textContent?.includes('1 von 2'));
  assert.equal(await page.locator('.vote-bar-track').count(), 0, 'still no bars after casting, before closing');

  await page.click('#votes-close');
  await page.waitForSelector('#votes-start');
  // Closing reveals the winner in the "Letztes Ergebnis" summary at the top
  // of the page — the full per-game breakdown only appears in the history
  // detail modal, not on the main page.
  await page.waitForSelector('text=Letztes Ergebnis');
  assert.equal(await page.locator('.vote-bar-track').count(), 0, 'no bars on the main page, even after closing');

  // The just-closed round can be reopened from the history list for the
  // full detailed breakdown.
  await page.click('[data-open-history-round]');
  await page.waitForSelector('text=Abstimmung Runde 1');
  await page.waitForSelector('.modal .vote-bar-track');
  await page.click('[data-close]');

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

  // Back to Home: should now show both players (offline, since no agent ran).
  await page.click('[data-view="home"]');
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
  await page.selectOption('#an-concurrency-game', { label: cs2.name });
  await page.waitForFunction(
    () => {
      const bars = Array.from(document.querySelectorAll<HTMLElement>('#an-concurrency-chart > div'));
      return bars.some((b) => (parseFloat(b.style.height) || 0) > 2);
    },
    { timeout: 5000 }
  );

  // The "Matches & Turniere" tab (merged in from the old separate Spiele &
  // Turniere view) shares this same event filter and renders alongside it.
  await page.click('[data-an-tab="matches"]');
  await page.waitForSelector('text=Ergebnisse pro Spiel');
});

test('Mein Profil: rename with a uniqueness conflict, then succeed; Meine Statistiken reachable', async () => {
  // Keep this test deterministic even if the preceding click-through test
  // changes its setup data or a future test order is introduced.
  const playersRes = await page.request.get(`${BASE_URL}/api/players`);
  const players = (await playersRes.json()) as Array<{ name: string }>;
  if (!players.some((p) => p.name === 'E2E Bob')) {
    const createRes = await page.request.post(`${BASE_URL}/api/players`, { data: { name: 'E2E Bob' } });
    assert.equal(createRes.status(), 201);
  }
  await page.click('#profile-btn');

  // The device identity is still "E2E Alice" from onboarding, so this view
  // opens straight into the profile editor rather than the identity picker.
  await page.waitForSelector('#profile-name');
  assert.equal(await page.inputValue('#profile-name'), 'E2E Alice');

  // Renaming to a name someone else already has must be rejected, not
  // silently accepted or crash the view.
  await page.fill('#profile-name', 'E2E Bob');
  await Promise.all([
    page.waitForResponse(
      (response) => response.url().includes('/api/players/') && response.request().method() === 'PATCH' && response.status() === 409
    ),
    page.click('#profile-save'),
  ]);
  assert.equal(await page.inputValue('#profile-name'), 'E2E Bob');

  // A genuinely free name should save fine.
  await page.fill('#profile-name', 'E2E Alice Pro');
  await page.click('#profile-save');
  await page.waitForFunction(() => {
    const el = document.querySelector('#profile-name') as HTMLInputElement | null;
    return el?.value === 'E2E Alice Pro';
  });

  // Bock/Skill-Ratings live in the Spiele view now, reachable from here via
  // the onboarding nudge; the personal stats dashboard is one tap away too
  // (it moved to its own view, myStats).
  await page.waitForSelector('text=Bock & Skill eintragen');
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

test('Sitzplan: the real name set in Mein Profil shows in small everywhere the seating plan renders', async () => {
  await page.click('#profile-btn');
  await page.waitForSelector('#profile-real-name');
  await page.fill('#profile-real-name', 'Alice Musterfrau');
  await page.click('#profile-save');
  await page.waitForSelector('.toast:has-text("Gespeichert")');

  // Seat her via the editor's tap-to-place path (select the pool chip, then
  // tap an empty seat) rather than HTML5 drag & drop, which Playwright can't
  // simulate reliably.
  await page.click('[data-navigate="seating"]');
  await page.waitForSelector('[data-seat-pool] [data-player-id]');
  await page.locator('[data-seat-pool] [data-player-id]', { hasText: 'E2E Alice Pro' }).click();
  await page.locator('[data-seat-side="top"][data-seat-index="0"]').click();
  await page.waitForSelector('.seating-seat.is-occupied .seating-seat-realname:has-text("Alice Musterfrau")');

  // Same shared renderSeatingPlan() component also feeds Home's read-only
  // board - the real name must show up there too, unprompted.
  await page.click('[data-view="home"]');
  await page.waitForSelector('.seating-seat-realname:has-text("Alice Musterfrau")');
});

test('Spiele: suggest a game (duplicate name rejected), promote it, then rate Bock/Skill inline', async () => {
  await page.click('[data-view="more"]');
  await page.click('[data-navigate="gameCatalog"]');
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

  // Promote the suggestion into the catalog via its detail modal (row-level
  // actions live only in there now — the row itself just carries the info
  // icon), then rate it right in the row — no detour through a separate
  // profile page needed.
  const suggestionRow = page.locator('.game-table-row', { hasText: 'E2E Partyspiel' });
  await suggestionRow.locator('[data-detail]').click();
  await page.click('#edit-promote');
  await page.waitForSelector('button[data-tab="catalog"].btn-primary');
  const partyspielRow = page.locator('.game-table-row', { hasText: 'E2E Partyspiel' });
  await partyspielRow.waitFor();
  const bockSlider = partyspielRow.locator('.skill-row[data-kind="bock"] input[type="range"]');
  await bockSlider.fill('8');
  await page.waitForFunction(() => {
    const cards = Array.from(document.querySelectorAll('.game-table-row'));
    const card = cards.find((c) => c.textContent?.includes('E2E Partyspiel'));
    return card?.querySelector('[data-kind="bock"] .skill-value')?.textContent === '8';
  });
});

test('Spiele: a skill suggestion chip appears after enough recorded results and can be applied', async () => {
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

  await page.click('[data-view="more"]');
  await page.click('[data-navigate="gameCatalog"]');
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

test('Info-Board: create an entry, see it rendered', async () => {
  await page.click('[data-view="more"]');
  await page.click('[data-navigate="infoBoard"]');
  await page.waitForSelector('#info-new-btn');
  await page.click('#info-new-btn');
  await page.fill('#info-title', 'WLAN');
  await page.fill('#info-content', 'Netz: LAN2026\nPasswort: kartoffel');
  await page.click('#info-form button[type="submit"]');
  await page.waitForSelector('text=kartoffel');
});

test('Essensbestellung: open an order with a send time/notes/link, edit them, add a priced item, close it', async () => {
  await page.click('[data-view="more"]');
  await page.click('[data-navigate="foodOrders"]');
  await page.waitForSelector('#order-new-btn');
  await page.click('#order-new-btn');
  await page.fill('#order-title', "Pizza bei Luigi's");
  await page.fill('#order-sendat', '2026-12-24T20:00');
  await page.fill('#order-notes', 'Mindestbestellwert 15€, bar zahlen');
  await page.fill('#order-link', 'https://luigis-pizza.example/karte');
  await page.click('#order-form button[type="submit"]');
  await page.waitForSelector('text=Pizza bei Luigi');
  await page.waitForSelector('text=Geht raus um 24.12., 20:00 Uhr');
  await page.waitForSelector('text=Mindestbestellwert 15€, bar zahlen');
  await page.waitForSelector('a[href="https://luigis-pizza.example/karte"]');

  // The send time / notes / link are editable after the fact (independent of closing).
  await page.click('[data-edit-details]');
  await page.fill('#sendat-input', '2026-12-24T21:30');
  await page.fill('#notes-input', 'Doch Kartenzahlung möglich');
  await page.click('#details-form button[type="submit"]');
  await page.waitForSelector('text=Geht raus um 24.12., 21:30 Uhr');
  await page.waitForSelector('text=Doch Kartenzahlung möglich');

  await page.fill('[data-item-desc]', '1x Margherita groß');
  await page.fill('[data-item-price]', '9,50');
  await page.click('[data-add-item-form] button[type="submit"]');
  await page.waitForSelector('text=Margherita');
  await page.waitForSelector('text=9,50 €');

  await page.click('[data-close-order]');
  // confirmDialog is an in-app modal (not a native browser dialog).
  await page.click('[data-confirm]');
  await page.waitForSelector('.badge-offline >> text=Geschlossen');

  // Closing only freezes items — the details stay correctable afterward.
  await page.click('details summary'); // expand the now-closed order
  await page.click('[data-edit-details]');
  await page.fill('#sendat-input', '2026-12-24T22:00');
  await page.click('#details-form button[type="submit"]');
  await page.waitForSelector('text=Geht raus um 24.12., 22:00 Uhr');
});

test('Arcade: open a quiz lobby, see it listed and on Home, then close it again', async () => {
  await page.click('[data-view="more"]');
  await page.click('[data-navigate="arcade"]');
  // Arcade is a launcher; select the quiz tile before its lobby controls
  // become visible (module state is intentionally reset on a fresh run).
  await page.click('[data-game="quiz"]');
  await page.waitForSelector('#quiz-create-lobby');
  await page.click('#quiz-create-lobby');
  await page.waitForSelector('[data-close-lobby]');

  // The open lobby also shows up on Home as an "Aktuell" card whose
  // "Mitmachen" button deep-links back into the Arcade. No tile click needed
  // there: the launcher force-expands the game whose lobby you're in.
  await page.click('[data-view="home"]');
  await page.waitForSelector('text=Gaming-Quiz-Lobby offen');
  await page.click('button:has-text("Mitmachen")');

  // The host sees their own lobby with a "Schließen" button instead of a
  // join button/"Drin" badge - closing was previously impossible (the only
  // way to get rid of a lobby was to disconnect the socket, e.g. by closing
  // the tab), leaving abandoned lobbies listed forever.
  await page.waitForSelector('[data-close-lobby]');
  await page.click('[data-close-lobby]');
  await page.waitForSelector('text=Keine offene Quiz-Lobby.');

  // Closed - the create button is enabled again.
  await page.waitForSelector('#quiz-create-lobby:not([disabled])');
});

test('Arcade: a lobby guest flags themselves ready and the host sees it', async () => {
  // Reuses "E2E Bob" (added earlier) as the guest on a second device — see
  // the Scribble test below for why the roster must not grow here.
  const players = (await (await fetch(`${BASE_URL}/api/players`)).json()) as Array<{ id: string; name: string }>;
  const guest = players.find((p) => p.name === 'E2E Bob');
  assert.ok(guest, 'expected "E2E Bob" (added by an earlier test) to exist');

  const guestContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const guestPage = await guestContext.newPage();
  guestPage.on('pageerror', (err) => console.error('[guest pageerror]', err.message));
  try {
    await guestPage.goto(BASE_URL);
    await guestPage.evaluate((id) => localStorage.setItem('lan2026_my_player_id', id), guest!.id);
    await guestPage.reload();
    await guestPage.waitForSelector('.nav-btn[data-view="more"]');
    await guestPage.click('[data-view="more"]');
    await guestPage.click('[data-navigate="arcade"]');
    await guestPage.click('[data-game="quiz"]');

    // Host opens the lobby, guest joins. The quiz tile is a toggle and the
    // previous test left its panel expanded — only click it if it's closed.
    if ((await page.locator('#quiz-create-lobby').count()) === 0) await page.click('[data-game="quiz"]');
    await page.waitForSelector('#quiz-create-lobby:not([disabled])');
    await page.click('#quiz-create-lobby');
    await guestPage.waitForSelector('[data-join-lobby]');
    await guestPage.click('[data-join-lobby]');

    // Freshly joined guests are not ready; only the host counts as ready.
    await page.waitForSelector('text=1/2 bereit');

    // Guest flags ready -> host sees the summary flip and the green chip.
    await guestPage.waitForSelector('[data-quiz-ready][data-ready="1"]');
    await guestPage.click('[data-quiz-ready][data-ready="1"]');
    await page.waitForSelector('text=2/2 bereit');
    await page.waitForSelector('.chip-ready >> text=E2E Bob');

    // The toggle works both ways: un-ready shows up at the host again.
    await guestPage.waitForSelector('[data-quiz-ready][data-ready="0"]');
    await guestPage.click('[data-quiz-ready][data-ready="0"]');
    await page.waitForSelector('text=1/2 bereit');
  } finally {
    // Leave no lobby behind for the tests that follow.
    await page.click('[data-close-lobby]');
    await page.waitForSelector('text=Keine offene Quiz-Lobby.');
    await guestContext.close();
  }
});

test('Arcade: Scribble - host draws, a second device guesses correctly, both see the reveal', async () => {
  // Unlike the quiz/draft flows above, Scribble strictly gates who may act
  // (only the current drawer can choose a word/draw, only raters may guess —
  // enforced both client- and server-side), so a single shared-identity page
  // can't drive both sides. A second real browser context, logged in as a
  // second player, is the only way to exercise the actual guess path.
  // Reuses "E2E Bob" (added by the earlier click-through test) rather than
  // adding a fresh roster player — the Captain-Draft test later in this
  // suite has a hardcoded pick-loop bound tied to the pool size, so growing
  // the roster here would silently break it.
  const players = (await (await fetch(`${BASE_URL}/api/players`)).json()) as Array<{ id: string; name: string }>;
  const guesser = players.find((p) => p.name === 'E2E Bob');
  assert.ok(guesser, 'expected "E2E Bob" (added by an earlier test) to exist');

  const guesserContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const guesserPage = await guesserContext.newPage();
  guesserPage.on('pageerror', (err) => console.error('[guesser pageerror]', err.message));
  try {
    await guesserPage.goto(BASE_URL);
    await guesserPage.evaluate((id) => localStorage.setItem('lan2026_my_player_id', id), guesser!.id);
    await guesserPage.reload();
    await guesserPage.waitForSelector('.nav-btn[data-view="more"]');
    await guesserPage.click('[data-view="more"]');
    await guesserPage.click('[data-navigate="arcade"]');
    await guesserPage.click('[data-game="scribble"]');

    // Host (the shared device driving `page` through this whole suite) opens
    // the lobby — draw order is lobby join order, so the host always draws
    // first, keeping this test deterministic about who does what.
    await page.click('[data-view="more"]');
    await page.click('[data-navigate="arcade"]');
    await page.click('[data-game="scribble"]');
    await page.waitForSelector('#scribble-create:not([disabled])');
    await page.click('#scribble-create');

    await guesserPage.waitForSelector('[data-scribble-join]');
    await guesserPage.click('[data-scribble-join]');

    await page.waitForSelector('#scribble-start:not([disabled])');
    await page.click('#scribble-start');

    // Host picks a word — the actual text is only ever shown to the drawer,
    // never sent to the guesser (see scribble.ts), so capture it from the
    // button label before it disappears.
    await page.waitForSelector('.scribble-word-choice-btn');
    const wordBtn = page.locator('.scribble-word-choice-btn').first();
    const chosenWord = (await wordBtn.textContent())!.trim();
    await wordBtn.click();

    // The guesser must never see the plain word, only the underscore mask.
    await guesserPage.waitForSelector('.scribble-word-mask');
    const guesserMask = await guesserPage.locator('.scribble-word-mask').textContent();
    assert.ok(!guesserMask?.includes(chosenWord), 'the guesser must not see the real word before guessing');

    await page.waitForSelector('#scribble-canvas');
    const box = await page.locator('#scribble-canvas').boundingBox();
    await page.mouse.move(box!.x + 20, box!.y + 20);
    await page.mouse.down();
    await page.mouse.move(box!.x + 120, box!.y + 90, { steps: 8 });
    await page.mouse.up();

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
    const box2 = await page.locator('#scribble-canvas').boundingBox();
    await page.mouse.move(box2!.x + 200, box2!.y + 20);
    await page.mouse.down();
    await page.mouse.move(box2!.x + 260, box2!.y + 60, { steps: 8 });
    await page.mouse.up();
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
    const guesserPaintedAfterStroke2 = await countPainted(guesserPage);
    const hostPaintedAfterStroke2 = await countPainted(page);

    await page.click('#scribble-undo');
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
    const box3 = await page.locator('#scribble-canvas').boundingBox();
    await page.mouse.click(box3!.x + 280, box3!.y + 20);
    await guesserPage.waitForFunction((before) => {
      const c = document.querySelector('#scribble-canvas') as HTMLCanvasElement | null;
      if (!c) return false;
      const data = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
      let n = 0;
      for (let i = 3; i < data.length; i += 4) if (data[i] !== 0) n++;
      return n > before;
    }, guesserPaintedAfterUndo);
    const hostPaintedAfterFill = await countPainted(page);
    assert.ok(hostPaintedAfterFill > hostPaintedAfterUndo + 1000, 'fill must flood a large area, not just paint a single pixel');

    await page.click('#scribble-undo');
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
    if (chosenWord.length >= 4) {
      const mid = Math.floor(chosenWord.length / 2);
      const closeTypo = chosenWord.slice(0, mid) + chosenWord.slice(mid + 1);
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
  } finally {
    await guesserContext.close();
  }
});

test('An- & Abreise: carpool marks the driver, enforces seats, driver can only delete', async () => {
  // A third roster player to later demonstrate a full carpool.
  await page.click('[data-view="more"]');
  await page.click('[data-navigate="players"]');
  await page.click('#add-player-btn');
  await page.fill('#new-player-name', 'E2E Carol');
  await page.click('#add-player-form button[type="submit"]');
  await page.waitForSelector('text=E2E Carol');

  await page.click('[data-view="more"]');
  await page.click('[data-navigate="arrivals"]');
  await page.waitForSelector('[data-new-carpool="arrival"]');

  // Current identity is still "E2E Alice Pro" - she creates the carpool and
  // becomes its driver, with just 1 free passenger seat.
  await page.click('[data-new-carpool="arrival"]');
  await page.fill('#carpool-label', 'Auto Alice');
  await page.fill('#carpool-location', 'Hamburg');
  await page.fill('#carpool-seats', '1');
  await page.click('#carpool-form button[type="submit"]');
  await page.waitForSelector('text=E2E Alice Pro fährt');
  await page.waitForSelector('text=1/1 frei');
  // The driver only ever gets Bearbeiten/Löschen, never a "Raus" button.
  await page.waitForSelector('[data-edit-carpool]');
  await page.waitForSelector('[data-remove-carpool]');
  assert.equal(await page.locator('[data-leave-carpool]').count(), 0);

  // Switch identity to Bob: he joins, taking the last seat.
  await page.click('[data-whoami-change]');
  await page.selectOption('#arrivals-whoami', { label: 'E2E Bob' });
  await page.waitForSelector('[data-join-carpool]');
  await page.click('[data-join-carpool]');
  await page.waitForSelector('text=0/1 frei');
  await page.waitForSelector('[data-leave-carpool]');

  // A third player finds the carpool full and can't join.
  await page.click('[data-whoami-change]');
  await page.selectOption('#arrivals-whoami', { label: 'E2E Carol' });
  await page.waitForSelector('text=Voll');
  assert.equal(await page.locator('[data-join-carpool]').count(), 0);

  // Bob leaves, freeing the seat back up; the driver deletes the group.
  await page.click('[data-whoami-change]');
  await page.selectOption('#arrivals-whoami', { label: 'E2E Bob' });
  await page.click('[data-leave-carpool]');
  await page.waitForSelector('text=1/1 frei');

  await page.click('[data-whoami-change]');
  await page.selectOption('#arrivals-whoami', { label: 'E2E Alice Pro' });
  await page.click('[data-remove-carpool]');
  await page.click('[data-confirm]');
  await page.waitForSelector('text=Noch keine Fahrgemeinschaft.');
});

test('Durchsage: send a broadcast, see it in the history', async () => {
  await page.click('[data-view="more"]');
  await page.click('[data-navigate="broadcast"]');
  await page.waitForSelector('#broadcast-message');
  await page.fill('#broadcast-message', 'Essen ist da!');
  await page.click('#broadcast-form button[type="submit"]');
  // Wait for the durable signal (the entry in "Letzte Durchsagen"), not the
  // 2.6s confirmation toast — too short-lived to assert on reliably.
  try {
    await page.waitForSelector('.lb-row >> text=Essen ist da!', { timeout: 8000 });
  } catch (err) {
    console.error('[debug] view:', (await page.innerText('#view-container')).slice(0, 500));
    console.error('[debug] toasts:', await page.innerText('#toast-container'));
    const apiState = await page.request.get(`${BASE_URL}/api/broadcasts`);
    console.error('[debug] api:', JSON.stringify(await apiState.json()).slice(0, 300));
    throw err;
  }

  // The push behind the Durchsage also lands in Home's "Mitteilungen" feed,
  // with a deep-link button back into the Durchsagen view.
  await page.click('[data-view="home"]');
  await page.waitForSelector('.section-title:has-text("Mitteilungen")');
  await page.waitForSelector('text=Essen ist da!');
  await page.click('button:has-text("Zu den Durchsagen")');
  await page.waitForSelector('#broadcast-message');
});

test('Captain-Draft: pick captains, run the live draft to completion', async () => {
  await page.click('[data-view="matchmaking"]');
  await page.waitForSelector('[data-captain-toggle]');

  // The device identity ("E2E Alice Pro") must be a captain so this page is
  // allowed to pick; E2E Bob is the second captain, everyone else is pool.
  await page.click('button[data-captain-toggle]:has-text("E2E Alice Pro")');
  await page.click('button[data-captain-toggle]:has-text("E2E Bob")');
  await page.waitForSelector('#draft-start:not([disabled])');
  await page.click('#draft-start');

  // Live board appears; it's Alice's turn (first captain). Keep picking
  // until the pool is empty — the last player is auto-assigned server-side,
  // which ends the draft and returns the view to the regular Teams-auslosen
  // page (no pinned "draft result" card — see matchmaking.js).
  await page.waitForSelector('text=Captain-Draft läuft');
  for (let i = 0; i < 8; i++) {
    if ((await page.locator('text=Captain-Draft läuft').count()) === 0) break;
    const pick = page.locator('button[data-draft-pick]').first();
    if ((await pick.count()) === 0) break;
    await pick.click();
    await page.waitForTimeout(300);
  }
  await page.waitForSelector('text=Captain-Draft läuft', { state: 'detached', timeout: 5000 });

  // The finished draft landed in the shared Team-Historie (not pinned to the
  // page top) with the usual "Ergebnis eintragen" follow-up available there.
  await page.waitForSelector('.section-title:has-text("Team-Historie")');
  await page.waitForSelector('[data-record-draw]');
});

test('the device back button steps back through in-app views instead of leaving the tool', async () => {
  // Land on a known view, then navigate through two more — each deliberate
  // tab switch should push a history entry (see switchView in app.js).
  await page.click('[data-view="home"]');
  await page.waitForSelector('.view-title');
  await page.click('[data-view="votes"]');
  await page.waitForFunction(() => document.querySelector('.view-title')?.textContent?.includes('Nächstes'));
  await page.click('[data-view="leaderboard"]');
  await page.waitForFunction(() => document.querySelector('.view-title')?.textContent === 'Rangliste');

  // Back should undo the last switch (leaderboard -> votes), not leave the
  // single-page app (there is nowhere else to navigate to in this test, so
  // if this fell through to real browser navigation the page would end up
  // blank/erroring instead of showing the votes view).
  await page.goBack();
  await page.waitForFunction(() => document.querySelector('.view-title')?.textContent?.includes('Nächstes'));

  await page.goBack();
  await page.waitForFunction(() => document.querySelector('.view-title')?.textContent === 'Home');

  // Forward should redo the same steps.
  await page.goForward();
  await page.waitForFunction(() => document.querySelector('.view-title')?.textContent?.includes('Nächstes'));
});

test('Kiosk: shows an open food order (when/where only), and the last-push banner picks up any feature, not just Durchsagen', async () => {
  const playersRes = await page.request.get(`${BASE_URL}/api/players`);
  const [{ id: playerId }] = await playersRes.json();

  // Send a Durchsage first, then trigger a different feature's push (opening
  // a food order) — the banner must show the *food order's* push afterward,
  // proving it reflects any notifyPlayers() call, not only Durchsagen.
  await page.request.post(`${BASE_URL}/api/broadcasts`, {
    data: { playerId, message: 'Kiosk-Test-Durchsage' },
  });
  const sendAt = Date.now() + 3600_000;
  await page.request.post(`${BASE_URL}/api/food-orders`, {
    data: { playerId, title: 'Kiosk-Test-Pizza', sendAt, link: 'https://kiosk-test.example/karte' },
  });

  await page.goto(`${BASE_URL}/kiosk.html`);

  // The food banner shows only the when/where (send time + menu link) — the
  // items themselves stay on everyone's own phone, never on the shared screen.
  await page.waitForSelector('#kiosk-food-banner:not([hidden]) >> text=Kiosk-Test-Pizza');
  await page.waitForSelector('a[href="https://kiosk-test.example/karte"]');

  // The last-push banner shows the food order's own push (title "🍕 Neue
  // Sammelbestellung"), not the earlier Durchsage — with a timestamp, and
  // it stays up permanently rather than auto-hiding after a few minutes.
  await page.waitForSelector('#kiosk-broadcast:not([hidden]) >> text=Neue Sammelbestellung');
  await page.waitForSelector('#kiosk-broadcast >> text=Kiosk-Test-Pizza');
  await page.waitForSelector('.kiosk-broadcast-time');
});

test('Admin: one-tap mode with banner, seeded test users visible only in admin mode', async () => {
  await page.goto(BASE_URL);
  await page.waitForSelector('#app:not([hidden])');

  // Enter admin mode — no PIN prompt, one tap (see docs/KONZEPT-TEST-USER.md).
  await page.click('[data-view="more"]');
  await page.click('[data-navigate="admin"]');
  await page.click('#admin-activate');
  await page.waitForSelector('#admin-banner:not([hidden]) >> text=Admin-Modus aktiv');

  // Seed test users; the admin toggle triggers a refresh, so re-open the view.
  await page.click('[data-view="more"]');
  await page.click('[data-navigate="admin"]');
  await page.fill('#admin-count', '3');
  await page.click('#admin-bulk');
  await page.waitForSelector('text=3 Test-Spieler vorhanden');
  await page.waitForSelector('.badge-paused >> text=Test');

  // Visible on the roster (Mehr → Spieler) while in admin mode...
  await page.click('[data-view="more"]');
  await page.click('[data-navigate="players"]');
  await page.waitForSelector('text=Test Alex');

  // ...gone everywhere once admin mode is left via the banner.
  await page.click('#admin-banner-leave');
  await page.waitForSelector('#admin-banner', { state: 'hidden' });
  await page.waitForFunction(() => !document.body.textContent?.includes('Test Alex'));

  // Back in admin mode, cleanup removes them and their data again.
  await page.click('[data-view="more"]');
  await page.click('[data-navigate="admin"]');
  await page.click('#admin-activate');
  await page.waitForSelector('#admin-banner:not([hidden])');
  await page.click('[data-view="more"]');
  await page.click('[data-navigate="admin"]');
  await page.click('#admin-cleanup');
  // confirmDialog is an in-app modal (not a native browser dialog).
  await page.click('[data-confirm]');
  await page.waitForSelector('text=0 Test-Spieler vorhanden');
  await page.click('#admin-banner-leave');
});
