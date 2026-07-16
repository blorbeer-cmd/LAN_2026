// An-/Abreise + Fahrgemeinschaften: everyone records their own arrival and
// departure times, and creates/joins lightweight carpool groups for arrival
// or departure.

import { api } from '../api.js';
import { state } from '../state.js';
import { escapeHtml, avatarHtml, formatDateTime } from '../format.js';
import { openModal, confirmDialog } from '../modal.js';
import { showToast } from '../toast.js';
import { getMyId, whoAmICardHtml, wireWhoAmICard } from '../whoami.js';
import { dateTimeFieldHtml, wireDateTimeField } from '../dateTimeField.js';
import { icon } from '../icons.js';

let cache = null;
let loading = false;
let peopleSortKey = 'arrival';
let peopleSortDirection = 'asc';

async function load(ctx) {
  loading = true;
  try {
    cache = await api.arrivals.list();
  } catch (err) {
    showToast(err.message, { error: true });
    cache = { arrivals: [], carpools: { arrival: [], departure: [] } };
  } finally {
    loading = false;
    ctx.rerender();
  }
}

export function invalidateArrivals() {
  cache = null;
}

function parseDatetimeValue(value) {
  if (!value) return null;
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : NaN;
}

function renderMyForm(myId) {
  const own = (cache?.arrivals || []).find((a) => a.player_id === myId);
  return `
    <section class="card stack grouped-page-section arrivals-block" aria-labelledby="arrivals-mine-title">
      <div class="grouped-page-section-title"><h2 id="arrivals-mine-title">Meine An-/Abreise</h2></div>
      <form class="stack" id="arrival-form">
        <div class="field-row">
          <div>
            <label for="arrival-at" class="field-label">Anreise</label>
            ${dateTimeFieldHtml('arrival-at', own?.arrival_at ?? null, { clearable: true, disabled: !myId })}
          </div>
          <div>
            <label for="departure-at" class="field-label">Abreise</label>
            ${dateTimeFieldHtml('departure-at', own?.departure_at ?? null, { clearable: true, disabled: !myId })}
          </div>
        </div>
        <textarea class="arrival-note-input" id="arrival-note" maxlength="240" rows="1" placeholder="Notiz (optional)" ${myId ? '' : 'disabled'}>${escapeHtml(own?.note || '')}</textarea>
        <button type="submit" class="btn btn-primary btn-block" ${myId ? '' : 'disabled'}>Speichern</button>
      </form>
    </section>
  `;
}

function renderCarpool(c, direction, myId) {
  const isDriver = c.driverId === myId;
  const amIn = Boolean(myId && c.members.some((m) => m.id === myId));
  const canJoin = Boolean(myId && !isDriver && !amIn);
  const memberRowsHtml = c.members
    .map(
      (m) => `<div class="arrivals-member-row">
              ${avatarHtml(m, 24)}
              <span class="player-name">${escapeHtml(m.name)}</span>
              <span class="arrivals-member-role">${m.id === c.driverId ? 'Fahrer' : 'Mitfahrer'}</span>
            </div>`
    )
    .join('');
  const freeSeatRowsHtml = Array.from({ length: c.seatsFree }, () => {
    const control = canJoin
      ? `<button type="button" class="btn btn-sm btn-primary" data-join-carpool="${c.id}">Mitfahren</button>`
      : !myId
        ? '<button type="button" class="btn btn-sm" disabled>Mitfahren</button>'
        : '<span class="arrivals-member-role">Mitfahrer</span>';
    return `<div class="arrivals-member-row arrivals-free-seat-row">
      <span class="muted arrivals-free-seat-label">Frei</span>
      ${control}
    </div>`;
  }).join('');
  const memberHtml = `<div class="arrivals-member-list">${memberRowsHtml}${freeSeatRowsHtml}</div>`;
  const planLines = [
    `<div class="arrivals-time-line"><span>Start</span><strong>${c.startAt ? formatDateTime(c.startAt) : 'offen'}${c.startLocation ? ` ab ${escapeHtml(c.startLocation)}` : ''}</strong></div>`,
    `<div class="arrivals-time-line"><span>Ankunft</span><strong>${c.etaAt ? formatDateTime(c.etaAt) : 'offen'}</strong></div>`,
  ]
    .join('');

  let joinAction = '';
  if (myId && !isDriver && amIn) {
    joinAction = `<button type="button" class="btn btn-sm btn-block" data-leave-carpool="${c.id}">Austragen</button>`;
  }

  return `
    <div class="card stack arrivals-carpool-row" data-carpool="${c.id}">
      <div class="arrivals-carpool-head">
        <strong>${escapeHtml(c.label)}</strong>
        <span class="badge arrivals-carpool-seats">${c.seatsFree}/${c.seatsTotal} frei</span>
      </div>
      <div class="arrivals-time-pair">${planLines}</div>
      <div class="arrivals-carpool-members">
        ${memberHtml}
      </div>
      ${
        joinAction || isDriver
          ? `<div class="arrivals-carpool-actions${isDriver ? ' is-driver' : ''}">
               ${joinAction}
               ${isDriver ? `<button type="button" class="btn btn-sm btn-primary" data-edit-carpool="${c.id}">Bearbeiten</button>` : ''}
               ${isDriver ? `<button type="button" class="btn btn-sm btn-danger" data-remove-carpool="${c.id}">Löschen</button>` : ''}
             </div>`
          : ''
      }
      ${!myId ? `<div class="muted" style="font-size:var(--font-size-sm);">Wähle oben, wer du bist, um beizutreten.</div>` : ''}
    </div>`;
}

function renderCarpoolSection(direction, title, myId) {
  const rows = cache?.carpools?.[direction] || [];
  return `
    <section class="tournament-section-panel stack arrivals-carpool-section is-${direction}">
      <div class="row-between">
        <strong>${title}</strong>
        <button type="button" class="btn btn-sm btn-primary" data-new-carpool="${direction}" ${myId ? '' : 'disabled'}>+ Neu</button>
      </div>
      ${
        rows.length
          ? `<div class="two-column-card-grid arrivals-carpool-grid">${rows.map((c) => renderCarpool(c, direction, myId)).join('')}</div>`
          : `<div class="muted arrivals-carpool-empty">Noch keine Fahrgemeinschaft.</div>`
      }
    </section>`;
}

function renderCarpools(myId) {
  return `
    <section class="card stack grouped-page-section arrivals-block" aria-labelledby="arrivals-carpools-title">
      <div class="grouped-page-section-title"><h2 id="arrivals-carpools-title">Fahrgemeinschaften</h2></div>
      <div class="arrivals-carpool-directions">
        ${renderCarpoolSection('arrival', 'Anreise', myId)}
        ${renderCarpoolSection('departure', 'Abreise', myId)}
        ${
          myId
            ? ''
            : `<div class="muted" style="font-size:var(--font-size-sm);padding:0 12px 12px;">Wähle oben, wer du bist, um Fahrgemeinschaften anzulegen oder beizutreten.</div>`
        }
      </div>
    </section>`;
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

function renderPeopleList() {
  const byPlayer = new Map((cache?.arrivals || []).map((a) => [a.player_id, a]));
  const rows = [...state.players]
    .map((p) => ({ player: p, entry: byPlayer.get(p.id) || null }))
    .sort(comparePeopleRows)
    .map(({ player, entry }) => {
      const arrival = entry?.arrival_at ? formatDateTime(entry.arrival_at) : 'offen';
      const departure = entry?.departure_at ? formatDateTime(entry.departure_at) : 'offen';
      return `
        <div class="arrivals-times-row" role="row">
          <div class="arrivals-times-player" role="cell">
            ${avatarHtml(player, 30)}
            <span class="player-name">${escapeHtml(player.name)}</span>
          </div>
          <div class="arrivals-times-value" role="cell" data-label="Anreise"><strong>${escapeHtml(arrival)}</strong></div>
          <div class="arrivals-times-value" role="cell" data-label="Abreise"><strong>${escapeHtml(departure)}</strong></div>
          <div class="arrivals-times-note muted" role="cell" data-label="Notiz">${entry?.note ? escapeHtml(entry.note) : '–'}</div>
        </div>`;
    })
    .join('');

  return `
    <section class="card stack grouped-page-section" aria-labelledby="arrivals-times-title">
      <div class="grouped-page-section-title"><h2 id="arrivals-times-title">Alle Zeiten</h2></div>
      <div class="arrivals-mobile-sort" aria-label="Zeiten sortieren">
        <span class="muted">Sortieren:</span>
        ${renderPeopleSortButton('player', 'Spieler')}
        ${renderPeopleSortButton('arrival', 'Anreise')}
        ${renderPeopleSortButton('departure', 'Abreise')}
      </div>
      <div class="card arrivals-people-card" role="table" aria-label="An- und Abreisezeiten">
        ${
          rows
            ? `<div class="arrivals-times-header" role="row">
                 <span role="columnheader">${renderPeopleSortButton('player', 'Spieler')}</span>
                 <span role="columnheader">${renderPeopleSortButton('arrival', 'Anreise')}</span>
                 <span role="columnheader">${renderPeopleSortButton('departure', 'Abreise')}</span>
                 <span role="columnheader">Notiz</span>
               </div>${rows}`
            : '<div class="empty-state">Noch keine Spieler.</div>'
        }
      </div>
    </section>`;
}

// Shared create/edit form: `existing` is null for a new carpool (direction
// is fixed then, chosen from the section the "+ Neu" button lives in) or an
// existing carpool object to edit in place (direction can't change - editing
// only touches the driver's plan, not which list it's listed under).
function openCarpoolForm(direction, myId, ctx, existing = null) {
  const isEdit = Boolean(existing);
  const title = isEdit ? 'Fahrgemeinschaft bearbeiten' : direction === 'arrival' ? 'Anreise-Fahrgemeinschaft' : 'Abreise-Fahrgemeinschaft';
  const { close } = openModal(
    title,
    `
      <form id="carpool-form" class="stack">
        <input type="text" id="carpool-label" maxlength="120" required autofocus placeholder="z.B. Auto Tim" value="${escapeHtml(existing?.label ?? '')}" />
        <div>
          <label for="carpool-location" class="field-label">Von wo</label>
          <input type="text" id="carpool-location" maxlength="120" placeholder="z.B. Hamburg" value="${escapeHtml(existing?.startLocation ?? '')}" />
        </div>
        <div class="field-row">
          <div>
            <label for="carpool-start-at" class="field-label">Start</label>
            ${dateTimeFieldHtml('carpool-start-at', existing?.startAt ?? null, { clearable: true })}
          </div>
          <div>
            <label for="carpool-eta-at" class="field-label">Ankunft</label>
            ${dateTimeFieldHtml('carpool-eta-at', existing?.etaAt ?? null, { clearable: true })}
          </div>
        </div>
        <div>
          <label for="carpool-seats" class="field-label">Freie Plätze (ohne dich)</label>
          <input type="number" id="carpool-seats" min="1" max="8" value="${existing?.seatsTotal ?? 3}" />
        </div>
        <button type="submit" class="btn btn-primary btn-block">${isEdit ? 'Speichern' : 'Anlegen'}</button>
      </form>
    `,
    {
      onMount: (el) => {
        wireDateTimeField(el, 'carpool-start-at');
        wireDateTimeField(el, 'carpool-eta-at');

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
            cache = null;
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
  if (cache === null && !loading) load(ctx);
  const myId = getMyId();
  const loaded = cache !== null && !loading;

  container.innerHTML = `
    <button type="button" class="btn btn-sm" data-navigate="more">${icon('chevronLeft')} Zurück</button>
    <h1 class="view-title">An- & Abreise</h1>
    ${whoAmICardHtml('arrivals-whoami', { marginBottom: 'var(--space-3)' })}
    ${
      loaded
        ? `<div class="arrivals-layout grouped-page-sections">
             ${renderMyForm(myId)}
             ${renderCarpools(myId)}
             ${renderPeopleList()}
           </div>`
        : '<div class="empty-state">Lädt…</div>'
    }
  `;

  wireWhoAmICard(container, 'arrivals-whoami', ctx);
  if (!loaded) return;

  wireDateTimeField(container, 'arrival-at');
  wireDateTimeField(container, 'departure-at');

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
      cache = null;
      showToast('An-/Abreise gespeichert.');
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
        cache = null;
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
        cache = null;
        ctx.rerender();
      } catch (err) {
        showToast(err.message, { error: true });
      }
    });
  });

  container.querySelectorAll('[data-remove-carpool]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!(await confirmDialog('Fahrgemeinschaft löschen?'))) return;
      try {
        await api.arrivals.removeCarpool(btn.dataset.removeCarpool, myId);
        cache = null;
        showToast('Fahrgemeinschaft gelöscht.');
        ctx.rerender();
      } catch (err) {
        showToast(err.message, { error: true });
      }
    });
  });
}
