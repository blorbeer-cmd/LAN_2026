// Optional startup seeding of ready-to-use admin accounts from environment
// variables, so an operator can hand out working logins without walking the
// recovery-code bootstrap (see docs/BOOTSTRAP-ADMINS.md).
//
// Credentials are NEVER hard-coded here: names and passwords are read at
// runtime from BOOTSTRAP_ADMIN_<n>_NAME / BOOTSTRAP_ADMIN_<n>_PASSWORD, which
// live in the server's .env (like ADMIN_RECOVERY_CODE) and are never
// committed. The seeding is idempotent and deliberately conservative: it never
// overwrites a password an account already has, so the .env lines can stay in
// place across restarts and a person who later changes their own password is
// left untouched.

import { nanoid } from 'nanoid';
import { db } from './db';
import { hashPassword, isValidPassword } from './accounts';
import { isNonEmptyString } from './validation';
import { ensureDefaultGroupMembership } from './groups';

const DEFAULT_COLOR = '#4f9dff';
// How many BOOTSTRAP_ADMIN_<n>_* slots we look at. Far more than the handful a
// friend-group instance ever needs, but cheap to scan.
const MAX_SLOTS = 20;

export type BootstrapAdminAction =
  | 'created'
  | 'claimed'
  | 'skipped-exists'
  | 'skipped-invalid-name'
  | 'skipped-invalid-password'
  | 'skipped-ambiguous'
  | 'skipped-test'
  | 'skipped-deactivated';

export interface BootstrapAdminEntry {
  slot: number;
  name: string | undefined;
  password: string | undefined;
}

export interface BootstrapAdminResult {
  slot: number;
  name: string | undefined;
  action: BootstrapAdminAction;
}

interface BootstrapPlayerRow {
  id: string;
  is_admin: number;
  is_test: number;
  password_hash: string | null;
  deactivated_at: number | null;
}

// Reads BOOTSTRAP_ADMIN_<n>_NAME / _PASSWORD for n = 1..MAX_SLOTS. A slot is
// returned as soon as either half is set, so a half-configured slot (e.g. a
// name without a password) surfaces as a skip instead of being ignored.
export function parseBootstrapAdmins(env: NodeJS.ProcessEnv = process.env): BootstrapAdminEntry[] {
  const entries: BootstrapAdminEntry[] = [];
  for (let slot = 1; slot <= MAX_SLOTS; slot += 1) {
    const name = env[`BOOTSTRAP_ADMIN_${slot}_NAME`];
    const password = env[`BOOTSTRAP_ADMIN_${slot}_PASSWORD`];
    if (name === undefined && password === undefined) continue;
    entries.push({ slot, name, password });
  }
  return entries;
}

// Seeds a single configured admin idempotently. Runs in one transaction so a
// created player and its default-group membership commit together.
function seedOne(entry: BootstrapAdminEntry): BootstrapAdminAction {
  const rawName = entry.name;
  if (!isNonEmptyString(rawName)) return 'skipped-invalid-name';
  const name = rawName.trim();
  if (!isValidPassword(entry.password)) return 'skipped-invalid-password';
  const password = entry.password;

  return db.transaction((): BootstrapAdminAction => {
    const matches = db
      .prepare('SELECT id, is_admin, is_test, password_hash, deactivated_at FROM players WHERE name = ? COLLATE NOCASE')
      .all(name) as BootstrapPlayerRow[];

    if (matches.length > 1) return 'skipped-ambiguous';

    if (matches.length === 1) {
      const existing = matches[0];
      // Already has a password: leave it completely alone. This is what makes
      // the .env safe to leave in place — a later self-service password change
      // is never reverted on restart.
      if (existing.password_hash) return 'skipped-exists';
      if (existing.is_test) return 'skipped-test';
      if (existing.deactivated_at !== null) return 'skipped-deactivated';

      db.prepare('UPDATE players SET password_hash = ?, is_admin = 1 WHERE id = ?').run(hashPassword(password), existing.id);
      ensureDefaultGroupMembership(existing.id);
      return 'claimed';
    }

    const id = nanoid();
    db.prepare(
      `INSERT INTO players (id, name, color, avatar, api_key, tracking_paused, is_admin, is_test, password_hash, last_login_at, created_at)
       VALUES (?, ?, ?, NULL, ?, 0, 1, 0, ?, NULL, ?)`,
    ).run(id, name, DEFAULT_COLOR, nanoid(24), hashPassword(password), Date.now());
    ensureDefaultGroupMembership(id);
    return 'created';
  })();
}

// Runs all configured slots and logs a per-slot summary (never the password).
// Called once at server startup (index.ts). A no-op when nothing is
// configured, so it is safe to leave wired in every deployment.
export function runBootstrapAdmins(env: NodeJS.ProcessEnv = process.env): BootstrapAdminResult[] {
  const entries = parseBootstrapAdmins(env);
  const results: BootstrapAdminResult[] = [];
  for (const entry of entries) {
    let action: BootstrapAdminAction;
    try {
      action = seedOne(entry);
    } catch (error) {
      // A single misconfigured slot must never stop the server from starting.
      // eslint-disable-next-line no-console
      console.error(`Bootstrap-Admin (Slot ${entry.slot}): unerwarteter Fehler`, error);
      continue;
    }
    results.push({ slot: entry.slot, name: entry.name, action });
    const label = entry.name ? `"${entry.name.trim()}"` : `(Slot ${entry.slot})`;
    if (action === 'created' || action === 'claimed') {
      // eslint-disable-next-line no-console
      console.log(`Bootstrap-Admin ${label}: ${action === 'created' ? 'neu angelegt' : 'bestehendes Profil beansprucht'} und als Admin gesetzt.`);
    } else {
      // eslint-disable-next-line no-console
      console.warn(`Bootstrap-Admin (Slot ${entry.slot}): übersprungen (${action}).`);
    }
  }
  return results;
}
