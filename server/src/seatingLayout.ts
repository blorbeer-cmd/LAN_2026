// Core logic of the shared table plan (seating_layouts): reading/validating
// the stored layout, persisting it, and deriving "Sichtbare Monitore"
// (seat_neighbors, source='auto') from same-edge adjacency. Lives outside
// routes/seating.ts so the admin test-user seeding (testUsers.ts) can place
// players and keep neighbors in sync through the exact same code path as the
// interactive editor.

import { db } from './db';

export const SIDES = ['top', 'right', 'bottom', 'left'] as const;
export type Side = (typeof SIDES)[number];
export const DEFAULT_SEATS = 2;
export const MAX_SEATS_PER_SIDE = 12;

export interface SeatingAssignment {
  side: Side;
  seat: number;
  playerId: string;
}

export interface SeatingLayout {
  topSeats: number;
  rightSeats: number;
  bottomSeats: number;
  leftSeats: number;
  assignments: SeatingAssignment[];
}

// Reads the stored layout for an event (or the default empty one), dropping
// assignments that no longer make sense: unknown players, out-of-range
// seats, or duplicate seat claims.
export function readLayout(eventId: string, playerIds: Set<string>): SeatingLayout {
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

// Pairs of players seated right next to each other along the same table edge
// (adjacent seat indices on the same side). Corner pairs — last seat of one
// side next to the first seat of the next — are deliberately excluded: you
// normally can't see a corner neighbor's monitor the way you can see a
// same-edge neighbor's, so they shouldn't be auto-declared as visible.
export function computeAdjacentPairs(counts: Record<Side, number>, assignments: SeatingAssignment[]): Array<[string, string]> {
  const pairs: Array<[string, string]> = [];
  for (const side of SIDES) {
    const bySeat = new Map<number, string>();
    for (const a of assignments) if (a.side === side) bySeat.set(a.seat, a.playerId);
    for (let seat = 0; seat < counts[side] - 1; seat++) {
      const playerA = bySeat.get(seat);
      const playerB = bySeat.get(seat + 1);
      if (playerA && playerB) pairs.push([playerA, playerB]);
    }
  }
  return pairs;
}

// Keeps seat_neighbors in sync with the table plan: every pair seated next to
// each other along an edge gets an 'auto' row in both directions (so it shows
// up in either player's own "Sichtbare Monitore" checklist). Only ever
// touches rows this function itself created — a player who has manually
// confirmed or added to their own list (source = 'manual', see players.ts's
// PUT /:id/neighbors) keeps that choice even if the table plan changes later.
export function syncAutoSeatNeighbors(eventId: string, pairs: Array<[string, string]>): void {
  const newKeys = new Set(pairs.map(([x, y]) => [x, y].sort().join('::')));
  const existingAuto = db
    .prepare("SELECT player_id, neighbor_id FROM seat_neighbors WHERE event_id = ? AND source = 'auto'")
    .all(eventId) as Array<{ player_id: string; neighbor_id: string }>;
  const remove = db.prepare(
    "DELETE FROM seat_neighbors WHERE event_id = ? AND player_id = ? AND neighbor_id = ? AND source = 'auto'"
  );
  for (const row of existingAuto) {
    const key = [row.player_id, row.neighbor_id].sort().join('::');
    if (!newKeys.has(key)) remove.run(eventId, row.player_id, row.neighbor_id);
  }
  // INSERT OR IGNORE: if a manual row already claims this direction, leave it
  // as-is rather than downgrading it back to 'auto'.
  const insert = db.prepare(
    "INSERT OR IGNORE INTO seat_neighbors (event_id, player_id, neighbor_id, source) VALUES (?, ?, ?, 'auto')"
  );
  for (const [x, y] of pairs) {
    insert.run(eventId, x, y);
    insert.run(eventId, y, x);
  }
}

// Upserts the layout row and re-derives the auto seat neighbors, in one
// transaction — the single write path shared by the editor's PUT handler and
// the test-user seeding.
export function persistLayout(eventId: string, counts: Record<Side, number>, assignments: SeatingAssignment[]): void {
  const save = db.transaction(() => {
    db.prepare(`INSERT INTO seating_layouts (event_id, top_seats, right_seats, bottom_seats, left_seats, assignments, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(event_id) DO UPDATE SET top_seats=excluded.top_seats,
      right_seats=excluded.right_seats, bottom_seats=excluded.bottom_seats, left_seats=excluded.left_seats,
      assignments=excluded.assignments, updated_at=excluded.updated_at`).run(
      eventId, counts.top, counts.right, counts.bottom, counts.left, JSON.stringify(assignments), Date.now()
    );
    syncAutoSeatNeighbors(eventId, computeAdjacentPairs(counts, assignments));
  });
  save();
}

function layoutCounts(layout: SeatingLayout): Record<Side, number> {
  return { top: layout.topSeats, right: layout.rightSeats, bottom: layout.bottomSeats, left: layout.leftSeats };
}

// Places the given (not yet seated) players onto free seats of an event's
// layout, preferring consecutive seats along an edge so adjacency — and with
// it "Sichtbare Monitore" — actually comes out of it. If the table is full,
// sides grow up to MAX_SEATS_PER_SIDE before anyone stays unplaced.
export function addPlayersToLayout(eventId: string, playerIds: string[]): void {
  const allIds = new Set(
    (db.prepare('SELECT id FROM players').all() as Array<{ id: string }>).map((r) => r.id)
  );
  const layout = readLayout(eventId, allIds);
  const counts = layoutCounts(layout);
  const assignments = [...layout.assignments];
  const alreadyPlaced = new Set(assignments.map((a) => a.playerId));
  const takenSeats = new Set(assignments.map((a) => `${a.side}:${a.seat}`));
  const queue = playerIds.filter((id) => allIds.has(id) && !alreadyPlaced.has(id));

  for (const side of SIDES) {
    for (let seat = 0; seat < counts[side] && queue.length > 0; seat++) {
      const key = `${side}:${seat}`;
      if (takenSeats.has(key)) continue;
      assignments.push({ side, seat, playerId: queue.shift()! });
      takenSeats.add(key);
    }
  }
  while (queue.length > 0) {
    const growable = SIDES.filter((s) => counts[s] < MAX_SEATS_PER_SIDE)
      .sort((a, b) => counts[a] - counts[b])[0];
    if (!growable) break; // table maxed out — the rest stays unplaced
    assignments.push({ side: growable, seat: counts[growable], playerId: queue.shift()! });
    counts[growable]++;
  }
  persistLayout(eventId, counts, assignments);
}

// Drops the given players from every event's layout (used when test users
// are cleaned up) and re-syncs each affected event's auto neighbors.
export function removePlayersFromLayouts(playerIds: Set<string>): void {
  const rows = db.prepare('SELECT event_id, assignments FROM seating_layouts').all() as Array<{
    event_id: string;
    assignments: string;
  }>;
  const allIds = new Set(
    (db.prepare('SELECT id FROM players').all() as Array<{ id: string }>).map((r) => r.id)
  );
  for (const row of rows) {
    const layout = readLayout(row.event_id, allIds);
    const remaining = layout.assignments.filter((a) => !playerIds.has(a.playerId));
    if (remaining.length === layout.assignments.length) continue;
    persistLayout(row.event_id, layoutCounts(layout), remaining);
  }
}
