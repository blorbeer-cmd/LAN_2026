// Timezone-safe conversion between a plain calendar date (YYYY-MM-DD, no time
// zone of its own) and a UTC timestamp in milliseconds. Used by the event date
// poll so a chosen option's day always maps to the same real-world moment
// (midnight local time) regardless of when daylight saving time changes.
//
// Deliberately NOT `new Date('YYYY-MM-DD')`: that parses as UTC midnight, which
// is the wrong instant for any non-UTC zone and silently drifts across a DST
// change. Node's built-in Intl (full ICU, no extra dependency) is enough to do
// this correctly, so no timezone library is added to package.json.

// MVP fallback: there is no per-group timezone setting yet, so every event
// date poll uses this fixed zone (see docs/plans/event-date-poll-concept.md).
export const EVENT_DATE_POLL_TIME_ZONE = 'Europe/Berlin';

const ISO_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isValidIsoDate(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const match = ISO_DATE_RE.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12) return false;
  // Reject e.g. "2026-02-30": construct in UTC and read back the same parts.
  const probe = new Date(Date.UTC(year, month - 1, day));
  return probe.getUTCFullYear() === year && probe.getUTCMonth() === month - 1 && probe.getUTCDate() === day;
}

// The UTC offset (in ms) that `timeZone` observes at the instant `date`
// represents, computed by reading back the zone's wall-clock time for that
// instant. Positive east of UTC (e.g. Europe/Berlin is +3_600_000 in winter).
function timeZoneOffsetMs(date: Date, timeZone: string): number {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const parts = formatter.formatToParts(date);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? '0');
  // Real-world zone offsets are always a whole number of minutes, so the
  // millisecond-within-second of the wall clock always equals that of the
  // UTC instant. formatToParts() doesn't expose fractional seconds, so reuse
  // `date`'s own ms instead of dropping it (which previously truncated any
  // input with a non-zero ms, e.g. the 23:59:59.999 end-of-day boundary, to
  // .000 and threw the computed offset off by up to 999ms).
  const asUtc = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour'),
    get('minute'),
    get('second'),
    date.getUTCMilliseconds(),
  );
  return asUtc - date.getTime();
}

// Converts a local wall-clock time in `timeZone` to a UTC timestamp (ms).
// Correct across DST transitions for any wall time that isn't inside the
// spring-forward gap or fall-back ambiguous hour — which never happens here
// since callers only ever pass local midnight or local 23:59:59.999, both far
// from Europe/Berlin's 02:00/03:00 transition window.
export function zonedTimeToUtcMs(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
  ms: number,
  timeZone: string,
): number {
  const naiveUtc = Date.UTC(year, month - 1, day, hour, minute, second, ms);
  const offset = timeZoneOffsetMs(new Date(naiveUtc), timeZone);
  return naiveUtc - offset;
}

// starts_on's local calendar day begins at 00:00:00.000 local time.
export function startOfIsoDateUtcMs(isoDate: string, timeZone = EVENT_DATE_POLL_TIME_ZONE): number {
  const [year, month, day] = isoDate.split('-').map(Number);
  return zonedTimeToUtcMs(year, month, day, 0, 0, 0, 0, timeZone);
}

// The event period covers the full end day, so ends_on maps to the start of
// the NEXT calendar day (exclusive upper bound), matching how events.ends_at
// is used elsewhere (an exclusive end boundary).
export function startOfNextIsoDateUtcMs(isoDate: string, timeZone = EVENT_DATE_POLL_TIME_ZONE): number {
  const [year, month, day] = isoDate.split('-').map(Number);
  return zonedTimeToUtcMs(year, month, day + 1, 0, 0, 0, 0, timeZone);
}

// A date-only deadline ends at the last millisecond of that local day.
export function endOfIsoDateUtcMs(isoDate: string, timeZone = EVENT_DATE_POLL_TIME_ZONE): number {
  const [year, month, day] = isoDate.split('-').map(Number);
  return zonedTimeToUtcMs(year, month, day, 23, 59, 59, 999, timeZone);
}

// Compares two ISO calendar dates (YYYY-MM-DD) lexicographically, which is
// correct for zero-padded ISO dates without needing a Date object at all.
export function compareIsoDate(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

// The reverse of startOfIsoDateUtcMs/endOfIsoDateUtcMs: which local calendar
// date a UTC instant falls on in `timeZone`. Used to derive "the calendar day
// of the deadline" for the due-day reminder from a stored response_due_at
// (itself already local 23:59:59.999) without persisting the input date
// string separately.
export function isoDateInTimeZone(utcMs: number, timeZone = EVENT_DATE_POLL_TIME_ZONE): string {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return formatter.format(new Date(utcMs));
}
