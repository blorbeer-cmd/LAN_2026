// An-/Abreise + Fahrgemeinschaften: everyone maintains their own arrival and
// departure times for the current event, and can create/join lightweight
// carpool groups for either direction.

import { Router } from 'express';
import { nanoid } from 'nanoid';
import { db } from '../db';
import { getTrackingEventId } from '../events';
import { broadcast, Events } from '../realtime';
import { isNonEmptyString } from '../validation';

export const arrivalsRouter = Router();

const MAX_NOTE_LENGTH = 240;
const MAX_LABEL_LENGTH = 120;
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
  direction: 'arrival' | 'departure';
  label: string;
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

function serializeCarpool(row: CarpoolRow) {
  const members = db
    .prepare(
      `SELECT p.id, p.name, p.color, p.avatar
       FROM carpool_members cm JOIN players p ON p.id = cm.player_id
       WHERE cm.carpool_id = ? ORDER BY p.name COLLATE NOCASE`
    )
    .all(row.id);
  return {
    id: row.id,
    direction: row.direction,
    label: row.label,
    createdBy: row.created_by,
    createdByName: row.createdByName,
    createdAt: row.created_at,
    members,
  };
}

function buildList() {
  const eventId = getTrackingEventId();
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
      `SELECT c.*, p.name AS createdByName
       FROM carpools c JOIN players p ON p.id = c.created_by
       WHERE c.event_id = ?
       ORDER BY c.created_at DESC`
    )
    .all(eventId) as CarpoolRow[];

  const carpools = { arrival: [] as ReturnType<typeof serializeCarpool>[], departure: [] as ReturnType<typeof serializeCarpool>[] };
  for (const row of rows) {
    if (row.direction === 'arrival' || row.direction === 'departure') {
      carpools[row.direction].push(serializeCarpool(row));
    }
  }

  return { eventId, arrivals, carpools };
}

function getCarpool(id: string): CarpoolRow | undefined {
  return db
    .prepare(
      `SELECT c.*, p.name AS createdByName
       FROM carpools c JOIN players p ON p.id = c.created_by
       WHERE c.id = ?`
    )
    .get(id) as CarpoolRow | undefined;
}

arrivalsRouter.get('/', (_req, res) => {
  res.json(buildList());
});

// PUT /api/arrivals/mine - body: { playerId, arrivalAt?, departureAt?, note? }
arrivalsRouter.put('/mine', (req, res) => {
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

  const eventId = getTrackingEventId();
  db.prepare(
    `INSERT INTO arrivals (event_id, player_id, arrival_at, departure_at, note, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(event_id, player_id) DO UPDATE SET
       arrival_at = excluded.arrival_at,
       departure_at = excluded.departure_at,
       note = excluded.note,
       updated_at = excluded.updated_at`
  ).run(eventId, playerId, parsedArrival, parsedDeparture, parsedNote, Date.now());

  broadcast(Events.arrivalsChanged, null);
  res.json(buildList());
});

// POST /api/arrivals/carpools - body: { playerId, direction, label }
arrivalsRouter.post('/carpools', (req, res) => {
  const { playerId, direction, label } = req.body ?? {};
  if (typeof playerId !== 'string' || !playerId) return res.status(400).json({ error: 'playerId ist erforderlich.' });
  if (!playerExists(playerId)) return res.status(404).json({ error: 'Spieler nicht gefunden.' });
  if (typeof direction !== 'string' || !DIRECTIONS.has(direction)) {
    return res.status(400).json({ error: 'direction muss arrival oder departure sein.' });
  }
  if (!isNonEmptyString(label, MAX_LABEL_LENGTH)) {
    return res.status(400).json({ error: `Beschreibung ist erforderlich (1-${MAX_LABEL_LENGTH} Zeichen).` });
  }

  const id = nanoid();
  const now = Date.now();
  const create = db.transaction(() => {
    db.prepare('INSERT INTO carpools (id, event_id, direction, label, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(
      id,
      getTrackingEventId(),
      direction,
      label.trim(),
      playerId,
      now
    );
    db.prepare('INSERT INTO carpool_members (carpool_id, player_id) VALUES (?, ?)').run(id, playerId);
  });
  create();

  broadcast(Events.arrivalsChanged, null);
  res.status(201).json(serializeCarpool(getCarpool(id)!));
});

arrivalsRouter.post('/carpools/:id/join', (req, res) => {
  const carpool = getCarpool(req.params.id);
  if (!carpool) return res.status(404).json({ error: 'Fahrgemeinschaft nicht gefunden.' });
  const { playerId } = req.body ?? {};
  if (typeof playerId !== 'string' || !playerId) return res.status(400).json({ error: 'playerId ist erforderlich.' });
  if (!playerExists(playerId)) return res.status(404).json({ error: 'Spieler nicht gefunden.' });

  db.prepare('INSERT OR IGNORE INTO carpool_members (carpool_id, player_id) VALUES (?, ?)').run(carpool.id, playerId);
  broadcast(Events.arrivalsChanged, null);
  res.json(serializeCarpool(carpool));
});

arrivalsRouter.post('/carpools/:id/leave', (req, res) => {
  const carpool = getCarpool(req.params.id);
  if (!carpool) return res.status(404).json({ error: 'Fahrgemeinschaft nicht gefunden.' });
  const { playerId } = req.body ?? {};
  if (typeof playerId !== 'string' || !playerId) return res.status(400).json({ error: 'playerId ist erforderlich.' });

  const leave = db.transaction(() => {
    db.prepare('DELETE FROM carpool_members WHERE carpool_id = ? AND player_id = ?').run(carpool.id, playerId);
    const remaining = (db.prepare('SELECT COUNT(*) AS n FROM carpool_members WHERE carpool_id = ?').get(carpool.id) as { n: number }).n;
    if (remaining === 0) db.prepare('DELETE FROM carpools WHERE id = ?').run(carpool.id);
    return remaining;
  });
  const remaining = leave();

  broadcast(Events.arrivalsChanged, null);
  if (remaining === 0) return res.status(204).end();
  res.json(serializeCarpool(carpool));
});

arrivalsRouter.delete('/carpools/:id', (req, res) => {
  const carpool = getCarpool(req.params.id);
  if (!carpool) return res.status(404).json({ error: 'Fahrgemeinschaft nicht gefunden.' });
  const { playerId } = req.body ?? {};
  if (typeof playerId !== 'string' || !playerId) return res.status(400).json({ error: 'playerId ist erforderlich.' });
  if (carpool.created_by !== playerId) {
    return res.status(403).json({ error: 'Nur der Ersteller kann diese Fahrgemeinschaft löschen.' });
  }

  db.prepare('DELETE FROM carpools WHERE id = ?').run(carpool.id);
  broadcast(Events.arrivalsChanged, null);
  res.status(204).end();
});
