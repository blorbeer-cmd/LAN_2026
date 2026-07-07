// Matchmaking view (FR-16..18): pick a game + present players, draw balanced
// teams. Results are stored in shared state (updated live via the
// matchmaking:generated socket event) so everyone at the party sees the same
// draw, not just whoever clicked the button.

import { api } from '../api.js';
import { state, gameById } from '../state.js';
import { escapeHtml, avatarHtml, gameBadgeHtml, formatDateTime } from '../format.js';
import { showToast } from '../toast.js';

// Persists across re-renders of this view (but not across a full page
// reload) so toggling checkboxes survives a re-roll without extra plumbing.
let checkedIds = null;
let avoidAdjacentOpponents = false;

// Cached separately from `state` (like votes.js does for Vote-Historie)
// since it's fetched from its own endpoint, scoped to whichever game is
// currently selected.
let historyCache = null;
let historyLoading = false;
let historyForGameId = null;

async function loadHistory(gameId, ctx) {
  historyLoading = true;
  try {
    const res = await api.matchmaking.history(gameId);
    historyCache = res.history;
    historyForGameId = gameId;
  } catch {
    historyCache = [];
    historyForGameId = gameId;
  } finally {
    historyLoading = false;
    ctx.rerender();
  }
}

// Called from app.js whenever a matchmaking:generated event arrives, so a
// freshly drawn set of teams shows up in the history next render instead of
// whatever the last fetch happened to see.
export function invalidateMatchmakingHistory() {
  historyForGameId = null;
}

function renderHistory() {
  if (historyLoading || historyCache === null) {
    return `<div class="empty-state" style="padding:16px;">Lädt…</div>`;
  }
  if (historyCache.length === 0) {
    return `<div class="empty-state" style="padding:16px;"><span class="emoji">⚖️</span>Noch keine Auslosungen für dieses Spiel.</div>`;
  }
  return historyCache
    .map((draw) => {
      const teamsHtml = draw.teams
        .map(
          (t, i) => `
          <div class="team-card">
            <div class="team-card-header"><span>Team ${i + 1}</span><span>Score ${t.totalRating}</span></div>
            ${t.players.map((p) => `<div class="team-player">${avatarHtml(p, 18)} ${escapeHtml(p.name)}<span class="rating">${p.rating}</span></div>`).join('')}
          </div>`
        )
        .join('');
      return `
        <div class="card stack" style="margin-bottom:10px;">
          <div class="muted" style="font-size:0.75rem;">${formatDateTime(draw.generatedAt)}</div>
          <div class="grid" style="grid-template-columns:repeat(auto-fit, minmax(130px, 1fr));">${teamsHtml}</div>
        </div>`;
    })
    .join('');
}

export function renderMatchmaking(container, ctx) {
  if (state.games.length === 0 || state.players.length === 0) {
    container.innerHTML = `
      <h1 class="view-title">Teams auslosen</h1>
      <div class="empty-state"><span class="emoji">⚖️</span>Dafür braucht es mindestens ein Spiel und 2 Spieler.</div>`;
    return;
  }

  if (checkedIds === null) {
    // First render: default to whoever is currently shown as playing.
    checkedIds = new Set(state.live.filter((p) => p.state === 'playing').map((p) => p.player_id));
    if (checkedIds.size === 0) checkedIds = new Set(state.players.map((p) => p.id));
  }

  const selectedGameId = state.selectedGameId || state.games[0].id;

  if (historyForGameId !== selectedGameId && !historyLoading) {
    loadHistory(selectedGameId, ctx);
  }

  const gameOptions = state.games
    .map((g) => `<option value="${g.id}" ${g.id === selectedGameId ? 'selected' : ''}>${escapeHtml(g.icon)} ${escapeHtml(g.name)}</option>`)
    .join('');

  const playerRows = state.players
    .map(
      (p) => `
      <label class="check-row">
        <input type="checkbox" data-player="${p.id}" ${checkedIds.has(p.id) ? 'checked' : ''} />
        ${avatarHtml(p, 20)}
        <span style="flex:1;">${escapeHtml(p.name)}</span>
      </label>`
    )
    .join('');

  container.innerHTML = `
    <h1 class="view-title">Teams auslosen</h1>
    <div class="card stack">
      <select id="mm-game">${gameOptions}</select>
      <div>${playerRows}</div>
      <div class="row">
        <input type="number" id="mm-teamcount" placeholder="Teams" min="2" style="width:90px;flex-shrink:0;" />
        <button type="button" class="btn btn-primary" id="mm-generate" style="flex:1;">Teams auslosen</button>
      </div>
      <div class="muted" style="font-size:0.78rem;margin-top:-6px;">Anzahl Teams leer lassen für automatisch (Standard: 2)</div>
      <label class="check-row">
        <input type="checkbox" id="mm-avoid-adjacent" ${avoidAdjacentOpponents ? 'checked' : ''} />
        <span>🪑 Sitznachbarn nicht gegeneinander auslosen</span>
      </label>
    </div>
    <div id="mm-result">${renderResult(state.lastMatchmaking)}</div>

    <div class="section-title">🕓 Team-Historie</div>
    ${renderHistory()}
  `;

  container.querySelector('#mm-game').addEventListener('change', (e) => {
    state.selectedGameId = e.target.value;
    ctx.rerender();
  });

  container.querySelectorAll('[data-player]').forEach((cb) => {
    cb.addEventListener('change', () => {
      if (cb.checked) checkedIds.add(cb.dataset.player);
      else checkedIds.delete(cb.dataset.player);
    });
  });

  container.querySelector('#mm-avoid-adjacent').addEventListener('change', (e) => {
    avoidAdjacentOpponents = e.target.checked;
  });

  container.querySelector('#mm-generate').addEventListener('click', async () => {
    const gameId = container.querySelector('#mm-game').value;
    const playerIds = [...checkedIds];
    if (playerIds.length < 2) {
      return showToast('Mindestens 2 Spieler auswählen.', { error: true });
    }
    const teamCountRaw = container.querySelector('#mm-teamcount').value;
    const body = { gameId, playerIds, avoidAdjacentOpponents };
    if (teamCountRaw) body.teamCount = parseInt(teamCountRaw, 10);

    try {
      const result = await api.matchmaking.generate(body);
      state.lastMatchmaking = result;
      ctx.rerender();
    } catch (err) {
      showToast(err.message, { error: true });
    }
  });
}

function renderResult(result) {
  if (!result) return '';
  const teamsHtml = result.teams
    .map(
      (t, i) => `
      <div class="team-card">
        <div class="team-card-header"><span>Team ${i + 1}</span><span>Score ${t.totalRating}</span></div>
        ${t.players
          .map(
            (p) => `
          <div class="team-player">
            ${avatarHtml(p, 20)}
            ${escapeHtml(p.name)}
            <span class="rating">${p.rating}</span>
          </div>`
          )
          .join('')}
      </div>`
    )
    .join('');

  const seatingNote = result.seatPairsConsidered
    ? result.seatConflicts > 0
      ? `<div class="muted" style="font-size:0.78rem;margin-top:8px;">🪑 ${result.seatConflicts} von ${result.seatPairsConsidered} Sitznachbarschaft(en) mussten trotzdem gegeneinander antreten (sonst wäre es zu unfair geworden).</div>`
      : `<div class="muted" style="font-size:0.78rem;margin-top:8px;">🪑 Alle Sitznachbarn sind im selben Team.</div>`
    : '';

  return `
    <div class="section-title row" style="gap:8px;">${gameBadgeHtml(gameById(result.gameId), 22)} ${escapeHtml(result.gameName)} — Ergebnis</div>
    <div class="grid" style="grid-template-columns:repeat(auto-fit, minmax(150px, 1fr));">${teamsHtml}</div>
    ${seatingNote}
  `;
}
