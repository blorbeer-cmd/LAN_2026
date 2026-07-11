import { api, getToken } from '../api.js';
import { escapeHtml } from '../format.js';
import { showToast } from '../toast.js';
import { icon } from '../icons.js';
import { getMyId, whoAmICardHtml, wireWhoAmICard } from '../whoami.js';
import { getAdminPin, isAdmin } from '../admin.js';
import { ensureTetrisSocket, renderTetrisLobbyCard, wireTetrisLobbyCard, myTetrisLobby } from './tetris.js';
import {
  ensureScribbleSocket,
  renderScribbleLobbyCard,
  wireScribbleLobbyCard,
  myScribbleLobby,
  hasScribbleMatch,
} from './arcadeScribble.js';
import { ensureBlobbySocket, renderBlobbyLobbyCard, wireBlobbyLobbyCard, myBlobbyLobby, hasBlobbyMatch } from './blobby.js';
import { ensureSnakeSocket, renderSnakeLobbyCard, wireSnakeLobbyCard, mySnakeLobby, hasSnakeMatch } from './snake.js';
import { arcadeInfoGridHtml, matchRosterHtml } from './arcadeUi.js';
import { confirmDialog } from '../modal.js';
import { showCountdown, cancelCountdown } from '../countdown.js';
import { lobbyPlayerChipsHtml, readySummaryText, readyToggleHtml, wireReadyToggle } from '../lobbyReady.js';

// The Arcade opens as a launcher: a compact grid of game tiles. Picking one
// reveals that game's lobby below. Quiz, Tetris and Scribble are live; the
// rest are placeholders for games still to come.
const GAMES = [
  { id: 'quiz', icon: icon('brain'), name: 'Gaming-Quiz' },
  { id: 'tetris', icon: '🧩', name: 'Tetris' },
  { id: 'scribble', icon: icon('pencil'), name: 'Scribble' },
  { id: 'pong', icon: icon('gitCommitVertical'), name: 'Pong', soon: true },
  { id: 'blobby', icon: icon('volleyball'), name: 'Blobby Volley' },
  { id: 'snake', icon: icon('snake'), name: 'Snake' },
];

let socket = null;
let lobbies = [];
let stats = null;
let statsLoading = false;
let activeStatsGame = null;
let activeGame = null; // which game tile is expanded
let match = null;
let currentQuestion = null;
let lastResult = null;
let countdownInterval = null;
let customTarget = '';

// The Tetris view lives in its own module; when one of its matches finishes it
// fires this so our cached highscores refetch the next time Arcade renders.
window.addEventListener('lan:arcade-stats-dirty', () => {
  stats = null;
});

function stopCountdown() {
  if (countdownInterval) clearInterval(countdownInterval);
  countdownInterval = null;
}

function updateCountdownBadge() {
  const badge = document.querySelector('#quiz-countdown');
  if (!badge) return;
  const left = secondsLeft();
  badge.textContent = `${left}s`;
  badge.classList.toggle('badge-paused', left <= 5);
  badge.classList.toggle('badge-playing', left > 5);
}

function startCountdown() {
  stopCountdown();
  updateCountdownBadge();
  countdownInterval = setInterval(updateCountdownBadge, 1000);
}

async function loadStats(ctx) {
  if (statsLoading) return;
  statsLoading = true;
  try {
    stats = await api.arcade.stats();
  } catch (err) {
    showToast(err.message, { error: true });
    stats = { games: [] };
  } finally {
    statsLoading = false;
    ctx.rerender();
  }
}

function ensureSocket(ctx) {
  if (socket) return socket;
  socket = io({ auth: { token: getToken() } });
  socket.on('arcade:lobbies', (payload) => {
    lobbies = payload?.lobbies ?? [];
    ctx.rerender();
  });
  socket.on('arcade:match:start', (payload) => {
    match = { ...payload, scores: payload.players.map((p) => ({ playerId: p.id, name: p.name, score: 0 })), paused: false };
    currentQuestion = null;
    lastResult = null;
    stopCountdown();
    navigate('quizRoom'); // hand over to the dedicated match view
    showCountdown(payload.beginsAt);
  });
  socket.on('arcade:quiz:question', (payload) => {
    currentQuestion = payload;
    if (payload.scores) match = { ...(match ?? {}), matchId: payload.matchId, scores: payload.scores, targetScore: payload.targetScore };
    lastResult = null;
    startCountdown();
    ctx.rerender();
  });
  socket.on('arcade:quiz:result', (payload) => {
    lastResult = payload;
    if (payload.scores) match = { ...(match ?? {}), scores: payload.scores };
    currentQuestion = null;
    stopCountdown();
    ctx.rerender();
  });
  socket.on('arcade:quiz:timeout', (payload) => {
    lastResult = { winner: null, correctAnswer: payload.correctAnswer, timeout: true };
    if (payload.scores) match = { ...(match ?? {}), scores: payload.scores };
    currentQuestion = null;
    stopCountdown();
    ctx.rerender();
  });
  socket.on('arcade:match:end', (payload) => {
    lastResult = payload.winner ? { winner: payload.winner, correctAnswer: 'Match beendet' } : lastResult;
    if (payload.scores) match = { ...(match ?? {}), scores: payload.scores, ended: true, winner: payload.winner };
    currentQuestion = null;
    stopCountdown();
    cancelCountdown();
    stats = null;
    loadStats(ctx);
    ctx.rerender();
  });
  socket.on('arcade:match:paused', (payload) => {
    if (payload.scores) match = { ...(match ?? {}), scores: payload.scores, paused: true, remainingMs: payload.remainingMs };
    stopCountdown();
    ctx.rerender();
  });
  socket.on('arcade:match:resumed', (payload) => {
    if (payload.scores) match = { ...(match ?? {}), scores: payload.scores, paused: false, remainingMs: null };
    if (currentQuestion && payload.expiresAt) currentQuestion = { ...currentQuestion, expiresAt: payload.expiresAt };
    startCountdown();
    ctx.rerender();
  });
  socket.on('arcade:match:opponent-left', () => {
    showToast('Ein Spieler hat das Match verlassen.', { error: true });
    match = null;
    currentQuestion = null;
    lastResult = null;
    stopCountdown();
    cancelCountdown();
    navigate('arcade');
  });
  return socket;
}

function navigate(view) {
  window.dispatchEvent(new CustomEvent('lan:navigate', { detail: view }));
}

function emitWithAck(event, payload) {
  return new Promise((resolve) => {
    socket.emit(event, payload, resolve);
  });
}

function myLobby() {
  const myId = getMyId();
  return lobbies.find((l) => l.players.some((p) => p.id === myId)) ?? null;
}

function arcadeStatsHtml() {
  if (!stats && !statsLoading) return '';
  if (statsLoading && !stats) return `<div class="empty-state" style="padding:var(--space-4);">Statistiken laden…</div>`;
  const games = stats?.games ?? [];
  if (!games.length) return `<div class="empty-state" style="padding:var(--space-4);">Noch keine abgeschlossenen Arcade-Runden.</div>`;
  if (!games.some((g) => g.gameType === activeStatsGame)) activeStatsGame = games[0].gameType;

  const tabs =
    games.length > 1
      ? `<div class="row" style="gap:var(--space-2);flex-wrap:wrap;">${games
          .map(
            (g) =>
              `<button type="button" class="btn btn-sm ${g.gameType === activeStatsGame ? 'btn-primary' : ''}" data-stats-tab="${g.gameType}">${escapeHtml(g.title)}</button>`
          )
          .join('')}</div>`
      : '';

  const game = games.find((g) => g.gameType === activeStatsGame);
  const winLoss = game.rankingMode === 'winLoss';
  const medals = ['🥇', '🥈', '🥉'];
  const rows = game.players
    .slice(0, 5)
    .map(
      (p, i) => `
        <div class="lb-row">
          <span>${medals[i] ?? `${i + 1}.`} ${escapeHtml(p.name)}</span>
          <span class="muted" style="font-variant-numeric:tabular-nums;">${winLoss ? `${p.wins}–${p.losses} · ${Math.round(p.winRate * 100)}%` : `${p.best} Pkt`}</span>
        </div>`
    )
    .join('');
  return `
    ${tabs}
    <div class="arcade-stat-game">
      <div class="row-between">
        <strong>${escapeHtml(game.title)} · ${winLoss ? 'W–L-Ratio' : 'Highscores'}</strong>
        <span class="badge">${game.matches} Match(es)</span>
      </div>
      ${rows}
    </div>`;
}

function targetControls(lobby) {
  const myId = getMyId();
  if (!lobby || lobby.host.id !== myId) return '';
  return `
    <div class="card stack" style="margin-top:var(--space-3);">
      <strong>Start</strong>
      <div class="row" style="gap:var(--space-2);flex-wrap:wrap;">
        <label class="check-row" style="padding:var(--space-2) var(--space-3);"><input type="radio" name="target-score" value="5" checked />5</label>
        <label class="check-row" style="padding:var(--space-2) var(--space-3);"><input type="radio" name="target-score" value="10" />10</label>
        <label class="check-row" style="padding:var(--space-2) var(--space-3);"><input type="radio" name="target-score" value="20" />20</label>
        <label class="row" style="gap:var(--space-2);align-items:center;">
          <input type="radio" name="target-score" value="custom" />
          <input type="number" id="target-custom" min="1" max="100" value="${escapeHtml(customTarget)}" placeholder="frei" style="width:78px;" />
        </label>
      </div>
      <div class="muted" style="font-size:var(--font-size-xs);">${readySummaryText(lobby)}</div>
      <button type="button" class="btn btn-primary btn-block" id="quiz-start-lobby" ${lobby.players.length < 2 ? 'disabled' : ''}>Start</button>
    </div>`;
}

function renderLobbyList() {
  const mine = myLobby();
  if (lobbies.length === 0) return `<div class="empty-state" style="padding:var(--space-4);">Keine offene Quiz-Lobby.</div>`;
  return lobbies
    .map((l) => {
      const isHost = l.host.id === getMyId();
      const joined = l.players.some((p) => p.id === getMyId());
      const action = isHost
        ? `<button type="button" class="btn btn-sm btn-equal btn-danger" data-close-lobby="${l.id}">Schließen</button>`
        : joined
          ? readyToggleHtml(l, getMyId(), 'quiz-ready')
          : `<button type="button" class="btn btn-sm btn-equal btn-primary" data-join-lobby="${l.id}" ${mine ? 'disabled' : ''}>Beitreten</button>`;
      return `
        <div class="lb-row" style="align-items:flex-start;">
          <div class="stack" style="gap:var(--space-2);flex:1;">
            <strong>${escapeHtml(l.host.name)}s Quiz-Lobby</strong>
            <div class="chip-list">${lobbyPlayerChipsHtml(l)}</div>
            <div class="muted" style="font-size:var(--font-size-xs);">${l.players.length} Spieler · ${readySummaryText(l)}</div>
          </div>
          ${action}
        </div>`;
    })
    .join('');
}

function secondsLeft() {
  if (match?.paused) return Math.max(0, Math.ceil((match.remainingMs ?? 0) / 1000));
  if (!currentQuestion?.expiresAt) return 0;
  return Math.max(0, Math.ceil((currentQuestion.expiresAt - Date.now()) / 1000));
}

function matchControlsHtml() {
  if (!match || match.ended || match.host?.id !== getMyId()) return '';
  return `
    <div class="arcade-match-controls">
      ${
        match.paused
          ? `<button type="button" class="btn btn-sm btn-equal btn-primary" id="quiz-resume">Fortsetzen</button>`
          : `<button type="button" class="btn btn-sm btn-equal" id="quiz-pause">Pausieren</button>`
      }
      <button type="button" class="btn btn-sm btn-equal btn-danger" id="quiz-finish">Beenden</button>
    </div>`;
}

function renderMatch() {
  if (!match) return '';
  const winnerId = match.winner?.id ?? lastResult?.winner?.id ?? null;
  const roster = matchRosterHtml(match.players, {
    winnerId,
    scoreFor: (player) => {
      const score = match.scores?.find((s) => s.playerId === player.id)?.score ?? 0;
      return `${score}/${match.targetScore ?? 5}`;
    },
  });
  const result = lastResult && !match.ended
    ? `<div class="card quiz-stage-card" style="margin-top:var(--space-3);">
        <div class="quiz-stage-content quiz-round-result"><h2>${escapeHtml(lastResult.correctAnswer ?? '')}</h2></div>
      </div>`
    : '';
  const question = currentQuestion
    ? `
      <div class="card quiz-stage-card" style="margin-top:var(--space-3);">
      <form id="quiz-answer-form" class="stack quiz-stage-content">
        <div class="row-between">
          <div class="muted">${escapeHtml(currentQuestion.category || 'Quiz')} · ${escapeHtml(currentQuestion.difficulty || 'offen')}</div>
          <span id="quiz-countdown" class="badge ${secondsLeft() <= 5 ? 'badge-paused' : 'badge-playing'}">${match.paused ? 'Pause' : `${secondsLeft()}s`}</span>
        </div>
        <h2 style="font-size:var(--font-size-lg);margin:0;">${escapeHtml(currentQuestion.question)}</h2>
        <div class="row">
          <input type="text" id="quiz-answer" autocomplete="off" placeholder="Antwort" style="flex:1;" ${match.paused ? 'disabled' : ''} />
          <button type="submit" class="btn btn-primary" ${match.paused ? 'disabled' : ''}>Senden</button>
        </div>
      </form></div>`
    : match.ended
      ? `<div class="empty-state" style="margin-top:var(--space-3);">Match beendet.</div>`
      : `<div class="empty-state" style="margin-top:var(--space-3);">Nächste Frage kommt…</div>`;
  return `
    ${roster}
    ${result}
    ${question}
    ${matchControlsHtml()}
  `;
}

// The game the launcher should currently expand: forced to the game the player
// is actually engaged in (a live quiz match/lobby, a tetris lobby, or a
// scribble lobby/match), else whatever tile they last tapped.
function currentGame() {
  if (match || myLobby()) return 'quiz';
  if (myTetrisLobby()) return 'tetris';
  if (myScribbleLobby() || hasScribbleMatch()) return 'scribble';
  if (myBlobbyLobby() || hasBlobbyMatch()) return 'blobby';
  if (mySnakeLobby() || hasSnakeMatch()) return 'snake';
  return activeGame;
}

function gameTileHtml(game, active) {
  return `
    <button type="button" class="card arcade-tile ${active === game.id ? 'is-active' : ''} ${game.soon ? 'is-soon' : ''}" data-game="${game.id}">
      ${game.soon ? `<span class="arcade-tile-soon">Bald</span>` : ''}
      <span class="arcade-tile-icon" aria-hidden="true">${game.icon}</span>
      <span class="arcade-tile-name">${escapeHtml(game.name)}</span>
    </button>`;
}

// The lobby/match UI for the currently selected game, shown under the tiles.
function activeGameHtml() {
  const game = currentGame();
  if (game === 'quiz') {
    const lobby = myLobby();
    return `
      <div class="card stack" style="margin-top:var(--space-3);">
        <div class="row-between" style="gap:var(--space-3);">
          <strong>Quiz-Lobby</strong>
          <div class="row" style="gap:var(--space-2);">${isAdmin() ? `<button type="button" class="btn btn-sm btn-equal" id="quiz-bot" ${lobby || match ? 'disabled' : ''}>Gegen KI</button>` : ''}<button type="button" class="btn btn-primary btn-sm btn-equal" id="quiz-create-lobby" ${lobby || match ? 'disabled' : ''}>Lobby öffnen</button></div>
        </div>
        ${arcadeInfoGridHtml([
          { label: 'Ziel', text: 'Richtige Antworten sammeln.' },
          { label: 'Steuerung', text: 'Antwort tippen und senden.' },
        ])}
        ${renderLobbyList()}
      </div>
      ${targetControls(lobby)}`;
  }
  if (game === 'tetris') {
    return `<div style="margin-top:var(--space-3);">${renderTetrisLobbyCard()}</div>`;
  }
  if (game === 'scribble') {
    return `<div style="margin-top:var(--space-3);">${renderScribbleLobbyCard()}</div>`;
  }
  if (game === 'blobby') return `<div style="margin-top:var(--space-3);">${renderBlobbyLobbyCard()}</div>`;
  if (game === 'snake') return `<div style="margin-top:var(--space-3);">${renderSnakeLobbyCard()}</div>`;
  return '';
}

export function renderArcade(container, ctx) {
  ensureSocket(ctx);
  ensureTetrisSocket();
  ensureScribbleSocket();
  ensureBlobbySocket();
  ensureSnakeSocket();
  if (!stats && !statsLoading) loadStats(ctx);
  const lobby = myLobby();

  const cg = currentGame();
  container.innerHTML = `
    <button type="button" class="btn btn-sm" data-navigate="more">‹ Zurück</button>
    <h1 class="view-title">Arcade</h1>
    ${whoAmICardHtml('whoami')}
    <div class="section-title">🎮 Spiele</div>
    <div class="arcade-tiles">
      ${GAMES.map((g) => gameTileHtml(g, cg)).join('')}
    </div>
    ${activeGameHtml()}
    <div class="section-title">📊 Arcade-Statistiken</div>
    <div class="card stack">${arcadeStatsHtml()}</div>
  `;

  wireWhoAmICard(container, 'whoami', ctx);
  wireTetrisLobbyCard(container);
  wireScribbleLobbyCard(container);
  wireBlobbyLobbyCard(container);
  wireSnakeLobbyCard(container);

  container.querySelectorAll('[data-game]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.game;
      const def = GAMES.find((g) => g.id === id);
      if (def?.soon) return showToast(`${def.name} kommt bald!`);
      activeGame = activeGame === id ? null : id;
      ctx.rerender();
    });
  });

  container.querySelectorAll('[data-stats-tab]').forEach((btn) => {
    btn.addEventListener('click', () => {
      activeStatsGame = btn.dataset.statsTab;
      ctx.rerender();
    });
  });

  container.querySelector('#quiz-create-lobby')?.addEventListener('click', async () => {
    const playerId = getMyId();
    if (!playerId) return showToast('Bitte zuerst auswählen, wer du bist.', { error: true });
    const res = await emitWithAck('arcade:lobby:create', { gameType: 'quiz', playerId });
    if (!res?.ok) return showToast(res?.error || 'Lobby konnte nicht erstellt werden.', { error: true });
    showToast('Quiz-Lobby geöffnet.');
  });

  container.querySelector('#quiz-bot')?.addEventListener('click', async () => {
    const playerId = getMyId();
    const res = await emitWithAck('arcade:lobby:bot', { playerId, adminPin: getAdminPin() });
    if (!res?.ok) showToast(res?.error || 'KI-Lobby konnte nicht erstellt werden.', { error: true });
  });

  container.querySelectorAll('[data-close-lobby]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const playerId = getMyId();
      const res = await emitWithAck('arcade:lobby:close', { lobbyId: btn.dataset.closeLobby, playerId });
      if (!res?.ok) showToast(res?.error || 'Schließen fehlgeschlagen.', { error: true });
    });
  });

  container.querySelectorAll('[data-join-lobby]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const playerId = getMyId();
      if (!playerId) return showToast('Bitte zuerst auswählen, wer du bist.', { error: true });
      const res = await emitWithAck('arcade:lobby:join', { lobbyId: btn.dataset.joinLobby, playerId });
      if (!res?.ok) showToast(res?.error || 'Beitritt fehlgeschlagen.', { error: true });
    });
  });

  wireReadyToggle(container, 'quiz-ready', async (lobbyId, ready) => {
    const res = await emitWithAck('arcade:lobby:ready', { lobbyId, playerId: getMyId(), ready });
    if (!res?.ok) showToast(res?.error || 'Bereit-Status konnte nicht gesetzt werden.', { error: true });
  });

  container.querySelector('#target-custom')?.addEventListener('input', (e) => {
    customTarget = e.target.value;
  });

  container.querySelector('#quiz-start-lobby')?.addEventListener('click', async () => {
    const playerId = getMyId();
    const selected = container.querySelector('input[name="target-score"]:checked')?.value ?? '5';
    const targetScore = selected === 'custom' ? Number(container.querySelector('#target-custom').value) : Number(selected);
    const res = await emitWithAck('arcade:lobby:start', { lobbyId: lobby.id, playerId, targetScore });
    if (!res?.ok) showToast(res?.error || 'Start fehlgeschlagen.', { error: true });
  });
}

// The live quiz match runs in its own view (like Tetris), so the Arcade page
// stays a clean launcher. app.js maps the `quizRoom` view here.
export function renderQuizRoom(container, ctx) {
  ensureSocket(ctx);
  if (!match) {
    container.innerHTML = `
      <button type="button" class="btn btn-sm" data-navigate="arcade">‹ Arcade</button>
      <div class="empty-state" style="margin-top:var(--space-4);">Kein laufendes Quiz-Match.</div>`;
    return;
  }
  container.innerHTML = `
    <div class="arcade-game-shell"><h1 class="view-title">Gaming-Quiz</h1>
    ${renderMatch()}
    ${match.ended ? `<button type="button" class="btn btn-primary btn-block" id="quiz-back" style="margin-top:var(--space-4);">Zurück zum Arcade</button>` : ''}
    </div>`;
  wireQuizMatch(container);
  if (currentQuestion && !match.paused) startCountdown();
  // Every socket update (new question, opponent's result, ...) rebuilds this
  // view's DOM from scratch, which otherwise drops focus and forces a click
  // back into the box before typing again — keep the cursor there so players
  // can just keep typing across questions.
  container.querySelector('#quiz-answer:not(:disabled)')?.focus();
}

function wireQuizMatch(container) {
  container.querySelector('#quiz-answer-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const playerId = getMyId();
    const input = container.querySelector('#quiz-answer');
    const text = input.value.trim();
    if (!playerId || !match?.matchId || !text) return;
    const res = await emitWithAck('arcade:quiz:answer', { matchId: match.matchId, playerId, text });
    if (res?.ok && res.correct === false) showToast('Noch nicht richtig.');
    if (!res?.ok) showToast(res?.error || 'Antwort nicht angenommen.', { error: true });
    input.value = '';
    input.focus();
  });

  container.querySelector('#quiz-pause')?.addEventListener('click', async () => {
    const res = await emitWithAck('arcade:match:pause', { matchId: match?.matchId, playerId: getMyId() });
    if (!res?.ok) showToast(res?.error || 'Pausieren fehlgeschlagen.', { error: true });
  });

  container.querySelector('#quiz-resume')?.addEventListener('click', async () => {
    const res = await emitWithAck('arcade:match:resume', { matchId: match?.matchId, playerId: getMyId() });
    if (!res?.ok) showToast(res?.error || 'Fortsetzen fehlgeschlagen.', { error: true });
  });

  container.querySelector('#quiz-finish')?.addEventListener('click', async () => {
    if (!(await confirmDialog('Match wirklich beenden?', { confirmText: 'Beenden', danger: true }))) return;
    const res = await emitWithAck('arcade:match:finish', { matchId: match?.matchId, playerId: getMyId() });
    if (!res?.ok) showToast(res?.error || 'Beenden fehlgeschlagen.', { error: true });
  });

  container.querySelector('#quiz-back')?.addEventListener('click', () => {
    match = null;
    currentQuestion = null;
    lastResult = null;
    stopCountdown();
    navigate('arcade');
  });
}
