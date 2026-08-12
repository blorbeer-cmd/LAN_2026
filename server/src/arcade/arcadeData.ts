import { nanoid } from 'nanoid';
import { db } from '../db';
import { ACCEPTED_EVENT_PARTICIPANT_SQL } from '../eventParticipation';

export interface ArcadeDataScope {
  groupId: string;
  eventId: string | null;
}

interface ArcadePlayerSnapshot {
  id?: string;
  playerId?: string;
  name?: string;
  isWinner?: boolean;
}

export function currentArcadeDataScope(playerIds: string[] = []): ArcadeDataScope | null {
  const uniquePlayerIds = [...new Set(playerIds)];
  if (uniquePlayerIds.length === 0) return null;

  const placeholders = uniquePlayerIds.map(() => '?').join(',');
  const contexts = db
    .prepare(
      `SELECT DISTINCT e.id AS eventId, e.group_id AS groupId
       FROM player_event_contexts pec
       JOIN events e ON e.id = pec.active_event_id
       JOIN event_participants ep ON ep.event_id = e.id AND ep.player_id = pec.player_id
       JOIN group_memberships gm ON gm.group_id = e.group_id AND gm.player_id = pec.player_id
       JOIN players p ON p.id = pec.player_id
       WHERE pec.player_id IN (${placeholders}) AND ${ACCEPTED_EVENT_PARTICIPANT_SQL}
         AND gm.status = 'active' AND p.deactivated_at IS NULL`,
    )
    .all(...uniquePlayerIds) as Array<{ eventId: string; groupId: string }>;
  if (contexts.length !== 1) return null;
  const context = contexts[0];
  const participantCount = (
    db
      .prepare(
        `SELECT COUNT(*) AS count FROM event_participants ep
         WHERE ep.event_id = ? AND ep.player_id IN (${placeholders})
           AND ${ACCEPTED_EVENT_PARTICIPANT_SQL}`,
      )
      .get(context.eventId, ...uniquePlayerIds) as { count: number }
  ).count;
  return participantCount === uniquePlayerIds.length ? context : null;
}

export function recordArcadeResult(options: {
  gameType: string;
  winnerId: string | null;
  players: ArcadePlayerSnapshot[];
  scores: ArcadePlayerSnapshot[];
  reason: string;
  startedAt: number;
  endedAt?: number;
  matchId?: string;
  scope?: ArcadeDataScope;
}): string | null {
  const playerSnapshots = options.players.filter((player) => typeof (player.id ?? player.playerId) === 'string');
  const participantKeys = playerSnapshots.map((player) => String(player.id ?? player.playerId));
  const realPlayers = db
    .prepare(`SELECT id, name FROM players WHERE id IN (${participantKeys.map(() => '?').join(',') || "''"})`)
    .all(...participantKeys) as Array<{ id: string; name: string }>;
  const realPlayerById = new Map(realPlayers.map((player) => [player.id, player]));
  const realPlayerIds = participantKeys.filter((id) => realPlayerById.has(id));
  const scope = options.scope ?? currentArcadeDataScope(realPlayerIds);
  if (!scope?.eventId) return null;
  if (scope && options.scope) {
    const eventExists = Boolean(
      db.prepare('SELECT 1 FROM events WHERE id = ? AND group_id = ?').get(scope.eventId, scope.groupId),
    );
    const permitted = realPlayerIds.every((playerId) => Boolean(db.prepare(
      `SELECT 1 FROM group_memberships gm
       JOIN groups g ON g.id = gm.group_id
       JOIN players p ON p.id = gm.player_id
       WHERE gm.group_id = ? AND gm.player_id = ? AND gm.status = 'active'
         AND g.archived_at IS NULL AND p.deactivated_at IS NULL
         AND EXISTS (
           SELECT 1 FROM event_participants ep WHERE ep.event_id = ? AND ep.player_id = gm.player_id
             AND ${ACCEPTED_EVENT_PARTICIPANT_SQL}
         )`,
    ).get(scope.groupId, playerId, scope.eventId)));
    if (!eventExists || !permitted) return null;
  }
  if (!scope || (options.winnerId !== null && !realPlayerById.has(options.winnerId))) return null;

  const resultId = nanoid();
  const endedAt = options.endedAt ?? Date.now();
  const scoreById = new Map(
    options.scores.map((score) => [String(score.playerId ?? score.id ?? ''), score]),
  );
  const insertResult = db.prepare(
    `INSERT INTO arcade_results
       (id, group_id, event_id, game_type, winner_id, players, scores, reason, started_at, ended_at, source_match_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
      options.matchId ?? null,
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
        options.winnerId === participantKey || score.isWinner === true ? 1 : 0,
      );
    }
  })();
  return resultId;
}
