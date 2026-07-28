import { test } from 'node:test';
import assert from 'node:assert/strict';
import { arcadeStreamCanvasSize, drawArcadeStreamCanvas, prepareArcadeStreamCanvas } from './arcadeStreamRenderer.js';

test('stream canvases keep each game world aspect ratio', () => {
  assert.deepEqual(arcadeStreamCanvasSize('pong'), [960, 540]);
  assert.deepEqual(arcadeStreamCanvasSize('blobby'), [1000, 600]);
  assert.deepEqual(arcadeStreamCanvasSize('snake'), [800, 500]);
  assert.deepEqual(arcadeStreamCanvasSize('scribble'), [800, 500]);
  assert.deepEqual(arcadeStreamCanvasSize('battleship'), [960, 540]);

  const canvas = { width: 1, height: 1 };
  prepareArcadeStreamCanvas(canvas, 'snake');
  assert.deepEqual(canvas, { width: 800, height: 500 });
});

test('the Pong stream draws both full paddles inside the real 960 by 540 world', () => {
  const rectangles = [];
  const arcs = [];
  const labels = [];
  const context = {
    clearRect() {},
    fillRect: (...args) => rectangles.push(args),
    beginPath() {},
    moveTo() {},
    lineTo() {},
    stroke() {},
    setLineDash() {},
    arc: (...args) => arcs.push(args),
    fillText: (...args) => labels.push(args),
    fill() {},
    fillStyle: '',
    strokeStyle: '',
    font: '',
    textAlign: 'start',
    textBaseline: 'alphabetic',
  };
  const canvas = { width: 1, height: 1, getContext: () => context };
  const originalDocument = globalThis.document;
  const originalGetComputedStyle = globalThis.getComputedStyle;
  globalThis.document = { documentElement: {} };
  globalThis.getComputedStyle = () => ({ getPropertyValue: () => '#ffffff' }); // design-token-ok: deterministic canvas test color

  try {
    drawArcadeStreamCanvas(canvas, {
      gameType: 'pong',
      mode: 'doubles',
      players: [
        { id: 'ada', name: 'Ada Lovelace' },
        { id: 'grace', name: 'Grace Hopper' },
      ],
      world: {
        paddles: [
          { x: 48, y: 100, team: 'left', lane: 'upper', playerId: 'ada' },
          { x: 896, y: 200, team: 'right', lane: 'lower', playerId: 'grace' },
        ],
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
  assert.deepEqual(labels.map(([label]) => label), ['AL', 'GH']);
  assert.deepEqual(arcs.at(-1), [480, 270, 12, 0, Math.PI * 2]);
});

test('the Battleship stream draws public shot data without fleet coordinates', () => {
  const rectangles = [];
  const labels = [];
  const context = {
    clearRect() {},
    fillRect: (...args) => rectangles.push(args),
    beginPath() {},
    moveTo() {},
    lineTo() {},
    stroke() {},
    fillText: (...args) => labels.push(args),
    fillStyle: '',
    strokeStyle: '',
    globalAlpha: 1,
    font: '',
    textAlign: 'start',
  };
  const canvas = { width: 1, height: 1, getContext: () => context };
  const originalDocument = globalThis.document;
  const originalGetComputedStyle = globalThis.getComputedStyle;
  globalThis.document = { documentElement: {} };
  globalThis.getComputedStyle = () => ({ getPropertyValue: () => '#ffffff' }); // design-token-ok: deterministic canvas test color

  try {
    drawArcadeStreamCanvas(canvas, {
      gameType: 'battleship',
      players: [
        { name: 'Ada', shots: [{ coordinate: 0, kind: 'hit' }] },
        { name: 'Bob', shots: [{ coordinate: 99, kind: 'miss' }] },
      ],
    });
  } finally {
    globalThis.document = originalDocument;
    globalThis.getComputedStyle = originalGetComputedStyle;
  }

  assert.equal(canvas.width, 960);
  assert.equal(canvas.height, 540);
  assert.deepEqual(labels.map(([name]) => name), ['Ada', 'Bob']);
  assert.equal(rectangles.length, 5);
});
