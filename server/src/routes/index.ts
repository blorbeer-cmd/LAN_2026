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
import { pingsRouter } from './pings';
import { digestRouter } from './digest';
import { pushRouter } from './push';
import { agentDownloadRouter } from './agentDownload';

export const apiRouter = Router();

// Simple health check, handy for uptime monitoring on the cloud host.
apiRouter.get('/health', (_req, res) => {
  res.json({ ok: true, time: Date.now() });
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
apiRouter.use('/pings', pingsRouter);
apiRouter.use('/digest', digestRouter);
apiRouter.use('/push', pushRouter);
apiRouter.use('/agent-download', agentDownloadRouter);
