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

let server: E2EServer;
let browser: Browser;
let admin: Page;
let member: Page;
let cookie: string;
let alice: E2EAccount;
let bob: E2EAccount;
let eventId: string;
let myId: string;
const pageErrors: string[] = [];
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
  server = await startE2EServer(authenticatedServerEnv());
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
  // Serve the synthetic origin exclusively from the isolated local server.
  await adminContext.route(`${adminBaseUrl}/**`, async (route) => {
    const url = new URL(route.request().url());
    const response = await route.fetch({ url: `${server.baseUrl}${url.pathname}${url.search}` });
    await route.fulfill({ response });
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
  await admin?.context().unrouteAll({ behavior: 'ignoreErrors' });
  await browser?.close();
  server?.process.kill();
});

test('real LAN account, automatic orga credits, own-game betting notification, history and administrative deduction work on phone and desktop', async () => {
  await navigate(admin, 'pointsAdmin');
  await admin.locator('[name="prizeInfo"]').fill('Respawn-Pokal; bei Gleichstand Losentscheid.');
  await admin.getByRole('button', { name: 'Regeln speichern', exact: true }).click();
  await admin.getByText('Budget verfügbar', { exact: true }).waitFor();
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
  await admin.locator('[data-detail-reward]').click();
  await admin.getByRole('button', { name: 'Belohnung festlegen', exact: true }).click();
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
  assert.equal(hidden.standings.find((row: { playerId: string }) => row.playerId === alice.id).points, 105);
  await setPointsVisibility(true);
  await navigate(member, 'points');
  await member.getByRole('region', { name: 'Mein Punktekonto' }).getByText('105', { exact: true }).first().waitFor();
  await member.getByText('Preis & Vergabe: Respawn-Pokal; bei Gleichstand Losentscheid.', { exact: true }).waitFor();
  const standings = member.getByRole('list', { name: 'LAN-Rangliste', exact: true });
  await standings.getByText('Points Bob', { exact: true }).waitFor();
  await api(`/api/players/${bob.id}`, 'PATCH', { name: 'AAA Points Bob' }, bob.cookie);
  await standings.getByText('AAA Points Bob', { exact: true }).waitFor();
  assert.match(await standings.locator('.ranked-list-row').nth(1).innerText(), /AAA Points Bob/);
  assert.equal(await standings.getByText('Points Bob', { exact: true }).count(), 0);
  await member.locator('[data-point-entry]').first().click();
  await member.getByRole('dialog', { name: 'Punktebuchung', exact: true }).waitFor();
  await setPointsVisibility(false);
  await member.getByRole('dialog', { name: 'Punktebuchung', exact: true }).waitFor({ state: 'detached' });
  await member.getByRole('region', { name: 'Mein Punktekonto' }).waitFor({ state: 'detached' });
  assert.equal(await member.locator('.desktop-nav-btn[data-view="points"]').count(), 0);
  await setPointsVisibility(true);
  await navigate(member, 'points');
  await member.getByRole('region', { name: 'Mein Punktekonto' }).getByText('105', { exact: true }).first().waitFor();
  await member.locator('[data-points-source]').selectOption('task');
  assert.equal(await member.locator('.points-journal li').count(), 1);
  await member.locator('[data-point-entry]').click();
  await member.getByRole('dialog').getByText('Orga-Aufgabe', { exact: true }).waitFor();
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
  await member.locator('[data-lock-round]').click();
  await member.getByRole('button', { name: 'Tipps schließen', exact: true }).click();
  await member.getByText('Topf: 15 Punkte · 2 Tipps', { exact: true }).waitFor();
  await api('/api/matches', 'POST', {
    gameId: game.id,
    drawId: draw.id,
    teams: draw.teams.map((team: { players: Array<{ id: string }> }) => ({ playerIds: team.players.map((p) => p.id) })),
    winnerTeamIndex: Number(ownOutcome),
  });
  await member.getByRole('region', { name: 'Mein Punktekonto' }).getByText('110', { exact: true }).first().waitFor();
  await member.getByText(/Auszahlung 15 P. · Netto \+5 P./).waitFor();

  for (const width of [320, 390, 1440]) {
    await member.setViewportSize({ width, height: 900 });
    const geometry = await member.evaluate(() => ({
      viewport: document.documentElement.clientWidth,
      scroll: document.documentElement.scrollWidth,
    }));
    assert.ok(geometry.scroll <= geometry.viewport, `points at ${width}px: ${JSON.stringify(geometry)}`);
    assert.equal(await member.locator('.points-chart svg[role="img"]').count(), 1);
  }
  await navigate(admin, 'pointsAdmin');
  const credit = (await api(`/api/points/admin/entries?eventId=${eventId}`)).entries.find(
    (entry: { source: string; player_id: string }) => entry.source === 'task' && entry.player_id === alice.id,
  );
  assert.deepEqual(
    await admin.evaluate(() => ({ secure: isSecureContext, uuid: typeof crypto.randomUUID })),
    { secure: false, uuid: 'undefined' },
    'deduction must work on a plain HTTP LAN origin without randomUUID',
  );
  await admin.locator(`[data-deduct-entry="${credit.id}"]`).click();
  await admin.getByRole('dialog').locator('[name="amount"]').fill('2');
  await admin.getByRole('dialog').locator('[name="reason"]').fill('Nur teilweise erledigt');
  await admin.getByRole('dialog').getByRole('button', { name: 'Punkte entziehen', exact: true }).click();
  await admin.locator('.modal-backdrop').waitFor({ state: 'detached' });
  await member.getByRole('region', { name: 'Mein Punktekonto' }).getByText('108', { exact: true }).first().waitFor();
  await member.locator('[data-points-source]').selectOption('correction');
  await member.locator('[data-point-entry]').click();
  await member.getByRole('dialog').getByText('Nur teilweise erledigt', { exact: true }).waitFor();
  await member.keyboard.press('Escape');

  // Arrange three equal final balances. Neither names nor sports wins may
  // choose a sole champion when the LAN points are tied.
  const entries = (await api(`/api/points/admin/entries?eventId=${eventId}`)).entries;
  for (const [playerId, amount] of [
    [alice.id, 13],
    [myId, 5],
  ] as const) {
    const start = entries.find(
      (entry: { source: string; player_id: string }) => entry.source === 'start' && entry.player_id === playerId,
    );
    await api(`/api/points/entries/${start.id}/deduct?eventId=${eventId}`, 'POST', {
      amount,
      reason: 'Arrange tied final standings',
      requestId: `tie-${playerId}`,
    });
  }
  await admin.locator('[data-points-close]').click();
  await admin.getByRole('alertdialog').getByRole('button', { name: 'Endwertung festschreiben', exact: true }).click();
  await admin.getByRole('button', { name: 'Wertung wieder öffnen', exact: true }).waitFor();
  await member.getByText('Endstand', { exact: true }).waitFor();
  const final = await api(`/api/points?eventId=${eventId}`);
  assert.equal(typeof final.settings.closed_at, 'number', 'confirming the dialog must persist the final snapshot');
  assert.deepEqual(
    final.standings.map((row: { points: number }) => row.points),
    [95, 95, 95],
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
