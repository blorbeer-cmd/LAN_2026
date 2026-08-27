import type { Page } from 'playwright';

export async function selectArcadeGame(page: Page, game: string): Promise<void> {
  const tile = page.locator(`[data-game="${game}"]`);
  await tile.waitFor({ state: 'attached' });
  if (!(await tile.isVisible())) {
    const summary = page.locator('.arcade-game-picker > summary');
    await summary.waitFor({ state: 'visible' });
    await summary.click();
  }
  await tile.click();
}
