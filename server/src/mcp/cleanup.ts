import { nanoid } from 'nanoid';
import { db } from '../db';
import { writeAdminAudit } from '../adminAudit';
import { syncCompetitionPoints } from '../orgaPoints';
import { broadcast, Events } from '../realtime';
import { digest, IntegrationError, requireIntegrationAdmin, requireFeature, resolvePrincipal, type Principal } from './access';

export type DrawSource = 'automatic' | 'draft' | 'rematch';
export interface CleanupOptions {
  age: number;
  unit: 'hours' | 'days';
  sources?: DrawSource[];
  gameId?: string;
}
interface Candidate {
  id: string; gameId: string; gameName: string; generatedAt: number;
  source: DrawSource; fingerprint: string; protectedReason: string | null;
}
interface PlanPayload { cutoff: number; options: CleanupOptions; candidates: Candidate[]; protectedCount: number; protectedEntries: Candidate[]; }
interface PlanRow {
  id: string; player_id: string; group_id: string; event_id: string; connection_id: string | null;
  payload: string; expires_at: number; approved_at: number | null; completed_at: number | null; outcome: string | null;
}

export function validateCleanupOptions(input: CleanupOptions): CleanupOptions {
  if (!Number.isSafeInteger(input.age) || input.age < 1 || input.age > 876_000 || !['hours', 'days'].includes(input.unit)) {
    throw new IntegrationError('Alter muss eine positive ganze Zahl in Stunden oder Tagen sein (maximal 876000).');
  }
  const sources = input.sources ?? ['automatic'];
  if (!Array.isArray(sources) || sources.length === 0 || sources.length > 3 ||
      sources.some((source) => !['automatic', 'draft', 'rematch'].includes(source)) || new Set(sources).size !== sources.length) {
    throw new IntegrationError('Bitte gültige, eindeutige Auslosungsarten auswählen.');
  }
  if (input.gameId !== undefined && (typeof input.gameId !== 'string' || !/^[\w-]{1,64}$/.test(input.gameId))) {
    throw new IntegrationError('gameId ist ungültig.');
  }
  return { age: input.age, unit: input.unit, sources, ...(input.gameId ? { gameId: input.gameId } : {}) };
}

function candidates(principal: Principal, cutoff: number, options: CleanupOptions): Candidate[] {
  const rows = db.prepare(`SELECT md.*,g.name AS game_name,
    EXISTS(SELECT 1 FROM betting_rounds b WHERE b.group_id=md.group_id AND b.event_id=md.event_id
      AND b.source_type='draw' AND b.source_id=md.id) AS has_bets
    FROM matchmaking_draws md JOIN games g ON g.id=md.game_id
    WHERE md.group_id=? AND md.event_id=? AND md.generated_at<? AND md.match_id IS NULL
      AND (? IS NULL OR md.game_id=?) AND COALESCE(md.source,'automatic') IN (${options.sources!.map(() => '?').join(',')})
      ORDER BY md.generated_at,md.id LIMIT 1001`)
    .all(principal.groupId, principal.eventId, cutoff, options.gameId ?? null, options.gameId ?? null, ...options.sources!) as
    Array<{ id: string; game_id: string; game_name: string; generated_at: number; source: string | null;
      tournament_id: string | null; has_bets: number; teams: string; [key: string]: unknown }>;
  if (rows.length > 1000) throw new IntegrationError('Mehr als 1000 Einträge: Bitte Auswahl über Spiel oder Alter eingrenzen.');
  return rows.flatMap((row) => {
    const source = row.source === null ? 'automatic' : row.source;
    if (!options.sources!.includes(source as DrawSource)) return [];
    return [{ id: row.id, gameId: row.game_id, gameName: row.game_name, generatedAt: row.generated_at,
      source: source as DrawSource, fingerprint: digest(JSON.stringify(row)),
      protectedReason: row.tournament_id !== null ? 'Gehört zu einem Turnier' : row.has_bets ? 'Verknüpfte Tipps oder Abrechnung' : null }];
  });
}

export function previewCleanup(principal: Principal, input: CleanupOptions, connectionId: string | null = null) {
  requireIntegrationAdmin(principal);
  requireFeature(principal, 'competition');
  const options = validateCleanupOptions(input);
  if (options.gameId && !db.prepare('SELECT 1 FROM games WHERE id=? AND group_id=?').get(options.gameId, principal.groupId)) {
    throw new IntegrationError('Spiel nicht gefunden.', 404);
  }
  const now = Date.now();
  const cutoff = now - options.age * (options.unit === 'days' ? 86_400_000 : 3_600_000);
  const all = candidates(principal, cutoff, options);
  const payload: PlanPayload = { cutoff, options, candidates: all.filter((row) => !row.protectedReason),
    protectedCount: all.filter((row) => row.protectedReason).length, protectedEntries: all.filter((row) => row.protectedReason) };
  const id = nanoid(32);
  const expiresAt = now + 10 * 60_000;
  db.transaction(() => {
    db.prepare('DELETE FROM draw_cleanup_plans WHERE expires_at<?').run(now - 7 * 86_400_000);
    const count = db.prepare('SELECT COUNT(*) FROM draw_cleanup_plans WHERE player_id=? AND expires_at>?').pluck().get(principal.playerId, now) as number;
    if (count >= 20) throw new IntegrationError('Zu viele offene Vorschauen. Bitte bestehende Vorschau verwenden oder später erneut versuchen.', 429);
    db.prepare(`INSERT INTO draw_cleanup_plans(id,player_id,group_id,event_id,connection_id,payload,created_at,expires_at)
      VALUES(?,?,?,?,?,?,?,?)`).run(id, principal.playerId, principal.groupId, principal.eventId, connectionId, JSON.stringify(payload), now, expiresAt);
  })();
  return { id, eventId: principal.eventId, eventName: principal.eventName, cutoff, expiresAt,
    options, total: all.length, deletable: payload.candidates.length, protectedCount: payload.protectedCount,
    entries: all.map(({ fingerprint: _fingerprint, ...row }) => row), confirmationPath: `/mcp/manage?plan=${encodeURIComponent(id)}` };
}

export function getCleanupPlan(playerId: string, id: string): PlanRow {
  const row = db.prepare('SELECT * FROM draw_cleanup_plans WHERE id=? AND player_id=?').get(id, playerId) as PlanRow | undefined;
  if (!row) throw new IntegrationError('Vorschau nicht gefunden.', 404);
  return row;
}

export function cleanupPlanDetails(playerId: string, id: string) {
  const row = getCleanupPlan(playerId, id);
  const principal = resolvePrincipal(playerId, row.event_id);
  requireIntegrationAdmin(principal);
  const payload = JSON.parse(row.payload) as PlanPayload;
  return { id, eventName: principal.eventName, eventId: row.event_id, expiresAt: row.expires_at,
    cutoff: payload.cutoff, options: payload.options, count: payload.candidates.length,
    protectedCount: payload.protectedCount,
    protectedEntries: payload.protectedEntries.map(({ fingerprint: _fingerprint, ...entry }) => entry),
    entries: payload.candidates.map(({ fingerprint: _fingerprint, ...entry }) => entry),
    outcome: row.outcome ? JSON.parse(row.outcome) as { deleted: number; cutoff: number; protectedCount: number } : null };
}

// Browser confirmation is the only caller allowed to set approval. MCP may
// retrieve the completed outcome, but cannot turn its own arguments into consent.
export function executeCleanup(playerId: string, id: string, browserApproval = false, connectionId?: string) {
  const result = db.transaction(() => {
    const row = getCleanupPlan(playerId, id);
    const principal = resolvePrincipal(playerId, row.event_id);
    if (principal.groupId !== row.group_id) throw new IntegrationError('Event-Zuordnung hat sich geändert.', 409);
    requireIntegrationAdmin(principal);
    requireFeature(principal, 'competition');
    if (connectionId !== undefined && row.connection_id !== connectionId) throw new IntegrationError('Vorschau gehört zu einer anderen Verbindung.', 403);
    if (row.connection_id) {
      const active = db.prepare(`SELECT 1 FROM mcp_connections WHERE id=? AND player_id=? AND revoked_at IS NULL AND expires_at>?
        AND (' '||scopes||' ') LIKE '% draws:cleanup %'`).get(row.connection_id, playerId, Date.now());
      if (!active) throw new IntegrationError('Integrationsfreigabe wurde widerrufen.', 403);
    }
    if (row.outcome) return { principal, changed: false, outcome: JSON.parse(row.outcome) as { deleted: number; cutoff: number; protectedCount: number } };
    if (row.expires_at <= Date.now()) throw new IntegrationError('Vorschau abgelaufen. Bitte neu erstellen.', 409);
    if (!browserApproval) throw new IntegrationError('Bitte diese Vorschau zuerst in Respawn prüfen und bestätigen.', 403);
    const payload = JSON.parse(row.payload) as PlanPayload;
    const current = new Map(candidates(principal, payload.cutoff, payload.options).map((candidate) => [candidate.id, candidate]));
    for (const previous of payload.candidates) {
      const fresh = current.get(previous.id);
      if (!fresh || fresh.protectedReason || fresh.fingerprint !== previous.fingerprint) {
        throw new IntegrationError('Auslosungen wurden verändert. Bitte eine neue Vorschau erstellen.', 409);
      }
    }
    const remove = db.prepare(`DELETE FROM matchmaking_draws WHERE id=? AND group_id=? AND event_id=?
      AND match_id IS NULL AND tournament_id IS NULL AND generated_at<?
      AND NOT EXISTS(SELECT 1 FROM betting_rounds WHERE group_id=? AND event_id=? AND source_type='draw' AND source_id=?)`);
    for (const candidate of payload.candidates) {
      if (remove.run(candidate.id, principal.groupId, principal.eventId, payload.cutoff,
        principal.groupId, principal.eventId, candidate.id).changes !== 1) throw new IntegrationError('Auswahl wurde verändert.', 409);
    }
    if (payload.candidates.length) syncCompetitionPoints(principal.groupId, principal.eventId);
    const outcome = { deleted: payload.candidates.length, cutoff: payload.cutoff, protectedCount: payload.protectedCount };
    db.prepare('UPDATE draw_cleanup_plans SET approved_at=?,completed_at=?,outcome=? WHERE id=?')
      .run(Date.now(), Date.now(), JSON.stringify(outcome), id);
    writeAdminAudit({ actorPlayerId: playerId, groupId: principal.groupId, action: 'matchmaking_draws_cleaned',
      targetType: 'draw_cleanup_plan', targetId: id,
      details: { eventId: principal.eventId, ...outcome, sources: payload.options.sources } });
    return { principal, changed: true, outcome };
  }).immediate();
  if (result.changed) {
    const scope = { groupId: result.principal.groupId, eventId: result.principal.eventId };
    broadcast(Events.matchmakingDrawsChanged, { cleanup: true }, scope);
    broadcast(Events.leaderboardChanged, null, scope);
  }
  return result.outcome;
}
