import { createHash, timingSafeEqual } from 'crypto';
import { config } from './config';
import { db } from './db';

export interface KioskAccount {
  eventId: string;
  groupId: string;
  username: string;
  eventName: string;
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
  const expected = createHash('sha256').update(config.kioskPassword).digest();
  return Boolean(config.kioskPassword) && timingSafeEqual(actual, expected);
}

export function recordKioskLogin(eventId: string): void {
  db.prepare('UPDATE kiosk_accounts SET last_login_at = ? WHERE event_id = ?').run(Date.now(), eventId);
}
