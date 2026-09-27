// Shared physical table plan. Only group admins and owners arrange it (the
// server gates PUT /api/seating/layout on that role).
//
// Two interaction paths, same semantics: HTML5 drag & drop for mouse users,
// and a seat dialog with a native picker for everyone (tap or click a seat).
// Both go through movePlayer() + save(). The table size changes in the
// "Tisch ändern" dialog.

import { api } from '../api.js';
import { state } from '../state.js';
import { escapeHtml, avatarHtml, stateLabel } from '../format.js';
import { showToast } from '../toast.js';
import { isGroupAdmin } from '../groupContext.js';
import { emptyStateHtml } from '../emptyState.js';
import { openModal } from '../modal.js';
import { profileRow } from '../profileRow.js';

const SIDES = ['top', 'right', 'bottom', 'left'];
const LABELS = { top: 'Oben', right: 'Rechts', bottom: 'Unten', left: 'Links' };
const MAX_SEATS_PER_SIDE = 12;
// Past this many seats on a long side the names move below the avatars.
const DENSE_SIDE_SEATS = 8;
let cache = null;
let loading = false;
let loadError = false;
let cacheStale = false;
let loadRequestVersion = 0;
let saving = false;

// A player's name/real name/avatar can change (players:changed) while this
// editor is already open with a cached layout — without this, the board
// would keep showing the pre-change data for the rest of the session
// instead of picking it up live (CLAUDE.md: realtime by default).
export function invalidateSeating({ hard = false } = {}) {
  loadRequestVersion += 1;
  loading = false;
  cacheStale = true;
  if (hard) cache = null;
  loadError = false;
}

function playerMap(players) {
  return new Map(players.map((player) => [player.id, player]));
}

function assignmentAt(layout, side, seat) {
  return layout.assignments.find((a) => a.side === side && a.seat === seat);
}

function seatTotal(layout) {
  return SIDES.reduce((sum, side) => sum + layout[`${side}Seats`], 0);
}

const byName = (a, b) => a.name.localeCompare(b.name, 'de', { numeric: true, sensitivity: 'base' });

function unseatedPlayers(layout, players) {
  const seated = new Set(layout.assignments.map((a) => a.playerId));
  return players.filter((player) => !seated.has(player.id)).sort(byName);
}

function statusIndicatorHtml(player) {
  const liveState = state.live.find((entry) => entry.player_id === player.id)?.state ?? 'offline';
  const liveLabel = stateLabel(liveState);
  return `<span class="seating-status-indicator is-${liveState}" role="img" aria-label="Status: ${liveLabel}" title="${liveLabel}"></span>`;
}

// Gamer name with the live status dot, and the actual person's name (see
// profile.js's "Richtiger Name") in small text right under it when set.
function seatNamesHtml(player) {
  return `<span class="seating-seat-names">
    <span class="seating-seat-name-line">
      <span class="seating-seat-name">${escapeHtml(player.name)}</span>
      ${statusIndicatorHtml(player)}
    </span>
    ${player.real_name ? `<span class="seating-seat-realname">${escapeHtml(player.real_name)}</span>` : ''}
  </span>`;
}

function seatHtml(layout, players, side, seat, editable) {
  const assignment = assignmentAt(layout, side, seat);
  const player = assignment ? players.get(assignment.playerId) : null;
  const title = player ? `${player.name}${player.real_name ? ` (${player.real_name})` : ''}` : 'Freier Sitzplatz';
  const content = player ? `${avatarHtml(player, 30)}${seatNamesHtml(player)}` : '<span class="seating-seat-free-label">Frei</span>';
  const data = `data-seat-side="${side}" data-seat-index="${seat}"${player ? ` data-player-id="${escapeHtml(player.id)}"` : ''}`;
  if (!editable) return `<div class="seating-seat${player ? ' is-occupied' : ''}" ${data} title="${escapeHtml(title)}">${content}</div>`;
  const label = `${LABELS[side]}, Platz ${seat + 1}: ${player ? player.name : 'frei'}`;
  return `<button type="button" class="seating-seat${player ? ' is-occupied' : ''}" ${data}${player ? ' draggable="true"' : ''} title="${escapeHtml(title)}" aria-label="${escapeHtml(label)}">${content}</button>`;
}

function sideHtml(layout, players, side, editable) {
  const count = layout[`${side}Seats`];
  return `<section class="seating-side seating-side-${side}" aria-label="${LABELS[side]}" style="--seating-side-count:${Math.max(1, count)};">
    <div class="seating-side-seats">${Array.from({ length: count }, (_, seat) => seatHtml(layout, players, side, seat, editable)).join('')}</div>
  </section>`;
}

export function renderSeatingPlan(layout, playerList, { editable = false } = {}) {
  const players = playerMap(playerList);
  const dense = Math.max(layout.topSeats, layout.bottomSeats) > DENSE_SIDE_SEATS;
  return `<div class="seating-plan ${editable ? 'is-editable' : 'is-readonly'}${dense ? ' is-dense' : ''}">
    ${sideHtml(layout, players, 'top', editable)}
    ${sideHtml(layout, players, 'right', editable)}
    <div class="seating-table-center">Tisch</div>
    ${sideHtml(layout, players, 'bottom', editable)}
    ${sideHtml(layout, players, 'left', editable)}
  </div>`;
}

// Row classes for a .profile-rows-columns list filled column by column.
function columnRowClass(index, count) {
  const columnRows = Math.ceil(count / 2);
  return [
    index === 0 || index === columnRows ? 'is-column-top' : '',
    index === columnRows - 1 || index === 2 * columnRows - 1 ? 'is-column-bottom' : '',
  ].filter(Boolean).join(' ');
}

function renderPool(layout, players) {
  const unseated = unseatedPlayers(layout, players);
  const rows = unseated.map((player, index) => profileRow({
    lead: avatarHtml(player, 32),
    title: `<span class="seating-pool-name">${escapeHtml(player.name)}</span>${statusIndicatorHtml(player)}`,
    meta: player.real_name ? escapeHtml(player.real_name) : '',
    className: columnRowClass(index, unseated.length),
    attrs: `draggable="true" data-player-id="${escapeHtml(player.id)}"`,
  }));
  return `<section class="seating-pool card stack grouped-page-section" aria-labelledby="seating-pool-title" data-seat-pool>
    <div class="grouped-page-section-title"><h2 id="seating-pool-title">Ohne Platz</h2>${unseated.length ? `<span class="muted">${unseated.length}</span>` : ''}</div>
    ${unseated.length
      ? `<div class="profile-rows profile-rows-columns" style="--profile-rows-count:${Math.ceil(unseated.length / 2)};">${rows.join('')}</div>`
      : emptyStateHtml('Alle haben einen Platz')}
  </section>`;
}

function planNoteHtml(layout) {
  const total = seatTotal(layout);
  const parts = [
    `${layout.assignments.length} von ${total} ${total === 1 ? 'Platz' : 'Plätzen'} belegt`,
    'Nachbarn am Tisch gelten als sichtbare Monitore',
    saving ? 'Speichert' : '',
  ];
  return `<p class="seating-plan-note">${parts.filter(Boolean).join(' · ')}</p>`;
}

function renderEditor() {
  const { layout, players } = cache;
  return `<div class="seating-editor grouped-page-sections">
    <section class="seating-plan-card card stack grouped-page-section" aria-label="Sitzplan">
      ${seatTotal(layout)
        ? `${renderSeatingPlan(layout, players, { editable: true })}${planNoteHtml(layout)}`
        : emptyStateHtml('Noch keine Plätze')}
    </section>
    ${renderPool(layout, players)}
  </div>`;
}

async function save(ctx) {
  saving = true;
  ctx.rerender();
  try {
    cache = await api.seating.saveLayout({ eventId: cache.eventId, ...cache.layout });
    window.dispatchEvent(new CustomEvent('seating:changed'));
  } catch (err) {
    showToast(err.message, { error: true });
  } finally {
    saving = false;
    ctx.rerender();
  }
}

// Moves a player to a seat (side/seat) or back to "Ohne Platz" (null/null).
// When both ends are table seats the destination's occupant takes the
// source seat; a move from "Ohne Platz" sends the occupant there instead.
function movePlayer(playerId, side, seat, source = null) {
  const layout = cache.layout;
  const displaced = side && seat !== null
    ? layout.assignments.find((a) => a.side === side && a.seat === seat && a.playerId !== playerId)
    : null;
  layout.assignments = layout.assignments.filter((a) => a.playerId !== playerId && !(a.side === side && a.seat === seat));
  if (side && seat !== null) {
    layout.assignments.push({ side, seat, playerId });
    if (displaced && source?.side && source.seat !== null) {
      layout.assignments = layout.assignments.filter((a) => !(a.side === source.side && a.seat === source.seat));
      layout.assignments.push({ side: source.side, seat: source.seat, playerId: displaced.playerId });
    }
  }
}

function seatOf(playerId) {
  const assignment = cache.layout.assignments.find((a) => a.playerId === playerId);
  return assignment ? { side: assignment.side, seat: assignment.seat } : null;
}

function dialogFooterHtml() {
  return `<div class="modal-actions">
    <button type="button" class="btn" data-dialog-cancel>Abbrechen</button>
    <button type="submit" class="btn btn-primary">Speichern</button>
  </div>`;
}

// One seat: pick who sits here, from one alphabetical list. Picking a
// player who already sits elsewhere swaps the two.
function openSeatDialog(side, seat, ctx) {
  const players = playerMap(cache.players);
  const occupantId = assignmentAt(cache.layout, side, seat)?.playerId ?? null;
  const occupant = occupantId ? players.get(occupantId) : null;
  const options = [...cache.players].sort(byName).map((player) =>
    `<option value="${escapeHtml(player.id)}"${player.id === occupantId ? ' selected' : ''}>${escapeHtml(player.name)}</option>`);
  const select = `<select id="seating-seat-player" aria-label="Spieler">
    <option value=""${occupant ? '' : ' selected'}>Frei</option>
    ${options.join('')}
  </select>`;
  const { close } = openModal(LABELS[side], `
    <form class="stack" id="seating-seat-form">
      <div class="profile-rows">${profileRow({ title: 'Spieler', meta: occupant?.real_name ? escapeHtml(occupant.real_name) : '', action: select })}</div>
      ${dialogFooterHtml()}
    </form>`, {
    onMount: (el) => {
      el.querySelector('[data-dialog-cancel]').addEventListener('click', () => close());
      el.querySelector('#seating-seat-form').addEventListener('submit', async (event) => {
        event.preventDefault();
        const chosen = el.querySelector('#seating-seat-player').value || null;
        close();
        if (chosen === occupantId) return;
        if (!chosen) movePlayer(occupantId, null, null);
        else movePlayer(chosen, side, seat, seatOf(chosen));
        await save(ctx);
      });
    },
  });
}

// Seats per side, saved together. Seats that disappear send their players
// back to "Ohne Platz".
function openTableDialog(ctx) {
  const current = Object.fromEntries(SIDES.map((side) => [side, cache.layout[`${side}Seats`]]));
  const readCounts = (el) => Object.fromEntries(SIDES.map((side) => {
    const value = Math.round(Number(el.querySelector(`[data-seat-count="${side}"]`).value));
    return [side, Number.isFinite(value) ? Math.max(0, Math.min(MAX_SEATS_PER_SIDE, value)) : current[side]];
  }));
  let modalEl = null;
  const { close } = openModal('Tisch ändern', `
    <form class="stack" id="seating-table-form">
      <div class="profile-rows">${SIDES.map((side) => profileRow({
        title: `<label for="seating-count-${side}">${LABELS[side]}</label>`,
        action: `<input type="number" class="seating-count-input" id="seating-count-${side}" min="0" max="${MAX_SEATS_PER_SIDE}" step="1" inputmode="numeric" value="${current[side]}" data-seat-count="${side}" />`,
      })).join('')}</div>
      <p class="seating-plan-note">Je Seite 0 bis ${MAX_SEATS_PER_SIDE} Plätze</p>
      ${dialogFooterHtml()}
    </form>`, {
    confirmClose: () => {
      if (!modalEl) return null;
      const counts = readCounts(modalEl);
      return SIDES.some((side) => counts[side] !== current[side]) ? 'Die geänderte Tischgröße geht verloren.' : null;
    },
    onMount: (el) => {
      modalEl = el;
      el.querySelector('[data-dialog-cancel]').addEventListener('click', () => close());
      el.querySelector('#seating-table-form').addEventListener('submit', async (event) => {
        event.preventDefault();
        const counts = readCounts(el);
        close();
        if (SIDES.every((side) => counts[side] === current[side])) return;
        for (const side of SIDES) cache.layout[`${side}Seats`] = counts[side];
        cache.layout.assignments = cache.layout.assignments.filter((a) => a.seat < counts[a.side]);
        await save(ctx);
      });
    },
  });
}

function wireEditor(container, ctx) {
  let draggedPlayerId = null;
  let draggedSource = null;
  const plan = container.querySelector('.seating-plan');
  container.querySelector('#seating-table-edit')?.addEventListener('click', () => openTableDialog(ctx));
  container.querySelectorAll('[draggable="true"][data-player-id]').forEach((element) => {
    element.addEventListener('dragstart', (event) => {
      draggedPlayerId = element.dataset.playerId;
      draggedSource = element.dataset.seatSide
        ? { side: element.dataset.seatSide, seat: Number(element.dataset.seatIndex) }
        : null;
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', draggedPlayerId);
      plan?.classList.add('is-moving');
    });
    element.addEventListener('dragend', () => plan?.classList.remove('is-moving'));
  });
  container.querySelectorAll('[data-seat-side]').forEach((seat) => {
    seat.addEventListener('dragover', (event) => { event.preventDefault(); seat.classList.add('is-drag-target'); });
    seat.addEventListener('dragleave', () => seat.classList.remove('is-drag-target'));
    seat.addEventListener('drop', async (event) => {
      event.preventDefault();
      seat.classList.remove('is-drag-target');
      const playerId = draggedPlayerId || event.dataTransfer.getData('text/plain');
      if (!playerId) return;
      movePlayer(playerId, seat.dataset.seatSide, Number(seat.dataset.seatIndex), draggedSource);
      draggedPlayerId = null;
      draggedSource = null;
      await save(ctx);
    });
    seat.addEventListener('click', () => openSeatDialog(seat.dataset.seatSide, Number(seat.dataset.seatIndex), ctx));
  });
  const pool = container.querySelector('[data-seat-pool]');
  if (pool) {
    pool.addEventListener('dragover', (event) => { event.preventDefault(); pool.classList.add('is-drag-target'); });
    pool.addEventListener('dragleave', (event) => {
      if (!pool.contains(event.relatedTarget)) pool.classList.remove('is-drag-target');
    });
    pool.addEventListener('drop', async (event) => {
      event.preventDefault();
      pool.classList.remove('is-drag-target');
      const playerId = draggedPlayerId || event.dataTransfer.getData('text/plain');
      draggedPlayerId = null;
      draggedSource = null;
      if (!playerId || !seatOf(playerId)) return;
      movePlayer(playerId, null, null);
      await save(ctx);
    });
  }
}

async function load(ctx) {
  const version = ++loadRequestVersion;
  loading = true;
  loadError = false;
  cacheStale = false;
  try {
    const result = await api.seating.layout();
    if (version === loadRequestVersion) cache = result;
  } catch (err) {
    if (version === loadRequestVersion) {
      showToast(err.message, { error: true });
      // Prevent an immediate retry on the next rerender that would flood the
      // user with repeated error toasts. A previously loaded plan stays usable.
      loadError = cache === null;
    }
  } finally {
    if (version === loadRequestVersion) {
      loading = false;
      ctx.rerender();
    }
  }
}

function headerHtml(action = '') {
  return `<div class="more-subpage-header">
    <div class="more-subpage-title-row">
      <h1 class="view-title">Sitzplan</h1>
      ${action}
    </div>
  </div>`;
}

export function renderSeating(container, ctx) {
  // The server gates PUT /api/seating/layout on the group role (admin/owner).
  // Mirror that check here so the editor is only shown when the save will
  // actually succeed.
  if (!isGroupAdmin()) {
    container.innerHTML = `${headerHtml()}
      <div class="grouped-page-sections"><section class="card grouped-page-section">${emptyStateHtml('Nur für Admins')}</section></div>`;
    return;
  }
  if ((cache === null || cacheStale) && !loading && !loadError) load(ctx);
  container.innerHTML = `
    ${headerHtml(cache ? `<button type="button" class="btn btn-sm" id="seating-table-edit"${saving ? ' disabled' : ''}>Tisch ändern</button>` : '')}
    ${cache === null
      ? `<div class="grouped-page-sections"><section class="card grouped-page-section">${emptyStateHtml(loading ? 'Lädt' : 'Sitzplan konnte nicht geladen werden')}</section></div>`
      : renderEditor()}`;
  if (cache) wireEditor(container, ctx);
}
