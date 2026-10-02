// Tournament detail view (FR-33): automatically generated single-elimination
// bracket ("Turnierbaum") or
// round-robin league ("jeder gegen jeden", optionally Hin- und Rückspiele),
// then record results as they happen. Teams come from a Match draw or
// Captain Draft: its "Turnier erstellen" action (views/matchmaking.js)
// creates the tournament, so this view no longer forms teams itself.

import { api } from '../api.js';
import { confirmDialog, openModal } from '../modal.js';
import { escapeHtml } from '../format.js';
import { showToast } from '../toast.js';
import { createTournamentPresentation } from '../tournamentPresentation.js';
import { withStepUp } from '../reauth.js';
import { emptyStateHtml } from '../emptyState.js';
import { localRouteKey } from '../appRoute.js';
import { copyText } from '../clipboard.js';
import { resultFormHtml, wireResultForm } from '../resultDialog.js';
import { getMyId } from '../whoami.js';
import { isGroupAdmin } from '../groupContext.js';

// Open state of the detail page's collapsible Teams card across re-renders.
let tournamentTeamsOpen = false;
// Tournament whose own team card stays highlighted after arriving through the
// start push (#tournaments/<id>/teams). Kept here rather than as a one-off DOM
// class so the live re-renders right after startup do not drop it.
let ownTeamFocusFor = null;

// Called by app.js before rendering a "tournament-team" target.
export function prepareTournamentTeamTarget(tournamentId) {
  ownTeamFocusFor = tournamentId;
  tournamentTeamsOpen = true;
}

// Called by app.js when navigating away, so a later ordinary visit of the
// same tournament does not replay the highlight.
export function clearTournamentTeamTarget() {
  ownTeamFocusFor = null;
}

// Horizontal position of the bracket across re-renders. A live update rebuilds
// the board, so without this the bracket would jump back to its first round.
let bracketScroll = { tournamentId: null, left: 0 };

// On a phone the bracket scrolls sideways. The first view of a tournament
// brings the reader's own open match into view; later re-renders keep wherever
// the reader scrolled to.
function restoreBracketScroll(container, tournamentId) {
  const wrap = container.querySelector('.bracket-tree-wrap');
  if (!wrap) return;
  if (bracketScroll.tournamentId === tournamentId) {
    wrap.scrollLeft = bracketScroll.left;
  } else {
    const ownOpenMatch = wrap.querySelector('.bracket-match.is-open .bracket-team-row.is-mine')?.closest('.bracket-match');
    if (ownOpenMatch && wrap.scrollWidth > wrap.clientWidth) {
      const offset = ownOpenMatch.getBoundingClientRect().left - wrap.getBoundingClientRect().left + wrap.scrollLeft;
      wrap.scrollLeft = offset - (wrap.clientWidth - ownOpenMatch.offsetWidth) / 2;
    }
    bracketScroll = { tournamentId, left: wrap.scrollLeft };
  }
  wrap.addEventListener('scroll', () => {
    bracketScroll = { tournamentId, left: wrap.scrollLeft };
  }, { passive: true });
}

const FORMAT_LABELS = {
  single_elimination: 'K.O.-Turnier',
  round_robin: 'Liga (jeder gegen jeden)',
  group_knockout: 'Gruppenphase + K.O.',
};

// ---------- module state ----------

let currentTournamentId = null;
let detailCache = null;
let detailLoading = false;
let detailForId = null;
let detailStale = false;
let detailRequestVersion = 0;
let detailError = null;

let appliedRouteKey = null;

async function loadDetail(id, ctx) {
  const version = ++detailRequestVersion;
  detailLoading = true;
  detailStale = false;
  try {
    const result = await api.tournaments.get(id);
    if (version === detailRequestVersion) {
      detailCache = result;
      detailForId = id;
      detailError = null;
    }
  } catch (err) {
    if (version === detailRequestVersion) {
      showToast(err.message, { error: true });
      if (detailForId !== id || err.status === 404) detailCache = null;
      detailForId = id;
      detailError = err.status === 404 ? 'Dieses Turnier ist nicht mehr verfügbar.' : 'Turnier konnte nicht geladen werden.';
    }
  } finally {
    if (version === detailRequestVersion) {
      detailLoading = false;
      ctx.rerender();
    }
  }
}

// Ends a tournament that will not be played out (admin only; the server
// keeps every recorded result but crowns no champion). Shared with Home's
// "Meine To-Dos". Resolves true once it ended.
export async function finishTournament(tournament) {
  if (
    !(await confirmDialog(
      `Turnier „${tournament.name}“ beenden? Offene Spiele werden nicht mehr gewertet und es gibt keinen Sieger.`,
      { title: 'Turnier beenden', confirmText: 'Beenden', danger: true },
    ))
  ) return false;
  try {
    await api.tournaments.finish(tournament.id);
    showToast('Turnier beendet.');
    return true;
  } catch (err) {
    showToast(err.message, { error: true });
    return false;
  }
}

// Called from app.js on every tournaments:changed socket event, so this
// view's data is never more than one re-render stale.
export function invalidateTournaments({ hard = false } = {}) {
  detailRequestVersion += 1;
  detailLoading = false;
  detailStale = true;
  if (hard) {
    detailCache = null;
    detailForId = null;
    detailError = null;
  }
}

function applyLocalRoute(route) {
  const key = localRouteKey(route);
  if (key === appliedRouteKey) return;
  appliedRouteKey = key;
  currentTournamentId = route?.kind === 'detail' ? route.id : null;
  detailError = null;
}

function renderDetail(container, ctx) {
  if ((detailForId !== currentTournamentId || detailStale) && !detailLoading) {
    loadDetail(currentTournamentId, ctx);
  }
  if (detailForId !== currentTournamentId || !detailCache) {
    container.innerHTML = `<h2 class="view-title">Turnier</h2>${emptyStateHtml(detailError ?? 'Lädt…')}`;
    return;
  }

  const t = detailCache;
  const {
    matchPhaseLabel,
    renderActiveLobbies,
    renderBracket,
    renderChampion,
    renderGroupKnockout,
    renderSingleFinal,
    renderRoundRobin,
    renderTournamentTeams,
  } = createTournamentPresentation(getMyId());
  const boardContent =
    t.format === 'single_elimination'
      ? t.matches.filter((match) => !match.isBye).length === 1
        ? renderSingleFinal(t, t.matches.find((match) => !match.isBye))
        : renderBracket(t)
      : t.format === 'group_knockout'
        ? renderGroupKnockout(t)
        : renderRoundRobin(t);
  const board =
    t.format === 'single_elimination'
      ? `<section class="card stack grouped-page-section tournament-board-card">
           <div class="grouped-page-section-title"><h2>${t.matches.filter((match) => !match.isBye).length === 1 ? 'Finale' : 'Turnierbaum'}</h2></div>
           ${boardContent}
         </section>`
      : boardContent;

  const decidedMatches = t.matches.filter((match) => match.winnerTeamId !== null || match.isDraw).length;
  const participantCount = t.teams.reduce((sum, team) => sum + team.players.length, 0);

  const formatMeta = [
    t.twoLegged ? 'Hin- & Rückrunde' : null,
    t.format === 'group_knockout' ? `${t.groupCount} Gruppen · Top ${t.advancersPerGroup} steigen auf` : null,
    t.thirdPlaceMatch ? 'Spiel um Platz 3' : null,
    t.trackScore ? 'Punktestand' : null,
  ]
    .filter(Boolean)
    .join(' · ');
  const formatExplanation = `${FORMAT_LABELS[t.format]}${formatMeta ? ` · ${formatMeta}` : ''}`;
  const activeLobbies = renderActiveLobbies(t);

  container.innerHTML = `
    <div class="row-between page-title-row">
      <h2 class="view-title">${escapeHtml(t.name)}</h2>
      ${isGroupAdmin()
        ? `<span class="row" style="gap:var(--space-2);">
            ${t.status === 'active' ? '<button type="button" class="btn btn-sm" id="tourn-finish">Beenden</button>' : ''}
            <button type="button" class="btn btn-sm" id="tourn-delete">Löschen</button>
          </span>`
        : ''}
    </div>
    <div class="muted tournament-detail-meta">
      <span>${formatExplanation} · ${t.teams.length} Teams · ${participantCount} Spieler · ${decidedMatches}/${t.matches.length} entschieden</span>
      <span class="badge ${t.status === 'completed' ? 'badge-offline' : 'badge-playing'}">${t.status === 'completed' ? (t.endedEarly ? 'Vorzeitig beendet' : 'Beendet') : 'Läuft'}</span>
    </div>
    <div class="grouped-page-sections tournament-board">
      ${renderChampion(t)}
      ${activeLobbies}
      ${board}
      ${renderTournamentTeams(t, { teamsOpen: tournamentTeamsOpen, canRename: (team) => canRenameTeam(t, team), highlightOwn: ownTeamFocusFor === t.id })}
    </div>
  `;

  container.querySelector('[data-tournament-teams]')?.addEventListener('toggle', (event) => {
    tournamentTeamsOpen = event.currentTarget.open;
  });
  restoreBracketScroll(container, t.id);

  container.querySelectorAll('[data-copy-lobby-match]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const isPassword = btn.dataset.copyLobbyKind === 'password';
      const match = t.matches.find((candidate) => candidate.id === btn.dataset.copyLobbyMatch);
      const value = isPassword ? t.lobbyPassword : match?.lobbyName;
      if (!value) return;
      try {
        await copyText(value);
        showToast(isPassword ? 'Passwort kopiert.' : 'Lobbyname kopiert.');
      } catch {
        showToast('Kopieren nicht möglich – bitte manuell markieren.', { error: true });
      }
    });
  });

  container.querySelector('#tourn-finish')?.addEventListener('click', async () => {
    if (await finishTournament(t)) await loadDetail(t.id, ctx);
  });

  container.querySelector('#tourn-delete')?.addEventListener('click', async () => {
    if (!(await confirmDialog(`Turnier "${t.name}" wirklich löschen?`, { confirmText: 'Löschen', danger: true }))) return;
    try {
      const removed = await withStepUp(() => api.tournaments.remove(t.id));
      if (removed === undefined) return;
      currentTournamentId = null;
      showToast('Turnier gelöscht.');
      ctx.navigateLocal(null, { replace: true });
    } catch (err) {
      showToast(err.message, { error: true });
    }
  });

  container.querySelectorAll('[data-rename-team]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const index = t.teams.findIndex((team) => team.id === btn.dataset.renameTeam);
      if (index !== -1) openRenameTeamDialog(t, t.teams[index], ctx);
    });
  });

  container.querySelectorAll('[data-open-result]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const match = t.matches.find((candidate) => candidate.id === btn.dataset.openResult);
      if (match) openResultDialog(t, match, matchPhaseLabel(t, match), ctx);
    });
  });
}

// Mirrors the server rule: a member renames their own team, a group admin
// any team, and only while the tournament is still running.
function canRenameTeam(t, team) {
  if (t.status === 'completed') return false;
  const myId = getMyId();
  return isGroupAdmin() || Boolean(myId && team.players.some((player) => player.id === myId));
}

function openRenameTeamDialog(t, team, ctx) {
  const { close, el } = openModal('Teamnamen ändern', `
    <div class="muted result-dialog-subtitle">${escapeHtml(t.name)}</div>
    <form class="stack" data-rename-team-form novalidate>
      <div>
        <label class="field-label is-required" for="rename-team-name">Teamname</label>
        <input type="text" id="rename-team-name" required autocomplete="off" value="${escapeHtml(team.name)}" />
      </div>
      <div class="row-between">
        <span></span>
        <button type="submit" class="btn btn-primary btn-sm">Speichern</button>
      </div>
    </form>`);
  const input = el.querySelector('#rename-team-name');
  input.select();

  let saving = false;
  async function save(name) {
    if (saving) return;
    if (!name) {
      showToast('Bitte einen Teamnamen eintragen.', { error: true });
      input.focus();
      return;
    }
    saving = true;
    try {
      detailCache = await api.tournaments.renameTeam(t.id, team.id, name);
      ownTeamFocusFor = null;
      close();
      ctx.rerender();
      showToast('Teamname gespeichert.');
    } catch (err) {
      showToast(err.message, { error: true });
      input.focus();
    } finally {
      saving = false;
    }
  }
  el.querySelector('[data-rename-team-form]').addEventListener('submit', (event) => {
    event.preventDefault();
    save(input.value.trim());
  });
}

// Tournament persistence keeps scoreA/scoreB and expectedPlayedAt; the form
// itself is shared with Match and Admin.
function affectedFollowup(t, match, nextWinnerId) {
  if (nextWinnerId === match.winnerTeamId) return null;
  if (t.format === 'group_knockout' && match.stage === 'group' &&
      t.matches.some((candidate) => candidate.stage === 'knockout')) {
    return 'Wenn du den Sieger änderst, wird die K.-o.-Phase neu erstellt. Dort bereits eingetragene Ergebnisse gehen verloren. Trotzdem speichern?';
  }
  if (t.format !== 'single_elimination' && match.stage !== 'knockout') return null;
  const hasDescendant = t.matches.some((candidate) =>
    candidate.stage === match.stage && candidate.round > match.round &&
    Math.floor(match.slot / (2 ** (candidate.round - match.round))) === candidate.slot);
  return hasDescendant
    ? 'Wenn du den Sieger änderst, werden nachfolgende K.-o.-Partien neu besetzt. Bereits eingetragene Ergebnisse dort gehen verloren. Trotzdem speichern?'
    : null;
}

function openResultDialog(t, match, phaseLabel, ctx) {
  const team = (id) => t.teams.find((candidate) => candidate.id === id);
  const teams = [match.teamAId, match.teamBId].map((id) => ({
    name: team(id)?.name ?? 'offen',
    players: team(id)?.players.map((player) => player.name) ?? [],
  }));
  const decided = match.winnerTeamId !== null || match.isDraw;
  const knockout = t.format === 'single_elimination' || match.stage === 'knockout';
  const { close, el } = openModal('Ergebnis', `
    <div class="muted result-dialog-subtitle">${escapeHtml(t.name)} · ${escapeHtml(phaseLabel)}</div>
    ${resultFormHtml({ teams, prefix: 'tournament-result', mode: t.trackScore ? 'score' : 'winner', fixedMode: true, allowDraw: !knockout, integerScores: true, winnerIndex: decided && !t.trackScore ? match.isDraw ? -1 : match.winnerTeamId === match.teamAId ? 0 : 1 : undefined, scores: [match.scoreA, match.scoreB] })}`);
  wireResultForm(el, {
    teams, mode: t.trackScore ? 'score' : 'winner', allowDraw: !knockout, integerScores: true,
    onSave: async ({ mode, winnerIndex, scores }) => {
      const nextWinnerId = winnerIndex === null ? null : winnerIndex === 0 ? match.teamAId : match.teamBId;
      const payload = mode === 'score'
        ? { scoreA: scores[0], scoreB: scores[1] }
        : { winnerTeamId: nextWinnerId };
      const warning = decided ? affectedFollowup(t, match, nextWinnerId) : null;
      if (warning && !(await confirmDialog(warning, { title: 'Folgende Partien betroffen', confirmText: 'Trotzdem speichern', danger: true }))) {
        return false;
      }
      detailCache = decided
        ? await api.tournaments.updateResult(t.id, match.id, { ...payload, expectedPlayedAt: match.playedAt })
        : await api.tournaments.recordResult(t.id, match.id, payload);
      close();
      ctx.rerender();
      const champion = detailCache.teams.find((team) => team.id === detailCache.championTeamId);
      showToast(t.status !== 'completed' && champion ? `Turnier beendet – Sieger: ${champion.name}` : 'Ergebnis gespeichert.');
    },
  });
}

// ---------- entry point ----------

export function renderTournaments(container, ctx) {
  applyLocalRoute(ctx.localRoute());
  if (currentTournamentId) renderDetail(container, ctx);
  else container.innerHTML = `<h2 class="view-title">Turnier</h2>${emptyStateHtml('Turnier in Match auswählen.')}`;
}
