// Integration tests for the home-screen icons. iOS fetches them without a
// session and also probes /apple-touch-icon.png at the root; a non-image
// answer there leaves the home screen with a page screenshot instead of the
// Respawn logo.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import request from 'supertest';
import { createApp } from '../app';
const { PNG } = require('pngjs') as {
  PNG: { sync: { read(buffer: Buffer): { width: number; height: number; data: Buffer } } };
};

const app = createApp();
const imgDir = path.join(__dirname, '..', '..', 'public', 'img');

test('root apple-touch-icon paths serve the PNG instead of the SPA shell', async () => {
  const expected = fs.readFileSync(path.join(imgDir, 'apple-touch-icon.png'));
  for (const iconPath of ['/apple-touch-icon.png', '/apple-touch-icon-precomposed.png']) {
    const res = await request(app).get(iconPath).buffer(true);
    assert.equal(res.status, 200, iconPath);
    assert.match(res.headers['content-type'], /^image\/png/, iconPath);
    assert.ok(Buffer.compare(res.body, expected) === 0, `${iconPath} returns apple-touch-icon.png`);
  }
});

test('every icon referenced by index.html and the manifest is an opaque PNG of its declared size', async () => {
  const html = (await request(app).get('/')).text;
  const touchIcon = html.match(/<link rel="apple-touch-icon" sizes="(\d+)x\d+" href="([^"]+)"/);
  assert.ok(touchIcon, 'index.html declares a sized apple-touch-icon');
  const manifest = (await request(app).get('/manifest.webmanifest')).body as {
    icons: Array<{ src: string; sizes: string; purpose: string }>;
  };
  assert.ok(manifest.icons.some((icon) => icon.purpose === 'maskable'), 'manifest offers a maskable icon');

  const icons = [
    { src: touchIcon[2], size: Number(touchIcon[1]), opaque: true },
    ...manifest.icons.map((icon) => ({
      src: icon.src,
      size: Number(icon.sizes.split('x')[0]),
      // iOS and maskable launchers fill transparency; "any" icons may keep it.
      opaque: icon.purpose === 'maskable',
    })),
  ];
  for (const icon of icons) {
    const res = await request(app).get(icon.src).buffer(true);
    assert.equal(res.status, 200, icon.src);
    assert.match(res.headers['content-type'], /^image\/png/, icon.src);
    const png = PNG.sync.read(res.body);
    assert.deepEqual([png.width, png.height], [icon.size, icon.size], icon.src);
    if (icon.opaque) {
      for (let i = 3; i < png.data.length; i += 4) {
        assert.equal(png.data[i], 255, `${icon.src} has no transparent pixels`);
      }
    }
  }
});
