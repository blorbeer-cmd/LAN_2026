// Matchmaking view (FR-16..18): pick a game + present players, draw balanced
// teams. Results are stored in shared state (updated live via the
// matchmaking:generated socket event) so everyone at the party sees the same
// draw, not just whoever clicked the button.

import { api } from '../api.js';
import { icon } from '../icons.js';
import { confirmDialog } from '../modal.js';
import { state, gameById } from '../state.js';
import { escapeHtml, avatarHtml, gameBadgeHtml, formatDateTime, seatConflictIconHtml } from '../format.js';
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
// own tab. A *finished* draft doesn't get any special treatment here beyond
// that — its teams already landed in matchmaking_draws (see draft.ts), so
// they show up in Team-Historie below like any other draw.
let draftCache = null; // { draft: {...} | null }
let draftLoading = false;
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
// per-player "move to another team" selects (Feinschliff) and the button to
// record a result — which is what turns this into an Ergebnis-Historie entry.
function renderDrawCard(draw, { editable }) {
  const teamsHtml = draw.teams
    .map((t, i) => {
      // Only meaningful once a result is actually recorded (read-only cards)
      // — the skill-balance "Score" above is a different number (the draw's
      // rating total), so this is labeled distinctly to avoid confusion.
      const resultParts = [];
      if (!editable && draw.winnerTeamIndex === i) resultParts.push(`${icon('trophy')} Sieger`);
      if (t.rank != null) resultParts.push(`Platz ${t.rank}`);
      if (t.score != null) resultParts.push(`Wert ${t.score}`);
      const resultLine = resultParts.length
        ? `<div class="muted" style="font-size:var(--font-size-xs);">${resultParts.join(' · ')}</div>`
        : '';

      return `
      <div class="team-card">
        <div class="team-card-header"><span>Team ${i + 1}</span><span>Score ${t.totalRating}</span></div>
        ${resultLine}
        ${t.players
          .map(
            (p) => `
          <div class="team-player">
            ${avatarHtml(p, 18)}
            <span class="team-player-name" style="flex:1;">${escapeHtml(p.name)}</span>
            ${seatConflictIconHtml(p)}
            ${p.rating != null ? `<span class="rating">${p.rating}</span>` : ''}
            ${
              editable && draw.teams.length > 1
                ? `<select class="team-move-select" data-move-draw="${draw.id}" data-move-player="${p.id}" aria-label="Team ändern">
                    ${draw.teams.map((_, ti) => `<option value="${ti}" ${ti === i ? 'selected' : ''}>Team ${ti + 1}</option>`).join('')}
                  </select>`
                : ''
            }
          </div>`
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
      <div class="row-between">
        <div class="row" style="gap:var(--space-2);">
          <span class="muted" style="font-size:var(--font-size-xs);">${formatDateTime(draw.generatedAt)}</span>
          ${draw.source === 'draft' ? `<span class="badge">👑 Captain-Draft</span>` : ''}
        </div>
        ${draw.matchId ? `<span class="badge badge-offline">✅ Ergebnis erfasst</span>` : ''}
        ${!editable && draw.winnerTeamIndex === null ? `<span class="badge">🤝 Unentschieden</span>` : ''}
      </div>
      <div class="team-results-scroll">
        <div class="grid" style="grid-template-columns:repeat(${draw.teams.length}, minmax(190px, 1fr));">${teamsHtml}</div>
      </div>
      ${seatingNote}
      ${editable ? `<button type="button" class="btn btn-primary btn-sm" data-record-draw="${draw.id}">✅ Ergebnis eintragen</button>` : ''}
      ${!editable ? `<button type="button" class="btn btn-primary btn-sm" data-rematch-draw="${draw.id}">${icon('shuffle')} Rematch</button>` : ''}
    </div>`;
}

// Wires the "move player" selects and "Ergebnis eintragen" buttons for every
// draw card currently in the DOM — shared between the just-generated result
// and the Team-Historie list, since both render the same card markup.
function wireDrawCards(container, ctx) {
  container.querySelectorAll('[data-move-draw]').forEach((sel) => {
    sel.addEventListener('change', async () => {
      const drawId = sel.dataset.moveDraw;
      const playerId = sel.dataset.movePlayer;
      const toTeamIndex = parseInt(sel.value, 10);
      try {
        const updated = await api.matchmaking.moveDrawPlayer(drawId, playerId, toTeamIndex);
        if (state.lastMatchmaking?.id === drawId) state.lastMatchmaking = updated;
        if (historyCache) {
          const idx = historyCache.findIndex((d) => d.id === drawId);
          if (idx !== -1) historyCache[idx] = updated;
        }
        ctx.rerender();
      } catch (err) {
        showToast(err.message, { error: true });
        ctx.rerender(); // reset the select back to its actual team
      }
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

  container.querySelectorAll('[data-rematch-draw]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const draw = findDrawById(btn.dataset.rematchDraw);
      if (!draw) return;
      const teams = draw.teams.map((t) => ({ playerIds: t.players.map((p) => p.id) }));
      try {
        // Logs a fresh matchmaking_draws row for the same lineup (unlike a
        // "Teams auslosen" re-roll, this keeps the exact teams) so the result
        // entered below links back to it and lands in Ergebnis-Historie,
        // same as any other draw — see the /rematch endpoint's comment.
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

function renderHistory() {
  if (historyLoading || historyCache === null) {
    return `<div class="empty-state" style="padding:var(--space-4);">Lädt…</div>`;
  }
  if (historyCache.length === 0) {
    return `<div class="section-title">🕓 Team-Historie</div>
      <div class="empty-state" style="padding:var(--space-4);"><span class="emoji">⚖️</span>Noch keine Auslosungen für dieses Spiel.</div>`;
  }

  // Ergebnis-Historie (ein Ergebnis wurde eingetragen) kommt vor die
  // Team-Historie (noch offene Zusammenstellungen) — sobald ein Ergebnis
  // erfasst wird, wandert der Eintrag von unten nach oben.
  const resultHistory = historyCache.filter((d) => d.matchId);
  const teamHistory = historyCache.filter((d) => !d.matchId);

  const resultSection = resultHistory.length
    ? `<div class="section-title">🏆 Ergebnis-Historie</div>${resultHistory.map((d) => renderDrawCard(d, { editable: false })).join('')}`
    : '';

  const teamSection = `
    <div class="section-title">🕓 Team-Historie</div>
    ${
      teamHistory.length
        ? teamHistory.map((d) => renderDrawCard(d, { editable: true })).join('')
        : `<div class="empty-state" style="padding:var(--space-4);"><span class="emoji">⚖️</span>Noch keine offenen Auslosungen.</div>`
    }
  `;

  return resultSection + teamSection;
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
      <div class="empty-state"><span class="emoji">⚖️</span>Dafür braucht es mindestens ein Spiel und 2 Spieler.</div>`;
    return;
  }

  if (draftCache === null && !draftLoading) {
    loadDraft(ctx);
  }

  // A running draft takes over the view on every device — it's a shared live
  // event, and mixing it with the regular draw form would just distract. A
  // finished draft gets no special treatment here — its teams already sit in
  // Team-Historie below (see draft.ts), same as any other draw.
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
        <span>${icon('armchair')} Sitznachbarn bevorzugt ins selbe Team losen</span>
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

    ${renderHistory()}
  `;

  if (prevTeamCount) container.querySelector('#mm-teamcount').value = prevTeamCount;

  wireDrawCards(container, ctx);

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
}

function renderResult(result) {
  // Once a result is recorded for this draw it moves into Ergebnis-Historie
  // below — the "gerade ausgelost" panel has nothing left to show.
  if (!result || result.matchId) return '';
  return `
    <div class="section-title row" style="gap:var(--space-2);">${gameBadgeHtml(gameById(result.gameId), 22)} ${escapeHtml(result.gameName)} — gerade ausgelost</div>
    ${renderDrawCard(result, { editable: true })}
  `;
}
