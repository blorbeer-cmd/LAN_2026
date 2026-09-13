import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { compareVisualPng, compareVisualBaseline } from './e2e/visualComparison';
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
