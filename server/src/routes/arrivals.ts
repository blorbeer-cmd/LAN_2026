// An-/Abreise + Fahrgemeinschaften: everyone maintains their own arrival and
// departure times for the current event, and can create/join lightweight
// carpool groups for either direction.

import { Router } from 'express';
import { nanoid } from 'nanoid';
import { db, OUTSIDE_EVENTS_ID } from '../db';
import { resolveGroupEventStorageId } from '../groupEventScope';
import { broadcast, Events } from '../realtime';
import { isNonEmptyString } from '../validation';
import { withBodyPlayerIdentity } from '../sessions';

export const arrivalsRouter = Router();

const MAX_NOTE_LENGTH = 240;
const MAX_LABEL_LENGTH = 120;
const MAX_LOCATION_LENGTH = 120;
const MIN_SEATS = 1;
const MAX_SEATS = 8;
const DEFAULT_SEATS = 3;
const DIRECTIONS = new Set(['arrival', 'departure']);

interface ArrivalRow {
  event_id: string;
  player_id: string;
  playerName: string;
  playerColor: string;
  playerAvatar: string | null;
  arrival_at: number | null;
  departure_at: number | null;
  note: string | null;
  updated_at: number;
}

interface CarpoolRow {
  id: string;
  event_id: string;
  group_id: string;
  direction: 'arrival' | 'departure';
  label: string;
  start_at: number | null;
  start_location: string | null;
  eta_at: number | null;
  seats_total: number;
  created_by: string;
  createdByName: string;
  created_at: number;
}

function parseOptionalTimestamp(value: unknown, label: string): number | null | { error: string } {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return { error: `${label} muss ein Zeitstempel (ms) sein.` };
  }
  return value;
}

function parseOptionalNote(value: unknown): string | null | { error: string } {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || value.trim().length > MAX_NOTE_LENGTH) {
    return { error: `Notiz darf höchstens ${MAX_NOTE_LENGTH} Zeichen lang sein.` };
  }
  return value.trim();
}

function playerExists(playerId: string): boolean {
  return Boolean(db.prepare('SELECT 1 FROM players WHERE id = ?').get(playerId));
}

function parseOptionalLocation(value: unknown): string | null | { error: string } {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || value.trim().length > MAX_LOCATION_LENGTH) {
    return { error: `Startort darf höchstens ${MAX_LOCATION_LENGTH} Zeichen lang sein.` };
  }
  return value.trim();
}

function parseSeatsTotal(value: unknown): number | { error: string } {
  if (value === undefined || value === null || value === '') return DEFAULT_SEATS;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < MIN_SEATS || value > MAX_SEATS) {
    return { error: `Plätze müssen zwischen ${MIN_SEATS} und ${MAX_SEATS} liegen.` };
  }
  return value;
}

// Passenger seats already taken - the driver (created_by) always occupies a
// carpool_members row but doesn't count against their own seat offer.
function seatsTaken(carpoolId: string, createdBy: string): number {
  return (
    db.prepare('SELECT COUNT(*) AS n FROM carpool_members WHERE carpool_id = ? AND player_id != ?').get(carpoolId, createdBy) as {
      n: number;
    }
  ).n;
}

function serializeCarpool(row: CarpoolRow) {
  const members = db
    .prepare(
      `SELECT p.id, p.name, p.color, p.avatar
       FROM carpool_members cm JOIN players p ON p.id = cm.player_id
       WHERE cm.carpool_id = ? ORDER BY (p.id != ?) ASC, p.name COLLATE NOCASE`
    )
    .all(row.id, row.created_by);
  return {
    id: row.id,
    direction: row.direction,
    label: row.label,
    startAt: row.start_at,
    startLocation: row.start_location,
    etaAt: row.eta_at,
    seatsTotal: row.seats_total,
    seatsFree: Math.max(0, row.seats_total - seatsTaken(row.id, row.created_by)),
    driverId: row.created_by,
    createdBy: row.created_by,
    createdByName: row.createdByName,
    createdAt: row.created_at,
    members,
  };
}

function deliveryEventId(eventId: string): string | null {
  return eventId === OUTSIDE_EVENTS_ID ? null : eventId;
}

function buildList(groupId: string) {
  const eventId = resolveGroupEventStorageId(groupId);
  if (!eventId) {
    return {
      eventId: null,
      arrivals: [] as ArrivalRow[],
      carpools: {
        arrival: [] as ReturnType<typeof serializeCarpool>[],
        departure: [] as ReturnType<typeof serializeCarpool>[],
      },
    };
  }
  const arrivals = db
    .prepare(
      `SELECT a.event_id, a.player_id, p.name AS playerName, p.color AS playerColor, p.avatar AS playerAvatar,
              a.arrival_at, a.departure_at, a.note, a.updated_at
       FROM arrivals a JOIN players p ON p.id = a.player_id
       WHERE a.event_id = ?
       ORDER BY COALESCE(a.arrival_at, a.departure_at, a.updated_at), p.name COLLATE NOCASE`
    )
    .all(eventId) as ArrivalRow[];

  const rows = db
    .prepare(
      `SELECT c.*, e.group_id, p.name AS createdByName
       FROM carpools c
       JOIN events e ON e.id = c.event_id
       JOIN players p ON p.id = c.created_by
       WHERE c.event_id = ? AND e.group_id = ?
       ORDER BY c.created_at DESC`
    )
    .all(eventId, groupId) as CarpoolRow[];

  const carpools = { arrival: [] as ReturnType<typeof serializeCarpool>[], departure: [] as ReturnType<typeof serializeCarpool>[] };
  for (const row of rows) {
    if (row.direction === 'arrival' || row.direction === 'departure') {
      carpools[row.direction].push(serializeCarpool(row));
    }
  }

  return { eventId, arrivals, carpools };
}

function getCarpool(id: string, groupId: string): CarpoolRow | undefined {
  return db
    .prepare(
      `SELECT c.*, e.group_id, p.name AS createdByName
       FROM carpools c
       JOIN events e ON e.id = c.event_id
       JOIN players p ON p.id = c.created_by
       WHERE c.id = ? AND e.group_id = ?`
    )
    .get(id, groupId) as CarpoolRow | undefined;
}

arrivalsRouter.get('/', (req, res) => {
  res.json(buildList(req.group!.id));
});

// PUT /api/arrivals/mine - body: { playerId, arrivalAt?, departureAt?, note? }
arrivalsRouter.put('/mine', ...withBodyPlayerIdentity, (req, res) => {
  const { playerId, arrivalAt, departureAt, note } = req.body ?? {};
  if (typeof playerId !== 'string' || !playerId) {
    return res.status(400).json({ error: 'playerId ist erforderlich.' });
  }
  if (!playerExists(playerId)) return res.status(404).json({ error: 'Spieler nicht gefunden.' });

  const parsedArrival = parseOptionalTimestamp(arrivalAt, 'arrivalAt');
  if (typeof parsedArrival === 'object' && parsedArrival !== null) return res.status(400).json({ error: parsedArrival.error });
  const parsedDeparture = parseOptionalTimestamp(departureAt, 'departureAt');
  if (typeof parsedDeparture === 'object' && parsedDeparture !== null) return res.status(400).json({ error: parsedDeparture.error });
  const parsedNote = parseOptionalNote(note);
  if (typeof parsedNote === 'object' && parsedNote !== null) return res.status(400).json({ error: parsedNote.error });

  const eventId = resolveGroupEventStorageId(req.group!.id);
  if (!eventId) return res.status(409).json({ error: 'Für diese Gruppe läuft derzeit kein Event.' });
  db.prepare(
    `INSERT INTO arrivals (event_id, player_id, arrival_at, departure_at, note, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(event_id, player_id) DO UPDATE SET
       arrival_at = excluded.arrival_at,
       departure_at = excluded.departure_at,
       note = excluded.note,
       updated_at = excluded.updated_at`
  ).run(eventId, playerId, parsedArrival, parsedDeparture, parsedNote, Date.now());

  broadcast(Events.arrivalsChanged, null, { groupId: req.group!.id, eventId: deliveryEventId(eventId) });
  res.json(buildList(req.group!.id));
});

// POST /api/arrivals/carpools - body: { playerId, direction, label, startAt?,
// startLocation?, etaAt?, seatsTotal? }. The creator becomes the driver -
// they're the only one who can delete the group later (see DELETE below)
// and never counts against their own seatsTotal offer.
arrivalsRouter.post('/carpools', ...withBodyPlayerIdentity, (req, res) => {
  const { playerId, direction, label, startAt, startLocation, etaAt, seatsTotal } = req.body ?? {};
  if (typeof playerId !== 'string' || !playerId) return res.status(400).json({ error: 'playerId ist erforderlich.' });
  if (!playerExists(playerId)) return res.status(404).json({ error: 'Spieler nicht gefunden.' });
  if (typeof direction !== 'string' || !DIRECTIONS.has(direction)) {
    return res.status(400).json({ error: 'direction muss arrival oder departure sein.' });
  }
  if (!isNonEmptyString(label, MAX_LABEL_LENGTH)) {
    return res.status(400).json({ error: `Beschreibung ist erforderlich (1-${MAX_LABEL_LENGTH} Zeichen).` });
  }
  const parsedStartAt = parseOptionalTimestamp(startAt, 'startAt');
  if (typeof parsedStartAt === 'object' && parsedStartAt !== null) return res.status(400).json({ error: parsedStartAt.error });
  const parsedStartLocation = parseOptionalLocation(startLocation);
  if (typeof parsedStartLocation === 'object' && parsedStartLocation !== null) {
    return res.status(400).json({ error: parsedStartLocation.error });
  }
  const parsedEtaAt = parseOptionalTimestamp(etaAt, 'etaAt');
  if (typeof parsedEtaAt === 'object' && parsedEtaAt !== null) return res.status(400).json({ error: parsedEtaAt.error });
  const parsedSeats = parseSeatsTotal(seatsTotal);
  if (typeof parsedSeats === 'object') return res.status(400).json({ error: parsedSeats.error });

  const id = nanoid();
  const now = Date.now();
  const eventId = resolveGroupEventStorageId(req.group!.id);
  if (!eventId) return res.status(409).json({ error: 'Für diese Gruppe läuft derzeit kein Event.' });
  const create = db.transaction(() => {
    db.prepare(
      `INSERT INTO carpools (id, event_id, direction, label, start_at, start_location, eta_at, seats_total, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(id, eventId, direction, label.trim(), parsedStartAt, parsedStartLocation, parsedEtaAt, parsedSeats, playerId, now);
    db.prepare('INSERT INTO carpool_members (carpool_id, player_id) VALUES (?, ?)').run(id, playerId);
  });
  create();

  broadcast(Events.arrivalsChanged, null, { groupId: req.group!.id, eventId: deliveryEventId(eventId) });
  res.status(201).json(serializeCarpool(getCarpool(id, req.group!.id)!));
});

// PATCH /api/arrivals/carpools/:id - driver-only. Lets the driver correct
// their plan (time slips, seat count changes, ...) without having to delete
// and recreate the group (which would kick every joined passenger out).
arrivalsRouter.patch('/carpools/:id', ...withBodyPlayerIdentity, (req, res) => {
  const carpool = getCarpool(req.params.id, req.group!.id);
  if (!carpool) return res.status(404).json({ error: 'Fahrgemeinschaft nicht gefunden.' });
  const { playerId, label, startAt, startLocation, etaAt, seatsTotal } = req.body ?? {};
  if (typeof playerId !== 'string' || !playerId) return res.status(400).json({ error: 'playerId ist erforderlich.' });
  if (carpool.created_by !== playerId) {
    return res.status(403).json({ error: 'Nur der Fahrer kann diese Fahrgemeinschaft bearbeiten.' });
  }
  if (label !== undefined && !isNonEmptyString(label, MAX_LABEL_LENGTH)) {
    return res.status(400).json({ error: `Beschreibung muss 1-${MAX_LABEL_LENGTH} Zeichen lang sein.` });
  }
  const parsedStartAt = startAt !== undefined ? parseOptionalTimestamp(startAt, 'startAt') : carpool.start_at;
  if (typeof parsedStartAt === 'object' && parsedStartAt !== null) return res.status(400).json({ error: parsedStartAt.error });
  const parsedStartLocation = startLocation !== undefined ? parseOptionalLocation(startLocation) : carpool.start_location;
  if (typeof parsedStartLocation === 'object' && parsedStartLocation !== null) {
    return res.status(400).json({ error: parsedStartLocation.error });
  }
  const parsedEtaAt = etaAt !== undefined ? parseOptionalTimestamp(etaAt, 'etaAt') : carpool.eta_at;
  if (typeof parsedEtaAt === 'object' && parsedEtaAt !== null) return res.status(400).json({ error: parsedEtaAt.error });
  const parsedSeats = seatsTotal !== undefined ? parseSeatsTotal(seatsTotal) : carpool.seats_total;
  if (typeof parsedSeats === 'object') return res.status(400).json({ error: parsedSeats.error });
  const taken = seatsTaken(carpool.id, carpool.created_by);
  if (parsedSeats < taken) {
    return res.status(400).json({ error: `Es sitzen schon ${taken} Mitfahrer drin - Plätze können nicht darunter reduziert werden.` });
  }

  db.prepare(
    `UPDATE carpools SET label = ?, start_at = ?, start_location = ?, eta_at = ?, seats_total = ? WHERE id = ?`
  ).run(label !== undefined ? label.trim() : carpool.label, parsedStartAt, parsedStartLocation, parsedEtaAt, parsedSeats, carpool.id);

  broadcast(Events.arrivalsChanged, null, {
    groupId: carpool.group_id,
    eventId: deliveryEventId(carpool.event_id),
  });
  res.json(serializeCarpool(getCarpool(carpool.id, carpool.group_id)!));
});

arrivalsRouter.post('/carpools/:id/join', ...withBodyPlayerIdentity, (req, res) => {
  const carpool = getCarpool(req.params.id, req.group!.id);
  if (!carpool) return res.status(404).json({ error: 'Fahrgemeinschaft nicht gefunden.' });
  const { playerId } = req.body ?? {};
  if (typeof playerId !== 'string' || !playerId) return res.status(400).json({ error: 'playerId ist erforderlich.' });
  if (!playerExists(playerId)) return res.status(404).json({ error: 'Spieler nicht gefunden.' });

  const alreadyIn = db.prepare('SELECT 1 FROM carpool_members WHERE carpool_id = ? AND player_id = ?').get(carpool.id, playerId);
  if (!alreadyIn && seatsTaken(carpool.id, carpool.created_by) >= carpool.seats_total) {
    return res.status(409).json({ error: 'Keine Plätze mehr frei.' });
  }

  db.prepare('INSERT OR IGNORE INTO carpool_members (carpool_id, player_id) VALUES (?, ?)').run(carpool.id, playerId);
  broadcast(Events.arrivalsChanged, null, {
    groupId: carpool.group_id,
    eventId: deliveryEventId(carpool.event_id),
  });
  res.json(serializeCarpool(carpool));
});

arrivalsRouter.post('/carpools/:id/leave', ...withBodyPlayerIdentity, (req, res) => {
  const carpool = getCarpool(req.params.id, req.group!.id);
  if (!carpool) return res.status(404).json({ error: 'Fahrgemeinschaft nicht gefunden.' });
  const { playerId } = req.body ?? {};
  if (typeof playerId !== 'string' || !playerId) return res.status(400).json({ error: 'playerId ist erforderlich.' });
  if (playerId === carpool.created_by) {
    return res.status(400).json({ error: 'Der Fahrer kann die Fahrgemeinschaft nur löschen, nicht verlassen.' });
  }

  const leave = db.transaction(() => {
    db.prepare('DELETE FROM carpool_members WHERE carpool_id = ? AND player_id = ?').run(carpool.id, playerId);
    const remaining = (db.prepare('SELECT COUNT(*) AS n FROM carpool_members WHERE carpool_id = ?').get(carpool.id) as { n: number }).n;
    if (remaining === 0) db.prepare('DELETE FROM carpools WHERE id = ?').run(carpool.id);
    return remaining;
  });
  const remaining = leave();

  broadcast(Events.arrivalsChanged, null, {
    groupId: carpool.group_id,
    eventId: deliveryEventId(carpool.event_id),
  });
  if (remaining === 0) return res.status(204).end();
  res.json(serializeCarpool(carpool));
});

arrivalsRouter.delete('/carpools/:id', ...withBodyPlayerIdentity, (req, res) => {
  const carpool = getCarpool(req.params.id, req.group!.id);
  if (!carpool) return res.status(404).json({ error: 'Fahrgemeinschaft nicht gefunden.' });
  const { playerId } = req.body ?? {};
  if (typeof playerId !== 'string' || !playerId) return res.status(400).json({ error: 'playerId ist erforderlich.' });
  if (carpool.created_by !== playerId) {
    return res.status(403).json({ error: 'Nur der Ersteller kann diese Fahrgemeinschaft löschen.' });
  }

  db.prepare('DELETE FROM carpools WHERE id = ?').run(carpool.id);
  broadcast(Events.arrivalsChanged, null, {
    groupId: carpool.group_id,
    eventId: deliveryEventId(carpool.event_id),
  });
  res.status(204).end();
});
