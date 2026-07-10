// Scribble (skribbl.io-style draw & guess) — the arcade sub-view for the
// canvas game. Kept as its own controller (rather than folded into arcade.js)
// because it owns a <canvas> that must survive high-frequency updates
// (strokes, hint reveals, chat, score ticks) without the surrounding SPA's
// usual "just re-render the whole container" pattern wiping it out. Those
// events mutate the already-rendered DOM directly; only real phase/turn
// transitions go through the normal ctx.rerender().

import { escapeHtml } from '../format.js';
import { showToast } from '../toast.js';
import { getMyId } from '../whoami.js';

const SWATCHES = ['#1a1a1a', '#e03131', '#f08c00', '#2f9e44', '#1971c2', '#9c36b5', '#495057', '#ffffff'];
const SIZES = [3, 6, 12];

export function createScribbleController(ctx) {
  let socket = null;
  let match = null; // { matchId, host, players, rounds, turnDurationMs, ... }
  let turn = null; // latest arcade:scribble:turn payload
  let wordOptions = null; // when I'm the drawer and phase is 'choosing'
  let mask = null;
  let choiceExpiresAt = null;
  let turnExpiresAt = null;
  let paused = false;
  let pausedRemainingMs = null;
  let lastTurnEnd = null; // { word, reason } shown briefly during 'reveal'
  let matchEnded = null; // { winner, scores } once finished

  let tool = { color: SWATCHES[0], size: SIZES[1], mode: 'pen' }; // mode: 'pen' | 'erase' | 'fill'
  let countdownInterval = null;

  // DOM refs captured after each render of the match area, used for
  // high-frequency updates that must not go through a full ctx.rerender().
  let canvasEl = null;
  let canvas2d = null;
  let maskEl = null;
  let chatLogEl = null;
  let countdownEl = null;
  let toolbarEl = null;

  let drawingPointerId = null;
  let lastLocalPoint = null;
  let currentStrokeId = null;
  let pendingPoints = [];
  let flushScheduled = false;
  // Set only right after a rejoin sync, consumed once by the next canvas
  // setup — a fresh turn always starts with a blank canvas server-side, so
  // this must never linger and get replayed onto a later, unrelated turn.
  let replayStrokesOnNextCanvas = null;

  function isMyMatch() {
    return !!match && match.players.some((p) => p.id === getMyId());
  }

  function isDrawer() {
    return !!turn?.drawer && turn.drawer.id === getMyId();
  }

  function resetMatchState() {
    match = null;
    turn = null;
    wordOptions = null;
    mask = null;
    choiceExpiresAt = null;
    turnExpiresAt = null;
    paused = false;
    pausedRemainingMs = null;
    lastTurnEnd = null;
    matchEnded = null;
    stopCountdown();
  }

  function stopCountdown() {
    if (countdownInterval) clearInterval(countdownInterval);
    countdownInterval = null;
  }

  function secondsLeft() {
    if (paused) return Math.max(0, Math.ceil((pausedRemainingMs ?? 0) / 1000));
    const expiresAt = turn?.phase === 'choosing' ? choiceExpiresAt : turnExpiresAt;
    if (!expiresAt) return 0;
    return Math.max(0, Math.ceil((expiresAt - Date.now()) / 1000));
  }

  function startCountdown() {
    stopCountdown();
    updateCountdown();
    countdownInterval = setInterval(updateCountdown, 1000);
  }

  function updateCountdown() {
    if (!countdownEl) return;
    const left = secondsLeft();
    countdownEl.textContent = paused ? 'Pause' : `${left}s`;
    countdownEl.classList.toggle('badge-paused', paused || left <= 5);
    countdownEl.classList.toggle('badge-playing', !paused && left > 5);
  }

  function setupCanvas(el) {
    canvasEl = el;
    if (!canvasEl) return;
    canvasEl.width = canvasEl.clientWidth;
    canvasEl.height = canvasEl.clientHeight;
    canvas2d = canvasEl.getContext('2d');
    canvas2d.lineJoin = 'round';
    canvas2d.lineCap = 'round';
    replayStrokes(replayStrokesOnNextCanvas ?? []);
    replayStrokesOnNextCanvas = null;
  }

  function replayStrokes(strokes) {
    if (!canvas2d || !canvasEl) return;
    canvas2d.clearRect(0, 0, canvasEl.width, canvasEl.height);
    for (const stroke of strokes) drawStroke(stroke);
  }

  function drawStroke(stroke) {
    if (!canvas2d || !canvasEl) return;
    if (stroke?.type === 'fill') return floodFill(stroke.x, stroke.y, stroke.color);
    if (!stroke?.points?.length) return;
    const w = canvasEl.width;
    const h = canvasEl.height;
    canvas2d.strokeStyle = stroke.erase ? '#ffffff' : stroke.color;
    canvas2d.lineWidth = stroke.size;
    canvas2d.beginPath();
    stroke.points.forEach(([x, y], i) => {
      const px = x * w;
      const py = y * h;
      if (i === 0) canvas2d.moveTo(px, py);
      else canvas2d.lineTo(px, py);
    });
    canvas2d.stroke();
  }

  function drawLocalSegment(from, to) {
    if (!canvas2d || !canvasEl) return;
    canvas2d.strokeStyle = tool.mode === 'erase' ? '#ffffff' : tool.color;
    canvas2d.lineWidth = tool.size;
    canvas2d.beginPath();
    canvas2d.moveTo(from[0] * canvasEl.width, from[1] * canvasEl.height);
    canvas2d.lineTo(to[0] * canvasEl.width, to[1] * canvasEl.height);
    canvas2d.stroke();
  }

  function hexToRgba(hex) {
    const clean = (hex || '#000000').replace('#', '');
    return [parseInt(clean.slice(0, 2), 16) || 0, parseInt(clean.slice(2, 4), 16) || 0, parseInt(clean.slice(4, 6), 16) || 0, 255];
  }

  // Paint-bucket fill, run independently by every client against its own
  // rendered canvas (see the FillOp comment in scribble.ts for why we don't
  // transmit pixels). Iterative stack-based 4-connected fill with a color
  // tolerance, since stroke edges are anti-aliased rather than flat colors.
  function floodFill(xFrac, yFrac, colorHex) {
    if (!canvas2d || !canvasEl) return;
    const w = canvasEl.width;
    const h = canvasEl.height;
    if (w === 0 || h === 0) return;
    const startX = Math.min(w - 1, Math.max(0, Math.round(xFrac * w)));
    const startY = Math.min(h - 1, Math.max(0, Math.round(yFrac * h)));
    const imageData = canvas2d.getImageData(0, 0, w, h);
    const data = imageData.data;
    const startIdx = (startY * w + startX) * 4;
    const target = [data[startIdx], data[startIdx + 1], data[startIdx + 2], data[startIdx + 3]];
    const fillColor = hexToRgba(colorHex);
    const TOLERANCE = 40;
    const matches = (idx) =>
      Math.abs(data[idx] - target[0]) <= TOLERANCE &&
      Math.abs(data[idx + 1] - target[1]) <= TOLERANCE &&
      Math.abs(data[idx + 2] - target[2]) <= TOLERANCE &&
      Math.abs(data[idx + 3] - target[3]) <= TOLERANCE;
    const targetIsFillColor =
      Math.abs(target[0] - fillColor[0]) <= TOLERANCE &&
      Math.abs(target[1] - fillColor[1]) <= TOLERANCE &&
      Math.abs(target[2] - fillColor[2]) <= TOLERANCE &&
      Math.abs(target[3] - fillColor[3]) <= TOLERANCE;
    if (targetIsFillColor) return;

    const visited = new Uint8Array(w * h);
    const stack = [];
    const visit = (x, y) => {
      if (x < 0 || x >= w || y < 0 || y >= h) return;
      const pos = y * w + x;
      if (visited[pos]) return;
      const idx = pos * 4;
      if (!matches(idx)) return;
      visited[pos] = 1;
      data[idx] = fillColor[0];
      data[idx + 1] = fillColor[1];
      data[idx + 2] = fillColor[2];
      data[idx + 3] = fillColor[3];
      stack.push(x, y);
    };
    visit(startX, startY);
    while (stack.length) {
      const y = stack.pop();
      const x = stack.pop();
      visit(x + 1, y);
      visit(x - 1, y);
      visit(x, y + 1);
      visit(x, y - 1);
    }
    canvas2d.putImageData(imageData, 0, 0);
  }

  function pointFromEvent(e) {
    const rect = canvasEl.getBoundingClientRect();
    const x = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    const y = Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height));
    return [x, y];
  }

  function scheduleFlush() {
    if (flushScheduled) return;
    flushScheduled = true;
    requestAnimationFrame(flush);
  }

  function flush() {
    flushScheduled = false;
    if (pendingPoints.length === 0) return;
    const points = pendingPoints;
    pendingPoints = [];
    socket?.emit('arcade:scribble:stroke', {
      matchId: match.matchId,
      playerId: getMyId(),
      strokeId: currentStrokeId,
      color: tool.color,
      size: tool.size,
      erase: tool.mode === 'erase',
      points,
    });
  }

  function newOpId() {
    return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }

  function onPointerDown(e) {
    if (!isDrawer() || turn?.phase !== 'drawing' || paused) return;
    const p = pointFromEvent(e);
    if (tool.mode === 'fill') {
      floodFill(p[0], p[1], tool.color);
      socket?.emit('arcade:scribble:fill', {
        matchId: match.matchId,
        playerId: getMyId(),
        strokeId: newOpId(),
        x: p[0],
        y: p[1],
        color: tool.color,
      });
      return;
    }
    canvasEl.setPointerCapture(e.pointerId);
    drawingPointerId = e.pointerId;
    currentStrokeId = newOpId();
    lastLocalPoint = p;
    pendingPoints = [p];
    scheduleFlush();
  }

  function onPointerMove(e) {
    if (drawingPointerId !== e.pointerId || !lastLocalPoint) return;
    const p = pointFromEvent(e);
    drawLocalSegment(lastLocalPoint, p);
    lastLocalPoint = p;
    pendingPoints.push(p);
    scheduleFlush();
  }

  function endStroke(e) {
    if (drawingPointerId !== e.pointerId) return;
    if (canvasEl?.hasPointerCapture?.(e.pointerId)) canvasEl.releasePointerCapture(e.pointerId);
    drawingPointerId = null;
    lastLocalPoint = null;
    flush();
  }

  function wireCanvas(el) {
    setupCanvas(el);
    if (!canvasEl) return;
    canvasEl.addEventListener('pointerdown', onPointerDown);
    canvasEl.addEventListener('pointermove', onPointerMove);
    canvasEl.addEventListener('pointerup', endStroke);
    canvasEl.addEventListener('pointercancel', endStroke);
  }

  function toolbarHtml() {
    if (!isDrawer() || turn?.phase !== 'drawing') return '';
    const swatches = SWATCHES.map(
      (color) =>
        `<button type="button" class="scribble-swatch ${tool.mode !== 'erase' && tool.color === color ? 'scribble-swatch-active' : ''}" style="background:${color};" data-color="${color}" title="Farbe"></button>`
    ).join('');
    const sizes = SIZES.map(
      (size) =>
        `<button type="button" class="btn btn-sm scribble-size-btn ${tool.mode !== 'erase' && tool.size === size ? 'btn-primary' : ''}" data-size="${size}" title="Stiftgröße"><span style="width:${Math.round(size * 0.8)}px;height:${Math.round(size * 0.8)}px;"></span></button>`
    ).join('');
    return `
      <div class="scribble-toolbar">
        ${swatches}
        <span style="width:1px;height:20px;background:var(--border);"></span>
        ${sizes}
        <button type="button" class="btn btn-sm ${tool.mode === 'erase' ? 'btn-primary' : ''}" id="scribble-erase">Radierer</button>
        <button type="button" class="btn btn-sm ${tool.mode === 'fill' ? 'btn-primary' : ''}" id="scribble-fill">Füllen</button>
        <button type="button" class="btn btn-sm" id="scribble-undo">Rückgängig</button>
        <button type="button" class="btn btn-sm btn-danger" id="scribble-clear">Alles löschen</button>
      </div>`;
  }

  function scoreHtml() {
    if (!turn?.scores) return '';
    return turn.scores
      .map((s) => `<span class="chip">${escapeHtml(s.name)} · ${s.score}</span>`)
      .join('');
  }

  function wordChoiceHtml() {
    if (!wordOptions || turn?.phase !== 'choosing' || !isDrawer()) return '';
    return `
      <div class="card stack" style="margin-top:12px;">
        <strong>Wähl ein Wort zum Zeichnen</strong>
        <div class="grid">
          ${wordOptions
            .map((w) => `<button type="button" class="btn btn-block scribble-word-choice-btn" data-word-id="${w.id}">${escapeHtml(w.word)}</button>`)
            .join('')}
        </div>
      </div>`;
  }

  function matchControlsHtml() {
    if (!match || matchEnded || match.host.id !== getMyId()) return '';
    if (turn?.phase !== 'drawing') return '';
    return `
      <div class="row" style="gap:8px;flex-wrap:wrap;margin-top:10px;">
        ${
          paused
            ? `<button type="button" class="btn btn-sm btn-primary" id="scribble-resume">Fortsetzen</button>`
            : `<button type="button" class="btn btn-sm" id="scribble-pause">Pausieren</button>`
        }
        <button type="button" class="btn btn-sm btn-danger" id="scribble-finish">Beenden</button>
      </div>`;
  }

  function winnerCelebrationHtml() {
    if (!matchEnded?.winner) return '';
    return `
      <div class="card arcade-winner-card">
        <div class="arcade-winner-burst" aria-hidden="true"><span></span><span></span><span></span></div>
        <div class="arcade-winner-crown">🏆</div>
        <div>
          <div class="arcade-winner-label">Gewinner</div>
          <strong>${escapeHtml(matchEnded.winner.name)}</strong>
        </div>
        <div class="chip-list">${(matchEnded.scores ?? []).map((s) => `<span class="chip">${escapeHtml(s.name)} · ${s.score}</span>`).join('')}</div>
      </div>`;
  }

  function statusLineHtml() {
    if (turn?.phase === 'choosing') {
      return isDrawer()
        ? `<div class="muted">Wähl ein Wort…</div>`
        : `<div class="muted">${escapeHtml(turn.drawer.name)} wählt gerade ein Wort…</div>`;
    }
    return `<div class="muted">${isDrawer() ? 'Du zeichnest' : `${escapeHtml(turn?.drawer?.name ?? '')} zeichnet`} · Runde ${turn?.round ?? 1}/${turn?.rounds ?? match?.rounds ?? 1}</div>`;
  }

  function guessFormHtml() {
    if (isDrawer() || turn?.phase !== 'drawing') return '';
    return `
      <form id="scribble-guess-form" class="row" style="margin-top:8px;">
        <input type="text" id="scribble-guess-input" autocomplete="off" placeholder="Dein Tipp" style="flex:1;" ${paused ? 'disabled' : ''} />
        <button type="submit" class="btn btn-primary" ${paused ? 'disabled' : ''}>Raten</button>
      </form>`;
  }

  function renderMatch() {
    if (!match) return '';
    if (matchEnded) {
      return `
        <div class="section-title">✏️ Scribble</div>
        ${winnerCelebrationHtml()}`;
    }

    return `
      <div class="section-title">✏️ Scribble</div>
      <div class="row-between">
        <div class="chip-list">${scoreHtml()}</div>
        <span id="scribble-countdown" class="badge badge-playing">${secondsLeft()}s</span>
      </div>
      ${statusLineHtml()}
      ${matchControlsHtml()}
      ${lastTurnEnd ? `<div class="card stack" style="margin-top:10px;"><strong>Wort war: ${escapeHtml(lastTurnEnd.word ?? '–')}</strong></div>` : ''}
      ${wordChoiceHtml()}
      ${
        turn?.phase === 'drawing'
          ? `
        <div class="card stack" style="margin-top:12px;">
          <div class="scribble-word-mask">${escapeHtml((isDrawer() ? turn.currentWord : mask) ?? mask ?? '')}</div>
          <div class="scribble-canvas-wrap ${!isDrawer() ? 'scribble-canvas-locked' : ''}">
            <canvas id="scribble-canvas"></canvas>
          </div>
          ${toolbarHtml()}
          ${guessFormHtml()}
          <div class="scribble-chat-log" id="scribble-chat-log"></div>
        </div>`
          : ''
      }
    `;
  }

  // Toolbar clicks (color/size/eraser/fill) must never go through
  // ctx.rerender() - that rebuilds the whole container, recreating (and
  // blanking, see setupCanvas) the canvas, since the client has no local
  // record of already-confirmed strokes to replay outside of a rejoin sync.
  // Just toggle the pressed-state classes directly instead.
  function updateToolbarUI() {
    if (!toolbarEl) return;
    toolbarEl.querySelectorAll('[data-color]').forEach((btn) => {
      btn.classList.toggle('scribble-swatch-active', tool.mode !== 'erase' && tool.color === btn.dataset.color);
    });
    toolbarEl.querySelectorAll('[data-size]').forEach((btn) => {
      btn.classList.toggle('btn-primary', tool.mode !== 'erase' && tool.size === Number(btn.dataset.size));
    });
    toolbarEl.querySelector('#scribble-erase')?.classList.toggle('btn-primary', tool.mode === 'erase');
    toolbarEl.querySelector('#scribble-fill')?.classList.toggle('btn-primary', tool.mode === 'fill');
  }

  function wireMatch(container) {
    if (!match || matchEnded) return;
    countdownEl = container.querySelector('#scribble-countdown');
    if (turn?.phase === 'drawing') {
      wireCanvas(container.querySelector('#scribble-canvas'));
      maskEl = container.querySelector('.scribble-word-mask');
      chatLogEl = container.querySelector('#scribble-chat-log');
      toolbarEl = container.querySelector('.scribble-toolbar');
    } else {
      canvasEl = null;
      canvas2d = null;
      toolbarEl = null;
    }
    startCountdown();

    container.querySelectorAll('[data-word-id]').forEach((btn) => {
      btn.addEventListener('click', () => {
        socket.emit('arcade:scribble:word', { matchId: match.matchId, playerId: getMyId(), wordId: btn.dataset.wordId }, (res) => {
          if (!res?.ok) showToast(res?.error || 'Wort konnte nicht gewählt werden.', { error: true });
        });
      });
    });

    container.querySelectorAll('[data-color]').forEach((btn) => {
      btn.addEventListener('click', () => {
        tool = { ...tool, color: btn.dataset.color, mode: tool.mode === 'erase' ? 'pen' : tool.mode };
        updateToolbarUI();
      });
    });
    container.querySelectorAll('[data-size]').forEach((btn) => {
      btn.addEventListener('click', () => {
        tool = { ...tool, size: Number(btn.dataset.size), mode: tool.mode === 'erase' ? 'pen' : tool.mode };
        updateToolbarUI();
      });
    });
    container.querySelector('#scribble-erase')?.addEventListener('click', () => {
      tool = { ...tool, mode: tool.mode === 'erase' ? 'pen' : 'erase' };
      updateToolbarUI();
    });
    container.querySelector('#scribble-fill')?.addEventListener('click', () => {
      tool = { ...tool, mode: tool.mode === 'fill' ? 'pen' : 'fill' };
      updateToolbarUI();
    });
    container.querySelector('#scribble-undo')?.addEventListener('click', () => {
      socket.emit('arcade:scribble:undo', { matchId: match.matchId, playerId: getMyId() });
    });
    container.querySelector('#scribble-clear')?.addEventListener('click', () => {
      socket.emit('arcade:scribble:clear', { matchId: match.matchId, playerId: getMyId() });
    });

    container.querySelector('#scribble-guess-form')?.addEventListener('submit', (e) => {
      e.preventDefault();
      const input = container.querySelector('#scribble-guess-input');
      const text = input.value.trim();
      if (!text) return;
      socket.emit('arcade:scribble:guess', { matchId: match.matchId, playerId: getMyId(), text }, (res) => {
        if (!res?.ok) showToast(res?.error || 'Tipp nicht angenommen.', { error: true });
      });
      input.value = '';
      input.focus();
    });

    container.querySelector('#scribble-pause')?.addEventListener('click', () => {
      socket.emit('arcade:match:pause', { matchId: match.matchId, playerId: getMyId() }, (res) => {
        if (!res?.ok) showToast(res?.error || 'Pausieren fehlgeschlagen.', { error: true });
      });
    });
    container.querySelector('#scribble-resume')?.addEventListener('click', () => {
      socket.emit('arcade:match:resume', { matchId: match.matchId, playerId: getMyId() }, (res) => {
        if (!res?.ok) showToast(res?.error || 'Fortsetzen fehlgeschlagen.', { error: true });
      });
    });
    container.querySelector('#scribble-finish')?.addEventListener('click', () => {
      if (!confirm('Match wirklich beenden?')) return;
      socket.emit('arcade:match:finish', { matchId: match.matchId, playerId: getMyId() }, (res) => {
        if (!res?.ok) showToast(res?.error || 'Beenden fehlgeschlagen.', { error: true });
      });
    });
  }

  function appendChatLine(payload) {
    if (!chatLogEl) return;
    const line = document.createElement('div');
    if (payload.correct) {
      line.className = 'scribble-chat-correct';
      line.textContent = `✅ ${payload.name} hat's erraten! (+${payload.points})`;
    } else {
      line.textContent = `${payload.name}: ${payload.text}`;
    }
    chatLogEl.append(line);
    chatLogEl.scrollTop = chatLogEl.scrollHeight;
  }

  function registerSocket(s) {
    socket = s;

    socket.on('arcade:match:start', (payload) => {
      if (payload.gameType !== 'scribble') return;
      resetMatchState();
      match = payload;
      ctx.rerender();
    });

    socket.on('arcade:scribble:choose', (payload) => {
      if (!match || payload.matchId !== match.matchId) return;
      wordOptions = payload.options;
      choiceExpiresAt = payload.expiresAt;
      ctx.rerender();
    });

    // Private to the drawer's own socket — the real word text, sent
    // separately from the room-wide `arcade:scribble:turn` broadcast (which
    // only ever carries the masked version) so it works whether the drawer
    // picked a word themselves or it was auto-chosen on a choice timeout.
    socket.on('arcade:scribble:word-chosen', (payload) => {
      if (!match || payload.matchId !== match.matchId) return;
      if (turn) turn = { ...turn, currentWord: payload.word };
      ctx.rerender();
    });

    socket.on('arcade:scribble:turn', (payload) => {
      if (!match || payload.matchId !== match.matchId) return;
      turn = payload;
      mask = payload.mask ?? null;
      wordOptions = payload.phase === 'choosing' ? wordOptions : null;
      choiceExpiresAt = payload.phase === 'choosing' ? payload.expiresAt : null;
      turnExpiresAt = payload.phase === 'drawing' ? payload.expiresAt : null;
      lastTurnEnd = null;
      paused = false;
      ctx.rerender();
    });

    // Broadcast from the drawer's strokes/clear — draw directly onto the
    // already-rendered canvas rather than going through ctx.rerender(),
    // since a full container rebuild would recreate (and blank) it.
    socket.on('arcade:scribble:stroke', (payload) => {
      if (!match || payload.matchId !== match.matchId || isDrawer()) return;
      drawStroke(payload);
    });

    socket.on('arcade:scribble:clear', (payload) => {
      if (!match || payload.matchId !== match.matchId) return;
      if (canvas2d && canvasEl) canvas2d.clearRect(0, 0, canvasEl.width, canvasEl.height);
    });

    socket.on('arcade:scribble:fill', (payload) => {
      if (!match || payload.matchId !== match.matchId || isDrawer()) return;
      floodFill(payload.x, payload.y, payload.color);
    });

    // Undo replaces the whole canvas from the server's authoritative reduced
    // stroke list — unlike a live stroke broadcast, this must also apply to
    // the drawer themself (their own canvas already shows the now-undone
    // stroke from local real-time drawing).
    socket.on('arcade:scribble:redraw', (payload) => {
      if (!match || payload.matchId !== match.matchId) return;
      replayStrokes(payload.strokes ?? []);
    });

    socket.on('arcade:scribble:hint', (payload) => {
      if (!match || payload.matchId !== match.matchId) return;
      mask = payload.mask;
      if (maskEl && !isDrawer()) maskEl.textContent = mask;
    });

    socket.on('arcade:scribble:chat', (payload) => {
      if (!match || payload.matchId !== match.matchId) return;
      appendChatLine(payload);
    });

    socket.on('arcade:scribble:scores', (payload) => {
      if (!match || payload.matchId !== match.matchId || !turn) return;
      turn = { ...turn, scores: payload.scores };
    });

    socket.on('arcade:scribble:turn-end', (payload) => {
      if (!match || payload.matchId !== match.matchId) return;
      lastTurnEnd = { word: payload.word, reason: payload.reason };
      if (turn) turn = { ...turn, scores: payload.scores, phase: 'reveal' };
      turnExpiresAt = null;
      choiceExpiresAt = null;
      stopCountdown();
      ctx.rerender();
    });

    socket.on('arcade:match:end', (payload) => {
      if (!match || payload.matchId !== match.matchId) return;
      matchEnded = { winner: payload.winner, scores: payload.scores };
      stopCountdown();
      ctx.rerender();
    });

    socket.on('arcade:match:paused', (payload) => {
      if (!match || payload.matchId !== match.matchId) return;
      paused = true;
      pausedRemainingMs = payload.remainingMs;
      stopCountdown();
      updateCountdown();
      if (canvasEl) canvasEl.style.pointerEvents = 'none';
    });

    socket.on('arcade:match:resumed', (payload) => {
      if (!match || payload.matchId !== match.matchId) return;
      paused = false;
      pausedRemainingMs = null;
      turnExpiresAt = payload.expiresAt;
      startCountdown();
      if (canvasEl) canvasEl.style.pointerEvents = '';
    });

    socket.on('arcade:scribble:presence', (payload) => {
      if (!match || payload.matchId !== match.matchId) return;
      const player = match.players.find((p) => p.id === payload.playerId);
      if (!player) return;
      showToast(payload.online ? `${player.name} ist wieder da.` : `${player.name} hat die Verbindung verloren.`);
    });

    socket.on('connect', () => {
      if (!match || matchEnded) return;
      socket.emit('arcade:scribble:rejoin', { matchId: match.matchId, playerId: getMyId() }, (res) => {
        if (!res?.ok) return;
        const sync = res.sync;
        replayStrokesOnNextCanvas = sync.strokes;
        match = { matchId: sync.matchId, host: sync.host, players: sync.players, rounds: sync.rounds, turnDurationMs: sync.turnDurationMs };
        turn = {
          matchId: sync.matchId,
          phase: sync.phase,
          drawer: sync.drawer,
          round: sync.round,
          rounds: sync.rounds,
          scores: sync.scores,
          currentWord: sync.word,
        };
        mask = sync.mask;
        wordOptions = sync.wordOptions;
        choiceExpiresAt = sync.phase === 'choosing' ? sync.expiresAt : null;
        turnExpiresAt = sync.phase === 'drawing' ? sync.expiresAt : null;
        paused = sync.paused;
        ctx.rerender();
      });
    });
  }

  return {
    registerSocket,
    hasMatch: () => !!match,
    isMyMatch,
    renderMatch,
    wireMatch,
  };
}

export { SWATCHES, SIZES };
