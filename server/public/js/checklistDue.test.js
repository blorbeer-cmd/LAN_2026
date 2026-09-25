import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dueText, dueDiffDays } from './checklistDue.js';

const NOW = new Date(2026, 7, 12, 9, 0).getTime(); // 12 Aug 2026, 09:00

test('no due date renders no text', () => {
  assert.equal(dueText(null, NOW), '');
  assert.equal(dueText(undefined, NOW), '');
});

test('a past date is overdue', () => {
  assert.equal(dueText(new Date(2026, 7, 11).getTime(), NOW), 'Überfällig');
});

test('today is "Fällig heute", not overdue - comparison is day-granular, not exact-time', () => {
  assert.equal(dueText(new Date(2026, 7, 12, 23, 0).getTime(), NOW), 'Fällig heute');
});

test('tomorrow is "Fällig morgen"', () => {
  assert.equal(dueText(new Date(2026, 7, 13).getTime(), NOW), 'Fällig morgen');
});

test('2-3 days out is "Fällig in N Tagen"', () => {
  assert.equal(dueText(new Date(2026, 7, 14).getTime(), NOW), 'Fällig in 2 Tagen');
  assert.equal(dueText(new Date(2026, 7, 15).getTime(), NOW), 'Fällig in 3 Tagen');
});

test('further out names the date instead of a relative count', () => {
  assert.equal(dueText(new Date(2026, 7, 20).getTime(), NOW), 'Fällig am 20.08.');
});

test('dueDiffDays is exposed for the detail dialog and sorting', () => {
  assert.equal(dueDiffDays(new Date(2026, 7, 11).getTime(), NOW), -1);
  assert.equal(dueDiffDays(new Date(2026, 7, 12).getTime(), NOW), 0);
  assert.equal(dueDiffDays(new Date(2026, 7, 15).getTime(), NOW), 3);
});
