// Real per-user login (see docs/KONZEPT-USER-MANAGEMENT.md): register a
// brand-new player, claim an existing one, log in/out, change a password,
// and (admin-only) issue/revoke the invite codes that gate all of the above.
//
// Feature routes enforce these sessions when AUTH_MODE=required; legacy mode
// preserves the existing shared-token behavior for explicit rollbacks.

import { Router, type RequestHandler } from 'express';
import { nanoid } from 'nanoid';
import { db } from '../db';
import { config } from '../config';
import { broadcast, disconnectPlayerSockets, disconnectSessionSockets, Events } from '../realtime';
import { isNonEmptyString, isHexColor, isValidAvatar } from '../validation';
import {
  hashPassword,
  verifyPasswordConstantTime,
  isValidPassword,
  hasClaimedAdmin,
  MIN_PASSWORD_LENGTH,
} from '../accounts';
import {
  createSession,
  deleteSessionByToken,
  deleteAllSessionsForPlayer,
  setSessionCookie,
  clearSessionCookie,
  getSessionToken,
  requireUser,
  requireSessionAdmin,
  requireRecentReauthentication,
  markSessionReauthenticated,
} from '../sessions';
import { createInvite, findValidInvite, markInviteUsed, voidOutstandingInvites, revokeInvite, type InvitePurpose } from '../invites';
import { DEFAULT_GROUP_ID, ensureDefaultGroupMembership } from '../groups';
import {
  consumeGlobalAuthRequest,
  isLoginLocked,
  loginRetryAfterMs,
  recordLoginFailure,
  recordLoginSuccess,
} from '../loginRateLimit';
import { writeAdminAudit } from '../adminAudit';

export const authRouter = Router();

const limitAnonymousAuthAttempts: RequestHandler = (_req, res, next) => {
  const rate = consumeGlobalAuthRequest();
  if (!rate.allowed) {
    res.setHeader('Retry-After', String(Math.ceil(rate.retryAfterMs / 1000)));
    res.status(429).json({ error: 'Zu viele Authentifizierungsanfragen – bitte kurz warten.' });
    return;
  }
  next();
};

const DEFAULT_COLOR = '#4f9dff';

class InvalidInviteError extends Error {}

interface PlayerRow {
  id: string;
  name: string;
  color: string;
  avatar: string | null;
  password_hash: string | null;
  is_admin: number;
  is_test: number;
  deactivated_at: number | null;
  created_at: number;
}

function nameTaken(name: string): boolean {
  const row = db.prepare('SELECT id FROM players WHERE name = ? COLLATE NOCASE').get(name) as { id: string } | undefined;
  return Boolean(row);
}

function toPublicAccount(row: PlayerRow) {
  return {
    id: row.id,
    name: row.name,
    color: row.color,
    avatar: row.avatar,
    isAdmin: Boolean(row.is_admin),
    isTest: Boolean(row.is_test),
  };
}

// The recovery-code bootstrap only ever applies before any admin has
// actually claimed an account — closing the door the moment a real admin
// exists, so the env var can safely stay set afterwards without becoming a
// standing backdoor.
function recoveryCodeUsable(code: string): boolean {
  return Boolean(config.adminRecoveryCode) && code === config.adminRecoveryCode && !hasClaimedAdmin();
}

function soleClaimedAdminForRecovery(code: string): PlayerRow | undefined {
  if (!config.adminRecoveryCode || code !== config.adminRecoveryCode) return undefined;
  const admins = db
    .prepare(
      `SELECT * FROM players
       WHERE is_admin = 1 AND password_hash IS NOT NULL AND deactivated_at IS NULL
       LIMIT 2`
    )
    .all() as PlayerRow[];
  return admins.length === 1 ? admins[0] : undefined;
}

// Lets the one-time recovery link select an existing legacy profile without
// making the normal roster public. The recovery code is the authorization;
// once any claimed admin exists this endpoint closes permanently.
authRouter.get('/bootstrap-accounts', limitAnonymousAuthAttempts, (req, res) => {
  const code = typeof req.query.code === 'string' ? req.query.code : '';
  if (!recoveryCodeUsable(code)) return res.status(404).json({ error: 'Bootstrap-Link ist nicht gültig.' });
  const players = db
    .prepare(
      `SELECT id, name, color, avatar
       FROM players
       WHERE password_hash IS NULL AND is_test = 0 AND deactivated_at IS NULL
       ORDER BY name COLLATE NOCASE`
    )
    .all();
  res.json(players);
});

// POST /api/auth/register - creates a brand-new player via a 'register'
// invite (or the recovery code, while no admin has claimed an account yet).
// Body: { code, name, password, color?, avatar? }
authRouter.post('/register', limitAnonymousAuthAttempts, (req, res) => {
  const { code, name, password, color, avatar } = req.body ?? {};

  if (!isNonEmptyString(code, 200)) return res.status(400).json({ error: 'Einladungscode ist erforderlich.' });
  if (!isNonEmptyString(name)) return res.status(400).json({ error: 'Name ist erforderlich (1-60 Zeichen).' });
  if (!isValidPassword(password)) {
    return res.status(400).json({ error: `Passwort muss mindestens ${MIN_PASSWORD_LENGTH} Zeichen lang sein.` });
  }
  if (color !== undefined && !isHexColor(color)) {
    return res.status(400).json({ error: 'Farbe muss ein Hex-Code sein, z.B. #4f9dff.' });
  }
  if (avatar !== undefined && avatar !== null && !isValidAvatar(avatar)) {
    return res.status(400).json({ error: 'Ungültiges Bildformat.' });
  }

  const isBootstrap = recoveryCodeUsable(code);
  const invite = isBootstrap ? undefined : findValidInvite(code, 'register');
  if (!isBootstrap && !invite) {
    return res.status(400).json({ error: 'Einladungscode ist ungültig oder abgelaufen.' });
  }

  const trimmedName = name.trim();
  if (nameTaken(trimmedName)) {
    return res.status(409).json({ error: `Der Name "${trimmedName}" ist schon vergeben.` });
  }

  const now = Date.now();
  const player: PlayerRow = {
    id: nanoid(),
    name: trimmedName,
    color: color ?? DEFAULT_COLOR,
    avatar: avatar ?? null,
    password_hash: hashPassword(password),
    is_admin: isBootstrap ? 1 : 0,
    is_test: 0,
    deactivated_at: null,
    created_at: now,
  };

  try {
    db.transaction(() => {
      db.prepare(
        `INSERT INTO players (id, name, color, avatar, api_key, tracking_paused, is_admin, is_test, password_hash, last_login_at, created_at)
         VALUES (?, ?, ?, ?, ?, 0, ?, 0, ?, ?, ?)`
      ).run(player.id, player.name, player.color, player.avatar, nanoid(24), player.is_admin, player.password_hash, now, now);

      if (invite && !markInviteUsed(invite.code, player.id, 'register')) throw new InvalidInviteError();
      ensureDefaultGroupMembership(player.id);
    })();
  } catch (error) {
    if (error instanceof InvalidInviteError) {
      return res.status(400).json({ error: 'Einladungscode ist ungültig oder abgelaufen.' });
    }
    throw error;
  }

  broadcast(Events.playersChanged, null, { groupId: DEFAULT_GROUP_ID });
  if (isBootstrap) {
    writeAdminAudit({
      actorPlayerId: player.id,
      action: 'recovery_code_used',
      targetType: 'player',
      targetId: player.id,
      details: { flow: 'register' },
    });
  }
  const token = createSession(player.id);
  setSessionCookie(res, token);
  res.status(201).json(toPublicAccount(player));
});

// POST /api/auth/claim - sets a password on an existing, not-yet-claimed
// player (the normal onboarding path for everyone who already has a profile
// from before real login existed). Body: { code, password, playerId? }
// (playerId is only read for the recovery-code bootstrap path, where there
// is no invite row to say which player is being claimed.)
authRouter.post('/claim', limitAnonymousAuthAttempts, (req, res) => {
  const { code, password, playerId } = req.body ?? {};

  if (!isNonEmptyString(code, 200)) return res.status(400).json({ error: 'Einladungscode ist erforderlich.' });
  if (!isValidPassword(password)) {
    return res.status(400).json({ error: `Passwort muss mindestens ${MIN_PASSWORD_LENGTH} Zeichen lang sein.` });
  }

  const isBootstrap = recoveryCodeUsable(code);
  let resolvedPlayerId: string | undefined;
  let invite: ReturnType<typeof findValidInvite>;
  if (isBootstrap) {
    if (!isNonEmptyString(playerId, 60)) {
      return res.status(400).json({ error: 'playerId ist beim Bootstrap-Code erforderlich.' });
    }
    resolvedPlayerId = playerId;
  } else {
    invite = findValidInvite(code, 'claim');
    if (!invite || !invite.player_id) {
      return res.status(400).json({ error: 'Einladungscode ist ungültig oder abgelaufen.' });
    }
    resolvedPlayerId = invite.player_id;
  }

  const existing = db.prepare('SELECT * FROM players WHERE id = ?').get(resolvedPlayerId) as PlayerRow | undefined;
  if (!existing) return res.status(404).json({ error: 'Spieler nicht gefunden.' });
  if (existing.deactivated_at !== null) return res.status(409).json({ error: 'Dieses Konto ist deaktiviert.' });
  if (existing.password_hash) return res.status(409).json({ error: 'Dieses Konto ist bereits beansprucht.' });

  const now = Date.now();
  const nextIsAdmin = isBootstrap ? 1 : existing.is_admin;
  const passwordHash = hashPassword(password);
  try {
    db.transaction(() => {
      if (invite && !markInviteUsed(invite.code, existing.id, 'claim')) throw new InvalidInviteError();
      const result = db
        .prepare('UPDATE players SET password_hash = ?, is_admin = ?, last_login_at = ? WHERE id = ? AND password_hash IS NULL')
        .run(passwordHash, nextIsAdmin, now, existing.id);
      if (result.changes !== 1) throw new InvalidInviteError();
      voidOutstandingInvites(existing.id, 'claim');
      ensureDefaultGroupMembership(existing.id);
    })();
  } catch (error) {
    if (error instanceof InvalidInviteError) {
      return res.status(400).json({
        error: isBootstrap
          ? 'Bootstrap-Code ist nicht mehr gültig oder das Konto wurde bereits beansprucht.'
          : 'Einladungscode ist ungültig, abgelaufen oder bereits verbraucht.',
      });
    }
    throw error;
  }

  broadcast(Events.playersChanged, null, { groupId: DEFAULT_GROUP_ID });
  if (isBootstrap) {
    writeAdminAudit({
      actorPlayerId: existing.id,
      action: 'recovery_code_used',
      targetType: 'player',
      targetId: existing.id,
      details: { flow: 'claim' },
    });
  }
  const token = createSession(existing.id);
  setSessionCookie(res, token);
  res.json(toPublicAccount({ ...existing, is_admin: nextIsAdmin }));
});

// POST /api/auth/login - Body: { name, password }
authRouter.post('/login', limitAnonymousAuthAttempts, (req, res) => {
  const { name, password } = req.body ?? {};
  if (!isNonEmptyString(name) || typeof password !== 'string' || password.length < 1 || password.length > 200) {
    return res.status(400).json({ error: 'Name und Passwort sind erforderlich.' });
  }
  const trimmedName = name.trim();

  if (isLoginLocked(trimmedName)) {
    writeAdminAudit({
      action: 'login_locked',
      targetType: 'account_name',
      targetId: trimmedName,
    });
    return res.status(429).json({
      error: 'Zu viele Fehlversuche – bitte kurz warten.',
      retryAfterMs: loginRetryAfterMs(trimmedName),
    });
  }

  const matchingPlayers = db
    .prepare('SELECT * FROM players WHERE name = ? COLLATE NOCASE LIMIT 2')
    .all(trimmedName) as PlayerRow[];
  if (matchingPlayers.length > 1) {
    verifyPasswordConstantTime(password, null);
    writeAdminAudit({ action: 'login_ambiguous', targetType: 'account_name', targetId: trimmedName });
    return res.status(409).json({ error: 'Dieser Name ist mehrfach vorhanden. Bitte wende dich an einen Admin.' });
  }
  const player = matchingPlayers[0];

  if (!verifyPasswordConstantTime(password, player?.password_hash ?? null)) {
    recordLoginFailure(trimmedName);
    writeAdminAudit({
      action: 'login_failed',
      targetType: 'account_name',
      targetId: trimmedName,
    });
    return res.status(401).json({ error: 'Name oder Passwort ist falsch.' });
  }

  if (player!.deactivated_at !== null) {
    writeAdminAudit({
      actorPlayerId: player!.id,
      action: 'login_denied_deactivated',
      targetType: 'player',
      targetId: player!.id,
    });
    return res.status(403).json({ error: 'Dieses Konto ist deaktiviert.' });
  }

  recordLoginSuccess(trimmedName);
  db.prepare('UPDATE players SET last_login_at = ? WHERE id = ?').run(Date.now(), player!.id);

  const token = createSession(player!.id);
  setSessionCookie(res, token);
  res.json(toPublicAccount(player!));
});

// POST /api/auth/logout - clears this device's session, if any. Always
// succeeds (a missing/already-invalid cookie is not an error here).
authRouter.post('/logout', (req, res) => {
  const token = getSessionToken(req);
  const deleted = token ? deleteSessionByToken(token) : undefined;
  if (deleted) disconnectSessionSockets(deleted.id);
  clearSessionCookie(res);
  res.status(204).end();
});

// POST /api/auth/password - Body: { currentPassword, newPassword }. Keeps
// the session that made the request alive; every other session/device of
// this account is signed out.
authRouter.post('/password', requireUser, (req, res) => {
  const { currentPassword, newPassword } = req.body ?? {};
  if (typeof currentPassword !== 'string' || !currentPassword) {
    return res.status(400).json({ error: 'Aktuelles Passwort ist erforderlich.' });
  }
  if (!isValidPassword(newPassword)) {
    return res.status(400).json({ error: `Neues Passwort muss mindestens ${MIN_PASSWORD_LENGTH} Zeichen lang sein.` });
  }

  const existing = db.prepare('SELECT * FROM players WHERE id = ?').get(req.player!.id) as PlayerRow;
  if (!verifyPasswordConstantTime(currentPassword, existing.password_hash)) {
    return res.status(401).json({ error: 'Aktuelles Passwort ist falsch.' });
  }

  db.prepare('UPDATE players SET password_hash = ? WHERE id = ?').run(hashPassword(newPassword), existing.id);
  markSessionReauthenticated(req.sessionId!);
  deleteAllSessionsForPlayer(existing.id, req.sessionId);
  db.prepare('DELETE FROM push_subscriptions WHERE player_id = ?').run(existing.id);
  disconnectPlayerSockets(existing.id, req.sessionId);
  voidOutstandingInvites(existing.id, 'reset');
  res.status(204).end();
});

// POST /api/auth/reauth - confirms the password for this session for a short
// step-up window. The window is intentionally session-local so a party phone
// left unlocked cannot inherit a confirmation made on another device.
authRouter.post('/reauth', requireUser, (req, res) => {
  const { password } = req.body ?? {};
  if (typeof password !== 'string' || password.length < 1 || password.length > 200) {
    return res.status(400).json({ error: 'Passwort ist erforderlich.' });
  }
  const limiterKey = `reauth:${req.sessionId}`;
  if (isLoginLocked(limiterKey)) {
    return res.status(429).json({
      error: 'Zu viele Fehlversuche – bitte kurz warten.',
      retryAfterMs: loginRetryAfterMs(limiterKey),
    });
  }
  const existing = db.prepare('SELECT password_hash FROM players WHERE id = ?').get(req.player!.id) as {
    password_hash: string | null;
  };
  if (!verifyPasswordConstantTime(password, existing.password_hash)) {
    recordLoginFailure(limiterKey);
    return res.status(401).json({ error: 'Passwort ist falsch.' });
  }
  recordLoginSuccess(limiterKey);
  markSessionReauthenticated(req.sessionId!);
  res.status(204).end();
});

// POST /api/auth/reset - consumes an admin-issued reset code, replaces the
// password, invalidates every old session and logs this device in with a new
// session. Body: { code, newPassword }
authRouter.post('/reset', limitAnonymousAuthAttempts, (req, res) => {
  const { code, newPassword } = req.body ?? {};
  if (!isNonEmptyString(code, 200)) {
    return res.status(400).json({ error: 'Reset-Code ist erforderlich.' });
  }
  if (!isValidPassword(newPassword)) {
    return res.status(400).json({ error: `Neues Passwort muss mindestens ${MIN_PASSWORD_LENGTH} Zeichen lang sein.` });
  }

  const recoveryTarget = soleClaimedAdminForRecovery(code);
  const invite = recoveryTarget ? undefined : findValidInvite(code, 'reset');
  if (!recoveryTarget && !invite?.player_id) {
    return res.status(400).json({ error: 'Reset-Code ist ungültig oder abgelaufen.' });
  }
  const existing = recoveryTarget ?? (db.prepare('SELECT * FROM players WHERE id = ?').get(invite!.player_id) as PlayerRow | undefined);
  if (!existing?.password_hash) {
    return res.status(400).json({ error: 'Reset-Code ist ungültig oder abgelaufen.' });
  }

  const passwordHash = hashPassword(newPassword);
  const reset = db.transaction(() => {
    if (invite && !markInviteUsed(invite.code, existing.id, 'reset')) return false;
    db.prepare('UPDATE players SET password_hash = ?, last_login_at = ? WHERE id = ?').run(
      passwordHash,
      Date.now(),
      existing.id
    );
    deleteAllSessionsForPlayer(existing.id);
    db.prepare('DELETE FROM push_subscriptions WHERE player_id = ?').run(existing.id);
    voidOutstandingInvites(existing.id, 'reset');
    return true;
  })();
  if (!reset) {
    return res.status(400).json({ error: 'Reset-Code ist ungültig oder abgelaufen.' });
  }

  disconnectPlayerSockets(existing.id);
  if (recoveryTarget) {
    writeAdminAudit({
      actorPlayerId: existing.id,
      action: 'recovery_code_used',
      targetType: 'player',
      targetId: existing.id,
      details: { flow: 'reset' },
    });
  }
  const token = createSession(existing.id);
  setSessionCookie(res, token);
  res.json(toPublicAccount(existing));
});

const INVITE_PURPOSES: InvitePurpose[] = ['register', 'claim', 'reset'];

// GET /api/auth/invites - active, still-shareable links for the admin UI.
// Used/revoked/expired codes stay in the DB audit trail but are not returned.
authRouter.get('/invites', ...requireSessionAdmin, (_req, res) => {
  const rows = db
    .prepare(
      `SELECT i.code, i.purpose, i.player_id AS playerId, p.name AS playerName,
              i.created_at AS createdAt, i.expires_at AS expiresAt
       FROM invites i
       LEFT JOIN players p ON p.id = i.player_id
       WHERE i.used_at IS NULL AND i.revoked_at IS NULL AND i.expires_at > ?
       ORDER BY i.created_at DESC`
    )
    .all(Date.now());
  res.json(rows);
});

// POST /api/auth/invites - admin-only. Body: { purpose, playerId?, expiresInMs? }
authRouter.post('/invites', ...requireSessionAdmin, requireRecentReauthentication, (req, res) => {
  const { purpose, playerId, expiresInMs } = req.body ?? {};
  if (typeof purpose !== 'string' || !INVITE_PURPOSES.includes(purpose as InvitePurpose)) {
    return res.status(400).json({ error: `purpose muss eines von ${INVITE_PURPOSES.join(', ')} sein.` });
  }
  if (expiresInMs !== undefined && (typeof expiresInMs !== 'number' || !Number.isFinite(expiresInMs) || expiresInMs <= 0)) {
    return res.status(400).json({ error: 'expiresInMs muss eine positive Zahl sein.' });
  }

  if (purpose === 'register') {
    if (playerId !== undefined) {
      return res.status(400).json({ error: 'playerId darf bei purpose "register" nicht gesetzt sein.' });
    }
  } else {
    if (typeof playerId !== 'string' || !playerId) {
      return res.status(400).json({ error: 'playerId ist erforderlich.' });
    }
    const target = db.prepare('SELECT id, password_hash, is_test, deactivated_at FROM players WHERE id = ?').get(playerId) as
      | { id: string; password_hash: string | null; is_test: number; deactivated_at: number | null }
      | undefined;
    if (!target) return res.status(404).json({ error: 'Spieler nicht gefunden.' });
    if (target.is_test) return res.status(409).json({ error: 'Test-Spieler erhalten keine Anmeldelinks.' });
    if (target.deactivated_at !== null) return res.status(409).json({ error: 'Dieses Konto ist deaktiviert.' });
    if (purpose === 'claim' && target.password_hash) {
      return res.status(409).json({ error: 'Dieser Spieler hat bereits ein Passwort gesetzt.' });
    }
    if (purpose === 'reset' && !target.password_hash) {
      return res.status(409).json({ error: 'Dieser Spieler hat noch kein Passwort gesetzt.' });
    }
  }

  const invite = createInvite({
    purpose: purpose as InvitePurpose,
    playerId: purpose === 'register' ? undefined : playerId,
    createdBy: req.player!.id,
    expiresInMs,
  });
  writeAdminAudit({
    actorPlayerId: req.player!.id,
    action: 'invite_created',
    targetType: purpose === 'register' ? 'registration' : 'player',
    targetId: purpose === 'register' ? undefined : playerId,
    details: { purpose, expiresAt: invite.expires_at },
  });
  res.status(201).json({
    code: invite.code,
    purpose: invite.purpose,
    playerId: invite.player_id,
    expiresAt: invite.expires_at,
  });
});

// DELETE /api/auth/invites/:code - admin-only. Revoking an already-used or
// already-revoked code is a no-op 404, not an error worth retrying.
authRouter.delete('/invites/:code', ...requireSessionAdmin, requireRecentReauthentication, (req, res) => {
  const invite = db.prepare('SELECT purpose, player_id FROM invites WHERE code = ?').get(req.params.code) as
    | { purpose: InvitePurpose; player_id: string | null }
    | undefined;
  if (!revokeInvite(req.params.code)) {
    return res.status(404).json({ error: 'Einladungscode nicht gefunden oder bereits verbraucht.' });
  }
  writeAdminAudit({
    actorPlayerId: req.player!.id,
    action: 'invite_revoked',
    targetType: invite?.player_id ? 'player' : 'registration',
    targetId: invite?.player_id ?? undefined,
    details: { purpose: invite?.purpose },
  });
  res.status(204).end();
});
