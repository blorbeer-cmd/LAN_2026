import { connectSocket } from '../../socket.js';
import { escapeHtml } from '../../format.js';
import { showToast } from '../../toast.js';
import { confirmDialog } from '../../modal.js';
import { getMyId } from '../../whoami.js';
import { currentPlayerMayUseArcadeAi } from '../arcadeAdmin.js';
import { showCountdown, cancelCountdown } from '../countdown.js';
import { arcadeLobbyEntryHtml, arcadeLobbyModeButtonsHtml, arcadeLobbyOpponentToggleHtml, readyToggleHtml, resetArcadeOpponentWhenAiUnavailable, wireArcadeOpponentToggle, wireReadyToggle } from '../lobbyReady.js';
import { arcadeToolbarHtml, matchRosterHtml, wireArcadeToolbar } from '../arcadeUi.js';
import { playArcadeSound } from '../arcadeSound.js';
import { infoTooltipHtml } from '../../infoTooltip.js';
import { emptyStateHtml } from '../../emptyState.js';
import { backButtonHtml } from '../../backButton.js';

const COLS = 32;
const ROWS = 20;

let socket = null;
let lobbies = [];
let match = null;
let world = null;
let keyboardBound = false;
let prevMyScore = null; // last seen score for my own snake, to detect an eaten food for the cue
let lobbyMode = 'classic';
let snakeOpponent = 'human';

const myId = () => getMyId();
const rerender = () => window.dispatchEvent(new CustomEvent('respawn:rerender'));
const navigate = (view) => window.dispatchEvent(new CustomEvent('respawn:navigate', { detail: view }));
const emitAck = (event, payload) => new Promise((resolve) => socket.emit(event, payload, resolve));
const currentView = () => document.getElementById('view-container')?.dataset.view;

export function mySnakeLobby() {
  return lobbies.find((lobby) => lobby.players.some((player) => player.id === myId())) ?? null;
}
export function hasSnakeMatch() { return Boolean(match); }
export function snakeLobbies() { return lobbies; }

export function ensureSnakeSocket() {
  if (socket) return socket;
  resetArcadeOpponentWhenAiUnavailable(() => { snakeOpponent = 'human'; });
  socket = connectSocket();
  socket.on('snake:lobbies', (payload) => {
    lobbies = payload?.lobbies ?? [];
    const joinedLobby = mySnakeLobby();
    if (joinedLobby?.mode === 'classic' || joinedLobby?.mode === 'arena') lobbyMode = joinedLobby.mode;
    if (!match && currentView() === 'arcade') rerender();
  });
  socket.on('snake:match:start', (payload) => {
    match = { ...payload, running: false, paused: false, ended: false };
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

function lobbyList() {
  if (!lobbies.length) return emptyStateHtml('Keine offene Snake-Lobby.', { style: 'padding:var(--space-4);' });
  return lobbies.map((lobby) => {
    const isHost = lobby.host.id === myId();
    const joined = lobby.players.some((player) => player.id === myId());
    const playerLimit = lobby.playerLimit ?? (lobby.mode === 'arena' ? 8 : 2);
    const minimumPlayers = lobby.mode === 'arena' ? 3 : 2;
    const full = lobby.players.length >= playerLimit && !joined;
    const ready = lobby.players.length >= minimumPlayers;
    const startReason = ready ? '' : `Noch nicht genug Spieler (mind. ${minimumPlayers}).`;
    const modeLabel = lobby.mode === 'arena' ? 'Arena' : 'Klassisch';
    const settingsHtml = `<span class="badge">${modeLabel} · ${lobby.players.length}/${playerLimit}</span>`;
    const footerActions = isHost
      ? `<button type="button" class="btn btn-sm btn-equal btn-primary" id="snake-start" ${ready ? '' : 'disabled'}>Start</button>
          ${startReason ? infoTooltipHtml(`snake-start-${lobby.id}`, 'Start nicht möglich', startReason, 'warning') : ''}
        <button type="button" class="btn btn-sm btn-equal btn-danger" data-snake-close="${lobby.id}">Schließen</button>`
      : joined
        ? `<button type="button" class="btn btn-sm btn-equal btn-danger" data-snake-leave="${lobby.id}">Verlassen</button>
          ${readyToggleHtml(lobby, myId(), 'snake-ready')}`
        : '';
    const joinAction = !joined && !isHost
      ? `<button type="button" class="btn btn-sm btn-primary" data-snake-join="${lobby.id}" ${full ? 'disabled' : ''}>Beitreten</button>`
      : '';
    return arcadeLobbyEntryHtml(lobby, { joinAction, settingsHtml, footerActions, full });
  }).join('');
}

export function renderSnakeLobbyCard() {
  const lobby = mySnakeLobby();
  const noMe = !myId();
  const modeLocked = Boolean(lobby || match);
  const createReason = !noMe && match ? 'Beende zuerst dein aktuelles Spiel.' : '';
  const mayUseAi = currentPlayerMayUseArcadeAi();
  return `<div class="card stack arcade-lobby-card">
    ${noMe ? '<div class="muted" style="font-size:var(--font-size-xs);">Wähle oben zuerst aus, wer du bist.</div>' : ''}
    <div class="arcade-lobby-create-actions">
      <div class="arcade-lobby-create-row${mayUseAi ? '' : ' arcade-lobby-create-row--no-opponent'}">
        ${arcadeLobbyModeButtonsHtml('snake-mode', 'Snake-Spielmodus', [
          { value: 'classic', label: 'Duell' },
          { value: 'arena', label: 'Arena' },
        ], lobbyMode, modeLocked)}
        <button type="button" class="btn btn-primary btn-sm" id="snake-create" ${match || noMe ? 'disabled' : ''}>Lobby öffnen</button>
        ${createReason ? infoTooltipHtml('snake-create-info', 'Lobby öffnen nicht möglich', createReason, 'warning') : ''}
        ${mayUseAi ? arcadeLobbyOpponentToggleHtml('snake-opponent', snakeOpponent, Boolean(match || noMe)) : ''}
      </div>
    </div>
    ${lobbyList()}
  </div>`;
}

export async function leaveMySnakeLobby() {
  const lobby = mySnakeLobby();
  if (!lobby) return { ok: true };
  return emitAck('snake:lobby:leave', { lobbyId: lobby.id, playerId: myId() });
}

export function wireSnakeLobbyCard(container, { beforeCreate, beforeJoin } = {}) {
  container.querySelectorAll('#snake-mode [data-arcade-mode]').forEach((button) => button.addEventListener('click', () => {
    lobbyMode = button.dataset.arcadeMode === 'arena' ? 'arena' : 'classic';
    rerender();
  }));
  wireArcadeOpponentToggle(container, 'snake-opponent', (value) => {
    snakeOpponent = value;
    rerender();
  });
  container.querySelector('#snake-create')?.addEventListener('click', async () => {
    if (beforeCreate && !(await beforeCreate())) return;
    const bot = snakeOpponent === 'bot';
    const result = await emitAck(bot ? 'snake:lobby:bot' : 'snake:lobby:create', { playerId: myId(), mode: lobbyMode });
    if (!result?.ok) showToast(result?.error || (bot ? 'KI-Lobby konnte nicht erstellt werden.' : 'Lobby konnte nicht erstellt werden.'), { error: true });
  });
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

function paintBoard() {
  const canvas = document.querySelector('#snake-canvas');
  if (!canvas || !world) return;
  const ratio = window.devicePixelRatio || 1;
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  canvas.width = Math.max(1, Math.round(width * ratio));
  canvas.height = Math.max(1, Math.round(height * ratio));
  const context = canvas.getContext('2d');
  context.scale(ratio, ratio);
  const cellWidth = width / COLS;
  const cellHeight = height / ROWS;
  context.fillStyle = '#101426'; // design-token-ok: canvas background matches the arcade board surface.
  context.fillRect(0, 0, width, height);
  const cssColor = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const bounds = world.safeBounds ?? { minX: 0, maxX: COLS - 1, minY: 0, maxY: ROWS - 1 };
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
  for (let x = 1; x < COLS; x++) { context.beginPath(); context.moveTo(x * cellWidth, 0); context.lineTo(x * cellWidth, height); context.stroke(); }
  for (let y = 1; y < ROWS; y++) { context.beginPath(); context.moveTo(0, y * cellHeight); context.lineTo(width, y * cellHeight); context.stroke(); }
  const colors = ['--accent', '--accent-3', '--state-playing', '--state-paused', '--accent-2', '--danger', '--rank-1-gold', '--text'];
  world.snakes.forEach((snake, snakeIndex) => {
    const glow = cssColor(colors[snakeIndex % colors.length]);
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
      context.font = `700 ${Math.max(10, Math.min(cellWidth, cellHeight) * .55)}px sans-serif`;
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

function updateRosterDisplay() {
  const roster = document.querySelector('#snake-roster');
  if (!roster || !match || !world) return;
  roster.innerHTML = matchRosterHtml(match.players, {
    winnerId: match.winner?.id ?? null,
    scoreFor: (_player, index) => `${world.snakes?.[index]?.score ?? 0} Punkte`,
    detailFor: (_player, index) => match.mode === 'arena' ? `Schlange ${index + 1} · ${world.snakes?.[index]?.alive ? 'Im Rennen' : 'Ausgeschieden'}` : '',
  });
}

export function renderSnake(container) {
  ensureSnakeSocket();
  if (!match) {
    container.innerHTML = `${backButtonHtml({ view: 'arcade' })}<h1 class="view-title">Snake</h1>${renderSnakeLobbyCard()}`;
    wireSnakeLobbyCard(container);
    return;
  }
  const isHost = match.host?.id === myId();
  const endedText = match.ended ? (match.winner ? `${escapeHtml(match.winner.name)} gewinnt!` : 'Unentschieden') : '';
  const roster = matchRosterHtml(match.players, {
    winnerId: match.winner?.id ?? null,
    scoreFor: (_player, index) => `${world?.snakes?.[index]?.score ?? 0} Punkte`,
    detailFor: (_player, index) => match.mode === 'arena' && world ? `Schlange ${index + 1} · ${world.snakes?.[index]?.alive ? 'Im Rennen' : 'Ausgeschieden'}` : '',
  });
  const result = match.ended ? `<div class="card arcade-winner-card"><strong>${endedText}</strong><button type="button" class="btn btn-primary" id="snake-back">Zur Arcade</button></div>` : '';
  const isPlayer = match.players.some((p) => p.id === myId());
  // Every Arena participant can forfeit independently; the host retains a
  // separate action for aborting the whole match.
  const leaveButton = isPlayer && match.mode === 'arena' ? '<button class="btn btn-sm btn-equal btn-danger" id="snake-leave-match">Arena verlassen</button>' : '';
  const controls = match.ended
    ? ''
    : isHost
      ? `<div class="arcade-match-controls"><button class="btn btn-sm btn-equal" id="snake-pause">${match.paused ? 'Fortsetzen' : 'Pausieren'}</button>${leaveButton}<button class="btn btn-sm btn-equal btn-danger" id="snake-finish">${match.mode === 'arena' ? 'Arena beenden' : 'Beenden'}</button></div>`
      : isPlayer
        ? `<div class="arcade-match-controls">${leaveButton || '<button class="btn btn-sm btn-equal btn-danger" id="snake-leave-match">Verlassen</button>'}</div>`
        : '';
  container.innerHTML = `<div class="arcade-game-shell"><div class="row"><h1 class="view-title">Snake</h1>${match.mode === 'arena' ? '<span class="badge">Arena</span>' : ''}</div>${arcadeToolbarHtml()}
    <div id="snake-roster">${roster}</div>
    <div class="card snake-game"><canvas id="snake-canvas"></canvas>${match.paused ? '<div class="snake-overlay">Pause</div>' : ''}</div>
    ${controls}${result}</div>`;
  wireArcadeToolbar(container);
  paintBoard();
  wireSwipeControls(container.querySelector('#snake-canvas'));
  container.querySelector('#snake-pause')?.addEventListener('click', async () => {
    await emitAck(match.paused ? 'snake:match:resume' : 'snake:match:pause', { matchId: match.matchId, playerId: myId() });
  });
  container.querySelector('#snake-finish')?.addEventListener('click', async () => {
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
  container.querySelector('#snake-back')?.addEventListener('click', () => {
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
