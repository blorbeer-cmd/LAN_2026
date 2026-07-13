import { escapeHtml, avatarHtml } from '../format.js';
import { connectSocket } from '../socket.js';
import { arcadeStreamCanvasSize, drawArcadeStreamCanvas } from '../arcadeStreamRenderer.js';

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

const rerender = () => window.dispatchEvent(new CustomEvent('lan:rerender'));
const navigate = (view) => window.dispatchEvent(new CustomEvent('lan:navigate', { detail: view }));
const isArcadeWatchView = () => document.getElementById('view-container')?.dataset.view === 'arcadeWatch';

function ensureSocket() {
  if (socket) return socket;
  socket = connectSocket();
  socket.on('arcade:watch:list', (payload) => {
    watchList = payload?.matches ?? [];
    if (watchedMatchId && !watchList.some((match) => match.matchId === watchedMatchId)) {
      watchedMatchId = null;
      watchedState = null;
      if (isArcadeWatchView()) navigate('arcade');
      return;
    }
    if (isArcadeWatchView()) rerender();
  });
  socket.on('arcade:watch:ended', (payload) => {
    if (!watchedMatchId || payload?.matchId !== watchedMatchId) return;
    watchedMatchId = null;
    watchedState = null;
    if (isArcadeWatchView()) navigate('arcade');
  });
  socket.on('arcade:watch:state', (payload) => {
    if (!watchedMatchId || payload?.matchId !== watchedMatchId) return;
    watchedState = payload;
    const canvas = document.querySelector('#arcade-watch-canvas');
    if (canvas) drawArcadeStreamCanvas(canvas, payload);
    updateWatchMeta(payload);
    if (isArcadeWatchView() && !document.querySelector('#arcade-watch-canvas') && payload.gameType !== 'quiz') rerender();
  });
  return socket;
}

export function arcadeWatchMatches() {
  return watchList;
}

export function startArcadeWatch(matchId) {
  watchedMatchId = matchId;
  watchedState = null;
  ensureSocket().emit('arcade:watch:join', { matchId }, (result) => {
    if (!result?.ok) {
      watchedMatchId = null;
      watchedState = null;
      if (isArcadeWatchView()) navigate('arcade');
      return;
    }
    rerender();
  });
  navigate('arcadeWatch');
}

function leaveWatch() {
  socket?.emit('arcade:watch:leave');
  watchedMatchId = null;
  watchedState = null;
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

export function renderArcadeWatch(container) {
  ensureSocket();
  const state = watchedState;
  const name = GAME_NAMES[state?.gameType] ?? GAME_NAMES[watchList.find((match) => match.matchId === watchedMatchId)?.gameType] ?? 'Arcade';
  container.innerHTML = `
    <div class="arcade-game-shell arcade-watch-shell">
      <button type="button" class="btn btn-sm" id="arcade-watch-back">‹ Arcade</button>
      <h1 class="view-title">${escapeHtml(name)} ansehen</h1>
      <div class="arcade-watch-header"><span id="arcade-watch-status">${state?.paused ? 'Pause' : 'Läuft'}</span><span class="muted">Nur Zuschauer</span></div>
      ${rosterHtml(state ?? {})}
      ${stateHtml(state)}
      ${state?.gameType === 'scribble' ? '<div class="arcade-watch-safe-note">Wort, Tipps und Chat werden für Zuschauer verborgen.</div>' : ''}
    </div>`;
  container.querySelector('#arcade-watch-back')?.addEventListener('click', leaveWatch);
  if (state && state.gameType !== 'quiz') drawArcadeStreamCanvas(container.querySelector('#arcade-watch-canvas'), state);
}
