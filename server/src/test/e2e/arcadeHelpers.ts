import type { Page } from 'playwright';

// The Arcade hub: one "Lobbys" card with a "Lobby öffnen" dialog, the running
// matches and the statistics. Its create button is the stable ready marker.
export const ARCADE_HUB = '#arcade-create-lobby';

export interface OpenArcadeLobbyOptions {
  mode?: string;
  opponent?: 'human' | 'bot';
  // Extra choices inside the dialog before submitting (Challenge Rush tests).
  configure?: (page: Page) => Promise<void>;
}

// Opens a lobby for `game` through the hub dialog and waits for the own lobby
// card. Game ids match the dialog select: quiz, tetris, scribble, pong,
// blobby, snake, battleship, challenge-rush.
export async function openArcadeLobby(page: Page, game: string, options: OpenArcadeLobbyOptions = {}): Promise<void> {
  await page.waitForSelector(`${ARCADE_HUB}:not([disabled])`);
  await page.click(ARCADE_HUB);
  await page.waitForSelector('#arcade-create-form');
  if ((await page.locator('#arcade-create-game').inputValue()) !== game) {
    await page.selectOption('#arcade-create-game', game);
    await page.waitForSelector(`#arcade-create-game option[value="${game}"]:checked`, { state: 'attached' });
  }
  if (options.mode) {
    await page.click(`#arcade-create-mode [data-arcade-mode="${options.mode}"]`);
    await page.waitForSelector(`#arcade-create-mode [data-arcade-mode="${options.mode}"][aria-pressed="true"]`);
  }
  const opponent = options.opponent ?? 'human';
  if ((await page.locator('#arcade-create-opponent').count()) > 0) {
    await page.click(`#arcade-create-opponent [data-arcade-opponent="${opponent}"]`);
    await page.waitForSelector(`#arcade-create-opponent [data-arcade-opponent="${opponent}"][aria-pressed="true"]`);
  }
  await options.configure?.(page);
  await page.click('#arcade-create-form button[type="submit"]');
}

// Kept for older call sites: the hub has no game tiles any more, so choosing
// a game means opening a human lobby for it.
export async function selectArcadeGame(page: Page, game: string): Promise<void> {
  await openArcadeLobby(page, game);
}
