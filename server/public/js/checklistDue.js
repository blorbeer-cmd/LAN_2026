// Pure due-date presentation helpers for To-Dos (checklist_tasks.due_at,
// docs/KONZEPT-PACKLISTE-TICKETS.md). Day-granularity comparison against
// "now" - a due date has no meaningful time-of-day (see dateTimeField.js's
// dateOnly mode used to pick it). Kept DOM-free with an injectable `now` so
// it stays unit-testable without faking the system clock.

import { formatDate } from './format.js';

function startOfDay(ms) {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export function dueDiffDays(dueAtMs, nowMs = Date.now()) {
  return Math.round((startOfDay(dueAtMs) - startOfDay(nowMs)) / 86_400_000);
}

export function isOverdue(dueAtMs, nowMs = Date.now()) {
  if (!dueAtMs) return false;
  return dueDiffDays(dueAtMs, nowMs) < 0;
}

// null means "nothing to show" - the field is optional and most to-dos
// won't have one.
export function dueBadgeInfo(dueAtMs, nowMs = Date.now()) {
  if (!dueAtMs) return null;
  const diff = dueDiffDays(dueAtMs, nowMs);
  if (diff < 0) return { cls: 'badge-overdue', text: 'Überfällig' };
  if (diff === 0) return { cls: 'badge-due-soon', text: 'Heute fällig' };
  if (diff === 1) return { cls: 'badge-due-soon', text: 'Morgen fällig' };
  if (diff <= 3) return { cls: 'badge-due-soon', text: `Fällig in ${diff} Tagen` };
  return { cls: 'badge-neutral', text: `Fällig: ${formatDate(dueAtMs)}` };
}
