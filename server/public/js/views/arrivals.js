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

let cache = null;
let loading = false;

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
    <div class="arrivals-block">
      <div class="section-title">Meine An-/Abreise</div>
      <form class="card stack" id="arrival-form">
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
        <textarea id="arrival-note" maxlength="240" rows="2" placeholder="Notiz, z.B. komme erst nach der Arbeit" ${myId ? '' : 'disabled'}>${escapeHtml(own?.note || '')}</textarea>
        <button type="submit" class="btn btn-primary btn-block" ${myId ? '' : 'disabled'}>Speichern</button>
      </form>
    </div>
  `;
}

function renderCarpool(c, direction, myId) {
  const isDriver = c.driverId === myId;
  const amIn = Boolean(myId && c.members.some((m) => m.id === myId));
  const full = c.seatsFree <= 0;
  const memberHtml =
    c.members.length > 0
      ? `<div class="row arrivals-chip-row">${c.members
          .map((m) => `<span class="chip">${avatarHtml(m, 18)} ${escapeHtml(m.name)}${m.id === c.driverId ? ' 🚗 Fahrer' : ''}</span>`)
          .join('')}</div>`
      : `<div class="muted" style="font-size:0.85rem;">Noch niemand dabei.</div>`;
  const planLines = [
    c.startAt || c.startLocation
      ? `<div class="arrivals-time-line"><span>🕐</span><strong>${c.startAt ? formatDateTime(c.startAt) : 'Zeit offen'}${c.startLocation ? ` ab ${escapeHtml(c.startLocation)}` : ''}</strong></div>`
      : '',
    c.etaAt ? `<div class="arrivals-time-line"><span>🏁</span><strong>ETA ${formatDateTime(c.etaAt)}</strong></div>` : '',
    `<div class="arrivals-time-line"><span>💺</span><strong>${c.seatsFree}/${c.seatsTotal} frei</strong></div>`,
  ]
    .filter(Boolean)
    .join('');

  let joinAction = '';
  if (myId && !isDriver) {
    if (amIn) {
      joinAction = `<button type="button" class="btn btn-sm" data-leave-carpool="${c.id}">Raus</button>`;
    } else if (full) {
      joinAction = `<button type="button" class="btn btn-sm" disabled>Voll</button>`;
    } else {
      joinAction = `<button type="button" class="btn btn-sm btn-primary" data-join-carpool="${c.id}">Dabei</button>`;
    }
  }

  return `
    <div class="arrivals-carpool-row">
      <div class="arrivals-carpool-head">
        <div>
          <strong>${escapeHtml(c.label)}</strong>
          <div class="muted" style="font-size:0.78rem;">🚗 ${escapeHtml(c.createdByName)} fährt · angelegt ${formatDateTime(c.createdAt)}</div>
        </div>
        <div class="arrivals-carpool-actions">
          ${joinAction}
          ${isDriver ? `<button type="button" class="btn btn-sm" data-edit-carpool="${c.id}">Bearbeiten</button>` : ''}
          ${isDriver ? `<button type="button" class="btn btn-sm btn-danger" data-remove-carpool="${c.id}">Löschen</button>` : ''}
        </div>
      </div>
      ${planLines}
      ${memberHtml}
      ${!myId ? `<div class="muted" style="font-size:0.85rem;">Wähle oben, wer du bist, um beizutreten.</div>` : ''}
    </div>`;
}

function renderCarpoolSection(direction, title, myId) {
  const rows = cache?.carpools?.[direction] || [];
  return `
    <div class="arrivals-carpool-section">
      <div class="row-between">
        <strong>${title}</strong>
        <button type="button" class="btn btn-sm" data-new-carpool="${direction}" ${myId ? '' : 'disabled'}>+ Neu</button>
      </div>
      ${rows.length ? rows.map((c) => renderCarpool(c, direction, myId)).join('') : `<div class="muted arrivals-carpool-empty">Noch keine Fahrgemeinschaft.</div>`}
    </div>`;
}

function renderCarpools(myId) {
  return `
    <div class="arrivals-block">
      <div class="section-title">Fahrgemeinschaften</div>
      <div class="card stack arrivals-carpool-card">
        ${renderCarpoolSection('arrival', 'Anreise', myId)}
        ${renderCarpoolSection('departure', 'Abreise', myId)}
        ${
          myId
            ? ''
            : `<div class="muted" style="font-size:0.85rem;padding:0 12px 12px;">Wähle oben, wer du bist, um Fahrgemeinschaften anzulegen oder beizutreten.</div>`
        }
      </div>
    </div>`;
}

function renderPeopleList() {
  const byPlayer = new Map((cache?.arrivals || []).map((a) => [a.player_id, a]));
  const rows = [...state.players]
    .map((p) => ({ player: p, entry: byPlayer.get(p.id) || null }))
    .sort((a, b) => {
      const atA = a.entry?.arrival_at ?? a.entry?.departure_at ?? Number.MAX_SAFE_INTEGER;
      const atB = b.entry?.arrival_at ?? b.entry?.departure_at ?? Number.MAX_SAFE_INTEGER;
      if (atA !== atB) return atA - atB;
      return a.player.name.localeCompare(b.player.name, 'de');
    })
    .map(({ player, entry }) => {
      const arrival = entry?.arrival_at ? formatDateTime(entry.arrival_at) : 'offen';
      const departure = entry?.departure_at ? formatDateTime(entry.departure_at) : 'offen';
      return `
        <div class="arrivals-person-row">
          ${avatarHtml(player, 30)}
          <span class="arrivals-person-main">
            <div class="player-name">${escapeHtml(player.name)}</div>
            <div class="arrivals-time-line"><span>An</span><strong>${escapeHtml(arrival)}</strong></div>
            <div class="arrivals-time-line"><span>Ab</span><strong>${escapeHtml(departure)}</strong></div>
            ${entry?.note ? `<div class="muted arrivals-note">${escapeHtml(entry.note)}</div>` : ''}
          </span>
        </div>`;
    })
    .join('');

  return `
    <div class="section-title">Alle Zeiten</div>
    <div class="card arrivals-people-card">${rows || '<div class="empty-state">Noch keine Spieler.</div>'}</div>`;
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
            <label for="carpool-eta-at" class="field-label">ETA (Ankunft ca.)</label>
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
    <button type="button" class="btn btn-sm" data-navigate="more">‹ Zurück</button>
    <h1 class="view-title">🚗 An- & Abreise</h1>
    ${whoAmICardHtml('arrivals-whoami', { marginBottom: '12px' })}
    ${
      loaded
        ? `<div class="arrivals-layout">
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
