import { nanoid } from 'nanoid';
import { db, BASE_EVENT_ID, DEFAULT_GROUP_ID, OUTSIDE_EVENTS_ID } from './db';
import { ACCEPTED_EVENT_PARTICIPANT_SQL } from './eventParticipation';
import {
  TRACKING_CONSENT_PURPOSE,
  TRACKING_CONSENT_TEXT_VERSION,
  type ConsentMetadata,
} from './privacyPolicy';

export interface TrackingContext {
  groupId: string;
  eventId: string;
  weight: number;
}

// Resolve the single trackable context selected by this account. Parallel
// events are supported, but one account report belongs to one active event.
// A group carries no period on purpose (eventTypeIsUndated): it is permanently
// open rather than undated by accident, so a NULL start counts as "running"
// here. Only a group can reach this with tracking enabled — events.ts refuses
// the flag for the base workspace and for general events.
export function activeTrackingContexts(playerId: string, now = Date.now()): TrackingContext[] {
  const active = db
    .prepare(
      `SELECT e.id AS eventId, e.group_id AS groupId
       FROM player_event_contexts pec
       JOIN events e ON e.id = pec.active_event_id
       JOIN event_participants ep
         ON ep.event_id = e.id AND ep.player_id = pec.player_id AND ${ACCEPTED_EVENT_PARTICIPANT_SQL}
       JOIN group_memberships gm
         ON gm.group_id = e.group_id AND gm.player_id = pec.player_id AND gm.status = 'active'
       JOIN groups g ON g.id = gm.group_id AND g.archived_at IS NULL
       JOIN event_tracking_consents c
         ON c.event_id = e.id AND c.player_id = pec.player_id AND c.revoked_at IS NULL
        AND c.purpose = ? AND c.text_version = ?
       WHERE pec.player_id = ? AND e.tracking_enabled = 1 AND e.status = 'published'
         AND e.id != ? AND e.event_type_key != 'general'
         AND (e.starts_at IS NULL OR e.starts_at <= ?) AND (e.ends_at IS NULL OR e.ends_at > ?)
       LIMIT 1`,
    )
    .get(TRACKING_CONSENT_PURPOSE, TRACKING_CONSENT_TEXT_VERSION, playerId, BASE_EVENT_ID, now, now) as
    | { eventId: string; groupId: string }
    | undefined;
  return active ? [{ groupId: active.groupId, eventId: active.eventId, weight: 1 }] : [];
}

export function setGroupTrackingConsent(
  groupId: string,
  playerId: string,
  granted: boolean,
  metadata?: ConsentMetadata,
  now = Date.now(),
): void {
  db.transaction(() => {
    const current = db.prepare(
      'SELECT id, purpose, text_version FROM group_tracking_consents WHERE group_id = ? AND player_id = ? AND revoked_at IS NULL ORDER BY granted_at DESC',
    ).all(groupId, playerId) as Array<{ id: string; purpose: string | null; text_version: string | null }>;
    if (granted && !metadata) throw new Error('Consent metadata is required for a new grant.');
    const matching = granted
      ? current.find((row) => row.purpose === metadata!.purpose && row.text_version === metadata!.textVersion)
      : undefined;
    if (granted) {
      const revoke = db.prepare(
        'UPDATE group_tracking_consents SET revoked_at = CASE WHEN granted_at > ? THEN granted_at ELSE ? END WHERE id = ?',
      );
      for (const row of current) if (row.id !== matching?.id) revoke.run(now, now, row.id);
    }
    if (granted && !matching) {
      db.prepare(
        'INSERT INTO group_tracking_consents (id, group_id, player_id, granted_at, source, purpose, text_version) VALUES (?, ?, ?, ?, ?, ?, ?)',
      ).run(nanoid(), groupId, playerId, now, 'user', metadata!.purpose, metadata!.textVersion);
    }
    if (!granted) {
      db.prepare(
        `UPDATE group_tracking_consents
         SET revoked_at = CASE WHEN granted_at > ? THEN granted_at ELSE ? END
         WHERE group_id = ? AND player_id = ? AND revoked_at IS NULL`,
      ).run(now, now, groupId, playerId);
      closeTrackingContextRows(playerId, groupId, null, now);
    }
  })();
}

export function setEventTrackingConsent(
  eventId: string,
  groupId: string,
  playerId: string,
  accepted: boolean,
  metadata?: ConsentMetadata,
  now = Date.now(),
): void {
  db.transaction(() => {
    const current = db.prepare(
      'SELECT id, purpose, text_version FROM event_tracking_consents WHERE event_id = ? AND player_id = ? AND revoked_at IS NULL ORDER BY accepted_at DESC',
    ).all(eventId, playerId) as Array<{ id: string; purpose: string | null; text_version: string | null }>;
    if (accepted && !metadata) throw new Error('Consent metadata is required for a new grant.');
    const matching = accepted
      ? current.find((row) => row.purpose === metadata!.purpose && row.text_version === metadata!.textVersion)
      : undefined;
    if (accepted) {
      const revoke = db.prepare(
        'UPDATE event_tracking_consents SET revoked_at = CASE WHEN accepted_at > ? THEN accepted_at ELSE ? END WHERE id = ?',
      );
      for (const row of current) if (row.id !== matching?.id) revoke.run(now, now, row.id);
    }
    if (accepted && !matching) {
      const latest = db.prepare(
        'SELECT MAX(accepted_at) AS accepted_at FROM event_tracking_consents WHERE event_id = ? AND player_id = ?',
      ).get(eventId, playerId) as { accepted_at: number | null };
      const acceptedAt = latest.accepted_at === null ? now : Math.max(now, latest.accepted_at + 1);
      db.prepare(
        'INSERT INTO event_tracking_consents (id, event_id, group_id, player_id, accepted_at, source, purpose, text_version) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      ).run(nanoid(), eventId, groupId, playerId, acceptedAt, 'user', metadata!.purpose, metadata!.textVersion);
    }
    if (!accepted) {
      db.prepare(
        `UPDATE event_tracking_consents
         SET revoked_at = CASE WHEN accepted_at > ? THEN accepted_at ELSE ? END
         WHERE event_id = ? AND player_id = ? AND revoked_at IS NULL`,
      ).run(now, now, eventId, playerId);
      closeTrackingContextRows(playerId, groupId, eventId, now);
      clearDiagnosticProcessNamesWithoutContext(playerId, now);
    }
  })();
}

// The account's own standing pre-authorization for events that only become
// trackable later. It stores the text version it was agreed under, so a
// changed wording stops it from applying and asks again — the same guarantee
// the per-event checkbox gives. Revoking a single event stays possible and is
// never overridden by this default, because it only ever fills a gap where no
// consent row exists at all.
export function getTrackingConsentDefaultVersion(playerId: string): string | null {
  const row = db
    .prepare('SELECT tracking_consent_default_version AS version FROM players WHERE id = ?')
    .get(playerId) as { version: string | null } | undefined;
  return row?.version ?? null;
}

export function setTrackingConsentDefault(playerId: string, textVersion: string | null): void {
  db.prepare('UPDATE players SET tracking_consent_default_version = ? WHERE id = ?').run(textVersion, playerId);
}

function trackingConsentDefaultApplies(playerId: string): boolean {
  return getTrackingConsentDefaultVersion(playerId) === TRACKING_CONSENT_TEXT_VERSION;
}

/**
 * Grants the current-version consent for one account and event when that
 * account asked for it in advance and has not decided about this event yet.
 * Returns whether a consent was created, so callers can report it.
 */
export function applyTrackingConsentDefault(
  eventId: string,
  groupId: string,
  playerId: string,
  now = Date.now(),
): boolean {
  const event = db.prepare('SELECT event_type_key AS eventType FROM events WHERE id = ?').get(eventId) as
    | { eventType: string }
    | undefined;
  if (!event || eventId === BASE_EVENT_ID || event.eventType === 'general') return false;
  if (!trackingConsentDefaultApplies(playerId)) return false;
  // An explicit decision always wins: a revoked row means the account said no
  // for this event, and re-granting it here would silently reverse that.
  const decided = db
    .prepare('SELECT 1 FROM event_tracking_consents WHERE event_id = ? AND player_id = ? LIMIT 1')
    .get(eventId, playerId);
  if (decided) return false;
  setEventTrackingConsent(
    eventId,
    groupId,
    playerId,
    true,
    { purpose: TRACKING_CONSENT_PURPOSE, textVersion: TRACKING_CONSENT_TEXT_VERSION },
    now,
  );
  return true;
}

/** Applies the standing default for every accepted participant of one event. */
export function applyTrackingConsentDefaultForEvent(eventId: string, now = Date.now()): number {
  const event = db.prepare('SELECT group_id AS groupId FROM events WHERE id = ?').get(eventId) as
    | { groupId: string | null }
    | undefined;
  if (!event?.groupId) return 0;
  const participants = db
    .prepare(
      `SELECT ep.player_id AS playerId
       FROM event_participants ep
       JOIN players p ON p.id = ep.player_id AND p.deactivated_at IS NULL
       WHERE ep.event_id = ? AND ${ACCEPTED_EVENT_PARTICIPANT_SQL}`,
    )
    .all(eventId) as Array<{ playerId: string }>;
  let granted = 0;
  for (const participant of participants) {
    if (applyTrackingConsentDefault(eventId, event.groupId, participant.playerId, now)) granted += 1;
  }
  return granted;
}

// A revoked consent must not leave the last detected game names sitting in
// agent_diagnostics: the agent may never report again (event over, agent
// uninstalled), the retention sweep is opt-in and off by default, and the
// personal export deliberately hides the row — so it would be stored without
// ever being disclosed. Only clear once no other event still carries a valid
// context, otherwise a parallel event's current snapshot would be lost.
function clearDiagnosticProcessNamesWithoutContext(playerId: string, now: number): void {
  if (activeTrackingContexts(playerId, now).length > 0) return;
  db.prepare("UPDATE agent_diagnostics SET process_names = '[]' WHERE player_id = ? AND process_names != '[]'").run(
    playerId,
  );
}

function closeTrackingContextRows(
  playerId: string,
  groupId: string,
  eventId: string | null,
  endedAt: number,
): void {
  db.prepare(
    'UPDATE play_sessions SET ended_at = ? WHERE player_id = ? AND group_id = ? AND event_id = ? AND ended_at IS NULL',
  ).run(endedAt, playerId, groupId, eventId ?? OUTSIDE_EVENTS_ID);
  db.prepare('DELETE FROM tracking_live_games WHERE player_id = ? AND group_id = ? AND event_id IS ?').run(
    playerId,
    groupId,
    eventId,
  );
  db.prepare('DELETE FROM tracking_live_contexts WHERE player_id = ? AND group_id = ? AND event_id IS ?').run(
    playerId,
    groupId,
    eventId,
  );
}

export function closeTrackingContext(playerId: string, groupId: string, eventId: string | null, endedAt: number): void {
  db.transaction(() => {
    closeTrackingContextRows(playerId, groupId, eventId, endedAt);
  })();
}

export function closeEventContexts(eventId: string, endedAt = Date.now()): void {
  db.transaction(() => {
    db.prepare('UPDATE play_sessions SET ended_at = ? WHERE event_id = ? AND ended_at IS NULL').run(endedAt, eventId);
    db.prepare('DELETE FROM tracking_live_games WHERE event_id = ?').run(eventId);
    db.prepare('DELETE FROM tracking_live_contexts WHERE event_id = ?').run(eventId);
  })();
}

export function allTrackedContextsForGroup(groupId: string): Array<{ player_id: string; event_id: string | null; last_seen: number; manual_note: string | null; activity_tracked: number }> {
  return db.prepare('SELECT player_id, event_id, last_seen, manual_note, activity_tracked FROM tracking_live_contexts WHERE group_id = ?').all(groupId) as Array<{player_id:string;event_id:string|null;last_seen:number;manual_note:string|null;activity_tracked:number}>;
}

export { DEFAULT_GROUP_ID, OUTSIDE_EVENTS_ID };
