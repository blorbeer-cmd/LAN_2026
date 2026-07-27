import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, ChildProcess } from 'child_process';
import path from 'path';
import { chromium, Browser, BrowserContext, Page } from 'playwright';
import { io as ioClient, Socket as ClientSocket } from 'socket.io-client';

const PORT = 3915;
const BASE_URL = `http://localhost:${PORT}`;

let serverProcess: ChildProcess;
let browser: Browser;

interface Actor {
  context: BrowserContext;
  page: Page;
}

async function waitForServer(url: string, timeoutMs = 10_000): Promise<void> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {
      // Server process is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Server at ${url} did not become ready`);
}

async function createPlayer(name: string): Promise<{ id: string }> {
  const response = await fetch(`${BASE_URL}/api/players`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  assert.equal(response.status, 201);
  return response.json() as Promise<{ id: string }>;
}

async function openArcadeAs(playerId: string): Promise<Actor> {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  await page.goto(BASE_URL);
  await page.evaluate((id) => localStorage.setItem('respawn_my_player_id', id), playerId);
  await page.reload();
  await page.waitForSelector('.nav-btn[data-view="more"]');
  await page.click('.nav-btn[data-view="more"]');
  await page.click('[data-navigate="arcade"]');
  await page.waitForSelector('.arcade-tiles');
  await page.click('[data-game="battleship"]');
  await page.waitForSelector('#battleship-create');
  return { context, page };
}

async function randomFleet(page: Page): Promise<{ ships: number[]; water: number[] }> {
  await page.click('#battleship-random');
  const ships = await page.locator('.battleship-placement-grid .is-ship').evaluateAll((cells) =>
    cells.map((cell) => Number((cell as HTMLElement).dataset.placeCell))
  );
  assert.equal(ships.length, 17);
  const occupied = new Set(ships);
  return { ships, water: Array.from({ length: 100 }, (_, cell) => cell).filter((cell) => !occupied.has(cell)) };
}

// Mirrors the server-side `validPlacements` fixture: five horizontal ships stacked two rows apart,
// all starting at column 0, so clicking just the row-start cell places each ship in turn (the
// placement grid auto-advances `selectedShip` after every valid placement).
const MANUAL_SHIP_START_CELLS = [0, 20, 40, 60, 80];

async function readPlacedFleet(page: Page): Promise<{ ships: number[]; water: number[] }> {
  const ships = await page.locator('.battleship-placement-grid .is-ship').evaluateAll((cells) =>
    cells.map((cell) => Number((cell as HTMLElement).dataset.placeCell))
  );
  assert.equal(ships.length, 17);
  const occupied = new Set(ships);
  return { ships, water: Array.from({ length: 100 }, (_, cell) => cell).filter((cell) => !occupied.has(cell)) };
}

async function manualFleet(page: Page): Promise<{ ships: number[]; water: number[] }> {
  for (const startCell of MANUAL_SHIP_START_CELLS) {
    await page.click(`[data-place-cell="${startCell}"]`);
  }
  return readPlacedFleet(page);
}

async function fire(page: Page, coordinate: number): Promise<void> {
  const cell = page.locator(`[data-fire-cell="${coordinate}"]:not([disabled])`);
  await cell.waitFor();
  await cell.click();
  await page.locator('#battleship-fire:not([disabled])').click();
}

function waitForSocketEvent<T>(socket: ClientSocket, event: string, predicate: (payload: T) => boolean): Promise<T> {
  return new Promise((resolve) => {
    const listener = (payload: T) => {
      if (!predicate(payload)) return;
      socket.off(event, listener);
      resolve(payload);
    };
    socket.on(event, listener);
  });
}

before(async () => {
  serverProcess = spawn('node', [path.join(__dirname, '..', '..', '..', 'dist', 'index.js')], {
    env: {
      ...process.env,
      PORT: String(PORT),
      DB_FILE: ':memory:',
      ACCESS_TOKEN: '',
      NODE_ENV: 'test',
      E2E_FAST_TIMERS: '1',
    },
    stdio: 'ignore',
  });
  await waitForServer(`${BASE_URL}/api/health`);
  browser = await chromium.launch();
});

after(async () => {
  await browser?.close();
  serverProcess?.kill();
});

test('Battleship: two browsers play a complete duel and watch state reveals then cleans up', async () => {
  const hostPlayer = await createPlayer('Battleship E2E Host');
  const guestPlayer = await createPlayer('Battleship E2E Guest');
  const host = await openArcadeAs(hostPlayer.id);
  const guest = await openArcadeAs(guestPlayer.id);
  const watcher = ioClient(BASE_URL, { transports: ['websocket'], reconnection: false });

  try {
    await host.page.click('#battleship-create');
    await guest.page.waitForSelector('[data-battleship-join]');
    await guest.page.click('[data-battleship-join]');
    await guest.page.waitForSelector('[data-battleship-ready][data-ready="1"]');
    await guest.page.click('[data-battleship-ready][data-ready="1"]');
    await host.page.waitForSelector('[data-battleship-start]:not([disabled])');
    await host.page.click('[data-battleship-start]');

    await host.page.waitForSelector('#battleship-random');
    await guest.page.waitForSelector('#battleship-random');
    const hostFleet = await randomFleet(host.page);
    const guestFleet = await randomFleet(guest.page);
    await host.page.click('#battleship-submit-setup');
    await host.page.waitForSelector('#battleship-submit-setup:disabled');
    await guest.page.click('#battleship-submit-setup');
    await host.page.waitForSelector('[data-fire-cell]');
    await guest.page.waitForSelector('[data-fire-cell]');

    const matchId = await host.page.locator('[data-battleship-match]').getAttribute('data-battleship-match');
    assert.ok(matchId);
    const runningState = waitForSocketEvent<{
      matchId: string;
      phase: string;
      players: Array<{ fleet?: unknown }>;
    }>(watcher, 'arcade:watch:state', (payload) => payload.matchId === matchId && payload.phase === 'playing');
    const joined = await new Promise<{ ok: boolean }>((resolve) => watcher.emit('arcade:watch:join', { matchId }, resolve));
    assert.equal(joined.ok, true);
    assert.equal(
      (await runningState).players.every((player) => player.fleet === undefined),
      true,
      'running watch state must never contain unhit fleet positions'
    );
    const endedState = waitForSocketEvent<{
      matchId: string;
      phase: string;
      players: Array<{ fleet?: Array<{ cells?: number[] }> }>;
    }>(watcher, 'arcade:watch:state', (payload) => payload.matchId === matchId && payload.phase === 'ended');
    const watchEnded = waitForSocketEvent<{ matchId: string }>(
      watcher,
      'arcade:watch:ended',
      (payload) => payload.matchId === matchId
    );

    if ((await host.page.locator('[data-fire-cell]:not([disabled])').count()) === 0) {
      await fire(guest.page, hostFleet.water[0]);
    }
    for (let index = 0; index < guestFleet.ships.length; index += 1) {
      await fire(host.page, guestFleet.ships[index]);
      if (index < guestFleet.ships.length - 1) await fire(guest.page, hostFleet.water[index + 1]);
    }

    await host.page.waitForSelector('#battleship-back');
    await guest.page.waitForSelector('#battleship-back');
    await host.page.waitForSelector('text=gewinnt!');
    const revealed = await endedState;
    assert.equal(
      revealed.players.every((player) => player.fleet?.every((ship) => Array.isArray(ship.cells))),
      true,
      'the public end state must reveal every fleet only after the match ended'
    );
    assert.equal((await watchEnded).matchId, matchId);
  } finally {
    watcher.close();
    await host.context.close();
    await guest.context.close();
  }
});

test('Battleship: ships can be placed manually one at a time, and a sunk ship stays hidden as a plain hit until the end reveal', async () => {
  const hostPlayer = await createPlayer('Battleship Manual Host');
  const guestPlayer = await createPlayer('Battleship Manual Guest');
  const host = await openArcadeAs(hostPlayer.id);
  const guest = await openArcadeAs(guestPlayer.id);

  try {
    await host.page.click('#battleship-create');
    await guest.page.waitForSelector('[data-battleship-join]');
    await guest.page.click('[data-battleship-join]');
    await guest.page.waitForSelector('[data-battleship-ready][data-ready="1"]');
    await guest.page.click('[data-battleship-ready][data-ready="1"]');
    await host.page.waitForSelector('[data-battleship-start]:not([disabled])');
    await host.page.click('[data-battleship-start]');
    await host.page.waitForSelector('#battleship-random');
    await guest.page.waitForSelector('#battleship-random');

    // Placing only the first of five ships one click at a time must leave "Flotte bereit"
    // disabled with a visible reason (regression test: manual single-ship placement used to be
    // silently rejected outright, only becoming possible once "Zufällig platzieren" was used).
    await host.page.click(`[data-place-cell="${MANUAL_SHIP_START_CELLS[0]}"]`);
    await host.page.waitForSelector('#battleship-submit-setup:disabled');
    assert.equal(await host.page.locator('.info-tooltip-trigger--warning').count(), 1);
    for (const startCell of MANUAL_SHIP_START_CELLS.slice(1)) {
      await host.page.click(`[data-place-cell="${startCell}"]`);
    }
    await host.page.waitForSelector('#battleship-submit-setup:not([disabled])');
    assert.equal(await host.page.locator('.info-tooltip-trigger--warning').count(), 0);

    const hostFleet = await readPlacedFleet(host.page);
    const guestFleet = await manualFleet(guest.page);
    await host.page.click('#battleship-submit-setup');
    await guest.page.click('#battleship-submit-setup');
    await host.page.waitForSelector('[data-fire-cell]');
    await guest.page.waitForSelector('[data-fire-cell]');

    const hostGoesFirst = (await host.page.locator('[data-fire-cell]:not([disabled])').count()) > 0;
    const attacker = hostGoesFirst ? host : guest;
    const defender = hostGoesFirst ? guest : host;
    const defenderId = hostGoesFirst ? guestPlayer.id : hostPlayer.id;
    const defenderFleet = hostGoesFirst ? guestFleet : hostFleet;
    const attackerFleet = hostGoesFirst ? hostFleet : guestFleet;

    // Both fleets use the identical deterministic layout, so the two-cell destroyer is always
    // the last ship in ascending cell order: shoot it first so its second hit sinks it as the
    // attacker's very next turn, giving a precisely timed "sunk" moment to assert against.
    const destroyerCells = defenderFleet.ships.slice(-2);
    const remainingShipCells = defenderFleet.ships.slice(0, -2);
    const attackOrder = [...destroyerCells, ...remainingShipCells];

    for (let index = 0; index < attackOrder.length; index += 1) {
      await fire(attacker.page, attackOrder[index]);
      if (index === 1) {
        // The "battleship:state" broadcast carrying the new lastShot can arrive slightly after
        // the fire acknowledgement the `fire()` helper waits on, so poll for the updated badge
        // instead of reading it immediately.
        await attacker.page.locator('.battleship-status:has-text("Letzter Schuss: Treffer")').waitFor();
        const status = await attacker.page.locator('.battleship-status').innerText();
        assert.doesNotMatch(status, /Versenkt/, 'a completed ship must display as a plain hit, not "Versenkt"');
      }
      if (index < attackOrder.length - 1) {
        const waterCell = attackerFleet.water[index];
        await fire(defender.page, waterCell);
        if (index === 0) {
          await attacker.page.locator(`[data-own-cell="${waterCell}"].is-miss`).waitFor();
        }
      }
    }

    await attacker.page.waitForSelector('#battleship-back');
    await defender.page.waitForSelector('#battleship-back');
    await attacker.page.waitForSelector('text=gewinnt!');

    const revealedDestroyerClasses = await attacker.page
      .locator(`[data-battleship-reveal="${defenderId}"] [data-reveal-cell="${destroyerCells[0]}"], [data-battleship-reveal="${defenderId}"] [data-reveal-cell="${destroyerCells[1]}"]`)
      .evaluateAll((cells) => cells.map((cell) => (cell as HTMLElement).className));
    assert.equal(revealedDestroyerClasses.length, 2);
    assert.ok(revealedDestroyerClasses.every((className) => className.includes('is-sunk')), 'the end reveal must finally show which ship was sunk');
  } finally {
    await host.context.close();
    await guest.context.close();
  }
});

test('Battleship: disconnect ends the duel immediately and awards the connected opponent', async () => {
  const hostPlayer = await createPlayer('Battleship Disconnect Host');
  const guestPlayer = await createPlayer('Battleship Disconnect Guest');
  const host = await openArcadeAs(hostPlayer.id);
  const guest = await openArcadeAs(guestPlayer.id);
  let guestClosed = false;

  try {
    await host.page.click('#battleship-create');
    await guest.page.waitForSelector('[data-battleship-join]');
    await guest.page.click('[data-battleship-join]');
    await guest.page.waitForSelector('[data-battleship-ready][data-ready="1"]');
    await guest.page.click('[data-battleship-ready][data-ready="1"]');
    await host.page.waitForSelector('[data-battleship-start]:not([disabled])');
    await host.page.click('[data-battleship-start]');
    await host.page.waitForSelector('#battleship-random');

    await guest.context.close();
    guestClosed = true;
    await host.page.waitForSelector('#battleship-back');
    await host.page.waitForSelector('text=gewinnt!');
    assert.match(await host.page.locator('.arcade-winner-card').innerText(), /gewinnt|verlassen/);
  } finally {
    await host.context.close();
    if (!guestClosed) await guest.context.close();
  }
});
