import { createHash, randomBytes, timingSafeEqual } from 'crypto';
import { config } from './config';
import { db, getState, setState } from './db';

export interface KioskAccount {
  eventId: string;
  groupId: string;
  username: string;
  eventName: string;
}

const GENERATED_KIOSK_PASSWORD_KEY = 'generated_kiosk_password';

// KIOSK_PASSWORD/KIOSK_TOKEN stay the explicit operator override. Without
// either, a strong password is generated once and persisted in app_state (the
// gitignored DB file, not the repo — same pattern as push.ts's VAPID keys),
// so every installation gets a working shared kiosk login without manual
// .env setup. Admins can read it back in Kioskverwaltung (routes/admin.ts).
function ensureKioskPassword(): string {
  if (config.kioskPassword) return config.kioskPassword;
  const existing = getState(GENERATED_KIOSK_PASSWORD_KEY);
  if (existing) return existing;
  const generated = randomBytes(32).toString('hex');
  setState(GENERATED_KIOSK_PASSWORD_KEY, generated);
  return generated;
}

const kioskPassword = ensureKioskPassword();

export function getKioskPassword(): string {
  return kioskPassword;
}

export function findKioskAccount(username: string): KioskAccount | null {
  const row = db
    .prepare(
      `SELECT ka.event_id AS eventId, ka.group_id AS groupId, ka.username, e.name AS eventName
       FROM kiosk_accounts ka
       JOIN events e ON e.id = ka.event_id AND e.group_id = ka.group_id
       JOIN groups g ON g.id = ka.group_id
       WHERE ka.username = ? COLLATE NOCASE
         AND e.event_type_key = 'lan'
         AND g.archived_at IS NULL
       LIMIT 1`,
    )
    .get(username) as KioskAccount | undefined;
  return row ?? null;
}

export function verifyKioskPassword(password: string): boolean {
  const actual = createHash('sha256').update(password).digest();
  const expected = createHash('sha256').update(kioskPassword).digest();
  return timingSafeEqual(actual, expected);
}

export function recordKioskLogin(eventId: string): void {
  db.prepare('UPDATE kiosk_accounts SET last_login_at = ? WHERE event_id = ?').run(Date.now(), eventId);
}
