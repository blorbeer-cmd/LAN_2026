// Leaderboard view (FR-22..25): overall or per-game standings and the entry
// point for recording a match result. Play time lives in Statistiken.

import { api } from '../api.js';
import { state, gamesWithHistory } from '../state.js';
import { escapeHtml, avatarHtml } from '../format.js';
import { searchSelectHtml, wireSearchSelect } from '../searchSelect.js';
import { emptyStateHtml } from '../emptyState.js';
import { rankedListHtml, sharedRankNumbers } from '../rankedList.js';
import { openMatchForm } from './adminResultForm.js';

export function renderLeaderboard(container, ctx) {
  const filterGameId = state.selectedGameId || '';
  // Accepted games only — plus any game that already carries results, so a
  // game moved back to the suggestions after it was played keeps its own
  // ranking reachable instead of silently dropping out of the filter.
  const lbGameOptions = [
    { value: '', label: 'Alle Spiele' },
    ...gamesWithHistory().map((g) => ({ value: g.id, label: g.name })),
  ];

  const standings = state.leaderboard?.standings || [];
  const ranks = sharedRankNumbers(standings.map((s) => s.points));
  const standingItems = standings.map((s, i) => {
    const player = state.players.find((p) => p.id === s.playerId);
    return {
      rank: ranks[i],
      lead: avatarHtml(player || { color: s.color }, 28),
      title: escapeHtml(player ? player.name : s.name),
      meta: `${s.wins} ${s.wins === 1 ? 'Sieg' : 'Siege'} · ${s.matchesPlayed} ${s.matchesPlayed === 1 ? 'Spiel' : 'Spiele'}`,
      value: `${s.points} P`,
    };
  });

  // The page's only card, so it stays open instead of collapsing.
  container.innerHTML = `
    <div class="grouped-page-sections">
      <section class="card stack grouped-page-section" aria-labelledby="leaderboard-ranking-title">
        <div class="grouped-page-section-title">
          <h2 id="leaderboard-ranking-title">Rangliste</h2>
          <button type="button" class="btn btn-primary btn-sm" id="add-match-btn">Ergebnis eintragen</button>
        </div>
        ${searchSelectHtml('lb-filter', lbGameOptions, filterGameId, { placeholder: 'Spiel suchen', ariaLabel: 'Spiel' })}
        ${standingItems.length === 0
          ? emptyStateHtml('Noch keine Ergebnisse', { className: 'empty-state-compact' })
          : rankedListHtml(standingItems, { ranked: true, label: 'Rangliste' })}
      </section>
    </div>
  `;

  wireSearchSelect(container, 'lb-filter', lbGameOptions);
  container.querySelector('#lb-filter').addEventListener('change', async (e) => {
    state.selectedGameId = e.target.value || null;
    state.leaderboard = await api.leaderboard.get(state.selectedGameId || undefined);
    ctx.rerender();
  });

  container.querySelector('#add-match-btn').addEventListener('click', () => openMatchForm(ctx));
}
