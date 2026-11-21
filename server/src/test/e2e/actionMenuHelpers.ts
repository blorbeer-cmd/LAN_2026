import type { Locator } from 'playwright';

// Match cards bundle their general actions in an "Aktion" menu. A test that
// needs one of those entries opens its menu first; an entry rendered as a
// direct button (a single action) is used as it is.
//
// A live re-render (for example the history refresh right after a draw)
// replaces the card and starts every new menu closed. Opening once could then
// leave the entry hidden for good, so keep reopening until the entry is
// actually visible. The overall budget stays one default action timeout.
export async function openActionMenuOf(entry: Locator, timeoutMs = 15_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  const menu = entry.locator('xpath=ancestor::details[contains(concat(" ", normalize-space(@class), " "), " action-menu ")][1]');
  for (;;) {
    if (await entry.isVisible()) return;
    if (await menu.count() && !(await menu.evaluate((element) => (element as HTMLDetailsElement).open))) {
      await menu.locator(':scope > summary').click();
    }
    try {
      await entry.waitFor({ timeout: 500 });
      return;
    } catch (error) {
      if (Date.now() >= deadline) throw error;
    }
  }
}

export async function clickActionMenuEntry(entry: Locator, timeoutMs = 15_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    await openActionMenuOf(entry, Math.max(1, deadline - Date.now()));
    try {
      await entry.click({ timeout: 1_000 });
      return;
    } catch (error) {
      if (Date.now() >= deadline) throw error;
    }
  }
}
