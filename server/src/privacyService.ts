import { createHash } from 'node:crypto';
import { nanoid } from 'nanoid';
import { db } from './db';
import { activeTrackingContexts } from './trackingContexts';
import { revokeRegistrationInvitesCreatedBy, voidOutstandingInvites } from './invites';
import { writeAdminAudit } from './adminAudit';

const DELETED_NAME = 'Gelöschtes Konto';

export function deletionReceiptHash(playerId: string): string {
  return createHash('sha256').update(playerId).digest('hex');
}

export interface DeletionReceipt {
  subjectHash: string;
  deletedAt: number;
  action: string;
}

export function listDeletionReceipts(): DeletionReceipt[] {
  const auditRows = db.prepare(
    `SELECT action, details, created_at AS deletedAt
     FROM admin_log
     WHERE target_type = 'deleted_account'
       AND action IN ('player_self_deleted', 'player_deleted', 'test_player_deleted')
     ORDER BY created_at`,
  ).all() as Array<{ action: string; details: string | null; deletedAt: number }>;
  const receipts = new Map<string, DeletionReceipt>();
  for (const row of auditRows) {
    const details = parseJson(row.details, {}) as Record<string, unknown>;
    if (typeof details.subjectHash !== 'string' || !/^[a-f0-9]{64}$/.test(details.subjectHash)) continue;
    receipts.set(details.subjectHash, {
      subjectHash: details.subjectHash,
      deletedAt: row.deletedAt,
      action: row.action,
    });
  }
  return [...receipts.values()];
}

function rows(sql: string, ...params: unknown[]): Array<Record<string, unknown>> {
  return db.prepare(sql).all(...params) as Array<Record<string, unknown>>;
}

function parseJson(value: unknown, fallback: unknown): unknown {
  if (typeof value !== 'string') return fallback;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return fallback;
  }
}

function safeDiagnosticProcesses(playerId: string, processNames: unknown): string[] {
  if (activeTrackingContexts(playerId).length === 0) return [];
  const parsed = parseJson(processNames, []);
  return Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === 'string') : [];
}

export function buildPersonalDataExport(playerId: string): Record<string, unknown> | undefined {
  const profile = db
    .prepare(
      `SELECT id, name, real_name AS realName, color, avatar, tracking_paused AS trackingPaused,
              is_admin AS isAdmin, deactivated_at AS deactivatedAt, created_at AS createdAt,
              last_login_at AS lastLoginAt
       FROM players WHERE id = ?`,
    )
    .get(playerId) as Record<string, unknown> | undefined;
  if (!profile) return undefined;

  const diagnostic = db
    .prepare('SELECT agent_version AS agentVersion, last_report_at AS lastReportAt, process_names FROM agent_diagnostics WHERE player_id = ?')
    .get(playerId) as { agentVersion: string | null; lastReportAt: number; process_names: string } | undefined;
  const pushRows = rows(
    `SELECT id, title, body, url, event_name_snapshot AS eventName, notification_type AS notificationType,
            created_at AS createdAt, resolved_at AS resolvedAt, expires_at AS expiresAt, player_ids
     FROM push_log ORDER BY created_at`,
  ).filter((row) => {
    const recipients = parseJson(row.player_ids, []);
    return Array.isArray(recipients) && recipients.includes(playerId);
  }).map(({ player_ids: _playerIds, ...row }) => row);
  const seatingAssignments = rows(
    `SELECT group_id AS groupId, event_id AS eventId, assignments, updated_at AS updatedAt
     FROM seating_layouts ORDER BY updated_at`,
  ).flatMap((row) => {
    const assignments = parseJson(row.assignments, []);
    if (!Array.isArray(assignments)) return [];
    return assignments
      .filter(
        (assignment): assignment is Record<string, unknown> =>
          Boolean(assignment) &&
          typeof assignment === 'object' &&
          (assignment as Record<string, unknown>).playerId === playerId,
      )
      .map(({ playerId: _playerId, ...assignment }) => ({
        groupId: row.groupId,
        eventId: row.eventId,
        updatedAt: row.updatedAt,
        ...assignment,
      }));
  });

  return {
    format: 'respawn-personal-data',
    version: 1,
    exportedAt: Date.now(),
    notice: 'Zugangsdaten und fremde private Daten sind absichtlich nicht enthalten.',
    profile,
    memberships: rows(
      `SELECT gm.group_id AS groupId, g.name AS groupName, gm.role, gm.status,
              gm.joined_at AS joinedAt, gm.ended_at AS endedAt
       FROM group_memberships gm JOIN groups g ON g.id = gm.group_id
       WHERE gm.player_id = ? ORDER BY gm.joined_at`,
      playerId,
    ),
    eventParticipations: rows(
      `SELECT ep.event_id AS eventId, e.name AS eventName, ep.status, ep.paid,
              ep.paid_at AS paidAt, ep.paid_amount_cents AS paidAmountCents,
              ep.confirmed_schedule_revision AS confirmedScheduleRevision
       FROM event_participants ep JOIN events e ON e.id = ep.event_id
       WHERE ep.player_id = ? ORDER BY e.starts_at`,
      playerId,
    ),
    eventParticipationHistory: rows(
      `SELECT h.event_id AS eventId, e.name AS eventName, h.accepted_at AS acceptedAt,
              h.declined_at AS declinedAt, h.removed_at AS removedAt, h.updated_at AS updatedAt
       FROM event_participation_history h JOIN events e ON e.id = h.event_id
       WHERE h.player_id = ? ORDER BY h.updated_at`,
      playerId,
    ),
    consents: {
      eventTracking: rows(
        `SELECT c.id, c.event_id AS eventId, e.name AS eventName, c.accepted_at AS grantedAt,
                c.revoked_at AS revokedAt, c.purpose, c.text_version AS textVersion, c.source
         FROM event_tracking_consents c JOIN events e ON e.id = c.event_id
         WHERE c.player_id = ? ORDER BY c.accepted_at`,
        playerId,
      ),
      groupTracking: rows(
        `SELECT c.id, c.group_id AS groupId, g.name AS groupName, c.granted_at AS grantedAt,
                c.revoked_at AS revokedAt, c.purpose, c.text_version AS textVersion, c.source
         FROM group_tracking_consents c JOIN groups g ON g.id = c.group_id
         WHERE c.player_id = ? ORDER BY c.granted_at`,
        playerId,
      ),
    },
    gamePreferences: {
      skills: rows(
        `SELECT s.game_id AS gameId, g.name AS gameName, s.rating
         FROM skills s JOIN games g ON g.id = s.game_id WHERE s.player_id = ? ORDER BY g.name`,
        playerId,
      ),
      preferences: rows(
        `SELECT p.game_id AS gameId, g.name AS gameName, p.rating
         FROM preferences p JOIN games g ON g.id = p.game_id WHERE p.player_id = ? ORDER BY g.name`,
        playerId,
      ),
      votes: rows(
        `SELECT v.id, v.event_id AS eventId, v.game_id AS gameId, g.name AS gameName,
                v.round, v.points, v.created_at AS createdAt
         FROM votes v JOIN games g ON g.id = v.game_id WHERE v.player_id = ? ORDER BY v.created_at`,
        playerId,
      ),
    },
    activity: {
      agent: diagnostic
        ? {
            agentVersion: diagnostic.agentVersion,
            lastReportAt: diagnostic.lastReportAt,
            processNames: safeDiagnosticProcesses(playerId, diagnostic.process_names),
          }
        : null,
      playSessions: rows(
        `SELECT ps.id, ps.event_id AS eventId, e.name AS eventName, ps.game_id AS gameId,
                g.name AS gameName, ps.started_at AS startedAt, ps.ended_at AS endedAt,
                ps.active_ms AS activeMs
         FROM play_sessions ps JOIN events e ON e.id = ps.event_id JOIN games g ON g.id = ps.game_id
         WHERE ps.player_id = ? ORDER BY ps.started_at`,
        playerId,
      ),
    },
    organisation: {
      foodOrderItems: rows(
        `SELECT i.id, i.order_id AS orderId, o.title AS orderTitle, i.description, i.quantity,
                i.price_cents AS priceCents, i.paid, i.paid_at AS paidAt, i.created_at AS createdAt
         FROM food_order_items i JOIN food_orders o ON o.id = i.order_id
         WHERE i.player_id = ? ORDER BY i.created_at`,
        playerId,
      ),
      arrivals: rows(
        `SELECT a.event_id AS eventId, e.name AS eventName, a.arrival_at AS arrivalAt,
                a.departure_at AS departureAt, a.note, a.updated_at AS updatedAt
         FROM arrivals a JOIN events e ON e.id = a.event_id WHERE a.player_id = ?`,
        playerId,
      ),
      carpools: rows(
        `SELECT c.id, c.event_id AS eventId, c.direction, c.label, c.start_at AS startAt,
                c.start_location AS startLocation, c.eta_at AS etaAt, c.seats_total AS seatsTotal,
                CASE WHEN c.created_by = ? THEN 1 ELSE 0 END AS createdByMe
         FROM carpools c LEFT JOIN carpool_members cm ON cm.carpool_id = c.id
         WHERE c.created_by = ? OR cm.player_id = ? GROUP BY c.id ORDER BY c.start_at`,
        playerId,
        playerId,
        playerId,
      ),
      checklistItems: rows(
        `SELECT id, event_id AS eventId, label, template_key AS templateKey,
                checked_at AS checkedAt, created_at AS createdAt
         FROM checklist_items WHERE player_id = ? ORDER BY created_at`,
        playerId,
      ),
      checklistTasks: rows(
        `SELECT id, event_id AS eventId, type, title, description, status, claim_comment AS claimComment,
                due_at AS dueAt, created_at AS createdAt, taken_at AS takenAt, done_at AS doneAt,
                CASE WHEN created_by = ? THEN 1 ELSE 0 END AS createdByMe,
                CASE WHEN assignee_id = ? THEN 1 ELSE 0 END AS assignedToMe
         FROM checklist_tasks WHERE created_by = ? OR assignee_id = ? ORDER BY created_at`,
        playerId,
        playerId,
        playerId,
        playerId,
      ),
      calendarConfirmations: rows(
        `SELECT event_id AS eventId, schedule_key AS scheduleKey, confirmed_at AS confirmedAt
         FROM event_calendar_confirmations WHERE player_id = ? ORDER BY confirmed_at`,
        playerId,
      ),
      pollInvitations: rows(
        `SELECT i.poll_id AS pollId, p.event_id AS eventId, p.title, p.topic,
                i.invited_at AS invitedAt, i.last_reminder_at AS lastReminderAt,
                i.automatic_reminder_stage AS automaticReminderStage,
                i.automatic_reminder_due_at AS automaticReminderDueAt
         FROM event_date_poll_invitees i JOIN event_date_polls p ON p.id = i.poll_id
         WHERE i.player_id = ? ORDER BY i.invited_at`,
        playerId,
      ),
      pollResponses: rows(
        `SELECT r.poll_id AS pollId, p.event_id AS eventId, p.title, p.topic,
                r.option_id AS optionId, o.label AS optionLabel, o.starts_on AS startsOn,
                o.ends_on AS endsOn, r.response, r.updated_at AS updatedAt
         FROM event_date_poll_responses r
         JOIN event_date_polls p ON p.id = r.poll_id
         JOIN event_date_poll_options o ON o.poll_id = r.poll_id AND o.id = r.option_id
         WHERE r.player_id = ? ORDER BY r.updated_at`,
        playerId,
      ),
      seatingAssignments,
      seatNeighborRelations: rows(
        `SELECT group_id AS groupId, event_id AS eventId, source,
                CASE WHEN player_id = ? THEN 'declared_by_me' ELSE 'declared_about_me' END AS relationship
         FROM seat_neighbors WHERE player_id = ? OR neighbor_id = ?
         ORDER BY group_id, event_id, source`,
        playerId,
        playerId,
        playerId,
      ),
      authoredGamePings: rows(
        `SELECT id, group_id AS groupId, event_id AS eventId, game_id AS gameId,
                game_name_snapshot AS gameName, message, created_at AS createdAt,
                expires_at AS expiresAt, cancelled_at AS cancelledAt
         FROM game_pings WHERE player_id = ? ORDER BY created_at`,
        playerId,
      ),
      gamePingInterests: rows(
        `SELECT i.ping_id AS pingId, i.group_id AS groupId, p.event_id AS eventId,
                p.game_id AS gameId, p.game_name_snapshot AS gameName, i.created_at AS createdAt
         FROM game_ping_interested i
         JOIN game_pings p ON p.group_id = i.group_id AND p.id = i.ping_id
         WHERE i.player_id = ? ORDER BY i.created_at`,
        playerId,
      ),
    },
    communications: {
      authoredBroadcasts: rows(
        `SELECT id, event_id AS eventId, message, created_at AS createdAt, ended_at AS endedAt
         FROM broadcasts WHERE player_id = ? ORDER BY created_at`,
        playerId,
      ),
      notifications: pushRows,
      feedback: rows(
        `SELECT id, event_id AS eventId, view, sentiment, message, device,
                created_at AS createdAt, resolved_at AS resolvedAt
         FROM feedback_entries WHERE player_id = ? ORDER BY created_at`,
        playerId,
      ),
    },
    browserAndPush: {
      sessions: rows(
        `SELECT created_at AS createdAt, last_seen_at AS lastSeenAt, expires_at AS expiresAt
         FROM sessions WHERE player_id = ? ORDER BY created_at`,
        playerId,
      ),
      pushSubscriptions: rows(
        `SELECT created_at AS createdAt FROM push_subscriptions WHERE player_id = ? ORDER BY created_at`,
        playerId,
      ),
      onboarding: rows(
        `SELECT version, status, last_core_step AS lastCoreStep, rating_status AS ratingStatus,
                completed_at AS completedAt, updated_at AS updatedAt
         FROM player_onboarding WHERE player_id = ?`,
        playerId,
      )[0] ?? null,
      notificationState: {
        seen: rows(
          `SELECT push_id AS pushId, seen_at AS seenAt
           FROM push_log_seen WHERE player_id = ? ORDER BY seen_at`,
          playerId,
        ),
        hidden: rows(
          `SELECT push_id AS pushId, hidden_at AS hiddenAt
           FROM push_log_hidden WHERE player_id = ? ORDER BY hidden_at`,
          playerId,
        ),
        mutes: rows(
          `SELECT group_id AS groupId, event_id AS eventId, muted_at AS mutedAt
           FROM push_mutes WHERE player_id = ? ORDER BY muted_at`,
          playerId,
        ),
      },
    },
    arcade: {
      results: rows(
        `SELECT arp.result_id AS resultId, ar.game_type AS gameType, arp.player_name_snapshot AS recordedName,
                arp.score_snapshot AS score, arp.is_winner AS isWinner, ar.started_at AS startedAt,
                ar.ended_at AS endedAt
         FROM arcade_result_participants arp JOIN arcade_results ar ON ar.id = arp.result_id
         WHERE arp.player_id = ? ORDER BY ar.started_at`,
        playerId,
      ).map((row) => ({ ...row, score: parseJson(row.score, row.score) })),
      quizAnswers: rows(
        `SELECT question_id AS questionId, seen_at AS seenAt, was_correct AS wasCorrect
         FROM quiz_seen WHERE player_id = ? ORDER BY seen_at`,
        playerId,
      ),
      scribbleReactions: rows(
        `SELECT drawing_id AS drawingId, reaction, created_at AS createdAt
         FROM scribble_drawing_reactions WHERE player_id = ? ORDER BY created_at`,
        playerId,
      ),
      scribbleFavorites: rows(
        `SELECT drawing_id AS drawingId, match_id AS matchId, round_number AS roundNumber, created_at AS createdAt
         FROM scribble_drawing_favorites WHERE player_id = ? ORDER BY created_at`,
        playerId,
      ),
      scribbleDrawings: rows(
        `SELECT id, match_id AS matchId, round_number AS roundNumber, turn_number AS turnNumber,
                word, draw_ops AS drawOps, is_round_winner AS isRoundWinner,
                is_ai_match AS isAiMatch, created_at AS createdAt, group_id AS groupId,
                event_id AS eventId
         FROM scribble_drawings WHERE artist_id = ? ORDER BY created_at`,
        playerId,
      ).map((row) => ({ ...row, drawOps: parseJson(row.drawOps, row.drawOps) })),
      scribbleSeenWords: rows(
        `SELECT s.word_id AS wordId, w.word, s.seen_at AS seenAt,
                s.group_id AS groupId, s.event_id AS eventId
         FROM scribble_seen s JOIN scribble_words w ON w.id = s.word_id
         WHERE s.player_id = ? ORDER BY s.seen_at`,
        playerId,
      ),
    },
    authoredContent: {
      groups: rows(
        `SELECT id, name, description, created_at AS createdAt, archived_at AS archivedAt
         FROM groups WHERE created_by = ? ORDER BY created_at`,
        playerId,
      ),
      events: rows(
        `SELECT id, name, starts_at AS startsAt, ends_at AS endsAt, location, description,
                status, event_type_key AS eventTypeKey
         FROM events WHERE created_by = ? ORDER BY starts_at`,
        playerId,
      ),
      games: rows(
        `SELECT id, name, platform, platform_url AS platformUrl, trailer_url AS trailerUrl,
                genre, info, status, created_at AS createdAt
         FROM games WHERE created_by = ? ORDER BY created_at`,
        playerId,
      ),
      polls: rows(
        `SELECT id, event_id AS eventId, round_number AS roundNumber, title, topic, note,
                decision_note AS decisionNote, status, response_mode AS responseMode,
                created_at AS createdAt, updated_at AS updatedAt
         FROM event_date_polls WHERE created_by = ? ORDER BY created_at`,
        playerId,
      ),
      invites: rows(
        `SELECT purpose, event_id AS eventId, created_at AS createdAt, expires_at AS expiresAt,
                revoked_at AS revokedAt, used_at AS usedAt,
                CASE WHEN player_id = ? THEN 1 ELSE 0 END AS targetsOwnAccount,
                CASE WHEN used_by = ? THEN 1 ELSE 0 END AS usedByMe
         FROM invites WHERE created_by = ? OR player_id = ? OR used_by = ? ORDER BY created_at`,
        playerId,
        playerId,
        playerId,
        playerId,
        playerId,
      ),
      musicRequests: rows(
        `SELECT id, session_id AS sessionId, track_uri AS trackUri, track_id AS trackId,
                track_name AS trackName, artist_name AS artistName, album_name AS albumName,
                duration_ms AS durationMs, status, created_at AS createdAt, played_at AS playedAt
         FROM music_requests WHERE requested_by = ? ORDER BY created_at`,
        playerId,
      ),
      hostedMusicSessions: rows(
        `SELECT id, group_id AS groupId, event_id AS eventId, device_name AS deviceName,
                status, started_at AS startedAt, ended_at AS endedAt
         FROM music_sessions WHERE host_player_id = ? ORDER BY started_at`,
        playerId,
      ),
    },
    audit: rows(
      `SELECT action, target_type AS targetType, created_at AS createdAt,
              CASE WHEN target_id = ? THEN 1 ELSE 0 END AS targetedOwnAccount
       FROM admin_log WHERE actor_player_id = ? OR target_id = ? ORDER BY created_at`,
      playerId,
      playerId,
      playerId,
    ),
  };
}

export type AccountDeletionBlockCode =
  | 'last_admin'
  | 'last_group_owner'
  | 'confirmed_event_payment'
  | 'owned_food_orders'
  | 'owned_carpools'
  | 'open_checklist_tasks'
  | 'active_music_session';

export type AccountDeletionResult =
  | { ok: true; affectedGroupIds: string[]; subjectHash: string; wasTest: boolean }
  | { ok: false; code: 'not_found' | AccountDeletionBlockCode; message: string };

function blocker(playerId: string, isAdmin: boolean): Exclude<AccountDeletionResult, { ok: true }> | null {
  if (isAdmin) {
    const count = (db.prepare('SELECT COUNT(*) AS count FROM players WHERE is_admin = 1 AND deactivated_at IS NULL').get() as { count: number }).count;
    if (count <= 1) return { ok: false, code: 'last_admin', message: 'Übertrage zuerst die Adminrolle auf ein anderes aktives Konto.' };
  }
  if (db.prepare(
    `SELECT 1 FROM group_memberships gm JOIN groups g ON g.id = gm.group_id AND g.archived_at IS NULL
     WHERE gm.player_id = ? AND gm.status = 'active' AND gm.role = 'owner'
       AND NOT EXISTS (
         SELECT 1 FROM group_memberships other JOIN players p ON p.id = other.player_id
         WHERE other.group_id = gm.group_id AND other.player_id != gm.player_id
           AND other.status = 'active' AND other.role = 'owner' AND p.deactivated_at IS NULL
       ) LIMIT 1`,
  ).get(playerId)) {
    return { ok: false, code: 'last_group_owner', message: 'Übertrage zuerst die Ownerrolle auf ein anderes aktives Konto.' };
  }
  if (db.prepare('SELECT 1 FROM event_participants WHERE player_id = ? AND paid = 1 LIMIT 1').get(playerId)) {
    return { ok: false, code: 'confirmed_event_payment', message: 'Die bestätigte Event-Zahlung muss von der Orga zuerst zurückgesetzt werden.' };
  }
  if (db.prepare('SELECT 1 FROM food_orders WHERE created_by = ? LIMIT 1').get(playerId)) {
    return { ok: false, code: 'owned_food_orders', message: 'Lösche zuerst die von dir angelegten Sammelbestellungen oder übergib sie über die Orga.' };
  }
  if (db.prepare('SELECT 1 FROM carpools WHERE created_by = ? LIMIT 1').get(playerId)) {
    return { ok: false, code: 'owned_carpools', message: 'Lösche zuerst die von dir angelegten Fahrgemeinschaften oder übergib sie über die Orga.' };
  }
  if (db.prepare("SELECT 1 FROM checklist_tasks WHERE (created_by = ? OR assignee_id = ?) AND status NOT IN ('done', 'cancelled') LIMIT 1").get(playerId, playerId)) {
    return { ok: false, code: 'open_checklist_tasks', message: 'Schließe, storniere oder übergib zuerst deine offenen To-dos.' };
  }
  if (db.prepare("SELECT 1 FROM music_sessions WHERE host_player_id = ? AND status = 'active' LIMIT 1").get(playerId)) {
    return { ok: false, code: 'active_music_session', message: 'Beende zuerst deine laufende Jam-Session.' };
  }
  return null;
}

function removeIdFromJsonArrayTable(table: string, idColumn: string, jsonColumn: string, playerId: string): void {
  const data = db.prepare(`SELECT ${idColumn} AS id, ${jsonColumn} AS value FROM ${table}`).all() as Array<{ id: string; value: string }>;
  const update = db.prepare(`UPDATE ${table} SET ${jsonColumn} = ? WHERE ${idColumn} = ?`);
  for (const item of data) {
    const parsed = parseJson(item.value, null);
    if (!Array.isArray(parsed) || !parsed.includes(playerId)) continue;
    update.run(JSON.stringify(parsed.filter((value) => value !== playerId)), item.id);
  }
}

function removePlayerAssignments(playerId: string): void {
  const layouts = db.prepare('SELECT event_id AS id, assignments AS value FROM seating_layouts').all() as Array<{
    id: string;
    value: string;
  }>;
  const update = db.prepare('UPDATE seating_layouts SET assignments = ? WHERE event_id = ?');
  for (const layout of layouts) {
    const parsed = parseJson(layout.value, null);
    if (!Array.isArray(parsed)) continue;
    const filtered = parsed.filter(
      (assignment) =>
        !assignment || typeof assignment !== 'object' || (assignment as Record<string, unknown>).playerId !== playerId,
    );
    if (filtered.length !== parsed.length) update.run(JSON.stringify(filtered), layout.id);
  }
}

function redactJson(value: unknown, playerId: string, names: Set<string>, key = '', targetSnapshot = false): unknown {
  if (Array.isArray(value)) {
    return value
      .filter((item) => item !== playerId)
      .map((item) => redactJson(item, playerId, names, key, targetSnapshot));
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>);
    const isTargetSnapshot = targetSnapshot || entries.some(
      ([childKey, childValue]) =>
        childValue === playerId && /(?:player|winner|captain|artist|user).*id|^id$/i.test(childKey),
    );
    const output: Record<string, unknown> = {};
    for (const [childKey, childValue] of entries) {
      if (childKey === playerId) {
        output.deletedAccount = redactJson(childValue, playerId, names, childKey, true);
        continue;
      }
      if (childValue === playerId && /(?:player|winner|captain|artist|user).*id|^id$/i.test(childKey)) {
        output[childKey] = null;
      } else if (isTargetSnapshot && /name/i.test(childKey)) {
        output[childKey] = DELETED_NAME;
      } else if (isTargetSnapshot && /avatar|photo|image|color|rating/i.test(childKey)) {
        output[childKey] = null;
      } else {
        output[childKey] = redactJson(childValue, playerId, names, childKey, isTargetSnapshot);
      }
    }
    return output;
  }
  if (typeof value === 'string' && /name/i.test(key) && names.has(value)) return DELETED_NAME;
  return value;
}

function redactJsonColumn(table: string, idColumn: string, jsonColumn: string, playerId: string, names: Set<string>): void {
  const data = db.prepare(`SELECT ${idColumn} AS id, ${jsonColumn} AS value FROM ${table} WHERE ${jsonColumn} IS NOT NULL`).all() as Array<{ id: string; value: string }>;
  const update = db.prepare(`UPDATE ${table} SET ${jsonColumn} = ? WHERE ${idColumn} = ?`);
  for (const item of data) {
    const parsed = parseJson(item.value, null);
    if (parsed === null) continue;
    const redacted = redactJson(parsed, playerId, names);
    if (JSON.stringify(parsed) !== JSON.stringify(redacted)) update.run(JSON.stringify(redacted), item.id);
  }
}

function scrubAdminAuditTargets(playerId: string): void {
  const rows = db.prepare(
    'SELECT id, target_type AS targetType, target_id AS targetId FROM admin_log WHERE target_id IS NOT NULL',
  ).all() as Array<{ id: string; targetType: string; targetId: string }>;
  const clear = db.prepare('UPDATE admin_log SET target_id = NULL WHERE id = ?');
  for (const row of rows) {
    const isOwnAccount = row.targetId === playerId;
    const isOwnEventParticipation =
      row.targetType === 'event_participant' && row.targetId.split(':').at(-1) === playerId;
    if (isOwnAccount || isOwnEventParticipation) clear.run(row.id);
  }
}

function scrubAccountCopies(playerId: string, names: Set<string>): void {
  removeIdFromJsonArrayTable('push_log', 'id', 'player_ids', playerId);
  removeIdFromJsonArrayTable('broadcasts', 'id', 'recipient_ids', playerId);
  removeIdFromJsonArrayTable('tournament_teams', 'id', 'player_ids', playerId);
  for (const column of ['captain_ids', 'pool_ids', 'picks']) redactJsonColumn('drafts', 'id', column, playerId, names);
  redactJsonColumn('matches', 'id', 'result', playerId, names);
  redactJsonColumn('matchmaking_draws', 'id', 'teams', playerId, names);
  removePlayerAssignments(playerId);
  redactJsonColumn('arcade_results', 'id', 'players', playerId, names);
  redactJsonColumn('arcade_results', 'id', 'scores', playerId, names);
  redactJsonColumn('admin_log', 'id', 'details', playerId, names);
  db.prepare('UPDATE scribble_drawings SET artist_name = ? WHERE artist_id = ?').run(DELETED_NAME, playerId);
  // Notification titles and bodies are free text and can contain unrelated
  // words that merely include a short gamer tag (for example LAN-Party).
  // Structured recipient ids are removed above; do not corrupt other
  // people's historical text with an unbound substring replacement.
  scrubAdminAuditTargets(playerId);
  db.prepare('DELETE FROM seat_neighbors WHERE player_id = ? OR neighbor_id = ?').run(playerId, playerId);
  db.prepare('DELETE FROM event_calendar_confirmations WHERE player_id = ?').run(playerId);
  db.prepare('DELETE FROM event_date_poll_responses WHERE player_id = ?').run(playerId);
  db.prepare('DELETE FROM event_reminder_deliveries WHERE player_id = ?').run(playerId);
  db.prepare('DELETE FROM votes WHERE player_id = ?').run(playerId);
  db.prepare('DELETE FROM draft_player_refs WHERE player_id = ?').run(playerId);
  db.prepare('DELETE FROM broadcasts WHERE player_id = ?').run(playerId);
  db.prepare('DELETE FROM game_ping_interested WHERE player_id = ?').run(playerId);
  db.prepare('DELETE FROM game_pings WHERE player_id = ?').run(playerId);
  const arcadeRows = db.prepare('SELECT result_id, group_id, participant_key, score_snapshot FROM arcade_result_participants WHERE player_id = ?').all(playerId) as Array<{ result_id: string; group_id: string; participant_key: string; score_snapshot: string }>;
  const redactArcade = db.prepare(
    `UPDATE arcade_result_participants
     SET player_id = NULL, participant_key = ?, player_name_snapshot = ?, score_snapshot = ?
     WHERE result_id = ? AND group_id = ? AND participant_key = ?`,
  );
  for (const row of arcadeRows) {
    const score = parseJson(row.score_snapshot, {});
    redactArcade.run(
      `deleted-${nanoid(12)}`,
      DELETED_NAME,
      JSON.stringify(redactJson(score, playerId, names)),
      row.result_id,
      row.group_id,
      row.participant_key,
    );
  }
}

export function deleteAccount(playerId: string, actorPlayerId?: string): AccountDeletionResult {
  const player = db.prepare('SELECT id, name, real_name, is_admin, is_test FROM players WHERE id = ?').get(playerId) as
    | { id: string; name: string; real_name: string | null; is_admin: number; is_test: number }
    | undefined;
  if (!player) return { ok: false, code: 'not_found', message: 'Konto nicht gefunden.' };
  const blocked = blocker(player.id, Boolean(player.is_admin));
  if (blocked) return blocked;
  const affectedGroupIds = (db.prepare('SELECT group_id FROM group_memberships WHERE player_id = ?').all(player.id) as Array<{ group_id: string }>).map((row) => row.group_id);
  const subjectHash = deletionReceiptHash(player.id);
  const deletionAction = player.is_test
    ? 'test_player_deleted'
    : actorPlayerId === player.id
      ? 'player_self_deleted'
      : 'player_deleted';

  db.transaction(() => {
    for (const purpose of ['register', 'claim', 'reset', 'test_login'] as const) voidOutstandingInvites(player.id, purpose);
    revokeRegistrationInvitesCreatedBy(player.id, 'creator_deleted', actorPlayerId);
    db.prepare('UPDATE checklist_tasks SET assignee_id = NULL WHERE assignee_id = ? AND created_by != ?').run(player.id, player.id);
    scrubAccountCopies(player.id, new Set([player.name, ...(player.real_name ? [player.real_name] : [])]));
    db.prepare('DELETE FROM group_memberships WHERE player_id = ?').run(player.id);
    db.prepare('DELETE FROM players WHERE id = ?').run(player.id);
    writeAdminAudit({
      actorPlayerId: actorPlayerId === player.id ? undefined : actorPlayerId,
      action: deletionAction,
      targetType: 'deleted_account',
      details: { subjectHash },
    });
  })();

  return { ok: true, affectedGroupIds, subjectHash, wasTest: Boolean(player.is_test) };
}
