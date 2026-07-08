// Event lifecycle: exactly one event is active at a time. Starting a new one
// closes whatever was active, clears now-stale live status (a fresh event
// shouldn't show last time's "who's playing what"), and force-closes any
// vote round left open. Players, games, and skills are NOT touched — they're
// intentionally global across events (same friend group every year).
//
// The very first event is seeded once by db.ts at startup — getActiveEventId
// here is a pure reader and never creates one itself, since startNewEvent's
// wipe side-effects must only ever run for an explicit, admin-initiated
// "start a new LAN" action, never reactively from inside another request's
// transaction (see db.ts's seedDefaultEvent comment for why that bit us).

import { nanoid } from 'nanoid';
import { db, getState, setState } from './db';

const ACTIVE_EVENT_KEY = 'active_event_id';

export interface EventRow {
  id: string;
  name: string;
  starts_at: number;
  ends_at: number | null;
  location: string | null;
  description: string | null;
}

export interface StartEventOptions {
  startsAt?: number;
  endsAt?: number | null;
  location?: string | null;
  description?: string | null;
}

export function getActiveEventId(): string {
  const id = getState(ACTIVE_EVENT_KEY);
  if (!id) {
    throw new Error('Kein aktives Event vorhanden — Datenbank wurde nicht korrekt initialisiert.');
  }
  return id;
}

export function getActiveEvent(): EventRow {
  const id = getActiveEventId();
  return db.prepare('SELECT * FROM events WHERE id = ?').get(id) as EventRow;
}

export function listEvents(): EventRow[] {
  return db.prepare('SELECT * FROM events ORDER BY starts_at DESC').all() as EventRow[];
}

export function startNewEvent(name: string, options: StartEventOptions = {}): EventRow {
  const now = Date.now();
  const previousId = getState(ACTIVE_EVENT_KEY);
  if (previousId) {
    db.prepare('UPDATE events SET ends_at = ? WHERE id = ? AND ends_at IS NULL').run(now, previousId);
  }

  const id = nanoid();
  db.prepare(
    'INSERT INTO events (id, name, starts_at, ends_at, location, description) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(
    id,
    name,
    options.startsAt ?? now,
    options.endsAt ?? null,
    options.location ?? null,
    options.description ?? null
  );
  setState(ACTIVE_EVENT_KEY, id);

  db.prepare('DELETE FROM live_status_games').run();
  db.prepare('DELETE FROM live_status').run();
  setState('vote_open', '0'); // vote_round itself keeps incrementing, never resets

  return db.prepare('SELECT * FROM events WHERE id = ?').get(id) as EventRow;
}

export interface UpdateEventFields {
  name?: string;
  startsAt?: number;
  endsAt?: number | null;
  location?: string | null;
  description?: string | null;
}

// Metadata-only correction — never touches which event is active or wipes
// live status (that's what starting a new event is for). Safe to call on
// past events too (e.g. backfilling a forgotten end date/location).
export function updateEvent(id: string, fields: UpdateEventFields): EventRow | undefined {
  const existing = db.prepare('SELECT * FROM events WHERE id = ?').get(id) as EventRow | undefined;
  if (!existing) return undefined;

  const next: EventRow = {
    ...existing,
    name: fields.name !== undefined ? fields.name : existing.name,
    starts_at: fields.startsAt !== undefined ? fields.startsAt : existing.starts_at,
    ends_at: fields.endsAt !== undefined ? fields.endsAt : existing.ends_at,
    location: fields.location !== undefined ? fields.location : existing.location,
    description: fields.description !== undefined ? fields.description : existing.description,
  };

  db.prepare(
    'UPDATE events SET name = ?, starts_at = ?, ends_at = ?, location = ?, description = ? WHERE id = ?'
  ).run(next.name, next.starts_at, next.ends_at, next.location, next.description, next.id);

  return next;
}
