const GAME_CANVAS_SIZES = {
  scribble: [800, 500],
  tetris: [800, 450],
  snake: [800, 500],
  pong: [960, 540],
  blobby: [1000, 600],
  battleship: [960, 540],
};

const TETRIS_COLORS = {
  1: '#22d3ee', // design-token-ok: classic tetromino hue
  2: '#eab308', // design-token-ok: classic tetromino hue
  3: '#22c55e', // design-token-ok: classic tetromino hue
  4: '#ef4444', // design-token-ok: classic tetromino hue
  5: '#3b82f6', // design-token-ok: classic tetromino hue
  6: '#a855f7', // design-token-ok: classic tetromino hue
  7: '#f97316', // design-token-ok: classic tetromino hue
  8: '#5b6577', // design-token-ok: garbage block hue
};

const SCRIBBLE_PAPER_COLOR = '#ffffff'; // design-token-ok: Scribble's drawing paper is intentionally white in every theme

const cssColor = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

export function arcadeStreamCanvasSize(gameType) {
  return GAME_CANVAS_SIZES[gameType] ?? [800, 450];
}

export function prepareArcadeStreamCanvas(canvas, gameType) {
  const [width, height] = arcadeStreamCanvasSize(gameType);
  if (canvas.width !== width) canvas.width = width;
  if (canvas.height !== height) canvas.height = height;
}

function rgbaForColor(color) {
  const sample = document.createElement('canvas');
  sample.width = 1;
  sample.height = 1;
  const context = sample.getContext('2d');
  if (!context) return null;
  context.fillStyle = color;
  context.fillRect(0, 0, 1, 1);
  return [...context.getImageData(0, 0, 1, 1).data];
}

function floodFill(ctx, operation, width, height) {
  const x = Math.max(0, Math.min(width - 1, Math.round(operation.x * width)));
  const y = Math.max(0, Math.min(height - 1, Math.round(operation.y * height)));
  const image = ctx.getImageData(0, 0, width, height);
  const replacement = rgbaForColor(operation.color);
  if (!replacement) return;
  const startOffset = (y * width + x) * 4;
  const start = [...image.data.slice(startOffset, startOffset + 4)];
  const tolerance = 40;
  const matches = (offset) => start.every((value, index) => Math.abs(image.data[offset + index] - value) <= tolerance);
  if (replacement.every((value, index) => Math.abs(start[index] - value) <= tolerance)) return;

  const stack = [[x, y]];
  while (stack.length) {
    const [px, py] = stack.pop();
    if (px < 0 || py < 0 || px >= width || py >= height) continue;
    const offset = (py * width + px) * 4;
    if (!matches(offset)) continue;
    replacement.forEach((value, index) => { image.data[offset + index] = value; });
    stack.push([px + 1, py], [px - 1, py], [px, py + 1], [px, py - 1]);
  }
  ctx.putImageData(image, 0, 0);
}

function drawScribble(ctx, game, width, height) {
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const operation of game.strokes ?? []) {
    if (operation.type === 'fill') {
      floodFill(ctx, operation, width, height);
      continue;
    }
    if (operation.type !== 'stroke' || !operation.points?.length) continue;
    ctx.beginPath();
    ctx.strokeStyle = operation.erase ? SCRIBBLE_PAPER_COLOR : operation.color;
    ctx.lineWidth = operation.size;
    operation.points.forEach(([x, y], index) => {
      if (index) ctx.lineTo(x * width, y * height);
      else ctx.moveTo(x * width, y * height);
    });
    if (operation.points.length === 1) ctx.lineTo(operation.points[0][0] * width, operation.points[0][1] * height);
    ctx.stroke();
  }
}

function drawTetris(ctx, game, width, height) {
  const boards = game.players ?? [];
  const columns = boards.length <= 2 ? Math.max(1, boards.length) : boards.length <= 4 ? 2 : 4;
  const rows = Math.ceil(boards.length / columns);
  const boardWidth = width / columns;
  const boardHeight = height / Math.max(1, rows);
  boards.forEach((player, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    const cell = Math.min((boardWidth * 0.78) / 10, (boardHeight * 0.78) / 20);
    const left = column * boardWidth + (boardWidth - cell * 10) / 2;
    const top = row * boardHeight + (boardHeight - cell * 20) / 2;
    const playerAlpha = player.alive === false ? 0.45 : 1;
    ctx.globalAlpha = playerAlpha;
    ctx.fillStyle = cssColor('--bg-elevated');
    ctx.fillRect(left, top, cell * 10, cell * 20);
    ctx.strokeStyle = cssColor('--border');
    ctx.globalAlpha = playerAlpha * 0.25;
    for (let x = 1; x < 10; x += 1) {
      ctx.beginPath(); ctx.moveTo(left + x * cell, top); ctx.lineTo(left + x * cell, top + cell * 20); ctx.stroke();
    }
    for (let y = 1; y < 20; y += 1) {
      ctx.beginPath(); ctx.moveTo(left, top + y * cell); ctx.lineTo(left + cell * 10, top + y * cell); ctx.stroke();
    }
    ctx.globalAlpha = playerAlpha;
    (player.board ?? []).forEach((row, y) => row.forEach((value, x) => {
      if (!value) return;
      ctx.fillStyle = TETRIS_COLORS[value] ?? cssColor('--text-muted');
      ctx.fillRect(left + x * cell + 1, top + y * cell + 1, cell - 2, cell - 2);
    }));
    if (player.current) {
      ctx.fillStyle = TETRIS_COLORS[player.current.color] ?? cssColor('--accent-2');
      player.current.cells.forEach(([x, y]) => {
        if (y >= 0) ctx.fillRect(left + x * cell + 1, top + y * cell + 1, cell - 2, cell - 2);
      });
    }
    ctx.fillStyle = cssColor('--text');
    ctx.font = `${parseFloat(getComputedStyle(document.body).fontSize) * 1.5}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillText(player.name || 'Spieler', left + cell * 5, (row + 1) * boardHeight - 4);
    ctx.textAlign = 'start';
    ctx.globalAlpha = 1;
  });
}

function drawSnake(ctx, game, width, height) {
  const world = game.world;
  const columns = game.render?.width ?? 32;
  const rows = game.render?.height ?? 20;
  const cellWidth = width / columns;
  const cellHeight = height / rows;
  const bounds = world.safeBounds ?? { minX: 0, maxX: columns - 1, minY: 0, maxY: rows - 1 };
  if (world.mode === 'arena') {
    const left = bounds.minX * cellWidth;
    const top = bounds.minY * cellHeight;
    const right = (bounds.maxX + 1) * cellWidth;
    const bottom = (bounds.maxY + 1) * cellHeight;
    ctx.fillStyle = cssColor('--danger-bg');
    ctx.fillRect(0, 0, width, top);
    ctx.fillRect(0, bottom, width, height - bottom);
    ctx.fillRect(0, top, left, bottom - top);
    ctx.fillRect(right, top, width - right, bottom - top);
    ctx.strokeStyle = cssColor('--danger');
    ctx.strokeRect(left, top, right - left, bottom - top);
  }
  ctx.strokeStyle = cssColor('--accent-2');
  ctx.globalAlpha = 0.12;
  for (let x = 1; x < columns; x += 1) {
    ctx.beginPath(); ctx.moveTo(x * cellWidth, 0); ctx.lineTo(x * cellWidth, height); ctx.stroke();
  }
  for (let y = 1; y < rows; y += 1) {
    ctx.beginPath(); ctx.moveTo(0, y * cellHeight); ctx.lineTo(width, y * cellHeight); ctx.stroke();
  }
  ctx.globalAlpha = 1;
  const snakeColors = ['--accent', '--accent-3', '--state-playing', '--state-paused', '--accent-2', '--danger', '--rank-1-gold', '--text'];
  world.snakes.forEach((snake, index) => {
    ctx.globalAlpha = snake.alive === false ? 0.3 : 1;
    ctx.fillStyle = cssColor(snakeColors[index % snakeColors.length]);
    snake.body.forEach((part) => ctx.fillRect(part.x * cellWidth + 1, part.y * cellHeight + 1, cellWidth - 2, cellHeight - 2));
    if (world.mode === 'arena' && snake.body[0]) {
      const head = snake.body[0];
      ctx.fillStyle = cssColor('--bg');
      ctx.font = `700 ${Math.max(12, Math.min(cellWidth, cellHeight) * 0.55)}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(`${index + 1}`, (head.x + 0.5) * cellWidth, (head.y + 0.52) * cellHeight);
    }
  });
  ctx.globalAlpha = 1;
  ctx.fillStyle = cssColor('--rank-1-gold');
  ctx.beginPath();
  ctx.arc((world.food.x + 0.5) * cellWidth, (world.food.y + 0.5) * cellHeight, Math.min(cellWidth, cellHeight) * 0.35, 0, Math.PI * 2);
  ctx.fill();
}

function drawPong(ctx, game, width, height) {
  const world = game.world;
  const render = { width: 960, height: 540, paddleWidth: 16, paddleHeight: 112, ballRadius: 12, ...game.render };
  const scaleX = width / render.width;
  const scaleY = height / render.height;
  ctx.strokeStyle = cssColor('--border');
  ctx.setLineDash([12, 14]);
  ctx.beginPath(); ctx.moveTo(width / 2, 0); ctx.lineTo(width / 2, height); ctx.stroke();
  if (game.mode === 'doubles') {
    ctx.beginPath(); ctx.moveTo(0, height / 2); ctx.lineTo(width, height / 2); ctx.stroke();
  }
  ctx.setLineDash([]);
  world.paddles.forEach((paddle, index) => {
    const isRightTeam = paddle.team ? paddle.team === 'right' : index > 0;
    ctx.fillStyle = isRightTeam ? cssColor('--accent-3') : cssColor('--accent');
    ctx.fillRect(paddle.x * scaleX, paddle.y * scaleY, render.paddleWidth * scaleX, render.paddleHeight * scaleY);
    const name = game.players?.find((player) => player.id === paddle.playerId)?.name?.trim();
    if (name) {
      const parts = name.split(/\s+/);
      const label = (parts.length > 1 ? `${parts[0][0]}${parts.at(-1)[0]}` : parts[0].slice(0, 2)).toUpperCase();
      ctx.fillStyle = cssColor('--text');
      ctx.font = `${Math.max(14, 18 * Math.min(scaleX, scaleY))}px sans-serif`;
      ctx.textBaseline = 'middle';
      ctx.textAlign = isRightTeam ? 'right' : 'left';
      ctx.fillText(
        label,
        (paddle.x + (isRightTeam ? 0 : render.paddleWidth)) * scaleX + (isRightTeam ? -9 : 9),
        (paddle.y + render.paddleHeight / 2) * scaleY
      );
    }
  });
  ctx.fillStyle = cssColor('--text');
  ctx.beginPath();
  ctx.arc(world.ball.x * scaleX, world.ball.y * scaleY, render.ballRadius * Math.min(scaleX, scaleY), 0, Math.PI * 2);
  ctx.fill();
}

function drawBlobby(ctx, game, width, height) {
  const world = game.world;
  const render = { width: 1000, height: 600, groundY: 550, netX: 500, netHeight: 185, blobRadius: 44, ballRadius: 24, ...game.render };
  const scaleX = width / render.width;
  const scaleY = height / render.height;
  const radiusScale = Math.min(scaleX, scaleY);
  const groundY = render.groundY * scaleY;
  const netX = render.netX * scaleX;
  ctx.fillStyle = cssColor('--bg-elevated');
  ctx.fillRect(0, groundY, width, height - groundY);
  ctx.strokeStyle = cssColor('--border-strong');
  ctx.lineWidth = Math.max(2, 3 * radiusScale);
  ctx.beginPath(); ctx.moveTo(0, groundY); ctx.lineTo(width, groundY); ctx.stroke();
  ctx.fillStyle = cssColor('--text-muted');
  const netTop = (render.groundY - render.netHeight) * scaleY;
  ctx.fillRect(netX - 5 * scaleX, netTop, 10 * scaleX, groundY - netTop);
  world.blobs.forEach((blob) => {
    ctx.fillStyle = blob.side === 'right' ? cssColor('--accent-3') : cssColor('--accent');
    ctx.beginPath(); ctx.arc(blob.x * scaleX, blob.y * scaleY, render.blobRadius * radiusScale, 0, Math.PI * 2); ctx.fill();
  });
  ctx.fillStyle = cssColor('--rank-1-gold');
  ctx.beginPath(); ctx.arc(world.ball.x * scaleX, world.ball.y * scaleY, render.ballRadius * radiusScale, 0, Math.PI * 2); ctx.fill();
}

function drawBattleship(ctx, game, width, height) {
  const players = game.players ?? [];
  const columns = players.length > 2 ? 2 : Math.max(1, players.length);
  const rows = Math.ceil(players.length / columns);
  const boardWidth = width / columns;
  const boardHeight = height / Math.max(1, rows);
  players.forEach((player, index) => {
    const cell = Math.min((boardWidth * 0.78) / 10, (boardHeight * 0.78) / 10);
    const left = index % columns * boardWidth + (boardWidth - cell * 10) / 2;
    const top = Math.floor(index / columns) * boardHeight + (boardHeight - cell * 10) / 2;
    ctx.fillStyle = cssColor('--bg-elevated');
    ctx.fillRect(left, top, cell * 10, cell * 10);
    ctx.strokeStyle = cssColor('--border');
    ctx.globalAlpha = 0.35;
    for (let grid = 1; grid < 10; grid += 1) {
      ctx.beginPath(); ctx.moveTo(left + grid * cell, top); ctx.lineTo(left + grid * cell, top + cell * 10); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(left, top + grid * cell); ctx.lineTo(left + cell * 10, top + grid * cell); ctx.stroke();
    }
    ctx.globalAlpha = 1;
    for (const shot of player.shots ?? []) {
      const row = Math.floor(shot.coordinate / 10);
      const column = shot.coordinate % 10;
      ctx.fillStyle = shot.kind === 'miss' ? cssColor('--text-muted') : cssColor('--danger');
      ctx.fillRect(left + column * cell + 2, top + row * cell + 2, cell - 4, cell - 4);
    }
    ctx.fillStyle = cssColor('--text');
    ctx.font = `${Math.max(12, cell * 0.6)}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillText(player.name || 'Spieler', left + cell * 5, top + cell * 11);
    ctx.textAlign = 'start';
  });
}

export function drawArcadeStreamCanvas(canvas, game) {
  if (!canvas || !game?.gameType) return;
  prepareArcadeStreamCanvas(canvas, game.gameType);
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const { width, height } = canvas;
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = game.gameType === 'scribble' ? SCRIBBLE_PAPER_COLOR : cssColor('--bg');
  ctx.fillRect(0, 0, width, height);

  if (game.gameType === 'scribble') drawScribble(ctx, game, width, height);
  else if (game.gameType === 'tetris') drawTetris(ctx, game, width, height);
  else if (game.world && game.gameType === 'snake') drawSnake(ctx, game, width, height);
  else if (game.world && game.gameType === 'pong') drawPong(ctx, game, width, height);
  else if (game.world && game.gameType === 'blobby') drawBlobby(ctx, game, width, height);
  else if (game.gameType === 'battleship') drawBattleship(ctx, game, width, height);
}
