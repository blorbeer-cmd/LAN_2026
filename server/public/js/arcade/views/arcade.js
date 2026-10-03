import { api } from '../../api.js';
import { connectSocket } from '../../socket.js';
import { avatarHtml, escapeHtml } from '../../format.js';
import { icon } from '../../icons.js';
import { showToast } from '../../toast.js';
import { getMyId } from '../../whoami.js';
import { playerById } from '../../state.js';
import { currentPlayerMayUseArcadeAi, currentPlayerMaySeeArcadeGame } from '../arcadeAdmin.js';
import { ARCADE_GAMES, arcadeGame, arcadeGameIconHtml } from '../arcadeGames.js';
import { ensureTetrisSocket, renderTetrisLobbyEntries, wireTetrisLobbyCard, myTetrisLobby, leaveMyTetrisLobby, hasTetrisMatch, createTetrisLobby } from './tetris.js';
import { ensureScribbleSocket, renderScribbleLobbyEntries, wireScribbleLobbyCard, myScribbleLobby, hasScribbleMatch, leaveMyScribbleLobby, createScribbleLobby } from './arcadeScribble.js';
import { ensureBlobbySocket, renderBlobbyLobbyEntries, wireBlobbyLobbyCard, myBlobbyLobby, hasBlobbyMatch, leaveMyBlobbyLobby, createBlobbyLobby } from './blobby.js';
import { ensurePongSocket, renderPongLobbyEntries, wirePongLobbyCard, myPongLobby, hasPongMatch, leaveMyPongLobby, createPongLobby } from './pong.js';
import { ensureSnakeSocket, renderSnakeLobbyEntries, wireSnakeLobbyCard, mySnakeLobby, hasSnakeMatch, leaveMySnakeLobby, createSnakeLobby } from './snake.js';
import { ensureBattleshipSocket, renderBattleshipLobbyEntries, wireBattleshipLobbyCard, myBattleshipLobby, hasBattleshipMatch, createBattleshipLobby } from './battleship.js';
import { ensureChallengeRushSocket, renderChallengeRushLobbyEntries, wireChallengeRushLobbyCard, myChallengeRushLobby, hasChallengeRushMatch, leaveMyChallengeRushLobby, createChallengeRushLobby, challengeRushCreateOptionsHtml, wireChallengeRushCreateOptions } from './challengeRush.js';
import { arcadeGameHeaderHtml, arcadeMatchControlsHtml, arcadePlayerStripHtml, arcadeResultListHtml, arcadeScoreboardHtml, pointsLabel, wireArcadeToolbar } from '../arcadeUi.js';
import { createRematchController } from '../rematch.js';
import { playArcadeSound } from '../arcadeSound.js';
import { startArcadeWatch } from './arcadeWatch.js';
import { confirmDialog, openModal } from '../../modal.js';
import { showCountdown, cancelCountdown } from '../countdown.js';
import {
  arcadeLobbyEntryHtml,
  arcadeLobbyGuestActionsHtml,
  arcadeLobbyHostActionsHtml,
  arcadeLobbyJoinHtml,
  arcadeLobbyModeButtonsHtml,
  arcadeLobbyOpponentToggleHtml,
  readyToggleHtml,
  resetArcadeOpponentWhenAiUnavailable,
  wireArcadeOpponentToggle,
  wireReadyToggle,
} from '../lobbyReady.js';
import { isOwnFinishedMatch } from '../arcadeWatchFilter.js';
import { emptyStateHtml } from '../../emptyState.js';
import { createDeferredInteractiveRender } from '../../deferredInteractiveRender.js';

// The Arcade hub has three areas: every open lobby of every game in one list
// (the player's own lobby expanded on top), the matches running right now and
// one overall ranking across all games. New lobbies open through a dialog
// that asks for game and mode.

let socket = null;
let lobbies = [];
let watchMatches = [];
let stats = null;
let statsLoading = false;
let statsFilter = 'all';
let statsOpen = false;
let match = null;
let currentQuestion = null;
let lastResult = null;
let quizAnswerHadFocusBeforePause = false;
let countdownInterval = null;
let customTarget = '5';
const deferredArcadeRender = createDeferredInteractiveRender({
  shouldTrackPointerInteraction: () => currentView() === 'arcade',
  trackPointerInteractions: true,
});

// Alphabetical, so the dialog and the stats filter list games in reading order.
const quizRematch = createRematchController({
  prefix: 'quiz',
  emit: (event, payload) => emitWithAck(event, payload),
  myId: () => getMyId(),
  lobbies: () => lobbies,
  events: { create: 'arcade:lobby:create', bot: 'arcade:lobby:bot', join: 'arcade:lobby:join', ready: 'arcade:lobby:ready', start: 'arcade:lobby:start', leave: 'arcade:lobby:close' },
  createPayload: () => ({ gameType: 'quiz' }),
  startPayload: () => ({ targetScore: match?.targetScore ?? Number(customTarget) }),
  playerName: (id) => match?.players?.find((player) => player.id === id)?.name ?? 'Spieler',
  rerender: () => window.dispatchEvent(new CustomEvent('respawn:rerender')),
  onError: (message) => showToast(message, { error: true }),
});

function visibleGames() {
  return ARCADE_GAMES
    .filter((game) => currentPlayerMaySeeArcadeGame(game.id))
    .sort((a, b) => a.name.localeCompare(b.name, 'de'));
}

function currentView() {
  return document.getElementById('view-container')?.dataset.view;
}

function rerenderIfView(ctx, view) {
  if (currentView() !== view) return;
  const container = document.getElementById('view-container');
  if (!container || deferredArcadeRender.deferIfNeeded(container, ctx)) return;
  ctx.rerender();
}

// The game modules fire this when one of their matches finishes so our cached
// stats refetch the next time Arcade renders.
window.addEventListener('respawn:arcade-stats-dirty', () => {
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
  badge.textContent = match?.paused ? 'Pause' : `${left} s`;
  badge.classList.toggle('is-urgent', !match?.paused && left <= 5);
  if (!match?.paused && left > 0 && left <= 5) playArcadeSound('quiz-tick');
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
    rerenderIfView(ctx, 'arcade');
  }
}

function ensureSocket(ctx) {
  if (socket) return socket;
  resetArcadeOpponentWhenAiUnavailable(() => { createDraft.opponent = 'human'; });
  socket = connectSocket();
  socket.on('arcade:lobbies', (payload) => {
    lobbies = payload?.lobbies ?? [];
    rerenderIfView(ctx, 'arcade');
    if (match?.ended && currentView() === 'quizRoom') {
      quizRematch.onLobbies();
      rerenderIfView(ctx, 'quizRoom');
    }
  });
  socket.on('arcade:watch:list', (payload) => {
    watchMatches = payload?.matches ?? [];
    rerenderIfView(ctx, 'arcade');
  });
  socket.on('arcade:match:start', (payload) => {
    match = { ...payload, scores: payload.players.map((p) => ({ playerId: p.id, name: p.name, score: 0 })), paused: false };
    quizRematch.reset();
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
    rerenderIfView(ctx, 'quizRoom');
  });
  socket.on('arcade:quiz:result', (payload) => {
    lastResult = payload;
    if (payload.scores) match = { ...(match ?? {}), scores: payload.scores };
    currentQuestion = null;
    stopCountdown();
    rerenderIfView(ctx, 'quizRoom');
  });
  socket.on('arcade:quiz:timeout', (payload) => {
    lastResult = { winner: null, correctAnswer: payload.correctAnswer, timeout: true };
    if (payload.scores) match = { ...(match ?? {}), scores: payload.scores };
    currentQuestion = null;
    stopCountdown();
    rerenderIfView(ctx, 'quizRoom');
  });
  socket.on('arcade:match:end', (payload) => {
    lastResult = payload.winner ? { winner: payload.winner, correctAnswer: 'Match beendet' } : lastResult;
    if (payload.scores) match = { ...(match ?? {}), scores: payload.scores, ended: true, winner: payload.winner };
    if (match?.players) quizRematch.capture(match);
    currentQuestion = null;
    stopCountdown();
    cancelCountdown();
    stats = null;
    loadStats(ctx);
    rerenderIfView(ctx, 'quizRoom');
  });
  socket.on('arcade:match:paused', (payload) => {
    if (payload.scores) match = { ...(match ?? {}), scores: payload.scores, paused: true, remainingMs: payload.remainingMs };
    quizAnswerHadFocusBeforePause = document.activeElement?.id === 'quiz-answer';
    stopCountdown();
    if (currentView() === 'quizRoom') updateQuizPauseUi();
  });
  socket.on('arcade:match:resumed', (payload) => {
    if (payload.scores) match = { ...(match ?? {}), scores: payload.scores, paused: false, remainingMs: null };
    if (currentQuestion && payload.expiresAt) currentQuestion = { ...currentQuestion, expiresAt: payload.expiresAt };
    startCountdown();
    if (currentView() === 'quizRoom') updateQuizPauseUi();
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
  window.dispatchEvent(new CustomEvent('respawn:navigate', { detail: view }));
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

// ---------- Statistik: one ranking across all games ----------

// Wins per player and game. Tetris sums its human Duell/Arena variants (its
// legacy aggregate also counts AI test matches); every other game uses its
// all-mode aggregate entry.
function statsEntriesFor(gameId) {
  const games = stats?.games ?? [];
  if (gameId === 'tetris') return games.filter((g) => g.baseGameType === 'tetris' && g.mode && !g.mode.endsWith('-ai'));
  return games.filter((g) => g.gameType === gameId && !g.baseGameType);
}

function aggregateStats() {
  const players = new Map();
  const gamesWithMatches = [];
  for (const game of visibleGames()) {
    const entries = statsEntriesFor(game.id);
    if (!entries.some((entry) => entry.matches > 0)) continue;
    gamesWithMatches.push(game);
    for (const entry of entries) {
      for (const p of entry.players ?? []) {
        const row = players.get(p.playerId) ?? { playerId: p.playerId, name: p.name, wins: 0, matches: 0, perGame: {} };
        row.wins += p.wins;
        row.matches += p.matches;
        row.perGame[game.id] = (row.perGame[game.id] ?? 0) + p.wins;
        players.set(p.playerId, row);
      }
    }
  }
  return { players: [...players.values()], games: gamesWithMatches };
}

const GAME_STAT_COLORS = {
  quiz: 'var(--arcade-stat-quiz)',
  tetris: 'var(--arcade-stat-tetris)',
  pong: 'var(--arcade-stat-pong)',
  blobby: 'var(--arcade-stat-blobby)',
  snake: 'var(--arcade-stat-snake)',
  battleship: 'var(--arcade-stat-battleship)',
  scribble: 'var(--arcade-stat-scribble)',
  'challenge-rush': 'var(--arcade-stat-challenge-rush)',
};

function gameColorVar(gameId) {
  return GAME_STAT_COLORS[gameId] ?? 'var(--text-muted)';
}

function statsFilterHtml(games) {
  const options = [{ value: 'all', label: 'Alle Spiele' }, ...games.map((game) => ({ value: game.id, label: game.name }))];
  return `<select id="arcade-stats-filter" class="arcade-stats-filter" aria-label="Spiel filtern">
    ${options.map((o) => `<option value="${o.value}" ${o.value === statsFilter ? 'selected' : ''}>${escapeHtml(o.label)}</option>`).join('')}
  </select>`;
}

function arcadeStatsHtml() {
  if (statsLoading && !stats) return { head: '', body: emptyStateHtml('Statistik lädt', { className: 'empty-state-compact' }) };
  const { players, games } = aggregateStats();
  if (!players.length) return { head: '', body: emptyStateHtml('Noch keine Arcade-Runden.', { className: 'empty-state-compact' }) };
  if (statsFilter !== 'all' && !games.some((game) => game.id === statsFilter)) statsFilter = 'all';
  const shownGames = statsFilter === 'all' ? games : games.filter((game) => game.id === statsFilter);
  const rows = players
    .map((p) => {
      const wins = statsFilter === 'all' ? p.wins : p.perGame[statsFilter] ?? 0;
      return { ...p, shownWins: wins };
    })
    .filter((p) => statsFilter === 'all' || p.perGame[statsFilter] !== undefined)
    .sort((a, b) => b.shownWins - a.shownWins || a.name.localeCompare(b.name, 'de'));
  const maxWins = Math.max(1, ...rows.map((p) => p.shownWins));
  const matchesFor = (p) => (statsFilter === 'all'
    ? p.matches
    : statsEntriesFor(statsFilter).reduce((sum, entry) => sum + (entry.players.find((x) => x.playerId === p.playerId)?.matches ?? 0), 0));
  const myId = getMyId();
  const legend = `<div class="arcade-stats-legend">${shownGames.length > 1 ? shownGames.map((game) => `<span><i style="background:${gameColorVar(game.id)}"></i>${escapeHtml(game.name)}</span>`).join('') : ''}</div>`;
  const list = rows
    .map((p, index) => {
      const player = playerById(p.playerId) ?? { name: p.name };
      const matches = matchesFor(p);
      const rate = matches > 0 ? Math.round((p.shownWins / matches) * 100) : 0;
      const segments = shownGames
        .filter((game) => (p.perGame[game.id] ?? 0) > 0)
        .map((game) => `<span style="flex:${p.perGame[game.id]};background:${gameColorVar(game.id)}" title="${escapeHtml(game.name)}: ${p.perGame[game.id]}"></span>`)
        .join('');
      const barLabel = shownGames
        .filter((game) => (p.perGame[game.id] ?? 0) > 0)
        .map((game) => `${game.name} ${p.perGame[game.id]}`)
        .join(', ');
      return `<div class="arcade-stats-row">
        <span class="arcade-stats-rank">${index + 1}</span>
        <span class="arcade-stats-player">${avatarHtml(player, 20)}<span class="player-name${p.playerId === myId ? ' is-me' : ''}">${escapeHtml(p.name)}</span></span>
        <span class="arcade-stats-bar-track"><span class="arcade-stats-bar" style="width:${(p.shownWins / maxWins) * 100}%" role="img" aria-label="${escapeHtml(barLabel || 'Keine Siege')}">${segments}</span></span>
        <span class="arcade-stats-rate">${rate} %</span>
        <strong class="arcade-stats-wins">${p.shownWins}</strong>
      </div>`;
    })
    .join('');
  return {
    head: '',
    body: `<div class="arcade-stats-toolbar">${legend}${statsFilterHtml(games)}</div><div class="arcade-stats-list">${list}</div>`,
  };
}

// ---------- Gaming-Quiz lobby entries (the quiz lives in this module) ----------

function quizLobbyEntryHtml(l) {
  const isHost = l.host.id === getMyId();
  const joined = l.players.some((p) => p.id === getMyId());
  const settingsHtml = isHost
    ? `<label class="arcade-lobby-target-score">
        <span>Punkte bis Sieg</span>
        <input type="number" id="target-score" min="1" max="100" value="${escapeHtml(customTarget)}" aria-label="Punkte bis Sieg" />
      </label>`
    : '';
  const footerActions = isHost
    ? arcadeLobbyHostActionsHtml({ startAttrs: 'id="quiz-start-lobby"', startEnabled: l.players.length >= 2, startHint: l.players.length >= 2 ? '' : 'Mindestens 2 Spieler', closeAttrs: `data-close-lobby="${l.id}"` })
    : joined
      ? arcadeLobbyGuestActionsHtml({ readyHtml: readyToggleHtml(l, getMyId(), 'quiz-ready'), leaveAttrs: `data-quiz-leave="${l.id}"` })
      : '';
  const joinAction = !joined ? arcadeLobbyJoinHtml(`data-join-lobby="${l.id}"`) : '';
  return arcadeLobbyEntryHtml(l, { gameType: 'quiz', meta: `${l.players.length} Spieler`, joinAction, settingsHtml, footerActions, capacity: l.players.length });
}

async function createQuizLobby({ opponent = 'human' } = {}) {
  const playerId = getMyId();
  const res = opponent === 'bot'
    ? await emitWithAck('arcade:lobby:bot', { playerId })
    : await emitWithAck('arcade:lobby:create', { gameType: 'quiz', playerId });
  if (!res?.ok) showToast(res?.error || 'Lobby konnte nicht erstellt werden.', { error: true });
  return res;
}

function wireQuizLobbyCard(container) {
  container.querySelectorAll('[data-close-lobby]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const playerId = getMyId();
      const res = await emitWithAck('arcade:lobby:close', { lobbyId: btn.dataset.closeLobby, playerId });
      if (!res?.ok) showToast(res?.error || 'Schließen fehlgeschlagen.', { error: true });
    });
  });

  container.querySelectorAll('[data-quiz-leave]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const res = await emitWithAck('arcade:lobby:leave', { lobbyId: btn.dataset.quizLeave, playerId: getMyId() });
      if (!res?.ok) showToast(res?.error || 'Verlassen fehlgeschlagen.', { error: true });
    });
  });

  container.querySelectorAll('[data-join-lobby]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const playerId = getMyId();
      if (!playerId) return showToast('Bitte zuerst auswählen, wer du bist.', { error: true });
      if (!(await leaveCurrentLobbyBeforeAction('quiz', 'join'))) return;
      const res = await emitWithAck('arcade:lobby:join', { lobbyId: btn.dataset.joinLobby, playerId });
      if (!res?.ok) showToast(res?.error || 'Beitritt fehlgeschlagen.', { error: true });
    });
  });

  wireReadyToggle(container, 'quiz-ready', async (lobbyId, ready) => {
    const res = await emitWithAck('arcade:lobby:ready', { lobbyId, playerId: getMyId(), ready });
    if (!res?.ok) showToast(res?.error || 'Bereit-Status konnte nicht gesetzt werden.', { error: true });
  });

  container.querySelector('#target-score')?.addEventListener('input', (e) => {
    customTarget = e.target.value;
  });

  container.querySelector('#quiz-start-lobby')?.addEventListener('click', async () => {
    const playerId = getMyId();
    const targetScore = Number(container.querySelector('#target-score')?.value ?? 5);
    const res = await emitWithAck('arcade:lobby:start', { lobbyId: myLobby()?.id, playerId, targetScore });
    if (!res?.ok) showToast(res?.error || 'Start fehlgeschlagen.', { error: true });
  });
}

function secondsLeft() {
  if (match?.paused) return Math.max(0, Math.ceil((match.remainingMs ?? 0) / 1000));
  if (!currentQuestion?.expiresAt) return 0;
  return Math.max(0, Math.ceil((currentQuestion.expiresAt - Date.now()) / 1000));
}

function quizPauseButtonHtml() {
  return match.paused
    ? '<button type="button" class="btn btn-primary btn-sm" id="quiz-resume">Fortsetzen</button>'
    : '<button type="button" class="btn btn-sm" id="quiz-pause">Pausieren</button>';
}

function matchControlsHtml() {
  if (!match) return '';
  if (match.ended) return arcadeMatchControlsHtml('<button type="button" class="btn btn-sm" id="quiz-back">Schließen</button>');
  if (match.host?.id !== getMyId()) {
    // A non-host player can't pause (shared timer state, host-only), but
    // must still have a way out instead of only a raw tab close.
    if (!match.players.some((p) => p.id === getMyId())) return '';
    return arcadeMatchControlsHtml('<button type="button" class="btn btn-sm" id="quiz-leave">Verlassen</button>');
  }
  return arcadeMatchControlsHtml(`${quizPauseButtonHtml()}<button type="button" class="btn btn-sm" id="quiz-finish">Beenden</button>`);
}

function quizScore(player) {
  return match.scores?.find((s) => s.playerId === player.id)?.score ?? 0;
}

// Two players face each other on the shared score bar; a bigger round lists
// everyone in the strip.
function quizPlayersHtml() {
  const target = match.targetScore ?? 5;
  if (match.players.length === 2) {
    const side = (player) => ({ label: player.id === getMyId() ? 'Du' : '', score: quizScore(player), players: [player] });
    return arcadeScoreboardHtml({ left: side(match.players[0]), right: side(match.players[1]), target, myId: getMyId() });
  }
  return `${quizStripHtml()}<span class="arcade-section-meta">bis ${target} Punkte</span>`;
}

function quizStripHtml() {
  return arcadePlayerStripHtml(match.players.map((player) => {
    const profile = playerById(player.id) ?? player;
    return {
      name: player.name,
      colorVar: profile.color || player.color || 'var(--text-muted)',
      value: `${quizScore(player)}`,
      me: player.id === getMyId(),
    };
  }));
}

// The stage keeps one fixed height for question, reveal and waiting state, so
// nothing below jumps and the start countdown stays centered on it.
function quizStageHtml() {
  if (currentQuestion) {
    return `<form id="quiz-answer-form" class="quiz-stage-body">
      <div class="quiz-question-meta">
        <span>${escapeHtml(currentQuestion.category || 'Quiz')}${currentQuestion.difficulty ? ` · ${escapeHtml(currentQuestion.difficulty)}` : ''}</span>
        <span id="quiz-countdown" class="quiz-timer${!match.paused && secondsLeft() <= 5 ? ' is-urgent' : ''}">${match.paused ? 'Pause' : `${secondsLeft()} s`}</span>
      </div>
      <p class="quiz-question">${escapeHtml(currentQuestion.question)}</p>
      <div class="quiz-answer-row">
        <input type="text" id="quiz-answer" autocomplete="off" placeholder="Antwort" aria-label="Antwort" ${match.paused ? 'disabled' : ''} />
        <button type="submit" class="btn btn-primary btn-sm" ${match.paused ? 'disabled' : ''}>Senden</button>
      </div>
    </form>`;
  }
  if (lastResult && !match.ended) {
    const who = lastResult.timeout ? 'Zeit abgelaufen' : lastResult.winner?.name ? `${escapeHtml(lastResult.winner.name)} hatte es` : '';
    return `<div class="quiz-stage-body is-reveal">
      <span class="quiz-question-meta">${who}</span>
      <p class="quiz-question">${escapeHtml(lastResult.correctAnswer ?? '')}</p>
      <span class="quiz-stage-note">Nächste Frage kommt gleich</span>
    </div>`;
  }
  return `<div class="quiz-stage-body is-waiting"><span class="quiz-stage-note">${match.ended ? 'Match beendet' : 'Erste Frage kommt gleich'}</span></div>`;
}

function quizResultHtml() {
  if (!match?.ended) return '';
  const winnerId = match.winner?.id ?? null;
  const rows = [...match.players]
    .sort((a, b) => quizScore(b) - quizScore(a))
    .map((player) => ({ player, winner: player.id === winnerId, value: pointsLabel(quizScore(player)) }));
  rows.forEach((row, index) => { row.place = index > 0 && quizScore(rows[index - 1].player) === quizScore(row.player) ? rows[index - 1].place : index + 1; });
  return `<section class="card stack grouped-page-section" aria-labelledby="quiz-result-title">
    <div class="grouped-page-section-title"><h2 id="quiz-result-title">Ergebnis</h2>${quizRematch.actionHtml()}</div>
    ${arcadeResultListHtml(rows)}
  </section>`;
}

function renderMatch() {
  if (!match) return '';
  // The quiz has no playfield worth keeping after the end: the result card
  // already carries the final score.
  if (match.ended) return quizResultHtml();
  return `
    <section class="card arcade-stage quiz-stage">
      <div class="quiz-stage-head">${quizPlayersHtml()}</div>
      <div class="quiz-stage-area" data-countdown-anchor>${quizStageHtml()}</div>
    </section>`;
}

async function leaveCurrentLobbyBeforeAction(_targetGame, action) {
  const playerId = getMyId();
  const quizLobby = myLobby();
  const candidates = [
    { name: 'Quiz', lobby: quizLobby, leave: (lobby) => emitWithAck(lobby.host.id === playerId ? 'arcade:lobby:close' : 'arcade:lobby:leave', { lobbyId: lobby.id, playerId }) },
    { name: 'Tetris', lobby: myTetrisLobby(), leave: leaveMyTetrisLobby },
    { name: 'Scribble', lobby: myScribbleLobby(), leave: leaveMyScribbleLobby },
    { name: 'Pong', lobby: myPongLobby(), leave: leaveMyPongLobby },
    { name: 'Blobby Volley', lobby: myBlobbyLobby(), leave: leaveMyBlobbyLobby },
    { name: 'Snake', lobby: mySnakeLobby(), leave: leaveMySnakeLobby },
    { name: 'Battleship', lobby: myBattleshipLobby(), leave: async (lobby) => emitWithAck('battleship:lobby:leave', { lobbyId: lobby.id, playerId }) },
    { name: 'Challenge Rush', lobby: myChallengeRushLobby(), leave: leaveMyChallengeRushLobby },
  ];
  const current = candidates.find((entry) => entry.lobby);
  if (!current) return true;
  const ownsLobby = current.lobby.host.id === playerId;
  const consequence = ownsLobby ? 'wird deine eigene Lobby aufgelöst' : 'verlässt du deine aktuelle Lobby';
  const actionText = action === 'create' ? 'eine neue Lobby öffnest' : 'dieser Lobby beitrittst';
  if (!(await confirmDialog(
    `Du bist bereits in einer ${current.name}-Lobby. Wenn du ${actionText}, ${consequence}.`,
    { confirmText: action === 'create' ? 'Verlassen & öffnen' : 'Verlassen & beitreten', danger: true }
  ))) return false;

  const result = await current.leave(current.lobby);
  if (!result?.ok) {
    showToast(result?.error || 'Deine aktuelle Lobby konnte nicht verlassen werden.', { error: true });
    return false;
  }
  return true;
}

// ---------- Hub: lobbies, running matches, create dialog ----------

const LOBBY_SOURCES = [
  { id: 'quiz', entries: () => lobbies.map((lobby) => ({ id: lobby.id, html: quizLobbyEntryHtml(lobby) })), mine: () => myLobby(), create: createQuizLobby },
  { id: 'tetris', entries: renderTetrisLobbyEntries, mine: myTetrisLobby, create: createTetrisLobby },
  { id: 'scribble', entries: renderScribbleLobbyEntries, mine: myScribbleLobby, create: createScribbleLobby },
  { id: 'pong', entries: renderPongLobbyEntries, mine: myPongLobby, create: createPongLobby },
  { id: 'blobby', entries: renderBlobbyLobbyEntries, mine: myBlobbyLobby, create: createBlobbyLobby },
  { id: 'snake', entries: renderSnakeLobbyEntries, mine: mySnakeLobby, create: createSnakeLobby },
  { id: 'battleship', entries: renderBattleshipLobbyEntries, mine: myBattleshipLobby, create: createBattleshipLobby },
  { id: 'challenge-rush', entries: renderChallengeRushLobbyEntries, mine: myChallengeRushLobby, create: createChallengeRushLobby },
];

function allLobbiesHtml() {
  const mine = [];
  const others = [];
  for (const source of LOBBY_SOURCES) {
    if (!currentPlayerMaySeeArcadeGame(source.id)) continue;
    const myLobbyId = source.mine()?.id;
    for (const entry of source.entries()) (entry.id === myLobbyId ? mine : others).push(entry.html);
  }
  if (!mine.length && !others.length) return emptyStateHtml('Keine offene Lobby.', { className: 'empty-state-compact' });
  return `${mine.join('')}${others.length ? `<div class="arcade-lobby-rows">${others.join('')}</div>` : ''}`;
}

function hasRunningMatch() {
  return Boolean(match && !match.ended) || hasTetrisMatch() || hasScribbleMatch() || hasPongMatch() || hasBlobbyMatch() || hasSnakeMatch() || hasBattleshipMatch() || hasChallengeRushMatch();
}

const LOCAL_MATCH = {
  quiz: () => Boolean(match && !match.ended),
  tetris: hasTetrisMatch,
  scribble: hasScribbleMatch,
  pong: hasPongMatch,
  blobby: hasBlobbyMatch,
  snake: hasSnakeMatch,
  battleship: hasBattleshipMatch,
  'challenge-rush': hasChallengeRushMatch,
};

function playerNames(live) {
  const names = (live.players ?? []).map((player) => player.name ?? player.ref?.name).filter(Boolean);
  // Some games (Challenge Rush) only name their players in the score list.
  return names.length ? names : (live.scores ?? []).map((score) => score.name).filter(Boolean);
}

function runningTitle(live) {
  // Team games may carry the side only on their score entries (Blobby).
  const players = (live.players ?? []).some((player) => player.team) ? live.players : (live.scores ?? []);
  if (players.some((player) => player.team === 'left') && players.some((player) => player.team === 'right')) {
    const side = (team) => players.filter((player) => player.team === team).map((player) => player.name ?? player.ref?.name ?? 'Spieler').join(' und ');
    return `${side('left')} gegen ${side('right')}`;
  }
  const names = playerNames(live);
  if (names.length === 2) return `${names[0]} gegen ${names[1]}`;
  return names.join(', ') || 'Spiel läuft';
}

function runningMeta(live) {
  const game = arcadeGame(live.gameType);
  const entries = live.scores ?? [];
  const teamScore = (team) => entries.find((score) => score.team === team)?.score ?? 0;
  const scores = entries.some((score) => score.team === 'left') ? [teamScore('left'), teamScore('right')] : entries.map((score) => score.score ?? 0);
  const parts = [game?.name ?? live.gameType];
  if (scores.length === 2) parts.push(`${scores[0]} : ${scores[1]}`);
  if (live.paused) parts.push('Pause');
  return parts.join(' · ');
}

function runningMatchesHtml() {
  const myId = getMyId();
  const matches = watchMatches.filter((live) => !isOwnFinishedMatch(live, myId) && currentPlayerMaySeeArcadeGame(live.gameType));
  if (!matches.length) return '';
  const rows = matches
    .map((live) => {
      // Resume only works while this tab still holds the match; after a reload
      // the own match can only be watched.
      const own = (live.players ?? []).some((player) => (player.id ?? player.playerId ?? player.ref?.id) === myId);
      const room = arcadeGame(live.gameType)?.room;
      const action = own && room && LOCAL_MATCH[live.gameType]?.()
        ? `<button type="button" class="btn btn-primary btn-sm" data-arcade-resume="${escapeHtml(room)}">Weiterspielen</button>`
        : `<button type="button" class="btn btn-sm" data-watch-match="${escapeHtml(live.matchId)}">Zuschauen</button>`;
      return `<div class="arcade-running-row">
        ${arcadeGameIconHtml(live.gameType)}
        <span class="arcade-lobby-row-text"><strong>${escapeHtml(runningTitle(live))}</strong><span class="arcade-lobby-meta">${escapeHtml(runningMeta(live))}</span></span>
        ${action}
      </div>`;
    })
    .join('');
  return `<section class="card stack grouped-page-section" aria-labelledby="arcade-running-title">
    <div class="grouped-page-section-title"><h2 id="arcade-running-title">Läuft gerade</h2></div>
    <div class="arcade-running-list">${rows}</div>
  </section>`;
}

let createDraft = { game: 'quiz', mode: null, opponent: 'human' };

function createDialogBodyHtml() {
  const games = visibleGames();
  if (!games.some((game) => game.id === createDraft.game)) createDraft.game = games[0]?.id ?? 'quiz';
  const game = arcadeGame(createDraft.game);
  if (game.modes && !game.modes.some((mode) => mode.value === createDraft.mode)) createDraft.mode = game.modes[0].value;
  const mayUseAi = currentPlayerMayUseArcadeAi() && game.id !== 'challenge-rush';
  return `<form class="stack arcade-create-form" id="arcade-create-form">
    <label class="field">
      <span class="field-label">Spiel</span>
      <select id="arcade-create-game">${games.map((g) => `<option value="${g.id}" ${g.id === game.id ? 'selected' : ''}>${escapeHtml(g.name)}</option>`).join('')}</select>
    </label>
    ${game.modes || mayUseAi ? `<div class="arcade-create-options">
      ${game.modes ? `<div class="field"><span class="field-label">Modus</span>${arcadeLobbyModeButtonsHtml('arcade-create-mode', 'Spielmodus', game.modes, createDraft.mode)}</div>` : ''}
      ${mayUseAi ? `<div class="field"><span class="field-label">Gegner</span>${arcadeLobbyOpponentToggleHtml('arcade-create-opponent', createDraft.opponent)}</div>` : ''}
    </div>` : ''}
    ${game.id === 'challenge-rush' ? challengeRushCreateOptionsHtml() : ''}
    <div class="arcade-create-actions"><button type="submit" class="btn btn-primary btn-sm">Lobby öffnen</button></div>
  </form>`;
}

function openCreateDialog() {
  if (!getMyId()) return showToast('Bitte zuerst auswählen, wer du bist.', { error: true });
  if (hasRunningMatch()) return showToast('Beende zuerst dein laufendes Spiel.', { error: true });
  openModal('Lobby öffnen', createDialogBodyHtml(), {
    onMount: (backdrop, close) => {
      const body = backdrop.querySelector('.modal-body');
      const wire = () => {
        body.querySelector('#arcade-create-game')?.addEventListener('change', (event) => {
          createDraft = { ...createDraft, game: event.currentTarget.value, mode: null };
          body.innerHTML = createDialogBodyHtml();
          wire();
          body.querySelector('#arcade-create-game')?.focus();
        });
        body.querySelectorAll('#arcade-create-mode [data-arcade-mode]').forEach((button) => button.addEventListener('click', () => {
          createDraft.mode = button.dataset.arcadeMode;
          body.innerHTML = createDialogBodyHtml();
          wire();
          body.querySelector(`#arcade-create-mode [data-arcade-mode="${createDraft.mode}"]`)?.focus();
        }));
        wireChallengeRushCreateOptions(body);
        wireArcadeOpponentToggle(body, 'arcade-create-opponent', (value) => {
          createDraft.opponent = value;
          body.innerHTML = createDialogBodyHtml();
          wire();
        });
        body.querySelector('#arcade-create-form')?.addEventListener('submit', async (event) => {
          event.preventDefault();
          const source = LOBBY_SOURCES.find((entry) => entry.id === createDraft.game);
          if (!source) return;
          close();
          if (!(await leaveCurrentLobbyBeforeAction(createDraft.game, 'create'))) return;
          const opponent = currentPlayerMayUseArcadeAi() ? createDraft.opponent : 'human';
          await source.create({ mode: createDraft.mode, opponent });
        });
      };
      wire();
    },
  });
}

export function renderArcade(container, ctx) {
  deferredArcadeRender.observe(container);
  if (deferredArcadeRender.deferIfNeeded(container, ctx)) return;
  deferredArcadeRender.clear(container);
  ensureSocket(ctx);
  ensureTetrisSocket();
  ensureScribbleSocket();
  ensurePongSocket();
  ensureBlobbySocket();
  ensureSnakeSocket();
  ensureBattleshipSocket();
  ensureChallengeRushSocket();
  if (!stats && !statsLoading) loadStats(ctx);

  const statsView = arcadeStatsHtml();
  container.innerHTML = `
    <div class="more-subpage-header">
      <div class="more-subpage-title-row">
        <h1 class="view-title">Arcade</h1>
      </div>
    </div>
    <div class="grouped-page-sections">
      <section class="card stack grouped-page-section" aria-labelledby="arcade-lobbies-title">
        <div class="grouped-page-section-title">
          <h2 id="arcade-lobbies-title">Lobbys</h2>
          <button type="button" class="btn btn-primary btn-sm" id="arcade-create-lobby" ${getMyId() ? '' : 'disabled'}>Lobby öffnen</button>
        </div>
        <div class="arcade-lobbies">${allLobbiesHtml()}</div>
      </section>
      ${runningMatchesHtml()}
      <details class="card grouped-page-section collapsible-section arcade-stats" aria-labelledby="arcade-stats-title" ${statsOpen ? 'open' : ''}>
        <summary class="collapsible-section-header"><span class="collapsible-section-chevron">${icon('chevronRight')}</span><h2 id="arcade-stats-title">Statistik</h2></summary>
        <div class="collapsible-section-content stack">
          <div id="arcade-stats-body" class="stack">${statsView.body}</div>
        </div>
      </details>
    </div>
  `;

  const beforeJoin = (game) => () => leaveCurrentLobbyBeforeAction(game, 'join');
  wireTetrisLobbyCard(container, { beforeJoin: beforeJoin('tetris') });
  wireScribbleLobbyCard(container, { beforeJoin: beforeJoin('scribble') });
  wirePongLobbyCard(container, { beforeJoin: beforeJoin('pong') });
  wireBlobbyLobbyCard(container, { beforeJoin: beforeJoin('blobby') });
  wireSnakeLobbyCard(container, { beforeJoin: beforeJoin('snake') });
  wireBattleshipLobbyCard(container, { beforeJoin: beforeJoin('battleship') });
  wireChallengeRushLobbyCard(container, { beforeJoin: beforeJoin('challenge-rush') });
  wireQuizLobbyCard(container);

  container.querySelector('#arcade-create-lobby')?.addEventListener('click', openCreateDialog);
  container.querySelectorAll('[data-watch-match]').forEach((btn) => {
    btn.addEventListener('click', () => startArcadeWatch(btn.dataset.watchMatch));
  });
  container.querySelectorAll('[data-arcade-resume]').forEach((btn) => {
    btn.addEventListener('click', () => navigate(btn.dataset.arcadeResume));
  });
  container.querySelector('details.arcade-stats')?.addEventListener('toggle', (event) => {
    statsOpen = event.currentTarget.open;
  });
  // Swap only the ranking: a full re-render would be deferred while the
  // select keeps focus, so the new filter would only appear after a click.
  const wireStatsFilter = () => container.querySelector('#arcade-stats-filter')?.addEventListener('change', (event) => {
    statsFilter = event.currentTarget.value;
    const body = container.querySelector('#arcade-stats-body');
    if (!body) return;
    body.innerHTML = arcadeStatsHtml().body;
    wireStatsFilter();
    body.querySelector('#arcade-stats-filter')?.focus();
  });
  wireStatsFilter();
}

// The live quiz match runs in its own view (like Tetris), so the Arcade page
// stays a clean launcher. app.js maps the `quizRoom` view here.
export function renderQuizRoom(container, ctx) {
  ensureSocket(ctx);
  if (!match) {
    // A direct or expired-match link lands here without a running match;
    // show the same named lobby area as opening Gaming-Quiz from Arcade
    // instead of a dead end (see Pong/Snake/Battleship's identical fallback).
    // Lobbies live on the Arcade hub; a direct or expired match link goes there.
    window.dispatchEvent(new CustomEvent('respawn:navigate', { detail: 'arcade' }));
    return;
  }
  container.innerHTML = `
    <div class="arcade-game-shell${match.ended ? ' is-ended' : ''}">
      ${arcadeGameHeaderHtml('Gaming-Quiz', matchControlsHtml(), { expand: false })}
      <div class="grouped-page-sections">${renderMatch()}</div>
    </div>`;
  wireQuizMatch(container);
  wireArcadeToolbar(container);
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
    if (res?.ok && res.correct === false) { showToast('Noch nicht richtig.'); playArcadeSound('quiz-wrong'); }
    if (res?.ok && res.correct === true) playArcadeSound('quiz-correct');
    if (!res?.ok) showToast(res?.error || 'Antwort nicht angenommen.', { error: true });
    input.value = '';
    input.focus();
  });

  wireQuizPauseControl(container);
  container.querySelector('#quiz-finish')?.addEventListener('click', async () => {
    if (!(await confirmDialog('Match wirklich beenden?', { confirmText: 'Beenden', danger: true }))) return;
    const res = await emitWithAck('arcade:match:finish', { matchId: match?.matchId, playerId: getMyId() });
    if (!res?.ok) showToast(res?.error || 'Beenden fehlgeschlagen.', { error: true });
  });
  container.querySelector('#quiz-leave')?.addEventListener('click', async () => {
    if (!(await confirmDialog('Match wirklich verlassen?', { confirmText: 'Verlassen', danger: true }))) return;
    const res = await emitWithAck('arcade:match:leave', { matchId: match?.matchId, playerId: getMyId() });
    if (!res?.ok) showToast(res?.error || 'Verlassen fehlgeschlagen.', { error: true });
  });

  quizRematch.wire(container);
  container.querySelector('#quiz-back')?.addEventListener('click', async () => {
    await quizRematch.close();
    match = null;
    currentQuestion = null;
    lastResult = null;
    stopCountdown();
    navigate('arcade');
  });
}

function wireQuizPauseControl(container) {
  container.querySelector('#quiz-pause')?.addEventListener('click', async () => {
    const res = await emitWithAck('arcade:match:pause', { matchId: match?.matchId, playerId: getMyId() });
    if (!res?.ok) showToast(res?.error || 'Pausieren fehlgeschlagen.', { error: true });
  });

  container.querySelector('#quiz-resume')?.addEventListener('click', async () => {
    const res = await emitWithAck('arcade:match:resume', { matchId: match?.matchId, playerId: getMyId() });
    if (!res?.ok) showToast(res?.error || 'Fortsetzen fehlgeschlagen.', { error: true });
  });

}

function updateQuizPauseUi() {
  updateCountdownBadge();
  const answer = document.querySelector('#quiz-answer');
  const submit = document.querySelector('#quiz-answer-form button[type="submit"]');
  if (answer) answer.disabled = match.paused;
  if (submit) submit.disabled = match.paused;
  const button = document.querySelector('#quiz-pause, #quiz-resume');
  if (button) {
    button.outerHTML = quizPauseButtonHtml();
    wireQuizPauseControl(document);
  }
  if (!match.paused && quizAnswerHadFocusBeforePause && answer) {
    answer.focus();
    quizAnswerHadFocusBeforePause = false;
  }
}
