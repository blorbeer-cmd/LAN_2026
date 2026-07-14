// Real per-user login (see docs/KONZEPT-USER-MANAGEMENT.md): register a
// brand-new player, claim an existing one, log in/out, change a password,
// and (admin-only) issue/revoke the invite codes that gate all of the above.
//
// Nothing here is wired into the rest of the app yet — these are new
// endpoints that don't touch any existing behavior (see config.authMode).
// Enforcing login across feature routes is a separate, later change.

import { Router } from 'express';
import { nanoid } from 'nanoid';
import { db } from '../db';
import { config } from '../config';
import { broadcast, Events } from '../realtime';
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
} from '../sessions';
import { createInvite, findValidInvite, markInviteUsed, voidOutstandingInvites, revokeInvite, type InvitePurpose } from '../invites';
import { isLoginLocked, loginRetryAfterMs, recordLoginFailure, recordLoginSuccess } from '../loginRateLimit';

export const authRouter = Router();

const DEFAULT_COLOR = '#4f9dff';

interface PlayerRow {
  id: string;
  name: string;
  color: string;
  avatar: string | null;
  password_hash: string | null;
  is_admin: number;
  is_test: number;
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

// POST /api/auth/register - creates a brand-new player via a 'register'
// invite (or the recovery code, while no admin has claimed an account yet).
// Body: { code, name, password, color?, avatar? }
authRouter.post('/register', (req, res) => {
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
    created_at: now,
  };

  db.prepare(
    `INSERT INTO players (id, name, color, avatar, api_key, tracking_paused, is_admin, is_test, password_hash, last_login_at, created_at)
     VALUES (?, ?, ?, ?, ?, 0, ?, 0, ?, ?, ?)`
  ).run(player.id, player.name, player.color, player.avatar, nanoid(24), player.is_admin, player.password_hash, now, now);

  if (invite) markInviteUsed(invite.code, player.id);

  broadcast(Events.playersChanged, null);
  const token = createSession(player.id);
  setSessionCookie(res, token);
  res.status(201).json(toPublicAccount(player));
});

// POST /api/auth/claim - sets a password on an existing, not-yet-claimed
// player (the normal onboarding path for everyone who already has a profile
// from before real login existed). Body: { code, password, playerId? }
// (playerId is only read for the recovery-code bootstrap path, where there
// is no invite row to say which player is being claimed.)
authRouter.post('/claim', (req, res) => {
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
  if (existing.password_hash) return res.status(409).json({ error: 'Dieses Konto ist bereits beansprucht.' });

  const now = Date.now();
  const nextIsAdmin = isBootstrap ? 1 : existing.is_admin;
  db.prepare('UPDATE players SET password_hash = ?, is_admin = ?, last_login_at = ? WHERE id = ?').run(
    hashPassword(password),
    nextIsAdmin,
    now,
    existing.id
  );

  if (invite) markInviteUsed(invite.code, existing.id);
  voidOutstandingInvites(existing.id, 'claim');

  broadcast(Events.playersChanged, null);
  const token = createSession(existing.id);
  setSessionCookie(res, token);
  res.json(toPublicAccount({ ...existing, is_admin: nextIsAdmin }));
});

// POST /api/auth/login - Body: { name, password }
authRouter.post('/login', (req, res) => {
  const { name, password } = req.body ?? {};
  if (typeof name !== 'string' || !name.trim() || typeof password !== 'string' || !password) {
    return res.status(400).json({ error: 'Name und Passwort sind erforderlich.' });
  }
  const trimmedName = name.trim();

  if (isLoginLocked(trimmedName)) {
    return res.status(429).json({
      error: 'Zu viele Fehlversuche – bitte kurz warten.',
      retryAfterMs: loginRetryAfterMs(trimmedName),
    });
  }

  const player = db.prepare('SELECT * FROM players WHERE name = ? COLLATE NOCASE').get(trimmedName) as
    | PlayerRow
    | undefined;

  if (!verifyPasswordConstantTime(password, player?.password_hash ?? null)) {
    recordLoginFailure(trimmedName);
    return res.status(401).json({ error: 'Name oder Passwort ist falsch.' });
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
  if (token) deleteSessionByToken(token);
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
  deleteAllSessionsForPlayer(existing.id, req.sessionId);
  voidOutstandingInvites(existing.id, 'reset');
  res.status(204).end();
});

const INVITE_PURPOSES: InvitePurpose[] = ['register', 'claim', 'reset'];

// POST /api/auth/invites - admin-only. Body: { purpose, playerId?, expiresInMs? }
authRouter.post('/invites', ...requireSessionAdmin, (req, res) => {
  const { purpose, playerId, expiresInMs } = req.body ?? {};
  if (typeof purpose !== 'string' || !INVITE_PURPOSES.includes(purpose as InvitePurpose)) {
    return res.status(400).json({ error: `purpose muss eines von ${INVITE_PURPOSES.join(', ')} sein.` });
  }
  if (expiresInMs !== undefined && (typeof expiresInMs !== 'number' || !Number.isFinite(expiresInMs) || expiresInMs < 0)) {
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
    const target = db.prepare('SELECT id, password_hash FROM players WHERE id = ?').get(playerId) as
      | { id: string; password_hash: string | null }
      | undefined;
    if (!target) return res.status(404).json({ error: 'Spieler nicht gefunden.' });
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
  res.status(201).json({ code: invite.code, purpose: invite.purpose, expiresAt: invite.expires_at });
});

// DELETE /api/auth/invites/:code - admin-only. Revoking an already-used or
// already-revoked code is a no-op 404, not an error worth retrying.
authRouter.delete('/invites/:code', ...requireSessionAdmin, (req, res) => {
  if (!revokeInvite(req.params.code)) {
    return res.status(404).json({ error: 'Einladungscode nicht gefunden oder bereits verbraucht.' });
  }
  res.status(204).end();
});
