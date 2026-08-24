import { db } from './db';
import { EVENT_FEATURE_KEYS, EVENT_TYPE_PRESETS, type EventFeatureKey, type EventTypeKey } from './eventFeatureCatalog';
import type { RequestHandler } from 'express';
import { getOrRepairActiveEvent } from './eventContext';

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

export function isEventFeatureEnabled(eventId: string, featureKey: EventFeatureKey): boolean {
  const feature = db
    .prepare('SELECT enabled FROM event_features WHERE event_id = ? AND feature_key = ?')
    .get(eventId, featureKey) as { enabled: number } | undefined;
  if (feature) return feature.enabled === 1;

  // Directly inserted legacy/test events can predate the snapshot invariant.
  // Keep them compatible; a real snapshot always contains every feature row.
  const snapshot = db
    .prepare('SELECT 1 FROM event_features WHERE event_id = ? LIMIT 1')
    .get(eventId);
  return !snapshot;
}

// Reads stay compatible with the central app snapshot loader in this MVP,
// but disabled areas may not create or change domain state. The UI also
// removes their routes and redirects stale deep links to Home.
export function requireActiveEventFeatureMutation(featureKey: EventFeatureKey): RequestHandler {
  return (req, res, next) => {
    if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return next();
    const eventId = req.kioskScope?.eventId ?? (req.player ? getOrRepairActiveEvent(req.player.id).id : null);
    if (!eventId || !isEventFeatureEnabled(eventId, featureKey)) {
      return res.status(404).json({ error: 'Dieser Bereich ist für das aktive Event nicht aktiviert.' });
    }
    return next();
  };
}

// New events receive a complete snapshot of the selected preset. Every known
// feature gets its own row, including disabled ones, so later reactivation can
// preserve domain data without inventing a partial configuration.
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
