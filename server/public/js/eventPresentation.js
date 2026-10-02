import { eventCalendarLinks } from './calendarExport.js';
import { escapeHtml } from './format.js';
import { icon } from './icons.js';
import { actionMenuHtml } from './actionMenu.js';

// Legacy planning events may have neither startsAt nor endsAt. The base
// workspace is permanently open (startsAt set, endsAt null). A group has no
// period at all — and unlike an undated event, it is not waiting for one.
export function eventDateRange(event) {
  if (event.eventType === 'group' && !event.isBase) return 'Dauerhaft geöffnet';
  if (event.startsAt == null) return 'Termin wird noch abgestimmt';
  if (event.endsAt == null) return 'Dauerhaft geöffnet';
  return `${new Date(event.startsAt).toLocaleDateString('de-DE')} – ${new Date(event.endsAt).toLocaleDateString('de-DE')}`;
}

const WEEKDAYS = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];

function pad(value) {
  return String(value).padStart(2, '0');
}

// "Fr 13.10., 18:00": weekday and time make the period readable at a glance
// and paste cleanly into a chat. Midnight carries no time of its own.
function scheduleMoment(ms, { withYear }) {
  const date = new Date(ms);
  const day = `${WEEKDAYS[date.getDay()]} ${pad(date.getDate())}.${pad(date.getMonth() + 1)}.${withYear ? date.getFullYear() : ''}`;
  const hasTime = date.getHours() !== 0 || date.getMinutes() !== 0;
  return hasTime ? `${day}, ${pad(date.getHours())}:${pad(date.getMinutes())}` : day;
}

// The long, copyable period of the Infos row. UI copy joins with "bis"
// instead of a dash; the short eventDateRange() stays for compact meta lines.
export function eventScheduleLabel(event) {
  if (event.eventType === 'group' && !event.isBase) return '';
  if (event.startsAt == null) return 'Termin wird noch abgestimmt';
  if (event.endsAt == null) return 'Dauerhaft geöffnet';
  const start = new Date(event.startsAt);
  const end = new Date(event.endsAt);
  const sameYear = start.getFullYear() === end.getFullYear();
  const sameDay = sameYear && start.getMonth() === end.getMonth() && start.getDate() === end.getDate();
  if (sameDay) {
    const endTime = end.getHours() !== 0 || end.getMinutes() !== 0 ? ` bis ${pad(end.getHours())}:${pad(end.getMinutes())}` : '';
    return `${scheduleMoment(event.startsAt, { withYear: true })}${endTime}`;
  }
  return `${scheduleMoment(event.startsAt, { withYear: !sameYear })} bis ${scheduleMoment(event.endsAt, { withYear: true })}`;
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

// A location that already is a link keeps it; plain text becomes a Google
// Maps search, which every phone opens in its maps app.
export function eventLocationHref(location) {
  if (!location) return null;
  return eventLocationUrl(location)
    ?? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(location.trim())}`;
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

// "Kalender ▾" bundles the three ways into a calendar as named entries, and
// the own "Eingetragen" marker beside it ends the calendar reminders. Once set
// it stays set: the confirmation is a one-way acknowledgement.
export function renderEventCalendarActions(event, { invitation = false } = {}) {
  const links = invitation || event.isEnded ? null : eventCalendarLinks(event);
  if (!links) return '';
  const id = escapeHtml(event.id);
  const menu = actionMenuHtml(
    [
      `<a class="btn btn-sm" href="${escapeHtml(links.google)}" target="_blank" rel="noopener noreferrer" data-event-calendar="google">Google</a>`,
      `<a class="btn btn-sm" href="${escapeHtml(links.outlook)}" target="_blank" rel="noopener noreferrer" data-event-calendar="outlook">Outlook</a>`,
      `<button type="button" class="btn btn-sm" data-download-event-calendar="${id}">Download</button>`,
    ],
    `Kalender für ${event.name}`,
    { key: `event-calendar-${event.id}`, summary: 'Kalender' },
  );
  const canConfirm = event.myParticipation?.status === 'accepted';
  const confirmed = Boolean(event.myParticipation?.calendarConfirmed);
  const marker = canConfirm
    ? `<button type="button" class="payment-paid-marker event-calendar-marker ${confirmed ? 'is-paid' : ''}" ${confirmed ? `data-event-calendar-confirmed="${id}" aria-disabled="true"` : `data-confirm-event-calendar="${id}"`} aria-pressed="${confirmed}" title="${confirmed ? 'Im Kalender eingetragen' : 'Als eingetragen markieren, beendet die Kalender-Erinnerungen'}"><span class="payment-paid-box" aria-hidden="true">${confirmed ? icon('check') : ''}</span><span>Eingetragen</span></button>`
    : '';
  return `${menu}${marker}`;
}
