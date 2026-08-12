// Settings view (FR-30): event management and the invite link. Reached via
// the settings icon, not the main bottom nav — this is setup work, not something
// people touch during actual play. Game management (including the
// process-name mappings the agent uses) lives in the Spiele view now — see
// server/CLAUDE.md games reorg.

import { api } from '../api.js';
import { openModal, confirmDialog } from '../modal.js';
import { state } from '../state.js';
import { icon } from '../icons.js';
import { escapeHtml } from '../format.js';
import { showToast } from '../toast.js';
import { dateTimeFieldHtml, wireDateTimeField } from '../dateTimeField.js';
import { infoTooltipHtml, wireInfoTooltips } from '../infoTooltip.js';
import { getMyId } from '../whoami.js';
import { emptyStateHtml } from '../emptyState.js';
import { eventStatusBadgeHtml } from '../eventStatus.js';

const EVENT_HELP = 'Jede Aktion gehört zu deinem aktuell gewählten Event. Du kannst dein Arbeits-Event jederzeit oben in der Leiste wechseln.';
const KIOSK_HELP = 'Für gemeinsame Bildschirme: zeigt Live-Status, Vote, Rang und Turnier automatisch. Der Kiosk benötigt seinen eigenen Token.';

function renderKioskSection() {
  return `
    <section class="card stack grouped-page-section" aria-labelledby="settings-kiosk-title">
      <div class="grouped-page-section-title">
        <span class="title-with-info">
          <h2 id="settings-kiosk-title">TV-/Kiosk-Ansicht</h2>
          ${infoTooltipHtml('settings-kiosk-help', 'TV-/Kiosk-Ansicht', KIOSK_HELP)}
        </span>
      </div>
      <a href="/kiosk.html" target="_blank" rel="noopener" class="btn btn-block">Kiosk-Ansicht öffnen</a>
    </section>
  `;
}

function eventDateRange(e) {
  return e.endsAt == null
    ? 'Dauerhaft geöffnet'
    : `${new Date(e.startsAt).toLocaleDateString('de-DE')} – ${new Date(e.endsAt).toLocaleDateString('de-DE')}`;
}

// Read-only card for a member's own accepted events: same identity and dates
// as the management card, without the admin-only actions, participant count
// and tracking state a member never receives.
function renderMemberEventCard(e) {
  return `
    <div class="card stack" style="gap:var(--space-3);">
      <div class="row-between">
        <strong>${escapeHtml(e.name)}</strong>
        ${e.isBase ? `<span class="badge badge-online">Allgemein</span>` : ''}
      </div>
      <div class="stack" style="gap:var(--space-1);">
        ${e.location ? `<div class="muted" style="font-size:var(--font-size-sm);">${icon('mapPin')} ${escapeHtml(e.location)}</div>` : ''}
        <div class="muted" style="font-size:var(--font-size-sm);">${icon('calendar')} ${eventDateRange(e)}</div>
        ${e.description ? `<div class="muted" style="font-size:var(--font-size-sm);">${escapeHtml(e.description)}</div>` : ''}
      </div>
    </div>
  `;
}

function renderEventCard(e) {
  const dateRange = eventDateRange(e);
  const participantCount = e.participantIds?.length ?? 0;

  const trackingBtn = e.isEnded
    ? ''
    : e.trackingEnabled
      ? `<button type="button" class="btn btn-sm" data-stop-tracking="${e.id}">${icon('pause')} Tracking stoppen</button>`
      : `<button type="button" class="btn btn-sm btn-primary" data-start-tracking="${e.id}">Tracking starten</button>`;
  const endBtn = e.isEnded
    ? ''
    : `<button type="button" class="btn btn-sm btn-danger" data-end-event="${e.id}">Beenden</button>`;

  return `
    <div class="card stack" style="gap:var(--space-3);">
      <div class="row-between">
        <strong>${escapeHtml(e.name)}</strong>
        ${eventStatusBadgeHtml(e)}
      </div>
      <div class="stack" style="gap:var(--space-1);">
        ${e.location ? `<div class="muted" style="font-size:var(--font-size-sm);">${icon('mapPin')} ${escapeHtml(e.location)}</div>` : ''}
        <div class="muted" style="font-size:var(--font-size-sm);">${icon('calendar')} ${dateRange} · ${icon('users')} ${participantCount} Teilnehmer</div>
        ${e.description ? `<div class="muted" style="font-size:var(--font-size-sm);">${escapeHtml(e.description)}</div>` : ''}
      </div>
      <div class="row event-card-actions" style="gap:var(--space-2);flex-wrap:wrap;">
        ${trackingBtn}
        ${endBtn}
        <button type="button" class="btn btn-sm" data-participants-event="${e.id}">${icon('users')} Teilnehmer</button>
        <button type="button" class="btn btn-sm" data-edit-event="${e.id}">${icon('pencil')} Bearbeiten</button>
        <button type="button" class="btn btn-sm" data-export-event="${e.id}" title="Als PDF exportieren">${icon('file')} PDF</button>
      </div>
    </div>
  `;
}

function renderEventSection() {
  // Only owner/admin receive `managedEvents`; a member's own accepted events
  // carry neither participants nor tracking state and must not be rendered
  // through the management card, whose actions they cannot use anyway.
  const canManage = Array.isArray(state.managedEvents);
  const realEvents = (canManage ? state.managedEvents : []).filter((e) => !e.isOutsideEvents && !e.isBase);
  const memberEvents = canManage ? [] : (state.availableEvents || []).filter((e) => !e.isBase);
  const cards = canManage
    ? realEvents.map(renderEventCard).join('')
    : memberEvents.map(renderMemberEventCard).join('');
  const visibleEventCount = canManage ? realEvents.length : memberEvents.length;
  const myId = getMyId();
  const pendingInvitations = myId ? state.eventInvitations || [] : [];
  const invitationRows = pendingInvitations
    .map(
      (event) => `
        <div class="card stack" data-pending-invitation="${event.id}">
          <div class="row-between">
            <strong>${escapeHtml(event.name)}</strong>
            <span class="badge badge-paused">Eingeladen</span>
          </div>
          <div class="muted" style="font-size:var(--font-size-sm);">
            ${icon('calendar')} ${new Date(event.startsAt).toLocaleDateString('de-DE')}${event.endsAt == null ? '' : ` – ${new Date(event.endsAt).toLocaleDateString('de-DE')}`}
          </div>
          <div class="row" style="gap:var(--space-2);">
            <button type="button" class="btn btn-primary" data-accept-invitation="${event.id}">Annehmen</button>
            <button type="button" class="btn" data-decline-invitation="${event.id}">Ablehnen</button>
          </div>
        </div>`,
    )
    .join('');

  return `
    <section class="card stack grouped-page-section" aria-labelledby="settings-events-title">
      <div class="grouped-page-section-title">
        <span class="title-with-info">
          <h2 id="settings-events-title">Events</h2>
          ${infoTooltipHtml('settings-events-help', 'Events', EVENT_HELP)}
        </span>
        ${canManage ? `<button type="button" class="btn btn-primary btn-sm" id="new-event-btn">+ Event</button>` : ''}
      </div>
      ${
        pendingInvitations.length > 0
          ? `<div class="stack" aria-labelledby="settings-invitations-title">
               <div class="section-title" id="settings-invitations-title" tabindex="-1">Ausstehende Einladungen</div>
               <div class="two-column-card-grid">${invitationRows}</div>
             </div>`
          : ''
      }
      ${
        visibleEventCount === 0
          ? emptyStateHtml(
              canManage ? 'Noch keine Events angelegt.' : 'Du nimmst noch an keinem eigenen Event teil.',
              { icon: icon('calendar') },
            )
          : `<div class="two-column-card-grid settings-event-grid">${cards}</div>`
      }
    </section>
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

  let capturedEl;
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
            ${dateTimeFieldHtml('event-starts', existing?.startsAt ?? now, { clearable: false, label: 'Beginnt am' })}
          </div>
          <div>
            <label for="event-ends" class="field-label">Endet am</label>
            ${dateTimeFieldHtml('event-ends', existing?.endsAt ?? defaultEnd, { clearable: isEdit, label: 'Endet am' })}
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
        <button type="submit" class="btn btn-primary btn-block">${isEdit ? 'Speichern' : 'Event anlegen'}</button>
      </form>
    `,
    {
      confirmClose: () => {
        if (!capturedEl) return null;
        const name = capturedEl.querySelector('#event-name').value.trim();
        const location = capturedEl.querySelector('#event-location').value.trim();
        const description = capturedEl.querySelector('#event-description').value.trim();
        const dirty = isEdit
          ? name !== (existing.name ?? '') ||
            location !== (existing.location ?? '') ||
            description !== (existing.description ?? '')
          : Boolean(name || location || description);
        return dirty ? 'Die Event-Daten (Name, Zeitraum, Ort, Notiz) gehen verloren.' : null;
      },
      onMount: (modalEl) => {
        capturedEl = modalEl;
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
            }
          } catch (err) {
            showToast(err.message, { error: true });
          }
        });
      },
    }
  );
}

function participationStatus(status) {
  if (status === 'accepted') return { label: 'Zugesagt', badge: 'badge-playing' };
  if (status === 'declined') return { label: 'Abgelehnt', badge: 'badge-offline' };
  return { label: 'Eingeladen', badge: 'badge-paused' };
}

function renderParticipantsBody(event) {
  const participants = new Map((event.participants ?? []).map((entry) => [entry.playerId, entry.status]));
  const rows = state.players
    .map((p) => {
      const status = participants.get(p.id);
      const presentation = status ? participationStatus(status) : null;
      return `
        <div class="card row-between">
          <span class="player-name" style="min-width:0;">${escapeHtml(p.name)}</span>
          <span class="row" style="gap:var(--space-2);flex-wrap:wrap;justify-content:flex-end;">
            ${presentation ? `<span class="badge ${presentation.badge}">${presentation.label}</span>` : ''}
            ${!status || status === 'declined' ? `<button type="button" class="btn btn-sm" data-invite-participant="${p.id}">${status === 'declined' ? 'Erneut einladen' : 'Einladen'}</button>` : ''}
            ${status ? `<button type="button" class="btn btn-sm btn-danger" data-remove-participant="${p.id}">Entfernen</button>` : ''}
          </span>
        </div>`;
    })
    .join('');
  return `<div class="stack"><p class="muted" style="font-size:var(--font-size-xs);">Nur zugesagte Spieler erhalten Teilnehmerdaten und werden bei aktivem Event-Tracking berücksichtigt.</p>${state.players.length === 0 ? emptyStateHtml('Noch keine Spieler.') : rows}</div>`;
}

// Event managers invite active group members here. Acceptance remains a
// personal action; administrative removal stays available for every status.
function openParticipantsForm(ctx, event) {
  const participants = new Map((event.participants ?? []).map((entry) => [entry.playerId, entry.status]));
  const rows = state.players
    .map((p) => {
      const status = participants.get(p.id);
      const presentation = status ? participationStatus(status) : null;
      return `
        <div class="card row-between">
          <span class="player-name" style="min-width:0;">${escapeHtml(p.name)}</span>
          <span class="row" style="gap:var(--space-2);flex-wrap:wrap;justify-content:flex-end;">
            ${presentation ? `<span class="badge ${presentation.badge}">${presentation.label}</span>` : ''}
            ${
              !status || status === 'declined'
                ? `<button type="button" class="btn btn-sm" data-invite-participant="${p.id}">${status === 'declined' ? 'Erneut einladen' : 'Einladen'}</button>`
                : ''
            }
            ${status ? `<button type="button" class="btn btn-sm btn-danger" data-remove-participant="${p.id}">Entfernen</button>` : ''}
          </span>
        </div>`;
    })
    .join('');

  const { close } = openModal(
    `Teilnehmer – ${escapeHtml(event.name)}`,
    `
      <div class="stack">
        <p class="muted" style="font-size:var(--font-size-xs);">
          Nur zugesagte Spieler erhalten Teilnehmerdaten und werden bei aktivem Event-Tracking berücksichtigt.
        </p>
        ${state.players.length === 0 ? emptyStateHtml('Noch keine Spieler.') : rows}
      </div>
    `,
    {
      onMount: (modalEl) => {
        modalEl.addEventListener('click', async (clickEvent) => {
          const button = clickEvent.target.closest('[data-invite-participant], [data-remove-participant]');
          if (!button) return;
          const playerId = button.dataset.inviteParticipant || button.dataset.removeParticipant;
          const isInvite = Boolean(button.dataset.inviteParticipant);
          button.disabled = true;
          try {
            if (isInvite) await api.events.inviteParticipant(event.id, playerId);
            else await api.events.removeParticipant(event.id, playerId);
            await ctx.refresh();
            const updatedEvent = (state.managedEvents || []).find((candidate) => candidate.id === event.id);
            if (!updatedEvent) return close();
            modalEl.querySelector('.modal-body').innerHTML = renderParticipantsBody(updatedEvent);
            modalEl.querySelector('[data-invite-participant], [data-remove-participant]')?.focus();
            showToast(isInvite ? 'Einladung gesendet.' : 'Event-Teilnahme entfernt.');
          } catch (err) {
            button.disabled = false;
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
    <div class="grouped-page-sections">
      ${renderEventSection()}
      ${renderKioskSection()}
    </div>
  `;

  container.querySelectorAll('[data-export-event]').forEach((btn) => {
    btn.addEventListener('click', () => downloadExport(btn.dataset.exportEvent));
  });
  wireInfoTooltips(container);

  // Absent for a member: only owner/admin get the create action.
  container.querySelector('#new-event-btn')?.addEventListener('click', () => openEventForm(ctx, null));
  container.querySelectorAll('[data-edit-event]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const event = (state.managedEvents || []).find((e) => e.id === btn.dataset.editEvent);
      if (event) openEventForm(ctx, event);
    });
  });
  container.querySelectorAll('[data-participants-event]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const event = (state.managedEvents || []).find((e) => e.id === btn.dataset.participantsEvent);
      if (event) openParticipantsForm(ctx, event);
    });
  });
  container.querySelectorAll('[data-accept-invitation], [data-decline-invitation]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const accept = Boolean(btn.dataset.acceptInvitation);
      const eventId = btn.dataset.acceptInvitation || btn.dataset.declineInvitation;
      btn.disabled = true;
      try {
        if (accept) await api.events.acceptInvitation(eventId);
        else await api.events.declineInvitation(eventId);
        await ctx.refresh();
        (document.querySelector('#settings-invitations-title') || document.querySelector('#settings-events-title'))?.focus();
        showToast(accept ? 'Einladung angenommen.' : 'Einladung abgelehnt.');
      } catch (err) {
        btn.disabled = false;
        showToast(err.message, { error: true });
      }
    });
  });
  container.querySelectorAll('[data-start-tracking]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const event = (state.managedEvents || []).find((e) => e.id === btn.dataset.startTracking);
      if (!event) return;
      if (!(await confirmDialog(`Tracking für „${event.name}" starten? Live-Status und Spielzeit werden ab jetzt für die Teilnehmer erfasst.`, { confirmText: 'Tracking starten' }))) return;
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
      const event = (state.managedEvents || []).find((e) => e.id === btn.dataset.stopTracking);
      if (!event) return;
      if (!(await confirmDialog(`Tracking für „${event.name}" stoppen? Der Event-Workspace bleibt erhalten.`, { confirmText: 'Tracking stoppen' }))) return;
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
      const event = (state.managedEvents || []).find((e) => e.id === btn.dataset.endEvent);
      if (!event) return;
      if (!(await confirmDialog(`Event „${event.name}" endgültig beenden? Das lässt sich nicht rückgängig machen.`, { confirmText: 'Beenden', danger: true }))) return;
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
