// One vocabulary for "what state is this event in", shared by the workspace
// switcher in the topbar and the event cards in event management. The two
// used to describe the same three states independently, which is how a
// switcher can end up calling an event "aktiv" while its card says "Beendet".
//
// The states come straight from the event payload
// (serializeEventSummary in src/routes/events.ts): a permanently open base
// workspace, an ended event, the one event currently tracking playtime, and
// everything else — created but not tracking.

import { icon } from './icons.js';

export const EVENT_STATUS = Object.freeze({
  base: { key: 'base', label: 'Allgemein', icon: 'globe', badge: 'badge-online' },
  ended: { key: 'ended', label: 'Beendet', icon: 'circleCheck', badge: 'badge-offline' },
  tracking: { key: 'tracking', label: 'Trackt gerade', icon: 'radioTower', badge: 'badge-playing' },
  idle: { key: 'idle', label: 'Nicht aktiv', icon: 'pause', badge: 'badge-paused' },
});

// Order matters: an ended event never counts as tracking, and the permanent
// base workspace has no lifecycle of its own to report.
export function eventStatus(event) {
  if (!event) return EVENT_STATUS.idle;
  if (event.isBase) return EVENT_STATUS.base;
  if (event.isEnded) return EVENT_STATUS.ended;
  if (event.trackingEnabled) return EVENT_STATUS.tracking;
  return EVENT_STATUS.idle;
}

// The badge used on event cards. The label carries the meaning; the colour
// only reinforces it.
export function eventStatusBadgeHtml(event) {
  const status = eventStatus(event);
  return `<span class="badge ${status.badge}">${icon(status.icon)} ${status.label}</span>`;
}

// "Allgemein" is the permanent base workspace's visible name everywhere; its
// stored name is an internal detail nobody should see in the UI.
export function eventDisplayName(event) {
  if (!event) return '';
  return event.isBase ? 'Allgemein' : event.name;
}

// The workspace switcher's option text. The state is spelled out next to the
// name so the dropdown answers "läuft das gerade?" without opening a card —
// and so the status icon beside the field never carries the meaning alone.
// The base workspace is exempt: repeating "Allgemein · Allgemein" is noise.
export function eventSwitcherLabel(event) {
  const name = eventDisplayName(event);
  const status = eventStatus(event);
  return status.key === 'base' ? name : `${name} · ${status.label}`;
}
