import { Router } from 'express';
import { BASE_EVENT_ID } from '../db';
import { resolveAccessibleGroupEventScope } from '../groupEventScope';
import { getNewstickerFeed } from '../newsticker';

export const newstickerRouter = Router();

// GET /api/newsticker - the Broadcast screen's playful headline feed. The
// event is resolved like every other Broadcast card: the Broadcast token's
// own event, or, when the screen runs on a signed-in account instead, that
// account's active event (participation is still required).
newstickerRouter.get('/', (req, res) => {
  const scope = resolveAccessibleGroupEventScope(req, res, req.query.eventId);
  if (!scope) return;
  res.json(getNewstickerFeed(req.group!.id, scope.eventId ?? BASE_EVENT_ID));
});
