import { createHash, randomBytes } from 'crypto';
import { nanoid } from 'nanoid';
import { db } from './db';

export interface KioskTokenScope {
  id: string;
  groupId: string;
  eventId: string | null;
  label: string | null;
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function issueKioskToken(groupId: string, eventId: string | null, createdBy: string, label: string | null): { token: string; scope: KioskTokenScope } {
  const token = randomBytes(32).toString('hex');
  const id = nanoid();
  db.prepare(
    `INSERT INTO kiosk_tokens (id, token_hash, group_id, event_id, label, created_by, created_at, revoked_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, NULL)`,
  ).run(id, hashToken(token), groupId, eventId, label, createdBy, Date.now());
  return { token, scope: { id, groupId, eventId, label } };
}

export function resolveKioskToken(token: string | undefined): KioskTokenScope | null {
  if (!token) return null;
  const row = db.prepare(
    `SELECT kt.id, kt.group_id AS groupId, kt.event_id AS eventId, kt.label
     FROM kiosk_tokens kt JOIN groups g ON g.id = kt.group_id
     WHERE kt.token_hash = ? AND kt.revoked_at IS NULL AND g.archived_at IS NULL`,
  ).get(hashToken(token)) as KioskTokenScope | undefined;
  return row ?? null;
}

export function listKioskTokens(groupId: string): Array<KioskTokenScope & { createdAt: number; revokedAt: number | null }> {
  return db.prepare(
    `SELECT id, group_id AS groupId, event_id AS eventId, label, created_at AS createdAt, revoked_at AS revokedAt
     FROM kiosk_tokens WHERE group_id = ? ORDER BY created_at DESC`,
  ).all(groupId) as Array<KioskTokenScope & { createdAt: number; revokedAt: number | null }>;
}

export function revokeKioskToken(groupId: string, id: string): boolean {
  return db.prepare('UPDATE kiosk_tokens SET revoked_at = ? WHERE id = ? AND group_id = ? AND revoked_at IS NULL').run(Date.now(), id, groupId).changes > 0;
}
