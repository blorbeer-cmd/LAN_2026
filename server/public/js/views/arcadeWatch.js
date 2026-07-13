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
let watchReactions = {};
let watchFavoriteDrawingId = null;
let lastRenderSignature = '';

const rerender = () => window.dispatchEvent(new CustomEvent('lan:rerender'));
const navigate = (view) => window.dispatchEvent(new CustomEvent('lan:navigate', { detail: view }));
// Replaces the current history entry instead of pushing — used when leaving
// a watch view whose match is gone, so the stale entry never stays reachable
// via back/forward (see switchView in app.js).
const navigateReplace = (view) => window.dispatchEvent(new CustomEvent('lan:navigate', { detail: { view, replace: true } }));
const isArcadeWatchView = () => document.getElementById('view-container')?.dataset.view === 'arcadeWatch';

function resetVoting() {
  watchCanVote = false;
  watchVotingPlayerId = null;
  watchReactions = {};
  watchFavoriteDrawingId = null;
  lastRenderSignature = '';
}

function votingSignature(state) {
  const voting = state?.voting;
  return JSON.stringify({
    phase: state?.phase,
    mode: voting?.mode,
    round: voting?.round,
    drawings: (voting?.drawings ?? []).map((drawing) => ({
      id: drawing.id,
      reactions: drawing.reactions,
      favoriteVotes: drawing.favoriteVotes,
      winner: drawing.isRoundWinner,
    })),
  });
}

function syncWatchSelections() {
  if (!watchCanVote || !watchedMatchId || !watchVotingPlayerId) return;
  socket.emit('scribble:watch:selections', { matchId: watchedMatchId, playerId: watchVotingPlayerId }, (result) => {
    if (!result?.ok) return;
    watchReactions = result.selectedRatings?.reactions ?? {};
    watchFavoriteDrawingId = result.selectedRatings?.favoriteDrawingId ?? null;
    if (isArcadeWatchView()) rerender();
  });
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
    syncWatchSelections();
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
  if (status) status.textContent = state.paused ? 'Pause' : state.phase === 'countdown' ? 'Startet gleich' : state.phase === 'gallery' ? 'Abstimmung' : 'Läuft';
}

function stateHtml(state) {
  if (!state) return '<div class="empty-state">Verbindung zum Spiel wird hergestellt…</div>';
  if (state.gameType === 'quiz') return '<div class="arcade-watch-safe-note">Frage und Antworten werden für Zuschauer verborgen.</div>';
  if (state.gameType === 'scribble' && state.phase !== 'drawing') {
    return state.voting?.drawings?.length ? '' : '<div class="empty-state">Die nächste Zeichnung startet gleich.</div>';
  }
  const [width, height] = arcadeStreamCanvasSize(state.gameType);
  return `<canvas id="arcade-watch-canvas" width="${width}" height="${height}" aria-label="Livebild des Spiels"></canvas>`;
}

const REACTION_OPTIONS = [
  { id: 'cool', label: 'Cool', icon: 'sparkles' },
  { id: 'creative', label: 'Kreativ', icon: 'lightbulb' },
  { id: 'funny', label: 'Witzig', icon: 'star' },
];

function spectatorReactionControlsHtml(drawing, resolved) {
  return `<div class="scribble-reactions" aria-label="Bild bewerten">
    ${REACTION_OPTIONS.map((option) => {
      const selected = watchReactions[drawing.id] === option.id;
      return `<button type="button" class="btn btn-sm ${selected ? 'btn-primary' : ''}" data-watch-reaction="${option.id}" data-watch-drawing-id="${drawing.id}" aria-pressed="${selected}" ${!watchCanVote || resolved ? 'disabled' : ''}>
        ${icon(option.icon)} ${option.label} <span>${drawing.reactions?.[option.id] ?? 0}</span>
      </button>`;
    }).join('')}
  </div>`;
}

function spectatorDrawingHtml(drawing, voting) {
  const resolved = voting.mode === 'resolved';
  const winner = resolved && drawing.isRoundWinner;
  const favoriteSelected = watchFavoriteDrawingId === drawing.id;
  return `<article class="card stack scribble-drawing-card ${winner ? 'is-winner' : ''}">
    <div class="row-between" style="gap:var(--space-2);">
      <strong>${escapeHtml(drawing.artistName)}</strong>
      ${winner ? `<span class="badge">${icon('trophy')} Rundenbild</span>` : `<span class="muted">${drawing.reactionCount ?? 0} Reaktionen</span>`}
    </div>
    <div class="scribble-stored-canvas-wrap"><canvas data-watch-stored-drawing="${drawing.id}" aria-label="Zeichnung von ${escapeHtml(drawing.artistName)}"></canvas></div>
    ${spectatorReactionControlsHtml(drawing, resolved)}
    ${voting.mode === 'favorite'
      ? `<button type="button" class="btn ${favoriteSelected ? 'btn-primary' : ''}" data-watch-favorite="${drawing.id}" aria-pressed="${favoriteSelected}" ${!watchCanVote ? 'disabled' : ''}>
          ${icon('star')} ${favoriteSelected ? 'Dein Favorit' : 'Als Favorit wählen'} · ${drawing.favoriteVotes ?? 0}
        </button>`
      : resolved ? `<div class="muted">${drawing.favoriteVotes ?? 0} Favoritenstimmen</div>` : ''}
  </article>`;
}

function scribbleVotingHtml(state) {
  const voting = state?.voting;
  if (!voting?.drawings?.length) return '';
  const heading = voting.mode === 'favorite' ? 'Favorit der Runde' : voting.mode === 'resolved' ? 'Rundenbild gekürt' : 'Letztes Bild bewerten';
  const identityInMatch = (state.players ?? []).some((player) => (player.id ?? player.playerId ?? player.ref?.id) === getMyId());
  const votingNote = watchCanVote
    ? voting.mode === 'favorite' ? 'Wähle genau einen Favoriten. Deine Auswahl kann bis zum Ende geändert werden.' : 'Deine Reaktion fließt direkt in die Rundenauswertung ein.'
    : identityInMatch ? 'Als Mitspieler stimmst du direkt in deiner Spielansicht ab.' : 'Zum Abstimmen muss auf diesem Gerät eine Spieleridentität ausgewählt sein.';
  return `<section class="stack scribble-round-gallery" style="margin-top:var(--space-3);">
    <div>
      <div class="section-title">${heading}</div>
      <div class="muted">${escapeHtml(votingNote)}</div>
    </div>
    <div class="scribble-gallery-grid">${voting.drawings.map((drawing) => spectatorDrawingHtml(drawing, voting)).join('')}</div>
  </section>`;
}

function drawStoredScribbleCanvases(container, state) {
  const drawings = new Map((state?.voting?.drawings ?? []).map((drawing) => [drawing.id, drawing]));
  container.querySelectorAll('[data-watch-stored-drawing]').forEach((canvas) => {
    const drawing = drawings.get(canvas.dataset.watchStoredDrawing);
    if (drawing) drawArcadeStreamCanvas(canvas, { gameType: 'scribble', strokes: drawing.strokes });
  });
}

function wireScribbleVoting(container) {
  container.querySelectorAll('[data-watch-reaction]').forEach((button) => {
    button.addEventListener('click', () => {
      socket.emit('scribble:reaction', {
        matchId: watchedMatchId,
        playerId: watchVotingPlayerId,
        drawingId: button.dataset.watchDrawingId,
        reaction: button.dataset.watchReaction,
      }, (result) => {
        if (!result?.ok) return showToast(result?.error || 'Bewertung nicht möglich.', { error: true });
        watchReactions[button.dataset.watchDrawingId] = result.reaction;
        rerender();
      });
    });
  });
  container.querySelectorAll('[data-watch-favorite]').forEach((button) => {
    button.addEventListener('click', () => {
      socket.emit('scribble:favorite', {
        matchId: watchedMatchId,
        playerId: watchVotingPlayerId,
        drawingId: button.dataset.watchFavorite,
      }, (result) => {
        if (!result?.ok) return showToast(result?.error || 'Favorit konnte nicht gewählt werden.', { error: true });
        watchFavoriteDrawingId = result.drawingId;
        rerender();
      });
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
    window.dispatchEvent(new CustomEvent('lan:navigate', { detail: { view: 'arcade', replace: true } }));
    return;
  }
  const state = watchedState;
  const name = GAME_NAMES[state?.gameType] ?? GAME_NAMES[watchList.find((match) => match.matchId === watchedMatchId)?.gameType] ?? 'Arcade';
  container.innerHTML = `
    <div class="arcade-game-shell arcade-watch-shell">
      <button type="button" class="btn btn-sm" id="arcade-watch-back">‹ Arcade</button>
      <h1 class="view-title">${escapeHtml(name)} ansehen</h1>
      <div class="arcade-watch-header"><span id="arcade-watch-status">${state?.paused ? 'Pause' : state?.phase === 'gallery' ? 'Abstimmung' : 'Läuft'}</span><span class="muted">Nur Zuschauer</span></div>
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
    drawStoredScribbleCanvases(container, state);
    wireScribbleVoting(container);
  }
}
