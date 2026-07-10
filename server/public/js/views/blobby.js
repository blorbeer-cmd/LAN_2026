import { getToken } from '../api.js';
import { escapeHtml } from '../format.js';
import { showToast } from '../toast.js';
import { getMyId } from '../whoami.js';
import { showCountdown, cancelCountdown } from '../countdown.js';
import { confirmDialog } from '../modal.js';

const W = 1000;
const H = 600;
const GROUND = 550;
const NET_X = 500;
const NET_TOP = 365;
const BALL_RADIUS = 28;

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

const myId = () => getMyId();
const rerender = () => window.dispatchEvent(new CustomEvent('lan:rerender'));
const navigate = (view) => window.dispatchEvent(new CustomEvent('lan:navigate', { detail: view }));
const emitAck = (event, payload) => new Promise((resolve) => socket.emit(event, payload, resolve));

export function myBlobbyLobby() {
  return lobbies.find((l) => l.players.some((p) => p.id === myId())) ?? null;
}
export function hasBlobbyMatch() { return Boolean(match); }

export function ensureBlobbySocket() {
  if (socket) return socket;
  socket = io({ auth: { token: getToken() } });
  socket.on('blobby:lobbies', (payload) => { lobbies = payload?.lobbies ?? []; if (!match) rerender(); });
  socket.on('blobby:match:start', (payload) => {
    match = { ...payload, ended: false, winner: null };
    previous = latest = null;
    navigate('blobby');
    showCountdown(payload.beginsAt);
  });
  socket.on('blobby:state', (payload) => {
    previous = latest;
    latest = payload;
    latestAt = performance.now();
    if (match) { match.running = payload.running; match.paused = payload.paused; match.scores = payload.scores; }
    if (!document.querySelector('#blobby-canvas')) rerender();
  });
  socket.on('blobby:point', (payload) => {
    if (match) match.scores = payload.scores;
    flashPoint(payload.scorer?.name);
  });
  socket.on('blobby:match:end', (payload) => {
    if (!match) return;
    match.ended = true; match.running = false; match.winner = payload.winner ?? null; match.scores = payload.scores ?? [];
    cancelCountdown();
    window.dispatchEvent(new CustomEvent('lan:arcade-stats-dirty'));
    stopAnimation(); rerender();
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
  if (!lobbies.length) return '<div class="empty-state">Noch keine Blobby-Volley-Lobby.</div>';
  return lobbies.map((l) => {
    const joined = l.players.some((p) => p.id === myId());
    const host = l.host.id === myId();
    return `<div class="lb-row"><div><strong>${escapeHtml(l.host.name)}</strong><div class="muted">${l.players.map((p) => escapeHtml(p.name)).join(' vs. ')}</div></div><div class="row">
      ${!joined && l.players.length < 2 ? `<button class="btn btn-sm" data-blobby-join="${l.id}">Beitreten</button>` : ''}
      ${host ? `<button class="btn btn-sm" data-blobby-close="${l.id}">Schließen</button>` : joined ? `<button class="btn btn-sm" data-blobby-leave="${l.id}">Verlassen</button>` : ''}
    </div></div>`;
  }).join('');
}
function hostStart() {
  const lobby = myBlobbyLobby();
  if (!lobby || lobby.host.id !== myId()) return '';
  return `<button class="btn btn-primary btn-block" id="blobby-start" ${lobby.players.length === 2 ? '' : 'disabled'}>Match starten</button>`;
}
export function renderBlobbyLobbyCard() {
  const lobby = myBlobbyLobby(); const noMe = !myId();
  return `<div class="card stack"><div class="row-between"><strong>Blobby-Volley-Lobby</strong>
    <button class="btn btn-primary btn-sm btn-equal" id="blobby-create" ${lobby || match || noMe ? 'disabled' : ''}>Lobby öffnen</button></div>
    ${noMe ? '<div class="muted">Wähle oben zuerst aus, wer du bist.</div>' : ''}${lobbyList()}${hostStart()}</div>`;
}
export function wireBlobbyLobbyCard(container) {
  container.querySelector('#blobby-create')?.addEventListener('click', async () => {
    const res = await emitAck('blobby:lobby:create', { playerId: myId() });
    if (!res?.ok) showToast(res?.error || 'Lobby konnte nicht erstellt werden.', { error: true });
  });
  container.querySelectorAll('[data-blobby-join]').forEach((b) => b.addEventListener('click', async () => {
    const res = await emitAck('blobby:lobby:join', { lobbyId: b.dataset.blobbyJoin, playerId: myId() });
    if (!res?.ok) showToast(res?.error || 'Beitritt fehlgeschlagen.', { error: true });
  }));
  for (const [selector, attr] of [['[data-blobby-close]', 'blobbyClose'], ['[data-blobby-leave]', 'blobbyLeave']]) {
    container.querySelectorAll(selector).forEach((b) => b.addEventListener('click', () => emitAck('blobby:lobby:leave', { lobbyId: b.dataset[attr], playerId: myId() })));
  }
  container.querySelector('#blobby-start')?.addEventListener('click', async () => {
    const lobby = myBlobbyLobby();
    const res = await emitAck('blobby:lobby:start', { lobbyId: lobby?.id, playerId: myId() });
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
  ctx.fillStyle = color;
  ctx.beginPath(); ctx.arc(blob.x, blob.y, 44, Math.PI, 0); ctx.lineTo(blob.x + 44, blob.y + 38); ctx.arc(blob.x, blob.y + 38, 44, 0, Math.PI); ctx.closePath(); ctx.fill();
  const image = avatarImage(player);
  if (image) {
    ctx.save();
    ctx.beginPath(); ctx.arc(blob.x, blob.y, 35, 0, Math.PI * 2); ctx.clip();
    ctx.drawImage(image, blob.x - 35, blob.y - 35, 70, 70);
    ctx.restore();
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 4; ctx.beginPath(); ctx.arc(blob.x, blob.y, 35, 0, Math.PI * 2); ctx.stroke();
  } else {
    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(blob.x + (blob.side === 'left' ? 12 : -12), blob.y - 5, 8, 0, Math.PI * 2); ctx.fill();
  }
}
function paint() {
  const canvas = document.querySelector('#blobby-canvas');
  if (!canvas) return stopAnimation();
  const ctx = canvas.getContext('2d'); const world = interpolatedWorld();
  ctx.clearRect(0, 0, W, H);
  const sky = ctx.createLinearGradient(0, 0, 0, H); sky.addColorStop(0, '#17203a'); sky.addColorStop(1, '#252f50'); ctx.fillStyle = sky; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#36415f'; ctx.fillRect(0, GROUND, W, H - GROUND);
  ctx.fillStyle = '#dbe4ff'; ctx.fillRect(NET_X - 10, NET_TOP, 20, GROUND - NET_TOP); ctx.beginPath(); ctx.arc(NET_X, NET_TOP, 10, 0, Math.PI * 2); ctx.fill();
  if (world) {
    drawBlob(ctx, world.blobs[0], '#5b8cff', match?.players?.[0]); drawBlob(ctx, world.blobs[1], '#c24bd8', match?.players?.[1]);
    ctx.fillStyle = '#dbe4ff'; ctx.beginPath(); ctx.arc(world.ball.x, world.ball.y, BALL_RADIUS, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#aebddd'; ctx.lineWidth = 4; ctx.stroke();
  }
  animation = requestAnimationFrame(paint);
}
function startAnimation() { if (!animation) animation = requestAnimationFrame(paint); }
function stopAnimation() { if (animation) cancelAnimationFrame(animation); animation = null; }
function flashPoint(name) {
  const el = document.querySelector('#blobby-point'); if (!el) return;
  el.textContent = `Punkt für ${name || 'Spieler'}!`; el.hidden = false; setTimeout(() => { el.hidden = true; }, 900);
}
function scoreHtml() {
  return (match?.scores ?? latest?.scores ?? []).map((s) => `<span class="chip"><strong>${escapeHtml(s.name)}</strong> ${s.score}</span>`).join('');
}
function resultHtml() {
  if (!match?.ended) return '';
  const label = match.winner ? (match.winner.id === myId() ? 'Du gewinnst!' : `${escapeHtml(match.winner.name)} gewinnt`) : 'Match beendet';
  return `<div class="card arcade-winner-card"><strong>${label}</strong><button class="btn btn-primary" id="blobby-back">Zurück zum Arcade</button></div>`;
}
export function renderBlobby(container) {
  ensureBlobbySocket();
  if (!match) { container.innerHTML = '<button class="btn btn-sm" data-navigate="arcade">‹ Arcade</button><div class="empty-state">Kein laufendes Blobby-Volley-Match.</div>'; return; }
  const host = match.host?.id === myId();
  container.innerHTML = `<h1 class="view-title">Blobby Volley</h1><div class="chip-list blobby-score">${scoreHtml()}</div>
    <div class="blobby-court"><canvas id="blobby-canvas" width="${W}" height="${H}"></canvas><div id="blobby-point" class="blobby-point" hidden></div></div>
    <div class="blobby-controls"><button class="btn" data-move="left">←</button><button class="btn btn-primary" data-jump>Springen</button><button class="btn" data-move="right">→</button></div>
    ${host && !match.ended ? '<button class="btn btn-sm btn-danger" id="blobby-finish">Beenden</button>' : ''}${resultHtml()}`;
  wireGame(container); startAnimation();
}
function wireGame(container) {
  container.querySelectorAll('[data-move]').forEach((b) => {
    const side = b.dataset.move;
    const down = (e) => { e.preventDefault(); keys[side] = true; sendInput(false); };
    const up = (e) => { e.preventDefault(); keys[side] = false; sendInput(false); };
    b.addEventListener('pointerdown', down); b.addEventListener('pointerup', up); b.addEventListener('pointercancel', up); b.addEventListener('pointerleave', up);
  });
  container.querySelector('[data-jump]')?.addEventListener('pointerdown', (e) => { e.preventDefault(); sendInput(true); });
  container.querySelector('#blobby-finish')?.addEventListener('click', async () => {
    if (!(await confirmDialog('Match wirklich beenden?', { confirmText: 'Beenden', danger: true }))) return;
    await emitAck('blobby:match:finish', { matchId: match.matchId, playerId: myId() });
  });
  container.querySelector('#blobby-back')?.addEventListener('click', () => { match = null; previous = latest = null; stopAnimation(); navigate('arcade'); });
}
