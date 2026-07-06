// Aggregates all feature routers under /api. Feature routers are added here as
// they are built (players, games, skills, live, votes, matches).

import { Router } from 'express';

export const apiRouter = Router();

// Simple health check, handy for uptime monitoring on the cloud host.
apiRouter.get('/health', (_req, res) => {
  res.json({ ok: true, time: Date.now() });
});
