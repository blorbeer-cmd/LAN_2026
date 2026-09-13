import { readFile } from 'node:fs/promises';

interface Raster { width: number; height: number; data: Buffer }
const { PNG } = require('pngjs') as {
  PNG: { sync: { read(buffer: Buffer): Raster; write(image: Raster): Buffer } };
};

export interface VisualComparison {
  matches: boolean;
  changedPixels: number;
  totalPixels: number;
  reason: string;
  diff: Buffer;
}

// Compare all RGBA channels directly: no perceptual weighting or anti-alias exemption.
export function compareVisualPng(actualBuffer: Buffer, expectedBuffer?: Buffer): VisualComparison {
  const actual = PNG.sync.read(actualBuffer);
  const expected = expectedBuffer ? PNG.sync.read(expectedBuffer) : undefined;
  const width = Math.max(actual.width, expected?.width ?? 0);
  const height = Math.max(actual.height, expected?.height ?? 0);
  const data = Buffer.alloc(width * height * 4);
  let changedPixels = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const a = (y * actual.width + x) * 4;
      const e = (y * (expected?.width ?? 0) + x) * 4;
      const d = (y * width + x) * 4;
      const different = !expected || x >= actual.width || y >= actual.height
        || x >= expected.width || y >= expected.height
        || [0, 1, 2, 3].some((channel) => Math.abs(actual.data[a + channel] - expected.data[e + channel]) > 16);
      if (different) changedPixels += 1;
      const shade = x < actual.width && y < actual.height ? Math.round(actual.data[a] / 3) : 0;
      data.set(different ? [255, 0, 255, 255] : [shade, shade, shade, 255], d);
    }
  }
  const sameSize = expected?.width === actual.width && expected?.height === actual.height;
  const totalPixels = width * height;
  return {
    // Integer arithmetic preserves the inclusive 0.1% boundary exactly.
    matches: sameSize && changedPixels * 1000 <= totalPixels,
    changedPixels,
    totalPixels,
    reason: !expected ? 'Missing CI baseline' : !sameSize ? 'Image dimensions differ'
      : `${changedPixels}/${totalPixels} pixels exceed channel delta 16 (maximum 0.1%)`,
    diff: PNG.sync.write({ width, height, data }),
  };
}

// Deliberately read-only. There is no update flag or automatic baseline creation.
export async function compareVisualBaseline(actual: Buffer, baseline: string): Promise<VisualComparison> {
  let expected: Buffer | undefined;
  try {
    expected = await readFile(baseline);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  return compareVisualPng(actual, expected);
}
