const GOOGLE_CALENDAR_URL = 'https://calendar.google.com/calendar/r/eventedit';
const OUTLOOK_CALENDAR_URL = 'https://outlook.live.com/calendar/0/deeplink/compose';

function validEventRange(event) {
  if (event?.startsAt == null || event?.endsAt == null) return null;
  const startsAt = Number(event?.startsAt);
  const endsAt = Number(event?.endsAt);
  if (!Number.isFinite(startsAt) || !Number.isFinite(endsAt) || endsAt <= startsAt) return null;
  return { startsAt, endsAt };
}

function utcCalendarTimestamp(timestamp) {
  return new Date(timestamp).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

function outlookTimestamp(timestamp) {
  return new Date(timestamp).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function icsText(value) {
  return String(value ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/\r\n|\r|\n/g, '\\n')
    .replace(/,/g, '\\,')
    .replace(/;/g, '\\;');
}

function foldIcsLine(line) {
  const encoder = new TextEncoder();
  const chunks = [];
  let chunk = '';
  let limit = 75;

  for (const character of line) {
    if (chunk && encoder.encode(chunk + character).length > limit) {
      chunks.push(chunk);
      chunk = character;
      limit = 74;
    } else {
      chunk += character;
    }
  }
  chunks.push(chunk);
  return chunks.map((value, index) => `${index === 0 ? '' : ' '}${value}`).join('\r\n');
}

export function eventCalendarLinks(event) {
  const range = validEventRange(event);
  if (!range) return null;

  const google = new URL(GOOGLE_CALENDAR_URL);
  google.searchParams.set('action', 'TEMPLATE');
  google.searchParams.set(
    'dates',
    `${utcCalendarTimestamp(range.startsAt)}/${utcCalendarTimestamp(range.endsAt)}`,
  );
  google.searchParams.set('text', event.name ?? 'Event');
  if (event.description) google.searchParams.set('details', event.description);
  if (event.location) google.searchParams.set('location', event.location);

  const outlook = new URL(OUTLOOK_CALENDAR_URL);
  outlook.searchParams.set('path', '/calendar/action/compose');
  outlook.searchParams.set('rru', 'addevent');
  outlook.searchParams.set('subject', event.name ?? 'Event');
  outlook.searchParams.set('startdt', outlookTimestamp(range.startsAt));
  outlook.searchParams.set('enddt', outlookTimestamp(range.endsAt));
  if (event.description) outlook.searchParams.set('body', event.description);
  if (event.location) outlook.searchParams.set('location', event.location);

  return { google: google.href, outlook: outlook.href };
}

export function eventCalendarFilename(event) {
  const safeName = Array.from(String(event?.name ?? 'Event'), (character) =>
    character.charCodeAt(0) < 32 || '<>:"/\\|?*'.includes(character) ? '-' : character,
  ).join('');
  const base = safeName
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/[. ]+$/g, '')
    .slice(0, 80);
  return `${base || 'Event'}.ics`;
}

export function eventCalendarIcs(event, { generatedAt = Date.now() } = {}) {
  const range = validEventRange(event);
  if (!range) return null;

  const uidSource = String(event.id ?? `${range.startsAt}-${event.name ?? 'event'}`)
    .replace(/[^a-zA-Z0-9._-]/g, '-')
    .slice(0, 120);
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Respawn LAN//Event Calendar//DE',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${uidSource}@respawn.local`,
    `DTSTAMP:${utcCalendarTimestamp(generatedAt)}`,
    `DTSTART:${utcCalendarTimestamp(range.startsAt)}`,
    `DTEND:${utcCalendarTimestamp(range.endsAt)}`,
    `SUMMARY:${icsText(event.name ?? 'Event')}`,
  ];
  if (event.description) lines.push(`DESCRIPTION:${icsText(event.description)}`);
  if (event.location) lines.push(`LOCATION:${icsText(event.location)}`);
  lines.push('STATUS:CONFIRMED', 'END:VEVENT', 'END:VCALENDAR');

  return `${lines.map(foldIcsLine).join('\r\n')}\r\n`;
}
