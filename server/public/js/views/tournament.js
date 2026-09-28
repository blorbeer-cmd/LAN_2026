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
    t.trackScore ? 'Punktestand' : null,
  ]
    .filter(Boolean)
    .join(' · ');
  const formatExplanation = `${FORMAT_LABELS[t.format]}${formatMeta ? ` · ${formatMeta}` : ''}`;
  const activeLobbies = renderActiveLobbies(t);

  container.innerHTML = `
    <div class="row-between page-title-row">
      <h2 class="view-title">${escapeHtml(t.name)}</h2>
      ${isGroupAdmin() ? '<button type="button" class="btn btn-sm" id="tourn-delete">Löschen</button>' : ''}
    </div>
    <div class="muted tournament-detail-meta">
      <span>${formatExplanation} · ${t.teams.length} Teams · ${participantCount} Spieler · ${decidedMatches}/${t.matches.length} entschieden</span>
      <span class="badge ${t.status === 'completed' ? 'badge-offline' : 'badge-playing'}">${t.status === 'completed' ? 'Beendet' : 'Läuft'}</span>
    </div>
    <div class="grouped-page-sections tournament-board">
      ${renderChampion(t)}
      ${activeLobbies}
      ${board}
      ${renderTournamentTeams(t, { teamsOpen: tournamentTeamsOpen, canRename: (team) => canRenameTeam(t, team) })}
    </div>
  `;

  container.querySelector('[data-tournament-teams]')?.addEventListener('toggle', (event) => {
    tournamentTeamsOpen = event.currentTarget.open;
  });

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
      if (index !== -1) openRenameTeamDialog(t, t.teams[index], index, ctx);
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

const TEAM_NAME_MAX_LENGTH = 30;

function openRenameTeamDialog(t, team, index, ctx) {
  const defaultName = `Team ${index + 1}`;
  const players = team.players.map((player) => player.name).join(', ');
  const { close, el } = openModal('Teamnamen ändern', `
    <div class="muted result-dialog-subtitle">${escapeHtml(t.name)}${players ? ` · ${escapeHtml(players)}` : ''}</div>
    <form class="stack" data-rename-team-form novalidate>
      <div>
        <label class="field-label is-required" for="rename-team-name">Teamname</label>
        <input type="text" id="rename-team-name" maxlength="${TEAM_NAME_MAX_LENGTH}" required autocomplete="off" value="${escapeHtml(team.name)}" />
        <div class="row-between muted" style="font-size:var(--font-size-xs);margin-top:var(--space-1);">
          <span>Im Turnier eindeutig</span><span data-rename-team-count aria-hidden="true"></span>
        </div>
      </div>
      <p class="notice">Alle sehen den neuen Namen sofort – im Turnierbaum, bei den Lobbys und auf dem Broadcast.</p>
      <div class="row-between">
        ${team.name === defaultName ? '<span></span>' : `<button type="button" class="btn btn-sm" data-rename-team-reset>Auf „${escapeHtml(defaultName)}“ zurücksetzen</button>`}
        <button type="submit" class="btn btn-primary btn-sm">Speichern</button>
      </div>
    </form>`);
  const input = el.querySelector('#rename-team-name');
  const count = el.querySelector('[data-rename-team-count]');
  const updateCount = () => {
    count.textContent = `${input.value.trim().length}/${TEAM_NAME_MAX_LENGTH}`;
  };
  updateCount();
  input.addEventListener('input', updateCount);
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
      close();
      ctx.rerender();
      showToast('Teamname gespeichert.');
    } catch (err) {
      showToast(err.message, { error: true });
    } finally {
      saving = false;
    }
  }
  el.querySelector('[data-rename-team-form]').addEventListener('submit', (event) => {
    event.preventDefault();
    save(input.value.trim());
  });
  el.querySelector('[data-rename-team-reset]')?.addEventListener('click', () => save(defaultName));
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
