import { nanoid } from 'nanoid';
import { db } from './db';

export interface AdminAuditEntry {
  actorPlayerId?: string;
  groupId?: string;
  action: string;
  targetType: string;
  targetId?: string;
  details?: Record<string, unknown>;
}

// Audit writes deliberately stay synchronous and in the caller's transaction
// when one is active. Details must be small structured metadata only — never
// passwords, invite/session tokens, API keys, or password hashes.
export function writeAdminAudit(entry: AdminAuditEntry): void {
  db.prepare(
    `INSERT INTO admin_log (id, actor_player_id, group_id, action, target_type, target_id, details, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    nanoid(),
    entry.actorPlayerId ?? null,
    entry.groupId ?? null,
    entry.action,
    entry.targetType,
    entry.targetId ?? null,
    entry.details ? JSON.stringify(entry.details) : null,
    Date.now(),
  );
}
