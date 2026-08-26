import { emptyStateHtml } from './emptyState.js';
import { escapeHtml, avatarHtml } from './format.js';
import { icon } from './icons.js';
import { infoTooltipHtml } from './infoTooltip.js';
import { playerSkillHtml, teamSkillHtml } from './skillDisplay.js';
import { selectActiveLobbyMatches } from './tournamentLobbies.js';

// Presentation functions share one immutable render-state snapshot. Keeping
// bracket/league markup here leaves views/tournament.js responsible for data,
// forms and actions without introducing a framework or another dependency.
export function createTournamentPresentation({ editingResultMatchId }) {
  // ---------- detail: bracket ----------

  function bracketRoundLabel(round, totalRounds) {
    const fromEnd = totalRounds - round;
    if (fromEnd === 0) return 'Finale';
    if (fromEnd === 1) return 'Halbfinale';
    if (fromEnd === 2) return 'Viertelfinale';
    return `Runde ${round}`;
  }

  function teamLabel(teamsById, teamId) {
    const t = teamsById.get(teamId);
    return t ? escapeHtml(t.name) : 'TBD';
  }

  function activeLobbyPhaseLabel(tournament, match) {
    if (tournament.format === 'round_robin') return `Runde ${match.round}`;
    if (tournament.format === 'group_knockout' && match.stage === 'group') {
      return `Gruppe ${(match.groupIndex ?? 0) + 1} · Runde ${match.round}`;
    }

    const knockoutMatches = tournament.matches.filter(
      (candidate) => tournament.format === 'single_elimination' || candidate.stage === 'knockout',
    );
    const totalRounds = Math.max(...knockoutMatches.map((candidate) => candidate.round));
    return bracketRoundLabel(match.round, totalRounds);
  }

  function renderActiveLobbies(tournament) {
    const matches = selectActiveLobbyMatches(tournament);
    if (matches.length === 0) return '';

    const teamsById = new Map(tournament.teams.map((team) => [team.id, team]));
    const cards = matches
      .map((match) => {
        const teamA = teamLabel(teamsById, match.teamAId);
        const teamB = teamLabel(teamsById, match.teamBId);
        return `<section class="card tournament-lobby-info" aria-label="Lobby für ${teamA} gegen ${teamB}">
          <div class="tournament-lobby-header">
            <span class="tournament-lobby-phase">${escapeHtml(activeLobbyPhaseLabel(tournament, match))}</span>
            <span class="badge badge-playing">Eröffnet: ${teamA}</span>
          </div>
          <strong class="tournament-lobby-matchup">${teamA} <span class="muted">vs</span> ${teamB}</strong>
          <div class="tournament-lobby-access">
            ${
              match.lobbyName
                ? `<div class="tournament-lobby-credential">
                     <span>Lobby</span><strong>${escapeHtml(match.lobbyName)}</strong>
                     <button type="button" class="icon-btn tournament-lobby-copy" data-copy-lobby-match="${escapeHtml(match.id)}" data-copy-lobby-kind="name" title="Lobbyname kopieren" aria-label="Lobbyname für ${teamA} gegen ${teamB} kopieren">${icon('copy')}</button>
                   </div>`
                : ''
            }
            ${
              tournament.lobbyPassword
                ? `<div class="tournament-lobby-credential">
                     <span>Passwort</span><strong>${escapeHtml(tournament.lobbyPassword)}</strong>
                     <button type="button" class="icon-btn tournament-lobby-copy" data-copy-lobby-match="${escapeHtml(match.id)}" data-copy-lobby-kind="password" title="Passwort kopieren" aria-label="Passwort für ${teamA} gegen ${teamB} kopieren">${icon('copy')}</button>
                   </div>`
                : ''
            }
          </div>
        </section>`;
      })
      .join('');

    return `<div class="section-title title-with-info">
        <span>Aktive Lobbys</span>
        ${infoTooltipHtml(
          `tournament-lobby-detail-${tournament.id}`,
          'Aktive Lobbys',
          'Jede gleichzeitig spielbare Paarung erhält eine eigene Lobby. Das zuerst genannte Team eröffnet sie.',
        )}
      </div>
      <div class="tournament-active-lobby-grid">${cards}</div>`;
  }

  // A team's score-entry mini-form for round-robin fixtures (the bracket has
  // its own inline variant, see renderBracketMatchBox) — shown instead of the
  // plain winner-pick buttons whenever the tournament tracks a real score, the
  // winner itself is derived server-side from whichever number is higher.
  function renderScoreForm(m, { editing = false } = {}) {
    return `
      <input type="number" min="0" inputmode="numeric" class="tournament-score-input" data-score-a="${m.id}" value="${editing && m.scoreA != null ? m.scoreA : ''}" placeholder="0" />
      <span class="muted">:</span>
      <input type="number" min="0" inputmode="numeric" class="tournament-score-input" data-score-b="${m.id}" value="${editing && m.scoreB != null ? m.scoreB : ''}" placeholder="0" />
      <button type="button" class="btn tournament-score-submit" data-submit-score="${m.id}" ${editing ? 'data-update-result="true"' : ''} aria-label="${editing ? 'Änderung speichern' : 'Ergebnis speichern'}">${icon('check')}</button>`;
  }

  // Must match the CSS custom properties --bracket-match-h / --bracket-pair-gap
  // in style.css exactly — buildBracketNode() below uses these as pure numbers
  // to compute connector-line positions, so a mismatch would make the lines
  // land a few pixels off the boxes they're supposed to connect.
  const BRACKET_MATCH_H = 76;
  const BRACKET_PAIR_GAP = 20;

  // Height a subtree rooted `depth` rounds above a leaf renders at: depth 0 is
  // a single match box, each level up is two of the previous level stacked
  // with one gap between them. Matches how .bracket-node/.bracket-children
  // actually stack in CSS (flex column, no manual sizing) — this is the exact
  // pixel math behind it, not a measurement.
  function bracketSubtreeHeight(depth) {
    return depth === 0 ? BRACKET_MATCH_H : 2 * bracketSubtreeHeight(depth - 1) + BRACKET_PAIR_GAP;
  }

  // One match's contents, fixed at exactly BRACKET_MATCH_H tall regardless of
  // state (bye / TBD / decided / awaiting a score) — see .bracket-match. Score
  // tracking shows the number inline in each team's own row instead of on a
  // separate line below, which is what keeps every box the same height.
  function renderBracketMatchBox(m, t, teamsById) {
    if (m.isBye) {
      return `
        <div class="bracket-match">
          <div class="bracket-team-row is-winner"><span class="bracket-team-name">${teamLabel(teamsById, m.winnerTeamId)}</span></div>
          <div class="bracket-team-row is-tbd"><span class="bracket-team-name">Freilos</span></div>
        </div>`;
    }

    const decided = m.winnerTeamId !== null || m.isDraw;
    const editing = editingResultMatchId === m.id;
    const canRecord = m.teamAId && m.teamBId && ((!decided && t.status === 'active') || (decided && editing));

    const teamRow = (teamId, score) => {
      const isWinner = m.winnerTeamId && m.winnerTeamId === teamId;
      const label = teamId ? teamLabel(teamsById, teamId) : 'TBD';
      const cls = `bracket-team-row${isWinner ? ' is-winner' : ''}${!teamId ? ' is-tbd' : ''}`;
      if (canRecord && t.trackScore) {
        const side = teamId === m.teamAId ? 'a' : 'b';
        const value = editing && score !== null ? ` value="${score}"` : '';
        return `
          <div class="${cls}">
            <span class="bracket-team-name">${label}</span>
            <input type="number" min="0" inputmode="numeric" class="bracket-score-input" data-score-${side}="${m.id}"${value} placeholder="0" />
          </div>`;
      }
      if (canRecord && teamId) {
        return `<button type="button" class="${cls}" data-match="${m.id}" data-winner="${teamId}" ${editing ? 'data-update-result="true"' : ''}><span class="bracket-team-name">${label}</span></button>`;
      }
      const scoreReadout = t.trackScore && score !== null ? `<span class="bracket-score">${score}</span>` : '';
      return `<div class="${cls}"><span class="bracket-team-name">${label}</span>${scoreReadout}</div>`;
    };

    // Floats in the connector gutter to the right of the box (see
    // .bracket-score-submit) instead of taking up a 3rd row — keeps the box
    // itself exactly 2 rows tall even while a score is being entered.
    const submitBtn =
      canRecord && t.trackScore
        ? `<button type="button" class="bracket-score-submit btn" data-submit-score="${m.id}" ${editing ? 'data-update-result="true"' : ''} aria-label="${editing ? 'Änderung speichern' : 'Ergebnis speichern'}">${icon('check')}</button>`
        : '';
    const editBtn =
      decided && !editing
        ? `<button type="button" class="bracket-result-edit btn" data-edit-result="${m.id}" aria-label="Ergebnis bearbeiten">${icon('pencil')}</button>`
        : '';

    const actionClass = submitBtn || editBtn ? ' has-result-action' : '';
    return `<div class="bracket-match${actionClass}">${teamRow(m.teamAId, m.scoreA)}${teamRow(m.teamBId, m.scoreB)}${submitBtn}${editBtn}</div>`;
  }

  // Recursively renders the bracket as nested pairs instead of flat per-round
  // columns: a round-r match's DOM node contains its own two round-(r-1)
  // feeder nodes, so flexbox's align-items:center naturally centers this
  // match against the combined height of its two feeders — exactly, no matter
  // how many rounds deep the tree goes. The connector lines drawn in CSS ride
  // along on top of that same alignment (see .bracket-children::before/::after
  // in style.css), using --conn-half computed here from the fixed match
  // height/gap so they land precisely on both feeders' centers.
  function buildBracketNode(matchesByKey, round, slot, t, teamsById) {
    const m = matchesByKey.get(`${round}:${slot}`);
    const matchHtml = renderBracketMatchBox(m, t, teamsById);
    if (round === 1) {
      return matchHtml;
    }
    const feederDepth = round - 2; // depth (rounds above a leaf) of this node's two children
    const connHalf = bracketSubtreeHeight(feederDepth) / 2;
    const left = buildBracketNode(matchesByKey, round - 1, slot * 2, t, teamsById);
    const right = buildBracketNode(matchesByKey, round - 1, slot * 2 + 1, t, teamsById);
    return `
      <div class="bracket-node">
        <div class="bracket-children" style="--conn-half:${connHalf}px;">
          ${left}
          ${right}
        </div>
        ${matchHtml}
      </div>`;
  }

  // matches defaults to the tournament's full match list (single_elimination),
  // but group_knockout passes just its knockout-stage rows so this can be
  // reused for that sub-bracket once it's been generated.
  function renderBracket(t, matches = t.matches) {
    const teamsById = new Map(t.teams.map((team) => [team.id, team]));
    const totalRounds = Math.max(...matches.map((m) => m.round));
    const matchesByKey = new Map(matches.map((m) => [`${m.round}:${m.slot}`, m]));

    const titles = Array.from(
      { length: totalRounds },
      (_, i) => `<div>${bracketRoundLabel(i + 1, totalRounds)}</div>`,
    ).join('');
    const tree = buildBracketNode(matchesByKey, totalRounds, 0, t, teamsById);

    return `
      <div class="bracket-tree-wrap">
        <div class="bracket-tree-content">
          <div class="bracket-round-titles">${titles}</div>
          ${tree}
        </div>
      </div>`;
  }

  // ---------- detail: round-robin (also reused for each group_knockout group) ----------

  function renderRoundRobinBoard(t, teamsById, matches, standings, { accentRounds = false } = {}) {
    const byRound = new Map();
    for (const m of matches) byRound.set(m.round, [...(byRound.get(m.round) ?? []), m]);

    const fixturesHtml = [...byRound.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([round, roundMatches]) => {
        const rows = roundMatches
          .map((m) => {
            const decided = m.winnerTeamId !== null || m.isDraw;
            const editing = editingResultMatchId === m.id;
            const canRecord = (!decided && t.status === 'active') || (decided && editing);
            const nameA = teamLabel(teamsById, m.teamAId);
            const nameB = teamLabel(teamsById, m.teamBId);
            const aWon = m.winnerTeamId === m.teamAId;
            const bWon = m.winnerTeamId === m.teamBId;
            if (!canRecord) {
              const scoreText = t.trackScore && m.scoreA !== null ? ` (${m.scoreA}:${m.scoreB})` : '';
              const resultText = m.isDraw
                ? `Unentschieden${scoreText}`
                : aWon
                  ? `${nameA} gewinnt${scoreText}`
                  : bWon
                    ? `${nameB} gewinnt${scoreText}`
                    : '–';
              return `
                <div class="lb-row">
                  <span style="flex:1;">${nameA} <span class="muted">vs</span> ${nameB}</span>
                  <span class="muted" style="font-size:var(--font-size-xs);">${resultText}</span>
                  ${decided ? `<button type="button" class="btn tournament-result-edit" data-edit-result="${m.id}" aria-label="Ergebnis bearbeiten">${icon('pencil')}</button>` : ''}
                </div>`;
            }
            if (t.trackScore) {
              return `
                <div class="lb-row" style="flex-wrap:wrap;gap:var(--space-2);">
                  <span style="flex:1 1 100%;">${nameA} <span class="muted">vs</span> ${nameB}</span>
                  ${renderScoreForm(m, { editing })}
                </div>`;
            }
            return `
              <div class="lb-row" style="flex-wrap:wrap;gap:var(--space-2);">
                <span style="flex:1 1 100%;">${nameA} <span class="muted">vs</span> ${nameB}</span>
                <button type="button" class="btn btn-sm" data-match="${m.id}" data-winner="${m.teamAId}" ${editing ? 'data-update-result="true"' : ''}>${nameA}</button>
                <button type="button" class="btn btn-sm" data-match="${m.id}" data-winner="${m.teamBId}" ${editing ? 'data-update-result="true"' : ''}>${nameB}</button>
                <button type="button" class="btn btn-sm" data-match="${m.id}" data-winner="" ${editing ? 'data-update-result="true"' : ''}>Unentschieden</button>
              </div>`;
          })
          .join('');
        return accentRounds
          ? `<section class="tournament-section-panel tournament-round-panel stack">
               <div class="section-title">Runde ${round}</div>
               <div class="card">${rows}</div>
             </section>`
          : `<div class="section-title" style="margin-top:var(--space-4);">Runde ${round}</div><div class="card">${rows}</div>`;
      })
      .join('');

    const standingsRows = (standings || [])
      .map(
        (s, i) => `
        <div class="lb-row ${i === 0 ? 'rank-1' : ''}">
          <span class="lb-rank">${i + 1}</span>
          <span style="flex:1;">${teamLabel(teamsById, s.teamId)}</span>
          <span class="muted" style="font-size:var(--font-size-xs);" title="${s.wins} Siege, ${s.draws} Unentschieden, ${s.losses} Niederlagen">${s.wins}S/${s.draws}U/${s.losses}N</span>
          <span class="lb-points" title="${s.points} Punkte">${s.points} P</span>
        </div>`,
      )
      .join('');

    return `
      <div class="section-title">Tabelle</div>
      <div class="card">${standingsRows}</div>
      ${fixturesHtml}
    `;
  }

  function renderRoundRobin(t) {
    const teamsById = new Map(t.teams.map((team) => [team.id, team]));
    return renderRoundRobinBoard(t, teamsById, t.matches, t.standings, { accentRounds: true });
  }

  // ---------- detail: group stage + knockout ----------

  function renderGroupKnockout(t) {
    const teamsById = new Map(t.teams.map((team) => [team.id, team]));

    const groupBlocks = (t.groups || [])
      .map((g) => {
        const groupMatches = t.matches.filter((m) => m.stage === 'group' && m.groupIndex === g.groupIndex);
        return `
          <section class="tournament-section-panel tournament-group-panel stack" aria-labelledby="tournament-group-${g.groupIndex}">
            <div class="tournament-create-step-title">
              <h3 id="tournament-group-${g.groupIndex}">Gruppe ${g.groupIndex + 1}</h3>
            </div>
            ${renderRoundRobinBoard(t, teamsById, groupMatches, g.standings)}
          </section>`;
      })
      .join('');

    const knockoutMatches = t.matches.filter((m) => m.stage === 'knockout');
    const knockoutHtml =
      knockoutMatches.length === 0
        ? `<section class="tournament-section-panel tournament-group-panel stack">
             <div class="tournament-create-step-title"><h3>K.O.-Runde</h3></div>
             ${emptyStateHtml('Startet automatisch, sobald alle Gruppenspiele entschieden sind.')}
           </section>`
        : `<section class="tournament-section-panel tournament-group-panel stack">
             <div class="tournament-create-step-title"><h3>K.O.-Runde</h3></div>
             ${renderBracket(t, knockoutMatches)}
           </section>`;

    return `<div class="tournament-group-stage">${groupBlocks}${knockoutHtml}</div>`;
  }

  function renderTournamentTeams(t) {
    const cards = t.teams
      .map(
        (team) => `
        <div class="team-card tournament-team-card">
          <div class="team-card-header">
            <span>${escapeHtml(team.name)}</span>
            <span class="row" style="gap:var(--space-2);">
              <span class="muted">${team.players.length} Spieler</span>
              ${teamSkillHtml(team.players, t.gameId)}
            </span>
          </div>
          ${
            team.players.length
              ? team.players
                  .map(
                    (player) => `
                    <div class="team-player">
                      ${avatarHtml(player, 24)}
                      <span class="player-name team-player-name" style="flex:1;">${escapeHtml(player.name)}</span>
                      ${playerSkillHtml(player, t.gameId)}
                    </div>`,
                  )
                  .join('')
              : '<div class="muted">Keine aktiven Spieler</div>'
          }
        </div>`,
      )
      .join('');

    return `<div class="section-title">Teams & Teilnehmer</div><div class="tournament-team-grid">${cards}</div>`;
  }

  return {
    renderActiveLobbies,
    renderBracket,
    renderGroupKnockout,
    renderRoundRobin,
    renderTournamentTeams,
  };
}
