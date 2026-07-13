import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import test from 'node:test';
import express from 'express';
import { chromium } from 'playwright';

const probeHtml = `<!doctype html>
<html lang="de">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <link rel="stylesheet" href="/css/style.css" />
    <style>
      body { margin: 0; }
      #probe { width: 100%; }
      .arcade-watch-shell { margin-bottom: 12px; }
    </style>
  </head>
  <body>
    <main id="probe"></main>
    <script type="module">
      import { drawArcadeStreamCanvas } from '/js/arcadeStreamRenderer.js';

      const emptyBoard = () => Array.from({ length: 20 }, () => Array(10).fill(0));
      const leftBoard = emptyBoard();
      const rightBoard = emptyBoard();
      leftBoard[19].splice(0, 4, 1, 2, 3, 4);
      rightBoard[19].splice(6, 4, 5, 6, 7, 8);
      const games = {
        pong: { gameType: 'pong', world: { paddles: [{ x: 48, y: 100 }, { x: 896, y: 260 }], ball: { x: 480, y: 270 } } },
        blobby: { gameType: 'blobby', world: { blobs: [{ x: 250, y: 506 }, { x: 750, y: 506 }], ball: { x: 500, y: 220 } } },
        snake: { gameType: 'snake', world: { snakes: [{ body: [{ x: 2, y: 3 }], score: 1 }, { body: [{ x: 29, y: 16 }], score: 2 }], food: { x: 16, y: 10 } } },
        tetris: { gameType: 'tetris', players: [
          { board: leftBoard, current: { color: 3, cells: [[4, 2], [5, 2], [3, 3], [4, 3]] } },
          { board: rightBoard, current: { color: 6, cells: [[4, 2], [3, 3], [4, 3], [5, 3]] } },
        ] },
        scribble: { gameType: 'scribble', strokes: [
          { type: 'stroke', color: '#22c55e', size: 8, points: [[0.2, 0.2], [0.8, 0.2], [0.8, 0.8], [0.2, 0.8], [0.2, 0.2]] },
          { type: 'fill', color: '#3b82f6', x: 0.5, y: 0.5 },
        ] },
      };

      for (const [name, game] of Object.entries(games)) {
        const shell = document.createElement('section');
        shell.className = 'arcade-watch-shell';
        const canvas = document.createElement('canvas');
        canvas.dataset.game = name;
        shell.append(canvas);
        document.querySelector('#probe').append(shell);
        drawArcadeStreamCanvas(canvas, game);
      }
      window.streamProbeReady = true;
    </script>
  </body>
</html>`;

test('Arcade spectator canvases fit a mobile viewport and render every game world', async () => {
  const app = express();
  app.get('/probe', (_request, response) => response.type('html').send(probeHtml));
  app.use(express.static(path.resolve('public')));
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const browser = await chromium.launch({ headless: true });

  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await page.goto(`http://127.0.0.1:${address.port}/probe`);
    await page.waitForFunction(() => (window as typeof window & { streamProbeReady?: boolean }).streamProbeReady === true);

    const metrics = await page.locator('canvas').evaluateAll((canvases) => canvases.map((element) => {
      const canvas = element as HTMLCanvasElement;
      const rect = canvas.getBoundingClientRect();
      return {
        game: canvas.dataset.game,
        intrinsicWidth: canvas.width,
        intrinsicHeight: canvas.height,
        displayedRatio: rect.width / rect.height,
        overflows: rect.left < 0 || rect.right > window.innerWidth,
      };
    }));
    const expected = new Map([
      ['pong', [960, 540]],
      ['blobby', [1000, 600]],
      ['snake', [800, 500]],
      ['tetris', [800, 450]],
      ['scribble', [800, 500]],
    ]);
    for (const metric of metrics) {
      const size = expected.get(metric.game ?? '');
      assert.ok(size, `unexpected game canvas ${metric.game}`);
      assert.deepEqual([metric.intrinsicWidth, metric.intrinsicHeight], size);
      assert.ok(Math.abs(metric.displayedRatio - size[0] / size[1]) < 0.01, `${metric.game} keeps its aspect ratio`);
      assert.equal(metric.overflows, false, `${metric.game} stays inside the mobile viewport`);
    }

    const pongPixels = await page.locator('canvas[data-game="pong"]').evaluate((element) => {
      const canvas = element as HTMLCanvasElement;
      const context = canvas.getContext('2d')!;
      const image = context.getImageData(0, 0, canvas.width, canvas.height).data;
      const background = [...image.slice(0, 3)];
      const countChanged = (fromX: number, toX: number) => {
        let count = 0;
        for (let y = 0; y < canvas.height; y += 2) {
          for (let x = fromX; x < toX; x += 1) {
            const offset = (y * canvas.width + x) * 4;
            if (image[offset] !== background[0] || image[offset + 1] !== background[1] || image[offset + 2] !== background[2]) count += 1;
          }
        }
        return count;
      };
      return { left: countChanged(40, 72), right: countChanged(888, 920) };
    });
    assert.ok(pongPixels.left > 500, 'the left Pong paddle is visible');
    assert.ok(pongPixels.right > 500, 'the right Pong paddle is visible');

    const scribbleFillVisible = await page.locator('canvas[data-game="scribble"]').evaluate((element) => {
      const canvas = element as HTMLCanvasElement;
      const context = canvas.getContext('2d')!;
      const corner = context.getImageData(0, 0, 1, 1).data;
      const center = context.getImageData(canvas.width / 2, canvas.height / 2, 1, 1).data;
      return corner[0] !== center[0] || corner[1] !== center[1] || corner[2] !== center[2];
    });
    assert.equal(scribbleFillVisible, true, 'Scribble fill operations are visible to spectators');
  } finally {
    await browser.close();
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});
