// Event lifecycle: several events can exist at once, even with overlapping
// time frames — but tracking (live status / playtime) is exclusive. At most
// one event has tracking_enabled at any moment, and only its roster
// (event_participants) gets tracked. A permanent sentinel event
// (OUTSIDE_EVENTS_ID) represents "außerhalb von Events": whatever gets
// recorded while no real event is tracking lands there instead, so every
// event-scoped table can keep a plain non-null event_id rather than
// threading a nullable "no event" case through the whole codebase. Players,
// games, and skills are NOT touched by any of this — they're intentionally
// global across events (same friend group every year).
//
// The sentinel is seeded once by db.ts at startup — getTrackingEventId here
// is a pure reader and never creates anything itself.

import { nanoid } from 'nanoid';
import { db, DEFAULT_GROUP_ID, OUTSIDE_EVENTS_ID } from './db';

export { OUTSIDE_EVENTS_ID };

export interface EventRow {
  id: string;
  name: string;
  starts_at: number;
  ends_at: number | null;
  location: string | null;
  description: string | null;
  tracking_enabled: number;
  ended_at: number | null;
  group_id: string | null;
  status: 'draft' | 'published' | 'cancelled' | 'ended';
}

// Whichever event currently has tracking_enabled — or the permanent
// "außerhalb von Events" sentinel if none does. Always resolves to a real
// row, so callers never have to special-case "no event" when tagging
// matches/sessions/draws/etc.
export function getTrackingEventId(): string {
  const row = db.prepare('SELECT id FROM events WHERE tracking_enabled = 1').get() as { id: string } | undefined;
  return row?.id ?? OUTSIDE_EVENTS_ID;
}

export function getTrackingEvent(): EventRow {
  return getEvent(getTrackingEventId())!;
}

export function getEvent(id: string): EventRow | undefined {
  return db.prepare('SELECT * FROM events WHERE id = ?').get(id) as EventRow | undefined;
}

// Real events only — excludes the "außerhalb von Events" sentinel, which
// isn't something you create/edit/end like a normal event (it's always
// listed separately wherever that's relevant, e.g. as a filter option).
export function listEvents(groupId = DEFAULT_GROUP_ID): EventRow[] {
  return db
    .prepare('SELECT * FROM events WHERE id != ? AND group_id = ? ORDER BY starts_at DESC')
    .all(OUTSIDE_EVENTS_ID, groupId) as EventRow[];
}

export interface CreateEventOptions {
  groupId?: string;
  startsAt: number;
  endsAt: number | null;
  location?: string | null;
  description?: string | null;
}

// Just creates the event — tracking starts off, so this never wipes live
// status or conflicts with an already-tracking event. Call startTracking
// separately once you actually want this event to go live.
export function createEvent(name: string, options: CreateEventOptions): EventRow {
  const id = nanoid();
  db.prepare(
    `INSERT INTO events
       (id, name, starts_at, ends_at, location, description, tracking_enabled, ended_at, group_id, status)
     VALUES (?, ?, ?, ?, ?, ?, 0, NULL, ?, 'published')`
  ).run(
    id,
    name,
    options.startsAt,
    options.endsAt,
    options.location ?? null,
    options.description ?? null,
    options.groupId ?? DEFAULT_GROUP_ID
  );
  return getEvent(id)!;
}

export interface UpdateEventFields {
  name?: string;
  startsAt?: number;
  endsAt?: number | null;
  location?: string | null;
  description?: string | null;
}

// Metadata-only correction — never touches tracking state or live status.
// Safe to call on past/ended events too (e.g. backfilling a forgotten end
// date/location). Not valid for the sentinel (nothing to correct there).
export function updateEvent(id: string, fields: UpdateEventFields): EventRow | undefined {
  const existing = getEvent(id);
  if (!existing || id === OUTSIDE_EVENTS_ID) return undefined;

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

export type StartTrackingResult =
  | { ok: true; event: EventRow }
  | { ok: false; code: 'not_found' | 'invalid' | 'conflict'; error: string; conflictEventId?: string; conflictEventName?: string };

// Clears the live-status board AND closes any still-open play_sessions rows
// (FR-29) — used whenever tracking starts/stops/ends, since a switch in who
// is being tracked means whatever "currently running" state existed before
// is now stale and would otherwise never get an ended_at.
function wipeLiveStatus(): void {
  const now = Date.now();
  db.prepare('UPDATE play_sessions SET ended_at = ? WHERE ended_at IS NULL').run(now);
  db.prepare('DELETE FROM live_status_games').run();
  db.prepare('DELETE FROM live_status').run();
}

// Turns tracking on for one event — clearing stale live status from
// whatever was tracked before (a fresh tracking window shouldn't show last
// time's "who's playing what") and giving every existing agent report a
// clean slate. Rejects if a DIFFERENT event is already tracking (only one
// at a time, system-wide) rather than silently switching, since that's the
// one thing that must stay exclusive even though events themselves can
// overlap in time.
export function startTracking(id: string): StartTrackingResult {
  const event = getEvent(id);
  if (!event) return { ok: false, code: 'not_found', error: 'Event nicht gefunden.' };
  if (event.id === OUTSIDE_EVENTS_ID) {
    return { ok: false, code: 'invalid', error: '„Außerhalb von Events" kann nicht getrackt werden.' };
  }
  if (event.ended_at) {
    return { ok: false, code: 'invalid', error: 'Ein beendetes Event kann nicht wieder getrackt werden.' };
  }
  if (event.status === 'cancelled') {
    return { ok: false, code: 'invalid', error: 'Ein abgesagtes Event kann nicht getrackt werden.' };
  }
  if (event.tracking_enabled) return { ok: true, event };

  const current = db.prepare('SELECT id, name FROM events WHERE tracking_enabled = 1').get() as
    | { id: string; name: string }
    | undefined;
  if (current && current.id !== id) {
    return {
      ok: false,
      code: 'conflict',
      error: `Tracking läuft bereits für „${current.name}" – dort erst stoppen.`,
      conflictEventId: current.id,
      conflictEventName: current.name,
    };
  }

  db.prepare('UPDATE events SET tracking_enabled = 1 WHERE id = ?').run(id);
  wipeLiveStatus();

  return { ok: true, event: getEvent(id)! };
}

// Pauses tracking without ending the event — can be resumed with
// startTracking later. A no-op (not an error) if this event wasn't the one
// tracking, so callers don't need to check first.
export function stopTracking(id: string): EventRow | undefined {
  const event = getEvent(id);
  if (!event) return undefined;
  if (!event.tracking_enabled) return event;

  db.prepare('UPDATE events SET tracking_enabled = 0 WHERE id = ?').run(id);
  wipeLiveStatus();
  return getEvent(id);
}

// Closes an event for good — stops tracking first if it was on (same live
// status wipe as stopTracking), then marks it ended so it can't be
// re-tracked. Valid on any real event regardless of current tracking state
// (e.g. formally closing an event that was never actually tracked).
export function endEvent(id: string): EventRow | undefined {
  const event = getEvent(id);
  if (!event || event.id === OUTSIDE_EVENTS_ID) return undefined;

  const wasTracking = Boolean(event.tracking_enabled);
  db.prepare("UPDATE events SET tracking_enabled = 0, ended_at = ?, status = 'ended' WHERE id = ?").run(Date.now(), id);
  if (wasTracking) wipeLiveStatus();
  return getEvent(id);
}

export function cancelEvent(id: string): EventRow | undefined {
  const event = getEvent(id);
  if (!event || event.id === OUTSIDE_EVENTS_ID || event.tracking_enabled || event.status === 'ended') return undefined;
  db.prepare("UPDATE events SET status = 'cancelled' WHERE id = ?").run(id);
  return getEvent(id);
}

// ---------- roster ----------

export function getParticipantIds(eventId: string): string[] {
  const rows = db.prepare('SELECT player_id FROM event_participants WHERE event_id = ?').all(eventId) as Array<{
    player_id: string;
  }>;
  return rows.map((r) => r.player_id);
}

export function isParticipant(eventId: string, playerId: string): boolean {
  const row = db
    .prepare('SELECT 1 FROM event_participants WHERE event_id = ? AND player_id = ?')
    .get(eventId, playerId);
  return Boolean(row);
}

// Replaces the whole roster in one go — simpler for the UI than incremental
// add/remove calls, mirroring how a tournament's team roster is set.
export function setParticipants(eventId: string, playerIds: string[]): void {
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM event_participants WHERE event_id = ?').run(eventId);
    const insert = db.prepare('INSERT INTO event_participants (event_id, player_id) VALUES (?, ?)');
    for (const playerId of new Set(playerIds)) insert.run(eventId, playerId);
  });
  tx();
}
