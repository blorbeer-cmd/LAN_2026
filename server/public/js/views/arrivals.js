// An-/Abreise + Fahrgemeinschaften: everyone records their own arrival and
// departure times, and creates/joins lightweight carpool groups for arrival
// or departure.

import { api } from '../api.js';
import { eventPlayers, state } from '../state.js';
import { escapeHtml, avatarHtml, formatDateTime } from '../format.js';
import { openModal, confirmDialog } from '../modal.js';
import { showToast } from '../toast.js';
import { getMyId } from '../whoami.js';
import {
  captureDateTimeFieldDraft,
  dateTimeFieldHtml,
  parseDatetimeLocalMs,
  restoreDateTimeFieldDraft,
  wireDateTimeField,
  wireDateTimeRange,
} from '../dateTimeField.js';
import { icon } from '../icons.js';
import { emptyStateHtml } from '../emptyState.js';

let cache = null;
let loading = false;
// Set instead of nulling `cache` directly after an action or a remote
// arrivals:changed event: renderArrivals() keeps showing the last-known
// carpools/times while a background refetch is in flight, rather than
// collapsing the whole section down to a one-line "Lädt…" placeholder and
// back - that height jump was clamping the scroll container's scrollTop
// back to the top on every save/join/leave.
let dirty = false;
let peopleSortKey = 'arrival';
let peopleSortDirection = 'asc';
// Open state of the collapsible "Alle Zeiten" card, kept across live re-renders.
let peopleListOpen = false;

async function load(ctx) {
  loading = true;
  dirty = false;
  try {
    cache = await api.arrivals.list();
  } catch (err) {
    showToast(err.message, { error: true });
    if (cache === null) cache = { arrivals: [], carpools: { arrival: [], departure: [] } };
  } finally {
    loading = false;
    ctx.rerender();
  }
}

export function invalidateArrivals({ hard = false } = {}) {
  dirty = true;
  if (hard) cache = null;
}

function parseDatetimeValue(value) {
  if (!value) return null;
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : NaN;
}

// Nobody has entered their own Ankunft/Abreise yet on a fresh event, so the
// still-empty fields default to the event's own start/end instead of a blank
// widget - only once both are actually set, since a one-sided default (e.g.
// arrival prefilled, departure left open) would look like a stray guess.
export function eventArrivalDepartureDefaults(event) {
  if (event?.startsAt == null || event?.endsAt == null) return { arrivalAt: null, departureAt: null };
  return { arrivalAt: event.startsAt, departureAt: event.endsAt };
}

// Merges the persisted "own" row, the event default and any unsaved draft
// into what the form should show. `own` existing at all - even with a
// `null` field - means the player has a saved arrivals row and that null
// was an explicit choice (PUT /mine can store null directly, and
// leaving/losing a carpool resets the synced field to null server-side via
// syncOwnDirectionField in src/routes/arrivals.ts). Only the complete
// absence of a row falls back to the event default; a stored null sticks.
export function resolveMyArrivalFields(own, defaults, draft) {
  if (draft) return { arrivalAt: draft.arrivalAt, departureAt: draft.departureAt, note: draft.note };
  return {
    arrivalAt: own ? own.arrival_at : defaults.arrivalAt,
    departureAt: own ? own.departure_at : defaults.departureAt,
    note: own ? (own.note || '') : '',
  };
}

// `draft`, if given, overrides the persisted "own" values with whatever was
// still sitting unsaved in the form at the moment of a background re-render
// (see renderArrivals' snapshot below) - same survives-its-own-rerender
// pattern the Checkliste's add-item field and Vote's round fields use.
function renderMyForm(myId, draft) {
  const own = (cache?.arrivals || []).find((a) => a.player_id === myId);
  const defaults = eventArrivalDepartureDefaults(state.activeEvent);
  const { arrivalAt, departureAt, note } = resolveMyArrivalFields(own, defaults, draft);
  return `
    <section class="card stack grouped-page-section arrivals-block" aria-labelledby="arrivals-mine-title">
      <div class="grouped-page-section-title"><h2 id="arrivals-mine-title">Meine An- & Abreise</h2></div>
      <form class="stack" id="arrival-form">
        <div class="field-row">
          <div>
            <label for="arrival-at-date" class="field-label">Ankunft</label>
            ${dateTimeFieldHtml('arrival-at', arrivalAt, { clearable: true, disabled: !myId, label: 'Ankunft' })}
          </div>
          <div>
            <label for="departure-at-date" class="field-label">Abreise</label>
            ${dateTimeFieldHtml('departure-at', departureAt, { clearable: true, disabled: !myId, label: 'Abreise' })}
          </div>
        </div>
        <div>
          <label for="arrival-note" class="field-label">Notiz</label>
          <textarea class="arrival-note-input" id="arrival-note" maxlength="240" rows="1" placeholder="Komme erst gegen 20 Uhr" ${myId ? '' : 'disabled'}>${escapeHtml(note)}</textarea>
        </div>
        <div class="arrivals-form-footer">
          <button type="submit" class="btn btn-primary btn-sm" ${myId ? '' : 'disabled'}>Speichern</button>
        </div>
      </form>
    </section>
  `;
}

// A control inside the still-mounted "Meine An-/Abreise" form that currently
// has focus, expressed as a selector that resolves to the equivalent control
// in the freshly rendered form. Only the note textarea has a stable id; the
// date widget's visible date/time controls are matched through the field's
// data-dt-field id so focus survives the render.
function focusedArrivalControlSelector(container) {
  const active = document.activeElement;
  if (!active || !container.contains(active)) return null;
  if (active.id === 'arrival-note') return '#arrival-note';
  const field = active.closest('[data-dt-field]');
  if (!field) return null;
  const fieldSelector = `[data-dt-field="${field.dataset.dtField}"]`;
  if (active.matches('[data-dt-trigger]')) return `${fieldSelector} [data-dt-trigger]`;
  if (active.matches('[data-dt-date]')) return `${fieldSelector} [data-dt-date]`;
  if (active.matches('[data-dt-time]')) return `${fieldSelector} [data-dt-time]`;
  return null;
}

// Start place, start time and arrival time share one compact
// meta line; unknown values are left out instead of printing "offen". The
// arrival drops its date when it falls on the start's day.
function carpoolMetaLine(c) {
  const sameDay = c.startAt && c.etaAt && new Date(c.startAt).toDateString() === new Date(c.etaAt).toDateString();
  const time = (ms) => new Date(ms).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
  return [
    c.startLocation ? `ab ${c.startLocation}` : null,
    c.startAt ? `Start ${formatDateTime(c.startAt)}` : null,
    c.etaAt ? `Ankunft ${sameDay ? time(c.etaAt) : formatDateTime(c.etaAt)}` : null,
  ]
    .filter(Boolean)
    // Non-breaking spaces keep each fact on one line; wrapping happens only
    // after a separator dot.
    .map((part) => escapeHtml(part).replace(/ /g, '&nbsp;'))
    .join(' · ');
}

// A player can only drive or ride along in one carpool per direction (see
// server/src/routes/arrivals.ts) - otherwise, which carpool would their own
// Ankunft/Abreise above sync with? `elsewhere` marks that they're already
// committed to a *different* carpool of this direction, so the card offers
// no "Eintragen" then. Joining and leaving share the same header slot; the
// driver gets "Bearbeiten" there, and deleting lives in that edit dialog.
function carpoolHeaderAction(c, myId, elsewhere) {
  if (!myId) return '';
  if (c.driverId === myId) {
    return `<button type="button" class="btn btn-sm" data-edit-carpool="${c.id}">Bearbeiten</button>`;
  }
  if (c.members.some((m) => m.id === myId)) {
    return `<button type="button" class="btn btn-sm" data-leave-carpool="${c.id}">Austragen</button>`;
  }
  if (!elsewhere && c.seatsFree > 0) {
    return `<button type="button" class="btn btn-sm" data-join-carpool="${c.id}">Eintragen</button>`;
  }
  return '';
}

function renderCarpool(c, myId, elsewhere) {
  const members = [...c.members].sort((a, b) => Number(b.id === c.driverId) - Number(a.id === c.driverId));
  const memberRowsHtml = members
    .map(
      (m) => `<div class="arrivals-member-row">
              ${avatarHtml(m, 24)}
              <span class="player-name">${escapeHtml(m.name)}</span>
              ${m.id === c.driverId ? '<span class="arrivals-member-role">Fahrer</span>' : ''}
            </div>`
    )
    .join('');
  // Every free seat is an empty row; joining happens in the card header.
  const freeSeatRowsHtml = Array.from(
    { length: c.seatsFree },
    () => '<div class="arrivals-member-row arrivals-free-seat-row"><span class="muted">Frei</span></div>'
  ).join('');
  const meta = carpoolMetaLine(c);
  return `
    <article class="card arrivals-carpool-card" data-carpool="${c.id}">
      <header class="arrivals-carpool-head">
        <span class="arrivals-carpool-title">
          <strong>${escapeHtml(c.label)}</strong>
          ${meta ? `<span class="muted arrivals-carpool-meta">${meta}</span>` : ''}
        </span>
        <span class="arrivals-carpool-action">${carpoolHeaderAction(c, myId, elsewhere)}</span>
      </header>
      <div class="arrivals-member-list">${memberRowsHtml}${freeSeatRowsHtml}</div>
    </article>`;
}

function isCommittedToDirection(direction, myId) {
  const rows = cache?.carpools?.[direction] || [];
  return Boolean(myId && rows.some((c) => c.driverId === myId || c.members.some((m) => m.id === myId)));
}

function renderCarpoolSection(direction, title, myId) {
  const rows = cache?.carpools?.[direction] || [];
  const committed = isCommittedToDirection(direction, myId);
  const titleId = `arrivals-carpools-${direction}-title`;
  return `
    <section class="card stack grouped-page-section arrivals-block arrivals-carpool-section" data-carpool-direction="${direction}" aria-labelledby="${titleId}">
      <div class="grouped-page-section-title">
        <h2 id="${titleId}">${title}</h2>
        ${myId && !committed ? `<button type="button" class="btn btn-sm btn-primary" data-new-carpool="${direction}">Fahrt anlegen</button>` : ''}
      </div>
      ${
        rows.length
          ? `<div class="two-column-card-grid arrivals-carpool-grid">${rows.map((c) => renderCarpool(c, myId, committed && c.driverId !== myId && !c.members.some((m) => m.id === myId))).join('')}</div>`
          : emptyStateHtml('Noch keine Fahrgemeinschaft.')
      }
    </section>`;
}

function renderCarpools(myId) {
  return `
    ${renderCarpoolSection('arrival', 'Fahrgemeinschaften Anreise', myId)}
    ${renderCarpoolSection('departure', 'Fahrgemeinschaften Abreise', myId)}`;
}

function comparePeopleRows(a, b) {
  if (peopleSortKey === 'player') {
    const difference = a.player.name.localeCompare(b.player.name, 'de');
    return peopleSortDirection === 'asc' ? difference : -difference;
  }

  const field = peopleSortKey === 'departure' ? 'departure_at' : 'arrival_at';
  const valueA = a.entry?.[field] ?? null;
  const valueB = b.entry?.[field] ?? null;

  // Offene Angaben bleiben unabhängig von der Sortierrichtung am Ende.
  if (valueA === null && valueB === null) return a.player.name.localeCompare(b.player.name, 'de');
  if (valueA === null) return 1;
  if (valueB === null) return -1;

  const difference = valueA - valueB || a.player.name.localeCompare(b.player.name, 'de');
  return peopleSortDirection === 'asc' ? difference : -difference;
}

function renderPeopleSortButton(key, label) {
  const isActive = peopleSortKey === key;
  const directionLabel = peopleSortDirection === 'asc' ? 'aufsteigend' : 'absteigend';
  return `<button
    type="button"
    class="arrivals-sort-button${isActive ? ' is-active' : ''}"
    data-arrivals-sort="${key}"
    aria-pressed="${isActive}"
    aria-label="${label}: ${isActive ? directionLabel : 'nicht sortiert'}"
  >
    <span>${label}</span>
    ${isActive ? icon(peopleSortDirection === 'asc' ? 'arrowUp' : 'arrowDown') : ''}
  </button>`;
}

// Whoever a player rides with (not their own carpool, if they drive) - shown
// as a small hint next to their Ankunft/Abreise in the table below.
function carpoolDriverName(direction, playerId) {
  const rows = cache?.carpools?.[direction] || [];
  const carpool = rows.find((c) => c.driverId !== playerId && c.members.some((m) => m.id === playerId));
  return carpool?.createdByName ?? null;
}

// Only the people who actually accepted the current event belong here.
// state.players is the whole instance roster (GET /api/players is not event
// scoped), so the table used to pad itself with everyone who was merely
// invited, declined or has nothing to do with this LAN - a wall of permanent
// "offen" rows around the handful of real answers. eventPlayers() is the same
// accepted-only set the team pickers draw from and falls back to the full
// roster while the active event's participant ids are still unknown, so the
// list is never empty just because the events payload has not landed yet.
export function arrivalsPeopleRows(arrivals) {
  const byPlayer = new Map((arrivals || []).map((a) => [a.player_id, a]));
  return eventPlayers().map((p) => ({ player: p, entry: byPlayer.get(p.id) || null }));
}

function renderTimeCell(value, label, driver) {
  return `<div class="arrivals-times-value" role="cell" data-label="${label}">
    ${value ? `<strong>${escapeHtml(formatDateTime(value))}</strong>` : '<span class="muted">offen</span>'}
    ${driver ? `<span class="muted arrivals-times-driver">mit ${escapeHtml(driver)}</span>` : ''}
  </div>`;
}

function renderPeopleList() {
  const people = arrivalsPeopleRows(cache?.arrivals).sort(comparePeopleRows);
  const rows = people
    .map(({ player, entry }) => `
        <div class="arrivals-times-row" role="row">
          <div class="arrivals-times-player" role="cell">
            ${avatarHtml(player, 24)}
            <span class="arrivals-times-name">
              <span class="player-name">${escapeHtml(player.name)}</span>
              ${entry?.note ? `<span class="muted arrivals-times-note">${escapeHtml(entry.note)}</span>` : ''}
            </span>
          </div>
          ${renderTimeCell(entry?.arrival_at, 'Ankunft', carpoolDriverName('arrival', player.id))}
          ${renderTimeCell(entry?.departure_at, 'Abreise', carpoolDriverName('departure', player.id))}
        </div>`)
    .join('');

  return `
    <details class="card grouped-page-section history-details collapsible-section arrivals-times-section" data-arrivals-times ${peopleListOpen ? 'open' : ''}>
      <summary class="collapsible-section-header">
        <h2 id="arrivals-times-title">Alle Zeiten</h2>
        <span class="collapsible-section-summary-end">
          <span class="badge badge-offline">${people.length}</span>
          <span class="collapsible-section-chevron" aria-hidden="true">${icon('chevronRight')}</span>
        </span>
      </summary>
      <div class="collapsible-section-content stack">
        ${
          people.length
            ? `<div class="arrivals-mobile-sort" aria-label="Zeiten sortieren">
                 ${renderPeopleSortButton('player', 'Person')}
                 ${renderPeopleSortButton('arrival', 'Ankunft')}
                 ${renderPeopleSortButton('departure', 'Abreise')}
               </div>
               <div class="arrivals-times-table" role="table" aria-labelledby="arrivals-times-title">
                 <div class="arrivals-times-header" role="row">
                   <span role="columnheader">${renderPeopleSortButton('player', 'Person')}</span>
                   <span role="columnheader">${renderPeopleSortButton('arrival', 'Ankunft')}</span>
                   <span role="columnheader">${renderPeopleSortButton('departure', 'Abreise')}</span>
                 </div>${rows}
               </div>`
            : emptyStateHtml('Noch keine Teilnehmenden.')
        }
      </div>
    </details>`;
}

// Shared create/edit form: `existing` is null for a new carpool (direction
// is fixed then, chosen from the section the "Fahrt anlegen" button lives in) or an
// existing carpool object to edit in place (direction can't change - editing
// only touches the driver's plan, not which list it's listed under).
function openCarpoolForm(direction, myId, ctx, existing = null) {
  const isEdit = Boolean(existing);
  const title = isEdit ? 'Fahrgemeinschaft bearbeiten' : direction === 'arrival' ? 'Fahrgemeinschaft Anreise' : 'Fahrgemeinschaft Abreise';
  const own = (cache?.arrivals || []).find((a) => a.player_id === myId);
  // Neue Fahrgemeinschaft: das Feld, das zur eigenen Ankunft/Abreise oben
  // gehört (eta_at bei Anreise, start_at bei Abreise), wird damit vorbelegt.
  const defaultStartAt = !isEdit && direction === 'departure' ? (own?.departure_at ?? null) : null;
  const defaultEtaAt = !isEdit && direction === 'arrival' ? (own?.arrival_at ?? null) : null;
  let modalEl;
  const { close } = openModal(
    title,
    `
      <form id="carpool-form" class="stack">
        <div class="field-row">
          <div>
            <label for="carpool-label" class="field-label is-required">Bezeichnung</label>
            <input type="text" id="carpool-label" maxlength="120" required autofocus placeholder="Auto Tim" value="${escapeHtml(existing?.label ?? '')}" />
          </div>
          <div>
            <label for="carpool-location" class="field-label">Von wo</label>
            <input type="text" id="carpool-location" maxlength="120" placeholder="Hamburg" value="${escapeHtml(existing?.startLocation ?? '')}" />
          </div>
        </div>
        <div class="field-row">
          <div>
            <label for="carpool-start-at-date" class="field-label">Start</label>
            ${dateTimeFieldHtml('carpool-start-at', existing?.startAt ?? defaultStartAt, { clearable: true, label: 'Start' })}
          </div>
          <div>
            <label for="carpool-eta-at-date" class="field-label">Ankunft</label>
            ${dateTimeFieldHtml('carpool-eta-at', existing?.etaAt ?? defaultEtaAt, { clearable: true, label: 'Ankunft' })}
          </div>
        </div>
        <div>
          <label for="carpool-seats" class="field-label">Freie Plätze (ohne dich)</label>
          <input type="number" id="carpool-seats" min="1" max="8" value="${existing?.seatsTotal ?? 3}" />
        </div>
        <div class="arrivals-form-footer">
          ${isEdit ? '<button type="button" class="btn btn-sm" data-carpool-delete>Löschen</button>' : ''}
          <button type="submit" class="btn btn-primary btn-sm">${isEdit ? 'Speichern' : 'Anlegen'}</button>
        </div>
      </form>
    `,
    {
      confirmClose: () => {
        if (!modalEl) return null;
        const label = modalEl.querySelector('#carpool-label').value.trim();
        const location = modalEl.querySelector('#carpool-location').value.trim();
        const dirty = isEdit
          ? label !== (existing.label ?? '') || location !== (existing.startLocation ?? '')
          : Boolean(label || location);
        return dirty ? 'Die eingegebenen Fahrgemeinschaftsdaten (Bezeichnung, Ort, Zeiten, Plätze) gehen verloren.' : null;
      },
      onMount: (el) => {
        modalEl = el;
        wireDateTimeField(el, 'carpool-start-at');
        wireDateTimeField(el, 'carpool-eta-at');
        wireDateTimeRange(el, 'carpool-start-at', 'carpool-eta-at');

        el.querySelector('[data-carpool-delete]')?.addEventListener('click', async () => {
          if (!(await confirmDialog('Fahrgemeinschaft löschen?', { confirmText: 'Löschen', danger: true }))) return;
          try {
            await api.arrivals.removeCarpool(existing.id, myId);
            close();
            dirty = true;
            showToast('Fahrgemeinschaft gelöscht.');
            ctx.rerender();
          } catch (err) {
            showToast(err.message, { error: true });
          }
        });

        el.querySelector('#carpool-form').addEventListener('submit', async (e) => {
          e.preventDefault();
          const label = el.querySelector('#carpool-label').value.trim();
          if (!label) return;
          const startLocation = el.querySelector('#carpool-location').value.trim() || null;
          const startAt = parseDatetimeValue(el.querySelector('#carpool-start-at').value);
          const etaAt = parseDatetimeValue(el.querySelector('#carpool-eta-at').value);
          const seatsTotal = Number(el.querySelector('#carpool-seats').value);
          if (Number.isNaN(startAt) || Number.isNaN(etaAt)) {
            return showToast('Bitte gültige Datum/Uhrzeit-Werte eintragen.', { error: true });
          }
          try {
            if (isEdit) {
              await api.arrivals.editCarpool(existing.id, { playerId: myId, label, startLocation, startAt, etaAt, seatsTotal });
            } else {
              await api.arrivals.createCarpool({ playerId: myId, direction, label, startLocation, startAt, etaAt, seatsTotal });
            }
            close();
            dirty = true;
            showToast(isEdit ? 'Fahrgemeinschaft aktualisiert.' : 'Fahrgemeinschaft angelegt.');
            ctx.rerender();
          } catch (err) {
            showToast(err.message, { error: true });
          }
        });
      },
    }
  );
}

export function renderArrivals(container, ctx) {
  if ((cache === null || dirty) && !loading) load(ctx);
  const myId = getMyId();
  // Once there's cached data, keep rendering it even while a refetch is in
  // flight (dirty or loading) - only the very first load has nothing to
  // show yet and falls back to the placeholder below.
  const loaded = cache !== null;

  // A background re-render can land while somebody is still typing their
  // Ankunft/Abreise/Notiz - e.g. an unrelated Orga To-Do event now re-renders
  // every Orga tab, not just the Checkliste's own (see app.js's
  // checklist:changed handler). Only treat the current DOM as an unsaved
  // draft when focus is actually inside the form: `own` can legitimately
  // change on its own (joining/editing/leaving a carpool syncs the matching
  // Ankunft/Abreise field server-side, see syncOwnDirectionField in
  // src/routes/arrivals.ts), and that sync must still show up whenever
  // nobody is mid-edit here.
  const focusedSelector = loaded ? focusedArrivalControlSelector(container) : null;
  const draft = focusedSelector
    ? {
        arrivalAt: parseDatetimeLocalMs(container.querySelector('#arrival-at')?.value),
        departureAt: parseDatetimeLocalMs(container.querySelector('#departure-at')?.value),
        arrivalInput: captureDateTimeFieldDraft(container, 'arrival-at'),
        departureInput: captureDateTimeFieldDraft(container, 'departure-at'),
        note: container.querySelector('#arrival-note')?.value ?? '',
      }
    : null;

  container.innerHTML = `
    ${
      loaded
        ? `<div class="arrivals-layout grouped-page-sections">
             ${renderMyForm(myId, draft)}
             ${renderCarpools(myId)}
             ${renderPeopleList()}
           </div>`
        : emptyStateHtml('Lädt…')
    }
  `;

  if (!loaded) return;

  container.querySelector('[data-arrivals-times]')?.addEventListener('toggle', (e) => {
    peopleListOpen = e.currentTarget.open;
  });
  wireDateTimeField(container, 'arrival-at');
  wireDateTimeField(container, 'departure-at');
  wireDateTimeRange(container, 'arrival-at', 'departure-at');
  restoreDateTimeFieldDraft(container, 'arrival-at', draft?.arrivalInput);
  restoreDateTimeFieldDraft(container, 'departure-at', draft?.departureInput);
  if (focusedSelector) container.querySelector(focusedSelector)?.focus();

  container.querySelectorAll('[data-arrivals-sort]').forEach((button) => {
    button.addEventListener('click', () => {
      const nextKey = button.dataset.arrivalsSort;
      if (peopleSortKey === nextKey) {
        peopleSortDirection = peopleSortDirection === 'asc' ? 'desc' : 'asc';
      } else {
        peopleSortKey = nextKey;
        peopleSortDirection = 'asc';
      }
      ctx.rerender();
    });
  });

  container.querySelector('#arrival-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!myId) return showToast('Bitte zuerst auswählen, wer du bist.', { error: true });
    const arrivalAt = parseDatetimeValue(container.querySelector('#arrival-at').value);
    const departureAt = parseDatetimeValue(container.querySelector('#departure-at').value);
    if (Number.isNaN(arrivalAt) || Number.isNaN(departureAt)) {
      return showToast('Bitte gültige Datum/Uhrzeit-Werte eintragen.', { error: true });
    }
    try {
      await api.arrivals.saveMine({
        playerId: myId,
        arrivalAt,
        departureAt,
        note: container.querySelector('#arrival-note').value.trim() || null,
      });
      dirty = true;
      showToast('An- & Abreise gespeichert.');
      ctx.rerender();
    } catch (err) {
      showToast(err.message, { error: true });
    }
  });

  container.querySelectorAll('[data-new-carpool]').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (!myId) return showToast('Bitte zuerst auswählen, wer du bist.', { error: true });
      openCarpoolForm(btn.dataset.newCarpool, myId, ctx);
    });
  });

  container.querySelectorAll('[data-edit-carpool]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const all = [...(cache?.carpools?.arrival || []), ...(cache?.carpools?.departure || [])];
      const carpool = all.find((c) => c.id === btn.dataset.editCarpool);
      if (carpool) openCarpoolForm(carpool.direction, myId, ctx, carpool);
    });
  });

  container.querySelectorAll('[data-join-carpool]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      try {
        await api.arrivals.joinCarpool(btn.dataset.joinCarpool, myId);
        dirty = true;
        ctx.rerender();
      } catch (err) {
        showToast(err.message, { error: true });
      }
    });
  });

  container.querySelectorAll('[data-leave-carpool]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      try {
        await api.arrivals.leaveCarpool(btn.dataset.leaveCarpool, myId);
        dirty = true;
        ctx.rerender();
      } catch (err) {
        showToast(err.message, { error: true });
      }
    });
  });

}
