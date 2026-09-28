// Leaderboard view (FR-22..25) plus playtime stats (FR-29): overall or
// per-game standings, a form to record a match result, and total playtime
// per player (derived from the agent's start/stop history). Team assignment
// uses one "which team?" selector per player (instead of duplicated
// checkboxes per team column) so a player can never accidentally end up on
// two teams at once.

import { api } from '../api.js';
import { state, gamesWithHistory } from '../state.js';
import { escapeHtml, avatarHtml } from '../format.js';
import { searchSelectHtml, wireSearchSelect } from '../searchSelect.js';
import { emptyStateHtml } from '../emptyState.js';
import { openMatchForm } from './adminResultForm.js';

export function renderLeaderboard(container, ctx) {
  const filterGameId = state.selectedGameId || '';
  // Accepted games only — plus any game that already carries results, so a
  // game moved back to the suggestions after it was played keeps its own
  // ranking reachable instead of silently dropping out of the filter.
  const lbGameOptions = [
    { value: '', label: 'Gesamt' },
    ...gamesWithHistory().map((g) => ({ value: g.id, label: g.name })),
  ];

  const standings = state.leaderboard?.standings || [];
  const rows = standings
    .map((s, i) => {
      const player = state.players.find((p) => p.id === s.playerId);
      const name = player ? player.name : s.name;
      const color = player ? player.color : s.color;
      return `
        <div class="lb-row ${i === 0 ? 'rank-1' : ''}">
          <span class="lb-rank">${i + 1}</span>
          ${avatarHtml(player || { color }, 24)}
          <span class="leaderboard-row-main">
            <span class="player-name leaderboard-row-name">${escapeHtml(name)}</span>
            <span class="muted leaderboard-row-stat">${s.wins} Siege / ${s.matchesPlayed} Spiele</span>
          </span>
          <span class="lb-points" aria-label="${s.points} Punkte">${s.points} P</span>
        </div>`;
    })
    .join('');

  // When filtered to one game, show that game's per-player times (already
  // scoped by the API); otherwise show each player's grand total across all
  // games — either way, the same "totals" list applies since the API scopes
  // it to whatever ?gameId= was requested.
  // activeMs (focused + not idle) is only non-zero for players who opted
  // into activity tracking, so only show the "davon aktiv" hint when there's
  // something meaningful to say. Still renders the line (just visibility:
  // hidden, not omitted) so every row in the list reserves the same height —
  // otherwise rows with the hint were visibly taller than rows without it.
  const activeHint = (activeMs, totalMs, activeFormatted) => {
    const show = activeMs > 0 && activeMs < totalMs;
    return `<div class="muted" style="font-size:var(--font-size-xs);${show ? '' : 'visibility:hidden;'}">davon aktiv gespielt: ${escapeHtml(activeFormatted || '0m')}</div>`;
  };

  const playtime = state.playtime?.totals || [];
  const playtimeRows = playtime
    .map(
      (p) => `
      <div class="lb-row">
        ${avatarHtml(state.players.find((pl) => pl.id === p.playerId) || { color: p.playerColor }, 24)}
        <span class="leaderboard-row-main">
          <span class="player-name leaderboard-row-name">${escapeHtml(p.playerName)}</span>
          ${activeHint(p.activeMs, p.totalMs, p.activeFormatted)}
        </span>
        <span class="lb-points">${escapeHtml(p.formatted)}</span>
      </div>`
    )
    .join('');

  // "How long did this game run at the party in total" — summed across
  // everyone, as opposed to the per-player breakdown above.
  const playtimeByGame = state.playtimeAllGames?.totalsByGame || [];
  const playtimeByGameRows = playtimeByGame
    .map(
      (g) => `
      <div class="lb-row">
                <span class="leaderboard-row-main">
          <span class="leaderboard-row-name">${escapeHtml(g.gameName)}</span>
          ${activeHint(g.activeMs, g.totalMs, g.activeFormatted)}
        </span>
        <span class="lb-points">${escapeHtml(g.formatted)}</span>
      </div>`
    )
    .join('');

  container.innerHTML = `
    <div class="grouped-page-sections">
      <section class="card stack grouped-page-section" aria-labelledby="leaderboard-filtered-title">
        <div class="grouped-page-section-title">
          <h2 id="leaderboard-filtered-title">Rangliste &amp; Spielzeit</h2>
          <button type="button" class="btn btn-primary btn-sm" id="add-match-btn">Ergebnis eintragen</button>
        </div>
        <div>
          <label class="field-label" for="lb-filter-search">Spiel auswählen</label>
          ${searchSelectHtml('lb-filter', lbGameOptions, filterGameId, { placeholder: 'Spiel suchen' })}
        </div>
        <div class="stack">
          <section class="tournament-section-panel stack" aria-labelledby="leaderboard-ranking-title">
            <div class="grouped-page-section-title">
              <h2 id="leaderboard-ranking-title">Rangliste</h2>
            </div>
            <div class="leaderboard-list-grid">
              ${standings.length === 0 ? emptyStateHtml('Noch keine Ergebnisse.') : rows}
            </div>
          </section>
          <section class="tournament-section-panel stack" aria-labelledby="leaderboard-playtime-title">
            <div class="grouped-page-section-title">
              <h2 id="leaderboard-playtime-title">Spielzeit</h2>
            </div>
            <div class="leaderboard-list-grid">
              ${playtime.length === 0 ? emptyStateHtml('Noch keine Spielzeit.') : playtimeRows}
            </div>
          </section>
        </div>
      </section>

      <section class="card stack grouped-page-section" aria-labelledby="leaderboard-games-playtime-title">
        <div class="grouped-page-section-title">
          <h2 id="leaderboard-games-playtime-title">Spielzeit pro Spiel</h2>
        </div>
        <div class="leaderboard-list-grid">
          ${playtimeByGame.length === 0 ? emptyStateHtml('Noch keine Spielzeit.') : playtimeByGameRows}
        </div>
      </section>
    </div>
  `;

  wireSearchSelect(container, 'lb-filter', lbGameOptions);
  container.querySelector('#lb-filter').addEventListener('change', async (e) => {
    state.selectedGameId = e.target.value || null;
    const gameId = state.selectedGameId || undefined;
    const playtimeAllGamesPromise = api.stats.playtime();
    const playtimePromise = gameId ? api.stats.playtime(gameId) : playtimeAllGamesPromise;
    [state.leaderboard, state.playtime, state.playtimeAllGames] = await Promise.all([
      api.leaderboard.get(gameId),
      playtimePromise,
      playtimeAllGamesPromise,
    ]);
    ctx.rerender();
  });

  container.querySelector('#add-match-btn').addEventListener('click', () => openMatchForm(ctx));
}
