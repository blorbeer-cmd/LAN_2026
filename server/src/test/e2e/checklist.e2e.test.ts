// Browser E2E test for the To-Do table (docs/KONZEPT-PACKLISTE-TICKETS.md):
// any active member creates a To-Do, picks its Art and an optional due date,
// several members take it over from the row, one marks it done in the detail
// dialog and it stays struck through until archived. Separate from the fast
// unit/integration suite (`npm test`) - run via `npm run test:e2e`.

import { before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { ChildProcess } from 'child_process';
import { chromium, Browser, Page } from 'playwright';
import {
  addSessionCookie,
  switchSessionCookie,
  authenticatedServerEnv,
  createE2EAccount,
  E2EAccount,
  loginE2EAdmin,
  waitForPlayerData,
} from './authHelpers';
import { createE2EDiagnosticTest } from './e2eDiagnostics';
import { startE2EServer, type E2EServer } from './e2eServer';
import { openMoreViewEntry } from './navHelpers';

let BASE_URL: string;

let serverProcess: ChildProcess;
let e2eServer: E2EServer;
let browser: Browser;
let page: Page;
let alice: E2EAccount;
let bob: E2EAccount;

const test = createE2EDiagnosticTest(() => ({ browser, server: e2eServer }));

async function openChecklist(): Promise<void> {
  await openMoreViewEntry(page, '[data-navigate="eventPolls"]');
  await page.waitForSelector('.view-title:has-text("Orga")');
  await page.click('[data-section-tab="checklist"]');
}

async function switchAccount(account: E2EAccount): Promise<void> {
  await switchSessionCookie(page, BASE_URL, account.cookie);
  await page.waitForSelector('#app:not([hidden])');
  // The shell unhides while main() is still booting: it wires the
  // 'respawn:navigate' listener and applies the URL's own route only
  // afterwards. A navigation dispatched inside that window is dropped (no
  // listener yet) or overwritten by that startup route, and the test then
  // runs against the view the previous test left behind. main() publishes
  // the end of that phase as the history entry it replaces right before its
  // own switchView, so wait for that state instead of the shell alone.
  await page.waitForFunction(() => Boolean(window.history.state?.view));
  await waitForPlayerData(page);
}

before(async () => {
  const server = await startE2EServer(authenticatedServerEnv());
  e2eServer = server;
  serverProcess = server.process;
  BASE_URL = server.baseUrl;
  const adminCookie = await loginE2EAdmin(BASE_URL);
  alice = await createE2EAccount(BASE_URL, adminCookie, 'E2E Checklist Alice');
  bob = await createE2EAccount(BASE_URL, adminCookie, 'E2E Checklist Bob');
  browser = await chromium.launch();
  page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  page.on('dialog', (d) => void d.accept());
  page.on('pageerror', (err) => console.error('[pageerror]', err.message));
  page.on('console', (msg) => {
    if (msg.type() === 'error') console.error('[console.error]', msg.text());
  });
});

after(async () => {
  await browser?.close();
  serverProcess?.kill();
});

test('create a To-Do as one member, take it over as another, finish it in the details and archive it', async () => {
  await addSessionCookie(page.context(), BASE_URL, alice.cookie);
  await page.goto(BASE_URL);
  await page.waitForSelector('#app:not([hidden])');
  await openChecklist();
  await page.waitForSelector('#checklist-new-todo-btn:not([disabled])');

  // Orga opens on To-Dos (not Packliste), and the area's tab row marks it.
  assert.equal(await page.locator('[data-section-tab="checklist"]').getAttribute('aria-current'), 'page');
  assert.equal(await page.locator('[data-section-tab="checklistPacking"]').getAttribute('aria-current'), null);

  await page.click('#checklist-new-todo-btn');
  await page.waitForSelector('#todo-title');
  await page.fill('#todo-title', 'Mehrfachsteckdosen mitbringen');
  await page.fill('#todo-description', 'Mindestens zwei Stück.');

  // Toggling "Art" rebuilds the whole form (its placeholders follow the
  // kind), which also tears down and recreates every button in it - focus
  // must land back on the equivalent new button, not fall through to
  // <body>, or keyboard/screen-reader users have to re-tab through the
  // entire modal after every toggle.
  await page.click('[data-todo-kind="item_request"]');
  assert.equal(
    await page.evaluate(() => document.activeElement?.getAttribute('data-todo-kind')),
    'item_request',
    'focus should follow the clicked Art toggle across its own re-render',
  );
  assert.equal(await page.inputValue('#todo-title'), 'Mehrfachsteckdosen mitbringen', 'title survives the Art toggle');
  await page.click('[data-todo-kind="todo"]');
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('data-todo-kind')), 'todo');

  // Pick a due date via the themed date-only picker (no time-of-day row).
  await page.click('[data-dt-field="todo-due"] [data-dt-trigger]');
  await page.waitForSelector('.dt-popover');
  assert.equal(await page.locator('[data-dt-field="todo-due"] [data-dt-time]').count(), 0, 'due date picker has no time-of-day controls');
  await page.keyboard.press('Escape');
  for (const width of [390, 1024]) {
    await page.setViewportSize({ width, height: 844 });
    // Crossing the 640px breakpoint swaps the modal's entry animation from
    // sheet-in to dialog-in, which restarts it (scale + translateY, 0.18s).
    // The popover is placed from the trigger's live, transformed rect. While
    // the restarted animation is still pending on its first keyframe the
    // trigger looks stable to click(), so on a slow runner the picker opened
    // ~2px off and only later month switches saw the settled dialog.
    await page.locator('.modal:has(#checklist-todo-form)').evaluate((modal) => Promise.all(modal.getAnimations().map((animation) => animation.finished)));
    // February 2027 has four weeks, March five and May six.
    await page.fill('#todo-due-date', '15022027');
    await page.locator('#todo-due-date').blur();
    await page.click('[data-dt-field="todo-due"] [data-dt-trigger]');
    const calendar = page.locator('.dt-popover');
    const monthSelect = calendar.locator('[data-dt-month-select]');
    const yearSelect = calendar.locator('[data-dt-year-select]');
    const pickerGeometry = await calendar.evaluate((popover) => {
      const month = (popover.querySelector('[data-dt-month-select]') as HTMLElement).getBoundingClientRect();
      const year = (popover.querySelector('[data-dt-year-select]') as HTMLElement).getBoundingClientRect();
      const bounds = popover.getBoundingClientRect();
      return {
        monthWidth: month.width,
        yearWidth: year.width,
        rightEdge: Math.max(month.right, year.right),
        popoverRight: bounds.right,
      };
    });
    assert.ok(pickerGeometry.monthWidth >= 128, `month selector keeps room at ${width}px`);
    assert.ok(pickerGeometry.yearWidth >= 90, `year selector keeps room at ${width}px`);
    assert.ok(pickerGeometry.rightEdge <= pickerGeometry.popoverRight + 1, `selectors stay inside picker at ${width}px`);
    const heights = [];
    const todayPositions = [];
    for (const month of ['1', '2', '4']) {
      await monthSelect.selectOption(month);
      const rowHeights = await calendar.locator('tbody tr').evaluateAll((rows) => rows.map((row) => row.getBoundingClientRect().height));
      assert.equal(rowHeights.length, 6);
      assert.ok(Math.max(...rowHeights) - Math.min(...rowHeights) <= 1, `all calendar rows reserve equal height at ${width}px: ${rowHeights}`);
      heights.push((await calendar.boundingBox())!.height);
      todayPositions.push((await calendar.locator('[data-dt-today]').boundingBox())!.y);
    }
    assert.ok(Math.max(...heights) - Math.min(...heights) <= 1, `calendar height stays stable at ${width}px: ${heights}`);
    assert.ok(Math.max(...todayPositions) - Math.min(...todayPositions) <= 1, `Today stays put at ${width}px: ${todayPositions}`);
    await monthSelect.focus();
    for (const month of ['5', '6']) {
      await page.keyboard.press('ArrowDown');
      assert.equal(await monthSelect.inputValue(), month);
      assert.equal(await monthSelect.evaluate((element) => element === document.activeElement), true, 'month changes retain select focus');
    }
    await page.keyboard.press('Tab');
    assert.equal(await yearSelect.evaluate((element) => element === document.activeElement), true, 'Tab moves from month to year');
    for (const year of ['2028', '2029']) {
      await page.keyboard.press('ArrowDown');
      assert.equal(await yearSelect.inputValue(), year);
      assert.equal(await yearSelect.evaluate((element) => element === document.activeElement), true, 'year changes retain select focus');
    }
    await calendar.locator('[data-dt-day][tabindex="0"]').focus();
    await page.keyboard.press('PageDown');
    assert.equal(await monthSelect.inputValue(), '7');
    assert.equal(await calendar.locator('[data-dt-day]:focus').count(), 1, 'grid paging still moves day focus');
    await page.keyboard.press('Escape');
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.click('[data-dt-field="todo-due"] [data-dt-trigger]');
  await page.click('.dt-popover [data-dt-today]');
  await page.waitForSelector('.dt-popover', { state: 'detached' });

  await page.click('#checklist-todo-form button[type="submit"]');
  await page.waitForSelector('.toast:has-text("To-Do erstellt")');

  const row = page.locator('[data-checklist-task]', { hasText: 'Mehrfachsteckdosen mitbringen' });
  await row.waitFor();
  assert.equal(await row.locator('.checklist-table-due').innerText(), 'Fällig heute');
  assert.equal((await row.locator('.checklist-table-who').innerText()).trim(), 'offen');
  // The creator may take it over too; managing it lives in the details.
  assert.equal(await row.locator('[data-claim-task]').count(), 1);
  await row.locator('[data-task-detail]').click();
  await page.waitForSelector('.modal [data-detail-delete]');
  assert.equal(await page.locator('.modal [data-detail-edit]').count(), 1);
  await page.keyboard.press('Escape');
  await page.waitForSelector('.modal', { state: 'detached' });

  await switchAccount(bob);
  await openChecklist();
  await page.waitForSelector('#checklist-new-todo-btn:not([disabled])');

  await row.locator('[data-claim-task]').click();
  await page.waitForSelector('#checklist-claim-form');
  await page.fill('#claim-comment', 'Bringe zwei mit');
  await page.click('#checklist-claim-form button[type="submit"]');
  await page.waitForSelector('.toast:has-text("Übernommen")');

  // Bob's row now offers "Abgeben" and names him first.
  await row.locator('[data-release-task]').waitFor();
  assert.match(await row.locator('.checklist-table-who').innerText(), /^E2E Checklist Bob/);

  // Personal work is a cross-event Home concern, not something hidden in
  // Orga. The default E2E event is a LAN, so this also guards the LAN path.
  await page.click('.nav-btn[data-view="home"]');
  await page.waitForSelector('[data-home-assigned-todos]');
  const homeTask = page.locator('[data-home-assigned-task]', { hasText: 'Mehrfachsteckdosen mitbringen' });
  await homeTask.waitFor();
  assert.match(await homeTask.innerText(), /Fällig heute/);
  await homeTask.click();
  await page.waitForSelector('.view-title:has-text("Orga")');
  await page.waitForSelector('[data-section-tab="checklist"][aria-current="page"]');

  await row.locator('[data-task-detail]').click();
  await page.waitForSelector('.modal:has-text("Bringe zwei mit")');
  await page.click('.modal [data-detail-done]');
  await page.waitForSelector('.toast:has-text("erledigt")');

  // Done stays in the list, struck through, until someone archives it.
  await page.waitForSelector('[data-checklist-task].is-done:has-text("Mehrfachsteckdosen mitbringen")');
  await row.locator('[data-task-detail]').click();
  await page.click('.modal [data-detail-archive]');
  await page.waitForSelector('.toast:has-text("Archiviert")');
  await page.locator('details[data-checklist-history] summary').click();
  const historyRow = page.locator('details[data-checklist-history] [data-checklist-task]', { hasText: 'Mehrfachsteckdosen mitbringen' });
  await historyRow.waitFor();
});

test('several members take over the same To-Do and each gives it back on their own', async () => {
  await switchAccount(bob);
  await openChecklist();
  await page.waitForSelector('#checklist-new-todo-btn:not([disabled])');

  await page.click('#checklist-new-todo-btn');
  await page.waitForSelector('#todo-title');
  await page.fill('#todo-title', 'Namensschilder drucken');
  await page.click('#checklist-todo-form button[type="submit"]');
  await page.waitForSelector('.toast:has-text("To-Do erstellt")');

  const row = page.locator('[data-checklist-task]', { hasText: 'Namensschilder drucken' });
  await row.locator('[data-claim-task]').click();
  await page.click('#checklist-claim-form button[type="submit"]');
  await row.locator('[data-release-task]').waitFor();

  await switchAccount(alice);
  await openChecklist();
  await row.locator('[data-claim-task]').click();
  await page.click('#checklist-claim-form button[type="submit"]');
  await row.locator('[data-release-task]').waitFor();
  // Alice's own name comes first, the other taker follows.
  assert.equal(await row.locator('.checklist-table-who').innerText(), 'E2E Checklist Alice, E2E Checklist Bob');

  await row.locator('[data-release-task]').click();
  await page.waitForSelector('.toast:has-text("Abgegeben")');
  await row.locator('[data-claim-task]').waitFor();
  assert.equal(await row.locator('.checklist-table-who').innerText(), 'E2E Checklist Bob');
});

test('the Packliste draft and its focus survive a realtime re-render of the area', async () => {
  // Regression for the area shell: it used to replace the whole #view-container
  // (heading, tab row and content slot) before handing control to the sub-view,
  // so renderChecklist read its "what was typed last" snapshot from an already
  // emptied node and silently dropped a half-written entry on every background
  // refresh.
  await switchAccount(alice);
  await openChecklist();
  await page.click('[data-section-tab="checklistPacking"]');
  const draft = page.locator('[data-add-item-form] [data-item-label]');
  await draft.waitFor();
  await draft.click();
  await draft.fill('Ersatzmaus');

  // Alice adds an item from another device: the server broadcasts
  // checklist:changed for her items, this tab re-renders, and the new entry
  // in the list is the visible proof that the re-render actually landed.
  // Kept out of page.request: authenticated responses renew their cookie in
  // the shared BrowserContext.
  const added = await fetch(`${BASE_URL}/api/checklist/items`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: alice.cookie },
    body: JSON.stringify({ playerId: alice.id, label: 'Ladekabel vom Zweitgerät' }),
  });
  assert.equal(added.status, 201, await added.text());
  await page.waitForSelector('.checklist-item-list:has-text("Ladekabel vom Zweitgerät")');

  // The typed value and the caret stay where they were.
  assert.equal(await draft.inputValue(), 'Ersatzmaus');
  assert.equal(
    await page.evaluate(() => document.activeElement?.matches('[data-add-item-form] [data-item-label]')),
    true,
    'focus must stay in the add-item field across a background re-render',
  );

  // Submitting still works afterwards, so the surviving node is the live one.
  await page.click('[data-add-item-form] button[type="submit"]');
  await page.waitForSelector('.checklist-item-list:has-text("Ersatzmaus")');

  // After a successful add the field clears itself (and keeps focus) so the
  // next entry can be typed straight away - the draft-preservation snapshot
  // must not restore the just-added label.
  assert.equal(await draft.inputValue(), '');
  assert.equal(
    await page.evaluate(() => document.activeElement?.matches('[data-add-item-form] [data-item-label]')),
    true,
    'focus must stay in the add-item field after adding',
  );
});

test('an already-open Home re-renders when a free To-Do appears and disappears elsewhere', async () => {
  // Regression for the visibility contract in renderAssignedTodos() (home.js):
  // the tile's presence, not just its content, now depends on checklist
  // data, so a Home view left open has to react to checklist:changed the
  // same way it already does for foodOrders:changed - not only on the next
  // navigation.

  // Earlier tests in this shared owner process leave To-Dos behind; clear
  // anything Alice has taken over, and anything still sitting open in the
  // shared pool, so the tile's visibility gate (mine AND free) starts from a
  // genuinely empty state instead of assuming a fixed prior history for
  // either half of it.
  const existing = await fetch(`${BASE_URL}/api/checklist/tasks`, { headers: { cookie: alice.cookie } });
  const existingBody = (await existing.json()) as {
    tasks: Array<{ id: string; status: string; assignees: Array<{ id: string }>; createdBy: { id: string } | null }>;
  };
  assert.equal(existing.status, 200, JSON.stringify(existingBody));
  const { tasks: existingTasks } = existingBody;
  for (const task of existingTasks) {
    if (task.status === 'taken' && task.assignees.some((person) => person.id === alice.id)) {
      const done = await fetch(`${BASE_URL}/api/checklist/tasks/${task.id}/done`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json', cookie: alice.cookie },
        body: JSON.stringify({ playerId: alice.id }),
      });
      assert.equal(done.status, 200, await done.text());
    } else if (task.status === 'open' && task.createdBy?.id === alice.id) {
      const cancelled = await fetch(`${BASE_URL}/api/checklist/tasks/${task.id}`, {
        method: 'DELETE',
        headers: { 'content-type': 'application/json', cookie: alice.cookie },
        body: JSON.stringify({ playerId: alice.id }),
      });
      assert.equal(cancelled.status, 204, await cancelled.text());
    } else if (task.status === 'open') {
      const claimed = await fetch(`${BASE_URL}/api/checklist/tasks/${task.id}/claim`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie: alice.cookie },
        body: JSON.stringify({ playerId: alice.id }),
      });
      assert.equal(claimed.status, 200, await claimed.text());
      const done = await fetch(`${BASE_URL}/api/checklist/tasks/${task.id}/done`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json', cookie: alice.cookie },
        body: JSON.stringify({ playerId: alice.id }),
      });
      assert.equal(done.status, 200, await done.text());
    }
  }

  await switchAccount(alice);
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('respawn:navigate', { detail: 'home' })));
  await page.waitForSelector('#view-container[data-view="home"]');
  await page.waitForSelector('[data-home-assigned-todos]', { state: 'detached' });

  // An open To-Do nobody has claimed yet - the shared pool alone is reason
  // enough for the tile to appear, even though Alice created it herself.
  // Kept out of page.request: an authenticated response renews its cookie in
  // the shared BrowserContext and could otherwise switch Alice's open page
  // to a different identity.
  const created = await fetch(`${BASE_URL}/api/checklist/tasks/todo`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: alice.cookie },
    body: JSON.stringify({ playerId: alice.id, title: 'Grillkohle besorgen' }),
  });
  const createdBody = (await created.json()) as { tasks: Array<{ id: string }> };
  assert.equal(created.status, 201, JSON.stringify(createdBody));
  const { tasks } = createdBody;

  await page.waitForSelector('[data-home-assigned-todos]');
  assert.match(await page.locator('[data-home-assigned-todos]').innerText(), /Ein offenes To-Do/);

  // Bob claims it: it leaves the pool without becoming assigned to Alice, so
  // her still-open Home has nothing left to show and the tile disappears
  // again, still without navigating away.
  const claimed = await fetch(`${BASE_URL}/api/checklist/tasks/${tasks[0].id}/claim`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: bob.cookie },
    body: JSON.stringify({ playerId: bob.id }),
  });
  assert.equal(claimed.status, 200, await claimed.text());

  await page.waitForSelector('[data-home-assigned-todos]', { state: 'detached' });
});
