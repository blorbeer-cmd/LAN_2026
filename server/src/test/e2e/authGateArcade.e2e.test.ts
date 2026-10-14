import { before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { ChildProcess } from 'child_process';
import { chromium, Browser, BrowserContext, Page } from 'playwright';
import { addSessionCookie, authenticatedServerEnv, createE2EAccount, loginE2EAdmin } from './authHelpers';
import { createE2EDiagnosticTest, trackE2EContext } from './e2eDiagnostics';
import { startE2EServer, type E2EServer } from './e2eServer';
import { ARCADE_HUB, openArcadeLobby } from './arcadeHelpers';
import { activateAdminMode, openMoreViewEntry } from './navHelpers';

let BASE_URL: string;

let serverProcess: ChildProcess;
let e2eServer: E2EServer;
let browser: Browser;
let context: BrowserContext;
let page: Page;
let adminCookie: string;

const test = createE2EDiagnosticTest(() => ({ browser, server: e2eServer }));

type LayoutBox = {
  left: number;
  right: number;
  top: number;
  bottom: number;
  width: number;
  height: number;
};

type DialogLayout = {
  form: LayoutBox;
  mode: LayoutBox | null;
  opponent: LayoutBox | null;
  submit: LayoutBox;
  segments: Array<LayoutBox & { group: string; label: string; clientWidth: number; scrollWidth: number }>;
  documentClientWidth: number;
  documentScrollWidth: number;
  modeStyle: { borderTopWidth: string; boxShadow: string; overflow: string; paddingTop: string } | null;
};

// Geometry of the "Lobby öffnen" dialog: game select, the mode and opponent
// switches sharing one row, and the compact submit at the right end.
async function readDialogLayout(targetPage: Page): Promise<DialogLayout> {
  return targetPage.evaluate(() => {
    const rect = (element: Element | null) => {
      if (!element) return null;
      const box = element.getBoundingClientRect();
      return { left: box.left, right: box.right, top: box.top, bottom: box.bottom, width: box.width, height: box.height };
    };
    const form = document.querySelector('#arcade-create-form')!;
    const mode = document.querySelector('#arcade-create-mode');
    const modeComputed = mode ? getComputedStyle(mode) : null;
    return {
      form: rect(form)!,
      mode: rect(mode),
      opponent: rect(document.querySelector('#arcade-create-opponent')),
      submit: rect(form.querySelector('button[type="submit"]'))!,
      segments: Array.from(form.querySelectorAll('.arcade-mode-toggle-btn')).map((element) => ({
        ...rect(element)!,
        group: element.parentElement?.id ?? '',
        label: element.textContent?.trim() || '',
        clientWidth: (element as HTMLElement).clientWidth,
        scrollWidth: (element as HTMLElement).scrollWidth,
      })),
      documentClientWidth: document.documentElement.clientWidth,
      documentScrollWidth: document.documentElement.scrollWidth,
      modeStyle: modeComputed
        ? {
            borderTopWidth: modeComputed.borderTopWidth,
            boxShadow: modeComputed.boxShadow,
            overflow: modeComputed.overflow,
            paddingTop: modeComputed.paddingTop,
          }
        : null,
    };
  });
}

function assertControlHeight(box: LayoutBox, message: string): void {
  assert.ok(box.height >= 31 && box.height <= 33, `${message}: expected 31–33px, got ${box.height}px`);
}

function assertAligned(boxes: LayoutBox[], message: string): void {
  for (let leftIndex = 0; leftIndex < boxes.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < boxes.length; rightIndex += 1) {
      const leftCenter = boxes[leftIndex].top + boxes[leftIndex].height / 2;
      const rightCenter = boxes[rightIndex].top + boxes[rightIndex].height / 2;
      assert.ok(Math.abs(leftCenter - rightCenter) <= 1, message);
    }
  }
}

function toLayoutBox(box: { x: number; y: number; width: number; height: number }): LayoutBox {
  return { left: box.x, right: box.x + box.width, top: box.y, bottom: box.y + box.height, width: box.width, height: box.height };
}

async function openCreateDialog(targetPage: Page): Promise<void> {
  await targetPage.waitForSelector(`${ARCADE_HUB}:not([disabled])`);
  await targetPage.click(ARCADE_HUB);
  await targetPage.waitForSelector('#arcade-create-form');
  await settleDialog(targetPage);
}

// The dialog scales in, and a viewport change between the phone sheet and the
// centered dialog restarts that entrance. Geometry is only meaningful once
// every running animation has finished.
async function settleDialog(targetPage: Page): Promise<void> {
  await targetPage.locator('.modal').evaluate((modal) => Promise.all(modal.getAnimations({ subtree: true }).map((animation) => animation.finished)));
}

async function closeCreateDialog(targetPage: Page): Promise<void> {
  await targetPage.keyboard.press('Escape');
  await targetPage.waitForSelector('#arcade-create-form', { state: 'detached' });
}

async function dialogGames(targetPage: Page): Promise<string[]> {
  return targetPage.locator('#arcade-create-game option').evaluateAll((options) => options.map((option) => (option as HTMLOptionElement).value));
}

before(async () => {
  const server = await startE2EServer(authenticatedServerEnv());
  e2eServer = server;
  serverProcess = server.process;
  BASE_URL = server.baseUrl;
  adminCookie = await loginE2EAdmin(BASE_URL);
  const member = await createE2EAccount(BASE_URL, adminCookie, 'E2E Arcade Auth Member');

  browser = await chromium.launch();
  context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await addSessionCookie(context, BASE_URL, member.cookie);
  page = await context.newPage();
  await page.goto(BASE_URL);
  await page.waitForSelector('#app:not([hidden])');
  await page.waitForSelector('.nav-btn[data-view="more"]');
});

after(async () => {
  await context?.close();
  await browser?.close();
  serverProcess?.kill();
});

test('a required-mode member can open an Arcade lobby with a scoped game socket', async () => {
  await page.click('.nav-btn[data-view="more"]');
  assert.equal(await page.locator('[data-navigate="admin"]').count(), 0);
  await page.click('[data-navigate="arcade"]');
  await page.waitForSelector(ARCADE_HUB);
  await openCreateDialog(page);
  // Members neither choose the AI nor see the parked games; the Chimp Test is a
  // regular game.
  assert.deepEqual(await dialogGames(page), ['battleship', 'blobby', 'chimp', 'quiz', 'pong', 'snake', 'tetris']);
  await page.selectOption('#arcade-create-game', 'tetris');
  await page.waitForSelector('#arcade-create-mode');
  assert.equal(await page.locator('#arcade-create-opponent').count(), 0);
  await closeCreateDialog(page);
  await openArcadeLobby(page, 'tetris', { mode: 'duel' });
  await page.waitForSelector('[data-tetris-close]');
  assert.equal(await page.locator('.toast-error:has-text("Community- oder Eventzugriff verweigert")').count(), 0);
  await page.click('[data-tetris-close]');
  await page.waitForSelector('text=Keine offene Lobby.');
});

test('an admin sees AI and test settings only after activation', async () => {
  const adminContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await trackE2EContext(adminContext, 'arcade-auth-admin');
  await addSessionCookie(adminContext, BASE_URL, adminCookie);
  const adminPage = await adminContext.newPage();
  try {
    await adminPage.goto(BASE_URL);
    await adminPage.waitForSelector('#app:not([hidden])');
    await openMoreViewEntry(adminPage, '[data-navigate="admin"]');
    await adminPage.waitForSelector('#admin-register-link', { state: 'attached' });
    assert.equal(await adminPage.locator('#admin-test-players-title').count(), 0);
    assert.equal(await adminPage.locator('#admin-indicator').isHidden(), true);

    // Without Admin mode an admin gets the member dialog.
    await openMoreViewEntry(adminPage, '[data-navigate="arcade"]');
    await openCreateDialog(adminPage);
    assert.deepEqual(await dialogGames(adminPage), ['battleship', 'blobby', 'chimp', 'quiz', 'pong', 'snake', 'tetris']);
    await adminPage.selectOption('#arcade-create-game', 'tetris');
    await adminPage.waitForSelector('#arcade-create-mode');
    assert.equal(await adminPage.locator('#arcade-create-opponent').count(), 0);
    await closeCreateDialog(adminPage);

    await activateAdminMode(adminPage);
    await openMoreViewEntry(adminPage, '[data-navigate="admin"]');
    await adminPage.waitForSelector('#admin-test-players-title');
    await openMoreViewEntry(adminPage, '[data-navigate="arcade"]');
    await openCreateDialog(adminPage);
    assert.deepEqual(
      await dialogGames(adminPage),
      ['battleship', 'blobby', 'challenge-rush', 'chimp', 'quiz', 'pong', 'scribble', 'snake', 'tetris'],
      'Admin mode adds the parked games in alphabetical order',
    );

    const modeGames = [
      { game: 'tetris', labels: ['Duell', 'Arena'] },
      { game: 'pong', labels: ['Duell', 'Doppel'] },
      { game: 'snake', labels: ['Classic', 'Arena'] },
      { game: 'blobby', labels: ['Duell', 'Doppel'] },
    ];
    for (const width of [320, 390, 1024, 1440]) {
      await adminPage.setViewportSize({ width, height: 900 });
      for (const { game, labels } of modeGames) {
        await adminPage.selectOption('#arcade-create-game', game);
        await adminPage.waitForSelector('#arcade-create-opponent');
        await settleDialog(adminPage);
        const layout = await readDialogLayout(adminPage);
        assert.ok(layout.mode);
        assert.ok(layout.opponent);
        assertControlHeight(layout.mode, `${game} mode pill at ${width}px`);
        assertControlHeight(layout.opponent, `${game} opponent pill at ${width}px`);
        assertControlHeight(layout.submit, `${game} submit at ${width}px`);
        // Mode and opponent share one row; every segment of both switches has
        // the same width and keeps its label uncut.
        if (width >= 390) assertAligned([layout.mode, layout.opponent], `${game} mode and opponent share a row at ${width}px`);
        else assert.ok(layout.mode.bottom <= layout.opponent.top, `${game} opponent wraps below the mode at ${width}px`);
        assert.deepEqual(layout.segments.map((segment) => segment.label), [...labels, 'Mensch', 'KI']);
        const widths = layout.segments.map((segment) => Math.round(segment.width));
        assert.ok(Math.max(...widths) - Math.min(...widths) <= 1, `${game} segments share one width at ${width}px: ${widths.join(', ')}`);
        for (const segment of layout.segments) {
          assertControlHeight(segment, `${game} ${segment.label} segment at ${width}px`);
          assert.ok(segment.scrollWidth <= segment.clientWidth, `${game} ${segment.label} stays uncut at ${width}px`);
        }
        assert.ok(Math.abs(layout.form.right - layout.submit.right) <= 1, `${game} submit sits at the right end at ${width}px`);
        assert.equal(layout.documentScrollWidth, layout.documentClientWidth, `${width}px has no page overflow`);
        assert.equal(await adminPage.locator('#arcade-create-mode [aria-pressed="true"]').count(), 1);
        assert.equal(await adminPage.locator('#arcade-create-opponent [aria-pressed="true"]').count(), 1);
        assert.equal(layout.modeStyle?.borderTopWidth, '0px', 'the pill outline is not a layout border');
        assert.notEqual(layout.modeStyle?.boxShadow, 'none', 'the pill keeps its inset outline');
        assert.equal(layout.modeStyle?.overflow, 'visible', 'the pill does not clip focus');
        assert.equal(layout.modeStyle?.paddingTop, '0px', 'the pill has no inner padding');
      }
    }

    // Keyboard order follows the visual order: game, mode, opponent, submit.
    await adminPage.setViewportSize({ width: 390, height: 844 });
    await adminPage.selectOption('#arcade-create-game', 'tetris');
    await adminPage.waitForSelector('#arcade-create-opponent');
    await adminPage.locator('#arcade-create-game').focus();
    const focusOrder: string[] = [];
    for (let index = 0; index < 5; index += 1) {
      await adminPage.keyboard.press('Tab');
      focusOrder.push(await adminPage.evaluate(() => document.activeElement?.textContent?.trim() || ''));
    }
    assert.deepEqual(focusOrder, ['Duell', 'Arena', 'Mensch', 'KI', 'Lobby öffnen']);
    const firstModeSegment = adminPage.locator('#arcade-create-mode .arcade-mode-toggle-btn').first();
    await firstModeSegment.focus();
    assert.notEqual(await firstModeSegment.evaluate((element) => getComputedStyle(element).outlineStyle), 'none');
    const clippingAncestors = await firstModeSegment.evaluate((element) => {
      const clipped: string[] = [];
      for (let current = element.parentElement; current; current = current.parentElement) {
        if (current.id === 'arcade-create-form') break;
        const style = getComputedStyle(current);
        if ([style.overflow, style.overflowX, style.overflowY].some((value) => value !== 'visible')) clipped.push(current.className);
      }
      return clipped;
    });
    assert.deepEqual(clippingAncestors, [], 'no ancestor clips the segment focus ring');
    for (const pillId of ['arcade-create-mode', 'arcade-create-opponent']) {
      const activeCoverage = await adminPage.locator(`#${pillId}`).evaluate((pill) => {
        const pillBox = pill.getBoundingClientRect();
        const activeBox = pill.querySelector('.is-active')!.getBoundingClientRect();
        return {
          pillTop: pillBox.top,
          pillBottom: pillBox.bottom,
          activeTop: activeBox.top,
          activeBottom: activeBox.bottom,
          backgroundColor: getComputedStyle(pill.querySelector('.is-active')!).backgroundColor,
        };
      });
      assert.ok(Math.abs(activeCoverage.pillTop - activeCoverage.activeTop) <= 1);
      assert.ok(Math.abs(activeCoverage.pillBottom - activeCoverage.activeBottom) <= 1);
      assert.notEqual(activeCoverage.backgroundColor, 'rgba(0, 0, 0, 0)');
    }

    // Challenge Rush has neither mode nor opponent; its admin test selection
    // sits in the same dialog.
    await adminPage.selectOption('#arcade-create-game', 'challenge-rush');
    await adminPage.waitForSelector('.challenge-rush-test-selector');
    assert.equal(await adminPage.locator('#arcade-create-mode').count(), 0);
    assert.equal(await adminPage.locator('#arcade-create-opponent').count(), 0);
    await closeCreateDialog(adminPage);

    // A solo Tetris host sees a disabled Start with its reason plus a neutral
    // Schließen, both as compact header actions of the own lobby card.
    await openArcadeLobby(adminPage, 'tetris', { mode: 'duel', opponent: 'human' });
    await adminPage.waitForSelector('#tetris-start');
    assert.equal(await adminPage.locator('#tetris-start').isDisabled(), true);
    assert.ok(await adminPage.locator('#tetris-start').getAttribute('title'), 'the disabled Start names its reason');
    for (const width of [390, 1024]) {
      await adminPage.setViewportSize({ width, height: width === 390 ? 844 : 768 });
      const startBox = toLayoutBox((await adminPage.locator('#tetris-start').boundingBox())!);
      const closeBox = toLayoutBox((await adminPage.locator('[data-tetris-close]').boundingBox())!);
      assertControlHeight(startBox, `Start at ${width}px`);
      assertControlHeight(closeBox, `Schließen at ${width}px`);
      assertAligned([startBox, closeBox], `Start and Schließen share a line at ${width}px`);
    }
    await adminPage.click('[data-tetris-close]');
    await adminPage.waitForSelector('text=Keine offene Lobby.');

    // Leaving Admin mode hides the parked games and the AI choice in place.
    // The switch itself lives in Mein Profil; flipping the device-local mode
    // here proves the open Arcade view reacts in place to the change event.
    await adminPage.evaluate(async () => (await globalThis.eval("import('/js/admin.js')")).setAdmin(false));
    await adminPage.waitForSelector('#admin-indicator', { state: 'hidden' });
    await openCreateDialog(adminPage);
    assert.deepEqual(await dialogGames(adminPage), ['battleship', 'blobby', 'chimp', 'quiz', 'pong', 'snake', 'tetris']);
    await adminPage.selectOption('#arcade-create-game', 'tetris');
    await adminPage.waitForSelector('#arcade-create-mode');
    assert.equal(await adminPage.locator('#arcade-create-opponent').count(), 0);
    await closeCreateDialog(adminPage);
  } finally {
    await adminContext.close();
  }
});
