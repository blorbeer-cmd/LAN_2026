// Browser E2E test for the Checkliste To-Do flow
// (docs/KONZEPT-PACKLISTE-TICKETS.md): any active member creates a To-Do,
// picks its Art and an optional due date, another member claims it and sees
// it under "Mir zugewiesen", then marks it done. Separate from the fast
// unit/integration suite (`npm test`) - run via `npm run test:e2e`.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { ChildProcess } from 'child_process';
import { chromium, Browser, Page } from 'playwright';
import {
  addSessionCookie,
  authenticatedServerEnv,
  createE2EAccount,
  E2EAccount,
  loginE2EAdmin,
} from './authHelpers';
import { startE2EServer } from './e2eServer';

let BASE_URL: string;

let serverProcess: ChildProcess;
let browser: Browser;
let page: Page;
let alice: E2EAccount;
let bob: E2EAccount;

async function openChecklist(): Promise<void> {
  await page.click('.nav-btn[data-view="more"]');
  await page.click('[data-navigate="arrivals"]');
  await page.waitForSelector('.view-title:has-text("Orga")');
  await page.click('[data-section-tab="checklist"]');
}

async function switchAccount(account: E2EAccount): Promise<void> {
  await addSessionCookie(page.context(), BASE_URL, account.cookie);
  await page.reload();
  await page.waitForSelector('#app:not([hidden])');
}

before(async () => {
  const server = await startE2EServer(authenticatedServerEnv());
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

test('create a To-Do as one member, claim and complete it as another, "Mir zugewiesen" reflects the assignee', async () => {
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

  // Toggling "Art" rebuilds the whole form (the assignee grid needs to
  // appear/disappear for "Zuweisen an"), which also tears down and recreates
  // every button in it - focus must land back on the equivalent new button,
  // not fall through to <body>, or keyboard/screen-reader users have to
  // re-tab through the entire modal after every toggle.
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
  assert.equal(await page.locator('.dt-popover [data-dt-hour]').count(), 0, 'due date picker has no time-of-day controls');
  await page.click('.dt-popover [data-dt-today]');
  await page.waitForSelector('.dt-popover', { state: 'detached' });

  await page.click('#checklist-todo-form button[type="submit"]');
  await page.waitForSelector('.toast:has-text("To-Do erstellt")');

  const openCard = page.locator('[data-checklist-task]', { hasText: 'Mehrfachsteckdosen mitbringen' });
  await openCard.waitFor();
  assert.equal(await openCard.locator('.badge-due-soon:has-text("Heute fällig")').count(), 1);
  // Alice created it herself, so she gets "Zurückziehen", never "Übernehmen".
  assert.equal(await openCard.locator('[data-claim-task]').count(), 0);
  assert.equal(await openCard.locator('[data-cancel-task]').count(), 1);

  await switchAccount(bob);
  await openChecklist();
  await page.waitForSelector('#checklist-new-todo-btn:not([disabled])');

  const openCardAsBob = page.locator('[data-checklist-task]', { hasText: 'Mehrfachsteckdosen mitbringen' });
  await openCardAsBob.locator('[data-claim-task]').click();
  await page.waitForSelector('#checklist-claim-form');
  await page.click('#checklist-claim-form button[type="submit"]');
  await page.waitForSelector('.toast:has-text("Übernommen")');

  // Now shows under "Mir zugewiesen" for Bob, with the due badge carried over.
  const mineHeading = page.locator('.section-title:has-text("Mir zugewiesen")');
  await mineHeading.waitFor();
  const mineCard = page.locator('[data-checklist-task]', { hasText: 'Mehrfachsteckdosen mitbringen' });
  await mineCard.waitFor();
  assert.equal(await mineCard.locator('.badge-due-soon:has-text("Heute fällig")').count(), 1);
  assert.equal(await mineCard.locator('[data-done-task]').count(), 1);

  await mineCard.locator('[data-done-task]').click();
  await page.waitForSelector('.toast:has-text("erledigt")');
  // Bob's only assigned To-Do just moved into Historie, so "Mir zugewiesen"
  // falls back to its empty state.
  await page.waitForSelector('.empty-state:has-text("Aktuell liegt nichts bei dir.")');

  await page.locator('details[data-checklist-history] summary').click();
  const historyCard = page.locator('details[data-checklist-history] [data-checklist-task]', { hasText: 'Mehrfachsteckdosen mitbringen' });
  await historyCard.waitFor();
});

test('any member (not just Owner/Admin) can create and directly self-assign a To-Do', async () => {
  await switchAccount(bob);
  await openChecklist();
  await page.waitForSelector('#checklist-new-todo-btn:not([disabled])');

  await page.click('#checklist-new-todo-btn');
  await page.waitForSelector('#todo-title');
  await page.fill('#todo-title', 'Namensschilder drucken');
  await page.click('[data-todo-assign-mode="self"]');
  await page.click('#checklist-todo-form button[type="submit"]');
  await page.waitForSelector('.toast:has-text("To-Do erstellt")');

  // Assigned straight to self skips the open pool - it shows up under "Mir
  // zugewiesen" immediately, no separate claim step.
  const mineCard = page.locator('[data-checklist-task]', { hasText: 'Namensschilder drucken' });
  await mineCard.waitFor();
  assert.equal(await mineCard.locator('[data-release-task]').count(), 1);
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

  // Bob assigns a To-Do to Alice: the server broadcasts checklist:changed, this
  // tab re-renders, and the count on the neighbouring To-Dos tab is the visible
  // proof that the re-render actually landed.
  const created = await page.request.post(`${BASE_URL}/api/checklist/tasks/todo`, {
    headers: { cookie: bob.cookie },
    data: { playerId: bob.id, title: 'Beamer mitbringen', assigneePlayerIds: [alice.id] },
  });
  assert.equal(created.status(), 201, await created.text());
  await page.waitForSelector('[data-section-tab="checklist"] [data-section-tab-count]:text("(1)")');

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
});

test('the To-Dos tab count is present on every Orga tab, not only on the To-Dos list', async () => {
  // Regression: openTaskCount() reads a cache that only the To-Dos list filled,
  // so entering Orga through another tab left the badge permanently blank.
  await switchAccount(bob);
  // Bob still owns the self-assigned "Namensschilder drucken" To-Do, and the
  // area is entered through a tab that never touches that list.
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('respawn:navigate', { detail: 'arrivals' })));
  await page.waitForSelector('#view-container[data-view="arrivals"]');
  await page.waitForSelector('[data-section-tab="checklist"] [data-section-tab-count]:text("(1)")');
  assert.equal(await page.locator('[data-section-tab="checklist"][aria-current="page"]').count(), 0);
});
