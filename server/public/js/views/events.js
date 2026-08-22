// Events (FR-30): the "Events" tab of the "Orga" area (see sectionNav.js) —
// this is setup work, not something people touch during actual play, which
// is why it lives behind "Mehr" rather than the main bottom nav. Game
// management (including the process-name mappings the agent uses) lives in
// the Spiele view — see server/CLAUDE.md games reorg.
//
// The Events tab is deliberately not admin-only: every member reaches it,
// sees the events they take part in and answers their invitations here. The
// management actions stay owner/admin — a member gets read-only cards, since
// only owner/admin receive `state.managedEvents` at all.
//
// TV-/Kiosk-Ansicht is a separate, standalone route (not an Orga tab): it is
// reached only from Admin's "Kioskverwaltung" tool card, the same pattern
// Sitzplan uses (see seating.js).

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
import { isGroupAdmin } from '../groupContext.js';
import { formatEuroCents, normalizePaypalInput, paypalPayUrl } from '../paypal.js';

const EVENT_HELP = 'Nur ein Event gleichzeitig erfasst Live-Status und Spielzeit.';
const KIOSK_HELP = 'Zeigt Live-Status, Vote, Rang und Turnier; ein eigener Token ist erforderlich.';

function renderKioskSection() {
  return `
    <section class="card stack grouped-page-section">
      <a href="/kiosk.html" target="_blank" rel="noopener" class="btn btn-block">Kiosk-Ansicht öffnen</a>
    </section>
  `;
}

// The base workspace is permanently open, so it has no end date to print.
function eventDateRange(e) {
  return e.endsAt == null
    ? 'Dauerhaft geöffnet'
    : `${new Date(e.startsAt).toLocaleDateString('de-DE')} – ${new Date(e.endsAt).toLocaleDateString('de-DE')}`;
}

function eventLocationUrl(location) {
  const trimmed = location.trim();
  const candidate = trimmed.startsWith('www.') ? `https://${trimmed}` : trimmed;
  try {
    const url = new URL(candidate);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
}

export function renderEventLocation(location) {
  if (!location) return '';
  const href = eventLocationUrl(location);
  const value = escapeHtml(location);
  return `
    <div class="event-card-detail event-card-location">
      <span class="event-card-detail-icon" aria-hidden="true">${icon('mapPin')}</span>
      <span class="event-card-detail-content">
        <span class="event-card-detail-label">Ort</span>
        ${href ? `<a class="event-location-link" href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${value}</a>` : `<span class="event-location-text">${value}</span>`}
      </span>
    </div>`;
}

function acceptedParticipants(event) {
  if (Array.isArray(event.acceptedParticipants)) return event.acceptedParticipants;
  const acceptedIds = new Set(
    event.participantIds ??
      (event.participants ?? [])
        .filter((participant) => participant.status === 'accepted')
        .map((participant) => participant.playerId),
  );
  const paidById = new Map((event.participants ?? []).map((participant) => [participant.playerId, Boolean(participant.paid)]));
  return state.players
    .filter((player) => acceptedIds.has(player.id))
    .map((player) => ({ playerId: player.id, name: player.name, paid: paidById.get(player.id) ?? false }));
}

export function acceptedParticipantCount(event) {
  return acceptedParticipants(event).length;
}

function paymentProof(participant) {
  if (!participant.paid) return '';
  const confirmer = participant.paidByName || (participant.paidBy === participant.playerId ? 'selbst' : 'unbekannt');
  const when = participant.paidAt
    ? ` · ${new Date(participant.paidAt).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' })}`
    : '';
  return `Bezahlt von ${confirmer}${when}`;
}

function renderAcceptedParticipants(event) {
  const participants = acceptedParticipants(event);
  return `
    <div class="event-card-participants">
      <div class="event-card-section-heading">
        <span class="event-card-detail-label">Zusagen</span>
        <span class="badge badge-playing">${participants.length}</span>
      </div>
      ${participants.length
        ? `<ul class="event-participant-list">${participants
            .map((participant) => `<li class="event-participant-row"><span class="event-participant-check" aria-hidden="true">${icon('check')}</span><span class="event-participant-name"><span>${escapeHtml(participant.name)}</span>${participant.paid ? `<small class="event-payment-proof">${escapeHtml(paymentProof(participant))}</small>` : ''}</span>${participant.paid ? '<span class="badge badge-playing">Bezahlt</span>' : ''}</li>`)
            .join('')}</ul>`
        : '<p class="muted event-card-empty-copy">Noch niemand zugesagt.</p>'}
    </div>`;
}

export function parseEventCostCents(raw) {
  const trimmed = (raw ?? '').trim().replace('€', '').trim();
  if (!trimmed) return null;
  const value = Number(trimmed.replace(',', '.'));
  if (!Number.isFinite(value) || value <= 0 || value > 10_000) return NaN;
  return Math.round(value * 100);
}

function renderEventPayment(event) {
  if (!event.costCents) return '';
  const myId = getMyId();
  const myParticipation = acceptedParticipants(event).find((participant) => participant.playerId === myId);
  const participants = acceptedParticipants(event);
  const paidCount = participants.filter((participant) => participant.paid).length;
  const openCount = participants.length - paidCount;
  const amount = formatEuroCents(event.costCents);
  const paidTitle = myParticipation?.paid ? 'Bezahlt – Markierung aufheben' : 'Als bezahlt markieren';
  const payTitle = `${amount} über PayPal bezahlen`;
  return `
    <div class="event-card-payment">
      <div class="event-card-detail">
        <span class="event-card-detail-icon" aria-hidden="true">${icon('paypal')}</span>
        <span class="event-card-detail-content">
          <span class="event-card-detail-label">Kosten pro Person</span>
          <strong>${escapeHtml(amount)}</strong>
        </span>
      </div>
      <div class="event-payment-summary">
        <span><strong>${paidCount} von ${participants.length}</strong> bezahlt</span>
        <span class="muted">${openCount} offen · ${escapeHtml(formatEuroCents(openCount * event.costCents))}</span>
      </div>
      ${event.paymentDueAt ? `<span class="muted event-payment-due">Zahlungsziel: ${escapeHtml(new Date(event.paymentDueAt).toLocaleDateString('de-DE'))}</span>` : ''}
      ${myParticipation
        ? `<div class="event-payment-actions">
             <button type="button" class="payment-paid-marker ${myParticipation.paid ? 'is-paid' : ''}" data-toggle-event-paid="${escapeHtml(event.id)}" data-payment-player="${escapeHtml(myId)}" aria-pressed="${myParticipation.paid}" title="${paidTitle}" aria-label="${paidTitle}">
               ${icon(myParticipation.paid ? 'check' : 'circleDashed')}<span>${myParticipation.paid ? 'Bezahlt' : 'Offen'}</span>
             </button>
             ${event.paypalLink ? `<button type="button" class="icon-btn payment-paypal-button event-paypal-button" data-pay-event="${escapeHtml(event.id)}" ${myParticipation.paid ? 'disabled' : ''} title="${escapeHtml(payTitle)}" aria-label="${escapeHtml(payTitle)}">${icon('paypal')}</button>` : ''}
             ${myParticipation.paid ? `<span class="event-payment-proof">${escapeHtml(paymentProof(myParticipation))}</span>` : ''}
           </div>`
        : ''}
    </div>`;
}

async function handleEventPay(eventId, ctx) {
  const popup = window.open('', '_blank');
  if (popup) popup.opener = null;
  let handedOff = false;

  try {
    // Match the food-order handoff: re-read the amount and payment state
    // immediately before opening PayPal so a stale card cannot charge an old
    // contribution or overwrite a payment somebody just recorded.
    const event = await api.events.get(eventId);
    const myId = getMyId();
    const participation = acceptedParticipants(event).find((participant) => participant.playerId === myId);
    if (!participation) {
      popup?.close();
      showToast('Du nimmst an diesem Event nicht mehr teil.', { error: true });
      return ctx.refresh();
    }
    if (participation.paid) {
      popup?.close();
      showToast('Dein Event-Beitrag wurde inzwischen als bezahlt markiert.');
      return ctx.refresh();
    }
    if (!event.paypalLink || !event.costCents) {
      popup?.close();
      showToast('PayPal-Link oder Betrag wurde inzwischen entfernt.', { error: true });
      return ctx.refresh();
    }

    const amount = formatEuroCents(event.costCents);
    const payUrl = paypalPayUrl(event.paypalLink, event.costCents);
    if (popup) popup.location = payUrl;
    else window.open(payUrl, '_blank', 'noopener');
    handedOff = true;

    const confirmed = await confirmDialog(`${amount} wurden an PayPal übergeben.`, {
      title: 'Bezahlt?',
      confirmText: 'Ja, bezahlt',
      cancelText: 'Noch nicht',
    });
    if (!confirmed) return;
    await api.events.setParticipantPaid(event.id, myId, true);
    await ctx.refresh();
    showToast('Event-Beitrag als bezahlt markiert.');
  } catch (err) {
    if (!handedOff) popup?.close();
    showToast(err.message, { error: true });
  }
}

function renderEventDetails(event) {
  return `
    <div class="event-card-details">
      <div class="event-card-detail">
        <span class="event-card-detail-icon" aria-hidden="true">${icon('calendar')}</span>
        <span class="event-card-detail-content">
          <span class="event-card-detail-label">Zeitraum</span>
          <span>${escapeHtml(eventDateRange(event))}</span>
        </span>
      </div>
      ${renderEventLocation(event.location)}
      ${event.description
        ? `<div class="event-card-detail event-card-description">
             <span class="event-card-detail-icon" aria-hidden="true">${icon('file')}</span>
             <span class="event-card-detail-content">
               <span class="event-card-detail-label">Notiz</span>
               <span>${escapeHtml(event.description)}</span>
             </span>
           </div>`
        : ''}
    </div>`;
}

// Read-only card for a member's own accepted events. The same information is
// useful to admins, so both card variants share the detail and accepted-roster
// blocks while only the management card receives lifecycle actions.
function renderMemberEventCard(event) {
  return `
    <article class="card event-card event-card-member" data-event-card="${escapeHtml(event.id)}">
      <div class="event-card-header">
        <div class="event-card-title-group">
          <span class="event-card-kicker">Event</span>
          <h3>${escapeHtml(event.name)}</h3>
        </div>
        ${eventStatusBadgeHtml(event)}
      </div>
      ${renderEventDetails(event)}
      ${renderEventPayment(event)}
      ${renderAcceptedParticipants(event)}
    </article>
  `;
}

function renderEventCard(event) {
  const trackingBtn = event.isEnded
    ? `<button type="button" class="btn btn-sm btn-primary" data-restart-event="${event.id}">Event wieder starten</button>`
    : event.trackingEnabled
      ? `<button type="button" class="btn btn-sm" data-stop-tracking="${event.id}">${icon('pause')} Tracking stoppen</button>`
      : `<button type="button" class="btn btn-sm btn-primary" data-start-tracking="${event.id}">Tracking starten</button>`;
  const endBtn = event.isEnded
    ? ''
    : `<button type="button" class="btn btn-sm btn-danger" data-end-event="${event.id}">Beenden</button>`;

  return `
    <article class="card event-card event-card-managed" data-event-card="${escapeHtml(event.id)}">
      <div class="event-card-header">
        <div class="event-card-title-group">
          <span class="event-card-kicker">Eventverwaltung</span>
          <h3>${escapeHtml(event.name)}</h3>
        </div>
        ${eventStatusBadgeHtml(event)}
      </div>
      ${renderEventDetails(event)}
      ${renderEventPayment(event)}
      ${renderAcceptedParticipants(event)}
      <div class="event-card-actions">
        ${trackingBtn}
        ${endBtn}
        <button type="button" class="btn btn-sm" data-participants-event="${event.id}">${icon('users')} Teilnehmer verwalten</button>
        <button type="button" class="btn btn-sm" data-edit-event="${event.id}">${icon('pencil')} Bearbeiten</button>
        <button type="button" class="btn btn-sm" data-export-event="${event.id}" title="Als PDF exportieren">${icon('file')} PDF</button>
      </div>
    </article>
  `;
}

function renderEventSection() {
  // Only owner/admin receive `managedEvents`; a member's own accepted events
  // carry accepted participant names but no management roster/status data and
  // must not be rendered through the management card, whose actions they cannot
  // use anyway. The
  // base workspace is filtered out of both: it is not a LAN anyone manages or
  // joins, it is where everyone already is.
  const canManage = Array.isArray(state.managedEvents);
  const realEvents = (canManage ? state.managedEvents : []).filter((e) => !e.isOutsideEvents && !e.isBase);
  const memberEvents = canManage ? [] : (state.availableEvents || []).filter((e) => !e.isBase);
  const cards = canManage
    ? realEvents.map(renderEventCard).join('')
    : memberEvents.map(renderMemberEventCard).join('');
  const visibleEventCount = canManage ? realEvents.length : memberEvents.length;
  const myId = getMyId();
  // A teaser is all an invited account receives, so the invitation list comes
  // from its own payload instead of a participant roster it never sees.
  const pendingInvitations = myId ? state.eventInvitations || [] : [];
  const invitationRows = pendingInvitations
    .map(
      (event) => `
        <article class="card event-card event-card-invitation" data-pending-invitation="${event.id}">
          <div class="event-card-header">
            <div class="event-card-title-group">
              <span class="event-card-kicker">Einladung</span>
              <h3>${escapeHtml(event.name)}</h3>
            </div>
            <span class="badge badge-paused">Eingeladen</span>
          </div>
          ${renderEventDetails(event)}
          <div class="event-card-actions">
            <button type="button" class="btn btn-primary" data-accept-invitation="${event.id}">Annehmen</button>
            <button type="button" class="btn" data-decline-invitation="${event.id}">Ablehnen</button>
          </div>
        </article>`,
    )
    .join('');

  return `
    <section class="card stack grouped-page-section" aria-labelledby="orga-events-title">
      <div class="grouped-page-section-title">
        <span class="title-with-info">
          <h2 id="orga-events-title">Events</h2>
          ${infoTooltipHtml('orga-events-help', 'Events', EVENT_HELP)}
        </span>
        ${canManage ? `<button type="button" class="btn btn-primary btn-sm" id="new-event-btn">+ Event</button>` : ''}
      </div>
      ${
        pendingInvitations.length > 0
          ? `<div class="stack" aria-labelledby="orga-invitations-title">
               <div class="section-title" id="orga-invitations-title" tabindex="-1">Ausstehende Einladungen</div>
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
          : `<div class="two-column-card-grid orga-event-grid">${cards}</div>`
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
          <label for="event-location" class="field-label">Ort oder Karten-Link (optional)</label>
          <input type="text" id="event-location" maxlength="500" placeholder="z.B. https://maps.google.com/…" value="${escapeHtml(existing?.location ?? '')}" />
        </div>
        <div>
          <label for="event-description" class="field-label">Notiz (optional)</label>
          <textarea id="event-description" maxlength="500" rows="2" placeholder="z.B. Fokus: AoE2-Turnier">${escapeHtml(existing?.description ?? '')}</textarea>
        </div>
        <div class="field-row">
          <div>
            <label for="event-cost" class="field-label">Kosten pro Person (optional)</label>
            <input type="text" id="event-cost" inputmode="decimal" placeholder="z.B. 25,00" value="${existing?.costCents ? escapeHtml((existing.costCents / 100).toFixed(2).replace('.', ',')) : ''}" />
          </div>
          <div>
            <span class="event-payment-label">
              <label for="event-paypal" class="field-label">PayPal.me-Link (optional)</label>
              ${infoTooltipHtml('event-paypal-help', 'PayPal.me-Link', 'Ein PayPal.me-Name oder ein vollständiger PayPal.me-Link. Beim Bezahlen werden die Kosten pro Person automatisch vorausgefüllt.')}
            </span>
            <input type="text" id="event-paypal" maxlength="300" placeholder="z.B. paypal.me/name" value="${escapeHtml(existing?.paypalLink ?? '')}" />
          </div>
        </div>
        <div>
          <span class="event-payment-label">
            <label for="event-payment-due" class="field-label">Zahlungsziel (optional)</label>
            ${infoTooltipHtml('event-payment-due-help', 'Zahlungsziel', 'Ist ein Datum gesetzt, beginnen Erinnerungen an diesem Tag. Ohne Zahlungsziel beginnen sie zwei Stunden nach der Zusage.')}
          </span>
          ${dateTimeFieldHtml('event-payment-due', existing?.paymentDueAt ?? null, { clearable: true, dateOnly: true, label: 'Zahlungsziel' })}
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
        const cost = capturedEl.querySelector('#event-cost').value.trim();
        const paypal = capturedEl.querySelector('#event-paypal').value.trim();
        const paymentDueAt = capturedEl.querySelector('#event-payment-due').value;
        const paymentDueChanged = (paymentDueAt ? new Date(paymentDueAt).getTime() : null) !== (existing?.paymentDueAt ?? null);
        const dirty = isEdit
          ? name !== (existing.name ?? '') ||
            location !== (existing.location ?? '') ||
            description !== (existing.description ?? '') ||
            cost !== (existing.costCents ? (existing.costCents / 100).toFixed(2).replace('.', ',') : '') ||
            paypal !== (existing.paypalLink ?? '') ||
            paymentDueChanged
          : Boolean(name || location || description || cost || paypal || paymentDueAt);
        return dirty ? 'Die Event-Daten (Name, Zeitraum, Ort, Notiz, Kosten, PayPal-Link und Zahlungsziel) gehen verloren.' : null;
      },
      onMount: (modalEl) => {
        capturedEl = modalEl;
        wireDateTimeField(modalEl, 'event-starts');
        wireDateTimeField(modalEl, 'event-ends');
        wireDateTimeField(modalEl, 'event-payment-due');
        wireInfoTooltips(modalEl);

        modalEl.querySelector('#event-form').addEventListener('submit', async (e) => {
          e.preventDefault();
          const name = modalEl.querySelector('#event-name').value.trim();
          if (!name) return;
          const startsVal = modalEl.querySelector('#event-starts').value;
          const endsVal = modalEl.querySelector('#event-ends').value;
          const location = modalEl.querySelector('#event-location').value.trim();
          const description = modalEl.querySelector('#event-description').value.trim();
          const paymentDueVal = modalEl.querySelector('#event-payment-due').value;
          const paymentDueAt = paymentDueVal ? new Date(paymentDueVal).getTime() : null;
          const costCents = parseEventCostCents(modalEl.querySelector('#event-cost').value);
          if (Number.isNaN(costCents)) {
            showToast('Kosten müssen zwischen 0,01 € und 10.000,00 € liegen.', { error: true });
            return;
          }
          let paypalLink;
          try {
            paypalLink = normalizePaypalInput(modalEl.querySelector('#event-paypal').value);
          } catch (err) {
            showToast(err.message, { error: true });
            return;
          }
          if (paypalLink && (!costCents || paypalPayUrl(paypalLink, costCents) === paypalLink)) {
            showToast('Für einen vorausgefüllten Betrag bitte einen PayPal.me-Link und Kosten pro Person angeben.', { error: true });
            return;
          }
          if (paymentDueAt && !costCents) {
            showToast('Für ein Zahlungsziel müssen Kosten pro Person angegeben werden.', { error: true });
            return;
          }

          const payload = {
            name,
            startsAt: startsVal ? new Date(startsVal).getTime() : undefined,
            endsAt: endsVal ? new Date(endsVal).getTime() : null,
            location: location || null,
            description: description || null,
            costCents,
            paypalLink,
            paymentDueAt,
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

function renderParticipantManagerRows(event) {
  const participants = new Map((event.participants ?? []).map((entry) => [entry.playerId, entry]));
  const inviteAllowed = !event.isEnded;
  const canSetAnyPaid = Boolean(event.costCents) && event.createdBy === getMyId();
  return state.players
    .map((p) => {
      const participant = participants.get(p.id);
      const status = participant?.status;
      const presentation = status ? participationStatus(status) : null;
      const paidTitle = participant?.paid
        ? `${p.name}: Bezahlt – Markierung aufheben`
        : `${p.name} als bezahlt markieren`;
      return `
        <div class="event-participant-manager-row">
          <span class="player-name"><span>${escapeHtml(p.name)}</span>${participant?.paid ? `<small class="event-payment-proof">${escapeHtml(paymentProof({ ...participant, playerId: p.id }))}</small>` : ''}</span>
          <span class="event-participant-manager-actions">
            ${presentation ? `<span class="badge ${presentation.badge}">${presentation.label}</span>` : ''}
            ${status === 'accepted' && canSetAnyPaid ? `<button type="button" class="payment-paid-marker ${participant.paid ? 'is-paid' : ''}" data-modal-toggle-event-paid="${p.id}" aria-pressed="${Boolean(participant.paid)}" title="${escapeHtml(paidTitle)}" aria-label="${escapeHtml(paidTitle)}">${icon(participant.paid ? 'check' : 'circleDashed')}<span>${participant.paid ? 'Bezahlt' : 'Offen'}</span></button>` : ''}
            ${event.costCents && status === 'accepted' && !canSetAnyPaid && participant.paid ? '<span class="badge badge-playing">Bezahlt</span>' : ''}
            ${inviteAllowed && (!status || status === 'declined') ? `<button type="button" class="btn btn-sm" data-invite-participant="${p.id}">${status === 'declined' ? 'Erneut einladen' : 'Einladen'}</button>` : ''}
            ${status ? `<button type="button" class="btn btn-sm btn-danger" data-remove-participant="${p.id}">Entfernen</button>` : ''}
          </span>
        </div>`;
    })
    .join('');
}

function renderParticipantsBody(event) {
  const accepted = acceptedParticipants(event);
  const acceptedCount = accepted.length;
  const unpaidCount = accepted.filter((participant) => !participant.paid).length;
  const canSetAllPaid = Boolean(event.costCents) && event.createdBy === getMyId() && unpaidCount > 0;
  return `
    <div class="event-participants-body">
      <div class="event-participants-summary">
        <span><strong>${acceptedCount}</strong> zugesagt</span>
        <span class="muted">Einladungen und Absagen bleiben hier administrativ sichtbar.</span>
      </div>
      ${canSetAllPaid ? `<button type="button" class="btn btn-sm" data-mark-all-event-paid>${icon('check')} Alle ${unpaidCount} offenen Beiträge als bezahlt markieren</button>` : ''}
      <p class="muted event-participants-note">Nur zugesagte Spieler erhalten Teilnehmerdaten und werden bei aktivem Event-Tracking berücksichtigt.</p>
      ${event.isEnded ? '<p class="muted event-participants-note">Für beendete Events sind keine neuen Einladungen mehr möglich.</p>' : ''}
      ${state.players.length === 0 ? emptyStateHtml('Noch keine Spieler.') : `<div class="event-participant-manager-list">${renderParticipantManagerRows(event)}</div>`}
    </div>`;
}

// Event managers invite active group members here. Acceptance remains a
// personal action; administrative removal stays available for every status.
function openParticipantsForm(ctx, event) {
  const { close } = openModal(
    `Teilnehmer – ${escapeHtml(event.name)}`,
    renderParticipantsBody(event),
    {
      onMount: (modalEl) => {
        modalEl.addEventListener('click', async (clickEvent) => {
          const button = clickEvent.target.closest('[data-invite-participant], [data-remove-participant], [data-modal-toggle-event-paid], [data-mark-all-event-paid]');
          if (!button) return;
          const playerId = button.dataset.inviteParticipant || button.dataset.removeParticipant || button.dataset.modalToggleEventPaid;
          const isInvite = Boolean(button.dataset.inviteParticipant);
          const isPayment = Boolean(button.dataset.modalToggleEventPaid);
          const isAllPaid = button.hasAttribute('data-mark-all-event-paid');
          if (isAllPaid && !(await confirmDialog('Alle offenen Beiträge werden mit deinem Namen und dem aktuellen Zeitpunkt als bezahlt markiert.', { title: 'Alle als bezahlt markieren?', confirmText: 'Alle markieren' }))) return;
          button.disabled = true;
          try {
            if (isAllPaid) await api.events.setAllParticipantsPaid(event.id);
            else if (isPayment) await api.events.setParticipantPaid(event.id, playerId, button.getAttribute('aria-pressed') !== 'true');
            else if (isInvite) await api.events.inviteParticipant(event.id, playerId);
            else await api.events.removeParticipant(event.id, playerId);
            await ctx.refresh();
            const updatedEvent = (state.managedEvents || []).find((candidate) => candidate.id === event.id);
            if (!updatedEvent) return close();
            modalEl.querySelector('.modal-body').innerHTML = renderParticipantsBody(updatedEvent);
            if (playerId) modalEl.querySelector(`[data-modal-toggle-event-paid="${CSS.escape(playerId)}"], [data-invite-participant="${CSS.escape(playerId)}"], [data-remove-participant="${CSS.escape(playerId)}"]`)?.focus();
            showToast(isAllPaid ? 'Alle offenen Beiträge als bezahlt markiert.' : isPayment ? 'Bezahlstatus aktualisiert.' : isInvite ? 'Einladung gesendet.' : 'Event-Teilnahme entfernt.');
          } catch (err) {
            button.disabled = false;
            showToast(err.message, { error: true });
          }
        });
      },
    }
  );
}

export function renderOrgaKiosk(container) {
  if (!isGroupAdmin()) {
    container.innerHTML = `
      <button type="button" class="btn btn-sm" data-navigate="more">${icon('chevronLeft')} Zurück</button>
      <h1 class="view-title">TV-Kiosk</h1>
      <div class="card stack">
        <strong>Nur für Admins verfügbar</strong>
        <span class="muted">Dieses Konto hat keine Admin-Rechte für die Kioskverwaltung.</span>
        <button type="button" class="btn btn-primary btn-block" data-navigate="more">Zu Mehr</button>
      </div>`;
    return;
  }
  container.innerHTML = `
    <button type="button" class="btn btn-sm" data-navigate="admin">${icon('chevronLeft')} Zurück</button>
    <h1 class="view-title title-with-info">
      <span>TV-Kiosk</span>
      ${infoTooltipHtml('orga-kiosk-help', 'TV-Kiosk', KIOSK_HELP)}
    </h1>
    <div class="grouped-page-sections">
      ${renderKioskSection()}
    </div>
  `;
  wireInfoTooltips(container);
}

export function renderOrgaEvents(container, ctx) {
  container.innerHTML = `
    <div class="grouped-page-sections">
      ${renderEventSection()}
    </div>
  `;

  container.querySelectorAll('[data-export-event]').forEach((btn) => {
    btn.addEventListener('click', () => downloadExport(btn.dataset.exportEvent));
  });
  wireInfoTooltips(container);

  container.querySelectorAll('[data-toggle-event-paid]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      try {
        await api.events.setParticipantPaid(
          btn.dataset.toggleEventPaid,
          btn.dataset.paymentPlayer,
          btn.getAttribute('aria-pressed') !== 'true',
        );
        await ctx.refresh();
        showToast('Bezahlstatus aktualisiert.');
      } catch (err) {
        btn.disabled = false;
        showToast(err.message, { error: true });
      }
    });
  });

  container.querySelectorAll('[data-pay-event]').forEach((btn) => {
    btn.addEventListener('click', () => {
      btn.disabled = true;
      handleEventPay(btn.dataset.payEvent, ctx).finally(() => {
        btn.disabled = false;
      });
    });
  });

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
        (document.querySelector('#orga-invitations-title') || document.querySelector('#orga-events-title'))?.focus();
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
  container.querySelectorAll('[data-restart-event]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const event = (state.events || []).find((e) => e.id === btn.dataset.restartEvent);
      if (!event) return;
      if (!(await confirmDialog(`Event „${event.name}" wieder starten? Das Event wird geöffnet und Tracking für die Teilnehmer aktiviert.`, { confirmText: 'Event wieder starten' }))) return;
      try {
        await api.events.restart(event.id);
        await ctx.refresh();
        showToast('Event wieder gestartet.');
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
