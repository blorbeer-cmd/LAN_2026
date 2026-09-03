// Tournament view (FR-33): pick a game + teams, get an automatically
// generated single-elimination bracket ("Turnierbaum") or round-robin
// league ("jeder gegen jeden", optionally Hin- und Rückspiele), then record
// results as they happen. Team formation reuses the same skill-balancing as
// "Teams auslosen" (api.matchmaking.generate) rather than reinventing it.

import { api } from '../api.js';
import { confirmDialog } from '../modal.js';
import { state, catalogGames } from '../state.js';
import { escapeHtml, avatarHtml, seatConflictIconHtml } from '../format.js';
import { showToast } from '../toast.js';
import { icon } from '../icons.js';
import { infoTooltipHtml, wireInfoTooltips } from '../infoTooltip.js';
import { domainIcon } from '../domainIcons.js';
import { moveTournamentDraftPlayer } from '../tournamentTeamDraft.js';
import { createTournamentPresentation } from '../tournamentPresentation.js';
import { playerSkillHtml, teamSkillHtml } from '../skillDisplay.js';
import { withStepUp } from '../reauth.js';
import { searchSelectHtml, wireSearchSelect } from '../searchSelect.js';
import { pruneRosterSelection, rosterPickerHtml, wireRosterPicker } from '../rosterPicker.js';
import { emptyStateHtml } from '../emptyState.js';
import { backButtonHtml } from '../backButton.js';
import { localRouteKey } from '../appRoute.js';
import { copyText } from '../clipboard.js';

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

let currentTournamentId = null; // null = list/create view
let detailCache = null;
let detailLoading = false;
let detailForId = null;
let detailStale = false;
let detailRequestVersion = 0;
let editingResultMatchId = null;

let createOpen = false;
let createCheckedIds = null;
let createFormat = 'single_elimination';
let createTwoLegged = false;
let createAvoidAdjacent = false;
let createTrackScore = false;
let createGroupCount = 2;
let createAdvancersPerGroup = 2;
let createTeamCount = ''; // persisted across re-rolls, so "Teams auslosen" acts as reroll
let createLobbyName = '';
let createLobbyPassword = '';
let createProposedTeams = null; // [{ name, playerIds, players (for display), totalRating }]
let createSelectedPlayerId = null; // touch/keyboard fallback for moving a proposed player
let createSeatConflicts = null; // { conflicts, considered } from the last proposal, for the seating note
let createAvoidPairs = []; // seat-neighbor pairs from the last proposal, to re-flag conflicts after a manual move
let createPlayerSearchQuery = '';
let appliedRouteKey = null;

// Re-derives each player's seatConflict flag/neighbor names (and the
// seating-note count) from createAvoidPairs — needed after a manual
// Feinschliff move on the unsaved proposal, since the server only computes
// this once at draw time.
function recomputeSeatConflicts() {
  if (!createProposedTeams || createAvoidPairs.length === 0) return;
  const teamOf = new Map();
  const nameById = new Map();
  createProposedTeams.forEach((t, i) =>
    t.players.forEach((p) => {
      teamOf.set(p.id, i);
      nameById.set(p.id, p.name);
    })
  );
  const conflictNeighborIds = new Map();
  const addConflict = (id, opponentId) => {
    const list = conflictNeighborIds.get(id);
    if (list) list.push(opponentId);
    else conflictNeighborIds.set(id, [opponentId]);
  };
  let conflicts = 0;
  for (const [a, b] of createAvoidPairs) {
    const teamA = teamOf.get(a);
    const teamB = teamOf.get(b);
    if (teamA !== undefined && teamB !== undefined && teamA !== teamB) {
      addConflict(a, b);
      addConflict(b, a);
      conflicts++;
    }
  }
  for (const t of createProposedTeams) {
    for (const p of t.players) {
      const neighborIds = conflictNeighborIds.get(p.id);
      p.seatConflict = !!neighborIds;
      p.seatConflictNames = neighborIds?.map((id) => nameById.get(id)).filter(Boolean) ?? [];
    }
  }
  createSeatConflicts = { conflicts, considered: createAvoidPairs.length };
}

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
  editingResultMatchId = null;
  if (route?.kind === 'create') {
    createOpen = true;
    currentTournamentId = null;
    return;
  }
  createOpen = false;
  currentTournamentId = route?.kind === 'detail' ? route.id : null;
}

function resetCreateForm() {
  createOpen = false;
  createCheckedIds = null;
  createFormat = 'single_elimination';
  createTwoLegged = false;
  createAvoidAdjacent = false;
  createTrackScore = false;
  createGroupCount = 2;
  createAdvancersPerGroup = 2;
  createTeamCount = '';
  createLobbyName = '';
  createLobbyPassword = '';
  createProposedTeams = null;
  createSelectedPlayerId = null;
  createSeatConflicts = null;
  createAvoidPairs = [];
  createPlayerSearchQuery = '';
}

// ---------- list + create ----------

function renderList(container, ctx) {
  if ((listCache === null || listStale) && !listLoading) loadList(ctx);
  if (createOpen) {
    container.innerHTML = '<div id="tourn-create" class="tournament-create-slot"></div>';
    renderCreateForm(container.querySelector('#tourn-create'), ctx);
    return;
  }

  const tournamentCards = (tournaments) => `<div class="card-grid tournament-list-grid">${tournaments
    .map(
      (t) => `
      <button type="button" class="card tournament-list-card" data-open-tournament="${t.id}">
                <span class="tournament-list-card-main">
          <span class="player-name">${escapeHtml(t.name)}</span>
          <span class="muted tournament-list-game">${escapeHtml(t.gameName)}</span>
          <span class="muted tournament-list-meta">${SHORT_FORMAT_LABELS[t.format]} · ${t.teamCount} Teams</span>
        </span>
        <span class="tournament-list-card-end">
          <span class="badge ${t.status === 'completed' ? 'badge-offline' : 'badge-playing'}">${t.status === 'completed' ? 'Beendet' : 'Läuft'}</span>
          ${icon('chevronRight')}
        </span>
      </button>`
    )
    .join('')}</div>`;
  const tournamentSection = (title, tournaments, { active = false, collapsible = false } = {}) => {
    const content = tournaments.length
      ? tournamentCards(tournaments)
      : `<div class="muted tournament-list-empty">${active ? 'Gerade läuft kein Turnier.' : 'Noch keine abgeschlossenen Turniere.'}</div>`;
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

    return `<section class="card tournament-list-section${active ? ' is-active' : ''}" aria-label="${title}">
      <div class="tournament-list-section-header">
        <h2>${title}</h2>
        <span class="badge ${active ? 'badge-playing' : 'badge-offline'}">${tournaments.length}</span>
      </div>
      ${content}
    </section>`;
  };

  let currentListHtml;
  let completedListHtml = '';
  if (listCache === null) {
    currentListHtml = emptyStateHtml('Lädt…');
  } else if (listCache.length === 0) {
    currentListHtml = emptyStateHtml('Noch keine Turniere.', { icon: icon(domainIcon('tournaments')) });
  } else {
    const activeTournaments = listCache.filter((t) => t.status !== 'completed');
    const completedTournaments = listCache.filter((t) => t.status === 'completed');
    currentListHtml = tournamentSection('Aktuelle Turniere', activeTournaments, { active: true });
    completedListHtml = tournamentSection('Abgeschlossene Turniere', completedTournaments, { collapsible: true });
  }

  container.innerHTML = `
    <div class="row view-actions">
      <button type="button" class="btn btn-primary btn-sm" id="tourn-new-btn">Turnier anlegen</button>
    </div>
    ${currentListHtml}
    <div id="tourn-create" class="tournament-create-slot"></div>
    ${completedListHtml}
  `;

  container.querySelector('#tourn-new-btn').addEventListener('click', () => {
    ctx.navigateLocal({ kind: 'create' });
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

// A tournament runs on an accepted game only — a suggestion nobody has taken
// into the catalog yet is not something to schedule a bracket for.
function createFormGameId() {
  const games = catalogGames();
  return games.some((game) => game.id === state.selectedGameId) ? state.selectedGameId : games[0]?.id;
}

function renderCreateForm(el, ctx) {
  if (catalogGames().length === 0 || state.players.length < 2) {
    el.innerHTML = `<div class="card stack">
      <div class="row-between">
        <div class="section-title" style="margin:0;">Neues Turnier</div>
        <button type="button" class="icon-btn" id="tourn-create-close" aria-label="Schließen">${icon('x')}</button>
      </div>
      ${emptyStateHtml('Dafür braucht es mindestens ein Spiel im Katalog und 2 Spieler.', {
        style: 'padding:var(--space-4);',
      })}
    </div>`;
    el.querySelector('#tourn-create-close').addEventListener('click', () => {
      resetCreateForm();
      ctx.backLocal(null);
    });
    return;
  }

  if (createCheckedIds === null) {
    createCheckedIds = new Set(state.live.filter((p) => p.state === 'playing').map((p) => p.player_id));
    if (createCheckedIds.size === 0) createCheckedIds = new Set(state.players.map((p) => p.id));
  }
  createCheckedIds = pruneRosterSelection(createCheckedIds, state.players);

  const selectedGameId = createFormGameId();
  state.selectedGameId = selectedGameId;

  const gameSelectOptions = catalogGames().map((g) => ({ value: g.id, label: g.name }));

  const seatingNote =
    createSeatConflicts && createSeatConflicts.considered
      ? createSeatConflicts.conflicts > 0
        ? `<div class="muted" style="font-size:var(--font-size-xs);">${icon('armchair')} ${createSeatConflicts.conflicts} von ${createSeatConflicts.considered} Sitznachbarschaft(en) mussten trotzdem gegeneinander antreten (sonst wäre es zu unfair geworden).</div>`
        : ''
      : '';

  const selectedTeamIndex = createProposedTeams && createSelectedPlayerId
    ? createProposedTeams.findIndex((team) => team.players.some((player) => player.id === createSelectedPlayerId))
    : -1;

  const teamsPreview = createProposedTeams
    ? `
      <div class="section-title" style="margin:0;">Teams</div>
      <div class="tournament-team-preview-grid">
        ${createProposedTeams
          .map(
            (t, i) => `
          <div class="team-card tournament-draft-team${selectedTeamIndex !== -1 && selectedTeamIndex !== i ? ' is-select-target' : ''}" data-tourn-drop-team="${i}" role="group" aria-label="${escapeHtml(t.name)}">
            <div class="team-card-header tournament-team-skill-header">
              <input type="text" data-team-name="${i}" value="${escapeHtml(t.name)}" maxlength="60" />
              ${teamSkillHtml(t.players, selectedGameId, { stored: true })}
            </div>
            ${t.players
              .map(
                (p) => `
              <button type="button" class="team-player tournament-drag-player${createSelectedPlayerId === p.id ? ' is-selected' : ''}" draggable="true" data-tourn-drag-player="${p.id}" data-team-index="${i}" aria-pressed="${createSelectedPlayerId === p.id}" aria-label="${escapeHtml(p.name)} verschieben">
                ${avatarHtml(p, 18)}
                <span class="player-name team-player-name" style="flex:1;">${escapeHtml(p.name)}</span>
                ${seatConflictIconHtml(p)}
                ${playerSkillHtml(p, selectedGameId, { stored: true })}
              </button>`
              )
              .join('')}
          </div>`
          )
          .join('')}
      </div>
      ${seatingNote}
    `
    : '';

  el.innerHTML = `
    <div class="card stack">
      <div class="row-between">
        <div class="section-title" style="margin:0;">Neues Turnier</div>
        <button type="button" class="icon-btn" id="tourn-create-close" aria-label="Schließen">${icon('x')}</button>
      </div>
      <section class="tournament-section-panel tournament-create-step stack" aria-labelledby="tournament-draw-step-title">
        <div class="tournament-create-step-title">
          <h3 id="tournament-draw-step-title">Auslosung</h3>
        </div>
        <label class="field-label is-required" for="tourn-game-search">Spiel auswählen</label>
        ${searchSelectHtml('tourn-game', gameSelectOptions, selectedGameId, { placeholder: 'Spiel suchen…' })}
        ${rosterPickerHtml({
          id: 'tourn-create-roster',
          players: state.players,
          selectedIds: createCheckedIds,
          query: createPlayerSearchQuery,
          searchId: 'tourn-player-search',
          itemAttribute: 'data-tourn-player-search-item',
          playerAttribute: 'data-create-player',
          emptyAttribute: 'data-tourn-player-search-empty',
          selectAllId: 'tourn-select-all',
          selectNoneId: 'tourn-select-none',
          toolbarLeadingHtml: `<div class="tournament-team-count-field">
            <label class="field-label is-required" for="tourn-teamcount">Anzahl Teams</label>
            <input type="number" id="tourn-teamcount" min="2" value="${escapeHtml(createTeamCount)}" />
          </div>`,
          renderTrailing: (player) => playerSkillHtml(player, selectedGameId),
        })}
        <div class="check-row">
          <input type="checkbox" id="tourn-avoid-adjacent" ${createAvoidAdjacent ? 'checked' : ''} />
          <span class="title-with-info tournament-option-label">
            <label for="tourn-avoid-adjacent">Sitznachbarn</label>
            ${infoTooltipHtml(
                'tournament-neighbors-help',
                'Sitznachbarn',
                'Sitznachbarn werden nach Möglichkeit in dasselbe Team gelost. Die Skill-Balance hat Vorrang, wenn beides nicht gleichzeitig möglich ist.'
              )}
          </span>
        </div>
        <div class="sticky-actions">
          <button type="button" class="btn btn-primary" id="tourn-propose">Teams auslosen</button>
        </div>

        ${teamsPreview}
      </section>

      <section class="tournament-section-panel tournament-create-step stack" aria-labelledby="tournament-mode-step-title">
        <div class="tournament-create-step-title">
          <h3 id="tournament-mode-step-title">Modus</h3>
        </div>
        <div class="title-with-info tournament-format-label">
          <label class="field-label is-required" for="tourn-format">Turnierformat</label>
          ${
            createFormat === 'group_knockout'
              ? infoTooltipHtml(
                  'tournament-group-format-help',
                  'Gruppenphase + K.O.',
                  'Die Teams spielen zuerst in Gruppen jeder gegen jeden, danach ziehen die besten Teams je Gruppe automatisch in ein K.O.-Turnier ein.'
                )
              : ''
          }
        </div>
        <select id="tourn-format">
          ${Object.entries(FORMAT_LABELS).map(([v, label]) => `<option value="${v}" ${v === createFormat ? 'selected' : ''}>${label}</option>`).join('')}
        </select>
        ${
          createFormat === 'group_knockout'
            ? `<div class="row" style="align-items:flex-start;">
                 <div style="flex:1;">
                   <label for="tourn-group-count" class="field-label is-required">Anzahl Gruppen</label>
                   <input type="number" id="tourn-group-count" min="2" value="${createGroupCount}" />
                 </div>
                 <div style="flex:1;">
                   <label for="tourn-advancers" class="field-label is-required">Aufsteiger pro Gruppe</label>
                   <input type="number" id="tourn-advancers" min="1" value="${createAdvancersPerGroup}" />
                 </div>
               </div>`
            : ''
        }
        ${
          createFormat === 'round_robin' || createFormat === 'group_knockout'
            ? `<div class="check-row">
                 <input type="checkbox" id="tourn-two-legged" ${createTwoLegged ? 'checked' : ''} />
                 <label for="tourn-two-legged">Hin- und Rückspiel${createFormat === 'group_knockout' ? ' in der Gruppenphase' : ''}</label>
               </div>`
            : ''
        }
        <div class="check-row">
          <input type="checkbox" id="tourn-track-score" ${createTrackScore ? 'checked' : ''} />
          <label for="tourn-track-score">Ergebnisse inkl. Punktestand</label>
        </div>
        <div class="field-row">
          <div>
            <div class="title-with-info tournament-field-label">
              <label for="tourn-lobby-name" class="field-label">Lobby-Basisname</label>
              ${infoTooltipHtml(
                  'tournament-lobby-help',
                  'Lobby-Basisname',
                  'Aus dem Basisnamen wird für jede gleichzeitig spielbare Paarung ein eindeutiger Lobbyname erzeugt. Das zuerst genannte Team eröffnet die Lobby.'
                )}
            </div>
            <input type="text" id="tourn-lobby-name" maxlength="60" value="${escapeHtml(createLobbyName)}" placeholder="z. B. LAN26" />
          </div>
          <div>
            <div class="tournament-field-label">
              <label for="tourn-lobby-password" class="field-label">Lobby-Passwort</label>
            </div>
            <input type="text" id="tourn-lobby-password" maxlength="60" value="${escapeHtml(createLobbyPassword)}" placeholder="z. B. zocken123" />
          </div>
        </div>
        <button type="button" class="btn btn-primary btn-block" id="tourn-submit" ${createProposedTeams ? '' : 'disabled'}>Turnier erstellen</button>
      </section>
    </div>
  `;

  wireInfoTooltips(el);
  wireRosterPicker(el, {
    id: 'tourn-create-roster',
    players: state.players,
    selectedIds: createCheckedIds,
    searchId: 'tourn-player-search',
    onQueryChange: (query) => {
      createPlayerSearchQuery = query;
    },
    onSelectionChange: ({ kind }) => {
      const hadProposal = Boolean(createProposedTeams);
      createProposedTeams = null;
      if (hadProposal || kind === 'bulk') ctx.rerender();
    },
  });

  el.querySelector('#tourn-create-close').addEventListener('click', async () => {
    const hasEnteredData = Boolean(createProposedTeams) || Boolean(createLobbyName.trim()) || Boolean(createLobbyPassword.trim());
    if (
      hasEnteredData &&
      !(await confirmDialog(
        'Die Turnier-Einrichtung geht verloren: ausgeloste Teams sowie Lobby-Name und -Passwort werden verworfen.',
        { title: 'Einrichtung verwerfen?', confirmText: 'Verwerfen', danger: true },
      ))
    )
      return;
    resetCreateForm();
    ctx.backLocal(null);
  });

  wireSearchSelect(el, 'tourn-game', gameSelectOptions);
  el.querySelector('#tourn-game').addEventListener('change', (e) => {
    state.selectedGameId = e.target.value;
    createProposedTeams = null;
    ctx.rerender();
  });

  el.querySelector('#tourn-format').addEventListener('change', (e) => {
    createFormat = e.target.value;
    ctx.rerender();
  });

  const twoLeggedCb = el.querySelector('#tourn-two-legged');
  if (twoLeggedCb) {
    twoLeggedCb.addEventListener('change', (e) => {
      createTwoLegged = e.target.checked;
    });
  }

  el.querySelector('#tourn-teamcount').addEventListener('input', (e) => {
    createTeamCount = e.target.value;
  });

  el.querySelector('#tourn-avoid-adjacent').addEventListener('change', (e) => {
    createAvoidAdjacent = e.target.checked;
  });

  el.querySelector('#tourn-track-score').addEventListener('change', (e) => {
    createTrackScore = e.target.checked;
  });

  el.querySelector('#tourn-lobby-name').addEventListener('input', (e) => {
    createLobbyName = e.target.value;
  });
  el.querySelector('#tourn-lobby-password').addEventListener('input', (e) => {
    createLobbyPassword = e.target.value;
  });

  const groupCountInput = el.querySelector('#tourn-group-count');
  if (groupCountInput) {
    groupCountInput.addEventListener('input', (e) => {
      createGroupCount = parseInt(e.target.value, 10) || 2;
    });
  }
  const advancersInput = el.querySelector('#tourn-advancers');
  if (advancersInput) {
    advancersInput.addEventListener('input', (e) => {
      createAdvancersPerGroup = parseInt(e.target.value, 10) || 1;
    });
  }

  async function proposeTeams() {
    const gameId = createFormGameId();
    const playerIds = [...createCheckedIds];
    if (playerIds.length < 2) {
      return showToast('Mindestens 2 Spieler auswählen.', { error: true });
    }
    const body = { gameId, playerIds, avoidAdjacentOpponents: createAvoidAdjacent };
    if (createTeamCount) body.teamCount = parseInt(createTeamCount, 10);
    try {
      const result = await api.matchmaking.generate(body);
      createProposedTeams = result.teams.map((t, i) => ({
        name: `Team ${i + 1}`,
        players: t.players,
        playerIds: t.players.map((p) => p.id),
        totalRating: t.totalRating,
      }));
      createSelectedPlayerId = null;
      createAvoidPairs = result.avoidPairs ?? [];
      createSeatConflicts = result.seatPairsConsidered
        ? { conflicts: result.seatConflicts, considered: result.seatPairsConsidered }
        : null;
      ctx.rerender();
    } catch (err) {
      showToast(err.message, { error: true });
    }
  }

  el.querySelector('#tourn-propose').addEventListener('click', proposeTeams);

  el.querySelectorAll('[data-team-name]').forEach((input) => {
    input.addEventListener('input', () => {
      createProposedTeams[parseInt(input.dataset.teamName, 10)].name = input.value;
    });
  });

  // Proposed teams only exist client-side until the tournament is created.
  // Pointer drag/drop, touch selection and keyboard arrows all share this
  // guarded mutation so no interaction path can leave an empty team behind.
  function moveDraftPlayer(playerId, toIndex) {
    const result = moveTournamentDraftPlayer(createProposedTeams, playerId, toIndex);
    if (result.error) {
      createSelectedPlayerId = null;
      showToast(result.error, { error: true });
      ctx.rerender();
      return false;
    }
    if (!result.moved) return false;
    createSelectedPlayerId = null;
    recomputeSeatConflicts();
    ctx.rerender();
    return true;
  }

  let draggedPlayerId = null;
  const clearDragState = () => {
    el.querySelectorAll('.is-drag-target, .is-dragging').forEach((element) => {
      element.classList.remove('is-drag-target', 'is-dragging');
    });
    draggedPlayerId = null;
  };

  el.querySelectorAll('[data-tourn-drag-player]').forEach((playerRow) => {
    playerRow.addEventListener('dragstart', (event) => {
      createSelectedPlayerId = null;
      draggedPlayerId = playerRow.dataset.tournDragPlayer;
      playerRow.classList.add('is-dragging');
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', draggedPlayerId);
    });
    playerRow.addEventListener('dragend', clearDragState);
    playerRow.addEventListener('click', (event) => {
      event.stopPropagation();
      createSelectedPlayerId = createSelectedPlayerId === playerRow.dataset.tournDragPlayer
        ? null
        : playerRow.dataset.tournDragPlayer;
      ctx.rerender();
    });
    playerRow.addEventListener('keydown', (event) => {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      event.preventDefault();
      const currentIndex = Number(playerRow.dataset.teamIndex);
      const direction = event.key === 'ArrowLeft' ? -1 : 1;
      const toIndex = (currentIndex + direction + createProposedTeams.length) % createProposedTeams.length;
      moveDraftPlayer(playerRow.dataset.tournDragPlayer, toIndex);
    });
  });

  el.querySelectorAll('[data-tourn-drop-team]').forEach((teamCard) => {
    const toIndex = Number(teamCard.dataset.tournDropTeam);
    teamCard.addEventListener('dragover', (event) => {
      if (!draggedPlayerId) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';
      teamCard.classList.add('is-drag-target');
    });
    teamCard.addEventListener('dragleave', (event) => {
      if (event.relatedTarget && teamCard.contains(event.relatedTarget)) return;
      teamCard.classList.remove('is-drag-target');
    });
    teamCard.addEventListener('drop', (event) => {
      event.preventDefault();
      const playerId = draggedPlayerId || event.dataTransfer.getData('text/plain');
      clearDragState();
      if (playerId) moveDraftPlayer(playerId, toIndex);
    });
    teamCard.addEventListener('click', (event) => {
      if (!createSelectedPlayerId || event.target.closest('input, [data-tourn-drag-player]')) return;
      moveDraftPlayer(createSelectedPlayerId, toIndex);
    });
  });

  const submitBtn = el.querySelector('#tourn-submit');
  if (submitBtn) {
    submitBtn.addEventListener('click', async () => {
      if (!createProposedTeams) return;
      const gameId = createFormGameId();
      try {
        const created = await api.tournaments.create({
          gameId,
          format: createFormat,
          twoLegged: createFormat === 'round_robin' || createFormat === 'group_knockout' ? createTwoLegged : false,
          trackScore: createTrackScore,
          ...(createFormat === 'group_knockout'
            ? { groupCount: createGroupCount, advancersPerGroup: createAdvancersPerGroup }
            : {}),
          ...(createLobbyName.trim() ? { lobbyName: createLobbyName.trim() } : {}),
          ...(createLobbyPassword.trim() ? { lobbyPassword: createLobbyPassword.trim() } : {}),
          teams: createProposedTeams.map((t) => ({ name: t.name, playerIds: t.playerIds })),
        });
        resetCreateForm();
        currentTournamentId = created.id;
        detailCache = created;
        detailForId = created.id;
        listStale = true;
        showToast('Turnier erstellt.');
        ctx.navigateLocal({ kind: 'detail', id: created.id }, { replace: true });
      } catch (err) {
        showToast(err.message, { error: true });
      }
    });
  }
}

function renderDetail(container, ctx) {
  if ((detailForId !== currentTournamentId || detailStale) && !detailLoading) {
    loadDetail(currentTournamentId, ctx);
  }
  if (detailForId !== currentTournamentId || !detailCache) {
    container.innerHTML = `
      ${backButtonHtml({ id: 'tourn-back' })}
      ${emptyStateHtml('Lädt…')}`;
    container.querySelector('#tourn-back').addEventListener('click', () => {
      ctx.backLocal(null);
    });
    return;
  }

  const t = detailCache;
  const {
    renderActiveLobbies,
    renderBracket,
    renderGroupKnockout,
    renderRoundRobin,
    renderTournamentTeams,
  } = createTournamentPresentation({ editingResultMatchId });
  const boardContent =
    t.format === 'single_elimination'
      ? renderBracket(t)
      : t.format === 'group_knockout'
        ? renderGroupKnockout(t)
        : renderRoundRobin(t);
  const board =
    t.format === 'single_elimination'
      ? `<div class="section-title">Turnierbaum</div><div class="card tournament-board-panel">${boardContent}</div>`
      : boardContent;

  const decidedMatches = t.matches.filter((match) => match.winnerTeamId !== null || match.isDraw).length;
  const participantCount = t.teams.reduce((sum, team) => sum + team.players.length, 0);

  const formatMeta = [
    t.twoLegged ? 'Hin- und Rückspiele' : null,
    t.format === 'group_knockout' ? `${t.groupCount} Gruppen · Top ${t.advancersPerGroup} steigen auf` : null,
    t.trackScore ? 'Punktestand' : null,
  ]
    .filter(Boolean)
    .join(' · ');
  const formatExplanation = `${FORMAT_LABELS[t.format]}${formatMeta ? ` · ${formatMeta}` : ''}`;
  const compactFormatLabel =
    t.format === 'round_robin' || t.format === 'group_knockout' ? SHORT_FORMAT_LABELS[t.format] : null;
  const formatDisplay = compactFormatLabel
    ? `<span class="title-with-info tournament-detail-format">
         <span>${compactFormatLabel}</span>
         ${infoTooltipHtml(
             `tournament-detail-format-${t.id}`,
             compactFormatLabel,
             formatExplanation
           )}
       </span>`
    : `<span>${formatExplanation}</span>`;

  const activeLobbies = renderActiveLobbies(t);

  container.innerHTML = `
    <div class="row-between">
      ${backButtonHtml({ id: 'tourn-back' })}
      <button type="button" class="btn btn-sm btn-danger" id="tourn-delete">Löschen</button>
    </div>
    <h2 class="view-title">${escapeHtml(t.name)}</h2>
    <div class="muted tournament-detail-meta">
      ${formatDisplay}
      <span class="badge ${t.status === 'completed' ? 'badge-offline' : 'badge-playing'}">${t.status === 'completed' ? 'Beendet' : 'Läuft'}</span>
    </div>
    ${activeLobbies}
    <div class="section-title">Turnierstatus</div>
    <div class="tournament-detail-stats" aria-label="Turnierstatus">
      <div class="card tournament-stat"><span class="muted">Teams</span><strong>${t.teams.length}</strong></div>
      <div class="card tournament-stat"><span class="muted">Teilnehmende</span><strong>${participantCount}</strong></div>
      <div class="card tournament-stat"><span class="muted">Partien entschieden</span><strong>${decidedMatches} / ${t.matches.length}</strong></div>
    </div>
    ${renderTournamentTeams(t)}
    ${board}
  `;

  wireInfoTooltips(container);

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

  container.querySelector('#tourn-back').addEventListener('click', () => {
    ctx.backLocal(null);
  });

  container.querySelector('#tourn-delete').addEventListener('click', async () => {
    if (!(await confirmDialog(`Turnier "${t.name}" wirklich löschen?`, { confirmText: 'Löschen', danger: true }))) return;
    try {
      const removed = await withStepUp(() => api.tournaments.remove(t.id));
      if (removed === undefined) return;
      currentTournamentId = null;
      editingResultMatchId = null;
      if (listCache) listCache = listCache.filter((entry) => entry.id !== t.id);
      listStale = true;
      showToast('Turnier gelöscht.');
      ctx.navigateLocal(null, { replace: true });
    } catch (err) {
      showToast(err.message, { error: true });
    }
  });

  container.querySelectorAll('[data-match]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const winnerTeamId = btn.dataset.winner || null;
      const match = t.matches.find((candidate) => candidate.id === btn.dataset.match);
      try {
        detailCache = btn.dataset.updateResult
          ? await api.tournaments.updateResult(t.id, btn.dataset.match, {
              winnerTeamId,
              expectedPlayedAt: match?.playedAt,
            })
          : await api.tournaments.recordResult(t.id, btn.dataset.match, { winnerTeamId });
        editingResultMatchId = null;
        ctx.rerender();
      } catch (err) {
        showToast(err.message, { error: true });
      }
    });
  });

  container.querySelectorAll('[data-submit-score]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const matchId = btn.dataset.submitScore;
      const inputA = container.querySelector(`[data-score-a="${matchId}"]`);
      const inputB = container.querySelector(`[data-score-b="${matchId}"]`);
      const scoreA = parseInt(inputA.value, 10);
      const scoreB = parseInt(inputB.value, 10);
      if (!Number.isInteger(scoreA) || !Number.isInteger(scoreB) || scoreA < 0 || scoreB < 0) {
        return showToast('Bitte beide Ergebnisse eintragen.', { error: true });
      }
      try {
        const match = t.matches.find((candidate) => candidate.id === matchId);
        detailCache = btn.dataset.updateResult
          ? await api.tournaments.updateResult(t.id, matchId, {
              scoreA,
              scoreB,
              expectedPlayedAt: match?.playedAt,
            })
          : await api.tournaments.recordResult(t.id, matchId, { scoreA, scoreB });
        editingResultMatchId = null;
        ctx.rerender();
      } catch (err) {
        showToast(err.message, { error: true });
      }
    });
  });

  container.querySelectorAll('[data-edit-result]').forEach((btn) => {
    btn.addEventListener('click', () => {
      editingResultMatchId = btn.dataset.editResult;
      ctx.rerender();
    });
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
