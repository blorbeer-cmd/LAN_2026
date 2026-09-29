import assert from 'node:assert/strict';
import type { Locator } from 'playwright';

const { PNG } = require('pngjs') as {
  PNG: { sync: { read(buffer: Buffer): { width: number; height: number; data: Buffer } } };
};

// DOM rectangles include invisible font leading. Inspect the painted bar and
// count together, excluding the row's separators and neighboring columns.
export async function assertPaintedPollResultCentered(row: Locator): Promise<void> {
  const geometry = await row.evaluate((element) => {
    const rowBox = element.getBoundingClientRect();
    const resultBox = element.querySelector('.event-poll-result')!.getBoundingClientRect();
    return { left: resultBox.left - rowBox.left, width: resultBox.width };
  });
  const image = PNG.sync.read(await row.screenshot({ animations: 'disabled' }));
  const background = image.data.subarray((image.width + 1) * 4, (image.width + 1) * 4 + 3);
  let first = image.height;
  let last = -1;
  for (let y = 2; y < image.height - 2; y += 1) {
    for (let x = Math.ceil(geometry.left); x < Math.floor(geometry.left + geometry.width); x += 1) {
      const offset = (y * image.width + x) * 4;
      if ([0, 1, 2].some((channel) => image.data[offset + channel] - background[channel] > 32)) {
        first = Math.min(first, y);
        last = Math.max(last, y);
      }
    }
  }
  assert.ok(last > first, 'the result contains a visible bar and count');
  const above = first;
  const below = image.height - last - 1;
  assert.ok(Math.abs(above - below) <= 3,
    `painted bar/count block centers between row lines (above ${above}px, below ${below}px)`);
}
