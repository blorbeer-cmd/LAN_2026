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
import { eventDatePollsRouter } from './eventDatePolls';
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
import { checklistRouter } from './checklist';
import { quizRouter } from './quiz';
import { arcadeRouter } from './arcade';
import { arrivalsRouter } from './arrivals';
import { adminRouter } from './admin';
import { backupRouter } from './backup';
import { authRouter } from './auth';
import { groupsRouter } from './groups';
import { pingsRouter } from './pings';
import { musicRouter } from './music';
import { musicControllerRouter } from '../musicController';
import { onboardingRouter } from './onboarding';
import { feedbackRouter } from './feedback';
import { requireUser } from '../sessions';
import { config } from '../config';
import { extractToken } from '../auth';
import { requireConfiguredGroupMembership } from '../groupAuthorization';
import { getGroup } from '../groups';
import { BASE_EVENT_ID, DEFAULT_GROUP_ID } from '../db';
import { resolveKioskToken } from '../kioskTokens';
import { getOrRepairActiveEvent, setActiveEventForPlayer, type EventContextEvent } from '../eventContext';
import { broadcast, Events, switchPlayerEventScope } from '../realtime';
import { clearPlayerLiveStatus, getLiveBoard } from '../liveStatus';

export const apiRouter = Router();

// Simple health check, handy for uptime monitoring on the cloud host.
apiRouter.get('/health', (_req, res) => {
  res.json({ ok: true, time: Date.now() });
});

apiRouter.use('/auth', authRouter);

// The dedicated playback device is intentionally not a Respawn player. It
// authenticates with its own paired controller token and therefore reaches
// only this narrow command channel before browser/user authentication.
apiRouter.use('/music/controller', musicControllerRouter);

// Every browser-facing feature API is behind the verified session. Health and
// the anonymous auth flows above stay public.
const KIOSK_GET_PATHS = [
  /^\/live\/?$/,
  /^\/votes\/?$/,
  /^\/votes\/kiosk\/?$/,
  /^\/leaderboard\/?$/,
  /^\/tournaments(?:\/[^/]+)?\/?$/,
  /^\/food-orders\/?$/,
  /^\/music\/kiosk\/?$/,
  // The dashboard loads the latest group-wide banner alongside the other
  // read-only views; without this a token-only kiosk 401s on the whole
  // Promise.all refresh. getLastPushLogEntry only returns 'all'-audience
  // entries, so no personal push content is exposed.
  /^\/push\/last\/?$/,
];

apiRouter.use((req, res, next) => {
  const kioskRead =
    req.method === 'GET' &&
    req.header('x-kiosk-mode') === '1' &&
    Boolean(config.kioskToken || resolveKioskToken(extractToken(req))) &&
    (extractToken(req) === config.kioskToken || Boolean(resolveKioskToken(extractToken(req)))) &&
    KIOSK_GET_PATHS.some((pattern) => pattern.test(req.path));
  if (kioskRead) {
    const tokenScope = resolveKioskToken(extractToken(req));
    const groupId = tokenScope?.groupId ?? DEFAULT_GROUP_ID;
    const requestedGroup = req.headers['x-group-id'];
    if (tokenScope && typeof requestedGroup === 'string' && requestedGroup !== groupId) {
      return res.status(404).json({ error: 'Kiosk-Token ist für diese Gruppe nicht freigegeben.' });
    }
    // resolveKioskToken already rejects a DB token whose group is archived;
    // the installation-wide env token has no such row, so re-check the
    // resolved group here — otherwise an env-token kiosk keeps reading an
    // archived group's data long after the socket path stopped delivering it.
    const group = getGroup(groupId);
    if (!group || group.archived_at !== null) {
      return res.status(404).json({ error: 'Kiosk-Gruppe ist nicht verfügbar.' });
    }
    const kioskEventId = tokenScope?.eventId ?? BASE_EVENT_ID;
    req.query.eventId = kioskEventId;
    req.group = group;
    req.kioskScope = { groupId, eventId: kioskEventId };
    return next();
  }
  requireUser(req, res, next);
});

// Resolves req.group for every feature route below (the group-scoped data
// added in Phase 5c reads it directly), skipping re-resolution when the
// kiosk branch above already set it.
apiRouter.use((req, res, next) => {
  if (req.group) return next();
  requireConfiguredGroupMembership(req, res, next);
});

// GET /api/me - the logged-in account, per the real per-user login system
// (see docs/KONZEPT-USER-MANAGEMENT.md).
function serializeActiveEvent(event: EventContextEvent) {
  return {
    id: event.id,
    name: event.name,
    startsAt: event.starts_at,
    endsAt: event.ends_at,
    status: event.status,
    isBase: event.id === BASE_EVENT_ID,
  };
}

apiRouter.get('/me', requireUser, (req, res) => {
  const p = req.player!;
  const activeEvent = getOrRepairActiveEvent(p.id);
  res.json({
    id: p.id,
    name: p.name,
    color: p.color,
    avatar: p.avatar,
    isAdmin: Boolean(p.is_admin),
    isTest: Boolean(p.is_test),
    activeEventId: activeEvent.id,
  });
});

// The selected workspace is account-wide rather than tab-local. Switching is
// allowed only to published events the account has accepted.
apiRouter.get('/me/active-event', requireUser, (req, res) => {
  res.json(serializeActiveEvent(getOrRepairActiveEvent(req.player!.id)));
});

apiRouter.put('/me/active-event', requireUser, (req, res) => {
  const { eventId } = req.body ?? {};
  if (typeof eventId !== 'string' || !eventId) {
    return res.status(400).json({ error: 'eventId ist erforderlich.' });
  }
  const previousEvent = getOrRepairActiveEvent(req.player!.id);
  const event = setActiveEventForPlayer(req.player!.id, eventId);
  if (!event) return res.status(404).json({ error: 'Event nicht gefunden oder nicht freigegeben.' });
  if (previousEvent.id !== event.id) {
    clearPlayerLiveStatus(req.player!.id, Date.now(), previousEvent.id);
    if (previousEvent.group_id) {
      broadcast(Events.liveStatusChanged, getLiveBoard(previousEvent.group_id, previousEvent.id), {
        groupId: previousEvent.group_id,
        eventId: previousEvent.id,
      });
    }
  }
  switchPlayerEventScope(req.player!.id, event.group_id!, event.id);
  return res.json(serializeActiveEvent(event));
});

apiRouter.use('/me/onboarding', onboardingRouter);
apiRouter.use('/feedback', feedbackRouter);

apiRouter.use('/groups', groupsRouter);

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
apiRouter.use('/events/:eventId/date-polls', eventDatePollsRouter);
apiRouter.use('/events/:eventId/polls', eventDatePollsRouter);
apiRouter.use('/tournaments', tournamentsRouter);
apiRouter.use('/qrcode', qrcodeRouter);
apiRouter.use('/export', exportRouter);
apiRouter.use('/hall-of-fame', hallOfFameRouter);
apiRouter.use('/seating', seatingRouter);
apiRouter.use('/pings', pingsRouter);
apiRouter.use('/digest', digestRouter);
apiRouter.use('/push', pushRouter);
apiRouter.use('/agent-download', agentDownloadRouter);
apiRouter.use('/draft', draftRouter);
apiRouter.use('/broadcasts', broadcastsRouter);
apiRouter.use('/info', infoBoardRouter);
apiRouter.use('/food-orders', foodOrdersRouter);
apiRouter.use('/checklist', checklistRouter);
apiRouter.use('/quiz', quizRouter);
apiRouter.use('/arcade', arcadeRouter);
apiRouter.use('/arrivals', arrivalsRouter);
apiRouter.use('/admin', adminRouter);
apiRouter.use('/backup', backupRouter);
apiRouter.use('/music', musicRouter);
