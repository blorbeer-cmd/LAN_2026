import { eventCalendarLinks } from './calendarExport.js';
import { escapeHtml } from './format.js';
import { icon } from './icons.js';

// Legacy planning events may have neither startsAt nor endsAt. The base
// workspace is permanently open (startsAt set, endsAt null).
export function eventDateRange(event) {
  if (event.startsAt == null) return 'Termin wird noch abgestimmt';
  if (event.endsAt == null) return 'Dauerhaft geöffnet';
  return `${new Date(event.startsAt).toLocaleDateString('de-DE')} – ${new Date(event.endsAt).toLocaleDateString('de-DE')}`;
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

export function renderEventCalendarActions(event, { invitation = false } = {}) {
  const links = invitation || event.isEnded ? null : eventCalendarLinks(event);
  if (!links) return '';
  const canConfirm = event.myParticipation?.status === 'accepted';
  const confirmation = canConfirm
    ? event.myParticipation.calendarConfirmed
      ? `<span class="badge badge-online event-calendar-confirmed" tabindex="-1" data-event-calendar-confirmed="${escapeHtml(event.id)}">Im Kalender eingetragen</span>`
      : `<div class="event-calendar-confirmation">
           <button type="button" class="btn btn-sm btn-primary" data-confirm-event-calendar="${escapeHtml(event.id)}">Übernahme bestätigen</button>
           <span class="muted">Beendet die Kalender-Erinnerungen.</span>
         </div>`
    : '';
  return `
    <div class="event-calendar-actions" role="group" aria-label="Event zum Kalender hinzufügen">
      <span class="event-card-detail-label">Zum Kalender hinzufügen</span>
      <div class="event-calendar-action-buttons">
        <a class="btn btn-sm" href="${escapeHtml(links.google)}" target="_blank" rel="noopener noreferrer" data-event-calendar="google">Google Kalender</a>
        <a class="btn btn-sm" href="${escapeHtml(links.outlook)}" target="_blank" rel="noopener noreferrer" data-event-calendar="outlook">Outlook</a>
        <button type="button" class="btn btn-sm" data-download-event-calendar="${escapeHtml(event.id)}">Kalenderdatei</button>
      </div>
      ${confirmation}
    </div>`;
}
