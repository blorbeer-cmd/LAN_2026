// Admin unlock: a device becomes "admin" by proving it knows the admin PIN
// (config.adminPin). Empty PIN = open/dev mode, so unlocking always succeeds
// and local testing needs no secret. Kept deliberately light — this is the
// minimal moderation role (bulk-create test users, grant admin, edit/delete
// everywhere), not a full per-user auth system. The actual admin-only writes
// (e.g. granting admin) live on the players router and can be gated with
// requireAdmin; this router just hands the client its admin ticket.

import { Router } from 'express';
import { adminUnlockValid, adminPinRequired } from '../auth';

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
