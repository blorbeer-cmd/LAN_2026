import { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium, type Browser } from 'playwright';
import { addSessionCookie, authenticatedServerEnv, loginE2EAdmin, waitForPlayerData } from './authHelpers';
import { createE2EDiagnosticTest, deferE2EContextClose } from './e2eDiagnostics';
import { startE2EServer, type E2EServer } from './e2eServer';
import { openMoreViewEntry } from './navHelpers';
import { selectArcadeGame } from './arcadeHelpers';
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

test('Arcade creation row visual references at desktop and both mobile layouts', async () => {
  const context = await visualContext(browser);
  await addSessionCookie(context, server.baseUrl, cookie);
  const page = await context.newPage();
  await page.clock.setFixedTime(new Date('2026-09-10T12:00:00.000Z'));
  const scenes = new VisualScenes(page);
  try {
    await page.goto(server.baseUrl);
    await waitForPlayerData(page);
    await openMoreViewEntry(page, '[data-navigate="admin"]');
    await page.click('#admin-mode-activate');
    await page.waitForSelector('#admin-test-players-title');
    await openMoreViewEntry(page, '[data-navigate="arcade"]');
    await selectArcadeGame(page, 'tetris');
    await page.waitForSelector('#tetris-opponent');
    const row = page.locator('.arcade-lobby-create-row');
    for (const width of [1024, 390, 320]) {
      await page.setViewportSize({ width, height: 900 });
      await scenes.capture(`arcade-create-${width}`, row, async () => {
        assert.equal(await page.locator('#tetris-create').isEnabled(), true);
        assert.equal(await row.locator('#tetris-mode [aria-pressed="true"]').innerText(), 'Duell');
        assert.equal(await row.locator('#tetris-opponent [aria-pressed="true"]').innerText(), 'Mensch');
        await assertControlHeights(row.locator('button, .arcade-mode-toggle'));
        const boxes = await row.locator('#tetris-create, #tetris-mode, #tetris-opponent').evaluateAll((elements) => Object.fromEntries(elements.map((element) => {
          const box = element.getBoundingClientRect();
          return [element.id, { top: box.top, bottom: box.bottom, center: box.top + box.height / 2, width: box.width }];
        })));
        const create = boxes['tetris-create'], mode = boxes['tetris-mode'], opponent = boxes['tetris-opponent'];
        if (width === 1024) {
          assert.ok(Math.abs(create.center - mode.center) <= 1 && Math.abs(mode.center - opponent.center) <= 1);
        } else {
          assert.ok(mode.top >= create.bottom);
          if (width === 390) assert.ok(Math.abs(mode.center - opponent.center) <= 1);
          else {
            assert.ok(opponent.top >= mode.bottom);
            assert.ok(Math.abs(create.width - mode.width) <= 1 && Math.abs(mode.width - opponent.width) <= 1);
          }
        }
        for (const segment of await row.locator('.arcade-mode-toggle-btn').all()) await assertNoOverflow(segment);
        await assertNoOverflow(row);
        await assertNoOverflow(page.locator('html'));
      });
    }
    scenes.finish();
  } finally { await deferE2EContextClose(context); }
});
