// Settings view (FR-30): event management and the invite link. Reached via
// the ⚙️ icon, not the main bottom nav — this is setup work, not something
// people touch during actual play. Game management (including the
// process-name mappings the agent uses) lives in the Spiele view now — see
// server/CLAUDE.md games reorg.

import { api, getToken } from '../api.js';
import { state } from '../state.js';
import { icon } from '../icons.js';
import { escapeHtml } from '../format.js';
import { showToast } from '../toast.js';
import { dateTimeFieldHtml, wireDateTimeField } from '../dateTimeField.js';

// The invite link is the shared access token, not tied to any one event —
// same link always leads into whichever event is currently active. Factored
// out so it can be reused both in the Einstellungen page and in the
// "share it now" modal shown right after starting a new event.
function inviteUrl() {
  const token = getToken();
  return token ? `${location.origin}/?token=${encodeURIComponent(token)}` : location.origin;
}

function renderInviteLinkBody() {
  return `
    <div class="row">
      <input type="text" id="invite-link" readonly value="${escapeHtml(inviteUrl())}" style="flex:1;font-family:monospace;font-size:var(--font-size-xs);" />
      <button type="button" class="btn btn-sm" id="invite-copy">Kopieren</button>
    </div>
    <button type="button" class="btn btn-sm" id="invite-qr-toggle">📱 QR-Code anzeigen</button>
    <div id="invite-qr" style="text-align:center;" hidden></div>
  `;
}

// Wires the copy button + QR toggle within whichever root contains
// renderInviteLinkBody()'s markup (the settings page, or a modal).
function wireInviteLinkBody(root) {
  root.querySelector('#invite-copy').addEventListener('click', async () => {
    const value = root.querySelector('#invite-link').value;
    try {
      await navigator.clipboard.writeText(value);
      showToast('Einladungslink kopiert.');
    } catch {
      showToast('Kopieren nicht möglich – bitte manuell markieren.', { error: true });
    }
  });

  root.querySelector('#invite-qr-toggle').addEventListener('click', async (e) => {
    const qrEl = root.querySelector('#invite-qr');
    if (!qrEl.hidden) {
      qrEl.hidden = true;
      e.target.textContent = '📱 QR-Code anzeigen';
      return;
    }
    e.target.textContent = '📱 QR-Code ausblenden';
    qrEl.hidden = false;
    if (!qrEl.dataset.loaded) {
      const url = root.querySelector('#invite-link').value;
      try {
        // Rendered server-side and injected as trusted markup (our own
        // /api/qrcode response, not user input) so it displays inline
        // without a network round trip to a third-party QR service that
        // would otherwise see the access token embedded in the link.
        qrEl.innerHTML = await api.qrcode.svg(url);
        qrEl.dataset.loaded = '1';
      } catch (err) {
        qrEl.textContent = 'QR-Code konnte nicht geladen werden.';
        showToast(err.message, { error: true });
      }
    }
  });
}

// Shown right after starting a new event — the whole point of asking for a
// time frame/location up front is to immediately hand over a link that's
// ready to send, instead of making the admin go find "Einladungslink" again.
function openShareLinkModal(eventName) {
  const { el } = openModal(
    `🎉 ${escapeHtml(eventName)} gestartet`,
    `
      <div class="stack">
        ${renderInviteLinkBody()}
        <p class="muted" style="font-size:var(--font-size-xs);">
          Diesen Link verschicken (oder den QR-Code zeigen/aushängen) – öffnet die Seite direkt
          eingeloggt und führt neue Leute direkt zur Profil-Erstellung. Name, Bild, Skills und der
          eigene Agent-Key richten sich alle selbst ein.
        </p>
      </div>
    `,
    { onMount: (modalEl) => wireInviteLinkBody(modalEl) }
  );
  void el;
}

function renderInviteSection() {
  const token = getToken();
  return `
    <div class="section-title">🔗 Einladungslink</div>
    <div class="card stack">
      ${renderInviteLinkBody()}
      <p class="muted" style="font-size:var(--font-size-xs);">
        Diesen Link verschicken (oder den QR-Code zeigen/aushängen) – öffnet die Seite direkt
        eingeloggt und führt neue Leute direkt zur Profil-Erstellung. Name, Bild, Skills und der
        eigene Agent-Key richten sich alle selbst ein.
      </p>
    </div>

    <div class="section-title">🖥️ TV-/Kiosk-Ansicht</div>
    <div class="card stack">
      <a href="/kiosk.html${token ? `?token=${encodeURIComponent(token)}` : ''}" target="_blank" rel="noopener" class="btn btn-block">Kiosk-Ansicht öffnen</a>
      <p class="muted" style="font-size:var(--font-size-xs);">
        Für einen gemeinsamen Bildschirm/Beamer im Raum: Live-Status, Abstimmung, Rangliste und
        laufendes Turnier, aktualisiert sich von selbst. Keine Bedienung nötig.
      </p>
    </div>
  `;
}

function eventStatusBadge(e) {
  if (e.isEnded) return `<span class="badge badge-offline">${icon('circleCheck')} Beendet</span>`;
  if (e.trackingEnabled) return `<span class="badge badge-playing">${icon('radioTower')} Trackt gerade</span>`;
  return `<span class="badge badge-paused">${icon('pause')} Nicht aktiv</span>`;
}

function renderEventCard(e) {
  const dateRange = `${new Date(e.starts_at).toLocaleDateString('de-DE')} – ${new Date(e.ends_at).toLocaleDateString('de-DE')}`;
  const participantCount = e.participantIds?.length ?? 0;

  const trackingBtn = e.isEnded
    ? ''
    : e.trackingEnabled
      ? `<button type="button" class="btn btn-sm" data-stop-tracking="${e.id}">⏸ Tracking stoppen</button>`
      : `<button type="button" class="btn btn-sm btn-primary" data-start-tracking="${e.id}">▶️ Tracking starten</button>`;
  const endBtn = e.isEnded
    ? ''
    : `<button type="button" class="btn btn-sm btn-danger" data-end-event="${e.id}">🏁 Beenden</button>`;

  return `
    <div class="card stack" style="gap:var(--space-3);">
      <div class="row-between">
        <strong>${escapeHtml(e.name)}</strong>
        ${eventStatusBadge(e)}
      </div>
      <div class="stack" style="gap:5px;">
        ${e.location ? `<div class="muted" style="font-size:var(--font-size-sm);">📍 ${escapeHtml(e.location)}</div>` : ''}
        <div class="muted" style="font-size:var(--font-size-sm);">🗓️ ${dateRange} · 👥 ${participantCount} Teilnehmer</div>
        ${e.description ? `<div class="muted" style="font-size:var(--font-size-sm);">${escapeHtml(e.description)}</div>` : ''}
      </div>
      <div class="row event-card-actions" style="gap:var(--space-2);flex-wrap:wrap;">
        ${trackingBtn}
        ${endBtn}
        <button type="button" class="btn btn-sm" data-participants-event="${e.id}">👥 Teilnehmer</button>
        <button type="button" class="btn btn-sm" data-edit-event="${e.id}">✏️ Bearbeiten</button>
        <button type="button" class="btn btn-sm" data-export-event="${e.id}" title="Als PDF exportieren">📄 PDF</button>
      </div>
    </div>
  `;
}

function renderEventSection() {
  const realEvents = (state.events || []).filter((e) => !e.isOutsideEvents);
  const cards = realEvents.map(renderEventCard).join('');

  return `
    <div class="row-between" style="margin-top:var(--space-5);">
      <div class="section-title" style="margin:0 0 8px;">🎪 Events</div>
      <button type="button" class="btn btn-primary btn-sm" id="new-event-btn">+ Event</button>
    </div>
    <p class="muted" style="font-size:var(--font-size-xs);margin:0 0 14px;">
      Mehrere Events können nebeneinander bestehen, aber nur eines gleichzeitig „tracken" (Live-Status
      und Spielzeit automatisch erfassen). Was außerhalb eines getrackten Events passiert, läuft unter
      „Außerhalb von Events" – ganz normal nutzbar, nur ohne festes Event zugeordnet.
    </p>
    ${
      realEvents.length === 0
        ? `<div class="empty-state"><span class="emoji">🎪</span>Noch keine Events angelegt.</div>`
        : `<div class="card-grid" style="gap:var(--space-4);">${cards}</div>`
    }
  `;
}

// Triggers a browser download of the event's PDF "Andenken" — a designed
// keepsake (Rangliste, Spielzeit, Awards, Turnier-Champions), not raw data.
// Goes through api.export.pdf()'s Blob (a plain <a href="/api/export/pdf">
// couldn't carry the access-token header).
async function downloadExport(eventId) {
  try {
    const { blob, filename } = await api.export.pdf(eventId);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  } catch (err) {
    showToast(err.message, { error: true });
  }
}

// existing === null: create a new (not-yet-tracking) event. existing !==
// null: metadata-only edit of that event (any event, ended or not) — never
// touches tracking state.
function openEventForm(ctx, existing) {
  const isEdit = Boolean(existing);
  const now = Date.now();
  const defaultEnd = now + 24 * 60 * 60 * 1000;

  const { close } = openModal(
    isEdit ? 'Event bearbeiten' : 'Neues Event',
    `
      <form id="event-form" class="stack">
        <div>
          <label for="event-name" class="field-label">Name</label>
          <input type="text" id="event-name" maxlength="80" required autofocus value="${escapeHtml(existing?.name ?? '')}" placeholder="z.B. LAN Winter 2027" />
        </div>
        <div class="field-row">
          <div>
            <label for="event-starts" class="field-label">Beginnt am</label>
            ${dateTimeFieldHtml('event-starts', existing?.starts_at ?? now, { clearable: false })}
          </div>
          <div>
            <label for="event-ends" class="field-label">Endet am</label>
            ${dateTimeFieldHtml('event-ends', existing?.ends_at ?? defaultEnd, { clearable: isEdit })}
          </div>
        </div>
        <div>
          <label for="event-location" class="field-label">Ort (optional)</label>
          <input type="text" id="event-location" maxlength="80" placeholder="z.B. bei Tim" value="${escapeHtml(existing?.location ?? '')}" />
        </div>
        <div>
          <label for="event-description" class="field-label">Notiz (optional)</label>
          <textarea id="event-description" maxlength="500" rows="2" placeholder="z.B. Fokus: AoE2-Turnier">${escapeHtml(existing?.description ?? '')}</textarea>
        </div>
        ${
          !isEdit
            ? `<p class="muted" style="font-size:var(--font-size-xs);">Legt das Event an, aber startet noch kein Tracking – das machst du danach gezielt über „▶️ Tracking starten".</p>`
            : ''
        }
        <button type="submit" class="btn btn-primary btn-block">${isEdit ? 'Speichern' : 'Event anlegen'}</button>
      </form>
    `,
    {
      onMount: (modalEl) => {
        wireDateTimeField(modalEl, 'event-starts');
        wireDateTimeField(modalEl, 'event-ends');

        modalEl.querySelector('#event-form').addEventListener('submit', async (e) => {
          e.preventDefault();
          const name = modalEl.querySelector('#event-name').value.trim();
          if (!name) return;
          const startsVal = modalEl.querySelector('#event-starts').value;
          const endsVal = modalEl.querySelector('#event-ends').value;
          const location = modalEl.querySelector('#event-location').value.trim();
          const description = modalEl.querySelector('#event-description').value.trim();

          const payload = {
            name,
            startsAt: startsVal ? new Date(startsVal).getTime() : undefined,
            endsAt: endsVal ? new Date(endsVal).getTime() : null,
            location: location || null,
            description: description || null,
          };

          try {
            if (isEdit) {
              await api.events.update(existing.id, payload);
              close();
              await ctx.refresh();
              showToast('Event aktualisiert.');
            } else {
              await api.events.create(payload);
              close();
              await ctx.refresh();
              showToast('Event angelegt.');
              openShareLinkModal(name);
            }
          } catch (err) {
            showToast(err.message, { error: true });
          }
        });
      },
    }
  );
}

// Replaces an event's whole roster in one go — who counts as "in" the
// event, so tracking (once started) only follows them.
function openParticipantsForm(ctx, event) {
  const checked = new Set(event.participantIds ?? []);
  const rows = state.players
    .map(
      (p) => `
      <label class="check-row">
        <input type="checkbox" data-participant="${p.id}" ${checked.has(p.id) ? 'checked' : ''} />
        <span style="flex:1;">${escapeHtml(p.name)}</span>
      </label>`
    )
    .join('');

  const { close } = openModal(
    `👥 Teilnehmer – ${escapeHtml(event.name)}`,
    `
      <div class="stack">
        <p class="muted" style="font-size:var(--font-size-xs);">
          Nur diese Spieler werden getrackt, sobald dieses Event Tracking aktiv hat.
        </p>
        ${state.players.length === 0 ? `<div class="empty-state">Noch keine Spieler.</div>` : rows}
        <button type="button" class="btn btn-primary btn-block" id="participants-save">Speichern</button>
      </div>
    `,
    {
      onMount: (modalEl) => {
        modalEl.querySelector('#participants-save').addEventListener('click', async () => {
          const ids = [...modalEl.querySelectorAll('[data-participant]:checked')].map((cb) => cb.dataset.participant);
          try {
            await api.events.setParticipants(event.id, ids);
            close();
            await ctx.refresh();
            showToast('Teilnehmer gespeichert.');
          } catch (err) {
            showToast(err.message, { error: true });
          }
        });
      },
    }
  );
}


export function renderSettings(container, ctx) {
  container.innerHTML = `
    <h1 class="view-title">Einstellungen</h1>
    ${renderEventSection()}
    ${renderInviteSection()}
  `;

  container.querySelectorAll('[data-export-event]').forEach((btn) => {
    btn.addEventListener('click', () => downloadExport(btn.dataset.exportEvent));
  });

  wireInviteLinkBody(container);

  container.querySelector('#new-event-btn').addEventListener('click', () => openEventForm(ctx, null));
  container.querySelectorAll('[data-edit-event]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const event = (state.events || []).find((e) => e.id === btn.dataset.editEvent);
      if (event) openEventForm(ctx, event);
    });
  });
  container.querySelectorAll('[data-participants-event]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const event = (state.events || []).find((e) => e.id === btn.dataset.participantsEvent);
      if (event) openParticipantsForm(ctx, event);
    });
  });
  container.querySelectorAll('[data-start-tracking]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const event = (state.events || []).find((e) => e.id === btn.dataset.startTracking);
      if (!event) return;
      if (!confirm(`Tracking für „${event.name}" starten? Live-Status und Spielzeit werden ab jetzt für die Teilnehmer erfasst.`)) return;
      try {
        await api.events.startTracking(event.id);
        await ctx.refresh();
        showToast('Tracking gestartet.');
      } catch (err) {
        showToast(err.message, { error: true });
      }
    });
  });
  container.querySelectorAll('[data-stop-tracking]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const event = (state.events || []).find((e) => e.id === btn.dataset.stopTracking);
      if (!event) return;
      if (!confirm(`Tracking für „${event.name}" stoppen? Es läuft dann wieder alles unter „Außerhalb von Events".`)) return;
      try {
        await api.events.stopTracking(event.id);
        await ctx.refresh();
        showToast('Tracking gestoppt.');
      } catch (err) {
        showToast(err.message, { error: true });
      }
    });
  });
  container.querySelectorAll('[data-end-event]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const event = (state.events || []).find((e) => e.id === btn.dataset.endEvent);
      if (!event) return;
      if (!confirm(`Event „${event.name}" endgültig beenden? Das lässt sich nicht rückgängig machen.`)) return;
      try {
        await api.events.end(event.id);
        await ctx.refresh();
        showToast('Event beendet.');
      } catch (err) {
        showToast(err.message, { error: true });
      }
    });
  });
}
