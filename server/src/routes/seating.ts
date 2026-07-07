// Seating overview (FR-18 extension, participant-facing): everyone's
// self-declared "who sits next to me" (see players.ts's /:id/neighbors)
// turned into a shared picture — grouped into connected "Sitzgruppen"
// (physical clusters), rather than each player only seeing their own list.

import { Router } from 'express';
import { db } from '../db';
import { getActiveEventId } from '../events';

export const seatingRouter = Router();

interface PlayerRow {
  id: string;
  name: string;
  color: string;
  avatar: string | null;
}

// GET /api/seating - the active event's (or an explicit ?eventId=) seating
// picture: deduped pairs, players grouped into connected clusters, and
// whoever hasn't declared any neighbor at all.
seatingRouter.get('/', (req, res) => {
  const { eventId } = req.query;
  const filterEventId = typeof eventId === 'string' && eventId ? eventId : getActiveEventId();

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
