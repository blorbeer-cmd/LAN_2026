import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dueBadgeInfo, isOverdue, dueDiffDays } from './checklistDue.js';

const NOW = new Date(2026, 7, 12, 9, 0).getTime(); // 12 Aug 2026, 09:00

test('no due date renders no badge and is never overdue', () => {
  assert.equal(dueBadgeInfo(null, NOW), null);
  assert.equal(dueBadgeInfo(undefined, NOW), null);
  assert.equal(isOverdue(null, NOW), false);
});

test('a past date is overdue', () => {
  const dueAt = new Date(2026, 7, 11).getTime();
  assert.equal(isOverdue(dueAt, NOW), true);
  assert.deepEqual(dueBadgeInfo(dueAt, NOW), { cls: 'badge-overdue', text: 'Überfällig' });
});

test('today is "Heute fällig", not overdue - comparison is day-granular, not exact-time', () => {
  const laterToday = new Date(2026, 7, 12, 23, 0).getTime();
  assert.equal(isOverdue(laterToday, NOW), false);
  assert.deepEqual(dueBadgeInfo(laterToday, NOW), { cls: 'badge-due-soon', text: 'Heute fällig' });
});

test('tomorrow is "Morgen fällig"', () => {
  const dueAt = new Date(2026, 7, 13).getTime();
  assert.deepEqual(dueBadgeInfo(dueAt, NOW), { cls: 'badge-due-soon', text: 'Morgen fällig' });
});

test('2-3 days out is "Fällig in N Tagen"', () => {
  assert.deepEqual(dueBadgeInfo(new Date(2026, 7, 14).getTime(), NOW), { cls: 'badge-due-soon', text: 'Fällig in 2 Tagen' });
  assert.deepEqual(dueBadgeInfo(new Date(2026, 7, 15).getTime(), NOW), { cls: 'badge-due-soon', text: 'Fällig in 3 Tagen' });
});

test('further out renders a neutral plain date instead of a relative count', () => {
  const dueAt = new Date(2026, 7, 20).getTime();
  assert.deepEqual(dueBadgeInfo(dueAt, NOW), { cls: 'badge-neutral', text: 'Fällig: 20.08.' });
});

test('dueDiffDays is exposed for sorting "Mir zugewiesen" by urgency', () => {
  assert.equal(dueDiffDays(new Date(2026, 7, 11).getTime(), NOW), -1);
  assert.equal(dueDiffDays(new Date(2026, 7, 12).getTime(), NOW), 0);
  assert.equal(dueDiffDays(new Date(2026, 7, 15).getTime(), NOW), 3);
});
