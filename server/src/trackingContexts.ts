import { nanoid } from 'nanoid';
import { db, DEFAULT_GROUP_ID, OUTSIDE_EVENTS_ID } from './db';
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
         AND e.starts_at <= ? AND (e.ends_at IS NULL OR e.ends_at > ?)
       LIMIT 1`,
    )
    .get(TRACKING_CONSENT_PURPOSE, TRACKING_CONSENT_TEXT_VERSION, playerId, now, now) as
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
    }
  })();
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
