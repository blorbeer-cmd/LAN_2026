import { escapeHtml } from '../../format.js';
import { connectSocket } from '../../socket.js';
import { arcadeStreamCanvasSize, drawArcadeStreamCanvas } from '../shared/arcadeStreamRenderer.js';
import { drawPongFrame, PONG_CANVAS_SIZE } from './pong.js';
import { drawBlobbyFrame, BLOBBY_CANVAS_SIZE } from './blobby.js';
import { drawSnakeBoard } from './snake.js';
import { tetrisSpectatorHtml, paintTetrisSpectator } from './tetris.js';
import { battleshipSpectatorHtml } from './battleship.js';
import { getMyId } from '../../whoami.js';
import { icon } from '../../icons.js';
import { showToast } from '../../toast.js';
import { snakeColor } from '../shared/snakeColors.js';
import { arcadeGameHeaderHtml, arcadeMatchControlsHtml, arcadePlayerStripHtml, arcadeScoreboardHtml } from '../arcadeUi.js';

const GAME_NAMES = {
  quiz: 'Gaming-Quiz',
  tetris: 'Tetris',
  scribble: 'Scribble',
  pong: 'Pong',
  blobby: 'Blobby Volley',
  snake: 'Snake',
  battleship: 'Battleship',
  'challenge-rush': 'Challenge Rush',
};

let socket = null;
let watchedMatchId = null;
let watchedState = null;
let previousState = null; // the snapshot before watchedState, for interpolation
let watchedReceivedAt = 0;
let watchFrame = null;
let watchList = [];
let watchCanVote = false;
let watchVotingPlayerId = null;
let watchThumbToken = null;
let watchThumbActive = false;
let lastRenderSignature = '';

const rerender = () => window.dispatchEvent(new CustomEvent('respawn:rerender'));
const navigate = (view) => window.dispatchEvent(new CustomEvent('respawn:navigate', { detail: view }));
// Replaces the current history entry instead of pushing — used when leaving
// a watch view whose match is gone, so the stale entry never stays reachable
// via back/forward (see switchView in app.js).
const navigateReplace = (view) => window.dispatchEvent(new CustomEvent('respawn:navigate', { detail: { view, replace: true } }));
const isArcadeWatchView = () => document.getElementById('view-container')?.dataset.view === 'arcadeWatch';

function resetVoting() {
  watchCanVote = false;
  watchVotingPlayerId = null;
  watchThumbToken = null;
  watchThumbActive = false;
  lastRenderSignature = '';
}

function renderSignature(state) {
  const voting = state?.voting;
  // A new token means the vote reset for a new drawing — drop any stale
  // "already thumbed" state from the previous one.
  if (voting?.token !== watchThumbToken) {
    watchThumbToken = voting?.token ?? null;
    watchThumbActive = false;
  }
  return JSON.stringify({
    phase: state?.phase,
    question: state?.gameType === 'quiz' ? state.question : undefined,
    paused: state?.gameType === 'quiz' ? state.paused : undefined,
    token: voting?.token,
    count: voting?.count,
    snakeAlive: state?.gameType === 'snake' ? state.world?.snakes?.map((snake) => snake.alive !== false) : undefined,
    // Battleship boards are plain markup: every new shot rebuilds them.
    shots: state?.gameType === 'battleship' ? (state.players ?? []).map((player) => (player.shots ?? []).length) : undefined,
  });
}

function joinWatch(matchId) {
  const activeSocket = ensureSocket();
  const requestJoin = () => {
    activeSocket.emit('arcade:watch:join', { matchId, playerId: getMyId() }, (result) => {
      if (!result?.ok) {
        showToast(result?.error || 'Zuschauen ist gerade nicht möglich.');
        watchedMatchId = null;
        watchedState = null;
        resetVoting();
        if (isArcadeWatchView()) navigateReplace('arcade');
        return;
      }
      watchCanVote = result.canVote === true;
      watchVotingPlayerId = result.votingPlayerId ?? null;
      rerender();
    });
  };
  if (activeSocket.connected) requestJoin();
  else activeSocket.once('connect', requestJoin);
}

function ensureSocket() {
  if (socket) return socket;
  socket = connectSocket();
  socket.on('connect', () => {
    if (watchedMatchId && watchedState) joinWatch(watchedMatchId);
  });
  socket.on('arcade:watch:list', (payload) => {
    watchList = payload?.matches ?? [];
    if (watchedMatchId && !watchList.some((match) => match.matchId === watchedMatchId)) {
      watchedMatchId = null;
      watchedState = null;
      resetVoting();
      if (isArcadeWatchView()) navigateReplace('arcade');
      return;
    }
    if (isArcadeWatchView()) rerender();
  });
  socket.on('arcade:watch:ended', (payload) => {
    if (!watchedMatchId || payload?.matchId !== watchedMatchId) return;
    watchedMatchId = null;
    watchedState = null;
    resetVoting();
    if (isArcadeWatchView()) navigateReplace('arcade');
  });
  socket.on('arcade:watch:state', (payload) => {
    if (!watchedMatchId || payload?.matchId !== watchedMatchId) return;
    const signature = renderSignature(payload);
    const shouldRender = signature !== lastRenderSignature;
    previousState = watchedState;
    watchedState = payload;
    watchedReceivedAt = performance.now();
    const stage = document.querySelector('#arcade-watch-stage');
    if (stage) paintStage(stage, payload);
    updateWatchMeta(payload);
    if (isArcadeWatchView() && (shouldRender || !stage)) rerender();
  });
  return socket;
}

export function arcadeWatchMatches() {
  return watchList;
}

export function startArcadeWatch(matchId) {
  watchedMatchId = matchId;
  watchedState = null;
  previousState = null;
  resetVoting();
  joinWatch(matchId);
  navigate('arcadeWatch');
}

function leaveWatch() {
  socket?.emit('arcade:watch:leave');
  watchedMatchId = null;
  watchedState = null;
  resetVoting();
  navigate('arcade');
}

function playerId(player) {
  return player.playerId ?? player.id ?? player.ref?.id;
}

function playerName(player, index) {
  return player.name ?? player.ref?.name ?? `Spieler ${index + 1}`;
}

// The same score display the players see: two sides on the score bar (teams
// in Pong/Blobby doubles, otherwise player against player), a strip for
// free-for-all rounds. Snake keeps the snake colors on the canvas.
function scoresHtml(state) {
  // Tetris and Battleship carry names and values on each board, as for players.
  if (state.gameType === 'tetris' || state.gameType === 'battleship') return '';
  const players = state.players ?? [];
  if (!players.length) return '';
  const scores = new Map((state.scores ?? []).map((score) => [score.playerId, score.score]));
  const scoreOf = (player) => scores.get(playerId(player)) ?? player.score ?? 0;
  const entry = (player, index) => ({
    id: playerId(player),
    name: playerName(player, index),
    color: player.color ?? player.ref?.color,
    avatar: player.avatar ?? player.ref?.avatar,
    colorVar: state.gameType === 'snake' ? `var(${snakeColor(index).token})` : undefined,
  });
  const teams = players.some((player) => player.team === 'left' || player.team === 'right');
  if (teams) {
    const side = (team, label) => {
      const members = players.map((player, index) => ({ player, index })).filter(({ player }) => player.team === team);
      return { label, score: members.length ? scoreOf(members[0].player) : 0, players: members.map(({ player, index }) => entry(player, index)) };
    };
    return arcadeScoreboardHtml({ left: side('left', 'Team Blau'), right: side('right', 'Team Pink') });
  }
  if (players.length === 2 && state.gameType !== 'tetris') {
    const side = (index) => ({ label: state.gameType === 'snake' ? snakeColor(index).label : '', score: scoreOf(players[index]), players: [entry(players[index], index)] });
    return arcadeScoreboardHtml({ left: side(0), right: side(1) });
  }
  return arcadePlayerStripHtml(players.map((player, index) => {
    const out = state.gameType === 'snake' && state.world?.snakes?.[index]?.alive === false;
    return {
      name: playerName(player, index),
      colorVar: state.gameType === 'snake' ? `var(${snakeColor(index).token})` : (player.color ?? player.ref?.color ?? 'var(--text-muted)'),
      value: String(scoreOf(player)),
      detail: out ? 'Ausgeschieden' : '',
      out,
    };
  }));
}

// Quiz spectators get the same stage as the players: category, timer and the
// question, then the revealed answer. The server sends the answer only once
// the question is solved or timed out.
function quizSecondsLeft(state) {
  if (state.paused) return Math.max(0, Math.ceil((state.remainingMs ?? 0) / 1000));
  return state.expiresAt ? Math.max(0, Math.ceil((state.expiresAt - Date.now()) / 1000)) : null;
}

function quizWatchHtml(state) {
  if (state.phase === 'result' && state.correctAnswer) {
    return `<div class="quiz-stage-area"><div class="quiz-stage-body is-reveal">
      <span class="quiz-question-meta">${state.resultWinner ? `${escapeHtml(state.resultWinner)} hatte es` : 'Zeit abgelaufen'}</span>
      <p class="quiz-question">${escapeHtml(state.correctAnswer)}</p>
      ${state.question ? `<span class="quiz-stage-note">${escapeHtml(state.question)}</span>` : ''}
    </div></div>`;
  }
  if (!state.question) return '<div class="quiz-stage-area"><div class="quiz-stage-body is-waiting"><span class="quiz-stage-note">Nächste Frage kommt gleich</span></div></div>';
  const left = quizSecondsLeft(state);
  return `<div class="quiz-stage-area"><div class="quiz-stage-body">
    <div class="quiz-question-meta">
      <span>${escapeHtml(state.category || 'Quiz')}${state.difficulty ? ` · ${escapeHtml(state.difficulty)}` : ''}</span>
      <span id="arcade-watch-quiz-timer" class="quiz-timer${!state.paused && left !== null && left <= 5 ? ' is-urgent' : ''}">${state.paused ? 'Pause' : left === null ? '' : `${left} s`}</span>
    </div>
    <p class="quiz-question">${escapeHtml(state.question)}</p>
  </div></div>`;
}

let quizTimer = null;
function syncQuizTimer() {
  if (quizTimer) clearInterval(quizTimer);
  quizTimer = null;
  if (watchedState?.gameType !== 'quiz' || !watchedState.question || watchedState.phase === 'result') return;
  quizTimer = setInterval(() => {
    const el = document.querySelector('#arcade-watch-quiz-timer');
    if (!el || !watchedState || watchedState.paused) return;
    const left = quizSecondsLeft(watchedState);
    if (left === null) return;
    el.textContent = `${left} s`;
    el.classList.toggle('is-urgent', left <= 5);
  }, 1000);
}

// Draws the current snapshot with the game's own renderer. Pong and Blobby
// interpolate between snapshots, so they keep animating every frame.
function paintStage(stage, state) {
  const canvas = stage.querySelector('#arcade-watch-canvas');
  if (state.gameType === 'snake' && canvas && state.world) drawSnakeBoard(canvas, state.world, state.render);
  else if (state.gameType === 'tetris') paintTetrisSpectator(stage, state);
  else if (canvas && state.gameType !== 'pong' && state.gameType !== 'blobby' && state.gameType !== 'quiz' && state.gameType !== 'challenge-rush') drawArcadeStreamCanvas(canvas, state);
}

function animateStage() {
  if (watchFrame) cancelAnimationFrame(watchFrame);
  watchFrame = null;
  const tick = () => {
    const canvas = document.querySelector('#arcade-watch-stage #arcade-watch-canvas');
    if (!canvas || !watchedState || !isArcadeWatchView()) { watchFrame = null; return; }
    if (watchedState.gameType === 'pong') drawPongFrame(canvas, watchedState, watchedReceivedAt, watchedState.players ?? [], watchedState.mode);
    else if (watchedState.gameType === 'blobby') drawBlobbyFrame(canvas, watchedState, previousState, watchedReceivedAt, watchedState.players ?? []);
    else { watchFrame = null; return; }
    watchFrame = requestAnimationFrame(tick);
  };
  watchFrame = requestAnimationFrame(tick);
}

function statusText(state) {
  if (!state) return 'Verbindet';
  if (state.phase === 'ended') return 'Beendet';
  if (state.paused) return 'Pause';
  if (state.phase === 'countdown') return 'Startet gleich';
  if (state.phase === 'result') return 'Auswertung';
  return 'Läuft';
}

function updateWatchMeta(state) {
  const status = document.querySelector('#arcade-watch-status');
  if (status) status.textContent = statusText(state);
  const scores = document.querySelector('#arcade-watch-scores');
  if (scores) {
    const html = scoresHtml(state);
    if (scores.dataset.html !== html) {
      scores.innerHTML = html;
      scores.dataset.html = html;
    }
  }
}

function stateHtml(state) {
  if (!state) return '<div class="arcade-watch-placeholder">Verbindung zum Spiel wird hergestellt</div>';
  if (state.gameType === 'quiz') return quizWatchHtml(state);
  if (state.gameType === 'challenge-rush') {
    const challenge = typeof state.challenge === 'object' ? state.challenge : null;
    const title = challenge?.title ?? state.challenge ?? 'Mini-Challenge';
    const progress = `${Number(state.challengeIndex ?? 0) + 1} / ${Number(state.challengeCount ?? 4)}`;
    const scores = (state.scores ?? []).map((score) => `<div class="challenge-rush-score-row"><span>${escapeHtml(score.name ?? 'Spieler')}${score.forfeited ? ' · Forfait' : ''}</span><strong>${escapeHtml(String(score.score ?? 0))}</strong></div>`).join('');
    return `<div class="arcade-watch-placeholder challenge-rush-watch"><strong>${escapeHtml(String(title))}</strong><span>Aufgabe ${escapeHtml(progress)}</span>${scores ? `<div class="challenge-rush-scoreboard">${scores}</div>` : ''}</div>`;
  }
  
  if (state.gameType === 'pong') return `<div class="pong-arena"><canvas id="arcade-watch-canvas" width="${PONG_CANVAS_SIZE[0]}" height="${PONG_CANVAS_SIZE[1]}" aria-label="Livebild des Spiels"></canvas>${state.paused ? '<div class="pong-overlay">Pause</div>' : ''}</div>`;
  if (state.gameType === 'blobby') return `<div class="blobby-court"><canvas id="arcade-watch-canvas" width="${BLOBBY_CANVAS_SIZE[0]}" height="${BLOBBY_CANVAS_SIZE[1]}" aria-label="Livebild des Spiels"></canvas>${state.paused ? '<div class="blobby-pause-overlay">Pause</div>' : ''}</div>`;
  if (state.gameType === 'snake') return `<div class="snake-game"><canvas id="arcade-watch-canvas" aria-label="Livebild des Spiels"></canvas>${state.paused ? '<div class="snake-overlay">Pause</div>' : ''}</div>`;
  if (state.gameType === 'tetris') return tetrisSpectatorHtml(state);
  if (state.gameType === 'battleship') return battleshipSpectatorHtml(state);
  const [width, height] = arcadeStreamCanvasSize(state.gameType);
  return `<canvas id="arcade-watch-canvas" class="arcade-watch-stream" width="${width}" height="${height}" aria-label="Livebild des Spiels"></canvas>`;
}

// The only rating mechanic left: a live thumbs-up for whichever Scribble
// drawing is currently votable. No canvas replay - spectators already see
// it live via the stream canvas above.
function scribbleVotingHtml(state) {
  const voting = state?.voting;
  if (!voting?.token) return '';
  const identityInMatch = (state.players ?? []).some((player) => (player.id ?? player.playerId ?? player.ref?.id) === getMyId());
  const votingNote = watchCanVote
    ? 'Markiere das Bild - Favoriten stehen am Ende des Matches nochmal zur Wahl.'
    : identityInMatch ? 'Als Mitspieler stimmst du direkt in deiner Spielansicht ab.' : 'Zum Abstimmen muss auf diesem Gerät eine Spieleridentität ausgewählt sein.';
  return `<div class="arcade-watch-vote">
    <span class="arcade-section-meta">${escapeHtml(votingNote)}</span>
    <button type="button" class="btn btn-sm ${watchThumbActive ? 'btn-primary' : ''}" id="arcade-watch-thumb" aria-pressed="${watchThumbActive}" ${!watchCanVote ? 'disabled' : ''}>
      ${icon('thumbsUp')} <span id="arcade-watch-thumb-count">${voting.count ?? 0}</span>
    </button>
  </div>`;
}

function wireScribbleVoting(container) {
  container.querySelector('#arcade-watch-thumb')?.addEventListener('click', () => {
    const token = watchThumbToken;
    socket.emit('scribble:thumb', { matchId: watchedMatchId, playerId: watchVotingPlayerId, token }, (result) => {
      if (!result?.ok) return showToast(result?.error || 'Bewertung nicht möglich.', { error: true });
      if (token !== watchThumbToken) return; // the vote window rotated while the request was in flight
      watchThumbActive = result.active;
      const btn = container.querySelector('#arcade-watch-thumb');
      if (btn) {
        btn.classList.toggle('btn-primary', watchThumbActive);
        btn.setAttribute('aria-pressed', String(watchThumbActive));
      }
      const countEl = container.querySelector('#arcade-watch-thumb-count');
      if (countEl) countEl.textContent = String(result.count);
    });
  });
}

export function renderArcadeWatch(container) {
  ensureSocket();
  // A history entry can outlive its match: leave the watch view via the
  // global nav, let the match end, then press back. Without a watched match
  // this view would sit on "Verbindung…" forever, so redirect to the Arcade
  // and replace the stale entry instead of pushing on top of it (a pushed
  // entry would make the back button bounce between both states).
  if (!watchedMatchId) {
    window.dispatchEvent(new CustomEvent('respawn:navigate', { detail: { view: 'arcade', replace: true } }));
    return;
  }
  const state = watchedState;
  const name = GAME_NAMES[state?.gameType] ?? GAME_NAMES[watchList.find((match) => match.matchId === watchedMatchId)?.gameType] ?? 'Arcade';
  const privacyNote = state?.gameType === 'scribble'
    ? 'Wort, Tipps und Chat sind für Zuschauer verborgen'
    : state?.gameType === 'battleship' ? 'Ungetroffene Schiffe bleiben für Zuschauer verborgen' : '';
  container.innerHTML = `
    <div class="arcade-game-shell arcade-watch-shell">
      ${arcadeGameHeaderHtml(name, arcadeMatchControlsHtml('<button type="button" class="btn btn-sm" id="arcade-watch-back">Beenden</button>'), { expand: false, mute: false })}
      <section class="card arcade-stage">
        <div class="arcade-watch-status"><strong id="arcade-watch-status">${statusText(state)}</strong><span class="arcade-section-meta">Du schaust zu</span></div>
        <div id="arcade-watch-scores">${state ? scoresHtml(state) : ''}</div>
        <div id="arcade-watch-stage">${stateHtml(state)}</div>
        ${state?.gameType === 'scribble' ? scribbleVotingHtml(state) : ''}
        ${privacyNote ? `<p class="arcade-section-meta arcade-watch-note">${privacyNote}</p>` : ''}
      </section>
    </div>`;
  lastRenderSignature = renderSignature(state);
  container.querySelector('#arcade-watch-back')?.addEventListener('click', leaveWatch);
  const stage = container.querySelector('#arcade-watch-stage');
  if (state && stage) paintStage(stage, state);
  animateStage();
  if (state?.gameType === 'scribble') {
    wireScribbleVoting(container);
  }
  syncQuizTimer();
}
