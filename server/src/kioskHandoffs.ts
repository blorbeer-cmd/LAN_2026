import { randomBytes } from 'crypto';
import { db } from './db';
import { issueKioskToken } from './kioskTokens';

const HANDOFF_TTL_MS = 60_000;
const pending = new Map<string, { groupId: string; eventId: string; createdBy: string; expiresAt: number }>();

export function createKioskHandoff(groupId: string, eventId: string, createdBy: string): string {
  const now = Date.now();
  for (const [code, entry] of pending) {
    if (entry.expiresAt <= now) pending.delete(code);
  }
  const code = randomBytes(32).toString('hex');
  pending.set(code, { groupId, eventId, createdBy, expiresAt: now + HANDOFF_TTL_MS });
  return code;
}

export function consumeKioskHandoff(code: string): { token: string; eventId: string } | null {
  const entry = pending.get(code);
  if (!entry) return null;
  pending.delete(code); // One request wins, including when two requests arrive together.
  if (entry.expiresAt <= Date.now()) return null;
  const stillAvailable = db.prepare(
    "SELECT 1 FROM events e JOIN groups g ON g.id = e.group_id WHERE e.id = ? AND e.group_id = ? AND e.event_type_key = 'lan' AND g.archived_at IS NULL",
  ).get(entry.eventId, entry.groupId);
  if (!stillAvailable) return null;
  const issued = issueKioskToken(entry.groupId, entry.eventId, entry.createdBy, 'Broadcast öffnen');
  return { token: issued.token, eventId: entry.eventId };
}
