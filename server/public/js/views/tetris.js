// Tetris 1v1 "Battle" — the Arcade's realtime game view.
//
// The server (src/arcade/tetris.ts) is authoritative: it owns both boards and
// pushes full `tetris:state` snapshots. This view only sends intents
// (left/right/rotate/drop) and paints whatever comes back. Because the board is
// a discrete grid, snapshots redraw the two <canvas> boards directly instead of
// rebuilding the DOM — a full ctx.rerender() only runs on phase changes (lobby
// <-> match <-> result), never per frame, so the canvases never flicker.

import { getToken } from '../api.js';
import { escapeHtml } from '../format.js';
import { showToast } from '../toast.js';
import { getMyId, whoAmICardHtml, wireWhoAmICard } from '../whoami.js';

const COLS = 10;
const ROWS = 20;

// Per-cell colours: 1-7 tetrominoes, 8 = garbage. Distinct hues so a busy
// board stays readable at a glance, tuned to sit on the app's dark canvas.
const COLORS = {
  1: '#22d3ee', // I
  2: '#eab308', // O
  3: '#22c55e', // S
  4: '#ef4444', // Z
  5: '#3b82f6', // J
  6: '#a855f7', // T
  7: '#f97316', // L
  8: '#5b6577', // garbage
};

let socket = null;
let ctxRef = null;
let lobbies = [];
let match = null; // { matchId, host, players, beginsAt, running, paused, ended, winner }
let latestState = null; // last tetris:state payload
let countdownTimer = null;
let inputBound = false;

function myId() {
  return getMyId();
}

function amPlayer() {
  return Boolean(match && match.players?.some((p) => p.id === myId()));
}

function myLobby() {
  return lobbies.find((l) => l.players.some((p) => p.id === myId())) ?? null;
}

function stopCountdown() {
  if (countdownTimer) clearInterval(countdownTimer);
  countdownTimer = null;
}

function ensureSocket() {
  if (socket) return socket;
  socket = io({ auth: { token: getToken() } });

  socket.on('tetris:lobbies', (payload) => {
    lobbies = payload?.lobbies ?? [];
    // Only rebuild the DOM while we're in the lobby phase; never interrupt a
    // running match's canvases.
    if (!match) ctxRef?.rerender();
  });

  socket.on('tetris:match:start', (payload) => {
    match = { ...payload, running: false, paused: false, ended: false, winner: null };
    latestState = null;
    ctxRef?.rerender();
    startCountdown();
  });

  socket.on('tetris:state', (payload) => {
    latestState = payload;
    if (match) {
      match.running = payload.running;
      match.paused = payload.paused;
    }
    // Fast path: if the game shell is already mounted, repaint directly.
    if (document.querySelector('#tetris-boards')) {
      paint();
    } else {
      ctxRef?.rerender();
    }
  });

  socket.on('tetris:match:paused', () => {
    if (match) match.paused = true;
    paintOverlay();
  });

  socket.on('tetris:match:resumed', () => {
    if (match) match.paused = false;
    paintOverlay();
  });

  socket.on('tetris:match:end', (payload) => {
    if (!match) return;
    match.ended = true;
    match.running = false;
    match.winner = payload.winner ?? null;
    match.endScores = payload.scores ?? null;
    stopCountdown();
    ctxRef?.rerender();
  });

  socket.on('tetris:opponent-left', () => {
    if (!match) return;
    showToast('Gegner hat das Match verlassen.', { error: true });
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

// A single global keydown listener, gated on the game shell being mounted so it
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

function secondsUntilStart() {
  if (!match?.beginsAt) return 0;
  return Math.max(0, Math.ceil((match.beginsAt - Date.now()) / 1000));
}

function startCountdown() {
  stopCountdown();
  paintOverlay();
  countdownTimer = setInterval(() => {
    paintOverlay();
    if (secondsUntilStart() <= 0) stopCountdown();
  }, 200);
}

// ---------- Canvas painting ----------

function drawBoard(canvas, playerState) {
  if (!canvas || !playerState) return;
  const cell = Math.floor(canvas.width / COLS);
  const cx = canvas.getContext('2d');
  cx.clearRect(0, 0, canvas.width, canvas.height);

  // Background + faint grid.
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

  const paintCell = (x, y, color) => {
    cx.fillStyle = color;
    cx.fillRect(x * cell + 1, y * cell + 1, cell - 2, cell - 2);
    cx.fillStyle = 'rgba(255,255,255,0.18)';
    cx.fillRect(x * cell + 1, y * cell + 1, cell - 2, 3);
  };

  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < COLS; x++) {
      const v = playerState.board[y]?.[x];
      if (v) paintCell(x, y, COLORS[v] || '#888');
    }
  }
  if (playerState.current) {
    const color = COLORS[playerState.current.color] || '#fff';
    for (const [x, y] of playerState.current.cells) {
      if (y >= 0) paintCell(x, y, color);
    }
  }

  // Dim a dead board so it's obvious who topped out.
  if (!playerState.alive) {
    cx.fillStyle = 'rgba(6, 9, 18, 0.55)';
    cx.fillRect(0, 0, canvas.width, canvas.height);
  }
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

function paint() {
  if (!latestState) return;
  const me = latestState.players.find((p) => p.playerId === myId());
  const opp = latestState.players.find((p) => p.playerId !== myId());
  // Spectators (neither player) still get a sensible left/right split.
  const left = me ?? latestState.players[0];
  const right = me ? opp : latestState.players[1];
  drawBoard(document.querySelector('#tetris-mine'), left);
  drawBoard(document.querySelector('#tetris-opponent'), right);
  updateStatLine('tetris-mine', left);
  updateStatLine('tetris-opponent', right);
  paintOverlay();
}

function paintOverlay() {
  const overlay = document.querySelector('#tetris-overlay');
  if (!overlay) return;
  if (match?.paused) {
    overlay.hidden = false;
    overlay.innerHTML = `<div class="tetris-overlay-text">Pause</div>`;
    return;
  }
  const left = secondsUntilStart();
  if (match && !match.running && left > 0) {
    overlay.hidden = false;
    overlay.innerHTML = `<div class="tetris-overlay-text tetris-countdown">${left}</div>`;
    return;
  }
  overlay.hidden = true;
  overlay.innerHTML = '';
}

// ---------- DOM rendering (phase changes only) ----------

function renderLobbyList() {
  const mine = myLobby();
  if (lobbies.length === 0) return `<div class="empty-state" style="padding:14px;">Keine offene Tetris-Lobby.</div>`;
  return lobbies
    .map((l) => {
      const joined = l.players.some((p) => p.id === myId());
      const full = l.players.length >= 2 && !joined;
      return `
        <div class="lb-row" style="align-items:flex-start;">
          <div class="stack" style="gap:6px;flex:1;">
            <strong>${escapeHtml(l.host.name)}s Tetris-Lobby</strong>
            <div class="chip-list">${l.players.map((p) => `<span class="chip">${escapeHtml(p.name)}</span>`).join('')}</div>
            <div class="muted" style="font-size:0.78rem;">${l.players.length}/2 Spieler${full ? ' · voll' : ''}</div>
          </div>
          ${
            joined
              ? `<span class="badge badge-playing">Drin</span>`
              : `<button type="button" class="btn btn-sm btn-primary" data-join-lobby="${l.id}" ${mine || full ? 'disabled' : ''}>Beitreten</button>`
          }
        </div>`;
    })
    .join('');
}

function lobbyHostControls() {
  const lobby = myLobby();
  if (!lobby || lobby.host.id !== myId()) return '';
  const ready = lobby.players.length === 2;
  return `
    <div class="card stack" style="margin-top:12px;">
      <strong>Deine Lobby</strong>
      <div class="muted" style="font-size:0.8rem;">${ready ? 'Bereit — beide Spieler da.' : 'Warte auf einen zweiten Spieler…'}</div>
      <button type="button" class="btn btn-primary btn-block" id="tetris-start" ${ready ? '' : 'disabled'}>Battle starten</button>
    </div>`;
}

function renderLobbyPhase() {
  const lobby = myLobby();
  return `
    <button type="button" class="btn btn-sm" data-navigate="arcade">‹ Arcade</button>
    <h1 class="view-title">🧩 Tetris Battle</h1>
    ${whoAmICardHtml('tetris-whoami')}
    <div class="card stack" style="margin-top:12px;">
      <div class="row-between" style="gap:10px;">
        <div>
          <strong>1 gegen 1</strong>
          <div class="muted" style="font-size:0.8rem;">Gleiche Steine für beide. 2+ Reihen schicken Müll rüber. Wer oben rausbaut, verliert.</div>
        </div>
        <button type="button" class="btn btn-primary btn-sm" id="tetris-create" ${lobby ? 'disabled' : ''}>Lobby öffnen</button>
      </div>
      ${renderLobbyList()}
    </div>
    ${lobbyHostControls()}`;
}

function endResultHtml() {
  if (!match?.ended) return '';
  const winner = match.winner;
  const iWon = winner && winner.id === myId();
  const label = winner ? (iWon ? 'Du gewinnst! 🎉' : `${escapeHtml(winner.name)} gewinnt`) : 'Unentschieden';
  const scores = (match.endScores ?? [])
    .map((s) => `<span class="chip">${escapeHtml(s.name)} · ${s.score} Pkt · ${s.lines} Z</span>`)
    .join('');
  return `
    <div class="card arcade-winner-card" style="margin-top:12px;">
      <div class="arcade-winner-burst" aria-hidden="true"><span></span><span></span><span></span></div>
      <div class="arcade-winner-crown">🏆</div>
      <div>
        <div class="arcade-winner-label">Ergebnis</div>
        <strong>${label}</strong>
      </div>
      <div class="chip-list">${scores}</div>
      <button type="button" class="btn btn-primary" id="tetris-back">Zurück zur Lobby</button>
    </div>`;
}

function boardColumn(prefix, size, label) {
  const w = size;
  const h = size * 2;
  return `
    <div class="tetris-board-col">
      <div class="tetris-board-label">${label}</div>
      <div class="tetris-canvas-wrap">
        <canvas id="${prefix}" width="${w}" height="${h}" class="tetris-canvas"></canvas>
        ${prefix === 'tetris-mine' ? `<div id="tetris-overlay" class="tetris-overlay" hidden></div>` : ''}
        <div id="${prefix}-incoming" class="tetris-incoming"></div>
      </div>
      <div id="${prefix}-stats" class="muted tetris-stats-line"></div>
    </div>`;
}

function touchControls() {
  if (!amPlayer()) return '';
  return `
    <div class="tetris-controls">
      <button type="button" class="btn tetris-ctrl" data-action="left" aria-label="Links">◀</button>
      <button type="button" class="btn tetris-ctrl" data-action="rotate" aria-label="Drehen">⟳</button>
      <button type="button" class="btn tetris-ctrl" data-action="right" aria-label="Rechts">▶</button>
      <button type="button" class="btn tetris-ctrl" data-action="soft" aria-label="Runter">▼</button>
      <button type="button" class="btn tetris-ctrl tetris-ctrl-drop" data-action="hard" aria-label="Fallen lassen">⤓</button>
    </div>`;
}

function matchControls() {
  if (!match || match.ended || match.host?.id !== myId()) return '';
  return `
    <div class="row" style="gap:8px;flex-wrap:wrap;margin-top:10px;justify-content:center;">
      ${
        match.paused
          ? `<button type="button" class="btn btn-sm btn-primary" id="tetris-resume">Fortsetzen</button>`
          : `<button type="button" class="btn btn-sm" id="tetris-pause">Pausieren</button>`
      }
      <button type="button" class="btn btn-sm btn-danger" id="tetris-finish">Beenden</button>
    </div>`;
}

function renderMatchPhase() {
  const opponent = match.players.find((p) => p.id !== myId());
  const oppLabel = amPlayer() ? escapeHtml(opponent?.name ?? 'Gegner') : escapeHtml(match.players[1]?.name ?? 'Spieler 2');
  const meLabel = amPlayer() ? 'Du' : escapeHtml(match.players[0]?.name ?? 'Spieler 1');
  return `
    <h1 class="view-title">🧩 Tetris Battle</h1>
    <div id="tetris-game">
      <div id="tetris-boards" class="tetris-boards">
        ${boardColumn('tetris-mine', 220, meLabel)}
        ${boardColumn('tetris-opponent', 150, oppLabel)}
      </div>
      ${touchControls()}
      ${matchControls()}
      ${endResultHtml()}
      <div class="muted tetris-help">Steuerung: ◀ ▶ bewegen · ⟳ (Pfeil hoch) drehen · ▼ schneller · Leertaste fallen lassen</div>
    </div>`;
}

export function renderTetris(container, ctx) {
  ctxRef = ctx;
  ensureSocket();

  if (match) {
    container.innerHTML = renderMatchPhase();
    // Paint immediately from the latest snapshot (canvas is freshly mounted).
    paint();
    wireMatch(container);
  } else {
    container.innerHTML = renderLobbyPhase();
    wireWhoAmICard(container, 'tetris-whoami', ctx);
    wireLobby(container);
  }
}

function wireLobby(container) {
  container.querySelector('#tetris-create')?.addEventListener('click', async () => {
    const playerId = myId();
    if (!playerId) return showToast('Bitte zuerst auswählen, wer du bist.', { error: true });
    const res = await emitWithAck('tetris:lobby:create', { playerId });
    if (!res?.ok) return showToast(res?.error || 'Lobby konnte nicht erstellt werden.', { error: true });
    showToast('Tetris-Lobby geöffnet.');
  });

  container.querySelectorAll('[data-join-lobby]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const playerId = myId();
      if (!playerId) return showToast('Bitte zuerst auswählen, wer du bist.', { error: true });
      const res = await emitWithAck('tetris:lobby:join', { lobbyId: btn.dataset.joinLobby, playerId });
      if (!res?.ok) showToast(res?.error || 'Beitritt fehlgeschlagen.', { error: true });
    });
  });

  container.querySelector('#tetris-start')?.addEventListener('click', async () => {
    const lobby = myLobby();
    if (!lobby) return;
    const res = await emitWithAck('tetris:lobby:start', { lobbyId: lobby.id, playerId: myId() });
    if (!res?.ok) showToast(res?.error || 'Start fehlgeschlagen.', { error: true });
  });
}

function wireMatch(container) {
  container.querySelectorAll('[data-action]').forEach((btn) => {
    // Use pointerdown so mobile taps register instantly without the 300ms
    // click delay, and so holding repeats feel responsive.
    btn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      sendInput(btn.dataset.action);
    });
  });

  container.querySelector('#tetris-pause')?.addEventListener('click', async () => {
    const res = await emitWithAck('tetris:match:pause', { matchId: match?.matchId, playerId: myId() });
    if (!res?.ok) showToast(res?.error || 'Pausieren fehlgeschlagen.', { error: true });
  });
  container.querySelector('#tetris-resume')?.addEventListener('click', async () => {
    const res = await emitWithAck('tetris:match:resume', { matchId: match?.matchId, playerId: myId() });
    if (!res?.ok) showToast(res?.error || 'Fortsetzen fehlgeschlagen.', { error: true });
  });
  container.querySelector('#tetris-finish')?.addEventListener('click', async () => {
    if (!confirm('Match wirklich beenden?')) return;
    const res = await emitWithAck('tetris:match:finish', { matchId: match?.matchId, playerId: myId() });
    if (!res?.ok) showToast(res?.error || 'Beenden fehlgeschlagen.', { error: true });
  });

  container.querySelector('#tetris-back')?.addEventListener('click', () => {
    match = null;
    latestState = null;
    stopCountdown();
    ctxRef?.rerender();
  });
}
