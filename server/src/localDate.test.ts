import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isValidIsoDate,
  compareIsoDate,
  startOfIsoDateUtcMs,
  startOfNextIsoDateUtcMs,
  endOfIsoDateUtcMs,
  isoDateInTimeZone,
  zonedTimeToUtcMs,
} from './localDate';

test('isValidIsoDate accepts real calendar dates and rejects malformed/impossible ones', () => {
  assert.equal(isValidIsoDate('2026-09-10'), true);
  assert.equal(isValidIsoDate('2026-02-29'), false, '2026 is not a leap year');
  assert.equal(isValidIsoDate('2024-02-29'), true, '2024 is a leap year');
  assert.equal(isValidIsoDate('2026-13-01'), false);
  assert.equal(isValidIsoDate('2026-00-01'), false);
  assert.equal(isValidIsoDate('10.09.2026'), false);
  assert.equal(isValidIsoDate(''), false);
  assert.equal(isValidIsoDate(undefined), false);
  assert.equal(isValidIsoDate(null), false);
  assert.equal(isValidIsoDate(20_260_910), false);
});

test('compareIsoDate orders ISO dates lexicographically like calendar order', () => {
  assert.ok(compareIsoDate('2026-01-01', '2026-01-02') < 0);
  assert.ok(compareIsoDate('2026-02-01', '2026-01-31') > 0);
  assert.equal(compareIsoDate('2026-05-05', '2026-05-05'), 0);
});

test('startOfIsoDateUtcMs is midnight Europe/Berlin, converted to the correct UTC offset', () => {
  // Winter (CET, UTC+1): 2026-01-15 00:00 local = 2026-01-14 23:00 UTC.
  assert.equal(startOfIsoDateUtcMs('2026-01-15'), Date.UTC(2026, 0, 14, 23, 0, 0, 0));
  // Summer (CEST, UTC+2): 2026-07-15 00:00 local = 2026-07-14 22:00 UTC.
  assert.equal(startOfIsoDateUtcMs('2026-07-15'), Date.UTC(2026, 6, 14, 22, 0, 0, 0));
});

test('endOfIsoDateUtcMs is 23:59:59.999 Europe/Berlin, converted correctly', () => {
  // Winter: 2026-01-15 23:59:59.999 local = 2026-01-15 22:59:59.999 UTC.
  assert.equal(endOfIsoDateUtcMs('2026-01-15'), Date.UTC(2026, 0, 15, 22, 59, 59, 999));
  // Summer: 2026-07-15 23:59:59.999 local = 2026-07-15 21:59:59.999 UTC.
  assert.equal(endOfIsoDateUtcMs('2026-07-15'), Date.UTC(2026, 6, 15, 21, 59, 59, 999));
});

test('startOfNextIsoDateUtcMs is the exclusive end boundary: midnight of the day AFTER ends_on', () => {
  assert.equal(startOfNextIsoDateUtcMs('2026-01-15'), startOfIsoDateUtcMs('2026-01-16'));
  assert.equal(startOfNextIsoDateUtcMs('2026-01-31'), startOfIsoDateUtcMs('2026-02-01'), 'rolls over the month boundary');
  assert.equal(startOfNextIsoDateUtcMs('2026-12-31'), startOfIsoDateUtcMs('2027-01-01'), 'rolls over the year boundary');
});

// 2026's German DST transitions: spring-forward Sun 2026-03-29 (02:00 CET ->
// 03:00 CEST) and fall-back Sun 2026-10-25 (03:00 CEST -> 02:00 CET). A date
// poll option's boundaries are always local midnight or 23:59:59.999 — both
// far from the 02:00-03:00 transition window — so conversions immediately
// before/on/after the transition day must land exactly one hour apart from
// what a naive fixed-offset conversion would give.
test('conversions stay exact across the spring-forward transition (2026-03-29)', () => {
  // The day before: still CET (UTC+1).
  assert.equal(startOfIsoDateUtcMs('2026-03-28'), Date.UTC(2026, 2, 27, 23, 0, 0, 0));
  // Transition day itself: local midnight still happens before the 02:00
  // jump, so it's still the CET offset (+1) for the *start* of this day...
  assert.equal(startOfIsoDateUtcMs('2026-03-29'), Date.UTC(2026, 2, 28, 23, 0, 0, 0));
  // ...but 23:59:59.999 on the transition day is already CEST (+2), since
  // the clocks jumped forward at 02:00 that same morning.
  assert.equal(endOfIsoDateUtcMs('2026-03-29'), Date.UTC(2026, 2, 29, 21, 59, 59, 999));
  // The day after: fully CEST (UTC+2).
  assert.equal(startOfIsoDateUtcMs('2026-03-30'), Date.UTC(2026, 2, 29, 22, 0, 0, 0));
  // A poll option spanning the transition weekend covers the exact expected
  // 47-hour span (one hour shorter than two normal days), not a naive 48h.
  const spanMs = startOfNextIsoDateUtcMs('2026-03-29') - startOfIsoDateUtcMs('2026-03-29');
  assert.equal(spanMs, 23 * 60 * 60 * 1000);
});

test('conversions stay exact across the fall-back transition (2026-10-25)', () => {
  // The day before: still CEST (UTC+2).
  assert.equal(startOfIsoDateUtcMs('2026-10-24'), Date.UTC(2026, 9, 23, 22, 0, 0, 0));
  // Transition day: local midnight is still CEST (+2)...
  assert.equal(startOfIsoDateUtcMs('2026-10-25'), Date.UTC(2026, 9, 24, 22, 0, 0, 0));
  // ...but 23:59:59.999 that day is already back on CET (+1), since the
  // clocks fell back at 03:00 that morning.
  assert.equal(endOfIsoDateUtcMs('2026-10-25'), Date.UTC(2026, 9, 25, 22, 59, 59, 999));
  // The day after: fully CET (UTC+1) again.
  assert.equal(startOfIsoDateUtcMs('2026-10-26'), Date.UTC(2026, 9, 25, 23, 0, 0, 0));
  // This particular day is 25 hours long in real elapsed time.
  const spanMs = startOfNextIsoDateUtcMs('2026-10-25') - startOfIsoDateUtcMs('2026-10-25');
  assert.equal(spanMs, 25 * 60 * 60 * 1000);
});

test('isoDateInTimeZone round-trips a stored response_due_at back to its local calendar day, even across the DST boundary', () => {
  assert.equal(isoDateInTimeZone(endOfIsoDateUtcMs('2026-03-29')), '2026-03-29');
  assert.equal(isoDateInTimeZone(endOfIsoDateUtcMs('2026-10-25')), '2026-10-25');
  assert.equal(isoDateInTimeZone(startOfIsoDateUtcMs('2026-07-04')), '2026-07-04');
});

test('zonedTimeToUtcMs matches the day-boundary helpers for the same instant', () => {
  assert.equal(zonedTimeToUtcMs(2026, 3, 29, 0, 0, 0, 0, 'Europe/Berlin'), startOfIsoDateUtcMs('2026-03-29'));
  assert.equal(zonedTimeToUtcMs(2026, 3, 29, 23, 59, 59, 999, 'Europe/Berlin'), endOfIsoDateUtcMs('2026-03-29'));
});
