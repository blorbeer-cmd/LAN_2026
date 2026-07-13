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

const FORMAT_LABELS = {
  single_elimination: 'K.O.-Turnier',
  round_robin: 'Liga (jeder gegen jeden)',
  group_knockout: 'Gruppenphase + K.O.',
};

// ---------- module state ----------

let listCache = null;
let listLoading = false;

let currentTournamentId = null; // null = list/create view
let detailCache = null;
let detailLoading = false;
let detailForId = null;

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
  createSeatConflicts = null;
  createAvoidPairs = [];
}

// ---------- list + create ----------

function renderList(container, ctx) {
  if (listCache === null && !listLoading) loadList(ctx);

  const listHtml =
    listLoading || listCache === null
      ? `<div class="empty-state">Lädt…</div>`
      : listCache.length === 0
        ? `<div class="empty-state"><span class="empty-state-icon">${icon('swords')}</span><br />Noch keine Turniere.</div>`
        : `<div class="card-grid">${listCache
            .map(
              (t) => `
            <button type="button" class="card row list-row" data-open-tournament="${t.id}">
              ${gameBadgeHtml({ id: t.gameId, icon: t.gameIcon }, 36)}
              <span style="flex:1;">
                <div class="player-name">${escapeHtml(t.name)}</div>
                <div class="muted" style="font-size:var(--font-size-xs);">${FORMAT_LABELS[t.format]} · ${t.teamCount} Teams</div>
              </span>
              <span class="badge ${t.status === 'completed' ? 'badge-offline' : 'badge-playing'}">${t.status === 'completed' ? 'Beendet' : 'Läuft'}</span>
            </button>`
            )
            .join('')}</div>`;

  container.innerHTML = `
    <div class="row-between">
      <h1 class="view-title">${icon('swords')} Turniere</h1>
      <button type="button" class="btn btn-primary btn-sm" id="tourn-new-btn">+ Turnier</button>
    </div>
    <div id="tourn-create"></div>
    ${listHtml}
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

  const selectedGameId = state.selectedGameId || state.games[0].id;

  const gameOptions = state.games
    .map((g) => `<option value="${g.id}" ${g.id === selectedGameId ? 'selected' : ''}>${escapeHtml(g.icon)} ${escapeHtml(g.name)}</option>`)
    .join('');

  const playerRows = state.players
    .map(
      (p) => `
      <label class="check-row">
        <input type="checkbox" data-create-player="${p.id}" ${createCheckedIds.has(p.id) ? 'checked' : ''} />
        ${avatarHtml(p, 20)}
        <span style="flex:1;">${escapeHtml(p.name)}</span>
      </label>`
    )
    .join('');

  const seatingNote =
    createSeatConflicts && createSeatConflicts.considered
      ? createSeatConflicts.conflicts > 0
        ? `<div class="muted" style="font-size:var(--font-size-xs);">${icon('armchair')} ${createSeatConflicts.conflicts} von ${createSeatConflicts.considered} Sitznachbarschaft(en) mussten trotzdem gegeneinander antreten (sonst wäre es zu unfair geworden).</div>`
        : `<div class="muted" style="font-size:var(--font-size-xs);">${icon('armchair')} Alle Sitznachbarn sind im selben Team.</div>`
      : '';

  const teamsPreview = createProposedTeams
    ? `
      <div class="section-title">Teams (Namen anpassbar)</div>
      <div class="grid" style="grid-template-columns:repeat(auto-fit, minmax(150px, 1fr));">
        ${createProposedTeams
          .map(
            (t, i) => `
          <div class="team-card">
            <input type="text" data-team-name="${i}" value="${escapeHtml(t.name)}" maxlength="60" style="margin-bottom:var(--space-1);font-weight:var(--font-weight-bold);" />
            <div class="muted" style="font-size:var(--font-size-xs);margin-bottom:var(--space-2);">Score ${t.totalRating}</div>
            ${t.players
              .map(
                (p) => `
              <div class="team-player">
                ${avatarHtml(p, 18)}
                <span style="flex:1;">${escapeHtml(p.name)}</span>
                ${seatConflictIconHtml(p)}
                ${
                  createProposedTeams.length > 1
                    ? `<select class="team-move-select" data-tourn-move-player="${p.id}" aria-label="Team ändern">
                        ${createProposedTeams.map((_, ti) => `<option value="${ti}" ${ti === i ? 'selected' : ''}>Team ${ti + 1}</option>`).join('')}
                      </select>`
                    : ''
                }
              </div>`
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
    <div class="card stack" style="margin-bottom:var(--space-4);">
      <div class="row-between">
        <div class="section-title" style="margin:0;">Neues Turnier</div>
        <button type="button" class="icon-btn" id="tourn-create-close" aria-label="Schließen">✕</button>
      </div>
      <select id="tourn-game">${gameOptions}</select>
      <div>${playerRows}</div>
      <input type="number" id="tourn-teamcount" placeholder="Anzahl Teams" min="2" value="${escapeHtml(createTeamCount)}" style="width:140px;" />
      <label class="check-row">
        <input type="checkbox" id="tourn-avoid-adjacent" ${createAvoidAdjacent ? 'checked' : ''} />
        <span>${icon('armchair')} Sitznachbarn bevorzugt ins selbe Team losen</span>
      </label>
      <button type="button" class="btn btn-primary" id="tourn-propose">Teams auslosen</button>

      ${teamsPreview}

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
             </div>
             <p class="muted" style="font-size:var(--font-size-xs);margin-top:calc(var(--space-2) * -1);">
               Die Teams spielen zuerst in Gruppen jeder gegen jeden, danach ziehen die besten
               Teams je Gruppe automatisch in ein K.O.-Turnier ein.
             </p>`
          : ''
      }
      ${
        createFormat === 'round_robin' || createFormat === 'group_knockout'
          ? `<label class="check-row">
               <input type="checkbox" id="tourn-two-legged" ${createTwoLegged ? 'checked' : ''} />
               <span>🔁 Hin- und Rückspiele${createFormat === 'group_knockout' ? ' (in der Gruppenphase)' : ' (jeder spielt zweimal gegen jeden)'}</span>
             </label>`
          : ''
      }
      <label class="check-row">
        <input type="checkbox" id="tourn-track-score" ${createTrackScore ? 'checked' : ''} />
        <span>🔢 Ergebnisse mit Punktestand erfassen (statt nur Sieg/Niederlage)</span>
      </label>
      <div class="row" style="align-items:flex-start;">
        <div style="flex:1;">
          <label for="tourn-lobby-name" class="field-label">Lobby-Name (optional)</label>
          <input type="text" id="tourn-lobby-name" maxlength="60" value="${escapeHtml(createLobbyName)}" placeholder="z. B. LAN2026" />
        </div>
        <div style="flex:1;">
          <label for="tourn-lobby-password" class="field-label">Lobby-Passwort (optional)</label>
          <input type="text" id="tourn-lobby-password" maxlength="60" value="${escapeHtml(createLobbyPassword)}" placeholder="z. B. zocken123" />
        </div>
      </div>
      <p class="muted" style="font-size:0.78rem;margin-top:-6px;">
        Wird bei jeder Paarung mitgeschickt — das obere Team im Turnierbaum eröffnet standardmäßig die Lobby.
      </p>
      <button type="button" class="btn btn-primary btn-block" id="tourn-submit" ${createProposedTeams ? '' : 'disabled'}>Turnier erstellen</button>
    </div>
  `;

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
    const gameId = el.querySelector('#tourn-game').value;
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

  // Feinschliff, same as Team-Historie's move select in matchmaking.js —
  // these teams aren't persisted yet (only "Turnier erstellen" writes them),
  // so this is a plain client-side reassignment, no API call needed.
  el.querySelectorAll('[data-tourn-move-player]').forEach((sel) => {
    sel.addEventListener('change', () => {
      const playerId = sel.dataset.tournMovePlayer;
      const toIndex = parseInt(sel.value, 10);
      const fromIndex = createProposedTeams.findIndex((t) => t.players.some((p) => p.id === playerId));
      if (fromIndex === -1 || fromIndex === toIndex) return;

      const fromTeam = createProposedTeams[fromIndex];
      // A team hitting zero players here would let a tournament get created
      // with an empty team (the format generators/bracket assume every team
      // has at least one player) — block the move and reset the dropdown.
      if (fromTeam.players.length <= 1) {
        showToast('Ein Team kann nicht komplett leer werden.', { error: true });
        sel.value = String(fromIndex);
        return;
      }

      const [player] = fromTeam.players.splice(
        fromTeam.players.findIndex((p) => p.id === playerId),
        1
      );
      const toTeam = createProposedTeams[toIndex];
      toTeam.players.push(player);
      for (const t of [fromTeam, toTeam]) {
        t.playerIds = t.players.map((p) => p.id);
        t.totalRating = t.players.reduce((sum, p) => sum + (p.rating ?? 0), 0);
      }
      recomputeSeatConflicts();
      ctx.rerender();
    });
  });

  const submitBtn = el.querySelector('#tourn-submit');
  if (submitBtn) {
    submitBtn.addEventListener('click', async () => {
      if (!createProposedTeams) return;
      const gameId = el.querySelector('#tourn-game').value;
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

// A team's score-entry mini-form for round-robin fixtures (the bracket has
// its own inline variant, see renderBracketMatchBox) — shown instead of the
// plain winner-pick buttons whenever the tournament tracks a real score, the
// winner itself is derived server-side from whichever number is higher.
function renderScoreForm(m) {
  return `
    <input type="number" min="0" inputmode="numeric" data-score-a="${m.id}" style="width:52px;" placeholder="0" />
    <span class="muted">:</span>
    <input type="number" min="0" inputmode="numeric" data-score-b="${m.id}" style="width:52px;" placeholder="0" />
    <button type="button" class="btn btn-sm" data-submit-score="${m.id}">✓</button>`;
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

  const canRecord = t.status === 'active' && m.teamAId && m.teamBId && !m.winnerTeamId;

  const teamRow = (teamId, score) => {
    const isWinner = m.winnerTeamId && m.winnerTeamId === teamId;
    const label = teamId ? teamLabel(teamsById, teamId) : 'TBD';
    const cls = `bracket-team-row${isWinner ? ' is-winner' : ''}${!teamId ? ' is-tbd' : ''}`;
    if (canRecord && t.trackScore) {
      const side = teamId === m.teamAId ? 'a' : 'b';
      return `
        <div class="${cls}">
          <span class="bracket-team-name">${label}</span>
          <input type="number" min="0" inputmode="numeric" class="bracket-score-input" data-score-${side}="${m.id}" placeholder="0" />
        </div>`;
    }
    if (canRecord && teamId) {
      return `<button type="button" class="${cls}" data-match="${m.id}" data-winner="${teamId}"><span class="bracket-team-name">${label}</span></button>`;
    }
    const scoreReadout = t.trackScore && score !== null ? `<span class="bracket-score">${score}</span>` : '';
    return `<div class="${cls}"><span class="bracket-team-name">${label}</span>${scoreReadout}</div>`;
  };

  // Floats in the connector gutter to the right of the box (see
  // .bracket-score-submit) instead of taking up a 3rd row — keeps the box
  // itself exactly 2 rows tall even while a score is being entered.
  const submitBtn =
    canRecord && t.trackScore
      ? `<button type="button" class="bracket-score-submit btn" data-submit-score="${m.id}" aria-label="Ergebnis speichern">✓</button>`
      : '';

  return `<div class="bracket-match">${teamRow(m.teamAId, m.scoreA)}${teamRow(m.teamBId, m.scoreB)}${submitBtn}</div>`;
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
      <div class="bracket-round-titles">${titles}</div>
      ${tree}
    </div>`;
}

// ---------- detail: round-robin (also reused for each group_knockout group) ----------

function renderRoundRobinBoard(t, teamsById, matches, standings) {
  const byRound = new Map();
  for (const m of matches) byRound.set(m.round, [...(byRound.get(m.round) ?? []), m]);

  const fixturesHtml = [...byRound.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([round, roundMatches]) => {
      const rows = roundMatches
        .map((m) => {
          const decided = m.winnerTeamId !== null || m.isDraw;
          const canRecord = t.status === 'active' && !decided;
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
              </div>`;
          }
          if (t.trackScore) {
            return `
              <div class="lb-row" style="flex-wrap:wrap;gap:var(--space-2);">
                <span style="flex:1 1 100%;">${nameA} <span class="muted">vs</span> ${nameB}</span>
                ${renderScoreForm(m)}
              </div>`;
          }
          return `
            <div class="lb-row" style="flex-wrap:wrap;gap:var(--space-2);">
              <span style="flex:1 1 100%;">${nameA} <span class="muted">vs</span> ${nameB}</span>
              <button type="button" class="btn btn-sm" data-match="${m.id}" data-winner="${m.teamAId}">${nameA}</button>
              <button type="button" class="btn btn-sm" data-match="${m.id}" data-winner="${m.teamBId}">${nameB}</button>
              <button type="button" class="btn btn-sm" data-match="${m.id}" data-winner="">Unentschieden</button>
            </div>`;
        })
        .join('');
      return `<div class="section-title" style="margin-top:var(--space-4);">Runde ${round}</div><div class="card">${rows}</div>`;
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
    <div class="section-title">📊 Tabelle</div>
    <div class="card">${standingsRows}</div>
    ${fixturesHtml}
  `;
}

function renderRoundRobin(t, ctx) {
  const teamsById = new Map(t.teams.map((team) => [team.id, team]));
  return renderRoundRobinBoard(t, teamsById, t.matches, t.standings);
}

// ---------- detail: group stage + knockout ----------

function renderGroupKnockout(t, ctx) {
  const teamsById = new Map(t.teams.map((team) => [team.id, team]));

  const groupBlocks = (t.groups || [])
    .map((g) => {
      const groupMatches = t.matches.filter((m) => m.stage === 'group' && m.groupIndex === g.groupIndex);
      return `<div class="section-title">👥 Gruppe ${g.groupIndex + 1}</div>${renderRoundRobinBoard(t, teamsById, groupMatches, g.standings)}`;
    })
    .join('');

  const knockoutMatches = t.matches.filter((m) => m.stage === 'knockout');
  const knockoutHtml =
    knockoutMatches.length === 0
      ? `<div class="section-title" style="margin-top:var(--space-4);">K.O.-Runde</div>
         <div class="empty-state">Startet automatisch, sobald alle Gruppenspiele entschieden sind.</div>`
      : `<div class="section-title" style="margin-top:var(--space-4);">K.O.-Runde</div>${renderBracket(t, ctx, knockoutMatches)}`;

  return `${groupBlocks}${knockoutHtml}`;
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
      ctx.rerender();
    });
    return;
  }

  const t = detailCache;
  const board =
    t.format === 'single_elimination'
      ? renderBracket(t, ctx)
      : t.format === 'group_knockout'
        ? renderGroupKnockout(t, ctx)
        : renderRoundRobin(t, ctx);

  const formatMeta = [
    t.twoLegged ? 'Hin- und Rückspiele' : null,
    t.format === 'group_knockout' ? `${t.groupCount} Gruppen · Top ${t.advancersPerGroup} steigen auf` : null,
    t.trackScore ? 'Punktestand' : null,
  ]
    .filter(Boolean)
    .join(' · ');

  const lobbyInfo =
    t.lobbyName || t.lobbyPassword
      ? `<div class="muted" style="margin-bottom:12px;font-size:0.85rem;">
           🔑 ${t.lobbyName ? `Lobby "${escapeHtml(t.lobbyName)}"` : 'Lobby'}${t.lobbyPassword ? ` · PW: ${escapeHtml(t.lobbyPassword)}` : ''}
           <span class="muted" style="font-size:0.78rem;"> — das obere Team im Baum eröffnet</span>
         </div>`
      : '';

  container.innerHTML = `
    <div class="row-between">
      <button type="button" class="btn btn-sm" id="tourn-back">‹ Zurück</button>
      <button type="button" class="btn btn-sm btn-danger" id="tourn-delete">Löschen</button>
    </div>
    <h1 class="view-title row" style="gap:var(--space-2);">${gameBadgeHtml({ id: t.gameId, icon: t.gameIcon }, 26)} ${escapeHtml(t.name)}</h1>
    <div class="muted" style="margin-top:calc(var(--space-3) * -1);margin-bottom:var(--space-3);">
      ${FORMAT_LABELS[t.format]}${formatMeta ? ` · ${formatMeta}` : ''} ·
      <span class="badge ${t.status === 'completed' ? 'badge-offline' : 'badge-playing'}">${t.status === 'completed' ? 'Beendet' : 'Läuft'}</span>
    </div>
    ${lobbyInfo}
    ${board}
  `;

  container.querySelector('#tourn-back').addEventListener('click', () => {
    currentTournamentId = null;
    ctx.rerender();
  });

  container.querySelector('#tourn-delete').addEventListener('click', async () => {
    if (!(await confirmDialog(`Turnier "${t.name}" wirklich löschen?`))) return;
    try {
      await api.tournaments.remove(t.id);
      currentTournamentId = null;
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
      try {
        detailCache = await api.tournaments.recordResult(t.id, btn.dataset.match, { winnerTeamId });
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
        detailCache = await api.tournaments.recordResult(t.id, matchId, { scoreA, scoreB });
        ctx.rerender();
      } catch (err) {
        showToast(err.message, { error: true });
      }
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
