// An-/Abreise + Fahrgemeinschaften: everyone records their own arrival and
// departure times, and creates/joins lightweight carpool groups for arrival
// or departure.

import { api } from '../api.js';
import { state } from '../state.js';
import { escapeHtml, avatarHtml, formatDateTime, toDatetimeLocal } from '../format.js';
import { openModal } from '../modal.js';
import { showToast } from '../toast.js';
import { getMyId, whoAmICardHtml, wireWhoAmICard } from '../whoami.js';

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

function datetimeValue(ms) {
  return ms ? toDatetimeLocal(ms) : '';
}

function parseDatetimeValue(value) {
  if (!value) return null;
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : NaN;
}

function renderMyForm(myId) {
  const own = (cache?.arrivals || []).find((a) => a.player_id === myId);
  return `
    <div class="section-title">Meine An-/Abreise</div>
    <form class="card stack" id="arrival-form">
      <div class="row" style="align-items:flex-start;">
        <div style="flex:1;">
          <label for="arrival-at" class="field-label">Anreise</label>
          <input type="datetime-local" id="arrival-at" value="${datetimeValue(own?.arrival_at)}" ${myId ? '' : 'disabled'} />
        </div>
        <div style="flex:1;">
          <label for="departure-at" class="field-label">Abreise</label>
          <input type="datetime-local" id="departure-at" value="${datetimeValue(own?.departure_at)}" ${myId ? '' : 'disabled'} />
        </div>
      </div>
      <textarea id="arrival-note" maxlength="240" rows="2" placeholder="Notiz, z.B. komme erst nach der Arbeit" ${myId ? '' : 'disabled'}>${escapeHtml(own?.note || '')}</textarea>
      <button type="submit" class="btn btn-primary btn-block" ${myId ? '' : 'disabled'}>Speichern</button>
    </form>
  `;
}

function renderCarpool(c, direction, myId) {
  const amIn = Boolean(myId && c.members.some((m) => m.id === myId));
  const memberHtml =
    c.members.length > 0
      ? `<div class="row" style="gap:4px;flex-wrap:wrap;">${c.members
          .map((m) => `<span class="chip">${avatarHtml(m, 18)} ${escapeHtml(m.name)}</span>`)
          .join('')}</div>`
      : `<div class="muted" style="font-size:0.85rem;">Noch niemand dabei.</div>`;
  return `
    <div class="card stack" style="gap:8px;">
      <div class="row-between">
        <strong>${escapeHtml(c.label)}</strong>
        ${c.createdBy === myId ? `<button type="button" class="btn btn-sm btn-danger" data-remove-carpool="${c.id}">Löschen</button>` : ''}
      </div>
      <div class="muted" style="font-size:0.78rem;">von ${escapeHtml(c.createdByName)} · ${formatDateTime(c.createdAt)}</div>
      ${memberHtml}
      ${
        myId
          ? `<button type="button" class="btn btn-sm ${amIn ? '' : 'btn-primary'}" data-${amIn ? 'leave' : 'join'}-carpool="${c.id}">${amIn ? 'Ich fahre doch nicht mit' : 'Ich bin dabei'}</button>`
          : `<div class="muted" style="font-size:0.85rem;">Wähle oben, wer du bist, um beizutreten.</div>`
      }
    </div>`;
}

function renderCarpoolSection(direction, title, myId) {
  const rows = cache?.carpools?.[direction] || [];
  return `
    <div class="section-title">${title}</div>
    <div class="stack" style="gap:10px;">
      ${rows.length ? rows.map((c) => renderCarpool(c, direction, myId)).join('') : `<div class="empty-state" style="padding:16px;">Noch keine Fahrgemeinschaft.</div>`}
      <button type="button" class="btn btn-sm" data-new-carpool="${direction}" ${myId ? '' : 'disabled'}>+ Fahrgemeinschaft</button>
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
      const times = [
        entry?.arrival_at ? `Anreise ${formatDateTime(entry.arrival_at)}` : null,
        entry?.departure_at ? `Abreise ${formatDateTime(entry.departure_at)}` : null,
      ].filter(Boolean);
      return `
        <div class="card row list-row">
          ${avatarHtml(player, 32)}
          <span style="flex:1;">
            <div class="player-name">${escapeHtml(player.name)}</div>
            <div class="muted list-row-desc">${times.length ? escapeHtml(times.join(' · ')) : 'Noch keine Zeiten eingetragen.'}</div>
            ${entry?.note ? `<div class="muted list-row-desc">${escapeHtml(entry.note)}</div>` : ''}
          </span>
        </div>`;
    })
    .join('');

  return `
    <div class="section-title">Alle Zeiten</div>
    <div class="card-grid">${rows || '<div class="empty-state">Noch keine Spieler.</div>'}</div>`;
}

function openCarpoolForm(direction, myId, ctx) {
  const label = direction === 'arrival' ? 'Anreise-Fahrgemeinschaft' : 'Abreise-Fahrgemeinschaft';
  const { close } = openModal(
    label,
    `
      <form id="carpool-form" class="stack">
        <input type="text" id="carpool-label" maxlength="120" required autofocus placeholder="z.B. Auto Tim, ab Hamburg 16 Uhr" />
        <button type="submit" class="btn btn-primary btn-block">Anlegen</button>
      </form>
    `,
    {
      onMount: (el) => {
        el.querySelector('#carpool-form').addEventListener('submit', async (e) => {
          e.preventDefault();
          const text = el.querySelector('#carpool-label').value.trim();
          if (!text) return;
          try {
            await api.arrivals.createCarpool({ playerId: myId, direction, label: text });
            close();
            cache = null;
            showToast('Fahrgemeinschaft angelegt.');
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
    ${loaded ? renderMyForm(myId) : '<div class="empty-state">Lädt…</div>'}
    ${
      loaded
        ? `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:16px;margin-top:16px;">
             <div>${renderCarpoolSection('arrival', 'Anreise-Gruppen', myId)}</div>
             <div>${renderCarpoolSection('departure', 'Abreise-Gruppen', myId)}</div>
           </div>
           ${renderPeopleList()}`
        : ''
    }
  `;

  wireWhoAmICard(container, 'arrivals-whoami', ctx);
  if (!loaded) return;

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
      if (!confirm('Fahrgemeinschaft löschen?')) return;
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
