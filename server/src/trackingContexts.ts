import { nanoid } from 'nanoid';
import { db, DEFAULT_GROUP_ID, OUTSIDE_EVENTS_ID } from './db';
import { config } from './config';
import { ACCEPTED_EVENT_PARTICIPANT_SQL } from './eventParticipation';

export interface TrackingContext { groupId: string; eventId: string | null; weight: number; }

// Resolve the complete fan-out set.  A group room is used only when no
// accepted event is currently in its window; overlapping accepted events share
// the report's time proportionally, so analytics never double-count a tick.
export function activeTrackingContexts(playerId: string, now = Date.now()): TrackingContext[] {
  const groups = db.prepare(
    `SELECT gm.group_id, gm.outside_tracking_enabled FROM group_memberships gm
     JOIN groups g ON g.id = gm.group_id
     WHERE gm.player_id = ? AND gm.status = 'active' AND g.archived_at IS NULL`,
  ).all(playerId) as Array<{ group_id: string; outside_tracking_enabled: number }>;
  if (!groups.length && config.authMode === 'legacy' && !(db.prepare('SELECT 1 FROM group_memberships WHERE player_id = ? LIMIT 1').get(playerId))) {
    groups.push({ group_id: DEFAULT_GROUP_ID, outside_tracking_enabled: 1 });
  }
  const result: TrackingContext[] = [];
  for (const { group_id: groupId, outside_tracking_enabled: outsideTrackingEnabled } of groups) {
    const hasGroupConsent = Boolean(
      db.prepare(
        `SELECT 1 FROM group_tracking_consents
         WHERE group_id = ? AND player_id = ? AND revoked_at IS NULL
         LIMIT 1`,
      ).get(groupId, playerId),
    ) || (config.authMode === 'legacy' && Boolean(outsideTrackingEnabled));
    const events = db.prepare(
      `SELECT e.id, e.visibility_scope FROM events e
       WHERE e.group_id = ? AND e.tracking_enabled = 1 AND e.status = 'published'
         AND (
           (? = 1 AND e.visibility_scope IN ('group', 'public'))
           OR (
             e.visibility_scope = 'participants'
             AND EXISTS (
               SELECT 1 FROM event_participants ep
               WHERE ep.event_id = e.id AND ep.player_id = ? AND ${ACCEPTED_EVENT_PARTICIPANT_SQL}
             )
             AND (
               EXISTS (
                 SELECT 1 FROM event_tracking_consents c
                 WHERE c.event_id = e.id AND c.player_id = ? AND c.revoked_at IS NULL
               )
               OR ? = 'legacy'
             )
           )
         )
         AND e.starts_at <= ? AND (e.ends_at IS NULL OR e.ends_at > ?)
       ORDER BY e.id`,
    ).all(groupId, hasGroupConsent ? 1 : 0, playerId, playerId, config.authMode, now, now) as Array<{ id: string; visibility_scope: string }>;
    const activeEventCount = (db.prepare("SELECT COUNT(*) AS count FROM events WHERE group_id = ? AND tracking_enabled = 1 AND status = 'published' AND starts_at <= ? AND (ends_at IS NULL OR ends_at > ?)").get(groupId, now, now) as { count: number }).count;
    if (events.length) {
      const weight = 1 / events.length;
      for (const event of events) result.push({ groupId, eventId: event.id, weight });
    } else if (activeEventCount === 0 && hasGroupConsent) {
      result.push({ groupId, eventId: null, weight: 1 });
    }
  }
  return result;
}

export function setGroupTrackingConsent(groupId: string, playerId: string, granted: boolean, now = Date.now()): void {
  db.transaction(() => {
    const current = db.prepare(
      'SELECT 1 FROM group_tracking_consents WHERE group_id = ? AND player_id = ? AND revoked_at IS NULL LIMIT 1',
    ).get(groupId, playerId);
    if (granted && !current) {
      db.prepare(
        'INSERT INTO group_tracking_consents (id, group_id, player_id, granted_at, source) VALUES (?, ?, ?, ?, ?)',
      ).run(nanoid(), groupId, playerId, now, 'user');
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

export function setEventTrackingConsent(eventId: string, groupId: string, playerId: string, accepted: boolean, now = Date.now()): void {
  db.transaction(() => {
    const current = db.prepare(
      'SELECT 1 FROM event_tracking_consents WHERE event_id = ? AND player_id = ? AND revoked_at IS NULL LIMIT 1',
    ).get(eventId, playerId);
    if (accepted && !current) {
      const latest = db.prepare(
        'SELECT MAX(accepted_at) AS accepted_at FROM event_tracking_consents WHERE event_id = ? AND player_id = ?',
      ).get(eventId, playerId) as { accepted_at: number | null };
      const acceptedAt = latest.accepted_at === null ? now : Math.max(now, latest.accepted_at + 1);
      db.prepare(
        'INSERT INTO event_tracking_consents (id, event_id, group_id, player_id, accepted_at, source) VALUES (?, ?, ?, ?, ?, ?)',
      ).run(nanoid(), eventId, groupId, playerId, acceptedAt, 'user');
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
