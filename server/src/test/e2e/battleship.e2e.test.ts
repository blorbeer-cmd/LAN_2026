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

test('Battleship: a finished duel does not show up as still running on the winner\'s own Arcade overview', async () => {
  const hostPlayer = await createPlayer('Battleship Overview Host');
  const guestPlayer = await createPlayer('Battleship Overview Guest');
  const spectatorPlayer = await createPlayer('Battleship Overview Spectator');
  const host = await openArcadeAs(hostPlayer.id);
  const guest = await openArcadeAs(guestPlayer.id);
  const spectator = await openArcadeAs(spectatorPlayer.id);

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

    if ((await host.page.locator('[data-fire-cell]:not([disabled])').count()) === 0) {
      await fire(guest.page, hostFleet.water[0]);
    }
    for (let index = 0; index < guestFleet.ships.length; index += 1) {
      await fire(host.page, guestFleet.ships[index]);
      if (index < guestFleet.ships.length - 1) await fire(guest.page, hostFleet.water[index + 1]);
    }

    await host.page.waitForSelector('text=gewinnt!');
    await host.page.click('#battleship-back');
    await host.page.waitForSelector('.arcade-tiles');

    // The host was just playing this match — during the short post-match
    // reveal window it must not appear as a still-running game they could
    // "watch" on their own overview, even though the same match remains
    // visible to a third party who was never part of it.
    await spectator.page.waitForSelector('[data-watch-match]');
    assert.equal(
      await host.page.locator('[data-watch-match]').count(),
      0,
      'a player must not see their own just-finished match as a running game to watch'
    );
  } finally {
    await host.context.close();
    await guest.context.close();
    await spectator.context.close();
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
