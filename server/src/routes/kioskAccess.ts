import { Router } from 'express';
import { config } from '../config';
import { issueKioskToken } from '../kioskTokens';
import { findKioskAccount, recordKioskLogin, verifyKioskPassword } from '../kioskAccounts';
import {
  consumeGlobalAuthRequest,
  isLoginLocked,
  loginRetryAfterMs,
  recordLoginFailure,
  recordLoginSuccess,
} from '../loginRateLimit';
import { isNonEmptyString } from '../validation';
import { writeAdminAudit } from '../adminAudit';

export const kioskAccessRouter = Router();

// A kiosk account never becomes a player session. Successful login only
// issues the existing event-scoped, read-only kiosk credential, so every
// other API and the normal app remain behind requireUser.
kioskAccessRouter.post('/login', (req, res) => {
  const rate = consumeGlobalAuthRequest();
  if (!rate.allowed) {
    res.setHeader('Retry-After', String(Math.ceil(rate.retryAfterMs / 1000)));
    return res.status(429).json({ error: 'Zu viele Authentifizierungsanfragen – bitte kurz warten.' });
  }

  const { username, password } = req.body ?? {};
  if (!isNonEmptyString(username, 100) || typeof password !== 'string' || password.length < 1 || password.length > 200) {
    return res.status(400).json({ error: 'Kiosk-Konto und Passwort sind erforderlich.' });
  }
  if (!config.kioskPassword) {
    return res.status(503).json({ error: 'Das gemeinsame Kiosk-Passwort ist noch nicht konfiguriert.' });
  }

  const trimmedUsername = username.trim();
  const limiterKey = `kiosk:${trimmedUsername}`;
  if (isLoginLocked(limiterKey)) {
    return res.status(429).json({
      error: 'Zu viele Fehlversuche – bitte kurz warten.',
      retryAfterMs: loginRetryAfterMs(limiterKey),
    });
  }

  const account = findKioskAccount(trimmedUsername);
  const passwordValid = verifyKioskPassword(password);
  if (!account || !passwordValid) {
    recordLoginFailure(limiterKey);
    writeAdminAudit({ action: 'kiosk_login_failed', targetType: 'kiosk_account', targetId: trimmedUsername });
    return res.status(401).json({ error: 'Kiosk-Konto oder Passwort ist falsch.' });
  }

  recordLoginSuccess(limiterKey);
  const issued = issueKioskToken(account.groupId, account.eventId, null, `Kiosk-Konto ${account.username}`);
  recordKioskLogin(account.eventId);
  writeAdminAudit({
    action: 'kiosk_login_succeeded',
    targetType: 'kiosk_account',
    targetId: account.eventId,
    groupId: account.groupId,
  });
  return res.json({
    token: issued.token,
    username: account.username,
    eventId: account.eventId,
    eventName: account.eventName,
  });
});
