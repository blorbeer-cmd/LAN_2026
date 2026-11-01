import { Router } from 'express';
import { BASE_EVENT_ID } from '../db';
import { resolveAccessibleGroupEventScope } from '../groupEventScope';
import { includesTestPlayers, testPlayerIds } from '../testDataVisibility';
import { readResultsFeed } from '../resultsFeed';

export const resultsRouter = Router();
resultsRouter.get('/feed', (req, res) => {
  const scope = resolveAccessibleGroupEventScope(req, res, req.query.eventId);
  if (!scope) return;
  res.setHeader('Cache-Control', 'no-store');
  res.json(
    readResultsFeed(
      req.group!.id,
      scope.eventId ?? BASE_EVENT_ID,
      includesTestPlayers(req) ? new Set() : testPlayerIds(),
    ),
  );
});
