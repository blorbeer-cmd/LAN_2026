// Matchmaking view (FR-16..18): pick a game + present players, draw balanced
// teams. Results are stored in shared state (updated live via the
// matchmaking:generated socket event) so everyone at the party sees the same
// draw, not just whoever clicked the button.

import { api } from '../api.js';
import { icon } from '../icons.js';
import { confirmDialog, openModal } from '../modal.js';
import { state, gameById } from '../state.js';
import { escapeHtml, avatarHtml, gameBadgeHtml, formatDateTime, seatConflictIconHtml } from '../format.js';
import { showToast } from '../toast.js';
import { openMatchForm } from './leaderboard.js';
import { getMyId } from '../whoami.js';
import { infoTooltipHtml, wireInfoTooltips } from '../infoTooltip.js';
import { domainIcon } from '../domainIcons.js';
import { playerSkillHtml } from '../skillDisplay.js';

// Persists across re-renders of this view (but not across a full page
// reload) so toggling checkboxes survives a re-roll without extra plumbing.
let checkedIds = null;
let avoidAdjacentOpponents = false;
let teamCountValue = '2';
let selectedDrawPlayer = null;

// Captain-draft state: the latest draft (active or finished) as delivered by
// GET /api/draft or the draft:changed socket event. A running draft takes
// over the whole view on every device (that's the point — it's a live event
// everyone watches), so it lives here in the Teams view rather than in its
// own tab. A *finished* draft doesn't get any special treatment here beyond
// that — its teams already landed in matchmaking_draws (see draft.ts), so
// they show up in Historie below like any other draw.
let draftCache = null; // { draft: {...} | null }
let draftLoading = false;
let draftPlayerIds = null; // independently selected participants for the next draft
let draftCaptainIds = new Set(); // captains chosen in the start form

async function loadDraft(ctx) {
  draftLoading = true;
  try {
    draftCache = await api.draft.get();
  } catch {
    draftCache = { draft: null };
  } finally {
    draftLoading = false;
    ctx.rerender();
  }
}

// Called from app.js on every draft:changed socket event — the payload IS
// the fresh state, so no extra round trip is needed.
export function setDraftState(payload) {
  draftCache = payload;
}

// Cached separately from `state` (like votes.js does for Vote-Historie)
// since it's fetched from its own endpoint, scoped to whichever game is
// currently selected.
let historyCache = null;
let historyLoading = false;
let historyForGameId = null;

async function loadHistory(gameId, ctx) {
  historyLoading = true;
  try {
    const res = await api.matchmaking.history(gameId);
    historyCache = res.history;
    historyForGameId = gameId;
  } catch {
    historyCache = [];
    historyForGameId = gameId;
  } finally {
    historyLoading = false;
    ctx.rerender();
  }
}

// Called from app.js whenever a matchmaking:generated or
// matchmaking:draws-changed event arrives, so history is never more than one
// re-render stale.
export function invalidateMatchmakingHistory() {
  historyForGameId = null;
}

// A draw currently on screen either comes from the freshly-generated result
// (state.lastMatchmaking) or from the history list — both use the same
// shape (see parseDrawRow on the server), so lookups/updates work uniformly.
function findDrawById(id) {
  if (state.lastMatchmaking?.id === id) return state.lastMatchmaking;
  return historyCache?.find((d) => d.id === id) ?? null;
}

// One drawn/recorded lineup: team cards plus, for a still-unrecorded draw,
// draggable player rows and the button to record a result — which is what
// changes its actions inside the shared Historie. Selecting a player and
// then a team is the touch equivalent; arrow keys provide the keyboard path.
function renderDrawCard(draw, { editable, showGame = false }) {
  const selectedTeamIndex =
    editable && selectedDrawPlayer?.drawId === draw.id
      ? draw.teams.findIndex((team) => team.players.some((player) => player.id === selectedDrawPlayer.playerId))
      : -1;
  const teamsHtml = draw.teams
    .map((t, i) => {
      // Only meaningful once a result is actually recorded (read-only cards)
      // — the skill-balance "Score" above is a different number (the draw's
      // rating total), so this is labeled distinctly to avoid confusion.
      const resultParts = [];
      if (t.rank != null) resultParts.push(`Platz ${t.rank}`);
      if (t.score != null) resultParts.push(`Wert ${t.score}`);
      const resultLine = resultParts.length
        ? `<div class="muted" style="font-size:var(--font-size-xs);">${resultParts.join(' · ')}</div>`
        : '';
      const isWinner = !editable && draw.winnerTeamIndex === i;

      return `
      <div class="team-card tournament-draft-team matchmaking-draw-team${isWinner ? ' is-winner' : ''}${selectedTeamIndex !== -1 && selectedTeamIndex !== i ? ' is-select-target' : ''}" role="group" aria-label="Team ${i + 1}${isWinner ? ', Gewinner' : ''}" ${editable ? `data-draw-drop-team="${i}" data-draw-id="${draw.id}"` : ''}>
        <div class="team-card-header"><span>Team ${i + 1}</span><span>Score ${t.totalRating}</span></div>
        ${resultLine}
        ${t.players
          .map(
            (p) => `
          ${editable ? `<button type="button" class="team-player tournament-drag-player${selectedDrawPlayer?.drawId === draw.id && selectedDrawPlayer.playerId === p.id ? ' is-selected' : ''}" draggable="true" data-move-draw="${draw.id}" data-move-player="${p.id}" data-team-index="${i}" aria-pressed="${selectedDrawPlayer?.drawId === draw.id && selectedDrawPlayer.playerId === p.id}" aria-label="${escapeHtml(p.name)} verschieben">` : '<div class="team-player">'}
            ${avatarHtml(p, 18)}
            <span class="team-player-name" style="flex:1;">${escapeHtml(p.name)}</span>
            ${seatConflictIconHtml(p)}
            ${playerSkillHtml(p.id, draw.gameId)}
          ${editable ? '</button>' : '</div>'}`
          )
          .join('')}
      </div>`;
    })
    .join('');

  const seatingNote = draw.seatPairsConsidered
    ? draw.seatConflicts > 0
      ? `<div class="muted" style="font-size:var(--font-size-xs);">${icon('armchair')} ${draw.seatConflicts} von ${draw.seatPairsConsidered} Sitznachbarschaft(en) mussten trotzdem gegeneinander antreten (sonst wäre es zu unfair geworden).</div>`
      : `<div class="muted" style="font-size:var(--font-size-xs);">${icon('armchair')} Alle Sitznachbarn sind im selben Team.</div>`
    : '';

  return `
    <div class="card stack" style="margin-bottom:var(--space-3);" data-draw-card="${draw.id}">
      <div class="row-between" style="flex-wrap:wrap;">
        <div class="row" style="gap:var(--space-2);flex-wrap:wrap;">
          ${
            showGame
              ? `${gameBadgeHtml(gameById(draw.gameId) || { id: draw.gameId, icon: draw.gameIcon }, 22)}
                 <span class="player-name">${escapeHtml(draw.gameName)}</span>`
              : ''
          }
          <span class="muted" style="font-size:var(--font-size-xs);">${formatDateTime(draw.generatedAt)}</span>
          ${draw.source === 'draft' ? '<span class="badge">Captain Draft</span>' : ''}
        </div>
        ${!editable && draw.winnerTeamIndex === null ? `<span class="badge">${icon('users')} Unentschieden</span>` : ''}
      </div>
      <div class="tournament-team-preview-grid">${teamsHtml}</div>
      ${seatingNote}
      ${editable ? `<button type="button" class="btn btn-primary btn-sm" data-record-draw="${draw.id}">Ergebnis eintragen</button>` : ''}
      ${
        !editable
          ? `<div class="row" style="flex-wrap:wrap;">
               <button type="button" class="btn btn-sm" style="flex:1 1 var(--selection-card-min-width);" data-edit-draw-result="${draw.id}">Ergebnis bearbeiten</button>
               <button type="button" class="btn btn-primary btn-sm" style="flex:1 1 var(--selection-card-min-width);" data-rematch-draw="${draw.id}">${icon('shuffle')} Rematch</button>
             </div>`
          : ''
      }
    </div>`;
}

function openDrawResultEdit(draw, ctx) {
  if (!draw.matchId) return;
  const teamFields = draw.teams
    .map(
      (team, index) => `<div class="team-card stack">
        <label class="check-row">
          <input type="radio" name="edit-draw-winner" value="${index}" ${draw.winnerTeamIndex === index ? 'checked' : ''} />
          <strong>Team ${index + 1} gewinnt</strong>
        </label>
        <div class="muted" style="font-size:var(--font-size-xs);">${team.players.map((player) => escapeHtml(player.name)).join(', ')}</div>
        <div class="field-row">
          <div>
            <label class="field-label" for="edit-draw-score-${index}">Wert (optional)</label>
            <input type="number" id="edit-draw-score-${index}" data-edit-draw-score="${index}" step="any" value="${team.score ?? ''}" />
          </div>
          <div>
            <label class="field-label" for="edit-draw-rank-${index}">Platz (optional)</label>
            <input type="number" id="edit-draw-rank-${index}" data-edit-draw-rank="${index}" min="1" value="${team.rank ?? ''}" />
          </div>
        </div>
      </div>`
    )
    .join('');

  const { close, el } = openModal(
    'Ergebnis bearbeiten',
    `<form id="edit-draw-result-form" class="stack">
      ${teamFields}
      <label class="check-row">
        <input type="radio" name="edit-draw-winner" value="" ${draw.winnerTeamIndex === null ? 'checked' : ''} />
        <span>Unentschieden</span>
      </label>
      <button type="submit" class="btn btn-primary btn-block">Änderung speichern</button>
    </form>`
  );

  el.querySelector('#edit-draw-result-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const submitButton = event.currentTarget.querySelector('button[type="submit"]');
    if (submitButton.disabled) return;
    submitButton.disabled = true;
    const teams = draw.teams.map((team, index) => {
      const scoreRaw = el.querySelector(`[data-edit-draw-score="${index}"]`).value;
      const rankRaw = el.querySelector(`[data-edit-draw-rank="${index}"]`).value;
      return {
        playerIds: team.players.map((player) => player.id),
        score: scoreRaw === '' ? null : Number(scoreRaw),
        rank: rankRaw === '' ? null : Number(rankRaw),
      };
    });
    const winnerRaw = el.querySelector('input[name="edit-draw-winner"]:checked')?.value ?? '';
    try {
      await api.matches.update(draw.matchId, {
        teams,
        winnerTeamIndex: winnerRaw === '' ? null : Number(winnerRaw),
      });
      historyForGameId = null;
      close();
      await ctx.refresh();
      showToast('Ergebnis aktualisiert.');
    } catch (err) {
      submitButton.disabled = false;
      showToast(err.message, { error: true });
    }
  });
}

// Wires D&D/touch/keyboard player moves and result buttons for every draw
// card currently in the DOM — shared between the fresh result and history.
function wireDrawCards(container, ctx) {
  async function moveDrawPlayer(drawId, playerId, toTeamIndex) {
    try {
      const updated = await api.matchmaking.moveDrawPlayer(drawId, playerId, toTeamIndex);
      if (state.lastMatchmaking?.id === drawId) state.lastMatchmaking = updated;
      if (historyCache) {
        const idx = historyCache.findIndex((draw) => draw.id === drawId);
        if (idx !== -1) historyCache[idx] = updated;
      }
      selectedDrawPlayer = null;
      ctx.rerender();
    } catch (err) {
      selectedDrawPlayer = null;
      showToast(err.message, { error: true });
      ctx.rerender();
    }
  }

  let draggedPlayer = null;
  const clearDragState = () => {
    container.querySelectorAll('.is-drag-target, .is-dragging').forEach((element) => {
      element.classList.remove('is-drag-target', 'is-dragging');
    });
    draggedPlayer = null;
  };

  container.querySelectorAll('[data-move-draw]').forEach((playerRow) => {
    playerRow.addEventListener('dragstart', (event) => {
      selectedDrawPlayer = null;
      draggedPlayer = { drawId: playerRow.dataset.moveDraw, playerId: playerRow.dataset.movePlayer };
      playerRow.classList.add('is-dragging');
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', JSON.stringify(draggedPlayer));
    });
    playerRow.addEventListener('dragend', clearDragState);
    playerRow.addEventListener('click', (event) => {
      event.stopPropagation();
      const next = { drawId: playerRow.dataset.moveDraw, playerId: playerRow.dataset.movePlayer };
      selectedDrawPlayer =
        selectedDrawPlayer?.drawId === next.drawId && selectedDrawPlayer.playerId === next.playerId ? null : next;
      ctx.rerender();
    });
    playerRow.addEventListener('keydown', (event) => {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      event.preventDefault();
      const draw = findDrawById(playerRow.dataset.moveDraw);
      if (!draw) return;
      const currentIndex = Number(playerRow.dataset.teamIndex);
      const direction = event.key === 'ArrowLeft' ? -1 : 1;
      const toTeamIndex = (currentIndex + direction + draw.teams.length) % draw.teams.length;
      moveDrawPlayer(draw.id, playerRow.dataset.movePlayer, toTeamIndex);
    });
  });

  container.querySelectorAll('[data-draw-drop-team]').forEach((teamCard) => {
    const drawId = teamCard.dataset.drawId;
    const toTeamIndex = Number(teamCard.dataset.drawDropTeam);
    teamCard.addEventListener('dragover', (event) => {
      if (!draggedPlayer || draggedPlayer.drawId !== drawId) return;
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
      let player = draggedPlayer;
      if (!player) {
        try {
          player = JSON.parse(event.dataTransfer.getData('text/plain'));
        } catch {
          player = null;
        }
      }
      clearDragState();
      if (player?.drawId === drawId) moveDrawPlayer(drawId, player.playerId, toTeamIndex);
    });
    teamCard.addEventListener('click', (event) => {
      if (
        selectedDrawPlayer?.drawId !== drawId ||
        event.target.closest('[data-move-draw]')
      ) return;
      moveDrawPlayer(drawId, selectedDrawPlayer.playerId, toTeamIndex);
    });
  });

  container.querySelectorAll('[data-record-draw]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const draw = findDrawById(btn.dataset.recordDraw);
      if (!draw) return;
      openMatchForm(ctx, {
        presetGameId: draw.gameId,
        presetTeams: draw.teams.map((t) => ({ playerIds: t.players.map((p) => p.id) })),
        presetDrawId: draw.id,
      });
    });
  });

  container.querySelectorAll('[data-edit-draw-result]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const draw = findDrawById(btn.dataset.editDrawResult);
      if (draw) openDrawResultEdit(draw, ctx);
    });
  });

  container.querySelectorAll('[data-rematch-draw]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const draw = findDrawById(btn.dataset.rematchDraw);
      if (!draw) return;
      const teams = draw.teams.map((t) => ({ playerIds: t.players.map((p) => p.id) }));
      try {
        // Logs a fresh matchmaking_draws row for the same lineup (unlike a
        // "Teams auslosen" re-roll, this keeps the exact teams) so the result
        // entered below links back to it in Historie, same as any other draw
        // — see the /rematch endpoint's comment.
        const rematchDraw = await api.matchmaking.rematch({ gameId: draw.gameId, teams });
        state.lastMatchmaking = rematchDraw;
        ctx.rerender();
        openMatchForm(ctx, {
          presetGameId: rematchDraw.gameId,
          presetTeams: teams,
          presetDrawId: rematchDraw.id,
        });
      } catch (err) {
        showToast(err.message, { error: true });
      }
    });
  });
}

function renderHistoryDetails(title, count, content) {
  return `<details class="card history-details collapsible-section">
    <summary class="collapsible-section-header">
      <h2>${title}</h2>
      <span class="collapsible-section-summary-end">
        <span class="badge badge-offline">${count}</span>
        <span class="collapsible-section-chevron">${icon('chevronRight')}</span>
      </span>
    </summary>
    <div class="collapsible-section-content">${content}</div>
  </details>`;
}

function renderHistory() {
  if (historyLoading || historyCache === null) {
    return renderHistoryDetails(
      'Historie',
      0,
      '<div class="empty-state" style="padding:var(--space-4);">Lädt…</div>'
    );
  }
  if (historyCache.length === 0) {
    return renderHistoryDetails(
      'Historie',
      0,
      '<div class="empty-state" style="padding:var(--space-4);">Noch keine Auslosungen für dieses Spiel.</div>'
    );
  }

  // Open draws and recorded results are two states of the same lineup, so
  // keep them in the server's newest-first order inside one shared history.
  return renderHistoryDetails(
    'Historie',
    historyCache.length,
    historyCache
      .map((draw) => renderDrawCard(draw, { editable: !draw.matchId, showGame: true }))
      .join('')
  );
}

// ---------- captain draft: live board ----------

function renderDraftBoard(draft, ctx) {
  const myId = getMyId();
  const isMyTurn = draft.turnCaptainId === myId;
  const turnCaptain = draft.teams[draft.turnCaptainIndex]?.captain;

  const teamsHtml = draft.teams
    .map(
      (t, i) => `
      <div class="team-card" ${draft.turnCaptainIndex === i ? 'style="border-color:var(--accent);"' : ''}>
        <div class="team-card-header"><span>${escapeHtml(t.captain.name)}</span>${draft.turnCaptainIndex === i ? '<span style="color:var(--accent);">am Zug</span>' : ''}</div>
        ${t.players.map((p) => `<div class="team-player">${avatarHtml(p, 20)} <span class="team-player-name">${escapeHtml(p.name)}</span>${playerSkillHtml(p.id, draft.gameId)}</div>`).join('')}
      </div>`
    )
    .join('');

  const poolHtml = draft.pool
    .map((p) =>
      isMyTurn
        ? `<button type="button" class="check-row draft-pool-player" data-draft-pick="${p.id}">${avatarHtml(p, 20)} <span class="player-name" style="flex:1;">${escapeHtml(p.name)}</span>${playerSkillHtml(p.id, draft.gameId)}</button>`
        : `<div class="check-row draft-pool-player">${avatarHtml(p, 20)} <span class="player-name" style="flex:1;">${escapeHtml(p.name)}</span>${playerSkillHtml(p.id, draft.gameId)}</div>`
    )
    .join('');

  return `
    <div class="card stack">
      <div class="row-between">
        <strong>Captain Draft läuft</strong>
        <span class="badge badge-playing">Live</span>
      </div>
      <div class="player-name">${escapeHtml(draft.gameName)}</div>
      <div class="section-title" style="margin:var(--space-2) 0 0;">Captains</div>
      <div class="grid" style="grid-template-columns:repeat(auto-fit, minmax(var(--selection-card-min-width), 1fr));">${teamsHtml}</div>
      <div class="section-title" style="margin:var(--space-2) 0 0;">Spieler</div>
      <div class="player-selection-grid tournament-player-grid draft-pool-grid">${poolHtml}</div>
      ${isMyTurn ? '' : `<div class="muted" style="font-size:var(--font-size-sm);">Warten auf <strong>${escapeHtml(turnCaptain?.name ?? '?')}</strong>…</div>`}
      <button type="button" class="btn btn-danger btn-sm" id="draft-cancel">Draft abbrechen</button>
    </div>`;
}

function wireDraftBoard(container, ctx) {
  const cancelBtn = container.querySelector('#draft-cancel');
  if (cancelBtn) {
    cancelBtn.addEventListener('click', async () => {
      if (!(await confirmDialog('Draft wirklich abbrechen?'))) return;
      try {
        draftCache = await api.draft.cancel();
        ctx.rerender();
      } catch (err) {
        showToast(err.message, { error: true });
      }
    });
  }

  container.querySelectorAll('[data-draft-pick]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      try {
        draftCache = await api.draft.pick(getMyId(), btn.dataset.draftPick);
        ctx.rerender();
      } catch (err) {
        showToast(err.message, { error: true });
      }
    });
  });
}

export function renderMatchmaking(container, ctx) {
  if (state.games.length === 0 || state.players.length === 0) {
    container.innerHTML = `
      <h1 class="view-title">Teams auslosen</h1>
      <div class="empty-state"><span class="empty-state-icon">${icon(domainIcon('matchmaking'))}</span>Dafür braucht es mindestens ein Spiel und 2 Spieler.</div>`;
    return;
  }

  if (draftCache === null && !draftLoading) {
    loadDraft(ctx);
  }

  // A running draft takes over the view on every device — it's a shared live
  // event, and mixing it with the regular draw form would just distract. A
  // finished draft gets no special treatment here — its teams already sit in
  // Historie below (see draft.ts), same as any other draw.
  const draft = draftCache?.draft;
  if (draft && draft.status === 'active') {
    container.innerHTML = `
      <h1 class="view-title">Teams auslosen</h1>
      ${renderDraftBoard(draft, ctx)}`;
    wireDraftBoard(container, ctx);
    return;
  }

  if (checkedIds === null) {
    // First render: default to whoever is currently shown as playing.
    checkedIds = new Set(state.live.filter((p) => p.state === 'playing').map((p) => p.player_id));
    if (checkedIds.size === 0) checkedIds = new Set(state.players.map((p) => p.id));
  }
  if (draftPlayerIds === null) draftPlayerIds = new Set(checkedIds);
  const availablePlayerIds = new Set(state.players.map((player) => player.id));
  draftPlayerIds = new Set([...draftPlayerIds].filter((id) => availablePlayerIds.has(id)));
  draftCaptainIds = new Set([...draftCaptainIds].filter((id) => draftPlayerIds.has(id)));

  const selectedGameId = state.selectedGameId || state.games[0].id;

  if (historyForGameId !== selectedGameId && !historyLoading) {
    loadHistory(selectedGameId, ctx);
  }

  const gameOptions = state.games
    .map((g) => `<option value="${g.id}" ${g.id === selectedGameId ? 'selected' : ''}>${escapeHtml(g.icon)} ${escapeHtml(g.name)}</option>`)
    .join('');

  const playerRows = state.players
    .map(
      (p) => `
      <label class="check-row">
        <input type="checkbox" data-player="${p.id}" ${checkedIds.has(p.id) ? 'checked' : ''} />
        ${avatarHtml(p, 20)}
        <span class="player-name" style="flex:1;">${escapeHtml(p.name)}</span>
        ${playerSkillHtml(p.id, selectedGameId)}
      </label>`
    )
    .join('');

  const draftPlayerRows = state.players
    .map(
      (p) => `<label class="check-row">
        <input type="checkbox" data-draft-player="${p.id}" ${draftPlayerIds.has(p.id) ? 'checked' : ''} />
        ${avatarHtml(p, 20)}
        <span class="player-name" style="flex:1;">${escapeHtml(p.name)}</span>
        ${playerSkillHtml(p.id, selectedGameId)}
      </label>`
    )
    .join('');

  // Captains are selected only from the independently prepared draft roster;
  // every other selected participant becomes part of the live pick pool.
  const draftPlayers = state.players.filter((p) => draftPlayerIds.has(p.id));
  const captainRows = draftPlayers
    .map(
      (p) => `<label class="check-row">
        <input type="checkbox" data-captain-toggle="${p.id}" ${draftCaptainIds.has(p.id) ? 'checked' : ''} />
        ${avatarHtml(p, 20)}
        <span class="player-name" style="flex:1;">${escapeHtml(p.name)}</span>
        ${playerSkillHtml(p.id, selectedGameId)}
      </label>`
    )
    .join('');
  const draftPoolSize = draftPlayers.length - draftCaptainIds.size;
  const draftReady = draftCaptainIds.size >= 2 && draftCaptainIds.size <= 4 && draftPoolSize >= 1;

  container.innerHTML = `
    <h1 class="view-title">Teams auslosen</h1>
    <div class="card stack">
      <div>
        <label class="field-label" for="mm-game">Spiel auswählen</label>
        <select id="mm-game">${gameOptions}</select>
      </div>
      <section class="tournament-section-panel tournament-create-step stack" aria-labelledby="matchmaking-draw-title">
        <div class="tournament-create-step-title">
          <h3 id="matchmaking-draw-title">Auslosung</h3>
        </div>
        <div class="selection-toolbar">
          <div class="tournament-team-count-field">
            <label class="field-label" for="mm-teamcount">Anzahl Teams</label>
            <input type="number" id="mm-teamcount" min="2" value="${escapeHtml(teamCountValue)}" />
          </div>
          <button type="button" class="btn btn-sm" id="mm-select-all">Alle markieren</button>
          <button type="button" class="btn btn-sm" id="mm-select-none">Auswahl aufheben</button>
        </div>
        <div class="player-selection-grid tournament-player-grid">${playerRows}</div>
        <div class="check-row">
          <input type="checkbox" id="mm-avoid-adjacent" ${avoidAdjacentOpponents ? 'checked' : ''} />
          <span class="title-with-info tournament-option-label">
            <label for="mm-avoid-adjacent">Sitznachbarn</label>
            ${infoTooltipHtml(
                'matchmaking-neighbors-help',
                'Sitznachbarn',
                'Sitznachbarn werden nach Möglichkeit in dasselbe Team gelost. Die Skill-Balance hat Vorrang, wenn beides nicht gleichzeitig möglich ist.'
              )}
          </span>
        </div>
        <button type="button" class="btn btn-primary" id="mm-generate">Teams auslosen</button>
      </section>

      <section class="tournament-section-panel tournament-create-step stack" aria-labelledby="matchmaking-draft-title">
        <div class="tournament-create-step-title">
          <h3 id="matchmaking-draft-title" class="title-with-info">
            <span>Captain Draft</span>
            ${infoTooltipHtml(
                'captain-draft-help',
                'Captain Draft',
                'Zuerst Teilnehmer, dann Captains benennen. Anschließend abwechselnd aus den Spielern wählen.'
              )}
          </h3>
        </div>
        <div class="selection-toolbar">
          <span class="field-label">Spieler</span>
          <button type="button" class="btn btn-sm" id="draft-select-all">Alle markieren</button>
          <button type="button" class="btn btn-sm" id="draft-select-none">Auswahl aufheben</button>
        </div>
        <div class="player-selection-grid tournament-player-grid captain-selection-grid">${draftPlayerRows}</div>
        <div class="captain-selection-group">
          <div class="field-label">Captains</div>
          <div class="player-selection-grid tournament-player-grid captain-selection-grid">
            ${captainRows}
          </div>
        </div>
        <button type="button" class="btn btn-primary" id="draft-start" ${draftReady ? '' : 'disabled'}>Draft starten</button>
      </section>
    </div>
    <div id="mm-result">${renderResult(state.lastMatchmaking)}</div>

    ${renderHistory()}
  `;

  wireInfoTooltips(container);
  wireDrawCards(container, ctx);

  container.querySelector('#mm-teamcount').addEventListener('input', (event) => {
    teamCountValue = event.target.value;
  });

  container.querySelector('#mm-select-all').addEventListener('click', () => {
    checkedIds = new Set(state.players.map((player) => player.id));
    ctx.rerender();
  });
  container.querySelector('#mm-select-none').addEventListener('click', () => {
    checkedIds.clear();
    ctx.rerender();
  });

  container.querySelector('#draft-select-all').addEventListener('click', () => {
    draftPlayerIds = new Set(state.players.map((player) => player.id));
    ctx.rerender();
  });
  container.querySelector('#draft-select-none').addEventListener('click', () => {
    draftPlayerIds.clear();
    draftCaptainIds.clear();
    ctx.rerender();
  });

  container.querySelectorAll('[data-draft-player]').forEach((checkbox) => {
    checkbox.addEventListener('change', () => {
      const id = checkbox.dataset.draftPlayer;
      if (checkbox.checked) draftPlayerIds.add(id);
      else {
        draftPlayerIds.delete(id);
        draftCaptainIds.delete(id);
      }
      ctx.rerender();
    });
  });

  container.querySelectorAll('[data-captain-toggle]').forEach((checkbox) => {
    checkbox.addEventListener('change', () => {
      const id = checkbox.dataset.captainToggle;
      if (!checkbox.checked) draftCaptainIds.delete(id);
      else if (draftCaptainIds.size < 4) draftCaptainIds.add(id);
      else {
        checkbox.checked = false;
        return showToast('Maximal 4 Captains.', { error: true });
      }
      ctx.rerender();
    });
  });

  container.querySelector('#draft-start').addEventListener('click', async () => {
    const captainIds = [...draftCaptainIds];
    const poolPlayerIds = [...draftPlayerIds].filter((id) => !draftCaptainIds.has(id));
    try {
      draftCache = await api.draft.start({
        gameId: selectedGameId,
        captainIds,
        poolPlayerIds,
      });
      draftCaptainIds = new Set();
      ctx.rerender();
    } catch (err) {
      showToast(err.message, { error: true });
    }
  });

  container.querySelector('#mm-game').addEventListener('change', (event) => {
    state.selectedGameId = event.target.value;
    ctx.rerender();
  });

  container.querySelectorAll('[data-player]').forEach((cb) => {
    cb.addEventListener('change', () => {
      if (cb.checked) {
        checkedIds.add(cb.dataset.player);
      } else {
        checkedIds.delete(cb.dataset.player);
      }
      ctx.rerender();
    });
  });

  container.querySelector('#mm-avoid-adjacent').addEventListener('change', (e) => {
    avoidAdjacentOpponents = e.target.checked;
  });

  container.querySelector('#mm-generate').addEventListener('click', async () => {
    const gameId = selectedGameId;
    const playerIds = [...checkedIds];
    if (playerIds.length < 2) {
      return showToast('Mindestens 2 Spieler auswählen.', { error: true });
    }
    const teamCountRaw = container.querySelector('#mm-teamcount').value;
    const body = { gameId, playerIds, avoidAdjacentOpponents };
    if (teamCountRaw) body.teamCount = parseInt(teamCountRaw, 10);

    try {
      const result = await api.matchmaking.generate(body);
      state.lastMatchmaking = result;
      ctx.rerender();
    } catch (err) {
      showToast(err.message, { error: true });
    }
  });
}

function renderResult(result) {
  // Once a result is recorded, this draw stays in Historie with result
  // actions while the "gerade ausgelost" panel has nothing left to show.
  if (!result || result.matchId) return '';
  return `
    <div class="section-title row" style="gap:var(--space-2);">${gameBadgeHtml(gameById(result.gameId), 22)} ${escapeHtml(result.gameName)} — gerade ausgelost</div>
    ${renderDrawCard(result, { editable: true })}
  `;
}
