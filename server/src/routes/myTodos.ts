// GET /api/me/todos - Home's "Meine To-Dos" for the signed-in account (see
// myTodos.ts). Read-only; every listed action runs through its own,
// unchanged domain route, so this endpoint adds no new write permission.

import { Router } from 'express';
import { buildMyTodos } from '../myTodos';
import { resolveRequestGroupEventScope } from '../groupEventScope';
import { includesTestEvents } from '../testDataVisibility';

export const myTodosRouter = Router();

myTodosRouter.get('/', (req, res) => {
  // The workspace this request actually sees, with the same visible fallback
  // as /api/votes and /api/me/active-event: a stored but now hidden test
  // event resolves to the base event, so "Du hast noch nicht abgestimmt"
  // describes the rounds that are on screen.
  const scope = resolveRequestGroupEventScope(req, undefined);
  res.json(
    buildMyTodos({
      groupId: req.group!.id,
      playerId: req.player!.id,
      role: req.groupMembership?.role,
      activeEventId: scope.ok ? scope.eventId : null,
      includeTestEvents: includesTestEvents(req),
    }),
  );
});
