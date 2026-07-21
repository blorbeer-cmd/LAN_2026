import { Router } from 'express';
import { nanoid } from 'nanoid';
import { writeAdminAudit } from '../adminAudit';
import { config } from '../config';
import { db } from '../db';
import { requireGroupEventAccess, resolveGroupEventScope, type GroupEventScope } from '../groupEventScope';
import { resolveGroupResource } from '../groupAuthorization';
import { activeGroupPlayers } from '../groupPlayers';
import { withBodyPlayerIdentity } from '../sessions';
import { isNonEmptyString } from '../validation';

export const pingsRouter = Router();

const DEFAULT_EXPIRES_MINUTES = 45;
const MAX_EXPIRES_MINUTES = 180;
const MIN_EXPIRES_MINUTES = 5;

interface PingRow {
  id: string;
  group_id: string;
  event_id: string | null;
  player_id: string;
  player_name_snapshot: string;
  player_color_snapshot: string;
  player_avatar_snapshot: string | null;
  game_id: string;
  game_name_snapshot: string;
  game_icon_snapshot: string;
  message: string | null;
  created_at: number;
  expires_at: number;
  cancelled_at: number | null;
}

const resolvePing = resolveGroupResource<PingRow>({
  resourceType: 'Ping',
  load: (id) => {
    const row = db.prepare('SELECT * FROM game_pings WHERE id = ?').get(id) as PingRow | undefined;
    return row ? { resource: row, groupId: row.group_id } : undefined;
  },
});

function buildPings(groupId: string, eventId: GroupEventScope | undefined, history: boolean) {
  const clauses = ['group_id = ?'];
  const params: Array<string | number | null> = [groupId];
  if (eventId !== undefined) {
    clauses.push('event_id IS ?');
    params.push(eventId);
  }
  if (!history) {
    clauses.push('cancelled_at IS NULL', 'expires_at > ?');
    params.push(Date.now());
  }
  const rows = db
    .prepare(`SELECT * FROM game_pings WHERE ${clauses.join(' AND ')} ORDER BY created_at DESC`)
    .all(...params) as PingRow[];
  if (rows.length === 0) return [];

  const interestedRows = db
    .prepare(
      `SELECT ping_id, player_id, player_name_snapshot, player_color_snapshot, player_avatar_snapshot
       FROM game_ping_interested
       WHERE group_id = ? AND ping_id IN (${rows.map(() => '?').join(',')})
       ORDER BY created_at`,
    )
    .all(groupId, ...rows.map((row) => row.id)) as Array<{
    ping_id: string;
    player_id: string;
    player_name_snapshot: string;
    player_color_snapshot: string;
    player_avatar_snapshot: string | null;
  }>;
  const interestedByPing = new Map<string, Array<{ id: string; name: string; color: string; avatar: string | null }>>();
  for (const interested of interestedRows) {
    const list = interestedByPing.get(interested.ping_id) ?? [];
    list.push({
      id: interested.player_id,
      name: interested.player_name_snapshot,
      color: interested.player_color_snapshot,
      avatar: interested.player_avatar_snapshot,
    });
    interestedByPing.set(interested.ping_id, list);
  }

  const now = Date.now();
  return rows.map((row) => ({
    id: row.id,
    groupId: row.group_id,
    eventId: row.event_id,
    playerId: row.player_id,
    playerName: row.player_name_snapshot,
    playerColor: row.player_color_snapshot,
    playerAvatar: row.player_avatar_snapshot,
    gameId: row.game_id,
    gameName: row.game_name_snapshot,
    gameIcon: row.game_icon_snapshot,
    message: row.message,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    cancelledAt: row.cancelled_at,
    active: row.cancelled_at === null && row.expires_at > now,
    interested: interestedByPing.get(row.id) ?? [],
  }));
}

// GET /api/pings/history - durable group history, optionally narrowed to an
// event in the same retained group_id scope. Without eventId it spans the
// request's group scope.
pingsRouter.get('/history', (req, res) => {
  if (req.query.eventId === undefined) {
    return res.json({ groupId: req.group!.id, pings: buildPings(req.group!.id, undefined, true) });
  }
  const scope = resolveGroupEventScope(req.group!.id, req.query.eventId);
  if (!scope.ok) return res.status(scope.status).json({ error: scope.error });
  if (!requireGroupEventAccess(req, res, scope.eventId)) return;
  res.json({ groupId: req.group!.id, eventId: scope.eventId, pings: buildPings(req.group!.id, scope.eventId, true) });
});

// GET /api/pings - active pings in the current group room/tracking event.
pingsRouter.get('/', (req, res) => {
  const scope = resolveGroupEventScope(req.group!.id, req.query.eventId);
  if (!scope.ok) return res.status(scope.status).json({ error: scope.error });
  if (!requireGroupEventAccess(req, res, scope.eventId)) return;
  res.json({ groupId: req.group!.id, eventId: scope.eventId, pings: buildPings(req.group!.id, scope.eventId, false) });
});

// POST /api/pings - active members create a short-lived request. Required
// auth binds playerId to the session; legacy keeps the existing body shape.
pingsRouter.post('/', ...withBodyPlayerIdentity, (req, res) => {
  const { playerId, gameId, message, expiresInMinutes, eventId } = req.body ?? {};
  if (typeof playerId !== 'string' || !playerId) return res.status(400).json({ error: 'playerId ist erforderlich.' });
  if (typeof gameId !== 'string' || !gameId) return res.status(400).json({ error: 'gameId ist erforderlich.' });
  if (message !== undefined && message !== null && !isNonEmptyString(message, 140)) {
    return res.status(400).json({ error: 'message darf höchstens 140 Zeichen lang sein.' });
  }
  const minutes =
    expiresInMinutes === undefined
      ? DEFAULT_EXPIRES_MINUTES
      : typeof expiresInMinutes === 'number' &&
          Number.isInteger(expiresInMinutes) &&
          expiresInMinutes >= MIN_EXPIRES_MINUTES &&
          expiresInMinutes <= MAX_EXPIRES_MINUTES
        ? expiresInMinutes
        : null;
  if (minutes === null) {
    return res.status(400).json({
      error: `expiresInMinutes muss zwischen ${MIN_EXPIRES_MINUTES} und ${MAX_EXPIRES_MINUTES} liegen.`,
    });
  }

  const scope = resolveGroupEventScope(req.group!.id, eventId);
  if (!scope.ok) return res.status(scope.status).json({ error: scope.error });
  if (!requireGroupEventAccess(req, res, scope.eventId)) return;
  const player = activeGroupPlayers(req.group!.id, [playerId]).get(playerId);
  if (!player) return res.status(404).json({ error: 'Spieler nicht gefunden.' });
  const game = db
    .prepare('SELECT id, name, icon FROM games WHERE id = ? AND group_id = ?')
    .get(gameId, req.group!.id) as { id: string; name: string; icon: string } | undefined;
  if (!game) return res.status(404).json({ error: 'Spiel nicht gefunden.' });

  const now = Date.now();
  db.prepare(
    `INSERT INTO game_pings
       (id, group_id, event_id, player_id, player_name_snapshot, player_color_snapshot, player_avatar_snapshot,
        game_id, game_name_snapshot, game_icon_snapshot, message, created_at, expires_at, cancelled_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
  ).run(
    nanoid(),
    req.group!.id,
    scope.eventId,
    player.id,
    player.name,
    player.color,
    player.avatar,
    game.id,
    game.name,
    game.icon,
    isNonEmptyString(message, 140) ? message.trim() : null,
    now,
    now + minutes * 60_000,
  );
  res.status(201).json({
    groupId: req.group!.id,
    eventId: scope.eventId,
    pings: buildPings(req.group!.id, scope.eventId, false),
  });
});

pingsRouter.post('/:id/interested', resolvePing, ...withBodyPlayerIdentity, (req, res) => {
  const ping = req.groupResource as PingRow;
  if (ping.cancelled_at !== null || ping.expires_at <= Date.now()) {
    return res.status(410).json({ error: 'Dieser Ping ist bereits abgelaufen.' });
  }
  const { playerId } = req.body ?? {};
  if (typeof playerId !== 'string' || !playerId) return res.status(400).json({ error: 'playerId ist erforderlich.' });
  const player = activeGroupPlayers(ping.group_id, [playerId]).get(playerId);
  if (!player) return res.status(404).json({ error: 'Spieler nicht gefunden.' });

  const existing = db
    .prepare('SELECT 1 FROM game_ping_interested WHERE ping_id = ? AND player_id = ?')
    .get(ping.id, player.id);
  if (existing) {
    db.prepare('DELETE FROM game_ping_interested WHERE ping_id = ? AND player_id = ?').run(ping.id, player.id);
  } else {
    db.prepare(
      `INSERT INTO game_ping_interested
         (ping_id, group_id, player_id, player_name_snapshot, player_color_snapshot, player_avatar_snapshot, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(ping.id, ping.group_id, player.id, player.name, player.color, player.avatar, Date.now());
  }
  res.json({
    groupId: ping.group_id,
    eventId: ping.event_id,
    pings: buildPings(ping.group_id, ping.event_id, false),
  });
});

// Creators may cancel their own ping; a group Admin/Owner may moderate any
// ping. Instance-admin state is deliberately not a group-role bypass.
pingsRouter.delete('/:id', resolvePing, (req, res) => {
  const ping = req.groupResource as PingRow;
  const role = req.groupMembership?.role;
  const mayModerate = role === 'admin' || role === 'owner';
  if (config.authMode !== 'legacy' && req.player?.id !== ping.player_id && !mayModerate) {
    writeAdminAudit({
      actorPlayerId: req.player?.id,
      groupId: ping.group_id,
      action: 'group_role_denied',
      targetType: 'ping',
      targetId: ping.id,
      details: { status: 403, requiredRole: 'admin', actualRole: role },
    });
    return res.status(403).json({ error: 'Nur Ersteller oder Gruppen-Admins können diesen Ping beenden.' });
  }
  db.prepare('UPDATE game_pings SET cancelled_at = COALESCE(cancelled_at, ?) WHERE id = ? AND group_id = ?').run(
    Date.now(),
    ping.id,
    ping.group_id,
  );
  res.status(204).end();
});
