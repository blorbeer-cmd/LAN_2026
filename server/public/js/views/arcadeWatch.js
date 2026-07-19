import { escapeHtml, avatarHtml } from '../format.js';
import { connectSocket } from '../socket.js';
import { arcadeStreamCanvasSize, drawArcadeStreamCanvas } from '../arcadeStreamRenderer.js';
import { getMyId } from '../whoami.js';
import { icon } from '../icons.js';
import { showToast } from '../toast.js';

const GAME_NAMES = {
  quiz: 'Gaming-Quiz',
  tetris: 'Tetris',
  scribble: 'Scribble',
  pong: 'Pong',
  blobby: 'Blobby Volley',
  snake: 'Snake',
};

let socket = null;
let watchedMatchId = null;
let watchedState = null;
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

function votingSignature(state) {
  const voting = state?.voting;
  // A new token means the vote reset for a new drawing — drop any stale
  // "already thumbed" state from the previous one.
  if (voting?.token !== watchThumbToken) {
    watchThumbToken = voting?.token ?? null;
    watchThumbActive = false;
  }
  return JSON.stringify({ phase: state?.phase, token: voting?.token, count: voting?.count });
}

function joinWatch(matchId) {
  ensureSocket().emit('arcade:watch:join', { matchId, playerId: getMyId() }, (result) => {
    if (!result?.ok) {
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
    const signature = votingSignature(payload);
    const shouldRender = signature !== lastRenderSignature;
    watchedState = payload;
    const canvas = document.querySelector('#arcade-watch-canvas');
    if (canvas) drawArcadeStreamCanvas(canvas, payload);
    updateWatchMeta(payload);
    if (isArcadeWatchView() && (shouldRender || (!canvas && payload.gameType !== 'quiz'))) rerender();
  });
  return socket;
}

export function arcadeWatchMatches() {
  return watchList;
}

export function startArcadeWatch(matchId) {
  watchedMatchId = matchId;
  watchedState = null;
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

function rosterHtml(state) {
  const players = state.players ?? [];
  const scores = new Map((state.scores ?? []).map((score) => [score.playerId, score.score]));
  return `<div class="arcade-watch-roster">${players
    .map((player, index) => {
      const name = player.name ?? player.ref?.name ?? `Spieler ${index + 1}`;
      const score = scores.get(player.playerId ?? player.id) ?? player.score;
      return `<div class="arcade-watch-player">${avatarHtml({ ...player, name }, 28)}<span>${escapeHtml(name)}</span>${score === undefined ? '' : `<strong>${escapeHtml(String(score))}</strong>`}</div>`;
    })
    .join('')}</div>`;
}

function updateWatchMeta(state) {
  const status = document.querySelector('#arcade-watch-status');
  if (status) status.textContent = state.paused ? 'Pause' : state.phase === 'countdown' ? 'Startet gleich' : 'Läuft';
}

function stateHtml(state) {
  if (!state) return '<div class="empty-state">Verbindung zum Spiel wird hergestellt…</div>';
  if (state.gameType === 'quiz') return '<div class="arcade-watch-safe-note">Frage und Antworten werden für Zuschauer verborgen.</div>';
  const [width, height] = arcadeStreamCanvasSize(state.gameType);
  return `<canvas id="arcade-watch-canvas" width="${width}" height="${height}" aria-label="Livebild des Spiels"></canvas>`;
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
  return `<div class="row-between" style="margin-top:var(--space-3);gap:var(--space-2);">
    <span class="muted">${escapeHtml(votingNote)}</span>
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
  container.innerHTML = `
    <div class="arcade-game-shell arcade-watch-shell">
      <button type="button" class="btn btn-sm" id="arcade-watch-back">‹ Arcade</button>
      <h1 class="view-title">${escapeHtml(name)} ansehen</h1>
      <div class="arcade-watch-header"><span id="arcade-watch-status">${state?.paused ? 'Pause' : 'Läuft'}</span><span class="muted">Nur Zuschauer</span></div>
      ${rosterHtml(state ?? {})}
      ${stateHtml(state)}
      ${state?.gameType === 'scribble' ? scribbleVotingHtml(state) : ''}
      ${state?.gameType === 'scribble' ? '<div class="arcade-watch-safe-note">Wort, Tipps und Chat werden für Zuschauer verborgen.</div>' : ''}
    </div>`;
  lastRenderSignature = votingSignature(state);
  container.querySelector('#arcade-watch-back')?.addEventListener('click', leaveWatch);
  if (state && state.gameType !== 'quiz' && container.querySelector('#arcade-watch-canvas')) {
    drawArcadeStreamCanvas(container.querySelector('#arcade-watch-canvas'), state);
  }
  if (state?.gameType === 'scribble') {
    wireScribbleVoting(container);
  }
}
