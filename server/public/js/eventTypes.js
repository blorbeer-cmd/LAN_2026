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
]);

export function availableEventTypeOptions(options = []) {
  return Array.isArray(options) && options.length > 0 ? options : FALLBACK_EVENT_TYPE_OPTIONS;
}

export function eventTypeTitle(eventTypeKey, options = []) {
  return availableEventTypeOptions(options).find((option) => option.key === eventTypeKey)?.title ?? 'Event';
}
