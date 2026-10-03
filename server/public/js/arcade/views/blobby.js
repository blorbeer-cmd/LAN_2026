import { connectSocket } from '../../socket.js';
import { showToast } from '../../toast.js';
import { getMyId } from '../../whoami.js';
import { showCountdown, cancelCountdown } from '../countdown.js';
import { confirmDialog } from '../../modal.js';
import { arcadeLobbyEntryHtml, arcadeLobbyHostActionsHtml, arcadeLobbyGuestActionsHtml, arcadeLobbyJoinHtml, arcadeTeamMembersHtml, readyToggleHtml, wireReadyToggle } from '../lobbyReady.js';
import { arcadeGameHeaderHtml, arcadeMatchControlsHtml, arcadeResultListHtml, pointsLabel, arcadeScoreboardHtml, wireArcadeToolbar } from '../arcadeUi.js';
import { createRematchController } from '../rematch.js';
import { playArcadeSound } from '../arcadeSound.js';

const W = 1000;
const H = 600;
const cssColor = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const GROUND = 550;
const NET_X = 500;
const NET_TOP = 365;
const BALL_RADIUS = 24;

let socket = null;
let lobbies = [];
let match = null;
let previous = null;
let latest = null;
let latestAt = 0;
let animation = null;
let keys = { left: false, right: false };
let keyboardBound = false;
const avatarImages = new Map();
const courtBackground = new Image();
courtBackground.src = '/img/blobby-beach-court.png';
let targetScore = 7;
let lobbyMode = 'duel';
const myId = () => getMyId();
const rerender = () => window.dispatchEvent(new CustomEvent('respawn:rerender'));
const navigate = (view) => window.dispatchEvent(new CustomEvent('respawn:navigate', { detail: view }));
const emitAck = (event, payload) => new Promise((resolve) => socket.emit(event, payload, resolve));
const currentView = () => document.getElementById('view-container')?.dataset.view;
const rematch = createRematchController({
  prefix: 'blobby',
  emit: (event, payload) => emitAck(event, payload),
  myId: () => getMyId(),
  lobbies: () => lobbies,
  events: { create: 'blobby:lobby:create', bot: 'blobby:lobby:bot', join: 'blobby:lobby:join', ready: 'blobby:lobby:ready', start: 'blobby:lobby:start', leave: 'blobby:lobby:leave' },
  startPayload: () => ({ targetScore: match?.targetScore ?? targetScore }),
  joinPayload: () => ({ team: 'auto' }),
  playerName: (id) => match?.players.find((player) => player.id === id)?.name ?? 'Spieler',
  rerender: () => rerender(),
  onError: (message) => showToast(message, { error: true }),
});

export function myBlobbyLobby() {
  return lobbies.find((l) => l.players.some((p) => p.id === myId())) ?? null;
}
export function hasBlobbyMatch() { return Boolean(match); }
export function blobbyLobbies() { return lobbies; }

export function ensureBlobbySocket() {
  if (socket) return socket;
  socket = connectSocket();
  socket.on('blobby:lobbies', (payload) => {
    lobbies = payload?.lobbies ?? [];
    if (!match && currentView() === 'arcade') rerender();
    if (match?.ended && currentView() === 'blobby') {
      rematch.onLobbies();
      rerender();
    }
  });
  socket.on('blobby:match:start', (payload) => {
    match = { ...payload, ended: false, winner: null };
    rematch.reset();
    previous = latest = null;
    navigate('blobby');
    // Let the dedicated game view mount first. This keeps the global overlay
    // reliably above the canvas even when the socket event lands mid-render.
    requestAnimationFrame(() => showCountdown(payload.beginsAt));
  });
  socket.on('blobby:state', (payload) => {
    if (latest?.world?.ball && payload?.world?.ball && latest.world.ball.vx * payload.world.ball.vx < 0) {
      playArcadeSound('blobby-hit');
    }
    previous = latest;
    latest = payload;
    latestAt = performance.now();
    if (match) { match.running = payload.running; match.paused = payload.paused; match.scores = payload.scores; }
    updateScoreDisplay();
    if (!document.querySelector('#blobby-canvas') && currentView() === 'arcade') rerender();
  });
  socket.on('blobby:point', (payload) => {
    if (match) match.scores = payload.scores;
    updateScoreDisplay();
    flashPoint(payload.scorer?.name);
    playArcadeSound('blobby-score');
  });
  socket.on('blobby:match:paused', () => { if (match) { match.paused = true; if (currentView() === 'blobby') updatePauseUi(); } });
  socket.on('blobby:match:resumed', () => { if (match) { match.paused = false; if (currentView() === 'blobby') updatePauseUi(); } });
  socket.on('blobby:match:end', (payload) => {
    if (!match) return;
    match.ended = true;
    match.running = false;
    match.winner = payload.winner ?? null;
    match.winners = payload.winners ?? [];
    match.winnerTeam = payload.winnerTeam ?? null;
    match.scores = payload.scores ?? [];
    rematch.capture(match);
    cancelCountdown();
    if (match.winners?.length) playArcadeSound(match.winners.some((winner) => winner.id === myId()) ? 'blobby-win' : 'blobby-lose');
    window.dispatchEvent(new CustomEvent('respawn:arcade-stats-dirty'));
    stopAnimation();
    if (currentView() === 'blobby' || currentView() === 'arcade') rerender();
  });
  bindKeyboard();
  return socket;
}

function sendInput(jump = false) {
  if (!socket || !match?.matchId || match.ended) return;
  socket.emit('blobby:input', { matchId: match.matchId, playerId: myId(), input: { ...keys, jump } });
}
function bindKeyboard() {
  if (keyboardBound) return;
  keyboardBound = true;
  window.addEventListener('keydown', (e) => {
    if (!document.querySelector('#blobby-canvas')) return;
    if (e.key === 'ArrowLeft' || e.key.toLowerCase() === 'a') keys.left = true;
    else if (e.key === 'ArrowRight' || e.key.toLowerCase() === 'd') keys.right = true;
    else if ((e.key === 'ArrowUp' || e.key === ' ') && !e.repeat) sendInput(true);
    else return;
    e.preventDefault(); sendInput(false);
  });
  window.addEventListener('keyup', (e) => {
    if (e.key === 'ArrowLeft' || e.key.toLowerCase() === 'a') keys.left = false;
    else if (e.key === 'ArrowRight' || e.key.toLowerCase() === 'd') keys.right = false;
    else return;
    sendInput(false);
  });
}

function modeLabel(mode) {
  return mode === 'doubles' ? 'Doppel' : 'Duell';
}
function teamLabel(team) {
  return team === 'left' ? 'Team Blau' : 'Team Pink';
}
function startReason(lobby) {
  const missing = lobby.playerLimit - lobby.players.length;
  if (missing > 0) return `${missing} ${missing === 1 ? 'Platz' : 'Plätze'} frei`;
  const waiting = lobby.players.filter((player) => player.id !== lobby.host.id && !player.ready).length;
  return waiting > 0 ? `${waiting} nicht bereit` : '';
}
function lobbyEntryHtml(lobby) {
  const isHost = lobby.host.id === myId();
  const joined = lobby.players.some((player) => player.id === myId());
  const full = lobby.players.length >= lobby.playerLimit && !joined;
  const ready = lobby.players.length === lobby.playerLimit && lobby.players.every((player) => player.id === lobby.host.id || player.ready);
  const settingsHtml = isHost
    ? `<label class="arcade-lobby-target-score">
        <span>Punkte bis Sieg</span>
        <select name="blobby-target" aria-label="Punkte bis Sieg">
          ${[5, 7, 10, 15].map((score) => `<option value="${score}" ${score === targetScore ? 'selected' : ''}>${score}</option>`).join('')}
        </select>
      </label>`
    : '';
  const footerActions = isHost
    ? arcadeLobbyHostActionsHtml({ startAttrs: 'id="blobby-start"', startEnabled: ready, startHint: startReason(lobby), closeAttrs: `data-blobby-close="${lobby.id}"` })
    : joined
      ? arcadeLobbyGuestActionsHtml({ readyHtml: readyToggleHtml(lobby, myId(), 'blobby-ready'), leaveAttrs: `data-blobby-leave="${lobby.id}"` })
      : '';
  const joinAction = !joined ? arcadeLobbyJoinHtml(`data-blobby-join="${lobby.id}" data-blobby-team="auto"`, full) : '';
  const meta = `${modeLabel(lobby.mode)} · ${lobby.players.length}/${lobby.playerLimit}`;
  const membersHtml = lobby.mode === 'doubles' ? arcadeTeamMembersHtml(lobby, 2) : '';
  return arcadeLobbyEntryHtml(lobby, { gameType: 'blobby', meta, joinAction, settingsHtml, footerActions, full, capacity: lobby.playerLimit, membersHtml });
}

export function renderBlobbyLobbyEntries() {
  return lobbies.map((lobby) => ({ id: lobby.id, html: lobbyEntryHtml(lobby) }));
}

export async function createBlobbyLobby({ mode = 'duel', opponent = 'human' } = {}) {
  lobbyMode = mode === 'doubles' ? 'doubles' : 'duel';
  const bot = opponent === 'bot';
  const result = await emitAck(bot ? 'blobby:lobby:bot' : 'blobby:lobby:create', { playerId: myId(), mode: lobbyMode });
  if (!result?.ok) showToast(result?.error || 'Lobby konnte nicht erstellt werden.', { error: true });
  return result;
}

export async function leaveMyBlobbyLobby() {
  const lobby = myBlobbyLobby();
  if (!lobby) return { ok: true };
  return emitAck('blobby:lobby:leave', { lobbyId: lobby.id, playerId: myId() });
}

export function wireBlobbyLobbyCard(container, { beforeJoin } = {}) {
  container.querySelectorAll('select[name="blobby-target"]').forEach((input) => input.addEventListener('change', () => { targetScore = Number(input.value); }));
  container.querySelectorAll('[data-blobby-join]').forEach((b) => b.addEventListener('click', async () => {
    if (beforeJoin && !(await beforeJoin())) return;
    const res = await emitAck('blobby:lobby:join', { lobbyId: b.dataset.blobbyJoin, playerId: myId(), team: b.dataset.blobbyTeam || 'auto' });
    if (!res?.ok) showToast(res?.error || 'Beitritt fehlgeschlagen.', { error: true });
  }));
  for (const [selector, attr] of [['[data-blobby-close]', 'blobbyClose'], ['[data-blobby-leave]', 'blobbyLeave']]) {
    container.querySelectorAll(selector).forEach((b) => b.addEventListener('click', () => emitAck('blobby:lobby:leave', { lobbyId: b.dataset[attr], playerId: myId() })));
  }
  wireReadyToggle(container, 'blobby-ready', async (lobbyId, ready) => {
    const res = await emitAck('blobby:lobby:ready', { lobbyId, playerId: myId(), ready });
    if (!res?.ok) showToast(res?.error || 'Bereit-Status konnte nicht gesetzt werden.', { error: true });
  });
  container.querySelector('#blobby-start')?.addEventListener('click', async () => {
    const lobby = myBlobbyLobby();
    const res = await emitAck('blobby:lobby:start', { lobbyId: lobby?.id, playerId: myId(), targetScore });
    if (!res?.ok) showToast(res?.error || 'Start fehlgeschlagen.', { error: true });
  });
}

function lerp(a, b, t) { return a + (b - a) * t; }
function interpolatedWorld(current = latest, before = previous, receivedAt = latestAt) {
  if (!current?.world) return null;
  if (!before?.world) return current.world;
  const t = Math.min(1, (performance.now() - receivedAt + 50) / 100);
  return {
    ball: { x: lerp(before.world.ball.x, current.world.ball.x, t), y: lerp(before.world.ball.y, current.world.ball.y, t) },
    blobs: current.world.blobs.map((b, i) => ({ x: lerp(before.world.blobs[i]?.x ?? b.x, b.x, t), y: lerp(before.world.blobs[i]?.y ?? b.y, b.y, t), side: b.side })),
  };
}
function avatarImage(player) {
  if (!player?.avatar) return null;
  if (!avatarImages.has(player.id)) {
    const image = new Image();
    image.src = player.avatar;
    avatarImages.set(player.id, image);
  }
  const image = avatarImages.get(player.id);
  return image?.complete ? image : null;
}
function drawBlob(ctx, blob, color, player) {
  const image = avatarImage(player);
  if (image) {
    ctx.save();
    ctx.beginPath(); ctx.arc(blob.x, blob.y, 44, 0, Math.PI * 2); ctx.clip();
    ctx.drawImage(image, blob.x - 44, blob.y - 44, 88, 88);
    ctx.restore();
    ctx.strokeStyle = color; ctx.lineWidth = 5; ctx.beginPath(); ctx.arc(blob.x, blob.y, 44, 0, Math.PI * 2); ctx.stroke();
  } else {
    ctx.fillStyle = player?.color || color;
    ctx.beginPath(); ctx.arc(blob.x, blob.y, 44, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = color; ctx.lineWidth = 5; ctx.stroke();
    ctx.fillStyle = '#fff'; ctx.font = '700 32px system-ui'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText((player?.name || '?').slice(0, 1).toUpperCase(), blob.x, blob.y + 1);
  }
}

function drawVolleyball(ctx, ball) {
  const { x, y } = ball;
  const r = BALL_RADIUS;
  ctx.save();
  ctx.shadowColor = 'rgba(9, 28, 58, 0.34)';
  ctx.shadowBlur = 8;
  ctx.shadowOffsetY = 3;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  const fill = ctx.createRadialGradient(x - r * 0.35, y - r * 0.45, r * 0.12, x, y, r);
  fill.addColorStop(0, '#fffdf4');
  fill.addColorStop(0.68, '#f2e8c9');
  fill.addColorStop(1, '#d8c68c');
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.shadowColor = 'transparent';
  ctx.clip();

  // Variant 1: an off-white ball with understated purple/blue seams that
  // picks up the Respawn palette without fighting the beach background.
  ctx.strokeStyle = '#9163f5';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(x - r * 0.78, y + r * 0.06, r * 1.04, -0.92, 0.9);
  ctx.stroke();

  ctx.strokeStyle = '#5b8cff';
  ctx.beginPath();
  ctx.arc(x + r * 0.76, y - r * 0.16, r * 1.06, 2.22, 4.04);
  ctx.arc(x - r * 0.08, y + r * 0.88, r * 1.08, 3.72, 5.66);
  ctx.stroke();
  ctx.restore();

  ctx.strokeStyle = '#6f57c6';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.stroke();
}

// One frame of the court from two server snapshots. The match view and the
// spectator view both draw through here, so both look exactly the same.
export function drawBlobbyFrame(canvas, current, before, receivedAt, players) {
  const ctx = canvas.getContext('2d'); const world = interpolatedWorld(current, before, receivedAt);
  ctx.clearRect(0, 0, W, H);
  if (courtBackground.complete && courtBackground.naturalWidth) {
    ctx.drawImage(courtBackground, 0, 0, W, H);
  } else {
    const sky = ctx.createLinearGradient(0, 0, 0, H); sky.addColorStop(0, '#17203a'); sky.addColorStop(1, '#252f50'); ctx.fillStyle = sky; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#36415f'; ctx.fillRect(0, GROUND, W, H - GROUND);
  }
  ctx.fillStyle = '#dbe4ff'; ctx.fillRect(NET_X - 10, NET_TOP, 20, GROUND - NET_TOP); ctx.beginPath(); ctx.arc(NET_X, NET_TOP, 10, 0, Math.PI * 2); ctx.fill();
  if (world) {
    world.blobs.forEach((blob, index) => {
      drawBlob(ctx, blob, cssColor(blob.side === 'right' ? '--accent-3' : '--accent'), players?.[index]);
    });
    drawVolleyball(ctx, world.ball);
  }
}

export const BLOBBY_CANVAS_SIZE = [W, H];

function paint() {
  const canvas = document.querySelector('#blobby-canvas');
  if (!canvas) return stopAnimation();
  drawBlobbyFrame(canvas, latest, previous, latestAt, match?.players);
  animation = requestAnimationFrame(paint);
}
function startAnimation() { if (!animation) animation = requestAnimationFrame(paint); }
function stopAnimation() { if (animation) cancelAnimationFrame(animation); animation = null; }
function flashPoint(name) {
  const el = document.querySelector('#blobby-point'); if (!el) return;
  el.textContent = `Punkt für ${name || 'Spieler'}!`; el.hidden = false; setTimeout(() => { el.hidden = true; }, 900);
}
function scoreOf(player) {
  return (match?.scores ?? latest?.scores ?? []).find((s) => s.playerId === player.id)?.score ?? 0;
}

function scoreboardHtml() {
  const side = (team) => {
    const players = match.players.filter((player) => player.team === team);
    return { label: teamLabel(team), score: players.length ? scoreOf(players[0]) : 0, players };
  };
  return arcadeScoreboardHtml({ left: side('left'), right: side('right'), target: match.targetScore ?? latest?.targetScore ?? targetScore, myId: myId() });
}

function updateScoreDisplay() {
  const roster = document.querySelector('#blobby-roster');
  if (!roster || !match) return;
  const html = scoreboardHtml();
  if (roster.dataset.html !== html) {
    roster.innerHTML = html;
    roster.dataset.html = html;
  }
}

function resultHtml() {
  if (!match?.ended) return '';
  const winnerIds = new Set((match.winners ?? []).map((winner) => winner.id));
  const rows = [...match.players]
    .sort((a, b) => scoreOf(b) - scoreOf(a))
    .map((player) => ({
      player,
      winner: winnerIds.has(player.id) || (match.winnerTeam && player.team === match.winnerTeam),
      value: pointsLabel(scoreOf(player)),
      detail: match.mode === 'doubles' ? teamLabel(player.team) : '',
    }));
  rows.forEach((row, index) => { row.place = index > 0 && scoreOf(rows[index - 1].player) === scoreOf(row.player) ? rows[index - 1].place : index + 1; });
  return `<section class="card stack grouped-page-section" aria-labelledby="blobby-result-title">
    <div class="grouped-page-section-title"><h2 id="blobby-result-title">Ergebnis</h2>${rematch.actionHtml()}</div>
    ${arcadeResultListHtml(rows)}
  </section>`;
}

function pauseButtonHtml() {
  return match.paused
    ? '<button type="button" class="btn btn-primary btn-sm" id="blobby-resume">Fortsetzen</button>'
    : '<button type="button" class="btn btn-sm" id="blobby-pause">Pausieren</button>';
}

function matchControlsHtml(host) {
  if (!match) return '';
  if (match.ended) return arcadeMatchControlsHtml('<button type="button" class="btn btn-sm" id="blobby-back">Schließen</button>');
  if (!host) {
    // A non-host player can't pause (shared timer state, host-only), but
    // must still have a way out instead of only a raw tab close.
    if (!match.players.some((p) => p.id === myId())) return '';
    return arcadeMatchControlsHtml('<button type="button" class="btn btn-sm" id="blobby-leave-match">Verlassen</button>');
  }
  return arcadeMatchControlsHtml(`${pauseButtonHtml()}<button type="button" class="btn btn-sm" id="blobby-finish">Beenden</button>`);
}
export function renderBlobby(container) {
  ensureBlobbySocket();
  if (!match) {
    // Lobbies live on the Arcade hub; a direct or expired match link goes there.
    window.dispatchEvent(new CustomEvent('respawn:navigate', { detail: 'arcade' }));
    return;
  }
  const host = match.host?.id === myId();
  container.innerHTML = `<div class="arcade-game-shell${match.ended ? ' is-ended' : ''}">
    ${arcadeGameHeaderHtml(match.mode === 'doubles' ? 'Blobby Volley Doppel' : 'Blobby Volley', matchControlsHtml(host))}
    <div class="grouped-page-sections">
      ${resultHtml()}
      <section class="card arcade-stage">
        <div id="blobby-roster">${scoreboardHtml()}</div>
        <div class="blobby-court" data-countdown-anchor><canvas id="blobby-canvas" width="${W}" height="${H}"></canvas><div id="blobby-point" class="blobby-point" hidden></div>${match.paused ? '<div class="blobby-pause-overlay">Pause</div>' : ''}</div>
      </section>
    </div>
  </div>`;
  wireGame(container); wireArcadeToolbar(container); startAnimation();
}
function wireGame(container) {
  wireCanvasControls(container.querySelector('#blobby-canvas'));
  wirePauseControl(container);
  container.querySelector('#blobby-finish')?.addEventListener('click', async () => {
    if (!(await confirmDialog('Match wirklich beenden?', { confirmText: 'Beenden', danger: true }))) return;
    await emitAck('blobby:match:finish', { matchId: match.matchId, playerId: myId() });
  });
  container.querySelector('#blobby-leave-match')?.addEventListener('click', async () => {
    if (!(await confirmDialog('Match wirklich verlassen?', { confirmText: 'Verlassen', danger: true }))) return;
    const res = await emitAck('blobby:match:leave', { matchId: match.matchId, playerId: myId() });
    if (!res?.ok) showToast(res?.error || 'Verlassen fehlgeschlagen.', { error: true });
  });
  rematch.wire(container);
  container.querySelector('#blobby-back')?.addEventListener('click', async () => {
    await rematch.close();
    match = null;
    previous = latest = null;
    stopAnimation();
    navigate('arcade');
  });
}

function wirePauseControl(container) {
  container.querySelector('#blobby-pause')?.addEventListener('click', async () => {
    const res = await emitAck('blobby:match:pause', { matchId: match.matchId, playerId: myId() });
    if (!res?.ok) showToast(res?.error || 'Pausieren fehlgeschlagen.', { error: true });
  });
  container.querySelector('#blobby-resume')?.addEventListener('click', async () => {
    const res = await emitAck('blobby:match:resume', { matchId: match.matchId, playerId: myId() });
    if (!res?.ok) showToast(res?.error || 'Fortsetzen fehlgeschlagen.', { error: true });
  });
}

function updatePauseUi() {
  const court = document.querySelector('.blobby-court');
  if (!court) return;
  court.querySelector('.blobby-pause-overlay')?.remove();
  if (match?.paused) court.insertAdjacentHTML('beforeend', '<div class="blobby-pause-overlay">Pause</div>');
  const button = document.querySelector('#blobby-pause, #blobby-resume');
  if (!button) return;
  button.outerHTML = pauseButtonHtml();
  wirePauseControl(document);
}
function wireCanvasControls(canvas) {
  if (!canvas) return;
  let startX = 0; let startY = 0; let moving = false;
  canvas.addEventListener('pointerdown', (e) => {
    e.preventDefault(); startX = e.clientX; startY = e.clientY; moving = false; canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!canvas.hasPointerCapture(e.pointerId)) return;
    const dx = e.clientX - startX;
    if (Math.abs(dx) < 18) return;
    moving = true; keys.left = dx < 0; keys.right = dx > 0; sendInput(false);
  });
  const finish = (e) => {
    if (!canvas.hasPointerCapture(e.pointerId)) return;
    const dy = e.clientY - startY;
    keys.left = false; keys.right = false; sendInput(false);
    if (!moving || dy < -24) sendInput(true);
    canvas.releasePointerCapture(e.pointerId);
  };
  canvas.addEventListener('pointerup', finish);
  canvas.addEventListener('pointercancel', finish);
}
