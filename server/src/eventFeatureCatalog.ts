// Stable product vocabulary for event types and whole event areas. This
// module deliberately has no database dependency so migrations, API code and
// later frontend contracts can all consume the same keys and presets.

export const EVENT_FEATURE_KEYS = [
  'tasks',
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
    version: 1,
    title: 'Aufgaben & Mitbringen',
    description: 'To-dos, Mitbring-Anfragen und persönliche Packliste',
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

export const EVENT_TYPE_KEYS = ['lan', 'celebration', 'game-night', 'trip', 'workshop', 'custom'] as const;

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
    version: 1,
    title: 'LAN-Party',
    description: 'Der heutige vollständige Funktionsumfang ohne Einschränkungen',
    recommendedFeatureKeys: EVENT_FEATURE_KEYS,
    suggestedFeatureKeys: [],
  },
  celebration: {
    key: 'celebration',
    version: 1,
    title: 'Gartenparty & Feier',
    description: 'Geburtstag, Grillabend, Gartenparty oder private Feier',
    recommendedFeatureKeys: ['tasks', 'food', 'costs', 'music'],
    suggestedFeatureKeys: ['travel', 'seating'],
  },
  'game-night': {
    key: 'game-night',
    version: 1,
    title: 'Spieleabend',
    description: 'Brettspiel-, Konsolen- oder kleiner PC-Spieleabend',
    recommendedFeatureKeys: ['food', 'music', 'games'],
    suggestedFeatureKeys: ['tasks', 'costs', 'competition', 'arcade'],
  },
  trip: {
    key: 'trip',
    version: 1,
    title: 'Reise & Ausflug',
    description: 'Gruppenreise, gemeinsames Wochenende, Hütte oder Tagesausflug',
    recommendedFeatureKeys: ['tasks', 'travel', 'food', 'costs'],
    suggestedFeatureKeys: ['music', 'games', 'seating'],
  },
  workshop: {
    key: 'workshop',
    version: 1,
    title: 'Workshop & Treffen',
    description: 'Workshop, Vereinstreffen, Planungstag oder Community-Termin',
    recommendedFeatureKeys: ['tasks'],
    suggestedFeatureKeys: ['travel', 'food', 'costs', 'seating', 'kiosk'],
  },
  custom: {
    key: 'custom',
    version: 1,
    title: 'Benutzerdefiniert',
    description: 'Minimale Ausgangsbasis ohne optionale Eventbereiche',
    recommendedFeatureKeys: [],
    suggestedFeatureKeys: [],
  },
};

export const DEFAULT_EVENT_TYPE_KEY: EventTypeKey = 'lan';
export const DEFAULT_EVENT_PRESET_VERSION = EVENT_TYPE_PRESETS[DEFAULT_EVENT_TYPE_KEY].version;

export function isEventTypeKey(value: unknown): value is EventTypeKey {
  return typeof value === 'string' && (EVENT_TYPE_KEYS as readonly string[]).includes(value);
}

export function isEventFeatureKey(value: unknown): value is EventFeatureKey {
  return typeof value === 'string' && (EVENT_FEATURE_KEYS as readonly string[]).includes(value);
}
