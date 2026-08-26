// Event feature requirements live beside their routes in the view registry.
// Unknown and unrestricted routes remain available; an older server payload
// without enabledFeatures also preserves the historical all-LAN behavior.

import { VIEW_MANIFEST } from './viewManifest.js';

export const VIEW_EVENT_FEATURE = Object.freeze(Object.fromEntries(
  Object.entries(VIEW_MANIFEST)
    .filter(([, definition]) => definition.eventFeature)
    .map(([view, definition]) => [view, definition.eventFeature])
));

export function eventHasFeature(event, featureKey) {
  if (!event || !Array.isArray(event.enabledFeatures)) return true;
  return event.enabledFeatures.includes(featureKey);
}

export function viewIsEnabledForEvent(view, event) {
  const featureKey = VIEW_EVENT_FEATURE[view];
  return featureKey ? eventHasFeature(event, featureKey) : true;
}
