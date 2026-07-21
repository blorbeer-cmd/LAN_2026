// Settings view (FR-30): event management and the invite link. Reached via
// the settings icon, not the main bottom nav — this is setup work, not something
// people touch during actual play. Game management (including the
// process-name mappings the agent uses) lives in the Spiele view now — see
// server/CLAUDE.md games reorg.

import { api, getToken } from '../api.js';
import { openModal, confirmDialog } from '../modal.js';
import { state } from '../state.js';
import { icon } from '../icons.js';
import { escapeHtml } from '../format.js';
import { showToast } from '../toast.js';
import { dateTimeFieldHtml, wireDateTimeField } from '../dateTimeField.js';
import { infoTooltipHtml, wireInfoTooltips } from '../infoTooltip.js';
import { withStepUp } from '../reauth.js';
import { getMyId } from '../whoami.js';

const EVENT_HELP = 'Mehrere Events sind möglich. Nur ein Event erfasst gleichzeitig Live-Status und Spielzeit; alles andere bleibt „Außerhalb von Events“.';
const INVITE_HELP = 'Link oder QR-Code teilen: öffnet Respawn eingeloggt und führt neue Spieler direkt zur Profil-Erstellung.';
const KIOSK_HELP = 'Für gemeinsame Bildschirme: zeigt Live-Status, Vote, Rang und Turnier automatisch.';

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
    <div class="invite-link-row">
      <input type="text" id="invite-link" readonly value="${escapeHtml(inviteUrl())}" aria-label="Einladungslink" style="font-family:monospace;font-size:var(--font-size-xs);" />
      <button type="button" class="btn btn-sm" id="invite-copy">Kopieren</button>
      <button type="button" class="btn btn-sm" id="invite-qr-open">${icon('scanQrCode')} QR-Code</button>
    </div>
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

  root.querySelector('#invite-qr-open').addEventListener('click', () => {
    const url = root.querySelector('#invite-link').value;
    openModal(
      'Einladungs-QR-Code',
      '<div class="invite-qr-modal" data-invite-qr><div class="empty-state">QR-Code wird geladen…</div></div>',
      {
        onMount: async (modalEl) => {
          modalEl.classList.add('invite-qr-backdrop');
          const qrEl = modalEl.querySelector('[data-invite-qr]');
          try {
            // Rendered server-side and injected as trusted markup (our own
            // /api/qrcode response, not user input), never via a third-party
            // service that could see the access token embedded in the link.
            qrEl.innerHTML = await api.qrcode.svg(url);
          } catch (err) {
            qrEl.innerHTML = '<div class="empty-state">QR-Code konnte nicht geladen werden.</div>';
            showToast(err.message, { error: true });
          }
        },
      }
    );
  });
}

// Shown right after starting a new event — the whole point of asking for a
// time frame/location up front is to immediately hand over a link that's
// ready to send, instead of making the admin go find "Einladungslink" again.
function openShareLinkModal(eventName) {
  const { el } = openModal(
    `${escapeHtml(eventName)} gestartet`,
    `
      <div class="stack">
        <div class="title-with-info">
          <strong>Einladungslink</strong>
          ${infoTooltipHtml('event-share-help', 'Einladungslink', INVITE_HELP)}
        </div>
        ${renderInviteLinkBody()}
      </div>
    `,
    {
      onMount: (modalEl) => {
        wireInviteLinkBody(modalEl);
        wireInfoTooltips(modalEl);
      },
    }
  );
  void el;
}

function renderInviteSection() {
  const token = getToken();
  return `
    <section class="card stack grouped-page-section" aria-labelledby="settings-invite-title">
      <div class="grouped-page-section-title">
        <span class="title-with-info">
          <h2 id="settings-invite-title">Einladungslink</h2>
          ${infoTooltipHtml('settings-invite-help', 'Einladungslink', INVITE_HELP)}
        </span>
      </div>
      ${renderInviteLinkBody()}
    </section>

    <section class="card stack grouped-page-section" aria-labelledby="settings-kiosk-title">
      <div class="grouped-page-section-title">
        <span class="title-with-info">
          <h2 id="settings-kiosk-title">TV-/Kiosk-Ansicht</h2>
          ${infoTooltipHtml('settings-kiosk-help', 'TV-/Kiosk-Ansicht', KIOSK_HELP)}
        </span>
      </div>
      <a href="/kiosk.html${token ? `?token=${encodeURIComponent(token)}` : ''}" target="_blank" rel="noopener" class="btn btn-block">Kiosk-Ansicht öffnen</a>
    </section>
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
      ? `<button type="button" class="btn btn-sm" data-stop-tracking="${e.id}">${icon('pause')} Tracking stoppen</button>`
      : `<button type="button" class="btn btn-sm btn-primary" data-start-tracking="${e.id}">Tracking starten</button>`;
  const endBtn = e.isEnded
    ? ''
    : `<button type="button" class="btn btn-sm btn-danger" data-end-event="${e.id}">Beenden</button>`;

  return `
    <div class="card stack" style="gap:var(--space-3);">
      <div class="row-between">
        <strong>${escapeHtml(e.name)}</strong>
        ${eventStatusBadge(e)}
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
  const realEvents = (state.events || []).filter((e) => !e.isOutsideEvents);
  const cards = realEvents.map(renderEventCard).join('');
  const myId = getMyId();
  const pendingInvitations = myId
    ? realEvents.filter((event) => event.participants?.some((entry) => entry.playerId === myId && entry.status === 'invited'))
    : [];
  const invitationRows = pendingInvitations
    .map(
      (event) => `
        <div class="card stack" data-pending-invitation="${event.id}">
          <div class="row-between">
            <strong>${escapeHtml(event.name)}</strong>
            <span class="badge badge-paused">Eingeladen</span>
          </div>
          <div class="muted" style="font-size:var(--font-size-sm);">
            ${icon('calendar')} ${new Date(event.starts_at).toLocaleDateString('de-DE')} – ${new Date(event.ends_at).toLocaleDateString('de-DE')}
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
        <button type="button" class="btn btn-primary btn-sm" id="new-event-btn">+ Event</button>
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
        realEvents.length === 0
          ? `<div class="empty-state"><span class="empty-state-icon">${icon('calendar')}</span>Noch keine Events angelegt.</div>`
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

function participationStatus(status) {
  if (status === 'accepted') return { label: 'Zugesagt', badge: 'badge-playing' };
  if (status === 'declined') return { label: 'Abgelehnt', badge: 'badge-offline' };
  return { label: 'Eingeladen', badge: 'badge-paused' };
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
        ${state.players.length === 0 ? `<div class="empty-state">Noch keine Spieler.</div>` : rows}
      </div>
    `,
    {
      onMount: (modalEl) => {
        modalEl.querySelectorAll('[data-invite-participant]').forEach((button) => {
          button.addEventListener('click', async () => {
            button.disabled = true;
            try {
              await api.events.inviteParticipant(event.id, button.dataset.inviteParticipant);
              close();
              await ctx.refresh();
              document.querySelector(`[data-participants-event="${event.id}"]`)?.focus();
              showToast('Einladung gesendet.');
            } catch (err) {
              button.disabled = false;
              showToast(err.message, { error: true });
            }
          });
        });
        modalEl.querySelectorAll('[data-remove-participant]').forEach((button) => {
          button.addEventListener('click', async () => {
            button.disabled = true;
            try {
              await api.events.removeParticipant(event.id, button.dataset.removeParticipant);
              close();
              await ctx.refresh();
              document.querySelector(`[data-participants-event="${event.id}"]`)?.focus();
              showToast('Event-Teilnahme entfernt.');
            } catch (err) {
              button.disabled = false;
              showToast(err.message, { error: true });
            }
          });
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
      ${renderInviteSection()}
    </div>
  `;

  container.querySelectorAll('[data-export-event]').forEach((btn) => {
    btn.addEventListener('click', () => downloadExport(btn.dataset.exportEvent));
  });
  wireInviteLinkBody(container);
  wireInfoTooltips(container);

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
      const event = (state.events || []).find((e) => e.id === btn.dataset.startTracking);
      if (!event) return;
      if (!(await confirmDialog(`Tracking für „${event.name}" starten? Live-Status und Spielzeit werden ab jetzt für die Teilnehmer erfasst.`))) return;
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
      if (!(await confirmDialog(`Tracking für „${event.name}" stoppen? Es läuft dann wieder alles unter „Außerhalb von Events".`))) return;
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
      if (!(await confirmDialog(`Event „${event.name}" endgültig beenden? Das lässt sich nicht rückgängig machen.`))) return;
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
