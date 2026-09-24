// Tournament view (FR-33): list and detail of tournaments with an
// automatically generated single-elimination bracket ("Turnierbaum") or
// round-robin league ("jeder gegen jeden", optionally Hin- und Rückspiele),
// then record results as they happen. Teams come from a Match draw or
// Captain Draft: its "Turnier erstellen" action (views/matchmaking.js)
// creates the tournament, so this view no longer forms teams itself.

import { api } from '../api.js';
import { confirmDialog, openModal } from '../modal.js';
import { escapeHtml } from '../format.js';
import { showToast } from '../toast.js';
import { icon } from '../icons.js';
import { createTournamentPresentation } from '../tournamentPresentation.js';
import { withStepUp } from '../reauth.js';
import { emptyStateHtml } from '../emptyState.js';
import { localRouteKey } from '../appRoute.js';
import { copyText } from '../clipboard.js';

// Open state of the detail page's collapsible Teams card across re-renders.
let tournamentTeamsOpen = false;

const FORMAT_LABELS = {
  single_elimination: 'K.O.-Turnier',
  round_robin: 'Liga (jeder gegen jeden)',
  group_knockout: 'Gruppenphase + K.O.',
};
const SHORT_FORMAT_LABELS = {
  single_elimination: 'K.O.-Turnier',
  round_robin: 'Liga',
  group_knockout: 'Gruppenphase + K.O.',
};

// ---------- module state ----------

let listCache = null;
let listLoading = false;
let listStale = false;
let listRequestVersion = 0;
let completedSectionOpen = false;

let currentTournamentId = null; // null = list view
let detailCache = null;
let detailLoading = false;
let detailForId = null;
let detailStale = false;
let detailRequestVersion = 0;

let appliedRouteKey = null;

async function loadList(ctx) {
  const version = ++listRequestVersion;
  listLoading = true;
  listStale = false;
  try {
    const result = await api.tournaments.list();
    if (version === listRequestVersion) listCache = result;
  } catch (err) {
    if (version === listRequestVersion) {
      showToast(err.message, { error: true });
      if (listCache === null) listCache = [];
    }
  } finally {
    if (version === listRequestVersion) {
      listLoading = false;
      ctx.rerender();
    }
  }
}

async function loadDetail(id, ctx) {
  const version = ++detailRequestVersion;
  detailLoading = true;
  detailStale = false;
  try {
    const result = await api.tournaments.get(id);
    if (version === detailRequestVersion) {
      detailCache = result;
      detailForId = id;
    }
  } catch (err) {
    if (version === detailRequestVersion) {
      showToast(err.message, { error: true });
      if (detailForId !== id) detailCache = null;
      detailForId = id;
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
  listRequestVersion += 1;
  detailRequestVersion += 1;
  listLoading = false;
  detailLoading = false;
  listStale = true;
  detailStale = true;
  if (hard) {
    listCache = null;
    detailCache = null;
    detailForId = null;
  }
}

function applyLocalRoute(route) {
  const key = localRouteKey(route);
  if (key === appliedRouteKey) return;
  appliedRouteKey = key;
  currentTournamentId = route?.kind === 'detail' ? route.id : null;
}

// ---------- list ----------

function renderList(container, ctx) {
  if ((listCache === null || listStale) && !listLoading) loadList(ctx);

  const tournamentCards = (tournaments) => `<div class="card-grid tournament-list-grid">${tournaments
    .map(
      (t) => `
      <button type="button" class="card tournament-list-card" data-open-tournament="${t.id}">
                <span class="tournament-list-card-main">
          <span class="player-name">${escapeHtml(t.name)}</span>
          <span class="muted tournament-list-game">${escapeHtml(t.gameName)}</span>
          <span class="muted tournament-list-meta">${SHORT_FORMAT_LABELS[t.format]} · ${t.teamCount} Teams</span>
          ${
            t.status === 'completed'
              ? t.championName
                ? `<span class="tournament-list-result">Sieger: <strong>${escapeHtml(t.championName)}</strong></span>`
                : ''
              : Number.isInteger(t.matchCount)
                ? `<span class="tournament-list-result">${t.decidedMatchCount}/${t.matchCount} Partien</span>`
                : ''
          }
        </span>
        <span class="tournament-list-card-end">
          <span class="badge ${t.status === 'completed' ? 'badge-offline' : 'badge-playing'}">${t.status === 'completed' ? 'Beendet' : 'Läuft'}</span>
          ${icon('chevronRight')}
        </span>
      </button>`
    )
    .join('')}</div>`;
  const tournamentSection = (
    title,
    tournaments,
    { active = false, collapsible = false, loading = false, emptyText } = {},
  ) => {
    const content = loading
      ? emptyStateHtml('Lädt…', { className: 'tournament-list-empty' })
      : tournaments.length
        ? tournamentCards(tournaments)
        : emptyStateHtml(emptyText ?? 'Noch keine Turniere.', { className: 'tournament-list-empty' });
    if (collapsible) {
      return `<details class="card tournament-list-section collapsible-section" data-completed-tournaments ${completedSectionOpen ? 'open' : ''}>
        <summary class="collapsible-section-header">
          <h2>${title}</h2>
          <span class="collapsible-section-summary-end">
            <span class="badge badge-offline">${tournaments.length}</span>
            <span class="collapsible-section-chevron">${icon('chevronRight')}</span>
          </span>
        </summary>
        <div class="collapsible-section-content">${content}</div>
      </details>`;
    }

    return `<section class="card stack grouped-page-section${active ? ' primary-collection-section' : ''} tournament-list-section" aria-label="${title}">
      <div class="grouped-page-section-title">
        <h2>${title}</h2>
        ${active ? '<button type="button" class="btn btn-primary btn-sm" id="tourn-new-btn">Turnier anlegen</button>' : ''}
      </div>
      ${content}
    </section>`;
  };

  let currentListHtml;
  let completedListHtml = '';
  if (listCache === null) {
    currentListHtml = tournamentSection('Aktuelle Turniere', [], { active: true, loading: true });
  } else if (listCache.length === 0) {
    currentListHtml = tournamentSection('Aktuelle Turniere', [], {
      active: true,
      emptyText: 'Noch keine Turniere.',
    });
  } else {
    const activeTournaments = listCache.filter((t) => t.status !== 'completed');
    const completedTournaments = listCache.filter((t) => t.status === 'completed');
    currentListHtml = tournamentSection('Aktuelle Turniere', activeTournaments, { active: true });
    completedListHtml = tournamentSection('Abgeschlossene Turniere', completedTournaments, { collapsible: true });
  }

  container.innerHTML = `<div class="grouped-page-sections">
    ${currentListHtml}
    ${completedListHtml}
  </div>`;

  // Every tournament starts from a draw: Match > Teams draws or drafts the
  // lineup, and that draw offers "Turnier erstellen".
  container.querySelector('#tourn-new-btn')?.addEventListener('click', () => {
    window.dispatchEvent(new CustomEvent('respawn:navigate', { detail: 'matchmaking' }));
  });

  container.querySelectorAll('[data-open-tournament]').forEach((btn) => {
    btn.addEventListener('click', () => {
      ctx.navigateLocal({ kind: 'detail', id: btn.dataset.openTournament });
    });
  });

  const completedSection = container.querySelector('[data-completed-tournaments]');
  completedSection?.addEventListener('toggle', () => {
    completedSectionOpen = completedSection.open;
  });

}

function renderDetail(container, ctx) {
  if ((detailForId !== currentTournamentId || detailStale) && !detailLoading) {
    loadDetail(currentTournamentId, ctx);
  }
  if (detailForId !== currentTournamentId || !detailCache) {
    container.innerHTML = emptyStateHtml('Lädt…');
    return;
  }

  const t = detailCache;
  const {
    matchPhaseLabel,
    renderActiveLobbies,
    renderBracket,
    renderGroupKnockout,
    renderRoundRobin,
    renderTournamentTeams,
  } = createTournamentPresentation();
  const boardContent =
    t.format === 'single_elimination'
      ? renderBracket(t)
      : t.format === 'group_knockout'
        ? renderGroupKnockout(t)
        : renderRoundRobin(t);
  const board =
    t.format === 'single_elimination'
      ? `<section class="card stack grouped-page-section tournament-board-card">
           <div class="grouped-page-section-title"><h2>Turnierbaum</h2></div>
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
      <button type="button" class="btn btn-sm" id="tourn-delete">Löschen</button>
    </div>
    <div class="muted tournament-detail-meta">
      <span>${formatExplanation} · ${t.teams.length} Teams · ${participantCount} Spieler · ${decidedMatches}/${t.matches.length} entschieden</span>
      <span class="badge ${t.status === 'completed' ? 'badge-offline' : 'badge-playing'}">${t.status === 'completed' ? 'Beendet' : 'Läuft'}</span>
    </div>
    <div class="grouped-page-sections tournament-board">
      ${activeLobbies}
      ${board}
      ${renderTournamentTeams(t, { teamsOpen: tournamentTeamsOpen })}
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

  container.querySelector('#tourn-delete').addEventListener('click', async () => {
    if (!(await confirmDialog(`Turnier "${t.name}" wirklich löschen?`, { confirmText: 'Löschen', danger: true }))) return;
    try {
      const removed = await withStepUp(() => api.tournaments.remove(t.id));
      if (removed === undefined) return;
      currentTournamentId = null;
      if (listCache) listCache = listCache.filter((entry) => entry.id !== t.id);
      listStale = true;
      showToast('Turnier gelöscht.');
      ctx.navigateLocal(null, { replace: true });
    } catch (err) {
      showToast(err.message, { error: true });
    }
  });

  container.querySelectorAll('[data-open-result]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const match = t.matches.find((candidate) => candidate.id === btn.dataset.openResult);
      if (match) openResultDialog(t, match, matchPhaseLabel(t, match), ctx);
    });
  });
}

// One dialog enters and edits every result, for all formats: two large score
// fields when the tournament tracks a score, otherwise one button per outcome
// that saves immediately. Knockout matches never offer a draw.
function openResultDialog(t, match, phaseLabel, ctx) {
  const teamName = (teamId) => escapeHtml(t.teams.find((team) => team.id === teamId)?.name ?? 'offen');
  const decided = match.winnerTeamId !== null || match.isDraw;
  const knockout = t.format === 'single_elimination' || match.stage === 'knockout';

  const body = t.trackScore
    ? `<form class="stack tournament-result-form" data-result-form>
        <div class="tournament-result-teams">
          <label for="result-score-a">${teamName(match.teamAId)}</label>
          <span class="muted">vs</span>
          <label for="result-score-b">${teamName(match.teamBId)}</label>
        </div>
        <div class="tournament-result-teams">
          <input type="number" id="result-score-a" class="tournament-result-score" min="0" inputmode="numeric" placeholder="0" required value="${decided && match.scoreA != null ? match.scoreA : ''}" />
          <span class="muted">:</span>
          <input type="number" id="result-score-b" class="tournament-result-score" min="0" inputmode="numeric" placeholder="0" required value="${decided && match.scoreB != null ? match.scoreB : ''}" />
        </div>
        <button type="submit" class="btn btn-primary btn-block">Speichern</button>
      </form>`
    : `<div class="stack tournament-result-form">
        <span class="muted">Wer hat gewonnen?</span>
        <button type="button" class="tournament-result-pick${match.winnerTeamId === match.teamAId ? ' is-selected' : ''}" data-result-winner="${match.teamAId}">${teamName(match.teamAId)}</button>
        <button type="button" class="tournament-result-pick${match.winnerTeamId === match.teamBId ? ' is-selected' : ''}" data-result-winner="${match.teamBId}">${teamName(match.teamBId)}</button>
        ${knockout ? '' : `<button type="button" class="tournament-result-pick is-draw${match.isDraw ? ' is-selected' : ''}" data-result-winner="">Unentschieden</button>`}
      </div>`;

  const { close, el } = openModal(`Ergebnis · ${phaseLabel}`, body);

  async function save(payload) {
    try {
      detailCache = decided
        ? await api.tournaments.updateResult(t.id, match.id, { ...payload, expectedPlayedAt: match.playedAt })
        : await api.tournaments.recordResult(t.id, match.id, payload);
      close();
      ctx.rerender();
    } catch (err) {
      showToast(err.message, { error: true });
    }
  }

  el.querySelector('[data-result-form]')?.addEventListener('submit', (event) => {
    event.preventDefault();
    const scoreA = parseInt(el.querySelector('#result-score-a').value, 10);
    const scoreB = parseInt(el.querySelector('#result-score-b').value, 10);
    if (!Number.isInteger(scoreA) || !Number.isInteger(scoreB) || scoreA < 0 || scoreB < 0) {
      showToast('Bitte beide Ergebnisse eintragen.', { error: true });
      return;
    }
    save({ scoreA, scoreB });
  });
  el.querySelectorAll('[data-result-winner]').forEach((btn) => {
    btn.addEventListener('click', () => save({ winnerTeamId: btn.dataset.resultWinner || null }));
  });
}

// ---------- entry point ----------

export function renderTournaments(container, ctx) {
  applyLocalRoute(ctx.localRoute());
  if (currentTournamentId) {
    renderDetail(container, ctx);
  } else {
    renderList(container, ctx);
  }
}
