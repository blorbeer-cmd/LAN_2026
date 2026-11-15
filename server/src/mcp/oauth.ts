import { randomBytes } from 'crypto';
import { nanoid } from 'nanoid';
import { Router, type Request, type Response, type RequestHandler } from 'express';
import { db } from '../db';
import { config } from '../config';
import { requireUser } from '../sessions';
import { digest, IntegrationError, mcpBaseUrl, resolvePrincipal } from './access';

const SUPPORTED_SCOPES = ['event:read', 'teams:preview', 'draws:cleanup'];
const pending = new Map<string, { clientId: string; redirect: string; challenge: string; scopes: string[]; state: string; expires: number }>();
const codes = new Map<string, { clientId: string; redirect: string; challenge: string; connectionId: string; expires: number }>();
const windows = new Map<string, { count: number; until: number }>();

export const route = (action: (req: Request, res: Response) => unknown): RequestHandler => (req, res, next) => {
  try { action(req, res); } catch (error) {
    if (error instanceof IntegrationError) res.status(error.status).json({ error: error.message }); else next(error);
  }
};

export function limitRequests(key: string, max = 90): void {
  const now = Date.now();
  for (const [stored, window] of windows) if (window.until <= now) windows.delete(stored);
  const window = windows.get(key) ?? { count: 0, until: now + 60_000 };
  if (window.count >= max || windows.size > 2000) throw new IntegrationError('Zu viele Anfragen. Bitte später erneut versuchen.', 429);
  window.count++; windows.set(key, window);
}

export const sameOrigin: RequestHandler = (req, res, next) => {
  const origin = req.get('origin');
  const localOrigin = `${req.protocol}://${req.get('host')}`;
  if (!origin || (origin !== config.publicBaseUrl && origin !== localOrigin)) {
    res.status(403).json({ error: 'Diese Aktion muss direkt in Respawn bestätigt werden.' }); return;
  }
  next();
};

export interface Connection {
  id: string; client_id: string; player_id: string; group_id: string; event_id: string;
  scopes: string; access_hash: string; refresh_hash: string; access_expires_at: number;
  expires_at: number; created_at: number; revoked_at: number | null;
}

export function resolveConnection(token: string, scope?: string): { connection: Connection; principal: ReturnType<typeof resolvePrincipal> } {
  const connection = db.prepare(`SELECT * FROM mcp_connections WHERE access_hash=? AND revoked_at IS NULL
    AND access_expires_at>? AND expires_at>?`).get(digest(token), Date.now(), Date.now()) as Connection | undefined;
  if (!connection) throw new IntegrationError('MCP-Verbindung abgelaufen oder widerrufen. Bitte erneut verbinden.', 401);
  if (scope && !connection.scopes.split(' ').includes(scope)) throw new IntegrationError(`Freigabe ${scope} fehlt.`, 403);
  const principal = resolvePrincipal(connection.player_id, connection.event_id);
  if (principal.groupId !== connection.group_id) throw new IntegrationError('Event-Freigabe hat sich geändert. Bitte neu verbinden.', 403);
  return { connection, principal };
}

function tokens(connectionId: string) {
  const access = randomBytes(32).toString('base64url');
  const refresh = randomBytes(32).toString('base64url');
  const connection = db.prepare('SELECT expires_at,scopes FROM mcp_connections WHERE id=?').get(connectionId) as { expires_at: number; scopes: string };
  const accessExpiry = Math.min(Date.now() + 3_600_000, connection.expires_at);
  db.prepare('UPDATE mcp_connections SET access_hash=?,refresh_hash=?,access_expires_at=? WHERE id=?')
    .run(digest(access), digest(refresh), accessExpiry, connectionId);
  return { access_token: access, refresh_token: refresh, token_type: 'Bearer',
    expires_in: Math.max(0, Math.floor((accessExpiry - Date.now()) / 1000)), scope: connection.scopes };
}

function validRedirect(raw: unknown): raw is string {
  if (typeof raw !== 'string') return false;
  try {
    const uri = new URL(raw);
    return uri.origin === 'https://chatgpt.com' && !uri.search && !uri.hash &&
      (uri.pathname === '/connector_platform_oauth_redirect' || /^\/connector\/oauth\/[A-Za-z0-9_-]+$/.test(uri.pathname));
  } catch { return false; }
}

function purgeTransient(): void {
  for (const [id, value] of pending) if (value.expires <= Date.now()) pending.delete(id);
  for (const [id, value] of codes) if (value.expires <= Date.now()) codes.delete(id);
}

export function mountOAuth(router: Router): void {
  router.get(['/.well-known/oauth-protected-resource', '/.well-known/oauth-protected-resource/mcp'], route((_req, res) => {
    const base = mcpBaseUrl();
    res.json({ resource: `${base}/mcp`, authorization_servers: [base], scopes_supported: SUPPORTED_SCOPES,
      bearer_methods_supported: ['header'] });
  }));
  router.get('/.well-known/oauth-authorization-server', route((_req, res) => {
    const base = mcpBaseUrl();
    res.json({ issuer: base, authorization_endpoint: `${base}/mcp/authorize`, token_endpoint: `${base}/mcp/oauth/token`,
      registration_endpoint: `${base}/mcp/oauth/register`, revocation_endpoint: `${base}/mcp/oauth/revoke`,
      response_types_supported: ['code'], grant_types_supported: ['authorization_code', 'refresh_token'],
      code_challenge_methods_supported: ['S256'], token_endpoint_auth_methods_supported: ['none'],
      authorization_response_iss_parameter_supported: true, scopes_supported: SUPPORTED_SCOPES });
  }));
  router.post('/mcp/oauth/register', route((req, res) => {
    limitRequests(`register:${req.ip}`, 10);
    const redirects: unknown = req.body?.redirect_uris;
    if (!Array.isArray(redirects) || redirects.length !== 1 || !validRedirect(redirects[0]) ||
        (req.body.token_endpoint_auth_method !== undefined && req.body.token_endpoint_auth_method !== 'none')) {
      return res.status(400).json({ error: 'invalid_client_metadata', error_description: 'Nur der exakte ChatGPT-Callback und PKCE ohne Client-Secret sind unterstützt.' });
    }
    const count = db.prepare('SELECT COUNT(*) FROM mcp_clients').pluck().get() as number;
    if (count >= 1000) throw new IntegrationError('Registrierungslimit erreicht.', 429);
    const clientId = nanoid(32);
    db.prepare('INSERT INTO mcp_clients(id,redirect_uri,created_at) VALUES(?,?,?)').run(clientId, redirects[0], Date.now());
    res.status(201).json({ client_id: clientId, redirect_uris: redirects,
      token_endpoint_auth_method: 'none', grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'] });
  }));
  router.get('/mcp/authorize', route((req, res) => {
    purgeTransient(); limitRequests(`authorize:${req.ip}`, 30);
    const q = req.query;
    const client = typeof q.client_id === 'string' ? db.prepare('SELECT redirect_uri FROM mcp_clients WHERE id=?').get(q.client_id) as { redirect_uri: string } | undefined : undefined;
    if (!client || q.redirect_uri !== client.redirect_uri || q.response_type !== 'code' || q.code_challenge_method !== 'S256' ||
        typeof q.code_challenge !== 'string' || !/^[\w-]{43}$/.test(q.code_challenge) ||
        typeof q.state !== 'string' || q.state.length < 1 || q.state.length > 2048 ||
        q.resource !== `${mcpBaseUrl()}/mcp`) throw new IntegrationError('Ungültige OAuth-Anfrage.');
    const scopes = typeof q.scope === 'string' ? q.scope.split(' ').filter(Boolean) : ['event:read', 'teams:preview'];
    if (!scopes.includes('event:read') || scopes.some((scope) => !SUPPORTED_SCOPES.includes(scope))) throw new IntegrationError('Ungültige OAuth-Freigabe.');
    if (pending.size >= 100 || codes.size >= 100) throw new IntegrationError('Zu viele offene Verbindungsanfragen.', 429);
    const id = nanoid(32);
    pending.set(id, { clientId: q.client_id as string, redirect: client.redirect_uri, challenge: q.code_challenge,
      scopes: [...new Set(scopes)], state: q.state, expires: Date.now() + 10 * 60_000 });
    res.redirect(`/mcp/connect?request=${encodeURIComponent(id)}`);
  }));
  router.get('/mcp/oauth/pending/:id', requireUser, route((req, res) => {
    purgeTransient();
    const request = pending.get(req.params.id);
    if (!request) throw new IntegrationError('Verbindungsanfrage abgelaufen.', 404);
    res.json({ scopes: request.scopes, expiresAt: request.expires });
  }));
  router.post('/mcp/oauth/consent', sameOrigin, requireUser, route((req, res) => {
    purgeTransient();
    const id = req.body?.requestId;
    const request = typeof id === 'string' ? pending.get(id) : undefined;
    if (!request) throw new IntegrationError('Verbindungsanfrage abgelaufen.', 409);
    const redirect = new URL(request.redirect);
    redirect.searchParams.set('state', request.state);
    redirect.searchParams.set('iss', mcpBaseUrl());
    if (req.body?.deny === true) {
      pending.delete(id); redirect.searchParams.set('error', 'access_denied');
      return res.json({ redirect: redirect.href });
    }
    if (typeof req.body?.eventId !== 'string') throw new IntegrationError('Bitte ein Event auswählen.');
    const principal = resolvePrincipal(req.player!.id, req.body.eventId);
    const scopes = request.scopes.filter((scope) => scope !== 'draws:cleanup' ||
      (req.body.allowCleanup === true && ['owner', 'admin'].includes(principal.role)));
    const connectionId = nanoid();
    const now = Date.now();
    db.prepare(`INSERT INTO mcp_connections(id,client_id,player_id,group_id,event_id,scopes,access_hash,refresh_hash,
      access_expires_at,expires_at,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)`).run(connectionId, request.clientId,
        principal.playerId, principal.groupId, principal.eventId, scopes.join(' '), digest(randomBytes(32).toString('hex')),
        digest(randomBytes(32).toString('hex')), now, now + 30 * 86_400_000, now);
    const code = randomBytes(32).toString('base64url');
    codes.set(digest(code), { clientId: request.clientId, redirect: request.redirect, challenge: request.challenge,
      connectionId, expires: now + 60_000 });
    pending.delete(id); redirect.searchParams.set('code', code);
    res.json({ redirect: redirect.href });
  }));
  router.post('/mcp/oauth/token', route((req, res) => {
    purgeTransient(); limitRequests(`token:${req.ip}`, 60);
    res.setHeader('Cache-Control', 'no-store');
    const input = req.body ?? {};
    const fail = () => res.status(400).json({ error: 'invalid_grant' });
    if (input.resource !== `${mcpBaseUrl()}/mcp` || typeof input.client_id !== 'string') return fail();
    if (input.grant_type === 'authorization_code') {
      const value = typeof input.code === 'string' ? codes.get(digest(input.code)) : undefined;
      if (!value || value.clientId !== input.client_id || value.redirect !== input.redirect_uri ||
          typeof input.code_verifier !== 'string' || !/^[A-Za-z0-9._~-]{43,128}$/.test(input.code_verifier) ||
          Buffer.from(digest(input.code_verifier), 'hex').toString('base64url') !== value.challenge) return fail();
      const connection = db.prepare('SELECT * FROM mcp_connections WHERE id=? AND revoked_at IS NULL AND expires_at>?')
        .get(value.connectionId, Date.now()) as Connection | undefined;
      if (!connection) return fail();
      resolvePrincipal(connection.player_id, connection.event_id);
      codes.delete(digest(input.code));
      return res.json(tokens(value.connectionId));
    }
    if (input.grant_type === 'refresh_token' && typeof input.refresh_token === 'string') {
      const connection = db.prepare(`SELECT * FROM mcp_connections WHERE refresh_hash=? AND client_id=? AND revoked_at IS NULL
        AND expires_at>?`).get(digest(input.refresh_token), input.client_id, Date.now()) as Connection | undefined;
      if (!connection) return fail();
      if (input.scope !== undefined && input.scope !== connection.scopes) return res.status(400).json({ error: 'invalid_scope' });
      resolvePrincipal(connection.player_id, connection.event_id);
      return res.json(tokens(connection.id));
    }
    return res.status(400).json({ error: 'unsupported_grant_type' });
  }));
  router.post('/mcp/oauth/revoke', route((req, res) => {
    limitRequests(`revoke:${req.ip}`, 30);
    if (typeof req.body?.token === 'string' && typeof req.body?.client_id === 'string') {
      const hash = digest(req.body.token);
      db.prepare('UPDATE mcp_connections SET revoked_at=? WHERE client_id=? AND (access_hash=? OR refresh_hash=?)')
        .run(Date.now(), req.body.client_id, hash, hash);
    }
    res.status(200).end();
  }));
}
