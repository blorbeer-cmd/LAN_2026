// Matchmaking view (FR-16..18): pick a game + present players, draw balanced
// teams. Results are stored in shared state (updated live via the
// matchmaking:generated socket event) so everyone at the party sees the same
// draw, not just whoever clicked the button.

import { api } from '../api.js';
import { icon } from '../icons.js';
import { confirmDialog } from '../modal.js';
import { state, gameById } from '../state.js';
import { escapeHtml, avatarHtml, gameBadgeHtml, formatDateTime } from '../format.js';
import { showToast } from '../toast.js';
import { openMatchForm } from './leaderboard.js';
import { getMyId } from '../whoami.js';

// Persists across re-renders of this view (but not across a full page
// reload) so toggling checkboxes survives a re-roll without extra plumbing.
let checkedIds = null;
let avoidAdjacentOpponents = false;

// Captain-draft state: the latest draft (active or finished) as delivered by
// GET /api/draft or the draft:changed socket event. A running draft takes
// over the whole view on every device (that's the point — it's a live event
// everyone watches), so it lives here in the Teams view rather than in its
// own tab.
let draftCache = null; // { draft: {...} | null }
let draftLoading = false;
let draftCaptainIds = new Set(); // captains chosen in the start form
let dismissedDraftId = null; // completed-draft result the user closed

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

// Called from app.js whenever a matchmaking:generated event arrives, so a
// freshly drawn set of teams shows up in the history next render instead of
// whatever the last fetch happened to see.
export function invalidateMatchmakingHistory() {
  historyForGameId = null;
}

function renderHistory() {
  if (historyLoading || historyCache === null) {
    return `<div class="empty-state" style="padding:var(--space-4);">Lädt…</div>`;
  }
  if (historyCache.length === 0) {
    return `<div class="empty-state" style="padding:var(--space-4);"><span class="emoji">⚖️</span>Noch keine Auslosungen für dieses Spiel.</div>`;
  }
  return historyCache
    .map((draw) => {
      const teamsHtml = draw.teams
        .map(
          (t, i) => `
          <div class="team-card">
            <div class="team-card-header"><span>Team ${i + 1}</span><span>Score ${t.totalRating}</span></div>
            ${t.players.map((p) => `<div class="team-player">${avatarHtml(p, 18)} ${escapeHtml(p.name)}<span class="rating">${p.rating}</span></div>`).join('')}
          </div>`
        )
        .join('');
      return `
        <div class="card stack" style="margin-bottom:var(--space-3);">
          <div class="muted" style="font-size:var(--font-size-xs);">${formatDateTime(draw.generatedAt)}</div>
          <div class="grid" style="grid-template-columns:repeat(auto-fit, minmax(130px, 1fr));">${teamsHtml}</div>
        </div>`;
    })
    .join('');
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
        <div class="team-card-header"><span>👑 ${escapeHtml(t.captain.name)}</span>${draft.turnCaptainIndex === i ? '<span style="color:var(--accent);">am Zug</span>' : ''}</div>
        ${t.players.map((p) => `<div class="team-player">${avatarHtml(p, 20)} ${escapeHtml(p.name)}</div>`).join('')}
      </div>`
    )
    .join('');

  const poolHtml = draft.pool
    .map((p) =>
      isMyTurn
        ? `<button type="button" class="chip" data-draft-pick="${p.id}" style="cursor:pointer;">${avatarHtml(p, 18)} ${escapeHtml(p.name)}</button>`
        : `<span class="chip" style="opacity:0.85;">${avatarHtml(p, 18)} ${escapeHtml(p.name)}</span>`
    )
    .join('');

  return `
    <div class="card stack">
      <div class="row-between">
        <strong>👑 Captain-Draft läuft</strong>
        <span class="badge badge-playing">Live</span>
      </div>
      <div class="row" style="gap:var(--space-2);">${gameBadgeHtml(gameById(draft.gameId) || { id: draft.gameId, icon: draft.gameIcon }, 24)} ${escapeHtml(draft.gameName)}</div>
      <div class="grid" style="grid-template-columns:repeat(auto-fit, minmax(150px, 1fr));">${teamsHtml}</div>
      <div class="section-title" style="margin:var(--space-2) 0 0;">Pool</div>
      <div class="chip-list">${poolHtml}</div>
      <div class="muted" style="font-size:var(--font-size-sm);">
        ${isMyTurn ? '🫵 Du bist am Zug – tippe einen Spieler an!' : `Warten auf <strong>${escapeHtml(turnCaptain?.name ?? '?')}</strong>…`}
      </div>
      <button type="button" class="btn btn-danger btn-sm" id="draft-cancel">Draft abbrechen</button>
    </div>`;
}

function renderDraftResult(draft) {
  const teamsHtml = draft.teams
    .map(
      (t) => `
      <div class="team-card">
        <div class="team-card-header"><span>👑 Team ${escapeHtml(t.captain.name)}</span></div>
        ${t.players.map((p) => `<div class="team-player">${avatarHtml(p, 20)} ${escapeHtml(p.name)}</div>`).join('')}
      </div>`
    )
    .join('');
  return `
    <div class="card stack">
      <div class="row-between">
        <strong>👑 Draft-Ergebnis: ${escapeHtml(draft.gameName)}</strong>
        <button type="button" class="icon-btn" id="draft-dismiss" aria-label="Ausblenden">✕</button>
      </div>
      <div class="grid" style="grid-template-columns:repeat(auto-fit, minmax(150px, 1fr));">${teamsHtml}</div>
      <button type="button" class="btn btn-primary btn-block" id="draft-record-result">✅ Ergebnis eintragen</button>
    </div>`;
}

function wireDraftBoard(container, ctx, draft) {
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

  const dismissBtn = container.querySelector('#draft-dismiss');
  if (dismissBtn) {
    dismissBtn.addEventListener('click', () => {
      dismissedDraftId = draft.id;
      ctx.rerender();
    });
  }

  const recordBtn = container.querySelector('#draft-record-result');
  if (recordBtn) {
    recordBtn.addEventListener('click', () => {
      openMatchForm(ctx, {
        presetGameId: draft.gameId,
        presetTeams: draft.teams.map((t) => ({ playerIds: t.players.map((p) => p.id) })),
      });
    });
  }
}

export function renderMatchmaking(container, ctx) {
  if (state.games.length === 0 || state.players.length === 0) {
    container.innerHTML = `
      <h1 class="view-title">Teams auslosen</h1>
      <div class="empty-state"><span class="emoji">⚖️</span>Dafür braucht es mindestens ein Spiel und 2 Spieler.</div>`;
    return;
  }

  if (draftCache === null && !draftLoading) {
    loadDraft(ctx);
  }

  // A running draft takes over the view on every device — it's a shared live
  // event, and mixing it with the regular draw form would just distract.
  const draft = draftCache?.draft;
  if (draft && draft.status === 'active') {
    container.innerHTML = `
      <h1 class="view-title">Teams auslosen</h1>
      ${renderDraftBoard(draft, ctx)}`;
    wireDraftBoard(container, ctx, draft);
    return;
  }
  const showDraftResult = draft && draft.status === 'completed' && draft.id !== dismissedDraftId;

  if (checkedIds === null) {
    // First render: default to whoever is currently shown as playing.
    checkedIds = new Set(state.live.filter((p) => p.state === 'playing').map((p) => p.player_id));
    if (checkedIds.size === 0) checkedIds = new Set(state.players.map((p) => p.id));
  }

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
        <span style="flex:1;">${escapeHtml(p.name)}</span>
      </label>`
    )
    .join('');

  // Toggling a player checkbox re-renders (the captain chips derive from the
  // checked set) — keep whatever team count the user already typed.
  const prevTeamCount = container.querySelector('#mm-teamcount')?.value ?? '';

  // Captain chips: pick 2-4 captains from the currently checked players —
  // the rest of the checked players become the pool the captains pick from.
  const checkedPlayers = state.players.filter((p) => checkedIds.has(p.id));
  const captainChips = checkedPlayers
    .map((p) => {
      const isCaptain = draftCaptainIds.has(p.id);
      return `<button type="button" class="chip" data-captain-toggle="${p.id}"
        style="cursor:pointer;${isCaptain ? 'border-color:var(--accent);color:var(--accent);font-weight:var(--font-weight-bold);' : ''}">
        ${isCaptain ? '👑 ' : ''}${escapeHtml(p.name)}
      </button>`;
    })
    .join('');
  const draftPoolSize = checkedPlayers.length - draftCaptainIds.size;
  const draftReady = draftCaptainIds.size >= 2 && draftCaptainIds.size <= 4 && draftPoolSize >= 1;

  container.innerHTML = `
    <h1 class="view-title">Teams auslosen</h1>
    ${showDraftResult ? renderDraftResult(draft) : ''}
    <div class="card stack">
      <select id="mm-game">${gameOptions}</select>
      <div>${playerRows}</div>
      <div class="row">
        <input type="number" id="mm-teamcount" placeholder="Teams" min="2" style="width:90px;flex-shrink:0;" />
        <button type="button" class="btn btn-primary" id="mm-generate" style="flex:1;">Teams auslosen</button>
      </div>
      <div class="muted" style="font-size:var(--font-size-xs);margin-top:calc(var(--space-2) * -1);">Anzahl Teams leer lassen für automatisch (Standard: 2)</div>
      <label class="check-row">
        <input type="checkbox" id="mm-avoid-adjacent" ${avoidAdjacentOpponents ? 'checked' : ''} />
        <span>${icon('users')} Sitznachbarn nicht gegeneinander auslosen</span>
      </label>

      <div class="section-title" style="margin:var(--space-2) 0 0;">👑 Oder: Captain-Draft</div>
      <div class="muted" style="font-size:var(--font-size-xs);">
        2-4 Captains antippen – sie picken dann abwechselnd live aus den übrigen angehakten
        Spielern. Alle können auf ihrem Handy zusehen.
      </div>
      <div class="chip-list">${captainChips || '<span class="muted" style="font-size:var(--font-size-sm);">Oben Spieler anhaken, dann hier Captains wählen.</span>'}</div>
      <button type="button" class="btn" id="draft-start" ${draftReady ? '' : 'disabled'}>Draft starten${draftReady ? ` (${draftCaptainIds.size} Captains, ${draftPoolSize} im Pool)` : ''}</button>
    </div>
    <div id="mm-result">${renderResult(state.lastMatchmaking)}</div>

    <div class="section-title">🕓 Team-Historie</div>
    ${renderHistory()}
  `;

  if (showDraftResult) wireDraftBoard(container, ctx, draft);

  if (prevTeamCount) container.querySelector('#mm-teamcount').value = prevTeamCount;

  container.querySelectorAll('[data-captain-toggle]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.captainToggle;
      if (draftCaptainIds.has(id)) draftCaptainIds.delete(id);
      else if (draftCaptainIds.size < 4) draftCaptainIds.add(id);
      else return showToast('Maximal 4 Captains.', { error: true });
      ctx.rerender();
    });
  });

  container.querySelector('#draft-start').addEventListener('click', async () => {
    const captainIds = [...draftCaptainIds];
    const poolPlayerIds = [...checkedIds].filter((id) => !draftCaptainIds.has(id));
    try {
      draftCache = await api.draft.start({
        gameId: container.querySelector('#mm-game').value,
        captainIds,
        poolPlayerIds,
      });
      draftCaptainIds = new Set();
      ctx.rerender();
    } catch (err) {
      showToast(err.message, { error: true });
    }
  });

  container.querySelector('#mm-game').addEventListener('change', (e) => {
    state.selectedGameId = e.target.value;
    ctx.rerender();
  });

  container.querySelectorAll('[data-player]').forEach((cb) => {
    cb.addEventListener('change', () => {
      if (cb.checked) {
        checkedIds.add(cb.dataset.player);
      } else {
        checkedIds.delete(cb.dataset.player);
        // Someone unchecked can't stay captain of the draft-to-be.
        draftCaptainIds.delete(cb.dataset.player);
      }
      // Captain chips derive from the checked set — keep them in sync.
      ctx.rerender();
    });
  });

  container.querySelector('#mm-avoid-adjacent').addEventListener('change', (e) => {
    avoidAdjacentOpponents = e.target.checked;
  });

  container.querySelector('#mm-generate').addEventListener('click', async () => {
    const gameId = container.querySelector('#mm-game').value;
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

  const recordBtn = container.querySelector('#mm-record-result');
  if (recordBtn) {
    recordBtn.addEventListener('click', () => {
      const result = state.lastMatchmaking;
      openMatchForm(ctx, {
        presetGameId: result.gameId,
        presetTeams: result.teams.map((t) => ({ playerIds: t.players.map((p) => p.id) })),
      });
    });
  }
}

function renderResult(result) {
  if (!result) return '';
  const teamsHtml = result.teams
    .map(
      (t, i) => `
      <div class="team-card">
        <div class="team-card-header"><span>Team ${i + 1}</span><span>Score ${t.totalRating}</span></div>
        ${t.players
          .map(
            (p) => `
          <div class="team-player">
            ${avatarHtml(p, 20)}
            ${escapeHtml(p.name)}
            <span class="rating">${p.rating}</span>
          </div>`
          )
          .join('')}
      </div>`
    )
    .join('');

  const seatingNote = result.seatPairsConsidered
    ? result.seatConflicts > 0
      ? `<div class="muted" style="font-size:var(--font-size-xs);margin-top:var(--space-2);">${icon('users')} ${result.seatConflicts} von ${result.seatPairsConsidered} Sitznachbarschaft(en) mussten trotzdem gegeneinander antreten (sonst wäre es zu unfair geworden).</div>`
      : `<div class="muted" style="font-size:var(--font-size-xs);margin-top:var(--space-2);">${icon('users')} Alle Sitznachbarn sind im selben Team.</div>`
    : '';

  return `
    <div class="section-title row" style="gap:var(--space-2);">${gameBadgeHtml(gameById(result.gameId), 22)} ${escapeHtml(result.gameName)} — Ergebnis</div>
    <div class="grid" style="grid-template-columns:repeat(auto-fit, minmax(150px, 1fr));">${teamsHtml}</div>
    ${seatingNote}
    <button type="button" class="btn btn-primary btn-block" id="mm-record-result" style="margin-top:var(--space-3);">✅ Ergebnis eintragen</button>
  `;
}
