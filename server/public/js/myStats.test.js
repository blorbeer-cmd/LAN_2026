// "Meine Statistiken": the session period line. The date appears once when a
// session stays on one day, and UI copy joins the range with "bis".

import test from 'node:test';
import assert from 'node:assert/strict';
import { sessionSpanText } from './views/myStats.js';

test('a session on one day names its date once', () => {
  const start = new Date(2026, 6, 29, 4, 10).getTime();
  const end = new Date(2026, 6, 29, 10, 21).getTime();
  assert.equal(sessionSpanText(start, end), '29.07., 04:10 bis 10:21');
});

test('a session across midnight names both dates', () => {
  const start = new Date(2026, 3, 30, 19, 34).getTime();
  const end = new Date(2026, 4, 1, 1, 57).getTime();
  assert.equal(sessionSpanText(start, end), '30.04., 19:34 bis 01.05., 01:57');
});

test('a running session ends "bis jetzt"', () => {
  assert.equal(sessionSpanText(new Date(2026, 6, 29, 4, 10).getTime(), null), '29.07., 04:10 bis jetzt');
});
