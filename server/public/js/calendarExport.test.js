import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  eventCalendarFilename,
  eventCalendarIcs,
  eventCalendarLinks,
} from './calendarExport.js';

const event = {
  id: 'summer-lan',
  name: 'Sommer LAN & Finale',
  startsAt: Date.UTC(2026, 7, 28, 16, 30),
  endsAt: Date.UTC(2026, 7, 30, 10, 0),
  location: 'Bei Bob, Hauptstraße 1',
  description: 'Erste Zeile\nZweite Zeile; mit Komma, und \\Slash',
};

test('calendar links prefill Google Calendar and Outlook with the event details', () => {
  const links = eventCalendarLinks(event);
  assert.ok(links);

  const google = new URL(links.google);
  assert.equal(google.origin, 'https://calendar.google.com');
  assert.equal(google.searchParams.get('action'), 'TEMPLATE');
  assert.equal(google.searchParams.get('dates'), '20260828T163000Z/20260830T100000Z');
  assert.equal(google.searchParams.get('text'), event.name);
  assert.equal(google.searchParams.get('details'), event.description);
  assert.equal(google.searchParams.get('location'), event.location);

  const outlook = new URL(links.outlook);
  assert.equal(outlook.origin, 'https://outlook.live.com');
  assert.equal(outlook.searchParams.get('rru'), 'addevent');
  assert.equal(outlook.searchParams.get('subject'), event.name);
  assert.equal(outlook.searchParams.get('startdt'), '2026-08-28T16:30:00Z');
  assert.equal(outlook.searchParams.get('enddt'), '2026-08-30T10:00:00Z');
  assert.equal(outlook.searchParams.get('body'), event.description);
  assert.equal(outlook.searchParams.get('location'), event.location);
});

test('calendar exports require a complete, forward-moving event period', () => {
  assert.equal(eventCalendarLinks({ ...event, startsAt: null }), null);
  assert.equal(eventCalendarLinks({ ...event, endsAt: null }), null);
  assert.equal(eventCalendarLinks({ ...event, endsAt: event.startsAt }), null);
  assert.equal(eventCalendarIcs({ ...event, startsAt: 'invalid' }), null);
});

test('ICS export uses UTC, escapes text and folds long UTF-8 lines', () => {
  const ics = eventCalendarIcs(
    { ...event, description: `${event.description} ${'ä'.repeat(80)}` },
    { generatedAt: Date.UTC(2026, 7, 25, 12, 0) },
  );
  assert.ok(ics);
  assert.match(ics, /\r\nDTSTART:20260828T163000Z\r\n/);
  assert.match(ics, /\r\nDTEND:20260830T100000Z\r\n/);
  assert.match(ics, /SUMMARY:Sommer LAN & Finale\r\n/);
  assert.match(ics, /DESCRIPTION:Erste Zeile\\nZweite Zeile\\; mit Komma\\, und \\\\Slash/);
  assert.match(ics, /\r\n ää/, 'a long UTF-8 property is folded with a continuation line');
  assert.ok(ics.endsWith('END:VCALENDAR\r\n'));
  assert.equal(ics.replace(/\r\n/g, '').includes('\n'), false, 'the file uses CRLF line endings only');
  for (const line of ics.trimEnd().split('\r\n')) {
    assert.ok(new TextEncoder().encode(line).length <= 75, `line exceeds 75 octets: ${line}`);
  }
});

test('calendar filenames stay readable and avoid reserved filename characters', () => {
  assert.equal(eventCalendarFilename({ name: '  LAN: Finale / 2026?  ' }), 'LAN- Finale - 2026-.ics');
  assert.equal(eventCalendarFilename({ name: '...' }), 'Event.ics');
});

test('truncating an over-long event name never leaves a trailing space or dot', () => {
  const truncatedAtSpace = eventCalendarFilename({ name: `${'A'.repeat(79)} Nachtrag` });
  assert.equal(truncatedAtSpace, `${'A'.repeat(79)}.ics`);
  assert.doesNotMatch(truncatedAtSpace, /[. ]\.ics$/);

  const truncatedAtDot = eventCalendarFilename({ name: `${'B'.repeat(79)}.. Finale` });
  assert.equal(truncatedAtDot, `${'B'.repeat(79)}.ics`);
  assert.doesNotMatch(truncatedAtDot, /[. ]\.ics$/);
});
