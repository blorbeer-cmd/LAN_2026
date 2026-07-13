import { test } from 'node:test';
import assert from 'node:assert/strict';
import { arcadeStreamCanvasSize, drawArcadeStreamCanvas, prepareArcadeStreamCanvas } from './arcadeStreamRenderer.js';

test('stream canvases keep each game world aspect ratio', () => {
  assert.deepEqual(arcadeStreamCanvasSize('pong'), [960, 540]);
  assert.deepEqual(arcadeStreamCanvasSize('blobby'), [1000, 600]);
  assert.deepEqual(arcadeStreamCanvasSize('snake'), [800, 500]);
  assert.deepEqual(arcadeStreamCanvasSize('scribble'), [800, 500]);

  const canvas = { width: 1, height: 1 };
  prepareArcadeStreamCanvas(canvas, 'snake');
  assert.deepEqual(canvas, { width: 800, height: 500 });
});

test('the Pong stream draws both full paddles inside the real 960 by 540 world', () => {
  const rectangles = [];
  const arcs = [];
  const context = {
    clearRect() {},
    fillRect: (...args) => rectangles.push(args),
    beginPath() {},
    moveTo() {},
    lineTo() {},
    stroke() {},
    setLineDash() {},
    arc: (...args) => arcs.push(args),
    fill() {},
    fillStyle: '',
    strokeStyle: '',
  };
  const canvas = { width: 1, height: 1, getContext: () => context };
  const originalDocument = globalThis.document;
  const originalGetComputedStyle = globalThis.getComputedStyle;
  globalThis.document = { documentElement: {} };
  globalThis.getComputedStyle = () => ({ getPropertyValue: () => '#ffffff' }); // design-token-ok: deterministic canvas test color

  try {
    drawArcadeStreamCanvas(canvas, {
      gameType: 'pong',
      world: {
        paddles: [{ x: 48, y: 100 }, { x: 896, y: 200 }],
        ball: { x: 480, y: 270 },
      },
    });
  } finally {
    globalThis.document = originalDocument;
    globalThis.getComputedStyle = originalGetComputedStyle;
  }

  assert.equal(canvas.width, 960);
  assert.equal(canvas.height, 540);
  assert.deepEqual(rectangles.filter(([, , width, height]) => width === 16 && height === 112), [
    [48, 100, 16, 112],
    [896, 200, 16, 112],
  ]);
  assert.deepEqual(arcs.at(-1), [480, 270, 12, 0, Math.PI * 2]);
});
