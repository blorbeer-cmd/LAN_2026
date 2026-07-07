// Tournament view (FR-33): pick a game + teams, get an automatically
// generated single-elimination bracket ("Turnierbaum") or round-robin
// league ("jeder gegen jeden", optionally Hin- und Rückspiele), then record
// results as they happen. Team formation reuses the same skill-balancing as
// "Teams auslosen" (api.matchmaking.generate) rather than reinventing it.

import { api } from '../api.js';
import { state, gameById } from '../state.js';
import { escapeHtml, avatarHtml, gameBadgeHtml } from '../format.js';
import { showToast } from '../toast.js';

const FORMAT_LABELS = {
  single_elimination: '🏆 K.O.-Turnier',
  round_robin: '🔁 Liga (jeder gegen jeden)',
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
let createProposedTeams = null; // [{ name, playerIds, players (for display), totalRating }]
let createSeatConflicts = null; // { conflicts, considered } from the last proposal, for the seating note

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
  createProposedTeams = null;
  createSeatConflicts = null;
}

// ---------- list + create ----------

function renderList(container, ctx) {
  if (listCache === null && !listLoading) loadList(ctx);

  const listHtml =
    listLoading || listCache === null
      ? `<div class="empty-state">Lädt…</div>`
      : listCache.length === 0
        ? `<div class="empty-state"><span class="emoji">🏆</span>Noch keine Turniere.</div>`
        : `<div class="stack">${listCache
            .map(
              (t) => `
            <button type="button" class="card row" style="width:100%;text-align:left;cursor:pointer;" data-open-tournament="${t.id}">
              ${gameBadgeHtml({ id: t.gameId, icon: t.gameIcon }, 36)}
              <span style="flex:1;">
                <div class="player-name">${escapeHtml(t.name)}</div>
                <div class="muted" style="font-size:0.8rem;">${FORMAT_LABELS[t.format]} · ${t.teamCount} Teams</div>
              </span>
              <span class="badge ${t.status === 'completed' ? 'badge-offline' : 'badge-playing'}">${t.status === 'completed' ? 'Beendet' : 'Läuft'}</span>
            </button>`
            )
            .join('')}</div>`;

  container.innerHTML = `
    <div class="row-between">
      <h1 class="view-title">Turniere</h1>
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
    el.innerHTML = `<div class="empty-state" style="padding:16px;">Dafür braucht es mindestens ein Spiel und 2 Spieler.</div>`;
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
        ? `<div class="muted" style="font-size:0.78rem;">🪑 ${createSeatConflicts.conflicts} von ${createSeatConflicts.considered} Sitznachbarschaft(en) mussten trotzdem gegeneinander antreten (sonst wäre es zu unfair geworden).</div>`
        : `<div class="muted" style="font-size:0.78rem;">🪑 Alle Sitznachbarn sind im selben Team.</div>`
      : '';

  const teamsPreview = createProposedTeams
    ? `
      <div class="section-title">Teams (Namen anpassbar)</div>
      <div class="grid" style="grid-template-columns:repeat(auto-fit, minmax(150px, 1fr));">
        ${createProposedTeams
          .map(
            (t, i) => `
          <div class="team-card">
            <input type="text" data-team-name="${i}" value="${escapeHtml(t.name)}" maxlength="60" style="margin-bottom:2px;font-weight:700;" />
            <div class="muted" style="font-size:0.78rem;margin-bottom:6px;">Score ${t.totalRating}</div>
            ${t.players.map((p) => `<div class="team-player">${avatarHtml(p, 18)} ${escapeHtml(p.name)}</div>`).join('')}
          </div>`
          )
          .join('')}
      </div>
      ${seatingNote}
      <div class="row">
        <button type="button" class="btn btn-sm" id="tourn-reroll" style="flex:1;">🎲 Nochmal auslosen</button>
      </div>
    `
    : '';

  el.innerHTML = `
    <div class="card stack" style="margin-bottom:16px;">
      <div class="row-between">
        <div class="section-title" style="margin:0;">Neues Turnier</div>
        <button type="button" class="icon-btn" id="tourn-create-close" aria-label="Schließen">✕</button>
      </div>
      <select id="tourn-game">${gameOptions}</select>
      <div>${playerRows}</div>
      <input type="number" id="tourn-teamcount" placeholder="Anzahl Teams" min="2" style="width:140px;" />
      <label class="check-row">
        <input type="checkbox" id="tourn-avoid-adjacent" ${createAvoidAdjacent ? 'checked' : ''} />
        <span>🪑 Sitznachbarn nicht gegeneinander auslosen (kommen bevorzugt ins selbe Team)</span>
      </label>
      <button type="button" class="btn" id="tourn-propose">Teams vorschlagen</button>

      ${teamsPreview}

      <select id="tourn-format">
        ${Object.entries(FORMAT_LABELS).map(([v, label]) => `<option value="${v}" ${v === createFormat ? 'selected' : ''}>${label}</option>`).join('')}
      </select>
      ${
        createFormat === 'round_robin'
          ? `<label class="check-row">
               <input type="checkbox" id="tourn-two-legged" ${createTwoLegged ? 'checked' : ''} />
               <span>🔁 Hin- und Rückspiele (jeder spielt zweimal gegen jeden)</span>
             </label>`
          : ''
      }
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

  el.querySelector('#tourn-avoid-adjacent').addEventListener('change', (e) => {
    createAvoidAdjacent = e.target.checked;
  });

  async function proposeTeams() {
    const gameId = el.querySelector('#tourn-game').value;
    const playerIds = [...createCheckedIds];
    if (playerIds.length < 2) {
      return showToast('Mindestens 2 Spieler auswählen.', { error: true });
    }
    const teamCountRaw = el.querySelector('#tourn-teamcount').value;
    const body = { gameId, playerIds, avoidAdjacentOpponents: createAvoidAdjacent };
    if (teamCountRaw) body.teamCount = parseInt(teamCountRaw, 10);
    try {
      const result = await api.matchmaking.generate(body);
      createProposedTeams = result.teams.map((t, i) => ({
        name: `Team ${i + 1}`,
        players: t.players,
        playerIds: t.players.map((p) => p.id),
        totalRating: t.totalRating,
      }));
      createSeatConflicts = result.seatPairsConsidered
        ? { conflicts: result.seatConflicts, considered: result.seatPairsConsidered }
        : null;
      ctx.rerender();
    } catch (err) {
      showToast(err.message, { error: true });
    }
  }

  el.querySelector('#tourn-propose').addEventListener('click', proposeTeams);
  const rerollBtn = el.querySelector('#tourn-reroll');
  if (rerollBtn) rerollBtn.addEventListener('click', proposeTeams);

  el.querySelectorAll('[data-team-name]').forEach((input) => {
    input.addEventListener('input', () => {
      createProposedTeams[parseInt(input.dataset.teamName, 10)].name = input.value;
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
          twoLegged: createFormat === 'round_robin' ? createTwoLegged : false,
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

function renderBracket(t, ctx) {
  const teamsById = new Map(t.teams.map((team) => [team.id, team]));
  const totalRounds = Math.max(...t.matches.map((m) => m.round));

  const columns = [];
  for (let round = 1; round <= totalRounds; round++) {
    const matches = t.matches.filter((m) => m.round === round).sort((a, b) => a.slot - b.slot);
    columns.push(`
      <div class="bracket-round">
        <div class="bracket-round-title">${bracketRoundLabel(round, totalRounds)}</div>
        ${matches
          .map((m) => {
            if (m.isBye) {
              return `
                <div class="bracket-match">
                  <div class="bracket-team is-winner">${teamLabel(teamsById, m.winnerTeamId)}</div>
                  <div class="bracket-team is-tbd">Freilos</div>
                </div>`;
            }
            const canRecord = t.status === 'active' && m.teamAId && m.teamBId && !m.winnerTeamId;
            const teamRow = (teamId) => {
              const isWinner = m.winnerTeamId && m.winnerTeamId === teamId;
              const label = teamId ? teamLabel(teamsById, teamId) : 'TBD';
              const cls = `bracket-team${isWinner ? ' is-winner' : ''}${!teamId ? ' is-tbd' : ''}`;
              if (canRecord && teamId) {
                return `<button type="button" class="${cls}" data-match="${m.id}" data-winner="${teamId}">${label}</button>`;
              }
              return `<div class="${cls}">${label}</div>`;
            };
            return `<div class="bracket-match">${teamRow(m.teamAId)}${teamRow(m.teamBId)}</div>`;
          })
          .join('')}
      </div>
    `);
  }

  return `<div class="bracket-scroll">${columns.join('')}</div>`;
}

// ---------- detail: round-robin ----------

function renderRoundRobin(t, ctx) {
  const teamsById = new Map(t.teams.map((team) => [team.id, team]));
  const byRound = new Map();
  for (const m of t.matches) byRound.set(m.round, [...(byRound.get(m.round) ?? []), m]);

  const fixturesHtml = [...byRound.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([round, matches]) => {
      const rows = matches
        .map((m) => {
          const decided = m.winnerTeamId !== null || m.isDraw;
          const canRecord = t.status === 'active' && !decided;
          const nameA = teamLabel(teamsById, m.teamAId);
          const nameB = teamLabel(teamsById, m.teamBId);
          const aWon = m.winnerTeamId === m.teamAId;
          const bWon = m.winnerTeamId === m.teamBId;
          if (!canRecord) {
            const resultText = m.isDraw ? 'Unentschieden' : aWon ? `${nameA} gewinnt` : bWon ? `${nameB} gewinnt` : '–';
            return `
              <div class="lb-row">
                <span style="flex:1;">${nameA} <span class="muted">vs</span> ${nameB}</span>
                <span class="muted" style="font-size:0.8rem;">${resultText}</span>
              </div>`;
          }
          return `
            <div class="lb-row" style="flex-wrap:wrap;gap:6px;">
              <span style="flex:1 1 100%;">${nameA} <span class="muted">vs</span> ${nameB}</span>
              <button type="button" class="btn btn-sm" data-match="${m.id}" data-winner="${m.teamAId}">${nameA}</button>
              <button type="button" class="btn btn-sm" data-match="${m.id}" data-winner="${m.teamBId}">${nameB}</button>
              <button type="button" class="btn btn-sm" data-match="${m.id}" data-winner="">Unentschieden</button>
            </div>`;
        })
        .join('');
      return `<div class="section-title" style="margin-top:14px;">Runde ${round}</div><div class="card">${rows}</div>`;
    })
    .join('');

  const standingsRows = (t.standings || [])
    .map(
      (s, i) => `
      <div class="lb-row ${i === 0 ? 'rank-1' : ''}">
        <span class="lb-rank">${i + 1}</span>
        <span style="flex:1;">${teamLabel(teamsById, s.teamId)}</span>
        <span class="muted" style="font-size:0.8rem;" title="${s.wins} Siege, ${s.draws} Unentschieden, ${s.losses} Niederlagen">${s.wins}S/${s.draws}U/${s.losses}N</span>
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
  const board = t.format === 'single_elimination' ? renderBracket(t, ctx) : renderRoundRobin(t, ctx);

  container.innerHTML = `
    <div class="row-between">
      <button type="button" class="btn btn-sm" id="tourn-back">‹ Zurück</button>
      <button type="button" class="btn btn-sm btn-danger" id="tourn-delete">Löschen</button>
    </div>
    <h1 class="view-title row" style="gap:8px;">${gameBadgeHtml({ id: t.gameId, icon: t.gameIcon }, 26)} ${escapeHtml(t.name)}</h1>
    <div class="muted" style="margin-top:-10px;margin-bottom:12px;">
      ${FORMAT_LABELS[t.format]}${t.twoLegged ? ' · Hin- und Rückspiele' : ''} ·
      <span class="badge ${t.status === 'completed' ? 'badge-offline' : 'badge-playing'}">${t.status === 'completed' ? 'Beendet' : 'Läuft'}</span>
    </div>
    ${board}
  `;

  container.querySelector('#tourn-back').addEventListener('click', () => {
    currentTournamentId = null;
    ctx.rerender();
  });

  container.querySelector('#tourn-delete').addEventListener('click', async () => {
    if (!confirm(`Turnier "${t.name}" wirklich löschen?`)) return;
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
        detailCache = await api.tournaments.recordResult(t.id, btn.dataset.match, winnerTeamId);
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
