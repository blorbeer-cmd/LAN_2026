// Tournament view (FR-33): pick a game + teams, get an automatically
// generated single-elimination bracket ("Turnierbaum") or round-robin
// league ("jeder gegen jeden", optionally Hin- und Rückspiele), then record
// results as they happen. Team formation reuses the same skill-balancing as
// "Teams auslosen" (api.matchmaking.generate) rather than reinventing it.

import { api } from '../api.js';
import { confirmDialog } from '../modal.js';
import { state, gameById } from '../state.js';
import { escapeHtml, avatarHtml, gameBadgeHtml, seatConflictIconHtml } from '../format.js';
import { showToast } from '../toast.js';
import { icon } from '../icons.js';
import { infoTooltipHtml, wireInfoTooltips } from '../infoTooltip.js';
import { domainIcon } from '../domainIcons.js';
import { moveTournamentDraftPlayer } from '../tournamentTeamDraft.js';
import { selectActiveLobbyMatches } from '../tournamentLobbies.js';
import { playerSkillHtml } from '../skillDisplay.js';

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
let completedSectionOpen = false;

let currentTournamentId = null; // null = list/create view
let detailCache = null;
let detailLoading = false;
let detailForId = null;
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
  listLoading = true;
  try {
    listCache = await api.tournaments.list();
  } catch (err) {
    showToast(err.message, { error: true });
    listCache = [];
  } finally {
    listLoading = false;
    ctx.rerender();
  }
}

async function loadDetail(id, ctx) {
  detailLoading = true;
  try {
    detailCache = await api.tournaments.get(id);
    detailForId = id;
  } catch (err) {
    showToast(err.message, { error: true });
    detailCache = null;
    detailForId = id;
  } finally {
    detailLoading = false;
    ctx.rerender();
  }
}

// Called from app.js on every tournaments:changed socket event, so this
// view's data is never more than one re-render stale.
export function invalidateTournaments() {
  listCache = null;
  detailForId = null;
}

// Called from app.js when a player taps a tournament notification toast, so
// switching to the Turniere tab lands directly on that tournament's board
// instead of the list.
export function focusTournament(id) {
  currentTournamentId = id;
  detailForId = null;
  editingResultMatchId = null;
}

export function showTournamentLanding() {
  currentTournamentId = null;
  detailCache = null;
  detailForId = null;
  editingResultMatchId = null;
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
}

// ---------- list + create ----------

function renderList(container, ctx) {
  if (listCache === null && !listLoading) loadList(ctx);

  const tournamentCards = (tournaments) => `<div class="card-grid tournament-list-grid">${tournaments
    .map(
      (t) => `
      <button type="button" class="card tournament-list-card" data-open-tournament="${t.id}">
        ${gameBadgeHtml({ id: t.gameId, icon: t.gameIcon }, 44)}
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
  if (listLoading || listCache === null) {
    currentListHtml = `<div class="empty-state">Lädt…</div>`;
  } else if (listCache.length === 0) {
    currentListHtml = `<div class="empty-state"><span class="empty-state-icon">${icon(domainIcon('tournaments'))}</span><br />Noch keine Turniere.</div>`;
  } else {
    const activeTournaments = listCache.filter((t) => t.status !== 'completed');
    const completedTournaments = listCache.filter((t) => t.status === 'completed');
    currentListHtml = tournamentSection('Aktuelle Turniere', activeTournaments, { active: true });
    completedListHtml = tournamentSection('Abgeschlossene Turniere', completedTournaments, { collapsible: true });
  }

  container.innerHTML = `
    <div class="row-between">
      <h1 class="view-title">Turniere</h1>
      <button type="button" class="btn btn-primary btn-sm" id="tourn-new-btn">Turnier anlegen</button>
    </div>
    ${currentListHtml}
    <div id="tourn-create" class="tournament-create-slot"></div>
    ${completedListHtml}
  `;

  container.querySelector('#tourn-new-btn').addEventListener('click', () => {
    createOpen = true;
    ctx.rerender();
  });

  container.querySelectorAll('[data-open-tournament]').forEach((btn) => {
    btn.addEventListener('click', () => {
      currentTournamentId = btn.dataset.openTournament;
      ctx.rerender();
    });
  });

  const completedSection = container.querySelector('[data-completed-tournaments]');
  completedSection?.addEventListener('toggle', () => {
    completedSectionOpen = completedSection.open;
  });

  if (createOpen) {
    renderCreateForm(container.querySelector('#tourn-create'), ctx);
  }
}

function renderCreateForm(el, ctx) {
  if (state.games.length === 0 || state.players.length < 2) {
    el.innerHTML = `<div class="empty-state" style="padding:var(--space-4);">Dafür braucht es mindestens ein Spiel und 2 Spieler.</div>`;
    return;
  }

  if (createCheckedIds === null) {
    createCheckedIds = new Set(state.live.filter((p) => p.state === 'playing').map((p) => p.player_id));
    if (createCheckedIds.size === 0) createCheckedIds = new Set(state.players.map((p) => p.id));
  }

  const selectedGameId = state.games.some((game) => game.id === state.selectedGameId)
    ? state.selectedGameId
    : state.games[0].id;
  state.selectedGameId = selectedGameId;

  const gameOptions = state.games
    .map((g) => `<option value="${g.id}" ${g.id === selectedGameId ? 'selected' : ''}>${escapeHtml(g.icon)} ${escapeHtml(g.name)}</option>`)
    .join('');

  const playerRows = state.players
    .map(
      (p) => `
      <label class="check-row">
        <input type="checkbox" data-create-player="${p.id}" ${createCheckedIds.has(p.id) ? 'checked' : ''} />
        ${avatarHtml(p, 20)}
        <span class="player-name" style="flex:1;">${escapeHtml(p.name)}</span>
        ${playerSkillHtml(p.id, selectedGameId)}
      </label>`
    )
    .join('');

  const seatingNote =
    createSeatConflicts && createSeatConflicts.considered
      ? createSeatConflicts.conflicts > 0
        ? `<div class="muted" style="font-size:var(--font-size-xs);">${icon('armchair')} ${createSeatConflicts.conflicts} von ${createSeatConflicts.considered} Sitznachbarschaft(en) mussten trotzdem gegeneinander antreten (sonst wäre es zu unfair geworden).</div>`
        : `<div class="muted" style="font-size:var(--font-size-xs);">${icon('armchair')} Alle Sitznachbarn sind im selben Team.</div>`
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
            <input type="text" data-team-name="${i}" value="${escapeHtml(t.name)}" maxlength="60" style="margin-bottom:var(--space-1);font-weight:var(--font-weight-bold);" />
            <div class="muted" style="font-size:var(--font-size-xs);margin-bottom:var(--space-2);">Score ${t.totalRating}</div>
            ${t.players
              .map(
                (p) => `
              <button type="button" class="team-player tournament-drag-player${createSelectedPlayerId === p.id ? ' is-selected' : ''}" draggable="true" data-tourn-drag-player="${p.id}" data-team-index="${i}" aria-pressed="${createSelectedPlayerId === p.id}" aria-label="${escapeHtml(p.name)} verschieben">
                ${avatarHtml(p, 18)}
                <span class="player-name team-player-name" style="flex:1;">${escapeHtml(p.name)}</span>
                ${seatConflictIconHtml(p)}
                ${playerSkillHtml(p.id, selectedGameId)}
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
          <span class="muted">Teams zusammenstellen</span>
        </div>
        <label class="field-label" for="tourn-game">Spiel auswählen</label>
        <select id="tourn-game">${gameOptions}</select>
        <div class="selection-toolbar">
          <div class="tournament-team-count-field">
            <label class="field-label" for="tourn-teamcount">Anzahl Teams</label>
            <input type="number" id="tourn-teamcount" min="2" value="${escapeHtml(createTeamCount)}" />
          </div>
          <button type="button" class="btn btn-sm" id="tourn-select-all">Alle markieren</button>
          <button type="button" class="btn btn-sm" id="tourn-select-none">Auswahl aufheben</button>
        </div>
        <div class="player-selection-grid tournament-player-grid">${playerRows}</div>
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
        <button type="button" class="btn btn-primary" id="tourn-propose">Teams auslosen</button>

        ${teamsPreview}
      </section>

      <section class="tournament-section-panel tournament-create-step stack" aria-labelledby="tournament-mode-step-title">
        <div class="tournament-create-step-title">
          <h3 id="tournament-mode-step-title">Modus</h3>
          <span class="muted">Ablauf festlegen</span>
        </div>
        <div class="title-with-info tournament-format-label">
          <label class="field-label" for="tourn-format">Turnierformat</label>
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
                   <label for="tourn-group-count" class="field-label">Anzahl Gruppen</label>
                   <input type="number" id="tourn-group-count" min="2" value="${createGroupCount}" />
                 </div>
                 <div style="flex:1;">
                   <label for="tourn-advancers" class="field-label">Aufsteiger pro Gruppe</label>
                   <input type="number" id="tourn-advancers" min="1" value="${createAdvancersPerGroup}" />
                 </div>
               </div>`
            : ''
        }
        ${
          createFormat === 'round_robin' || createFormat === 'group_knockout'
            ? `<div class="check-row">
                 <input type="checkbox" id="tourn-two-legged" ${createTwoLegged ? 'checked' : ''} />
                 <span class="title-with-info tournament-option-label">
                   <label for="tourn-two-legged">Hin- und Rückspiel${createFormat === 'group_knockout' ? ' in der Gruppenphase' : ''}</label>
                   ${infoTooltipHtml(
                       'tournament-two-legged-help',
                       'Hin- und Rückspiel',
                       'Jede Paarung wird zweimal gespielt.'
                     )}
                 </span>
               </div>`
            : ''
        }
        <div class="check-row">
          <input type="checkbox" id="tourn-track-score" ${createTrackScore ? 'checked' : ''} />
          <span class="title-with-info tournament-option-label">
            <label for="tourn-track-score">Ergebnisse inkl. Punktestand</label>
            ${infoTooltipHtml(
                'tournament-score-help',
                'Ergebnisse inklusive Punktestand',
                'Erfasst den genauen Punktestand statt nur Sieg oder Niederlage.'
              )}
          </span>
        </div>
        <div class="field-row">
          <div>
            <div class="title-with-info tournament-field-label">
              <label for="tourn-lobby-name" class="field-label">Lobby-Basisname (optional)</label>
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
              <label for="tourn-lobby-password" class="field-label">Lobby-Passwort (optional)</label>
            </div>
            <input type="text" id="tourn-lobby-password" maxlength="60" value="${escapeHtml(createLobbyPassword)}" placeholder="z. B. zocken123" />
          </div>
        </div>
        <button type="button" class="btn btn-primary btn-block" id="tourn-submit" ${createProposedTeams ? '' : 'disabled'}>Turnier erstellen</button>
      </section>
    </div>
  `;

  wireInfoTooltips(el);

  el.querySelector('#tourn-create-close').addEventListener('click', () => {
    resetCreateForm();
    ctx.rerender();
  });

  el.querySelector('#tourn-game').addEventListener('change', (e) => {
    state.selectedGameId = e.target.value;
    createProposedTeams = null;
    ctx.rerender();
  });

  el.querySelectorAll('[data-create-player]').forEach((cb) => {
    cb.addEventListener('change', () => {
      if (cb.checked) createCheckedIds.add(cb.dataset.createPlayer);
      else createCheckedIds.delete(cb.dataset.createPlayer);
      createProposedTeams = null;
    });
  });

  el.querySelector('#tourn-select-all').addEventListener('click', () => {
    createCheckedIds = new Set(state.players.map((player) => player.id));
    createProposedTeams = null;
    ctx.rerender();
  });
  el.querySelector('#tourn-select-none').addEventListener('click', () => {
    createCheckedIds.clear();
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
    const gameId = state.selectedGameId || state.games[0].id;
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
      const gameId = state.selectedGameId || state.games[0].id;
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
        listCache = null;
        showToast('Turnier erstellt.');
        ctx.rerender();
      } catch (err) {
        showToast(err.message, { error: true });
      }
    });
  }
}

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
    (candidate) => tournament.format === 'single_elimination' || candidate.stage === 'knockout'
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
          'Jede gleichzeitig spielbare Paarung erhält eine eigene Lobby. Das zuerst genannte Team eröffnet sie.'
        )}
    </div>
    <div class="tournament-active-lobby-grid">${cards}</div>`;
}

async function copyTournamentText(value) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      return;
    }
  } catch {
    // Browsers can expose Clipboard but still reject it on an HTTP LAN URL.
    // Fall through to the selection-based copy path below.
  }

  const field = document.createElement('textarea');
  field.value = value;
  field.setAttribute('readonly', '');
  field.style.position = 'fixed';
  field.style.inset = '0';
  field.style.opacity = '0';
  document.body.appendChild(field);
  field.select();
  field.setSelectionRange(0, value.length);
  const copied = document.execCommand('copy');
  field.remove();
  if (!copied) throw new Error('Copy failed');
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
function renderBracket(t, ctx, matches = t.matches) {
  const teamsById = new Map(t.teams.map((team) => [team.id, team]));
  const totalRounds = Math.max(...matches.map((m) => m.round));
  const matchesByKey = new Map(matches.map((m) => [`${m.round}:${m.slot}`, m]));

  const titles = Array.from({ length: totalRounds }, (_, i) => `<div>${bracketRoundLabel(i + 1, totalRounds)}</div>`).join('');
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
            const resultText = m.isDraw ? `Unentschieden${scoreText}` : aWon ? `${nameA} gewinnt${scoreText}` : bWon ? `${nameB} gewinnt${scoreText}` : '–';
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
      </div>`
    )
    .join('');

  return `
    <div class="section-title">Tabelle</div>
    <div class="card">${standingsRows}</div>
    ${fixturesHtml}
  `;
}

function renderRoundRobin(t, ctx) {
  const teamsById = new Map(t.teams.map((team) => [team.id, team]));
  return renderRoundRobinBoard(t, teamsById, t.matches, t.standings, { accentRounds: true });
}

// ---------- detail: group stage + knockout ----------

function renderGroupKnockout(t, ctx) {
  const teamsById = new Map(t.teams.map((team) => [team.id, team]));

  const groupBlocks = (t.groups || [])
    .map((g) => {
      const groupMatches = t.matches.filter((m) => m.stage === 'group' && m.groupIndex === g.groupIndex);
      return `
        <section class="tournament-section-panel tournament-group-panel stack" aria-labelledby="tournament-group-${g.groupIndex}">
          <div class="tournament-create-step-title">
            <h3 id="tournament-group-${g.groupIndex}">Gruppe ${g.groupIndex + 1}</h3>
            <span class="muted">Tabelle und Spielrunden</span>
          </div>
          ${renderRoundRobinBoard(t, teamsById, groupMatches, g.standings)}
        </section>`;
    })
    .join('');

  const knockoutMatches = t.matches.filter((m) => m.stage === 'knockout');
  const knockoutHtml =
    knockoutMatches.length === 0
      ? `<section class="tournament-section-panel tournament-group-panel stack">
           <div class="tournament-create-step-title"><h3>K.O.-Runde</h3><span class="muted">Entscheidungsphase</span></div>
           <div class="empty-state">Startet automatisch, sobald alle Gruppenspiele entschieden sind.</div>
         </section>`
      : `<section class="tournament-section-panel tournament-group-panel stack">
           <div class="tournament-create-step-title"><h3>K.O.-Runde</h3><span class="muted">Entscheidungsphase</span></div>
           ${renderBracket(t, ctx, knockoutMatches)}
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
          <span class="muted">${team.players.length} Spieler</span>
        </div>
        ${
          team.players.length
            ? team.players
                .map(
                  (player) => `
                  <div class="team-player">
                    ${avatarHtml(player, 24)}
                    <span class="player-name team-player-name" style="flex:1;">${escapeHtml(player.name)}</span>
                    ${playerSkillHtml(player.id, t.gameId)}
                  </div>`
                )
                .join('')
            : '<div class="muted">Keine aktiven Spieler</div>'
        }
      </div>`
    )
    .join('');

  return `<div class="section-title">Teams & Teilnehmer</div><div class="tournament-team-grid">${cards}</div>`;
}

function renderDetail(container, ctx) {
  if (detailForId !== currentTournamentId && !detailLoading) {
    loadDetail(currentTournamentId, ctx);
  }
  if (detailLoading || !detailCache) {
    container.innerHTML = `
      <button type="button" class="btn btn-sm" id="tourn-back">‹ Zurück</button>
      <div class="empty-state">Lädt…</div>`;
    container.querySelector('#tourn-back').addEventListener('click', () => {
      currentTournamentId = null;
      editingResultMatchId = null;
      ctx.rerender();
    });
    return;
  }

  const t = detailCache;
  const boardContent =
    t.format === 'single_elimination'
      ? renderBracket(t, ctx)
      : t.format === 'group_knockout'
        ? renderGroupKnockout(t, ctx)
        : renderRoundRobin(t, ctx);
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
      <button type="button" class="btn btn-sm" id="tourn-back">‹ Zurück</button>
      <button type="button" class="btn btn-sm btn-danger" id="tourn-delete">Löschen</button>
    </div>
    <h1 class="view-title row" style="gap:var(--space-2);">${gameBadgeHtml({ id: t.gameId, icon: t.gameIcon }, 26)} ${escapeHtml(t.name)}</h1>
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
        await copyTournamentText(value);
        showToast(isPassword ? 'Passwort kopiert.' : 'Lobbyname kopiert.');
      } catch {
        showToast('Kopieren nicht möglich – bitte manuell markieren.', { error: true });
      }
    });
  });

  container.querySelector('#tourn-back').addEventListener('click', () => {
    currentTournamentId = null;
    editingResultMatchId = null;
    ctx.rerender();
  });

  container.querySelector('#tourn-delete').addEventListener('click', async () => {
    if (!(await confirmDialog(`Turnier "${t.name}" wirklich löschen?`))) return;
    try {
      await api.tournaments.remove(t.id);
      currentTournamentId = null;
      editingResultMatchId = null;
      listCache = null;
      showToast('Turnier gelöscht.');
      ctx.rerender();
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
  if (currentTournamentId) {
    renderDetail(container, ctx);
  } else {
    renderList(container, ctx);
  }
}
