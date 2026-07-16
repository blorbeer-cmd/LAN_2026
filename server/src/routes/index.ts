// Aggregates all feature routers under /api. Feature routers are added here as
// they are built (players, games, skills, live, votes, matches).

import { Router } from 'express';
import { playersRouter } from './players';
import { gamesRouter } from './games';
import { skillsRouter } from './skills';
import { preferencesRouter } from './preferences';
import { liveRouter } from './live';
import { matchmakingRouter } from './matchmaking';
import { votesRouter } from './votes';
import { matchesRouter } from './matches';
import { leaderboardRouter } from './leaderboard';
import { statsRouter } from './stats';
import { analyticsRouter } from './analytics';
import { eventsRouter } from './events';
import { tournamentsRouter } from './tournaments';
import { qrcodeRouter } from './qrcode';
import { exportRouter } from './export';
import { hallOfFameRouter } from './hallOfFame';
import { seatingRouter } from './seating';
import { digestRouter } from './digest';
import { pushRouter } from './push';
import { agentDownloadRouter } from './agentDownload';
import { draftRouter } from './draft';
import { broadcastsRouter } from './broadcasts';
import { infoBoardRouter } from './infoBoard';
import { foodOrdersRouter } from './foodOrders';
import { quizRouter } from './quiz';
import { arcadeRouter } from './arcade';
import { arrivalsRouter } from './arrivals';
import { adminRouter } from './admin';
import { backupRouter } from './backup';
import { authRouter } from './auth';
import { requireConfiguredUser, requireUser } from '../sessions';
import { config } from '../config';
import { extractToken } from '../auth';

export const apiRouter = Router();

// Simple health check, handy for uptime monitoring on the cloud host.
apiRouter.get('/health', (_req, res) => {
  res.json({ ok: true, time: Date.now() });
});

apiRouter.use('/auth', authRouter);

// Once required auth is enabled, every browser-facing feature API is behind
// the verified session. Health and the anonymous auth flows above stay public;
// legacy mode keeps the existing shared-token behavior unchanged.
const KIOSK_GET_PATHS = [
  /^\/live\/?$/,
  /^\/votes\/?$/,
  /^\/leaderboard\/?$/,
  /^\/tournaments(?:\/[^/]+)?\/?$/,
  /^\/food-orders\/?$/,
];

apiRouter.use((req, res, next) => {
  const kioskRead =
    config.authMode === 'required' &&
    req.method === 'GET' &&
    req.header('x-kiosk-mode') === '1' &&
    Boolean(config.kioskToken) &&
    extractToken(req) === config.kioskToken &&
    KIOSK_GET_PATHS.some((pattern) => pattern.test(req.path));
  if (kioskRead) return next();
  requireConfiguredUser(req, res, next);
});

// GET /api/me - the logged-in account, per the real per-user login system
// (see docs/KONZEPT-USER-MANAGEMENT.md).
apiRouter.get('/me', requireUser, (req, res) => {
  const p = req.player!;
  res.json({
    id: p.id,
    name: p.name,
    color: p.color,
    avatar: p.avatar,
    isAdmin: Boolean(p.is_admin),
    isTest: Boolean(p.is_test),
  });
});

apiRouter.use('/players', playersRouter);
apiRouter.use('/games', gamesRouter);
apiRouter.use('/skills', skillsRouter);
apiRouter.use('/preferences', preferencesRouter);
apiRouter.use('/live', liveRouter);
apiRouter.use('/matchmaking', matchmakingRouter);
apiRouter.use('/votes', votesRouter);
apiRouter.use('/matches', matchesRouter);
apiRouter.use('/leaderboard', leaderboardRouter);
apiRouter.use('/stats', statsRouter);
apiRouter.use('/analytics', analyticsRouter);
apiRouter.use('/events', eventsRouter);
apiRouter.use('/tournaments', tournamentsRouter);
apiRouter.use('/qrcode', qrcodeRouter);
apiRouter.use('/export', exportRouter);
apiRouter.use('/hall-of-fame', hallOfFameRouter);
apiRouter.use('/seating', seatingRouter);
apiRouter.use('/digest', digestRouter);
apiRouter.use('/push', pushRouter);
apiRouter.use('/agent-download', agentDownloadRouter);
apiRouter.use('/draft', draftRouter);
apiRouter.use('/broadcasts', broadcastsRouter);
apiRouter.use('/info', infoBoardRouter);
apiRouter.use('/food-orders', foodOrdersRouter);
apiRouter.use('/quiz', quizRouter);
apiRouter.use('/arcade', arcadeRouter);
apiRouter.use('/arrivals', arrivalsRouter);
apiRouter.use('/admin', adminRouter);
apiRouter.use('/backup', backupRouter);
