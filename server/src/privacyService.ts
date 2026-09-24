import { createHash } from 'node:crypto';
import { closeSync, existsSync, fstatSync, fsyncSync, mkdirSync, openSync, readFileSync, truncateSync, writeSync } from 'node:fs';
import path from 'node:path';
import { nanoid } from 'nanoid';
import { config } from './config';
import { db } from './db';
import { activeTrackingContexts } from './trackingContexts';
import { revokeRegistrationInvitesCreatedBy, voidOutstandingInvites } from './invites';
import { writeAdminAudit } from './adminAudit';
import { SUBJECT_SCOPED_TARGET_PREFIX } from './push';

const DELETED_NAME = 'Gelöschtes Konto';
// Replaces an account id used as an object key in historical JSON. Repeated
// erasures in the same object get a numbered variant so no earlier entry is
// overwritten.
const DELETED_ACCOUNT_KEY = 'deletedAccount';

export function deletionReceiptHash(playerId: string): string {
  return createHash('sha256').update(playerId).digest('hex');
}

export interface DeletionReceipt {
  subjectHash: string;
  deletedAt: number;
  action: string;
  attemptId?: string;
}

interface DeletionCancellation { cancelledAttemptId: string }

function validDeletionReceipt(value: unknown): value is DeletionReceipt {
  if (!value || typeof value !== 'object') return false;
  const receipt = value as Record<string, unknown>;
  return (
    typeof receipt.subjectHash === 'string' &&
    /^[a-f0-9]{64}$/.test(receipt.subjectHash) &&
    typeof receipt.deletedAt === 'number' &&
    Number.isFinite(receipt.deletedAt) &&
    typeof receipt.action === 'string' &&
    (receipt.attemptId === undefined || (typeof receipt.attemptId === 'string' && receipt.attemptId.length > 0))
  );
}

export function parseDeletionLedger(content: string): DeletionReceipt[] {
  const lines = content.split(/\r?\n/);
  const active = new Map<string, DeletionReceipt>();
  const legacy: DeletionReceipt[] = [];
  for (const [index, line] of lines.entries()) {
    if (!line.trim()) continue;
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch {
      throw new Error(`Löschbeleg-Ledger ist in Zeile ${index + 1} beschädigt.`);
    }
    if (validDeletionReceipt(value)) {
      if (value.attemptId) active.set(value.attemptId, value);
      else legacy.push(value);
    } else if (value && typeof value === 'object' &&
      typeof (value as DeletionCancellation).cancelledAttemptId === 'string' &&
      (value as DeletionCancellation).cancelledAttemptId.length > 0) {
      active.delete((value as DeletionCancellation).cancelledAttemptId);
    } else {
      throw new Error(`Löschbeleg-Ledger enthält in Zeile ${index + 1} einen ungültigen Beleg.`);
    }
  }
  return [...legacy, ...active.values()];
}

function readDeletionLedger(): DeletionReceipt[] {
  if (!config.deletionLedgerFile || !existsSync(config.deletionLedgerFile)) return [];
  return parseDeletionLedger(readFileSync(config.deletionLedgerFile, 'utf8'));
}

function appendDeletionReceipt(receipt: DeletionReceipt | DeletionCancellation): void {
  if (!config.deletionLedgerFile) return;
  mkdirSync(path.dirname(config.deletionLedgerFile), { recursive: true, mode: 0o700 });
  const descriptor = openSync(config.deletionLedgerFile, 'a', 0o600);
  let initialSize: number | undefined;
  let failed = false;
  let failure: unknown;
  try {
    initialSize = fstatSync(descriptor).size;
    writeSync(descriptor, `${JSON.stringify(receipt)}\n`, undefined, 'utf8');
    fsyncSync(descriptor);
  } catch (error) {
    failed = true;
    failure = error;
  } finally {
    try { closeSync(descriptor); } catch (error) {
      if (!failed) { failed = true; failure = error; }
    }
  }
  if (failed) {
    // Windows does not allow truncation through an append-only descriptor.
    // Close it first, then remove any line written before fsync failed.
    if (initialSize !== undefined) truncateSync(config.deletionLedgerFile, initialSize);
    throw failure;
  }
}

export function listDeletionReceipts(): DeletionReceipt[] {
  const auditRows = db.prepare(
    `SELECT action, details, created_at AS deletedAt
     FROM admin_log
     WHERE target_type = 'deleted_account'
       AND action IN ('player_self_deleted', 'player_deleted', 'test_player_deleted')
     ORDER BY created_at`,
  ).all() as Array<{ action: string; details: string | null; deletedAt: number }>;
  const receipts = new Map<string, DeletionReceipt>(
    readDeletionLedger().map((receipt) => [receipt.subjectHash, receipt]),
  );
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

function normalizedNames(names: Set<string>): Set<string> {
  return new Set([...names].map((name) => name.trim().toLocaleLowerCase('de-DE')).filter(Boolean));
}

function isOwnAdminAuditTarget(
  targetType: unknown,
  targetId: unknown,
  playerId: string,
  names: Set<string> = new Set(),
): boolean {
  if (targetId === playerId) return true;
  if (
    targetType === 'account_name' &&
    typeof targetId === 'string' &&
    normalizedNames(names).has(targetId.trim().toLocaleLowerCase('de-DE'))
  ) return true;
  return (
    targetType === 'event_participant' &&
    typeof targetId === 'string' &&
    targetId.split(':').at(-1) === playerId
  );
}

function personalAuditRows(playerId: string, names: Set<string>): Array<Record<string, unknown>> {
  return rows(
    `SELECT action, target_type AS targetType, target_id AS targetId,
            actor_player_id AS actorPlayerId, created_at AS createdAt
     FROM admin_log
     WHERE actor_player_id = ? OR target_id = ? OR target_type IN ('event_participant', 'account_name')
     ORDER BY created_at`,
    playerId,
    playerId,
  )
    .filter(
      (row) =>
        row.actorPlayerId === playerId ||
        isOwnAdminAuditTarget(row.targetType, row.targetId, playerId, names),
    )
    .map((row) => ({
      action: row.action,
      targetType: row.targetType,
      createdAt: row.createdAt,
      targetedOwnAccount: isOwnAdminAuditTarget(row.targetType, row.targetId, playerId, names) ? 1 : 0,
    }));
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
  const profileNames = new Set(
    [profile.name, profile.realName].filter((value): value is string => typeof value === 'string'),
  );

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
    competition: {
      drafts: rows(
        `SELECT d.id AS draftId, d.event_id AS eventId, e.name AS eventName,
                d.game_id AS gameId, g.name AS gameName, d.status, d.created_at AS createdAt,
                r.role, r.player_name_snapshot AS recordedName
         FROM draft_player_refs r
         JOIN drafts d ON d.group_id = r.group_id AND d.id = r.draft_id
         LEFT JOIN events e ON e.group_id = d.group_id AND e.id = d.event_id
         JOIN games g ON g.group_id = d.group_id AND g.id = d.game_id
         WHERE r.player_id = ? ORDER BY d.created_at`,
        playerId,
      ),
      tournamentTeams: rows(
        `SELECT tt.id AS teamId, tt.name AS teamName, tt.player_ids AS playerIds,
                t.id AS tournamentId, t.name AS tournamentName, t.format, t.status,
                t.event_id AS eventId, e.name AS eventName, t.game_id AS gameId, g.name AS gameName,
                t.created_at AS createdAt
         FROM tournament_teams tt
         JOIN tournaments t ON t.id = tt.tournament_id
         JOIN events e ON e.group_id = t.group_id AND e.id = t.event_id
         JOIN games g ON g.group_id = t.group_id AND g.id = t.game_id
         ORDER BY t.created_at`,
      ).flatMap(({ playerIds, ...row }) => {
        const members = parseJson(playerIds, []);
        return Array.isArray(members) && members.includes(playerId)
          ? [{ ...row, teamSize: members.length }]
          : [];
      }),
      tournamentMatches: rows(
        `SELECT tm.id, tm.round, tm.slot, tm.stage, tm.group_index AS groupIndex,
                tm.team_a_id AS teamAId, tm.team_b_id AS teamBId,
                tm.winner_team_id AS winnerTeamId, tm.score_a AS scoreA, tm.score_b AS scoreB,
                tm.is_draw AS isDraw, tm.is_bye AS isBye, tm.played_at AS playedAt,
                t.id AS tournamentId, t.name AS tournamentName,
                a.name AS teamAName, a.player_ids AS teamAPlayerIds,
                b.name AS teamBName, b.player_ids AS teamBPlayerIds
         FROM tournament_matches tm
         JOIN tournaments t ON t.id = tm.tournament_id
         LEFT JOIN tournament_teams a ON a.id = tm.team_a_id
         LEFT JOIN tournament_teams b ON b.id = tm.team_b_id
         ORDER BY tm.played_at, tm.round, tm.slot`,
      ).flatMap((row) => {
        const teamAPlayers = parseJson(row.teamAPlayerIds, []);
        const teamBPlayers = parseJson(row.teamBPlayerIds, []);
        const ownSide = Array.isArray(teamAPlayers) && teamAPlayers.includes(playerId)
          ? 'a'
          : Array.isArray(teamBPlayers) && teamBPlayers.includes(playerId)
            ? 'b'
            : null;
        if (!ownSide) return [];
        const ownTeamId = ownSide === 'a' ? row.teamAId : row.teamBId;
        return [{
          id: row.id,
          tournamentId: row.tournamentId,
          tournamentName: row.tournamentName,
          round: row.round,
          slot: row.slot,
          stage: row.stage,
          groupIndex: row.groupIndex,
          ownTeamName: ownSide === 'a' ? row.teamAName : row.teamBName,
          opponentTeamName: ownSide === 'a' ? row.teamBName : row.teamAName,
          ownScore: ownSide === 'a' ? row.scoreA : row.scoreB,
          opponentScore: ownSide === 'a' ? row.scoreB : row.scoreA,
          outcome: row.isDraw ? 'draw' : row.winnerTeamId === null ? null : row.winnerTeamId === ownTeamId ? 'win' : 'loss',
          isBye: row.isBye,
          playedAt: row.playedAt,
        }];
      }),
      recordedMatches: rows(
        `SELECT m.id, m.event_id AS eventId, e.name AS eventName, m.game_id AS gameId,
                g.name AS gameName, m.played_at AS playedAt, m.result
         FROM matches m
         JOIN events e ON e.group_id = m.group_id AND e.id = m.event_id
         JOIN games g ON g.group_id = m.group_id AND g.id = m.game_id
         ORDER BY m.played_at`,
      ).flatMap(({ result, ...row }) => {
        const parsed = parseJson(result, null);
        if (!parsed || typeof parsed !== 'object') return [];
        const match = parsed as Record<string, unknown>;
        if (!Array.isArray(match.teams)) return [];
        const ownTeamIndex = match.teams.findIndex((team) => {
          if (!team || typeof team !== 'object') return false;
          const players = (team as Record<string, unknown>).playerIds;
          return Array.isArray(players) && players.includes(playerId);
        });
        if (ownTeamIndex < 0) return [];
        const ownTeam = match.teams[ownTeamIndex] as Record<string, unknown>;
        return [{
          ...row,
          ownTeamIndex,
          teamSize: Array.isArray(ownTeam.playerIds) ? ownTeam.playerIds.length : 0,
          score: ownTeam.score ?? null,
          rank: ownTeam.rank ?? null,
          outcome: typeof match.winnerTeamIndex !== 'number'
            ? null
            : match.winnerTeamIndex === ownTeamIndex ? 'win' : 'loss',
        }];
      }),
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
    audit: personalAuditRows(playerId, profileNames),
  };
}

export type AccountDeletionBlockCode =
  | 'last_admin'
  | 'last_group_owner'
  | 'confirmed_event_payment'
  | 'owned_food_orders'
  | 'owned_carpools'
  | 'open_checklist_tasks'
  | 'active_draft_participation'
  | 'active_music_session';

export type AccountDeletionResult =
  | { ok: true; affectedGroupIds: string[]; subjectHash: string; wasTest: boolean }
  | { ok: false; code: 'not_found' | 'deletion_receipt_unavailable' | AccountDeletionBlockCode; message: string };

// The same organisational preconditions guard self-service and admin
// deletion, but the wording must not tell an admin to clean up "your" own
// carpool. Each blocker therefore carries both readings.
const BLOCK_MESSAGES: Record<AccountDeletionBlockCode, { self: string; admin: string }> = {
  last_admin: {
    self: 'Übertrage zuerst die Adminrolle auf ein anderes aktives Konto.',
    admin: 'Die Adminrolle muss zuerst auf ein anderes aktives Konto übertragen werden.',
  },
  last_group_owner: {
    self: 'Übertrage zuerst die Ownerrolle auf ein anderes aktives Konto.',
    admin: 'Die Ownerrolle muss zuerst auf ein anderes aktives Konto übertragen werden.',
  },
  confirmed_event_payment: {
    self: 'Die bestätigte Event-Zahlung muss von der Orga zuerst zurückgesetzt werden.',
    admin: 'Die bestätigte Event-Zahlung dieses Kontos muss zuerst zurückgesetzt werden.',
  },
  owned_food_orders: {
    self: 'Lösche zuerst die von dir angelegten Sammelbestellungen oder übergib sie über die Orga.',
    admin: 'Die von diesem Konto angelegten Sammelbestellungen müssen zuerst gelöscht oder übernommen werden.',
  },
  owned_carpools: {
    self: 'Lösche zuerst die von dir angelegten Fahrgemeinschaften oder übergib sie über die Orga.',
    admin: 'Die von diesem Konto angelegten Fahrgemeinschaften müssen zuerst gelöscht oder übernommen werden.',
  },
  open_checklist_tasks: {
    self: 'Schließe, storniere oder übergib zuerst deine offenen To-dos.',
    admin: 'Die offenen To-dos dieses Kontos müssen zuerst geschlossen, storniert oder übergeben werden.',
  },
  active_draft_participation: {
    self: 'Beende oder storniere zuerst den laufenden Captain-Draft.',
    admin: 'Der laufende Captain-Draft mit diesem Konto muss zuerst beendet oder storniert werden.',
  },
  active_music_session: {
    self: 'Beende zuerst deine laufende Jam-Session.',
    admin: 'Die laufende Jam-Session dieses Kontos muss zuerst beendet werden.',
  },
};

function blocked(
  code: AccountDeletionBlockCode,
  selfService: boolean,
): Exclude<AccountDeletionResult, { ok: true }> {
  return { ok: false, code, message: BLOCK_MESSAGES[code][selfService ? 'self' : 'admin'] };
}

function blocker(
  playerId: string,
  isAdmin: boolean,
  selfService: boolean,
): Exclude<AccountDeletionResult, { ok: true }> | null {
  if (isAdmin) {
    const count = (db.prepare('SELECT COUNT(*) AS count FROM players WHERE is_admin = 1 AND deactivated_at IS NULL').get() as { count: number }).count;
    if (count <= 1) return blocked('last_admin', selfService);
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
    return blocked('last_group_owner', selfService);
  }
  if (db.prepare('SELECT 1 FROM event_participants WHERE player_id = ? AND paid = 1 LIMIT 1').get(playerId)) {
    return blocked('confirmed_event_payment', selfService);
  }
  if (db.prepare('SELECT 1 FROM food_orders WHERE created_by = ? LIMIT 1').get(playerId)) {
    return blocked('owned_food_orders', selfService);
  }
  if (db.prepare('SELECT 1 FROM carpools WHERE created_by = ? LIMIT 1').get(playerId)) {
    return blocked('owned_carpools', selfService);
  }
  if (db.prepare("SELECT 1 FROM checklist_tasks WHERE (created_by = ? OR assignee_id = ?) AND status NOT IN ('done', 'cancelled') LIMIT 1").get(playerId, playerId)) {
    return blocked('open_checklist_tasks', selfService);
  }
  if (db.prepare(
    `SELECT 1
     FROM drafts d
     JOIN draft_player_refs r ON r.group_id = d.group_id AND r.draft_id = d.id
     WHERE d.status = 'active' AND r.player_id = ?
     LIMIT 1`,
  ).get(playerId)) {
    return blocked('active_draft_participation', selfService);
  }
  if (db.prepare("SELECT 1 FROM music_sessions WHERE host_player_id = ? AND status = 'active' LIMIT 1").get(playerId)) {
    return blocked('active_music_session', selfService);
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

// Seating layouts are keyed by (group_id, event_id); a group's permanent room
// plan stores event_id = NULL. Matching on event_id alone silently skips
// exactly that row, because `= NULL` is never true in SQL — and the stored
// assignment carries both the account id and a plain name snapshot.
function removePlayerAssignments(playerId: string): void {
  const layouts = db.prepare(
    'SELECT group_id AS groupId, event_id AS eventId, assignments AS value FROM seating_layouts',
  ).all() as Array<{ groupId: string; eventId: string | null; value: string }>;
  const update = db.prepare('UPDATE seating_layouts SET assignments = ? WHERE group_id = ? AND event_id IS ?');
  for (const layout of layouts) {
    const parsed = parseJson(layout.value, null);
    if (!Array.isArray(parsed)) continue;
    const filtered = parsed.filter(
      (assignment) =>
        !assignment || typeof assignment !== 'object' || (assignment as Record<string, unknown>).playerId !== playerId,
    );
    if (filtered.length !== parsed.length) update.run(JSON.stringify(filtered), layout.groupId, layout.eventId);
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
        // A later erasure must not overwrite an earlier one's entry in the
        // same object (for example two deleted accounts in one arcade score
        // map), so pick a key that is still free.
        let anonymousKey = DELETED_ACCOUNT_KEY;
        for (let suffix = 2; anonymousKey in output || entries.some(([key]) => key === anonymousKey); suffix += 1) {
          anonymousKey = `${DELETED_ACCOUNT_KEY}-${suffix}`;
        }
        output[anonymousKey] = redactJson(childValue, playerId, names, childKey, true);
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

function scrubAdminAuditTargets(playerId: string, names: Set<string>): void {
  const rows = db.prepare(
    'SELECT id, target_type AS targetType, target_id AS targetId FROM admin_log WHERE target_id IS NOT NULL',
  ).all() as Array<{ id: string; targetType: string; targetId: string }>;
  const clear = db.prepare('UPDATE admin_log SET target_id = NULL WHERE id = ?');
  for (const row of rows) {
    if (isOwnAdminAuditTarget(row.targetType, row.targetId, playerId, names)) clear.run(row.id);
  }
}

function structuredIdentifierReferencesPlayer(value: string | null, playerId: string): boolean {
  return value === playerId || Boolean(value?.split(':').includes(playerId));
}

// Pushes whose own body is a system-generated sentence about this account
// ("<Name> übernimmt: …", possibly quoting its own comment) cannot be fixed
// by clearing the identifier — the text itself is the account reference, so
// the row goes. Must run before scrubPushLogIdentifiers clears the marker.
// Account ids may contain SQL LIKE wildcards, so match in JavaScript.
function removeSubjectScopedPushes(playerId: string): void {
  const candidates = db.prepare(
    'SELECT id, target_id AS targetId FROM push_log WHERE target_id IS NOT NULL',
  ).all() as Array<{ id: string; targetId: string }>;
  const remove = db.prepare('DELETE FROM push_log WHERE id = ?');
  for (const row of candidates) {
    const parts = row.targetId.split(':');
    if (parts[0] === SUBJECT_SCOPED_TARGET_PREFIX && parts.at(-1) === playerId) remove.run(row.id);
  }
}

function scrubPushLogIdentifiers(playerId: string): void {
  const pushRows = db.prepare(
    'SELECT id, topic_key AS topicKey, target_id AS targetId FROM push_log WHERE topic_key IS NOT NULL OR target_id IS NOT NULL',
  ).all() as Array<{ id: string; topicKey: string | null; targetId: string | null }>;
  const update = db.prepare('UPDATE push_log SET topic_key = ?, target_id = ? WHERE id = ?');
  for (const row of pushRows) {
    const topicKey = structuredIdentifierReferencesPlayer(row.topicKey, playerId) ? null : row.topicKey;
    const targetId = structuredIdentifierReferencesPlayer(row.targetId, playerId) ? null : row.targetId;
    if (topicKey !== row.topicKey || targetId !== row.targetId) update.run(topicKey, targetId, row.id);
  }
}

function scrubAccountCopies(playerId: string, names: Set<string>): void {
  removeSubjectScopedPushes(playerId);
  removeIdFromJsonArrayTable('push_log', 'id', 'player_ids', playerId);
  scrubPushLogIdentifiers(playerId);
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
  scrubAdminAuditTargets(playerId, names);
  db.prepare(
    `DELETE FROM push_log
     WHERE topic_key IN (
       SELECT 'checklist-task:' || id FROM checklist_tasks WHERE created_by = ?
     )`,
  ).run(playerId);
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
  const blockedBy = blocker(player.id, Boolean(player.is_admin), actorPlayerId === player.id);
  if (blockedBy) return blockedBy;
  const affectedGroupIds = (db.prepare('SELECT group_id FROM group_memberships WHERE player_id = ?').all(player.id) as Array<{ group_id: string }>).map((row) => row.group_id);
  const subjectHash = deletionReceiptHash(player.id);
  const deletionAction = player.is_test
    ? 'test_player_deleted'
    : actorPlayerId === player.id
      ? 'player_self_deleted'
      : 'player_deleted';

  const receipt = { subjectHash, deletedAt: Date.now(), action: deletionAction, attemptId: nanoid() };
  try {
    // The hash-only ledger is deliberately durable before SQLite is changed:
    // once erasure starts, an older backup must never be allowed to revive the account.
    appendDeletionReceipt(receipt);
  } catch (error) {
    return {
      ok: false,
      code: 'deletion_receipt_unavailable',
      message: `Konto wurde nicht gelöscht, weil der externe Löschbeleg nicht sicher gespeichert werden konnte: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  const deleteInTransaction = db.transaction(() => {
    for (const purpose of ['register', 'claim', 'reset', 'test_login'] as const) voidOutstandingInvites(player.id, purpose);
    revokeRegistrationInvitesCreatedBy(player.id, 'creator_deleted', actorPlayerId);
    // Detaching keeps another account's task alive against the assignee_id
    // cascade, so the claim comment has to go explicitly: it is this account's
    // own free text, the checklist history still renders it, and the derived
    // "Übernommen" push is removed for exactly that reason.
    db.prepare(
      'UPDATE checklist_tasks SET assignee_id = NULL, claim_comment = NULL WHERE assignee_id = ? AND created_by != ?',
    ).run(player.id, player.id);
    scrubAccountCopies(player.id, new Set([player.name, ...(player.real_name ? [player.real_name] : [])]));
    db.prepare('DELETE FROM group_memberships WHERE player_id = ?').run(player.id);
    db.prepare('DELETE FROM players WHERE id = ?').run(player.id);
    writeAdminAudit({
      actorPlayerId: actorPlayerId === player.id ? undefined : actorPlayerId,
      action: deletionAction,
      targetType: 'deleted_account',
      details: { subjectHash, deletedAt: receipt.deletedAt },
    });
  });
  try {
    deleteInTransaction();
  } catch (error) {
    // The SQLite transaction rolled back. Cancel its pre-written receipt so
    // an older backup cannot turn a failed attempt into a later deletion.
    appendDeletionReceipt({ cancelledAttemptId: receipt.attemptId });
    throw error;
  }

  return { ok: true, affectedGroupIds, subjectHash, wasTest: Boolean(player.is_test) };
}
