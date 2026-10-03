import { connectSocket } from '../../socket.js';
import { showToast } from '../../toast.js';
import { getMyId } from '../../whoami.js';
import { showCountdown, cancelCountdown } from '../countdown.js';
import { confirmDialog } from '../../modal.js';
import { arcadeLobbyEntryHtml, arcadeLobbyHostActionsHtml, arcadeLobbyGuestActionsHtml, arcadeLobbyJoinHtml, arcadeTeamMembersHtml, readyToggleHtml, wireReadyToggle } from '../lobbyReady.js';
import { arcadeGameHeaderHtml, arcadeMatchControlsHtml, arcadeResultListHtml, pointsLabel, arcadeScoreboardHtml, wireArcadeToolbar } from '../arcadeUi.js';
import { createRematchController } from '../rematch.js';
import { playArcadeSound } from '../arcadeSound.js';
import { projectPongWorld } from '../pongPrediction.js';

const W = 960;
const H = 540;
const PADDLE_WIDTH = 16;
const PADDLE_HEIGHT = 112;
const BALL_RADIUS = 12;
const PLAYER_COLORS = ['#5b8cff', '#ef5da8']; // design-token-ok: canvas paddles use the two platform accents.

let socket = null;
let lobbies = [];
let match = null;
let latest = null;
let latestAt = 0;
let animation = null;
let keyboardBound = false;
let keys = { up: false, down: false };
let targetScore = 7;
let lobbyMode = 'duel';
let impact = null;
const trail = [];
const rematch = createRematchController({
  prefix: 'pong',
  emit: (event, payload) => emitAck(event, payload),
  myId: () => getMyId(),
  lobbies: () => lobbies,
  events: { create: 'pong:lobby:create', bot: 'pong:lobby:bot', join: 'pong:lobby:join', ready: 'pong:lobby:ready', start: 'pong:lobby:start', leave: 'pong:lobby:leave' },
  startPayload: () => ({ targetScore: match?.targetScore ?? targetScore }),
  joinPayload: () => ({ team: 'auto' }),
  playerName: (id) => match?.players.find((player) => player.id === id)?.name ?? 'Spieler',
  rerender: () => rerender(),
  onError: (message) => showToast(message, { error: true }),
});

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
  socket = connectSocket();
  socket.on('pong:lobbies', (payload) => {
    lobbies = payload?.lobbies ?? [];
    if (!match && currentView() === 'arcade') rerender();
    if (match?.ended && currentView() === 'pong') {
      rematch.onLobbies();
      rerender();
    }
  });
  socket.on('pong:match:start', (payload) => {
    match = { ...payload, ended: false, winner: null, paused: false, running: false };
    rematch.reset();
    latest = null;
    trail.length = 0;
    impact = null;
    shownPaddleY.clear();
    navigate('pong');
    requestAnimationFrame(() => showCountdown(payload.beginsAt));
  });
  socket.on('pong:state', (payload) => {
    if (latest?.world?.ball && payload?.world?.ball && latest.world.ball.vx * payload.world.ball.vx < 0) {
      impact = { x: payload.world.ball.x, y: payload.world.ball.y, life: 1 };
      playArcadeSound('pong-hit');
    }
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
    playArcadeSound('pong-score');
  });
  socket.on('pong:match:paused', () => { if (match) { match.paused = true; if (currentView() === 'pong') updatePauseUi(); } });
  socket.on('pong:match:resumed', () => { if (match) { match.paused = false; if (currentView() === 'pong') updatePauseUi(); } });
  socket.on('pong:match:end', (payload) => {
    if (!match) return;
    match.ended = true;
    match.running = false;
    match.winner = payload.winner ?? null;
    match.winners = payload.winners ?? [];
    match.winnerTeam = payload.winnerTeam ?? null;
    match.scores = payload.scores ?? [];
    rematch.capture(match);
    cancelCountdown();
    if (match.winner) {
      const winnerIds = match.winners.map((winner) => winner.id);
      const localPlayerWon = winnerIds.length
        ? winnerIds.includes(myId())
        : match.winner.id === myId();
      playArcadeSound(localPlayerWon ? 'pong-win' : 'pong-lose');
    }
    window.dispatchEvent(new CustomEvent('respawn:arcade-stats-dirty'));
    stopAnimation();
    if (currentView() === 'pong' || currentView() === 'arcade') rerender();
  });
  bindKeyboard();
  return socket;
}

function modeLabel(mode) {
  return mode === 'doubles' ? 'Doppel' : 'Duell';
}

function teamLabel(team) {
  return team === 'left' ? 'Team Blau' : 'Team Pink';
}

function startReason(lobby) {
  const missing = lobby.playerLimit - lobby.players.length;
  if (missing > 0) return `Noch ${missing} ${missing === 1 ? 'Person' : 'Personen'} benötigt.`;
  const waiting = lobby.players.filter((player) => player.id !== lobby.host.id && !player.ready).length;
  return waiting > 0 ? `Noch ${waiting} ${waiting === 1 ? 'Person ist' : 'Personen sind'} nicht bereit.` : '';
}

function lobbyEntryHtml(lobby) {
  const isHost = lobby.host.id === myId();
  const joined = lobby.players.some((player) => player.id === myId());
  const full = lobby.players.length >= lobby.playerLimit && !joined;
  const ready = lobby.players.length === lobby.playerLimit && lobby.players.every((player) => player.id === lobby.host.id || player.ready);
  const settingsHtml = isHost
    ? `<label class="arcade-lobby-target-score">
        <span>Punkte bis Sieg</span>
        <select name="pong-target" aria-label="Punkte bis Sieg">
          ${[5, 7, 10, 15, 21].map((score) => `<option value="${score}" ${score === targetScore ? 'selected' : ''}>${score}</option>`).join('')}
        </select>
      </label>`
    : '';
  const footerActions = isHost
    ? arcadeLobbyHostActionsHtml({ startAttrs: 'id="pong-start"', startEnabled: ready, startHint: startReason(lobby), closeAttrs: `data-pong-close="${lobby.id}"` })
    : joined
      ? arcadeLobbyGuestActionsHtml({ readyHtml: readyToggleHtml(lobby, myId(), 'pong-ready'), leaveAttrs: `data-pong-leave="${lobby.id}"` })
      : '';
  const joinAction = !joined ? arcadeLobbyJoinHtml(`data-pong-join="${lobby.id}" data-pong-team="auto"`, full) : '';
  const meta = `${modeLabel(lobby.mode)} · ${lobby.players.length}/${lobby.playerLimit}`;
  const membersHtml = lobby.mode === 'doubles' ? arcadeTeamMembersHtml(lobby, 2) : '';
  return arcadeLobbyEntryHtml(lobby, { gameType: 'pong', meta, joinAction, settingsHtml, footerActions, full, capacity: lobby.playerLimit, membersHtml });
}

export function renderPongLobbyEntries() {
  return lobbies.map((lobby) => ({ id: lobby.id, html: lobbyEntryHtml(lobby) }));
}

export async function createPongLobby({ mode = 'duel', opponent = 'human' } = {}) {
  lobbyMode = mode === 'doubles' ? 'doubles' : 'duel';
  targetScore = lobbyMode === 'doubles' ? 21 : 7;
  const bot = opponent === 'bot';
  const result = await emitAck(bot ? 'pong:lobby:bot' : 'pong:lobby:create', { playerId: myId(), mode: lobbyMode });
  if (!result?.ok) showToast(result?.error || 'Lobby konnte nicht erstellt werden.', { error: true });
  return result;
}

export async function leaveMyPongLobby() {
  const lobby = myPongLobby();
  if (!lobby) return { ok: true };
  return emitAck('pong:lobby:leave', { lobbyId: lobby.id, playerId: myId() });
}

export function wirePongLobbyCard(container, { beforeJoin } = {}) {
  container.querySelectorAll('select[name="pong-target"]').forEach((input) => input.addEventListener('change', () => { targetScore = Number(input.value); }));
  container.querySelectorAll('[data-pong-join]').forEach((button) => button.addEventListener('click', async () => {
    if (beforeJoin && !(await beforeJoin())) return;
    const result = await emitAck('pong:lobby:join', { lobbyId: button.dataset.pongJoin, playerId: myId(), team: button.dataset.pongTeam || 'auto' });
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

function drawArena(context, mode = match?.mode) {
  const gradient = context.createLinearGradient(0, 0, W, H);
  gradient.addColorStop(0, '#0f1420'); // --bg  design-token-ok: canvas paint needs literal colors
  gradient.addColorStop(1, '#171e2e'); // --bg-elevated  design-token-ok: canvas paint needs literal colors
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
  if (mode === 'doubles') {
    context.strokeStyle = 'rgba(226,232,255,.22)';
    context.lineWidth = 2;
    context.setLineDash([10, 12]);
    context.beginPath(); context.moveTo(24, H / 2); context.lineTo(W - 24, H / 2); context.stroke();
  }
  context.setLineDash([]);
  context.beginPath(); context.arc(W / 2, H / 2, 72, 0, Math.PI * 2); context.stroke();
}

function playerInitials(playerId, players = match?.players ?? []) {
  const name = players.find((player) => player.id === playerId)?.name?.trim();
  if (!name) return '';
  const parts = name.split(/\s+/);
  return (parts.length > 1 ? `${parts[0][0]}${parts.at(-1)[0]}` : parts[0].slice(0, 2)).toUpperCase();
}

function drawPaddle(context, paddle, color, players = match?.players ?? []) {
  const paddleHeight = paddle.height ?? latest?.render?.paddleHeight ?? PADDLE_HEIGHT;
  context.save();
  context.shadowColor = color;
  context.shadowBlur = 24;
  const fill = context.createLinearGradient(paddle.x, paddle.y, paddle.x + PADDLE_WIDTH, paddle.y + paddleHeight);
  fill.addColorStop(0, '#ffffff'); // design-token-ok: canvas highlight keeps neon paddles legible.
  fill.addColorStop(0.22, color);
  fill.addColorStop(1, color);
  context.fillStyle = fill;
  context.beginPath();
  context.roundRect(paddle.x, paddle.y, PADDLE_WIDTH, paddleHeight, 8);
  context.fill();
  const label = playerInitials(paddle.playerId, players);
  if (label) {
    context.shadowBlur = 0;
    context.fillStyle = '#ffffff'; // design-token-ok: canvas player initials need maximum contrast.
    context.font = '700 18px sans-serif';
    context.textBaseline = 'middle';
    context.textAlign = paddle.team === 'left' ? 'left' : 'right';
    context.fillText(
      label,
      paddle.team === 'left' ? paddle.x + PADDLE_WIDTH + 9 : paddle.x - 9,
      paddle.y + paddleHeight / 2
    );
  }
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

// Each new snapshot corrects the predicted paddle position. Drawing that
// correction as a jump made paddles twitch when they start or stop, so the
// drawn position eases toward the prediction within a few frames instead.
// Large gaps (new rally, reconnect) still snap.
const PADDLE_SMOOTHING_MS = 28;
const PADDLE_SNAP_PX = 120;
const shownPaddleY = new Map();
let lastPaintAt = 0;

function smoothPaddle(paddle, dtMs) {
  const key = paddle.playerId ?? `${paddle.team}-${paddle.lane ?? 'full'}`;
  const previous = shownPaddleY.get(key);
  const y = previous === undefined || Math.abs(paddle.y - previous) > PADDLE_SNAP_PX
    ? paddle.y
    : previous + (paddle.y - previous) * (1 - Math.exp(-dtMs / PADDLE_SMOOTHING_MS));
  shownPaddleY.set(key, y);
  return { ...paddle, y };
}

// One frame of the arena from a server snapshot. The match view and the
// spectator view both draw through here, so both look exactly the same.
export function drawPongFrame(canvas, snapshot, receivedAt, players, mode) {
  const context = canvas.getContext('2d');
  const now = performance.now();
  const dtMs = lastPaintAt ? Math.min(100, now - lastPaintAt) : 16;
  lastPaintAt = now;
  const world = projectPongWorld(snapshot, now - receivedAt);
  drawArena(context, mode);
  if (world) {
    world.paddles.map((paddle) => smoothPaddle(paddle, dtMs)).forEach((paddle) => drawPaddle(context, paddle, PLAYER_COLORS[paddle.team === 'left' ? 0 : 1], players));
    drawBall(context, world.ball);
  }
}

export const PONG_CANVAS_SIZE = [W, H];

function paint() {
  const canvas = document.querySelector('#pong-canvas');
  if (!canvas) return stopAnimation();
  drawPongFrame(canvas, latest, latestAt, match?.players ?? [], match?.mode);
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

function scoreOf(player) {
  return match.scores?.find((score) => score.playerId === player.id)?.score ?? 0;
}

function scoreboardHtml() {
  const side = (team) => {
    const players = match.players.filter((player) => (player.team ?? (player === match.players[0] ? 'left' : 'right')) === team);
    return {
      label: teamLabel(team),
      score: players.length ? scoreOf(players[0]) : 0,
      players: players.map((player) => ({ ...player, detail: match.mode === 'doubles' ? laneLabel(player) : '' })),
    };
  };
  return arcadeScoreboardHtml({ left: side('left'), right: side('right'), target: match.targetScore ?? targetScore, myId: myId() });
}

// Snapshots arrive every 30 ms; touching the DOM only on a real change keeps
// the animation frames free for the canvas.
function updateRoster() {
  const roster = document.querySelector('#pong-roster');
  if (!roster || !match) return;
  const html = scoreboardHtml();
  if (roster.dataset.html !== html) {
    roster.innerHTML = html;
    roster.dataset.html = html;
  }
}

function laneLabel(player) {
  const paddle = latest?.world?.paddles?.find((entry) => entry.playerId === player.id);
  const fallbackIndex = match.players.filter((entry) => entry.team === player.team).findIndex((entry) => entry.id === player.id);
  const lane = paddle?.lane ?? (fallbackIndex === 0 ? 'upper' : 'lower');
  return lane === 'upper' ? 'Oben' : 'Unten';
}

function resultHtml() {
  if (!match?.ended) return '';
  const winnerIds = new Set([...(match.winners ?? []).map((winner) => winner.id), match.winner?.id].filter(Boolean));
  const rows = [...match.players]
    .sort((a, b) => scoreOf(b) - scoreOf(a))
    .map((player) => ({
      player,
      place: null,
      winner: winnerIds.has(player.id) || (match.winnerTeam && player.team === match.winnerTeam),
      value: pointsLabel(scoreOf(player)),
      detail: match.mode === 'doubles' ? `${teamLabel(player.team)} · ${laneLabel(player)}` : '',
    }));
  rows.forEach((row, index) => { row.place = index > 0 && scoreOf(rows[index - 1].player) === scoreOf(row.player) ? rows[index - 1].place : index + 1; });
  return `<section class="card stack grouped-page-section" aria-labelledby="pong-result-title">
    <div class="grouped-page-section-title"><h2 id="pong-result-title">Ergebnis</h2>${rematch.actionHtml()}</div>
    ${arcadeResultListHtml(rows)}
  </section>`;
}

function pauseButtonHtml() {
  return match.paused
    ? '<button type="button" class="btn btn-primary btn-sm" id="pong-resume">Fortsetzen</button>'
    : '<button type="button" class="btn btn-sm" id="pong-pause">Pausieren</button>';
}

function matchControlsHtml(isHost) {
  if (!match) return '';
  if (match.ended) return arcadeMatchControlsHtml('<button type="button" class="btn btn-sm" id="pong-back">Schließen</button>');
  if (!isHost) {
    // A non-host player can't pause (shared timer state, host-only), but
    // must still have a way out instead of only a raw tab close.
    if (!match.players.some((p) => p.id === myId())) return '';
    return arcadeMatchControlsHtml('<button type="button" class="btn btn-sm" id="pong-leave-match">Verlassen</button>');
  }
  return arcadeMatchControlsHtml(`${pauseButtonHtml()}<button type="button" class="btn btn-sm" id="pong-finish">Beenden</button>`);
}
export function renderPong(container) {
  ensurePongSocket();
  if (!match) {
    // Lobbies live on the Arcade hub; a direct or expired match link goes there.
    window.dispatchEvent(new CustomEvent('respawn:navigate', { detail: 'arcade' }));
    return;
  }
  const isHost = match.host?.id === myId();
  container.innerHTML = `<div class="arcade-game-shell${match.ended ? ' is-ended' : ''}">
    ${arcadeGameHeaderHtml(match.mode === 'doubles' ? 'Pong Doppel' : 'Pong Duell', matchControlsHtml(isHost))}
    <div class="grouped-page-sections">
      ${resultHtml()}
      <section class="card arcade-stage">
        <div id="pong-roster">${scoreboardHtml()}</div>
        <div class="pong-arena" data-countdown-anchor><canvas id="pong-canvas" width="${W}" height="${H}"></canvas><div id="pong-point" class="pong-point" hidden></div>${match.paused ? '<div class="pong-overlay">Pause</div>' : ''}</div>
      </section>
    </div>
  </div>`;
  wireGame(container);
  wireArcadeToolbar(container);
  startAnimation();
}

function wireGame(container) {
  wireTouchControls(container.querySelector('#pong-canvas'));
  wirePauseControl(container);
  container.querySelector('#pong-finish')?.addEventListener('click', async () => {
    if (!(await confirmDialog('Match wirklich beenden?', { confirmText: 'Beenden', danger: true }))) return;
    await emitAck('pong:match:finish', { matchId: match.matchId, playerId: myId() });
  });
  container.querySelector('#pong-leave-match')?.addEventListener('click', async () => {
    if (!(await confirmDialog('Match wirklich verlassen?', { confirmText: 'Verlassen', danger: true }))) return;
    const result = await emitAck('pong:match:leave', { matchId: match.matchId, playerId: myId() });
    if (!result?.ok) showToast(result?.error || 'Verlassen fehlgeschlagen.', { error: true });
  });
  rematch.wire(container);
  container.querySelector('#pong-back')?.addEventListener('click', async () => {
    await rematch.close();
    match = null;
    latest = null;
    trail.length = 0;
    stopAnimation();
    navigate('arcade');
  });
}

function wirePauseControl(container) {
  container.querySelector('#pong-pause')?.addEventListener('click', async () => {
    const result = await emitAck('pong:match:pause', { matchId: match.matchId, playerId: myId() });
    if (!result?.ok) showToast(result?.error || 'Pausieren fehlgeschlagen.', { error: true });
  });
  container.querySelector('#pong-resume')?.addEventListener('click', async () => {
    const result = await emitAck('pong:match:resume', { matchId: match.matchId, playerId: myId() });
    if (!result?.ok) showToast(result?.error || 'Fortsetzen fehlgeschlagen.', { error: true });
  });
}

function updatePauseUi() {
  const arena = document.querySelector('.pong-arena');
  if (!arena) return;
  arena.querySelector('.pong-overlay')?.remove();
  if (match?.paused) arena.insertAdjacentHTML('beforeend', '<div class="pong-overlay">Pause</div>');
  const button = document.querySelector('#pong-pause, #pong-resume');
  if (!button) return;
  button.outerHTML = pauseButtonHtml();
  wirePauseControl(document);
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
