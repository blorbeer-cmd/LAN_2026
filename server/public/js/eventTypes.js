const FALLBACK_EVENT_TYPE_OPTIONS = Object.freeze([
  Object.freeze({
    key: 'lan',
    title: 'LAN-Party',
    description: 'Vollständiger LAN-Funktionsumfang mit Spielen, Wettkampf, Arcade, Tracking und Kiosk.',
  }),
  Object.freeze({
    key: 'general',
    title: 'Allgemeines Event',
    description: 'Feier, Reise, Ausflug, Spieleabend, Workshop oder anderes Treffen.',
  }),
  Object.freeze({
    key: 'group',
    title: 'Gruppe',
    description: 'Dauerhafter Kreis ohne Zeitraum und ohne Kosten, zum Beispiel eine feste Spielrunde.',
  }),
]);

// A group has no period and no money attached. Every place that hides date or
// cost inputs, suppresses "Beenden" or splits the list asks this instead of
// comparing the type key again.
export function isGroupEventType(eventTypeKey) {
  return eventTypeKey === 'group';
}

export function eventIsGroup(event) {
  return Boolean(event) && !event.isBase && isGroupEventType(event.eventType);
}

export function availableEventTypeOptions(options = []) {
  return Array.isArray(options) && options.length > 0 ? options : FALLBACK_EVENT_TYPE_OPTIONS;
}

export function eventTypeTitle(eventTypeKey, options = []) {
  return availableEventTypeOptions(options).find((option) => option.key === eventTypeKey)?.title ?? 'Event';
}
