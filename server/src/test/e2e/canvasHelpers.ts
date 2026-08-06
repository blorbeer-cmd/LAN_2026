// Shared browser-geometry helper for the E2E suites.

import type { Page } from 'playwright';

export type ElementRect = { x: number; y: number; width: number; height: number };

/**
 * Viewport rect of an element that actually has a layout box.
 *
 * `boundingBox()` resolves to `null` while an element is in the DOM but not laid out, and to a
 * zero-sized box while it is being rebuilt. Scribble's canvas is re-created whenever the arcade
 * overview socket refreshes, so a box read straight after `waitForSelector` can hit either state;
 * the `null` then surfaces one line later as `Cannot read properties of null (reading 'x')` when
 * the coordinates go into `mouse.move`. That is the intermittent CI failure this helper removes.
 *
 * Polling inside the page and returning the rect from the same call fixes both halves: it waits
 * for a real box instead of asserting one with `!`, and it leaves no second round trip in which a
 * rebuild could land between the measurement and its use.
 *
 * The rect is viewport-relative, exactly like `boundingBox()` and what `page.mouse` expects.
 */
export async function laidOutRect(page: Page, selector: string): Promise<ElementRect> {
  const handle = await page.waitForFunction((currentSelector) => {
    const rect = document.querySelector(currentSelector)?.getBoundingClientRect();
    if (!rect || rect.width <= 0 || rect.height <= 0) return null;
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
  }, selector);
  return (await handle.jsonValue()) as ElementRect;
}
