// Leaderboard view (FR-22..25) plus playtime stats (FR-29): overall or
// per-game standings, a form to record a match result, and total playtime
// per player (derived from the agent's start/stop history). Team assignment
// uses one "which team?" selector per player (instead of duplicated
// checkboxes per team column) so a player can never accidentally end up on
// two teams at once.

import { api } from '../api.js';
import { state } from '../state.js';
import { escapeHtml, avatarHtml } from '../format.js';
import { openModal } from '../modal.js';
import { showToast } from '../toast.js';
import { icon } from '../icons.js';
import { domainIcon } from '../domainIcons.js';

export function renderLeaderboard(container, ctx) {
  const filterGameId = state.selectedGameId || '';
  const gameOptions = `<option value="">Gesamt</option>${state.games
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
    <div class="row-between">
      <h1 class="view-title">Rang</h1>
      <button type="button" class="btn btn-primary btn-sm" id="add-match-btn">Ergebnis eintragen</button>
    </div>
    <div class="grouped-page-sections">
      <section class="card stack grouped-page-section" aria-labelledby="leaderboard-filtered-title">
        <div class="grouped-page-section-title">
          <h2 id="leaderboard-filtered-title">Rangliste &amp; Spielzeit</h2>
        </div>
        <label>
          <span class="field-label">Spiel auswählen</span>
          <select id="lb-filter">${gameOptions}</select>
        </label>
        <div class="stack">
          <section class="tournament-section-panel stack" aria-labelledby="leaderboard-ranking-title">
            <div class="grouped-page-section-title">
              <h2 id="leaderboard-ranking-title">Rangliste</h2>
            </div>
            <div class="leaderboard-list-grid">
              ${standings.length === 0 ? `<div class="empty-state"><span class="empty-state-icon">${icon(domainIcon('leaderboard'))}</span>Noch keine Ergebnisse.</div>` : rows}
            </div>
          </section>
          <section class="tournament-section-panel stack" aria-labelledby="leaderboard-playtime-title">
            <div class="grouped-page-section-title">
              <h2 id="leaderboard-playtime-title">Spielzeit</h2>
            </div>
            <div class="leaderboard-list-grid">
              ${playtime.length === 0 ? `<div class="empty-state"><span class="empty-state-icon">${icon('timer')}</span>Noch keine erfasste Spielzeit.</div>` : playtimeRows}
            </div>
          </section>
        </div>
      </section>

      <section class="card stack grouped-page-section" aria-labelledby="leaderboard-games-playtime-title">
        <div class="grouped-page-section-title">
          <h2 id="leaderboard-games-playtime-title">Spielzeit pro Spiel</h2>
        </div>
        <div class="leaderboard-list-grid">
          ${playtimeByGame.length === 0 ? `<div class="empty-state"><span class="empty-state-icon">${icon('timer')}</span>Noch keine erfasste Spielzeit.</div>` : playtimeByGameRows}
        </div>
      </section>
    </div>
  `;

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

// Also called from matchmaking.js (with presetGameId/presetTeams) so a
// freshly drawn set of teams can go straight into "Ergebnis eintragen"
// without re-picking every player by hand. presetDrawId additionally links
// the saved match back to that matchmaking_draws row and updates its actions
// in the shared Historie.
export function openMatchForm(ctx, options = {}) {
  if (state.games.length === 0 || state.players.length === 0) {
    return showToast('Dafür braucht es mindestens ein Spiel und 2 Spieler.', { error: true });
  }

  let teamCount = options.presetTeams ? Math.max(2, options.presetTeams.length) : 2;
  let isFfa = false;
  // Off by default: pick-a-winner covers the common case in one tap. Toggling
  // this in swaps the winner radios for a score/Platz input per team (or per
  // player in FFA) — the winner is then derived from those instead of asked
  // for separately, so there's no way for the two to disagree.
  let advancedMode = false;
  const defaultGameId = options.presetGameId || state.selectedGameId || state.games[0].id;

  const presetTeamIndexByPlayer = new Map();
  if (options.presetTeams) {
    options.presetTeams.forEach((t, i) => t.playerIds.forEach((pid) => presetTeamIndexByPlayer.set(pid, i)));
  }

  // Free-for-all defaults to the drawn lineup's players when entering a
  // result for a specific draw (so switching to "Frei-für-alle" there keeps
  // the same participants instead of silently swapping in "whoever is
  // playing now"), otherwise whoever is currently shown as playing, same
  // convention as "Teams auslosen" and tournament creation.
  let ffaCheckedIds = options.presetTeams
    ? new Set(options.presetTeams.flatMap((t) => t.playerIds))
    : new Set(state.live.filter((p) => p.state === 'playing').map((p) => p.player_id));
  if (ffaCheckedIds.size === 0) ffaCheckedIds = new Set(state.players.map((p) => p.id));
  const ffaParticipants = () => state.players.filter((p) => ffaCheckedIds.has(p.id));

  // Advanced mode has no explicit winner radio — derive it instead: rank 1
  // wins if exactly one entry has it, otherwise the strictly-highest score
  // wins if there is one. Anything ambiguous (no ranks/scores entered, a tie)
  // just leaves winnerTeamIndex null (Unentschieden), same as picking no
  // winner manually.
  function deriveWinnerIndex(entries) {
    const rankOnes = entries.filter((e) => e.rank === 1);
    if (rankOnes.length === 1) return entries.indexOf(rankOnes[0]);
    const scored = entries.filter((e) => typeof e.score === 'number');
    if (scored.length > 0) {
      const max = Math.max(...scored.map((e) => e.score));
      const maxEntries = scored.filter((e) => e.score === max);
      if (maxEntries.length === 1) return entries.indexOf(maxEntries[0]);
    }
    return null;
  }

  const { close, el } = openModal(
    'Ergebnis eintragen',
    `
      <form id="match-form" class="stack">
        <section class="tournament-section-panel stack match-form-section" aria-labelledby="match-mode-title">
          <div class="grouped-page-section-title">
            <h2 id="match-mode-title">Modus</h2>
          </div>
          <label>
            <span class="field-label">Spiel</span>
            <select id="match-game">
              ${state.games.map((g) => `<option value="${g.id}" ${g.id === defaultGameId ? 'selected' : ''}>${escapeHtml(g.icon)} ${escapeHtml(g.name)}</option>`).join('')}
            </select>
          </label>
          <div>
            <label class="check-row">
              <input type="checkbox" id="match-ffa" />
              <span>Frei-für-alle</span>
            </label>
            <label class="check-row">
              <input type="checkbox" id="match-advanced" />
              <span>Werte / Platzierung eintragen</span>
            </label>
          </div>
        </section>
        <div id="match-body"></div>
        <button type="submit" class="btn btn-primary btn-block">Speichern</button>
      </form>
    `,
    {
      confirmClose: () => {
        if (!el) return null;
        const hasValue = (selector) => [...el.querySelectorAll(selector)].some((input) => input.value.trim() !== '');
        const winnerPicked = [...el.querySelectorAll('input[name="winner"], input[name="ffa-winner"]')].some(
          (input) => input.checked && input.value !== '',
        );
        const dirty =
          winnerPicked ||
          hasValue('[data-team-score]') ||
          hasValue('[data-team-rank]') ||
          hasValue('[data-ffa-score]') ||
          hasValue('[data-ffa-rank]');
        return dirty ? 'Das eingetragene Ergebnis inklusive Sieger, Werten und Platzierungen geht verloren.' : null;
      },
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
              <div class="player-assignment-row" style="padding:var(--space-1) 0;">
                ${avatarHtml(p, 20)}
                <span class="player-name leaderboard-row-name">${escapeHtml(p.name)}</span>
                <select data-team-for="${p.id}" aria-label="Team für ${escapeHtml(p.name)}">
                  <option value="" ${presetTeamIndexByPlayer.has(p.id) ? '' : 'selected'}>–</option>
                  ${teamOptions(p.id)}
                </select>
              </div>`
            )
            .join('');

          bodyEl.innerHTML = `
            <div class="stack">
              <section class="tournament-section-panel stack match-form-section" aria-labelledby="match-assignment-title">
                <div class="grouped-page-section-title">
                  <h2 id="match-assignment-title">Spieler-Zuordnung</h2>
                </div>
                <label class="match-team-count-field">
                  <span class="field-label">Anzahl Teams</span>
                  <input type="number" id="match-teamcount" min="2" max="6" value="${teamCount}" />
                </label>
                <div id="match-players">${playersHtml}</div>
              </section>
              <section class="tournament-section-panel stack match-form-section" aria-labelledby="match-result-title">
                <div class="grouped-page-section-title">
                  <h2 id="match-result-title">Ergebnis</h2>
                </div>
                <div id="match-winner-section" ${advancedMode ? 'hidden' : ''}>
                  <div class="row" style="flex-wrap:wrap;">
                    ${Array.from({ length: teamCount }, (_, i) => `<label class="chip"><input type="radio" name="winner" value="${i}" /> Team ${i + 1}</label>`).join('')}
                    <label class="chip"><input type="radio" name="winner" value="" checked /> Unentschieden</label>
                  </div>
                </div>
                <div id="match-scores-section" class="stack" ${advancedMode ? '' : 'hidden'}>
                  <p class="muted match-result-help">
                    Sieger wird automatisch aus Platz 1 bzw. dem höchsten Wert bestimmt. Beides ist optional
                    und unabhängig voneinander — leer lassen, was nicht zutrifft.
                  </p>
                  ${Array.from(
                    { length: teamCount },
                    (_, i) => `
                    <div class="match-result-row">
                      <span>Team ${i + 1}</span>
                      <input type="number" data-team-score="${i}" aria-label="Wert für Team ${i + 1}" placeholder="Wert" step="any" />
                      <input type="number" data-team-rank="${i}" aria-label="Platz für Team ${i + 1}" placeholder="Platz" min="1" />
                    </div>`
                  ).join('')}
                </div>
              </section>
            </div>
          `;

          bodyEl.querySelector('#match-teamcount').addEventListener('input', (e) => {
            // Capture whatever the user already picked before re-rendering,
            // so changing "Anzahl Teams" doesn't quietly revert a manual
            // team reassignment (or removal, via "–") made just before it.
            bodyEl.querySelectorAll('[data-team-for]').forEach((sel) => {
              if (sel.value === '') presetTeamIndexByPlayer.delete(sel.dataset.teamFor);
              else presetTeamIndexByPlayer.set(sel.dataset.teamFor, parseInt(sel.value, 10));
            });
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

        function renderFfaScoreOptions() {
          const scoresEl = bodyEl.querySelector('#match-ffa-scores');
          const participants = ffaParticipants();
          scoresEl.innerHTML = participants
            .map(
              (p) => `
              <div class="match-result-row">
                <span class="player-name leaderboard-row-name">${escapeHtml(p.name)}</span>
                <input type="number" data-ffa-score="${p.id}" aria-label="Wert für ${escapeHtml(p.name)}" placeholder="Wert" step="any" />
                <input type="number" data-ffa-rank="${p.id}" aria-label="Platz für ${escapeHtml(p.name)}" placeholder="Platz" min="1" />
              </div>`
            )
            .join('');
        }

        function renderFfaPickers() {
          bodyEl.innerHTML = `
            <div class="stack">
              <section class="tournament-section-panel stack match-form-section" aria-labelledby="match-participants-title">
                <div class="grouped-page-section-title">
                  <h2 id="match-participants-title">Teilnehmende</h2>
                </div>
                <div id="match-ffa-players">
                  ${state.players
                    .map(
                      (p) => `
                    <label class="check-row">
                      <input type="checkbox" data-ffa-player="${p.id}" ${ffaCheckedIds.has(p.id) ? 'checked' : ''} />
                      ${avatarHtml(p, 20)}
                      <span class="player-name leaderboard-row-name">${escapeHtml(p.name)}</span>
                    </label>`
                    )
                    .join('')}
                </div>
              </section>
              <section class="tournament-section-panel stack match-form-section" aria-labelledby="match-result-title">
                <div class="grouped-page-section-title">
                  <h2 id="match-result-title">Ergebnis</h2>
                </div>
                <div id="match-ffa-winner-section" ${advancedMode ? 'hidden' : ''}>
                  <div id="match-ffa-winner"></div>
                </div>
                <div id="match-ffa-scores-section" class="stack" ${advancedMode ? '' : 'hidden'}>
                  <p class="muted match-result-help">
                    Sieger wird automatisch aus Platz 1 bzw. dem höchsten Wert bestimmt. Beides ist optional
                    und unabhängig voneinander — leer lassen, was nicht zutrifft.
                  </p>
                  <div id="match-ffa-scores"></div>
                </div>
              </section>
            </div>
          `;
          renderFfaWinnerOptions();
          renderFfaScoreOptions();
          bodyEl.querySelectorAll('[data-ffa-player]').forEach((cb) => {
            cb.addEventListener('change', () => {
              if (cb.checked) ffaCheckedIds.add(cb.dataset.ffaPlayer);
              else ffaCheckedIds.delete(cb.dataset.ffaPlayer);
              renderFfaWinnerOptions();
              renderFfaScoreOptions();
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

        // Just flips which section is visible — never re-renders the body,
        // so toggling this doesn't discard team assignments / checked
        // participants the user already made.
        modalEl.querySelector('#match-advanced').addEventListener('change', (e) => {
          advancedMode = e.target.checked;
          bodyEl.querySelector('#match-winner-section')?.toggleAttribute('hidden', advancedMode);
          bodyEl.querySelector('#match-scores-section')?.toggleAttribute('hidden', !advancedMode);
          bodyEl.querySelector('#match-ffa-winner-section')?.toggleAttribute('hidden', advancedMode);
          bodyEl.querySelector('#match-ffa-scores-section')?.toggleAttribute('hidden', !advancedMode);
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

            let winnerTeamIndex;
            if (advancedMode) {
              teams.forEach((t, i) => {
                const playerId = participants[i].id;
                const scoreRaw = modalEl.querySelector(`[data-ffa-score="${playerId}"]`)?.value;
                const rankRaw = modalEl.querySelector(`[data-ffa-rank="${playerId}"]`)?.value;
                t.score = scoreRaw ? parseFloat(scoreRaw) : null;
                t.rank = rankRaw ? parseInt(rankRaw, 10) : null;
              });
              winnerTeamIndex = deriveWinnerIndex(teams);
            } else {
              const winnerPlayerId = modalEl.querySelector('input[name="ffa-winner"]:checked')?.value || null;
              winnerTeamIndex = winnerPlayerId ? participants.findIndex((p) => p.id === winnerPlayerId) : null;
            }

            try {
              await api.matches.create({
                gameId,
                teams,
                winnerTeamIndex,
                ...(options.presetDrawId ? { drawId: options.presetDrawId } : {}),
              });
              // Same as the team-mode branch below: don't wait for the
              // matchmaking:draws-changed round trip to hide the "gerade
              // ausgelost" panel the submitter is looking at.
              if (options.presetDrawId && state.lastMatchmaking?.id === options.presetDrawId) {
                state.lastMatchmaking = null;
              }
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
          if (advancedMode) {
            teams.forEach((t, i) => {
              const scoreRaw = modalEl.querySelector(`[data-team-score="${i}"]`)?.value;
              const rankRaw = modalEl.querySelector(`[data-team-rank="${i}"]`)?.value;
              t.score = scoreRaw ? parseFloat(scoreRaw) : null;
              t.rank = rankRaw ? parseInt(rankRaw, 10) : null;
            });
          }
          const nonEmptyTeams = teams.filter((t) => t.playerIds.length > 0);
          if (nonEmptyTeams.length < 2) {
            unlock();
            return showToast('Mindestens 2 Teams müssen Spieler enthalten.', { error: true });
          }

          let winnerTeamIndex = null;
          if (advancedMode) {
            winnerTeamIndex = deriveWinnerIndex(nonEmptyTeams);
          } else {
            const winnerRaw = modalEl.querySelector('input[name="winner"]:checked')?.value;
            // Map the winner radio's index (over the full team slots,
            // including any empty ones) onto its position in the filtered
            // non-empty list actually sent to the API.
            if (winnerRaw !== '' && winnerRaw !== undefined) {
              const winnerTeam = teams[parseInt(winnerRaw, 10)];
              const idx = nonEmptyTeams.indexOf(winnerTeam);
              if (idx === -1) {
                unlock();
                return showToast('Das Gewinner-Team hat keine Spieler zugeordnet.', { error: true });
              }
              winnerTeamIndex = idx;
            }
          }

          try {
            await api.matches.create({
              gameId,
              teams: nonEmptyTeams,
              winnerTeamIndex,
              ...(options.presetDrawId ? { drawId: options.presetDrawId } : {}),
            });
            // The recorded draw disappears from the "gerade ausgelost"
            // panel and becomes a result inside Historie — don't wait for
            // the matchmaking:draws-changed socket
            // round trip to hide the panel the submitter is looking at.
            if (options.presetDrawId && state.lastMatchmaking?.id === options.presetDrawId) {
              state.lastMatchmaking = null;
            }
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
