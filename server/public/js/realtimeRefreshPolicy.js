// Realtime redraw dependencies are declared per view in viewManifest.js.
// This projection keeps the policy data-only and backwards-compatible for
// callers/tests that inspect the event-to-view map.

import { VIEW_MANIFEST } from './viewManifest.js';

const dependencies = {};
for (const [view, definition] of Object.entries(VIEW_MANIFEST)) {
  for (const eventName of definition.lifecycle.refreshOn) {
    (dependencies[eventName] ??= []).push(view);
  }
}

export const CORE_REALTIME_VIEW_DEPENDENCIES = Object.freeze(Object.fromEntries(
  Object.entries(dependencies).map(([eventName, views]) => [eventName, Object.freeze(views)])
));

export function realtimeEventAffectsView(eventName, view) {
  return VIEW_MANIFEST[view]?.lifecycle.refreshOn.includes(eventName) ?? false;
}
