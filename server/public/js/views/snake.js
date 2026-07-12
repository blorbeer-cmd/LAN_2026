import { getToken } from '../api.js';
import { escapeHtml } from '../format.js';
import { showToast } from '../toast.js';
import { getMyId } from '../whoami.js';
import { isAdmin } from '../admin.js';
import { showCountdown, cancelCountdown } from '../countdown.js';
import { allLobbyReady, lobbyPlayerChipsHtml, readyToggleHtml, wireReadyToggle } from '../lobbyReady.js';
import { arcadeExpandControlHtml, arcadeInfoGridHtml, matchRosterHtml, wireArcadeExpandControl } from './arcadeUi.js';

const COLS = 32;
const ROWS = 20;

let socket = null;
let lobbies = [];
let match = null;
let world = null;
let keyboardBound = false;

const myId = () => getMyId();
const rerender = () => window.dispatchEvent(new CustomEvent('lan:rerender'));
const navigate = (view) => window.dispatchEvent(new CustomEvent('lan:navigate', { detail: view }));
const emitAck = (event, payload) => new Promise((resolve) => socket.emit(event, payload, resolve));

export function mySnakeLobby() {
  return lobbies.find((lobby) => lobby.players.some((player) => player.id === myId())) ?? null;
}
export function hasSnakeMatch() { return Boolean(match); }
export function snakeLobbies() { return lobbies; }

export function ensureSnakeSocket() {
  if (socket) return socket;
  socket = io({ auth: { token: getToken() } });
  socket.on('snake:lobbies', (payload) => {
    lobbies = payload?.lobbies ?? [];
    if (!match) rerender();
  });
  socket.on('snake:match:start', (payload) => {
    match = { ...payload, running: false, paused: false, ended: false };
    world = null;
    navigate('snake');
    requestAnimationFrame(() => showCountdown(payload.beginsAt));
  });
  socket.on('snake:state', (payload) => {
    world = payload.world;
    if (match) {
      match.running = payload.running;
      match.paused = payload.paused;
    }
    paintBoard();
    updateRosterDisplay();
    if (!document.querySelector('#snake-canvas')) rerender();
  });
  socket.on('snake:match:paused', () => { if (match) { match.paused = true; rerender(); } });
  socket.on('snake:match:resumed', () => { if (match) { match.paused = false; rerender(); } });
  socket.on('snake:match:end', (payload) => {
    if (!match) return;
    match.ended = true;
    match.winner = payload.winner ?? null;
    match.scores = payload.scores ?? [];
    cancelCountdown();
    window.dispatchEvent(new CustomEvent('lan:arcade-stats-dirty'));
    rerender();
  });
  bindKeyboard();
  return socket;
}

function lobbyList() {
  if (!lobbies.length) return '<div class="empty-state" style="padding:var(--space-4);">Keine offene Snake-Lobby.</div>';
  return lobbies.map((lobby) => {
    const isHost = lobby.host.id === myId();
    const joined = lobby.players.some((player) => player.id === myId());
    const full = lobby.players.length >= 2 && !joined;
    const action = isHost
      ? `<button type="button" class="btn btn-sm btn-equal btn-danger" data-snake-close="${lobby.id}">Schließen</button>`
      : joined
        ? `<div class="stack" style="gap:var(--space-2);">
            ${readyToggleHtml(lobby, myId(), 'snake-ready')}
            <button type="button" class="btn btn-sm btn-equal" data-snake-leave="${lobby.id}">Verlassen</button>
          </div>`
        : `<button type="button" class="btn btn-sm btn-equal btn-primary" data-snake-join="${lobby.id}" ${full ? 'disabled' : ''}>Beitreten</button>`;
    return `<div class="lb-row" style="align-items:flex-start;">
      <div class="stack" style="gap:var(--space-2);flex:1;">
        <strong>${escapeHtml(lobby.host.name)}s Snake-Lobby</strong>
        <div class="chip-list">${lobbyPlayerChipsHtml(lobby)}</div>
        <div class="muted" style="font-size:var(--font-size-xs);">${lobby.players.length}/2 Spieler${full ? ' · voll' : ''}</div>
      </div>${action}</div>`;
  }).join('');
}

function hostStart() {
  const lobby = mySnakeLobby();
  if (!lobby || lobby.host.id !== myId()) return '';
  const joined = lobby.players.length === 2;
  const hint = !joined ? 'Warte auf einen Gegner…' : allLobbyReady(lobby) ? 'Gegner ist bereit.' : 'Gegner ist da — noch nicht bereit.';
  return `<div class="stack" style="gap:var(--space-2);border-top:1px solid var(--border);padding-top:var(--space-3);">
    <div class="muted" style="font-size:var(--font-size-xs);">${hint}</div>
    <button type="button" class="btn btn-primary btn-block" id="snake-start" ${joined ? '' : 'disabled'}>Start</button>
  </div>`;
}

export function renderSnakeLobbyCard() {
  const lobby = mySnakeLobby();
  const noMe = !myId();
  return `<div class="card stack"><div class="row-between" style="gap:var(--space-3);"><strong>Snake-Lobby</strong>
    <div class="row" style="gap:var(--space-2);">${isAdmin() ? `<button type="button" class="btn btn-sm btn-equal" id="snake-bot" ${lobby || match || noMe ? 'disabled' : ''}>Gegen KI</button>` : ''}<button type="button" class="btn btn-primary btn-sm btn-equal" id="snake-create" ${lobby || match || noMe ? 'disabled' : ''}>Lobby öffnen</button></div></div>
    ${arcadeInfoGridHtml([
      { label: 'Ziel', text: 'Länger leben als die andere Schlange.' },
      { label: 'Steuerung', text: 'Pfeiltasten.' },
    ])}
    ${noMe ? '<div class="muted" style="font-size:var(--font-size-xs);">Wähle oben zuerst aus, wer du bist.</div>' : ''}${lobbyList()}${hostStart()}</div>`;
}

export async function leaveMySnakeLobby() {
  const lobby = mySnakeLobby();
  if (!lobby) return { ok: true };
  return emitAck('snake:lobby:leave', { lobbyId: lobby.id, playerId: myId() });
}

export function wireSnakeLobbyCard(container, { beforeJoin } = {}) {
  container.querySelector('#snake-bot')?.addEventListener('click', async () => {
    const result = await emitAck('snake:lobby:bot', { playerId: myId() });
    if (!result?.ok) showToast(result?.error || 'KI-Lobby konnte nicht erstellt werden.', { error: true });
  });
  container.querySelector('#snake-create')?.addEventListener('click', async () => {
    const result = await emitAck('snake:lobby:create', { playerId: myId() });
    if (!result?.ok) showToast(result?.error || 'Lobby konnte nicht erstellt werden.', { error: true });
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
  context.strokeStyle = 'rgba(145,99,245,.10)';
  context.lineWidth = 1;
  for (let x = 1; x < COLS; x++) { context.beginPath(); context.moveTo(x * cellWidth, 0); context.lineTo(x * cellWidth, height); context.stroke(); }
  for (let y = 1; y < ROWS; y++) { context.beginPath(); context.moveTo(0, y * cellHeight); context.lineTo(width, y * cellHeight); context.stroke(); }
  const colors = ['#5b8cff', '#ef5da8']; // design-token-ok: canvas player colors use the platform accent palette.
  world.snakes.forEach((snake, snakeIndex) => snake.body.forEach((part, partIndex) => {
    const glow = colors[snakeIndex];
    context.shadowColor = glow;
    context.shadowBlur = partIndex === 0 ? 18 : 8;
    context.fillStyle = glow;
    context.beginPath();
    context.roundRect(part.x * cellWidth + 1.5, part.y * cellHeight + 1.5, cellWidth - 3, cellHeight - 3, Math.min(cellWidth, cellHeight) * .3);
    context.fill();
  }));
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
    scoreFor: (player, index) => `${world.snakes?.[index]?.score ?? 0} Punkte`,
  });
}

export function renderSnake(container) {
  ensureSnakeSocket();
  if (!match) {
    container.innerHTML = `<button class="btn btn-sm" data-navigate="arcade">‹ Zurück</button><h1 class="view-title">Snake</h1>${renderSnakeLobbyCard()}`;
    wireSnakeLobbyCard(container);
    return;
  }
  const isHost = match.host?.id === myId();
  const endedText = match.ended ? (match.winner ? `${escapeHtml(match.winner.name)} gewinnt!` : 'Unentschieden') : '';
  const roster = matchRosterHtml(match.players, {
    winnerId: match.winner?.id ?? null,
    scoreFor: (player, index) => `${world?.snakes?.[index]?.score ?? 0} Punkte`,
  });
  const result = match.ended ? `<div class="card arcade-winner-card"><strong>${endedText}</strong><button type="button" class="btn btn-primary" id="snake-back">Zur Arcade</button></div>` : '';
  container.innerHTML = `<div class="arcade-game-shell"><h1 class="view-title">Snake</h1>${arcadeExpandControlHtml()}
    <div id="snake-roster">${roster}</div>
    <div class="card snake-game"><canvas id="snake-canvas"></canvas>${match.paused ? '<div class="snake-overlay">Pause</div>' : ''}</div>
    ${isHost && !match.ended ? `<div class="arcade-match-controls"><button class="btn btn-sm btn-equal" id="snake-pause">${match.paused ? 'Fortsetzen' : 'Pausieren'}</button><button class="btn btn-sm btn-equal btn-danger" id="snake-finish">Beenden</button></div>` : ''}${result}</div>`;
  wireArcadeExpandControl(container);
  paintBoard();
  wireSwipeControls(container.querySelector('#snake-canvas'));
  container.querySelector('#snake-pause')?.addEventListener('click', async () => {
    await emitAck(match.paused ? 'snake:match:resume' : 'snake:match:pause', { matchId: match.matchId, playerId: myId() });
  });
  container.querySelector('#snake-finish')?.addEventListener('click', async () => {
    await emitAck('snake:match:finish', { matchId: match.matchId, playerId: myId() });
  });
  container.querySelector('#snake-back')?.addEventListener('click', () => {
    match = null;
    world = null;
    cancelCountdown();
    navigate('arcade');
  });
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
