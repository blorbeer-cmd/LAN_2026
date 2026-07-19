// Admin extras are session-role protected in required mode.

import { Router } from 'express';
import { requireAdmin } from '../auth';
import { db } from '../db';
import { config } from '../config';
import { broadcast, Events } from '../realtime';
import { getLiveBoard } from '../liveStatus';
import { createTestUsers, countTestUsers, MAX_TEST_USERS_PER_CALL } from '../testUsers';
import { deleteAllTestData, seedHallOfFameTestData } from '../testData';
import { writeAdminAudit } from '../adminAudit';
import { requireRecentReauthentication } from '../sessions';

export const adminRouter = Router();

// POST /api/admin/test-users - body: { count }. Creates fully seeded test
// players (seats + visible monitors, skill/Bock per game, play sessions,
// two of them live) in one transaction — see testUsers.ts.
adminRouter.post('/test-users', requireAdmin, (req, res) => {
  if (config.authMode === 'required') {
    return res.status(403).json({ error: 'Test-Spieler werden über die aktive Gruppe verwaltet.' });
  }
  const { count } = req.body ?? {};
  if (!Number.isInteger(count) || count < 1 || count > MAX_TEST_USERS_PER_CALL) {
    return res.status(400).json({ error: `count muss eine ganze Zahl zwischen 1 und ${MAX_TEST_USERS_PER_CALL} sein.` });
  }
  const created = createTestUsers(count);
  writeAdminAudit({
    actorPlayerId: req.player?.id,
    action: 'test_users_created',
    targetType: 'test_user_batch',
    details: { count: created.length },
  });
  broadcast(Events.playersChanged, null, { groupId: req.group!.id });
  broadcast(Events.skillsChanged, null, { groupId: req.group!.id });
  broadcast(Events.liveStatusChanged, getLiveBoard(req.group!.id), { groupId: req.group!.id });
  res.status(201).json({ created, totalTestUsers: countTestUsers() });
});

// POST /api/admin/test-data/hall-of-fame - replaces the marked historical
// fixtures with a dense deterministic 2015-2026 data set. Kept separate from
// player creation so adding another test participant never rewrites history.
adminRouter.post('/test-data/hall-of-fame', requireAdmin, (req, res) => {
  if (config.authMode === 'required') {
    return res.status(403).json({ error: 'Test-Daten werden über die aktive Gruppe verwaltet.' });
  }
  try {
    const created = seedHallOfFameTestData();
    broadcast(Events.eventsChanged, null, { groupId: req.group!.id });
    broadcast(Events.leaderboardChanged, null, { groupId: req.group!.id });
    broadcast(Events.tournamentsChanged, null, { groupId: req.group!.id });
    res.status(201).json(created);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Hall-of-Fame-Testdaten konnten nicht angelegt werden.';
    res.status(409).json({ error: message });
  }
});

// DELETE /api/admin/test-users - removes every test player and everything
// hanging off them (skills, Bock, sessions, seats, neighbors, live rows).
adminRouter.delete('/test-users', requireAdmin, requireRecentReauthentication, (req, res) => {
  if (config.authMode === 'required') {
    return res.status(403).json({ error: 'Test-Spieler werden über die aktive Gruppe verwaltet.' });
  }
  const { deletedPlayers, deletedEvents } = deleteAllTestData();
  writeAdminAudit({
    actorPlayerId: req.player?.id,
    action: 'test_users_deleted',
    targetType: 'test_user_batch',
    details: { deletedPlayers, deletedEvents },
  });
  if (deletedPlayers > 0 || deletedEvents > 0) {
    broadcast(Events.playersChanged, null, { groupId: req.group!.id });
    broadcast(Events.skillsChanged, null, { groupId: req.group!.id });
    broadcast(Events.liveStatusChanged, getLiveBoard(req.group!.id), { groupId: req.group!.id });
    broadcast(Events.eventsChanged, null, { groupId: req.group!.id });
    broadcast(Events.leaderboardChanged, null, { groupId: req.group!.id });
    broadcast(Events.tournamentsChanged, null, { groupId: req.group!.id });
  }
  // `deleted` remains for older clients; it historically meant players.
  res.json({ deleted: deletedPlayers, deletedPlayers, deletedEvents });
});

// GET /api/admin/agent-diagnostics — one compact troubleshooting row per
// player, including players that never installed/reported from an agent.
adminRouter.get('/agent-diagnostics', requireAdmin, (_req, res) => {
  const now = Date.now();
  const rows = db.prepare(
    `SELECT p.id AS player_id, p.name,
            d.agent_version, d.last_report_at, d.process_names
     FROM players p
     LEFT JOIN agent_diagnostics d ON d.player_id = p.id
     ORDER BY p.name COLLATE NOCASE`
  ).all() as Array<{
    player_id: string;
    name: string;
    agent_version: string | null;
    last_report_at: number | null;
    process_names: string | null;
  }>;

  res.json(rows.map((row) => {
    let processNames: string[] = [];
    try {
      const parsed = JSON.parse(row.process_names ?? '[]');
      if (Array.isArray(parsed)) processNames = parsed.filter((value): value is string => typeof value === 'string');
    } catch {
      processNames = [];
    }
    return {
      playerId: row.player_id,
      name: row.name,
      agentVersion: row.agent_version,
      lastReportAt: row.last_report_at,
      online: row.last_report_at !== null && now - row.last_report_at <= config.offlineTimeoutMs,
      processNames,
    };
  }));
});

// Admin roster includes deactivated accounts that are intentionally omitted
// from every normal picker and participant list.
adminRouter.get('/players', requireAdmin, (_req, res) => {
  const rows = db
    .prepare(
      `SELECT id, name, real_name, color, avatar, tracking_paused, is_admin, is_test,
              password_hash IS NOT NULL AS is_claimed, deactivated_at, created_at
       FROM players
       ORDER BY deactivated_at IS NOT NULL, name COLLATE NOCASE`
    )
    .all();
  res.json(rows);
});

adminRouter.get('/audit', requireAdmin, (req, res) => {
  const limitRaw = Number(req.query.limit ?? 100);
  const limit = Number.isInteger(limitRaw) ? Math.min(500, Math.max(1, limitRaw)) : 100;
  const rows = db
    .prepare(
      `SELECT l.id, l.actor_player_id, p.name AS actor_name, l.action, l.target_type,
              l.target_id, l.details, l.created_at
       FROM admin_log l
       LEFT JOIN players p ON p.id = l.actor_player_id
       WHERE l.group_id IS NULL
       ORDER BY l.created_at DESC
       LIMIT ?`
    )
    .all(limit);
  res.json(rows);
});
