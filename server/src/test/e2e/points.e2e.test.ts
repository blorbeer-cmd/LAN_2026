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
import { mkdtempSync, rmSync } from 'node:fs';
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
const fixtureDir = mkdtempSync(path.join(tmpdir(), 'respawn-points-browser-'));
const fixtureDb = path.join(fixtureDir, 'points.db');
const pageErrors: string[] = [];
const pendingHttpRoutes = new Set<Promise<void>>();
let closingHttpRoutes = false;
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
  await card.getByRole('button', { name: visible ? 'Für Teilnehmer anzeigen' : 'Für Teilnehmer ausblenden', exact: true }).click();
  await card.getByRole('button', { name: visible ? 'Für Teilnehmer ausblenden' : 'Für Teilnehmer anzeigen', exact: true }).waitFor();
  await member.locator('.desktop-nav-btn[data-view="points"]').waitFor({ state: visible ? 'attached' : 'detached' });
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
  // A LAN hostname is not a secure context. Exercise admin actions there as
  // localhost would hide failures in secure-context-only browser APIs.
  browser = await chromium.launch();
  const adminBaseUrl = server.baseUrl.replace('localhost', 'respawn.test');
  const adminContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const memberContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  // Serve the insecure LAN origin exclusively from the isolated local server.
  // Drain complete callbacks, including their cancellation cleanup, before
  // disposing the request context or stopping the real server.
  await adminContext.route(`${adminBaseUrl}/**`, (route) => {
    const completion = (async () => {
      try {
        const url = new URL(route.request().url());
        const response = await route.fetch({ url: `${server.baseUrl}${url.pathname}${url.search}` });
        await route.fulfill({ response });
      } catch (error) {
        const cancelled = error instanceof Error &&
          /Route is already handled|Request context disposed|Target page, context or browser has been closed/.test(error.message);
        if (!closingHttpRoutes || !cancelled) throw error;
        // A cancelled page request no longer needs a response. Active-test
        // failures still propagate; only fixture teardown consumes cancellation.
        await route.abort('aborted').catch(() => {});
      }
    })();
    pendingHttpRoutes.add(completion);
    void completion.then(() => pendingHttpRoutes.delete(completion), () => pendingHttpRoutes.delete(completion));
    return completion;
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
  closingHttpRoutes = true;
  await admin?.context().unrouteAll({ behavior: 'wait' });
  await Promise.all([...pendingHttpRoutes]);
  await browser?.close();
  if (server && server.process.exitCode === null && server.process.signalCode === null) {
    const exited = once(server.process, 'exit');
    server.process.kill();
    await exited;
  }
  rmSync(fixtureDir, { recursive: true, force: true });
});

test('real LAN account, automatic orga credits, own-game betting notification, history and market voids work on phone and desktop', async () => {
  await navigate(admin, 'pointsAdmin');
  await admin.locator('[name="prizeInfo"]').fill('Respawn-Pokal; bei Gleichstand Losentscheid.');
  await admin.getByRole('button', { name: 'Regeln speichern', exact: true }).click();
  await admin.getByText('Jeder Teilnehmer erhält einmalig 100 Wettpunkte pro Event, auch bei später Zusage. Orga- und Spielpunkte erhöhen das Wettguthaben nicht.', { exact: true }).waitFor();
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
  await navigate(member, 'points');
  await member.getByRole('region', { name: 'Mein Punktekonto' }).getByText('100', { exact: true }).first().waitFor();
  await member.getByText('Preis & Vergabe: Respawn-Pokal; bei Gleichstand Losentscheid.', { exact: true }).waitFor();
  const standings = member.getByRole('list', { name: 'LAN-Rangliste', exact: true });
  await standings.getByText('Points Bob', { exact: true }).waitFor();
  await api(`/api/players/${bob.id}`, 'PATCH', { name: 'AAA Points Bob' }, bob.cookie);
  await standings.getByText('AAA Points Bob', { exact: true }).waitFor();
  assert.match(await standings.locator('.ranked-list-row').first().innerText(), /AAA Points Bob/);
  assert.equal(await standings.getByText('Points Bob', { exact: true }).count(), 0);
  await member.locator('[data-point-entry]').first().click();
  await member.getByRole('dialog', { name: 'Punktebuchung', exact: true }).waitFor();
  await setPointsVisibility(false);
  await member.getByRole('dialog', { name: 'Punktebuchung', exact: true }).waitFor({ state: 'detached' });
  await member.getByRole('region', { name: 'Mein Punktekonto' }).waitFor({ state: 'detached' });
  assert.equal(await member.locator('.desktop-nav-btn[data-view="points"]').count(), 0);
  await setPointsVisibility(true);
  await navigate(member, 'points');
  await member.getByRole('region', { name: 'Mein Punktekonto' }).getByText('100', { exact: true }).first().waitFor();
  await member.locator('[data-points-source]').selectOption('start');
  assert.equal(await member.getByRole('region', { name: 'Punkteverlauf', exact: true }).locator('.points-journal li').count(), 1);
  await member.locator('[data-point-entry]').click();
  await member.getByRole('dialog').getByText('Wett-Startguthaben', { exact: true }).first().waitFor();
  await member.keyboard.press('Escape');
  await member.locator('[data-points-source]').selectOption('');

  const game = await api('/api/games', 'POST', { name: 'Punkte-Spiel' });
  const draw = await api('/api/matchmaking', 'POST', { gameId: game.id, playerIds: [alice.id, bob.id], teamCount: 2 });
  await navigate(admin, 'matchmaking');
  await admin.locator(`[data-open-betting-source="${draw.id}"]`).click();
  await admin.getByRole('button', { name: 'Runde öffnen & benachrichtigen', exact: true }).click();
  await admin.locator('.modal-backdrop').waitFor({ state: 'detached' });
  const round = (await api(`/api/points?eventId=${eventId}`)).rounds[0];
  await member.locator('#notifications-btn').click();
  await member.locator(`[data-notification-navigate="points"][data-notification-target="${round.id}"]`).click();
  await member.waitForFunction((id) => window.location.hash === `#points/round/${id}`, round.id);
  await member.locator('[data-tip-round]').click();
  const ownOutcome = round.outcomes.find((outcome: { playerIds: string[] }) => outcome.playerIds.includes(alice.id)).id;
  const otherOutcome = round.outcomes.find((outcome: { id: string }) => outcome.id !== ownOutcome).id;
  assert.equal(await member.locator('[data-tip-form] option[value="__draw__"]').count(), 1,
    'a free-match market offers a selectable draw');
  await member.locator('[data-tip-form] select').selectOption(ownOutcome);
  await member.locator('[data-tip-form] [name="stake"]').fill('10');
  await member.getByRole('button', { name: 'Tipp speichern', exact: true }).click();
  await member.locator('.modal-backdrop').waitFor({ state: 'detached' });
  await member.getByText('Für Wetten reserviert', { exact: true }).waitFor();
  await api(
    `/api/points/rounds/${round.id}/tip?eventId=${eventId}`,
    'PUT',
    { outcomeId: otherOutcome, stake: 5 },
    bob.cookie,
  );
  await member.getByText(/Topf: 15 Punkte · 2 Tipps/).waitFor();
  await member.getByText(/Quoten vorläufig/).waitFor();
  await member.getByText('10 P. · Quote 1.50', { exact: true }).waitFor();
  await member.getByText('5 P. · Quote 3.00', { exact: true }).waitFor();
  await member.locator('[data-lock-round]').click();
  await member.getByRole('button', { name: 'Tipps schließen', exact: true }).click();
  await member.getByText('Topf: 15 Punkte · 2 Tipps', { exact: true }).waitFor();
  await api('/api/matches', 'POST', {
    gameId: game.id,
    drawId: draw.id,
    teams: draw.teams.map((team: { players: Array<{ id: string }> }) => ({ playerIds: team.players.map((p) => p.id) })),
    winnerTeamIndex: Number(ownOutcome),
  });
  await member.getByRole('region', { name: 'Mein Punktekonto' }).getByText('105', { exact: true }).first().waitFor();
  await member.getByText(/Auszahlung 15 P. · Netto \+5 P./).waitFor();

  for (const width of [320, 390, 1440]) {
    await member.setViewportSize({ width, height: 900 });
    const geometry = await member.evaluate(() => ({
      viewport: document.documentElement.clientWidth,
      scroll: document.documentElement.scrollWidth,
    }));
    assert.ok(geometry.scroll <= geometry.viewport, `points at ${width}px: ${JSON.stringify(geometry)}`);
    assert.equal(await member.getByRole('region', { name: 'Punkteverlauf', exact: true }).locator('.points-chart svg[role="img"]').count(), 1);
  }
  await navigate(admin, 'points');
  assert.deepEqual(await admin.evaluate(() => ({ secure: isSecureContext, uuid: typeof crypto.randomUUID })),
    { secure: false, uuid: 'undefined' }, 'market corrections also work on HTTP LAN origins');
  await admin.locator(`[data-refund-round="${round.id}"]`).click();
  await admin.getByRole('dialog').locator('textarea').fill('Ungültiges Spielergebnis');
  await admin.getByRole('dialog').getByRole('button', { name: 'Abrechnung stornieren', exact: true }).click();
  await admin.locator('.modal-backdrop').waitFor({ state: 'detached' });
  await member.getByRole('region', { name: 'Mein Punktekonto' }).getByText('100', { exact: true }).first().waitFor();
  assert.equal((await api(`/api/points?eventId=${eventId}`, 'GET', undefined, alice.cookie)).categoryBalances.betting, 0);
  // The interim standings show playing raw scores. Prepare a shared zero score
  // through the supported category correction API, without editing any wallet.
  const entries = (await api(`/api/points/admin/journal?eventId=${eventId}`)).entries;
  for (const entry of entries.filter((row: { account: string; amount: number }) => row.account === 'playing' && row.amount > 0))
    await api(`/api/points/admin/journal/${entry.id}/correct?eventId=${eventId}`, 'POST',
      { total: 0, revision: entry.revision, reason: 'Arrange tied playing raw scores' });
  await navigate(admin, 'pointsAdmin');
  await admin.locator('[data-points-close]').click();
  await admin.getByRole('alertdialog').getByRole('button', { name: 'Endwertung festschreiben', exact: true }).click();
  await admin.getByRole('button', { name: 'Wertung wieder öffnen', exact: true }).waitFor();
  await member.getByText('Endstand', { exact: true }).waitFor();
  const final = await api(`/api/points?eventId=${eventId}`);
  assert.equal(typeof final.settings.closed_at, 'number', 'confirming the dialog must persist the final snapshot');
  assert.deepEqual(
    final.standings.map((row: { points: number }) => row.points),
    [0, 0, 0],
  );

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
    const history = member.getByRole('region', { name: 'Kategorie-Verlauf', exact: true });
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
    await history.getByRole('img', { name: /Spielen-Punkteverlauf: 1 Buchungen, aktuell 4 Punkte/ }).waitFor();
    await history.locator('[data-category-entry]').click();
    await member.getByRole('dialog', { name: 'Kategorie-Buchung', exact: true }).getByText('+4 P.', { exact: true }).waitFor();
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
    await admin.getByText('Beim Erledigen erhält der erste fremde Helfer einmalig 3 Orga-Punkte.', { exact: true }).waitFor();
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
    await member.getByText('3 P. einmalig für den ersten Helfer, der nicht der Ersteller ist.', { exact: true }).waitFor();
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
    const history = member.getByRole('region', { name: 'Kategorie-Verlauf', exact: true });
    await history.getByText('Umfrage abgeschlossen: Gemeinsame Pause', { exact: true }).waitFor();
    await history.getByText('Ankunft eingetragen', { exact: true }).waitFor();
    await history.getByText('Abreise eingetragen', { exact: true }).waitFor();
    assert.deepEqual(pageErrors, []);
  } finally {
    for (const session of [cookie, alice.cookie, bob.cookie]) await api('/api/me/active-event', 'PUT', { eventId }, session);
  }
});
