import { db } from './db';
import { EVENT_FEATURE_KEYS, EVENT_TYPE_PRESETS, type EventFeatureKey, type EventTypeKey } from './eventFeatureCatalog';

interface EventFeatureRow {
  feature_key: string;
}

export function getEnabledEventFeatures(eventId: string): EventFeatureKey[] {
  const enabled = new Set(
    (
      db
        .prepare('SELECT feature_key FROM event_features WHERE event_id = ? AND enabled = 1')
        .all(eventId) as EventFeatureRow[]
    ).map((row) => row.feature_key),
  );
  return EVENT_FEATURE_KEYS.filter((featureKey) => enabled.has(featureKey));
}

// New events receive a complete, immutable-at-creation snapshot of the preset.
// Mutation endpoints arrive together with server-side feature enforcement in a
// later package; until then createEvent intentionally always selects the LAN
// preset so existing behavior cannot change.
export function createEventFeatureSnapshot(
  eventId: string,
  eventTypeKey: EventTypeKey,
  changedBy: string | null,
  changedAt = Date.now(),
): void {
  const enabledFeatures = new Set(EVENT_TYPE_PRESETS[eventTypeKey].recommendedFeatureKeys);
  const insert = db.prepare(
    `INSERT INTO event_features (event_id, feature_key, enabled, changed_at, changed_by)
     VALUES (?, ?, ?, ?, ?)`,
  );
  for (const featureKey of EVENT_FEATURE_KEYS) {
    insert.run(eventId, featureKey, enabledFeatures.has(featureKey) ? 1 : 0, changedAt, changedBy);
  }
}
