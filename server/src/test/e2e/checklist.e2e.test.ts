// Browser E2E test for the Checkliste To-Do flow
// (docs/KONZEPT-PACKLISTE-TICKETS.md): any active member creates a To-Do,
// picks its Art and an optional due date, another member claims it and sees
// it under "Mir zugewiesen", then marks it done. Separate from the fast
// unit/integration suite (`npm test`) - run via `npm run test:e2e`.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, ChildProcess } from 'child_process';
import path from 'path';
import { chromium, Browser, Page } from 'playwright';

const PORT = 3912; // 3901 flows, 3902 access, 3903 arcade, 3904 authGate, 3910 agent integration, 3911 phase5e isolation
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

async function openChecklist(): Promise<void> {
  await page.click('.nav-btn[data-view="more"]');
  await page.click('[data-navigate="checklist"]');
  await page.waitForSelector('.view-title:has-text("Checkliste")');
}

async function switchIdentity(label: string): Promise<void> {
  await page.click('#profile-btn');
  await page.waitForSelector('#profile-not-me');
  await page.click('#profile-not-me');
  await page.selectOption('#profile-whoami', { label });
  await page.waitForSelector('#profile-not-me');
}

before(async () => {
  serverProcess = spawn('node', [path.join(__dirname, '..', '..', '..', 'dist', 'index.js')], {
    env: { ...process.env, PORT: String(PORT), DB_FILE: ':memory:', ACCESS_TOKEN: '' },
    stdio: 'ignore',
  });
  await waitForServer(`${BASE_URL}/api/health`);
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
  const alice = await page.request.post(`${BASE_URL}/api/players`, { data: { name: 'E2E Checklist Alice' } });
  assert.equal(alice.status(), 201);
  const bob = await page.request.post(`${BASE_URL}/api/players`, { data: { name: 'E2E Checklist Bob' } });
  assert.equal(bob.status(), 201);

  await page.goto(BASE_URL);
  await page.waitForSelector('#app:not([hidden])');
  await openChecklist();

  // No local identity yet - the view's own "Wer bist du?" picker appears
  // (whoAmICardHtml), separate from the global profile switcher.
  await page.selectOption('#checklist-whoami', { label: 'E2E Checklist Alice' });
  await page.waitForSelector('#checklist-new-todo-btn:not([disabled])');

  // Defaults to the To-Dos tab (not Meine Packliste).
  assert.equal(await page.locator('[data-checklist-tab="todos"]').getAttribute('aria-pressed'), 'true');

  await page.click('#checklist-new-todo-btn');
  await page.waitForSelector('#todo-title');
  await page.fill('#todo-title', 'Mehrfachsteckdosen mitbringen');
  await page.fill('#todo-description', 'Mindestens zwei Stück.');

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

  await switchIdentity('E2E Checklist Bob');
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
  await page.goto(BASE_URL);
  await page.waitForSelector('#app:not([hidden])');
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
