// Leaderboard view (FR-22..25) plus playtime stats (FR-29): overall or
// per-game standings, a form to record a match result, and total playtime
// per player (derived from the agent's start/stop history). Team assignment
// uses one "which team?" selector per player (instead of duplicated
// checkboxes per team column) so a player can never accidentally end up on
// two teams at once.

import { api } from '../api.js';
import { state } from '../state.js';
import { escapeHtml, avatarHtml, gameBadgeHtml } from '../format.js';
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
          ${avatarHtml(player || { color }, 24)}
          <span style="flex:1;">${escapeHtml(name)}</span>
          <span class="muted" style="font-size:0.8rem;" title="${s.wins} Siege von ${s.matchesPlayed} Matches">${s.wins}S / ${s.matchesPlayed}M</span>
          <span class="lb-points" title="${s.points} Punkte">${s.points} P</span>
        </div>`;
    })
    .join('');

  // When filtered to one game, show that game's per-player times (already
  // scoped by the API); otherwise show each player's grand total across all
  // games — either way, the same "totals" list applies since the API scopes
  // it to whatever ?gameId= was requested.
  // activeMs (focused + not idle) is only non-zero for players who opted
  // into activity tracking, so only show the "davon aktiv" hint when there's
  // something meaningful to say — otherwise it'd just be noisy zeros.
  const activeHint = (activeMs, totalMs, activeFormatted) =>
    activeMs > 0 && activeMs < totalMs
      ? `<div class="muted" style="font-size:0.75rem;">davon aktiv gespielt: ${escapeHtml(activeFormatted)}</div>`
      : '';

  const playtime = state.playtime?.totals || [];
  const playtimeRows = playtime
    .map(
      (p) => `
      <div class="lb-row">
        ${avatarHtml(state.players.find((pl) => pl.id === p.playerId) || { color: p.playerColor }, 24)}
        <span style="flex:1;">
          ${escapeHtml(p.playerName)}
          ${activeHint(p.activeMs, p.totalMs, p.activeFormatted)}
        </span>
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
        ${gameBadgeHtml({ id: g.gameId, icon: g.gameIcon }, 24)}
        <span style="flex:1;">
          ${escapeHtml(g.gameName)}
          ${activeHint(g.activeMs, g.totalMs, g.activeFormatted)}
        </span>
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

// Also called from matchmaking.js (with presetGameId/presetTeams) so a
// freshly drawn set of teams can go straight into "Ergebnis eintragen"
// without re-picking every player by hand.
export function openMatchForm(ctx, options = {}) {
  if (state.games.length === 0 || state.players.length === 0) {
    return showToast('Dafür braucht es mindestens ein Spiel und 2 Spieler.', { error: true });
  }

  let teamCount = options.presetTeams ? Math.max(2, options.presetTeams.length) : 2;
  let isFfa = false;
  const defaultGameId = options.presetGameId || state.selectedGameId || state.games[0].id;

  const presetTeamIndexByPlayer = new Map();
  if (options.presetTeams) {
    options.presetTeams.forEach((t, i) => t.playerIds.forEach((pid) => presetTeamIndexByPlayer.set(pid, i)));
  }

  // Free-for-all defaults to whoever is currently shown as playing, same
  // convention as "Teams auslosen" and tournament creation.
  let ffaCheckedIds = new Set(state.live.filter((p) => p.state === 'playing').map((p) => p.player_id));
  if (ffaCheckedIds.size === 0) ffaCheckedIds = new Set(state.players.map((p) => p.id));
  const ffaParticipants = () => state.players.filter((p) => ffaCheckedIds.has(p.id));

  const { close, el } = openModal(
    'Ergebnis eintragen',
    `
      <form id="match-form" class="stack">
        <select id="match-game">
          ${state.games.map((g) => `<option value="${g.id}" ${g.id === defaultGameId ? 'selected' : ''}>${escapeHtml(g.icon)} ${escapeHtml(g.name)}</option>`).join('')}
        </select>
        <label class="check-row">
          <input type="checkbox" id="match-ffa" />
          <span>🎲 Frei-für-alle (kein Team, jeder für sich)</span>
        </label>
        <div id="match-body"></div>
        <button type="submit" class="btn btn-primary btn-block">Speichern</button>
      </form>
    `,
    {
      onMount: (modalEl) => {
        const bodyEl = modalEl.querySelector('#match-body');

        function renderTeamPickers() {
          const teamOptions = (playerId) =>
            Array.from(
              { length: teamCount },
              (_, i) => `<option value="${i}" ${presetTeamIndexByPlayer.get(playerId) === i ? 'selected' : ''}>Team ${i + 1}</option>`
            ).join('');
          const playersHtml = state.players
            .map(
              (p) => `
              <div class="row" style="padding:4px 0;">
                ${avatarHtml(p, 20)}
                <span style="flex:1;">${escapeHtml(p.name)}</span>
                <select data-team-for="${p.id}">
                  <option value="" ${presetTeamIndexByPlayer.has(p.id) ? '' : 'selected'}>–</option>
                  ${teamOptions(p.id)}
                </select>
              </div>`
            )
            .join('');

          bodyEl.innerHTML = `
            <div class="row">
              <span style="flex:1;">Anzahl Teams</span>
              <input type="number" id="match-teamcount" min="2" max="6" value="${teamCount}" style="width:70px;" />
            </div>
            <div class="section-title">Spieler-Zuordnung</div>
            <div id="match-players">${playersHtml}</div>
            <div class="section-title">Gewinner</div>
            <div class="row" style="flex-wrap:wrap;">
              ${Array.from({ length: teamCount }, (_, i) => `<label class="chip"><input type="radio" name="winner" value="${i}" /> Team ${i + 1}</label>`).join('')}
              <label class="chip"><input type="radio" name="winner" value="" checked /> Unentschieden</label>
            </div>
          `;

          bodyEl.querySelector('#match-teamcount').addEventListener('input', (e) => {
            teamCount = Math.min(6, Math.max(2, parseInt(e.target.value, 10) || 2));
            renderTeamPickers();
          });
        }

        function renderFfaWinnerOptions() {
          const winnerEl = bodyEl.querySelector('#match-ffa-winner');
          const participants = ffaParticipants();
          winnerEl.innerHTML = `
            <div class="row" style="flex-wrap:wrap;">
              ${participants.map((p) => `<label class="chip"><input type="radio" name="ffa-winner" value="${p.id}" /> ${escapeHtml(p.name)}</label>`).join('')}
              <label class="chip"><input type="radio" name="ffa-winner" value="" checked /> Kein Sieger</label>
            </div>
          `;
        }

        function renderFfaPickers() {
          bodyEl.innerHTML = `
            <div class="section-title">Teilnehmer</div>
            <div id="match-ffa-players">
              ${state.players
                .map(
                  (p) => `
                <label class="check-row">
                  <input type="checkbox" data-ffa-player="${p.id}" ${ffaCheckedIds.has(p.id) ? 'checked' : ''} />
                  ${avatarHtml(p, 20)}
                  <span style="flex:1;">${escapeHtml(p.name)}</span>
                </label>`
                )
                .join('')}
            </div>
            <div class="section-title">Gewinner</div>
            <div id="match-ffa-winner"></div>
          `;
          renderFfaWinnerOptions();
          bodyEl.querySelectorAll('[data-ffa-player]').forEach((cb) => {
            cb.addEventListener('change', () => {
              if (cb.checked) ffaCheckedIds.add(cb.dataset.ffaPlayer);
              else ffaCheckedIds.delete(cb.dataset.ffaPlayer);
              renderFfaWinnerOptions();
            });
          });
        }

        function renderBody() {
          if (isFfa) renderFfaPickers();
          else renderTeamPickers();
        }

        renderBody();

        modalEl.querySelector('#match-ffa').addEventListener('change', (e) => {
          isFfa = e.target.checked;
          renderBody();
        });

        modalEl.querySelector('#match-form').addEventListener('submit', async (e) => {
          e.preventDefault();
          // An impatient double-tap on "Speichern" (easy on slow party WiFi)
          // would otherwise record the same match twice — there's nothing
          // server-side to dedupe on, identical rematches are legitimate.
          const submitBtn = modalEl.querySelector('#match-form button[type="submit"]');
          if (submitBtn.disabled) return;
          submitBtn.disabled = true;
          const unlock = () => {
            submitBtn.disabled = false;
          };
          const gameId = modalEl.querySelector('#match-game').value;

          if (isFfa) {
            const participants = ffaParticipants();
            if (participants.length < 2) {
              unlock();
              return showToast('Mindestens 2 Teilnehmer auswählen.', { error: true });
            }
            const teams = participants.map((p) => ({ playerIds: [p.id] }));
            const winnerPlayerId = modalEl.querySelector('input[name="ffa-winner"]:checked')?.value || null;
            const winnerTeamIndex = winnerPlayerId ? participants.findIndex((p) => p.id === winnerPlayerId) : null;
            try {
              await api.matches.create({ gameId, teams, winnerTeamIndex });
              close();
              await ctx.refresh();
              showToast('Ergebnis gespeichert.');
            } catch (err) {
              unlock();
              showToast(err.message, { error: true });
            }
            return;
          }

          const teams = Array.from({ length: teamCount }, () => ({ playerIds: [] }));
          modalEl.querySelectorAll('[data-team-for]').forEach((sel) => {
            if (sel.value !== '') teams[parseInt(sel.value, 10)].playerIds.push(sel.dataset.teamFor);
          });
          const nonEmptyTeams = teams.filter((t) => t.playerIds.length > 0);
          if (nonEmptyTeams.length < 2) {
            unlock();
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
              unlock();
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
            unlock();
            showToast(err.message, { error: true });
          }
        });
      },
    }
  );
  void el;
}