// Seating overview (FR-18 extension, participant-facing): everyone's
// self-declared "who sits next to me" (see players.ts's /:id/neighbors)
// turned into a shared picture — grouped into connected "Sitzgruppen"
// (physical clusters), rather than each player only seeing their own list.

import { Router } from 'express';
import { db } from '../db';
import { getTrackingEventId } from '../events';

export const seatingRouter = Router();

interface PlayerRow {
  id: string;
  name: string;
  color: string;
  avatar: string | null;
}

const SIDES = ['top', 'right', 'bottom', 'left'] as const;
type Side = (typeof SIDES)[number];
const DEFAULT_SEATS = 2;
const MAX_SEATS_PER_SIDE = 12;

interface SeatingAssignment {
  side: Side;
  seat: number;
  playerId: string;
}

function readLayout(eventId: string, players: PlayerRow[]) {
  const existing = db.prepare('SELECT * FROM seating_layouts WHERE event_id = ?').get(eventId) as
    | { event_id: string; top_seats: number; right_seats: number; bottom_seats: number; left_seats: number; assignments: string }
    | undefined;
  const source = existing ?? {
    event_id: eventId,
    top_seats: DEFAULT_SEATS,
    right_seats: DEFAULT_SEATS,
    bottom_seats: DEFAULT_SEATS,
    left_seats: DEFAULT_SEATS,
    assignments: '[]',
  };
  const playerIds = new Set(players.map((p) => p.id));
  const seen = new Set<string>();
  let parsed: unknown = [];
  try { parsed = JSON.parse(source.assignments); } catch { /* use empty layout */ }
  const assignments = Array.isArray(parsed)
    ? parsed.filter((a): a is SeatingAssignment => {
        if (!a || typeof a !== 'object') return false;
        const value = a as Partial<SeatingAssignment>;
        const count = source[`${value.side}_seats` as keyof typeof source];
        const key = `${value.side}:${value.seat}`;
        if (!SIDES.includes(value.side as Side) || !Number.isInteger(value.seat) || typeof value.seat !== 'number' || value.seat < 0 ||
          typeof count !== 'number' || value.seat >= count || typeof value.playerId !== 'string' || !playerIds.has(value.playerId) || seen.has(key)) return false;
        seen.add(key);
        return true;
      })
    : [];
  return {
    topSeats: source.top_seats,
    rightSeats: source.right_seats,
    bottomSeats: source.bottom_seats,
    leftSeats: source.left_seats,
    assignments,
  };
}

function getPlayers(): PlayerRow[] {
  return db.prepare('SELECT id, name, color, avatar FROM players ORDER BY name COLLATE NOCASE').all() as PlayerRow[];
}

function getLayoutResponse(eventId: string) {
  const players = getPlayers();
  return { eventId, players, layout: readLayout(eventId, players) };
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
  db.prepare(`INSERT INTO seating_layouts (event_id, top_seats, right_seats, bottom_seats, left_seats, assignments, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(event_id) DO UPDATE SET top_seats=excluded.top_seats,
    right_seats=excluded.right_seats, bottom_seats=excluded.bottom_seats, left_seats=excluded.left_seats,
    assignments=excluded.assignments, updated_at=excluded.updated_at`).run(
    eventId, counts.top, counts.right, counts.bottom, counts.left, JSON.stringify(validAssignments), Date.now()
  );
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

  const players = db.prepare('SELECT id, name, color, avatar FROM players').all() as PlayerRow[];
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
