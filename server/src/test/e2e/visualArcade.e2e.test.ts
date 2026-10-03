import { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium, type Browser } from 'playwright';
import { addSessionCookie, authenticatedServerEnv, loginE2EAdmin, waitForPlayerData } from './authHelpers';
import { createE2EDiagnosticTest, deferE2EContextClose } from './e2eDiagnostics';
import { startE2EServer, type E2EServer } from './e2eServer';
import { activateAdminMode, openMoreViewEntry } from './navHelpers';
import { ARCADE_HUB } from './arcadeHelpers';
import { VisualScenes, visualContext, assertControlHeights, assertNoOverflow } from './visualHelpers';

let browser: Browser;
let server: E2EServer;
let cookie: string;
const test = createE2EDiagnosticTest(() => ({ browser, server }));
before(async () => {
  server = await startE2EServer(authenticatedServerEnv());
  cookie = await loginE2EAdmin(server.baseUrl);
  browser = await chromium.launch();
});
after(async () => { await browser?.close(); server?.process.kill(); });

test('Arcade create dialog visual references at desktop and both mobile layouts', async () => {
  const context = await visualContext(browser);
  await addSessionCookie(context, server.baseUrl, cookie);
  const page = await context.newPage();
  await page.clock.setFixedTime(new Date('2026-09-10T12:00:00.000Z'));
  const scenes = new VisualScenes(page);
  try {
    await page.goto(server.baseUrl);
    await waitForPlayerData(page);
    await activateAdminMode(page);
    await openMoreViewEntry(page, '[data-navigate="arcade"]');
    await page.waitForSelector(`${ARCADE_HUB}:not([disabled])`);
    await page.click(ARCADE_HUB);
    await page.waitForSelector('#arcade-create-form');
    await page.selectOption('#arcade-create-game', 'tetris');
    await page.waitForSelector('#arcade-create-opponent');
    const form = page.locator('#arcade-create-form');
    for (const width of [1024, 390, 320]) {
      await page.setViewportSize({ width, height: 900 });
      // A switch between the phone sheet and the centered dialog restarts the
      // entrance animation; capture the settled dialog only.
      await page.locator('.modal').evaluate((modal) => Promise.all(modal.getAnimations({ subtree: true }).map((animation) => animation.finished)));
      await scenes.capture(`arcade-create-${width}`, form, async () => {
        assert.equal(await form.locator('button[type="submit"]').isEnabled(), true);
        assert.equal(await form.locator('#arcade-create-mode [aria-pressed="true"]').innerText(), 'Duell');
        assert.equal(await form.locator('#arcade-create-opponent [aria-pressed="true"]').innerText(), 'Mensch');
        await assertControlHeights(form.locator('button, .arcade-mode-toggle'));
        const boxes = await form.locator('#arcade-create-mode, #arcade-create-opponent, button[type="submit"]').evaluateAll((elements) => elements.map((element) => {
          const box = element.getBoundingClientRect();
          return { top: box.top, bottom: box.bottom, center: box.top + box.height / 2, right: box.right };
        }));
        const [mode, opponent, submit] = boxes;
        const formRight = await form.evaluate((element) => element.getBoundingClientRect().right);
        // Mode and opponent share one row from 390px; the submit closes the
        // dialog at its right end below them.
        if (width >= 390) assert.ok(Math.abs(mode.center - opponent.center) <= 1);
        else assert.ok(opponent.top >= mode.bottom);
        assert.ok(submit.top >= Math.max(mode.bottom, opponent.bottom));
        assert.ok(Math.abs(submit.right - formRight) <= 1);
        for (const segment of await form.locator('.arcade-mode-toggle-btn').all()) await assertNoOverflow(segment);
        await assertNoOverflow(form);
        await assertNoOverflow(page.locator('html'));
      });
    }
    scenes.finish();
  } finally { await deferE2EContextClose(context); }
});
