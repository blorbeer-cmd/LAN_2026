import type { Locator } from 'playwright';

// Match cards bundle their general actions in an "Aktion" menu. A test that
// needs one of those entries opens its menu first; an entry rendered as a
// direct button (a single action) is used as it is.
export async function openActionMenuOf(entry: Locator): Promise<void> {
  const menu = entry.locator('xpath=ancestor::details[contains(concat(" ", normalize-space(@class), " "), " action-menu ")][1]');
  if (await menu.count() && !(await menu.evaluate((element) => (element as HTMLDetailsElement).open))) {
    await menu.locator(':scope > summary').click();
  }
  await entry.waitFor();
}

export async function clickActionMenuEntry(entry: Locator): Promise<void> {
  await openActionMenuOf(entry);
  await entry.click();
}
