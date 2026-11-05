import { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium, type Browser, type Page } from 'playwright';
import {
  authenticatedServerEnv,
  loginE2EAdmin,
  finishE2EOnboarding,
  createE2EAccount,
  addSessionCookie,
  waitForPlayerData,
  type E2EAccount,
} from './authHelpers';
import { startE2EServer, type E2EServer } from './e2eServer';
import { createE2EDiagnosticTest } from './e2eDiagnostics';
import { activateAdminMode } from './navHelpers';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { once } from 'node:events';

let server: E2EServer;
let browser: Browser;
let admin: Page;
let member: Page;
let cookie: string;
let alice: E2EAccount;
let bob: E2EAccount;
let eventId: string;
let myId: string;
let pointsGame: { id: string; name: string };
const fixtureDir = mkdtempSync(path.join(tmpdir(), 'respawn-points-browser-'));
const fixtureDb = path.join(fixtureDir, 'points.db');
const pageErrors: string[] = [];
const proxyAbort = new AbortController();
const proxyErrors: unknown[] = [];
let closingProxy = false;
const test = createE2EDiagnosticTest(() => ({ browser, server }));

async function api(path: string, method = 'GET', body?: unknown, session = cookie): Promise<any> {
  const response = await fetch(`${server.baseUrl}${path}`, {
    method,
    headers: { 'content-type': 'application/json', cookie: session },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  assert.ok(response.ok, `${method} ${path}: ${response.status} ${await response.clone().text()}`);
  return response.status === 204 ? null : response.json();
}
async function navigate(page: Page, view: string) {
  await page.evaluate(
    (target) => window.dispatchEvent(new CustomEvent('respawn:navigate', { detail: { view: target } })),
    view,
  );
  await page.waitForSelector(`#view-container[data-view="${view}"]`);
}
async function setPointsVisibility(visible: boolean) {
  await navigate(admin, 'events');
  const card = admin.locator(`[data-event-card="${eventId}"]`);
  const expand = card.locator('[data-event-card-toggle]');
  if (await expand.count() && await expand.getAttribute('aria-expanded') === 'false') await expand.click();
  await card.getByRole('checkbox', { name: 'LAN-Punkte anzeigen', exact: true }).setChecked(visible);
  await card.locator(`[data-points-visible="${!visible}"]`).waitFor();
  await member.locator('.desktop-nav-btn[data-view="points"]').waitFor({ state: visible ? 'attached' : 'detached' });
}

async function openSection(page: Page, key: string) {
  const section = page.locator(`[data-points-section="${key}"]`);
  await section.waitFor();
  if (!(await section.evaluate((element) => (element as HTMLDetailsElement).open)))
    await section.locator(':scope > summary').click();
}
async function openRoundActions(page: Page, id: string) {
  const menu = page.locator(`[data-action-menu="betting-${id}"]`);
  if (await menu.count() && !(await menu.evaluate((element) => (element as HTMLDetailsElement).open)))
    await menu.locator(':scope > summary').click();
}

before(async () => {
  server = await startE2EServer({ ...authenticatedServerEnv(), DB_FILE: fixtureDb });
  cookie = await loginE2EAdmin(server.baseUrl);
  await finishE2EOnboarding(server.baseUrl, cookie);
  myId = (await api('/api/me')).id;
  alice = await createE2EAccount(server.baseUrl, cookie, 'Points Alice');
  bob = await createE2EAccount(server.baseUrl, cookie, 'Points Bob');
  const event = await api('/api/events', 'POST', {
    name: 'Punkte-Test-LAN',
    eventType: 'lan',
    startsAt: Date.now(),
    endsAt: Date.now() + 86400000,
  });
  eventId = event.id;
  await api(`/api/events/${eventId}/participants`, 'PUT', { playerIds: [myId, alice.id, bob.id] });
  for (const session of [cookie, alice.cookie, bob.cookie]) {
    await api(`/api/events/${eventId}/invitation/accept`, 'POST', {}, session);
    await api('/api/me/active-event', 'PUT', { eventId }, session);
  }
  pointsGame = await api('/api/games', 'POST', { name: 'Punkte-Spiel' });
  // A LAN hostname is not a secure context. Exercise admin actions there as
  // localhost would hide failures in secure-context-only browser APIs.
  browser = await chromium.launch();
  const adminBaseUrl = server.baseUrl.replace('localhost', 'respawn.test');
  const adminContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const memberContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  // The hostname is synthetic; every resource comes from the isolated local
  // server. Node owns the HTTP lifetime so route.fetch's internal requests
  // cannot reject after Playwright has disposed their context.
  await adminContext.route(`${adminBaseUrl}/**`, async (route) => {
    try {
      if (closingProxy) { await route.abort(); return; }
      const original = route.request();
      const url = new URL(original.url());
      const payload = original.postDataBuffer();
      const response = await fetch(`${server.baseUrl}${url.pathname}${url.search}`, {
        method: original.method(), headers: await original.allHeaders(),
        body: payload ? new Uint8Array(payload).buffer : undefined, signal: proxyAbort.signal,
      });
      const headers: Record<string, string> = {};
      response.headers.forEach((value, key) => { headers[key] = value; });
      delete headers['content-encoding']; delete headers['content-length']; delete headers['transfer-encoding'];
      await route.fulfill({ status: response.status, headers, body: Buffer.from(await response.arrayBuffer()) });
    } catch (error) {
      if (!closingProxy) proxyErrors.push(error);
      await route.abort().catch(() => {});
    }
  });
  await addSessionCookie(adminContext, adminBaseUrl, cookie);
  await addSessionCookie(memberContext, server.baseUrl, alice.cookie);
  admin = await adminContext.newPage();
  member = await memberContext.newPage();
  for (const page of [admin, member]) {
    page.on('pageerror', (error) => pageErrors.push(error.message));
    await page.goto(`${page === admin ? adminBaseUrl : server.baseUrl}/#points`);
    await waitForPlayerData(page);
  }
  await activateAdminMode(admin);
});
after(async () => {
  closingProxy = true;
  proxyAbort.abort();
  try {
    await admin?.context().unrouteAll({ behavior: 'wait' });
    await browser?.close();
  } finally {
      if (server && server.process.exitCode === null && server.process.signalCode === null) {
        const exited = once(server.process, 'exit');
        server.process.kill();
        await exited;
      }
      rmSync(fixtureDir, { recursive: true, force: true });
  }
  assert.deepEqual(proxyErrors, [], 'active fixture proxy failures must fail the owner');
});

test('real LAN account, automatic orga credits, own-game betting notification, history and market voids work on phone and desktop', async () => {
  const restoredDisclosures = await member.evaluate(async () => {
    const { captureViewRenderState, restoreViewRenderState } = await globalThis.eval("import('/js/viewRenderState.js')");
    const root = document.createElement('div');
    root.innerHTML = '<details class="history-details" open><summary>Historie</summary></details>';
    const snapshot = captureViewRenderState(root);
    root.innerHTML = '<details class="action-menu" data-action-menu="new-bet"><summary>Wetten</summary></details><details class="history-details"><summary>Historie</summary></details>';
    restoreViewRenderState(root, snapshot);
    return Array.from(root.querySelectorAll('details'), (details) => details.open);
  });
  assert.deepEqual(restoredDisclosures, [false, true], 'an inserted betting menu never inherits the history disclosure state');
  await navigate(admin, 'pointsAdmin');
  await admin.locator('[name="prizeInfo"]').fill('Respawn-Pokal; bei Gleichstand Losentscheid.');
  await admin.getByRole('button', { name: 'Regeln speichern', exact: true }).click();
  await admin.getByText('100 Startpunkte · Max. 20 P. je Wette · Wettplatz ab 2 Abrechnungen mit positivem Netto', { exact: true }).waitFor();
  assert.equal(await admin.getByRole('heading', { name: 'Anzeige für Teilnehmer', exact: true }).count(), 0);
  for (const width of [320, 390, 1440]) {
    await admin.setViewportSize({ width, height: 900 });
    const fits = await admin.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
    );
    assert.equal(fits, true, `points administration at ${width}px`);
  }
  assert.equal(await member.locator('.desktop-nav-btn[data-view="points"]').count(), 0);
  assert.equal((await api(`/api/points?eventId=${eventId}`)).wallet.total, 100);

  const task = await api('/api/checklist/tasks/todo', 'POST', {
    playerId: myId,
    type: 'todo',
    title: 'Netzwerkkabel einsammeln',
  });
  const taskId = task.id ?? task.tasks[0].id;
  await navigate(admin, 'checklist');
  await admin.locator(`[data-task-detail="${taskId}"]`).click();
  assert.equal(await admin.locator('[data-detail-reward]').count(), 0, 'per-task reward setup is retired');
  await admin.keyboard.press('Escape');
  await admin.locator('.modal-backdrop').waitFor({ state: 'detached' });
  await navigate(member, 'checklist');
  await member.locator(`[data-claim-task="${taskId}"]`).click();
  await member.locator('#checklist-claim-form [type="submit"]').click();
  await member.locator('.modal-backdrop').waitFor({ state: 'detached' });
  await member.locator(`[data-task-detail="${taskId}"]`).click();
  assert.equal(await member.getByText(/Du erhältst die Punkte beim Erledigen automatisch/).count(), 0);
  await member.locator('[data-detail-done]').click();
  await member.locator('.modal-backdrop').waitFor({ state: 'detached' });
  const hidden = await api(`/api/points?eventId=${eventId}`);
  assert.equal(hidden.wallet.total, 100);
  await setPointsVisibility(true);
  await admin.setViewportSize({ width: 1366, height: 720 });
  const compactRail = await admin.locator('.desktop-nav-main').evaluate((element) => ({
    overflow: element.scrollHeight - element.clientHeight,
    rowHeights: Array.from(document.querySelectorAll('.desktop-nav-btn'), (button) => button.getBoundingClientRect().height),
  }));
  assert.ok(compactRail.overflow <= 1, `the full LAN rail fits a small desktop: ${JSON.stringify(compactRail)}`);
  assert.ok(compactRail.rowHeights.every((height) => height >= 31 && height <= 33));
  await admin.setViewportSize({ width: 1440, height: 900 });
  await navigate(member, 'points');
  await member.getByRole('region', { name: 'Mein Punktekonto' }).getByText('100', { exact: true }).first().waitFor();
  await openSection(member, 'wallet');
  await member.getByText('Respawn-Pokal; bei Gleichstand Losentscheid.', { exact: true }).waitFor();
  await openSection(member, 'overall-ranking');
  const standings = member.getByRole('list', { name: 'LAN-Rangliste', exact: true });
  await standings.getByText('Points Bob', { exact: true }).waitFor();
  await api(`/api/players/${bob.id}`, 'PATCH', { name: 'AAA Points Bob' }, bob.cookie);
  await standings.getByText('AAA Points Bob', { exact: true }).waitFor();
  assert.match(await standings.locator('.ranked-list-row').first().innerText(), /Points Alice/,
    'the earned Orga category keeps Alice ahead of renamed zero-score entrants');
  assert.match(await standings.locator('.ranked-list-row').nth(1).innerText(), /AAA Points Bob/);
  assert.equal(await standings.getByText('Points Bob', { exact: true }).count(), 0);
  await openSection(member, 'history');
  await member.locator('[data-category-account]').selectOption('wallet');
  assert.equal(await member.getByRole('region', { name: 'Punkteverlauf', exact: true }).count(), 1, 'one history serves all accounts');
  assert.deepEqual(await member.locator('[data-category-account] option').evaluateAll((options) => options.map((option) => (option as HTMLOptionElement).value)), ['orga', 'playing', 'betting', 'wallet']);
  await member.locator('[data-point-entry]').first().click();
  await member.getByRole('dialog', { name: 'Punktebuchung', exact: true }).waitFor();
  await setPointsVisibility(false);
  await member.getByRole('dialog', { name: 'Punktebuchung', exact: true }).waitFor({ state: 'detached' });
  await member.getByRole('region', { name: 'Mein Punktekonto' }).waitFor({ state: 'detached' });
  assert.equal(await member.locator('.desktop-nav-btn[data-view="points"]').count(), 0);
  await setPointsVisibility(true);
  await navigate(member, 'points');
  await member.getByRole('region', { name: 'Mein Punktekonto' }).getByText('100', { exact: true }).first().waitFor();
  await openSection(member, 'history');
  await member.locator('[data-category-account]').selectOption('wallet');
  await member.locator('[data-points-source]').selectOption('start');
  assert.equal(await member.getByRole('region', { name: 'Punkteverlauf', exact: true }).locator('.points-journal li').count(), 1);
  await member.locator('[data-point-entry]').click();
  await member.getByRole('dialog').getByText('Wett-Startguthaben', { exact: true }).first().waitFor();
  await member.keyboard.press('Escape');
  await member.locator('[data-points-source]').selectOption('');

  await navigate(admin, 'leaderboard');
  await admin.getByRole('list', { name: 'LAN-Punkte', exact: true }).waitFor();
  for (const width of [320, 1440]) {
    await admin.setViewportSize({ width, height: 900 });
    assert.equal(await admin.locator('#lb-filter-search').isVisible(), true);
    assert.equal(await admin.locator('#add-match-btn').isVisible(), true);
    assert.equal(await admin.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), true);
    await admin.screenshot({ path: `test-results/points-ranking-${width}.png`, fullPage: true, animations: 'disabled' });
  }
  await admin.locator('#lb-filter-search').fill('Punkte-');
  await admin.keyboard.press('Enter');
  await admin.getByRole('list', { name: 'LAN-Punkte', exact: true }).waitFor({ state: 'detached' });
  await admin.waitForFunction((id) => (document.querySelector('#lb-filter') as HTMLInputElement)?.value === id, pointsGame.id);
  await admin.locator('#lb-filter-search').fill('Alle');
  await admin.keyboard.press('Enter');
  await admin.getByRole('list', { name: 'LAN-Punkte', exact: true }).waitFor();
  await admin.locator('#add-match-btn').focus();
  await admin.keyboard.press('Enter');
  await admin.getByRole('dialog', { name: 'Ergebnis eintragen', exact: true }).waitFor();
  await admin.keyboard.press('Escape');
  await admin.locator('.modal-backdrop').waitFor({ state: 'detached' });

  const game = pointsGame;
  await navigate(member, 'matchmaking');
  await member.locator('#mm-game-search').click();
  await member.locator(`#mm-game-list [data-search-select-value="${game.id}"]`).click();
  for (const id of [myId, alice.id, bob.id])
    await member.locator(`[data-roster-picker="mm-draw-roster"] [data-player="${id}"]`).setChecked(id !== myId);
  await member.locator(`[data-roster-picker="mm-draw-roster"] [data-player="${myId}"]`).setChecked(true);
  await member.locator('#mm-teamcount').fill('3');
  assert.equal(await member.locator('#mm-betting-allowed').isEnabled(), true, 'multi-team draws retain the betting choice');
  assert.equal(await member.locator('#mm-betting-allowed').isChecked(), true);
  await member.locator(`[data-roster-picker="mm-draw-roster"] [data-player="${myId}"]`).setChecked(false);
  await member.locator('#mm-teamcount').fill('2');
  assert.equal(await member.locator('#mm-betting-allowed').isChecked(), true);
  await member.locator('#mm-betting-allowed').focus();
  await member.keyboard.press('Space');
  assert.equal(await member.locator('#mm-betting-allowed').isChecked(), false, 'the creator can opt out of the enabled default');
  await member.keyboard.press('Space');
  await member.waitForFunction(() => document.querySelectorAll('#toast-container .toast').length === 0);
  for (const width of [320, 1440]) {
    await member.setViewportSize({ width, height: 900 });
    await member.locator('#mm-betting-allowed').scrollIntoViewIfNeeded();
    assert.ok(await member.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth));
    await member.screenshot({ path: `test-results/match-betting-choice-${width}.png`, animations: 'disabled' });
  }
  await member.setViewportSize({ width: 390, height: 844 });
  // The only disclosure before the first draw is the empty history. Its
  // remembered state must never be applied to a newly inserted action menu.
  await member.locator('.history-details > summary').click();
  const [createdDraw] = await Promise.all([
    member.waitForResponse((response) => response.url().includes('/api/matchmaking') && response.request().method() === 'POST'),
    member.locator('#mm-generate').click(),
  ]);
  assert.equal(createdDraw.status(), 200);
  const draw = await createdDraw.json();
  assert.equal(draw.bettingAllowed, true, 'a regular member chooses betting while creating the match');
  const round = (await api(`/api/points?eventId=${eventId}`)).rounds.find((row: { sourceId: string }) => row.sourceId === draw.id);
  assert.ok(round, 'the allowed match immediately has a market, without an admin opening it');
  const freshBettingMenu = member.locator(`[data-draw-card="${draw.id}"] [data-action-menu]`);
  await freshBettingMenu.waitFor();
  assert.equal(await freshBettingMenu.evaluate((element) => (element as HTMLDetailsElement).open), false,
    'drawing a match leaves its new betting menu closed');
  assert.equal(await member.locator('.history-details').evaluate((element) => (element as HTMLDetailsElement).open), true);
  assert.equal(await freshBettingMenu.evaluate((menu) => Boolean(menu.closest('.matchmaking-draw-head'))), true, 'fresh matches keep betting in the header');
  await member.locator('#notifications-btn').click();
  await member.locator(`[data-notification-navigate="points"][data-notification-target="${round.id}"]`).click();
  await member.getByRole('dialog', { name: 'Sieger tippen', exact: true }).waitFor();
  assert.equal(await member.getByRole('region', { name: 'Tipprunden', exact: true }).count(), 0, 'points contains no games list');
  assert.equal(await member.getByRole('dialog').locator('[data-tip-context]').innerText(), `${game.name} · Match`, 'context keeps the game and leaves teams in the result selection');
  await member.getByRole('dialog').getByText('Sieger', { exact: true }).waitFor();
  const ownOutcome = round.outcomes.find((outcome: { playerIds: string[] }) => outcome.playerIds.includes(alice.id)).id;
  const otherOutcome = round.outcomes.find((outcome: { id: string }) => outcome.id !== ownOutcome).id;
  assert.equal(await member.locator('[data-tip-form] option[value="__draw__"]').count(), 1,
    'a free-match market offers a selectable draw');
  assert.doesNotMatch(await member.getByRole('dialog').innerText(), /Quoten?/i, 'tip options show no odds');
  await member.locator('[data-tip-form] select').selectOption(ownOutcome);
  await member.locator('[data-tip-form] [name="stake"]').fill('10');
  await member.getByRole('button', { name: 'Tipp speichern', exact: true }).click();
  await member.locator('.modal-backdrop').waitFor({ state: 'detached' });
  await member.locator('[data-wallet-held]').filter({ hasText: /^10$/ }).waitFor();
  // Exercise a real lower-down market while the refresh response is held back.
  // Both the loading phase and the settled refresh must retain scroll and disclosures.
  for (let index = 0; index < 6; index++) await api('/api/matchmaking', 'POST', {
    gameId: game.id, playerIds: index === 0 ? [myId, bob.id] : [alice.id, bob.id], teamCount: 2,
  });
  await navigate(member, 'matchmaking');
  const openDraws = member.locator('.matchmaking-open-draws');
  if (!await openDraws.evaluate((element) => (element as HTMLDetailsElement).open)) await openDraws.locator(':scope > summary').click();
  await member.waitForFunction(() => document.querySelectorAll('#match-history-open [data-history-item]').length === 7);
  const selectedCard = member.locator(`[data-history-item="o-${draw.id}"]`);
  const cardToggle = selectedCard.locator('.matchmaking-history-toggle');
  assert.equal(await cardToggle.getAttribute('aria-expanded'), 'false');
  await member.setViewportSize({ width: 1440, height: 568 });
  await openRoundActions(member, round.id);
  await selectedCard.locator(`[data-tip-round="${round.id}"]`).click();
  const scrollBefore = await member.locator('#view-container').evaluate((element) => element.scrollTop);
  assert.ok(scrollBefore > 100, 'the chosen game is below the initial viewport');
  let releaseRefresh!: () => void;
  const heldRefresh = new Promise<void>((resolve) => { releaseRefresh = resolve; });
  await member.route('**/api/points?*', async (route) => {
    await heldRefresh;
    await route.continue();
  });
  try {
    await member.locator('[data-tip-form] [name="stake"]').fill('11');
    await Promise.all([
      member.waitForRequest((request) => request.method() === 'GET' && new URL(request.url()).pathname === '/api/points'),
      member.getByRole('button', { name: 'Tipp speichern', exact: true }).click(),
    ]);
    await member.locator('.modal-backdrop').waitFor({ state: 'detached' });
    assert.equal(await cardToggle.getAttribute('aria-expanded'), 'false', 'betting preserves a closed match card');
    assert.ok(Math.abs(await member.locator('#view-container').evaluate((element) => element.scrollTop) - scrollBefore) <= 2,
      'a pending refresh keeps the existing content and its scroll position');
  } finally {
    releaseRefresh();
    await member.unrouteAll({ behavior: 'wait' });
  }
  assert.equal((await api(`/api/points?eventId=${eventId}`, 'GET', undefined, alice.cookie)).wallet.held, 11);
  assert.ok(Math.abs(await member.locator('#view-container').evaluate((element) => element.scrollTop) - scrollBefore) <= 2,
    'the refreshed game remains at the same position');
  const filterMenu = member.locator('[data-action-menu="match-filters"]');
  const openFilters = async () => { if (!await filterMenu.evaluate((element) => (element as HTMLDetailsElement).open)) await filterMenu.locator(':scope > summary').click(); };
  await openFilters();
  await member.locator('[data-match-tip-filter="placed"]').click();
  await member.waitForFunction(() => document.querySelectorAll('#match-history-open [data-history-item]').length === 1);
  assert.equal(await selectedCard.count(), 1);
  await member.locator('[data-match-tip-filter="open"]').click();
  await member.waitForFunction(() => document.querySelectorAll('#match-history-open [data-history-item]').length === 6);
  assert.equal(await selectedCard.count(), 0);
  await member.locator('[data-match-mine]').click();
  await member.waitForFunction(() => document.querySelectorAll('#match-history-open [data-history-item]').length === 5);
  await member.locator('[data-match-mine]').click();
  await member.locator('[data-match-tip-filter="open"]').click();
  await member.waitForFunction(() => document.querySelectorAll('#match-history-open [data-history-item]').length === 7);
  await member.keyboard.press('Escape');
  assert.equal(await cardToggle.getAttribute('aria-expanded'), 'false', 'filter changes retain collapsed cards');
  const spectatorRound = (await api(`/api/points?eventId=${eventId}`, 'GET', undefined, alice.cookie)).rounds.find((row: any) => row.sourceType === 'draw' && !row.outcomes.some((outcome: any) => outcome.playerIds.includes(alice.id)));
  const spectatorControls = member.locator(`#match-history-open [data-betting-controls="${spectatorRound.id}"]`);
  assert.equal(await spectatorControls.locator('.action-menu').count(), 0, 'one available action is a direct button');
  await spectatorControls.getByRole('button', { name: 'Wetten', exact: true }).click();
  await member.getByRole('dialog', { name: 'Sieger tippen', exact: true }).waitFor();
  await member.keyboard.press('Escape');
  await cardToggle.click();
  await openRoundActions(member, round.id);
  await selectedCard.locator(`[data-tip-round="${round.id}"]`).click();
  await member.getByRole('button', { name: 'Mehr Informationen zu Hinweise zum Tipp', exact: true }).click();
  await member.getByRole('tooltip').getByText(/Gewinn höchstens in Höhe deines Einsatzes/).waitFor();
  await member.keyboard.press('Escape');
  await member.locator('[data-tip-form] [name="stake"]').fill('1');
  await member.getByRole('button', { name: 'Tipp speichern', exact: true }).click();
  assert.equal((await api(`/api/points?eventId=${eventId}`, 'GET', undefined, alice.cookie)).wallet.held, 1);
  assert.equal(await cardToggle.getAttribute('aria-expanded'), 'true', 'tip changes also retain an opened match');
  await api(
    `/api/points/rounds/${round.id}/tip?eventId=${eventId}`,
    'PUT',
    { outcomeId: otherOutcome, stake: 15 },
    bob.cookie,
  );
  assert.equal((await api(`/api/points?eventId=${eventId}`, 'GET', undefined, alice.cookie)).rounds.find((row: any) => row.id === round.id).pot, 16);
  assert.doesNotMatch(await member.locator('#view-container').innerText(), /Quoten?/i, 'LAN markets show no odds');
  await openRoundActions(member, round.id);
  await selectedCard.locator(`[data-lock-round="${round.id}"]`).click();
  await member.getByRole('button', { name: 'Tipps schließen', exact: true }).click();
  await member.locator(`#match-history-open [data-reopen-round="${round.id}"]`).waitFor({ state: 'attached' });
  await openRoundActions(member, round.id);
  await selectedCard.locator(`[data-reopen-round="${round.id}"]`).click();
  await member.locator(`#match-history-open [data-lock-round="${round.id}"]`).waitFor({ state: 'attached' });
  await openRoundActions(member, round.id);
  await selectedCard.locator(`[data-lock-round="${round.id}"]`).click();
  await member.getByRole('button', { name: 'Tipps schließen', exact: true }).click();
  await member.locator(`#match-history-open [data-reopen-round="${round.id}"]`).waitFor({ state: 'attached' });
  await api('/api/matches', 'POST', {
    gameId: game.id,
    drawId: draw.id,
    teams: draw.teams.map((team: { players: Array<{ id: string }> }) => ({ playerIds: team.players.map((p) => p.id) })),
    winnerTeamIndex: Number(ownOutcome),
  });
  const recordedCard = member.locator(`[data-history-item="${draw.id}"]`);
  await recordedCard.waitFor();
  assert.equal(await recordedCard.locator('.action-menu').count(), 0, 'hidden report actions do not create a one-option menu');
  await recordedCard.locator('[data-tip-round]').click();
  const tipDetails = member.getByRole('dialog', { name: 'Dein Tipp', exact: true });
  await tipDetails.getByText(/Einsatz 1 P. · Auszahlung 2 P. · Netto \+1 P./).waitFor();
  const losingTip = (await api(`/api/points?eventId=${eventId}`, 'GET', undefined, bob.cookie)).rounds.find((row: any) => row.id === round.id).mine;
  assert.deepEqual([losingTip.stake, losingTip.payout, losingTip.net], [15, 14, -1]);
  await tipDetails.getByText(`Dein Tipp: ${round.outcomes.find((outcome: { id: string }) => outcome.id === ownOutcome).label}`, { exact: true }).waitFor();
  assert.doesNotMatch(await tipDetails.innerText(), /Quoten?/i, 'read-only tip details show no odds');
  await tipDetails.locator('[data-report-points]').waitFor();
  assert.ok(await tipDetails.locator('[data-report-points]').evaluate((button) => {
    const outcomes = button.closest('.modal')!.querySelector('.ranked-list')!;
    const standardGap = parseFloat(getComputedStyle(outcomes.closest('form')!.parentElement!).rowGap);
    const contentBottom = Math.max(...Array.from(outcomes.querySelectorAll('.ranked-list-text, .ranked-list-value'))
      .map((item) => item.getBoundingClientRect().bottom));
    return button.getBoundingClientRect().top - contentBottom >= standardGap - 1;
  }), 'reporting has a separate action row below tip details');
  await tipDetails.screenshot({ path: 'test-results/points-tip-details.png', animations: 'disabled' });
  await member.keyboard.press('Escape');
  await navigate(member, 'matchmaking');
  const recordedMatch = member.locator(`[data-history-toggle="${draw.id}"]`);
  if (await recordedMatch.getAttribute('aria-expanded') !== 'true') await recordedMatch.click();
  assert.equal(await recordedCard.locator('.matchmaking-history-head [data-tip-round]').count(), 1, 'recorded matches keep betting in the header');
  assert.doesNotMatch(await member.locator('#view-container').innerText(), /Quoten?/i);
  await navigate(member, 'points');
  await member.getByRole('region', { name: 'Mein Punktekonto' }).getByText('101', { exact: true }).first().waitFor();
  assert.equal(await member.locator('[data-history-item]').count(), 0);

  const categoryData = await api(`/api/points?eventId=${eventId}`, 'GET', undefined, alice.cookie);
  for (const [account, label] of Object.entries({ orga: 'Orga', playing: 'Spielen', betting: 'Wetten' })) {
    await openSection(member, `ranking-${account}`);
    const section = member.locator(`[data-points-section="ranking-${account}"]`);
    const expected = categoryData.standings.filter((row: any) => row.categories[account].rank !== null)
      .sort((a: any, b: any) => a.categories[account].rank - b.categories[account].rank || a.name.localeCompare(b.name, 'de'));
    if (expected.length) {
      const ranking = section.getByRole('list', { name: `${label}-Rangliste`, exact: true });
      await ranking.waitFor();
      assert.deepEqual(await ranking.locator('.ranked-list-title').allTextContents(), expected.map((row: any) => row.name));
      assert.deepEqual(await ranking.locator('.ranked-list-value').allTextContents(), expected.map((row: any) => `${row.categories[account].placePoints} P.`));
    } else await section.getByText('Noch keine Platzierung.', { exact: true }).waitFor();
  }
  for (const width of [320, 390, 1440]) {
    await member.setViewportSize({ width, height: 900 });
    const geometry = await member.evaluate(() => ({
      viewport: document.documentElement.clientWidth,
      scroll: document.documentElement.scrollWidth,
    }));
    assert.ok(geometry.scroll <= geometry.viewport, `points at ${width}px: ${JSON.stringify(geometry)}`);
    const collisions = await member.locator('[data-points-section] > summary').evaluateAll((headers) => headers
      .filter((header) => header.getClientRects().length > 0).filter((header) => {
        const title = header.children[1].getBoundingClientRect();
        const meta = header.children[2]?.getBoundingClientRect();
        return meta && meta.left < title.right && meta.top < title.bottom;
      }).map((header) => header.textContent));
    assert.deepEqual(collisions, [], 'compact headers wrap metadata instead of overlapping labels');
    assert.equal(await member.getByRole('region', { name: 'Punkteverlauf', exact: true }).locator('.points-chart svg[role="img"]').count(), 1);
  }
  await navigate(admin, 'matchmaking');
  await admin.locator('#mm-game-search').click();
  await admin.locator(`#mm-game-list [data-search-select-value="${game.id}"]`).click();
  const adminHistory = admin.locator('.history-details');
  if (!await adminHistory.evaluate((element) => (element as HTMLDetailsElement).open)) await adminHistory.locator(':scope > summary').click();
  assert.deepEqual(await admin.evaluate(() => ({ secure: isSecureContext, uuid: typeof crypto.randomUUID })),
    { secure: false, uuid: 'undefined' }, 'market corrections also work on HTTP LAN origins');
  await openRoundActions(admin, round.id);
  await admin.locator(`[data-refund-round="${round.id}"]`).click();
  await admin.getByRole('dialog').locator('textarea').fill('Ungültiges Spielergebnis');
  await admin.getByRole('dialog').getByRole('button', { name: 'Abrechnung stornieren', exact: true }).click();
  await admin.locator('.modal-backdrop').waitFor({ state: 'detached' });
  await member.getByRole('region', { name: 'Mein Punktekonto' }).getByText('100', { exact: true }).first().waitFor();
  assert.equal((await api(`/api/points?eventId=${eventId}`, 'GET', undefined, alice.cookie)).categoryBalances.betting, 0);
  // Menus must remain usable inside the real scrolling bracket, above sibling games.
  const cup = await api('/api/tournaments', 'POST', { gameId: game.id, name: 'KompakterWettpokalMitBesondersLangemTitelOhneLeerzeichen'.padEnd(60, 'x'),
    format: 'single_elimination', teams: [myId, alice.id, bob.id].map((id) => ({ playerIds: [id] })) });
  const fixture = cup.matches.find((match: any) => !match.isBye && match.teamAId && match.teamBId);
  const market = (await api(`/api/points?eventId=${eventId}`)).rounds.find((row: any) => row.sourceId === fixture.id);
  for (const [index, session] of [alice.cookie, bob.cookie].entries())
    await api(`/api/points/rounds/${market.id}/tip`, 'PUT', { outcomeId: market.outcomes[index].id, stake: 5 }, session);
  await admin.evaluate((id) => { window.location.hash = `#tournaments/${id}`; }, cup.id);
  const controls = admin.locator(`[data-betting-controls="${market.id}"]`);
  await controls.waitFor();
  assert.equal(await admin.locator('.page-title-row [data-betting-controls]').count(), 0, 'champion betting stays below the title and tournament metadata');
  await admin.locator('[aria-label="Turniersieger tippen"] [data-betting-controls]').waitFor();
  for (const width of [320, 390, 1440]) {
    await admin.setViewportSize({ width, height: 900 });
    assert.ok(await admin.evaluate(() => {
      const root = document.querySelector('#view-container')!;
      const actions = document.querySelector('.page-title-row .points-actions')!.getBoundingClientRect();
      return root.scrollWidth <= root.clientWidth + 1 && actions.left >= 0 && actions.right <= innerWidth + 1;
    }), `long tournament titles keep the content pane and header actions in bounds at ${width}px`);
  }
  assert.doesNotMatch(await admin.locator('#view-container').innerText(), /Quoten?/i, 'tournament teams and fixtures show no odds');
  await controls.locator('summary').click();
  const panel = controls.locator('.action-menu-panel');
  await panel.waitFor();
  assert.equal(await panel.evaluate((element) => element.matches(':popover-open')), true);
  assert.equal(await panel.locator('button').evaluateAll((buttons) => buttons.every((button) => {
    const rect = button.getBoundingClientRect();
    return button.contains(document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2));
  })), true, 'every menu action remains reachable over the bracket and neighboring games');
  await controls.locator('[data-tip-round]').click();
  await admin.getByRole('dialog', { name: 'Sieger tippen', exact: true }).waitFor();
  assert.doesNotMatch(await admin.getByRole('dialog').innerText(), /Quoten?/i, 'tournament tip options show no odds');
  assert.equal(await admin.getByRole('dialog').locator('textarea').count(), 0);
  const tournamentDialog = admin.getByRole('dialog');
  await tournamentDialog.locator('[data-tip-context]').getByText(new RegExp(cup.name)).waitFor();
  const tournamentRounds = (await api(`/api/points?eventId=${eventId}`)).rounds.filter((row: any) => row.tournament?.id === cup.id);
  assert.deepEqual((await tournamentDialog.locator('[data-tip-select] option').evaluateAll((options) => options.map((option) => (option as HTMLOptionElement).value))).sort(), tournamentRounds.map((row: any) => row.id).sort());
  await tournamentDialog.locator('[name="stake"]').fill('3');
  const outright = tournamentRounds.find((row: any) => row.sourceType === 'tournament');
  await tournamentDialog.locator('[data-tip-select]').selectOption(outright.id);
  await admin.getByRole('dialog', { name: 'Turniersieger tippen', exact: true }).waitFor();
  await tournamentDialog.locator('[name="stake"]').fill('2');
  await tournamentDialog.locator('[data-tip-select]').selectOption(market.id);
  assert.equal(await tournamentDialog.locator('[name="stake"]').inputValue(), '3', 'switching tips retains unsaved selections');
  await tournamentDialog.locator('[data-tip-select]').selectOption(outright.id);
  await tournamentDialog.getByRole('button', { name: 'Speichern & weiter', exact: true }).click();
  await admin.getByRole('dialog', { name: 'Sieger tippen', exact: true }).waitFor();
  assert.equal(await tournamentDialog.locator('[data-tip-select]').inputValue(), market.id);
  assert.equal(await tournamentDialog.locator('[name="stake"]').inputValue(), '3');
  await tournamentDialog.getByRole('button', { name: 'Tipp speichern', exact: true }).click();
  await admin.locator('.modal-backdrop').waitFor({ state: 'detached' });
  await api(`/api/tournaments/${cup.id}/matches/${fixture.id}/result`, 'POST', { winnerTeamId: fixture.teamAId });
  assert.equal((await api(`/api/points?eventId=${eventId}`)).rounds.find((row: any) => row.id === market.id).status, 'settled',
    'a tournament result settles accepted tips even without manual closing');
  await admin.locator(`[data-open-result="${fixture.id}"]`).click();
  await admin.getByRole('dialog', { name: 'Ergebnis', exact: true }).waitFor();
  assert.equal(await admin.getByRole('dialog').getByRole('button', { name: 'Punktefehler melden', exact: true }).count(), 0,
    'editing a result has no points-report action');
  await admin.keyboard.press('Escape');
  // Create a shared positive playing score and remove prior claims through
  // the supported correction API, without editing any wallet.
  const entries = (await api(`/api/points/admin/journal?eventId=${eventId}`)).entries;
  for (const entry of entries.filter((row: { account: string; amount: number }) => row.account === 'playing' && row.amount > 0))
    await api(`/api/points/admin/journal/${entry.id}/correct?eventId=${eventId}`, 'POST',
      { total: 0, revision: entry.revision, reason: 'Arrange tied playing raw scores' });
  await api('/api/matches', 'POST', { gameId: game.id,
    teams: [myId, alice.id, bob.id].map((id) => ({ playerIds: [id], rank: 1 })) });
  const orgaEntries = (await api(`/api/points/admin/journal?eventId=${eventId}`)).entries;
  const correctedSources = new Set<string>();
  for (const entry of orgaEntries.filter((row: { account: string }) => row.account === 'orga')) {
    const key = `${entry.playerId}:${entry.sourceKey}`;
    if (correctedSources.has(key)) continue;
    correctedSources.add(key);
    await api(`/api/points/admin/journal/${entry.id}/correct?eventId=${eventId}`, 'POST',
      { total: 0, revision: entry.revision, reason: 'Arrange tied category standings' });
  }
  await navigate(admin, 'pointsAdmin');
  await admin.locator('[data-points-close]').click();
  await admin.getByRole('alertdialog').getByRole('button', { name: 'Endwertung festschreiben', exact: true }).click();
  await admin.getByRole('button', { name: 'Wertung wieder öffnen', exact: true }).waitFor();
  await member.getByText('Endstand', { exact: true }).waitFor();
  const final = await api(`/api/points?eventId=${eventId}`);
  assert.equal(typeof final.settings.closed_at, 'number', 'confirming the dialog must persist the final snapshot');
  assert.deepEqual(
    final.standings.map((row: { points: number }) => row.points),
    [3, 3, 3],
  );
  assert.ok(final.standings.every((row: { categories: { playing: { raw: number; rank: number; placePoints: number } } }) =>
    row.categories.playing.raw === 2 && row.categories.playing.rank === 1 && row.categories.playing.placePoints === 3));

  await navigate(admin, 'hallOfFame');
  await admin.locator('[data-hall-section="events"] > summary').click();
  const placements = admin.getByRole('list', { name: 'Gesamtplatzierungen', exact: true });
  await placements.waitFor();
  assert.deepEqual(await placements.locator('.ranked-list-rank').allTextContents(), ['1', '1', '1']);
  await admin.locator('[data-hall-section="overall"] > summary').click();
  const champions = admin.getByRole('list', { name: 'Meiste Gesamtsiege', exact: true });
  assert.equal(await champions.locator('.ranked-list-row').count(), 3);
  assert.deepEqual(await champions.locator('.ranked-list-rank').allTextContents(), ['1', '1', '1']);
  assert.deepEqual(pageErrors, [], 'visibility updates and point actions must not raise browser errors');
});

test('token-only kiosk pages every result participant and removes point columns live while retaining corrections', async () => {
  const extra = [];
  for (let i = 0; i < 5; i++) extra.push(await createE2EAccount(server.baseUrl, cookie, `Kiosk Spieler mit langem Namen ${i}`));
  const ids = [myId, alice.id, bob.id, ...extra.map((p) => p.id)];
  const event = await api('/api/events', 'POST', {
    name: 'Ergebnis-Broadcast-LAN', eventType: 'lan', startsAt: Date.now(), endsAt: Date.now() + 86400000,
  });
  await api(`/api/events/${event.id}/participants`, 'PUT', { playerIds: ids });
  for (const session of [cookie, alice.cookie, bob.cookie, ...extra.map((p) => p.cookie)]) {
    await api(`/api/events/${event.id}/invitation/accept`, 'POST', {}, session);
  }
  await api('/api/me/active-event', 'PUT', { eventId: event.id });
  const groupId = (await api('/api/groups'))[0].id;
  const credential = await api(`/api/groups/${groupId}/kiosk-tokens`, 'POST', { eventId: event.id });
  const context = await browser.newContext({ viewport: { width: 390, height: 900 } });
  const kiosk = await context.newPage();
  const errors: string[] = [];
  kiosk.on('pageerror', (error) => errors.push(error.message));
  try {
    const game = await api('/api/games', 'POST', { name: 'Ein langes Spiel mit vielen Teilnehmern im Broadcast' });
    const teams = ids.map((id, i) => ({ playerIds: [id], rank: i + 1 }));
    const match = await api('/api/matches', 'POST', { gameId: game.id, teams });
    await kiosk.clock.install();
    await kiosk.goto(`${server.baseUrl}/kiosk.html?token=${credential.token}`);
    const results = kiosk.locator('#kiosk-results');
    await results.getByRole('table', { name: game.name, exact: true }).waitFor();
    assert.equal(await results.getByRole('columnheader', { name: 'Spielpunkte', exact: true }).count(), 0);
    // Actual API visibility change must update the anonymous shared screen.
    await api(`/api/events/${event.id}/points-visibility`, 'PATCH', { visible: true, revision: 0 });
    await results.getByRole('columnheader', { name: 'Spielpunkte', exact: true }).waitFor();
    const repeatedRefresh = kiosk.waitForResponse((response) => response.url().endsWith('/api/results/feed') && response.ok());
    await api(`/api/events/${event.id}/points-visibility`, 'PATCH', { visible: true, revision: 1 });
    await repeatedRefresh;
    await results.getByRole('columnheader', { name: 'Spielpunkte', exact: true }).waitFor();

    for (const viewport of [{ width: 320, height: 900 }, { width: 390, height: 900 }, { width: 1280, height: 720 }, { width: 1440, height: 900 }]) {
      await kiosk.setViewportSize(viewport);
      // The ResizeObserver must finish fitting before sampling the next page.
      await kiosk.waitForFunction(() => {
        const panel = document.querySelector('#kiosk-results')!;
        const bottom = panel.getBoundingClientRect().bottom;
        const rows = Array.from(panel.querySelectorAll('tbody tr')).filter((row) => !(row as HTMLElement).hidden);
        return rows.length > 0 && rows.every((row) => row.getBoundingClientRect().bottom <= bottom + 1);
      });
      const names = new Set<string>();
      for (let turn = 0; turn < 8; turn++) {
        const measured = await results.evaluate((element) => {
          const area = element.getBoundingClientRect();
          return {
            fits: document.documentElement.scrollWidth <= document.documentElement.clientWidth,
            captionHeight: element.querySelector('.kiosk-result-caption')!.getBoundingClientRect().height,
            rows: Array.from(element.querySelectorAll('tbody tr')).filter((row) => !(row as HTMLElement).hidden).map((row) => ({
              name: row.querySelector('.kiosk-result-name')!.textContent!, bottom: row.getBoundingClientRect().bottom,
            })), bottom: area.bottom,
          };
        });
        assert.equal(measured.fits, true, `page width at ${viewport.width}`);
        assert.ok(measured.rows.length > 0);
        assert.ok(measured.captionHeight >= 14, `game title remains visible at ${viewport.width}`);
        for (const row of measured.rows) {
          assert.ok(row.bottom <= measured.bottom + 1, `visible row fits at ${viewport.width}: ${JSON.stringify(measured)}`);
          names.add(row.name);
        }
        await kiosk.clock.runFor(10_000);
      }
      assert.equal(names.size, 8, `all eight participants rotate at ${viewport.width}`);
    }
    await api(`/api/matches/${match.id}`, 'PATCH', { gameId: game.id, teams: teams.map((team, i) => ({ ...team, score: 8 - i })) });
    await results.getByText('korrigiert', { exact: true }).waitFor();
    await api(`/api/events/${event.id}/points-visibility`, 'PATCH', { visible: false, revision: 2 });
    await results.getByRole('columnheader', { name: 'Spielpunkte', exact: true }).waitFor({ state: 'detached' });
    await results.getByRole('table', { name: game.name, exact: true }).waitFor();
    await results.getByText('korrigiert', { exact: true }).waitFor();
    assert.deepEqual(errors, []);
    await kiosk.screenshot({ path: 'test-results/kiosk-results-desktop.png' });
    await kiosk.setViewportSize({ width: 390, height: 900 });
    await kiosk.screenshot({ path: 'test-results/kiosk-results-phone.png' });
    await api('/api/tournaments', 'POST', {
      gameId: game.id, name: 'Broadcast-Pokal', format: 'single_elimination',
      teams: ids.slice(0, 2).map((id) => ({ playerIds: [id] })),
    });
    await kiosk.locator('#kiosk-tournament .kiosk-tournament-overview').waitFor({ state: 'attached' });
    await kiosk.clock.runFor(10_000);
    await kiosk.locator('#kiosk-tournament').waitFor({ state: 'visible' });
    await kiosk.locator('#kiosk-tournament-title').getByText('Broadcast-Pokal', { exact: true }).waitFor();
    await kiosk.clock.runFor(10_000);
    await results.waitFor({ state: 'visible' });
    assert.equal(await results.getByRole('columnheader', { name: 'Spielpunkte', exact: true }).count(), 0);

  } finally {
    await context.close();
    await api('/api/me/active-event', 'PUT', { eventId });
  }
});

test('category history and reasoned own and foreign corrections stay consistent across phone, desktop and hidden points', async () => {
  const event = await api('/api/events', 'POST', {
    name: 'Kategorie-Journal-LAN', eventType: 'lan', startsAt: Date.now(), endsAt: Date.now() + 86400000,
  });
  await api(`/api/events/${event.id}/participants`, 'PUT', { playerIds: [myId, alice.id, bob.id] });
  for (const session of [cookie, alice.cookie, bob.cookie]) {
    await api(`/api/events/${event.id}/invitation/accept`, 'POST', {}, session);
    await api('/api/me/active-event', 'PUT', { eventId: event.id }, session);
  }
  const game = await api('/api/games', 'POST', { name: 'Kategorie-Spiel mit einem langen Namen für den Verlauf' });
  const match = await api('/api/matches', 'POST', {
    gameId: game.id, teams: [{ playerIds: [myId] }, { playerIds: [alice.id] }], winnerTeamIndex: 1,
  });
  await api(`/api/events/${event.id}/points-visibility`, 'PATCH', { visible: true, revision: 0 });
  const journalUrl = `/api/points/admin/journal?eventId=${event.id}`;
  const initialJournal = (await api(journalUrl)).entries;
  const own = initialJournal.find((entry: any) => entry.playerId === myId && entry.account === 'orga' && entry.sourceKey === `match:${match.id}`);
  const foreign = initialJournal.find((entry: any) => entry.playerId === alice.id && entry.account === 'playing' && entry.sourceKey === `match:${match.id}`);
  assert.ok(own && foreign);
  const adminOrigin = new URL(admin.url()).origin;
  const journalRoute = '**/api/points/admin/journal?*';
  await admin.route(journalRoute, async (route) => {
    await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Journal vorübergehend nicht erreichbar' }) });
  });
  try {
    await admin.goto(`${adminOrigin}/?eventId=${event.id}#pointsAdmin`);
    await member.goto(`${server.baseUrl}/?eventId=${event.id}#points`);
    await Promise.all([waitForPlayerData(admin), waitForPlayerData(member)]);
    await activateAdminMode(admin);
    await navigate(admin, 'pointsAdmin');
    await navigate(member, 'points');
    const personal = member.getByRole('region', { name: 'Meine Kategorien', exact: true });
    const history = member.getByRole('region', { name: 'Punkteverlauf', exact: true });
    await openSection(member, 'history');
    const administration = admin.getByRole('region', { name: 'Kategorie-Journal', exact: true });
    await personal.locator('[data-category-balance=\"playing\"]').filter({ hasText: /^4$/ }).waitFor();
    await history.getByText('Noch keine Buchungen.', { exact: true }).waitFor();
    await administration.getByText('Journal vorübergehend nicht erreichbar', { exact: true }).waitFor();
    // The failed response is complete. Remove its interceptor before retrying,
    // so subsequent requests use only the ordinary synthetic-HTTP forwarding.
    await admin.unrouteAll({ behavior: 'wait' });
    await administration.locator('[data-category-admin-refresh]').click();
    await administration.locator(`[data-admin-category-entry="${own.id}"]`).waitFor();
    await history.locator('[data-category-account]').selectOption('playing');
    await openSection(member, 'category-chart');
    await history.getByRole('img', { name: /Spielen-Punkteverlauf: 1 Buchungen, aktuell 4 Punkte/ }).waitFor();
    await history.locator('[data-category-entry]').click();
    await member.getByRole('dialog', { name: 'Kategorie-Buchung', exact: true }).getByText('+4 P.', { exact: true }).waitFor();
    await member.getByRole('dialog', { name: 'Kategorie-Buchung', exact: true }).getByText(/Spiel:.* · Platz 1$/).waitFor();
    await member.keyboard.press('Escape');
    assert.equal((await api(journalUrl)).entries.length, initialJournal.length, 'opening either journal never adds an award');
    async function correctInUi(id: string, total: number, reason: string) {
      await administration.locator(`[data-admin-category-entry="${id}"]`).click();
      const form = admin.locator('[data-category-correction]');
      await form.locator('[name="total"]').fill(String(total));
      await form.locator('[name="reason"]').fill(reason);
      await form.getByRole('button', { name: 'Korrektur speichern', exact: true }).click();
      await form.waitFor({ state: 'detached' });
    }
    await correctInUi(own.id, -2, 'Eigene Orga-Punkte begründet korrigiert');
    assert.equal((await api(`/api/points?eventId=${event.id}`)).categoryBalances.orga, -2);
    await administration.locator(`[data-admin-category-entry="${own.id}"]`).click();
    assert.equal(await admin.locator('[data-category-correction] [name="total"]').inputValue(), '-2', 'an old booking opens the full current source claim');
    await admin.keyboard.press('Escape');
    await correctInUi(own.id, 0, 'Eigenen Anspruch auf null setzen');
    await correctInUi(foreign.id, 3, 'Spielpunkte eines Teilnehmers korrigiert');
    await personal.locator('[data-category-balance=\"playing\"]').filter({ hasText: /^3$/ }).waitFor();
    await history.getByText('Spielpunkte eines Teilnehmers korrigiert', { exact: true }).waitFor();
    // Keep an edit open across a real concurrent source correction. The stale
    // form must close and refresh after 409 instead of overwriting the change.
    await administration.locator(`[data-admin-category-entry="${foreign.id}"]`).click();
    await api(`/api/points/admin/journal/${foreign.id}/correct?eventId=${event.id}`, 'POST', {
      total: 2, revision: 2, reason: 'Zwischenzeitliche Korrektur aus anderer Sitzung',
    });
    await admin.locator('[data-category-correction] [name="total"]').fill('1');
    await admin.locator('[data-category-correction] [name="reason"]').fill('Veralteter Bearbeitungsstand');
    await admin.getByRole('button', { name: 'Korrektur speichern', exact: true }).click();
    await admin.locator('[data-category-correction]').waitFor({ state: 'detached' });
    await personal.locator('[data-category-balance=\"playing\"]').filter({ hasText: /^2$/ }).waitFor();
    assert.equal((await api(`/api/points?eventId=${event.id}`, 'GET', undefined, alice.cookie)).categoryBalances.playing, 2);
    await navigate(admin, 'checklist');
    await admin.locator('#checklist-new-todo-btn').click();
    await admin.locator('#todo-title').fill('Switch nach der LAN einpacken');
    assert.equal(await admin.locator('#todo-points').count(), 0);
    assert.equal(await admin.getByText('Beim Erledigen erhält der erste fremde Helfer einmalig 3 Orga-Punkte.', { exact: true }).count(), 0, 'fixed rewards do not add explanatory copy to every task form');
    await admin.setViewportSize({ width: 390, height: 844 });
    await admin.locator('#toast-container .toast').waitFor({ state: 'detached' });
    await admin.screenshot({ path: 'test-results/todo-points-form-phone.png', animations: 'disabled' });
    await admin.locator('#checklist-todo-form [type=submit]').click();
    await admin.locator('#checklist-todo-form').waitFor({ state: 'detached' });
    const todo = (await api('/api/checklist/tasks')).tasks.find((task: any) => task.title === 'Switch nach der LAN einpacken');
    assert.equal(todo.pointsValue, 3);
    await navigate(member, 'checklist');
    await member.setViewportSize({ width: 320, height: 568 });
    assert.equal(await member.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), true);
    await member.locator(`[data-claim-task="${todo.id}"]`).click();
    await member.locator('#checklist-claim-form [type=submit]').click();
    await member.locator('#checklist-claim-form').waitFor({ state: 'detached' });
    await member.locator(`[data-task-detail="${todo.id}"]`).click();
    assert.equal(await member.getByText('3 P. einmalig für den ersten Helfer, der nicht der Ersteller ist.', { exact: true }).count(), 0, 'the standard reward is omitted from task details');
    await member.locator('[data-detail-done]').click();
    await member.locator('.modal-backdrop').waitFor({ state: 'detached' });
    await navigate(member, 'points');
    await personal.locator('[data-category-balance="orga"]').filter({ hasText: /^3$/ }).waitFor();
    assert.equal((await api(`/api/points?eventId=${event.id}`, 'GET', undefined, alice.cookie)).wallet.total, 100);
    await navigate(admin, 'pointsAdmin');
    for (const page of [admin, member]) {
      for (const viewport of [{ width: 320, height: 568 }, { width: 390, height: 844 }, { width: 512, height: 384 }, { width: 1440, height: 900 }]) {
        await page.setViewportSize(viewport);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), true);
      }
    }
    await member.setViewportSize({ width: 390, height: 844 });
    await member.screenshot({ path: 'test-results/category-points-phone.png', fullPage: true });
    await openSection(member, 'history');
    await history.locator('[data-category-entry]').first().click();
    await member.getByRole('dialog', { name: 'Kategorie-Buchung', exact: true }).waitFor();
    await api(`/api/events/${event.id}/points-visibility`, 'PATCH', { visible: false, revision: 1 });
    await member.getByRole('dialog', { name: 'Kategorie-Buchung', exact: true }).waitFor({ state: 'detached' });
    await personal.waitFor({ state: 'detached' });
    await administration.waitFor();
    await correctInUi(own.id, -1, 'Eigene Korrektur bei ausgeblendeter Teilnehmeransicht');
    assert.equal((await api(`/api/points?eventId=${event.id}`)).categoryBalances.orga, -1);
    await administration.getByText('Eigene Korrektur bei ausgeblendeter Teilnehmeransicht', { exact: true }).waitFor();
    await admin.screenshot({ path: 'test-results/category-points-admin.png', fullPage: true });
    await navigate(member, 'checklist');
    await member.locator(`[data-task-detail="${todo.id}"]`).click();
    assert.equal(await member.getByText('Orga-Punkte', { exact: true }).count(), 0);
    await member.locator('[data-detail-reopen]').click();
    await member.locator('.modal-backdrop').waitFor({ state: 'detached' });
    const todoClaim = async () => (await api(journalUrl)).entries
      .filter((entry: any) => entry.playerId === alice.id && entry.sourceKey === `todo:${todo.id}`)
      .reduce((sum: number, entry: any) => sum + entry.amount, 0);
    assert.equal(await todoClaim(), 0, 'reopening reverses the reward even while points are hidden');
    await member.locator(`[data-task-detail="${todo.id}"]`).click();
    await member.locator('[data-detail-done]').click();
    await member.locator('.modal-backdrop').waitFor({ state: 'detached' });
    assert.equal(await todoClaim(), 3, 'hidden recompletion restores the claim exactly once');
    assert.deepEqual(pageErrors, []);
  } finally {
    await admin.unrouteAll({ behavior: 'wait' });
    for (const session of [cookie, alice.cookie, bob.cookie]) await api('/api/me/active-event', 'PUT', { eventId }, session);
  }
});

test('poll and event-start travel awards update the open personal journal live', async () => {
  const future = Date.now() + 3_600_000;
  const event = await api('/api/events', 'POST', { name: 'Orga-Boni-LAN', eventType: 'lan', startsAt: future, endsAt: future + 86_400_000 });
  await api(`/api/events/${event.id}/participants`, 'PUT', { playerIds: [myId, alice.id, bob.id] });
  for (const session of [cookie, alice.cookie, bob.cookie]) {
    await api(`/api/events/${event.id}/invitation/accept`, 'POST', {}, session);
    await api('/api/me/active-event', 'PUT', { eventId: event.id }, session);
  }
  try {
    await api(`/api/events/${event.id}/points-visibility`, 'PATCH', { visible: true, revision: 0 });
    await api('/api/arrivals/mine', 'PUT', { playerId: alice.id, arrivalAt: future + 10_000, departureAt: future + 20_000 }, alice.cookie);
    await member.goto(`${server.baseUrl}/?eventId=${event.id}#points`);
    await waitForPlayerData(member);
    await navigate(member, 'points');
    const category = member.getByRole('region', { name: 'Meine Kategorien', exact: true });
    await category.locator('[data-category-balance="orga"]').filter({ hasText: /^0$/ }).waitFor();
    const poll = await api(`/api/events/${event.id}/polls`, 'POST', {
      topic: 'custom', title: 'Gemeinsame Pause', responseMode: 'feasibility',
      options: [{ label: 'Früh' }, { label: 'Spät' }],
    }, alice.cookie);
    const responses = poll.options.map((option: { id: string }) => ({ optionId: option.id, response: 'can' }));
    for (const session of [cookie, alice.cookie, bob.cookie])
      await api(`/api/events/${event.id}/polls/${poll.id}/my-responses`, 'PUT', { responses }, session);
    await api(`/api/events/${event.id}/polls/${poll.id}/close`, 'POST', {}, alice.cookie);
    await category.locator('[data-category-balance="orga"]').filter({ hasText: /^3$/ }).waitFor();
    // The source timestamps predate this start. Let the real background sweep
    // cross it and wait for the observable live balance rather than sleeping.
    const db = new Database(fixtureDb);
    db.prepare('UPDATE events SET starts_at=? WHERE id=?').run(Date.now() + 500, event.id);
    db.close();
    await category.locator('[data-category-balance="orga"]').filter({ hasText: /^7$/ }).waitFor();
    const history = member.getByRole('region', { name: 'Punkteverlauf', exact: true });
    await openSection(member, 'history');
    await history.getByText('Umfrage abgeschlossen: Gemeinsame Pause', { exact: true }).waitFor();
    await history.getByText('Ankunft eingetragen', { exact: true }).waitFor();
    await history.getByText('Abreise eingetragen', { exact: true }).waitFor();
    assert.deepEqual(pageErrors, []);
  } finally {
    for (const session of [cookie, alice.cookie, bob.cookie]) await api('/api/me/active-event', 'PUT', { eventId }, session);
  }
});

test('a participant reports awarded points, the sole admin reviews anonymously, and finalization refunds both market states', async () => {
  const initial = await api(`/api/points?eventId=${eventId}`);
  if (initial.settings.closed_at) await api('/api/points/reopen', 'POST', { reason: 'Prüfung der endgültigen Wertung' });
  if (!initial.settings.visible) await setPointsVisibility(true);
  const task = (await api('/api/checklist/tasks/todo', 'POST', { title: 'Punkteprüfung am Abschluss' }, alice.cookie)).tasks[0];
  await api(`/api/checklist/tasks/${task.id}/claim`, 'POST', { playerId: myId });
  await api(`/api/checklist/tasks/${task.id}/done`, 'PATCH', { playerId: myId });
  await navigate(member, 'checklist');
  await member.locator(`[data-task-detail="${task.id}"]`).click();
  await member.getByRole('button', { name: 'Punktefehler melden', exact: true }).click();
  const reportDialog = member.getByRole('dialog', { name: 'Punktefehler melden', exact: true });
  const privateReason = `Privater Absender: Points Alice <img src=x onerror="window.pointReportXss=true"> ${'x'.repeat(200)}`;
  await reportDialog.locator('[name="reason"]').fill(privateReason);
  await reportDialog.locator('[type="submit"]').focus();
  await member.keyboard.press('Enter');
  const ownInbox = member.getByRole('dialog', { name: 'Punktefehler-Meldungen', exact: true });
  await ownInbox.getByText('Offen', { exact: true }).waitFor();
  await ownInbox.getByText(privateReason, { exact: true }).waitFor();
  assert.equal(await ownInbox.locator('img').count(), 0, 'private report text is escaped');
  const reports = await api('/api/points/reports', 'GET', undefined, alice.cookie);
  const reportId = reports.own.find((r: { targetId: string }) => r.targetId === task.id).id;
  await navigate(admin, 'pointsAdmin');
  await admin.getByRole('button', { name: 'Meldungen', exact: true }).click();
  const adminInbox = admin.getByRole('dialog', { name: 'Punktefehler-Meldungen', exact: true });
  const row = adminInbox.locator(`[data-points-report-id="${reportId}"]`);
  await row.getByText('Anonyme Meldung zu eigenen Punkten. Absender und Freitext sind verborgen.', { exact: true }).waitFor();
  assert.ok(!(await adminInbox.innerText()).includes('Privater Absender'));
  assert.ok(!(await adminInbox.innerText()).includes('Points Alice'));
  const blocked = await fetch(`${server.baseUrl}/api/points/close`, { method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: '{}' });
  assert.equal(blocked.status, 409);
  await admin.screenshot({ path: 'test-results/points-report-admin-1440.png', fullPage: true, animations: 'disabled' });
  await adminInbox.getByRole('button', { name: 'Zum Punktejournal', exact: true }).click();
  await admin.locator('[data-admin-category-account]').selectOption('orga');
  await admin.locator('[data-admin-category-query]').fill(task.id);
  await admin.locator('[data-admin-category-query]').press('Tab');
  await admin.getByRole('region', { name: 'Kategorie-Journal', exact: true }).getByText('Aufgabe erledigt: Punkteprüfung am Abschluss', { exact: true }).waitFor();
  await admin.getByRole('button', { name: 'Meldungen', exact: true }).click();
  await adminInbox.locator(`[data-points-report-id="${reportId}"]`).getByRole('button', { name: 'In Ordnung', exact: true }).click();
  const resolution = admin.getByRole('dialog', { name: 'Meldung: In Ordnung', exact: true });
  await resolution.locator('[name="resolution"]').fill('Vergabe anhand der Aufgabe geprüft.');
  await resolution.getByRole('button', { name: 'Meldung abschließen', exact: true }).click();
  await ownInbox.locator(`[data-points-report-id="${reportId}"]`).getByText('In Ordnung', { exact: true }).waitFor();
  await member.setViewportSize({ width: 320, height: 568 });
  assert.equal(await member.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), true);
  await member.screenshot({ path: 'test-results/points-report-member-320.png', fullPage: true, animations: 'disabled' });
  while (await admin.locator('.modal-backdrop').count()) await admin.keyboard.press('Escape');
  while (await member.locator('.modal-backdrop').count()) await member.keyboard.press('Escape');
  const marketIds: string[] = [];
  for (const locked of [false, true]) {
    const draw = await api('/api/matchmaking', 'POST', { gameId: pointsGame.id, playerIds: [alice.id, bob.id], teamCount: 2 });
    const data = await api('/api/points');
    const round = data.rounds.find((r: { sourceId: string }) => r.sourceId === (draw.drawId ?? draw.id));
    marketIds.push(round.id);
    await api(`/api/points/rounds/${round.id}/tip`, 'PUT', { outcomeId: '0', stake: 5 }, alice.cookie);
    await api(`/api/points/rounds/${round.id}/tip`, 'PUT', { outcomeId: '1', stake: 5 }, bob.cookie);
    if (locked) await api(`/api/points/rounds/${round.id}/lock`, 'POST', {});
  }
  await navigate(admin, 'pointsAdmin');
  await admin.getByRole('button', { name: 'LAN-Endwertung festschreiben', exact: true }).click();
  await admin.getByRole('alertdialog').getByRole('button', { name: 'Endwertung festschreiben', exact: true }).click();
  await admin.getByRole('button', { name: 'Wertung wieder öffnen', exact: true }).waitFor();
  const final = await api('/api/points');
  assert.ok(final.rounds.filter((r: { id: string }) => marketIds.includes(r.id)).every((r: { status: string }) => r.status === 'refunded'));
  for (const session of [alice.cookie, bob.cookie]) assert.equal((await api('/api/points', 'GET', undefined, session)).wallet.held, 0);
  await navigate(member, 'points');
  await member.getByRole('heading', { name: 'Gesamt-Endstand', exact: true }).waitFor();
  assert.equal(await member.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), true);
  const [download] = await Promise.all([member.waitForEvent('download'), member.getByRole('button', { name: 'Endstand herunterladen', exact: true }).click()]);
  const exported = JSON.parse(readFileSync((await download.path())!, 'utf8'));
  assert.equal(exported.revision, final.revisions[0].revision);
  assert.deepEqual(exported.standings, final.standings);
  assert.deepEqual(pageErrors, []);
});
