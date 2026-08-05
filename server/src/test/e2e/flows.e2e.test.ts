// Browser E2E test: drives the real built server + real Chromium through the
// main click paths (personal login, players, matchmaking, voting,
// leaderboard, game admin, tournament). Separate from the fast
// unit/integration suite (`npm test`) — run via `npm run test:e2e` since it
// spawns a server process and a browser, which is much slower.

import { test as nodeTest, before, after, TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, ChildProcess } from 'child_process';
import path from 'path';
import { chromium, Browser, Page } from 'playwright';
import { normalizeAnswer } from '../../arcade/quizLogic';
import {
  addSessionCookie,
  authenticatedServerEnv,
  createE2EAccount,
  E2E_ADMIN_PASSWORD,
  E2E_KIOSK_TOKEN,
  loginE2EAdmin,
  type E2EAccount,
} from './authHelpers';

const RUN_ARCADE_FLOWS = process.env.E2E_FLOW_PARTITION === 'arcade';
const PORT = RUN_ARCADE_FLOWS ? 3913 : 3901;
const BASE_URL = `http://localhost:${PORT}`;

// The broad flow suite used to put every scenario into one stateful file,
// making its ~120 second serial runtime the lower bound for the whole E2E
// job. A tiny partition entry point imports this module in a second Node test
// process and selects the Arcade scenarios by title. Both partitions keep
// their own in-memory database, server port and browser, so they can run in
// parallel without weakening isolation or duplicating the scenario bodies.
const test = (name: string, fn: (context: TestContext) => void | Promise<void>): void => {
  if (name.startsWith('Arcade:') === RUN_ARCADE_FLOWS) nodeTest(name, fn);
};

let serverProcess: ChildProcess;
let browser: Browser;
let page: Page;
let adminCookie: string;
let alice: E2EAccount;
let bob: E2EAccount;
let analyticsPlayer: E2EAccount | undefined;
const accountsByName = new Map<string, E2EAccount>();

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
  const account = accountsByName.get(label);
  assert.ok(account, `missing E2E account for ${label}`);
  await addSessionCookie(page.context(), BASE_URL, account.cookie);
  await page.reload();
  await page.waitForSelector('#app:not([hidden])');
  await page.click('.nav-btn[data-view="more"]');
  await page.click('[data-navigate="arrivals"]');
  await page.waitForSelector('[data-new-carpool="arrival"]');
}

async function createAccountForFlow(name: string): Promise<E2EAccount> {
  const reauthenticated = await fetch(`${BASE_URL}/api/auth/reauth`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: alice.cookie },
    body: JSON.stringify({ password: alice.password }),
  });
  assert.equal(reauthenticated.status, 204, await reauthenticated.text());
  adminCookie = alice.cookie;
  const account = await createE2EAccount(BASE_URL, adminCookie, name);
  accountsByName.set(name, account);
  await page.reload();
  await page.waitForSelector(`[data-player]:has-text("${name}")`);
  return account;
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
  serverProcess = spawn('node', [path.join(__dirname, '..', '..', '..', 'dist', 'index.js')], {
    env: authenticatedServerEnv(PORT),
    stdio: 'ignore',
  });
  await waitForServer(`${BASE_URL}/api/health`);
  adminCookie = await loginE2EAdmin(BASE_URL);
  alice = await bootstrapAdminAccount(RUN_ARCADE_FLOWS ? 'E2E Alice Pro' : 'E2E Alice');
  bob = await createE2EAccount(BASE_URL, adminCookie, 'E2E Bob');
  accountsByName.set(alice.name, alice);
  accountsByName.set('E2E Alice Pro', alice);
  accountsByName.set(bob.name, bob);
  if (RUN_ARCADE_FLOWS) {
    analyticsPlayer = await createE2EAccount(BASE_URL, adminCookie, 'Analytics E2E Player');
    accountsByName.set(analyticsPlayer.name, analyticsPlayer);
  }
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
});

after(async () => {
  await browser?.close();
  serverProcess?.kill();
});

test('fresh device uses the personal login and reaches the app with its verified account', async (t) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const loginPage = await context.newPage();
  t.after(async () => context.close());
  await loginPage.goto(BASE_URL);
  await loginPage.waitForSelector('#auth-screen:not([hidden])');
  await loginPage.fill('#auth-name', alice.name);
  await loginPage.fill('#auth-password', alice.password);
  await loginPage.click('#auth-form button[type="submit"]');
  await loginPage.waitForSelector('#app:not([hidden])');

  const topbarWordmark = loginPage.locator('.topbar-title .brand-title');
  assert.equal((await topbarWordmark.textContent())?.trim(), 'Respawn');
  assert.deepEqual(
    await topbarWordmark.evaluate((element) => {
      const style = getComputedStyle(element);
      return { fontStyle: style.fontStyle, transform: style.transform };
    }),
    { fontStyle: 'normal', transform: 'none' },
  );

  await loginPage.click('#profile-btn');
  await loginPage.waitForSelector('#profile-name');
  assert.equal(await loginPage.inputValue('#profile-name'), alice.name);
});

test('Einstellungen und Profil use grouped help while admin tools stay out of regular settings', async (t) => {
  // Switches to a desktop viewport partway through (for the desktop-only
  // profile layout checks below) and never switches back on its own —
  // relying on a later test happening to reset it first. If this test
  // throws before reaching that point, or a later test that resets it
  // (e.g. "global search...") fails before its own reset runs, every test
  // in between silently keeps running at the wrong viewport size, which
  // reads as an unrelated mobile-layout assertion failure. Restore the
  // shared page's actual default (see the `before()` above) regardless of
  // how this test ends.
  t.after(async () => {
    await page.setViewportSize({ width: 390, height: 844 });
  });
  await page.click('#settings-btn');
  await page.waitForSelector('#settings-events-title');
  assert.equal(await page.locator('.grouped-page-sections > .grouped-page-section').count(), 2);
  assert.equal(await page.locator('[data-navigate="seating"]').count(), 0);
  assert.equal(await page.locator('#download-backup').count(), 0);
  await page.click('[aria-label="Mehr Informationen zu Events"]');
  await page.waitForSelector('#settings-events-help:not([hidden])');
  await page.click('[aria-label="Mehr Informationen zu Events"]');
  await page.click('#new-event-btn');
  assert.equal(await page.getByText('Tracking', { exact: true }).count(), 0);
  await page.click('.modal[aria-label="Neues Event"] [data-close]');

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
  assert.equal(await page.locator('.profile-avatar-editor .field-label').count(), 0);
  assert.equal(await page.locator('label[for="profile-color-trigger"]').textContent(), 'Farbe');
  assert.equal(await page.locator('.profile-color-trigger').count(), 1);
  assert.equal(await page.locator('.profile-color-trigger').evaluate((element) => getComputedStyle(element).borderRadius), '8px');
  assert.equal(await page.locator('input[type="color"]').count(), 0);
  assert.equal(await page.locator('.profile-identity-fields').evaluate((element) => getComputedStyle(element).gridTemplateColumns.split(' ').length), 4);
  const identityFieldCenters = await page.locator('.profile-identity-fields').evaluate((editor) => {
    const controls = [
      editor.querySelector('.profile-avatar-control'),
      editor.querySelector('.profile-color-trigger'),
      editor.querySelector('#profile-name'),
      editor.querySelector('#profile-real-name'),
    ];
    if (controls.some((control) => !control)) return [];
    return controls.map((control) => {
      const box = control!.getBoundingClientRect();
      return box.top + box.height / 2;
    });
  });
  assert.equal(identityFieldCenters.length, 4);
  // Inline line-box rounding differs slightly across Windows font/rendering
  // versions. A 2px center delta is visually aligned and must not make the
  // otherwise unrelated end-to-end suite flaky.
  assert.ok(
    Math.max(...identityFieldCenters) - Math.min(...identityFieldCenters) <= 2,
    `profile identity controls should remain vertically aligned: ${JSON.stringify(identityFieldCenters)}`,
  );
  const originalProfileColor = await page.inputValue('#profile-color');
  await page.click('#profile-color-trigger');
  await page.waitForSelector('.profile-color-picker-modal .profile-color-picker-wheel');
  assert.equal(await page.locator('.profile-color-preset').count(), 0);
  await page.locator('.profile-color-picker-modal .modal').evaluate((element) => Promise.all(element.getAnimations().map((animation) => animation.finished)));
  const colorModal = await page.locator('.profile-color-picker-modal .modal').boundingBox();
  assert.ok(colorModal && Math.abs(colorModal.x + colorModal.width / 2 - 640) < 2 && Math.abs(colorModal.y + colorModal.height / 2 - 450) < 2);
  await page.locator('.profile-color-picker-wheel').press('ArrowRight');
  const keyboardColor = await page.inputValue('.profile-color-picker-value');
  assert.notEqual(keyboardColor, originalProfileColor.toUpperCase());
  await page.fill('.profile-color-picker-value', 'ungueltig');
  assert.equal(await page.locator('.profile-color-picker-value').getAttribute('aria-invalid'), 'true');
  assert.equal(await page.locator('.profile-color-picker-copy').isDisabled(), true);
  assert.equal(await page.locator('[data-profile-color-apply]').isDisabled(), true);
  assert.equal(await page.locator('.profile-color-picker-error').isVisible(), true);
  await page.fill('.profile-color-picker-value', '12abef');
  assert.equal(await page.locator('.profile-color-picker-value').getAttribute('aria-invalid'), 'false');
  assert.equal(await page.locator('.profile-color-picker-copy').isEnabled(), true);
  assert.equal(await page.locator('[data-profile-color-apply]').isEnabled(), true);
  assert.equal(await page.locator('.profile-color-picker-error').isHidden(), true);
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: async (value: string) => { (window as Window & { copiedProfileColor?: string }).copiedProfileColor = value; } },
    });
  });
  await page.click('.profile-color-picker-copy');
  assert.equal(await page.evaluate(() => (window as Window & { copiedProfileColor?: string }).copiedProfileColor), '#12ABEF');
  await page.click('[data-profile-color-cancel]');
  assert.equal(await page.inputValue('#profile-color'), originalProfileColor);
  await page.click('#profile-color-trigger');
  await page.fill('.profile-color-picker-value', '#12ABEF');
  const appliedColor = (await page.inputValue('.profile-color-picker-value')).toLowerCase();
  await page.click('[data-profile-color-apply]');
  assert.equal(await page.inputValue('#profile-color'), appliedColor);
  assert.equal(await page.getByText('Erweitertes Tracking', { exact: true }).count(), 1);
  assert.equal(await page.locator('.profile-identity-editor').evaluate((element) => element.scrollWidth <= element.clientWidth), true);
  assert.equal(await page.getByText('Auf diesem Gerät aus.', { exact: true }).count(), 0);
  assert.equal(await page.getByText('Auf diesem Gerät aktiv.', { exact: true }).count(), 0);
});

test('the authenticated admin role owns the seating editor and backup tools', async (t) => {
  t.after(async () => {
    // This test switches to a desktop viewport for the pool-column check;
    // always restore the shared page's mobile default regardless of how the
    // test ends (same viewport-leak safety net as the Einstellungen test).
    await page.setViewportSize({ width: 390, height: 844 });
  });
  await page.click('.nav-btn[data-view="more"]');
  await page.click('[data-navigate="admin"]');
  await page.waitForSelector('#admin-banner:not([hidden])');
  await page.waitForSelector('#admin-tools-title');
  assert.equal(await page.locator('#download-backup').count(), 1);
  assert.equal(await page.locator('[data-navigate="seating"]').count(), 1);
  assert.equal(await page.locator('[data-navigate="seating"]').textContent(), 'Öffnen');
  assert.ok(await page.locator('[data-navigate="seating"]').evaluate((element) => element.classList.contains('btn-primary')));
  assert.equal(await page.locator('#admin-seating-help').count(), 1);
  assert.equal(await page.locator('#admin-backup-help').count(), 1);
  assert.equal(await page.locator('#admin-test-count-help').count(), 1);
  assert.equal(await page.locator('#admin-test-data-help').count(), 1);
  // Global Event/Kiosk management is reachable from Admin's tool grid too,
  // not only through the personal-looking topbar gear.
  assert.equal(await page.locator('[data-navigate="settings"]').count(), 1);
  assert.equal(await page.locator('#admin-event-kiosk-help').count(), 1);
  assert.equal(await page.locator('.admin-tool-row').count(), 3);
  assert.equal(await page.locator('.admin-test-controls > *').count(), 3);
  assert.equal(await page.locator('#admin-cleanup').textContent(), 'Test-Daten aufräumen');
  // The count field's own id now sits one level down, inside the
  // `.number-stepper` wrapper numberStepper.js adds around every
  // `input[type="number"]` (see DESIGN_SYSTEM.md's "Number stepper" entry).
  assert.deepEqual(await page.locator('.admin-test-controls > *').evaluateAll((controls) => controls.map((control) => control.querySelector('#admin-count') ? 'admin-count' : control.id)), ['admin-count', 'admin-cleanup', 'admin-bulk']);
  // Rounded: getBoundingClientRect() can return a sub-pixel value like
  // 35.999969482421875 for an intended 36px depending on the browser's
  // layout rounding, which a strict-equality assertion here flakes on.
  assert.equal(await page.locator('#admin-count').evaluate((input) => Math.round(input.getBoundingClientRect().height)), 36);
  assert.equal(await page.locator('.admin-test-controls').evaluate((element) => element.scrollWidth <= element.clientWidth), true);
  // The overlay stepper buttons adjust the value by click...
  await page.fill('#admin-count', '5');
  await page.click('.admin-test-controls .number-stepper-btn[aria-label="Wert erhöhen"]');
  assert.equal(await page.locator('#admin-count').inputValue(), '6');
  await page.click('.admin-test-controls .number-stepper-btn[aria-label="Wert verringern"]');
  await page.click('.admin-test-controls .number-stepper-btn[aria-label="Wert verringern"]');
  assert.equal(await page.locator('#admin-count').inputValue(), '4');
  // ...and mouse-wheel scrolling over the focused field no longer changes it
  // (the field blurs itself on wheel instead of applying the native step).
  await page.focus('#admin-count');
  assert.equal(await page.locator('#admin-count').evaluate((input) => document.activeElement === input), true);
  await page.locator('#admin-count').dispatchEvent('wheel', { deltaY: -100 });
  assert.equal(await page.locator('#admin-count').inputValue(), '4');
  assert.equal(await page.locator('#admin-count').evaluate((input) => document.activeElement === input), false);
  await page.click('[data-navigate="seating"]');
  await page.waitForSelector('.seating-plan.is-editable');
  assert.equal(await page.locator('.seating-editor > .grouped-page-section').count(), 3);
  assert.deepEqual(await page.locator('.seating-editor > .grouped-page-section h2 > span:first-child, .seating-editor > .grouped-page-section h2:not(:has(> span:first-child))').allTextContents(), ['Sitzplan', 'Spieler', 'Konfiguration']);
  assert.equal(await page.locator('.seating-pool-player').evaluateAll((players) => players.every((player) => getComputedStyle(player).borderRadius !== '999px')), true);
  // The unassigned-player pool is one column on phones and two from --bp-md
  // (DESIGN_SYSTEM.md: "phones keep one column"). The old bare 2-column
  // assertion only ever passed while a desktop viewport leaked in from the
  // Einstellungen test; check both documented layouts explicitly instead.
  assert.equal(await page.locator('.seating-player-pool').evaluate((pool) => getComputedStyle(pool).gridTemplateColumns.split(' ').length), 1);
  await page.setViewportSize({ width: 900, height: 844 });
  assert.equal(await page.locator('.seating-player-pool').evaluate((pool) => getComputedStyle(pool).gridTemplateColumns.split(' ').length), 2);
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok((await page.locator('.seating-seat:not(.is-occupied)').count()) > 0);
  assert.equal(await page.locator('.seating-seat:not(.is-occupied)').first().getByText('Frei', { exact: true }).count(), 1);
  assert.equal(await page.locator('.seating-seat:not(.is-occupied)').first().evaluate((seat) => getComputedStyle(seat).borderStyle), 'dashed');
  assert.equal(await page.locator('.seating-seat-number').count(), 0);
  assert.equal(await page.locator('.seating-seat-free-label').first().evaluate((label) => {
    const probe = document.createElement('span');
    probe.style.color = 'var(--text)';
    document.body.appendChild(probe);
    const tokenColor = getComputedStyle(probe).color;
    probe.remove();
    return getComputedStyle(label).color === tokenColor;
  }), true);
  assert.equal(await page.locator('.seating-pool-player').first().evaluate((player) => {
    const avatar = player.querySelector('.avatar-dot, .avatar-img')!.getBoundingClientRect();
    const name = player.querySelector('.seating-seat-name-line')!.getBoundingClientRect();
    return Math.abs(avatar.top + avatar.height / 2 - (name.top + name.height / 2)) < 2;
  }), true);
  assert.equal(await page.locator('.seating-seat-realname.is-empty').first().evaluate((element) => getComputedStyle(element).display), 'none');
  assert.equal(await page.getByText('Sichtbare Monitore', { exact: true }).count(), 0);
  assert.equal(await page.getByText('Automatisch gespeichert', { exact: true }).count(), 1);
  assert.equal(await page.locator('#seating-monitors-help').count(), 1);
  assert.equal(await page.locator('#seating-save-help').count(), 1);
  assert.equal(await page.locator('#seating-plan-title [data-info-tooltip-trigger]').count(), 1);
  await page.click('[aria-label="Mehr Informationen zu Sitzplan"]');
  await page.waitForSelector('#seating-monitors-help:not([hidden])');
  await page.click('[aria-label="Mehr Informationen zu Konfiguration"]');
  await page.waitForSelector('#seating-save-help:not([hidden])');
});

test('global search filters areas, supports keyboard navigation and restores focus', async (t) => {
  // Also switches viewport size mid-test (see the note on the same pattern
  // in "Einstellungen und Profil..." above) and only restores the shared
  // page's default at the very end — guarantee it regardless of where this
  // test fails, so a flake here can't cascade into unrelated mobile-layout
  // assertions in whatever test runs next.
  t.after(async () => {
    await page.setViewportSize({ width: 390, height: 844 });
  });
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

test('full click-through: players, matchmaking, voting, leaderboard, live pause', async (t) => {
  // This test starts a vote round partway through and only cancels it via UI
  // clicks much later, once its own assertions along the way all pass. If
  // one of those throws first, the round is left open for the rest of the
  // shared page/session — the later "Aktuell" test then times out because it
  // expects the idle "start a round" form, not an already-open round. Cancel
  // any round left open directly through the API, bypassing whatever UI
  // state the test aborted in, so a failure here can't cascade like that.
  t.after(async () => {
    const current = await (await page.request.get(`${BASE_URL}/api/votes`)).json();
    if (current.open) await page.request.post(`${BASE_URL}/api/votes/cancel`);
  });
  // The public roster no longer creates identities; test setup creates the
  // second profile through the API that future user management will own.
  await page.click('.nav-btn[data-view="more"]');
  await page.click('[data-navigate="players"]');
  await page.waitForSelector('[data-player]:has-text("E2E Bob")');

  // Other profiles are read-only; the current identity opens its own editor.
  await page.click('button[data-player] >> text=E2E Bob');
  await page.waitForSelector('text=Dieses Profil kann nur von E2E Bob selbst bearbeitet werden.');
  assert.equal(await page.locator('#detail-save, #detail-delete, #detail-apikey').count(), 0);
  await page.click('[data-close]');
  await page.click('button[data-player] >> text=E2E Alice');
  await page.waitForSelector('#profile-name');
  assert.equal(await page.inputValue('#profile-name'), 'E2E Alice');

  // Matchmaking: draw teams for both players.
  await page.click('.nav-btn[data-view="matchmaking"]');
  assert.equal(await page.inputValue('#mm-teamcount'), '2');
  await page.fill('#mm-player-search', 'E2E Bob');
  await page.waitForFunction(() => document.querySelectorAll('[data-mm-draw-search-item]:not([hidden])').length === 1);
  assert.equal(await page.locator('[data-mm-draw-search-item]:not([hidden])').getByText('E2E Bob', { exact: true }).count(), 1);
  await page.click('#mm-select-none');
  assert.equal(await page.locator('[data-mm-draw-search-item]:not([hidden]) [data-player]:checked').count(), 0);
  assert.equal(
    await page.locator('[data-mm-draw-search-item][hidden] [data-player]:checked').count(),
    1,
    'filtering must not clear a hidden player selection',
  );
  await page.fill('#mm-player-search', '');
  await page.click('#mm-select-none');
  assert.equal(await page.locator('[data-player]:checked').count(), 0);
  await page.click('#mm-select-all');
  assert.equal(await page.locator('[data-player]:checked').count(), 2);
  assert.equal(await page.locator('details.history-details:has(summary:has-text("Historie"))').getAttribute('open'), null);

  // Player cards (checkbox, avatar, name, skill value) stack in a single
  // column on phones; two columns would leave no readable room for names.
  const drawPlayerGrid = page.locator('section[aria-labelledby="matchmaking-draw-title"] .player-selection-grid');
  const mobileSelectionColumns = await drawPlayerGrid.evaluate((element) =>
    getComputedStyle(element).gridTemplateColumns.split(' ').length
  );
  assert.equal(mobileSelectionColumns, 1);
  await page.setViewportSize({ width: 900, height: 844 });
  const desktopSelectionColumns = await drawPlayerGrid.evaluate((element) =>
    getComputedStyle(element).gridTemplateColumns.split(' ').length
  );
  assert.ok(desktopSelectionColumns >= 2);
  await page.setViewportSize({ width: 390, height: 844 });

  // Only the selected mode's section renders — switch to Captain Draft to
  // reach its tooltip, then back to Auslosung to reach "Teams auslosen".
  await page.click('[data-mm-mode="draft"]');
  assert.equal(await page.locator('#draft-player-search').count(), 1);
  await page.fill('#captain-player-search', 'E2E Alice');
  await page.waitForFunction(() => document.querySelectorAll('[data-mm-captain-search-item]:not([hidden])').length === 1);
  assert.equal(await page.locator('[data-mm-captain-search-item]:not([hidden])').getByText('E2E Alice', { exact: true }).count(), 1);
  await page.fill('#captain-player-search', '');
  const draftHelp = page.locator('[aria-controls="captain-draft-help"]');
  await draftHelp.waitFor();
  await draftHelp.click();
  assert.equal(await draftHelp.getAttribute('aria-expanded'), 'true');
  await page.keyboard.press('Escape');
  assert.equal(await draftHelp.getAttribute('aria-expanded'), 'false');

  await page.click('[data-mm-mode="draw"]');
  await page.waitForSelector('#mm-generate');
  // The sticky action bar must not steal clicks from rows scrolling behind
  // it: only real controls (the button here) opt back into pointer events,
  // the bar's own background stays pass-through (see .sticky-actions in
  // style.css).
  const stickyActions = page.locator('.sticky-actions', { has: page.locator('#mm-generate') });
  assert.equal(await stickyActions.evaluate((el) => getComputedStyle(el).pointerEvents), 'none');
  assert.equal(await page.locator('#mm-generate').evaluate((el) => getComputedStyle(el).pointerEvents), 'auto');
  await page.click('#mm-generate');
  await page.waitForSelector('.team-card');
  const teamCards = await page.locator('.team-card').count();
  assert.ok(teamCards >= 2, 'expected at least 2 team cards');

  // Neither of these two players rated the game, so both enter the draw with
  // the server's neutral fallback. That has to stay visible: each row shows
  // the parenthesized fallback, and every team header's total is the sum of
  // its own visible rows plus the count of unrated players.
  assert.ok((await page.locator('.team-card .team-player .rating-unrated').count()) > 0);
  const drawnTeams = await page.locator('.team-card').evaluateAll((cards) =>
    cards.map((card) => ({
      header: card.querySelector('.team-skill-total')?.textContent?.trim() ?? '',
      players: Array.from(card.querySelectorAll('.team-player .rating')).map(
        (row) => row.textContent?.trim() ?? ''
      ),
    }))
  );
  for (const team of drawnTeams) {
    const ratings = team.players.map((text) => Number(text.replace(/[()]/g, '')));
    const [total, unratedCount] = team.header.replace(/[()]/g, ' ').trim().split(/\s+/).map(Number);
    assert.equal(
      total,
      ratings.reduce((sum, rating) => sum + rating, 0)
    );
    assert.equal(unratedCount ?? 0, team.players.filter((text) => text.startsWith('(')).length);
  }

  // Voting: start a round (points mode, the only mode offered when starting
  // fresh), rate a game, and submit. Alice's personal session already fixes
  // the voter identity, so no extra identity form appears. Moving a slider only
  // stages a local draft — it must not count as a vote until the submit
  // button is pressed. While the round is open, no per-game distribution
  // (bars/counts) may be visible anywhere — only total participation and the
  // voter's own pick.
  await page.click('.nav-btn[data-view="votes"]');
  await page.waitForSelector('#votes-start');
  assert.equal(await page.getByText('Du bist E2E Alice', { exact: true }).count(), 0);
  await page.click('#votes-start');
  await page.waitForSelector('#votes-close'); // only rendered once the round shows as open
  await page.waitForSelector('.vote-participation-status:has-text("Bewertungen abgegeben"):has-text("0 / 2")');
  // Opening the round also kicks off votes.js's own follow-up mine/history
  // fetches, each of which rerenders (replacing this whole section) again
  // once it resolves. Settling on network idle first, then reading all
  // three boxes from one synchronous evaluate(), avoids one of those
  // rerenders landing between three separate boundingBox() round trips and
  // handing back a stale/zero-size box for whichever button it replaced.
  await page.waitForLoadState('networkidle');
  const { submitWidth, closeWidth, cancelWidth } = await page.evaluate(() => ({
    submitWidth: document.querySelector('#votes-submit')?.getBoundingClientRect().width ?? 0,
    closeWidth: document.querySelector('#votes-close')?.getBoundingClientRect().width ?? 0,
    cancelWidth: document.querySelector('#votes-cancel')?.getBoundingClientRect().width ?? 0,
  }));
  assert.ok(submitWidth > closeWidth);
  assert.equal(Math.round(cancelWidth), Math.round(closeWidth));
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

  // Own rating progress and the "Unbewertet" filter reflect the two just-
  // staged (not yet submitted) picks against the round's full game count.
  const totalGames = await page.locator('[data-points-slider]').count();
  await page.waitForSelector(`.vote-workflow-section >> text=2 von ${totalGames} bewertet`);
  await page.click('#votes-unrated-toggle');
  await page.waitForFunction(
    (expected) => document.querySelectorAll('[data-points-slider]').length === expected,
    totalGames - 2
  );
  await page.click('#votes-unrated-toggle');
  await page.waitForFunction(
    (expected) => document.querySelectorAll('[data-points-slider]').length === expected,
    totalGames
  );

  await page.click('#votes-submit');
  await page.waitForSelector('.vote-participation-status:has-text("1 / 2")');
  await page.waitForSelector('.vote-submitted-state:has-text("Bewertung abgegeben")');
  assert.equal(await page.locator('#votes-submit').count(), 0);
  assert.ok(await page.locator('[data-points-slider]').first().isDisabled());
  assert.equal(await page.locator('.vote-bar-track').count(), 0, 'still no bars after casting, before closing');

  await page.click('#votes-close');
  await page.waitForSelector('#votes-start');
  // Closing reveals only games that actually received points in the compact
  // "Letzter Vote" group; the detail modal applies the same zero-score filter.
  await page.waitForSelector('text=Letzter Vote');
  await page.waitForFunction(() => document.querySelectorAll('section[aria-labelledby="vote-current-result-title"] .lb-row').length >= 2);
  const currentVote = page.locator('section[aria-labelledby="vote-current-result-title"]');
  assert.equal(await currentVote.locator('.lb-row').count(), 2);
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
  assert.equal(await page.locator('.vote-history-round').first().locator('.lb-row').count(), 2);
  await page.click('[data-open-history-round]');
  await page.waitForSelector('text=Abstimmung Runde 1');
  await page.waitForSelector('.modal .vote-bar-track');
  assert.equal(await page.locator('.modal .vote-row').count(), 2);
  await page.click('[data-close]');

  // Leaderboard: record a match and see it reflected.
  await page.click('.nav-btn[data-view="leaderboard"]');
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
  // #lb-filter is a searchable combobox (searchSelect.js), not a native
  // <select>: typing an option's exact label into #lb-filter-search resolves
  // the hidden #lb-filter input to that game's id, just like choosing it from
  // the app-rendered listbox.
  const gamesRes = await page.request.get(`${BASE_URL}/api/games`);
  const games = await gamesRes.json();
  const filteredGame = games[1];
  assert.ok(filteredGame);
  const filteredGameId = filteredGame.id;
  const [filteredPlaytimeResponse, allPlaytimeResponse] = await Promise.all([
    page.waitForResponse((response) => {
      const url = new URL(response.url());
      return url.pathname === '/api/stats/playtime' && url.searchParams.get('gameId') === filteredGameId;
    }),
    page.waitForResponse((response) => {
      const url = new URL(response.url());
      return url.pathname === '/api/stats/playtime' && !url.searchParams.has('gameId');
    }),
    page.fill('#lb-filter-search', filteredGame.name),
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
  // The "Wert" field uses step="any" (arbitrary decimal scores) while "Platz"
  // uses the default whole-number step — native stepUp()/stepDown() throws on
  // a step="any" field, so the shared numberStepper.js click handler needs
  // its own fallback there instead of silently doing nothing.
  await page.click('[data-team-score="0"] + .number-stepper-steps .number-stepper-btn[aria-label="Wert erhöhen"]');
  assert.equal(await page.locator('[data-team-score="0"]').inputValue(), '1');
  await page.click('[data-team-rank="0"] + .number-stepper-steps .number-stepper-btn[aria-label="Wert erhöhen"]');
  assert.equal(await page.locator('[data-team-rank="0"]').inputValue(), '1');
  await page.uncheck('#match-advanced');
  const teamSelects = page.locator('[data-team-for]');
  await teamSelects.nth(0).selectOption('0');
  await teamSelects.nth(1).selectOption('1');
  await page.check('input[name="winner"][value="0"]');
  await page.click('#match-form button[type="submit"]');
  await page.waitForSelector('.lb-row');
  assert.ok((await page.locator('.lb-row').count()) >= 2);
  // The app can render its first data view before the stylesheet request has
  // completed on a cold CI browser. Wait for the actual sheet and a resolved
  // body font before comparing typography across views.
  await page.waitForFunction(() => {
    const stylesheet = document.querySelector('link[href*="/css/style.css"]') as HTMLLinkElement | null;
    return stylesheet?.sheet !== null && getComputedStyle(document.body).fontFamily !== '';
  });
  // Read the styles off a freshly queried node at evaluation time: a
  // players:/live:changed refresh can re-render the list between resolving a
  // locator handle and evaluating it, and a detached node reports every
  // computed style as ''. Retry until a live node answers.
  const readNameTypography = (selector: string) =>
    page
      .waitForFunction((sel) => {
        const element = document.querySelector(sel);
        if (!element) return null;
        const style = getComputedStyle(element);
        if (!style.fontFamily) return null;
        return { family: style.fontFamily, size: style.fontSize, weight: style.fontWeight };
      }, selector)
      .then((result) => result.jsonValue() as Promise<{ family: string; size: string; weight: string }>);
  const leaderboardNameTypography = await readNameTypography('.lb-row .player-name');
  await page.waitForSelector('text=Spielzeit');

  // Back to Home: should now show both players (offline, since no agent ran).
  await page.click('.nav-btn[data-view="home"]');
  await page.waitForSelector('.player-card');
  assert.equal(await page.locator('.player-card').count(), 2);
  for (const title of ['Live-Status', 'Rangliste', 'Sitzplan']) {
    assert.equal(
      await page.locator(`section.grouped-page-section:has(h2:text-is("${title}"))`).count(),
      1,
      `${title} should be presented as a grouped Home section`
    );
  }
  const liveNameTypography = await readNameTypography('.player-card .player-name');
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

test('Vote: game-limit selection survives an unrelated re-render and select-all/none ignore prior manual state', async () => {
  // Regression test: the "Nur bestimmte Spiele zur Wahl stellen" panel and
  // its checkboxes used to live only in the DOM with no persisted JS state.
  // A votes:changed/preferences:changed socket event re-renders this whole
  // view from scratch whenever *anyone* interacts with voting elsewhere —
  // that silently collapsed the panel and cleared manual deselections.
  // `respawn:rerender` is the same generic re-render signal the app itself
  // dispatches; firing it here simulates that unrelated event without
  // needing a second browser context.
  await page.click('.nav-btn[data-view="votes"]');
  await page.waitForSelector('#votes-start');
  await page.click('#votes-limit-games');
  await page.waitForSelector('#votes-game-select-wrap:not([hidden])');
  const voteGameCheckboxes = page.locator('[data-vote-game-checkbox]');
  const voteGameCount = await voteGameCheckboxes.count();
  assert.ok(voteGameCount >= 2, 'test fixture must ship at least two games');
  await page.fill('#votes-game-search', 'Counter-Strike 2');
  await page.waitForFunction(() => document.querySelectorAll('[data-vote-game-search-item]:not([hidden])').length === 1);
  await page.click('#votes-select-none');
  assert.equal(await page.locator('[data-vote-game-search-item]:not([hidden]) [data-vote-game-checkbox]:checked').count(), 0);
  assert.equal(
    await page.locator('[data-vote-game-search-item][hidden] [data-vote-game-checkbox]:checked').count(),
    voteGameCount - 1,
    'filtering must preserve checked games outside the visible result',
  );
  await page.fill('#votes-game-search', 'Kein Treffer XYZ');
  await page.waitForSelector('[data-vote-game-search-empty]:not([hidden])');
  await page.fill('#votes-game-search', '');
  await page.click('#votes-select-all');
  await voteGameCheckboxes.nth(0).uncheck();
  await voteGameCheckboxes.nth(1).uncheck();

  await page.evaluate(() => window.dispatchEvent(new CustomEvent('respawn:rerender')));

  await page.waitForSelector('#votes-game-select-wrap:not([hidden])');
  assert.equal(await page.locator('#votes-limit-games').isChecked(), true, 'the filter checkbox itself must stay checked');
  assert.equal(await voteGameCheckboxes.nth(0).isChecked(), false, 'a manual deselection must survive an unrelated re-render');
  assert.equal(await voteGameCheckboxes.nth(1).isChecked(), false);

  // The previous single toggle button computed its action from whether
  // *all* boxes were checked, so clicking it in this exact mixed state
  // (2 unchecked, rest checked) re-checked everything instead of clearing
  // the rest. The two dedicated buttons must not depend on prior state.
  await page.click('#votes-select-none');
  assert.deepEqual(
    await voteGameCheckboxes.evaluateAll((els) => els.map((el) => (el as HTMLInputElement).checked)),
    Array(voteGameCount).fill(false)
  );
  await page.click('#votes-select-all');
  assert.deepEqual(
    await voteGameCheckboxes.evaluateAll((els) => els.map((el) => (el as HTMLInputElement).checked)),
    Array(voteGameCount).fill(true)
  );

  // Restore the idle default so later tests in this file start clean.
  await page.click('#votes-limit-games');
  await page.waitForSelector('#votes-game-select-wrap[hidden]', { state: 'attached' });
});

test('Vote: genre filter scopes the game-limit list, select-all/none and the started round to visible games', async (t) => {
  // Regression test: the genre chip filter only ever narrowed which games
  // were *displayed* in the "Nur bestimmte Spiele" checkbox grid. "Alle
  // markieren"/"Auswahl aufheben" and the actual start action still touched
  // every game regardless of the active filter, so e.g. filtering to
  // "Shooter" and clicking "Alle markieren" silently (re-)selected every
  // other genre's games too, and starting the round could still include
  // games the filter was hiding.
  //
  // This test starts a round partway through (to verify what actually gets
  // offered) and only closes it via UI clicks at the end — same hazard as
  // "full click-through" above: if an assertion throws first, the round
  // stays open for the rest of the shared page/session and cascades into
  // later tests expecting the idle "start a round" form. Cancel any round
  // left open directly through the API, independent of wherever the test
  // aborted.
  t.after(async () => {
    const current = await (await page.request.get(`${BASE_URL}/api/votes`)).json();
    if (current.open) {
      const cancelled = await page.request.post(`${BASE_URL}/api/votes/cancel`);
      assert.ok(cancelled.ok(), `vote cleanup failed (${cancelled.status()}): ${await cancelled.text()}`);
    }
    // This test also mutates votes.js's own module state (limitGamesChecked,
    // voteGenreFilter, excludedGameIds) — a lingering "Shooter"-only filter
    // or excluded game would silently break a later test's default all-games
    // "Abstimmung starten" (an empty/limited selection either starts the
    // wrong round or, worse, gets silently rejected with nothing checked).
    // A reload is the only way to reset that in-memory state.
    await page.reload();
    await page.waitForSelector('#view-container[data-view]');
  });
  const gamesRes = await page.request.get(`${BASE_URL}/api/games`);
  const games = (await gamesRes.json()) as Array<{ id: string; name: string }>;
  const cs2 = games.find((g) => g.name === 'Counter-Strike 2')!;
  const rocketLeague = games.find((g) => g.name === 'Rocket League')!;

  // A round left open by an earlier test (see the same guard in
  // "full click-through" above) would otherwise hide the idle "start a
  // round" form this test needs from its very first step.
  const initialVotes = await (await page.request.get(`${BASE_URL}/api/votes`)).json();
  if (initialVotes.open) {
    const cancelled = await page.request.post(`${BASE_URL}/api/votes/cancel`);
    assert.ok(cancelled.ok(), `initial vote cleanup failed (${cancelled.status()}): ${await cancelled.text()}`);
  }

  await page.click('.nav-btn[data-view="votes"]');
  await page.waitForSelector('#votes-start');
  await page.click('#votes-limit-games');
  await page.waitForSelector('#votes-game-select-wrap:not([hidden])');
  // Manually deselect a game that the upcoming "Shooter" filter will hide -
  // its excluded state must survive untouched by the filtered select-all/none.
  const rocketLeagueCheckbox = `[data-vote-game-checkbox][value="${rocketLeague.id}"]`;
  await page.locator(rocketLeagueCheckbox).uncheck();

  // Tag genres via the API now, with the panel already open — the resulting
  // 'games:changed' broadcast re-renders this whole view from scratch (see
  // the neighboring test above), so wait for the genre chip it introduces
  // instead of assuming the patch settles before the next interaction.
  await page.request.patch(`${BASE_URL}/api/games/${cs2.id}`, { data: { genres: ['Shooter'] } });
  await page.request.patch(`${BASE_URL}/api/games/${rocketLeague.id}`, { data: { genres: ['Racing'] } });
  await page.waitForSelector('[data-vote-genre-filter="Shooter"]');
  await page.click('[data-vote-genre-filter="Shooter"]');
  const visibleRows = page.locator('#votes-game-select label.check-row');
  await page.waitForFunction(() => document.querySelectorAll('#votes-game-select label.check-row').length === 1);
  assert.equal(await visibleRows.count(), 1, 'only the Shooter-tagged game should be listed while filtered');
  assert.match((await visibleRows.first().innerText()).trim(), /Counter-Strike 2/);

  // "Auswahl aufheben" while filtered must only uncheck the visible game.
  await page.click('#votes-select-none');
  assert.equal(await visibleRows.first().locator('input').isChecked(), false);

  // "Alle markieren" while filtered must only re-check the visible game, not
  // the Rocket League checkbox this test manually excluded above.
  await page.click('#votes-select-all');
  assert.equal(await visibleRows.first().locator('input').isChecked(), true);

  await page.click('[data-vote-genre-filter="Shooter"]');
  await page.waitForFunction(() => document.querySelectorAll('#votes-game-select label.check-row').length > 1);
  assert.equal(
    await page.locator(rocketLeagueCheckbox).isChecked(),
    false,
    'Rocket League must stay excluded — the filtered select-all above must not have touched it',
  );

  // Starting the round while the Shooter filter is active must only offer
  // the currently visible, checked game(s) for voting, even though other
  // games remain checked underneath the filter.
  await page.click('[data-vote-genre-filter="Shooter"]');
  await page.waitForFunction(() => document.querySelectorAll('#votes-game-select label.check-row').length === 1);
  await page.click('#votes-start');
  await page.waitForSelector('#votes-submit');
  const openGameNames = await page.locator('.vote-row > div:first-of-type span.row').allInnerTexts();
  assert.deepEqual(openGameNames.map((t) => t.trim()), ['Counter-Strike 2']);

  await page.click('#votes-cancel');
  await page.waitForSelector('[data-confirm]');
  assert.equal(await page.locator('[data-confirm]').innerText(), 'Abstimmung abbrechen');
  assert.notEqual(
    await page.locator('[data-confirm]').innerText(),
    await page.locator('.modal-body [data-cancel]').innerText(),
    'the destructive confirm button must read differently than the neighboring Abbrechen button',
  );
  await page.click('[data-confirm]');
  await page.waitForSelector('#votes-start');
});

test('matchmaking Historie marks a recorded draw as Unentschieden', async () => {
  await page.click('.nav-btn[data-view="matchmaking"]');
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
  await page.click('.nav-btn[data-view="matchmaking"]');
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
  await page.click('.nav-btn[data-view="matchmaking"]');
  await page.click('#mm-generate');
  await openMatchmakingHistory();
  await page.waitForSelector('[data-record-draw]');
  await page.click('[data-record-draw]');
  await page.waitForSelector('#match-players');

  await page.click('#match-game-search');
  await page.waitForSelector('#match-game-list:not([hidden])');
  await page.keyboard.press('Escape');
  await page.waitForSelector('#match-game-list', { state: 'hidden' });
  assert.equal(
    await page.locator('#match-form').isVisible(),
    true,
    'Escape should close the game listbox without propagating to the result modal',
  );

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
  await page.click('.nav-btn[data-view="more"]');
  await page.click('[data-navigate="analytics"]');
  await page.waitForSelector('text=Marathon-Zocker', { timeout: 5000 });
  assert.ok((await page.textContent('.view-title'))?.includes('Auswertungen'));

  // The noisy concurrency controls are intentionally gone. The session log
  // remains available on demand, but starts collapsed.
  assert.equal(await page.locator('#an-concurrency-game').count(), 0);
  const sessionLog = page.locator('details:has(summary:has-text("Session-Protokoll"))');
  assert.equal(await sessionLog.getAttribute('open'), null);
  await page.waitForSelector('text=Längste individuelle Session pro Spiel');
  assert.equal(await page.locator('#analytics-event-range-help').count(), 0);
  assert.equal(await page.getByText('Event wählen zeigt genau dessen Daten.', { exact: true }).count(), 0);
  assert.equal(await page.locator('#an-event[aria-label="Veranstaltung"]').count(), 1);
  assert.equal(await page.locator('[data-dt-field^="an-"]').count(), 0);

  // The "Matches & Turniere" tab (merged in from the old separate Spiele &
  // Turniere view) shares this same event filter and renders alongside it.
  await page.click('[data-an-tab="matches"]');
  await page.waitForSelector('text=Ergebnisse pro Spiel');
  assert.equal(await page.locator('#analytics-event-help').count(), 0);
  assert.equal(await page.locator('.analytics-tournament-breakdown').count(), 2);
  await page.waitForSelector('#analytics-fun-title:text-is("Trivia")');
  const triviaSection = page.locator('section[aria-labelledby="analytics-fun-title"]');
  // Earlier tests in this suite already recorded 1v1 results, so the biggest
  // rivalry card exists and the empty state must be gone.
  assert.equal(await triviaSection.getByText('Noch nicht genug Ergebnisse.', { exact: true }).count(), 0);
  assert.ok((await triviaSection.locator('.card').count()) >= 1, 'trivia should show at least one fun record');
  assert.equal(await triviaSection.locator('.empty-state-icon').count(), 0);
  assert.equal(await page.locator('#an-event[aria-label="Veranstaltung"]').count(), 1);

  await page.click('[data-an-tab="arcade"]');
  await page.waitForSelector('#analytics-arcade-total-title');
  assert.equal(await page.locator('#an-event[aria-label="Veranstaltung"]').count(), 1);
  assert.equal(await page.locator('[data-dt-field^="an-"]').count(), 0);
  assert.equal(await page.locator('#analytics-arcade-range-help').count(), 0);
  assert.equal(await page.getByText('Matches pro Tag', { exact: true }).count(), 0);
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

  // The personal session still belongs to "E2E Alice", so this view opens
  // straight into her profile editor.
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
  alice.name = 'E2E Alice Pro';

  // Bock/Skill-Ratings live in the Spiele view now, reachable from here via
  // the onboarding nudge; the personal stats dashboard is one tap away too
  // (it moved to its own view, myStats).
  await page.waitForSelector('text=Bock & Skill eintragen');
  await page.click('[data-navigate="myStats"]');
  await page.waitForSelector('text=Meine Statistiken');
  await page.waitForSelector('#my-stats-event');

  // Back to the profile; the session remains bound to this account.
  await page.click('[data-navigate="profile"]');
  await page.waitForSelector('#profile-name');
  // Restore the identity — later tests (tournament) still act as her.
  assert.equal(await page.inputValue('#profile-name'), 'E2E Alice Pro');
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
  await page.click('.nav-btn[data-view="more"]');
  await page.click('[data-navigate="admin"]');
  await page.waitForSelector('#admin-banner:not([hidden])');
  await page.click('.nav-btn[data-view="more"]');
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
  await page.click('.nav-btn[data-view="home"]');
  await page.waitForSelector('.seating-seat-realname:has-text("Alice Musterfrau")');
  const homeSeatName = page.locator('.live-seating .seating-seat.is-occupied .seating-seat-name', { hasText: 'E2E Alice Pro' });
  await homeSeatName.waitFor();
  assert.equal(await homeSeatName.evaluate((element) => getComputedStyle(element).fontWeight), '600');
  assert.equal(await homeSeatName.evaluate((element) => getComputedStyle(element).textAlign), 'left');
  await page.setViewportSize({ width: 390, height: 844 });
});

test('Spiele: suggest a game (duplicate name rejected), promote it, then rate Bock/Skill inline', async () => {
  await page.click('.nav-btn[data-view="more"]');
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
  // Closing still discards the typed (rejected) title, so the new
  // confirm-before-discard guard steps in — confirm it away.
  await page.click('[data-confirm]');

  // A suggestion carries both meters, Bock *and* Skill — how good the group
  // already is at a game is part of deciding whether to accept it at all.
  const suggestionRow = page.locator('.game-table-row', { hasText: 'E2E Partyspiel' });
  await suggestionRow.locator('.skill-row[data-kind="skill"] input[type="range"]').waitFor();

  // "Katalog" holds the accepted games only, so the still-open suggestion is
  // not in it; "Alle" lists both and keeps the suggestion recognizable
  // through its Vorschlag badge, which an accepted game never carries.
  await page.click('button[data-tab="catalog"]');
  await page.waitForSelector('.game-table-row:has-text("E2E Partyspiel")', { state: 'detached' });
  await page.click('button[data-tab="all"]');
  await suggestionRow.locator('.game-row-status-badge:has-text("Vorschlag")').waitFor();
  const acceptedRow = page.locator('.game-table-row', { hasText: 'Counter-Strike 2' });
  await acceptedRow.waitFor();
  assert.equal(await acceptedRow.locator('.game-row-status-badge').count(), 0);
  await page.click('button[data-tab="suggestions"]');
  await suggestionRow.waitFor();

  // ... and wherever a game gets picked to actually play, only the accepted
  // ones are offered — the Vote round's game list must not list it.
  const openRound = await (await page.request.get(`${BASE_URL}/api/votes`)).json();
  if (openRound.open) {
    const cancelled = await page.request.post(`${BASE_URL}/api/votes/cancel`);
    assert.ok(cancelled.ok(), `vote cleanup failed (${cancelled.status()}): ${await cancelled.text()}`);
  }
  await page.click('.nav-btn[data-view="votes"]');
  await page.waitForSelector('#votes-start');
  await page.click('#votes-limit-games');
  await page.waitForSelector('#votes-game-select-wrap:not([hidden])');
  await page.locator('#votes-game-select label.check-row', { hasText: 'Counter-Strike 2' }).waitFor();
  assert.equal(
    await page.locator('#votes-game-select label.check-row', { hasText: 'E2E Partyspiel' }).count(),
    0,
    'a suggestion must not be offered as a votable game',
  );
  // Leave the panel closed again for whatever runs next on this shared page.
  await page.click('#votes-limit-games');
  await page.click('.nav-btn[data-view="more"]');
  await page.click('[data-navigate="gameCatalog"]');
  await suggestionRow.waitFor();

  // Promote the suggestion into the catalog via its detail modal (row-level
  // actions live only in there now — the row itself just carries the info
  // icon), then rate it right in the row — no detour through a separate
  // profile page needed.
  await suggestionRow.locator('[data-detail]').click();
  await page.click('#edit-promote');
  await page.waitForSelector('button[data-tab="catalog"].btn-primary');
  const partyspielRow = page.locator('.game-table-row', { hasText: 'E2E Partyspiel' });
  await partyspielRow.waitFor();
  const bockSlider = partyspielRow.locator('.skill-row[data-kind="bock"] input[type="range"]');
  const skillSlider = partyspielRow.locator('.skill-row[data-kind="skill"] input[type="range"]');

  // An unrated slider still has to sit at a plausible-looking position
  // (Bock/Skill are stored 1-10, never 0) - it stays dimmed and shows an
  // en dash instead of a blank label until touched.
  assert.ok(await bockSlider.evaluate((el) => el.classList.contains('skill-row-slider-unset')));
  assert.equal(await partyspielRow.locator('[data-kind="bock"] .skill-value').textContent(), '–');
  assert.ok(await skillSlider.evaluate((el) => el.classList.contains('skill-row-slider-unset')));

  // Both "X offen" facet filters are independent AND conditions: with both
  // active the still-fully-unrated game stays visible.
  await page.click('[data-rating-filter="bock"]');
  await page.click('[data-rating-filter="skill"]');
  await partyspielRow.waitFor();

  await bockSlider.fill('8');
  await page.waitForFunction(() => {
    const cards = Array.from(document.querySelectorAll('.game-table-row'));
    const card = cards.find((c) => c.textContent?.includes('E2E Partyspiel'));
    return card?.querySelector('[data-kind="bock"] .skill-value')?.textContent === '8';
  });
  assert.equal(await bockSlider.evaluate((el) => el.classList.contains('skill-row-slider-unset')), false);
  // Bock is rated now but Skill isn't - "Bock offen" alone already excludes
  // the row even though "Skill offen" is still active too (AND, not OR).
  await page.waitForSelector('.game-table-row:has-text("E2E Partyspiel")', { state: 'detached' });

  await page.click('[data-rating-filter="bock"]');
  await partyspielRow.waitFor();
  await skillSlider.fill('7');
  await page.waitForFunction(() => {
    const cards = Array.from(document.querySelectorAll('.game-table-row'));
    const card = cards.find((c) => c.textContent?.includes('E2E Partyspiel'));
    return card?.querySelector('[data-kind="skill"] .skill-value')?.textContent === '7';
  });
  await page.waitForSelector('.game-table-row:has-text("E2E Partyspiel")', { state: 'detached' });

  // Restore filter state for whatever runs next in this shared-page suite.
  await page.click('[data-rating-filter="skill"]');
  await partyspielRow.waitFor();
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

  await page.click('.nav-btn[data-view="more"]');
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
  await page.click('.nav-btn[data-view="tournaments"]');
  await page.waitForSelector('#tourn-new-btn');
  await page.click('#tourn-new-btn');

  // Propose balanced teams from the checked players (all by default), then
  // create — the submit button only unlocks once a proposal exists.
  await page.waitForSelector('#tourn-propose');
  assert.equal(await page.locator('#tourn-submit').isDisabled(), true);
  const tournamentGamesRes = await page.request.get(`${BASE_URL}/api/games`);
  const tournamentGames = (await tournamentGamesRes.json()) as Array<{ id: string; icon: string; name: string }>;
  assert.ok(tournamentGames.length >= 2, 'the searchable tournament picker needs at least two games');
  const initialTournamentGameId = await page.locator('#tourn-game').inputValue();
  const initialTournamentGame = tournamentGames.find((game) => game.id === initialTournamentGameId)!;
  const otherTournamentGame = tournamentGames.find((game) => game.id !== initialTournamentGameId)!;
  assert.ok(initialTournamentGame);
  await page.click('#tourn-game-search');
  assert.equal(
    await page.locator('#tourn-game-search').inputValue(),
    '',
    'focusing the searchable picker should expose the full list without manually deleting the selected game',
  );
  const tournamentGameList = page.locator('#tourn-game-list');
  await tournamentGameList.waitFor({ state: 'visible' });
  assert.equal(
    await tournamentGameList.locator('.search-select-option').count(),
    tournamentGames.length,
    'the app-rendered listbox should expose every game before filtering',
  );
  assert.equal(
    await tournamentGameList.evaluate((element) => getComputedStyle(element).backgroundColor),
    'rgb(23, 30, 46)',
    'the game listbox should use the dark Respawn surface instead of the native white browser popup',
  );
  assert.equal(
    await tournamentGameList.evaluate((element) => getComputedStyle(element).maxHeight),
    '320px',
    'long game lists should scroll inside a bounded dropdown',
  );
  assert.notEqual(
    await page.locator('#tourn-game-search + .search-select-toggle .ui-icon').evaluate((element) => getComputedStyle(element).transform),
    'none',
    'the dropdown chevron should rotate to communicate the open state',
  );
  await page.keyboard.press('Tab');
  await tournamentGameList.waitFor({ state: 'hidden' });
  assert.equal(
    await page.evaluate(() => document.activeElement?.id),
    'tourn-teamcount',
    'Tab should leave the combobox instead of moving through every listbox option',
  );
  assert.ok(
    await page.locator('#tourn-player-search').evaluate((search) => {
      return search.nextElementSibling?.matches('.tournament-player-grid') === true;
    }),
    'the player search should be directly before the player list after the filters',
  );
  await page.click('#tourn-game-search');
  await tournamentGameList.waitFor({ state: 'visible' });
  await page.keyboard.press('ArrowDown');
  const activeTournamentGameId = await page.locator('#tourn-game-search').getAttribute('aria-activedescendant');
  assert.ok(
    activeTournamentGameId,
    'arrow-key navigation should expose the active option to assistive technology',
  );
  assert.notEqual(
    activeTournamentGameId,
    await tournamentGameList.locator('[aria-selected="true"]').getAttribute('id'),
    'arrow-key navigation should visibly distinguish the active option from the saved selection',
  );
  assert.equal(
    await page.locator(`#${activeTournamentGameId}`).evaluate((element) => getComputedStyle(element).outlineStyle),
    'solid',
    'the active option should receive its own visible focus treatment',
  );
  await page.keyboard.press('Escape');
  await tournamentGameList.waitFor({ state: 'hidden' });
  assert.equal(
    await page.locator('#tourn-game-search').inputValue(),
    initialTournamentGame.name,
    'Escape should close the listbox without changing the game',
  );
  const tournamentGameToggle = page.locator('#tourn-game-search + .search-select-toggle');
  assert.equal(await tournamentGameToggle.getAttribute('aria-label'), 'Auswahl öffnen');
  await tournamentGameToggle.dispatchEvent('click');
  await tournamentGameList.waitFor({ state: 'visible' });
  assert.equal(
    await tournamentGameToggle.getAttribute('aria-label'),
    'Auswahl schließen',
    'the toggle should expose its current close action while the listbox is open',
  );
  await page.locator('#tournament-draw-step-title').dispatchEvent('pointerdown');
  await tournamentGameList.waitFor({ state: 'hidden' });
  assert.equal(
    await tournamentGameToggle.getAttribute('aria-label'),
    'Auswahl öffnen',
    'a pointer interaction outside the picker should close it and restore the toggle action',
  );
  await page.click('#tourn-game-search');
  await tournamentGameList.waitFor({ state: 'visible' });
  await page.locator('#tourn-teamcount').focus();
  assert.equal(
    await page.locator('#tourn-game-search').inputValue(),
    initialTournamentGame.name,
    'leaving the picker without a new valid choice should restore its current selection',
  );
  await page.click('#tourn-game-search');
  await page.locator(`#tourn-game-list [data-search-select-value="${otherTournamentGame.id}"]`).click();
  await page.waitForFunction(
    (gameId) => (document.querySelector('#tourn-game') as HTMLInputElement | null)?.value === gameId,
    otherTournamentGame.id,
  );
  await page.click('#tourn-game-search');
  await tournamentGameList.waitFor({ state: 'visible' });
  assert.equal(
    await page.locator('#tourn-game-search').getAttribute('aria-expanded'),
    'true',
    'clicking the still-focused search field should reopen the listbox after a pointer selection',
  );
  await page.keyboard.press('Escape');
  const neighborHelp = page.locator('[aria-controls="tournament-neighbors-help"]');
  const scoreHelp = page.locator('[aria-controls="tournament-score-help"]');
  const lobbyHelp = page.locator('[aria-controls="tournament-lobby-help"]');
  assert.ok((await page.locator('[data-create-player]').count()) >= 2);
  await page.fill('#tourn-player-search', 'E2E Alice');
  await page.waitForFunction(() => document.querySelectorAll('[data-tourn-player-search-item]:not([hidden])').length === 1);
  assert.equal(await page.locator('[data-tourn-player-search-item]:not([hidden])').getByText('E2E Alice Pro', { exact: true }).count(), 1);
  const hiddenTournamentSelections = await page.locator('[data-tourn-player-search-item][hidden] [data-create-player]:checked').count();
  await page.click('#tourn-select-none');
  assert.equal(await page.locator('[data-tourn-player-search-item]:not([hidden]) [data-create-player]:checked').count(), 0);
  assert.equal(
    await page.locator('[data-tourn-player-search-item][hidden] [data-create-player]:checked').count(),
    hiddenTournamentSelections,
    'filtering must preserve hidden tournament participants',
  );
  await page.click('#tourn-select-all');
  await page.fill('#tourn-player-search', '');
  // Single column on the phone viewport; the two-column cap applies from
  // --bp-md where the cards have room for avatar, name and skill value.
  assert.equal(
    await page.locator('.tournament-player-grid').evaluate((element) => getComputedStyle(element).gridTemplateColumns.split(' ').length),
    1,
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
  await page.click('.nav-btn[data-view="more"]');
  await page.click('[data-navigate="infoBoard"]');
  await page.waitForSelector('#info-new-btn');
  await page.click('#info-new-btn');
  await page.fill('#info-title', 'WLAN');
  await page.fill('#info-content', 'Netz: Respawn\nPasswort: kartoffel');
  await page.click('#info-form button[type="submit"]');
  await page.waitForSelector('text=kartoffel');
});

test('Essensbestellung: open an order with a send time/notes/link, edit them, add a priced item, close it', async () => {
  await page.click('.nav-btn[data-view="more"]');
  await page.click('[data-navigate="foodOrders"]');
  await page.waitForSelector('#order-new-btn');
  await page.click('#order-new-btn');
  await page.fill('#order-title', "Pizza bei Luigi's");
  await setDateTimeField('order-sendat', '2026-12-24T20:00');
  await page.fill('#order-notes', 'Mindestbestellwert 15€, bar zahlen');
  await page.fill('#order-link', 'https://luigis-pizza.example/karte');
  await page.fill('#order-paypal', 'https://paypal.me/luigi');
  await page.fill('#order-tip', '10');
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

  assert.equal(await page.locator('[data-item-quantity]').inputValue(), '');
  assert.equal(await page.locator('[data-item-quantity]').getAttribute('placeholder'), 'Anzahl');
  assert.equal(await page.locator('.food-order-quantity-field > span').textContent(), '×');
  assert.equal(await page.locator('[data-item-quantity]').evaluate((input) => getComputedStyle(input).textAlign), 'left');
  await page.fill('[data-item-desc]', 'Margherita groß');
  await page.fill('[data-item-quantity]', '2');
  await page.fill('[data-item-price]', '9,50');
  await page.click('[data-add-item-form] button[type="submit"]');
  await page.waitForSelector('text=Margherita');
  await page.waitForSelector('.food-order-item-price:has-text("20,90 €")');
  // The tip-inclusive total doesn't replace the position's actual price -
  // both stay visible (quantity × unit price, plus the tip note).
  await page.waitForSelector('.food-order-item-price:has-text("2 × 9,50 €")');
  await page.waitForSelector('.food-order-item-price:has-text("inkl. 10% Trinkgeld")');
  await page.waitForSelector('.food-order-total:has-text("Gesamtsumme inkl. 10% Trinkgeld")');
  assert.equal(await page.getByText('Zwischensumme', { exact: false }).count(), 0);

  await page.evaluate(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: async (value: string) => { (window as Window & { copiedFoodTotal?: string }).copiedFoodTotal = value; } },
    });
  });
  await page.click('.food-order-item [data-copy-food-total]');
  assert.equal(await page.evaluate(() => (window as Window & { copiedFoodTotal?: string }).copiedFoodTotal), '20,90 €');
  await page.waitForSelector('text=Summe kopiert: 20,90');

  // Whoever collects the money checks an item off once it's paid — works
  // while the order is still open, and stays visible/editable after closing.
  await page.check('[data-toggle-paid]');
  await page.waitForSelector('.food-order-item.is-paid');

  // Anyone can select any mix of items — their own or someone else's — and
  // pay them together in one PayPal link, tip included.
  await page.check('[data-select-pay]');
  const paymentSelector = page.locator('.food-order-payment-selector');
  await page.waitForSelector('.food-order-payment-selector:has-text("1 Position ausgewählt")');
  await page.waitForSelector('.food-order-payment-selector:has-text("20,90")');
  await page.waitForSelector('.food-order-payment-selector:has-text("10% Trinkgeld")');
  assert.equal(
    await paymentSelector.locator('a:has-text("Bezahlen")').getAttribute('href'),
    'https://paypal.me/luigi/20.90EUR'
  );

  // The combined Sammelzahlung total can be copied too, same as a single
  // position's amount.
  await paymentSelector.locator('[data-copy-food-total]').click();
  assert.equal(await page.evaluate(() => (window as Window & { copiedFoodTotal?: string }).copiedFoodTotal), '20,90 €');

  // Adding an unpriced item to the selection withholds the amount entirely
  // (rather than silently undercounting it as 0) and falls back to the raw
  // PayPal link.
  await page.fill('[data-item-desc]', 'Wasser');
  await page.fill('[data-item-quantity]', '1');
  await page.click('[data-add-item-form] button[type="submit"]');
  await page.waitForSelector('text=Wasser');
  await page.locator('.food-order-item', { hasText: 'Wasser' }).locator('[data-select-pay]').check();
  await page.waitForSelector('text=Preis unvollständig');
  assert.equal(await paymentSelector.locator('a:has-text("Bezahlen")').getAttribute('href'), 'https://paypal.me/luigi');
  // No copyable amount while the selection has an unpriced item.
  assert.equal(await paymentSelector.locator('[data-copy-food-total]').count(), 0);

  // Deselecting it goes back to a complete, priced selection.
  await page.locator('.food-order-item', { hasText: 'Wasser' }).locator('[data-select-pay]').uncheck();
  await page.waitForSelector('text=Preis unvollständig', { state: 'detached' });
  assert.equal(
    await paymentSelector.locator('a:has-text("Bezahlen")').getAttribute('href'),
    'https://paypal.me/luigi/20.90EUR'
  );

  // Clearing the PayPal link while an item is still selected must not crash
  // the view (a selection can outlive the link it was made for).
  await page.click('[data-edit-details]');
  await page.fill('#paypal-input', '');
  await page.click('#details-form button[type="submit"]');
  await page.waitForSelector('.food-order-payment-selector', { state: 'detached' });
  await page.waitForSelector('text=Margherita');

  // Restore it for the rest of the flow.
  await page.click('[data-edit-details]');
  await page.fill('#paypal-input', 'https://paypal.me/luigi');
  await page.click('#details-form button[type="submit"]');
  await page.waitForSelector('.food-order-payment-selector');

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
  // "Abgeschickt" (submitted, badge-paused) vs "Geschlossen" (finalized,
  // badge-offline) are deliberately distinct labels/colors in the history.
  await page.waitForSelector('.badge-paused >> text=Abgeschickt');

  // Paid state survives closing, and stays togglable — settling up normally
  // happens after the order is already closed.
  await page.waitForSelector('.food-order-item.is-paid');
  await page.locator('.food-order-item', { hasText: 'Margherita' }).locator('[data-toggle-paid]').uncheck();
  await page.waitForSelector('.food-order-item:not(.is-paid)');

  // Closing only freezes items — the details stay correctable afterward.
  await page.click('[data-edit-details]');
  await setDateTimeField('sendat-input', '2026-12-24T22:00');
  await page.click('#details-form button[type="submit"]');
  await page.waitForSelector('text=Versand 24.12., 22:00 Uhr');

  // Reopening a closed order un-freezes it: items can be added again.
  await page.click('[data-reopen-order]');
  await page.waitForSelector('.badge-playing >> text=Offen');
  await page.fill('[data-item-desc]', 'Vergessene Cola');
  await page.fill('[data-item-quantity]', '1');
  await page.click('[data-add-item-form] button[type="submit"]');
  await page.waitForSelector('text=Vergessene Cola');

  await page.click('[data-close-order]');
  await page.click('[data-confirm]');
  await page.waitForSelector('.badge-paused >> text=Abgeschickt');

  // Finalizing is the creator's terminal lock: no more reopening, editing,
  // or paid toggling.
  await page.click('[data-finalize-order]');
  await page.click('[data-confirm]');
  await page.waitForSelector('.badge-offline >> text=Geschlossen');
  await page.waitForSelector('[data-reopen-order]', { state: 'detached' });
  await page.waitForSelector('[data-edit-details]', { state: 'detached' });
  assert.equal(await page.locator('[data-toggle-paid]').first().isDisabled(), true);
});

test('Arcade: open a quiz lobby, see it on Home, then close it again', async (t) => {
  const guestContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const guestPage = await guestContext.newPage();
  t.after(async () => guestContext.close());
  await addSessionCookie(guestContext, BASE_URL, bob.cookie);
  await guestPage.goto(BASE_URL);
  await guestPage.waitForSelector('.nav-btn[data-view="home"]');

  await page.click('.nav-btn[data-view="more"]');
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
  await page.click('.nav-btn[data-view="home"]');
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
  await page.click('.nav-btn[data-view="more"]');
  await page.click('[data-navigate="arcade"]');

  const guestContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const guestPage = await guestContext.newPage();
  try {
    await addSessionCookie(guestContext, BASE_URL, bob.cookie);
    await guestPage.goto(BASE_URL);
    await guestPage.waitForSelector('.nav-btn[data-view="more"]');
    await guestPage.click('.nav-btn[data-view="more"]');
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
        game === 'pong' ? '21' : '7',
      );
      // Rounded: see the #admin-count assertion above for why.
      assert.equal(await guestPage.locator(`.arcade-lobby-control-bar select[name="${game}-target"]`).evaluate((select) => Math.round(select.getBoundingClientRect().height)), 32);

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
      assert.deepEqual(
        await page.locator('.arcade-lobby-entry-actions > button').allTextContents(),
        ['Verlassen', 'Bereit?'],
      );

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
  const guestContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const guestPage = await guestContext.newPage();
  guestPage.on('pageerror', (err) => console.error('[guest pageerror]', err.message));
  try {
    await addSessionCookie(guestContext, BASE_URL, bob.cookie);
    await guestPage.goto(BASE_URL);
    await guestPage.waitForSelector('.nav-btn[data-view="more"]');
    await guestPage.click('.nav-btn[data-view="more"]');
    await guestPage.click('[data-navigate="arcade"]');
    await guestPage.click('[data-game="quiz"]');

    // Host opens the lobby, guest joins. The quiz tile is a toggle and the
    // previous test left its panel expanded — only click it if it's closed.
    if ((await page.locator('#quiz-create-lobby').count()) === 0) await page.click('[data-game="quiz"]');
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

test('Arcade: a non-player can watch a running quiz without seeing the question', async () => {
  assert.ok(analyticsPlayer, 'expected the analytics spectator account to exist');

  const guestContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const spectatorContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const guestPage = await guestContext.newPage();
  const spectatorPage = await spectatorContext.newPage();
  try {
    await addSessionCookie(guestContext, BASE_URL, bob.cookie);
    await guestPage.goto(BASE_URL);
    await guestPage.waitForSelector('.nav-btn[data-view="more"]');
    await guestPage.click('.nav-btn[data-view="more"]');
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

test('Arcade: Scribble - host draws, a second device guesses correctly, both see the reveal', async () => {
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
    await guesserPage.click('[data-game="scribble"]');

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
        new Promise<void>((resolve, reject) => {
          const probe = (window as any).io();
          const timeout = setTimeout(() => {
            probe.close();
            reject(new Error('watch-list probe timed out'));
          }, 5_000);
          probe.once('connect', () => {
            probe.emit('scope:subscribe', { groupId: 'default-group', eventId: null }, (result: { error?: string }) => {
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

test('An- & Abreise: carpool marks the driver, enforces seats, driver can only delete', async () => {
  // A third player to later demonstrate a full carpool.
  await page.click('.nav-btn[data-view="more"]');
  await page.click('[data-navigate="players"]');
  await createAccountForFlow('E2E Carol');

  await page.click('.nav-btn[data-view="more"]');
  await page.click('[data-navigate="arrivals"]');
  await page.waitForSelector('[data-new-carpool="arrival"]');

  // Current identity is still "E2E Alice Pro" - she creates the carpool and
  // becomes its driver, with just 1 free passenger seat.
  await page.click('[data-new-carpool="arrival"]');
  await page.fill('#carpool-label', 'Auto Alice');
  await page.fill('#carpool-location', 'Hamburg');
  await page.fill('#carpool-seats', '1');
  await page.click('#carpool-form button[type="submit"]');
  await page.waitForSelector('.arrivals-member-row:has-text("E2E Alice Pro"):has-text("Fahrer")');
  await page.waitForSelector('.arrivals-free-seat-row');
  // The driver only ever gets Bearbeiten/Löschen, never a "Raus" button.
  await page.waitForSelector('[data-edit-carpool]');
  await page.waitForSelector('[data-remove-carpool]');
  assert.equal(await page.locator('[data-leave-carpool]').count(), 0);

  // Switch identity to Bob: he joins, taking the last seat.
  await switchIdentityAndOpenArrivals('E2E Bob');
  await page.waitForSelector('[data-join-carpool]');
  await page.click('[data-join-carpool]');
  await page.waitForSelector('.arrivals-free-seat-row', { state: 'detached' });
  await page.waitForSelector('[data-leave-carpool]');

  // "Alle Zeiten" below shows who Bob is riding with.
  const bobTimesRow = page.locator('.arrivals-times-row', { hasText: 'E2E Bob' });
  await bobTimesRow.waitFor();
  assert.match((await bobTimesRow.textContent()) ?? '', /Fahrer: E2E Alice Pro/);

  // A third player finds the carpool full and can't join.
  await switchIdentityAndOpenArrivals('E2E Carol');
  await page.waitForSelector('.arrivals-member-row:has-text("E2E Bob"):has-text("Mitfahrer")');
  assert.equal(await page.locator('.arrivals-free-seat-row').count(), 0);
  assert.equal(await page.locator('[data-join-carpool]').count(), 0);

  // Bob leaves, freeing the seat back up; the driver deletes the group.
  await switchIdentityAndOpenArrivals('E2E Bob');
  await page.click('[data-leave-carpool]');
  await page.waitForSelector('.arrivals-free-seat-row');
  assert.doesNotMatch((await bobTimesRow.textContent()) ?? '', /Fahrer:/);

  await switchIdentityAndOpenArrivals('E2E Alice Pro');
  await page.click('[data-remove-carpool]');
  await page.waitForSelector('[data-confirm]');
  // Destructive confirm dialogs must default focus to Cancel (not the danger
  // action) and use a concrete verb, so a stray Enter right after opening
  // cannot re-trigger the deletion.
  assert.equal(
    await page.locator('.modal-body [data-cancel]').evaluate((el) => el === document.activeElement),
    true
  );
  assert.equal(await page.locator('[data-confirm]').innerText(), 'Löschen');
  assert.equal(
    await page.locator('[data-confirm]').evaluate((el) => el.classList.contains('btn-danger')),
    true
  );
  await page.keyboard.press('Enter');
  await page.waitForSelector('.modal-backdrop', { state: 'detached' });
  // The carpool must still exist - Enter cancelled instead of confirming.
  await page.waitForSelector('[data-remove-carpool]');

  // Deleting for real still works through an explicit confirm click.
  await page.click('[data-remove-carpool]');
  await page.click('[data-confirm]');
  await page.waitForSelector('text=Noch keine Fahrgemeinschaft.');
});

test('Durchsage: notification center can navigate, mark read and remove without duplicating Home', async () => {
  await page.click('.nav-btn[data-view="more"]');
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
    await page.click('details[data-broadcast-history] summary');
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
  await page.click('.nav-btn[data-view="leaderboard"]');
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
  assert.ok(!((await foodNotification.getAttribute('class')) ?? '').includes('is-unread'));

  // Removing is personal and leaves the durable Durchsage itself intact.
  await foodNotification.locator('[data-notification-hide]').click();
  await foodNotification.waitFor({ state: 'detached' });
  await page.click('[data-notification-close]');
  await page.waitForSelector('.lb-row >> text=Essen ist da!');

  // Home no longer renders a second notification history in a different
  // style; notifications live only under the bell.
  await page.click('.nav-btn[data-view="home"]');
  assert.equal(await page.locator('.section-title:has-text("Mitteilungen")').count(), 0);

  // A second message can be ended early by its creator; it remains a past
  // notification until this player removes it from the center.
  await page.click('.nav-btn[data-view="more"]');
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
  await page.waitForSelector('.notification-center-entry.is-unread:has-text("Turnier startet gleich!")');
  await page.click('[data-notifications-seen-all]');
  await page.waitForFunction(() => document.querySelectorAll('.notification-center-entry.is-unread').length === 0);
  await page.click('[data-notifications-hide-all]');
  await page.click('[data-confirm]');
  await page.click('#notifications-btn');
  await page.waitForSelector('text=Keine Mitteilungen.');
  await page.click('[data-notification-close]');

  // A visible time-limited banner removes itself at its deadline even when
  // no later socket event happens and the user never clicks it.
  const meResponse = await page.request.get(`${BASE_URL}/api/me`);
  assert.equal(meResponse.status(), 200);
  const { id: myId } = await meResponse.json() as { id: string };
  const expiring = await page.request.post(`${BASE_URL}/api/broadcasts`, {
    data: { playerId: myId, message: 'Läuft automatisch ab', endsAt: Date.now() + 2000 },
  });
  assert.equal(expiring.status(), 201);
  // APIRequestContext bypasses the sending browser. Phase 5c intentionally
  // has no delivery signal, so model the browser's explicit REST refresh.
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('respawn:notifications-refresh')));
  await page.waitForSelector('#notification-highlight:has-text("Läuft automatisch ab")');
  await page.waitForSelector('#notification-highlight', { state: 'hidden', timeout: 5000 });
});

test('Captain-Draft: pick captains, run the live draft to completion', async () => {
  await page.click('.nav-btn[data-view="matchmaking"]');
  await page.click('[data-mm-mode="draft"]');
  await page.waitForSelector('[data-captain-toggle]');

  // The session account ("E2E Alice Pro") must be a captain so this page is
  // allowed to pick; E2E Bob is the second captain, everyone else is pool.
  await page.click('label.check-row:has-text("E2E Alice Pro") input[data-captain-toggle]');
  await page.click('label.check-row:has-text("E2E Bob") input[data-captain-toggle]');
  await page.waitForSelector('#draft-start:not([disabled])');
  await page.click('#draft-start');
  await page.waitForSelector('text=Captain Draft läuft');

  // The destructive draft-cancel confirmation must read differently than the
  // neighboring Abbrechen button (both used to say "Abbrechen"). Dismiss via
  // the dialog's own Abbrechen button so the draft keeps running afterward.
  await page.click('#draft-cancel');
  await page.waitForSelector('[data-confirm]');
  assert.equal(await page.locator('[data-confirm]').innerText(), 'Draft abbrechen');
  assert.notEqual(
    await page.locator('[data-confirm]').innerText(),
    await page.locator('.modal-body [data-cancel]').innerText(),
  );
  await page.click('.modal-body [data-cancel]');
  await page.waitForSelector('.modal-backdrop', { state: 'detached' });

  // Live board appears; it's Alice's turn (first captain). Keep picking
  // until the pool is empty — the last player is auto-assigned server-side,
  // which ends the draft and returns the view to the regular Teams-auslosen
  // page (no pinned "draft result" card — see matchmaking.js).
  await page.waitForSelector('text=Captain Draft läuft');
  for (let i = 0; i < 8; i++) {
    if ((await page.locator('text=Captain Draft läuft').count()) === 0) break;
    const pick = page.locator('button[data-draft-pick]').first();
    if ((await pick.count()) === 0) break;
    await pick.click();
    await page.waitForTimeout(300);
  }
  await page.waitForSelector('text=Captain Draft läuft', { state: 'detached', timeout: 5000 });

  // The finished draft landed in the shared Historie (not pinned to the
  // page top) with the usual "Ergebnis eintragen" follow-up available there.
  await page.waitForSelector('details.history-details:has(summary:has-text("Historie"))');
  await openMatchmakingHistory();
  await page.waitForSelector('[data-record-draw]');
});

test('the device back button steps back through in-app views instead of leaving the tool', async () => {
  // Land on a known view, then navigate through two more — each deliberate
  // tab switch should push a history entry (see switchView in app.js).
  await page.click('.nav-btn[data-view="home"]');
  await page.waitForSelector('.view-title');
  await page.click('.nav-btn[data-view="votes"]');
  await page.waitForFunction(() => document.querySelector('.view-title')?.textContent === 'Vote');
  await page.click('.nav-btn[data-view="leaderboard"]');
  await page.waitForFunction(() => document.querySelector('.view-title')?.textContent === 'Rang');

  // Back should undo the last switch (leaderboard -> votes), not leave the
  // single-page app (there is nowhere else to navigate to in this test, so
  // if this fell through to real browser navigation the page would end up
  // blank/erroring instead of showing the votes view).
  await page.goBack();
  await page.waitForFunction(() => document.querySelector('.view-title')?.textContent === 'Vote');

  await page.goBack();
  await page.waitForFunction(() => document.querySelector('.view-title')?.textContent === 'Home');

  // Forward should redo the same steps.
  await page.goForward();
  await page.waitForFunction(() => document.querySelector('.view-title')?.textContent === 'Vote');
});

test('Aktuell: an open vote\'s title (if set) shows on Home\'s status card', async () => {
  await page.click('.nav-btn[data-view="votes"]');
  await page.waitForSelector('#votes-title');
  await page.fill('#votes-title', 'Freitagabend-Runde');
  await page.click('#votes-start');
  await page.waitForSelector('#votes-close'); // only rendered once ctx.refresh() shows the round as open

  await page.click('.nav-btn[data-view="home"]');
  await page.waitForSelector('section.grouped-page-section:has(h2:text-is("Aktuell"))');
  await page.waitForSelector('text=Freitagabend-Runde');

  // Leave no open round behind for later tests.
  await page.click('.nav-btn[data-view="votes"]');
  await page.click('#votes-close');
  await page.waitForSelector('#votes-start');
});

test('Kiosk: centers tournament content and shows only the latest feature push across the full width', async () => {
  const playerId = alice.id;

  // Send a Durchsage first, then trigger a different feature's push (opening
  // a food order) — the banner must show the *food order's* push afterward,
  // proving it reflects any notifyPlayers() call, not only Durchsagen.
  await page.request.post(`${BASE_URL}/api/broadcasts`, {
    data: { playerId, message: 'Kiosk-Test-Durchsage' },
  });
  const opponent = await page.request.post(`${BASE_URL}/api/players`, { data: { name: 'Kiosk Gegner' } });
  const opponentId = (await opponent.json()).id;
  const games = await (await page.request.get(`${BASE_URL}/api/games`)).json();
  await page.request.post(`${BASE_URL}/api/votes/start`, {
    data: { mode: 'points', title: 'Kiosk Vote', gameIds: [games[0].id, games[1].id] },
  });
  await page.request.post(`${BASE_URL}/api/votes/points`, {
    data: { playerId, entries: [{ gameId: games[0].id, points: 8 }, { gameId: games[1].id, points: 5 }] },
  });
  await page.request.post(`${BASE_URL}/api/votes/close`);
  await page.request.post(`${BASE_URL}/api/votes/start`, {
    data: { mode: 'single', title: 'Stichwahl: Kiosk Vote', gameIds: [games[0].id, games[1].id] },
  });
  await page.request.post(`${BASE_URL}/api/votes`, { data: { playerId, gameId: games[1].id } });
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
  await page.goto(`${BASE_URL}/kiosk.html?token=${E2E_KIOSK_TOKEN}`);
  assert.equal((await page.locator('.kiosk-header .brand-title').textContent())?.trim(), 'Respawn');
  assert.deepEqual(
    await page.locator('#kiosk-dashboard > .kiosk-card > div').evaluateAll((contents) => contents.map((content) => content.id)),
    ['kiosk-live', 'kiosk-leaderboard', 'kiosk-votes', 'kiosk-tournament'],
  );

  // The last-push banner shows the food order's own push (title "Neue
  // Sammelbestellung"), not the earlier Durchsage — with a timestamp, and
  // it stays up permanently rather than auto-hiding after a few minutes.
  await page.waitForSelector('#kiosk-broadcast:not([hidden]) >> text=Neue Sammelbestellung');
  await page.waitForSelector('#kiosk-broadcast >> text=Kiosk-Test-Pizza');
  await page.waitForSelector('.kiosk-broadcast-time');
  await page.waitForSelector('.notification-banner-body');
  await page.waitForSelector('.kiosk-vote-overview >> text=Stichwahl läuft');
  await page.waitForSelector('.kiosk-vote-overview >> text=Zwischenstand');
  await page.waitForSelector('.kiosk-vote-overview >> text=1 Teilnehmer');
  assert.equal(await page.locator('.kiosk-vote-header').evaluate((element) => getComputedStyle(element).alignItems), 'center');
  await page.waitForSelector('.kiosk-vote-result.is-concealed >> text=1 Stimme');
  assert.equal(await page.locator(`.kiosk-vote-result:has-text("${games[1].name}")`).count(), 0);
  assert.notEqual(await page.locator('.kiosk-vote-result.is-concealed strong').evaluate((element) => getComputedStyle(element).filter), 'none');
  assert.equal(await page.getByText('Ergebnis erst nach dem Ende.', { exact: false }).count(), 0);
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
  const [tournamentBox, metaBox, bracketBodyBox, matchGridBox] = await Promise.all([
    page.locator('#kiosk-tournament').boundingBox(),
    page.locator('.kiosk-tournament-meta').boundingBox(),
    page.locator('.kiosk-tournament-bracket-body').boundingBox(),
    page.locator('.kiosk-match-grid').boundingBox(),
  ]);
  assert.ok(
    tournamentBox && metaBox && Math.abs(tournamentBox.y - metaBox.y) < 4,
    'tournament game and round should remain at the top of the card content area'
  );
  assert.ok(
    bracketBodyBox && matchGridBox && Math.abs(bracketBodyBox.y + bracketBodyBox.height / 2 - (matchGridBox.y + matchGridBox.height / 2)) < 4,
    'tournament bracket should be vertically centered below its metadata'
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
  const kioskGames = games.slice(0, 10) as Array<{ id: string }>;
  await page.request.post(`${BASE_URL}/api/votes/start`, {
    data: { mode: 'points', title: 'Großer Kiosk Vote', gameIds: kioskGames.map((game) => game.id) },
  });
  await page.request.post(`${BASE_URL}/api/votes/points`, {
    data: {
      playerId,
      entries: kioskGames.map((game, index) => ({ gameId: game.id, points: 10 - index })),
    },
  });
  await page.waitForSelector('.kiosk-vote-result:nth-child(10)');
  assert.equal(await page.locator('.kiosk-vote-result').count(), 10);
  assert.equal(await page.locator('.kiosk-vote-result.is-concealed').count(), 10);
  assert.ok(await page.locator('.kiosk-vote-result.is-concealed strong').evaluateAll((names) => {
    const lengths = names.map((name) => name.textContent?.length ?? 0);
    return new Set(lengths).size > 1;
  }), 'concealed game labels should use varying character counts');
  const voteBounds = await page.locator('#kiosk-votes').evaluate((voteContent) => {
    const contentBox = voteContent.getBoundingClientRect();
    const resultBoxes = Array.from(voteContent.querySelectorAll('.kiosk-vote-result')).map((result) => {
      const resultBox = result.getBoundingClientRect();
      return { top: resultBox.top, bottom: resultBox.bottom };
    });
    return {
      content: { top: contentBox.top, bottom: contentBox.bottom },
      results: resultBoxes,
      allVisible: resultBoxes.every((result) => result.top >= contentBox.top && result.bottom <= contentBox.bottom),
    };
  });
  assert.equal(voteBounds.allVisible, true, `ten live vote results should remain visible inside the kiosk card: ${JSON.stringify(voteBounds)}`);
  assert.ok(await page.locator('.kiosk-vote-results').evaluate((results) => {
    const resultBox = results.getBoundingClientRect();
    const parentBox = results.parentElement!.getBoundingClientRect();
    return Math.abs(resultBox.bottom - parentBox.bottom) < 2;
  }), 'live vote results should use the remaining card height');
  const compactVoteRowHeight = (await page.locator('.kiosk-vote-result').first().boundingBox())!.height;
  await page.setViewportSize({ width: 1280, height: 1080 });
  const tallVoteRowHeight = (await page.locator('.kiosk-vote-result').first().boundingBox())!.height;
  assert.ok(tallVoteRowHeight > compactVoteRowHeight * 2, 'tall kiosk cards should distribute their free height across vote rows');
  await page.request.post(`${BASE_URL}/api/votes/close`);
  await page.waitForSelector('.kiosk-vote-countdown >> text=Ergebnis in');
  assert.equal(await page.locator('.kiosk-vote-countdown .countdown-num-fill').textContent(), '5');
  assert.equal(await page.locator('.kiosk-vote-countdown .countdown-num-glow').textContent(), '5');
  assert.equal(await page.locator('.kiosk-vote-countdown .countdown-pop').count(), 1);
  assert.equal(await page.locator('.kiosk-vote-result').count(), 0);
  await page.waitForSelector('.kiosk-vote-final >> text=Ergebnis im Detail', { timeout: 7_000 });
  assert.equal(await page.locator('.kiosk-vote-final .kiosk-vote-result').count(), 10);
  assert.equal(await page.locator('.kiosk-vote-final .kiosk-vote-result.is-concealed').count(), 0);
  assert.equal(await page.locator('.kiosk-vote-final .kiosk-vote-result.is-leading').count(), 0);
  assert.deepEqual(await page.locator('.kiosk-vote-final-title').allTextContents(), ['Gewinner', 'Ergebnis im Detail']);
  assert.equal(
    await page.locator('.kiosk-vote-final-title').evaluateAll((titles) => titles.every((title) => getComputedStyle(title).fontSize === getComputedStyle(titles[0]).fontSize)),
    true,
  );
  await page.waitForSelector(`.kiosk-vote-winner:has-text("${games[0].name}")`);
  assert.equal(await page.locator('.kiosk-vote-final > :first-child').getAttribute('class'), 'kiosk-vote-winner-section');
  assert.ok((await page.locator('.kiosk-vote-winner').evaluate((winner) => getComputedStyle(winner).backgroundImage)).includes('linear-gradient'));
  await page.waitForSelector(`.kiosk-vote-final .kiosk-vote-result:has-text("${games[0].name}")`);
  assert.ok(await page.locator('.kiosk-vote-final').evaluate((result) => {
    const resultBox = result.getBoundingClientRect();
    const contentBox = result.parentElement!.getBoundingClientRect();
    return Math.abs(resultBox.top - contentBox.top) < 2;
  }));
  await page.setViewportSize({ width: 1280, height: 720 });
  assert.equal(await page.locator('#kiosk-votes').evaluate((voteContent) => {
    const contentBox = voteContent.getBoundingClientRect();
    return Array.from(voteContent.querySelectorAll('.kiosk-vote-winner, .kiosk-vote-result')).every((element) => {
      const box = element.getBoundingClientRect();
      return box.top >= contentBox.top && box.bottom <= contentBox.bottom;
    });
  }), true, 'winner and ten detailed results should remain visible at 720p');
  await page.request.post(`${BASE_URL}/api/votes/start`, {
    data: { mode: 'single', title: 'Kiosk Ergebnis ausblenden', gameIds: [games[0].id] },
  });
  await page.waitForSelector('.kiosk-vote-overview >> text=Stichwahl läuft');
  await page.request.post(`${BASE_URL}/api/votes/cancel`);
  await page.waitForSelector('#kiosk-votes >> text=Keine offene Abstimmung.');
  assert.equal(await page.locator('.kiosk-vote-overview').count(), 0);
  assert.ok(await page.locator('#kiosk-votes .kiosk-vote-state').evaluate((emptyState) => {
    const emptyBox = emptyState.getBoundingClientRect();
    const contentBox = emptyState.parentElement!.getBoundingClientRect();
    return Math.abs(emptyBox.y + emptyBox.height / 2 - (contentBox.y + contentBox.height / 2)) < 2;
  }));
  await page.setViewportSize({ width: 390, height: 844 });
});

test('Admin: the verified role exposes tools and can temporarily hide seeded test users', async () => {
  await page.goto(BASE_URL);
  await page.waitForSelector('#app:not([hidden])');

  // Enter admin mode — no PIN prompt, one tap (see docs/KONZEPT-TEST-USER.md).
  await page.click('.nav-btn[data-view="more"]');
  await page.click('[data-navigate="admin"]');
  await page.waitForSelector('#admin-banner:not([hidden]) >> text=Admin-Modus aktiv');

  await page.waitForSelector('#admin-readiness-refresh:not([disabled])');
  assert.equal(await page.locator('#admin-readiness-status').getAttribute('role'), 'status');
  assert.equal(await page.locator('#admin-readiness-status').getAttribute('aria-live'), 'polite');

  let failNextReadiness = true;
  await page.route('**/api/admin/readiness', async (route) => {
    if (!failNextReadiness) {
      await route.continue();
      return;
    }
    failNextReadiness = false;
    await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Temporär nicht verfügbar.' }) });
  });
  await page.focus('#admin-readiness-refresh');
  await page.keyboard.press('Enter');
  await page.waitForSelector('#admin-readiness-retry');
  assert.equal(await page.evaluate(() => document.activeElement?.id), 'admin-readiness-refresh');

  await page.focus('#admin-readiness-retry');
  await page.keyboard.press('Enter');
  await page.waitForSelector('#admin-readiness-refresh:not([disabled])');
  assert.equal(await page.evaluate(() => document.activeElement?.id), 'admin-readiness-refresh');
  await page.unroute('**/api/admin/readiness');

  // Seed test users from the role-protected panel.
  await page.click('.nav-btn[data-view="more"]');
  await page.click('[data-navigate="admin"]');
  const reauthenticated = await page.request.post(`${BASE_URL}/api/auth/reauth`, {
    data: { password: alice.password },
  });
  assert.equal(reauthenticated.status(), 204, await reauthenticated.text());
  await page.fill('#admin-count', '4');
  const seedResponse = page.waitForResponse(
    (response) => response.url().includes('/test-users') && response.request().method() === 'POST'
  );
  await page.click('#admin-bulk');
  const seeded = await seedResponse;
  const seededText = await seeded.text();
  assert.ok(seeded.ok(), `test-user seed failed (${seeded.status()}): ${seededText}`);
  const seededBody = JSON.parse(seededText) as { created: Array<{ id: string; name: string }> };
  const pausedTestPlayer = seededBody.created[2];
  const testSessionInviteResponse = await page.request.post(`${BASE_URL}/api/auth/invites`, {
    data: { purpose: 'test_login', playerId: pausedTestPlayer.id },
  });
  assert.equal(testSessionInviteResponse.status(), 201, await testSessionInviteResponse.text());
  const testSessionInvite = await testSessionInviteResponse.json() as { code: string };
  const testSessionResponse = await fetch(`${BASE_URL}/api/auth/test-session`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code: testSessionInvite.code }),
  });
  assert.equal(testSessionResponse.status, 200, await testSessionResponse.clone().text());
  const testSessionCookie = testSessionResponse.headers.get('set-cookie')?.split(';')[0];
  assert.ok(testSessionCookie, 'test session must set a cookie');
  const pauseResponse = await fetch(`${BASE_URL}/api/live/${pausedTestPlayer.id}/note`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: testSessionCookie },
    body: JSON.stringify({ note: 'Pause / Essen' }),
  });
  assert.equal(pauseResponse.status, 200, await pauseResponse.text());
  await page.click('[aria-label="Mehr Informationen zu Vorhandene Test-Spieler"]');
  await page.waitForFunction((minimum) => {
    const help = document.querySelector('#admin-test-count-help:not([hidden])');
    const match = help?.textContent?.match(/(\d+)\s+Test-Spieler vorhanden/);
    return match !== null && match !== undefined && Number(match[1]) >= minimum;
  }, seededBody.created.length);
  await page.keyboard.press('Escape');
  await page.waitForSelector('.badge-paused >> text=Test');

  assert.equal(await page.locator('#admin-seed-hall').count(), 0);
  const hallSeeded = await page.request.post(`${BASE_URL}/api/admin/test-data/hall-of-fame`);
  assert.ok(hallSeeded.ok(), `hall-of-fame seed failed (${hallSeeded.status()}): ${await hallSeeded.text()}`);
  const hallData = await page.request.get(`${BASE_URL}/api/hall-of-fame`);
  const hallBody = await hallData.json() as { events: Array<{ eventName: string; overallStandings: unknown[]; tournamentChampions: unknown[] }> };
  const testLans = hallBody.events.filter((event) => event.eventName.startsWith('Respawn Test-LAN'));
  assert.equal(testLans.length, 12);
  assert.ok(testLans.every((event) => event.overallStandings.length >= 4 && event.tournamentChampions.length === 3));
  await page.click('.nav-btn[data-view="more"]');
  await page.click('[data-navigate="hallOfFame"]');
  await page.waitForSelector('#hall-event-select');
  assert.equal(await page.getByText('LAN auswählen', { exact: true }).count(), 0);
  assert.equal(await page.locator('.hall-of-fame-event-section').count(), 2);
  assert.equal(await page.locator('.hall-of-fame-event-section.is-tournaments .hall-of-fame-tournament-row').count(), 3);

  // The shared seating plan exposes the real live state compactly after the
  // gamer name: seeded players cover playing + paused while the regular
  // roster also supplies an offline seat. The title/ARIA label keeps the
  // three colors understandable without relying on color alone.
  await page.click('.nav-btn[data-view="home"]');
  await page.waitForSelector('.live-seating .seating-status-indicator.is-playing[aria-label="Status: Spielt"]');
  await page.waitForSelector(`.live-seating [data-player-id="${pausedTestPlayer.id}"] .seating-status-indicator.is-paused[aria-label="Status: Pause"]`);
  await page.waitForSelector('.live-seating .seating-status-indicator.is-offline[aria-label="Status: Offline"]');
  await page.click('.nav-btn[data-view="more"]');
  await page.click('[data-navigate="admin"]');
  await page.click('[data-navigate="seating"]');
  await page.waitForSelector(`.seating-plan.is-editable [data-player-id="${pausedTestPlayer.id}"] .seating-status-indicator.is-paused`);

  // Visible on the roster (Mehr → Spieler) while in admin mode...
  await page.click('.nav-btn[data-view="more"]');
  await page.click('[data-navigate="players"]');
  await page.waitForSelector('text=Test Alex');

  // ...gone everywhere once admin mode is left via the banner.
  await page.click('#admin-banner-leave');
  await page.waitForSelector('#admin-banner', { state: 'hidden' });
  await page.waitForFunction(() => !document.body.textContent?.includes('Test Alex'));

  // Reload restores the display state from the verified admin session.
  await page.reload();
  await page.waitForSelector('#app:not([hidden])');
  await page.waitForSelector('#admin-banner:not([hidden])');
  await page.click('.nav-btn[data-view="more"]');
  await page.click('[data-navigate="admin"]');
  await page.click('#admin-cleanup');
  // confirmDialog is an in-app modal (not a native browser dialog).
  await page.click('[data-confirm]');
  await page.click('[aria-label="Mehr Informationen zu Vorhandene Test-Spieler"]');
  await page.waitForSelector('#admin-test-count-help:not([hidden]) >> text=0 Test-Spieler vorhanden');
  const cleanedHall = await (await page.request.get(`${BASE_URL}/api/hall-of-fame`)).json() as { events: Array<{ eventName: string }> };
  assert.equal(cleanedHall.events.filter((event) => event.eventName.startsWith('Respawn Test-LAN')).length, 0);
});
