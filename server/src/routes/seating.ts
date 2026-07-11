// Seating overview (FR-18 extension, participant-facing): everyone's
// self-declared "who sits next to me" (see players.ts's /:id/neighbors)
// turned into a shared picture — grouped into connected "Sitzgruppen"
// (physical clusters), rather than each player only seeing their own list.
// The layout/adjacency core lives in ../seatingLayout.ts, shared with the
// admin test-user seeding.

import { Router } from 'express';
import { db } from '../db';
import { getTrackingEventId } from '../events';
import {
  SIDES,
  type Side,
  MAX_SEATS_PER_SIDE,
  type SeatingAssignment,
  readLayout,
  persistLayout,
} from '../seatingLayout';

export const seatingRouter = Router();

interface PlayerRow {
  id: string;
  name: string;
  real_name: string | null;
  color: string;
  avatar: string | null;
  is_test: number;
}

function getPlayers(): PlayerRow[] {
  return db
    .prepare('SELECT id, name, real_name, color, avatar, is_test FROM players ORDER BY name COLLATE NOCASE')
    .all() as PlayerRow[];
}

function getLayoutResponse(eventId: string) {
  const players = getPlayers();
  return { eventId, players, layout: readLayout(eventId, new Set(players.map((p) => p.id))) };
}

// GET /api/seating/layout - the editable shared table plan.
seatingRouter.get('/layout', (req, res) => {
  const eventId = typeof req.query.eventId === 'string' && req.query.eventId ? req.query.eventId : getTrackingEventId();
  res.json(getLayoutResponse(eventId));
});

// PUT /api/seating/layout - open to all participants for now; the feature may
// later be gated behind the admin guard without changing the client contract.
seatingRouter.put('/layout', (req, res) => {
  const eventId = typeof req.body?.eventId === 'string' && req.body.eventId ? req.body.eventId : getTrackingEventId();
  const body = req.body ?? {};
  const sideNames = { top: 'topSeats', right: 'rightSeats', bottom: 'bottomSeats', left: 'leftSeats' } as const;
  const counts = Object.fromEntries(SIDES.map((side) => [side, body[sideNames[side]]])) as Record<Side, unknown>;
  if (SIDES.some((side) => !Number.isInteger(counts[side]) || (counts[side] as number) < 0 || (counts[side] as number) > MAX_SEATS_PER_SIDE)) {
    return res.status(400).json({ error: `Jede Tischseite muss zwischen 0 und ${MAX_SEATS_PER_SIDE} Plätze haben.` });
  }
  const players = getPlayers();
  const playerIds = new Set(players.map((p) => p.id));
  const assignments = Array.isArray(body.assignments) ? body.assignments : [];
  const seenSeats = new Set<string>();
  const seenPlayers = new Set<string>();
  const validAssignments: SeatingAssignment[] = [];
  for (const assignment of assignments) {
    const side = assignment?.side as Side;
    const sideCount = counts[side] as number;
    if (!assignment || !SIDES.includes(side) || !Number.isInteger(assignment.seat) ||
      assignment.seat < 0 || assignment.seat >= sideCount || !playerIds.has(assignment.playerId)) continue;
    const seatKey = `${side}:${assignment.seat}`;
    if (seenSeats.has(seatKey) || seenPlayers.has(assignment.playerId)) continue;
    seenSeats.add(seatKey);
    seenPlayers.add(assignment.playerId);
    validAssignments.push({ side, seat: assignment.seat, playerId: assignment.playerId });
  }
  // A non-admin client never sees test players (they're filtered client-side,
  // see public/js/testFilter.js), so its layout snapshot is missing their
  // assignments — a plain replace would silently unseat every test user on
  // any normal save. Carry their stored seats over unless the request comes
  // from a device in admin mode, which does see (and may deliberately move
  // or remove) them.
  if (req.header('x-admin-mode') !== '1') {
    const testIds = new Set(
      (db.prepare('SELECT id FROM players WHERE is_test = 1').all() as Array<{ id: string }>).map((r) => r.id)
    );
    const stored = readLayout(eventId, playerIds);
    for (const assignment of stored.assignments) {
      if (!testIds.has(assignment.playerId)) continue;
      if (seenPlayers.has(assignment.playerId)) continue;
      if (assignment.seat >= (counts[assignment.side] as number)) continue; // side shrank
      const seatKey = `${assignment.side}:${assignment.seat}`;
      if (seenSeats.has(seatKey)) continue; // a real player took the seat
      seenSeats.add(seatKey);
      seenPlayers.add(assignment.playerId);
      validAssignments.push(assignment);
    }
  }
  persistLayout(eventId, counts as Record<Side, number>, validAssignments);
  res.json(getLayoutResponse(eventId));
});

// GET /api/seating - the active event's (or an explicit ?eventId=) seating
// picture: deduped pairs, players grouped into connected clusters, and
// whoever hasn't declared any neighbor at all.
seatingRouter.get('/', (req, res) => {
  const { eventId } = req.query;
  const filterEventId = typeof eventId === 'string' && eventId ? eventId : getTrackingEventId();

  const pairRows = db
    .prepare('SELECT player_id, neighbor_id FROM seat_neighbors WHERE event_id = ?')
    .all(filterEventId) as Array<{ player_id: string; neighbor_id: string }>;

  const players = db.prepare('SELECT id, name, color, avatar, is_test FROM players').all() as PlayerRow[];
  const playerById = new Map(players.map((p) => [p.id, p]));

  // Neighbors are declared per-direction (A says B, independent of whether
  // B has said A) — dedupe into one undirected pair for display, same
  // convention as the matchmaking seat-conflict lookup.
  const seen = new Set<string>();
  const pairs: Array<{ playerAId: string; playerAName: string; playerBId: string; playerBName: string }> = [];
  const adjacency = new Map<string, Set<string>>();

  const addEdge = (a: string, b: string) => {
    if (!adjacency.has(a)) adjacency.set(a, new Set());
    if (!adjacency.has(b)) adjacency.set(b, new Set());
    adjacency.get(a)!.add(b);
    adjacency.get(b)!.add(a);
  };

  for (const r of pairRows) {
    if (!playerById.has(r.player_id) || !playerById.has(r.neighbor_id)) continue; // stale/deleted player
    const key = [r.player_id, r.neighbor_id].sort().join('::');
    if (seen.has(key)) continue;
    seen.add(key);
    pairs.push({
      playerAId: r.player_id,
      playerAName: playerById.get(r.player_id)!.name,
      playerBId: r.neighbor_id,
      playerBName: playerById.get(r.neighbor_id)!.name,
    });
    addEdge(r.player_id, r.neighbor_id);
  }

  // Connected components ("Sitzgruppen") via plain BFS — the graph is tiny
  // at LAN-party scale, no need for anything fancier.
  const visited = new Set<string>();
  const groups: PlayerRow[][] = [];
  for (const id of adjacency.keys()) {
    if (visited.has(id)) continue;
    const queue = [id];
    const componentIds: string[] = [];
    visited.add(id);
    while (queue.length > 0) {
      const current = queue.shift()!;
      componentIds.push(current);
      for (const neighbor of adjacency.get(current) ?? []) {
        if (!visited.has(neighbor)) {
          visited.add(neighbor);
          queue.push(neighbor);
        }
      }
    }
    groups.push(
      componentIds
        .map((pid) => playerById.get(pid)!)
        .sort((a, b) => a.name.localeCompare(b.name, 'de'))
    );
  }
  groups.sort((a, b) => b.length - a.length);

  const unplacedPlayers = players.filter((p) => !visited.has(p.id));

  res.json({ eventId: filterEventId, groups, unplacedPlayers, pairs });
});
