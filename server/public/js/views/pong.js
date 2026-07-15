import { getToken } from '../api.js';
import { escapeHtml } from '../format.js';
import { showToast } from '../toast.js';
import { getMyId } from '../whoami.js';
import { getAdminPin } from '../admin.js';
import { currentPlayerMayUseArcadeAi } from './arcadeAdmin.js';
import { showCountdown, cancelCountdown } from '../countdown.js';
import { confirmDialog } from '../modal.js';
import { allLobbyReady, lobbyPlayerChipsHtml, readyToggleHtml, wireReadyToggle } from '../lobbyReady.js';
import { arcadeExpandControlHtml, arcadeInfoGridHtml, matchRosterHtml, wireArcadeExpandControl } from './arcadeUi.js';

const W = 960;
const H = 540;
const PADDLE_WIDTH = 16;
const PADDLE_HEIGHT = 112;
const BALL_RADIUS = 12;
const PLAYER_COLORS = ['#5b8cff', '#ef5da8']; // design-token-ok: canvas paddles use the two platform accents.

let socket = null;
let lobbies = [];
let match = null;
let previous = null;
let latest = null;
let latestAt = 0;
let animation = null;
let keyboardBound = false;
let keys = { up: false, down: false };
let targetScore = 7;
let impact = null;
const trail = [];

const myId = () => getMyId();
const rerender = () => window.dispatchEvent(new CustomEvent('respawn:rerender'));
const navigate = (view) => window.dispatchEvent(new CustomEvent('respawn:navigate', { detail: view }));
const emitAck = (event, payload) => new Promise((resolve) => socket.emit(event, payload, resolve));
const currentView = () => document.getElementById('view-container')?.dataset.view;

export function myPongLobby() {
  return lobbies.find((lobby) => lobby.players.some((player) => player.id === myId())) ?? null;
}

export function hasPongMatch() {
  return Boolean(match);
}

export function pongLobbies() {
  return lobbies;
}

export function ensurePongSocket() {
  if (socket) return socket;
  socket = io({ auth: { token: getToken() } });
  socket.on('pong:lobbies', (payload) => {
    lobbies = payload?.lobbies ?? [];
    if (!match && currentView() === 'arcade') rerender();
  });
  socket.on('pong:match:start', (payload) => {
    match = { ...payload, ended: false, winner: null, paused: false, running: false };
    previous = latest = null;
    trail.length = 0;
    impact = null;
    navigate('pong');
    requestAnimationFrame(() => showCountdown(payload.beginsAt));
  });
  socket.on('pong:state', (payload) => {
    if (latest?.world?.ball && payload?.world?.ball && latest.world.ball.vx * payload.world.ball.vx < 0) {
      impact = { x: payload.world.ball.x, y: payload.world.ball.y, life: 1 };
    }
    previous = latest;
    latest = payload;
    latestAt = performance.now();
    if (match) {
      match.running = payload.running;
      match.paused = payload.paused;
      match.scores = payload.scores;
      match.targetScore = payload.targetScore;
    }
    updateRoster();
    if (!document.querySelector('#pong-canvas') && currentView() === 'arcade') rerender();
  });
  socket.on('pong:point', (payload) => {
    if (match) match.scores = payload.scores;
    updateRoster();
    flashPoint(payload.scorer?.name);
  });
  socket.on('pong:match:paused', () => { if (match) { match.paused = true; if (currentView() === 'pong') rerender(); } });
  socket.on('pong:match:resumed', () => { if (match) { match.paused = false; if (currentView() === 'pong') rerender(); } });
  socket.on('pong:match:end', (payload) => {
    if (!match) return;
    match.ended = true;
    match.running = false;
    match.winner = payload.winner ?? null;
    match.scores = payload.scores ?? [];
    cancelCountdown();
    window.dispatchEvent(new CustomEvent('respawn:arcade-stats-dirty'));
    stopAnimation();
    if (currentView() === 'pong' || currentView() === 'arcade') rerender();
  });
  bindKeyboard();
  return socket;
}

function lobbyList() {
  if (!lobbies.length) return '<div class="empty-state" style="padding:var(--space-4);">Keine offene Pong-Lobby.</div>';
  return lobbies.map((lobby) => {
    const isHost = lobby.host.id === myId();
    const joined = lobby.players.some((player) => player.id === myId());
    const full = lobby.players.length >= 2 && !joined;
    const action = isHost
      ? `<button type="button" class="btn btn-sm btn-equal btn-danger" data-pong-close="${lobby.id}">Schließen</button>`
      : joined
        ? `<div class="stack" style="gap:var(--space-2);">
            ${readyToggleHtml(lobby, myId(), 'pong-ready')}
            <button type="button" class="btn btn-sm btn-equal" data-pong-leave="${lobby.id}">Verlassen</button>
          </div>`
        : `<button type="button" class="btn btn-sm btn-equal btn-primary" data-pong-join="${lobby.id}" ${full ? 'disabled' : ''}>Beitreten</button>`;
    return `<div class="lb-row" style="align-items:flex-start;">
      <div class="stack" style="gap:var(--space-2);flex:1;">
        <strong>${escapeHtml(lobby.host.name)}s Pong-Lobby</strong>
        <div class="chip-list">${lobbyPlayerChipsHtml(lobby)}</div>
        <div class="muted" style="font-size:var(--font-size-xs);">${lobby.players.length}/2 Spieler${full ? ' · voll' : ''}</div>
      </div>${action}</div>`;
  }).join('');
}

function hostStart() {
  const lobby = myPongLobby();
  if (!lobby || lobby.host.id !== myId()) return '';
  const ready = lobby.players.length === 2;
  const hint = !ready ? 'Warte auf einen Gegner…' : allLobbyReady(lobby) ? 'Gegner ist bereit.' : 'Gegner ist da — noch nicht bereit.';
  return `<div class="stack" style="gap:var(--space-2);border-top:1px solid var(--border);padding-top:var(--space-3);">
    <div class="field-label">Punkte bis Sieg</div>
    <div class="row" style="gap:var(--space-2);flex-wrap:wrap;">
      ${[5, 7, 10, 15].map((score) => `<label class="check-row" style="padding:var(--space-2) var(--space-3);"><input type="radio" name="pong-target" value="${score}" ${score === targetScore ? 'checked' : ''} />${score}</label>`).join('')}
    </div>
    <div class="muted" style="font-size:var(--font-size-xs);">${hint}</div>
    <button type="button" class="btn btn-primary btn-block" id="pong-start" ${ready ? '' : 'disabled'}>Start</button>
  </div>`;
}

export function renderPongLobbyCard() {
  const lobby = myPongLobby();
  const noMe = !myId();
  return `<div class="card stack"><div class="row-between" style="gap:var(--space-3);"><strong>Pong-Lobby</strong>
    <div class="row" style="gap:var(--space-2);">${currentPlayerMayUseArcadeAi() ? `<button type="button" class="btn btn-sm btn-equal" id="pong-bot" ${match || noMe ? 'disabled' : ''}>Gegen KI</button>` : ''}<button type="button" class="btn btn-primary btn-sm btn-equal" id="pong-create" ${match || noMe ? 'disabled' : ''}>Lobby öffnen</button></div></div>
    ${arcadeInfoGridHtml([
      { label: 'Ziel', text: 'Erreiche zuerst die Punktzahl.' },
      { label: 'Steuerung', text: 'Pfeiltasten.' },
    ])}
    ${noMe ? '<div class="muted" style="font-size:var(--font-size-xs);">Wähle oben zuerst aus, wer du bist.</div>' : ''}${lobbyList()}${hostStart()}</div>`;
}

export async function leaveMyPongLobby() {
  const lobby = myPongLobby();
  if (!lobby) return { ok: true };
  return emitAck('pong:lobby:leave', { lobbyId: lobby.id, playerId: myId() });
}

export function wirePongLobbyCard(container, { beforeCreate, beforeJoin } = {}) {
  container.querySelectorAll('input[name="pong-target"]').forEach((input) => input.addEventListener('change', () => { targetScore = Number(input.value); }));
  container.querySelector('#pong-create')?.addEventListener('click', async () => {
    if (beforeCreate && !(await beforeCreate())) return;
    const result = await emitAck('pong:lobby:create', { playerId: myId() });
    if (!result?.ok) showToast(result?.error || 'Lobby konnte nicht erstellt werden.', { error: true });
  });
  container.querySelector('#pong-bot')?.addEventListener('click', async () => {
    if (beforeCreate && !(await beforeCreate())) return;
    const result = await emitAck('pong:lobby:bot', { playerId: myId(), adminPin: getAdminPin() });
    if (!result?.ok) showToast(result?.error || 'KI-Lobby konnte nicht erstellt werden.', { error: true });
  });
  container.querySelectorAll('[data-pong-join]').forEach((button) => button.addEventListener('click', async () => {
    if (beforeJoin && !(await beforeJoin())) return;
    const result = await emitAck('pong:lobby:join', { lobbyId: button.dataset.pongJoin, playerId: myId() });
    if (!result?.ok) showToast(result?.error || 'Beitritt fehlgeschlagen.', { error: true });
  }));
  for (const [selector, attribute] of [['[data-pong-close]', 'pongClose'], ['[data-pong-leave]', 'pongLeave']]) {
    container.querySelectorAll(selector).forEach((button) => button.addEventListener('click', () => {
      emitAck('pong:lobby:leave', { lobbyId: button.dataset[attribute], playerId: myId() });
    }));
  }
  wireReadyToggle(container, 'pong-ready', async (lobbyId, ready) => {
    const result = await emitAck('pong:lobby:ready', { lobbyId, playerId: myId(), ready });
    if (!result?.ok) showToast(result?.error || 'Bereit-Status konnte nicht gesetzt werden.', { error: true });
  });
  container.querySelector('#pong-start')?.addEventListener('click', async () => {
    const result = await emitAck('pong:lobby:start', { lobbyId: myPongLobby()?.id, playerId: myId(), targetScore });
    if (!result?.ok) showToast(result?.error || 'Start fehlgeschlagen.', { error: true });
  });
}

function sendInput() {
  if (!match?.matchId || match.ended) return;
  socket.emit('pong:input', { matchId: match.matchId, playerId: myId(), input: keys });
}

function bindKeyboard() {
  if (keyboardBound) return;
  keyboardBound = true;
  window.addEventListener('keydown', (event) => {
    if (!document.querySelector('#pong-canvas')) return;
    if (event.key === 'ArrowUp') keys.up = true;
    else if (event.key === 'ArrowDown') keys.down = true;
    else return;
    event.preventDefault();
    sendInput();
  });
  window.addEventListener('keyup', (event) => {
    if (event.key === 'ArrowUp') keys.up = false;
    else if (event.key === 'ArrowDown') keys.down = false;
    else return;
    sendInput();
  });
}

function lerp(from, to, progress) {
  return from + (to - from) * progress;
}

function interpolatedWorld() {
  if (!latest?.world) return null;
  if (!previous?.world) return latest.world;
  const progress = Math.min(1, (performance.now() - latestAt + 50) / 100);
  return {
    ball: {
      x: lerp(previous.world.ball.x, latest.world.ball.x, progress),
      y: lerp(previous.world.ball.y, latest.world.ball.y, progress),
    },
    paddles: latest.world.paddles.map((paddle, index) => ({
      x: paddle.x,
      y: lerp(previous.world.paddles[index].y, paddle.y, progress),
    })),
  };
}

function drawArena(context) {
  const gradient = context.createLinearGradient(0, 0, W, H);
  gradient.addColorStop(0, '#0e1530'); // design-token-ok: canvas arena uses a dark platform-tinted surface.
  gradient.addColorStop(0.52, '#111326'); // design-token-ok: canvas arena center needs a fixed neutral midpoint.
  gradient.addColorStop(1, '#241128'); // design-token-ok: canvas arena uses a dark platform-tinted surface.
  context.fillStyle = gradient;
  context.fillRect(0, 0, W, H);

  context.strokeStyle = 'rgba(145,99,245,.12)';
  context.lineWidth = 1;
  for (let x = 48; x < W; x += 48) {
    context.beginPath(); context.moveTo(x, 0); context.lineTo(x, H); context.stroke();
  }
  for (let y = 45; y < H; y += 45) {
    context.beginPath(); context.moveTo(0, y); context.lineTo(W, y); context.stroke();
  }

  context.setLineDash([13, 16]);
  context.strokeStyle = 'rgba(226,232,255,.30)';
  context.lineWidth = 3;
  context.beginPath(); context.moveTo(W / 2, 24); context.lineTo(W / 2, H - 24); context.stroke();
  context.setLineDash([]);
  context.beginPath(); context.arc(W / 2, H / 2, 72, 0, Math.PI * 2); context.stroke();
}

function drawPaddle(context, paddle, color) {
  context.save();
  context.shadowColor = color;
  context.shadowBlur = 24;
  const fill = context.createLinearGradient(paddle.x, paddle.y, paddle.x + PADDLE_WIDTH, paddle.y + PADDLE_HEIGHT);
  fill.addColorStop(0, '#ffffff'); // design-token-ok: canvas highlight keeps neon paddles legible.
  fill.addColorStop(0.22, color);
  fill.addColorStop(1, color);
  context.fillStyle = fill;
  context.beginPath();
  context.roundRect(paddle.x, paddle.y, PADDLE_WIDTH, PADDLE_HEIGHT, 8);
  context.fill();
  context.restore();
}

function drawBall(context, ball) {
  trail.unshift({ x: ball.x, y: ball.y, life: 1 });
  if (trail.length > 14) trail.pop();
  trail.forEach((particle, index) => {
    particle.life *= 0.88;
    const radius = Math.max(2, BALL_RADIUS * (1 - index / trail.length) * .75);
    context.fillStyle = `rgba(145,99,245,${Math.max(0, particle.life * .24)})`;
    context.beginPath(); context.arc(particle.x, particle.y, radius, 0, Math.PI * 2); context.fill();
  });

  context.save();
  context.shadowColor = '#d9d5ff'; // design-token-ok: canvas ball glow uses a fixed pale accent.
  context.shadowBlur = 24;
  const fill = context.createRadialGradient(ball.x - 4, ball.y - 5, 2, ball.x, ball.y, BALL_RADIUS);
  fill.addColorStop(0, '#ffffff'); // design-token-ok: canvas ball highlight.
  fill.addColorStop(.64, '#e7e6ff'); // design-token-ok: canvas ball body.
  fill.addColorStop(1, '#9163f5'); // design-token-ok: canvas ball edge uses the brand accent.
  context.fillStyle = fill;
  context.beginPath(); context.arc(ball.x, ball.y, BALL_RADIUS, 0, Math.PI * 2); context.fill();
  context.restore();

  if (impact) {
    context.strokeStyle = `rgba(239,93,168,${impact.life * .7})`;
    context.lineWidth = 3;
    context.beginPath(); context.arc(impact.x, impact.y, 16 + (1 - impact.life) * 42, 0, Math.PI * 2); context.stroke();
    impact.life -= .055;
    if (impact.life <= 0) impact = null;
  }
}

function paint() {
  const canvas = document.querySelector('#pong-canvas');
  if (!canvas) return stopAnimation();
  const context = canvas.getContext('2d');
  const world = interpolatedWorld();
  drawArena(context);
  if (world) {
    drawPaddle(context, world.paddles[0], PLAYER_COLORS[0]);
    drawPaddle(context, world.paddles[1], PLAYER_COLORS[1]);
    drawBall(context, world.ball);
  }
  animation = requestAnimationFrame(paint);
}

function startAnimation() {
  if (!animation) animation = requestAnimationFrame(paint);
}

function stopAnimation() {
  if (animation) cancelAnimationFrame(animation);
  animation = null;
}

function flashPoint(name) {
  const element = document.querySelector('#pong-point');
  if (!element) return;
  element.textContent = `Punkt für ${name || 'Spieler'}!`;
  element.hidden = false;
  setTimeout(() => { element.hidden = true; }, 900);
}

function updateRoster() {
  const roster = document.querySelector('#pong-roster');
  if (!roster || !match) return;
  roster.innerHTML = matchRosterHtml(match.players, {
    winnerId: match.winner?.id ?? null,
    scoreFor: (player) => `${match.scores?.find((score) => score.playerId === player.id)?.score ?? 0}/${match.targetScore ?? targetScore}`,
  });
}

function resultHtml() {
  if (!match?.ended) return '';
  const text = match.winner ? `${escapeHtml(match.winner.name)} gewinnt!` : 'Match beendet';
  return `<div class="card arcade-winner-card"><strong>${text}</strong><button class="btn btn-primary" id="pong-back">Zur Arcade</button></div>`;
}

function matchControlsHtml(isHost) {
  if (!match || match.ended) return '';
  if (!isHost) {
    // A non-host player can't pause (shared timer state, host-only), but
    // must still have a way out instead of only a raw tab close.
    if (!match.players.some((p) => p.id === myId())) return '';
    return `<div class="arcade-match-controls"><button class="btn btn-sm btn-equal btn-danger" id="pong-leave-match">Verlassen</button></div>`;
  }
  return `<div class="arcade-match-controls">${match.paused ? '<button class="btn btn-sm btn-equal btn-primary" id="pong-resume">Fortsetzen</button>' : '<button class="btn btn-sm btn-equal" id="pong-pause">Pausieren</button>'}<button class="btn btn-sm btn-equal btn-danger" id="pong-finish">Beenden</button></div>`;
}

export function renderPong(container) {
  ensurePongSocket();
  if (!match) {
    container.innerHTML = `<button class="btn btn-sm" data-navigate="arcade">‹ Zurück</button><h1 class="view-title">Pong</h1>${renderPongLobbyCard()}`;
    wirePongLobbyCard(container);
    return;
  }
  const isHost = match.host?.id === myId();
  const roster = matchRosterHtml(match.players, {
    winnerId: match.winner?.id ?? null,
    scoreFor: (player) => `${match.scores?.find((score) => score.playerId === player.id)?.score ?? 0}/${match.targetScore ?? targetScore}`,
  });
  container.innerHTML = `<div class="arcade-game-shell"><h1 class="view-title">Pong</h1>${arcadeExpandControlHtml()}<div id="pong-roster">${roster}</div>
    <div class="pong-arena"><canvas id="pong-canvas" width="${W}" height="${H}"></canvas><div id="pong-point" class="pong-point" hidden></div>${match.paused ? '<div class="pong-overlay">Pause</div>' : ''}</div>
    ${matchControlsHtml(isHost)}${resultHtml()}</div>`;
  wireGame(container);
  wireArcadeExpandControl(container);
  startAnimation();
}

function wireGame(container) {
  wireTouchControls(container.querySelector('#pong-canvas'));
  container.querySelector('#pong-pause')?.addEventListener('click', async () => {
    const result = await emitAck('pong:match:pause', { matchId: match.matchId, playerId: myId() });
    if (!result?.ok) showToast(result?.error || 'Pausieren fehlgeschlagen.', { error: true });
  });
  container.querySelector('#pong-resume')?.addEventListener('click', async () => {
    const result = await emitAck('pong:match:resume', { matchId: match.matchId, playerId: myId() });
    if (!result?.ok) showToast(result?.error || 'Fortsetzen fehlgeschlagen.', { error: true });
  });
  container.querySelector('#pong-finish')?.addEventListener('click', async () => {
    if (!(await confirmDialog('Match wirklich beenden?', { confirmText: 'Beenden', danger: true }))) return;
    await emitAck('pong:match:finish', { matchId: match.matchId, playerId: myId() });
  });
  container.querySelector('#pong-leave-match')?.addEventListener('click', async () => {
    if (!(await confirmDialog('Match wirklich verlassen?', { confirmText: 'Verlassen', danger: true }))) return;
    const result = await emitAck('pong:match:leave', { matchId: match.matchId, playerId: myId() });
    if (!result?.ok) showToast(result?.error || 'Verlassen fehlgeschlagen.', { error: true });
  });
  container.querySelector('#pong-back')?.addEventListener('click', () => {
    match = null;
    previous = latest = null;
    trail.length = 0;
    stopAnimation();
    navigate('arcade');
  });
}

function wireTouchControls(canvas) {
  if (!canvas) return;
  let lastY = 0;
  canvas.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    lastY = event.clientY;
    canvas.setPointerCapture(event.pointerId);
  });
  canvas.addEventListener('pointermove', (event) => {
    if (!canvas.hasPointerCapture(event.pointerId)) return;
    const dy = event.clientY - lastY;
    if (Math.abs(dy) < 8) return;
    keys.up = dy < 0;
    keys.down = dy > 0;
    lastY = event.clientY;
    sendInput();
  });
  const release = (event) => {
    if (!canvas.hasPointerCapture(event.pointerId)) return;
    keys.up = false;
    keys.down = false;
    sendInput();
    canvas.releasePointerCapture(event.pointerId);
  };
  canvas.addEventListener('pointerup', release);
  canvas.addEventListener('pointercancel', release);
}
