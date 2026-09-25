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

// Short, colour-free due text shared by the To-Do table and Home: the
// sentence carries the meaning, so no badge is needed. '' means no due date.
export function dueText(dueAtMs, nowMs = Date.now()) {
  if (!dueAtMs) return '';
  const diff = dueDiffDays(dueAtMs, nowMs);
  if (diff < 0) return 'Überfällig';
  if (diff === 0) return 'Fällig heute';
  if (diff === 1) return 'Fällig morgen';
  if (diff <= 3) return `Fällig in ${diff} Tagen`;
  return `Fällig am ${formatDate(dueAtMs)}`;
}
