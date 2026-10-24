// Renders the home-screen PNG icons from public/img/app-icon.svg with the
// Playwright Chromium the E2E suite already uses. Run from server/ after
// changing the SVG: `node scripts/render-app-icons.mjs`.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const imgDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'img');
const svg = readFileSync(join(imgDir, 'app-icon.svg'), 'utf8');

// apple-touch-icon: iOS home screen. app-icon-maskable-512: manifest icon with
// purpose "maskable" for Android launchers and installed PWAs.
// Maskable icons must keep their artwork inside the central 80% circle, so
// there the artwork shrinks and moves up onto the center (it spans y 21..106)
// while the gradient still fills the whole square.
const outputs = [
  { file: 'apple-touch-icon.png', size: 180, artworkTransform: 'none' },
  { file: 'app-icon-maskable-512.png', size: 512, artworkTransform: 'translateY(-2.7px) scale(0.78)' },
];

const browser = await chromium.launch();
try {
  for (const { file, size, artworkTransform } of outputs) {
    const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
    await page.setContent(
      `<style>html,body{margin:0}svg{display:block;width:${size}px;height:${size}px}#artwork{transform-box:view-box;transform-origin:60px 60px;transform:${artworkTransform}}</style>${svg}`
    );
    writeFileSync(join(imgDir, file), await page.screenshot({ omitBackground: false }));
    await page.close();
    console.log(`wrote img/${file} (${size}x${size})`);
  }
} finally {
  await browser.close();
}
