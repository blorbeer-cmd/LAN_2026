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

import { actionMenuHtml, wireActionMenus } from '../actionMenu.js';
import { api } from '../api.js';
import { openModal, confirmDialog } from '../modal.js';
import { state } from '../state.js';
import { icon } from '../icons.js';
import { columnRowClass, profileRow } from '../profileRow.js';
import { avatarHtml, escapeHtml } from '../format.js';
import { showToast } from '../toast.js';
import { dateTimeFieldHtml, normalizeDatetimeLocalMs, wireDateTimeField, wireDateTimeRange } from '../dateTimeField.js';
import { infoTooltipHtml, wireInfoTooltips } from '../infoTooltip.js';
import { getMyId } from '../whoami.js';
import { emptyStateHtml } from '../emptyState.js';
import { compareEventsByStartAscending, eventStatusBadgeHtml } from '../eventStatus.js';
import { isGroupAdmin } from '../groupContext.js';
import { formatEuroCents, normalizePaypalInput, paypalEmailFromLink, paypalPayUrl } from '../paypal.js';
import { eventHasFeature } from '../eventFeatures.js';
import { availableEventTypeOptions, eventIsGroup, eventTypeTitle, isGroupEventType } from '../eventTypes.js';
import {
  eventCalendarFilename,
  eventCalendarIcs,
} from '../calendarExport.js';
import { EXCUSE_CATEGORIES, excuseCategoryLabel, pickEventExcuse } from '../eventExcuses.js';
import { settleNotificationTarget } from '../notificationBanner.js';
import { copyText } from '../clipboard.js';
import {
  acceptedParticipantCount as countAcceptedParticipants,
  acceptedParticipants as selectAcceptedParticipants,
  eventSettlement as calculateEventSettlement,
  parseEventAccommodationCostCents,
  parseEventCostCents,
} from '../eventModel.js';
import {
  eventDateRange,
  eventLocationHref,
  eventScheduleLabel,
  renderEventCalendarActions,
} from '../eventPresentation.js';

export { eventDateRange, renderEventCalendarActions, renderEventLocation } from '../eventPresentation.js';
export {
  parseEventAccommodationCostCents,
  parseEventCostCents,
} from '../eventModel.js';

// Starting tracking enables event processing, not the agent's diagnostic reports.
// Both the tooltip and confirmation explain the selected-event and consent
// prerequisites from activeTrackingContexts. Share the sentence to avoid drift.
const TRACKING_SCOPE_SENTENCE =
  'Während dieses Event läuft und Tracking aktiviert ist, entstehen aus den Agent-Meldungen Live-Status, Spielzeit und Auswertungen nur für zugesagte Teilnehmende, die dieses Event aktuell in ihrem Konto ausgewählt haben und deren Einwilligung zum Event-Tracking gültig ist. Der Agent meldet nur laufende Spiele aus der Server-Liste, keine anderen Programme. Ohne gültigen Kontext werden keine erkannten Spiele übertragen, gespeichert oder in der Agent-Diagnose angezeigt. Jede Person kann die Einwilligung widerrufen oder das Tracking im eigenen Profil pausieren.';
const TRACKING_START_CONFIRM = (name) => `Tracking für „${name}“ starten? ${TRACKING_SCOPE_SENTENCE}`;
const TRACKING_STOP_CONFIRM = (name) =>
  `Tracking für „${name}“ stoppen? Laufende Spielzeiten werden abgeschlossen und der Live-Status geleert; bereits erfasste Spielzeit und der Event-Workspace bleiben erhalten.`;
const KIOSK_HELP = 'Verfügbare LAN-Events haben je ein eigenes Broadcast-Konto mit gemeinsamem Passwort. „Broadcast öffnen“ öffnet das gewählte Event in einem eigenen Tab.';
// Mirrors foodOrders.js's card-header-toggle pattern: an event card becomes
// collapsible only once its list holds more than one card (a lone card gets
// no collapse chrome), and — because the set starts empty — every card
// defaults to collapsed the first time its list crosses that threshold. Kept
// as one flat set across active and ended events so an event's expand state
// survives its move into Historie.
const expandedEventCards = new Set();

export function prepareEventTarget(eventId) {
  if (!eventId) return;
  expandedEventCards.add(eventId);
}
// Mirrors foodOrders.js's Historie collapse: ended workspaces start collapsed
// and this survives the section's own live re-renders. Events and groups are
// two lists with two disclosures, so each keeps its own state — a shared flag
// made one section follow the other's on every refresh.
const historyOpen = { event: false, group: false };
// Same pattern for the declined workspaces: present enough to come back from,
// quiet enough not to compete with the ones actually being planned.
const declinedOpen = { event: false, group: false };
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
    return profileRow({
      title: 'Passwort',
      meta: `<code>${escapeHtml(kioskPasswordState.value)}</code>`,
      action: `<button type="button" class="icon-btn" data-copy-kiosk-password title="Broadcast-Passwort kopieren" aria-label="Broadcast-Passwort kopieren">${icon('copy')}</button>`,
    });
  }
  if (kioskPasswordState.status === 'error') {
    return profileRow({
      title: 'Passwort',
      meta: `Konnte nicht geladen werden: ${escapeHtml(kioskPasswordState.error)}`,
      action: `<button type="button" class="btn btn-sm" data-retry-kiosk-password>Erneut versuchen</button>`,
    });
  }
  return profileRow({ title: 'Passwort', meta: 'Lädt' });
}

function renderKioskSection() {
  const events = (state.managedEvents || [])
    .filter((event) => event.eventType === 'lan' && event.status === 'published' && !event.isEnded && !event.isBase && !event.isOutsideEvents)
    .sort((a, b) => a.name.localeCompare(b.name, 'de'));
  const rows = events
    .map((event, index) => {
      return profileRow({
        title: escapeHtml(event.name),
        meta: eventStatusBadgeHtml(event),
        action: `<form action="/api/admin/kiosk-handoff?eventId=${encodeURIComponent(event.id)}" method="post" target="_blank" rel="noopener"><button type="submit" class="btn btn-sm kiosk-open-link">Broadcast öffnen</button></form>`,
        className: columnRowClass(index, events.length),
      });
    })
    .join('');
  const columnRows = Math.ceil(events.length / 2);
  return `
    <section class="card stack grouped-page-section">
      <div class="profile-rows">${renderKioskPasswordRow()}</div>
      ${
        events.length
          ? `<div class="profile-rows profile-rows-columns profile-rows-divided" style="--profile-rows-count:${columnRows};">${rows}</div>`
          : `<div class="profile-rows-divided">${emptyStateHtml('Keine verfügbaren LAN-Events.')}</div>`
      }
    </section>
  `;
}

// The Ausreden-Generator is the gag of the Events cards: an event still
// ahead can collide with something else, and it writes the excuse for that
// other appointment (see eventExcuses.js).
function renderExcuseResult(excuse) {
  if (!excuse) {
    return '<p class="muted excuse-empty">Für diese Kategorie und Dauer ist gerade keine Ausrede im Vorrat.</p>';
  }
  return `
    <blockquote class="excuse-text">${escapeHtml(excuse.text)}</blockquote>
    <div class="excuse-meta">${escapeHtml(excuseCategoryLabel(excuse.category))} · Glaubwürdigkeit ${excuse.credibility} von 5</div>`;
}

// Keeps "Neue Ausrede" from repeating itself while a decent alternative is
// left; the window is small enough that a narrow category filter still works.
const EXCUSE_HISTORY_LIMIT = 10;

const DECLINE_EXCUSE_MAX_LENGTH = 300;

// The Ausreden-Generator. Without `onDecline` it only writes and copies an
// excuse (the invitation teaser in Profile). With it, the dialog becomes
// "Mit Ausrede absagen": a generated excuse can be edited, or an own one
// written, and "Übernehmen und absagen" hands the final text to onDecline
// after one confirmation that everyone will read it.
function openExcuseDialog(event, { onDecline = null } = {}) {
  const recentIds = [];
  let category = 'alle';
  let current = null;
  let mode = 'generate';

  const categoryOptions = [{ id: 'alle', label: 'Alle' }, ...EXCUSE_CATEGORIES]
    .map((entry) => `<option value="${escapeHtml(entry.id)}">${escapeHtml(entry.label)}</option>`)
    .join('');

  const declineBody = `
    <div class="stack excuse-dialog">
      <div class="excuse-mode" role="group" aria-label="Ausrede">
        <button type="button" class="btn btn-sm" data-excuse-mode="generate" aria-pressed="true">Generieren</button>
        <button type="button" class="btn btn-sm" data-excuse-mode="own" aria-pressed="false">Eigene</button>
      </div>
      <div data-excuse-generate-only>
        <label for="excuse-category" class="field-label">Kategorie</label>
        <select id="excuse-category" data-excuse-category>${categoryOptions}</select>
      </div>
      <div>
        <label for="excuse-text" class="field-label">Ausrede</label>
        <textarea id="excuse-text" rows="4" maxlength="${DECLINE_EXCUSE_MAX_LENGTH}" data-excuse-text placeholder="Oma hat Geburtstag"></textarea>
        <div class="excuse-meta-row"><span class="excuse-meta" data-excuse-meta aria-live="polite"></span><span class="excuse-meta" data-excuse-count></span></div>
      </div>
      <div class="excuse-dialog-actions">
        <button type="button" class="btn btn-sm" data-excuse-next>Neue Ausrede</button>
        <button type="button" class="btn btn-sm" data-excuse-copy>Kopieren</button>
        <button type="button" class="btn btn-primary btn-sm excuse-dialog-submit" data-excuse-decline>Übernehmen und absagen</button>
      </div>
    </div>`;
  const generatorBody = `
    <div class="stack excuse-dialog">
      <div>
        <label for="excuse-category" class="field-label">Kategorie</label>
        <select id="excuse-category" data-excuse-category>${categoryOptions}</select>
      </div>
      <div class="excuse-result" data-excuse-result aria-live="polite"></div>
      <div class="excuse-dialog-actions">
        <button type="button" class="btn btn-sm" data-excuse-next>Neue Ausrede</button>
        <button type="button" class="btn btn-primary btn-sm" data-excuse-copy>Kopieren</button>
      </div>
    </div>`;

  openModal(onDecline ? 'Mit Ausrede absagen' : 'Ausreden-Generator', onDecline ? declineBody : generatorBody, {
    onMount: (backdrop, close) => {
      const result = backdrop.querySelector('[data-excuse-result]');
      const textField = backdrop.querySelector('[data-excuse-text]');
      const meta = backdrop.querySelector('[data-excuse-meta]');
      const count = backdrop.querySelector('[data-excuse-count]');
      const copyBtn = backdrop.querySelector('[data-excuse-copy]');
      const nextBtn = backdrop.querySelector('[data-excuse-next]');
      const declineBtn = backdrop.querySelector('[data-excuse-decline]');
      const currentText = () => (textField ? textField.value.trim() : current?.text ?? '');
      const sync = () => {
        if (count) count.textContent = `${textField.value.length} / ${DECLINE_EXCUSE_MAX_LENGTH}`;
        copyBtn.disabled = !currentText();
        if (declineBtn) declineBtn.disabled = !currentText();
      };
      const draw = () => {
        current = pickEventExcuse(event, { category, recentIds });
        if (current) {
          recentIds.push(current.id);
          if (recentIds.length > EXCUSE_HISTORY_LIMIT) recentIds.shift();
        }
        if (textField) {
          textField.value = current ? current.text.slice(0, DECLINE_EXCUSE_MAX_LENGTH) : '';
          meta.textContent = current
            ? `Glaubwürdigkeit ${current.credibility} von 5`
            : 'Für diese Kategorie und Dauer ist gerade keine Ausrede im Vorrat.';
        } else {
          result.innerHTML = renderExcuseResult(current);
        }
        sync();
      };
      const setMode = (next) => {
        mode = next;
        backdrop.querySelectorAll('[data-excuse-mode]').forEach((btn) => {
          btn.setAttribute('aria-pressed', String(btn.dataset.excuseMode === mode));
        });
        backdrop.querySelector('[data-excuse-generate-only]').hidden = mode !== 'generate';
        nextBtn.hidden = mode !== 'generate';
        copyBtn.hidden = mode !== 'generate';
        if (mode === 'own') {
          textField.value = '';
          meta.textContent = '';
          sync();
          textField.focus();
        } else {
          draw();
        }
      };

      backdrop.querySelector('[data-excuse-category]').addEventListener('change', (changeEvent) => {
        category = changeEvent.currentTarget.value;
        // A category switch is a new request, not a continuation: the small
        // repeat window would otherwise hide the first excuses of a narrow
        // category that the previous draw happened to use up.
        recentIds.length = 0;
        draw();
      });
      nextBtn.addEventListener('click', draw);
      textField?.addEventListener('input', () => {
        if (meta && current && textField.value.trim() !== current.text) meta.textContent = '';
        sync();
      });
      backdrop.querySelectorAll('[data-excuse-mode]').forEach((btn) => {
        btn.addEventListener('click', () => setMode(btn.dataset.excuseMode));
      });
      copyBtn.addEventListener('click', async () => {
        const text = currentText();
        if (!text) return;
        try {
          await navigator.clipboard.writeText(text);
          showToast('Ausrede kopiert. Viel Erfolg.');
        } catch {
          showToast('Kopieren hat nicht geklappt. Die Ausrede steht weiter im Dialog.', { error: true });
        }
      });
      declineBtn?.addEventListener('click', async () => {
        const text = currentText();
        if (!text) return;
        if (!(await confirmDialog(
          `Teilnahme an „${event.name}“ absagen? Alle Teilnehmenden sehen deine Ausrede: „${text}“`,
          { title: 'Teilnahme absagen', confirmText: 'Absagen', danger: true },
        ))) return;
        declineBtn.disabled = true;
        if (await onDecline(text)) close();
        else declineBtn.disabled = false;
      });
      draw();
      nextBtn.focus();
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

export function downloadEventCalendar(event) {
  const contents = eventCalendarIcs(event);
  if (!contents) {
    showToast('Für dieses Event ist noch kein vollständiger Zeitraum festgelegt.', { error: true });
    return;
  }
  const url = URL.createObjectURL(new Blob([contents], { type: 'text/calendar;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = eventCalendarFilename(event);
  // The anchor has to be in the document for the synthetic click to start a download, and the object URL must
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
    return `${participants.length} ${participants.length === 1 ? 'Zusage' : 'Zusagen'}`;
  }
  const acceptedCount = participants.filter((participant) => participant.status === 'accepted').length;
  const invitedCount = participants.filter((participant) => participant.status === 'invited').length;
  const declinedCount = participants.filter((participant) => participant.status === 'declined').length;
  return [
    `${acceptedCount} ${acceptedCount === 1 ? 'Zusage' : 'Zusagen'}`,
    invitedCount > 0 ? `${invitedCount} ${invitedCount === 1 ? 'Einladung offen' : 'Einladungen offen'}` : '',
    declinedCount > 0 ? `${declinedCount} abgesagt` : '',
  ]
    .filter(Boolean)
    .join(' · ');
}

function participantStateText(status) {
  if (status === 'invited') return 'Eingeladen';
  if (status === 'declined') return 'Abgesagt';
  if (!status) return 'Nicht eingeladen';
  return '';
}

// Flat two-column roster, filled column by column like a RankedList. Every
// row keeps one line: name, a muted state and an excuse are truncated rather
// than wrapped, so both columns stay on the same row rhythm. Management rows
// show only the controls that apply, right-aligned: the remove trash, then
// "Bezahlt" or "Einladen". Whatever comes last always ends flush right. Members see the
// accepted roster plus declines that left an excuse. A row with an excuse
// shows it shortened; clicking the excuse opens the full text.
function renderParticipantsSection(event, { includeInvitationStatuses = false } = {}) {
  const participants = eventRoster(event, includeInvitationStatuses);
  const isGroup = eventIsGroup(event);
  const myId = getMyId();
  const canManagePayments = includeInvitationStatuses && canManageEventPayments(event)
    && (event.costCents !== null || participants.some((participant) => participant.paid));
  const excuses = new Map((event.declinedExcuses || []).map((entry) => [entry.playerId, entry.excuse]));
  const declinedWithExcuse = includeInvitationStatuses
    ? []
    : (event.declinedExcuses || []).map((entry) => ({ playerId: entry.playerId, name: entry.name, status: 'declined' }));
  const rows = includeInvitationStatuses
    ? [...participants, ...state.players.filter((player) => !event.isEnded && !participants.some((entry) => entry.playerId === player.id))
      .map((player) => ({ playerId: player.id, name: player.name }))]
    : [...participants, ...declinedWithExcuse];
  const half = Math.ceil(rows.length / 2);
  const summary = (isGroup
    ? participantSummary(participants, includeInvitationStatuses).replace(/(\d+) Zusagen?/, (_, n) => `${n} ${n === '1' ? 'Mitglied' : 'Mitglieder'}`)
    : participantSummary(participants, includeInvitationStatuses))
    + (declinedWithExcuse.length ? ` · ${declinedWithExcuse.length} abgesagt` : '');
  const rowHtml = rows.map((participant, index) => {
    const player = state.players.find((candidate) => candidate.id === participant.playerId) ?? participant;
    const status = includeInvitationStatuses ? participant.status : (participant.status ?? 'accepted');
    const stateText = participantStateText(status);
    const excuse = status === 'declined' ? excuses.get(participant.playerId) : null;
    const isMe = participant.playerId === myId;
    const paidTitle = participant.paid
      ? `${participant.name}: ${paymentProof(participant)}. Markierung aufheben`
      : `${participant.name} als bezahlt markieren`;
    let slot = '';
    let remove = '';
    if (includeInvitationStatuses) {
      if (status === 'accepted') {
        slot = canManagePayments
          ? `<button type="button" class="payment-paid-marker ${participant.paid ? 'is-paid' : ''}" data-toggle-event-paid="${escapeHtml(event.id)}" data-payment-player="${escapeHtml(participant.playerId)}" aria-pressed="${Boolean(participant.paid)}" title="${escapeHtml(paidTitle)}" aria-label="${escapeHtml(paidTitle)}"><span class="payment-paid-box" aria-hidden="true">${participant.paid ? icon('check') : ''}</span><span>Bezahlt</span></button>`
          : '';
      } else if (!event.isEnded && (!status || status === 'declined')) {
        slot = `<button type="button" class="btn btn-sm" data-invite-participant="${escapeHtml(participant.playerId)}" data-roster-event="${escapeHtml(event.id)}">Einladen</button>`;
      }
      if (status) {
        const locked = Boolean(participant.paymentLocked ?? participant.paid);
        const removeLabel = locked
          ? `${participant.name} hat bezahlt und kann nicht entfernt werden`
          : `${participant.name} entfernen`;
        remove = `<button type="button" class="icon-btn event-roster-remove" data-remove-participant="${escapeHtml(participant.playerId)}" data-roster-event="${escapeHtml(event.id)}" ${locked ? 'disabled' : ''} title="${escapeHtml(removeLabel)}" aria-label="${escapeHtml(removeLabel)}">${icon('trash')}</button>`;
      }
    }
    const trailing = includeInvitationStatuses
      ? `${remove}${slot ? `<span class="event-roster-slot">${slot}</span>` : ''}`
      : '';
    return `<li class="event-participant-row${index === 0 || index === half ? ' is-column-start' : ''}" ${includeInvitationStatuses && status ? `data-event-participation-status="${escapeHtml(status)}"` : ''}>
      ${avatarHtml(player, 24)}
      ${excuse
        ? `<span class="event-participant-name">
            <span class="player-name${isMe ? ' is-me' : ''}">${escapeHtml(participant.name)}</span><span class="muted"> · ${stateText} · </span><button type="button" class="event-participant-excuse event-participant-excuse-toggle" data-show-excuse="${escapeHtml(participant.playerId)}" data-excuse-event="${escapeHtml(event.id)}" title="Ausrede lesen" aria-label="${escapeHtml(`Ausrede von ${participant.name} lesen`)}">„${escapeHtml(excuse)}“</button>
          </span>`
        : `<span class="event-participant-name">
            <span class="player-name${isMe ? ' is-me' : ''}">${escapeHtml(participant.name)}</span>${stateText ? `<span class="muted"> · ${stateText}</span>` : ''}
          </span>`}
      ${trailing}
    </li>`;
  }).join('');
  return `
    <section class="event-card-section event-card-participants" data-event-participants="${escapeHtml(event.id)}">
      <h4 class="event-card-section-title">${isGroup ? 'Mitglieder' : 'Teilnehmende'} <span class="muted">${escapeHtml(summary)}</span></h4>
      ${includeInvitationStatuses && event.isEnded ? '<p class="muted event-participants-note">Für beendete Events sind keine neuen Einladungen mehr möglich.</p>' : ''}
      ${rows.length
        ? `<ul class="event-participant-list" style="--event-roster-rows:${half}">${rowHtml}</ul>`
        : `<p class="muted event-card-empty-copy">${isGroup ? 'Noch keine Mitglieder.' : 'Noch niemand zugesagt.'}</p>`}
    </section>`;
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
      <section class="event-card-section">
      <h4 class="event-card-section-title">Abrechnung</h4>
      <div class="event-card-payment event-card-payment-creator">
        <div class="event-payment-heading">
          <div class="event-card-detail">
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
      </div>
      </section>`;
  }

  const isPaid = Boolean(myParticipation?.paid);
  const due = event.paymentDueAt ? ` · bis ${new Date(event.paymentDueAt).toLocaleDateString('de-DE')}` : '';
  const meta = myParticipation && isPaid ? ` · ${paymentProof(myParticipation)}` : due;
  return `
    <section class="event-card-section">
      <h4 class="event-card-section-title">${myParticipation ? 'Dein Beitrag' : 'Kosten pro Person'}</h4>
      <div class="event-info-row event-payment-member">
        <span class="event-info-label">Beitrag</span>
        <span class="event-info-value"><strong class="event-info-strong">${escapeHtml(amount)}</strong><span class="muted">${escapeHtml(meta)}</span></span>
        <span class="event-info-actions">
          ${myParticipation ? `<button type="button" class="payment-paid-marker ${isPaid ? 'is-paid' : ''}" data-toggle-event-paid="${escapeHtml(event.id)}" data-payment-player="${escapeHtml(myParticipation.playerId)}" aria-pressed="${isPaid}" title="${isPaid ? 'Eigene Bezahlt-Markierung aufheben' : 'Eigenen Beitrag als bezahlt markieren'}" aria-label="${isPaid ? 'Eigene Bezahlt-Markierung aufheben' : 'Eigenen Beitrag als bezahlt markieren'}"><span class="payment-paid-box" aria-hidden="true">${isPaid ? icon('check') : ''}</span><span>Bezahlt</span></button>` : ''}
          ${myParticipation && event.paypalLink ? `<button type="button" class="icon-btn payment-paypal-button" data-pay-event="${escapeHtml(event.id)}" ${isPaid ? 'disabled' : ''} title="${escapeHtml(isPaid ? 'Bereits bezahlt' : payTitle)}" aria-label="${escapeHtml(isPaid ? 'Bereits bezahlt' : payTitle)}">${icon('paypal')}</button>` : ''}
        </span>
      </div>
    </section>`;
}

// Opens PayPal for the signed-in account's own contribution and records it
// once confirmed. Shared with Home's "Meine To-Dos".
export async function handleEventPay(eventId, ctx) {
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

function copyButtonHtml(value, label) {
  return `<button type="button" class="icon-btn" data-copy-event-value="${escapeHtml(value)}" title="${escapeHtml(label)}" aria-label="${escapeHtml(label)}">${icon('copy')}</button>`;
}

// Infos: period and place first, as the two facts people look up and paste.
// Each row keeps label, value and actions in fixed columns.
function renderEventInfoSection(event) {
  const rows = [];
  const schedule = eventScheduleLabel(event);
  if (schedule) {
    rows.push(`<div class="event-info-row">
      <span class="event-info-label">Zeitraum</span>
      <span class="event-info-value event-info-strong">${escapeHtml(schedule)}</span>
      <span class="event-info-actions">${renderEventCalendarActions(event)}${copyButtonHtml(schedule, 'Zeitraum kopieren')}</span>
    </div>`);
  }
  if (event.location) {
    const href = eventLocationHref(event.location);
    rows.push(`<div class="event-info-row">
      <span class="event-info-label">Ort</span>
      <span class="event-info-value event-info-strong"><a class="event-location-link" href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${escapeHtml(event.location)}</a></span>
      <span class="event-info-actions">
        <a class="icon-btn" href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer" title="In Google Maps öffnen" aria-label="${escapeHtml(`${event.location} in Google Maps öffnen`)}">${icon('squareArrowOutUpRight')}</a>
        ${copyButtonHtml(event.location, 'Ort kopieren')}
      </span>
    </div>`);
  }
  if (event.description) {
    rows.push(`<div class="event-info-row">
      <span class="event-info-label">Notiz</span>
      <span class="event-info-value event-info-note">${escapeHtml(event.description)}</span>
    </div>`);
  }
  if (rows.length === 0) return '';
  return `<section class="event-card-section">
    <h4 class="event-card-section-title">Infos</h4>
    <div class="event-info-rows">${rows.join('')}</div>
  </section>`;
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

// The own answer stays on the card for as long as it can be changed. A yes is
// withdrawn through "Absagen", which offers a plain decline and, for an event
// still ahead, a decline with an excuse everyone gets to read. A no is taken
// back with "Zusagen". A still-open invitation is answered in "Mein Profil".
export function ownParticipationAction(event, { primary = true } = {}) {
  const participation = event.myParticipation;
  if (!participation || participation.status === 'invited') return '';
  const id = escapeHtml(event.id);
  if (participation.status === 'accepted') {
    if (!participation.canDecline) return participationLockNote(event);
    const withExcuse = !event.isEnded && !eventIsGroup(event);
    return actionMenuHtml(
      [
        `<button type="button" class="btn btn-sm" data-decline-participation="${id}">Absagen</button>`,
        withExcuse ? `<button type="button" class="btn btn-sm" data-decline-with-excuse="${id}">Mit Ausrede absagen</button>` : '',
      ],
      `Absagen: Teilnahme an ${event.name}`,
      { key: `event-decline-${event.id}`, summary: 'Absagen' },
    );
  }
  return participation.canAccept
    ? `<button type="button" class="btn${primary ? ' btn-primary' : ''} btn-sm" data-accept-participation="${id}">Zusagen</button>`
    : participationLockNote(event);
}

export function renderOwnParticipationActions(event, { primary = true } = {}) {
  const action = ownParticipationAction(event, { primary });
  return action ? `<div class="event-card-actions">${action}</div>` : '';
}

// A management card is the only place an owner/admin sees an event they
// declined themselves, so the state is spelled out on the card.
function ownDeclinedBadge(event) {
  return event.myParticipation?.status === 'declined'
    ? '<span class="badge badge-offline">Du: Abgesagt</span>'
    : '';
}

// One meta line: type and headcount always; while collapsed also the period
// and place, which the open card shows in its Infos rows instead.
function eventHeaderMeta(event, { withDateRange }) {
  const isGroup = eventIsGroup(event);
  const count = acceptedParticipants(event).length;
  const parts = [eventTypeTitle(event.eventType, state.eventTypeOptions)];
  if (withDateRange && !isGroup) parts.push(eventDateRange(event).replace(' – ', ' bis '));
  if (withDateRange && event.location) parts.push(event.location);
  parts.push(isGroup
    ? `${count} ${count === 1 ? 'Mitglied' : 'Mitglieder'}`
    : `${count} ${count === 1 ? 'Zusage' : 'Zusagen'}`);
  return parts;
}

function renderEventHeaderText(event, metaParts) {
  return `<span class="event-card-heading">
    <span class="food-order-card-title">${escapeHtml(event.name)}</span>
    <span class="muted event-card-meta">${escapeHtml(metaParts.join(' · '))}</span>
  </span>`;
}

function renderEventCardToggle(event, expanded, titleHtml, metaParts) {
  const kind = eventIsGroup(event) ? 'Gruppe' : 'Event';
  const label = `${kind} ${event.name}, ${metaParts.join(', ')}, ${expanded ? 'einklappen' : 'ausklappen'}`;
  return `<button type="button" class="food-order-card-header-toggle" data-event-card-toggle="${escapeHtml(event.id)}" aria-expanded="${expanded ? 'true' : 'false'}" aria-controls="event-card-body-${escapeHtml(event.id)}" aria-label="${escapeHtml(label)}">
    ${icon('chevronRight', { className: 'food-order-card-chevron' })}
    ${titleHtml}
  </button>`;
}

// Running tracking is the only lifecycle state worth a chip; everything else
// is evident from the list an event sits in.
function trackingChip(event) {
  return event.trackingEnabled && !event.isEnded
    ? '<span class="badge badge-playing event-tracking-chip">Trackt</span>'
    : '';
}

function renderEventCardShell(event, { collapsible, managed }) {
  const expanded = !collapsible || expandedEventCards.has(event.id);
  const metaParts = eventHeaderMeta(event, { withDateRange: !expanded });
  const titleHtml = renderEventHeaderText(event, metaParts);
  const side = managed ? renderManagementMenu(event) : '';
  return `
    <article class="card stack event-card ${managed ? 'event-card-managed' : 'event-card-member'}${collapsible ? ' is-collapsible' : ''}" data-event-card="${escapeHtml(event.id)}">
      <div class="row-between food-order-card-header event-card-header">
        ${collapsible ? renderEventCardToggle(event, expanded, titleHtml, metaParts) : titleHtml}
        <div class="event-card-header-side">${ownDeclinedBadge(event)}${trackingChip(event)}${side}</div>
      </div>
      <div class="food-order-card-body event-card-body" id="event-card-body-${escapeHtml(event.id)}" ${expanded ? '' : 'hidden'}>
        ${renderEventInfoSection(event)}
        ${renderEventPayment(event)}
        ${renderParticipantsSection(event, { includeInvitationStatuses: managed })}
        ${renderOwnParticipationActions(event, { primary: false })}
      </div>
    </article>
  `;
}

// Read-only card for a member's own events: same sections, no lifecycle menu.
function renderMemberEventCard(event, { collapsible = false } = {}) {
  return renderEventCardShell(event, { collapsible, managed: false });
}

// A declined event keeps exactly the teaser it was answered from, no roster,
// plus the way back.
export function renderDeclinedEventCard(event) {
  return `
    <article class="card stack event-card event-card-declined" data-declined-event="${escapeHtml(event.id)}">
      <div class="row-between food-order-card-header event-card-header">
        <span class="event-card-heading">
          <h3 class="food-order-card-title">${escapeHtml(event.name)}</h3>
          <span class="muted event-card-meta">${escapeHtml([eventTypeTitle(event.eventType, state.eventTypeOptions), eventIsGroup(event) ? '' : eventDateRange(event).replace(' – ', ' bis ')].filter(Boolean).join(' · '))}</span>
        </span>
      </div>
      <div class="event-card-body">
        ${renderEventInfoSection({ ...event, myParticipation: null, isEnded: true })}
        ${renderOwnParticipationActions(event)}
      </div>
    </article>
  `;
}

function renderManagementMenu(event) {
  const hasDate = event.startsAt != null;
  const trackingBtn = !hasDate || !eventHasFeature(event, 'tracking')
    ? ''
    : event.isEnded
      ? `<button type="button" class="btn btn-sm" data-restart-event="${event.id}">Event wieder starten</button>`
      : event.trackingEnabled
        ? `<button type="button" class="btn btn-sm" data-stop-tracking="${event.id}">Tracking stoppen</button>`
        : `<button type="button" class="btn btn-sm" data-start-tracking="${event.id}">Tracking starten</button>`;
  const endBtn = event.isEnded
    ? ''
    : `<button type="button" class="btn btn-sm btn-danger" data-end-event="${event.id}">Beenden</button>`;
  return actionMenuHtml(
    [`<button type="button" class="btn btn-sm" data-edit-event="${escapeHtml(event.id)}">Bearbeiten</button>`, trackingBtn, endBtn],
    `Aktionen für ${eventIsGroup(event) ? 'Gruppe' : 'Event'} ${event.name}`,
    { key: `event-manage-${event.id}`, inlineMax: 0 },
  );
}

export function renderEventCard(event, { collapsible = false } = {}) {
  return renderEventCardShell(event, { collapsible, managed: true });
}

// Events and groups are two different kinds of workspace, so they get two
// lists rather than one mixed feed: an event is a dated occasion that ends,
// a group is a permanent circle. Each list owns its own create action, empty
// text and — for events — the collapsed Abgesagt/Historie sections a group
// cannot have, since a group never ends.
function renderWorkspaceSection({
  groups: isGroupList,
  events,
  declinedEvents,
  canManage,
  renderCard,
}) {
  const listKind = isGroupList ? 'group' : 'event';
  const titleId = isGroupList ? 'orga-groups-title' : 'orga-events-title';
  const title = isGroupList ? 'Gruppen' : 'Events';
  const createLabel = isGroupList ? 'Gruppe anlegen' : 'Event anlegen';
  const createId = isGroupList ? 'new-group-btn' : 'new-event-btn';
  const activeEvents = events.filter((e) => !e.isEnded);
  const endedEvents = events.filter((e) => e.isEnded);
  // Mirrors foodOrders.js's open/closed cards: a lone card gets no collapse
  // chrome, since there is nothing to declutter yet.
  const activeCollapsible = activeEvents.length > 1;
  const endedCollapsible = endedEvents.length > 1;
  const emptyText = isGroupList
    ? 'Noch keine Gruppen.'
    : events.length === 0
      ? 'Noch keine Events.'
      : (canManage ? 'Keine laufenden Events.' : 'Aktuell kein laufendes Event.');

  return `
    <section class="card stack grouped-page-section primary-collection-section" aria-labelledby="${titleId}">
      <div class="grouped-page-section-title">
        <h2 id="${titleId}" tabindex="-1">${title}</h2>
        ${
          canManage
            ? `<span class="row" style="gap:var(--space-2);">
                 <button type="button" class="btn btn-primary btn-sm" id="${createId}">${createLabel}</button>
               </span>`
            : ''
        }
      </div>
      ${
        activeEvents.length === 0
          ? emptyStateHtml(emptyText)
          : `<div class="stack orga-event-grid">${activeEvents
              .map((event) => renderCard(event, { collapsible: activeCollapsible }))
              .join('')}</div>`
      }
      ${
        declinedEvents.length > 0
          ? `<details class="card grouped-page-section collapsible-section" data-declined-events="${listKind}" ${declinedOpen[listKind] ? 'open' : ''}>
               <summary class="collapsible-section-header">
                 <span class="collapsible-section-chevron">${icon('chevronRight')}</span>
                 <h2>Abgesagt</h2>
                 <span class="collapsible-section-summary-end">
                   <span class="badge badge-offline">${declinedEvents.length}</span>
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
          ? `<details class="card grouped-page-section collapsible-section" data-event-history="${listKind}" ${historyOpen[listKind] ? 'open' : ''}>
               <summary class="collapsible-section-header">
                 <span class="collapsible-section-chevron">${icon('chevronRight')}</span>
                 <h2>Historie</h2>
                 <span class="collapsible-section-summary-end">
                   <span class="badge badge-offline">${endedEvents.length}</span>
                 </span>
               </summary>
               <div class="collapsible-section-content">
                 <div class="stack orga-event-grid">${endedEvents
                   .map((event) => renderCard(event, { collapsible: endedCollapsible }))
                   .join('')}</div>
               </div>
             </details>`
          : ''
      }
    </section>
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
  const renderCard = (event, opts) => (canManage ? renderEventCard(event, opts) : renderMemberEventCard(event, opts));
  // An owner/admin already sees every event of the group as a management card,
  // so their own declined ones must not appear a second time down here.
  const renderedIds = new Set(events.map((e) => e.id));
  const declinedEvents = (state.declinedEvents || [])
    .filter((e) => !renderedIds.has(e.id))
    .slice()
    .sort(compareEventsByStartAscending);

  const section = (isGroupList) =>
    renderWorkspaceSection({
      groups: isGroupList,
      events: events.filter((event) => eventIsGroup(event) === isGroupList),
      declinedEvents: declinedEvents.filter((event) => eventIsGroup(event) === isGroupList),
      canManage,
      renderCard,
    });

  return `${section(false)}${section(true)}`;
}

// Profile lists pending invitations as flat rows: name, one meta line and a
// fixed "Annehmen" slot. Everything else (full name and place, note, cost,
// the excuse generator and "Ablehnen") lives in the detail dialog the row
// opens. Home's "Aktuell" list links here (see aktuellStatus.js).
const INVITATION_TITLE_LIMIT = 40;

function invitationMeta(event) {
  return [
    eventTypeTitle(event.eventType, state.eventTypeOptions),
    // UI copy avoids dashes; the shared range helper joins with one.
    eventIsGroup(event) ? '' : eventDateRange(event).replace(' – ', ' bis '),
    event.location,
  ].filter(Boolean).map((part) => escapeHtml(part)).join(' · ');
}

export function renderInvitationRow(event) {
  const id = escapeHtml(event.id);
  const title = event.name.length > INVITATION_TITLE_LIMIT
    ? `${event.name.slice(0, INVITATION_TITLE_LIMIT - 1).trimEnd()}…`
    : event.name;
  return `
    <div class="profile-row is-link" data-pending-invitation="${id}">
      <button type="button" class="profile-row-main profile-row-open" data-open-invitation="${id}" aria-label="${escapeHtml(event.name)} anzeigen">
        <span class="profile-row-text">
          <span class="profile-row-title">${escapeHtml(title)}</span>
          <span class="profile-row-meta">${invitationMeta(event)}</span>
        </span>
      </button>
      <span class="profile-row-action"><button type="button" class="btn btn-sm" data-accept-invitation="${id}">Annehmen</button></span>
    </div>`;
}

export function openInvitationDialog(event, ctx) {
  const facts = [
    ['Art', escapeHtml(eventTypeTitle(event.eventType, state.eventTypeOptions))],
    eventIsGroup(event) ? null : ['Zeitraum', escapeHtml(eventDateRange(event).replace(' – ', ' bis '))],
    event.location ? ['Ort', escapeHtml(event.location)] : null,
    event.description ? ['Notiz', escapeHtml(event.description)] : null,
    event.costCents ? ['Kosten', escapeHtml(formatEuroCents(event.costCents))] : null,
    event.paymentDueAt ? ['Zahlungsziel', escapeHtml(new Date(event.paymentDueAt).toLocaleDateString('de-DE'))] : null,
  ].filter(Boolean);
  // An ended event or a group has nothing left to collide with.
  const excuse = event.isEnded || eventIsGroup(event)
    ? ''
    : `<button type="button" class="btn btn-sm" data-event-excuse="${escapeHtml(event.id)}" title="Ausrede für einen Paralleltermin generieren">Ausrede</button>`;
  const { close } = openModal(
    event.name,
    `<div class="stack">
       <dl class="checklist-detail-facts">
         ${facts.map(([label, value]) => `<dt>${label}</dt><dd>${value}</dd>`).join('')}
       </dl>
       <div class="invitation-detail-footer${excuse ? ' has-excuse' : ''}">
         ${excuse}
         <button type="button" class="btn btn-sm" data-decline-invitation="${escapeHtml(event.id)}">Ablehnen</button>
         <button type="button" class="btn btn-primary btn-sm" data-accept-invitation="${escapeHtml(event.id)}">Annehmen</button>
       </div>
     </div>`,
    {
      onMount: (el) => {
        (el.closest('.modal') ?? el.querySelector('.modal'))?.classList.add('checklist-detail-modal');
        wireEventExcuseActions(el);
        el.querySelectorAll('[data-accept-invitation], [data-decline-invitation]').forEach((btn) => {
          btn.addEventListener('click', async () => {
            if (await answerPendingInvitation(btn, ctx)) close();
          });
        });
      },
    },
  );
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
        <button type="button" class="btn btn-sm" data-open-accepted-event="${escapeHtml(acceptedInvitationHandoff.id)}">Event öffnen</button>
      </div>
      <p class="profile-note">Du nimmst an „${escapeHtml(acceptedInvitationHandoff.name)}“ teil</p>
    </section>`;
}

// Records that the account copied the event into its calendar, which ends
// the calendar reminders. Shared with Home's "Meine To-Dos". Resolves true
// once confirmed.
export async function confirmEventCalendarEntry(eventId, { needsExtraCheck = false, button = null, ctx }) {
  if (
    needsExtraCheck &&
    !(await confirmDialog('Hast du den Termin wirklich eingetragen, Stefan??!!', {
      title: 'Ganz sicher, Stefan?',
      confirmText: 'Ja, wirklich',
    }))
  ) return false;
  if (button) button.disabled = true;
  try {
    await api.events.confirmCalendar(eventId);
    await ctx.refresh();
    showToast('Kalenderübernahme bestätigt. Weitere Kalender-Erinnerungen sind beendet.');
    return true;
  } catch (err) {
    if (button) button.disabled = false;
    showToast(err.message, { error: true });
    return false;
  }
}

// Shared by the row's "Annehmen" and the detail dialog. The refresh replaces
// the clicked button's own DOM, so focus moves to a still-present Profile
// heading instead of falling back to <body>. Resolves true once answered.
export async function answerPendingInvitation(btn, ctx) {
  const accept = Boolean(btn.dataset.acceptInvitation);
  const eventId = btn.dataset.acceptInvitation || btn.dataset.declineInvitation;
  const invitation = (state.eventInvitations || []).find((event) => event.id === eventId);
  btn.disabled = true;
  try {
    if (accept) await api.events.acceptInvitation(eventId);
    else await api.events.declineInvitation(eventId);
    if (accept) window.dispatchEvent(new CustomEvent('respawn:event-invitation-accepted'));
    await settleNotificationTarget(`event-invitation:${eventId}:${getMyId()}`);
    acceptedInvitationHandoff = accept
      ? { id: eventId, name: invitation?.name ?? 'diesem Event' }
      : null;
    await ctx.refresh();
    window.dispatchEvent(new CustomEvent('respawn:notifications-refresh'));
    (
      document.querySelector('#profile-accepted-invitation-title')
      || document.querySelector('#profile-invitations-title')
      || document.querySelector('#profile-view-title')
      || document.querySelector('#home-todos-title')
    )?.focus();
    showToast(accept ? 'Einladung angenommen.' : 'Einladung abgelehnt.');
    return true;
  } catch (err) {
    btn.disabled = false;
    showToast(err.message, { error: true });
    return false;
  }
}

export function wirePendingInvitationActions(container, ctx) {
  container.querySelectorAll('[data-accept-invitation]').forEach((btn) => {
    btn.addEventListener('click', () => answerPendingInvitation(btn, ctx));
  });
  container.querySelectorAll('[data-open-invitation]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const invitation = (state.eventInvitations || []).find((event) => event.id === btn.dataset.openInvitation);
      if (invitation) openInvitationDialog(invitation, ctx);
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

  container.querySelectorAll('[data-decline-with-excuse]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const eventId = btn.dataset.declineWithExcuse;
      const event = eventCardById(eventId);
      if (!event) return;
      openExcuseDialog(event, {
        onDecline: async (excuse) => {
          try {
            await api.events.declineInvitation(eventId, excuse);
            await ctx.refresh();
            container.querySelector('#orga-events-title')?.focus();
            showToast('Teilnahme abgesagt. Deine Ausrede ist für alle sichtbar.');
            return true;
          } catch (err) {
            showToast(err.message, { error: true });
            return false;
          }
        },
      });
    });
  });

  container.querySelectorAll('[data-accept-participation]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const eventId = btn.dataset.acceptParticipation;
      btn.disabled = true;
      try {
        await api.events.acceptInvitation(eventId);
        window.dispatchEvent(new CustomEvent('respawn:event-invitation-accepted'));
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

// existing === null: create a new (not-yet-tracking) event. existing !==
// null: metadata-only edit of that event (any event, ended or not) — never
// touches tracking state.
function eventFormTitle(isEdit, isGroup) {
  if (isEdit) return isGroup ? 'Gruppe bearbeiten' : 'Event bearbeiten';
  return isGroup ? 'Neue Gruppe' : 'Neues Event';
}

function eventFormSubmitLabel(isGroup) {
  return isGroup ? 'Gruppe anlegen' : 'Event anlegen';
}

function openEventForm(ctx, existing, { eventType: preselectedEventType } = {}) {
  const isEdit = Boolean(existing);
  const eventTypes = availableEventTypeOptions(state.eventTypeOptions);
  const selectedEventType = existing?.eventType ?? preselectedEventType ?? 'lan';
  // A group has no period and no money, so those blocks are hidden rather
  // than disabled — a control you cannot use is noise, not information. The
  // flag tracks the live selection because the type can still be switched
  // inside the dialog.
  let isGroup = isGroupEventType(selectedEventType);
  const eventTypeSelectOptions = eventTypes
    .map(
      (eventType) =>
        `<option value="${escapeHtml(eventType.key)}" ${eventType.key === selectedEventType ? 'selected' : ''}>${escapeHtml(eventType.title)}</option>`,
    )
    .join('');
  let capturedEl;
  const { close } = openModal(
    eventFormTitle(isEdit, isGroup),
    `
      <form id="event-form" class="stack">
        <div>
          <label for="event-name" class="field-label is-required">Name</label>
          <input type="text" id="event-name" maxlength="80" required autofocus value="${escapeHtml(existing?.name ?? '')}" placeholder="LAN Winter 2027" />
        </div>
        <div>
          <label for="event-type" class="field-label is-required">Typ</label>
          <select id="event-type" ${isEdit ? 'disabled' : ''}>${eventTypeSelectOptions}</select>
        </div>
        <div class="field-row" data-event-schedule-fields ${isGroup ? 'hidden' : ''}>
          <div>
            <!-- Never required, so never marked: the period may be entered late
                 and removed again, and clearable is what carries the removal.
                 That also keeps a hidden input out of form validation, which is
                 what used to block "Speichern" on a group and on an event still
                 waiting for its date. -->
            <label for="event-starts-date" class="field-label">Beginnt am</label>
            ${dateTimeFieldHtml('event-starts', existing?.startsAt ?? null, { clearable: true, label: 'Beginnt am' })}
          </div>
          <div>
            <label for="event-ends-date" class="field-label">Endet am</label>
            ${dateTimeFieldHtml('event-ends', existing?.endsAt ?? null, { clearable: true, label: 'Endet am' })}
          </div>
        </div>
        <div>
          <label for="event-location" class="field-label">Ort oder Karten-Link</label>
          <input type="text" id="event-location" maxlength="500" placeholder="Jugendherberge Harz" value="${escapeHtml(existing?.location ?? '')}" />
        </div>
        <div>
          <label for="event-description" class="field-label">Notiz</label>
          <textarea id="event-description" maxlength="500" rows="1" placeholder="Treffpunkt um 16 Uhr am Bahnhof">${escapeHtml(existing?.description ?? '')}</textarea>
        </div>
        <div class="field-row event-payment-fields" data-event-payment-fields ${isGroup ? 'hidden' : ''}>
          <div>
            <label for="event-cost" class="field-label">Beitrag pro Person</label>
            <label class="food-order-price-field">
              <input type="text" class="food-order-price-input" id="event-cost" inputmode="decimal" placeholder="25,00" value="${existing?.costCents ? escapeHtml((existing.costCents / 100).toFixed(2).replace('.', ',')) : ''}" />
              <span aria-hidden="true">€</span>
            </label>
          </div>
          <div>
            <div class="food-order-paypal-label">
              <label for="event-accommodation-cost" class="field-label">Gesamtpreis Unterkunft</label>
              ${infoTooltipHtml('event-accommodation-cost-help', 'Gesamtpreis Unterkunft', 'Wird mit den bereits eingegangenen Beiträgen verglichen. Der rechnerische Preis pro Kopf verwendet nur aktuell zugesagte Personen.')}
            </div>
            <label class="food-order-price-field">
              <input type="text" class="food-order-price-input" id="event-accommodation-cost" inputmode="decimal" placeholder="1.200,00" value="${existing?.accommodationCostCents ? escapeHtml((existing.accommodationCostCents / 100).toFixed(2).replace('.', ',')) : ''}" />
              <span aria-hidden="true">€</span>
            </label>
          </div>
        </div>
        <div class="field-row event-payment-fields" data-event-payment-fields ${isGroup ? 'hidden' : ''}>
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
        <button type="submit" class="btn btn-primary btn-block" id="event-form-submit">${isEdit ? 'Speichern' : eventFormSubmitLabel(isGroup)}</button>
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
        const scheduleChanged = (
          (startsAt ? normalizeDatetimeLocalMs(new Date(startsAt).getTime()) : null) !== (existing?.startsAt == null ? null : normalizeDatetimeLocalMs(existing.startsAt)) ||
          (endsAt ? normalizeDatetimeLocalMs(new Date(endsAt).getTime()) : null) !== (existing?.endsAt == null ? null : normalizeDatetimeLocalMs(existing.endsAt))
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
          : isGroup
            ? Boolean(name || location || description)
            : Boolean(name || startsAt || endsAt || location || description || cost || accommodationCost || paypal || paymentDueAt);
        if (!dirty) return null;
        return isGroup
          ? 'Die Gruppendaten (Name, Ort und Notiz) gehen verloren.'
          : 'Die Event-Daten (Name, Zeitraum, Ort, Notiz, Beiträge, Unterkunftskosten, PayPal und Zahlungsziel) gehen verloren.';
      },
      onMount: (modalEl) => {
        capturedEl = modalEl;
        wireDateTimeField(modalEl, 'event-starts');
        wireDateTimeField(modalEl, 'event-ends');
        wireDateTimeRange(modalEl, 'event-starts', 'event-ends', { minimumGapMs: 5 * 60 * 1000 });
        wireDateTimeField(modalEl, 'event-payment-due');
        wireInfoTooltips(modalEl);
        // Switching the type live retitles the dialog and shows or hides the
        // period and money blocks. Their values stay put so switching back and
        // forth does not silently discard what was already typed; the submit
        // below simply never sends them for a group.
        modalEl.querySelector('#event-type')?.addEventListener('change', (event) => {
          isGroup = isGroupEventType(event.currentTarget.value);
          modalEl
            .querySelectorAll('[data-event-schedule-fields], [data-event-payment-fields]')
            .forEach((block) => {
              block.hidden = isGroup;
            });
          const title = eventFormTitle(isEdit, isGroup);
          const heading = modalEl.querySelector('.modal-header h2');
          if (heading) heading.textContent = title;
          modalEl.querySelector('.modal')?.setAttribute('aria-label', title);
          const submit = modalEl.querySelector('#event-form-submit');
          if (submit && !isEdit) submit.textContent = eventFormSubmitLabel(isGroup);
        });
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
          if (!isGroup && Number.isNaN(costCents)) {
            showToast('Der Beitrag muss zwischen 0,01 € und 10.000,00 € liegen.', { error: true });
            return;
          }
          const accommodationCostCents = parseEventAccommodationCostCents(
            modalEl.querySelector('#event-accommodation-cost').value,
          );
          if (!isGroup && Number.isNaN(accommodationCostCents)) {
            showToast('Der Gesamtpreis der Unterkunft muss zwischen 0,01 € und 100.000,00 € liegen.', { error: true });
            return;
          }
          let paypalLink = null;
          try {
            paypalLink = normalizePaypalInput(modalEl.querySelector('#event-paypal').value);
          } catch (err) {
            if (!isGroup) {
              showToast(err.message, { error: true });
              return;
            }
          }
          if (!isGroup && paypalLink && !costCents) {
            showToast('Für PayPal müssen Kosten pro Person angegeben werden.', { error: true });
            return;
          }
          if (!isGroup && paymentDueAt && !costCents) {
            showToast('Für ein Zahlungsziel müssen Kosten pro Person angegeben werden.', { error: true });
            return;
          }

          // Sent unconditionally: an omitted boundary leaves the stored one
          // untouched, so a cleared field would silently keep the old date.
          const schedulePayload = {
            startsAt: startsVal ? new Date(startsVal).getTime() : null,
            endsAt: endsVal ? new Date(endsVal).getTime() : null,
          };
          // The server rejects a period or any cost on a group outright, so
          // the hidden blocks contribute nothing to the request.
          const payload = {
            name,
            ...(!isEdit ? { eventType: modalEl.querySelector('#event-type').value } : {}),
            ...(isGroup
              ? {}
              : {
                  ...schedulePayload,
                  costCents,
                  accommodationCostCents,
                  paypalLink,
                  paymentDueAt,
                }),
            location: location || null,
            description: description || null,
          };

          try {
            if (isEdit) {
              await api.events.update(existing.id, payload);
              close();
              await ctx.refresh();
              showToast(isGroup ? 'Gruppe aktualisiert.' : 'Event aktualisiert.');
            } else {
              const created = await api.events.create(payload);
              close();
              expandedEventCards.add(created.id);
              await ctx.refresh();
              document.querySelector(`[data-event-participants="${CSS.escape(created.id)}"] [data-invite-participant]`)?.focus();
              showToast(isGroup ? 'Gruppe angelegt. Jetzt Mitglieder einladen.' : 'Event angelegt. Jetzt Teilnehmende einladen.');
            }
          } catch (err) {
            showToast(err.message, { error: true });
          }
        });
      },
    }
  );
}

function wireParticipantActions(container, ctx) {
  container.querySelectorAll('[data-roster-event]').forEach((button) => {
    button.addEventListener('click', async () => {
      const eventId = button.dataset.rosterEvent;
      const event = (state.managedEvents || []).find((candidate) => candidate.id === eventId);
      if (!event) return;
      const playerId = button.dataset.inviteParticipant || button.dataset.removeParticipant;
      const isInvite = Boolean(button.dataset.inviteParticipant);
      const player = state.players.find((candidate) => candidate.id === playerId);
      if (!isInvite && !(await confirmDialog(`${player?.name ?? 'Diese Person'} wirklich aus dem Event entfernen?`, {
        title: 'Teilnahme entfernen?', confirmText: 'Entfernen', danger: true,
      }))) return;
      button.disabled = true;
      try {
        if (isInvite) await api.events.inviteParticipant(eventId, playerId);
        else await api.events.removeParticipant(eventId, playerId);
        await ctx.refresh();
        const roster = container.querySelector(`[data-event-participants="${CSS.escape(eventId)}"]`);
        (roster?.querySelector(`[data-invite-participant="${CSS.escape(playerId)}"], [data-remove-participant="${CSS.escape(playerId)}"]`) ?? roster?.querySelector('button'))?.focus();
        showToast(isInvite ? 'Einladung gesendet.' : 'Event-Teilnahme entfernt.');
      } catch (err) {
        button.disabled = false;
        showToast(err.message, { error: true });
      }
    });
  });
}

export function renderOrgaKiosk(container, ctx) {
  if (!isGroupAdmin()) {
    container.innerHTML = `
      <div class="more-subpage-header">
        <div class="more-subpage-title-row">
          <h1 class="view-title">Broadcast</h1>
        </div>
      </div>
      <div class="card stack">
        <strong>Nur für Admins verfügbar</strong>
        <span class="muted">Dieses Konto hat keine Admin-Rechte für die Broadcast-Verwaltung.</span>
        <button type="button" class="btn btn-primary btn-block" data-navigate="more">Zu Mehr</button>
      </div>`;
    return;
  }
  if (kioskPasswordState.status === 'idle') loadKioskPassword(ctx);
  container.innerHTML = `
    <div class="more-subpage-header">
      <div class="more-subpage-title-row">
        <h1 class="view-title">Broadcast</h1>
      </div>
      <p class="muted" style="font-size:var(--font-size-xs);">${escapeHtml(KIOSK_HELP)}</p>
    </div>
    <div class="grouped-page-sections">
      ${renderKioskSection()}
    </div>
  `;
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

// No longer an Orga tab, so this view owns its own page title and the way back
// to "Mehr", like every other destination reached directly from the hub.
export function renderOrgaEvents(container, ctx) {
  container.innerHTML = `
    <div class="more-subpage-header">
      <div class="more-subpage-title-row">
        <h1 class="view-title">Events &amp; Gruppen</h1>
      </div>
    </div>
    <div class="grouped-page-sections">
      ${renderEventSection()}
    </div>
  `;


  // Both lists can carry a "Historie" and an "Abgesagt" section, so every one
  // of them is bound and remembers itself under its own list kind.
  for (const [selector, state] of [
    ['[data-event-history]', historyOpen],
    ['[data-declined-events]', declinedOpen],
  ]) {
    container.querySelectorAll(selector).forEach((details) => {
      details.addEventListener('toggle', (e) => {
        const kind = e.currentTarget.dataset.eventHistory ?? e.currentTarget.dataset.declinedEvents;
        state[kind] = e.currentTarget.open;
      });
    });
  }

  container.querySelectorAll('[data-event-card-toggle]').forEach((button) => {
    button.addEventListener('click', () => {
      const eventId = button.dataset.eventCardToggle;
      if (expandedEventCards.has(eventId)) expandedEventCards.delete(eventId);
      else expandedEventCards.add(eventId);
      ctx.rerender();
      container.querySelector(`[data-event-card-toggle="${CSS.escape(eventId)}"]`)?.focus();
    });
  });

  wireActionMenus(container);
  wireParticipantActions(container, ctx);
  wireParticipationAnswerActions(container, ctx);

  wireEventExcuseActions(container);
  container.querySelectorAll('[data-show-excuse]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const event = eventCardById(btn.dataset.excuseEvent);
      const entry = (event?.declinedExcuses || []).find((candidate) => candidate.playerId === btn.dataset.showExcuse);
      if (!entry) return;
      openModal(`Ausrede von ${entry.name}`, `<blockquote class="excuse-text excuse-quote">„${escapeHtml(entry.excuse)}“</blockquote>`);
    });
  });
  container.querySelectorAll('[data-copy-event-value]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      try {
        await copyText(btn.dataset.copyEventValue);
        showToast('Kopiert.');
      } catch {
        showToast('Kopieren nicht möglich, bitte manuell markieren.', { error: true });
      }
    });
  });
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
      const confirmed = await confirmEventCalendarEntry(eventId, {
        needsExtraCheck: Boolean(event?.myParticipation?.calendarConfirmationNeedsExtraCheck),
        button: btn,
        ctx,
      });
      if (!confirmed) return;
      [...container.querySelectorAll('[data-event-calendar-confirmed]')]
        .find((candidate) => candidate.dataset.eventCalendarConfirmed === eventId)
        ?.focus();
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

  // Absent for a member: only owner/admin get the create action. Each list
  // preselects its own type; the dialog still lets you switch.
  container.querySelector('#new-event-btn')?.addEventListener('click', () => openEventForm(ctx, null));
  container
    .querySelector('#new-group-btn')
    ?.addEventListener('click', () => openEventForm(ctx, null, { eventType: 'group' }));
  container.querySelectorAll('[data-edit-event]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const event = (state.managedEvents || []).find((e) => e.id === btn.dataset.editEvent);
      if (event) openEventForm(ctx, event);
    });
  });
  container.querySelectorAll('[data-start-tracking]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const event = (state.managedEvents || []).find((e) => e.id === btn.dataset.startTracking);
      if (!event) return;
      if (!(await confirmDialog(TRACKING_START_CONFIRM(event.name), { title: 'Tracking starten', confirmText: 'Tracking starten' }))) return;
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
      if (!(await confirmDialog(TRACKING_STOP_CONFIRM(event.name), { title: 'Tracking stoppen', confirmText: 'Tracking stoppen' }))) return;
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
      const event = (state.managedEvents || []).find((e) => e.id === btn.dataset.restartEvent);
      if (!event) return;
      if (!(await confirmDialog(`Event „${event.name}“ wieder starten? Das Event wird geöffnet. ${TRACKING_SCOPE_SENTENCE}`, { title: 'Event wieder starten', confirmText: 'Event wieder starten' }))) return;
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
      const isGroup = eventIsGroup(event);
      const question = isGroup
        ? `Gruppe „${event.name}“ beenden? Sie wird in die Historie verschoben und ist danach nicht mehr auswählbar.`
        // The action now also reaches events that never tracked — an undated one
        // cannot — so the stopped-tracking half only appears when it is true.
        : `Event „${event.name}“ beenden? ${event.trackingEnabled ? 'Laufendes Tracking wird gestoppt und das Event wird' : 'Das Event wird'} in die Historie verschoben.`;
      if (!(await confirmDialog(question, { confirmText: 'Beenden', danger: true }))) return;
      try {
        await api.events.end(event.id);
        await ctx.refresh();
        showToast(isGroup ? 'Gruppe beendet.' : 'Event beendet.');
      } catch (err) {
        showToast(err.message, { error: true });
      }
    });
  });
}
