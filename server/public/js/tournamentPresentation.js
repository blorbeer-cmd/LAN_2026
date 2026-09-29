import { emptyStateHtml } from './emptyState.js';
import { escapeHtml, avatarHtml } from './format.js';
import { icon } from './icons.js';
import { playerSkillHtml, teamSkillHtml } from './skillDisplay.js';
import { selectActiveLobbyMatches } from './tournamentLobbies.js';

// Presentation functions share one immutable render-state snapshot. Keeping
// bracket/league markup here leaves views/tournament.js responsible for data,
// forms and actions without introducing a framework or another dependency.
export function createTournamentPresentation(myPlayerId = null) {
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

  // The signed-in player's team, so every board can mark where they play. The
  // marking itself is a thin accent edge; the hidden text carries the same
  // meaning for screen readers, so it never relies on colour alone. It sits
  // beside the name element, never inside it, so a name stays just the name.
  function myTeamIdOf(tournament) {
    if (!myPlayerId) return null;
    return tournament.teams.find((team) => team.players.some((player) => player.id === myPlayerId))?.id ?? null;
  }

  const MY_TEAM_HINT = '<span class="visually-hidden"> (dein Team)</span>';
  const isMyMatch = (match, myTeamId) => Boolean(myTeamId) && (match.teamAId === myTeamId || match.teamBId === myTeamId);

  function activeLobbyPhaseLabel(tournament, match) {
    if (tournament.format === 'round_robin') return `Runde ${match.round}`;
    if (tournament.format === 'group_knockout' && match.stage === 'group') {
      return `Gruppe ${(match.groupIndex ?? 0) + 1} · Runde ${match.round}`;
    }

    const knockoutMatches = tournament.matches.filter(
      (candidate) => tournament.format === 'single_elimination' || candidate.stage === 'knockout',
    );
    const totalRounds = Math.max(...knockoutMatches.map((candidate) => candidate.round));
    return match.isThirdPlace ? 'Spiel um Platz 3' : bracketRoundLabel(match.round, totalRounds);
  }

  function renderActiveLobbies(tournament) {
    const matches = selectActiveLobbyMatches(tournament);
    if (matches.length === 0) return '';

    const teamsById = new Map(tournament.teams.map((team) => [team.id, team]));
    const myTeamId = myTeamIdOf(tournament);
    // The own lobby leads the list; the others keep their schedule order.
    const ordered = [...matches.filter((m) => isMyMatch(m, myTeamId)), ...matches.filter((m) => !isMyMatch(m, myTeamId))];
    const credential = (label, value, match, kind, teamA, teamB) => `
      <span class="tournament-lobby-credential">
        <span class="tournament-lobby-credential-label">${label}</span>
        <code class="tournament-lobby-credential-value">${escapeHtml(value)}</code>
        <button type="button" class="icon-btn tournament-lobby-copy" data-copy-lobby-match="${escapeHtml(match.id)}" data-copy-lobby-kind="${kind}" title="${label === 'Lobby' ? 'Lobbyname' : 'Passwort'} kopieren" aria-label="${label === 'Lobby' ? 'Lobbyname' : 'Passwort'} für ${teamA} gegen ${teamB} kopieren">${icon('copy')}</button>
      </span>`;
    const rows = ordered
      .map((match) => {
        const teamA = teamLabel(teamsById, match.teamAId);
        const teamB = teamLabel(teamsById, match.teamBId);
        const mine = isMyMatch(match, myTeamId);
        // The row is a generic container, so its aria-label is not reliably
        // announced; the own-lobby hint therefore is real (hidden) text.
        return `<div class="tournament-lobby-row${mine ? ' is-mine' : ''}" aria-label="Lobby für ${teamA} gegen ${teamB}">
          <div class="tournament-lobby-matchup">
            ${mine ? '<span class="visually-hidden">Deine Lobby: </span>' : ''}
            <strong>${teamA} <span class="muted">vs</span> ${teamB}</strong>
            <span class="muted">${escapeHtml(activeLobbyPhaseLabel(tournament, match))} · ${teamA} eröffnet</span>
          </div>
          <div class="tournament-lobby-access">
            ${match.lobbyName ? credential('Lobby', match.lobbyName, match, 'name', teamA, teamB) : ''}
            ${tournament.lobbyPassword ? credential('Passwort', tournament.lobbyPassword, match, 'password', teamA, teamB) : ''}
          </div>
        </div>`;
      })
      .join('');

    return `<section class="card stack grouped-page-section" aria-labelledby="tournament-lobbies-title">
      <div class="grouped-page-section-title"><h2 id="tournament-lobbies-title">Aktive Lobbys</h2></div>
      <div class="tournament-lobby-list">${rows}</div>
    </section>`;
  }

  // Every result is entered and edited through one dialog (see
  // openResultDialog in views/tournament.js), so boards stay read-only and the
  // action always sits in the same trailing slot: "+" for an open match,
  // a pencil for a decided one.
  function canOpenResult(m, t) {
    if (!m.teamAId || !m.teamBId || m.isBye) return false;
    const decided = m.winnerTeamId !== null || m.isDraw;
    return decided || t.status === 'active';
  }

  function resultActionHtml(m, t, className) {
    if (!canOpenResult(m, t)) return `<span class="${className}" aria-hidden="true"></span>`;
    const decided = m.winnerTeamId !== null || m.isDraw;
    const label = decided ? 'Ergebnis bearbeiten' : 'Ergebnis eintragen';
    return `<button type="button" class="${className}${decided ? '' : ' is-open'}" data-open-result="${m.id}" aria-label="${label}" title="${label}">${icon(decided ? 'pencil' : 'plus')}</button>`;
  }

  // Must match the CSS custom properties --bracket-match-h / --bracket-pair-gap
  // in domains.css exactly — buildBracketNode() below uses these as pure numbers
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

  // One match box, fixed at exactly BRACKET_MATCH_H tall regardless of state:
  // two team rows plus a trailing action column inside the box, so the action
  // never floats over the connector lines.
  function renderBracketMatchBox(m, t, teamsById, myTeamId) {
    const mine = (teamId) => Boolean(teamId) && teamId === myTeamId;
    const teamContent = (teamId) => `<span class="bracket-team-name">${teamLabel(teamsById, teamId)}</span>${mine(teamId) ? MY_TEAM_HINT : ''}`;
    if (m.isBye) {
      return `
        <div class="bracket-match is-bye">
          <div class="bracket-rows">
            <div class="bracket-team-row is-winner${mine(m.winnerTeamId) ? ' is-mine' : ''}">${teamContent(m.winnerTeamId)}</div>
            <div class="bracket-team-row is-tbd"><span class="bracket-team-name">Freilos</span></div>
          </div>
          <span class="bracket-side" aria-hidden="true"></span>
        </div>`;
    }

    const decided = m.winnerTeamId !== null || m.isDraw;
    const teamRow = (teamId, score) => {
      const isWinner = m.winnerTeamId && m.winnerTeamId === teamId;
      const cls = `bracket-team-row${isWinner ? ' is-winner' : ''}${decided && !isWinner ? ' is-loser' : ''}${!teamId ? ' is-tbd' : ''}${mine(teamId) ? ' is-mine' : ''}`;
      const scoreReadout = t.trackScore && score !== null ? `<span class="bracket-score">${score}</span>` : '';
      const winMark = !t.trackScore && isWinner ? `<span class="bracket-win-mark" aria-label="Sieger">${icon('check')}</span>` : '';
      return `<div class="${cls}">${teamId ? teamContent(teamId) : '<span class="bracket-team-name">offen</span>'}${scoreReadout}${winMark}</div>`;
    };

    return `<div class="bracket-match${decided ? '' : ' is-open'}">
      <div class="bracket-rows">${teamRow(m.teamAId, m.scoreA)}${teamRow(m.teamBId, m.scoreB)}</div>
      ${resultActionHtml(m, t, 'bracket-side')}
    </div>`;
  }

  // Recursively renders the bracket as nested pairs instead of flat per-round
  // columns: a round-r match's DOM node contains its own two round-(r-1)
  // feeder nodes, so flexbox's align-items:center naturally centers this
  // match against the combined height of its two feeders — exactly, no matter
  // how many rounds deep the tree goes. The connector lines drawn in CSS ride
  // along on top of that same alignment (see .bracket-children::before/::after
  // in domains.css), using --conn-half computed here from the fixed match
  // height/gap so they land precisely on both feeders' centers.
  function buildBracketNode(matchesByKey, round, slot, t, teamsById, myTeamId) {
    const m = matchesByKey.get(`${round}:${slot}`);
    const matchHtml = renderBracketMatchBox(m, t, teamsById, myTeamId);
    if (round === 1) {
      return matchHtml;
    }
    const feederDepth = round - 2; // depth (rounds above a leaf) of this node's two children
    const connHalf = bracketSubtreeHeight(feederDepth) / 2;
    const left = buildBracketNode(matchesByKey, round - 1, slot * 2, t, teamsById, myTeamId);
    const right = buildBracketNode(matchesByKey, round - 1, slot * 2 + 1, t, teamsById, myTeamId);
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
  // reused for that sub-bracket once it's been generated. A third-place match
  // sits directly below the final in the final's column.
  function renderBracket(t, matches = t.matches) {
    const teamsById = new Map(t.teams.map((team) => [team.id, team]));
    const thirdPlace = matches.find((m) => m.isThirdPlace);
    const treeMatches = matches.filter((m) => !m.isThirdPlace);
    const totalRounds = Math.max(...treeMatches.map((m) => m.round));
    const matchesByKey = new Map(treeMatches.map((m) => [`${m.round}:${m.slot}`, m]));
    const final = matchesByKey.get(`${totalRounds}:0`);
    const champion = final?.winnerTeamId ? teamLabel(teamsById, final.winnerTeamId) : null;

    const titles = [
      ...Array.from({ length: totalRounds }, (_, i) => `<div>${bracketRoundLabel(i + 1, totalRounds)}</div>`),
      champion ? '<div class="bracket-champion-title">Sieger</div>' : '',
    ].join('');
    const tree = buildBracketNode(matchesByKey, totalRounds, 0, t, teamsById, myTeamIdOf(t));
    const championHtml = champion
      ? `<div class="bracket-champion" aria-label="Sieger: ${champion}"><span class="bracket-team-name">${champion}</span></div>`
      : '';
    // Same columns as the round titles, so the box lines up under the final.
    // The final sits at the tree's vertical center and nothing else occupies
    // its column below it, so the row starts right under the final's bottom
    // edge instead of below the whole tree.
    const finalBottom = (bracketSubtreeHeight(totalRounds - 1) + BRACKET_MATCH_H) / 2;
    const thirdPlaceHtml = thirdPlace
      ? `<div class="bracket-third-place-row" data-bracket-third-place style="--final-bottom:${finalBottom}px;">
          ${'<div aria-hidden="true"></div>'.repeat(totalRounds - 1)}
          <div class="bracket-third-place">
            <div class="bracket-third-place-title">Spiel um Platz 3</div>
            ${renderBracketMatchBox(thirdPlace, t, teamsById, myTeamIdOf(t))}
          </div>
          ${champion ? '<div aria-hidden="true"></div>' : ''}
        </div>`
      : '';

    return `
      <div class="bracket-tree-wrap">
        <div class="bracket-tree-content">
          <div class="bracket-round-titles">${titles}</div>
          <div class="bracket-tree-body">
            <div class="bracket-final-row">${tree}${championHtml}</div>
            ${thirdPlaceHtml}
          </div>
        </div>
      </div>`;
  }

  // ---------- detail: round-robin (also reused for each group_knockout group) ----------

  function fixtureRowHtml(m, t, teamsById, myTeamId = myTeamIdOf(t)) {
    const decided = m.winnerTeamId !== null || m.isDraw;
    const aWon = m.winnerTeamId === m.teamAId;
    const bWon = m.winnerTeamId === m.teamBId;
    const nameCls = (won) => `tournament-fixture-team${decided ? (won ? ' is-winner' : m.isDraw ? '' : ' is-loser') : ''}`;
    let center;
    if (!decided) {
      center = '<span class="tournament-fixture-score is-open">vs</span>';
    } else if (t.trackScore && m.scoreA !== null && m.scoreB !== null) {
      center = `<span class="tournament-fixture-score"><span class="${aWon ? 'is-win' : ''}">${m.scoreA}</span> : <span class="${bWon ? 'is-win' : ''}">${m.scoreB}</span></span>`;
    } else if (m.isDraw) {
      center = '<span class="tournament-fixture-score">Remis</span>';
    } else {
      center = `<span class="tournament-fixture-score is-pick">${aWon ? `${icon('chevronLeft')} Win` : `Win ${icon('chevronRight')}`}</span>`;
    }
    const nameA = teamLabel(teamsById, m.teamAId);
    const nameB = teamLabel(teamsById, m.teamBId);
    const teamHtml = (teamId, won, home) => `<span class="${nameCls(won)}${home ? ' is-home' : ''}">${teamLabel(teamsById, teamId)}</span>`;
    const mine = isMyMatch(m, myTeamId);
    return `<div class="tournament-fixture${mine ? ' is-mine' : ''}" aria-label="${mine ? 'Dein Spiel: ' : ''}${nameA} gegen ${nameB}">
        ${mine ? '<span class="visually-hidden">Dein Spiel: </span>' : ''}
        ${teamHtml(m.teamAId, aWon, true)}
        ${center}
        ${teamHtml(m.teamBId, bWon, false)}
        ${resultActionHtml(m, t, 'tournament-fixture-action')}
      </div>`;
  }

  function renderSingleFinal(t, match) {
    const teamsById = new Map(t.teams.map((team) => [team.id, team]));
    return fixtureRowHtml(match, t, teamsById);
  }

  function renderFixtures(t, teamsById, matches) {
    const myTeamId = myTeamIdOf(t);
    const byRound = new Map();
    for (const m of matches) byRound.set(m.round, [...(byRound.get(m.round) ?? []), m]);
    const rounds = [...byRound.entries()].sort((a, b) => a[0] - b[0]);
    const currentRound =
      t.status === 'active'
        ? rounds.find(([, roundMatches]) => roundMatches.some((m) => m.winnerTeamId === null && !m.isDraw))?.[0]
        : undefined;
    return rounds
      .map(
        ([round, roundMatches]) => `
          <div class="tournament-round">
            <div class="tournament-round-head">Runde ${round}${round === currentRound ? ' <span class="badge badge-playing">Aktuell</span>' : ''}</div>
            ${roundMatches.map((m) => fixtureRowHtml(m, t, teamsById, myTeamId)).join('')}
          </div>`,
      )
      .join('');
  }

  function renderStandings(t, teamsById, matches, standings, { advancers = 0 } = {}) {
    const diff = new Map();
    if (t.trackScore) {
      for (const m of matches) {
        if (m.scoreA === null || m.scoreB === null) continue;
        diff.set(m.teamAId, (diff.get(m.teamAId) ?? 0) + m.scoreA - m.scoreB);
        diff.set(m.teamBId, (diff.get(m.teamBId) ?? 0) + m.scoreB - m.scoreA);
      }
    }
    const signed = (n) => (n > 0 ? `+${n}` : n < 0 ? `−${Math.abs(n)}` : '0');
    const myTeamId = myTeamIdOf(t);
    const rows = (standings || [])
      .map((s, i) => {
        const advances = i < advancers;
        const mine = Boolean(myTeamId) && s.teamId === myTeamId;
        return `<tr class="${i === 0 && s.played > 0 ? 'is-leader' : ''}${advances ? ' is-advancing' : ''}${mine ? ' is-mine' : ''}">
          <td class="tournament-standings-rank">${i + 1}</td>
          <td class="tournament-standings-team"><span class="tournament-standings-identity"><span class="tournament-standings-name">${teamLabel(teamsById, s.teamId)}</span>${mine ? MY_TEAM_HINT : ''}${advances ? '<span class="tournament-standings-advance">weiter</span>' : ''}</span></td>
          <td>${s.played}</td>
          <td>${s.wins}</td>
          <td>${s.draws}</td>
          <td>${s.losses}</td>
          ${t.trackScore ? `<td>${signed(diff.get(s.teamId) ?? 0)}</td>` : ''}
          <td class="tournament-standings-points">${s.points}</td>
        </tr>`;
      })
      .join('');
    return `<table class="tournament-standings">
        <thead><tr>
          <th scope="col" title="Platz"><span class="visually-hidden">Platz</span><span aria-hidden="true">#</span></th>
          <th scope="col">Team</th>
          <th scope="col" title="Spiele">Sp</th>
          <th scope="col" title="Siege">S</th>
          <th scope="col" title="Unentschieden">U</th>
          <th scope="col" title="Niederlagen">N</th>
          ${t.trackScore ? '<th scope="col" title="Punktedifferenz">+/−</th>' : ''}
          <th scope="col" title="Punkte">Pkt</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>`;
  }

  function renderRoundRobin(t) {
    const teamsById = new Map(t.teams.map((team) => [team.id, team]));
    return `<section class="card stack grouped-page-section tournament-board-card">
          <div class="grouped-page-section-title"><h2>Tabelle</h2></div>
          ${renderStandings(t, teamsById, t.matches, t.standings)}
        </section>
        <section class="card stack grouped-page-section tournament-board-card">
          <div class="grouped-page-section-title"><h2>Spielplan</h2></div>
          ${renderFixtures(t, teamsById, t.matches)}
        </section>`;
  }

  // ---------- detail: group stage + knockout ----------

  function renderGroupKnockout(t) {
    const teamsById = new Map(t.teams.map((team) => [team.id, team]));

    const groupBlocks = (t.groups || [])
      .map((g) => {
        const groupMatches = t.matches.filter((m) => m.stage === 'group' && m.groupIndex === g.groupIndex);
        return `
          <section class="card stack grouped-page-section tournament-board-card" aria-labelledby="tournament-group-${g.groupIndex}">
            <div class="grouped-page-section-title"><h2 id="tournament-group-${g.groupIndex}">Gruppe ${g.groupIndex + 1}</h2></div>
            <h3 class="tournament-group-subtitle">Tabelle</h3>
            ${renderStandings(t, teamsById, groupMatches, g.standings, { advancers: t.advancersPerGroup ?? 0 })}
            <div class="tournament-group-fixtures">
              <h3 class="tournament-group-subtitle">Spielplan</h3>
              ${renderFixtures(t, teamsById, groupMatches)}
            </div>
          </section>`;
      })
      .join('');

    const knockoutMatches = t.matches.filter((m) => m.stage === 'knockout');
    // A third-place match needs four teams, so a lone final never has one.
    const knockoutHtml = `<section class="card stack grouped-page-section tournament-board-card">
        <div class="grouped-page-section-title"><h2>${knockoutMatches.length === 1 ? 'Finale' : 'K.O.-Runde'}</h2></div>
        ${
          knockoutMatches.length === 0
            ? emptyStateHtml('Startet automatisch, sobald alle Gruppenspiele entschieden sind.')
            : knockoutMatches.length === 1 ? renderSingleFinal(t, knockoutMatches[0]) : renderBracket(t, knockoutMatches)
        }
      </section>`;

    return `<div class="tournament-group-stage"><div class="tournament-groups-grid">${groupBlocks}</div>${knockoutHtml}</div>`;
  }

  const isOwnTeam = (team) => Boolean(myPlayerId) && team.players.some((player) => player.id === myPlayerId);

  function teamCardHtml(t, team, { winner = false, renamable = false, highlight = false } = {}) {
    const mine = isOwnTeam(team);
    // The own card carries a marker so a "wählt euren Teamnamen" deep link
    // can open the Teams card and highlight exactly this team.
    const ownMarker = mine ? ` data-own-tournament-team="${escapeHtml(t.id)}"` : '';
    return `
        <div class="team-card tournament-team-card${mine ? ' is-mine' : ''}${highlight ? ' search-target-highlight' : ''}"${ownMarker}>
          <div class="team-card-header">
            <span class="row tournament-team-card-heading" style="gap:var(--space-2);">
              <span class="tournament-team-card-name">${escapeHtml(team.name)}</span>${mine ? MY_TEAM_HINT : ''}
              ${teamSkillHtml(team.players, t.gameId, { balanced: false, current: true })}
              ${winner ? '<span class="tournament-fixture-score is-pick">Win</span>' : ''}
            </span>
            ${
              renamable
                ? `<button type="button" class="tournament-fixture-action" data-rename-team="${escapeHtml(team.id)}" aria-label="${escapeHtml(`Teamnamen ändern: ${team.name}`)}" title="Teamnamen ändern">${icon('pencil')}</button>`
                : `<span class="muted">${team.players.length} Spieler</span>`
            }
          </div>
          ${
            team.players.length
              ? team.players
                  .map(
                    (player) => `
                    <div class="team-player">
                      ${avatarHtml(player, 24)}
                      <span class="player-name team-player-name" style="flex:1;">${player.id === myPlayerId ? `<strong>${escapeHtml(player.name)}</strong>` : escapeHtml(player.name)}</span>
                      ${playerSkillHtml(player, t.gameId)}
                    </div>`,
                  )
                  .join('')
              : '<div class="muted">Keine aktiven Spieler</div>'
          }
        </div>`;
  }

  // A finished tournament leads with its outcome, so the end is visible
  // without reading the board: the winning team with its players.
  function renderChampion(t) {
    const champion = t.status === 'completed' ? t.teams.find((team) => team.id === t.championTeamId) : null;
    if (!champion) return '';
    return `<section class="card stack grouped-page-section" aria-labelledby="tournament-champion-title" data-tournament-champion>
      <div class="grouped-page-section-title"><h2 id="tournament-champion-title">Turnier beendet</h2></div>
      ${teamCardHtml(t, champion, { winner: true })}
    </section>`;
  }

  // canRename(team) decides per team whether the pencil appears (own team
  // or a group admin, while the tournament runs). The own team leads the
  // grid so it is found without scanning.
  function renderTournamentTeams(t, { teamsOpen = false, canRename = () => false, highlightOwn = false } = {}) {
    const ordered = [...t.teams.filter(isOwnTeam), ...t.teams.filter((team) => !isOwnTeam(team))];
    const cards = ordered
      .map((team) => teamCardHtml(t, team, { renamable: canRename(team), highlight: highlightOwn && isOwnTeam(team) }))
      .join('');

    // Teams are a lookup next to the live bracket, so they sit in the shared
    // collapsible card that starts closed (open state lives in the view).
    return `<details class="card grouped-page-section collapsible-section" data-tournament-teams ${teamsOpen ? 'open' : ''}>
      <summary class="collapsible-section-header">
        <span class="collapsible-section-chevron">${icon('chevronRight')}</span>
        <h2>Teams</h2>
        <span class="collapsible-section-summary-end">
          <span class="badge badge-offline">${t.teams.length}</span>
        </span>
      </summary>
      <div class="collapsible-section-content"><div class="tournament-team-grid">${cards}</div></div>
    </details>`;
  }

  return {
    matchPhaseLabel: activeLobbyPhaseLabel,
    renderActiveLobbies,
    renderBracket,
    renderChampion,
    renderGroupKnockout,
    renderSingleFinal,
    renderRoundRobin,
    renderTournamentTeams,
  };
}
