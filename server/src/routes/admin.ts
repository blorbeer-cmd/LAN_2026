// Admin unlock: a device becomes "admin" by proving it knows the admin PIN
// (config.adminPin). Empty PIN = open/dev mode, so unlocking always succeeds
// and local testing needs no secret. Kept deliberately light — this is the
// minimal moderation role (bulk-create test users, grant admin, edit/delete
// everywhere), not a full per-user auth system. The actual admin-only writes
// (e.g. granting admin) live on the players router and can be gated with
// requireAdmin; this router just hands the client its admin ticket.

import { Router } from 'express';
import { adminUnlockValid, adminPinRequired } from '../auth';
import { requireAdmin } from '../auth';
import { db } from '../db';
import { config } from '../config';
import { broadcast, Events } from '../realtime';
import { getLiveBoard } from '../liveStatus';
import { createTestUsers, deleteTestUsers, countTestUsers, MAX_TEST_USERS_PER_CALL } from '../testUsers';

export const adminRouter = Router();

// GET /api/admin/status - does admin mode need a PIN at all? The frontend
// uses this to decide whether to prompt for one before enabling admin mode.
adminRouter.get('/status', (_req, res) => {
  res.json({ pinRequired: adminPinRequired() });
});

// POST /api/admin/unlock - body: { pin }. Returns ok if the PIN matches (or
// if no PIN is configured). The client remembers this locally, like whoami.
adminRouter.post('/unlock', (req, res) => {
  const { pin } = req.body ?? {};
  if (!adminUnlockValid(pin)) {
    return res.status(403).json({ error: 'Falscher Admin-PIN.' });
  }
  res.json({ ok: true });
});

// POST /api/admin/test-users - body: { count }. Creates fully seeded test
// players (seats + visible monitors, skill/Bock per game, play sessions,
// two of them live) in one transaction — see testUsers.ts.
adminRouter.post('/test-users', requireAdmin, (req, res) => {
  const { count } = req.body ?? {};
  if (!Number.isInteger(count) || count < 1 || count > MAX_TEST_USERS_PER_CALL) {
    return res.status(400).json({ error: `count muss eine ganze Zahl zwischen 1 und ${MAX_TEST_USERS_PER_CALL} sein.` });
  }
  const created = createTestUsers(count);
  broadcast(Events.playersChanged, null);
  broadcast(Events.skillsChanged, null);
  broadcast(Events.liveStatusChanged, getLiveBoard());
  res.status(201).json({ created, totalTestUsers: countTestUsers() });
});

// DELETE /api/admin/test-users - removes every test player and everything
// hanging off them (skills, Bock, sessions, seats, neighbors, live rows).
adminRouter.delete('/test-users', requireAdmin, (_req, res) => {
  const deleted = deleteTestUsers();
  if (deleted > 0) {
    broadcast(Events.playersChanged, null);
    broadcast(Events.skillsChanged, null);
    broadcast(Events.liveStatusChanged, getLiveBoard());
  }
  res.json({ deleted });
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
