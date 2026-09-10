import { before, after } from 'node:test';
import assert from 'node:assert/strict';
import type { ChildProcess } from 'child_process';
import { chromium, Browser, BrowserContext, Page } from 'playwright';
import { addSessionCookie, authenticatedServerEnv, createE2EAccount, loginE2EAdmin } from './authHelpers';
import { createE2EDiagnosticTest, trackE2EContext } from './e2eDiagnostics';
import { startE2EServer, type E2EServer } from './e2eServer';
import { selectArcadeGame } from './arcadeHelpers';
import { openMoreViewEntry } from './navHelpers';

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

type CreateLayout = {
  actionsClientWidth: number;
  rowColumns: string;
  row: LayoutBox;
  mode: LayoutBox | null;
  create: LayoutBox;
  opponent: LayoutBox | null;
  tooltip: LayoutBox | null;
  segments: Array<LayoutBox & { label: string; clientWidth: number; scrollWidth: number }>;
  buttonOrder: string[];
  documentClientWidth: number;
  documentScrollWidth: number;
  modeStyle: { borderTopWidth: string; boxShadow: string; overflow: string; paddingTop: string } | null;
};

async function readCreateLayout(
  targetPage: Page,
  { createId, modeId, opponentId }: { createId: string; modeId?: string; opponentId?: string },
): Promise<CreateLayout> {
  return targetPage.evaluate(({ createId: createSelector, modeId: modeSelector, opponentId: opponentSelector }) => {
    const rect = (element: Element | null) => {
      if (!element) return null;
      const box = element.getBoundingClientRect();
      return {
        left: box.left,
        right: box.right,
        top: box.top,
        bottom: box.bottom,
        width: box.width,
        height: box.height,
      };
    };
    const row = document.querySelector('.arcade-lobby-create-row')!;
    const actions = document.querySelector('.arcade-lobby-create-actions')!;
    const mode = modeSelector ? document.querySelector(`#${modeSelector}`) : null;
    const create = document.querySelector(`#${createSelector}`)!;
    const opponent = opponentSelector ? document.querySelector(`#${opponentSelector}`) : null;
    const tooltip = row.querySelector('.info-tooltip-trigger');
    const modeComputed = mode ? getComputedStyle(mode) : null;
    return {
      actionsClientWidth: actions.clientWidth,
      rowColumns: getComputedStyle(row).gridTemplateColumns,
      row: rect(row)!,
      mode: rect(mode),
      create: rect(create)!,
      opponent: rect(opponent),
      tooltip: rect(tooltip),
      segments: Array.from(row.querySelectorAll('.arcade-mode-toggle-btn')).map((element) => ({
        ...rect(element)!,
        label: element.textContent?.trim() || '',
        clientWidth: (element as HTMLElement).clientWidth,
        scrollWidth: (element as HTMLElement).scrollWidth,
      })),
      buttonOrder: Array.from(row.querySelectorAll('button')).map((element) => element.textContent?.trim() || ''),
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
  }, { createId, modeId, opponentId });
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

function assertFullRow(box: LayoutBox, row: LayoutBox, message: string): void {
  assert.ok(Math.abs(box.left - row.left) <= 1, `${message}: left edge differs`);
  assert.ok(Math.abs(box.right - row.right) <= 1, `${message}: right edge differs`);
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
  await page.waitForSelector('.arcade-tiles');
  await selectArcadeGame(page, 'tetris');
  await page.waitForSelector('#tetris-create:not([disabled])');
  assert.equal(await page.locator('#tetris-opponent').count(), 0);
  await page.click('#tetris-create');
  await page.waitForSelector('[data-tetris-close]');
  assert.equal(await page.locator('.toast-error:has-text("Gruppen- oder Eventzugriff verweigert")').count(), 0);
  await page.click('[data-tetris-close]');
  await page.waitForSelector('#tetris-create:not([disabled])');
  await selectArcadeGame(page, 'challenge-rush');
  await page.waitForSelector('#cr-create:not([disabled])');
  assert.equal(await page.locator('#cr-opponent').count(), 0);
  assert.equal(await page.locator('.challenge-rush-test-selector').count(), 0);
});

test('an admin sees test settings only after activation while Challenge Rush remains multiplayer-only', async () => {
  const adminContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await trackE2EContext(adminContext, 'arcade-auth-admin');
  await addSessionCookie(adminContext, BASE_URL, adminCookie);
  const adminPage = await adminContext.newPage();
  try {
    await adminPage.goto(BASE_URL);
    await adminPage.waitForSelector('#app:not([hidden])');
    await openMoreViewEntry(adminPage, '[data-navigate="admin"]');
    await adminPage.waitForSelector('#admin-mode-activate');
    await adminPage.waitForSelector('#admin-tools-title');
    await adminPage.waitForSelector('#admin-register-link');
    assert.equal(await adminPage.locator('#admin-test-players-title').count(), 0);
    assert.equal(await adminPage.locator('#admin-banner').isHidden(), true);

    await openMoreViewEntry(adminPage, '[data-navigate="arcade"]');
    await adminPage.waitForSelector('.arcade-tiles');
    await selectArcadeGame(adminPage, 'tetris');
    await adminPage.waitForSelector('#tetris-create:not([disabled])');
    assert.equal(await adminPage.locator('#tetris-opponent').count(), 0);
    await selectArcadeGame(adminPage, 'challenge-rush');
    await adminPage.waitForSelector('#cr-create:not([disabled])');
    assert.equal(await adminPage.locator('#cr-opponent').count(), 0);
    assert.equal(await adminPage.locator('.challenge-rush-test-selector').count(), 0);

    await openMoreViewEntry(adminPage, '[data-navigate="admin"]');
    await adminPage.click('#admin-mode-activate');
    await adminPage.waitForSelector('#admin-banner:not([hidden])');
    await adminPage.waitForSelector('#admin-test-players-title');
    await openMoreViewEntry(adminPage, '[data-navigate="arcade"]');
    await selectArcadeGame(adminPage, 'tetris');
    await adminPage.waitForSelector('#tetris-opponent');

    const modeGames = [
      { game: 'tetris', labels: ['Duell', 'Arena'] },
      { game: 'pong', labels: ['Duell', 'Doppel'] },
      { game: 'snake', labels: ['Duell', 'Arena'] },
      { game: 'blobby', labels: ['Duell', 'Doppel'] },
    ];
    for (const width of [640, 1024, 1440]) {
      await adminPage.setViewportSize({ width, height: 900 });
      for (const { game, labels } of modeGames) {
        await selectArcadeGame(adminPage, game);
        await adminPage.waitForSelector(`#${game}-opponent`);
        const layout = await readCreateLayout(adminPage, {
          createId: `${game}-create`,
          modeId: `${game}-mode`,
          opponentId: `${game}-opponent`,
        });
        assert.ok(layout.mode);
        assert.ok(layout.opponent);
        for (const [box, name] of [
          [layout.mode, `${game} mode pill`],
          [layout.create, `${game} create action`],
          [layout.opponent, `${game} opponent pill`],
        ] as Array<[LayoutBox, string]>) {
          assertControlHeight(box, `${name} at ${width}px`);
        }
        for (const segment of layout.segments) {
          assertControlHeight(segment, `${game} ${segment.label} segment at ${width}px`);
          assert.ok(segment.scrollWidth <= segment.clientWidth, `${game} ${segment.label} stays uncut at ${width}px`);
        }
        assertAligned([layout.mode, layout.create, layout.opponent], `${game} controls share a center line at ${width}px`);
        assert.deepEqual(
          layout.buttonOrder,
          [...labels, 'Lobby öffnen', 'Mensch', 'KI'],
          `${game} keeps mode, action and opponent DOM order`,
        );
        assert.equal(await adminPage.locator(`#${game}-mode [aria-pressed="true"]`).count(), 1);
        assert.equal(await adminPage.locator(`#${game}-opponent [aria-pressed="true"]`).count(), 1);
        assert.equal(layout.modeStyle?.borderTopWidth, '0px', 'the pill outline is not a layout border');
        assert.notEqual(layout.modeStyle?.boxShadow, 'none', 'the pill keeps its inset outline');
        assert.equal(layout.modeStyle?.overflow, 'visible', 'the pill does not clip focus');
        assert.equal(layout.modeStyle?.paddingTop, '0px', 'the pill has no inner padding');
      }
    }

    await adminPage.setViewportSize({ width: 1440, height: 900 });
    await selectArcadeGame(adminPage, 'tetris');
    const tetrisDesktop = await readCreateLayout(adminPage, {
      createId: 'tetris-create',
      modeId: 'tetris-mode',
      opponentId: 'tetris-opponent',
    });
    const tetrisCreateInset = tetrisDesktop.create.left - tetrisDesktop.row.left;
    const noModeGames = [
      { game: 'quiz', createId: 'quiz-create-lobby' },
      { game: 'scribble', createId: 'scribble-create' },
      { game: 'battleship', createId: 'battleship-create' },
    ];
    for (const { game, createId } of noModeGames) {
      await adminPage.setViewportSize({ width: 1024, height: 768 });
      await selectArcadeGame(adminPage, game);
      await adminPage.waitForSelector(`#${game}-opponent`);
      const laptopLayout = await readCreateLayout(adminPage, {
        createId,
        opponentId: `${game}-opponent`,
      });
      assert.ok(laptopLayout.opponent);
      assertControlHeight(laptopLayout.create, `${game} create action at 1024px`);
      assertControlHeight(laptopLayout.opponent, `${game} opponent pill at 1024px`);
      for (const segment of laptopLayout.segments) {
        assertControlHeight(segment, `${game} ${segment.label} segment at 1024px`);
      }
      assertAligned([laptopLayout.create, laptopLayout.opponent], `${game} controls share a center line at 1024px`);

      await adminPage.setViewportSize({ width: 1440, height: 900 });
      const desktopLayout = await readCreateLayout(adminPage, {
        createId,
        opponentId: `${game}-opponent`,
      });
      assert.ok(
        Math.abs(desktopLayout.create.left - desktopLayout.row.left - tetrisCreateInset) <= 1,
        `${game} keeps the Tetris create-action inset at 1440px`,
      );
    }

    await adminPage.setViewportSize({ width: 390, height: 844 });
    await selectArcadeGame(adminPage, 'tetris');
    const phoneLayout = await readCreateLayout(adminPage, {
      createId: 'tetris-create',
      modeId: 'tetris-mode',
      opponentId: 'tetris-opponent',
    });
    assert.ok(phoneLayout.mode);
    assert.ok(phoneLayout.opponent);
    assertFullRow(phoneLayout.create, phoneLayout.row, 'the 390px create action fills row one');
    assert.ok(phoneLayout.create.bottom < phoneLayout.mode.top, 'the 390px create action sits above the settings');
    assertAligned([phoneLayout.mode, phoneLayout.opponent], 'both 390px pills share row two');
    assert.ok(phoneLayout.mode.width < phoneLayout.row.width, 'the 188px container query stays inactive at 390px');
    for (const box of [phoneLayout.mode, phoneLayout.create, phoneLayout.opponent, ...phoneLayout.segments]) {
      assertControlHeight(box, 'every 390px Tetris control');
    }
    assert.ok(phoneLayout.actionsClientWidth >= 188, '390px retains enough interior width for two pills');
    assert.equal(phoneLayout.documentScrollWidth, phoneLayout.documentClientWidth, '390px has no page overflow');
    assert.deepEqual(
      phoneLayout.segments.filter((segment) => segment.scrollWidth > segment.clientWidth),
      [],
      '390px labels stay inside their segments',
    );

    await adminPage.setViewportSize({ width: 320, height: 568 });
    const narrowLayout = await readCreateLayout(adminPage, {
      createId: 'tetris-create',
      modeId: 'tetris-mode',
      opponentId: 'tetris-opponent',
    });
    assert.ok(narrowLayout.mode);
    assert.ok(narrowLayout.opponent);
    assert.ok(narrowLayout.actionsClientWidth < 188, '320px activates the measured container edge case');
    assertFullRow(narrowLayout.create, narrowLayout.row, 'the 320px create action fills row one');
    assertFullRow(narrowLayout.mode, narrowLayout.row, 'the 320px mode pill fills row two');
    assertFullRow(narrowLayout.opponent, narrowLayout.row, 'the 320px opponent pill fills row three');
    assert.ok(narrowLayout.create.bottom < narrowLayout.mode.top, 'the 320px mode pill follows the create row');
    assert.ok(narrowLayout.mode.bottom < narrowLayout.opponent.top, 'the 320px opponent pill follows the mode row');
    for (const box of [narrowLayout.mode, narrowLayout.create, narrowLayout.opponent, ...narrowLayout.segments]) {
      assertControlHeight(box, 'every 320px Tetris control');
    }
    assert.deepEqual(
      narrowLayout.segments.filter((segment) => segment.scrollWidth > segment.clientWidth),
      [],
      '320px labels stay inside their full-width segments',
    );
    assert.equal(narrowLayout.documentScrollWidth, narrowLayout.documentClientWidth, '320px has no page overflow');
    assert.deepEqual(
      narrowLayout.buttonOrder,
      ['Duell', 'Arena', 'Lobby öffnen', 'Mensch', 'KI'],
      'the narrow visual reflow does not change DOM order',
    );

    const firstModeSegment = adminPage.locator('#tetris-mode .arcade-mode-toggle-btn').first();
    await adminPage.keyboard.press('Tab');
    await firstModeSegment.focus();
    const focusOrder: string[] = [];
    for (let index = 0; index < 5; index += 1) {
      focusOrder.push(await adminPage.evaluate(() => document.activeElement?.textContent?.trim() || ''));
      if (index < 4) await adminPage.keyboard.press('Tab');
    }
    assert.deepEqual(focusOrder, ['Duell', 'Arena', 'Lobby öffnen', 'Mensch', 'KI']);
    await firstModeSegment.focus();
    assert.notEqual(await firstModeSegment.evaluate((element) => getComputedStyle(element).outlineStyle), 'none');
    const clippingAncestors = await firstModeSegment.evaluate((element) => {
      const clipped: string[] = [];
      for (let current = element.parentElement; current; current = current.parentElement) {
        const style = getComputedStyle(current);
        if ([style.overflow, style.overflowX, style.overflowY].some((value) => value !== 'visible')) {
          clipped.push(current.className);
        }
        if (current.classList.contains('arcade-lobby-card')) break;
      }
      return clipped;
    });
    assert.deepEqual(clippingAncestors, [], 'no ancestor clips the segment focus ring');

    for (const pillId of ['tetris-mode', 'tetris-opponent']) {
      const activeCoverage = await adminPage.locator(`#${pillId}`).evaluate((pill) => {
        const pillBox = pill.getBoundingClientRect();
        const active = pill.querySelector('.is-active')!;
        const activeBox = active.getBoundingClientRect();
        return {
          pillTop: pillBox.top,
          pillBottom: pillBox.bottom,
          activeTop: activeBox.top,
          activeBottom: activeBox.bottom,
          backgroundColor: getComputedStyle(active).backgroundColor,
        };
      });
      assert.ok(Math.abs(activeCoverage.pillTop - activeCoverage.activeTop) <= 1);
      assert.ok(Math.abs(activeCoverage.pillBottom - activeCoverage.activeBottom) <= 1);
      assert.notEqual(activeCoverage.backgroundColor, 'rgba(0, 0, 0, 0)');
    }

    await adminPage.setViewportSize({ width: 390, height: 844 });
    await adminPage.click('#tetris-create');
    await adminPage.waitForSelector('#tetris-create[disabled]');
    await adminPage.waitForSelector('#tetris-create-info', { state: 'attached' });
    for (const width of [390, 1024]) {
      await adminPage.setViewportSize({ width, height: width === 390 ? 844 : 768 });
      const disabledLayout = await readCreateLayout(adminPage, {
        createId: 'tetris-create',
        opponentId: 'tetris-opponent',
      });
      assert.ok(disabledLayout.opponent);
      assert.ok(disabledLayout.tooltip);
      assert.equal(await adminPage.locator('#tetris-create').isDisabled(), true);
      assert.equal(await adminPage.locator('#tetris-opponent .arcade-mode-toggle-btn').first().isDisabled(), true);
      for (const box of [disabledLayout.create, disabledLayout.opponent, disabledLayout.tooltip, ...disabledLayout.segments]) {
        assertControlHeight(box, `disabled Tetris controls at ${width}px`);
      }
      assertAligned([disabledLayout.create, disabledLayout.tooltip], `tooltip and disabled CTA align at ${width}px`);
    }
    const warningTrigger = adminPage.locator('.arcade-lobby-create-row .info-tooltip-trigger');
    await adminPage.keyboard.press('Tab');
    await warningTrigger.focus();
    assert.notEqual(await warningTrigger.evaluate((element) => getComputedStyle(element).outlineStyle), 'none');
    await adminPage.click('[data-tetris-close]');
    await adminPage.waitForSelector('#tetris-create:not([disabled])');

    await selectArcadeGame(adminPage, 'challenge-rush');
    await adminPage.waitForSelector('#cr-create:not([disabled])');
    assert.equal(await adminPage.locator('#cr-opponent').count(), 0);
    await adminPage.waitForSelector('.challenge-rush-test-selector');

    // Challenge Rush has neither a mode nor an opponent switch. Its create
    // action still keeps the shared lobby button width and remains centered.
    await adminPage.setViewportSize({ width: 1440, height: 900 });
    await selectArcadeGame(adminPage, 'tetris');
    await adminPage.waitForSelector('#tetris-mode');
    const withMode = (await adminPage.locator('#tetris-create').boundingBox())!;
    const modeRow = (await adminPage.locator('#tetris-create').locator('xpath=..').boundingBox())!;
    await selectArcadeGame(adminPage, 'challenge-rush');
    await adminPage.waitForSelector('#cr-create');
    assert.equal(await adminPage.locator('#cr-mode').count(), 0);
    assert.equal(await adminPage.locator('#cr-opponent').count(), 0);
    const withoutMode = (await adminPage.locator('#cr-create').boundingBox())!;
    const plainRow = (await adminPage.locator('#cr-create').locator('xpath=..').boundingBox())!;
    assert.ok(withoutMode.height >= 31 && withoutMode.height <= 33, 'Challenge Rush keeps the control height');
    assert.equal(withoutMode.width, withMode.width);
    assert.equal(
      Math.round(withoutMode.x - plainRow.x),
      Math.round(withMode.x - modeRow.x),
      'the create action keeps the same left inset with and without a mode switch',
    );
    assert.equal(
      Math.round(plainRow.x + plainRow.width - (withoutMode.x + withoutMode.width)),
      Math.round(withoutMode.x - plainRow.x),
      'the create action keeps equal left and right insets',
    );

    // A host's lobby footer pairs Start with the destructive action. Both must
    // render at the same width. Tetris with only its host is exactly the case
    // that used to break it: Start is disabled and carries a reason tooltip,
    // which nested inside Start's own wrapper took width out of its half.
    await selectArcadeGame(adminPage, 'tetris');
    await adminPage.waitForSelector('#tetris-create:not([disabled])');
    await adminPage.click('#tetris-create');
    await adminPage.waitForSelector('#tetris-start');
    assert.equal(
      await adminPage.locator('.arcade-lobby-entry-actions > .info-tooltip').count(),
      1,
      'a solo Tetris host shows the disabled-Start reason beside the action',
    );
    const startBox = (await adminPage.locator('#tetris-start').boundingBox())!;
    const closeBox = (await adminPage.locator('[data-tetris-close]').boundingBox())!;
    assert.equal(
      Math.round(startBox.width),
      Math.round(closeBox.width),
      'Start and the closing action share the lobby footer evenly',
    );
    await adminPage.click('[data-tetris-close]');
    await adminPage.waitForSelector('#tetris-create:not([disabled])');

    // Leaving Admin mode hides the exact challenge selector in place. The
    // normal multiplayer lobby action remains available.
    await selectArcadeGame(adminPage, 'challenge-rush');
    await adminPage.waitForSelector('#cr-create:not([disabled])');
    await adminPage.click('#admin-banner-leave');
    await adminPage.waitForSelector('#admin-banner', { state: 'hidden' });
    await adminPage.waitForSelector('.challenge-rush-test-selector', { state: 'detached' });
    assert.equal(await adminPage.locator('#cr-opponent').count(), 0);
    await adminPage.waitForSelector('#cr-create:not([disabled])');
    await adminPage.click('#cr-create');
    await adminPage.waitForSelector('[data-cr-start]');
  } finally {
    await adminContext.close();
  }
});
