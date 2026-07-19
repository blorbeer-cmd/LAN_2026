import { nanoid } from 'nanoid';
import { config } from '../config';
import { db, DEFAULT_GROUP_ID, OUTSIDE_EVENTS_ID } from '../db';
import { getTrackingEvent } from '../events';

export interface ArcadeDataScope {
  groupId: string;
  eventId: string | null;
}

interface ArcadePlayerSnapshot {
  id?: string;
  playerId?: string;
  name?: string;
}

export function currentArcadeDataScope(playerIds: string[] = []): ArcadeDataScope | null {
  const tracking = getTrackingEvent();
  const groupId = tracking.id === OUTSIDE_EVENTS_ID ? DEFAULT_GROUP_ID : tracking.group_id ?? DEFAULT_GROUP_ID;
  const eventId = tracking.id === OUTSIDE_EVENTS_ID ? null : tracking.id;
  const uniquePlayerIds = [...new Set(playerIds)];
  if (uniquePlayerIds.length === 0) return { groupId, eventId };

  if (config.authMode === 'legacy') {
    const placeholders = uniquePlayerIds.map(() => '?').join(',');
    const playerCount = (
      db.prepare(`SELECT COUNT(*) AS count FROM players WHERE id IN (${placeholders})`).get(...uniquePlayerIds) as {
        count: number;
      }
    ).count;
    if (playerCount !== uniquePlayerIds.length) return null;
    const now = Date.now();
    const ensureMembership = db.prepare(
      `INSERT OR IGNORE INTO group_memberships
         (group_id, player_id, role, status, joined_at, ended_at, outside_tracking_enabled, invited_by)
       VALUES (?, ?, 'member', 'active', ?, NULL, 1, NULL)`,
    );
    db.transaction(() => {
      for (const playerId of uniquePlayerIds) ensureMembership.run(groupId, playerId, now);
    })();
    return { groupId, eventId };
  }

  const placeholders = uniquePlayerIds.map(() => '?').join(',');
  const activeCount = (
    db
      .prepare(
        `SELECT COUNT(*) AS count
         FROM group_memberships gm
         JOIN players p ON p.id = gm.player_id
         WHERE gm.group_id = ? AND gm.status = 'active' AND p.deactivated_at IS NULL
           AND gm.player_id IN (${placeholders})`,
      )
      .get(groupId, ...uniquePlayerIds) as { count: number }
  ).count;
  if (activeCount !== uniquePlayerIds.length) return null;

  // Legacy mode has one implicit group. Required mode additionally ensures
  // that an event-scoped Arcade action only references that event's roster.
  if (eventId) {
    const participantCount = (
      db
        .prepare(
          `SELECT COUNT(*) AS count FROM event_participants
           WHERE event_id = ? AND player_id IN (${placeholders})`,
        )
        .get(eventId, ...uniquePlayerIds) as { count: number }
    ).count;
    if (participantCount !== uniquePlayerIds.length) return null;
  }
  return { groupId, eventId };
}

export function recordArcadeResult(options: {
  gameType: string;
  winnerId: string | null;
  players: ArcadePlayerSnapshot[];
  scores: ArcadePlayerSnapshot[];
  reason: string;
  startedAt: number;
  endedAt?: number;
}): string | null {
  const playerSnapshots = options.players.filter((player) => typeof (player.id ?? player.playerId) === 'string');
  const participantKeys = playerSnapshots.map((player) => String(player.id ?? player.playerId));
  const realPlayers = db
    .prepare(`SELECT id, name FROM players WHERE id IN (${participantKeys.map(() => '?').join(',') || "''"})`)
    .all(...participantKeys) as Array<{ id: string; name: string }>;
  const realPlayerById = new Map(realPlayers.map((player) => [player.id, player]));
  const realPlayerIds = participantKeys.filter((id) => realPlayerById.has(id));
  const scope = currentArcadeDataScope(realPlayerIds);
  if (!scope || (options.winnerId !== null && !realPlayerById.has(options.winnerId))) return null;

  const resultId = nanoid();
  const endedAt = options.endedAt ?? Date.now();
  const scoreById = new Map(
    options.scores.map((score) => [String(score.playerId ?? score.id ?? ''), score]),
  );
  const insertResult = db.prepare(
    `INSERT INTO arcade_results
       (id, group_id, event_id, game_type, winner_id, players, scores, reason, started_at, ended_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const insertParticipant = db.prepare(
    `INSERT INTO arcade_result_participants
       (result_id, group_id, player_id, participant_key, player_name_snapshot, score_snapshot, is_winner)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );

  db.transaction(() => {
    insertResult.run(
      resultId,
      scope.groupId,
      scope.eventId,
      options.gameType,
      options.winnerId,
      JSON.stringify(options.players),
      JSON.stringify(options.scores),
      options.reason,
      options.startedAt,
      endedAt,
    );
    for (const player of playerSnapshots) {
      const participantKey = String(player.id ?? player.playerId);
      const score = scoreById.get(participantKey) ?? player;
      const realPlayer = realPlayerById.get(participantKey);
      insertParticipant.run(
        resultId,
        scope.groupId,
        realPlayer ? participantKey : null,
        participantKey,
        String(score.name ?? player.name ?? realPlayer?.name ?? 'Unbekannt'),
        JSON.stringify(score),
        options.winnerId === participantKey ? 1 : 0,
      );
    }
  })();
  return resultId;
}
