import { getToken } from '../api.js';
import { showToast } from '../toast.js';
import { getMyId } from '../whoami.js';
import { currentPlayerMayUseArcadeAi } from './arcadeAdmin.js';
import { showCountdown, cancelCountdown } from '../countdown.js';
import { confirmDialog } from '../modal.js';
import { allLobbyReady, arcadeLobbyEntryHtml, readyToggleHtml, wireReadyToggle } from '../lobbyReady.js';
import { arcadeExpandControlHtml, arcadeLobbyTitleHtml, matchRosterHtml, wireArcadeExpandControl } from './arcadeUi.js';

const W = 1000;
const H = 600;
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

const myId = () => getMyId();
const rerender = () => window.dispatchEvent(new CustomEvent('respawn:rerender'));
const navigate = (view) => window.dispatchEvent(new CustomEvent('respawn:navigate', { detail: view }));
const emitAck = (event, payload) => new Promise((resolve) => socket.emit(event, payload, resolve));
const currentView = () => document.getElementById('view-container')?.dataset.view;

export function myBlobbyLobby() {
  return lobbies.find((l) => l.players.some((p) => p.id === myId())) ?? null;
}
export function hasBlobbyMatch() { return Boolean(match); }
export function blobbyLobbies() { return lobbies; }

export function ensureBlobbySocket() {
  if (socket) return socket;
  socket = io({ auth: { token: getToken() } });
  socket.on('blobby:lobbies', (payload) => { lobbies = payload?.lobbies ?? []; if (!match && currentView() === 'arcade') rerender(); });
  socket.on('blobby:match:start', (payload) => {
    match = { ...payload, ended: false, winner: null };
    previous = latest = null;
    navigate('blobby');
    // Let the dedicated game view mount first. This keeps the global overlay
    // reliably above the canvas even when the socket event lands mid-render.
    requestAnimationFrame(() => showCountdown(payload.beginsAt));
  });
  socket.on('blobby:state', (payload) => {
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
  });
  socket.on('blobby:match:paused', () => { if (match) { match.paused = true; if (currentView() === 'blobby') rerender(); } });
  socket.on('blobby:match:resumed', () => { if (match) { match.paused = false; if (currentView() === 'blobby') rerender(); } });
  socket.on('blobby:match:end', (payload) => {
    if (!match) return;
    match.ended = true; match.running = false; match.winner = payload.winner ?? null; match.scores = payload.scores ?? [];
    cancelCountdown();
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

function lobbyList() {
  if (!lobbies.length) return '<div class="empty-state" style="padding:var(--space-4);">Keine offene Blobby-Volley-Lobby.</div>';
  return lobbies.map((l) => {
    const isHost = l.host.id === myId();
    const joined = l.players.some((p) => p.id === myId());
    const full = l.players.length >= 2 && !joined;
    const footerActions = isHost
      ? `<button type="button" class="btn btn-sm btn-equal btn-danger" data-blobby-close="${l.id}">Schließen</button>`
      : joined
        ? `${readyToggleHtml(l, myId(), 'blobby-ready')}
          <button type="button" class="btn btn-sm btn-equal" data-blobby-leave="${l.id}">Verlassen</button>`
        : '';
    const joinAction = !joined && !isHost
      ? `<button type="button" class="btn btn-sm btn-equal btn-primary" data-blobby-join="${l.id}" ${full ? 'disabled' : ''}>Beitreten</button>`
      : '';
    return arcadeLobbyEntryHtml(l, { playerLimit: 2, joinAction, footerActions, full });
  }).join('');
}
function hostStart() {
  const lobby = myBlobbyLobby();
  if (!lobby || lobby.host.id !== myId()) return '';
  const ready = lobby.players.length === 2;
  const hint = !ready ? 'Warte auf einen Gegner…' : allLobbyReady(lobby) ? 'Gegner ist bereit.' : 'Gegner ist da — noch nicht bereit.';
  return `<div class="stack" style="gap:var(--space-2);border-top:1px solid var(--border);padding-top:var(--space-3);">
    <div class="field-label">Punkte bis Sieg</div>
    <div class="row" style="gap:var(--space-2);flex-wrap:wrap;">
      ${[5, 7, 10, 15].map((n) => `<label class="check-row" style="padding:var(--space-2) var(--space-3);"><input type="radio" name="blobby-target" value="${n}" ${n === targetScore ? 'checked' : ''} />${n}</label>`).join('')}
    </div>
    <div class="muted" style="font-size:var(--font-size-xs);">${hint}</div>
    <button type="button" class="btn btn-primary btn-block" id="blobby-start" ${ready ? '' : 'disabled'}>Start</button>
  </div>`;
}
export function renderBlobbyLobbyCard() {
  const lobby = myBlobbyLobby(); const noMe = !myId();
  return `<div class="card stack arcade-lobby-card"><div class="row-between arcade-lobby-header" style="gap:var(--space-3);">${arcadeLobbyTitleHtml('blobby', 'Lobby', [
      { label: 'Ziel', text: 'Erreiche zuerst die Punktzahl.' },
      { label: 'Steuerung', text: 'Pfeiltasten.' },
    ])}
    <div class="row" style="gap:var(--space-2);">${currentPlayerMayUseArcadeAi() ? `<button type="button" class="btn btn-sm btn-equal" id="blobby-bot" ${match || noMe ? 'disabled' : ''}>Gegen KI</button>` : ''}<button type="button" class="btn btn-primary btn-sm btn-equal" id="blobby-create" ${match || noMe ? 'disabled' : ''}>Lobby öffnen</button></div></div>
    ${noMe ? '<div class="muted" style="font-size:var(--font-size-xs);">Wähle oben zuerst aus, wer du bist.</div>' : ''}${lobbyList()}${hostStart()}</div>`;
}
export async function leaveMyBlobbyLobby() {
  const lobby = myBlobbyLobby();
  if (!lobby) return { ok: true };
  return emitAck('blobby:lobby:leave', { lobbyId: lobby.id, playerId: myId() });
}

export function wireBlobbyLobbyCard(container, { beforeCreate, beforeJoin } = {}) {
  container.querySelectorAll('input[name="blobby-target"]').forEach((input) => input.addEventListener('change', () => { targetScore = Number(input.value); }));
  container.querySelector('#blobby-create')?.addEventListener('click', async () => {
    if (beforeCreate && !(await beforeCreate())) return;
    const res = await emitAck('blobby:lobby:create', { playerId: myId() });
    if (!res?.ok) showToast(res?.error || 'Lobby konnte nicht erstellt werden.', { error: true });
  });
  container.querySelector('#blobby-bot')?.addEventListener('click', async () => {
    if (beforeCreate && !(await beforeCreate())) return;
    const res = await emitAck('blobby:lobby:bot', { playerId: myId() });
    if (!res?.ok) showToast(res?.error || 'KI-Lobby konnte nicht erstellt werden.', { error: true });
  });
  container.querySelectorAll('[data-blobby-join]').forEach((b) => b.addEventListener('click', async () => {
    if (beforeJoin && !(await beforeJoin())) return;
    const res = await emitAck('blobby:lobby:join', { lobbyId: b.dataset.blobbyJoin, playerId: myId() });
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
function interpolatedWorld() {
  if (!latest?.world) return null;
  if (!previous?.world) return latest.world;
  const t = Math.min(1, (performance.now() - latestAt + 50) / 100);
  return {
    ball: { x: lerp(previous.world.ball.x, latest.world.ball.x, t), y: lerp(previous.world.ball.y, latest.world.ball.y, t) },
    blobs: latest.world.blobs.map((b, i) => ({ x: lerp(previous.world.blobs[i].x, b.x, t), y: lerp(previous.world.blobs[i].y, b.y, t), side: b.side })),
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
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 4; ctx.beginPath(); ctx.arc(blob.x, blob.y, 44, 0, Math.PI * 2); ctx.stroke();
  } else {
    ctx.fillStyle = player?.color || color;
    ctx.beginPath(); ctx.arc(blob.x, blob.y, 44, 0, Math.PI * 2); ctx.fill();
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

function paint() {
  const canvas = document.querySelector('#blobby-canvas');
  if (!canvas) return stopAnimation();
  const ctx = canvas.getContext('2d'); const world = interpolatedWorld();
  ctx.clearRect(0, 0, W, H);
  if (courtBackground.complete && courtBackground.naturalWidth) {
    ctx.drawImage(courtBackground, 0, 0, W, H);
  } else {
    const sky = ctx.createLinearGradient(0, 0, 0, H); sky.addColorStop(0, '#17203a'); sky.addColorStop(1, '#252f50'); ctx.fillStyle = sky; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#36415f'; ctx.fillRect(0, GROUND, W, H - GROUND);
  }
  ctx.fillStyle = '#dbe4ff'; ctx.fillRect(NET_X - 10, NET_TOP, 20, GROUND - NET_TOP); ctx.beginPath(); ctx.arc(NET_X, NET_TOP, 10, 0, Math.PI * 2); ctx.fill();
  if (world) {
    drawBlob(ctx, world.blobs[0], '#5b8cff', match?.players?.[0]); drawBlob(ctx, world.blobs[1], '#c24bd8', match?.players?.[1]);
    drawVolleyball(ctx, world.ball);
  }
  animation = requestAnimationFrame(paint);
}
function startAnimation() { if (!animation) animation = requestAnimationFrame(paint); }
function stopAnimation() { if (animation) cancelAnimationFrame(animation); animation = null; }
function flashPoint(name) {
  const el = document.querySelector('#blobby-point'); if (!el) return;
  el.textContent = `Punkt für ${name || 'Spieler'}!`; el.hidden = false; setTimeout(() => { el.hidden = true; }, 900);
}
function updateScoreDisplay() {
  const roster = document.querySelector('#blobby-roster');
  if (!roster || !match) return;
  roster.innerHTML = matchRosterHtml(match.players, {
    winnerId: match.winner?.id ?? null,
    scoreFor: (player) => {
      const score = (match?.scores ?? latest?.scores ?? []).find((s) => s.playerId === player.id)?.score ?? 0;
      return `${score}/${match?.targetScore ?? latest?.targetScore ?? targetScore}`;
    },
  });
}
function resultHtml() {
  if (!match?.ended) return '';
  return `<div class="card arcade-winner-card"><strong>Match beendet</strong><button class="btn btn-primary" id="blobby-back">Zur Arcade</button></div>`;
}
function matchControlsHtml(host) {
  if (!match || match.ended) return '';
  if (!host) {
    // A non-host player can't pause (shared timer state, host-only), but
    // must still have a way out instead of only a raw tab close.
    if (!match.players.some((p) => p.id === myId())) return '';
    return `<div class="arcade-match-controls"><button class="btn btn-sm btn-equal btn-danger" id="blobby-leave-match">Verlassen</button></div>`;
  }
  return `<div class="arcade-match-controls">${match.paused ? '<button class="btn btn-sm btn-equal btn-primary" id="blobby-resume">Fortsetzen</button>' : '<button class="btn btn-sm btn-equal" id="blobby-pause">Pausieren</button>'}<button class="btn btn-sm btn-equal btn-danger" id="blobby-finish">Beenden</button></div>`;
}
export function renderBlobby(container) {
  ensureBlobbySocket();
  if (!match) { container.innerHTML = '<button class="btn btn-sm" data-navigate="arcade">‹ Arcade</button><div class="empty-state">Kein laufendes Blobby-Volley-Match.</div>'; return; }
  const host = match.host?.id === myId();
  const roster = matchRosterHtml(match.players, {
    winnerId: match.winner?.id ?? null,
    scoreFor: (player) => {
      const score = (match?.scores ?? latest?.scores ?? []).find((s) => s.playerId === player.id)?.score ?? 0;
      return `${score}/${match?.targetScore ?? latest?.targetScore ?? targetScore}`;
    },
  });
  container.innerHTML = `<div class="arcade-game-shell"><h1 class="view-title">Blobby Volley</h1>${arcadeExpandControlHtml()}<div id="blobby-roster">${roster}</div>
    <div class="blobby-court"><canvas id="blobby-canvas" width="${W}" height="${H}"></canvas><div id="blobby-point" class="blobby-point" hidden></div>${match.paused ? '<div class="blobby-pause-overlay">Pause</div>' : ''}</div>
    ${matchControlsHtml(host)}${resultHtml()}</div>`;
  wireGame(container); wireArcadeExpandControl(container); startAnimation();
}
function wireGame(container) {
  wireCanvasControls(container.querySelector('#blobby-canvas'));
  container.querySelector('#blobby-pause')?.addEventListener('click', async () => {
    const res = await emitAck('blobby:match:pause', { matchId: match.matchId, playerId: myId() });
    if (!res?.ok) showToast(res?.error || 'Pausieren fehlgeschlagen.', { error: true });
  });
  container.querySelector('#blobby-resume')?.addEventListener('click', async () => {
    const res = await emitAck('blobby:match:resume', { matchId: match.matchId, playerId: myId() });
    if (!res?.ok) showToast(res?.error || 'Fortsetzen fehlgeschlagen.', { error: true });
  });
  container.querySelector('#blobby-finish')?.addEventListener('click', async () => {
    if (!(await confirmDialog('Match wirklich beenden?', { confirmText: 'Beenden', danger: true }))) return;
    await emitAck('blobby:match:finish', { matchId: match.matchId, playerId: myId() });
  });
  container.querySelector('#blobby-leave-match')?.addEventListener('click', async () => {
    if (!(await confirmDialog('Match wirklich verlassen?', { confirmText: 'Verlassen', danger: true }))) return;
    const res = await emitAck('blobby:match:leave', { matchId: match.matchId, playerId: myId() });
    if (!res?.ok) showToast(res?.error || 'Verlassen fehlgeschlagen.', { error: true });
  });
  container.querySelector('#blobby-back')?.addEventListener('click', () => { match = null; previous = latest = null; stopAnimation(); navigate('arcade'); });
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
