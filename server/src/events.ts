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

export function startNewEvent(name: string): EventRow {
  const now = Date.now();
  const previousId = getState(ACTIVE_EVENT_KEY);
  if (previousId) {
    db.prepare('UPDATE events SET ends_at = ? WHERE id = ? AND ends_at IS NULL').run(now, previousId);
  }

  const id = nanoid();
  db.prepare('INSERT INTO events (id, name, starts_at, ends_at) VALUES (?, ?, ?, NULL)').run(id, name, now);
  setState(ACTIVE_EVENT_KEY, id);

  db.prepare('DELETE FROM live_status_games').run();
  db.prepare('DELETE FROM live_status').run();
  setState('vote_open', '0'); // vote_round itself keeps incrementing, never resets

  return db.prepare('SELECT * FROM events WHERE id = ?').get(id) as EventRow;
}

export function renameEvent(id: string, name: string): EventRow | undefined {
  const result = db.prepare('UPDATE events SET name = ? WHERE id = ?').run(name, id);
  if (result.changes === 0) return undefined;
  return db.prepare('SELECT * FROM events WHERE id = ?').get(id) as EventRow;
}
