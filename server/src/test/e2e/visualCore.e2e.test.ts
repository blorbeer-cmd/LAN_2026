import { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium, type Browser } from 'playwright';
import { addSessionCookie, authenticatedServerEnv, createE2EAccount, loginE2EAdmin, waitForPlayerData } from './authHelpers';
import { createE2EDiagnosticTest, deferE2EContextClose } from './e2eDiagnostics';
import { startE2EServer, type E2EServer } from './e2eServer';
import { openMoreViewEntry } from './navHelpers';
import { VisualScenes, visualContext, assertControlHeights, assertNoOverflow } from './visualHelpers';

let browser: Browser;
let server: E2EServer;
let cookie: string;
const test = createE2EDiagnosticTest(() => ({ browser, server }));

before(async () => {
  server = await startE2EServer(authenticatedServerEnv());
  cookie = await loginE2EAdmin(server.baseUrl);
  await createE2EAccount(server.baseUrl, cookie, 'Alex Referenz');
  browser = await chromium.launch();
});
after(async () => { await browser?.close(); server?.process.kill(); });

for (const width of [390, 1024]) {
  test(`Core visual references at ${width}px`, async () => {
    const context = await visualContext(browser);
    const page = await context.newPage();
    await page.clock.setFixedTime(new Date('2026-09-10T12:00:00.000Z'));
    const scenes = new VisualScenes(page);
    try {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(server.baseUrl);
      await addSessionCookie(context, server.baseUrl, cookie);
      await page.reload();
      await waitForPlayerData(page);
      await page.click('.nav-btn[data-view="matchmaking"]');
      const roster = page.locator('[data-roster-picker="mm-draw-roster"]');
      await roster.waitFor();
      // A deliberate UI selection is stable regardless of live-status defaults.
      if ((await page.getAttribute('#mm-select-all', 'aria-label')) === 'Sichtbare Spieler markieren') {
        await page.click('#mm-select-all');
      }
      await scenes.capture(`core-roster-${width}`, roster, async () => {
        assert.equal(await roster.locator('input[type="checkbox"]:checked').count(), 2);
        assert.equal(await roster.getByText('Alex Referenz', { exact: true }).count(), 1);
        assert.equal(await roster.locator('#mm-select-all svg.ui-icon').count(), 1);
        await assertControlHeights(roster.locator('#mm-select-all, #mm-player-search, #mm-teamcount'));
        const layout = await roster.evaluate((element) => {
          const toolbar = element.querySelector('.selection-toolbar')!.getBoundingClientRect();
          const grid = element.querySelector('.player-selection-grid')!;
          return { gap: grid.getBoundingClientRect().top - toolbar.bottom,
            columns: getComputedStyle(grid).gridTemplateColumns.split(' ').length };
        });
        assert.ok(Math.abs(layout.gap - 12) <= 1);
        assert.equal(layout.columns, width < 640 ? 1 : 2);
        await assertNoOverflow(roster);
      });
      const tabs = page.locator('.section-tabs');
      await scenes.capture(`core-tabs-${width}`, tabs, async () => {
        assert.equal(await tabs.locator('[aria-current="page"]').getAttribute('data-section-tab'), 'matchmaking');
        await assertControlHeights(tabs.locator('button'));
        await assertNoOverflow(tabs);
      });
      const footer = page.locator('[aria-labelledby="matchmaking-draw-title"] .card-footer-actions');
      await scenes.capture(`core-footer-${width}`, footer, async () => {
        assert.equal(await page.locator('#mm-generate').isEnabled(), true);
        assert.equal((await page.locator('#mm-generate').innerText()).trim(), 'Teams auslosen');
        assert.equal(await footer.evaluate((element) => getComputedStyle(element).borderTopWidth), '1px');
        await assertControlHeights(footer.locator('button'));
        await assertNoOverflow(footer);
      });

      await page.click('.nav-btn[data-view="gameCatalog"]');
      await page.waitForSelector('#game-catalog-search');
      await page.click('.game-catalog-filter-trigger');
      await page.click('[data-rating-filter="bock"]');
      const filters = page.locator('[aria-label="Spiele durchsuchen, sortieren und filtern"]');
      await scenes.capture(`core-filters-${width}`, filters, async () => {
        assert.equal(await page.locator('[data-rating-filter="bock"]').getAttribute('aria-pressed'), 'true');
        assert.equal(await page.locator('[data-rating-filter="skill"]').getAttribute('aria-pressed'), 'false');
        // Action-menu entries (the closed sort panel's options, the filter
        // panel's reset button) follow the separate 44px tap-target contract,
        // not the 32px standard-control one checked here.
        await assertControlHeights(filters.locator('#game-catalog-search, .game-catalog-sort-trigger, .game-catalog-filter-trigger, [data-rating-filter]'));
        await assertNoOverflow(filters);
      });
      await page.click('#suggest-new');
      const modal = page.getByRole('dialog', { name: 'Spiel vorschlagen', exact: true });
      await modal.waitFor();
      await page.locator('#suggest-title').click();
      await scenes.capture(`core-modal-${width}`, modal, async () => {
        assert.equal(await modal.locator('h2').innerText(), 'Spiel vorschlagen');
        assert.equal(await page.locator('#suggest-title').evaluate((element) => document.activeElement === element), true);
        await assertControlHeights(modal.locator('input:not([type="checkbox"]), textarea, button'));
        const box = await modal.boundingBox();
        assert.ok(box && box.width <= Math.min(width, 480) + 1);
        await assertNoOverflow(modal);
      });
      // Keep the form in the flows domain: gameCatalog.js selects this Core suite.
      const form = modal.locator('#suggest-form');
      await page.fill('#suggest-title', 'Referenzspiel');
      await scenes.capture(`core-form-${width}`, form, async () => {
        assert.equal(await form.locator('#suggest-title').inputValue(), 'Referenzspiel');
        assert.equal(await form.locator('#suggest-title').getAttribute('required'), '');
        assert.equal(await form.locator('#suggest-platform-url').getAttribute('type'), 'url');
        assert.equal(await form.locator('#suggest-trailer').getAttribute('type'), 'url');
        assert.equal(await form.locator('[data-genre-toggle]').count(), 12);
        assert.equal(await form.locator('#suggest-info').getAttribute('maxlength'), '300');
        assert.equal(await form.locator('#suggest-consider-seat-neighbors').getAttribute('type'), 'checkbox');
        assert.equal(await form.locator('button[type="submit"]').innerText(), 'Vorschlagen');
        await assertControlHeights(form.locator('input:not([type="checkbox"]), textarea, button'));
        await assertNoOverflow(form);
      });
      await page.fill('#suggest-title', '');
      await page.keyboard.press('Escape');
      await modal.waitFor({ state: 'hidden' });
      await openMoreViewEntry(page, '[data-navigate="admin"]');
      const row = page.locator('.data-row-action').filter({ hasText: 'Alex Referenz' });
      await row.waitFor();
      await scenes.capture(`core-admin-row-${width}`, row, async () => {
        assert.equal(await row.locator('strong').innerText(), 'Alex Referenz');
        assert.equal(await row.locator('.badge').innerText(), 'Aktiv');
        assert.equal((await row.locator('button').innerText()).trim(), 'Reset-Link');
        await assertControlHeights(row.locator('button'));
        const layout = await row.evaluate((element) => {
          const label = element.querySelector('span')!.getBoundingClientRect();
          const button = element.querySelector('button')!.getBoundingClientRect();
          const style = getComputedStyle(element);
          return { inner: element.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight),
            labelTop: label.top, labelBottom: label.bottom, buttonTop: button.top,
            centers: Math.abs(label.top + label.height / 2 - button.top - button.height / 2) };
        });
        if (layout.inner >= 320) assert.ok(layout.centers <= 1);
        else assert.ok(layout.buttonTop >= layout.labelBottom);
        await assertNoOverflow(row);
      });
      scenes.finish();
    } finally { await deferE2EContextClose(context); }
  });
}
