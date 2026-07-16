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
import { normalizeAnswer } from '../../arcade/quizLogic';

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

async function setDateTimeField(id: string, value: string): Promise<void> {
  await page.locator(`#${id}`).evaluate((element, nextValue) => {
    (element as HTMLInputElement).value = nextValue;
  }, value);
}

async function openMatchmakingHistory(): Promise<void> {
  const details = page.locator('details.history-details:has(summary:has-text("Historie"))');
  if (!(await details.getAttribute('open'))) await details.locator('summary').click();
}

async function switchIdentityAndOpenArrivals(label: string): Promise<void> {
  await page.click('#profile-btn');
  await page.waitForSelector('#profile-not-me');
  await page.click('#profile-not-me');
  await page.selectOption('#profile-whoami', { label });
  await page.waitForSelector('#profile-not-me');
  await page.click('[data-view="more"]');
  await page.click('[data-navigate="arrivals"]');
  await page.waitForSelector('[data-new-carpool="arrival"]');
}

async function createPlayerForFlow(name: string): Promise<void> {
  const response = await page.request.post(`${BASE_URL}/api/players`, { data: { name } });
  assert.equal(response.status(), 201);
  await page.reload();
  await page.waitForSelector(`[data-player]:has-text("${name}")`);
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

  const topbarWordmark = page.locator('.topbar-title .brand-title');
  assert.equal((await topbarWordmark.textContent())?.trim(), 'Respawn');
  assert.deepEqual(
    await topbarWordmark.evaluate((element) => {
      const style = getComputedStyle(element);
      return { fontStyle: style.fontStyle, transform: style.transform };
    }),
    { fontStyle: 'normal', transform: 'none' },
  );

  // No identity stored on this device yet -> the app must route straight to
  // the profile/onboarding view, not the Live board.
  assert.equal((await page.textContent('.view-title'))?.trim(), 'Willkommen bei Respawn');

  await page.fill('#profile-new-name', 'E2E Alice');
  await page.click('#profile-new-form button[type="submit"]');

  // Creating the profile switches into the full profile editor for the new
  // identity (name field prefilled, agent download, an onboarding nudge
  // toward the Spiele view since nothing's rated yet).
  await page.waitForSelector('#profile-name');
  assert.equal(await page.inputValue('#profile-name'), 'E2E Alice');
  await page.waitForSelector('text=Bock & Skill eintragen');
});

test('Einstellungen und Profil use grouped help while admin tools stay out of regular settings', async () => {
  await page.click('#settings-btn');
  await page.waitForSelector('#settings-events-title');
  assert.equal(await page.locator('.grouped-page-sections > .grouped-page-section').count(), 3);
  assert.equal(await page.locator('[data-navigate="seating"]').count(), 0);
  assert.equal(await page.locator('#download-backup').count(), 0);
  assert.equal(
    await page.locator('.invite-link-row').evaluate((element) => getComputedStyle(element).gridTemplateColumns.split(' ').length),
    3,
  );
  assert.equal(await page.locator('.invite-link-row').evaluate((element) => element.scrollWidth <= element.clientWidth), true);
  assert.deepEqual(
    await page.locator('.invite-link-row > *').evaluateAll((controls) => controls.map((control) => control.getBoundingClientRect().height)),
    [44, 44, 44],
  );
  await page.click('[aria-label="Mehr Informationen zu Events"]');
  await page.waitForSelector('#settings-events-help:not([hidden])');
  await page.click('[aria-label="Mehr Informationen zu Events"]');
  await page.click('#invite-qr-open');
  await page.waitForSelector('.modal[aria-label="Einladungs-QR-Code"] .invite-qr-modal svg');
  const qrModalBox = await page.locator('.modal[aria-label="Einladungs-QR-Code"]').boundingBox();
  assert.ok(qrModalBox && Math.abs(qrModalBox.y + qrModalBox.height / 2 - 422) < 24, 'QR modal should be vertically centered on the phone viewport');
  await page.click('.modal[aria-label="Einladungs-QR-Code"] [data-close]');

  await page.setViewportSize({ width: 1280, height: 900 });
  await page.click('#profile-btn');
  await page.waitForSelector('#profile-name');
  assert.equal(await page.locator('.profile-agent-step').count(), 3);
  assert.equal(await page.locator('#push-toggle[type="checkbox"]').count(), 1);
  assert.equal(await page.locator('label:has(#push-toggle) > span').getByText('Aktivieren', { exact: true }).count(), 1);
  assert.equal(await page.locator('#profile-tracking-pause-help').count(), 1);
  assert.equal(await page.locator('#profile-activity-tracking-help').count(), 1);
  assert.equal(await page.locator('.profile-agent-step').first().locator('#tracking-paused').count(), 1);
  assert.equal(await page.locator('label[for="profile-name"]').textContent(), 'Gamertag');
  assert.equal(await page.locator('label[for="profile-real-name"]').textContent(), 'Name');
  assert.equal(await page.locator('.profile-avatar-editor .field-label').textContent(), 'Bild');
  assert.equal(await page.locator('label[for="profile-color"]').textContent(), 'Farbe');
  assert.equal(await page.locator('.profile-identity-fields').evaluate((element) => getComputedStyle(element).gridTemplateColumns.split(' ').length), 4);
  assert.equal(await page.locator('.profile-identity-fields > *').evaluateAll((fields) => new Set(fields.map((field) => field.getBoundingClientRect().top)).size), 1);
  assert.equal(await page.getByText('Erweitertes Tracking', { exact: true }).count(), 1);
  assert.equal(await page.locator('.profile-identity-editor').evaluate((element) => element.scrollWidth <= element.clientWidth), true);
  assert.equal(await page.getByText('Auf diesem Gerät aus.', { exact: true }).count(), 0);
  assert.equal(await page.getByText('Auf diesem Gerät aktiv.', { exact: true }).count(), 0);
});

test('Admin mode owns the seating editor and backup tools', async () => {
  await page.click('[data-view="more"]');
  await page.click('[data-navigate="admin"]');
  await page.click('#admin-activate');
  await page.waitForSelector('#admin-banner:not([hidden])');
  await page.click('[data-view="more"]');
  await page.click('[data-navigate="admin"]');
  await page.waitForSelector('#admin-tools-title');
  assert.equal(await page.locator('#download-backup').count(), 1);
  assert.equal(await page.locator('[data-navigate="seating"]').count(), 1);
  assert.equal(await page.locator('[data-navigate="seating"]').textContent(), 'Öffnen');
  assert.ok(await page.locator('[data-navigate="seating"]').evaluate((element) => element.classList.contains('btn-primary')));
  assert.equal(await page.locator('#admin-seating-help').count(), 1);
  assert.equal(await page.locator('#admin-backup-help').count(), 1);
  assert.equal(await page.locator('#admin-test-count-help').count(), 1);
  assert.equal(await page.locator('#admin-test-data-help').count(), 1);
  assert.equal(await page.locator('.admin-tool-row').count(), 2);
  assert.equal(await page.locator('.admin-test-controls > *').count(), 3);
  assert.equal(await page.locator('#admin-cleanup').textContent(), 'Test-Daten aufräumen');
  assert.deepEqual(await page.locator('.admin-test-controls > *').evaluateAll((controls) => controls.map((control) => control.id)), ['admin-count', 'admin-cleanup', 'admin-bulk']);
  assert.equal(await page.locator('#admin-count').evaluate((input) => input.getBoundingClientRect().height), 36);
  assert.equal(await page.locator('.admin-test-controls').evaluate((element) => element.scrollWidth <= element.clientWidth), true);
  await page.click('[data-navigate="seating"]');
  await page.waitForSelector('.seating-plan.is-editable');
  assert.equal(await page.locator('.seating-editor > .grouped-page-section').count(), 3);
  assert.deepEqual(await page.locator('.seating-editor > .grouped-page-section h2').allTextContents(), ['Sitzplan', 'Spieler', 'Konfiguration']);
  assert.equal(await page.locator('.seating-pool-player').evaluateAll((players) => players.every((player) => getComputedStyle(player).borderRadius !== '999px')), true);
  assert.equal(await page.locator('.seating-player-pool').evaluate((pool) => getComputedStyle(pool).gridTemplateColumns.split(' ').length), 2);
  await page.click('[data-navigate="admin"]');
  await page.click('#admin-leave');
  await page.waitForSelector('#admin-banner', { state: 'hidden' });
});

test('global search filters areas, supports keyboard navigation and restores focus', async () => {
  await page.click('#global-search-btn');
  await page.waitForSelector('.global-search-modal');
  assert.equal(await page.locator('#global-search-input').evaluate((element) => element === document.activeElement), true);
  assert.ok(
    await page.locator('#global-search-input').evaluate((element) => parseFloat(getComputedStyle(element).borderRadius) >= 14),
    'search input should use the rounded modal/card radius'
  );
  assert.equal(await page.locator('.global-search-result').count(), 0, 'search must not show frequent areas before input');
  assert.equal(await page.locator('.global-search-shortcuts').count(), 0, 'keyboard legend is intentionally omitted');

  await page.fill('#global-search-input', 'E2E Alice');
  await page.waitForSelector('.global-search-result:has-text("E2E Alice")');
  await page.click('.global-search-result:has-text("E2E Alice")');
  await page.waitForSelector('.view-title:text("Spieler")');
  await page.waitForSelector('[data-player].search-target-highlight:has-text("E2E Alice")');

  await page.keyboard.press('Control+K');
  await page.fill('#global-search-input', 'Captain Draft');
  await page.waitForSelector('.global-search-result:has-text("Teams")');
  await page.click('.global-search-result:has-text("Teams")');
  await page.waitForSelector('.view-title:text("Teams")');

  await page.keyboard.press('Control+K');
  await page.fill('#global-search-input', 'Statistik');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await page.waitForSelector('.view-title:text("Auswertungen")');

  await page.click('#global-search-btn');
  await page.fill('#global-search-input', 'gibt es nicht');
  await page.waitForSelector('text=Kein passender Inhalt gefunden.');
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('.global-search-modal').count(), 0);
  assert.equal(await page.locator('#global-search-btn').evaluate((element) => element === document.activeElement), true);

  await page.setViewportSize({ width: 320, height: 720 });
  await page.click('#global-search-btn');
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
  await page.keyboard.press('Escape');
  await page.setViewportSize({ width: 900, height: 844 });
  await page.click('#global-search-btn');
  const desktopModal = await page.locator('.global-search-modal .modal').boundingBox();
  assert.ok(desktopModal && desktopModal.width <= 640);
  assert.ok(Math.abs(desktopModal.x + desktopModal.width / 2 - 450) <= 1);
  await page.keyboard.press('Escape');
  await page.setViewportSize({ width: 390, height: 844 });
});

test('full click-through: players, matchmaking, voting, leaderboard, live pause', async () => {
  // The public roster no longer creates identities; test setup creates the
  // second profile through the API that future user management will own.
  await page.click('[data-view="more"]');
  await page.click('[data-navigate="players"]');
  await createPlayerForFlow('E2E Bob');

  // Other profiles are read-only; the current identity opens its own editor.
  await page.click('button[data-player] >> text=E2E Bob');
  await page.waitForSelector('text=Dieses Profil kann nur von E2E Bob selbst bearbeitet werden.');
  assert.equal(await page.locator('#detail-save, #detail-delete, #detail-apikey').count(), 0);
  await page.click('[data-close]');
  await page.click('button[data-player] >> text=E2E Alice');
  await page.waitForSelector('#profile-name');
  assert.equal(await page.inputValue('#profile-name'), 'E2E Alice');

  // Matchmaking: draw teams for both players.
  await page.click('[data-view="matchmaking"]');
  assert.equal(await page.inputValue('#mm-teamcount'), '2');
  await page.click('#mm-select-none');
  assert.equal(await page.locator('[data-player]:checked').count(), 0);
  await page.click('#mm-select-all');
  assert.equal(await page.locator('[data-player]:checked').count(), 2);
  assert.equal(await page.locator('details.history-details:has(summary:has-text("Historie"))').getAttribute('open'), null);

  const drawPlayerGrid = page.locator('section[aria-labelledby="matchmaking-draw-title"] .player-selection-grid');
  const mobileSelectionColumns = await drawPlayerGrid.evaluate((element) =>
    getComputedStyle(element).gridTemplateColumns.split(' ').length
  );
  assert.equal(mobileSelectionColumns, 2);
  await page.setViewportSize({ width: 900, height: 844 });
  const desktopSelectionColumns = await drawPlayerGrid.evaluate((element) =>
    getComputedStyle(element).gridTemplateColumns.split(' ').length
  );
  assert.ok(desktopSelectionColumns >= 2);
  await page.setViewportSize({ width: 390, height: 844 });

  const draftHelp = page.locator('[aria-controls="captain-draft-help"]');
  await draftHelp.click();
  assert.equal(await draftHelp.getAttribute('aria-expanded'), 'true');
  await page.keyboard.press('Escape');
  assert.equal(await draftHelp.getAttribute('aria-expanded'), 'false');

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
  await page.waitForSelector('#votes-start');
  assert.equal(await page.getByText('Du bist E2E Alice', { exact: true }).count(), 0);
  await page.click('#votes-start');
  await page.waitForSelector('#votes-close'); // only rendered once ctx.refresh() shows the round as open
  await page.waitForSelector('.vote-participation-status:has-text("Bewertungen abgegeben"):has-text("0 / 2")');
  const submitBox = await page.locator('#votes-submit').boundingBox();
  const closeBox = await page.locator('#votes-close').boundingBox();
  const cancelBox = await page.locator('#votes-cancel').boundingBox();
  assert.ok((submitBox?.width || 0) > (closeBox?.width || 0));
  assert.equal(Math.round(cancelBox?.width || 0), Math.round(closeBox?.width || 0));
  assert.equal(await page.locator('.vote-game-grid').evaluate((element) => getComputedStyle(element).gridTemplateColumns.split(' ').length), 1);
  await page.setViewportSize({ width: 900, height: 844 });
  assert.equal(await page.locator('.vote-game-grid').evaluate((element) => getComputedStyle(element).gridTemplateColumns.split(' ').length), 2);
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.locator('.vote-bar-track').count(), 0, 'no bars while the round is open');
  await page.locator('[data-points-slider] >> nth=0').evaluate((el) => {
    (el as HTMLInputElement).value = '5';
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.locator('[data-points-slider] >> nth=1').evaluate((el) => {
    (el as HTMLInputElement).value = '5';
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.waitForSelector('.skill-value:text("5")'); // staged locally
  assert.equal(
    await page.locator('.vote-participation-status:has-text("0 / 2")').count(),
    1,
    'moving a slider must not submit it by itself'
  );
  await page.click('#votes-submit');
  await page.waitForSelector('.vote-participation-status:has-text("1 / 2")');
  await page.waitForSelector('.vote-submitted-state:has-text("Bewertung abgegeben")');
  assert.equal(await page.locator('#votes-submit').count(), 0);
  assert.ok(await page.locator('[data-points-slider]').first().isDisabled());
  assert.equal(await page.locator('.vote-bar-track').count(), 0, 'still no bars after casting, before closing');

  await page.click('#votes-close');
  await page.waitForSelector('#votes-start');
  // Closing reveals every ranked game in the compact "Aktueller Vote" group;
  // the optional detail modal retains the full bar presentation.
  await page.waitForSelector('text=Aktueller Vote');
  await page.waitForFunction(() => document.querySelectorAll('section[aria-labelledby="vote-current-result-title"] .lb-row').length >= 2);
  const currentVote = page.locator('section[aria-labelledby="vote-current-result-title"]');
  assert.equal(await currentVote.locator('.lb-row.is-tied').count(), 2);
  assert.deepEqual(await currentVote.locator('.lb-row.is-tied .lb-rank').allTextContents(), ['1', '1']);
  assert.equal(await currentVote.getByText('Unentschieden', { exact: true }).count(), 0);
  assert.equal(await currentVote.locator('#votes-runoff').count(), 1, 'the runoff action belongs to the current Vote card');
  assert.equal(await page.locator('section[aria-labelledby="vote-runoff-title"]').count(), 0, 'no separate runoff card remains');
  assert.equal(await page.locator('.vote-bar-track').count(), 0, 'no bars on the main page, even after closing');
  assert.equal(await page.locator('details.history-details:has(summary:has-text("Historie"))').getAttribute('open'), null);

  // The just-closed round can be reopened from the history list for the
  // full detailed breakdown.
  await page.click('details.history-details:has(summary:has-text("Historie")) > summary');
  await page.waitForFunction(() => document.querySelectorAll('.vote-history-round .lb-row').length >= 2);
  await page.click('[data-open-history-round]');
  await page.waitForSelector('text=Abstimmung Runde 1');
  await page.waitForSelector('.modal .vote-bar-track');
  await page.click('[data-close]');

  // Leaderboard: record a match and see it reflected.
  await page.click('[data-view="leaderboard"]');
  await page.waitForSelector('h1:text-is("Rang")');
  assert.equal(
    await page.locator('section.grouped-page-section:has(> .grouped-page-section-title > h2:text-is("Rangliste & Spielzeit"))').count(),
    1,
    'filtered ranking and playtime should share one grouped section'
  );
  for (const title of ['Rangliste', 'Spielzeit']) {
    assert.equal(
      await page.locator(`section[aria-labelledby="leaderboard-filtered-title"] section.tournament-section-panel:has(h2:text-is("${title}"))`).count(),
      1,
      `${title} should remain an accented subsection`
    );
  }
  assert.equal(
    await page.locator('section.grouped-page-section:has(> .grouped-page-section-title > h2:text-is("Spielzeit pro Spiel"))').count(),
    1,
    'per-game playtime should remain a separate grouped section'
  );
  assert.equal(
    await page.locator('section[aria-labelledby="leaderboard-filtered-title"] #lb-filter').count(),
    1,
    'the game filter belongs to the shared filtered section'
  );
  for (const grid of await page.locator('.leaderboard-list-grid').all()) {
    assert.equal(
      await grid.evaluate((element) => getComputedStyle(element).gridTemplateColumns.split(' ').length),
      1,
      'leaderboard lists should stay single-column on phones'
    );
  }
  await page.setViewportSize({ width: 900, height: 844 });
  for (const grid of await page.locator('.leaderboard-list-grid').all()) {
    assert.equal(
      await grid.evaluate((element) => getComputedStyle(element).gridTemplateColumns.split(' ').length),
      2,
      'leaderboard lists should use two columns when space is available'
    );
  }
  await page.setViewportSize({ width: 390, height: 844 });
  const filteredGameId = await page.locator('#lb-filter option').nth(2).getAttribute('value');
  assert.ok(filteredGameId);
  const [filteredPlaytimeResponse, allPlaytimeResponse] = await Promise.all([
    page.waitForResponse((response) => {
      const url = new URL(response.url());
      return url.pathname === '/api/stats/playtime' && url.searchParams.get('gameId') === filteredGameId;
    }),
    page.waitForResponse((response) => {
      const url = new URL(response.url());
      return url.pathname === '/api/stats/playtime' && !url.searchParams.has('gameId');
    }),
    page.selectOption('#lb-filter', filteredGameId),
  ]);
  assert.equal(filteredPlaytimeResponse.ok(), true, 'per-player playtime should follow the selected game');
  assert.equal(allPlaytimeResponse.ok(), true, 'per-game playtime should keep loading all games');
  await page.click('#add-match-btn');
  await page.waitForSelector('#match-players');
  assert.deepEqual(
    await page.locator('#match-form .match-form-section h2').allTextContents(),
    ['Modus', 'Spieler-Zuordnung', 'Ergebnis']
  );
  assert.equal(
    await page.locator('#match-form').evaluate((element) => element.scrollWidth <= element.clientWidth),
    true,
    'the result form should not overflow at phone width'
  );
  await page.check('#match-advanced');
  assert.equal(await page.locator('.match-result-row').count(), 2);
  assert.equal(
    await page.locator('#match-form').evaluate((element) => element.scrollWidth <= element.clientWidth),
    true,
    'advanced result fields should remain inside the result group'
  );
  await page.uncheck('#match-advanced');
  const teamSelects = page.locator('[data-team-for]');
  await teamSelects.nth(0).selectOption('0');
  await teamSelects.nth(1).selectOption('1');
  await page.check('input[name="winner"][value="0"]');
  await page.click('#match-form button[type="submit"]');
  await page.waitForSelector('.lb-row');
  assert.ok((await page.locator('.lb-row').count()) >= 2);
  const leaderboardNameTypography = await page.locator('.lb-row .player-name').first().evaluate((element) => {
    const style = getComputedStyle(element);
    return { family: style.fontFamily, size: style.fontSize, weight: style.fontWeight };
  });
  await page.waitForSelector('text=Spielzeit');

  // Back to Home: should now show both players (offline, since no agent ran).
  await page.click('[data-view="home"]');
  await page.waitForSelector('.player-card');
  assert.equal(await page.locator('.player-card').count(), 2);
  for (const title of ['Live-Status', 'Rangliste', 'Sitzplan']) {
    assert.equal(
      await page.locator(`section.home-page-section:has(h2:text-is("${title}"))`).count(),
      1,
      `${title} should be presented as a grouped Home section`
    );
  }
  const liveNameTypography = await page.locator('.player-card .player-name').first().evaluate((element) => {
    const style = getComputedStyle(element);
    return { family: style.fontFamily, size: style.fontSize, weight: style.fontWeight };
  });
  assert.deepEqual(liveNameTypography, leaderboardNameTypography, 'player names should use one shared typography');
  await page.setViewportSize({ width: 900, height: 844 });
  assert.equal(
    await page.locator('.home-leaderboard-columns').evaluate((element) => getComputedStyle(element).gridTemplateColumns.split(' ').length),
    2,
    'home leaderboard should use two columns when the card has enough width'
  );
  await page.setViewportSize({ width: 390, height: 844 });

  // Manual pause override (FR-28): the pause toggle lives in the "Dein
  // Status" bar, not on the player's own tile. Toggle pause, see the badge
  // flip, then toggle back.
  await page.click('[data-toggle-pause]');
  await page.waitForSelector('.badge-paused');
  await page.click('[data-toggle-pause]');
  await page.waitForFunction(() => !document.querySelector('.badge-paused'));
});

test('matchmaking Historie marks a recorded draw as Unentschieden', async () => {
  await page.click('[data-view="matchmaking"]');
  await page.click('#mm-generate');
  await openMatchmakingHistory();
  await page.waitForSelector('[data-record-draw]');
  await page.click('[data-record-draw]');

  // "Unentschieden" is the default winner radio in the result form — submit
  // as-is to record a drawn result.
  await page.waitForSelector('#match-form');
  await page.click('#match-form button[type="submit"]');

  await page.waitForFunction(() => !!document.querySelector('[data-edit-draw-result]'));
  await openMatchmakingHistory();
  await page.waitForSelector('[data-draw-card] .badge:has-text("Unentschieden")');
});

test('matchmaking Historie shows the winner after switching to Frei-für-alle for a drawn lineup', async () => {
  // Regression test: teams were drawn, but the result was entered as
  // "Frei-für-alle" instead of the drawn team shape — the draw must still
  // remain in Historie with the winner shown instead of retaining the open
  // draw actions.
  await page.click('[data-view="matchmaking"]');
  await page.click('#mm-generate');
  await openMatchmakingHistory();
  await page.waitForSelector('[data-record-draw]');
  await page.click('[data-record-draw]');

  await page.waitForSelector('#match-form');
  await page.check('#match-ffa');
  await page.waitForSelector('input[name="ffa-winner"]');
  // First radio is a real participant (the "Kein Sieger" fallback is last).
  await page.check('input[name="ffa-winner"] >> nth=0');
  await page.click('#match-form button[type="submit"]');

  await page.waitForFunction(() => !!document.querySelector('[data-edit-draw-result]'));
  await openMatchmakingHistory();
  await page.waitForSelector('[data-draw-card] .matchmaking-draw-team.is-winner');
});

test('Ergebnis eintragen keeps a manual team reassignment after changing "Anzahl Teams"', async () => {
  // Regression test: reassigning a player to a different team in the entry
  // form, then changing "Anzahl Teams", must not silently revert that player
  // back to the original drawn team.
  await page.click('[data-view="matchmaking"]');
  await page.click('#mm-generate');
  await openMatchmakingHistory();
  await page.waitForSelector('[data-record-draw]');
  await page.click('[data-record-draw]');
  await page.waitForSelector('#match-players');

  const teamSelects = page.locator('[data-team-for]');
  const firstPlayerId = await teamSelects.nth(0).getAttribute('data-team-for');
  const originalValue = await teamSelects.nth(0).inputValue();
  const otherValue = originalValue === '0' ? '1' : '0';
  await teamSelects.nth(0).selectOption(otherValue);

  // Bumping team count re-renders the player list — the manual reassignment
  // just made must survive that re-render.
  await page.fill('#match-teamcount', '3');
  await page.waitForSelector('[data-team-for]');
  const reselected = page.locator(`[data-team-for="${firstPlayerId}"]`);
  assert.equal(await reselected.inputValue(), otherValue);
});

test('Auswertungen (via Mehr) shows a real award and keeps detail logs collapsed', async () => {
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

  // The noisy concurrency controls are intentionally gone. The session log
  // remains available on demand, but starts collapsed.
  assert.equal(await page.locator('#an-concurrency-game').count(), 0);
  const sessionLog = page.locator('details:has(summary:has-text("Session-Protokoll"))');
  assert.equal(await sessionLog.getAttribute('open'), null);
  await page.waitForSelector('text=Längste individuelle Session pro Spiel');

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
  // Profile-local neighbor/push state loads immediately after the first
  // paint and can replace the form once. Let that initial render settle so
  // the test never types into a form that is about to be detached.
  await page.waitForTimeout(250);
  assert.equal(await page.inputValue('#profile-name'), 'E2E Alice');

  // Renaming to a name someone else already has must be rejected, not
  // silently accepted or crash the view.
  await page.fill('#profile-name', 'E2E Bob');
  const conflictResponse = page.waitForResponse(
    (response) => response.url().includes('/api/players/') && response.request().method() === 'PATCH'
  );
  await page.click('#profile-save');
  const conflict = await conflictResponse;
  assert.equal(conflict.status(), 409, `duplicate rename returned: ${await conflict.text()}`);
  assert.equal(await page.inputValue('#profile-name'), 'E2E Bob');

  // A genuinely free name should save fine.
  await page.fill('#profile-name', 'E2E Alice Pro');
  const renameResponse = page.waitForResponse(
    (response) => response.url().includes('/api/players/') && response.request().method() === 'PATCH'
  );
  await page.click('#profile-save');
  const renamed = await renameResponse;
  assert.ok(renamed.ok(), `profile rename failed (${renamed.status()}): ${await renamed.text()}`);
  await page.waitForSelector('.toast:has-text("Gespeichert")');
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
  await page.click('[data-view="more"]');
  await page.click('[data-navigate="admin"]');
  await page.click('#admin-activate');
  await page.waitForSelector('#admin-banner:not([hidden])');
  await page.click('[data-view="more"]');
  await page.click('[data-navigate="admin"]');
  await page.click('[data-navigate="seating"]');
  await page.waitForSelector('[data-seat-pool] [data-player-id]');
  await page.locator('[data-seat-pool] [data-player-id]', { hasText: 'E2E Alice Pro' }).click();
  await page.locator('[data-seat-side="top"][data-seat-index="0"]').click();
  await page.waitForSelector('.seating-seat.is-occupied .seating-seat-realname:has-text("Alice Musterfrau")');

  // Same shared renderSeatingPlan() component also feeds Home's read-only
  // board - the real name must show up there too, unprompted. Check the
  // requested side-by-side desktop layout separately from the intentionally
  // stacked narrow-screen variant used by the rest of this suite.
  await page.setViewportSize({ width: 900, height: 844 });
  await page.click('[data-view="home"]');
  await page.waitForSelector('.seating-seat-realname:has-text("Alice Musterfrau")');
  const homeSeatName = page.locator('.live-seating .seating-seat.is-occupied .seating-seat-name', { hasText: 'E2E Alice Pro' });
  await homeSeatName.waitFor();
  assert.equal(await homeSeatName.evaluate((element) => getComputedStyle(element).fontWeight), '600');
  assert.equal(await homeSeatName.evaluate((element) => getComputedStyle(element).textAlign), 'left');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.click('#admin-banner-leave');
  await page.waitForSelector('#admin-banner', { state: 'hidden' });
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
  const neighborHelp = page.locator('[aria-controls="tournament-neighbors-help"]');
  const scoreHelp = page.locator('[aria-controls="tournament-score-help"]');
  const lobbyHelp = page.locator('[aria-controls="tournament-lobby-help"]');
  assert.ok((await page.locator('[data-create-player]').count()) >= 2);
  assert.equal(
    await page.locator('.tournament-player-grid').evaluate((element) => getComputedStyle(element).gridTemplateColumns.split(' ').length),
    2,
  );
  await neighborHelp.click();
  assert.equal(await neighborHelp.getAttribute('aria-expanded'), 'true');
  await scoreHelp.click();
  assert.equal(await neighborHelp.getAttribute('aria-expanded'), 'false');
  assert.equal(await scoreHelp.getAttribute('aria-expanded'), 'true');
  await page.keyboard.press('Escape');
  assert.equal(await scoreHelp.getAttribute('aria-expanded'), 'false');
  await neighborHelp.focus();
  await page.keyboard.press('Enter');
  assert.equal(await neighborHelp.getAttribute('aria-expanded'), 'true');
  await page.keyboard.press('Escape');
  await lobbyHelp.click();
  assert.equal(await lobbyHelp.getAttribute('aria-expanded'), 'true');
  await page.keyboard.press('Escape');

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

test('Info: create an entry, see it rendered', async () => {
  await page.click('[data-view="more"]');
  await page.click('[data-navigate="infoBoard"]');
  await page.waitForSelector('#info-new-btn');
  await page.click('#info-new-btn');
  await page.fill('#info-title', 'WLAN');
  await page.fill('#info-content', 'Netz: Respawn\nPasswort: kartoffel');
  await page.click('#info-form button[type="submit"]');
  await page.waitForSelector('text=kartoffel');
});

test('Essensbestellung: open an order with a send time/notes/link, edit them, add a priced item, close it', async () => {
  await page.click('[data-view="more"]');
  await page.click('[data-navigate="foodOrders"]');
  await page.waitForSelector('#order-new-btn');
  await page.click('#order-new-btn');
  await page.fill('#order-title', "Pizza bei Luigi's");
  await setDateTimeField('order-sendat', '2026-12-24T20:00');
  await page.fill('#order-notes', 'Mindestbestellwert 15€, bar zahlen');
  await page.fill('#order-link', 'https://luigis-pizza.example/karte');
  await page.click('#order-form button[type="submit"]');
  await page.waitForSelector('text=Pizza bei Luigi');
  await page.waitForSelector('text=Versand 24.12., 20:00 Uhr');
  await page.waitForSelector('text=Mindestbestellwert 15€, bar zahlen');
  await page.waitForSelector('a[href="https://luigis-pizza.example/karte"]');

  // The send time / notes / link are editable after the fact (independent of closing).
  await page.click('[data-edit-details]');
  await setDateTimeField('sendat-input', '2026-12-24T21:30');
  await page.fill('#notes-input', 'Doch Kartenzahlung möglich');
  await page.click('#details-form button[type="submit"]');
  await page.waitForSelector('text=Versand 24.12., 21:30 Uhr');
  await page.waitForSelector('text=Doch Kartenzahlung möglich');

  await page.fill('[data-item-desc]', 'Margherita groß');
  await page.fill('[data-item-quantity]', '2');
  await page.fill('[data-item-price]', '9,50');
  await page.click('[data-add-item-form] button[type="submit"]');
  await page.waitForSelector('text=Margherita');
  await page.waitForSelector('text=19,00 €');
  await page.waitForSelector('text=Zwischensumme');
  await page.waitForSelector('text=Gesamtsumme');

  // Content search resolves an item description to its parent order and
  // highlights that concrete order instead of only opening the Essen area.
  await page.keyboard.press('Control+K');
  await page.fill('#global-search-input', 'Margherita groß');
  await page.waitForSelector('.global-search-result:has-text("Pizza bei Luigi")');
  await page.click('.global-search-result:has-text("Pizza bei Luigi")');
  await page.waitForSelector('[data-order-card].search-target-highlight');

  await page.click('[data-close-order]');
  // confirmDialog is an in-app modal (not a native browser dialog).
  await page.click('[data-confirm]');
  await page.waitForSelector('[data-food-history]');
  await page.click('[data-food-history] > summary');
  await page.waitForSelector('.badge-offline >> text=Geschlossen');

  // Closing only freezes items — the details stay correctable afterward.
  await page.click('[data-edit-details]');
  await setDateTimeField('sendat-input', '2026-12-24T22:00');
  await page.click('#details-form button[type="submit"]');
  await page.waitForSelector('text=Versand 24.12., 22:00 Uhr');
});

test('Arcade: open a quiz lobby, see it on Home, then close it again', async (t) => {
  const players = (await (await fetch(`${BASE_URL}/api/players`)).json()) as Array<{ id: string; name: string }>;
  let guest = players.find((player) => player.name === 'E2E Bob');
  if (!guest) {
    const created = await page.request.post(`${BASE_URL}/api/players`, { data: { name: 'E2E Bob' } });
    assert.ok(created.ok(), `guest setup failed (${created.status()}): ${await created.text()}`);
    guest = await created.json() as { id: string; name: string };
  }
  const guestContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const guestPage = await guestContext.newPage();
  t.after(async () => guestContext.close());
  await guestPage.goto(BASE_URL);
  await guestPage.evaluate((id) => localStorage.setItem('respawn_my_player_id', id), guest.id);
  await guestPage.reload();
  await guestPage.waitForSelector('.nav-btn[data-view="home"]');

  await page.click('[data-view="more"]');
  await page.click('[data-navigate="arcade"]');
  // Arcade is a launcher; select the quiz tile before its lobby controls
  // become visible (module state is intentionally reset on a fresh run).
  await page.click('[data-game="quiz"]');
  await page.waitForSelector('#quiz-create-lobby');
  await page.click('#quiz-create-lobby');
  await page.waitForSelector('[data-close-lobby]');
  await guestPage.click('#notifications-btn');
  await guestPage.waitForSelector('#notifications-panel:has-text("Neue Quiz-Lobby")');
  await guestPage.click('[data-notification-close]');

  // The open lobby also shows up on Home as a compact "Aktuell" row that
  // deep-links back into the Arcade (the whole row is the tap target, not a
  // separate labeled button — see statusRowHtml in home.js). No tile click
  // needed there: the launcher force-expands the game whose lobby you're in.
  await page.click('[data-view="home"]');
  await page.click('button:has-text("Gaming-Quiz-Lobby offen")');
  await page.waitForSelector('#arcade-active-game-title:has-text("Gaming-Quiz")');

  // The host sees their own lobby with a "Schließen" button instead of a
  // join button/"Drin" badge - closing was previously impossible (the only
  // way to get rid of a lobby was to disconnect the socket, e.g. by closing
  // the tab), leaving abandoned lobbies listed forever.
  await page.waitForSelector('[data-close-lobby]');

  // An open lobby must not lock the launcher to its game. The host can still
  // inspect another game's lobbies and return without closing their own.
  await page.click('[data-game="tetris"]');
  await page.waitForSelector('#tetris-create');
  await page.click('[data-game="quiz"]');
  await page.waitForSelector('[data-close-lobby]');

  await page.click('[data-close-lobby]');
  await page.waitForSelector('text=Keine offene Quiz-Lobby.');

  // Closed - the create button is enabled again.
  await page.waitForSelector('#quiz-create-lobby:not([disabled])');
});

test('Arcade: joining Pong or Blobby warns and closes the owned lobby first', async () => {
  const players = (await (await fetch(`${BASE_URL}/api/players`)).json()) as Array<{ id: string; name: string }>;
  const guest = players.find((p) => p.name === 'E2E Bob');
  assert.ok(guest, 'expected "E2E Bob" (added by an earlier test) to exist');

  const guestContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const guestPage = await guestContext.newPage();
  try {
    await guestPage.goto(BASE_URL);
    await guestPage.evaluate((id) => localStorage.setItem('respawn_my_player_id', id), guest!.id);
    await guestPage.reload();
    await guestPage.waitForSelector('.nav-btn[data-view="more"]');
    await guestPage.click('[data-view="more"]');
    await guestPage.click('[data-navigate="arcade"]');

    for (const game of ['pong', 'blobby'] as const) {
      if ((await page.locator('#quiz-create-lobby').count()) === 0) await page.click('[data-game="quiz"]');
      await page.waitForSelector('#quiz-create-lobby:not([disabled])');
      await page.click('#quiz-create-lobby');

      // Opening another lobby uses the same guarded switch flow.
      await page.click('[data-game="tetris"]');
      await page.click('#tetris-create');
      await page.waitForSelector('text=Wenn du eine neue Lobby öffnest, wird deine eigene Lobby aufgelöst.');
      await page.click('[data-cancel]');
      await page.click('[data-game="quiz"]');
      await page.waitForSelector('[data-close-lobby]');

      await guestPage.click(`[data-game="${game}"]`);
      await guestPage.waitForSelector(`#${game}-create:not([disabled])`);
      await guestPage.click(`#${game}-create`);
      await guestPage.waitForSelector(`.arcade-lobby-control-bar select[name="${game}-target"]`);
      assert.equal(
        await guestPage.locator(`.arcade-lobby-control-bar select[name="${game}-target"]`).inputValue(),
        '7',
      );

      await page.click(`[data-game="${game}"]`);
      await page.waitForSelector(`[data-${game}-join]`);
      await page.click(`[data-${game}-join]`);
      await page.waitForSelector('text=Wenn du dieser Lobby beitrittst, wird deine eigene Lobby aufgelöst.');

      // Cancelling must keep the owned lobby intact.
      await page.click('[data-cancel]');
      await page.click('[data-game="quiz"]');
      await page.waitForSelector('[data-close-lobby]');

      await page.click(`[data-game="${game}"]`);
      await page.click(`[data-${game}-join]`);
      await page.click('[data-confirm]');
      await page.waitForSelector(`[data-${game}-leave]`);

      await page.click('[data-game="quiz"]');
      await page.waitForSelector('text=Keine offene Quiz-Lobby.');

      await guestPage.waitForSelector(`[data-${game}-close]`);
      await guestPage.click(`[data-${game}-close]`);
      await page.click(`[data-game="${game}"]`);
      await page.waitForSelector(`text=Keine offene ${game === 'pong' ? 'Pong' : 'Blobby-Volley'}-Lobby.`);
    }
  } finally {
    await guestContext.close();
  }
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
    await guestPage.evaluate((id) => localStorage.setItem('respawn_my_player_id', id), guest!.id);
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

test('Arcade: a non-player can watch a running quiz without seeing the question', async () => {
  const players = (await (await fetch(`${BASE_URL}/api/players`)).json()) as Array<{ id: string; name: string }>;
  const guest = players.find((p) => p.name === 'E2E Bob');
  const spectator = players.find((p) => p.name === 'Analytics E2E Player');
  assert.ok(guest, 'expected "E2E Bob" to exist');
  assert.ok(spectator, 'expected "Analytics E2E Player" to exist');

  const guestContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const spectatorContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const guestPage = await guestContext.newPage();
  const spectatorPage = await spectatorContext.newPage();
  try {
    await guestPage.goto(BASE_URL);
    await guestPage.evaluate((id) => localStorage.setItem('respawn_my_player_id', id), guest!.id);
    await guestPage.reload();
    await guestPage.waitForSelector('.nav-btn[data-view="more"]');
    await guestPage.click('[data-view="more"]');
    await guestPage.click('[data-navigate="arcade"]');
    await guestPage.click('[data-game="quiz"]');

    if ((await page.locator('#quiz-create-lobby').count()) === 0) await page.click('[data-game="quiz"]');
    await page.waitForSelector('#quiz-create-lobby:not([disabled])');
    await page.click('#quiz-create-lobby');
    await guestPage.waitForSelector('[data-join-lobby]');
    await guestPage.click('[data-join-lobby]');
    await page.waitForSelector('#quiz-start-lobby:not([disabled])');
    await guestPage.waitForSelector('[data-quiz-ready][data-ready="1"]');
    await guestPage.click('[data-quiz-ready][data-ready="1"]');
    await page.waitForSelector('text=2/2 bereit');
    await page.click('#quiz-start-lobby');
    await page.waitForSelector('#quiz-answer-form');

    await spectatorPage.goto(BASE_URL);
    await spectatorPage.evaluate((id) => localStorage.setItem('respawn_my_player_id', id), spectator!.id);
    await spectatorPage.reload();
    await spectatorPage.waitForSelector('.nav-btn[data-view="more"]');
    await spectatorPage.click('[data-view="more"]');
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
  const spectator = players.find((p) => p.name === 'Analytics E2E Player');
  assert.ok(guesser, 'expected "E2E Bob" (added by an earlier test) to exist');
  assert.ok(spectator, 'expected "Analytics E2E Player" to exist');

  const guesserContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const spectatorContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const guesserPage = await guesserContext.newPage();
  const spectatorPage = await spectatorContext.newPage();
  guesserPage.on('pageerror', (err) => console.error('[guesser pageerror]', err.message));
  spectatorPage.on('pageerror', (err) => console.error('[spectator pageerror]', err.message));
  try {
    await guesserPage.goto(BASE_URL);
    await guesserPage.evaluate((id) => localStorage.setItem('respawn_my_player_id', id), guesser!.id);
    await guesserPage.reload();
    await guesserPage.waitForSelector('.nav-btn[data-view="more"]');
    await guesserPage.click('[data-view="more"]');
    await guesserPage.click('[data-navigate="arcade"]');
    await guesserPage.click('[data-game="scribble"]');

    await spectatorPage.goto(BASE_URL);
    await spectatorPage.evaluate((id) => localStorage.setItem('respawn_my_player_id', id), spectator!.id);
    await spectatorPage.reload();
    await spectatorPage.waitForSelector('.nav-btn[data-view="more"]');
    await spectatorPage.click('[data-view="more"]');
    await spectatorPage.click('[data-navigate="arcade"]');

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

    await page.waitForSelector('#scribble-canvas');
    const box = await page.locator('#scribble-canvas').boundingBox();
    await page.mouse.move(box!.x + 20, box!.y + 20);
    await page.mouse.down();
    await page.mouse.move(box!.x + 120, box!.y + 90, { steps: 8 });
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
        new Promise<void>((resolve) => {
          const probe = (window as any).io();
          probe.once('arcade:watch:list', () => {
            probe.close();
            setTimeout(resolve, 0);
          });
          probe.emit('arcade:watch:list');
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
    const box2 = await page.locator('#scribble-canvas').boundingBox();
    await page.mouse.move(box2!.x + 200, box2!.y + 20);
    await page.mouse.down();
    await page.mouse.move(box2!.x + 260, box2!.y + 60, { steps: 8 });
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

    // The last drawing stays rateable while the next turn begins. Artists
    // cannot rate their own work; the guesser can choose one of the named
    // reactions and the shared count updates immediately.
    await guesserPage.click('[data-drawing-reaction="creative"]:not([disabled])');
    await guesserPage.waitForSelector('[data-reaction-count$=":creative"]:has-text("1")');
    await spectatorPage.waitForSelector('text=Letztes Bild bewerten');
    await spectatorPage.click('[data-watch-reaction="cool"]:not([disabled])');
    await spectatorPage.waitForSelector('[data-watch-reaction="cool"] span:has-text("1")');
    assert.equal(await spectatorPage.getByText(chosenWord, { exact: true }).count(), 0, 'the reveal word stays private from watchers');

    // Finish the second turn so the one-round match enters its gallery.
    await guesserPage.waitForSelector('.scribble-word-choice-btn');
    const secondWordBtn = guesserPage.locator('.scribble-word-choice-btn').first();
    const secondWord = (await secondWordBtn.textContent())!.trim();
    await secondWordBtn.click();
    await page.waitForSelector('#scribble-guess-input');
    await page.fill('#scribble-guess-input', secondWord);
    await page.click('#scribble-guess-form button[type="submit"]');

    await page.waitForSelector('.scribble-round-gallery');
    await guesserPage.waitForSelector('.scribble-round-gallery');
    await spectatorPage.waitForSelector('.scribble-round-gallery');
    assert.equal(await page.locator('.scribble-round-gallery .scribble-drawing-card').count(), 2);
    assert.equal(await guesserPage.locator('.scribble-round-gallery .scribble-drawing-card').count(), 2);
    assert.equal(await spectatorPage.locator('.scribble-round-gallery .scribble-drawing-card').count(), 2);

    // Each player picks the other artist's image; the watcher adds a third,
    // persisted vote. The gallery only resolves after all three eligible
    // identities voted, and the spectator sees the same winner.
    await spectatorPage.click('[data-watch-favorite]:not([disabled])');
    await page.click('[data-favorite-drawing]:not([disabled])');
    await guesserPage.click('[data-favorite-drawing]:not([disabled])');
    await page.waitForSelector('text=Rundenbild gekürt');
    await page.waitForSelector('.scribble-drawing-card.is-winner');
    await guesserPage.waitForSelector('.scribble-drawing-card.is-winner');
    await spectatorPage.waitForSelector('text=Rundenbild gekürt');
    await spectatorPage.waitForSelector('.scribble-drawing-card.is-winner');

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

test('An- & Abreise: carpool marks the driver, enforces seats, driver can only delete', async () => {
  // A third player to later demonstrate a full carpool.
  await page.click('[data-view="more"]');
  await page.click('[data-navigate="players"]');
  await createPlayerForFlow('E2E Carol');

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
  await switchIdentityAndOpenArrivals('E2E Bob');
  await page.waitForSelector('[data-join-carpool]');
  await page.click('[data-join-carpool]');
  await page.waitForSelector('text=0/1 frei');
  await page.waitForSelector('[data-leave-carpool]');

  // A third player finds the carpool full and can't join.
  await switchIdentityAndOpenArrivals('E2E Carol');
  await page.waitForSelector('text=Voll');
  assert.equal(await page.locator('[data-join-carpool]').count(), 0);

  // Bob leaves, freeing the seat back up; the driver deletes the group.
  await switchIdentityAndOpenArrivals('E2E Bob');
  await page.click('[data-leave-carpool]');
  await page.waitForSelector('text=1/1 frei');

  await switchIdentityAndOpenArrivals('E2E Alice Pro');
  await page.click('[data-remove-carpool]');
  await page.click('[data-confirm]');
  await page.waitForSelector('text=Noch keine Fahrgemeinschaft.');
});

test('Durchsage: notification center can navigate, mark read and remove without duplicating Home', async () => {
  await page.click('[data-view="more"]');
  await page.click('[data-navigate="broadcast"]');
  await page.waitForSelector('#broadcast-message');
  const defaultEndsAt = new Date(await page.inputValue('#broadcast-ends-at')).getTime();
  assert.ok(defaultEndsAt >= Date.now() + 55 * 60 * 1000);
  assert.ok(defaultEndsAt <= Date.now() + 65 * 60 * 1000);
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

  // The highlighted strip shows the newest active push on any view and
  // deep-links back into Durchsagen. Opening it marks the entry as read,
  // while the bell keeps it in the durable history.
  await page.click('[data-view="leaderboard"]');
  const highlight = page.locator('#notification-highlight:has-text("Essen ist da!")');
  await highlight.waitFor();
  await highlight.locator('[data-notification-highlight-navigate]').click();
  await page.waitForSelector('#broadcast-message');
  await page.waitForSelector('#notification-highlight', { state: 'hidden' });

  await page.click('#notifications-btn');
  assert.equal(await page.getAttribute('#notifications-btn', 'aria-expanded'), 'true');
  assert.equal(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    true,
    'notification center must not create horizontal page scroll on mobile',
  );
  const panelBox = await page.locator('#notifications-panel').boundingBox();
  assert.ok(panelBox && panelBox.x >= 0 && panelBox.x + panelBox.width <= 390);
  await page.keyboard.press('Escape');
  await page.waitForSelector('#notifications-panel', { state: 'hidden' });
  assert.equal(await page.getAttribute('#notifications-btn', 'aria-expanded'), 'false');
  assert.equal(await page.evaluate(() => document.activeElement?.id), 'notifications-btn');
  await page.click('#notifications-btn');
  const foodNotification = page.locator('.notification-center-entry:has-text("Essen ist da!")');
  await foodNotification.waitFor();
  assert.equal(await foodNotification.locator('.badge:has-text("Neu")').count(), 0);

  // Removing is personal and leaves the durable Durchsage itself intact.
  await foodNotification.locator('[data-notification-hide]').click();
  await foodNotification.waitFor({ state: 'detached' });
  await page.click('[data-notification-close]');
  await page.waitForSelector('.lb-row >> text=Essen ist da!');

  // Home no longer renders a second notification history in a different
  // style; notifications live only under the bell.
  await page.click('[data-view="home"]');
  assert.equal(await page.locator('.section-title:has-text("Mitteilungen")').count(), 0);

  // A second message can be ended early by its creator; it remains a past
  // notification until this player removes it from the center.
  await page.click('[data-view="more"]');
  await page.click('[data-navigate="broadcast"]');
  await page.fill('#broadcast-message', 'Turnier startet gleich!');
  await page.click('#broadcast-form button[type="submit"]');
  const activeRow = page.locator('.lb-row:has-text("Turnier startet gleich!")');
  await activeRow.waitFor();
  await activeRow.locator('[data-end-broadcast]').click();
  await activeRow.locator('text=Beendet am').waitFor();
  await page.click('#notifications-btn');
  const endedNotification = page.locator('.notification-center-entry:has-text("Turnier startet gleich!")');
  await endedNotification.waitFor();
  await endedNotification.locator('.badge:has-text("Neu")').waitFor();
  await page.click('[data-notifications-seen-all]');
  await page.waitForFunction(() => document.querySelectorAll('.notification-center-entry .badge:where(.badge-playing)').length === 0);
  await page.click('[data-notifications-hide-all]');
  await page.click('[data-confirm]');
  await page.click('#notifications-btn');
  await page.waitForSelector('text=Keine Mitteilungen.');
  await page.click('[data-notification-close]');

  // A visible time-limited banner removes itself at its deadline even when
  // no later socket event happens and the user never clicks it.
  const myId = await page.evaluate(() => localStorage.getItem('respawn_my_player_id'));
  assert.ok(myId);
  const expiring = await page.request.post(`${BASE_URL}/api/broadcasts`, {
    data: { playerId: myId, message: 'Läuft automatisch ab', endsAt: Date.now() + 2000 },
  });
  assert.equal(expiring.status(), 201);
  await page.waitForSelector('#notification-highlight:has-text("Läuft automatisch ab")');
  await page.waitForSelector('#notification-highlight', { state: 'hidden', timeout: 5000 });
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

  // The finished draft landed in the shared Historie (not pinned to the
  // page top) with the usual "Ergebnis eintragen" follow-up available there.
  await page.waitForSelector('details.history-details:has(summary:has-text("Historie"))');
  await openMatchmakingHistory();
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

test('Aktuell: an open vote\'s title (if set) shows on Home\'s status card', async () => {
  await page.click('[data-view="votes"]');
  await page.waitForSelector('#votes-title');
  await page.fill('#votes-title', 'Freitagabend-Runde');
  await page.click('#votes-start');
  await page.waitForSelector('#votes-close'); // only rendered once ctx.refresh() shows the round as open

  await page.click('[data-view="home"]');
  await page.waitForSelector('section.home-page-section:has(h2:text-is("Aktuell"))');
  await page.waitForSelector('text=Freitagabend-Runde');

  // Leave no open round behind for later tests.
  await page.click('[data-view="votes"]');
  await page.click('#votes-close');
  await page.waitForSelector('#votes-start');
});

test('Kiosk: centers tournament content and shows only the latest feature push across the full width', async () => {
  const playersRes = await page.request.get(`${BASE_URL}/api/players`);
  const [{ id: playerId }] = await playersRes.json();

  // Send a Durchsage first, then trigger a different feature's push (opening
  // a food order) — the banner must show the *food order's* push afterward,
  // proving it reflects any notifyPlayers() call, not only Durchsagen.
  await page.request.post(`${BASE_URL}/api/broadcasts`, {
    data: { playerId, message: 'Kiosk-Test-Durchsage' },
  });
  await page.request.post(`${BASE_URL}/api/votes/start`, { data: { mode: 'single' } });
  const opponent = await page.request.post(`${BASE_URL}/api/players`, { data: { name: 'Kiosk Gegner' } });
  const opponentId = (await opponent.json()).id;
  const games = await (await page.request.get(`${BASE_URL}/api/games`)).json();
  await page.request.post(`${BASE_URL}/api/tournaments`, {
    data: {
      gameId: games[0].id,
      format: 'single_elimination',
      teams: [
        { name: 'Kiosk Team Blau', playerIds: [playerId] },
        { name: 'Kiosk Team Pink', playerIds: [opponentId] },
      ],
    },
  });
  const sendAt = Date.now() + 3600_000;
  await page.request.post(`${BASE_URL}/api/food-orders`, {
    data: { playerId, title: 'Kiosk-Test-Pizza', sendAt, link: 'https://kiosk-test.example/karte' },
  });

  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto(`${BASE_URL}/kiosk.html`);
  assert.equal((await page.locator('.kiosk-header .brand-title').textContent())?.trim(), 'Respawn');

  // The last-push banner shows the food order's own push (title "Neue
  // Sammelbestellung"), not the earlier Durchsage — with a timestamp, and
  // it stays up permanently rather than auto-hiding after a few minutes.
  await page.waitForSelector('#kiosk-broadcast:not([hidden]) >> text=Neue Sammelbestellung');
  await page.waitForSelector('#kiosk-broadcast >> text=Kiosk-Test-Pizza');
  await page.waitForSelector('.kiosk-broadcast-time');
  await page.waitForSelector('.notification-banner-body');
  await page.waitForSelector('.kiosk-vote-state');
  await page.waitForSelector('.kiosk-match-grid .kiosk-match-card');
  await page.locator('#kiosk-broadcast').evaluate((element) => Promise.all(element.getAnimations().map((animation) => animation.finished)));
  assert.equal(await page.locator('#kiosk-alerts > *').count(), 1);
  const [alertBox, bannerBox] = await Promise.all([
    page.locator('#kiosk-alerts').boundingBox(),
    page.locator('#kiosk-broadcast').boundingBox(),
  ]);
  assert.ok(
    alertBox && bannerBox && Math.abs(alertBox.width - bannerBox.width) <= 1,
    `highlighted message should fill the alert row (${JSON.stringify({ alertBox, bannerBox })})`
  );
  const [tournamentBox, overviewBox] = await Promise.all([
    page.locator('#kiosk-tournament').boundingBox(),
    page.locator('.kiosk-tournament-overview').boundingBox(),
  ]);
  assert.ok(
    tournamentBox && overviewBox && Math.abs(tournamentBox.y + tournamentBox.height / 2 - (overviewBox.y + overviewBox.height / 2)) < 4,
    'tournament content should be vertically centered in its card content area'
  );
  assert.equal(
    await page.evaluate(() => document.documentElement.scrollHeight <= window.innerHeight && document.body.scrollHeight <= window.innerHeight),
    true,
    'kiosk page must fit without page scrollbars'
  );
  assert.equal(
    await page.locator('.kiosk-card > div').evaluateAll((elements) => elements.every((element) => getComputedStyle(element).overflowY !== 'auto' && getComputedStyle(element).overflowY !== 'scroll')),
    true,
    'kiosk cards must not introduce internal scrollbars'
  );
  await page.request.post(`${BASE_URL}/api/votes/cancel`);
  await page.setViewportSize({ width: 390, height: 844 });
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
  await page.fill('#admin-count', '4');
  const seedResponse = page.waitForResponse(
    (response) => response.url().endsWith('/api/admin/test-users') && response.request().method() === 'POST'
  );
  await page.click('#admin-bulk');
  const seeded = await seedResponse;
  const seededText = await seeded.text();
  assert.ok(seeded.ok(), `test-user seed failed (${seeded.status()}): ${seededText}`);
  const seededBody = JSON.parse(seededText) as { created: Array<{ id: string; name: string }> };
  const pausedTestPlayer = seededBody.created[2];
  const pauseResponse = await page.request.post(`${BASE_URL}/api/live/${pausedTestPlayer.id}/note`, {
    data: { note: 'Pause / Essen' },
  });
  assert.ok(pauseResponse.ok(), `test-user pause failed (${pauseResponse.status()}): ${await pauseResponse.text()}`);
  await page.click('[aria-label="Mehr Informationen zu Vorhandene Test-Spieler"]');
  await page.waitForSelector('#admin-test-count-help:not([hidden]) >> text=4 Test-Spieler vorhanden');
  await page.keyboard.press('Escape');
  await page.waitForSelector('.badge-paused >> text=Test');

  const hallSeedResponse = page.waitForResponse(
    (response) => response.url().endsWith('/api/admin/test-data/hall-of-fame') && response.request().method() === 'POST'
  );
  await page.click('#admin-seed-hall');
  const hallSeeded = await hallSeedResponse;
  assert.ok(hallSeeded.ok(), `hall-of-fame seed failed (${hallSeeded.status()}): ${await hallSeeded.text()}`);
  const hallData = await page.request.get(`${BASE_URL}/api/hall-of-fame`);
  const hallBody = await hallData.json() as { events: Array<{ eventName: string; overallStandings: unknown[]; tournamentChampions: unknown[] }> };
  const testLans = hallBody.events.filter((event) => event.eventName.startsWith('Respawn Test-LAN'));
  assert.equal(testLans.length, 12);
  assert.ok(testLans.every((event) => event.overallStandings.length >= 4 && event.tournamentChampions.length === 3));

  // The shared seating plan exposes the real live state compactly after the
  // gamer name: seeded players cover playing + paused while the regular
  // roster also supplies an offline seat. The title/ARIA label keeps the
  // three colors understandable without relying on color alone.
  await page.click('[data-view="home"]');
  await page.waitForSelector('.live-seating .seating-status-indicator.is-playing[aria-label="Status: Spielt"]');
  await page.waitForSelector(`.live-seating [data-player-id="${pausedTestPlayer.id}"] .seating-status-indicator.is-paused[aria-label="Status: Pause"]`);
  await page.waitForSelector('.live-seating .seating-status-indicator.is-offline[aria-label="Status: Offline"]');
  await page.click('[data-view="more"]');
  await page.click('[data-navigate="admin"]');
  await page.click('[data-navigate="seating"]');
  await page.waitForSelector(`.seating-plan.is-editable [data-player-id="${pausedTestPlayer.id}"] .seating-status-indicator.is-paused`);

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
  await page.click('[aria-label="Mehr Informationen zu Vorhandene Test-Spieler"]');
  await page.waitForSelector('#admin-test-count-help:not([hidden]) >> text=0 Test-Spieler vorhanden');
  const cleanedHall = await (await page.request.get(`${BASE_URL}/api/hall-of-fame`)).json() as { events: Array<{ eventName: string }> };
  assert.equal(cleanedHall.events.filter((event) => event.eventName.startsWith('Respawn Test-LAN')).length, 0);
  await page.click('#admin-banner-leave');
});
