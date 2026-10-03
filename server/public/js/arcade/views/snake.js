import { connectSocket } from '../../socket.js';
import { showToast } from '../../toast.js';
import { confirmDialog } from '../../modal.js';
import { getMyId } from '../../whoami.js';
import { showCountdown, cancelCountdown } from '../countdown.js';
import { arcadeLobbyEntryHtml, arcadeLobbyHostActionsHtml, arcadeLobbyGuestActionsHtml, arcadeLobbyJoinHtml, readyToggleHtml, wireReadyToggle } from '../lobbyReady.js';
import { arcadeGameHeaderHtml, arcadeMatchControlsHtml, arcadePlayerStripHtml, arcadeResultListHtml, arcadeScoreboardHtml, pointsLabel, wireArcadeToolbar } from '../arcadeUi.js';
import { createRematchController } from '../rematch.js';
import { playArcadeSound } from '../arcadeSound.js';
import { snakeColor } from '../shared/snakeColors.js';

const DEFAULT_COLS = 48;
const DEFAULT_ROWS = 30;

let socket = null;
let lobbies = [];
let match = null;
let world = null;
let keyboardBound = false;
let prevMyScore = null; // last seen score for my own snake, to detect an eaten food for the cue
let lobbyMode = 'classic';
const myId = () => getMyId();
const rerender = () => window.dispatchEvent(new CustomEvent('respawn:rerender'));
const navigate = (view) => window.dispatchEvent(new CustomEvent('respawn:navigate', { detail: view }));
const emitAck = (event, payload) => new Promise((resolve) => socket.emit(event, payload, resolve));
const currentView = () => document.getElementById('view-container')?.dataset.view;
const rematch = createRematchController({
  prefix: 'snake',
  emit: (event, payload) => emitAck(event, payload),
  myId: () => getMyId(),
  lobbies: () => lobbies,
  events: { create: 'snake:lobby:create', bot: 'snake:lobby:bot', join: 'snake:lobby:join', ready: 'snake:lobby:ready', start: 'snake:lobby:start', leave: 'snake:lobby:leave' },
  playerName: (id) => match?.players.find((player) => player.id === id)?.name ?? 'Spieler',
  rerender: () => rerender(),
  onError: (message) => showToast(message, { error: true }),
});

export function mySnakeLobby() {
  return lobbies.find((lobby) => lobby.players.some((player) => player.id === myId())) ?? null;
}
export function hasSnakeMatch() { return Boolean(match); }
export function snakeLobbies() { return lobbies; }

export function ensureSnakeSocket() {
  if (socket) return socket;
  socket = connectSocket();
  socket.on('snake:lobbies', (payload) => {
    lobbies = payload?.lobbies ?? [];
    const joinedLobby = mySnakeLobby();
    if (joinedLobby?.mode === 'classic' || joinedLobby?.mode === 'arena') lobbyMode = joinedLobby.mode;
    if (!match && currentView() === 'arcade') rerender();
    if (match?.ended && currentView() === 'snake') {
      rematch.onLobbies();
      rerender();
    }
  });
  socket.on('snake:match:start', (payload) => {
    match = { ...payload, running: false, paused: false, ended: false };
    rematch.reset();
    world = null;
    prevMyScore = null;
    navigate('snake');
    requestAnimationFrame(() => showCountdown(payload.beginsAt));
  });
  socket.on('snake:state', (payload) => {
    world = payload.world;
    const hostChanged = Boolean(match && payload.host?.id && payload.host.id !== match.host?.id);
    if (match) {
      match.running = payload.running;
      match.paused = payload.paused;
      match.host = payload.host ?? match.host;
      match.render = payload.render ?? match.render;
    }
    const myIndex = match?.players?.findIndex((p) => p.id === myId()) ?? -1;
    const myScore = myIndex >= 0 ? world?.snakes?.[myIndex]?.score : undefined;
    if (myScore !== undefined) {
      if (prevMyScore !== null && myScore > prevMyScore) playArcadeSound('snake-eat');
      prevMyScore = myScore;
    }
    paintBoard();
    updateRosterDisplay();
    if (hostChanged && currentView() === 'snake') rerender();
    if (!document.querySelector('#snake-canvas') && currentView() === 'arcade') rerender();
  });
  socket.on('snake:match:paused', () => { if (match) { match.paused = true; if (currentView() === 'snake') updatePauseUi(); } });
  socket.on('snake:match:resumed', () => { if (match) { match.paused = false; if (currentView() === 'snake') updatePauseUi(); } });
  socket.on('snake:match:end', (payload) => {
    if (!match) return;
    match.ended = true;
    match.winner = payload.winner ?? null;
    match.scores = payload.scores ?? [];
    rematch.capture(match);
    cancelCountdown();
    playArcadeSound('snake-gameover');
    window.dispatchEvent(new CustomEvent('respawn:arcade-stats-dirty'));
    if (currentView() === 'snake' || currentView() === 'arcade') rerender();
  });
  socket.on('disconnect', () => {
    if (!match || match.ended || !match.players.some((player) => player.id === myId())) return;
    match = null;
    world = null;
    prevMyScore = null;
    cancelCountdown();
    showToast('Verbindung verloren. Du bist aus dem Snake-Match ausgeschieden.', { error: true });
    if (currentView() === 'snake' || currentView() === 'arcade') navigate('arcade');
  });
  bindKeyboard();
  return socket;
}

function lobbyEntryHtml(lobby) {
  const isHost = lobby.host.id === myId();
  const joined = lobby.players.some((player) => player.id === myId());
  const playerLimit = lobby.playerLimit ?? (lobby.mode === 'arena' ? 8 : 2);
  const minimumPlayers = lobby.mode === 'arena' ? 3 : 2;
  const full = lobby.players.length >= playerLimit && !joined;
  const ready = lobby.players.length >= minimumPlayers;
  const footerActions = isHost
    ? arcadeLobbyHostActionsHtml({ startAttrs: 'id="snake-start"', startEnabled: ready, startHint: ready ? '' : `Mindestens ${minimumPlayers} Spieler`, closeAttrs: `data-snake-close="${lobby.id}"` })
    : joined
      ? arcadeLobbyGuestActionsHtml({ readyHtml: readyToggleHtml(lobby, myId(), 'snake-ready'), leaveAttrs: `data-snake-leave="${lobby.id}"` })
      : '';
  const joinAction = !joined ? arcadeLobbyJoinHtml(`data-snake-join="${lobby.id}"`, full) : '';
  const meta = `${lobby.mode === 'arena' ? 'Arena' : 'Classic'} · ${lobby.players.length}/${playerLimit}`;
  return arcadeLobbyEntryHtml(lobby, { gameType: 'snake', meta, joinAction, footerActions, full, capacity: playerLimit });
}

export function renderSnakeLobbyEntries() {
  return lobbies.map((lobby) => ({ id: lobby.id, html: lobbyEntryHtml(lobby) }));
}

export async function createSnakeLobby({ mode = 'classic', opponent = 'human' } = {}) {
  lobbyMode = mode === 'arena' ? 'arena' : 'classic';
  const bot = opponent === 'bot';
  const result = await emitAck(bot ? 'snake:lobby:bot' : 'snake:lobby:create', { playerId: myId(), mode: lobbyMode });
  if (!result?.ok) showToast(result?.error || 'Lobby konnte nicht erstellt werden.', { error: true });
  return result;
}

export async function leaveMySnakeLobby() {
  const lobby = mySnakeLobby();
  if (!lobby) return { ok: true };
  return emitAck('snake:lobby:leave', { lobbyId: lobby.id, playerId: myId() });
}

export function wireSnakeLobbyCard(container, { beforeJoin } = {}) {
  container.querySelectorAll('[data-snake-join]').forEach((button) => button.addEventListener('click', async () => {
    if (beforeJoin && !(await beforeJoin())) return;
    const result = await emitAck('snake:lobby:join', { lobbyId: button.dataset.snakeJoin, playerId: myId() });
    if (!result?.ok) showToast(result?.error || 'Beitritt fehlgeschlagen.', { error: true });
  }));
  for (const [selector, attr] of [['[data-snake-close]', 'snakeClose'], ['[data-snake-leave]', 'snakeLeave']]) {
    container.querySelectorAll(selector).forEach((button) => button.addEventListener('click', () => {
      emitAck('snake:lobby:leave', { lobbyId: button.dataset[attr], playerId: myId() });
    }));
  }
  wireReadyToggle(container, 'snake-ready', async (lobbyId, ready) => {
    const result = await emitAck('snake:lobby:ready', { lobbyId, playerId: myId(), ready });
    if (!result?.ok) showToast(result?.error || 'Bereit-Status konnte nicht gesetzt werden.', { error: true });
  });
  container.querySelector('#snake-start')?.addEventListener('click', async () => {
    const result = await emitAck('snake:lobby:start', { lobbyId: mySnakeLobby()?.id, playerId: myId() });
    if (!result?.ok) showToast(result?.error || 'Start fehlgeschlagen.', { error: true });
  });
}

function directionForKey(key) {
  return ({ ArrowUp: 'up', w: 'up', W: 'up', ArrowDown: 'down', s: 'down', S: 'down', ArrowLeft: 'left', a: 'left', A: 'left', ArrowRight: 'right', d: 'right', D: 'right' })[key];
}
function sendDirection(direction) {
  if (!direction || !match?.matchId || match.ended || !match.running || match.paused) return;
  socket.emit('snake:input', { matchId: match.matchId, playerId: myId(), direction });
}
function bindKeyboard() {
  if (keyboardBound) return;
  keyboardBound = true;
  window.addEventListener('keydown', (event) => {
    if (!document.querySelector('#snake-canvas')) return;
    const direction = directionForKey(event.key);
    if (!direction) return;
    event.preventDefault();
    sendDirection(direction);
  });
}

const cssColorValue = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

function paintBoard() {
  const canvas = document.querySelector('#snake-canvas');
  if (!canvas || !world) return;
  drawSnakeBoard(canvas, world, match?.render);
}

// Draws the board for a world snapshot. The match view and the spectator view
// both draw through here, so both look exactly the same.
export function drawSnakeBoard(canvas, world, render) {
  const ratio = window.devicePixelRatio || 1;
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  canvas.width = Math.max(1, Math.round(width * ratio));
  canvas.height = Math.max(1, Math.round(height * ratio));
  const context = canvas.getContext('2d');
  context.scale(ratio, ratio);
  const columns = render?.width ?? DEFAULT_COLS;
  const rows = render?.height ?? DEFAULT_ROWS;
  const cellWidth = width / columns;
  const cellHeight = height / rows;
  context.fillStyle = cssColorValue('--bg');
  context.fillRect(0, 0, width, height);
  const cssColor = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const bounds = world.safeBounds ?? { minX: 0, maxX: columns - 1, minY: 0, maxY: rows - 1 };
  if (world.mode === 'arena') {
    const left = bounds.minX * cellWidth;
    const top = bounds.minY * cellHeight;
    const right = (bounds.maxX + 1) * cellWidth;
    const bottom = (bounds.maxY + 1) * cellHeight;
    context.fillStyle = cssColor('--danger-bg');
    context.fillRect(0, 0, width, top);
    context.fillRect(0, bottom, width, height - bottom);
    context.fillRect(0, top, left, bottom - top);
    context.fillRect(right, top, width - right, bottom - top);
    context.strokeStyle = cssColor('--danger');
    context.lineWidth = 2;
    context.strokeRect(left, top, right - left, bottom - top);
  }
  context.strokeStyle = 'rgba(145,99,245,.10)';
  context.lineWidth = 1;
  for (let x = 1; x < columns; x++) { context.beginPath(); context.moveTo(x * cellWidth, 0); context.lineTo(x * cellWidth, height); context.stroke(); }
  for (let y = 1; y < rows; y++) { context.beginPath(); context.moveTo(0, y * cellHeight); context.lineTo(width, y * cellHeight); context.stroke(); }
  world.snakes.forEach((snake, snakeIndex) => {
    const glow = cssColor(snakeColor(snakeIndex).token);
    snake.body.forEach((part, partIndex) => {
      context.globalAlpha = snake.alive ? 1 : 0.3;
      context.shadowColor = glow;
      context.shadowBlur = partIndex === 0 ? 18 : 8;
      context.fillStyle = glow;
      context.beginPath();
      context.roundRect(part.x * cellWidth + 1.5, part.y * cellHeight + 1.5, cellWidth - 3, cellHeight - 3, Math.min(cellWidth, cellHeight) * .3);
      context.fill();
    });
    if (world.mode === 'arena' && snake.body[0]) {
      const head = snake.body[0];
      context.shadowBlur = 0;
      context.fillStyle = cssColor('--bg');
      context.font = `700 ${Math.min(cellWidth, cellHeight) * .62}px sans-serif`; // design-token-ok: canvas head numbers scale with the logical cell size.
      context.textAlign = 'center';
      context.textBaseline = 'middle';
      context.fillText(`${snakeIndex + 1}`, (head.x + .5) * cellWidth, (head.y + .52) * cellHeight);
    }
  });
  context.globalAlpha = 1;
  context.shadowColor = '#f5c542'; // design-token-ok: canvas food glow needs a fixed high-contrast color.
  context.shadowBlur = 20;
  context.fillStyle = '#f5c542'; // design-token-ok: canvas food uses a fixed high-contrast color.
  context.beginPath();
  context.arc((world.food.x + .5) * cellWidth, (world.food.y + .5) * cellHeight, Math.min(cellWidth, cellHeight) * .28, 0, Math.PI * 2);
  context.fill();
  context.shadowBlur = 0;
}

function knockoutsBy(index) {
  return (world?.snakes ?? []).filter((entry) => entry.eliminatedBy === index).length;
}

function snakeStatus(index) {
  const snake = world?.snakes?.[index];
  if (!snake || snake.alive) return match.mode === 'arena' ? `${knockoutsBy(index)} K.o.` : '';
  const eliminator = snake.eliminatedBy === null || snake.eliminatedBy === undefined ? null : match.players[snake.eliminatedBy];
  return eliminator ? `Raus durch ${eliminator.name}` : 'Ausgeschieden';
}

// Classic is a duel: the same score bar as Pong, Blau left and Pink right.
// The Arena lists every snake in a strip.
function duelScoreboardHtml() {
  const side = (index) => {
    const player = match.players[index];
    const color = snakeColor(index);
    if (!player) return { label: color.label, score: 0, players: [] };
    const status = snakeStatus(index);
    return {
      label: player.id === myId() ? `${color.label} · Deine Farbe` : color.label,
      score: world?.snakes?.[index]?.score ?? 0,
      players: [{ id: player.id, name: player.name, colorVar: `var(${color.token})`, detail: status }],
    };
  };
  return arcadeScoreboardHtml({ left: side(0), right: side(1), myId: myId() });
}

function stripHtml() {
  if (match.mode !== 'arena') return duelScoreboardHtml();
  return arcadePlayerStripHtml(match.players.map((player, index) => ({
    name: player.name,
    colorVar: `var(${snakeColor(index).token})`,
    value: `${world?.snakes?.[index]?.score ?? 0}`,
    detail: player.id === myId() ? [`Deine Farbe: ${snakeColor(index).label}`, snakeStatus(index)].filter(Boolean).join(' · ') : snakeStatus(index),
    me: player.id === myId(),
    out: world?.snakes?.[index] ? !world.snakes[index].alive : false,
  })));
}

// Snapshots arrive several times per second; only touch the DOM on a change.
function updateRosterDisplay() {
  const roster = document.querySelector('#snake-roster');
  if (!roster || !match || !world) return;
  const html = stripHtml();
  if (roster.dataset.html !== html) {
    roster.innerHTML = html;
    roster.dataset.html = html;
  }
}

function resultHtml() {
  if (!match?.ended) return '';
  const scores = match.scores ?? [];
  const rows = match.players
    .map((player, index) => {
      const score = scores.find((entry) => entry.playerId === player.id);
      const detail = [match.mode === 'arena' ? `${score?.knockouts ?? knockoutsBy(index)} K.o.` : '', world?.snakes?.[index] && !world.snakes[index].alive ? snakeStatus(index) : ''].filter(Boolean).join(' · ');
      return { player, colorVar: `var(${snakeColor(index).token})`, winner: match.winner?.id === player.id || score?.isWinner === true, value: pointsLabel(score?.score ?? 0), detail, points: score?.score ?? 0 };
    })
    .sort((a, b) => Number(b.winner) - Number(a.winner) || b.points - a.points);
  rows.forEach((row, index) => { row.place = index + 1; });
  return `<section class="card stack grouped-page-section" aria-labelledby="snake-result-title">
    <div class="grouped-page-section-title"><h2 id="snake-result-title">Ergebnis</h2>${rematch.actionHtml()}</div>
    ${arcadeResultListHtml(rows)}
  </section>`;
}

function controlsHtml() {
  if (match.ended) return arcadeMatchControlsHtml('<button type="button" class="btn btn-sm" id="snake-back">Schließen</button>');
  const isHost = match.host?.id === myId();
  const isPlayer = match.players.some((p) => p.id === myId());
  // Every Arena participant can forfeit independently; the host retains a
  // separate action for ending the whole match.
  const leave = isPlayer && (match.mode === 'arena' || !isHost) ? '<button type="button" class="btn btn-sm" id="snake-leave-match">Verlassen</button>' : '';
  if (!isHost) return leave ? arcadeMatchControlsHtml(leave) : '';
  const pause = match.paused
    ? '<button type="button" class="btn btn-primary btn-sm" id="snake-pause">Fortsetzen</button>'
    : '<button type="button" class="btn btn-sm" id="snake-pause">Pausieren</button>';
  return arcadeMatchControlsHtml(`${pause}${leave}<button type="button" class="btn btn-sm" id="snake-finish">Beenden</button>`);
}

export function renderSnake(container) {
  ensureSnakeSocket();
  if (!match) {
    // Lobbies live on the Arcade hub; a direct or expired match link goes there.
    window.dispatchEvent(new CustomEvent('respawn:navigate', { detail: 'arcade' }));
    return;
  }
  container.innerHTML = `<div class="arcade-game-shell${match.ended ? ' is-ended' : ''}">
    ${arcadeGameHeaderHtml(match.mode === 'arena' ? 'Snake Arena' : 'Snake Classic', controlsHtml())}
    <div class="grouped-page-sections">
      ${resultHtml()}
      <section class="card arcade-stage">
        <div id="snake-roster">${stripHtml()}</div>
        <div class="snake-game" data-countdown-anchor><canvas id="snake-canvas"></canvas>${match.paused ? '<div class="snake-overlay">Pause</div>' : ''}</div>
      </section>
    </div>
  </div>`;
  wireArcadeToolbar(container);
  paintBoard();
  rematch.wire(container);
  wireSwipeControls(container.querySelector('#snake-canvas'));
  container.querySelector('#snake-pause')?.addEventListener('click', async () => {
    await emitAck(match.paused ? 'snake:match:resume' : 'snake:match:pause', { matchId: match.matchId, playerId: myId() });
  });
  container.querySelector('#snake-finish')?.addEventListener('click', async () => {
    if (!(await confirmDialog('Match wirklich beenden?', { confirmText: 'Beenden', danger: true }))) return;
    await emitAck('snake:match:finish', { matchId: match.matchId, playerId: myId() });
  });
  container.querySelector('#snake-leave-match')?.addEventListener('click', async () => {
    if (!(await confirmDialog('Match wirklich verlassen?', { confirmText: 'Verlassen', danger: true }))) return;
    const res = await emitAck('snake:match:leave', { matchId: match.matchId, playerId: myId() });
    if (!res?.ok) showToast(res?.error || 'Verlassen fehlgeschlagen.', { error: true });
    else {
      match = null;
      world = null;
      prevMyScore = null;
      cancelCountdown();
      navigate('arcade');
    }
  });
  container.querySelector('#snake-back')?.addEventListener('click', async () => {
    await rematch.close();
    match = null;
    world = null;
    prevMyScore = null;
    cancelCountdown();
    navigate('arcade');
  });
}

function updatePauseUi() {
  const game = document.querySelector('.snake-game');
  if (!game) return;
  game.querySelector('.snake-overlay')?.remove();
  if (match?.paused) game.insertAdjacentHTML('beforeend', '<div class="snake-overlay">Pause</div>');
  const button = document.querySelector('#snake-pause');
  if (button) {
    button.textContent = match.paused ? 'Fortsetzen' : 'Pausieren';
    button.classList.toggle('btn-primary', match.paused);
  }
}

function wireSwipeControls(canvas) {
  if (!canvas) return;
  let startX = 0;
  let startY = 0;
  canvas.addEventListener('pointerdown', (event) => {
    startX = event.clientX;
    startY = event.clientY;
    canvas.setPointerCapture(event.pointerId);
  });
  canvas.addEventListener('pointerup', (event) => {
    if (!canvas.hasPointerCapture(event.pointerId)) return;
    const dx = event.clientX - startX;
    const dy = event.clientY - startY;
    if (Math.max(Math.abs(dx), Math.abs(dy)) >= 18) sendDirection(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up'));
    canvas.releasePointerCapture(event.pointerId);
  });
  canvas.addEventListener('pointercancel', (event) => { if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId); });
}
