// Stable product vocabulary for event types and whole event areas. This
// module deliberately has no database dependency so migrations, API code and
// later frontend contracts can all consume the same keys and presets.

export const EVENT_FEATURE_KEYS = [
  'tasks',
  'packing',
  'travel',
  'food',
  'costs',
  'music',
  'games',
  'competition',
  'arcade',
  'seating',
  'tracking',
  'kiosk',
] as const;

export type EventFeatureKey = (typeof EVENT_FEATURE_KEYS)[number];

export interface EventFeatureDescriptor {
  key: EventFeatureKey;
  version: number;
  title: string;
  description: string;
  requiredFeatureKeys: readonly EventFeatureKey[];
}

export const EVENT_FEATURE_CATALOG: Readonly<Record<EventFeatureKey, EventFeatureDescriptor>> = {
  tasks: {
    key: 'tasks',
    version: 2,
    title: 'Aufgaben & Mitbringen',
    description: 'To-dos und Mitbring-Anfragen',
    requiredFeatureKeys: [],
  },
  // Split out of `tasks` so an event type can keep the shared to-do board
  // while dropping the personal packing list, which only makes sense for a
  // gathering someone actually travels to.
  packing: {
    key: 'packing',
    version: 1,
    title: 'Packliste',
    description: 'Persönliche Packliste je Person',
    requiredFeatureKeys: [],
  },
  travel: {
    key: 'travel',
    version: 1,
    title: 'An- & Abreise',
    description: 'Ankunft, Abfahrt und Fahrgemeinschaften',
    requiredFeatureKeys: [],
  },
  food: {
    key: 'food',
    version: 1,
    title: 'Essen',
    description: 'Sammelbestellungen und Zahlungsstatus je Bestellung',
    requiredFeatureKeys: [],
  },
  costs: {
    key: 'costs',
    version: 1,
    title: 'Kosten',
    description: 'Beiträge, Unterkunftskosten, Zahlungsziel und Abrechnung',
    requiredFeatureKeys: [],
  },
  music: {
    key: 'music',
    version: 1,
    title: 'Musik',
    description: 'Jam und gemeinsamer Wiedergabekontext',
    requiredFeatureKeys: [],
  },
  games: {
    key: 'games',
    version: 1,
    title: 'Spiele & Spiele-Vote',
    description: 'Spielekatalog, Bock, Skill und spielbezogene Abstimmungen',
    requiredFeatureKeys: [],
  },
  competition: {
    key: 'competition',
    version: 1,
    title: 'Match & Turniere',
    description: 'Teams, Draft, Matches und Turniere',
    requiredFeatureKeys: ['games'],
  },
  arcade: {
    key: 'arcade',
    version: 1,
    title: 'Arcade',
    description: 'Lobbys, Spiele und eventbezogene Ergebnisse',
    requiredFeatureKeys: [],
  },
  seating: {
    key: 'seating',
    version: 1,
    title: 'Sitz-/Tischplan',
    description: 'Tisch-, Raum-, Zimmer- oder Platzzuordnung',
    requiredFeatureKeys: [],
  },
  tracking: {
    key: 'tracking',
    version: 1,
    title: 'Tracking & Auswertung',
    description: 'Agent-Tracking, Live-Status, Spielzeit und Ranglisten',
    requiredFeatureKeys: [],
  },
  kiosk: {
    key: 'kiosk',
    version: 1,
    title: 'Kiosk',
    description: 'Read-only Eventanzeige für gemeinsam genutzte Bildschirme',
    requiredFeatureKeys: [],
  },
};

export const EVENT_TYPE_KEYS = ['lan', 'general', 'group'] as const;

export type EventTypeKey = (typeof EVENT_TYPE_KEYS)[number];

export interface EventTypePreset {
  key: EventTypeKey;
  version: number;
  title: string;
  description: string;
  recommendedFeatureKeys: readonly EventFeatureKey[];
  suggestedFeatureKeys: readonly EventFeatureKey[];
}

export const EVENT_TYPE_PRESETS: Readonly<Record<EventTypeKey, EventTypePreset>> = {
  lan: {
    key: 'lan',
    version: 2,
    title: 'LAN-Party',
    description: 'Der heutige vollständige Funktionsumfang ohne Einschränkungen',
    recommendedFeatureKeys: EVENT_FEATURE_KEYS,
    suggestedFeatureKeys: [],
  },
  general: {
    key: 'general',
    version: 4,
    title: 'Allgemeines Event',
    description: 'Feier, Reise, Ausflug, Spieleabend, Workshop oder anderes Treffen',
    recommendedFeatureKeys: ['tasks', 'packing', 'travel', 'food', 'costs', 'music', 'arcade'],
    suggestedFeatureKeys: [],
  },
  // A group is the one workspace kind that never ends: no period, no money,
  // no arrival planning and no packing list. What remains is what a circle
  // that meets again and again actually uses.
  group: {
    key: 'group',
    version: 2,
    title: 'Gruppe',
    description: 'Dauerhafter Kreis ohne Zeitraum und ohne Kosten, zum Beispiel eine feste Spielrunde',
    recommendedFeatureKeys: ['tasks', 'food', 'music', 'games', 'competition', 'arcade'],
    suggestedFeatureKeys: [],
  },
};

// A group has no period at all — it is permanently open instead of a draft
// waiting for a date. Everything that keys off "has this event a schedule?"
// asks here rather than testing the type key again.
export function eventTypeIsUndated(eventTypeKey: EventTypeKey): boolean {
  return eventTypeKey === 'group';
}

export const DEFAULT_EVENT_TYPE_KEY: EventTypeKey = 'lan';
export const DEFAULT_EVENT_PRESET_VERSION = EVENT_TYPE_PRESETS[DEFAULT_EVENT_TYPE_KEY].version;

export function isEventTypeKey(value: unknown): value is EventTypeKey {
  return typeof value === 'string' && (EVENT_TYPE_KEYS as readonly string[]).includes(value);
}

export function isEventFeatureKey(value: unknown): value is EventFeatureKey {
  return typeof value === 'string' && (EVENT_FEATURE_KEYS as readonly string[]).includes(value);
}
