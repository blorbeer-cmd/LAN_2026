import { createHash } from 'crypto';
import { db } from '../db';
import { config } from '../config';
import { isEventFeatureEnabled } from '../eventFeatures';
import type { EventFeatureKey } from '../eventFeatureCatalog';

export class IntegrationError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

export const digest = (value: string): string => createHash('sha256').update(value).digest('hex');

export interface Principal {
  playerId: string;
  playerName: string;
  groupId: string;
  eventId: string;
  eventName: string;
  role: 'owner' | 'admin' | 'member';
  ended: boolean;
}

// Re-resolve identity, membership and accepted participation on every request.
// No cookie impersonation, active-workspace mutation or admin read bypass.
export function resolvePrincipal(playerId: string, eventId: string): Principal {
  const row = db.prepare(`SELECT p.id AS playerId,p.name AS playerName,e.group_id AS groupId,
      e.id AS eventId,e.name AS eventName,gm.role,e.ended_at AS endedAt
    FROM players p JOIN event_participants ep ON ep.player_id=p.id AND ep.status='accepted'
    JOIN events e ON e.id=ep.event_id JOIN groups g ON g.id=e.group_id AND g.archived_at IS NULL
    JOIN group_memberships gm ON gm.player_id=p.id AND gm.group_id=e.group_id AND gm.status='active'
    WHERE p.id=? AND e.id=? AND p.deactivated_at IS NULL AND p.is_test=0 AND e.is_test=0
      AND e.status IN ('published','ended')`).get(playerId, eventId) as
    (Omit<Principal, 'ended'> & { endedAt: number | null }) | undefined;
  if (!row) throw new IntegrationError('Event oder Freigabe ist nicht verfügbar.', 404);
  return { ...row, ended: row.endedAt !== null };
}

export function requireIntegrationAdmin(principal: Principal): void {
  if (!['owner', 'admin'].includes(principal.role)) throw new IntegrationError('Nur für Community-Admins.', 403);
}

export function requireFeature(principal: Principal, feature: EventFeatureKey): void {
  if (!isEventFeatureEnabled(principal.eventId, feature)) throw new IntegrationError('Dieser Bereich ist für das Event deaktiviert.', 404);
}

export function mcpBaseUrl(): string {
  let url: URL;
  try { url = new URL(config.publicBaseUrl); }
  catch { throw new IntegrationError('Für MCP muss PUBLIC_BASE_URL gesetzt sein.', 503); }
  if (url.protocol !== 'https:' || url.pathname !== '/' || url.search || url.hash || url.username || url.password) {
    throw new IntegrationError('PUBLIC_BASE_URL muss für MCP ein HTTPS-Ursprung ohne Pfad sein.', 503);
  }
  return url.origin;
}
