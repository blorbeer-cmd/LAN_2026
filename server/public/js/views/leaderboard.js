// Leaderboard view (FR-22..25) plus playtime stats (FR-29): overall or
// per-game standings, a form to record a match result, and total playtime
// per player (derived from the agent's start/stop history). Team assignment
// uses one "which team?" selector per player (instead of duplicated
// checkboxes per team column) so a player can never accidentally end up on
// two teams at once.

import { api } from '../api.js';
import { state } from '../state.js';
import { escapeHtml } from '../format.js';
import { openModal } from '../modal.js';
import { showToast } from '../toast.js';

export function renderLeaderboard(container, ctx) {
  const filterGameId = state.selectedGameId || '';
  const gameOptions = `<option value="">🏆 Gesamt</option>${state.games
    .map((g) => `<option value="${g.id}" ${g.id === filterGameId ? 'selected' : ''}>${escapeHtml(g.icon)} ${escapeHtml(g.name)}</option>`)
    .join('')}`;

  const standings = state.leaderboard?.standings || [];
  const rows = standings
    .map((s, i) => {
      const player = state.players.find((p) => p.id === s.playerId);
      const name = player ? player.name : s.name;
      const color = player ? player.color : s.color;
      return `
        <div class="lb-row ${i === 0 ? 'rank-1' : ''}">
          <span class="lb-rank">${i + 1}</span>
          <span class="avatar-dot" style="background:${escapeHtml(color)}"></span>
          <span style="flex:1;">${escapeHtml(name)}</span>
          <span class="muted" style="font-size:0.8rem;">${s.wins}S / ${s.matchesPlayed}M</span>
          <span class="lb-points">${s.points} P</span>
        </div>`;
    })
    .join('');

  // When filtered to one game, show that game's per-player times (already
  // scoped by the API); otherwise show each player's grand total across all
  // games — either way, the same "totals" list applies since the API scopes
  // it to whatever ?gameId= was requested.
  const playtime = state.playtime?.totals || [];
  const playtimeRows = playtime
    .map(
      (p) => `
      <div class="lb-row">
        <span class="avatar-dot" style="background:${escapeHtml(p.playerColor)}"></span>
        <span style="flex:1;">${escapeHtml(p.playerName)}</span>
        <span class="lb-points">${escapeHtml(p.formatted)}</span>
      </div>`
    )
    .join('');

  // "How long did this game run at the party in total" — summed across
  // everyone, as opposed to the per-player breakdown above.
  const playtimeByGame = state.playtime?.totalsByGame || [];
  const playtimeByGameRows = playtimeByGame
    .map(
      (g) => `
      <div class="lb-row">
        <span>${escapeHtml(g.gameIcon)}</span>
        <span style="flex:1;">${escapeHtml(g.gameName)}</span>
        <span class="lb-points">${escapeHtml(g.formatted)}</span>
      </div>`
    )
    .join('');

  container.innerHTML = `
    <div class="row-between">
      <h1 class="view-title">Rangliste</h1>
      <button type="button" class="btn btn-primary btn-sm" id="add-match-btn">+ Ergebnis</button>
    </div>
    <select id="lb-filter" style="margin-bottom:12px;">${gameOptions}</select>
    <div class="card">
      ${standings.length === 0 ? `<div class="empty-state"><span class="emoji">🏆</span>Noch keine Ergebnisse.</div>` : rows}
    </div>

    <div class="section-title">⏱️ Spielzeit</div>
    <div class="card">
      ${playtime.length === 0 ? `<div class="empty-state" style="padding:20px;"><span class="emoji">⏱️</span>Noch keine erfasste Spielzeit.</div>` : playtimeRows}
    </div>

    <div class="section-title">🕒 Spielzeit pro Spiel (alle zusammen)</div>
    <div class="card">
      ${playtimeByGame.length === 0 ? `<div class="empty-state" style="padding:20px;"><span class="emoji">🕒</span>Noch keine erfasste Spielzeit.</div>` : playtimeByGameRows}
    </div>
  `;

  container.querySelector('#lb-filter').addEventListener('change', async (e) => {
    state.selectedGameId = e.target.value || null;
    const gameId = state.selectedGameId || undefined;
    [state.leaderboard, state.playtime] = await Promise.all([
      api.leaderboard.get(gameId),
      api.stats.playtime(gameId),
    ]);
    ctx.rerender();
  });

  container.querySelector('#add-match-btn').addEventListener('click', () => openMatchForm(ctx));
}

function openMatchForm(ctx) {
  if (state.games.length === 0 || state.players.length === 0) {
    return showToast('Dafür braucht es mindestens ein Spiel und 2 Spieler.', { error: true });
  }

  let teamCount = 2;
  const defaultGameId = state.selectedGameId || state.games[0].id;

  const { close, el } = openModal(
    'Ergebnis eintragen',
    `
      <form id="match-form" class="stack">
        <select id="match-game">
          ${state.games.map((g) => `<option value="${g.id}" ${g.id === defaultGameId ? 'selected' : ''}>${escapeHtml(g.icon)} ${escapeHtml(g.name)}</option>`).join('')}
        </select>
        <div class="row">
          <span style="flex:1;">Anzahl Teams</span>
          <input type="number" id="match-teamcount" min="2" max="6" value="2" style="width:70px;" />
        </div>
        <div class="section-title">Spieler-Zuordnung</div>
        <div id="match-players"></div>
        <div class="section-title">Gewinner</div>
        <div id="match-winner"></div>
        <button type="submit" class="btn btn-primary btn-block">Speichern</button>
      </form>
    `,
    {
      onMount: (modalEl) => {
        function renderTeamPickers() {
          const playersEl = modalEl.querySelector('#match-players');
          const teamOptions = Array.from({ length: teamCount }, (_, i) => `<option value="${i}">Team ${i + 1}</option>`).join('');
          playersEl.innerHTML = state.players
            .map(
              (p) => `
              <div class="row" style="padding:4px 0;">
                <span class="avatar-dot" style="background:${escapeHtml(p.color)}"></span>
                <span style="flex:1;">${escapeHtml(p.name)}</span>
                <select data-team-for="${p.id}">
                  <option value="">–</option>
                  ${teamOptions}
                </select>
              </div>`
            )
            .join('');

          const winnerEl = modalEl.querySelector('#match-winner');
          winnerEl.innerHTML = `
            <div class="row" style="flex-wrap:wrap;">
              ${Array.from({ length: teamCount }, (_, i) => `
                <label class="chip"><input type="radio" name="winner" value="${i}" /> Team ${i + 1}</label>
              `).join('')}
              <label class="chip"><input type="radio" name="winner" value="" checked /> Unentschieden</label>
            </div>
          `;
        }

        renderTeamPickers();

        modalEl.querySelector('#match-teamcount').addEventListener('input', (e) => {
          teamCount = Math.min(6, Math.max(2, parseInt(e.target.value, 10) || 2));
          renderTeamPickers();
        });

        modalEl.querySelector('#match-form').addEventListener('submit', async (e) => {
          e.preventDefault();
          const gameId = modalEl.querySelector('#match-game').value;
          const teams = Array.from({ length: teamCount }, () => ({ playerIds: [] }));
          modalEl.querySelectorAll('[data-team-for]').forEach((sel) => {
            if (sel.value !== '') teams[parseInt(sel.value, 10)].playerIds.push(sel.dataset.teamFor);
          });
          const nonEmptyTeams = teams.filter((t) => t.playerIds.length > 0);
          if (nonEmptyTeams.length < 2) {
            return showToast('Mindestens 2 Teams müssen Spieler enthalten.', { error: true });
          }
          const winnerRaw = modalEl.querySelector('input[name="winner"]:checked')?.value;
          // Map the winner radio's index (over the full team slots, including
          // any empty ones) onto its position in the filtered non-empty list
          // actually sent to the API.
          let winnerTeamIndex = null;
          if (winnerRaw !== '' && winnerRaw !== undefined) {
            const winnerTeam = teams[parseInt(winnerRaw, 10)];
            const idx = nonEmptyTeams.indexOf(winnerTeam);
            if (idx === -1) {
              return showToast('Das Gewinner-Team hat keine Spieler zugeordnet.', { error: true });
            }
            winnerTeamIndex = idx;
          }

          try {
            await api.matches.create({ gameId, teams: nonEmptyTeams, winnerTeamIndex });
            close();
            await ctx.refresh();
            showToast('Ergebnis gespeichert.');
          } catch (err) {
            showToast(err.message, { error: true });
          }
        });
      },
    }
  );
  void el;
}