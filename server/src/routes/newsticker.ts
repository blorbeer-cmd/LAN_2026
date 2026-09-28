import { Router } from 'express';
import { BASE_EVENT_ID } from '../db';
import { getNewstickerFeed } from '../newsticker';

export const newstickerRouter = Router();

// GET /api/newsticker - the Broadcast screen's playful headline feed. Only
// the event-scoped Broadcast credential reads it: the feed exists for the
// shared screen, and its scope comes from that token alone.
newstickerRouter.get('/', (req, res) => {
  const scope = req.kioskScope;
  if (!scope) return res.status(403).json({ error: 'Der Newsticker ist nur im Broadcast verfügbar.' });
  res.json(getNewstickerFeed(scope.groupId, scope.eventId ?? BASE_EVENT_ID));
});
