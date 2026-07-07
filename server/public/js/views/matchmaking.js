// Matchmaking view (FR-16..18): pick a game + present players, draw balanced
// teams. Results are stored in shared state (updated live via the
// matchmaking:generated socket event) so everyone at the party sees the same
// draw, not just whoever clicked the button.

import { api } from '../api.js';
import { state, gameById } from '../state.js';
import { escapeHtml, avatarHtml, gameBadgeHtml } from '../format.js';
import { showToast } from '../toast.js';

// Persists across re-renders of this view (but not across a full page
// reload) so toggling checkboxes survives a re-roll without extra plumbing.
let checkedIds = null;

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
    </div>
    <div id="mm-result">${renderResult(state.lastMatchmaking)}</div>
  `;

  container.querySelector('#mm-game').addEventListener('change', (e) => {
    state.selectedGameId = e.target.value;
  });

  container.querySelectorAll('[data-player]').forEach((cb) => {
    cb.addEventListener('change', () => {
      if (cb.checked) checkedIds.add(cb.dataset.player);
      else checkedIds.delete(cb.dataset.player);
    });
  });

  container.querySelector('#mm-generate').addEventListener('click', async () => {
    const gameId = container.querySelector('#mm-game').value;
    const playerIds = [...checkedIds];
    if (playerIds.length < 2) {
      return showToast('Mindestens 2 Spieler auswählen.', { error: true });
    }
    const teamCountRaw = container.querySelector('#mm-teamcount').value;
    const body = { gameId, playerIds };
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
        <div class="team-card-header"><span>Team ${i + 1}</span><span>Σ ${t.totalRating}</span></div>
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

  return `
    <div class="section-title row" style="gap:8px;">${gameBadgeHtml(gameById(result.gameId), 22)} ${escapeHtml(result.gameName)} — Ergebnis</div>
    <div class="grid" style="grid-template-columns:repeat(auto-fit, minmax(150px, 1fr));">${teamsHtml}</div>
  `;
}
