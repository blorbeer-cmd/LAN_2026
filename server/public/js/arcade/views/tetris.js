// Tetris Duell and Arena — realtime matches for two through eight players.
//
// The server (src/arcade/tetris.ts) is authoritative: it owns every board and
// pushes full `tetris:state` snapshots. This module only sends intents
// (left/right/rotate/drop) and paints whatever comes back. Because the board is
// a discrete grid, snapshots redraw the mounted <canvas> boards directly instead of
// rebuilding the DOM — a full rerender only runs on phase changes, never per
// frame, so the canvases never flicker.
//
// The LOBBY (open/join/start) renders inline inside the Arcade view via the
// exported render/wire helpers, exactly like the quiz lobby — one "Lobby öffnen"
// click, and the host can start as soon as an opponent is in. Only the live
// match takes over the dedicated full-screen `tetris` view; the app switches to
// it automatically when the match starts and back to Arcade when it ends.

import { connectSocket } from '../../socket.js';
import { avatarHtml, escapeHtml } from '../../format.js';
import { playerById } from '../../state.js';
import { showToast } from '../../toast.js';
import { getMyId } from '../../whoami.js';
import { showCountdown, cancelCountdown } from '../countdown.js';
import { confirmDialog } from '../../modal.js';
import { arcadeLobbyEntryHtml, arcadeLobbyHostActionsHtml, arcadeLobbyGuestActionsHtml, arcadeLobbyJoinHtml, readyToggleHtml, wireReadyToggle } from '../lobbyReady.js';
import { arcadeGameHeaderHtml, arcadeMatchControlsHtml, arcadeResultListHtml, wireArcadeToolbar } from '../arcadeUi.js';
import { playArcadeSound } from '../arcadeSound.js';
import { createRematchController } from '../rematch.js';
import { TETRIS_COLORS } from '../shared/tetrisColors.js';

const COLS = 10;
const ROWS = 20;
// Fixed internal canvas resolution; CSS scales both boards to equal display
// size via flex, so the two fields are always the same size and stay crisp.
const BOARD_W = 240;
const BOARD_H = 480;

const COLORS = TETRIS_COLORS;

let socket = null;
let lobbies = [];
let match = null; // { matchId, host, players, beginsAt, running, paused, ended, winner }
let latestState = null; // last tetris:state payload
let prevLines = {}; // playerId -> last seen line count, to detect fresh clears for FX
let prevLevels = {}; // playerId -> last seen level, to detect level-ups for the level-up cue
let prevFilled = null; // filled cells on the local board, to hear a piece lock
let inputBound = false;
let lobbyMode = 'duel';
const rematch = createRematchController({
  prefix: 'tetris',
  emit: (event, payload) => emitWithAck(event, payload),
  myId: () => myId(),
  lobbies: () => lobbies,
  events: { create: 'tetris:lobby:create', bot: 'tetris:lobby:bot', join: 'tetris:lobby:join', ready: 'tetris:lobby:ready', start: 'tetris:lobby:start', leave: 'tetris:lobby:leave' },
  playerName: (id) => match?.players.find((player) => player.id === id)?.name ?? 'Spieler',
  rerender: () => rerender(),
  onError: (message) => showToast(message, { error: true }),
});

function myId() {
  return getMyId();
}

// Nudge whichever view is currently mounted to re-render, and switch views,
// without this module needing a handle on app.js — both are thin CustomEvent
// hooks app.js listens for.
function rerender() {
  window.dispatchEvent(new CustomEvent('respawn:rerender'));
}
function navigate(view) {
  window.dispatchEvent(new CustomEvent('respawn:navigate', { detail: view }));
}

function amPlayer() {
  return Boolean(match && match.players?.some((p) => p.id === myId()));
}

function tetrisViewMounted() {
  return Boolean(document.querySelector('#tetris-boards'));
}

function currentView() {
  return document.getElementById('view-container')?.dataset.view;
}

export function myTetrisLobby() {
  return lobbies.find((l) => l.players.some((p) => p.id === myId())) ?? null;
}

export function hasTetrisMatch() {
  return Boolean(match && !match.ended);
}

export function tetrisLobbies() {
  return lobbies;
}

export function ensureTetrisSocket() {
  if (socket) return socket;
  socket = connectSocket();

  socket.on('tetris:lobbies', (payload) => {
    lobbies = payload?.lobbies ?? [];
    // Only refresh the lobby UI while no match is running — never interrupt a
    // live match's canvases with a full rebuild.
    if (!match && currentView() === 'arcade') rerender();
    // On the result screen a lobby change can be a Revanche offer or answer.
    if (match?.ended && tetrisViewMounted()) {
      rematch.onLobbies();
      rerender();
    }
  });

  socket.on('tetris:match:start', (payload) => {
    match = { ...payload, running: false, paused: false, ended: false, winner: null };
    rematch.reset();
    latestState = null;
    prevLines = {};
    prevLevels = {};
    prevFilled = null;
    navigate('tetris'); // hand over to the full-screen board view
    showCountdown(match.beginsAt);
  });

  socket.on('tetris:state', (payload) => {
    latestState = payload;
    if (match) {
      match.running = payload.running;
      match.paused = payload.paused;
      match.mode = payload.mode ?? match.mode;
      match.host = payload.host ?? match.host;
    }
    // Fast path: repaint the mounted canvases directly, no DOM rebuild. A
    // host handover (the previous host left/disconnected) only changes who
    // may pause/finish the match — never the board layout, which is keyed to
    // the local player's own perspective, not to the host — so it is folded
    // into the same non-destructive control-footer update as pause/resume.
    // The socket remains connected while the user visits other views. Never
    // trigger a render there: a frequent state tick must not compete with
    // bottom-navigation clicks or repaint the current view unnecessarily.
    if (tetrisViewMounted()) updateMatchControls();
  });

  socket.on('tetris:match:paused', () => {
    if (match) match.paused = true;
    if (tetrisViewMounted()) updateMatchControls();
  });

  socket.on('tetris:match:resumed', () => {
    if (match) match.paused = false;
    if (tetrisViewMounted()) updateMatchControls();
  });

  socket.on('tetris:match:end', (payload) => {
    if (!match) return;
    match.ended = true;
    match.running = false;
    match.winner = payload.winner ?? null;
    match.endScores = payload.scores ?? null;
    rematch.capture(match);
    cancelCountdown();
    playArcadeSound('tetris-gameover');
    // A finished match adds a new highscore row — let the Arcade view know its
    // cached stats are stale so they refresh when the player heads back.
    window.dispatchEvent(new CustomEvent('respawn:arcade-stats-dirty'));
    if (tetrisViewMounted() || currentView() === 'arcade') rerender();
  });

  socket.on('tetris:opponent-left', (payload) => {
    if (match) showToast(`${payload?.playerName || 'Ein Spieler'} hat das Match verlassen.`, { error: true });
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

  cx.fillStyle = '#0f1420'; // --bg  design-token-ok: canvas paint needs literal colors
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
    const parts = [`Level ${playerState.level}`, `${playerState.lines} ${playerState.lines === 1 ? 'Zeile' : 'Zeilen'}`, `${playerState.garbageSent ?? 0} gesendet`];
    if (match?.mode === 'arena') parts.push(`${playerState.knockouts ?? 0} K.o.`);
    el.textContent = parts.join(' · ');
  }
  const score = document.querySelector(`#${prefix}-score`);
  if (score && playerState) score.textContent = `${playerState.score} Pkt`;
  const warn = document.querySelector(`#${prefix}-incoming`);
  if (warn) {
    const n = playerState?.incoming ?? 0;
    warn.textContent = n > 0 ? `Gefahr: ${n}` : '';
    warn.classList.toggle('tetris-incoming-hot', n >= 4);
  }
}

function updateArenaInfo() {
  const info = document.querySelector('#tetris-arena-info');
  if (!info || !latestState || match?.mode !== 'arena') return;
  const me = latestState.players.find((player) => player.playerId === myId());
  if (!me) return;
  const incoming = (me.incomingSources ?? [])
    .map((source) => `${escapeHtml(source.name)} (${source.lines} ${source.lines === 1 ? 'Zeile' : 'Zeilen'})`)
    .join(', ');
  const target = me.targetName ? escapeHtml(me.targetName) : 'kein lebendes Ziel';
  const lastTarget = me.lastGarbageTargetName ? escapeHtml(me.lastGarbageTargetName) : 'noch niemand';
  info.innerHTML = `
    <div class="tetris-arena-info-item"><span class="muted">Dein aktuelles Ziel</span><strong>${target}</strong><small>Neue Angriffszeilen gehen dorthin.</small></div>
    <div class="tetris-arena-info-item"><span class="muted">Eingehende Zeilen</span><strong>${incoming || 'Keine'}</strong><small>${incoming ? 'Absender der noch offenen Pakete' : 'Aktuell wartet kein Angriff.'}</small></div>
    <div class="tetris-arena-info-item"><span class="muted">Deine Bilanz</span><strong>${me.garbageSent ?? 0} Zeilen gesendet · ${me.garbageReceived ?? 0} erhalten · ${me.knockouts ?? 0} Spieler besiegt</strong><small>Zuletzt gesendet an: ${lastTarget}</small></div>`;
}

// Fire the clear FX when a board's line count jumps between snapshots. Only
// the local player's own board plays a sound cue — otherwise a busy 1v1 would
// double up cues for the same event on both boards.
// A locked piece adds its cells to the stack; a line clear removes cells and
// plays its own sweep instead. Only the local board clicks.
function filledCells(board) {
  return (board ?? []).reduce((sum, row) => sum + (row ?? []).filter(Boolean).length, 0);
}

function checkLockSound(prefix, playerState) {
  if (prefix !== 'tetris-mine' || !playerState) return;
  const filled = filledCells(playerState.board);
  if (prevFilled !== null && filled > prevFilled) playArcadeSound('tetris-lock');
  prevFilled = filled;
}

function checkClearFx(prefix, playerState) {
  if (!playerState) return;
  checkLockSound(prefix, playerState);
  const prevLineCount = prevLines[playerState.playerId];
  prevLines[playerState.playerId] = playerState.lines;
  if (prevLineCount !== undefined && playerState.lines > prevLineCount) {
    const cleared = playerState.lines - prevLineCount;
    triggerClearFx(prefix, cleared);
    if (prefix === 'tetris-mine') playArcadeSound(cleared >= 4 ? 'tetris-tetris' : 'tetris-line');
  }
  const prevLevel = prevLevels[playerState.playerId];
  prevLevels[playerState.playerId] = playerState.level;
  if (prefix === 'tetris-mine' && prevLevel !== undefined && playerState.level > prevLevel) {
    playArcadeSound('tetris-levelup');
  }
}

function paint() {
  if (!latestState) return;
  const me = latestState.players.find((player) => player.playerId === myId());
  document.querySelectorAll('[data-tetris-player-id]').forEach((column) => {
    const playerState = latestState.players.find((player) => player.playerId === column.dataset.tetrisPlayerId);
    const prefix = column.dataset.tetrisPrefix;
    if (!prefix) return;
    drawBoard(column.querySelector('.tetris-canvas'), playerState);
    updateStatLine(prefix, playerState);
    checkClearFx(prefix, playerState);
    column.classList.toggle('is-eliminated', Boolean(playerState && !playerState.alive));
    column.classList.toggle('is-target', match?.mode === 'arena' && me?.targetId === playerState?.playerId);
  });
  updateArenaInfo();
  paintOverlay();
}

// The board overlay now only carries the pause state; the start countdown is
// the shared full-screen overlay (countdown.js).
function paintOverlay() {
  const overlay = document.querySelector('#tetris-overlay');
  if (!overlay) return;
  const me = latestState?.players?.find((player) => player.playerId === myId());
  if (me && !me.alive) {
    overlay.hidden = false;
    overlay.innerHTML = `<div class="tetris-overlay-text"><span>Ausgeschieden</span>${me.placement ? `<small>Platz ${me.placement}</small>` : ''}</div>`;
    return;
  }
  if (match?.paused) {
    overlay.hidden = false;
    overlay.innerHTML = `<div class="tetris-overlay-text">Pause</div>`;
    return;
  }
  overlay.hidden = true;
  overlay.innerHTML = '';
}

// ---------- Lobby entries (listed on the Arcade hub) ----------

function lobbyEntryHtml(l) {
  const isHost = l.host.id === myId();
  const joined = l.players.some((p) => p.id === myId());
  const playerLimit = l.playerLimit ?? (l.mode === 'arena' ? 8 : 2);
  const full = l.players.length >= playerLimit && !joined;
  const minimumReached = l.mode === 'arena' ? l.players.length >= 3 : l.players.length === 2;
  const ready = minimumReached && l.players.every((player) => player.id === l.host.id || player.ready);
  const minimumPlayers = l.mode === 'arena' ? 3 : 2;
  const startHint = ready ? '' : !minimumReached ? `Mindestens ${minimumPlayers} Spieler` : 'Noch nicht alle bereit';
  const footerActions = isHost
    ? arcadeLobbyHostActionsHtml({ startAttrs: 'id="tetris-start"', startEnabled: ready, startHint, closeAttrs: `data-tetris-close="${l.id}"` })
    : joined
      ? arcadeLobbyGuestActionsHtml({ readyHtml: readyToggleHtml(l, myId(), 'tetris-ready'), leaveAttrs: `data-tetris-leave="${l.id}"` })
      : '';
  const joinAction = !joined ? arcadeLobbyJoinHtml(`data-tetris-join="${l.id}"`, full) : '';
  const meta = `${l.mode === 'arena' ? 'Arena' : 'Duell'} · ${l.players.length}/${playerLimit}`;
  return arcadeLobbyEntryHtml(l, { gameType: 'tetris', meta, joinAction, footerActions, full, capacity: playerLimit });
}

export function renderTetrisLobbyEntries() {
  return lobbies.map((lobby) => ({ id: lobby.id, html: lobbyEntryHtml(lobby) }));
}

export async function createTetrisLobby({ mode = 'duel', opponent = 'human' } = {}) {
  const playerId = myId();
  if (!playerId) return showToast('Bitte zuerst auswählen, wer du bist.', { error: true });
  lobbyMode = mode === 'arena' ? 'arena' : 'duel';
  const res = await emitWithAck(opponent === 'bot' ? 'tetris:lobby:bot' : 'tetris:lobby:create', { playerId, mode: lobbyMode });
  if (!res?.ok) showToast(res?.error || 'Lobby konnte nicht erstellt werden.', { error: true });
  return res;
}

export async function leaveMyTetrisLobby() {
  const lobby = myTetrisLobby();
  if (!lobby) return { ok: true };
  return emitWithAck('tetris:lobby:leave', { lobbyId: lobby.id, playerId: myId() });
}

export function wireTetrisLobbyCard(container, { beforeJoin } = {}) {
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
  const scores = new Map((match.endScores ?? []).map((score) => [score.playerId, score]));
  const ranking = [...match.players].sort((a, b) => {
    const pa = scores.get(a.id)?.placement ?? Number.MAX_SAFE_INTEGER;
    const pb = scores.get(b.id)?.placement ?? Number.MAX_SAFE_INTEGER;
    return pa - pb || (scores.get(b.id)?.score ?? 0) - (scores.get(a.id)?.score ?? 0);
  });
  const rows = ranking.map((player) => {
    const score = scores.get(player.id);
    const detail = [`${score?.lines ?? 0} Zeilen`, `${score?.garbageSent ?? 0} gesendet`];
    if (match.mode === 'arena') detail.push(`${score?.knockouts ?? 0} K.o.`);
    return { player, place: score?.placement, winner: player.id === match.winner?.id || score?.isWinner === true, value: `${score?.score ?? 0} Pkt`, detail: detail.join(' · ') };
  });
  return `
    <section class="card stack grouped-page-section" aria-labelledby="tetris-result-title">
      <div class="grouped-page-section-title"><h2 id="tetris-result-title">Ergebnis</h2>${rematch.actionHtml()}</div>
      ${arcadeResultListHtml(rows)}
    </section>`;
}


// Both boards use the same fixed internal resolution; CSS scales them to equal
// display size. An extra overlay canvas carries the particle effects.
function boardColumn(prefix, label, player, { primary = false } = {}) {
  const profile = { ...(playerById(player.id) ?? {}), ...player };
  return `
    <div class="tetris-board-col${primary ? ' is-primary' : ''}" data-tetris-player-id="${escapeHtml(player.id)}" data-tetris-prefix="${prefix}">
      <div class="tetris-board-head">
        ${avatarHtml(profile, 20)}
        <span class="tetris-board-name player-name">${escapeHtml(label)}</span>
        <span id="${prefix}-score" class="tetris-board-score"></span>
      </div>
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
  if (!match) return '';
  if (match.ended) return arcadeMatchControlsHtml('<button type="button" class="btn btn-sm" id="tetris-back">Schließen</button>');
  if (match.host?.id !== myId()) {
    // A non-host player can't pause (shared timer state, host-only), but
    // must still have a way out instead of only a raw tab close.
    if (!amPlayer()) return '';
    return arcadeMatchControlsHtml('<button type="button" class="btn btn-sm" id="tetris-leave">Verlassen</button>');
  }
  return arcadeMatchControlsHtml(`${pauseButtonHtml()}<button type="button" class="btn btn-sm" id="tetris-finish">Beenden</button>`);
}

function pauseButtonHtml() {
  return match.paused
    ? '<button type="button" class="btn btn-primary btn-sm" id="tetris-resume">Fortsetzen</button>'
    : '<button type="button" class="btn btn-sm" id="tetris-pause">Pausieren</button>';
}

export function renderTetris(container, _ctx) {
  ensureTetrisSocket();
  if (!match) {
    // A direct or expired-match link lands here without a running match;
    // show the same named lobby area as opening Tetris from Arcade instead
    // of a dead end (see Pong/Snake/Battleship's identical fallback).
    // Lobbies live on the Arcade hub; a direct or expired match link goes there.
    window.dispatchEvent(new CustomEvent('respawn:navigate', { detail: 'arcade' }));
    return;
  }

  // Shared background refreshes can render the active view at any time.
  // Keep a live match's canvases and measured layout mounted; only a new
  // match, perspective or mode needs a different board/control shell. A host
  // handover (the previous host left/disconnected) does not: the board
  // layout is keyed to the local player's own perspective, never to who
  // currently holds the host controls, so it is folded into the same
  // non-destructive control-footer update as pause/resume instead of forcing
  // a full rebuild that would tear down and reinitialize every live canvas.
  const renderKey = JSON.stringify([match.matchId, myId(), match.mode]);
  if (!match.ended && container.querySelector('#tetris-boards')?.dataset.renderKey === renderKey) {
    updateMatchControls();
    return;
  }

  const mine = match.players.find((player) => player.id === myId());
  const orderedPlayers = mine ? [mine, ...match.players.filter((player) => player.id !== mine.id)] : match.players;
  const boardFor = (player, index, primary = false) => {
    const prefix = primary ? 'tetris-mine' : `tetris-player-${index}`;
    const label = player.id === myId() ? 'Du' : player.name;
    return boardColumn(prefix, label, player, { primary });
  };
  const boardLayout =
    match.mode === 'arena' && mine
      ? `<div class="tetris-primary-board">${boardFor(mine, 0, true)}</div>
         <div class="tetris-opponent-grid">${orderedPlayers.slice(1).map((player, index) => boardFor(player, index + 1)).join('')}</div>`
      : match.mode === 'arena'
        ? `<div class="tetris-opponent-grid is-spectator">${orderedPlayers.map((player, index) => boardFor(player, index)).join('')}</div>`
      : orderedPlayers.map((player, index) => boardFor(player, index, player.id === myId() || (!mine && index === 0))).join('');
  container.innerHTML = `
    <div class="arcade-game-shell${match.ended ? ' is-ended' : ''}">
    ${arcadeGameHeaderHtml(match.mode === 'arena' ? 'Tetris Arena' : 'Tetris Duell', matchControls())}
    <div id="tetris-game" class="grouped-page-sections">
      ${endResultHtml()}
      <section class="card arcade-stage">
        <div id="tetris-boards" data-countdown-anchor class="tetris-boards ${match.mode === 'arena' ? 'is-arena' : 'is-duel'}">
          ${boardLayout}
        </div>
      </section>
      ${match.mode === 'arena' && !match.ended ? '<section class="card stack grouped-page-section tetris-arena-info" aria-labelledby="tetris-arena-info-title"><div class="grouped-page-section-title"><h2 id="tetris-arena-info-title">Arena</h2></div><div id="tetris-arena-info" class="tetris-arena-info-grid" aria-live="polite"></div></section>' : ''}
    </div></div>`;
  container.querySelector('#tetris-boards').dataset.renderKey = renderKey;
  paint();
  wireMatch(container);
  wireArcadeToolbar(container);
}

function wireMatch(container) {
  bindTouchGestures(container.querySelector('#tetris-mine'));
  wireMatchControls(container);

  rematch.wire(container);
  container.querySelector('#tetris-back')?.addEventListener('click', async () => {
    await rematch.close();
    match = null;
    latestState = null;
    cancelCountdown();
    navigate('arcade');
  });
}

function wirePauseControl(root) {
  root.querySelector('#tetris-pause')?.addEventListener('click', async () => {
    const res = await emitWithAck('tetris:match:pause', { matchId: match?.matchId, playerId: myId() });
    if (!res?.ok) showToast(res?.error || 'Pausieren fehlgeschlagen.', { error: true });
  });
  root.querySelector('#tetris-resume')?.addEventListener('click', async () => {
    const res = await emitWithAck('tetris:match:resume', { matchId: match?.matchId, playerId: myId() });
    if (!res?.ok) showToast(res?.error || 'Fortsetzen fehlgeschlagen.', { error: true });
  });
}

function wireMatchControls(root) {
  wirePauseControl(root);
  root.querySelector('#tetris-finish')?.addEventListener('click', async () => {
    if (!(await confirmDialog('Match wirklich beenden?', { confirmText: 'Beenden', danger: true }))) return;
    const res = await emitWithAck('tetris:match:finish', { matchId: match?.matchId, playerId: myId() });
    if (!res?.ok) showToast(res?.error || 'Beenden fehlgeschlagen.', { error: true });
  });
  root.querySelector('#tetris-leave')?.addEventListener('click', async () => {
    if (!(await confirmDialog('Match wirklich verlassen?', { confirmText: 'Verlassen', danger: true }))) return;
    const res = await emitWithAck('tetris:match:leave', { matchId: match?.matchId, playerId: myId() });
    if (!res?.ok) showToast(res?.error || 'Verlassen fehlgeschlagen.', { error: true });
    else {
      match = null;
      latestState = null;
      cancelCountdown();
      navigate('arcade');
    }
  });
}

// Which shape the control footer currently has to be in: the host sees
// pause/resume plus "Beenden", any other participant only "Verlassen", and a
// non-participant (spectator) or an ended match shows no footer at all.
function matchControlsKind() {
  if (!match || match.ended) return 'none';
  if (match.host?.id === myId()) return 'host';
  return amPlayer() ? 'guest' : 'none';
}

function currentControlsKind(controlsEl) {
  if (!controlsEl) return 'none';
  return controlsEl.querySelector('#tetris-pause, #tetris-resume') ? 'host' : 'guest';
}

// Applies a pause/resume toggle or a host handover to the mounted match
// without ever touching the board canvases: both only change who may act and
// what the footer shows, never the board layout (which is keyed to the local
// player's own perspective, not to the host).
function updateMatchControls() {
  paint();
  const controlsEl = document.querySelector('.arcade-match-controls');
  const desiredKind = matchControlsKind();
  if (desiredKind === currentControlsKind(controlsEl)) {
    if (desiredKind !== 'host') return;
    const button = controlsEl.querySelector('#tetris-pause, #tetris-resume');
    if (button.id === (match.paused ? 'tetris-resume' : 'tetris-pause')) return;
    button.outerHTML = pauseButtonHtml();
    wirePauseControl(document);
    return;
  }
  // The controlling role changed (a host handover, or gaining/losing the
  // ability to act on this match at all) — replace only the controls
  // footer, never the mounted board canvases.
  controlsEl?.remove();
  const html = matchControls();
  if (!html) return;
  document.querySelector('.arcade-game-header-actions')?.insertAdjacentHTML('afterbegin', html);
  wireMatchControls(document);
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

// ---------- Spectator view: the same boards as the players see ----------

export function tetrisSpectatorHtml(state) {
  const refs = state.playerRefs ?? state.players ?? [];
  const arena = state.mode === 'arena';
  const columns = refs
    .map((ref, index) => boardColumn(`tetris-watch-${index}`, ref.name ?? `Spieler ${index + 1}`, { ...ref, id: ref.id ?? ref.playerId }))
    .join('');
  return `<div class="tetris-boards ${arena ? 'is-arena' : 'is-duel'}">
    ${arena ? `<div class="tetris-opponent-grid is-spectator">${columns}</div>` : columns}
  </div>`;
}

export function paintTetrisSpectator(root, state) {
  root.querySelectorAll('[data-tetris-player-id]').forEach((column) => {
    const playerState = (state.players ?? []).find((player) => player.playerId === column.dataset.tetrisPlayerId);
    if (!playerState) return;
    drawBoard(column.querySelector('.tetris-canvas'), playerState);
    const prefix = column.dataset.tetrisPrefix;
    const stats = root.querySelector(`#${prefix}-stats`);
    if (stats) {
      const parts = [`Level ${playerState.level}`, `${playerState.lines} ${playerState.lines === 1 ? 'Zeile' : 'Zeilen'}`, `${playerState.garbageSent ?? 0} gesendet`];
      if (state.mode === 'arena') parts.push(`${playerState.knockouts ?? 0} K.o.`);
      stats.textContent = parts.join(' · ');
    }
    const score = root.querySelector(`#${prefix}-score`);
    if (score) score.textContent = `${playerState.score} Pkt`;
    column.classList.toggle('is-eliminated', !playerState.alive);
  });
}
