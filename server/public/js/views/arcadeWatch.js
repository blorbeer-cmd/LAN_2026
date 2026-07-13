import { escapeHtml, avatarHtml } from '../format.js';
import { connectSocket } from '../socket.js';

const GAME_NAMES = {
  quiz: 'Gaming-Quiz',
  tetris: 'Tetris',
  scribble: 'Scribble',
  pong: 'Pong',
  blobby: 'Blobby Volley',
  snake: 'Snake',
};

let socket = null;
let watchedMatchId = null;
let watchedState = null;
let watchList = [];

const rerender = () => window.dispatchEvent(new CustomEvent('lan:rerender'));
const navigate = (view) => window.dispatchEvent(new CustomEvent('lan:navigate', { detail: view }));
const isArcadeWatchView = () => document.getElementById('view-container')?.dataset.view === 'arcadeWatch';

function css(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function ensureSocket() {
  if (socket) return socket;
  socket = connectSocket();
  socket.on('arcade:watch:list', (payload) => {
    watchList = payload?.matches ?? [];
    if (watchedMatchId && !watchList.some((match) => match.matchId === watchedMatchId)) {
      watchedMatchId = null;
      watchedState = null;
      if (isArcadeWatchView()) navigate('arcade');
      return;
    }
    if (isArcadeWatchView()) rerender();
  });
  socket.on('arcade:watch:ended', (payload) => {
    if (!watchedMatchId || payload?.matchId !== watchedMatchId) return;
    watchedMatchId = null;
    watchedState = null;
    if (isArcadeWatchView()) navigate('arcade');
  });
  socket.on('arcade:watch:state', (payload) => {
    if (!watchedMatchId || payload?.matchId !== watchedMatchId) return;
    watchedState = payload;
    const canvas = document.querySelector('#arcade-watch-canvas');
    if (canvas) paint(canvas, payload);
    updateWatchMeta(payload);
    if (isArcadeWatchView() && !document.querySelector('#arcade-watch-canvas') && payload.gameType !== 'quiz') rerender();
  });
  return socket;
}

export function arcadeWatchMatches() {
  return watchList;
}

export function startArcadeWatch(matchId) {
  watchedMatchId = matchId;
  watchedState = null;
  ensureSocket().emit('arcade:watch:join', { matchId }, (result) => {
    if (!result?.ok) {
      watchedMatchId = null;
      watchedState = null;
      if (isArcadeWatchView()) navigate('arcade');
      return;
    }
    rerender();
  });
  navigate('arcadeWatch');
}

function leaveWatch() {
  socket?.emit('arcade:watch:leave');
  watchedMatchId = null;
  watchedState = null;
  navigate('arcade');
}

function rosterHtml(state) {
  const players = state.players ?? [];
  const scores = new Map((state.scores ?? []).map((score) => [score.playerId, score.score]));
  return `<div class="arcade-watch-roster">${players
    .map((player, index) => {
      const name = player.name ?? player.ref?.name ?? `Spieler ${index + 1}`;
      const score = scores.get(player.playerId ?? player.id);
      return `<div class="arcade-watch-player">${avatarHtml({ ...player, name }, 28)}<span>${escapeHtml(name)}</span>${score === undefined ? '' : `<strong>${escapeHtml(String(score))}</strong>`}</div>`;
    })
    .join('')}</div>`;
}

function updateWatchMeta(state) {
  const status = document.querySelector('#arcade-watch-status');
  if (status) status.textContent = state.paused ? 'Pause' : state.phase === 'countdown' ? 'Startet gleich' : 'Läuft';
}

function drawScribble(ctx, state, width, height) {
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const op of state.strokes ?? []) {
    if (op.type !== 'stroke' || !op.points?.length) continue;
    ctx.beginPath();
    ctx.strokeStyle = op.erase ? css('--bg') : op.color;
    ctx.lineWidth = op.size;
    op.points.forEach(([x, y], index) => (index ? ctx.lineTo(x * width, y * height) : ctx.moveTo(x * width, y * height)));
    ctx.stroke();
  }
}

function drawTetris(ctx, state, width, height) {
  const boards = state.players ?? [];
  const boardWidth = width / Math.max(1, boards.length);
  boards.forEach((player, index) => {
    const cell = Math.min((boardWidth * 0.8) / 10, (height * 0.82) / 20);
    const left = index * boardWidth + boardWidth * 0.1;
    const top = height * 0.06;
    ctx.fillStyle = css('--bg-elevated');
    ctx.fillRect(left, top, cell * 10, cell * 20);
    (player.board ?? []).forEach((row, y) => row.forEach((value, x) => {
      if (!value) return;
      ctx.fillStyle = css('--accent');
      ctx.fillRect(left + x * cell, top + y * cell, cell - 1, cell - 1);
    }));
    if (player.current) {
      ctx.fillStyle = player.current.color || css('--accent-2');
      player.current.cells.forEach(([x, y]) => ctx.fillRect(left + x * cell, top + y * cell, cell - 1, cell - 1));
    }
  });
}

function drawWorld(ctx, state, width, height) {
  const world = state.world;
  if (!world) return;
  if (state.gameType === 'snake') {
    const cellWidth = width / 32;
    const cellHeight = height / 20;
    world.snakes.forEach((snake, index) => {
      ctx.fillStyle = index ? css('--accent-3') : css('--accent');
      snake.body.forEach((part) => ctx.fillRect(part.x * cellWidth, part.y * cellHeight, cellWidth - 2, cellHeight - 2));
    });
    ctx.fillStyle = css('--rank-1-gold');
    ctx.beginPath();
    ctx.arc((world.food.x + 0.5) * cellWidth, (world.food.y + 0.5) * cellHeight, Math.min(cellWidth, cellHeight) * 0.35, 0, Math.PI * 2);
    ctx.fill();
  } else if (state.gameType === 'pong') {
    const sx = width / 800;
    const sy = height / 450;
    ctx.fillStyle = css('--accent');
    ctx.fillRect(world.paddles[0].x * sx, world.paddles[0].y * sy, 12, world.paddles[0].height * sy);
    ctx.fillStyle = css('--accent-3');
    ctx.fillRect(world.paddles[1].x * sx, world.paddles[1].y * sy, 12, world.paddles[1].height * sy);
    ctx.fillStyle = css('--text');
    ctx.beginPath();
    ctx.arc(world.ball.x * sx, world.ball.y * sy, 10, 0, Math.PI * 2);
    ctx.fill();
  } else if (state.gameType === 'blobby') {
    const sx = width / 1000;
    const sy = height / 600;
    ctx.strokeStyle = css('--accent-2');
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(width / 2, 0);
    ctx.lineTo(width / 2, height);
    ctx.stroke();
    world.blobs.forEach((blob, index) => {
      ctx.fillStyle = index ? css('--accent-3') : css('--accent');
      ctx.beginPath();
      ctx.arc(blob.x * sx, blob.y * sy, 24, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.fillStyle = css('--rank-1-gold');
    ctx.beginPath();
    ctx.arc(world.ball.x * sx, world.ball.y * sy, 14, 0, Math.PI * 2);
    ctx.fill();
  }
}

function paint(canvas, state) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const width = canvas.width;
  const height = canvas.height;
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = css('--bg');
  ctx.fillRect(0, 0, width, height);
  if (state.gameType === 'scribble') drawScribble(ctx, state, width, height);
  else if (state.gameType === 'tetris') drawTetris(ctx, state, width, height);
  else drawWorld(ctx, state, width, height);
}

function stateHtml(state) {
  if (!state) return '<div class="empty-state">Verbindung zum Spiel wird hergestellt…</div>';
  if (state.gameType === 'quiz') return '<div class="arcade-watch-safe-note">Frage und Antworten werden für Zuschauer verborgen.</div>';
  return '<canvas id="arcade-watch-canvas" width="800" height="450" aria-label="Livebild des Spiels"></canvas>';
}

export function renderArcadeWatch(container) {
  ensureSocket();
  const state = watchedState;
  const name = GAME_NAMES[state?.gameType] ?? GAME_NAMES[watchList.find((match) => match.matchId === watchedMatchId)?.gameType] ?? 'Arcade';
  container.innerHTML = `
    <div class="arcade-game-shell arcade-watch-shell">
      <button type="button" class="btn btn-sm" id="arcade-watch-back">‹ Arcade</button>
      <h1 class="view-title">${escapeHtml(name)} ansehen</h1>
      <div class="arcade-watch-header"><span id="arcade-watch-status">${state?.paused ? 'Pause' : 'Läuft'}</span><span class="muted">Nur Zuschauer</span></div>
      ${rosterHtml(state ?? {})}
      ${stateHtml(state)}
      ${state?.gameType === 'scribble' ? '<div class="arcade-watch-safe-note">Wort, Tipps und Chat werden für Zuschauer verborgen.</div>' : ''}
    </div>`;
  container.querySelector('#arcade-watch-back')?.addEventListener('click', leaveWatch);
  if (state && state.gameType !== 'quiz') paint(container.querySelector('#arcade-watch-canvas'), state);
}
