// GET /api/me/todos - Home's "Meine To-Dos" for the signed-in account (see
// myTodos.ts). Read-only; every listed action runs through its own,
// unchanged domain route, so this endpoint adds no new write permission.

import { Router } from 'express';
import { buildMyTodos } from '../myTodos';
import { getOrRepairActiveEvent } from '../eventContext';
import { includesTestEvents } from '../testDataVisibility';

export const myTodosRouter = Router();

myTodosRouter.get('/', (req, res) => {
  const activeEvent = getOrRepairActiveEvent(req.player!.id);
  res.json(
    buildMyTodos({
      groupId: req.group!.id,
      playerId: req.player!.id,
      role: req.groupMembership?.role,
      activeEventId: activeEvent.group_id === req.group!.id ? activeEvent.id : null,
      includeTestEvents: includesTestEvents(req),
    }),
  );
});
