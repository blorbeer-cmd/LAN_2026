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

  // Voting: start a round, pick a game, and submit. The device identity was
  // already set during onboarding, so no "who am I" picker appears. Picking
  // a game only stages a local draft — it must not count as a vote until the
  // submit button is pressed. While the round is open, no per-game
  // distribution (bars/counts) may be visible anywhere — only total
  // participation and the voter's own pick.
  await page.click('[data-view="votes"]');
  await page.waitForSelector('text=Du bist E2E Alice');
  await page.click('#votes-start');
  await page.waitForSelector('#votes-close'); // only rendered once ctx.refresh() shows the round as open
  assert.equal(await page.locator('.vote-bar-track').count(), 0, 'no bars while the round is open');
  await page.click('[data-vote-select] >> nth=0');
  await page.waitForSelector('text=Ausgewählt'); // staged locally
  assert.equal(
    await page.locator('text=0 von 2 haben abgestimmt').count(),
    1,
    'selecting a game must not submit it by itself'
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

  // Promote the suggestion into the catalog, then rate it right in the row —
  // no detour through a separate profile page needed.
  await page.click('[data-promote]');
  await page.waitForSelector('button[data-tab="catalog"].btn-primary');
  const partyspielCard = page.locator('.game-card', { hasText: 'E2E Partyspiel' });
  await partyspielCard.waitFor();
  const bockSlider = partyspielCard.locator('.skill-row[data-kind="bock"] input[type="range"]');
  await bockSlider.fill('8');
  await page.waitForFunction(() => {
    const cards = Array.from(document.querySelectorAll('.game-card'));
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
  const cs2Card = page.locator('.game-card', { hasText: 'Counter-Strike 2' });
  await cs2Card.waitFor();
  const chip = cs2Card.locator('[data-apply-suggestion]');
  await chip.waitFor();

  await chip.click();
  await page.waitForFunction(() => {
    const cards = Array.from(document.querySelectorAll('.game-card'));
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

  await page.click('[data-close-order]'); // confirm auto-accepted
  await page.waitForSelector('.badge-offline >> text=Geschlossen');

  // Closing only freezes items — the details stay correctable afterward.
  await page.click('details summary'); // expand the now-closed order
  await page.click('[data-edit-details]');
  await page.fill('#sendat-input', '2026-12-24T22:00');
  await page.click('#details-form button[type="submit"]');
  await page.waitForSelector('text=Geht raus um 24.12., 22:00 Uhr');
});

test('Arcade: open a quiz lobby, see it listed, then close it again', async () => {
  await page.click('[data-view="more"]');
  await page.click('[data-navigate="arcade"]');
  await page.waitForSelector('#quiz-create-lobby');
  await page.click('#quiz-create-lobby');

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
  // until the pool is empty — the last player is auto-assigned server-side.
  await page.waitForSelector('text=Captain-Draft läuft');
  for (let i = 0; i < 8; i++) {
    if (await page.locator('text=Draft-Ergebnis').count()) break;
    const pick = page.locator('button[data-draft-pick]').first();
    if ((await pick.count()) === 0) break;
    await pick.click();
    await page.waitForTimeout(300);
  }
  await page.waitForSelector('text=Draft-Ergebnis', { timeout: 5000 });

  // The finished draft also landed in the shared Team-Historie, and the
  // result offers the usual "Ergebnis eintragen" follow-up.
  await page.waitForSelector('#draft-record-result');
});

test('the device back button steps back through in-app views instead of leaving the tool', async () => {
  // Land on a known view, then navigate through two more — each deliberate
  // tab switch should push a history entry (see switchView in app.js).
  await page.click('[data-view="live"]');
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
  await page.waitForSelector('text=Live-Status');

  // Forward should redo the same steps.
  await page.goForward();
  await page.waitForFunction(() => document.querySelector('.view-title')?.textContent?.includes('Nächstes'));
});
