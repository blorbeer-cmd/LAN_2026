import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import {
  compareVisualBaseline,
  compareVisualPng,
  visualBaselineDigest,
  visualEnvironmentDifferences,
} from './e2e/visualComparison';
const { PNG } = require('pngjs');

function png(width = 1000, height = 1, changed = 0, delta = 17, channel = 0): Buffer {
  const image = new PNG({ width, height });
  image.data.fill(100);
  for (let pixel = 0; pixel < changed; pixel += 1) image.data[pixel * 4 + channel] += delta;
  return PNG.sync.write(image);
}

test('visual comparison applies exact inclusive channel and pixel boundaries to every RGBA channel', () => {
  const baseline = png();
  for (const channel of [0, 1, 2, 3]) {
    assert.equal(compareVisualPng(png(1000, 1, 1000, 16, channel), baseline).matches, true);
    const boundary = compareVisualPng(png(1000, 1, 1, 17, channel), baseline);
    assert.equal(boundary.changedPixels, 1);
    assert.equal(boundary.matches, true);
    const failure = compareVisualPng(png(1000, 1, 2, 17, channel), baseline);
    assert.equal(failure.changedPixels, 2);
    assert.equal(failure.matches, false);
    assert.deepEqual([...PNG.sync.read(failure.diff).data.subarray(0, 4)], [255, 0, 255, 255]);
  }
  assert.equal(compareVisualPng(png(999, 1, 1), png(999)).matches, false);
  assert.equal(compareVisualPng(png(1001, 1, 1), png(1001)).matches, true);
  assert.equal(compareVisualPng(png(999), baseline).matches, false, 'dimension changes always fail');
  assert.equal(compareVisualPng(baseline).matches, false, 'missing references never pass');
  assert.throws(() => compareVisualPng(Buffer.from('not a PNG')));
});

test('normal matching, mismatching and missing-baseline comparisons never write reference files', async (context) => {
  const root = await mkdtemp(path.join(tmpdir(), 'visual-comparison-'));
  context.after(() => rm(root, { recursive: true, force: true }));
  const baseline = path.join(root, 'reference.png');
  const original = png();
  await writeFile(baseline, original);
  assert.equal((await compareVisualBaseline(original, baseline)).matches, true);
  assert.equal((await compareVisualBaseline(png(1000, 1, 2), baseline)).matches, false);
  assert.equal((await compareVisualBaseline(original, path.join(root, 'missing.png'))).matches, false);
  assert.deepEqual(await readFile(baseline), original);
  assert.deepEqual(await readdir(root), ['reference.png']);
});

test('reviewed digests bind each reference file to the reference profile', async (context) => {
  const root = await mkdtemp(path.join(tmpdir(), 'visual-digest-'));
  context.after(() => rm(root, { recursive: true, force: true }));
  const baseline = path.join(root, 'reference.png');
  const original = png();
  await writeFile(baseline, original);
  const digest = visualBaselineDigest(original);
  assert.match(digest, /^sha256:[0-9a-f]{64}$/);
  assert.equal((await compareVisualBaseline(original, baseline, digest)).matches, true);
  const unreviewed = await compareVisualBaseline(original, baseline, null);
  assert.equal(unreviewed.matches, false, 'identical pixels do not legitimize an unlisted reference');
  assert.match(unreviewed.reason, /not listed in reference-profile\.json/);
  const swapped = await compareVisualBaseline(original, baseline, `sha256:${'0'.repeat(64)}`);
  assert.equal(swapped.matches, false);
  assert.match(swapped.reason, /differs from its reviewed digest/);
  const missing = await compareVisualBaseline(original, path.join(root, 'missing.png'), digest);
  assert.equal(missing.matches, false);
  assert.match(missing.reason, /Missing reference baseline/);
});

test('environment differences cover every recorded fact and a missing profile never passes', () => {
  const actual = { os: 'ubuntu 24.04', fonts: 'sha256:a', rendering: { locale: 'de-DE', deviceScaleFactor: 1 } };
  assert.deepEqual(visualEnvironmentDifferences(null, actual), ['no reference environment recorded']);
  assert.deepEqual(visualEnvironmentDifferences([], actual), ['no reference environment recorded']);
  assert.deepEqual(
    visualEnvironmentDifferences({ rendering: { deviceScaleFactor: 1, locale: 'de-DE' }, fonts: 'sha256:a', os: 'ubuntu 24.04' }, actual),
    [],
    'key order is irrelevant',
  );
  assert.deepEqual(
    visualEnvironmentDifferences({ ...actual, os: 'ubuntu 22.04', rendering: { locale: 'de-DE', deviceScaleFactor: 2 } }, actual),
    [
      'os: reference "ubuntu 22.04", actual "ubuntu 24.04"',
      'rendering: reference {"deviceScaleFactor":2,"locale":"de-DE"}, actual {"deviceScaleFactor":1,"locale":"de-DE"}',
    ],
  );
  assert.deepEqual(
    visualEnvironmentDifferences({ os: 'ubuntu 24.04', rendering: actual.rendering, browser: 'chromium 141' }, actual),
    ['browser: reference "chromium 141", actual missing', 'fonts: reference missing, actual "sha256:a"'],
  );
});
