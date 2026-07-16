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

export type SeatingEventId = string | null;

// Reads the stored layout for an event (or the default empty one), dropping
// assignments that no longer make sense: unknown players, out-of-range
// seats, or duplicate seat claims.
export function readLayout(groupId: string, eventId: SeatingEventId, playerIds: Set<string>): SeatingLayout {
  const existing = db.prepare('SELECT * FROM seating_layouts WHERE group_id = ? AND event_id IS ?').get(groupId, eventId) as
    | { group_id: string; event_id: string | null; top_seats: number; right_seats: number; bottom_seats: number; left_seats: number; assignments: string }
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
    ? parsed.flatMap((a): SeatingAssignment[] => {
        if (!a || typeof a !== 'object') return [];
        const value = a as Partial<SeatingAssignment>;
        const count = source[`${value.side}_seats` as keyof typeof source];
        const key = `${value.side}:${value.seat}`;
        if (!SIDES.includes(value.side as Side) || !Number.isInteger(value.seat) || typeof value.seat !== 'number' || value.seat < 0 ||
          typeof count !== 'number' || value.seat >= count || typeof value.playerId !== 'string' || !playerIds.has(value.playerId) || seen.has(key)) return [];
        seen.add(key);
        return [{ side: value.side as Side, seat: value.seat, playerId: value.playerId }];
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
export function syncAutoSeatNeighbors(groupId: string, eventId: SeatingEventId, pairs: Array<[string, string]>): void {
  const newKeys = new Set(pairs.map(([x, y]) => [x, y].sort().join('::')));
  const existingAuto = db
    .prepare("SELECT player_id, neighbor_id FROM seat_neighbors WHERE group_id = ? AND event_id IS ? AND source = 'auto'")
    .all(groupId, eventId) as Array<{ player_id: string; neighbor_id: string }>;
  const remove = db.prepare(
    "DELETE FROM seat_neighbors WHERE group_id = ? AND event_id IS ? AND player_id = ? AND neighbor_id = ? AND source = 'auto'"
  );
  for (const row of existingAuto) {
    const key = [row.player_id, row.neighbor_id].sort().join('::');
    if (!newKeys.has(key)) remove.run(groupId, eventId, row.player_id, row.neighbor_id);
  }
  // INSERT OR IGNORE: if a manual row already claims this direction, leave it
  // as-is rather than downgrading it back to 'auto'.
  const insert = db.prepare(`INSERT OR IGNORE INTO seat_neighbors
    (group_id, event_id, player_id, neighbor_id, player_name_snapshot, neighbor_name_snapshot, source)
    SELECT ?, ?, p.id, n.id, p.name, n.name, 'auto' FROM players p, players n WHERE p.id = ? AND n.id = ?`);
  for (const [x, y] of pairs) {
    insert.run(groupId, eventId, x, y);
    insert.run(groupId, eventId, y, x);
  }
}

// Upserts the layout row and re-derives the auto seat neighbors, in one
// transaction — the single write path shared by the editor's PUT handler and
// the test-user seeding.
export function persistLayout(
  groupId: string,
  eventId: SeatingEventId,
  counts: Record<Side, number>,
  assignments: SeatingAssignment[],
): void {
  const save = db.transaction(() => {
    const names = assignments.length === 0
      ? []
      : db.prepare(`SELECT id, name FROM players WHERE id IN (${assignments.map(() => '?').join(',')})`)
          .all(...assignments.map((assignment) => assignment.playerId)) as Array<{ id: string; name: string }>;
    const nameById = new Map(names.map((player) => [player.id, player.name]));
    const storedAssignments = assignments.map((assignment) => ({
      ...assignment,
      playerNameSnapshot: nameById.get(assignment.playerId) ?? 'Unbekannt',
    }));
    const values = [counts.top, counts.right, counts.bottom, counts.left, JSON.stringify(storedAssignments), Date.now()];
    const updated = db.prepare(`UPDATE seating_layouts SET top_seats = ?, right_seats = ?, bottom_seats = ?,
      left_seats = ?, assignments = ?, updated_at = ? WHERE group_id = ? AND event_id IS ?`)
      .run(...values, groupId, eventId);
    if (updated.changes === 0) {
      db.prepare(`INSERT INTO seating_layouts
        (group_id, event_id, top_seats, right_seats, bottom_seats, left_seats, assignments, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(groupId, eventId, ...values);
    }
    syncAutoSeatNeighbors(groupId, eventId, computeAdjacentPairs(counts, assignments));
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
export function addPlayersToLayout(groupId: string, eventId: SeatingEventId, playerIds: string[]): void {
  const allIds = new Set(
    (db.prepare(`SELECT p.id FROM players p JOIN group_memberships gm ON gm.player_id = p.id
      WHERE gm.group_id = ? AND gm.status = 'active'`).all(groupId) as Array<{ id: string }>).map((r) => r.id)
  );
  const layout = readLayout(groupId, eventId, allIds);
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
  persistLayout(groupId, eventId, counts, assignments);
}

// Drops the given players from every event's layout (used when test users
// are cleaned up) and re-syncs each affected event's auto neighbors.
export function removePlayersFromLayouts(playerIds: Set<string>): void {
  const rows = db.prepare('SELECT group_id, event_id, assignments FROM seating_layouts').all() as Array<{
    group_id: string;
    event_id: string | null;
    assignments: string;
  }>;
  for (const row of rows) {
    const allIds = new Set(
      (db.prepare('SELECT player_id FROM group_memberships WHERE group_id = ?').all(row.group_id) as Array<{ player_id: string }>).map((r) => r.player_id)
    );
    const layout = readLayout(row.group_id, row.event_id, allIds);
    const remaining = layout.assignments.filter((a) => !playerIds.has(a.playerId));
    if (remaining.length === layout.assignments.length) continue;
    persistLayout(row.group_id, row.event_id, layoutCounts(layout), remaining);
  }
}
