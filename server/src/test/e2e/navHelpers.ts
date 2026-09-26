import type { Page } from 'playwright';

// Opening a "Mehr" entry used to be two plain clicks in a row, which races the
// app's own start-up: the bottom navigation's click handlers are attached
// during initialisation (public/js/app.js), some time after `#app` stops being
// hidden. Playwright clicks as soon as the button is visible and stable, so a
// click that lands before the handler exists is dropped without any error —
// the "Mehr" view never opens, and the follow-up click then waits out its full
// timeout on an entry that is never rendered. The suite saw that as recurring
// 15s `[data-navigate="…"]` timeouts which hit a different test each run,
// because whichever test happens to lose the race is the one that fails.
//
// Re-clicking the tab is harmless once the handler is attached (switchView is
// idempotent), so poll the tab until the entry is actually present instead of
// clicking once and hoping. The overall budget stays a single click's default
// timeout, so an entry that genuinely never appears still fails just as fast.
export async function openMoreViewEntry(page: Page, entrySelector: string, timeoutMs = 15_000): Promise<void> {
  await page.waitForSelector('.nav-btn[data-view="more"]');
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    await page.click('.nav-btn[data-view="more"]');
    try {
      await page.waitForSelector(entrySelector, { timeout: 500 });
      break;
    } catch (error) {
      if (Date.now() >= deadline) throw error;
    }
  }
  await page.click(entrySelector);
}

// Opens a utility view (Admin, Mein Profil) from the desktop rail when it is
// shown, otherwise through "Mehr".
export async function openUtilityView(page: Page, view: string): Promise<void> {
  const railEntry = page.locator(`.desktop-nav-btn[data-view="${view}"]`);
  if (await railEntry.isVisible()) {
    await railEntry.click();
    return;
  }
  await openMoreViewEntry(page, `[data-navigate="${view}"]`);
}

// The device-local admin mode is switched in "Mein Profil" and shown as a
// shield on the topbar logo; a mode already in the wanted state is kept.
export async function setAdminMode(page: Page, active: boolean): Promise<void> {
  await openUtilityView(page, 'profile');
  const toggle = page.locator('#profile-admin-mode');
  await toggle.waitFor();
  if ((await toggle.getAttribute('aria-pressed')) !== String(active)) await toggle.click();
  await page.waitForSelector('#admin-indicator', { state: active ? 'visible' : 'hidden' });
}

export async function activateAdminMode(page: Page): Promise<void> {
  await setAdminMode(page, true);
}

// Collapsed Admin cards (readiness, invites, accounts, test data) keep their
// controls in the DOM; open one before interacting with its content.
export async function openAdminCard(page: Page, section: string): Promise<void> {
  const card = page.locator(`[data-admin-section="${section}"]`);
  await card.waitFor();
  if (!(await card.evaluate((element) => (element as HTMLDetailsElement).open))) await card.locator(':scope > summary').click();
}
