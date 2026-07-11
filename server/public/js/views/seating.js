// Shared physical table plan. Everyone can arrange players for now; keeping
// the write endpoint deliberately ungated leaves room for a future admin-only
// switch without changing the UI contract.
//
// Two interaction paths, same semantics: HTML5 drag & drop for mouse users,
// and tap-to-select → tap-to-place for touch devices (where the native drag
// events never fire). Both go through movePlayer() + save().

import { api } from '../api.js';
import { escapeHtml, avatarHtml } from '../format.js';
import { showToast } from '../toast.js';
import { icon } from '../icons.js';

const SIDES = ['top', 'right', 'bottom', 'left'];
const LABELS = { top: 'Oben', right: 'Rechts', bottom: 'Unten', left: 'Links' };
let cache = null;
let loading = false;
let saving = false;
// Tap-to-place selection: { playerId, source: {side, seat} | null (pool) }.
let selected = null;

// A player's name/real name/avatar can change (players:changed) while this
// editor is already open with a cached layout — without this, the board
// would keep showing the pre-change data for the rest of the session
// instead of picking it up live (CLAUDE.md: realtime by default).
export function invalidateSeating() {
  cache = null;
}

function playerMap(players) {
  return new Map(players.map((player) => [player.id, player]));
}

function assignedIds(layout) {
  return new Set(layout.assignments.map((a) => a.playerId));
}

function assignmentAt(layout, side, seat) {
  return layout.assignments.find((a) => a.side === side && a.seat === seat);
}

// Gamer name plus, in small text right under it, the actual person's name
// (if set — see profile.js's "Richtiger Name") — reserved as an always-
// present (if empty, invisible) second line so seats stay a uniform height
// regardless of which players happen to have one set (see CLAUDE.md's
// list-row height rule).
function seatNamesHtml(player) {
  const realName = player.real_name;
  return `<span class="seating-seat-names">
    <span class="seating-seat-name">${escapeHtml(player.name)}</span>
    <span class="seating-seat-realname"${realName ? '' : ' style="visibility:hidden;"'}>${escapeHtml(realName || ' ')}</span>
  </span>`;
}

function seatHtml(layout, players, side, seat, editable) {
  const assignment = assignmentAt(layout, side, seat);
  const player = assignment ? playerMap(players).get(assignment.playerId) : null;
  const isSelected = editable && player && selected?.playerId === player.id;
  const title = player ? `${player.name}${player.real_name ? ` (${player.real_name})` : ''}` : 'Freier Sitzplatz';
  return `<div class="seating-seat ${player ? 'is-occupied' : ''} ${isSelected ? 'is-selected' : ''}" data-seat-side="${side}" data-seat-index="${seat}" ${player ? `data-player-id="${player.id}"` : ''}
      ${editable && player ? 'draggable="true"' : ''} title="${escapeHtml(title)}">
    ${player ? `${avatarHtml(player, 30)}${seatNamesHtml(player)}` : `<span class="seating-seat-number">${seat + 1}</span><span class="muted">frei</span>`}
  </div>`;
}

function sideHtml(layout, players, side, editable) {
  const count = layout[`${side}Seats`];
  return `<section class="seating-side seating-side-${side}">
    <div class="seating-side-label">${LABELS[side]}</div>
    <div class="seating-side-seats">${Array.from({ length: count }, (_, seat) => seatHtml(layout, players, side, seat, editable)).join('')}</div>
  </section>`;
}

export function renderSeatingPlan(layout, players, { editable = false } = {}) {
  return `<div class="seating-plan ${editable ? 'is-editable' : 'is-readonly'} ${editable && selected ? 'is-moving' : ''}">
    ${sideHtml(layout, players, 'top', editable)}
    ${sideHtml(layout, players, 'right', editable)}
    <div class="seating-table-center">
      <div class="seating-table-mark"><strong>Sitzplan</strong></div>
      ${editable ? `<span class="muted">${selected ? 'Zielplatz antippen' : 'Spieler ziehen oder antippen'}</span>` : ''}
    </div>
    ${sideHtml(layout, players, 'bottom', editable)}
    ${sideHtml(layout, players, 'left', editable)}
  </div>`;
}

function renderSideControls(layout) {
  return `<div class="seating-controls card">
    <div class="section-title">Plätze pro Tischseite</div>
    <div class="seating-control-grid">${SIDES.map((side) => `
      <label>${LABELS[side]}
        <input type="number" min="0" max="12" value="${layout[`${side}Seats`]}" data-seat-count="${side}" />
      </label>`).join('')}</div>
    <div class="muted seating-save-status">${saving ? 'Speichert…' : 'Änderungen werden automatisch gespeichert.'}</div>
  </div>`;
}

function renderPool(layout, players) {
  const assigned = assignedIds(layout);
  const unassigned = players.filter((player) => !assigned.has(player.id));
  return `<div class="seating-pool card">
    <div class="row-between"><div class="section-title" style="margin:0;">Spieler</div><span class="muted">${unassigned.length} frei</span></div>
    <div class="seating-player-pool" data-seat-pool>
      ${unassigned.length ? unassigned.map((player) => `<div class="seating-pool-player ${selected?.playerId === player.id ? 'is-selected' : ''}" draggable="true" data-player-id="${player.id}">${avatarHtml(player, 28)}${seatNamesHtml(player)}</div>`).join('') : '<span class="muted">Alle Spieler sitzen bereits am Tisch.</span>'}
    </div>
  </div>`;
}

function renderEditor() {
  const { layout, players } = cache;
  return `<div class="seating-editor">
    ${renderSeatingPlan(layout, players, { editable: true })}
    <p class="muted seating-hint">${icon('monitor')} Wer an derselben Tischkante nebeneinander sitzt, bekommt sich gegenseitig
      automatisch als „Sichtbare Monitore" im Profil vorausgefüllt.</p>
    ${renderSideControls(layout)}
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

function movePlayer(playerId, side, seat, source = null) {
  const layout = cache.layout;
  const displaced = side && seat !== null
    ? layout.assignments.find((a) => a.side === side && a.seat === seat && a.playerId !== playerId)
    : null;
  layout.assignments = layout.assignments.filter((a) => a.playerId !== playerId && !(a.side === side && a.seat === seat));
  if (side && seat !== null) {
    layout.assignments.push({ side, seat, playerId });
    // When both ends are table seats, move the destination player into the
    // source seat. A pool-to-seat drop intentionally leaves them unassigned.
    if (displaced && source?.side && source.seat !== null) {
      layout.assignments = layout.assignments.filter((a) => !(a.side === source.side && a.seat === source.seat));
      layout.assignments.push({ side: source.side, seat: source.seat, playerId: displaced.playerId });
    }
  }
}

function wireEditor(container, ctx) {
  let draggedPlayerId = null;
  let draggedSource = null;
  const plan = container.querySelector('.seating-plan');
  container.querySelectorAll('[data-player-id]').forEach((element) => {
    element.addEventListener('dragstart', (event) => {
      selected = null; // a drag replaces any pending tap-selection
      draggedPlayerId = element.dataset.playerId;
      draggedSource = element.dataset.seatSide
        ? { side: element.dataset.seatSide, seat: Number(element.dataset.seatIndex) }
        : null;
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', draggedPlayerId);
      plan.classList.add('is-moving');
    });
    element.addEventListener('dragend', () => plan.classList.remove('is-moving'));
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
    // Tap path: first tap selects an occupied seat, second tap places the
    // selection here (swapping with any occupant, same as a drag would).
    seat.addEventListener('click', async () => {
      const occupantId = seat.dataset.playerId || null;
      if (!selected) {
        if (!occupantId) return;
        selected = { playerId: occupantId, source: { side: seat.dataset.seatSide, seat: Number(seat.dataset.seatIndex) } };
        ctx.rerender();
        return;
      }
      if (selected.playerId === occupantId) {
        selected = null;
        ctx.rerender();
        return;
      }
      const { playerId, source } = selected;
      selected = null;
      movePlayer(playerId, seat.dataset.seatSide, Number(seat.dataset.seatIndex), source);
      await save(ctx);
    });
  });
  const pool = container.querySelector('[data-seat-pool]');
  if (pool) {
    pool.addEventListener('dragover', (event) => { event.preventDefault(); pool.classList.add('is-drag-target'); });
    pool.addEventListener('dragleave', () => pool.classList.remove('is-drag-target'));
    pool.addEventListener('drop', async (event) => {
      event.preventDefault();
      pool.classList.remove('is-drag-target');
      const playerId = draggedPlayerId || event.dataTransfer.getData('text/plain');
      if (!playerId) return;
      movePlayer(playerId, null, null);
      draggedPlayerId = null;
      draggedSource = null;
      await save(ctx);
    });
    // Tap path: tapping a pool chip selects it for placing; tapping the empty
    // pool area while a seated player is selected sends them back to the pool.
    pool.querySelectorAll('[data-player-id]').forEach((chip) => {
      chip.addEventListener('click', () => {
        selected = selected?.playerId === chip.dataset.playerId
          ? null
          : { playerId: chip.dataset.playerId, source: null };
        ctx.rerender();
      });
    });
    pool.addEventListener('click', async (event) => {
      if (event.target.closest('[data-player-id]')) return; // chip clicks handled above
      if (!selected) return;
      if (!selected.source) {
        selected = null; // pool chip tapped, then pool background: just deselect
        ctx.rerender();
        return;
      }
      const { playerId } = selected;
      selected = null;
      movePlayer(playerId, null, null);
      await save(ctx);
    });
  }
  container.querySelectorAll('[data-seat-count]').forEach((input) => {
    input.addEventListener('change', async () => {
      const side = input.dataset.seatCount;
      cache.layout[`${side}Seats`] = Math.max(0, Math.min(12, Number(input.value) || 0));
      cache.layout.assignments = cache.layout.assignments.filter((a) => a.side !== side || a.seat < cache.layout[`${side}Seats`]);
      await save(ctx);
    });
  });
}

async function load(ctx) {
  loading = true;
  try {
    cache = await api.seating.layout();
  } catch (err) {
    showToast(err.message, { error: true });
    cache = null;
  } finally {
    loading = false;
    ctx.rerender();
  }
}

export function renderSeating(container, ctx) {
  if (cache === null && !loading) load(ctx);
  container.innerHTML = `
    <button type="button" class="btn btn-sm" data-navigate="settings">‹ Zurück</button>
    <h1 class="view-title">${icon('armchair')} Sitzplan</h1>
    ${loading || cache === null ? '<div class="empty-state">Lädt…</div>' : renderEditor()}`;
  if (cache) wireEditor(container, ctx);
}
