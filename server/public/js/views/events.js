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
import { avatarHtml, escapeHtml } from '../format.js';
import { showToast } from '../toast.js';
import { dateTimeFieldHtml, wireDateTimeField, wireDateTimeRange } from '../dateTimeField.js';
import { infoTooltipHtml, wireInfoTooltips } from '../infoTooltip.js';
import { getMyId } from '../whoami.js';
import { emptyStateHtml } from '../emptyState.js';
import { compareEventsByStartAscending, eventStatusBadgeHtml } from '../eventStatus.js';
import { isGroupAdmin } from '../groupContext.js';
import { formatEuroCents, normalizePaypalInput, paypalEmailFromLink, paypalPayUrl } from '../paypal.js';
import { eventHasFeature } from '../eventFeatures.js';
import { availableEventTypeOptions, eventTypeTitle } from '../eventTypes.js';
import {
  eventCalendarFilename,
  eventCalendarIcs,
} from '../calendarExport.js';
import { backButtonHtml } from '../backButton.js';
import { EXCUSE_CATEGORIES, excuseCategoryLabel, pickEventExcuse } from '../eventExcuses.js';
import { settleNotificationTarget } from '../notificationBanner.js';
import { copyText } from '../clipboard.js';
import {
  acceptedParticipantCount as countAcceptedParticipants,
  acceptedParticipants as selectAcceptedParticipants,
  eventPdfExportAvailable,
  eventSettlement as calculateEventSettlement,
  parseEventAccommodationCostCents,
  parseEventCostCents,
} from '../eventModel.js';
import { eventDateRange, renderEventCalendarActions, renderEventLocation } from '../eventPresentation.js';

export { eventDateRange, renderEventCalendarActions, renderEventLocation } from '../eventPresentation.js';
export {
  eventPdfExportAvailable,
  parseEventAccommodationCostCents,
  parseEventCostCents,
} from '../eventModel.js';

const EVENT_HELP = 'Eventtyp, Zeitraum, Teilnehmende und organisatorische Angaben werden hier verwaltet.';
const KIOSK_HELP = 'Jedes LAN-Event besitzt ein eigenes Kiosk-Konto. Alle Konten verwenden dasselbe gemeinsame Kiosk-Passwort und können ausschließlich die TV-Ansicht öffnen.';
const expandedEventParticipants = new Set();
// Mirrors foodOrders.js's Historie collapse: ended events start collapsed and
// this survives the section's own live re-renders.
let eventHistoryOpen = false;
// Same pattern for the declined events: present enough to come back from,
// quiet enough not to compete with the events actually being planned.
let declinedEventsOpen = false;
let acceptedInvitationHandoff = null;
// Fetched once per session (the shared kiosk password is stable once
// generated — see server/src/kioskAccounts.ts) and cached across successful
// re-renders of the Kioskverwaltung tool. Transient failures remain retryable.
let kioskPasswordState = { status: 'idle', value: '', error: null };

globalThis.window?.addEventListener('respawn:identity-changed', () => {
  acceptedInvitationHandoff = null;
});

async function loadKioskPassword(ctx) {
  if (kioskPasswordState.status === 'loading' || kioskPasswordState.status === 'loaded') return;
  kioskPasswordState = { status: 'loading', value: '', error: null };
  try {
    const { password } = await api.admin.kioskPassword();
    kioskPasswordState = { status: 'loaded', value: password, error: null };
  } catch (err) {
    kioskPasswordState = { status: 'error', value: '', error: err.message };
  }
  ctx.rerender();
}

function renderKioskPasswordRow() {
  if (kioskPasswordState.status === 'loaded') {
    return `<div class="tournament-lobby-credential kiosk-password-credential">
      <span>Passwort</span><strong>${escapeHtml(kioskPasswordState.value)}</strong>
      <button type="button" class="icon-btn tournament-lobby-copy" data-copy-kiosk-password title="Kiosk-Passwort kopieren" aria-label="Kiosk-Passwort kopieren">${icon('copy')}</button>
    </div>`;
  }
  if (kioskPasswordState.status === 'error') {
    return `<div class="row-between">
      <span class="muted" style="font-size:var(--font-size-xs);">Passwort konnte nicht geladen werden: ${escapeHtml(kioskPasswordState.error)}</span>
      <button type="button" class="btn btn-secondary" data-retry-kiosk-password>Erneut versuchen</button>
    </div>`;
  }
  return `<p class="muted" style="font-size:var(--font-size-xs);">Lädt…</p>`;
}

function renderKioskSection() {
  const accounts = (state.managedEvents || [])
    .filter((event) => event.eventType === 'lan' && !event.isBase && !event.isOutsideEvents)
    .map((event) => {
      const username = `kiosk-${event.id}`;
      return `
        <div class="card stack">
          <div class="row-between">
            <strong>${escapeHtml(event.name)}</strong>
            ${eventStatusBadgeHtml(event)}
          </div>
          <div>
            <span class="field-label">Kiosk-Konto</span>
            <code>${escapeHtml(username)}</code>
          </div>
          <a href="/kiosk.html?account=${encodeURIComponent(username)}" target="_blank" rel="noopener" class="btn btn-primary btn-block kiosk-open-link">Kiosk öffnen</a>
        </div>`;
    })
    .join('');
  return `
    <section class="card stack grouped-page-section">
      ${renderKioskPasswordRow()}
      ${accounts || emptyStateHtml('Noch kein LAN-Event vorhanden.')}
    </section>
  `;
}

// The gag action of the Events cards: an event that is still ahead can collide
// with something else, and this writes the excuse for that other appointment
// (see eventExcuses.js). An ended event has nothing left to collide with.
export function renderEventExcuseActions(event) {
  if (!event || event.isEnded) return '';
  return `
    <div class="event-excuse-actions">
      <span class="event-card-detail-label">Paralleltermin?</span>
      <button type="button" class="btn btn-sm" data-event-excuse="${escapeHtml(event.id)}">Ausrede generieren</button>
    </div>`;
}

function renderExcuseResult(excuse) {
  if (!excuse) {
    return '<p class="muted excuse-empty">Für diese Kategorie und Dauer ist gerade keine Ausrede im Vorrat.</p>';
  }
  return `
    <blockquote class="excuse-text">${escapeHtml(excuse.text)}</blockquote>
    <div class="excuse-meta">
      <span class="badge">${escapeHtml(excuseCategoryLabel(excuse.category))}</span>
      <span class="badge badge-online">Glaubwürdigkeit ${excuse.credibility}/5</span>
    </div>`;
}

// Keeps "Neue Ausrede" from repeating itself while a decent alternative is
// left; the window is small enough that a narrow category filter still works.
const EXCUSE_HISTORY_LIMIT = 10;

function openExcuseDialog(event) {
  const recentIds = [];
  let category = 'alle';
  let current = null;

  const categoryChips = [{ id: 'alle', label: 'Alle' }, ...EXCUSE_CATEGORIES]
    .map(
      (entry) =>
        `<button type="button" class="chip${entry.id === 'alle' ? ' is-active' : ''}" aria-pressed="${entry.id === 'alle'}" data-excuse-category="${escapeHtml(entry.id)}">${escapeHtml(entry.label)}</button>`,
    )
    .join('');

  openModal('Ausreden-Generator', `
    <div class="stack excuse-dialog">
      <div class="chip-list excuse-category-filter" role="group" aria-label="Kategorie">${categoryChips}</div>
      <div class="excuse-result" data-excuse-result aria-live="polite"></div>
      <div class="excuse-dialog-actions">
        <button type="button" class="btn btn-primary" data-excuse-next>Neue Ausrede</button>
        <button type="button" class="btn" data-excuse-copy>Kopieren</button>
      </div>
    </div>
  `, {
    onMount: (backdrop) => {
      const result = backdrop.querySelector('[data-excuse-result]');
      const copyBtn = backdrop.querySelector('[data-excuse-copy]');
      const draw = () => {
        current = pickEventExcuse(event, { category, recentIds });
        if (current) {
          recentIds.push(current.id);
          if (recentIds.length > EXCUSE_HISTORY_LIMIT) recentIds.shift();
        }
        copyBtn.disabled = !current;
        result.innerHTML = renderExcuseResult(current);
      };

      backdrop.querySelectorAll('[data-excuse-category]').forEach((chip) => {
        chip.addEventListener('click', () => {
          category = chip.dataset.excuseCategory;
          backdrop.querySelectorAll('[data-excuse-category]').forEach((candidate) => {
            const active = candidate === chip;
            candidate.classList.toggle('is-active', active);
            candidate.setAttribute('aria-pressed', String(active));
          });
          // A category switch is a new request, not a continuation: the small
          // repeat window would otherwise hide the first excuses of a narrow
          // category that the previous draw happened to use up.
          recentIds.length = 0;
          draw();
        });
      });
      backdrop.querySelector('[data-excuse-next]').addEventListener('click', draw);
      copyBtn.addEventListener('click', async () => {
        if (!current) return;
        try {
          await navigator.clipboard.writeText(current.text);
          showToast('Ausrede kopiert. Viel Erfolg.');
        } catch {
          showToast('Kopieren hat nicht geklappt. Die Ausrede steht weiter im Dialog.', { error: true });
        }
      });
      draw();
      backdrop.querySelector('[data-excuse-next]').focus();
    },
  });
}

export function wireEventExcuseActions(container) {
  container.querySelectorAll('[data-event-excuse]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const event = eventCardById(btn.dataset.eventExcuse);
      if (event) openExcuseDialog(event);
    });
  });
}

// Every event that can currently be on screen as a card, including the pending
// invitations Profile renders — those carry no calendar actions, but they do
// carry the excuse action, and both are wired through this one lookup.
function eventCardById(eventId) {
  const candidates = [
    ...(state.managedEvents || []),
    ...(state.availableEvents || []),
    ...(state.endedEvents || []),
    ...(state.plannedEvents || []),
    ...(state.eventInvitations || []),
    ...(state.declinedEvents || []),
  ];
  return candidates.find((event) => event.id === eventId) ?? null;
}

function downloadEventCalendar(event) {
  const contents = eventCalendarIcs(event);
  if (!contents) {
    showToast('Für dieses Event ist noch kein vollständiger Zeitraum festgelegt.', { error: true });
    return;
  }
  const url = URL.createObjectURL(new Blob([contents], { type: 'text/calendar;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = eventCalendarFilename(event);
  // Same sequence as downloadExport(): the anchor has to be in the document
  // for the synthetic click to start a download, and the object URL must
  // outlive that click — revoking it in the next statement can cancel the
  // download before the browser has read the blob.
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function acceptedParticipants(event) {
  return selectAcceptedParticipants(event, state.players);
}

export function acceptedParticipantCount(event) {
  return countAcceptedParticipants(event, state.players);
}

export function eventSettlement(event) {
  return calculateEventSettlement(event, state.players);
}

function paymentProof(participant) {
  if (!participant.paid) return '';
  const confirmer = participant.paidByName || (participant.paidBy === participant.playerId ? 'selbst' : 'unbekannt');
  const amount = participant.paidAmountCents ? ` · ${formatEuroCents(participant.paidAmountCents)}` : '';
  const when = participant.paidAt
    ? ` · ${new Date(participant.paidAt).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' })}`
    : '';
  return `Bezahlt von ${confirmer}${amount}${when}`;
}

function isEventCreator(event) {
  return Boolean(event.createdBy) && event.createdBy === getMyId();
}

function canManageEventPayments(event) {
  return event.canManagePayments ?? isEventCreator(event);
}

function eventRoster(event, includeInvitationStatuses) {
  if (!includeInvitationStatuses || !Array.isArray(event.participants)) return acceptedParticipants(event);
  const acceptedById = new Map(acceptedParticipants(event).map((participant) => [participant.playerId, participant]));
  return event.participants.map((participant) => {
    const accepted = acceptedById.get(participant.playerId);
    const player = state.players.find((candidate) => candidate.id === participant.playerId);
    return { ...participant, name: accepted?.name ?? player?.name ?? 'Unbekannte Person' };
  });
}

function participantSummary(participants, includeInvitationStatuses) {
  if (!includeInvitationStatuses) {
    return `${participants.length} ${participants.length === 1 ? 'Person' : 'Personen'}`;
  }
  const acceptedCount = participants.filter((participant) => participant.status === 'accepted').length;
  const invitedCount = participants.filter((participant) => participant.status === 'invited').length;
  const declinedCount = participants.filter((participant) => participant.status === 'declined').length;
  return [
    `${acceptedCount} ${acceptedCount === 1 ? 'Zusage' : 'Zusagen'}`,
    invitedCount > 0 ? `${invitedCount} ${invitedCount === 1 ? 'Einladung offen' : 'Einladungen offen'}` : '',
    declinedCount > 0 ? `${declinedCount} abgelehnt` : '',
  ]
    .filter(Boolean)
    .join(' · ');
}

function renderAcceptedParticipants(event, { includeInvitationStatuses = false } = {}) {
  const participants = eventRoster(event, includeInvitationStatuses);
  const canManagePayments = canManageEventPayments(event)
    && (event.costCents !== null || participants.some((participant) => participant.paid));
  const isExpanded = expandedEventParticipants.has(event.id);
  const participantCountLabel = participantSummary(participants, includeInvitationStatuses);
  return `
    <details class="collapsible-section food-order-group event-card-participants" data-event-participants="${escapeHtml(event.id)}" ${isExpanded ? 'open' : ''}>
      <summary class="collapsible-section-header">
        <span class="event-participant-toggle">
          <span class="collapsible-section-chevron" aria-hidden="true">${icon('chevronRight')}</span>
          <span class="food-order-group-headtext">
            <strong>${includeInvitationStatuses ? 'Teilnehmende & Einladungen' : 'Teilnehmende'}</strong>
            <span class="muted food-order-group-meta">${participantCountLabel}</span>
          </span>
        </span>
      </summary>
      <div class="collapsible-section-content">
        ${participants.length
          ? `<ul class="event-participant-list">${participants
              .map((participant) => {
                const player = state.players.find((candidate) => candidate.id === participant.playerId) ?? participant;
                const participation = includeInvitationStatuses ? participationStatus(participant.status) : null;
                const paidTitle = participant.paid
                  ? `${participant.name}: Bezahlt – Markierung aufheben`
                  : `${participant.name} als bezahlt markieren`;
                return `<li class="event-participant-row ${participant.paid ? 'is-paid' : ''}" ${participation ? `data-event-participation-status="${escapeHtml(participant.status)}"` : ''}>
                  ${avatarHtml(player, 24)}
                  <span class="event-participant-name">
                    <span class="player-name">${escapeHtml(participant.name)}</span>
                    ${canManagePayments && participant.paid ? `<small class="event-payment-proof">${escapeHtml(paymentProof(participant))}</small>` : ''}
                  </span>
                  ${participation ? `<span class="badge ${participation.badge}">${participation.label}</span>` : ''}
                  ${canManagePayments && participant.status === 'accepted'
                    ? `<button type="button" class="payment-paid-marker ${participant.paid ? 'is-paid' : ''}" data-toggle-event-paid="${escapeHtml(event.id)}" data-payment-player="${escapeHtml(participant.playerId)}" aria-pressed="${Boolean(participant.paid)}" title="${escapeHtml(paidTitle)}" aria-label="${escapeHtml(paidTitle)}">${icon(participant.paid ? 'check' : 'circleDashed')}<span>${participant.paid ? 'Bezahlt' : 'Bezahlt?'}</span></button>`
                    : ''}
                </li>`;
              })
              .join('')}</ul>`
          : '<p class="muted event-card-empty-copy">Noch niemand zugesagt.</p>'}
      </div>
    </details>`;
}

function balanceBadge(balanceCents) {
  if (balanceCents > 0) {
    return { badge: 'badge-playing', label: `Überschuss ${formatEuroCents(balanceCents)}` };
  }
  if (balanceCents < 0) {
    return { badge: 'badge-paused', label: `Fehlbetrag ${formatEuroCents(Math.abs(balanceCents))}` };
  }
  return { badge: 'badge-playing', label: 'Ausgeglichen' };
}

function renderEventSettlement(event) {
  if (!event.accommodationCostCents) return '';
  const settlement = eventSettlement(event);
  const balance = balanceBadge(settlement.balanceCents);
  const expectedBalance = balanceBadge(settlement.expectedBalanceCents);
  return `
    <div class="stack event-settlement">
      <div class="event-settlement-grid">
        <span class="event-settlement-metric">
          <small>Unterkunft gesamt</small>
          <strong>${escapeHtml(formatEuroCents(settlement.accommodationCents))}</strong>
        </span>
        <span class="event-settlement-metric">
          <small>Rechnerisch pro Zusage</small>
          <strong>${settlement.perHeadCents === null ? '–' : escapeHtml(formatEuroCents(settlement.perHeadCents))}</strong>
          <span>${settlement.participantCount} ${settlement.participantCount === 1 ? 'Zusage' : 'Zusagen'}</span>
        </span>
        <span class="event-settlement-metric">
          <small>Bereits eingegangen</small>
          <strong>${escapeHtml(formatEuroCents(settlement.paidCents))}</strong>
          <span>${settlement.paidCount} bezahlt</span>
        </span>
        <span class="event-settlement-metric">
          <small>Nach allen Zahlungen</small>
          <strong>${escapeHtml(formatEuroCents(settlement.expectedCents))}</strong>
          <span>${event.costCents ? `bei ${escapeHtml(formatEuroCents(event.costCents))} Beitrag` : 'Beitrag fehlt'}</span>
        </span>
      </div>
      <div class="row-between food-order-total event-settlement-balance">
        <span class="food-order-total-label">Aktueller Saldo</span>
        <span class="badge ${balance.badge}">${escapeHtml(balance.label)}</span>
      </div>
      ${event.costCents ? `<span class="muted event-payment-overview">Nach Zahlung aller Zusagen: ${escapeHtml(expectedBalance.label)}</span>` : ''}
    </div>`;
}

function renderEventPayment(event) {
  const creator = canManageEventPayments(event);
  const myId = getMyId();
  const myParticipation = acceptedParticipants(event).find((participant) => participant.playerId === myId);
  const hasRecordedPayments = Number(event.paymentSummary?.paidCount ?? 0) > 0;
  if (
    !event.costCents
    && !(creator && (event.accommodationCostCents || hasRecordedPayments))
    && !myParticipation?.paid
  ) return '';
  const amount = event.costCents ? formatEuroCents(event.costCents) : 'Nicht festgelegt';
  const payTitle = `${amount} über PayPal bezahlen`;
  if (creator) {
    const settlement = eventSettlement(event);
    const participants = acceptedParticipants(event);
    const paidCount = settlement.paidCount;
    const openCount = settlement.unpaidCount;
    return `
      <div class="event-card-payment event-card-payment-creator">
        <div class="event-payment-heading">
          <div class="event-card-detail">
            <span class="event-card-detail-icon" aria-hidden="true">${icon('paypal')}</span>
            <span class="event-card-detail-content">
              <span class="event-card-detail-label">Beitrag pro Person</span>
              <strong class="event-payment-amount">${escapeHtml(amount)}</strong>
            </span>
          </div>
          ${event.costCents
            ? `<span class="badge ${openCount > 0 ? 'badge-paused' : 'badge-playing'}">${openCount > 0 ? `${openCount} offen` : 'Alles bezahlt'}</span>`
            : '<span class="badge badge-paused">Beitrag fehlt</span>'}
        </div>
        ${event.costCents && participants.length > 0 ? `<span class="muted event-payment-overview">${paidCount} ${paidCount === 1 ? 'Zahlung' : 'Zahlungen'} erfasst · ${openCount} von ${participants.length} aktuellen Zusagen offen · ${escapeHtml(formatEuroCents(openCount * event.costCents))} ausstehend</span>` : ''}
        ${event.costCents && event.paymentDueAt ? `<span class="muted event-payment-due">Zahlungsziel: ${escapeHtml(new Date(event.paymentDueAt).toLocaleDateString('de-DE'))}</span>` : ''}
        ${renderEventSettlement(event)}
        ${settlement.missingAmountCount > 0 ? `<span class="muted event-payment-overview">${settlement.missingAmountCount} historische ${settlement.missingAmountCount === 1 ? 'Zahlung hat' : 'Zahlungen haben'} keinen gespeicherten Betrag.</span>` : ''}
      </div>`;
  }

  const isPaid = Boolean(myParticipation?.paid);
  return `
    <div class="event-card-payment event-card-payment-member">
      <div class="event-payment-member-actions">
        <div class="event-payment-member-main">
        <div class="event-card-detail">
          <span class="event-card-detail-icon" aria-hidden="true">${icon('paypal')}</span>
          <span class="event-card-detail-content">
            <span class="event-card-detail-label">${myParticipation ? 'Dein Beitrag' : 'Kosten pro Person'}</span>
            <strong class="event-payment-amount">${escapeHtml(amount)}</strong>
          </span>
        </div>
        ${myParticipation ? `<button type="button" class="payment-paid-marker ${isPaid ? 'is-paid' : ''}" data-toggle-event-paid="${escapeHtml(event.id)}" data-payment-player="${escapeHtml(myParticipation.playerId)}" aria-pressed="${isPaid}" title="${isPaid ? 'Eigene Bezahlt-Markierung aufheben' : 'Eigenen Beitrag als bezahlt markieren'}" aria-label="${isPaid ? 'Eigene Bezahlt-Markierung aufheben' : 'Eigenen Beitrag als bezahlt markieren'}">${icon(isPaid ? 'check' : 'circleDashed')}<span>${isPaid ? 'Bezahlt' : 'Bezahlt?'}</span></button>` : ''}
        </div>
        ${myParticipation && !isPaid && event.paypalLink ? `<button type="button" class="btn btn-primary btn-sm event-paypal-button" data-pay-event="${escapeHtml(event.id)}" title="${escapeHtml(payTitle)}" aria-label="${escapeHtml(payTitle)}">Bezahlen</button>` : ''}
      </div>
      ${myParticipation && !isPaid && event.paymentDueAt ? `<span class="muted event-payment-due">Bitte bis ${escapeHtml(new Date(event.paymentDueAt).toLocaleDateString('de-DE'))} bezahlen.</span>` : ''}
      ${myParticipation && isPaid ? `<small class="event-payment-proof">${escapeHtml(paymentProof(myParticipation))}</small>` : ''}
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
    const amountPassedToPaypal = payUrl !== event.paypalLink;
    const paypalEmail = paypalEmailFromLink(event.paypalLink);
    if (paypalEmail && navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(paypalEmail);
        showToast(`PayPal-Adresse kopiert: ${paypalEmail}`);
      } catch {
        // Opening the placeholder tab can move focus away from this document,
        // which makes Clipboard.writeText reject in otherwise successful
        // payment handoffs. Copying is only a convenience: keep the recipient
        // visible and let the PayPal/confirmation flow continue normally.
        showToast(`PayPal-Adresse nicht kopiert. Empfänger: ${paypalEmail}`);
      }
    }
    if (popup) popup.location = payUrl;
    else window.open(payUrl, '_blank', 'noopener');
    handedOff = true;

    const confirmed = await confirmDialog(
      amountPassedToPaypal
        ? `${amount} wurden an PayPal übergeben.`
        : `PayPal wurde geöffnet.${paypalEmail ? ` Empfänger: ${paypalEmail}.` : ''} ${amount} musst du dort selbst eintragen.`,
      {
      title: 'Bezahlt?',
      confirmText: 'Ja, bezahlt',
      cancelText: 'Noch nicht',
      },
    );
    if (!confirmed) return;
    await api.events.setParticipantPaid(event.id, myId, true);
    await ctx.refresh();
    showToast('Event-Beitrag als bezahlt markiert.');
  } catch (err) {
    if (!handedOff) popup?.close();
    showToast(err.message, { error: true });
  }
}

function renderEventInfo(event, { editable = false, invitation = false } = {}) {
  const additionalDetails = `${renderEventLocation(event.location)}${
    event.description
      ? `<div class="event-card-detail event-card-description">
           <span class="event-card-detail-icon" aria-hidden="true">${icon('file')}</span>
           <span class="event-card-detail-content">
             <span class="event-card-detail-label">Notiz</span>
             <span>${escapeHtml(event.description)}</span>
           </span>
         </div>`
      : ''
  }`;
  const dateLine = `<span class="food-order-send-at">
      <span class="food-order-detail-icon" aria-hidden="true">${icon('calendar')}</span>
      ${escapeHtml(eventDateRange(event))}
    </span>`;
  return `
    <div class="food-order-details event-card-info">
      <div class="food-order-details-head">
        ${dateLine}
        ${editable ? `<button type="button" class="btn btn-sm" data-edit-event="${escapeHtml(event.id)}">Bearbeiten</button>` : ''}
      </div>
      ${additionalDetails ? `<div class="event-card-info-details">${additionalDetails}</div>` : ''}
      ${renderEventCalendarActions(event, { invitation })}
      ${renderEventExcuseActions(event)}
      ${invitation ? renderInvitationPayment(event) : renderEventPayment(event)}
    </div>`;
}

// Why an answer is currently blocked. The server decides this
// (routes/events.ts's myParticipation.lockReason); the card only has to say it
// out loud, because a control that silently disappears reads as a bug.
const PARTICIPATION_LOCK_TEXTS = {
  paid: 'Deine Zahlung ist bereits erfasst. Für eine Absage wende dich an die Orga.',
  started: 'Das Event läuft bereits. Für eine Absage wende dich an die Orga.',
  ended: 'Das Event ist beendet.',
  cancelled: 'Das Event wurde abgesagt.',
};

function participationLockNote(event) {
  const text = PARTICIPATION_LOCK_TEXTS[event.myParticipation?.lockReason];
  return text ? `<span class="muted event-participation-note">${escapeHtml(text)}</span>` : '';
}

// The own answer stays on the card for as long as it can be changed: a yes
// remains reversible and a no remains reversible the same way. This belongs on
// every card variant, management cards included — organizing an event is not
// the same as attending it, and "Teilnehmende verwalten" only offers removing
// a roster row, which is a different act from answering for oneself.
// A still-open invitation is deliberately absent: it is answered on its own
// invitation card in "Mein Profil".
export function ownParticipationAction(event, { primary = true } = {}) {
  const participation = event.myParticipation;
  if (!participation || participation.status === 'invited') return '';
  if (participation.status === 'accepted') {
    return participation.canDecline
      ? `<button type="button" class="btn btn-sm" data-decline-participation="${escapeHtml(event.id)}">Teilnahme absagen</button>`
      : participationLockNote(event);
  }
  return participation.canAccept
    ? `<button type="button" class="btn${primary ? ' btn-primary' : ''} btn-sm" data-accept-participation="${escapeHtml(event.id)}">Doch zusagen</button>`
    : participationLockNote(event);
}

// Own footer for the card variants that have none of their own. The management
// card instead places the same action inside its existing footer, so a card
// never grows a second action row.
export function renderOwnParticipationActions(event) {
  const action = ownParticipationAction(event);
  return action ? `<div class="event-card-actions">${action}</div>` : '';
}

// A management card is the only place an owner/admin sees an event they
// declined themselves: their declined events never move into the member
// "Abgesagt" section, because the management list already holds every event of
// the group. The state therefore has to be readable on the card itself instead
// of being implied by the action beside it.
function ownDeclinedBadge(event) {
  return event.myParticipation?.status === 'declined'
    ? '<span class="badge badge-offline">Du: Abgesagt</span>'
    : '';
}

// Read-only card for a member's own accepted events. The same information is
// useful to admins, so both card variants share the detail and accepted-roster
// blocks while only the management card receives lifecycle actions.
function renderMemberEventCard(event) {
  return `
    <article class="card stack event-card event-card-member" data-event-card="${escapeHtml(event.id)}">
      <div class="row-between food-order-card-header event-card-header">
        <h3 class="food-order-card-title">${escapeHtml(event.name)}</h3>
        <span class="event-card-header-badges">
          <span class="badge">${escapeHtml(eventTypeTitle(event.eventType, state.eventTypeOptions))}</span>
          ${eventStatusBadgeHtml(event)}
        </span>
      </div>
      ${renderEventInfo(event)}
      ${renderAcceptedParticipants(event)}
      ${renderOwnParticipationActions(event)}
    </article>
  `;
}

// A declined event keeps exactly the teaser it was answered from — no roster,
// no event data — plus the way back. Rendered in its own collapsed section so
// it stays findable without competing with the events actually being planned.
export function renderDeclinedEventCard(event) {
  return `
    <article class="card stack event-card event-card-declined" data-declined-event="${escapeHtml(event.id)}">
      <div class="row-between food-order-card-header event-card-header">
        <h3 class="food-order-card-title">${escapeHtml(event.name)}</h3>
        <span class="event-card-header-badges">
          <span class="badge">${escapeHtml(eventTypeTitle(event.eventType, state.eventTypeOptions))}</span>
          <span class="badge badge-offline">Abgesagt</span>
        </span>
      </div>
      ${renderEventInfo(event, { invitation: true })}
      <div class="event-card-actions">${ownParticipationAction(event)}</div>
    </article>
  `;
}

// An invitation discloses the contribution before acceptance, but it does
// not offer payment actions until the account is an accepted participant.
function renderInvitationPayment(event) {
  if (!event.costCents) return '';
  const amount = formatEuroCents(event.costCents);
  return `
    <div class="event-card-payment event-invitation-payment">
      <div class="event-card-detail">
        <span class="event-card-detail-icon" aria-hidden="true">${icon('paypal')}</span>
        <span class="event-card-detail-content">
          <span class="event-card-detail-label">Kosten pro Person</span>
          <strong>${escapeHtml(amount)}</strong>
        </span>
      </div>
      ${event.paymentDueAt ? `<span class="muted event-payment-due">Zahlungsziel: ${escapeHtml(new Date(event.paymentDueAt).toLocaleDateString('de-DE'))}</span>` : ''}
    </div>`;
}

export function renderEventCard(event) {
  // Nothing about tracking, ending, the regular roster or the PDF keepsake is
  // meaningful before this event has an actual date — the date poll section
  // above already covers what to do instead ("Termin abstimmen"/"Termin
  // festlegen").
  const hasDate = event.startsAt != null;
  const trackingBtn = !hasDate || !eventHasFeature(event, 'tracking')
    ? ''
    : event.isEnded
      ? `<button type="button" class="btn btn-sm btn-primary" data-restart-event="${event.id}">Event wieder starten</button>`
      : event.trackingEnabled
        ? `<button type="button" class="btn btn-sm" data-stop-tracking="${event.id}">${icon('pause')} Tracking stoppen</button>`
        : `<button type="button" class="btn btn-sm btn-primary" data-start-tracking="${event.id}">Tracking starten</button>`;
  const endBtn = !hasDate || event.isEnded
    ? ''
    : `<button type="button" class="btn btn-sm btn-danger" data-end-event="${event.id}">Beenden</button>`;

  return `
    <article class="card stack event-card event-card-managed" data-event-card="${escapeHtml(event.id)}">
      <div class="row-between food-order-card-header event-card-header">
        <h3 class="food-order-card-title">${escapeHtml(event.name)}</h3>
        <span class="event-card-header-badges">
          <span class="badge">${escapeHtml(eventTypeTitle(event.eventType, state.eventTypeOptions))}</span>
          ${ownDeclinedBadge(event)}
          ${eventStatusBadgeHtml(event)}
        </span>
      </div>
      ${renderEventInfo(event, { editable: true })}
      ${renderAcceptedParticipants(event, { includeInvitationStatuses: true })}
      <div class="event-card-actions">
        ${trackingBtn}
        ${endBtn}
        ${hasDate || event.status === 'draft' || event.isEnded ? `<button type="button" class="btn btn-sm" data-participants-event="${event.id}">${icon('users')} Teilnehmende verwalten</button>` : ''}
        ${hasDate && eventPdfExportAvailable(event) ? `<button type="button" class="btn btn-sm" data-export-event="${event.id}" title="Als PDF exportieren">${icon('file')} PDF</button>` : ''}
        ${ownParticipationAction(event, { primary: false })}
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
  // A member's own ended events live in their own field (state.endedEvents)
  // rather than state.availableEvents, which deliberately excludes them (see
  // routes/events.ts) — merge both here so the split below can sort them into
  // the active list and the collapsed Historie the same way managedEvents does.
  // plannedEvents is retained as an empty compatibility field. Only accepted
  // participation controls whether a member sees an event here.
  const memberEvents = canManage
    ? []
    : [...(state.availableEvents || []), ...(state.endedEvents || []), ...(state.plannedEvents || [])].filter(
        (e) => !e.isBase,
      );
  const events = (canManage ? realEvents : memberEvents).slice().sort(compareEventsByStartAscending);
  const renderCard = (event) => (canManage ? renderEventCard(event) : renderMemberEventCard(event));
  const activeEvents = events.filter((e) => !e.isEnded);
  const endedEvents = events.filter((e) => e.isEnded);
  // An owner/admin already sees every event of the group as a management card,
  // so their own declined ones must not appear a second time down here.
  const renderedIds = new Set(events.map((e) => e.id));
  const declinedEvents = (state.declinedEvents || [])
    .filter((e) => !renderedIds.has(e.id))
    .slice()
    .sort(compareEventsByStartAscending);
  const activeEmptyText = events.length === 0
    ? (canManage ? 'Noch keine Events angelegt.' : 'Du nimmst noch an keinem eigenen Event teil.')
    : (canManage ? 'Keine laufenden Events.' : 'Aktuell kein laufendes Event.');

  return `
    <section class="card stack grouped-page-section" aria-labelledby="orga-events-title">
      <div class="grouped-page-section-title">
        <span class="title-with-info">
          <h2 id="orga-events-title" tabindex="-1">Events</h2>
          ${infoTooltipHtml('orga-events-help', 'Events', EVENT_HELP)}
        </span>
        ${
          canManage
            ? `<span class="row" style="gap:var(--space-2);">
                 <button type="button" class="btn btn-primary btn-sm" id="new-event-btn">Event anlegen</button>
               </span>`
            : ''
        }
      </div>
      ${
        activeEvents.length === 0
          ? emptyStateHtml(activeEmptyText, { icon: icon('calendar') })
          : `<div class="stack orga-event-grid">${activeEvents.map(renderCard).join('')}</div>`
      }
      ${
        declinedEvents.length > 0
          ? `<details class="card grouped-page-section collapsible-section" data-declined-events ${declinedEventsOpen ? 'open' : ''}>
               <summary class="collapsible-section-header">
                 <h2>Abgesagt</h2>
                 <span class="collapsible-section-summary-end">
                   <span class="badge badge-offline">${declinedEvents.length}</span>
                   <span class="collapsible-section-chevron">${icon('chevronRight')}</span>
                 </span>
               </summary>
               <div class="collapsible-section-content">
                 <div class="stack orga-event-grid">${declinedEvents.map(renderDeclinedEventCard).join('')}</div>
               </div>
             </details>`
          : ''
      }
      ${
        endedEvents.length > 0
          ? `<details class="card grouped-page-section collapsible-section" data-event-history ${eventHistoryOpen ? 'open' : ''}>
               <summary class="collapsible-section-header">
                 <h2>Historie</h2>
                 <span class="collapsible-section-summary-end">
                   <span class="badge badge-offline">${endedEvents.length}</span>
                   <span class="collapsible-section-chevron">${icon('chevronRight')}</span>
                 </span>
               </summary>
               <div class="collapsible-section-content">
                 <div class="stack orga-event-grid">${endedEvents.map(renderCard).join('')}</div>
               </div>
             </details>`
          : ''
      }
    </section>
  `;
}

// Single invitation card: cost/deadline disclosure plus accept/decline.
// Rendered from Profile's own "Einladungen" section rather than here — a
// teaser sitting directly above the Events cards made it too easy to miss and
// cluttered the tab (see DESIGN_SYSTEM.md's "Orga" entry). Home's "Aktuell"
// list gets a lightweight linking nudge instead (see aktuellStatus.js).
export function renderInvitationCard(event) {
  return `
    <article class="card stack event-card event-card-invitation" data-pending-invitation="${event.id}">
      <div class="row-between food-order-card-header event-card-header">
        <h3 class="food-order-card-title">${escapeHtml(event.name)}</h3>
        <span class="event-card-header-badges">
          <span class="badge">${escapeHtml(eventTypeTitle(event.eventType, state.eventTypeOptions))}</span>
          <span class="badge badge-paused">Eingeladen</span>
        </span>
      </div>
      ${renderEventInfo(event, { invitation: true })}
      <div class="event-card-actions">
        <button type="button" class="btn btn-primary" data-accept-invitation="${event.id}">Annehmen</button>
        <button type="button" class="btn" data-decline-invitation="${event.id}">Ablehnen</button>
      </div>
    </article>`;
}

// A teaser is all an invited account receives, so the invitation list comes
// from its own payload instead of a participant roster it never sees.
export function pendingEventInvitations() {
  return getMyId() ? state.eventInvitations || [] : [];
}

export function acceptedInvitationHandoffHtml() {
  if (!acceptedInvitationHandoff) return '';
  return `
    <section class="card stack grouped-page-section" aria-labelledby="profile-accepted-invitation-title">
      <div class="grouped-page-section-title">
        <h2 id="profile-accepted-invitation-title" tabindex="-1">Einladung angenommen</h2>
      </div>
      <p class="muted">Du nimmst an „${escapeHtml(acceptedInvitationHandoff.name)}“ teil.</p>
      <button type="button" class="btn btn-primary btn-block" data-open-accepted-event="${escapeHtml(acceptedInvitationHandoff.id)}">Event öffnen</button>
    </section>`;
}

// Reused only by Profile's "Einladungen" section today, so it targets that
// page's own headings directly (the same direct-ID pattern the previous
// Events-tab handler used for #orga-invitations-title/#orga-events-title):
// the refresh below replaces the invitation button's own DOM, so focus needs
// an explicit, still-present target instead of being left to fall back to
// <body>.
export function wirePendingInvitationActions(container, ctx) {
  wireEventExcuseActions(container);
  container.querySelectorAll('[data-accept-invitation], [data-decline-invitation]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const accept = Boolean(btn.dataset.acceptInvitation);
      const eventId = btn.dataset.acceptInvitation || btn.dataset.declineInvitation;
      const invitation = (state.eventInvitations || []).find((event) => event.id === eventId);
      btn.disabled = true;
      try {
        if (accept) await api.events.acceptInvitation(eventId);
        else await api.events.declineInvitation(eventId);
        await settleNotificationTarget(`event-invitation:${eventId}:${getMyId()}`);
        acceptedInvitationHandoff = accept
          ? { id: eventId, name: invitation?.name ?? 'diesem Event' }
          : null;
        await ctx.refresh();
        window.dispatchEvent(new CustomEvent('respawn:notifications-refresh'));
        (
          container.querySelector('#profile-accepted-invitation-title')
          || container.querySelector('#profile-invitations-title')
          || container.querySelector('#profile-view-title')
        )?.focus();
        showToast(accept ? 'Einladung angenommen.' : 'Einladung abgelehnt.');
      } catch (err) {
        btn.disabled = false;
        showToast(err.message, { error: true });
      }
    });
  });
  container.querySelector('[data-open-accepted-event]')?.addEventListener('click', async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    try {
      await ctx.openEvent(button.dataset.openAcceptedEvent, 'home');
      acceptedInvitationHandoff = null;
      window.dispatchEvent(new CustomEvent('respawn:notifications-refresh'));
    } catch (error) {
      button.disabled = false;
      showToast(error?.message ?? 'Das Event konnte nicht geöffnet werden.', { error: true });
    }
  });
}

// Withdrawing an acceptance and taking a declined event back, both from the
// Events tab. The declined event's card moves between the active list and the
// "Abgesagt" section, so focus goes to the stable section heading rather than
// to a button that no longer exists after the refresh.
export function wireParticipationAnswerActions(container, ctx) {
  container.querySelectorAll('[data-decline-participation]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const eventId = btn.dataset.declineParticipation;
      const event = eventCardById(eventId);
      if (
        !(await confirmDialog(
          `Teilnahme an „${event?.name ?? 'diesem Event'}" absagen? Die Orga wird informiert; zusagen kannst du danach jederzeit wieder.`,
          { title: 'Teilnahme absagen', confirmText: 'Absagen', danger: true },
        ))
      ) return;
      btn.disabled = true;
      try {
        await api.events.declineInvitation(eventId);
        await ctx.refresh();
        container.querySelector('#orga-events-title')?.focus();
        showToast('Teilnahme abgesagt.');
      } catch (err) {
        btn.disabled = false;
        showToast(err.message, { error: true });
      }
    });
  });

  container.querySelectorAll('[data-accept-participation]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const eventId = btn.dataset.acceptParticipation;
      btn.disabled = true;
      try {
        await api.events.acceptInvitation(eventId);
        await ctx.refresh();
        container.querySelector('#orga-events-title')?.focus();
        showToast('Teilnahme zugesagt.');
      } catch (err) {
        btn.disabled = false;
        showToast(err.message, { error: true });
      }
    });
  });
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
  const isPlanningEvent = isEdit && existing.status === 'draft' && existing.startsAt == null;
  const dateRequired = isEdit && !isPlanningEvent;
  const eventTypes = availableEventTypeOptions(state.eventTypeOptions);
  const selectedEventType = existing?.eventType ?? 'lan';
  const eventTypeSelectOptions = eventTypes
    .map(
      (eventType) =>
        `<option value="${escapeHtml(eventType.key)}" ${eventType.key === selectedEventType ? 'selected' : ''}>${escapeHtml(eventType.title)}</option>`,
    )
    .join('');
  let capturedEl;
  const { close } = openModal(
    isEdit ? 'Event bearbeiten' : 'Neues Event',
    `
      <form id="event-form" class="stack">
        <div>
          <label for="event-name" class="field-label is-required">Name</label>
          <input type="text" id="event-name" maxlength="80" required autofocus value="${escapeHtml(existing?.name ?? '')}" placeholder="z.B. LAN Winter 2027" />
        </div>
        <div>
          <label for="event-type" class="field-label is-required">Eventtyp</label>
          <select id="event-type" ${isEdit ? 'disabled' : ''}>${eventTypeSelectOptions}</select>
        </div>
        <div class="field-row">
          <div>
            <label for="event-starts-date" class="field-label${dateRequired ? ' is-required' : ''}">Beginnt am</label>
            ${dateTimeFieldHtml('event-starts', existing?.startsAt ?? null, { clearable: !isEdit, disabled: isPlanningEvent, label: 'Beginnt am' })}
          </div>
          <div>
            <label for="event-ends-date" class="field-label${dateRequired ? ' is-required' : ''}">Endet am</label>
            ${dateTimeFieldHtml('event-ends', existing?.endsAt ?? null, { clearable: !isEdit, disabled: isPlanningEvent, label: 'Endet am' })}
          </div>
        </div>
        <div>
          <label for="event-location" class="field-label">Ort oder Karten-Link</label>
          <input type="text" id="event-location" maxlength="500" placeholder="z.B. https://maps.google.com/…" value="${escapeHtml(existing?.location ?? '')}" />
        </div>
        <div>
          <label for="event-description" class="field-label">Notiz</label>
          <textarea id="event-description" maxlength="500" rows="2" placeholder="z.B. Hinweise, Ablauf oder Treffpunkt">${escapeHtml(existing?.description ?? '')}</textarea>
        </div>
        <div class="field-row event-payment-fields">
          <div>
            <label for="event-cost" class="field-label">Beitrag pro Person</label>
            <label class="food-order-price-field">
              <input type="text" class="food-order-price-input" id="event-cost" inputmode="decimal" placeholder="z.B. 25,00" value="${existing?.costCents ? escapeHtml((existing.costCents / 100).toFixed(2).replace('.', ',')) : ''}" />
              <span aria-hidden="true">€</span>
            </label>
          </div>
          <div>
            <div class="food-order-paypal-label">
              <label for="event-accommodation-cost" class="field-label">Gesamtpreis Unterkunft</label>
              ${infoTooltipHtml('event-accommodation-cost-help', 'Gesamtpreis Unterkunft', 'Wird mit den bereits eingegangenen Beiträgen verglichen. Der rechnerische Preis pro Kopf verwendet nur aktuell zugesagte Personen.')}
            </div>
            <label class="food-order-price-field">
              <input type="text" class="food-order-price-input" id="event-accommodation-cost" inputmode="decimal" placeholder="z.B. 1.200,00" value="${existing?.accommodationCostCents ? escapeHtml((existing.accommodationCostCents / 100).toFixed(2).replace('.', ',')) : ''}" />
              <span aria-hidden="true">€</span>
            </label>
          </div>
        </div>
        <div class="field-row event-payment-fields">
          <div>
            <div class="food-order-paypal-label">
              <label for="event-paypal" class="field-label">PayPal</label>
              ${infoTooltipHtml(
                'event-paypal-help',
                'PayPal',
                'E-Mail-Adresse oder vollständigen PayPal.me-Link einfügen. Bei einer E-Mail-Adresse wird sie beim Öffnen von PayPal kopiert; ein Betrag kann nur beim PayPal.me-Link vorausgefüllt werden.',
              )}
            </div>
            <input type="text" id="event-paypal" maxlength="300" placeholder="E-Mail-Adresse oder https://paypal.me/name" value="${escapeHtml(paypalEmailFromLink(existing?.paypalLink) ?? existing?.paypalLink ?? '')}" />
          </div>
          <div>
            <div class="food-order-paypal-label">
              <label for="event-payment-due-date" class="field-label">Zahlungsziel</label>
              ${infoTooltipHtml('event-payment-due-help', 'Zahlungsziel', 'Ist ein Datum gesetzt, beginnen Erinnerungen an diesem Tag. Ohne Zahlungsziel beginnen sie zwei Stunden nach der Zusage.')}
            </div>
            ${dateTimeFieldHtml('event-payment-due', existing?.paymentDueAt ?? null, { clearable: true, dateOnly: true, label: 'Zahlungsziel' })}
          </div>
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
        const accommodationCost = capturedEl.querySelector('#event-accommodation-cost').value.trim();
        const paypal = capturedEl.querySelector('#event-paypal').value.trim();
        const paymentDueAt = capturedEl.querySelector('#event-payment-due').value;
        const startsAt = capturedEl.querySelector('#event-starts').value;
        const endsAt = capturedEl.querySelector('#event-ends').value;
        const scheduleChanged = !isPlanningEvent && (
          (startsAt ? new Date(startsAt).getTime() : null) !== (existing?.startsAt ?? null) ||
          (endsAt ? new Date(endsAt).getTime() : null) !== (existing?.endsAt ?? null)
        );
        const paymentDueChanged = (paymentDueAt ? new Date(paymentDueAt).getTime() : null) !== (existing?.paymentDueAt ?? null);
        const dirty = isEdit
          ? scheduleChanged ||
            name !== (existing.name ?? '') ||
            location !== (existing.location ?? '') ||
            description !== (existing.description ?? '') ||
            cost !== (existing.costCents ? (existing.costCents / 100).toFixed(2).replace('.', ',') : '') ||
            accommodationCost !== (existing.accommodationCostCents ? (existing.accommodationCostCents / 100).toFixed(2).replace('.', ',') : '') ||
            paypal !== (paypalEmailFromLink(existing.paypalLink) ?? existing.paypalLink ?? '') ||
            paymentDueChanged
          : Boolean(name || startsAt || endsAt || location || description || cost || accommodationCost || paypal || paymentDueAt);
        return dirty ? 'Die Event-Daten (Name, Zeitraum, Ort, Notiz, Beiträge, Unterkunftskosten, PayPal und Zahlungsziel) gehen verloren.' : null;
      },
      onMount: (modalEl) => {
        capturedEl = modalEl;
        wireDateTimeField(modalEl, 'event-starts');
        wireDateTimeField(modalEl, 'event-ends');
        wireDateTimeRange(modalEl, 'event-starts', 'event-ends', { minimumGapMs: 5 * 60 * 1000 });
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
            showToast('Der Beitrag muss zwischen 0,01 € und 10.000,00 € liegen.', { error: true });
            return;
          }
          const accommodationCostCents = parseEventAccommodationCostCents(
            modalEl.querySelector('#event-accommodation-cost').value,
          );
          if (Number.isNaN(accommodationCostCents)) {
            showToast('Der Gesamtpreis der Unterkunft muss zwischen 0,01 € und 100.000,00 € liegen.', { error: true });
            return;
          }
          let paypalLink;
          try {
            paypalLink = normalizePaypalInput(modalEl.querySelector('#event-paypal').value);
          } catch (err) {
            showToast(err.message, { error: true });
            return;
          }
          if (paypalLink && !costCents) {
            showToast('Für PayPal müssen Kosten pro Person angegeben werden.', { error: true });
            return;
          }
          if (paymentDueAt && !costCents) {
            showToast('Für ein Zahlungsziel müssen Kosten pro Person angegeben werden.', { error: true });
            return;
          }

          const schedulePayload = isPlanningEvent
            ? {}
            : {
                startsAt: startsVal ? new Date(startsVal).getTime() : null,
                endsAt: endsVal ? new Date(endsVal).getTime() : null,
              };
          const payload = {
            name,
            ...(!isEdit ? { eventType: modalEl.querySelector('#event-type').value } : {}),
            ...schedulePayload,
            location: location || null,
            description: description || null,
            costCents,
            accommodationCostCents,
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
              const created = await api.events.create(payload);
              close();
              await ctx.refresh();
              const managedEvent = (state.managedEvents || []).find((event) => event.id === created.id) ?? created;
              showToast('Event angelegt. Jetzt Teilnehmende einladen.');
              openParticipantsForm(ctx, managedEvent);
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
  return { label: 'Einladung offen', badge: 'badge-paused' };
}

function renderParticipantManagerRows(event) {
  const participants = new Map((event.participants ?? []).map((entry) => [entry.playerId, entry]));
  const inviteAllowed = !event.isEnded;
  const canSetAnyPaid = canManageEventPayments(event)
    && (event.costCents !== null || [...participants.values()].some((participant) => participant.paid));
  return state.players
    .map((p) => {
      const participant = participants.get(p.id);
      const status = participant?.status;
      const presentation = status ? participationStatus(status) : null;
      const paymentLocked = Boolean(participant?.paymentLocked ?? participant?.paid);
      const paidTitle = participant?.paid
        ? `${p.name}: Bezahlt – Markierung aufheben`
        : `${p.name} als bezahlt markieren`;
      return `
        <div class="event-participant-manager-row">
          <span class="player-name"><span>${escapeHtml(p.name)}</span>${participant?.paid ? `<small class="event-payment-proof">${escapeHtml(paymentProof({ ...participant, playerId: p.id }))}</small>` : ''}</span>
          <span class="event-participant-manager-actions">
            ${presentation ? `<span class="badge ${presentation.badge}">${presentation.label}</span>` : ''}
            ${status === 'accepted' && canSetAnyPaid ? `<button type="button" class="payment-paid-marker ${participant.paid ? 'is-paid' : ''}" data-modal-toggle-event-paid="${p.id}" aria-pressed="${Boolean(participant.paid)}" title="${escapeHtml(paidTitle)}" aria-label="${escapeHtml(paidTitle)}">${icon(participant.paid ? 'check' : 'circleDashed')}<span>${participant.paid ? 'Bezahlt' : 'Bezahlt?'}</span></button>` : ''}
            ${inviteAllowed && (!status || status === 'declined') ? `<button type="button" class="btn btn-sm" data-invite-participant="${p.id}">${status === 'declined' ? 'Erneut einladen' : 'Einladen'}</button>` : ''}
            ${status ? `<button type="button" class="btn btn-sm btn-danger" data-remove-participant="${p.id}" ${paymentLocked ? 'aria-disabled="true"' : ''}>Entfernen</button>` : ''}
          </span>
        </div>`;
    })
    .join('');
}

function renderParticipantsBody(event) {
  return `
    <div class="event-participants-body">
      ${event.isEnded ? '<div class="muted event-participants-note" role="status">Für beendete Events sind keine neuen Einladungen mehr möglich.</div>' : ''}
      ${state.players.length === 0 ? emptyStateHtml('Noch keine Teilnehmenden.') : `<div class="event-participant-manager-list">${renderParticipantManagerRows(event)}</div>`}
    </div>`;
}

// Event managers invite active group members here. Acceptance remains a
// personal action; administrative removal stays available for every status.
function openParticipantsForm(ctx, event) {
  const { close } = openModal(
    `Teilnehmende – ${escapeHtml(event.name)}`,
    renderParticipantsBody(event),
    {
      onMount: (modalEl) => {
        modalEl.addEventListener('click', async (clickEvent) => {
          const button = clickEvent.target.closest('[data-invite-participant], [data-remove-participant], [data-modal-toggle-event-paid]');
          if (!button) return;
          const playerId = button.dataset.inviteParticipant || button.dataset.removeParticipant || button.dataset.modalToggleEventPaid;
          const isInvite = Boolean(button.dataset.inviteParticipant);
          const isPayment = Boolean(button.dataset.modalToggleEventPaid);
          if (!isInvite && !isPayment && button.getAttribute('aria-disabled') === 'true') return;
          if (!isInvite && !isPayment) {
            const participant = (event.participants ?? []).find((candidate) => candidate.playerId === playerId);
            const confirmed = await confirmDialog(
              `${participant?.name ?? 'Diese Person'} wirklich aus dem Event entfernen?`,
              { title: 'Teilnahme entfernen?', confirmText: 'Entfernen', danger: true },
            );
            if (!confirmed) return;
          }
          button.disabled = true;
          try {
            if (isPayment) await api.events.setParticipantPaid(event.id, playerId, button.getAttribute('aria-pressed') !== 'true');
            else if (isInvite) await api.events.inviteParticipant(event.id, playerId);
            else await api.events.removeParticipant(event.id, playerId);
            await ctx.refresh();
            const updatedEvent = (state.managedEvents || []).find((candidate) => candidate.id === event.id);
            if (!updatedEvent) return close();
            modalEl.querySelector('.modal-body').innerHTML = renderParticipantsBody(updatedEvent);
            if (playerId) modalEl.querySelector(`[data-modal-toggle-event-paid="${CSS.escape(playerId)}"], [data-invite-participant="${CSS.escape(playerId)}"], [data-remove-participant="${CSS.escape(playerId)}"]`)?.focus();
            showToast(isPayment ? 'Bezahlstatus aktualisiert.' : isInvite ? 'Einladung gesendet.' : 'Event-Teilnahme entfernt.');
          } catch (err) {
            button.disabled = false;
            showToast(err.message, { error: true });
          }
        });
      },
    }
  );
}

export function renderOrgaKiosk(container, ctx) {
  if (!isGroupAdmin()) {
    container.innerHTML = `
      <div class="more-subpage-header">
        <div class="more-subpage-title-row">
          ${backButtonHtml({ view: 'more' })}
          <h1 class="view-title">TV-Kiosk</h1>
        </div>
      </div>
      <div class="card stack">
        <strong>Nur für Admins verfügbar</strong>
        <span class="muted">Dieses Konto hat keine Admin-Rechte für die Kioskverwaltung.</span>
        <button type="button" class="btn btn-primary btn-block" data-navigate="more">Zu Mehr</button>
      </div>`;
    return;
  }
  if (kioskPasswordState.status === 'idle') loadKioskPassword(ctx);
  container.innerHTML = `
    <div class="more-subpage-header">
      <div class="more-subpage-title-row">
        ${backButtonHtml({ view: 'admin' })}
        <h1 class="view-title title-with-info">
          <span>TV-Kiosk</span>
          ${infoTooltipHtml('orga-kiosk-help', 'TV-Kiosk', KIOSK_HELP)}
        </h1>
      </div>
    </div>
    <div class="grouped-page-sections">
      ${renderKioskSection()}
    </div>
  `;
  wireInfoTooltips(container);
  container.querySelector('[data-retry-kiosk-password]')?.addEventListener('click', () => {
    loadKioskPassword(ctx);
  });
  container.querySelector('[data-copy-kiosk-password]')?.addEventListener('click', async () => {
    try {
      await copyText(kioskPasswordState.value);
      showToast('Passwort kopiert.');
    } catch {
      showToast('Kopieren nicht möglich – bitte manuell markieren.', { error: true });
    }
  });
}

export function renderOrgaEvents(container, ctx) {
  container.innerHTML = `
    <div class="grouped-page-sections">
      ${renderEventSection()}
    </div>
  `;

  container.querySelectorAll('[data-event-participants]').forEach((details) => {
    details.addEventListener('toggle', () => {
      if (details.open) expandedEventParticipants.add(details.dataset.eventParticipants);
      else expandedEventParticipants.delete(details.dataset.eventParticipants);
    });
  });

  container.querySelector('[data-event-history]')?.addEventListener('toggle', (e) => {
    eventHistoryOpen = e.currentTarget.open;
  });

  container.querySelector('[data-declined-events]')?.addEventListener('toggle', (e) => {
    declinedEventsOpen = e.currentTarget.open;
  });

  wireParticipationAnswerActions(container, ctx);

  container.querySelectorAll('[data-export-event]').forEach((btn) => {
    btn.addEventListener('click', () => downloadExport(btn.dataset.exportEvent));
  });
  wireEventExcuseActions(container);
  container.querySelectorAll('[data-download-event-calendar]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const event = eventCardById(btn.dataset.downloadEventCalendar);
      if (event) downloadEventCalendar(event);
    });
  });
  container.querySelectorAll('[data-confirm-event-calendar]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const eventId = btn.dataset.confirmEventCalendar;
      const event = eventCardById(eventId);
      if (
        event?.myParticipation?.calendarConfirmationNeedsExtraCheck &&
        !(await confirmDialog('Hast du den Termin wirklich eingetragen, Stefan??!!', {
          title: 'Ganz sicher, Stefan?',
          confirmText: 'Ja, wirklich',
        }))
      ) return;
      btn.disabled = true;
      try {
        await api.events.confirmCalendar(eventId);
        await ctx.refresh();
        [...container.querySelectorAll('[data-event-calendar-confirmed]')]
          .find((candidate) => candidate.dataset.eventCalendarConfirmed === eventId)
          ?.focus();
        showToast('Kalenderübernahme bestätigt. Weitere Kalender-Erinnerungen sind beendet.');
      } catch (err) {
        btn.disabled = false;
        showToast(err.message, { error: true });
      }
    });
  });
  wireInfoTooltips(container);
  container.querySelectorAll('[data-toggle-event-paid]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const eventId = btn.dataset.toggleEventPaid;
      const playerId = btn.dataset.paymentPlayer;
      btn.disabled = true;
      try {
        await api.events.setParticipantPaid(
          eventId,
          playerId,
          btn.getAttribute('aria-pressed') !== 'true',
        );
        await ctx.refresh();
        [...container.querySelectorAll('[data-toggle-event-paid]')]
          .find((candidate) =>
            candidate.dataset.toggleEventPaid === eventId && candidate.dataset.paymentPlayer === playerId)
          ?.focus();
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
  container.querySelectorAll('[data-start-tracking]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const event = (state.managedEvents || []).find((e) => e.id === btn.dataset.startTracking);
      if (!event) return;
      if (!(await confirmDialog(`Tracking für „${event.name}" starten? Live-Status und Spielzeit werden ab jetzt für die Teilnehmenden erfasst.`, { confirmText: 'Tracking starten' }))) return;
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
      if (!(await confirmDialog(`Event „${event.name}" wieder starten? Das Event wird geöffnet und Tracking für die Teilnehmenden aktiviert.`, { confirmText: 'Event wieder starten' }))) return;
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
