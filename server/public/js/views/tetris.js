// Tetris 1v1 "Battle" — the Arcade's realtime duel.
//
// The server (src/arcade/tetris.ts) is authoritative: it owns both boards and
// pushes full `tetris:state` snapshots. This module only sends intents
// (left/right/rotate/drop) and paints whatever comes back. Because the board is
// a discrete grid, snapshots redraw the two <canvas> boards directly instead of
// rebuilding the DOM — a full rerender only runs on phase changes, never per
// frame, so the canvases never flicker.
//
// The LOBBY (open/join/start) renders inline inside the Arcade view via the
// exported render/wire helpers, exactly like the quiz lobby — one "Lobby öffnen"
// click, and the host can start as soon as an opponent is in. Only the live
// match takes over the dedicated full-screen `tetris` view; the app switches to
// it automatically when the match starts and back to Arcade when it ends.

import { getToken } from '../api.js';
import { escapeHtml } from '../format.js';
import { showToast } from '../toast.js';
import { getMyId } from '../whoami.js';
import { isAdmin } from '../admin.js';
import { showCountdown, cancelCountdown } from '../countdown.js';
import { confirmDialog } from '../modal.js';
import { allLobbyReady, lobbyPlayerChipsHtml, readyToggleHtml, wireReadyToggle } from '../lobbyReady.js';
import { arcadeExpandControlHtml, arcadeInfoGridHtml, matchRosterHtml, wireArcadeExpandControl } from './arcadeUi.js';

const COLS = 10;
const ROWS = 20;
// Fixed internal canvas resolution; CSS scales both boards to equal display
// size via flex, so the two fields are always the same size and stay crisp.
const BOARD_W = 240;
const BOARD_H = 480;

// Per-cell colours: 1-7 tetrominoes, 8 = garbage. Distinct hues so a busy
// board stays readable at a glance, tuned to sit on the app's dark canvas.
const COLORS = {
  1: '#22d3ee', // I — design-token-ok: classic tetromino hue, not app UI color
  2: '#eab308', // O — design-token-ok: classic tetromino hue, not app UI color
  3: '#22c55e', // S — design-token-ok: classic tetromino hue, not app UI color
  4: '#ef4444', // Z — design-token-ok: classic tetromino hue, not app UI color
  5: '#3b82f6', // J — design-token-ok: classic tetromino hue, not app UI color
  6: '#a855f7', // T — design-token-ok: classic tetromino hue, not app UI color
  7: '#f97316', // L — design-token-ok: classic tetromino hue, not app UI color
  8: '#5b6577', // garbage — design-token-ok: classic tetromino hue, not app UI color
};

let socket = null;
let lobbies = [];
let match = null; // { matchId, host, players, beginsAt, running, paused, ended, winner }
let latestState = null; // last tetris:state payload
let prevLines = {}; // playerId -> last seen line count, to detect fresh clears for FX
let inputBound = false;

function myId() {
  return getMyId();
}

// Nudge whichever view is currently mounted to re-render, and switch views,
// without this module needing a handle on app.js — both are thin CustomEvent
// hooks app.js listens for.
function rerender() {
  window.dispatchEvent(new CustomEvent('lan:rerender'));
}
function navigate(view) {
  window.dispatchEvent(new CustomEvent('lan:navigate', { detail: view }));
}

function amPlayer() {
  return Boolean(match && match.players?.some((p) => p.id === myId()));
}

export function myTetrisLobby() {
  return lobbies.find((l) => l.players.some((p) => p.id === myId())) ?? null;
}

export function hasTetrisMatch() {
  return Boolean(match);
}

export function tetrisLobbies() {
  return lobbies;
}

export function ensureTetrisSocket() {
  if (socket) return socket;
  socket = io({ auth: { token: getToken() } });

  socket.on('tetris:lobbies', (payload) => {
    lobbies = payload?.lobbies ?? [];
    // Only refresh the lobby UI while no match is running — never interrupt a
    // live match's canvases with a full rebuild.
    if (!match) rerender();
  });

  socket.on('tetris:match:start', (payload) => {
    match = { ...payload, running: false, paused: false, ended: false, winner: null };
    latestState = null;
    prevLines = {};
    navigate('tetris'); // hand over to the full-screen board view
    showCountdown(match.beginsAt);
  });

  socket.on('tetris:state', (payload) => {
    latestState = payload;
    if (match) {
      match.running = payload.running;
      match.paused = payload.paused;
    }
    // Fast path: repaint the mounted canvases directly, no DOM rebuild.
    if (document.querySelector('#tetris-boards')) paint();
    else rerender();
  });

  socket.on('tetris:match:paused', () => {
    if (match) match.paused = true;
    // Rerender (not just the overlay) so the host's button flips to
    // "Fortsetzen" — otherwise it stays "Pausieren" and re-clicking just
    // re-sends pause, leaving you stuck.
    rerender();
  });

  socket.on('tetris:match:resumed', () => {
    if (match) match.paused = false;
    rerender();
  });

  socket.on('tetris:match:end', (payload) => {
    if (!match) return;
    match.ended = true;
    match.running = false;
    match.winner = payload.winner ?? null;
    match.endScores = payload.scores ?? null;
    cancelCountdown();
    // A finished match adds a new highscore row — let the Arcade view know its
    // cached stats are stale so they refresh when the player heads back.
    window.dispatchEvent(new CustomEvent('lan:arcade-stats-dirty'));
    rerender();
  });

  socket.on('tetris:opponent-left', () => {
    if (match) showToast('Gegner hat das Match verlassen.', { error: true });
  });

  bindKeyboard();
  return socket;
}

function emitWithAck(event, payload) {
  return new Promise((resolve) => socket.emit(event, payload, resolve));
}

function sendInput(action) {
  if (!socket || !match?.matchId || !match.running || match.paused) return;
  const me = latestState?.players?.find((p) => p.playerId === myId());
  if (!me || !me.alive) return;
  socket.emit('tetris:input', { matchId: match.matchId, playerId: myId(), action });
}

// A single global keydown listener, gated on the board view being mounted so it
// never hijacks keys on other views. Arrows/space are prevented from scrolling.
function bindKeyboard() {
  if (inputBound) return;
  inputBound = true;
  window.addEventListener('keydown', (e) => {
    if (!document.querySelector('#tetris-boards') || !amPlayer()) return;
    const map = {
      ArrowLeft: 'left',
      ArrowRight: 'right',
      ArrowDown: 'soft',
      ArrowUp: 'rotate',
      x: 'rotate',
      X: 'rotate',
      y: 'rotateCcw',
      Y: 'rotateCcw',
      z: 'rotateCcw',
      Z: 'rotateCcw',
      ' ': 'hard',
    };
    const action = map[e.key];
    if (!action) return;
    e.preventDefault();
    sendInput(action);
  });
}

// ---------- Canvas painting ----------

function drawBoard(canvas, playerState) {
  if (!canvas || !playerState) return;
  const cell = Math.floor(canvas.width / COLS);
  const cx = canvas.getContext('2d');
  cx.clearRect(0, 0, canvas.width, canvas.height);

  cx.fillStyle = 'rgba(15, 20, 32, 0.9)';
  cx.fillRect(0, 0, canvas.width, canvas.height);
  cx.strokeStyle = 'rgba(122, 141, 195, 0.10)';
  cx.lineWidth = 1;
  for (let x = 1; x < COLS; x++) {
    cx.beginPath();
    cx.moveTo(x * cell + 0.5, 0);
    cx.lineTo(x * cell + 0.5, ROWS * cell);
    cx.stroke();
  }
  for (let y = 1; y < ROWS; y++) {
    cx.beginPath();
    cx.moveTo(0, y * cell + 0.5);
    cx.lineTo(COLS * cell, y * cell + 0.5);
    cx.stroke();
  }

  // Neon-glow blocks (the "Tetris Effect" look): each cell casts a soft glow
  // in its own colour, with a bright top edge for a bevelled sheen.
  const paintCell = (x, y, color, glow) => {
    cx.shadowColor = color;
    cx.shadowBlur = glow;
    cx.fillStyle = color;
    cx.fillRect(x * cell + 1, y * cell + 1, cell - 2, cell - 2);
    cx.shadowBlur = 0;
    cx.fillStyle = 'rgba(255,255,255,0.22)';
    cx.fillRect(x * cell + 1, y * cell + 1, cell - 2, 3);
  };

  const stackGlow = cell * 0.28;
  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < COLS; x++) {
      const v = playerState.board[y]?.[x];
      if (v) paintCell(x, y, COLORS[v] || 'var(--text-muted)', stackGlow);
    }
  }
  if (playerState.current) {
    const color = COLORS[playerState.current.color] || 'var(--text)';
    // The falling piece glows brighter so the eye tracks it.
    for (const [x, y] of playerState.current.cells) {
      if (y >= 0) paintCell(x, y, color, cell * 0.75);
    }
  }

  if (!playerState.alive) {
    cx.fillStyle = 'rgba(6, 9, 18, 0.55)';
    cx.fillRect(0, 0, canvas.width, canvas.height);
  }
}

// ---------- Effects (line-clear juice) ----------

function reducedMotion() {
  return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

// A short particle burst on the given board's overlay canvas.
function spawnBurst(fx, colors, count) {
  if (!fx) return;
  const cx = fx.getContext('2d');
  const W = fx.width;
  const H = fx.height;
  const parts = [];
  for (let i = 0; i < count; i++) {
    const ang = Math.random() * Math.PI * 2;
    const spd = 2 + Math.random() * 6;
    parts.push({
      x: W / 2,
      y: H * 0.42,
      vx: Math.cos(ang) * spd,
      vy: Math.sin(ang) * spd - 2.5,
      life: 1,
      color: colors[i % colors.length],
      size: 2 + Math.random() * 3.5,
    });
  }
  let last = performance.now();
  function frame(now) {
    const dt = Math.min(50, now - last) / 16.67;
    last = now;
    cx.clearRect(0, 0, W, H);
    let alive = false;
    for (const p of parts) {
      if (p.life <= 0) continue;
      p.life -= 0.022 * dt;
      p.vy += 0.28 * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      if (p.life > 0) {
        alive = true;
        cx.globalAlpha = Math.max(0, p.life);
        cx.fillStyle = p.color;
        cx.shadowColor = p.color;
        cx.shadowBlur = 10;
        cx.fillRect(p.x, p.y, p.size, p.size);
      }
    }
    cx.globalAlpha = 1;
    cx.shadowBlur = 0;
    if (alive) requestAnimationFrame(frame);
    else cx.clearRect(0, 0, W, H);
  }
  requestAnimationFrame(frame);
}

// Restart a one-shot CSS animation class (flash / shake).
function pulseClass(el, cls, ms) {
  if (!el) return;
  el.classList.remove(cls);
  void el.offsetWidth; // reflow so the animation re-triggers
  el.classList.add(cls);
  setTimeout(() => el.classList.remove(cls), ms);
}

function triggerClearFx(prefix, cleared) {
  if (reducedMotion()) return;
  const wrap = document.querySelector(`#${prefix}-wrap`);
  const tetris = cleared >= 4;
  pulseClass(wrap, tetris ? 'tetris-flash-big' : 'tetris-flash', 500);
  pulseClass(document.querySelector(`#${prefix}-wrap`)?.closest('.tetris-board-col'), 'tetris-shake', 350);
  const colors = tetris // design-token-ok: particle-burst confetti colors, a visual effect not app UI chrome
    ? ['#ffd166', '#ffffff', '#22d3ee', '#ef5da8'] // design-token-ok: confetti colors
    : ['#22d3ee', '#a855f7', '#ffffff', '#5b8cff']; // design-token-ok: confetti colors
  spawnBurst(document.querySelector(`#${prefix}-fx`), colors, tetris ? 46 : 22);
}

function updateStatLine(prefix, playerState) {
  const el = document.querySelector(`#${prefix}-stats`);
  if (el && playerState) {
    el.innerHTML = `Level ${playerState.level} · ${playerState.lines} Zeilen · ${playerState.score} Pkt`;
  }
  const warn = document.querySelector(`#${prefix}-incoming`);
  if (warn) {
    const n = playerState?.incoming ?? 0;
    warn.textContent = n > 0 ? `⚠ ${n}` : '';
    warn.classList.toggle('tetris-incoming-hot', n >= 4);
  }
}

function updateRosterDisplay() {
  const roster = document.querySelector('#tetris-roster');
  if (!roster || !match || !latestState) return;
  roster.innerHTML = matchRosterHtml(match.players, {
    winnerId: match.winner?.id ?? null,
    scoreFor: (player) => {
      const state = latestState.players.find((p) => p.playerId === player.id);
      return state ? `${state.score} Pkt · ${state.lines} Z` : '0 Pkt';
    },
  });
}

// Fire the clear FX when a board's line count jumps between snapshots.
function checkClearFx(prefix, playerState) {
  if (!playerState) return;
  const prev = prevLines[playerState.playerId];
  prevLines[playerState.playerId] = playerState.lines;
  if (prev !== undefined && playerState.lines > prev) {
    triggerClearFx(prefix, playerState.lines - prev);
  }
}

function paint() {
  if (!latestState) return;
  const me = latestState.players.find((p) => p.playerId === myId());
  const opp = latestState.players.find((p) => p.playerId !== myId());
  const left = me ?? latestState.players[0];
  const right = me ? opp : latestState.players[1];
  drawBoard(document.querySelector('#tetris-mine'), left);
  drawBoard(document.querySelector('#tetris-opponent'), right);
  updateRosterDisplay();
  updateStatLine('tetris-mine', left);
  updateStatLine('tetris-opponent', right);
  checkClearFx('tetris-mine', left);
  checkClearFx('tetris-opponent', right);
  paintOverlay();
}

// The board overlay now only carries the pause state; the start countdown is
// the shared full-screen overlay (countdown.js).
function paintOverlay() {
  const overlay = document.querySelector('#tetris-overlay');
  if (!overlay) return;
  if (match?.paused) {
    overlay.hidden = false;
    overlay.innerHTML = `<div class="tetris-overlay-text">Pause</div>`;
    return;
  }
  overlay.hidden = true;
  overlay.innerHTML = '';
}

// ---------- Lobby card (rendered inline inside the Arcade view) ----------

function renderLobbyList() {
  if (lobbies.length === 0) return `<div class="empty-state" style="padding:var(--space-4);">Keine offene Tetris-Lobby.</div>`;
  return lobbies
    .map((l) => {
      const isHost = l.host.id === myId();
      const joined = l.players.some((p) => p.id === myId());
      const full = l.players.length >= 2 && !joined;
      // Host can close their lobby; a joined guest can leave; otherwise join.
      const action = isHost
        ? `<button type="button" class="btn btn-sm btn-equal btn-danger" data-tetris-close="${l.id}">Schließen</button>`
        : joined
          ? `<div class="stack" style="gap:var(--space-2);">
              ${readyToggleHtml(l, myId(), 'tetris-ready')}
              <button type="button" class="btn btn-sm btn-equal" data-tetris-leave="${l.id}">Verlassen</button>
            </div>`
          : `<button type="button" class="btn btn-sm btn-equal btn-primary" data-tetris-join="${l.id}" ${full ? 'disabled' : ''}>Beitreten</button>`;
      return `
        <div class="lb-row" style="align-items:flex-start;">
          <div class="stack" style="gap:var(--space-2);flex:1;">
            <strong>${escapeHtml(l.host.name)}s Tetris-Lobby</strong>
            <div class="chip-list">${lobbyPlayerChipsHtml(l)}</div>
            <div class="muted" style="font-size:var(--font-size-xs);">${l.players.length}/2 Spieler${full ? ' · voll' : ''}</div>
          </div>
          ${action}
        </div>`;
    })
    .join('');
}

function hostStartHtml() {
  const lobby = myTetrisLobby();
  if (!lobby || lobby.host.id !== myId()) return '';
  const ready = lobby.players.length === 2;
  const hint = !ready
    ? 'Warte auf einen Gegner…'
    : allLobbyReady(lobby)
      ? 'Gegner ist bereit.'
      : 'Gegner ist da — noch nicht bereit.';
  return `
    <div class="stack" style="gap:var(--space-2);border-top:1px solid var(--border);padding-top:var(--space-3);">
      <div class="muted" style="font-size:var(--font-size-xs);">${hint}</div>
      <button type="button" class="btn btn-primary btn-block" id="tetris-start" ${ready ? '' : 'disabled'}>Start</button>
    </div>`;
}

// The Arcade view embeds this whole card in place of a separate sub-view.
export function renderTetrisLobbyCard() {
  const lobby = myTetrisLobby();
  // Without a chosen identity there's nothing to open a lobby *as* — make that
  // obvious (disabled button + hint) instead of only flashing a toast on click,
  // which reads as "nothing happened".
  const noMe = !myId();
  return `
    <div class="card stack">
      <div class="row-between" style="gap:var(--space-3);">
        <strong>Tetris-Lobby</strong>
        <div class="row" style="gap:var(--space-2);">${isAdmin() ? `<button type="button" class="btn btn-sm btn-equal" id="tetris-bot" ${match || noMe ? 'disabled' : ''}>Gegen KI</button>` : ''}<button type="button" class="btn btn-primary btn-sm btn-equal" id="tetris-create" ${match || noMe ? 'disabled' : ''}>Lobby öffnen</button></div>
      </div>
      ${arcadeInfoGridHtml([
        { label: 'Ziel', text: 'Überleben.' },
        { label: 'Steuerung', text: 'Pfeiltasten + Leertaste.' },
      ])}
      ${noMe ? `<div class="muted" style="font-size:var(--font-size-xs);">Wähle oben zuerst aus, wer du bist.</div>` : ''}
      ${renderLobbyList()}
      ${hostStartHtml()}
    </div>`;
}

export async function leaveMyTetrisLobby() {
  const lobby = myTetrisLobby();
  if (!lobby) return { ok: true };
  return emitWithAck('tetris:lobby:leave', { lobbyId: lobby.id, playerId: myId() });
}

export function wireTetrisLobbyCard(container, { beforeCreate, beforeJoin } = {}) {
  container.querySelector('#tetris-bot')?.addEventListener('click', async () => {
    if (beforeCreate && !(await beforeCreate())) return;
    const res = await emitWithAck('tetris:lobby:bot', { playerId: myId() });
    if (!res?.ok) showToast(res?.error || 'KI-Lobby konnte nicht erstellt werden.', { error: true });
  });
  container.querySelector('#tetris-create')?.addEventListener('click', async () => {
    const playerId = myId();
    if (!playerId) return showToast('Bitte zuerst auswählen, wer du bist.', { error: true });
    if (beforeCreate && !(await beforeCreate())) return;
    const res = await emitWithAck('tetris:lobby:create', { playerId });
    if (!res?.ok) return showToast(res?.error || 'Lobby konnte nicht erstellt werden.', { error: true });
    showToast('Tetris-Lobby geöffnet.');
  });

  container.querySelectorAll('[data-tetris-join]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const playerId = myId();
      if (!playerId) return showToast('Bitte zuerst auswählen, wer du bist.', { error: true });
      if (beforeJoin && !(await beforeJoin())) return;
      const res = await emitWithAck('tetris:lobby:join', { lobbyId: btn.dataset.tetrisJoin, playerId });
      if (!res?.ok) showToast(res?.error || 'Beitritt fehlgeschlagen.', { error: true });
    });
  });

  // Host closes the lobby, or a joined guest leaves it — both go through the
  // server's leave handler (host leaving deletes the whole lobby).
  const leaveHandler = (dataAttr) => (btn) =>
    btn.addEventListener('click', async () => {
      const res = await emitWithAck('tetris:lobby:leave', { lobbyId: btn.dataset[dataAttr], playerId: myId() });
      if (!res?.ok) showToast(res?.error || 'Aktion fehlgeschlagen.', { error: true });
    });
  container.querySelectorAll('[data-tetris-close]').forEach(leaveHandler('tetrisClose'));
  container.querySelectorAll('[data-tetris-leave]').forEach(leaveHandler('tetrisLeave'));

  wireReadyToggle(container, 'tetris-ready', async (lobbyId, ready) => {
    const res = await emitWithAck('tetris:lobby:ready', { lobbyId, playerId: myId(), ready });
    if (!res?.ok) showToast(res?.error || 'Bereit-Status konnte nicht gesetzt werden.', { error: true });
  });

  container.querySelector('#tetris-start')?.addEventListener('click', async () => {
    const lobby = myTetrisLobby();
    if (!lobby) return;
    const res = await emitWithAck('tetris:lobby:start', { lobbyId: lobby.id, playerId: myId() });
    if (!res?.ok) showToast(res?.error || 'Start fehlgeschlagen.', { error: true });
  });
}

// ---------- Full-screen match view (the dedicated `tetris` view) ----------

function endResultHtml() {
  if (!match?.ended) return '';
  return `
    <div class="card arcade-winner-card">
      <strong>Match beendet</strong>
      <button type="button" class="btn btn-primary" id="tetris-back">Zur Arcade</button>
    </div>`;
}

// Both boards use the same fixed internal resolution; CSS scales them to equal
// display size. An extra overlay canvas carries the particle effects.
function boardColumn(prefix, label) {
  return `
    <div class="tetris-board-col">
      <div id="${prefix}-wrap" class="tetris-canvas-wrap">
        <canvas id="${prefix}" width="${BOARD_W}" height="${BOARD_H}" class="tetris-canvas"></canvas>
        <canvas id="${prefix}-fx" width="${BOARD_W}" height="${BOARD_H}" class="tetris-fx" aria-hidden="true"></canvas>
        ${prefix === 'tetris-mine' ? `<div id="tetris-overlay" class="tetris-overlay" hidden></div>` : ''}
        <div id="${prefix}-incoming" class="tetris-incoming"></div>
      </div>
      <div id="${prefix}-stats" class="muted tetris-stats-line"></div>
    </div>`;
}

function matchControls() {
  if (!match || match.ended || match.host?.id !== myId()) return '';
  return `
    <div class="arcade-match-controls">
      ${
        match.paused
          ? `<button type="button" class="btn btn-sm btn-equal btn-primary" id="tetris-resume">Fortsetzen</button>`
          : `<button type="button" class="btn btn-sm btn-equal" id="tetris-pause">Pausieren</button>`
      }
      <button type="button" class="btn btn-sm btn-equal btn-danger" id="tetris-finish">Beenden</button>
    </div>`;
}

export function renderTetris(container, ctx) {
  ensureTetrisSocket();
  if (!match) {
    // The play view is only for live matches; anything else belongs in Arcade.
    container.innerHTML = `
      <button type="button" class="btn btn-sm" data-navigate="arcade">‹ Arcade</button>
      <div class="empty-state" style="margin-top:var(--space-4);">Kein laufendes Tetris-Match.</div>`;
    return;
  }

  const opponent = match.players.find((p) => p.id !== myId());
  const oppLabel = amPlayer() ? escapeHtml(opponent?.name ?? 'Gegner') : escapeHtml(match.players[1]?.name ?? 'Spieler 2');
  const meLabel = amPlayer() ? 'Du' : escapeHtml(match.players[0]?.name ?? 'Spieler 1');
  const winnerId = match.winner?.id ?? null;
  const roster = matchRosterHtml(match.players, {
    winnerId,
    scoreFor: (player) => {
      const state = latestState?.players?.find((p) => p.playerId === player.id);
      if (!state) return '0 Pkt';
      return `${state.score} Pkt · ${state.lines} Z`;
    },
  });
  container.innerHTML = `
    <div class="arcade-game-shell"><h1 class="view-title">Tetris</h1>
    ${arcadeExpandControlHtml()}
    <div id="tetris-game">
      <div id="tetris-roster">${roster}</div>
      <div id="tetris-boards" class="tetris-boards">
        ${boardColumn('tetris-mine', meLabel)}
        ${boardColumn('tetris-opponent', oppLabel)}
      </div>
      ${matchControls()}
      ${endResultHtml()}
    </div></div>`;
  paint();
  wireMatch(container);
  wireArcadeExpandControl(container);
}

function wireMatch(container) {
  bindTouchGestures(container.querySelector('#tetris-mine'));

  container.querySelector('#tetris-pause')?.addEventListener('click', async () => {
    const res = await emitWithAck('tetris:match:pause', { matchId: match?.matchId, playerId: myId() });
    if (!res?.ok) showToast(res?.error || 'Pausieren fehlgeschlagen.', { error: true });
  });
  container.querySelector('#tetris-resume')?.addEventListener('click', async () => {
    const res = await emitWithAck('tetris:match:resume', { matchId: match?.matchId, playerId: myId() });
    if (!res?.ok) showToast(res?.error || 'Fortsetzen fehlgeschlagen.', { error: true });
  });
  container.querySelector('#tetris-finish')?.addEventListener('click', async () => {
    if (!(await confirmDialog('Match wirklich beenden?', { confirmText: 'Beenden', danger: true }))) return;
    const res = await emitWithAck('tetris:match:finish', { matchId: match?.matchId, playerId: myId() });
    if (!res?.ok) showToast(res?.error || 'Beenden fehlgeschlagen.', { error: true });
  });

  container.querySelector('#tetris-back')?.addEventListener('click', () => {
    match = null;
    latestState = null;
    cancelCountdown();
    navigate('arcade');
  });
}

// Touch controls without on-screen buttons: drag left/right across your board
// to move the piece cell by cell, tap to rotate, swipe down to hard-drop.
// (Keyboard remains the way to play on a laptop.)
function bindTouchGestures(canvas) {
  if (!canvas) return;
  const cellPx = () => canvas.clientWidth / COLS || 22;
  let sx = 0;
  let sy = 0;
  let stepAnchorX = 0;
  let startAt = 0;
  let moved = false;
  let active = false;

  canvas.addEventListener('pointerdown', (e) => {
    if (!amPlayer()) return;
    active = true;
    moved = false;
    sx = e.clientX;
    sy = e.clientY;
    stepAnchorX = e.clientX;
    startAt = performance.now();
    canvas.setPointerCapture?.(e.pointerId);
  });

  canvas.addEventListener('pointermove', (e) => {
    if (!active) return;
    const c = cellPx();
    let dx = e.clientX - stepAnchorX;
    while (Math.abs(dx) >= c) {
      sendInput(dx > 0 ? 'right' : 'left');
      stepAnchorX += dx > 0 ? c : -c;
      dx = e.clientX - stepAnchorX;
      moved = true;
    }
  });

  const finish = (e) => {
    if (!active) return;
    active = false;
    const dt = performance.now() - startAt;
    const totalDx = e.clientX - sx;
    const totalDy = e.clientY - sy;
    const c = cellPx();
    if (!moved && Math.abs(totalDx) < c && Math.abs(totalDy) < c && dt < 300) {
      sendInput('rotate'); // tap
    } else if (totalDy > c * 2 && totalDy > Math.abs(totalDx)) {
      sendInput('hard'); // swipe down = hard drop
    }
  };
  canvas.addEventListener('pointerup', finish);
  canvas.addEventListener('pointercancel', () => {
    active = false;
  });
}
